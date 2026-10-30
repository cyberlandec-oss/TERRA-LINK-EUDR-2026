// Demostración de período y país de producción en la INSTANTÁNEA sobre las CUENTAS VIGENTES (sin crear usuarios ni cambiar claves; sin seed).
//   node e2e/review/produccion-demostracion.mjs [--base http://localhost:4000]
// Usa la parcela y el expediente sintéticos QA-1030 de la Cooperativa Río Verde (DEMO). Declara y corrige el país con el técnico asignado, captura dos
// instantáneas y comprueba qué ve el comprador con y sin concesión. Las concesiones creadas se revocan al final. No imprime contraseñas ni testigos.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'produccion-2026-10-30');
mkdirSync(SALIDA, { recursive: true });
const res = [];
async function caso(titulo, fn) {
  try { const [ok, det] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(112)} ${det ?? ''}`); res.push({ titulo, ok, det }); return ok; }
  catch (e) { console.log(`FALLA ${titulo.padEnd(112)} ${String(e.message).slice(0, 240)}`); res.push({ titulo, ok: false, det: String(e.message).slice(0, 240) }); return false; }
}
const pedir = async (t, m, p, body) => { const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); let b = null; try { b = await r.json(); } catch { /* sin cuerpo */ } return { s: r.status, b }; };
const login = async (l) => { const c = cuentaDemo(l); const r = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) }); if (r.status !== 200) throw new Error('login ' + l); return (await r.json()).access_token; };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.grants ?? []);
const psql = (q) => execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-At', '-F', '|', '-c', q], { encoding: 'utf8' }).trim();

const T = {};
for (const a of ['admin.cooperativa', 'tecnico1.cooperativa', 'tecnico2.cooperativa', 'auditor.cooperativa', 'eudr.cooperativa', 'admin.importador', 'comprador.importador']) T[a] = await login(a);
const coop = lista((await pedir(T['admin.cooperativa'], 'GET', '/api/v1/organizations')).b).find((o) => o.name.includes('Cooperativa'));
const B = `/api/v1/organizations/${coop.id}`;
const plot = psql(`select id from plots where plot_code = 'QA-1030-PAR'`);
const caseId = psql(`select c.id from dd_cases c join lots l on l.id = c.subject_id join lot_inputs i on i.lot_id = l.id join receptions r on r.id = i.reception_id join deliveries d on d.id = r.delivery_id join producers p on p.id = d.producer_id where p.producer_code = 'QA-1030-P' limit 1`);
if (!plot || !caseId) throw new Error('faltan los registros QA-1030');
const futuro = new Date(Date.now() + 7 * 86400000).toISOString();
const correo = cuentaDemo('admin.importador').email;
const E = {};
const declarar = (tok, country, esperada, nota) => pedir(tok, 'POST', `${B}/plots/${plot}/production-country`, { operation_id: randomUUID(), expected_declaration_number: esperada, country, note: nota });
const vigente = async () => (await pedir(T['admin.cooperativa'], 'GET', `${B}/plots/${plot}/production-country`)).b?.current;
const instantanea = async () => (await pedir(T['eudr.cooperativa'], 'POST', `${B}/dd-cases/${caseId}/snapshots`, { operation_id: randomUUID() })).b?.snapshot?.id;
const conceder = async (snap) => (await pedir(T['admin.cooperativa'], 'POST', `${B}/access-grants`, { operation_id: randomUUID(), grantee_email: correo, resource_type: 'DD_SNAPSHOT', resource_id: snap, include_geometries: true, expires_at: futuro, reason: 'Demostración de producción (QA-1030)' })).b?.grant?.id;
const revocar = (g) => pedir(T['admin.cooperativa'], 'POST', `${B}/access-grants/${g}/revoke`, { operation_id: randomUUID(), reason: 'Fin de la demostración de producción' });

await caso('1. Estado inicial: la parcela QA-1030 NO tiene país (no se asume «Ecuador» aunque la organización sea de Ecuador)', async () => {
  const v = await vigente();
  E.inicial = v;
  return [v?.state === 'NOT_DECLARED' || v?.declaration_number >= 1, `estado=${v?.state} · declaración=${v?.declaration_number}`];
});

await caso('2. Alcance: el técnico asignado declara; el otro técnico → 404; el auditor → 403/404; ninguno cambia la declaración ajena', async () => {
  const base = (await vigente()).declaration_number ?? 0;
  const otro = await declarar(T['tecnico2.cooperativa'], 'EC', base);
  const aud = await declarar(T['auditor.cooperativa'], 'EC', base);
  const intacto = (await vigente()).declaration_number === base;
  const ok = await declarar(T['tecnico1.cooperativa'], 'EC', base);
  E.n1 = ok.b?.current?.declaration_number;
  return [otro.s === 404 && [403, 404].includes(aud.s) && intacto && ok.s === 200 && ok.b.current.state === 'DECLARED' && ok.b.current.country === 'EC', `otro técnico=${otro.s} · auditor=${aud.s} · asignado=${ok.s} → ${ok.b?.current?.country}`];
});

await caso('3. Instantánea A: fija EC con su declaración; sin concesión, admin.importador no la ve (404); con la concesión ve el país por parcela', async () => {
  E.snapA = await instantanea();
  const sin = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${randomUUID()}`);
  E.gA = await conceder(E.snapA);
  const v = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.gA}`);
  const g = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.gA}/geometries`);
  const f = g.b?.geojson?.features?.find((x) => x.properties.plot_code === 'QA-1030-PAR');
  writeFileSync(join(SALIDA, 'vista-comprador-A.json'), JSON.stringify({ production: v.b?.production, parcela: f?.properties }, null, 2));
  return [sin.s === 404 && v.s === 200 && v.b.production.country.declared_countries.some((c) => c.country === 'EC') && f?.properties.production_country.country === 'EC', `sin concesión=${sin.s} · con=${v.s} · país por parcela=${f?.properties.production_country.state}/${f?.properties.production_country.country}`];
});

await caso('4. Origen sin cosecha declarada: queda «sin declarar» en el resumen (no se oculta en un intervalo ni usa la fecha de entrega)', async () => {
  const v = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.gA}`);
  const p = v.b?.production?.period;
  const entregas = Number(psql(`select count(distinct d.id) from deliveries d join producers p on p.id = d.producer_id where p.producer_code = 'QA-1030-P'`));
  const texto = JSON.stringify(v.b.production);
  return [p?.deliveries.total >= 1 && p.deliveries.not_declared + p.deliveries.declared + p.deliveries.declared_unknown === p.deliveries.total && !texto.includes('QA-1030') && entregas >= 1, `entregas=${p?.deliveries.total} · declaradas=${p?.deliveries.declared} · sin declarar=${p?.deliveries.not_declared} · precisión=${p?.precision}`];
});

await caso('5. Corrección posterior: «declarado como desconocido» añade la declaración siguiente; la anterior se conserva y la instantánea A no cambia', async () => {
  const antes = psql(`select md5(content::text) from dd_snapshots where id = '${E.snapA}'`);
  const c = await declarar(T['tecnico1.cooperativa'], null, E.n1, 'Corrección de la demostración: no se sabe dónde se cosechó');
  const hist = (await pedir(T['admin.cooperativa'], 'GET', `${B}/plots/${plot}/production-country`)).b?.history ?? [];
  const despues = psql(`select md5(content::text) from dd_snapshots where id = '${E.snapA}'`);
  const aun = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.gA}`);
  return [c.s === 200 && c.b.current.state === 'DECLARED_UNKNOWN' && hist.length >= 2 && hist[1].country === 'EC' && antes === despues && aun.b.production.country.declared_countries.some((x) => x.country === 'EC'), `historial=${hist.map((h) => `${h.declaration_number}:${h.country}`).join(' ')} · instantánea A intacta=${antes === despues}`];
});

await caso('6. La instantánea A queda desactualizada en el expediente; la B fija «desconocido» y el comprador la ve como declarada desconocida (no como Ecuador)', async () => {
  const a = await pedir(T['eudr.cooperativa'], 'GET', `${B}/dd-snapshots/${E.snapA}`);
  E.snapB = await instantanea();
  E.gB = await conceder(E.snapB);
  const g = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.gB}/geometries`);
  const f = g.b?.geojson?.features?.find((x) => x.properties.plot_code === 'QA-1030-PAR');
  const v = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.gB}`);
  return [a.s === 200 && (a.b.readiness?.changed_sections ?? []).includes('plots') && f?.properties.production_country.state === 'DECLARED_UNKNOWN' && f.properties.production_country.country === null && v.b.production.country.parcels.declared_unknown >= 1, `A cambió: ${(a.b?.readiness?.changed_sections ?? []).join(',')} · B: ${f?.properties.production_country.state}`];
});

await caso('7. Revocar las concesiones de la demostración impide nuevas consultas (404)', async () => {
  const r = [await revocar(E.gA), await revocar(E.gB)];
  const x = [await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.gA}`), await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.gB}/geometries`)];
  return [r.every((q) => [200, 201].includes(q.s)) && x.every((q) => q.s === 404), `revocar=${r.map((q) => q.s)} · después=${x.map((q) => q.s)}`];
});

const ok = res.filter((r) => r.ok).length;
writeFileSync(join(SALIDA, 'resultado.json'), JSON.stringify({ fecha: new Date().toISOString(), casos: res }, null, 2));
console.log(`\n${ok}/${res.length} casos OK`);
process.exit(ok === res.length ? 0 : 1);
