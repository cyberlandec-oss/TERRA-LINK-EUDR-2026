import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { AuditService } from '../src/audit/audit.service';

// Integración P0-016 Lotes y procesos con PostgreSQL real. Datos SINTÉTICOS. Reglas D-39 adoptadas para desarrollo local.
describeDb('P0-016 lotes, asignaciones, procesos y grafo de origen', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let pKnown: string;
  let pUnknown: string;
  let plot: string;
  let baba: string;
  let fermentado: string;
  let seco: string;
  let center: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const now = () => new Date().toISOString();
  const ADMIN = 'admin-a@test.local';
  const TRAZ = 'traz@test.local';

  async function join(o: string, email: string, role: string, admin = ADMIN) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  /** Entrega registrada + recepción confirmada; devuelve el id de la recepción. */
  async function reception(q: string, opts: { producer?: string; product?: string; origin?: boolean } = {}) {
    const producer = opts.producer ?? pKnown;
    const d = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: opts.product ?? baba, delivery_date: today,
      quantity_declared: q, unit: 'KG', origins: opts.origin === false || producer === pUnknown ? [] : [{ plot_id: plot }], register: true }).expect(201)).body.delivery;
    return (await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: center, received_at: now(),
      weighing: { method: 'Báscula (sintética)', quantity: q, unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id as string;
  }
  const createLot = (actor: string, inputs: Array<{ reception_id: string; quantity: string }>) => http().post(`${base(orgA)}/lots`).set(as(actor)).send({ operation_id: randomUUID(), inputs });
  const run = async (type: 'FERMENTATION' | 'DRYING', product = fermentado, actor = TRAZ) => (await http().post(`${base(orgA)}/process-runs`).set(as(actor)).send({ operation_id: randomUUID(), process_type: type, output_product_id: product }).expect(201)).body.run;
  const start = (id: string, inputs: Array<{ lot_id: string; quantity: string }>, actor = TRAZ, op = randomUUID()) => http().post(`${base(orgA)}/process-runs/${id}/start`).set(as(actor)).send({ operation_id: op, started_at: now(), inputs });
  const close = (id: string, outputs: string[], loss: string, actor = TRAZ, op = randomUUID(), extra: Record<string, unknown> = {}) =>
    http().post(`${base(orgA)}/process-runs/${id}/close`).set(as(actor)).send({ operation_id: op, closed_at: new Date(Date.now() + 1000).toISOString(), outputs: outputs.map((quantity) => ({ quantity })), loss_quantity: loss, ...extra });
  const lot = async (id: string, actor = ADMIN) => (await http().get(`${base(orgA)}/lots/${id}`).set(as(actor)).expect(200)).body;

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0); // un solo servidor escuchando: las solicitudes concurrentes comparten dirección (supertest)
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Lotes A', ADMIN);
    orgB = await mk('Coop Lotes B', 'admin-b@test.local');
    for (const [e, r] of [[TRAZ, 'TRACEABILITY_MANAGER'], ['gerente@test.local', 'MANAGER'], ['calidad@test.local', 'QUALITY_OPERATOR'], ['auditor@test.local', 'AUDITOR'], ['export@test.local', 'EXPORT_MANAGER'], ['recepcion@test.local', 'RECEPTION_OPERATOR']]) await join(orgA, e, r);
    pKnown = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'LT-1', legal_name: 'Finca Lotes Uno' }).expect(201)).body.id;
    pUnknown = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'LT-2', legal_name: 'Finca Lotes Dos' }).expect(201)).body.id;
    plot = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: pKnown, plot_code: 'LT-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    const product = async (code: string, name: string) => (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code, name, product_state: code, unit: 'KG' }).expect(201)).body.id;
    baba = await product('CACAO_BABA', 'Cacao en baba');
    fermentado = await product('CACAO_FERMENTADO', 'Cacao fermentado');
    seco = await product('CACAO_SECO', 'Cacao seco');
    center = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CL-01', name: 'Centro lotes', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());
  afterEach(() => jest.restoreAllMocks());

  it('asignaciones parciales con referencias exactas; sin superar lo disponible; origen incompleto separado; sin mezclar productos', async () => {
    const r1 = await reception('300');
    const l = (await createLot('recepcion@test.local', [{ reception_id: r1, quantity: '120' }]).expect(201)).body.lot;
    expect(l).toMatchObject({ source: 'RECEPTIONS', status: 'OPEN', origin: { status: 'COMPLETE' }, quantities: { base: '120', available: '120', unit: 'KG' }, quality: { status: 'PENDING_EVALUATION' } });
    expect(l.quantities).toMatchObject({ physical: '120', reserved: '0', available: '120' }); // ledger: única fuente
    expect(l.quantities.note).toMatch(/Reservar no reduce la existencia/);
    const w = await h.db.selectFrom('weighings').select('id').where('reception_id', '=', r1).executeTakeFirstOrThrow();
    expect(l.inputs[0]).toMatchObject({ reception_id: r1, weighing_id: w.id, reception_version: 1, quantity: { value: '120' }, origin_known: true });
    const second = (await http().post(`${base(orgA)}/lots/${l.id}/inputs`).set(as('recepcion@test.local')).send({ operation_id: randomUUID(), reception_id: r1, quantity: '180' }).expect(201)).body.lot;
    expect(second.quantities.base).toBe('300');
    expect((await http().post(`${base(orgA)}/lots/${l.id}/inputs`).set(as('recepcion@test.local')).send({ operation_id: randomUUID(), reception_id: r1, quantity: '0.000001' }).expect(409)).body.error.code).toBe('INSUFFICIENT_AVAILABLE');
    // origen desconocido: lote separado «Origen incompleto»; no se mezcla
    const ru = await reception('100', { producer: pUnknown });
    const lu = (await createLot(ADMIN, [{ reception_id: ru, quantity: '100' }]).expect(201)).body.lot;
    expect(lu.origin).toMatchObject({ status: 'INCOMPLETE', label: 'Origen incompleto' });
    const rk = await reception('50');
    expect((await http().post(`${base(orgA)}/lots/${lu.id}/inputs`).set(as(ADMIN)).send({ operation_id: randomUUID(), reception_id: rk, quantity: '10' }).expect(422)).body.error.code).toBe('ORIGIN_MIXING_BLOCKED');
    expect((await createLot(ADMIN, [{ reception_id: rk, quantity: '10' }, { reception_id: (await reception('20', { producer: pUnknown })), quantity: '5' }]).expect(422)).body.error.code).toBe('ORIGIN_MIXING_BLOCKED');
    const rs = await reception('40', { product: seco });
    expect((await http().post(`${base(orgA)}/lots/${second.id}/inputs`).set(as(ADMIN)).send({ operation_id: randomUUID(), reception_id: rs, quantity: '10' }).expect(422)).body.error.code).toBe('PRODUCT_MISMATCH');
    // red de seguridad en base (P0-017: el ledger es la única fuente): sacar de la recepción más de lo que tiene falla al confirmar
    await expect(h.db.transaction().execute(async (trx) => {
      const mid = randomUUID();
      await sql`INSERT INTO stock_movements (id, organization_id, movement_type, source_type, source_id, operation_id, actor_id) VALUES (${mid}, ${orgA}, 'LOT_ASSIGN', NULL, NULL, ${randomUUID()}, NULL)`.execute(trx);
      await sql`INSERT INTO stock_entries (id, organization_id, movement_id, reception_id, location_id, bucket, signed_quantity, unit) VALUES (${randomUUID()}, ${orgA}, ${mid}, ${r1}, ${center}, 'PHYSICAL', -1, 'KG')`.execute(trx);
    })).rejects.toThrow(/doble consumo o saldo negativo/);
    await expect(sql`UPDATE lot_inputs SET quantity = 1 WHERE lot_id = ${l.id}`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('asignaciones concurrentes sin exceso; corrección compitiendo con asignación; liberar y luego corregir conservando el historial', async () => {
    const r = await reception('100');
    const l1 = (await createLot(ADMIN, [{ reception_id: r, quantity: '10' }]).expect(201)).body.lot;
    const assign = (q: string) => http().post(`${base(orgA)}/lots/${l1.id}/inputs`).set(as(ADMIN)).send({ operation_id: randomUUID(), reception_id: r, quantity: q });
    const [a, b] = await Promise.all([assign('60'), assign('60')]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await lot(l1.id)).quantities.base).toBe('70');
    // corrección bloqueada con asignación activa
    const del = await h.db.selectFrom('receptions').select('delivery_id').where('id', '=', r).executeTakeFirstOrThrow();
    const correct = (q: string, v = 1) => http().post(`${base(orgA)}/deliveries/${del.delivery_id}/receptions/${r}/corrections`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), expected_version: v, reason: 'Repesaje', weighing: { method: 'Báscula', quantity: q, unit: 'KG', weighed_on: today } });
    expect((await correct('95').expect(409)).body.error.code).toBe('RECEPTION_ASSIGNED_TO_LOT');
    // carrera: otra recepción, corrección y asignación al mismo tiempo → nunca ambas con efecto incoherente
    const r2 = await reception('100');
    const del2 = await h.db.selectFrom('receptions').select('delivery_id').where('id', '=', r2).executeTakeFirstOrThrow();
    const l2 = (await createLot(ADMIN, [{ reception_id: (await reception('5')), quantity: '5' }]).expect(201)).body.lot;
    const [c, s] = await Promise.all([
      http().post(`${base(orgA)}/deliveries/${del2.delivery_id}/receptions/${r2}/corrections`).set(as(ADMIN)).send({ operation_id: randomUUID(), expected_version: 1, reason: 'Repesaje', weighing: { method: 'B', quantity: '40', unit: 'KG', weighed_on: today } }),
      http().post(`${base(orgA)}/lots/${l2.id}/inputs`).set(as(ADMIN)).send({ operation_id: randomUUID(), reception_id: r2, quantity: '90' }),
    ]);
    const assigned = (await h.db.selectFrom('lot_inputs').select(sql<string>`coalesce(sum(quantity),0)::text`.as('q')).where('reception_id', '=', r2).executeTakeFirstOrThrow()).q;
    const current = (await sql<{ q: string }>`SELECT reception_current_quantity(${r2})::text AS q`.execute(h.db)).rows[0].q;
    expect(Number(assigned)).toBeLessThanOrEqual(Number(current)); // nunca asignado > peso vigente
    expect([c.status, s.status]).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(c.status === 201 && s.status === 201).toBe(false); // corrigió a 40 y asignó 90: imposible a la vez
    // liberar por completo (sin reservas ni consumo) → la corrección vuelve a permitirse, con historial
    const detail = await lot(l1.id);
    for (const i of detail.inputs) await http().post(`${base(orgA)}/lots/${l1.id}/inputs/${i.id}/release`).set(as(TRAZ)).send({ operation_id: randomUUID(), reason: 'Asignación equivocada' }).expect(200);
    await http().post(`${base(orgA)}/lots/${l1.id}/inputs/${detail.inputs[0].id}/release`).set(as('gerente@test.local')).send({ operation_id: randomUUID(), reason: 'x x x' }).expect(403);
    expect((await correct('95').expect(201)).body.delivery.receptions[0].quantity_received.value).toBe('95');
    const after = await lot(l1.id);
    expect(after.quantities.base).toBe('0');
    expect(after.inputs.every((i: { released: unknown }) => i.released)).toBe(true); // historia conservada
  });

  it('fermentación: reserva, reservas concurrentes, balance 800 → 750 + 50, rechazo de excesos, doble cierre y reintento; transformación con evento y rendimiento', async () => {
    const lotA = (await createLot(ADMIN, [{ reception_id: await reception('500'), quantity: '500' }, { reception_id: await reception('300'), quantity: '300' }]).expect(201)).body.lot;
    expect(lotA.quantities.base).toBe('800');
    const f = await run('FERMENTATION');
    const g = await run('FERMENTATION');
    const [s1, s2] = await Promise.all([start(f.id, [{ lot_id: lotA.id, quantity: '800' }]), start(g.id, [{ lot_id: lotA.id, quantity: '800' }])]);
    expect([s1.status, s2.status].sort()).toEqual([200, 409]);
    const winner = s1.status === 200 ? f : g;
    const loser = s1.status === 200 ? g : f;
    expect((await lot(lotA.id)).quantities).toMatchObject({ reserved: '800', available: '0' });
    await http().post(`${base(orgA)}/process-runs/${loser.id}/cancel`).set(as(TRAZ)).send({ operation_id: randomUUID(), reason: 'Sin material' }).expect(200);
    // excesos y faltantes rechazados (sin tolerancia)
    for (const [outs, loss] of [[['760'], '50'], [['750'], '60'], [['900'], '0'], [['750'], '49.999999']] as const) expect((await close(winner.id, [...outs], loss).expect(422)).body.error.code).toBe('BALANCE_MISMATCH');
    await close(winner.id, ['750'], '50', 'calidad@test.local').expect(403);
    // doble cierre concurrente con el mismo identificador y con distinto: un solo consumo y una sola salida
    const op = randomUUID();
    const [c1, c2, c3] = await Promise.all([close(winner.id, ['750'], '50', TRAZ, op), close(winner.id, ['750'], '50', TRAZ, op), close(winner.id, ['750'], '50')]);
    expect([c1.status, c2.status, c3.status].filter((x) => x === 200).length).toBeGreaterThanOrEqual(1);
    const retry = (await close(winner.id, ['750'], '50', TRAZ, op).expect(200)).body;
    expect(retry.replayed).toBe(true);
    const closed = retry.run;
    expect(closed).toMatchObject({ status: 'CLOSED', balance: { input: '800', output: '750', loss: '50', unit: 'KG', mass_yield_percent: '93.75' } });
    expect(closed.outputs).toHaveLength(1);
    expect(await h.db.selectFrom('process_outputs').select(sql<number>`count(*)::int`.as('n')).where('run_id', '=', winner.id).executeTakeFirstOrThrow()).toEqual({ n: 1 });
    expect((await lot(lotA.id)).quantities).toMatchObject({ reserved: '0', consumed: '800', available: '0' });
    // transformación (P0-011): baba → fermentado, con evento y rendimiento en masa; origen y calidad conservados
    const out = await lot(closed.outputs[0].lot_id);
    expect(out).toMatchObject({ source: 'PROCESS_OUTPUT', product: { code: 'CACAO_FERMENTADO' }, origin: { status: 'COMPLETE' }, quality: { status: 'PENDING_EVALUATION' }, quantities: { base: '750', available: '750' } });
    const ev = await h.db.selectFrom('domain_events').select('payload').where('event_type', '=', 'ProcessingRunClosed').where('aggregate_id', '=', winner.id).execute();
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ process_type: 'FERMENTATION', input_product_id: baba, output_product_id: fermentado, loss_quantity: '50', mass_yield: { output_kg: '750', input_kg: '800', basis: 'MASS_KG' } });
    // upstream: lote padre y recepciones → entregas → productor/parcela; downstream desde el padre
    expect(out.upstream.lots.map((x: { lot_code: string }) => x.lot_code)).toEqual([lotA.lot_code]);
    expect(out.upstream.receptions).toHaveLength(2);
    expect(out.upstream.receptions[0]).toMatchObject({ producer_code: 'LT-1', plots: ['LT-1-P1'], origin_known: true });
    expect(out.upstream.note).toMatch(/cálculo, no identificación física/);
    expect((await lot(lotA.id)).downstream.map((x: { lot_code: string }) => x.lot_code)).toEqual([out.lot_code]);
    // un lote de salida no admite asignaciones posteriores (los enlaces solo los crea el cierre)
    expect((await http().post(`${base(orgA)}/lots/${out.id}/inputs`).set(as(ADMIN)).send({ operation_id: randomUUID(), reception_id: await reception('10'), quantity: '10' }).expect(409)).body.error.code).toBe('LOT_CLOSED_FOR_INPUT');
    // proceso cerrado no cambia
    await expect(sql`UPDATE process_runs SET status = 'RUNNING' WHERE id = ${winner.id}`.execute(h.db)).rejects.toThrow(/no cambia/);
  });

  it('cancelación libera reservas; rollback completo de un cierre fallido; liberar asignación bloqueado con reservas', async () => {
    const l = (await createLot(ADMIN, [{ reception_id: await reception('200'), quantity: '200' }]).expect(201)).body.lot;
    const f = await run('FERMENTATION');
    await start(f.id, [{ lot_id: l.id, quantity: '150' }]).expect(200);
    expect((await lot(l.id)).quantities).toMatchObject({ reserved: '150', available: '50' });
    expect((await http().post(`${base(orgA)}/lots/${l.id}/inputs/${(await lot(l.id)).inputs[0].id}/release`).set(as(TRAZ)).send({ operation_id: randomUUID(), reason: 'No se puede' }).expect(409)).body.error.code).toBe('LOT_HAS_RESERVATIONS');
    const counts = async () => (await sql<{ o: number; e: number; l: number; ev: number }>`SELECT (SELECT count(*)::int FROM process_outputs) o, (SELECT count(*)::int FROM lot_edges) e, (SELECT count(*)::int FROM lots) l, (SELECT count(*)::int FROM domain_events) ev`.execute(h.db)).rows[0];
    const before = await counts();
    jest.spyOn(AuditService.prototype, 'record').mockRejectedValueOnce(new Error('fallo forzado'));
    await close(f.id, ['140'], '10').expect(500);
    expect(await counts()).toEqual(before);
    expect((await http().get(`${base(orgA)}/process-runs/${f.id}`).set(as(TRAZ)).expect(200)).body.status).toBe('RUNNING');
    const c = (await http().post(`${base(orgA)}/process-runs/${f.id}/cancel`).set(as(TRAZ)).send({ operation_id: randomUUID(), reason: 'Proceso suspendido' }).expect(200)).body.run;
    expect(c.status).toBe('CANCELLED');
    expect(c.inputs[0].effect).toBe('RELEASED');
    expect((await lot(l.id)).quantities).toMatchObject({ reserved: '0', available: '200' });
    await close(f.id, ['150'], '0').expect(409);
  });

  // D-32 adoptada (2026-10-15): el secado ya cierra, con la humedad como medición obligatoria en %BH.
  it('secado: se prepara, inicia y CIERRA con humedad medida; la humedad no convierte masas; DRYING queda integrada', async () => {
    const l = (await createLot(ADMIN, [{ reception_id: await reception('100'), quantity: '100' }]).expect(201)).body.lot;
    const d = await run('DRYING', seco);
    const started = (await start(d.id, [{ lot_id: l.id, quantity: '100' }]).expect(200)).body.run;
    expect(started.status).toBe('RUNNING');
    expect(started.gates[0].pending.map((p: { code: string }) => p.code)).toEqual(['DRYING_MOISTURE']); // pendiente al iniciar, no opcional
    // Sin humedad no se cierra: el dato es exigido por el contrato, ya no por una decisión pendiente.
    const sinHumedad = (await close(d.id, ['60'], '40').expect(422)).body.error;
    expect(sinHumedad.details.map((x: { field: string }) => x.field)).toContain('DRYING_MOISTURE');
    expect(sinHumedad.details.map((x: { reason: string }) => x.reason)).not.toContain('DECISION_PENDING');
    // Balance exacto en KG: 100 = 60 + 40. La humedad se registra; no corrige el balance.
    const cerrado = (await close(d.id, ['60'], '40', TRAZ, randomUUID(), { moisture: { value: '7.25', unit: '%BH', method: 'Medidor portátil (sintético)' } }).expect(200)).body.run;
    expect(cerrado.status).toBe('CLOSED');
    expect({ ...cerrado.balance, input: Number(cerrado.balance.input), output: Number(cerrado.balance.output), loss: Number(cerrado.balance.loss) })
      .toMatchObject({ input: 100, output: 60, loss: 40, unit: 'KG' });
    expect(cerrado.balance.note).toMatch(/No es base seca/);
    // La precisión recibida se conserva: 7.25 se guarda como 7.25, y «7.3» es solo la presentación con un decimal.
    expect(Number(cerrado.moisture.value)).toBe(7.25);
    expect(cerrado.moisture).toMatchObject({ unit: '%BH', display: '7.3', method: 'Medidor portátil (sintético)' });
    expect(cerrado.moisture.note).toMatch(/base húmeda/);
    const cat = (await http().get(`${base(orgA)}/cte-catalog`).set(as(ADMIN)).expect(200)).body.definitions;
    expect(cat.find((x: { code: string }) => x.code === 'FERMENTATION').operations[0].integration_status).toBe('INTEGRATED');
    expect(cat.find((x: { code: string }) => x.code === 'DRYING').operations[0].integration_status).toBe('INTEGRATED');
  });

  it('ciclos imposibles también por enlaces posteriores; aislamiento y permisos; consultas sin nodos ocultos ni conteos', async () => {
    const l = (await createLot(ADMIN, [{ reception_id: await reception('100'), quantity: '100' }]).expect(201)).body.lot;
    const f = await run('FERMENTATION');
    await start(f.id, [{ lot_id: l.id, quantity: '100' }]).expect(200);
    const out = (await close(f.id, ['90'], '10').expect(200)).body.run.outputs[0].lot_id;
    // enlace posterior que cerraría un ciclo (salida → su propio padre) o a sí mismo: rechazado por la base
    await expect(sql`INSERT INTO lot_edges (id, organization_id, parent_lot_id, child_lot_id, run_id, quantity, unit) VALUES (gen_random_uuid(), ${orgA}, ${out}, ${l.id}, ${f.id}, 1, 'KG')`.execute(h.db)).rejects.toThrow(/ciclo/);
    await expect(sql`INSERT INTO lot_edges (id, organization_id, parent_lot_id, child_lot_id, run_id, quantity, unit) VALUES (gen_random_uuid(), ${orgA}, ${out}, ${out}, ${f.id}, 1, 'KG')`.execute(h.db)).rejects.toThrow();
    await expect(sql`DELETE FROM lot_edges WHERE child_lot_id = ${out}`.execute(h.db)).rejects.toThrow(/append-only/);
    // aislamiento
    await http().get(`${base(orgA)}/lots/${l.id}`).set(as('admin-b@test.local')).expect(404);
    await http().get(`${base(orgB)}/lots/${l.id}`).set(as('admin-b@test.local')).expect(404);
    await http().post(`${base(orgB)}/process-runs/${f.id}/cancel`).set(as('admin-b@test.local')).send({ operation_id: randomUUID(), reason: 'cruce' }).expect(404);
    // permisos por acción
    const r = await reception('30');
    await createLot('calidad@test.local', [{ reception_id: r, quantity: '10' }]).expect(403);
    await createLot('auditor@test.local', [{ reception_id: r, quantity: '10' }]).expect(403);
    await createLot('gerente@test.local', [{ reception_id: r, quantity: '10' }]).expect(201); // D-39.4: MANAGER crea lotes
    await http().post(`${base(orgA)}/process-runs`).set(as('gerente@test.local')).send({ operation_id: randomUUID(), process_type: 'FERMENTATION', output_product_id: fermentado }).expect(403);
    await http().post(`${base(orgA)}/process-runs`).set(as('calidad@test.local')).send({ operation_id: randomUUID(), process_type: 'DRYING', output_product_id: seco }).expect(403);
    expect((await lot(out, 'auditor@test.local')).actions).toMatchObject({ assign: false, release_input: false });
    // sin delivery:read (gestor de exportación) ve el grafo de lotes pero no las recepciones/productores, sin conteos ni marcadores
    const ex = await lot(out, 'export@test.local');
    expect(ex.upstream.lots).toHaveLength(1);
    expect(ex.upstream.receptions).toEqual([]);
    expect(JSON.stringify(ex)).not.toMatch(/LT-1|Finca|hidden|oculto|restricted_count/);
    const exParent = await lot(l.id, 'export@test.local');
    expect(exParent.inputs).toEqual([]);
    // auditoría consultable por alcance
    const audit = (await http().get(`${base(orgA)}/audit-logs?entity_type=process_run&entity_id=${f.id}`).set(as('auditor@test.local')).expect(200)).body;
    expect(audit.items.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(['process.create', 'process.start', 'process.close']));
  });
});
