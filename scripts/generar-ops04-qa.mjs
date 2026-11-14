// Genera un respaldo OPS-04 desde recursos QA explícitos.
// Nunca lee .env por defecto ni copia credenciales al repositorio.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const required = (name) => { const value = arg(name); if (!value) throw new Error(`falta ${name}`); return value; };
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
const project = required('--project');
const postgres = required('--postgres');
const database = required('--database');
const bucket = required('--bucket');
const output = resolve(required('--output'));
const envFile = resolve(required('--qa-env'));

if (!/^tl-ops04-qa-[a-z0-9-]+$/.test(project)) throw new Error('project debe ser tl-ops04-qa-*');
if (!/(^|_)(qa|test)($|_)/i.test(database)) throw new Error('database debe ser QA/test');
if (!/(^|[-_])(qa|test)($|[-_])/i.test(bucket)) throw new Error('bucket debe ser QA/test');
if (/terra-link-(private|e2e)$/i.test(bucket)) throw new Error('bucket operativo/prohibido');
if (envFile === resolve('.env') || /[\\/]\.env$/.test(envFile)) throw new Error('no se permite .env operativo');

mkdirSync(output, { recursive: true });
const dump = join(output, 'terra_link.dump');
const objects = join(output, 'object-data.tar.gz');
const capturedAt = new Date().toISOString();

// El llamador debe haber detenido las escrituras del conjunto QA antes de invocar este script.
run('docker', ['exec', postgres, 'pg_dump', '-U', 'terra_link', '-d', database, '-Fc', '-f', '/tmp/ops04-qa.dump']);
run('docker', ['cp', `${postgres}:/tmp/ops04-qa.dump`, dump]);
run('docker', ['exec', postgres, 'rm', '-f', '/tmp/ops04-qa.dump']);

const volume = required('--object-volume');
run('docker', ['run', '--rm', '-v', `${volume}:/data:ro`, '-v', `${output}:/out`, 'alpine:3.20', 'sh', '-c', 'tar czf /out/object-data.tar.gz -C /data .']);

const manifest = [
  `CAPTURED_AT|${capturedAt}`,
  `SOURCE_DATABASE|${database}`,
  `SOURCE_BUCKET|${bucket}`,
  'SOURCE_SCOPE|QA_SYNTHETIC_ONLY',
  'WRITES_PAUSED|REQUIRED_BEFORE_CAPTURE',
  'RECOVERABLE_POINT|database_and_objects_at_same_capture_boundary',
].join('\n') + '\n';
writeFileSync(join(output, 'estado-actual.txt'), manifest, 'utf8');
const hashes = `${run('certutil', ['-hashfile', dump, 'SHA256'])}\n${run('certutil', ['-hashfile', objects, 'SHA256'])}`;
writeFileSync(join(output, 'SHA256SUMS.txt'), hashes, 'utf8');

// Solo copia el archivo QA solicitado; el contenido nunca se imprime ni se versiona.
const qaEnv = readFileSync(envFile);
writeFileSync(join(output, 'claves.env'), qaEnv, { mode: 0o600 });
try { chmodSync(join(output, 'claves.env'), 0o600); } catch { /* ACL Windows se aplica fuera del script */ }
writeFileSync(join(output, 'MANIFEST.json'), JSON.stringify({ project, database, bucket, captured_at: capturedAt, scope: 'QA_SYNTHETIC_ONLY', writes_paused: true }, null, 2));
console.log(JSON.stringify({ status: 'PASS', output: 'redacted', database, bucket, captured_at: capturedAt, files: ['terra_link.dump', 'object-data.tar.gz', 'estado-actual.txt', 'SHA256SUMS.txt', 'MANIFEST.json'] }));
