import { randomBytes, randomUUID } from 'crypto';
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { sql } from 'kysely';
import { hashPassword } from '../auth/passwords';
import { createDb } from './database';

const ENV_PATH = process.env.TL_ENV_FILE ? resolve(process.env.TL_ENV_FILE) : resolve(__dirname, '..', '..', '..', '..', '.env');

/** Contraseña local nueva. Se devuelve para usarla; **nunca** se imprime. */
const newPassword = () => `Local-${randomBytes(18).toString('base64url')}`;

/**
 * Sustituye el valor de `SEED_ADMIN_PASSWORD` en el archivo de entorno, conservando todo lo demás byte a byte.
 * Si la variable no está, la añade. Lanza si el archivo no se puede escribir: entonces no se activa nada.
 */
function rewriteEnvPassword(text: string, pwd: string): string {
  const linea = `SEED_ADMIN_PASSWORD=${pwd}`;
  return /^SEED_ADMIN_PASSWORD=.*$/m.test(text)
    ? text.replace(/^SEED_ADMIN_PASSWORD=.*$/m, linea)
    : `${text}${text.endsWith('\n') ? '' : '\n'}${linea}\n`;
}

/**
 * Rotación de la contraseña del SUPER_ADMIN **de desarrollo** (`SEED_ADMIN_EMAIL`), p. ej. tras exponerse el
 * valor de `.env` en una consola.
 *
 * Alcance deliberadamente estrecho: toca **una** cuenta, la del archivo de entorno, y **no crea ninguna**. No es
 * el seed general y no comparte código con él: `seed:dev` solo da de alta si falta, y `seed:demo --rotar` es
 * para las cuentas DEMO, que son otras. Si esta cuenta no existe, falla en vez de crearla.
 *
 * Orden seguro, el mismo que en las cuentas DEMO: 1) escribir la credencial nueva en `.env` (si no se puede, no
 * se rota); 2) activarla e invalidar sesiones (`token_version + 1`), restaurando el archivo si eso falla;
 * 3) verificar contra la API, si responde. No se imprime ninguna contraseña.
 */
async function rotateAdmin(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const anterior = process.env.SEED_ADMIN_PASSWORD;
  if (!url || !email) throw new Error('Definir DATABASE_URL y SEED_ADMIN_EMAIL en .env');
  if (!existsSync(ENV_PATH)) throw new Error(`No se encuentra el archivo de entorno: ${ENV_PATH}`);
  try { closeSync(openSync(ENV_PATH, 'r+')); } catch { throw new Error(`${ENV_PATH} no se puede escribir: no se rota nada.`); }

  const db = createDb(url);
  try {
    const user = await db.selectFrom('users').select(['id', 'platform_role']).where('email', '=', email).executeTakeFirst();
    if (!user) throw new Error('La cuenta de SEED_ADMIN_EMAIL no existe: esta rotación no crea cuentas.');
    const original = readFileSync(ENV_PATH, 'utf8');
    const fresh = newPassword();
    writeFileSync(ENV_PATH, rewriteEnvPassword(original, fresh), { encoding: 'utf8' });
    try {
      await db.updateTable('users').set({ password_hash: await hashPassword(fresh), token_version: sql`token_version + 1` } as never)
        .where('id', '=', user.id).execute();
    } catch (err) {
      writeFileSync(ENV_PATH, original, { encoding: 'utf8' });
      throw err;
    }
    await db.insertInto('audit_logs').values({
      id: randomUUID(), organization_id: null, actor_user_id: user.id, action: 'user.password_rotated',
      entity_type: 'user', entity_id: user.id, result: 'SUCCESS',
      reason: 'Rotación del SUPER_ADMIN de desarrollo por exposición del valor de .env; sesiones anteriores invalidadas',
      after: JSON.stringify({ source: 'SEED_ADMIN_PASSWORD', scope: 'solo esta cuenta' }),
    } as never).execute();

    // Verificación contra la API, si está levantada. No es obligatoria: `seed:dev` se usa sin la aplicación.
    const base = process.env.TL_API_BASE ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
    const status = async (pwd: string) => {
      const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pwd }) });
      return r.status;
    };
    let verificacion = 'API no disponible: sin verificar';
    try {
      const okNew = (await status(fresh)) === 200;
      const oldRejected = anterior ? (await status(anterior)) === 401 : true;
      verificacion = `login nuevo=${okNew}; anterior rechazada=${anterior ? oldRejected : 'n/d'}`;
      if (!okNew || !oldRejected) process.exitCode = 1;
    } catch { /* la API no responde: la rotación ya está hecha y se declara sin verificar */ }
    console.log(`Rotación de SEED_ADMIN_PASSWORD: valor nuevo guardado en ${ENV_PATH}; ${verificacion}; sesiones previas invalidadas. Cuenta: ${email} (${user.platform_role}).`);
  } finally {
    await db.destroy();
  }
}

// Seed exclusivamente local: crea el SUPER_ADMIN inicial desde SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD.
// La contraseña nunca se versiona ni se imprime.
async function main(): Promise<void> {
  if (process.argv.includes('--rotar-admin')) return rotateAdmin();
  const url = process.env.DATABASE_URL;
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!url || !email || !password) {
    throw new Error('Definir DATABASE_URL, SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD en .env');
  }
  if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD debe tener al menos 12 caracteres');
  const db = createDb(url);
  try {
    const existing = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
    if (existing) {
      console.log('SUPER_ADMIN ya existe; sin cambios');
      return;
    }
    await db
      .insertInto('users')
      .values({
        email,
        first_name: 'Administrador',
        last_name: 'Plataforma',
        password_hash: await hashPassword(password),
        status: 'ACTIVE',
        platform_role: 'SUPER_ADMIN',
      })
      .execute();
    console.log(`SUPER_ADMIN creado: ${email}`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error('Fallo del seed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
