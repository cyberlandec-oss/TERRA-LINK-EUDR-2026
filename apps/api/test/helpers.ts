import type { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import type { AppConfig } from '../src/config';
import { instrumentarConsulta } from '../src/observability/db-hook';
import { createDb, migrateToLatest, PG_SESSION_OPTIONS } from '../src/db/database';
import { S3ObjectStore } from '../src/storage/object-store';
import type { Database } from '../src/db/schema';
import { hashPassword } from '../src/auth/passwords';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Diagnóstico acotado del timeout intermitente (P0-004): tiempos de fases del arnés (reinicio del esquema,
// migraciones, arranque, cierre) y consultas ≥ 1 s (solo texto SQL, sin parámetros). No cambia timeouts.
const TIMINGS_DIR = join(__dirname, '..', 'test-results');
function recordTiming(entry: Record<string, unknown>) {
  try {
    mkdirSync(TIMINGS_DIR, { recursive: true });
    appendFileSync(join(TIMINGS_DIR, 'harness-timings.jsonl'), JSON.stringify({ at: new Date().toISOString(), suite: expect.getState().testPath?.split(/[\\/]/).pop(), ...entry }) + '\n');
  } catch { /* el diagnóstico nunca hace fallar una prueba */ }
}

// Arnés de integración: PostgreSQL/PostGIS real (base *_test, esquema recreado) y Redis real con
// prefijo de claves único por corrida. Sin credenciales reales: todo sale de TEST_DATABASE_URL/REDIS_URL.
export const TEST_URL = process.env.TEST_DATABASE_URL;
export const REDIS_URL = process.env.REDIS_URL;
export const describeDb = TEST_URL && REDIS_URL ? describe : describe.skip;
export const PASSWORD = 'password-de-prueba-123';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    databaseUrl: TEST_URL!,
    redisUrl: REDIS_URL!,
    redisKeyPrefix: `tl-test:${randomUUID()}:`,
    jwtSecret: 'x'.repeat(40),
    jwtTtlSeconds: 600,
    webOrigin: 'http://localhost:3000',
    trustProxy: false,
    loginRateLimit: { windowSeconds: 900, maxPerAccountAndIp: 5, maxPerAccount: 20, maxPerIp: 50 },
    invitationTtlHours: 72,
    // Claves efímeras por corrida: nunca las del .env ni versionadas.
    pii: { keys: { t1: randomBytes(32) }, activeKeyId: 't1', indexKey: randomBytes(32) },
    // Bucket propio de pruebas (nunca el de desarrollo).
    objectStore: {
      endpoint: process.env.S3_ENDPOINT ?? `http://localhost:${process.env.S3_PORT ?? '9000'}`, region: 'us-east-1',
      accessKey: process.env.S3_ACCESS_KEY ?? '', secretKey: process.env.S3_SECRET_KEY ?? '', bucket: 'terra-link-test',
    },
    geojson: { maxBytes: 1_048_576, maxPositions: 5000, maxDepth: 10, maxComponents: 50, maxRingsPerPolygon: 50 },
    scanner: { host: process.env.SCANNER_HOST ?? 'localhost', port: Number(process.env.SCANNER_PORT ?? 3310), timeoutMs: 30_000 },
    documents: { maxBytes: 64 * 1024, orgQuotaBytes: 256 * 1024 },
    sso: { enabled: false, issuer: '', discoveryUrl: '', clientId: '', clientSecret: '', redirectUris: [], scope: 'openid email profile', flowTtlSeconds: 600, label: 'Acceso corporativo', clockToleranceSeconds: 30 },
    ...overrides,
  };
}

/**
 * Vacía el bucket de PRUEBAS antes de cada suite, igual que se recrea el esquema.
 *
 * Por qué hace falta: la base `*_test` se recrea en cada corrida, pero el bucket no, así que los objetos se
 * acumulaban **entre corridas** —más de mil—. El barrido de almacenamiento (`discover()`) los encola todos
 * como huérfanos y llena su lote, de modo que una prueba podía quedarse sin que su propia tarea se
 * reclamara. El fallo aparecía tarde, en una suite ajena, y empeoraba con cada validación.
 *
 * El nombre del bucket se comprueba aquí: esta función **no puede** tocar el de desarrollo.
 */
async function vaciarBucketDePruebas(config: AppConfig): Promise<void> {
  const bucket = config.objectStore.bucket;
  if (bucket !== 'terra-link-test') throw new Error(`Bucket de pruebas inesperado: «${bucket}». No se borra nada.`);
  if (!TEST_URL || !new URL(TEST_URL).pathname.endsWith('_test')) throw new Error('Sin base *_test no se vacía el bucket.');
  const store = new S3ObjectStore(config.objectStore);
  try {
    const objetos = await store.list('');
    for (const o of objetos) await store.delete(o.key);
  } catch {
    // Si el almacén no está disponible, lo dirá la prueba que lo use: aquí no se oculta nada ni se falla
    // por una limpieza.
  } finally {
    store.close();
  }
}

/**
 * `opciones.durable = true` conserva la configuración OPERATIVA de commit (`synchronous_commit` por defecto, durable ante una caída). Las pruebas funcionales usan commits
 * asíncronos solo en la base desechable `*_test`; cualquier comprobación de DURABILIDAD o RECUPERACIÓN debe pedir `durable: true` (PostgreSQL documenta que con commit
 * asíncrono una caída puede perder las últimas transacciones confirmadas).
 */
export async function setupHarness(overrides: Partial<AppConfig> = {}, opciones: { durable?: boolean } = {}) {
  if (!new URL(TEST_URL!).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL debe apuntar a una base *_test');
  // Base DESECHABLE (`*_test`, comprobada arriba): los commits no esperan al disco (`synchronous_commit = off`) SALVO que se pida `durable`. En la corrida fallida del 2026-10-22
  // (576aa53) se observaron `commit` de 1 a 6 s y migraciones de 16 s en vez de 11 s, con un `beforeAll` que superó el límite de 60 s: un TIMEOUT con latencia observada; no se
  // da por demostrada una causa física. Esto no cambia lo que se prueba (transacciones, restricciones y concurrencia son las mismas); solo quita la espera de durabilidad, que
  // en una base que se recrea en cada suite no importa. NO aplica a comprobaciones de durabilidad ni de recuperación (`durable: true`), ni a la base operativa.
  const urlPruebas = new URL(TEST_URL!);
  // La URL manda sobre las opciones del Pool: se CONSERVAN las de sesión del producto (client_min_messages=warning) y se añade la de commit.
  urlPruebas.searchParams.set('options', opciones.durable ? PG_SESSION_OPTIONS.options : `${PG_SESSION_OPTIONS.options} -c synchronous_commit=off`);
  const db: Kysely<Database> = createDb(
    urlPruebas.toString(),
    (sqlText, ms) => recordTiming({ phase: 'slow_query', ms, test: expect.getState().currentTestName ?? null, sql: sqlText }),
    1000,
    instrumentarConsulta,   // RNF-13: la misma instrumentación que la API, no una de pruebas
  );
  const t0 = Date.now();
  await sql`DROP SCHEMA IF EXISTS public CASCADE`.execute(db);
  await sql`CREATE SCHEMA public`.execute(db);
  await vaciarBucketDePruebas(testConfig(overrides));
  const t1 = Date.now();
  await migrateToLatest(db);
  const t2 = Date.now();
  const config = testConfig(overrides);
  const app: INestApplication = await createApp(config, db);
  await app.init();
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());

  async function login(email: string, password = PASSWORD) {
    const res = await http().post('/api/v1/auth/login').send({ email, password }).expect(200);
    tokens[email] = res.body.access_token;
    return res.body.access_token as string;
  }

  async function user(email: string, platformRole: 'SUPER_ADMIN' | null = null) {
    const row = await db
      .insertInto('users')
      .values({ email, first_name: 'Prueba', last_name: email, password_hash: await hashPassword(PASSWORD), status: 'ACTIVE', platform_role: platformRole })
      .returning('id')
      .executeTakeFirstOrThrow();
    await login(email);
    return row.id;
  }

  const as = (email: string) => ({ Authorization: `Bearer ${tokens[email]}` });
  const close = async () => {
    const c0 = Date.now();
    await app.close();
    const c1 = Date.now();
    await db.destroy();
    recordTiming({ phase: 'close', app_close_ms: c1 - c0, db_destroy_ms: Date.now() - c1 });
  };
  recordTiming({ phase: 'setup', schema_reset_ms: t1 - t0, migrate_ms: t2 - t1, app_init_ms: Date.now() - t2 });
  return { db, app, config, http, user, login, as, tokens, close };
}
