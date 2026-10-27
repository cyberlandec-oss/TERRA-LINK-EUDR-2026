// A-01 — Prepara una organización de ENSAYO para probar a mano el recorrido de captura de campo desde la web.
//
//   node e2e/review/a01-preparar-prueba-manual.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Crea «ENSAYO A-01 · prueba manual» con datos SINTÉTICOS: administrador, técnico, dos productores vinculados, un productor sin cuenta,
// auditor y comprador, con parcelas sin ubicación. Las contraseñas se generan al azar y se escriben SOLO en CREDENCIALES_A01.csv
// (raíz del repositorio; el patrón CREDENCIALES* está ignorado por git). No se imprimen y no van en ninguna documentación versionada.
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--base', 'http://localhost:4000');
const WEB = arg('--web', 'http://localhost:3000');
const pedir = async (token, metodo, path, cuerpo) => {
  const r = await fetch(`${API}${path}`, { method: metodo, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cuerpo ? { 'content-type': 'application/json' } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const body = await r.json().catch(() => null);
  if (r.status >= 300) throw new Error(`${metodo} ${path} → ${r.status} ${body?.error?.code ?? ''}`);
  return body;
};
const login = async (email, password) => (await pedir(null, 'POST', '/api/v1/auth/login', { email, password })).access_token;
const pass = () => randomBytes(14).toString('base64url') + 'aA1!';

const sup = cuentaDemo('superadmin.revision');
const superTok = await login(sup.email, sup.contrasena);
const suf = randomBytes(2).toString('hex');
const org = await pedir(superTok, 'POST', '/api/v1/organizations', { name: `ENSAYO A-01 · prueba manual ${suf}`, organization_type: 'COOPERATIVE', country: 'EC' });
const base = `/api/v1/organizations/${org.id}`;
const cuentas = {};
const alta = async (clave, rol, por) => {
  const email = `a01.manual.${clave}.${suf}@ensayo.terralink.local`; const password = pass();
  const inv = await pedir(por, 'POST', `${base}/invitations`, { email, role_code: rol });
  await pedir(null, 'POST', '/api/v1/invitations/accept', { token: inv.token, first_name: 'Ensayo', last_name: clave, password });
  cuentas[clave] = { email, password, rol };
};
await alta('admin', 'ORG_ADMIN', superTok);
const adminTok = await login(cuentas.admin.email, cuentas.admin.password);
for (const [c, r] of [['tecnico', 'FIELD_TECHNICIAN'], ['productor1', 'PRODUCER'], ['productor2', 'PRODUCER'], ['auditor', 'AUDITOR'], ['comprador', 'BUYER']]) await alta(c, r, adminTok);
const miembros = await pedir(adminTok, 'GET', `${base}/members`);
const lista = Array.isArray(miembros) ? miembros : miembros.members;
const mem = (c) => lista.find((m) => m.email === cuentas[c].email).membership_id;
const productor = async (code, nombre, extra = {}) => (await pedir(adminTok, 'POST', `${base}/producers`, { producer_code: code, legal_name: nombre, ...extra })).id;
const pP1 = await productor('PM-P1', 'Finca Uno (sintética)');
const pP2 = await productor('PM-P2', 'Finca Dos (sintética)');
const pT = await productor('PM-T', 'Finca del técnico (sintética)', { assigned_membership_id: mem('tecnico') });
const vincular = async (p, c) => { const v = (await pedir(adminTok, 'GET', `${base}/producers/${p}`)).row_version; await pedir(adminTok, 'PUT', `${base}/producers/${p}/self-membership`, { expected_version: v, membership_id: mem(c), reason: 'Alta del productor en la plataforma (prueba manual A-01)' }); };
await vincular(pP1, 'productor1'); await vincular(pP2, 'productor2');
for (const [p, code] of [[pP1, 'PM-L1'], [pP1, 'PM-L1B'], [pP2, 'PM-L2'], [pT, 'PM-LT']]) await pedir(adminTok, 'POST', `${base}/plots`, { producer_id: p, plot_code: code, crop: 'Cacao' });

const filas = [['rol', 'correo', 'contrasena'], ...Object.values(cuentas).map((c) => [c.rol, c.email, c.password])];
writeFileSync('CREDENCIALES_A01.csv', filas.map((f) => f.join(',')).join('\n') + '\n');
console.log(`Organización: ${org.name}`);
console.log(`Acceso: ${WEB}/  (correo y contraseña en CREDENCIALES_A01.csv, ignorado por git; no se imprimen aquí)`);
console.log(`Captura: ${WEB}/organizaciones/${org.id}/captura`);
console.log('Cuentas: ' + Object.entries(cuentas).map(([k, c]) => `${k}=${c.email}`).join(' · '));
