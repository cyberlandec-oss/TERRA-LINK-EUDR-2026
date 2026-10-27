// Revisión visual P0-026 plantilla PARCELAS_V1 en navegador real, contra la aplicación de DESARROLLO local.
//   npm run build -w apps/api && node e2e/review/importaciones-parcelas.mjs [http://localhost:3000]
// Archivos SINTÉTICOS (no son datos reales de una asociación). Cuentas DEMO de CREDENCIALES.csv (nunca imprime contraseñas).
// - Administración (1280 px): elige «Parcelas», descarga la plantilla; archivo con errores (productor inexistente y de
//   baja, coma decimal) y una superficie sobre una parcela con geometría (se acepta y la conserva): no confirmable, se descarta;
//   archivo válido confirmado SOLO CON TECLADO. Crea DEMO-IMP-PAR-001/002 (productor DEMO-RV-008), sin geometría.
// - Administración a 390 px: reimportación = sin cambios, sin desplazamiento horizontal.
// - Supervisión (MANAGER, autorizado): opción «Parcelas» habilitada y plantilla visible.
// - Técnico de campo y auditoría (sin import:manage): sin menú y la URL directa explica la denegación.
// Evidencia: docs/qa/importacion/revision-parcelas.json y docs/qa/capturas/importacion/pa*.png.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const BASE = process.argv[2] ?? 'http://localhost:3000';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const shots = join(root, 'docs', 'qa', 'capturas', 'importacion');
const outDir = join(root, 'docs', 'qa', 'importacion');
mkdirSync(shots, { recursive: true });
mkdirSync(outDir, { recursive: true });
const { writeXlsx } = createRequire(import.meta.url)(join(root, 'apps', 'api', 'dist', 'imports', 'xlsx.js'));

const credFile = ['CREDENCIALES.csv', 'CREDENCIALES.pendiente.csv'].filter((f) => existsSync(join(root, f)))
  .sort((a, b) => statSync(join(root, b)).mtimeMs - statSync(join(root, a)).mtimeMs)[0];
const lines = readFileSync(join(root, credFile), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split(','));
const head = lines.shift();
const acc = (local) => { const r = lines.find((x) => x[head.indexOf('email')].startsWith(`${local}@`)); return { email: r[head.indexOf('email')], password: r[head.indexOf('contrasena')] }; };

const HEAD = ['codigo_parcela', 'codigo_productor', 'nombre', 'cultivo', 'variedad', 'superficie_declarada_ha', 'coordenadas_campo'];
const valid = writeXlsx([{ name: 'parcelas', rows: [HEAD,
  ['DEMO-IMP-PAR-001', 'DEMO-RV-008', 'Lote importado norte (demo)', 'Cacao', 'Nacional', '1.75', 'columna sin mapear'],
  ['DEMO-IMP-PAR-002', 'DEMO-RV-008', 'Lote importado sur (demo)', 'Cacao', '', '', ''],
] }]);
const withErrors = writeXlsx([{ name: 'parcelas', rows: [HEAD,
  ['DEMO-IMP-PAR-010', 'DEMO-NO-EXISTE', '', 'Cacao', '', '', ''],
  ['DEMO-IMP-PAR-011', 'DEMO-RV-007', '', 'Cacao', '', '', ''],
  ['DEMO-IMP-PAR-012', 'DEMO-RV-008', '', 'Cacao', '', '1,5', ''],
  ['DEMO-PAR-005', 'DEMO-RV-005', '', '', '', '2', ''],
] }]);
const tmp = (name, buf) => { const f = join(tmpdir(), name); writeFileSync(f, buf); return f; };
const validFile = tmp('demo-importacion-parcelas.xlsx', valid);
const errorFile = tmp('demo-importacion-parcelas-con-errores.xlsx', withErrors);

const results = [];
const check = (caso, ok, detalle = '', captura = null) => { results.push({ caso, ok, detalle, captura }); console.log(`${ok ? 'OK   ' : 'FALLA'} ${caso}${detalle ? `: ${detalle}` : ''}`); };
const shot = async (page, name) => { const f = join(shots, `${name}.png`); await page.screenshot({ path: f, fullPage: true }); return `docs/qa/capturas/importacion/${name}.png`; };

const token = (await (await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(acc('admin.cooperativa')) })).json()).access_token;
const coop = (await (await fetch(`${API}/api/v1/organizations`, { headers: { authorization: `Bearer ${token}` } })).json()).find((o) => o.name.includes('Cooperativa')).id;
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
async function choosePlots(page) {
  await page.goto(url);
  await page.getByRole('heading', { name: '¿Qué quieres importar?' }).waitFor({ timeout: 15000 });
  await page.getByRole('radio', { name: /^Parcelas/ }).check();
  await page.getByText('Plantilla PARCELAS_V1').waitFor({ timeout: 15000 });
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
    await choosePlots(page);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar plantilla (.xlsx)' }).click();
    const d = await dl;
    const body0 = await page.locator('main').innerText();
    check('admin: elige Parcelas, descarga su plantilla y ve que no se importa geometría', /plantilla-parcelas_v1\.xlsx/.test(d.suggestedFilename()) && /NO importa coordenadas ni geometría/.test(body0) && /se conserva tal cual/.test(body0), d.suggestedFilename(), await shot(page, 'pa01-admin-plantilla-parcelas'));

    await uploadAndMap(page, errorFile);
    const body = await page.locator('main').innerText();
    const noCommit = !(await page.getByRole('button', { name: 'Confirmar importación' }).count());
    check('admin: productor inexistente y de baja y coma decimal son errores de fila; la superficie sobre una parcela con geometría se acepta (la conserva); no confirmable',
      /3 con error/.test(body) && /1 actualizaciones/.test(body) && /no está disponible para ti/.test(body) && /dado de baja/.test(body) && /Formato no válido/.test(body) && noCommit, '', await shot(page, 'pa02-admin-errores-parcelas'));
    await page.getByRole('button', { name: 'Descartar carga' }).click();
    await page.getByRole('heading', { name: '3. Mapeo de columnas' }).waitFor({ state: 'detached', timeout: 15000 });

    await uploadAndMap(page, validFile);
    const ignored = await page.getByLabel('Campo para la columna G').inputValue();
    const pv = await page.locator('main').innerText();
    const fresh = /2 nuevas/.test(pv);
    check('admin: vista previa válida (sin guardar); la columna de coordenadas queda «No importar»', (fresh || /2 sin cambios/.test(pv)) && ignored === '', fresh ? '2 nuevas' : 'reimportación: 2 sin cambios', await shot(page, 'pa03-admin-vista-previa-parcelas'));
    if (fresh) {
      await page.getByRole('checkbox').focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement?.textContent);
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: '6. Resultado' }).waitFor({ timeout: 15000 });
      check('admin: confirmación con teclado → 2 parcelas creadas', /Creados 2/.test(await page.locator('main').innerText()), `foco en «${focused}»`, await shot(page, 'pa04-admin-resultado-parcelas'));
    } else {
      check('admin: confirmación con teclado (no aplicable: ya importado en una ejecución anterior)', true, 'ver reimportación');
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await loginAs('admin.cooperativa', { width: 390, height: 844 });
    await choosePlots(page);
    await uploadAndMap(page, validFile);
    const txt = await page.locator('main').innerText();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('390 px: reimportación de parcelas = 2 sin cambios, nada que confirmar', /2 sin cambios/.test(txt) && /No hay nada que importar/.test(txt), '', await shot(page, 'pa05-390-reimportacion-parcelas'));
    check('390 px: sin desplazamiento horizontal de la página', overflow <= 0, `exceso ${overflow}px`);
    await page.getByRole('button', { name: 'Descartar carga' }).click();
    await ctx.close();
  }
  {
    const { ctx, page } = await loginAs('supervisor.cooperativa');
    await choosePlots(page);
    check('supervisión (MANAGER): Parcelas habilitada y plantilla disponible', true, '', await shot(page, 'pa06-supervision-parcelas'));
    await ctx.close();
  }
  for (const [local, label, n] of [['tecnico1.cooperativa', 'técnico de campo', 'pa07'], ['auditor.cooperativa', 'auditoría', 'pa08']]) {
    const { ctx, page } = await loginAs(local);
    await page.goto(`${BASE}/organizaciones/${coop}`);
    await page.waitForLoadState('networkidle');
    const nav = await page.getByRole('link', { name: 'Importar datos (Excel)' }).count();
    await page.goto(url);
    await page.getByText(/Tu rol no permite importar datos/).waitFor({ timeout: 15000 });
    check(`${label}: sin menú y denegación explicada en la URL directa`, nav === 0, '', await shot(page, `${n}-${label.split(' ')[0]}-denegado`));
    await ctx.close();
  }
} catch (e) {
  const cap = current ? await shot(current, 'pa99-fallo').catch(() => null) : null;
  check('ejecución sin errores', false, String(e.message).split('\n').slice(0, 4).join(' | '), cap);
} finally {
  await browser.close();
  const ok = results.every((r) => r.ok);
  writeFileSync(join(outDir, 'revision-parcelas.json'), `${JSON.stringify({ fecha: new Date().toISOString(), base: BASE, entorno: 'DESARROLLO local (contenedores), datos DEMO y archivos sintéticos', ok, casos: results }, null, 2)}\n`);
  console.log(`Resultado: ${ok ? 'APROBADO' : 'FALLIDO'}`);
  process.exitCode = ok ? 0 : 1;
}
