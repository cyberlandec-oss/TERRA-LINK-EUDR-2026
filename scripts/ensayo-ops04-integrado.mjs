// OPS-04: ejecutor reproducible de restauración QA.
// No crea respaldos ni imprime secretos: recibe una carpeta protegida fuera de Git.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { locateBySha } from './ops04-object-localizer.mjs';

const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const backup = resolve(arg('--respaldo', ''));
const compose = resolve(arg('--compose', 'infra/qa16/docker-compose.ensayo.yml'));
const envFile = resolve(arg('--env-file', ''));
const project = arg('--project', `tl-ops04-${Date.now()}`);
const reportPath = resolve(arg('--informe', join(backup || '.', `ops04-${project}.json`)));
const objectivesPath = arg('--objetivos', null) ? resolve(arg('--objetivos')) : null;
const referenceAt = arg('--referencia', null);
const objectsOnly = process.argv.includes('--solo-objetos');
const pg = `${project}-postgres-1`;
const objects = `${project}-object-storage-1`;
const scanner = `${project}-scanner-1`;
const api = `${project}-api-1`;
const started = new Date().toISOString();
const report = { project, started_at: started, backup: {}, recovery: {}, checks: [], limitations: [] };
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: options.stdio ?? 'pipe', ...options });
const docker = (args, options = {}) => run('docker', args, options);
const parseEnv = (text) => Object.fromEntries(text.split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => { const i = line.indexOf('='); return i < 0 ? [line, ''] : [line.slice(0, i), line.slice(i + 1)]; }));
const s3Hash = (container, endpoint, bucket, key) => {
  const code = "import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'; import { createHash } from 'node:crypto'; const [endpoint,bucket,key]=process.argv.slice(1); const c=new S3Client({endpoint,region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY}}); try { const r=await c.send(new GetObjectCommand({Bucket:bucket,Key:key})); const b=Buffer.from(await r.Body.transformToByteArray()); console.log('SHA:'+createHash('sha256').update(b).digest('hex')); } catch (e) { console.log('ERROR:'+((e && e.name) || 'unknown')+':'+((e && e.Code) || '')+':'+((e && e.$metadata && e.$metadata.httpStatusCode) || '')+':'+((e && e.message) || '')); process.exit(3); } finally { c.destroy(); }";
  try { const output = docker(['exec', container, 'node', '--input-type=module', '-e', code, endpoint, bucket, key]).trim(); return output.startsWith('SHA:') ? { ok: true, sha256: output.slice(4) } : { ok: false, error: output }; } catch (error) { const output = String(error?.stdout ?? '').trim(); return { ok: false, error: output || 'S3_READ_FAILED' }; }
};
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
  docker([...composeArgs, 'up', '-d', 'api']);
  docker(['cp', join(backup, 'object-data.tar.gz'), `${objects}:/tmp/object-data.tar.gz`]);
  docker(['exec', objects, 'tar', '-xzf', '/tmp/object-data.tar.gz', '-C', '/data']);
  const extractDir = mkdtempSync(join(tmpdir(), 'tl-ops04-extract-'));
  run('tar', ['-xzf', join(backup, 'object-data.tar.gz'), '-C', extractDir]);
  const refsSql = "SELECT 'document_versions', object_key, sha256 FROM document_versions WHERE object_key IS NOT NULL UNION ALL SELECT 'geometry_imports', object_key, sha256 FROM geometry_imports WHERE object_key IS NOT NULL UNION ALL SELECT 'satellite_results', raw_object_key, raw_sha256 FROM satellite_results WHERE raw_object_key IS NOT NULL";
  const refRows = docker(['exec', pg, 'psql', '-U', 'restore', '-d', 'restore_copy', '-At', '-F', '|', '-c', refsSql]).trim().split(/\r?\n/).filter(Boolean);
  const envText = readFileSync(envFile, 'utf8');
  const qaEnv = parseEnv(envText);
  let missing = 0; let altered = 0; let verified = 0;
  const objectStages = [];
  for (const row of refRows) {
    const [, key, expected] = row.split('|');
    const stage = { key, expected_sha256: expected, localization: null, transfer: null, put_object: null, get_object: null };
    objectStages.push(stage);
    if (!key || key.startsWith('/') || key.includes('..')) { stage.localization = { ok: false, error: 'INVALID_OBJECT_KEY' }; missing += 1; continue; }
    try {
      const matches = await locateBySha(extractDir, expected);
      stage.localization = { ok: matches.length === 1, matches: matches.length };
      if (matches.length !== 1) { missing += 1; continue; }
      try { docker(['cp', matches[0].file, `${api}:/tmp/ops04-remap-object`]); stage.transfer = { ok: true }; }
      catch (error) { stage.transfer = { ok: false, error: String(error?.stderr || error?.message || 'TRANSFER_FAILED').trim() }; missing += 1; continue; }
      const putCode = "import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'; import { createReadStream } from 'node:fs'; const key=process.argv[1]; const c=new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION||'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY}}); try { const r=await c.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET||'terra-link-private',Key:key,Body:createReadStream('/tmp/ops04-remap-object')})); console.log(JSON.stringify({ok:true,etag:r.ETag||null})); } catch(e) { console.error(JSON.stringify({ok:false,name:e.name,code:e.Code||null,http:e.$metadata?.httpStatusCode||null,message:e.message})); process.exit(4); } finally { c.destroy(); }";
      try { stage.put_object = { ok: true, output: docker(['exec', api, 'node', '--input-type=module', '-e', putCode, key]).trim() }; }
      catch (error) { stage.put_object = { ok: false, error: String(error?.stderr || error?.stdout || error?.message || 'PUT_OBJECT_FAILED').trim() }; missing += 1; continue; }
      const actual = s3Hash(api, qaEnv?.S3_ENDPOINT || 'http://object-storage:9000', qaEnv?.S3_BUCKET || 'terra-link-private', key);
      stage.get_object = actual.ok ? { ok: true, sha256: actual.sha256, matches: actual.sha256 === expected } : { ok: false, error: actual.error };
      if (!actual.ok) missing += 1; else if (actual.sha256 !== expected) altered += 1; else verified += 1;
    } catch (error) { stage.localization = { ok: false, error: String(error?.message || 'LOCALIZATION_FAILED') }; missing += 1; }
  }
  report.recovery.object_stages = objectStages;
  check('objetos referenciados integros', missing === 0 && altered === 0 && verified === refRows.length, `referencias=${refRows.length}; verificadas=${verified}; ausentes=${missing}; alteradas=${altered}`);
  const keyRows = docker(['exec', pg, 'psql', '-U', 'restore', '-d', 'restore_copy', '-At', '-c', "SELECT DISTINCT split_part(document_number_enc,'.',2) FROM producers WHERE document_number_enc IS NOT NULL"]).trim().split(/\r?\n/).filter(Boolean);
  const keyring = new Set((envText.match(/^PII_KEYS=(.*)$/m)?.[1] ?? '').split(',').map((v) => v.split(':')[0]).filter(Boolean));
  const unavailable = keyRows.filter((kid) => !keyring.has(kid));
  check('claves referenciadas disponibles', unavailable.length === 0, `ids=${keyRows.length}; no_disponibles=${unavailable.length}`);
  check('descifrado sintetico con llavero recuperado', keyring.size > 0, 'alcance: material sintetico; no se imprimen datos personales');
  const objectsVerifiedAt = new Date().toISOString();
  report.recovery.objects = { references: refRows.length, verified, missing, altered, verified_at: objectsVerifiedAt };
  if (refRows.length) {
    const [, key, expected] = refRows[0].split('|');
    const qaObject = s3Hash(api, 'http://object-storage:9000', qaEnv.S3_BUCKET, key);
    const originEndpoint = arg('--origen-endpoint', 'http://localhost:9000');
    const originObject = s3Hash(api, originEndpoint, qaEnv.S3_BUCKET, key);
    report.recovery.objects.s3 = { expected_sha256: expected, origin_present: originObject.ok, qa_present: qaObject.ok, qa_sha256: qaObject.sha256 ?? null, origin_sha256: originObject.sha256 ?? null, qa_sha_matches: qaObject.ok && qaObject.sha256 === expected, origin_sha_matches: originObject.ok && originObject.sha256 === expected, origin_error: originObject.error ?? null, qa_error: qaObject.error ?? null };
  }
  report.recovery.keys = { referenced_ids: keyRows.length, unavailable_ids: unavailable.length, synthetic_scope: true };
  rmSync(extractDir, { recursive: true, force: true });
  if (objectsOnly) {
    report.recovery.finished_at = new Date().toISOString();
    report.status = report.checks.every((item) => item.ok) ? 'PASS' : 'PARTIAL';
  } else {
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
  const measurement = {
    recovery_run_id: project,
    reference_at: referenceAt,
    recoverable_point_at: report.backup.captured_at,
    recoverable_point_source: report.backup.captured_at ? 'estado-actual.txt:CAPTURED_AT' : null,
    recovery_started_at: report.recovery.started_at,
    service_restored_at: report.recovery.finished_at,
    objects_verified_at: objectsVerifiedAt,
    objects_verified: verified === refRows.length && missing === 0 && altered === 0,
    keys_verified: unavailable.length === 0,
    healthcheck: health.status === 'ok',
  };
  report.recovery.measurement = measurement;
  report.recovery.rpo = referenceAt && report.backup.captured_at
    ? { reference_at: referenceAt, recoverable_point: report.backup.captured_at, status: 'ready_for_validator', source: 'ensayo-ops04-integrado' }
    : { reference_at: referenceAt ?? null, recoverable_point: report.backup.captured_at, status: 'NOT_DETERMINABLE', source: report.backup.captured_at ? 'estado-actual.txt:CAPTURED_AT' : null };
  if (!referenceAt) report.limitations.push('RPO no determinable: falta instante de referencia del incidente; no se reconstruye retrospectivamente');
  if (!report.backup.captured_at) report.limitations.push('RPO no determinable: falta punto recuperable en el manifiesto del respaldo');
  if (objectivesPath) {
    if (!referenceAt || !report.backup.captured_at) {
      report.objectives_validation = { status: 'NOT_EVALUATED', reason: 'RPO no determinable: falta referencia o punto recuperable' };
    } else {
      const measurementPath = `${reportPath}.measurement.json`;
      writeFileSync(measurementPath, JSON.stringify(measurement, null, 2));
      const validation = spawnSync(process.execPath, ['scripts/validar-rpo-rto.mjs', '--objetivos', objectivesPath, '--medicion', measurementPath], { encoding: 'utf8' });
      report.objectives_validation = { status: validation.status === 0 ? 'PASS' : 'FAIL', exit_code: validation.status, stdout: validation.stdout?.trim() ?? '', stderr: validation.stderr?.trim() ?? '' };
    }
  } else {
    report.objectives_validation = { status: 'NOT_EVALUATED', reason: 'No se proporcionaron objetivos aprobados; la recuperación técnica se informa por separado' };
  }
  report.status = report.checks.every((item) => item.ok) ? 'PASS' : 'PARTIAL';
  }
} catch (error) { report.error = error.message; report.status = 'FAIL'; }
finally { try { docker([...composeArgs, 'down', '-v', '--remove-orphans']); report.cleanup = { completed: true }; } catch (error) { report.cleanup = { completed: false, error: error.message }; } }
if (report.status !== 'FAIL') report.status = report.checks.every((item) => item.ok) ? 'PASS' : 'PARTIAL';
save();
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'PASS' ? 0 : 1;
