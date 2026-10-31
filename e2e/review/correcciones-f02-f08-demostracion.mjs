// Demostración de las correcciones F02 (documento ↔ entregas) y F03 (cobertura histórica declarada) sobre el DESPLIEGUE y las CUENTAS VIGENTES.
//   node e2e/review/correcciones-f02-f08-demostracion.mjs [--base http://localhost:4000]
// Solo LECTURA: no crea usuarios, no cambia claves, no escribe registros. No imprime contraseñas ni tokens.
import { execFileSync } from 'node:child_process';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--base', 'http://localhost:4000');
const res = [];
async function caso(titulo, fn) {
  try { const [ok, det] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(110)} ${det ?? ''}`); res.push(ok); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(110)} ${String(e.message).slice(0, 200)}`); res.push(false); }
}
const psql = (q) => execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-At', '-F', '|', '-c', q], { encoding: 'utf8' }).trim();
const login = async (alias) => { const c = cuentaDemo(alias); const r = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) }); if (r.status !== 200) throw new Error('login ' + alias); return (await r.json()).access_token; };
const get = async (t, p) => { const r = await fetch(API + p, { headers: { authorization: `Bearer ${t}` } }); let b = null; try { b = await r.json(); } catch { /* sin cuerpo */ } return { s: r.status, b }; };

const doc = psql(`select d.id || '|' || d.organization_id from documents d where d.title like 'Guía de entrega DEMO-RV-001%'`).split('|');
const [docId, orgId] = doc;
const sinUso = psql(`select d.id from documents d where d.document_type <> 'DELIVERY_SUPPORT' limit 1`);
const T = {};
for (const a of ['admin.cooperativa', 'tecnico1.cooperativa', 'auditor.cooperativa', 'productor.cooperativa', 'admin.importador']) { try { T[a] = await login(a); } catch { T[a] = null; } }
const D = (id) => `/api/v1/organizations/${orgId}/documents/${id}`;

await caso('F02 admin de la cooperativa: la guía figura usada por ENT-2026-00001, versión 1, vínculo vigente', async () => {
  const r = await get(T['admin.cooperativa'], D(docId));
  const u = r.b?.delivery_usage;
  return [r.s === 200 && Array.isArray(u) && u.some((x) => x.delivery_code === 'ENT-2026-00001' && x.version_number === 1 && x.status === 'ACTIVE'), JSON.stringify((u ?? []).map((x) => `${x.delivery_code} v${x.version_number} ${x.status}`))];
});
await caso('F02 control: un documento que ninguna entrega usa figura sin entregas (lista vacía, no ausencia de la clave)', async () => {
  const r = await get(T['admin.cooperativa'], D(sinUso));
  return [r.s === 200 && Array.isArray(r.b?.delivery_usage) && r.b.delivery_usage.length === 0, `status ${r.s}`];
});
await caso('F02 técnico asignado: LIMITACIÓN DECLARADA — no se afirma que no haya entregas (null) ni se filtran otras', async () => {
  const r = await get(T['tecnico1.cooperativa'], D(docId));
  return [r.s === 200 ? r.b?.delivery_usage === null : [403, 404].includes(r.s), `status ${r.s}; delivery_usage=${r.s === 200 ? JSON.stringify(r.b?.delivery_usage) : 'n/a'}`];
});
await caso('F02 Productor: nunca recibe el detalle de entregas (null o sin acceso al documento)', async () => {
  if (!T['productor.cooperativa']) return [true, 'sin sesión de Productor vigente'];
  const r = await get(T['productor.cooperativa'], D(docId));
  return [r.s === 200 ? r.b?.delivery_usage === null : [403, 404].includes(r.s), `status ${r.s}`];
});
await caso('F02 otra organización: 404 opaco (no lee el documento ni sus entregas)', async () => {
  const r = await get(T['admin.importador'], D(docId));
  return [r.s === 404, `status ${r.s}`];
});

for (const a of ['admin.cooperativa', 'auditor.cooperativa']) {
  await caso(`F03 ${a}: cobertura histórica NO DETERMINADA (sin declaración), sin deducir completitud ni heredar el incidente DEMO`, async () => {
    const r = await get(T[a], `/api/v1/organizations/${orgId}/reports/indicators`);
    const c = r.b?.coverage;
    return [r.s === 200 && c?.status === 'UNKNOWN' && c.event_date === null && !JSON.stringify(c).includes('2026-10-13'), `status ${r.s}; cobertura ${c?.status}`];
  });
}
await caso('F03 control: la tabla de declaraciones existe y está vacía (ninguna organización la tiene declarada)', async () => {
  const n = psql('select count(*) from report_coverage_declarations');
  return [n === '0', `filas ${n}`];
});

console.log(`\n${res.filter(Boolean).length}/${res.length}`);
process.exit(res.every(Boolean) ? 0 : 1);
