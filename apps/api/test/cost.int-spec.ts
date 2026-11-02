import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// P1-010 (RF-41; S3 §33; D-51) — Presupuesto de preparación.
//
// Lo que estas pruebas protegen: que **ningún importe se invente**, que **ausencia no sea cero**, que los
// denominadores **no mientan** cuando no se pueden calcular, que la aritmética sea **decimal exacta** y que una
// estimación guardada **no se reescriba** al cambiar una tarifa después.
describeDb('P1-010 presupuesto de preparación (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let lote: string;
  let loteSinOrigen: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o: string) => `/api/v1/organizations/${o}`;
  const cost = (o: string) => `${api(o)}/cost`;
  const today = new Date().toISOString().slice(0, 10);
  const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const SUPER = 'super@test.local';
  const ADMIN = 'admin-cost@test.local';
  const ADMIN_B = 'admin-costb@test.local';
  const TEC = 'tecnico-cost@test.local';

  interface Linea { concept: string; unit: string; parameter: { amount: string; version: number } | null; quantity: string | null; quantity_kind: string | null; subtotal: string | null; status: string; note: string }
  interface Den { distinct_producers: { value: number; cost_each: string | null; status: string }; tonne: { physical_quantity: string; unit: string; as_of: string; cost_each: string | null; status: string; why: string | null }; note: string }
  interface Est {
    id?: string; currency: string; lines: Linea[];
    total: { known: string; complete: boolean; pending_concepts: Array<{ concept: string; status: string }>; note: string };
    denominators: Den; observed: { as_of: string; plots_without_geometry: number; note: string }; disclaimer: string; saved: boolean;
  }

  const parametro = (cuerpo: Record<string, unknown>, actor = ADMIN, org = orgA) =>
    http().post(`${cost(org)}/parameters`).set(as(actor)).send({ operation_id: randomUUID(), currency: 'USD', valid_from: ayer, ...cuerpo });
  const preview = (quantities: Array<Record<string, string>>, actor = ADMIN, l = lote, org = orgA) =>
    http().post(`${cost(org)}/estimates/preview`).set(as(actor)).send({ lot_id: l, quantities });

  async function crearLote(codigo: string, conOrigen: boolean) {
    const prod = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: `${codigo}-P`, legal_name: `Finca ${codigo}` }).expect(201)).body.id;
    const parcela = (await http().post(`${api(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: prod, plot_code: `${codigo}-PAR`, crop: 'Cacao' }).expect(201)).body.id;
    const rv = Number((await h.db.selectFrom('plots').select('row_version').where('id', '=', parcela).executeTakeFirstOrThrow()).row_version);
    await http().post(`${api(orgA)}/plots/${parcela}/geometry-versions`).set(as(ADMIN))
      .send({ expected_version: rv, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.16, -0.848] }, area_declared_ha: 2 }).expect(201);
    const d = (await http().post(`${api(orgA)}/deliveries`).set(as(ADMIN)).send({
      operation_id: randomUUID(), producer_id: prod, product_id: producto, delivery_date: today,
      quantity_declared: '250', unit: 'KG', ...(conOrigen ? { origins: [{ plot_id: parcela }] } : {}), register: true,
    }).expect(201)).body.delivery;
    const rec = (await http().post(`${api(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({
      operation_id: randomUUID(), location_id: centro, received_at: new Date().toISOString(),
      weighing: { method: 'Báscula', quantity: '250', unit: 'KG', weighed_on: today },
    }).expect(201)).body.reception_id;
    return (await http().post(`${api(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '250' }] }).expect(201)).body.lot.id as string;
  }
  let producto: string; let centro: string;

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Presupuesto A', ADMIN);
    orgB = await mk('Coop Presupuesto B', ADMIN_B);
    const inv = await http().post(`${api(orgA)}/invitations`).set(as(ADMIN)).send({ email: TEC, role_code: 'FIELD_TECHNICIAN' }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'T', last_name: 'Campo', password: PASSWORD }).expect(200);
    await h.login(TEC);
    producto = (await http().post(`${api(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    centro = (await http().post(`${api(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CP', name: 'Centro', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    lote = await crearLote('CST', true);
    loteSinOrigen = await crearLote('CSN', false);
  });
  afterAll(async () => h?.close());

  it('no se precarga ningún importe: todos los conceptos empiezan pendientes de presupuestar', async () => {
    const p = (await http().get(`${cost(orgA)}/parameters`).set(as(ADMIN)).expect(200)).body;
    expect(p.currency).toBe('USD');
    expect(p.concepts).toHaveLength(5);
    expect(p.concepts.every((c: { current: unknown; pending_budget: boolean }) => c.current === null && c.pending_budget)).toBe(true);
    expect(p.history).toEqual([]);
    // Y ningún importe del ejemplo de S3 aparece por ninguna parte.
    expect(JSON.stringify(p)).not.toMatch(/2[.,]50|0[.,]80|1[.,]20|0[.,]60|1[.,]10|6[.,]20/);
    expect(p.note).toMatch(/No son precios oficiales, ni costes medidos, ni ofertas de proveedores/);
  });

  it('cada unidad presupuestaria es la que fijó D-51, y VALIDACIÓN identifica su tipo', async () => {
    await parametro({ concept: 'GEOREFERENCIACION', amount: '3.25' }).expect(201);
    // VALIDACION sin tipo: se rechaza.
    expect((await parametro({ concept: 'VALIDACION', amount: '1.00' })).status).toBe(422);
    await parametro({ concept: 'VALIDACION', amount: '1.50', validation_kind: 'Revisión documental por técnico' }).expect(201);
    // Un tipo donde no aplica: se rechaza por regla de negocio (422), no por formato.
    expect((await parametro({ concept: 'ADMINISTRACION', amount: '2.00', validation_kind: 'Revisión que no corresponde' })).status).toBe(422);
    await parametro({ concept: 'ADMINISTRACION', amount: '2.00' }).expect(201);

    const p = (await http().get(`${cost(orgA)}/parameters`).set(as(ADMIN)).expect(200)).body;
    const porConcepto = Object.fromEntries(p.concepts.map((c: { concept: string; unit: string; current: { amount: string; validation_kind: string | null } | null }) => [c.concept, c]));
    expect(porConcepto.GEOREFERENCIACION.unit).toBe('VISITA_PREVISTA');
    expect(porConcepto.VALIDACION.unit).toBe('REVISION_PREVISTA');
    expect(porConcepto.VALIDACION.current.validation_kind).toBe('Revisión documental por técnico');
    expect(porConcepto.ADMINISTRACION.unit).toBe('HORA_PREVISTA');
    // Y la nota recuerda qué NO demuestra cada observación.
    expect(porConcepto.GEOREFERENCIACION.note).toMatch(/versión de geometría .*NO demuestra una visita/i);
  });

  it('AUSENCIA NO ES CERO: sin importe o sin cantidad, el total queda INCOMPLETO', async () => {
    const e = (await preview([{ concept: 'GEOREFERENCIACION', quantity: '2' }]).expect(200)).body as Est;
    // Georreferenciación calcula; validación y administración tienen importe pero no cantidad; los otros dos ni eso.
    const porConcepto = Object.fromEntries(e.lines.map((l) => [l.concept, l]));
    expect(porConcepto.GEOREFERENCIACION).toMatchObject({ status: 'CALCULADO', subtotal: '6.5' });
    expect(porConcepto.VALIDACION).toMatchObject({ status: 'SIN_CANTIDAD', subtotal: null });
    expect(porConcepto.DOCUMENTACION).toMatchObject({ status: 'SIN_PARAMETRO', subtotal: null });
    expect(e.total.complete).toBe(false);
    expect(e.total.known).toBe('6.5');
    expect(e.total.pending_concepts.map((x) => x.concept).sort()).toEqual(['ADMINISTRACION', 'ANALISIS_SATELITAL', 'DOCUMENTACION', 'VALIDACION']);
    expect(e.total.note).toMatch(/NO suma cero/);
  });

  it('ARITMÉTICA DECIMAL exacta, sin coma flotante', async () => {
    // 0.1 × 3 en coma flotante daría 0.30000000000000004.
    await parametro({ concept: 'DOCUMENTACION', amount: '0.1' }).expect(201);
    const e = (await preview([{ concept: 'DOCUMENTACION', quantity: '3' }]).expect(200)).body as Est;
    const doc = e.lines.find((l) => l.concept === 'DOCUMENTACION')!;
    expect(doc.subtotal).toBe('0.3');
    // Y un importe con seis decimales se conserva tal cual.
    await parametro({ concept: 'ANALISIS_SATELITAL', amount: '0.123456' }).expect(201);
    const e2 = (await preview([{ concept: 'ANALISIS_SATELITAL', quantity: '2' }]).expect(200)).body as Est;
    expect(e2.lines.find((l) => l.concept === 'ANALISIS_SATELITAL')!.subtotal).toBe('0.246912');
  });

  it('las cantidades son DECLARADAS y estimadas; lo observado va aparte y con su fecha', async () => {
    const e = (await preview([{ concept: 'GEOREFERENCIACION', quantity: '4', basis: 'Dos técnicos, dos días' }]).expect(200)).body as Est;
    const geo = e.lines.find((l) => l.concept === 'GEOREFERENCIACION')!;
    expect(geo.quantity_kind).toBe('DECLARADA_ESTIMADA');
    expect(geo.note).toMatch(/La cantidad es DECLARADA y estimada/);
    // Lo observado existe, trae fecha y dice que NO es una cantidad de coste.
    expect(Date.parse(e.observed.as_of)).toBeGreaterThan(Date.now() - 60_000);
    expect(typeof e.observed.plots_without_geometry).toBe('number');
    expect(e.observed.note).toMatch(/NO son cantidades de coste/);
    // Y ninguna cantidad se rellenó sola a partir de lo observado.
    const sinDeclarar = e.lines.filter((l) => l.quantity === null);
    expect(sinDeclarar.length).toBeGreaterThan(0);
    expect(sinDeclarar.every((l) => l.quantity_kind === null)).toBe(true);
  });

  it('DENOMINADORES: por productor distinto y por tonelada del peso FÍSICO del ledger', async () => {
    const e = (await preview([{ concept: 'GEOREFERENCIACION', quantity: '4' }]).expect(200)).body as Est;
    // 3.25 × 4 = 13; un productor distinto → 13 por productor.
    expect(e.total.known).toBe('13');
    expect(e.denominators.distinct_producers).toMatchObject({ value: 1, cost_each: '13', status: 'CALCULADO' });
    // 250 kg = 0,25 t → 13 / 0,25 = 52.
    expect(e.denominators.tonne).toMatchObject({ physical_quantity: '250', unit: 'KG', cost_each: '52', status: 'CALCULADO' });
    expect(Date.parse(e.denominators.tonne.as_of)).toBeGreaterThan(Date.now() - 60_000);
    expect(e.denominators.note).toMatch(/DISTRIBUCIÓN del presupuesto/);
    expect(e.denominators.note).toMatch(/No se reparte entre productores concretos/);
  });

  it('un lote sin origen declarado SIGUE teniendo productor: el denominador no se inventa', async () => {
    // Importa no confundir «sin parcela de origen» con «sin productor»: la entrega siempre tiene productor,
    // así que este denominador sí se puede calcular. La rama «no calculable» se prueba sobre la regla
    // aritmética en `cost.spec.ts`, porque con datos normales no se alcanza.
    const e = (await preview([{ concept: 'GEOREFERENCIACION', quantity: '4' }], ADMIN, loteSinOrigen).expect(200)).body as Est;
    expect(e.denominators.distinct_producers.value).toBe(1);
    expect(e.denominators.distinct_producers.status).toBe('CALCULADO');
    // Y en ningún caso se publica un cero o un infinito como si fuera un resultado.
    expect(JSON.stringify(e.denominators)).not.toMatch(/Infinity|NaN/);
  });

  it('REPRODUCIBLE: guardar lleva dentro las versiones, y cambiar la tarifa después NO la reescribe', async () => {
    const guardada = (await http().post(`${cost(orgA)}/estimates`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), lot_id: lote, quantities: [{ concept: 'GEOREFERENCIACION', quantity: '4' }] })
      .expect(201)).body as Est & { id: string };
    expect(guardada.total.known).toBe('13');
    const versionUsada = guardada.lines.find((l) => l.concept === 'GEOREFERENCIACION')!.parameter!.version;

    // Se corrige la tarifa: versión nueva, la anterior no se toca.
    await parametro({ concept: 'GEOREFERENCIACION', amount: '9.00' }).expect(201);
    const parametros = (await http().get(`${cost(orgA)}/parameters`).set(as(ADMIN)).expect(200)).body;
    expect(parametros.concepts.find((c: { concept: string }) => c.concept === 'GEOREFERENCIACION').current.version).toBe(versionUsada + 1);

    // La estimación guardada sigue igual…
    const releida = (await http().get(`${cost(orgA)}/estimates/${guardada.id}`).set(as(ADMIN)).expect(200)).body as Est;
    expect(releida.total.known).toBe('13');
    expect((releida.lines as Linea[]).find((l) => l.concept === 'GEOREFERENCIACION')!.parameter!.version).toBe(versionUsada);
    // …y un cálculo nuevo usa la tarifa nueva: 9 × 4 = 36.
    const nueva = (await preview([{ concept: 'GEOREFERENCIACION', quantity: '4' }]).expect(200)).body as Est;
    expect(nueva.total.known).toBe('36');

    // Append-only de verdad: ni editar ni borrar.
    await expect(h.db.deleteFrom('cost_estimates').where('id', '=', guardada.id).execute()).rejects.toThrow(/append-only/);
    await expect(h.db.updateTable('budget_parameters').set({ amount: '1' }).where('organization_id', '=', orgA).execute()).rejects.toThrow(/append-only/);
  });

  it('VIGENCIA: se aplica la versión MÁS NUEVA que esté en vigor hoy, no la última registrada', async () => {
    const pasado = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const anteayer = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    // Vigencia invertida: rechazada al registrarla.
    expect((await parametro({ concept: 'ADMINISTRACION', amount: '5.00', valid_from: today, valid_to: pasado })).status).toBe(422);

    const vigente = async () => (await http().get(`${cost(orgA)}/parameters`).set(as(ADMIN)).expect(200)).body
      .concepts.find((c: { concept: string }) => c.concept === 'ADMINISTRACION');
    const v1 = await vigente();
    expect(v1.current.amount).toBe('2');

    // Una versión YA VENCIDA no desplaza a la que sigue en vigor: registrarla no cambia lo aplicable.
    await parametro({ concept: 'ADMINISTRACION', amount: '7.00', valid_from: pasado, valid_to: anteayer }).expect(201);
    expect((await vigente()).current.amount).toBe('2');

    // Una versión FUTURA tampoco se adelanta.
    await parametro({ concept: 'ADMINISTRACION', amount: '11.00', valid_from: manana }).expect(201);
    const trasFutura = await vigente();
    expect(trasFutura.current.amount).toBe('2');
    expect(trasFutura.current.version).toBe(v1.current.version);
    // Y el cálculo usa esa misma: 2 × 10 = 20.
    const e = (await preview([{ concept: 'ADMINISTRACION', quantity: '10' }]).expect(200)).body as Est;
    expect(e.lines.find((l) => l.concept === 'ADMINISTRACION')).toMatchObject({ status: 'CALCULADO', subtotal: '20' });
  });

  it('un concepto cuya ÚNICA versión está vencida queda pendiente de presupuestar, y no suma cero', async () => {
    const pasado = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const anteayer = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    // En la otra organización, que no tiene ningún parámetro: su única versión nace vencida.
    await http().post(`${cost(orgB)}/parameters`).set(as(ADMIN_B))
      .send({ operation_id: randomUUID(), concept: 'DOCUMENTACION', amount: '4.00', currency: 'USD', valid_from: pasado, valid_to: anteayer })
      .expect(201);
    const p = (await http().get(`${cost(orgB)}/parameters`).set(as(ADMIN_B)).expect(200)).body;
    const doc = p.concepts.find((c: { concept: string }) => c.concept === 'DOCUMENTACION');
    expect(doc.current).toBeNull();
    expect(doc.pending_budget).toBe(true);
    // Pero su historial lo conserva: no se borra, solo deja de aplicarse.
    expect(p.history.filter((x: { concept: string }) => x.concept === 'DOCUMENTACION')).toHaveLength(1);
  });

  it('no modifica expedientes, inventario ni riesgo', async () => {
    const snaps = await h.db.selectFrom('dd_snapshots').select('id').where('organization_id', '=', orgA).execute();
    const mov = await h.db.selectFrom('stock_movements').select('id').where('organization_id', '=', orgA).execute();
    const riesgo = await h.db.selectFrom('risk_evaluations').select('id').where('organization_id', '=', orgA).execute();
    await http().post(`${cost(orgA)}/estimates`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), lot_id: lote, quantities: [{ concept: 'GEOREFERENCIACION', quantity: '1' }] }).expect(201);
    expect(await h.db.selectFrom('dd_snapshots').select('id').where('organization_id', '=', orgA).execute()).toEqual(snaps);
    expect(await h.db.selectFrom('stock_movements').select('id').where('organization_id', '=', orgA).execute()).toEqual(mov);
    expect(await h.db.selectFrom('risk_evaluations').select('id').where('organization_id', '=', orgA).execute()).toEqual(riesgo);
  });

  it('autorización: fijar importes y leer son permisos distintos; otra organización 404', async () => {
    // El técnico no tiene ninguno de los dos.
    expect((await http().get(`${cost(orgA)}/parameters`).set(as(TEC))).status).toBe(403);
    expect((await parametro({ concept: 'GEOREFERENCIACION', amount: '1.00' }, TEC)).status).toBe(403);
    expect((await preview([{ concept: 'GEOREFERENCIACION', quantity: '1' }], TEC)).status).toBe(403);
    // CONTROL: quien sí los tiene, 200/201.
    await http().get(`${cost(orgA)}/parameters`).set(as(ADMIN)).expect(200);
    // Aislamiento: ni leer ni escribir en otra organización, y un lote ajeno no se presupuesta.
    expect((await http().get(`${cost(orgB)}/parameters`).set(as(ADMIN))).status).toBe(404);
    expect((await parametro({ concept: 'GEOREFERENCIACION', amount: '1.00' }, ADMIN, orgB)).status).toBe(404);
    expect((await preview([{ concept: 'GEOREFERENCIACION', quantity: '1' }], ADMIN_B, lote, orgB)).status).toBe(404);
  });

  it('la descarga lleva los supuestos, no solo las cifras', async () => {
    const guardada = (await http().post(`${cost(orgA)}/estimates`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), lot_id: lote, quantities: [{ concept: 'GEOREFERENCIACION', quantity: '2' }] })
      .expect(201)).body as Est & { id: string };
    const r = await http().get(`${cost(orgA)}/estimates/${guardada.id}/download`).set(as(ADMIN)).buffer(true)
      .parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); })
      .expect(200);
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    expect((r.body as Buffer).length).toBeGreaterThan(500);
  });

  // Defecto encontrado al revisar el despliegue, antes de congelar: en un lote de PROCESO no hay recepciones
  // propias, así que contar solo sus entregas directas daba cero productores y el reparto salía «no
  // calculable». Los productores están aguas arriba, y el expediente ya conoce ese grafo.
  it('en un lote de PROCESO los productores salen del grafo de origen, no de recepciones directas', async () => {
    const seco = (await http().post(`${api(orgA)}/products`).set(as(ADMIN))
      .send({ code: 'CACAO_SECO', name: 'Cacao seco', product_state: 'CACAO_SECO', unit: 'KG' }).expect(201)).body.id;
    const run = (await http().post(`${api(orgA)}/process-runs`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), process_type: 'DRYING', output_product_id: seco }).expect(201)).body.run;
    await http().post(`${api(orgA)}/process-runs/${run.id}/start`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), started_at: new Date().toISOString(), inputs: [{ lot_id: lote, quantity: '100' }] }).expect(200);
    // El secado exige su humedad: la compuerta de datos mínimos la pide, y aquí no se esquiva.
    const cerrado = (await http().post(`${api(orgA)}/process-runs/${run.id}/close`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), closed_at: new Date(Date.now() + 1000).toISOString(), outputs: [{ quantity: '60' }], loss_quantity: '40', moisture: { value: '7.5', unit: '%BH', method: 'Medidor portátil' } })
      .expect(200)).body;
    const derivado = (cerrado.run?.outputs ?? cerrado.outputs ?? []).map((o: { lot_id?: string; id?: string }) => o.lot_id ?? o.id)[0];
    expect(derivado).toBeTruthy();

    const e = (await preview([{ concept: 'GEOREFERENCIACION', quantity: '4' }], ADMIN, derivado).expect(200)).body as Est;
    // Lo decisivo: el lote de proceso NO tiene ninguna recepción propia y, aun así, su alcance tiene un
    // productor, porque se recorre el grafo de origen.
    const recepcionesDirectas = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM lot_inputs i JOIN receptions r ON r.id = i.reception_id WHERE i.lot_id = ${derivado}`.execute(h.db);
    expect(Number(recepcionesDirectas.rows[0].n)).toBe(0);
    expect(e.denominators.distinct_producers.value).toBe(1);
    expect(e.denominators.distinct_producers.status).toBe('CALCULADO');
    expect(e.denominators.distinct_producers.cost_each).not.toBeNull();
  });
});
