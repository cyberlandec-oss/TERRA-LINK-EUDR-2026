// Comprobaciones reproducibles del móvil (P0-023/P0-024), SEPARADAS de `npm run validate` (web/API).
// Uso: `npm run check --prefix apps/mobile` · opciones: `-- --api` (añade el recorrido contra la API local levantada).
// Resultados en validation-results/<fecha>-movil/ (ignorado por git). Este comando NO prueba emulador, build nativo ni
// dispositivo: el resumen lista qué cubre y qué queda pendiente.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const root = resolve(app, '../..');
const out = join(root, 'validation-results', `${new Date().toISOString().replace(/[:.]/g, '-')}-movil`);
mkdirSync(out, { recursive: true });
const withApi = process.argv.includes('--api');
const isWin = process.platform === 'win32';
const exportDir = mkdtempSync(join(tmpdir(), 'tl-mobile-export-'));

const steps = [
  { name: 'typecheck', cmd: 'npx', args: ['tsc', '--noEmit'], covers: 'Tipos de todo el proyecto móvil' },
  { name: 'pruebas-nucleo', cmd: 'npx', args: ['jest', '--ci', 'src/core'], covers: 'Almacén local, sesión, cifrado obligatorio en build nativo, motor de sincronización (Node + SQLite real; transporte simulado)' },
  ...(withApi ? [{ name: 'recorrido-api', cmd: 'npx', args: ['jest', '--ci', 'src/app'], env: { TL_API_SMOKE: '1' }, covers: 'Cliente en Node contra la API local (DEMO): login, dispositivo, pull, foto con archivo verificado, conflicto sin efecto, separación de cuentas' }] : []),
  { name: 'bundle-android', cmd: 'npx', args: ['expo', 'export', '--platform', 'android', '--output-dir', exportDir], covers: 'El bundle JavaScript (Hermes) para Android compila' },
  { name: 'expo-doctor', cmd: 'npx', args: ['--yes', 'expo-doctor'], covers: 'Coherencia de dependencias y configuración de Expo' },
];
const results = [];
for (const s of steps) {
  const t0 = Date.now();
  process.stdout.write(`▶ ${s.name} … `);
  const r = spawnSync(s.cmd, s.args, { cwd: app, shell: isWin, encoding: 'utf8', env: { ...process.env, ...(s.env ?? {}) }, maxBuffer: 64 * 1024 * 1024 });
  const ok = r.status === 0;
  writeFileSync(join(out, `${s.name}.log`), `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  results.push({ ...s, ok, seconds: Math.round((Date.now() - t0) / 100) / 10 });
  console.log(`${ok ? 'OK' : 'FALLA'} ${results.at(-1).seconds}s`);
}
const pending = [
  'Emulador Android: no ejecutado por este comando (requiere Android SDK).',
  'Build nativo de desarrollo con SQLCipher (`npx expo run:android` o EAS Build): no ejecutado; el cifrado real solo se acredita ahí.',
  'Dispositivo físico: cierre forzado, reinicio, fotos, ubicación real, permisos denegados, almacenamiento lleno y lector de pantalla: pendiente.',
];
const ok = results.every((r) => r.ok);
const md = [`# Comprobaciones del móvil — ${ok ? 'APROBADAS' : 'FALLIDAS'}`, '', 'No forman parte de `npm run validate` y no acreditan emulador, build nativo ni dispositivo.', '',
  '| Paso | Resultado | Cubre |', '| --- | --- | --- |', ...results.map((r) => `| ${r.name} | ${r.ok ? 'OK' : 'FALLA'} (${r.seconds}s) | ${r.covers} |`), '', '## Pendiente (requiere SDK, build nativo o dispositivo)', '', ...pending.map((p) => `- ${p}`), ''].join('\n');
writeFileSync(join(out, 'resumen.md'), md);
writeFileSync(join(out, 'resumen.json'), JSON.stringify({ ok, results: results.map(({ name, ok: o, seconds, covers }) => ({ name, ok: o, seconds, covers })), pending }, null, 2));
console.log(`\nResultado: ${ok ? 'APROBADAS' : 'FALLIDAS'}. Registros en ${out}`);
process.exit(ok ? 0 : 1);
