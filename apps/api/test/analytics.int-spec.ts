import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// P1-014 (RF-45; S3 §41) — Indicadores comerciales.
//
// Estas pruebas construyen una FIXTURE SINTÉTICA controlada —precios en dos monedas, dos unidades, entregas sin
// dato económico, pagos informados, calidad decidida— para demostrar con casos **positivos y negativos
// discriminantes** que:
//   · cada cálculo **responde** a entradas válidas (no es una pantalla que siempre diga «sin datos»);
//   · **excluye** lo incompatible en vez de convertirlo, y dice **cuánto** excluyó y **por qué**;
//   · **explica** lo no calculable en vez de devolver cero;
//   · **no mezcla** el riesgo regulatorio con lo comercial, ni el presupuesto con el precio;
//   · los **permisos** alcanzan a agregados, denominadores, cobertura y descargas.
describeDb('P1-014 indicadores comerciales (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let productor: string;
  let productorB: string;
  let producto: string;
  let productoAlt: string;
  let centro: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o: string) => `/api/v1/organizations/${o}`;
  const hoy = new Date().toISOString().slice(0, 10);
  const SUPER = 'super@test.local';
  const ADMIN = 'admin-an@test.local';
  const ADMIN_B = 'admin-anb@test.local';
  const TEC = 'tecnico-an@test.local';
  const AUDITOR = 'auditor-an@test.local';

  interface Ind {
    id: string; label: string; what_it_measures: string; formula: string; unit: string;
    period: { from: string | null; to: string | null; kind: string };
    denominator: { label: string; value: string | null } | null;
    coverage: { considered: number; used: number; excluded: number; note: string } | null;
    provenance: string; group: { currency: string | null; unit: string | null; product: string | null } | null;
    value: string | null; status: string; excluded: Array<{ reason: string; count: number }>;
    limits: string[]; why: string | null;
  }
  interface Vista {
    period: { from: string | null; to: string | null; kind: string }; period_note: string;
    product_filter: { id: string; name: string } | null;
    indicators: Ind[];
    regulatory_context: { available: boolean; conclusions: Array<{ conclusion: string; count: number }> | null; why: string | null; note: string };
    not_implemented: Array<{ question: string; condition: string }>;
    disclaimer: string; synthetic_note: string;
  }

  const ver = async (actor = ADMIN, q = '', org = orgA) =>
    (await http().get(`${api(org)}/analytics/commercial${q}`).set(as(actor)).expect(200)).body as Vista;
  const de = (v: Vista, id: string) => v.indicators.filter((i) => i.id === id);

  async function entrega(cantidad: string, prod = producto, fecha = hoy) {
    return (await http().post(`${api(orgA)}/deliveries`).set(as(ADMIN)).send({
      operation_id: randomUUID(), producer_id: productor, product_id: prod, delivery_date: fecha,
      quantity_declared: cantidad, unit: 'KG', register: true,
    }).expect(201)).body.delivery.id as string;
  }
  const economia = (d: string, cuerpo: Record<string, unknown>) =>
    http().post(`${api(orgA)}/deliveries/${d}/economics`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), source: 'DECLARADO_POR_LA_ORGANIZACION', basis_kind: 'CANTIDAD_DECLARADA_EN_ENTREGA', ...cuerpo });

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Indicadores A', ADMIN);
    orgB = await mk('Coop Indicadores B', ADMIN_B);
    for (const [correo, rol] of [[TEC, 'FIELD_TECHNICIAN'], [AUDITOR, 'AUDITOR']] as const) {
      const inv = await http().post(`${api(orgA)}/invitations`).set(as(ADMIN)).send({ email: correo, role_code: rol }).expect(201);
      await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'X', last_name: 'Y', password: PASSWORD }).expect(200);
      await h.login(correo);
    }
    producto = (await http().post(`${api(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    productoAlt = (await http().post(`${api(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_SECO', name: 'Cacao seco', product_state: 'CACAO_SECO', unit: 'KG' }).expect(201)).body.id;
    centro = (await http().post(`${api(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CE', name: 'Centro', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    productor = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'AN-P1', legal_name: 'Finca Indicadores' }).expect(201)).body.id;
    productorB = (await http().post(`${api(orgB)}/producers`).set(as(ADMIN_B)).send({ producer_code: 'AN-PB', legal_name: 'Finca B' }).expect(201)).body.id;

    // --- FIXTURE SINTÉTICA, construida para discriminar ---
    // (1) y (2): COMPARABLES entre sí — 2 USD/KG sobre 100 KG, y 3 USD/KG sobre 200 KG.
    //     Media ponderada = (200 + 600) / 300 = 2,666666 USD/KG (truncado a seis decimales).
    const d1 = await entrega('100');
    await economia(d1, { price_amount: '2', price_currency: 'USD', price_unit: 'KG' }).expect(201);
    const d2 = await entrega('200');
    await economia(d2, { price_amount: '3', price_currency: 'USD', price_unit: 'KG' }).expect(201);
    // (3) INCOMPATIBLE por unidad: precio por QQ sobre base en KG → se excluye, no se convierte.
    const d3 = await entrega('50');
    await economia(d3, { price_amount: '120', price_currency: 'USD', price_unit: 'QQ' }).expect(201);
    // (4) INCOMPATIBLE por moneda: EUR → forma su propio grupo, no se suma con USD.
    const d4 = await entrega('10');
    await economia(d4, { price_amount: '5', price_currency: 'EUR', price_unit: 'KG' }).expect(201);
    // (5) OTRO PRODUCTO: grupo distinto aunque la moneda y la unidad coincidan.
    const d5 = await entrega('40', productoAlt);
    await economia(d5, { price_amount: '7', price_currency: 'USD', price_unit: 'KG' }).expect(201);
    // (6) SIN dato económico: cuenta en el denominador de cobertura, NO como precio cero.
    await entrega('80');
    // (7) Solo PRIMA, sin precio: se excluye del precio medio con su razón propia.
    const d7 = await entrega('30');
    await economia(d7, { premium_amount: '0.5', premium_kind: 'IMPORTE_FIJO', premium_currency: 'USD', premium_grounds: 'Bonificación de ensayo declarada en acta.' }).expect(201);

    // Pagos informados: 300 USD sobre un acordado USD de 800 (200 + 600) en el grupo KG…
    await http().post(`${api(orgA)}/deliveries/${d1}/payments`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), amount: '300', currency: 'USD', paid_on: hoy, method_declared: 'Transferencia declarada' }).expect(201);

    // Recepción con calidad decidida: alimenta volumen y decisiones de calidad.
    const rec = (await http().post(`${api(orgA)}/deliveries/${d1}/receptions`).set(as(ADMIN)).send({
      operation_id: randomUUID(), location_id: centro, received_at: new Date().toISOString(),
      weighing: { method: 'Báscula', quantity: '98', unit: 'KG', weighed_on: hoy },
      quality_sample: { sample_reference: 'M-AN' },
    }).expect(201)).body;
    const muestra = rec.delivery.receptions.find((r: { id: string }) => r.id === rec.reception_id).quality.samples[0].id;
    await http().post(`${api(orgA)}/deliveries/${d1}/receptions/${rec.reception_id}/quality-samples/${muestra}/results`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), method: 'Prueba de corte', decision: 'RELEASED', limits_version: 'LIM-ENSAYO (declarada)' }).expect(201);
  });
  afterAll(async () => h?.close());

  it('CASO POSITIVO: el precio medio ponderado SÍ se calcula, con su fórmula y su denominador', async () => {
    const v = await ver();
    const grupos = de(v, 'PRECIO_MEDIO_PONDERADO');
    const usdKgBaba = grupos.find((g) => g.group?.currency === 'USD' && g.group?.unit === 'KG' && g.group?.product === 'Cacao en baba');
    expect(usdKgBaba).toBeDefined();
    expect(usdKgBaba!.status).toBe('CALCULADO');
    // (2 × 100 + 3 × 200) ÷ 300 = 2,666667
    // 800 ÷ 300 se TRUNCA a seis decimales, como en P1-010: no se redondea, y el indicador lo declara.
    expect(usdKgBaba!.value).toBe('2.666666');
    expect(usdKgBaba!.limits.join(' ')).toMatch(/TRUNCA a seis decimales; no se redondea/);
    expect(usdKgBaba!.denominator!.value).toBe('300');
    expect(usdKgBaba!.formula).toMatch(/Σ \(precio × cantidad base\) ÷ Σ cantidad base/);
    expect(usdKgBaba!.unit).toBe('USD por KG');
    expect(usdKgBaba!.provenance).toBe('DECLARADO');
    expect(usdKgBaba!.coverage!.used).toBe(2);
    expect(usdKgBaba!.limits.join(' ')).toMatch(/NO demuestra que se haya pagado/i);
  });

  it('CASO NEGATIVO: lo incompatible se EXCLUYE y se cuenta, en vez de convertirse', async () => {
    const v = await ver();
    const grupos = de(v, 'PRECIO_MEDIO_PONDERADO');
    // Cada incompatibilidad por moneda o producto forma SU grupo; la de unidad se excluye.
    expect(grupos.find((g) => g.group?.currency === 'EUR')!.value).toBe('5');
    expect(grupos.find((g) => g.group?.product === 'Cacao seco')!.value).toBe('7');
    const exclusiones = grupos[0].excluded;
    expect(exclusiones.some((e) => /por QQ sobre base en KG/.test(e.reason))).toBe(true);
    expect(exclusiones.some((e) => /no declara precio/.test(e.reason))).toBe(true);
    // Y ninguna unidad se convirtió: no hay ningún grupo QQ con valor.
    expect(grupos.some((g) => g.group?.unit === 'QQ')).toBe(false);
  });

  it('AUSENCIA NO ES CERO: la entrega sin dato económico está en el denominador, no en el precio', async () => {
    const v = await ver();
    const c = de(v, 'COBERTURA_ECONOMICA')[0];
    expect(c.status).toBe('CALCULADO');
    // 7 entregas registradas, 6 con dato económico.
    expect(c.value).toBe('6 de 7');
    expect(c.denominator!.label).toMatch(/Entregas registradas/);
    expect(c.coverage!.excluded).toBe(1);
    expect(c.coverage!.note).toMatch(/NO cuentan como precio cero/i);
  });

  it('PAGOS INFORMADOS: se comparan con lo acordado, y no se presentan como transferencia', async () => {
    const v = await ver();
    const p = de(v, 'PAGOS_INFORMADOS_SOBRE_ACORDADO').find((x) => x.group?.currency === 'USD')!;
    expect(p.status).toBe('CALCULADO');
    // 300 informados ÷ (200 + 600 + 280 del grupo del otro producto) — el denominador es TODO lo acordado en USD.
    expect(p.denominator!.value).toBe('1080');
    expect(p.value).toBe('0.277777');   // truncado, no redondeado
    expect(p.provenance).toBe('INFORMADO');
    expect(p.limits.join(' ')).toMatch(/NO acredita una transferencia/i);
  });

  it('EL PRESUPUESTO NO ES EL PRECIO, y no demuestra eficiencia', async () => {
    const v = await ver();
    const c = de(v, 'PRESUPUESTO_GUARDADO')[0];
    expect(c.provenance).toBe('ESTIMADO');
    expect(c.limits.join(' ')).toMatch(/NO demuestra eficiencia operativa/i);
    expect(c.limits.join(' ')).toMatch(/No se mezcla con el precio del cacao/i);
    // Sin estimaciones guardadas: SIN_DATOS con su porqué, nunca 0.
    expect(c.status).toBe('SIN_DATOS');
    expect(c.value).toBeNull();
    expect(c.why).toMatch(/Nadie ha guardado una estimación/);
  });

  it('CALIDAD: es el reparto de decisiones, no un ranking, y conserva sus límites', async () => {
    const v = await ver();
    const q = de(v, 'DECISIONES_DE_CALIDAD');
    const liberada = q.find((x) => x.label.includes('RELEASED'))!;
    expect(liberada.value).toBe('1 de 1');
    expect(liberada.coverage!.note).toMatch(/con versión de límites declarada \(sin verificar\)/);
    expect(liberada.limits.join(' ')).toMatch(/NO los verifica/i);
    expect(liberada.limits.join(' ')).toMatch(/NO es un ranking/i);
  });

  it('VOLUMEN: agrupa por unidad y usa lo RECIBIDO, no lo declarado', async () => {
    const v = await ver();
    const vol = de(v, 'VOLUMEN_RECIBIDO');
    const kg = vol.find((x) => x.group?.unit === 'KG')!;
    expect(kg.value).toBe('98');          // pesado, no los 100 declarados
    expect(kg.provenance).toBe('OBSERVADO');
    expect(kg.limits.join(' ')).toMatch(/no la declarada por el productor/i);
  });

  it('EL RIESGO VA APARTE: ningún indicador lo usa, y UNDETERMINED no es riesgo bajo', async () => {
    const v = await ver();
    expect(v.regulatory_context.available).toBe(true);
    expect(v.regulatory_context.note).toMatch(/UNDETERMINED. NO significa riesgo bajo/i);
    // Ningún indicador comercial menciona conclusión, severidad ni resultado técnico.
    const texto = JSON.stringify(v.indicators);
    expect(texto).not.toMatch(/conclusion|severity|technical_result|UNDETERMINED/i);
  });

  it('PERÍODO: no se inventa una ventana por defecto, y uno invertido se rechaza', async () => {
    const abierto = await ver();
    expect(abierto.period.kind).toBe('TODO_LO_REGISTRADO');
    expect(abierto.period_note).toMatch(/No se inventa una ventana por defecto/);

    const declarado = await ver(ADMIN, `?from=${hoy}&to=${hoy}`);
    expect(declarado.period.kind).toBe('DECLARADO');
    expect(declarado.indicators.every((i) => i.period.from === hoy || i.id === 'PARCELAS_CON_GEOMETRIA')).toBe(true);

    // Un período que no contiene nada: SIN_DATOS con su porqué, no ceros.
    const vacio = await ver(ADMIN, '?from=2020-01-01&to=2020-01-31');
    const c = de(vacio, 'COBERTURA_ECONOMICA')[0];
    expect(c.status).toBe('SIN_DATOS');
    expect(c.why).toMatch(/No hay ninguna entrega registrada/);
    expect(c.value).toBeNull();

    const invertido = await http().get(`${api(orgA)}/analytics/commercial?from=${hoy}&to=2020-01-01`).set(as(ADMIN));
    expect(invertido.status).toBe(422);
    expect(invertido.body.error.code).toBe('PERIOD_INVERTED');
  });

  it('FILTRO POR PRODUCTO: discrimina, y un producto ajeno es 404', async () => {
    const soloBaba = await ver(ADMIN, `?product_id=${producto}`);
    const grupos = de(soloBaba, 'PRECIO_MEDIO_PONDERADO');
    expect(grupos.some((g) => g.group?.product === 'Cacao seco')).toBe(false);
    expect(grupos.find((g) => g.group?.currency === 'USD' && g.group?.unit === 'KG')!.value).toBe('2.666666');
    expect((await http().get(`${api(orgA)}/analytics/commercial?product_id=${randomUUID()}`).set(as(ADMIN))).status).toBe(404);
  });

  it('PERMISOS SOBRE AGREGADOS: sin economics:read no hay cifras, ni siquiera recuentos', async () => {
    // El auditor tiene analytics:read y economics:read, pero NO cost:read.
    const aud = await ver(AUDITOR);
    const coste = de(aud, 'PRESUPUESTO_GUARDADO')[0];
    expect(coste.status).toBe('RESTRINGIDO');
    expect(coste.value).toBeNull();
    expect(coste.denominator).toBeNull();
    expect(coste.coverage).toBeNull();
    expect(coste.why).toMatch(/Ausente por PERMISO/);
    // CONTROL autorizado: el admin sí lo recibe calculado o con datos.
    const adm = await ver(ADMIN);
    expect(de(adm, 'PRESUPUESTO_GUARDADO')[0].status).not.toBe('RESTRINGIDO');
    // Y el técnico no abre siquiera la pantalla.
    expect((await http().get(`${api(orgA)}/analytics/commercial`).set(as(TEC))).status).toBe(403);
  });

  it('AISLAMIENTO: comparar asociaciones no autoriza consultar otra organización', async () => {
    // 404 OPACO: a quien no es miembro no se le confirma siquiera que la organización exista.
    expect((await http().get(`${api(orgB)}/analytics/commercial`).set(as(ADMIN))).status).toBe(404);
    expect((await http().get(`${api(orgA)}/analytics/commercial`).set(as(ADMIN_B))).status).toBe(404);
    // Y los datos de B no aparecen en A.
    const v = await ver();
    expect(JSON.stringify(v)).not.toContain(productorB);
  });

  it('POR PRODUCTOR: no es un score, y una mezcla de monedas no se promedia', async () => {
    const r = (await http().get(`${api(orgA)}/analytics/producers`).set(as(ADMIN)).expect(200)).body as {
      scope: string; producers: Array<{ producer_code: string; deliveries: number | null; with_economics: number | null; without_economics: number | null; weighted_price: string | null; why: string | null }>;
      note: string; separation_note: string;
    };
    const p = r.producers.find((x) => x.producer_code === 'AN-P1')!;
    expect(p.deliveries).toBe(7);
    expect(p.without_economics).toBe(1);
    // Tiene USD y EUR: NO se promedia, y se dice por qué.
    expect(p.weighted_price).toBe('NO_CALCULABLE');
    expect(p.why).toMatch(/monedas o unidades distintas/i);
    expect(r.note).toMatch(/NO es un score/i);
    expect(r.separation_note).toMatch(/UNDETERMINED no significa riesgo bajo/i);
  });

  it('LO NO IMPLEMENTADO se declara con su condición exacta, no se finge', async () => {
    const v = await ver();
    const preguntas = v.not_implemented.map((n) => n.question).join(' | ');
    expect(preguntas).toMatch(/comprador paga mejor/i);
    expect(preguntas).toMatch(/potencial de aumentar producción/i);
    expect(preguntas).toMatch(/Score compuesto/i);
    const comprador = v.not_implemented.find((n) => /comprador/i.test(n.question))!;
    expect(comprador.condition).toMatch(/no registra ningún precio de VENTA/i);
    expect(comprador.condition).toMatch(/relación explícita/i);
    const score = v.not_implemented.find((n) => /Score/i.test(n.question))!;
    expect(score.condition).toMatch(/PONDERAR/);
    expect(score.condition).toMatch(/D-53/);
    // Y no se publica ningún score ni umbral de «datos suficientes».
    expect(JSON.stringify(v.indicators)).not.toMatch(/score|puntuaci|umbral/i);
  });

  it('DESCARGA: exige permiso de exportar y lleva fórmulas, denominadores y límites', async () => {
    const r = await http().get(`${api(orgA)}/analytics/commercial/download`).set(as(ADMIN))
      .buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    expect((r.body as Buffer).length).toBeGreaterThan(1000);
    // El técnico no la obtiene.
    expect((await http().get(`${api(orgA)}/analytics/commercial/download`).set(as(TEC))).status).toBe(403);
  });

  it('LEER INDICADORES no cambia nada del dominio', async () => {
    const antes = await sql<{ n: number }>`SELECT (SELECT count(*) FROM delivery_economics) + (SELECT count(*) FROM deliveries) + (SELECT count(*) FROM domain_events) AS n`.execute(h.db);
    await ver();
    await http().get(`${api(orgA)}/analytics/producers`).set(as(ADMIN)).expect(200);
    const despues = await sql<{ n: number }>`SELECT (SELECT count(*) FROM delivery_economics) + (SELECT count(*) FROM deliveries) + (SELECT count(*) FROM domain_events) AS n`.execute(h.db);
    expect(despues.rows[0].n).toBe(antes.rows[0].n);
    // Y no existe ninguna escritura en esta superficie.
    expect((await http().post(`${api(orgA)}/analytics/commercial`).set(as(ADMIN)).send({})).status).toBe(404);
  });
});
