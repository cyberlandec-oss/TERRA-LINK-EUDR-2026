// P0-027 (QA-14): estados de presentación separados en navegador real — carga, error con reintento, vacío y sin permiso —
// en «Mi trabajo» y en las secciones del Lot Hub. La red se intercepta (respuesta lenta o 500) solo en el navegador de la
// prueba: el servidor no se modifica.
//   node e2e/review/estados-web.mjs [http://localhost:3000]
// Evidencia: docs/qa/web-por-rol/estados.json y docs/qa/capturas/web-por-rol/estado-*.png.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const BASE = process.argv[2] ?? 'http://localhost:3000';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const shots = join(root, 'docs', 'qa', 'capturas', 'web-por-rol');
mkdirSync(shots, { recursive: true });
const credFile = ['CREDENCIALES.csv', 'CREDENCIALES.pendiente.csv'].filter((f) => existsSync(join(root, f))).sort((a, b) => statSync(join(root, b)).mtimeMs - statSync(join(root, a)).mtimeMs)[0];
const lines = readFileSync(join(root, credFile), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split(','));
const head = lines.shift();
const acc = (local) => { const r = lines.find((x) => x[head.indexOf('email')].startsWith(`${local}@`)); return { email: r[head.indexOf('email')], password: r[head.indexOf('contrasena')] }; };
const token = (await (await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(acc('admin.cooperativa')) })).json()).access_token;
const coop = (await (await fetch(`${API}/api/v1/organizations`, { headers: { authorization: `Bearer ${token}` } })).json()).find((o) => o.name.includes('Cooperativa')).id;
const lots = await (await fetch(`${API}/api/v1/organizations/${coop}/lots`, { headers: { authorization: `Bearer ${token}` } })).json();
const lot = (lots.items ?? lots)[0];

const results = [];
const check = (caso, ok, detalle = '', captura = null) => { results.push({ caso, ok, detalle, captura }); console.log(`${ok ? 'OK   ' : 'FALLA'} ${caso}${detalle ? `: ${detalle}` : ''}`); };
const shot = async (page, name) => { const f = join(shots, `estado-${name}.png`); await page.screenshot({ path: f, fullPage: true }); return `docs/qa/capturas/web-por-rol/estado-${name}.png`; };
const browser = await chromium.launch();
async function loginAs(local) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'es-EC' });
  const page = await ctx.newPage();
  await page.goto(BASE);
  const a = acc(local);
  await page.getByLabel('Correo').fill(a.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 15000 });
  return { ctx, page };
}

try {
  {
    const { ctx, page } = await loginAs('admin.cooperativa');
    // Carga: respuesta retenida → «Cargando tus pendientes…» con role=status.
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route('**/my-work', async (route) => { await held; await route.fallback().catch(() => undefined); });
    await page.goto(`${BASE}/organizaciones/${coop}`);
    const loading = page.locator('section[aria-labelledby="mi-trabajo"] [role="status"]');
    await loading.waitFor({ timeout: 15000 });
    check('carga: «Mi trabajo» muestra estado de carga accesible (role=status) sin cifras', /Cargando tus pendientes/.test(await loading.innerText()), '', await shot(page, 'carga'));
    release();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    // Error: 500 → panel de error (role=alert) con «Reintentar»; el reintento recupera la sección.
    let fail = true;
    await page.route('**/my-work', (route) => (fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Error simulado en la prueba.', request_id: 'prueba' } }) }) : route.fallback()));
    await page.reload();
    const alert = page.locator('section[aria-labelledby="mi-trabajo"] [role="alert"]');
    await alert.waitFor({ timeout: 15000 });
    const retry = alert.getByRole('button', { name: /Reintentar/ });
    const hasRetry = (await retry.count()) > 0;
    check('error: «Mi trabajo» muestra error accesible (role=alert) con reintento, distinto de vacío', hasRetry && !/No tienes pendientes/.test(await page.locator('main').innerText()), '', await shot(page, 'error'));
    fail = false;
    if (hasRetry) await retry.click();
    await page.locator('section[aria-labelledby="mi-trabajo"] table tbody tr').first().waitFor({ timeout: 15000 });
    check('reintento: la sección se recupera sin recargar la página', true);
    // Error aislado en una sección del Lot Hub: el resto del lote sigue visible.
    await page.route('**/mitigations?lot_id=*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Error simulado en la prueba.', request_id: 'prueba' } }) }));
    await page.goto(`${BASE}/organizaciones/${coop}/lotes/${lot.id}`);
    await page.getByRole('heading', { name: 'Riesgo y debida diligencia' }).waitFor({ timeout: 15000 });
    await page.locator('section[aria-labelledby="lt-risk"] [role="alert"]').waitFor({ timeout: 15000 });
    const resumen = await page.getByRole('heading', { name: 'Resumen' }).isVisible();
    check('Lot Hub: un error en Mitigaciones se muestra en esa sección; el resumen y las demás siguen visibles', resumen, '', await shot(page, 'error-seccion-hub'));
    await ctx.close();
  }
  {
    // Vacío autorizado frente a sin permiso.
    const { ctx, page } = await loginAs('auditor.cooperativa');
    await page.goto(`${BASE}/organizaciones/${coop}`);
    await page.getByText(/No tienes pendientes en esta organización/).waitFor({ timeout: 15000 });
    check('vacío: el auditor ve «No tienes pendientes», no un error ni cifras', true, '', await shot(page, 'vacio'));
    await page.goto(`${BASE}/organizaciones/${coop}/importaciones`);
    await page.locator('main [role="alert"]').waitFor({ timeout: 15000 });
    check('sin permiso: la importación responde «Tu rol no permite…» (no «sin registros»)', /Tu rol no permite importar datos/.test(await page.locator('main').innerText()), '', await shot(page, 'sin-permiso'));
    await ctx.close();
  }
} catch (e) {
  check('ejecución sin errores', false, String(e.message).split('\n').slice(0, 3).join(' | '));
} finally {
  await browser.close();
  const ok = results.every((r) => r.ok);
  writeFileSync(join(root, 'docs', 'qa', 'web-por-rol', 'estados.json'), `${JSON.stringify({ fecha: new Date().toISOString(), base: BASE, ok, casos: results }, null, 2)}\n`);
  console.log(`Resultado: ${ok ? 'APROBADO' : 'FALLIDO'}`);
  process.exitCode = ok ? 0 : 1;
}
