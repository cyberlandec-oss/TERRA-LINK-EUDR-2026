import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Integración P0-007 (captura de ubicación) y clasificación de geometría exacta (doc 06), PostGIS real.
describeDb('P0-007 ubicación del navegador y acceso a geometría exacta (PostGIS real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let p1: string; // productor asignado a tecnico1
  let plot: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (org: string) => `/api/v1/organizations/${org}/plots`;
  const capture = (actor: string, body: Record<string, unknown>, org = orgA, id = plot) =>
    http().post(`${base(org)}/${id}/location-samples`).set(as(actor)).send(body);
  const rowVersion = async () => (await h.db.selectFrom('plots').select('row_version').where('id', '=', plot).executeTakeFirstOrThrow()).row_version;
  const sample = (over: Record<string, unknown> = {}) => ({
    operation_id: randomUUID(), source: 'BROWSER_GEOLOCATION', longitude: -80.1601234, latitude: -0.8479876,
    accuracy_m: 12.5, captured_at: new Date(Date.now() - 90_000).toISOString(), ...over,
  });

  async function join(admin: string, org: string, email: string, role: string) {
    const inv = await http().post(`/api/v1/organizations/${org}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const mid = async (email: string) =>
    (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow()).id;

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
    await join('admin-a@test.local', orgA, 'eudr@test.local', 'EUDR_MANAGER');
    p1 = (await http().post(`/api/v1/organizations/${orgA}/producers`).set(as('admin-a@test.local'))
      .send({ producer_code: 'P-1', legal_name: 'Finca uno', assigned_membership_id: await mid('tecnico1@test.local') }).expect(201)).body.id;
    plot = (await http().post(base(orgA)).set(as('admin-a@test.local')).send({ producer_id: p1, plot_code: 'PAR-1', crop: 'Cacao' }).expect(201)).body.id;
    await http().post(`${base(orgA)}/${plot}/geometry-versions`).set(as('admin-a@test.local')).send({ expected_version: 1, survey_method: 'DECLARED', area_declared_ha: 3 }).expect(201);
  });
  afterAll(async () => h?.close());

  let firstVersionId: string;

  it('captura válida: muestra original, fuente del navegador, fecha de adquisición y de recepción, punto lon/lat sin superficie', async () => {
    const s = sample();
    const before = Date.now();
    const res = await capture('tecnico1@test.local', { expected_version: Number(await rowVersion()), ...s }).expect(201);
    firstVersionId = res.body.version.id;
    expect(res.body.replayed).toBe(false);
    expect(res.body.version).toMatchObject({
      version_number: 2, geometry_type: 'POINT', survey_method: 'BROWSER_GEOLOCATION', area_calculated_ha: null,
      area_declared_ha: '3.0000', validation_status: 'NOT_VALIDATED',
      geometry: { type: 'Point', coordinates: [-80.1601234, -0.8479876] },
    });
    const row = await h.db.selectFrom('location_samples').selectAll().where('plot_version_id', '=', firstVersionId).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ source: 'BROWSER_GEOLOCATION', longitude: -80.1601234, latitude: -0.8479876, horizontal_accuracy_m: 12.5 });
    expect(new Date(row.captured_at).toISOString()).toBe(s.captured_at); // no se reemplaza por la hora de guardar
    expect(new Date(row.received_at).getTime()).toBeGreaterThanOrEqual(before - 1000); // reloj del servidor
    const pg = await sql<{ x: number; y: number }>`SELECT ST_X(geometry) AS x, ST_Y(geometry) AS y FROM plot_versions WHERE id = ${firstVersionId}`.execute(h.db);
    expect(pg.rows[0]).toEqual({ x: -80.1601234, y: -0.8479876 }); // X = longitud, Y = latitud
  });

  it('precisión: ausente se conserva como null; 0 reportado se conserva como 0; negativa, texto o campo omitido se rechazan', async () => {
    const nullAcc = await capture('admin-a@test.local', { expected_version: Number(await rowVersion()), ...sample({ accuracy_m: null }) }).expect(201);
    expect(nullAcc.body.version.accuracy_m).toBeNull();
    expect(nullAcc.body.version.sample.horizontal_accuracy_m).toBeNull();
    const zero = await capture('admin-a@test.local', { expected_version: Number(await rowVersion()), ...sample({ accuracy_m: 0 }) }).expect(201);
    expect(zero.body.version.sample.horizontal_accuracy_m).toBe(0);
    const v = Number(await rowVersion());
    await capture('admin-a@test.local', { expected_version: v, ...sample({ accuracy_m: -1 }) }).expect(400);
    await capture('admin-a@test.local', { expected_version: v, ...sample({ accuracy_m: '10' }) }).expect(400);
    const withoutAccuracy: Record<string, unknown> = sample();
    delete withoutAccuracy.accuracy_m;
    await capture('admin-a@test.local', { expected_version: v, ...withoutAccuracy }).expect(400);
  });

  it('coordenadas, fecha y fuente inválidas se rechazan sin crear versión ni evento', async () => {
    const v = Number(await rowVersion());
    const events0 = (await h.db.selectFrom('domain_events').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow()).n;
    await capture('admin-a@test.local', { expected_version: v, ...sample({ longitude: -181 }) }).expect(400);
    await capture('admin-a@test.local', { expected_version: v, ...sample({ latitude: 91 }) }).expect(400);
    await capture('admin-a@test.local', { expected_version: v, ...sample({ source: 'GPS' }) }).expect(400);
    await capture('admin-a@test.local', { expected_version: v, ...sample({ captured_at: 'ayer' }) }).expect(400);
    const future = await capture('admin-a@test.local', { expected_version: v, ...sample({ captured_at: new Date(Date.now() + 3_600_000).toISOString() }) }).expect(422);
    expect(future.body.error.code).toBe('CAPTURED_AT_IN_FUTURE');
    expect(Number(await rowVersion())).toBe(v);
    expect((await h.db.selectFrom('domain_events').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow()).n).toBe(events0);
  });

  it('doble envío del mismo operation_id: un solo efecto y el mismo resultado; reutilizarlo con otros datos es conflicto', async () => {
    const s = sample();
    const v = Number(await rowVersion());
    const [a, b] = await Promise.all([
      capture('admin-a@test.local', { expected_version: v, ...s }),
      capture('admin-a@test.local', { expected_version: v, ...s }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.version.id).toBe(b.body.version.id);
    const n = await h.db.selectFrom('location_samples').select(sql<number>`count(*)::int`.as('n')).where('operation_id', '=', s.operation_id).executeTakeFirstOrThrow();
    expect(n.n).toBe(1);
    const retry = await capture('admin-a@test.local', { expected_version: v, ...s }).expect(200); // reintento tras resultado incierto
    expect(retry.body.replayed).toBe(true);
    const reused = await capture('admin-a@test.local', { expected_version: Number(await rowVersion()), ...s, latitude: -0.9 }).expect(409);
    expect(reused.body.error.code).toBe('OPERATION_ID_REUSED');
  });

  it('conflicto concurrente con otra edición: 409 y la muestra no se guarda', async () => {
    const v = Number(await rowVersion());
    await http().patch(`${base(orgA)}/${plot}`).set(as('admin-a@test.local')).send({ expected_version: v, name: 'Lote editado' }).expect(200);
    const res = await capture('tecnico1@test.local', { expected_version: v, ...sample() }).expect(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('alcance del técnico: no asignado 404; reasignación antes de guardar rechaza la captura', async () => {
    await capture('tecnico2@test.local', { expected_version: Number(await rowVersion()), ...sample() }).expect(404);
    const pr = await http().get(`/api/v1/organizations/${orgA}/producers/${p1}`).set(as('admin-a@test.local')).expect(200);
    await http().put(`/api/v1/organizations/${orgA}/producers/${p1}/assignment`).set(as('admin-a@test.local'))
      .send({ expected_version: pr.body.row_version, membership_id: await mid('tecnico2@test.local') }).expect(200);
    await capture('tecnico1@test.local', { expected_version: Number(await rowVersion()), ...sample() }).expect(404);
    await capture('tecnico2@test.local', { expected_version: Number(await rowVersion()), ...sample() }).expect(201);
  });

  it('acceso entre organizaciones rechazado; auditor (sin geometría exacta) no puede capturar', async () => {
    await capture('admin-b@test.local', { expected_version: 1, ...sample() }).expect(404); // ruta de A
    await capture('admin-b@test.local', { expected_version: 1, ...sample() }, orgB, plot).expect(404); // id de A bajo su propia org
    await capture('auditor@test.local', { expected_version: Number(await rowVersion()), ...sample() }).expect(403);
  });

  it('clasificación de geometría: sin plot:read_geometry la API no envía coordenadas (actual, versiones anteriores ni muestras)', async () => {
    const asAuditor = await http().get(`${base(orgA)}/${plot}`).set(as('auditor@test.local')).expect(200);
    expect(asAuditor.body.geometry_access).toBe(false);
    expect(asAuditor.body.current_version.geometry).toBeNull();
    expect(asAuditor.body.current_version.geometry_visible).toBe(false); // booleano real, no texto
    expect(asAuditor.body.current_version.geometry_type).toBe('POINT');
    const versions = await http().get(`${base(orgA)}/${plot}/geometry-versions`).set(as('auditor@test.local')).expect(200);
    const blob = JSON.stringify(versions.body) + JSON.stringify(asAuditor.body);
    expect(blob).not.toContain('-80.16');
    expect(blob).not.toContain('coordinates');
    expect(versions.body.every((v: { geometry: unknown; sample: null | { longitude?: number } }) => v.geometry === null && (v.sample === null || v.sample.longitude === undefined))).toBe(true);
    const old = versions.body.find((v: { id: string }) => v.id === firstVersionId);
    expect(old.sample).toMatchObject({ source: 'BROWSER_GEOLOCATION', horizontal_accuracy_m: 12.5 }); // metadatos sí, coordenadas no
    // Con permiso (EUDR_MANAGER): coordenadas de la versión anterior intactas.
    const asEudr = await http().get(`${base(orgA)}/${plot}/geometry-versions`).set(as('eudr@test.local')).expect(200);
    expect(asEudr.body.find((v: { id: string }) => v.id === firstVersionId).geometry).toEqual({ type: 'Point', coordinates: [-80.1601234, -0.8479876] });
    // Escribir coordenadas manuales también exige la clasificación.
    await http().post(`${base(orgA)}/${plot}/geometry-versions`).set(as('auditor@test.local'))
      .send({ expected_version: Number(await rowVersion()), survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80, -1] } }).expect(403);
  });

  it('versiones inmutables, rollback y eventos/auditoría sin coordenadas exactas', async () => {
    const versions = await h.db.selectFrom('plot_versions').select(['version_number', 'geometry_type', 'area_calculated_ha']).where('plot_id', '=', plot).orderBy('version_number').execute();
    expect(versions.filter((v) => v.geometry_type === 'POINT').every((v) => v.area_calculated_ha === null)).toBe(true);
    await expect(sql`UPDATE location_samples SET latitude = 0`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM plot_versions WHERE id = ${firstVersionId}`.execute(h.db)).rejects.toThrow(/append-only/);
    const leaked = JSON.stringify(await h.db.selectFrom('domain_events').select('payload').where('aggregate_id', '=', plot).execute())
      + JSON.stringify(await h.db.selectFrom('audit_logs').select(['before', 'after']).where('entity_id', '=', plot).execute());
    expect(leaked).not.toContain('-80.16');
    expect(leaked).not.toContain('-0.84');
    expect(leaked).toContain('BROWSER_GEOLOCATION');
  });
});
