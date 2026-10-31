// Revisión en NAVEGADOR REAL de la pantalla de perfil jurídico (P1-005).
//
//   node e2e/review/perfil-juridico-navegador.mjs [--web http://localhost:3000]
//
// Por qué existe, además del recorrido HTTP: **10/10 en la API no es una revisión de interfaz**. Aquí se abre
// la pantalla de verdad, con una cuenta DEMO real, y se comprueba lo que una persona ve y puede hacer:
// preparar, aplicabilidad, evidencia, resultado e historial, **con teclado** y **a 390 px**.
//
// No modifica datos que queden: retira el perfil que adopta.
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';
import { crearRevision, exigeEntrada } from './comprobacion.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const COOP = 'e8dbdab9-08ec-4867-908e-f23138dbca28';

const rev = crearRevision('P1-005 en navegador: pantalla real, teclado y 390 px');

/** Caso de interfaz: no hay estado HTTP, así que se declara el veredicto y su detalle. */
async function caso(titulo, fn) {
  try {
    const [ok, detalle] = await fn();
    console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(62)} ${detalle}`);
    return ok;
  } catch (e) {
    console.log(`FALLA ${titulo.padEnd(62)} ${e.message}`);
    return false;
  }
}

/** Espera a que el texto aparezca en la página. `networkidle` no basta: la red calla antes de que React pinte. */
async function esperarTexto(page, re, ms = 10000) {
  await page.waitForFunction((fuente) => new RegExp(fuente).test(document.body.innerText), re.source, { timeout: ms });
}

const admin = cuentaDemo('admin.cooperativa');
const eudr = cuentaDemo('eudr.cooperativa');

// Preparación por API: una parcela y el perfil adoptado, para que la pantalla tenga algo que enseñar.
async function api(cuenta, metodo, path, cuerpo) {
  const login = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: cuenta.email, password: cuenta.contrasena }) });
  const { access_token } = await login.json();
  const r = await fetch(`${API}${path}`, { method: metodo, headers: { authorization: `Bearer ${access_token}`, ...(cuerpo ? { 'content-type': 'application/json' } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const parcelas = await api(admin, 'GET', `/api/v1/organizations/${COOP}/plots`);
const parcela = exigeEntrada('parcela de la cooperativa', (parcelas.body?.items ?? parcelas.body ?? [])[0]?.id);
await api(admin, 'POST', `/api/v1/organizations/${COOP}/legal-profile/adoptions`, { operation_id: crypto.randomUUID(), version: '0.1.0', decision: 'ADOPT', reason: 'Revisión en navegador' });

const navegador = await chromium.launch();
const resultados = [];
try {
  const ctx = await navegador.newContext({ locale: 'es-EC', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(WEB);
  await page.getByLabel('Correo').fill(eudr.email);
  await page.getByLabel('Contraseña').fill(eudr.contrasena);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForLoadState('networkidle');

  resultados.push(await caso('La pantalla está en el menú y se abre', async () => {
    await page.goto(`${WEB}/organizaciones/${COOP}/perfil-juridico`);
    await page.waitForLoadState('networkidle');
    const h1 = await page.getByRole('heading', { level: 1 }).first().textContent();
    return [/[Pp]erfil jurídico/.test(h1 ?? ''), `encabezado: «${(h1 ?? '').trim()}»`];
  }));

  resultados.push(await caso('Avisa de entrada que NO acredita: parcial y sin revisión jurídica', async () => {
    const texto = await page.locator('body').innerText();
    const parcial = /PARCIAL/i.test(texto);
    const pendiente = /revisión jurídica (PENDIENTE|pendiente)/i.test(texto);
    const noHabilita = /no habilita READY|no satisface/i.test(texto);
    return [parcial && pendiente && noHabilita, `parcial=${parcial} · revisión pendiente=${pendiente} · lo declara=${noHabilita}`];
  }));

  resultados.push(await caso('Las fuentes distinguen obtenido, contrastado y vigencia revisada', async () => {
    const texto = await page.locator('body').innerText();
    const columnas = /Obtenido/i.test(texto) && /Contrastado/i.test(texto) && /Vigencia revisada/i.test(texto);
    const identificada = /sha256/i.test(texto) && /página impresa/i.test(texto);
    return [columnas && identificada, `tres columnas=${columnas} · copia identificada por huella y página=${identificada}`];
  }));

  resultados.push(await caso('Las reglas se presentan como CANDIDATAS, no aprobadas', async () => {
    const n = await page.getByText('Candidata', { exact: true }).count();
    return [n >= 4, `${n} reglas marcadas como candidata`];
  }));

  resultados.push(await caso('El rol EUDR no ve el botón de adoptar (su permiso no lo permite)', async () => {
    const texto = await page.locator('body').innerText();
    const sinBoton = (await page.getByRole('button', { name: /Adoptar el perfil|Retirar el perfil/ }).count()) === 0;
    const loDice = /no permite adoptar/i.test(texto);
    return [sinBoton && loDice, `botón ausente=${sinBoton} · lo explica=${loDice}`];
  }));

  resultados.push(await caso('Preparar una parcela: los requisitos nacen DESCONOCIDOS', async () => {
    await page.getByLabel('Identificador de la parcela').fill(parcela);
    await page.getByRole('button', { name: 'Preparar' }).click();
    await esperarTexto(page, /Revisión de la parcela/);
    await esperarTexto(page, /No evaluable/);
    // Se cuentan las CELDAS de la tabla, no el texto suelto: «Aplicable» también es el nombre de un botón.
    const desconocidas = await page.getByRole('cell').filter({ hasText: /^Desconocida$/ }).count();
    return [desconocidas >= 4, `${desconocidas} requisitos en aplicabilidad desconocida`];
  }));

  resultados.push(await caso('TECLADO: se llega a «Aplicable» y se activa sin ratón', async () => {
    const boton = page.getByRole('button', { name: 'Aplicable' }).first();
    await boton.focus();
    const enfocado = await boton.evaluate((el) => el === document.activeElement);
    await page.keyboard.press('Enter');
    await esperarTexto(page, /Pendiente/);
    const pendiente = await page.getByRole('cell').filter({ hasText: /^Pendiente$/ }).count();
    return [enfocado && pendiente > 0, `foco por teclado=${enfocado} · tras Enter hay ${pendiente} requisito(s) en «Pendiente»`];
  }));

  resultados.push(await caso('El resultado y los pendientes quedan a la vista', async () => {
    const texto = await page.locator('body').innerText();
    return [/Pendientes: \d+/.test(texto) && /no acredita|tampoco requisito satisfecho/i.test(texto),
      `resumen visible=${/Pendientes: \d+/.test(texto)}`];
  }));

  resultados.push(await caso('HISTORIAL: se abre y muestra el cambio con su motivo', async () => {
    await page.getByRole('button', { name: 'Historial' }).first().click();
    await esperarTexto(page, /Historial del requisito/);
    // El historial del requisito que SÍ se cambió tiene que traer su fila y su motivo, no quedarse vacío.
    await esperarTexto(page, /Motivo del cambio/);
    const texto = await page.locator('body').innerText();
    const filas = await page.locator('table[aria-label="Historial"] tbody tr').count();
    return [filas >= 1 && /append-only/i.test(texto), `${filas} entrada(s) de historial, con motivo y nota de conservación`];
  }));

  resultados.push(await caso('390 px: la pantalla se usa sin desbordamiento horizontal', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const h1 = await page.getByRole('heading', { level: 1 }).first().isVisible();
    return [!desborda && h1, `scrollWidth>clientWidth=${desborda} · encabezado visible=${h1}`];
  }));

  resultados.push(await caso('390 px: las tablas anchas se desplazan dentro de su contenedor', async () => {
    const n = await page.locator('.table-wrap').count();
    return [n > 0, `${n} tabla(s) en contenedor desplazable`];
  }));
} finally {
  await navegador.close();
  await api(admin, 'POST', `/api/v1/organizations/${COOP}/legal-profile/adoptions`, { operation_id: crypto.randomUUID(), version: '0.1.0', decision: 'WITHDRAW', reason: 'Fin de la revisión en navegador' });
}

const ok = resultados.every(Boolean);
console.log(`\nRevisión en navegador: ${ok ? 'APROBADO' : 'CON FALLAS'} (${resultados.filter(Boolean).length}/${resultados.length} casos)`);
void rev;
process.exitCode = ok ? 0 : 1;
