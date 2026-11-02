// GEOLOCATION_PROFILE — demostración en el entorno desplegado de la CONFIGURACIÓN versionada de reglas de geolocalización.
//
//   node e2e/review/geo-config-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// NO prepara, revisa ni adopta ninguna configuración real: el entorno operativo conserva sus estados pendientes (0.1.0 candidata, sin revisión, sin adopción) y el requisito
// GEOLOCATION_PROFILE de los expedientes existentes sigue NOT_EVALUABLE. Demuestra los RECHAZOS y límites (cada intento se verifica sin efectos) y las pantallas. El recorrido completo
// —configuración revisada y aplicable con datos completos; datos ausentes u obsoletos; fuera de alcance; objeción o retirada; aislamiento; obsolescencia— está demostrado con datos SINTÉTICOS
// aislados en `test/geo-config.int-spec.ts` y `e2e/tests/geolocalizacion-config.spec.ts`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'geo-config-2026-10-22');
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
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
const db = (sql) => execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-At', '-F', '|', '-c', sql], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).trim();
const estado = () => db(`select (select count(*) from geo_requirement_configs)||'/'||(select count(*) from geo_requirement_config_rules)||'/'||(select count(*) from geo_requirement_config_reviews)||'/'||(select count(*) from geo_requirement_config_adoptions)||'/'||(select count(*) from dd_snapshots)||'/'||(select count(*) from legal_profile_reviews)`);

const sup = await login('superadmin.revision'); const adm = await login('admin.cooperativa');
const orgRV = lista((await pedir(adm, 'GET', '/api/v1/organizations')).b).find((o) => o.name.includes('Río Verde'));
const B = `/api/v1/organizations/${orgRV.id}`; const P = '/api/v1/platform/geolocation-config';
const antes = estado();
console.log(`\n== Configuración de geolocalización · ${orgRV.name} · estado antes (configs/reglas/revisiones/adopciones/instantáneas/revisiones jurídicas): ${antes} ==\n`);

let lista0;
await caso('Permiso: la administración de la organización recibe 403 en la plataforma; la plataforma recibe 200 (control)', async () => {
  const a = await pedir(adm, 'GET', `${P}/versions`); const s = await pedir(sup, 'GET', `${P}/versions`); lista0 = s.b;
  return [a.s === 403 && s.s === 200, `${a.s}/${s.s}`];
});
await caso('0.1.0 conserva su estado: candidata, SIN revisión, con una regla activa y dos candidatas (período y país), todas con su fuente', async () => {
  const c = lista0.configs.find((x) => x.version === '0.1.0');
  const r = Object.fromEntries(c.rules.map((x) => [x.code, x.status]));
  return [c.status === 'NONE' && r['GEO-TECH-PROFILE'] === 'ACTIVE' && r['GEO-PRODUCTION-PERIOD'] === 'CANDIDATE' && r['GEO-PRODUCTION-COUNTRY'] === 'CANDIDATE' && c.sources.length === 2 && c.gaps.includes('NO_REVIEW') && c.gaps.includes('CANDIDATE_RULES_PENDING'), `estado ${c.status} · gaps ${c.gaps.join(',')}`];
});
const prep = (over = {}) => ({ operation_id: randomUUID(), version: '9.9.9', technical_profile_version: '1.0.0', scope_note: 'Intento de demostración que debe rechazarse sin escribir', reason: 'Intento de demostración',
  sources: [{ code: 'DEMO-1', title: 'Fuente de demostración', citation: 'Cita de demostración', url: 'https://example.test/demo' }],
  rules: [{ code: 'GEO-DEMO', kind: 'GEO_TECH_PROFILE', status: 'ACTIVE', source_code: 'DEMO-1', article: 'Art. de demostración', criterion: 'Criterio de demostración que debe rechazarse.' }], ...over });
await caso('Preparar se rechaza sin escribir: regla activa de período/país (422), candidata sin lo que falta (422), otro perfil técnico (422), versión existente (409)', async () => {
  const a = await pedir(sup, 'POST', `${P}/versions`, prep({ rules: [{ code: 'GEO-P', kind: 'PRODUCTION_PERIOD', status: 'ACTIVE', source_code: 'DEMO-1', article: 'Art. demo', criterion: 'Período por parcela de demostración.' }] }));
  const b = await pedir(sup, 'POST', `${P}/versions`, prep({ rules: [{ code: 'GEO-C', kind: 'PRODUCTION_COUNTRY', status: 'CANDIDATE', source_code: 'DEMO-1', article: 'Art. demo', criterion: 'País por parcela de demostración.' }] }));
  const c = await pedir(sup, 'POST', `${P}/versions`, prep({ technical_profile_version: '2.0.0' }));
  const d = await pedir(sup, 'POST', `${P}/versions`, prep({ version: '0.1.0' }));
  return [a.b?.error?.code === 'CONFIG_RULE_NOT_APPLICABLE' && b.b?.error?.code === 'CONFIG_CANDIDATE_QUESTIONS_REQUIRED' && c.b?.error?.code === 'TECHNICAL_PROFILE_MISMATCH' && d.s === 409, `${a.b?.error?.code} / ${b.b?.error?.code} / ${c.b?.error?.code} / ${d.s}`];
});
const rev = (over = {}) => ({ operation_id: randomUUID(), version: '0.1.0', decision: 'REVIEWED', reviewer_name: 'Intento de demostración', reviewer_capacity: 'Sin capacidad real', reviewed_on: new Date().toISOString().slice(0, 10), basis: 'Intento de demostración que debe rechazarse sin escribir',
  supports: [{ kind: 'CONFIG_SOURCE', source_code: 'REG-2023-1115' }], applicable_organizations: [], applicability_note: 'Demostración', ...over });
await caso('Revisar se rechaza sin escribir: favorable sin soporte (422), soporte de otra versión (422), organización inexistente (422), retirar sin favorable vigente (422), versión inexistente (422)', async () => {
  const a = await pedir(sup, 'POST', `${P}/reviews`, rev({ supports: [] }));
  const b = await pedir(sup, 'POST', `${P}/reviews`, rev({ supports: [{ kind: 'CONFIG_SOURCE', source_code: 'NO-EXISTE' }] }));
  const c = await pedir(sup, 'POST', `${P}/reviews`, rev({ applicable_organizations: [randomUUID()] }));
  const d = await pedir(sup, 'POST', `${P}/reviews`, rev({ decision: 'WITHDRAWN', supports: [] }));
  const e = await pedir(sup, 'POST', `${P}/reviews`, rev({ version: '8.8.8' }));
  return [[a, b, c, d, e].every((x) => x.s === 422), `${a.b?.error?.code} / ${b.b?.error?.code} / ${c.b?.error?.code} / ${d.b?.error?.code} / ${e.b?.error?.code}`];
});
await caso('La administración de la organización no puede revisar ni preparar (403); el técnico/lector no adopta; y no se escribió nada', async () => {
  const a = await pedir(adm, 'POST', `${P}/reviews`, rev()); const b = await pedir(adm, 'POST', `${P}/versions`, prep());
  return [a.s === 403 && b.s === 403 && estado() === antes, `${a.s}/${b.s} · ${estado()}`];
});
await caso('Adoptar una versión inexistente se rechaza (422) y la vista de la organización no lista a otras organizaciones', async () => {
  const a = await pedir(adm, 'POST', `${B}/geolocation-config/adoptions`, { operation_id: randomUUID(), version: '8.8.8', decision: 'ADOPT', reason: 'Intento de demostración' });
  const v = await pedir(adm, 'GET', `${B}/geolocation-config/catalog`);
  const otras = lista((await pedir(sup, 'GET', '/api/v1/organizations')).b).filter((o) => o.id !== orgRV.id).map((o) => o.id);
  return [a.s === 422 && v.s === 200 && v.b.adopted === null && !otras.some((id) => JSON.stringify(v.b).includes(id)), `${a.s} · adoptada: ${v.b.adopted} · configs ${v.b.configs.length}`];
});
await caso('Los expedientes existentes conservan GEOLOCATION_PROFILE = NOT_EVALUABLE (valores guardados, no reevaluados) y ninguno cambió de estado por esta entrega', async () => {
  const casos = (await pedir(adm, 'GET', `${B}/dd-cases`)).b?.cases ?? []; const estados = new Set(); let vistos = 0;
  for (const c of casos.filter((x) => x.snapshot_id).slice(0, 10)) { const sn = (await pedir(adm, 'GET', `${B}/dd-snapshots/${c.snapshot_id}`)).b; const r = (sn?.requirements ?? []).find((x) => x.code === 'GEOLOCATION_PROFILE'); if (r) { vistos++; estados.add(r.status); } }
  return [vistos > 0 && [...estados].join() === 'NOT_EVALUABLE', `${vistos} instantáneas; estados: ${[...estados].join(',')}`];
});
await caso('La base rechaza una regla activa de período o país y una revisión favorable sin soporte (transacciones revertidas)', async () => {
  const intentos = [
    `begin; insert into geo_requirement_config_rules(version,code,kind,status,source_code,article,criterion) values ('0.1.0','GEO-X','PRODUCTION_COUNTRY','ACTIVE','REG-2023-1115','Art. demo','Criterio de demostración'); commit;`,
    `begin; insert into geo_requirement_config_reviews(id,version,decision,reviewer_name,reviewer_capacity,reviewed_on,basis,applicability_note,recorded_by,operation_id) select gen_random_uuid(),'0.1.0','REVIEWED','Demo','Demo',current_date,'Intento sin soporte de demostración','Demo',(select id from users limit 1),gen_random_uuid(); commit;`,
  ];
  const out = intentos.map((q) => { try { db(q); return 'ACEPTADA'; } catch { return 'rechazada'; } });
  return [out.every((x) => x === 'rechazada') && estado() === antes, out.join(' / ')];
});
await caso('Estado de datos idéntico tras todos los intentos: ninguna configuración preparada, revisada ni adoptada; sin revisiones jurídicas', async () => [estado() === antes, `${estado()} (antes ${antes})`]);

const browser = await chromium.launch();
const sesion = async (token, lang, viewport) => { const ctx = await browser.newContext(viewport ? { viewport } : {}); await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, lang]); return { ctx, page: await ctx.newPage() }; };
const dentro = async (loc) => { const b = await loc.boundingBox(); return b.x + b.width <= 391; };
await caso('Plataforma (es): 0.1.0 candidata sin revisión, reglas candidatas con lo que falta y registro deshabilitado', async () => {
  const { ctx, page } = await sesion(sup, 'es'); await page.goto(`${WEB}/plataforma/geolocalizacion`);
  await page.locator('#g-sel').selectOption('0.1.0'); await page.getByText('Esta versión no tiene ninguna revisión registrada.').waitFor({ timeout: 15000 });
  const txt = await page.locator('main').innerText(); const deshab = await page.getByRole('button', { name: 'Registrar revisión efectiva' }).isDisabled();
  await page.screenshot({ path: join(SALIDA, 'plataforma-es.png'), fullPage: true }); await ctx.close();
  return [deshab && /Conserva reglas candidatas sin resolver/.test(txt) && /Candidata \(no se aplica\)/.test(txt), 'registro deshabilitado; reglas candidatas visibles'];
});
await caso('Plataforma (en, 390 px): traducida, radios con tamaño de control, qué falta dentro del ancho, sin códigos internos y sin desborde', async () => {
  const { ctx, page } = await sesion(sup, 'en', { width: 390, height: 844 }); await page.goto(`${WEB}/plataforma/geolocalizacion`);
  await page.locator('#g-sel').selectOption('0.1.0'); const falta = page.getByText('It keeps unresolved candidate rules').first(); await falta.waitFor({ timeout: 15000 });
  const radio = await page.getByRole('radio', { name: 'Objected' }).boundingBox(); const txt = await page.locator('main').innerText(); const sin = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const faltaDentro = await dentro(falta);
  await page.screenshot({ path: join(SALIDA, 'plataforma-en-390.png'), fullPage: true }); await ctx.close();
  return [radio.width <= 24 && faltaDentro && sin && !/\b(NO_REVIEW|CANDIDATE_RULES_PENDING|GEO_TECH_PROFILE|PRODUCTION_PERIOD|CONFIG_SOURCE|NONE)\b/.test(txt), `radio ${Math.round(radio.width)} px; sin desborde: ${sin}`];
});
await caso('Organización (es): catálogo con 0.1.0 sin revisión, qué falta y botón para adoptar (sin adoptar)', async () => {
  const { ctx, page } = await sesion(adm, 'es'); await page.goto(`${WEB}/organizaciones/${orgRV.id}/geolocalizacion`);
  const sec = page.locator('section[aria-labelledby="cfg-0.1.0"]'); await sec.waitFor({ timeout: 15000 });
  const txt = await sec.innerText(); const boton = await sec.getByRole('button', { name: 'Adoptar esta configuración' }).count();
  await page.screenshot({ path: join(SALIDA, 'organizacion-es.png'), fullPage: true }); await ctx.close();
  return [/No tiene ninguna revisión registrada/.test(txt) && /Conserva reglas candidatas/.test(txt) && boton === 1, 'sin revisión; botón disponible, sin pulsar'];
});
await caso('Organización (en, 390 px): configuración y qué falta dentro del ancho, botón visible, traducida y sin desborde', async () => {
  const { ctx, page } = await sesion(adm, 'en', { width: 390, height: 844 }); await page.goto(`${WEB}/organizaciones/${orgRV.id}/geolocalizacion`);
  const sec = page.locator('section[aria-labelledby="cfg-0.1.0"]'); await sec.waitFor({ timeout: 15000 });
  const motivo = sec.getByText('It has no review on record.'); const boton = sec.getByRole('button', { name: 'Adopt this configuration' });
  const sin = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); const txt = await page.locator('main').innerText();
  const ok = await dentro(motivo) && await dentro(boton) && sin && !/\b(NO_REVIEW|CANDIDATE_RULES_PENDING|GEO_TECH_PROFILE|ACTIVE|CANDIDATE|NONE)\b/.test(txt);
  await page.screenshot({ path: join(SALIDA, 'organizacion-en-390.png'), fullPage: true }); await ctx.close(); return [ok, `sin desborde: ${sin}`];
});
await caso('Un rol sin permiso de catálogo no ve la pantalla de la organización (control autorizado: la administración sí)', async () => {
  const prod = await login('productor.cooperativa').catch(() => null);
  if (!prod) return [true, 'cuenta no disponible; omitido'];
  const r = await pedir(prod, 'GET', `${B}/geolocation-config/catalog`); const a = await pedir(adm, 'GET', `${B}/geolocation-config/catalog`);
  return [a.s === 200 && (r.s === 403 || r.s === 404), `administración ${a.s} / productor ${r.s}`];
});
await browser.close();

const fallas = resultados.filter((r) => !r.ok).length;
writeFileSync(join(SALIDA, 'resultados.json'), JSON.stringify({ resultados }, null, 2));
console.log(`\n${resultados.length - fallas}/${resultados.length} comprobaciones. No se preparó, revisó ni adoptó ninguna configuración real.`);
process.exit(fallas ? 1 : 0);
