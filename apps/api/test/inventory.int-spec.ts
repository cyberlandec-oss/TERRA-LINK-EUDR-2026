import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { AuditService } from '../src/audit/audit.service';
import { AuthorizationService } from '../src/authz/authorization.service';
import { KdeService } from '../src/traceability/kde';

// Integración P0-017 Inventario y balance de masa con PostgreSQL real. Datos SINTÉTICOS.
// El ledger es la única fuente de existencia, reserva y disponible (docs/decisiones/P0-017-EFECTOS-LEDGER.md).
describeDb('P0-017 ledger de inventario: única fuente, conservación y concurrencia', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let producer: string;
  let plot: string;
  let baba: string;
  let fermentado: string;
  let c1: string;
  let c2: string;
  let cB: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local';
  const TRAZ = 'traz@test.local';

  async function join(o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(ADMIN)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  async function delivery(q: string) {
    return (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: q, unit: 'KG', origins: [{ plot_id: plot }], register: true }).expect(201)).body.delivery;
  }
  async function reception(q: string, location = c1) {
    const d = await delivery(q);
    return (await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: location, received_at: new Date().toISOString(), weighing: { method: 'Báscula', quantity: q, unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id as string;
  }
  const balances = async (actor = ADMIN, o = orgA) => (await http().get(`${base(o)}/inventory/balances`).set(as(actor)).expect(200)).body;
  const lotRow = (b: { lots: Array<{ lot_id: string; location: { id: string } | null }> }, lot: string, loc: string | null) => b.lots.find((x) => x.lot_id === lot && (x.location?.id ?? null) === loc) as unknown as { physical: string; reserved: string; available: string; pending_location: boolean } | undefined;
  const totalPhysical = async () => (await sql<{ t: string }>`SELECT coalesce(sum(signed_quantity), 0)::text AS t FROM stock_entries WHERE organization_id = ${orgA} AND bucket = 'PHYSICAL'`.execute(h.db)).rows[0].t;
  const post = (path: string, body: Record<string, unknown>, actor = TRAZ) => http().post(`${base(orgA)}/inventory/${path}`).set(as(actor)).send({ operation_id: randomUUID(), ...body });
  async function processed(inputQ: string, outQ: string, loss: string, location = c1) {
    const r = await reception(inputQ, location);
    const lot = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r, quantity: inputQ }] }).expect(201)).body.lot;
    const run = (await http().post(`${base(orgA)}/process-runs`).set(as(TRAZ)).send({ operation_id: randomUUID(), process_type: 'FERMENTATION', output_product_id: fermentado }).expect(201)).body.run;
    await http().post(`${base(orgA)}/process-runs/${run.id}/start`).set(as(TRAZ)).send({ operation_id: randomUUID(), started_at: new Date().toISOString(), inputs: [{ lot_id: lot.id, quantity: inputQ }] }).expect(200);
    const closed = (await http().post(`${base(orgA)}/process-runs/${run.id}/close`).set(as(TRAZ)).send({ operation_id: randomUUID(), closed_at: new Date(Date.now() + 1000).toISOString(), outputs: [{ quantity: outQ }], loss_quantity: loss }).expect(200)).body.run;
    return { lot: lot.id, run: run.id, out: closed.outputs[0].lot_id as string };
  }

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Inventario A', ADMIN);
    orgB = await mk('Coop Inventario B', 'admin-b@test.local');
    for (const [e, r] of [[TRAZ, 'TRACEABILITY_MANAGER'], ['recepcion@test.local', 'RECEPTION_OPERATOR'], ['auditor@test.local', 'AUDITOR'], ['export@test.local', 'EXPORT_MANAGER']]) await join(orgA, e, r);
    producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'IN-1', legal_name: 'Finca Inventario' }).expect(201)).body.id;
    plot = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: 'IN-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    fermentado = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_FERMENTADO', name: 'Cacao fermentado', product_state: 'CACAO_FERMENTADO', unit: 'KG' }).expect(201)).body.id;
    c1 = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'C1', name: 'Centro uno', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    c2 = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'C2', name: 'Bodega dos', location_type: 'WAREHOUSE' }).expect(201)).body.id;
    cB = (await http().post(`${base(orgB)}/locations`).set(as('admin-b@test.local')).send({ code: 'CB', name: 'Centro B', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());
  afterEach(() => jest.restoreAllMocks());

  it('única fuente: la recepción es la entrada física; formar lote mueve cantidad sin crear existencias; 500 + 300 → 800 → 750 + 50 sin doble descuento', async () => {
    const before = await totalPhysical();
    const r1 = await reception('500');
    const r2 = await reception('300');
    expect(Number(await totalPhysical()) - Number(before)).toBe(800);
    let b = await balances();
    expect(b.receptions_without_lot.filter((x: { reception_id: string }) => [r1, r2].includes(x.reception_id)).map((x: { physical: string }) => x.physical).sort()).toEqual(['300', '500']);
    const lot = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r1, quantity: '500' }, { reception_id: r2, quantity: '300' }] }).expect(201)).body.lot;
    expect(Number(await totalPhysical()) - Number(before)).toBe(800); // formar el lote no suma existencias
    b = await balances();
    expect(b.receptions_without_lot.some((x: { reception_id: string }) => [r1, r2].includes(x.reception_id))).toBe(false);
    expect(lotRow(b, lot.id, c1)).toMatchObject({ physical: '800', reserved: '0', available: '800' });
    const run = (await http().post(`${base(orgA)}/process-runs`).set(as(TRAZ)).send({ operation_id: randomUUID(), process_type: 'FERMENTATION', output_product_id: fermentado }).expect(201)).body.run;
    await http().post(`${base(orgA)}/process-runs/${run.id}/start`).set(as(TRAZ)).send({ operation_id: randomUUID(), started_at: new Date().toISOString(), inputs: [{ lot_id: lot.id, quantity: '800' }] }).expect(200);
    b = await balances();
    expect(lotRow(b, lot.id, c1)).toMatchObject({ physical: '800', reserved: '800', available: '0' }); // reservar no reduce la existencia
    const closed = (await http().post(`${base(orgA)}/process-runs/${run.id}/close`).set(as(TRAZ)).send({ operation_id: randomUUID(), closed_at: new Date(Date.now() + 1000).toISOString(), outputs: [{ quantity: '750' }], loss_quantity: '50' }).expect(200)).body.run;
    const out = closed.outputs[0].lot_id;
    expect(Number(await totalPhysical()) - Number(before)).toBe(750); // −50 una sola vez
    b = await balances();
    expect(lotRow(b, lot.id, c1)).toBeUndefined(); // consumido: sin existencia
    expect(lotRow(b, out, c1)).toMatchObject({ physical: '750', reserved: '0', available: '750', pending_location: false });
    const mv = await sql<{ process_loss: string; n: number }>`SELECT m.process_loss::text, (SELECT count(*)::int FROM stock_entries e WHERE e.movement_id = m.id) AS n FROM stock_movements m WHERE m.movement_type = 'PROCESS_CLOSE' AND m.source_id = ${run.id}`.execute(h.db);
    expect(mv.rows).toEqual([{ process_loss: '50.000000', n: 3 }]); // −800 reservado, −800 físico, +750 salida
    expect(b.lots.find((x: { lot_id: string }) => x.lot_id === out).quality.status).toBe('PENDING_EVALUATION'); // existencia ≠ calidad liberada
    expect(b.reservations_for_shipments.status).toBe('IMPLEMENTED');
    // conciliación con procesamiento: consistente
    expect((await http().get(`${base(orgA)}/inventory/reconciliation`).set(as(ADMIN)).expect(200)).body).toMatchObject({ consistent: true, differences: [] });
  });

  it('traslados conservan el total; ubicación pendiente se asigna; lo reservado no se traslada; dos salidas simultáneas de 500 sobre 750 no se aceptan ambas', async () => {
    const { out } = await processed('800', '750', '50');
    const t0 = await totalPhysical();
    const tr = (await post('transfers', { lot_id: out, from_location_id: c1, to_location_id: c2, quantity: '300', reason: 'Bodega de secado' }).expect(201)).body;
    expect(tr.lot.quantities.by_location.map((x: { location: string; physical: string }) => `${x.location}:${x.physical}`).sort()).toEqual(['Bodega dos (C2):300', 'Centro uno (C1):450']);
    expect(await totalPhysical()).toBe(t0); // traslado interno: total de la organización sin cambio
    await post('transfers', { lot_id: out, from_location_id: c1, to_location_id: cB, quantity: '1' }).expect(404); // centro de otra organización
    // concurrencia: dos traslados de 400 desde C1 (450 disponibles) → uno solo
    const [a, b] = await Promise.all([post('transfers', { lot_id: out, from_location_id: c1, to_location_id: c2, quantity: '400' }), post('transfers', { lot_id: out, from_location_id: c1, to_location_id: c2, quantity: '400' })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    // dos mermas simultáneas de 500 sobre 750 de otra salida → una sola
    const second = await processed('800', '750', '50');
    const [m1, m2] = await Promise.all([post('losses', { lot_id: second.out, location_id: c1, quantity: '500', reason: 'Merma de bodega' }), post('losses', { lot_id: second.out, location_id: c1, quantity: '500', reason: 'Merma de bodega' })]);
    expect([m1.status, m2.status].sort()).toEqual([201, 409]);
    // salida con entradas en centros distintos → ubicación pendiente (no se inventa un almacén) y se asigna con un movimiento
    const ra = await reception('100', c1);
    const rb = await reception('100', c2);
    const la = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: ra, quantity: '100' }] }).expect(201)).body.lot.id;
    const lb = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rb, quantity: '100' }] }).expect(201)).body.lot.id;
    const run = (await http().post(`${base(orgA)}/process-runs`).set(as(TRAZ)).send({ operation_id: randomUUID(), process_type: 'FERMENTATION', output_product_id: fermentado }).expect(201)).body.run;
    await http().post(`${base(orgA)}/process-runs/${run.id}/start`).set(as(TRAZ)).send({ operation_id: randomUUID(), started_at: new Date().toISOString(), inputs: [{ lot_id: la, quantity: '100' }, { lot_id: lb, quantity: '100' }] }).expect(200);
    const mixedOut = (await http().post(`${base(orgA)}/process-runs/${run.id}/close`).set(as(TRAZ)).send({ operation_id: randomUUID(), closed_at: new Date(Date.now() + 1000).toISOString(), outputs: [{ quantity: '190' }], loss_quantity: '10' }).expect(200)).body.run.outputs[0].lot_id;
    let bal = await balances();
    expect(lotRow(bal, mixedOut, null)).toMatchObject({ physical: '190', pending_location: true });
    expect(bal.pending_location).toEqual(expect.arrayContaining([expect.stringMatching(/^LOT-/)]));
    expect((await post('losses', { lot_id: mixedOut, location_id: c1, quantity: '1', reason: 'x x x' }).expect(409)).body.error.code).toBe('INSUFFICIENT_AVAILABLE'); // no está en C1
    const assign = (await post('transfers', { lot_id: mixedOut, from_location_id: null, to_location_id: c2, quantity: '190' }).expect(201)).body;
    expect(assign.lot.quantities.by_location).toEqual([expect.objectContaining({ location_id: c2, physical: '190', pending_location: false })]);
    bal = await balances();
    expect(lotRow(bal, mixedOut, null)).toBeUndefined();
    // lo reservado no se traslada
    const res = await processed('100', '100', '0');
    const r2 = (await http().post(`${base(orgA)}/process-runs`).set(as(TRAZ)).send({ operation_id: randomUUID(), process_type: 'FERMENTATION', output_product_id: fermentado }).expect(201)).body.run;
    await http().post(`${base(orgA)}/process-runs/${r2.id}/start`).set(as(TRAZ)).send({ operation_id: randomUUID(), started_at: new Date().toISOString(), inputs: [{ lot_id: res.out, quantity: '60' }] }).expect(200);
    expect((await post('transfers', { lot_id: res.out, from_location_id: c1, to_location_id: c2, quantity: '50' }).expect(409)).body.error.code).toBe('INSUFFICIENT_AVAILABLE');
    await post('transfers', { lot_id: res.out, from_location_id: c1, to_location_id: c2, quantity: '40' }).expect(201);
    // cancelar libera la reserva en el ledger
    await http().post(`${base(orgA)}/process-runs/${r2.id}/cancel`).set(as(TRAZ)).send({ operation_id: randomUUID(), reason: 'Cancelado' }).expect(200);
    expect(lotRow(await balances(), res.out, c1)).toMatchObject({ physical: '60', reserved: '0', available: '60' });
  });

  it('merma y ajuste con motivo: sin tocar lo reservado ni dejar saldo negativo; el ajuste no opera sobre recepciones ni sirve de atajo; idempotencia y rollback', async () => {
    const { out } = await processed('200', '180', '20');
    const loss = (await post('losses', { lot_id: out, location_id: c1, quantity: '5', reason: 'Granos dañados' }).expect(201)).body;
    expect(loss.lot.quantities.physical).toBe('175');
    await post('losses', { lot_id: out, location_id: c1, quantity: '5' }).expect(400); // motivo obligatorio
    // ajuste: solo ORG_ADMIN; nunca por debajo de lo reservado
    await post('adjustments', { lot_id: out, location_id: c1, quantity: '-1', reason: 'Conteo' }).expect(403);
    const run = (await http().post(`${base(orgA)}/process-runs`).set(as(TRAZ)).send({ operation_id: randomUUID(), process_type: 'FERMENTATION', output_product_id: fermentado }).expect(201)).body.run;
    await http().post(`${base(orgA)}/process-runs/${run.id}/start`).set(as(TRAZ)).send({ operation_id: randomUUID(), started_at: new Date().toISOString(), inputs: [{ lot_id: out, quantity: '165' }] }).expect(200);
    expect((await post('adjustments', { lot_id: out, location_id: c1, quantity: '-11', reason: 'Conteo físico' }, ADMIN).expect(409)).body.error.code).toBe('ADJUSTMENT_BELOW_RESERVED');
    const adj = (await post('adjustments', { lot_id: out, location_id: c1, quantity: '-5', reason: 'Conteo físico' }, ADMIN).expect(201)).body;
    expect(adj.lot.quantities).toMatchObject({ physical: '170', reserved: '165', available: '5' });
    // ajuste positivo en lote de origen declarado: rechazado (atribuiría origen a cantidad sin trazabilidad)
    expect((await post('adjustments', { lot_id: out, location_id: c1, quantity: '2.5', reason: 'Conteo físico (sobrante)' }, ADMIN).expect(422)).body.error.code).toBe('ADJUSTMENT_WOULD_ATTRIBUTE_ORIGIN');
    // idempotencia: mismo identificador → un solo movimiento
    const op = randomUUID();
    const t1 = (await http().post(`${base(orgA)}/inventory/losses`).set(as(TRAZ)).send({ operation_id: op, lot_id: out, location_id: c1, quantity: '1', reason: 'Merma' }).expect(201)).body;
    const t2 = (await http().post(`${base(orgA)}/inventory/losses`).set(as(TRAZ)).send({ operation_id: op, lot_id: out, location_id: c1, quantity: '1', reason: 'Merma' }).expect(201)).body;
    expect(t2).toMatchObject({ replayed: true, movement_id: t1.movement_id });
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM stock_movements WHERE operation_id = ${op}`.execute(h.db)).rows[0].n).toBe(1);
    // rollback: si falla la auditoría no queda movimiento, línea ni evento
    const counts = async () => (await sql<{ m: number; e: number; ev: number }>`SELECT (SELECT count(*)::int FROM stock_movements) m, (SELECT count(*)::int FROM stock_entries) e, (SELECT count(*)::int FROM domain_events) ev`.execute(h.db)).rows[0];
    const c0 = await counts();
    jest.spyOn(AuditService.prototype, 'record').mockRejectedValueOnce(new Error('fallo forzado'));
    await post('losses', { lot_id: out, location_id: c1, quantity: '0.5', reason: 'Merma' }).expect(500);
    expect(await counts()).toEqual(c0);
    // historia intocable
    await expect(sql`UPDATE stock_entries SET signed_quantity = 1 WHERE lot_id = ${out}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM stock_movements WHERE id = ${t1.movement_id}`.execute(h.db)).rejects.toThrow(/append-only/);
    // evento STORAGE y catálogo
    const ev = await h.db.selectFrom('domain_events').select('payload').where('event_type', '=', 'StockMovementRecorded').where('aggregate_id', '=', out).execute();
    expect(ev.length).toBe(3); // merma, ajuste negativo y merma idempotente (una sola vez)
    const cat = (await http().get(`${base(orgA)}/cte-catalog`).set(as(ADMIN)).expect(200)).body.definitions;
    expect(cat.find((x: { code: string }) => x.code === 'STORAGE').operations[0].integration_status).toBe('INTEGRATED');
  });

  it('incorporación idempotente de datos anteriores al ledger y conciliación sin ajustes; corrección de recepción con el ledger', async () => {
    // simula un registro anterior al ledger: recepción insertada por fuera (sin movimiento)
    const d = await delivery('90');
    const rid = randomUUID();
    const mid = (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select(['m.id', 'u.id as uid']).where('u.email', '=', ADMIN).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow());
    await sql`INSERT INTO receptions (id, organization_id, delivery_id, location_id, receiver_membership_id, receiver_user_id, received_at, quantity_received, unit, operation_id)
      VALUES (${rid}, ${orgA}, ${d.id}, ${c1}, ${mid.id}, ${mid.uid}, now(), 90, 'KG', ${randomUUID()})`.execute(h.db);
    await sql`INSERT INTO weighings (id, organization_id, reception_id, method, quantity, unit, weighed_on, responsible_membership_id, responsible_user_id) VALUES (${randomUUID()}, ${orgA}, ${rid}, 'Báscula', 90, 'KG', current_date, ${mid.id}, ${mid.uid})`.execute(h.db);
    const rec0 = (await http().get(`${base(orgA)}/inventory/reconciliation`).set(as(ADMIN)).expect(200)).body;
    expect(rec0.consistent).toBe(false);
    expect(rec0.differences).toEqual([expect.objectContaining({ kind: 'reception', id: rid, expected: '90.000000', ledger: '0' })]);
    await http().post(`${base(orgA)}/inventory/incorporate`).set(as(TRAZ)).expect(403);
    const first = (await http().post(`${base(orgA)}/inventory/incorporate`).set(as(ADMIN)).expect(201)).body;
    expect(first.created).toEqual({ RECEPTION_IN: 1 });
    expect(first.reconciliation).toMatchObject({ consistent: true });
    const again = (await http().post(`${base(orgA)}/inventory/incorporate`).set(as(ADMIN)).expect(201)).body;
    expect(again.created).toEqual({}); // repetir no duplica
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM stock_movements WHERE source_id = ${rid}`.execute(h.db)).rows[0].n).toBe(1);
    // corrección de peso (sin asignación): solo la diferencia en el ledger; el original se conserva
    const r = await reception('100');
    const del = await h.db.selectFrom('receptions').select('delivery_id').where('id', '=', r).executeTakeFirstOrThrow();
    await http().post(`${base(orgA)}/deliveries/${del.delivery_id}/receptions/${r}/corrections`).set(as(ADMIN)).send({ operation_id: randomUUID(), expected_version: 1, reason: 'Repesaje', weighing: { method: 'B', quantity: '97.5', unit: 'KG', weighed_on: today } }).expect(201);
    const lines = (await sql<{ t: string; q: string }>`SELECT m.movement_type AS t, e.signed_quantity::text AS q FROM stock_movements m JOIN stock_entries e ON e.movement_id = m.id WHERE e.reception_id = ${r} ORDER BY m.recorded_at`.execute(h.db)).rows;
    expect(lines).toEqual([{ t: 'RECEPTION_IN', q: '100.000000' }, { t: 'RECEPTION_CORRECTION', q: '-2.500000' }]);
    expect((await http().get(`${base(orgA)}/inventory/reconciliation`).set(as(ADMIN)).expect(200)).body.consistent).toBe(true);
  });

  it('aislamiento y permisos en saldos, movimientos y filtros; recepciones ocultas sin conteos para quien no lee entregas', async () => {
    const { out } = await processed('50', '45', '5');
    await http().get(`${base(orgA)}/inventory/balances`).set(as('admin-b@test.local')).expect(404);
    expect((await balances('admin-b@test.local', orgB)).lots).toEqual([]);
    await http().post(`${base(orgB)}/inventory/losses`).set(as('admin-b@test.local')).send({ operation_id: randomUUID(), lot_id: out, location_id: cB, quantity: '1', reason: 'cruce' }).expect(404);
    await post('losses', { lot_id: out, location_id: c1, quantity: '1', reason: 'x x x' }, 'auditor@test.local').expect(403);
    await post('transfers', { lot_id: out, from_location_id: c1, to_location_id: c2, quantity: '1' }, 'recepcion@test.local').expect(403);
    expect((await balances('auditor@test.local')).lots.length).toBeGreaterThan(0);
    // sin delivery:read: ve lotes, no recepciones ni movimientos que solo tocan recepciones
    const r = await reception('10');
    const ex = await balances('export@test.local');
    expect(ex.receptions_without_lot).toEqual([]);
    expect(JSON.stringify(ex)).not.toMatch(/ENT-|IN-1/);
    const mv = (await http().get(`${base(orgA)}/inventory/movements`).set(as('export@test.local')).expect(200)).body;
    expect(mv.every((m: { movement_type: string }) => m.movement_type !== 'RECEPTION_IN')).toBe(true);
    expect(JSON.stringify(mv)).not.toContain(r);
    const filtered = (await http().get(`${base(orgA)}/inventory/movements?lot_id=${out}`).set(as(ADMIN)).expect(200)).body;
    expect(filtered.every((m: { lines: Array<{ holder: string }> }) => m.lines.some((l) => l.holder.startsWith('Lote ')))).toBe(true);
    await http().get(`${base(orgA)}/inventory/reconciliation`).set(as('auditor@test.local')).expect(403);
  });

  it('revisión P0-017: ajuste positivo marcado sin origen ni calidad; alcance de totales y conciliación; STORAGE con compuerta KDE guardada y bloqueo real', async () => {
    // lote «Origen incompleto»: el ajuste positivo se admite y queda identificado como cantidad sin trazabilidad
    const d = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: '40', unit: 'KG', register: true }).expect(201)).body.delivery;
    const r = (await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: c1, received_at: new Date().toISOString(), weighing: { method: 'B', quantity: '40', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    const lot = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r, quantity: '40' }] }).expect(201)).body.lot;
    expect(lot.origin.status).toBe('INCOMPLETE');
    const adj = (await post('adjustments', { lot_id: lot.id, location_id: c1, quantity: '1.5', reason: 'Sobrante de conteo' }, ADMIN).expect(201)).body;
    expect(adj.lot.quantities).toMatchObject({ physical: '41.5', adjustments: { added: '1.5', added_traceability: 'PENDING', note: expect.stringMatching(/sin origen, evidencia ni calidad/) } });
    const hub = (await http().get(`${base(orgA)}/lots/${lot.id}`).set(as(ADMIN)).expect(200)).body;
    expect(hub.quantities.adjustments.added).toBe('1.5');
    expect(hub.inputs.every((i: { quantity: { value: string } }) => i.quantity.value === '40')).toBe(true); // el ajuste no se atribuye a una recepción
    const mv = await sql<{ reason: string; actor_id: string }>`SELECT reason, actor_id FROM stock_movements WHERE movement_type = 'ADJUSTMENT' AND reference->>'lot_id' = ${lot.id}`.execute(h.db);
    expect(mv.rows[0].reason).toBe('Sobrante de conteo');
    expect(mv.rows[0].actor_id).toBeTruthy();
    // alcance: los totales de quien no lee entregas no incluyen material de recepciones ocultas
    await reception('7'); // material recibido sin lote, oculto para quien no lee entregas
    const ex = (await http().get(`${base(orgA)}/inventory/balances`).set(as('export@test.local')).expect(200)).body;
    const sum = ex.lots.reduce((a: number, x: { physical: string }) => a + Number(x.physical), 0);
    expect(Number(ex.totals.physical)).toBeCloseTo(sum, 6);
    const adminB = (await http().get(`${base(orgA)}/inventory/balances`).set(as(ADMIN)).expect(200)).body;
    expect(Number(adminB.totals.physical)).toBeGreaterThan(Number(ex.totals.physical)); // el administrador ve también el material sin lote
    // conciliación: exige alcance de organización completo aunque se tenga el permiso
    const orig = AuthorizationService.prototype.tenantContext;
    jest.spyOn(AuthorizationService.prototype, 'tenantContext').mockImplementation(async function (this: AuthorizationService, user, orgId) {
      const ctx = await orig.call(this, user, orgId);
      return ctx && user.email === 'export@test.local' ? { ...ctx, permissions: [...ctx.permissions, 'stock:incorporate'] } : ctx;
    });
    expect((await http().get(`${base(orgA)}/inventory/reconciliation`).set(as('export@test.local')).expect(403)).body.error.message).toMatch(/alcance de toda la organización/);
    jest.restoreAllMocks();
    // STORAGE: cada movimiento guarda su compuerta STOCK_MOVEMENT con los KDE evaluados
    const tr = (await post('transfers', { lot_id: lot.id, from_location_id: c1, to_location_id: c2, quantity: '10' }).expect(201)).body;
    const gates = (await sql<{ allowed: boolean; result: { direction: string; checked: string[] } }>`SELECT allowed, result FROM gate_evaluations WHERE entity_type = 'stock_movement' AND entity_id = ${tr.movement_id} ORDER BY evaluated_at`.execute(h.db)).rows;
    expect(gates.map((g) => g.result.direction).sort()).toEqual(['IN', 'OUT']);
    expect(gates.every((g) => g.allowed && g.result.checked.includes('STORAGE_LOCATION'))).toBe(true);
    const ev = await h.db.selectFrom('domain_events').select('payload').where('event_type', '=', 'StockMovementRecorded').where('aggregate_id', '=', lot.id).execute();
    expect(ev.map((e) => (e.payload as { movement_type: string }).movement_type)).toEqual(expect.arrayContaining(['ADJUSTMENT', 'TRANSFER']));
    // la compuerta bloquea de verdad: sin ubicación o sin dirección válida, el movimiento no pasa (datos mínimos no opcionales)
    const kde = h.app.get(KdeService);
    const member = await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', TRAZ).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow();
    const ctx = { organizationId: orgA, organizationStatus: 'ACTIVE' as const, membershipId: member.id, roles: ['TRACEABILITY_MANAGER'], permissions: ['lot:read', 'location:read'] as never };
    const blocked = await kde.evaluateTransition(ctx, 'STOCK_MOVEMENT', { STORAGE_LOT: lot.id, STORAGE_LOCATION: null, STORAGE_QUANTITY: { value: '1', unit: 'KG' }, STORAGE_DIRECTION: 'SIDEWAYS', STORAGE_RESPONSIBLE: member.id });
    expect(blocked.allowed).toBe(false);
    expect(blocked.blocking.map((b) => b.code).sort()).toEqual(['STORAGE_DIRECTION', 'STORAGE_LOCATION']);
  });
});
