import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { referenciaDe } from '../traceability/public-references';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { KdeService } from '../traceability/kde';
import { scaled } from '../traceability/kde-validator';
import { LotsService } from '../lots/lots';
import { DdService } from '../dd/dd';
import { holderBalances, postMovement } from '../inventory/ledger';

// P0-029 Movimientos y embarque (RF-29, QA-06/12; UX_UI §14 EXPORT_MANAGER). Contrato: docs/decisiones/P0-029-EMBARQUES.md.
// Embarque = comprador declarado + destino declarado + centro de salida + ítems (lote, KG). Reservar por ítem crea un
// movimiento SHIPMENT_RESERVE en el ledger (única fuente de saldo; disponible = físico − reservado) con el lote bloqueado
// y el invariante diferido del ledger como respaldo ante concurrencia. Liberar y cancelar crean SHIPMENT_RESERVE_RELEASE.
// Despachar consume las reservas (SHIPMENT_DISPATCH: −reservado y −físico, una sola vez) SOLO si el preflight pasa:
// reservas completas, calidad liberada por decisión humana, origen completo, paquete DD aprobado/vigente/exportado y la
// compuerta SHIPMENT_DISPATCH, que hoy bloquea por D-34 (condición de dd_package_id y dispatch_at no escrita). Por eso
// ningún embarque real puede despacharse todavía; no se rebaja ningún requisito para «demostrar» un despacho.

type Db = Kysely<Database> | Transaction<Database>;
const DEC = /^\d{1,14}(\.\d{1,6})?$/;
const unscaled = (n: bigint) => { const neg = n < 0n; const a = neg ? -n : n; const f = (a % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, ''); return `${neg ? '-' : ''}${a / 1_000_000n}${f ? `.${f}` : ''}`; };
const dec = (v: unknown) => (v === null || v === undefined ? null : unscaled(scaled(String(v))));
const name = (f: string | null, l: string | null) => `${f ?? ''} ${l ?? ''}`.trim() || 'Miembro';

class CreateBuyerDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ example: 'IMP-EU-01' }) @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/) code!: string;
  @ApiProperty() @IsString() @Length(2, 200) name!: string;
  @ApiProperty({ description: 'País ISO 3166-1 alfa-2 declarado' }) @IsString() @Matches(/^[A-Z]{2}$/) country!: string;
}
class CreateShipmentDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsUUID() buyer_id!: string;
  @ApiProperty({ description: 'País de destino ISO 3166-1 alfa-2 (declarado)' }) @IsString() @Matches(/^[A-Z]{2}$/) destination_country!: string;
  @ApiPropertyOptional({ description: 'Puerto o lugar de destino declarado' }) @IsOptional() @IsString() @Length(2, 200) destination_place?: string;
  @ApiProperty({ description: 'Centro de salida: las reservas se hacen sobre el disponible de este centro' }) @IsUUID() origin_location_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) notes?: string;
}
class ShipmentAddItemDto {
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty() @IsUUID() lot_id!: string;
  @ApiProperty({ description: 'KG, texto decimal' }) @IsString() @Matches(DEC) quantity!: string;
}
class ShipmentVersionDto { @ApiProperty() @IsInt() @Min(1) expected_version!: number }
class ShipmentReserveDto {
  @ApiProperty({ description: 'Idempotencia: repetir con el mismo identificador no reserva dos veces' }) @IsUUID() operation_id!: string;
  @ApiProperty() @IsUUID() item_id!: string;
}
class ShipmentReleaseDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
class ShipmentCancelDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
class ShipmentDispatchDto {
  @ApiProperty({ description: 'Idempotencia: repetir con el mismo identificador no despacha dos veces' }) @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
}

const STATUS_LABEL: Record<string, string> = { DRAFT: 'En preparación', DISPATCHED: 'Despachado', CANCELLED: 'Cancelado' };
const CHECK_LABEL: Record<string, string> = {
  STATUS: 'Embarque en preparación', ITEMS: 'Lotes y cantidades', RESERVATION: 'Reserva completa en el centro de salida', QUALITY: 'Calidad liberada por decisión humana',
  ORIGIN: 'Origen declarado completo', DD_PACKAGE: 'Paquete de diligencia aprobado, vigente y exportado', EVIDENCE: 'Evidencias (exigidas dentro del expediente DD)', GATE: 'Compuerta SHIPMENT_DISPATCH (KDE)',
};
const DD_MESSAGE: Record<string, string> = {
  NO_CASE: 'El lote no tiene expediente de diligencia.', NOT_APPROVED: 'Ninguna instantánea del expediente está aprobada.', NOT_READY: 'La instantánea aprobada no tiene todos los requisitos cumplidos.',
  STALE: 'Cambiaron datos relevantes desde la instantánea aprobada (por ejemplo, la reserva): captura y aprueba una nueva.', NO_PACKAGE: 'No se exportó el paquete DD_PACKAGE de la instantánea aprobada.', OK: 'Paquete aprobado, vigente y exportado.',
  // D-34.A.1: el paquete existe y está aprobado, pero no cubre ESTE embarque, ítem, reserva y cantidad.
  LINK_MISMATCH: 'El paquete aprobado no cubre este embarque, ítem, reserva y cantidad: su instantánea acredita otro vínculo. Captura y aprueba una instantánea con la reserva vigente.',
};
type Check = { code: string; label: string; status: 'OK' | 'BLOCKED'; subject: string | null; message: string };

@Injectable()
export class ShipmentsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly kde: KdeService,
    private readonly lots: LotsService,
    private readonly dd: DdService,
  ) {}

  private has(ctx: TenantContext, p: Permission) { return ctx.permissions.includes(p); }
  private async ctx(user: AuthUser, orgId: string, perm: Permission, mutation: boolean) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, perm)) throw forbidden();
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }

  private async record(trx: Transaction<Database>, ctx: TenantContext, userId: string, s: { id: string; shipment_code: string }, version: number, eventType: string | null, payload: Record<string, unknown>, action: string, after: Record<string, unknown>, requestId?: string) {
    if (eventType) await this.events.append(trx, { organizationId: ctx.organizationId, eventType, schemaVersion: 1, aggregateType: 'SHIPMENT', aggregateId: s.id, aggregateVersion: version, actorId: userId, correlationId: requestId, payload: { shipment_id: s.id, ...payload } });
    await this.audit.record(trx, { organizationId: ctx.organizationId, actorUserId: userId, action, entityType: 'shipment', entityId: s.id, requestId, result: 'SUCCESS', after: { code: s.shipment_code, ...after } });
  }
  private async bump(trx: Transaction<Database>, id: string, set: Record<string, unknown> = {}) {
    return trx.updateTable('shipments').set({ ...set, row_version: sql`row_version + 1` } as never).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }
  private async lockShipment(trx: Transaction<Database>, ctx: TenantContext, id: string, expected?: number) {
    const s = await trx.selectFrom('shipments').selectAll().where('organization_id', '=', ctx.organizationId).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!s) throw notFound('El embarque no existe en tu organización.');
    if (expected !== undefined && Number(s.row_version) !== expected) throw conflict('VERSION_CONFLICT', 'Otra persona modificó el embarque. Recarga y revisa antes de continuar.');
    return s;
  }
  private requireDraft(s: { status: string }) {
    if (s.status !== 'DRAFT') throw new AppError(409, 'SHIPMENT_NOT_DRAFT', s.status === 'DISPATCHED' ? 'El embarque ya fue despachado: no cambia.' : 'El embarque está cancelado: no cambia.', [{ field: 'status', reason: s.status }]);
  }
  private async code(trx: Transaction<Database>, orgId: string) {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`EMB:${orgId}`}))`.execute(trx);
    const n = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM shipments WHERE organization_id = ${orgId}`.execute(trx)).rows[0].n + 1;
    return `EMB-${new Date().toISOString().slice(0, 4)}-${String(n).padStart(5, '0')}`;
  }
  /** Errores del invariante diferido del ledger (carrera con otra reserva o consumo) → 409 accionable. */
  private ledgerError(err: unknown): never {
    const e = err as { code?: string; message?: string };
    if (e.code === '23514' && /stock_entries/.test(e.message ?? '')) throw new AppError(409, 'INSUFFICIENT_AVAILABLE', 'Otra operación usó esa cantidad al mismo tiempo, o el saldo quedaría negativo. Recarga los saldos.', [{ field: 'quantity', reason: 'AVAILABLE_QUANTITY_EXCEEDED' }]);
    throw err;
  }

  // ---------- Compradores ----------

  async listBuyers(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, 'shipment:read', false);
    const rows = await this.db.selectFrom('buyers').select(['id', 'code', 'name', 'country', 'status', 'created_at']).where('organization_id', '=', ctx.organizationId).orderBy('code').execute();
    return { items: rows.map((b) => ({ ...b, verification: 'DECLARED' })), note: 'Compradores declarados por tu organización; Terra Link no verifica su identidad (D-33).' };
  }

  async createBuyer(user: AuthUser, orgId: string, dto: CreateBuyerDto, requestId?: string) {
    await this.ctx(user, orgId, 'shipment:manage', true);
    const prior = await this.db.selectFrom('buyers').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.code !== dto.code) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, buyer: prior };
    }
    try {
      const b = await this.db.transaction().execute(async (trx) => {
        const row = await trx.insertInto('buyers').values({ id: randomUUID(), organization_id: orgId, code: dto.code, name: dto.name.trim(), country: dto.country, created_by: user.id, operation_id: dto.operation_id }).returningAll().executeTakeFirstOrThrow();
        await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'buyer.create', entityType: 'buyer', entityId: row.id, requestId, result: 'SUCCESS', after: { code: row.code, country: row.country } });
        return row;
      });
      return { replayed: false, buyer: b };
    } catch (err) {
      if ((err as { constraint?: string }).constraint === 'buyers_org_code_uq') throw conflict('CODE_TAKEN', 'Ya existe un comprador con ese código en tu organización.');
      throw err;
    }
  }

  // ---------- Embarques ----------

  async options(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, 'shipment:manage', false);
    const buyers = await this.db.selectFrom('buyers').select(['id', 'code', 'name', 'country']).where('organization_id', '=', orgId).where('status', '=', 'ACTIVE').orderBy('code').execute();
    const locations = this.has(ctx, 'location:read') ? await this.db.selectFrom('locations').select(['id', 'code', 'name']).where('organization_id', '=', orgId).where('status', '=', 'ACTIVE').orderBy('code').execute() : [];
    // Lotes con disponible > 0 por centro, desde el ledger (lot:read: los lotes no tienen alcance por asignación).
    const lots = this.has(ctx, 'lot:read') ? (await sql<{ lot_id: string; lot_code: string; origin_status: string; product: string; location_id: string; available: string }>`
      SELECT e.lot_id, l.lot_code, l.origin_status, p.name AS product, e.location_id,
             (coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'PHYSICAL'), 0) - coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'RESERVED'), 0))::text AS available
      FROM stock_entries e JOIN lots l ON l.id = e.lot_id JOIN products p ON p.id = l.product_id
      WHERE e.organization_id = ${orgId} AND e.lot_id IS NOT NULL AND e.location_id IS NOT NULL
      GROUP BY e.lot_id, l.lot_code, l.origin_status, p.name, e.location_id
      HAVING coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'PHYSICAL'), 0) - coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'RESERVED'), 0) > 0
      ORDER BY l.lot_code`.execute(this.db)).rows.map((r) => ({ ...r, available: dec(r.available)!, unit: 'KG' })) : [];
    return { buyers, locations, lots };
  }

  async list(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, 'shipment:read', false);
    const rows = (await sql<{ id: string; shipment_code: string; status: string; destination_country: string; destination_place: string | null; buyer_code: string; buyer_name: string; location_code: string; items: number; quantity: string; dispatch_at: string | null; created_at: string }>`
      SELECT s.id, s.shipment_code, s.status, s.destination_country, s.destination_place, b.code AS buyer_code, b.name AS buyer_name, loc.code AS location_code,
             (SELECT count(*)::int FROM shipment_items i WHERE i.shipment_id = s.id) AS items, coalesce((SELECT sum(i.quantity) FROM shipment_items i WHERE i.shipment_id = s.id), 0)::text AS quantity,
             s.dispatch_at, s.created_at
      FROM shipments s JOIN buyers b ON b.id = s.buyer_id JOIN locations loc ON loc.id = s.origin_location_id
      WHERE s.organization_id = ${ctx.organizationId} ORDER BY s.created_at DESC LIMIT 200`.execute(this.db)).rows;
    return rows.map((r) => ({ ...r, status_label: STATUS_LABEL[r.status], quantity: { value: dec(r.quantity), unit: 'KG' } }));
  }

  async create(user: AuthUser, orgId: string, dto: CreateShipmentDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'shipment:manage', true);
    const prior = await this.db.selectFrom('shipments').select(['id', 'buyer_id']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.buyer_id !== dto.buyer_id) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, shipment: await this.view(this.db, ctx, prior.id) };
    }
    const buyer = await this.db.selectFrom('buyers').select(['id', 'status']).where('organization_id', '=', orgId).where('id', '=', dto.buyer_id).executeTakeFirst();
    if (!buyer) throw new AppError(422, 'REFERENCE_NOT_FOUND', 'El comprador no existe en tu organización.', [{ field: 'buyer_id', reason: 'NOT_FOUND' }]);
    if (buyer.status !== 'ACTIVE') throw new AppError(422, 'BUYER_INACTIVE', 'El comprador no está activo.', [{ field: 'buyer_id', reason: 'INACTIVE' }]);
    const loc = await this.db.selectFrom('locations').select('status').where('organization_id', '=', orgId).where('id', '=', dto.origin_location_id).executeTakeFirst();
    if (!loc) throw new AppError(422, 'REFERENCE_NOT_FOUND', 'El centro de salida no existe en tu organización.', [{ field: 'origin_location_id', reason: 'NOT_FOUND' }]);
    if (loc.status !== 'ACTIVE') throw new AppError(422, 'LOCATION_INACTIVE', 'El centro de salida no está activo.', [{ field: 'origin_location_id', reason: 'INACTIVE' }]);
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      const code = await this.code(trx, orgId);
      const s = await trx.insertInto('shipments').values({ id, organization_id: orgId, shipment_code: code, status: 'DRAFT', buyer_id: dto.buyer_id, destination_country: dto.destination_country,
        destination_place: dto.destination_place?.trim() || null, origin_location_id: dto.origin_location_id, notes: dto.notes?.trim() || null, created_by: user.id, operation_id: dto.operation_id }).returningAll().executeTakeFirstOrThrow();
      await this.record(trx, ctx, user.id, s, 1, 'ShipmentCreated', { shipment_code: code, buyer_id: s.buyer_id, destination_country: s.destination_country, origin_location_id: s.origin_location_id }, 'shipment.create', { status: 'DRAFT' }, requestId);
    });
    return { replayed: false, shipment: await this.view(this.db, ctx, id) };
  }

  async detail(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, 'shipment:read', false);
    return this.view(this.db, ctx, id);
  }

  async addItem(user: AuthUser, orgId: string, id: string, dto: ShipmentAddItemDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'shipment:manage', true);
    if (scaled(dto.quantity) <= 0n) throw new AppError(422, 'MUST_BE_POSITIVE', 'La cantidad debe ser mayor que cero.', [{ field: 'quantity', reason: 'MUST_BE_POSITIVE' }]);
    await this.db.transaction().execute(async (trx) => {
      const s = await this.lockShipment(trx, ctx, id, dto.expected_version);
      this.requireDraft(s);
      const lot = await trx.selectFrom('lots').select(['id', 'lot_code', 'unit']).where('organization_id', '=', ctx.organizationId).where('id', '=', dto.lot_id).executeTakeFirst();
      if (!lot || !this.has(ctx, 'lot:read')) throw new AppError(422, 'REFERENCE_NOT_FOUND', 'El lote no existe en tu organización.', [{ field: 'lot_id', reason: 'NOT_FOUND' }]);
      const itemId = randomUUID();
      try {
        await trx.insertInto('shipment_items').values({ id: itemId, organization_id: ctx.organizationId, shipment_id: id, lot_id: lot.id, quantity: dto.quantity, unit: 'KG', created_by: user.id }).execute();
      } catch (err) {
        if ((err as { constraint?: string }).constraint === 'shipment_items_lot_uq') throw conflict('LOT_ALREADY_IN_SHIPMENT', 'Ese lote ya es un ítem de este embarque.');
        throw err;
      }
      const after = await this.bump(trx, id);
      await this.record(trx, ctx, user.id, s, Number(after.row_version), 'ShipmentItemAdded', { item_id: itemId, lot_id: lot.id, quantity: dec(dto.quantity), unit: 'KG' }, 'shipment.add_item', { lot: lot.lot_code, quantity: dec(dto.quantity), unit: 'KG' }, requestId);
    });
    return { shipment: await this.view(this.db, ctx, id) };
  }

  async removeItem(user: AuthUser, orgId: string, id: string, itemId: string, dto: ShipmentVersionDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'shipment:manage', true);
    await this.db.transaction().execute(async (trx) => {
      const s = await this.lockShipment(trx, ctx, id, dto.expected_version);
      this.requireDraft(s);
      const item = await trx.selectFrom('shipment_items as i').innerJoin('lots as l', 'l.id', 'i.lot_id').select(['i.id', 'i.lot_id', 'i.quantity', 'l.lot_code']).where('i.shipment_id', '=', id).where('i.id', '=', itemId).executeTakeFirst();
      if (!item) throw notFound('El ítem no existe en este embarque.');
      const anyRes = await trx.selectFrom('shipment_reservations').select('id').where('item_id', '=', itemId).executeTakeFirst();
      if (anyRes) throw new AppError(409, 'ITEM_HAS_RESERVATIONS', 'El ítem tiene historial de reservas: se conserva. Libera la reserva activa o cancela el embarque.', [{ field: 'item_id', reason: 'HAS_RESERVATIONS' }]);
      await trx.deleteFrom('shipment_items').where('id', '=', itemId).execute();
      const after = await this.bump(trx, id);
      await this.record(trx, ctx, user.id, s, Number(after.row_version), 'ShipmentItemRemoved', { item_id: itemId, lot_id: item.lot_id }, 'shipment.remove_item', { lot: item.lot_code, quantity: dec(item.quantity), unit: 'KG' }, requestId);
    });
    return { shipment: await this.view(this.db, ctx, id) };
  }

  /** Reserva el ítem completo en el centro de salida (ledger SHIPMENT_RESERVE). Idempotente por operation_id. */
  async reserve(user: AuthUser, orgId: string, id: string, dto: ShipmentReserveDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'stock:reserve', true);
    const prior = await this.db.selectFrom('shipment_reservations').select(['id', 'shipment_id', 'item_id']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.shipment_id !== id || prior.item_id !== dto.item_id) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, reservation_id: prior.id, shipment: await this.view(this.db, ctx, id) };
    }
    let reservationId = '';
    try {
      await this.db.transaction().execute(async (trx) => {
        const s = await this.lockShipment(trx, ctx, id);
        this.requireDraft(s);
        const item = await trx.selectFrom('shipment_items').selectAll().where('shipment_id', '=', id).where('id', '=', dto.item_id).executeTakeFirst();
        if (!item) throw notFound('El ítem no existe en este embarque.');
        const lot = await trx.selectFrom('lots').select(['id', 'lot_code']).where('id', '=', item.lot_id).forUpdate().executeTakeFirstOrThrow();
        const active = await trx.selectFrom('shipment_reservations').select('id').where('item_id', '=', item.id).where('status', '=', 'ACTIVE').executeTakeFirst();
        if (active) throw conflict('ALREADY_RESERVED', 'El ítem ya tiene una reserva activa.');
        const b = (await holderBalances(trx, ctx.organizationId, { lot_id: lot.id })).find((x) => x.location_id === s.origin_location_id);
        const avail = scaled(b?.available ?? '0');
        if (scaled(item.quantity) > avail) throw new AppError(409, 'INSUFFICIENT_AVAILABLE', `Disponible del lote ${lot.lot_code} en el centro de salida: ${unscaled(avail)} kg. Traslada existencia a ese centro o reduce la cantidad del ítem.`, [{ field: 'quantity', reason: 'AVAILABLE_QUANTITY_EXCEEDED' }]);
        reservationId = randomUUID();
        const mid = await postMovement(trx, { organizationId: ctx.organizationId, type: 'SHIPMENT_RESERVE', sourceType: 'shipment_reservation', sourceId: reservationId, operationId: dto.operation_id, actorId: user.id,
          reference: { shipment_id: id, item_id: item.id, lot_id: lot.id }, lines: [{ lot_id: lot.id, location_id: s.origin_location_id, bucket: 'RESERVED', quantity: dec(item.quantity)! }] });
        await trx.insertInto('shipment_reservations').values({ id: reservationId, organization_id: ctx.organizationId, shipment_id: id, item_id: item.id, lot_id: lot.id, location_id: s.origin_location_id,
          quantity: item.quantity, unit: 'KG', status: 'ACTIVE', reserve_movement_id: mid, created_by: user.id, operation_id: dto.operation_id }).execute();
        await trx.updateTable('lots').set({ row_version: sql`row_version + 1` } as never).where('id', '=', lot.id).execute();
        const after = await this.bump(trx, id);
        await this.record(trx, ctx, user.id, s, Number(after.row_version), 'ShipmentLotReserved', { reservation_id: reservationId, item_id: item.id, lot_id: lot.id, location_id: s.origin_location_id, movement_id: mid, quantity: dec(item.quantity), unit: 'KG' },
          'shipment.reserve', { lot: lot.lot_code, quantity: dec(item.quantity), unit: 'KG' }, requestId);
      });
    } catch (err) {
      const e = err as { constraint?: string };
      if (e.constraint === 'shipment_reservations_operation_uq' || e.constraint === 'stock_movements_operation_uq') {
        const again = await this.db.selectFrom('shipment_reservations').select('id').where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
        if (again) return { replayed: true, reservation_id: again.id, shipment: await this.view(this.db, ctx, id) };
      }
      if (e.constraint === 'shipment_reservations_active_uq') throw conflict('ALREADY_RESERVED', 'El ítem ya tiene una reserva activa.');
      this.ledgerError(err);
    }
    return { replayed: false, reservation_id: reservationId, shipment: await this.view(this.db, ctx, id) };
  }

  private async releaseInTx(trx: Transaction<Database>, ctx: TenantContext, userId: string, r: { id: string; lot_id: string; location_id: string; quantity: string }, operationId: string | null, reason: string) {
    const mid = await postMovement(trx, { organizationId: ctx.organizationId, type: 'SHIPMENT_RESERVE_RELEASE', sourceType: 'shipment_reservation', sourceId: r.id, operationId, actorId: userId, reason,
      reference: { reservation_id: r.id, lot_id: r.lot_id }, lines: [{ lot_id: r.lot_id, location_id: r.location_id, bucket: 'RESERVED', quantity: `-${dec(r.quantity)}` }] });
    await trx.updateTable('shipment_reservations').set({ status: 'RELEASED', end_movement_id: mid, ended_at: new Date(), release_reason: reason } as never).where('id', '=', r.id).execute();
    await trx.updateTable('lots').set({ row_version: sql`row_version + 1` } as never).where('id', '=', r.lot_id).execute();
    return mid;
  }

  async release(user: AuthUser, orgId: string, id: string, reservationId: string, dto: ShipmentReleaseDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'stock:reserve', true);
    const replay = await this.db.selectFrom('stock_movements').select('id').where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (replay) return { replayed: true, shipment: await this.view(this.db, ctx, id) };
    await this.db.transaction().execute(async (trx) => {
      const s = await this.lockShipment(trx, ctx, id);
      this.requireDraft(s);
      const r = await trx.selectFrom('shipment_reservations as r').innerJoin('lots as l', 'l.id', 'r.lot_id').select(['r.id', 'r.lot_id', 'r.location_id', 'r.quantity', 'r.status', 'l.lot_code'])
        .where('r.shipment_id', '=', id).where('r.id', '=', reservationId).forUpdate().executeTakeFirst();
      if (!r) throw notFound('La reserva no existe en este embarque.');
      if (r.status !== 'ACTIVE') throw conflict('RESERVATION_NOT_ACTIVE', 'La reserva ya no está activa.');
      const mid = await this.releaseInTx(trx, ctx, user.id, r, dto.operation_id, dto.reason.trim());
      const after = await this.bump(trx, id);
      await this.record(trx, ctx, user.id, s, Number(after.row_version), 'ShipmentReservationReleased', { reservation_id: r.id, lot_id: r.lot_id, movement_id: mid, quantity: dec(r.quantity), unit: 'KG', reason: dto.reason.trim() },
        'shipment.release', { lot: r.lot_code, quantity: dec(r.quantity), unit: 'KG', reason: dto.reason.trim() }, requestId);
    });
    return { replayed: false, shipment: await this.view(this.db, ctx, id) };
  }

  async cancel(user: AuthUser, orgId: string, id: string, dto: ShipmentCancelDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'shipment:manage', true);
    await this.db.transaction().execute(async (trx) => {
      const s = await this.lockShipment(trx, ctx, id, dto.expected_version);
      this.requireDraft(s);
      const active = await trx.selectFrom('shipment_reservations').select(['id', 'lot_id', 'location_id', 'quantity']).where('shipment_id', '=', id).where('status', '=', 'ACTIVE').forUpdate().execute();
      if (active.length && !this.has(ctx, 'stock:reserve')) throw forbidden('PERMISSION_DENIED', 'Cancelar libera reservas: requiere además permiso para reservar.');
      for (const r of active) await this.releaseInTx(trx, ctx, user.id, r, null, `Cancelación del embarque: ${dto.reason.trim()}`);
      const after = await this.bump(trx, id, { status: 'CANCELLED', cancel_reason: dto.reason.trim() });
      await this.record(trx, ctx, user.id, s, Number(after.row_version), 'ShipmentCancelled', { reason: dto.reason.trim(), reservations_released: active.length }, 'shipment.cancel', { status: 'CANCELLED', reason: dto.reason.trim(), reservations_released: active.length }, requestId);
    });
    return { shipment: await this.view(this.db, ctx, id) };
  }

  // ---------- Preflight y despacho ----------

  /** Comprobaciones previas al despacho; ninguna se omite ni se rebaja. */
  async preflightChecks(db: Db, ctx: TenantContext, shipmentId: string, dispatchAt?: Date): Promise<{ allowed: boolean; checks: Check[]; gate: Awaited<ReturnType<KdeService['evaluateTransition']>>; packages: Array<{ item_id: string; lot_id: string; export_id: string | null }> }> {
    const s = await db.selectFrom('shipments').selectAll().where('organization_id', '=', ctx.organizationId).where('id', '=', shipmentId).executeTakeFirstOrThrow();
    const items = await db.selectFrom('shipment_items as i').innerJoin('lots as l', 'l.id', 'i.lot_id').select(['i.id', 'i.lot_id', 'i.quantity', 'l.lot_code', 'l.origin_status']).where('i.shipment_id', '=', shipmentId).orderBy('l.lot_code').execute();
    const res = await db.selectFrom('shipment_reservations').select(['id', 'item_id', 'quantity', 'location_id']).where('shipment_id', '=', shipmentId).where('status', '=', 'ACTIVE').execute();
    const checks: Check[] = [];
    const add = (code: string, ok: boolean, subject: string | null, message: string) => checks.push({ code, label: CHECK_LABEL[code], status: ok ? 'OK' : 'BLOCKED', subject, message });
    add('STATUS', s.status === 'DRAFT', null, s.status === 'DRAFT' ? 'En preparación.' : `Estado ${STATUS_LABEL[s.status]}.`);
    add('ITEMS', items.length > 0, null, items.length ? `${items.length} lote(s).` : 'Agrega al menos un lote con su cantidad.');
    const packages: Array<{ item_id: string; lot_id: string; export_id: string | null }> = [];
    for (const i of items) {
      const r = res.find((x) => x.item_id === i.id);
      add('RESERVATION', !!r && scaled(String(r.quantity)) === scaled(String(i.quantity)) && r.location_id === s.origin_location_id, i.lot_code, r ? `Reservado ${dec(r.quantity)} kg en el centro de salida.` : 'Sin reserva activa: reserva la cantidad del ítem.');
      const q = this.lots.qualitySummary(await this.lots.quality(db, i.lot_id));
      add('QUALITY', q.status === 'RELEASED_BY_HUMAN_DECISION', i.lot_code, q.label);
      add('ORIGIN', i.origin_status === 'COMPLETE', i.lot_code, i.origin_status === 'COMPLETE' ? 'Origen declarado.' : 'Origen incompleto: no se despacha como origen conocido.');
      // D-34.A.1: la acreditación debe cubrir ESTE vínculo, no una reserva cualquiera del lote. Sin reserva
      // activa no hay vínculo que acreditar, y la comprobación RESERVATION ya lo marca.
      const link = r ? { shipment_id: shipmentId, item_id: i.id, reservation_id: r.id, quantity: String(i.quantity) } : undefined;
      const p = await this.dd.packageForDispatch(db, ctx, i.lot_id, link);
      add('DD_PACKAGE', p.status === 'OK', i.lot_code, `${p.case_number ? `${p.case_number}${p.snapshot_number ? ` · instantánea ${p.snapshot_number}` : ''}: ` : ''}${DD_MESSAGE[p.status]}`);
      add('EVIDENCE', p.status === 'OK', i.lot_code, p.status === 'OK' ? 'Exigida y cumplida dentro del paquete aprobado.' : 'Se acredita con el paquete de diligencia aprobado (pendiente).');
      packages.push({ item_id: i.id, lot_id: i.lot_id, export_id: p.export_id });
    }
    const total = items.reduce((a, i) => a + scaled(String(i.quantity)), 0n);
    const gate = await this.kde.evaluateTransition({ ...ctx, permissions: [...new Set([...ctx.permissions, 'shipment:read', 'lot:read'] as Permission[])] }, 'SHIPMENT_DISPATCH', {
      SHIPMENT_REF: s.id, SHIPMENT_BUYER: s.buyer_id, SHIPMENT_DESTINATION: `${s.destination_country}${s.destination_place ? ` · ${s.destination_place}` : ''}`,
      SHIPMENT_LOTS: items.map((i) => i.lot_id), SHIPMENT_QUANTITY: items.length ? { value: unscaled(total), unit: 'KG' } : null,
      // D-34.A.2: la lista solo se envía si TODOS los ítems están acreditados; si falta uno, el KDE queda
      // ausente y la compuerta bloquea por REQUIRED, que es lo que debe ocurrir.
      SHIPMENT_ITEM_PACKAGES: items.length && packages.every((x) => x.export_id) ? packages.map((x) => x.export_id) : null,
      // El sello lo pone el servidor en la transacción de despacho; aquí se evalúa el valor que tendrá.
      SHIPMENT_DISPATCH_AT: (dispatchAt ?? new Date()).toISOString(),
    }, db);
    add('GATE', gate.allowed, null, gate.allowed ? 'Datos mínimos del embarque completos.' : gate.blocking.map((b) => b.message).join(' '));
    return { allowed: checks.every((c) => c.status === 'OK'), checks, gate, packages };
  }

  async preflight(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, 'shipment:read', false);
    const s = await this.db.selectFrom('shipments').select('id').where('organization_id', '=', orgId).where('id', '=', id).executeTakeFirst();
    if (!s) throw notFound('El embarque no existe en tu organización.');
    const p = await this.preflightChecks(this.db, ctx, id);
    return { allowed: p.allowed, checks: p.checks, gate: { transition: p.gate.transition, release: p.gate.release, allowed: p.gate.allowed, blocking: p.gate.blocking },
      note: 'Despachar exige todas las comprobaciones. Un paquete de diligencia exportado no es una DDS presentada; READY indica preparación interna.' };
  }

  /** Despacho idempotente: consume cada reserva una sola vez (−reservado y −físico) si el preflight pasa. */
  async dispatch(user: AuthUser, orgId: string, id: string, dto: ShipmentDispatchDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'shipment:dispatch', true);
    const prior = await this.db.selectFrom('shipments').select(['id']).where('organization_id', '=', orgId).where('dispatch_operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.id !== id) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, shipment: await this.view(this.db, ctx, id) };
    }
    let replayed = false;
    try {
      await this.db.transaction().execute(async (trx) => {
        const s = await this.lockShipment(trx, ctx, id);
        // Reintento concurrente con el mismo identificador: esperó el bloqueo y encuentra el despacho ya hecho.
        if (s.dispatch_operation_id === dto.operation_id) { replayed = true; return; }
        if (Number(s.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó el embarque. Recarga y revisa antes de continuar.');
        this.requireDraft(s);
        const items = await trx.selectFrom('shipment_items').select('lot_id').where('shipment_id', '=', id).orderBy('lot_id').execute();
        for (const i of items) await trx.selectFrom('lots').select('id').where('id', '=', i.lot_id).forUpdate().execute();
        // El sello del servidor, fijado una sola vez y usado tanto para la compuerta como para la fila.
        const dispatchAt = new Date();
        // Revalidación DENTRO de la transacción, con los lotes bloqueados: autorización ya comprobada arriba,
        // reservas y cantidades vigentes, acreditación de CADA ítem y las demás compuertas.
        const p = await this.preflightChecks(trx, ctx, id, dispatchAt);
        await trx.insertInto('gate_evaluations').values({ id: randomUUID(), organization_id: ctx.organizationId, entity_type: 'shipment', entity_id: id, transition: p.gate.transition, release_version: p.gate.release,
          allowed: p.allowed, result: JSON.stringify({ checks: p.checks.map((c) => ({ code: c.code, subject: c.subject, status: c.status })), blocking: p.gate.blocking, pending: p.gate.pending }), evaluated_by: user.id }).execute();
        if (!p.allowed) throw new AppError(409, 'DISPATCH_BLOCKED', 'No se puede despachar: hay comprobaciones sin cumplir. Revisa el preflight.', p.checks.filter((c) => c.status !== 'OK').map((c) => ({ field: c.subject ? `${c.code}:${c.subject}` : c.code, reason: c.message })));
        // D-34.A.2: la acreditación de cada ítem se registra ANTES de consumir reservas. El disparador de la
        // base comprueba correspondencia con el lote, tipo DD_PACKAGE y organización; si alguno no cuadra, la
        // transacción entera se aborta y no se consume ninguna reserva ni se guarda un despacho parcial.
        for (const paquete of p.packages) {
          if (!paquete.export_id) throw new AppError(409, 'DISPATCH_BLOCKED', 'Falta la acreditación de diligencia de un ítem.', [{ field: `DD_PACKAGE:${paquete.lot_id}`, reason: 'sin paquete' }]);
          await trx.updateTable('shipment_items').set({ dd_package_export_id: paquete.export_id } as never)
            .where('id', '=', paquete.item_id).where('organization_id', '=', ctx.organizationId).execute();
        }
        const res = await trx.selectFrom('shipment_reservations').select(['id', 'lot_id', 'location_id', 'quantity']).where('shipment_id', '=', id).where('status', '=', 'ACTIVE').forUpdate().execute();
        const movements: string[] = [];
        for (const r of res) {
          const q = dec(r.quantity)!;
          const mid = await postMovement(trx, { organizationId: ctx.organizationId, type: 'SHIPMENT_DISPATCH', sourceType: 'shipment_reservation', sourceId: r.id, operationId: movements.length ? null : dto.operation_id, actorId: user.id,
            reference: { shipment_id: id, reservation_id: r.id, lot_id: r.lot_id }, lines: [{ lot_id: r.lot_id, location_id: r.location_id, bucket: 'RESERVED', quantity: `-${q}` }, { lot_id: r.lot_id, location_id: r.location_id, bucket: 'PHYSICAL', quantity: `-${q}` }] });
          await trx.updateTable('shipment_reservations').set({ status: 'CONSUMED', end_movement_id: mid, ended_at: new Date() } as never).where('id', '=', r.id).execute();
          await trx.updateTable('lots').set({ row_version: sql`row_version + 1` } as never).where('id', '=', r.lot_id).execute();
          movements.push(mid);
        }
        const after = await this.bump(trx, id, { status: 'DISPATCHED', dispatch_at: dispatchAt, dispatched_by: user.id, dispatch_operation_id: dto.operation_id });
        await this.record(trx, ctx, user.id, s, Number(after.row_version), 'ShipmentDispatched', { movements, reservations: res.map((r) => ({ reservation_id: r.id, lot_id: r.lot_id, quantity: dec(r.quantity), unit: 'KG' })), dd_packages: p.packages },
          'shipment.dispatch', { status: 'DISPATCHED', reservations: res.length }, requestId);
      });
    } catch (err) {
      const e = err as { constraint?: string };
      if (e.constraint === 'shipments_dispatch_operation_uq' || e.constraint === 'stock_movements_operation_uq') {
        const again = await this.db.selectFrom('shipments').select('id').where('organization_id', '=', orgId).where('dispatch_operation_id', '=', dto.operation_id).executeTakeFirst();
        if (again?.id === id) return { replayed: true, shipment: await this.view(this.db, ctx, id) };
      }
      this.ledgerError(err);
    }
    return { replayed, shipment: await this.view(this.db, ctx, id) };
  }

  // ---------- Lecturas ----------

  private async view(db: Db, ctx: TenantContext, id: string) {
    const s = (await sql<{ id: string; shipment_code: string; status: string; row_version: string; destination_country: string; destination_place: string | null; notes: string | null; dispatch_at: string | null; cancel_reason: string | null; created_at: string;
      buyer_id: string; buyer_code: string; buyer_name: string; buyer_country: string; location_id: string; location_code: string; location_name: string; cf: string | null; cl: string | null; df: string | null; dl: string | null }>`
      SELECT s.id, s.shipment_code, s.status, s.row_version::text, s.destination_country, s.destination_place, s.notes, s.dispatch_at, s.cancel_reason, s.created_at,
             b.id AS buyer_id, b.code AS buyer_code, b.name AS buyer_name, b.country AS buyer_country, loc.id AS location_id, loc.code AS location_code, loc.name AS location_name,
             cu.first_name AS cf, cu.last_name AS cl, du.first_name AS df, du.last_name AS dl
      FROM shipments s JOIN buyers b ON b.id = s.buyer_id JOIN locations loc ON loc.id = s.origin_location_id JOIN users cu ON cu.id = s.created_by LEFT JOIN users du ON du.id = s.dispatched_by
      WHERE s.organization_id = ${ctx.organizationId} AND s.id = ${id}`.execute(db)).rows[0];
    if (!s) throw notFound('El embarque no existe en tu organización.');
    const items = await db.selectFrom('shipment_items as i').innerJoin('lots as l', 'l.id', 'i.lot_id').innerJoin('products as p', 'p.id', 'l.product_id')
      .select(['i.id', 'i.lot_id', 'i.quantity', 'l.lot_code', 'l.origin_status', 'p.name as product']).where('i.shipment_id', '=', id).orderBy('l.lot_code').execute();
    const reservations = await db.selectFrom('shipment_reservations').select(['id', 'item_id', 'quantity', 'status', 'release_reason', 'created_at', 'ended_at']).where('shipment_id', '=', id).orderBy('created_at').execute();
    const can = (p: Permission) => this.has(ctx, p);
    const draft = s.status === 'DRAFT';
    return {
      // RF-47: la referencia se entrega en la LECTURA AUTORIZADA del recurso. No es publicarla por
      // audiencias (eso es RF-33) ni concede acceso: quien lee esto ya está autorizado sobre el recurso.
      public_reference: await referenciaDe(db, ctx.organizationId, 'SHIPMENT', s.id),
      id: s.id, shipment_code: s.shipment_code, status: s.status, status_label: STATUS_LABEL[s.status], row_version: Number(s.row_version),
      buyer: { id: s.buyer_id, code: s.buyer_code, name: s.buyer_name, country: s.buyer_country, verification: 'DECLARED' },
      destination: { country: s.destination_country, place: s.destination_place, verification: 'DECLARED' },
      origin_location: { id: s.location_id, code: s.location_code, name: s.location_name },
      notes: s.notes, created_at: s.created_at, created_by: name(s.cf, s.cl), dispatch_at: s.dispatch_at, dispatched_by: s.dispatch_at ? name(s.df, s.dl) : null, cancel_reason: s.cancel_reason,
      items: items.map((i) => {
        const rs = reservations.filter((r) => r.item_id === i.id);
        return { id: i.id, lot_id: i.lot_id, lot_code: i.lot_code, product: i.product, origin_status: i.origin_status, quantity: { value: dec(i.quantity), unit: 'KG' },
          reservation: (() => { const a = rs.find((r) => r.status === 'ACTIVE' || r.status === 'CONSUMED'); return a ? { id: a.id, status: a.status, quantity: { value: dec(a.quantity), unit: 'KG' } } : null; })(),
          history: rs.map((r) => ({ id: r.id, status: r.status, quantity: { value: dec(r.quantity), unit: 'KG' }, reason: r.release_reason, at: r.created_at, ended_at: r.ended_at })) };
      }),
      totals: { quantity: { value: unscaled(items.reduce((a, i) => a + scaled(String(i.quantity)), 0n)), unit: 'KG' } },
      actions: { manage: can('shipment:manage') && draft, reserve: can('stock:reserve') && draft, dispatch: can('shipment:dispatch') && draft },
      submission: { status: 'NOT_SUBMITTED', note: 'Despachar no presenta ninguna DDS: la presentación oficial es otra dimensión (no implementada).' },
    };
  }
}

@ApiTags('shipments')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class ShipmentsController {
  constructor(private readonly service: ShipmentsService) {}

  @Get('buyers') buyers(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.listBuyers(u, o); }
  @Post('buyers') createBuyer(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: CreateBuyerDto, @Req() req: AuthedRequest) { return this.service.createBuyer(u, o, dto, req.requestId); }
  @Get('shipments/options') options(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.options(u, o); }
  @Get('shipments') list(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.list(u, o); }
  @Post('shipments') create(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: CreateShipmentDto, @Req() req: AuthedRequest) { return this.service.create(u, o, dto, req.requestId); }
  @Get('shipments/:id') detail(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(u, o, id); }
  @Post('shipments/:id/items') addItem(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShipmentAddItemDto, @Req() req: AuthedRequest) { return this.service.addItem(u, o, id, dto, req.requestId); }
  @Post('shipments/:id/items/:itemId/remove') @HttpCode(200) removeItem(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: ShipmentVersionDto, @Req() req: AuthedRequest) { return this.service.removeItem(u, o, id, itemId, dto, req.requestId); }
  @Post('shipments/:id/reserve') reserve(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShipmentReserveDto, @Req() req: AuthedRequest) { return this.service.reserve(u, o, id, dto, req.requestId); }
  @Post('shipments/:id/reservations/:reservationId/release') @HttpCode(200) release(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Param('reservationId', ParseUUIDPipe) rid: string, @Body() dto: ShipmentReleaseDto, @Req() req: AuthedRequest) { return this.service.release(u, o, id, rid, dto, req.requestId); }
  @Get('shipments/:id/preflight') preflight(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.preflight(u, o, id); }
  @Post('shipments/:id/dispatch') @HttpCode(200) dispatch(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShipmentDispatchDto, @Req() req: AuthedRequest) { return this.service.dispatch(u, o, id, dto, req.requestId); }
  @Post('shipments/:id/cancel') @HttpCode(200) cancel(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShipmentCancelDto, @Req() req: AuthedRequest) { return this.service.cancel(u, o, id, dto, req.requestId); }
}
