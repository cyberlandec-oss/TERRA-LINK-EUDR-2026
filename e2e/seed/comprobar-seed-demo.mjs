// Comprobación del seed DEMO (apps/api/src/db/seed-demo.ts) en una base DESECHABLE: idempotencia, membresías y
// conservación de contraseñas, y rotación de una sola cuenta (`--rotar=`).
//   node e2e/seed/comprobar-seed-demo.mjs
// Aislamiento: base `terra_link_seedcheck` (se crea y se borra), bucket `terra-link-seedcheck`, prefijo Redis propio y
// credenciales en una carpeta temporal (TL_CREDENTIALS_DIR). Nunca toca `terra_link`, el bucket de desarrollo ni el
// CREDENCIALES.csv de la raíz. No imprime contraseñas: compara huellas (hash argon2 y SHA-256 del CSV).
// Requiere: `npm run infra:up` (o el perfil app) y `npm run build -w apps/api` no es necesario: los scripts compilan.
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const DB = 'terra_link_seedcheck';
const envFile = Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const devUrl = new URL(envFile.DATABASE_URL);
const url = new URL(devUrl); url.pathname = `/${DB}`;
const credDir = mkdtempSync(join(tmpdir(), 'tl-seedcheck-'));
const out = join(root, 'validation-results', `${new Date().toISOString().replace(/[:.]/g, '-')}-seed-demo`);
mkdirSync(out, { recursive: true });
const log = [];
const note = (s) => { log.push(s); console.log(s); };

const psql = (db, q) => execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ${db} -tAc "${q.replace(/"/g, '\\"')}"`], { cwd: root, encoding: 'utf8' }).trim();
const env = { ...process.env, DATABASE_URL: url.toString(), S3_BUCKET: 'terra-link-seedcheck', REDIS_KEY_PREFIX: `tl-seedcheck:${Date.now()}:`, TL_CREDENTIALS_DIR: credDir };
const run = (script, extra = []) => execFileSync('npm', ['run', script, '-w', 'apps/api', '--', ...extra], { cwd: root, env, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
// Igual, pero juntando la salida de error: los avisos del seed (archivo bloqueado, por ejemplo) van por stderr.
const runConAvisos = (script, extra = []) => execSync(`npm run ${script} -w apps/api -- ${extra.join(' ')} 2>&1`, { cwd: root, env, encoding: 'utf8' });

function snapshot() {
  const q = (s) => psql(DB, s).split('\n').filter(Boolean);
  return {
    users: q(`SELECT email || '|' || md5(password_hash) || '|' || token_version FROM users ORDER BY email`),
    memberships: q(`SELECT u.email || '|' || o.name || '|' || m.status || '|' || coalesce(string_agg(ra.role_code, ',' ORDER BY ra.role_code), '') FROM memberships m JOIN users u ON u.id = m.user_id JOIN organizations o ON o.id = m.organization_id LEFT JOIN role_assignments ra ON ra.membership_id = m.id GROUP BY u.email, o.name, m.status ORDER BY 1`),
    counts: q(`SELECT 'organizations=' || count(*) FROM organizations UNION ALL SELECT 'producers=' || count(*) FROM producers UNION ALL SELECT 'plots=' || count(*) FROM plots UNION ALL SELECT 'deliveries=' || count(*) FROM deliveries UNION ALL SELECT 'lots=' || count(*) FROM lots UNION ALL SELECT 'domain_events=' || count(*) FROM domain_events`),
  };
}
const csvHash = () => { const f = join(credDir, 'CREDENCIALES.csv'); return existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null; };
const diff = (a, b) => ({ solo_antes: a.filter((x) => !b.includes(x)), solo_despues: b.filter((x) => !a.includes(x)) });

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); note(`${ok ? 'OK   ' : 'FALLA'} ${name}${detail ? `: ${detail}` : ''}`); };

try {
  if (DB === devUrl.pathname.slice(1)) throw new Error('La base de comprobación coincide con la de desarrollo: se aborta.');
  psql('postgres', `DROP DATABASE IF EXISTS ${DB}`);
  psql('postgres', `CREATE DATABASE ${DB}`);
  note(`Base ${DB} creada; credenciales en carpeta temporal (no la raíz).`);
  run('migrate');
  run('seed:demo');
  const s1 = snapshot(); const h1 = csvHash();
  check('primera ejecución crea cuentas y membresías', s1.users.length > 0 && s1.memberships.length > 0, `${s1.users.length} usuarios, ${s1.memberships.length} membresías`);

  run('seed:demo');
  const s2 = snapshot(); const h2 = csvHash();
  check('idempotencia: usuarios (hash de contraseña y token_version) sin cambios', JSON.stringify(s1.users) === JSON.stringify(s2.users), JSON.stringify(diff(s1.users, s2.users)));
  check('idempotencia: membresías y roles sin cambios', JSON.stringify(s1.memberships) === JSON.stringify(s2.memberships), JSON.stringify(diff(s1.memberships, s2.memberships)));
  check('idempotencia: conteos de datos DEMO sin cambios (sin duplicados)', JSON.stringify(s1.counts.filter((c) => !c.startsWith('domain_events'))) === JSON.stringify(s2.counts.filter((c) => !c.startsWith('domain_events'))), `${s1.counts.join(' ')} → ${s2.counts.join(' ')}`);
  check('conservación: CREDENCIALES.csv con las mismas contraseñas', h1 !== null && h1 === h2);

  const target = 'tecnico2.cooperativa';
  const outRot = run('seed:demo', [`--rotar=${target}`]);
  const s3 = snapshot();
  const changed = diff(s2.users, s3.users);
  check('rotación: cambia solo la cuenta indicada', changed.solo_despues.length === 1 && changed.solo_despues[0].startsWith(`${target}@`), `${changed.solo_despues.map((x) => x.split('|')[0]).join(',')}`);
  const tv = (s) => Number(s.users.find((x) => x.startsWith(`${target}@`)).split('|')[2]);
  check('rotación: invalida sesiones previas (token_version + 1)', tv(s3) === tv(s2) + 1);
  check('rotación: login nuevo verificado y anteriores rechazadas', /login nuevo=true; anteriores rechazadas=true/.test(outRot));
  check('rotación: declara qué archivo queda vigente', /guardada en CREDENCIALES[^;]*\(vigente\)/.test(outRot), outRot.split('\n').find((l) => l.startsWith('Rotación')) ?? '');
  check('rotación: membresías intactas', JSON.stringify(s2.memberships) === JSON.stringify(s3.memberships));
  check('rotación: no repuebla (conteos de datos DEMO intactos)', JSON.stringify(s2.counts.filter((c) => !c.startsWith('domain_events'))) === JSON.stringify(s3.counts.filter((c) => !c.startsWith('domain_events'))), `${s2.counts.join(' ')} → ${s3.counts.join(' ')}`);

  run('seed:demo');
  const s4 = snapshot();
  check('tras la rotación, el seed conserva la contraseña rotada', JSON.stringify(s3.users) === JSON.stringify(s4.users));

  // Archivo principal bloqueado: antes abortaba la rotación entera. Ahora escribe en el pendiente, avisa de que
  // el bloqueado conserva una credencial muerta y declara cuál queda vigente.
  const principal = join(credDir, 'CREDENCIALES.csv');
  const pendiente = join(credDir, 'CREDENCIALES.pendiente.csv');
  copyFileSync(principal, pendiente);
  chmodSync(principal, 0o444); // solo lectura: `openSync(f, 'r+')` falla igual que con el archivo abierto en Excel
  let outBloq = '';
  try {
    outBloq = runConAvisos('seed:demo', ['--rotar=tecnico1.cooperativa']);
  } finally {
    chmodSync(principal, 0o644);
  }
  const s5 = snapshot();
  const tv1 = (s) => Number(s.users.find((x) => x.startsWith('tecnico1.cooperativa@')).split('|')[2]);
  check('bloqueado: la rotación se completa en vez de abortar', /login nuevo=true; anteriores rechazadas=true/.test(outBloq), outBloq.split('\n').slice(-3).join(' | '));
  check('bloqueado: el archivo vigente es el pendiente', /guardada en CREDENCIALES\.pendiente\.csv \(vigente\)/.test(outBloq));
  check('bloqueado: avisa de que el principal conserva una credencial muerta', /YA NO SIRVE/.test(outBloq));
  check('bloqueado: la sesión también se invalida', tv1(s5) === tv1(s4) + 1);
} catch (e) {
  check('ejecución sin errores', false, String(e.stderr ?? e.message).split('\n').filter((l) => !/contrasena|password/i.test(l)).slice(-8).join(' | '));
} finally {
  try { psql('postgres', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); note(`Base ${DB} eliminada.`); } catch { note(`No se pudo eliminar ${DB}.`); }
  rmSync(credDir, { recursive: true, force: true });
  const ok = checks.length > 0 && checks.every((c) => c.ok);
  writeFileSync(join(out, 'resultado.json'), `${JSON.stringify({ ok, base: DB, checks, log }, null, 2)}\n`);
  note(`Resultado: ${ok ? 'APROBADO' : 'FALLIDO'} → ${out}`);
  process.exitCode = ok ? 0 : 1;
}
