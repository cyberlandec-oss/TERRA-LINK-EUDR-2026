import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

async function filesUnder(root) {
  const out = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  await visit(root);
  return out;
}

export async function locateBySha(root, expected) {
  const matches = [];
  for (const file of await filesUnder(root)) {
    const digest = createHash('sha256').update(await readFile(file)).digest('hex');
    if (digest === expected) matches.push({ file, relative: relative(root, file) });
  }
  return matches;
}
