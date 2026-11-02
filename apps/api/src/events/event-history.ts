import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { ProducersService } from '../producers/producers';
import { PlotsService } from '../plots/plots';

// P0-015 — historial causal por agregado y reproceso manual de entregas DEAD (alcance de la organización).
// Historial: se autoriza sobre el RECURSO real (productor, parcela, producto) con su alcance efectivo;
// solo se devuelven campos permitidos por tipo de evento (lista blanca). Un tipo desconocido no expone
// ningún campo del payload. Actores: nombre si es o fue miembro de la organización; si no, una etiqueta.
// Concesiones externas y elevación de plataforma siguen pendientes (P0-003).

const ALLOWED_FIELDS: Record<string, string[]> = {
  ProducerRegistered: ['producer_code', 'status'],
  ProducerUpdated: ['changed_fields'],
  ProducerUpdateCorrected: ['changed_fields', 'corrected_event_id'],
  ProducerAssigned: [],
  ProducerStatusChanged: ['from_status', 'to_status'],
  PlotRegistered: ['plot_code'],
  PlotUpdated: ['changed_fields'],
  PlotStatusChanged: ['from_status', 'to_status'],
  PlotGeometryVersionCreated: ['version_number', 'geometry_type', 'survey_method', 'technically_valid'],
  PlotDeclaredAreaUpdated: ['version_number', 'change_kind', 'geometry_origin_version_id'],
  ProductCreated: ['code', 'status', 'changed_fields'],
  ProductUpdated: ['code', 'status', 'changed_fields'],
  ProductDeactivated: ['code', 'status'],
  ProductActivated: ['code', 'status'],
};
const AGGREGATES = { producers: 'PRODUCER', plots: 'PLOT', products: 'PRODUCT' } as const;

class HistoryQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(40) cursor?: string;
}
class RequeueDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
class DeliveriesQuery {
  @IsOptional() @IsIn(['DEAD', 'FAILED', 'PENDING', 'PROCESSING']) status?: 'DEAD' | 'FAILED' | 'PENDING' | 'PROCESSING';
}

@Injectable()
export class EventHistoryService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly producers: ProducersService,
    private readonly plots: PlotsService,
  ) {}

  private async ctx(user: AuthUser, orgId: string): Promise<TenantContext> {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    return ctx;
  }

  /** Autoriza la lectura del recurso con su alcance efectivo (reasignación o membresía inactiva → sin acceso). */
  private async authorizeAggregate(ctx: TenantContext, kind: keyof typeof AGGREGATES, id: string) {
    const has = (p: string) => (ctx.permissions as string[]).includes(p);
    if (kind === 'producers') {
      if (!has('producer:read') && !has('producer:read_assigned') && !has('producer:read_own')) throw forbidden();
      await this.producers.load(this.db, ctx, id, 'read');
    } else if (kind === 'plots') {
      if (!has('plot:read') && !has('plot:read_assigned') && !has('plot:read_own')) throw forbidden();
      await this.plots.load(this.db, ctx, id, 'read');
    } else {
      if (!has('product:read')) throw forbidden();
      const p = await this.db.selectFrom('products').select('id').where('organization_id', '=', ctx.organizationId).where('id', '=', id).executeTakeFirst();
      if (!p) throw notFound();
    }
  }

  async history(user: AuthUser, orgId: string, kind: string, id: string, q: HistoryQuery) {
    if (!(kind in AGGREGATES)) throw notFound();
    const ctx = await this.ctx(user, orgId);
    await this.authorizeAggregate(ctx, kind as keyof typeof AGGREGATES, id);
    const limit = q.limit ?? 25;
    const before = q.cursor ? Number(q.cursor) : null;
    if (q.cursor && (!Number.isInteger(before) || before! < 1)) throw new AppError(400, 'VALIDATION_FAILED', 'Cursor no válido.');
    const rows = await sql<{
      event_id: string; event_type: string; schema_version: number; aggregate_version: string; occurred_at: string; recorded_at: string;
      payload: Record<string, unknown>; correction_of_event_id: string | null; correction_reason: string | null; corrected_by: string | null;
      actor_first: string | null; actor_last: string | null; actor_member: boolean; actor_platform: boolean; actor_present: boolean;
      original_type: string | null; original_version: string | null;
    }>`
      SELECT e.event_id, e.event_type, e.schema_version, e.aggregate_version::text, e.occurred_at, e.recorded_at, e.payload,
             e.correction_of_event_id, e.correction_reason,
             (SELECT c.event_id FROM domain_events c WHERE c.correction_of_event_id = e.event_id AND c.organization_id = e.organization_id) AS corrected_by,
             u.first_name AS actor_first, u.last_name AS actor_last,
             EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = e.actor_id AND m.organization_id = e.organization_id) AS actor_member,
             (u.platform_role IS NOT NULL) AS actor_platform, (e.actor_id IS NOT NULL) AS actor_present,
             o.event_type AS original_type, o.aggregate_version::text AS original_version
      FROM domain_events e
      LEFT JOIN users u ON u.id = e.actor_id
      LEFT JOIN domain_events o ON o.event_id = e.correction_of_event_id AND o.organization_id = e.organization_id
      WHERE e.organization_id = ${orgId} AND e.aggregate_type = ${AGGREGATES[kind as keyof typeof AGGREGATES]} AND e.aggregate_id = ${id}
        ${before ? sql`AND e.aggregate_version < ${before}` : sql``}
      ORDER BY e.aggregate_version DESC LIMIT ${limit + 1}`.execute(this.db);
    const page = rows.rows.slice(0, limit);
    return {
      items: page.map((r) => {
        const allowed = ALLOWED_FIELDS[r.event_type] ?? [];
        const data = Object.fromEntries(allowed.filter((k) => r.payload && k in r.payload).map((k) => [k, r.payload[k]]));
        return {
          event_id: r.event_id, event_type: r.event_type, schema_version: r.schema_version, aggregate_version: Number(r.aggregate_version),
          occurred_at: r.occurred_at, recorded_at: r.recorded_at,
          actor: !r.actor_present ? { kind: 'SYSTEM', display: 'Sistema' }
            : r.actor_member ? { kind: 'MEMBER', display: `${r.actor_first ?? ''} ${r.actor_last ?? ''}`.trim() || 'Miembro' }
              : r.actor_platform ? { kind: 'PLATFORM', display: 'Administración de plataforma' } : { kind: 'EXTERNAL', display: 'Usuario externo' },
          data, known_type: r.event_type in ALLOWED_FIELDS,
          correction_of: r.correction_of_event_id ? { event_id: r.correction_of_event_id, event_type: r.original_type, aggregate_version: Number(r.original_version), reason: r.correction_reason } : null,
          corrected_by_event_id: r.corrected_by,
          correctable: r.event_type === 'ProducerUpdated' || r.event_type === 'ProducerUpdateCorrected',
        };
      }),
      next_cursor: rows.rows.length > limit ? String(page[page.length - 1].aggregate_version) : null,
    };
  }

  // ---------- Reproceso manual de entregas DEAD ----------

  private async reprocessCtx(user: AuthUser, orgId: string, mutation: boolean) {
    const ctx = await this.ctx(user, orgId);
    if (!(ctx.permissions as string[]).includes('events:reprocess')) throw forbidden();
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }

  async deliveries(user: AuthUser, orgId: string, q: DeliveriesQuery) {
    await this.reprocessCtx(user, orgId, false);
    const rows = await sql<{ event_id: string; consumer: string; status: string; attempts: number; manual_requeues: number; last_error: string | null; next_attempt_at: string; event_type: string; aggregate_type: string; recorded_at: string }>`
      SELECT d.event_id, d.consumer, d.status, d.attempts, d.manual_requeues, d.last_error, d.next_attempt_at, e.event_type, e.aggregate_type, e.recorded_at
      FROM event_deliveries d JOIN domain_events e ON e.event_id = d.event_id
      WHERE e.organization_id = ${orgId} AND d.status = ${q.status ?? 'DEAD'}
      ORDER BY e.recorded_at DESC, d.event_id, d.consumer LIMIT 100`.execute(this.db);
    const out = [];
    for (const r of rows.rows) {
      const history = await this.db.selectFrom('event_delivery_attempts').select(['attempt', 'outcome', 'error_code', 'recorded_at', 'reason'])
        .where('event_id', '=', r.event_id).where('consumer', '=', r.consumer).orderBy('id', 'desc').limit(10).execute();
      out.push({ ...r, attempt_history: history });
    }
    return out;
  }

  /**
   * Vuelve a encolar una entrega DEAD (misma identidad de evento y entrega, mismos recibos). No crea
   * eventos ni borra recibos: el worker la reclama de nuevo y el consumo idempotente evita duplicar efectos.
   * Concede un intento adicional (los intentos acumulados se conservan). Atómico frente a otra solicitud.
   */
  async requeue(user: AuthUser, orgId: string, eventId: string, consumer: string, dto: RequeueDto, requestId?: string) {
    await this.reprocessCtx(user, orgId, true);
    return this.db.transaction().execute(async (trx) => {
      const found = await sql<{ status: string; attempts: number }>`
        SELECT d.status, d.attempts FROM event_deliveries d JOIN domain_events e ON e.event_id = d.event_id
        WHERE d.event_id = ${eventId} AND d.consumer = ${consumer} AND e.organization_id = ${orgId} FOR UPDATE OF d`.execute(trx);
      const d = found.rows[0];
      if (!d) throw notFound();
      if (d.status !== 'DEAD') throw conflict('DELIVERY_NOT_DEAD', 'Solo se reprocesan entregas en estado DEAD.');
      await trx.updateTable('event_deliveries')
        .set({ status: 'PENDING', next_attempt_at: new Date(), locked_by: null, locked_until: null, lease_token: null, manual_requeues: sql`manual_requeues + 1` })
        .where('event_id', '=', eventId).where('consumer', '=', consumer).where('status', '=', 'DEAD').execute();
      await trx.insertInto('event_delivery_attempts').values({ event_id: eventId, consumer, attempt: d.attempts, outcome: 'MANUAL_REQUEUE', actor_id: user.id, reason: dto.reason.trim() }).execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'event_delivery.requeue', entityType: 'event_delivery', entityId: eventId, requestId, result: 'SUCCESS',
        after: { event_id: eventId, consumer, reason: dto.reason.trim(), attempts: d.attempts },
      });
      return { event_id: eventId, consumer, status: 'PENDING' };
    });
  }
}

@ApiTags('events')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class EventHistoryController {
  constructor(private readonly service: EventHistoryService) {}

  @Get('aggregates/:kind/:id/events')
  history(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: HistoryQuery) {
    return this.service.history(user, orgId, kind, id, q);
  }

  @Get('event-deliveries')
  deliveries(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: DeliveriesQuery) {
    return this.service.deliveries(user, orgId, q);
  }

  @Post('event-deliveries/:eventId/:consumer/requeue')
  @HttpCode(200)
  requeue(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('eventId', ParseUUIDPipe) eventId: string, @Param('consumer') consumer: string, @Body() dto: RequeueDto, @Req() req: AuthedRequest) {
    return this.service.requeue(user, orgId, eventId, consumer.slice(0, 80), dto, req.requestId);
  }
}
