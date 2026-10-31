import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Integración P0-006 (RF-06 / QA-04 / QA-02) contra PostgreSQL/PostGIS real.
describeDb('P0-006 parcelas y versiones geométricas (PostGIS real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let p1: string; // asignado a tecnico1
  let p2: string; // asignado a tecnico2
  let pB: string; // productor de B
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (org: string) => `/api/v1/organizations/${org}/plots`;
  const square = (lon: number, lat: number, d = 0.001) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });

  async function join(admin: string, org: string, email: string, role: string) {
    const inv = await http().post(`/api/v1/organizations/${org}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const mid = async (email: string, org: string) =>
    (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', org).executeTakeFirstOrThrow()).id;
  const countEvents = async (type?: string) => {
    let q = h.db.selectFrom('domain_events').select(sql<number>`count(*)::int`.as('n')).where('aggregate_type', '=', 'PLOT');
    if (type) q = q.where('event_type', '=', type);
    return (await q.executeTakeFirstOrThrow()).n;
  };
  const create = (actor: string, org: string, body: Record<string, unknown>) => http().post(base(org)).set(as(actor)).send(body);

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
    const prod = async (actor: string, org: string, code: string, tech?: string) =>
      (await http().post(`/api/v1/organizations/${org}/producers`).set(as(actor))
        .send({ producer_code: code, legal_name: `Finca ${code}`, ...(tech ? { assigned_membership_id: await mid(tech, org) } : {}) }).expect(201)).body.id;
    p1 = await prod('admin-a@test.local', orgA, 'P-1', 'tecnico1@test.local');
    p2 = await prod('admin-a@test.local', orgA, 'P-2', 'tecnico2@test.local');
    pB = await prod('admin-b@test.local', orgB, 'P-B');
  });
  afterAll(async () => h?.close());

  let plotA: string;

  it('alta autorizada con datos del contrato; sin geometría queda «sin versión»; validación de campos', async () => {
    await create('admin-a@test.local', orgA, { producer_id: p1, plot_code: 'PAR-1' }).expect(400); // crop obligatorio
    await create('admin-a@test.local', orgA, { producer_id: p1, plot_code: 'mal código', crop: 'Cacao' }).expect(400);
    await create('admin-a@test.local', orgA, { producer_id: p1, plot_code: 'PAR-1', crop: 'Cacao', organization_id: orgB }).expect(400);
    const res = await create('admin-a@test.local', orgA, { producer_id: p1, plot_code: 'PAR-1', crop: 'Cacao', variety: 'Nacional', name: 'Lote río', parish: 'Calceta' }).expect(201);
    plotA = res.body.id;
    expect(res.body).toMatchObject({ plot_code: 'PAR-1', crop: 'Cacao', status: 'ACTIVE', geometry_status: 'NONE', current_version: null, row_version: 1 });
    expect(res.body.producer).toMatchObject({ id: p1, producer_code: 'P-1' });
    const got = await http().get(`${base(orgA)}/${plotA}`).set(as('admin-a@test.local')).expect(200);
    expect(got.body).toMatchObject({ can_update: true, can_archive: true });
  });

  it('productor de otra organización rechazado (misma respuesta que fuera de alcance) y protegido en base de datos', async () => {
    const r = await create('admin-a@test.local', orgA, { producer_id: pB, plot_code: 'PAR-X', crop: 'Cacao' }).expect(422);
    expect(r.body.error.code).toBe('PRODUCER_NOT_AVAILABLE');
    await expect(sql`UPDATE plots SET producer_id = ${pB} WHERE id = ${plotA}`.execute(h.db)).rejects.toThrow(/plots_producer_fk/);
  });

  it('mismo código permitido en otra organización; código repetido en la misma → 409', async () => {
    await create('admin-a@test.local', orgA, { producer_id: p1, plot_code: 'PAR-1', crop: 'Cacao' }).expect(409);
    await create('admin-b@test.local', orgB, { producer_id: pB, plot_code: 'PAR-1', crop: 'Cacao' }).expect(201);
  });

  it('código concurrente: una creación y conflictos controlados', async () => {
    const res = await Promise.all(Array.from({ length: 8 }, () => create('admin-a@test.local', orgA, { producer_id: p1, plot_code: 'RACE', crop: 'Cacao' })));
    const codes = res.map((r) => r.status).sort();
    expect(codes.filter((s) => s === 201)).toHaveLength(1);
    expect(codes.filter((s) => s === 409)).toHaveLength(7);
    expect(res.find((r) => r.status === 409)!.body.error.code).toBe('PLOT_CODE_TAKEN');
  });

  it('técnico: crea solo para productores asignados; conocer el id no le da acceso a parcelas ajenas', async () => {
    const own = await create('tecnico1@test.local', orgA, { producer_id: p1, plot_code: 'T1-1', crop: 'Cacao' }).expect(201);
    const denied = await create('tecnico1@test.local', orgA, { producer_id: p2, plot_code: 'T1-2', crop: 'Cacao' }).expect(422);
    expect(denied.body.error.code).toBe('PRODUCER_NOT_AVAILABLE');
    const p2plot = (await create('admin-a@test.local', orgA, { producer_id: p2, plot_code: 'P2-1', crop: 'Cacao' }).expect(201)).body.id;
    await http().get(`${base(orgA)}/${p2plot}`).set(as('tecnico1@test.local')).expect(404);
    await http().patch(`${base(orgA)}/${p2plot}`).set(as('tecnico1@test.local')).send({ expected_version: 1, name: 'x' }).expect(404);
    await http().post(`${base(orgA)}/${p2plot}/geometry-versions`).set(as('tecnico1@test.local')).send({ expected_version: 1, survey_method: 'DECLARED', area_declared_ha: 1 }).expect(404);
    await http().get(`${base(orgA)}/${p2plot}/geometry-versions`).set(as('tecnico1@test.local')).expect(404);
    const list = await http().get(`${base(orgA)}?status=ALL`).set(as('tecnico1@test.local')).expect(200);
    const codes = list.body.items.map((p: { plot_code: string }) => p.plot_code);
    expect(codes).toContain('T1-1');
    expect(codes).not.toContain('P2-1');
    // Reasignar el productor cambia el alcance de inmediato.
    const pr = await http().get(`/api/v1/organizations/${orgA}/producers/${p2}`).set(as('admin-a@test.local')).expect(200);
    await http().put(`/api/v1/organizations/${orgA}/producers/${p2}/assignment`).set(as('admin-a@test.local')).send({ expected_version: pr.body.row_version, membership_id: await mid('tecnico1@test.local', orgA) }).expect(200);
    await http().get(`${base(orgA)}/${p2plot}`).set(as('tecnico1@test.local')).expect(200);
    expect(own.body.producer.id).toBe(p1);
  });

  it('listados sin parcelas ajenas; acceso cruzado 404; auditor lee sin editar', async () => {
    const listA = await http().get(`${base(orgA)}?status=ALL&limit=100`).set(as('admin-a@test.local')).expect(200);
    const listB = await http().get(`${base(orgB)}?status=ALL`).set(as('admin-b@test.local')).expect(200);
    expect(listB.body.items.map((p: { producer: { id: string } }) => p.producer.id)).toEqual([pB]);
    expect(listA.body.items.every((p: { producer: { id: string } }) => p.producer.id !== pB)).toBe(true);
    await http().get(`${base(orgA)}/${plotA}`).set(as('admin-b@test.local')).expect(404);
    await http().get(base(orgA)).set(as('admin-b@test.local')).expect(404);
    await http().get(`${base(orgA)}/${plotA}`).set(as('auditor@test.local')).expect(200);
    await http().patch(`${base(orgA)}/${plotA}`).set(as('auditor@test.local')).send({ expected_version: 1, name: 'x' }).expect(403);
    await create('auditor@test.local', orgA, { producer_id: p1, plot_code: 'AUD', crop: 'Cacao' }).expect(403);
  });

  it('versiones geométricas: declarada, punto y polígono; la anterior queda intacta y la actual se actualiza', async () => {
    const v1 = await http().post(`${base(orgA)}/${plotA}/geometry-versions`).set(as('admin-a@test.local'))
      .send({ expected_version: 1, survey_method: 'DECLARED', area_declared_ha: 2.5 }).expect(201);
    expect(v1.body.version).toMatchObject({ version_number: 1, geometry_type: null, area_declared_ha: '2.5000', area_calculated_ha: null, validation_status: 'NOT_VALIDATED', validation_rule_version: 'STRUCTURAL_ONLY_V1' });
    expect(v1.body.plot.geometry_status).toBe('DECLARED_AREA_ONLY');

    const v2 = await http().post(`${base(orgA)}/${plotA}/geometry-versions`).set(as('admin-a@test.local'))
      .send({ expected_version: 2, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.1601, -0.8479] }, area_declared_ha: 2.5 }).expect(201);
    expect(v2.body.version).toMatchObject({ version_number: 2, geometry_type: 'POINT', area_calculated_ha: null, previous_version_id: v1.body.version.id });
    expect(v2.body.version.geometry).toEqual({ type: 'Point', coordinates: [-80.1601, -0.8479] });

    const v3 = await http().post(`${base(orgA)}/${plotA}/geometry-versions`).set(as('admin-a@test.local'))
      .send({ expected_version: 3, survey_method: 'MANUAL_COORDINATES', geometry: square(-80.16, -0.85) }).expect(201);
    const area = Number(v3.body.version.area_calculated_ha);
    expect(area).toBeGreaterThan(1.2); // ~111 m × 111 m ≈ 1,23 ha (geodesia, no grados)
    expect(area).toBeLessThan(1.26);
    expect(v3.body.version.area_declared_ha).toBeNull(); // declarada y calculada separadas

    const versions = await http().get(`${base(orgA)}/${plotA}/geometry-versions`).set(as('admin-a@test.local')).expect(200);
    expect(versions.body.map((v: { version_number: number }) => v.version_number)).toEqual([3, 2, 1]);
    expect(versions.body.find((v: { version_number: number }) => v.version_number === 2)).toMatchObject({ is_current: false, geometry: { type: 'Point', coordinates: [-80.1601, -0.8479] }, geometry_hash: v2.body.version.geometry_hash });
    expect(versions.body[0].is_current).toBe(true);
    const plot = await h.db.selectFrom('plots').select(['current_version_id', 'row_version']).where('id', '=', plotA).executeTakeFirstOrThrow();
    expect(plot).toMatchObject({ current_version_id: v3.body.version.id, row_version: '4' });
    await expect(sql`UPDATE plot_versions SET area_declared_ha = 9 WHERE id = ${v2.body.version.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM plot_versions WHERE id = ${v1.body.version.id}`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('comprobaciones estructurales separadas de la validación GIS; métodos no implementados rechazados', async () => {
    const before = await countEvents('PlotGeometryVersionCreated');
    const open = { type: 'Polygon', coordinates: [[[-80.1, -1.1], [-80.09, -1.1], [-80.09, -1.09], [-80.1, -1.09]]] };
    const bad = await http().post(`${base(orgA)}/${plotA}/geometry-versions`).set(as('admin-a@test.local'))
      .send({ expected_version: 4, survey_method: 'MANUAL_COORDINATES', geometry: open }).expect(422);
    expect(bad.body.error.code).toBe('GEOMETRY_STRUCTURE_INVALID');
    expect(bad.body.error.details.map((d: { reason: string }) => d.reason)).toContain('RING_NOT_CLOSED');
    const gps = await http().post(`${base(orgA)}/${plotA}/geometry-versions`).set(as('admin-a@test.local'))
      .send({ expected_version: 4, survey_method: 'GPS_POINT', geometry: { type: 'Point', coordinates: [-80, -1] } }).expect(422);
    expect(gps.body.error.code).toBe('SURVEY_METHOD_NOT_AVAILABLE');
    await http().post(`${base(orgA)}/${plotA}/geometry-versions`).set(as('admin-a@test.local'))
      .send({ expected_version: 4, survey_method: 'DECLARED', geometry: { type: 'Point', coordinates: [-80, -1] }, area_declared_ha: 1 }).expect(400);
    // Autointersección bien formada: se guarda NO VALIDADA y sin superficie calculada (la evalúa P0-010).
    const bowtie = { type: 'Polygon', coordinates: [[[-80.2, -1.2], [-80.19, -1.19], [-80.19, -1.2], [-80.2, -1.19], [-80.2, -1.2]]] };
    const v4 = await http().post(`${base(orgA)}/${plotA}/geometry-versions`).set(as('admin-a@test.local'))
      .send({ expected_version: 4, survey_method: 'MANUAL_COORDINATES', geometry: bowtie }).expect(201);
    expect(v4.body.version).toMatchObject({ geometry_type: 'POLYGON', area_calculated_ha: null, validation_status: 'NOT_VALIDATED' });
    expect(await countEvents('PlotGeometryVersionCreated')).toBe(before + 1);
  });

  it('conflicto de edición sin pérdida silenciosa; historial y versión anterior conservados', async () => {
    const cur = (await http().get(`${base(orgA)}/${plotA}`).set(as('admin-a@test.local')).expect(200)).body.row_version;
    const [a, b] = await Promise.all([
      http().patch(`${base(orgA)}/${plotA}`).set(as('admin-a@test.local')).send({ expected_version: cur, variety: 'CCN-51' }),
      http().patch(`${base(orgA)}/${plotA}`).set(as('tecnico1@test.local')).send({ expected_version: cur, name: 'Lote alto' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((a.status === 409 ? a : b).body.error.code).toBe('VERSION_CONFLICT');
    // Una versión geométrica con versión de parcela obsoleta también se rechaza (no pisa la actual).
    await http().post(`${base(orgA)}/${plotA}/geometry-versions`).set(as('admin-a@test.local'))
      .send({ expected_version: cur, survey_method: 'DECLARED', area_declared_ha: 3 }).expect(409);
    const hist = await http().get(`${base(orgA)}/${plotA}/history`).set(as('admin-a@test.local')).expect(200);
    expect(hist.body.map((x: { change_type: string }) => x.change_type)).toEqual(['UPDATE', 'GEOMETRY_VERSION', 'GEOMETRY_VERSION', 'GEOMETRY_VERSION', 'GEOMETRY_VERSION', 'CREATE']);
    await expect(sql`DELETE FROM plot_history WHERE plot_id = ${plotA}`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('rollback: un fallo no deja parcela, historial, evento ni auditoría parciales; eventos sin coordenadas', async () => {
    const ev0 = await countEvents();
    const hist0 = (await h.db.selectFrom('plot_history').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow()).n;
    await create('admin-a@test.local', orgA, { producer_id: p1, plot_code: 'PAR-1', crop: 'Cacao' }).expect(409);
    await http().post(`${base(orgA)}/${plotA}/geometry-versions`).set(as('admin-a@test.local')).send({ expected_version: 1, survey_method: 'DECLARED', area_declared_ha: 3 }).expect(409);
    expect(await countEvents()).toBe(ev0);
    expect((await h.db.selectFrom('plot_history').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow()).n).toBe(hist0);
    const payloads = JSON.stringify(await h.db.selectFrom('domain_events').select('payload').where('aggregate_type', '=', 'PLOT').execute())
      + JSON.stringify(await h.db.selectFrom('audit_logs').select(['before', 'after']).where('entity_type', '=', 'plot').execute());
    expect(payloads).not.toContain('-80.16');
    expect(payloads).not.toContain('coordinates');
  });

  it('baja lógica conserva la parcela y sus versiones; bloquea edición; productor de baja no admite parcelas nuevas', async () => {
    const cur = (await http().get(`${base(orgA)}/${plotA}`).set(as('admin-a@test.local')).expect(200)).body.row_version;
    await http().post(`${base(orgA)}/${plotA}/archive`).set(as('tecnico1@test.local')).send({ expected_version: cur, reason: 'Abandonada' }).expect(403);
    await http().post(`${base(orgA)}/${plotA}/archive`).set(as('admin-a@test.local')).send({ expected_version: cur, reason: 'Abandonada' }).expect(200);
    const def = await http().get(base(orgA)).set(as('admin-a@test.local')).expect(200);
    expect(def.body.items.map((p: { id: string }) => p.id)).not.toContain(plotA);
    await http().patch(`${base(orgA)}/${plotA}`).set(as('admin-a@test.local')).send({ expected_version: cur + 1, name: 'x' }).expect(409);
    const versions = await http().get(`${base(orgA)}/${plotA}/geometry-versions`).set(as('admin-a@test.local')).expect(200);
    expect(versions.body).toHaveLength(4);
    const pr = await http().get(`/api/v1/organizations/${orgA}/producers/${p1}`).set(as('admin-a@test.local')).expect(200);
    await http().post(`/api/v1/organizations/${orgA}/producers/${p1}/archive`).set(as('admin-a@test.local')).send({ expected_version: pr.body.row_version, reason: 'Baja' }).expect(200);
    const r = await create('admin-a@test.local', orgA, { producer_id: p1, plot_code: 'PAR-NEW', crop: 'Cacao' }).expect(409);
    expect(r.body.error.code).toBe('PRODUCER_INACTIVE');
  });
});
