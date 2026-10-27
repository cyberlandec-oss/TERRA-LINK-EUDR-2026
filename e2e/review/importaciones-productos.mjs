// Revisión visual P0-026 plantilla PRODUCTOS_V1 en navegador real, contra la aplicación de DESARROLLO local.
//   npm run build -w apps/api && node e2e/review/importaciones-productos.mjs [http://localhost:3000]
// Archivos SINTÉTICOS (no son datos reales de una asociación). Cuentas DEMO de CREDENCIALES.csv (nunca imprime contraseñas).
// - Administración de la cooperativa (1280 px): elige «Productos», descarga la plantilla, archivo con errores (unidad LB,
//   estado fuera de catálogo, #BORRAR en el nombre: no confirmable, se descarta) y archivo válido confirmado SOLO CON
//   TECLADO. Crea productos activos DEMO-IMP-* en el catálogo DEMO de la cooperativa.
// - Administración a 390 px: reimportación del mismo archivo → «sin cambios»; sin desplazamiento horizontal.
// - Supervisión (MANAGER: import:manage sin product:manage): «Productos» deshabilitado con explicación; la URL de la
//   plantilla responde 403.
// Evidencia: docs/qa/importacion/revision-productos.json y docs/qa/capturas/importacion/p*.png.
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

const HEAD = ['codigo_producto', 'nombre', 'estado_presentacion', 'unidad', 'nombre_cientifico', 'variedad', 'observaciones'];
const valid = writeXlsx([{ name: 'productos', rows: [HEAD,
  ['DEMO-IMP-CACAO-SECO', 'Cacao seco importado (demo)', 'CACAO_SECO', 'KG', 'Theobroma cacao', 'Nacional', 'columna sin mapear'],
  ['DEMO-IMP-CACAO-BABA', 'Cacao en baba importado (demo)', 'CACAO_BABA', 'KG', '', '', ''],
] }]);
const withErrors = writeXlsx([{ name: 'productos', rows: [HEAD,
  ['DEMO-IMP-LB', 'Unidad en libras (demo)', 'CACAO_SECO', 'LB', '', '', 'sin conversión'],
  ['DEMO-IMP-TOSTADO', 'Estado fuera de catálogo (demo)', 'CACAO_TOSTADO', 'KG', '', '', ''],
  ['DEMO-IMP-BORRAR', '#BORRAR', 'CACAO_SECO', 'KG', '', '', 'nombre no se vacía'],
] }]);
const tmp = (name, buf) => { const f = join(tmpdir(), name); writeFileSync(f, buf); return f; };
const validFile = tmp('demo-importacion-productos.xlsx', valid);
const errorFile = tmp('demo-importacion-productos-con-errores.xlsx', withErrors);

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
async function chooseProducts(page) {
  await page.goto(url);
  await page.getByRole('heading', { name: '¿Qué quieres importar?' }).waitFor({ timeout: 15000 });
  await page.getByRole('radio', { name: /^Productos/ }).check();
  await page.getByText('Plantilla PRODUCTOS_V1').waitFor({ timeout: 15000 });
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
  // 1) Administración, escritorio
  {
    const { ctx, page } = await loginAs('admin.cooperativa');
    await chooseProducts(page);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar plantilla (.xlsx)' }).click();
    const d = await dl;
    check('admin: elige Productos y descarga su plantilla', /plantilla-productos_v1\.xlsx/.test(d.suggestedFilename()), d.suggestedFilename(), await shot(page, 'p01-admin-plantilla-productos'));

    await uploadAndMap(page, errorFile);
    const body = await page.locator('main').innerText();
    const noCommit = !(await page.getByRole('button', { name: 'Confirmar importación' }).count());
    check('admin: unidad LB, estado fuera de catálogo y #BORRAR en el nombre son errores de fila; no confirmable',
      /3 con error/.test(body) && /no es un código de unidad/.test(body) && /no es un código de estado/.test(body) && /no se puede vaciar/.test(body) && noCommit, '', await shot(page, 'p02-admin-errores-productos'));
    await page.getByRole('button', { name: 'Descartar carga' }).click();
    await page.getByRole('heading', { name: '3. Mapeo de columnas' }).waitFor({ state: 'detached', timeout: 15000 });

    await uploadAndMap(page, validFile);
    const pv = await page.locator('main').innerText();
    const fresh = /2 nuevas/.test(pv);
    check('admin: vista previa del archivo válido (sin guardar)', fresh || /2 sin cambios/.test(pv), fresh ? '2 nuevas' : 'reimportación: 2 sin cambios', await shot(page, 'p03-admin-vista-previa-productos'));
    if (fresh) {
      await page.getByRole('checkbox').focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement?.textContent);
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: '6. Resultado' }).waitFor({ timeout: 15000 });
      check('admin: confirmación con teclado → 2 productos creados (estado activo)', /Creados 2 \(estado activo\)/.test(await page.locator('main').innerText()), `foco en «${focused}»`, await shot(page, 'p04-admin-resultado-productos'));
    } else {
      check('admin: confirmación con teclado (no aplicable: ya importado en una ejecución anterior)', true, 'ver reimportación');
    }
    await ctx.close();
  }
  // 2) Administración, 390 px: reimportación sin cambios
  {
    const { ctx, page } = await loginAs('admin.cooperativa', { width: 390, height: 844 });
    await chooseProducts(page);
    await uploadAndMap(page, validFile);
    const txt = await page.locator('main').innerText();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('390 px: reimportación de productos = 2 sin cambios, nada que confirmar', /2 sin cambios/.test(txt) && /No hay nada que importar/.test(txt), '', await shot(page, 'p05-390-reimportacion-productos'));
    check('390 px: sin desplazamiento horizontal de la página', overflow <= 0, `exceso ${overflow}px`);
    await page.getByRole('button', { name: 'Descartar carga' }).click();
    await ctx.close();
  }
  // 3) Supervisión: import:manage sin product:manage
  {
    const { ctx, page } = await loginAs('supervisor.cooperativa');
    await page.goto(url);
    await page.getByRole('heading', { name: '¿Qué quieres importar?' }).waitFor({ timeout: 15000 });
    const radio = page.getByRole('radio', { name: /^Productos/ });
    const disabled = await radio.isDisabled();
    const explained = await page.getByText(/tu rol no gestiona productos/).isVisible();
    const st = await page.evaluate(async ({ api, org }) => {
      const t = Object.keys(localStorage).map((k) => localStorage.getItem(k)).find((v) => v && v.split('.').length === 3) ?? Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k)).find((v) => v && v.split('.').length === 3);
      return (await fetch(`${api}/api/v1/organizations/${org}/imports/templates/products`, { headers: { authorization: `Bearer ${t}` } })).status;
    }, { api: API, org: coop });
    check('supervisión: Productos deshabilitado con explicación y la API responde 403', disabled && explained && st === 403, `radio deshabilitado=${disabled}, API=${st}`, await shot(page, 'p06-supervision-sin-gestion-productos'));
    await ctx.close();
  }
} catch (e) {
  const cap = current ? await shot(current, 'p99-fallo').catch(() => null) : null;
  check('ejecución sin errores', false, String(e.message).split('\n').slice(0, 4).join(' | '), cap);
} finally {
  await browser.close();
  const ok = results.every((r) => r.ok);
  writeFileSync(join(outDir, 'revision-productos.json'), `${JSON.stringify({ fecha: new Date().toISOString(), base: BASE, entorno: 'DESARROLLO local (contenedores), datos DEMO y archivos sintéticos', ok, casos: results }, null, 2)}\n`);
  console.log(`Resultado: ${ok ? 'APROBADO' : 'FALLIDO'}`);
  process.exitCode = ok ? 0 : 1;
}
