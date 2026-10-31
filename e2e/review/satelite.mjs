// Revisión visual de la tarjeta de análisis satelital (P0-028) en navegador real, sobre la aplicación de
// DESARROLLO levantada localmente y datos DEMO sintéticos.
//
//   node e2e/review/satelite.mjs [http://localhost:3000]      (autónomo)
//   import { reviewSatellite } from './satelite.mjs'           (dentro de revision-por-rol.mjs)
//
// Comprueba lo que la API no puede demostrar: CÓMO SE VE la pantalla. Casos: administrador autorizado,
// auditor (lee, no encarga), técnico sin el permiso (la tarjeta NO existe: ausencia, no «sin datos»),
// estado de error, teclado y 390 px.
//
// NO habilita la fixture sintética ni las llamadas reales: el entorno de revisión muestra exactamente lo que hay,
// que hoy es «Whisp como ADAPTADOR DE DESARROLLO (D-09 parte A)», sin autorización para llamar al servicio real.
// La revisión solo lee; no encarga ningún análisis.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CARD = 'Análisis satelital';

export async function reviewSatellite({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
  const acc = (local, orgPart) => accounts.find((x) => x.email.startsWith(local) && x.organizacion.includes(orgPart));
  const coopId = orgIdByName[DEMO_ORGS.find((o) => o.includes('Cooperativa'))];
  const loginAs = async (a, viewport = { width: 1280, height: 860 }) => {
    const ctx = await browser.newContext({ viewport, locale: 'es-EC' });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.getByLabel('Correo').fill(a.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(a.contrasena);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 15000 });
    return { ctx, page };
  };
  const openPlot = async (page, code) => {
    await page.goto(`${BASE}/organizaciones/${coopId}/parcelas`);
    await page.getByRole('link', { name: new RegExp(code) }).click();
    await page.getByRole('heading', { name: new RegExp(code) }).waitFor();
    await page.waitForLoadState('networkidle');
    return page.getByRole('region', { name: CARD });
  };
  const casos = [];

  // 1) Administrador autorizado: ve la tarjeta y el estado real, sin proveedor y sin botones que el
  //    servidor fuese a rechazar.
  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa', 'Cooperativa'));
    const card = await openPlot(page, 'DEMO-PAR-001');
    const visible = await card.count();
    const text = visible ? await card.innerText() : '';
    const botones = visible ? await card.getByRole('button', { name: /Solicitar/ }).count() : 0;
    await page.screenshot({ path: join(shots, 'satelite--admin-adaptador-desarrollo.png'), fullPage: true });
    const ok = visible === 1 && botones === 0
      && /NO EVALUADO/.test(text)
      && /Adaptador en desarrollo: WHISP/.test(text)
      && /ADAPTADOR DE DESARROLLO/.test(text)
      && /D-09 parte A/.test(text)
      && /parte B/.test(text)
      && /no es una conclusión jurídica/.test(text)
      && /«Sin alertas» no equivale a «sin deforestación»/.test(text)
      && !/-79\.|-80\.|coordenad/i.test(text);
    casos.push({ cuenta: 'admin.cooperativa (ORG_ADMIN)', resultado: `tarjeta=${visible}; botones de solicitud=${botones}; estado=${/NO EVALUADO|Resultado disponible|Análisis en curso/.exec(text)?.[0]}; razón=«${/No se puede solicitar un análisis: ([^\n]+)/.exec(text)?.[1] ?? ''}»`, ok });
    await ctx.close();
  }

  // 2) Auditor: lee la tarjeta, pero encargar es otra facultad (y además no ve coordenadas).
  {
    const { ctx, page } = await loginAs(acc('auditor.cooperativa', 'Cooperativa'));
    const card = await openPlot(page, 'DEMO-PAR-001');
    const visible = await card.count();
    const text = visible ? await card.innerText() : '';
    const botones = visible ? await card.getByRole('button', { name: /Solicitar/ }).count() : 0;
    await page.screenshot({ path: join(shots, 'satelite--auditor-lee-no-encarga.png'), fullPage: true });
    const razon = /No se puede solicitar un análisis: ([^\n]+)/.exec(text)?.[1] ?? '';
    const ok = visible === 1 && botones === 0 && /Tu rol no encarga análisis satelitales/.test(razon) && !/-79\.|-80\./.test(text);
    casos.push({ cuenta: 'auditor.cooperativa (AUDITOR)', resultado: `tarjeta=${visible}; botones=${botones}; razón=«${razon}»; coordenadas en la tarjeta=${/-79\.|-80\./.test(text)}`, ok });
    await ctx.close();
  }

  // 3) Técnico de campo (sin satellite:read): la tarjeta NO EXISTE. No se sustituye por «sin datos» ni por
  //    una tarjeta vacía; el resto de la ficha sigue funcionando. Además, 390 px y sin desborde.
  {
    const { ctx, page } = await loginAs(acc('tecnico1.cooperativa', 'Cooperativa'), { width: 390, height: 844 });
    const card = await openPlot(page, 'DEMO-PAR-001');
    const visible = await card.count();
    const main = await page.locator('main').innerText();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: join(shots, 'satelite--tecnico-sin-permiso-390.png'), fullPage: true });
    // La única mención de «satelital» admisible aquí es el descargo de la tarjeta GIS («no incluye … análisis
    // satelital»), que es texto propio de P0-010. Lo que no debe aparecer es NINGÚN estado del análisis.
    const encabezado = await page.getByRole('heading', { name: CARD }).count();
    const estadoFiltrado = /proveedor satelital|NO EVALUADO|Solicitar:|D-09/i.test(main);
    const ok = visible === 0 && encabezado === 0 && !estadoFiltrado && !/sin datos/i.test(main) && !overflow && /Ubicación y superficie/.test(main);
    casos.push({ cuenta: 'tecnico1.cooperativa (FIELD_TECHNICIAN, 390 px)', resultado: `tarjeta=${visible} y encabezado=${encabezado} (esperado 0 y 0); estado satelital filtrado=${!estadoFiltrado}; «sin datos»=${/sin datos/i.test(main)}; desborde=${overflow}; resto de la ficha visible=${/Ubicación y superficie/.test(main)}`, ok });
    await ctx.close();
  }

  // 4) Estado de error: se interrumpe la respuesta del servidor para esta petición. Debe salir el panel de
  //    error con su acción de recuperación, no una tarjeta vacía ni un resultado inventado. El botón
  //    «Reintentar» se acciona CON TECLADO.
  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa', 'Cooperativa'), { width: 390, height: 844 });
    let fallos = 0;
    await page.route('**/plots/*/satellite', async (route) => {
      if (fallos === 0) { fallos++; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'HTTP_503', message: 'Servicio no disponible (simulado en la revisión).', request_id: null, details: [] } }) }); }
      return route.continue();
    });
    const card = await openPlot(page, 'DEMO-PAR-001');
    await card.getByRole('alert').waitFor({ timeout: 15000 });
    const conError = await card.innerText();
    // Se llega al botón con TABULADOR real (no con .focus()): solo así el navegador aplica :focus-visible y
    // la comprobación del contorno significa algo.
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    let enfocado = '';
    for (let i = 0; i < 40 && enfocado !== 'Reintentar'; i++) {
      await page.keyboard.press('Tab');
      enfocado = await page.evaluate(() => document.activeElement?.textContent ?? '');
    }
    const outline = await page.evaluate(() => {
      const cs = getComputedStyle(document.activeElement);
      return `${cs.outlineStyle}/${cs.outlineWidth}`;
    });
    await page.screenshot({ path: join(shots, 'satelite--error-reintentar-390.png'), fullPage: true });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    const recuperado = await card.innerText();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: join(shots, 'satelite--error-recuperado-390.png'), fullPage: true });
    const ok = /Servicio temporalmente no disponible/.test(conError) && enfocado === 'Reintentar' && !outline.startsWith('none')
      && /ADAPTADOR DE DESARROLLO/.test(recuperado) && !overflow;
    casos.push({ cuenta: 'admin.cooperativa (error 503, teclado, 390 px)', resultado: `panel de error=${/Servicio temporalmente no disponible/.test(conError)}; foco en «${enfocado}» con contorno ${outline}; tras Enter muestra el estado real=${/ADAPTADOR DE DESARROLLO/.test(recuperado)}; desborde=${overflow}`, ok });
    await ctx.close();
  }

  return { tipo: 'satelite', casos, ok: casos.every((c) => c.ok) };
}

// ---------------------------------------------------------------- ejecución autónoma

function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false; const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x)) rows.push(row); row = []; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const BASE = process.argv[2] ?? 'http://localhost:3000';
  const API = process.env.API_URL ?? 'http://localhost:4000';
  const shots = join(root, 'docs', 'qa', 'capturas');
  mkdirSync(shots, { recursive: true });
  const credFile = ['CREDENCIALES.csv', 'CREDENCIALES.pendiente.csv'].filter((f) => existsSync(join(root, f)))
    .sort((a, b) => statSync(join(root, b)).mtimeMs - statSync(join(root, a)).mtimeMs)[0];
  const accounts = parseCsv(readFileSync(join(root, credFile), 'utf8'));
  const DEMO_ORGS = [...new Set(accounts.map((a) => a.organizacion).filter((o) => o.startsWith('DEMO')))];
  const sup = accounts.find((a) => a.rol.startsWith('SUPER_ADMIN'));
  const token = (await (await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: sup.email, password: sup.contrasena }) })).json()).access_token;
  const orgIdByName = Object.fromEntries((await (await fetch(`${API}/api/v1/organizations?scope=all`, { headers: { authorization: `Bearer ${token}` } })).json()).map((o) => [o.name, o.id]));
  const browser = await chromium.launch();
  try {
    const r = await reviewSatellite({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots });
    writeFileSync(join(root, 'docs', 'qa', 'revision-satelite.json'), JSON.stringify(r, null, 2) + '\n');
    for (const c of r.casos) console.log(`${c.ok ? 'OK ' : 'REVISAR'} · ${c.cuenta}: ${c.resultado}`);
    console.log(r.ok ? 'Revisión satelital: todos los casos conformes.' : 'Revisión satelital: hay casos por revisar.');
    if (!r.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
