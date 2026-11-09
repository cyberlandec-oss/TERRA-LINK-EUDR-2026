import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser } from '../auth/auth';
import { PENDING_ENTITIES, type Condition, type Validation } from './kde-schema';
import { validateKde, type KdeDef, type RefResolver } from './kde-validator';

// P0-014 KDE: consulta del catálogo de sistema y validación reutilizable (sin persistir valores).
// La validación no registra ni devuelve los valores recibidos: solo resultados por dato con código y acción.
// Las referencias se resuelven en la organización y en el alcance del usuario; un id ajeno o inexistente
// da el mismo resultado (REFERENCE_NOT_FOUND), sin revelar existencia.

class CatalogQuery {
  @IsOptional() @IsUUID() cte_definition_id?: string;
  @IsOptional() @IsIn(['true', 'false']) include_retired?: 'true' | 'false';
}
class ValidateDto {
  @ApiProperty() @IsUUID() cte_definition_id!: string;
  @ApiProperty({ description: 'Valores por código KDE. Ausente = omitido o null.' }) @IsObject() values!: Record<string, unknown>;
}

interface Row {
  id: string; code: string; version: number; cte_definition_id: string; cte_code: string; cte_version: number; cte_retired: boolean;
  name: string; entity: string; field: string; value_type: KdeDef['value_type']; requirement: KdeDef['requirement'];
  condition: Condition | null; validation: Validation; responsible_roles: string[]; responsible_note: string; source: string;
  difference: string | null; release_version: string; supersedes_id: string | null; retired_in: string | null; retired_reason: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  QUANTITY: 'Cantidad con unidad', DECIMAL: 'Número decimal', INTEGER: 'Número entero', TEXT: 'Texto', BOOLEAN: 'Sí/No', DATE: 'Fecha',
  DATETIME: 'Fecha y hora con zona', DATE_RANGE: 'Periodo (inicio–fin)', ENUM: 'Opción de catálogo', ENTITY_REF: 'Referencia a un registro', ENTITY_REF_LIST: 'Lista de referencias', HARVEST_PERIOD: 'Periodo con precisión declarada (día, mes o desconocido)',
};
const ENTITY_LABEL: Record<string, string> = {
  producer: 'productor', plot: 'parcela', plot_version: 'versión geométrica de parcela', product: 'producto activo', membership: 'miembro activo',
  delivery: 'entrega', location: 'centro o ubicación', document: 'documento', sample: 'muestra', weighable: 'entidad pesada', lot: 'lote',
  process_run: 'proceso', counterparty: 'contraparte', buyer: 'comprador', shipment: 'embarque', dd_package: 'paquete de diligencia',
};
const REQ_LABEL: Record<string, string> = { REQUIRED: 'Requerido', CONDITIONAL: 'Condicional', OPTIONAL: 'Opcional' };

export function describeRule(t: string, v: Validation): string {
  const parts: string[] = [];
  if (t === 'QUANTITY') parts.push(`unidad: ${v.allowed_units?.join(', ')} (${v.dimension === 'MASS' ? 'masa' : v.dimension}); sin conversión`);
  if (v.positive) parts.push('mayor que cero');
  if (v.non_negative) parts.push('cero o mayor');
  if (t === 'DECIMAL' || t === 'QUANTITY') parts.push('decimal como texto, hasta 6 decimales');
  if (v.max_length) parts.push(`hasta ${v.max_length} caracteres; no vacío`);
  if (v.pattern === 'ISO_4217') parts.push('código ISO 4217 de 3 letras');
  if (v.values) parts.push(`valores: ${v.values.join(', ')}`);
  if (v.entity) parts.push(`${ENTITY_LABEL[v.entity] ?? v.entity} de tu organización${v.entity in PENDING_ENTITIES ? ` (no verificable hasta ${PENDING_ENTITIES[v.entity]})` : ''}`);
  if (v.min_items) parts.push(`al menos ${v.min_items}`);
  if (t === 'DATE_RANGE') parts.push('inicio ≤ fin');
  if (t === 'HARVEST_PERIOD') parts.push('día (AAAA-MM-DD), mes o intervalo de meses (AAAA-MM) o desconocido declarado; inicio ≤ fin; sin completar días');
  if (t === 'DATETIME') parts.push('con zona horaria');
  return parts.join('; ');
}
export function describeCondition(c: Condition | null): string | null {
  if (!c) return null;
  if (c.kind === 'equals') return `Se exige cuando ${c.kde} = ${String(c.value)}.`;
  if (c.kind === 'present') return `Se exige cuando se registra ${c.kde}.`;
  if (c.kind === 'quantities_differ') return `Se exige cuando ${c.a} y ${c.b} difieren (misma unidad; sin conversión).`;
  return `Condición no definida en el contrato: ${c.note}`;
}

@Injectable()
export class KdeService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>, private readonly authz: AuthorizationService) {}

  private async ctx(user: AuthUser, orgId: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!ctx.permissions.includes('traceability:read_catalog')) throw forbidden('PERMISSION_DENIED', 'Tu rol no permite consultar los datos mínimos de trazabilidad.');
    return ctx;
  }

  private async rows(where = sql`TRUE`) {
    return (await sql<Row>`
      SELECT k.id, k.code, k.version, k.cte_definition_id, c.code AS cte_code, c.version AS cte_version,
             EXISTS (SELECT 1 FROM cte_definition_retirements ct WHERE ct.definition_id = c.id) AS cte_retired,
             k.name, k.entity, k.field, k.value_type, k.requirement, k.condition, k.validation, k.responsible_roles, k.responsible_note,
             k.source, k.difference, k.release_version, k.supersedes_id, r.release_version AS retired_in, r.reason AS retired_reason
      FROM kde_definitions k JOIN cte_definitions c ON c.id = k.cte_definition_id
      LEFT JOIN kde_definition_retirements r ON r.definition_id = k.id
      WHERE ${where} ORDER BY c.code, k.created_at, k.code, k.version`.execute(this.db)).rows;
  }

  private async view(rows: Row[]) {
    const links = rows.length
      ? (await sql<{ definition_id: string; operation_code: string; event_type: string; integration_status: string; story: string | null }>`
          SELECT definition_id, operation_code, event_type, integration_status, story FROM cte_operation_links WHERE definition_id = ANY(${[...new Set(rows.map((r) => r.cte_definition_id))]})`.execute(this.db)).rows
      : [];
    return rows.map((r) => {
      const link = links.find((l) => l.definition_id === r.cte_definition_id);
      return {
        id: r.id, code: r.code, version: r.version, reference: `${r.code}@${r.version}`, name: r.name,
        cte: { id: r.cte_definition_id, reference: `${r.cte_code}@${r.cte_version}`, retired: r.cte_retired },
        contract: { entity: r.entity, field: r.field },
        value_type: r.value_type, value_type_label: TYPE_LABEL[r.value_type],
        unit: r.value_type === 'QUANTITY' ? { allowed: r.validation.allowed_units, dimension: r.validation.dimension } : null,
        requirement: r.requirement, requirement_label: REQ_LABEL[r.requirement],
        condition: r.condition, condition_text: describeCondition(r.condition),
        validation: r.validation, rule_text: describeRule(r.value_type, r.validation),
        responsible_roles: r.responsible_roles, responsible_note: r.responsible_note || null,
        source: r.source, difference: r.difference, published_in: r.release_version, supersedes_id: r.supersedes_id,
        status: r.retired_in ? 'RETIRED' : 'ACTIVE', retirement: r.retired_in ? { release: r.retired_in, reason: r.retired_reason } : null,
        integration: link
          ? { status: link.integration_status, operation: link.operation_code, event_type: link.event_type, story: link.story,
              proof: link.story
                ? `${link.story}: ${link.operation_code} debe rechazar la transición cuando ${r.code} resulte REQUIRED_MISSING, PRESENT_INVALID, PRESENT_NOT_VERIFIABLE o CONDITION_NOT_EVALUABLE.`
                : `Sin historia asignada (D-33): la operación ${link.operation_code} deberá demostrar el mismo bloqueo.` }
          : null,
      };
    });
  }

  async catalog(user: AuthUser, orgId: string, q: CatalogQuery) {
    await this.ctx(user, orgId);
    const conds = [q.include_retired === 'true' ? sql`TRUE` : sql`r.definition_id IS NULL`];
    if (q.cte_definition_id) conds.push(sql`k.cte_definition_id = ${q.cte_definition_id}`);
    const rows = await this.rows(sql.join(conds, sql` AND `));
    const release = (await sql`SELECT version, source, notes, published_at FROM kde_catalog_releases ORDER BY published_at DESC, version DESC LIMIT 1`.execute(this.db)).rows[0] ?? null;
    return {
      scope: 'SYSTEM', current_release: release, definitions: await this.view(rows),
      flow_requirement: { status: 'PENDING', decision: 'D-33', note: 'Esto define si un DATO es obligatorio dentro de su hito. Qué hitos son obligatorios en cada flujo sigue pendiente (D-33).' },
      legal_configuration: { status: 'NOT_ACTIVE', note: 'No hay configuración jurídica activa: los datos mínimos provienen de las fuentes técnicas.' },
      results_contract: ['PRESENT_VALID', 'PRESENT_INVALID', 'PRESENT_NOT_VERIFIABLE', 'REQUIRED_MISSING', 'OPTIONAL_MISSING', 'NOT_APPLICABLE', 'CONDITION_NOT_EVALUABLE', 'DECLARED_UNKNOWN'],
      transition_gates: await this.gates(),
    };
  }

  async definition(user: AuthUser, orgId: string, id: string) {
    await this.ctx(user, orgId);
    const [d] = await this.view(await this.rows(sql`k.id = ${id}`));
    if (!d) throw notFound();
    return d;
  }

  /** Resolución de referencias dentro de la organización y del alcance del usuario. */
  private resolver(ctx: TenantContext, dbh: Kysely<Database> | Transaction<Database> = this.db): RefResolver {
    const has = (p: string) => (ctx.permissions as string[]).includes(p);
    return async (entity, ids) => {
      const found = new Set<string>();
      const inactive = new Set<string>();
      if (ids.length === 0) return { found, inactive, verifiable: true };
      const org = ctx.organizationId;
      const scope = (perm: string) => has(`${perm}:read`) ? sql`TRUE` : has(`${perm}:read_assigned`) ? sql`pr.assigned_membership_id = ${ctx.membershipId}` : sql`FALSE`;
      let rows: Array<{ id: string; active: boolean }> = [];
      if (entity === 'producer') rows = (await sql<{ id: string; active: boolean }>`SELECT pr.id, pr.status = 'ACTIVE' AS active FROM producers pr WHERE pr.organization_id = ${org} AND pr.id = ANY(${ids}) AND ${scope('producer')}`.execute(dbh)).rows;
      else if (entity === 'plot') rows = (await sql<{ id: string; active: boolean }>`SELECT p.id, p.status = 'ACTIVE' AS active FROM plots p JOIN producers pr ON pr.id = p.producer_id AND pr.organization_id = p.organization_id WHERE p.organization_id = ${org} AND p.id = ANY(${ids}) AND ${scope('plot')}`.execute(dbh)).rows;
      else if (entity === 'plot_version') rows = (await sql<{ id: string; active: boolean }>`SELECT v.id, p.status = 'ACTIVE' AS active FROM plot_versions v JOIN plots p ON p.id = v.plot_id AND p.organization_id = v.organization_id JOIN producers pr ON pr.id = p.producer_id AND pr.organization_id = p.organization_id WHERE v.organization_id = ${org} AND v.id = ANY(${ids}) AND ${scope('plot')}`.execute(dbh)).rows;
      else if (entity === 'product') {
        if (!has('product:read')) return { found, inactive, verifiable: true };
        rows = (await sql<{ id: string; active: boolean }>`SELECT id, status = 'ACTIVE' AS active FROM products WHERE organization_id = ${org} AND id = ANY(${ids})`.execute(dbh)).rows;
      } else if (entity === 'membership') {
        // Sin membership:read solo puede referirse a sí mismo (no se revela quién más es miembro).
        const allowed = has('membership:read') ? ids : ids.filter((id) => id === ctx.membershipId);
        rows = allowed.length ? (await sql<{ id: string; active: boolean }>`SELECT id, status = 'ACTIVE' AS active FROM memberships WHERE organization_id = ${org} AND id = ANY(${allowed})`.execute(dbh)).rows : [];
      } else if (entity === 'document') {
        // Verifica la REFERENCIA (existe, organización, alcance del titular) y la disponibilidad técnica
        // (último análisis CLEAN). No aprueba el contenido: la revisión humana es aparte (P0-018).
        if (!has('document:read')) return { found, inactive, verifiable: true };
        const docs = (await sql<{ id: string; owner_type: string; owner_id: string; available: boolean }>`
          SELECT d.id, d.owner_type, d.owner_id,
                 coalesce((SELECT s.result = 'CLEAN' FROM document_version_scans s WHERE s.version_id = d.current_version_id ORDER BY s.id DESC LIMIT 1), false) AS available
          FROM documents d WHERE d.organization_id = ${org} AND d.id = ANY(${ids})`.execute(dbh)).rows;
        for (const d of docs) {
          const scopeOk = d.owner_type === 'producer'
            ? (await sql<{ n: number }>`SELECT count(*)::int AS n FROM producers pr WHERE pr.id = ${d.owner_id} AND pr.organization_id = ${org} AND ${scope('producer')}`.execute(dbh)).rows[0].n > 0
            : (await sql<{ n: number }>`SELECT count(*)::int AS n FROM plots p JOIN producers pr ON pr.id = p.producer_id AND pr.organization_id = p.organization_id WHERE p.id = ${d.owner_id} AND p.organization_id = ${org} AND ${scope('plot')}`.execute(dbh)).rows[0].n > 0;
          if (scopeOk) rows.push({ id: d.id, active: d.available });
        }
      } else if (entity === 'delivery' || entity === 'weighable' || entity === 'sample') {
        const dscope = has('delivery:read') ? sql`TRUE` : has('delivery:read_assigned') ? sql`pr.assigned_membership_id = ${ctx.membershipId}` : sql`FALSE`;
        const base = entity === 'delivery' ? sql`SELECT d.id, d.status = 'REGISTERED' AS active FROM deliveries d`
          : entity === 'weighable' ? sql`SELECT r.id, TRUE AS active FROM receptions r JOIN deliveries d ON d.id = r.delivery_id AND d.organization_id = r.organization_id`
            : sql`SELECT s.id, TRUE AS active FROM quality_samples s JOIN receptions r ON r.id = s.reception_id AND r.organization_id = s.organization_id JOIN deliveries d ON d.id = r.delivery_id AND d.organization_id = r.organization_id`;
        const col = entity === 'delivery' ? sql`d.id` : entity === 'weighable' ? sql`r.id` : sql`s.id`;
        rows = (await sql<{ id: string; active: boolean }>`${base} JOIN producers pr ON pr.id = d.producer_id AND pr.organization_id = d.organization_id
          WHERE d.organization_id = ${org} AND ${col} = ANY(${ids}) AND ${dscope}`.execute(dbh)).rows;
      } else if (entity === 'lot' || entity === 'process_run') {
        if (!has('lot:read')) return { found, inactive, verifiable: true };
        rows = entity === 'lot'
          ? (await sql<{ id: string; active: boolean }>`SELECT id, TRUE AS active FROM lots WHERE organization_id = ${org} AND id = ANY(${ids})`.execute(dbh)).rows
          : (await sql<{ id: string; active: boolean }>`SELECT id, status <> 'CANCELLED' AS active FROM process_runs WHERE organization_id = ${org} AND id = ANY(${ids})`.execute(dbh)).rows;
      } else if (entity === 'buyer' || entity === 'shipment') {
        if (!has('shipment:read')) return { found, inactive, verifiable: true };
        rows = entity === 'buyer'
          ? (await sql<{ id: string; active: boolean }>`SELECT id, status = 'ACTIVE' AS active FROM buyers WHERE organization_id = ${org} AND id = ANY(${ids})`.execute(dbh)).rows
          : (await sql<{ id: string; active: boolean }>`SELECT id, status <> 'CANCELLED' AS active FROM shipments WHERE organization_id = ${org} AND id = ANY(${ids})`.execute(dbh)).rows;
      } else if (entity === 'dd_package') {
        // Basta `shipment:read` para comprobar que la acreditación EXISTE; leer su contenido sigue exigiendo
        // `dd:read`. Solo cuenta un export de tipo DD_PACKAGE de la propia organización: un borrador interno
        // (`INTERNAL_REVIEW`) no es acreditación.
        if (!has('shipment:read') && !has('dd:read')) return { found, inactive, verifiable: true };
        rows = (await sql<{ id: string; active: boolean }>`
          SELECT id, TRUE AS active FROM dd_exports
          WHERE organization_id = ${org} AND kind = 'DD_PACKAGE' AND id = ANY(${ids})`.execute(dbh)).rows;
      } else if (entity === 'location') {
        if (!has('location:read')) return { found, inactive, verifiable: true };
        rows = (await sql<{ id: string; active: boolean }>`SELECT id, status = 'ACTIVE' AS active FROM locations WHERE organization_id = ${org} AND id = ANY(${ids})`.execute(dbh)).rows;
      } else return { found, inactive, verifiable: false };
      for (const r of rows) { found.add(r.id); if (!r.active) inactive.add(r.id); }
      return { found, inactive, verifiable: true };
    };
  }

  /** Compuertas vigentes por transición (última versión publicada de cada transición). */
  async gates() {
    const rows = (await sql<{ transition: string; kde_code: string | null; mode: string; note: string; release_version: string }>`
      SELECT g.transition, g.kde_code, g.mode, g.note, g.release_version FROM kde_transition_gates g
      WHERE g.release_version = (SELECT x.release_version FROM kde_transition_gates x WHERE x.transition = g.transition ORDER BY x.id DESC LIMIT 1)
      ORDER BY g.transition, g.id`.execute(this.db)).rows;
    const out: Record<string, { release: string; checks: Array<{ kde: string | null; mode: string; note: string }> }> = {};
    for (const r of rows) (out[r.transition] ??= { release: r.release_version, checks: [] }).checks.push({ kde: r.kde_code, mode: r.mode, note: r.note });
    return out;
  }

  /**
   * P0-012 — evalúa la compuerta de una transición con los KDE vigentes. BLOCKING exige PRESENT_VALID
   * (o NOT_APPLICABLE / OPTIONAL_MISSING); PENDING_ALLOWED nunca bloquea pero todo lo que no sea válido queda
   * como pendiente visible; NOT_EVALUATED se informa sin decidir. Los valores no se registran ni se devuelven.
   */
  async evaluateTransition(ctx: TenantContext, transition: string, values: Record<string, unknown>, dbh: Kysely<Database> | Transaction<Database> = this.db) {
    const gate = (await this.gates())[transition];
    if (!gate) throw new Error(`Compuerta ${transition} no publicada`);
    const active = await this.rows(sql`r.definition_id IS NULL`);
    const toDef = (r: Row): KdeDef => ({ id: r.id, code: r.code, version: r.version, value_type: r.value_type, requirement: r.requirement, condition: r.condition, validation: r.validation });
    const all = new Map(active.map((r) => [r.code, toDef(r)]));
    const names = new Map(active.map((r) => [r.code, r.name]));
    const checks = gate.checks.filter((c) => c.kde);
    const defs = checks.filter((c) => c.mode === 'BLOCKING' || c.mode === 'PENDING_ALLOWED').map((c) => all.get(c.kde!)).filter((d): d is KdeDef => !!d);
    const { items } = await validateKde(defs, values, this.resolver(ctx, dbh), all);
    const byCode = new Map(items.map((i) => [i.code, i]));
    const ok = (r: string) => r === 'PRESENT_VALID' || r === 'NOT_APPLICABLE' || r === 'OPTIONAL_MISSING';
    const blocking: Array<{ code: string; name: string; result: string; error_code: string | null; message: string }> = [];
    const pending: typeof blocking = [];
    const notEvaluated: Array<{ code: string | null; name: string | null; note: string }> = [];
    for (const c of gate.checks) {
      if (c.mode === 'NOT_EVALUATED') { notEvaluated.push({ code: c.kde, name: c.kde ? names.get(c.kde) ?? c.kde : null, note: c.note }); continue; }
      // Transición bloqueada por una decisión pendiente: bloquea aunque los datos estén presentes; no vuelve opcional el dato.
      if (c.mode === 'BLOCKED_PENDING_DECISION') { blocking.push({ code: c.kde ?? 'DECISION_PENDING', name: c.note, result: 'DECISION_PENDING', error_code: 'DECISION_PENDING', message: c.note }); continue; }
      const i = byCode.get(c.kde!);
      if (!i || ok(i.result)) continue;
      const entry = { code: i.code, name: names.get(i.code) ?? i.code, result: i.result, error_code: i.error_code, message: i.message };
      (c.mode === 'BLOCKING' ? blocking : pending).push(entry);
    }
    return { transition, release: gate.release, allowed: blocking.length === 0, blocking, pending, not_evaluated: notEvaluated, evaluated_at: new Date().toISOString() };
  }

  async validate(user: AuthUser, orgId: string, dto: ValidateDto) {
    const ctx = await this.ctx(user, orgId);
    const cte = (await sql<{ id: string; code: string; version: number; retired: boolean }>`
      SELECT c.id, c.code, c.version, EXISTS (SELECT 1 FROM cte_definition_retirements t WHERE t.definition_id = c.id) AS retired
      FROM cte_definitions c WHERE c.id = ${dto.cte_definition_id}`.execute(this.db)).rows[0];
    if (!cte) throw notFound();
    if (cte.retired) throw conflict('CTE_DEFINITION_RETIRED', `La versión ${cte.code}@${cte.version} del hito está retirada: una operación nueva debe usar la versión vigente.`);
    const active = await this.rows(sql`r.definition_id IS NULL`);
    const own = active.filter((r) => r.cte_definition_id === cte.id);
    if (own.length === 0) throw new AppError(422, 'KDE_SET_EMPTY', 'Este hito no tiene datos mínimos vigentes publicados.');
    const toDef = (r: Row): KdeDef => ({ id: r.id, code: r.code, version: r.version, value_type: r.value_type, requirement: r.requirement, condition: r.condition, validation: r.validation });
    const all = new Map(active.map((r) => [r.code, toDef(r)]));
    const codes = new Set(all.keys());
    const keys = Object.keys(dto.values ?? {});
    const unknown = keys.filter((k) => !codes.has(k));
    const result = await validateKde(own.map(toDef), dto.values ?? {}, this.resolver(ctx), all);
    return {
      cte: { id: cte.id, reference: `${cte.code}@${cte.version}` },
      kde_release: (await sql<{ version: string }>`SELECT version FROM kde_catalog_releases ORDER BY published_at DESC, version DESC LIMIT 1`.execute(this.db)).rows[0]?.version,
      ...result,
      // solo nombres con formato de código; nunca valores
      unknown_fields: unknown.filter((k) => /^[A-Z][A-Z0-9_]{1,59}$/.test(k)),
      unknown_fields_other: unknown.filter((k) => !/^[A-Z][A-Z0-9_]{1,59}$/.test(k)).length,
      persisted: false,
      note: 'Resultado de validación; no registra una operación. La compuerta solo se integrará en la operación de la historia correspondiente.',
    };
  }
}

@ApiTags('traceability')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class KdeController {
  constructor(private readonly service: KdeService) {}

  @Get('kde-catalog')
  catalog(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: CatalogQuery) {
    return this.service.catalog(user, orgId, q);
  }

  @Get('kde-definitions/:id')
  definition(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.definition(user, orgId, id);
  }

  @Post('kde/validate')
  @HttpCode(200)
  validate(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: ValidateDto) {
    return this.service.validate(user, orgId, dto);
  }
}
