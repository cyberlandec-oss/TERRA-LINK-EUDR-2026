import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// P1-011 (RF-42; S3 §40 «Histórico vivo de la parcela») — Histórico temporal y alertas.
//
// Lo que estas pruebas protegen: que **el pasado no se reescriba**, que **las lagunas se digan** en vez de
// rellenarse, que **menos cobertura no parezca mejora**, que **ninguna alerta invente un umbral** y que el
// historial **respete el alcance** de quien lo lee.
describeDb('P1-011 histórico temporal y alertas (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let parcela: string;
  let parcelaAjena: string;
  let v1: string; let v2: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o: string) => `/api/v1/organizations/${o}`;
  const SUPER = 'super@test.local';
  const ADMIN = 'admin-hist@test.local';
  const ADMIN_B = 'admin-histb@test.local';
  const TEC = 'tecnico-hist@test.local';
  const TEC2 = 'tecnico2-hist@test.local';

  interface Entrada { kind: string; id: string; occurred_at: string | null; recorded_at: string | null; evaluated_at: string | null; dates_note: string; versions: Record<string, unknown>; detail: string }
  interface Periodo { year: number; status: string; entries: Entrada[]; note: string }
  interface Alerta { code: string; label: string; plot_code: string; impact: string; cause: { kind: string; id: string; what: string }; what_it_does_not_mean: string; action_href: string | null; action: string | null }
  interface Hist {
    plot: { id: string; code: string; current_version_id: string | null };
    scope: string; periods: Periodo[]; alerts: Alerta[];
    restricted_sections: Array<{ section: string; why: string }>;
    comparable: Array<{ id: string; version_number: number }>;
    note: string; dates_note: string;
  }
  interface Comp {
    from: { version_number: number; analysis: unknown }; to: { version_number: number };
    changed: Record<string, boolean>; comparable: boolean; limitations: string[]; note: string;
  }

  const hist = async (actor: string, p = parcela, org = orgA) =>
    (await http().get(`${api(org)}/plots/${p}/timeline`).set(as(actor)).expect(200)).body as Hist;
  const membershipId = async (email: string) => (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id')
    .select('m.id').where('u.email', '=', email).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow()).id;

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Histórico A', ADMIN);
    orgB = await mk('Coop Histórico B', ADMIN_B);
    for (const e of [TEC, TEC2]) {
      const inv = await http().post(`${api(orgA)}/invitations`).set(as(ADMIN)).send({ email: e, role_code: 'FIELD_TECHNICIAN' }).expect(201);
      await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'T', last_name: e, password: PASSWORD }).expect(200);
      await h.login(e);
    }
    // Una parcela del técnico 1 y otra del técnico 2: el alcance tiene que separarlas.
    const mio = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN))
      .send({ producer_code: 'H-1', legal_name: 'Finca del técnico 1', assigned_membership_id: await membershipId(TEC) }).expect(201)).body.id;
    const ajeno = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN))
      .send({ producer_code: 'H-2', legal_name: 'Finca del técnico 2', assigned_membership_id: await membershipId(TEC2) }).expect(201)).body.id;
    parcela = (await http().post(`${api(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: mio, plot_code: 'H-1-P', crop: 'Cacao' }).expect(201)).body.id;
    parcelaAjena = (await http().post(`${api(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: ajeno, plot_code: 'H-2-P', crop: 'Cacao' }).expect(201)).body.id;

    const rv = async (id: string) => Number((await h.db.selectFrom('plots').select('row_version').where('id', '=', id).executeTakeFirstOrThrow()).row_version);
    // v1: solo superficie declarada (método DECLARED, sin geometría). v2: geometría capturada.
    // Dos métodos distintos, que es justo lo que la comparación tiene que saber advertir.
    await http().post(`${api(orgA)}/plots/${parcela}/declared-area`).set(as(ADMIN))
      .send({ expected_version: await rv(parcela), area_declared_ha: 2 }).expect(201);
    await http().post(`${api(orgA)}/plots/${parcela}/geometry-versions`).set(as(ADMIN))
      .send({ expected_version: await rv(parcela), survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.16, -0.848] }, area_declared_ha: 2.5 }).expect(201);
    const vs = await h.db.selectFrom('plot_versions').select(['id', 'version_number']).where('plot_id', '=', parcela).orderBy('version_number').execute();
    v1 = vs[0].id; v2 = vs[1].id;
  });
  afterAll(async () => h?.close());

  it('la línea de tiempo sale de lo REGISTRADO, y los años sin registros se declaran', async () => {
    const d = await hist(ADMIN);
    expect(d.periods.length).toBeGreaterThan(0);
    const conRegistros = d.periods.filter((p) => p.status === 'CON_REGISTROS');
    expect(conRegistros.length).toBeGreaterThan(0);
    // Las dos versiones de geometría están, en su año.
    const geos = d.periods.flatMap((p) => p.entries).filter((e) => e.kind === 'GEOMETRIA');
    expect(geos).toHaveLength(2);
    expect(geos.map((g) => g.versions.survey_method)).toEqual(['DECLARED', 'MANUAL_COORDINATES']);
    // Un año vacío dice que está vacío; no trae ceros ni entradas inventadas.
    for (const p of d.periods.filter((x) => x.status === 'SIN_REGISTROS')) {
      expect(p.entries).toEqual([]);
      expect(p.note).toMatch(/no hay nada registrado/i);
    }
    expect(d.note).toMatch(/no se rellena con ceros ni se interpola/);
  });

  it('distingue FECHA DEL HECHO, de REGISTRO y de EVALUACIÓN, y dice cuál falta', async () => {
    const d = await hist(ADMIN);
    const geo = d.periods.flatMap((p) => p.entries).find((e) => e.kind === 'GEOMETRIA')!;
    expect(geo.recorded_at).not.toBeNull();
    expect(geo.evaluated_at).toBeNull();
    // Sin levantamiento declarado, se dice que falta en vez de usar la de registro como si fuera el hecho.
    if (geo.occurred_at === null) expect(geo.dates_note).toMatch(/no registra esta fecha/i);
    expect(d.dates_note).toMatch(/cosas distintas y se publican por separado/);
  });

  it('EL PASADO NO SE REESCRIBE: una versión nueva no altera las entradas anteriores', async () => {
    const antes = await hist(ADMIN);
    const entradasAntes = JSON.stringify(antes.periods.flatMap((p) => p.entries).filter((e) => e.kind === 'GEOMETRIA'));

    const rv = Number((await h.db.selectFrom('plots').select('row_version').where('id', '=', parcela).executeTakeFirstOrThrow()).row_version);
    await http().post(`${api(orgA)}/plots/${parcela}/geometry-versions`).set(as(ADMIN))
      .send({ expected_version: rv, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.161, -0.8481] }, area_declared_ha: 2.7 }).expect(201);

    const despues = await hist(ADMIN);
    const geos = despues.periods.flatMap((p) => p.entries).filter((e) => e.kind === 'GEOMETRIA');
    expect(geos).toHaveLength(3);
    // Las dos primeras entradas siguen EXACTAMENTE igual.
    expect(JSON.stringify(geos.slice(0, 2))).toBe(entradasAntes);
  });

  it('COMPARAR muestra versiones y limitaciones; un cambio de método NO se presenta como mejora', async () => {
    const r = await http().get(`${api(orgA)}/plots/${parcela}/timeline/compare?from=${v1}&to=${v2}`).set(as(ADMIN)).expect(200);
    const c = r.body as Comp;
    expect(c.changed.geometry).toBe(true);
    expect(c.changed.survey_method).toBe(true);
    // El método cambió —de superficie declarada a geometría capturada—: la comparación se declara NO
    // concluyente, con su motivo, en vez de insinuar que la parcela «mejoró».
    expect(c.comparable).toBe(false);
    expect(c.limitations.join(' ')).toMatch(/método de levantamiento cambió/i);
    // Y sin análisis satelitales tampoco hay datasets que comparar: también se dice.
    expect(c.limitations.join(' ')).toMatch(/Falta el análisis de al menos una/);
    expect(c.note).toMatch(/NO CONCLUYENTE/);
    expect(c.note).toMatch(/no se interpreta como mejora/i);
    // Y comparar una versión consigo misma se rechaza.
    expect((await http().get(`${api(orgA)}/plots/${parcela}/timeline/compare?from=${v1}&to=${v1}`).set(as(ADMIN))).status).toBe(422);
    expect((await http().get(`${api(orgA)}/plots/${parcela}/timeline/compare?from=${v1}`).set(as(ADMIN))).status).toBe(400);
  });

  it('ALERTAS con causa trazable, sin umbrales inventados, y de SOLO LECTURA', async () => {
    // Una evidencia que declara ella misma su fin de vigencia, ya pasado.
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await sql`INSERT INTO evidence (id, organization_id, claim_type, entity_type, entity_id, status, valid_from, valid_to, operation_id, created_by)
      VALUES (${randomUUID()}, ${orgA}, ${'PLOT_FIELD_CAPTURED'}, 'plot', ${parcela}, 'VERIFIED', ${'2026-01-01'}, ${ayer}, ${randomUUID()},
              (SELECT id FROM users WHERE email = ${ADMIN}))`.execute(h.db);

    const d = await hist(ADMIN);
    const vencida = d.alerts.find((a) => a.code === 'EVIDENCIA_FUERA_DE_VIGENCIA');
    expect(vencida).toBeTruthy();
    // La causa es trazable: nombra el registro que la provoca.
    expect(vencida!.cause).toMatchObject({ kind: 'evidence' });
    expect(vencida!.cause.what).toMatch(new RegExp(ayer));
    // Y dice explícitamente que el plazo no lo fija Terra Link.
    expect(vencida!.what_it_does_not_mean).toMatch(/El plazo no lo fija Terra Link/);
    // S4 §20: toda alerta lleva problema, impacto, causa y acción —y el impacto habla de lo que ya no
    // puede sustentarse con el dato, nunca de una consecuencia jurídica ni de un plazo que nadie fijó.
    for (const a of d.alerts) {
      expect(a.label).toBeTruthy();
      expect(a.impact).toBeTruthy();
      expect(a.cause.id).toBeTruthy();
      expect(a.action_href).toBeTruthy();
      expect(a.action).toBeTruthy();
      expect(a.impact).not.toMatch(/ilegal|incumple|sanción|multa|plazo legal|debes|obligatorio/i);
    }
    expect(vencida!.action_href).toContain('/evidencias');

    // Solo lectura: no hay forma de marcarlas ni resolverlas.
    await http().post(`${api(orgA)}/temporal-alerts`).set(as(ADMIN)).send({}).expect(404);
    await http().patch(`${api(orgA)}/temporal-alerts`).set(as(ADMIN)).send({}).expect(404);
    const lista = (await http().get(`${api(orgA)}/temporal-alerts`).set(as(ADMIN)).expect(200)).body;
    expect(lista.note).toMatch(/no se marcan, no se resuelven/);
    expect(lista.note).toMatch(/Ningún umbral de riesgo, caducidad ni plazo legal se inventa/);
  });

  it('REINTENTOS SIN DUPLICACIÓN: leer dos veces da exactamente lo mismo', async () => {
    const a = await hist(ADMIN);
    const b = await hist(ADMIN);
    expect(JSON.stringify(a.alerts)).toBe(JSON.stringify(b.alerts));
    expect(JSON.stringify(a.periods)).toBe(JSON.stringify(b.periods));
    // Y la lista de la organización tampoco acumula.
    const l1 = (await http().get(`${api(orgA)}/temporal-alerts`).set(as(ADMIN)).expect(200)).body;
    const l2 = (await http().get(`${api(orgA)}/temporal-alerts`).set(as(ADMIN)).expect(200)).body;
    expect(l1.alerts.length).toBe(l2.alerts.length);
    const codigos = l1.alerts.map((x: Alerta) => `${x.code}:${x.cause.id}`);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('leer el historial NO cambia el estado del dominio', async () => {
    const versiones = await h.db.selectFrom('plot_versions').select('id').where('plot_id', '=', parcela).execute();
    const ev = await h.db.selectFrom('evidence').select(['id', 'status']).where('organization_id', '=', orgA).execute();
    await hist(ADMIN);
    await http().get(`${api(orgA)}/temporal-alerts`).set(as(ADMIN)).expect(200);
    expect(await h.db.selectFrom('plot_versions').select('id').where('plot_id', '=', parcela).execute()).toEqual(versiones);
    expect(await h.db.selectFrom('evidence').select(['id', 'status']).where('organization_id', '=', orgA).execute()).toEqual(ev);
  });

  it('ALCANCE: el técnico solo ve el historial de sus parcelas; lo ajeno es 404', async () => {
    const suyo = await hist(TEC);
    expect(suyo.scope).toBe('ASIGNADOS');
    expect(suyo.plot.code).toBe('H-1-P');
    // La parcela del otro técnico no existe para él.
    await http().get(`${api(orgA)}/plots/${parcelaAjena}/timeline`).set(as(TEC)).expect(404);
    // CONTROL: para quien lee toda la organización, sí existe.
    await http().get(`${api(orgA)}/plots/${parcelaAjena}/timeline`).set(as(ADMIN)).expect(200);
    // Otra organización, 404.
    await http().get(`${api(orgB)}/plots/${parcela}/timeline`).set(as(ADMIN)).expect(404);
    // Y sus alertas solo alcanzan lo suyo.
    const alertas = (await http().get(`${api(orgA)}/temporal-alerts`).set(as(TEC)).expect(200)).body;
    expect(alertas.alerts.every((a: Alerta) => a.plot_code === 'H-1-P')).toBe(true);
  });

  it('SECCIONES RESTRINGIDAS: lo que el rol no lee no se incluye, y se dice', async () => {
    const t = await hist(TEC);
    const secciones = t.restricted_sections.map((s) => s.section);
    // El técnico no lee riesgo ni satélite: esas secciones se declaran ausentes, no vacías.
    expect(secciones).toEqual(expect.arrayContaining(['RIESGO', 'ANALISIS_SATELITAL']));
    expect(t.periods.flatMap((p) => p.entries).some((e) => e.kind === 'RIESGO')).toBe(false);
    // CONTROL: quien sí los lee no recibe esas restricciones.
    const a = await hist(ADMIN);
    expect(a.restricted_sections.map((s) => s.section)).not.toContain('RIESGO');
  });

  it('una parcela recién creada tiene UN solo hecho —su creación— y ningún período inventado', async () => {
    const nueva = (await http().post(`${api(orgA)}/plots`).set(as(ADMIN))
      .send({ producer_id: (await h.db.selectFrom('producers').select('id').where('producer_code', '=', 'H-1').where('organization_id', '=', orgA).executeTakeFirstOrThrow()).id, plot_code: 'H-1-VACIA', crop: 'Cacao' }).expect(201)).body.id;
    const d = await hist(ADMIN, nueva);
    // Crear la ficha YA es un hecho registrado: el registro de cambios existente lo prueba.
    const entradas = d.periods.flatMap((p) => p.entries);
    expect(entradas).toHaveLength(1);
    expect(entradas[0].kind).toBe('CAMBIO_DE_FICHA');
    // Y no hay nada más: ni geometría, ni análisis, ni evidencia, ni riesgo.
    expect(entradas.some((e) => e.kind !== 'CAMBIO_DE_FICHA')).toBe(false);
    // Un solo período, el del año en que se registró. No se fabrican años anteriores.
    const anio = new Date().getFullYear();
    expect(d.periods.map((p) => p.year)).toEqual([anio]);
    // La única fecha que existe es la de registro; la del hecho se declara ausente.
    expect(entradas[0].occurred_at).toBeNull();
    expect(entradas[0].recorded_at).not.toBeNull();
  });
});
