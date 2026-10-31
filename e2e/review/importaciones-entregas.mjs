// Revisión visual P0-026 plantilla ENTREGAS_V1 en navegador real, contra la aplicación de DESARROLLO local.
//   npm run build -w apps/api && node e2e/review/importaciones-entregas.mjs [http://localhost:3000]
// Archivos SINTÉTICOS (no son datos reales de una asociación). Cuentas DEMO de CREDENCIALES.csv (nunca imprime contraseñas).
// - Administración (1280 px): elige «Entregas», ve que solo crea borradores; archivo con errores (entrega registrada con
//   otro peso, productor de baja, unidad LB, periodo sin precisión, fila sin referencia): no confirmable; archivo válido con
//   REFERENCIAS DEMO-REF-C/D (dos filas con las mismas notas: dos entregas) confirmado SOLO CON TECLADO.
//   Comprueba en la base que no se crean recepciones, pesajes, muestras, movimientos de inventario ni eventos de entrega.
// - Administración a 390 px: reimportación = «ya importada», sin desplazamiento horizontal.
// - Supervisión (MANAGER, autorizado): opción habilitada.
// - Recepción (tiene delivery:create pero no import:manage) y técnico: sin menú y denegación en la URL directa.
// Evidencia: docs/qa/importacion/revision-entregas.json y docs/qa/capturas/importacion/en*.png.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
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
const psql = (q) => execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', `psql -U "$POSTGRES_USER" -d terra_link -tAc "${q.replace(/"/g, '\\"')}"`], { cwd: root, encoding: 'utf8' }).trim();

const credFile = ['CREDENCIALES.csv', 'CREDENCIALES.pendiente.csv'].filter((f) => existsSync(join(root, f)))
  .sort((a, b) => statSync(join(root, b)).mtimeMs - statSync(join(root, a)).mtimeMs)[0];
const lines = readFileSync(join(root, credFile), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split(','));
const head = lines.shift();
const acc = (local) => { const r = lines.find((x) => x[head.indexOf('email')].startsWith(`${local}@`)); return { email: r[head.indexOf('email')], password: r[head.indexOf('contrasena')] }; };

const HEAD = ['codigo_entrega', 'codigo_productor', 'codigo_producto', 'codigo_centro', 'fecha_entrega', 'cantidad_declarada', 'unidad', 'periodo_precision', 'periodo_inicio', 'periodo_fin', 'parcelas_origen', 'notas', 'referencia_importacion'];
const valid = writeXlsx([{ name: 'entregas', rows: [HEAD,
  ['', 'DEMO-RV-008', 'CACAO_SECO', 'DEMO-CA-01', '2026-10-05', '180.5', 'KG', 'MONTH', '2026-09', '', 'DEMO-IMP-PAR-001:100;DEMO-IMP-PAR-002', 'Entrega importada (demo) C', 'DEMO-REF-C'],
  ['', 'DEMO-RV-008', '', '', '', '', '', 'UNKNOWN', '', '', '', 'Entrega importada (demo) C', 'DEMO-REF-D'],
] }]);
const withErrors = writeXlsx([{ name: 'entregas', rows: [HEAD,
  ['ENT-2026-00001', '', '', '', '', '999', 'KG', '', '', '', '', ''],
  ['', 'DEMO-RV-007', '', '', '', '', '', '', '', '', '', 'productor de baja', 'DEMO-REF-E1'],
  ['', 'DEMO-RV-008', '', '', '', '100', 'LB', '', '', '', '', 'unidad en libras', 'DEMO-REF-E2'],
  ['', 'DEMO-RV-008', '', '', '', '', '', '', '2026-08', '', '', 'periodo sin precisión', 'DEMO-REF-E3'],
  ['', 'DEMO-RV-008', '', '', '', '', '', '', '', '', '', 'sin referencia', ''],
] }]);
const tmp = (name, buf) => { const f = join(tmpdir(), name); writeFileSync(f, buf); return f; };
const validFile = tmp('demo-importacion-entregas.xlsx', valid);
const errorFile = tmp('demo-importacion-entregas-con-errores.xlsx', withErrors);

const results = [];
const check = (caso, ok, detalle = '', captura = null) => { results.push({ caso, ok, detalle, captura }); console.log(`${ok ? 'OK   ' : 'FALLA'} ${caso}${detalle ? `: ${detalle}` : ''}`); };
const shot = async (page, name) => { const f = join(shots, `${name}.png`); await page.screenshot({ path: f, fullPage: true }); return `docs/qa/capturas/importacion/${name}.png`; };

const token = (await (await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(acc('admin.cooperativa')) })).json()).access_token;
const coop = (await (await fetch(`${API}/api/v1/organizations`, { headers: { authorization: `Bearer ${token}` } })).json()).find((o) => o.name.includes('Cooperativa')).id;
const url = `${BASE}/organizaciones/${coop}/importaciones`;
const physical = () => psql(`SELECT (SELECT count(*) FROM receptions WHERE organization_id='${coop}') || '/' || (SELECT count(*) FROM weighings WHERE organization_id='${coop}') || '/' || (SELECT count(*) FROM quality_samples WHERE organization_id='${coop}') || '/' || (SELECT count(*) FROM stock_movements WHERE organization_id='${coop}') || '/' || (SELECT count(*) FROM domain_events WHERE organization_id='${coop}' AND event_type LIKE 'Delivery%') || '/' || (SELECT count(*) FROM gate_evaluations WHERE organization_id='${coop}')`);

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
async function chooseDeliveries(page) {
  await page.goto(url);
  await page.getByRole('heading', { name: '¿Qué quieres importar?' }).waitFor({ timeout: 15000 });
  await page.getByRole('radio', { name: /^Entregas/ }).check();
  await page.getByText('Plantilla ENTREGAS_V1').waitFor({ timeout: 15000 });
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
    await chooseDeliveries(page);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar plantilla (.xlsx)' }).click();
    const d = await dl;
    const body0 = await page.locator('main').innerText();
    check('admin: elige Entregas, descarga su plantilla y ve que solo crea borradores', /plantilla-entregas_v1\.xlsx/.test(d.suggestedFilename()) && /solo crea o actualiza BORRADORES/.test(body0), d.suggestedFilename(), await shot(page, 'en01-admin-plantilla-entregas'));

    await uploadAndMap(page, errorFile);
    const body = await page.locator('main').innerText();
    const noCommit = !(await page.getByRole('button', { name: 'Confirmar importación' }).count());
    check('admin: registrada con otro peso, productor de baja, unidad LB, periodo sin precisión y fila sin referencia son errores; no confirmable',
      /5 con error/.test(body) && /ni referencia de importación/.test(body) && /está registrada/.test(body) && /no está activo/.test(body) && /solo KG/.test(body) && /precisión del periodo/.test(body) && noCommit, '', await shot(page, 'en02-admin-errores-entregas'));
    await page.getByRole('button', { name: 'Descartar carga' }).click();
    await page.getByRole('heading', { name: '3. Mapeo de columnas' }).waitFor({ state: 'detached', timeout: 15000 });

    const before = physical();
    await uploadAndMap(page, validFile);
    const pv = await page.locator('main').innerText();
    const fresh = /2 nuevas/.test(pv);
    check('admin: vista previa válida (sin guardar)', fresh || /2 sin cambios/.test(pv), fresh ? '2 nuevas' : 'reimportación: 2 sin cambios', await shot(page, 'en03-admin-vista-previa-entregas'));
    if (fresh) {
      await page.getByRole('checkbox').focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement?.textContent);
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: '6. Resultado' }).waitFor({ timeout: 15000 });
      check('admin: confirmación con teclado → 2 borradores creados', /Creados 2 \(estado borrador\)/.test(await page.locator('main').innerText()), `foco en «${focused}»`, await shot(page, 'en04-admin-resultado-entregas'));
      const drafts = psql(`SELECT string_agg(delivery_code || ':' || status, ',' ORDER BY delivery_code) FROM deliveries WHERE organization_id='${coop}' AND notes = 'Entrega importada (demo) C'`);
      check('base: borradores creados y ningún efecto físico ni evento de entrega', /DRAFT/.test(drafts) && !/REGISTERED/.test(drafts) && physical() === before, `${drafts} · recepciones/pesajes/muestras/inventario/eventos/compuertas ${before} → ${physical()}`);
    } else {
      check('admin: confirmación con teclado (no aplicable: ya importado en una ejecución anterior)', true, 'ver reimportación');
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await loginAs('admin.cooperativa', { width: 390, height: 844 });
    await chooseDeliveries(page);
    await uploadAndMap(page, validFile);
    const txt = await page.locator('main').innerText();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('390 px: reimportación por referencia = 2 sin cambios, nada que confirmar', /2 sin cambios/.test(txt) && /ya se importó como/.test(txt) && /No hay nada que importar/.test(txt), '', await shot(page, 'en05-390-reimportacion-entregas'));
    check('390 px: sin desplazamiento horizontal de la página', overflow <= 0, `exceso ${overflow}px`);
    await page.getByRole('button', { name: 'Descartar carga' }).click();
    await ctx.close();
  }
  {
    const { ctx, page } = await loginAs('supervisor.cooperativa');
    await chooseDeliveries(page);
    check('supervisión (MANAGER): Entregas habilitada', true, '', await shot(page, 'en06-supervision-entregas'));
    await ctx.close();
  }
  for (const [local, label, n] of [['recepcion.acopio', 'recepción', 'en07'], ['tecnico1.cooperativa', 'técnico de campo', 'en08']]) {
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
  const cap = current ? await shot(current, 'en99-fallo').catch(() => null) : null;
  check('ejecución sin errores', false, String(e.message).split('\n').slice(0, 4).join(' | '), cap);
} finally {
  await browser.close();
  const ok = results.every((r) => r.ok);
  writeFileSync(join(outDir, 'revision-entregas.json'), `${JSON.stringify({ fecha: new Date().toISOString(), base: BASE, entorno: 'DESARROLLO local (contenedores), datos DEMO y archivos sintéticos', ok, casos: results }, null, 2)}\n`);
  console.log(`Resultado: ${ok ? 'APROBADO' : 'FALLIDO'}`);
  process.exitCode = ok ? 0 : 1;
}
