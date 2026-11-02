// RF-33 — Recorrido COMPLETO de la referencia pública en navegador real y por API.
//
//   node e2e/review/referencia-qr.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Lo que tiene que quedar demostrado, de punta a punta:
//   1. obtener el identificador y su enlace **desde la interfaz**;
//   2. copiarlo y obtener su **representación prevista** (el QR);
//   3. **abrirlo hasta el recurso correcto**, conservando sesión, permisos y alcance;
//   4. que el enlace **no concede acceso**: ajeno e inexistente responden igual, y sin sesión no abre;
//   5. **teclado**, **390 px** y **estabilidad** del identificador.
//
// No modifica datos: todo es lectura.
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
    console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(64)} ${detalle}`);
    resultados.push(ok);
  } catch (e) {
    console.log(`FALLA ${titulo.padEnd(64)} ${e.message}`);
    resultados.push(false);
  }
}

async function sesion(local) {
  const c = cuentaDemo(local);
  const r = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) });
  if (!r.ok) throw new Error(`login de ${local}: ${r.status}`);
  return { cuenta: c, token: (await r.json()).access_token };
}
const pedir = async (token, path) => {
  const r = await fetch(`${API}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const texto = await r.text();
  let body = null; try { body = JSON.parse(texto); } catch { /* SVG u otro */ }
  return { status: r.status, body, texto };
};

const admin = await sesion('admin.cooperativa');
const comprador = await sesion('comprador.importador');   // de OTRA organización

const lotes = await pedir(admin.token, `/api/v1/organizations/${COOP}/lots`);
const lote = exigeEntrada('lote de la cooperativa', (lotes.body?.items ?? lotes.body ?? [])[0]?.id);
const detalle = await pedir(admin.token, `/api/v1/organizations/${COOP}/lots/${lote}`);
const referencia = exigeEntrada('referencia pública del lote', (detalle.body?.lot ?? detalle.body)?.public_reference);

// ------------------------------------------------------------------ API: enlace, QR y denegaciones

await caso('El enlace se obtiene autorizado y apunta a la resolución', async () => {
  const r = await pedir(admin.token, `/api/v1/public-references/${referencia}/link`);
  const ok = r.status === 200 && r.body.link.endsWith(`/r/${referencia}`);
  return [ok, `${r.status} · ${r.body?.link}`];
});

await caso('El enlace NO lleva identificadores internos ni datos de nadie', async () => {
  const r = await pedir(admin.token, `/api/v1/public-references/${referencia}/link`);
  const fallos = [lote, COOP].filter((v) => r.body.link.includes(v));
  const avisa = /no concede acceso/i.test(r.body.note) && /no sustituye un dds/i.test(r.body.note);
  return [fallos.length === 0 && avisa, `sin identificadores=${fallos.length === 0} · declara sus límites=${avisa}`];
});

await caso('El QR se emite autorizado, es SVG y es ESTABLE', async () => {
  const a = await pedir(admin.token, `/api/v1/public-references/${referencia}/qr.svg`);
  const b = await pedir(admin.token, `/api/v1/public-references/${referencia}/qr.svg`);
  const ok = a.status === 200 && a.texto.startsWith('<svg ') && a.texto === b.texto;
  return [ok, `${a.status} · ${a.texto.length} bytes · idéntico entre llamadas=${a.texto === b.texto}`];
});

await caso('DENEGACIÓN: una cuenta de otra organización no obtiene QR ni enlace', async () => {
  const q = await pedir(comprador.token, `/api/v1/public-references/${referencia}/qr.svg`);
  const l = await pedir(comprador.token, `/api/v1/public-references/${referencia}/link`);
  // Y la denegación es un error normalizado, no un SVG rotulado como imagen.
  const json = q.body?.error?.code === 'NOT_FOUND';
  return [q.status === 404 && l.status === 404 && json, `qr=${q.status} enlace=${l.status} · error legible=${json}`];
});

await caso('DENEGACIÓN: una referencia inexistente responde IGUAL que una ajena', async () => {
  const inexistente = '0'.repeat(24);
  const a = await pedir(comprador.token, `/api/v1/public-references/${referencia}`);
  const b = await pedir(comprador.token, `/api/v1/public-references/${inexistente}`);
  const igual = a.status === b.status && a.body?.error?.code === b.body?.error?.code && a.body?.error?.message === b.body?.error?.message;
  return [igual, `ajena=${a.status} inexistente=${b.status} · indistinguibles=${igual}`];
});

await caso('DENEGACIÓN: sin sesión no hay enlace ni QR', async () => {
  const a = await pedir(null, `/api/v1/public-references/${referencia}/link`);
  const b = await pedir(null, `/api/v1/public-references/${referencia}/qr.svg`);
  return [a.status === 401 && b.status === 401, `enlace=${a.status} qr=${b.status}`];
});

// ------------------------------------------------------------------ NAVEGADOR: obtener, copiar, abrir

const navegador = await chromium.launch();
try {
  const ctx = await navegador.newContext({ locale: 'es-EC', viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const entrar = async (c) => {
    await page.goto(WEB);
    await page.getByLabel('Correo').fill(c.cuenta.email);
    await page.getByLabel('Contraseña').fill(c.cuenta.contrasena);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.waitForLoadState('networkidle');
  };
  const esperar = (re, ms = 10000) => page.waitForFunction((f) => new RegExp(f).test(document.body.innerText), re.source, { timeout: ms });

  await entrar(admin);

  await caso('INTERFAZ: la referencia y su enlace se obtienen desde la pantalla del lote', async () => {
    await page.goto(`${WEB}/organizaciones/${COOP}/lotes/${lote}`);
    await esperar(/Referencia pública/);
    const valor = await page.getByLabel('Enlace de resolución').inputValue();
    const visible = await page.getByText(referencia, { exact: false }).first().isVisible();
    return [valor.endsWith(`/r/${referencia}`) && visible, `enlace en pantalla: ${valor}`];
  });

  await caso('INTERFAZ: declara que no concede acceso y que no sustituye un DDS', async () => {
    const t = await page.locator('body').innerText();
    return [/no concede acceso/i.test(t) && /no sustituye un dds/i.test(t), 'ambos avisos presentes'];
  });

  await caso('TECLADO: se copia el enlace sin ratón y se avisa del resultado', async () => {
    const boton = page.getByRole('button', { name: 'Copiar enlace' });
    await boton.focus();
    const enfocado = await boton.evaluate((el) => el === document.activeElement);
    await page.keyboard.press('Enter');
    await esperar(/Enlace copiado/);
    const portapapeles = await page.evaluate(() => navigator.clipboard.readText());
    return [enfocado && portapapeles.endsWith(`/r/${referencia}`), `foco=${enfocado} · portapapeles=${portapapeles}`];
  });

  await caso('TECLADO: el QR se despliega con Enter y aparece el código', async () => {
    const boton = page.getByRole('button', { name: 'Ver código QR' });
    await boton.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#ref-qr svg', { timeout: 10000 });
    const modulos = await page.locator('#ref-qr svg path').count();
    const expandido = await page.getByRole('button', { name: /QR/ }).getAttribute('aria-expanded');
    return [modulos > 0 && expandido === 'true', `svg con ${modulos} trazado(s) · aria-expanded=${expandido}`];
  });

  await caso('ABRIR: el enlace lleva al RECURSO correcto conservando la sesión', async () => {
    await page.goto(`${WEB}/r/${referencia}`);
    await page.waitForURL(new RegExp(`/organizaciones/${COOP}/lotes/${lote}$`), { timeout: 15000 });
    await esperar(/Lote /);
    return [page.url().endsWith(`/lotes/${lote}`), `terminó en ${page.url().replace(WEB, '')}`];
  });

  await caso('ABRIR: una referencia inexistente no revela nada', async () => {
    await page.goto(`${WEB}/r/${'0'.repeat(24)}`);
    await esperar(/No hay ningún recurso a tu alcance|no revela/i);
    const t = await page.locator('body').innerText();
    return [/no revela qué recursos existen/i.test(t), 'explica que la respuesta es la misma en los tres casos'];
  });

  await caso('ABRIR: una cuenta de otra organización no llega al recurso', async () => {
    await entrar(comprador);
    await page.goto(`${WEB}/r/${referencia}`);
    await esperar(/No hay ningún recurso a tu alcance|no revela/i);
    return [!page.url().includes(`/lotes/${lote}`), `se quedó en ${page.url().replace(WEB, '')}`];
  });

  await caso('ABRIR: sin sesión pide iniciarla y no abre nada', async () => {
    await ctx.clearCookies();
    await page.goto(WEB);
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* sin almacenamiento */ } });
    await page.goto(`${WEB}/r/${referencia}`);
    await esperar(/Inicia sesión|no concede acceso/i);
    return [!page.url().includes(`/lotes/${lote}`), 'pide iniciar sesión, no abre el recurso'];
  });

  await caso('390 px: la sección se usa sin desbordamiento horizontal', async () => {
    await entrar(admin);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${WEB}/organizaciones/${COOP}/lotes/${lote}`);
    await esperar(/Referencia pública/);
    await page.getByRole('button', { name: 'Ver código QR' }).click();
    await page.waitForSelector('#ref-qr svg', { timeout: 10000 });
    const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const qrVisible = await page.locator('#ref-qr svg').isVisible();
    return [!desborda && qrVisible, `desborda=${desborda} · QR visible=${qrVisible}`];
  });
} finally {
  await navegador.close();
}

const ok = resultados.every(Boolean);
console.log(`\nRF-33 recorrido de referencia y QR: ${ok ? 'APROBADO' : 'CON FALLAS'} (${resultados.filter(Boolean).length}/${resultados.length} casos)`);
process.exitCode = ok ? 0 : 1;
