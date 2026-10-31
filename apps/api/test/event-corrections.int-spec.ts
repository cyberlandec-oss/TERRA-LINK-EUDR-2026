import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { organizationEventStatsConsumer, type EventConsumer } from '../src/events/events';
import { OutboxWorker } from '../src/events/outbox-worker';

// Integración P0-015 (alcance interno): correcciones con efecto de dominio real (actualización de productor),
// historial autorizado por recurso, reproceso DEAD y fencing de arrendamientos. PostgreSQL real.
describeDb('P0-015 correcciones, historial y entregas DEAD', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let p1: string;
  let p2: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const prod = async (id: string) => (await http().get(`${base(orgA)}/producers/${id}`).set(as('admin-a@test.local')).expect(200)).body;
  const events = (actor: string, id: string, o = orgA, kind = 'producers') => http().get(`${base(o)}/aggregates/${kind}/${id}/events`).set(as(actor));
  const correct = (actor: string, id: string, eventId: string, body: Record<string, unknown>, o = orgA) =>
    http().post(`${base(o)}/producers/${id}/events/${eventId}/corrections`).set(as(actor)).send({ operation_id: randomUUID(), ...body });

  async function join(admin: string, o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const mid = async (email: string) => (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow()).id;
  async function update(id: string, body: Record<string, unknown>) {
    const cur = await prod(id);
    await http().patch(`${base(orgA)}/producers/${id}`).set(as('admin-a@test.local')).send({ expected_version: cur.row_version, ...body }).expect(200);
    const ev = (await events('admin-a@test.local', id).expect(200)).body.items[0];
    return ev.event_id as string;
  }

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop A', 'admin-a@test.local');
    orgB = await mk('Coop B', 'admin-b@test.local');
    await join('admin-a@test.local', orgA, 'tecnico1@test.local', 'FIELD_TECHNICIAN');
    await join('admin-a@test.local', orgA, 'tecnico2@test.local', 'FIELD_TECHNICIAN');
    await join('admin-a@test.local', orgA, 'auditor@test.local', 'AUDITOR');
    p1 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local'))
      .send({ producer_code: 'P-1', legal_name: 'Finca uno', community: 'El Carmen', document_type: 'CEDULA', document_number: '0912345678', phone: '0991234567', assigned_membership_id: await mid('tecnico1@test.local') }).expect(201)).body.id;
    p2 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'P-2', legal_name: 'Finca dos' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());

  it('corrección real: el dominio cambia, el original se conserva y la cadena queda trazable', async () => {
    const original = await update(p1, { community: 'Chone' }); // error de captura
    const before = await h.db.selectFrom('domain_events').selectAll().where('event_id', '=', original).executeTakeFirstOrThrow();
    const cur = await prod(p1);
    const r = await correct('tecnico1@test.local', p1, original, { expected_version: cur.row_version, reason: 'Se registró la comunidad equivocada', fields: { community: 'El Carmen Alto' } }).expect(201);
    expect(r.body).toMatchObject({ replayed: false, producer: { community: 'El Carmen Alto' } });
    expect((await prod(p1)).community).toBe('El Carmen Alto'); // efecto de dominio observable
    const after = await h.db.selectFrom('domain_events').selectAll().where('event_id', '=', original).executeTakeFirstOrThrow();
    expect(after).toEqual(before); // original inmutable
    const corr = await h.db.selectFrom('domain_events').selectAll().where('event_id', '=', r.body.correction_event_id).executeTakeFirstOrThrow();
    expect(corr).toMatchObject({ event_type: 'ProducerUpdateCorrected', correction_of_event_id: original, correction_reason: 'Se registró la comunidad equivocada' });
    const versions = (await http().get(`${base(orgA)}/producers/${p1}/history`).set(as('admin-a@test.local')).expect(200)).body;
    expect(versions.map((v: { change_type: string }) => v.change_type).slice(0, 2)).toEqual(['CORRECTION', 'UPDATE']);
    // corrección de la corrección (cadena)
    const c2 = await correct('admin-a@test.local', p1, r.body.correction_event_id, { expected_version: (await prod(p1)).row_version, reason: 'Nombre oficial de la comunidad', fields: { community: 'El Carmen' } }).expect(201);
    expect((await prod(p1)).community).toBe('El Carmen');
    // el original ya fue corregido: se indica la última corrección
    const again = await correct('admin-a@test.local', p1, original, { expected_version: (await prod(p1)).row_version, reason: 'otra vez', fields: { community: 'X' } }).expect(409);
    expect(again.body.error).toMatchObject({ code: 'EVENT_ALREADY_CORRECTED', details: [{ field: 'latest_correction_event_id', reason: c2.body.correction_event_id }] });
    const audits = await h.db.selectFrom('audit_logs').select(['action', 'after']).where('entity_id', '=', p1).where('action', '=', 'producer.correct').execute();
    expect(audits).toHaveLength(2);
  });

  it('rechazos: motivo ausente, actor falsificado, otra organización u otro agregado, tipo sin contrato, campo no corregido o de identidad', async () => {
    const ev = await update(p2, { legal_name: 'Finca dos SA' });
    const v = (await prod(p2)).row_version;
    await correct('admin-a@test.local', p2, ev, { expected_version: v, fields: { legal_name: 'Finca Dos S.A.' } }).expect(400); // sin motivo
    await correct('admin-a@test.local', p2, ev, { expected_version: v, reason: 'ok motivo', actor_id: randomUUID(), fields: { legal_name: 'Finca Dos S.A.' } }).expect(400); // actor del cuerpo
    await correct('admin-a@test.local', p1, ev, { expected_version: (await prod(p1)).row_version, reason: 'otro agregado', fields: { legal_name: 'x' } }).expect(404);
    await correct('admin-b@test.local', p2, ev, { expected_version: v, reason: 'otra org', fields: { legal_name: 'x' } }, orgB).expect(404);
    await correct('admin-b@test.local', p2, ev, { expected_version: v, reason: 'otra org', fields: { legal_name: 'x' } }).expect(404);
    const registered = (await events('admin-a@test.local', p2).expect(200)).body.items.find((e: { event_type: string }) => e.event_type === 'ProducerRegistered');
    expect((await correct('admin-a@test.local', p2, registered.event_id, { expected_version: v, reason: 'sin contrato', fields: { legal_name: 'x' } }).expect(422)).body.error.code).toBe('CORRECTION_NOT_SUPPORTED');
    expect((await correct('admin-a@test.local', p2, ev, { expected_version: v, reason: 'campo ajeno', fields: { community: 'x' } }).expect(422)).body.error.code).toBe('FIELD_NOT_IN_CORRECTED_EVENT');
    await correct('admin-a@test.local', p2, ev, { expected_version: v, reason: 'identidad', fields: { document_number: '123' } }).expect(400); // no corregible por esta vía
    await correct('auditor@test.local', p2, ev, { expected_version: v, reason: 'auditor', fields: { legal_name: 'x' } }).expect(403);
    await correct('tecnico1@test.local', p2, ev, { expected_version: v, reason: 'fuera de alcance', fields: { legal_name: 'x' } }).expect(404);
    // en base de datos: autorreferencia, evento de otro agregado y motivo vacío rechazados
    const actor = (await h.db.selectFrom('users').select('id').where('email', '=', 'admin-a@test.local').executeTakeFirstOrThrow()).id;
    const self = randomUUID();
    await expect(sql`INSERT INTO domain_events (event_id, organization_id, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, actor_id, occurred_at, payload, correction_of_event_id, correction_reason)
      VALUES (${self}, ${orgA}, 'ProducerUpdateCorrected', 1, 'PRODUCER', ${p2}, 99, ${actor}, now(), '{}', ${self}, 'auto')`.execute(h.db)).rejects.toThrow();
    await expect(sql`INSERT INTO domain_events (event_id, organization_id, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, actor_id, occurred_at, payload, correction_of_event_id, correction_reason)
      VALUES (${randomUUID()}, ${orgA}, 'ProducerUpdateCorrected', 1, 'PRODUCER', ${p1}, 98, ${actor}, now(), '{}', ${ev}, 'agregado ajeno')`.execute(h.db)).rejects.toThrow(/mismo agregado/);
    await expect(sql`INSERT INTO domain_events (event_id, organization_id, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, actor_id, occurred_at, payload, correction_of_event_id, correction_reason)
      VALUES (${randomUUID()}, ${orgA}, 'ProducerUpdateCorrected', 1, 'PRODUCER', ${p2}, 97, ${actor}, now(), '{}', ${ev}, '  ')`.execute(h.db)).rejects.toThrow(/domain_events_correction_reason/);
  });

  it('idempotencia y concurrencia: reintento idéntico, mismo id con otro contenido, correcciones simultáneas', async () => {
    const ev = await update(p2, { canton: 'Chone' });
    const v = (await prod(p2)).row_version;
    const body = { operation_id: randomUUID(), expected_version: v, reason: 'Cantón correcto', fields: { canton: 'Bolívar' } };
    const first = await http().post(`${base(orgA)}/producers/${p2}/events/${ev}/corrections`).set(as('admin-a@test.local')).send(body).expect(201);
    const replay = await http().post(`${base(orgA)}/producers/${p2}/events/${ev}/corrections`).set(as('admin-a@test.local')).send(body).expect(201);
    expect(replay.body).toMatchObject({ replayed: true, correction_event_id: first.body.correction_event_id });
    const changed = await http().post(`${base(orgA)}/producers/${p2}/events/${ev}/corrections`).set(as('admin-a@test.local')).send({ ...body, reason: 'Otro motivo' }).expect(409);
    expect(changed.body.error.code).toBe('OPERATION_ID_REUSED');
    // el reintento revalida el alcance: un usuario sin acceso al recurso no obtiene el resultado
    await http().post(`${base(orgA)}/producers/${p2}/events/${ev}/corrections`).set(as('tecnico1@test.local')).send(body).expect(404);
    // simultáneas sobre el mismo evento: una gana
    const ev2 = await update(p2, { parish: 'Calceta' });
    const v2 = (await prod(p2)).row_version;
    const results = await Promise.all([1, 2, 3].map((i) => correct('admin-a@test.local', p2, ev2, { expected_version: v2, reason: `Parroquia ${i}`, fields: { parish: `P${i}` } })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const n = await h.db.selectFrom('domain_events').select(sql<number>`count(*)::int`.as('n')).where('correction_of_event_id', '=', ev2).executeTakeFirstOrThrow();
    expect(n.n).toBe(1);
    // un cambio posterior del mismo campo hace obsoleta la corrección
    const ev3 = await update(p2, { province: 'Manabí' });
    await update(p2, { province: 'Manabi' });
    expect((await correct('admin-a@test.local', p2, ev3, { expected_version: (await prod(p2)).row_version, reason: 'tarde', fields: { province: 'X' } }).expect(409)).body.error.code).toBe('CORRECTION_SUPERSEDED');
  });

  it('rollback sin cambios, eventos ni auditoría parciales', async () => {
    const ev = await update(p2, { legal_name: 'Finca dos Ltda' });
    const v = (await prod(p2)).row_version;
    const snapshot = async () => ({
      name: (await prod(p2)).legal_name,
      ev: (await h.db.selectFrom('domain_events').select(sql<number>`count(*)::int`.as('n')).where('aggregate_id', '=', p2).executeTakeFirstOrThrow()).n,
      au: (await h.db.selectFrom('audit_logs').select(sql<number>`count(*)::int`.as('n')).where('entity_id', '=', p2).executeTakeFirstOrThrow()).n,
    });
    const before = await snapshot();
    await sql`CREATE OR REPLACE FUNCTION p015_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla forzada'; END $$`.execute(h.db);
    await sql`CREATE TRIGGER p015_fail BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action = 'producer.correct') EXECUTE FUNCTION p015_fail()`.execute(h.db);
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      await correct('admin-a@test.local', p2, ev, { expected_version: v, reason: 'falla', fields: { legal_name: 'Finca Dos Limitada' } }).expect(500);
    } finally {
      spy.mockRestore();
      await sql`DROP TRIGGER p015_fail ON audit_logs`.execute(h.db);
      await sql`DROP FUNCTION p015_fail`.execute(h.db);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('historial por recurso: orden y paginación estables, campos permitidos, sin datos clasificados; alcance efectivo', async () => {
    const all = (await events('admin-a@test.local', p1).expect(200)).body.items;
    const versions = all.map((e: { aggregate_version: number }) => e.aggregate_version);
    expect(versions).toEqual([...versions].sort((a, b) => b - a));
    const page1 = (await http().get(`${base(orgA)}/aggregates/producers/${p1}/events?limit=2`).set(as('admin-a@test.local')).expect(200)).body;
    const page2 = (await http().get(`${base(orgA)}/aggregates/producers/${p1}/events?limit=2&cursor=${page1.next_cursor}`).set(as('admin-a@test.local')).expect(200)).body;
    expect([...page1.items, ...page2.items].map((e: { aggregate_version: number }) => e.aggregate_version)).toEqual(versions.slice(0, 4));
    const corr = all.find((e: { correction_of: { event_type: string } | null }) => e.correction_of?.event_type === 'ProducerUpdated');
    expect(all.find((e: { correction_of: { event_type: string } | null }) => e.correction_of?.event_type === 'ProducerUpdateCorrected')).toBeDefined(); // cadena
    expect(corr).toMatchObject({ event_type: 'ProducerUpdateCorrected', correction_of: { event_type: 'ProducerUpdated' }, actor: { kind: 'MEMBER' } });
    expect(all.find((e: { event_id: string }) => e.event_id === corr.correction_of.event_id).corrected_by_event_id).toBe(corr.event_id);
    const blob = JSON.stringify(all);
    for (const s of ['0912345678', '0991234567', 'request_hash', 'assigned_membership_id', 'to_membership_id', '"email"', 'document']) expect(blob).not.toContain(s);
    expect(all.every((e: { actor: object }) => Object.keys(e.actor).sort().join() === 'display,kind')).toBe(true); // solo nombre visible, sin correo ni id
    // auditor lee el historial; técnico no asignado no; otra organización no
    await events('auditor@test.local', p1).expect(200);
    await events('tecnico2@test.local', p1).expect(404);
    await events('admin-b@test.local', p1).expect(404);
    await events('admin-a@test.local', p1, orgA, 'unknown').expect(404);
    // reasignar el productor cambia el acceso a su historia de inmediato
    await events('tecnico1@test.local', p1).expect(200);
    const cur = await prod(p1);
    await http().put(`${base(orgA)}/producers/${p1}/assignment`).set(as('admin-a@test.local')).send({ expected_version: cur.row_version, membership_id: await mid('tecnico2@test.local') }).expect(200);
    await events('tecnico1@test.local', p1).expect(404);
    await events('tecnico2@test.local', p1).expect(200);
    // desactivar la membresía retira el acceso
    await http().post(`${base(orgA)}/members/${await mid('tecnico2@test.local')}/deactivate`).set(as('admin-a@test.local')).send({ reason: 'Revocación de prueba' }).expect(200);
    expect([401, 403, 404]).toContain((await events('tecnico2@test.local', p1)).status);
    // tipo de evento desconocido: no expone campos del payload
    const actor = (await h.db.selectFrom('users').select('id').where('email', '=', 'admin-a@test.local').executeTakeFirstOrThrow()).id;
    const top = Math.max(...versions);
    await sql`INSERT INTO domain_events (event_id, organization_id, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, actor_id, occurred_at, payload)
      VALUES (${randomUUID()}, ${orgA}, 'FutureThing', 1, 'PRODUCER', ${p1}, ${top + 100}, ${actor}, now(), ${JSON.stringify({ secret_token: 'abc123', document_number: '0912345678' })}::jsonb)`.execute(h.db);
    const unknown = (await events('admin-a@test.local', p1).expect(200)).body.items[0];
    expect(unknown).toMatchObject({ event_type: 'FutureThing', known_type: false, data: {} });
  });

  describe('entregas: consumo repetido, reproceso DEAD y fencing de arrendamientos', () => {
    let failures = 0;
    const flaky: EventConsumer = {
      name: 'organization-event-stats', eventTypes: '*',
      async handle(trx, event) {
        if (failures > 0) { failures--; throw new Error('fallo simulado con dato 0912345678'); }
        await organizationEventStatsConsumer.handle(trx, event);
      },
    };
    const worker = (id: string, extra = {}) => new OutboxWorker(h.db, [flaky], { workerId: id, backoffBaseMs: 1, maxAttempts: 2, ...extra });
    const count = async (type: string) => Number((await h.db.selectFrom('organization_event_stats').select('event_count').where('organization_id', '=', orgA).where('event_type', '=', type).executeTakeFirst())?.event_count ?? 0);
    const dueAll = () => h.db.updateTable('event_deliveries').set({ next_attempt_at: new Date(0) }).where('status', 'in', ['PENDING', 'FAILED']).execute();
    const drain = async (w: OutboxWorker) => { for (let i = 0; i < 20; i++) { await dueAll(); if ((await w.runOnce()).claimed === 0) break; } };

    it('el consumidor completa sus efectos pero falla la confirmación: el reintento no duplica', async () => {
      await drain(worker('w-limpieza'));
      const ev = await update(p2, { legal_name: 'Finca dos (ack)' });
      const baseline = await count('ProducerUpdated');
      await sql`CREATE OR REPLACE FUNCTION p015_ack_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ack fallida'; END $$`.execute(h.db);
      await sql`CREATE TRIGGER p015_ack_fail BEFORE UPDATE ON event_deliveries FOR EACH ROW WHEN (NEW.status = 'DONE') EXECUTE FUNCTION p015_ack_fail()`.execute(h.db);
      try {
        await dueAll();
        await worker('w1').runOnce();
      } finally {
        await sql`DROP TRIGGER p015_ack_fail ON event_deliveries`.execute(h.db);
        await sql`DROP FUNCTION p015_ack_fail`.execute(h.db);
      }
      expect(await count('ProducerUpdated')).toBe(baseline); // efectos revertidos con la confirmación
      expect((await h.db.selectFrom('consumer_receipts').select('event_id').where('event_id', '=', ev).execute())).toHaveLength(0);
      await drain(worker('w2'));
      expect(await count('ProducerUpdated')).toBe(baseline + 1); // una sola vez
      const d = await h.db.selectFrom('event_deliveries').selectAll().where('event_id', '=', ev).executeTakeFirstOrThrow();
      expect(d).toMatchObject({ status: 'DONE', attempts: 2 });
      // entrega repetida (p. ej. arrendamiento vencido tras confirmar): recibo existente → sin efectos
      await h.db.updateTable('event_deliveries').set({ status: 'PENDING', next_attempt_at: new Date(0) }).where('event_id', '=', ev).execute();
      expect((await worker('w3').runOnce()).skippedDuplicate).toBe(1);
      expect(await count('ProducerUpdated')).toBe(baseline + 1);
      await expect(sql`DELETE FROM consumer_receipts WHERE event_id = ${ev}`.execute(h.db)).rejects.toThrow(/no admite cambios/);
    });

    it('DEAD → reproceso manual autorizado con motivo y auditoría; conserva identidad, intentos y recibos', async () => {
      await drain(worker('w-limpieza'));
      const ev = await update(p2, { legal_name: 'Finca dos (dead)' });
      failures = 2;
      await drain(worker('w-falla'));
      // Se filtra por consumidor A PROPÓSITO: un evento tiene una entrega POR consumidor, y esta prueba
      // habla de la del consumidor que falla. Sin el filtro, leía una cualquiera.
      const dead = await h.db.selectFrom('event_deliveries').selectAll()
        .where('event_id', '=', ev).where('consumer', '=', 'organization-event-stats').executeTakeFirstOrThrow();
      expect(dead).toMatchObject({ status: 'DEAD', attempts: 2, last_error: 'ERROR_ERROR' });
      expect(JSON.stringify(dead)).not.toContain('0912345678'); // sin mensajes con datos
      const list = (await http().get(`${base(orgA)}/event-deliveries?status=DEAD`).set(as('admin-a@test.local')).expect(200)).body;
      expect(list.find((x: { event_id: string }) => x.event_id === ev)).toMatchObject({ consumer: 'organization-event-stats', attempts: 2 });
      // denegados: auditor, técnico, otra organización
      await http().get(`${base(orgA)}/event-deliveries?status=DEAD`).set(as('auditor@test.local')).expect(403);
      await http().post(`${base(orgA)}/event-deliveries/${ev}/organization-event-stats/requeue`).set(as('tecnico1@test.local')).send({ reason: 'sin permiso' }).expect(403);
      await http().post(`${base(orgB)}/event-deliveries/${ev}/organization-event-stats/requeue`).set(as('admin-b@test.local')).send({ reason: 'otra org' }).expect(404);
      await http().post(`${base(orgA)}/event-deliveries/${ev}/organization-event-stats/requeue`).set(as('admin-a@test.local')).send({}).expect(400);
      const baseline = await count('ProducerUpdated');
      const [a, b] = await Promise.all([1, 2].map(() => http().post(`${base(orgA)}/event-deliveries/${ev}/organization-event-stats/requeue`).set(as('admin-a@test.local')).send({ reason: 'Consumidor corregido' })));
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      await drain(worker('w-ok'));
      const done = await h.db.selectFrom('event_deliveries').selectAll()
        .where('event_id', '=', ev).where('consumer', '=', 'organization-event-stats').executeTakeFirstOrThrow();
      expect(done).toMatchObject({ status: 'DONE', attempts: 3, manual_requeues: 1 });
      expect(await count('ProducerUpdated')).toBe(baseline + 1);
      const history = await h.db.selectFrom('event_delivery_attempts').select(['outcome', 'error_code'])
        .where('event_id', '=', ev).where('consumer', '=', 'organization-event-stats').orderBy('id').execute();
      expect(history.map((x) => x.outcome)).toEqual(['FAILED', 'DEAD', 'MANUAL_REQUEUE', 'DONE']);
      expect((await h.db.selectFrom('domain_events').select(sql<number>`count(*)::int`.as('n')).where('aggregate_id', '=', p2).where('event_type', '=', 'ProducerUpdated').where('payload', '@>', sql`'{}'::jsonb`).executeTakeFirstOrThrow()).n).toBeGreaterThan(0);
      expect((await h.db.selectFrom('audit_logs').select('action').where('action', '=', 'event_delivery.requeue').execute())).toHaveLength(1);
    });

    it('fencing: un worker con un arrendamiento anterior no puede confirmar una entrega reclamada después', async () => {
      await drain(worker('w-limpieza'));
      const ev = await update(p2, { legal_name: 'Finca dos (lease)' });
      const baseline = await count('ProducerUpdated');
      await dueAll();
      // w-lento reclama, pero su arrendamiento vence y w-rapido reclama y completa antes de que w-lento confirme
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const slow: EventConsumer = { name: 'organization-event-stats', eventTypes: '*', async handle(trx, e) { await gate; await organizationEventStatsConsumer.handle(trx, e); } };
      const wSlow = new OutboxWorker(h.db, [slow], { workerId: 'w-lento', leaseSeconds: 1, backoffBaseMs: 1 });
      const slowRun = wSlow.runOnce();
      await new Promise((r) => setTimeout(r, 1500)); // vence el arrendamiento de w-lento (su transacción espera)
      const fast = worker('w-rapido');
      const fastRun = fast.runOnce();
      await new Promise((r) => setTimeout(r, 300));
      release();
      await Promise.all([slowRun, fastRun]);
      await drain(worker('w-final'));
      expect(await count('ProducerUpdated')).toBe(baseline + 1); // efectos una sola vez
      const attempts = await h.db.selectFrom('event_delivery_attempts').select(['worker_id', 'outcome']).where('event_id', '=', ev).orderBy('id').execute();
      expect(attempts.some((x) => x.worker_id === 'w-lento' && x.outcome === 'LEASE_LOST')).toBe(true);
      expect(attempts.filter((x) => x.outcome === 'DONE')).toHaveLength(1);
      expect((await h.db.selectFrom('event_deliveries').select('status').where('event_id', '=', ev).executeTakeFirstOrThrow()).status).toBe('DONE');
    });
  });
});
