import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Carga ../.env sin sobrescribir variables ya definidas (en CI no existe .env). No imprime valores.
const file = resolve(__dirname, '..', '.env');
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

if (!process.env.DATABASE_URL) throw new Error('Definir DATABASE_URL (o crear .env desde .env.example)');

// Base exclusiva de E2E, separada de dev (terra_link) y de integración (terra_link_test).
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? withDatabase(process.env.DATABASE_URL, 'terra_link_e2e');
export const ADMIN_DATABASE_URL = withDatabase(process.env.DATABASE_URL, 'postgres');
export const API_PORT = 4100;
export const WEB_PORT = 3100;
export const API_URL = `http://localhost:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const SUPER_EMAIL = 'super@e2e.local';
