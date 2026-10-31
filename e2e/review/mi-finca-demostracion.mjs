// A-05 — «Mi finca» y documentos EN CONTEXTO: demostración en el entorno DESPLEGADO.
//
//   node e2e/review/mi-finca-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// NO sube documentos ni cambia datos operativos: solo lee y muestra. Con las cuentas DEMO reales demuestra el ESTADO REAL de cada una —la cuenta DEMO de productor NO tiene vínculo
// cuenta–productor, así que ve «configuración pendiente», que es distinto de «sin datos» y de «sin permiso»—, la guía orientativa en la parcela, y los roles sin «Mi finca».
// El recorrido con una cuenta VINCULADA (parcelas propias, pendientes derivados, carga que queda «pendiente de revisión», aislamiento) corre sobre datos sintéticos aislados:
// `e2e/tests/mi-finca.spec.ts` (9 pruebas).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'mi-finca-2026-10-23');
mkdirSync(SALIDA, { recursive: true });
const resultados = [];
async function caso(titulo, fn) {
  try { const [ok, detalle] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(108)} ${detalle ?? ''}`); resultados.push({ titulo, ok, detalle }); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(108)} ${String(e.message).slice(0, 240)}`); resultados.push({ titulo, ok: false, detalle: String(e.message).slice(0, 240) }); }
}
const pedir = async (t, p) => { const r = await fetch(API + p, { headers: { authorization: `Bearer ${t}` } }); const x = await r.text(); let b = null; try { b = JSON.parse(x); } catch { b = x; } return { s: r.status, b }; };
const login = async (cta) => { const c = cuentaDemo(cta); const r = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) }); return (await r.json()).access_token; };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
const db = (sql) => execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-At', '-F', '|', '-c', sql], { encoding: 'utf8' }).trim();
const estado = () => db("select (select count(*) from documents)||'/'||(select count(*) from document_versions)||'/'||(select count(*) from plots)||'/'||(select count(*) from plot_versions)||'/'||(select count(*) from producers)");

const productor = await login('productor.cooperativa'); const tecnico = await login('tecnico1.cooperativa'); const auditor = await login('auditor.cooperativa');
const orgs = lista((await pedir(tecnico, '/api/v1/organizations')).b);
const org = orgs.find((o) => o.name.includes('Cooperativa'));
const plot = lista((await pedir(tecnico, `/api/v1/organizations/${org.id}/plots?status=ACTIVE&limit=100`)).b)[0];
const antes = estado();
console.log(`\n== A-05 Mi finca · ${org.name} · estado antes (documentos/versiones/parcelas/versiones de parcela/productores): ${antes} ==\n`);

const browser = await chromium.launch();
async function ctxCon(token, o = {}) {
  const ctx = await browser.newContext({ ...(o.viewport ? { viewport: o.viewport } : {}) });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, o.lang ?? 'es']);
  return ctx;
}

await caso('Productor DEMO (cuenta sin vínculo): «configuración pendiente», no «sin datos» ni «sin permiso»; dice cómo se resuelve y no muestra nada ajeno', async () => {
  const ctx = await ctxCon(productor); const page = await ctx.newPage();
  await page.goto(`${WEB}/organizaciones/${org.id}`);
  await page.getByRole('complementary', { name: 'Navegación principal' }).getByRole('link', { name: 'Mi finca', exact: true }).click();
  await page.getByText('Tu cuenta todavía no está vinculada a un productor.').waitFor({ timeout: 20000 });
  const cuerpo = await page.locator('main').innerText();
  await page.screenshot({ path: join(SALIDA, '01-cuenta-sin-vinculo.png'), fullPage: true });
  const tablas = await page.getByRole('table').count();
  await ctx.close();
  return [/configuración pendiente, no un error ni que no tengas datos/.test(cuerpo) && /Vincular cuenta/.test(cuerpo) && !/Tu rol no incluye «Mi finca»/.test(cuerpo) && tablas === 0 && estado() === antes, 'configuración pendiente + cómo resolverla; sin tablas ni datos de otros'];
});

await caso('Productor DEMO (sin vínculo): «Mis entregas» dice que no hay entregas por falta de vínculo, no un error de permiso ni un portal vacío', async () => {
  const ctx = await ctxCon(productor); const page = await ctx.newPage();
  await page.goto(`${WEB}/organizaciones/${org.id}/mi-finca`);
  await page.getByText('Sin vínculo de cuenta no hay entregas que mostrar.').waitFor({ timeout: 20000 });
  const txt = await page.locator('main').innerText();
  await ctx.close();
  return [!/Tu rol no incluye la consulta de entregas/.test(txt) && !/Tu rol no incluye «Mi finca»/.test(txt), 'sin vínculo ≠ sin permiso ≠ sin datos'];
});

await caso('API con la cuenta DEMO de productor: el listado de entregas responde 200 (alcance propio, vacío por no tener vínculo) y el detalle de una entrega se rechaza (403); sin escrituras', async () => {
  const lis = await pedir(productor, `/api/v1/organizations/${org.id}/deliveries`);
  const ajena = lista((await pedir(tecnico, `/api/v1/organizations/${org.id}/deliveries`)).b)[0];
  const det = ajena ? await pedir(productor, `/api/v1/organizations/${org.id}/deliveries/${ajena.id}`) : { s: 403 };
  return [lis.s === 200 && lista(lis.b).length === 0 && [403, 404].includes(det.s) && estado() === antes, `listado ${lis.s} (${lista(lis.b).length} entregas) · detalle ${det.s}`];
});

await caso('Técnico asignado: la parcela muestra «Documentos y soportes» con su guía orientativa y fuente; no aparece «Mi finca» en su menú', async () => {
  const ctx = await ctxCon(tecnico); const page = await ctx.newPage();
  await page.goto(`${WEB}/organizaciones/${org.id}/parcelas/${plot.id}`);
  await page.getByRole('heading', { name: 'Documentos y soportes' }).waitFor({ timeout: 30000 });
  await page.getByText('Qué puedes documentar y por qué (guía orientativa)').click();
  const guia = await page.locator('details.guia-documental').innerText();
  await page.screenshot({ path: join(SALIDA, '02-parcela-documentos-guia.png'), fullPage: true });
  const enMenu = await page.getByRole('complementary', { name: 'Navegación principal' }).getByRole('link', { name: 'Mi finca', exact: true }).count();
  await ctx.close();
  return [/no una lista obligatoria|no es una lista obligatoria/.test(guia) && /Tenencia o derecho de uso/.test(guia) && /Referencia en las guías/.test(guia) && /Orientación, no un dictamen de aplicabilidad/.test(guia) && enMenu === 0 && estado() === antes, 'guía con fuente; sin «Mi finca» para el rol asignado'];
});

await caso('AJ-03 catálogo desplegado: los tipos ambiental, laboral y de terceros existen con su clasificación; ningún aspecto de la guía queda «sin tipo»; solo clasifican (nada obligatorio ni aprobado)', async () => {
  const t = (await pedir(tecnico, `/api/v1/organizations/${org.id}/document-types`)).b.types;
  const por = Object.fromEntries(t.map((x) => [x.code, x]));
  const ctx = await ctxCon(tecnico); const page = await ctx.newPage();
  await page.goto(`${WEB}/organizaciones/${org.id}/parcelas/${plot.id}`);
  await page.getByRole('heading', { name: 'Documentos y soportes' }).waitFor({ timeout: 30000 });
  await page.getByText('Qué puedes documentar y por qué (guía orientativa)').click();
  const guia = await page.locator('details.guia-documental').innerText();
  await ctx.close();
  const ok = por.ENVIRONMENTAL_SUPPORT?.classification === 'OPERATIONAL' && por.LABOR_SUPPORT?.classification === 'PERSONAL_DATA' && por.THIRD_PARTY_RIGHTS_SUPPORT?.classification === 'PERSONAL_DATA' && t.length === 7
    && /Tipo de documento disponible: Soporte ambiental/.test(guia) && /Soporte de derechos de terceros o comunidades/.test(guia) && /Soporte laboral/.test(guia) && !/El catálogo actual no tiene un tipo/.test(guia) && estado() === antes;
  return [ok, `${t.length} tipos: ${t.map((x) => x.code).join(', ')}`];
});

await caso('La guía no dice «certificado» ni promete aprobación: subir no aprueba (texto visible en la parcela)', async () => {
  const ctx = await ctxCon(tecnico); const page = await ctx.newPage();
  await page.goto(`${WEB}/organizaciones/${org.id}/parcelas/${plot.id}`);
  await page.getByRole('heading', { name: 'Documentos y soportes' }).waitFor({ timeout: 30000 });
  const txt = (await page.locator('section', { has: page.getByRole('heading', { name: 'Documentos y soportes' }) }).innerText());
  await ctx.close();
  return [/no lo aprueba ni acredita su autenticidad/.test(txt) && !/certificad|garantiza/i.test(txt), 'sin lenguaje de certificación'];
});

await caso('Auditor: sin «Mi finca» (sin permiso) y la ruta directa lo explica', async () => {
  const ctx = await ctxCon(auditor); const page = await ctx.newPage();
  await page.goto(`${WEB}/organizaciones/${org.id}/mi-finca`);
  await page.getByText(/Tu rol no incluye «Mi finca»/).waitFor({ timeout: 20000 });
  await ctx.close();
  return [true, 'explicación en la ruta directa'];
});

await caso('Inglés y 390 px: la pantalla de la cuenta sin vínculo se traduce y no desborda', async () => {
  const ctx = await ctxCon(productor, { lang: 'en', viewport: { width: 390, height: 844 } }); const page = await ctx.newPage();
  await page.goto(`${WEB}/organizaciones/${org.id}/mi-finca`);
  await page.getByText('Your account is not linked to a producer yet.').waitFor({ timeout: 20000 });
  const sin = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await page.screenshot({ path: join(SALIDA, '03-cuenta-sin-vinculo-en-390.png'), fullPage: true });
  await ctx.close();
  return [sin, 'EN, sin desborde'];
});

await browser.close();
const despues = estado();
await caso('Ningún dato operativo cambió: documentos, versiones, parcelas y productores idénticos', async () => [despues === antes, `${antes} → ${despues}`]);
const ok = resultados.filter((r) => r.ok).length;
writeFileSync(join(SALIDA, 'resultados.json'), `${JSON.stringify({ web: WEB, antes, despues, resultados }, null, 2)}\n`);
console.log(`\n${ok}/${resultados.length} comprobaciones. Nada se escribió sobre datos operativos.`);
process.exit(ok === resultados.length ? 0 : 1);
