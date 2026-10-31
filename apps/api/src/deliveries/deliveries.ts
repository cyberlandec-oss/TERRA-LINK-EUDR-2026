import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Min, ValidateNested } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database, DeliveriesTable } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { KdeService } from '../traceability/kde';
import { gateDetails, scaled } from '../traceability/kde-validator';
import { postMovement } from '../inventory/ledger';

// P0-012 Entregas y recepción (RF-12, QA-05/06; UX_UI §14). Decisiones de diseño del MVP local D-33/D-34/D-35
// (docs/22, pendientes de validación en campo).
// - Entrega: borrador → registrada (DeliveryRegistered). Registrada = inmutable; se corrige con un registro
//   nuevo enlazado (DeliveryCorrected, correction_of). Cantidad declarada ≠ cantidad recibida.
// - Recepción física: cada recepción exige un pesaje válido (método, valor KG, fecha, responsable de la
//   sesión) y queda con su propia historia; parciales permitidas; nunca se cierra la entrega por debajo de lo
//   declarado ni se ajusta la declaración (regla no definida). La recepción NO crea stock (P0-017).
// - Calidad: muestra durante la recepción o después del pesaje; resultado sin decisión = «Pendiente de
//   evaluación»; liberar exige versión de límites declarada (no hay catálogo de límites: no se valida contra él).
// - Compuertas por transición (catálogo KDE 1.1.0, `kde_transition_gates`); los faltantes y desconocidos
//   quedan como pendientes visibles, nunca como valores válidos. Ninguna compuerta es conformidad EUDR.
// - Cada transición escribe dominio, compuerta evaluada, evento, outbox y auditoría en la MISMA transacción.

type Db = Kysely<Database> | Transaction<Database>;
type Delivery = Selectable<DeliveriesTable>;
const DEC = /^\d{1,14}(\.\d{1,6})?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class HarvestPeriodDto {
  @ApiProperty({ enum: ['DAY', 'MONTH', 'UNKNOWN'] }) @IsIn(['DAY', 'MONTH', 'UNKNOWN']) precision!: 'DAY' | 'MONTH' | 'UNKNOWN';
  @ApiPropertyOptional({ description: 'DAY: AAAA-MM-DD · MONTH: AAAA-MM' }) @IsOptional() @IsString() @Length(7, 10) start?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(7, 10) end?: string;
}
export class OriginDto {
  @ApiProperty() @IsUUID() plot_id!: string;
  @ApiPropertyOptional({ description: 'Cantidad atribuida a esta parcela (KG, texto decimal); omitir si no se conoce' }) @IsOptional() @IsString() @Matches(DEC) quantity?: string;
}
export class DeliveryFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() product_id?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() location_id?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(DAY) delivery_date?: string | null;
  @ApiPropertyOptional({ description: 'Texto decimal' }) @IsOptional() @IsString() @Matches(DEC) quantity_declared?: string | null;
  @ApiPropertyOptional({ enum: ['KG'] }) @IsOptional() @IsIn(['KG']) unit?: 'KG' | null;
  @ApiPropertyOptional({ type: HarvestPeriodDto }) @IsOptional() @ValidateNested() @Type(() => HarvestPeriodDto) harvest_period?: HarvestPeriodDto | null;
  @ApiPropertyOptional({ type: [OriginDto] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => OriginDto) origins?: OriginDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) notes?: string | null;
}
class CreateDeliveryDto extends DeliveryFieldsDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsUUID() producer_id!: string;
  @ApiPropertyOptional({ description: 'Registrar en la misma operación (si la compuerta lo permite)' }) @IsOptional() @IsBoolean() register?: boolean;
}
export class UpdateDeliveryDto extends DeliveryFieldsDto {
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
}
class VersionDto { @ApiProperty() @IsInt() @Min(1) expected_version!: number }
class SupportDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsUUID() document_version_id!: string;
  @ApiProperty({ enum: ['DELIVERY_NOTE', 'REMISSION_GUIDE', 'PURCHASE_SETTLEMENT', 'OTHER'] }) @IsIn(['DELIVERY_NOTE', 'REMISSION_GUIDE', 'PURCHASE_SETTLEMENT', 'OTHER']) support_kind!: string;
}
class ReasonDto { @ApiProperty() @IsString() @Length(3, 500) reason!: string }
/**
 * Cierre de una entrega (D-33, adoptada el 2026-10-15). El motivo es obligatorio cuando hay diferencia —positiva o
 * negativa— y opcional solo si la diferencia es exactamente cero. Cerrar con diferencia NO está prohibido: lo único
 * que se exige es explicarla.
 */
class CloseDeliveryDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiPropertyOptional({ description: 'Obligatorio si hay diferencia entre lo declarado y lo recibido.' })
  @IsOptional() @IsString() @Length(3, 500) reason?: string;
}
/** Justificación nueva de un cierre cuya diferencia cambió por una corrección admitida. La anterior se conserva. */
class JustifyClosureDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
class WeighingDto {
  @ApiProperty() @IsString() @Length(1, 120) method!: string;
  @ApiProperty({ description: 'Texto decimal' }) @IsString() @Matches(DEC) quantity!: string;
  @ApiProperty({ enum: ['KG'] }) @IsIn(['KG']) unit!: 'KG';
  @ApiProperty() @IsString() @Matches(DAY) weighed_on!: string;
}
class MeasurementDto {
  @ApiProperty({ enum: ['MOISTURE', 'FERMENTATION', 'IMPURITIES'] }) @IsIn(['MOISTURE', 'FERMENTATION', 'IMPURITIES']) parameter!: 'MOISTURE' | 'FERMENTATION' | 'IMPURITIES';
  @ApiProperty() @IsString() @Matches(DEC) value!: string;
  @ApiProperty({ description: 'Unidad explícita (sin catálogo: D-32)' }) @IsString() @Length(1, 20) unit!: string;
}
class QualityResultFieldsDto {
  @ApiProperty() @IsString() @Length(1, 120) method!: string;
  @ApiPropertyOptional({ type: [MeasurementDto] }) @IsOptional() @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => MeasurementDto) measurements?: MeasurementDto[];
  @ApiPropertyOptional({ enum: ['PENDING', 'RELEASED', 'REJECTED'] }) @IsOptional() @IsIn(['PENDING', 'RELEASED', 'REJECTED']) decision?: 'PENDING' | 'RELEASED' | 'REJECTED';
  @ApiPropertyOptional({ description: 'Referencia de límites DECLARADA por quien decide (texto). No existe catálogo publicado: el sistema no la verifica.' }) @IsOptional() @IsString() @Length(1, 80) limits_version?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 500) decision_reason?: string;
}
class SampleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) sample_reference?: string;
  @ApiPropertyOptional({ type: QualityResultFieldsDto }) @IsOptional() @ValidateNested() @Type(() => QualityResultFieldsDto) result?: QualityResultFieldsDto;
}
class ReceptionDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsUUID() location_id!: string;
  @ApiProperty({ description: 'ISO 8601 con zona' }) @IsISO8601({ strict: true }) received_at!: string;
  @ApiProperty({ type: WeighingDto }) @ValidateNested() @Type(() => WeighingDto) weighing!: WeighingDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @ApiPropertyOptional({ type: SampleDto, description: 'Muestra tomada durante la recepción' }) @IsOptional() @ValidateNested() @Type(() => SampleDto) quality_sample?: SampleDto;
}
class AfterSampleDto extends SampleDto { @ApiProperty() @IsUUID() operation_id!: string }
class QualityResultDto extends QualityResultFieldsDto { @ApiProperty() @IsUUID() operation_id!: string }
class DeliveryCorrectionFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(DAY) delivery_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(DEC) quantity_declared?: string;
  @ApiPropertyOptional({ type: HarvestPeriodDto }) @IsOptional() @ValidateNested() @Type(() => HarvestPeriodDto) harvest_period?: HarvestPeriodDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) notes?: string;
}
class DeliveryCorrectionDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
  @ApiProperty({ type: DeliveryCorrectionFieldsDto }) @ValidateNested() @Type(() => DeliveryCorrectionFieldsDto) fields!: DeliveryCorrectionFieldsDto;
}
class ReceptionCorrectionDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
  @ApiProperty({ type: WeighingDto }) @ValidateNested() @Type(() => WeighingDto) weighing!: WeighingDto;
}
class ListQuery {
  @IsOptional() @IsIn(['DRAFT', 'REGISTERED', 'CLOSED']) status?: 'DRAFT' | 'REGISTERED' | 'CLOSED';
  @IsOptional() @IsIn(['NOT_RECEIVED', 'PARTIAL', 'RECEIVED_DECLARED', 'ABOVE_DECLARED']) reception?: string;
  @IsOptional() @IsUUID() producer_id?: string;
  @IsOptional() @IsString() @Length(1, 40) q?: string;
}
class OptionsQuery { @IsOptional() @IsUUID() producer_id?: string }
class LocationDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/) code!: string;
  @ApiProperty() @IsString() @Length(2, 120) name!: string;
  @ApiProperty({ enum: ['COLLECTION_CENTER', 'WAREHOUSE', 'OTHER'] }) @IsIn(['COLLECTION_CENTER', 'WAREHOUSE', 'OTHER']) location_type!: 'COLLECTION_CENTER' | 'WAREHOUSE' | 'OTHER';
}
class LocationStatusDto {
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) @IsIn(['ACTIVE', 'INACTIVE']) status!: 'ACTIVE' | 'INACTIVE';
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

/** Periodo declarado → columnas (declaración original + límites derivados marcados como tales). */
export function harvestColumns(p: HarvestPeriodDto | null | undefined) {
  if (p === undefined) return undefined;
  if (p === null) return { harvest_precision: null, harvest_start: null, harvest_end: null, harvest_derived_start: null, harvest_derived_end: null };
  const bad = (code: string, message: string) => new AppError(422, code, message, [{ field: 'harvest_period', reason: code }]);
  if (p.precision === 'UNKNOWN') {
    if (p.start || p.end) throw bad('HARVEST_PERIOD_UNKNOWN_WITH_DATES', 'Un periodo desconocido no lleva fechas.');
    return { harvest_precision: 'UNKNOWN' as const, harvest_start: null, harvest_end: null, harvest_derived_start: null, harvest_derived_end: null };
  }
  const start = p.start ?? '';
  const end = p.end ?? p.start ?? '';
  if (p.precision === 'DAY') {
    const valid = (s: string) => DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
    if (!valid(start) || !valid(end)) throw bad('HARVEST_PERIOD_DAY_INVALID', 'Con precisión de día, inicio y fin deben ser fechas válidas (AAAA-MM-DD).');
    if (start > end) throw bad('HARVEST_PERIOD_INVERTED', 'El inicio del periodo de cosecha es posterior al fin.');
    return { harvest_precision: 'DAY' as const, harvest_start: start, harvest_end: end, harvest_derived_start: start, harvest_derived_end: end };
  }
  if (!MONTH.test(start) || !MONTH.test(end)) throw bad('HARVEST_PERIOD_MONTH_INVALID', 'Con precisión de mes, usa AAAA-MM (un mes o un intervalo de meses); no se completan días.');
  if (start > end) throw bad('HARVEST_PERIOD_INVERTED', 'El mes inicial es posterior al final.');
  const [y, m] = end.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { harvest_precision: 'MONTH' as const, harvest_start: start, harvest_end: end, harvest_derived_start: `${start}-01`, harvest_derived_end: last };
}

const periodValue = (precision: string | null, start: string | null, end: string | null) =>
  precision ? (precision === 'UNKNOWN' ? { precision } : { precision, start, end }) : null;
/** Entero escalado (6 decimales) → texto decimal exacto. */
const unscaled = (n: bigint) => { const neg = n < 0n; const a = neg ? -n : n; const f = (a % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, ''); return `${neg ? '-' : ''}${a / 1_000_000n}${f ? `.${f}` : ''}`; };
const dec = (v: string | null) => (v === null ? null : unscaled(scaled(String(v))));
/** Columna DATE de pg (Date local o texto) → AAAA-MM-DD sin desplazamiento de zona. */
export const ymd = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};
const RECEPTION_LABEL: Record<string, string> = {
  NOT_RECEIVED: 'Sin recepción', PARTIAL: 'Recepción parcial', RECEIVED_DECLARED: 'Recibida por la cantidad declarada', ABOVE_DECLARED: 'Recibido supera lo declarado',
};

@Injectable()
export class DeliveriesService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly kde: KdeService,
  ) {}

  private has(ctx: TenantContext, p: Permission) { return ctx.permissions.includes(p); }

  private async ctx(user: AuthUser, orgId: string, perms: Permission[], mutation: boolean) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!perms.some((p) => this.has(ctx, p))) throw forbidden();
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }

  /** Contexto de resolución de la compuerta: alcance de toda la organización (solo códigos; nunca valores). */
  private systemCtx(ctx: TenantContext): TenantContext {
    return { ...ctx, permissions: [...new Set([...ctx.permissions, 'producer:read', 'plot:read', 'product:read', 'document:read', 'delivery:read', 'location:read', 'membership:read'] as Permission[])] };
  }

  private readScope(ctx: TenantContext) {
    return this.has(ctx, 'delivery:read') ? sql<boolean>`TRUE`
      : this.has(ctx, 'delivery:read_assigned') ? sql<boolean>`pr.assigned_membership_id = ${ctx.membershipId}` : sql<boolean>`FALSE`;
  }
  /** Alcance del LISTADO: además del de lectura, las entregas del productor vinculado a esta cuenta (`delivery:read_own`). El detalle no lo usa. */
  private listScope(ctx: TenantContext) {
    if (this.has(ctx, 'delivery:read')) return sql<boolean>`TRUE`;
    const conds: ReturnType<typeof sql<boolean>>[] = [];
    if (this.has(ctx, 'delivery:read_assigned')) conds.push(sql<boolean>`pr.assigned_membership_id = ${ctx.membershipId}`);
    if (this.has(ctx, 'delivery:read_own')) conds.push(sql<boolean>`pr.self_membership_id = ${ctx.membershipId}`);
    return conds.length ? sql<boolean>`(${sql.join(conds, sql` OR `)})` : sql<boolean>`FALSE`;
  }
  private canWrite(ctx: TenantContext, producerAssignee: string | null) {
    return this.has(ctx, 'delivery:create') || (this.has(ctx, 'delivery:create_assigned') && producerAssignee === ctx.membershipId);
  }

  async loadDelivery(db: Db, ctx: TenantContext, id: string, kind: 'read' | 'write', lock = false) {
    let q = db.selectFrom('deliveries as d')
      .innerJoin('producers as pr', (j) => j.onRef('pr.id', '=', 'd.producer_id').onRef('pr.organization_id', '=', 'd.organization_id'))
      .selectAll('d').select('pr.assigned_membership_id as producer_assignee')
      .where('d.organization_id', '=', ctx.organizationId).where('d.id', '=', id).where(this.readScope(ctx));
    if (lock) q = q.forUpdate('d');
    const row = await q.executeTakeFirst();
    if (!row) throw notFound();
    if (kind === 'write' && !this.canWrite(ctx, row.producer_assignee)) throw forbidden();
    return row;
  }

  // ---------- Validación de referencias (mismo tenant y alcance; ajena = inexistente) ----------

  private async checkProducer(db: Db, ctx: TenantContext, producerId: string) {
    const p = await db.selectFrom('producers').select(['id', 'status', 'assigned_membership_id']).where('organization_id', '=', ctx.organizationId).where('id', '=', producerId).executeTakeFirst();
    if (!p || !this.canWrite(ctx, p.assigned_membership_id)) throw notFound('El productor no existe o no está disponible para ti.');
    if (p.status !== 'ACTIVE') throw new AppError(422, 'PRODUCER_INACTIVE', 'El productor no está activo.', [{ field: 'producer_id', reason: 'INACTIVE' }]);
    return p;
  }
  private async checkFields(db: Db, ctx: TenantContext, producerId: string, f: DeliveryFieldsDto) {
    if (f.product_id) {
      const p = await db.selectFrom('products').select(['status', 'unit']).where('organization_id', '=', ctx.organizationId).where('id', '=', f.product_id).executeTakeFirst();
      if (!p) throw notFound('El producto no existe en tu organización.');
      if (p.status !== 'ACTIVE') throw new AppError(422, 'PRODUCT_INACTIVE', 'El producto no está activo.', [{ field: 'product_id', reason: 'INACTIVE' }]);
    }
    if (f.location_id) await this.checkLocation(db, ctx, f.location_id, 'location_id');
    if (f.quantity_declared !== undefined && f.quantity_declared !== null && scaled(f.quantity_declared) <= 0n) throw new AppError(422, 'MUST_BE_POSITIVE', 'La cantidad declarada debe ser mayor que cero.', [{ field: 'quantity_declared', reason: 'MUST_BE_POSITIVE' }]);
    if (f.quantity_declared && !f.unit) throw new AppError(422, 'UNIT_REQUIRED', 'Indica la unidad de la cantidad declarada; no se asume ninguna.', [{ field: 'unit', reason: 'UNIT_REQUIRED' }]);
    if (f.delivery_date && new Date(`${f.delivery_date}T00:00:00Z`).toISOString().slice(0, 10) !== f.delivery_date) throw new AppError(422, 'DATE_INVALID', 'Fecha de entrega no válida.', [{ field: 'delivery_date', reason: 'DATE_INVALID' }]);
    if (f.origins) {
      const ids = f.origins.map((o) => o.plot_id);
      if (new Set(ids).size !== ids.length) throw new AppError(422, 'ORIGIN_DUPLICATED', 'Una parcela aparece dos veces en los orígenes.', [{ field: 'origins', reason: 'DUPLICATED' }]);
      if (ids.length) {
        const plots = await db.selectFrom('plots').select(['id', 'status']).where('organization_id', '=', ctx.organizationId).where('producer_id', '=', producerId).where('id', 'in', ids).execute();
        if (plots.length !== ids.length) throw notFound('Una parcela de origen no existe, no pertenece al productor o no está disponible para ti.');
        if (plots.some((p) => p.status !== 'ACTIVE')) throw new AppError(422, 'PLOT_INACTIVE', 'Una parcela de origen no está activa.', [{ field: 'origins', reason: 'INACTIVE' }]);
      }
      const qty = f.origins.filter((o) => o.quantity).reduce((a, o) => a + scaled(o.quantity!), 0n);
      if (f.origins.some((o) => o.quantity && scaled(o.quantity) <= 0n)) throw new AppError(422, 'MUST_BE_POSITIVE', 'La cantidad por origen debe ser mayor que cero.', [{ field: 'origins', reason: 'MUST_BE_POSITIVE' }]);
      if (f.quantity_declared && qty > scaled(f.quantity_declared)) throw new AppError(422, 'ORIGIN_QUANTITY_EXCEEDS', 'Las cantidades por origen superan la cantidad declarada.', [{ field: 'origins', reason: 'EXCEEDS_DECLARED' }]);
    }
  }
  private async checkLocation(db: Db, ctx: TenantContext, id: string, field: string) {
    const l = await db.selectFrom('locations').select('status').where('organization_id', '=', ctx.organizationId).where('id', '=', id).executeTakeFirst();
    if (!l) throw notFound('El centro no existe en tu organización.');
    if (l.status !== 'ACTIVE') throw new AppError(422, 'LOCATION_INACTIVE', 'El centro no está activo.', [{ field, reason: 'INACTIVE' }]);
  }

  // ---------- Valores KDE a partir del estado real ----------

  private async effective(db: Db, d: Delivery) {
    const c = await db.selectFrom('delivery_corrections').selectAll().where('delivery_id', '=', d.id).where('organization_id', '=', d.organization_id).orderBy('correction_number', 'desc').executeTakeFirst();
    return c ? {
      delivery_date: ymd(c.delivery_date), quantity_declared: dec(c.quantity_declared), harvest_precision: c.harvest_precision, harvest_start: c.harvest_start, harvest_end: c.harvest_end,
      harvest_derived_start: ymd(c.harvest_derived_start), harvest_derived_end: ymd(c.harvest_derived_end), notes: c.notes, correction_number: c.correction_number,
    } : {
      delivery_date: ymd(d.delivery_date), quantity_declared: dec(d.quantity_declared), harvest_precision: d.harvest_precision, harvest_start: d.harvest_start, harvest_end: d.harvest_end,
      harvest_derived_start: ymd(d.harvest_derived_start), harvest_derived_end: ymd(d.harvest_derived_end), notes: d.notes, correction_number: 0,
    };
  }

  private async deliveryValues(db: Db, d: Delivery) {
    const e = await this.effective(db, d);
    const origins = await db.selectFrom('delivery_origins').select('plot_id').where('delivery_id', '=', d.id).execute();
    const supports = await db.selectFrom('delivery_supports as s').leftJoin('delivery_support_withdrawals as w', 'w.support_id', 's.id')
      .select('s.document_id').where('s.delivery_id', '=', d.id).where('w.support_id', 'is', null).execute();
    const docs = [...new Set(supports.map((s) => s.document_id))];
    return {
      DELIVERY_SUPPLIER: d.producer_id,
      DELIVERY_PLOTS: origins.length ? origins.map((o) => o.plot_id) : null,
      DELIVERY_PRODUCT: d.product_id,
      DELIVERY_DATE: e.delivery_date,
      DELIVERY_DECLARED_WEIGHT: e.quantity_declared ? { value: e.quantity_declared, unit: d.unit } : null,
      DELIVERY_SUPPORT: docs.length ? docs : null,
      DELIVERY_PRODUCTION_PERIOD: periodValue(e.harvest_precision, e.harvest_start, e.harvest_end),
    } as Record<string, unknown>;
  }

  private async receptionValues(db: Db, receptionId: string) {
    const r = await db.selectFrom('receptions').selectAll().where('id', '=', receptionId).executeTakeFirstOrThrow();
    const w = await db.selectFrom('weighings').selectAll().where('reception_id', '=', receptionId).orderBy('created_at', 'desc').orderBy('id', 'desc').executeTakeFirstOrThrow();
    return {
      RECEPTION_DELIVERY: r.delivery_id, RECEPTION_LOCATION: r.location_id, RECEPTION_RECEIVER: r.receiver_membership_id,
      RECEPTION_TIME: new Date(r.received_at).toISOString(), RECEPTION_RECEIVED_WEIGHT: { value: dec(w.quantity), unit: w.unit }, RECEPTION_DIFFERENCE_REASON: null,
      WEIGHING_SUBJECT: r.id, WEIGHING_METHOD: w.method, WEIGHING_VALUE: { value: dec(w.quantity), unit: w.unit }, WEIGHING_DATE: ymd(w.weighed_on)!, WEIGHING_RESPONSIBLE: w.responsible_membership_id,
    } as Record<string, unknown>;
  }

  private async gate(db: Db, ctx: TenantContext, transition: string, values: Record<string, unknown>) {
    return this.kde.evaluateTransition(this.systemCtx(ctx), transition, values, db);
  }
  private async storeGate(trx: Transaction<Database>, ctx: TenantContext, userId: string, entityType: 'delivery' | 'reception' | 'quality_result', entityId: string, g: Awaited<ReturnType<DeliveriesService['gate']>>) {
    await trx.insertInto('gate_evaluations').values({
      id: randomUUID(), organization_id: ctx.organizationId, entity_type: entityType, entity_id: entityId, transition: g.transition, release_version: g.release,
      allowed: g.allowed, result: JSON.stringify({ blocking: g.blocking, pending: g.pending, not_evaluated: g.not_evaluated }), evaluated_by: userId,
    }).execute();
  }
  private blocked(g: Awaited<ReturnType<DeliveriesService['gate']>>, what: string) {
    return new AppError(422, 'TRANSITION_BLOCKED', `No se puede ${what}: faltan datos obligatorios o no son válidos.`,
      gateDetails(g.blocking));
  }

  private async record(trx: Transaction<Database>, ctx: TenantContext, userId: string, d: { id: string; delivery_code: string }, ev: { type: string; aggregateType: string; aggregateId: string; version: number; payload: Record<string, unknown>; correctionOf?: { eventId: string; reason: string } } | null, action: string, after: Record<string, unknown>, requestId?: string, reason?: string) {
    const event = ev ? await this.events.append(trx, {
      organizationId: ctx.organizationId, eventType: ev.type, schemaVersion: 1, aggregateType: ev.aggregateType, aggregateId: ev.aggregateId, aggregateVersion: ev.version,
      actorId: userId, correlationId: requestId, correctionOf: ev.correctionOf ?? null, payload: ev.payload,
    }) : null;
    await this.audit.record(trx, { organizationId: ctx.organizationId, actorUserId: userId, action, entityType: 'delivery', entityId: d.id, requestId, result: 'SUCCESS', ...(reason ? { reason } : {}), after: { delivery_code: d.delivery_code, ...after } });
    return event;
  }

  // ---------- Entregas ----------

  private async nextCode(trx: Transaction<Database>, orgId: string, date: string | null) {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${'deliveries:' + orgId}))`.execute(trx);
    const n = (await trx.selectFrom('deliveries').select(sql<number>`count(*)::int`.as('n')).where('organization_id', '=', orgId).executeTakeFirstOrThrow()).n + 1;
    return `ENT-${(date ?? new Date().toISOString()).slice(0, 4)}-${String(n).padStart(5, '0')}`;
  }

  private async replaceOrigins(trx: Transaction<Database>, ctx: TenantContext, deliveryId: string, origins: OriginDto[]) {
    await trx.deleteFrom('delivery_origins').where('delivery_id', '=', deliveryId).where('organization_id', '=', ctx.organizationId).execute();
    for (const o of origins) {
      await trx.insertInto('delivery_origins').values({ id: randomUUID(), organization_id: ctx.organizationId, delivery_id: deliveryId, plot_id: o.plot_id, origin_quantity: o.quantity ?? null }).execute();
    }
  }

  async create(user: AuthUser, orgId: string, dto: CreateDeliveryDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, ['delivery:create', 'delivery:create_assigned'], true);
    const prior = await this.db.selectFrom('deliveries').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.producer_id !== dto.producer_id) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, delivery: await this.view(this.db, ctx, (await this.loadDelivery(this.db, ctx, prior.id, 'read'))) };
    }
    await this.checkProducer(this.db, ctx, dto.producer_id);
    await this.checkFields(this.db, ctx, dto.producer_id, dto);
    try {
      const id = await this.db.transaction().execute(async (trx) => {
        const row = await this.createDraftInTx(trx, ctx, user.id, dto, dto.operation_id, requestId);
        if (dto.register) await this.registerIn(trx, ctx, user.id, row, requestId);
        return row.id;
      });
      return { replayed: false, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
    } catch (err) {
      if ((err as { constraint?: string }).constraint === 'deliveries_operation_uq') {
        const again = await this.db.selectFrom('deliveries').select('id').where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirstOrThrow();
        return { replayed: true, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, again.id, 'read')) };
      }
      throw err;
    }
  }

  async update(user: AuthUser, orgId: string, id: string, dto: UpdateDeliveryDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, ['delivery:create', 'delivery:create_assigned'], true);
    return this.db.transaction().execute(async (trx) => {
      const { after, d } = await this.updateDraftInTx(trx, ctx, user.id, id, dto, requestId);
      return this.view(trx, ctx, { ...after, producer_assignee: d.producer_assignee });
    });
  }

  /**
   * Alta de BORRADOR dentro de una transacción del llamador (también P0-026 Importación). Mismos controles que create():
   * productor activo en el alcance de alta, referencias de la organización (producto, centro, parcelas del productor),
   * cantidad positiva con unidad explícita, periodo tal como se declara, código asignado por el sistema, compuerta
   * DELIVERY_DRAFT_SAVE y auditoría. No registra la entrega ni genera efectos físicos (sin evento de dominio).
   */
  async createDraftInTx(trx: Transaction<Database>, ctx: TenantContext, userId: string, dto: DeliveryFieldsDto & { producer_id: string }, operationId: string, requestId?: string, from?: { reason: string; source: Record<string, unknown> }) {
    const orgId = ctx.organizationId;
    await this.checkProducer(trx, ctx, dto.producer_id);
    await this.checkFields(trx, ctx, dto.producer_id, dto);
    const harvest = harvestColumns(dto.harvest_period) ?? harvestColumns(null)!;
    const id = randomUUID();
    const code = await this.nextCode(trx, orgId, dto.delivery_date ?? null);
    const row = await trx.insertInto('deliveries').values({
      id, organization_id: orgId, delivery_code: code, status: 'DRAFT', producer_id: dto.producer_id, product_id: dto.product_id ?? null, location_id: dto.location_id ?? null,
      delivery_date: dto.delivery_date ?? null, quantity_declared: dto.quantity_declared ?? null, unit: dto.unit ?? null, ...harvest, notes: dto.notes?.trim() || null,
      created_by: userId, operation_id: operationId,
    }).returningAll().executeTakeFirstOrThrow();
    if (dto.origins?.length) await this.replaceOrigins(trx, ctx, id, dto.origins);
    const g = await this.gate(trx, ctx, 'DELIVERY_DRAFT_SAVE', await this.deliveryValues(trx, row));
    if (!g.allowed) throw this.blocked(g, 'guardar el borrador');
    await this.record(trx, ctx, userId, row, null, 'delivery.draft_create', { status: 'DRAFT', pending: g.pending.map((p) => p.code), ...(from ? { source: from.source } : {}) }, requestId, from?.reason);
    return row;
  }

  /**
   * Edición de BORRADOR dentro de una transacción del llamador (también P0-026 Importación). Mismos controles que update():
   * alcance de escritura (bloqueo), solo borradores (una registrada se corrige con su mecanismo), versión esperada,
   * referencias, compuerta y auditoría. El productor no cambia. Un campo ausente (undefined) no cambia.
   */
  async updateDraftInTx(trx: Transaction<Database>, ctx: TenantContext, userId: string, id: string, dto: UpdateDeliveryDto, requestId?: string, from?: { reason: string; source: Record<string, unknown> }) {
    const orgId = ctx.organizationId;
    const d = await this.loadDelivery(trx, ctx, id, 'write', true);
    if (d.status !== 'DRAFT') throw conflict('DELIVERY_REGISTERED', 'La entrega ya está registrada: no se edita; registra una corrección.');
    if (Number(d.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó esta entrega. Recarga para ver la versión actual; tus datos siguen en el formulario.');
    await this.checkFields(trx, ctx, d.producer_id, dto);
    const changes: Record<string, unknown> = {};
    for (const k of ['product_id', 'location_id', 'delivery_date', 'quantity_declared', 'unit'] as const) if (dto[k] !== undefined) changes[k] = dto[k];
    if (dto.notes !== undefined) changes.notes = dto.notes?.trim() || null;
    const harvest = harvestColumns(dto.harvest_period);
    if (harvest) Object.assign(changes, harvest);
    const after = await trx.updateTable('deliveries').set({ ...changes, row_version: sql`row_version + 1`, updated_at: new Date() } as never)
      .where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
    if (dto.origins) await this.replaceOrigins(trx, ctx, id, dto.origins);
    const g = await this.gate(trx, ctx, 'DELIVERY_DRAFT_SAVE', await this.deliveryValues(trx, after));
    if (!g.allowed) throw this.blocked(g, 'guardar el borrador');
    await this.record(trx, ctx, userId, after, null, 'delivery.draft_update', { changed_fields: [...Object.keys(changes), ...(dto.origins ? ['origins'] : [])].filter((k) => !k.startsWith('harvest_derived')), version: Number(after.row_version), ...(from ? { source: from.source } : {}) }, requestId, from?.reason);
    return { after, d };
  }

  /** P0-026: alcance de escritura de entregas para un productor (misma regla que el alta). */
  canWriteFor(ctx: TenantContext, producerAssignee: string | null) { return this.canWrite(ctx, producerAssignee); }
  /** P0-026: alcance de lectura de entregas para un productor (misma regla que loadDelivery). */
  canReadFor(ctx: TenantContext, producerAssignee: string | null) {
    return this.has(ctx, 'delivery:read') || (this.has(ctx, 'delivery:read_assigned') && producerAssignee === ctx.membershipId);
  }

  private async registerIn(trx: Transaction<Database>, ctx: TenantContext, userId: string, d: Delivery, requestId?: string) {
    const values = await this.deliveryValues(trx, d);
    const g = await this.gate(trx, ctx, 'DELIVERY_REGISTER', values);
    if (!g.allowed) throw this.blocked(g, 'registrar la entrega');
    const after = await trx.updateTable('deliveries').set({ status: 'REGISTERED', registered_by: userId, registered_at: new Date(), row_version: sql`row_version + 1`, updated_at: new Date() } as never)
      .where('id', '=', d.id).where('organization_id', '=', d.organization_id).returningAll().executeTakeFirstOrThrow();
    await this.storeGate(trx, ctx, userId, 'delivery', d.id, g);
    const origins = (values.DELIVERY_PLOTS as string[] | null) ?? [];
    await this.record(trx, ctx, userId, after, {
      type: 'DeliveryRegistered', aggregateType: 'DELIVERY', aggregateId: d.id, version: Number(after.row_version),
      payload: { delivery_id: d.id, delivery_code: d.delivery_code, producer_id: d.producer_id, product_id: d.product_id, plot_ids: origins, delivery_date: ymd(after.delivery_date),
        quantity_declared: dec(after.quantity_declared), unit: after.unit, harvest_period: periodValue(after.harvest_precision, after.harvest_start, after.harvest_end), pending_kde: g.pending.map((p) => p.code) },
    }, 'delivery.register', { status: 'REGISTERED', product_id: d.product_id, quantity: dec(after.quantity_declared), unit: after.unit, pending: g.pending.map((p) => p.code) }, requestId);
    return after;
  }

  async register(user: AuthUser, orgId: string, id: string, dto: VersionDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, ['delivery:create', 'delivery:create_assigned'], true);
    return this.db.transaction().execute(async (trx) => {
      const d = await this.loadDelivery(trx, ctx, id, 'write', true);
      if (d.status === 'REGISTERED') return { replayed: true, delivery: await this.view(trx, ctx, d) };
      if (Number(d.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó esta entrega. Recarga antes de registrarla.');
      if (d.product_id) {
        const p = await trx.selectFrom('products').select('status').where('id', '=', d.product_id).executeTakeFirstOrThrow();
        if (p.status !== 'ACTIVE') throw new AppError(422, 'PRODUCT_INACTIVE', 'El producto ya no está activo.', [{ field: 'product_id', reason: 'INACTIVE' }]);
      }
      const after = await this.registerIn(trx, ctx, user.id, d, requestId);
      return { replayed: false, delivery: await this.view(trx, ctx, { ...after, producer_assignee: d.producer_assignee }) };
    });
  }

  // ---------- Soportes ----------

  private async documentScopeOk(db: Db, ctx: TenantContext, ownerType: string, ownerId: string) {
    const scope = (perm: string) => this.has(ctx, `${perm}:read` as Permission) ? sql`TRUE` : this.has(ctx, `${perm}:read_assigned` as Permission) ? sql`pr.assigned_membership_id = ${ctx.membershipId}` : sql`FALSE`;
    if (ownerType === 'producer') return (await sql<{ n: number }>`SELECT count(*)::int AS n FROM producers pr WHERE pr.id = ${ownerId} AND pr.organization_id = ${ctx.organizationId} AND ${scope('producer')}`.execute(db)).rows[0].n > 0;
    if (ownerType === 'plot') return (await sql<{ n: number }>`SELECT count(*)::int AS n FROM plots p JOIN producers pr ON pr.id = p.producer_id AND pr.organization_id = p.organization_id WHERE p.id = ${ownerId} AND p.organization_id = ${ctx.organizationId} AND ${scope('plot')}`.execute(db)).rows[0].n > 0;
    return false;
  }

  async addSupport(user: AuthUser, orgId: string, id: string, dto: SupportDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, ['delivery:create', 'delivery:create_assigned'], true);
    if (!this.has(ctx, 'document:read')) throw forbidden('PERMISSION_DENIED', 'Vincular soportes exige consultar documentos; tu rol no lo permite.');
    const prior = await this.db.selectFrom('delivery_supports').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.delivery_id !== id || prior.document_version_id !== dto.document_version_id || prior.support_kind !== dto.support_kind) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
    }
    return this.db.transaction().execute(async (trx) => {
      const d = await this.loadDelivery(trx, ctx, id, 'write', true);
      const v = await trx.selectFrom('document_versions as v').innerJoin('documents as doc', (j) => j.onRef('doc.id', '=', 'v.document_id').onRef('doc.organization_id', '=', 'v.organization_id'))
        .select(['v.id', 'v.document_id', 'doc.document_type', 'doc.owner_type', 'doc.owner_id']).where('v.organization_id', '=', orgId).where('v.id', '=', dto.document_version_id).executeTakeFirst();
      if (!v || !(await this.documentScopeOk(trx, ctx, v.owner_type, v.owner_id))) throw notFound('La versión del documento no existe o no está disponible para ti.');
      if (v.document_type !== 'DELIVERY_SUPPORT') throw new AppError(422, 'DOCUMENT_TYPE_NOT_ALLOWED', 'Solo se vinculan documentos de tipo «soporte de entrega».', [{ field: 'document_version_id', reason: 'TYPE_NOT_ALLOWED' }]);
      const origins = (await trx.selectFrom('delivery_origins').select('plot_id').where('delivery_id', '=', id).execute()).map((o) => o.plot_id);
      const ownerOk = (v.owner_type === 'producer' && v.owner_id === d.producer_id) || (v.owner_type === 'plot' && origins.includes(v.owner_id));
      if (!ownerOk) throw new AppError(422, 'DOCUMENT_OWNER_MISMATCH', 'El documento pertenece a otro productor o parcela; vincula un soporte del productor de esta entrega o de sus parcelas de origen.', [{ field: 'document_version_id', reason: 'OWNER_MISMATCH' }]);
      const dup = await trx.selectFrom('delivery_supports as s').leftJoin('delivery_support_withdrawals as w', 'w.support_id', 's.id').select('s.id')
        .where('s.delivery_id', '=', id).where('s.document_version_id', '=', dto.document_version_id).executeTakeFirst();
      if (dup) throw conflict('SUPPORT_ALREADY_LINKED', 'Esa versión del documento ya está vinculada a la entrega.');
      const supportId = randomUUID();
      await trx.insertInto('delivery_supports').values({ id: supportId, organization_id: orgId, delivery_id: id, document_id: v.document_id, document_version_id: v.id, support_kind: dto.support_kind, added_by: user.id, operation_id: dto.operation_id }).execute();
      const after = await trx.updateTable('deliveries').set({ row_version: sql`row_version + 1`, updated_at: new Date() } as never).where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
      await this.record(trx, ctx, user.id, d, null, 'delivery.support_link', { support_id: supportId, document_version_id: v.id, support_kind: dto.support_kind }, requestId);
      return { replayed: false, delivery: await this.view(trx, ctx, { ...after, producer_assignee: d.producer_assignee }) };
    });
  }

  async withdrawSupport(user: AuthUser, orgId: string, id: string, supportId: string, dto: ReasonDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, ['delivery:create', 'delivery:create_assigned'], true);
    if (!this.has(ctx, 'document:read')) throw forbidden();
    return this.db.transaction().execute(async (trx) => {
      const d = await this.loadDelivery(trx, ctx, id, 'write', true);
      const s = await trx.selectFrom('delivery_supports as s').leftJoin('delivery_support_withdrawals as w', 'w.support_id', 's.id').select(['s.id', 's.document_version_id', 'w.support_id as withdrawn'])
        .where('s.id', '=', supportId).where('s.delivery_id', '=', id).where('s.organization_id', '=', orgId).executeTakeFirst();
      if (!s) throw notFound();
      if (s.withdrawn) throw conflict('SUPPORT_ALREADY_WITHDRAWN', 'El soporte ya fue retirado.');
      await trx.insertInto('delivery_support_withdrawals').values({ support_id: supportId, organization_id: orgId, reason: dto.reason.trim(), withdrawn_by: user.id }).execute();
      const after = await trx.updateTable('deliveries').set({ row_version: sql`row_version + 1`, updated_at: new Date() } as never).where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
      await this.record(trx, ctx, user.id, d, null, 'delivery.support_withdraw', { support_id: supportId, reason: dto.reason.trim() }, requestId);
      return this.view(trx, ctx, { ...after, producer_assignee: d.producer_assignee });
    });
  }

  // ---------- Recepción física ----------

  async receive(user: AuthUser, orgId: string, id: string, dto: ReceptionDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, ['reception:confirm'], true);
    if (dto.quality_sample && !this.has(ctx, 'quality:record')) throw forbidden('PERMISSION_DENIED', 'Tu rol no permite registrar muestras de calidad.');
    if (dto.quality_sample?.result?.decision && dto.quality_sample.result.decision !== 'PENDING') throw new AppError(422, 'DECISION_NOT_ALLOWED_HERE', 'Durante la recepción se registra la muestra y sus mediciones; la decisión de calidad se registra aparte con permiso de calidad.', [{ field: 'quality_sample.result.decision', reason: 'SEPARATE_DECISION' }]);
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(dto.received_at)) throw new AppError(422, 'DATETIME_ZONE_REQUIRED', 'Indica la zona horaria del momento de recepción; no se asume ninguna.', [{ field: 'received_at', reason: 'ZONE_REQUIRED' }]);
    if (scaled(dto.weighing.quantity) <= 0n) throw new AppError(422, 'MUST_BE_POSITIVE', 'El peso debe ser mayor que cero.', [{ field: 'weighing.quantity', reason: 'MUST_BE_POSITIVE' }]);
    const replay = async () => {
      const prior = await this.db.selectFrom('receptions').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
      if (!prior) return null;
      const w = await this.db.selectFrom('weighings').select('quantity').where('reception_id', '=', prior.id).orderBy('created_at').executeTakeFirstOrThrow();
      if (prior.delivery_id !== id || scaled(dec(w.quantity)!) !== scaled(dto.weighing.quantity) || prior.location_id !== dto.location_id) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, reception_id: prior.id, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
    };
    const r0 = await replay();
    if (r0) return r0;
    try {
      const receptionId = await this.db.transaction().execute(async (trx) => {
        const d = await this.loadDelivery(trx, ctx, id, 'read', true);
        // D-33: una entrega cerrada no admite recepciones nuevas ni se reabre. Si llega más material, es otra entrega.
        if (d.status === 'CLOSED') throw conflict('DELIVERY_CLOSED', 'La entrega está cerrada: no admite recepciones nuevas y no se reabre. Si llegó más material, registra otra entrega.');
        if (d.status !== 'REGISTERED') throw conflict('DELIVERY_NOT_REGISTERED', 'Solo se recibe una entrega registrada.');
        await this.checkLocation(trx, ctx, dto.location_id, 'location_id');
        const rid = randomUUID();
        await trx.insertInto('receptions').values({
          id: rid, organization_id: orgId, delivery_id: id, location_id: dto.location_id, receiver_membership_id: ctx.membershipId, receiver_user_id: user.id,
          received_at: new Date(dto.received_at), quantity_received: dto.weighing.quantity, unit: dto.weighing.unit, notes: dto.notes?.trim() || null, operation_id: dto.operation_id,
        }).execute();
        const wid = randomUUID();
        await trx.insertInto('weighings').values({
          id: wid, organization_id: orgId, reception_id: rid, method: dto.weighing.method.trim(), quantity: dto.weighing.quantity, unit: dto.weighing.unit, weighed_on: dto.weighing.weighed_on,
          responsible_membership_id: ctx.membershipId, responsible_user_id: user.id, corrects_weighing_id: null,
        }).execute();
        // P0-017: única entrada física de este cacao en el ledger (recepción @ centro), en la misma transacción.
        await postMovement(trx, { organizationId: orgId, type: 'RECEPTION_IN', sourceType: 'reception', sourceId: rid, operationId: null, actorId: user.id, reference: { delivery_id: id, weighing_id: wid },
          lines: [{ reception_id: rid, location_id: dto.location_id, bucket: 'PHYSICAL', quantity: dto.weighing.quantity }] });
        const values = { ...(await this.deliveryValues(trx, d)), ...(await this.receptionValues(trx, rid)) };
        const g = await this.gate(trx, ctx, 'RECEPTION_CONFIRM', values);
        if (!g.allowed) throw this.blocked(g, 'confirmar la recepción');
        await this.storeGate(trx, ctx, user.id, 'reception', rid, g);
        await this.record(trx, ctx, user.id, d, { type: 'WeightRecorded', aggregateType: 'WEIGHING', aggregateId: wid, version: 1,
          payload: { weighing_id: wid, subject_type: 'RECEPTION', subject_id: rid, method: dto.weighing.method.trim(), quantity: dto.weighing.quantity, unit: dto.weighing.unit, weighed_on: dto.weighing.weighed_on } },
        'reception.weigh', { reception_id: rid, quantity: dto.weighing.quantity, unit: dto.weighing.unit }, requestId);
        await this.record(trx, ctx, user.id, d, { type: 'ReceptionConfirmed', aggregateType: 'RECEPTION', aggregateId: rid, version: 1,
          payload: { reception_id: rid, delivery_id: id, location_id: dto.location_id, received_at: new Date(dto.received_at).toISOString(), quantity_received: dto.weighing.quantity, unit: dto.weighing.unit, weighing_id: wid, pending_kde: g.pending.map((p) => p.code) } },
        'reception.confirm', { reception_id: rid, location_id: dto.location_id, quantity: dto.weighing.quantity, unit: dto.weighing.unit, pending: g.pending.map((p) => p.code) }, requestId);
        if (dto.quality_sample) await this.sampleIn(trx, ctx, user.id, d, rid, 'DURING_RECEPTION', randomUUID(), dto.quality_sample, requestId);
        return rid;
      });
      return { replayed: false, reception_id: receptionId, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
    } catch (err) {
      if ((err as { constraint?: string }).constraint === 'receptions_operation_uq') { const r = await replay(); if (r) return r; }
      throw err;
    }
  }

  // ---------- Calidad (separada de la recepción física) ----------

  private async loadReception(db: Db, ctx: TenantContext, deliveryId: string, receptionId: string) {
    const r = await db.selectFrom('receptions').selectAll().where('organization_id', '=', ctx.organizationId).where('delivery_id', '=', deliveryId).where('id', '=', receptionId).executeTakeFirst();
    if (!r) throw notFound();
    return r;
  }

  private async sampleIn(trx: Transaction<Database>, ctx: TenantContext, userId: string, d: Delivery, receptionId: string, moment: 'DURING_RECEPTION' | 'AFTER_WEIGHING', operationId: string, dto: SampleDto, requestId?: string) {
    const sid = randomUUID();
    await trx.insertInto('quality_samples').values({
      id: sid, organization_id: ctx.organizationId, reception_id: receptionId, moment, sample_reference: dto.sample_reference?.trim() || null, sampled_at: new Date(),
      sampled_by_membership_id: ctx.membershipId, sampled_by: userId, operation_id: operationId,
    }).execute();
    await this.record(trx, ctx, userId, d, null, 'quality.sample_record', { reception_id: receptionId, sample_id: sid, moment }, requestId);
    if (dto.result) await this.resultIn(trx, ctx, userId, d, sid, randomUUID(), dto.result, requestId);
    return sid;
  }

  private async resultIn(trx: Transaction<Database>, ctx: TenantContext, userId: string, d: Delivery, sampleId: string, operationId: string, dto: QualityResultFieldsDto, requestId?: string) {
    const decision = dto.decision ?? 'PENDING';
    if (decision !== 'PENDING' && !this.has(ctx, 'quality:decide')) throw forbidden('PERMISSION_DENIED', 'Tu rol no permite liberar ni rechazar calidad; registra el resultado como pendiente de evaluación.');
    if (decision === 'REJECTED' && !dto.decision_reason) throw new AppError(422, 'REASON_REQUIRED', 'Rechazar exige un motivo.', [{ field: 'decision_reason', reason: 'REQUIRED' }]);
    if (decision !== 'RELEASED' && dto.limits_version) throw new AppError(422, 'LIMITS_ONLY_FOR_RELEASE', 'La versión de límites solo se registra al liberar.', [{ field: 'limits_version', reason: 'NOT_APPLICABLE' }]);
    const params = (dto.measurements ?? []).map((m) => m.parameter);
    if (new Set(params).size !== params.length) throw new AppError(422, 'MEASUREMENT_DUPLICATED', 'Un parámetro aparece dos veces.', [{ field: 'measurements', reason: 'DUPLICATED' }]);
    // Compuerta de la decisión ANTES de escribir (liberar exige versión de límites; docs/08).
    let g: Awaited<ReturnType<DeliveriesService['gate']>> | null = null;
    if (decision !== 'PENDING') {
      const moisture = dto.measurements?.find((m) => m.parameter === 'MOISTURE');
      g = await this.gate(trx, ctx, 'QUALITY_DECISION_RECORD', {
        CLASSIFICATION_SAMPLE: sampleId, CLASSIFICATION_METHOD: dto.method.trim(), CLASSIFICATION_DECISION: decision,
        CLASSIFICATION_LIMITS_VERSION: dto.limits_version?.trim() || null, CLASSIFICATION_MOISTURE: moisture ? moisture.value : null,
      });
      if (!g.allowed) throw this.blocked(g, 'registrar la decisión de calidad');
    }
    const rid = randomUUID();
    await trx.insertInto('quality_results').values({
      id: rid, organization_id: ctx.organizationId, sample_id: sampleId, method: dto.method.trim(), decision, limits_version: dto.limits_version?.trim() || null,
      decision_reason: dto.decision_reason?.trim() || null, recorded_by_membership_id: ctx.membershipId, recorded_by: userId, operation_id: operationId,
    }).execute();
    for (const m of dto.measurements ?? []) await trx.insertInto('quality_measurements').values({ id: randomUUID(), organization_id: ctx.organizationId, result_id: rid, parameter: m.parameter, value: m.value, unit: m.unit.trim() }).execute();
    if (decision !== 'PENDING' && g) {
      await this.storeGate(trx, ctx, userId, 'quality_result', rid, g);
      const n = (await trx.selectFrom('domain_events').select(sql<number>`count(*)::int`.as('n')).where('organization_id', '=', ctx.organizationId).where('aggregate_type', '=', 'QUALITY_SAMPLE').where('aggregate_id', '=', sampleId).executeTakeFirstOrThrow()).n;
      await this.record(trx, ctx, userId, d, { type: 'QualityDecisionRecorded', aggregateType: 'QUALITY_SAMPLE', aggregateId: sampleId, version: n + 1,
        payload: { sample_id: sampleId, result_id: rid, decision, method: dto.method.trim(), limits_version: dto.limits_version?.trim() || null, limits_reference_status: dto.limits_version ? 'DECLARED_UNVERIFIED' : null, limits_catalog: 'NOT_AVAILABLE', measurements: (dto.measurements ?? []).map((m) => ({ parameter: m.parameter, value: m.value, unit: m.unit.trim() })) } },
      'quality.decision', { sample_id: sampleId, result_id: rid, decision, limits_version: dto.limits_version?.trim() || null }, requestId);
    } else {
      await this.record(trx, ctx, userId, d, null, 'quality.result_record', { sample_id: sampleId, result_id: rid, decision }, requestId);
    }
    return rid;
  }

  async addSample(user: AuthUser, orgId: string, id: string, receptionId: string, dto: AfterSampleDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, ['quality:record'], true);
    const prior = await this.db.selectFrom('quality_samples').select(['id', 'reception_id']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.reception_id !== receptionId) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, sample_id: prior.id, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
    }
    const sid = await this.db.transaction().execute(async (trx) => {
      const d = await this.loadDelivery(trx, ctx, id, 'read');
      await this.loadReception(trx, ctx, id, receptionId);
      return this.sampleIn(trx, ctx, user.id, d, receptionId, 'AFTER_WEIGHING', dto.operation_id, dto, requestId);
    });
    return { replayed: false, sample_id: sid, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
  }

  async addResult(user: AuthUser, orgId: string, id: string, receptionId: string, sampleId: string, dto: QualityResultDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, ['quality:record', 'quality:decide'], true);
    const prior = await this.db.selectFrom('quality_results').select(['id', 'sample_id', 'decision']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.sample_id !== sampleId || prior.decision !== (dto.decision ?? 'PENDING')) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, result_id: prior.id, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
    }
    const rid = await this.db.transaction().execute(async (trx) => {
      const d = await this.loadDelivery(trx, ctx, id, 'read');
      await this.loadReception(trx, ctx, id, receptionId);
      const s = await trx.selectFrom('quality_samples').select('id').where('organization_id', '=', orgId).where('reception_id', '=', receptionId).where('id', '=', sampleId).forUpdate().executeTakeFirst();
      if (!s) throw notFound();
      return this.resultIn(trx, ctx, user.id, d, sampleId, dto.operation_id, dto, requestId);
    });
    return { replayed: false, result_id: rid, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
  }

  // ---------- Correcciones (contratos específicos; originales intactos) ----------

  async correctDelivery(user: AuthUser, orgId: string, id: string, dto: DeliveryCorrectionDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, ['delivery:correct'], true);
    const prior = await this.db.selectFrom('delivery_corrections').select(['id', 'delivery_id', 'reason']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.delivery_id !== id || prior.reason !== dto.reason.trim()) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
    }
    return this.db.transaction().execute(async (trx) => {
      const d = await this.loadDelivery(trx, ctx, id, 'read', true);
      if (d.status !== 'REGISTERED') throw conflict('DELIVERY_NOT_REGISTERED', 'Un borrador se edita directamente; solo se corrige una entrega registrada.');
      if (Number(d.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó esta entrega. Recarga antes de corregir.');
      const cur = await this.effective(trx, d);
      const f = dto.fields;
      const harvest = f.harvest_period ? harvestColumns(f.harvest_period)! : null;
      if (f.quantity_declared && scaled(f.quantity_declared) <= 0n) throw new AppError(422, 'MUST_BE_POSITIVE', 'La cantidad declarada debe ser mayor que cero.', [{ field: 'quantity_declared', reason: 'MUST_BE_POSITIVE' }]);
      const next = {
        delivery_date: f.delivery_date ?? ymd(cur.delivery_date)!, quantity_declared: f.quantity_declared ?? cur.quantity_declared!,
        harvest_precision: harvest ? harvest.harvest_precision : cur.harvest_precision, harvest_start: harvest ? harvest.harvest_start : cur.harvest_start, harvest_end: harvest ? harvest.harvest_end : cur.harvest_end,
        harvest_derived_start: harvest ? harvest.harvest_derived_start : cur.harvest_derived_start ? ymd(cur.harvest_derived_start)! : null,
        harvest_derived_end: harvest ? harvest.harvest_derived_end : cur.harvest_derived_end ? ymd(cur.harvest_derived_end)! : null,
        notes: f.notes !== undefined ? f.notes.trim() || null : cur.notes,
      };
      const changed: string[] = [];
      if (next.delivery_date !== ymd(cur.delivery_date)!) changed.push('delivery_date');
      if (scaled(next.quantity_declared) !== scaled(cur.quantity_declared!)) changed.push('quantity_declared');
      if (harvest && (next.harvest_precision !== cur.harvest_precision || next.harvest_start !== cur.harvest_start || next.harvest_end !== cur.harvest_end)) changed.push('harvest_period');
      if (next.notes !== cur.notes) changed.push('notes');
      if (!changed.length) throw new AppError(422, 'NO_CHANGES', 'La corrección no cambia ningún dato.', []);
      // Dependencias posteriores: la fecha de entrega no puede quedar después de una recepción ya confirmada.
      if (changed.includes('delivery_date')) {
        const first = await trx.selectFrom('receptions').select(sql<string>`min(received_at)::date::text`.as('d')).where('delivery_id', '=', id).executeTakeFirst();
        if (first?.d && next.delivery_date > first.d) throw conflict('CORRECTION_CONFLICTS_WITH_RECEPTIONS', `La fecha corregida (${next.delivery_date}) es posterior a una recepción ya confirmada (${first.d}). Corrige primero la recepción o revisa la fecha.`);
      }
      const lastEvent = await trx.selectFrom('domain_events').select('event_id').where('organization_id', '=', orgId).where('aggregate_type', '=', 'DELIVERY').where('aggregate_id', '=', id).orderBy('aggregate_version', 'desc').executeTakeFirstOrThrow();
      const after = await trx.updateTable('deliveries').set({ row_version: sql`row_version + 1`, updated_at: new Date() } as never).where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
      const ev = await this.record(trx, ctx, user.id, d, {
        type: 'DeliveryCorrected', aggregateType: 'DELIVERY', aggregateId: id, version: Number(after.row_version), correctionOf: { eventId: lastEvent.event_id, reason: dto.reason.trim() },
        payload: { delivery_id: id, changed_fields: changed, delivery_date: next.delivery_date, quantity_declared: next.quantity_declared, unit: d.unit, harvest_period: periodValue(next.harvest_precision, next.harvest_start, next.harvest_end) },
      }, 'delivery.correct', { changed_fields: changed, corrected_event_id: lastEvent.event_id, reason: dto.reason.trim(), version: Number(after.row_version) }, requestId);
      await trx.insertInto('delivery_corrections').values({
        id: randomUUID(), organization_id: orgId, delivery_id: id, correction_number: cur.correction_number + 1, corrected_event_id: lastEvent.event_id, correction_event_id: ev!.event_id,
        reason: dto.reason.trim(), changed_fields: changed, ...next, created_by: user.id, operation_id: dto.operation_id,
      }).execute();
      return { replayed: false, delivery: await this.view(trx, ctx, { ...after, producer_assignee: d.producer_assignee }) };
    });
  }

  async correctReception(user: AuthUser, orgId: string, id: string, receptionId: string, dto: ReceptionCorrectionDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, ['reception:correct'], true);
    const prior = await this.db.selectFrom('reception_adjustments').select(['id', 'reception_id', 'new_quantity']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.reception_id !== receptionId || scaled(dec(prior.new_quantity)!) !== scaled(dto.weighing.quantity)) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
    }
    return this.db.transaction().execute(async (trx) => {
      const d = await this.loadDelivery(trx, ctx, id, 'read', true);
      const r = await this.loadReception(trx, ctx, id, receptionId);
      // D-39.2 (P0-016): con asignaciones activas a lotes (y por tanto posibles reservas o consumo) no se corrige el peso.
      await sql`SELECT id FROM receptions WHERE id = ${receptionId} FOR UPDATE`.execute(trx);
      const assigned = await trx.selectFrom('lot_inputs').select('id').where('reception_id', '=', receptionId)
        .where(({ not, exists, selectFrom }) => not(exists(selectFrom('lot_input_releases').select('input_id').whereRef('lot_input_releases.input_id', '=', 'lot_inputs.id')))).executeTakeFirst();
      // Aunque la asignación se liberara, si su lote llegó a consumirse no hay corrección de efectos posteriores.
      const consumed = await sql<{ n: number }>`SELECT count(*)::int AS n FROM lot_inputs i JOIN process_inputs p ON p.lot_id = i.lot_id JOIN process_runs pr ON pr.id = p.run_id
        WHERE i.reception_id = ${receptionId} AND pr.status = 'CLOSED'`.execute(trx);
      if (consumed.rows[0].n > 0) throw conflict('RECEPTION_CONSUMED_DOWNSTREAM', 'Material de esta recepción llegó a un lote ya consumido por un proceso: no se corrige su peso (no existe corrección de efectos posteriores).');
      if (assigned) throw conflict('RECEPTION_ASSIGNED_TO_LOT', 'La recepción tiene cantidades asignadas a lotes: no se corrige su peso mientras exista la asignación (libérala primero si no hay reservas ni consumo).');
      const adjustments = await trx.selectFrom('reception_adjustments').selectAll().where('reception_id', '=', receptionId).orderBy('adjustment_number', 'desc').execute();
      const version = adjustments.length + 1;
      if (version !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'La recepción ya fue corregida por otra persona. Recarga.');
      const current = adjustments[0] ? dec(adjustments[0].new_quantity)! : dec(r.quantity_received)!;
      if (scaled(current) === scaled(dto.weighing.quantity)) throw new AppError(422, 'NO_CHANGES', 'El peso corregido es igual al vigente.', []);
      const lastW = await trx.selectFrom('weighings').select('id').where('reception_id', '=', receptionId).orderBy('created_at', 'desc').orderBy('id', 'desc').executeTakeFirstOrThrow();
      const wid = randomUUID();
      await trx.insertInto('weighings').values({
        id: wid, organization_id: orgId, reception_id: receptionId, method: dto.weighing.method.trim(), quantity: dto.weighing.quantity, unit: dto.weighing.unit, weighed_on: dto.weighing.weighed_on,
        responsible_membership_id: ctx.membershipId, responsible_user_id: user.id, corrects_weighing_id: lastW.id,
      }).execute();
      const lastEvent = await trx.selectFrom('domain_events').select('event_id').where('organization_id', '=', orgId).where('aggregate_type', '=', 'RECEPTION').where('aggregate_id', '=', receptionId).orderBy('aggregate_version', 'desc').executeTakeFirstOrThrow();
      await this.record(trx, ctx, user.id, d, { type: 'WeightRecorded', aggregateType: 'WEIGHING', aggregateId: wid, version: 1,
        payload: { weighing_id: wid, subject_type: 'RECEPTION', subject_id: receptionId, method: dto.weighing.method.trim(), quantity: dto.weighing.quantity, unit: dto.weighing.unit, weighed_on: dto.weighing.weighed_on, corrects_weighing_id: lastW.id } },
      'reception.weigh', { reception_id: receptionId, quantity: dto.weighing.quantity, unit: dto.weighing.unit }, requestId);
      const ev = await this.record(trx, ctx, user.id, d, { type: 'ReceptionCorrected', aggregateType: 'RECEPTION', aggregateId: receptionId, version: version + 1, correctionOf: { eventId: lastEvent.event_id, reason: dto.reason.trim() },
        payload: { reception_id: receptionId, delivery_id: id, previous_quantity: current, new_quantity: dto.weighing.quantity, unit: dto.weighing.unit, weighing_id: wid } },
      'reception.correct', { reception_id: receptionId, quantity: dto.weighing.quantity, unit: dto.weighing.unit, corrected_event_id: lastEvent.event_id, reason: dto.reason.trim() }, requestId);
      const adjId = randomUUID();
      await trx.insertInto('reception_adjustments').values({
        id: adjId, organization_id: orgId, reception_id: receptionId, adjustment_number: version, weighing_id: wid, previous_quantity: current, new_quantity: dto.weighing.quantity,
        reason: dto.reason.trim(), corrected_event_id: lastEvent.event_id, correction_event_id: ev!.event_id, created_by: user.id, operation_id: dto.operation_id,
      }).execute();
      // Ledger: solo la diferencia; la entrada original se conserva (append-only).
      await postMovement(trx, { organizationId: orgId, type: 'RECEPTION_CORRECTION', sourceType: 'reception_adjustment', sourceId: adjId, operationId: dto.operation_id, actorId: user.id, reason: dto.reason.trim(),
        lines: [{ reception_id: receptionId, location_id: r.location_id, bucket: 'PHYSICAL', quantity: unscaled(scaled(dto.weighing.quantity) - scaled(current)) }] });
      return { replayed: false, delivery: await this.view(trx, ctx, d) };
    });
  }

  // ---------- Lecturas ----------

  async list(user: AuthUser, orgId: string, q: ListQuery) {
    const ctx = await this.ctx(user, orgId, ['delivery:read', 'delivery:read_assigned', 'delivery:read_own'], false);
    const identity = this.has(ctx, 'producer:read_identity') && (this.has(ctx, 'producer:read') || this.has(ctx, 'producer:read_assigned'));
    const rows = await sql<{
      id: string; delivery_code: string; status: string; delivery_date: string | null; quantity_declared: string | null; unit: string | null; producer_id: string; producer_code: string;
      legal_name: string | null; first_name: string | null; last_name: string | null; product_name: string | null; received: string | null; receptions: number; harvest_precision: string | null;
      corrected_quantity: string | null; corrected_date: string | null;
    }>`
      SELECT d.id, d.delivery_code, d.status, d.delivery_date::text, d.quantity_declared::text, d.unit, d.producer_id, pr.producer_code, pr.legal_name, pr.first_name, pr.last_name,
             p.name AS product_name, d.harvest_precision,
             (SELECT c.quantity_declared::text FROM delivery_corrections c WHERE c.delivery_id = d.id ORDER BY c.correction_number DESC LIMIT 1) AS corrected_quantity,
             (SELECT c.delivery_date::text FROM delivery_corrections c WHERE c.delivery_id = d.id ORDER BY c.correction_number DESC LIMIT 1) AS corrected_date,
             (SELECT sum(coalesce((SELECT a.new_quantity FROM reception_adjustments a WHERE a.reception_id = r.id ORDER BY a.adjustment_number DESC LIMIT 1), r.quantity_received))::text FROM receptions r WHERE r.delivery_id = d.id) AS received,
             (SELECT count(*)::int FROM receptions r WHERE r.delivery_id = d.id) AS receptions
      FROM deliveries d
      JOIN producers pr ON pr.id = d.producer_id AND pr.organization_id = d.organization_id
      LEFT JOIN products p ON p.id = d.product_id AND p.organization_id = d.organization_id
      WHERE d.organization_id = ${orgId} AND ${this.listScope(ctx)}
        ${q.status ? sql`AND d.status = ${q.status}` : sql``}
        ${q.producer_id ? sql`AND d.producer_id = ${q.producer_id}` : sql``}
        ${q.q ? sql`AND (d.delivery_code ILIKE ${'%' + q.q + '%'} OR pr.producer_code ILIKE ${'%' + q.q + '%'})` : sql``}
      ORDER BY d.created_at DESC LIMIT 200`.execute(this.db);
    const items = rows.rows.map((r) => {
      const declared = dec(r.corrected_quantity ?? r.quantity_declared);
      const received = dec(r.received);
      const reception = this.receptionStatus(declared, received, r.receptions);
      return {
        id: r.id, delivery_code: r.delivery_code, status: r.status, delivery_date: r.corrected_date ?? r.delivery_date,
        producer: { id: r.producer_id, code: r.producer_code, name: identity ? (r.legal_name ?? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()) || null : null },
        product: r.product_name, quantity_declared: declared ? { value: declared, unit: r.unit } : null, received: received ? { value: received, unit: 'KG' } : null,
        receptions: r.receptions, reception_status: reception, reception_status_label: RECEPTION_LABEL[reception], harvest_precision: r.harvest_precision,
      };
    });
    return q.reception ? items.filter((i) => i.reception_status === q.reception) : items;
  }

  private receptionStatus(declared: string | null, received: string | null, count: number) {
    if (!count || !received) return 'NOT_RECEIVED';
    if (!declared) return 'PARTIAL';
    const a = scaled(received); const b = scaled(declared);
    return a < b ? 'PARTIAL' : a === b ? 'RECEIVED_DECLARED' : 'ABOVE_DECLARED';
  }

  async detail(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, ['delivery:read', 'delivery:read_assigned'], false);
    return this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read'));
  }

  // ---------- Cierre de entregas (D-33, adoptada como regla provisional del MVP local el 2026-10-15) ----------

  /** Diferencia vigente: declarado efectivo (tras correcciones) − suma de recepciones vigentes. */
  private async difference(db: Db, d: Delivery) {
    const e = await this.effective(db, d);
    const declared = scaled(e.quantity_declared ?? '0');
    // «Vigente» = el último peso corregido de cada recepción, o el original si no se corrigió. Sumar
    // `quantity_received` a secas ignoraba las correcciones y dejaba la diferencia congelada en la cifra
    // original: es la misma expresión que ya usa el listado.
    const r = await sql<{ total: string | null }>`
      SELECT sum(coalesce((SELECT a.new_quantity FROM reception_adjustments a WHERE a.reception_id = r.id ORDER BY a.adjustment_number DESC LIMIT 1), r.quantity_received))::text AS total
      FROM receptions r WHERE r.delivery_id = ${d.id}`.execute(db);
    const received = scaled(r.rows[0].total ?? '0');
    return { declared, received, difference: declared - received };
  }

  /**
   * Estado DERIVADO del cierre, nunca almacenado, para que no pueda quedar desincronizado con las cifras:
   * - `OPEN`: sin justificación de cierre;
   * - `CLOSED`: la última justificación explica la diferencia vigente;
   * - `CLOSED_JUSTIFICATION_STALE`: cerrada, pero una corrección admitida cambió la diferencia y el motivo
   *   vigente explica una cifra que ya no existe. **La entrega sigue cerrada**: falta explicar la cifra nueva.
   */
  private async closure(db: Db, ctx: TenantContext, d: Delivery) {
    const rows = await db.selectFrom('delivery_closures as c').leftJoin('users as u', 'u.id', 'c.justified_by')
      .select(['c.justification_number', 'c.kind', 'c.declared_quantity', 'c.received_quantity', 'c.difference', 'c.reason', 'c.justified_at', 'u.first_name', 'u.last_name'])
      .where('c.organization_id', '=', ctx.organizationId).where('c.delivery_id', '=', d.id).orderBy('c.justification_number').execute();
    const actual = await this.difference(db, d);
    const last = rows[rows.length - 1];
    const stale = !!last && scaled(dec(last.difference)!) !== actual.difference;
    const status = !last ? 'OPEN' : stale ? 'CLOSED_JUSTIFICATION_STALE' : 'CLOSED';
    return {
      status,
      label: status === 'OPEN' ? 'Abierta' : status === 'CLOSED' ? 'Cerrada y justificada' : 'Cerrada, justificación desactualizada',
      note: status === 'CLOSED_JUSTIFICATION_STALE'
        ? 'Una corrección admitida cambió la diferencia después del cierre. El cierre y su motivo se conservan tal cual; hace falta añadir una justificación para la cifra nueva. La entrega sigue cerrada: no se reabre ni admite recepciones.'
        : status === 'CLOSED' ? 'Cerrada con su diferencia justificada. Cerrar no equivale a conformidad de ningún tipo.'
          : 'La entrega no se ha cerrado; admite recepciones.',
      // Cifras vigentes con su unidad explícita, como el resto de pesos de la vista. La resta presume una sola
      // unidad en la entrega: declarado y recibido comparten la de la entrega.
      current: { declared: { value: unscaled(actual.declared), unit: d.unit }, received: { value: unscaled(actual.received), unit: d.unit }, difference: { value: unscaled(actual.difference), unit: d.unit } },
      justifications: rows.map((r) => ({
        number: r.justification_number, kind: r.kind, reason: r.reason,
        declared: { value: dec(r.declared_quantity)!, unit: d.unit }, received: { value: dec(r.received_quantity)!, unit: d.unit }, difference: { value: dec(r.difference)!, unit: d.unit },
        at: r.justified_at, by: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || 'Miembro',
      })),
      stale,
    };
  }

  /** Cierra la entrega. Con diferencia exige además `delivery:correct`: afirmar una pérdida no es rutina. */
  async closeDelivery(user: AuthUser, orgId: string, id: string, dto: CloseDeliveryDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, ['reception:confirm'], true);
    const prior = await this.db.selectFrom('delivery_closures').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.delivery_id !== id) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó en otra entrega.');
      return { replayed: true, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
    }
    let replayed = false;
    await this.db.transaction().execute(async (trx) => {
      const d = await this.loadDelivery(trx, ctx, id, 'read', true);
      // El reintento se reconoce AQUÍ, ya con la fila bloqueada: dos envíos simultáneos con el mismo
      // `operation_id` se serializan y el segundo encuentra su propio cierre. Comprobarlo solo antes de la
      // transacción dejaba al segundo chocando contra la versión que el primero acababa de incrementar, y un
      // reintento idéntico habría parecido un conflicto.
      const yaCerrado = await trx.selectFrom('delivery_closures').select(['id']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
      if (yaCerrado) { replayed = true; return; }
      if (Number(d.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'La entrega cambió desde que la consultaste; vuelve a cargarla.');
      if (d.status === 'CLOSED') throw conflict('DELIVERY_ALREADY_CLOSED', 'La entrega ya está cerrada; un cierre no se repite ni se deshace.');
      if (d.status !== 'REGISTERED') throw conflict('DELIVERY_NOT_REGISTERED', 'Solo se cierra una entrega registrada.');
      const { declared, received, difference } = await this.difference(trx, d);
      if (received === 0n) throw conflict('NO_RECEPTIONS', 'La entrega no tiene ninguna recepción: no hay nada que cerrar.');
      const reason = dto.reason?.trim() || null;
      if (difference !== 0n && !reason) {
        throw new AppError(422, 'DIFFERENCE_REASON_REQUIRED', `Hay una diferencia de ${unscaled(difference)} KG entre lo declarado y lo recibido: cerrar exige explicarla. Cerrar con diferencia está permitido; dejarla sin motivo, no.`, [{ field: 'reason', reason: 'REQUIRED_WITH_DIFFERENCE' }]);
      }
      if (difference !== 0n && !this.has(ctx, 'delivery:correct')) {
        throw forbidden('PERMISSION_DENIED', 'Cerrar una entrega con diferencia afirma una pérdida o un excedente: requiere delivery:correct, no solo confirmar recepciones.');
      }
      await trx.insertInto('delivery_closures').values({
        id: randomUUID(), organization_id: orgId, delivery_id: id, justification_number: 1, kind: 'CLOSE',
        declared_quantity: unscaled(declared), received_quantity: unscaled(received), difference: unscaled(difference),
        reason, justified_by: user.id, operation_id: dto.operation_id,
      }).execute();
      const after = await trx.updateTable('deliveries').set({ status: 'CLOSED', row_version: sql`row_version + 1` } as never)
        .where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await this.record(trx, ctx, user.id, d, {
        type: 'DeliveryClosed', aggregateType: 'DELIVERY', aggregateId: id, version: Number(after.row_version),
        payload: { delivery_id: id, declared: unscaled(declared), received: unscaled(received), difference: unscaled(difference), unit: 'KG', has_difference: difference !== 0n },
      }, 'delivery.close', { difference: unscaled(difference), unit: 'KG' }, requestId, reason ?? undefined);
    });
    return { replayed, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
  }

  /** Añade una justificación cuando la diferencia cambió tras el cierre. Nunca sustituye el motivo anterior. */
  async justifyClosure(user: AuthUser, orgId: string, id: string, dto: JustifyClosureDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, ['delivery:correct'], true);
    const prior = await this.db.selectFrom('delivery_closures').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.delivery_id !== id) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó en otra entrega.');
      return { replayed: true, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
    }
    let replayed = false;
    await this.db.transaction().execute(async (trx) => {
      const d = await this.loadDelivery(trx, ctx, id, 'read', true);
      const yaJustificado = await trx.selectFrom('delivery_closures').select(['id']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
      if (yaJustificado) { replayed = true; return; }
      if (d.status !== 'CLOSED') throw conflict('DELIVERY_NOT_CLOSED', 'Solo se justifica de nuevo el cierre de una entrega cerrada.');
      const last = await trx.selectFrom('delivery_closures').selectAll().where('delivery_id', '=', id).orderBy('justification_number', 'desc').executeTakeFirstOrThrow();
      const { declared, received, difference } = await this.difference(trx, d);
      if (scaled(dec(last.difference)!) === difference) {
        throw conflict('JUSTIFICATION_NOT_STALE', 'La justificación vigente ya explica la diferencia actual: no hay nada que actualizar.');
      }
      await trx.insertInto('delivery_closures').values({
        id: randomUUID(), organization_id: orgId, delivery_id: id, justification_number: last.justification_number + 1, kind: 'REJUSTIFY',
        declared_quantity: unscaled(declared), received_quantity: unscaled(received), difference: unscaled(difference),
        reason: dto.reason.trim(), justified_by: user.id, operation_id: dto.operation_id,
      }).execute();
      const after = await trx.updateTable('deliveries').set({ row_version: sql`row_version + 1` } as never).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await this.record(trx, ctx, user.id, d, {
        type: 'DeliveryClosureJustified', aggregateType: 'DELIVERY', aggregateId: id, version: Number(after.row_version),
        payload: { delivery_id: id, justification_number: last.justification_number + 1, previous_difference: dec(last.difference), difference: unscaled(difference), unit: 'KG' },
      }, 'delivery.closure_justify', { justification_number: last.justification_number + 1, difference: unscaled(difference) }, requestId, dto.reason.trim());
    });
    return { replayed, delivery: await this.view(this.db, ctx, await this.loadDelivery(this.db, ctx, id, 'read')) };
  }

  private async view(db: Db, ctx: TenantContext, d: Delivery & { producer_assignee: string | null }) {
    const has = (p: Permission) => this.has(ctx, p);
    const e = await this.effective(db, d);
    const producer = await db.selectFrom('producers').select(['id', 'producer_code', 'legal_name', 'first_name', 'last_name', 'status']).where('id', '=', d.producer_id).executeTakeFirstOrThrow();
    const identity = has('producer:read_identity') && (has('producer:read') || (has('producer:read_assigned') && d.producer_assignee === ctx.membershipId));
    const product = d.product_id ? await db.selectFrom('products').select(['id', 'code', 'name', 'unit', 'status']).where('id', '=', d.product_id).executeTakeFirst() : null;
    const location = d.location_id ? await db.selectFrom('locations').select(['id', 'code', 'name']).where('id', '=', d.location_id).executeTakeFirst() : null;
    const origins = await db.selectFrom('delivery_origins as o').innerJoin('plots as p', 'p.id', 'o.plot_id').select(['o.plot_id', 'p.plot_code', 'o.origin_quantity']).where('o.delivery_id', '=', d.id).orderBy('p.plot_code').execute();
    // Parcelas de origen: con lectura de parcelas en alcance, o con la capacidad de declarar origen (las mismas parcelas que ya
    // ofrece /deliveries/options). Si no, el aviso sale por permiso y la respuesta no revela existencia, códigos ni cantidades.
    const assigned = d.producer_assignee === ctx.membershipId;
    const plotsVisible = has('plot:read') || (has('plot:read_assigned') && assigned) || has('delivery:create') || (has('delivery:create_assigned') && assigned);
    const corrections = await db.selectFrom('delivery_corrections as c').leftJoin('users as u', 'u.id', 'c.created_by')
      .select(['c.correction_number', 'c.reason', 'c.changed_fields', 'c.delivery_date', 'c.quantity_declared', 'c.harvest_precision', 'c.harvest_start', 'c.harvest_end', 'c.created_at', 'c.corrected_event_id', 'c.correction_event_id', 'u.first_name', 'u.last_name'])
      .where('c.delivery_id', '=', d.id).orderBy('c.correction_number').execute();

    // Soportes: detalle solo para quien puede leer documentos del titular (privacidad como P0-019).
    const rawSupports = await sql<{ id: string; support_kind: string; document_id: string; document_version_id: string; title: string; version_number: number; owner_type: string; owner_id: string;
      scan: string | null; expired: boolean; expires_at: string | null; review: string | null; newer: boolean; withdrawn_reason: string | null; withdrawn_at: string | null; added_at: string }>`
      SELECT s.id, s.support_kind, s.document_id, s.document_version_id, doc.title, v.version_number, doc.owner_type, doc.owner_id,
             (SELECT sc.result FROM document_version_scans sc WHERE sc.version_id = v.id ORDER BY sc.id DESC LIMIT 1) AS scan,
             (v.expires_at IS NOT NULL AND v.expires_at < current_date) AS expired, v.expires_at::text,
             (SELECT r.decision FROM document_version_reviews r WHERE r.version_id = v.id ORDER BY r.id DESC LIMIT 1) AS review,
             EXISTS (SELECT 1 FROM document_versions x WHERE x.document_id = doc.id AND x.version_number > v.version_number) AS newer,
             w.reason AS withdrawn_reason, w.withdrawn_at, s.added_at
      FROM delivery_supports s JOIN document_versions v ON v.id = s.document_version_id AND v.organization_id = s.organization_id
      JOIN documents doc ON doc.id = s.document_id AND doc.organization_id = s.organization_id
      LEFT JOIN delivery_support_withdrawals w ON w.support_id = s.id
      WHERE s.delivery_id = ${d.id} ORDER BY s.added_at`.execute(db);
    const supports = [];
    if (has('document:read')) {
      for (const s of rawSupports.rows) {
        if (!(await this.documentScopeOk(db, ctx, s.owner_type, s.owner_id))) continue;
        supports.push({
          id: s.id, kind: s.support_kind, document_id: s.document_id, document_version_id: s.document_version_id, title: s.title, version_number: s.version_number,
          availability: s.scan === 'CLEAN' ? 'AVAILABLE' : s.scan === 'INFECTED' ? 'REJECTED' : s.scan === 'FAILED' ? 'SCAN_FAILED' : 'PENDING',
          validity: s.expires_at ? (s.expired ? 'EXPIRED' : 'VALID_UNTIL') : 'NO_EXPIRY', expires_at: s.expires_at, review: s.review ?? 'NOT_REVIEWED', newer_version_exists: s.newer,
          withdrawn: s.withdrawn_at ? { reason: s.withdrawn_reason, at: s.withdrawn_at } : null, added_at: s.added_at,
        });
      }
    }
    const activeSupports = rawSupports.rows.filter((s) => !s.withdrawn_at).length;

    // Recepciones con pesajes, ajustes, compuerta y calidad.
    const receptionsRaw = await db.selectFrom('receptions as r').innerJoin('locations as l', 'l.id', 'r.location_id').leftJoin('users as u', 'u.id', 'r.receiver_user_id')
      .select(['r.id', 'r.received_at', 'r.quantity_received', 'r.unit', 'r.notes', 'r.created_at', 'l.code as location_code', 'l.name as location_name', 'u.first_name', 'u.last_name'])
      .where('r.delivery_id', '=', d.id).where('r.organization_id', '=', d.organization_id).orderBy('r.received_at').orderBy('r.created_at').execute();
    const receptions = [];
    let received = 0n;
    for (const r of receptionsRaw) {
      const weighings = await db.selectFrom('weighings as w').leftJoin('users as u', 'u.id', 'w.responsible_user_id')
        .select(['w.id', 'w.method', 'w.quantity', 'w.unit', 'w.weighed_on', 'w.corrects_weighing_id', 'w.created_at', 'u.first_name', 'u.last_name']).where('w.reception_id', '=', r.id).orderBy('w.created_at').execute();
      const adjustments = await db.selectFrom('reception_adjustments as a').leftJoin('users as u', 'u.id', 'a.created_by')
        .select(['a.adjustment_number', 'a.previous_quantity', 'a.new_quantity', 'a.reason', 'a.created_at', 'a.corrected_event_id', 'a.correction_event_id', 'u.first_name', 'u.last_name']).where('a.reception_id', '=', r.id).orderBy('a.adjustment_number').execute();
      const effectiveQty = adjustments.length ? dec(adjustments[adjustments.length - 1].new_quantity)! : dec(r.quantity_received)!;
      received += scaled(effectiveQty);
      const gate = await db.selectFrom('gate_evaluations').select(['transition', 'release_version', 'allowed', 'result', 'evaluated_at']).where('entity_type', '=', 'reception').where('entity_id', '=', r.id).orderBy('evaluated_at').executeTakeFirst();
      const samples = await db.selectFrom('quality_samples as s').leftJoin('users as u', 'u.id', 's.sampled_by')
        .select(['s.id', 's.moment', 's.sample_reference', 's.sampled_at', 'u.first_name', 'u.last_name']).where('s.reception_id', '=', r.id).orderBy('s.sampled_at').execute();
      const sampleViews = [];
      let latest: { decision: string; at: Date } | null = null;
      for (const s of samples) {
        const results = await db.selectFrom('quality_results as q').leftJoin('users as u', 'u.id', 'q.recorded_by')
          .select(['q.id', 'q.method', 'q.decision', 'q.limits_version', 'q.decision_reason', 'q.recorded_at', 'u.first_name', 'u.last_name']).where('q.sample_id', '=', s.id).orderBy('q.recorded_at').execute();
        const views = [];
        for (const q of results) {
          const ms = await db.selectFrom('quality_measurements').select(['parameter', 'value', 'unit']).where('result_id', '=', q.id).orderBy('parameter').execute();
          views.push({ id: q.id, method: q.method, decision: q.decision, decision_reason: q.decision_reason, recorded_at: q.recorded_at,
            limits_reference: q.limits_version ? { value: q.limits_version, status: 'DECLARED_UNVERIFIED', note: 'Referencia escrita por quien decide. No hay catálogo publicado de límites: el sistema no la comprobó.' } : null,
            recorded_by: `${q.first_name ?? ''} ${q.last_name ?? ''}`.trim() || 'Miembro', measurements: ms.map((m) => ({ parameter: m.parameter, value: dec(m.value)!, unit: m.unit })) });
          if (q.decision !== 'PENDING' && (!latest || new Date(q.recorded_at as unknown as string) >= latest.at)) latest = { decision: q.decision, at: new Date(q.recorded_at as unknown as string) };
        }
        sampleViews.push({ id: s.id, moment: s.moment, sample_reference: s.sample_reference, sampled_at: s.sampled_at, sampled_by: `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || 'Miembro', results: views });
      }
      receptions.push({
        id: r.id, received_at: r.received_at, location: { code: r.location_code, name: r.location_name }, receiver: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || 'Miembro',
        quantity_received: { value: effectiveQty, unit: r.unit }, original_quantity: { value: dec(r.quantity_received)!, unit: r.unit }, version: adjustments.length + 1, notes: r.notes,
        weighings: weighings.map((w) => ({ id: w.id, method: w.method, quantity: { value: dec(w.quantity)!, unit: w.unit }, weighed_on: ymd(w.weighed_on)!, corrects_weighing_id: w.corrects_weighing_id,
          responsible: `${w.first_name ?? ''} ${w.last_name ?? ''}`.trim() || 'Miembro', recorded_at: w.created_at })),
        adjustments: adjustments.map((a) => ({ number: a.adjustment_number, previous_quantity: dec(a.previous_quantity)!, new_quantity: dec(a.new_quantity)!, reason: a.reason, at: a.created_at,
          by: `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || 'Miembro', corrected_event_id: a.corrected_event_id, correction_event_id: a.correction_event_id })),
        confirmation_gate: gate ? { transition: gate.transition, release: gate.release_version, allowed: gate.allowed, ...(gate.result as object), evaluated_at: gate.evaluated_at } : null,
        quality: { status: latest ? latest.decision : 'PENDING_EVALUATION',
          status_label: latest ? (latest.decision === 'RELEASED' ? 'Calidad liberada por decisión humana (límites declarados, no verificados)' : 'Calidad rechazada por decisión humana') : 'Pendiente de evaluación',
          limits_verification: 'NOT_AVAILABLE', samples: sampleViews,
          note: 'Estado de calidad separado de la recepción física. La decisión es humana y queda con su responsable; sin catálogo de límites el sistema no verificó límites. No es liberación jurídica ni conformidad.' },
        // Tres estados distintos: recepción física (registrada), decisión de calidad (arriba) y habilitación posterior (aquí).
        downstream_enablement: { status: 'NOT_EVALUATED', note: 'Ninguna operación posterior (lote, procesamiento, inventario) existe ni se habilita por esta recepción o su decisión de calidad; sin catálogo de límites no se habilitará por un texto (P0-016/P0-017).' },
      });
    }
    const declared = e.quantity_declared;
    const receivedStr = receptions.length ? unscaled(received) : null;
    const recStatus = this.receptionStatus(declared, receivedStr, receptions.length);

    // Compuertas vigentes (evaluación actual; sin valores).
    const values = await this.deliveryValues(db, d);
    const gates: Record<string, unknown> = {};
    if (d.status === 'DRAFT') gates.register = await this.gate(db, ctx, 'DELIVERY_REGISTER', values);
    else gates.registration = (await db.selectFrom('gate_evaluations').select(['transition', 'release_version', 'allowed', 'result', 'evaluated_at']).where('entity_type', '=', 'delivery').where('entity_id', '=', d.id).orderBy('evaluated_at').executeTakeFirst()) ?? null;
    if (d.status === 'REGISTERED') gates.reception_preview = await this.gate(db, ctx, 'RECEPTION_CONFIRM', { ...values, RECEPTION_DELIVERY: d.id });
    const lastReception = receptionsRaw.length ? await this.receptionValues(db, receptionsRaw[receptionsRaw.length - 1].id) : {};
    gates.completeness = await this.gate(db, ctx, 'TRACEABILITY_COMPLETENESS', { ...values, ...lastReception });
    gates.downstream = await this.gate(db, ctx, 'DOWNSTREAM_READINESS', {});

    const history = await this.history(db, d.organization_id, d.id, receptionsRaw.map((r) => r.id));
    const canWrite = this.canWrite(ctx, d.producer_assignee);
    return {
      id: d.id, delivery_code: d.delivery_code, status: d.status, row_version: Number(d.row_version),
      producer: { id: producer.id, code: producer.producer_code, name: identity ? (producer.legal_name ?? `${producer.first_name ?? ''} ${producer.last_name ?? ''}`.trim()) || null : null, identity_visible: identity },
      product: product ? { id: product.id, code: product.code, name: product.name, status: product.status } : null,
      location: location ?? null,
      delivery_date: e.delivery_date ? ymd(e.delivery_date)! : null,
      quantity_declared: declared ? { value: declared, unit: d.unit } : null,
      harvest_period: e.harvest_precision ? {
        precision: e.harvest_precision, start: e.harvest_start, end: e.harvest_end,
        derived: e.harvest_derived_start ? { start: ymd(e.harvest_derived_start)!, end: ymd(e.harvest_derived_end)!, note: 'Límites derivados para consultas; la declaración original es la de arriba.' } : null,
      } : null,
      origins: plotsVisible ? origins.map((o) => ({ plot_id: o.plot_id, plot_code: o.plot_code, quantity: o.origin_quantity ? { value: dec(o.origin_quantity)!, unit: 'KG' } : null })) : [],
      origins_restricted: !plotsVisible,
      origin_status: plotsVisible ? (origins.length ? 'DECLARED' : 'MISSING') : 'RESTRICTED',
      notes: e.notes,
      original_declaration: corrections.length ? { delivery_date: d.delivery_date ? ymd(d.delivery_date)! : null, quantity_declared: dec(d.quantity_declared), harvest_period: periodValue(d.harvest_precision, d.harvest_start, d.harvest_end) } : null,
      corrections: corrections.map((c) => ({ number: c.correction_number, reason: c.reason, changed_fields: c.changed_fields, delivery_date: ymd(c.delivery_date)!, quantity_declared: dec(c.quantity_declared)!,
        harvest_period: periodValue(c.harvest_precision, c.harvest_start, c.harvest_end), at: c.created_at, by: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Miembro', corrected_event_id: c.corrected_event_id, correction_event_id: c.correction_event_id })),
      supports, supports_visible: has('document:read'), support_status: activeSupports ? 'REGISTERED' : 'PENDING',
      receptions,
      totals: { declared: declared ? { value: declared, unit: d.unit } : null, received: receivedStr ? { value: receivedStr, unit: 'KG' } : null, reception_status: recStatus, reception_status_label: RECEPTION_LABEL[recStatus],
        closure: await this.closure(db, ctx, d) },
      gates, history,
      inventory_effect: { status: 'RECORDED_IN_LEDGER', note: 'Cada recepción confirmada es la única entrada física de ese cacao en el ledger (recepción @ centro). Formar lotes mueve cantidad, no crea existencias. Ver Inventario.' },
      disclaimer: 'Registrar una entrega o una recepción con pendientes no es un expediente completo, producto liberado ni cumplimiento EUDR.',
      registered_at: d.registered_at, created_at: d.created_at,
      actions: {
        edit: d.status === 'DRAFT' && canWrite, register: d.status === 'DRAFT' && canWrite, link_support: canWrite && has('document:read'),
        receive: d.status === 'REGISTERED' && has('reception:confirm'), correct_delivery: d.status === 'REGISTERED' && has('delivery:correct'),
        correct_reception: has('reception:correct'), record_quality: has('quality:record'), decide_quality: has('quality:decide'),
        close: d.status === 'REGISTERED' && receptions.length > 0 && has('reception:confirm'),
        justify_closure: d.status === 'CLOSED' && has('delivery:correct'),
      },
    };
  }

  private async history(db: Db, orgId: string, deliveryId: string, receptionIds: string[]) {
    const ALLOWED: Record<string, string[]> = {
      DeliveryRegistered: ['delivery_code', 'quantity_declared', 'unit', 'delivery_date', 'harvest_period', 'pending_kde'],
      DeliveryCorrected: ['changed_fields', 'quantity_declared', 'unit', 'delivery_date', 'harvest_period'],
      ReceptionConfirmed: ['quantity_received', 'unit', 'received_at', 'pending_kde'],
      ReceptionCorrected: ['previous_quantity', 'new_quantity', 'unit'],
      WeightRecorded: ['method', 'quantity', 'unit', 'weighed_on', 'corrects_weighing_id'],
      QualityDecisionRecorded: ['decision', 'method', 'limits_version', 'limits_reference_status'],
    };
    const weighings = receptionIds.length ? (await db.selectFrom('weighings').select('id').where('reception_id', 'in', receptionIds).execute()).map((w) => w.id) : [];
    const samples = receptionIds.length ? (await db.selectFrom('quality_samples').select('id').where('reception_id', 'in', receptionIds).execute()).map((s) => s.id) : [];
    const ids = [deliveryId, ...receptionIds, ...weighings, ...samples];
    const rows = await sql<{ event_id: string; event_type: string; aggregate_type: string; aggregate_id: string; aggregate_version: string; occurred_at: string; payload: Record<string, unknown>; correction_of_event_id: string | null; correction_reason: string | null; first_name: string | null; last_name: string | null }>`
      SELECT e.event_id, e.event_type, e.aggregate_type, e.aggregate_id, e.aggregate_version::text, e.occurred_at, e.payload, e.correction_of_event_id, e.correction_reason, u.first_name, u.last_name
      FROM domain_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.organization_id = ${orgId} AND e.aggregate_id = ANY(${ids}::uuid[]) AND e.aggregate_type IN ('DELIVERY','RECEPTION','WEIGHING','QUALITY_SAMPLE')
      ORDER BY e.recorded_at, e.aggregate_version`.execute(db);
    return rows.rows.map((r) => ({
      event_id: r.event_id, event_type: r.event_type, aggregate_type: r.aggregate_type, aggregate_id: r.aggregate_id, aggregate_version: Number(r.aggregate_version), occurred_at: r.occurred_at,
      actor: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || 'Miembro',
      data: Object.fromEntries((ALLOWED[r.event_type] ?? []).filter((k) => k in (r.payload ?? {})).map((k) => [k, r.payload[k]])),
      correction_of: r.correction_of_event_id ? { event_id: r.correction_of_event_id, reason: r.correction_reason } : null,
    }));
  }

  /** Opciones para registrar: productores (código; nombre solo con identidad), productos y centros activos, parcelas del productor. */
  async options(user: AuthUser, orgId: string, q: OptionsQuery) {
    const ctx = await this.ctx(user, orgId, ['delivery:create', 'delivery:create_assigned', 'reception:confirm'], false);
    const canCreate = this.has(ctx, 'delivery:create') || this.has(ctx, 'delivery:create_assigned');
    const identity = this.has(ctx, 'producer:read_identity') && (this.has(ctx, 'producer:read') || this.has(ctx, 'producer:read_assigned'));
    const producers = canCreate ? await this.db.selectFrom('producers').select(['id', 'producer_code', 'legal_name', 'first_name', 'last_name'])
      .where('organization_id', '=', orgId).where('status', '=', 'ACTIVE')
      .$if(!this.has(ctx, 'delivery:create'), (qb) => qb.where('assigned_membership_id', '=', ctx.membershipId)).orderBy('producer_code').execute() : [];
    const products = await this.db.selectFrom('products').select(['id', 'code', 'name', 'unit']).where('organization_id', '=', orgId).where('status', '=', 'ACTIVE').orderBy('name').execute();
    const locations = await this.db.selectFrom('locations').select(['id', 'code', 'name', 'location_type']).where('organization_id', '=', orgId).where('status', '=', 'ACTIVE').orderBy('name').execute();
    let plots: Array<{ id: string; plot_code: string }> = [];
    if (q.producer_id && canCreate) {
      const p = producers.find((x) => x.id === q.producer_id);
      if (p) plots = await this.db.selectFrom('plots').select(['id', 'plot_code']).where('organization_id', '=', orgId).where('producer_id', '=', p.id).where('status', '=', 'ACTIVE').orderBy('plot_code').execute();
    }
    return {
      producers: producers.map((p) => ({ id: p.id, code: p.producer_code, name: identity ? (p.legal_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()) || null : null })),
      products, locations, plots,
      units: ['KG'], support_kinds: ['DELIVERY_NOTE', 'REMISSION_GUIDE', 'PURCHASE_SETTLEMENT', 'OTHER'], quality_parameters: ['MOISTURE', 'FERMENTATION', 'IMPURITIES'],
    };
  }

  /** Versiones de documentos «soporte de entrega» del productor o de sus parcelas de origen, visibles para el usuario. */
  async supportCandidates(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, ['delivery:create', 'delivery:create_assigned'], false);
    if (!this.has(ctx, 'document:read')) throw forbidden('PERMISSION_DENIED', 'Tu rol no permite consultar documentos.');
    const d = await this.loadDelivery(this.db, ctx, id, 'write');
    const origins = (await this.db.selectFrom('delivery_origins').select('plot_id').where('delivery_id', '=', id).execute()).map((o) => o.plot_id);
    const rows = await sql<{ document_id: string; title: string; owner_type: string; owner_id: string; version_id: string; version_number: number; scan: string | null }>`
      SELECT doc.id AS document_id, doc.title, doc.owner_type, doc.owner_id, v.id AS version_id, v.version_number,
             (SELECT sc.result FROM document_version_scans sc WHERE sc.version_id = v.id ORDER BY sc.id DESC LIMIT 1) AS scan
      FROM documents doc JOIN document_versions v ON v.document_id = doc.id AND v.organization_id = doc.organization_id
      WHERE doc.organization_id = ${orgId} AND doc.document_type = 'DELIVERY_SUPPORT'
        AND ((doc.owner_type = 'producer' AND doc.owner_id = ${d.producer_id}) OR (doc.owner_type = 'plot' AND doc.owner_id = ANY(${origins}::uuid[])))
      ORDER BY doc.title, v.version_number DESC`.execute(this.db);
    const out = [];
    for (const r of rows.rows) if (await this.documentScopeOk(this.db, ctx, r.owner_type, r.owner_id)) out.push({
      document_id: r.document_id, title: r.title, version_id: r.version_id, version_number: r.version_number,
      availability: r.scan === 'CLEAN' ? 'AVAILABLE' : r.scan === 'INFECTED' ? 'REJECTED' : r.scan === 'FAILED' ? 'SCAN_FAILED' : 'PENDING',
    });
    return out;
  }

  // ---------- Centros ----------

  async locations(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, ['location:read', 'location:manage'], false);
    return this.db.selectFrom('locations').select(['id', 'code', 'name', 'location_type', 'status', 'row_version']).where('organization_id', '=', ctx.organizationId).orderBy('name').execute()
      .then((rows) => rows.map((r) => ({ ...r, row_version: Number(r.row_version) })));
  }

  async createLocation(user: AuthUser, orgId: string, dto: LocationDto, requestId?: string) {
    await this.ctx(user, orgId, ['location:manage'], true);
    try {
      return await this.db.transaction().execute(async (trx) => {
        const row = await trx.insertInto('locations').values({ id: randomUUID(), organization_id: orgId, code: dto.code, name: dto.name.trim(), location_type: dto.location_type, status: 'ACTIVE', created_by: user.id })
          .returning(['id', 'code', 'name', 'location_type', 'status', 'row_version']).executeTakeFirstOrThrow();
        await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'location.create', entityType: 'location', entityId: row.id, requestId, result: 'SUCCESS', after: { code: row.code, name: row.name, location_type: row.location_type, status: row.status } });
        return { ...row, row_version: Number(row.row_version) };
      });
    } catch (err) {
      if ((err as { constraint?: string }).constraint === 'locations_org_code_uq') throw conflict('LOCATION_CODE_TAKEN', 'Ya existe un centro con ese código en tu organización.');
      throw err;
    }
  }

  async changeLocation(user: AuthUser, orgId: string, locationId: string, dto: LocationStatusDto, requestId?: string) {
    await this.ctx(user, orgId, ['location:manage'], true);
    return this.db.transaction().execute(async (trx) => {
      const l = await trx.selectFrom('locations').selectAll().where('organization_id', '=', orgId).where('id', '=', locationId).forUpdate().executeTakeFirst();
      if (!l) throw notFound();
      if (Number(l.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó el centro. Recarga.');
      if (l.status === dto.status) throw conflict('INVALID_TRANSITION', 'El centro ya está en ese estado.');
      const after = await trx.updateTable('locations').set({ status: dto.status, row_version: sql`row_version + 1` } as never).where('id', '=', locationId).returning(['id', 'code', 'name', 'location_type', 'status', 'row_version']).executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: dto.status === 'ACTIVE' ? 'location.activate' : 'location.deactivate', entityType: 'location', entityId: locationId, requestId, result: 'SUCCESS', reason: dto.reason, before: { status: l.status }, after: { status: dto.status } });
      return { ...after, row_version: Number(after.row_version) };
    });
  }
}

@ApiTags('deliveries')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class DeliveriesController {
  constructor(private readonly service: DeliveriesService) {}

  @Get('locations') locations(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.locations(u, o); }
  @Post('locations') createLocation(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: LocationDto, @Req() req: AuthedRequest) { return this.service.createLocation(u, o, dto, req.requestId); }
  @Post('locations/:locationId/status') @HttpCode(200)
  changeLocation(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('locationId', ParseUUIDPipe) l: string, @Body() dto: LocationStatusDto, @Req() req: AuthedRequest) { return this.service.changeLocation(u, o, l, dto, req.requestId); }

  @Get('deliveries') list(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Query() q: ListQuery) { return this.service.list(u, o, q); }
  @Get('delivery-options') options(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Query() q: OptionsQuery) { return this.service.options(u, o, q); }
  @Post('deliveries') create(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: CreateDeliveryDto, @Req() req: AuthedRequest) { return this.service.create(u, o, dto, req.requestId); }
  @Get('deliveries/:id') detail(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(u, o, id); }
  @Patch('deliveries/:id') update(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeliveryDto, @Req() req: AuthedRequest) { return this.service.update(u, o, id, dto, req.requestId); }
  @Post('deliveries/:id/register') @HttpCode(200)
  register(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VersionDto, @Req() req: AuthedRequest) { return this.service.register(u, o, id, dto, req.requestId); }
  @Get('deliveries/:id/support-candidates') candidates(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.supportCandidates(u, o, id); }
  @Post('deliveries/:id/supports') addSupport(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupportDto, @Req() req: AuthedRequest) { return this.service.addSupport(u, o, id, dto, req.requestId); }
  @Post('deliveries/:id/supports/:supportId/withdraw') @HttpCode(200)
  withdrawSupport(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Param('supportId', ParseUUIDPipe) s: string, @Body() dto: ReasonDto, @Req() req: AuthedRequest) { return this.service.withdrawSupport(u, o, id, s, dto, req.requestId); }
  @Post('deliveries/:id/close') @HttpCode(200)
  closeDelivery(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseDeliveryDto, @Req() req: AuthedRequest) { return this.service.closeDelivery(u, o, id, dto, req.requestId); }
  @Post('deliveries/:id/closure-justifications')
  justifyClosure(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: JustifyClosureDto, @Req() req: AuthedRequest) { return this.service.justifyClosure(u, o, id, dto, req.requestId); }
  @Post('deliveries/:id/receptions') receive(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceptionDto, @Req() req: AuthedRequest) { return this.service.receive(u, o, id, dto, req.requestId); }
  @Post('deliveries/:id/corrections') correctDelivery(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliveryCorrectionDto, @Req() req: AuthedRequest) { return this.service.correctDelivery(u, o, id, dto, req.requestId); }
  @Post('deliveries/:id/receptions/:receptionId/corrections')
  correctReception(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Param('receptionId', ParseUUIDPipe) r: string, @Body() dto: ReceptionCorrectionDto, @Req() req: AuthedRequest) { return this.service.correctReception(u, o, id, r, dto, req.requestId); }
  @Post('deliveries/:id/receptions/:receptionId/quality-samples')
  addSample(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Param('receptionId', ParseUUIDPipe) r: string, @Body() dto: AfterSampleDto, @Req() req: AuthedRequest) { return this.service.addSample(u, o, id, r, dto, req.requestId); }
  @Post('deliveries/:id/receptions/:receptionId/quality-samples/:sampleId/results')
  addResult(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Param('receptionId', ParseUUIDPipe) r: string, @Param('sampleId', ParseUUIDPipe) s: string, @Body() dto: QualityResultDto, @Req() req: AuthedRequest) { return this.service.addResult(u, o, id, r, s, dto, req.requestId); }
}
