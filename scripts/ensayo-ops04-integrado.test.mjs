import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const objectives = { rpo_minutes: 15, rto_minutes: 30, approval: { status: 'APPROVED', actor_id: 'synthetic-owner', approved_at: '2026-11-10T09:00:00Z' } };
const argsBase = (dir, overrides = {}) => [
  'scripts/ensayo-ops04-integrado.mjs', '--validar-medicion', '--manifiesto', join(dir, 'estado-actual.txt'), '--informe', join(dir, 'report.json'), '--project', 'synthetic-ops04-run',
  '--referencia', '2026-11-10T10:00:00Z', '--recuperacion-inicio', '2026-11-10T10:05:00Z', '--servicio-restaurado', '2026-11-10T10:35:00Z', '--objetos-verificados', '2026-11-10T10:40:00Z', '--objetos-ok', '--claves-ok', '--salud-ok', ...overrides,
];
const run = (overrides = [], manifest = 'CAPTURED_AT|2026-11-10T09:45:00Z', objective = objectives) => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-ops04-integrated-'));
  try {
    writeFileSync(join(dir, 'estado-actual.txt'), manifest);
    if (!overrides.includes('--sin-objetivos')) writeFileSync(join(dir, 'objectives.json'), JSON.stringify(objective));
    const args = argsBase(dir, overrides.filter((x) => x !== '--sin-objetivos' && x !== '--no-reference'));
    if (overrides.includes('--no-reference')) { const i = args.indexOf('--referencia'); args.splice(i, 2); }
    if (!overrides.includes('--sin-objetivos')) args.push('--objetivos', join(dir, 'objectives.json'));
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    return { result, report };
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('integra manifiesto, medición, informe y validador con datos sintéticos válidos', () => {
  const { result, report } = run([]);
  assert.equal(result.status, 0);
  assert.equal(report.synthetic_scope, true);
  assert.equal(report.recovery.measurement.recoverable_point_source, 'manifiesto-sintetico:CAPTURED_AT');
  assert.equal(report.objectives_validation.status, 'PASS');
});

test('mantiene RPO no determinable sin referencia o CAPTURED_AT', () => {
  const sinReferencia = run(['--no-reference']);
  assert.notEqual(sinReferencia.result.status, 0);
  assert.equal(sinReferencia.report.objectives_validation.status, 'NOT_EVALUATED');
  const sinPunto = run([], 'MANIFEST_ONLY|2026-11-10T09:45:00Z');
  assert.notEqual(sinPunto.result.status, 0);
  assert.equal(sinPunto.report.recovery.rpo.status, 'NOT_DETERMINABLE');
});

test('separa objetivos ausentes de objetivos incumplidos', () => {
  const ausentes = run(['--sin-objetivos']);
  assert.notEqual(ausentes.result.status, 0);
  assert.equal(ausentes.report.objectives_validation.status, 'NOT_EVALUATED');
  const incumplidos = run([], 'CAPTURED_AT|2026-11-10T09:45:00Z', { ...objectives, rpo_minutes: 1 });
  assert.equal(incumplidos.report.objectives_validation.status, 'FAIL');
});
