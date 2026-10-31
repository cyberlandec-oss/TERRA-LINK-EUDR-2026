import { randomUUID, createHash } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { ROLE_PERMISSIONS } from '../src/authz/catalog';
import { FixtureSatelliteProvider } from '../src/satellite/provider';
import { SatelliteRunner } from '../src/satellite/runner';
import { PiiCipher } from '../src/crypto/pii';
import { S3ObjectStore } from '../src/storage/object-store';
import { migrateTo, migrateToLatest } from '../src/db/database';

// Recorrido Productor → exportadora: autorización explícita y revocable de PARCELAS CONCRETAS para que otra organización las analice.
// PostgreSQL REAL, datos SINTÉTICOS, proveedor = fixture sintética (no hay llamada a ningún tercero). Lo que NO acredita: ningún análisis satelital real.
describeDb('satélite entre organizaciones: autorización por parcela, credencial del solicitante y aislamiento', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgO: string; // propietaria de las parcelas (asociación)
  let orgX: string; // exportadora
  let orgZ: string; // tercera, sin relación
  let plotP1: string; let plotP2: string;
  let prod1: string;
  const OWNER = 'admin-o@test.local';
  const XADMIN = 'admin-x@test.local';
  const ZADMIN = 'admin-z@test.local';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const square = { type: 'Polygon', coordinates: [[[-79.5, -1], [-79.49, -1], [-79.49, -0.99], [-79.5, -0.99], [-79.5, -1]]] };
  const dias = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
  const runner = () => new SatelliteRunner(h.db, [new FixtureSatelliteProvider()], {}, { maxAttempts: 1, backoffBaseMs: 1 });

  async function join(admin: string, o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const mid = async (email: string, o: string) => (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', o).executeTakeFirstOrThrow()).id;
  const authorize = (plot: string, body: Record<string, unknown> = {}, actor = OWNER) =>
    http().post(`${base(orgO)}/plots/${plot}/satellite/authorizations`).set(as(actor))
      .send({ operation_id: randomUUID(), grantee_organization_id: orgX, expires_at: dias(30), reason: 'Debida diligencia del lote de exportación', ...body });
  const ask = (auth: string, body: Record<string, unknown> = {}, actor = 'export@test.local', org = orgX) =>
    http().post(`${base(org)}/satellite/authorized-plots/${auth}/analyses`).set(as(actor)).send({ operation_id: randomUUID(), operation: 'FOREST_COVER', fixture_scenario: 'RESULT_COVERED', ...body });
  const jobRow = (id: string) => h.db.selectFrom('satellite_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const cleanQueue = () => sql`UPDATE satellite_jobs SET status = 'CANCELLED', outcome = 'CANCELLED', finished_at = now(), lease_token = NULL, locked_by = NULL, locked_until = NULL WHERE status IN ('REQUESTED','RUNNING')`.execute(h.db);

  beforeAll(async () => {
    process.env.SATELLITE_FIXTURE_ENABLED = 'true';
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(OWNER); await h.user(XADMIN); await h.user(ZADMIN);
    const mk = async (name: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgO = await mk('Asociación Propietaria', OWNER);
    orgX = await mk('Exportadora Solicitante', XADMIN);
    orgZ = await mk('Organización Ajena', ZADMIN);
    await join(OWNER, orgO, 'productor@test.local', 'PRODUCER');
    await join(XADMIN, orgX, 'export@test.local', 'EXPORT_MANAGER');
    await join(XADMIN, orgX, 'auditor-x@test.local', 'AUDITOR');
    prod1 = (await http().post(`${base(orgO)}/producers`).set(as(OWNER)).send({ producer_code: 'P-1', legal_name: 'Finca Propia Uno' }).expect(201)).body.id;
    const prod2 = (await http().post(`${base(orgO)}/producers`).set(as(OWNER)).send({ producer_code: 'P-2', legal_name: 'Finca de Otra Persona' }).expect(201)).body.id;
    const mkPlot = async (producer: string, code: string) => {
      const id = (await http().post(`${base(orgO)}/plots`).set(as(OWNER)).send({ producer_id: producer, plot_code: code, crop: 'Cacao' }).expect(201)).body.id;
      await http().post(`${base(orgO)}/plots/${id}/geometry-versions`).set(as(OWNER)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: square }).expect(201);
      return id as string;
    };
    plotP1 = await mkPlot(prod1, 'PL-1');
    plotP2 = await mkPlot(prod2, 'PL-2');
    const row = (await http().get(`${base(orgO)}/producers/${prod1}`).set(as(OWNER)).expect(200)).body;
    await http().put(`${base(orgO)}/producers/${prod1}/self-membership`).set(as(OWNER)).send({ expected_version: row.row_version, membership_id: await mid('productor@test.local', orgO), reason: 'Vínculo de prueba' }).expect(200);
  });
  afterAll(async () => { process.env.SATELLITE_FIXTURE_ENABLED = 'false'; await h?.close(); });
  beforeEach(async () => { process.env.SATELLITE_FIXTURE_ENABLED = 'true'; await cleanQueue(); });

  it('catálogo: la exportadora consulta y encarga, no autoriza ni toca parcelas, riesgo ni expediente; el Productor solo consulta', () => {
    const e = ROLE_PERMISSIONS.EXPORT_MANAGER;
    expect(e).toEqual(expect.arrayContaining(['satellite:read', 'satellite:request']));
    for (const no of ['satellite:authorize', 'plot:read', 'plot:read_geometry', 'plot:update', 'plot:create', 'risk:conclude', 'risk:review', 'dd:approve_package', 'evidence:verify']) expect(e).not.toContain(no);
    const p = ROLE_PERMISSIONS.PRODUCER;
    expect(p).toContain('satellite:read');
    for (const no of ['satellite:request', 'satellite:authorize']) expect(p).not.toContain(no);
    expect(ROLE_PERMISSIONS.ORG_ADMIN).toContain('satellite:authorize');
  });

  it('sin autorización la exportadora no ve ni encarga nada de la propietaria (control: la propietaria sí)', async () => {
    const vacio = await http().get(`${base(orgX)}/satellite/authorized-plots`).set(as('export@test.local')).expect(200);
    expect(vacio.body.authorized_plots).toEqual([]);
    // Por la ruta de la propietaria no es miembro: 404. Una concesión de lectura no es esta autorización.
    await http().post(`${base(orgO)}/plots/${plotP1}/satellite/analyses`).set(as('export@test.local')).send({ operation_id: randomUUID(), operation: 'FOREST_COVER' }).expect(404);
    await http().get(`${base(orgO)}/plots/${plotP1}/satellite`).set(as('export@test.local')).expect(404);
    await http().post(`${base(orgX)}/satellite/authorized-plots/${randomUUID()}/analyses`).set(as('export@test.local')).send({ operation_id: randomUUID(), operation: 'FOREST_COVER' }).expect(404);
    await http().post(`${base(orgO)}/plots/${plotP1}/satellite/analyses`).set(as(OWNER)).send({ operation_id: randomUUID(), operation: 'FOREST_COVER', fixture_scenario: 'RESULT_COVERED' }).expect(201);
  });

  it('quién puede autorizar: la administración de la propietaria; ni el Productor, ni la exportadora, ni una tercera', async () => {
    const ok = await authorize(plotP2, { grantee_organization_id: orgZ }).expect(201);
    expect(ok.body.authorization).toMatchObject({ plot_id: plotP2, status: 'ACTIVE', can_download: false, grantee: { id: orgZ } });
    await authorize(plotP1, {}, 'productor@test.local').expect(403);
    await authorize(plotP1, {}, XADMIN).expect(404);
    await authorize(plotP1, {}, ZADMIN).expect(404);
    await http().post(`${base(orgO)}/satellite/authorizations/${ok.body.authorization.id}/revoke`).set(as(XADMIN)).send({ reason: 'No es mía' }).expect(404);
    await http().post(`${base(orgO)}/satellite/authorizations/${ok.body.authorization.id}/revoke`).set(as(OWNER)).send({ reason: 'Limpieza de la prueba' }).expect(201);
  });

  it('validaciones: misma organización, destino inexistente, vencimiento pasado o sin tope, duplicada activa y repetición idempotente', async () => {
    await authorize(plotP1, { grantee_organization_id: orgO }).expect(422).then((r) => expect(r.body.error.code).toBe('AUTHORIZATION_SAME_ORGANIZATION'));
    await authorize(plotP1, { grantee_organization_id: randomUUID() }).expect(422).then((r) => expect(r.body.error.code).toBe('AUTHORIZATION_GRANTEE_INVALID'));
    await authorize(plotP1, { expires_at: dias(-1) }).expect(422).then((r) => expect(r.body.error.code).toBe('AUTHORIZATION_EXPIRY_INVALID'));
    await authorize(plotP1, { expires_at: dias(400) }).expect(422).then((r) => expect(r.body.error.code).toBe('AUTHORIZATION_EXPIRY_TOO_LONG'));
    await authorize(plotP1, { expires_at: undefined }).expect(400);
    const op = randomUUID();
    const a = await authorize(plotP1, { operation_id: op }).expect(201);
    const r = await authorize(plotP1, { operation_id: op }).expect(201);
    expect(r.body.replayed).toBe(true);
    expect(r.body.authorization.id).toBe(a.body.authorization.id);
    await authorize(plotP1).expect(409).then((x) => expect(x.body.error.code).toBe('AUTHORIZATION_ALREADY_ACTIVE'));
    await http().post(`${base(orgO)}/satellite/authorizations/${a.body.authorization.id}/revoke`).set(as(OWNER)).send({ reason: 'Fin de la comprobación' }).expect(201);
  });

  it('recorrido completo: autoriza una parcela; la exportadora la ve sin coordenadas ni productor, encarga con su versión y huella y consulta el resultado', async () => {
    const a = (await authorize(plotP1).expect(201)).body.authorization;
    const lista = await http().get(`${base(orgX)}/satellite/authorized-plots`).set(as('export@test.local')).expect(200);
    expect(lista.body.authorized_plots).toHaveLength(1); // la parcela PL-2 no se autorizó a esta organización
    const item = lista.body.authorized_plots[0];
    expect(item).toMatchObject({ authorization_id: a.id, plot_code: 'PL-1', owner_organization: { id: orgO, name: 'Asociación Propietaria' }, can_download: false });
    const texto = JSON.stringify(lista.body);
    for (const prohibido of ['-79.5', 'Finca Propia Uno', 'P-1', 'producer']) expect(texto).not.toContain(prohibido);

    const nuevo = await ask(a.id).expect(201);
    const jobId = nuevo.body.job.id as string;
    const fila = await jobRow(jobId);
    // Vive en el tenant de la parcela; conserva quién lo pidió, con qué autorización, qué versión y qué huella.
    expect(fila).toMatchObject({ organization_id: orgO, requesting_organization_id: orgX, authorization_id: a.id, plot_id: plotP1, status: 'REQUESTED' });
    expect(fila.geometry_hash).toBe(item.current_version.geometry_hash);
    expect(fila.plot_version_id).toBe(item.current_version.plot_version_id);
    expect(nuevo.body.job.requested_by_organization).toMatchObject({ id: orgX, name: 'Exportadora Solicitante', authorization_id: a.id });

    // Idempotente por operación; otro identificador de operación ajeno no se reutiliza.
    const op = nuevo.body.job.id;
    const again = await http().post(`${base(orgX)}/satellite/authorized-plots/${a.id}/analyses`).set(as('export@test.local')).send({ operation_id: fila.operation_id, operation: 'FOREST_COVER' }).expect(201);
    expect(again.body).toMatchObject({ replayed: true, job: { id: op } });

    expect((await runner().runOnce()).completed).toBeGreaterThanOrEqual(1);
    const vista = await http().get(`${base(orgX)}/satellite/authorized-analyses/${jobId}`).set(as('export@test.local')).expect(200);
    expect(vista.body).toMatchObject({ outcome: 'RESULT_AVAILABLE', result: { conclusion: 'NOT_EVALUATED', coverage: { status: expect.any(String) } } });
    expect(vista.body.result.provenance).toBeTruthy();
    expect(JSON.stringify(vista.body)).not.toContain('-79.5');
    // Indicadores en CSV con su procedencia: sin geometría, así que no exige la autorización de descarga (can_download=false aquí); se audita en ambas.
    const csv = await http().get(`${base(orgX)}/satellite/authorized-analyses/${jobId}/indicators.csv`).set(as('export@test.local')).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const filas = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(filas[0]).toBe('indicador,valor,proveedor,dataset,version_dataset,fecha_analisis,cobertura,version_parcela,huella_geometria,origen');
    expect(filas.length).toBeGreaterThan(1);
    expect(filas[1]).toContain(fila.geometry_hash);
    expect(filas[1]).toContain('SINTETICO');
    expect(csv.text).not.toContain('-79.5');
    await http().get(`${base(orgZ)}/satellite/authorized-analyses/${jobId}/indicators.csv`).set(as(ZADMIN)).expect(404);
    await http().get(`${base(orgO)}/satellite/analyses/${jobId}/indicators.csv`).set(as('productor@test.local')).expect(200);
    await http().get(`${base(orgO)}/satellite/analyses/${jobId}/indicators.csv`).set(as('export@test.local')).expect(404);
    for (const o of [orgX, orgO]) {
      expect(await h.db.selectFrom('audit_logs').select('id').where('organization_id', '=', o).where('entity_id', '=', jobId).where('action', '=', 'satellite.indicators_download').execute()).not.toHaveLength(0);
    }
    const estado = await http().get(`${base(orgX)}/satellite/authorized-plots/${a.id}`).set(as('export@test.local')).expect(200);
    expect(estado.body.jobs.map((j: { id: string }) => j.id)).toContain(jobId);

    // La propietaria ve el mismo trabajo con quién lo pidió; el Productor vinculado lo ve en SU parcela y no puede encargar.
    const own = await http().get(`${base(orgO)}/plots/${plotP1}/satellite`).set(as(OWNER)).expect(200);
    expect(own.body.jobs.find((j: { id: string }) => j.id === jobId).requested_by_organization.name).toBe('Exportadora Solicitante');
    const prod = await http().get(`${base(orgO)}/plots/${plotP1}/satellite`).set(as('productor@test.local')).expect(200);
    expect(prod.body.jobs.map((j: { id: string }) => j.id)).toContain(jobId);
    expect(prod.body).toMatchObject({ can_request: false, request_blocked_reason: 'Tu rol no encarga análisis satelitales.' });
    await http().post(`${base(orgO)}/plots/${plotP1}/satellite/analyses`).set(as('productor@test.local')).send({ operation_id: randomUUID(), operation: 'FOREST_COVER' }).expect(403);
    // …pero no ve parcelas ajenas (la otra parcela es de otro productor).
    await http().get(`${base(orgO)}/plots/${plotP2}/satellite`).set(as('productor@test.local')).expect(404);
    await http().get(`${base(orgO)}/satellite/analyses/${jobId}`).set(as('productor@test.local')).expect(200);

    // El auditor de la exportadora (satellite:read) ve el trabajo, pero no puede encargar ni cancelar.
    await http().get(`${base(orgX)}/satellite/authorized-analyses/${jobId}`).set(as('auditor-x@test.local')).expect(200);
    await ask(a.id, {}, 'auditor-x@test.local').expect(403);
    await http().post(`${base(orgX)}/satellite/authorized-analyses/${jobId}/cancel`).set(as('auditor-x@test.local')).send({ operation_id: randomUUID(), reason: 'No me corresponde' }).expect(403);

    // Auditoría en las dos organizaciones.
    const audO = await h.db.selectFrom('audit_logs').select('action').where('organization_id', '=', orgO).where('action', '=', 'satellite.authorization_granted').execute();
    const audX = await h.db.selectFrom('audit_logs').select('action').where('organization_id', '=', orgX).where('action', '=', 'satellite.request_authorized_plot').where('entity_id', '=', jobId).execute();
    expect(audO.length).toBeGreaterThan(0);
    expect(audX).toHaveLength(1);

    await http().post(`${base(orgO)}/satellite/authorizations/${a.id}/revoke`).set(as(OWNER)).send({ reason: 'Fin de la comprobación' }).expect(201);
  });

  it('aislamiento: una tercera organización no ve la autorización, el trabajo ni puede encargar con el identificador conocido', async () => {
    const a = (await authorize(plotP1).expect(201)).body.authorization;
    const job = (await ask(a.id).expect(201)).body.job.id as string;
    await http().get(`${base(orgZ)}/satellite/authorized-plots`).set(as(ZADMIN)).expect(200).then((r) => expect(r.body.authorized_plots).toEqual([]));
    await http().get(`${base(orgZ)}/satellite/authorized-plots/${a.id}`).set(as(ZADMIN)).expect(404);
    await http().get(`${base(orgZ)}/satellite/authorized-analyses/${job}`).set(as(ZADMIN)).expect(404);
    await http().post(`${base(orgZ)}/satellite/authorized-analyses/${job}/cancel`).set(as(ZADMIN)).send({ operation_id: randomUUID(), reason: 'Ajeno' }).expect(404);
    await ask(a.id, {}, ZADMIN, orgZ).expect(404);
    // La exportadora tampoco llega por la ruta de la propietaria ni usa el id de otra organización como propio.
    await http().get(`${base(orgO)}/satellite/analyses/${job}`).set(as('export@test.local')).expect(404);
    await http().get(`${base(orgX)}/satellite/authorized-analyses/${job}`).set(as('export@test.local')).expect(200);
    // La propietaria no cancela el encargo de otra organización por su ruta: revoca.
    await http().post(`${base(orgO)}/satellite/analyses/${job}/cancel`).set(as(OWNER)).send({ operation_id: randomUUID(), reason: 'No es mío' }).expect(404);
    // La autorización de PL-1 no sirve para PL-2: el trabajo de esa autorización sigue siendo de PL-1.
    expect((await jobRow(job)).plot_id).toBe(plotP1);
    await http().post(`${base(orgO)}/satellite/authorizations/${a.id}/revoke`).set(as(OWNER)).send({ reason: 'Fin de la comprobación' }).expect(201);
  });

  it('cancelar: la exportadora cancela su encargo pendiente; uno ya terminado no se cancela', async () => {
    const a = (await authorize(plotP1).expect(201)).body.authorization;
    const pendiente = (await ask(a.id).expect(201)).body.job.id as string;
    const c = await http().post(`${base(orgX)}/satellite/authorized-analyses/${pendiente}/cancel`).set(as('export@test.local')).send({ operation_id: randomUUID(), reason: 'Ya no se necesita' }).expect(201);
    expect(c.body).toMatchObject({ status: 'CANCELLED', outcome: 'CANCELLED' });
    const hecho = (await ask(a.id).expect(201)).body.job.id as string;
    await runner().runOnce();
    await http().post(`${base(orgX)}/satellite/authorized-analyses/${hecho}/cancel`).set(as('export@test.local')).send({ operation_id: randomUUID(), reason: 'Tarde' }).expect(409);
    await http().post(`${base(orgO)}/satellite/authorizations/${a.id}/revoke`).set(as(OWNER)).send({ reason: 'Fin de la comprobación' }).expect(201);
  });

  it('revocar: cancela lo pendiente, bloquea encargos y consulta de la exportadora, se conserva para la propietaria y es idempotente', async () => {
    const a = (await authorize(plotP1).expect(201)).body.authorization;
    const hecho = (await ask(a.id).expect(201)).body.job.id as string;
    await runner().runOnce();
    const pendiente = (await ask(a.id).expect(201)).body.job.id as string;
    const r = await http().post(`${base(orgO)}/satellite/authorizations/${a.id}/revoke`).set(as(OWNER)).send({ reason: 'La exportadora ya no participa' }).expect(201);
    expect(r.body).toMatchObject({ replayed: false, cancelled_jobs: 1, authorization: { status: 'REVOKED', revoke_reason: 'La exportadora ya no participa' } });
    expect(await jobRow(pendiente)).toMatchObject({ status: 'CANCELLED', last_error_code: 'AUTHORIZATION_REVOKED' });
    // Control autorizado antes: lo anterior funcionaba; ahora se deniega con el motivo en claro.
    for (const res of [await ask(a.id), await http().get(`${base(orgX)}/satellite/authorized-plots/${a.id}`).set(as('export@test.local')), await http().get(`${base(orgX)}/satellite/authorized-analyses/${hecho}`).set(as('export@test.local'))]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SATELLITE_AUTHORIZATION_REVOKED');
    }
    const lista = await http().get(`${base(orgX)}/satellite/authorized-plots`).set(as('export@test.local')).expect(200);
    expect(lista.body.authorized_plots).toEqual([]);
    // La propietaria conserva el historial del trabajo y de la autorización.
    const own = await http().get(`${base(orgO)}/plots/${plotP1}/satellite`).set(as(OWNER)).expect(200);
    expect(own.body.jobs.map((j: { id: string }) => j.id)).toEqual(expect.arrayContaining([hecho, pendiente]));
    const auts = await http().get(`${base(orgO)}/plots/${plotP1}/satellite/authorizations`).set(as(OWNER)).expect(200);
    expect(auts.body.authorizations.find((x: { id: string }) => x.id === a.id)).toMatchObject({ status: 'REVOKED' });
    const otra = await http().post(`${base(orgO)}/satellite/authorizations/${a.id}/revoke`).set(as(OWNER)).send({ reason: 'Otra vez' }).expect(201);
    expect(otra.body).toMatchObject({ replayed: true, cancelled_jobs: 0 });
    // Revocada no se reactiva: se otorga otra, con su propio identificador.
    await expect(sql`UPDATE satellite_plot_authorizations SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE id = ${a.id}`.execute(h.db)).rejects.toThrow(/no se reactiva/);
    const nueva = await authorize(plotP1).expect(201);
    expect(nueva.body.authorization.id).not.toBe(a.id);
    await http().post(`${base(orgO)}/satellite/authorizations/${nueva.body.authorization.id}/revoke`).set(as(OWNER)).send({ reason: 'Fin de la comprobación' }).expect(201);
  });

  it('vencimiento: una autorización vencida deja de servir aunque no se haya revocado', async () => {
    const a = (await authorize(plotP1).expect(201)).body.authorization;
    await ask(a.id).expect(201); // control: vigente
    await sql`ALTER TABLE satellite_plot_authorizations DISABLE TRIGGER satellite_plot_authz_inmutable`.execute(h.db);
    try {
      await sql`UPDATE satellite_plot_authorizations SET created_at = now() - interval '3 days', expires_at = now() - interval '1 day' WHERE id = ${a.id}`.execute(h.db);
    } finally {
      await sql`ALTER TABLE satellite_plot_authorizations ENABLE TRIGGER satellite_plot_authz_inmutable`.execute(h.db);
    }
    const r = await ask(a.id).expect(403);
    expect(r.body.error.code).toBe('SATELLITE_AUTHORIZATION_EXPIRED');
    expect((await http().get(`${base(orgX)}/satellite/authorized-plots`).set(as('export@test.local')).expect(200)).body.authorized_plots).toEqual([]);
    const listada = await http().get(`${base(orgO)}/plots/${plotP1}/satellite/authorizations`).set(as(OWNER)).expect(200);
    expect(listada.body.authorizations.find((x: { id: string }) => x.id === a.id).status).toBe('EXPIRED');
    // Otorgar otra cierra la vencida (queda en el historial) y la nueva sí sirve.
    const nueva = (await authorize(plotP1).expect(201)).body.authorization;
    expect(await h.db.selectFrom('satellite_plot_authorizations').select('revoke_reason').where('id', '=', a.id).executeTakeFirstOrThrow()).toMatchObject({ revoke_reason: expect.stringMatching(/Vencida/) });
    await ask(nueva.id).expect(201);
    await http().post(`${base(orgO)}/satellite/authorizations/${nueva.id}/revoke`).set(as(OWNER)).send({ reason: 'Fin de la comprobación' }).expect(201);
  });

  it('descarga de la respuesta original: solo si la propietaria lo autorizó, verificada por huella y auditada en ambas', async () => {
    const sin = (await authorize(plotP1).expect(201)).body.authorization;
    const j1 = (await ask(sin.id).expect(201)).body.job.id as string;
    await runner().runOnce();
    const antes = await http().get(`${base(orgX)}/satellite/authorized-analyses/${j1}/original`).set(as('export@test.local')).expect(403);
    expect(antes.body.error.message).toMatch(/no autorizó la descarga/);
    await http().post(`${base(orgO)}/satellite/authorizations/${sin.id}/revoke`).set(as(OWNER)).send({ reason: 'Cambio de términos: con descarga' }).expect(201);

    const con = (await authorize(plotP1, { can_download: true }).expect(201)).body.authorization;
    const j2 = (await ask(con.id).expect(201)).body.job.id as string;
    const store = new S3ObjectStore(h.config.objectStore);
    const bytes = Buffer.from(JSON.stringify({ sintetico: true, indicador: 'prueba' }));
    const key = `satellite/${orgO}/${j2}-prueba.json`;
    await store.put(key, bytes, 'application/json');
    const sha = createHash('sha256').update(bytes).digest('hex');
    // `satellite_results` es append-only: el resultado con su evidencia original se inserta ya completo (no se edita uno existente).
    await sql`
      INSERT INTO satellite_results (id, organization_id, job_id, provider_code, is_synthetic, coverage_status, coverage_note, limitations, indicators, raw_object_key, raw_sha256)
      VALUES (${randomUUID()}, ${orgO}, ${j2}, 'FIXTURE_SYNTHETIC', true, 'UNKNOWN', 'Prueba de descarga', 'Prueba sintética', '{}'::jsonb, ${key}, ${sha})`.execute(h.db);
    const ok = await http().get(`${base(orgX)}/satellite/authorized-analyses/${j2}/original`).set(as('export@test.local')).expect(200);
    expect(ok.headers['x-content-sha256']).toBe(sha);
    expect(ok.headers['cache-control']).toBe('no-store');
    const vista = await http().get(`${base(orgX)}/satellite/authorized-analyses/${j2}`).set(as('export@test.local')).expect(200);
    expect(vista.body.result.raw_evidence).toMatchObject({ stored: true, sha256: sha, can_download: true });
    expect(JSON.stringify(vista.body)).not.toContain(key); // la ruta interna del almacén no se expone
    for (const o of [orgX, orgO]) {
      const aud = await h.db.selectFrom('audit_logs').select('action').where('organization_id', '=', o).where('entity_id', '=', j2).where('action', '=', 'satellite.original_download').execute();
      expect(aud).toHaveLength(1);
    }
    // Una huella que no coincide no se entrega.
    await store.put(key, Buffer.from('{"alterado":true}'), 'application/json');
    try {
      await http().get(`${base(orgX)}/satellite/authorized-analyses/${j2}/original`).set(as('export@test.local')).expect(500);
    } finally {
      await store.put(key, bytes, 'application/json');
    }
    await http().get(`${base(orgZ)}/satellite/authorized-analyses/${j2}/original`).set(as(ZADMIN)).expect(404);
    await http().post(`${base(orgO)}/satellite/authorizations/${con.id}/revoke`).set(as(OWNER)).send({ reason: 'Fin de la comprobación' }).expect(201);
    await http().get(`${base(orgX)}/satellite/authorized-analyses/${j2}/original`).set(as('export@test.local')).expect(403);
  });

  it('la credencial es la de la organización que SOLICITA, no la de la propietaria; y la base impide un trabajo con autorización ajena', async () => {
    const cipher = new PiiCipher(h.config.pii);
    const uid = (await h.db.selectFrom('users').select('id').where('email', '=', XADMIN).executeTakeFirstOrThrow()).id;
    for (const [org, secreto] of [[orgO, 'clave-sintetica-propietaria-0001'], [orgX, 'clave-sintetica-exportadora-0002']] as const) {
      await h.db.insertInto('satellite_credentials').values({
        organization_id: org, provider_code: 'WHISP', secret_ciphertext: cipher.encrypt(secreto, `satellite_credentials:${org}:WHISP`), created_by: uid,
      }).onConflict((oc) => oc.columns(['organization_id', 'provider_code']).doNothing()).execute();
    }
    const a = (await authorize(plotP1).expect(201)).body.authorization;
    const version = await h.db.selectFrom('plot_versions').select(['id', 'geometry_hash', 'geometry_type']).where('plot_id', '=', plotP1).where('geometry_hash', 'is not', null).orderBy('version_number', 'desc').executeTakeFirstOrThrow();
    const insertar = (extra: Record<string, unknown>) => h.db.insertInto('satellite_jobs').values({
      id: randomUUID(), organization_id: orgO, plot_id: plotP1, plot_version_id: version.id, geometry_hash: version.geometry_hash!, geometry_type: version.geometry_type as 'POLYGON',
      provider_code: 'WHISP', provider_kind: 'EXTERNAL_HTTP', adapter_contract_version: 'TL_SAT_ADAPTER 0.1.0', operation: 'FOREST_COVER', request_fingerprint: 'c'.repeat(64),
      status: 'REQUESTED', requested_by: uid, operation_id: randomUUID(), requesting_organization_id: orgX, authorization_id: a.id, ...extra,
    } as never).execute();
    // Coherencia en la base: ni solicitante distinto del destinatario, ni autorización de otra parcela, ni «propio» con autorización.
    await expect(insertar({ requesting_organization_id: orgZ })).rejects.toThrow(/autorizacion no corresponde/);
    await expect(insertar({ plot_id: plotP2 })).rejects.toThrow();
    await expect(insertar({ requesting_organization_id: orgO })).rejects.toThrow(/autorizacion no corresponde/);
    await expect(insertar({ authorization_id: null })).rejects.toThrow(/satellite_jobs_solicitante_autorizacion/);
    await insertar({});

    const vistas: Array<string | null> = [];
    const espia = { code: 'WHISP', kind: 'EXTERNAL_HTTP' as const,
      analyze: async (r: { credential: string | null }) => { vistas.push(r.credential); return { kind: 'NO_COVERAGE' as const, errorCode: 'ESPIA', note: 'no se llama a nadie' }; } };
    await new SatelliteRunner(h.db, [espia], { cipher }, { maxAttempts: 1, backoffBaseMs: 1 }).runOnce();
    expect(vistas).toEqual(['clave-sintetica-exportadora-0002']);
    expect(vistas).not.toContain('clave-sintetica-propietaria-0001');
    await http().post(`${base(orgO)}/satellite/authorizations/${a.id}/revoke`).set(as(OWNER)).send({ reason: 'Fin de la comprobación' }).expect(201);
  });

  it('los términos de una autorización no se editan: se revoca y se otorga otra', async () => {
    const a = (await authorize(plotP1).expect(201)).body.authorization;
    await expect(sql`UPDATE satellite_plot_authorizations SET can_download = true WHERE id = ${a.id}`.execute(h.db)).rejects.toThrow(/no se editan/);
    await expect(sql`UPDATE satellite_plot_authorizations SET expires_at = expires_at + interval '10 days' WHERE id = ${a.id}`.execute(h.db)).rejects.toThrow(/no se editan/);
    await expect(sql`UPDATE satellite_plot_authorizations SET grantee_organization_id = ${orgZ} WHERE id = ${a.id}`.execute(h.db)).rejects.toThrow(/no se editan/);
    await http().post(`${base(orgO)}/satellite/authorizations/${a.id}/revoke`).set(as(OWNER)).send({ reason: 'Fin de la comprobación' }).expect(201);
  });

  // ---------------------------------------------------------------- límites del recorrido (revalidación del worker y alcance de CSV y descargas)

  /** Proveedor espía: cuenta cuántas veces se le habría entregado una geometría. */
  const espia = () => {
    const p = new FixtureSatelliteProvider();
    const real = p.analyze.bind(p);
    const o = { llamadas: 0, provider: p };
    p.analyze = (async (...a: Parameters<typeof real>) => { o.llamadas++; return real(...a); }) as typeof p.analyze;
    return o;
  };
  const correrCon = async (sp: ReturnType<typeof espia>) => new SatelliteRunner(h.db, [sp.provider], {}, { maxAttempts: 1, backoffBaseMs: 1 }).runOnce();
  const caducar = async (authId: string) => {
    await sql`ALTER TABLE satellite_plot_authorizations DISABLE TRIGGER satellite_plot_authz_inmutable`.execute(h.db);
    try { await sql`UPDATE satellite_plot_authorizations SET created_at = now() - interval '3 days', expires_at = now() - interval '1 day' WHERE id = ${authId}`.execute(h.db); }
    finally { await sql`ALTER TABLE satellite_plot_authorizations ENABLE TRIGGER satellite_plot_authz_inmutable`.execute(h.db); }
  };
  const cerrar = (authId: string) => http().post(`${base(orgO)}/satellite/authorizations/${authId}/revoke`).set(as(OWNER)).send({ reason: 'Fin de la comprobación' });
  const conOriginal = async (jobId: string, owner: string) => {
    const store = new S3ObjectStore(h.config.objectStore);
    const bytes = Buffer.from(JSON.stringify({ sintetico: true, job: jobId }));
    const key = `satellite/${owner}/${jobId}-limites.json`;
    await store.put(key, bytes, 'application/json');
    await sql`
      INSERT INTO satellite_results (id, organization_id, job_id, provider_code, is_synthetic, coverage_status, coverage_note, limitations, indicators, raw_object_key, raw_sha256)
      VALUES (${randomUUID()}, ${owner}, ${jobId}, 'FIXTURE_SYNTHETIC', true, 'UNKNOWN', 'Prueba de límites', 'Prueba sintética', '{"a":1}'::jsonb, ${key}, ${createHash('sha256').update(bytes).digest('hex')})`.execute(h.db);
  };

  it('el worker revalida antes de enviar la geometría: vencida, revocada (carrera) o con una organización suspendida NO sale nada; vigente sí (control)', async () => {
    // Control: vigente → la geometría se entrega una vez.
    const a0 = (await authorize(plotP1).expect(201)).body.authorization;
    await ask(a0.id).expect(201);
    const ok = espia();
    await correrCon(ok);
    expect(ok.llamadas).toBe(1);
    await cerrar(a0.id).expect(201);

    // Vencida entre el encargo y el envío.
    const a1 = (await authorize(plotP1).expect(201)).body.authorization;
    const j1 = (await ask(a1.id).expect(201)).body.job.id as string;
    await caducar(a1.id);
    const s1 = espia(); await correrCon(s1);
    expect(s1.llamadas).toBe(0);
    expect(await jobRow(j1)).toMatchObject({ status: 'CANCELLED', outcome: 'CANCELLED', last_error_code: 'AUTHORIZATION_EXPIRED' });

    // Revocada: carrera simulada (la revocación quedó confirmada pero el trabajo aún no se había cancelado).
    const a2 = (await authorize(plotP1).expect(201)).body.authorization;
    const j2 = (await ask(a2.id).expect(201)).body.job.id as string;
    await sql`UPDATE satellite_plot_authorizations SET revoked_at = now(), revoked_by = granted_by, revoke_reason = 'Carrera simulada' WHERE id = ${a2.id}`.execute(h.db);
    const s2 = espia(); await correrCon(s2);
    expect(s2.llamadas).toBe(0);
    expect(await jobRow(j2)).toMatchObject({ status: 'CANCELLED', last_error_code: 'AUTHORIZATION_REVOKED' });

    // Organización solicitante suspendida entre el encargo y el envío.
    const a3 = (await authorize(plotP1).expect(201)).body.authorization;
    const j3 = (await ask(a3.id).expect(201)).body.job.id as string;
    await sql`UPDATE organizations SET status = 'SUSPENDED', status_reason = 'Prueba de límites' WHERE id = ${orgX}`.execute(h.db);
    try {
      const s3 = espia(); await correrCon(s3);
      expect(s3.llamadas).toBe(0);
      expect(await jobRow(j3)).toMatchObject({ status: 'CANCELLED', last_error_code: 'ORGANIZATION_NOT_ACTIVE' });
    } finally { await sql`UPDATE organizations SET status = 'ACTIVE', status_reason = NULL WHERE id = ${orgX}`.execute(h.db); }
    await cerrar(a3.id).expect(201);
  });

  it('el worker no envía una versión que ya no es la vigente aunque la autorización siga en vigor', async () => {
    const a = (await authorize(plotP2).expect(201)).body.authorization;
    const j = (await ask(a.id).expect(201)).body.job.id as string;
    const det = (await http().get(`${base(orgO)}/plots/${plotP2}`).set(as(OWNER)).expect(200)).body;
    await http().post(`${base(orgO)}/plots/${plotP2}/geometry-versions`).set(as(OWNER)).send({ expected_version: det.row_version, survey_method: 'MANUAL_COORDINATES', geometry: { ...square, coordinates: [square.coordinates[0].map(([x, y]) => [x + 0.01, y])] }, reason: 'Corrección posterior al encargo' }).expect(201);
    const sp = espia(); await correrCon(sp);
    expect(sp.llamadas).toBe(0);
    expect(await jobRow(j)).toMatchObject({ outcome: 'SUPERSEDED_GEOMETRY' });
    await cerrar(a.id).expect(201);
  });

  it('alcance de CSV y descargas en la API: el Productor no alcanza trabajos de otra persona, la exportadora solo los suyos de parcelas autorizadas, y el auditor de la exportadora no descarga el original', async () => {
    // Trabajo de la propietaria sobre la parcela del OTRO productor (PL-2), con respuesta original guardada.
    const jP2 = (await http().post(`${base(orgO)}/plots/${plotP2}/satellite/analyses`).set(as(OWNER)).send({ operation_id: randomUUID(), operation: 'FOREST_COVER', fixture_scenario: 'RESULT_COVERED' }).expect(201)).body.job.id as string;
    await conOriginal(jP2, orgO); // el resultado (con su original) se inserta ya completo: satellite_results es append-only
    // Control autorizado: la propietaria lo consulta, exporta y descarga.
    await http().get(`${base(orgO)}/satellite/analyses/${jP2}`).set(as(OWNER)).expect(200);
    await http().get(`${base(orgO)}/satellite/analyses/${jP2}/indicators.csv`).set(as(OWNER)).expect(200);
    await http().get(`${base(orgO)}/satellite/analyses/${jP2}/original`).set(as(OWNER)).expect(200);
    // El Productor vinculado a PL-1 no alcanza el trabajo de PL-2 por ninguna vía (la existencia no se revela: 404).
    for (const ruta of ['', '/indicators.csv', '/original']) await http().get(`${base(orgO)}/satellite/analyses/${jP2}${ruta}`).set(as('productor@test.local')).expect(404);
    // La exportadora, con PL-1 autorizada, no alcanza el trabajo de PL-2 ni por sus rutas ni por las de la propietaria.
    const a = (await authorize(plotP1, { can_download: true }).expect(201)).body.authorization;
    for (const ruta of ['', '/indicators.csv', '/original']) {
      await http().get(`${base(orgX)}/satellite/authorized-analyses/${jP2}${ruta}`).set(as('export@test.local')).expect(404);
      await http().get(`${base(orgO)}/satellite/analyses/${jP2}${ruta}`).set(as('export@test.local')).expect(404);
    }
    // Tampoco el trabajo que la PROPIETARIA encargó sobre la parcela autorizada (no lo solicitó la exportadora).
    const propio = (await http().post(`${base(orgO)}/plots/${plotP1}/satellite/analyses`).set(as(OWNER)).send({ operation_id: randomUUID(), operation: 'FOREST_COVER', fixture_scenario: 'RESULT_COVERED' }).expect(201)).body.job.id as string;
    await http().get(`${base(orgX)}/satellite/authorized-analyses/${propio}`).set(as('export@test.local')).expect(404);
    await http().get(`${base(orgX)}/satellite/authorized-analyses/${propio}/indicators.csv`).set(as('export@test.local')).expect(404);
    // Control: su propio trabajo, con descarga autorizada, la exportadora sí lo descarga; el auditor de su organización (solo lee) no descarga el original, pero sí el CSV sin geometría.
    const suyo = (await ask(a.id).expect(201)).body.job.id as string;
    await conOriginal(suyo, orgO);
    await http().get(`${base(orgX)}/satellite/authorized-analyses/${suyo}/original`).set(as('export@test.local')).expect(200);
    await http().get(`${base(orgX)}/satellite/authorized-analyses/${suyo}/original`).set(as('auditor-x@test.local')).expect(403);
    await http().get(`${base(orgX)}/satellite/authorized-analyses/${suyo}/indicators.csv`).set(as('auditor-x@test.local')).expect(200);
    // Revocada: ni el CSV ni el original; la propietaria conserva el acceso.
    await cerrar(a.id).expect(201);
    for (const ruta of ['/indicators.csv', '/original']) {
      const r = await http().get(`${base(orgX)}/satellite/authorized-analyses/${suyo}${ruta}`).set(as('export@test.local')).expect(403);
      expect(r.body.error.code).toBe('SATELLITE_AUTHORIZATION_REVOKED');
    }
    await http().get(`${base(orgO)}/satellite/analyses/${suyo}/original`).set(as(OWNER)).expect(200);
  });

  // Defecto hallado al desplegar sobre datos existentes: el relleno de la columna nueva tocaba trabajos TERMINADOS y su disparador de transiciones lo prohíbe.
  // Se prueba la migración 0072 sobre una base que ya tiene un trabajo COMPLETED (bajar a 0071 y volver a subir), y que el disparador sigue activo después.
  it('la migración 0072 se aplica sobre trabajos ya terminados, los marca como propios y deja el disparador de transiciones activo', async () => {
    const a = (await authorize(plotP1).expect(201)).body.authorization;
    const propio = (await http().post(`${base(orgO)}/plots/${plotP1}/satellite/analyses`).set(as(OWNER)).send({ operation_id: randomUUID(), operation: 'FOREST_COVER', fixture_scenario: 'RESULT_COVERED' }).expect(201)).body.job.id as string;
    await runner().runOnce();
    expect(await jobRow(propio)).toMatchObject({ status: 'COMPLETED' });
    await http().post(`${base(orgO)}/satellite/authorizations/${a.id}/revoke`).set(as(OWNER)).send({ reason: 'Antes de bajar la migración' }).expect(201);
    await migrateTo(h.db, '0071_sync_referencias_entregas');
    const sin = await sql<{ c: string }>`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'satellite_jobs' AND column_name = 'requesting_organization_id'`.execute(h.db);
    expect(sin.rows).toHaveLength(0);
    await migrateToLatest(h.db);
    const fila = await jobRow(propio);
    expect(fila).toMatchObject({ status: 'COMPLETED', requesting_organization_id: orgO, authorization_id: null });
    const todos = await sql<{ n: string }>`SELECT count(*)::text AS n FROM satellite_jobs WHERE requesting_organization_id <> organization_id`.execute(h.db);
    expect(todos.rows[0].n).toBe('0');
    // El disparador que impide reescribir un trabajo terminado sigue activo.
    await expect(sql`UPDATE satellite_jobs SET status = 'REQUESTED' WHERE id = ${propio}`.execute(h.db)).rejects.toThrow(/no vuelve a cambiar de estado/);
  });
});
