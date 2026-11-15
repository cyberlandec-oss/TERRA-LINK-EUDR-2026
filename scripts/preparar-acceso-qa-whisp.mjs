// Invita y acepta una cuenta QA mediante los flujos API existentes.
// No escribe usuarios directamente, no imprime tokens ni contraseñas.
import { createInterface } from 'node:readline';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const BASE = arg('--base', 'http://localhost:4100').replace(/\/$/, '');
const ORG = arg('--org');
if (!ORG) { console.error('Uso: node scripts/preparar-acceso-qa-whisp.mjs --org <uuid> [--base http://localhost:4100]'); process.exit(2); }
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (label) => new Promise((resolve) => rl.question(label, resolve));
const secret = (label) => new Promise((resolve, reject) => {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') return reject(new Error('La entrada debe ser una terminal interactiva; no se aceptan secretos redirigidos.'));
  process.stdout.write(label); let value = ''; let done = false;
  const cleanup = () => { input.off('data', onData); input.setRawMode(false); input.pause(); };
  const onData = (chunk) => { for (const ch of chunk.toString()) { if (done) return; if (ch === '\u0003') { done = true; cleanup(); reject(new Error('cancelado')); return; } if (ch === '\r' || ch === '\n') { done = true; cleanup(); process.stdout.write('\n'); resolve(value); return; } if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1); else if (ch >= ' ') value += ch; } };
  input.setRawMode(true); input.resume(); input.on('data', onData);
});
const request = async (path, init = {}) => {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path} rechazado (${r.status})`);
  return body;
};
try {
  console.log(`Destino: ${BASE}`); console.log(`Organización QA: ${ORG}`);
  const ownerEmail = await ask('Cuenta administradora autorizada: '); rl.pause();
  const ownerPassword = await secret('Contraseña administradora: ');
  const login = await request('/api/v1/auth/login', { method: 'POST', body: { email: ownerEmail, password: ownerPassword } });
  const ownerToken = login.access_token;
  rl.resume();
  const targetEmail = await ask('Correo de la cuenta QA nueva: '); rl.pause();
  const invitation = await request(`/api/v1/organizations/${ORG}/invitations`, { method: 'POST', token: ownerToken, body: { email: targetEmail, role_code: 'ORG_ADMIN' } });
  const invitationToken = invitation.token;
  if (!invitationToken) throw new Error('La API no devolvió token de invitación; no se puede continuar sin mostrarlo.');
  const targetPassword = await secret('Contraseña que establecerá la cuenta QA: ');
  await request('/api/v1/invitations/accept', { method: 'POST', body: { token: invitationToken, first_name: 'QA', last_name: 'Whisp', password: targetPassword } });
  const targetLogin = await request('/api/v1/auth/login', { method: 'POST', body: { email: targetEmail, password: targetPassword } });
  const permissions = await request('/api/v1/me/permissions', { token: targetLogin.access_token });
  const context = permissions.organizations?.find((x) => x.organization_id === ORG);
  if (!context?.permissions?.includes('integration:manage')) throw new Error('La cuenta QA no tiene integration:manage en la organización indicada.');
  console.log(JSON.stringify({ organization_id: ORG, account: targetEmail, role: 'ORG_ADMIN', integration_manage: true }));
} catch (error) { rl.close(); console.error(error instanceof Error ? error.message : 'fallo de preparación'); process.exitCode = 1; }
