import { Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { forbidden, notFound } from '../common/errors';
import { AuthorizationService } from '../authz/authorization.service';
import { CurrentUser, type AuthUser } from '../auth/auth';

// P0-013 CTE: consulta del catálogo de sistema de hitos críticos de trazabilidad (solo lectura).
// Se consulta en el contexto de una organización (membresía + `traceability:read_catalog`); el contenido
// es el mismo para todas porque el catálogo es de sistema. Cada definición se referencia de forma estable
// por id o por (code, version); retirar no borra ni cambia definiciones anteriores.

class CatalogQuery {
  @IsOptional() @IsIn(['true', 'false']) include_retired?: 'true' | 'false';
}

interface DefRow {
  id: string; code: string; version: number; name: string; description: string; stage: string; source: string;
  release_version: string; supersedes_id: string | null; created_at: string;
  retired_in: string | null; retired_reason: string | null; retired_at: string | null; superseded_by: string | null;
}

const STAGE_LABEL: Record<string, string> = { ORIGIN: 'Origen (paso atrás)', INTERNAL: 'Trazabilidad interna', OUTBOUND: 'Destino (paso adelante)' };

@Injectable()
export class CteService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>, private readonly authz: AuthorizationService) {}

  private async check(user: AuthUser, orgId: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!ctx.permissions.includes('traceability:read_catalog')) throw forbidden('PERMISSION_DENIED', 'Tu rol no permite consultar el catálogo de hitos de trazabilidad.');
  }

  private async definitions(where = sql`TRUE`) {
    const r = await sql<DefRow>`
      SELECT d.id, d.code, d.version, d.name, d.description, d.stage, d.source, d.release_version, d.supersedes_id, d.created_at,
             t.release_version AS retired_in, t.reason AS retired_reason, t.retired_at,
             (SELECT n.id FROM cte_definitions n WHERE n.supersedes_id = d.id) AS superseded_by
      FROM cte_definitions d LEFT JOIN cte_definition_retirements t ON t.definition_id = d.id
      WHERE ${where}
      ORDER BY CASE d.stage WHEN 'ORIGIN' THEN 1 WHEN 'INTERNAL' THEN 2 ELSE 3 END, d.created_at, d.code, d.version`.execute(this.db);
    const ids = r.rows.map((d) => d.id);
    const links = ids.length
      ? (await sql<{ definition_id: string; operation_code: string; event_type: string; integration_status: string; story: string | null; note: string }>`
          SELECT definition_id, operation_code, event_type, integration_status, story, note FROM cte_operation_links WHERE definition_id = ANY(${ids}) ORDER BY operation_code`.execute(this.db)).rows
      : [];
    return r.rows.map((d) => ({
      id: d.id, code: d.code, version: d.version, reference: `${d.code}@${d.version}`, name: d.name, description: d.description,
      stage: d.stage, stage_label: STAGE_LABEL[d.stage] ?? d.stage, source: d.source, published_in: d.release_version,
      status: d.retired_in ? 'RETIRED' : 'ACTIVE',
      retirement: d.retired_in ? { release: d.retired_in, reason: d.retired_reason, at: d.retired_at, superseded_by: d.superseded_by } : null,
      supersedes_id: d.supersedes_id,
      operations: links.filter((l) => l.definition_id === d.id).map((l) => ({
        operation: l.operation_code, event_type: l.event_type, integration_status: l.integration_status, story: l.story, note: l.note,
      })),
      kde: { status: 'PENDING_DEFINITION', story: 'P0-014', note: 'Los datos mínimos (KDE) y su obligatoriedad se definen en P0-014.' },
    }));
  }

  async catalog(user: AuthUser, orgId: string, q: CatalogQuery) {
    await this.check(user, orgId);
    const release = (await sql<{ version: string; source: string; notes: string; published_at: string }>`
      SELECT version, source, notes, published_at FROM cte_catalog_releases ORDER BY published_at DESC, version DESC LIMIT 1`.execute(this.db)).rows[0] ?? null;
    const defs = await this.definitions(q.include_retired === 'true' ? sql`TRUE` : sql`t.definition_id IS NULL`);
    return {
      scope: 'SYSTEM',
      scope_note: 'Catálogo de sistema, igual para todas las organizaciones. Se publica con versiones; no hay administración desde la aplicación.',
      current_release: release,
      definitions: defs,
      summary: {
        definitions: defs.filter((d) => d.status === 'ACTIVE').length,
        integrated_operations: defs.flatMap((d) => d.operations).filter((o) => o.integration_status === 'INTEGRATED').length,
        pending_operations: defs.flatMap((d) => d.operations).filter((o) => o.integration_status === 'PENDING').length,
      },
      not_milestones: 'Crear productor, parcela, producto o versiones geométricas son datos maestros, no hitos de cosecha, entrega o recepción.',
    };
  }

  async releases(user: AuthUser, orgId: string) {
    await this.check(user, orgId);
    return (await sql`SELECT version, source, notes, published_at FROM cte_catalog_releases ORDER BY published_at DESC, version DESC`.execute(this.db)).rows;
  }

  async definition(user: AuthUser, orgId: string, id: string) {
    await this.check(user, orgId);
    const [d] = await this.definitions(sql`d.id = ${id}`);
    if (!d) throw notFound();
    return d;
  }
}

@ApiTags('traceability')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class CteController {
  constructor(private readonly service: CteService) {}

  @Get('cte-catalog')
  catalog(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: CatalogQuery) {
    return this.service.catalog(user, orgId, q);
  }

  @Get('cte-catalog/releases')
  releases(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.releases(user, orgId);
  }

  @Get('cte-definitions/:id')
  definition(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.definition(user, orgId, id);
  }
}
