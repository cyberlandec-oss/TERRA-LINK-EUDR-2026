import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// AJ-08 (H7/H8 del plan de revisión): el análisis satelital como ENTRADA del riesgo y del expediente. PostgreSQL real, datos SINTÉTICOS.
// Lo que se acredita: (1) un resultado nuevo deja desactualizada la evaluación que no lo incluía SIN reescribirla; (2) sin resultados nada cambia;
// (3) el expediente separa «análisis recibido» de «criterio satisfecho»: sintético, de otro proveedor o con cobertura no declarada NO lo satisfacen.
describeDb('AJ-08 análisis satelital → riesgo → expediente', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let producer: string;
  let baba: string;
  let center: string;
  let plot: string;
  let versionId: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local';
  const E1 = 'eudr1@test.local';

  async function join(o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(ADMIN)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
  }
  async function lotWithOrigin(q = '80') {
    const d = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: q, unit: 'KG', origins: [{ plot_id: plot }], register: true }).expect(201)).body.delivery;
    const r = (await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'B', quantity: q, unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    return (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r, quantity: q }] }).expect(201)).body.lot.id as string;
  }
  const evaluate = (lot: string) => http().post(`${base(orgA)}/risk/lots/${lot}/evaluations`).set(as(E1)).send({ operation_id: randomUUID() });
  const view = async (id: string) => (await http().get(`${base(orgA)}/risk/evaluations/${id}`).set(as(E1)).expect(200)).body;
  const dbRow = (id: string) => h.db.selectFrom('risk_evaluations').select(['snapshot_hash', 'snapshot']).where('id', '=', id).executeTakeFirstOrThrow();

  /** Inserta un trabajo terminado con su resultado, como lo dejaría el corredor. */
  async function resultado(over: { provider: string; synthetic: boolean; coverage: 'COVERED' | 'PARTIAL' | 'NOT_COVERED' | 'UNKNOWN' }) {
    const uid = (await h.db.selectFrom('users').select('id').where('email', '=', ADMIN).executeTakeFirstOrThrow()).id;
    const v = await h.db.selectFrom('plot_versions').select(['geometry_hash', 'geometry_type']).where('id', '=', versionId).executeTakeFirstOrThrow();
    const job = randomUUID();
    await h.db.insertInto('satellite_jobs').values({
      id: job, organization_id: orgA, plot_id: plot, plot_version_id: versionId, geometry_hash: v.geometry_hash!, geometry_type: v.geometry_type as 'POINT',
      provider_code: over.provider, provider_kind: over.synthetic ? 'SYNTHETIC_FIXTURE' : 'EXTERNAL_HTTP', adapter_contract_version: 'TL_SAT_ADAPTER 0.1.0',
      operation: 'FOREST_COVER', request_fingerprint: randomUUID().replace(/-/g, '').padEnd(64, '0'), status: 'COMPLETED', outcome: 'RESULT_AVAILABLE',
      finished_at: new Date(), requested_by: uid, operation_id: randomUUID(),
    } as never).execute();
    const res = randomUUID();
    await sql`INSERT INTO satellite_results (id, organization_id, job_id, provider_code, is_synthetic, method, coverage_status, coverage_note, limitations, indicators, raw_object_key, raw_sha256)
      VALUES (${res}, ${orgA}, ${job}, ${over.provider}, ${over.synthetic}, 'metodo de prueba', ${over.coverage}, 'nota de cobertura de prueba', 'Resultado sintético de prueba AJ-08.', '{}'::jsonb, ${`aj08/${res}.json`}, ${'a'.repeat(64)})`.execute(h.db);
    return { job, res };
  }
  const setSelected = async (code: string | null) => {
    await sql`UPDATE satellite_providers SET selection_status = 'PROPOSED', selected_by = NULL, decision_reference = NULL WHERE selection_status = 'SELECTED'`.execute(h.db).catch(() => undefined);
    if (!code) return;
    const uid = (await h.db.selectFrom('users').select('id').where('email', '=', ADMIN).executeTakeFirstOrThrow()).id;
    await sql`UPDATE satellite_providers SET selection_status = 'SELECTED', selected_by = ${uid}, decision_reference = 'prueba AJ-08' WHERE code = ${code}`.execute(h.db);
  };

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    orgA = (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: 'Coop Satélite Riesgo', organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: ADMIN }).expect(201)).body.id;
    await join(orgA, E1, 'EUDR_MANAGER');
    producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'SR-1', legal_name: 'Finca Satélite Riesgo' }).expect(201)).body.id;
    baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CS', name: 'Centro satélite', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    plot = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: 'SR-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    await http().post(`${base(orgA)}/plots/${plot}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.1601, -0.8479] }, area_declared_ha: 2 }).expect(201);
    versionId = (await h.db.selectFrom('plots').select('current_version_id').where('id', '=', plot).executeTakeFirstOrThrow()).current_version_id!;
  });
  afterAll(async () => { await setSelected(null); await h?.close(); });

  it('H7: sin resultados la instantánea no cambia; un resultado nuevo deja desactualizada la evaluación anterior SIN reescribirla, y la nueva lo incluye con su referencia', async () => {
    const lot = await lotWithOrigin();
    const e0 = (await evaluate(lot).expect(201)).body.evaluation;
    const antes = await dbRow(e0.id);
    expect((antes.snapshot as { satellite?: unknown }).satellite).toBeUndefined();            // sin resultados: la clave ni existe (hashes anteriores intactos)
    expect((await view(e0.id)).freshness.status).toBe('CURRENT');

    await resultado({ provider: 'WHISP', synthetic: false, coverage: 'UNKNOWN' });
    const v0 = await view(e0.id);
    expect(v0.freshness).toMatchObject({ status: 'STALE' });
    expect(v0.freshness.reason).toMatch(/análisis satelitales/);
    expect(v0.satellite_inputs).toMatchObject({ in_evaluation: [], changed_since_evaluation: true });
    expect(v0.satellite_inputs.now).toHaveLength(1);
    expect(v0.satellite_inputs.now[0]).toMatchObject({ provider_code: 'WHISP', is_synthetic: false, coverage_status: 'UNKNOWN', plot_code: 'SR-1-P1', raw_sha256: 'a'.repeat(64) });
    expect(v0.satellite_inputs.note).toMatch(/no es una conclusión de deforestación/);
    const despues = await dbRow(e0.id);
    expect(despues.snapshot_hash).toBe(antes.snapshot_hash);                                 // la evaluación pasada NO se reescribió
    expect(JSON.stringify(despues.snapshot)).toBe(JSON.stringify(antes.snapshot));

    const e1 = (await evaluate(lot).expect(201)).body.evaluation;
    const v1 = await view(e1.id);
    expect(v1.freshness.status).toBe('CURRENT');
    expect(v1.satellite_inputs).toMatchObject({ changed_since_evaluation: false });
    expect(v1.satellite_inputs.in_evaluation).toHaveLength(1);
    expect(v1.technical_result.status).not.toBe('NO_RISK');                                  // ningún resultado satelital convierte la evaluación en favorable
    expect(v1.risk_result.conclusion).toBe('UNDETERMINED');
  });

  it('H7: un resultado SINTÉTICO se incluye rotulado como tal y también desactualiza (nunca como análisis real)', async () => {
    const lot = await lotWithOrigin();
    const e = (await evaluate(lot).expect(201)).body.evaluation;
    await resultado({ provider: 'FIXTURE_SYNTHETIC', synthetic: true, coverage: 'COVERED' });
    const v = await view(e.id);
    expect(v.freshness.status).toBe('STALE');
    expect(v.satellite_inputs.now.find((x: { provider_code: string }) => x.provider_code === 'FIXTURE_SYNTHETIC')).toMatchObject({ is_synthetic: true });
  });

  it('H8: el expediente separa «recibido» de «criterio satisfecho»: sintético, de otro proveedor o sin cobertura declarada NO lo satisfacen; solo real, del proveedor seleccionado y COVERED', async () => {
    const lot = await lotWithOrigin();
    await evaluate(lot).expect(201);
    const c = (await http().post(`${base(orgA)}/dd-cases`).set(as(E1)).send({ operation_id: randomUUID(), lot_id: lot, scope_note: 'Expediente satélite' }).expect(201)).body.case;
    const capture = async () => (await http().post(`${base(orgA)}/dd-cases/${c.id}/snapshots`).set(as(E1)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot;
    const req = (s: { requirements: Array<{ code: string; status: string; detail: string }> }) => s.requirements.find((r) => r.code === 'DEFORESTATION_ANALYSIS')!;
    await setSelected(null);

    // Con los resultados ya presentes (de los casos anteriores) y SIN proveedor seleccionado: recibido, pero ningún requisito.
    const s1 = await capture();
    expect(req(s1)).toMatchObject({ status: 'PENDING' });
    expect(req(s1).detail).toMatch(/Análisis recibido, criterio NO satisfecho/);
    expect(req(s1).detail).toMatch(/no hay proveedor satelital seleccionado/);
    expect(req(s1).detail).toMatch(/sintético\(s\) de ensayo no cuentan/);
    expect(s1.readiness.captured).not.toBe('READY');

    // Proveedor seleccionado (WHISP) con un resultado real de cobertura NO declarada: recibido ≠ suficiente.
    await setSelected('WHISP');
    const s2 = await capture();
    expect(req(s2).status).toBe('PENDING');
    expect(req(s2).detail).toMatch(/cobertura UNKNOWN/);

    // Un resultado COVERED de OTRO proveedor no satisface el criterio del proveedor seleccionado (defecto latente corregido).
    await resultado({ provider: 'GFW', synthetic: false, coverage: 'COVERED' });
    const s3 = await capture();
    expect(req(s3).status).toBe('PENDING');
    expect(req(s3).detail).toMatch(/otro proveedor \(GFW\)/);

    // Control: real, del proveedor seleccionado y COVERED ⇒ criterio satisfecho (sigue sin ser conclusión ni READY por sí solo).
    await resultado({ provider: 'WHISP', synthetic: false, coverage: 'COVERED' });
    const s4 = await capture();
    expect(req(s4).status).toBe('MET');
    expect(req(s4).detail).toMatch(/no es conclusión regulatoria/);
    expect(s4.readiness.captured).not.toBe('READY');   // otros requisitos siguen pendientes
    expect(s4.content.profiles.satellite_analysis.analyses.length).toBeGreaterThan(0);

    // Los expedientes anteriores conservan su contenido y su hash.
    const filas = await h.db.selectFrom('dd_snapshots').select(['id', 'content_hash']).where('case_id', '=', c.id).orderBy('snapshot_number').execute();
    expect(new Set(filas.map((f) => f.content_hash)).size).toBe(filas.length);
  });
});
