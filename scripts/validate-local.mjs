#!/usr/bin/env node
// Validación local de Terra Link (criterio de aceptación de la etapa de desarrollo local).
//
//   npm run validate                 # comprobaciones completas
//   npm run validate -- --skip-e2e   # sin navegador
//   npm run validate -- --docker     # añade build de imágenes Docker
//
// Usa solo los scripts reales del repositorio. Bases exclusivas de prueba: `terra_link_test`
// (integración; su esquema se recrea) y `terra_link_e2e` (E2E). NO toca la base de desarrollo
// `terra_link`, NO borra volúmenes y NO ejecuta `docker compose down -v`.
// Resultados: validation-results/<fecha>/ (resumen.md, resumen.json y un .log por paso). Código de
// salida distinto de 0 si falla cualquier paso.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(root, 'validation-results', stamp);
mkdirSync(outDir, { recursive: true });

// Variables desde .env sin imprimir valores.
const env = { ...process.env };
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && env[m[1]] === undefined) env[m[1]] = m[2];
  }
}

function dbName(url) {
  try {
    return new URL(url).pathname.slice(1);
  } catch {
    return '';
  }
}

function run(name, command, cmdArgs) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const logPath = join(outDir, `${name}.log`);
    const log = createWriteStream(logPath);
    process.stdout.write(`▶ ${name} … `);
    // Comandos fijos del propio script (sin entrada externa): una sola cadena para el shell del sistema.
    const child = spawn([command, ...cmdArgs].join(' '), { cwd: root, env, shell: true });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('close', (code) => {
      log.end();
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      process.stdout.write(`${code === 0 ? 'OK' : `FALLA (código ${code})`} ${seconds}s\n`);
      resolvePromise({ name, command: [command, ...cmdArgs].join(' '), code, seconds, log: logPath });
    });
  });
}

const preflight = [];
// Salvaguardas: nunca validar contra la base de desarrollo.
if (!env.TEST_DATABASE_URL || !dbName(env.TEST_DATABASE_URL).endsWith('_test')) {
  preflight.push('TEST_DATABASE_URL debe existir y apuntar a una base *_test (ver .env.example).');
}
if (env.TEST_DATABASE_URL && env.DATABASE_URL && dbName(env.TEST_DATABASE_URL) === dbName(env.DATABASE_URL)) {
  preflight.push('TEST_DATABASE_URL no puede ser la misma base que DATABASE_URL.');
}
for (const name of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'PII_KEYS', 'PII_ACTIVE_KEY_ID', 'PII_INDEX_KEY', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']) {
  if (!env[name]) preflight.push(`Falta la variable ${name} (ver .env.example).`);
}
if (preflight.length) {
  console.error('Validación detenida antes de ejecutar:\n- ' + preflight.join('\n- '));
  process.exit(2);
}

const git = await new Promise((r) => {
  const c = spawn('git', ['rev-parse', '--short', 'HEAD'], { cwd: root });
  let out = '';
  c.stdout.on('data', (d) => (out += d));
  c.on('close', () => r(out.trim()));
});
const dirty = await new Promise((r) => {
  const c = spawn('git', ['status', '--porcelain'], { cwd: root });
  let out = '';
  c.stdout.on('data', (d) => (out += d));
  c.on('close', () => r(out.trim().split('\n').filter(Boolean).length));
});

const steps = [
  ['servicios', 'docker', ['compose', 'up', '-d', '--wait', 'postgres', 'redis', 'object-storage', 'scanner']],
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['lint', 'npm', ['run', 'lint']],
  ['build', 'npm', ['run', 'build']],
  ['openapi-validado', 'npm', ['run', 'openapi', '-w', 'apps/api']],
  ['pruebas-unitarias-integracion', 'npm', ['test']],
];
if (!args.has('--skip-e2e')) steps.push(['e2e-navegador', 'npm', ['run', 'test:e2e']]);
if (args.has('--docker')) steps.push(['imagenes-docker', 'docker', ['compose', '--profile', 'app', 'build']]);

const results = [];
for (const [name, cmd, a] of steps) {
  if (name === 'pruebas-unitarias-integracion') {
    // Diagnóstico de tiempos: se reinicia antes y se conserva después (aprobada o fallida).
    rmSync(join(root, 'apps', 'api', 'test-results'), { recursive: true, force: true });
  }
  const r = await run(name, cmd, a);
  results.push(r);
  if (name === 'pruebas-unitarias-integracion') {
    const src = join(root, 'apps', 'api', 'test-results');
    if (existsSync(src)) cpSync(src, join(outDir, 'api-test-timings'), { recursive: true });
  }
  if (r.code !== 0) {
    // Conserva la evidencia de E2E (trazas, capturas, reporte): Playwright la sobrescribe en cada corrida.
    if (name === 'e2e-navegador') {
      for (const dir of ['test-results', 'playwright-report']) {
        const src = join(root, 'e2e', dir);
        if (existsSync(src)) cpSync(src, join(outDir, `e2e-${dir}`), { recursive: true });
      }
    }
    break; // los pasos siguientes dependen de este
  }
}

const ok = results.length === steps.length && results.every((r) => r.code === 0);
const summary = {
  fecha: new Date().toISOString(),
  commit: git,
  cambios_locales_sin_commit: dirty,
  resultado: ok ? 'APROBADA' : 'FALLIDA',
  pasos: results.map(({ name, command, code, seconds }) => ({ paso: name, comando: command, codigo: code, segundos: seconds })),
  no_ejecutados: steps.slice(results.length).map(([n]) => n),
};
writeFileSync(join(outDir, 'resumen.json'), JSON.stringify(summary, null, 2));
writeFileSync(
  join(outDir, 'resumen.md'),
  `# Validación local ${summary.resultado}\n\nFecha: ${summary.fecha} · commit \`${git}\` · archivos con cambios sin commit: ${dirty}\n\n` +
    '| Paso | Comando | Código | s |\n| --- | --- | --- | --- |\n' +
    summary.pasos.map((p) => `| ${p.paso} | \`${p.comando}\` | ${p.codigo} | ${p.segundos} |`).join('\n') +
    (summary.no_ejecutados.length ? `\n\nNo ejecutados (por fallo previo u opción): ${summary.no_ejecutados.join(', ')}\n` : '\n') +
    '\nLa aceptación local no acredita producción ni conformidad EUDR.\n',
);
console.log(`\nResultado: ${summary.resultado}. Registros en ${outDir}`);
process.exit(ok ? 0 : 1);
