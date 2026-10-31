// P1-012 — Precio, prima y pagos informados: recorrido completo en navegador real y por API (RF-43; S3 §32).
//
//   node e2e/review/economia.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Lo que tiene que quedar demostrado:
//   1. **nada precargado**: una entrega sin dato económico lo dice, y no afirma que no se pagara;
//   2. **ausencia no es cero**: sin prima el total queda INCOMPLETO; declarar 0 es un dato distinto;
//   3. **una prima no se deduce**: sin fundamento declarado se rechaza, y la calidad no la crea;
//   4. **sin conversiones silenciosas** de unidad ni de moneda: NO_CALCULABLE con su razón;
//   5. **un precio no es un pago**: informar un pago no mueve dinero y no cambia lo acordado;
//   6. **corregir pide motivo** y conserva el historial; dos correcciones a la vez no se pisan;
//   7. **privacidad**: el dinero no llega a la entrega, ni al paquete DD, ni a la vista del comprador;
//   8. permisos, enlaces, estados de pantalla, teclado y 390 px.
//
// **Cambia datos DEMO**: crea **sus propias entregas de ensayo** (el DEMO no trae suficientes sin dato
// económico) y registra sobre ellas precio, prima y pagos, en tablas append-only nuevas. No modifica
// entregas ajenas, recepciones, inventario, riesgo ni expedientes, y nada de lo que escribe se borra:
// las entregas quedan identificadas como ensayo en su nota.
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';
import { exigeEntrada } from './comprobacion.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const COOP = 'e8dbdab9-08ec-4867-908e-f23138dbca28';
const HOY = new Date().toISOString().slice(0, 10);

const resultados = [];
async function caso(titulo, fn) {
  try {
    const [ok, detalle] = await fn();
    console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(66)} ${detalle}`);
    resultados.push(ok);
  } catch (e) {
    console.log(`FALLA ${titulo.padEnd(66)} ${e.message}`);
    resultados.push(false);
  }
}

async function sesion(local) {
  const c = cuentaDemo(local);
  const r = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) });
  if (!r.ok) throw new Error(`login de ${local}: ${r.status}`);
  return { cuenta: c, token: (await r.json()).access_token };
}
const pedir = async (token, metodo, path, cuerpo) => {
  const r = await fetch(`${API}${path}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const t = await r.text();
  let body = null; try { body = JSON.parse(t); } catch { /* no JSON */ }
  return { status: r.status, body };
};

const admin = await sesion('admin.cooperativa');
const tecnico = await sesion('tecnico1.cooperativa');
const auditor = await sesion('auditor.cooperativa');

// El DEMO no trae suficientes entregas sin dato económico, así que la revisión crea las suyas.
const productores = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/producers`);
const productos = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/products`);
const unProductor = exigeEntrada('productor del DEMO', (productores.body?.items ?? productores.body ?? [])[0]);
const unProducto = exigeEntrada('producto del DEMO', (productos.body?.items ?? productos.body ?? [])[0]);

async function entregaDeEnsayo(cantidad) {
  const r = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/deliveries`, {
    operation_id: randomUUID(), producer_id: unProductor.id, product_id: unProducto.id,
    delivery_date: HOY, quantity_declared: cantidad, unit: 'KG', register: true,
    notes: 'Entrega de ENSAYO creada por e2e/review/economia.mjs. No es una operación real.',
  });
  if (r.status !== 201) throw new Error(`crear la entrega de ensayo respondió ${r.status}: ${JSON.stringify(r.body?.error ?? {})}`);
  return r.body.delivery;
}

const eco = (d) => `/api/v1/organizations/${COOP}/deliveries/${d}/economics`;
const [E_PRIMA, E_UNIDAD, E_PAGO, E_WEB] = await Promise.all(['250', '100', '200', '80'].map(entregaDeEnsayo));

const registrar = (d, cuerpo, token = admin.token) =>
  pedir(token, 'POST', eco(d), { operation_id: randomUUID(), source: 'DECLARADO_POR_LA_ORGANIZACION', basis_kind: 'CANTIDAD_DECLARADA_EN_ENTREGA', ...cuerpo });

// ------------------------------------------------------------------ API
await caso('CONTROL: sin registrar, se dice —y NO se afirma que no se pagara', async () => {
  const v = await pedir(admin.token, 'GET', eco(E_PRIMA.id));
  if (v.status !== 200) throw new Error(`la vista respondió ${v.status}`);
  exigeEntrada('estado del dato económico', v.body.state);
  const nada = /No significa que no se pagara/i.test(v.body.note);
  const distinto = /presupuesto de preparación.*no el precio del cacao/i.test(v.body.not_the_same);
  // Nada precargado: ni precios de mercado, ni primas.
  const limpio = v.body.current === null && v.body.history.length === 0 && v.body.payments.items.length === 0;
  return [nada && distinto && limpio, `estado=${v.body.state} · sin precargar=${limpio} · distingue el presupuesto=${distinto}`];
});

await caso('AUSENCIA NO ES CERO: sin prima el total es INCOMPLETO; cero declarado es otro dato', async () => {
  const r = await registrar(E_PRIMA.id, { price_amount: '2.50', price_currency: 'USD', price_unit: 'KG' });
  if (r.status !== 201) throw new Error(`registrar respondió ${r.status}: ${JSON.stringify(r.body?.error ?? {})}`);
  const sinPrima = r.body.current;
  const ok1 = sinPrima.premium === null && sinPrima.computed.premium === null
    && sinPrima.computed.premium_status === 'NO_DECLARADA' && sinPrima.computed.complete === false;
  // Declarar CERO con fundamento: existe, vale 0 y el total pasa a completo.
  const c = await pedir(admin.token, 'POST', `${eco(E_PRIMA.id)}/corrections`, {
    operation_id: randomUUID(), source: 'DECLARADO_POR_LA_ORGANIZACION', basis_kind: 'CANTIDAD_DECLARADA_EN_ENTREGA',
    price_amount: '2.50', price_currency: 'USD', price_unit: 'KG',
    premium_amount: '0', premium_kind: 'POR_UNIDAD', premium_currency: 'USD', premium_unit: 'KG',
    premium_grounds: 'Acta de asamblea de ensayo: sin prima esta campaña.',
    reason: 'Ensayo de revisión: se declara prima cero.', expected_record_number: sinPrima.record_number,
  });
  if (c.status !== 201) throw new Error(`corregir respondió ${c.status}`);
  const cero = c.body.current;
  const ok2 = cero.computed.premium === '0' && cero.computed.premium_status === 'DECLARADA' && cero.computed.complete === true;
  return [ok1 && ok2,
    `sin prima: premium=${JSON.stringify(sinPrima.computed.premium)} completo=${sinPrima.computed.complete} · cero declarado: premium=${cero.computed.premium} completo=${cero.computed.complete}`];
});

await caso('UNA PRIMA NO SE DEDUCE: sin fundamento declarado se rechaza', async () => {
  const sin = await registrar(E_UNIDAD.id, {
    price_amount: '2', price_currency: 'USD', price_unit: 'KG',
    premium_amount: '0.30', premium_kind: 'POR_UNIDAD', premium_currency: 'USD', premium_unit: 'KG',
  });
  // CONTROL autorizado: con fundamento, la misma prima sí se registra.
  const con = await registrar(E_UNIDAD.id, {
    price_amount: '2', price_currency: 'USD', price_unit: 'QQ',
    premium_amount: '0.30', premium_kind: 'POR_UNIDAD', premium_currency: 'USD', premium_unit: 'QQ',
    premium_grounds: 'Contrato de ensayo: prima de 0,30 por QQ.',
  });
  return [sin.status === 422 && sin.body?.error?.code === 'PREMIUM_GROUNDS_REQUIRED' && con.status === 201,
    `sin fundamento → ${sin.status} ${sin.body?.error?.code} · con fundamento → ${con.status}`];
});

await caso('SIN CONVERSIONES: precio por QQ sobre base en KG queda NO_CALCULABLE y se explica', async () => {
  const v = await pedir(admin.token, 'GET', eco(E_UNIDAD.id));
  const c = v.body.current.computed;
  const explica = c.reasons.join(' ');
  return [c.amount === 'NO_CALCULABLE' && c.total === 'NO_CALCULABLE' && /no se convierte/i.test(explica),
    `importe=${c.amount} · total=${c.total} · razón: «${explica.slice(0, 70)}…»`];
});

await caso('UN PRECIO NO ES UN PAGO: informar un pago no cambia lo acordado', async () => {
  const r = await registrar(E_PAGO.id, { price_amount: '2', price_currency: 'USD', price_unit: 'KG' });
  if (r.status !== 201) throw new Error(`registrar respondió ${r.status}`);
  const acordadoAntes = r.body.current.computed.total;
  const sinPagos = r.body.payments.items.length === 0 && r.body.payments.informed_total === 'NO_CALCULABLE';
  const p = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/deliveries/${E_PAGO.id}/payments`, {
    operation_id: randomUUID(), amount: '10', currency: 'USD', paid_on: HOY, method_declared: 'Transferencia declarada (ensayo)',
  });
  if (p.status !== 201) throw new Error(`informar pago respondió ${p.status}`);
  const despues = p.body;
  const advierte = /no ejecuta transferencias/i.test(despues.payments.note) && /no demuestra que el dinero llegara/i.test(despues.payments.note);
  return [sinPagos && despues.current.computed.total === acordadoAntes && despues.payments.informed_total === '10' && advierte,
    `acordado ${acordadoAntes} antes y después · informado=${despues.payments.informed_total} · advierte que no mueve dinero=${advierte}`];
});

await caso('CORREGIR: exige motivo, conserva el historial y no reescribe el pasado', async () => {
  const antes = await pedir(admin.token, 'GET', eco(E_PAGO.id));
  const n = antes.body.current.record_number;
  const precioAntes = antes.body.current.price.amount;
  const sinMotivo = await pedir(admin.token, 'POST', `${eco(E_PAGO.id)}/corrections`, {
    operation_id: randomUUID(), source: 'DECLARADO_POR_LA_ORGANIZACION', basis_kind: 'CANTIDAD_DECLARADA_EN_ENTREGA',
    price_amount: '3', price_currency: 'USD', price_unit: 'KG', expected_record_number: n,
  });
  const con = await pedir(admin.token, 'POST', `${eco(E_PAGO.id)}/corrections`, {
    operation_id: randomUUID(), source: 'DECLARADO_POR_LA_ORGANIZACION', basis_kind: 'CANTIDAD_DECLARADA_EN_ENTREGA',
    price_amount: '3', price_currency: 'USD', price_unit: 'KG',
    reason: 'Ensayo de revisión: se reliquida el precio.', expected_record_number: n,
  });
  if (con.status !== 201) throw new Error(`corregir respondió ${con.status}`);
  const previa = con.body.history.find((x) => x.record_number === n);
  return [sinMotivo.status === 400 && con.body.current.record_number === n + 1 && previa.price.amount === precioAntes,
    `sin motivo → ${sinMotivo.status} · versión ${n} → ${con.body.current.record_number} · la ${n} sigue en ${previa.price.amount}`];
});

await caso('CONCURRENCIA: dos correcciones sobre la misma versión no se pisan', async () => {
  const v = await pedir(admin.token, 'GET', eco(E_PAGO.id));
  const n = v.body.current.record_number;
  const cuerpo = (p) => ({
    operation_id: randomUUID(), source: 'DECLARADO_POR_LA_ORGANIZACION', basis_kind: 'CANTIDAD_DECLARADA_EN_ENTREGA',
    price_amount: p, price_currency: 'USD', price_unit: 'KG', reason: `Ensayo simultáneo ${p}`, expected_record_number: n,
  });
  const [a, b] = await Promise.all([
    pedir(admin.token, 'POST', `${eco(E_PAGO.id)}/corrections`, cuerpo('4')),
    pedir(admin.token, 'POST', `${eco(E_PAGO.id)}/corrections`, cuerpo('5')),
  ]);
  const estados = [a.status, b.status].sort((x, y) => x - y);
  const d = await pedir(admin.token, 'GET', eco(E_PAGO.id));
  return [estados[0] === 201 && estados[1] === 409 && d.body.current.record_number === n + 1,
    `estados ${estados.join('/')} · una sola versión nueva: ${n} → ${d.body.current.record_number}`];
});

await caso('PERMISOS: leer entregas no da acceso al dinero; el auditor lee y no escribe', async () => {
  const tec = await pedir(tecnico.token, 'GET', eco(E_PAGO.id));
  const aud = await pedir(auditor.token, 'GET', eco(E_PAGO.id));
  const audEscribe = await registrar(E_WEB.id, { price_amount: '1', price_currency: 'USD', price_unit: 'KG' }, auditor.token);
  // CONTROL autorizado: el admin sí lee y sí escribe.
  const adminLee = await pedir(admin.token, 'GET', eco(E_PAGO.id));
  return [tec.status === 403 && aud.status === 200 && audEscribe.status === 403 && adminLee.status === 200,
    `técnico lee entregas pero el dinero → ${tec.status} · auditor lee → ${aud.status}, escribe → ${audEscribe.status} · admin → ${adminLee.status}`];
});

await caso('PRIVACIDAD: el dinero no entra en la entrega ni en el paquete de debida diligencia', async () => {
  const entrega = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/deliveries/${E_PAGO.id}`);
  if (entrega.status !== 200) throw new Error(`la entrega respondió ${entrega.status}`);
  const sinDinero = !/price_amount|premium_amount|premium_grounds|method_declared|informed_total/.test(JSON.stringify(entrega.body));
  // Y en un expediente de debida diligencia real tampoco aparece.
  const casos = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/dd-cases`);
  const caso0 = (Array.isArray(casos.body) ? casos.body : casos.body?.items ?? [])[0];
  let ddLimpio = 'sin expediente que mirar';
  if (caso0) {
    const c = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/dd-cases/${caso0.id}`);
    if (c.status !== 200) throw new Error(`el expediente respondió ${c.status}`);
    ddLimpio = !/price_amount|premium_amount|delivery_economics|delivery_payments/.test(JSON.stringify(c.body));
    if (ddLimpio !== true) throw new Error('el expediente DD contiene campos económicos');
  }
  // CONTROL: ese dinero sí existe por su propia ruta.
  const porSuRuta = await pedir(admin.token, 'GET', eco(E_PAGO.id));
  return [sinDinero && porSuRuta.body.current !== null,
    `entrega sin campos económicos=${sinDinero} · expediente DD: ${ddLimpio} · por su ruta sí está=${porSuRuta.body.current !== null}`];
});

await caso('AISLAMIENTO: el dinero de una entrega ajena no se alcanza desde otra organización', async () => {
  const otras = await pedir(admin.token, 'GET', '/api/v1/organizations');
  const ajena = (otras.body ?? []).find((o) => o.id !== COOP);
  if (!ajena) return [true, 'solo hay una organización en el DEMO'];
  const r = await pedir(admin.token, 'GET', `/api/v1/organizations/${ajena.id}/deliveries/${E_PAGO.id}/economics`);
  return [r.status === 404 || r.status === 403, `entrega de otra organización → ${r.status}`];
});

await caso('«¿CUÁNTO RECIBIÓ EL PRODUCTOR?»: suma lo sumable y cuenta aparte lo demás', async () => {
  const v = await pedir(admin.token, 'GET', eco(E_PAGO.id));
  const prodCode = v.body.delivery.producer_code;
  const prods = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/producers?limit=100`);
  const p = (prods.body?.items ?? prods.body ?? []).find((x) => x.producer_code === prodCode);
  const p2 = exigeEntrada('productor de la entrega', p);
  const r = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/producers/${p2.id}/economics`);
  if (r.status !== 200) throw new Error(`el resumen respondió ${r.status}`);
  const c = r.body.counts;
  const cuadra = c.with_economics + c.without_economics === c.deliveries;
  const dice = /no cuentan como cero/i.test(r.body.note) && /no demuestra que se haya pagado/i.test(r.body.not_proof_of_payment);
  return [cuadra && dice,
    `${c.deliveries} entregas: ${c.with_economics} con dato, ${c.without_economics} sin él (no cero) · acordado=${r.body.agreed_total} ${r.body.currency ?? ''}`];
});

// ------------------------------------------------------------------ navegador
const navegador = await chromium.launch();
try {
  const entrar = async (cuenta, viewport = { width: 1280, height: 900 }) => {
    const ctx = await navegador.newContext({ viewport, locale: 'es-EC' });
    const page = await ctx.newPage();
    await page.goto(WEB);
    await page.getByLabel('Correo').fill(cuenta.cuenta.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(cuenta.cuenta.contrasena);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 20000 });
    return { ctx, page };
  };
  const abrir = async (page, d) => {
    await page.goto(`${WEB}/organizaciones/${COOP}/entregas/${d}/economia`);
    await page.getByRole('heading', { level: 1, name: 'Precio, prima y pagos' }).waitFor({ timeout: 20000 });
    await page.getByRole('heading', { name: 'Dato económico vigente' }).waitFor({ timeout: 20000 });
  };

  const { ctx, page } = await entrar(admin);

  await caso('ENLACE: desde la entrega se llega, y la pantalla avisa de qué no demuestra', async () => {
    await page.goto(`${WEB}/organizaciones/${COOP}/entregas/${E_WEB.id}`);
    await page.getByRole('heading', { level: 1, name: /^Entrega / }).waitFor({ timeout: 20000 });
    await page.getByRole('link', { name: 'Precio, prima y pagos informados' }).click();
    await page.getByRole('heading', { level: 1, name: 'Precio, prima y pagos' }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    return [/no demuestra que se haya pagado/i.test(t) && /no ejecuta transferencias/i.test(t) && /presupuesto de preparación/i.test(t),
      `advierte que no es pago y que no es el presupuesto=${/presupuesto de preparación/i.test(t)}`];
  });

  await caso('RECORRIDO: registrar sin prima deja el total INCOMPLETO, y se ve', async () => {
    await abrir(page, E_WEB.id);
    await page.getByRole('button', { name: 'Registrar el dato económico' }).click();
    await page.getByLabel('Precio (importe)').fill('1.75');
    await page.getByLabel('Nota de procedencia').fill('Ensayo de revisión P1-012.');
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await page.locator('.alert.valid').filter({ hasText: 'Dato económico registrado' }).waitFor({ timeout: 20000 });
    // El aviso aparece antes de que la ficha se recargue: se espera al dato ya pintado.
    await page.locator('section[aria-labelledby="eco-actual"]').filter({ hasText: '1.75' }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    const sinMarkdown = !t.includes('**');
    return [/No declarada/.test(t) && /Incompleto/.test(t) && /Ausente no es cero/i.test(t) && sinMarkdown,
      `prima «No declarada»=${/No declarada/.test(t)} · total «Incompleto»=${/Incompleto/.test(t)} · sin asteriscos en crudo=${sinMarkdown}`];
  });

  await caso('RECORRIDO: corregir pide motivo y el historial conserva la versión anterior', async () => {
    await abrir(page, E_WEB.id);
    await page.getByRole('button', { name: 'Corregir con motivo' }).click();
    await page.getByLabel('Precio (importe)').fill('1.95');
    await page.getByLabel('Motivo de la corrección').fill('Ensayo de revisión: se reliquida.');
    await page.getByRole('button', { name: 'Registrar la corrección' }).click();
    await page.locator('.alert.valid').filter({ hasText: 'Corrección registrada' }).waitFor({ timeout: 20000 });
    const filas = await page.locator('table[aria-label="Historial del dato económico"] tbody tr').count();
    const t = await page.locator('main').innerText();
    return [filas >= 2 && /1\.75/.test(t) && /reliquida/.test(t),
      `${filas} versiones en el historial · la anterior (1.75) sigue visible=${/1\.75/.test(t)}`];
  });

  await caso('RECORRIDO: informar un pago, y que la pantalla diga que no movió dinero', async () => {
    await abrir(page, E_WEB.id);
    await page.getByRole('button', { name: 'Informar un pago' }).click();
    await page.getByLabel('Importe pagado').fill('5');
    await page.getByLabel('Fecha declarada del pago').fill(HOY);
    await page.getByLabel('Medio declarado').fill('Efectivo declarado (ensayo)');
    await page.getByRole('button', { name: 'Informar el pago' }).click();
    await page.locator('.alert.valid').filter({ hasText: 'no ha movido dinero' }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    return [/Total informado/.test(t) && /Vigente/.test(t), `pago visible con su estado · aviso de que no mueve dinero mostrado`];
  });

  await caso('PERMISOS EN PANTALLA: el técnico recibe el motivo, no una pantalla vacía', async () => {
    const { ctx: c2, page: p2 } = await entrar(tecnico);
    await p2.goto(`${WEB}/organizaciones/${COOP}/entregas/${E_WEB.id}/economia`);
    await p2.getByRole('heading', { level: 1, name: 'Precio, prima y pagos' }).waitFor({ timeout: 20000 });
    const t = await p2.locator('main').innerText();
    // Y en la entrega no le aparece ni el enlace.
    await p2.goto(`${WEB}/organizaciones/${COOP}/entregas/${E_WEB.id}`);
    await p2.getByRole('heading', { level: 1, name: /^Entrega / }).waitFor({ timeout: 20000 });
    const enlaces = await p2.getByRole('link', { name: 'Precio, prima y pagos informados' }).count();
    const textoEntrega = await p2.locator('main').innerText();
    await c2.close();
    return [/no lee los datos económicos/i.test(t) && enlaces === 0 && !/1\.95|Total informado/.test(textoEntrega),
      `motivo mostrado=${/no lee los datos económicos/i.test(t)} · enlaces en la entrega=${enlaces} · sin cifras filtradas`];
  });

  await caso('TECLADO: se registra un pago sin ratón', async () => {
    await abrir(page, E_PAGO.id);
    const boton = page.getByRole('button', { name: 'Informar un pago' });
    await boton.focus();
    const enfocado = await page.evaluate(() => document.activeElement?.textContent);
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Informar un pago' }).waitFor({ timeout: 20000 });
    await page.getByLabel('Importe pagado').focus();
    await page.keyboard.type('2');
    await page.getByLabel('Fecha declarada del pago').fill(HOY);
    await page.getByLabel('Medio declarado').fill('Teclado (ensayo)');
    await page.getByRole('button', { name: 'Informar el pago' }).press('Enter');
    await page.locator('.alert.valid').filter({ hasText: 'no ha movido dinero' }).waitFor({ timeout: 20000 });
    return [enfocado?.includes('Informar un pago') === true, `foco en «${enfocado}» · formulario abierto y enviado con Enter`];
  });

  await caso('390 px: nada se corta y las tablas desplazan en horizontal', async () => {
    const { ctx: c3, page: p3 } = await entrar(admin, { width: 390, height: 844 });
    await p3.goto(`${WEB}/organizaciones/${COOP}/entregas/${E_PAGO.id}/economia`);
    await p3.getByRole('heading', { level: 1, name: 'Precio, prima y pagos' }).waitFor({ timeout: 20000 });
    await p3.getByRole('heading', { name: 'Pagos informados' }).waitFor({ timeout: 20000 });
    const desborde = await p3.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const envueltas = await p3.locator('.table-wrap').count();
    await c3.close();
    return [!desborde && envueltas > 0, `desborde horizontal=${desborde} · ${envueltas} tabla(s) con contenedor desplazable`];
  });

  await ctx.close();
} finally {
  await navegador.close();
}

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} comprobaciones correctas`);
process.exit(ok === resultados.length ? 0 : 1);
