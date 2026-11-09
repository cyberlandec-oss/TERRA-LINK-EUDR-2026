// Revisión visual P0-026 plantilla LOTES_V1 en navegador real, contra la aplicación de DESARROLLO local.
//   npm run build -w apps/api && node e2e/review/importaciones-lotes.mjs [http://localhost:3000]
// Archivos SINTÉTICOS. Usa la recepción DEMO ya confirmada de ENT-2026-00001 (no crea recepciones ni stock).
// - Administración (1280 px): elige «Lotes», descarga la plantilla (con la hoja de recepciones disponibles); archivo con
//   errores (cantidad excesiva, recepción sin existencia, recepción inexistente, fila sin identidad): no confirmable; archivo
//   válido (20 kg de ENT-2026-00001 a un lote nuevo con referencia DEMO-IMP-LOTE-1) cuya vista previa explica el movimiento,
//   confirmado SOLO CON TECLADO; comprueba en la base el movimiento del ledger.
// - 390 px: reimportación = sin cambios; sin desplazamiento horizontal.
// - Supervisión (MANAGER) autorizada; trazabilidad (lot:create sin import:manage) y técnico denegados.
// Evidencia: docs/qa/importacion/revision-lotes.json y docs/qa/capturas/importacion/lo*.png.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const BASE = process.argv[2] ?? 'http://localhost:3000';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const shots = join(root, 'docs', 'qa', 'capturas', 'importacion');
const outDir = join(root, 'docs', 'qa', 'importacion');
mkdirSync(shots, { recursive: true });
mkdirSync(outDir, { recursive: true });
const { writeXlsx } = createRequire(import.meta.url)(join(root, 'apps', 'api', 'dist', 'imports', 'xlsx.js'));
const psql = (q) => execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', `psql -U "$POSTGRES_USER" -d terra_link -tAc "${q.replace(/"/g, '\\"')}"`], { cwd: root, encoding: 'utf8' }).trim();

const credFile = ['CREDENCIALES.csv', 'CREDENCIALES.pendiente.csv'].filter((f) => existsSync(join(root, f)))
  .sort((a, b) => statSync(join(root, b)).mtimeMs - statSync(join(root, a)).mtimeMs)[0];
const lines = readFileSync(join(root, credFile), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split(','));
const head = lines.shift();
const acc = (local) => { const r = lines.find((x) => x[head.indexOf('email')].startsWith(`${local}@`)); return { email: r[head.indexOf('email')], password: r[head.indexOf('contrasena')] }; };

const token = (await (await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(acc('admin.cooperativa')) })).json()).access_token;
const coop = (await (await fetch(`${API}/api/v1/organizations`, { headers: { authorization: `Bearer ${token}` } })).json()).find((o) => o.name.includes('Cooperativa')).id;
const recOf = (code) => psql(`SELECT r.id FROM receptions r JOIN deliveries d ON d.id = r.delivery_id WHERE d.organization_id = '${coop}' AND d.delivery_code = '${code}' ORDER BY r.created_at LIMIT 1`);
const rec1 = recOf('ENT-2026-00001');
const rec2 = recOf('ENT-2026-00002');
const HEAD = ['codigo_lote', 'referencia_importacion', 'id_recepcion', 'codigo_entrega', 'codigo_producto', 'cantidad_kg'];
const valid = writeXlsx([{ name: 'lotes', rows: [HEAD, ['', 'DEMO-IMP-LOTE-1', rec1, 'ENT-2026-00001', '', '20']] }]);
const withErrors = writeXlsx([{ name: 'lotes', rows: [HEAD,
  ['', 'DEMO-IMP-LOTE-X1', rec1, '', '', '999'],
  ['', 'DEMO-IMP-LOTE-X2', rec2, '', '', '5'],
  ['', 'DEMO-IMP-LOTE-X3', randomUUID(), '', '', '5'],
  ['', '', rec1, '', '', '5'],
] }]);
const tmp = (name, buf) => { const f = join(tmpdir(), name); writeFileSync(f, buf); return f; };
const validFile = tmp('demo-importacion-lotes.xlsx', valid);
const errorFile = tmp('demo-importacion-lotes-con-errores.xlsx', withErrors);
const physical = () => psql(`SELECT coalesce(sum(signed_quantity),0) FROM stock_entries WHERE bucket='PHYSICAL' AND reception_id='${rec1}'`);

const results = [];
const check = (caso, ok, detalle = '', captura = null) => { results.push({ caso, ok, detalle, captura }); console.log(`${ok ? 'OK   ' : 'FALLA'} ${caso}${detalle ? `: ${detalle}` : ''}`); };
const shot = async (page, name) => { const f = join(shots, `${name}.png`); await page.screenshot({ path: f, fullPage: true }); return `docs/qa/capturas/importacion/${name}.png`; };
const url = `${BASE}/organizaciones/${coop}/importaciones`;
const browser = await chromium.launch();
let current = null;
async function loginAs(local, viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport, locale: 'es-EC', acceptDownloads: true });
  const page = await ctx.newPage();
  current = page;
  await page.goto(BASE);
  const a = acc(local);
  await page.getByLabel('Correo').fill(a.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 15000 });
  return { ctx, page };
}
async function chooseLots(page) {
  await page.goto(url);
  await page.getByRole('heading', { name: '¿Qué quieres importar?' }).waitFor({ timeout: 15000 });
  await page.getByRole('radio', { name: /^Lotes/ }).check();
  await page.getByText('Plantilla LOTES_V1').waitFor({ timeout: 15000 });
}
async function uploadAndMap(page, file) {
  await page.getByLabel('Libro de Excel').setInputFiles(file);
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await page.getByRole('heading', { name: '3. Mapeo de columnas' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /Usar sugerencias/ }).click();
  await page.getByRole('button', { name: 'Guardar mapeo y ver vista previa' }).click();
  await page.getByRole('heading', { name: '4. Vista previa y validación' }).waitFor({ timeout: 15000 });
}

try {
  {
    const { ctx, page } = await loginAs('admin.cooperativa');
    await chooseLots(page);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar plantilla (.xlsx)' }).click();
    const d = await dl;
    const body0 = await page.locator('main').innerText();
    check('admin: elige Lotes, descarga su plantilla y ve que solo asigna recepciones confirmadas', /plantilla-lotes_v1\.xlsx/.test(d.suggestedFilename()) && /solo asigna recepciones confirmadas/.test(body0), d.suggestedFilename(), await shot(page, 'lo01-admin-plantilla-lotes'));
    await uploadAndMap(page, errorFile);
    const body = await page.locator('main').innerText();
    const noCommit = !(await page.getByRole('button', { name: 'Confirmar importación' }).count());
    check('admin: exceso, recepción sin existencia, recepción no disponible y fila sin identidad son errores; no confirmable',
      /4 con error/.test(body) && /supera lo disponible/.test(body) && /no está disponible para ti/.test(body) && /ni referencia de importación/.test(body) && noCommit, '', await shot(page, 'lo02-admin-errores-lotes'));
    await page.getByRole('button', { name: 'Descartar carga' }).click();
    await page.getByRole('heading', { name: '3. Mapeo de columnas' }).waitFor({ state: 'detached', timeout: 15000 });

    const before = physical();
    await uploadAndMap(page, validFile);
    const pv = await page.locator('main').innerText();
    const fresh = /1 nuevas/.test(pv);
    check('admin: la vista previa explica el movimiento antes de confirmar (sin guardar)', (fresh && /Movimiento:.*mueve 20 kg de la recepción de ENT-2026-00001/.test(pv)) || /1 sin cambios/.test(pv), fresh ? 'movimiento explicado' : 'reimportación: sin cambios', await shot(page, 'lo03-admin-vista-previa-lotes'));
    if (fresh) {
      await page.getByRole('checkbox').focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement?.textContent);
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: '6. Resultado' }).waitFor({ timeout: 15000 });
      check('admin: confirmación con teclado → lote creado', /Creados 1/.test(await page.locator('main').innerText()), `foco en «${focused}»`, await shot(page, 'lo04-admin-resultado-lotes'));
      const lot = psql(`SELECT l.lot_code || ':' || l.status || ':' || l.origin_status FROM import_references x JOIN lots l ON l.id = x.lot_id WHERE x.reference = 'DEMO-IMP-LOTE-1'`);
      check('base: lote abierto con origen conocido y 20 kg movidos por el ledger desde la recepción', /:OPEN:COMPLETE/.test(lot) && Number(before) - Number(physical()) === 20, `${lot}; recepción ${before} → ${physical()} kg sin lote`);
    } else {
      check('admin: confirmación con teclado (no aplicable: ya importado en una ejecución anterior)', true, 'ver reimportación');
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await loginAs('admin.cooperativa', { width: 390, height: 844 });
    await chooseLots(page);
    await uploadAndMap(page, validFile);
    const txt = await page.locator('main').innerText();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('390 px: reimportación = sin cambios («ya está asignada»), nada que confirmar', /1 sin cambios/.test(txt) && /ya está asignada/.test(txt) && /No hay nada que importar/.test(txt), '', await shot(page, 'lo05-390-reimportacion-lotes'));
    check('390 px: sin desplazamiento horizontal de la página', overflow <= 0, `exceso ${overflow}px`);
    await page.getByRole('button', { name: 'Descartar carga' }).click();
    await ctx.close();
  }
  {
    const { ctx, page } = await loginAs('supervisor.cooperativa');
    await chooseLots(page);
    check('supervisión (MANAGER): Lotes habilitada', true, '', await shot(page, 'lo06-supervision-lotes'));
    await ctx.close();
  }
  for (const [local, label, n] of [['trazabilidad.exportadora', 'trazabilidad (otra organización)', 'lo07'], ['tecnico1.cooperativa', 'técnico de campo', 'lo08']]) {
    const { ctx, page } = await loginAs(local);
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const denied = await page.getByText(/Tu rol no permite importar datos|no existe|No encontramos|no tienes acceso/i).first().isVisible().catch(() => false);
    const options = await page.getByRole('radio', { name: /^Lotes/ }).count();
    check(`${label}: sin acceso a la importación de lotes de la cooperativa`, denied || options === 0, '', await shot(page, `${n}-${label.split(' ')[0]}-denegado`));
    await ctx.close();
  }
} catch (e) {
  const cap = current ? await shot(current, 'lo99-fallo').catch(() => null) : null;
  check('ejecución sin errores', false, String(e.message).split('\n').slice(0, 4).join(' | '), cap);
} finally {
  await browser.close();
  const ok = results.every((r) => r.ok);
  writeFileSync(join(outDir, 'revision-lotes.json'), `${JSON.stringify({ fecha: new Date().toISOString(), base: BASE, entorno: 'DESARROLLO local (contenedores), datos DEMO y archivos sintéticos', ok, casos: results }, null, 2)}\n`);
  console.log(`Resultado: ${ok ? 'APROBADO' : 'FALLIDO'}`);
  process.exitCode = ok ? 0 : 1;
}
