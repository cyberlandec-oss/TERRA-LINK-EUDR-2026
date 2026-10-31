// AJ-05 — Análisis satelital (estado real, solo lectura) en el entorno DESPLEGADO (solo lectura; no sube ni cambia datos).
//   node e2e/review/satelite-estado-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
// El recorrido con productor vinculado, observaciones de una persona revisora y aportes corre sobre datos sintéticos aislados: e2e/tests/legalidad-soportes.spec.ts.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'satelite-2026-10-23');
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

const gestor = await login('eudr.cooperativa'); const productor = await login('productor.cooperativa'); const tecnico = await login('tecnico1.cooperativa'); const auditor = await login('auditor.cooperativa');
const orgs = lista((await pedir(tecnico, '/api/v1/organizations')).b);
const org = orgs.find((o) => o.name.includes('Cooperativa'));
const plot = lista((await pedir(tecnico, `/api/v1/organizations/${org.id}/plots?status=ACTIVE&limit=100`)).b)[0];
const antes = estado();
const estadoSat = () => db("select (select count(*) from satellite_jobs)||'/'||(select count(*) from satellite_results)||'/'||(select count(*) from satellite_credentials)");
const satAntes = estadoSat();
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript((t) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', 'es'); }, gestor);

await caso('El entorno desplegado NO hace llamadas reales: interruptor deshabilitado y Whisp solo «adaptador de desarrollo»', async () => {
  const r = await pedir(gestor, `/api/v1/organizations/${org.id}/satellite/providers`);
  const p = r.b;
  return [r.s === 200 && p.live_calls_enabled === false && p.selection.status === 'SELECTED_FOR_DEVELOPMENT', `live_calls_enabled=${p.live_calls_enabled}; ${p.selection.status}`];
});
await caso('Parcela: la tarjeta dice que el adaptador existe pero su uso real no está autorizado, no ofrece solicitar y explica los cuatro conceptos', async () => {
  const page = await ctx.newPage();
  await page.goto(`${WEB}/organizaciones/${org.id}/parcelas/${plot.id}`);
  const card = page.locator('section[aria-labelledby="sat-title"]');
  await card.waitFor({ timeout: 20000 });
  const texto = await card.innerText();
  await card.getByText('¿Qué es un mapa, un ensayo, una consulta real y un resultado guardado?').click();
  const botones = await card.getByRole('button', { name: /^Solicitar/ }).count();
  await page.screenshot({ path: join(SALIDA, '01-parcela-satelite.png'), fullPage: true });
  const abierto = await card.innerText();
  return [/El adaptador existe, pero su uso real no está autorizado/.test(texto) && botones === 0 && /Cartografía de orientación/.test(abierto) && !/deforestación confirmada/i.test(abierto), `botones de solicitud=${botones}`];
});
await caso('Los resultados existentes son de ENSAYO (fixture) y están separados de lo operativo; ninguno aparece como análisis real', async () => {
  const r = await pedir(gestor, `/api/v1/organizations/${org.id}/plots/${plot.id}/satellite`);
  const jobs = r.b.jobs;
  const reales = jobs.filter((j) => !j.is_ensayo);
  return [r.s === 200 && reales.length === 0 && r.b.analysis_status !== 'RESULT_AVAILABLE', `${jobs.length} trabajos, ${reales.length} reales, estado ${r.b.analysis_status}`];
});
const admin = await login('admin.cooperativa');
await caso('AJ-06 · credencial por organización: la ruta existe, el administrador la consulta, ningún valor se devuelve y quien no administra integraciones no puede', async () => {
  const r = await pedir(admin, `/api/v1/organizations/${org.id}/satellite/credentials`);
  const w = r.b.providers?.find((p) => p.provider_code === 'WHISP');
  const denegado = await pedir(auditor, `/api/v1/organizations/${org.id}/satellite/credentials`);
  const escribe = await fetch(`${API}/api/v1/organizations/${org.id}/satellite/credentials/WHISP`, { method: 'PUT', headers: { authorization: `Bearer ${auditor}`, 'content-type': 'application/json' }, body: JSON.stringify({ secret: 'no-se-guarda-0001' }) });
  return [r.s === 200 && w && w.configured === false && !/secret|ciphertext/i.test(JSON.stringify(r.b)) && escribe.status === 403, `GET ${r.s}; WHISP configurada=${w?.configured}; auditor PUT=${escribe.status} (GET auditor=${denegado.s})`];
});
await caso('AJ-06 · migración 0067 desplegada: las columnas existen y los trabajos anteriores no inventan avance, identificador ni cancelación', async () => {
  const cols = db("select count(*) from information_schema.columns where table_name='satellite_jobs' and column_name in ('provider_job_ref','provider_progress_percent','provider_progress_note','provider_progress_at','cancel_requested_at','cancel_requested_by','cancel_reason')");
  const vacios = db("select count(*) from satellite_jobs where provider_job_ref is null and provider_progress_percent is null and provider_progress_at is null and cancel_requested_at is null");
  const total = db('select count(*) from satellite_jobs');
  const version = await (await fetch(`${API}/version`)).json();
  return [cols === '7' && vacios === total && /0067|0068/.test(JSON.stringify(version)), `columnas=${cols}; trabajos sin avance/ref/cancelación=${vacios}/${total}; esquema ${version.schema?.applied ?? ''}`];
});
await caso('AJ-07 · migración 0068 y descarga de la respuesta original publicadas; los trabajos anteriores no quedan «inciertos»', async () => {
  const col = db("select count(*) from information_schema.columns where table_name='satellite_jobs' and column_name='provider_submit_started_at'");
  const inciertos = db('select count(*) from satellite_jobs where provider_submit_started_at is not null');
  const spec = await (await fetch(`${API}/api/docs-json`)).json();
  const ruta = Object.keys(spec.paths ?? {}).find((p) => p.endsWith('/satellite/analyses/{jobId}/original'));
  const sinPermiso = await pedir(auditor, `/api/v1/organizations/${org.id}/satellite/analyses/00000000-0000-4000-8000-000000000000/original`);
  return [col === '1' && inciertos === '0' && !!ruta && sinPermiso.s === 404, `columna=${col}; inciertos=${inciertos}; ruta=${ruta ? 'publicada' : 'ausente'}; trabajo inexistente→${sinPermiso.s}`];
});
await browser.close();
const despues = estadoSat();
await caso('Ningún dato satelital cambió (trabajos/resultados/credenciales)', async () => [despues === satAntes, `${satAntes} → ${despues}`]);
const ok = resultados.filter((r) => r.ok).length;
writeFileSync(join(SALIDA, 'resultados.json'), `${JSON.stringify({ resultados, satAntes, despues }, null, 2)}\n`);
console.log(`\n${ok}/${resultados.length} comprobaciones. Solo lectura; sin llamadas a ningún proveedor.`);
process.exit(ok === resultados.length ? 0 : 1);
