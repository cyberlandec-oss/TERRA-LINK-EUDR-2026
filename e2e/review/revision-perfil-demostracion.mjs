// P1-005 — demostración en el entorno desplegado del ACTO DE REVISIÓN del perfil jurídico (mecanismo).
//
//   node e2e/review/revision-perfil-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// NO registra ninguna revisión ni aprueba ningún perfil: los perfiles reales (0.1.0 y 0.2.0) siguen sin revisión. Demuestra los RECHAZOS y límites en el
// entorno operativo (cada intento se verifica sin efectos) y la pantalla. El recorrido completo —revisión favorable, objeción, retirada y pérdida de
// elegibilidad— está demostrado con datos SINTÉTICOS aislados en `test/legal-profile-review.int-spec.ts` y `e2e/tests/revision-perfil.spec.ts`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'revision-perfil-2026-10-21');
mkdirSync(SALIDA, { recursive: true });
const resultados = [];
async function caso(titulo, fn) {
  try { const [ok, detalle] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(100)} ${detalle ?? ''}`); resultados.push({ titulo, ok, detalle }); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(100)} ${String(e.message).slice(0, 240)}`); resultados.push({ titulo, ok: false, detalle: String(e.message).slice(0, 240) }); }
}
const pedir = async (t, m, p, body) => {
  const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let b = null; try { b = JSON.parse(txt); } catch { b = txt; } return { s: r.status, b };
};
const login = async (cta) => { const c = cuentaDemo(cta); const r = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) }); return (await r.json()).access_token; };
const db = (sql) => execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-At', '-F', '|', '-c', sql], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).trim();
const estado = () => db(`select (select count(*) from legal_profile_reviews)||'/'||(select count(*) from legal_profile_review_supports)||'/'||(select count(*) from legal_profile_adoptions)||'/'||(select count(*) from risk_rule_set_profile_links)||'/'||(select count(*) from legal_profile_versions)`);

const sup = await login('superadmin.revision'); const adm = await login('admin.cooperativa');
const R = '/api/v1/platform/legal-profile/reviews';
const antes = estado();
console.log(`\n== Acto de revisión del perfil jurídico · estado antes (revisiones/soportes/adopciones/actos de vinculación/versiones): ${antes} ==\n`);

let lista;
await caso('Permiso: la administración de la organización recibe 403; la plataforma recibe 200 (control)', async () => {
  const a = await pedir(adm, 'GET', R); const s = await pedir(sup, 'GET', R); lista = s.b;
  return [a.s === 403 && s.s === 200 && s.b.versions?.length >= 2, `${a.s}/${s.s}/${s.b.versions?.length} versiones`];
});
await caso('Los perfiles reales conservan su estado: 0.1.0 publicado parcial y 0.2.0 borrador, ambos SIN revisión y no elegibles', async () => {
  const v = (x) => lista.versions.find((p) => p.version === x);
  const ok = ['0.1.0', '0.2.0'].every((x) => v(x).status === 'NONE' && v(x).current_review === null && v(x).link_eligibility.eligible === false);
  return [ok && v('0.1.0').technical_status === 'PUBLISHED' && v('0.2.0').technical_status === 'DRAFT', `0.1.0 ${v('0.1.0').technical_status}/${v('0.1.0').status} · 0.2.0 ${v('0.2.0').technical_status}/${v('0.2.0').status}`];
});
const cuerpo = (o = {}) => ({ operation_id: randomUUID(), version: '0.1.0', decision: 'REVIEWED', reviewer_name: 'Intento de demostración', reviewer_capacity: 'Sin capacidad real', reviewed_on: new Date().toISOString().slice(0, 10), basis: 'Intento de demostración que debe rechazarse sin escribir', supports: [{ kind: 'PROFILE_SOURCE', source_code: 'LOTRTA-711' }], ...o });
await caso('Se rechazan sin escribir: petición incompleta (400), estado inexistente (400), versión inexistente (422), fecha futura (422)', async () => {
  const a = await pedir(sup, 'POST', R, { operation_id: randomUUID(), version: '0.1.0', decision: 'REVIEWED' });
  const b = await pedir(sup, 'POST', R, cuerpo({ decision: 'APPROVED' }));
  const c = await pedir(sup, 'POST', R, cuerpo({ version: '9.9.9' }));
  const d = await pedir(sup, 'POST', R, cuerpo({ reviewed_on: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) }));
  return [a.s === 400 && b.s === 400 && c.s === 422 && d.s === 422, `${a.s}/${b.s}/${c.s}(${c.b?.error?.code})/${d.s}(${d.b?.error?.code})`];
});
await caso('Una revisión favorable exige soporte (422) y el soporte debe ser de ESA versión (422); retirar sin revisión vigente favorable (422)', async () => {
  const a = await pedir(sup, 'POST', R, cuerpo({ supports: [] }));
  const b = await pedir(sup, 'POST', R, cuerpo({ version: '0.2.0', supports: [{ kind: 'PROFILE_SOURCE', source_code: 'NO-EXISTE-1' }] }));
  const c = await pedir(sup, 'POST', R, cuerpo({ decision: 'WITHDRAWN', supports: [] }));
  return [a.s === 422 && a.b?.error?.code === 'REVIEW_SUPPORT_REQUIRED' && b.s === 422 && c.s === 422 && c.b?.error?.code === 'NOTHING_TO_WITHDRAW', `${a.b?.error?.code} / ${b.b?.error?.code} / ${c.b?.error?.code}`];
});
await caso('La administración de la organización no puede registrar (403) y no se escribió nada', async () => {
  const r = await pedir(adm, 'POST', R, cuerpo());
  return [r.s === 403 && estado() === antes, `${r.s} · ${estado()}`];
});
await caso('La base rechaza una revisión favorable sin soporte (transacción revertida)', async () => {
  try { db(`begin; insert into legal_profile_reviews(id,version,decision,reviewer_id,reviewer_name,reviewer_capacity,reviewed_on,basis,operation_id) select gen_random_uuid(),'0.1.0','REVIEWED',(select id from users limit 1),'Demostración','Sin capacidad real',current_date,'Intento de demostración sin soporte',gen_random_uuid(); commit;`); return [false, 'ACEPTADA']; }
  catch { return [estado() === antes, 'rechazada y sin cambios']; }
});
await caso('Estado de datos idéntico tras todos los intentos; ningún perfil publicado, adoptado ni revisado', async () => [estado() === antes, `${estado()} (antes ${antes})`]);

const browser = await chromium.launch();
const sesion = async (token, lang, viewport) => { const ctx = await browser.newContext(viewport ? { viewport } : {}); await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, lang]); return { ctx, page: await ctx.newPage() }; };
await caso('Pantalla (es): versiones sin revisión, historial vacío, registro deshabilitado hasta completar y confirmar', async () => {
  const { ctx, page } = await sesion(sup, 'es'); await page.goto(`${WEB}/plataforma/perfil-juridico`);
  await page.getByText('Esta versión no tiene ninguna revisión registrada.').waitFor({ timeout: 15000 });
  const deshab = await page.getByRole('button', { name: 'Registrar revisión efectiva' }).isDisabled();
  const cuerpoTxt = await page.locator('main').innerText();
  await page.screenshot({ path: join(SALIDA, 'pantalla-es.png'), fullPage: true }); await ctx.close();
  return [deshab && /No elegible para vincular un catálogo/.test(cuerpoTxt) && /La última decisión|no tiene ninguna revisión jurídica registrada/.test(cuerpoTxt), 'botón deshabilitado y consecuencia técnica visible'];
});
await caso('Pantalla (en, 390 px): radios, consecuencia visible dentro del ancho, traducida, sin códigos internos y sin desborde', async () => {
  const { ctx, page } = await sesion(sup, 'en', { width: 390, height: 844 }); await page.goto(`${WEB}/plataforma/perfil-juridico`);
  await page.getByText('This version has no review on record.').waitFor({ timeout: 15000 });
  const razon = page.getByText('The profile has no legal review on record.').first(); await razon.waitFor();
  const radio = await page.getByRole('radio', { name: 'Objected' }).boundingBox(); const etiqueta = await page.getByText('Objected', { exact: true }).last().boundingBox();
  const radiosOk = radio.width <= 24 && Math.abs(etiqueta.y - radio.y) < 24;
  const caja = await razon.boundingBox(); const txt = await page.locator('main').innerText(); const sin = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await page.screenshot({ path: join(SALIDA, 'pantalla-en-390.png'), fullPage: true }); await ctx.close();
  return [radiosOk && sin && caja.x + caja.width <= 391 && !/\b(NO_REVIEW|SCOPE_PARTIAL|PUBLISHED|DRAFT|REVIEWED|OBJECTED)\b/.test(txt), `radios con tamaño de control y etiqueta en su línea: ${radiosOk}; sin desborde: ${sin}`];
});
await caso('La administración de la organización no ve la pantalla de plataforma', async () => {
  const { ctx, page } = await sesion(adm, 'es'); await page.goto(`${WEB}/plataforma/perfil-juridico`);
  await page.getByText('Tu cuenta no tiene permiso').waitFor({ timeout: 15000 }).catch(() => undefined);
  const ok = (await page.getByText('Tu cuenta no tiene permiso').count()) > 0; await ctx.close(); return [ok, 'acceso denegado'];
});
await browser.close();

const fallas = resultados.filter((r) => !r.ok).length;
writeFileSync(join(SALIDA, 'resultados.json'), JSON.stringify({ resultados }, null, 2));
console.log(`\n${resultados.length - fallas}/${resultados.length} comprobaciones. No se registró ninguna revisión ni se aprobó ningún perfil.`);
process.exit(fallas ? 1 : 0);
