import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// D-05.A — Perfil técnico de intercambio `EUDR_GEO_V1`, contra PostGIS real.
//
// Lo que estas pruebas acreditan: que el perfil separa lo que debe separar (dictamen técnico vs. perfil de
// destino, superficie declarada vs. calculada, valor numérico vs. formato de intercambio) y que los casos que
// no puede decidir quedan con su motivo en vez de colarse como aceptados.
//
// Lo que NO acreditan: nada sobre el servicio real del destino, ni sobre conformidad jurídica (D-05.B).
describeDb('D-05.A perfil técnico EUDR_GEO_V1 (PostGIS real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let producer: string;
  const ADMIN = 'admin-a@test.local';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const org = () => `/api/v1/organizations/${orgA}`;

  const ring = (pts: number[][]) => [...pts, pts[0]];
  /** Cuadrado de lado `d` grados con esquina inferior izquierda en (x, y). En Ecuador, lon y lat negativas. */
  const sq = (x: number, y: number, d: number) => ({ type: 'Polygon', coordinates: [ring([[x, y], [x + d, y], [x + d, y + d], [x, y + d]])] });
  const point = (x: number, y: number) => ({ type: 'Point', coordinates: [x, y] });

  type Chk = { code: string; outcome: string; reason_code: string | null; message: string; details?: Record<string, unknown> };
  interface Evaluation { status: string; exportable: boolean; checks: Chk[]; area: { basis: string; value_ha: string | null }; source: Record<string, unknown>; profile: Record<string, unknown> }
  const chk = (ev: Evaluation, code: string) => ev.checks.find((c) => c.code === code)!;

  async function mkPlot(code: string, geometry?: unknown, areaDeclared?: number) {
    const id = (await http().post(`${org()}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: code, crop: 'Cacao' }).expect(201)).body.id;
    const body: Record<string, unknown> = { expected_version: 1, survey_method: geometry ? 'MANUAL_COORDINATES' : 'DECLARED' };
    if (geometry) body.geometry = geometry;
    if (areaDeclared !== undefined) body.area_declared_ha = areaDeclared;
    await http().post(`${org()}/plots/${id}/geometry-versions`).set(as(ADMIN)).send(body).expect(201);
    return id;
  }
  const evaluate = async (plot: string, actor = ADMIN, expect = 201) =>
    (await http().post(`${org()}/plots/${plot}/geo-profile/evaluations`).set(as(actor)).send({ operation_id: randomUUID() }).expect(expect)).body.evaluation as Evaluation;

  /**
   * Añade una VERSIÓN nueva con una geometría concreta y, si se pide, una superficie calculada fijada. Se usa
   * para casos que la captura normal no produce (huecos, autointersección) o que exigen una cifra exacta en el
   * umbral. `plot_versions` es append-only: se INSERTA otra versión, nunca se modifica la anterior.
   */
  async function addVersion(plotId: string, opts: { wkt?: string; declared?: string | null; calculated?: string | null }) {
    const prev = await h.db.selectFrom('plots').select(['current_version_id', 'organization_id']).where('id', '=', plotId).executeTakeFirstOrThrow();
    const base = await h.db.selectFrom('plot_versions').select(['version_number', 'created_by', 'area_declared_ha'])
      .where('id', '=', prev.current_version_id!).executeTakeFirstOrThrow();
    const id = randomUUID();
    const declared = opts.declared === undefined ? base.area_declared_ha : opts.declared;
    await sql`
      WITH g AS (SELECT ST_GeomFromText(${opts.wkt ?? null}::text, 4326) AS geom)
      INSERT INTO plot_versions (id, organization_id, plot_id, version_number, geometry, geometry_type, geometry_hash,
        area_declared_ha, area_calculated_ha, survey_method, validation_status, validation_rule_version, previous_version_id, created_by)
      SELECT ${id}, ${prev.organization_id}, ${plotId}, ${Number(base.version_number) + 1}, g.geom,
        CASE WHEN g.geom IS NULL THEN NULL ELSE upper(GeometryType(g.geom)) END,
        CASE WHEN g.geom IS NULL THEN NULL ELSE encode(sha256(ST_AsBinary(g.geom)), 'hex') END,
        ${declared}::numeric,
        CASE WHEN ${opts.calculated ?? null}::text IS NOT NULL THEN ${opts.calculated ?? null}::numeric
             WHEN GeometryType(g.geom) IN ('POLYGON','MULTIPOLYGON') AND (ST_IsValidDetail(g.geom)).valid AND ST_Area(g.geom) > 0
             THEN round((ST_Area(g.geom::geography) / 10000)::numeric, 6) END,
        'MANUAL_COORDINATES', 'NOT_VALIDATED', 'TEST', ${prev.current_version_id}, ${base.created_by}
      FROM g`.execute(h.db);
    await sql`UPDATE plots SET current_version_id = ${id}, row_version = row_version + 1 WHERE id = ${plotId}`.execute(h.db);
    return id;
  }

  /** Versión nueva con la MISMA geometría vigente y la superficie calculada que pide el caso. */
  async function setSameGeometryWithArea(plotId: string, opts: { calculated?: string | null; declared?: string | null }) {
    const prev = await h.db.selectFrom('plots').select('current_version_id').where('id', '=', plotId).executeTakeFirstOrThrow();
    const wkt = (await sql<{ w: string | null }>`SELECT ST_AsText(geometry) AS w FROM plot_versions WHERE id = ${prev.current_version_id}`.execute(h.db)).rows[0].w;
    return addVersion(plotId, { wkt: wkt ?? undefined, ...opts });
  }

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Perfil A', ADMIN);
    orgB = await mk('Coop Perfil B', 'admin-b@test.local');
    const inv = await http().post(`${org()}/invitations`).set(as(ADMIN)).send({ email: 'auditor-perfil@test.local', role_code: 'AUDITOR' }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'A', last_name: 'Auditor', password: PASSWORD }).expect(200);
    await h.login('auditor-perfil@test.local');
    producer = (await http().post(`${org()}/producers`).set(as(ADMIN)).send({ producer_code: 'PERF-1', legal_name: 'Finca Perfil' }).expect(201)).body.id;
  }, 120_000);
  afterAll(async () => { await h?.close(); });

  // ---------------------------------------------------------------- separación de dictámenes

  it('el perfil es una regla aparte: no toca la evaluación técnica ni sus registros', async () => {
    const plot = await mkPlot('SEP-1', sq(-79.5, -1.0, 0.01));
    const tecnica = (await http().post(`${org()}/plots/${plot}/gis-evaluations`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201)).body.evaluation;
    expect(tecnica.rule.id).toBe('TL_GIS_TECH');
    // La evaluación técnica sigue diciendo que el perfil de destino no es asunto suyo.
    expect(tecnica.destination_profile.status).toBe('NOT_EVALUATED');

    const antes = await h.db.selectFrom('gis_evaluations').selectAll().where('plot_id', '=', plot).execute();
    const perfil = await evaluate(plot);
    const despues = await h.db.selectFrom('gis_evaluations').selectAll().where('plot_id', '=', plot).execute();
    expect(despues).toEqual(antes); // ni una fila técnica tocada

    expect(perfil.profile).toMatchObject({ id: 'EUDR_GEO_V1', version: '1.0.0', status: 'PROVISIONAL_LOCAL_DEVELOPMENT' });
    // Los tres identificadores de la fuente, por separado: servicio, documento y fecha de página.
    expect(perfil.source).toMatchObject({ service_version: 'V3', document_version: '1.2', page_date: '2026-08-17' });
    // Y la honestidad sobre el grado de comprobación: documentado, no probado contra el servicio.
    expect(perfil.source.verification).toBe('DOCUMENTED_NOT_TESTED_AGAINST_SERVICE');
  });

  it('cumplir el perfil NO se presenta como conformidad', async () => {
    const plot = await mkPlot('SEP-2', sq(-79.4, -1.0, 0.01));
    const ev = await evaluate(plot);
    expect(ev.status).toBe('MEETS_PROFILE');
    const texto = JSON.stringify(ev);
    expect(texto).toMatch(/NO es conformidad EUDR/i);
    expect(texto).not.toMatch(/conforme EUDR\b(?!.*NO)/i);
  });

  it('la evaluación es append-only e idempotente por operation_id', async () => {
    const plot = await mkPlot('SEP-3', sq(-79.3, -1.0, 0.01));
    const op = randomUUID();
    const a = await http().post(`${org()}/plots/${plot}/geo-profile/evaluations`).set(as(ADMIN)).send({ operation_id: op }).expect(201);
    const b = await http().post(`${org()}/plots/${plot}/geo-profile/evaluations`).set(as(ADMIN)).send({ operation_id: op }).expect(201);
    expect(b.body.replayed).toBe(true);
    expect(b.body.evaluation.id).toBe(a.body.evaluation.id);
    await expect(sql`UPDATE geo_profile_evaluations SET status = 'MEETS_PROFILE' WHERE id = ${a.body.evaluation.id}`.execute(h.db))
      .rejects.toThrow(/append-only/i);
    await expect(sql`DELETE FROM geo_profile_evaluations WHERE id = ${a.body.evaluation.id}`.execute(h.db))
      .rejects.toThrow(/append-only/i);
  });

  // ---------------------------------------------------------------- umbral

  it('umbral estricto: debajo, exactamente en, y por encima', async () => {
    const debajo = await mkPlot('UMB-1', sq(-79.2, -1.0, 0.01));
    await setSameGeometryWithArea(debajo, { calculated: '3.999900' });
    expect(chk(await evaluate(debajo), 'THRESHOLD').reason_code).toBe('BELOW_THRESHOLD');

    const igual = await mkPlot('UMB-2', sq(-79.1, -1.0, 0.01));
    await setSameGeometryWithArea(igual, { calculated: '4.000000' });
    const ev = await evaluate(igual);
    // Exactamente 4 ha NO supera el umbral: se admite. Es un aviso de borde, no una tolerancia.
    expect(chk(ev, 'THRESHOLD')).toMatchObject({ outcome: 'PASS', reason_code: 'AT_THRESHOLD' });
    expect(chk(ev, 'THRESHOLD').details).toMatchObject({ at_threshold: true });
    expect(ev.status).toBe('MEETS_PROFILE');

    const encima = await mkPlot('UMB-3', sq(-79.0, -1.0, 0.01));
    await setSameGeometryWithArea(encima, { calculated: '4.000100' });
    // Un POLÍGONO por encima del umbral está bien: lo que el umbral exige es polígono, y lo es.
    expect(chk(await evaluate(encima), 'THRESHOLD').reason_code).toBe('ABOVE_THRESHOLD_WITH_POLYGON');
  });

  it('un punto por encima del umbral exige polígono; exactamente en el umbral se admite', async () => {
    const grande = await mkPlot('PT-1', point(-79.5, -1.5), 4.0001);
    const ev = await evaluate(grande);
    expect(chk(ev, 'THRESHOLD')).toMatchObject({ outcome: 'FAIL', reason_code: 'POLYGON_REQUIRED_ABOVE_THRESHOLD' });
    expect(ev.status).toBe('DOES_NOT_MEET');
    expect(ev.exportable).toBe(false);

    const justo = await mkPlot('PT-2', point(-79.6, -1.5), 4);
    const ok = await evaluate(justo);
    expect(chk(ok, 'THRESHOLD').reason_code).toBe('AT_THRESHOLD');
    expect(ok.status).toBe('MEETS_PROFILE');
    // Para un punto la referencia es la DECLARADA: un punto no tiene superficie calculada.
    expect(ok.area).toMatchObject({ basis: 'DECLARED' });
  });

  it('punto sin superficie: no evaluable y NO exportable, para que el destino no asuma 4 ha', async () => {
    const plot = await mkPlot('PT-3', point(-79.7, -1.5));
    const ev = await evaluate(plot);
    // Falta el dato, no falla la regla: NOT_EVALUABLE, no DOES_NOT_MEET. Decir que «no cumple» afirmaría que se
    // comprobó; lo cierto es que no se pudo comprobar.
    expect(chk(ev, 'AREA_BASIS')).toMatchObject({ outcome: 'NOT_EXECUTED', reason_code: 'AREA_UNKNOWN_FOR_POINT' });
    expect(chk(ev, 'THRESHOLD').outcome).toBe('NOT_EXECUTED');
    expect(ev.status).toBe('NOT_EVALUABLE');
    expect(ev.exportable).toBe(false);
    expect(chk(ev, 'AREA_BASIS').message).toMatch(/asumir[ií]a 4 ha|4 ha por defecto/i);
  });

  it('declarada y calculada son cifras distintas: si cruzan el umbral, decide una persona', async () => {
    const plot = await mkPlot('DISC-1', sq(-79.8, -1.5, 0.01), 3.8);
    await setSameGeometryWithArea(plot, { calculated: '4.200000' });
    const ev = await evaluate(plot);
    expect(chk(ev, 'AREA_DISCREPANCY')).toMatchObject({ outcome: 'REVIEW', reason_code: 'AREA_DISCREPANCY_CROSSES_THRESHOLD' });
    expect(ev.status).toBe('REVIEW_REQUIRED');
    expect(ev.exportable).toBe(false);
    // La referencia del umbral sigue siendo la calculada; no se elige la favorable.
    expect(ev.area).toMatchObject({ basis: 'CALCULATED', value_ha: '4.200000' });

    const mismoLado = await mkPlot('DISC-2', sq(-79.9, -1.5, 0.01), 3.5);
    await setSameGeometryWithArea(mismoLado, { calculated: '3.900000' });
    expect(chk(await evaluate(mismoLado), 'AREA_DISCREPANCY').reason_code).toBe('AREA_DISCREPANCY_NONE');
  });

  // ---------------------------------------------------------------- geometría

  it('un polígono con hueco es técnicamente válido y NO cumple el perfil: dos dictámenes que discrepan', async () => {
    const plot = await mkPlot('HOLE-1', sq(-78.5, -1.0, 0.1));
    await addVersion(plot, { wkt: 'POLYGON((-78.5 -1.0, -78.4 -1.0, -78.4 -0.9, -78.5 -0.9, -78.5 -1.0),(-78.48 -0.98, -78.44 -0.98, -78.44 -0.94, -78.48 -0.94, -78.48 -0.98))' });
    const tecnica = (await http().post(`${org()}/plots/${plot}/gis-evaluations`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201)).body.evaluation;
    expect(tecnica.status).toBe('VALID'); // OGC: un hueco bien formado es válido

    const perfil = await evaluate(plot);
    expect(chk(perfil, 'TECHNICAL_VALIDITY').outcome).toBe('PASS');
    expect(chk(perfil, 'NO_HOLES')).toMatchObject({ outcome: 'FAIL', reason_code: 'HOLES_PRESENT' });
    expect(perfil.status).toBe('DOES_NOT_MEET');
    // Y el truncamiento no se ejecuta sobre un caso que ya no se exporta: queda dicho, no silenciado.
    expect(chk(perfil, 'INTERCHANGE_PRECISION')).toMatchObject({ outcome: 'NOT_EXECUTED', reason_code: 'HOLES_PRESENT' });
  });

  it('una geometría inválida no se evalúa ni se repara', async () => {
    const plot = await mkPlot('INV-1', sq(-78.4, -1.0, 0.01));
    // Autointersección con superficie no nula: el fallo es la invalidez, no la degeneración.
    await addVersion(plot, { wkt: 'POLYGON((-78.4 -1.0, -78.2 -1.0, -78.2 -0.9, -78.35 -0.9, -78.35 -0.95, -78.3 -0.95, -78.3 -1.05, -78.4 -1.05, -78.4 -1.0))' });
    const antes = await h.db.selectFrom('plot_versions').select(['geometry_hash']).where('plot_id', '=', plot).execute();
    const ev = await evaluate(plot);
    expect(chk(ev, 'TECHNICAL_VALIDITY')).toMatchObject({ outcome: 'FAIL', reason_code: 'GEOMETRY_INVALID' });
    expect(ev.status).toBe('DOES_NOT_MEET');
    const despues = await h.db.selectFrom('plot_versions').select(['geometry_hash']).where('plot_id', '=', plot).execute();
    expect(despues).toEqual(antes); // la geometría no se tocó
  });

  it('MultiPolygon sin huecos cumple el perfil', async () => {
    const plot = await mkPlot('MP-1', sq(-78.3, -1.0, 0.01));
    await addVersion(plot, { wkt: 'MULTIPOLYGON(((-78.3 -1.0, -78.29 -1.0, -78.29 -0.99, -78.3 -0.99, -78.3 -1.0)),((-78.2 -1.0, -78.19 -1.0, -78.19 -0.99, -78.2 -0.99, -78.2 -1.0)))' });
    const ev = await evaluate(plot);
    expect(chk(ev, 'GEOMETRY_TYPE').outcome).toBe('PASS');
    expect(chk(ev, 'NO_HOLES').outcome).toBe('PASS');
    expect(ev.status).toBe('MEETS_PROFILE');
  });

  it('sin geometría no hay nada que preparar: no evaluable, con su motivo', async () => {
    const plot = await mkPlot('SG-1', undefined, 2.5);
    const ev = await evaluate(plot);
    expect(chk(ev, 'GEOMETRY_PRESENT')).toMatchObject({ outcome: 'FAIL', reason_code: 'GEOMETRY_MISSING' });
    expect(ev.status).toBe('NOT_EVALUABLE');
    expect(ev.exportable).toBe(false);
    expect(ev.area.basis).toBe('NONE');
  });

  // ---------------------------------------------------------------- truncamiento

  it('truncamiento hacia cero con coordenadas negativas: el caso normal en Ecuador', async () => {
    // Las dos longitudes difieren en el décimo decimal; truncadas a 6 son la MISMA.
    const plot = await mkPlot('TRU-1', sq(-78.1, -1.0, 0.01));
    await addVersion(plot, { wkt: 'POLYGON((-78.1234561234 -1.0000001234, -78.1234569876 -1.0000009876, -78.11 -0.99, -78.12 -0.99, -78.1234561234 -1.0000001234))' });
    const ev = await evaluate(plot);
    const c = chk(ev, 'INTERCHANGE_PRECISION');
    expect(c).toMatchObject({ outcome: 'FAIL', reason_code: 'VERTEX_COLLAPSE_ON_TRUNCATION' });
    expect(c.details).toMatchObject({ decimals: 6, mode: 'TOWARD_ZERO', duplicates_before: 0 });
    expect(ev.status).toBe('DOES_NOT_MEET');
    // El mensaje separa el colapso del cierre del anillo, que es obligatorio.
    expect(c.message).toMatch(/no es el cierre del anillo/i);
  });

  it('el truncamiento se comprueba en decimal exacto y hacia cero, no redondeando', async () => {
    // trunc(-1.0000009, 6) = -1.000000 (hacia cero). Redondeando daría -1.000001 y no colapsaría.
    const r = await sql<{ t: string; redondeo: string }>`SELECT trunc((-1.0000009)::numeric, 6)::text AS t, round((-1.0000009)::numeric, 6)::text AS redondeo`.execute(h.db);
    expect(r.rows[0].t).toBe('-1.000000');
    expect(r.rows[0].redondeo).toBe('-1.000001');
  });

  it('el cierre del anillo NO cuenta como vértice duplicado', async () => {
    // Un cuadrado bien cerrado repite la primera posición al final: es obligatorio y debe pasar limpio.
    const plot = await mkPlot('TRU-2', sq(-78.0, -1.0, 0.01));
    const ev = await evaluate(plot);
    const c = chk(ev, 'INTERCHANGE_PRECISION');
    expect(c).toMatchObject({ outcome: 'PASS', reason_code: 'TRUNCATION_SAFE' });
    expect(c.details).toMatchObject({ duplicates_before: 0, duplicates_after: 0 });
    expect(ev.status).toBe('MEETS_PROFILE');
  });

  it('una geometría cuyos valores ya están a 6 decimales no cambia al truncar', async () => {
    const plot = await mkPlot('TRU-3', sq(-77.9, -1.0, 0.01));
    await addVersion(plot, { wkt: 'POLYGON((-77.900000 -1.000000, -77.890000 -1.000000, -77.890000 -0.990000, -77.900000 -0.990000, -77.900000 -1.000000))' });
    expect(chk(await evaluate(plot), 'INTERCHANGE_PRECISION').reason_code).toBe('TRUNCATION_SAFE');
  });

  it('los ceros finales no cambian el valor ni el resultado: -79.5 y -79.500000 son lo mismo', async () => {
    const a = await mkPlot('DEC-1', sq(-79.5, -2.0, 0.01));
    const b = await mkPlot('DEC-2', sq(-79.5, -2.0, 0.01));
    await addVersion(b, { wkt: 'POLYGON((-79.500000 -2.000000, -79.490000 -2.000000, -79.490000 -1.990000, -79.500000 -1.990000, -79.500000 -2.000000))' });
    const ea = await evaluate(a); const eb = await evaluate(b);
    expect(chk(ea, 'INTERCHANGE_PRECISION').reason_code).toBe(chk(eb, 'INTERCHANGE_PRECISION').reason_code);
    expect(ea.status).toBe(eb.status);
    // Y el contrato de decimales dice, por escrito, que seis decimales no son precisión física.
    expect(JSON.stringify(eb)).toMatch(/NO son prueba de precisi[óo]n f[ií]sica/i);
  });

  // ---------------------------------------------------------------- permisos y aislamiento

  it('sin permiso de evaluación no se evalúa; sin lectura no se consulta', async () => {
    const plot = await mkPlot('PERM-1', sq(-77.8, -1.0, 0.01));
    await http().post(`${org()}/plots/${plot}/geo-profile/evaluations`).set(as('auditor-perfil@test.local')).send({ operation_id: randomUUID() }).expect(403);
    // El lector sí puede consultar el historial: leer no es evaluar.
    await http().get(`${org()}/plots/${plot}/geo-profile/evaluations`).set(as('auditor-perfil@test.local')).expect(200);
  });

  it('otra organización no evalúa ni lee el perfil de una parcela ajena', async () => {
    const plot = await mkPlot('ISO-1', sq(-77.7, -1.0, 0.01));
    await evaluate(plot);
    await http().post(`/api/v1/organizations/${orgB}/plots/${plot}/geo-profile/evaluations`).set(as('admin-b@test.local')).send({ operation_id: randomUUID() }).expect(404);
    await http().get(`/api/v1/organizations/${orgB}/plots/${plot}/geo-profile/evaluations`).set(as('admin-b@test.local')).expect(404);
  });

  it('el historial conserva todas las evaluaciones, la más reciente primero', async () => {
    const plot = await mkPlot('HIST-1', sq(-77.6, -1.0, 0.01));
    await evaluate(plot);
    await evaluate(plot);
    const body = (await http().get(`${org()}/plots/${plot}/geo-profile/evaluations`).set(as(ADMIN)).expect(200)).body;
    expect(body.evaluations).toHaveLength(2);
    expect(new Date(body.evaluations[0].evaluated_at).getTime()).toBeGreaterThanOrEqual(new Date(body.evaluations[1].evaluated_at).getTime());
    expect(body.note).toMatch(/append-only/i);
  });

  it('la base impide marcar exportable un resultado que no cumple', async () => {
    const plot = await mkPlot('CHK-1', point(-77.5, -1.0));
    const ev = await evaluate(plot);
    expect(ev.exportable).toBe(false);
    await expect(sql`
      INSERT INTO geo_profile_evaluations (id, organization_id, plot_id, plot_version_id, profile_id, profile_version,
        source_service_version, source_document_version, source_page_date, parameters, status, checks, area_basis, exportable, operation_id, evaluated_by)
      SELECT gen_random_uuid(), organization_id, plot_id, plot_version_id, profile_id, profile_version,
        source_service_version, source_document_version, source_page_date, parameters, 'DOES_NOT_MEET', checks, area_basis, true, gen_random_uuid(), evaluated_by
      FROM geo_profile_evaluations WHERE id = ${ev['id' as keyof Evaluation] as unknown as string}`.execute(h.db))
      .rejects.toThrow(/exportable/i);
  });

  // ---------------------------------------------------------------- exportacion con perfil

  describe('exportacion con perfil, por productor', () => {
    const exportar = (producerId?: string, actor = ADMIN) =>
      http().get(`${org()}/reports/entities/plots/geojson/profile${producerId ? `?producer_id=${producerId}` : ''}`).set(as(actor));

    it('exige productor: es una exportación de nivel de productor', async () => {
      const r = await exportar().expect(400);
      expect(r.body.error.code).toBe('PRODUCER_REQUIRED');
    });

    it('exporta solo lo que cumple el perfil y LISTA lo demás con su motivo', async () => {
      const p2 = (await http().post(`${org()}/producers`).set(as(ADMIN)).send({ producer_code: 'EXP-1', legal_name: 'Finca Export' }).expect(201)).body.id;
      const mk = async (code: string, geometry?: unknown, declared?: number) => {
        const id = (await http().post(`${org()}/plots`).set(as(ADMIN)).send({ producer_id: p2, plot_code: code, crop: 'Cacao' }).expect(201)).body.id;
        const body: Record<string, unknown> = { expected_version: 1, survey_method: geometry ? 'MANUAL_COORDINATES' : 'DECLARED' };
        if (geometry) body.geometry = geometry;
        if (declared !== undefined) body.area_declared_ha = declared;
        await http().post(`${org()}/plots/${id}/geometry-versions`).set(as(ADMIN)).send(body).expect(201);
        return id;
      };
      const bueno = await mk('EXP-OK', sq(-76.5, -1.0, 0.01));
      const punto = await mk('EXP-PT', point(-76.4, -1.0), 2.5);
      const grande = await mk('EXP-BIG', point(-76.3, -1.0), 9);
      const sinEvaluar = await mk('EXP-NOEVAL', sq(-76.2, -1.0, 0.01));
      await evaluate(bueno); await evaluate(punto); await evaluate(grande);

      const r = await exportar(p2).expect(200);
      const fc = JSON.parse(r.text);
      const codes = fc.features.map((f: { properties: { ProductionPlace: string } }) => f.properties.ProductionPlace).sort();
      expect(codes).toEqual(['EXP-OK', 'EXP-PT']);
      expect(fc.terra_link.counts).toMatchObject({ parcelas: 4, exportadas: 2, no_exportables: 2 });

      const motivos = Object.fromEntries((fc.terra_link.not_exported as Array<{ plot_code: string; reason_code: string }>).map((x) => [x.plot_code, x.reason_code]));
      expect(motivos['EXP-BIG']).toBe('DOES_NOT_MEET');
      // No evaluada NO es lo mismo que no cumple, y se dice con un código distinto.
      expect(motivos['EXP-NOEVAL']).toBe('PROFILE_NOT_EVALUATED');
      expect(fc.terra_link.not_exported.find((x: { plot_code: string }) => x.plot_code === 'EXP-NOEVAL').reason).toMatch(/NO evaluada no es lo mismo que no cumple/i);
      void sinEvaluar;

      // `Area` solo acompaña al punto, y va como NÚMERO, no como texto.
      const fpunto = fc.features.find((f: { properties: { ProductionPlace: string } }) => f.properties.ProductionPlace === 'EXP-PT');
      expect(typeof fpunto.properties.Area).toBe('number');
      expect(fpunto.properties.Area).toBe(2.5);
      const fpol = fc.features.find((f: { properties: { ProductionPlace: string } }) => f.properties.ProductionPlace === 'EXP-OK');
      expect(fpol.properties.Area).toBeUndefined();

      // Nada de datos personales, y se declara por qué faltan propiedades opcionales.
      for (const f of fc.features) {
        expect(f.properties.ProducerName).toBeUndefined();
        expect(f.properties.ProducerCountry).toBeUndefined();
      }
      expect(fc.terra_link.producer_name_note).toMatch(/dato personal/i);
      expect(fc.terra_link.producer_country_note).toMatch(/inventar el dato/i);
      // El período de producción no se inventa como propiedad.
      expect(fc.terra_link.production_period_note).toMatch(/Art\. 9\(1\)\(d\)/);
      expect(JSON.stringify(fc.features)).not.toMatch(/production_period|harvest/i);
      // Y el archivo dice que cumplir el perfil no es conformidad.
      expect(fc.terra_link.notice).toMatch(/NO es conformidad EUDR/i);
      expect(fc.terra_link.source).toMatchObject({ service_version: 'V3', document_version: '1.2' });
    });

    it('escribe 6 decimales: formato de intercambio, no precisión de captura', async () => {
      const p3 = (await http().post(`${org()}/producers`).set(as(ADMIN)).send({ producer_code: 'EXP-DEC', legal_name: 'Finca Decimales' }).expect(201)).body.id;
      const id = (await http().post(`${org()}/plots`).set(as(ADMIN)).send({ producer_id: p3, plot_code: 'DEC-EXP', crop: 'Cacao' }).expect(201)).body.id;
      await http().post(`${org()}/plots/${id}/geometry-versions`).set(as(ADMIN))
        .send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: sq(-76.1, -1.0, 0.01) }).expect(201);
      await evaluate(id);
      const fc = JSON.parse((await exportar(p3).expect(200)).text);
      const coords = fc.features[0].geometry.coordinates.flat(2) as number[];
      for (const v of coords) {
        // Son NÚMEROS, no cadenas, y ninguno lleva más de 6 decimales.
        expect(typeof v).toBe('number');
        const dec = String(v).includes('.') ? String(v).split('.')[1].length : 0;
        expect(dec).toBeLessThanOrEqual(6);
      }
      expect(fc.terra_link.decimals.written).toBe(6);
      expect(fc.terra_link.decimals.note).toMatch(/NO es prueba de precisi[óo]n de captura/i);
    });

    it('la exportación con perfil no sustituye a la técnica: las dos siguen disponibles', async () => {
      const tecnica = await http().get(`${org()}/reports/entities/plots/geojson`).set(as(ADMIN)).expect(200);
      const fc = JSON.parse(tecnica.text);
      expect(fc.terra_link.format).toMatch(/^TL_PLOTS_GEOJSON/);
      // La técnica sigue entregando sus propias propiedades, sin tocar.
      expect(fc.features[0]?.properties).toHaveProperty('plot_code');
    });

    it('sin permiso de exportación no se descarga', async () => {
      const p4 = (await http().post(`${org()}/producers`).set(as(ADMIN)).send({ producer_code: 'EXP-PERM', legal_name: 'Finca Permiso' }).expect(201)).body.id;
      await exportar(p4, 'auditor-perfil@test.local').expect(403);
    });

    it('un productor de otra organización no se exporta desde esta', async () => {
      const ajeno = (await http().post(`/api/v1/organizations/${orgB}/producers`).set(as('admin-b@test.local')).send({ producer_code: 'AJENO-1', legal_name: 'Finca Ajena' }).expect(201)).body.id;
      await exportar(ajeno).expect(404);
    });
  });
});
