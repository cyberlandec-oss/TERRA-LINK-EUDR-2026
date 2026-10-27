// Revisión visual por rol en navegador real, contra la aplicación de DESARROLLO levantada localmente.
//   node e2e/review/revision-por-rol.mjs [http://localhost:3000]
// Lee CREDENCIALES.csv (nunca imprime contraseñas), abre una sesión aislada por fila (usuario + organización
// + rol), recorre las rutas reales, registra resultados y guarda capturas de datos sintéticos en
// docs/qa/capturas/. Escribe docs/qa/revision-resultados.json. No modifica datos salvo lo indicado en
// cada tarea (solo lecturas y búsquedas).
import { chromium } from '@playwright/test';
import { reviewPlots } from './parcelas.mjs';
import { reviewGeoJson } from './geojson.mjs';
import { reviewGis } from './gis.mjs';
import { reviewProducts } from './productos.mjs';
import { reviewCte } from './cte.mjs';
import { reviewEvents } from './eventos.mjs';
import { reviewDocuments } from './documentos.mjs';
import { reviewEvidence } from './evidencias.mjs';
import { reviewAudit } from './auditoria.mjs';
import { reviewDeliveries } from './entregas.mjs';
import { reviewLots } from './lotes.mjs';
import { reviewInventory } from './inventario.mjs';
import { reviewRisk } from './riesgo.mjs';
import { reviewMitigations } from './mitigaciones.mjs';
import { reviewDueDiligence } from './diligencia.mjs';
import { reviewSatellite } from './satelite.mjs';
import { existsSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.argv[2] ?? 'http://localhost:3000';
const shots = join(root, 'docs', 'qa', 'capturas');
mkdirSync(shots, { recursive: true });

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

// El seed escribe el archivo completo en CREDENCIALES.csv o, si estaba abierto, en CREDENCIALES.pendiente.csv: se usa el más reciente.
const credFile = ['CREDENCIALES.csv', 'CREDENCIALES.pendiente.csv'].filter((f) => existsSync(join(root, f)))
  .sort((a, b) => statSync(join(root, b)).mtimeMs - statSync(join(root, a)).mtimeMs)[0];
const accounts = parseCsv(readFileSync(join(root, credFile), 'utf8'));
const DEMO_ORGS = [...new Set(accounts.map((a) => a.organizacion).filter((o) => o.startsWith('DEMO')))];
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const role = (r) => r.split(' ')[0];

// Tarea real permitida por rol y organización (lectura/búsqueda) con resultado esperado observable.
async function realTask(page, a, orgUrl) {
  const r = role(a.rol);
  const user = a.email.split('@')[0];
  if (r === 'SUPER_ADMIN') {
    await page.goto(`${BASE}/organizaciones`);
    await page.locator('tbody tr').first().waitFor({ timeout: 15000 });
    const rows = await page.locator('tbody tr').count();
    return { tarea: 'Listar organizaciones de la plataforma', resultado: `${rows} organizaciones visibles`, ok: rows >= 4 };
  }
  if (r === 'ORG_ADMIN') {
    await page.goto(`${orgUrl}/miembros`);
    await page.getByRole('list', { name: 'Miembros' }).waitFor({ timeout: 10000 });
    const n = await page.getByRole('list', { name: 'Miembros' }).getByRole('listitem').count();
    const canInvite = await page.getByRole('button', { name: 'Generar enlace de invitación' }).count();
    return { tarea: 'Consultar miembros y formulario de invitación', resultado: `${n} miembros; invitar ${canInvite ? 'disponible' : 'no disponible'}`, ok: n >= 1 && canInvite === 1 };
  }
  if (r === 'FIELD_TECHNICIAN' || (r === 'MANAGER' && a.organizacion.includes('Cooperativa'))) {
    await page.goto(`${orgUrl}/productores`);
    await page.getByRole('table', { name: 'Productores' }).waitFor({ timeout: 10000 });
    const n = await page.locator('tbody tr').count();
    const expected = { 'tecnico1.cooperativa': 5, 'tecnico2.cooperativa': 2 }[user] ?? 8;
    let extra = '';
    if (r === 'MANAGER') {
      await page.goto(`${orgUrl}/productores/coincidencias`);
      await page.getByRole('heading', { name: 'Posibles duplicados' }).waitFor();
      await page.getByRole('region', { name: /Caso / }).or(page.getByText('No hay casos en este estado.')).first().waitFor({ timeout: 15000 });
      const cases = await page.getByRole('region', { name: /Caso / }).count();
      extra = `; ${cases} caso(s) de posible duplicado pendientes`;
    }
    return { tarea: 'Listar productores (alcance por rol)', resultado: `${n} productores visibles (esperado ${expected})${extra}`, ok: n === expected };
  }
  if (r === 'AUDITOR') {
    await page.goto(`${orgUrl}/auditoria`);
    await page.getByRole('heading', { name: 'Registros' }).waitFor();
    await page.getByRole('table', { name: 'Registros de auditoría' }).or(page.getByText('Aún no hay registros a tu alcance.')).first().waitFor({ timeout: 15000 });
    const n = await page.getByRole('table', { name: 'Registros de auditoría' }).locator('tbody tr').count();
    return { tarea: 'Consultar la auditoría de su organización', resultado: `${n} registros visibles`, ok: n >= 1 };
  }
  if (r === 'TRACEABILITY_MANAGER' || r === 'EUDR_MANAGER') {
    await page.goto(`${orgUrl}/productores`);
    await page.getByRole('table', { name: 'Productores' }).or(page.getByText('Aún no hay productores registrados.')).first().waitFor({ timeout: 15000 });
    const table = await page.getByRole('table', { name: 'Productores' }).count();
    const empty = await page.getByText('Aún no hay productores registrados.').count();
    return { tarea: 'Consultar productores de su organización (solo lectura)', resultado: table ? 'tabla visible' : empty ? 'vacío autorizado (la organización no tiene productores)' : 'sin tabla', ok: table + empty > 0 };
  }
  // Roles sin módulo en esta etapa: la tarea es comprobar el estado explicado, no una operación inventada.
  await page.goto(orgUrl);
  await page.getByText('Pendiente de implementación').first().waitFor({ timeout: 15000 }).catch(() => undefined);
  const pending = await page.getByText('Pendiente de implementación').count();
  const info = await page.getByText('Tu rol todavía no tiene pantallas disponibles').count();
  return { tarea: 'Ver su espacio y capacidades pendientes rotuladas', resultado: `${pending} capacidad(es) pendientes rotuladas${info ? '; aviso de rol sin pantallas' : ''}`, ok: pending >= 1, pendiente: true };
}

// IDs reales de las organizaciones DEMO (cuenta de plataforma, vía API); sin imprimir credenciales.
const API = process.env.API_URL ?? 'http://localhost:4000';
const superAcc = accounts.find((a) => role(a.rol) === 'SUPER_ADMIN');
const superToken = (await (await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: superAcc.email, password: superAcc.contrasena }) })).json()).access_token;
const orgIdByName = Object.fromEntries((await (await fetch(`${API}/api/v1/organizations?scope=all`, { headers: { authorization: `Bearer ${superToken}` } })).json()).map((o) => [o.name, o.id]));

const results = [];
const browser = await chromium.launch();
try {
  // Accesibilidad básica de acceso: foco visible por teclado en el login.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.screenshot({ path: join(shots, 'acceso--login.png') });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      const st = el ? getComputedStyle(el) : null;
      return { id: el?.id ?? el?.tagName, outline: st ? `${st.outlineStyle} ${st.outlineWidth}` : '' };
    });
    results.push({ tipo: 'teclado-login', foco: focus, ok: focus.outline.startsWith('solid') });
    await ctx.close();
  }

  for (const a of accounts) {
    const r = role(a.rol);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'es-EC' });
    const page = await ctx.newPage();
    const entry = { cuenta: a.email, organizacion: a.organizacion, rol: a.rol, rutas: [], incidencias: [] };
    try {
      await page.goto(BASE);
      await page.getByLabel('Correo').fill(a.email);
      await page.getByLabel('Contraseña', { exact: true }).fill(a.contrasena);
      await page.getByRole('button', { name: 'Iniciar sesión' }).click();
      await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 15000 });
      entry.login = 'OK';
      let orgUrl = null;
      if (r !== 'SUPER_ADMIN') {
        await page.getByRole('link', { name: a.organizacion, exact: true }).click();
        await page.waitForURL(/\/organizaciones\/[0-9a-f-]{36}$/);
        orgUrl = page.url();
        await page.getByRole('heading', { level: 1 }).waitFor();
      } else {
        await page.getByRole('link', { name: DEMO_ORGS[0], exact: true }).click();
        await page.waitForURL(/\/organizaciones\/[0-9a-f-]{36}$/);
        orgUrl = page.url();
        await page.getByRole('heading', { level: 1 }).waitFor();
      }
      entry.contexto = (await page.getByTestId('contexto-usuario').innerText()).trim();
      entry.organizacion_activa = await page.locator('#org-switch option:checked').innerText();
      entry.navegacion = await page.locator('.tl-nav a').allInnerTexts();
      entry.titulo = await page.getByRole('heading', { level: 1 }).innerText();
      await page.screenshot({ path: join(shots, `${slug(a.email.split('@')[0])}--${slug(a.organizacion)}.png`), fullPage: true });

      // Rutas reales: estado obtenido (título o error) sin asumir permisos.
      for (const sub of ['', '/productores', '/productores/coincidencias', '/miembros', '/auditoria']) {
        await page.goto(`${orgUrl}${sub}`);
        await page.waitForLoadState('networkidle');
        const err = page.locator('.error[role="alert"] .alert-title');
        const h1 = page.getByRole('heading', { level: 1 });
        let estado;
        if (await err.count()) estado = `ERROR: ${await err.first().innerText()}`;
        else if (await h1.count()) estado = `OK: ${await h1.first().innerText()}`;
        else estado = 'SIN_TITULO';
        entry.rutas.push({ ruta: sub || '/', estado });
      }

      // Denegación coherente: otra organización DEMO de la que no es miembro.
      // Membresías reales desde la API (el CSV puede estar desactualizado si Excel lo tiene abierto).
      const tok = await page.evaluate(() => sessionStorage.getItem('tl_token'));
      const apiOrgs = r === 'SUPER_ADMIN' ? [] : await (await fetch(`${API}/api/v1/organizations`, { headers: { authorization: `Bearer ${tok}` } })).json().catch(() => []);
      const myOrgs = [...new Set([...accounts.filter((x) => x.email === a.email).map((x) => x.organizacion), ...(Array.isArray(apiOrgs) ? apiOrgs.map((o) => o.name) : [])])];
      const foreign = DEMO_ORGS.find((o) => !myOrgs.includes(o));
      if (r !== 'SUPER_ADMIN' && foreign && orgIdByName[foreign]) {
        await page.goto(`${BASE}/organizaciones/${orgIdByName[foreign]}`);
        await page.waitForLoadState('networkidle');
        const text = await page.locator('main').innerText();
        const denied = /no está disponible|no existe/i.test(text);
        entry.denegacion = { destino: foreign, resultado: denied ? 'Recurso no disponible; sin datos de la otra organización' : 'INESPERADO', ok: denied && !text.includes(foreign) };
        if (!entry.denegacion.ok) entry.incidencias.push('Acceso a otra organización no fue denegado de forma coherente');
      }
      if (r === 'SUPER_ADMIN') {
        await page.goto(`${orgUrl}/auditoria`);
        await page.waitForLoadState('networkidle');
        const text = await page.locator('main').innerText();
        entry.denegacion = { destino: 'auditoría de una organización sin membresía', resultado: /No tienes permiso/.test(text) ? 'Denegado (sin elevación, D-04)' : 'INESPERADO', ok: /No tienes permiso/.test(text) };
        if (!entry.denegacion.ok) entry.incidencias.push('SUPER_ADMIN accede a auditoría de tenant');
      }
      entry.org_url = orgUrl;

      // Ausencia de datos ajenos en las pantallas propias.
      await page.goto(orgUrl);
      await page.waitForLoadState('networkidle');
      const body = await page.locator('body').innerText();
      if (r !== 'SUPER_ADMIN') {
        const leaked = DEMO_ORGS.filter((o) => !myOrgs.includes(o) && body.includes(o));
        entry.datos_ajenos = leaked.length ? `VISIBLES: ${leaked.join(', ')}` : 'ninguno';
        if (leaked.length) entry.incidencias.push('Nombres de otras organizaciones visibles');
      } else entry.datos_ajenos = 'n/a (plataforma ve metadatos de organizaciones por diseño)';

      entry.tarea = await realTask(page, a, orgUrl);
      if (a.email.startsWith('admin.cooperativa')) {
        await page.goto(`${orgUrl}/productores`);
        await page.getByRole('table', { name: 'Productores' }).waitFor();
        await page.screenshot({ path: join(shots, 'admin-cooperativa--productores.png'), fullPage: true });
        await page.goto(`${orgUrl}/productores/coincidencias`);
        await page.getByRole('region', { name: /Caso / }).first().waitFor();
        await page.screenshot({ path: join(shots, 'admin-cooperativa--coincidencias.png'), fullPage: true });
        await page.goto(`${orgUrl}/miembros`);
        await page.getByRole('list', { name: 'Miembros' }).waitFor();
        await page.screenshot({ path: join(shots, 'admin-cooperativa--miembros.png'), fullPage: true });
      }
      if (!entry.tarea.ok) entry.incidencias.push(`Tarea: ${entry.tarea.resultado}`);
    } catch (err) {
      entry.incidencias.push(`Fallo del recorrido: ${String(err.message ?? err).split('\n')[0]}`);
    }
    results.push(entry);
    await ctx.close();
  }

  // P0-006 Parcelas (módulo aparte).
  results.push(await reviewPlots({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewGeoJson({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewGis({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewProducts({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewCte({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewEvents({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewDocuments({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewEvidence({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewAudit({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewDeliveries({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewLots({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewInventory({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewRisk({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewMitigations({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewDueDiligence({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));
  results.push(await reviewSatellite({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }));

  // Adaptación móvil (390 px): menú en panel y contenido legible.
  for (const a of accounts.filter((x) => ['tecnico1.cooperativa', 'admin.cooperativa'].includes(x.email.split('@')[0]))) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.getByLabel('Correo').fill(a.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(a.contrasena);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.getByRole('link', { name: a.organizacion, exact: true }).click();
    await page.getByRole('heading', { level: 1 }).waitFor();
    const toggle = page.getByRole('button', { name: 'Menú' });
    const sidebarHidden = !(await page.locator('.tl-sidebar').isVisible());
    await toggle.click();
    const sidebarShown = await page.locator('.tl-sidebar').isVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const brandVisible = await page.evaluate(() => {
      const b = document.querySelector('.tl-brand');
      const st = b ? getComputedStyle(b) : null;
      return !!st && st.color !== getComputedStyle(document.querySelector('.tl-sidebar')).backgroundColor;
    });
    await page.screenshot({ path: join(shots, `movil--${slug(a.email.split('@')[0])}.png`) });
    await page.locator('.tl-sidebar').getByRole('button', { name: 'Cerrar menú' }).click();
    const closesFromPanel = !(await page.locator('.tl-sidebar').isVisible());
    await toggle.click();
    await page.keyboard.press('Escape');
    const closesWithEscape = !(await page.locator('.tl-sidebar').isVisible());
    results.push({ tipo: 'movil-390', cuenta: a.email, menu_oculto_inicial: sidebarHidden, menu_abre: sidebarShown, marca_visible: brandVisible,
      cierra_desde_panel: closesFromPanel, cierra_con_escape: closesWithEscape, desborde_horizontal: overflow,
      ok: sidebarHidden && sidebarShown && !overflow && brandVisible && closesFromPanel && closesWithEscape });
    await ctx.close();
  }
} finally {
  await browser.close();
}

writeFileSync(join(root, 'docs', 'qa', 'revision-resultados.json'), JSON.stringify({ fecha: new Date().toISOString(), base: BASE, resultados: results }, null, 2));
const issues = results.filter((r) => (r.incidencias?.length ?? 0) > 0 || r.ok === false);
for (const c of results.find((r) => r.tipo === 'parcelas')?.casos ?? []) console.log(` [parcelas] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'geojson')?.casos ?? []) console.log(` [geojson] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'gis')?.casos ?? []) console.log(` [gis] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'productos')?.casos ?? []) console.log(` [productos] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'cte')?.casos ?? []) console.log(` [cte] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'eventos')?.casos ?? []) console.log(` [eventos] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'documentos')?.casos ?? []) console.log(` [documentos] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'evidencias')?.casos ?? []) console.log(` [evidencias] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'mitigaciones')?.casos ?? []) console.log(` [mitigaciones] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'diligencia')?.casos ?? []) console.log(` [diligencia] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'riesgo')?.casos ?? []) console.log(` [riesgo] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'inventario')?.casos ?? []) console.log(` [inventario] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'lotes')?.casos ?? []) console.log(` [lotes] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'entregas')?.casos ?? []) console.log(` [entregas] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
for (const c of results.find((r) => r.tipo === 'auditoria')?.casos ?? []) console.log(` [auditoria] ${c.ok ? 'OK   ' : 'FALLA'} ${c.cuenta}: ${c.resultado}`);
console.log(`Revisión: ${results.length} entradas; con incidencias: ${issues.length}`);
for (const i of issues) console.log(` - ${i.cuenta ?? i.tipo} @ ${i.organizacion ?? ''}: ${(i.incidencias ?? []).join(' | ') || JSON.stringify(i)}`);
