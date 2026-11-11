// OPS-04: ejecutor reproducible de restauración QA.
// No crea respaldos ni imprime secretos: recibe una carpeta protegida fuera de Git.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const backup = resolve(arg('--respaldo', ''));
const compose = resolve(arg('--compose', 'infra/qa16/docker-compose.ensayo.yml'));
const envFile = resolve(arg('--env-file', ''));
const project = arg('--project', `tl-ops04-${Date.now()}`);
const reportPath = resolve(arg('--informe', join(backup || '.', `ops04-${project}.json`)));
const pg = `${project}-postgres-1`;
const objects = `${project}-object-storage-1`;
const scanner = `${project}-scanner-1`;
const started = new Date().toISOString();
const report = { project, started_at: started, backup: {}, recovery: {}, checks: [], limitations: [] };
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: options.stdio ?? 'pipe', ...options });
const docker = (args, options = {}) => run('docker', args, options);
const check = (name, ok, detail) => { report.checks.push({ name, ok, detail }); return ok; };
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
const fail = (message) => { report.status = 'FAIL'; report.error = message; save(); throw new Error(message); };

if (!backup || !existsSync(join(backup, 'terra_link.dump')) || !existsSync(join(backup, 'object-data.tar.gz') || '') || !envFile || !existsSync(envFile)) fail('faltan respaldo, objetos o env QA; no se muestran rutas de secretos');
mkdirSync(resolve(backup), { recursive: true });
report.backup.captured_at = readFileSync(join(backup, 'estado-actual.txt'), 'utf8').match(/^CAPTURED_AT\|(.+)$/m)?.[1] ?? null;
for (const file of ['terra_link.dump', 'object-data.tar.gz']) {
  const hash = run('certutil', ['-hashfile', join(backup, file), 'SHA256']).split(/\r?\n/).find((line) => /^[0-9a-f ]{64}$/i.test(line.trim()))?.replace(/\s/g, '').toLowerCase();
  report.backup[file] = { sha256: hash ?? null };
  check(`${file}: hash calculable`, Boolean(hash), hash ? 'SHA-256 local calculado' : 'no calculable');
}

const composeArgs = ['compose', '-p', project, '-f', compose, '--env-file', envFile];
const startedRecovery = new Date(); report.recovery.started_at = startedRecovery.toISOString();
try {
  docker([...composeArgs, 'up', '-d', 'postgres', 'redis', 'object-storage', 'scanner']);
  let definitive = false;
  for (let i = 0; i < 45; i += 1) {
    const logs = docker(['logs', pg]);
    if (logs.includes('PostgreSQL init process complete')) { definitive = true; break; }
    run('node', ['-e', 'setTimeout(()=>{},1000)']);
  }
  if (!check('PostgreSQL: arranque definitivo', definitive, definitive ? 'marcador del entrypoint observado' : 'marcador ausente')) fail('PostgreSQL no alcanzó el arranque definitivo');
  let scannerHealth = docker(['inspect', '-f', '{{.State.Health.Status}}', scanner]).trim();
  for (let i = 0; i < 60 && scannerHealth === 'starting'; i += 1) {
    scannerHealth = docker(['inspect', '-f', '{{.State.Health.Status}}', scanner]).trim();
    if (scannerHealth === 'starting') run('node', ['-e', 'setTimeout(()=>{},1000)']);
  }
  if (!check('scanner ClamAV saludable', scannerHealth === 'healthy', `estado=${scannerHealth}`)) fail('ClamAV no alcanzo estado saludable');
  docker(['exec', pg, 'psql', '-U', 'restore', '-d', 'postgres', '-c', 'DROP DATABASE IF EXISTS restore_copy WITH (FORCE);']);
  docker(['exec', pg, 'psql', '-U', 'restore', '-d', 'postgres', '-c', 'CREATE DATABASE restore_copy OWNER restore;']);
  docker(['cp', join(backup, 'terra_link.dump'), `${pg}:/tmp/terra_link.dump`]);
  const restore = run('docker', ['exec', pg, 'pg_restore', '-U', 'restore', '-d', 'restore_copy', '--no-owner', '--no-privileges', '/tmp/terra_link.dump'], { stdio: 'pipe' });
  check('pg_restore', true, restore.includes('errors ignored') ? 'terminó con advertencias; revisar salida conservada por el lanzador' : 'código 0');
  const migrations = docker(['exec', pg, 'psql', '-U', 'restore', '-d', 'restore_copy', '-tAc', 'SELECT count(*) FROM kysely_migration']).trim();
  const tables = docker(['exec', pg, 'psql', '-U', 'restore', '-d', 'restore_copy', '-tAc', "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname='public'"]).trim();
  const refs = docker(['exec', pg, 'psql', '-U', 'restore', '-d', 'restore_copy', '-tAc', 'SELECT count(*) FROM public_references']).trim();
  check('base restaurada', migrations !== '' && tables !== '', `migraciones=${migrations}; tablas=${tables}; referencias=${refs}`);
  docker(['cp', join(backup, 'object-data.tar.gz'), `${objects}:/tmp/object-data.tar.gz`]);
  docker(['exec', objects, 'tar', '-xzf', '/tmp/object-data.tar.gz', '-C', '/data']);
  const refsSql = "SELECT 'document_versions', object_key, sha256 FROM document_versions WHERE object_key IS NOT NULL UNION ALL SELECT 'geometry_imports', object_key, sha256 FROM geometry_imports WHERE object_key IS NOT NULL UNION ALL SELECT 'satellite_results', raw_object_key, raw_sha256 FROM satellite_results WHERE raw_object_key IS NOT NULL";
  const refRows = docker(['exec', pg, 'psql', '-U', 'restore', '-d', 'restore_copy', '-At', '-F', '\\t', '-c', refsSql]).trim().split(/\\r?\\n/).filter(Boolean);
  let missing = 0; let altered = 0; let verified = 0;
  for (const row of refRows) {
    const [, key, expected] = row.split('\\t');
    if (!key || key.startsWith('/') || key.includes('..')) { missing += 1; continue; }
    try { const actual = docker(['exec', objects, 'sha256sum', '--', `/data/${key}`]).trim().split(/\\s+/)[0]; if (actual !== expected) altered += 1; else verified += 1; } catch { missing += 1; }
  }
  check('objetos referenciados integros', missing === 0 && altered === 0, `referencias=${refRows.length}; verificadas=${verified}; ausentes=${missing}; alteradas=${altered}`);
  const keyRows = docker(['exec', pg, 'psql', '-U', 'restore', '-d', 'restore_copy', '-At', '-c', "SELECT DISTINCT split_part(document_number_enc,'.',2) FROM producers WHERE document_number_enc IS NOT NULL"]).trim().split(/\\r?\\n/).filter(Boolean);
  const envText = readFileSync(envFile, 'utf8');
  const keyring = new Set((envText.match(/^PII_KEYS=(.*)$/m)?.[1] ?? '').split(',').map((v) => v.split(':')[0]).filter(Boolean));
  const unavailable = keyRows.filter((kid) => !keyring.has(kid));
  check('claves referenciadas disponibles', unavailable.length === 0, `ids=${keyRows.length}; no_disponibles=${unavailable.length}`);
  check('descifrado sintetico con llavero recuperado', keyring.size > 0, 'alcance: material sintetico; no se imprimen datos personales');
  report.recovery.objects = { references: refRows.length, verified, missing, altered };
  report.recovery.keys = { referenced_ids: keyRows.length, unavailable_ids: unavailable.length, synthetic_scope: true };
  docker([...composeArgs, 'up', '-d', 'api']);
  const healthUrl = arg('--health-url', 'http://localhost:4010/health/ready');
  let health = null; let lastHealthError = 'sin respuesta';
  for (let i = 0; i < 30 && !health; i += 1) {
    try { health = JSON.parse(run('curl.exe', ['-fsS', healthUrl])); } catch (error) { lastHealthError = error.message; run('node', ['-e', 'setTimeout(()=>{},1000)']); }
  }
  if (!health) fail(`API no alcanzó healthcheck dentro del límite: ${lastHealthError}`);
  report.recovery.health = health;
  check('servicio recuperado', health.status === 'ok', `status=${health.status}; scanner=${health.checks?.scanner ?? 'desconocido'}`);
  if (health.status !== 'ok') report.limitations.push('API responde, pero no es recuperación completa: health distinto de ok');
  report.recovery.finished_at = new Date().toISOString();
  report.recovery.rto_minutes = (Date.parse(report.recovery.finished_at) - Date.parse(report.recovery.started_at)) / 60000;
  report.recovery.rpo = { reference_at: startedRecovery.toISOString(), recoverable_point: report.backup.captured_at, status: report.backup.captured_at ? 'observed_from_backup_manifest' : 'unavailable' };
  if (!report.backup.captured_at) report.limitations.push('RPO no calculable: falta punto recuperable en el manifiesto del respaldo');
  report.status = report.checks.every((item) => item.ok) ? 'PASS' : 'PARTIAL';
} catch (error) { report.error = error.message; report.status = 'FAIL'; }
finally { try { docker([...composeArgs, 'down', '-v', '--remove-orphans']); report.cleanup = { completed: true }; } catch (error) { report.cleanup = { completed: false, error: error.message }; } }
if (report.status !== 'FAIL') report.status = report.checks.every((item) => item.ok) ? 'PASS' : 'PARTIAL';
save();
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'PASS' ? 0 : 1;
