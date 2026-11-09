// Guarda de RISK_CATALOG_APPROVED y perfil 0.2.0 en borrador — demostración sobre el DEMO sintético (no aprueba perfiles reales).
//
//   node e2e/review/guarda-catalogo-demostracion.mjs [--base http://localhost:4000]
//
// Comprueba en el entorno desplegado: 0.2.0 es BORRADOR y no se adopta (422, sin escribir), 0.1.0 conserva sus reglas, ninguna versión del catálogo lleva
// regulatory_profile, la base rechaza una etiqueta y una versión no revisada (dentro de una transacción que se revierte), y, en los expedientes existentes,
// RISK_CATALOG_APPROVED NO es MET. Cada comprobación es aislada: ninguna significa que el expediente esté aprobado ni listo.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'guarda-catalogo-2026-10-21');
mkdirSync(SALIDA, { recursive: true });
const resultados = [];
async function caso(titulo, fn) {
  try { const [ok, detalle] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(96)} ${detalle ?? ''}`); resultados.push({ titulo, ok, detalle }); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(96)} ${String(e.message).slice(0, 240)}`); resultados.push({ titulo, ok: false, detalle: String(e.message).slice(0, 240) }); }
}
const pedir = async (t, m, p, body) => {
  const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let b = null; try { b = JSON.parse(txt); } catch { b = txt; } return { s: r.status, b };
};
const login = async (cta) => { const c = cuentaDemo(cta); const r = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) }); return (await r.json()).access_token; };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
const db = (sql) => execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-At', '-F', '|', '-c', sql], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).trim();

const tok = await login('admin.cooperativa');
const orgs = lista((await pedir(tok, 'GET', '/api/v1/organizations')).b);
const org = orgs.find((o) => o.name.includes('Río Verde')) ?? orgs[0];
const B = `/api/v1/organizations/${org.id}`;
const adopcionesAntes = db(`select count(*) from legal_profile_adoptions`);
const reviewsAntes = db(`select count(*) from legal_profile_reviews`);
console.log(`\n== Guarda de RISK_CATALOG_APPROVED · ${org.name} ==\n`);

const cat = (await pedir(tok, 'GET', `${B}/legal-profile/catalog`)).b;
const v1 = cat.versions?.find((v) => v.version === '0.1.0'); const v2 = cat.versions?.find((v) => v.version === '0.2.0');
await caso('0.2.0 figura como BORRADOR parcial con 7 reglas (4 de 0.1.0 + EC-7, EC-8, EC-9)', async () => [v2?.technical_status === 'DRAFT' && v2.scope === 'PARTIAL' && v2.rules.length === 7, `${v2?.technical_status}/${v2?.scope}/${v2?.rules?.length}`]);
await caso('Cada regla nueva trae procedencia, interpretación propuesta y preguntas para el revisor', async () => {
  const n = v2.rules.filter((r) => r.source_code === 'COA-983'); return [n.length === 3 && n.every((r) => /Procedencia:/.test(r.gaps) && /Interpretacion propuesta:/.test(r.gaps) && /Preguntas para el revisor:/.test(r.gaps)), `${n.length} reglas`];
});
await caso('0.1.0 sigue PUBLICADO con sus 4 reglas y 3 fuentes', async () => [v1?.technical_status === 'PUBLISHED' && v1.rules.length === 4 && v1.sources.length === 3, `${v1?.rules?.length} reglas/${v1?.sources?.length} fuentes`]);
await caso('Adoptar el borrador se rechaza (422 LEGAL_PROFILE_NOT_PUBLISHED) sin escribir', async () => {
  const r = await pedir(tok, 'POST', `${B}/legal-profile/adoptions`, { operation_id: randomUUID(), version: '0.2.0', decision: 'ADOPT', reason: 'Demostración: intento de adoptar un borrador' });
  return [r.s === 422 && r.b?.error?.code === 'LEGAL_PROFILE_NOT_PUBLISHED' && db(`select count(*) from legal_profile_adoptions`) === adopcionesAntes, `${r.s} ${r.b?.error?.code}`];
});
await caso('Ninguna versión del catálogo de riesgo lleva regulatory_profile', async () => [db(`select count(*) from risk_rule_sets where regulatory_profile is not null`) === '0', db(`select string_agg(version,',') from risk_rule_sets`)]);
await caso('La base rechaza una etiqueta y un perfil real sin revisión (transacción revertida)', async () => {
  const out = [];
  for (const val of ['aprobado', '0.1.0', '0.2.0']) {
    try { db(`begin; insert into risk_rule_sets(version,approval_status,source,notes,regulatory_profile) values ('7.7.7','NOT_APPROVED','demo','demo','${val}'); commit;`); out.push(`${val}:ACEPTADO`); }
    catch (e) { out.push(`${val}:rechazado`); }
  }
  return [out.every((x) => x.endsWith('rechazado')) && db(`select count(*) from risk_rule_sets where version='7.7.7'`) === '0', out.join(' ')];
});
await caso('Registrar una revisión objetada no lo bloquea ninguna referencia (el trigger solo vigila risk_rule_sets)', async () => [db(`select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where tgname='risk_rule_sets_regulatory_profile_guard' and c.relname='risk_rule_sets'`) === '1' && db(`select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='legal_profile_reviews' and not tgisinternal and tgname not like '%no_mutation'`) === '0', 'trigger solo en risk_rule_sets; la revisión no se valida contra referencias']);
const casos = (await pedir(tok, 'GET', `${B}/dd-cases`)).b?.cases ?? [];
let vistos = 0; const estados = new Set();
for (const c of casos.filter((x) => x.snapshot_id).slice(0, 10)) {
  const sn = (await pedir(tok, 'GET', `${B}/dd-snapshots/${c.snapshot_id}`)).b;
  const req = (sn?.requirements ?? []).find((r) => r.code === 'RISK_CATALOG_APPROVED');
  if (req) { vistos++; estados.add(req.status); }
}
await caso('Instantáneas existentes (valores guardados, NO reevaluadas): RISK_CATALOG_APPROVED no es MET', async () => [vistos > 0 && !estados.has('MET'), `${vistos} instantáneas con el requisito; estados: ${[...estados].join(',')}`]);
await caso('Estado de datos sin cambios: adopciones y revisiones jurídicas', async () => [db(`select count(*) from legal_profile_adoptions`) === adopcionesAntes && db(`select count(*) from legal_profile_reviews`) === reviewsAntes, `adopciones ${adopcionesAntes}, revisiones ${reviewsAntes}`]);

const fallas = resultados.filter((r) => !r.ok).length;
writeFileSync(join(SALIDA, 'resultados.json'), JSON.stringify({ commit: db('select 1') && 'ver /version', resultados }, null, 2));
console.log(`\n${resultados.length - fallas}/${resultados.length} comprobaciones. Cada una es aislada: ninguna acredita preparación del expediente ni conformidad.`);
process.exit(fallas ? 1 : 0);
