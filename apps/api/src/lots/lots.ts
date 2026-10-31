import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Min, ValidateNested } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database, LotsTable } from '../db/schema';
import { referenciaDe } from '../traceability/public-references';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { KdeService } from '../traceability/kde';
import { gateDetails, scaled } from '../traceability/kde-validator';
import { closeLines, holderBalances, postMovement, singleLocationWith } from '../inventory/ledger';

// P0-016 Lotes y procesos (RF-16, QA-07; UX_UI §15). Reglas D-39 adoptadas para desarrollo local (2026-10-10):
// origen incompleto separado y conservado; corrección de peso bloqueada con asignaciones/reservas/consumo; secado
// inicia pero no cierra hasta definir la unidad de humedad (D-32); cerrar exige `process:close`.
// Cantidades (P0-017): el ledger de inventario es la ÚNICA fuente de existencia, reserva y disponible. Cada asignación,
// liberación, inicio, cancelación y cierre escribe su movimiento en la MISMA transacción (docs/decisiones/P0-017-EFECTOS-LEDGER.md). Calidad y origen son dimensiones separadas del lote.
// Protección: bloqueo de filas en orden determinista + recálculo en el servidor + triggers de base como red de
// seguridad + operation_id. Dominio, compuerta, evento, outbox y auditoría en la MISMA transacción.

type Db = Kysely<Database> | Transaction<Database>;
type Lot = Selectable<LotsTable>;
/** Procedencia de un cambio hecho por otro caso de uso (P0-026 Importación). */
export interface LotChangeSource { reason: string; source: Record<string, unknown> }
const DEC = /^\d{1,14}(\.\d{1,6})?$/;
const unscaled = (n: bigint) => { const neg = n < 0n; const a = neg ? -n : n; const f = (a % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, ''); return `${neg ? '-' : ''}${a / 1_000_000n}${f ? `.${f}` : ''}`; };
const dec = (v: unknown) => (v === null || v === undefined ? null : unscaled(scaled(String(v))));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export class InputDto { @ApiProperty() @IsUUID() reception_id!: string; @ApiProperty({ description: 'KG, texto decimal' }) @IsString() @Matches(DEC) quantity!: string }
class CreateLotDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ type: [InputDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => InputDto) inputs!: InputDto[];
}
class AssignDto extends InputDto { @ApiProperty() @IsUUID() operation_id!: string }
class ReleaseDto { @ApiProperty() @IsUUID() operation_id!: string; @ApiProperty() @IsString() @Length(3, 500) reason!: string }
class VersionDto { @ApiProperty() @IsInt() @Min(1) expected_version!: number }
class CreateRunDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ enum: ['FERMENTATION', 'DRYING'] }) @IsIn(['FERMENTATION', 'DRYING']) process_type!: 'FERMENTATION' | 'DRYING';
  @ApiProperty() @IsUUID() output_product_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) notes?: string;
}
class RunInputDto { @ApiProperty() @IsUUID() lot_id!: string; @ApiProperty() @IsString() @Matches(DEC) quantity!: string }
class StartDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ description: 'ISO 8601 con zona' }) @IsISO8601({ strict: true }) started_at!: string;
  @ApiProperty({ type: [RunInputDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RunInputDto) inputs!: RunInputDto[];
}
class OutputDto { @ApiProperty() @IsString() @Matches(DEC) quantity!: string }
/**
 * Humedad al cerrar un secado (D-32, adoptada el 2026-10-15): es una MEDICIÓN, no un número suelto.
 * - `unit` obligatoria y solo `%BH` (porcentaje en base húmeda): sin base, «7,2 %» es ambiguo.
 * - `method` obligatorio: quién midió con qué. `measured_by` sale de la sesión, no del cuerpo.
 * - La precisión se conserva hasta la del almacenamiento; más decimales se RECHAZAN en la compuerta KDE, no se
 *   redondean (`DECIMAL_PRECISION_EXCEEDED`).
 */
class MoistureDto {
  // Forma laxa a propósito: el número se juzga en la COMPUERTA KDE, que explica por qué se rechaza (precisión
  // excedida, negativo, por encima del tope). Un 400 genérico diría «revisa los datos» y ocultaría el motivo.
  @ApiProperty({ description: 'Porcentaje en base húmeda, como texto decimal; hasta 6 decimales (D-32). Más precisión se rechaza con su motivo, no se redondea.' })
  @IsString() @Matches(/^-?\d{1,14}(\.\d{1,12})?$/) value!: string;
  @ApiProperty({ enum: ['%BH'], description: 'Única unidad admitida: porcentaje en base húmeda (D-32).' }) @IsIn(['%BH']) unit!: string;
  @ApiProperty({ description: 'Método de medición declarado (p. ej. medidor portátil, estufa, laboratorio).' }) @IsString() @Length(3, 120) method!: string;
}
class CloseDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsISO8601({ strict: true }) closed_at!: string;
  @ApiProperty({ type: [OutputDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => OutputDto) outputs!: OutputDto[];
  @ApiProperty({ description: 'Pérdida explícita en KG (0 admitido)' }) @IsString() @Matches(DEC) loss_quantity!: string;
  @ApiPropertyOptional({ type: MoistureDto }) @IsOptional() @ValidateNested() @Type(() => MoistureDto) moisture?: MoistureDto;
}
class CancelDto { @ApiProperty() @IsUUID() operation_id!: string; @ApiProperty() @IsString() @Length(3, 500) reason!: string }

const QUALITY_LABEL: Record<string, string> = {
  PENDING_EVALUATION: 'Calidad pendiente de evaluación en algún insumo', INCLUDES_REJECTED: 'Incluye insumos con calidad rechazada',
  RELEASED_BY_HUMAN_DECISION: 'Insumos liberados por decisión humana (límites declarados, no verificados)', NO_INPUTS: 'Sin insumos',
};

@Injectable()
export class LotsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly kde: KdeService,
  ) {}

  private has(ctx: TenantContext, p: Permission) { return ctx.permissions.includes(p); }
  private async ctx(user: AuthUser, orgId: string, perm: Permission, mutation: boolean) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, perm)) throw forbidden();
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }
  private systemCtx(ctx: TenantContext): TenantContext {
    return { ...ctx, permissions: [...new Set([...ctx.permissions, 'lot:read', 'product:read'] as Permission[])] };
  }
  private deliveryVisible(ctx: TenantContext) {
    return this.has(ctx, 'delivery:read') ? sql<boolean>`TRUE` : this.has(ctx, 'delivery:read_assigned') ? sql<boolean>`pr.assigned_membership_id = ${ctx.membershipId}` : sql<boolean>`FALSE`;
  }

  private async code(trx: Transaction<Database>, orgId: string, kind: 'LOT' | 'PRC') {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`${kind}:${orgId}`}))`.execute(trx);
    const table = kind === 'LOT' ? 'lots' : 'process_runs';
    const n = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)} WHERE organization_id = ${orgId}`.execute(trx)).rows[0].n + 1;
    return `${kind}-${new Date().toISOString().slice(0, 4)}-${String(n).padStart(5, '0')}`;
  }

  private async record(trx: Transaction<Database>, ctx: TenantContext, userId: string, entity: { type: 'lot' | 'process_run'; id: string; code: string },
    ev: { type: string; aggregateType: 'LOT' | 'PROCESS_RUN'; aggregateId: string; version: number; payload: Record<string, unknown> } | null, action: string, after: Record<string, unknown>, requestId?: string, from?: LotChangeSource) {
    const src = from ? { source: from.source } : {};
    if (ev) await this.events.append(trx, { organizationId: ctx.organizationId, eventType: ev.type, schemaVersion: 1, aggregateType: ev.aggregateType, aggregateId: ev.aggregateId, aggregateVersion: ev.version, actorId: userId, correlationId: requestId, payload: { ...ev.payload, ...src } });
    await this.audit.record(trx, { organizationId: ctx.organizationId, actorUserId: userId, action, entityType: entity.type, entityId: entity.id, requestId, result: 'SUCCESS', ...(from ? { reason: from.reason } : {}), after: { code: entity.code, ...after, ...src } });
  }

  // ---------- Disponibilidad (proyección mínima; no inventario) ----------

  /** Recepción bloqueada para asignar: peso vigente, pesaje vigente, versión, asignado activo, producto y origen. */
  private async receptionForAssign(trx: Transaction<Database>, ctx: TenantContext, receptionId: string) {
    const r = (await sql<{ id: string; delivery_id: string; product_id: string; location_id: string; physical: string; current: string; weighing_id: string; version: number; assigned: string; origin_known: boolean; unit: string }>`
      SELECT r.id, r.delivery_id, d.product_id, r.location_id, reception_current_quantity(r.id)::text AS current, r.unit,
             coalesce((SELECT sum(e.signed_quantity) FROM stock_entries e WHERE e.reception_id = r.id AND e.bucket = 'PHYSICAL'), 0)::text AS physical,
             (SELECT w.id FROM weighings w WHERE w.reception_id = r.id ORDER BY w.created_at DESC, w.id DESC LIMIT 1) AS weighing_id,
             (SELECT count(*)::int + 1 FROM reception_adjustments a WHERE a.reception_id = r.id) AS version,
             coalesce((SELECT sum(i.quantity) FROM lot_inputs i WHERE i.reception_id = r.id AND NOT EXISTS (SELECT 1 FROM lot_input_releases x WHERE x.input_id = i.id)), 0)::text AS assigned,
             EXISTS (SELECT 1 FROM delivery_origins o WHERE o.delivery_id = d.id) AS origin_known
      FROM receptions r JOIN deliveries d ON d.id = r.delivery_id AND d.organization_id = r.organization_id
      JOIN producers pr ON pr.id = d.producer_id AND pr.organization_id = d.organization_id
      WHERE r.organization_id = ${ctx.organizationId} AND r.id = ${receptionId} AND ${this.deliveryVisible(ctx)}
      FOR UPDATE OF r`.execute(trx)).rows[0];
    if (!r) throw notFound('La recepción no existe o no está disponible para ti.');
    return { ...r, available: scaled(r.physical) }; // existencia física de la recepción sin lote (ledger)
  }

  /** Existencia, reserva y disponible desde el ledger (única fuente); base y consumo como referencia del dominio. */
  async lotQuantities(db: Db, lotId: string) {
    const q = (await sql<{ base: string; consumed: string; org: string }>`
      SELECT lot_base_quantity(${lotId})::text AS base, (SELECT organization_id FROM lots WHERE id = ${lotId}) AS org,
             coalesce((SELECT sum(p.quantity) FROM process_inputs p JOIN process_runs r ON r.id = p.run_id WHERE p.lot_id = ${lotId} AND r.status = 'CLOSED'), 0)::text AS consumed`.execute(db)).rows[0];
    const rows = await holderBalances(db, q.org, { lot_id: lotId });
    const sum = (k: 'physical' | 'reserved' | 'available') => rows.reduce((a, b) => a + scaled(b[k]), 0n);
    const adj = (await sql<{ added: string; removed: string }>`
      SELECT coalesce(sum(e.signed_quantity) FILTER (WHERE e.signed_quantity > 0), 0)::text AS added, coalesce(-sum(e.signed_quantity) FILTER (WHERE e.signed_quantity < 0), 0)::text AS removed
      FROM stock_entries e JOIN stock_movements m ON m.id = e.movement_id WHERE e.lot_id = ${lotId} AND m.movement_type = 'ADJUSTMENT'`.execute(db)).rows[0];
    const shipped = (await sql<{ n: string }>`SELECT coalesce(sum(quantity), 0)::text AS n FROM shipment_reservations WHERE lot_id = ${lotId} AND status = 'CONSUMED'`.execute(db)).rows[0].n;
    return {
      adjustments: { added: dec(adj.added)!, removed: dec(adj.removed)!, added_traceability: scaled(adj.added) > 0n ? 'PENDING' : null,
        note: scaled(adj.added) > 0n ? 'Cantidad añadida por ajuste: sin origen, evidencia ni calidad atribuidos (trazabilidad pendiente).' : null },
      base: dec(q.base ?? '0')!, consumed: dec(q.consumed)!, dispatched: dec(shipped)!, physical: unscaled(sum('physical')), reserved: unscaled(sum('reserved')), available: unscaled(sum('available')),
      by_location: rows.filter((b) => scaled(b.physical) !== 0n || scaled(b.reserved) !== 0n).map((b) => ({ location_id: b.location_id, location: b.location_id ? `${b.location_name} (${b.location_code})` : null,
        pending_location: b.location_id === null, physical: dec(b.physical)!, reserved: dec(b.reserved)!, available: dec(b.available)! })),
    };
  }

  private async loadLot(db: Db, ctx: TenantContext, id: string, lock = false) {
    let q = db.selectFrom('lots').selectAll().where('organization_id', '=', ctx.organizationId).where('id', '=', id);
    if (lock) q = q.forUpdate();
    const l = await q.executeTakeFirst();
    if (!l) throw notFound();
    return l;
  }

  private async assignIn(trx: Transaction<Database>, ctx: TenantContext, userId: string, lot: Lot, input: InputDto, operationId: string, requestId?: string, from?: LotChangeSource) {
    if (lot.status !== 'OPEN' || lot.source !== 'RECEPTIONS') throw conflict('LOT_CLOSED_FOR_INPUT', 'Este lote no admite más entradas.');
    const r = await this.receptionForAssign(trx, ctx, input.reception_id);
    const q = scaled(input.quantity);
    if (q <= 0n) throw new AppError(422, 'MUST_BE_POSITIVE', 'La cantidad debe ser mayor que cero.', [{ field: 'quantity', reason: 'MUST_BE_POSITIVE' }]);
    if (r.product_id !== lot.product_id) throw new AppError(422, 'PRODUCT_MISMATCH', 'La recepción es de otro producto: no se suman productos distintos en un lote.', [{ field: 'reception_id', reason: 'PRODUCT_MISMATCH' }]);
    if (r.origin_known !== (lot.origin_status === 'COMPLETE')) throw new AppError(422, 'ORIGIN_MIXING_BLOCKED', 'No se mezcla material de origen conocido con material de origen incompleto (D-39). Usa un lote separado.', [{ field: 'reception_id', reason: 'ORIGIN_MIXING_BLOCKED' }]);
    if (q > r.available) throw new AppError(409, 'INSUFFICIENT_AVAILABLE', `La cantidad supera lo disponible de la recepción (${unscaled(r.available < 0n ? 0n : r.available)} kg).`, [{ field: 'quantity', reason: 'AVAILABLE_QUANTITY_EXCEEDED' }]);
    const id = randomUUID();
    await trx.insertInto('lot_inputs').values({ id, organization_id: ctx.organizationId, lot_id: lot.id, reception_id: r.id, weighing_id: r.weighing_id, reception_version: r.version, quantity: input.quantity, unit: 'KG', origin_known: r.origin_known, assigned_by: userId, operation_id: operationId }).execute();
    // Mover cantidad de la recepción al lote en el mismo centro: no es una entrada física nueva.
    await postMovement(trx, { organizationId: ctx.organizationId, type: 'LOT_ASSIGN', sourceType: 'lot_input', sourceId: id, operationId, actorId: userId, reference: { lot_id: lot.id },
      lines: [{ reception_id: r.id, location_id: r.location_id, bucket: 'PHYSICAL', quantity: `-${input.quantity}` }, { lot_id: lot.id, location_id: r.location_id, bucket: 'PHYSICAL', quantity: input.quantity }] });
    const after = await trx.updateTable('lots').set({ row_version: sql`row_version + 1` } as never).where('id', '=', lot.id).returningAll().executeTakeFirstOrThrow();
    await this.record(trx, ctx, userId, { type: 'lot', id: lot.id, code: lot.lot_code }, { type: 'LotInputAssigned', aggregateType: 'LOT', aggregateId: lot.id, version: Number(after.row_version),
      payload: { lot_id: lot.id, input_id: id, reception_id: r.id, weighing_id: r.weighing_id, reception_version: r.version, quantity: dec(input.quantity), unit: 'KG', origin_known: r.origin_known } },
    'lot.assign_input', { reception_id: r.id, quantity: dec(input.quantity), unit: 'KG', weighing_id: r.weighing_id }, requestId, from);
    return after;
  }

  /**
   * P0-026: alta de lote con sus entradas dentro de una transacción del llamador. Mismos efectos que createLot(): producto y
   * origen fijados por la primera recepción, asignaciones con disponibilidad recalculada en el ledger (bloqueo de la
   * recepción), mezcla de origen bloqueada, movimientos, eventos y auditoría. El llamador ya autorizó lot:create.
   */
  async createLotInTx(trx: Transaction<Database>, ctx: TenantContext, userId: string, inputs: Array<InputDto & { operation_id: string }>, operationId: string, requestId?: string, from?: LotChangeSource) {
    const orgId = ctx.organizationId;
    const sorted = [...inputs].sort((a, b) => a.reception_id.localeCompare(b.reception_id));
    const first = await this.receptionForAssign(trx, ctx, sorted[0].reception_id);
    const id = randomUUID();
    const lot = await trx.insertInto('lots').values({ id, organization_id: orgId, lot_code: await this.code(trx, orgId, 'LOT'), product_id: first.product_id, unit: 'KG', source: 'RECEPTIONS', status: 'OPEN',
      origin_status: first.origin_known ? 'COMPLETE' : 'INCOMPLETE', process_run_id: null, output_quantity: null, created_by: userId, operation_id: operationId }).returningAll().executeTakeFirstOrThrow();
    await this.record(trx, ctx, userId, { type: 'lot', id, code: lot.lot_code }, { type: 'LotCreated', aggregateType: 'LOT', aggregateId: id, version: 1,
      payload: { lot_id: id, lot_code: lot.lot_code, product_id: lot.product_id, source: 'RECEPTIONS', origin_status: lot.origin_status } }, 'lot.create', { product_id: lot.product_id, origin_status: lot.origin_status }, requestId, from);
    let cur: Lot = lot;
    for (const i of sorted) cur = await this.assignIn(trx, ctx, userId, cur, i, i.operation_id, requestId, from);
    return cur;
  }

  /** P0-026: asignar una entrada a un lote existente dentro de una transacción del llamador (mismos controles que assign()). */
  async assignInTx(trx: Transaction<Database>, ctx: TenantContext, userId: string, lotId: string, input: InputDto, operationId: string, requestId?: string, from?: LotChangeSource) {
    const lot = await this.loadLot(trx, ctx, lotId, true);
    return this.assignIn(trx, ctx, userId, lot, input, operationId, requestId, from);
  }

  /** P0-026: traduce las comprobaciones de seguridad de la base (carreras) igual que los endpoints. */
  mapConstraintError(err: unknown) { return this.mapCheck(err); }

  /**
   * P0-026: recepciones (visibles por alcance de entregas) con lo necesario para planificar asignaciones: entrega, producto,
   * origen conocido y existencia física SIN lote según el ledger. `lock` bloquea las filas (confirmación).
   */
  async receptionsForImport(db: Db, ctx: TenantContext, ids: string[], lock: boolean) {
    if (!ids.length) return new Map<string, { id: string; delivery_code: string; product_id: string; product_code: string | null; origin_known: boolean; available: string; received_at: string }>();
    const rows = (await sql<{ id: string; delivery_code: string; product_id: string; product_code: string | null; origin_known: boolean; available: string; received_at: string }>`
      SELECT r.id, d.delivery_code, d.product_id, p.code AS product_code, r.received_at::text,
             EXISTS (SELECT 1 FROM delivery_origins o WHERE o.delivery_id = d.id) AS origin_known,
             coalesce((SELECT sum(e.signed_quantity) FROM stock_entries e WHERE e.reception_id = r.id AND e.bucket = 'PHYSICAL'), 0)::text AS available
      FROM receptions r JOIN deliveries d ON d.id = r.delivery_id AND d.organization_id = r.organization_id
      JOIN producers pr ON pr.id = d.producer_id AND pr.organization_id = d.organization_id
      LEFT JOIN products p ON p.id = d.product_id AND p.organization_id = d.organization_id
      WHERE r.organization_id = ${ctx.organizationId} AND r.id = ANY(${ids}::uuid[]) AND ${this.deliveryVisible(ctx)}
      ORDER BY r.id ${lock ? sql`FOR UPDATE OF r` : sql``}`.execute(db)).rows;
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** P0-026: recepciones con existencia sin lote (hoja de ayuda de la plantilla). Solo lectura, alcance de entregas. */
  async availableReceptions(db: Db, ctx: TenantContext) {
    return (await sql<{ id: string; delivery_code: string; product_code: string | null; received_at: string; available: string; origin_known: boolean }>`
      SELECT r.id, d.delivery_code, p.code AS product_code, r.received_at::text, x.available::text, EXISTS (SELECT 1 FROM delivery_origins o WHERE o.delivery_id = d.id) AS origin_known
      FROM receptions r JOIN deliveries d ON d.id = r.delivery_id AND d.organization_id = r.organization_id
      JOIN producers pr ON pr.id = d.producer_id AND pr.organization_id = d.organization_id
      LEFT JOIN products p ON p.id = d.product_id AND p.organization_id = d.organization_id
      CROSS JOIN LATERAL (SELECT coalesce(sum(e.signed_quantity), 0) AS available FROM stock_entries e WHERE e.reception_id = r.id AND e.bucket = 'PHYSICAL') x
      WHERE r.organization_id = ${ctx.organizationId} AND ${this.deliveryVisible(ctx)} AND x.available > 0
      ORDER BY d.delivery_code, r.received_at LIMIT 500`.execute(db)).rows;
  }

  /** P0-026: lotes por código o id con sus entradas activas y liberadas por recepción. `lock` bloquea los lotes. */
  async lotsForImport(db: Db, ctx: TenantContext, codes: string[], ids: string[], lock: boolean) {
    if (!codes.length && !ids.length) return [] as Array<Lot & { active: Array<{ reception_id: string; quantity: string }>; released: string[] }>;
    let q = db.selectFrom('lots').selectAll().where('organization_id', '=', ctx.organizationId)
      .where((eb) => eb.or([...(codes.length ? [eb('lot_code', 'in', codes)] : []), ...(ids.length ? [eb('id', 'in', ids)] : [])]));
    if (lock) q = q.orderBy('id').forUpdate();
    const lots = await q.execute();
    const lotIds = lots.map((l) => l.id);
    const inputs = lotIds.length ? await sql<{ lot_id: string; reception_id: string; quantity: string; released: boolean }>`
      SELECT i.lot_id, i.reception_id, i.quantity::text, EXISTS (SELECT 1 FROM lot_input_releases x WHERE x.input_id = i.id) AS released
      FROM lot_inputs i WHERE i.organization_id = ${ctx.organizationId} AND i.lot_id = ANY(${lotIds}::uuid[])`.execute(db) : { rows: [] };
    return lots.map((l) => ({
      ...l,
      active: inputs.rows.filter((i) => i.lot_id === l.id && !i.released).map((i) => ({ reception_id: i.reception_id, quantity: i.quantity })),
      released: inputs.rows.filter((i) => i.lot_id === l.id && i.released).map((i) => i.reception_id),
    }));
  }

  /** ¿El contexto ve entregas/recepciones? (misma regla que receptionForAssign). */
  seesReceptions(ctx: TenantContext) { return this.has(ctx, 'delivery:read') || this.has(ctx, 'delivery:read_assigned'); }

  async createLot(user: AuthUser, orgId: string, dto: CreateLotDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'lot:create', true);
    const prior = await this.db.selectFrom('lots').select('id').where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) return { replayed: true, lot: await this.view(this.db, ctx, prior.id) };
    if (new Set(dto.inputs.map((i) => i.reception_id)).size !== dto.inputs.length) throw new AppError(422, 'INPUT_DUPLICATED', 'Una recepción aparece dos veces.', [{ field: 'inputs', reason: 'DUPLICATED' }]);
    try {
      // Bloqueo en orden determinista y lectura de la primera recepción para fijar producto y origen (createLotInTx).
      const id = await this.db.transaction().execute(async (trx) => (await this.createLotInTx(trx, ctx, user.id, dto.inputs.map((i) => ({ ...i, operation_id: randomUUID() })), dto.operation_id, requestId)).id);
      return { replayed: false, lot: await this.view(this.db, ctx, id) };
    } catch (err) {
      if ((err as { constraint?: string }).constraint === 'lots_operation_uq') {
        const again = await this.db.selectFrom('lots').select('id').where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirstOrThrow();
        return { replayed: true, lot: await this.view(this.db, ctx, again.id) };
      }
      throw this.mapCheck(err);
    }
  }

  /** Un trigger de seguridad (23514) se traduce en conflicto comprensible; nunca 500 por una carrera. */
  private mapCheck(err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === '23514' && /lot_inputs|process_inputs|stock_entries/.test(e.message ?? '')) return new AppError(409, 'INSUFFICIENT_AVAILABLE', 'Otra operación usó esa cantidad al mismo tiempo. Recarga para ver lo disponible.', [{ field: 'quantity', reason: 'AVAILABLE_QUANTITY_EXCEEDED' }]);
    if (e.code === '23514' && /lot_input_releases/.test(e.message ?? '')) return conflict('LOT_HAS_RESERVATIONS', 'El lote tiene reservas o consumo de procesos: no se puede liberar la asignación.');
    return err;
  }

  async assign(user: AuthUser, orgId: string, lotId: string, dto: AssignDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'lot:create', true);
    const prior = await this.db.selectFrom('lot_inputs').select(['lot_id', 'reception_id', 'quantity']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.lot_id !== lotId || prior.reception_id !== dto.reception_id || scaled(String(prior.quantity)) !== scaled(dto.quantity)) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, lot: await this.view(this.db, ctx, lotId) };
    }
    try {
      await this.db.transaction().execute(async (trx) => {
        const lot = await this.loadLot(trx, ctx, lotId, true);
        await this.assignIn(trx, ctx, user.id, lot, dto, dto.operation_id, requestId);
      });
    } catch (err) {
      if ((err as { constraint?: string }).constraint === 'lot_inputs_operation_uq') return { replayed: true, lot: await this.view(this.db, ctx, lotId) };
      throw this.mapCheck(err);
    }
    return { replayed: false, lot: await this.view(this.db, ctx, lotId) };
  }

  async release(user: AuthUser, orgId: string, lotId: string, inputId: string, dto: ReleaseDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'lot:release_input', true);
    const prior = await this.db.selectFrom('lot_input_releases').select('input_id').where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.input_id !== inputId) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, lot: await this.view(this.db, ctx, lotId) };
    }
    try {
      await this.db.transaction().execute(async (trx) => {
        const lot = await this.loadLot(trx, ctx, lotId, true);
        const i = await trx.selectFrom('lot_inputs').leftJoin('lot_input_releases as x', 'x.input_id', 'lot_inputs.id').select(['lot_inputs.id', 'lot_inputs.reception_id', 'lot_inputs.quantity', 'x.input_id as released'])
          .where('lot_inputs.id', '=', inputId).where('lot_inputs.lot_id', '=', lotId).executeTakeFirst();
        if (!i) throw notFound();
        if (i.released) throw conflict('INPUT_ALREADY_RELEASED', 'La asignación ya fue liberada.');
        const rec = (await sql<{ location_id: string }>`SELECT location_id FROM receptions WHERE id = ${i.reception_id} FOR UPDATE`.execute(trx)).rows[0];
        await trx.insertInto('lot_input_releases').values({ input_id: inputId, organization_id: orgId, reason: dto.reason.trim(), released_by: user.id, operation_id: dto.operation_id }).execute();
        await postMovement(trx, { organizationId: orgId, type: 'LOT_RELEASE', sourceType: 'lot_input_release', sourceId: inputId, operationId: dto.operation_id, actorId: user.id, reason: dto.reason.trim(), reference: { lot_id: lotId },
          lines: [{ lot_id: lotId, location_id: rec.location_id, bucket: 'PHYSICAL', quantity: `-${dec(i.quantity)}` }, { reception_id: i.reception_id, location_id: rec.location_id, bucket: 'PHYSICAL', quantity: dec(i.quantity)! }] });
        const after = await trx.updateTable('lots').set({ row_version: sql`row_version + 1` } as never).where('id', '=', lotId).returningAll().executeTakeFirstOrThrow();
        await this.record(trx, ctx, user.id, { type: 'lot', id: lotId, code: lot.lot_code }, { type: 'LotInputReleased', aggregateType: 'LOT', aggregateId: lotId, version: Number(after.row_version),
          payload: { lot_id: lotId, input_id: inputId, reception_id: i.reception_id, quantity: dec(i.quantity), unit: 'KG' } }, 'lot.release_input', { reception_id: i.reception_id, quantity: dec(i.quantity), reason: dto.reason.trim() }, requestId);
      });
    } catch (err) { throw this.mapCheck(err); }
    return { replayed: false, lot: await this.view(this.db, ctx, lotId) };
  }

  async closeForInput(user: AuthUser, orgId: string, lotId: string, dto: VersionDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'lot:create', true);
    await this.db.transaction().execute(async (trx) => {
      const lot = await this.loadLot(trx, ctx, lotId, true);
      if (lot.status !== 'OPEN') throw conflict('INVALID_TRANSITION', 'El lote ya no admite entradas.');
      if (Number(lot.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó el lote. Recarga.');
      const after = await trx.updateTable('lots').set({ status: 'CLOSED_FOR_INPUT', row_version: sql`row_version + 1` } as never).where('id', '=', lotId).returningAll().executeTakeFirstOrThrow();
      await this.record(trx, ctx, user.id, { type: 'lot', id: lotId, code: lot.lot_code }, { type: 'LotClosedForInput', aggregateType: 'LOT', aggregateId: lotId, version: Number(after.row_version), payload: { lot_id: lotId } }, 'lot.close_for_input', { status: 'CLOSED_FOR_INPUT' }, requestId);
    });
    return this.view(this.db, ctx, lotId);
  }

  // ---------- Procesos ----------

  private async loadRun(db: Db, ctx: TenantContext, id: string, lock = false) {
    let q = db.selectFrom('process_runs').selectAll().where('organization_id', '=', ctx.organizationId).where('id', '=', id);
    if (lock) q = q.forUpdate();
    const r = await q.executeTakeFirst();
    if (!r) throw notFound();
    return r;
  }

  async createRun(user: AuthUser, orgId: string, dto: CreateRunDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'process:manage', true);
    const prior = await this.db.selectFrom('process_runs').select(['id', 'process_type']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.process_type !== dto.process_type) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, run: await this.runView(this.db, ctx, prior.id) };
    }
    const p = await this.db.selectFrom('products').select('status').where('organization_id', '=', orgId).where('id', '=', dto.output_product_id).executeTakeFirst();
    if (!p) throw notFound('El producto de salida no existe en tu organización.');
    if (p.status !== 'ACTIVE') throw new AppError(422, 'PRODUCT_INACTIVE', 'El producto de salida no está activo.', [{ field: 'output_product_id', reason: 'INACTIVE' }]);
    const id = await this.db.transaction().execute(async (trx) => {
      const id = randomUUID();
      const run = await trx.insertInto('process_runs').values({ id, organization_id: orgId, run_code: await this.code(trx, orgId, 'PRC'), process_type: dto.process_type, status: 'DRAFT', output_product_id: dto.output_product_id,
        started_at: null, closed_at: null, loss_quantity: null, moisture_value: null, moisture_unit: null, notes: dto.notes?.trim() || null, cancel_reason: null, created_by: user.id, operation_id: dto.operation_id,
        start_operation_id: null, close_operation_id: null, cancel_operation_id: null }).returningAll().executeTakeFirstOrThrow();
      await this.record(trx, ctx, user.id, { type: 'process_run', id, code: run.run_code }, null, 'process.create', { process_type: dto.process_type, output_product_id: dto.output_product_id, status: 'DRAFT' }, requestId);
      return id;
    });
    return { replayed: false, run: await this.runView(this.db, ctx, id) };
  }

  private async gate(db: Db, ctx: TenantContext, transition: string, values: Record<string, unknown>) {
    return this.kde.evaluateTransition(this.systemCtx(ctx), transition, values, db);
  }
  private blocked(g: Awaited<ReturnType<LotsService['gate']>>, what: string) {
    return new AppError(422, 'TRANSITION_BLOCKED', `No se puede ${what}: faltan datos obligatorios, no son válidos o hay una decisión pendiente.`, gateDetails(g.blocking));
  }
  private async storeGate(trx: Transaction<Database>, ctx: TenantContext, userId: string, runId: string, g: Awaited<ReturnType<LotsService['gate']>>) {
    await trx.insertInto('gate_evaluations').values({ id: randomUUID(), organization_id: ctx.organizationId, entity_type: 'process_run', entity_id: runId, transition: g.transition, release_version: g.release,
      allowed: g.allowed, result: JSON.stringify({ blocking: g.blocking, pending: g.pending, not_evaluated: g.not_evaluated }), evaluated_by: userId }).execute();
  }

  async start(user: AuthUser, orgId: string, runId: string, dto: StartDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'process:manage', true);
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(dto.started_at)) throw new AppError(422, 'DATETIME_ZONE_REQUIRED', 'Indica la zona horaria del inicio.', [{ field: 'started_at', reason: 'ZONE_REQUIRED' }]);
    if (new Set(dto.inputs.map((i) => i.lot_id)).size !== dto.inputs.length) throw new AppError(422, 'INPUT_DUPLICATED', 'Un lote aparece dos veces.', [{ field: 'inputs', reason: 'DUPLICATED' }]);
    try {
      await this.db.transaction().execute(async (trx) => {
        const run = await this.loadRun(trx, ctx, runId, true);
        if (run.start_operation_id === dto.operation_id) return; // reintento idéntico
        if (run.status !== 'DRAFT') throw conflict('INVALID_TRANSITION', `El proceso está ${run.status}; solo se inicia un borrador.`);
        const sorted = [...dto.inputs].sort((a, b) => a.lot_id.localeCompare(b.lot_id));
        const lots: Lot[] = [];
        for (const i of sorted) lots.push(await this.loadLot(trx, ctx, i.lot_id, true));
        if (new Set(lots.map((l) => l.product_id)).size > 1) throw new AppError(422, 'PRODUCT_MISMATCH', 'Las entradas son de productos distintos: no se suman sin conversión del contrato.', [{ field: 'inputs', reason: 'PRODUCT_MISMATCH' }]);
        if (new Set(lots.map((l) => l.origin_status)).size > 1) throw new AppError(422, 'ORIGIN_MIXING_BLOCKED', 'No se mezcla material de origen conocido con material de origen incompleto (D-39).', [{ field: 'inputs', reason: 'ORIGIN_MIXING_BLOCKED' }]);
        for (const [k, i] of sorted.entries()) {
          if (scaled(i.quantity) <= 0n) throw new AppError(422, 'MUST_BE_POSITIVE', 'La cantidad debe ser mayor que cero.', [{ field: 'inputs', reason: 'MUST_BE_POSITIVE' }]);
          const q = await this.lotQuantities(trx, i.lot_id);
          if (scaled(i.quantity) > scaled(q.available)) throw new AppError(409, 'INSUFFICIENT_AVAILABLE', `La cantidad supera lo disponible del lote ${lots[k].lot_code} (${q.available} kg).`, [{ field: 'inputs', reason: 'AVAILABLE_QUANTITY_EXCEEDED' }]);
          // Reserva en el centro donde el lote tiene el disponible (PROPUESTA 2): si está repartido, trasladar antes.
          const loc = await singleLocationWith(trx, orgId, i.lot_id, i.quantity);
          if (loc === undefined) throw new AppError(422, 'LOCATION_AMBIGUOUS', `El disponible del lote ${lots[k].lot_code} está repartido entre centros: traslada primero la cantidad a un solo centro.`, [{ field: 'inputs', reason: 'LOCATION_AMBIGUOUS' }]);
          const pid = randomUUID();
          await trx.insertInto('process_inputs').values({ id: pid, organization_id: orgId, run_id: runId, lot_id: i.lot_id, lot_version: lots[k].row_version, quantity: i.quantity, unit: 'KG', location_id: loc }).execute();
          await postMovement(trx, { organizationId: orgId, type: 'PROCESS_RESERVE', sourceType: 'process_input', sourceId: pid, operationId: null, actorId: user.id, reference: { run_id: runId, location_id: loc },
            lines: [{ lot_id: i.lot_id, location_id: loc, bucket: 'RESERVED', quantity: i.quantity }] });
        }
        const total = sorted.reduce((a, i) => a + scaled(i.quantity), 0n);
        const g = await this.gate(trx, ctx, `PROCESS_START_${run.process_type}`, run.process_type === 'FERMENTATION'
          ? { FERMENTATION_RUN: runId, FERMENTATION_INPUT_LOTS: sorted.map((i) => i.lot_id), FERMENTATION_STARTED_AT: new Date(dto.started_at).toISOString() }
          : { DRYING_RUN: runId, DRYING_INPUT: { value: unscaled(total), unit: 'KG' }, DRYING_MOISTURE: null });
        if (!g.allowed) throw this.blocked(g, 'iniciar el proceso');
        await this.storeGate(trx, ctx, user.id, runId, g);
        const after = await trx.updateTable('process_runs').set({ status: 'RUNNING', started_at: new Date(dto.started_at), start_operation_id: dto.operation_id, row_version: sql`row_version + 1` } as never)
          .where('id', '=', runId).returningAll().executeTakeFirstOrThrow();
        await this.record(trx, ctx, user.id, { type: 'process_run', id: runId, code: run.run_code }, { type: 'ProcessingRunStarted', aggregateType: 'PROCESS_RUN', aggregateId: runId, version: Number(after.row_version),
          payload: { run_id: runId, process_type: run.process_type, started_at: new Date(dto.started_at).toISOString(), inputs: sorted.map((i) => ({ lot_id: i.lot_id, quantity: dec(i.quantity), unit: 'KG' })) } },
        'process.start', { status: 'RUNNING', reserved: unscaled(total), unit: 'KG', pending: g.pending.map((p) => p.code) }, requestId);
      });
    } catch (err) {
      if ((err as { constraint?: string }).constraint === 'process_runs_start_op_uq') return { replayed: true, run: await this.runView(this.db, ctx, runId) };
      throw this.mapCheck(err);
    }
    return { run: await this.runView(this.db, ctx, runId) };
  }

  async close(user: AuthUser, orgId: string, runId: string, dto: CloseDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'process:close', true);
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(dto.closed_at)) throw new AppError(422, 'DATETIME_ZONE_REQUIRED', 'Indica la zona horaria del cierre.', [{ field: 'closed_at', reason: 'ZONE_REQUIRED' }]);
    let replayed = false;
    try {
      await this.db.transaction().execute(async (trx) => {
        const run = await this.loadRun(trx, ctx, runId, true);
        if (run.close_operation_id === dto.operation_id) { replayed = true; return; } // reintento idéntico: sin segundo consumo
        if (run.status !== 'RUNNING') throw conflict('INVALID_TRANSITION', `El proceso está ${run.status}; solo se cierra un proceso en curso.`);
        const inputs = await trx.selectFrom('process_inputs').select(['lot_id', 'quantity']).where('run_id', '=', runId).orderBy('lot_id').execute();
        const inSum = inputs.reduce((a, i) => a + scaled(String(i.quantity)), 0n);
        const outs = dto.outputs.map((o) => scaled(o.quantity));
        if (outs.some((o) => o <= 0n)) throw new AppError(422, 'MUST_BE_POSITIVE', 'Cada salida debe ser mayor que cero.', [{ field: 'outputs', reason: 'MUST_BE_POSITIVE' }]);
        const outSum = outs.reduce((a, o) => a + o, 0n);
        const loss = scaled(dto.loss_quantity);
        if (new Date(dto.closed_at) < new Date(run.started_at as unknown as string)) throw new AppError(422, 'CLOSED_BEFORE_STARTED', 'El cierre es anterior al inicio.', [{ field: 'closed_at', reason: 'BEFORE_STARTED' }]);
        // Balance exacto en KG: entradas = salidas + pérdida explícita (sin tolerancia ni conversión por humedad).
        if (inSum !== outSum + loss) {
          throw new AppError(422, 'BALANCE_MISMATCH', `El balance no cuadra: entradas ${unscaled(inSum)} kg ≠ salidas ${unscaled(outSum)} kg + pérdida ${unscaled(loss)} kg (diferencia ${unscaled(inSum - outSum - loss)} kg). Registra la pérdida real; no hay tolerancia.`,
            [{ field: 'outputs', reason: 'BALANCE_MISMATCH' }]);
        }
        const values = run.process_type === 'FERMENTATION'
          ? { FERMENTATION_RUN: runId, FERMENTATION_INPUT_LOTS: inputs.map((i) => i.lot_id), FERMENTATION_STARTED_AT: iso(run.started_at), FERMENTATION_CLOSED_AT: new Date(dto.closed_at).toISOString(),
              FERMENTATION_OUTPUT: { value: unscaled(outSum), unit: 'KG' }, FERMENTATION_LOSS: { value: unscaled(loss), unit: 'KG' } }
          : { DRYING_RUN: runId, DRYING_INPUT: { value: unscaled(inSum), unit: 'KG' }, DRYING_OUTPUT: { value: unscaled(outSum), unit: 'KG' }, DRYING_LOSS: { value: unscaled(loss), unit: 'KG' },
              // La humedad viaja como cantidad con unidad: la compuerta exige `%BH` y rechaza más precisión de la
              // que se conserva. No se deduce de la merma ni se convierte nada por humedad (D-32).
              DRYING_MOISTURE: dto.moisture ? { value: dto.moisture.value, unit: dto.moisture.unit } : null };
        const g = await this.gate(trx, ctx, `PROCESS_CLOSE_${run.process_type}`, values);
        if (!g.allowed) throw this.blocked(g, 'cerrar el proceso');
        const inLots = await trx.selectFrom('lots').select(['id', 'origin_status']).where('id', 'in', inputs.map((i) => i.lot_id)).execute();
        const origin = inLots.every((l) => l.origin_status === 'COMPLETE') ? 'COMPLETE' : 'INCOMPLETE';
        const created: Array<{ id: string; code: string; quantity: string }> = [];
        for (const o of dto.outputs) {
          const id = randomUUID();
          const code = await this.code(trx, orgId, 'LOT');
          await trx.insertInto('lots').values({ id, organization_id: orgId, lot_code: code, product_id: run.output_product_id, unit: 'KG', source: 'PROCESS_OUTPUT', status: 'CLOSED_FOR_INPUT', origin_status: origin,
            process_run_id: runId, output_quantity: o.quantity, created_by: user.id, operation_id: randomUUID() }).execute();
          await trx.insertInto('process_outputs').values({ id: randomUUID(), organization_id: orgId, run_id: runId, lot_id: id, quantity: o.quantity, unit: 'KG' }).execute();
          for (const i of inputs) await trx.insertInto('lot_edges').values({ id: randomUUID(), organization_id: orgId, parent_lot_id: i.lot_id, child_lot_id: id, run_id: runId, quantity: String(i.quantity), unit: 'KG' }).execute();
          created.push({ id, code, quantity: dec(o.quantity)! });
          await this.record(trx, ctx, user.id, { type: 'lot', id, code }, { type: 'LotCreated', aggregateType: 'LOT', aggregateId: id, version: 1,
            payload: { lot_id: id, lot_code: code, product_id: run.output_product_id, source: 'PROCESS_OUTPUT', run_id: runId, origin_status: origin, quantity: dec(o.quantity), unit: 'KG' } }, 'lot.create', { product_id: run.output_product_id, origin_status: origin, quantity: dec(o.quantity) }, requestId);
        }
        await this.storeGate(trx, ctx, user.id, runId, g);
        // Ledger en la MISMA transacción: liberar reservas, consumir entradas y acreditar salidas; la pérdida se registra
        // una sola vez en el movimiento (consumo − salidas), sin un segundo descuento.
        const reserves = (await sql<{ lot_id: string; location_id: string | null; quantity: string }>`
          SELECT e.lot_id, e.location_id, e.signed_quantity::text AS quantity FROM stock_movements m JOIN stock_entries e ON e.movement_id = m.id
          WHERE m.organization_id = ${orgId} AND m.movement_type = 'PROCESS_RESERVE' AND m.reference->>'run_id' = ${runId}`.execute(trx)).rows;
        await postMovement(trx, { organizationId: orgId, type: 'PROCESS_CLOSE', sourceType: 'process_run', sourceId: runId, operationId: dto.operation_id, actorId: user.id, processLoss: dto.loss_quantity,
          reference: { outputs: created.map((c) => c.id) }, lines: closeLines(reserves.map((x) => ({ ...x, quantity: dec(x.quantity)! })), created.map((c) => ({ lot_id: c.id, quantity: c.quantity }))) });
        const after = await trx.updateTable('process_runs').set({ status: 'CLOSED', closed_at: new Date(dto.closed_at), loss_quantity: dto.loss_quantity, close_operation_id: dto.operation_id,
          moisture_value: dto.moisture?.value ?? null, moisture_unit: dto.moisture?.unit ?? null,
          moisture_method: dto.moisture?.method?.trim() ?? null, moisture_measured_by: dto.moisture ? user.id : null,
          row_version: sql`row_version + 1` } as never).where('id', '=', runId).returningAll().executeTakeFirstOrThrow();
        const inProduct = (await trx.selectFrom('lots').select('product_id').where('id', '=', inputs[0].lot_id).executeTakeFirstOrThrow()).product_id;
        await this.record(trx, ctx, user.id, { type: 'process_run', id: runId, code: run.run_code }, { type: 'ProcessingRunClosed', aggregateType: 'PROCESS_RUN', aggregateId: runId, version: Number(after.row_version),
          payload: { run_id: runId, process_type: run.process_type, input_product_id: inProduct, output_product_id: run.output_product_id,
            inputs: inputs.map((i) => ({ lot_id: i.lot_id, quantity: dec(i.quantity), unit: 'KG' })), outputs: created.map((c) => ({ lot_id: c.id, quantity: c.quantity, unit: 'KG' })),
            loss_quantity: unscaled(loss), unit: 'KG', mass_yield: { output_kg: unscaled(outSum), input_kg: unscaled(inSum), basis: 'MASS_KG' } } },
        'process.close', { status: 'CLOSED', input: unscaled(inSum), output: unscaled(outSum), loss: unscaled(loss), unit: 'KG' }, requestId);
      });
    } catch (err) {
      if ((err as { constraint?: string }).constraint === 'process_runs_close_op_uq') return { replayed: true, run: await this.runView(this.db, ctx, runId) };
      throw this.mapCheck(err);
    }
    return { replayed, run: await this.runView(this.db, ctx, runId) };
  }

  async cancel(user: AuthUser, orgId: string, runId: string, dto: CancelDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'process:manage', true);
    await this.db.transaction().execute(async (trx) => {
      const run = await this.loadRun(trx, ctx, runId, true);
      if (run.cancel_operation_id === dto.operation_id) return;
      if (run.status !== 'DRAFT' && run.status !== 'RUNNING') throw conflict('INVALID_TRANSITION', `El proceso está ${run.status}; no se cancela.`);
      if (run.status === 'RUNNING') {
        const reserves = (await sql<{ lot_id: string; location_id: string | null; quantity: string }>`
          SELECT e.lot_id, e.location_id, e.signed_quantity::text AS quantity FROM stock_movements m JOIN stock_entries e ON e.movement_id = m.id
          WHERE m.organization_id = ${orgId} AND m.movement_type = 'PROCESS_RESERVE' AND m.reference->>'run_id' = ${runId}`.execute(trx)).rows;
        await postMovement(trx, { organizationId: orgId, type: 'PROCESS_RESERVE_RELEASE', sourceType: 'process_run', sourceId: runId, operationId: dto.operation_id, actorId: user.id, reason: dto.reason.trim(),
          lines: reserves.map((x) => ({ lot_id: x.lot_id, location_id: x.location_id, bucket: 'RESERVED' as const, quantity: `-${dec(x.quantity)}` })) });
      }
      const after = await trx.updateTable('process_runs').set({ status: 'CANCELLED', cancel_reason: dto.reason.trim(), cancel_operation_id: dto.operation_id, row_version: sql`row_version + 1` } as never)
        .where('id', '=', runId).returningAll().executeTakeFirstOrThrow();
      await this.record(trx, ctx, user.id, { type: 'process_run', id: runId, code: run.run_code }, run.status === 'RUNNING'
        ? { type: 'ProcessingRunCancelled', aggregateType: 'PROCESS_RUN', aggregateId: runId, version: Number(after.row_version), payload: { run_id: runId, reason: dto.reason.trim(), reservations_released: true } } : null,
      'process.cancel', { status: 'CANCELLED', from_status: run.status, reason: dto.reason.trim() }, requestId);
    });
    return { run: await this.runView(this.db, ctx, runId) };
  }

  // ---------- Lecturas ----------

  /** Calidad del lote derivada de sus insumos (recepciones o lotes de entrada); nunca «liberado» implícito. */
  async quality(db: Db, lotId: string, seen = new Set<string>()): Promise<Set<string>> {
    if (seen.has(lotId)) return new Set();
    seen.add(lotId);
    const l = await db.selectFrom('lots').select(['source', 'process_run_id']).where('id', '=', lotId).executeTakeFirstOrThrow();
    const out = new Set<string>();
    if (l.source === 'RECEPTIONS') {
      const rows = await sql<{ status: string }>`
        SELECT coalesce((SELECT q.decision FROM quality_samples s JOIN quality_results q ON q.sample_id = s.id WHERE s.reception_id = i.reception_id AND q.decision <> 'PENDING' ORDER BY q.recorded_at DESC LIMIT 1), 'PENDING_EVALUATION') AS status
        FROM lot_inputs i WHERE i.lot_id = ${lotId} AND NOT EXISTS (SELECT 1 FROM lot_input_releases x WHERE x.input_id = i.id)`.execute(db);
      for (const r of rows.rows) out.add(r.status);
    } else {
      const parents = await db.selectFrom('process_inputs').select('lot_id').where('run_id', '=', l.process_run_id!).execute();
      for (const p of parents) for (const s of await this.quality(db, p.lot_id, seen)) out.add(s);
    }
    return out;
  }
  qualitySummary(s: Set<string>) {
    const k = s.has('PENDING_EVALUATION') ? 'PENDING_EVALUATION' : s.has('REJECTED') ? 'INCLUDES_REJECTED' : s.size && [...s].every((x) => x === 'RELEASED') ? 'RELEASED_BY_HUMAN_DECISION' : 'NO_INPUTS';
    return { status: k, label: QUALITY_LABEL[k], note: 'Derivada de los insumos. El lote no tiene decisión de calidad propia; no es liberación de calidad ni jurídica.' };
  }

  async listLots(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, 'lot:read', false);
    const rows = await this.db.selectFrom('lots as l').innerJoin('products as p', (j) => j.onRef('p.id', '=', 'l.product_id').onRef('p.organization_id', '=', 'l.organization_id'))
      .select(['l.id', 'l.lot_code', 'l.source', 'l.status', 'l.origin_status', 'l.created_at', 'p.name as product_name', 'p.code as product_code'])
      .where('l.organization_id', '=', ctx.organizationId).orderBy('l.created_at', 'desc').limit(200).execute();
    const out = [];
    for (const r of rows) out.push({ ...r, quantities: await this.lotQuantities(this.db, r.id), quality: this.qualitySummary(await this.quality(this.db, r.id)) });
    return out;
  }

  async lotDetail(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, 'lot:read', false);
    return this.view(this.db, ctx, id);
  }

  private async view(db: Db, ctx: TenantContext, id: string) {
    const l = await this.loadLot(db, ctx, id);
    const product = await db.selectFrom('products').select(['id', 'code', 'name']).where('id', '=', l.product_id).executeTakeFirstOrThrow();
    const inputs = l.source === 'RECEPTIONS' ? (await sql<{ id: string; reception_id: string; weighing_id: string; reception_version: number; quantity: string; origin_known: boolean; assigned_at: string; released_reason: string | null; released_at: string | null; visible: boolean; delivery_id: string | null; delivery_code: string | null; producer_code: string | null; received_at: string | null }>`
      SELECT i.id, i.reception_id, i.weighing_id, i.reception_version, i.quantity::text, i.origin_known, i.assigned_at, x.reason AS released_reason, x.released_at,
             (${this.deliveryVisible(ctx)}) AS visible, d.id AS delivery_id, d.delivery_code, pr.producer_code, r.received_at
      FROM lot_inputs i JOIN receptions r ON r.id = i.reception_id JOIN deliveries d ON d.id = r.delivery_id JOIN producers pr ON pr.id = d.producer_id
      LEFT JOIN lot_input_releases x ON x.input_id = i.id WHERE i.lot_id = ${id} ORDER BY i.assigned_at`.execute(db)).rows : [];
    // A-03: un lote recibido en custodia no tiene insumos propios; su procedencia es el traspaso (instantánea técnica del origen, D3b). No hereda
    // expediente, severidad ni conclusión del emisor (D2) y su origen es INCOMPLETO por construcción.
    const custody = l.source === 'CUSTODY_TRANSFER' ? (await sql<{ transfer_id: string; transfer_code: string; sender_name: string; projection_hash: string; projection: unknown; received: string }>`
      SELECT t.id AS transfer_id, t.transfer_code, o.name AS sender_name, t.origin_projection_hash AS projection_hash, t.origin_projection AS projection,
             (coalesce((SELECT sum(s.quantity) FROM custody_transfer_steps s WHERE s.transfer_id = t.id AND s.step IN ('RECEIPT','OVERAGE_CONFIRMED')), 0))::text AS received
      FROM custody_transfers t JOIN organizations o ON o.id = t.sender_org_id WHERE t.receiver_org_id = ${ctx.organizationId} AND t.receiver_lot_id = ${id}`.execute(db)).rows[0] ?? null : null;
    const run = l.process_run_id ? await db.selectFrom('process_runs').select(['id', 'run_code', 'process_type']).where('id', '=', l.process_run_id).executeTakeFirst() : null;
    const uses = await sql<{ run_id: string; run_code: string; process_type: string; status: string; quantity: string }>`
      SELECT r.id AS run_id, r.run_code, r.process_type, r.status, p.quantity::text FROM process_inputs p JOIN process_runs r ON r.id = p.run_id WHERE p.lot_id = ${id} ORDER BY r.created_at`.execute(db);
    const history = (await sql<{ event_type: string; aggregate_version: string; occurred_at: string; first_name: string | null; last_name: string | null }>`
      SELECT e.event_type, e.aggregate_version::text, e.occurred_at, u.first_name, u.last_name FROM domain_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.organization_id = ${ctx.organizationId} AND e.aggregate_type = 'LOT' AND e.aggregate_id = ${id} ORDER BY e.aggregate_version`.execute(db)).rows;
    return {
      // RF-47: la referencia se entrega en la LECTURA AUTORIZADA del recurso. No es publicarla por
      // audiencias (eso es RF-33) ni concede acceso: quien lee esto ya está autorizado sobre el recurso.
      public_reference: await referenciaDe(db, ctx.organizationId, 'LOT', l.id),
      id: l.id, lot_code: l.lot_code, source: l.source, status: l.status, row_version: Number(l.row_version), product,
      origin: { status: l.origin_status, label: l.origin_status === 'COMPLETE' ? 'Origen declarado en todos los insumos' : 'Origen incompleto', note: l.source === 'CUSTODY_TRANSFER' ? 'Lote recibido en custodia desde otra organización. Solo conserva una instantánea técnica del origen declarado por la emisora: no prueba origen completo y no hereda su expediente, severidad, conclusión ni aprobación.' : l.origin_status === 'INCOMPLETE' ? 'Algún insumo procede de una entrega sin origen declarado. No se mezcla con material de origen conocido y la condición se conserva en las salidas (D-39).' : null },
      quality: this.qualitySummary(await this.quality(db, id)),
      quantities: { ...(await this.lotQuantities(db, id)), unit: 'KG', note: 'Existencia física, reserva y disponible salen del ledger de inventario (única fuente). Reservar no reduce la existencia. Tener existencia no significa calidad liberada ni origen completo.' },
      // Solo insumos cuya entrega puede leer el usuario; los demás se omiten sin conteos ni marcadores.
      inputs: inputs.filter((i) => i.visible).map((i) => ({ id: i.id, reception_id: i.reception_id, delivery_id: i.delivery_id, delivery_code: i.delivery_code, producer_code: i.producer_code, received_at: i.received_at,
        weighing_id: i.weighing_id, reception_version: i.reception_version, quantity: { value: dec(i.quantity), unit: 'KG' }, origin_known: i.origin_known,
        released: i.released_at ? { reason: i.released_reason, at: i.released_at } : null })),
      custody_origin: custody ? { transfer_id: custody.transfer_id, transfer_code: custody.transfer_code, sender_name: custody.sender_name, received: { value: dec(custody.received), unit: 'KG' }, origin_projection: custody.projection, origin_projection_hash: custody.projection_hash } : null,
      produced_by: run ? { run_id: run.id, run_code: run.run_code, process_type: run.process_type, quantity: { value: dec(l.output_quantity), unit: 'KG' } } : null,
      used_by: uses.rows.map((u) => ({ run_id: u.run_id, run_code: u.run_code, process_type: u.process_type, status: u.status, effect: u.status === 'RUNNING' ? 'RESERVED' : u.status === 'CLOSED' ? 'CONSUMED' : 'RELEASED', quantity: { value: dec(u.quantity), unit: 'KG' } })),
      upstream: await this.upstream(db, ctx, id), downstream: await this.downstream(db, ctx, id), shipments: await this.shipments(db, ctx, id),
      history: history.map((h) => ({ event_type: h.event_type, version: Number(h.aggregate_version), occurred_at: h.occurred_at, actor: `${h.first_name ?? ''} ${h.last_name ?? ''}`.trim() || 'Miembro' })),
      actions: { stock_move: this.has(ctx, 'stock:move'), stock_adjust: this.has(ctx, 'stock:adjust'), assign: l.status === 'OPEN' && l.source === 'RECEPTIONS' && this.has(ctx, 'lot:create'), release_input: l.source === 'RECEPTIONS' && this.has(ctx, 'lot:release_input'), close_for_input: l.status === 'OPEN' && this.has(ctx, 'lot:create') },
    };
  }

  /** Origen hacia atrás: lotes padres por proceso y, al final, recepciones → entregas → productor/parcelas, solo lo legible. */
  private async upstream(db: Db, ctx: TenantContext, lotId: string) {
    const lots = (await sql<{ id: string; lot_code: string; source: string; depth: number; via_run: string | null; quantity: string | null }>`
      WITH RECURSIVE up(id, depth, via_run, quantity) AS (
        SELECT ${lotId}::uuid, 0, NULL::uuid, NULL::numeric
        UNION SELECT e.parent_lot_id, up.depth + 1, e.run_id, e.quantity FROM lot_edges e JOIN up ON e.child_lot_id = up.id WHERE up.depth < 20)
      SELECT up.id, l.lot_code, l.source, up.depth, up.via_run::text, up.quantity::text FROM up JOIN lots l ON l.id = up.id WHERE l.organization_id = ${ctx.organizationId} ORDER BY up.depth, l.lot_code`.execute(db)).rows;
    const roots = lots.filter((l) => l.source === 'RECEPTIONS').map((l) => l.id);
    const identity = this.has(ctx, 'producer:read_identity') && this.has(ctx, 'producer:read');
    // Parcelas de origen: solo las que el usuario puede leer (plot:read o plot:read_assigned del productor). El estado
    // «origen declarado» es del lote y se conserva aunque las parcelas no sean visibles; nunca se cuentan las ocultas.
    const plotScope = this.has(ctx, 'plot:read') ? sql`TRUE` : this.has(ctx, 'plot:read_assigned') ? sql`pr.assigned_membership_id = ${ctx.membershipId}` : sql`FALSE`;
    const producerScope = this.has(ctx, 'producer:read') ? sql`TRUE` : this.has(ctx, 'producer:read_assigned') ? sql`pr.assigned_membership_id = ${ctx.membershipId}` : sql`FALSE`;
    const receptions = roots.length ? (await sql<{ lot_id: string; quantity: string; delivery_id: string; delivery_code: string; producer_id: string; producer_visible: boolean; producer_code: string; legal_name: string | null; first_name: string | null; last_name: string | null; declared: boolean; plot_visible: boolean; plots: Array<{ id: string; code: string }> | null }>`
      SELECT i.lot_id, i.quantity::text, d.id AS delivery_id, d.delivery_code, pr.id AS producer_id, (${producerScope}) AS producer_visible, pr.producer_code, pr.legal_name, pr.first_name, pr.last_name,
             EXISTS (SELECT 1 FROM delivery_origins o WHERE o.delivery_id = d.id) AS declared, (${plotScope}) AS plot_visible,
             CASE WHEN ${plotScope} THEN (SELECT json_agg(json_build_object('id', p.id, 'code', p.plot_code) ORDER BY p.plot_code) FROM delivery_origins o JOIN plots p ON p.id = o.plot_id WHERE o.delivery_id = d.id) ELSE NULL END AS plots
      FROM lot_inputs i JOIN receptions r ON r.id = i.reception_id JOIN deliveries d ON d.id = r.delivery_id JOIN producers pr ON pr.id = d.producer_id
      WHERE i.lot_id = ANY(${roots}::uuid[]) AND NOT EXISTS (SELECT 1 FROM lot_input_releases x WHERE x.input_id = i.id) AND ${this.deliveryVisible(ctx)}
      ORDER BY d.delivery_code`.execute(db)).rows : [];
    return {
      lots: lots.filter((l) => l.depth > 0).map((l) => ({ lot_id: l.id, lot_code: l.lot_code, depth: l.depth, contributed: l.quantity ? { value: dec(l.quantity), unit: 'KG' } : null })),
      receptions: receptions.map((r) => ({ lot_id: r.lot_id, delivery_id: r.delivery_id, delivery_code: r.delivery_code, producer_code: r.producer_code, producer_id: r.producer_visible ? r.producer_id : null,
        producer_name: identity ? (r.legal_name ?? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()) || null : null,
        // Sin lectura de parcelas, el aviso sale por permiso/alcance y no por los datos: una recepción con 0, 1 o n parcelas
        // ocultas produce la misma forma (sin existencia, códigos ni cantidades; origin_known por recepción se omite).
        plots: (r.plots ?? []).map((p) => p.code), plot_links: r.plots ?? [], plots_restricted: !r.plot_visible,
        origin_known: r.plot_visible ? r.declared : null, quantity: { value: dec(r.quantity), unit: 'KG' } })),
      note: 'Cantidades registradas por enlace (aportado al proceso o asignado al lote). Cualquier reparto proporcional tras una mezcla es un cálculo, no identificación física.',
    };
  }

  /** Destino del lote (P0-029): embarques que lo incluyen, solo con shipment:read (si no, null: sin conteos). */
  private async shipments(db: Db, ctx: TenantContext, lotId: string) {
    if (!this.has(ctx, 'shipment:read')) return null;
    const rows = (await sql<{ id: string; shipment_code: string; status: string; destination_country: string; buyer_code: string; quantity: string; reservation: string | null }>`
      SELECT s.id, s.shipment_code, s.status, s.destination_country, b.code AS buyer_code, i.quantity::text,
             (SELECT r.status FROM shipment_reservations r WHERE r.item_id = i.id AND r.status IN ('ACTIVE','CONSUMED') LIMIT 1) AS reservation
      FROM shipment_items i JOIN shipments s ON s.id = i.shipment_id JOIN buyers b ON b.id = s.buyer_id
      WHERE i.organization_id = ${ctx.organizationId} AND i.lot_id = ${lotId} ORDER BY s.created_at`.execute(db)).rows;
    return rows.map((r) => ({ shipment_id: r.id, shipment_code: r.shipment_code, status: r.status, destination_country: r.destination_country, buyer_code: r.buyer_code,
      quantity: { value: dec(r.quantity), unit: 'KG' }, effect: r.reservation === 'CONSUMED' ? 'DISPATCHED' : r.reservation === 'ACTIVE' ? 'RESERVED' : 'NONE' }));
  }

  private async downstream(db: Db, ctx: TenantContext, lotId: string) {
    const rows = (await sql<{ id: string; lot_code: string; depth: number; run_code: string; quantity: string }>`
      WITH RECURSIVE down(id, depth, run_id, quantity) AS (
        SELECT ${lotId}::uuid, 0, NULL::uuid, NULL::numeric
        UNION SELECT e.child_lot_id, down.depth + 1, e.run_id, e.quantity FROM lot_edges e JOIN down ON e.parent_lot_id = down.id WHERE down.depth < 20)
      SELECT down.id, l.lot_code, down.depth, r.run_code, down.quantity::text FROM down JOIN lots l ON l.id = down.id LEFT JOIN process_runs r ON r.id = down.run_id
      WHERE down.depth > 0 AND l.organization_id = ${ctx.organizationId} ORDER BY down.depth, l.lot_code`.execute(db)).rows;
    return rows.map((r) => ({ lot_id: r.id, lot_code: r.lot_code, depth: r.depth, via_run: r.run_code, contributed: { value: dec(r.quantity), unit: 'KG' } }));
  }

  async listRuns(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, 'lot:read', false);
    const rows = await this.db.selectFrom('process_runs as r').innerJoin('products as p', 'p.id', 'r.output_product_id')
      .select(['r.id', 'r.run_code', 'r.process_type', 'r.status', 'r.started_at', 'r.closed_at', 'r.created_at', 'p.name as output_product'])
      .where('r.organization_id', '=', ctx.organizationId).orderBy('r.created_at', 'desc').limit(200).execute();
    return rows;
  }

  async runDetail(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, 'lot:read', false);
    return this.runView(this.db, ctx, id);
  }

  private async runView(db: Db, ctx: TenantContext, id: string) {
    const r = await this.loadRun(db, ctx, id);
    const product = await db.selectFrom('products').select(['id', 'code', 'name']).where('id', '=', r.output_product_id).executeTakeFirstOrThrow();
    const inputs = await db.selectFrom('process_inputs as i').innerJoin('lots as l', 'l.id', 'i.lot_id').innerJoin('products as p', 'p.id', 'l.product_id')
      .select(['i.lot_id', 'l.lot_code', 'l.origin_status', 'i.quantity', 'i.lot_version', 'p.name as product_name']).where('i.run_id', '=', id).orderBy('l.lot_code').execute();
    const outputs = await db.selectFrom('process_outputs as o').innerJoin('lots as l', 'l.id', 'o.lot_id').select(['o.lot_id', 'l.lot_code', 'o.quantity']).where('o.run_id', '=', id).orderBy('l.lot_code').execute();
    // Quién midió la humedad, por su nombre: una medición sin responsable legible no es una medición declarada (D-32).
    const medidor = r.moisture_measured_by
      ? await db.selectFrom('users').select(['first_name', 'last_name']).where('id', '=', r.moisture_measured_by).executeTakeFirst()
      : null;
    const inSum = inputs.reduce((a, i) => a + scaled(String(i.quantity)), 0n);
    const outSum = outputs.reduce((a, o) => a + scaled(String(o.quantity)), 0n);
    const gates = await db.selectFrom('gate_evaluations').select(['transition', 'release_version', 'allowed', 'result', 'evaluated_at']).where('entity_type', '=', 'process_run').where('entity_id', '=', id).orderBy('evaluated_at').execute();
    const closePreview = r.status === 'RUNNING' ? await this.gate(db, ctx, `PROCESS_CLOSE_${r.process_type}`, r.process_type === 'FERMENTATION'
      ? { FERMENTATION_RUN: id, FERMENTATION_INPUT_LOTS: inputs.map((i) => i.lot_id), FERMENTATION_STARTED_AT: iso(r.started_at), FERMENTATION_CLOSED_AT: null, FERMENTATION_OUTPUT: null, FERMENTATION_LOSS: null }
      : { DRYING_RUN: id, DRYING_INPUT: { value: unscaled(inSum), unit: 'KG' }, DRYING_OUTPUT: null, DRYING_LOSS: null, DRYING_MOISTURE: null }) : null;
    // La vista previa enseña lo que falta para cerrar; con la humedad ausente, aparece como bloqueante.
    return {
      id: r.id, run_code: r.run_code, process_type: r.process_type, status: r.status, row_version: Number(r.row_version), output_product: product,
      started_at: r.started_at, closed_at: r.closed_at, notes: r.notes, cancel_reason: r.cancel_reason,
      inputs: inputs.map((i) => ({ lot_id: i.lot_id, lot_code: i.lot_code, product: i.product_name, origin_status: i.origin_status, lot_version: Number(i.lot_version), quantity: { value: dec(i.quantity), unit: 'KG' },
        effect: r.status === 'RUNNING' ? 'RESERVED' : r.status === 'CLOSED' ? 'CONSUMED' : r.status === 'CANCELLED' ? 'RELEASED' : 'NONE' })),
      outputs: outputs.map((o) => ({ lot_id: o.lot_id, lot_code: o.lot_code, quantity: { value: dec(o.quantity), unit: 'KG' } })),
      balance: r.status === 'CLOSED' ? { input: unscaled(inSum), output: unscaled(outSum), loss: dec(r.loss_quantity), unit: 'KG', mass_yield_percent: inSum ? (Number((outSum * 10000n) / inSum) / 100).toFixed(2) : null,
        note: 'Rendimiento en masa (KG salida / KG entrada). No es base seca: la humedad no convierte masas.' } : null,
      // Valor completo en el detalle; la presentación con un decimal es cosa de la pantalla, no del dato (D-32).
      moisture: r.moisture_value ? {
        value: dec(r.moisture_value), unit: r.moisture_unit, display: Number(r.moisture_value).toFixed(1),
        method: r.moisture_method, measured_by: medidor ? `${medidor.first_name ?? ''} ${medidor.last_name ?? ''}`.trim() || 'Miembro' : null,
        note: 'Porcentaje en base húmeda declarado como medición (D-32, regla provisional del MVP local). No hay límites de aceptación: que un valor sea «bueno» no está definido.',
      } : null,
      gates: gates.map((g) => ({ transition: g.transition, release: g.release_version, allowed: g.allowed, ...(g.result as object), evaluated_at: g.evaluated_at })),
      close_preview: closePreview,
      drying_note: r.process_type === 'DRYING'
        ? 'Cerrar un secado exige la humedad final medida en %BH, con método y responsable (D-32, adoptada el 2026-10-15 como regla provisional del MVP local). El balance en KG sigue siendo exacto: la humedad no convierte masas.'
        : null,
      actions: { start: r.status === 'DRAFT' && this.has(ctx, 'process:manage'), close: r.status === 'RUNNING' && this.has(ctx, 'process:close'), cancel: (r.status === 'DRAFT' || r.status === 'RUNNING') && this.has(ctx, 'process:manage') },
    };
  }

  /** Opciones: recepciones con disponible > 0 (legibles), lotes con disponible > 0, productos activos. */
  async options(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, 'lot:read', false);
    const receptions = (this.has(ctx, 'lot:create') ? (await sql<{ id: string; delivery_code: string; producer_code: string; product_id: string; product_name: string; received_at: string; current: string; assigned: string; origin_known: boolean; quality: string }>`
      SELECT r.id, d.delivery_code, pr.producer_code, d.product_id, p.name AS product_name, r.received_at, reception_current_quantity(r.id)::text AS current,
             coalesce((SELECT sum(i.quantity) FROM lot_inputs i WHERE i.reception_id = r.id AND NOT EXISTS (SELECT 1 FROM lot_input_releases x WHERE x.input_id = i.id)), 0)::text AS assigned,
             EXISTS (SELECT 1 FROM delivery_origins o WHERE o.delivery_id = d.id) AS origin_known,
             coalesce((SELECT q.decision FROM quality_samples s JOIN quality_results q ON q.sample_id = s.id WHERE s.reception_id = r.id AND q.decision <> 'PENDING' ORDER BY q.recorded_at DESC LIMIT 1), 'PENDING_EVALUATION') AS quality
      FROM receptions r JOIN deliveries d ON d.id = r.delivery_id AND d.organization_id = r.organization_id JOIN producers pr ON pr.id = d.producer_id JOIN products p ON p.id = d.product_id
      WHERE r.organization_id = ${ctx.organizationId} AND ${this.deliveryVisible(ctx)} ORDER BY r.received_at DESC LIMIT 200`.execute(this.db)).rows : [])
      .map((r) => ({ ...r, current: dec(r.current), assigned: dec(r.assigned), available: unscaled(scaled(r.current) - scaled(r.assigned)) }))
      .filter((r) => scaled(r.available) > 0n);
    const lots = [];
    if (this.has(ctx, 'process:manage')) {
      const all = await this.db.selectFrom('lots as l').innerJoin('products as p', 'p.id', 'l.product_id').select(['l.id', 'l.lot_code', 'l.origin_status', 'l.product_id', 'p.name as product_name']).where('l.organization_id', '=', ctx.organizationId).orderBy('l.lot_code').execute();
      for (const l of all) { const q = await this.lotQuantities(this.db, l.id); if (scaled(q.available) > 0n) lots.push({ ...l, available: q.available }); }
    }
    const products = await this.db.selectFrom('products').select(['id', 'code', 'name']).where('organization_id', '=', ctx.organizationId).where('status', '=', 'ACTIVE').orderBy('name').execute();
    return { receptions, lots, products };
  }
}

@ApiTags('lots')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class LotsController {
  constructor(private readonly service: LotsService) {}

  @Get('lot-options') options(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.options(u, o); }
  @Get('lots') list(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.listLots(u, o); }
  @Post('lots') create(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: CreateLotDto, @Req() req: AuthedRequest) { return this.service.createLot(u, o, dto, req.requestId); }
  @Get('lots/:id') detail(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.lotDetail(u, o, id); }
  @Post('lots/:id/inputs') assign(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto, @Req() req: AuthedRequest) { return this.service.assign(u, o, id, dto, req.requestId); }
  @Post('lots/:id/inputs/:inputId/release') @HttpCode(200)
  release(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Param('inputId', ParseUUIDPipe) i: string, @Body() dto: ReleaseDto, @Req() req: AuthedRequest) { return this.service.release(u, o, id, i, dto, req.requestId); }
  @Post('lots/:id/close-for-input') @HttpCode(200)
  closeForInput(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VersionDto, @Req() req: AuthedRequest) { return this.service.closeForInput(u, o, id, dto, req.requestId); }
  @Get('process-runs') runs(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.listRuns(u, o); }
  @Post('process-runs') createRun(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: CreateRunDto, @Req() req: AuthedRequest) { return this.service.createRun(u, o, dto, req.requestId); }
  @Get('process-runs/:id') run(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.runDetail(u, o, id); }
  @Post('process-runs/:id/start') @HttpCode(200)
  start(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartDto, @Req() req: AuthedRequest) { return this.service.start(u, o, id, dto, req.requestId); }
  @Post('process-runs/:id/close') @HttpCode(200)
  close(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseDto, @Req() req: AuthedRequest) { return this.service.close(u, o, id, dto, req.requestId); }
  @Post('process-runs/:id/cancel') @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto, @Req() req: AuthedRequest) { return this.service.cancel(u, o, id, dto, req.requestId); }
}
