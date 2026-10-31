import { createHash, randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { OBJECT_STORE, type ObjectStore } from '../src/storage/object-store';
import { GeometryImportsService } from '../src/plots/geometry-imports';

// Integración P0-009 (importación/exportación GeoJSON): PostgreSQL/PostGIS real y S3 local real (bucket de pruebas).
describeDb('P0-009 GeoJSON: importación con revisión, original privado y exportación', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let store: ObjectStore;
  let orgA: string;
  let orgB: string;
  let p1: string;
  let plot: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const org = () => `/api/v1/organizations/${orgA}`;
  // Ejemplo inequívoco de orden: longitud −80.x (Manabí), latitud −0.8x. Si se invirtiera, la latitud −80 sería otra parte del mundo.
  const SQUARE = [[-80.16, -0.848], [-80.159, -0.848], [-80.159, -0.847], [-80.16, -0.847], [-80.16, -0.848]];
  const HOLE = [[-80.1598, -0.8478], [-80.1592, -0.8478], [-80.1592, -0.8472], [-80.1598, -0.8472], [-80.1598, -0.8478]];
  const BOWTIE = [[-80.16, -0.848], [-80.159, -0.847], [-80.159, -0.848], [-80.16, -0.847], [-80.16, -0.848]];
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const file = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o, null, 2));
  const analyze = (actor: string, bytes: Buffer, op = randomUUID(), id = plot, name = 'parcela.geojson') =>
    http().post(`${org()}/plots/${id}/geometry-imports`).set(as(actor)).field('operation_id', op).attach('file', bytes, { filename: name, contentType: 'application/geo+json' });
  const confirm = (actor: string, importId: string, body: Record<string, unknown>) =>
    http().post(`${org()}/geometry-imports/${importId}/confirm`).set(as(actor)).send({ operation_id: randomUUID(), ...body });
  const plotVersion = async () => Number((await h.db.selectFrom('plots').select('row_version').where('id', '=', plot).executeTakeFirstOrThrow()).row_version);
  const counts = async () => ({
    versions: (await h.db.selectFrom('plot_versions').select(sql<number>`count(*)::int`.as('n')).where('plot_id', '=', plot).executeTakeFirstOrThrow()).n,
    events: (await h.db.selectFrom('domain_events').select(sql<number>`count(*)::int`.as('n')).where('aggregate_id', '=', plot).executeTakeFirstOrThrow()).n,
    imports: (await h.db.selectFrom('geometry_imports').select(sql<number>`count(*)::int`.as('n')).where('plot_id', '=', plot).executeTakeFirstOrThrow()).n,
  });
  const keyOf = async (id: string) => (await h.db.selectFrom('geometry_imports').select('object_key').where('id', '=', id).executeTakeFirstOrThrow()).object_key;

  async function join(admin: string, o: string, email: string, role: string) {
    const inv = await http().post(`/api/v1/organizations/${o}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const mid = async (email: string) =>
    (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow()).id;

  beforeAll(async () => {
    h = await setupHarness();
    store = h.app.get(OBJECT_STORE);
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
  afterEach(() => jest.restoreAllMocks());

  let polygonVersionId: string;
  let polygonImportId: string;
  let polygonBytes: Buffer;

  it('Polygon en Feature: análisis con revisión, original privado con SHA-256 del servidor, confirmación de una versión', async () => {
    polygonBytes = file({ type: 'Feature', properties: { organization_id: orgB, plot_id: randomUUID(), titular: 'Nombre' }, geometry: { type: 'Polygon', coordinates: [SQUARE] } });
    const a = await analyze('tecnico1@test.local', polygonBytes).expect(201);
    const imp = a.body.import;
    polygonImportId = imp.id;
    expect(imp).toMatchObject({
      status: 'ANALYZED', plot_id: plot, envelope: 'FEATURE', geometry_type: 'POLYGON', technically_valid: true, gis_validation: 'PENDIENTE_P0_010',
      original: { sha256: sha(polygonBytes), byte_size: polygonBytes.length, filename: 'parcela.geojson' },
      stats: { components: 1, rings: 1, holes: 0, positions: 5 },
    });
    expect(imp.warnings.map((w: { code: string }) => w.code)).toContain('PROPERTIES_IGNORED');
    expect(imp.geometry.coordinates).toEqual([SQUARE]); // [lon, lat] intactos
    expect(Number(imp.area_calculated_ha)).toBeGreaterThan(1);
    // la organización/parcela del archivo no se usan
    expect((await h.db.selectFrom('geometry_imports').select('organization_id').where('id', '=', imp.id).executeTakeFirstOrThrow()).organization_id).toBe(orgA);
    // original intacto en el almacenamiento privado
    expect(sha(await store.get(await keyOf(imp.id)))).toBe(sha(polygonBytes));

    const c = await confirm('tecnico1@test.local', imp.id, { plot_expected_version: await plotVersion() }).expect(201);
    polygonVersionId = c.body.version.id;
    expect(c.body.version).toMatchObject({ geometry_type: 'POLYGON', survey_method: 'FILE_IMPORT', validation_status: 'NOT_VALIDATED', technically_valid: true, area_declared_ha: '3.0000', source_import_id: imp.id, source_import_sha256: sha(polygonBytes) });
    const pg = await sql<{ x: number; y: number }>`SELECT ST_X(ST_PointN(ST_ExteriorRing(geometry), 1)) AS x, ST_Y(ST_PointN(ST_ExteriorRing(geometry), 1)) AS y FROM plot_versions WHERE id = ${polygonVersionId}`.execute(h.db);
    expect(pg.rows[0]).toEqual({ x: -80.16, y: -0.848 }); // X = longitud, Y = latitud
    const ev = await h.db.selectFrom('domain_events').selectAll().where('aggregate_id', '=', plot).where('event_type', '=', 'PlotGeometryVersionCreated').orderBy('occurred_at', 'desc').executeTakeFirstOrThrow();
    expect(ev.payload).toMatchObject({ survey_method: 'FILE_IMPORT', geometry_import_id: imp.id, original_sha256: sha(polygonBytes) });
    const audits = await h.db.selectFrom('audit_logs').selectAll().where('entity_id', '=', plot).execute();
    const blob = JSON.stringify(ev.payload) + JSON.stringify(audits);
    expect(blob).not.toContain('-80.16');
    expect(blob).not.toContain('Nombre');
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(['plot.geometry_import_analyze', 'plot.geometry_import_confirm']));
    expect(JSON.stringify((await http().get(`${org()}/plots/${plot}/history`).set(as('admin-a@test.local')).expect(200)).body)).toContain('GEOMETRY_VERSION');
  });

  it('descarga del original: bytes y hash idénticos, revalidando permisos; auditor sin acceso', async () => {
    const res = await http().get(`${org()}/geometry-imports/${polygonImportId}/original`).set(as('tecnico1@test.local')).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(Buffer.compare(res.body as Buffer, polygonBytes)).toBe(0);
    expect(res.headers['x-content-sha256']).toBe(sha(polygonBytes));
    expect(res.headers['content-disposition']).toContain('attachment');
    await http().get(`${org()}/geometry-imports/${polygonImportId}/original`).set(as('auditor@test.local')).expect(403);
    await http().get(`${org()}/geometry-imports/${polygonImportId}`).set(as('auditor@test.local')).expect(403);
    await http().get(`${org()}/plots/${plot}/geometry-imports`).set(as('auditor@test.local')).expect(403);
    await http().get(`${org()}/geometry-imports/${polygonImportId}/original`).set(as('tecnico2@test.local')).expect(404); // no asignado
  });

  it('doble confirmación: mismo operation_id → réplica sin duplicar; otro → 409; concurrente → una sola versión', async () => {
    const a = await analyze('tecnico1@test.local', file({ type: 'Polygon', coordinates: [SQUARE.map(([x, y]) => [x + 0.001, y])] })).expect(201);
    const before = await counts();
    const op = randomUUID();
    const body = { operation_id: op, plot_expected_version: await plotVersion() };
    const [r1, r2] = await Promise.all([
      http().post(`${org()}/geometry-imports/${a.body.import.id}/confirm`).set(as('tecnico1@test.local')).send(body),
      http().post(`${org()}/geometry-imports/${a.body.import.id}/confirm`).set(as('tecnico1@test.local')).send(body),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(r1.body.version.id).toBe(r2.body.version.id);
    expect((await counts()).versions).toBe(before.versions + 1);
    const other = await confirm('tecnico1@test.local', a.body.import.id, { plot_expected_version: await plotVersion() }).expect(409);
    expect(other.body.error.code).toBe('IMPORT_ALREADY_CONFIRMED');
    // reintento del análisis con el mismo operation_id: misma importación; con otro archivo → 409
    const op2 = randomUUID();
    const bytes = file({ type: 'Polygon', coordinates: [SQUARE] });
    const first = await analyze('tecnico1@test.local', bytes, op2).expect(201);
    const again = await analyze('tecnico1@test.local', bytes, op2).expect(200);
    expect(again.body.import.id).toBe(first.body.import.id);
    expect((await analyze('tecnico1@test.local', file({ type: 'Polygon', coordinates: [HOLE] }), op2).expect(409)).body.error.code).toBe('OPERATION_ID_REUSED');
    await http().post(`${org()}/geometry-imports/${first.body.import.id}/discard`).set(as('tecnico1@test.local')).expect(200);
  });

  it('conflicto concurrente: la parcela cambió tras el análisis → 409, importación conservada y sin efectos', async () => {
    const a = await analyze('admin-a@test.local', file({ type: 'Polygon', coordinates: [SQUARE] })).expect(201);
    const before = await counts();
    const res = await confirm('admin-a@test.local', a.body.import.id, { plot_expected_version: (await plotVersion()) - 1 }).expect(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
    expect(await counts()).toEqual(before);
    expect((await http().get(`${org()}/geometry-imports/${a.body.import.id}`).set(as('admin-a@test.local')).expect(200)).body.status).toBe('ANALYZED');
    await http().post(`${org()}/geometry-imports/${a.body.import.id}/discard`).set(as('admin-a@test.local')).expect(200);
  });

  it('MultiPolygon con hueco: componentes, huecos y superficie de una geometría válida', async () => {
    const mp = { type: 'MultiPolygon', coordinates: [[SQUARE, HOLE], [SQUARE.map(([x, y]) => [x + 0.01, y])]] };
    const a = await analyze('admin-a@test.local', file(mp)).expect(201);
    expect(a.body.import).toMatchObject({ geometry_type: 'MULTIPOLYGON', technically_valid: true, stats: { components: 2, rings: 3, holes: 1 } });
    const c = await confirm('admin-a@test.local', a.body.import.id, { plot_expected_version: await plotVersion() }).expect(201);
    expect(c.body.version.geometry_type).toBe('MULTIPOLYGON');
    expect(c.body.version.geometry.coordinates).toEqual(mp.coordinates);
  });

  it('autointersección: análisis con motivo (sin área); confirmación rechazada salvo conservar para revisión; sin reparar', async () => {
    const a = await analyze('admin-a@test.local', file({ type: 'Polygon', coordinates: [BOWTIE] })).expect(201);
    expect(a.body.import).toMatchObject({ technically_valid: false, area_calculated_ha: null });
    expect(a.body.import.validity_reason).toMatch(/Self-intersection/i);
    expect(a.body.import.validity_reason).not.toMatch(/\d/); // sin coordenadas en el motivo
    expect(a.body.import.validity_location.type).toBe('Point'); // ubicación solo para quien tiene geometría exacta
    const rej = await confirm('admin-a@test.local', a.body.import.id, { plot_expected_version: await plotVersion() }).expect(422);
    expect(rej.body.error.code).toBe('GEOMETRY_NOT_VALID');
    expect(JSON.stringify(rej.body)).not.toContain('-80.1');
    const kept = await confirm('admin-a@test.local', a.body.import.id, { plot_expected_version: await plotVersion(), keep_invalid_for_review: true }).expect(201);
    expect(kept.body.version).toMatchObject({ technically_valid: false, area_calculated_ha: null, validation_status: 'NOT_VALIDATED' });
    expect(kept.body.version.notes).not.toMatch(/-80/);
    expect(kept.body.version.geometry.coordinates).toEqual([BOWTIE]);
  });

  it('archivos fuera del perfil: errores comprensibles, sin almacenar nada ni eco de contenido', async () => {
    const before = await counts();
    const cases: Array<[Buffer, string]> = [
      [Buffer.from('{"type":"Polygon", "coordinates": [[[ SECRETO'), 'MALFORMED_JSON'],
      [file({ type: 'Point', coordinates: [-80.16, -0.848] }), 'TYPE_NOT_SUPPORTED'],
      [file({ type: 'FeatureCollection', features: [1, 2].map(() => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [SQUARE] } })) }), 'MULTIPLE_FEATURES'],
      [file({ type: 'Polygon', crs: { type: 'name', properties: { name: 'EPSG:32717' } }, coordinates: [SQUARE] }), 'CRS_NOT_SUPPORTED'],
      [file({ type: 'Polygon', coordinates: [SQUARE.map(([x, y]) => [x, y, 10])] }), 'EXTRA_DIMENSIONS_NOT_SUPPORTED'],
      [file({ type: 'Polygon', coordinates: [SQUARE.slice(0, 4)] }), 'RING_NOT_CLOSED'],
      [Buffer.alloc(h.config.geojson.maxBytes + 1, 0x20), 'FILE_TOO_LARGE'],
    ];
    for (const [bytes, expected] of cases) {
      const r = await analyze('admin-a@test.local', bytes).expect(422);
      expect(r.body.error.code).toBe(expected);
      expect(JSON.stringify(r.body)).not.toContain('SECRETO');
      expect(JSON.stringify(r.body)).not.toContain('-80.16');
    }
    expect(await counts()).toEqual(before);
    const ok = await analyze('admin-a@test.local', file({ type: 'Polygon', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }, coordinates: [SQUARE] })).expect(201);
    expect(ok.body.import.warnings.map((w: { code: string }) => w.code)).toContain('LEGACY_CRS84_IGNORED');
    await http().post(`${org()}/geometry-imports/${ok.body.import.id}/discard`).set(as('admin-a@test.local')).expect(200);
  });

  it('exportación de la versión actual y de una anterior; sin identidad personal; reimportación sin cambios silenciosos', async () => {
    const versions = (await http().get(`${org()}/plots/${plot}/geometry-versions`).set(as('admin-a@test.local')).expect(200)).body as Array<{ id: string; is_current: boolean; geometry_hash: string | null }>;
    const current = versions.find((v) => v.is_current)!;
    const cur = await http().get(`${org()}/plots/${plot}/geometry-versions/${current.id}/geojson`).set(as('tecnico1@test.local')).expect(200);
    expect(cur.headers['content-type']).toContain('application/geo+json');
    const old = await http().get(`${org()}/plots/${plot}/geometry-versions/${polygonVersionId}/geojson`).set(as('tecnico1@test.local')).expect(200);
    const feature = JSON.parse(old.text);
    expect(feature).toMatchObject({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [SQUARE] }, properties: { plot_code: 'PAR-1', validation_status: 'NOT_VALIDATED', survey_method: 'FILE_IMPORT' } });
    expect(feature.properties.notice).toMatch(/No es un paquete de debida diligencia EUDR/);
    expect(old.text).not.toContain('Finca uno');
    expect(old.text).not.toContain(orgA);
    // reimportar la exportación: misma geometría (mismo hash), solo propiedades ignoradas
    const re = await analyze('admin-a@test.local', Buffer.from(old.text)).expect(201);
    expect(re.body.import.geometry.coordinates).toEqual([SQUARE]);
    const c = await confirm('admin-a@test.local', re.body.import.id, { plot_expected_version: await plotVersion() }).expect(201);
    expect(c.body.version.geometry_hash).toBe(versions.find((v) => v.id === polygonVersionId)!.geometry_hash);
    // versión sin geometría (solo superficie declarada) y auditor
    const declared = versions.find((v) => v.geometry_hash === null)!;
    expect((await http().get(`${org()}/plots/${plot}/geometry-versions/${declared.id}/geojson`).set(as('admin-a@test.local')).expect(422)).body.error.code).toBe('VERSION_WITHOUT_GEOMETRY');
    await http().get(`${org()}/plots/${plot}/geometry-versions/${current.id}/geojson`).set(as('auditor@test.local')).expect(403);
  });

  it('revocación o reasignación después del análisis: la confirmación revalida', async () => {
    const a = await analyze('tecnico1@test.local', file({ type: 'Polygon', coordinates: [SQUARE] })).expect(201);
    const pr = await http().get(`${org()}/producers/${p1}`).set(as('admin-a@test.local')).expect(200);
    await http().put(`${org()}/producers/${p1}/assignment`).set(as('admin-a@test.local')).send({ expected_version: pr.body.row_version, membership_id: await mid('tecnico2@test.local') }).expect(200);
    await confirm('tecnico1@test.local', a.body.import.id, { plot_expected_version: await plotVersion() }).expect(404);
    await http().get(`${org()}/geometry-imports/${a.body.import.id}/original`).set(as('tecnico1@test.local')).expect(404);
    await http().post(`${org()}/members/${await mid('tecnico2@test.local')}/deactivate`).set(as('admin-a@test.local')).send({ reason: 'Revocación de prueba' }).expect(200);
    const revoked = await confirm('tecnico2@test.local', a.body.import.id, { plot_expected_version: await plotVersion() });
    expect([401, 403, 404]).toContain(revoked.status);
    await http().post(`/api/v1/organizations/${orgA}/suspend`).set(as('super@test.local')).send({ reason: 'Revisión' }).expect(200);
    expect((await confirm('admin-a@test.local', a.body.import.id, { plot_expected_version: await plotVersion() }).expect(403)).body.error.code).toBe('ORGANIZATION_SUSPENDED');
    await http().post(`/api/v1/organizations/${orgA}/reactivate`).set(as('super@test.local')).send({ reason: 'Fin' }).expect(200);
    expect((await http().get(`${org()}/geometry-imports/${a.body.import.id}`).set(as('admin-a@test.local')).expect(200)).body.status).toBe('ANALYZED');
    await http().post(`${org()}/geometry-imports/${a.body.import.id}/discard`).set(as('admin-a@test.local')).expect(200);
  });

  it('acceso entre organizaciones rechazado; auditor no puede importar', async () => {
    await analyze('admin-b@test.local', file({ type: 'Polygon', coordinates: [SQUARE] })).expect(404);
    await http().get(`/api/v1/organizations/${orgB}/geometry-imports/${polygonImportId}`).set(as('admin-b@test.local')).expect(404);
    await http().get(`/api/v1/organizations/${orgB}/geometry-imports/${polygonImportId}/original`).set(as('admin-b@test.local')).expect(404);
    await http().get(`/api/v1/organizations/${orgB}/plots/${plot}/geometry-versions/${polygonVersionId}/geojson`).set(as('admin-b@test.local')).expect(404);
    await analyze('auditor@test.local', file({ type: 'Polygon', coordinates: [SQUARE] })).expect(403);
  });

  it('fallos de almacenamiento: sin fila si la subida falla; compensación si falla la base; sin versión si falta el original; barrido de huérfanos', async () => {
    const before = await counts();
    // 1) S3 no disponible al subir → 503, nada en la base
    jest.spyOn(store, 'put').mockRejectedValueOnce(new Error('S3 caído'));
    expect((await analyze('admin-a@test.local', file({ type: 'Polygon', coordinates: [SQUARE] })).expect(503)).body.error.code).toBe('STORAGE_UNAVAILABLE');
    expect(await counts()).toEqual(before);
    // 2) falla la base después de subir → el objeto se borra (compensación)
    const deleteSpy = jest.spyOn(store, 'delete');
    await sql`CREATE OR REPLACE FUNCTION p009_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla forzada'; END $$`.execute(h.db);
    await sql`CREATE TRIGGER p009_fail BEFORE INSERT ON geometry_imports FOR EACH ROW EXECUTE FUNCTION p009_fail()`.execute(h.db);
    try {
      await analyze('admin-a@test.local', file({ type: 'Polygon', coordinates: [SQUARE] })).expect(500);
    } finally {
      await sql`DROP TRIGGER p009_fail ON geometry_imports`.execute(h.db);
      await sql`DROP FUNCTION p009_fail`.execute(h.db);
    }
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    const compensatedKey = deleteSpy.mock.calls[0][0];
    expect(await store.exists(compensatedKey)).toBe(false);
    expect(await counts()).toEqual(before);
    // 3) el original desapareció antes de confirmar → 409 sin versión
    const a = await analyze('admin-a@test.local', file({ type: 'Polygon', coordinates: [SQUARE] })).expect(201);
    jest.spyOn(store, 'exists').mockResolvedValueOnce(false);
    expect((await confirm('admin-a@test.local', a.body.import.id, { plot_expected_version: await plotVersion() }).expect(409)).body.error.code).toBe('ORIGINAL_MISSING');
    jest.spyOn(store, 'exists').mockRejectedValueOnce(new Error('S3 caído'));
    expect((await confirm('admin-a@test.local', a.body.import.id, { plot_expected_version: await plotVersion() }).expect(503)).body.error.code).toBe('STORAGE_UNAVAILABLE');
    const mid1 = await counts();
    expect(mid1.versions).toBe(before.versions);
    // 4) toda versión FILE_IMPORT apunta a un original existente
    const refs = await h.db.selectFrom('plot_versions as v').innerJoin('geometry_imports as gi', 'gi.id', 'v.source_import_id').select('gi.object_key').execute();
    for (const r of refs) expect(await store.exists(r.object_key)).toBe(true);
    // 5) descartar con fallo de borrado deja un huérfano que el barrido elimina; los ANALYZED/CONFIRMED se conservan
    jest.spyOn(store, 'delete').mockRejectedValueOnce(new Error('S3 caído'));
    await http().post(`${org()}/geometry-imports/${a.body.import.id}/discard`).set(as('admin-a@test.local')).expect(200);
    const discardedKey = await keyOf(a.body.import.id);
    expect(await store.exists(discardedKey)).toBe(true);
    await store.put(`organizations/${orgA}/geometry-imports/${randomUUID()}.geojson`, Buffer.from('{}'), 'application/geo+json'); // huérfano sin fila
    jest.restoreAllMocks();
    const task = await h.db.selectFrom('object_deletions').selectAll().where('object_key', '=', discardedKey).executeTakeFirstOrThrow();
    expect(task).toMatchObject({ reason: 'DISCARDED', status: 'FAILED', attempts: 1, last_error_code: 'STORAGE_DELETE_FAILED' }); // fallo registrado
    await h.db.updateTable('object_deletions').set({ next_attempt_at: new Date(0) }).where('object_key', '=', discardedKey).execute(); // vence la espera
    const swept = await h.app.get(GeometryImportsService).sweepOrphans({ orphanGraceSeconds: 0 });
    expect(swept.deleted).toBeGreaterThanOrEqual(2);
    expect(await store.exists(discardedKey)).toBe(false);
    for (const r of refs) expect(await store.exists(r.object_key)).toBe(true);
    await http().get(`${org()}/geometry-imports/${a.body.import.id}/original`).set(as('admin-a@test.local')).expect(404);
  });

  it('el original y su análisis son inmutables en la base', async () => {
    await expect(sql`UPDATE geometry_imports SET sha256 = repeat('0', 64) WHERE id = ${polygonImportId}`.execute(h.db)).rejects.toThrow(/inmutables/);
    await expect(sql`DELETE FROM geometry_imports WHERE id = ${polygonImportId}`.execute(h.db)).rejects.toThrow(/borrado/);
  });
});
