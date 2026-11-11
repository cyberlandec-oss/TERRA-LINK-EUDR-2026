import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { locateBySha } from './ops04-object-localizer.mjs';

const root = await mkdtemp(join(tmpdir(), 'tl-ops04-localizer-'));
try {
  await mkdir(join(root, 'nested', 'with spaces'), { recursive: true });
  await writeFile(join(root, 'nested', 'with spaces', 'found.bin'), 'synthetic-object');
  await writeFile(join(root, 'other.txt'), 'other');
  const sha = createHash('sha256').update('synthetic-object').digest('hex');
  const found = await locateBySha(root, sha);
  assert.equal(found.length, 1);
  assert.equal(found[0].relative, join('nested', 'with spaces', 'found.bin'));
  assert.deepEqual(await locateBySha(root, '0'.repeat(64)), []);
  console.log('OPS04_LOCALIZER 2/2');
} finally { await rm(root, { recursive: true, force: true }); }
