// Controlador mínimo de interfaz Android por adb + uiautomator (emulador). Busca elementos por texto o descripción de
// accesibilidad (las etiquetas de la app), toca su centro y escribe texto. No imprime valores escritos (contraseñas).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const ADB = `${process.env.ANDROID_HOME ?? 'C:/Users/mario/Android/sdk'}/platform-tools/adb.exe`;
export const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: 'C:/' });
export const adbBin = (...a) => execFileSync(ADB, a, { maxBuffer: 64 * 1024 * 1024, cwd: 'C:/' });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
export function nodes() {
  let xml = '';
  for (let i = 0; i < 3 && !xml.includes('<hierarchy'); i++) {
    try { adb('shell', 'uiautomator', 'dump', '/sdcard/tl-ui.xml'); xml = adb('shell', 'cat', '/sdcard/tl-ui.xml'); } catch { /* reintento */ }
  }
  return [...xml.matchAll(/<node [^>]*?>/g)].map((m) => {
    const a = (k) => decode((new RegExp(`${k}="([^"]*)"`).exec(m[0]) ?? [])[1] ?? '');
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(m[0]);
    return { text: a('text'), desc: a('content-desc'), id: a('resource-id'), cls: a('class'), pkg: a('package'), password: a('password') === 'true', bounds: b ? b.slice(1).map(Number) : [0, 0, 0, 0] };
  });
}
export const allText = () => nodes().map((n) => `${n.text} ${n.desc}`).join('\n');
const matches = (n, re) => re.test(n.text) || re.test(n.desc) || re.test(n.id);
export function find(re) { return nodes().filter((n) => matches(n, re) && n.bounds[2] > n.bounds[0]); }
export function tapNode(n) { const [x1, y1, x2, y2] = n.bounds; adb('shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2))); }
export function scroll(dir = 'down') { adb('shell', 'input', 'swipe', '20', dir === 'down' ? '1400' : '500', '20', dir === 'down' ? '500' : '1400', '400'); } // por encima de la barra de pestañas

export async function waitFor(re, { timeout = 30000, scrollTo = false } = {}) {
  const t0 = Date.now();
  let scrolls = 0;
  for (;;) {
    const f = find(re);
    if (f.length) return f[0];
    if (Date.now() - t0 > timeout) throw new Error(`No apareció ${re} en ${timeout} ms`);
    if (scrollTo && scrolls < 8) { scroll('down'); scrolls += 1; } else await sleep(800);
  }
}
// La barra de pestañas ocupa la franja inferior (y > ~2150 px en 1080x2400): un control que cae allí se desplaza antes de tocarlo.
const TAB_BAR_Y = 2100;
export async function tap(re, opts = {}) {
  await closeKeyboard();
  let n = await waitFor(re, { scrollTo: true, ...opts });
  for (let i = 0; i < 4 && (n.bounds[1] + n.bounds[3]) / 2 > TAB_BAR_Y; i++) { scroll('down'); await sleep(500); const again = find(re); if (again.length) n = again[0]; }
  tapNode(n); await sleep(600); return n;
}
/** Escribe en el campo cuya etiqueta (accesibilidad) coincide; borra antes. El valor no se registra. */
export const keyboardShown = () => /mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'));
export async function closeKeyboard() { if (keyboardShown()) { adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(600); } }
export async function typeInto(re, value, { clear = true } = {}) {
  await closeKeyboard(); // el teclado en pantalla tapa los campos inferiores
  const label = await waitFor(re, { scrollTo: true });
  // La etiqueta es un TextView: se escribe en el EditText inmediatamente debajo (o en el propio nodo si ya es EditText).
  const edits = nodes().filter((x) => x.cls === 'android.widget.EditText' && x.bounds[2] > x.bounds[0]);
  const n = label.cls === 'android.widget.EditText' ? label : edits.filter((x) => x.bounds[1] >= label.bounds[1]).sort((a, b) => a.bounds[1] - b.bounds[1])[0];
  if (!n) throw new Error(`Sin campo de texto bajo ${re}`);
  tapNode(n); await sleep(400);
  if (clear) { adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END'); adb('shell', 'input', 'keyevent', ...Array(70).fill('67')); }
  const safe = value.replace(/ /g, '%s');
  adb('shell', 'input', 'text', `'${safe}'`);
  await sleep(300);
}
export function back() { adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); }
export function hideKeyboard() { if (keyboardShown()) adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); }
export function screenshot(path) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, adbBin('exec-out', 'screencap', '-p')); }

/**
 * ¿Es seguro capturar la pantalla? No, si: hay un campo de contraseña visible, es la pantalla de inicio de sesión, o algún
 * campo de texto tiene contenido (salvo los permitidos explícitamente, p. ej. una nota sintética). No depende de conocer
 * las contraseñas.
 */
export function captureAllowed(allowFilled = []) {
  const ns = nodes();
  if (ns.some((n) => n.password)) return { ok: false, motivo: 'campo de contraseña visible' };
  if (ns.some((n) => /^Contraseña$|Iniciar sesión/.test(n.text) && ns.some((e) => e.cls === 'android.widget.EditText'))) return { ok: false, motivo: 'pantalla de inicio de sesión' };
  const filled = ns.filter((n) => n.cls === 'android.widget.EditText' && n.text && !allowFilled.some((re) => re.test(n.desc)));
  if (filled.length) return { ok: false, motivo: 'campo de texto con contenido' };
  return { ok: true };
}
