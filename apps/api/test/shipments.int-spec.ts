import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { ShipmentsService } from '../src/shipments/shipments';

// Integración P0-029 Movimientos y embarque con PostgreSQL real. Datos SINTÉTICOS.
// Reservas en el ledger (única fuente de saldo), preflight sin atajos y despacho idempotente.
// El despacho REAL está bloqueado (calidad/expediente pendientes y compuerta SHIPMENT_DISPATCH por D-34). La mecánica de
// consumo se prueba aparte con un preflight SINTÉTICO (spy): eso no demuestra que un embarque pueda despacharse hoy.
describeDb('P0-029 embarques: reservas en el ledger, preflight y despacho', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let producer: string;
  let plot: string;
  let baba: string;
  let c1: string;
  let c2: string;
  let buyer: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local';
  const EXP = 'export@test.local';

  async function join(o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(ADMIN)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  /** Lote de origen declarado con `q` kg en el centro dado (recepción → lote). */
  async function lot(q: string, location = c1) {
    const d = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: q, unit: 'KG', origins: [{ plot_id: plot }], register: true }).expect(201)).body.delivery;
    const r = (await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: location, received_at: new Date().toISOString(), weighing: { method: 'Báscula', quantity: q, unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    return (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r, quantity: q }] }).expect(201)).body.lot.id as string;
  }
  const shipment = async (location = c1, actor = EXP) => (await http().post(`${base(orgA)}/shipments`).set(as(actor)).send({ operation_id: randomUUID(), buyer_id: buyer, destination_country: 'NL', destination_place: 'Rotterdam', origin_location_id: location }).expect(201)).body.shipment;
  const view = async (id: string, actor = EXP) => (await http().get(`${base(orgA)}/shipments/${id}`).set(as(actor)).expect(200)).body;
  const item = async (id: string, lotId: string, q: string) => {
    const s = await view(id);
    return (await http().post(`${base(orgA)}/shipments/${id}/items`).set(as(EXP)).send({ expected_version: s.row_version, lot_id: lotId, quantity: q }).expect(201)).body.shipment.items.find((i: { lot_id: string }) => i.lot_id === lotId);
  };
  const reserve = (id: string, itemId: string, op = randomUUID()) => http().post(`${base(orgA)}/shipments/${id}/reserve`).set(as(EXP)).send({ operation_id: op, item_id: itemId });
  const qty = async (lotId: string) => (await http().get(`${base(orgA)}/lots/${lotId}`).set(as(ADMIN)).expect(200)).body.quantities as { physical: string; reserved: string; available: string; dispatched: string };
  const reconcile = async () => (await http().get(`${base(orgA)}/inventory/reconciliation`).set(as(ADMIN)).expect(200)).body;

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Embarques A', ADMIN);
    orgB = await mk('Coop Embarques B', 'admin-b@test.local');
    for (const [e, r] of [[EXP, 'EXPORT_MANAGER'], ['auditor@test.local', 'AUDITOR'], ['recepcion@test.local', 'RECEPTION_OPERATOR'], ['traz@test.local', 'TRACEABILITY_MANAGER']]) await join(orgA, e, r);
    producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'EM-1', legal_name: 'Finca Embarque' }).expect(201)).body.id;
    plot = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: 'EM-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    c1 = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'C1', name: 'Centro uno', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    c2 = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'C2', name: 'Bodega dos', location_type: 'WAREHOUSE' }).expect(201)).body.id;
    buyer = (await http().post(`${base(orgA)}/buyers`).set(as(EXP)).send({ operation_id: randomUUID(), code: 'IMP-NL-01', name: 'Importador Sintético', country: 'NL' }).expect(201)).body.buyer.id;
  });
  afterAll(async () => h?.close());
  afterEach(() => jest.restoreAllMocks());

  it('autorización: exportación gestiona; auditor y trazabilidad solo leen; recepción sin acceso; otra organización 404; referencias ajenas rechazadas', async () => {
    const s = await shipment();
    expect(s).toMatchObject({ status: 'DRAFT', buyer: { code: 'IMP-NL-01', verification: 'DECLARED' }, destination: { country: 'NL', verification: 'DECLARED' }, submission: { status: 'NOT_SUBMITTED' }, actions: { manage: true, reserve: true, dispatch: true } });
    expect((await view(s.id, 'auditor@test.local')).actions).toEqual({ manage: false, reserve: false, dispatch: false });
    await http().get(`${base(orgA)}/shipments/${s.id}`).set(as('traz@test.local')).expect(200);
    await http().post(`${base(orgA)}/shipments`).set(as('auditor@test.local')).send({ operation_id: randomUUID(), buyer_id: buyer, destination_country: 'NL', origin_location_id: c1 }).expect(403);
    await http().post(`${base(orgA)}/buyers`).set(as('auditor@test.local')).send({ operation_id: randomUUID(), code: 'X-1', name: 'Otro', country: 'DE' }).expect(403);
    await http().get(`${base(orgA)}/shipments`).set(as('recepcion@test.local')).expect(403);
    const l = await lot('50');
    const it = await item(s.id, l, '10');
    await reserve(s.id, it.id).set(as('auditor@test.local')).expect(403);
    await http().post(`${base(orgA)}/shipments/${s.id}/dispatch`).set(as('auditor@test.local')).send({ operation_id: randomUUID(), expected_version: 1 }).expect(403);
    // Otra organización: el embarque no existe para ella (404 sin datos); su lote y su centro no son referencias válidas aquí.
    await http().get(`${base(orgA)}/shipments/${s.id}`).set(as('admin-b@test.local')).expect(404);
    await http().get(`${base(orgB)}/shipments/${s.id}`).set(as('admin-b@test.local')).expect(404);
    const cB = (await http().post(`${base(orgB)}/locations`).set(as('admin-b@test.local')).send({ code: 'CB', name: 'Centro B', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    await http().post(`${base(orgA)}/shipments`).set(as(EXP)).send({ operation_id: randomUUID(), buyer_id: buyer, destination_country: 'NL', origin_location_id: cB }).expect(422);
    const buyerB = (await http().post(`${base(orgB)}/buyers`).set(as('admin-b@test.local')).send({ operation_id: randomUUID(), code: 'IMP-NL-01', name: 'Mismo código, otra organización', country: 'NL' }).expect(201)).body.buyer.id;
    await http().post(`${base(orgA)}/shipments`).set(as(EXP)).send({ operation_id: randomUUID(), buyer_id: buyerB, destination_country: 'NL', origin_location_id: c1 }).expect(422);
    const sB = (await http().post(`${base(orgB)}/shipments`).set(as('admin-b@test.local')).send({ operation_id: randomUUID(), buyer_id: buyerB, destination_country: 'NL', origin_location_id: cB }).expect(201)).body.shipment;
    await http().post(`${base(orgB)}/shipments/${sB.id}/items`).set(as('admin-b@test.local')).send({ expected_version: sB.row_version, lot_id: l, quantity: '1' }).expect(422);
  });

  it('reserva en el ledger: reduce el disponible sin tocar la existencia; idempotente; exceso rechazado; liberar la devuelve; conciliación consistente', async () => {
    const l = await lot('100');
    const s = await shipment();
    const it = await item(s.id, l, '70');
    const op = randomUUID();
    const r1 = (await reserve(s.id, it.id, op).expect(201)).body;
    const r2 = (await reserve(s.id, it.id, op).expect(201)).body;
    expect(r2).toMatchObject({ replayed: true, reservation_id: r1.reservation_id });
    expect(await qty(l)).toMatchObject({ physical: '100', reserved: '70', available: '30' });
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM stock_movements WHERE movement_type = 'SHIPMENT_RESERVE' AND reference->>'item_id' = ${it.id}`.execute(h.db)).rows[0].n).toBe(1);
    await reserve(s.id, it.id).expect(409); // ya reservado
    // Otro embarque no puede reservar más que el disponible restante.
    const s2 = await shipment();
    const it2 = await item(s2.id, l, '40');
    expect((await reserve(s2.id, it2.id).expect(409)).body.error.code).toBe('INSUFFICIENT_AVAILABLE');
    // Un centro sin existencia del lote no tiene disponible: reservar exige trasladar antes.
    const s3 = await shipment(c2);
    const it3 = await item(s3.id, l, '10');
    expect((await reserve(s3.id, it3.id).expect(409)).body.error.message).toMatch(/Traslada existencia/);
    // Con reserva activa no se libera la asignación de la recepción (no se pierde el respaldo físico de la reserva).
    const detail = (await http().get(`${base(orgA)}/lots/${l}`).set(as(ADMIN)).expect(200)).body;
    await http().post(`${base(orgA)}/lots/${l}/inputs/${detail.inputs[0].id}/release`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Prueba con reserva activa' }).expect(409);
    expect((await reconcile()).consistent).toBe(true);
    const rid = (await view(s.id)).items[0].reservation.id;
    await http().post(`${base(orgA)}/shipments/${s.id}/reservations/${rid}/release`).set(as(EXP)).send({ operation_id: randomUUID(), reason: 'Cambio de programa' }).expect(200);
    expect(await qty(l)).toMatchObject({ physical: '100', reserved: '0', available: '100' });
    expect((await view(s.id)).items[0]).toMatchObject({ reservation: null, history: [expect.objectContaining({ status: 'RELEASED', reason: 'Cambio de programa' })] });
    await reserve(s2.id, it2.id).expect(201);
    expect((await reconcile()).consistent).toBe(true);
  });

  it('concurrencia: dos reservas simultáneas que juntas superan el disponible → exactamente una; nunca saldo negativo', async () => {
    const l = await lot('100');
    const [a, b] = [await shipment(), await shipment()];
    const [ia, ib] = [await item(a.id, l, '60'), await item(b.id, l, '60')];
    const res = await Promise.all([reserve(a.id, ia.id), reserve(b.id, ib.id)]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await qty(l)).toMatchObject({ physical: '100', reserved: '60', available: '40' });
    expect((await reconcile()).consistent).toBe(true);
  });

  it('preflight real: calidad pendiente y sin acreditación de diligencia (D-34.A) → despacho rechazado sin tocar el ledger', async () => {
    const l = await lot('80');
    const s = await shipment();
    const it = await item(s.id, l, '80');
    await reserve(s.id, it.id).expect(201);
    const p = (await http().get(`${base(orgA)}/shipments/${s.id}/preflight`).set(as(EXP)).expect(200)).body;
    const st = (code: string) => p.checks.find((c: { code: string }) => c.code === code)?.status;
    expect(p.allowed).toBe(false);
    expect({ items: st('ITEMS'), reservation: st('RESERVATION'), origin: st('ORIGIN') }).toEqual({ items: 'OK', reservation: 'OK', origin: 'OK' });
    expect({ quality: st('QUALITY'), dd: st('DD_PACKAGE'), evidence: st('EVIDENCE'), gate: st('GATE') }).toEqual({ quality: 'BLOCKED', dd: 'BLOCKED', evidence: 'BLOCKED', gate: 'BLOCKED' });
    // D-34.A (2026-10-16): la compuerta ya NO bloquea por «decisión pendiente». La condición está escrita, así
    // que bloquea por el motivo real: falta la acreditación por ítem. `SHIPMENT_PACKAGE` quedó retirada y
    // `SHIPMENT_DISPATCH_AT` deja de bloquear porque el sello lo pone el servidor en la transacción.
    expect(p.gate.blocking.map((b: { code: string }) => b.code).sort()).toEqual(['SHIPMENT_ITEM_PACKAGES']);
    expect(p.gate.blocking.every((b: { result: string }) => b.result === 'REQUIRED_MISSING')).toBe(true);
    const before = await qty(l);
    const d = await http().post(`${base(orgA)}/shipments/${s.id}/dispatch`).set(as(EXP)).send({ operation_id: randomUUID(), expected_version: (await view(s.id)).row_version }).expect(409);
    expect(d.body.error.code).toBe('DISPATCH_BLOCKED');
    expect(await qty(l)).toEqual(before);
    expect((await view(s.id)).status).toBe('DRAFT');
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM stock_movements WHERE movement_type = 'SHIPMENT_DISPATCH' AND reference->>'shipment_id' = ${s.id}`.execute(h.db)).rows[0].n).toBe(0);
  });

  it('mecánica de despacho con preflight SINTÉTICO: consume una sola vez, idempotente, definitivo, destino en el Lot Hub y conciliación', async () => {
    jest.spyOn(ShipmentsService.prototype, 'preflightChecks').mockImplementation(async () => ({ allowed: true, checks: [], packages: [],
      gate: { transition: 'SHIPMENT_DISPATCH', release: 'SINTETICO', allowed: true, blocking: [], pending: [], not_evaluated: [], evaluated_at: new Date().toISOString() } }));
    const l = await lot('90');
    const s = await shipment();
    const it = await item(s.id, l, '90');
    await reserve(s.id, it.id).expect(201);
    // Sin todas las reservas tampoco se despacha: la reserva es la que se consume (no se debita existencia libre).
    const op = randomUUID();
    const v = (await view(s.id)).row_version;
    const [d1, d2] = await Promise.all([
      http().post(`${base(orgA)}/shipments/${s.id}/dispatch`).set(as(EXP)).send({ operation_id: op, expected_version: v }),
      http().post(`${base(orgA)}/shipments/${s.id}/dispatch`).set(as(EXP)).send({ operation_id: op, expected_version: v }),
    ]);
    expect([d1.status, d2.status]).toEqual([200, 200]);
    expect([d1.body.replayed, d2.body.replayed].sort()).toEqual([false, true]);
    expect(await qty(l)).toMatchObject({ physical: '0', reserved: '0', available: '0', dispatched: '90' });
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM stock_movements WHERE movement_type = 'SHIPMENT_DISPATCH' AND reference->>'shipment_id' = ${s.id}`.execute(h.db)).rows[0].n).toBe(1);
    const after = await view(s.id);
    expect(after).toMatchObject({ status: 'DISPATCHED', items: [{ reservation: { status: 'CONSUMED' } }], actions: { manage: false, reserve: false, dispatch: false }, submission: { status: 'NOT_SUBMITTED' } });
    // Otro identificador: el embarque ya es definitivo (sin segundo débito).
    expect((await http().post(`${base(orgA)}/shipments/${s.id}/dispatch`).set(as(EXP)).send({ operation_id: randomUUID(), expected_version: after.row_version }).expect(409)).body.error.code).toBe('SHIPMENT_NOT_DRAFT');
    await http().post(`${base(orgA)}/shipments/${s.id}/cancel`).set(as(EXP)).send({ operation_id: randomUUID(), expected_version: after.row_version, reason: 'Intento tardío' }).expect(409);
    const ev = (await sql<{ event_type: string }>`SELECT event_type FROM domain_events WHERE aggregate_type = 'SHIPMENT' AND aggregate_id = ${s.id} ORDER BY aggregate_version`.execute(h.db)).rows.map((e) => e.event_type);
    expect(ev).toEqual(['ShipmentCreated', 'ShipmentItemAdded', 'ShipmentLotReserved', 'ShipmentDispatched']);
    const hub = (await http().get(`${base(orgA)}/lots/${l}`).set(as(EXP)).expect(200)).body;
    expect(hub.shipments).toEqual([expect.objectContaining({ shipment_code: after.shipment_code, status: 'DISPATCHED', effect: 'DISPATCHED', quantity: { value: '90', unit: 'KG' } })]);
    expect((await http().get(`${base(orgA)}/lots/${l}`).set(as('recepcion@test.local')).expect(200)).body.shipments).toBeNull();
    expect((await reconcile()).consistent).toBe(true);
  });

  it('cancelar libera todas las reservas activas y deja el embarque definitivo; versión obsoleta → 409', async () => {
    const l = await lot('40');
    const s = await shipment();
    const it = await item(s.id, l, '25');
    await reserve(s.id, it.id).expect(201);
    await http().post(`${base(orgA)}/shipments/${s.id}/cancel`).set(as(EXP)).send({ operation_id: randomUUID(), expected_version: 1, reason: 'Versión vieja' }).expect(409);
    const v = (await view(s.id)).row_version;
    const c = (await http().post(`${base(orgA)}/shipments/${s.id}/cancel`).set(as(EXP)).send({ operation_id: randomUUID(), expected_version: v, reason: 'Comprador desistió' }).expect(200)).body.shipment;
    expect(c).toMatchObject({ status: 'CANCELLED', cancel_reason: 'Comprador desistió', items: [{ reservation: null }] });
    expect(await qty(l)).toMatchObject({ physical: '40', reserved: '0', available: '40' });
    await reserve(s.id, it.id).expect(409);
    expect((await reconcile()).consistent).toBe(true);
  });
});
