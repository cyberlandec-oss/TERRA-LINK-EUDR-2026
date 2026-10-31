import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Integración P0-008 (borrador de polígono persistido en el servidor), PostGIS real.
describeDb('P0-008 borrador de polígono (PostGIS real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let p1: string;
  let plot: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const org = () => `/api/v1/organizations/${orgA}`;
  const start = (actor: string, id = plot) => http().post(`${org()}/plots/${id}/polygon-drafts`).set(as(actor));
  const current = (actor: string, id = plot) => http().get(`${org()}/plots/${id}/polygon-drafts/current`).set(as(actor));
  const act = (actor: string, draft: string, action: string, body: Record<string, unknown>) =>
    http().post(`${org()}/polygon-drafts/${draft}/${action}`).set(as(actor)).send(body);
  const plotVersion = async (id = plot) => Number((await h.db.selectFrom('plots').select('row_version').where('id', '=', id).executeTakeFirstOrThrow()).row_version);
  const vertex = (lon: number, lat: number, over: Record<string, unknown> = {}) => ({
    operation_id: randomUUID(), source: 'BROWSER_GEOLOCATION', longitude: lon, latitude: lat,
    accuracy_m: 8, captured_at: new Date(Date.now() - 60_000).toISOString(), ...over,
  });
  // Cuadrado de ~100 m y "pajarita" autointersectada.
  const SQUARE = [[-80.16, -0.848], [-80.159, -0.848], [-80.159, -0.847], [-80.16, -0.847]];
  const BOWTIE = [[-80.16, -0.848], [-80.159, -0.847], [-80.159, -0.848], [-80.16, -0.847]];

  async function join(admin: string, o: string, email: string, role: string) {
    const inv = await http().post(`/api/v1/organizations/${o}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const mid = async (email: string) =>
    (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow()).id;

  /** Abre un borrador, añade los vértices y devuelve { id, version }. */
  async function draftWith(actor: string, pts: number[][], acc: Array<number | null> = []) {
    let d = (await start(actor).expect(201)).body;
    for (const [i, [lon, lat]] of pts.entries()) {
      d = (await act(actor, d.id, 'vertices', { expected_version: d.row_version, ...vertex(lon, lat, acc.length ? { accuracy_m: acc[i] } : {}) }).expect(201)).body.draft;
    }
    return d;
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
    p1 = (await http().post(`${org()}/producers`).set(as('admin-a@test.local'))
      .send({ producer_code: 'P-1', legal_name: 'Finca uno', assigned_membership_id: await mid('tecnico1@test.local') }).expect(201)).body.id;
    plot = (await http().post(`${org()}/plots`).set(as('admin-a@test.local')).send({ producer_id: p1, plot_code: 'PAR-1', crop: 'Cacao' }).expect(201)).body.id;
    await http().post(`${org()}/plots/${plot}/geometry-versions`).set(as('admin-a@test.local')).send({ expected_version: 1, survey_method: 'DECLARED', area_declared_ha: 3 }).expect(201);
  });
  afterAll(async () => h?.close());

  it('menos de 3 vértices distintos (incluye repetidos) no se confirma y el borrador se conserva', async () => {
    const d = await draftWith('tecnico1@test.local', [SQUARE[0], SQUARE[0], SQUARE[1]]);
    expect(d.preview).toMatchObject({ vertex_count: 3, distinct_count: 2, repeated_vertices: 1, storable: false });
    const res = await act('tecnico1@test.local', d.id, 'confirm', { expected_version: d.row_version, plot_expected_version: await plotVersion() }).expect(422);
    expect(res.body.error.code).toBe('POLYGON_NEEDS_3_DISTINCT_VERTICES');
    const after = (await current('tecnico1@test.local').expect(200)).body.draft;
    expect(after).toMatchObject({ id: d.id, status: 'OPEN', row_version: d.row_version });
    await act('tecnico1@test.local', d.id, 'cancel', { expected_version: d.row_version }).expect(200);
  });

  it('doble envío idempotente: mismo operation_id no duplica; mismo id con otros datos → 409', async () => {
    const d = (await start('tecnico1@test.local').expect(201)).body;
    const v = vertex(SQUARE[0][0], SQUARE[0][1]);
    const [a, b] = await Promise.all([
      act('tecnico1@test.local', d.id, 'vertices', { expected_version: d.row_version, ...v }),
      act('tecnico1@test.local', d.id, 'vertices', { expected_version: d.row_version, ...v }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const again = await act('tecnico1@test.local', d.id, 'vertices', { expected_version: d.row_version, ...v }).expect(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.draft.vertices).toHaveLength(1);
    const reused = await act('tecnico1@test.local', d.id, 'vertices', { expected_version: again.body.draft.row_version, ...v, latitude: -0.9 }).expect(409);
    expect(reused.body.error.code).toBe('OPERATION_ID_REUSED');
    await act('tecnico1@test.local', d.id, 'cancel', { expected_version: again.body.draft.row_version }).expect(200);
  });

  it('recuperación tras recargar: current devuelve el mismo borrador con orden, fuente, fechas y precisión', async () => {
    const d = await draftWith('tecnico1@test.local', SQUARE.slice(0, 2), [5, null]);
    const reloaded = (await current('tecnico1@test.local').expect(200)).body.draft;
    expect(reloaded.id).toBe(d.id);
    expect(reloaded.vertices.map((v: { acquisition_seq: number }) => v.acquisition_seq)).toEqual([1, 2]);
    expect(reloaded.vertices[0]).toMatchObject({ source: 'BROWSER_GEOLOCATION', longitude: -80.16, latitude: -0.848, horizontal_accuracy_m: 5, excluded: false });
    expect(reloaded.vertices[1].horizontal_accuracy_m).toBeNull();
    expect(reloaded.vertices[0].received_at).toBeTruthy();
    const dup = await start('tecnico1@test.local').expect(409);
    expect(dup.body.error.code).toBe('DRAFT_ALREADY_OPEN');
    await act('tecnico1@test.local', d.id, 'cancel', { expected_version: d.row_version }).expect(200);
    expect((await current('tecnico1@test.local').expect(200)).body.draft).toBeNull();
  });

  it('deshacer excluye el último sin alterar la muestra (historial conservado, append-only)', async () => {
    const d = await draftWith('tecnico1@test.local', SQUARE.slice(0, 3));
    const u = (await act('tecnico1@test.local', d.id, 'undo', { expected_version: d.row_version }).expect(200)).body;
    expect(u.vertices).toHaveLength(3);
    expect(u.vertices.map((v: { excluded: boolean }) => v.excluded)).toEqual([false, false, true]);
    expect(u.preview.vertex_count).toBe(2);
    const row = await h.db.selectFrom('draft_vertices').selectAll().where('draft_id', '=', d.id).where('acquisition_seq', '=', 3).executeTakeFirstOrThrow();
    expect(row.longitude).toBe(SQUARE[2][0]);
    await expect(sql`DELETE FROM draft_vertices WHERE id = ${row.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`UPDATE draft_vertices SET latitude = 0 WHERE id = ${row.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    await act('tecnico1@test.local', d.id, 'cancel', { expected_version: u.row_version }).expect(200);
  });

  it('dos pestañas: la segunda escritura con versión anterior → 409 VERSION_CONFLICT, sin sobrescribir', async () => {
    const d = (await start('tecnico1@test.local').expect(201)).body;
    await act('tecnico1@test.local', d.id, 'vertices', { expected_version: d.row_version, ...vertex(-80.16, -0.848) }).expect(201);
    const stale = await act('tecnico1@test.local', d.id, 'vertices', { expected_version: d.row_version, ...vertex(-80.159, -0.848) }).expect(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const staleUndo = await act('tecnico1@test.local', d.id, 'undo', { expected_version: d.row_version }).expect(409);
    expect(staleUndo.body.error.code).toBe('VERSION_CONFLICT');
    const now = (await current('tecnico1@test.local').expect(200)).body.draft;
    expect(now.vertices).toHaveLength(1);
    await act('tecnico1@test.local', d.id, 'cancel', { expected_version: now.row_version }).expect(200);
  });

  it('cierre sin muestra adicional, precisión mixta, versión inmutable, historial/evento/auditoría sin coordenadas', async () => {
    const d = await draftWith('tecnico1@test.local', SQUARE, [4, null, 9.5, 0]);
    expect(d.accuracy_summary).toMatchObject({ with_accuracy: 3, without_accuracy: 1, worst_known_m: 9.5, complete: false });
    expect(d.accuracy_summary.label).toBe('3 vértices con precisión informada; 1 sin informar; peor precisión conocida 9,5 m (resumen incompleto)');
    expect(d.preview).toMatchObject({ storable: true, technically_valid: true });
    const before = await plotVersion();
    const res = await act('tecnico1@test.local', d.id, 'confirm', { expected_version: d.row_version, plot_expected_version: before }).expect(201);
    const v = res.body.version;
    expect(v).toMatchObject({ geometry_type: 'POLYGON', survey_method: 'BROWSER_GEOLOCATION', validation_status: 'NOT_VALIDATED', accuracy_m: null, area_declared_ha: '3.0000', technically_valid: true });
    expect(Number(v.area_calculated_ha)).toBeGreaterThan(1);
    expect(v.geometry.coordinates[0]).toHaveLength(5);
    expect(v.geometry.coordinates[0][4]).toEqual(v.geometry.coordinates[0][0]); // cierre = primer vértice
    expect(await h.db.selectFrom('draft_vertices').select(sql<number>`count(*)::int`.as('n')).where('draft_id', '=', d.id).executeTakeFirstOrThrow()).toEqual({ n: 4 }); // sin muestra extra
    const draft = await h.db.selectFrom('polygon_drafts').selectAll().where('id', '=', d.id).executeTakeFirstOrThrow();
    expect(draft).toMatchObject({ status: 'CONFIRMED', confirmed_version_id: v.id });
    const ev = await h.db.selectFrom('domain_events').selectAll().where('aggregate_id', '=', plot).where('event_type', '=', 'PlotGeometryVersionCreated').orderBy('occurred_at', 'desc').executeTakeFirstOrThrow();
    expect(ev.payload).toMatchObject({ polygon_draft_id: d.id, vertex_count: 4, vertices_with_accuracy: 3, vertices_without_accuracy: 1 });
    const audits = await h.db.selectFrom('audit_logs').selectAll().where('entity_id', '=', plot).execute();
    const blob = JSON.stringify(ev.payload) + JSON.stringify(audits);
    expect(blob).not.toContain('-80.16');
    expect(blob).not.toContain('-0.84');
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['plot.polygon_draft_start', 'plot.polygon_vertex_add', 'plot.polygon_confirm']));
    const hist = await http().get(`${org()}/plots/${plot}/history`).set(as('admin-a@test.local')).expect(200);
    expect(JSON.stringify(hist.body)).toContain('GEOMETRY_VERSION');
    const detail = await http().get(`${org()}/plots/${plot}/geometry-versions/${v.id}/vertices`).set(as('tecnico1@test.local')).expect(200);
    expect(detail.body.vertices.map((x: { horizontal_accuracy_m: number | null }) => x.horizontal_accuracy_m)).toEqual([4, null, 9.5, 0]);
    // un borrador confirmado ya no admite cambios; un cambio posterior crea otra versión
    await act('tecnico1@test.local', d.id, 'vertices', { expected_version: Number(draft.row_version), ...vertex(-80.1, -0.8) }).expect(409);
    const d2 = await draftWith('tecnico1@test.local', SQUARE.slice(0, 3));
    const r2 = await act('tecnico1@test.local', d2.id, 'confirm', { expected_version: d2.row_version, plot_expected_version: await plotVersion() }).expect(201);
    expect(r2.body.version.version_number).toBe(v.version_number + 1);
    expect(r2.body.version.previous_version_id).toBe(v.id);
  });

  it('autointersección: rechazada sin conservar; conservada para revisión solo si se pide, sin superficie ni reparación', async () => {
    const d = await draftWith('tecnico1@test.local', BOWTIE, [null, null, null, null]);
    expect(d.accuracy_summary.label).toBe('Precisión no informada');
    expect(d.preview).toMatchObject({ storable: true, technically_valid: false, area_calculated_ha: null });
    expect(d.preview.validity_reason).toMatch(/Self-intersection/i);
    const pv = await plotVersion();
    const rej = await act('tecnico1@test.local', d.id, 'confirm', { expected_version: d.row_version, plot_expected_version: pv }).expect(422);
    expect(rej.body.error.code).toBe('POLYGON_NOT_VALID');
    expect((await current('tecnico1@test.local').expect(200)).body.draft).toMatchObject({ id: d.id, status: 'OPEN' });
    const kept = await act('tecnico1@test.local', d.id, 'confirm', { expected_version: d.row_version, plot_expected_version: pv, keep_invalid_for_review: true }).expect(201);
    expect(kept.body.version).toMatchObject({ technically_valid: false, area_calculated_ha: null, validation_status: 'NOT_VALIDATED' });
    expect(kept.body.version.notes).toMatch(/no válida/);
    expect(kept.body.version.geometry.coordinates[0].slice(0, 4)).toEqual(BOWTIE); // sin reparación
  });

  it('rollback sin efectos parciales: conflicto de versión de parcela no crea versión, ni evento, ni cierra el borrador', async () => {
    const d = await draftWith('admin-a@test.local', SQUARE);
    const versions = async () => (await h.db.selectFrom('plot_versions').select(sql<number>`count(*)::int`.as('n')).where('plot_id', '=', plot).executeTakeFirstOrThrow()).n;
    const events = async () => (await h.db.selectFrom('domain_events').select(sql<number>`count(*)::int`.as('n')).where('aggregate_id', '=', plot).executeTakeFirstOrThrow()).n;
    const [v0, e0] = [await versions(), await events()];
    const res = await act('admin-a@test.local', d.id, 'confirm', { expected_version: d.row_version, plot_expected_version: (await plotVersion()) - 1 }).expect(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
    expect([await versions(), await events()]).toEqual([v0, e0]);
    expect((await current('admin-a@test.local').expect(200)).body.draft).toMatchObject({ id: d.id, status: 'OPEN', row_version: d.row_version });
    // fallo dentro de la transacción (fuerza error tras insertar la versión): nada persiste
    await sql`CREATE OR REPLACE FUNCTION p008_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla forzada'; END $$`.execute(h.db);
    await sql`CREATE TRIGGER p008_fail BEFORE UPDATE ON polygon_drafts FOR EACH ROW WHEN (NEW.status = 'CONFIRMED') EXECUTE FUNCTION p008_fail()`.execute(h.db);
    try {
      await act('admin-a@test.local', d.id, 'confirm', { expected_version: d.row_version, plot_expected_version: await plotVersion() }).expect(500);
    } finally {
      await sql`DROP TRIGGER p008_fail ON polygon_drafts`.execute(h.db);
      await sql`DROP FUNCTION p008_fail`.execute(h.db);
    }
    expect([await versions(), await events()]).toEqual([v0, e0]);
    expect((await current('admin-a@test.local').expect(200)).body.draft.status).toBe('OPEN');
    await act('admin-a@test.local', d.id, 'cancel', { expected_version: d.row_version }).expect(200);
  });

  it('reasignación y revocación durante la captura: cada escritura revalida', async () => {
    const d = await draftWith('tecnico1@test.local', SQUARE.slice(0, 1));
    await start('tecnico2@test.local').expect(404); // no asignado
    await current('tecnico2@test.local').expect(404);
    const pr = await http().get(`${org()}/producers/${p1}`).set(as('admin-a@test.local')).expect(200);
    await http().put(`${org()}/producers/${p1}/assignment`).set(as('admin-a@test.local'))
      .send({ expected_version: pr.body.row_version, membership_id: await mid('tecnico2@test.local') }).expect(200);
    await act('tecnico1@test.local', d.id, 'vertices', { expected_version: d.row_version, ...vertex(-80.159, -0.848) }).expect(404);
    const t2 = await act('tecnico2@test.local', d.id, 'vertices', { expected_version: d.row_version, ...vertex(-80.159, -0.848) }).expect(201);
    await http().post(`${org()}/members/${await mid('tecnico2@test.local')}/deactivate`).set(as('admin-a@test.local')).send({ reason: 'Revocación de prueba' }).expect(200);
    const revoked = await act('tecnico2@test.local', d.id, 'vertices', { expected_version: t2.body.draft.row_version, ...vertex(-80.159, -0.847) });
    expect([401, 403, 404]).toContain(revoked.status);
    const kept = (await current('admin-a@test.local').expect(200)).body.draft;
    expect(kept.vertices).toHaveLength(2);
    await http().post(`/api/v1/organizations/${orgA}/suspend`).set(as('super@test.local')).send({ reason: 'Revisión' }).expect(200);
    const susp = await act('admin-a@test.local', d.id, 'undo', { expected_version: kept.row_version }).expect(403);
    expect(susp.body.error.code).toBe('ORGANIZATION_SUSPENDED');
    await http().post(`/api/v1/organizations/${orgA}/reactivate`).set(as('super@test.local')).send({ reason: 'Fin' }).expect(200);
    await act('admin-a@test.local', d.id, 'cancel', { expected_version: kept.row_version }).expect(200);
  });

  it('entre organizaciones rechazado; auditor sin plot:read_geometry no ve borradores, muestras ni coordenadas', async () => {
    const d = await draftWith('admin-a@test.local', SQUARE.slice(0, 2));
    await http().get(`/api/v1/organizations/${orgB}/polygon-drafts/${d.id}`).set(as('admin-b@test.local')).expect(404);
    await http().get(`${org()}/polygon-drafts/${d.id}`).set(as('admin-b@test.local')).expect(404);
    await http().post(`/api/v1/organizations/${orgB}/polygon-drafts/${d.id}/vertices`).set(as('admin-b@test.local')).send({ expected_version: d.row_version, ...vertex(-80, -0.8) }).expect(404);
    const aud = [
      await current('auditor@test.local'),
      await http().get(`${org()}/polygon-drafts/${d.id}`).set(as('auditor@test.local')),
      await start('auditor@test.local'),
      await act('auditor@test.local', d.id, 'vertices', { expected_version: d.row_version, ...vertex(-80, -0.8) }),
    ];
    expect(aud.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    const confirmed = await h.db.selectFrom('polygon_drafts').select('confirmed_version_id').where('plot_id', '=', plot).where('status', '=', 'CONFIRMED').executeTakeFirstOrThrow();
    const det = await http().get(`${org()}/plots/${plot}/geometry-versions/${confirmed.confirmed_version_id}/vertices`).set(as('auditor@test.local')).expect(200);
    expect(det.body.geometry_visible).toBe(false);
    expect(det.body.vertices[0].longitude).toBeUndefined();
    expect(JSON.stringify(aud.map((r) => r.body)) + JSON.stringify(det.body)).not.toContain('-80.1');
    await act('admin-a@test.local', d.id, 'cancel', { expected_version: d.row_version }).expect(200);
  });
});
