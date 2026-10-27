import { sql, type Kysely } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { publishCteRelease } from '../src/traceability/cte-release';

// Integración P0-013 CTE: catálogo de sistema versionado, PostgreSQL real.
describeDb('P0-013 catálogo de hitos críticos (CTE)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const cat = (actor: string, o = orgA, q = '') => http().get(`/api/v1/organizations/${o}/cte-catalog${q}`).set(as(actor));
  const S1 = ['HARVEST', 'DELIVERY', 'RECEPTION', 'WEIGHING', 'FERMENTATION', 'DRYING', 'STORAGE', 'PACKAGING', 'SALE', 'SHIPMENT'];

  async function join(admin: string, o: string, email: string, role: string) {
    const inv = await http().post(`/api/v1/organizations/${o}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
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
    await join('admin-a@test.local', orgA, 'trazabilidad@test.local', 'TRACEABILITY_MANAGER');
    await join('admin-a@test.local', orgA, 'productor@test.local', 'PRODUCER');
  });
  afterAll(async () => h?.close());

  it('catálogo vigente 1.1.0: hitos de las fuentes; P0-012 integra entrega, recepción, pesaje y clasificación; el resto sigue PENDIENTE', async () => {
    const r = (await cat('trazabilidad@test.local').expect(200)).body;
    expect(r).toMatchObject({ scope: 'SYSTEM', current_release: { version: '1.6.0' } }); // 1.3.0: STORAGE integrada (P0-017); 1.4.0: SHIPMENT integrada (P0-029); 1.6.0: DRYING integrada (D-32)
    const codes = r.definitions.map((d: { code: string }) => d.code);
    expect(codes.sort()).toEqual([...S1, 'CLASSIFICATION'].sort());
    expect(new Set(codes).size).toBe(codes.length); // únicos en el ámbito
    const P0012 = ['DELIVERY', 'RECEPTION', 'WEIGHING', 'CLASSIFICATION', 'FERMENTATION', 'STORAGE', 'SHIPMENT', 'DRYING']; // integradas (P0-012, P0-016 —DRYING el 2026-10-15 con D-32—, P0-017, P0-029)
    for (const d of r.definitions) {
      const v = P0012.includes(d.code) ? 2 : 1;
      expect(d).toMatchObject({ version: v, status: 'ACTIVE', reference: `${d.code}@${v}` });
      expect(d.operations.length).toBeGreaterThan(0);
      expect(d.operations.every((o: { integration_status: string }) => o.integration_status === (P0012.includes(d.code) ? 'INTEGRATED' : 'PENDING'))).toBe(true);
    }
    expect(r.summary).toMatchObject({ definitions: 11, integrated_operations: 8, pending_operations: 3 }); // DRYING integrada el 2026-10-15 (D-32); siguen pendientes HARVEST, PACKAGING y SALE, sin historia asignada
    const blob = JSON.stringify(r);
    for (const masterData of ['ProducerCreated', 'PlotGeometryVersionCreated', 'ProductCreated', 'PlotCreated']) expect(blob).not.toContain(masterData);
    expect(r.definitions.find((d: { code: string }) => d.code === 'DELIVERY').operations[0]).toMatchObject({ event_type: 'DeliveryRegistered', story: 'P0-012' });
    expect(r.definitions.find((d: { code: string }) => d.code === 'CLASSIFICATION').source).toMatch(/docs\/08/);
    // no hay registros operativos de hitos: ningún evento de dominio con esos tipos
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM domain_events WHERE event_type IN ('HarvestRecorded','DeliveryRegistered','ReceptionConfirmed')`.execute(h.db)).rows[0].n).toBe(0);
  });

  it('permisos y aislamiento: administrador y trazabilidad consultan; productor 403; no miembro 404; sin rutas de administración', async () => {
    await cat('admin-a@test.local').expect(200);
    expect((await cat('productor@test.local').expect(403)).body.error.code).toBe('PERMISSION_DENIED');
    await cat('admin-b@test.local', orgA).expect(404);
    const b = (await cat('admin-b@test.local', orgB).expect(200)).body; // mismo catálogo de sistema
    expect(b.definitions.length).toBe(11);
    await http().post(`/api/v1/organizations/${orgA}/cte-catalog`).set(as('admin-a@test.local')).send({ code: 'X' }).expect(404);
    await expect(sql`UPDATE cte_definitions SET name = 'otro' WHERE code = 'HARVEST'`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM cte_operation_links`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('nueva versión del catálogo: preserva la historia, referencias por versión y retirada sin romper referencias', async () => {
    const v1 = (await cat('admin-a@test.local').expect(200)).body.definitions.find((d: { code: string }) => d.code === 'WEIGHING');
    const pack1 = (await cat('admin-a@test.local').expect(200)).body.definitions.find((d: { code: string }) => d.code === 'PACKAGING');
    await h.db.transaction().execute((trx) => publishCteRelease(trx as unknown as Kysely<unknown>, {
      version: '2.1.0', source: 'prueba', notes: 'Redefinición de pesaje y retirada de envasado (solo prueba)',
      publish: [{ code: 'WEIGHING', name: 'Pesaje', description: 'Descripción revisada (prueba).', stage: 'INTERNAL', source: 'prueba',
        links: [{ operation: 'WEIGHT_RECORD', event_type: 'WeightRecorded', status: 'PENDING', story: 'P0-012', note: 'prueba' }] }],
      retire: [{ code: 'PACKAGING', reason: 'Retirada de prueba' }],
    }));
    const now = (await cat('admin-a@test.local').expect(200)).body;
    expect(now.current_release.version).toBe('2.1.0');
    const w = now.definitions.find((d: { code: string }) => d.code === 'WEIGHING');
    expect(w).toMatchObject({ version: 3, reference: 'WEIGHING@3', supersedes_id: v1.id });
    expect(now.definitions.map((d: { code: string }) => d.code)).not.toContain('PACKAGING');
    // las referencias anteriores siguen resolubles y con su significado original
    const old = (await http().get(`/api/v1/organizations/${orgA}/cte-definitions/${v1.id}`).set(as('admin-a@test.local')).expect(200)).body;
    expect(old).toMatchObject({ version: v1.version, description: v1.description, status: 'RETIRED', retirement: { release: '2.1.0', superseded_by: w.id } });
    const pk = (await http().get(`/api/v1/organizations/${orgA}/cte-definitions/${pack1.id}`).set(as('admin-a@test.local')).expect(200)).body;
    expect(pk).toMatchObject({ status: 'RETIRED', retirement: { release: '2.1.0', reason: 'Retirada de prueba', superseded_by: null } });
    const all = (await cat('admin-a@test.local', orgA, '?include_retired=true').expect(200)).body.definitions;
    expect(all.filter((d: { code: string }) => d.code === 'WEIGHING').map((d: { version: number; status: string }) => [d.version, d.status])).toEqual([[1, 'RETIRED'], [2, 'RETIRED'], [3, 'ACTIVE']]);
    const rel = (await http().get(`/api/v1/organizations/${orgA}/cte-catalog/releases`).set(as('admin-a@test.local')).expect(200)).body;
    expect(rel.map((x: { version: string }) => x.version)).toEqual(['2.1.0', '1.6.0', '1.4.0', '1.3.0', '1.2.0', '1.1.0', '1.0.0']);
    // códigos únicos por versión en el ámbito
    await expect(sql`INSERT INTO cte_definitions (id, code, version, name, description, stage, source, release_version) VALUES (gen_random_uuid(), 'WEIGHING', 3, 'x', 'x', 'INTERNAL', 'x', '2.1.0')`.execute(h.db)).rejects.toThrow(/cte_definitions_code_version_uq/);
  });

  it('rollback: una publicación que falla no deja versión, definiciones ni retiradas parciales', async () => {
    const count = async () => (await sql<{ r: number; d: number; t: number; l: number }>`
      SELECT (SELECT count(*)::int FROM cte_catalog_releases) AS r, (SELECT count(*)::int FROM cte_definitions) AS d,
             (SELECT count(*)::int FROM cte_definition_retirements) AS t, (SELECT count(*)::int FROM cte_operation_links) AS l`.execute(h.db)).rows[0];
    const before = await count();
    await expect(h.db.transaction().execute((trx) => publishCteRelease(trx as unknown as Kysely<unknown>, {
      version: '2.2.0', source: 'prueba', notes: 'falla',
      publish: [{ code: 'SALE', name: 'Venta', description: 'nueva', stage: 'OUTBOUND', source: 'prueba', links: [] }],
      retire: [{ code: 'NO_EXISTE', reason: 'x' }],
    }))).rejects.toThrow(/no tiene una definición vigente/);
    expect(await count()).toEqual(before);
    expect((await cat('admin-a@test.local').expect(200)).body.current_release.version).toBe('2.1.0');
  });

  it('operación integrada frente a vínculo pendiente: el modelo distingue ambos estados', async () => {
    await h.db.transaction().execute((trx) => publishCteRelease(trx as unknown as Kysely<unknown>, {
      version: '2.3.0', source: 'prueba', notes: 'Vínculo integrado simulado SOLO en la base de pruebas',
      publish: [{ code: 'SHIPMENT', name: 'Embarque', description: 'prueba', stage: 'OUTBOUND', source: 'prueba',
        links: [{ operation: 'SHIPMENT_DISPATCH', event_type: 'ShipmentDispatched', status: 'INTEGRATED', story: 'P0-029', note: 'prueba' }] }],
    }));
    const r = (await cat('admin-a@test.local').expect(200)).body;
    expect(r.definitions.find((d: { code: string }) => d.code === 'SHIPMENT').operations[0].integration_status).toBe('INTEGRATED');
    // DRYING pasó a INTEGRATED el 2026-10-15 (D-32): su cierre existe, se ejecuta y publica su evento.
    expect(r.definitions.find((d: { code: string }) => d.code === 'DRYING').operations[0].integration_status).toBe('INTEGRATED');
    expect(r.summary.integrated_operations).toBe(7); // DELIVERY, RECEPTION, CLASSIFICATION, FERMENTATION, DRYING, STORAGE, SHIPMENT (P0-029; aquí republicada) (WEIGHING redefinido PENDING en la prueba 2.1.0)
  });
});
