// Revisión VISUAL de orientación (D-41): imágenes SINTÉTICAS con píxeles reales (una «F» asimétrica y una flecha), guardadas
// como lo haría una cámara (píxeles rotados + etiqueta EXIF de orientación 1/3/6/8, más modelo, fecha y GPS ficticios).
// Se procesan con la regla del servidor (apps/api/dist/sync/image-metadata.js), se renderizan en Chromium (respeta la
// orientación EXIF) junto al original y se compara el resultado píxel a píxel. Salida: docs/qa/orientacion/ y captura.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const out = join(root, 'docs', 'qa', 'orientacion');
mkdirSync(out, { recursive: true });
const require = createRequire(import.meta.url);
const { stripImageMetadata, hasImageMetadata, imageOrientation } = require(join(root, 'apps', 'api', 'dist', 'sync', 'image-metadata.js'));
const { chromium } = require(join(root, 'node_modules', '@playwright', 'test')) ;

// 1) Python/Pillow: imagen vertical correcta y variantes «como cámara»
execFileSync('python', ['-c', `
from PIL import Image, ImageDraw
import sys
base = Image.new('RGB', (240, 360), 'white')
d = ImageDraw.Draw(base)
d.rectangle([40, 40, 80, 320], fill='black'); d.rectangle([40, 40, 200, 80], fill='black'); d.rectangle([40, 160, 160, 200], fill='black')
d.polygon([(180, 260), (220, 300), (180, 340)], fill='red')
base.save(sys.argv[1] + '/referencia.png')
# píxeles que una cámara guardaría para que, aplicando la orientación, se vea «base»
inverse = {1: None, 3: Image.Transpose.ROTATE_180, 6: Image.Transpose.ROTATE_90, 8: Image.Transpose.ROTATE_270}
for o, t in inverse.items():
    img = base if t is None else base.transpose(t)
    ex = img.getexif(); ex[0x0112] = o; ex[0x0110] = 'TelefonoSintetico'; ex[0x0132] = '2026:10:11 08:00:00'
    gps = ex.get_ifd(0x8825); gps[1] = 'S'; gps[2] = (0.0, 50.0, 52.0)
    img.save(sys.argv[1] + f'/original-o{o}.jpg', quality=92, exif=ex)
`, out]);

// 2) Regla del servidor + comprobaciones
const rows = [];
for (const o of [1, 3, 6, 8]) {
  const orig = new Uint8Array(readFileSync(join(out, `original-o${o}.jpg`)));
  const proc = stripImageMetadata(orig, 'image/jpeg');
  writeFileSync(join(out, `procesada-o${o}.jpg`), proc);
  const has = (b, t) => Buffer.from(b).includes(Buffer.from(t, 'latin1'));
  rows.push({ orientacion: o, original_orientacion: imageOrientation(orig, 'image/jpeg'), procesada_orientacion: imageOrientation(proc, 'image/jpeg'),
    original_con_metadatos: hasImageMetadata(orig, 'image/jpeg'), procesada_aceptada_por_servidor: !hasImageMetadata(proc, 'image/jpeg'),
    modelo_o_fecha_en_procesada: has(proc, 'TelefonoSintetico') || has(proc, '2026:10:11'),
    sha256_original: createHash('sha256').update(orig).digest('hex'), sha256_procesada: createHash('sha256').update(proc).digest('hex') });
}

// 3) Render en Chromium: original vs procesada vs referencia; comparación de píxeles en canvas
const html = `<!doctype html><meta charset="utf-8"><style>body{font:14px sans-serif;margin:16px}td{padding:6px;text-align:center;vertical-align:top}img{width:120px;height:180px;object-fit:contain;border:1px solid #ccc;image-orientation:from-image}</style>
<h3>Fixtures sintéticos: original (cámara) · procesada (sin metadatos, orientación mínima) · referencia</h3><table><tr><th>EXIF</th><th>Original</th><th>Procesada</th><th>Referencia</th></tr>
${[1, 3, 6, 8].map((o) => `<tr><td>${o}</td><td><img id="o${o}" src="original-o${o}.jpg"></td><td><img id="p${o}" src="procesada-o${o}.jpg"></td><td><img src="referencia.png"></td></tr>`).join('')}</table>`;
writeFileSync(join(out, 'revision.html'), html);
const server = createServer((req, res) => { try { const f = join(out, decodeURIComponent(req.url.split('?')[0].slice(1))); res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : 'image/jpeg' }); res.end(readFileSync(f)); } catch { res.writeHead(404); res.end(); } }).listen(0);
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/revision.html`);
await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
const compare = await page.evaluate(async () => {
  const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
  const pix = (img) => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return { w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data }; };
  const ref = pix(await load('referencia.png'));
  const res = [];
  for (const o of [1, 3, 6, 8]) {
    const a = pix(await load(`original-o${o}.jpg`)); const b = pix(await load(`procesada-o${o}.jpg`));
    let diffAB = 0; for (let k = 0; k < a.d.length; k++) diffAB += Math.abs(a.d[k] - b.d[k]);
    let diffRef = 0; for (let k = 0; k < ref.d.length && k < b.d.length; k++) diffRef += Math.abs(ref.d[k] - b.d[k]);
    res.push({ o, original: `${a.w}x${a.h}`, procesada: `${b.w}x${b.h}`, referencia: `${ref.w}x${ref.h}`, dif_media_original_vs_procesada: diffAB / a.d.length, dif_media_procesada_vs_referencia: b.w === ref.w && b.h === ref.h ? diffRef / ref.d.length : null });
  }
  return res;
});
await page.screenshot({ path: join(root, 'docs', 'qa', 'capturas', 'orientacion-fixtures.png'), fullPage: true });
await browser.close();
server.close();
const result = rows.map((r) => ({ ...r, ...compare.find((c) => c.o === r.orientacion) }));
const ok = result.every((r) => r.procesada_orientacion === r.orientacion && r.procesada_aceptada_por_servidor && r.original_con_metadatos && !r.modelo_o_fecha_en_procesada
  && r.dif_media_original_vs_procesada === 0 && r.procesada === r.referencia && r.dif_media_procesada_vs_referencia !== null && r.dif_media_procesada_vs_referencia < 8);
writeFileSync(join(out, 'resultado.json'), `${JSON.stringify({ descripcion: 'Fixtures sintéticos (no son fotos reales). El SHA-256 de la procesada corresponde al archivo procesado por la app, no al original.', ok, result }, null, 2)}\n`);
console.log(JSON.stringify({ ok, result: result.map((r) => ({ o: r.orientacion, orientacion_proc: r.procesada_orientacion, aceptada: r.procesada_aceptada_por_servidor, dims: `${r.procesada}=${r.referencia}`, dif_o_vs_p: r.dif_media_original_vs_procesada, dif_p_vs_ref: Math.round((r.dif_media_procesada_vs_referencia ?? -1) * 100) / 100 })) }, null, 1));
process.exit(ok ? 0 : 1);
