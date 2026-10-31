import { randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { operationHash } from '../src/sync/sync';

// D (móvil): el Productor VINCULADO usa la sincronización de campo con alcance PROPIO (docs/07, docs/11).
// Capturar y descargar sólo lo propio; la parcela de otra persona queda fuera; quien no tiene el permiso sigue sin entrar.
// Los vértices de polígono entran SOLO al borrador, con su procedencia real, asociados a la captura de origen.
// PostgreSQL REAL, datos SINTÉTICOS, base desechable.
describeDb('D sync del Productor vinculado (alcance propio) y vértices de polígono', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let org: string;
  let own: string; let other: string;
  let producerOwn = '';
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
  const vertex = (plotId: string, lat: number, lon: number, deps: string[], o: { capture: string; seq: number; base?: number | null; mocked?: boolean | null; detail?: string }) => {
    const c = { operation_type: 'PLOT_POLYGON_VERTEX_ADD', entity_id: randomUUID(), base_version: o.seq === 1 ? (o.base ?? null) : null, depends_on: deps, captured_at: '2026-10-27T15:00:00.000Z',
      payload: { plot_id: plotId, latitude: lat, longitude: lon, accuracy_m: 6, acquired_at: '2026-10-27T15:00:00.000Z', source: 'DEVICE_LOCATION_SERVICE', provider_detail: o.detail ?? 'expo-location; prueba', mocked: o.mocked === undefined ? false : o.mocked,
        capture_id: o.capture, vertex_seq: o.seq } as Record<string, unknown> };
    return { operation_id: randomUUID(), ...c, content_hash: operationHash(c) };
  };
  const rowVersion = async (plotId: string) => Number((await http().get(`${base(org)}/plots/${plotId}`).set(as(ADMIN)).expect(200)).body.row_version);
  const newPlot = async (code: string) => (await http().post(`${base(org)}/plots`).set(as(ADMIN)).send({ producer_id: producerOwn, plot_code: code, crop: 'Cacao' }).expect(201)).body.id as string;
  const device = async () => (await http().post(`${base(org)}/devices`).set(as(PROD)).send({ client_device_id: randomUUID(), platform: 'ANDROID', label: 'Teléfono' }).expect(201)).body.device.id as string;
  const push = (dev: string, ops: unknown[]) => http().post(`${base(org)}/sync/push`).set(as(PROD)).send({ device_id: dev, operations: ops }).expect(200);
  const draftOf = async (plotId: string) => (await http().get(`${base(org)}/plots/${plotId}/polygon-drafts/current`).set(as(ADMIN)).expect(200)).body.draft;

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    org = (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: 'Coop Productor Sync', organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: ADMIN }).expect(201)).body.id;
    await join(PROD, 'PRODUCER');
    await join(AUD, 'AUDITOR');
    const mine = (await http().post(`${base(org)}/producers`).set(as(ADMIN)).send({ producer_code: 'DP-1', legal_name: 'Finca Propia' }).expect(201)).body.id;
    const theirs = (await http().post(`${base(org)}/producers`).set(as(ADMIN)).send({ producer_code: 'DP-2', legal_name: 'Finca Ajena' }).expect(201)).body.id;
    producerOwn = mine;
    own = (await http().post(`${base(org)}/plots`).set(as(ADMIN)).send({ producer_id: mine, plot_code: 'DP-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    other = (await http().post(`${base(org)}/plots`).set(as(ADMIN)).send({ producer_id: theirs, plot_code: 'DP-2-P1', crop: 'Cacao' }).expect(201)).body.id;
    const m = (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', PROD).where('m.organization_id', '=', org).executeTakeFirstOrThrow()).id;
    const row = (await http().get(`${base(org)}/producers/${mine}`).set(as(ADMIN)).expect(200)).body;
    await http().put(`${base(org)}/producers/${mine}/self-membership`).set(as(ADMIN)).send({ expected_version: row.row_version, membership_id: m, reason: 'Vínculo de prueba' }).expect(200);
  });
  afterAll(async () => h?.close());

  it('el Productor vinculado registra su dispositivo, envía una muestra de SU parcela y descarga solo lo propio', async () => {
    const dev = await device();
    const o = await op(own);
    const r = await push(dev, [o]);
    expect(r.body.results[0]).toMatchObject({ operation_id: o.operation_id, status: 'ACCEPTED' });
    const pull = await http().get(`${base(org)}/sync/pull?device_id=${dev}`).set(as(PROD)).expect(200);
    const ids = (pull.body.changes as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(own);
    expect(ids).not.toContain(other);
  });

  it('la parcela de otra persona no se acepta (alcance) y el rol sin sync:use sigue sin entrar', async () => {
    const dev = await device();
    const o = await op(other);
    const r = await push(dev, [o]);
    expect(r.body.results[0].status).toBe('FORBIDDEN');
    expect(r.body.results[0].error.code).toBe('RESOURCE_NOT_AVAILABLE');
    await http().post(`${base(org)}/devices`).set(as(AUD)).send({ client_device_id: randomUUID(), platform: 'ANDROID', label: 'x' }).expect(403);
  });

  it('vértices desde el dispositivo: entran al BORRADOR de la parcela propia, en orden y sin crear geometría; reenviar no duplica; la parcela ajena se rechaza', async () => {
    const dev = await device(); const cap = randomUUID();
    const base0 = await rowVersion(own);
    const v1 = vertex(own, -0.8470, -80.1600, [], { capture: cap, seq: 1, base: base0 });
    const v2 = vertex(own, -0.8470, -80.1590, [v1.operation_id], { capture: cap, seq: 2 });
    const v3 = vertex(own, -0.8480, -80.1595, [v2.operation_id], { capture: cap, seq: 3 });
    const r = await push(dev, [v1, v2, v3]);
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    expect(r.body.results[2].result).toMatchObject({ vertex_count: 3, confirmed: false });
    const cur = await draftOf(own);
    expect(cur.status).toBe('OPEN');
    expect(cur.origin_capture_id).toBe(cap);
    expect(cur.vertices.map((v: { latitude: number }) => v.latitude)).toEqual([-0.8470, -0.8470, -0.8480]);
    expect(await rowVersion(own)).toBe(base0);
    expect((await push(dev, [v1])).body.results[0].status).toBe('DUPLICATE');
    expect((await push(dev, [vertex(other, -0.9, -80.2, [], { capture: randomUUID(), seq: 1, base: 1 })])).body.results[0].status).toBe('FORBIDDEN');
  });

  it('procedencia: cada vértice conserva SU adquisición (servicio del dispositivo, detalle, simulada o no informada) y el polígono confirmado lo declara', async () => {
    const plot = await newPlot('DP-1-P2'); const dev = await device(); const cap = randomUUID();
    const b = await rowVersion(plot);
    const v1 = vertex(plot, -0.8500, -80.1600, [], { capture: cap, seq: 1, base: b, mocked: true, detail: 'expo-location; proveedor A' });
    const v2 = vertex(plot, -0.8500, -80.1590, [v1.operation_id], { capture: cap, seq: 2, mocked: null, detail: 'expo-location; proveedor B' });
    const v3 = vertex(plot, -0.8510, -80.1595, [v2.operation_id], { capture: cap, seq: 3, mocked: false, detail: 'expo-location; proveedor C' });
    expect((await push(dev, [v1, v2, v3])).body.results.map((x: { status: string }) => x.status)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    const d = await draftOf(plot);
    expect(d.vertices.map((v: { source: string }) => v.source)).toEqual(Array(3).fill('DEVICE_LOCATION_SERVICE'));
    expect(d.vertices.map((v: { mocked: boolean | null }) => v.mocked)).toEqual([true, null, false]);
    expect(d.vertices.map((v: { provider_detail: string }) => v.provider_detail)).toEqual(['expo-location; proveedor A', 'expo-location; proveedor B', 'expo-location; proveedor C']);
    const ok = await http().post(`${base(org)}/polygon-drafts/${d.id}/confirm`).set(as(PROD)).send({ expected_version: d.row_version, plot_expected_version: await rowVersion(plot) });
    expect([200, 201]).toContain(ok.status);
    const pv = await h.db.selectFrom('plot_versions').select('survey_method').where('plot_id', '=', plot).orderBy('version_number', 'desc').executeTakeFirstOrThrow();
    expect(pv.survey_method).toBe('DEVICE_LOCATION_SERVICE');
  });

  it('conflictos: un borrador de otra captura o de la web no se mezcla; un cambio de la parcela en la web durante el offline y un borrador cancelado se detectan', async () => {
    const dev = await device();
    // (a) otra captura sobre un borrador ya abierto por una captura distinta
    const pA = await newPlot('DP-1-P3'); const capA = randomUUID(); const capB = randomUUID();
    const bA = await rowVersion(pA);
    expect((await push(dev, [vertex(pA, -0.86, -80.16, [], { capture: capA, seq: 1, base: bA })])).body.results[0].status).toBe('ACCEPTED');
    const otra = (await push(dev, [vertex(pA, -0.87, -80.17, [], { capture: capB, seq: 1, base: bA })])).body.results[0];
    expect(otra).toMatchObject({ status: 'CONFLICT', error: { code: 'DRAFT_OPEN_FROM_OTHER_SOURCE' } });
    expect((await draftOf(pA)).vertices).toHaveLength(1);
    // (b) borrador abierto desde la web mientras el teléfono estaba sin red
    const pB = await newPlot('DP-1-P4');
    const web = (await http().post(`${base(org)}/plots/${pB}/polygon-drafts`).set(as(ADMIN)).expect(201)).body;
    const webOp = (await push(dev, [vertex(pB, -0.88, -80.18, [], { capture: randomUUID(), seq: 1, base: await rowVersion(pB) })])).body.results[0];
    expect(webOp).toMatchObject({ status: 'CONFLICT', error: { code: 'DRAFT_OPEN_FROM_OTHER_SOURCE' } });
    expect((await draftOf(pB)).id).toBe(web.id);
    // (c) la parcela cambió en la web (versión nueva) antes de que llegara el primer vértice
    const pC = await newPlot('DP-1-P5'); const bC = await rowVersion(pC);
    await http().post(`${base(org)}/plots/${pC}/location-samples`).set(as(ADMIN)).send({ expected_version: bC, operation_id: randomUUID(), source: 'BROWSER_GEOLOCATION', longitude: -80.1, latitude: -0.9, accuracy_m: 5, captured_at: new Date().toISOString() }).expect(201);
    expect(await rowVersion(pC)).toBeGreaterThan(bC);
    expect((await push(dev, [vertex(pC, -0.9, -80.1, [], { capture: randomUUID(), seq: 1, base: bC })])).body.results[0]).toMatchObject({ status: 'CONFLICT', error: { code: 'VERSION_CONFLICT' } });
    // (d) el borrador de la captura se canceló en la web entre dos vértices
    const pD = await newPlot('DP-1-P6'); const capD = randomUUID();
    const d1 = vertex(pD, -0.91, -80.11, [], { capture: capD, seq: 1, base: await rowVersion(pD) });
    expect((await push(dev, [d1])).body.results[0].status).toBe('ACCEPTED');
    const dd = await draftOf(pD);
    await http().post(`${base(org)}/polygon-drafts/${dd.id}/cancel`).set(as(ADMIN)).send({ expected_version: dd.row_version }).expect(200);
    const d2 = (await push(dev, [vertex(pD, -0.92, -80.12, [d1.operation_id], { capture: capD, seq: 2 })])).body.results[0];
    expect(d2).toMatchObject({ status: 'CONFLICT', error: { code: 'DRAFT_NOT_OPEN_FOR_CAPTURE' } });
  });

  it('captura con punto de ubicación y vértices: la propia sincronización no genera conflicto contra sí misma', async () => {
    const plot = await newPlot('DP-1-P7'); const dev = await device(); const cap = randomUUID();
    const b = await rowVersion(plot);
    const loc = await op(plot);
    const v1 = vertex(plot, -0.93, -80.13, [loc.operation_id], { capture: cap, seq: 1, base: b });
    const v2 = vertex(plot, -0.93, -80.12, [v1.operation_id], { capture: cap, seq: 2 });
    const r = await push(dev, [loc, v1, v2]);
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    expect(await rowVersion(plot)).toBeGreaterThan(b); // el punto sí creó una versión: el vértice no la tomó por un cambio ajeno
    expect((await draftOf(plot)).vertices).toHaveLength(2);
  });

  it('edición web del MISMO borrador entre dos envíos: el vértice siguiente es conflicto explícito y la captura local sigue intacta (reenviable)', async () => {
    const plot = await newPlot('DP-1-P8'); const dev = await device(); const cap = randomUUID();
    const v1 = vertex(plot, -0.94, -80.14, [], { capture: cap, seq: 1, base: await rowVersion(plot) });
    const v2 = vertex(plot, -0.94, -80.13, [v1.operation_id], { capture: cap, seq: 2 });
    const v3 = vertex(plot, -0.95, -80.135, [v2.operation_id], { capture: cap, seq: 3 });
    expect((await push(dev, [v1, v2])).body.results.map((x: { status: string }) => x.status)).toEqual(['ACCEPTED', 'ACCEPTED']);
    // la web añade un vértice al mismo borrador (misma captura de origen, versión vigente) entre los dos envíos
    const d = await draftOf(plot);
    await http().post(`${base(org)}/polygon-drafts/${d.id}/vertices`).set(as(ADMIN)).send({ expected_version: d.row_version, operation_id: randomUUID(), source: 'BROWSER_GEOLOCATION', longitude: -80.2, latitude: -0.96, accuracy_m: 9, captured_at: new Date().toISOString() }).expect(201);
    const c = (await push(dev, [v3])).body.results[0];
    expect(c).toMatchObject({ status: 'CONFLICT', error: { code: 'DRAFT_CHANGED_FROM_WEB' } });
    expect((await draftOf(plot)).vertices).toHaveLength(3); // 2 del teléfono + 1 de la web; el vértice 3 no se coló
    // lo mismo si la web deshace un vértice
    const plot2 = await newPlot('DP-1-P9'); const cap2 = randomUUID();
    const w1 = vertex(plot2, -0.97, -80.15, [], { capture: cap2, seq: 1, base: await rowVersion(plot2) });
    const w2 = vertex(plot2, -0.97, -80.14, [w1.operation_id], { capture: cap2, seq: 2 });
    const w3 = vertex(plot2, -0.98, -80.145, [w2.operation_id], { capture: cap2, seq: 3 });
    await push(dev, [w1, w2]);
    const d2 = await draftOf(plot2);
    await http().post(`${base(org)}/polygon-drafts/${d2.id}/undo`).set(as(ADMIN)).send({ expected_version: d2.row_version }).expect(200);
    expect((await push(dev, [w3])).body.results[0]).toMatchObject({ status: 'CONFLICT', error: { code: 'DRAFT_CHANGED_FROM_WEB' } });
  });

  it('recorrido: conflicto del primer vértice → resolución → los siguientes se aceptan → el reintento no duplica', async () => {
    const plot = await newPlot('DP-1-P10'); const dev = await device(); const cap = randomUUID();
    const web = (await http().post(`${base(org)}/plots/${plot}/polygon-drafts`).set(as(ADMIN)).expect(201)).body; // borrador de la web abierto mientras el teléfono estaba sin red
    const b = await rowVersion(plot);
    const v1 = vertex(plot, -0.90, -80.30, [], { capture: cap, seq: 1, base: b });
    const v2 = vertex(plot, -0.90, -80.29, [v1.operation_id], { capture: cap, seq: 2 });
    const v3 = vertex(plot, -0.91, -80.295, [v2.operation_id], { capture: cap, seq: 3 });
    const first = (await push(dev, [v1, v2, v3])).body.results.map((x: { status: string; error?: { code: string } }) => [x.status, x.error?.code]);
    expect(first).toEqual([['CONFLICT', 'DRAFT_OPEN_FROM_OTHER_SOURCE'], ['REJECTED', 'DEPENDENCY_FAILED'], ['REJECTED', 'DEPENDENCY_FAILED']]);
    expect((await draftOf(plot)).id).toBe(web.id);
    await http().post(`${base(org)}/polygon-drafts/${web.id}/cancel`).set(as(ADMIN)).send({ expected_version: web.row_version }).expect(200);
    // sustitutas con identificador, dependencia y hash nuevos (las originales se conservan en el servidor como conflicto/rechazo)
    const r1 = vertex(plot, -0.90, -80.30, [], { capture: cap, seq: 1, base: await rowVersion(plot) });
    (r1.payload as Record<string, unknown>).resolves_operation_id = v1.operation_id;
    const r1c = { operation_type: r1.operation_type, entity_id: r1.entity_id, base_version: r1.base_version, depends_on: r1.depends_on, captured_at: r1.captured_at, payload: r1.payload };
    const R1 = { ...r1, content_hash: operationHash(r1c) };
    const R2 = vertex(plot, -0.90, -80.29, [R1.operation_id], { capture: cap, seq: 2 });
    const R3 = vertex(plot, -0.91, -80.295, [R2.operation_id], { capture: cap, seq: 3 });
    expect((await push(dev, [R1, R2, R3])).body.results.map((x: { status: string }) => x.status)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    expect((await push(dev, [R1, R2, R3])).body.results.map((x: { status: string }) => x.status)).toEqual(['DUPLICATE', 'DUPLICATE', 'DUPLICATE']);
    const d = await draftOf(plot);
    expect(d.vertices).toHaveLength(3); // una sola vez
    // el hash viejo bajo un identificador que el servidor ya conoce se rechaza: por eso hay sustitutas y no un recálculo
    const viejoId = { ...v2, depends_on: [R1.operation_id] };
    const rejected = (await push(dev, [viejoId])).body.results[0];
    expect(['REJECTED', 'CONFLICT']).toContain(rejected.status);
  });
});
