// P1-010 — Presupuesto de preparación: recorrido completo en navegador real y por API
// (RF-41; S3 §33; D-51).
//
//   node e2e/review/presupuesto.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Lo que tiene que quedar demostrado:
//   1. **nada precargado**: ningún importe del ejemplo de S3, y los conceptos empiezan pendientes;
//   2. **ausencia no es cero**: sin importe o sin cantidad, el total queda INCOMPLETO;
//   3. **aritmética decimal** exacta y **un solo formato** para el mismo número;
//   4. **denominadores** por productor distinto y por tonelada del **peso físico del ledger**, con su fecha;
//   5. **reproducible**: cambiar una tarifa después **no reescribe** una estimación guardada;
//   6. lo **declarado** y lo **observado**, separados; permisos, enlaces, teclado y 390 px.
//
// CAMBIA DATOS DEMO: registra parámetros presupuestarios y guarda una estimación. Son registros append-only
// propios de este módulo; no toca expedientes, inventario, riesgo ni decisiones operativas.
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';
import { exigeEntrada } from './comprobacion.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const COOP = 'e8dbdab9-08ec-4867-908e-f23138dbca28';

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
const base = `/api/v1/organizations/${COOP}/cost`;
const uuid = () => crypto.randomUUID();
const hoy = new Date().toISOString().slice(0, 10);
const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const admin = await sesion('admin.cooperativa');     // cost:manage + cost:read
const tecnico = await sesion('tecnico1.cooperativa'); // ninguno

const lotes = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/lots`);
const lote = exigeEntrada('lote de la cooperativa', (Array.isArray(lotes.body) ? lotes.body : lotes.body?.items ?? [])[0]);

// ------------------------------------------------------------------ API
await caso('CONTROL: los parámetros se sirven, y ningún importe del ejemplo de S3 está precargado', async () => {
  const r = await pedir(admin.token, 'GET', `${base}/parameters`);
  exigeEntrada('conceptos presupuestarios', r.body?.concepts);
  const texto = JSON.stringify(r.body.concepts.map((c) => c.current));
  const sinEjemplo = !/2\.50|0\.80|1\.20|0\.60|1\.10|6\.20/.test(texto);
  return [r.status === 200 && r.body.concepts.length === 5 && sinEjemplo && r.body.currency === 'USD',
    `${r.body.concepts.length} conceptos · sin importes del ejemplo=${sinEjemplo} · moneda=${r.body.currency}`];
});

await caso('AUSENCIA NO ES CERO: con un solo concepto presupuestado, el total es INCOMPLETO', async () => {
  // Se registra un único parámetro, con un importe propio que no procede de ninguna fuente externa.
  await pedir(admin.token, 'POST', `${base}/parameters`, {
    operation_id: uuid(), concept: 'GEOREFERENCIACION', amount: '3.25', currency: 'USD', valid_from: ayer,
    note: 'Revisión de despliegue: importe declarado para el ensayo',
  });
  const r = await pedir(admin.token, 'POST', `${base}/estimates/preview`, {
    lot_id: lote.id, quantities: [{ concept: 'GEOREFERENCIACION', quantity: '4' }],
  });
  if (r.status !== 200) return [false, `estado ${r.status}`];
  const pendientes = r.body.total.pending_concepts.map((p) => p.concept);
  const geo = r.body.lines.find((l) => l.concept === 'GEOREFERENCIACION');
  return [r.body.total.complete === false && pendientes.length === 4 && geo.subtotal === '13'
    && /NO suma cero/.test(r.body.total.note),
  `total conocido=${r.body.total.known} · incompleto · ${pendientes.length} pendientes · 3,25 × 4 = ${geo.subtotal}`];
});

await caso('DECIMAL exacto y un solo formato para el mismo número', async () => {
  await pedir(admin.token, 'POST', `${base}/parameters`, {
    operation_id: uuid(), concept: 'DOCUMENTACION', amount: '0.1', currency: 'USD', valid_from: ayer,
  });
  const r = await pedir(admin.token, 'POST', `${base}/estimates/preview`, {
    lot_id: lote.id, quantities: [{ concept: 'DOCUMENTACION', quantity: '3' }],
  });
  const doc = r.body.lines.find((l) => l.concept === 'DOCUMENTACION');
  const peso = r.body.denominators.tonne.physical_quantity;
  const unFormato = !/\.\d*0$/.test(peso) && !/\.\d*0$/.test(r.body.total.known);
  return [doc.subtotal === '0.3' && unFormato,
    `0,1 × 3 = ${doc.subtotal} · peso publicado «${peso}» sin ceros de relleno=${unFormato}`];
});

await caso('DENOMINADORES: por productor distinto y por tonelada del peso FÍSICO del ledger', async () => {
  const r = await pedir(admin.token, 'POST', `${base}/estimates/preview`, {
    lot_id: lote.id, quantities: [{ concept: 'GEOREFERENCIACION', quantity: '4' }],
  });
  const d = r.body.denominators;
  const conFecha = Date.now() - Date.parse(d.tonne.as_of) < 120_000;
  const sinBasura = !/Infinity|NaN/.test(JSON.stringify(d));
  return [d.distinct_producers.value > 0 && conFecha && sinBasura
    && /DISTRIBUCIÓN del presupuesto/.test(d.note) && /No se reparte entre productores concretos/.test(d.note),
  `por productor=${d.distinct_producers.cost_each} (${d.distinct_producers.value}) · por tonelada=${d.tonne.cost_each} sobre ${d.tonne.physical_quantity} ${d.tonne.unit} · con fecha=${conFecha}`];
});

await caso('LO DECLARADO y LO OBSERVADO van separados, y lo observado lleva su fecha', async () => {
  const r = await pedir(admin.token, 'POST', `${base}/estimates/preview`, {
    lot_id: lote.id, quantities: [{ concept: 'GEOREFERENCIACION', quantity: '4', basis: 'Dos técnicos, dos días' }],
  });
  const geo = r.body.lines.find((l) => l.concept === 'GEOREFERENCIACION');
  const observado = r.body.observed;
  const noSeConvierte = /NO son cantidades de coste/.test(observado.note);
  const sinRellenar = r.body.lines.filter((l) => l.quantity === null).every((l) => l.quantity_kind === null);
  return [geo.quantity_kind === 'DECLARADA_ESTIMADA' && !!observado.as_of && noSeConvierte && sinRellenar,
    `cantidad=${geo.quantity_kind} · observado con fecha=${!!observado.as_of} · ninguna cantidad se rellenó sola=${sinRellenar}`];
});

let guardadaId = null;
await caso('REPRODUCIBLE: cambiar la tarifa después NO reescribe la estimación guardada', async () => {
  const g = await pedir(admin.token, 'POST', `${base}/estimates`, {
    operation_id: uuid(), lot_id: lote.id, quantities: [{ concept: 'GEOREFERENCIACION', quantity: '4' }],
  });
  if (g.status !== 201) return [false, `al guardar: ${g.status}`];
  guardadaId = g.body.id;
  const totalGuardado = g.body.total.known;

  // Se corrige el importe: versión nueva.
  await pedir(admin.token, 'POST', `${base}/parameters`, {
    operation_id: uuid(), concept: 'GEOREFERENCIACION', amount: '9.00', currency: 'USD', valid_from: hoy,
    note: 'Revisión de despliegue: corrección del importe',
  });
  const releida = await pedir(admin.token, 'GET', `${base}/estimates/${guardadaId}`);
  const nueva = await pedir(admin.token, 'POST', `${base}/estimates/preview`, {
    lot_id: lote.id, quantities: [{ concept: 'GEOREFERENCIACION', quantity: '4' }],
  });
  return [releida.body.total.known === totalGuardado && nueva.body.total.known !== totalGuardado,
    `guardada sigue en ${releida.body.total.known} · un cálculo nuevo da ${nueva.body.total.known}`];
});

await caso('PERMISOS: fijar importes y leer son distintos; quien no participa no entra', async () => {
  const lectura = await pedir(tecnico.token, 'GET', `${base}/parameters`);
  const escritura = await pedir(tecnico.token, 'POST', `${base}/parameters`, {
    operation_id: uuid(), concept: 'ADMINISTRACION', amount: '1.00', currency: 'USD', valid_from: ayer,
  });
  const control = await pedir(admin.token, 'GET', `${base}/parameters`);
  return [lectura.status === 403 && escritura.status === 403 && control.status === 200,
    `técnico: leer=${lectura.status} fijar=${escritura.status} · control administración=${control.status}`];
});

// ------------------------------------------------------------------ NAVEGADOR
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
  const abrir = async (page) => {
    await page.goto(`${WEB}/organizaciones/${COOP}/presupuesto`);
    await page.getByRole('heading', { level: 1, name: 'Presupuesto de preparación' }).waitFor({ timeout: 20000 });
    await page.getByRole('table', { name: 'Parámetros presupuestarios' }).waitFor({ timeout: 20000 });
  };

  const { ctx, page } = await entrar(admin);

  await caso('ENLACE: se llega desde el menú y la pantalla dice de quién son los importes', async () => {
    await page.goto(`${WEB}/organizaciones/${COOP}`);
    await page.getByRole('link', { name: 'Presupuesto', exact: true }).first().click();
    await page.getByRole('heading', { level: 1, name: 'Presupuesto de preparación' }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    return [/los declara tu organización/i.test(t) && /No son precios oficiales, ni costes medidos, ni ofertas de proveedores/i.test(t),
      `aviso presente=${/los declara tu organización/i.test(t)}`];
  });

  await caso('PANTALLA: los conceptos sin importe se ven «pendientes de presupuestar», no en cero', async () => {
    await abrir(page);
    const t = await page.getByRole('table', { name: 'Parámetros presupuestarios' }).innerText();
    const pendientes = (t.match(/Pendiente de presupuestar/g) ?? []).length;
    return [pendientes > 0 && !/\b0 USD\b/.test(t), `${pendientes} concepto(s) pendientes · sin «0 USD»=${!/\b0 USD\b/.test(t)}`];
  });

  await caso('RECORRIDO: declarar una cantidad, calcular y ver total, reparto y lo observado', async () => {
    await page.getByLabel('Lote', { exact: true }).selectOption(lote.id);
    await page.getByLabel(/Georreferenciación \(/).fill('4');
    await page.getByRole('button', { name: 'Calcular', exact: true }).click();
    await page.getByRole('heading', { name: /Resultado para/ }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    const total = /Total conocido:/.test(t);
    const incompleto = /INCOMPLETO/.test(t);
    const reparto = /Por productor distinto/.test(t) && /Por tonelada/.test(t) && /Peso físico del ledger/.test(t);
    const observado = /Lo observado \(no es una cantidad de coste\)/.test(t);
    return [total && incompleto && reparto && observado,
      `total=${total} · incompleto rotulado=${incompleto} · reparto con su origen=${reparto} · observado aparte=${observado}`];
  });

  await caso('PANTALLA: la estimación guardada aparece y se puede descargar', async () => {
    await abrir(page);
    const tabla = page.getByRole('table', { name: 'Estimaciones guardadas' });
    await tabla.waitFor({ timeout: 20000 });
    const [descarga] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      tabla.getByRole('button', { name: 'Descargar' }).first().click(),
    ]);
    const nombre = descarga.suggestedFilename();
    return [/^presupuesto-.*\.xlsx$/.test(nombre), `archivo=${nombre}`];
  });

  await caso('TECLADO y 390 px', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrir(page);
    const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await abrir(page);
    let enCampo = false;
    for (let i = 0; i < 80 && !enCampo; i++) {
      await page.keyboard.press('Tab');
      enCampo = await page.evaluate(() => document.activeElement?.id?.startsWith('q-') === true);
    }
    return [!desborda && enCampo, `desborda=${desborda} · foco alcanza una cantidad=${enCampo}`];
  });
  await ctx.close();

  const t = await entrar(tecnico);
  await caso('PANTALLA sin permiso: lo dice, y el menú no ofrece la entrada', async () => {
    const enMenu = await t.page.getByRole('link', { name: 'Presupuesto', exact: true }).count();
    await t.page.goto(`${WEB}/organizaciones/${COOP}/presupuesto`);
    await t.page.getByRole('heading', { level: 1, name: 'Presupuesto de preparación' }).waitFor({ timeout: 20000 });
    const texto = await t.page.locator('main').innerText();
    const dice = /Tu rol no participa en el presupuesto/.test(texto);
    return [enMenu === 0 && dice && !/no hay datos|sin registros/i.test(texto),
      `entradas en el menú=${enMenu} · mensaje propio=${dice}`];
  });
  await t.ctx.close();
} finally {
  await navegador.close();
}

const ok = resultados.every(Boolean);
console.log(`\nP1-010 presupuesto de preparación: ${ok ? 'APROBADO' : 'CON FALLAS'} (${resultados.filter(Boolean).length}/${resultados.length} casos)`);
process.exitCode = ok ? 0 : 1;
