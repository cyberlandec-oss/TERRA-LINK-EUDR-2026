#!/usr/bin/env node
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';

const targetDir = resolve(process.env.TL_SECRET_DIR ?? join(homedir(), '.terra-link', 'secrets'));
const target = join(targetDir, 'whisp.env');

async function hiddenPrompt(label) {
  if (!input.isTTY || !output.isTTY) throw new Error('requiere una terminal interactiva; no acepta redirecciones');
  output.write(label); input.setRawMode(true); input.resume();
  return await new Promise((resolvePrompt, reject) => {
    let value = '';
    const onData = (chunk) => { for (const char of chunk.toString('utf8')) {
      if (char === '\r' || char === '\n') { input.setRawMode(false); input.pause(); input.off('data', onData); output.write('\n'); resolvePrompt(value); return; }
      if (char === '\u0003') { input.setRawMode(false); input.pause(); input.off('data', onData); reject(new Error('cancelado')); return; }
      if (char === '\u007f') { value = value.slice(0, -1); continue; }
      if (char >= ' ') value += char;
    }};
    input.on('data', onData);
  });
}

try {
  const key = (await hiddenPrompt('API key global de Whisp (oculta): ')).trim();
  if (!key) throw new Error('la clave no puede estar vacía');
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `WHISP_API_KEY=${key}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await chmod(temp, 0o600); await rename(temp, target);
  console.log('WHISP_API_KEY=configurada');
  console.log(`Archivo externo: ${target}`);
  console.log(`Ejecución: docker compose --env-file "${target}" --profile app up -d --build --wait`);
} catch (error) {
  console.error(`No se pudo configurar WHISP_API_KEY: ${error instanceof Error ? error.message : 'error desconocido'}`);
  process.exitCode = 1;
}
