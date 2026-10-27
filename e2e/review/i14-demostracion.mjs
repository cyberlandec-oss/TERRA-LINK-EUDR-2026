// I1–I4 — Demostración en el despliegue del panel «Evaluación geográfica técnica actual» del expediente (requisito original GEOLOCATION_PROFILE).
//
//   node e2e/review/i14-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// SOLO LECTURA sobre el DEMO sintético existente: no evalúa parcelas, no captura instantáneas, no escribe. Comprueba que consultar el panel no cambia nada
// (conteos de evaluaciones, eventos, auditoría e instantáneas; hash y frescura de cada instantánea) y que el requisito sigue NOT_EVALUABLE.
// Los estados ausente/obsoleto/no evaluable y la guarda con todas las parcelas en MEETS_PROFILE se demuestran en las pruebas de integración y en el E2E aislado.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'i14-demostracion-2026-10-21');
mkdirSync(SALIDA, { recursive: true });
const resultados = [];
async function caso(titulo, fn) {
  try { const [ok, detalle] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(100)} ${detalle ?? ''}`); resultados.push({ titulo, ok, detalle }); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(100)} ${String(e.message).slice(0, 240)}`); resultados.push({ titulo, ok: false, detalle: String(e.message).slice(0, 240) }); }
}
const pedir = async (t, m, p, body) => { const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); let b = null; try { b = await r.json(); } catch { /* sin cuerpo */ } return { s: r.status, b }; };
const login = async (cta) => { const c = cuentaDemo(cta); return { token: (await (await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) })).json()).access_token }; };
const sesion = async (browser, token, lang = 'es', viewport) => { const ctx = await browser.newContext(viewport ? { viewport } : {}); await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, lang]); const page = await ctx.newPage(); return { ctx, page }; };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
// Conteos de solo lectura directamente en la base del despliegue (docker exec psql, SELECT count).
const conteos = () => execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-At', '-F', ' ', '-c',
  "select (select count(*) from geo_profile_evaluations), (select count(*) from domain_events), (select count(*) from audit_logs), (select count(*) from dd_snapshots), (select count(*) from dd_exports), (select count(*) from plot_versions)"],
  { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).trim();

const adm = await login('admin.cooperativa'); const aud = await login('auditor.cooperativa'); const tec = await login('tecnico1.cooperativa'); const otra = await login('admin.exportadora');
const orgRV = lista((await pedir(adm.token, 'GET', '/api/v1/organizations')).b).find((o) => o.name.includes('Río Verde'));
const orgEX = lista((await pedir(otra.token, 'GET', '/api/v1/organizations')).b)[0];
const B = `/api/v1/organizations/${orgRV.id}`;
const casos = (await pedir(adm.token, 'GET', `${B}/dd-cases`)).b.cases;
console.log(`\n== I1–I4 · ${orgRV.name} · ${casos.length} expedientes ==\n`);
if (!casos.length) throw new Error('No hay expedientes DEMO');
const paneles = []; for (const c of casos) paneles.push({ c, p: (await pedir(adm.token, 'GET', `${B}/dd-cases/${c.id}/geo-evaluation`)).b });
const elegido = paneles.sort((a, b) => b.p.counts.total - a.p.counts.total)[0];
const hashes = async () => { const o = {}; for (const c of casos) if (c.snapshot_id) { const s = (await pedir(adm.token, 'GET', `${B}/dd-snapshots/${c.snapshot_id}`)).b; o[c.snapshot_id] = { hash: s.content_hash, efectiva: s.readiness.effective, nreq: s.requirements.find((r) => r.code === 'GEOLOCATION_PROFILE')?.status }; } return o; };
const antes = conteos(); const hAntes = await hashes();
const browser = await chromium.launch();

await caso('1 Todos los expedientes devuelven el panel de solo consulta, con recuentos coherentes y sin escribir nada', async () => {
  const incoh = paneles.filter(({ p }) => p.kind !== 'CURRENT_TECHNICAL_GEO_EVALUATION' || p.not_snapshot_content !== true
    || p.counts.total !== p.counts.meets_profile + p.counts.does_not_meet + p.counts.review_required + p.counts.not_evaluable + p.counts.obsolete + p.counts.absent);
  return [incoh.length === 0 && conteos() === antes, `${paneles.length} expedientes; recuentos coherentes=${incoh.length === 0}; conteos antes==después=${conteos() === antes} (${antes})`];
});

await caso('2 La pantalla muestra el panel separado, con vigencia/obsolescencia/ausencia, pendientes y el aviso de que no cumple el requisito regulatorio', async () => {
  const a = await sesion(browser, adm.token); await a.page.goto(`${WEB}/organizaciones/${orgRV.id}/diligencia/${elegido.c.id}`);
  const panel = a.page.getByRole('region', { name: 'Evaluación geográfica técnica actual' });
  await panel.waitFor({ timeout: 30000 });
  const texto = await panel.innerText();
  await a.page.screenshot({ path: join(SALIDA, '2-panel-es.png'), fullPage: true });
  const filas = await panel.locator('table tbody tr').count();
  await a.ctx.close();
  const c = elegido.p.counts;
  return [filas === c.total && /Consulta actual, separada de la instantánea/.test(texto) && /Esto no cumple el requisito regulatorio/.test(texto) && /No forma parte del contenido de ninguna instantánea/.test(texto),
    `${elegido.c.case_number}: ${c.total} parcelas · cumplen ${c.meets_profile} · no cumplen ${c.does_not_meet} · revisión ${c.review_required} · no evaluable ${c.not_evaluable} · obsoletas ${c.obsolete} · sin evaluación ${c.absent}; filas=${filas}`];
});

await caso('3 Las instantáneas históricas no cambian: mismo hash y misma frescura antes y después de consultar el panel; el requisito sigue NOT_EVALUABLE', async () => {
  const despues = await hashes();
  const iguales = JSON.stringify(hAntes) === JSON.stringify(despues);
  const todasNoEval = Object.values(despues).every((x) => x.nreq === 'NOT_EVALUABLE');
  const geoEnContenido = (await Promise.all(casos.filter((c) => c.snapshot_id).map(async (c) => JSON.stringify((await pedir(adm.token, 'GET', `${B}/dd-snapshots/${c.snapshot_id}`)).b.content)))).some((s) => /EUDR_GEO_V1|MEETS_PROFILE|geo_profile/.test(s));
  return [iguales && todasNoEval && !geoEnContenido && conteos() === antes, `${Object.keys(despues).length} instantáneas: hash y frescura sin cambio=${iguales}; GEOLOCATION_PROFILE NOT_EVALUABLE en todas=${todasNoEval}; veredicto técnico en su contenido=${geoEnContenido}`];
});

await caso('4 Permisos: el auditor ve estado y veredicto sin el detalle; el técnico recibe 403; la otra organización 404; control autorizado 200', async () => {
  const a = await pedir(adm.token, 'GET', `${B}/dd-cases/${elegido.c.id}/geo-evaluation`);
  const u = await pedir(aud.token, 'GET', `${B}/dd-cases/${elegido.c.id}/geo-evaluation`);
  const t = await pedir(tec.token, 'GET', `${B}/dd-cases/${elegido.c.id}/geo-evaluation`);
  const o = await pedir(otra.token, 'GET', `${B}/dd-cases/${elegido.c.id}/geo-evaluation`);
  const o2 = await pedir(otra.token, 'GET', `/api/v1/organizations/${orgEX.id}/dd-cases/${elegido.c.id}/geo-evaluation`);
  const restringido = u.s === 200 && u.b.plots.every((p) => p.detail_restricted === true && (!p.evaluation || (p.evaluation.explanation === null && p.evaluation.area === null))) && !/coordinates/.test(JSON.stringify(u.b));
  return [a.s === 200 && restringido && JSON.stringify(u.b.counts) === JSON.stringify(a.b.counts) && t.s === 403 && o.s === 404 && o2.s === 404,
    `admin ${a.s} · auditor ${u.s} (detalle restringido=${restringido}, mismos recuentos) · técnico ${t.s} · otra organización ${o.s}/${o2.s}`];
});

await caso('5 Inglés, teclado y 390 px: panel traducido, sin desborde y sin códigos internos', async () => {
  const a = await sesion(browser, adm.token, 'en', { width: 390, height: 844 }); await a.page.goto(`${WEB}/organizaciones/${orgRV.id}/diligencia/${elegido.c.id}`);
  const panel = a.page.getByRole('region', { name: 'Current technical geographic evaluation' });
  await panel.waitFor({ timeout: 30000 });
  const texto = await panel.innerText();
  const interno = /\b(NEVER_EVALUATED|GEOMETRY_VERSION_CHANGED|PROFILE_VERSION_CHANGED|NO_GEOMETRY_VERSION|MEETS_PROFILE|DOES_NOT_MEET|EVALUATE_PROFILE|CORRECT_GEOMETRY|NOT_EVALUABLE)\b/.test(texto);
  const boton = panel.getByRole('button', { name: 'Look up again' }); await boton.focus(); const foco = await boton.evaluate((el) => el === document.activeElement);
  await a.page.keyboard.press('Enter'); await panel.getByText('Current lookup, separate from the snapshot').waitFor();
  const desborde = await a.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await a.page.screenshot({ path: join(SALIDA, '5-panel-en-390.png'), fullPage: true });
  await a.ctx.close();
  return [!interno && foco && !desborde && conteos() === antes, `códigos internos=${interno}; foco por teclado=${foco}; desborde=${desborde}; conteos sin cambio=${conteos() === antes}`];
});

await browser.close();
const ok = resultados.filter((r) => r.ok).length;
writeFileSync(join(SALIDA, 'resultado.json'), JSON.stringify({ fecha: new Date().toISOString(), conteos_antes: antes, conteos_despues: conteos(), resultados }, null, 2));
console.log(`\nI1–I4 · demostración en el despliegue: ${ok}/${resultados.length}`);
process.exit(ok === resultados.length ? 0 : 1);
