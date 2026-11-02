import { expect, test, type Browser } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL, WEB_URL } from '../env';

// A-01 — dibujar la parcela SOBRE UN MAPA con cartografía 100 % LOCAL (MapLibre + PMTiles + servicio `maps`).
// Comprueba, con las solicitudes de red reales del navegador, que el mapa no contacta ningún servicio externo; que se puede acercar,
// desplazar, fijar vértices (clic de mira, teclado), revisar en el servidor SIN guardar y confirmar; en español, en inglés y a 390 px;
// y que, si faltan los datos cartográficos, se dice y queda la entrada manual. Requiere el servicio `maps` con datos preparados
// (node infra/maps/preparar-mapa.mjs); si no están, la prueba se OMITE con su motivo — no pasa en silencio.
test.describe.configure({ mode: 'serial' });

const MAPS = (process.env.NEXT_PUBLIC_MAPS_URL ?? 'http://localhost:8090').replace(/\/$/, '');
const ADMIN = { email: 'admin-mapa@e2e.local', password: randomBytes(12).toString('base64url') };
const PROD = { email: 'productor-mapa@e2e.local', password: randomBytes(12).toString('base64url') };
let prodTok = '';
let orgId = '';
let plotId = '';
let hayMapa = false;

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body?.error?.code)}`);
  return body;
}
async function abrir(browser: Browser, lang: 'es' | 'en' = 'es', viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext({ ...(viewport ? { viewport } : {}) });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [prodTok, lang] as const);
  const page = await ctx.newPage();
  const externas: string[] = [];
  const permitidos = new Set([new URL(WEB_URL).origin, new URL(API_URL).origin, new URL(MAPS).origin]);
  page.on('request', (r) => { const u = r.url(); if (/^https?:/.test(u) && !permitidos.has(new URL(u).origin)) externas.push(u); });
  await page.goto(`/organizaciones/${orgId}/captura`);
  return { ctx, page, externas };
}

test('preparación: organización, productor vinculado y parcela; ¿hay cartografía local preparada?', async () => {
  const superTok = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgId = (await api('/api/v1/organizations', { method: 'POST', token: superTok, body: { name: 'Cooperativa Mapa A01', organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const alta = async (u: { email: string; password: string }, rol: string, por: string) => {
    const inv = await api(`/api/v1/organizations/${orgId}/invitations`, { method: 'POST', token: por, body: { email: u.email, role_code: rol } });
    await api('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: 'Mapa', last_name: 'A01', password: u.password } });
  };
  await alta(ADMIN, 'ORG_ADMIN', superTok);
  const adminTok = (await api('/api/v1/auth/login', { method: 'POST', body: { email: ADMIN.email, password: ADMIN.password } })).access_token;
  await alta(PROD, 'PRODUCER', adminTok);
  prodTok = (await api('/api/v1/auth/login', { method: 'POST', body: { email: PROD.email, password: PROD.password } })).access_token;
  const base = `/api/v1/organizations/${orgId}`;
  const members = await api(`${base}/members`, { token: adminTok });
  const mem = ((Array.isArray(members) ? members : members.members) as Array<{ email: string; membership_id: string }>).find((m) => m.email === PROD.email)!.membership_id;
  const p = (await api(`${base}/producers`, { method: 'POST', token: adminTok, body: { producer_code: 'MAPA-P', legal_name: 'Finca Mapa (sintética)' } })).id;
  const det = await api(`${base}/producers/${p}`, { token: adminTok });
  await api(`${base}/producers/${p}/self-membership`, { method: 'PUT', token: adminTok, body: { expected_version: det.row_version, membership_id: mem, reason: 'Alta del productor en la plataforma' } });
  plotId = (await api(`${base}/plots`, { method: 'POST', token: adminTok, body: { producer_id: p, plot_code: 'MAPA-L', crop: 'Cacao' } })).id;
  const r = await fetch(`${MAPS}/tiles/ecuador.pmtiles`, { headers: { Range: 'bytes=0-0' } }).catch(() => null);
  hayMapa = !!r && (r.status === 200 || r.status === 206);
});

test('mapa local: sin solicitudes externas; acercar, desplazar, fijar vértices (mira y teclado), revisar sin guardar y confirmar', async ({ browser }) => {
  test.skip(!hayMapa, `Sin cartografía local preparada en ${MAPS} (node infra/maps/preparar-mapa.mjs): no se puede demostrar el mapa.`);
  const { ctx, page, externas } = await abrir(browser);
  await page.getByLabel('Parcela', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Escribir o dibujar' }).click();
  await page.getByRole('radio', { name: /Un polígono/ }).check();
  await page.getByRole('button', { name: 'Dibujar en el mapa' }).click();
  const mapa = page.getByRole('application', { name: /Mapa para dibujar la parcela/ });
  await expect(mapa).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Cargando el mapa local…')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/OpenStreetMap/).first()).toBeVisible();
  // Orientarse: ir a una coordenada de la costa de Manabí, acercar y desplazar con teclado.
  await page.getByLabel('Ir a longitud').fill('-80.16'); await page.getByLabel('Ir a latitud').fill('-0.85');
  await page.getByRole('button', { name: 'Centrar el mapa aquí' }).click();
  await expect(page.getByText(/longitud -80\.16, latitud -0\.85/)).toBeVisible({ timeout: 20_000 });
  await mapa.focus();
  await page.keyboard.press('=');
  await page.keyboard.press('ArrowRight');
  // Tres vértices: dos con la mira (botón y Enter) tras desplazarse, y uno con clic en el mapa.
  const fijar = page.getByRole('button', { name: 'Fijar vértice en la mira' });
  await expect(fijar).toBeEnabled({ timeout: 20_000 });
  await fijar.click();
  for (const [lon, lat] of [['-80.159', '-0.85'], ['-80.159', '-0.849']]) {
    await page.getByLabel('Ir a longitud').fill(lon); await page.getByLabel('Ir a latitud').fill(lat);
    await page.getByRole('button', { name: 'Centrar el mapa aquí' }).click();
    await expect(page.getByText(new RegExp(`longitud ${lon.replace('.', '\\.')}`))).toBeVisible({ timeout: 20_000 });
    await mapa.focus();
    await page.keyboard.press('Enter');
  }
  await expect(page.getByRole('table', { name: 'Coordenadas a registrar' }).locator('tbody tr')).toHaveCount(3);
  // El orden [longitud, latitud] sigue rotulado, y la revisión del servidor no guarda nada.
  await expect(page.getByText(/primero la longitud/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Revisar antes de guardar' }).click();
  await expect(page.getByText('todavía no se guardó nada')).toBeVisible();
  const antes = await api(`/api/v1/organizations/${orgId}/plots/${plotId}/geometry-versions`, { token: prodTok });
  expect((antes.items ?? antes.data ?? antes).length).toBe(0);
  await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
  await expect(page.getByText('Ubicación guardada como versión 1.')).toBeVisible();
  const despues = (await api(`/api/v1/organizations/${orgId}/plots/${plotId}/geometry-versions`, { token: prodTok }));
  const v = (despues.items ?? despues.data ?? despues)[0];
  expect(v.survey_method).toBe('MANUAL_COORDINATES');
  expect(v.accuracy_m ?? null).toBeNull();                               // dibujar en un mapa no es una medición GPS
  // RED: todo el tráfico fue a la web, a la API y al servicio local de mapas.
  expect(externas, `Solicitudes a servicios externos: ${externas.join(', ')}`).toEqual([]);
  await ctx.close();
});

test('inglés y 390 px: el mapa se maneja con teclado, sin desborde y sin contactar servicios externos', async ({ browser }) => {
  test.skip(!hayMapa, `Sin cartografía local preparada en ${MAPS}.`);
  const { ctx, page, externas } = await abrir(browser, 'en', { width: 390, height: 844 });
  await page.getByLabel('Plot', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Type or draw' }).click();
  await page.getByRole('button', { name: 'Draw on the map' }).click();
  await expect(page.getByRole('application', { name: /Map for drawing the plot/ })).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Set vertex at the crosshair' })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Set vertex at the crosshair' }).click();
  await expect(page.getByLabel(/Longitude.*vertex 1/)).not.toHaveValue('');
  await expect(page.getByText(/It is a visual reference/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(externas).toEqual([]);
  await ctx.close();
});

test('sin datos cartográficos: lo dice, no usa un mapa externo y conserva la entrada manual', async ({ browser }) => {
  const { ctx, page, externas } = await abrir(browser);
  await page.route('**/estilo.json', (r) => r.fulfill({ status: 404, body: 'no preparado' }));
  await page.getByLabel('Parcela', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Escribir o dibujar' }).click();
  await page.getByRole('button', { name: 'Dibujar en el mapa' }).click();
  await expect(page.getByText('La cartografía local no está disponible.')).toBeVisible();
  await expect(page.getByText(/No se usa ningún mapa externo como reemplazo/)).toBeVisible();
  // La entrada manual sigue funcionando: se pueden escribir y revisar coordenadas.
  await page.getByLabel(/Longitud.*vértice 1/).fill('-80.2'); await page.getByLabel(/Latitud.*vértice 1/).fill('-0.9');
  await expect(page.getByRole('button', { name: 'Revisar antes de guardar' })).toBeEnabled();
  expect(externas).toEqual([]);
  await ctx.close();
});
