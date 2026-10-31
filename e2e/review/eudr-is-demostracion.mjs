// Demostración de la conexión con EUDR-IS (P1-007, tramo 1) sobre el DESPLIEGUE y las CUENTAS VIGENTES. Solo LECTURA y rechazos: no registra credenciales en el DEMO,
// no crea usuarios, no cambia claves y NO contacta con ningún servicio externo (las llamadas a EUDR-IS siguen apagadas). No imprime contraseñas ni tokens.
//   node e2e/review/eudr-is-demostracion.mjs [--base http://localhost:4000]
// El almacenamiento aislado por organización y entorno y el Echo con transporte controlado se demuestran en la base DESECHABLE (apps/api/test/eudr-is.int-spec.ts).
import { spawnSync } from 'node:child_process';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--base', 'http://localhost:4000');
const res = [];
async function caso(titulo, fn) {
  try { const [ok, det] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(112)} ${det ?? ''}`); res.push(ok); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(112)} ${String(e.message).slice(0, 200)}`); res.push(false); }
}
const login = async (alias) => { const c = cuentaDemo(alias); const r = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) }); if (r.status !== 200) throw new Error('login ' + alias); return (await r.json()).access_token; };
const pedir = async (t, m, p, body, intento = 0) => { let r; try { r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); } catch (e) { if (intento === 0) return pedir(t, m, p, body, 1); throw e; } /* conexión inactiva cerrada por el servidor: se reintenta una vez la LECTURA */ let b = null; try { b = await r.json(); } catch { /* sin cuerpo */ } return { s: r.status, b }; };

const T = {};
for (const a of ['admin.exportadora', 'exportacion.exportadora', 'auditor.exportadora', 'admin.importador']) T[a] = await login(a);
const orgs = async (t) => (await pedir(t, 'GET', '/api/v1/organizations')).b;
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? []);
const exportadora = lista(await orgs(T['admin.exportadora'])).find((o) => o.name.includes('Exportadora'));
const importadora = lista(await orgs(T['admin.importador'])).find((o) => o.name.includes('Chocolates'));
const E = `/api/v1/organizations/${exportadora.id}/eudr-is`;
const CUERPO = { username: 'usuario-sintetico', authentication_key: 'clave-sintetica-1', web_service_client_id: 'cliente-sintetico' };

await caso('estado: el administrador consulta los dos entornos, sin credenciales ni valores, y las llamadas a EUDR-IS apagadas', async () => {
  const r = await pedir(T['admin.exportadora'], 'GET', `${E}/credentials`);
  const ent = r.b?.environments ?? [];
  const texto = JSON.stringify(r.b);
  return [r.s === 200 && r.b.live_calls_enabled === false && ent.length === 2 && ent.every((e) => e.configured === false) && !/ciphertext|authentication_key|username/.test(texto), `ACCEPTANCE echo=${ent.find((e) => e.environment === 'ACCEPTANCE')?.echo_documented}; PRODUCTION echo=${ent.find((e) => e.environment === 'PRODUCTION')?.echo_documented}`];
});
await caso('Echo documentado solo para ACCEPTANCE: PRODUCTION lo declara así en el estado', async () => {
  const r = await pedir(T['admin.exportadora'], 'GET', `${E}/credentials`);
  const ent = r.b?.environments ?? [];
  return [ent.find((e) => e.environment === 'ACCEPTANCE')?.echo_documented === true && ent.find((e) => e.environment === 'PRODUCTION')?.echo_documented === false, ''];
});
await caso('rechazo: quien solo opera (EXPORT_MANAGER) no registra credenciales (403) ni comprueba la conexión (403)', async () => {
  const a = await pedir(T['exportacion.exportadora'], 'PUT', `${E}/credentials/ACCEPTANCE`, CUERPO);
  const b = await pedir(T['exportacion.exportadora'], 'POST', `${E}/echo/ACCEPTANCE`, {});
  return [[403, 404].includes(a.s) && [403, 404].includes(b.s), `PUT ${a.s}; echo ${b.s}`];
});
await caso('rechazo: el auditor tampoco registra credenciales', async () => {
  const a = await pedir(T['auditor.exportadora'], 'PUT', `${E}/credentials/ACCEPTANCE`, CUERPO);
  return [[403, 404].includes(a.s), `PUT ${a.s}`];
});
await caso('rechazo entre organizaciones: el administrador de la importadora no ve ni escribe en la exportadora (404)', async () => {
  const a = await pedir(T['admin.importador'], 'GET', `${E}/credentials`);
  const b = await pedir(T['admin.importador'], 'PUT', `${E}/credentials/ACCEPTANCE`, CUERPO);
  return [a.s === 404 && b.s === 404, `GET ${a.s}; PUT ${b.s}`];
});
await caso('control de la cuenta propia: el administrador de la importadora sí consulta SU organización', async () => {
  const a = await pedir(T['admin.importador'], 'GET', `/api/v1/organizations/${importadora.id}/eudr-is/credentials`);
  return [a.s === 200 && a.b.environments.every((e) => e.configured === false), `GET ${a.s}`];
});
await caso('entorno inválido: 422 y sin efectos (la lista sigue sin credenciales)', async () => {
  const a = await pedir(T['admin.exportadora'], 'PUT', `${E}/credentials/LAB`, CUERPO);
  const b = await pedir(T['admin.exportadora'], 'GET', `${E}/credentials`);
  return [a.s === 422 && b.b.environments.every((e) => !e.configured), `PUT ${a.s}`];
});
await caso('Echo con las llamadas apagadas: 409 EUDR_IS_LIVE_CALLS_DISABLED y no sale ninguna llamada; PRODUCTION: 409/422 sin Echo documentado', async () => {
  const a = await pedir(T['admin.exportadora'], 'POST', `${E}/echo/ACCEPTANCE`, {});
  const b = await pedir(T['admin.exportadora'], 'POST', `${E}/echo/PRODUCTION`, {});
  return [a.s === 409 && a.b?.error?.code === 'EUDR_IS_LIVE_CALLS_DISABLED' && b.s === 422 && b.b?.error?.code === 'ECHO_NOT_DOCUMENTED_FOR_ENVIRONMENT', `ACCEPTANCE ${a.b?.error?.code}; PRODUCTION ${b.b?.error?.code}`];
});

// Cargador local: sin valores o sin organización/entorno explícitos NO escribe nada y no muestra valores.
const cargador = (args) => { const r = spawnSync('npm', ['run', 'eudr-is:cargar', '-w', 'apps/api', '--', ...args], { encoding: 'utf8', shell: true }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };
await caso('cargador sin organización: rechaza (no hay organización por defecto)', async () => {
  const r = cargador(['--env', 'ACCEPTANCE']);
  return [r.code !== 0 && /--org/.test(r.out), ''];
});
await caso('cargador sin entorno: rechaza (no se reutiliza entre entornos)', async () => {
  const r = cargador(['--org', exportadora.id]);
  return [r.code !== 0 && /--env/.test(r.out), ''];
});
await caso('cargador con las variables vacías: dice cuáles faltan, no escribe y no muestra ningún valor', async () => {
  const r = cargador(['--org', exportadora.id, '--env', 'ACCEPTANCE']);
  const despues = await pedir(T['admin.exportadora'], 'GET', `${E}/credentials`);
  return [r.code !== 0 && /Faltan valores/.test(r.out) && /EUDR_IS_ACCEPTANCE_USERNAME/.test(r.out) && despues.b.environments.every((e) => !e.configured), 'sin cambios en la organización'];
});

console.log(`\n${res.filter(Boolean).length}/${res.length}`);
process.exit(res.every(Boolean) ? 0 : 1);
