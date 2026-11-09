// Demostración de la concesión de GEOMETRÍAS de una instantánea sobre las CUENTAS VIGENTES (sin crear usuarios ni cambiar claves; sin seed).
//   node e2e/review/geometrias-demostracion.mjs [--base http://localhost:4000]
// Usa la instantánea del expediente QA-1030 de la Cooperativa Río Verde (DEMO). Crea UNA concesión de geometrías para `admin.importador`
// (la concesión de soportes de `comprador.importador` queda intacta) y la revoca al final. No imprime contraseñas ni testigos.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'geometrias-2026-10-30');
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
for (const a of ['admin.cooperativa', 'comprador.importador', 'admin.importador']) T[a] = await login(a);
const coop = lista((await pedir(T['admin.cooperativa'], 'GET', '/api/v1/organizations')).b).find((o) => o.name.includes('Cooperativa'));
const B = `/api/v1/organizations/${coop.id}`;
const snap = psql(`select s.id from dd_snapshots s join dd_cases c on c.id = s.case_id join lots l on l.id = c.subject_id join lot_inputs i on i.lot_id = l.id join receptions r on r.id = i.reception_id join deliveries d on d.id = r.delivery_id join producers p on p.id = d.producer_id where p.producer_code = 'QA-1030-P' order by s.captured_at desc limit 1`);
if (!snap) throw new Error('no hay instantánea QA-1030');
const contenido = JSON.parse(psql(`select content::text from dd_snapshots where id = '${snap}'`));
const fijada = contenido.plots[0];
const futuro = new Date(Date.now() + 7 * 86400000).toISOString();
const E = {};

await caso('1. Concesión ANTIGUA (soportes, sin geometrías): la vista dice «no compartida» y la ruta de geometrías responde 403 claro', async () => {
  const mias = lista((await pedir(T['comprador.importador'], 'GET', '/api/v1/granted')).b);
  const vieja = mias.find((g) => g.resource_type === 'DD_SNAPSHOT');
  if (!vieja) return [false, 'no hay concesión de instantánea vigente para el comprador'];
  const v = await pedir(T['comprador.importador'], 'GET', `/api/v1/granted/${vieja.id}`);
  const r = await pedir(T['comprador.importador'], 'GET', `/api/v1/granted/${vieja.id}/geometries`);
  return [vieja.include_geometries === false && v.b?.geometries?.shared === false && r.s === 403 && r.b?.error?.code === 'GRANT_GEOMETRIES_NOT_INCLUDED', `include_geometries=${vieja.include_geometries} · ${r.s} ${r.b?.error?.code}`];
});

await caso('2. La administración concede las geometrías (decisión aparte) a admin.importador; un técnico/otra cuenta no puede conceder', async () => {
  const sin = await pedir(T['comprador.importador'], 'POST', `${B}/access-grants`, { operation_id: randomUUID(), grantee_email: cuentaDemo('admin.importador').email, resource_type: 'DD_SNAPSHOT', resource_id: snap, include_geometries: true, expires_at: futuro, reason: 'No debería poder' });
  const g = await pedir(T['admin.cooperativa'], 'POST', `${B}/access-grants`, { operation_id: randomUUID(), grantee_email: cuentaDemo('admin.importador').email, resource_type: 'DD_SNAPSHOT', resource_id: snap, include_geometries: true, expires_at: futuro, reason: 'Demostración de geometrías (QA-1030)' });
  E.grant = g.b?.grant?.id;
  return [[403, 404].includes(sin.s) && g.s === 201 && g.b.grant.include_geometries === true && g.b.grant.include_documents === false, `sin permiso=${sin.s} · concesión=${g.s}`];
});

await caso('3. El destinatario recibe la geometría EXACTA de la instantánea: mismo tipo, mismas coordenadas, misma versión y huella', async () => {
  const r = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.grant}/geometries`);
  const f = r.b?.geojson?.features?.[0];
  const ok = r.s === 200 && f && f.geometry.type === fijada.geometry.type && JSON.stringify(f.geometry.coordinates) === JSON.stringify(fijada.geometry.coordinates)
    && f.properties.version_number === fijada.version_number && f.properties.geometry_hash === fijada.geometry_hash && f.properties.plot_code === fijada.plot_code;
  writeFileSync(join(SALIDA, 'geometrias-recibidas.geojson'), JSON.stringify(r.b?.geojson ?? {}, null, 2));
  return [Boolean(ok), `${f?.geometry?.type} · v${f?.properties?.version_number} · ${String(f?.properties?.geometry_hash).slice(0, 12)}…`];
});

await caso('4. Sin identidad del productor ni identificadores internos; la concesión de soportes del otro comprador sigue intacta', async () => {
  const r = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.grant}/geometries`);
  const t = JSON.stringify(r.b);
  const prod = psql(`select legal_name from producers where producer_code = 'QA-1030-P'`);
  const pid = psql(`select id from plots where plot_code = 'QA-1030-PAR'`);
  const soportes = lista((await pedir(T['comprador.importador'], 'GET', '/api/v1/granted')).b).filter((g) => g.include_documents).length;
  return [r.s === 200 && !t.includes(prod) && !t.includes(pid) && !t.includes(coop.id) && soportes >= 1, `soportes del otro comprador vigentes: ${soportes}`];
});

await caso('5. Destinatario incorrecto: otra cuenta con la misma organización no la ve (404), igual que un identificador inexistente', async () => {
  const otra = await pedir(T['comprador.importador'], 'GET', `/api/v1/granted/${E.grant}/geometries`);
  const nada = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${randomUUID()}/geometries`);
  const control = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.grant}/geometries`);
  return [otra.s === 404 && nada.s === 404 && control.s === 200, `otra=${otra.s} · inexistente=${nada.s} · control=${control.s}`];
});

await caso('6. Los términos no se editan (revocar y conceder otra) y la lectura queda auditada', async () => {
  let rechazado = false;
  try { psql(`update access_grants set include_geometries = false where id = '${E.grant}'`); } catch { rechazado = true; }
  const aud = psql(`select count(*) from audit_logs where entity_id = '${E.grant}' and action = 'grant.geometries_read'`);
  return [rechazado && Number(aud) >= 2, `edición rechazada=${rechazado} · lecturas auditadas=${aud}`];
});

await caso('7. Revocar impide nuevas consultas (404). No retira lo ya descargado: el archivo guardado sigue en poder del destinatario', async () => {
  const antes = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.grant}/geometries`);
  const rv = await pedir(T['admin.cooperativa'], 'POST', `${B}/access-grants/${E.grant}/revoke`, { operation_id: randomUUID(), reason: 'Fin de la demostración de geometrías' });
  const despues = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.grant}/geometries`);
  const vista = await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.grant}`);
  return [antes.s === 200 && [200, 201].includes(rv.s) && despues.s === 404 && vista.s === 404, `antes=${antes.s} · revocar=${rv.s} · después=${despues.s}/${vista.s}`];
});

const ok = res.filter((r) => r.ok).length;
writeFileSync(join(SALIDA, 'resultado.json'), JSON.stringify({ fecha: new Date().toISOString(), instantanea: snap, casos: res }, null, 2));
console.log(`\n${ok}/${res.length} casos OK`);
process.exit(ok === res.length ? 0 : 1);
