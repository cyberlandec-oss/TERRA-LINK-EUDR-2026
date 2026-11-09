import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { KdeService } from '../traceability/kde';
import { gateDetails, scaled } from '../traceability/kde-validator';
import { LotsService } from '../lots/lots';
import { holderBalances, incorporateOrganization, postMovement, reconcile, type Line, type MovementType } from './ledger';

// P0-017 Inventario y balance de masa (RF-17, QA-06; UX_UI §15.3). Contrato: docs/decisiones/P0-017-EFECTOS-LEDGER.md.
// Saldos y movimientos desde el ledger (única fuente). Movimientos propios: merma, traslado, asignación de ubicación
// pendiente y ajuste con motivo; cada uno con compuerta STOCK_MOVEMENT (KDE STORAGE), evento StockMovementRecorded y
// auditoría en la misma transacción. La reserva para embarques sí existe (P0-029, `shipment_reservations`): la registra
// el módulo de embarques sobre este mismo ledger, no este módulo. El despacho sigue bloqueado hasta que D-34 defina sus
// condiciones. Existencia ≠ calidad liberada ≠ origen completo.

type Db = Kysely<Database> | Transaction<Database>;
const DEC = /^\d{1,14}(\.\d{1,6})?$/;
const SIGNED = /^-?\d{1,14}(\.\d{1,6})?$/;
const unscaled = (n: bigint) => { const neg = n < 0n; const a = neg ? -n : n; const f = (a % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, ''); return `${neg ? '-' : ''}${a / 1_000_000n}${f ? `.${f}` : ''}`; };
const dec = (v: unknown) => (v === null || v === undefined ? null : unscaled(scaled(String(v))));

class TransferDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsUUID() lot_id!: string;
  @ApiPropertyOptional({ description: 'Centro de origen; null = ubicación pendiente de asignación', nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() from_location_id?: string | null;
  @ApiProperty() @IsUUID() to_location_id!: string;
  @ApiProperty({ description: 'KG, texto decimal' }) @IsString() @Matches(DEC) quantity!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 500) reason?: string;
}
class LossDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsUUID() lot_id!: string;
  @ApiProperty() @IsUUID() location_id!: string;
  @ApiProperty() @IsString() @Matches(DEC) quantity!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
class AdjustDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsUUID() lot_id!: string;
  @ApiProperty() @IsUUID() location_id!: string;
  @ApiProperty({ description: 'KG con signo (+ aumenta, − disminuye)' }) @IsString() @Matches(SIGNED) quantity!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
class BalancesQuery { @IsOptional() @IsUUID() location_id?: string; @IsOptional() @IsIn(['true', 'false']) pending_location?: 'true' | 'false' }
class MovementsQuery { @IsOptional() @IsUUID() lot_id?: string; @IsOptional() @IsUUID() location_id?: string; @IsOptional() @IsString() @Length(3, 40) movement_type?: string }

const TYPE_LABEL: Record<string, string> = {
  RECEPTION_IN: 'Entrada por recepción', RECEPTION_CORRECTION: 'Corrección de peso de recepción', LOT_ASSIGN: 'Asignación a lote', LOT_RELEASE: 'Liberación de asignación',
  PROCESS_RESERVE: 'Reserva por proceso', PROCESS_RESERVE_RELEASE: 'Liberación de reserva (proceso cancelado)', PROCESS_CLOSE: 'Cierre de proceso (consumo y salida)',
  STOCK_LOSS: 'Merma', TRANSFER: 'Traslado', LOCATION_ASSIGN: 'Asignación de ubicación pendiente', ADJUSTMENT: 'Ajuste con motivo',
  SHIPMENT_RESERVE: 'Reserva para embarque', SHIPMENT_RESERVE_RELEASE: 'Liberación de reserva de embarque', SHIPMENT_DISPATCH: 'Despacho de embarque (salida)',
};

@Injectable()
export class InventoryService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly kde: KdeService,
    private readonly lots: LotsService,
  ) {}

  private has(ctx: TenantContext, p: Permission) { return ctx.permissions.includes(p); }
  private async ctx(user: AuthUser, orgId: string, perm: Permission, mutation: boolean) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, perm)) throw forbidden();
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }
  private deliveryVisible(ctx: TenantContext) {
    return this.has(ctx, 'delivery:read') ? sql<boolean>`TRUE` : this.has(ctx, 'delivery:read_assigned') ? sql<boolean>`pr.assigned_membership_id = ${ctx.membershipId}` : sql<boolean>`FALSE`;
  }

  // ---------- Lecturas ----------

  async balances(user: AuthUser, orgId: string, q: BalancesQuery) {
    const ctx = await this.ctx(user, orgId, 'stock:read', false);
    const locFilter = q.location_id ? sql`AND e.location_id = ${q.location_id}` : q.pending_location === 'true' ? sql`AND e.location_id IS NULL` : sql``;
    const lotRows = (await sql<{ lot_id: string; lot_code: string; product: string; origin_status: string; location_id: string | null; location_code: string | null; location_name: string | null; physical: string; reserved: string }>`
      SELECT e.lot_id, l.lot_code, p.name AS product, l.origin_status, e.location_id, loc.code AS location_code, loc.name AS location_name,
             coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'PHYSICAL'), 0)::text AS physical, coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'RESERVED'), 0)::text AS reserved
      FROM stock_entries e JOIN lots l ON l.id = e.lot_id JOIN products p ON p.id = l.product_id LEFT JOIN locations loc ON loc.id = e.location_id
      WHERE e.organization_id = ${ctx.organizationId} AND e.lot_id IS NOT NULL ${locFilter}
      GROUP BY e.lot_id, l.lot_code, p.name, l.origin_status, e.location_id, loc.code, loc.name
      HAVING coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'PHYSICAL'), 0) <> 0 ORDER BY l.lot_code, loc.code NULLS LAST`.execute(this.db)).rows;
    // Material recibido aún sin lote: solo recepciones cuya entrega puede leer el usuario (sin conteos de las demás).
    const recRows = (await sql<{ reception_id: string; delivery_code: string; producer_code: string; product: string; location_id: string | null; location_code: string | null; location_name: string | null; physical: string }>`
      SELECT e.reception_id, d.delivery_code, pr.producer_code, p.name AS product, e.location_id, loc.code AS location_code, loc.name AS location_name,
             sum(e.signed_quantity)::text AS physical
      FROM stock_entries e JOIN receptions r ON r.id = e.reception_id JOIN deliveries d ON d.id = r.delivery_id JOIN producers pr ON pr.id = d.producer_id JOIN products p ON p.id = d.product_id
      LEFT JOIN locations loc ON loc.id = e.location_id
      WHERE e.organization_id = ${ctx.organizationId} AND e.reception_id IS NOT NULL AND ${this.deliveryVisible(ctx)} ${locFilter}
      GROUP BY e.reception_id, d.delivery_code, pr.producer_code, p.name, e.location_id, loc.code, loc.name HAVING sum(e.signed_quantity) <> 0 ORDER BY d.delivery_code`.execute(this.db)).rows;
    const lots: Array<{ lot_id: string; lot_code: string; product: string; origin_status: string; quality: { status: string; label: string; note: string }; location: { id: string; code: string | null; name: string | null } | null; pending_location: boolean; physical: string; reserved: string; available: string; unit: string }> = [];
    for (const r of lotRows) {
      const quality = this.lots.qualitySummary(await this.lots.quality(this.db, r.lot_id));
      lots.push({ lot_id: r.lot_id, lot_code: r.lot_code, product: r.product, origin_status: r.origin_status, quality,
        location: r.location_id ? { id: r.location_id, code: r.location_code, name: r.location_name } : null, pending_location: r.location_id === null,
        physical: dec(r.physical)!, reserved: dec(r.reserved)!, available: unscaled(scaled(r.physical) - scaled(r.reserved)), unit: 'KG' });
    }
    const receptions = recRows.map((r) => ({ reception_id: r.reception_id, delivery_code: r.delivery_code, producer_code: r.producer_code, product: r.product,
      location: r.location_id ? { id: r.location_id, code: r.location_code, name: r.location_name } : null, physical: dec(r.physical)!, unit: 'KG' }));
    const total = (k: 'physical' | 'reserved' | 'available') => unscaled(lots.reduce((a, x) => a + scaled(x[k]), 0n) + (k === 'reserved' ? 0n : receptions.reduce((a, x) => a + scaled(x.physical), 0n)));
    return {
      lots, receptions_without_lot: receptions,
      totals: { physical: total('physical'), reserved: total('reserved'), available: total('available'), unit: 'KG', scope: 'Lotes y recepciones visibles para tu rol' },
      pending_location: lots.filter((x) => x.pending_location).map((x) => x.lot_code),
      reservations_for_shipments: { status: 'IMPLEMENTED', note: 'Lo reservado incluye procesos en curso y embarques (P0-029). El despacho está bloqueado mientras D-34 no defina sus condiciones.' },
      note: 'Existencia física, reservado y disponible salen del ledger. Reservar no reduce la existencia. Tener existencia no significa calidad liberada ni origen completo.',
    };
  }

  async movements(user: AuthUser, orgId: string, q: MovementsQuery) {
    const ctx = await this.ctx(user, orgId, 'stock:read', false);
    const rows = (await sql<{ id: string; movement_type: string; reason: string | null; process_loss: string | null; recorded_at: string; first_name: string | null; last_name: string | null;
      lines: Array<{ lot_id: string | null; lot_code: string | null; reception_id: string | null; delivery_code: string | null; visible: boolean; location_code: string | null; bucket: string; quantity: string }> }>`
      SELECT m.id, m.movement_type, m.reason, m.process_loss::text, m.recorded_at, u.first_name, u.last_name,
             json_agg(json_build_object('lot_id', e.lot_id, 'lot_code', l.lot_code, 'reception_id', e.reception_id, 'delivery_code', d.delivery_code,
               'visible', (e.reception_id IS NULL OR ${this.deliveryVisible(ctx)}), 'location_code', loc.code, 'bucket', e.bucket, 'quantity', e.signed_quantity::text) ORDER BY e.id) AS lines
      FROM stock_movements m JOIN stock_entries e ON e.movement_id = m.id
      LEFT JOIN lots l ON l.id = e.lot_id LEFT JOIN receptions r ON r.id = e.reception_id LEFT JOIN deliveries d ON d.id = r.delivery_id LEFT JOIN producers pr ON pr.id = d.producer_id
      LEFT JOIN locations loc ON loc.id = e.location_id LEFT JOIN users u ON u.id = m.actor_id
      WHERE m.organization_id = ${ctx.organizationId}
        ${q.movement_type ? sql`AND m.movement_type = ${q.movement_type}` : sql``}
        ${q.lot_id ? sql`AND EXISTS (SELECT 1 FROM stock_entries x WHERE x.movement_id = m.id AND x.lot_id = ${q.lot_id})` : sql``}
        ${q.location_id ? sql`AND EXISTS (SELECT 1 FROM stock_entries x WHERE x.movement_id = m.id AND x.location_id = ${q.location_id})` : sql``}
      GROUP BY m.id, u.first_name, u.last_name ORDER BY m.recorded_at DESC LIMIT 200`.execute(this.db)).rows;
    return rows
      // Movimientos que solo tocan recepciones no legibles se omiten por completo; en los demás, esas líneas se ocultan sin marcador.
      .map((m) => ({ ...m, lines: m.lines.filter((x) => x.visible) }))
      .filter((m) => m.lines.length > 0)
      .map((m) => ({ id: m.id, movement_type: m.movement_type, label: TYPE_LABEL[m.movement_type] ?? m.movement_type, reason: m.reason, process_loss: dec(m.process_loss), recorded_at: m.recorded_at,
        actor: m.first_name || m.last_name ? `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() : 'Sistema (incorporación)',
        lines: m.lines.map((x) => ({ holder: x.lot_code ? `Lote ${x.lot_code}` : `Recepción de ${x.delivery_code}`, location: x.location_code ?? 'pendiente de asignación', bucket: x.bucket, quantity: dec(x.quantity) })) }));
  }

  /** La conciliación e incorporación recorren TODA la organización: exigen lectura de organización completa. */
  private requireOrgScope(ctx: TenantContext) {
    const need: Permission[] = ['delivery:read', 'lot:read', 'stock:read'];
    if (!need.every((p) => this.has(ctx, p))) throw forbidden('PERMISSION_DENIED', 'La conciliación requiere alcance de toda la organización.');
  }

  async reconciliation(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, 'stock:incorporate', false);
    this.requireOrgScope(ctx);
    return reconcile(this.db, ctx.organizationId);
  }

  async incorporate(user: AuthUser, orgId: string, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'stock:incorporate', true);
    this.requireOrgScope(ctx);
    const res = await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'stock-incorporate:' + orgId}))`.execute(trx);
      const r = await incorporateOrganization(trx, ctx.organizationId, user.id);
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'stock.incorporate', entityType: 'organization', entityId: orgId, requestId, result: 'SUCCESS', after: { created: r.created, unresolved: r.unresolved.length } });
      return r;
    });
    return { ...res, reconciliation: await reconcile(this.db, ctx.organizationId) };
  }

  // ---------- Movimientos ----------

  private async lockLot(trx: Transaction<Database>, ctx: TenantContext, lotId: string) {
    const l = await trx.selectFrom('lots').select(['id', 'lot_code', 'row_version']).where('organization_id', '=', ctx.organizationId).where('id', '=', lotId).forUpdate().executeTakeFirst();
    if (!l) throw notFound('El lote no existe en tu organización.');
    return l;
  }
  private async checkLocation(db: Db, ctx: TenantContext, id: string) {
    const l = await db.selectFrom('locations').select('status').where('organization_id', '=', ctx.organizationId).where('id', '=', id).executeTakeFirst();
    if (!l) throw notFound('El centro no existe en tu organización.');
    if (l.status !== 'ACTIVE') throw new AppError(422, 'LOCATION_INACTIVE', 'El centro no está activo.', [{ field: 'location_id', reason: 'INACTIVE' }]);
  }
  private async available(db: Db, ctx: TenantContext, lotId: string, location: string | null) {
    const b = (await holderBalances(db, ctx.organizationId, { lot_id: lotId })).find((x) => x.location_id === location);
    return { physical: scaled(b?.physical ?? '0'), reserved: scaled(b?.reserved ?? '0'), available: scaled(b?.available ?? '0') };
  }

  /** Compuerta STOCK_MOVEMENT (KDE STORAGE) por línea con ubicación; el responsable es la membresía de la sesión. */
  private async gate(trx: Transaction<Database>, ctx: TenantContext, lines: Array<{ lot_id: string; location_id: string | null; quantity: string; direction: 'IN' | 'OUT' }>) {
    const results = [];
    for (const l of lines) {
      const g = await this.kde.evaluateTransition({ ...ctx, permissions: [...new Set([...ctx.permissions, 'lot:read', 'location:read'] as Permission[])] }, 'STOCK_MOVEMENT', {
        STORAGE_LOT: l.lot_id, STORAGE_LOCATION: l.location_id, STORAGE_QUANTITY: { value: l.quantity, unit: 'KG' }, STORAGE_DIRECTION: l.direction, STORAGE_RESPONSIBLE: ctx.membershipId,
      }, trx);
      if (!g.allowed) throw new AppError(422, 'TRANSITION_BLOCKED', 'Movimiento incompleto: lote, ubicación, cantidad, dirección o responsable no válidos.', gateDetails(g.blocking));
      results.push({ direction: l.direction, g });
    }
    return results;
  }

  private async move(user: AuthUser, ctx: TenantContext, op: string, type: MovementType, lot: { id: string; lot_code: string; row_version: string }, lines: Line[], gateLines: Array<{ lot_id: string; location_id: string | null; quantity: string; direction: 'IN' | 'OUT' }>, reason: string | null, trx: Transaction<Database>, requestId?: string) {
    const gates = await this.gate(trx, ctx, gateLines);
    const mid = await postMovement(trx, { organizationId: ctx.organizationId, type, sourceType: null, sourceId: null, operationId: op, actorId: user.id, reason, reference: { lot_id: lot.id }, lines });
    // Compuerta STOCK_MOVEMENT guardada por línea (KDE STORAGE evaluados, sin valores): evidencia de la validación.
    for (const x of gates) {
      await trx.insertInto('gate_evaluations').values({ id: randomUUID(), organization_id: ctx.organizationId, entity_type: 'stock_movement', entity_id: mid, transition: x.g.transition, release_version: x.g.release,
        allowed: x.g.allowed, result: JSON.stringify({ direction: x.direction, blocking: x.g.blocking, pending: x.g.pending, not_evaluated: x.g.not_evaluated, checked: ['STORAGE_LOT', 'STORAGE_LOCATION', 'STORAGE_QUANTITY', 'STORAGE_DIRECTION', 'STORAGE_RESPONSIBLE'] }), evaluated_by: user.id }).execute();
    }
    const after = await trx.updateTable('lots').set({ row_version: sql`row_version + 1` } as never).where('id', '=', lot.id).returning('row_version').executeTakeFirstOrThrow();
    await this.events.append(trx, { organizationId: ctx.organizationId, eventType: 'StockMovementRecorded', schemaVersion: 1, aggregateType: 'LOT', aggregateId: lot.id, aggregateVersion: Number(after.row_version), actorId: user.id, correlationId: requestId,
      payload: { movement_id: mid, movement_type: type, lot_id: lot.id, lines: lines.map((l) => ({ location_id: l.location_id, bucket: l.bucket, quantity: dec(l.quantity), unit: 'KG' })), reason } });
    await this.audit.record(trx, { organizationId: ctx.organizationId, actorUserId: user.id, action: `stock.${type.toLowerCase()}`, entityType: 'lot', entityId: lot.id, requestId, result: 'SUCCESS',
      after: { code: lot.lot_code, quantity: dec(lines.find((l) => scaled(l.quantity) > 0n)?.quantity ?? lines[0].quantity), unit: 'KG', reason } });
    return mid;
  }

  private async run<T>(ctx: TenantContext, op: string, fn: (trx: Transaction<Database>) => Promise<T>) {
    const prior = await this.db.selectFrom('stock_movements').select(['id', 'movement_type']).where('organization_id', '=', ctx.organizationId).where('operation_id', '=', op).executeTakeFirst();
    if (prior) return { replayed: true, movement_id: prior.id };
    try {
      const movement_id = await this.db.transaction().execute(fn);
      return { replayed: false, movement_id };
    } catch (err) {
      const e = err as { constraint?: string; code?: string; message?: string };
      if (e.constraint === 'stock_movements_operation_uq') {
        const again = await this.db.selectFrom('stock_movements').select('id').where('organization_id', '=', ctx.organizationId).where('operation_id', '=', op).executeTakeFirstOrThrow();
        return { replayed: true, movement_id: again.id };
      }
      if (e.code === '23514' && /stock_entries/.test(e.message ?? '')) throw new AppError(409, 'INSUFFICIENT_AVAILABLE', 'Otra operación usó esa cantidad al mismo tiempo, o el saldo quedaría negativo. Recarga los saldos.', [{ field: 'quantity', reason: 'AVAILABLE_QUANTITY_EXCEEDED' }]);
      throw err;
    }
  }

  async transfer(user: AuthUser, orgId: string, dto: TransferDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'stock:move', true);
    const from = dto.from_location_id ?? null;
    if (from === dto.to_location_id) throw new AppError(422, 'SAME_LOCATION', 'El origen y el destino son el mismo centro.', [{ field: 'to_location_id', reason: 'SAME_LOCATION' }]);
    const q = scaled(dto.quantity);
    if (q <= 0n) throw new AppError(422, 'MUST_BE_POSITIVE', 'La cantidad debe ser mayor que cero.', [{ field: 'quantity', reason: 'MUST_BE_POSITIVE' }]);
    const res = await this.run(ctx, dto.operation_id, async (trx) => {
      const lot = await this.lockLot(trx, ctx, dto.lot_id);
      await this.checkLocation(trx, ctx, dto.to_location_id);
      if (from) await this.checkLocation(trx, ctx, from);
      const a = await this.available(trx, ctx, lot.id, from);
      if (q > a.available) throw new AppError(409, 'INSUFFICIENT_AVAILABLE', `Disponible en el origen: ${unscaled(a.available)} kg (la cantidad reservada no se traslada).`, [{ field: 'quantity', reason: 'AVAILABLE_QUANTITY_EXCEEDED' }]);
      const type: MovementType = from ? 'TRANSFER' : 'LOCATION_ASSIGN';
      return this.move(user, ctx, dto.operation_id, type, lot,
        [{ lot_id: lot.id, location_id: from, bucket: 'PHYSICAL', quantity: `-${dto.quantity}` }, { lot_id: lot.id, location_id: dto.to_location_id, bucket: 'PHYSICAL', quantity: dto.quantity }],
        // Asignar ubicación pendiente: la línea de salida no tiene centro (es justo lo que se resuelve); se valida la entrada.
        from ? [{ lot_id: lot.id, location_id: from, quantity: dto.quantity, direction: 'OUT' }, { lot_id: lot.id, location_id: dto.to_location_id, quantity: dto.quantity, direction: 'IN' }]
          : [{ lot_id: lot.id, location_id: dto.to_location_id, quantity: dto.quantity, direction: 'IN' }],
        dto.reason?.trim() || null, trx, requestId);
    });
    return { ...res, lot: await this.lotSummary(ctx, dto.lot_id) };
  }

  async loss(user: AuthUser, orgId: string, dto: LossDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'stock:move', true);
    const q = scaled(dto.quantity);
    if (q <= 0n) throw new AppError(422, 'MUST_BE_POSITIVE', 'La cantidad debe ser mayor que cero.', [{ field: 'quantity', reason: 'MUST_BE_POSITIVE' }]);
    const res = await this.run(ctx, dto.operation_id, async (trx) => {
      const lot = await this.lockLot(trx, ctx, dto.lot_id);
      await this.checkLocation(trx, ctx, dto.location_id);
      const a = await this.available(trx, ctx, lot.id, dto.location_id);
      if (q > a.available) throw new AppError(409, 'INSUFFICIENT_AVAILABLE', `Disponible: ${unscaled(a.available)} kg. La merma no puede afectar cantidad reservada ni dejar saldo negativo.`, [{ field: 'quantity', reason: 'AVAILABLE_QUANTITY_EXCEEDED' }]);
      return this.move(user, ctx, dto.operation_id, 'STOCK_LOSS', lot, [{ lot_id: lot.id, location_id: dto.location_id, bucket: 'PHYSICAL', quantity: `-${dto.quantity}` }],
        [{ lot_id: lot.id, location_id: dto.location_id, quantity: dto.quantity, direction: 'OUT' }], dto.reason.trim(), trx, requestId);
    });
    return { ...res, lot: await this.lotSummary(ctx, dto.lot_id) };
  }

  async adjust(user: AuthUser, orgId: string, dto: AdjustDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'stock:adjust', true);
    const q = scaled(dto.quantity);
    if (q === 0n) throw new AppError(422, 'NO_CHANGES', 'El ajuste no cambia la existencia.', [{ field: 'quantity', reason: 'ZERO' }]);
    const abs = unscaled(q < 0n ? -q : q);
    const res = await this.run(ctx, dto.operation_id, async (trx) => {
      const lot = await this.lockLot(trx, ctx, dto.lot_id);
      await this.checkLocation(trx, ctx, dto.location_id);
      // Un ajuste positivo añade cantidad SIN origen, evidencia ni calidad: no puede entrar en un lote de origen declarado
      // (equivaldría a mezclar origen desconocido con conocido, D-39.1). En un lote «Origen incompleto» queda marcada.
      const origin = (await trx.selectFrom('lots').select('origin_status').where('id', '=', lot.id).executeTakeFirstOrThrow()).origin_status;
      if (q > 0n && origin === 'COMPLETE') throw new AppError(422, 'ADJUSTMENT_WOULD_ATTRIBUTE_ORIGIN', 'Un ajuste positivo no puede añadirse a un lote de origen declarado: la cantidad añadida no tiene origen, evidencia ni calidad. Regístrala en un lote separado de origen incompleto o corrige el registro de origen.', [{ field: 'quantity', reason: 'ORIGIN_MIXING_BLOCKED' }]);
      const a = await this.available(trx, ctx, lot.id, dto.location_id);
      // Un ajuste no es atajo: nunca deja físico por debajo de lo reservado ni opera sobre recepciones.
      if (q < 0n && -q > a.available) throw new AppError(409, 'ADJUSTMENT_BELOW_RESERVED', `El ajuste dejaría la existencia por debajo de lo reservado (disponible ${unscaled(a.available)} kg).`, [{ field: 'quantity', reason: 'BELOW_RESERVED' }]);
      return this.move(user, ctx, dto.operation_id, 'ADJUSTMENT', lot, [{ lot_id: lot.id, location_id: dto.location_id, bucket: 'PHYSICAL', quantity: unscaled(q) }],
        [{ lot_id: lot.id, location_id: dto.location_id, quantity: abs, direction: q > 0n ? 'IN' : 'OUT' }], dto.reason.trim(), trx, requestId);
    });
    return { ...res, lot: await this.lotSummary(ctx, dto.lot_id) };
  }

  private async lotSummary(ctx: TenantContext, lotId: string) {
    const l = await this.db.selectFrom('lots').select(['id', 'lot_code']).where('organization_id', '=', ctx.organizationId).where('id', '=', lotId).executeTakeFirst();
    return l ? { ...l, quantities: await this.lots.lotQuantities(this.db, lotId) } : null;
  }

}

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @Get('balances') balances(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Query() q: BalancesQuery) { return this.service.balances(u, o, q); }
  @Get('movements') movements(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Query() q: MovementsQuery) { return this.service.movements(u, o, q); }
  @Get('reconciliation') reconciliation(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.reconciliation(u, o); }
  @Post('incorporate') incorporate(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Req() req: AuthedRequest) { return this.service.incorporate(u, o, req.requestId); }
  @Post('transfers') transfer(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: TransferDto, @Req() req: AuthedRequest) { return this.service.transfer(u, o, dto, req.requestId); }
  @Post('losses') loss(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: LossDto, @Req() req: AuthedRequest) { return this.service.loss(u, o, dto, req.requestId); }
  @Post('adjustments') adjust(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: AdjustDto, @Req() req: AuthedRequest) { return this.service.adjust(u, o, dto, req.requestId); }
}
