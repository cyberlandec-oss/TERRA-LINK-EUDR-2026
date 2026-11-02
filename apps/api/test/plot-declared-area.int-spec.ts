import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { AuditService } from '../src/audit/audit.service';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Superficie declarada que conserva la geometría vigente (adopción para desarrollo local 2026-10-12;
// docs/decisiones/SUPERFICIE-DECLARADA-CONSERVA-GEOMETRIA.md) contra PostgreSQL/PostGIS real.
describeDb('Parcela: actualizar superficie declarada conservando la geometría', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let org: string;
  let producer: string;
  const http = () => h.http();
  const as = (email: string) => h.as(email);
  const base = () => `/api/v1/organizations/${org}/plots`;
  const ADMIN = 'admin@test.local';
  const square = { type: 'Polygon', coordinates: [[[-80.16, -0.85], [-80.159, -0.85], [-80.159, -0.849], [-80.16, -0.849], [-80.16, -0.85]]] };
  const rowVersion = async (id: string) => Number((await h.db.selectFrom('plots').select('row_version').where('id', '=', id).executeTakeFirstOrThrow()).row_version);
  const versions = (id: string) => h.db.selectFrom('plot_versions').select(['id', 'version_number', 'survey_method', 'geometry_type', 'geometry_hash', 'surveyed_at', sql<string | null>`accuracy_m::text`.as('accuracy'),
    sql<string | null>`area_declared_ha::text`.as('declared'), sql<string | null>`area_calculated_ha::text`.as('calc'), 'validation_status', 'previous_version_id', 'geometry_origin_version_id', 'source_import_id', 'notes', 'created_at'])
    .where('plot_id', '=', id).orderBy('version_number').execute();
  const area = (id: string, expected: number, ha: number, actor = ADMIN) => http().post(`${base()}/${id}/declared-area`).set(as(actor)).send({ expected_version: expected, area_declared_ha: ha });
  const newPlot = async (code: string) => (await http().post(base()).set(as(ADMIN)).send({ producer_id: producer, plot_code: code, crop: 'Cacao' }).expect(201)).body.id as string;

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    org = (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: 'Asociación S', organization_type: 'ASSOCIATION', country: 'EC', initial_admin_email: ADMIN }).expect(201)).body.id;
    for (const [email, role] of [['auditor@test.local', 'AUDITOR'], ['tecnico@test.local', 'FIELD_TECHNICIAN']]) {
      const inv = await http().post(`/api/v1/organizations/${org}/invitations`).set(as(ADMIN)).send({ email, role_code: role }).expect(201);
      await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
      await h.login(email);
    }
    producer = (await http().post(`/api/v1/organizations/${org}/producers`).set(as(ADMIN)).send({ producer_code: 'PRD-S', first_name: 'Ana', last_name: 'Sup' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());

  it('con polígono: versión nueva con la geometría EXACTA, sin presentarse como captura; superficies separadas; anteriores intactas', async () => {
    const id = await newPlot('PAR-POLY');
    await http().post(`${base()}/${id}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: square, surveyed_at: '2026-09-01T10:00:00Z' }).expect(201);
    const before = await versions(id);
    const captured = before[0];
    const r = await area(id, 2, 1.75).expect(201);
    expect(r.body.geometry_kept).toBe(true);
    expect(r.body.version).toMatchObject({ change_kind: 'DECLARED_AREA_UPDATE', geometry_origin_version_id: captured.id, geometry_origin_version_number: 1, area_declared_ha: '1.7500', area_calculated_ha: captured.calc, validation_status: 'NOT_VALIDATED' });
    expect(r.body.plot.geometry_status).toBe('GEOMETRY_RECORDED');
    const after = await versions(id);
    expect(after[0]).toEqual(captured);
    expect(after[1]).toMatchObject({ survey_method: 'MANUAL_COORDINATES', geometry_type: 'POLYGON', geometry_hash: captured.geometry_hash, surveyed_at: captured.surveyed_at, declared: '1.7500', calc: captured.calc, previous_version_id: captured.id, geometry_origin_version_id: captured.id });
    expect(Number(after[1].calc)).not.toBe(1.75); // declarada ≠ calculada
    const eq = await sql<{ same: boolean }>`SELECT ST_AsBinary(a.geometry) = ST_AsBinary(b.geometry) AS same FROM plot_versions a, plot_versions b WHERE a.id = ${after[1].id} AND b.id = ${captured.id}`.execute(h.db);
    expect(eq.rows[0].same).toBe(true);
    // Una segunda actualización apunta a la versión CAPTURADA (no a la copia intermedia).
    await area(id, 3, 2).expect(201);
    const third = (await versions(id))[2];
    expect(third).toMatchObject({ geometry_origin_version_id: captured.id, previous_version_id: after[1].id, geometry_hash: captured.geometry_hash, declared: '2.0000' });
    const hist = await h.db.selectFrom('plot_history').select('change_type').where('plot_id', '=', id).orderBy('row_version').execute();
    expect(hist.map((x) => x.change_type)).toEqual(['CREATE', 'GEOMETRY_VERSION', 'DECLARED_AREA', 'DECLARED_AREA']);
    const ev = await h.db.selectFrom('domain_events').select(['event_type', 'payload']).where('aggregate_id', '=', id).orderBy('aggregate_version').execute();
    expect(ev.map((e) => e.event_type)).toEqual(['PlotRegistered', 'PlotGeometryVersionCreated', 'PlotDeclaredAreaUpdated', 'PlotDeclaredAreaUpdated']);
    expect(JSON.stringify(ev.map((e) => e.payload))).not.toContain('-80.16');
  });

  it('no hereda evaluaciones GIS: las anteriores siguen en su versión y la nueva queda sin evaluar', async () => {
    const id = await newPlot('PAR-GIS');
    await http().post(`${base()}/${id}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: square }).expect(201);
    const evaluation = (await http().post(`/api/v1/organizations/${org}/plots/${id}/gis-evaluations`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201)).body;
    const evBefore = await h.db.selectFrom('gis_evaluations').selectAll().where('plot_id', '=', id).execute();
    const r = await area(id, 2, 1.1).expect(201);
    const evAfter = await h.db.selectFrom('gis_evaluations').selectAll().where('plot_id', '=', id).execute();
    expect(evAfter).toEqual(evBefore);
    expect(evAfter.every((e) => e.plot_version_id !== r.body.version.id)).toBe(true);
    expect(r.body.version.validation_status).toBe('NOT_VALIDATED');
    expect(evBefore.map((e) => e.id)).toContain(evaluation.evaluation.id);
  });

  it('con punto capturado: conserva la procedencia de la muestra (de la versión capturada)', async () => {
    const id = await newPlot('PAR-PUNTO');
    await http().post(`${base()}/${id}/location-samples`).set(as(ADMIN)).send({ operation_id: randomUUID(), source: 'BROWSER_GEOLOCATION', longitude: -80.1601234, latitude: -0.8479876, accuracy_m: 7.5, captured_at: new Date().toISOString(), expected_version: 1 }).expect(201);
    const r = await area(id, 2, 0.8).expect(201);
    expect(r.body.version).toMatchObject({ change_kind: 'DECLARED_AREA_UPDATE', geometry_type: 'POINT', area_calculated_ha: null, survey_method: 'BROWSER_GEOLOCATION', sample: { source: 'BROWSER_GEOLOCATION', horizontal_accuracy_m: 7.5 } });
    const samples = await h.db.selectFrom('location_samples').select('plot_version_id').where('plot_id', '=', id).execute();
    expect(samples).toHaveLength(1); // no se crea una muestra nueva
  });

  it('sin geometría: versión DECLARED (como antes); el formulario de versión DECLARED usa el mismo caso de uso', async () => {
    const id = await newPlot('PAR-DECL');
    const r = await area(id, 1, 2.5).expect(201);
    expect(r.body).toMatchObject({ geometry_kept: false, version: { change_kind: 'DECLARED_AREA', geometry_type: null, survey_method: 'DECLARED', area_declared_ha: '2.5000' } });
    await http().post(`${base()}/${id}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 2, survey_method: 'MANUAL_COORDINATES', geometry: square }).expect(201);
    const viaForm = await http().post(`${base()}/${id}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 3, survey_method: 'DECLARED', area_declared_ha: 3 }).expect(201);
    expect(viaForm.body.version).toMatchObject({ change_kind: 'DECLARED_AREA_UPDATE', geometry_type: 'POLYGON', area_declared_ha: '3.0000' });
    expect(viaForm.body.plot.geometry_status).toBe('GEOMETRY_RECORDED');
  });

  it('misma superficie → NO_CHANGE; versión obsoleta y concurrencia → 409 sin escribir', async () => {
    const id = await newPlot('PAR-CONC');
    await area(id, 1, 2).expect(201);
    expect((await area(id, 2, 2).expect(409)).body.error.code).toBe('NO_CHANGE');
    expect((await area(id, 1, 3).expect(409)).body.error.code).toBe('VERSION_CONFLICT');
    const [a, b] = await Promise.all([area(id, 2, 4), area(id, 2, 5)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await versions(id)).toHaveLength(2);
  });

  it('rollback: un fallo en la auditoría no deja versión, historial ni evento', async () => {
    const id = await newPlot('PAR-RB');
    await http().post(`${base()}/${id}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: square }).expect(201);
    const v0 = await versions(id);
    const spy = jest.spyOn(AuditService.prototype, 'record').mockRejectedValueOnce(new Error('fallo inyectado'));
    try {
      await area(id, 2, 1.5).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await versions(id)).toEqual(v0);
    expect(await rowVersion(id)).toBe(2);
    expect(await h.db.selectFrom('domain_events').select('event_id').where('aggregate_id', '=', id).where('event_type', '=', 'PlotDeclaredAreaUpdated').execute()).toHaveLength(0);
  });

  it('permisos: auditoría 403; técnico fuera de su asignación 404; la base rechaza una copia con otra geometría', async () => {
    const id = await newPlot('PAR-PERM');
    await area(id, 1, 1, 'auditor@test.local').expect(403);
    await area(id, 1, 1, 'tecnico@test.local').expect(404);
    await http().post(`${base()}/${id}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: square }).expect(201);
    const cap = (await versions(id))[0];
    await expect(sql`INSERT INTO plot_versions (id, organization_id, plot_id, version_number, geometry, geometry_type, geometry_hash, area_declared_ha, survey_method, validation_status, validation_rule_version, created_by, geometry_origin_version_id)
      SELECT gen_random_uuid(), organization_id, plot_id, 9, ST_Translate(geometry, 0.001, 0), geometry_type, 'x', 1, survey_method, 'NOT_VALIDATED', validation_rule_version, created_by, id FROM plot_versions WHERE id = ${cap.id}`.execute(h.db)).rejects.toThrow(/no coincide/);
  });
});
