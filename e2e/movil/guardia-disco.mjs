// Guardia de disco para compilaciones y emulador (Windows). Uso:
//   node e2e/movil/guardia-disco.mjs <registro.json> <umbral_GB> -- <comando> [args...]
// - Lanza el comando como hijo y mide el libre de C: cada 3 s con fs.statfs (rápido, sin PowerShell).
// - Se detiene ANTES de cruzar el umbral: si libre − (velocidad de caída × 30 s) < umbral, corta.
// - Al cortar: `taskkill /T /F` sobre el árbol del hijo (Gradle, daemon de un solo uso, CMake, ninja, clang…), y además
//   los daemons de Kotlin/Gradle iniciados después del arranque de la guardia (no cuelgan del árbol).
// - Registra muestras (libre, archivo de paginación asignado) y el motivo de fin en <registro.json>.
// Motivo de esta versión: la guardia anterior medía cada 30 s, solo detenía el proceso principal de Gradle y no
// controlaba el emulador; el libre llegó a 2,07 GB.
import { execFileSync, spawn } from 'node:child_process';
import { statfsSync, writeFileSync } from 'node:fs';

const [, , logFile, thresholdArg, sep, cmd, ...args] = process.argv;
if (sep !== '--' || !cmd) { console.error('uso: guardia-disco.mjs <registro.json> <umbral_GB> -- <comando> [args]'); process.exit(2); }
const threshold = Number(thresholdArg) * 1024 ** 3;
const freeBytes = () => { const s = statfsSync('C:\\'); return s.bavail * s.bsize; };
const pagefileMb = () => { try { return Number(execFileSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_PageFileUsage).AllocatedBaseSize'], { encoding: 'utf8' }).trim()); } catch { return null; } };
const t0 = Date.now();
const startIso = new Date().toISOString();
const samples = [];
const log = { comando: [cmd, ...args].join(' '), umbral_GB: Number(thresholdArg), inicio: startIso, libre_inicial_GB: +(freeBytes() / 1024 ** 3).toFixed(2), pagefile_inicial_MB: pagefileMb(), muestras: samples, fin: null };
const save = () => writeFileSync(logFile, `${JSON.stringify(log, null, 2)}\n`);

const child = spawn(cmd, args, { stdio: 'inherit', shell: true, windowsHide: true });
let stopped = null;
function killTree(reason) {
  if (stopped) return;
  stopped = reason;
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ya terminó */ }
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -match 'KotlinCompileDaemon|GradleDaemon|org.gradle') -and $_.CreationDate -ge [datetime]'${startIso}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' });
  } catch { /* nada que detener */ }
}
let last = { t: Date.now(), free: freeBytes() };
const window = [];
const timer = setInterval(() => {
  const now = Date.now(); const free = freeBytes();
  const inst = Math.max(0, (last.free - free) / ((now - last.t) / 1000)); // bytes/s de caída instantánea
  last = { t: now, free };
  window.push(inst); if (window.length > 4) window.shift();
  // Media móvil de 12 s: una reserva puntual (p. ej. el disco de datos del emulador) no dispara la guardia; una caída
  // sostenida sí. Corte si libre − media × 15 s < umbral, o si ya se cruzó el umbral.
  const rate = window.reduce((a, b) => a + b, 0) / window.length;
  if (samples.length % 10 === 0) samples.push({ s: Math.round((now - t0) / 1000), libre_GB: +(free / 1024 ** 3).toFixed(2), caida_MB_s: +(rate / 1024 ** 2).toFixed(1), pagefile_MB: pagefileMb() });
  else samples.push({ s: Math.round((now - t0) / 1000), libre_GB: +(free / 1024 ** 3).toFixed(2), caida_MB_s: +(rate / 1024 ** 2).toFixed(1) });
  if (free < threshold || free - rate * 15 < threshold) { console.error(`GUARDIA: libre ${(free / 1024 ** 3).toFixed(2)} GB con caída ${(rate / 1024 ** 2).toFixed(1)} MB/s: se detiene`); killTree(`umbral ${thresholdArg} GB (alcanzado o previsto en 15 s)`); }
  save();
}, 3000);
child.on('exit', (code) => {
  clearInterval(timer);
  log.fin = { codigo: code, motivo: stopped ?? 'terminó', duracion_s: Math.round((Date.now() - t0) / 1000), libre_final_GB: +(freeBytes() / 1024 ** 3).toFixed(2), minimo_GB: Math.min(log.libre_inicial_GB, ...samples.map((x) => x.libre_GB)), pagefile_final_MB: pagefileMb() };
  save();
  console.log(`guardia: ${log.fin.motivo}; código ${code}; mínimo ${log.fin.minimo_GB} GB; final ${log.fin.libre_final_GB} GB`);
  process.exit(stopped ? 3 : code ?? 1);
});
