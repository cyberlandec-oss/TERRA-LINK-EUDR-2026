// Revisión P0-027 (RF-27, QA-14) en navegador real, contra la aplicación de DESARROLLO local, con TODAS las combinaciones
// cuenta–organización–rol DEMO de CREDENCIALES.csv (nunca imprime contraseñas) y la cuenta de plataforma.
//   node e2e/review/web-por-rol.mjs [http://localhost:3000]
// Por combinación: contexto (organización, usuario, roles), menú derivado de permisos efectivos (comparado con
// GET /me/permissions), «Mi trabajo» (comparado con GET my-work), Lot Hub de un lote de la Cooperativa (secciones según
// permiso, sin parcelas a quien no las lee), denegación dentro de la misma organización y entre organizaciones.
// Además: filtros conservados al volver de un detalle, teclado (enlace de salto y foco visible), 390 px, zoom 200 % y una
// acción real de «Mi trabajo»: capturar un punto (geolocalización SIMULADA del navegador de prueba) en una parcela DEMO
// importada que solo tiene superficie declarada; la superficie sola no retira la tarea, el punto sí.
// Evidencia: docs/qa/web-por-rol/matriz.json y docs/qa/capturas/web-por-rol/*.png.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const BASE = process.argv[2] ?? 'http://localhost:3000';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const shots = join(root, 'docs', 'qa', 'capturas', 'web-por-rol');
const outDir = join(root, 'docs', 'qa', 'web-por-rol');
mkdirSync(shots, { recursive: true });
mkdirSync(outDir, { recursive: true });

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
const credFile = ['CREDENCIALES.csv', 'CREDENCIALES.pendiente.csv'].filter((f) => existsSync(join(root, f))).sort((a, b) => statSync(join(root, b)).mtimeMs - statSync(join(root, a)).mtimeMs)[0];
const combos = parseCsv(readFileSync(join(root, credFile), 'utf8'));

const apiCall = async (path, token, init = {}) => { const r = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const tokens = new Map();
async function tokenOf(c) { if (!tokens.has(c.email)) tokens.set(c.email, (await apiCall('/api/v1/auth/login', null, { method: 'POST', body: JSON.stringify({ email: c.email, password: c.contrasena }) })).body.access_token); return tokens.get(c.email); }

const adminToken = await tokenOf(combos.find((c) => c.email.startsWith('admin.cooperativa@')));
const coopOrgs = (await apiCall('/api/v1/organizations', adminToken)).body;
const coop = coopOrgs.find((o) => o.name.includes('Cooperativa')).id;
const lots = (await apiCall(`/api/v1/organizations/${coop}/lots`, adminToken)).body;
const hubLot = (lots.items ?? lots).find((l) => l.source === 'RECEPTIONS') ?? (lots.items ?? lots)[0];

// Entradas de menú y permisos que las habilitan (misma regla que lib/workspace.tsx).
const NAV = [
  ['Productores', ['producer:read', 'producer:read_assigned', 'producer:read_own']], ['Parcelas', ['plot:read', 'plot:read_assigned', 'plot:read_own']], ['Entregas', ['delivery:read', 'delivery:read_assigned']],
  ['Lotes', ['lot:read']], ['Inventario', ['stock:read']], ['Riesgo', ['risk:read']], ['Mitigaciones', ['mitigation:read']], ['Debida diligencia', ['dd:read']],
  ['Auditoría', ['audit:read']], ['Importar datos (Excel)', ['import:manage']],
];

const browser = await chromium.launch();
const matrix = [];
const extra = [];
const check = (list, caso, ok, detalle = '', captura = null) => { list.push({ caso, ok, detalle, captura }); console.log(`${ok ? 'OK   ' : 'FALLA'} ${caso}${detalle ? `: ${detalle}` : ''}`); };
const shot = async (page, name) => { const f = join(shots, `${name}.png`); await page.screenshot({ path: f, fullPage: true }); return `docs/qa/capturas/web-por-rol/${name}.png`; };
async function session(c, viewport = { width: 1280, height: 860 }, extraCtx = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'es-EC', ...extraCtx });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByLabel('Correo').fill(c.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(c.contrasena);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 15000 });
  return { ctx, page };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

try {
  for (const c of combos) {
    const local = c.email.split('@')[0];
    const role = c.rol.split(' ')[0];
    const tk = await tokenOf(c);
    const myOrgs = (await apiCall('/api/v1/organizations', tk)).body ?? [];
    const org = role === 'SUPER_ADMIN' ? null : myOrgs.find((o) => o.name === c.organizacion) ?? null;
    const perms = org ? ((await apiCall('/api/v1/me/permissions', tk)).body.organizations.find((o) => o.organization_id === org.id)?.permissions ?? []) : [];
    const row = { cuenta: local, organizacion: c.organizacion, rol: role, permisos: perms.length, menu: null, contexto: null, mi_trabajo: null, lot_hub: null, denegacion_misma_org: null, denegacion_otra_org: null, captura: null };
    const { ctx, page } = await session(c);
    try {
      if (!org) {
        // SUPER_ADMIN: plataforma; en una organización no tiene acceso implícito a datos operativos.
        await page.goto(`${BASE}/organizaciones/${coop}/lotes`);
        await page.waitForLoadState('networkidle');
        const txt = await page.locator('main').innerText();
        row.denegacion_misma_org = /no permite|No tienes permiso/i.test(txt) ? 'lotes: denegado (sin elevación D-04)' : `INESPERADO: ${txt.slice(0, 80)}`;
        await page.goto(`${BASE}/organizaciones/${coop}`);
        await page.getByText(/Acceso a datos operativos de una organización/).waitFor({ timeout: 15000 });
        row.contexto = 'plataforma; limitación D-04 visible en la organización';
        row.captura = await shot(page, `${local}-plataforma`);
        check(matrix, `${local} (plataforma)`, !row.denegacion_misma_org.startsWith('INESPERADO'), row.denegacion_misma_org, row.captura);
        matrix[matrix.length - 1].fila = row;
        continue;
      }
      await page.goto(`${BASE}/organizaciones/${org.id}`);
      await page.getByTestId('contexto-usuario').waitFor({ timeout: 15000 });
      await page.waitForLoadState('networkidle');
      const ctxText = await page.getByTestId('contexto-usuario').innerText();
      const orgSel = await page.locator('#org-switch').inputValue().catch(() => '');
      row.contexto = ctxText.includes(c.email) && orgSel === org.id ? 'organización activa, usuario y roles visibles' : `INCOMPLETO: ${ctxText}`;
      // Menú derivado de permisos efectivos.
      const navBad = [];
      for (const [label, needs] of NAV) {
        const visible = (await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).count()) > 0;
        const expected = needs.some((p) => perms.includes(p));
        if (visible !== expected) navBad.push(`${label}: visible=${visible} esperado=${expected}`);
      }
      row.menu = navBad.length ? `DIFERENCIAS ${navBad.join('; ')}` : 'coincide con permisos efectivos';
      // Mi trabajo: mismas tareas que la API.
      const work = (await apiCall(`/api/v1/organizations/${org.id}/my-work`, tk)).body;
      await page.getByRole('heading', { name: 'Mi trabajo' }).waitFor({ timeout: 15000 });
      // P1-003: la portada lista una fila por TAREA CONCRETA (no por grupo), así que se compara con `rows`.
      const ui = await page.locator('section[aria-labelledby="mi-trabajo"] table tbody tr').count();
      row.mi_trabajo = ui === work.rows.length
        ? `${work.rows.length} fila(s) [personal ${work.queues.mine} · supervisión ${work.queues.supervision}]: ${work.tasks.map((t) => `${t.code}(${t.count})`).join(', ') || 'ninguna'}`
        : `DIFERENCIA ui=${ui} api=${work.rows.length}`;
      row.captura = await shot(page, `${local}-${slugOrg(c.organizacion)}-inicio`);
      // Lot Hub de la Cooperativa.
      await page.goto(`${BASE}/organizaciones/${coop}/lotes/${hubLot.id}`);
      await page.waitForLoadState('networkidle');
      const hub = await page.locator('main').innerText();
      if (org.id !== coop) {
        const member = myOrgs.some((o) => o.id === coop);
        row.denegacion_otra_org = !member ? (/no está disponible/.test(hub) && !hub.includes(hubLot.lot_code) ? 'lote de otra organización: «no disponible», sin datos' : `INESPERADO: ${hub.slice(0, 80)}`) : 'miembro también de la Cooperativa';
      } else if (!perms.includes('lot:read')) {
        row.lot_hub = /no permite consultar lotes/.test(hub) && !hub.includes(hubLot.lot_code) ? 'denegado por rol (sin lot:read), sin datos' : `INESPERADO: ${hub.slice(0, 80)}`;
        row.denegacion_misma_org = row.lot_hub;
      } else {
        await page.getByRole('heading', { name: 'Riesgo y debida diligencia' }).waitFor({ timeout: 15000 });
        await page.waitForLoadState('networkidle');
        const h2 = await page.locator('main').innerText();
        const issues = [];
        if (perms.includes('risk:read') === /no consulta evaluaciones de riesgo/.test(h2)) issues.push('riesgo');
        if (perms.includes('mitigation:read') === /no consulta mitigaciones/.test(h2)) issues.push('mitigaciones');
        if (perms.includes('dd:read') === /no consulta expedientes/.test(h2)) issues.push('expediente');
        if (perms.includes('evidence:read') === /no consulta evidencias/.test(h2)) issues.push('evidencias');
        const plotLinks = await page.locator('a[href*="/parcelas/"]').count();
        const readsPlots = perms.includes('plot:read') || perms.includes('plot:read_assigned');
        if (!readsPlots && plotLinks > 0) issues.push('parcelas visibles sin permiso');
        row.lot_hub = issues.length ? `DIFERENCIAS ${issues.join(', ')}` : `secciones según permiso; enlaces a parcelas: ${plotLinks}${readsPlots ? '' : ' (sin permiso de parcelas)'}`;
        row.captura_hub = await shot(page, `${local}-${slugOrg(c.organizacion)}-lot-hub`);
        // Denegación por rol dentro de la misma organización: la primera sección sin permiso explícita.
        const denied = NAV.find(([, needs]) => !needs.some((p) => perms.includes(p)));
        if (denied) {
          const path = { Productores: 'productores', Parcelas: 'parcelas', Entregas: 'entregas', Lotes: 'lotes', Inventario: 'inventario', Riesgo: 'riesgo', Mitigaciones: 'mitigaciones', 'Debida diligencia': 'diligencia', Auditoría: 'auditoria', 'Importar datos (Excel)': 'importaciones' }[denied[0]];
          await page.goto(`${BASE}/organizaciones/${coop}/${path}`);
          await page.waitForLoadState('networkidle');
          const t = await page.locator('main').innerText();
          const alert = await page.locator('main [role="alert"]').count();
          row.denegacion_misma_org = /no permite|No tienes permiso/i.test(t) && alert > 0 ? `${denied[0]}: denegado con mensaje accesible (role=alert)` : `INESPERADO en ${denied[0]}: ${t.slice(0, 80)}`;
        }
      }
      const bad = [row.contexto, row.menu, row.mi_trabajo, row.lot_hub, row.denegacion_misma_org, row.denegacion_otra_org].filter(Boolean).filter((x) => /INESPERADO|DIFERENCIA|INCOMPLETO/.test(x));
      check(matrix, `${local} · ${c.organizacion} · ${role}`, bad.length === 0, bad.join(' | ') || `${row.menu}; ${row.mi_trabajo}`, row.captura);
      matrix[matrix.length - 1].fila = row;
    } finally {
      await ctx.close();
    }
  }

  // Filtros conservados al volver desde un detalle (supervisión, entregas).
  {
    const c = combos.find((x) => x.email.startsWith('supervisor.cooperativa@'));
    const { ctx, page } = await session(c);
    await page.goto(`${BASE}/organizaciones/${coop}/entregas`);
    await page.getByLabel('Estado').selectOption('REGISTERED');
    await page.locator('table[aria-label="Entregas"] tbody a').first().waitFor({ timeout: 15000 });
    const urlWith = page.url();
    await page.locator('table[aria-label="Entregas"] tbody a').first().click();
    await page.waitForURL(/\/entregas\/[0-9a-f-]{36}/);
    await page.goBack();
    await page.getByLabel('Estado').waitFor();
    await page.waitForLoadState('networkidle');
    const kept = await page.getByLabel('Estado').inputValue();
    check(extra, 'filtros: volver desde el detalle conserva el filtro de entregas', kept === 'REGISTERED' && /status=REGISTERED/.test(urlWith), `URL ${urlWith.replace(BASE, '')} · filtro al volver=${kept}`);
    await ctx.close();
  }
  // Teclado, 390 px y zoom 200 % (administración de la Cooperativa).
  {
    const c = combos.find((x) => x.email.startsWith('admin.cooperativa@'));
    const { ctx, page } = await session(c);
    await page.goto(`${BASE}/organizaciones/${coop}`);
    await page.getByRole('heading', { name: 'Mi trabajo' }).waitFor({ timeout: 15000 });
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => ({ text: document.activeElement?.textContent, outline: getComputedStyle(document.activeElement).outlineStyle }));
    await page.keyboard.press('Enter');
    const focusMain = await page.evaluate(() => document.activeElement?.id);
    check(extra, 'teclado: el primer Tab llega a «Saltar al contenido» con foco visible y lleva al contenido', /Saltar al contenido/.test(first.text ?? '') && first.outline !== 'none' && focusMain === 'contenido', `foco=${first.text} contorno=${first.outline} destino=${focusMain}`);
    await ctx.close();
    for (const [label, vp] of [['390 px', { width: 390, height: 844 }], ['zoom 200 % (1280 px a 640 px CSS)', { width: 640, height: 430 }]]) {
      const s2 = await session(c, vp);
      for (const path of ['', `/lotes/${hubLot.id}`, '/entregas']) {
        await s2.page.goto(`${BASE}/organizaciones/${coop}${path}`);
        await s2.page.waitForLoadState('networkidle');
        await s2.page.waitForTimeout(500);
        const o = await overflow(s2.page);
        check(extra, `${label}: ${path || 'inicio'} sin desplazamiento horizontal`, o <= 0, `exceso ${o}px`, await shot(s2.page, `admin-${label.startsWith('390') ? '390' : 'zoom200'}-${(path || 'inicio').replace(/[^a-z]/g, '').slice(0, 12) || 'inicio'}`));
      }
      await s2.ctx.close();
    }
  }
  // Acción real de «Mi trabajo»: la superficie declarada NO es ubicación; capturar un punto retira la parcela de la cola.
  // La posición es SIMULADA (geolocalización emulada por Playwright); se guarda como BROWSER_GEOLOCATION en DEMO-IMP-PAR-002.
  {
    const c = combos.find((x) => x.email.startsWith('admin.cooperativa@'));
    const before = (await apiCall(`/api/v1/organizations/${coop}/my-work`, adminToken)).body.tasks.find((t) => t.code === 'PLOTS_WITHOUT_LOCATION');
    const target = before?.items.find((i) => i.label === 'DEMO-IMP-PAR-002');
    if (!target) {
      check(extra, 'acción de Mi trabajo (no aplicable: DEMO-IMP-PAR-002 ya tiene ubicación de una ejecución anterior)', true, `tarea actual: ${before ? before.count : 0}`);
    } else {
      const plot = (await apiCall(`/api/v1/organizations/${coop}/plots/${target.id}`, adminToken)).body;
      check(extra, 'DEMO-IMP-PAR-002 con solo superficie declarada sigue en «Parcelas sin ubicación»', before.title === 'Parcelas sin ubicación', `estado: ${plot.geometry_status ?? plot.plot?.geometry_status}`);
      const { ctx, page } = await session(c, undefined, { geolocation: { latitude: -0.8479, longitude: -80.1601, accuracy: 8 }, permissions: ['geolocation'] });
      await page.goto(`${BASE}/organizaciones/${coop}`);
      await page.getByRole('link', { name: 'DEMO-IMP-PAR-002' }).click();
      await page.getByRole('button', { name: 'Capturar ubicación' }).first().click();
      await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
      await page.getByRole('button', { name: 'Capturar otra ubicación' }).waitFor({ timeout: 15000 });
      await page.goto(`${BASE}/organizaciones/${coop}`);
      await page.getByRole('heading', { name: 'Mi trabajo' }).waitFor();
      await page.waitForLoadState('networkidle');
      const after = (await apiCall(`/api/v1/organizations/${coop}/my-work`, adminToken)).body.tasks.find((t) => t.code === 'PLOTS_WITHOUT_LOCATION');
      const listed = await page.getByRole('link', { name: 'DEMO-IMP-PAR-002' }).count();
      check(extra, 'acción de Mi trabajo: capturar un punto (SIMULADO) retira la parcela de la cola', listed === 0 && (after?.count ?? 0) === before.count - 1, `pendientes ${before.count} → ${after?.count ?? 0}`, await shot(page, 'admin-mi-trabajo-tras-accion'));
      await ctx.close();
    }
  }
} catch (e) {
  check(extra, 'ejecución sin errores', false, String(e.message).split('\n').slice(0, 3).join(' | '));
} finally {
  await browser.close();
  const ok = [...matrix, ...extra].every((r) => r.ok);
  writeFileSync(join(outDir, 'matriz.json'), `${JSON.stringify({ fecha: new Date().toISOString(), base: BASE, entorno: 'DESARROLLO local (contenedores), datos DEMO', combinaciones: combos.length, cuentas: new Set(combos.map((x) => x.email)).size, ok, matriz: matrix, verificaciones: extra }, null, 2)}\n`);
  console.log(`Resultado: ${ok ? 'APROBADO' : 'FALLIDO'} (${combos.length} combinaciones de ${new Set(combos.map((x) => x.email)).size} cuentas)`);
  process.exitCode = ok ? 0 : 1;
}

function slugOrg(name) { return name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z]+/g, '-').toLowerCase().split('-').filter(Boolean).slice(1, 2).join('') || 'org'; }
