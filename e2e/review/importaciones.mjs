// Revisión visual P0-026 UI-19 Importación Excel en navegador real, contra la aplicación de DESARROLLO local.
//   npm run build -w apps/api && node e2e/review/importaciones.mjs [http://localhost:3000]
// Cuentas DEMO de CREDENCIALES.csv (nunca imprime contraseñas). Casos:
// - Administración de la cooperativa (1280 px): plantilla, archivo con errores (no confirmable, se descarta), archivo
//   válido confirmado SOLO CON TECLADO. Crea productores en BORRADOR con códigos DEMO-IMP-* (datos sintéticos).
// - Administración a 390 px: reimportación del mismo archivo → «sin cambios», sin desplazamiento horizontal.
// - Supervisión (MANAGER, rol autorizado): ve el menú y la plantilla.
// - Técnico de campo (rol denegado): sin entrada de menú y la URL directa explica la denegación.
// Evidencia: docs/qa/importacion/revision.json y docs/qa/capturas/importacion/*.png.
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

const HEAD = ['codigo_productor', 'nombres', 'apellidos', 'razon_social', 'comunidad', 'provincia', 'observaciones'];
const valid = writeXlsx([{ name: 'productores', rows: [HEAD,
  ['DEMO-IMP-001', 'Marta', 'Quiroz (demo)', '', 'San Pablo', 'Manabí', 'columna sin mapear'],
  ['DEMO-IMP-002', '', '', 'Asociación Las Palmas (demo)', '', 'Esmeraldas', ''],
] }]);
const withErrors = writeXlsx([{ name: 'productores', rows: [HEAD,
  ['DEMO-IMP-010', 'Pedro', '', '', '', '', 'falta apellido'],
  ['código inválido!', 'Ana', 'Ruiz (demo)', '', '', '', ''],
  ['DEMO-IMP-011', 'Luz', 'Mora (demo)', '', '', '', ''],
  ['DEMO-IMP-011', 'Luz', 'Mora (demo)', '', '', '', 'repetida'],
] }]);
const tmp = (name, buf) => { const f = join(tmpdir(), name); writeFileSync(f, buf); return f; };
const validFile = tmp('demo-importacion-productores.xlsx', valid);
const errorFile = tmp('demo-importacion-con-errores.xlsx', withErrors);

const results = [];
const check = (caso, ok, detalle = '', captura = null) => { results.push({ caso, ok, detalle, captura }); console.log(`${ok ? 'OK   ' : 'FALLA'} ${caso}${detalle ? `: ${detalle}` : ''}`); };
const shot = async (page, name) => { const f = join(shots, `${name}.png`); await page.screenshot({ path: f, fullPage: true }); return `docs/qa/capturas/importacion/${name}.png`; };

const token = (await (await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(acc('admin.cooperativa')) })).json()).access_token;
const coop = (await (await fetch(`${API}/api/v1/organizations`, { headers: { authorization: `Bearer ${token}` } })).json()).find((o) => o.name.includes('Cooperativa')).id;
const url = `${BASE}/organizaciones/${coop}/importaciones`;

const browser = await chromium.launch();
async function loginAs(local, viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport, locale: 'es-EC', acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(BASE);
  const a = acc(local);
  await page.getByLabel('Correo').fill(a.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 15000 });
  return { ctx, page };
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
    await page.goto(`${BASE}/organizaciones/${coop}`);
    check('admin: entrada de menú «Importar datos (Excel)»', await page.getByRole('link', { name: 'Importar datos (Excel)' }).waitFor({ timeout: 15000 }).then(() => true, () => false));
    await page.goto(url);
    await page.getByRole('heading', { name: '1. Plantilla' }).waitFor({ timeout: 15000 });
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar plantilla (.xlsx)' }).click();
    const d = await dl;
    check('admin: descarga la plantilla', /plantilla-productores_v1\.xlsx/.test(d.suggestedFilename()), d.suggestedFilename(), await shot(page, '01-admin-plantilla'));

    await uploadAndMap(page, errorFile);
    const ignored = await page.getByLabel('Campo para la columna G').inputValue();
    check('admin: columna sin equivalente queda «No importar»', ignored === '', `columna G = '${ignored}'`);
    const body = await page.locator('main').innerText();
    const noCommit = !(await page.getByRole('button', { name: 'Confirmar importación' }).count());
    check('admin: archivo con errores muestra errores por fila y no se puede confirmar', /4 con error/.test(body) && /repetido/i.test(body) && noCommit, '', await shot(page, '02-admin-errores-por-fila'));
    await page.getByRole('button', { name: 'Descartar carga' }).click();
    await page.getByRole('heading', { name: '3. Mapeo de columnas' }).waitFor({ state: 'detached', timeout: 15000 });

    await uploadAndMap(page, validFile);
    const pv = await page.locator('main').innerText();
    const fresh = /2 nuevas/.test(pv);
    const reimport = /2 sin cambios/.test(pv);
    check('admin: vista previa del archivo válido (sin guardar)', fresh || reimport, fresh ? '2 nuevas' : 'reimportación: 2 sin cambios', await shot(page, '03-admin-vista-previa'));
    if (fresh) {
      // Confirmación solo con teclado: foco a la casilla, Espacio, Tab al botón, Enter.
      await page.getByRole('checkbox').focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement?.textContent);
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: '6. Resultado' }).waitFor({ timeout: 15000 });
      check('admin: confirmación con teclado → resultado (creados en borrador)', /Creados 2 \(en borrador\)/.test(await page.locator('main').innerText()), `foco en «${focused}»`, await shot(page, '04-admin-resultado'));
    } else {
      check('admin: confirmación con teclado (no aplicable: ya importado en una ejecución anterior)', true, 'ver reimportación');
    }
    await ctx.close();
  }
  // 2) Administración, 390 px: reimportación sin cambios
  {
    const { ctx, page } = await loginAs('admin.cooperativa', { width: 390, height: 844 });
    await page.goto(url);
    await page.getByRole('heading', { name: '1. Plantilla' }).waitFor({ timeout: 15000 });
    await uploadAndMap(page, validFile);
    const txt = await page.locator('main').innerText();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('390 px: reimportación del mismo archivo = 2 sin cambios, nada que confirmar', /2 sin cambios/.test(txt) && /No hay nada que importar/.test(txt), '', await shot(page, '05-390-reimportacion-sin-cambios'));
    check('390 px: sin desplazamiento horizontal de la página', overflow <= 0, `exceso ${overflow}px`);
    await page.getByRole('button', { name: 'Descartar carga' }).click();
    await ctx.close();
  }
  // 3) Supervisión (rol autorizado)
  {
    const { ctx, page } = await loginAs('supervisor.cooperativa');
    await page.goto(`${BASE}/organizaciones/${coop}`);
    const nav = await page.getByRole('link', { name: 'Importar datos (Excel)' }).waitFor({ timeout: 15000 }).then(() => true, () => false);
    await page.goto(url);
    await page.getByRole('heading', { name: '1. Plantilla' }).waitFor({ timeout: 15000 });
    check('supervisión (MANAGER): menú y plantilla disponibles', nav, '', await shot(page, '06-supervision-autorizado'));
    await ctx.close();
  }
  // 4) Técnico de campo (rol denegado)
  {
    const { ctx, page } = await loginAs('tecnico1.cooperativa');
    await page.goto(`${BASE}/organizaciones/${coop}`);
    await page.waitForLoadState('networkidle');
    const nav = await page.getByRole('link', { name: 'Importar datos (Excel)' }).count();
    await page.goto(url);
    await page.getByText(/Tu rol no permite importar datos/).waitFor({ timeout: 15000 });
    check('técnico: sin entrada de menú y denegación explicada en la URL directa', nav === 0, '', await shot(page, '07-tecnico-denegado'));
    await ctx.close();
  }
} catch (e) {
  check('ejecución sin errores', false, String(e.message).split('\n')[0]);
} finally {
  await browser.close();
  const ok = results.every((r) => r.ok);
  writeFileSync(join(outDir, 'revision.json'), `${JSON.stringify({ fecha: new Date().toISOString(), base: BASE, entorno: 'DESARROLLO local (contenedores), datos DEMO', ok, casos: results }, null, 2)}\n`);
  console.log(`Resultado: ${ok ? 'APROBADO' : 'FALLIDO'}`);
  process.exitCode = ok ? 0 : 1;
}
