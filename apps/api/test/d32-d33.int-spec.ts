import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// D-32 (humedad del secado) y D-33 (cierre de entregas), adoptadas como reglas provisionales del MVP local el
// 2026-10-15. Datos SINTÉTICOS contra PostgreSQL real.
//
// Lo que estas pruebas fijan, más allá de que «funcione»:
// - la precisión de una medición **no se redondea en silencio**: si excede lo que se conserva, se rechaza;
// - cerrar una entrega con diferencia **está permitido**; lo que no está permitido es dejarla sin motivo;
// - un motivo **nunca se sustituye**: una corrección posterior añade una justificación y conserva la anterior.
describeDb('D-32 humedad y D-33 cierre de entregas (reglas provisionales del MVP local)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let producer: string;
  let plot: string;
  let baba: string;
  let seco: string;
  let centro: string;
  const ADMIN = 'admin-a@test.local';
  const REC = 'recepcion@test.local';
  const TRAZ = 'traz@test.local';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const A = () => base(orgA);
  const today = new Date().toISOString().slice(0, 10);
  const op = () => randomUUID();
  const num = (q: { value: string }) => Number(q.value);

  async function join(o: string, email: string, role: string, admin = ADMIN) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  /** Entrega registrada con `declarada` kg y una recepción de `recibida` kg. */
  async function entrega(declarada: string, recibida?: string) {
    const d = (await http().post(`${A()}/deliveries`).set(as(ADMIN)).send({
      operation_id: op(), producer_id: producer, product_id: baba, delivery_date: today,
      quantity_declared: declarada, unit: 'KG', origins: [{ plot_id: plot }], register: true,
    }).expect(201)).body.delivery;
    let reception: string | null = null;
    if (recibida) {
      reception = (await http().post(`${A()}/deliveries/${d.id}/receptions`).set(as(REC)).send({
        operation_id: op(), location_id: centro, received_at: new Date().toISOString(),
        weighing: { method: 'Báscula sintética', quantity: recibida, unit: 'KG', weighed_on: today },
      }).expect(201)).body.reception_id;
    }
    return { id: d.id as string, reception };
  }
  const ver = async (id: string, actor = ADMIN) => (await http().get(`${A()}/deliveries/${id}`).set(as(actor)).expect(200)).body;
  /** Cierra una entrega. La versión esperada se consulta antes, así que el estado se comprueba aquí dentro. */
  const cerrar = async (id: string, extra: Record<string, unknown> = {}, actor = ADMIN, status = 200) => {
    const res = await http().post(`${A()}/deliveries/${id}/close`).set(as(actor))
      .send({ operation_id: op(), expected_version: (await ver(id)).row_version, ...extra });
    expect({ estado: res.status, cuerpo: res.status === status ? null : res.body }).toEqual({ estado: status, cuerpo: null });
    return res;
  };
  const justificar = (id: string, reason: string, actor = ADMIN, operation = op()) =>
    http().post(`${A()}/deliveries/${id}/closure-justifications`).set(as(actor)).send({ operation_id: operation, reason });

  beforeAll(async () => {
    h = await setupHarness();
    // El helper de cierre consulta la versión mientras construye la petición: el servidor debe estar escuchando.
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop D32 A', ADMIN);
    orgB = await mk('Coop D32 B', 'admin-b@test.local');
    for (const [e, r] of [[REC, 'RECEPTION_OPERATOR'], [TRAZ, 'TRACEABILITY_MANAGER'], ['auditor@test.local', 'AUDITOR']] as const) await join(orgA, e, r);
    producer = (await http().post(`${A()}/producers`).set(as(ADMIN)).send({ producer_code: 'D32-1', legal_name: 'Finca sintética' }).expect(201)).body.id;
    plot = (await http().post(`${A()}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: 'D32-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    baba = (await http().post(`${A()}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    seco = (await http().post(`${A()}/products`).set(as(ADMIN)).send({ code: 'CACAO_SECO', name: 'Cacao seco', product_state: 'CACAO_SECO', unit: 'KG' }).expect(201)).body.id;
    centro = (await http().post(`${A()}/locations`).set(as(ADMIN)).send({ code: 'C1', name: 'Centro', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
  }, 120_000);
  afterAll(async () => h?.close());

  // ================================================================ D-32 · humedad

  describe('D-32 · humedad del secado', () => {
    /** Secado iniciado con `q` kg listo para cerrar. */
    async function secando(q = '100') {
      const e = await entrega(q, q);
      const lote = (await http().post(`${A()}/lots`).set(as(ADMIN)).send({ operation_id: op(), inputs: [{ reception_id: e.reception, quantity: q }] }).expect(201)).body.lot;
      const run = (await http().post(`${A()}/process-runs`).set(as(TRAZ)).send({ operation_id: op(), process_type: 'DRYING', output_product_id: seco }).expect(201)).body.run;
      await http().post(`${A()}/process-runs/${run.id}/start`).set(as(TRAZ)).send({ operation_id: op(), started_at: new Date().toISOString(), inputs: [{ lot_id: lote.id, quantity: q }] }).expect(200);
      return run.id as string;
    }
    const cerrarSecado = (id: string, moisture: unknown, outputs = ['60'], loss = '40') =>
      http().post(`${A()}/process-runs/${id}/close`).set(as(TRAZ)).send({ operation_id: op(), closed_at: new Date(Date.now() + 1000).toISOString(), outputs: outputs.map((quantity) => ({ quantity })), loss_quantity: loss, ...(moisture === undefined ? {} : { moisture }) });

    it('humedad presente: cierra con balance exacto, conserva método y responsable, y publica su evento', async () => {
      const run = await secando();
      const r = (await cerrarSecado(run, { value: '7.2', unit: '%BH', method: 'Medidor portátil' }).expect(200)).body.run;
      expect(r.status).toBe('CLOSED');
      expect({ i: Number(r.balance.input), o: Number(r.balance.output), l: Number(r.balance.loss) }).toEqual({ i: 100, o: 60, l: 40 });
      expect(r.moisture).toMatchObject({ unit: '%BH', method: 'Medidor portátil' });
      const fila = await h.db.selectFrom('process_runs').select(['moisture_value', 'moisture_unit', 'moisture_method', 'moisture_measured_by']).where('id', '=', run).executeTakeFirstOrThrow();
      expect(fila.moisture_measured_by).toBeTruthy(); // el responsable sale de la sesión, no del cuerpo
      const ev = await h.db.selectFrom('domain_events').select('event_type').where('aggregate_id', '=', run).where('event_type', '=', 'ProcessingRunClosed').executeTakeFirst();
      expect(ev).toBeTruthy();
    });

    it('humedad ausente: no cierra, y el motivo es el dato exigido, no una decisión pendiente', async () => {
      const run = await secando();
      const e = (await cerrarSecado(run, undefined).expect(422)).body.error;
      expect(e.code).toBe('TRANSITION_BLOCKED');
      expect(e.details.map((x: { field: string }) => x.field)).toContain('DRYING_MOISTURE');
      expect(e.details.map((x: { reason: string }) => x.reason)).not.toContain('DECISION_PENDING');
      expect((await http().get(`${A()}/process-runs/${run}`).set(as(TRAZ)).expect(200)).body.status).toBe('RUNNING');
    });

    it('humedad inválida: unidad ajena, negativa o por encima de 100 se rechazan', async () => {
      const run = await secando();
      // La unidad es parte del dato: un «%» suelto no dice en qué base.
      expect((await cerrarSecado(run, { value: '7.2', unit: '%', method: 'Medidor' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      const negativa = (await cerrarSecado(run, { value: '-1', unit: '%BH', method: 'Medidor' }).expect(422)).body.error;
      expect(negativa.details.map((x: { reason: string }) => x.reason)).toContain('MUST_BE_NON_NEGATIVE');
      const alta = (await cerrarSecado(run, { value: '101', unit: '%BH', method: 'Medidor' }).expect(422)).body.error;
      // El tope de 100 es estructural (un porcentaje de masa), no un límite de calidad.
      expect(alta.details.map((x: { reason: string }) => x.reason)).toContain('ABOVE_MAXIMUM');
      expect((await http().get(`${A()}/process-runs/${run}`).set(as(TRAZ)).expect(200)).body.status).toBe('RUNNING');
    });

    it('precisión excedida: se RECHAZA con su motivo; no se redondea en silencio', async () => {
      const run = await secando();
      const e = (await cerrarSecado(run, { value: '7.1234567', unit: '%BH', method: 'Laboratorio' }).expect(422)).body.error;
      expect(e.details.map((x: { reason: string }) => x.reason)).toContain('DECIMAL_PRECISION_EXCEEDED');
      expect(JSON.stringify(e)).toMatch(/No se redondea/);
      // Dentro de la capacidad, el valor se conserva íntegro: seis decimales entran tal cual.
      const r = (await cerrarSecado(run, { value: '7.123456', unit: '%BH', method: 'Laboratorio' }).expect(200)).body.run;
      expect(Number(r.moisture.value)).toBe(7.123456);
      expect(r.moisture.display).toBe('7.1'); // la presentación no sustituye al dato
    });
  });

  // ================================================================ D-33 · cierre de entregas

  describe('D-33 · cierre de entregas', () => {
    it('sin diferencia: cierra sin motivo y la entrega queda cerrada y justificada', async () => {
      const e = await entrega('100', '100');
      const d = (await cerrar(e.id)).body.delivery;
      expect(d.status).toBe('CLOSED');
      expect(d.totals.closure).toMatchObject({ status: 'CLOSED', stale: false });
      expect(num(d.totals.closure.current.difference as never)).toBe(0);
      expect(d.totals.closure.justifications).toHaveLength(1);
      expect(d.totals.closure.justifications[0].kind).toBe('CLOSE');
    });

    it('por debajo de lo declarado: cierra CON diferencia y motivo; sin motivo se rechaza', async () => {
      const e = await entrega('100', '90');
      const sin = (await cerrar(e.id, {}, ADMIN, 422)).body.error;
      expect(sin.code).toBe('DIFFERENCE_REASON_REQUIRED');
      expect(sin.message).toMatch(/Cerrar con diferencia está permitido/);
      expect((await ver(e.id)).status).toBe('REGISTERED');
      const d = (await cerrar(e.id, { reason: 'Merma de transporte verificada en el centro' })).body.delivery;
      expect(d.status).toBe('CLOSED');
      expect(num(d.totals.closure.current.difference as never)).toBe(10);
      expect(d.totals.closure.justifications[0].reason).toMatch(/Merma de transporte/);
    });

    it('por encima de lo declarado: también es diferencia y también exige motivo', async () => {
      const e = await entrega('100', '110');
      expect((await cerrar(e.id, {}, ADMIN, 422)).body.error.code).toBe('DIFFERENCE_REASON_REQUIRED');
      const d = (await cerrar(e.id, { reason: 'Llegó más de lo declarado: se pesó de nuevo en el centro' })).body.delivery;
      expect(num(d.totals.closure.current.difference as never)).toBe(-10);
      expect(d.totals.closure.status).toBe('CLOSED');
    });

    it('permisos: quien confirma recepciones cierra sin diferencia; con diferencia exige delivery:correct; el auditor nunca', async () => {
      const sinDif = await entrega('50', '50');
      await cerrar(sinDif.id, {}, REC); // reception:confirm basta cuando no hay nada que explicar
      const conDif = await entrega('50', '40');
      const r = await cerrar(conDif.id, { reason: 'Diferencia por humedad' }, REC, 403);
      expect(r.body.error.message).toMatch(/delivery:correct/);
      await cerrar(conDif.id, { reason: 'Diferencia por humedad' }, 'auditor@test.local', 403);
      await cerrar(conDif.id, { reason: 'Diferencia por humedad' }, ADMIN);
    });

    it('aislamiento: otra organización no cierra ni ve la entrega', async () => {
      const e = await entrega('30', '30');
      await http().post(`${A()}/deliveries/${e.id}/close`).set(as('admin-b@test.local')).send({ operation_id: op(), expected_version: 1 }).expect(404);
      await http().post(`${base(orgB)}/deliveries/${e.id}/close`).set(as('admin-b@test.local')).send({ operation_id: op(), expected_version: 1 }).expect(404);
    });

    it('doble envío y concurrencia: un solo cierre, una sola justificación', async () => {
      const e = await entrega('80', '80');
      const version = (await ver(e.id)).row_version;
      const operation = op();
      const enviar = () => http().post(`${A()}/deliveries/${e.id}/close`).set(as(ADMIN)).send({ operation_id: operation, expected_version: version });
      const [a, b] = await Promise.all([enviar(), enviar()]);
      expect([a.status, b.status].sort()).toEqual([200, 200]); // el reintento idéntico se reconoce, no duplica
      const filas = await h.db.selectFrom('delivery_closures').select('id').where('delivery_id', '=', e.id).execute();
      expect(filas).toHaveLength(1);
      // Una operación distinta sobre una entrega ya cerrada no la cierra dos veces.
      expect((await cerrar(e.id, {}, ADMIN, 409)).body.error.code).toBe('DELIVERY_ALREADY_CLOSED');
      // Y la versión esperada protege de escribir sobre un estado que ya cambió.
      const otra = await entrega('80', '80');
      expect((await http().post(`${A()}/deliveries/${otra.id}/close`).set(as(ADMIN)).send({ operation_id: op(), expected_version: 999 }).expect(409)).body.error.code).toBe('VERSION_CONFLICT');
    });

    it('rollback: un cierre rechazado no deja rastro', async () => {
      const e = await entrega('70', '60');
      await cerrar(e.id, {}, ADMIN, 422); // falta el motivo
      expect(await h.db.selectFrom('delivery_closures').select('id').where('delivery_id', '=', e.id).execute()).toHaveLength(0);
      expect((await ver(e.id)).status).toBe('REGISTERED');
    });

    // El cierre necesitó relajar el guardián de `deliveries` para permitir UNA transición. Esta prueba comprueba
    // que lo demás sigue igual de cerrado: la protección vive en la base, no en el caso de uso.
    it('el guardián de la base sigue protegiendo el registro histórico pese a admitir el cierre', async () => {
      const e = await entrega('60', '60');
      await cerrar(e.id);
      // Reabrir desde la propia base: imposible.
      await expect(sql`UPDATE deliveries SET status = 'REGISTERED', row_version = row_version + 1 WHERE id = ${e.id}`.execute(h.db))
        .rejects.toThrow(/no se modifica ni se reabre/);
      await expect(sql`UPDATE deliveries SET status = 'DRAFT', row_version = row_version + 1 WHERE id = ${e.id}`.execute(h.db))
        .rejects.toThrow(/no se modifica ni se reabre/);
      // Cambiar cualquier otro dato de una entrega cerrada: también imposible.
      await expect(sql`UPDATE deliveries SET notes = 'editada por fuera', row_version = row_version + 1 WHERE id = ${e.id}`.execute(h.db))
        .rejects.toThrow(/no se modifica ni se reabre/);
      // Y sobre una entrega REGISTRADA solo se admite cerrar: lo demás sigue exigiendo una corrección.
      const abierta = await entrega('60', '60');
      await expect(sql`UPDATE deliveries SET notes = 'editada por fuera', row_version = row_version + 1 WHERE id = ${abierta.id}`.execute(h.db))
        .rejects.toThrow(/registra una corrección/);
      // El historial de justificaciones es append-only: no se reescribe ni se borra.
      await expect(sql`UPDATE delivery_closures SET reason = 'otro motivo' WHERE delivery_id = ${e.id}`.execute(h.db))
        .rejects.toThrow(/append-only/);
      await expect(sql`DELETE FROM delivery_closures WHERE delivery_id = ${e.id}`.execute(h.db))
        .rejects.toThrow(/append-only/);
      expect((await ver(e.id)).status).toBe('CLOSED');
    });

    it('una entrega cerrada no admite recepciones nuevas ni se reabre', async () => {
      const e = await entrega('40', '40');
      await cerrar(e.id);
      const r = await http().post(`${A()}/deliveries/${e.id}/receptions`).set(as(REC)).send({
        operation_id: op(), location_id: centro, received_at: new Date().toISOString(),
        weighing: { method: 'Báscula', quantity: '5', unit: 'KG', weighed_on: today },
      }).expect(409);
      expect(r.body.error.code).toBe('DELIVERY_CLOSED');
      expect(r.body.error.message).toMatch(/registra otra entrega/);
      expect((await ver(e.id)).status).toBe('CLOSED');
    });

    it('corrección admitida tras el cierre: la justificación queda DESACTUALIZADA y la anterior se conserva', async () => {
      const e = await entrega('100', '90');
      await cerrar(e.id, { reason: 'Primera explicación: merma de transporte' });
      // Material libre: la corrección es admisible y cambia la diferencia.
      await http().post(`${A()}/deliveries/${e.id}/receptions/${e.reception}/corrections`).set(as(ADMIN))
        .send({ operation_id: op(), expected_version: 1, reason: 'Repesaje', weighing: { method: 'Báscula', quantity: '95', unit: 'KG', weighed_on: today } }).expect(201);
      const d = await ver(e.id);
      expect(d.status).toBe('CLOSED'); // sigue cerrada: desactualizado no es reabierto
      expect(d.totals.closure).toMatchObject({ status: 'CLOSED_JUSTIFICATION_STALE', stale: true });
      expect(num(d.totals.closure.current.difference as never)).toBe(5);
      expect(d.totals.closure.note).toMatch(/se conservan tal cual/);
      // Justificar de nuevo: la anterior NO se sustituye.
      const d2 = (await justificar(e.id, 'Tras el repesaje la diferencia real es de 5 kg').expect(201)).body.delivery;
      expect(d2.totals.closure.status).toBe('CLOSED');
      expect(d2.totals.closure.justifications).toHaveLength(2);
      expect(d2.totals.closure.justifications[0].reason).toMatch(/Primera explicación/);
      expect(num(d2.totals.closure.justifications[0].difference as never)).toBe(10);
      expect(d2.totals.closure.justifications[1].kind).toBe('REJUSTIFY');
      expect(num(d2.totals.closure.justifications[1].difference as never)).toBe(5);
      // Sin desactualización no hay nada que justificar, y el historial es append-only en la base.
      expect((await justificar(e.id, 'Otra vez').expect(409)).body.error.code).toBe('JUSTIFICATION_NOT_STALE');
      await expect(sql`UPDATE delivery_closures SET reason = 'otra cosa' WHERE delivery_id = ${e.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    });

    it('las guardas de corrección no cambian por cerrar: asignado, reservado y consumido siguen bloqueando', async () => {
      const e = await entrega('100', '100');
      const lote = (await http().post(`${A()}/lots`).set(as(ADMIN)).send({ operation_id: op(), inputs: [{ reception_id: e.reception, quantity: '100' }] }).expect(201)).body.lot;
      await cerrar(e.id);
      const corregir = () => http().post(`${A()}/deliveries/${e.id}/receptions/${e.reception}/corrections`).set(as(ADMIN))
        .send({ operation_id: op(), expected_version: 1, reason: 'Repesaje', weighing: { method: 'Báscula', quantity: '95', unit: 'KG', weighed_on: today } });
      // Asignado a un lote: bloqueado, igual que antes del cierre.
      expect((await corregir().expect(409)).body.error.code).toBeTruthy();
      // Consumido por un proceso: sigue bloqueado.
      const run = (await http().post(`${A()}/process-runs`).set(as(TRAZ)).send({ operation_id: op(), process_type: 'FERMENTATION', output_product_id: baba }).expect(201)).body.run;
      await http().post(`${A()}/process-runs/${run.id}/start`).set(as(TRAZ)).send({ operation_id: op(), started_at: new Date().toISOString(), inputs: [{ lot_id: lote.id, quantity: '100' }] }).expect(200);
      await corregir().expect(409);
      await http().post(`${A()}/process-runs/${run.id}/close`).set(as(TRAZ)).send({ operation_id: op(), closed_at: new Date(Date.now() + 1000).toISOString(), outputs: [{ quantity: '90' }], loss_quantity: '10' }).expect(200);
      await corregir().expect(409);
      // Y la entrega sigue cerrada y justificada: nada de esto la reabrió.
      expect((await ver(e.id)).totals.closure.status).toBe('CLOSED');
    });
  });
});
