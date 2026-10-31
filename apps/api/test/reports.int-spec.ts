import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// P0-030 Reportes e indicadores (RF-30, QA-13/14). Contrato: docs/decisiones/P0-030-REPORTES.md.
// Datos SINTÉTICOS con cifras conocidas: cada aserción compara contra una fixture construida en la prueba, no contra
// los conteos que devuelva la base en ese momento.
describeDb('P0-030 reportes: indicadores con denominador, período y permisos', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let product: string;
  let center: string;
  let prodConParcela: string;
  let primerLote: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o: string) => `/api/v1/organizations/${o}`;
  const ADMIN = 'admin-a@test.local';
  const AUD = 'auditor@test.local';

  type Ind = { code: string; name: string; definition: string; catalog: string; status: string; value: string | null; numerator: number | null; denominator: number | null; observed: Record<string, number> | null; criterion?: { id: string; version_current: string; versions_counted: string[]; mixed_versions: boolean; note: string }; reason: string | null; kind: string; unit: string; date_basis: string | null; requires: string };
  type Body = {
    indicators: Ind[]; can_export: boolean; period: { from: string | null; to: string | null };
    coverage: { status: string; event_date: string; note: string; not_reconstructed: string; reference: string };
    time_basis: { as_of: string; as_of_note: string; period_bounds: string; civil_dates: string };
    status_legend: Record<string, string>; privacy_note: string; interpretation_note: string; scope_note: string; assigned_scope_note: string;
    snapshot_note: string;
    comparison: null | {
      period: { from: string | null; to: string | null };
      days: { current: number | null; compared: number | null };
      equivalent_periods: boolean; equivalence_note: string; scope_note: string; balance_note: string; coverage_note: string;
      indicators: Array<{ code: string; unit: string; date_basis: string | null; current: { status: string; value: string | null }; compared: { status: string; value: string | null }; delta: string | null; delta_note: string }>;
    };
  };
  const report = async (actor: string, qs = '', o = orgA) => (await http().get(`${api(o)}/reports/indicators${qs}`).set(as(actor)).expect(200)).body as Body;
  const ind = (b: Body, code: string) => b.indicators.find((i) => i.code === code)!;

  async function join(email: string, role: string) {
    const inv = await http().post(`${api(orgA)}/invitations`).set(as(ADMIN)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  /** Entrega registrada con una fecha declarada concreta: así el período se prueba sobre delivery_date, no created_at. */
  const delivery = async (producer: string, date: string, q: string) =>
    (await http().post(`${api(orgA)}/deliveries`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), producer_id: producer, product_id: product, delivery_date: date, quantity_declared: q, unit: 'KG', register: true }).expect(201)).body.delivery;

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0); // un solo servidor escuchando, como en lots/inventario
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Reportes A', ADMIN);
    orgB = await mk('Coop Reportes B', 'admin-b@test.local');
    // Cobertura histórica DECLARADA (migración 0076) para esta organización de ensayo; otra sin declaración sale «desconocida».
    await sql`INSERT INTO report_coverage_declarations (id, organization_id, status, event_date, note, reference, declared_by)
      VALUES (${randomUUID()}, ${orgA}, 'INCOMPLETE', '2026-10-13', 'Cobertura histórica incompleta (declaración SINTÉTICA de ensayo): se perdieron registros creados antes del 2026-10-13. Los registros disponibles se incluyen SIEMPRE por su fecha operativa declarada, aunque sea anterior a esa fecha; por eso un período antiguo puede devolver menos de lo que ocurrió.', 'docs/qa/HALLAZGO_PERDIDA_DATOS_DEMO_2026-10-13.md', 'prueba')`.execute(h.db);
    for (const [e, r] of [[AUD, 'AUDITOR'], ['exportacion@test.local', 'EXPORT_MANAGER'], ['recepcion@test.local', 'RECEPTION_OPERATOR'], ['tecnico@test.local', 'FIELD_TECHNICIAN']]) await join(e, r);
    product = (await http().post(`${api(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${api(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CR', name: 'Centro', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    // Fixture conocida: 3 productores (uno dado de baja → no cuenta), 2 parcelas, 3 entregas registradas en fechas
    // distintas y 1 borrador, y en otra organización datos que NUNCA deben aparecer.
    prodConParcela = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'R-1', legal_name: 'Finca Uno' }).expect(201)).body.id;
    const p2 = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'R-2', legal_name: 'Finca Dos' }).expect(201)).body.id;
    const p3 = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'R-3', legal_name: 'Finca Baja' }).expect(201)).body;
    await http().post(`${api(orgA)}/producers/${p3.id}/archive`).set(as(ADMIN)).send({ expected_version: 1, reason: 'Fuera de la fixture' }).expect(200);
    const plot1 = (await http().post(`${api(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: prodConParcela, plot_code: 'R-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    await http().post(`${api(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: p2, plot_code: 'R-2-P1', crop: 'Cacao' }).expect(201);
    // Una parcela con superficie declarada (sin geometría): tiene versión vigente, luego entra en el denominador de
    // plots_valid y permite distinguir «sin evaluar» de «sin versión». La otra queda sin versión, a propósito.
    await http().post(`${api(orgA)}/plots/${plot1}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'DECLARED', area_declared_ha: 3 }).expect(201);
    // Dos de estas entregas tienen FECHA OPERATIVA de septiembre y se registran HOY, después de la pérdida de
    // almacenamiento del 2026-10-13: deben contar en septiembre (ver la prueba de cobertura histórica).
    await delivery(prodConParcela, '2026-09-10', '100');
    await delivery(prodConParcela, '2026-09-20', '200');
    await delivery(p2, '2026-10-05', '300');
    await http().post(`${api(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: p2 }).expect(201); // borrador
    // Organización B: material que no debe cruzarse.
    await http().post(`${api(orgB)}/producers`).set(as('admin-b@test.local')).send({ producer_code: 'B-1', legal_name: 'Ajena' }).expect(201);
  });
  afterAll(async () => h?.close());

  it('conteos de estado sobre la fixture: bajas excluidas, sin mezclar organizaciones y sin filtrar por período', async () => {
    const b = await report(ADMIN);
    expect(ind(b, 'producers_total')).toMatchObject({ status: 'OK', value: '2', kind: 'STATE', unit: 'count' }); // el dado de baja no cuenta
    expect(ind(b, 'producers_total').observed).toMatchObject({ activos: 2, dados_de_baja: 1 }); // la baja se informa, no se esconde
    expect(ind(b, 'plots_total')).toMatchObject({ status: 'OK', value: '2', kind: 'STATE' });
    // El período no toca los indicadores de estado: mismo valor con un período que excluiría todo por created_at.
    const b2 = await report(ADMIN, '?from=1999-01-01&to=1999-12-31');
    expect(ind(b2, 'producers_total').value).toBe('2');
    expect(ind(b2, 'plots_total').value).toBe('2');
    expect(ind(b2, 'producers_total').reason).toMatch(/no se filtra por .created_at./i);
    // La organización B tiene su propio productor y no suma aquí.
    expect((await report('admin-b@test.local', '', orgB)).indicators.find((i) => i.code === 'producers_total')!.value).toBe('1');
  });

  it('actividad por período: usa la fecha declarada de entrega, no created_at; los borradores quedan fuera', async () => {
    const todo = await report(ADMIN);
    expect(ind(todo, 'deliveries_total')).toMatchObject({ status: 'OK', value: '3', kind: 'ACTIVITY' });
    expect(ind(todo, 'deliveries_total').date_basis).toMatch(/delivery_date/);
    expect(ind(todo, 'deliveries_total').reason).toMatch(/borradores quedan fuera/i);
    expect(ind(todo, 'deliveries_total').observed).toMatchObject({ borradores: 1, registradas_sin_fecha: 0 });
    // Septiembre: 2 de 3. Octubre: 1. Un período anterior a toda la fixture: 0 entregas, no un error.
    expect(ind(await report(ADMIN, '?from=2026-09-01&to=2026-09-30'), 'deliveries_total').value).toBe('2');
    expect(ind(await report(ADMIN, '?from=2026-10-01&to=2026-10-31'), 'deliveries_total').value).toBe('1');
    expect(ind(await report(ADMIN, '?from=2020-01-01&to=2020-12-31'), 'deliveries_total').value).toBe('0');
    // Límites INCLUSIVOS: un período que empieza y termina el mismo día de una entrega la incluye.
    expect(ind(await report(ADMIN, '?from=2026-09-20&to=2026-09-20'), 'deliveries_total').value).toBe('1');
    // Las entregas se crearon hoy: si el filtro usara created_at, un período de 2026-09 devolvería 0 y no 2.
    const creadasHoy = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM deliveries WHERE organization_id = ${orgA} AND created_at::date = CURRENT_DATE`.execute(h.db)).rows[0].n;
    expect(Number(creadasHoy)).toBeGreaterThanOrEqual(4);
  });

  it('cobertura histórica: declara incompleta y NO excluye registros por tener fecha operativa anterior a la pérdida', async () => {
    const b = await report(ADMIN);
    expect(b.coverage.status).toBe('INCOMPLETE');
    expect(b.coverage.event_date).toBe('2026-10-13');
    expect(b.coverage.reference).toBe('docs/qa/HALLAZGO_PERDIDA_DATOS_DEMO_2026-10-13.md');
    // F03: la declaración es de ESTA organización; la otra no la hereda y su cobertura es DESCONOCIDA (ni completa ni incompleta), también en la descarga.
    const sin = await report('admin-b@test.local', '', orgB);
    expect(sin.coverage).toMatchObject({ status: 'UNKNOWN', event_date: null, reference: null });
    expect(sin.coverage.note).toMatch(/no se ha declarado la cobertura/i);
    expect(JSON.stringify(sin)).not.toMatch(/2026-10-13/);
    expect(b.coverage.note).toMatch(/cobertura histórica incompleta/i);
    expect(b.coverage.note).toMatch(/fecha operativa/i);
    expect(b.coverage.not_reconstructed).toMatch(/no se reconstruye/i);
    // Lo que NO debe volver a afirmarse: que toda serie anterior a esa fecha esté vacía.
    expect(b.coverage.note).not.toMatch(/toda serie anterior.*(vacía|vacia)/i);
    expect(JSON.stringify(b.coverage)).not.toMatch(/está vacía/i);
    // Y la prueba de fondo: las entregas de SEPTIEMBRE se registraron HOY, después de la pérdida del 13-oct, y cuentan
    // en septiembre. Si el reporte excluyera por fecha operativa anterior a la pérdida, aquí saldría 0.
    const sept = (await sql<{ n: string; creadas_tras_perdida: string }>`
      SELECT count(*)::text AS n,
             count(*) FILTER (WHERE created_at::date > DATE '2026-10-13')::text AS creadas_tras_perdida
      FROM deliveries WHERE organization_id = ${orgA} AND status = 'REGISTERED' AND delivery_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-30'`.execute(h.db)).rows[0];
    expect(Number(sept.n)).toBe(2);
    expect(Number(sept.creadas_tras_perdida)).toBe(2); // registradas después de la pérdida, con fecha operativa anterior
    expect(ind(await report(ADMIN, '?from=2026-09-01&to=2026-09-30'), 'deliveries_total').value).toBe('2');
  });

  it('fechas y zona horaria declaradas: límites inclusivos, fecha civil sin zona y as_of en UTC', async () => {
    const b = await report(ADMIN);
    expect(b.time_basis.as_of).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(b.time_basis.as_of_note).toMatch(/UTC/);
    expect(b.time_basis.period_bounds).toMatch(/inclusiv/i);
    expect(b.time_basis.civil_dates).toMatch(/sin zona|no se le asigna zona/i);
    expect(b.time_basis.civil_dates).toMatch(/created_at/);
  });

  it('criterio definido pero sin ejecutar: UNKNOWN, no cero ni CRITERION_UNDEFINED, y con el perfil identificado', async () => {
    const b = await report(ADMIN);
    // GIS: 1 parcela tiene versión vigente y NO se ha evaluado con el perfil. La otra no tiene versión: queda fuera
    // del denominador y se declara aparte, no se cuenta como incumplimiento.
    const pv = ind(b, 'plots_valid');
    // Desde D-05.A el criterio EXISTE: lo que falta es ejecutarlo. Son dos estados distintos y no se confunden.
    expect(pv).toMatchObject({ status: 'UNKNOWN', value: null, denominator: 0 });
    expect(pv.reason).toMatch(/El criterio existe y tiene versión/i);
    expect(pv.reason).toMatch(/ninguna de las 1 parcela\(s\) con versión vigente ha sido evaluada/i);
    expect(pv.reason).toMatch(/Desconocido no es cero/i);
    // El indicador declara CONTRA QUÉ criterio cuenta, con su versión.
    expect(pv.criterion).toMatchObject({ id: 'EUDR_GEO_V1', version_current: '1.0.0', versions_counted: [], mixed_versions: false });
    expect(pv.criterion!.note).toMatch(/no es conformidad EUDR/i);
    // Lo contable se cuenta igual, con las cuatro situaciones separadas.
    expect(pv.observed).toMatchObject({ con_version_vigente: 1, evaluadas: 0, sin_evaluar: 1, cumple_perfil: 0, no_cumple: 0, en_revision: 0, no_evaluable: 0 });
    // Ningún indicador sin estado OK publica un valor.
    for (const i of b.indicators) if (i.status !== 'OK') expect(i.value).toBeNull();
  });

  it('plots_valid cuenta el perfil de la versión VIGENTE y separa cumple / no cumple / revisión / no evaluable', async () => {
    // Se construye en la organización B, no en la fixture de A: así esta prueba no mueve los conteos que
    // comprueban las demás y deja de importar en qué orden se ejecute.
    const B = 'admin-b@test.local';
    const prod = (await http().post(`${api(orgB)}/producers`).set(as(B)).send({ producer_code: 'PV-1', legal_name: 'Finca Perfil' }).expect(201)).body.id;
    const ring = (pts: number[][]) => [...pts, pts[0]];
    const sq = (x: number, y: number, d = 0.01) => ({ type: 'Polygon', coordinates: [ring([[x, y], [x + d, y], [x + d, y + d], [x, y + d]])] });
    const mk = async (code: string, geometry: unknown, declared?: number) => {
      const id = (await http().post(`${api(orgB)}/plots`).set(as(B)).send({ producer_id: prod, plot_code: code, crop: 'Cacao' }).expect(201)).body.id;
      const body: Record<string, unknown> = { expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry };
      if (declared !== undefined) body.area_declared_ha = declared;
      await http().post(`${api(orgB)}/plots/${id}/geometry-versions`).set(as(B)).send(body).expect(201);
      return id;
    };
    const evaluar = (plot: string) =>
      http().post(`${api(orgB)}/plots/${plot}/geo-profile/evaluations`).set(as(B)).send({ operation_id: randomUUID() }).expect(201);

    const cumple = await mk('PV-OK', sq(-75.5, -1.0));
    const noCumple = await mk('PV-BAD', { type: 'Point', coordinates: [-75.4, -1.0] }, 9); // punto por encima del umbral
    const noEvaluable = await mk('PV-NOEV', { type: 'Point', coordinates: [-75.3, -1.0] }); // punto sin superficie
    const sinEvaluar = await mk('PV-SKIP', sq(-75.2, -1.0));
    await evaluar(cumple); await evaluar(noCumple); await evaluar(noEvaluable);

    const pv = ind(await report(B, '', orgB), 'plots_valid');
    expect(pv.status).toBe('OK');
    expect(pv.observed).toMatchObject({ evaluadas: 3, cumple_perfil: 1, no_cumple: 1, no_evaluable: 1, en_revision: 0 });
    expect(pv).toMatchObject({ value: '1', numerator: 1, denominator: 3 });
    // Las no evaluadas NO entran en el denominador: desconocido no es incumplimiento.
    expect(pv.observed!.sin_evaluar).toBe(1); // PV-SKIP
    expect(pv.reason).toMatch(/NO entran en el denominador/i);
    expect(pv.criterion).toMatchObject({ versions_counted: ['EUDR_GEO_V1@1.0.0'], mixed_versions: false });
    expect(pv.reason).toMatch(/no es conformidad regulatoria/i);

    // Una versión geométrica NUEVA deja la parcela sin dictamen vigente: el dictamen anterior NO se hereda.
    await http().post(`${api(orgB)}/plots/${cumple}/geometry-versions`).set(as(B))
      .send({ expected_version: 2, survey_method: 'MANUAL_COORDINATES', geometry: sq(-75.1, -1.0) }).expect(201);
    const despues = ind(await report(B, '', orgB), 'plots_valid');
    expect(despues.observed).toMatchObject({ evaluadas: 2, cumple_perfil: 0 });
    expect(despues.value).toBe('0');
    expect(despues.reason).toMatch(/Cero observado/i);
    void sinEvaluar;
  });

  it('plots_valid respeta el permiso del dominio: sin plot:read no se calcula ni se informa parcialmente', async () => {
    const pv = ind(await report('exportacion@test.local'), 'plots_valid'); // EXPORT_MANAGER: report:read sin plot:read
    expect(pv).toMatchObject({ status: 'RESTRICTED', value: null, numerator: null, denominator: null, observed: null });
    expect(pv.reason).toMatch(/plot:read/);
  });

  it('sin sujetos evaluados el riesgo es NO_DENOMINATOR, no cero: la ausencia de evaluaciones es un hecho observado', async () => {
    const b = await report(ADMIN);
    for (const code of ['risk_high', 'risk_medium', 'risk_low']) {
      const i = ind(b, code);
      expect(i).toMatchObject({ status: 'NO_DENOMINATOR', value: null, denominator: 0 });
      expect(i.observed).toMatchObject({ lotes_evaluados: 0 });
      expect(i.reason).toMatch(/denominador es cero/i);
    }
  });

  it('denominador cero produce NO_DENOMINATOR, no 0 % ni 100 %', async () => {
    const b = await report(ADMIN);
    // Sin lotes, sin evidencias y sin expedientes en esta organización.
    for (const code of ['traceability_completeness', 'evidence_completeness', 'due_diligence_ready']) {
      expect(ind(b, code)).toMatchObject({ status: 'NO_DENOMINATOR', value: null, denominator: 0 });
      expect(ind(b, code).reason).toMatch(/denominador|sin expedientes/i);
      expect(ind(b, code).value).toBeNull();
    }
  });

  it('porcentaje real con denominador conocido: 1 de 2 lotes con origen completo = 50,0 %', async () => {
    // Fixture: dos lotes, uno con origen declarado y otro sin él.
    const plot = (await http().get(`${api(orgA)}/plots`).set(as(ADMIN)).expect(200)).body.items[0].id;
    const conOrigen = (await http().post(`${api(orgA)}/deliveries`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), producer_id: prodConParcela, product_id: product, delivery_date: '2026-10-08', quantity_declared: '50', unit: 'KG', origins: [{ plot_id: plot }], register: true }).expect(201)).body.delivery;
    const mkLot = async (d: { id: string }, q: string) => {
      const r = (await http().post(`${api(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN))
        .send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'Báscula', quantity: q, unit: 'KG', weighed_on: '2026-10-08' } }).expect(201)).body.reception_id;
      return (await http().post(`${api(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r, quantity: q }] }).expect(201)).body.lot;
    };
    primerLote = (await mkLot(conOrigen, '50')).id;
    await mkLot(await delivery(prodConParcela, '2026-10-09', '60'), '60'); // sin orígenes declarados
    const b = await report(ADMIN);
    expect(ind(b, 'lots_active')).toMatchObject({ status: 'OK', value: '2' });
    expect(ind(b, 'traceability_completeness')).toMatchObject({ status: 'OK', value: '50.0', numerator: 1, denominator: 2, unit: 'percent' });
    expect(ind(b, 'traceability_completeness').reason).toMatch(/no acredita verificación|no es verificación|conformidad/i);
  });

  it('evaluado pero sin severidad = UNKNOWN (desconocido), distinto de cero y distinto de sin denominador', async () => {
    // El motor devuelve NOT_ASSESSED por diseño mientras D-05, P0-028 y P0-021 sigan abiertos (P0-020).
    await http().post(`${api(orgA)}/risk/lots/${primerLote}/evaluations`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201);
    const b = await report(ADMIN);
    for (const code of ['risk_high', 'risk_medium', 'risk_low']) {
      const i = ind(b, code);
      expect(i).toMatchObject({ status: 'UNKNOWN', value: null, denominator: 1 });
      expect(i.observed).toMatchObject({ lotes_evaluados: 1, sin_severidad_asignada: 1, con_severidad_asignada: 0 });
      expect(i.reason).toMatch(/desconocido/i);
      expect(i.reason).toMatch(/NOT_ASSESSED/);
    }
    // Lo evaluable sí se cuenta: hay 1 sujeto evaluado de 2 lotes, y eso se publica como conteo observado.
    expect(ind(b, 'risk_high').observed).toMatchObject({ lotes_del_tenant: 2 });
  });

  it('la severidad depende del catálogo de reglas (D-07), no de cerrar otras historias', async () => {
    const b = await report(ADMIN);
    // El motivo cita el catálogo real, leído de la base. Desde la migración 0043 hay una versión APROBADA publicada
    // globalmente, y aun así esta organización no clasifica nada: la causa verdadera es que NO la ha adoptado (D-07.1).
    const catalogo = (await sql<{ version: string; approval_status: string }>`SELECT version, approval_status FROM risk_rule_sets ORDER BY published_at DESC, version DESC LIMIT 1`.execute(h.db)).rows[0];
    expect(catalogo.approval_status).toBe('APPROVED');
    const adopciones = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_rule_set_adoptions WHERE organization_id = ${orgA}`.execute(h.db)).rows[0].n;
    expect(adopciones).toBe('0');
    for (const code of ['risk_critical', 'risk_high', 'risk_medium', 'risk_low']) {
      const i = ind(b, code);
      expect(i.reason).toContain(catalogo.version);
      expect(i.reason).toContain(catalogo.approval_status);
      expect(i.reason).toMatch(/NO lo ha adoptado/);
      expect(i.reason).toMatch(/actos distintos \(D-07\.1\)/);
      expect(i.reason).toMatch(/D-07/);
      // P0-021 está implementada: verificar una mitigación NO asigna severidad ni concluye a favor.
      expect(i.reason).toMatch(/P0-021, implementada/);
      expect(i.reason).toMatch(/no asigna severidad/i);
      // Y no se atribuye el bloqueo a cerrar el satélite ni las mitigaciones.
      expect(i.reason).not.toMatch(/mientras.*P0-028.*no cierren/i);
    }
  });

  it('los CRÍTICOS tienen indicador propio, declarado como extensión de Terra Link y no como exigencia de la fuente', async () => {
    const b = await report(ADMIN);
    const critico = ind(b, 'risk_critical');
    expect(critico.catalog).toBe('TERRA_LINK'); // la lista de S1 §60 no lo trae; se añade declarándolo
    expect(critico.definition).toMatch(/severity = CRITICAL/);
    expect(critico.definition).toMatch(/no conclusión regulatoria/i);
    for (const code of ['risk_high', 'risk_medium', 'risk_low']) expect(ind(b, code).catalog).toBe('S1_60');
    // Va junto al desglose existente y en el mismo orden de severidad: no está escondido al final del reporte.
    const orden = b.indicators.map((i) => i.code).filter((c) => c.startsWith('risk_'));
    expect(orden).toEqual(['risk_critical', 'risk_high', 'risk_medium', 'risk_low']);
    // Sin permiso de riesgo, el crítico se restringe igual que los demás: no se filtra por una extensión.
    const sinRiesgo = await report('exportacion@test.local'); // report:read sí, risk:read no
    expect(ind(sinRiesgo, 'risk_critical')).toMatchObject({ status: 'RESTRICTED', value: null });
  });

  it('la base IMPIDE que exista una severidad: el caso mixto no es alcanzable hoy, y el candado se comprueba', async () => {
    // Desde la migración 0042 (mecanismos D-07) el candado único de 0025 son DOS, más precisos, y ninguno es una
    // relajación: la severidad exige una ADOPCIÓN de catálogo que la respalde (`risk_evaluations_severity_backed`)
    // y la conclusión regulatoria sigue clavada en UNDETERMINED (`risk_evaluations_conclusion_undetermined`),
    // porque D-07.5 y D-07.6 siguen pendientes. No es solo que el motor escriba NOT_ASSESSED: el esquema rechaza
    // cualquier otra cosa, venga de donde venga.
    const lotes = (await sql<{ id: string }>`SELECT id FROM lots WHERE organization_id = ${orgA} ORDER BY lot_code`.execute(h.db)).rows;
    const segundo = lotes.find((l) => l.id !== primerLote)!;
    const insertar = sql`
      INSERT INTO risk_evaluations (id, organization_id, subject_type, subject_id, evaluation_number, rule_set_version,
                                    parameters, snapshot, snapshot_hash, factors, categories, technical_result, severity,
                                    conclusion, evaluated_by, operation_id)
      SELECT gen_random_uuid(), organization_id, subject_type, ${segundo.id}, 1, rule_set_version, parameters, snapshot,
             snapshot_hash, factors, categories, technical_result, 'HIGH', conclusion, evaluated_by, gen_random_uuid()
      FROM risk_evaluations WHERE organization_id = ${orgA} ORDER BY evaluated_at LIMIT 1`.execute(h.db);
    // Sin adopción que la respalde, la severidad no se puede escribir.
    await expect(insertar).rejects.toThrow(/risk_evaluations_severity_backed/);
    // Y la conclusión regulatoria no se puede escribir de ninguna manera, con o sin adopción.
    const concluir = sql`
      INSERT INTO risk_evaluations (id, organization_id, subject_type, subject_id, evaluation_number, rule_set_version,
                                    parameters, snapshot, snapshot_hash, factors, categories, technical_result, severity,
                                    conclusion, evaluated_by, operation_id)
      SELECT gen_random_uuid(), organization_id, subject_type, ${segundo.id}, 2, rule_set_version, parameters, snapshot,
             snapshot_hash, factors, categories, technical_result, 'NOT_ASSESSED', 'NEGLIGIBLE', evaluated_by, gen_random_uuid()
      FROM risk_evaluations WHERE organization_id = ${orgA} ORDER BY evaluated_at LIMIT 1`.execute(h.db);
    await expect(concluir).rejects.toThrow(/risk_evaluations_conclusion_undetermined/);
    // Y la fila existente sigue sin severidad: nada quedó a medias.
    const sev = (await sql<{ severity: string; n: string }>`SELECT severity, count(*)::text AS n FROM risk_evaluations WHERE organization_id = ${orgA} GROUP BY severity`.execute(h.db)).rows;
    expect(sev).toEqual([{ severity: 'NOT_ASSESSED', n: '1' }]);
    // Por eso el reparto por severidad con sujetos clasificados se prueba en memoria: src/reports/reports-risk.spec.ts.
  });

  it('comparación de actividad entre dos períodos: fechas operativas, equivalencia declarada y sin tocar existencias', async () => {
    // Septiembre (2 entregas) frente a octubre. Ambos períodos se calculan en la MISMA instantánea.
    const b = await report(ADMIN, '?from=2026-09-01&to=2026-09-30&compare_from=2026-10-01&compare_to=2026-10-31');
    const c = b.comparison!;
    expect(c.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    const entregas = c.indicators.find((i) => i.code === 'deliveries_total')!;
    expect(entregas.current.value).toBe('2');
    expect(Number(entregas.compared.value)).toBeGreaterThanOrEqual(1);
    expect(entregas.delta).toBe(String(2 - Number(entregas.compared.value)));
    expect(entregas.date_basis).toMatch(/delivery_date/);
    // 30 días frente a 31: NO son equivalentes, y se declara en vez de corregirse en silencio.
    expect(c.days).toEqual({ current: 30, compared: 31 });
    expect(c.equivalent_periods).toBe(false);
    expect(c.equivalence_note).toMatch(/no abarcan el mismo número de días/i);
    // Solo actividad: los indicadores de estado no entran en la comparación.
    expect(c.indicators.every((i) => i.code === 'deliveries_total')).toBe(true);
    // Comparar actividad no es reconstruir existencias, y así se dice.
    expect(c.balance_note).toMatch(/saldo a una fecha es una capacidad distinta/i);
    expect(c.coverage_note).toMatch(/cobertura histórica incompleta/i);
    // Dos períodos de igual longitud sí se declaran equivalentes.
    const igual = await report(ADMIN, '?from=2026-09-01&to=2026-09-30&compare_from=2026-10-01&compare_to=2026-10-30');
    expect(igual.comparison!.equivalent_periods).toBe(true);
    expect(igual.comparison!.equivalence_note).toMatch(/30 día\(s\)/);
    // Sin período de comparación no se inventa ninguna: el campo queda nulo.
    expect((await report(ADMIN)).comparison).toBeNull();
  });

  it('un expediente BLOCKED se CUENTA: cero observado en READY con el desglose por preparación', async () => {
    const caso = (await http().post(`${api(orgA)}/dd-cases`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), lot_id: primerLote, scope_note: 'Expediente de la fixture de reportes' }).expect(201)).body;
    await http().post(`${api(orgA)}/dd-cases/${caso.case.id}/snapshots`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201);
    const i = ind(await report(ADMIN), 'due_diligence_ready');
    // READY es 0 y se publica como CERO OBSERVADO: hay un expediente y su preparación se conoce.
    expect(i).toMatchObject({ status: 'OK', value: '0', numerator: 0, denominator: 1 });
    expect(i.observed).toMatchObject({ expedientes: 1, READY: 0, BLOCKED: 1 });
    expect(i.reason).toMatch(/cero observado/i);
    expect(i.reason).toMatch(/preparación interna/i);
    expect(i.reason).toMatch(/no mide el desempeño/i);
  });

  it('permisos: report:read abre la pantalla pero cada indicador exige el permiso de su dominio; nada se deduce por diferencia', async () => {
    // EXPORT_MANAGER tiene report:read y lot:read, pero no producer:read, plot:read, delivery:read, risk:read ni dd:read.
    const b = await report('exportacion@test.local');
    for (const code of ['producers_total', 'plots_total', 'plots_valid', 'deliveries_total', 'risk_high', 'evidence_completeness', 'due_diligence_ready']) {
      const i = ind(b, code);
      expect(i.status).toBe('RESTRICTED');
      expect({ value: i.value, numerator: i.numerator, denominator: i.denominator, observed: i.observed }).toEqual({ value: null, numerator: null, denominator: null, observed: null });
      expect(i.reason).toMatch(/no permite leer este dominio/i);
    }
    expect(ind(b, 'lots_active').status).toBe('OK'); // lo que sí puede leer, lo ve
    expect(b.can_export).toBe(false);
    // Un rol sin report:read no entra a la pantalla; un alcance por asignación no habilita agregados.
    await http().get(`${api(orgA)}/reports/indicators`).set(as('recepcion@test.local')).expect(403);
    await http().get(`${api(orgA)}/reports/indicators`).set(as('tecnico@test.local')).expect(403);
    // Otra organización: 404, no 403, y sin filtrar la existencia.
    await http().get(`${api(orgB)}/reports/indicators`).set(as(ADMIN)).expect(404);
  });

  it('exportación: permiso propio revalidado, coincide con la pantalla, lleva hash y queda auditada; fórmulas neutralizadas', async () => {
    const pantalla = await report(AUD, '?from=2026-09-01&to=2026-09-30');
    expect(pantalla.can_export).toBe(true);
    const res = await http().get(`${api(orgA)}/reports/indicators/export?from=2026-09-01&to=2026-09-30`).set(as(AUD)).expect(200);
    const csv = (res.text ?? String(res.body)).replace(/^﻿/, ''); // el CSV lleva BOM: se retira para leerlo
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="indicadores-/);
    expect(res.headers['x-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    // Metadatos obligatorios: alcance, período, privacidad, interpretación, cobertura y aviso de recálculo.
    expect(csv).toMatch(/# formato,.*TL_REPORT_CSV/);
    expect(csv).toMatch(/# periodo_desde,2026-09-01/);
    expect(csv).toMatch(/# periodo_hasta,2026-09-30/);
    expect(csv).toMatch(/# privacidad,.*no contiene datos personales/);
    expect(csv).toMatch(/# cobertura_historica,.*2026-10-13/);
    expect(csv).toMatch(/# recalculo,.*RECALCULA/);
    // CONSISTENCIA pantalla ↔ exportación: cada indicador aparece con el mismo estado y el mismo valor.
    const filas = new Map(csv.split('\r\n').filter((l) => l && !l.startsWith('#')).slice(1).map((l) => {
      const celdas = l.split(',').map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
      return [celdas[0], { status: celdas[4], value: celdas[5] }] as const;
    }));
    for (const i of pantalla.indicators) {
      expect(filas.get(i.code)).toEqual({ status: i.status, value: i.value ?? '' });
    }
    // El período del archivo manda sobre el contenido: en septiembre hay 2 entregas.
    expect(filas.get('deliveries_total')!.value).toBe('2');
    // Neutralización de fórmulas: ninguna celda empieza por =, +, - o @ sin la comilla de escape.
    for (const linea of csv.split('\r\n').filter((l) => l && !l.startsWith('#'))) {
      for (const celda of linea.split(',')) expect(celda).not.toMatch(/^[=+@]/);
    }
    // Auditada con hash y filtros; sin report:export no se descarga aunque se tenga la pantalla.
    const log = (await sql<{ after: Record<string, unknown> }>`SELECT after FROM audit_logs WHERE organization_id = ${orgA} AND action = 'report.export' ORDER BY occurred_at DESC LIMIT 1`.execute(h.db)).rows[0];
    expect(log.after).toMatchObject({ sha256: res.headers['x-content-sha256'], format_version: expect.stringContaining('TL_REPORT_CSV') });
    await http().get(`${api(orgA)}/reports/indicators/export`).set(as('exportacion@test.local')).expect(403);
  });

  it('la respuesta declara la interpretación y no expone identidad ni geometría', async () => {
    const b = await report(ADMIN);
    expect(b.privacy_note).toMatch(/no contiene datos personales ni coordenadas/i);
    expect(b.interpretation_note).toMatch(/Readiness no es conformidad/i);
    expect(b.interpretation_note).toMatch(/Reserva no es despacho/i);
    expect(b.assigned_scope_note).toMatch(/_assigned/);
    expect(Object.keys(b.status_legend).sort()).toEqual(['CRITERION_UNDEFINED', 'NO_DENOMINATOR', 'OK', 'RESTRICTED', 'UNKNOWN']);
    // Ningún indicador expone identidad ni geometría.
    const texto = JSON.stringify(b);
    for (const prohibido of ['document_number', 'phone_enc', 'geometry', 'latitude', 'longitude']) expect(texto).not.toContain(prohibido);
  });

  // ------------------------------------------------------------------ catálogo ADOPTADO (organización B, aislada)
  // La organización A no adopta nada en todo el archivo: así se prueba el camino «publicado y no adoptado». Aquí se
  // prueba el otro, en una organización distinta para no contaminar la fixture de A.
  describe('con el catálogo 1.0.0 adoptado, los críticos se ven y la distribución sigue siendo parcial', () => {
    const ADMIN_B = 'admin-b@test.local';
    let loteB: string;

    beforeAll(async () => {
      const prod = (await http().post(`${api(orgB)}/products`).set(as(ADMIN_B)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
      const loc = (await http().post(`${api(orgB)}/locations`).set(as(ADMIN_B)).send({ code: 'CR-B', name: 'Centro B', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
      const prodor = (await http().post(`${api(orgB)}/producers`).set(as(ADMIN_B)).send({ producer_code: 'B-2', legal_name: 'Finca B' }).expect(201)).body.id;
      // Entrega SIN parcela de origen declarada: el lote queda con origen INCOMPLETO, que es el hallazgo CRÍTICO.
      const ent = (await http().post(`${api(orgB)}/deliveries`).set(as(ADMIN_B))
        .send({ operation_id: randomUUID(), producer_id: prodor, product_id: prod, delivery_date: '2026-10-08', quantity_declared: '40', unit: 'KG', register: true }).expect(201)).body.delivery;
      const rec = (await http().post(`${api(orgB)}/deliveries/${ent.id}/receptions`).set(as(ADMIN_B))
        .send({ operation_id: randomUUID(), location_id: loc, received_at: new Date().toISOString(), weighing: { method: 'Báscula', quantity: '40', unit: 'KG', weighed_on: '2026-10-08' } }).expect(201)).body.reception_id;
      loteB = (await http().post(`${api(orgB)}/lots`).set(as(ADMIN_B)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '40' }] }).expect(201)).body.lot.id;
    });

    it('antes de adoptar: evaluado y sin clasificar, con el motivo real (publicar no es adoptar)', async () => {
      await http().post(`${api(orgB)}/risk/lots/${loteB}/evaluations`).set(as(ADMIN_B)).send({ operation_id: randomUUID() }).expect(201);
      const i = ind(await report(ADMIN_B, '', orgB), 'risk_critical');
      expect(i).toMatchObject({ status: 'UNKNOWN', value: null, denominator: 1 });
      expect(i.observed).toMatchObject({ lotes_evaluados: 1, sin_severidad_asignada: 1, con_severidad_asignada: 0 });
      expect(i.reason).toMatch(/NO lo ha adoptado/);
    });

    it('adoptado y reevaluado: el CRÍTICO aparece por sí mismo y no se mezcla con ALTO', async () => {
      await http().post(`${api(orgB)}/risk/rule-sets/adoptions`).set(as(ADMIN_B))
        .send({ operation_id: randomUUID(), rule_set_version: '1.0.0', decision: 'ADOPT', reason: 'Ensayo técnico del MVP local' }).expect(201);
      // La adopción NO recalcula evaluaciones anteriores: hay que volver a evaluar para que la severidad exista.
      const ev = (await http().post(`${api(orgB)}/risk/lots/${loteB}/evaluations`).set(as(ADMIN_B)).send({ operation_id: randomUUID() }).expect(201)).body.evaluation;
      expect(ev.risk_result.severity).toBe('CRITICAL');

      const b = await report(ADMIN_B, '', orgB);
      // ÚLTIMA evaluación por sujeto: el lote cuenta una sola vez, con su severidad vigente, no dos.
      expect(ind(b, 'risk_critical')).toMatchObject({ status: 'OK', value: '1', numerator: 1, denominator: 1 });
      expect(ind(b, 'risk_high')).toMatchObject({ status: 'OK', value: '0', numerator: 0, denominator: 1 });
      expect(ind(b, 'risk_high').reason).toMatch(/^Cero observado/); // cero observado, NO «no hay críticos»
      expect(ind(b, 'risk_critical').observed).toMatchObject({ lotes_del_tenant: 1, lotes_evaluados: 1, con_severidad_asignada: 1, sin_severidad_asignada: 0 });
      // Distribución PARCIAL declarada como tal: de qué catálogo sale y qué no acredita.
      expect(ind(b, 'risk_critical').reason).toContain('HALLAZGOS EVALUADOS del catálogo adoptado (1.0.0)');
      expect(ind(b, 'risk_critical').reason).toMatch(/NO es una conclusión regulatoria: esa sigue UNDETERMINED/);
      // La organización A, que no ha adoptado, sigue sin clasificar: la adopción de B no cruza.
      expect(ind(await report(ADMIN), 'risk_critical').status).toBe('UNKNOWN');
    });

    it('el crítico viaja al CSV con el mismo estado y valor que la pantalla', async () => {
      const pantalla = await report(ADMIN_B, '', orgB);
      const csv = (await http().get(`${api(orgB)}/reports/indicators/export`).set(as(ADMIN_B)).expect(200)).text as string;
      const filas = new Map(csv.split('\r\n').filter((l) => l && !l.startsWith('#')).slice(1).map((l) => {
        const celdas = l.split(',').map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
        return [celdas[0], { status: celdas[4], value: celdas[5] }] as const;
      }));
      expect(filas.get('risk_critical')).toEqual({ status: 'OK', value: '1' });
      expect(filas.get('risk_critical')).toEqual({ status: ind(pantalla, 'risk_critical').status, value: ind(pantalla, 'risk_critical').value });
    });

    it('retirada la adopción, se vuelve a desconocido sin reescribir la evaluación anterior', async () => {
      await http().post(`${api(orgB)}/risk/rule-sets/adoptions`).set(as(ADMIN_B))
        .send({ operation_id: randomUUID(), rule_set_version: '1.0.0', decision: 'WITHDRAW', reason: 'Fin del ensayo local' }).expect(201);
      // Lo ya escrito se conserva: la severidad histórica sigue en la fila.
      const guardadas = (await sql<{ severity: string }>`SELECT severity FROM risk_evaluations WHERE organization_id = ${orgB} ORDER BY evaluation_number DESC LIMIT 1`.execute(h.db)).rows[0];
      expect(guardadas.severity).toBe('CRITICAL');
      // Pero una evaluación nueva ya no clasifica, y el reporte lo dice sin fingir que no hay críticos.
      await http().post(`${api(orgB)}/risk/lots/${loteB}/evaluations`).set(as(ADMIN_B)).send({ operation_id: randomUUID() }).expect(201);
      const i = ind(await report(ADMIN_B, '', orgB), 'risk_critical');
      expect(i).toMatchObject({ status: 'UNKNOWN', value: null });
      expect(i.reason).toMatch(/NO lo ha adoptado/);
    });
  });
});
