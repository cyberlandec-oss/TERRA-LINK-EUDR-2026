// D-07.5(b), opción b-1 — demostración en el entorno desplegado del acto de vinculación del catálogo con un perfil jurídico.
//
//   node e2e/review/vinculo-catalogo-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// NO aprueba perfiles ni publica ninguna versión vinculada: hoy no existe un perfil completo y revisado. Demuestra el RECHAZO en el entorno
// operativo (cada intento se comprueba sin efectos), que la pantalla explica qué falta y no ofrece confirmar, y que el estado de datos
// no cambia. El caso positivo con un perfil SINTÉTICO vive en bases aisladas (`test/risk-catalog-link.int-spec.ts`, `e2e/tests/vinculo-catalogo.spec.ts`).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'vinculo-catalogo-2026-10-21');
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
const estado = () => db(`select (select count(*) from risk_rule_sets)||'/'||(select count(*) from risk_rule_set_profile_links)||'/'||(select count(*) from risk_rule_set_adoptions)||'/'||(select count(*) from legal_profile_adoptions)||'/'||(select count(*) from legal_profile_reviews)||'/'||(select count(*) from risk_rules)`);

const sup = await login('superadmin.revision'); const adm = await login('admin.cooperativa');
const P = '/api/v1/platform/risk-catalog/profile-links';
const antes = estado();
console.log(`\n== Vinculación del catálogo (b-1) · estado antes (conjuntos/actos/adopciones riesgo/adopciones perfil/revisiones/reglas): ${antes} ==\n`);

await caso('Permiso: la administración de la organización recibe 403; la plataforma recibe 200 (control)', async () => {
  const a = await pedir(adm, 'GET', `${P}/eligibility`); const s = await pedir(sup, 'GET', `${P}/eligibility`);
  return [a.s === 403 && s.s === 200 && s.b.profiles?.length >= 2, `${a.s}/${s.s}/${s.b.profiles?.length} perfiles`];
});
let el;
await caso('Ningún perfil es elegible y se explica qué falta de 0.1.0 y 0.2.0', async () => {
  el = (await pedir(sup, 'GET', `${P}/eligibility`)).b;
  const c = (v) => el.profiles.find((p) => p.version === v)?.reasons.map((r) => r.code).sort().join(',');
  return [!el.profiles.some((p) => p.eligible) && c('0.1.0') === 'NO_REVIEW,SCOPE_PARTIAL' && c('0.2.0') === 'DRAFT,NO_REVIEW,SCOPE_PARTIAL', `0.1.0: ${c('0.1.0')} · 0.2.0: ${c('0.2.0')}`];
});
const intento = (over) => pedir(sup, 'POST', P, { operation_id: randomUUID(), base_rule_set_version: '1.0.0', new_rule_set_version: '1.1.0', profile_version: '0.1.0', review_id: randomUUID(), reason: 'Demostración: intento de vinculación sin perfil elegible', ...over });
await caso('Se rechaza vincular 0.1.0 (parcial, sin revisión) con 422 PROFILE_NOT_ELIGIBLE', async () => { const r = await intento({}); return [r.s === 422 && r.b?.error?.code === 'PROFILE_NOT_ELIGIBLE', `${r.s} ${r.b?.error?.code}`]; });
await caso('Se rechaza vincular 0.2.0 (borrador) con 422 PROFILE_NOT_ELIGIBLE', async () => { const r = await intento({ profile_version: '0.2.0' }); return [r.s === 422 && r.b?.error?.code === 'PROFILE_NOT_ELIGIBLE', `${r.s} ${r.b?.error?.code}`]; });
await caso('Se rechaza una referencia inexistente (422) y una etiqueta (400)', async () => {
  const a = await intento({ profile_version: '8.8.8' }); const b = await intento({ profile_version: 'aprobado' });
  return [a.s === 422 && a.b?.error?.code === 'PROFILE_UNKNOWN' && b.s === 400, `${a.s} ${a.b?.error?.code} / ${b.s}`];
});
await caso('No se edita una versión publicada: crear «1.0.0» → 409', async () => { const r = await intento({ new_rule_set_version: '1.0.0' }); return [r.s === 409 && r.b?.error?.code === 'RULE_SET_VERSION_EXISTS', `${r.s} ${r.b?.error?.code}`]; });
await caso('Historial vacío y estado de datos idéntico tras los intentos (nada se escribió ni se adoptó)', async () => {
  const h = (await pedir(sup, 'GET', P)).b;
  return [Array.isArray(h.links) && h.links.length === 0 && estado() === antes, `${h.links?.length} actos · ${estado()}`];
});
await caso('La base rechaza escribir una referencia sin acto o sin revisión vigente (transacciones revertidas)', async () => {
  const out = [];
  for (const val of ['aprobado', '0.1.0', '0.2.0']) {
    try { db(`begin; insert into risk_rule_sets(version,approval_status,source,notes,regulatory_profile) values ('7.7.7','NOT_APPROVED','demo','demo','${val}'); commit;`); out.push(`${val}:ACEPTADO`); } catch { out.push(`${val}:rechazado`); }
  }
  return [out.every((x) => x.endsWith('rechazado')) && estado() === antes, out.join(' ')];
});
await caso('1.0.0 intacto: sin perfil declarado, 8 reglas, con sus adopciones históricas', async () => [db(`select coalesce(regulatory_profile,'NULL')||'/'||approval_status||'/'||(select count(*) from risk_rules where rule_set_version='1.0.0') from risk_rule_sets where version='1.0.0'`) === 'NULL/APPROVED/8', db(`select count(*) from risk_rule_set_adoptions where rule_set_version='1.0.0'`) + ' adopciones de 1.0.0']);

const browser = await chromium.launch();
const sesion = async (token, lang, viewport) => { const ctx = await browser.newContext(viewport ? { viewport } : {}); await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, lang]); return { ctx, page: await ctx.newPage() }; };
await caso('Pantalla (es): explica que ningún perfil es elegible, lista lo que falta y NO ofrece confirmar', async () => {
  const { ctx, page } = await sesion(sup, 'es'); await page.goto(`${WEB}/plataforma/catalogo-riesgo`);
  await page.getByText('Ningún perfil es elegible todavía').waitFor({ timeout: 15000 });
  const cuerpo = await page.locator('main').innerText();
  const ok = /El alcance del perfil es PARCIAL\./.test(cuerpo) && /borrador/.test(cuerpo) && (await page.getByRole('button', { name: 'Registrar la vinculación' }).count()) === 0;
  await page.screenshot({ path: join(SALIDA, 'pantalla-es.png'), fullPage: true }); await ctx.close(); return [ok, 'sin botón de confirmar'];
});
await caso('Pantalla (en, 390 px): textos traducidos, sin códigos internos y sin desborde', async () => {
  const { ctx, page } = await sesion(sup, 'en', { width: 390, height: 844 }); await page.goto(`${WEB}/plataforma/catalogo-riesgo`);
  await page.getByText('No profile is eligible yet').waitFor({ timeout: 15000 });
  const cuerpo = await page.locator('main').innerText(); const sin = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await page.screenshot({ path: join(SALIDA, 'pantalla-en-390.png'), fullPage: true }); await ctx.close();
  return [sin && !/\b(SCOPE_PARTIAL|NO_REVIEW|NOT_APPROVED|PUBLISHED|DRAFT)\b/.test(cuerpo), `sin desborde: ${sin}`];
});
await caso('La administración de la organización no ve la pantalla de plataforma (403 en su interfaz)', async () => {
  const { ctx, page } = await sesion(adm, 'es'); await page.goto(`${WEB}/plataforma/catalogo-riesgo`);
  await page.getByText('Tu cuenta no tiene permiso para vincular el catálogo con un perfil jurídico.').waitFor({ timeout: 15000 }).catch(() => undefined);
  const ok = (await page.getByText('Tu cuenta no tiene permiso').count()) > 0 || (await page.getByText('No tienes permiso').count()) > 0;
  await ctx.close(); return [ok, 'mensaje de acceso denegado'];
});
await browser.close();

const fallas = resultados.filter((r) => !r.ok).length;
writeFileSync(join(SALIDA, 'resultados.json'), JSON.stringify({ resultados }, null, 2));
console.log(`\n${resultados.length - fallas}/${resultados.length} comprobaciones. Ninguna acredita preparación del expediente ni conformidad; no se aprobó ningún perfil.`);
process.exit(fallas ? 1 : 0);
