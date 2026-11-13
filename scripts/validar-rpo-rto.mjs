import { readFileSync } from 'node:fs';
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const fail = (message) => { console.error(`RPO_RTO_INVALID: ${message}`); process.exitCode = 1; };
const readJson = (path, label) => { if (!path) throw new Error(`falta --${label}`); try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { throw new Error(`${label} ilegible: ${error.message}`); } };
const date = (value, label) => { const parsed = new Date(value); if (!value || !Number.isFinite(parsed.getTime())) throw new Error(`${label} inválido o ausente`); return parsed; };
try {
  const objectives = readJson(arg('--objetivos'), 'objetivos'); const measurement = readJson(arg('--medicion'), 'medicion');
  const rpo = Number(objectives.rpo_minutes); const rto = Number(objectives.rto_minutes); const approval = objectives.approval ?? {}; const actor = typeof approval.actor_id === 'string' ? approval.actor_id.trim() : '';
  if (!Number.isFinite(rpo) || rpo < 0) throw new Error('rpo_minutes inválido');
  if (!Number.isFinite(rto) || rto < 0) throw new Error('rto_minutes inválido');
  if (approval.status !== 'APPROVED' || !actor || !approval.approved_at) throw new Error('falta aprobación formal: un nombre no acredita aceptación');
  const runId = typeof measurement.recovery_run_id === 'string' ? measurement.recovery_run_id.trim() : '';
  const recoverableSource = typeof measurement.recoverable_point_source === 'string' ? measurement.recoverable_point_source.trim() : '';
  if (!runId) throw new Error('falta recovery_run_id: la medición no está vinculada a un ensayo identificable');
  if (!recoverableSource) throw new Error('falta recoverable_point_source: el RPO requiere procedencia del punto recuperable');
  const approvedAt = date(approval.approved_at, 'approved_at');
  const reference = date(measurement.reference_at, 'reference_at'); const recoverable = date(measurement.recoverable_point_at, 'recoverable_point_at'); const recoveryStarted = date(measurement.recovery_started_at, 'recovery_started_at'); const serviceRestored = date(measurement.service_restored_at, 'service_restored_at'); const objectsVerified = date(measurement.objects_verified_at, 'objects_verified_at');
  if (recoverable > reference) throw new Error('recoverable_point_at posterior a reference_at');
  if (serviceRestored < recoveryStarted) throw new Error('service_restored_at anterior a recovery_started_at');
  if (objectsVerified < serviceRestored) throw new Error('objects_verified_at anterior a service_restored_at');
  if (measurement.objects_verified !== true || measurement.keys_verified !== true || measurement.healthcheck !== true) throw new Error('evidencia incompleta: objetos, claves y disponibilidad');
  const observedRpo = (reference - recoverable) / 60000; const observedRto = (serviceRestored - recoveryStarted) / 60000; const evidenceCompleteAt = new Date(Math.max(serviceRestored, objectsVerified)); const rpoOk = observedRpo <= rpo; const rtoOk = observedRto <= rto;
  console.log(JSON.stringify({ status: rpoOk && rtoOk ? 'PASS' : 'FAIL', objectives: { rpo_minutes: rpo, rto_minutes: rto, approval: { status: approval.status, actor_id: actor, approved_at: approvedAt.toISOString() } }, measurements: { recovery_run_id: runId, recoverable_point_source: recoverableSource }, observed: { rpo_minutes: observedRpo, rto_minutes: observedRto, reference_at: reference.toISOString(), recoverable_point_at: recoverable.toISOString(), recovery_started_at: recoveryStarted.toISOString(), service_restored_at: serviceRestored.toISOString(), evidence_complete_at: evidenceCompleteAt.toISOString() }, checks: { rpo: rpoOk, rto: rtoOk, objects: measurement.objects_verified === true, keys: measurement.keys_verified === true, service: measurement.healthcheck === true } }));
  if (!rpoOk || !rtoOk) process.exitCode = 1;
} catch (error) { fail(error.message); }
