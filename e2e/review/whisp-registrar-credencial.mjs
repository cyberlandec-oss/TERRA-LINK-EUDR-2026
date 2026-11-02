// Registra la clave de API de Whisp COMO CREDENCIAL CIFRADA DE UNA ORGANIZACIÓN (la que usa el worker). Distinto del ensayo directo (`whisp-ensayo-real.mjs`).
//
//   TL_EMAIL=admin@org TL_PASSWORD=… node e2e/review/whisp-registrar-credencial.mjs --org <uuid> [--base http://localhost:4000] [--quitar]
//
// La clave se lee de WHISP_API_KEY (entorno o `.env` local ignorado por git); nunca se imprime. Exige una cuenta con `integration:manage` en esa organización.
// Registrarla NO activa llamadas reales: además hacen falta SATELLITE_LIVE_CALLS=enabled y WHISP como proveedor SELECTED (D-09 B).
import { readFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:4000');
const org = arg('--org');
const quitar = process.argv.includes('--quitar');
let clave = process.env.WHISP_API_KEY;
if (!clave) { try { const m = readFileSync('.env', 'utf8').match(/^WHISP_API_KEY=(.+)$/m); if (m) clave = m[1].trim().replace(/^["']|["']$/g, ''); } catch { /* sin .env */ } }
if (!org || !process.env.TL_EMAIL || !process.env.TL_PASSWORD || (!quitar && !clave)) {
  console.error('Faltan datos. Necesito: --org <uuid>, TL_EMAIL y TL_PASSWORD (cuenta con integration:manage)' + (quitar ? '' : ' y WHISP_API_KEY (entorno o .env)') + '.');
  process.exit(2);
}
const login = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.TL_EMAIL, password: process.env.TL_PASSWORD }) });
if (!login.ok) { console.error(`Inicio de sesión rechazado (${login.status}).`); process.exit(1); }
const token = (await login.json()).access_token;
const r = await fetch(`${BASE}/api/v1/organizations/${org}/satellite/credentials/WHISP`, {
  method: quitar ? 'DELETE' : 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: quitar ? undefined : JSON.stringify({ secret: clave }),
});
const cuerpo = await r.json().catch(() => null);
console.log(r.status, JSON.stringify(cuerpo?.providers?.find((p) => p.provider_code === 'WHISP') ?? cuerpo?.error ?? null));
process.exit(r.ok ? 0 : 1);
