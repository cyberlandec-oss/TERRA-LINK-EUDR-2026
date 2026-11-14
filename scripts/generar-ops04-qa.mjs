// Genera un respaldo OPS-04 desde recursos QA explícitos.
// Nunca lee .env por defecto ni copia credenciales al repositorio.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const required = (name) => { const value = arg(name); if (!value) throw new Error(`falta ${name}`); return value; };
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
const project = required('--project');
const postgres = required('--postgres');
const database = required('--database');
const bucket = required('--bucket');
const output = resolve(required('--output'));
const suppliedEnv = arg('--qa-env');
const auto = process.argv.includes('--auto');
const writesPaused = process.argv.includes('--writes-paused');
const synthetic = process.argv.includes('--synthetic');
const envFile = suppliedEnv ? resolve(suppliedEnv) : (auto ? join(mkdtempSync(join(tmpdir(), 'tl-ops04-qa-')), 'qa.env') : null);

if (!/^tl-ops04-qa-[a-z0-9-]+$/.test(project)) throw new Error('project debe ser tl-ops04-qa-*');
if (!/(^|_)(qa|test)($|_)/i.test(database)) throw new Error('database debe ser QA/test');
if (!/(^|[-_])(qa|test)($|[-_])/i.test(bucket)) throw new Error('bucket debe ser QA/test');
if (/terra-link-(private|e2e)$/i.test(bucket)) throw new Error('bucket operativo/prohibido');
if (!envFile) throw new Error('falta --qa-env o --auto');
if (envFile === resolve('.env') || /[\\/]\.env$/.test(envFile)) throw new Error('no se permite .env operativo');

if (auto) {
  const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
  const qaEnv = [
    'ENSAYO_PG_USER=qa_restore',
    `ENSAYO_PG_PASSWORD=${token()}`,
    `ENSAYO_PG_DB=${database}`,
    `S3_ACCESS_KEY=qa_${token(12)}`,
    `S3_SECRET_KEY=${token(32)}`,
    `JWT_SECRET=${token(48)}`,
    `PII_KEYS=qa-ops04:${token(32)}`,
    'PII_ACTIVE_KEY_ID=qa-ops04',
    `PII_INDEX_KEY=${token(32)}`,
    'NODE_ENV=development',
    'S3_ENDPOINT=http://object-storage:9000',
    `S3_BUCKET=${bucket}`,
    'WEB_ORIGIN=https://localhost:3010',
  ].join('\n') + '\n';
  mkdirSync(resolve(envFile, '..'), { recursive: true });
  writeFileSync(envFile, qaEnv, { mode: 0o600 });
  try { chmodSync(envFile, 0o600); } catch { /* ACL Windows se aplica fuera del script */ }
}

mkdirSync(output, { recursive: true });
const dump = join(output, 'terra_link.dump');
const objects = join(output, 'object-data.tar.gz');
if (!writesPaused) throw new Error('falta --writes-paused: la captura exige una ventana de escrituras detenidas y verificable');

const writeCounters = () => run('docker', ['exec', postgres, 'psql', '-U', 'terra_link', '-d', database, '-At', '-c', "SELECT coalesce(sum(n_tup_ins+n_tup_upd+n_tup_del),0) FROM pg_stat_user_tables"]).trim();
const captureStartedAt = new Date().toISOString();
const writesBefore = writeCounters();

// El llamador debe haber detenido las escrituras del conjunto QA antes de invocar este script.
run('docker', ['exec', postgres, 'pg_dump', '-U', 'terra_link', '-d', database, '-Fc', '-f', '/tmp/ops04-qa.dump']);
run('docker', ['cp', `${postgres}:/tmp/ops04-qa.dump`, dump]);
run('docker', ['exec', postgres, 'rm', '-f', '/tmp/ops04-qa.dump']);

const volume = required('--object-volume');
if (!/^tl-ops04-qa-[a-z0-9-]+$/.test(volume)) throw new Error('object-volume debe ser un volumen QA exclusivo tl-ops04-qa-*');
run('docker', ['run', '--rm', '-v', `${volume}:/data:ro`, '-v', `${output}:/out`, 'alpine:3.20', 'sh', '-c', 'tar czf /out/object-data.tar.gz -C /data .']);

const writesAfter = writeCounters();
if (writesAfter !== writesBefore) throw new Error(`la ventana de captura no fue estable: xact_commit antes=${writesBefore} despues=${writesAfter}`);
const capturedAt = new Date().toISOString();

if (synthetic) {
  const keyId = 'qa-ops04';
  const keyText = readFileSync(envFile, 'utf8').match(/^PII_KEYS=([^\n]+)$/m)?.[1]?.split(',').find((part) => part.startsWith(`${keyId}:`))?.slice(keyId.length + 1);
  if (!keyText) throw new Error('PII_KEYS no contiene la clave sintética QA');
  const key = Buffer.from(keyText, 'base64');
  const iv = randomBytes(12); const aad = 'ops04|synthetic|document_number';
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update('QA-SYNTHETIC-RECOVERY-DATA', 'utf8'), cipher.final()]);
  writeFileSync(join(output, 'synthetic-encrypted.json'), JSON.stringify({ scope: 'synthetic-only', key_id: keyId, aad, token: ['v1', keyId, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.') }) + '\n');
  const syntheticObject = Buffer.from('OPS04 synthetic object 2026-11-14\n', 'utf8');
  writeFileSync(join(output, 'synthetic-object.json'), JSON.stringify({ scope: 'synthetic-only', key: 'synthetic/object.txt', sha256: createHash('sha256').update(syntheticObject).digest('hex') }) + '\n');
}

const manifest = [
  `CAPTURE_STARTED_AT|${captureStartedAt}`,
  `CAPTURED_AT|${capturedAt}`,
  `SOURCE_DATABASE|${database}`,
  `SOURCE_BUCKET|${bucket}`,
  'SOURCE_SCOPE|QA_SYNTHETIC_ONLY',
  `WRITES_PAUSED|${writesAfter === writesBefore}`,
  `WRITES_BEFORE|${writesBefore}`,
  `WRITES_AFTER|${writesAfter}`,
  'RECOVERABLE_POINT|database_and_objects_at_same_capture_boundary',
].join('\n') + '\n';
writeFileSync(join(output, 'estado-actual.txt'), manifest, 'utf8');
const hashes = `${run('certutil', ['-hashfile', dump, 'SHA256'])}\n${run('certutil', ['-hashfile', objects, 'SHA256'])}`;
writeFileSync(join(output, 'SHA256SUMS.txt'), hashes, 'utf8');

// Solo copia el archivo QA solicitado; el contenido nunca se imprime ni se versiona.
const qaEnv = readFileSync(envFile);
writeFileSync(join(output, 'claves.env'), qaEnv, { mode: 0o600 });
try { chmodSync(join(output, 'claves.env'), 0o600); } catch { /* ACL Windows se aplica fuera del script */ }
writeFileSync(join(output, 'MANIFEST.json'), JSON.stringify({ project, database, bucket, captured_at: capturedAt, capture_started_at: captureStartedAt, scope: 'QA_SYNTHETIC_ONLY', writes_paused: writesAfter === writesBefore, writes_before: writesBefore, writes_after: writesAfter, synthetic_encrypted_data: synthetic }, null, 2));
console.log(JSON.stringify({ status: 'PASS', output: 'redacted', database, bucket, captured_at: capturedAt, files: ['terra_link.dump', 'object-data.tar.gz', 'synthetic-object.json', 'synthetic-encrypted.json', 'estado-actual.txt', 'SHA256SUMS.txt', 'MANIFEST.json'] }));
