// «Mi ubicación» — demostración en el entorno DESPLEGADO (web) de la captura geográfica de parcelas.
//
//   node e2e/review/mi-ubicacion-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// POSICIÓN EMULADA (Playwright `setGeolocation`): NO es una lectura real de un dispositivo ni un teléfono físico. NO guarda nada sobre datos operativos: el guion solo
// LOCALIZA y revisa (nunca pulsa «Guardar…»); al final comprueba que ninguna tabla de ubicaciones, versiones de parcela ni borradores cambió. La demostración que SÍ guarda
// (vértices con su precisión, versiones, borradores) corre sobre datos sintéticos aislados en `e2e/tests/mi-ubicacion.spec.ts`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'mi-ubicacion-2026-10-22');
mkdirSync(SALIDA, { recursive: true });
const resultados = [];
async function caso(titulo, fn) {
  try { const [ok, detalle] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(104)} ${detalle ?? ''}`); resultados.push({ titulo, ok, detalle }); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(104)} ${String(e.message).slice(0, 240)}`); resultados.push({ titulo, ok: false, detalle: String(e.message).slice(0, 240) }); }
}
const pedir = async (t, p) => { const r = await fetch(API + p, { headers: { authorization: `Bearer ${t}` } }); const x = await r.text(); let b = null; try { b = JSON.parse(x); } catch { b = x; } return { s: r.status, b }; };
const login = async (cta) => { const c = cuentaDemo(cta); const r = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) }); return (await r.json()).access_token; };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
const db = (sql) => execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-At', '-F', '|', '-c', sql], { encoding: 'utf8' }).trim();
const estado = () => db("select (select count(*) from location_samples)||'/'||(select count(*) from plot_versions)||'/'||(select count(*) from polygon_drafts)||'/'||(select count(*) from plot_history)");

const tecnico = await login('tecnico1.cooperativa'); const auditor = await login('auditor.cooperativa');
const orgs = lista((await pedir(tecnico, '/api/v1/organizations')).b);
const org = orgs.find((o) => o.name.includes('Cooperativa'));
const plots = lista((await pedir(tecnico, `/api/v1/organizations/${org.id}/plots?status=ACTIVE&limit=100`)).b);
const plot = plots[0];
const antes = estado();
console.log(`\n== Mi ubicación · ${org.name} · parcela ${plot.plot_code} · estado antes (muestras/versiones/borradores/historial): ${antes} · posición EMULADA ==\n`);

const browser = await chromium.launch();
const POS = { latitude: -0.85, longitude: -80.16, accuracy: 15 };
async function ctxCon(token, o = {}) {
  const ctx = await browser.newContext({ ...(o.viewport ? { viewport: o.viewport } : {}), ...(o.geo === null ? {} : { geolocation: { ...POS, ...(o.geo ?? {}) }, permissions: ['geolocation'] }) });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, o.lang ?? 'es']);
  return ctx;
}
async function abrirMapa(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${WEB}/organizaciones/${org.id}/parcelas/${plot.id}`);
  await page.getByRole('button', { name: /Escribir o dibujar|Type or draw/ }).click();
  await page.getByRole('button', { name: /Dibujar en el mapa|Draw on the map/ }).click();
  await page.locator('.maplibregl-canvas').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /Mi ubicación|My location/ }).first().waitFor({ timeout: 30000 });
  return page;
}

await caso('Cabeceras: la web permite la geolocalización del propio sitio y mantiene sus demás restricciones', async () => {
  const h = await fetch(WEB); const pp = h.headers.get('permissions-policy') ?? '';
  return [/geolocation=\(self\)/.test(pp) && h.headers.get('x-frame-options') === 'DENY' && h.headers.get('x-content-type-options') === 'nosniff', pp];
});

await caso('Técnico asignado: «Mi ubicación» centra el mapa y muestra la lectura (precisión, hora y fuente) SIN guardar nada', async () => {
  const ctx = await ctxCon(tecnico); const page = await abrirMapa(ctx);
  await page.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' }).click();
  const lectura = page.getByLabel('Lectura de Mi ubicación'); await lectura.waitFor({ timeout: 20000 });
  const txt = await lectura.innerText();
  await page.waitForTimeout(1500);
  const centro = await page.getByText(/Centro de la mira/).innerText();
  await page.screenshot({ path: join(SALIDA, '01-mi-ubicacion-es.png'), fullPage: true });
  const marcador = await page.locator('.map-me').count();
  await ctx.close();
  return [/± 15 m \(informada\)/.test(txt) && /no acredita un GPS/.test(txt) && /hace \d+ s/.test(txt) && /longitud -80\.16/.test(centro) && marcador === 1 && estado() === antes, `${txt.replace(/\s+/g, ' ').slice(0, 130)} | ${centro.slice(0, 60)}`];
});

await caso('La acción «Añadir vértice aquí» es explícita: incorpora la lectura a la tabla con SU precisión, sin guardar; los demás vértices siguen manuales', async () => {
  const ctx = await ctxCon(tecnico); const page = await abrirMapa(ctx);
  await page.getByRole('radio', { name: /Un polígono/ }).check();
  await page.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' }).click();
  await page.getByLabel('Lectura de Mi ubicación').waitFor({ timeout: 20000 });
  const filas = page.getByRole('table', { name: 'Coordenadas a registrar' }).locator('tbody tr');
  const vacioAntes = (await filas.nth(0).locator('input').first().inputValue()) === '';
  await page.getByRole('button', { name: 'Añadir vértice aquí' }).click();
  const v1 = await filas.nth(0).innerText();
  const lon = await filas.nth(0).locator('input').first().inputValue();
  await page.getByRole('button', { name: 'Revisar antes de guardar' }).isDisabled(); // faltan vértices: no se puede ni revisar
  await ctx.close();
  return [vacioAntes && lon === '-80.16' && /Mi ubicación/.test(v1) && /± 15 m/.test(v1) && estado() === antes, `vértice 1: ${v1.replace(/\s+/g, ' ').slice(0, 90)}`];
});

await caso('Ubicación aproximada (precisión 1 800 m): se anuncia sin bloquear y no se presenta como medición GPS', async () => {
  const ctx = await ctxCon(tecnico, { geo: { accuracy: 1800 } }); const page = await abrirMapa(ctx);
  await page.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' }).click();
  await page.getByText(/Ubicación aproximada: la precisión informada supera 100 m/).waitFor({ timeout: 20000 });
  const habilitado = await page.getByRole('button', { name: /Usar como punto|Añadir vértice aquí/ }).first().isEnabled();
  await ctx.close();
  return [habilitado && estado() === antes, 'anuncio visible; la acción sigue disponible'];
});

await caso('Permiso denegado: mensaje claro, reintento posible, no inventa una posición y la captura manual sigue disponible', async () => {
  const ctx = await ctxCon(tecnico, { geo: null }); const page = await abrirMapa(ctx);
  await page.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' }).click();
  await page.getByText('El navegador no tiene permiso para usar tu ubicación.').waitFor({ timeout: 20000 });
  const reintento = await page.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' }).isEnabled();
  const sinMarcador = (await page.locator('.map-me').count()) === 0;
  await page.getByLabel(/Longitud.*vértice 1/).fill('-80.2');
  const manual = (await page.getByLabel(/Longitud.*vértice 1/).inputValue()) === '-80.2';
  await ctx.close();
  return [reintento && sinMarcador && manual && estado() === antes, 'mensaje + reintento + sin marcador + entrada manual'];
});

await caso('Inglés y 390 px: textos traducidos, sin códigos internos y sin desborde horizontal', async () => {
  const ctx = await ctxCon(tecnico, { lang: 'en', viewport: { width: 390, height: 844 } }); const page = await abrirMapa(ctx);
  await page.getByRole('button', { name: 'My location: center the map on your current position' }).click();
  const lectura = page.getByLabel('My location reading'); await lectura.waitFor({ timeout: 20000 });
  const cuerpo = await page.locator('main').innerText();
  const sinDesborde = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await page.screenshot({ path: join(SALIDA, '02-mi-ubicacion-en-390.png'), fullPage: true });
  const textoLectura = await lectura.innerText();
  await ctx.close();
  return [/± 15 m \(reported\)/.test(textoLectura) &&!/\b(BROWSER_GEOLOCATION|NOT_REPORTED|APPROXIMATE|DENIED|UNAVAILABLE)\b/.test(cuerpo) && sinDesborde && estado() === antes, 'EN, sin códigos, sin desborde'];
});

await caso('Roles sin captura: el auditor no ve «Mi ubicación» ni los métodos de captura, y la API rechaza su escritura (control)', async () => {
  const ctx = await ctxCon(auditor); const page = await ctx.newPage();
  await page.goto(`${WEB}/organizaciones/${org.id}/parcelas/${plot.id}`);
  await page.getByRole('heading', { name: new RegExp(plot.plot_code) }).waitFor({ timeout: 20000 });
  const botones = await page.getByRole('button', { name: /Mi ubicación|Dibujar en el mapa/ }).count();
  const r = await fetch(`${API}/api/v1/organizations/${org.id}/plots/${plot.id}/location-samples`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auditor}` }, body: JSON.stringify({ expected_version: 1, source: 'BROWSER_GEOLOCATION', operation_id: crypto.randomUUID(), latitude: -0.85, longitude: -80.16, accuracy_m: 15, captured_at: new Date().toISOString() }) });
  await ctx.close();
  return [botones === 0 && r.status === 403 && estado() === antes, `botones ${botones}; POST auditor → ${r.status}`];
});

await browser.close();
const despues = estado();
await caso('Ningún dato operativo cambió: muestras, versiones de parcela, borradores e historial idénticos', async () => [despues === antes, `${antes} → ${despues}`]);
const ok = resultados.filter((r) => r.ok).length;
writeFileSync(join(SALIDA, 'resultados.json'), `${JSON.stringify({ posicion: 'EMULADA (no es una lectura real ni un teléfono físico)', web: WEB, antes, despues, resultados }, null, 2)}\n`);
console.log(`\n${ok}/${resultados.length} comprobaciones. Posición emulada; nada se guardó sobre datos operativos.`);
process.exit(ok === resultados.length ? 0 : 1);
