import { readFileSync } from 'node:fs';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};

const fail = (message) => {
  console.error(`RPO_RTO_INVALID: ${message}`);
  process.exitCode = 1;
};

const readJson = (path, label) => {
  if (!path) throw new Error(`falta --${label}`);
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`${label} ilegible: ${error.message}`); }
};

try {
  const objectives = readJson(arg('--objetivos'), 'objetivos');
  const measurement = readJson(arg('--medicion'), 'medicion');
  const rpo = Number(objectives.rpo_minutes);
  const rto = Number(objectives.rto_minutes);
  const observedRpo = Number(measurement.observed_rpo_minutes);
  const observedRto = Number(measurement.observed_rto_minutes);
  const approver = typeof objectives.approved_by === 'string' ? objectives.approved_by.trim() : '';

  if (!Number.isFinite(rpo) || rpo < 0) throw new Error('rpo_minutes debe ser un número no negativo');
  if (!Number.isFinite(rto) || rto < 0) throw new Error('rto_minutes debe ser un número no negativo');
  if (!approver) throw new Error('falta approved_by: no se inventa la aceptación del objetivo');
  if (!Number.isFinite(observedRpo) || observedRpo < 0) throw new Error('observed_rpo_minutes inválido');
  if (!Number.isFinite(observedRto) || observedRto < 0) throw new Error('observed_rto_minutes inválido');

  const rpoOk = observedRpo <= rpo;
  const rtoOk = observedRto <= rto;
  console.log(JSON.stringify({
    status: rpoOk && rtoOk ? 'PASS' : 'FAIL',
    objectives: { rpo_minutes: rpo, rto_minutes: rto, approved_by: approver },
    observed: { rpo_minutes: observedRpo, rto_minutes: observedRto },
    checks: { rpo: rpoOk, rto: rtoOk },
  }));
  if (!rpoOk || !rtoOk) process.exitCode = 1;
} catch (error) {
  fail(error.message);
}
