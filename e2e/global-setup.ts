import { randomBytes } from 'crypto';
import { Client } from 'pg';
import { ADMIN_DATABASE_URL, E2E_DATABASE_URL, SUPER_EMAIL } from './env';

// Prepara la base E2E: la crea si falta, recrea su esquema, migra y siembra el SUPER_ADMIN con una
// contraseña aleatoria por corrida (no versionada). Requiere `npm run build -w apps/api` antes.
export default async function globalSetup(): Promise<void> {
  const name = new URL(E2E_DATABASE_URL).pathname.slice(1);
  if (!name.endsWith('_e2e')) throw new Error('La base E2E debe terminar en _e2e');

  const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();

  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  await db.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await db.end();

  // Reutiliza migraciones y hashing reales de la API compilada.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createDb, migrateToLatest } = require('../apps/api/dist/db/database');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { hashPassword } = require('../apps/api/dist/auth/passwords');
  const kdb = createDb(E2E_DATABASE_URL);
  await migrateToLatest(kdb);
  const password = randomBytes(12).toString('base64url');
  await kdb
    .insertInto('users')
    .values({ email: SUPER_EMAIL, first_name: 'Super', last_name: 'E2E', password_hash: await hashPassword(password), status: 'ACTIVE', platform_role: 'SUPER_ADMIN' })
    .execute();
  await kdb.destroy();
  process.env.E2E_SUPER_PASSWORD = password;
}
