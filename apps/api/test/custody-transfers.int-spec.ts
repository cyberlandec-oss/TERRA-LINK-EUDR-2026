import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { TRANSFER_DISPATCH_GATE } from '../src/custody/custody-transfers';

// Integración A-03 (RF-50) — traspaso de custodia física entre organizaciones, con PostgreSQL real. Datos SINTÉTICOS.
// La compuerta de salida real BLOQUEA (D4 no adoptada, D-34 sin resolver): las pruebas que necesitan una salida la sustituyen SOLO
// con `jest.spyOn` sobre el proveedor, y no demuestran que hoy pueda haber una salida real.
describeDb('A-03 traspaso de custodia entre organizaciones', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string; let orgB: string; let orgC: string;
  let producer: string; let plot: string; let baba: string; let c1: string; let c2: string;
  let prodB: string; let locB: string; let pid: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const A = 'admin-a@test.local'; const B = 'admin-b@test.local'; const C = 'admin-c@test.local';
  const BREC = 'recepcion-b@test.local'; const AAUD = 'auditor-a@test.local'; const ATRZ = 'traz-a@test.local';

  async function join(o: string, admin: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  /** Lote de origen declarado con `q` kg en el centro c1 de la organización A (recepción → lote). */
  async function lot(q: string, location = c1) {
    const d = (await http().post(`${base(orgA)}/deliveries`).set(as(A)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: q, unit: 'KG', origins: [{ plot_id: plot }], register: true }).expect(201)).body.delivery;
    const r = (await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as(A)).send({ operation_id: randomUUID(), location_id: location, received_at: new Date().toISOString(), weighing: { method: 'Báscula', quantity: q, unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    return (await http().post(`${base(orgA)}/lots`).set(as(A)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r, quantity: q }] }).expect(201)).body.lot.id as string;
  }
  const qty = async (org: string, who: string, lotId: string) => (await http().get(`${base(org)}/lots/${lotId}`).set(as(who)).expect(200)).body.quantities as { physical: string; reserved: string; available: string };
  const reconcile = async (org: string, who: string) => (await http().get(`${base(org)}/inventory/reconciliation`).set(as(who)).expect(200)).body;
  const view = async (org: string, who: string, id: string) => (await http().get(`${base(org)}/custody-transfers/${id}`).set(as(who)).expect(200)).body;
  const offerBody = (lotId: string, q: string, extra: Record<string, unknown> = {}) => ({ operation_id: randomUUID(), partnership_id: pid, lot_id: lotId, location_id: c1, quantity: q, ...extra });
  const offer = (lotId: string, q: string, extra: Record<string, unknown> = {}, who = A, org = orgA) => http().post(`${base(org)}/custody-transfers`).set(as(who)).send(offerBody(lotId, q, extra));
  /** Acción sobre un traspaso con la versión actual (a menos que se indique) y una operación nueva (a menos que se indique). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Res = { status: number; body: any };
  function act(org: string, who: string, id: string, path: string, body: Record<string, unknown> = {}, version?: number): Promise<Res> & { expect: (status: number) => Promise<Res> } {
    const p: Promise<Res> = (async () => {
      const v = version ?? (await view(org, who, id)).version;
      return http().post(`${base(org)}/custody-transfers/${id}/${path}`).set(as(who)).send({ operation_id: randomUUID(), expected_version: v, ...body });
    })();
    return Object.assign(p, { expect: async (status: number) => { const r = await p; if (r.status !== status) throw new Error(`${path}: se esperaba ${status} y llegó ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`); return r; } });
  }
  const accept = (id: string, who = B, extra: Record<string, unknown> = {}) => act(orgB, who, id, 'accept', { product_id: prodB, location_id: locB, ...extra });
  const allowGate = () => jest.spyOn(h.app.get(TRANSFER_DISPATCH_GATE), 'evaluate').mockResolvedValue({ allowed: true, code: 'TEST_ONLY', message: 'Compuerta sustituida SOLO en la prueba.' });
  const dispatch = (id: string, body: Record<string, unknown> = {}) => act(orgA, A, id, 'dispatch', body);
  const movements = async (org: string, type: string, transferId: string) => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM stock_movements WHERE organization_id = ${org} AND movement_type = ${type} AND reference->>'transfer_id' = ${transferId}`.execute(h.db)).rows[0].n;
  const receiverLot = async (id: string) => (await sql<{ receiver_lot_id: string }>`SELECT receiver_lot_id FROM custody_transfers WHERE id = ${id}`.execute(h.db)).rows[0].receiver_lot_id;
  /** Traspaso aceptado y con salida (compuerta sustituida) de `q` kg desde un lote nuevo de `total` kg. */
  async function inTransit(total: string, q: string) {
    const l = await lot(total);
    const t = (await offer(l, q).expect(201)).body.transfer;
    await accept(t.id).expect(200);
    allowGate();
    await dispatch(t.id).expect(200);
    return { l, id: t.id as string };
  }

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    for (const e of [A, B, C]) await h.user(e);
    const mk = async (name: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Emisora A', A); orgB = await mk('Coop Receptora B', B); orgC = await mk('Coop Ajena C', C);
    await join(orgA, A, AAUD, 'AUDITOR'); await join(orgA, A, ATRZ, 'TRACEABILITY_MANAGER'); await join(orgB, B, BREC, 'RECEPTION_OPERATOR');
    producer = (await http().post(`${base(orgA)}/producers`).set(as(A)).send({ producer_code: 'TR-1', legal_name: 'Finca Traspaso' }).expect(201)).body.id;
    plot = (await http().post(`${base(orgA)}/plots`).set(as(A)).send({ producer_id: producer, plot_code: 'TR-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    baba = (await http().post(`${base(orgA)}/products`).set(as(A)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    c1 = (await http().post(`${base(orgA)}/locations`).set(as(A)).send({ code: 'C1', name: 'Centro uno', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    c2 = (await http().post(`${base(orgA)}/locations`).set(as(A)).send({ code: 'C2', name: 'Bodega dos', location_type: 'WAREHOUSE' }).expect(201)).body.id;
    prodB = (await http().post(`${base(orgB)}/products`).set(as(B)).send({ code: 'CACAO_RECIBIDO', name: 'Cacao recibido en custodia', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    locB = (await http().post(`${base(orgB)}/locations`).set(as(B)).send({ code: 'RB1', name: 'Recepción B', location_type: 'WAREHOUSE' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());
  afterEach(() => jest.restoreAllMocks());

  it('vínculo bilateral: se propone con código de un solo uso, lo confirma la OTRA organización y solo hay uno activo por pareja', async () => {
    await http().post(`${base(orgA)}/partnerships`).set(as(AAUD)).send({ operation_id: randomUUID() }).expect(403);
    const op = randomUUID();
    const inv = (await http().post(`${base(orgA)}/partnerships`).set(as(A)).send({ operation_id: op }).expect(201)).body;
    expect(inv).toMatchObject({ replayed: false, partnership: { status: 'PENDING', you_proposed: true } });
    expect(inv.code).toMatch(/^[0-9A-F]{12}$/);
    const again = (await http().post(`${base(orgA)}/partnerships`).set(as(A)).send({ operation_id: op }).expect(201)).body;
    expect(again).toMatchObject({ replayed: true, code: null });
    // El código se guarda solo como huella.
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM org_partnerships WHERE code_hash = ${inv.code}`.execute(h.db)).rows[0].n).toBe(0);
    await http().post(`${base(orgA)}/partnerships/confirm`).set(as(A)).send({ operation_id: randomUUID(), code: inv.code }).expect(409); // no se autoconfirma
    await http().post(`${base(orgB)}/partnerships/confirm`).set(as(B)).send({ operation_id: randomUUID(), code: 'ZZZZZZZZZZZZ' }).expect(404);
    await http().post(`${base(orgB)}/partnerships/confirm`).set(as(BREC)).send({ operation_id: randomUUID(), code: inv.code }).expect(403);
    const ok = (await http().post(`${base(orgB)}/partnerships/confirm`).set(as(B)).send({ operation_id: randomUUID(), code: inv.code.toLowerCase() }).expect(200)).body;
    expect(ok).toMatchObject({ replayed: false, partnership: { status: 'ACTIVE', counterpart_name: 'Coop Emisora A', you_proposed: false } });
    pid = ok.partnership.id;
    expect((await http().post(`${base(orgB)}/partnerships/confirm`).set(as(B)).send({ operation_id: randomUUID(), code: inv.code }).expect(200)).body.replayed).toBe(true);
    // Un segundo vínculo activo entre la misma pareja no existe, sin importar quién lo proponga.
    const second = (await http().post(`${base(orgB)}/partnerships`).set(as(B)).send({ operation_id: randomUUID() }).expect(201)).body;
    await http().post(`${base(orgA)}/partnerships/confirm`).set(as(A)).send({ operation_id: randomUUID(), code: second.code }).expect(409);
    // Una tercera organización no ve este vínculo ni puede ofrecer con él.
    expect((await http().get(`${base(orgC)}/partnerships`).set(as(C)).expect(200)).body.items).toEqual([]);
    const lc = await lot('10');
    await offer(lc, '5', {}, C, orgC).expect(409);
    const list = (await http().get(`${base(orgA)}/partnerships`).set(as(A)).expect(200)).body.items;
    expect(list.find((p: { id: string }) => p.id === pid)).toMatchObject({ status: 'ACTIVE', counterpart_name: 'Coop Receptora B' });
  });

  it('oferta: reserva en el libro del emisor sin mover la existencia; idempotente; saldo insuficiente; permisos y referencias ajenas', async () => {
    const l = await lot('100');
    const body = offerBody(l, '60', { note: 'Entrega acordada' });
    const r1 = (await http().post(`${base(orgA)}/custody-transfers`).set(as(A)).send(body).expect(201)).body;
    expect(r1).toMatchObject({ replayed: false, transfer: { status: 'OFFERED', side: 'SENDER', quantity: '60', unit: 'KG', your_lot_code: expect.any(String) } });
    const r2 = (await http().post(`${base(orgA)}/custody-transfers`).set(as(A)).send(body).expect(201)).body;
    expect(r2).toMatchObject({ replayed: true, transfer: { id: r1.transfer.id } });
    expect(await qty(orgA, A, l)).toMatchObject({ physical: '100', reserved: '60', available: '40' });
    expect(await movements(orgA, 'CUSTODY_RESERVE', r1.transfer.id)).toBe(1);
    await http().post(`${base(orgA)}/custody-transfers`).set(as(A)).send({ ...body, quantity: '61' }).expect(409); // misma operación, otro contenido
    expect((await offer(l, '41').expect(409)).body.error.code).toBe('INSUFFICIENT_AVAILABLE');
    await offer(l, '10', { location_id: c2 }).expect(409); // sin existencia en ese centro
    await offer(l, '0').expect(422);
    await offer(l, '10', {}, AAUD).expect(403);
    await offer(l, '10', { location_id: locB }).expect(404); // un centro ajeno no es una referencia válida
    await offer(l, '10', { partnership_id: randomUUID() }).expect(409);
    const lb = await lot('5');
    await http().post(`${base(orgB)}/custody-transfers`).set(as(B)).send(offerBody(lb, '1')).expect(404); // lote de A: no existe para B
    expect((await reconcile(orgA, A)).consistent).toBe(true);
  });

  it('concurrencia: dos ofertas simultáneas que no caben juntas → una prospera, la otra recibe 409 y el libro queda consistente', async () => {
    const l = await lot('100');
    const rs = await Promise.all([offer(l, '70'), offer(l, '70')]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await qty(orgA, A, l)).toMatchObject({ physical: '100', reserved: '70', available: '30' });
    expect((await reconcile(orgA, A)).consistent).toBe(true);
    // La misma operación enviada dos veces a la vez no duplica la reserva.
    const l2 = await lot('50');
    const b = offerBody(l2, '20');
    const same = await Promise.all([1, 2, 3].map(() => http().post(`${base(orgA)}/custody-transfers`).set(as(A)).send(b)));
    expect(same.every((r) => r.status === 201)).toBe(true);
    expect(new Set(same.map((r) => r.body.transfer.id)).size).toBe(1);
    expect(await qty(orgA, A, l2)).toMatchObject({ reserved: '20' });
  });

  it('aceptación, rechazo y cancelación según el estado; cada una libera la reserva y deja historia', async () => {
    const l = await lot('100');
    const t1 = (await offer(l, '30').expect(201)).body.transfer;
    await act(orgA, A, t1.id, 'accept', { product_id: prodB, location_id: locB }).expect(403); // la emisora no acepta lo que ofreció (lado equivocado)
    await accept(t1.id, BREC).expect(403); // sin permiso de aceptar
    await accept(t1.id, B, { product_id: randomUUID() }).expect(404);
    await accept(t1.id, B, { location_id: randomUUID() }).expect(404);
    const stale = await accept(t1.id, B, {}).then(async () => act(orgB, B, t1.id, 'accept', { product_id: prodB, location_id: locB }, 1));
    expect(stale.status).toBe(409);
    expect(stale.body.error.code === 'VERSION_CONFLICT' || stale.body.error.code === 'TRANSFER_STATE').toBe(true);
    expect((await view(orgB, B, t1.id)).status).toBe('ACCEPTED');
    await act(orgB, B, t1.id, 'reject', { reason: 'Ya no la necesito' }).expect(409); // aceptado: la receptora ya no rechaza la oferta
    await act(orgA, A, t1.id, 'cancel', { reason: 'Cambio de plan' }).expect(200); // la emisora sí cancela antes de la salida
    expect(await qty(orgA, A, l)).toMatchObject({ reserved: '0', available: '100' });
    await act(orgA, A, t1.id, 'cancel', { reason: 'Otra vez' }).expect(409);
    // Rechazo de la oferta por la receptora.
    const t2 = (await offer(l, '25').expect(201)).body.transfer;
    await act(orgA, A, t2.id, 'reject', { reason: 'No me corresponde' }).expect(403);
    const rej = (await act(orgB, B, t2.id, 'reject', { reason: 'Sin capacidad de almacenamiento' }).expect(200)).body.transfer;
    expect(rej).toMatchObject({ status: 'REJECTED', reject_reason: 'Sin capacidad de almacenamiento' });
    expect(await qty(orgA, A, l)).toMatchObject({ reserved: '0' });
    await accept(t2.id).expect(409);
    expect(await movements(orgA, 'CUSTODY_RESERVE_RELEASE', t2.id)).toBe(1);
    // Reintento idempotente de la cancelación: no libera dos veces.
    const t3 = (await offer(l, '10').expect(201)).body.transfer;
    const op = randomUUID();
    const c = (await act(orgA, A, t3.id, 'cancel', { operation_id: op, reason: 'Duplicado' })).body;
    const c2r = (await act(orgA, A, t3.id, 'cancel', { operation_id: op, reason: 'Duplicado' }, 1).expect(200)).body;
    expect(c.transfer.status).toBe('CANCELLED');
    expect(c2r.replayed).toBe(true);
    expect(await movements(orgA, 'CUSTODY_RESERVE_RELEASE', t3.id)).toBe(1);
    // Todo quedó en la historia, de ambos lados, sin perder pasos.
    const steps = (await view(orgB, B, t2.id)).steps.map((s: { step: string }) => s.step);
    expect(steps).toEqual(['OFFER', 'REJECT_OFFER']);
    expect((await reconcile(orgA, A)).consistent).toBe(true);
  });

  it('salida: la compuerta real BLOQUEA sin bypass; el preflight lo explica; ni la oferta ni la reserva cambian', async () => {
    const l = await lot('80');
    const t = (await offer(l, '50').expect(201)).body.transfer;
    await dispatch(t.id).expect(409); // sin aceptar: bloqueado por estado
    await accept(t.id).expect(200);
    const pf = (await http().get(`${base(orgA)}/custody-transfers/${t.id}/preflight`).set(as(A)).expect(200)).body;
    expect(pf.allowed).toBe(false);
    expect(pf.checks.find((c: { code: string }) => c.code === 'GATE')).toMatchObject({ status: 'BLOCKED' });
    expect(pf.checks.find((c: { code: string }) => c.code === 'RESERVATION')).toMatchObject({ status: 'OK' });
    const blocked = await dispatch(t.id).expect(409);
    expect(blocked.body.error.code).toBe('TRANSFER_DISPATCH_BLOCKED');
    expect(await qty(orgA, A, l)).toMatchObject({ physical: '80', reserved: '50' });
    expect(await movements(orgA, 'CUSTODY_OUT', t.id)).toBe(0);
    expect((await view(orgA, A, t.id)).status).toBe('ACCEPTED');
    // Un cuerpo con una "bandera" de omisión no cambia nada: la API operativa no tiene bypass.
    await dispatch(t.id, { skip_gate: true, gate_override: true, force: true }).expect(400);
    expect(await movements(orgA, 'CUSTODY_OUT', t.id)).toBe(0);
    // Sin permiso de salida ni siendo la receptora.
    await act(orgA, AAUD, t.id, 'dispatch').expect(403);
    await act(orgB, B, t.id, 'dispatch').expect(403);
    await http().get(`${base(orgB)}/custody-transfers/${t.id}/preflight`).set(as(B)).expect(404);
  });

  it('salida y recepción total: tres libros cuadran (emisor + tránsito + receptor), reintentos sin duplicar y linaje entre organizaciones', async () => {
    const l = await lot('100');
    const t = (await offer(l, '60').expect(201)).body.transfer;
    await accept(t.id).expect(200);
    allowGate();
    const op = randomUUID();
    const d1 = (await dispatch(t.id, { operation_id: op }).expect(200)).body;
    expect(d1.transfer).toMatchObject({ status: 'IN_TRANSIT', quantities: { dispatched: '60', in_transit: '60', received: '0' } });
    const d2 = (await act(orgA, A, t.id, 'dispatch', { operation_id: op }, 1).expect(200)).body;
    expect(d2.replayed).toBe(true);
    expect(await movements(orgA, 'CUSTODY_OUT', t.id)).toBe(1);
    // Emisor: la existencia y la reserva salieron de su libro; nada se creó en el receptor todavía.
    expect(await qty(orgA, A, l)).toMatchObject({ physical: '40', reserved: '0', available: '40' });
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM lots WHERE organization_id = ${orgB}`.execute(h.db)).rows[0].n).toBe(0);
    await act(orgA, A, t.id, 'cancel', { reason: 'Ya salió' }).expect(409);
    // Recepción: solo la receptora con permiso de recibir.
    await act(orgA, A, t.id, 'receive', { quantity: '60' }).expect(403);
    await act(orgB, AAUD, t.id, 'receive', { quantity: '60' }, 1).expect(404);
    await act(orgB, BREC, t.id, 'receive', { quantity: '0' }).expect(422);
    const rop = randomUUID();
    const rc = (await act(orgB, BREC, t.id, 'receive', { operation_id: rop, quantity: '60' }).expect(200)).body.transfer;
    expect(rc).toMatchObject({ status: 'CLOSED', closure: 'COMPLETE', quantities: { received: '60', in_transit: '0' }, side: 'RECEIVER' });
    const rr = (await act(orgB, BREC, t.id, 'receive', { operation_id: rop, quantity: '60' }, 1).expect(200)).body;
    expect(rr.replayed).toBe(true);
    expect(await movements(orgB, 'CUSTODY_IN', t.id)).toBe(1);
    await act(orgB, BREC, t.id, 'receive', { quantity: '1', reason: 'Extra' }).expect(409); // cerrado
    // Receptor: lote propio con origen INCOMPLETO, sin entradas de recepción; ningún organization_id cambió.
    const rl = await receiverLot(t.id);
    expect(await qty(orgB, B, rl)).toMatchObject({ physical: '60', reserved: '0', available: '60' });
    const row = (await sql<{ organization_id: string; source: string; origin_status: string; status: string }>`SELECT organization_id, source, origin_status, status FROM lots WHERE id = ${rl}`.execute(h.db)).rows[0];
    expect(row).toEqual({ organization_id: orgB, source: 'CUSTODY_TRANSFER', origin_status: 'INCOMPLETE', status: 'CLOSED_FOR_INPUT' });
    expect((await sql<{ organization_id: string }>`SELECT organization_id FROM lots WHERE id = ${l}`.execute(h.db)).rows[0].organization_id).toBe(orgA);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM lot_inputs WHERE lot_id = ${rl}`.execute(h.db)).rows[0].n).toBe(0);
    // Conservación: 100 = 40 (emisor) + 60 (receptor).
    expect(await qty(orgA, A, l)).toMatchObject({ physical: '40' });
    expect((await reconcile(orgA, A)).consistent).toBe(true);
    expect((await reconcile(orgB, B)).consistent).toBe(true);
    // Linaje: cada lado ve el traspaso y la organización, no el lote de la otra.
    const linkB = (await http().get(`${base(orgB)}/custody-transfers/lineage/${rl}`).set(as(B)).expect(200)).body.links;
    expect(linkB).toEqual([expect.objectContaining({ direction: 'RECEIVED_FROM', quantity: '60', counterpart_name: 'Coop Emisora A', transfer_code: expect.any(String) })]);
    const linkA = (await http().get(`${base(orgA)}/custody-transfers/lineage/${l}`).set(as(A)).expect(200)).body.links;
    expect(linkA).toEqual([expect.objectContaining({ direction: 'SENT_TO', quantity: '60', counterpart_name: 'Coop Receptora B' })]);
    expect(JSON.stringify(linkA)).not.toContain(rl);
    expect(JSON.stringify(linkB)).not.toContain(l);
    // El lote recibido no hereda expediente ni aprobación del origen (D2): no tiene expediente de diligencia.
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM dd_cases WHERE subject_id = ${rl}`.execute(h.db)).rows[0].n).toBe(0);
  });

  it('recepción parcial: lo no recibido sigue en tránsito (no es pérdida) hasta recibirlo, rechazarlo o conciliarlo', async () => {
    const { l, id } = await inTransit('100', '90');
    const p1 = (await act(orgB, B, id, 'receive', { quantity: '50' }).expect(200)).body.transfer;
    expect(p1).toMatchObject({ status: 'IN_TRANSIT', quantities: { received: '50', in_transit: '40', loss_confirmed: '0' } });
    expect(await qty(orgB, B, await receiverLot(id))).toMatchObject({ physical: '50' });
    const p2 = (await act(orgB, B, id, 'receive', { quantity: '40' }).expect(200)).body.transfer;
    expect(p2).toMatchObject({ status: 'CLOSED', closure: 'COMPLETE', quantities: { received: '90', in_transit: '0' } });
    expect((await view(orgA, A, id)).quantities).toMatchObject({ received: '90', in_transit: '0' });
    expect(await qty(orgA, A, l)).toMatchObject({ physical: '10' });
    expect((await reconcile(orgA, A)).consistent && (await reconcile(orgB, B)).consistent).toBe(true);
  });

  it('faltante: exige motivo, conserva estado y cantidad pendientes, no resta existencias y solo la contraparte confirma la pérdida', async () => {
    const { l, id } = await inTransit('100', '80');
    await act(orgB, B, id, 'receive', { quantity: '60' }).expect(200);
    await act(orgB, B, id, 'shortage', { quantity: '30', reason: 'xx' }).expect(400); // motivo demasiado corto
    await act(orgB, B, id, 'shortage', { quantity: '30', reason: 'Faltaron sacos en el camión' }).expect(409); // más de lo que sigue en tránsito (20)
    const s = (await act(orgB, B, id, 'shortage', { quantity: '20', reason: 'Faltaron sacos en el camión' }).expect(200)).body.transfer;
    expect(s).toMatchObject({ status: 'WITH_DISCREPANCY', quantities: { in_transit: '20', open_shortage: '20', loss_confirmed: '0', received: '60' } });
    // Una diferencia pendiente NO es una pérdida y no cambia ningún libro.
    expect(await qty(orgA, A, l)).toMatchObject({ physical: '20' });
    expect(await qty(orgB, B, await receiverLot(id))).toMatchObject({ physical: '60' });
    const d = s.discrepancies[0];
    expect(d).toMatchObject({ kind: 'SHORTAGE', status: 'OPEN', recorded_by: 'YOU' });
    // Quien declaró el faltante no lo confirma como pérdida; tampoco sin permiso.
    await act(orgB, B, id, `discrepancies/${d.id}/resolve`, { resolution: 'LOSS_CONFIRMED', reason: 'Lo confirmo yo' }).expect(403);
    await act(orgA, AAUD, id, `discrepancies/${d.id}/resolve`, { resolution: 'LOSS_CONFIRMED', reason: 'Sin permiso' }).expect(403);
    await act(orgA, A, id, `discrepancies/${d.id}/resolve`, { resolution: 'OVERAGE_CONFIRMED', reason: 'Tipo equivocado' }).expect(422);
    const rop = randomUUID();
    const done = (await act(orgA, A, id, `discrepancies/${d.id}/resolve`, { operation_id: rop, resolution: 'LOSS_CONFIRMED', reason: 'Confirmado con el transportista' }).expect(200)).body.transfer;
    expect(done).toMatchObject({ status: 'CLOSED', closure: 'WITH_DIFFERENCES', quantities: { in_transit: '0', loss_confirmed: '20', received: '60' } });
    expect((await act(orgA, A, id, `discrepancies/${d.id}/resolve`, { operation_id: rop, resolution: 'LOSS_CONFIRMED', reason: 'Confirmado con el transportista' }, 1).expect(200)).body.replayed).toBe(true);
    await act(orgA, A, id, `discrepancies/${d.id}/resolve`, { resolution: 'LOSS_CONFIRMED', reason: 'Otra vez' }).expect(409);
    // La pérdida confirmada ya estaba fuera del libro del emisor: ninguna resta automática adicional.
    expect(await qty(orgA, A, l)).toMatchObject({ physical: '20' });
    expect((await reconcile(orgA, A)).consistent && (await reconcile(orgB, B)).consistent).toBe(true);
    // Reabrir un faltante lo devuelve a tránsito (la mercancía apareció): no hay pérdida.
    const t2 = await inTransit('50', '30');
    const f = (await act(orgB, B, t2.id, 'shortage', { quantity: '30', reason: 'No ha llegado todavía' }).expect(200)).body.transfer;
    const back = (await act(orgA, A, t2.id, `discrepancies/${f.discrepancies[0].id}/resolve`, { resolution: 'SHORTAGE_REOPENED', reason: 'El transportista confirma que va en camino' }).expect(200)).body.transfer;
    expect(back).toMatchObject({ status: 'IN_TRANSIT', quantities: { in_transit: '30', loss_confirmed: '0', open_shortage: '0' } });
    expect((await act(orgB, B, t2.id, 'receive', { quantity: '30' }).expect(200)).body.transfer).toMatchObject({ status: 'CLOSED', closure: 'COMPLETE' });
  });

  it('sobrante: no crea existencias solo; exige motivo; la emisora lo confirma (entra al receptor) o se retira', async () => {
    const { l, id } = await inTransit('100', '40');
    await act(orgB, B, id, 'receive', { quantity: '45' }).expect(422); // llegó más que lo despachado: exige motivo
    const o = (await act(orgB, B, id, 'receive', { quantity: '45', reason: 'La báscula marcó 5 kg más' }).expect(200)).body.transfer;
    expect(o).toMatchObject({ status: 'WITH_DISCREPANCY', quantities: { received: '40', in_transit: '0', open_overage: '5', overage_confirmed: '0' } });
    expect(await qty(orgB, B, await receiverLot(id))).toMatchObject({ physical: '40' }); // el sobrante NO existe todavía
    const d = o.discrepancies[0];
    expect(d).toMatchObject({ kind: 'OVERAGE', status: 'OPEN' });
    await act(orgB, B, id, `discrepancies/${d.id}/resolve`, { resolution: 'OVERAGE_CONFIRMED', reason: 'Lo confirmo yo' }).expect(403);
    const ok = (await act(orgA, A, id, `discrepancies/${d.id}/resolve`, { resolution: 'OVERAGE_CONFIRMED', reason: 'Recontamos y había 5 kg adicionales' }).expect(200)).body.transfer;
    expect(ok).toMatchObject({ status: 'CLOSED', closure: 'WITH_DIFFERENCES', quantities: { received: '40', overage_confirmed: '5' } });
    expect(await qty(orgB, B, await receiverLot(id))).toMatchObject({ physical: '45' });
    expect(await qty(orgA, A, l)).toMatchObject({ physical: '60' }); // el libro de la emisora no se toca: ninguna resta automática
    expect((await reconcile(orgA, A)).consistent && (await reconcile(orgB, B)).consistent).toBe(true);
    // Retirar el sobrante: queda registrado y el receptor conserva solo lo despachado.
    const t2 = await inTransit('50', '20');
    const w = (await act(orgB, B, t2.id, 'receive', { quantity: '22', reason: 'Conteo preliminar con 2 kg más' }).expect(200)).body.transfer;
    const closed = (await act(orgB, B, t2.id, `discrepancies/${w.discrepancies[0].id}/resolve`, { resolution: 'OVERAGE_WITHDRAWN', reason: 'Era humedad en el saco' }).expect(200)).body.transfer;
    expect(closed).toMatchObject({ status: 'CLOSED', closure: 'COMPLETE', discrepancies: [expect.objectContaining({ kind: 'OVERAGE', status: 'RESOLVED', resolution: 'OVERAGE_WITHDRAWN' })] });
    expect(await qty(orgB, B, await receiverLot(t2.id))).toMatchObject({ physical: '20' });
  });

  it('rechazo en tránsito: lo rechazado vuelve al lote y centro de origen del emisor con su procedencia, y exige motivo', async () => {
    const { l, id } = await inTransit('100', '70');
    await act(orgB, B, id, 'reject-in-transit', { quantity: '30', reason: 'x' }).expect(400);
    await act(orgA, A, id, 'reject-in-transit', { quantity: '30', reason: 'La emisora no rechaza lo que envió' }).expect(403);
    await act(orgB, B, id, 'reject-in-transit', { quantity: '80', reason: 'Humedad fuera de lo acordado' }).expect(409);
    const r = (await act(orgB, B, id, 'reject-in-transit', { quantity: '30', reason: 'Humedad fuera de lo acordado' }).expect(200)).body.transfer;
    expect(r).toMatchObject({ status: 'IN_TRANSIT', quantities: { in_transit: '40', returned_to_sender_in_transit: '30' } });
    expect(await qty(orgA, A, l)).toMatchObject({ physical: '60' }); // 30 + 30 devueltos
    expect(await movements(orgA, 'CUSTODY_RETURN', id)).toBe(1);
    const e = (await sql<{ location_id: string; lot_id: string }>`SELECT e.location_id, e.lot_id FROM stock_entries e JOIN stock_movements m ON m.id = e.movement_id WHERE m.movement_type = 'CUSTODY_RETURN' AND m.reference->>'transfer_id' = ${id}`.execute(h.db)).rows[0];
    expect(e).toEqual({ location_id: c1, lot_id: l });
    const fin = (await act(orgB, B, id, 'receive', { quantity: '40' }).expect(200)).body.transfer;
    expect(fin).toMatchObject({ status: 'CLOSED', closure: 'WITH_DIFFERENCES', quantities: { received: '40', returned_to_sender_in_transit: '30' } });
    expect((await reconcile(orgA, A)).consistent && (await reconcile(orgB, B)).consistent).toBe(true);
  });

  it('devolución vinculada: lo ya recibido se devuelve con OTRO traspaso, limitado a lo recibido y sin reabrir el original', async () => {
    const { id } = await inTransit('100', '50');
    await act(orgB, B, id, 'receive', { quantity: '50' }).expect(200);
    const rl = await receiverLot(id);
    const ret = (b: Record<string, unknown>) => http().post(`${base(orgB)}/custody-transfers`).set(as(B)).send({ operation_id: randomUUID(), partnership_id: pid, location_id: locB, ...b });
    await ret({ lot_id: rl, quantity: '60', returns_transfer_id: id }).expect(409); // más de lo recibido
    await ret({ lot_id: randomUUID(), quantity: '5', returns_transfer_id: id }).expect(404);
    await http().post(`${base(orgA)}/custody-transfers`).set(as(A)).send(offerBody(await lot('9'), '5', { returns_transfer_id: id })).expect(404); // la emisora original no devuelve lo que no recibió
    const t = (await ret({ lot_id: rl, quantity: '20', returns_transfer_id: id }).expect(201)).body.transfer;
    expect(t).toMatchObject({ status: 'OFFERED', side: 'SENDER', sender: { name: 'Coop Receptora B' }, receiver: { name: 'Coop Emisora A' }, is_return_of: { id } });
    await ret({ lot_id: rl, quantity: '31', returns_transfer_id: id }).expect(409); // 20 ya comprometidos de 50
    expect(await qty(orgB, B, rl)).toMatchObject({ physical: '50', reserved: '20' });
    // Aceptación por la emisora original, con producto y centro propios; el original queda cerrado e intacto.
    await act(orgA, A, t.id, 'accept', { product_id: baba, location_id: c2 }).expect(200);
    allowGate();
    await act(orgB, B, t.id, 'dispatch').expect(200);
    const back = (await act(orgA, A, t.id, 'receive', { quantity: '20' }).expect(200)).body.transfer;
    expect(back).toMatchObject({ status: 'CLOSED', closure: 'COMPLETE' });
    expect(await qty(orgB, B, rl)).toMatchObject({ physical: '30', reserved: '0' });
    const lotBack = await receiverLot(t.id);
    expect(await qty(orgA, A, lotBack)).toMatchObject({ physical: '20' });
    expect((await view(orgA, A, id)).returns).toEqual([expect.objectContaining({ id: t.id, status: 'CLOSED' })]);
    expect((await view(orgA, A, id)).status).toBe('CLOSED');
    expect((await reconcile(orgA, A)).consistent && (await reconcile(orgB, B)).consistent).toBe(true);
  });

  it('permisos y filtraciones: una tercera organización no ve nada; cada parte ve el traspaso pero no el inventario ni los centros de la otra', async () => {
    const l = await lot('30');
    const t = (await offer(l, '10').expect(201)).body.transfer;
    await accept(t.id).expect(200);
    await http().get(`${base(orgC)}/custody-transfers/${t.id}`).set(as(C)).expect(404);
    await http().get(`${base(orgA)}/custody-transfers/${t.id}`).set(as(C)).expect(404); // C no es miembro de A
    await http().get(`${base(orgC)}/custody-transfers/lineage/${l}`).set(as(C)).expect(200).then((r) => expect(r.body.links).toEqual([]));
    expect((await http().get(`${base(orgC)}/custody-transfers`).set(as(C)).expect(200)).body.items).toEqual([]);
    await act(orgC, C, t.id, 'receive', { quantity: '10' }, 1).expect(404);
    await act(orgA, A, t.id, 'receive', { quantity: '10' }, 1).expect(403); // el lado se comprueba antes que la versión: no se aprende nada del estado
    const sender = JSON.stringify(await view(orgA, A, t.id));
    const receiver = JSON.stringify(await view(orgB, B, t.id));
    expect(sender).not.toContain(locB); expect(sender).not.toContain(prodB); expect(sender).not.toContain('CACAO_RECIBIDO');
    expect(receiver).not.toContain(c1); expect(receiver).not.toContain(l); expect(receiver).not.toContain('C1');
    const rv = await view(orgB, B, t.id);
    expect(rv.origin_projection).toMatchObject({ sender_lot_code: expect.any(String), origin_status: 'COMPLETE', is_a_conformity_statement: false });
    expect(rv.origin_projection_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rv.boundaries.join(' ')).toMatch(/no hereda expediente/);
    expect((await view(orgA, A, t.id)).origin_projection).toBeUndefined();
    // Las opciones de B no incluyen el inventario de A; el listado de A no muestra lotes de B.
    const opts = (await http().get(`${base(orgB)}/custody-transfers/options`).set(as(B)).expect(200)).body;
    expect(JSON.stringify(opts)).not.toContain(l);
    // El auditor lee, no actúa.
    expect((await http().get(`${base(orgA)}/custody-transfers`).set(as(AAUD)).expect(200)).body.items.length).toBeGreaterThan(0);
    await http().get(`${base(orgB)}/custody-transfers`).set(as(BREC)).expect(200);
    await act(orgA, AAUD, t.id, 'cancel', { reason: 'Sin permiso' }).expect(403);
    // El responsable de trazabilidad de A ofrece pero no administra vínculos.
    await offer(l, '5', {}, ATRZ).expect(201);
    await http().post(`${base(orgA)}/partnerships`).set(as(ATRZ)).send({ operation_id: randomUUID() }).expect(403);
  });

  it('integridad en la base: pasos y linaje son append-only; el traspaso no cambia organizaciones, lote ni cantidad; el saldo del tránsito no puede quedar negativo', async () => {
    const { id } = await inTransit('100', '10');
    await expect(sql`UPDATE custody_transfer_steps SET quantity = 1 WHERE transfer_id = ${id}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM custody_transfer_steps WHERE transfer_id = ${id}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`UPDATE custody_transfers SET quantity = 99 WHERE id = ${id}`.execute(h.db)).rejects.toThrow(/no cambian/);
    await expect(sql`UPDATE custody_transfers SET receiver_org_id = ${orgC} WHERE id = ${id}`.execute(h.db)).rejects.toThrow();
    await expect(sql`UPDATE lots SET organization_id = ${orgB} WHERE id = ${(await sql<{ sender_lot_id: string }>`SELECT sender_lot_id FROM custody_transfers WHERE id = ${id}`.execute(h.db)).rows[0].sender_lot_id}`.execute(h.db)).rejects.toThrow();
    // Un lote de custodia no puede declararse con origen COMPLETO ni abierto a entradas.
    await act(orgB, B, id, 'receive', { quantity: '10' }).expect(200);
    const rl = await receiverLot(id);
    await expect(sql`UPDATE lots SET origin_status = 'COMPLETE' WHERE id = ${rl}`.execute(h.db)).rejects.toThrow();
    // Tránsito negativo: la base lo impide aunque el servicio fallara.
    await expect(sql`INSERT INTO custody_transfer_steps (id, transfer_id, actor_org_id, actor_user_id, step, quantity, operation_id)
      SELECT gen_random_uuid(), ${id}, ${orgB}, u.id, 'RECEIPT', 5, gen_random_uuid() FROM users u WHERE u.email = ${B}`.execute(h.db)).rejects.toThrow(/tránsito quedaría negativo/);
    // Revocar el vínculo con traspasos abiertos se rechaza; con todo cerrado, se permite.
    const l = await lot('10');
    const open = (await offer(l, '5').expect(201)).body.transfer;
    await http().post(`${base(orgA)}/partnerships/${pid}/revoke`).set(as(A)).send({ operation_id: randomUUID(), reason: 'Prueba' }).expect(409);
    await act(orgA, A, open.id, 'cancel', { reason: 'Cerrar para revocar' }).expect(200);
  });

  it('el traspaso aparece en eventos y auditoría de ambas organizaciones, sin datos sensibles', async () => {
    const { id } = await inTransit('60', '20');
    await act(orgB, B, id, 'receive', { quantity: '20' }).expect(200);
    const ev = (await sql<{ organization_id: string; event_type: string }>`SELECT organization_id, event_type FROM domain_events WHERE aggregate_type = 'CUSTODY_TRANSFER' AND aggregate_id = ${id} ORDER BY recorded_at`.execute(h.db)).rows;
    expect(ev.filter((e) => e.organization_id === orgA).map((e) => e.event_type)).toEqual(expect.arrayContaining(['CustodyTransferOffered', 'CustodyTransferDispatched']));
    expect(ev.filter((e) => e.organization_id === orgB).map((e) => e.event_type)).toEqual(expect.arrayContaining(['CustodyTransferAccepted', 'CustodyTransferReceived', 'CustodyTransferClosed']));
    const audit = (await sql<{ organization_id: string; action: string }>`SELECT organization_id, action FROM audit_logs WHERE entity_id = ${id}`.execute(h.db)).rows;
    expect(audit.some((a) => a.organization_id === orgA && a.action === 'custody.dispatch')).toBe(true);
    expect(audit.some((a) => a.organization_id === orgB && a.action === 'custody.receive')).toBe(true);
    expect(JSON.stringify(ev)).not.toMatch(/password|token/i);
  });

  it('el lote recibido en custodia convive con los recorridos existentes: listado, detalle, saldos, movimientos, riesgo y expediente, siempre con origen INCOMPLETO', async () => {
    const { id } = await inTransit('100', '30');
    await act(orgB, B, id, 'receive', { quantity: '30' }).expect(200);
    const rl = await receiverLot(id);
    const detail = (await http().get(`${base(orgB)}/lots/${rl}`).set(as(B)).expect(200)).body;
    expect(detail).toMatchObject({ source: 'CUSTODY_TRANSFER', origin: { status: 'INCOMPLETE' }, inputs: [], produced_by: null, custody_origin: { sender_name: 'Coop Emisora A', received: { value: '30', unit: 'KG' } }, actions: { assign: false, release_input: false, close_for_input: false } });
    expect(detail.origin.note).toMatch(/no hereda su expediente/);
    expect(JSON.stringify((await http().get(`${base(orgB)}/lots`).set(as(B)).expect(200)).body)).toContain(rl);
    expect(JSON.stringify((await http().get(`${base(orgB)}/inventory/balances`).set(as(B)).expect(200)).body)).toContain(rl);
    expect(JSON.stringify((await http().get(`${base(orgB)}/inventory/movements`).set(as(B)).expect(200)).body)).toContain('CUSTODY_IN');
    // Riesgo y expediente: el lote existe como sujeto, pero NO hereda nada del emisor y su origen sigue incompleto.
    const ev = await http().post(`${base(orgB)}/risk/lots/${rl}/evaluations`).set(as(B)).send({ operation_id: randomUUID() });
    expect(ev.status).toBeLessThan(500);
    const dd = await http().post(`${base(orgB)}/dd-cases`).set(as(B)).send({ operation_id: randomUUID(), lot_id: rl, scope_note: 'Expediente propio del lote recibido' });
    expect(dd.status).toBeLessThan(500);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM dd_cases WHERE subject_id = ${rl} AND organization_id <> ${orgB}`.execute(h.db)).rows[0].n).toBe(0);
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM dd_snapshots s JOIN dd_cases c ON c.id = s.case_id WHERE c.subject_id = ${rl}`.execute(h.db)).rows[0].n).toBe(0);
  });
});
