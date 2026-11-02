import { randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// P1-004 (RF-35; S3 §16; UX_UI §10.4) — Onboarding y diagnóstico de madurez con EVIDENCIA.
//
// Lo que estas pruebas protegen, por encima de todo: que el diagnóstico **no afirme lo que no ha observado**
// —ni un nivel 0 por falta de datos, ni un umbral que la fuente no fija— y que **no levante compuertas**.
describeDb('P1-004 onboarding y madurez 0–6 (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let vacia: string;
  let orgA: string;
  let producer: string; let product: string; let center: string; let plot: string; let lot: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-on@test.local';
  const ADMIN_V = 'admin-vacia@test.local';
  const TEC = 'tecnico-on@test.local';

  interface Senal { code: string; state: string; evidence: { count: number | null; scope: string; as_of: string | null; note: string }; source: string }
  interface NivelD { level: number; name: string; state: string; why: string; signals: Senal[] }
  interface PasoD { code: string; title: string; state: string; action_href: string | null; evidence: string }
  interface Diag {
    criterion: { id: string; version: string; status: string; note: string; threshold: string };
    level: { reached: number | null; name: string | null; basis: string };
    levels: NivelD[]; steps: PasoD[];
    blockers: { missing_data: Array<{ code: string }>; not_implemented: Array<{ code: string }>; undecided: Array<{ code: string }> };
    scope_of_diagnosis: string;
    freshness: string; disclaimer: string;
  }
  const diag = async (actor: string, org = orgA) => (await http().get(`${api(org)}/onboarding`).set(as(actor)).expect(200)).body as Diag;
  const nivel = (d: Diag, l: number) => d.levels.find((n) => n.level === l)!;
  const senal = (d: Diag, l: number, code: string) => nivel(d, l).signals.find((s) => s.code === code)!;
  const paso = (d: Diag, code: string) => d.steps.find((p) => p.code === code)!;

  async function join(org: string, email: string, role: string, admin: string) {
    const inv = await http().post(`${api(org)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const membershipId = async (email: string, org: string) => (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id')
    .select('m.id').where('u.email', '=', email).where('m.organization_id', '=', org).executeTakeFirstOrThrow()).id;

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_V);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local'))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Madurez', ADMIN);
    vacia = await mk('Coop Recién Creada', ADMIN_V);
    await join(orgA, TEC, 'FIELD_TECHNICIAN', ADMIN);
  });
  afterAll(async () => h?.close());

  it('una organización SIN DATOS no es «nivel 0»: los niveles 0–2 ocurren fuera y no se afirman', async () => {
    const d = await diag(ADMIN_V, vacia);
    expect(d.level.reached).toBeNull();
    expect(d.level.basis).toMatch(/fuera de Terra Link y no se afirman/);
    for (const l of [0, 1, 2]) {
      expect(nivel(d, l).state).toBe('NO_DETERMINABLE');
      expect(nivel(d, l).signals[0].state).toBe('FUERA_DEL_SISTEMA');
    }
    // Y el nivel 3 no se alcanza, diciendo qué dato falta (no un porcentaje).
    expect(nivel(d, 3).state).toBe('NO_ALCANZADO');
    expect(nivel(d, 3).why).toMatch(/Falta dato observable: PRODUCTORES/);
    // Ni una cifra de avance: no hay porcentaje, ni puntuación, ni barra de progreso inventada.
    const texto = JSON.stringify(d);
    expect(texto).not.toMatch(/\d+\s*%/);
    expect(texto).not.toMatch(/"(progress|score|completion|percent)\w*":/i);
  });

  it('el criterio se declara como decisión de producto, con su umbral escrito', async () => {
    const d = await diag(ADMIN_V, vacia);
    expect(d.criterion).toMatchObject({ id: 'D-49', status: 'ADOPTADA', option: 'A' });
    expect(d.criterion.note).toMatch(/no define umbrales/);
    expect(d.criterion.note).toMatch(/decisión PROVISIONAL de producto/);
    expect(d.criterion.threshold).toMatch(/PRESENCIA/);
    // La presencia es una decisión de producto, no «lo único honesto»: unos umbrales acordados valdrían igual.
    expect(d.criterion.threshold).toMatch(/decisión de producto/);
    expect(d.criterion.threshold).toMatch(/serían igual de legítimos si se acordaran y justificaran/);
  });

  it('el nivel 3 se alcanza cuando sus señales se OBSERVAN, y cada una trae su evidencia', async () => {
    const antes = await diag(ADMIN);
    expect(antes.level.reached).toBeNull();

    producer = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'MD-1', legal_name: 'Finca Madurez', assigned_membership_id: await membershipId(TEC, orgA) }).expect(201)).body.id;
    plot = (await http().post(`${api(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: 'MD-1-P', crop: 'Cacao' }).expect(201)).body.id;
    // Con productor pero sin geometría todavía no: la superficie declarada no sería ubicación.
    expect(senal(await diag(ADMIN), 3, 'PARCELAS_CON_GEOMETRIA').state).toBe('NO_OBSERVADA');
    const rv = Number((await h.db.selectFrom('plots').select('row_version').where('id', '=', plot).executeTakeFirstOrThrow()).row_version);
    await http().post(`${api(orgA)}/plots/${plot}/geometry-versions`).set(as(ADMIN))
      .send({ expected_version: rv, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.16, -0.848] }, area_declared_ha: 2 }).expect(201);

    product = (await http().post(`${api(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${api(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CM', name: 'Centro', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    const d = (await http().post(`${api(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: product, delivery_date: today, quantity_declared: '100', unit: 'KG', origins: [{ plot_id: plot }], register: true }).expect(201)).body.delivery;
    const rec = (await http().post(`${api(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'Báscula', quantity: '100', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    lot = (await http().post(`${api(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '100' }] }).expect(201)).body.lot.id;

    const d3 = await diag(ADMIN);
    expect(nivel(d3, 3).state).toBe('ALCANZADO');
    expect(d3.level).toMatchObject({ reached: 3, name: 'Trazabilidad digital' });
    // Cada señal trae su evidencia y su fuente; ninguna es una autodeclaración.
    for (const s of nivel(d3, 3).signals) {
      expect(s.state).toBe('OBSERVADA');
      expect(s.evidence.count).toBeGreaterThan(0);
      expect(s.source).toMatch(/S3 §16/);
    }
    expect(senal(d3, 3, 'PARCELAS_CON_GEOMETRIA').evidence.as_of).not.toBeNull();
  });

  it('el nivel 4 NO se alcanza sin riesgo, y dice qué falta sin inventar un umbral', async () => {
    const d = await diag(ADMIN);
    expect(nivel(d, 4).state).toBe('NO_ALCANZADO');
    expect(nivel(d, 4).why).toMatch(/Falta dato observable: CATALOGO_DE_RIESGO, EVALUACIONES_DE_RIESGO/);
    expect(d.blockers.missing_data.map((b) => b.code)).toEqual(expect.arrayContaining(['CATALOGO_DE_RIESGO']));
    // El resultado de una evaluación no forma parte de la madurez: se dice explícitamente.
    expect(senal(d, 4, 'EVALUACIONES_DE_RIESGO').evidence.note).toMatch(/con hallazgos cuenta igual/);
  });

  it('distingue DATO FALTANTE, CAPACIDAD NO IMPLEMENTADA y DECISIÓN PENDIENTE', async () => {
    const d = await diag(ADMIN);
    // Decisión pendiente: READY está bloqueado por decisiones, no por un dato sin cargar.
    expect(senal(d, 5, 'INSTANTANEA_READY').state).toBe('SIN_DECIDIR');
    expect(senal(d, 5, 'INSTANTANEA_READY').evidence.note).toMatch(/decisión pendiente, no un dato que falte/);
    expect(d.blockers.undecided.map((b) => b.code)).toContain('INSTANTANEA_READY');
    expect(d.blockers.missing_data.map((b) => b.code)).not.toContain('INSTANTANEA_READY');
    // Capacidad no implementada: el nivel 6 no es un pendiente de la organización.
    expect(nivel(d, 6).state).toBe('NO_IMPLEMENTADO');
    expect(d.blockers.not_implemented.map((b) => b.code)).toEqual(['ANALITICA_COMERCIAL']);
    expect(senal(d, 6, 'ANALITICA_COMERCIAL').evidence.note).toMatch(/no es un dato que falte: es una capacidad que no existe/i);
  });

  it('la madurez NO acredita conformidad ni levanta compuertas', async () => {
    const d = await diag(ADMIN);
    expect(d.level.reached).toBe(3);
    expect(d.disclaimer).toMatch(/NO acredita conformidad jurídica/);
    expect(d.disclaimer).toMatch(/NO levanta ninguna compuerta/);
    // Y de hecho no las toca: ninguna instantánea READY ni conclusión distinta de UNDETERMINED.
    const ready = await h.db.selectFrom('dd_snapshots').select('readiness').where('organization_id', '=', orgA).execute();
    expect(ready.filter((r) => r.readiness === 'READY')).toEqual([]);
    const conc = await h.db.selectFrom('risk_evaluations').select('conclusion').where('organization_id', '=', orgA).execute();
    expect(conc.every((c) => c.conclusion === 'UNDETERMINED')).toBe(true);
    // El perfil jurídico sigue siendo una revisión pendiente, no algo que la madurez sustituya.
    expect(senal(d, 5, 'PERFIL_JURIDICO').evidence.note).toMatch(/la madurez no sustituye esa revisión/i);
  });

  it('alcance y permisos: el detalle se acota; sin permiso no se entrega número; otra organización 404', async () => {
    const t = await diag(TEC);
    // El diagnóstico es EL DE SU ALCANCE: el estado se evalúa sobre lo que puede leer, y se dice.
    const prod = senal(t, 3, 'PRODUCTORES');
    expect(prod.evidence.scope).toBe('ASIGNADOS');
    expect(prod.evidence.note).toMatch(/Se cuenta SOLO lo que tienes asignado/);
    expect(prod.state).toBe(prod.evidence.count! > 0 ? 'OBSERVADA' : 'NO_OBSERVADA');
    // Riesgo: no lo lee, así que la señal es RESTRINGIDA y no se afirma nada —ni que no hay—.
    const riesgo = senal(t, 4, 'CATALOGO_DE_RIESGO');
    expect(riesgo.state).toBe('RESTRINGIDA');
    expect(riesgo.evidence).toMatchObject({ count: null, scope: 'RESTRINGIDO', as_of: null });
    expect(riesgo.evidence.note).toMatch(/ni cuántos hay, ni si los hay/i);
    // Y el nivel que depende de ellas no se declara «no alcanzado», sino NO DETERMINABLE con su alcance.
    expect(nivel(t, 4).state).toBe('NO_DETERMINABLE');
    expect(nivel(t, 4).why).toMatch(/no puede leer las señales de este nivel/i);
    // El onboarding no abre módulos: sin permiso, el paso no ofrece enlace.
    expect(paso(t, 'EQUIPO')).toMatchObject({ state: 'RESTRINGIDO', action_href: null });
    expect(paso(t, 'PARCELAS').action_href).toContain('/parcelas');
    // Y nada de otra organización.
    await http().get(`${api(vacia)}/onboarding`).set(as(ADMIN)).expect(404);
  });

  it('el asistente muestra pasos REALES, la acción los resuelve y retirar el dato los devuelve', async () => {
    // Solo lectura: no hay forma de marcar un paso como hecho.
    await http().post(`${api(orgA)}/onboarding`).set(as(ADMIN)).send({}).expect(404);
    await http().patch(`${api(orgA)}/onboarding`).set(as(ADMIN)).send({}).expect(404);

    expect(paso(await diag(ADMIN), 'CATALOGOS')).toMatchObject({ state: 'HECHO' });
    // La importación es un atajo, no una obligación: se muestra como OPCIONAL, no como falta.
    expect(paso(await diag(ADMIN), 'IMPORTACION').state).toBe('OPCIONAL');

    // No hay marca guardada: desactivar el único producto devuelve el paso a PENDIENTE, y el nivel 3 cae.
    const rv = (await http().get(`${api(orgA)}/products/${product}`).set(as(ADMIN)).expect(200)).body.row_version;
    await http().post(`${api(orgA)}/products/${product}/deactivate`).set(as(ADMIN))
      .send({ expected_version: rv, reason: 'Prueba de que el diagnóstico sigue al dato' }).expect(200);
    const caido = await diag(ADMIN);
    expect(paso(caido, 'CATALOGOS').state).toBe('PENDIENTE');
    expect(caido.freshness).toMatch(/no hay marcas guardadas/);

    // Y al reactivarlo vuelve, sin intervención manual sobre ningún registro de progreso.
    const rv2 = (await http().get(`${api(orgA)}/products/${product}`).set(as(ADMIN)).expect(200)).body.row_version;
    await http().post(`${api(orgA)}/products/${product}/activate`).set(as(ADMIN))
      .send({ expected_version: rv2, reason: 'Se restituye el producto' }).expect(200);
    expect(paso(await diag(ADMIN), 'CATALOGOS').state).toBe('HECHO');
  });

  // Procedencia y VIGENCIA: la adopción del catálogo es append-only (ADOPT/WITHDRAW son filas). Retirarla
  // tiene que BAJAR el nivel, y la evidencia histórica no puede borrarse por ello.
  it('la vigencia manda: adoptar el catálogo sube al nivel 4 y RETIRARLO lo baja, sin borrar el histórico', async () => {
    await http().post(`${api(orgA)}/risk/rule-sets/adoptions`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), rule_set_version: '1.0.0', decision: 'ADOPT', reason: 'Adopción para el diagnóstico de madurez' }).expect(201);
    await http().post(`${api(orgA)}/risk/lots/${lot}/evaluations`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201);

    const subido = await diag(ADMIN);
    expect(nivel(subido, 4).state).toBe('ALCANZADO');
    expect(subido.level.reached).toBe(4);
    expect(senal(subido, 4, 'CATALOGO_DE_RIESGO').evidence.count).toBe(1);
    expect(senal(subido, 4, 'EVALUACIONES_DE_RIESGO').evidence.as_of).not.toBeNull();

    // Retirar la adopción: deja de haber reglas vigentes, aunque la fila del ADOPT siga en la base.
    await http().post(`${api(orgA)}/risk/rule-sets/adoptions`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), rule_set_version: '1.0.0', decision: 'WITHDRAW', reason: 'Se retira para comprobar la vigencia' }).expect(201);

    const bajado = await diag(ADMIN);
    expect(senal(bajado, 4, 'CATALOGO_DE_RIESGO')).toMatchObject({ state: 'NO_OBSERVADA' });
    expect(senal(bajado, 4, 'CATALOGO_DE_RIESGO').evidence.count).toBe(0);
    expect(nivel(bajado, 4).state).toBe('NO_ALCANZADO');
    expect(bajado.level.reached).toBe(3);
    // La evaluación ya hecha sigue siendo un hecho observado: retirar la adopción no reescribe el histórico.
    expect(senal(bajado, 4, 'EVALUACIONES_DE_RIESGO').state).toBe('OBSERVADA');
    const filas = await h.db.selectFrom('risk_rule_set_adoptions').select('decision').where('organization_id', '=', orgA).execute();
    expect(filas.map((f) => f.decision).sort()).toEqual(['ADOPT', 'WITHDRAW']);
  });

  // Un enlace del asistente que no existe convierte el paso en un callejón sin salida. Se fija la lista para
  // que cambiarla sea deliberado; la comprobación de que cada destino ABRE de verdad está en
  // `e2e/review/puesta-en-marcha.mjs`, que los recorre en el navegador.
  it('cada paso enlaza a una pantalla del producto, y la lista está fijada', async () => {
    const d = await diag(ADMIN);
    const destinos = Object.fromEntries(d.steps.map((p) => [p.code, p.action_href?.replace(`${api(orgA).replace('/api/v1/organizations', '/organizaciones')}`, '') ?? null]));
    expect(destinos).toEqual({
      ORGANIZACION: '', EQUIPO: '/miembros', CATALOGOS: '/productos', CENTROS: '/centros',
      PRODUCTORES: '/productores', PARCELAS: '/parcelas', IMPORTACION: '/importaciones', REVISION: '',
    });
  });

  // AUTORIZACIÓN — el nivel y los estados agregados también informan, aunque el recuento se oculte. Cambiar
  // SOLO datos fuera del alcance de una persona no puede cambiar lo que esa persona ve.
  it('cambiar datos FUERA del alcance no altera el diagnóstico de quien no los puede leer', async () => {
    const antes = await diag(TEC);

    // Productor y parcela de OTRO responsable: el técnico no los lee ni los verá nunca.
    const ajeno = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN))
      .send({ producer_code: 'MD-AJENO', legal_name: 'Finca ajena al técnico' }).expect(201)).body.id;
    const parcelaAjena = (await http().post(`${api(orgA)}/plots`).set(as(ADMIN))
      .send({ producer_id: ajeno, plot_code: 'MD-AJENO-P', crop: 'Cacao' }).expect(201)).body.id;
    const rv = Number((await h.db.selectFrom('plots').select('row_version').where('id', '=', parcelaAjena).executeTakeFirstOrThrow()).row_version);
    await http().post(`${api(orgA)}/plots/${parcelaAjena}/geometry-versions`).set(as(ADMIN))
      .send({ expected_version: rv, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.17, -0.849] } }).expect(201);

    const despues = await diag(TEC);
    // CONTROL: quien SÍ los lee ve el cambio, así que un «no cambió» no significa «no pasó nada».
    const admin = await diag(ADMIN);
    expect(senal(admin, 3, 'PRODUCTORES').evidence.count).toBeGreaterThan(senal(antes, 3, 'PRODUCTORES').evidence.count!);

    // Para el técnico, nada de lo suyo cambia: ni recuentos, ni estados, ni nivel.
    expect(senal(despues, 3, 'PRODUCTORES').evidence.count).toBe(senal(antes, 3, 'PRODUCTORES').evidence.count);
    expect(senal(despues, 3, 'PARCELAS_CON_GEOMETRIA').evidence.count).toBe(senal(antes, 3, 'PARCELAS_CON_GEOMETRIA').evidence.count);
    for (const l of [3, 4, 5, 6]) expect(nivel(despues, l).state).toBe(nivel(antes, l).state);
    expect(despues.level.reached).toBe(antes.level.reached);
    expect(JSON.stringify(despues.levels)).toEqual(JSON.stringify(antes.levels));
  });

  it('el diagnóstico declara DE QUÉ es: de la organización o del alcance de quien lo lee', async () => {
    const a = await diag(ADMIN);
    const t = await diag(TEC);
    expect(a.scope_of_diagnosis).toBe('ORGANIZACION');
    expect(t.scope_of_diagnosis).toBe('MI_ALCANCE');
    expect(t.level.basis).toMatch(/tu alcance/i);
  });
});
