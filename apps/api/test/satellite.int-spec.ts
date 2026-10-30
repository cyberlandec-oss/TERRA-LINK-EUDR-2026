import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { ROLE_PERMISSIONS } from '../src/authz/catalog';
import { FixtureSatelliteProvider } from '../src/satellite/provider';
import { WhispSatelliteProvider } from '../src/satellite/whisp';
import { TlsFixture, json, loopbackLookup, tlsAvailable } from './tls-fixture';
import { SatelliteRunner } from '../src/satellite/runner';
import { PiiCipher } from '../src/crypto/pii';

// Integración P0-028 (primer proveedor satelital), base real. Contrato: docs/decisiones/P0-028-SATELITE.md.
// Lo que estas pruebas acreditan: el contrato, los permisos, los desenlaces y los candados de honestidad.
// Lo que NO acreditan: ningún análisis satelital real. No hay proveedor seleccionado (D-09) y todo lo que
// produce un resultado aquí es una FIXTURE SINTÉTICA, marcada como tal en la base y en la API.
describeDb('P0-028 satélite: contrato, desenlaces y candados', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let plotA: string;
  let plotSinGeometria: string;
  const ADMIN = 'admin-a@test.local';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const org = () => `/api/v1/organizations/${orgA}`;
  const square = { type: 'Polygon', coordinates: [[[-79.5, -1], [-79.49, -1], [-79.49, -0.99], [-79.5, -0.99], [-79.5, -1]]] };

  const fixtureOn = (on: boolean) => { process.env.SATELLITE_FIXTURE_ENABLED = on ? 'true' : 'false'; };
  /** `conAlmacen` usa un almacén en memoria: conserva los bytes originales sin depender del S3 local. */
  const guardados = new Map<string, Buffer>();
  const almacen = { put: async (k: string, b: Buffer) => { guardados.set(k, b); }, get: async (k: string) => guardados.get(k)!, exists: async (k: string) => guardados.has(k), delete: async () => undefined, list: async () => [], close: () => undefined };
  const runner = (opts = {}, conAlmacen = false) =>
    new SatelliteRunner(h.db, [new FixtureSatelliteProvider()], conAlmacen ? { store: almacen } : {}, { maxAttempts: 1, backoffBaseMs: 1, ...opts });
  const ask = (plot: string, body: Record<string, unknown> = {}, actor = ADMIN) =>
    http().post(`${org()}/plots/${plot}/satellite/analyses`).set(as(actor)).send({ operation_id: randomUUID(), operation: 'FOREST_COVER', ...body });
  const jobRow = (id: string) => h.db.selectFrom('satellite_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  async function join(o: string, email: string, role: string, admin = ADMIN) {
    const inv = await http().post(`/api/v1/organizations/${o}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop A', ADMIN);
    orgB = await mk('Coop B', 'admin-b@test.local');
    await join(orgA, 'auditor@test.local', 'AUDITOR');
    await join(orgA, 'calidad@test.local', 'QUALITY_OPERATOR');
    const producer = (await http().post(`${org()}/producers`).set(as(ADMIN)).send({ producer_code: 'P-1', legal_name: 'Finca 1' }).expect(201)).body.id;
    const mkPlot = async (code: string) => (await http().post(`${org()}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: code, crop: 'Cacao' }).expect(201)).body.id;
    plotA = await mkPlot('A');
    await http().post(`${org()}/plots/${plotA}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: square }).expect(201);
    plotSinGeometria = await mkPlot('SIN-GEO');
    await http().post(`${org()}/plots/${plotSinGeometria}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'DECLARED', area_declared_ha: 2.5 }).expect(201);
  });
  afterAll(async () => { fixtureOn(false); await h?.close(); });
  // Cada prueba parte sin encargos pendientes de la anterior: así los recuentos del corredor son exactos.
  beforeEach(async () => {
    fixtureOn(true);
    await sql`UPDATE satellite_jobs SET status = 'CANCELLED', outcome = 'CANCELLED', finished_at = now(), lease_token = NULL, locked_by = NULL, locked_until = NULL WHERE status IN ('REQUESTED','RUNNING')`.execute(h.db);
  });

  // ---------------------------------------------------------------- registro y decisión pendiente

  it('el registro distingue las dos aprobaciones de D-09: Whisp es adaptador de DESARROLLO, no proveedor autorizado', async () => {
    const r = await http().get(`${org()}/satellite/providers`).set(as(ADMIN)).expect(200);
    expect(r.body.selection).toMatchObject({ status: 'SELECTED_FOR_DEVELOPMENT', provider_code: 'WHISP', decision: 'D-09 parte A' });
    expect(r.body.selection.note).toMatch(/ADAPTADOR DE DESARROLLO/);
    expect(r.body.selection.decision_reference).toMatch(/NO autoriza llamadas reales/);
    // El interruptor de llamadas reales es independiente de la selección y está apagado.
    expect(r.body.live_calls_enabled).toBe(false);
    const codes = r.body.providers.map((p: { code: string }) => p.code).sort();
    expect(codes).toEqual(['EU_FOREST_OBSERVATORY', 'FIXTURE_SYNTHETIC', 'GFW', 'WHISP']);
    const whisp = r.body.providers.find((p: { code: string }) => p.code === 'WHISP');
    expect(whisp).toMatchObject({ selection_status: 'SELECTED_FOR_DEVELOPMENT', license: expect.stringContaining('MIT') });
    expect(whisp.data_sent_outside).toMatch(/Geometría de la parcela/);
    expect(whisp.allowed_hosts).toEqual(['whisp.openforis.org']);
    // Solo la operación que el contrato del proveedor respalda; las otras dos exigirían interpretar indicadores (D-07).
    expect(whisp.supported_operations).toEqual(['FOREST_COVER']);
    expect(whisp.limits).toMatch(/OpenAPI 2\.3\.0 consultado el 2026-10-15/);
    expect(whisp.coverage).toMatch(/NO declara cobertura por resultado/);
    // Los otros dos candidatos siguen siendo solo propuestas documentadas.
    expect(r.body.providers.filter((p: { selection_status: string }) => p.selection_status === 'PROPOSED').map((p: { code: string }) => p.code).sort())
      .toEqual(['EU_FOREST_OBSERVATORY', 'GFW']);
  });

  it('la base impide que una fixture sintética sea seleccionada, ni para uso real ni para desarrollo', async () => {
    const uid = (await h.db.selectFrom('users').select('id').where('email', '=', ADMIN).executeTakeFirstOrThrow()).id;
    await expect(sql`UPDATE satellite_providers SET selection_status = 'SELECTED', selected_by = ${uid}, decision_reference = 'D-09' WHERE code = 'FIXTURE_SYNTHETIC'`.execute(h.db))
      .rejects.toThrow(/satellite_providers_fixture/);
    await expect(sql`UPDATE satellite_providers SET selection_status = 'SELECTED_FOR_DEVELOPMENT', decision_reference = 'D-09 parte A' WHERE code = 'FIXTURE_SYNTHETIC'`.execute(h.db))
      .rejects.toThrow(/satellite_providers_fixture/);
  });

  it('la parte B exige responsable: no se puede marcar SELECTED sin quién lo decidió', async () => {
    await expect(sql`UPDATE satellite_providers SET selection_status = 'SELECTED', decision_reference = 'D-09 parte B' WHERE code = 'WHISP'`.execute(h.db))
      .rejects.toThrow(/satellite_providers_selection/);
  });

  it('un adaptador de desarrollo NO habilita encargar: no se crea trabajo ni sale ninguna coordenada', async () => {
    fixtureOn(false);
    const r = await ask(plotA).expect(409);
    expect(r.body.error.code).toBe('SATELLITE_REQUESTS_NOT_AUTHORIZED');
    expect(r.body.error.message).toMatch(/ADAPTADOR DE DESARROLLO \(D-09 parte A\)/);
    expect(r.body.error.message).toMatch(/parte B/);
    expect(await h.db.selectFrom('satellite_jobs').select('id').where('plot_id', '=', plotA).execute()).toHaveLength(0);
    // La pantalla dice lo mismo que la API, sin ofrecer un botón que el servidor va a rechazar.
    const v = await http().get(`${org()}/plots/${plotA}/satellite`).set(as(ADMIN)).expect(200);
    expect(v.body).toMatchObject({ can_request: false, provider_selection: { status: 'SELECTED_FOR_DEVELOPMENT', provider_code: 'WHISP', decision: 'D-09 parte A' } });
    expect(v.body.request_blocked_reason).toMatch(/ADAPTADOR DE DESARROLLO/);
  });

  it('sin ningún proveedor seleccionado la razón es la decisión pendiente, no un adaptador', async () => {
    fixtureOn(false);
    await sql`UPDATE satellite_providers SET selection_status = 'PROPOSED', decision_reference = NULL WHERE code = 'WHISP'`.execute(h.db);
    try {
      const r = await ask(plotA).expect(409);
      expect(r.body.error.code).toBe('SATELLITE_PROVIDER_NOT_SELECTED');
      expect(r.body.error.message).toMatch(/D-09/);
    } finally {
      await sql`UPDATE satellite_providers SET selection_status = 'SELECTED_FOR_DEVELOPMENT', decision_reference = 'D-09 parte A (2026-10-15): adaptador de desarrollo. NO autoriza llamadas reales, envío de geometrías, claves reales, contratación ni aceptación de términos (parte B pendiente).' WHERE code = 'WHISP'`.execute(h.db);
    }
  });

  // ---------------------------------------------------------------- permisos y clasificación de coordenadas

  it('leer exige satellite:read; un rol sin el permiso no ve el registro ni los trabajos', async () => {
    await http().get(`${org()}/satellite/providers`).set(as('calidad@test.local')).expect(403);
    await http().get(`${org()}/plots/${plotA}/satellite`).set(as('calidad@test.local')).expect(403);
    await http().get(`${org()}/satellite/providers`).set(as('auditor@test.local')).expect(200);
  });

  it('el AUDITOR lee pero no encarga: enviar coordenadas fuera es una facultad distinta', async () => {
    await ask(plotA, {}, 'auditor@test.local').expect(403);
  });

  it('ningún rol puede encargar un análisis sin el permiso que clasifica las coordenadas', () => {
    // Encargar saca la geometría exacta del equipo: el servicio exige plot:read_geometry además de
    // satellite:request. Esta comprobación fija la regla en el catálogo para que no se rompa al añadir roles.
    // Única excepción: EXPORT_MANAGER. No lee parcelas ni geometrías: encarga SOLO sobre parcelas que otra organización le autorizó de forma explícita y
    // revocable (la autorización es el consentimiento a que salga esa geometría), y por la ruta de la propietaria sigue sin poder (sin plot:read_geometry).
    expect(ROLE_PERMISSIONS.EXPORT_MANAGER).not.toContain('plot:read_geometry');
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      if (perms.includes('satellite:request') && role !== 'EXPORT_MANAGER') expect([role, perms.includes('plot:read_geometry')]).toEqual([role, true]);
    }
  });

  it('una parcela de otra organización no existe para esta', async () => {
    await http().get(`/api/v1/organizations/${orgB}/plots/${plotA}/satellite`).set(as('admin-b@test.local')).expect(404);
  });

  // ---------------------------------------------------------------- encargo

  it('la petición devuelve ACEPTACIÓN, no resultado, y queda ligada a la versión geométrica exacta', async () => {
    const r = await ask(plotA).expect(201);
    expect(r.body.job).toMatchObject({
      status: 'REQUESTED', outcome: null, operation: 'FOREST_COVER', applies_to_current_version: true,
      provider: { code: 'FIXTURE_SYNTHETIC', kind: 'SYNTHETIC_FIXTURE' }, result: null,
    });
    expect(r.body.job.outcome_note).toMatch(/se ejecuta fuera de esta petición/);
    const version = await h.db.selectFrom('plot_versions').select(['id', 'geometry_hash']).where('plot_id', '=', plotA).orderBy('version_number', 'desc').executeTakeFirstOrThrow();
    expect(r.body.job.subject).toMatchObject({ plot_version_id: version.id, geometry_hash: version.geometry_hash });
    const ev = await h.db.selectFrom('domain_events').selectAll().where('aggregate_id', '=', r.body.job.id).executeTakeFirstOrThrow();
    expect(ev.event_type).toBe('SatelliteAnalysisRequested');
    expect(JSON.stringify(ev.payload)).not.toContain('-79.5'); // el evento no lleva coordenadas
  });

  it('el mismo identificador de operación no encarga dos veces; reutilizarlo en otra parcela es conflicto', async () => {
    const opId = randomUUID();
    const first = await http().post(`${org()}/plots/${plotA}/satellite/analyses`).set(as(ADMIN)).send({ operation_id: opId, operation: 'FOREST_COVER' }).expect(201);
    const again = await http().post(`${org()}/plots/${plotA}/satellite/analyses`).set(as(ADMIN)).send({ operation_id: opId, operation: 'FOREST_COVER' }).expect(201);
    expect(again.body).toMatchObject({ replayed: true, job: { id: first.body.job.id } });
    const other = await http().post(`${org()}/plots/${plotSinGeometria}/satellite/analyses`).set(as(ADMIN)).send({ operation_id: opId, operation: 'FOREST_COVER' }).expect(409);
    expect(other.body.error.code).toBe('OPERATION_ID_REUSED');
  });

  it('una versión sin geometría no se analiza y la superficie declarada no la sustituye', async () => {
    const r = await ask(plotSinGeometria).expect(422);
    expect(r.body.error.code).toBe('GEOMETRY_UNSUPPORTED');
    expect(r.body.error.message).toMatch(/superficie declarada no la sustituye/i);
  });

  it('el proveedor debe declarar la operación pedida', async () => {
    await sql`UPDATE satellite_providers SET supported_operations = ARRAY['FOREST_COVER']::text[] WHERE code = 'FIXTURE_SYNTHETIC'`.execute(h.db);
    const r = await ask(plotA, { operation: 'HISTORICAL_ANALYSIS' }).expect(422);
    expect(r.body.error.code).toBe('SATELLITE_OPERATION_NOT_SUPPORTED');
    await sql`UPDATE satellite_providers SET supported_operations = ARRAY['FOREST_COVER','DEFORESTATION_ALERTS','HISTORICAL_ANALYSIS']::text[] WHERE code = 'FIXTURE_SYNTHETIC'`.execute(h.db);
  });

  it('se puede cancelar un encargo pendiente, y solo mientras lo esté', async () => {
    const job = (await ask(plotA).expect(201)).body.job.id;
    const c = await http().post(`${org()}/satellite/analyses/${job}/cancel`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Ya no se necesita' }).expect(201);
    expect(c.body).toMatchObject({ status: 'CANCELLED', outcome: 'CANCELLED', result: null });
    await http().post(`${org()}/satellite/analyses/${job}/cancel`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Otra vez' }).expect(409);
  });

  // ---------------------------------------------------------------- desenlaces (QA-15)

  it('resultado disponible: procedencia completa, rótulo sintético y conclusión NO EVALUADA', async () => {
    const job = (await ask(plotA, { fixture_scenario: 'RESULT_COVERED' }).expect(201)).body.job.id;
    expect(await runner().runOnce()).toMatchObject({ claimed: 1, completed: 1 });
    const r = await http().get(`${org()}/satellite/analyses/${job}`).set(as(ADMIN)).expect(200);
    expect(r.body).toMatchObject({ status: 'COMPLETED', outcome: 'RESULT_AVAILABLE' });
    expect(r.body.result).toMatchObject({
      is_synthetic: true,
      provenance: { provider_code: 'FIXTURE_SYNTHETIC', dataset: 'FIXTURE_DATASET', dataset_version: '0.0.0-sintetico', resolution_m: '10.00' },
      coverage: { status: 'COVERED' },
      confidence: null,
      conclusion: 'NOT_EVALUATED',
    });
    expect(r.body.result.synthetic_warning).toMatch(/no es análisis satelital real/);
    expect(r.body.result.confidence_note).toMatch(/no se infiere/);
    expect(r.body.result.limitations).toMatch(/FIXTURE SINTÉTICA/);
    const ev = await h.db.selectFrom('domain_events').selectAll().where('aggregate_id', '=', job).where('event_type', '=', 'SatelliteAnalysisCompleted').executeTakeFirstOrThrow();
    expect(ev).toBeTruthy();
  });

  it('«sin cobertura» NO es un resultado favorable: termina en el acto, sin resultado y sin reintento', async () => {
    const job = (await ask(plotA, { fixture_scenario: 'NO_COVERAGE' }).expect(201)).body.job.id;
    expect(await runner({ maxAttempts: 5 }).runOnce()).toMatchObject({ failed: 1, retried: 0 });
    const r = await http().get(`${org()}/satellite/analyses/${job}`).set(as(ADMIN)).expect(200);
    expect(r.body).toMatchObject({ status: 'FAILED', outcome: 'NO_COVERAGE', result: null, attempts: 1 });
    expect(r.body.outcome_note).toMatch(/«Sin alertas» no equivale a «sin deforestación»/);
  });

  it('plazo vencido y cupo agotado se reintentan mientras queden intentos; al agotarlos terminan sin resultado', async () => {
    for (const scenario of ['TIMEOUT', 'RATE_LIMITED'] as const) {
      const job = (await ask(plotA, { fixture_scenario: scenario }).expect(201)).body.job.id;
      const r2 = runner({ maxAttempts: 2 });
      expect(await r2.runOnce()).toMatchObject({ retried: 1, failed: 0 });
      expect((await jobRow(job)).status).toBe('REQUESTED');
      expect(await r2.runOnce()).toMatchObject({ failed: 1 });
      const row = await jobRow(job);
      expect(row).toMatchObject({ status: 'FAILED', outcome: scenario, attempts: 2 });
      expect(await h.db.selectFrom('satellite_results').select('id').where('job_id', '=', job).execute()).toHaveLength(0);
    }
  });

  it('un destino bloqueado por la defensa de salida termina en el acto aunque queden intentos', async () => {
    const job = (await ask(plotA, { fixture_scenario: 'EGRESS_BLOCKED' }).expect(201)).body.job.id;
    expect(await runner({ maxAttempts: 5 }).runOnce()).toMatchObject({ failed: 1, retried: 0 });
    const row = await jobRow(job);
    expect(row).toMatchObject({ status: 'FAILED', outcome: 'EGRESS_BLOCKED', attempts: 1, last_error_code: 'EGRESS_HOST_NOT_ALLOWED' });
  });

  it('si la parcela cambia de versión antes de correr, el trabajo no se traslada a la geometría nueva', async () => {
    const job = (await ask(plotA).expect(201)).body.job.id;
    const v = (await h.db.selectFrom('plots').select('row_version').where('id', '=', plotA).executeTakeFirstOrThrow()).row_version;
    await http().post(`${org()}/plots/${plotA}/geometry-versions`).set(as(ADMIN))
      .send({ expected_version: Number(v), survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Polygon', coordinates: [[[-78, -1], [-77.99, -1], [-77.99, -0.99], [-78, -0.99], [-78, -1]]] } }).expect(201);
    expect(await runner().runOnce()).toMatchObject({ superseded: 1 });
    const r = await http().get(`${org()}/satellite/analyses/${job}`).set(as(ADMIN)).expect(200);
    expect(r.body).toMatchObject({ status: 'FAILED', outcome: 'SUPERSEDED_GEOMETRY', applies_to_current_version: false, result: null });
    expect(r.body.outcome_note).toMatch(/no se traslada/);
  });

  // ---------------------------------------------------------------- candados de honestidad

  it('la respuesta original se acredita por su huella, nunca por su ruta en el almacén privado', async () => {
    const job = (await ask(plotA, { fixture_scenario: 'RESULT_COVERED' }).expect(201)).body.job.id;
    await runner({}, true).runOnce();
    const r = await http().get(`${org()}/satellite/analyses/${job}`).set(as(ADMIN)).expect(200);
    // Guardada de verdad (el corredor de esta prueba sí tiene almacén) y acreditada por SHA-256...
    expect(r.body.result.raw_evidence).toMatchObject({ stored: true, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    // ...pero la clave del objeto no sale por la API: revelaría la estructura del almacén privado.
    expect(JSON.stringify(r.body)).not.toContain('object_key');
    expect(JSON.stringify(r.body)).not.toMatch(/satellite\/[0-9a-f-]{36}\//);
  });

  it('un resultado no se corrige en su sitio ni un trabajo terminado vuelve a cambiar', async () => {
    const job = (await ask(plotA, { fixture_scenario: 'RESULT_COVERED' }).expect(201)).body.job.id;
    await runner().runOnce();
    await expect(sql`UPDATE satellite_results SET coverage_note = 'otra cosa' WHERE job_id = ${job}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM satellite_results WHERE job_id = ${job}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`UPDATE satellite_jobs SET status = 'REQUESTED', outcome = NULL, finished_at = NULL WHERE id = ${job}`.execute(h.db)).rejects.toThrow(/terminado/);
    await expect(sql`DELETE FROM satellite_jobs WHERE id = ${job}`.execute(h.db)).rejects.toThrow(/no se borra/);
  });

  it('ningún resultado puede guardarse con una conclusión: el esquema solo admite NOT_EVALUATED', async () => {
    const job = (await ask(plotA).expect(201)).body.job.id;
    await expect(sql`
      INSERT INTO satellite_results (id, organization_id, job_id, provider_code, is_synthetic, coverage_status, coverage_note, limitations, indicators, conclusion)
      VALUES (gen_random_uuid(), ${orgA}, ${job}, 'FIXTURE_SYNTHETIC', true, 'COVERED', 'nota', 'limitaciones declaradas', '{}'::jsonb, 'LIBRE_DE_DEFORESTACION')`.execute(h.db))
      .rejects.toThrow(/satellite_results_conclusion_check/);
  });

  it('un resultado sintético nunca satisface el requisito de análisis de deforestación del expediente', async () => {
    const job = (await ask(plotA, { fixture_scenario: 'RESULT_COVERED' }).expect(201)).body.job.id;
    await runner().runOnce();
    const version = (await jobRow(job)).plot_version_id;
    // Es exactamente la consulta que usa el expediente (P0-022) para dar por cumplido el requisito.
    const usable = await sql<{ plot_version_id: string }>`
      SELECT DISTINCT j.plot_version_id FROM satellite_jobs j JOIN satellite_results r ON r.job_id = j.id
       WHERE j.organization_id = ${orgA} AND j.plot_version_id = ${version}
         AND j.outcome = 'RESULT_AVAILABLE' AND r.is_synthetic = false AND r.coverage_status = 'COVERED'`.execute(h.db);
    expect(usable.rows).toHaveLength(0);
  });

  it('la credencial de un proveedor no cruza organizaciones: el corredor usa la de la organización del trabajo', async () => {
    // Trabajo de la organización A contra un proveedor EXTERNO, insertado directamente: el objetivo aquí es el
    // corredor, no la API. Cada organización registra SU credencial cifrada; el adaptador solo debe ver la suya.
    const cipher = new PiiCipher(h.config.pii);
    const uid = (await h.db.selectFrom('users').select('id').where('email', '=', ADMIN).executeTakeFirstOrThrow()).id;
    const version = await h.db.selectFrom('plot_versions').select(['id', 'geometry_hash', 'geometry_type'])
      .where('plot_id', '=', plotA).where('geometry_hash', 'is not', null).orderBy('version_number', 'desc').executeTakeFirstOrThrow();
    for (const [org, secreto] of [[orgA, 'clave-sintetica-de-A-0001'], [orgB, 'clave-sintetica-de-B-0002']] as const) {
      await h.db.insertInto('satellite_credentials').values({
        organization_id: org, provider_code: 'WHISP',
        secret_ciphertext: cipher.encrypt(secreto, `satellite_credentials:${org}:WHISP`), created_by: uid,
      }).onConflict((oc) => oc.columns(['organization_id', 'provider_code']).doNothing()).execute();
    }
    const jobId = randomUUID();
    await h.db.insertInto('satellite_jobs').values({
      id: jobId, organization_id: orgA, plot_id: plotA, plot_version_id: version.id, geometry_hash: version.geometry_hash!,
      geometry_type: version.geometry_type as 'POLYGON', provider_code: 'WHISP', provider_kind: 'EXTERNAL_HTTP',
      adapter_contract_version: 'TL_SAT_ADAPTER 0.1.0', operation: 'FOREST_COVER', request_fingerprint: 'b'.repeat(64),
      status: 'REQUESTED', requested_by: uid, operation_id: randomUUID(), requesting_organization_id: orgA, authorization_id: null,
    }).execute();

    const vistas: Array<string | null> = [];
    const espia = { code: 'WHISP', kind: 'EXTERNAL_HTTP' as const,
      analyze: async (r: { credential: string | null }) => { vistas.push(r.credential); return { kind: 'NO_COVERAGE' as const, errorCode: 'ESPIA', note: 'no se llama a nadie' }; } };
    await new SatelliteRunner(h.db, [espia], { cipher }, { maxAttempts: 1, backoffBaseMs: 1 }).runOnce();

    expect(vistas).toEqual(['clave-sintetica-de-A-0001']);
    expect(vistas).not.toContain('clave-sintetica-de-B-0002');
    const row = await jobRow(jobId);
    expect(row).toMatchObject({ status: 'FAILED', outcome: 'NO_COVERAGE' });
    // Ni la credencial ni las coordenadas quedan en el trabajo ni en sus eventos.
    const eventos = await h.db.selectFrom('domain_events').selectAll().where('aggregate_id', '=', jobId).execute();
    const texto = JSON.stringify({ row, eventos });
    expect(texto).not.toContain('clave-sintetica');
    expect(texto).not.toContain('-79.5');
  });

  it('la pantalla de parcela muestra el estado con sus límites escritos y sin coordenadas', async () => {
    const r = await http().get(`${org()}/plots/${plotA}/satellite`).set(as(ADMIN)).expect(200);
    expect(r.body.provider_selection).toMatchObject({ status: 'SELECTED_FOR_DEVELOPMENT', provider_code: 'WHISP', decision: 'D-09 parte A' });
    expect(r.body.provider_selection.note).toMatch(/ADAPTADOR DE DESARROLLO/);
    // Hay resultados sintéticos de pruebas anteriores: el estado sigue siendo NO EVALUADO.
    expect(r.body.analysis_status).toBe('NOT_EVALUATED');
    expect(r.body.limits.join(' ')).toMatch(/no es una conclusión jurídica/);
    expect(r.body.limits.join(' ')).toMatch(/«Sin alertas» no equivale a «sin deforestación»/);
    expect(JSON.stringify(r.body)).not.toContain('-79.5');
  });

  // ---------------------------------------------------------------- A-01: recorrido web de ENSAYO

  it('A-01 ENSAYO: con hallazgos y sin hallazgos, siempre rotulado, con limitaciones y sin conclusión', async () => {
    const evidenciasAntes = (await h.db.selectFrom('evidence').select('id').execute()).length;
    const riesgoAntes = (await h.db.selectFrom('risk_evaluations').select('id').execute()).length;
    const con = (await ask(plotA, { fixture_scenario: 'RESULT_FINDINGS' }).expect(201)).body.job.id;
    const sin = (await ask(plotA, { fixture_scenario: 'RESULT_NO_FINDINGS' }).expect(201)).body.job.id;
    expect(await runner().runOnce()).toMatchObject({ claimed: 2, completed: 2 });
    const a = (await http().get(`${org()}/satellite/analyses/${con}`).set(as(ADMIN)).expect(200)).body;
    const b = (await http().get(`${org()}/satellite/analyses/${sin}`).set(as(ADMIN)).expect(200)).body;
    for (const r of [a, b]) {
      expect(r.is_ensayo).toBe(true);
      expect(r.result.is_synthetic).toBe(true);
      expect(r.result.conclusion).toBe('NOT_EVALUATED');
      expect(r.result.limitations).toMatch(/no acredita ausencia ni presencia de deforestación/);
      expect(r.result.indicators.ensayo).toBe(true);
      expect(r.subject.plot_version_id).toBeTruthy();                      // versión geométrica exacta
      expect(r.result.provenance.analysis_date).toBeTruthy();
    }
    expect(a.result.indicators.findings).toMatchObject({ count: 3, kind: 'ALERTAS_SINTETICAS' });
    expect(b.result.indicators.findings).toMatchObject({ count: 0 });
    expect(b.result.indicators.findings.note).toMatch(/Sin hallazgos NO es lo mismo que sin deforestación/);
    // Ni con hallazgos ni sin ellos cambia el estado de la parcela: ensayo ≠ resultado operativo.
    const ficha = (await http().get(`${org()}/plots/${plotA}/satellite`).set(as(ADMIN)).expect(200)).body;
    expect(ficha.analysis_status).toBe('NOT_EVALUATED');
    // Un resultado sintético no se incorpora como evidencia operativa ni genera evaluaciones de riesgo.
    expect((await h.db.selectFrom('evidence').select('id').execute()).length).toBe(evidenciasAntes);
    expect((await h.db.selectFrom('risk_evaluations').select('id').execute()).length).toBe(riesgoAntes);
    expect(ficha.jobs.filter((j: { is_ensayo: boolean }) => j.is_ensayo).length).toBeGreaterThanOrEqual(2);
  });

  it('A-01 ENSAYO: la ficha declara el modo ensayo y los escenarios solo cuando hay fixture', async () => {
    let r = (await http().get(`${org()}/plots/${plotA}/satellite`).set(as(ADMIN)).expect(200)).body;
    expect(r.ensayo_mode).toBe(true);
    expect(r.provider_kind).toBe('SYNTHETIC_FIXTURE');
    expect(r.fixture_scenarios).toEqual(expect.arrayContaining(['RESULT_FINDINGS', 'RESULT_NO_FINDINGS', 'RESULT_PARTIAL', 'NO_COVERAGE', 'PROVIDER_ERROR']));
    fixtureOn(false);
    r = (await http().get(`${org()}/plots/${plotA}/satellite`).set(as(ADMIN)).expect(200)).body;
    expect(r.ensayo_mode).toBe(false);
    expect(r.fixture_scenarios).toEqual([]);
    expect(r.can_request).toBe(false);
  });

  it('A-01 ENSAYO: cobertura insuficiente, error y reintento (un encargo nuevo tras el fallo, sin tocar el anterior)', async () => {
    const parcial = (await ask(plotA, { fixture_scenario: 'RESULT_PARTIAL' }).expect(201)).body.job.id;
    const error = (await ask(plotA, { fixture_scenario: 'PROVIDER_ERROR' }).expect(201)).body.job.id;
    await runner().runOnce();
    const p = (await http().get(`${org()}/satellite/analyses/${parcial}`).set(as(ADMIN)).expect(200)).body;
    expect(p.result.coverage.status).toBe('PARTIAL');                       // cobertura insuficiente: se dice
    expect(p.result.coverage.note).toMatch(/no abarca toda la geometría/);
    const e = (await http().get(`${org()}/satellite/analyses/${error}`).set(as(ADMIN)).expect(200)).body;
    expect(e.status).toBe('FAILED');
    expect(e.result).toBeNull();                                            // un error no deja resultado favorable
    // Reintento: un encargo nuevo (otro operation_id) que sí resuelve; el fallido se conserva tal cual.
    const reintento = (await ask(plotA, { fixture_scenario: 'RESULT_NO_FINDINGS' }).expect(201)).body.job.id;
    await runner().runOnce();
    expect(reintento).not.toBe(error);
    expect((await jobRow(error)).status).toBe('FAILED');
    expect((await http().get(`${org()}/satellite/analyses/${reintento}`).set(as(ADMIN)).expect(200)).body.status).toBe('COMPLETED');
  });

  it('A-01 ENSAYO: cambiar la geometría no reutiliza el resultado anterior (no aplica a la versión vigente)', async () => {
    const job = (await ask(plotA, { fixture_scenario: 'RESULT_FINDINGS' }).expect(201)).body.job.id;
    await runner().runOnce();
    const antes = (await http().get(`${org()}/satellite/analyses/${job}`).set(as(ADMIN)).expect(200)).body;
    expect(antes.applies_to_current_version).toBe(true);
    const plot = (await http().get(`${org()}/plots/${plotA}`).set(as(ADMIN)).expect(200)).body;
    const nueva = { type: 'Polygon', coordinates: [[[-79.4, -1], [-79.39, -1], [-79.39, -0.99], [-79.4, -0.99], [-79.4, -1]]] };
    await http().post(`${org()}/plots/${plotA}/geometry-versions`).set(as(ADMIN)).send({ expected_version: plot.row_version, survey_method: 'MANUAL_COORDINATES', geometry: nueva }).expect(201);
    const despues = (await http().get(`${org()}/satellite/analyses/${job}`).set(as(ADMIN)).expect(200)).body;
    expect(despues.applies_to_current_version).toBe(false);
  });

  // ---------------------------------------------------------------- Whisp 2.3.1 contra un servidor CONTROLADO (no es el servicio real)
  // Acredita el recorrido encargo → corredor → progreso (trabajo asíncrono) → resultado guardado → consulta posterior con el
  // ADAPTADOR REAL de Whisp. El servidor es del equipo y la respuesta es SINTÉTICA con la forma del contrato 2.3.1: NO acredita
  // la integración con el servicio real de Whisp (sin clave ni autorización, sigue NO EJECUTADA).
  (tlsAvailable ? describe : describe.skip)('Whisp 2.3.1 · servidor controlado', () => {
    const CONFIG = { maxRequestBodySizeKb: 1024, maxPlotAreaHa: null, geometryLimitSync: 250, geometryLimitAsync: 5000, analysisTimeoutSyncSeconds: 90, analysisTimeoutAsyncSeconds: 600, openforisWhispVersion: '2.3.1-sintetico', geoidBaseUrl: null };
    const props = { plotId: '1', Area: 1.2, Country: 'ECU', Cocoa_FDaP: 0.5, Ind_01_treecover: 'no', Ind_03_disturbance_before_2020: 'yes', risk_pcrop: 'more_info_needed',
      whisp_processing_metadata: { whisp_version: '3.0.0a14', processing_timestamp_utc: '2026-06-11 01:59:15+0000' } };
    let tls: TlsFixture;
    beforeAll(() => { tls = new TlsFixture(); });
    afterAll(() => tls?.close());

    async function trabajo(extra: Record<string, unknown> = {}) {
      const cipher = new PiiCipher(h.config.pii);
      const uid = (await h.db.selectFrom('users').select('id').where('email', '=', ADMIN).executeTakeFirstOrThrow()).id;
      const version = await h.db.selectFrom('plot_versions').select(['id', 'geometry_hash', 'geometry_type'])
        .where('plot_id', '=', plotA).where('geometry_hash', 'is not', null).orderBy('version_number', 'desc').executeTakeFirstOrThrow();
      await h.db.insertInto('satellite_credentials').values({
        organization_id: orgA, provider_code: 'WHISP', secret_ciphertext: cipher.encrypt('clave-sintetica-de-A-0001', `satellite_credentials:${orgA}:WHISP`), created_by: uid,
      }).onConflict((oc) => oc.columns(['organization_id', 'provider_code']).doNothing()).execute();
      const id = randomUUID();
      await h.db.insertInto('satellite_jobs').values({
        id, organization_id: orgA, plot_id: plotA, plot_version_id: version.id, geometry_hash: version.geometry_hash!, geometry_type: version.geometry_type as 'POLYGON',
        provider_code: 'WHISP', provider_kind: 'EXTERNAL_HTTP', adapter_contract_version: 'TL_SAT_ADAPTER 0.1.0', operation: 'FOREST_COVER',
        request_fingerprint: randomUUID().replace(/-/g, '').padEnd(64, '0'), status: 'REQUESTED', requested_by: uid, operation_id: randomUUID(), ...extra,
      } as never).execute();
      return { id, cipher };
    }
    async function correr(responder: Parameters<TlsFixture['listen']>[0], extra: Record<string, unknown> = {}, opt: { maxAttempts?: number; store?: unknown } = {}) {
      const srv = await tls.listen(responder);
      const previo = await h.db.selectFrom('satellite_providers').select('allowed_hosts').where('code', '=', 'WHISP').executeTakeFirstOrThrow();
      await sql`UPDATE satellite_providers SET allowed_hosts = ${[`destino.prueba.local:${srv.port}`]} WHERE code = 'WHISP'`.execute(h.db);
      try {
        const { id, cipher } = await trabajo(extra);
        const whisp = new WhispSatelliteProvider({ liveCalls: true, baseUrl: `https://destino.prueba.local:${srv.port}`, ca: tls.ca, lookup: loopbackLookup, timeoutMs: 4000, pollMs: 1, maxPolls: 5, sleep: async () => undefined } as never);
        await new SatelliteRunner(h.db, [whisp], { cipher, store: (opt.store ?? almacen) as never }, { maxAttempts: opt.maxAttempts ?? 1, backoffBaseMs: 1 }).runOnce();
        return { id, srv };
      } finally {
        await sql`UPDATE satellite_providers SET allowed_hosts = ${previo.allowed_hosts} WHERE code = 'WHISP'`.execute(h.db);
      }
    }

    it('encargo asíncrono (202 → estado → resultado): se guarda con proveedor, versión geométrica, fecha DECLARADA y respuesta original, y se consulta después', async () => {
      let consultas = 0;
      const { id, srv } = await correr((r, res) => {
        if (r.url === '/api/config') return json(res, 200, CONFIG);
        if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'tk-1', statusUrl: '/api/status/tk-1', featureCount: 1 } });
        if (r.url === '/api/status/tk-1') {
          return ++consultas < 2 ? json(res, 202, { code: 'analysis_processing', message: 'p', data: { token: 'tk-1', percent: 40, processStatusMessage: [] } })
            : json(res, 200, { code: 'analysis_completed', message: 'ok', data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: props }] } });
        }
        return json(res, 404, { code: 'x' });
      });
      expect(consultas).toBe(2);
      expect(srv.recibidas.find((x) => x.url === '/api/submit/geojson')!.headers['x-api-key']).toBe('clave-sintetica-de-A-0001');
      // Consulta posterior (otra petición, otro momento): misma información.
      for (let i = 0; i < 2; i++) {
        const r = await http().get(`${org()}/satellite/analyses/${id}`).set(as(ADMIN)).expect(200);
        expect(r.body).toMatchObject({ status: 'COMPLETED', outcome: 'RESULT_AVAILABLE', is_ensayo: false, provider: { code: 'WHISP', kind: 'EXTERNAL_HTTP' } });
        expect(r.body.result.is_synthetic).toBe(false);
        expect(r.body.result.provenance).toMatchObject({ provider_code: 'WHISP', dataset: null, resolution_m: null });
        expect(new Date(r.body.result.provenance.analysis_date).toISOString()).toBe('2026-06-11T01:59:15.000Z');
        expect(r.body.result.provenance.method).toContain('3.0.0a14');
        expect(r.body.result.confidence).toBeNull();
        expect(r.body.result.indicators).toMatchObject({ risk_pcrop: 'more_info_needed', Ind_01_treecover: 'no' });
        expect(r.body.result.raw_evidence).toMatchObject({ stored: true });
        expect(r.body.result).toMatchObject({ conclusion: 'NOT_EVALUATED', coverage: { status: 'UNKNOWN' } });
        expect(JSON.stringify(r.body)).not.toContain('clave-sintetica');
        expect(JSON.stringify(r.body)).not.toContain('-79.5');
      }
    });

    it('un error del proveedor NO guarda resultado ni lo presenta como cero: el trabajo falla y la parcela sigue sin evaluar', async () => {
      const { id } = await correr((r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 500, { code: 'analysis_error', message: 'e' })));
      const row = await jobRow(id);
      expect(row).toMatchObject({ status: 'FAILED', outcome: 'PROVIDER_ERROR' });
      const resultados = await h.db.selectFrom('satellite_results').select('id').where('job_id', '=', id).execute();
      expect(resultados).toHaveLength(0);
      const r = await http().get(`${org()}/satellite/analyses/${id}`).set(as(ADMIN)).expect(200);
      expect(r.body.result).toBeNull();
    });

    // ------------------------------------------------------------ AJ-06: avance, reanudación, cancelación y credencial por organización
    const completo = { code: 'analysis_completed', message: 'ok', data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: props }] } };

    it('el avance declarado por el proveedor queda en el trabajo y se ve por la API; el identificador del trabajo del proveedor NO se expone', async () => {
      let n = 0;
      const { id } = await correr((r, res) => {
        if (r.url === '/api/config') return json(res, 200, CONFIG);
        if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'tk-prog' } });
        if (r.url === '/api/status/tk-prog') return ++n < 3 ? json(res, 202, { code: 'analysis_processing', message: 'p', data: { token: 'tk-prog', percent: 60, processStatusMessage: ['procesando'] } }) : json(res, 200, completo);
        return json(res, 404, { code: 'x' });
      });
      const row = await jobRow(id);
      expect(row).toMatchObject({ status: 'COMPLETED', provider_job_ref: 'tk-prog', provider_progress_percent: 60, provider_progress_note: 'procesando' });
      const v = await http().get(`${org()}/satellite/analyses/${id}`).set(as(ADMIN)).expect(200);
      expect(v.body.progress).toMatchObject({ percent: 60, note: 'procesando' });
      expect(v.body.provider_job_started).toBe(true);
      expect(JSON.stringify(v.body)).not.toContain('tk-prog');
    });

    it('un reintento con el identificador guardado retoma la consulta y NO vuelve a enviar la geometría', async () => {
      const { id, srv } = await correr((r, res) => {
        if (r.url === '/api/config') return json(res, 200, CONFIG);
        if (r.url === '/api/status/tk-viejo') return json(res, 200, completo);
        return json(res, 404, { code: 'x' });
      }, { provider_job_ref: 'tk-viejo' });
      expect(await jobRow(id)).toMatchObject({ status: 'COMPLETED', outcome: 'RESULT_AVAILABLE' });
      expect(srv.recibidas.map((x) => x.url)).not.toContain('/api/submit/geojson');
    });

    it('cancelar un trabajo en curso registra la petición (con su responsable) y el corredor lo cancela también en el proveedor', async () => {
      const uid = (await h.db.selectFrom('users').select('id').where('email', '=', ADMIN).executeTakeFirstOrThrow()).id;
      // Trabajo ya iniciado (RUNNING, arrendamiento vigente): la API solo registra la petición.
      const vivo = await trabajo({ status: 'RUNNING', locked_by: 'otro', lease_token: randomUUID(), locked_until: new Date(Date.now() + 600_000), provider_job_ref: 'tk-vivo' });
      const c = await http().post(`${org()}/satellite/analyses/${vivo.id}/cancel`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Ya no se necesita' }).expect(201);
      expect(c.body).toMatchObject({ status: 'RUNNING', cancel_requested: { reason: 'Ya no se necesita' } });
      expect(await jobRow(vivo.id)).toMatchObject({ cancel_requested_by: uid });
      // Repetirla no duplica ni falla.
      await http().post(`${org()}/satellite/analyses/${vivo.id}/cancel`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Otra vez' }).expect(201);
      // El corredor atiende una cancelación pedida: trabajo vencido con petición de cancelar → se cancela en el proveedor.
      const { id, srv } = await correr((r, res) => {
        if (r.url === '/api/config') return json(res, 200, CONFIG);
        if (r.url === '/api/status/tk-cancel/cancel') return json(res, 200, { code: 'analysis_cancelled', message: 'c' });
        if (r.url === '/api/status/tk-cancel') return json(res, 202, { code: 'analysis_processing', message: 'p', data: { token: 'tk-cancel', percent: 5 } });
        return json(res, 404, { code: 'x' });
      }, { status: 'RUNNING', locked_by: 'muerto', lease_token: randomUUID(), locked_until: new Date(Date.now() - 1000), provider_job_ref: 'tk-cancel', cancel_requested_at: new Date(), cancel_requested_by: uid, cancel_reason: 'prueba' });
      expect(await jobRow(id)).toMatchObject({ status: 'CANCELLED', outcome: 'CANCELLED' });
      expect(srv.recibidas.some((x) => x.url === '/api/status/tk-cancel/cancel' && x.method === 'POST')).toBe(true);
      expect((await h.db.selectFrom('satellite_results').select('id').where('job_id', '=', id).execute())).toHaveLength(0);
    });

    it('credencial por organización: la registra quien administra integraciones, se cifra con su contexto, no se devuelve y no cruza organizaciones', async () => {
      const secreto = 'clave-sintetica-registro-0042';
      const lista0 = await http().get(`${org()}/satellite/credentials`).set(as(ADMIN)).expect(200);
      expect(lista0.body.providers.map((p: { provider_code: string }) => p.provider_code)).toEqual(expect.arrayContaining(['WHISP']));
      expect(lista0.body.providers.map((p: { provider_code: string }) => p.provider_code)).not.toContain('FIXTURE_SYNTHETIC');
      await h.db.deleteFrom('satellite_credentials').where('organization_id', '=', orgA).where('provider_code', '=', 'WHISP').execute();
      const put = await http().put(`${org()}/satellite/credentials/WHISP`).set(as(ADMIN)).send({ secret: secreto }).expect(200);
      expect(put.body.providers.find((p: { provider_code: string }) => p.provider_code === 'WHISP')).toMatchObject({ configured: true });
      expect(JSON.stringify(put.body)).not.toContain(secreto);
      const fila = await h.db.selectFrom('satellite_credentials').selectAll().where('organization_id', '=', orgA).where('provider_code', '=', 'WHISP').executeTakeFirstOrThrow();
      expect(fila.secret_ciphertext).not.toContain(secreto);
      const cipher = new PiiCipher(h.config.pii);
      expect(cipher.decrypt(fila.secret_ciphertext, `satellite_credentials:${orgA}:WHISP`)).toBe(secreto);
      expect(() => cipher.decrypt(fila.secret_ciphertext, `satellite_credentials:${orgB}:WHISP`)).toThrow();   // otra organización no la descifra
      // Rotarla conserva una sola fila y marca la rotación.
      await http().put(`${org()}/satellite/credentials/WHISP`).set(as(ADMIN)).send({ secret: 'otra-clave-sintetica-0043' }).expect(200);
      expect((await h.db.selectFrom('satellite_credentials').select('rotated_at').where('organization_id', '=', orgA).execute())[0].rotated_at).not.toBeNull();
      // Auditoría sin el valor.
      const aud = await h.db.selectFrom('audit_logs').selectAll().where('organization_id', '=', orgA).where('entity_type', '=', 'satellite_credential').execute();
      expect(aud.map((x) => x.action)).toEqual(expect.arrayContaining(['satellite.credential_registered', 'satellite.credential_rotated']));
      expect(JSON.stringify(aud)).not.toContain('clave-sintetica');
      // Permisos y límites.
      await http().put(`${org()}/satellite/credentials/WHISP`).set(as('auditor@test.local')).send({ secret: secreto }).expect(403);
      await http().put(`${org()}/satellite/credentials/WHISP`).set(as('calidad@test.local')).send({ secret: secreto }).expect(403);
      await http().put(`${org()}/satellite/credentials/WHISP`).set(as('admin-b@test.local')).send({ secret: secreto }).expect(404);   // otra organización no existe aquí
      await http().put(`${org()}/satellite/credentials/FIXTURE_SYNTHETIC`).set(as(ADMIN)).send({ secret: secreto }).expect(422);
      await http().put(`${org()}/satellite/credentials/NO_EXISTE`).set(as(ADMIN)).send({ secret: secreto }).expect(404);
      await http().put(`${org()}/satellite/credentials/WHISP`).set(as(ADMIN)).send({ secret: 'corta' }).expect(400);
      const del = await http().delete(`${org()}/satellite/credentials/WHISP`).set(as(ADMIN)).expect(200);
      expect(del.body.providers.find((p: { provider_code: string }) => p.provider_code === 'WHISP')).toMatchObject({ configured: false });
    });

    // ------------------------------------------------------------ AJ-07: envío incierto, reserva, original inmutable y descarga autorizada
    it('envío incierto: si se perdió la respuesta del POST no se reenvía ni se reintenta; termina con un error explícito', async () => {
      const { id, srv } = await correr((r, res) => {
        if (r.url === '/api/config') return json(res, 200, CONFIG);
        res.socket?.destroy();
      }, {}, { maxAttempts: 4 });
      expect(await jobRow(id)).toMatchObject({ status: 'FAILED', outcome: 'PROVIDER_ERROR', last_error_code: 'PROVIDER_SUBMIT_UNCERTAIN' });
      expect(srv.recibidas.filter((x) => x.url === '/api/submit/geojson')).toHaveLength(1);
      expect((await h.db.selectFrom('satellite_results').select('id').where('job_id', '=', id).execute())).toHaveLength(0);
    });

    it('un trabajo cuyo envío quedó sin respuesta y sin identificador (p. ej. reinicio del corredor) NO se vuelve a enviar', async () => {
      const { id, srv } = await correr((r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 500, { code: 'no_deberia_llamarse' })),
        { provider_submit_started_at: new Date(Date.now() - 60_000) });
      expect(await jobRow(id)).toMatchObject({ status: 'FAILED', last_error_code: 'PROVIDER_SUBMIT_UNCERTAIN' });
      expect(srv.recibidas).toHaveLength(0);   // ni siquiera se consultó: no salió nada
    });

    it('un HTTP de error al enviar NO deja el envío incierto: el reintento sí puede enviar de nuevo', async () => {
      let n = 0;
      const { id } = await correr((r, res) => {
        if (r.url === '/api/config') return json(res, 200, CONFIG);
        if (r.url === '/api/submit/geojson') return ++n === 1 ? json(res, 503, { code: 'x' }) : json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'tk-ok' } });
        if (r.url === '/api/status/tk-ok') return json(res, 200, completo);
        return json(res, 404, { code: 'x' });
      }, {}, { maxAttempts: 1 });
      // Primer intento: 503 conocido → FAILED (maxAttempts 1). Con reintentos disponibles volvería a REQUESTED sin quedar «incierto».
      const row = await jobRow(id);
      expect(row.provider_submit_started_at).toBeNull();
      expect(row).toMatchObject({ status: 'FAILED', outcome: 'PROVIDER_ERROR' });
    });

    it('la reserva se toma de a un trabajo: el que espera detrás de otro sigue sin reservar mientras el primero se procesa', async () => {
      const a = await trabajo();
      const b = await trabajo();
      const visto: Array<{ id: string; lease: string | null }> = [];
      const espia = { code: 'WHISP', kind: 'EXTERNAL_HTTP' as const,
        analyze: async () => {
          const otros = await h.db.selectFrom('satellite_jobs').select(['id', 'lease_token']).where('id', 'in', [a.id, b.id]).where('status', '=', 'REQUESTED').execute();
          visto.push(...otros.map((o) => ({ id: o.id, lease: o.lease_token })));
          return { kind: 'NO_COVERAGE' as const, errorCode: 'ESPIA', note: 'x' };
        } };
      await sql`UPDATE satellite_jobs SET status = 'CANCELLED', outcome = 'CANCELLED', finished_at = now() WHERE status = 'REQUESTED' AND id NOT IN (${a.id}, ${b.id})`.execute(h.db);
      const r = await new SatelliteRunner(h.db, [espia], { cipher: a.cipher }, { maxAttempts: 1, backoffBaseMs: 1, batchSize: 5 }).runOnce();
      expect(r.claimed).toBe(2);
      // Durante el primer análisis, el otro trabajo seguía REQUESTED y sin arrendamiento.
      expect(visto.length).toBeGreaterThan(0);
      expect(visto.every((v) => v.lease === null)).toBe(true);
    });

    it('un corredor atrasado no altera los bytes de un resultado ya confirmado: cada cierre escribe su propio objeto y el resultado cita el del cierre autorizado', async () => {
      const { id, cipher } = await trabajo();
      const objetos = new Map<string, Buffer>();
      const store = { put: async (k: string, b: Buffer) => { objetos.set(k, b); }, get: async (k: string) => objetos.get(k)!, exists: async (k: string) => objetos.has(k), delete: async () => undefined, list: async () => [] } as never;
      let llamada = 0;
      const espia = { code: 'WHISP', kind: 'EXTERNAL_HTTP' as const,
        analyze: async () => {
          llamada++;
          if (llamada === 1) {
            // El corredor A pierde su reserva (otro la toma) y aun así termina y devuelve su resultado, tarde.
            await sql`UPDATE satellite_jobs SET lease_token = gen_random_uuid(), locked_until = now() - interval '1 second' WHERE id = ${id}`.execute(h.db);
          }
          return { kind: 'RESULT' as const, result: { dataset: null, datasetVersion: null, analysisDate: null, resolutionM: null, method: 'espia', coverageStatus: 'UNKNOWN' as const, coverageNote: 'cobertura no declarada por el espía', confidence: null, limitations: 'Resultado sintético de un espía de prueba.', indicators: { corredor: llamada }, raw: Buffer.from(`{"corredor":${llamada}}`) } };
        } };
      await new SatelliteRunner(h.db, [espia], { cipher, store }, { maxAttempts: 1, backoffBaseMs: 1 }).runOnce();   // A: pierde la reserva → no cierra
      expect(await jobRow(id)).toMatchObject({ status: 'RUNNING' });
      const claveA = [...objetos.keys()][0];
      await new SatelliteRunner(h.db, [espia], { cipher, store }, { maxAttempts: 1, backoffBaseMs: 1 }).runOnce();   // B: retoma y cierra
      const res = await h.db.selectFrom('satellite_results').select(['raw_object_key', 'raw_sha256']).where('job_id', '=', id).executeTakeFirstOrThrow();
      expect(res.raw_object_key).not.toBe(claveA);
      expect(objetos.get(claveA)!.toString()).toBe('{"corredor":1}');           // los bytes del atrasado no se tocaron
      expect(objetos.get(res.raw_object_key!)!.toString()).toBe('{"corredor":2}');
      const { createHash } = await import('crypto');
      expect(createHash('sha256').update(objetos.get(res.raw_object_key!)!).digest('hex')).toBe(res.raw_sha256);
    });

    it('la respuesta original se descarga solo con acceso a coordenadas, con su huella verificada, auditada y sin cruzar organizaciones', async () => {
      const { S3ObjectStore } = await import('../src/storage/object-store');
      const real = new S3ObjectStore(h.config.objectStore);
      const { id } = await correr((r, res) => {
        if (r.url === '/api/config') return json(res, 200, CONFIG);
        if (r.url === '/api/submit/geojson') return json(res, 200, completo);
        return json(res, 404, { code: 'x' });
      }, {}, { store: real });
      const ok = await http().get(`${org()}/satellite/analyses/${id}/original`).set(as(ADMIN)).expect(200);
      expect(ok.headers['x-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
      expect(ok.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(ok.body)).toContain('risk_pcrop');
      const vista = await http().get(`${org()}/satellite/analyses/${id}`).set(as(ADMIN)).expect(200);
      expect(vista.body.result.raw_evidence).toMatchObject({ stored: true, can_download: true, sha256: ok.headers['x-content-sha256'] });
      const aud = await h.db.selectFrom('audit_logs').select('action').where('organization_id', '=', orgA).where('entity_id', '=', id).where('action', '=', 'satellite.original_download').execute();
      expect(aud.length).toBeGreaterThan(0);
      await http().get(`/api/v1/organizations/${orgB}/satellite/analyses/${id}/original`).set(as('admin-b@test.local')).expect(404);   // otra organización
      await http().get(`${org()}/satellite/analyses/${id}/original`).set(as('calidad@test.local')).expect(403);                    // sin satellite:read
      // Una huella que no coincide NO se entrega (se altera el objeto y luego se restaura).
      const fila = await h.db.selectFrom('satellite_results').select('raw_object_key').where('job_id', '=', id).executeTakeFirstOrThrow();
      const original = await real.get(fila.raw_object_key!);
      await real.put(fila.raw_object_key!, Buffer.from('{"alterado":true}'), 'application/json');
      try {
        const mal = await http().get(`${org()}/satellite/analyses/${id}/original`).set(as(ADMIN)).expect(500);
        expect(mal.body.error.code).toBe('ORIGINAL_INTEGRITY_FAILED');
      } finally {
        await real.put(fila.raw_object_key!, original, 'application/json');
      }
    });

    // ------------------------------------------------------------ AJ-07b: el identificador y el fin de la incertidumbre son una sola escritura
    it('si falla la escritura del identificador, el reintento NO reenvía: queda incierto aunque el proveedor aceptó', async () => {
      await sql`CREATE OR REPLACE FUNCTION tl_test_sin_ref() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.provider_job_ref IS NOT NULL AND OLD.provider_job_ref IS NULL THEN RAISE EXCEPTION 'fallo simulado al guardar el identificador'; END IF; RETURN NEW; END $$`.execute(h.db);
      await sql`CREATE TRIGGER tl_test_sin_ref BEFORE UPDATE ON satellite_jobs FOR EACH ROW EXECUTE FUNCTION tl_test_sin_ref()`.execute(h.db);
      try {
        const { id, srv } = await correr((r, res) => {
          if (r.url === '/api/config') return json(res, 200, CONFIG);
          if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'tk-perdido' } });
          return json(res, 202, { code: 'analysis_processing', message: 'p', data: { token: 'tk-perdido' } });
        }, {}, { maxAttempts: 4 });
        // El primer intento terminó con el trabajo aceptado por el proveedor y sin identificador guardado; se fuerza un segundo pasaje del corredor.
        await sql`UPDATE satellite_jobs SET next_attempt_at = now() WHERE id = ${id} AND status = 'REQUESTED'`.execute(h.db);
        const row1 = await jobRow(id);
        expect(row1.provider_job_ref).toBeNull();
        expect(row1.provider_submit_started_at).not.toBeNull();            // la marca se conserva
        expect(srv.recibidas.filter((x) => x.url === '/api/submit/geojson')).toHaveLength(1);
        const cipher = new PiiCipher(h.config.pii);
        const whisp = new WhispSatelliteProvider({ liveCalls: true, baseUrl: `https://destino.prueba.local:${srv.port}`, ca: tls.ca, lookup: loopbackLookup, timeoutMs: 4000, pollMs: 1, maxPolls: 3, sleep: async () => undefined } as never);
        await new SatelliteRunner(h.db, [whisp], { cipher, store: almacen }, { maxAttempts: 4, backoffBaseMs: 1 }).runOnce();
        const row2 = await jobRow(id);
        expect(srv.recibidas.filter((x) => x.url === '/api/submit/geojson')).toHaveLength(1);   // NO hubo un segundo envío
        expect(row2).toMatchObject({ status: 'FAILED', last_error_code: 'PROVIDER_SUBMIT_UNCERTAIN' });
      } finally {
        await sql`DROP TRIGGER IF EXISTS tl_test_sin_ref ON satellite_jobs`.execute(h.db);
        await sql`DROP FUNCTION IF EXISTS tl_test_sin_ref()`.execute(h.db);
      }
    });

    it('un corredor que perdió su reserva antes de enviar no envía nada', async () => {
      const t = await trabajo();
      const srv2 = await tls.listen((r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'no-debe' } })));
      const previo = await h.db.selectFrom('satellite_providers').select('allowed_hosts').where('code', '=', 'WHISP').executeTakeFirstOrThrow();
      await sql`UPDATE satellite_providers SET allowed_hosts = ${[`destino.prueba.local:${srv2.port}`]} WHERE code = 'WHISP'`.execute(h.db);
      try {
        const whisp = new WhispSatelliteProvider({ liveCalls: true, baseUrl: `https://destino.prueba.local:${srv2.port}`, ca: tls.ca, lookup: loopbackLookup, timeoutMs: 4000, pollMs: 1, maxPolls: 3, sleep: async () => undefined } as never);
        // Otro corredor toma la reserva justo después de la consulta de límites y antes del envío.
        const robado = { ...whisp, code: 'WHISP', kind: 'EXTERNAL_HTTP' as const,
          analyze: async (rq: Parameters<typeof whisp.analyze>[0]) => {
            await sql`UPDATE satellite_jobs SET lease_token = gen_random_uuid() WHERE id = ${t.id}`.execute(h.db);
            return await whisp.analyze(rq);
          } };
        await new SatelliteRunner(h.db, [robado as never], { cipher: t.cipher, store: almacen }, { maxAttempts: 1, backoffBaseMs: 1 }).runOnce();
        expect(srv2.recibidas.filter((x) => x.url === '/api/submit/geojson')).toHaveLength(0);
      } finally {
        await sql`UPDATE satellite_providers SET allowed_hosts = ${previo.allowed_hosts} WHERE code = 'WHISP'`.execute(h.db);
      }
    });
  });
});
