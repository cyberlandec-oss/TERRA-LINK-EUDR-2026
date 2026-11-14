// Carga una credencial Whisp mediante el endpoint protegido de una organización.
// Los secretos se solicitan por stdin sin eco y no se aceptan por argumentos,
// variables de entorno, archivos ni historial.
import { createInterface } from 'node:readline';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg('--base', 'http://localhost:4100').replace(/\/$/, '');
const ORG = arg('--org');
if (!ORG) { console.error('Uso: node scripts/cargar-credencial-whisp-oculta.mjs --org <uuid> [--base http://localhost:4100]'); process.exit(2); }

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (label) => new Promise((resolve) => rl.question(label, resolve));
const secret = (label) => new Promise((resolve, reject) => {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') return reject(new Error('La entrada debe ser una terminal interactiva; no se acepta secreto redirigido.'));
  process.stdout.write(label);
  let value = '';
  const onData = (chunk) => {
    const text = chunk.toString();
    if (text === '\u0003') { cleanup(); reject(new Error('cancelado')); return; }
    if (text === '\r' || text === '\n') { cleanup(); process.stdout.write('\n'); resolve(value); return; }
    if (text === '\u007f') { value = value.slice(0, -1); return; }
    if (text.length === 1) value += text;
  };
  const cleanup = () => { input.off('data', onData); input.setRawMode(false); input.pause(); };
  input.setRawMode(true); input.resume(); input.on('data', onData);
});

console.log(`Destino: ${BASE}`);
console.log(`Organización QA: ${ORG}`);
try {
  const email = await ask('Cuenta con integration:manage: ');
  rl.pause();
  const password = await secret('Contraseña: ');
  const key = await secret('Clave Whisp: ');
  rl.close();
  const login = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`inicio de sesión rechazado (${login.status})`);
  const token = (await login.json()).access_token;
  const put = await fetch(`${BASE}/api/v1/organizations/${ORG}/satellite/credentials/WHISP`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ secret: key }) });
  const body = await put.json().catch(() => null);
  if (!put.ok) throw new Error(`carga rechazada (${put.status})`);
  const meta = body?.providers?.find((p) => p.provider_code === 'WHISP') ?? { provider_code: 'WHISP', configured: true };
  console.log(JSON.stringify({ status: put.status, provider_code: meta.provider_code, configured: meta.configured, created_at: meta.created_at ?? null, rotated_at: meta.rotated_at ?? null }));
} catch (error) {
  rl.close();
  console.error(error instanceof Error ? error.message : 'fallo de carga');
  process.exitCode = 1;
}
