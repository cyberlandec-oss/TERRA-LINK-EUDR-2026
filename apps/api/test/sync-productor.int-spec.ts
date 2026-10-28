import { randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { operationHash } from '../src/sync/sync';

// D (móvil): el Productor VINCULADO usa la sincronización de campo con alcance PROPIO (docs/07, docs/11).
// Capturar y descargar sólo lo propio; la parcela de otra persona queda fuera; quien no tiene el permiso sigue sin entrar.
// PostgreSQL REAL, datos SINTÉTICOS, base desechable.
describeDb('D sync del Productor vinculado (alcance propio)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let org: string;
  let own: string; let other: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const ADMIN = 'admin-d@test.local';
  const PROD = 'productor-d@test.local';
  const AUD = 'auditor-d@test.local';

  async function join(email: string, role: string) {
    const inv = await http().post(`${base(org)}/invitations`).set(as(ADMIN)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const op = async (plotId: string) => {
    const v = Number((await http().get(`${base(org)}/plots/${plotId}`).set(as(ADMIN)).expect(200)).body.row_version);
    const c = { operation_type: 'PLOT_LOCATION_SAMPLE_CREATE', entity_id: randomUUID(), base_version: v, depends_on: [] as string[], captured_at: '2026-10-27T15:00:00.000Z',
      payload: { plot_id: plotId, latitude: -0.8479, longitude: -80.1601, accuracy_m: 8, acquired_at: '2026-10-27T15:00:00.000Z', source: 'DEVICE_LOCATION_SERVICE', provider_detail: 'expo-location; prueba', mocked: false } as Record<string, unknown> };
    return { operation_id: randomUUID(), ...c, content_hash: operationHash(c) };
  };

  const vertex = (plotId: string, lat: number, lon: number, deps: string[]) => {
    const c = { operation_type: 'PLOT_POLYGON_VERTEX_ADD', entity_id: randomUUID(), base_version: null as number | null, depends_on: deps, captured_at: '2026-10-27T15:00:00.000Z',
      payload: { plot_id: plotId, latitude: lat, longitude: lon, accuracy_m: 6, acquired_at: '2026-10-27T15:00:00.000Z', source: 'DEVICE_LOCATION_SERVICE', provider_detail: 'expo-location; prueba', mocked: false } as Record<string, unknown> };
    return { operation_id: randomUUID(), ...c, content_hash: operationHash(c) };
  };

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    org = (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: 'Coop Productor Sync', organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: ADMIN }).expect(201)).body.id;
    await join(PROD, 'PRODUCER');
    await join(AUD, 'AUDITOR');
    const mine = (await http().post(`${base(org)}/producers`).set(as(ADMIN)).send({ producer_code: 'DP-1', legal_name: 'Finca Propia' }).expect(201)).body.id;
    const theirs = (await http().post(`${base(org)}/producers`).set(as(ADMIN)).send({ producer_code: 'DP-2', legal_name: 'Finca Ajena' }).expect(201)).body.id;
    own = (await http().post(`${base(org)}/plots`).set(as(ADMIN)).send({ producer_id: mine, plot_code: 'DP-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    other = (await http().post(`${base(org)}/plots`).set(as(ADMIN)).send({ producer_id: theirs, plot_code: 'DP-2-P1', crop: 'Cacao' }).expect(201)).body.id;
    const m = (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', PROD).where('m.organization_id', '=', org).executeTakeFirstOrThrow()).id;
    const row = (await http().get(`${base(org)}/producers/${mine}`).set(as(ADMIN)).expect(200)).body;
    await http().put(`${base(org)}/producers/${mine}/self-membership`).set(as(ADMIN)).send({ expected_version: row.row_version, membership_id: m, reason: 'Vínculo de prueba' }).expect(200);
  });
  afterAll(async () => h?.close());

  it('el Productor vinculado registra su dispositivo, envía una muestra de SU parcela y descarga solo lo propio', async () => {
    const dev = (await http().post(`${base(org)}/devices`).set(as(PROD)).send({ client_device_id: randomUUID(), platform: 'ANDROID', label: 'Teléfono del productor' }).expect(201)).body.device.id;
    const o = await op(own);
    const r = await http().post(`${base(org)}/sync/push`).set(as(PROD)).send({ device_id: dev, operations: [o] }).expect(200);
    expect(r.body.results[0]).toMatchObject({ operation_id: o.operation_id, status: 'ACCEPTED' });
    const pull = await http().get(`${base(org)}/sync/pull?device_id=${dev}`).set(as(PROD)).expect(200);
    const ids = (pull.body.changes as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(own);
    expect(ids).not.toContain(other);
  });

  it('la parcela de otra persona no se acepta (alcance) y el rol sin sync:use sigue sin entrar', async () => {
    const dev = (await http().post(`${base(org)}/devices`).set(as(PROD)).send({ client_device_id: randomUUID(), platform: 'ANDROID', label: 'Otro' }).expect(201)).body.device.id;
    const o = await op(other);
    const r = await http().post(`${base(org)}/sync/push`).set(as(PROD)).send({ device_id: dev, operations: [o] }).expect(200);
    expect(r.body.results[0].status).toBe('FORBIDDEN');
    expect(r.body.results[0].error.code).toBe('RESOURCE_NOT_AVAILABLE');
    await http().post(`${base(org)}/devices`).set(as(AUD)).send({ client_device_id: randomUUID(), platform: 'ANDROID', label: 'x' }).expect(403);
  });

  it('vértices de polígono desde el dispositivo: entran al BORRADOR de la parcela propia, en orden y sin crear geometría; la ajena se rechaza', async () => {
    const dev = (await http().post(`${base(org)}/devices`).set(as(PROD)).send({ client_device_id: randomUUID(), platform: 'ANDROID', label: 'Polígono' }).expect(201)).body.device.id;
    const v1 = vertex(own, -0.8470, -80.1600, []); const v2 = vertex(own, -0.8470, -80.1590, [v1.operation_id]); const v3 = vertex(own, -0.8480, -80.1595, [v2.operation_id]);
    const versionsBefore = Number((await http().get(`${base(org)}/plots/${own}`).set(as(ADMIN)).expect(200)).body.row_version);
    const r = await http().post(`${base(org)}/sync/push`).set(as(PROD)).send({ device_id: dev, operations: [v1, v2, v3] }).expect(200);
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    expect(r.body.results[2].result).toMatchObject({ vertex_count: 3, confirmed: false });
    const cur = (await http().get(`${base(org)}/plots/${own}/polygon-drafts/current`).set(as(ADMIN)).expect(200)).body.draft;
    expect(cur.status).toBe('OPEN');
    expect(cur.vertices.map((v: { latitude: number }) => v.latitude)).toEqual([-0.8470, -0.8470, -0.8480]);
    expect(Number((await http().get(`${base(org)}/plots/${own}`).set(as(ADMIN)).expect(200)).body.row_version)).toBe(versionsBefore); // sin versión nueva
    // reenvío idempotente: no duplica vértices
    const again = await http().post(`${base(org)}/sync/push`).set(as(PROD)).send({ device_id: dev, operations: [v1] }).expect(200);
    expect(again.body.results[0].status).toBe('DUPLICATE');
    // parcela ajena: fuera de alcance
    const ajeno = await http().post(`${base(org)}/sync/push`).set(as(PROD)).send({ device_id: dev, operations: [vertex(other, -0.9, -80.2, [])] }).expect(200);
    expect(ajeno.body.results[0].status).toBe('FORBIDDEN');
  });
});
