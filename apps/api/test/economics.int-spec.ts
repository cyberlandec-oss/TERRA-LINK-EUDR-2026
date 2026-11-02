import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// P1-012 (RF-43; S3 §32) — Precio, prima y pagos informados.
//
// Lo que estas pruebas protegen:
//   · que **una prima ausente no sea cero**, y que **declarar cero** sea algo distinto de no declarar;
//   · que **una prima no se deduzca** de nada: sin fundamento declarado, no se registra;
//   · que **no se conviertan unidades ni monedas en silencio**;
//   · que **un precio registrado no se presente como pago**, y que informar un pago **no mueva dinero**;
//   · que corregir **conserve el historial** y que dos correcciones simultáneas **no se pisen**;
//   · que el dinero **no se filtre** al paquete de debida diligencia ni a quien solo lee entregas.
describeDb('P1-012 precio, prima y pagos informados (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let entrega: string;
  let entregaB: string;
  let productor: string;
  let producto: string;
  let centro: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o: string) => `/api/v1/organizations/${o}`;
  const eco = (d = entrega, o = orgA) => `${api(o)}/deliveries/${d}/economics`;
  const hoy = new Date().toISOString().slice(0, 10);
  const SUPER = 'super@test.local';
  const ADMIN = 'admin-eco@test.local';
  const ADMIN_B = 'admin-ecob@test.local';
  const TEC = 'tecnico-eco@test.local';
  const AUDITOR = 'auditor-eco@test.local';

  interface Calc { currency: string | null; amount: string; premium: string | null; premium_status: string; premium_note: string; total: string; complete: boolean; reasons: string[]; note: string }
  interface Version { record_number: number; reason: string | null; price: { amount: string; currency: string; per_unit: string } | null; basis: { kind: string; quantity: string | null; unit: string | null }; premium: { amount: string; kind: string; grounds: string } | null; computed: Calc; provenance: { source: string; note: string | null; agreed_on: string | null }; author: string }
  interface Vista {
    delivery: { code: string; quantity_declared: string | null; unit: string | null };
    current: Version | null; history: Version[];
    payments: { items: Array<{ payment_number: number; amount: string; currency: string; superseded: boolean; reason: string | null }>; informed_total: string; currency: string | null; currencies_note: string | null; note: string };
    state: string; note: string; not_the_same: string;
  }

  const registrar = (cuerpo: Record<string, unknown>, actor = ADMIN, d = entrega, o = orgA) =>
    http().post(eco(d, o)).set(as(actor)).send({ operation_id: randomUUID(), source: 'DECLARADO_POR_LA_ORGANIZACION', basis_kind: 'CANTIDAD_DECLARADA_EN_ENTREGA', ...cuerpo });
  const corregir = (cuerpo: Record<string, unknown>, actor = ADMIN, d = entrega, o = orgA) =>
    http().post(`${eco(d, o)}/corrections`).set(as(actor)).send({ operation_id: randomUUID(), source: 'DECLARADO_POR_LA_ORGANIZACION', basis_kind: 'CANTIDAD_DECLARADA_EN_ENTREGA', ...cuerpo });
  const pagar = (cuerpo: Record<string, unknown>, actor = ADMIN, d = entrega, o = orgA) =>
    http().post(`${api(o)}/deliveries/${d}/payments`).set(as(actor))
      .send({ operation_id: randomUUID(), currency: 'USD', paid_on: hoy, method_declared: 'Transferencia declarada', ...cuerpo });
  const ver = async (actor = ADMIN, d = entrega, o = orgA) =>
    (await http().get(eco(d, o)).set(as(actor)).expect(200)).body as Vista;

  async function crearEntrega(codigo: string, org: string, admin: string, prod: string, prodId: string, loc: string, cantidad = '250') {
    return (await http().post(`${api(org)}/deliveries`).set(as(admin)).send({
      operation_id: randomUUID(), producer_id: prodId, product_id: prod, delivery_date: hoy,
      quantity_declared: cantidad, unit: 'KG', register: true,
    }).expect(201)).body.delivery.id as string;
    void codigo; void loc;
  }

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Economia A', ADMIN);
    orgB = await mk('Coop Economia B', ADMIN_B);

    for (const [correo, rol, nombre] of [[TEC, 'FIELD_TECHNICIAN', 'Campo'], [AUDITOR, 'AUDITOR', 'Audita']] as const) {
      const inv = await http().post(`${api(orgA)}/invitations`).set(as(ADMIN)).send({ email: correo, role_code: rol }).expect(201);
      await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'X', last_name: nombre, password: PASSWORD }).expect(200);
      await h.login(correo);
    }

    producto = (await http().post(`${api(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    centro = (await http().post(`${api(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CE', name: 'Centro', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    productor = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'ECO-P1', legal_name: 'Finca Economía' }).expect(201)).body.id;
    entrega = await crearEntrega('E1', orgA, ADMIN, producto, productor, centro);

    const productoB = (await http().post(`${api(orgB)}/products`).set(as(ADMIN_B)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    const productorB = (await http().post(`${api(orgB)}/producers`).set(as(ADMIN_B)).send({ producer_code: 'ECO-PB', legal_name: 'Finca B' }).expect(201)).body.id;
    const centroB = (await http().post(`${api(orgB)}/locations`).set(as(ADMIN_B)).send({ code: 'CB', name: 'Centro B', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    entregaB = await crearEntrega('EB', orgB, ADMIN_B, productoB, productorB, centroB);
  });
  afterAll(async () => h?.close());

  it('sin registrar: no se afirma que no se pagara, y el presupuesto NO es el precio', async () => {
    const v = await ver();
    expect(v.state).toBe('SIN_REGISTRAR');
    expect(v.current).toBeNull();
    expect(v.history).toEqual([]);
    expect(v.note).toMatch(/No significa que no se pagara/i);
    expect(v.not_the_same).toMatch(/presupuesto de preparación.*no el precio del cacao/i);
    // Nada precargado: ni un precio de mercado, ni una tarifa.
    expect(v.payments.items).toEqual([]);
    expect(v.payments.note).toMatch(/No significa que no se pagara/i);
  });

  it('AUSENCIA NO ES CERO: sin prima declarada el total queda INCOMPLETO, y 0 declarado es otra cosa', async () => {
    await registrar({ price_amount: '2.50', price_currency: 'USD', price_unit: 'KG' }).expect(201);
    const v = await ver();
    expect(v.current!.premium).toBeNull();
    expect(v.current!.computed.premium_status).toBe('NO_DECLARADA');
    expect(v.current!.computed.premium).toBeNull();           // no es "0"
    expect(v.current!.computed.premium_note).toMatch(/Ausente no es cero/i);
    expect(v.current!.computed.amount).toBe('625');            // 2,50 × 250
    expect(v.current!.computed.total).toBe('625');
    expect(v.current!.computed.complete).toBe(false);
    expect(v.current!.computed.note).toMatch(/INCOMPLETO/);

    // Declarar CERO con su fundamento es un dato distinto: existe, vale 0 y el total queda completo.
    const c = await corregir({
      price_amount: '2.50', price_currency: 'USD', price_unit: 'KG',
      premium_amount: '0', premium_kind: 'POR_UNIDAD', premium_currency: 'USD', premium_unit: 'KG',
      premium_grounds: 'Acta de asamblea: esta campaña no reconoce prima.',
      reason: 'La asamblea fijó prima cero para la campaña.', expected_record_number: 1,
    }).expect(201);
    const d = c.body as Vista;
    expect(d.current!.premium!.amount).toBe('0');
    expect(d.current!.computed.premium_status).toBe('DECLARADA');
    expect(d.current!.computed.premium).toBe('0');
    expect(d.current!.computed.complete).toBe(true);
    expect(d.current!.computed.total).toBe('625');
  });

  it('una prima NO se deduce: sin fundamento declarado, se rechaza', async () => {
    const sinFundamento = await registrar({
      price_amount: '2', price_currency: 'USD', price_unit: 'KG',
      premium_amount: '0.30', premium_kind: 'POR_UNIDAD', premium_currency: 'USD', premium_unit: 'KG',
    }, ADMIN, entregaB === entrega ? entrega : entrega);
    expect(sinFundamento.status).toBe(422);
    expect(sinFundamento.body.error.code).toBe('PREMIUM_GROUNDS_REQUIRED');

    // Y una calidad LIBERADA no hace aparecer ninguna prima: la prima no se deduce de la calidad.
    const d = await crearEntrega('EQ', orgA, ADMIN, producto, productor, centro, '60');
    const rec = (await http().post(`${api(orgA)}/deliveries/${d}/receptions`).set(as(ADMIN)).send({
      operation_id: randomUUID(), location_id: centro, received_at: new Date().toISOString(),
      weighing: { method: 'Báscula', quantity: '60', unit: 'KG', weighed_on: hoy },
      quality_sample: { sample_reference: 'M-ECO' },
    }).expect(201)).body;
    const muestra = rec.delivery.receptions.find((r: { id: string }) => r.id === rec.reception_id).quality.samples[0].id;
    await http().post(`${api(orgA)}/deliveries/${d}/receptions/${rec.reception_id}/quality-samples/${muestra}/results`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), method: 'Prueba de corte', decision: 'RELEASED', limits_version: 'LIM-2026-1 (declarada)' }).expect(201);
    await registrar({ price_amount: '2', price_currency: 'USD', price_unit: 'KG' }, ADMIN, d).expect(201);
    const v = await ver(ADMIN, d);
    expect(v.current!.premium).toBeNull();
    expect(v.current!.computed.premium_status).toBe('NO_DECLARADA');
    expect(v.current!.computed.premium_note).toMatch(/Ausente no es cero/i);
  });

  it('NO convierte unidades ni monedas en silencio: el importe queda NO_CALCULABLE y se dice', async () => {
    const otra = await crearEntrega('E2', orgA, ADMIN, producto, productor, centro, '100');
    // Precio por QQ sobre una base declarada en KG.
    await registrar({ price_amount: '120', price_currency: 'USD', price_unit: 'QQ' }, ADMIN, otra).expect(201);
    const v = await ver(ADMIN, otra);
    expect(v.current!.computed.amount).toBe('NO_CALCULABLE');
    expect(v.current!.computed.total).toBe('NO_CALCULABLE');
    expect(v.current!.computed.reasons.join(' ')).toMatch(/por QQ y la base está en KG.*no se convierte/i);

    // Moneda distinta entre precio y prima: tampoco se suma.
    const otra2 = await crearEntrega('E3', orgA, ADMIN, producto, productor, centro, '100');
    await registrar({
      price_amount: '2', price_currency: 'USD', price_unit: 'KG',
      premium_amount: '50', premium_kind: 'IMPORTE_FIJO', premium_currency: 'EUR',
      premium_grounds: 'Bonificación acordada en euros por el comprador.',
    }, ADMIN, otra2).expect(201);
    const v2 = await ver(ADMIN, otra2);
    expect(v2.current!.computed.total).toBe('NO_CALCULABLE');
    expect(v2.current!.computed.reasons.join(' ')).toMatch(/USD y la prima en EUR.*no se convierte ninguna moneda/i);
  });

  it('ARITMÉTICA DECIMAL exacta, y un solo formato por número', async () => {
    const d = await crearEntrega('E4', orgA, ADMIN, producto, productor, centro, '3');
    await registrar({
      price_amount: '0.1', price_currency: 'USD', price_unit: 'KG',
      premium_amount: '0.123456', premium_kind: 'POR_UNIDAD', premium_currency: 'USD', premium_unit: 'KG',
      premium_grounds: 'Prima de calidad acordada en acta, 0,123456 por KG.',
    }, ADMIN, d).expect(201);
    const v = await ver(ADMIN, d);
    expect(v.current!.computed.amount).toBe('0.3');            // 0,1 × 3, no 0.30000000000000004
    expect(v.current!.computed.premium).toBe('0.370368');       // 0,123456 × 3
    expect(v.current!.computed.total).toBe('0.670368');
    // Un decimal, un formato: nada sale como "0.300000".
    expect(JSON.stringify(v)).not.toMatch(/\d\.\d*0{4,}"/);
  });

  it('CORREGIR conserva el historial, exige motivo y no reescribe el pasado', async () => {
    const antes = await ver();
    const versionAntes = antes.current!.record_number;
    const precioAntes = antes.current!.price!.amount;

    // Sin motivo: 400 de validación, no se escribe nada.
    const sinMotivo = await http().post(`${eco()}/corrections`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), source: 'DECLARADO_POR_LA_ORGANIZACION', basis_kind: 'CANTIDAD_DECLARADA_EN_ENTREGA', price_amount: '3', price_currency: 'USD', price_unit: 'KG', expected_record_number: versionAntes });
    expect(sinMotivo.status).toBe(400);

    await corregir({ price_amount: '2.75', price_currency: 'USD', price_unit: 'KG', reason: 'Se reliquidó el precio tras el pesaje definitivo.', expected_record_number: versionAntes }).expect(201);
    const v = await ver();
    expect(v.current!.record_number).toBe(versionAntes + 1);
    expect(v.current!.reason).toMatch(/reliquidó/);
    expect(v.history).toHaveLength(versionAntes + 1);
    // La versión anterior sigue intacta, con su importe original.
    const previa = v.history.find((x) => x.record_number === versionAntes)!;
    expect(previa.price!.amount).toBe(precioAntes);
    expect(previa.reason).not.toBe(v.current!.reason);
    // Y la tabla es append-only de verdad.
    await expect(sql`UPDATE delivery_economics SET price_amount = 9 WHERE delivery_id = ${entrega}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM delivery_economics WHERE delivery_id = ${entrega}`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('CONCURRENCIA: dos correcciones sobre la misma versión no se pisan', async () => {
    const v = await ver();
    const n = v.current!.record_number;
    const cuerpo = (p: string) => ({
      operation_id: randomUUID(), source: 'DECLARADO_POR_LA_ORGANIZACION', basis_kind: 'CANTIDAD_DECLARADA_EN_ENTREGA',
      price_amount: p, price_currency: 'USD', price_unit: 'KG', reason: `Corrección simultánea ${p}`, expected_record_number: n,
    });
    const [a, b] = await Promise.all([
      http().post(`${eco()}/corrections`).set(as(ADMIN)).send(cuerpo('4.00')),
      http().post(`${eco()}/corrections`).set(as(ADMIN)).send(cuerpo('5.00')),
    ]);
    const estados = [a.status, b.status].sort();
    expect(estados).toEqual([201, 409]);
    const perdedor = a.status === 409 ? a : b;
    expect(perdedor.body.error.code).toBe('VERSION_CONFLICT');
    // Solo una versión nueva, no dos.
    const d = await ver();
    expect(d.current!.record_number).toBe(n + 1);
  });

  it('IDEMPOTENCIA: repetir la misma operación no crea una segunda versión', async () => {
    const d = await crearEntrega('E5', orgA, ADMIN, producto, productor, centro, '10');
    const op = randomUUID();
    const cuerpo = { operation_id: op, source: 'DECLARADO_POR_LA_ORGANIZACION', basis_kind: 'CANTIDAD_DECLARADA_EN_ENTREGA', price_amount: '1', price_currency: 'USD', price_unit: 'KG' };
    await http().post(eco(d)).set(as(ADMIN)).send(cuerpo).expect(201);
    const repetida = await http().post(eco(d)).set(as(ADMIN)).send(cuerpo).expect(201);
    expect(repetida.body.replayed).toBe(true);
    expect((await ver(ADMIN, d)).history).toHaveLength(1);
    // Registrar OTRA vez (operación distinta) no duplica: se corrige, no se registra dos veces.
    const otra = await registrar({ price_amount: '2', price_currency: 'USD', price_unit: 'KG' }, ADMIN, d);
    expect(otra.status).toBe(409);
    expect(otra.body.error.code).toBe('ALREADY_RECORDED');
  });

  it('UN PRECIO NO ES UN PAGO: informar un pago no mueve dinero y se corrige con motivo', async () => {
    const d = await crearEntrega('E6', orgA, ADMIN, producto, productor, centro, '100');
    await registrar({ price_amount: '2', price_currency: 'USD', price_unit: 'KG' }, ADMIN, d).expect(201);
    const conPrecio = await ver(ADMIN, d);
    expect(conPrecio.current!.computed.total).toBe('200');
    // El precio registrado NO cuenta como pago.
    expect(conPrecio.payments.items).toEqual([]);
    expect(conPrecio.payments.informed_total).toBe('NO_CALCULABLE');

    await pagar({ amount: '120' }, ADMIN, d).expect(201);
    const p1 = await ver(ADMIN, d);
    expect(p1.payments.informed_total).toBe('120');
    expect(p1.payments.note).toMatch(/no ejecuta transferencias/i);
    expect(p1.payments.note).toMatch(/no demuestra que el dinero llegara/i);
    // El total acordado no cambia porque se informe un pago.
    expect(p1.current!.computed.total).toBe('200');

    // Corregir un pago exige motivo y conserva el anterior marcado como superado.
    const sinMotivo = await pagar({ amount: '130', corrects_payment_id: (await h.db.selectFrom('delivery_payments').select('id').where('delivery_id', '=', d).executeTakeFirstOrThrow()).id }, ADMIN, d);
    expect(sinMotivo.status).toBe(422);
    const objetivo = (await h.db.selectFrom('delivery_payments').select('id').where('delivery_id', '=', d).executeTakeFirstOrThrow()).id;
    await pagar({ amount: '130', corrects_payment_id: objetivo, reason: 'El comprobante decía 130, no 120.' }, ADMIN, d).expect(201);
    const p2 = await ver(ADMIN, d);
    expect(p2.payments.items).toHaveLength(2);
    expect(p2.payments.items.find((x) => x.superseded)!.amount).toBe('120');
    expect(p2.payments.informed_total).toBe('130');
    // Y no se suman monedas distintas.
    await pagar({ amount: '10', currency: 'EUR' }, ADMIN, d).expect(201);
    const p3 = await ver(ADMIN, d);
    expect(p3.payments.informed_total).toBe('NO_CALCULABLE');
    expect(p3.payments.currencies_note).toMatch(/no se suman monedas distintas/i);
  });

  it('PERMISOS: leer entregas no da acceso al dinero; el auditor lee pero no escribe', async () => {
    // El técnico lee entregas asignadas pero NO tiene economics:read.
    const tec = await http().get(eco()).set(as(TEC));
    expect(tec.status).toBe(403);
    // CONTROL autorizado: el admin sí.
    await http().get(eco()).set(as(ADMIN)).expect(200);

    // El auditor lee...
    await http().get(eco()).set(as(AUDITOR)).expect(200);
    // ...y no registra ni corrige.
    const escribe = await registrar({ price_amount: '9', price_currency: 'USD', price_unit: 'KG' }, AUDITOR);
    expect(escribe.status).toBe(403);
    const corrige = await corregir({ price_amount: '9', price_currency: 'USD', price_unit: 'KG', reason: 'Intento sin permiso', expected_record_number: 1 }, AUDITOR);
    expect(corrige.status).toBe(403);
  });

  it('AISLAMIENTO: el dinero de otra organización no existe para esta', async () => {
    expect((await http().get(eco(entregaB, orgA)).set(as(ADMIN))).status).toBe(404);
    expect((await http().get(eco(entrega, orgB)).set(as(ADMIN))).status).toBe(404);
    // Y el admin de B no ve la entrega de A ni citándola en su propia organización.
    expect((await http().get(eco(entrega, orgB)).set(as(ADMIN_B))).status).toBe(404);
  });

  it('PRIVACIDAD: la entrega no publica su dinero a quien solo lee entregas', async () => {
    // Con dato económico registrado, la vista de la ENTREGA sigue sin contenerlo.
    const vista = await http().get(`${api(orgA)}/deliveries/${entrega}`).set(as(ADMIN)).expect(200);
    const texto = JSON.stringify(vista.body);
    expect(texto).not.toMatch(/price_amount|premium_amount|premium_grounds|method_declared/);
    expect(texto).not.toMatch(/"2\.75"|"USD"/);
    // CONTROL: ese dinero sí existe, y se ve por su propia ruta con su propio permiso.
    const eco = await ver();
    expect(eco.current!.price!.currency).toBe('USD');
    // Y el técnico, que sí lee la entrega, no obtiene el dinero por ninguna de las dos rutas.
    const comoTecnico = await http().get(`${api(orgA)}/deliveries/${entrega}`).set(as(TEC));
    if (comoTecnico.status === 200) {
      expect(JSON.stringify(comoTecnico.body)).not.toMatch(/price_amount|premium_amount/);
    }
    expect((await http().get(`${api(orgA)}/deliveries/${entrega}/economics`).set(as(TEC))).status).toBe(403);
  });

  it('«¿CUÁNTO RECIBIÓ EL PRODUCTOR?»: suma solo lo sumable y cuenta aparte lo demás', async () => {
    const r = (await http().get(`${api(orgA)}/producers/${productor}/economics`).set(as(ADMIN)).expect(200)).body as {
      producer: { code: string }; counts: { deliveries: number; with_economics: number; without_economics: number; not_computable: number; incomplete_premium: number };
      agreed_total: string; currency: string | null; currencies_note: string | null; note: string; not_proof_of_payment: string;
    };
    expect(r.producer.code).toBe('ECO-P1');
    expect(r.counts.deliveries).toBeGreaterThan(1);
    // Hay entregas sin dato económico: NO cuentan como cero, se cuentan aparte.
    expect(r.counts.without_economics + r.counts.with_economics).toBe(r.counts.deliveries);
    expect(r.counts.not_computable).toBeGreaterThan(0);
    expect(r.note).toMatch(/no cuentan como cero/i);
    expect(r.not_proof_of_payment).toMatch(/no demuestra que se haya pagado/i);
  });

  it('PROCEDENCIA: queda quién lo afirma, sobre qué apoyo y a qué fecha corresponde', async () => {
    const d = await crearEntrega('E7', orgA, ADMIN, producto, productor, centro, '50');
    await registrar({
      price_amount: '2.2', price_currency: 'USD', price_unit: 'KG',
      source: 'DECLARADO_POR_EL_PRODUCTOR', source_note: 'Lo dijo el productor en la recepción.', agreed_on: hoy,
    }, ADMIN, d).expect(201);
    const v = await ver(ADMIN, d);
    expect(v.current!.provenance.source).toBe('DECLARADO_POR_EL_PRODUCTOR');
    expect(v.current!.provenance.note).toMatch(/productor/i);
    expect(v.current!.provenance.agreed_on).toBe(hoy);
    expect(v.current!.author).toBe(ADMIN);
    // Un documento citado tiene que existir en la organización.
    const inventado = await registrar({ price_amount: '1', price_currency: 'USD', price_unit: 'KG', source: 'ACTA_O_DOCUMENTO', source_document_id: randomUUID() }, ADMIN, await crearEntrega('E8', orgA, ADMIN, producto, productor, centro, '5'));
    expect(inventado.status).toBe(422);
    expect(inventado.body.error.code).toBe('REFERENCE_NOT_FOUND');
  });

  it('BASE declarada, no deducida: sin recepción no hay «cantidad recibida»', async () => {
    const d = await crearEntrega('E9', orgA, ADMIN, producto, productor, centro, '80');
    const sinRecepcion = await registrar({ price_amount: '2', price_currency: 'USD', price_unit: 'KG', basis_kind: 'CANTIDAD_RECIBIDA' }, ADMIN, d);
    expect(sinRecepcion.status).toBe(422);
    expect(sinRecepcion.body.error.code).toBe('BASIS_NOT_AVAILABLE');

    await http().post(`${api(orgA)}/deliveries/${d}/receptions`).set(as(ADMIN)).send({
      operation_id: randomUUID(), location_id: centro, received_at: new Date().toISOString(),
      weighing: { method: 'Báscula', quantity: '78', unit: 'KG', weighed_on: hoy },
    }).expect(201);
    await registrar({ price_amount: '2', price_currency: 'USD', price_unit: 'KG', basis_kind: 'CANTIDAD_RECIBIDA' }, ADMIN, d).expect(201);
    const v = await ver(ADMIN, d);
    // La base guardada es la recibida (78), no la declarada (80): la diferencia importa y queda escrita.
    expect(v.current!.basis.kind).toBe('CANTIDAD_RECIBIDA');
    expect(v.current!.basis.quantity).toBe('78');
    expect(v.current!.computed.amount).toBe('156');
    expect(v.delivery.quantity_declared).toBe('80');
  });

  it('REGISTRAR no toca la entrega ni el inventario', async () => {
    const d = await crearEntrega('E10', orgA, ADMIN, producto, productor, centro, '40');
    const antes = await h.db.selectFrom('deliveries').select(['row_version', 'quantity_declared']).where('id', '=', d).executeTakeFirstOrThrow();
    const eventos = await sql<{ n: number }>`SELECT count(*)::int AS n FROM domain_events WHERE aggregate_id = ${d}`.execute(h.db);
    await registrar({ price_amount: '3', price_currency: 'USD', price_unit: 'KG' }, ADMIN, d).expect(201);
    const despues = await h.db.selectFrom('deliveries').select(['row_version', 'quantity_declared']).where('id', '=', d).executeTakeFirstOrThrow();
    const eventos2 = await sql<{ n: number }>`SELECT count(*)::int AS n FROM domain_events WHERE aggregate_id = ${d}`.execute(h.db);
    expect(despues.row_version).toBe(antes.row_version);
    expect(despues.quantity_declared).toBe(antes.quantity_declared);
    expect(eventos2.rows[0].n).toBe(eventos.rows[0].n);
    // Pero sí queda en auditoría.
    const aud = await sql<{ n: number }>`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'economics.recorded'`.execute(h.db);
    expect(aud.rows[0].n).toBeGreaterThan(0);
  });
});
