import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { Client } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { join as pathJoin } from 'path';
import { PASSWORD, TEST_URL, describeDb, setupHarness } from './helpers';
import { PG_SESSION_OPTIONS } from '../src/db/database';

// Integración P0-010 (evaluación GIS técnica TL_GIS_TECH), PostGIS real.
describeDb('P0-010 evaluación GIS técnica (PostGIS real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let p1: string; // asignado a tecnico1
  let p2: string; // asignado a tecnico2
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const org = () => `/api/v1/organizations/${orgA}`;
  const ring = (pts: number[][]) => [...pts, pts[0]];
  const sq = (x: number, y: number, d = 0.01) => ring([[x, y], [x + d, y], [x + d, y + d], [x, y + d]]);
  const S = sq(-79.5, -1.0);
  const S_REORDERED = ring([[-79.49, -0.99], [-79.49, -1.0], [-79.5, -1.0], [-79.5, -0.99]]); // otro inicio y sentido
  const plots: Record<string, string> = {};
  const evaluate = (actor: string, plot: string, extra: Record<string, unknown> = {}) =>
    http().post(`${org()}/plots/${plot}/gis-evaluations`).set(as(actor)).send({ operation_id: randomUUID(), ...extra });
  type Chk = { code: string; outcome: string; reason_code: string | null; details: Record<string, string> };
  const check = (ev: { checks: Chk[] }, code: string) => ev.checks.find((c) => c.code === code)!;
  const rowVersion = async (id: string) => Number((await h.db.selectFrom('plots').select('row_version').where('id', '=', id).executeTakeFirstOrThrow()).row_version);

  async function join(admin: string, o: string, email: string, role: string) {
    const inv = await http().post(`/api/v1/organizations/${o}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const mid = async (email: string) =>
    (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow()).id;
  async function mkPlot(code: string, producer: string, geometry?: unknown) {
    const id = (await http().post(`${org()}/plots`).set(as('admin-a@test.local')).send({ producer_id: producer, plot_code: code, crop: 'Cacao' }).expect(201)).body.id;
    if (geometry) await http().post(`${org()}/plots/${id}/geometry-versions`).set(as('admin-a@test.local')).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry }).expect(201);
    plots[code] = id;
    return id;
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
    const mkProducer = async (code: string, tech: string) => (await http().post(`${org()}/producers`).set(as('admin-a@test.local'))
      .send({ producer_code: code, legal_name: `Finca ${code}`, assigned_membership_id: await mid(tech) }).expect(201)).body.id;
    p1 = await mkProducer('P-1', 'tecnico1@test.local');
    p2 = await mkProducer('P-2', 'tecnico2@test.local');
    await mkPlot('A', p1, { type: 'Polygon', coordinates: [S] });
    await mkPlot('B', p2, { type: 'Polygon', coordinates: [S_REORDERED] }); // igual topológicamente, distinto hash
    await mkPlot('H', p2, { type: 'Polygon', coordinates: [S] }); // igual y mismo hash
    await mkPlot('C', p2, { type: 'Polygon', coordinates: [sq(-79.495, -1.0)] }); // solapa con superficie
    await mkPlot('D', p2, { type: 'Polygon', coordinates: [sq(-79.51, -1.0)] }); // solo contacto de borde con A/B/H
    await mkPlot('E', p2, { type: 'Polygon', coordinates: [sq(-78.0, -1.0)] }); // aislada
  });
  afterAll(async () => h?.close());

  it('igualdad topológica con distinto orden ≠ igualdad de hash; solapamiento vs contacto de borde (evaluador con toda la organización)', async () => {
    const res = await evaluate('admin-a@test.local', plots.A).expect(201);
    const admin = res.body.evaluation;
    expect(admin).toMatchObject({ status: 'REVIEW_REQUIRED', status_scope: 'TECHNICAL', view_scope: 'FULL', comparison_scope: 'ORGANIZATION', rule: { id: 'TL_GIS_TECH', version: '1.0.1' }, stale: false });
    expect(admin.status_note).toMatch(/no es conformidad EUDR/);
    expect(check(admin, 'GEOMETRIC_EQUALITY')).toMatchObject({ outcome: 'REVIEW', reason_code: 'EQUAL_GEOMETRY_FOUND' });
    expect(check(admin, 'OVERLAP')).toMatchObject({ outcome: 'REVIEW', reason_code: 'OVERLAP_FOUND' });
    const byCode = Object.fromEntries(admin.relations.map((r: { plot_code: string }) => [r.plot_code, r]));
    expect(byCode.B).toMatchObject({ relation: 'EQUAL', same_hash: false });
    expect(byCode.H).toMatchObject({ relation: 'EQUAL', same_hash: true });
    expect(byCode.C.relation).toBe('OVERLAP');
    expect(Number(byCode.C.shared_area_m2)).toBeGreaterThan(0);
    expect(byCode.D).toMatchObject({ relation: 'TOUCH', shared_area_m2: null });
    expect(byCode.E).toBeUndefined();
    expect(admin).not.toHaveProperty('relations_outside_scope');
  });

  it('privacidad: el técnico no puede inferir coincidencias con parcelas fuera de su alcance (ni identidad, ni tipo, ni cantidad, ni estado)', async () => {
    const z = await mkPlot('Z', p1, { type: 'Polygon', coordinates: [sq(-60.0, -1.0)] }); // asignada y sin coincidencias
    // 1) Evaluaciones hechas por el administrador (alcance de organización), consultadas por el técnico
    const withHidden = (await evaluate('admin-a@test.local', plots.A).expect(201)).body.evaluation; // A tiene B/H/C/D ocultas para tecnico1
    const without = (await evaluate('admin-a@test.local', z).expect(201)).body.evaluation;
    expect(withHidden.status).toBe('REVIEW_REQUIRED'); // el registro real sí lo tiene
    const techA = (await http().get(`${org()}/gis-evaluations/${withHidden.id}`).set(as('tecnico1@test.local')).expect(200)).body;
    const techZ = (await http().get(`${org()}/gis-evaluations/${without.id}`).set(as('tecnico1@test.local')).expect(200)).body;
    const shape = (e: { status: string; view_scope: string; status_note: string; next_action: string; relations: unknown[]; stale_reasons: string[]; checks: Array<{ code: string; outcome: string; reason_code: string | null; message: string; details?: unknown }> }) => ({
      status: e.status, view_scope: e.view_scope, status_note: e.status_note, next_action: e.next_action, relations: e.relations, stale_reasons: e.stale_reasons,
      checks: e.checks.filter((c) => c.code !== 'AREA').map((c) => ({ code: c.code, outcome: c.outcome, reason_code: c.reason_code, message: c.message, details: c.details ?? null })),
    });
    expect(shape(techA)).toEqual(shape(techZ)); // indistinguibles
    expect(techA).toMatchObject({ status: 'VALID', view_scope: 'GEOMETRY_ONLY', relations: [] });
    expect(check(techA, 'GEOMETRIC_EQUALITY')).toMatchObject({ outcome: 'RESTRICTED', reason_code: 'COMPARISON_RESTRICTED' });
    const blob = JSON.stringify(techA);
    expect(techA).not.toHaveProperty('relations_outside_scope');
    const LEAKS = ['"relation"', 'REVIEW_REQUIRED', 'EQUAL_GEOMETRY_FOUND', 'OVERLAP_FOUND', 'TOUCH_ONLY', 'COMPARISONS_INCOMPLETE', 'NO_MATCHES', '"count"', 'touch_only', 'skipped'];
    for (const leak of [...LEAKS, plots.B, plots.C, plots.D, plots.H]) expect(blob).not.toContain(leak);
    // también en el historial visible
    const list = (await http().get(`${org()}/plots/${plots.A}/gis-evaluations`).set(as('tecnico1@test.local')).expect(200)).body;
    for (const leak of LEAKS) expect(JSON.stringify(list)).not.toContain(leak);
    // 2) Evaluación del propio técnico: compara solo con su alcance asignado
    const own = (await evaluate('tecnico1@test.local', plots.A).expect(201)).body.evaluation;
    expect(own).toMatchObject({ comparison_scope: 'EVALUATOR_ASSIGNED', view_scope: 'ASSIGNED_SCOPE', status: 'VALID', relations: [] });
    expect(own.parameters.comparison_scope).toBe('EVALUATOR_ASSIGNED');
    for (const leak of ['"relation"', 'REVIEW_REQUIRED', 'EQUAL_GEOMETRY_FOUND', 'OVERLAP_FOUND']) expect(JSON.stringify(own)).not.toContain(leak);
    // el administrador ve que esa evaluación tuvo alcance limitado (no la confunde con una de organización)
    const adminView = (await http().get(`${org()}/gis-evaluations/${own.id}`).set(as('admin-a@test.local')).expect(200)).body;
    expect(adminView).toMatchObject({ comparison_scope: 'EVALUATOR_ASSIGNED', view_scope: 'FULL', relations: [] });
    // 3) Otro técnico no ve las comparaciones de la evaluación de tecnico1 (tampoco tiene la parcela: 404)
    await http().get(`${org()}/gis-evaluations/${own.id}`).set(as('tecnico2@test.local')).expect(404);
  });

  it('solo contacto por borde → VALID; sin intersección → VALID; perfil de destino NO EVALUADO; precisión no disponible', async () => {
    const d = (await evaluate('admin-a@test.local', plots.D).expect(201)).body.evaluation;
    expect(d.status).toBe('VALID');
    expect(check(d, 'OVERLAP')).toMatchObject({ outcome: 'PASS', reason_code: 'TOUCH_ONLY' });
    const e = (await evaluate('admin-a@test.local', plots.E).expect(201)).body.evaluation;
    expect(e.status).toBe('VALID');
    expect(check(e, 'OVERLAP')).toMatchObject({ outcome: 'PASS', reason_code: 'NO_MATCHES' });
    expect(Number(check(e, 'AREA').details.area_calculated_ha)).toBeGreaterThan(100);
    expect(e.destination_profile).toMatchObject({ status: 'NOT_EVALUATED', reason_code: 'PROFILE_REQUIRES_DEFINITION', decision: 'D-05' });
    expect(e.capture_quality).toMatchObject({ status: 'NOT_AVAILABLE', reason_code: 'NO_CAPTURE_SAMPLES', thresholds: null });
    expect(e.parameters).toMatchObject({ area_threshold_ha: null, accuracy_thresholds: null, destination_profile: null });
  });

  it('inválida: motivo controlado, sin superficie ni comparaciones; ubicación solo con plot:read_geometry; otras parcelas reciben comparación incompleta', async () => {
    const bow = ring([[-77.0, -1.0], [-76.99, -0.99], [-76.99, -1.0], [-77.0, -0.99]]);
    await mkPlot('F', p1, { type: 'Polygon', coordinates: [bow] });
    const f = (await evaluate('admin-a@test.local', plots.F).expect(201)).body.evaluation;
    expect(f.status).toBe('INVALID');
    expect(check(f, 'TECHNICAL_VALIDITY')).toMatchObject({ outcome: 'FAIL', reason_code: 'SELF_INTERSECTION' });
    expect(check(f, 'AREA')).toMatchObject({ outcome: 'NOT_EXECUTED', reason_code: 'REQUIRES_VALID_GEOMETRY' });
    expect(check(f, 'OVERLAP').outcome).toBe('NOT_EXECUTED');
    expect(f.error_location.type).toBe('Point');
    const aud = await http().get(`${org()}/gis-evaluations/${f.id}`).set(as('auditor@test.local')).expect(200);
    expect(aud.body).toMatchObject({ error_location: null, error_location_visible: false, status: 'INVALID' });
    expect(JSON.stringify(aud.body)).not.toMatch(/-7[67]\.\d/);
    await mkPlot('I', p1, { type: 'Polygon', coordinates: [sq(-77.0, -1.0, 0.005)] });
    const i = (await evaluate('admin-a@test.local', plots.I).expect(201)).body.evaluation;
    expect(i.status).toBe('WARNING');
    expect(check(i, 'OVERLAP')).toMatchObject({ outcome: 'WARNING', reason_code: 'COMPARISONS_INCOMPLETE' });
  });

  it('vacía y degenerada → INVALID; versión sin geometría → REVIEW_REQUIRED', async () => {
    const empty = await mkPlot('V', p1);
    await sql`INSERT INTO plot_versions (id, organization_id, plot_id, version_number, geometry, geometry_type, geometry_hash, survey_method, validation_status, validation_rule_version, created_by)
      SELECT gen_random_uuid(), ${orgA}, ${empty}, 1, ST_GeomFromText('POLYGON EMPTY', 4326), 'POLYGON', repeat('e', 64), 'MANUAL_COORDINATES', 'NOT_VALIDATED', 'STRUCTURAL_ONLY_V1', u.id FROM users u WHERE u.email = 'admin-a@test.local'`.execute(h.db);
    await sql`UPDATE plots SET current_version_id = (SELECT id FROM plot_versions WHERE plot_id = ${empty}) WHERE id = ${empty}`.execute(h.db);
    const ve = (await evaluate('admin-a@test.local', empty).expect(201)).body.evaluation;
    expect(ve.status).toBe('INVALID');
    expect(check(ve, 'NOT_EMPTY')).toMatchObject({ outcome: 'FAIL', reason_code: 'GEOMETRY_EMPTY' });
    const deg = await mkPlot('G', p1, { type: 'Polygon', coordinates: [ring([[-75.0, -1.0], [-74.99, -1.0], [-74.98, -1.0]])] });
    const vd = (await evaluate('admin-a@test.local', deg).expect(201)).body.evaluation;
    expect(vd.status).toBe('INVALID');
    expect(check(vd, 'NOT_DEGENERATE')).toMatchObject({ outcome: 'FAIL', reason_code: 'GEOMETRY_DEGENERATE' });
    const declared = await mkPlot('DEC', p1);
    await http().post(`${org()}/plots/${declared}/geometry-versions`).set(as('admin-a@test.local')).send({ expected_version: 1, survey_method: 'DECLARED', area_declared_ha: 3 }).expect(201);
    const vm = (await evaluate('admin-a@test.local', declared).expect(201)).body.evaluation;
    expect(vm.status).toBe('REVIEW_REQUIRED');
    expect(check(vm, 'GEOMETRY_PRESENT')).toMatchObject({ outcome: 'FAIL', reason_code: 'GEOMETRY_MISSING' });
    expect(vm.capture_quality.status).toBe('NOT_APPLICABLE');
  });

  it('punto sin área; huecos y MultiPolygon válidos; precisión ausente, completa, mixta e importada no disponible', async () => {
    const pt = await mkPlot('PT', p1);
    const cap = (acc: number | null, v: number) => http().post(`${org()}/plots/${pt}/location-samples`).set(as('admin-a@test.local'))
      .send({ expected_version: v, operation_id: randomUUID(), source: 'BROWSER_GEOLOCATION', longitude: -73.0, latitude: -1.0, accuracy_m: acc, captured_at: new Date(Date.now() - 60_000).toISOString() }).expect(201);
    await cap(null, 1);
    const p = (await evaluate('admin-a@test.local', pt).expect(201)).body.evaluation;
    expect(p.status).toBe('VALID');
    expect(check(p, 'AREA')).toMatchObject({ outcome: 'NOT_APPLICABLE', reason_code: 'POINT_HAS_NO_AREA' });
    expect(check(p, 'OVERLAP')).toMatchObject({ outcome: 'NOT_EXECUTED', reason_code: 'POINT_OVERLAP_NOT_IN_RULE' });
    expect(p.capture_quality).toMatchObject({ status: 'ABSENT', label: 'Precisión no informada' });
    await cap(5, await rowVersion(pt));
    expect((await evaluate('admin-a@test.local', pt).expect(201)).body.evaluation.capture_quality.status).toBe('COMPLETE');

    const holes = await mkPlot('HO', p1, { type: 'Polygon', coordinates: [sq(-72.0, -1.0, 0.02), sq(-71.995, -0.995, 0.005)] });
    const vh = (await evaluate('admin-a@test.local', holes).expect(201)).body.evaluation;
    expect(vh.status).toBe('VALID');
    const full = (await sql<{ a: string }>`SELECT (ST_Area(ST_MakeEnvelope(-72.0, -1.0, -71.98, -0.98, 4326)::geography) / 10000)::text AS a`.execute(h.db)).rows[0].a;
    expect(Number(check(vh, 'AREA').details.area_calculated_ha)).toBeLessThan(Number(full)); // el hueco no suma
    const mp = await mkPlot('MP', p1, { type: 'MultiPolygon', coordinates: [[sq(-71.0, -1.0)], [sq(-70.9, -1.0)]] });
    expect((await evaluate('admin-a@test.local', mp).expect(201)).body.evaluation.status).toBe('VALID');

    // polígono capturado con precisión mixta (P0-008)
    const dr = await mkPlot('DR', p1);
    let d = (await http().post(`${org()}/plots/${dr}/polygon-drafts`).set(as('admin-a@test.local')).expect(201)).body;
    for (const [lon, lat, acc] of [[-69.0, -1.0, 5], [-68.99, -1.0, null], [-68.99, -0.99, 3]] as Array<[number, number, number | null]>) {
      d = (await http().post(`${org()}/polygon-drafts/${d.id}/vertices`).set(as('admin-a@test.local')).send({ expected_version: d.row_version, operation_id: randomUUID(), source: 'BROWSER_GEOLOCATION', longitude: lon, latitude: lat, accuracy_m: acc, captured_at: new Date(Date.now() - 60_000).toISOString() }).expect(201)).body.draft;
    }
    await http().post(`${org()}/polygon-drafts/${d.id}/confirm`).set(as('admin-a@test.local')).send({ expected_version: d.row_version, plot_expected_version: await rowVersion(dr) }).expect(201);
    const vq = (await evaluate('admin-a@test.local', dr).expect(201)).body.evaluation;
    expect(vq.capture_quality).toMatchObject({ status: 'PARTIAL', samples: 3 });
    expect(vq.capture_quality.label).toContain('(resumen incompleto)');

    // geometría importada: precisión no disponible (no se infiere de decimales)
    const im = await mkPlot('IM', p1);
    const a = await http().post(`${org()}/plots/${im}/geometry-imports`).set(as('admin-a@test.local')).field('operation_id', randomUUID())
      .attach('file', Buffer.from(JSON.stringify({ type: 'Polygon', coordinates: [sq(-67.123456789, -1.123456789)] })), { filename: 'x.geojson', contentType: 'application/geo+json' }).expect(201);
    await http().post(`${org()}/geometry-imports/${a.body.import.id}/confirm`).set(as('admin-a@test.local')).send({ operation_id: randomUUID(), plot_expected_version: await rowVersion(im) }).expect(201);
    const vi = (await evaluate('admin-a@test.local', im).expect(201)).body.evaluation;
    expect(vi.capture_quality).toMatchObject({ status: 'NOT_AVAILABLE', reason_code: 'IMPORTED_WITHOUT_SAMPLES' });
    expect(vi.capture_quality.label).toMatch(/^Precisión de captura no disponible/);
  });

  it('resultados inmutables y versionados; desactualización por geometría, parcelas comparadas y reglas; sin compararse con su propio historial', async () => {
    const first = (await evaluate('admin-a@test.local', plots.E).expect(201)).body.evaluation;
    await expect(sql`UPDATE gis_evaluations SET status = 'VALID' WHERE id = ${first.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM gis_evaluations WHERE id = ${first.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    // otra parcela cambia → resultados anteriores desactualizados (sin modificarlos)
    await mkPlot('E2', p2, { type: 'Polygon', coordinates: [sq(-78.0, -1.0)] }); // igual a E
    const again = (await http().get(`${org()}/gis-evaluations/${first.id}`).set(as('admin-a@test.local')).expect(200)).body;
    expect(again).toMatchObject({ stale: true, status: first.status });
    expect(again.stale_reasons).toContain('COMPARED_PLOTS_CHANGED');
    const second = (await evaluate('admin-a@test.local', plots.E).expect(201)).body.evaluation;
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('REVIEW_REQUIRED');
    // nueva versión de la misma parcela con la geometría anterior: no se compara con su propio historial
    await http().post(`${org()}/plots/${plots.E}/geometry-versions`).set(as('admin-a@test.local')).send({ expected_version: await rowVersion(plots.E), survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Polygon', coordinates: [sq(-78.0, -1.0)] } }).expect(201);
    const old = (await http().get(`${org()}/gis-evaluations/${second.id}`).set(as('admin-a@test.local')).expect(200)).body;
    expect(old.stale_reasons).toContain('GEOMETRY_CHANGED');
    const third = (await evaluate('admin-a@test.local', plots.E).expect(201)).body.evaluation;
    expect(third.relations.map((r: { plot_code: string }) => r.plot_code)).toEqual(['E2']);
    // regla distinta (registro histórico de otra versión de regla) → RULES_CHANGED
    const legacy = randomUUID();
    await sql`INSERT INTO gis_evaluations (id, organization_id, plot_id, plot_version_id, geometry_hash, rule_id, rule_version, parameters, status, checks, capture_quality, destination_profile, compared_set_hash, compared_count, operation_id, evaluated_by)
      SELECT ${legacy}, organization_id, plot_id, plot_version_id, geometry_hash, rule_id, '1.0.0', parameters, status, checks, capture_quality, destination_profile, compared_set_hash, compared_count, gen_random_uuid(), evaluated_by FROM gis_evaluations WHERE id = ${third.id}`.execute(h.db);
    expect((await http().get(`${org()}/gis-evaluations/${legacy}`).set(as('admin-a@test.local')).expect(200)).body.stale_reasons).toEqual(['RULES_CHANGED']);
    const list = (await http().get(`${org()}/plots/${plots.E}/gis-evaluations`).set(as('admin-a@test.local')).expect(200)).body;
    expect(list.length).toBeGreaterThanOrEqual(4);
  });

  it('acceso: auditor consulta sin evaluar; técnico fuera de alcance 404; otra organización 404; organización suspendida 403', async () => {
    await evaluate('auditor@test.local', plots.A).expect(403);
    const list = await http().get(`${org()}/plots/${plots.F}/gis-evaluations`).set(as('auditor@test.local')).expect(200);
    expect(list.body.every((e: { error_location: unknown }) => e.error_location === null)).toBe(true);
    await evaluate('tecnico1@test.local', plots.B).expect(404);
    await http().get(`${org()}/plots/${plots.B}/gis-evaluations`).set(as('tecnico1@test.local')).expect(404);
    await http().post(`/api/v1/organizations/${orgB}/plots/${plots.A}/gis-evaluations`).set(as('admin-b@test.local')).send({ operation_id: randomUUID() }).expect(404);
    await evaluate('admin-b@test.local', plots.A).expect(404);
    await http().post(`/api/v1/organizations/${orgA}/suspend`).set(as('super@test.local')).send({ reason: 'Revisión' }).expect(200);
    expect((await evaluate('admin-a@test.local', plots.A).expect(403)).body.error.code).toBe('ORGANIZATION_SUSPENDED');
    await http().post(`/api/v1/organizations/${orgA}/reactivate`).set(as('super@test.local')).send({ reason: 'Fin' }).expect(200);
    const rule = (await http().get(`${org()}/gis-rules/current`).set(as('auditor@test.local')).expect(200)).body;
    expect(rule).toMatchObject({ id: 'TL_GIS_TECH', version: '1.0.1', parameters: { area_threshold_ha: null } });
  });

  it('reintentos idempotentes y rollback sin efectos parciales; eventos y auditoría sin coordenadas', async () => {
    const op = randomUUID();
    const [a, b] = await Promise.all([evaluate('admin-a@test.local', plots.A, { operation_id: op }), evaluate('admin-a@test.local', plots.A, { operation_id: op })]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.evaluation.id).toBe(b.body.evaluation.id);
    expect((await evaluate('admin-a@test.local', plots.C, { operation_id: op }).expect(409)).body.error.code).toBe('OPERATION_ID_REUSED');
    const count = async () => ({
      ev: (await h.db.selectFrom('gis_evaluations').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow()).n,
      au: (await h.db.selectFrom('audit_logs').select(sql<number>`count(*)::int`.as('n')).where('action', '=', 'plot.gis_evaluate').executeTakeFirstOrThrow()).n,
      evt: (await h.db.selectFrom('domain_events').select(sql<number>`count(*)::int`.as('n')).where('event_type', '=', 'PlotGisEvaluated').executeTakeFirstOrThrow()).n,
    });
    const before = await count();
    await sql`CREATE OR REPLACE FUNCTION p010_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla forzada MARCADOR_SENSIBLE_P010'; END $$`.execute(h.db);
    await sql`CREATE TRIGGER p010_fail BEFORE INSERT ON gis_evaluation_comparisons FOR EACH ROW EXECUTE FUNCTION p010_fail()`.execute(h.db);
    const logs: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => { logs.push(String(m)); });
    try {
      const r = await evaluate('admin-a@test.local', plots.A).expect(500);
      expect(JSON.stringify(r.body)).not.toContain('MARCADOR_SENSIBLE_P010');
    } finally {
      spy.mockRestore();
      await sql`DROP TRIGGER p010_fail ON gis_evaluation_comparisons`.execute(h.db);
      await sql`DROP FUNCTION p010_fail`.execute(h.db);
    }
    expect(await count()).toEqual(before);
    expect(logs.join('\n')).toMatch(/db_error sqlstate=P0001/);
    expect(logs.join(' ')).not.toContain('MARCADOR_SENSIBLE_P010'); // el mensaje de la base no llega a los registros de la API
    const evs = await h.db.selectFrom('domain_events').select('payload').where('event_type', '=', 'PlotGisEvaluated').execute();
    const audits = await h.db.selectFrom('audit_logs').select('after').where('action', '=', 'plot.gis_evaluate').execute();
    expect(JSON.stringify(evs) + JSON.stringify(audits)).not.toMatch(/-7\d\.\d|coordinates/);
  });

  it('NOTICE de PostGIS: ST_IsValid emite coordenadas; las conexiones de la API no los reciben y el código usa ST_IsValidDetail', async () => {
    const bow = "ST_GeomFromText('POLYGON((-80.16 -0.848,-80.159 -0.847,-80.159 -0.848,-80.16 -0.847,-80.16 -0.848))', 4326)";
    const raw = new Client({ connectionString: TEST_URL });
    const notices: string[] = [];
    raw.on('notice', (n) => notices.push(n.message ?? ''));
    await raw.connect();
    await raw.query(`SELECT ST_IsValid(${bow})`);
    await raw.end();
    expect(notices.join(' ')).toMatch(/-80\.15/); // el riesgo existe sin la configuración
    const safe = new Client({ connectionString: TEST_URL, ...PG_SESSION_OPTIONS });
    const none: string[] = [];
    safe.on('notice', (n) => none.push(n.message ?? ''));
    await safe.connect();
    await safe.query(`SELECT ST_IsValid(${bow}), (ST_IsValidDetail(${bow})).valid`);
    await safe.end();
    expect(none).toEqual([]);
    expect((await sql<{ v: string }>`SHOW client_min_messages`.execute(h.db)).rows[0]).toEqual({ client_min_messages: 'warning' });
    const dir = pathJoin(__dirname, '../src/plots');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.spec.ts'))) {
      const code = readFileSync(pathJoin(dir, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code).not.toMatch(/ST_IsValid\(|ST_IsValidReason\(/);
    }
  });
});
