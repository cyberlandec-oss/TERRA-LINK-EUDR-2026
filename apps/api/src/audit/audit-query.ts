import { Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { createHash } from 'crypto';
import type { Response } from 'express';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, forbidden, notFound } from '../common/errors';
import { AuditService } from './audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';

// P0-025 Consulta y exportación de la bitácora (`audit_logs`, append-only). No es un sistema paralelo: lee la misma
// tabla que escriben los casos de uso. Auditoría ≠ eventos de dominio (`domain_events`) ≠ intentos de entrega del
// outbox (`event_delivery_attempts`); aquí solo se consulta la auditoría.
//
// Alcance: además de `audit:read`, cada fila exige poder leer su recurso (productor/parcela asignados, documento por
// titular, afirmación por entidad, producto por permiso). El filtro va en SQL, así que totales y páginas nunca
// cuentan filas fuera de alcance. Redacción: lista blanca de campos por tipo de registro, aplicada solo a la
// presentación; la fila original no se modifica.

export const AUDIT_EXPORT_FORMAT = 'TL_AUDIT_CSV 0.1 (provisional)';
export const AUDIT_EXPORT_MAX_ROWS = 5000;
const RESULTS = ['SUCCESS', 'DENIED', 'FAILED'] as const;

const COMMON = ['status', 'from_status', 'reason', 'changed_fields', 'version', 'version_number', 'row_version', 'roles', 'added', 'removed', 'role_code'];
/** Campos presentables por tipo de registro. Todo lo demás se omite (se informa el nombre, nunca el valor). */
const ALLOWED: Record<string, string[]> = {
  organization: ['name', 'legal_name', 'tax_id', 'province', 'canton', 'parish', 'status_reason'],
  membership: ['user_id'],
  invitation: ['email', 'expires_at', 'membership_id', 'user_created', 'membership_reactivated'],
  user: ['sessions_revoked'],
  producer: ['producer_code', 'assigned_membership_id', 'corrected_event_id', 'correction_event_id'],
  producer_match_review: ['producer_a_id', 'producer_b_id', 'rule_code'],
  plot: ['plot_code', 'producer_id', 'crop', 'plot_version_id', 'geometry_type', 'survey_method', 'format', 'import_id', 'byte_size', 'positions', 'sha256', 'technically_valid', 'draft_id', 'accuracy_reported', 'acquisition_seq', 'evaluation_id', 'rule', 'relations', 'location_sample_id', 'source'],
  product: ['code', 'name', 'product_state', 'scientific_name', 'unit', 'variety'],
  document: ['version_id', 'document_type', 'owner_type', 'size_bytes', 'sha256', 'scan', 'scan_error', 'result', 'engine', 'signature', 'error_code', 'decision', 'entity_type', 'entity_id'],
  evidence: ['entity_id', 'document_version_id', 'relationship', 'source_id'],
  event_delivery: ['event_id', 'consumer', 'attempts'],
  audit: ['format_version', 'row_count', 'sha256', 'filters'],
  delivery: ['delivery_code', 'reception_id', 'sample_id', 'result_id', 'quantity', 'unit', 'location_id', 'product_id', 'support_id', 'document_version_id', 'support_kind', 'moment', 'decision', 'limits_version', 'pending', 'corrected_event_id', 'version'],
  location: ['code', 'name', 'location_type'],
  lot: ['code', 'product_id', 'origin_status', 'reception_id', 'weighing_id', 'quantity', 'unit', 'reason'],
  organization_stock: ['created', 'unresolved'],
  process_run: ['code', 'process_type', 'output_product_id', 'reserved', 'input', 'output', 'loss', 'unit', 'pending', 'reason'],
};
/** Nunca se presentan, aunque un registro antiguo los contuviera (secretos, enlaces, coordenadas, contenido). */
const NEVER = /token|password|secret|hash(?!.*sha)|key|link|url|coordinates|geometry|^lat|^lon|latitude|longitude|vertices|content$/i;
const OBJECT_KEYS = new Set(['relations', 'filters']);

class AuditFilters {
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[a-z_]{2,40}$/) entity_type?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() entity_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[a-z_]{2,40}(\.[a-z_]{2,60})?$/) action?: string;
  @ApiPropertyOptional({ description: 'Id de membresía o PLATFORM' }) @IsOptional() @IsString() @Matches(/^(PLATFORM|[0-9a-f-]{36})$/i) actor?: string;
  @ApiPropertyOptional({ enum: RESULTS }) @IsOptional() @IsIn(RESULTS as unknown as string[]) result?: (typeof RESULTS)[number];
  @ApiPropertyOptional({ description: 'Identificador de correlación (request id)' }) @IsOptional() @IsString() @Length(1, 100) request_id?: string;
}
class AuditListQuery extends AuditFilters {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiPropertyOptional({ description: 'Cursor opaco de la página anterior' }) @IsOptional() @IsUUID() cursor?: string;
}

type Row = {
  id: string; action: string; entity_type: string; entity_id: string | null; result: string; reason: string | null;
  before: unknown; after: unknown; occurred_at: Date; request_id: string | null; actor_key: string | null; first_name: string | null; last_name: string | null; email: string | null;
};

@Injectable()
export class AuditQueryService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private async ctx(user: AuthUser, orgId: string, perm: 'audit:read' | 'audit:export') {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!(ctx.permissions as string[]).includes(perm)) throw forbidden();
    return ctx;
  }

  /** Predicado SQL de alcance por recurso; se evalúa por fila dentro de la organización. */
  private scope(ctx: TenantContext): RawBuilder<boolean> {
    const has = (p: Permission) => ctx.permissions.includes(p);
    const org = ctx.organizationId;
    const me = ctx.membershipId;
    const producerVisible = (id: RawBuilder<unknown>) => has('producer:read') ? sql<boolean>`TRUE`
      : has('producer:read_assigned') ? sql<boolean>`EXISTS (SELECT 1 FROM producers p WHERE p.id = ${id} AND p.organization_id = ${org} AND p.assigned_membership_id = ${me})`
      : sql<boolean>`FALSE`;
    const plotVisible = (id: RawBuilder<unknown>) => has('plot:read') ? sql<boolean>`TRUE`
      : has('plot:read_assigned') ? sql<boolean>`EXISTS (SELECT 1 FROM plots pl JOIN producers p ON p.id = pl.producer_id AND p.organization_id = pl.organization_id
          WHERE pl.id = ${id} AND pl.organization_id = ${org} AND p.assigned_membership_id = ${me})`
      : sql<boolean>`FALSE`;
    const orgWide = has('producer:read') && has('plot:read');
    const documentVisible = has('document:read')
      ? sql<boolean>`(a.entity_id IS NULL AND ${orgWide ? sql`TRUE` : sql`FALSE`}) OR EXISTS (SELECT 1 FROM documents d WHERE d.id = a.entity_id AND d.organization_id = ${org}
          AND ((d.owner_type = 'producer' AND ${producerVisible(sql`d.owner_id`)}) OR (d.owner_type = 'plot' AND ${plotVisible(sql`d.owner_id`)})))`
      : sql<boolean>`FALSE`;
    const evidenceVisible = has('evidence:read')
      ? sql<boolean>`EXISTS (SELECT 1 FROM evidence e WHERE e.id = a.entity_id AND e.organization_id = ${org}
          AND ((e.entity_type = 'producer' AND ${producerVisible(sql`e.entity_id`)}) OR (e.entity_type = 'plot' AND ${plotVisible(sql`e.entity_id`)})))`
      : sql<boolean>`FALSE`;
    const deliveryVisible = has('delivery:read') ? sql<boolean>`TRUE`
      : has('delivery:read_assigned') ? sql<boolean>`EXISTS (SELECT 1 FROM deliveries dl JOIN producers p ON p.id = dl.producer_id AND p.organization_id = dl.organization_id
          WHERE dl.id = a.entity_id AND dl.organization_id = ${org} AND p.assigned_membership_id = ${me})`
      : sql<boolean>`FALSE`;
    return sql<boolean>`(CASE a.entity_type
      WHEN 'producer' THEN ${producerVisible(sql`a.entity_id`)}
      WHEN 'producer_match_review' THEN ${has('producer:read') ? sql`TRUE` : sql`FALSE`}
      WHEN 'plot' THEN ${plotVisible(sql`a.entity_id`)}
      WHEN 'document' THEN ${documentVisible}
      WHEN 'evidence' THEN ${evidenceVisible}
      WHEN 'product' THEN ${has('product:read') ? sql`TRUE` : sql`FALSE`}
      WHEN 'delivery' THEN ${deliveryVisible}
      WHEN 'lot' THEN ${has('lot:read') ? sql`TRUE` : sql`FALSE`}
      WHEN 'process_run' THEN ${has('lot:read') ? sql`TRUE` : sql`FALSE`}
      ELSE TRUE END)`;
  }

  private base(ctx: TenantContext, f: AuditFilters) {
    if (f.from && f.to && new Date(f.from) > new Date(f.to)) throw new AppError(400, 'VALIDATION_FAILED', 'El inicio del período es posterior al final.', [{ field: 'to', reason: 'BEFORE_FROM' }]);
    let q = this.db.selectFrom('audit_logs as a')
      .leftJoin('memberships as m', (j) => j.onRef('m.user_id', '=', 'a.actor_user_id').onRef('m.organization_id', '=', 'a.organization_id'))
      .leftJoin('users as u', 'u.id', 'm.user_id')
      .where('a.organization_id', '=', ctx.organizationId)
      .where(this.scope(ctx));
    if (f.from) q = q.where('a.occurred_at', '>=', new Date(f.from));
    if (f.to) q = q.where('a.occurred_at', '<=', new Date(f.to));
    if (f.entity_type) q = q.where('a.entity_type', '=', f.entity_type);
    if (f.entity_id) q = q.where('a.entity_id', '=', f.entity_id);
    if (f.action) q = f.action.includes('.') ? q.where('a.action', '=', f.action) : q.where('a.action', 'like', `${f.action}.%`);
    if (f.result) q = q.where('a.result', '=', f.result);
    if (f.request_id) q = q.where('a.request_id', '=', f.request_id);
    if (f.actor) q = f.actor.toUpperCase() === 'PLATFORM' ? q.where('m.id', 'is', null) : q.where('m.id', '=', f.actor);
    return q;
  }

  private select(q: ReturnType<AuditQueryService['base']>) {
    return q.select(['a.id', 'a.action', 'a.entity_type', 'a.entity_id', 'a.result', 'a.reason', 'a.before', 'a.after', 'a.occurred_at', 'a.request_id', 'm.id as actor_key', 'u.first_name', 'u.last_name', 'u.email']);
  }

  /** Soportes de evidencia legibles para el usuario (los demás se redactan como en P0-019). */
  private async readableVersions(ctx: TenantContext, rows: Row[]): Promise<Set<string>> {
    const ids = new Set<string>();
    const sources = new Set<string>();
    for (const r of rows) for (const part of [r.before, r.after]) {
      if (part && typeof part === 'object') {
        const o = part as Record<string, unknown>;
        if (r.entity_type === 'evidence' && typeof o.document_version_id === 'string') ids.add(o.document_version_id);
        if (r.entity_type === 'evidence' && typeof o.source_id === 'string') sources.add(o.source_id);
      }
    }
    if ((!ids.size && !sources.size) || !ctx.permissions.includes('document:read')) return new Set();
    const has = (p: Permission) => ctx.permissions.includes(p);
    const visible = await sql<{ version_id: string; source_id: string | null }>`
      SELECT v.id AS version_id, s.id AS source_id FROM document_versions v
      JOIN documents d ON d.id = v.document_id AND d.organization_id = v.organization_id
      LEFT JOIN evidence_sources s ON s.document_version_id = v.id AND s.organization_id = v.organization_id
      LEFT JOIN producers p ON d.owner_type = 'producer' AND p.id = d.owner_id
      LEFT JOIN plots pl ON d.owner_type = 'plot' AND pl.id = d.owner_id
      LEFT JOIN producers pp ON pp.id = pl.producer_id
      WHERE v.organization_id = ${ctx.organizationId}
        AND (v.id = ANY(${[...ids]}::uuid[]) OR s.id = ANY(${[...sources]}::uuid[]))
        AND ((d.owner_type = 'producer' AND (${has('producer:read')} OR p.assigned_membership_id = ${ctx.membershipId}))
          OR (d.owner_type = 'plot' AND (${has('plot:read')} OR pp.assigned_membership_id = ${ctx.membershipId})))`.execute(this.db);
    const out = new Set<string>();
    for (const v of visible.rows) { out.add(v.version_id); if (v.source_id) out.add(v.source_id); }
    return out;
  }

  /** Redacción de presentación: devuelve una copia; nunca altera la fila original. */
  redact(ctx: TenantContext, r: Row, readable: Set<string>) {
    const allowed = new Set([...COMMON, ...(ALLOWED[r.entity_type] ?? [])]);
    const omitted = new Set<string>();
    const can = (p: Permission) => ctx.permissions.includes(p);
    const clean = (part: unknown): Record<string, unknown> | null => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) return null;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(part as Record<string, unknown>)) {
        if (NEVER.test(k) && k !== 'sha256') { omitted.add(k); continue; }
        if (!allowed.has(k)) { omitted.add(k); continue; }
        if (k === 'email' && !can('membership:read')) { omitted.add(k); continue; }
        if (k === 'relations' && !can('plot:read')) { omitted.add(k); continue; }
        if (r.entity_type === 'evidence' && (k === 'document_version_id' || k === 'source_id') && !readable.has(String(v))) { omitted.add(k); continue; }
        if (r.entity_type === 'delivery' && k === 'document_version_id' && !can('document:read')) { omitted.add(k); continue; }
        if (r.entity_type === 'evidence' && k === 'reason' && typeof (part as Record<string, unknown>).source_id === 'string' && !readable.has(String((part as Record<string, unknown>).source_id))) { omitted.add(k); continue; }
        if (v !== null && typeof v === 'object' && !Array.isArray(v) && !OBJECT_KEYS.has(k)) { omitted.add(k); continue; }
        if (Array.isArray(v) && v.some((x) => x !== null && typeof x === 'object')) { omitted.add(k); continue; }
        out[k] = typeof v === 'string' ? v.slice(0, 500) : v;
      }
      return out;
    };
    const before = clean(r.before);
    const after = clean(r.after);
    const label = r.actor_key ? (`${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || 'Miembro') : 'Administración de plataforma';
    return {
      id: r.id, occurred_at: r.occurred_at, action: r.action, entity_type: r.entity_type, entity_id: r.entity_id, result: r.result,
      reason: r.reason, request_id: r.request_id,
      actor: { key: r.actor_key ?? 'PLATFORM', label, ...(r.actor_key && can('membership:read') ? { email: r.email } : {}) },
      before, after, redacted_fields: [...omitted].sort(),
    };
  }

  async list(user: AuthUser, orgId: string, q: AuditListQuery) {
    const ctx = await this.ctx(user, orgId, 'audit:read');
    const limit = q.limit ?? 50;
    const total = (await this.base(ctx, q).select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow()).n;
    let page = this.select(this.base(ctx, q));
    if (q.cursor) {
      const c = await this.db.selectFrom('audit_logs').select('id').where('id', '=', q.cursor).where('organization_id', '=', ctx.organizationId).executeTakeFirst();
      if (!c) throw new AppError(400, 'INVALID_CURSOR', 'El cursor de paginación no es válido; vuelve a la primera página.', [{ field: 'cursor', reason: 'UNKNOWN' }]);
      // Comparación en SQL: conserva los microsegundos de occurred_at (un Date de JS los truncaría y saltaría filas).
      page = page.where(sql<boolean>`(a.occurred_at, a.id) < (SELECT c.occurred_at, c.id FROM audit_logs c WHERE c.id = ${c.id})`);
    }
    const rows = (await page.orderBy('a.occurred_at', 'desc').orderBy('a.id', 'desc').limit(limit + 1).execute()) as Row[];
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    const readable = await this.readableVersions(ctx, items);
    return { items: items.map((r) => this.redact(ctx, r, readable)), total, next_cursor: more ? items[items.length - 1].id : null, limit };
  }

  async detail(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, 'audit:read');
    const row = (await this.select(this.base(ctx, {})).where('a.id', '=', id).executeTakeFirst()) as Row | undefined;
    if (!row) throw notFound();
    // Historia del mismo recurso y operación correlacionada (mismo request id), siempre dentro del alcance.
    const timeline = row.entity_id
      ? ((await this.select(this.base(ctx, { entity_type: row.entity_type, entity_id: row.entity_id })).orderBy('a.occurred_at', 'asc').orderBy('a.id', 'asc').limit(100).execute()) as Row[])
      : [row];
    const correlated = row.request_id
      ? ((await this.select(this.base(ctx, { request_id: row.request_id })).where('a.id', '<>', row.id).orderBy('a.occurred_at', 'asc').limit(20).execute()) as Row[])
      : [];
    const readable = await this.readableVersions(ctx, [row, ...timeline, ...correlated]);
    const view = this.redact(ctx, row, readable);
    const a = (view.after ?? {}) as Record<string, unknown>;
    return {
      record: view,
      timeline: timeline.map((r) => this.redact(ctx, r, readable)),
      correlated: correlated.map((r) => this.redact(ctx, r, readable)),
      links: {
        corrects_event_id: typeof a.corrected_event_id === 'string' ? a.corrected_event_id : null,
        correction_event_id: typeof a.correction_event_id === 'string' ? a.correction_event_id : null,
        version_id: (a.version_id ?? a.plot_version_id ?? null) as string | null,
      },
    };
  }

  async facets(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, 'audit:read');
    const b = () => this.base(ctx, {});
    const actions = await b().select('a.action').distinct().orderBy('a.action').execute();
    const types = await b().select('a.entity_type').distinct().orderBy('a.entity_type').execute();
    const actors = await b().select(['m.id as key', 'u.first_name', 'u.last_name']).distinct().execute();
    return {
      actions: actions.map((r) => r.action), entity_types: types.map((r) => r.entity_type),
      actors: actors.map((r) => ({ key: r.key ?? 'PLATFORM', label: r.key ? (`${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || 'Miembro') : 'Administración de plataforma' }))
        .sort((x, y) => x.label.localeCompare(y.label, 'es')),
      results: RESULTS,
    };
  }

  /** Exportación CSV con la misma consulta, alcance y redacción; auditada; entregada en la respuesta (sin enlace). */
  async export(user: AuthUser, orgId: string, f: AuditFilters, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'audit:export');
    if (!(ctx.permissions as string[]).includes('audit:read')) throw forbidden();
    const total = (await this.base(ctx, f).select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow()).n;
    if (total > AUDIT_EXPORT_MAX_ROWS) {
      throw new AppError(422, 'EXPORT_TOO_LARGE', `La exportación supera el máximo de ${AUDIT_EXPORT_MAX_ROWS} registros (${total}). Acota el período o los filtros.`, [{ field: 'from', reason: 'TOO_MANY_ROWS' }]);
    }
    const rows = (await this.select(this.base(ctx, f)).orderBy('a.occurred_at', 'asc').orderBy('a.id', 'asc').execute()) as Row[];
    const readable = await this.readableVersions(ctx, rows);
    const views = rows.map((r) => this.redact(ctx, r, readable));
    const org = await this.db.selectFrom('organizations').select('name').where('id', '=', ctx.organizationId).executeTakeFirstOrThrow();
    const generatedAt = new Date().toISOString();
    const filters = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== ''));
    const meta = [
      ['formato', AUDIT_EXPORT_FORMAT], ['organizacion', org.name], ['organizacion_id', ctx.organizationId],
      ['periodo_desde', f.from ?? 'sin límite'], ['periodo_hasta', f.to ?? 'sin límite'], ['filtros', JSON.stringify(filters)],
      ['generado', generatedAt], ['registros', String(views.length)], ['limite_registros', String(AUDIT_EXPORT_MAX_ROWS)],
      ['nota', 'Campos redactados según el permiso de quien exporta. No es un expediente regulatorio ni acredita conformidad.'],
    ];
    const header = ['occurred_at', 'action', 'entity_type', 'entity_id', 'result', 'actor', 'request_id', 'reason', 'before', 'after', 'redacted_fields'];
    const lines = [
      ...meta.map(([k, v]) => `# ${csvCell(k)},${csvCell(v)}`), header.join(','),
      ...views.map((v) => [new Date(v.occurred_at).toISOString(), v.action, v.entity_type, v.entity_id ?? '', v.result, v.actor.label, v.request_id ?? '', v.reason ?? '',
        v.before ? JSON.stringify(v.before) : '', v.after ? JSON.stringify(v.after) : '', v.redacted_fields.join(' ')].map(csvCell).join(',')),
    ];
    const body = Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    await this.audit.record(this.db, {
      organizationId: ctx.organizationId, actorUserId: user.id, action: 'audit.export', entityType: 'audit', entityId: null, requestId, result: 'SUCCESS',
      after: { format_version: AUDIT_EXPORT_FORMAT, row_count: views.length, sha256, filters },
    });
    return { body, sha256, fileName: `auditoria-${generatedAt.slice(0, 10)}.csv`, rows: views.length };
  }
}

/** Celda CSV: comillas y neutralización de fórmulas (=, +, -, @, tab, CR) solo en el archivo; la bitácora conserva el valor original. */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) || v !== value ? `"${v.replace(/"/g, '""')}"` : v;
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class AuditController {
  constructor(private readonly service: AuditQueryService) {}

  @Get('audit-logs')
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: AuditListQuery) {
    return this.service.list(user, orgId, q);
  }

  @Get('audit-logs/facets')
  facets(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.facets(user, orgId);
  }

  @Get('audit-logs/export')
  async export(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: AuditFilters, @Req() req: AuthedRequest, @Res() res: Response) {
    const r = await this.service.export(user, orgId, q, req.requestId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${r.fileName}"`);
    res.setHeader('X-Content-SHA256', r.sha256);
    res.setHeader('X-Export-Format', AUDIT_EXPORT_FORMAT);
    res.setHeader('X-Export-Rows', String(r.rows));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(r.body);
  }

  @Get('audit-logs/:id')
  detail(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(user, orgId, id);
  }
}
