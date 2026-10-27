import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Integración — panel «Evaluación geográfica técnica actual» del expediente (implementación del requisito original GEOLOCATION_PROFILE, I1–I4).
// PostgreSQL real. Datos SINTÉTICOS. El panel es una CONSULTA: no escribe, no recalcula, no entra en el contenido ni en el hash de ninguna instantánea y NO cumple
// GEOLOCATION_PROFILE (D-05.B y la definición de «satisfecho» siguen pendientes).
describeDb('DD: evaluación geográfica técnica actual (consulta separada de la instantánea)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string; let orgB: string; let producer: string; let baba: string; let center: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local'; const E1 = 'eudr1@test.local'; const AUD = 'auditor@test.local'; const TEC = 'tecnico@test.local'; const ADMIN_B = 'admin-b@test.local';
  const point = (x: number, y: number) => ({ type: 'Point', coordinates: [x, y] });

  async function join(o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(ADMIN)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
  }
  /** Parcela con geometría de punto y superficie declarada (o solo superficie declarada si no hay geometría). */
  async function mkPlot(code: string, geometry: unknown | null, declared: number) {
    const id = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: code, crop: 'Cacao' }).expect(201)).body.id as string;
    await http().post(`${base(orgA)}/plots/${id}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: geometry ? 'MANUAL_COORDINATES' : 'DECLARED', ...(geometry ? { geometry } : {}), area_declared_ha: declared }).expect(201);
    return id;
  }
  const evaluate = (plot: string) => http().post(`${base(orgA)}/plots/${plot}/geo-profile/evaluations`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201);
  const newVersion = async (plot: string, x: number) => {
    const rv = Number((await sql<{ row_version: string }>`SELECT row_version FROM plots WHERE id = ${plot}`.execute(h.db)).rows[0].row_version);
    await http().post(`${base(orgA)}/plots/${plot}/geometry-versions`).set(as(ADMIN)).send({ expected_version: rv, survey_method: 'MANUAL_COORDINATES', geometry: point(x, -0.85), area_declared_ha: 2 }).expect(201);
  };
  async function lotFrom(plots: string[]) {
    const d = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: '30', unit: 'KG', origins: plots.map((p) => ({ plot_id: p })), register: true }).expect(201)).body.delivery;
    const r = (await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'B', quantity: '30', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    const lot = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r, quantity: '30' }] }).expect(201)).body.lot.id as string;
    await http().post(`${base(orgA)}/risk/lots/${lot}/evaluations`).set(as(E1)).send({ operation_id: randomUUID() }).expect(201);
    return lot;
  }
  const mkCase = async (lot: string) => (await http().post(`${base(orgA)}/dd-cases`).set(as(E1)).send({ operation_id: randomUUID(), lot_id: lot, scope_note: 'Expediente sintético del panel geográfico' }).expect(201)).body.case.id as string;
  const capture = async (caseId: string) => (await http().post(`${base(orgA)}/dd-cases/${caseId}/snapshots`).set(as(E1)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot;
  const panel = async (caseId: string, who = ADMIN, org = orgA, expectStatus = 200) => (await http().get(`${base(org)}/dd-cases/${caseId}/geo-evaluation`).set(as(who)).expect(expectStatus)).body;
  const byCode = (p: { plots: Array<{ plot_code: string }> }, code: string) => p.plots.find((x) => x.plot_code === code) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const counts = async () => ({
    evals: (await sql<{ n: number }>`SELECT count(*)::int AS n FROM geo_profile_evaluations`.execute(h.db)).rows[0].n,
    events: (await sql<{ n: number }>`SELECT count(*)::int AS n FROM domain_events`.execute(h.db)).rows[0].n,
    audit: (await sql<{ n: number }>`SELECT count(*)::int AS n FROM audit_logs`.execute(h.db)).rows[0].n,
    snaps: (await sql<{ n: number }>`SELECT count(*)::int AS n FROM dd_snapshots`.execute(h.db)).rows[0].n,
  });

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN); await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Panel A', ADMIN); orgB = await mk('Coop Panel B', ADMIN_B);
    for (const [e, r] of [[E1, 'EUDR_MANAGER'], [AUD, 'AUDITOR'], [TEC, 'FIELD_TECHNICIAN']]) await join(orgA, e, r);
    producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'GP-1', legal_name: 'Finca Panel Sintética' }).expect(201)).body.id;
    baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CG', name: 'Centro GP', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());

  it('distingue ausencia, obsolescencia por geometría y por perfil, resultado no evaluable y los tres veredictos; lista los pendientes; solo lee', async () => {
    const pMeets = await mkPlot('GP-MEETS', point(-80.1601, -0.8479), 2);
    const pFails = await mkPlot('GP-FAILS', point(-80.17, -0.85), 5);          // punto > 4 ha → exige polígono
    const pNoGeo = await mkPlot('GP-NOGEO', null, 2);                           // solo superficie declarada → no evaluable
    const pAbsent = await mkPlot('GP-ABSENT', point(-80.18, -0.86), 2);        // nunca evaluada
    const pGeomChanged = await mkPlot('GP-GEOMCHG', point(-80.19, -0.87), 2);   // evaluada y luego cambió la geometría
    const pProfileOld = await mkPlot('GP-PROFOLD', point(-80.2, -0.88), 2);     // evaluada con una versión anterior del perfil
    const lot = await lotFrom([pMeets, pFails, pNoGeo, pAbsent, pGeomChanged, pProfileOld]);
    const caseId = await mkCase(lot);
    for (const p of [pMeets, pFails, pNoGeo, pGeomChanged]) await evaluate(p);
    await newVersion(pGeomChanged, -80.21);
    // La evaluación «de una versión anterior del perfil» se simula insertando una fila (la tabla es append-only: INSERT sí, UPDATE no).
    await evaluate(pMeets); // fila de referencia para clonar
    const pv = (await sql<{ current_version_id: string }>`SELECT current_version_id FROM plots WHERE id = ${pProfileOld}`.execute(h.db)).rows[0].current_version_id;
    await sql`INSERT INTO geo_profile_evaluations (id, organization_id, plot_id, plot_version_id, geometry_hash, profile_id, profile_version, source_service_version, source_document_version, source_page_date,
        parameters, status, checks, area_basis, area_value_ha, exportable, operation_id, evaluated_by)
      SELECT gen_random_uuid(), organization_id, ${pProfileOld}, ${pv}, geometry_hash, profile_id, '0.9.0', source_service_version, source_document_version, source_page_date,
        parameters, status, checks, area_basis, area_value_ha, exportable, gen_random_uuid(), evaluated_by FROM geo_profile_evaluations WHERE plot_id = ${pMeets} LIMIT 1`.execute(h.db);

    const before = await counts();
    const p = await panel(caseId);
    expect(await counts()).toEqual(before); // consultar NO evalúa, no emite eventos ni auditoría y no crea instantáneas
    expect(p).toMatchObject({ kind: 'CURRENT_TECHNICAL_GEO_EVALUATION', not_snapshot_content: true, profile: { id: 'EUDR_GEO_V1' } });
    expect(p.note).toMatch(/No forma parte del contenido de ninguna instantánea/);
    expect(p.counts).toEqual({ total: 6, meets_profile: 1, does_not_meet: 1, review_required: 0, not_evaluable: 1, obsolete: 2, absent: 1 });
    expect(byCode(p, 'GP-MEETS')).toMatchObject({ vigencia: 'CURRENT', evaluation: { status: 'MEETS_PROFILE', profile: { id: 'EUDR_GEO_V1', version: '1.0.0' }, source: { service_version: 'V3', document_version: '1.2' } }, next_action: { code: 'NONE' }, pending: null });
    expect(byCode(p, 'GP-MEETS').evaluation.evaluated_at).toBeTruthy();
    expect(byCode(p, 'GP-MEETS').geometry).toMatchObject({ geometry_type: 'POINT' });
    expect(byCode(p, 'GP-FAILS')).toMatchObject({ vigencia: 'CURRENT', evaluation: { status: 'DOES_NOT_MEET' }, next_action: { code: 'CORRECT_GEOMETRY' } });
    expect(byCode(p, 'GP-FAILS').evaluation.explanation.length).toBeGreaterThan(0);
    expect(byCode(p, 'GP-NOGEO')).toMatchObject({ vigencia: 'CURRENT', evaluation: { status: 'NOT_EVALUABLE' }, next_action: { code: 'COMPLETE_DATA' }, pending: 'NOT_EVALUABLE' });
    expect(byCode(p, 'GP-ABSENT')).toMatchObject({ vigencia: 'ABSENT', reason: 'NEVER_EVALUATED', evaluation: null, next_action: { code: 'EVALUATE_PROFILE', can_act: true }, pending: 'ABSENT' });
    expect(byCode(p, 'GP-GEOMCHG')).toMatchObject({ vigencia: 'OBSOLETE', reason: 'GEOMETRY_VERSION_CHANGED', pending: 'OBSOLETE', next_action: { code: 'EVALUATE_PROFILE' } });
    expect(byCode(p, 'GP-GEOMCHG').evaluation.evaluated_version_number).toBeLessThan(byCode(p, 'GP-GEOMCHG').geometry.version_number); // se ve de qué versión es la evaluación
    expect(byCode(p, 'GP-PROFOLD')).toMatchObject({ vigencia: 'OBSOLETE', reason: 'PROFILE_VERSION_CHANGED', evaluation: { profile: { version: '0.9.0' } }, pending: 'OBSOLETE' });
    expect(p.pending.map((x: { plot_code: string; kind: string }) => `${x.plot_code}:${x.kind}`).sort()).toEqual(['GP-ABSENT:ABSENT', 'GP-GEOMCHG:OBSOLETE', 'GP-NOGEO:NOT_EVALUABLE', 'GP-PROFOLD:OBSOLETE']);
    // «No evaluable» ≠ «ausente» ≠ «obsoleta»: tres razones distintas, nunca una sola bolsa de «sin evaluación».
    expect(new Set(p.pending.map((x: { kind: string }) => x.kind)).size).toBe(3);
    // Reevaluar la obsoleta la devuelve a vigente (se añade otra evaluación; nada se reescribe).
    await evaluate(pGeomChanged); await evaluate(pAbsent);
    const p2 = await panel(caseId);
    expect(byCode(p2, 'GP-GEOMCHG').vigencia).toBe('CURRENT');
    expect(byCode(p2, 'GP-ABSENT').vigencia).toBe('CURRENT');
    expect(p2.counts).toMatchObject({ absent: 0, obsolete: 1 });
  });

  it('permisos: el detalle (explicación y superficie) exige permiso de geometría; recuentos y estado, el alcance del expediente; terceros y otras organizaciones no ven nada', async () => {
    const p1 = await mkPlot('GP-PERM-1', point(-80.3, -0.9), 5);               // DOES_NOT_MEET
    const lot = await lotFrom([p1]);
    const caseId = await mkCase(lot);
    await evaluate(p1);
    const full = await panel(caseId, ADMIN);
    expect(full.plots[0].evaluation.explanation.length).toBeGreaterThan(0);
    expect(full.plots[0].evaluation.area).not.toBeNull();
    expect(full.plots[0].detail_restricted).toBe(false);
    // Auditor: lee el expediente pero NO la geometría → recuentos, estado y veredicto sí; explicación y superficie no.
    const aud = await panel(caseId, AUD);
    expect(aud.counts).toEqual(full.counts);
    expect(aud.plots[0]).toMatchObject({ detail_restricted: true, evaluation: { status: 'DOES_NOT_MEET', explanation: null, area: null } });
    expect(JSON.stringify(aud)).not.toMatch(/coordinates/);
    // Sin permiso del expediente: 403. Otra organización: 404 (por su ruta y por la ajena). Caso inexistente: 404.
    await panel(caseId, TEC, orgA, 403);
    await panel(caseId, ADMIN_B, orgA, 404);
    await panel(caseId, ADMIN_B, orgB, 404);
    await panel(randomUUID(), ADMIN, orgA, 404);
    await http().get(`${base(orgA)}/dd-cases/not-a-uuid/geo-evaluation`).set(as(ADMIN)).expect(400);
  });

  it('las instantáneas no cambian: contenido y hash intactos; el panel no las declara obsoletas; un cambio material en su origen SÍ las desactualiza (mecanismo existente)', async () => {
    const pA = await mkPlot('GP-SNAP-A', point(-80.4, -0.91), 2);
    const pB = await mkPlot('GP-SNAP-B', point(-80.41, -0.92), 2);
    const lot = await lotFrom([pA, pB]);
    const caseId = await mkCase(lot);
    const s1 = await capture(caseId);
    const stored = async () => (await sql<{ content_hash: string; content: unknown; section_hashes: unknown }>`SELECT content_hash, content, section_hashes FROM dd_snapshots WHERE id = ${s1.id}`.execute(h.db)).rows[0];
    const original = await stored();
    const view = async () => (await http().get(`${base(orgA)}/dd-snapshots/${s1.id}`).set(as(ADMIN)).expect(200)).body;
    expect((await view()).readiness.effective).not.toBe('STALE');
    // Consultar el panel y evaluar el perfil (que NO es contenido de la instantánea) no la desactualiza.
    await panel(caseId);
    await evaluate(pA); await evaluate(pB);
    await panel(caseId);
    expect((await view()).readiness.effective).not.toBe('STALE');
    expect(await stored()).toEqual(original);
    expect(JSON.stringify(original.content)).not.toMatch(/EUDR_GEO_V1|geo_profile|MEETS_PROFILE/); // el veredicto técnico NO está en el contenido histórico
    // Un cambio MATERIAL (otra versión de la geometría) sí desactualiza la instantánea, como siempre; y el panel muestra la evaluación como obsoleta.
    await newVersion(pA, -80.45);
    expect((await view()).readiness.effective).toBe('STALE');
    expect(byCode(await panel(caseId), 'GP-SNAP-A')).toMatchObject({ vigencia: 'OBSOLETE', reason: 'GEOMETRY_VERSION_CHANGED' });
    expect(await stored()).toEqual(original); // la instantánea histórica sigue consultable con su contenido original
    expect((await view()).content.plots.map((x: { plot_code: string }) => x.plot_code)).toEqual(['GP-SNAP-A', 'GP-SNAP-B']);
  });

  it('guarda: con TODAS las parcelas en MEETS_PROFILE, GEOLOCATION_PROFILE no pasa a MET ni se habilita READY; aprobar y exportar se rechazan', async () => {
    const pa = await mkPlot('GP-ALL-A', point(-80.5, -0.93), 2);
    const pb = await mkPlot('GP-ALL-B', point(-80.51, -0.94), 3);
    const lot = await lotFrom([pa, pb]);
    const caseId = await mkCase(lot);
    await evaluate(pa); await evaluate(pb);
    const p = await panel(caseId);
    expect(p.counts).toMatchObject({ total: 2, meets_profile: 2, does_not_meet: 0, obsolete: 0, absent: 0 });
    expect(p.pending).toEqual([]);
    expect(p.regulatory.message).toMatch(/NO cumple GEOLOCATION_PROFILE ni habilita READY/);
    const s = await capture(caseId);
    const req = (code: string) => s.requirements.find((r: { code: string }) => r.code === code);
    expect(req('GEOLOCATION_PROFILE').status).toBe('NOT_EVALUABLE');
    expect(s.readiness.effective).not.toBe('READY');
    expect((await panel(caseId)).regulatory.latest_snapshot).toMatchObject({ number: 1, status: 'NOT_EVALUABLE' });
    await http().post(`${base(orgA)}/dd-snapshots/${s.id}/reviews`).set(as(E1)).send({ operation_id: randomUUID(), action: 'START_REVIEW', reason: 'Revisión sintética' }).expect(201);
    const ap = (await http().post(`${base(orgA)}/dd-snapshots/${s.id}/reviews`).set(as(E1)).send({ operation_id: randomUUID(), action: 'APPROVE', reason: 'Intento de aprobación indebida' }).expect(409)).body.error;
    expect(ap.code).toBe('READINESS_NOT_MET');
    expect(ap.details.map((d: { field: string }) => d.field)).toContain('GEOLOCATION_PROFILE');
    const ex = (await http().post(`${base(orgA)}/dd-snapshots/${s.id}/exports`).set(as(E1)).send({ operation_id: randomUUID(), kind: 'DD_PACKAGE' }).expect(409)).body.error;
    expect(ex.code).toBe('READINESS_NOT_MET');
    expect(await h.db.selectFrom('dd_exports').select('id').where('snapshot_id', '=', s.id).execute()).toHaveLength(0);
  });
});
