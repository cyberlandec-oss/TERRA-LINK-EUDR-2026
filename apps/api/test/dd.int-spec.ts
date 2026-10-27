import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { AuditService } from '../src/audit/audit.service';
import { sha256 } from '../src/dd/requirements';

// Integración P0-022 expediente de debida diligencia con PostgreSQL, S3 y ClamAV reales. Datos SINTÉTICOS.
describeDb('P0-022 expediente: guards, instantánea consistente, revisión, exportación y redacción', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let producer: string;
  let baba: string;
  let center: string;
  let plot: string;
  let lotB: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local';
  const E1 = 'eudr1@test.local';
  const AUD = 'auditor@test.local';

  async function join(o: string, email: string, role: string, admin = ADMIN) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
  }
  /** Lote de una entrega con parcela de origen (con geometría) y evaluación de riesgo. */
  async function lotWithOrigin(o = orgA, q = '80') {
    const d = (await http().post(`${base(o)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: q, unit: 'KG', origins: [{ plot_id: plot }], register: true }).expect(201)).body.delivery;
    const r = (await http().post(`${base(o)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'B', quantity: q, unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    const lot = (await http().post(`${base(o)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r, quantity: q }] }).expect(201)).body.lot.id as string;
    await http().post(`${base(o)}/risk/lots/${lot}/evaluations`).set(as(E1)).send({ operation_id: randomUUID() }).expect(201);
    return lot;
  }
  const createCase = (lot: string, actor = E1, op = randomUUID()) => http().post(`${base(orgA)}/dd-cases`).set(as(actor)).send({ operation_id: op, lot_id: lot, scope_note: 'Expediente sintético de prueba' });
  const capture = (caseId: string, actor = E1, op = randomUUID()) => http().post(`${base(orgA)}/dd-cases/${caseId}/snapshots`).set(as(actor)).send({ operation_id: op });
  const review = (sid: string, action: string, actor = E1, op = randomUUID()) => http().post(`${base(orgA)}/dd-snapshots/${sid}/reviews`).set(as(actor)).send({ operation_id: op, action, reason: 'Revisión sintética' });
  const exp = (sid: string, kind: string, actor = E1, op = randomUUID()) => http().post(`${base(orgA)}/dd-snapshots/${sid}/exports`).set(as(actor)).send({ operation_id: op, kind });
  const status = (snap: { requirements: Array<{ code: string; status: string }> }, code: string) => snap.requirements.find((r) => r.code === code)?.status;

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop DD A', ADMIN);
    orgB = await mk('Coop DD B', 'admin-b@test.local');
    for (const [e, r] of [[E1, 'EUDR_MANAGER'], [AUD, 'AUDITOR'], ['tecnico@test.local', 'FIELD_TECHNICIAN'], ['traz@test.local', 'TRACEABILITY_MANAGER']]) await join(orgA, e, r);
    producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'DD-1', legal_name: 'Finca Expediente Sintética' }).expect(201)).body.id;
    baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CD', name: 'Centro DD', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    plot = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: 'DD-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    await http().post(`${base(orgA)}/plots/${plot}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.1601, -0.8479] }, area_declared_ha: 2 }).expect(201);
    // Lote de otra organización (referencia cruzada).
    const pb = (await http().post(`${base(orgB)}/products`).set(as('admin-b@test.local')).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    const prb = (await http().post(`${base(orgB)}/producers`).set(as('admin-b@test.local')).send({ producer_code: 'B-1', legal_name: 'Finca B' }).expect(201)).body.id;
    const cb = (await http().post(`${base(orgB)}/locations`).set(as('admin-b@test.local')).send({ code: 'CB', name: 'Centro B', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    const db = (await http().post(`${base(orgB)}/deliveries`).set(as('admin-b@test.local')).send({ operation_id: randomUUID(), producer_id: prb, product_id: pb, delivery_date: today, quantity_declared: '10', unit: 'KG', register: true }).expect(201)).body.delivery;
    const rb = (await http().post(`${base(orgB)}/deliveries/${db.id}/receptions`).set(as('admin-b@test.local')).send({ operation_id: randomUUID(), location_id: cb, received_at: new Date().toISOString(), weighing: { method: 'B', quantity: '10', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    lotB = (await http().post(`${base(orgB)}/lots`).set(as('admin-b@test.local')).send({ operation_id: randomUUID(), inputs: [{ reception_id: rb, quantity: '10' }] }).expect(201)).body.lot.id;
  });
  afterAll(async () => h?.close());
  afterEach(() => jest.restoreAllMocks());

  it('guards por requisito (cumplido/pendiente/inválido/no evaluable), permisos y referencias cruzadas; sin identidad protegida', async () => {
    const lot = await lotWithOrigin();
    await createCase(lot, AUD).expect(403);
    await createCase(lot, 'traz@test.local').expect(403);
    expect((await createCase(lotB).expect(422)).body.error.code).toBe('REFERENCE_NOT_FOUND');
    const c = (await createCase(lot).expect(201)).body.case;
    expect(c.case_number).toMatch(/^DD-\d{4}-\d{5}$/);
    expect((await createCase(lot).expect(409)).body.error.code).toBe('CASE_EXISTS');
    await http().get(`${base(orgA)}/dd-cases`).set(as('tecnico@test.local')).expect(403);
    await http().get(`${base(orgA)}/dd-cases/${c.id}`).set(as('admin-b@test.local')).expect(404);
    await http().get(`${base(orgB)}/dd-cases/${c.id}`).set(as('admin-b@test.local')).expect(404);
    await capture(c.id, AUD).expect(403);
    const s = (await capture(c.id).expect(201)).body.snapshot;
    expect(s.readiness.captured).toBe('BLOCKED');
    expect(status(s, 'SUBJECT_QUANTITY')).toBe('MET');
    expect(status(s, 'ORIGIN_DECLARED')).toBe('MET');
    expect(status(s, 'QUALITY_DECIDED')).toBe('PENDING'); // calidad pendiente ≠ aprobación
    expect(status(s, 'DELIVERY_SUPPORTS')).toBe('PENDING'); // D-35 MVP
    for (const code of ['GEOLOCATION_PROFILE', 'DEFORESTATION_ANALYSIS', 'LEGAL_PROFILE', 'RISK_CATALOG_APPROVED', 'REGULATORY_CONCLUSION']) expect(status(s, code)).toBe('NOT_EVALUABLE');
    // D-34.A.1 (2026-10-16): SHIPMENT_LINK dejó de ser NOT_EVALUABLE. La condición está escrita —ítem de
    // embarque con reserva activa— así que es EVALUABLE: aquí el lote no está en ningún embarque, luego PENDING.
    expect(status(s, 'SHIPMENT_LINK')).toBe('PENDING');
    expect(s.summary.percent_met).toBeGreaterThan(0);
    expect(s.summary.met).toBeLessThan(s.summary.total);
    expect(s.submission.status).toBe('NOT_SUBMITTED');
    expect(JSON.stringify(s)).not.toMatch(/Finca Expediente Sintética/);
    await http().get(`${base(orgA)}/dd-snapshots/${s.id}`).set(as('admin-b@test.local')).expect(404);
    expect((await http().get(`${base(orgA)}/dd-cases`).set(as(AUD)).expect(200)).body.cases.length).toBeGreaterThan(0);
  });

  it('instantánea consistente e inmutable; el paquete sale de la instantánea; un cambio relevante la deja desactualizada sin modificarla', async () => {
    const lot = await lotWithOrigin(orgA, '60');
    const c = (await createCase(lot).expect(201)).body.case;
    const s = (await capture(c.id).expect(201)).body.snapshot;
    const row = await h.db.selectFrom('dd_snapshots').selectAll().where('id', '=', s.id).executeTakeFirstOrThrow();
    expect(sha256(row.content)).toBe(row.content_hash);
    expect(s.readiness.effective).toBe('BLOCKED');
    expect((s.manifest as { items: Array<{ kind: string }> }).items.map((i) => i.kind)).toEqual(expect.arrayContaining(['lot', 'delivery', 'plot_version', 'risk_evaluation', 'risk_rule_set']));
    const e = (await exp(s.id, 'INTERNAL_REVIEW').expect(201)).body.export;
    const d1 = await http().get(`${base(orgA)}/dd-exports/${e.id}/download`).set(as(E1)).expect(200);
    expect(d1.headers['content-disposition']).toMatch(/borrador-interno\.json/);
    expect(sha256(d1.text)).toBe(e.package_hash);
    const pkg = JSON.parse(d1.text);
    expect(pkg).toMatchObject({ kind: 'INTERNAL_REVIEW', submission: { status: 'NOT_SUBMITTED' }, readiness: 'BLOCKED' });
    expect(pkg.disclaimer).toMatch(/no es presentar una DDS/);
    expect(pkg.content.plots[0].geometry).toMatchObject({ type: 'Point' });
    expect(pkg).toMatchObject({ artifact: { kind: 'INTERNAL_REVIEW', is_final_package: false, is_official_submission: false }, attachments: { included: false } });
    expect(pkg.pending.map((x: { code: string }) => x.code)).toEqual(['ATTACHMENT_FILES_NOT_INCLUDED', 'DESTINATION_PROFILE_FIELDS']);
    // Cambio relevante: nueva evaluación de riesgo.
    await http().post(`${base(orgA)}/risk/lots/${lot}/evaluations`).set(as(E1)).send({ operation_id: randomUUID() }).expect(201);
    const after = (await http().get(`${base(orgA)}/dd-snapshots/${s.id}`).set(as(E1)).expect(200)).body;
    expect(after.readiness.effective).toBe('STALE');
    expect(after.readiness.changed_sections).toContain('risk');
    expect((await h.db.selectFrom('dd_snapshots').select('content_hash').where('id', '=', s.id).executeTakeFirstOrThrow()).content_hash).toBe(row.content_hash);
    const d2 = await http().get(`${base(orgA)}/dd-exports/${e.id}/download`).set(as(E1)).expect(200);
    expect(d2.text).toBe(d1.text); // no lee datos cambiantes
    await expect(sql`UPDATE dd_snapshots SET readiness = 'READY' WHERE id = ${s.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM dd_exports WHERE id = ${e.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    const s2 = (await capture(c.id).expect(201)).body.snapshot;
    expect(s2.snapshot_number).toBe(2);
    expect(s2.readiness.effective).not.toBe('STALE');
    // La instantánea anterior ya no se revisa.
    expect((await review(s.id, 'START_REVIEW').expect(409)).body.error.code).toBe('SNAPSHOT_SUPERSEDED');
  });

  it('revisión autorizada: aprobar y exportar el paquete se rechazan sin preparación; borrador permitido; auditoría', async () => {
    const lot = await lotWithOrigin(orgA, '40');
    const c = (await createCase(lot).expect(201)).body.case;
    const s = (await capture(c.id).expect(201)).body.snapshot;
    expect((await review(s.id, 'APPROVE').expect(409)).body.error.code).toBe('INVALID_TRANSITION');
    await review(s.id, 'START_REVIEW', AUD).expect(403);
    await review(s.id, 'START_REVIEW').expect(201);
    const ap = (await review(s.id, 'APPROVE').expect(409)).body.error;
    expect(ap.code).toBe('READINESS_NOT_MET');
    expect(ap.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['RISK_CATALOG_APPROVED', 'REGULATORY_CONCLUSION', 'LEGAL_PROFILE']));
    const ex = (await exp(s.id, 'DD_PACKAGE').expect(409)).body.error;
    expect(ex.code).toBe('READINESS_NOT_MET');
    expect(await h.db.selectFrom('dd_exports').select('id').where('snapshot_id', '=', s.id).execute()).toHaveLength(0);
    const denied = await h.db.selectFrom('audit_logs').select(['action', 'result']).where('organization_id', '=', orgA).where('action', '=', 'dd.export_package').where('result', '=', 'DENIED').execute();
    expect(denied.length).toBeGreaterThan(0);
    await exp(s.id, 'INTERNAL_REVIEW', AUD).expect(403);
    await review(s.id, 'RETURN').expect(201);
    expect((await review(s.id, 'START_REVIEW').expect(409)).body.error.code).toBe('INVALID_TRANSITION');
    const view = (await http().get(`${base(orgA)}/dd-snapshots/${s.id}`).set(as(E1)).expect(200)).body;
    expect(view.review.process_status).toBe('RETURNED');
    expect(view.actions.export_package).toBe(false);
    const acts = (await h.db.selectFrom('audit_logs').select('action').where('organization_id', '=', orgA).where('entity_id', '=', c.id).execute()).map((a) => a.action);
    expect(acts).toEqual(expect.arrayContaining(['dd.create_case', 'dd.capture_snapshot', 'dd.start_review', 'dd.return']));
    const evs = (await h.db.selectFrom('domain_events').select(['event_type', 'aggregate_version']).where('aggregate_id', '=', c.id).orderBy('aggregate_version').execute()).map((e) => e.event_type);
    expect(evs).toEqual(['DdCaseCreated', 'DdSnapshotCaptured', 'DdReviewRecorded', 'DdReviewRecorded']);
  });

  it('idempotencia, rollback atómico y redacción por alcance (geometría)', async () => {
    const lot = await lotWithOrigin(orgA, '30');
    const op = randomUUID();
    const c1 = (await createCase(lot, E1, op).expect(201)).body;
    const c2 = (await createCase(lot, E1, op).expect(201)).body;
    expect(c2.replayed).toBe(true);
    expect(c2.case.id).toBe(c1.case.id);
    const sop = randomUUID();
    const s1 = (await capture(c1.case.id, E1, sop).expect(201)).body;
    const s2 = (await capture(c1.case.id, E1, sop).expect(201)).body;
    expect(s2.replayed).toBe(true);
    expect(s2.snapshot.id).toBe(s1.snapshot.id);
    const eop = randomUUID();
    const e1 = (await exp(s1.snapshot.id, 'INTERNAL_REVIEW', E1, eop).expect(201)).body;
    expect((await exp(s1.snapshot.id, 'INTERNAL_REVIEW', E1, eop).expect(201)).body.export.id).toBe(e1.export.id);
    expect((await exp(s1.snapshot.id, 'DD_PACKAGE', E1, eop).expect(409)).body.error.code).toBe('OPERATION_ID_REUSED');
    // Rollback: si la auditoría falla, no queda instantánea, evento ni auditoría parcial.
    const before = (await h.db.selectFrom('dd_snapshots').select('id').where('case_id', '=', c1.case.id).execute()).length;
    jest.spyOn(AuditService.prototype, 'record').mockRejectedValueOnce(new Error('fallo simulado'));
    await capture(c1.case.id).expect(500);
    expect((await h.db.selectFrom('dd_snapshots').select('id').where('case_id', '=', c1.case.id).execute()).length).toBe(before);
    expect((await h.db.selectFrom('domain_events').select('event_id').where('aggregate_id', '=', c1.case.id).where('event_type', '=', 'DdSnapshotCaptured').execute()).length).toBe(before);
    // Redacción: el auditor (sin plot:read_geometry) no recibe coordenadas; conserva el hash.
    const audView = (await http().get(`${base(orgA)}/dd-snapshots/${s1.snapshot.id}`).set(as(AUD)).expect(200)).body;
    expect(audView.redacted.geometry).toBe(true);
    expect(audView.content.plots[0]).toMatchObject({ geometry: null, plot_code: 'DD-1-P1' });
    expect(audView.content.plots[0].geometry_hash).toBeTruthy();
    expect(JSON.stringify(audView)).not.toMatch(/-80\.1601/);
    const admView = (await http().get(`${base(orgA)}/dd-snapshots/${s1.snapshot.id}`).set(as(E1)).expect(200)).body;
    expect(admView.content.plots[0].geometry).toMatchObject({ type: 'Point' });
    await http().get(`${base(orgA)}/dd-exports/${e1.export.id}/download`).set(as(AUD)).expect(403);
  });

  it('vigencia: la superficie declarada deja desactualizados riesgo, expediente y GIS sin modificarlos; una edición descriptiva no', async () => {
    const lot = await lotWithOrigin(orgA, '40');
    const gis = (await http().post(`${base(orgA)}/plots/${plot}/gis-evaluations`).set(as(E1)).send({ operation_id: randomUUID() }).expect(201)).body.evaluation;
    const risk = (await http().post(`${base(orgA)}/risk/lots/${lot}/evaluations`).set(as(E1)).send({ operation_id: randomUUID() }).expect(201)).body.evaluation;
    const c = (await createCase(lot).expect(201)).body.case;
    const s = (await capture(c.id).expect(201)).body.snapshot;
    const riskRow = await h.db.selectFrom('risk_evaluations').selectAll().where('id', '=', risk.id).executeTakeFirstOrThrow();
    const snapRow = await h.db.selectFrom('dd_snapshots').selectAll().where('id', '=', s.id).executeTakeFirstOrThrow();
    const gisRow = await h.db.selectFrom('gis_evaluations').selectAll().where('id', '=', gis.id).executeTakeFirstOrThrow();
    const getAll = async () => ({
      snap: (await http().get(`${base(orgA)}/dd-snapshots/${s.id}`).set(as(E1)).expect(200)).body,
      risk: (await http().get(`${base(orgA)}/risk/evaluations/${risk.id}`).set(as(E1)).expect(200)).body,
      gis: (await http().get(`${base(orgA)}/gis-evaluations/${gis.id}`).set(as(E1)).expect(200)).body,
    });
    const before = await getAll();
    expect(before.risk.freshness.status).toBe('CURRENT');
    expect(before.gis.stale).toBe(false);
    // 1) Edición descriptiva (nombre): no interviene en riesgo, expediente ni GIS → siguen vigentes.
    const p0 = await h.db.selectFrom('plots').select('row_version').where('id', '=', plot).executeTakeFirstOrThrow();
    await http().patch(`${base(orgA)}/plots/${plot}`).set(as(ADMIN)).send({ expected_version: Number(p0.row_version), name: 'Nombre nuevo' }).expect(200);
    const mid = await getAll();
    expect(mid.snap.readiness.effective).toBe(before.snap.readiness.effective);
    expect(mid.risk.freshness.status).toBe('CURRENT');
    expect(mid.gis.stale).toBe(false);
    // 2) Superficie declarada: versión nueva (misma geometría) → todo lo que dependía de la versión queda desactualizado.
    const p1 = await h.db.selectFrom('plots').select('row_version').where('id', '=', plot).executeTakeFirstOrThrow();
    await http().post(`${base(orgA)}/plots/${plot}/declared-area`).set(as(ADMIN)).send({ expected_version: Number(p1.row_version), area_declared_ha: 2.75 }).expect(201);
    const after = await getAll();
    expect(after.snap.readiness.effective).toBe('STALE');
    expect(after.snap.readiness.changed_sections).toContain('plots');
    expect(after.risk.freshness.status).toBe('STALE');
    expect(after.gis).toMatchObject({ stale: true, stale_reasons: ['PLOT_VERSION_CHANGED_SAME_GEOMETRY'] });
    // Resultados históricos intactos; nada favorable se atribuye.
    expect(await h.db.selectFrom('risk_evaluations').selectAll().where('id', '=', risk.id).executeTakeFirstOrThrow()).toEqual(riskRow);
    expect(await h.db.selectFrom('dd_snapshots').selectAll().where('id', '=', s.id).executeTakeFirstOrThrow()).toEqual(snapRow);
    expect(await h.db.selectFrom('gis_evaluations').selectAll().where('id', '=', gis.id).executeTakeFirstOrThrow()).toEqual(gisRow);
    expect(after.risk.result ?? null).toEqual(before.risk.result ?? null);
    const cur = await h.db.selectFrom('plots').select('current_version_id').where('id', '=', plot).executeTakeFirstOrThrow();
    expect(await h.db.selectFrom('gis_evaluations').select('id').where('plot_version_id', '=', cur.current_version_id!).execute()).toHaveLength(0);
  });
});
