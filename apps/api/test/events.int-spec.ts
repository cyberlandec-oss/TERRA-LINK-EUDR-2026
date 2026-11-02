import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { EventStore, organizationEventStatsConsumer, type EventConsumer } from '../src/events/events';
import { OutboxWorker } from '../src/events/outbox-worker';
import { describeDb, setupHarness } from './helpers';

// Base de eventos/outbox (TECH-001, ADR-0003) contra PostgreSQL real: atomicidad, inmutabilidad,
// orden por agregado, reintentos, DEAD, entrega repetida idempotente, concurrencia y arrendamientos.
describeDb('eventos de dominio y outbox (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgId: string;
  let actorId: string;
  const effects = new Map<string, number>();
  let failuresLeft = 0;

  // Consumidor de prueba: cuenta efectos por evento en una tabla temporal; puede fallar a demanda.
  const counting: EventConsumer = {
    name: 'test-counter',
    eventTypes: ['ThingHappened'],
    async handle(trx, event) {
      if (failuresLeft > 0) {
        failuresLeft--;
        throw new Error('fallo simulado del consumidor');
      }
      await sql`INSERT INTO test_effects (event_id, n) VALUES (${event.event_id}, 1)
                ON CONFLICT (event_id) DO UPDATE SET n = test_effects.n + 1`.execute(trx);
      effects.set(event.event_id, (effects.get(event.event_id) ?? 0) + 1);
    },
  };
  const consumers = [counting, organizationEventStatsConsumer];
  const store = new EventStore(consumers);
  const worker = (id?: string, extra: object = {}) =>
    new OutboxWorker(h.db, consumers, { workerId: id, backoffBaseMs: 10, maxAttempts: 3, ...extra });

  async function emit(aggregateId = randomUUID(), version = 1, operationId?: string) {
    return h.db.transaction().execute((trx) =>
      store.append(trx, {
        organizationId: orgId, eventType: 'ThingHappened', schemaVersion: 1, aggregateType: 'THING',
        aggregateId, aggregateVersion: version, actorId, operationId, payload: { ref: aggregateId },
      }),
    );
  }
  const effectsOf = async (eventId: string) =>
    (await sql<{ n: number }>`SELECT n FROM test_effects WHERE event_id = ${eventId}`.execute(h.db)).rows[0]?.n ?? 0;
  const delivery = (eventId: string, consumer = 'test-counter') =>
    h.db.selectFrom('event_deliveries').selectAll().where('event_id', '=', eventId).where('consumer', '=', consumer).executeTakeFirstOrThrow();

  beforeAll(async () => {
    h = await setupHarness();
    actorId = await h.user('super@test.local', 'SUPER_ADMIN');
    orgId = (await h.http().post('/api/v1/organizations').set(h.as('super@test.local'))
      .send({ name: 'Org eventos', organization_type: 'COOPERATIVE', country: 'EC' }).expect(201)).body.id;
    await sql`CREATE TABLE test_effects (event_id uuid PRIMARY KEY, n integer NOT NULL)`.execute(h.db);
  });
  afterAll(async () => h?.close());

  it('atomicidad: si la transacción se revierte no queda evento ni entrega', async () => {
    const aggregateId = randomUUID();
    await expect(
      h.db.transaction().execute(async (trx) => {
        await store.append(trx, {
          organizationId: orgId, eventType: 'ThingHappened', schemaVersion: 1, aggregateType: 'THING',
          aggregateId, aggregateVersion: 1, actorId, payload: {},
        });
        throw new Error('fallo del caso de uso tras escribir el evento');
      }),
    ).rejects.toThrow('fallo del caso de uso');
    const n = await h.db.selectFrom('domain_events').select(sql<number>`count(*)::int`.as('n')).where('aggregate_id', '=', aggregateId).executeTakeFirstOrThrow();
    expect(n.n).toBe(0);
  });

  it('confirmado: evento con envolvente completa y una entrega PENDING por consumidor suscrito', async () => {
    const e = await emit();
    expect(e).toMatchObject({ organization_id: orgId, event_type: 'ThingHappened', schema_version: 1, aggregate_version: '1', actor_id: actorId });
    expect(e.recorded_at).toBeTruthy();
    const ds = await h.db.selectFrom('event_deliveries').select(['consumer', 'status']).where('event_id', '=', e.event_id).orderBy('consumer').execute();
    expect(ds).toEqual([{ consumer: 'organization-event-stats', status: 'PENDING' }, { consumer: 'test-counter', status: 'PENDING' }]);
  });

  it('eventos inmutables y orden por agregado: no se modifican ni se repite versión u operation_id', async () => {
    const agg = randomUUID();
    const e = await emit(agg, 1, `op-${agg}`);
    await expect(sql`UPDATE domain_events SET payload = '{}' WHERE event_id = ${e.event_id}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM domain_events WHERE event_id = ${e.event_id}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(emit(agg, 1)).rejects.toThrow(/domain_events_aggregate_version_uq/);
    await expect(emit(randomUUID(), 1, `op-${agg}`)).rejects.toThrow(/domain_events_operation_uq/);
    await emit(agg, 2);
    const history = await store.history(h.db, orgId, 'THING', agg);
    expect(history.map((x) => x.aggregate_version)).toEqual(['1', '2']);
  });

  it('recorrido real: el worker publica y el consumidor aplica el efecto una vez', async () => {
    await sql`DELETE FROM event_deliveries`.execute(h.db); // descarta pendientes de casos previos
    const e = await emit();
    const r = await worker().runOnce();
    expect(r.done).toBe(2);
    expect(await effectsOf(e.event_id)).toBe(1);
    expect((await delivery(e.event_id)).status).toBe('DONE');
    const stats = await h.db.selectFrom('organization_event_stats').selectAll().where('organization_id', '=', orgId).where('event_type', '=', 'ThingHappened').executeTakeFirstOrThrow();
    expect(Number(stats.event_count)).toBeGreaterThanOrEqual(1);
  });

  it('entrega repetida: volver a entregar el mismo evento no duplica efectos', async () => {
    const e = await emit();
    await worker().runOnce();
    await h.db.updateTable('event_deliveries').set({ status: 'PENDING', next_attempt_at: new Date(0) }).where('event_id', '=', e.event_id).execute();
    const again = await worker().runOnce();
    expect(again.skippedDuplicate).toBeGreaterThanOrEqual(1);
    expect(await effectsOf(e.event_id)).toBe(1);
    expect((await delivery(e.event_id)).status).toBe('DONE');
  });

  it('reintentos con espera y DEAD al agotar intentos; el fallo revierte efectos parciales', async () => {
    const e = await emit();
    failuresLeft = 1;
    await worker().runOnce();
    let d = await delivery(e.event_id);
    expect(d).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(d.last_error).toBe('ERROR_ERROR'); // solo el código: el mensaje puede contener datos
    expect(d.last_error).not.toContain('fallo simulado del consumidor');
    expect(new Date(d.next_attempt_at).getTime()).toBeGreaterThan(Date.now() - 1000);
    expect(await effectsOf(e.event_id)).toBe(0);
    await new Promise((r) => setTimeout(r, 50));
    await worker().runOnce();
    d = await delivery(e.event_id);
    expect(d).toMatchObject({ status: 'DONE', attempts: 2 });
    expect(await effectsOf(e.event_id)).toBe(1);

    const dead = await emit();
    failuresLeft = 99;
    for (let i = 0; i < 3; i++) {
      await h.db.updateTable('event_deliveries').set({ next_attempt_at: new Date(0) }).where('event_id', '=', dead.event_id).where('status', '!=', 'DEAD').execute();
      await worker().runOnce();
    }
    d = await delivery(dead.event_id, 'test-counter');
    expect(d).toMatchObject({ status: 'DEAD', attempts: 3 });
    // DEAD no se vuelve a reclamar automáticamente.
    await h.db.updateTable('event_deliveries').set({ next_attempt_at: new Date(0) }).where('event_id', '=', dead.event_id).execute();
    await worker().runOnce();
    expect((await delivery(dead.event_id)).attempts).toBe(3);
    failuresLeft = 0;
  });

  it('concurrencia: varios workers procesan cada entrega una sola vez', async () => {
    await sql`UPDATE event_deliveries SET status = 'DEAD' WHERE status <> 'DONE'`.execute(h.db); // aísla la prueba sin borrar historial
    const events = [];
    for (let i = 0; i < 30; i++) events.push(await emit());
    const workers = [worker('w1', { batchSize: 5 }), worker('w2', { batchSize: 5 }), worker('w3', { batchSize: 5 })];
    for (let round = 0; round < 10; round++) await Promise.all(workers.map((w) => w.runOnce()));
    for (const e of events) expect(await effectsOf(e.event_id)).toBe(1);
    const pending = await h.db.selectFrom('event_deliveries').select(sql<number>`count(*)::int`.as('n'))
      .where('event_id', 'in', events.map((e) => e.event_id)).where('status', '!=', 'DONE').executeTakeFirstOrThrow();
    expect(pending.n).toBe(0);
  });

  it('arrendamiento vencido: una entrega abandonada en PROCESSING se reclama y completa', async () => {
    const e = await emit();
    await h.db.updateTable('event_deliveries')
      .set({ status: 'PROCESSING', locked_by: 'worker-caido', locked_until: new Date(Date.now() - 1000), attempts: 1 })
      .where('event_id', '=', e.event_id).execute();
    await worker('w-rescate').runOnce();
    const d = await delivery(e.event_id);
    expect(d).toMatchObject({ status: 'DONE', attempts: 2 });
    expect(await effectsOf(e.event_id)).toBe(1);
  });

  it('un worker que perdió el arrendamiento no puede confirmar la entrega de otro', async () => {
    const e = await emit();
    const w = worker('w-lento');
    // Otro worker toma la entrega mientras «w-lento» no la tiene: la confirmación filtra por locked_by.
    await h.db.updateTable('event_deliveries').set({ status: 'PROCESSING', locked_by: 'otro', locked_until: new Date(Date.now() + 60_000) })
      .where('event_id', '=', e.event_id).execute();
    const r = await w.runOnce();
    expect(r.claimed).toBe(0);
    expect((await delivery(e.event_id)).locked_by).toBe('otro');
  });
});
