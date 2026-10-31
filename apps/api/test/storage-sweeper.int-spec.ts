import { randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { OBJECT_STORE, type ObjectStore } from '../src/storage/object-store';
import { DEFAULT_SWEEPER, StorageSweeper } from '../src/storage/sweeper';

// Barrido programado del almacenamiento privado (P0-009 → worker en P0-010). PostgreSQL y S3 local reales.
describeDb('Barrido de originales: solo huérfanos y descartados, sin carreras con la confirmación', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let store: ObjectStore;
  let orgA: string;
  let plot: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const org = () => `/api/v1/organizations/${orgA}`;
  const SQUARE = [[-80.16, -0.848], [-80.159, -0.848], [-80.159, -0.847], [-80.16, -0.847], [-80.16, -0.848]];
  const sweeper = () => new StorageSweeper(h.db, store, { ...DEFAULT_SWEEPER, orphanGraceSeconds: 0 });
  const analyze = async () => (await http().post(`${org()}/plots/${plot}/geometry-imports`).set(as('admin-a@test.local'))
    .field('operation_id', randomUUID()).attach('file', Buffer.from(JSON.stringify({ type: 'Polygon', coordinates: [SQUARE] })), { filename: 'p.geojson', contentType: 'application/geo+json' }).expect(201)).body.import;
  const keyOf = async (id: string) => (await h.db.selectFrom('geometry_imports').select('object_key').where('id', '=', id).executeTakeFirstOrThrow()).object_key;
  const plotVersion = async () => Number((await h.db.selectFrom('plots').select('row_version').where('id', '=', plot).executeTakeFirstOrThrow()).row_version);
  const task = (key: string) => h.db.selectFrom('object_deletions').selectAll().where('object_key', '=', key).executeTakeFirst();

  beforeAll(async () => {
    h = await setupHarness();
    store = h.app.get(OBJECT_STORE);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    orgA = (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: 'Coop A', organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: 'admin-a@test.local' }).expect(201)).body.id;
    await h.login('admin-a@test.local', PASSWORD);
    const p = (await http().post(`${org()}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'P-1', legal_name: 'Finca' }).expect(201)).body.id;
    plot = (await http().post(`${org()}/plots`).set(as('admin-a@test.local')).send({ producer_id: p, plot_code: 'PAR-1', crop: 'Cacao' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());
  afterEach(() => jest.restoreAllMocks());

  it('un original referenciado (ANALYZED o CONFIRMED) nunca se borra aunque exista una tarea errónea', async () => {
    const imp = await analyze();
    const key = await keyOf(imp.id);
    await sweeper().enqueue(key, 'ORPHAN'); // simula una detección equivocada
    // Se barre SOLO esta clave. Sin acotarla, el lote (50) lo copan las tareas que `discover()` encola del
    // bucket COMPARTIDO de pruebas —que crece con cada corrida—, y la tarea propia se queda sin reclamar:
    // la prueba fallaría por el tamaño del bucket, no por el comportamiento que quiere proteger.
    const r = await sweeper().process([key]);
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect((await task(key))?.status).toBe('SKIPPED_REFERENCED');
    expect(await store.exists(key)).toBe(true);
    await http().post(`${org()}/geometry-imports/${imp.id}/confirm`).set(as('admin-a@test.local')).send({ operation_id: randomUUID(), plot_expected_version: await plotVersion() }).expect(201);
    await sweeper().runOnce(); // puede borrar huérfanos de corridas anteriores del bucket de pruebas, nunca este original
    expect(await store.exists(key)).toBe(true);
  });

  it('confirmación y barrido concurrentes: la confirmación conserva su archivo', async () => {
    const imp = await analyze();
    const key = await keyOf(imp.id);
    await sweeper().enqueue(key, 'ORPHAN');
    const [conf] = await Promise.all([
      http().post(`${org()}/geometry-imports/${imp.id}/confirm`).set(as('admin-a@test.local')).send({ operation_id: randomUUID(), plot_expected_version: await plotVersion() }),
      sweeper().process([key]),   // acotado a ESTA clave: ver la nota de la prueba anterior
    ]);
    expect(conf.status).toBe(201);
    // Lo que de verdad se protege: la confirmación conserva su archivo, pase lo que pase con el orden.
    expect(await store.exists(key)).toBe(true);
    // El barrido puede haber llegado antes de que la confirmación cerrara; entonces la tarea queda
    // PENDING y se resuelve en la pasada siguiente. Lo que NO puede ocurrir nunca es que se borre.
    const tras = (await task(key))?.status;
    expect(['SKIPPED_REFERENCED', 'PENDING']).toContain(tras);
    if (tras === 'PENDING') {
      await sweeper().process([key]);
      expect((await task(key))?.status).toBe('SKIPPED_REFERENCED');
    }
    expect(await store.exists(key)).toBe(true);
  });

  it('una importación descartada no puede confirmarse después; su original se borra', async () => {
    const imp = await analyze();
    const key = await keyOf(imp.id);
    await http().post(`${org()}/geometry-imports/${imp.id}/discard`).set(as('admin-a@test.local')).expect(200);
    expect((await task(key))?.status).toBe('DONE');
    expect(await store.exists(key)).toBe(false);
    const c = await http().post(`${org()}/geometry-imports/${imp.id}/confirm`).set(as('admin-a@test.local')).send({ operation_id: randomUUID(), plot_expected_version: await plotVersion() }).expect(409);
    expect(c.body.error.code).toBe('IMPORT_DISCARDED');
  });

  it('fallo de limpieza registrado y recuperado en un reintento', async () => {
    const imp = await analyze();
    const key = await keyOf(imp.id);
    jest.spyOn(store, 'delete').mockRejectedValueOnce(new Error('S3 caído'));
    await http().post(`${org()}/geometry-imports/${imp.id}/discard`).set(as('admin-a@test.local')).expect(200);
    expect(await task(key)).toMatchObject({ status: 'FAILED', attempts: 1, last_error_code: 'STORAGE_DELETE_FAILED' });
    expect(new Date((await task(key))!.next_attempt_at).getTime()).toBeGreaterThan(Date.now()); // espera antes de reintentar
    expect((await sweeper().process()).deleted).toBe(0); // aún no vence
    await h.db.updateTable('object_deletions').set({ next_attempt_at: new Date(0) }).where('object_key', '=', key).execute();
    expect((await sweeper().process()).deleted).toBe(1);
    expect(await task(key)).toMatchObject({ status: 'DONE', attempts: 2, last_error_code: null });
    expect(await store.exists(key)).toBe(false);
  });

  it('varios workers: cada tarea se procesa una sola vez', async () => {
    const keys = [1, 2, 3, 4, 5].map(() => `organizations/${orgA}/geometry-imports/${randomUUID()}.geojson`);
    for (const k of keys) await store.put(k, Buffer.from('{}'), 'application/geo+json');
    for (const k of keys) await sweeper().enqueue(k, 'ORPHAN');
    const deleteSpy = jest.spyOn(store, 'delete');
    const [a, b] = await Promise.all([sweeper().process(keys), sweeper().process(keys)]);
    expect(a.deleted + b.deleted).toBe(5);
    expect(deleteSpy).toHaveBeenCalledTimes(5);
    for (const k of keys) expect((await task(k))?.status).toBe('DONE');
  });

  it('gracia para huérfanos recientes y alcance limitado al prefijo de importaciones', async () => {
    const fresh = `organizations/${orgA}/geometry-imports/${randomUUID()}.geojson`;
    const foreign = [`otros/${randomUUID()}.txt`, `organizations/${orgA}/evidencias/${randomUUID()}.pdf`];
    await store.put(fresh, Buffer.from('{}'), 'application/geo+json');
    for (const k of foreign) await store.put(k, Buffer.from('x'), 'text/plain');
    await new StorageSweeper(h.db, store, { ...DEFAULT_SWEEPER, orphanGraceSeconds: 3600 }).runOnce();
    expect(await store.exists(fresh)).toBe(true); // podría ser un análisis en curso
    await sweeper().runOnce();
    expect(await store.exists(fresh)).toBe(false);
    for (const k of foreign) expect(await store.exists(k)).toBe(true); // nunca limpieza indiscriminada
    for (const k of foreign) await store.delete(k);
  });
});
