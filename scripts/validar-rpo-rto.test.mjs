import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (objectives, measurement) => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-rpo-rto-'));
  try {
    const a = join(dir, 'objectives.json');
    const m = join(dir, 'measurement.json');
    writeFileSync(a, JSON.stringify(objectives));
    writeFileSync(m, JSON.stringify(measurement));
    return spawnSync(process.execPath, ['scripts/validar-rpo-rto.mjs', '--objetivos', a, '--medicion', m], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('exige objetivos aprobados y pasa cuando la medición está dentro', () => {
  const result = run({ rpo_minutes: 60, rto_minutes: 120, approved_by: 'responsable-pendiente-de-confirmacion' }, { observed_rpo_minutes: 10, observed_rto_minutes: 30 });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /"status":"PASS"/);
});

test('rechaza ausencia de aceptación y objetivos incumplidos', () => {
  const missing = run({ rpo_minutes: 60, rto_minutes: 120 }, { observed_rpo_minutes: 10, observed_rto_minutes: 30 });
  assert.notEqual(missing.status, 0);
  const exceeded = run({ rpo_minutes: 1, rto_minutes: 2, approved_by: 'aprobador' }, { observed_rpo_minutes: 10, observed_rto_minutes: 30 });
  assert.notEqual(exceeded.status, 0);
  assert.match(exceeded.stdout, /"status":"FAIL"/);
});
