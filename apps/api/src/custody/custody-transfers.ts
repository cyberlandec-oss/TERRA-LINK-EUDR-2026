import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { CustodyStep, Database } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { scaled } from '../traceability/kde-validator';
import { holderBalances, postMovement } from '../inventory/ledger';

// A-03 (RF-50) — Traspaso de CUSTODIA FÍSICA entre organizaciones. Contrato: docs/decisiones/A03-TRASPASO-ENTRE-ORGANIZACIONES.md.
// Recorrido: vínculo bilateral → oferta (reserva en el libro del emisor) → aceptación (la receptora fija producto y centro) → salida →
// tránsito → recepción (total o parcial) → conciliación de diferencias → cierre. Ningún `organization_id` cambia: cada cantidad se mueve por
// movimientos del ledger de la organización que la tiene. El TRÁNSITO no es saldo de nadie: se deriva de los pasos append-only del traspaso.
//
// Lo que este módulo NO hace (decisiones sin resolver, no se simulan):
//  · D4 — la SALIDA real exige la compuerta `TRANSFER_DISPATCH_GATE`, que hoy BLOQUEA (D-34 y diligencia pendientes). No hay bypass en la API
//    operativa; las pruebas la sustituyen únicamente mediante `jest.spyOn` sobre el proveedor.
//  · D2 — el lote de la receptora nace con origen INCOMPLETO y NO hereda expediente, severidad, conclusión ni aprobación del emisor.
//  · D3(b) — la receptora recibe una proyección técnica inmutable del origen (con hash), no acceso al inventario ni a los datos del emisor.
//  · Un traspaso no es compraventa, no es exportación y no equivale a presentar una DDS.

type Db = Kysely<Database> | Transaction<Database>;
const DEC = /^\d{1,14}(\.\d{1,6})?$/;
const unscaled = (n: bigint) => { const neg = n < 0n; const a = neg ? -n : n; const f = (a % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, ''); return `${neg ? '-' : ''}${a / 1_000_000n}${f ? `.${f}` : ''}`; };
const dec = (v: unknown) => unscaled(scaled(String(v ?? '0')));
const subDerived = (op: string, tag: string) => { const h = createHash('sha256').update(`${op}:${tag}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };

export interface TransferGateInput { transferId: string; senderOrgId: string; receiverOrgId: string; lotId: string; quantity: string }
export interface TransferGateResult { allowed: boolean; code: string; message: string }
export interface TransferDispatchGate { evaluate(input: TransferGateInput): Promise<TransferGateResult> }
export const TRANSFER_DISPATCH_GATE = Symbol('TRANSFER_DISPATCH_GATE');
/** Compuerta por defecto: BLOQUEA. D4(a) no está adoptada y D-34 sigue sin resolverse; ninguna salida real pasa hasta decidirlo. */
@Injectable()
export class BlockingTransferDispatchGate implements TransferDispatchGate {
  async evaluate(): Promise<TransferGateResult> {
    return { allowed: false, code: 'TRANSFER_DISPATCH_GATE_BLOCKED', message: 'La salida real de un traspaso está bloqueada: falta resolver la condición de diligencia debida (D-34 y decisión D4 de A-03). La oferta, la reserva y la aceptación sí son válidas; la salida no se simula.' };
  }
}

class PartnershipInviteDto { @ApiProperty() @IsUUID() operation_id!: string }
class PartnershipConfirmDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ description: 'Código entregado por la otra organización (se muestra una sola vez al proponer)' }) @IsString() @Length(8, 32) code!: string;
}
class PartnershipRevokeDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
class CustodyOfferDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsUUID() partnership_id!: string;
  @ApiProperty() @IsUUID() lot_id!: string;
  @ApiProperty({ description: 'Centro del emisor del que sale la existencia' }) @IsUUID() location_id!: string;
  @ApiProperty({ description: 'KG, texto decimal' }) @IsString() @Matches(DEC) quantity!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) note?: string;
  @ApiPropertyOptional({ description: 'Devolución vinculada: traspaso anterior recibido por esta organización' }) @IsOptional() @IsUUID() returns_transfer_id?: string;
}
class CustodyAcceptDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty({ description: 'Producto de la receptora con el que se registrará lo recibido (KG)' }) @IsUUID() product_id!: string;
  @ApiProperty({ description: 'Centro de la receptora donde ingresará' }) @IsUUID() location_id!: string;
}
class CustodyReasonDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
class CustodyDispatchDto {
  @ApiProperty({ description: 'Idempotencia: repetir con el mismo identificador no da salida dos veces' }) @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
}
class CustodyReceiveDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty({ description: 'KG que llegaron de verdad en esta recepción' }) @IsString() @Matches(DEC) quantity!: string;
  @ApiPropertyOptional({ description: 'Obligatorio si lo que llegó supera lo que está en tránsito' }) @IsOptional() @IsString() @Length(3, 500) reason?: string;
}
class CustodyQuantityReasonDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty() @IsString() @Matches(DEC) quantity!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
class CustodyResolveDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty({ enum: ['LOSS_CONFIRMED', 'SHORTAGE_REOPENED', 'OVERAGE_CONFIRMED', 'OVERAGE_WITHDRAWN'] }) @IsIn(['LOSS_CONFIRMED', 'SHORTAGE_REOPENED', 'OVERAGE_CONFIRMED', 'OVERAGE_WITHDRAWN']) resolution!: 'LOSS_CONFIRMED' | 'SHORTAGE_REOPENED' | 'OVERAGE_CONFIRMED' | 'OVERAGE_WITHDRAWN';
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

const STATUS_LABEL: Record<string, string> = { OFFERED: 'Ofrecido', ACCEPTED: 'Aceptado', IN_TRANSIT: 'En tránsito', WITH_DISCREPANCY: 'Con diferencia pendiente', CLOSED: 'Cerrado', REJECTED: 'Rechazado', CANCELLED: 'Cancelado' };
const OPEN_STATES = ['OFFERED', 'ACCEPTED', 'IN_TRANSIT', 'WITH_DISCREPANCY'];
type Transfer = Selectable<Database['custody_transfers']>;
type Party = 'SENDER' | 'RECEIVER';

@Injectable()
export class CustodyTransfersService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    @Inject(TRANSFER_DISPATCH_GATE) private readonly gate: TransferDispatchGate,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private async ctx(user: AuthUser, orgId: string, perm: Permission, mutation: boolean) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!ctx.permissions.includes(perm)) throw forbidden();
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }
  private async record(trx: Transaction<Database>, orgId: string, userId: string, entity: { type: string; id: string; code: string }, aggregate: 'CUSTODY_TRANSFER' | 'ORG_PARTNERSHIP', version: number,
    eventType: string, payload: Record<string, unknown>, action: string, after: Record<string, unknown>, requestId?: string) {
    await this.events.append(trx, { organizationId: orgId, eventType, schemaVersion: 1, aggregateType: aggregate, aggregateId: entity.id, aggregateVersion: version, actorId: userId, correlationId: requestId, payload: { [`${entity.type}_id`]: entity.id, ...payload } });
    await this.audit.record(trx, { organizationId: orgId, actorUserId: userId, action, entityType: entity.type, entityId: entity.id, requestId, result: 'SUCCESS', after: { code: entity.code, ...after } });
  }
  private async bump(trx: Transaction<Database>, id: string, set: Record<string, unknown> = {}) {
    return trx.updateTable('custody_transfers').set({ ...set, updated_at: sql`now()`, row_version: sql`row_version + 1` } as never).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }
  private ledgerError(err: unknown): never {
    const e = err as { code?: string; message?: string };
    if (e.code === '23514' && /stock_entries/.test(e.message ?? '')) throw new AppError(409, 'INSUFFICIENT_AVAILABLE', 'Otra operación usó esa cantidad al mismo tiempo, o el saldo quedaría negativo. Recarga los saldos.', [{ field: 'quantity', reason: 'AVAILABLE_QUANTITY_EXCEEDED' }]);
    if (e.code === '23514' && /custody_transfer_steps/.test(e.message ?? '')) throw new AppError(409, 'TRANSIT_EXCEEDED', 'La cantidad supera lo que está en tránsito. Recarga el traspaso.', [{ field: 'quantity', reason: 'TRANSIT_QUANTITY_EXCEEDED' }]);
    throw err;
  }
  private stateError(t: { status: string }, msg: string): never { throw new AppError(409, 'TRANSFER_STATE', msg, [{ field: 'status', reason: t.status }]); }

  /** Bloquea el traspaso (única forma de serializar pasos concurrentes) y determina de qué lado actúa la organización. */
  private async lockFor(trx: Transaction<Database>, orgId: string, id: string, expected?: number, want?: Party): Promise<{ t: Transfer; party: Party }> {
    const t = await trx.selectFrom('custody_transfers').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!t || (t.sender_org_id !== orgId && t.receiver_org_id !== orgId)) throw notFound('El traspaso no existe para tu organización.');
    const party: Party = t.sender_org_id === orgId ? 'SENDER' : 'RECEIVER';
    // El lado se comprueba ANTES que la versión: quien no es parte de la acción no aprende nada del estado del traspaso.
    if (want) this.requireParty(party, want);
    if (expected !== undefined && Number(t.row_version) !== expected) throw conflict('VERSION_CONFLICT', 'Otra persona modificó el traspaso. Recarga y revisa antes de continuar.');
    return { t, party };
  }
  private requireParty(party: Party, want: Party) {
    if (party !== want) throw forbidden('WRONG_SIDE', want === 'SENDER' ? 'Solo la organización emisora puede hacer esto.' : 'Solo la organización receptora puede hacer esto.');
  }

  private async totals(db: Db, transferId: string) {
    const r = (await sql<{ dispatched: string; received: string; overage_confirmed: string; rejected: string; loss: string; open_shortage: string; open_overage: string; discrepancies: number }>`
      SELECT coalesce(sum(s.quantity) FILTER (WHERE s.step = 'DISPATCH'), 0)::text AS dispatched,
             coalesce(sum(s.quantity) FILTER (WHERE s.step = 'RECEIPT'), 0)::text AS received,
             coalesce(sum(s.quantity) FILTER (WHERE s.step = 'OVERAGE_CONFIRMED'), 0)::text AS overage_confirmed,
             coalesce(sum(s.quantity) FILTER (WHERE s.step = 'REJECT_TRANSIT'), 0)::text AS rejected,
             coalesce(sum(s.quantity) FILTER (WHERE s.step = 'LOSS_CONFIRMED'), 0)::text AS loss,
             (SELECT coalesce(sum(d.quantity), 0)::text FROM custody_discrepancies d WHERE d.transfer_id = ${transferId} AND d.status = 'OPEN' AND d.kind = 'SHORTAGE') AS open_shortage,
             (SELECT coalesce(sum(d.quantity), 0)::text FROM custody_discrepancies d WHERE d.transfer_id = ${transferId} AND d.status = 'OPEN' AND d.kind = 'OVERAGE') AS open_overage,
             (SELECT count(*)::int FROM custody_discrepancies d WHERE d.transfer_id = ${transferId}) AS discrepancies
      FROM custody_transfer_steps s WHERE s.transfer_id = ${transferId}`.execute(db)).rows[0];
    const D = scaled(r.dispatched), R = scaled(r.received), J = scaled(r.rejected), L = scaled(r.loss);
    return {
      dispatched: dec(r.dispatched), received: dec(r.received), overage_confirmed: dec(r.overage_confirmed), rejected_returned_to_sender: dec(r.rejected), loss_confirmed: dec(r.loss),
      in_transit: unscaled(D - R - J - L), open_shortage: dec(r.open_shortage), open_overage: dec(r.open_overage), discrepancy_count: r.discrepancies,
      _transit: D - R - J - L, _open: scaled(r.open_shortage) + scaled(r.open_overage), _equal: D === R && J === 0n && L === 0n,
    };
  }

  /** Estado derivado de los pasos: tránsito 0 y sin diferencias abiertas → CERRADO; con diferencias abiertas → CON DIFERENCIA; si no, EN TRÁNSITO. */
  private async settle(trx: Transaction<Database>, t: Transfer) {
    const tot = await this.totals(trx, t.id);
    const openCount = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM custody_discrepancies WHERE transfer_id = ${t.id} AND status = 'OPEN'`.execute(trx)).rows[0].n;
    if (tot._transit === 0n && openCount === 0) {
      const complete = tot._equal && scaled(tot.overage_confirmed) === 0n;
      return { status: 'CLOSED' as const, closure: complete ? 'COMPLETE' as const : 'WITH_DIFFERENCES' as const, tot };
    }
    return { status: openCount > 0 ? 'WITH_DISCREPANCY' as const : 'IN_TRANSIT' as const, closure: null, tot };
  }
  private async applySettle(trx: Transaction<Database>, ctx: TenantContext, userId: string, t: Transfer, eventType: string, action: string, payload: Record<string, unknown>, requestId?: string) {
    const s = await this.settle(trx, t);
    const after = await this.bump(trx, t.id, { status: s.status, closure: s.closure });
    await this.record(trx, ctx.organizationId, userId, { type: 'custody_transfer', id: t.id, code: t.transfer_code }, 'CUSTODY_TRANSFER', Number(after.row_version), eventType,
      { status: s.status, closure: s.closure, in_transit: s.tot.in_transit, ...payload }, action, { status: s.status, closure: s.closure, in_transit: s.tot.in_transit, ...payload }, requestId);
    if (s.status === 'CLOSED' && t.status !== 'CLOSED') {
      await this.events.append(trx, { organizationId: ctx.organizationId, eventType: 'CustodyTransferClosed', schemaVersion: 1, aggregateType: 'CUSTODY_TRANSFER', aggregateId: t.id, aggregateVersion: Number(after.row_version) + 1, actorId: userId, correlationId: requestId,
        payload: { transfer_id: t.id, closure: s.closure, dispatched: s.tot.dispatched, received: dec(unscaled(scaled(s.tot.received) + scaled(s.tot.overage_confirmed))), returned_to_sender: s.tot.rejected_returned_to_sender, loss_confirmed: s.tot.loss_confirmed } });
      await this.bump(trx, t.id);
    }
    return after;
  }
  private async step(trx: Transaction<Database>, t: Transfer, ctx: TenantContext, userId: string, step: CustodyStep, operationId: string, f: { id?: string; quantity?: string; reason?: string; movementId?: string | null; detail?: Record<string, unknown> } = {}) {
    const id = f.id ?? randomUUID();
    await trx.insertInto('custody_transfer_steps').values({ id, transfer_id: t.id, actor_org_id: ctx.organizationId, actor_user_id: userId, step, quantity: f.quantity ?? null, reason: f.reason?.trim() ?? null,
      detail: JSON.stringify(f.detail ?? {}) as never, movement_id: f.movementId ?? null, operation_id: operationId } as never).execute();
    return id;
  }
  /** Reintento: si el paso de esta operación ya existe y es del mismo traspaso y tipo, se devuelve el estado actual sin repetir efectos. */
  private async replay(orgId: string, operationId: string, transferId: string | null, steps: CustodyStep[]) {
    const prior = await this.db.selectFrom('custody_transfer_steps').select(['transfer_id', 'step']).where('actor_org_id', '=', orgId).where('operation_id', '=', operationId).executeTakeFirst();
    if (!prior) return null;
    if ((transferId && prior.transfer_id !== transferId) || !steps.includes(prior.step)) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
    return prior.transfer_id;
  }
  private async lotCode(trx: Transaction<Database>, orgId: string) {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`LOT:${orgId}`}))`.execute(trx);
    const n = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM lots WHERE organization_id = ${orgId}`.execute(trx)).rows[0].n + 1;
    return `LOT-${new Date().toISOString().slice(0, 4)}-${String(n).padStart(5, '0')}`;
  }
  /** El lote de la receptora nace en la primera cantidad recibida: sin entradas de recepción, cerrado a entradas y con origen INCOMPLETO (D2/D3b). */
  private async ensureReceiverLot(trx: Transaction<Database>, t: Transfer, userId: string, operationId: string, requestId?: string) {
    if (t.receiver_lot_id) return t.receiver_lot_id;
    const id = randomUUID();
    const code = await this.lotCode(trx, t.receiver_org_id);
    await trx.insertInto('lots').values({ id, organization_id: t.receiver_org_id, lot_code: code, product_id: t.receiver_product_id!, unit: 'KG', source: 'CUSTODY_TRANSFER', status: 'CLOSED_FOR_INPUT',
      origin_status: 'INCOMPLETE', process_run_id: null, output_quantity: null, created_by: userId, operation_id: operationId } as never).execute();
    await this.events.append(trx, { organizationId: t.receiver_org_id, eventType: 'LotCreated', schemaVersion: 1, aggregateType: 'LOT', aggregateId: id, aggregateVersion: 1, actorId: userId, correlationId: requestId,
      payload: { lot_id: id, lot_code: code, product_id: t.receiver_product_id, source: 'CUSTODY_TRANSFER', origin_status: 'INCOMPLETE', transfer_id: t.id } });
    await this.audit.record(trx, { organizationId: t.receiver_org_id, actorUserId: userId, action: 'lot.create', entityType: 'lot', entityId: id, requestId, result: 'SUCCESS', after: { code, source: 'CUSTODY_TRANSFER', origin_status: 'INCOMPLETE', transfer_code: t.transfer_code } });
    await trx.updateTable('custody_transfers').set({ receiver_lot_id: id } as never).where('id', '=', t.id).execute();
    t.receiver_lot_id = id;
    return id;
  }
  private async receiveIntoLedger(trx: Transaction<Database>, t: Transfer, ctx: TenantContext, userId: string, step: CustodyStep, operationId: string, quantity: string, requestId?: string, reason?: string) {
    const lotId = await this.ensureReceiverLot(trx, t, userId, operationId, requestId);
    await trx.selectFrom('lots').select('id').where('id', '=', lotId).forUpdate().executeTakeFirstOrThrow();
    const stepId = randomUUID();
    // El origen del movimiento es el PASO (único por recepción parcial): el ledger admite un movimiento por tipo y origen.
    const mid = await postMovement(trx, { organizationId: t.receiver_org_id, type: 'CUSTODY_IN', sourceType: 'custody_transfer_step', sourceId: stepId, operationId: ctx.organizationId === t.receiver_org_id ? operationId : null, actorId: userId,
      reason: reason ?? null, reference: { transfer_id: t.id, sender_org_id: t.sender_org_id, sender_lot_id: t.sender_lot_id, step }, lines: [{ lot_id: lotId, location_id: t.receiver_location_id, bucket: 'PHYSICAL', quantity }] });
    await trx.insertInto('custody_transfer_steps').values({ id: stepId, transfer_id: t.id, actor_org_id: ctx.organizationId, actor_user_id: userId, step, quantity, reason: reason?.trim() ?? null,
      detail: JSON.stringify({ receiver_lot_id: lotId, receiver_location_id: t.receiver_location_id }) as never, movement_id: ctx.organizationId === t.receiver_org_id ? mid : null, operation_id: operationId } as never).execute();
    // El movimiento pertenece al libro de la receptora; el paso lo referencia solo cuando actúa la receptora (FK compuesta por organización).
    await trx.insertInto('custody_lot_links').values({ id: randomUUID(), transfer_id: t.id, step_id: stepId, parent_org_id: t.sender_org_id, parent_lot_id: t.sender_lot_id, child_org_id: t.receiver_org_id, child_lot_id: lotId, quantity, unit: 'KG' } as never).execute();
    await trx.updateTable('lots').set({ row_version: sql`row_version + 1` } as never).where('id', '=', lotId).execute();
    return { stepId, movementId: mid, lotId };
  }

  // ---------- Vínculos bilaterales (D6a) ----------

  private async orgName(db: Db, id: string) { return (await db.selectFrom('organizations').select('name').where('id', '=', id).executeTakeFirst())?.name ?? 'Organización'; }
  private partnershipView(p: Selectable<Database['org_partnerships']>, orgId: string, names: Map<string, string>) {
    const other = p.requester_org_id === orgId ? p.counterpart_org_id : p.requester_org_id;
    return { id: p.id, status: p.status, you_proposed: p.requester_org_id === orgId, counterpart_organization_id: other, counterpart_name: other ? (names.get(other) ?? 'Organización') : null, expires_at: p.expires_at, confirmed_at: p.confirmed_at,
      revoked_at: p.revoked_at, revoke_reason: p.revoke_reason, revoked_by_you: p.revoked_by_org === orgId ? true : p.revoked_by_org ? false : null, created_at: p.created_at };
  }
  async listPartnerships(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, 'transfer:read', false);
    const rows = await this.db.selectFrom('org_partnerships').selectAll().where((eb) => eb.or([eb('requester_org_id', '=', ctx.organizationId), eb('counterpart_org_id', '=', ctx.organizationId)])).orderBy('created_at', 'desc').execute();
    const ids = [...new Set(rows.flatMap((r) => [r.requester_org_id, r.counterpart_org_id]).filter((x): x is string => !!x))];
    const orgs = ids.length ? await this.db.selectFrom('organizations').select(['id', 'name']).where('id', 'in', ids).execute() : [];
    const names = new Map(orgs.map((o) => [o.id, o.name]));
    return { items: rows.map((p) => this.partnershipView(p, ctx.organizationId, names)), note: 'Un vínculo permite traspasar custodia física entre dos organizaciones. No concede acceso a los datos ni al inventario de la otra.' };
  }

  async invite(user: AuthUser, orgId: string, dto: PartnershipInviteDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'partnership:manage', true);
    const prior = await this.db.selectFrom('org_partnerships').selectAll().where('requester_org_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) return { replayed: true, partnership: this.partnershipView(prior, orgId, new Map()), code: null, note: 'El código solo se muestra al crear la propuesta.' };
    const code = randomBytes(8).toString('hex').toUpperCase().slice(0, 12);
    const id = randomUUID();
    const hash = createHash('sha256').update(code).digest('hex');
    const p = await this.db.transaction().execute(async (trx) => {
      const row = await trx.insertInto('org_partnerships').values({ id, requester_org_id: orgId, counterpart_org_id: null, code_hash: hash, status: 'PENDING', expires_at: sql`now() + interval '7 days'` as never,
        created_by: user.id, confirmed_by: null, confirmed_at: null, revoked_by: null, revoked_by_org: null, revoked_at: null, revoke_reason: null, operation_id: dto.operation_id } as never).returningAll().executeTakeFirstOrThrow();
      await this.record(trx, ctx.organizationId, user.id, { type: 'org_partnership', id, code: id.slice(0, 8) }, 'ORG_PARTNERSHIP', 1, 'OrgPartnershipProposed', { status: 'PENDING' }, 'partnership.propose', { status: 'PENDING' }, requestId);
      return row;
    });
    return { replayed: false, partnership: this.partnershipView(p, orgId, new Map()), code, note: 'Entrega este código a la otra organización por un canal que ya uses con ella. Caduca en 7 días y no se vuelve a mostrar.' };
  }

  async confirm(user: AuthUser, orgId: string, dto: PartnershipConfirmDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'partnership:manage', true);
    const hash = createHash('sha256').update(dto.code.trim().toUpperCase()).digest('hex');
    const invalid = () => new AppError(404, 'PARTNERSHIP_CODE_INVALID', 'El código no es válido, ya se usó o caducó. Pide uno nuevo a la otra organización.');
    const result = await this.db.transaction().execute(async (trx) => {
      const p = await trx.selectFrom('org_partnerships').selectAll().where('code_hash', '=', hash).forUpdate().executeTakeFirst();
      if (!p) throw invalid();
      if (p.status === 'ACTIVE' && p.counterpart_org_id === orgId) return { replayed: true, p };
      if (p.status !== 'PENDING' || new Date(p.expires_at).getTime() < Date.now()) throw invalid();
      if (p.requester_org_id === orgId) throw new AppError(409, 'PARTNERSHIP_SELF', 'No puedes confirmar el vínculo que propusiste tú: lo confirma la otra organización.');
      const other = await trx.selectFrom('org_partnerships').select('id').where('status', '=', 'ACTIVE')
        .where((eb) => eb.or([eb.and([eb('requester_org_id', '=', p.requester_org_id), eb('counterpart_org_id', '=', orgId)]), eb.and([eb('requester_org_id', '=', orgId), eb('counterpart_org_id', '=', p.requester_org_id)])])).executeTakeFirst();
      if (other) throw conflict('PARTNERSHIP_ALREADY_ACTIVE', 'Ya existe un vínculo activo con esa organización.');
      const row = await trx.updateTable('org_partnerships').set({ status: 'ACTIVE', counterpart_org_id: orgId, confirmed_by: user.id, confirmed_at: sql`now()` } as never).where('id', '=', p.id).returningAll().executeTakeFirstOrThrow();
      await this.record(trx, ctx.organizationId, user.id, { type: 'org_partnership', id: p.id, code: p.id.slice(0, 8) }, 'ORG_PARTNERSHIP', 2, 'OrgPartnershipConfirmed', { status: 'ACTIVE', requester_organization_id: p.requester_org_id }, 'partnership.confirm', { status: 'ACTIVE' }, requestId);
      await this.audit.record(trx, { organizationId: p.requester_org_id, actorUserId: user.id, action: 'partnership.confirmed_by_counterpart', entityType: 'org_partnership', entityId: p.id, requestId, result: 'SUCCESS', after: { counterpart_organization_id: orgId } });
      return { replayed: false, p: row };
    });
    const names = new Map([[result.p.requester_org_id, await this.orgName(this.db, result.p.requester_org_id)]]);
    return { replayed: result.replayed, partnership: this.partnershipView(result.p, orgId, names) };
  }

  async revoke(user: AuthUser, orgId: string, id: string, dto: PartnershipRevokeDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'partnership:manage', true);
    const row = await this.db.transaction().execute(async (trx) => {
      const p = await trx.selectFrom('org_partnerships').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p || (p.requester_org_id !== orgId && p.counterpart_org_id !== orgId)) throw notFound('El vínculo no existe para tu organización.');
      if (p.status === 'REVOKED') return p;
      const open = await trx.selectFrom('custody_transfers').select('id').where('partnership_id', '=', id).where('status', 'in', OPEN_STATES as never).executeTakeFirst();
      if (open) throw conflict('PARTNERSHIP_HAS_OPEN_TRANSFERS', 'Hay traspasos sin cerrar con esta organización. Ciérralos o cancélalos antes de revocar el vínculo.');
      const r = await trx.updateTable('org_partnerships').set({ status: 'REVOKED', revoked_by: user.id, revoked_by_org: orgId, revoked_at: sql`now()`, revoke_reason: dto.reason.trim() } as never).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await this.record(trx, ctx.organizationId, user.id, { type: 'org_partnership', id, code: id.slice(0, 8) }, 'ORG_PARTNERSHIP', 3, 'OrgPartnershipRevoked', { reason: dto.reason.trim() }, 'partnership.revoke', { status: 'REVOKED', reason: dto.reason.trim() }, requestId);
      return r;
    });
    const names = new Map<string, string>();
    for (const o of [row.requester_org_id, row.counterpart_org_id]) if (o) names.set(o, await this.orgName(this.db, o));
    return { partnership: this.partnershipView(row, orgId, names) };
  }

  // ---------- Opciones, listado y detalle ----------

  async options(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, 'transfer:read', false);
    const org = ctx.organizationId;
    const partners = (await sql<{ partnership_id: string; organization_id: string; name: string }>`
      SELECT p.id AS partnership_id, o.id AS organization_id, o.name FROM org_partnerships p
      JOIN organizations o ON o.id = CASE WHEN p.requester_org_id = ${org} THEN p.counterpart_org_id ELSE p.requester_org_id END
      WHERE p.status = 'ACTIVE' AND (p.requester_org_id = ${org} OR p.counterpart_org_id = ${org}) ORDER BY o.name`.execute(this.db)).rows;
    const stock = (await sql<{ lot_id: string; lot_code: string; product_name: string; location_id: string; location_code: string; available: string }>`
      SELECT l.id AS lot_id, l.lot_code, pr.name AS product_name, loc.id AS location_id, loc.code AS location_code,
             (coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'PHYSICAL'), 0) - coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'RESERVED'), 0))::text AS available
      FROM stock_entries e JOIN lots l ON l.id = e.lot_id JOIN products pr ON pr.id = l.product_id JOIN locations loc ON loc.id = e.location_id
      WHERE e.organization_id = ${org} GROUP BY l.id, l.lot_code, pr.name, loc.id, loc.code
      HAVING coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'PHYSICAL'), 0) - coalesce(sum(e.signed_quantity) FILTER (WHERE e.bucket = 'RESERVED'), 0) > 0
      ORDER BY l.lot_code, loc.code`.execute(this.db)).rows;
    const products = await this.db.selectFrom('products').select(['id', 'code', 'name']).where('organization_id', '=', org).where('status', '=', 'ACTIVE').where('unit', '=', 'KG').orderBy('code').execute();
    const locations = await this.db.selectFrom('locations').select(['id', 'code', 'name']).where('organization_id', '=', org).where('status', '=', 'ACTIVE').orderBy('code').execute();
    const returnable = (await sql<{ id: string; transfer_code: string; partner: string; received_lot_id: string; returnable: string }>`
      SELECT t.id, t.transfer_code, o.name AS partner, t.receiver_lot_id AS received_lot_id,
             (coalesce((SELECT sum(s.quantity) FROM custody_transfer_steps s WHERE s.transfer_id = t.id AND s.step IN ('RECEIPT','OVERAGE_CONFIRMED')), 0)
              - coalesce((SELECT sum(r.quantity) FROM custody_transfers r WHERE r.returns_transfer_id = t.id AND r.status NOT IN ('REJECTED','CANCELLED')), 0))::text AS returnable
      FROM custody_transfers t JOIN organizations o ON o.id = t.sender_org_id
      WHERE t.receiver_org_id = ${org} AND t.receiver_lot_id IS NOT NULL ORDER BY t.created_at DESC`.execute(this.db)).rows.filter((r) => scaled(r.returnable) > 0n);
    return { partners, stock, products, locations, returnable, unit: 'KG' };
  }

  async list(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, 'transfer:read', false);
    const org = ctx.organizationId;
    const rows = (await sql<{ id: string; transfer_code: string; status: string; sender_org_id: string; receiver_org_id: string; quantity: string; sender_name: string; receiver_name: string; lot_code: string | null; created_at: string; updated_at: string; closure: string | null; returns_transfer_id: string | null }>`
      SELECT t.id, t.transfer_code, t.status, t.sender_org_id, t.receiver_org_id, t.quantity::text AS quantity, so.name AS sender_name, ro.name AS receiver_name, t.closure, t.returns_transfer_id,
             CASE WHEN t.sender_org_id = ${org} THEN sl.lot_code ELSE rl.lot_code END AS lot_code, t.created_at, t.updated_at
      FROM custody_transfers t JOIN organizations so ON so.id = t.sender_org_id JOIN organizations ro ON ro.id = t.receiver_org_id
      JOIN lots sl ON sl.id = t.sender_lot_id LEFT JOIN lots rl ON rl.id = t.receiver_lot_id
      WHERE t.sender_org_id = ${org} OR t.receiver_org_id = ${org} ORDER BY t.created_at DESC LIMIT 200`.execute(this.db)).rows;
    return { items: rows.map((r) => ({ id: r.id, code: r.transfer_code, status: r.status, status_label: STATUS_LABEL[r.status], side: r.sender_org_id === org ? 'SENDER' : 'RECEIVER', counterpart_name: r.sender_org_id === org ? r.receiver_name : r.sender_name,
      quantity: dec(r.quantity), unit: 'KG', lot_code: r.lot_code, closure: r.closure, is_return: !!r.returns_transfer_id, created_at: r.created_at, updated_at: r.updated_at })) };
  }

  async detail(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, 'transfer:read', false);
    return this.view(this.db, ctx.organizationId, id);
  }

  /** Vista POR LADO (D9b): cada parte ve el estado, las cantidades del traspaso y sus diferencias; nunca el inventario ni los centros de la otra. */
  private async view(db: Db, orgId: string, id: string) {
    const t = await db.selectFrom('custody_transfers').selectAll().where('id', '=', id).executeTakeFirst();
    if (!t || (t.sender_org_id !== orgId && t.receiver_org_id !== orgId)) throw notFound('El traspaso no existe para tu organización.');
    const party: Party = t.sender_org_id === orgId ? 'SENDER' : 'RECEIVER';
    const names = new Map((await db.selectFrom('organizations').select(['id', 'name']).where('id', 'in', [t.sender_org_id, t.receiver_org_id]).execute()).map((o) => [o.id, o.name]));
    const tot = await this.totals(db, id);
    const steps = (await sql<{ id: string; step: string; actor_org_id: string; quantity: string | null; reason: string | null; created_at: string }>`
      SELECT id, step, actor_org_id, quantity::text AS quantity, reason, created_at FROM custody_transfer_steps WHERE transfer_id = ${id} ORDER BY created_at, id`.execute(db)).rows;
    const discrepancies = (await sql<{ id: string; kind: string; quantity: string; status: string; resolution: string | null; reason: string; recorded_by_org: string; created_at: string; resolution_reason: string | null; resolved_at: string | null }>`
      SELECT id, kind, quantity::text AS quantity, status, resolution, reason, recorded_by_org, created_at, resolution_reason, resolved_at FROM custody_discrepancies WHERE transfer_id = ${id} ORDER BY created_at, id`.execute(db)).rows;
    const mine = party === 'SENDER'
      ? await sql<{ lot_code: string | null; location_code: string | null; product_name: string | null }>`SELECT l.lot_code, loc.code AS location_code, NULL::text AS product_name FROM lots l, locations loc WHERE l.id = ${t.sender_lot_id} AND loc.id = ${t.sender_location_id}`.execute(db)
      : await sql<{ lot_code: string | null; location_code: string | null; product_name: string | null }>`SELECT (SELECT lot_code FROM lots WHERE id = ${t.receiver_lot_id}) AS lot_code, (SELECT code FROM locations WHERE id = ${t.receiver_location_id}) AS location_code, (SELECT name FROM products WHERE id = ${t.receiver_product_id}) AS product_name`.execute(db);
    const m = (mine.rows as Array<Record<string, string | null>>)[0];
    const returnedAgainst = (await sql<{ id: string; transfer_code: string; status: string; quantity: string }>`SELECT id, transfer_code, status, quantity::text AS quantity FROM custody_transfers WHERE returns_transfer_id = ${id} AND (sender_org_id = ${orgId} OR receiver_org_id = ${orgId})`.execute(db)).rows;
    const returnsOf = t.returns_transfer_id ? (await db.selectFrom('custody_transfers').select(['id', 'transfer_code']).where('id', '=', t.returns_transfer_id).executeTakeFirst()) : null;
    const next = this.nextActions(t, party, tot);
    return {
      id: t.id, code: t.transfer_code, status: t.status, status_label: STATUS_LABEL[t.status], closure: t.closure, version: Number(t.row_version), side: party,
      sender: { organization_id: t.sender_org_id, name: names.get(t.sender_org_id) }, receiver: { organization_id: t.receiver_org_id, name: names.get(t.receiver_org_id) },
      quantity: dec(t.quantity), unit: 'KG', note: t.note, reject_reason: t.reject_reason, cancel_reason: t.cancel_reason,
      your_lot_code: m.lot_code, your_location_code: m.location_code, your_product_name: party === 'RECEIVER' ? m.product_name : undefined,
      origin_projection: party === 'RECEIVER' ? t.origin_projection : undefined, origin_projection_hash: party === 'RECEIVER' ? t.origin_projection_hash : undefined,
      quantities: { offered: dec(t.quantity), in_transit: tot.in_transit, dispatched: tot.dispatched, received: tot.received, overage_confirmed: tot.overage_confirmed, returned_to_sender_in_transit: tot.rejected_returned_to_sender, loss_confirmed: tot.loss_confirmed,
        open_shortage: tot.open_shortage, open_overage: tot.open_overage },
      steps: steps.map((s) => ({ id: s.id, step: s.step, by: s.actor_org_id === orgId ? 'YOU' : 'COUNTERPART', organization_name: names.get(s.actor_org_id), quantity: s.quantity ? dec(s.quantity) : null, reason: s.reason, at: s.created_at })),
      discrepancies: discrepancies.map((d) => ({ id: d.id, kind: d.kind, quantity: dec(d.quantity), status: d.status, resolution: d.resolution, reason: d.reason, recorded_by: d.recorded_by_org === orgId ? 'YOU' : 'COUNTERPART', created_at: d.created_at, resolution_reason: d.resolution_reason, resolved_at: d.resolved_at })),
      returns: returnedAgainst, is_return_of: returnsOf,
      next_actions: next,
      boundaries: ['Un traspaso mueve custodia física: no es compraventa, no es exportación ni equivale a presentar una DDS.', 'La receptora no hereda expediente, severidad, conclusión ni aprobación del emisor; el origen de su lote queda INCOMPLETO.',
        'La proyección de origen es una instantánea técnica inmutable: no prueba origen completo ni cumplimiento.', 'Una diferencia de peso no es una pérdida hasta que se confirma con motivo.'],
    };
  }
  private nextActions(t: Transfer, party: Party, tot: Awaited<ReturnType<CustodyTransfersService['totals']>>) {
    const a: string[] = [];
    if (t.status === 'OFFERED') a.push(party === 'RECEIVER' ? 'ACCEPT' : 'CANCEL', ...(party === 'RECEIVER' ? ['REJECT'] : []));
    if (t.status === 'ACCEPTED') a.push(...(party === 'SENDER' ? ['DISPATCH', 'CANCEL'] : []));
    if ((t.status === 'IN_TRANSIT' || t.status === 'WITH_DISCREPANCY') && party === 'RECEIVER') { if (tot._transit > 0n) a.push('RECEIVE', 'DECLARE_SHORTAGE', 'REJECT_TRANSIT'); else a.push('RECEIVE'); }
    if (t.status === 'WITH_DISCREPANCY') a.push('RESOLVE');
    return a;
  }

  // ---------- Oferta, aceptación, rechazo, cancelación ----------

  async offer(user: AuthUser, orgId: string, dto: CustodyOfferDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'transfer:offer', true);
    const again = await this.db.selectFrom('custody_transfers').select(['id', 'sender_lot_id', 'quantity']).where('sender_org_id', '=', orgId).where('offer_operation_id', '=', dto.operation_id).executeTakeFirst();
    if (again) {
      if (again.sender_lot_id !== dto.lot_id || scaled(again.quantity) !== scaled(dto.quantity)) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, transfer: await this.view(this.db, orgId, again.id) };
    }
    const qty = scaled(dto.quantity);
    if (qty <= 0n) throw new AppError(422, 'VALIDATION_FAILED', 'La cantidad debe ser mayor que cero.', [{ field: 'quantity', reason: 'MUST_BE_POSITIVE' }]);
    let id = '';
    try {
      await this.db.transaction().execute(async (trx) => {
        const p = await trx.selectFrom('org_partnerships').selectAll().where('id', '=', dto.partnership_id).executeTakeFirst();
        if (!p || p.status !== 'ACTIVE' || (p.requester_org_id !== orgId && p.counterpart_org_id !== orgId)) throw new AppError(409, 'PARTNERSHIP_NOT_ACTIVE', 'No hay un vínculo activo con esa organización. Confírmalo primero.');
        const receiverOrg = p.requester_org_id === orgId ? p.counterpart_org_id! : p.requester_org_id;
        const recvStatus = await trx.selectFrom('organizations').select('status').where('id', '=', receiverOrg).executeTakeFirstOrThrow();
        if (recvStatus.status !== 'ACTIVE') throw new AppError(409, 'COUNTERPART_NOT_ACTIVE', 'La organización receptora no está activa.');
        const lot = await trx.selectFrom('lots').select(['id', 'lot_code', 'product_id', 'origin_status', 'source', 'unit']).where('organization_id', '=', orgId).where('id', '=', dto.lot_id).forUpdate().executeTakeFirst();
        if (!lot) throw notFound('El lote no existe en tu organización.');
        const loc = await trx.selectFrom('locations').select(['id', 'status']).where('organization_id', '=', orgId).where('id', '=', dto.location_id).executeTakeFirst();
        if (!loc) throw notFound('El centro no existe en tu organización.');
        let returns: Transfer | undefined;
        if (dto.returns_transfer_id) {
          returns = await trx.selectFrom('custody_transfers').selectAll().where('id', '=', dto.returns_transfer_id).forUpdate().executeTakeFirst();
          if (!returns || returns.receiver_org_id !== orgId || returns.sender_org_id !== receiverOrg) throw notFound('El traspaso a devolver no existe para tu organización con esa contraparte.');
          if (returns.receiver_lot_id !== lot.id) throw new AppError(409, 'RETURN_LOT_MISMATCH', 'Una devolución sale del lote que se recibió en ese traspaso.', [{ field: 'lot_id', reason: 'NOT_RECEIVED_LOT' }]);
          const rt = (await sql<{ q: string }>`SELECT (coalesce((SELECT sum(quantity) FROM custody_transfer_steps WHERE transfer_id = ${returns.id} AND step IN ('RECEIPT','OVERAGE_CONFIRMED')), 0)
            - coalesce((SELECT sum(quantity) FROM custody_transfers WHERE returns_transfer_id = ${returns.id} AND status NOT IN ('REJECTED','CANCELLED')), 0))::text AS q`.execute(trx)).rows[0].q;
          if (qty > scaled(rt)) throw new AppError(409, 'RETURN_EXCEEDS_RECEIVED', `Solo puedes devolver hasta ${dec(rt)} kg de lo recibido en ese traspaso.`, [{ field: 'quantity', reason: 'RETURN_EXCEEDS_RECEIVED' }]);
        }
        const b = (await holderBalances(trx, orgId, { lot_id: lot.id })).find((x) => x.location_id === dto.location_id);
        if (qty > scaled(b?.available ?? '0')) throw new AppError(409, 'INSUFFICIENT_AVAILABLE', `Disponible del lote ${lot.lot_code} en ese centro: ${dec(b?.available ?? '0')} kg. Reduce la cantidad o elige otro centro.`, [{ field: 'quantity', reason: 'AVAILABLE_QUANTITY_EXCEEDED' }]);
        const product = await trx.selectFrom('products').select(['code', 'name']).where('id', '=', lot.product_id).executeTakeFirstOrThrow();
        const senderName = await this.orgName(trx, orgId);
        const projection = { schema: 'custody-origin-projection/1', sender_organization: senderName, sender_lot_code: lot.lot_code, product: { code: product.code, name: product.name }, origin_status: lot.origin_status, lot_source: lot.source,
          captured_at: new Date().toISOString(), is_a_conformity_statement: false, disclaimer: 'Instantánea técnica: no prueba origen completo ni cumplimiento y no transfiere expediente, severidad ni conclusión.' };
        const hash = createHash('sha256').update(JSON.stringify(projection)).digest('hex');
        await sql`SELECT pg_advisory_xact_lock(hashtext(${`TRP:${orgId}`}))`.execute(trx);
        const n = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM custody_transfers WHERE sender_org_id = ${orgId}`.execute(trx)).rows[0].n + 1;
        const code = `TRP-${new Date().toISOString().slice(0, 4)}-${String(n).padStart(5, '0')}`;
        id = randomUUID();
        const mid = await postMovement(trx, { organizationId: orgId, type: 'CUSTODY_RESERVE', sourceType: 'custody_transfer', sourceId: id, operationId: dto.operation_id, actorId: user.id,
          reference: { transfer_id: id, lot_id: lot.id, receiver_org_id: receiverOrg }, lines: [{ lot_id: lot.id, location_id: dto.location_id, bucket: 'RESERVED', quantity: dec(dto.quantity) }] });
        await trx.insertInto('custody_transfers').values({ id, transfer_code: code, partnership_id: p.id, sender_org_id: orgId, receiver_org_id: receiverOrg, status: 'OFFERED', sender_lot_id: lot.id, sender_location_id: dto.location_id,
          receiver_location_id: null, receiver_product_id: null, receiver_lot_id: null, quantity: dec(dto.quantity), unit: 'KG', returns_transfer_id: returns?.id ?? null, origin_projection: JSON.stringify(projection) as never,
          origin_projection_hash: hash, note: dto.note?.trim() ?? null, closure: null, reject_reason: null, cancel_reason: null, offered_by: user.id, offer_operation_id: dto.operation_id } as never).execute();
        await this.step(trx, { id } as unknown as Transfer, ctx, user.id, 'OFFER', dto.operation_id, { movementId: mid, reason: dto.note, detail: { lot_id: lot.id, location_id: dto.location_id } });
        await trx.updateTable('lots').set({ row_version: sql`row_version + 1` } as never).where('id', '=', lot.id).execute();
        await this.record(trx, orgId, user.id, { type: 'custody_transfer', id, code }, 'CUSTODY_TRANSFER', 1, 'CustodyTransferOffered',
          { sender_org_id: orgId, receiver_org_id: receiverOrg, lot_id: lot.id, quantity: dec(dto.quantity), unit: 'KG', movement_id: mid, returns_transfer_id: returns?.id ?? null, origin_projection_hash: hash }, 'custody.offer', { lot: lot.lot_code, quantity: dec(dto.quantity), receiver_org_id: receiverOrg }, requestId);
        await this.audit.record(trx, { organizationId: receiverOrg, actorUserId: user.id, action: 'custody.offer_received', entityType: 'custody_transfer', entityId: id, requestId, result: 'SUCCESS', after: { code, sender_org_id: orgId, quantity: dec(dto.quantity) } });
      });
    } catch (err) {
      const e = err as { constraint?: string };
      if (e.constraint === 'custody_transfers_offer_operation_uq' || e.constraint === 'stock_movements_operation_uq' || e.constraint === 'custody_transfer_steps_operation_uq') {
        const r = await this.db.selectFrom('custody_transfers').select('id').where('sender_org_id', '=', orgId).where('offer_operation_id', '=', dto.operation_id).executeTakeFirst();
        if (r) return { replayed: true, transfer: await this.view(this.db, orgId, r.id) };
      }
      this.ledgerError(err);
    }
    return { replayed: false, transfer: await this.view(this.db, orgId, id) };
  }

  async accept(user: AuthUser, orgId: string, id: string, dto: CustodyAcceptDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'transfer:accept', true);
    const done = await this.replay(orgId, dto.operation_id, id, ['ACCEPT']);
    if (done) return { replayed: true, transfer: await this.view(this.db, orgId, id) };
    await this.db.transaction().execute(async (trx) => {
      const { t } = await this.lockFor(trx, orgId, id, dto.expected_version, 'RECEIVER');
      if (t.status !== 'OFFERED') this.stateError(t, 'Solo se puede aceptar un traspaso ofrecido.');
      const prod = await trx.selectFrom('products').select(['id', 'status', 'unit']).where('organization_id', '=', orgId).where('id', '=', dto.product_id).executeTakeFirst();
      if (!prod) throw notFound('El producto no existe en tu organización.');
      if (prod.status !== 'ACTIVE' || prod.unit !== 'KG') throw new AppError(422, 'PRODUCT_NOT_ELIGIBLE', 'El producto debe estar activo y medirse en KG (la unidad del traspaso).', [{ field: 'product_id', reason: 'UNIT_MISMATCH_OR_INACTIVE' }]);
      const loc = await trx.selectFrom('locations').select(['id', 'status']).where('organization_id', '=', orgId).where('id', '=', dto.location_id).executeTakeFirst();
      if (!loc || loc.status !== 'ACTIVE') throw notFound('El centro no existe o no está activo en tu organización.');
      await this.step(trx, t, ctx, user.id, 'ACCEPT', dto.operation_id, { detail: { product_id: dto.product_id, location_id: dto.location_id } });
      const after = await this.bump(trx, id, { status: 'ACCEPTED', receiver_product_id: dto.product_id, receiver_location_id: dto.location_id });
      await this.record(trx, orgId, user.id, { type: 'custody_transfer', id, code: t.transfer_code }, 'CUSTODY_TRANSFER', Number(after.row_version), 'CustodyTransferAccepted', { status: 'ACCEPTED' }, 'custody.accept', { status: 'ACCEPTED' }, requestId);
    });
    return { replayed: false, transfer: await this.view(this.db, orgId, id) };
  }

  private async releaseReservation(trx: Transaction<Database>, t: Transfer, userId: string, reason: string) {
    await postMovement(trx, { organizationId: t.sender_org_id, type: 'CUSTODY_RESERVE_RELEASE', sourceType: 'custody_transfer', sourceId: t.id, operationId: null, actorId: userId, reason,
      reference: { transfer_id: t.id, lot_id: t.sender_lot_id }, lines: [{ lot_id: t.sender_lot_id, location_id: t.sender_location_id, bucket: 'RESERVED', quantity: `-${dec(t.quantity)}` }] });
    await trx.selectFrom('lots').select('id').where('id', '=', t.sender_lot_id).forUpdate().execute();
    await trx.updateTable('lots').set({ row_version: sql`row_version + 1` } as never).where('id', '=', t.sender_lot_id).execute();
  }
  private async closeOffer(user: AuthUser, orgId: string, id: string, dto: CustodyReasonDto, kind: 'REJECT' | 'CANCEL', requestId?: string) {
    const ctx = await this.ctx(user, orgId, kind === 'REJECT' ? 'transfer:accept' : 'transfer:offer', true);
    const done = await this.replay(orgId, dto.operation_id, id, [kind === 'REJECT' ? 'REJECT_OFFER' : 'CANCEL']);
    if (done) return { replayed: true, transfer: await this.view(this.db, orgId, id) };
    try {
      await this.db.transaction().execute(async (trx) => {
        const { t } = await this.lockFor(trx, orgId, id, dto.expected_version, kind === 'REJECT' ? 'RECEIVER' : 'SENDER');
        if (kind === 'REJECT') {
          if (t.status !== 'OFFERED') this.stateError(t, 'Solo se puede rechazar una oferta que aún no fue aceptada.');
        } else {
          if (t.status !== 'OFFERED' && t.status !== 'ACCEPTED') this.stateError(t, t.status === 'IN_TRANSIT' || t.status === 'WITH_DISCREPANCY' ? 'La mercancía ya salió: no se cancela. La receptora puede rechazarla en tránsito o recibirla.' : 'El traspaso ya no admite cancelación.');
        }
        await this.releaseReservation(trx, t, user.id, dto.reason.trim());
        await this.step(trx, t, ctx, user.id, kind === 'REJECT' ? 'REJECT_OFFER' : 'CANCEL', dto.operation_id, { reason: dto.reason });
        const status = kind === 'REJECT' ? 'REJECTED' : 'CANCELLED';
        const after = await this.bump(trx, id, { status, [kind === 'REJECT' ? 'reject_reason' : 'cancel_reason']: dto.reason.trim() });
        await this.record(trx, orgId, user.id, { type: 'custody_transfer', id, code: t.transfer_code }, 'CUSTODY_TRANSFER', Number(after.row_version), kind === 'REJECT' ? 'CustodyTransferRejected' : 'CustodyTransferCancelled',
          { status, reason: dto.reason.trim(), reservation_released: true }, kind === 'REJECT' ? 'custody.reject' : 'custody.cancel', { status, reason: dto.reason.trim() }, requestId);
      });
    } catch (err) { this.ledgerError(err); }
    return { replayed: false, transfer: await this.view(this.db, orgId, id) };
  }
  reject(user: AuthUser, orgId: string, id: string, dto: CustodyReasonDto, requestId?: string) { return this.closeOffer(user, orgId, id, dto, 'REJECT', requestId); }
  cancel(user: AuthUser, orgId: string, id: string, dto: CustodyReasonDto, requestId?: string) { return this.closeOffer(user, orgId, id, dto, 'CANCEL', requestId); }

  // ---------- Salida ----------

  async preflight(user: AuthUser, orgId: string, id: string) {
    await this.ctx(user, orgId, 'transfer:read', false);
    const t = await this.db.selectFrom('custody_transfers').selectAll().where('id', '=', id).executeTakeFirst();
    if (!t || t.sender_org_id !== orgId) throw notFound('El traspaso no existe para tu organización.');
    return this.checks(this.db, t);
  }
  private async checks(db: Db, t: Transfer) {
    const res = (await sql<{ reserved: string }>`SELECT coalesce(sum(e.signed_quantity), 0)::text AS reserved FROM stock_entries e JOIN stock_movements m ON m.id = e.movement_id
      WHERE m.source_id = ${t.id} AND m.movement_type IN ('CUSTODY_RESERVE','CUSTODY_RESERVE_RELEASE','CUSTODY_OUT') AND e.bucket = 'RESERVED'`.execute(db)).rows[0].reserved;
    const gate = await this.gate.evaluate({ transferId: t.id, senderOrgId: t.sender_org_id, receiverOrgId: t.receiver_org_id, lotId: t.sender_lot_id, quantity: dec(t.quantity) });
    const checks = [
      { code: 'STATUS', label: 'Traspaso aceptado por la receptora', status: t.status === 'ACCEPTED' ? 'OK' : 'BLOCKED', message: t.status === 'ACCEPTED' ? 'Aceptado.' : `Estado actual: ${STATUS_LABEL[t.status]}.` },
      { code: 'RESERVATION', label: 'Reserva completa en el centro de salida', status: scaled(res) === scaled(t.quantity) ? 'OK' : 'BLOCKED', message: scaled(res) === scaled(t.quantity) ? `Reservados ${dec(res)} kg.` : `Reservado ${dec(res)} de ${dec(t.quantity)} kg.` },
      { code: 'GATE', label: 'Compuerta de salida del traspaso (diligencia debida, D-34/D4)', status: gate.allowed ? 'OK' : 'BLOCKED', message: gate.message },
    ] as Array<{ code: string; label: string; status: 'OK' | 'BLOCKED'; message: string }>;
    return { allowed: checks.every((c) => c.status === 'OK'), checks, gate_code: gate.code };
  }

  async dispatch(user: AuthUser, orgId: string, id: string, dto: CustodyDispatchDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'transfer:dispatch', true);
    const done = await this.replay(orgId, dto.operation_id, id, ['DISPATCH']);
    if (done) return { replayed: true, transfer: await this.view(this.db, orgId, id) };
    try {
      await this.db.transaction().execute(async (trx) => {
        const { t } = await this.lockFor(trx, orgId, id, dto.expected_version, 'SENDER');
        if (t.status !== 'ACCEPTED') this.stateError(t, 'La salida solo se registra sobre un traspaso aceptado.');
        const pf = await this.checks(trx, t);
        if (!pf.allowed) throw new AppError(409, 'TRANSFER_DISPATCH_BLOCKED', 'La salida no cumple las condiciones: ' + pf.checks.filter((c) => c.status === 'BLOCKED').map((c) => c.message).join(' '), pf.checks.filter((c) => c.status === 'BLOCKED').map((c) => ({ field: c.code, reason: c.message })));
        await trx.selectFrom('lots').select('id').where('id', '=', t.sender_lot_id).forUpdate().executeTakeFirstOrThrow();
        const q = dec(t.quantity);
        const mid = await postMovement(trx, { organizationId: orgId, type: 'CUSTODY_OUT', sourceType: 'custody_transfer', sourceId: id, operationId: dto.operation_id, actorId: user.id, reference: { transfer_id: id, lot_id: t.sender_lot_id, receiver_org_id: t.receiver_org_id },
          lines: [{ lot_id: t.sender_lot_id, location_id: t.sender_location_id, bucket: 'RESERVED', quantity: `-${q}` }, { lot_id: t.sender_lot_id, location_id: t.sender_location_id, bucket: 'PHYSICAL', quantity: `-${q}` }] });
        await this.step(trx, t, ctx, user.id, 'DISPATCH', dto.operation_id, { quantity: q, movementId: mid });
        await trx.updateTable('lots').set({ row_version: sql`row_version + 1` } as never).where('id', '=', t.sender_lot_id).execute();
        await this.applySettle(trx, ctx, user.id, t, 'CustodyTransferDispatched', 'custody.dispatch', { quantity: q, movement_id: mid }, requestId);
      });
    } catch (err) { this.ledgerError(err); }
    return { replayed: false, transfer: await this.view(this.db, orgId, id) };
  }

  // ---------- Tránsito, recepción y diferencias ----------

  private requireInTransit(t: Transfer) {
    if (t.status !== 'IN_TRANSIT' && t.status !== 'WITH_DISCREPANCY') this.stateError(t, t.status === 'CLOSED' ? 'El traspaso ya está cerrado.' : 'Solo se recibe lo que ya salió: el traspaso aún no está en tránsito.');
  }

  async receive(user: AuthUser, orgId: string, id: string, dto: CustodyReceiveDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'transfer:receive', true);
    const done = await this.replay(orgId, dto.operation_id, id, ['RECEIPT', 'OVERAGE_RECORDED']);
    if (done) return { replayed: true, transfer: await this.view(this.db, orgId, id) };
    const arrived = scaled(dto.quantity);
    if (arrived <= 0n) throw new AppError(422, 'VALIDATION_FAILED', 'La cantidad recibida debe ser mayor que cero.', [{ field: 'quantity', reason: 'MUST_BE_POSITIVE' }]);
    try {
      await this.db.transaction().execute(async (trx) => {
        const { t } = await this.lockFor(trx, orgId, id, dto.expected_version, 'RECEIVER');
        this.requireInTransit(t);
        const tot = await this.totals(trx, id);
        const transit = tot._transit;
        const accepted = arrived < transit ? arrived : transit;
        const excess = arrived - accepted;
        if (excess > 0n && !dto.reason?.trim()) throw new AppError(422, 'REASON_REQUIRED', `Llegó más de lo que estaba en tránsito (${tot.in_transit} kg): toda diferencia exige un motivo.`, [{ field: 'reason', reason: 'REQUIRED_ON_DIFFERENCE' }]);
        const payload: Record<string, unknown> = {};
        if (accepted > 0n) {
          const r = await this.receiveIntoLedger(trx, t, ctx, user.id, 'RECEIPT', dto.operation_id, unscaled(accepted), requestId);
          Object.assign(payload, { received: unscaled(accepted), receiver_lot_id: r.lotId, movement_id: r.movementId });
        }
        if (excess > 0n) {
          // Sobrante: NO crea existencias. Queda como diferencia abierta hasta que la emisora lo confirme o se retire (D5a).
          const opId = accepted > 0n ? subDerived(dto.operation_id, 'OVERAGE') : dto.operation_id;
          await this.step(trx, t, ctx, user.id, 'OVERAGE_RECORDED', opId, { quantity: unscaled(excess), reason: dto.reason });
          await trx.insertInto('custody_discrepancies').values({ id: randomUUID(), transfer_id: id, kind: 'OVERAGE', quantity: unscaled(excess), status: 'OPEN', resolution: null, reason: dto.reason!.trim(), recorded_by_org: orgId, recorded_by: user.id } as never).execute();
          Object.assign(payload, { overage_recorded: unscaled(excess) });
        }
        await this.applySettle(trx, ctx, user.id, t, 'CustodyTransferReceived', 'custody.receive', payload, requestId);
      });
    } catch (err) { this.ledgerError(err); }
    return { replayed: false, transfer: await this.view(this.db, orgId, id) };
  }

  async declareShortage(user: AuthUser, orgId: string, id: string, dto: CustodyQuantityReasonDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'transfer:receive', true);
    const done = await this.replay(orgId, dto.operation_id, id, ['DECLARE_SHORTAGE']);
    if (done) return { replayed: true, transfer: await this.view(this.db, orgId, id) };
    const q = scaled(dto.quantity);
    try {
      await this.db.transaction().execute(async (trx) => {
        const { t } = await this.lockFor(trx, orgId, id, dto.expected_version, 'RECEIVER');
        this.requireInTransit(t);
        const tot = await this.totals(trx, id);
        const free = tot._transit - scaled(tot.open_shortage);
        if (q <= 0n || q > free) throw new AppError(409, 'TRANSIT_EXCEEDED', `Se puede declarar faltante hasta ${unscaled(free > 0n ? free : 0n)} kg (lo que sigue en tránsito sin diferencia abierta).`, [{ field: 'quantity', reason: 'TRANSIT_QUANTITY_EXCEEDED' }]);
        await this.step(trx, t, ctx, user.id, 'DECLARE_SHORTAGE', dto.operation_id, { quantity: unscaled(q), reason: dto.reason });
        await trx.insertInto('custody_discrepancies').values({ id: randomUUID(), transfer_id: id, kind: 'SHORTAGE', quantity: unscaled(q), status: 'OPEN', resolution: null, reason: dto.reason.trim(), recorded_by_org: orgId, recorded_by: user.id } as never).execute();
        await this.applySettle(trx, ctx, user.id, t, 'CustodyShortageDeclared', 'custody.declare_shortage', { shortage: unscaled(q), reason: dto.reason.trim() }, requestId);
      });
    } catch (err) { this.ledgerError(err); }
    return { replayed: false, transfer: await this.view(this.db, orgId, id) };
  }

  /** Rechazo EN TRÁNSITO: lo rechazado vuelve al lote y centro de origen del emisor (procedencia conservada), con movimiento CUSTODY_RETURN en su libro. */
  async rejectInTransit(user: AuthUser, orgId: string, id: string, dto: CustodyQuantityReasonDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'transfer:receive', true);
    const done = await this.replay(orgId, dto.operation_id, id, ['REJECT_TRANSIT']);
    if (done) return { replayed: true, transfer: await this.view(this.db, orgId, id) };
    const q = scaled(dto.quantity);
    try {
      await this.db.transaction().execute(async (trx) => {
        const { t } = await this.lockFor(trx, orgId, id, dto.expected_version, 'RECEIVER');
        this.requireInTransit(t);
        const tot = await this.totals(trx, id);
        const free = tot._transit - scaled(tot.open_shortage);
        if (q <= 0n || q > free) throw new AppError(409, 'TRANSIT_EXCEEDED', `Se puede rechazar hasta ${unscaled(free > 0n ? free : 0n)} kg (lo que sigue en tránsito sin diferencia abierta).`, [{ field: 'quantity', reason: 'TRANSIT_QUANTITY_EXCEEDED' }]);
        await trx.selectFrom('lots').select('id').where('id', '=', t.sender_lot_id).forUpdate().executeTakeFirstOrThrow();
        const sid = randomUUID();
        const mid = await postMovement(trx, { organizationId: t.sender_org_id, type: 'CUSTODY_RETURN', sourceType: 'custody_transfer_step', sourceId: sid, operationId: null, actorId: user.id, reason: dto.reason.trim(),
          reference: { transfer_id: id, lot_id: t.sender_lot_id, rejected_by_org: orgId }, lines: [{ lot_id: t.sender_lot_id, location_id: t.sender_location_id, bucket: 'PHYSICAL', quantity: unscaled(q) }] });
        // El paso es de la receptora; su movimiento vive en el libro de la emisora, por eso no lo referencia (la FK compuesta es por organización del actor).
        await this.step(trx, t, ctx, user.id, 'REJECT_TRANSIT', dto.operation_id, { id: sid, quantity: unscaled(q), reason: dto.reason, detail: { returned_to_sender_movement_id: mid, sender_lot_id: t.sender_lot_id, sender_location_id: t.sender_location_id } });
        await trx.updateTable('lots').set({ row_version: sql`row_version + 1` } as never).where('id', '=', t.sender_lot_id).execute();
        await this.applySettle(trx, ctx, user.id, t, 'CustodyTransitRejected', 'custody.reject_transit', { rejected: unscaled(q), reason: dto.reason.trim(), returned_to_sender_movement_id: mid }, requestId);
      });
    } catch (err) { this.ledgerError(err); }
    return { replayed: false, transfer: await this.view(this.db, orgId, id) };
  }

  async resolve(user: AuthUser, orgId: string, id: string, discrepancyId: string, dto: CustodyResolveDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'transfer:resolve', true);
    const done = await this.replay(orgId, dto.operation_id, id, ['LOSS_CONFIRMED', 'OVERAGE_CONFIRMED', 'OVERAGE_WITHDRAWN', 'SHORTAGE_REOPENED']);
    if (done) return { replayed: true, transfer: await this.view(this.db, orgId, id) };
    try {
      await this.db.transaction().execute(async (trx) => {
        const { t, party } = await this.lockFor(trx, orgId, id, dto.expected_version);
        const d = await trx.selectFrom('custody_discrepancies').selectAll().where('id', '=', discrepancyId).where('transfer_id', '=', id).forUpdate().executeTakeFirst();
        if (!d) throw notFound('La diferencia no existe en este traspaso.');
        if (d.status !== 'OPEN') throw conflict('DISCREPANCY_RESOLVED', 'Esa diferencia ya está resuelta.');
        const okKinds = d.kind === 'SHORTAGE' ? ['LOSS_CONFIRMED', 'SHORTAGE_REOPENED'] : ['OVERAGE_CONFIRMED', 'OVERAGE_WITHDRAWN'];
        if (!okKinds.includes(dto.resolution)) throw new AppError(422, 'RESOLUTION_NOT_APPLICABLE', 'Esa resolución no corresponde al tipo de diferencia.', [{ field: 'resolution', reason: 'KIND_MISMATCH' }]);
        // Confirmar una pérdida o un sobrante lo hace la CONTRAPARTE de quien lo declaró: nadie se confirma a sí mismo (D5a).
        if ((dto.resolution === 'LOSS_CONFIRMED' || dto.resolution === 'OVERAGE_CONFIRMED') && d.recorded_by_org === orgId) throw forbidden('CANNOT_SELF_CONFIRM', 'La confirmación la hace la otra organización, no quien declaró la diferencia.');
        if (dto.resolution === 'OVERAGE_CONFIRMED' && party !== 'SENDER') throw forbidden('WRONG_SIDE', 'Un sobrante lo confirma la organización emisora.');
        const q = unscaled(scaled(d.quantity));
        const payload: Record<string, unknown> = { discrepancy_id: d.id, resolution: dto.resolution, quantity: q };
        if (dto.resolution === 'OVERAGE_CONFIRMED') {
          const r = await this.receiveIntoLedger(trx, t, ctx, user.id, 'OVERAGE_CONFIRMED', dto.operation_id, q, requestId, dto.reason.trim());
          Object.assign(payload, { receiver_lot_id: r.lotId });
        } else {
          await this.step(trx, t, ctx, user.id, dto.resolution as CustodyStep, dto.operation_id, { quantity: q, reason: dto.reason });
        }
        await trx.updateTable('custody_discrepancies').set({ status: 'RESOLVED', resolution: dto.resolution, resolved_by_org: orgId, resolved_by: user.id, resolved_at: sql`now()`, resolution_reason: dto.reason.trim() } as never).where('id', '=', d.id).execute();
        await this.applySettle(trx, ctx, user.id, t, 'CustodyDiscrepancyResolved', 'custody.resolve', { ...payload, reason: dto.reason.trim() }, requestId);
      });
    } catch (err) { this.ledgerError(err); }
    return { replayed: false, transfer: await this.view(this.db, orgId, id) };
  }

  /** Linaje entre lotes de ambas organizaciones, visible por el lado que consulta. */
  async lineage(user: AuthUser, orgId: string, lotId: string) {
    const ctx = await this.ctx(user, orgId, 'transfer:read', false);
    const org = ctx.organizationId;
    const rows = (await sql<{ transfer_id: string; transfer_code: string; direction: string; quantity: string; at: string; counterpart_name: string; this_lot_code: string }>`
      SELECT k.transfer_id, t.transfer_code, CASE WHEN k.child_org_id = ${org} THEN 'RECEIVED_FROM' ELSE 'SENT_TO' END AS direction, k.quantity::text AS quantity, k.created_at AS at,
             CASE WHEN k.child_org_id = ${org} THEN po.name ELSE co.name END AS counterpart_name, tl.lot_code AS this_lot_code
      FROM custody_lot_links k JOIN custody_transfers t ON t.id = k.transfer_id JOIN organizations po ON po.id = k.parent_org_id JOIN organizations co ON co.id = k.child_org_id
      JOIN lots tl ON tl.id = ${lotId} AND tl.organization_id = ${org}
      WHERE (k.child_org_id = ${org} AND k.child_lot_id = ${lotId}) OR (k.parent_org_id = ${org} AND k.parent_lot_id = ${lotId}) ORDER BY k.created_at`.execute(this.db)).rows;
    return { lot_id: lotId, links: rows.map((r) => ({ transfer_id: r.transfer_id, transfer_code: r.transfer_code, direction: r.direction, quantity: dec(r.quantity), at: r.at, counterpart_name: r.counterpart_name })), note: 'Muestra el traspaso y la organización; nunca el inventario ni el lote de la otra parte.' };
  }
}

@ApiTags('custody-transfers')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class CustodyTransfersController {
  constructor(private readonly service: CustodyTransfersService) {}

  @Get('partnerships') partnerships(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.listPartnerships(u, o); }
  @Post('partnerships') invite(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: PartnershipInviteDto, @Req() req: AuthedRequest) { return this.service.invite(u, o, dto, req.requestId); }
  @Post('partnerships/confirm') @HttpCode(200) confirm(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: PartnershipConfirmDto, @Req() req: AuthedRequest) { return this.service.confirm(u, o, dto, req.requestId); }
  @Post('partnerships/:id/revoke') @HttpCode(200) revoke(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PartnershipRevokeDto, @Req() req: AuthedRequest) { return this.service.revoke(u, o, id, dto, req.requestId); }

  @Get('custody-transfers/options') options(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.options(u, o); }
  @Get('custody-transfers') list(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.list(u, o); }
  @Post('custody-transfers') offer(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: CustodyOfferDto, @Req() req: AuthedRequest) { return this.service.offer(u, o, dto, req.requestId); }
  @Get('custody-transfers/lineage/:lotId') lineage(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('lotId', ParseUUIDPipe) lot: string) { return this.service.lineage(u, o, lot); }
  @Get('custody-transfers/:id') detail(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(u, o, id); }
  @Get('custody-transfers/:id/preflight') preflight(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.preflight(u, o, id); }
  @Post('custody-transfers/:id/accept') @HttpCode(200) accept(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustodyAcceptDto, @Req() req: AuthedRequest) { return this.service.accept(u, o, id, dto, req.requestId); }
  @Post('custody-transfers/:id/reject') @HttpCode(200) reject(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustodyReasonDto, @Req() req: AuthedRequest) { return this.service.reject(u, o, id, dto, req.requestId); }
  @Post('custody-transfers/:id/cancel') @HttpCode(200) cancel(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustodyReasonDto, @Req() req: AuthedRequest) { return this.service.cancel(u, o, id, dto, req.requestId); }
  @Post('custody-transfers/:id/dispatch') @HttpCode(200) dispatch(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustodyDispatchDto, @Req() req: AuthedRequest) { return this.service.dispatch(u, o, id, dto, req.requestId); }
  @Post('custody-transfers/:id/receive') @HttpCode(200) receive(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustodyReceiveDto, @Req() req: AuthedRequest) { return this.service.receive(u, o, id, dto, req.requestId); }
  @Post('custody-transfers/:id/shortage') @HttpCode(200) shortage(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustodyQuantityReasonDto, @Req() req: AuthedRequest) { return this.service.declareShortage(u, o, id, dto, req.requestId); }
  @Post('custody-transfers/:id/reject-in-transit') @HttpCode(200) rejectInTransit(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustodyQuantityReasonDto, @Req() req: AuthedRequest) { return this.service.rejectInTransit(u, o, id, dto, req.requestId); }
  @Post('custody-transfers/:id/discrepancies/:discrepancyId/resolve') @HttpCode(200) resolve(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Param('discrepancyId', ParseUUIDPipe) did: string, @Body() dto: CustodyResolveDto, @Req() req: AuthedRequest) { return this.service.resolve(u, o, id, did, dto, req.requestId); }
}
