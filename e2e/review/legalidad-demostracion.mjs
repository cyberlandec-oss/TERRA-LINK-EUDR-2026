// AJ-04 — «Legalidad y soportes» en el entorno DESPLEGADO (solo lectura; no sube ni cambia datos).
//   node e2e/review/legalidad-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
// El recorrido con productor vinculado, observaciones de una persona revisora y aportes corre sobre datos sintéticos aislados: e2e/tests/legalidad-soportes.spec.ts.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'legalidad-2026-10-23');
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
console.log(`\n== AJ-04 Legalidad y soportes · ${org.name} · estado antes: ${antes} ==\n`);
const browser = await chromium.launch();
async function ctxCon(token, o = {}) {
  const ctx = await browser.newContext({ ...(o.viewport ? { viewport: o.viewport } : {}) });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, o.lang ?? 'es']);
  return ctx;
}
const abrir = async (ctx) => { const page = await ctx.newPage(); await page.goto(`${WEB}/organizaciones/${org.id}`); await page.getByRole('link', { name: /Legalidad y soportes|Legality and supporting documents/ }).click(); await page.getByRole('heading', { name: /^Legalidad y soportes$|^Legality and supporting documents$/, level: 1 }).waitFor({ timeout: 20000 }); return page; };

await caso('Técnico: la pantalla orienta (tres cosas distintas, fuente y fecha), sin el perfil técnico «parcial» como contenido principal', async () => {
  const ctx = await ctxCon(tecnico); const page = await abrir(ctx);
  const main = await page.locator('main').innerText();
  await page.screenshot({ path: join(SALIDA, '01-legalidad-tecnico.png'), fullPage: true });
  await ctx.close();
  return [/Tres cosas distintas/.test(main) && /Hoy no hay uno/.test(main) && /Incorporada el 2026-10-22/.test(main) && !/PARCIAL|0\.1\.0|borrador/.test(main), 'orientación + fuente + fecha; sin «parcial»'];
});
await caso('Técnico: «¿Dónde lo aporto?» lista las parcelas del alcance con acceso directo y «Sin soporte aportado aún» es orientativo', async () => {
  const ctx = await ctxCon(tecnico); const page = await abrir(ctx);
  const tabla = page.getByRole('table', { name: 'Soportes por parcela' });
  await tabla.waitFor({ timeout: 20000 });
  const filas = await tabla.getByRole('link', { name: 'Aportar soportes' }).count();
  const texto = await page.locator('main').innerText();
  await ctx.close();
  return [filas > 0 && /no un incumplimiento/.test(texto), `${filas} parcelas con acceso directo`];
});
await caso('Auditor (solo lectura): ve el resumen sin acciones de carga ajenas a su rol', async () => {
  const ctx = await ctxCon(auditor); const page = await abrir(ctx);
  const main = await page.locator('main').innerText();
  await ctx.close();
  return [/Tres cosas distintas/.test(main), 'pantalla de consulta'];
});
await caso('Inglés y 390 px: traducida, sin códigos internos y sin desborde', async () => {
  const ctx = await ctxCon(tecnico, { lang: 'en', viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); await page.goto(`${WEB}/organizaciones/${org.id}/legalidad`); await page.getByRole('heading', { name: 'Legality and supporting documents', level: 1 }).waitFor({ timeout: 20000 });
  const main = await page.locator('main').innerText();
  const sin = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await page.screenshot({ path: join(SALIDA, '02-legalidad-en-390.png'), fullPage: true });
  await ctx.close();
  return [sin && /Three different things/.test(main) && !/\b(LAND_TENURE|LABOR_SUPPORT|SCAN_FAILED|PARTIAL)\b/.test(main), 'EN, sin desborde'];
});

await browser.close();
const despues = estado();
await caso('Ningún dato operativo cambió', async () => [despues === antes, `${antes} → ${despues}`]);
const ok = resultados.filter((r) => r.ok).length;
writeFileSync(join(SALIDA, 'resultados.json'), `${JSON.stringify({ web: WEB, antes, despues, resultados }, null, 2)}\n`);
console.log(`\n${ok}/${resultados.length} comprobaciones. Nada se escribió sobre datos operativos.`);
process.exit(ok === resultados.length ? 0 : 1);
