import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// «Mi ubicación» en la captura de parcelas (web). POSICIÓN EMULADA por Playwright (setGeolocation): evidencia simulada, no una lectura real.
// Comprueba que localizarse centra el mapa y muestra la lectura (precisión, hora) SIN guardar nada ni añadir vértices; que incorporarla exige
// una acción explícita; que cada vértice conserva SU precisión y SU procedencia; los errores con recuperación; roles sin captura sin botón;
// español, inglés, teclado y 390 px. Requiere la cartografía local (si falta, se omite con su motivo).
test.describe.configure({ mode: 'serial' });

const MAPS = (process.env.NEXT_PUBLIC_MAPS_URL ?? 'http://localhost:8090').replace(/\/$/, '');
const ADMIN = { email: 'admin-miubic@e2e.local', password: randomBytes(12).toString('base64url') };
const PROD = { email: 'productor-miubic@e2e.local', password: randomBytes(12).toString('base64url') };
const AUDI = { email: 'auditor-miubic@e2e.local', password: randomBytes(12).toString('base64url') };
let adminTok = ''; let prodTok = ''; let audiTok = '';
let orgId = ''; let hayMapa = false;
const plots: Record<string, string> = {};
const POS = { latitude: -0.85, longitude: -80.16, accuracy: 15 };

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body?.error?.code)}`);
  return body;
}
const versiones = async (plot: string) => { const r = await api(`/api/v1/organizations/${orgId}/plots/${plot}/geometry-versions`, { token: adminTok }); return (r.items ?? r.data ?? r) as Array<Record<string, unknown>>; };

async function contexto(browser: Browser, token: string, o: { geo?: Partial<typeof POS> | null; lang?: 'es' | 'en'; viewport?: { width: number; height: number } } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    ...(o.viewport ? { viewport: o.viewport } : {}),
    ...(o.geo === null ? {} : { geolocation: { ...POS, ...(o.geo ?? {}) }, permissions: ['geolocation'] }),
  });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, o.lang ?? 'es'] as const);
  return ctx;
}
async function abrirParcela(ctx: BrowserContext, plot: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`/organizaciones/${orgId}/parcelas/${plot}`);
  return page;
}
async function mapaListo(page: Page) {
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Cargando el mapa local…')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Mi ubicación/ })).toBeVisible({ timeout: 20_000 });
}

test('preparación: organización, administrador, productor vinculado, auditor y tres parcelas; ¿hay cartografía local?', async () => {
  const superTok = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgId = (await api('/api/v1/organizations', { method: 'POST', token: superTok, body: { name: 'Cooperativa Mi Ubicación', organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const alta = async (u: { email: string; password: string }, rol: string, por: string) => {
    const inv = await api(`/api/v1/organizations/${orgId}/invitations`, { method: 'POST', token: por, body: { email: u.email, role_code: rol } });
    await api('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: 'Mi', last_name: 'Ubicación', password: u.password } });
    return (await api('/api/v1/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).access_token as string;
  };
  adminTok = await alta(ADMIN, 'ORG_ADMIN', superTok);
  prodTok = await alta(PROD, 'PRODUCER', adminTok);
  audiTok = await alta(AUDI, 'AUDITOR', adminTok);
  const base = `/api/v1/organizations/${orgId}`;
  const members = await api(`${base}/members`, { token: adminTok });
  const mem = ((Array.isArray(members) ? members : members.members) as Array<{ email: string; membership_id: string }>).find((m) => m.email === PROD.email)!.membership_id;
  const p = (await api(`${base}/producers`, { method: 'POST', token: adminTok, body: { producer_code: 'MU-P', legal_name: 'Finca Mi Ubicación (sintética)' } })).id;
  const det = await api(`${base}/producers/${p}`, { token: adminTok });
  await api(`${base}/producers/${p}/self-membership`, { method: 'PUT', token: adminTok, body: { expected_version: det.row_version, membership_id: mem, reason: 'Alta del productor en la plataforma' } });
  for (const code of ['MU-1', 'MU-2', 'MU-3']) plots[code] = (await api(`${base}/plots`, { method: 'POST', token: adminTok, body: { producer_id: p, plot_code: code, crop: 'Cacao' } })).id;
  const r = await fetch(`${MAPS}/tiles/ecuador.pmtiles`, { headers: { Range: 'bytes=0-0' } }).catch(() => null);
  hayMapa = !!r && (r.status === 200 || r.status === 206);
});

test('[SIMULADA] mapa de dibujo: localizarse centra el mapa y muestra la lectura SIN guardar ni añadir vértices; añadir exige la acción explícita', async ({ browser }) => {
  test.skip(!hayMapa, `Sin cartografía local preparada en ${MAPS}.`);
  const ctx = await contexto(browser, adminTok);
  const page = await abrirParcela(ctx, plots['MU-1']);
  await page.getByRole('button', { name: 'Escribir o dibujar' }).click();
  await page.getByRole('radio', { name: /Un polígono/ }).check();
  await page.getByRole('button', { name: 'Dibujar en el mapa' }).click();
  await mapaListo(page);

  // Teclado: el botón recibe el foco y se activa con Enter.
  const boton = page.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' });
  await boton.focus();
  await expect(boton).toBeFocused();
  await page.keyboard.press('Enter');

  const lectura = page.getByLabel('Lectura de Mi ubicación');
  await expect(lectura).toBeVisible({ timeout: 20_000 });
  await expect(lectura).toContainText('-0.850000');
  await expect(lectura).toContainText('-80.160000');
  await expect(lectura).toContainText('± 15 m (informada)');
  await expect(lectura).toContainText('no acredita un GPS');
  await expect(lectura).toContainText(/hace \d+ s/);
  await expect(page.getByText(/Localizarte no guarda ni cambia la parcela/)).toBeVisible();
  await expect(page.getByText(/Centro de la mira: longitud -80\.16\d*, latitud -0\.85\d*/)).toBeVisible({ timeout: 20_000 }); // el mapa se centró en la lectura
  await expect(page.locator('.map-me')).toHaveCount(1);                                                                      // marcador diferenciado

  // Localizarse NO añadió ningún vértice ni guardó nada.
  const filas = page.getByRole('table', { name: 'Coordenadas a registrar' }).locator('tbody tr');
  for (let i = 0; i < 3; i++) await expect(filas.nth(i).locator('input').first()).toHaveValue('');
  expect((await versiones(plots['MU-1'])).length).toBe(0);

  // Acción explícita: el vértice 1 conserva SU procedencia y SU precisión.
  await page.getByRole('button', { name: 'Añadir vértice aquí' }).click();
  await expect(filas.nth(0).locator('input').first()).toHaveValue('-80.16');
  await expect(filas.nth(0)).toContainText('Mi ubicación');
  await expect(filas.nth(0)).toContainText('± 15 m (informada)');
  expect((await versiones(plots['MU-1'])).length).toBe(0); // añadirlo a la tabla tampoco guarda

  // Los demás vértices siguen siendo manuales aunque antes se usara Mi ubicación.
  const mapa = page.getByRole('application', { name: /Mapa para dibujar la parcela/ });
  for (const [lon, lat] of [['-80.159', '-0.85'], ['-80.159', '-0.849']]) {
    await page.getByLabel('Ir a longitud').fill(lon); await page.getByLabel('Ir a latitud').fill(lat);
    await page.getByRole('button', { name: 'Centrar el mapa aquí' }).click();
    await expect(page.getByText(new RegExp(`longitud ${lon.replace('.', '\\.')}`))).toBeVisible({ timeout: 20_000 });
    await mapa.focus();
    await page.keyboard.press('Enter');
  }
  await expect(filas).toHaveCount(3);
  await expect(filas.nth(1)).toContainText('Escrito o dibujado');
  await expect(filas.nth(2)).toContainText('Escrito o dibujado');

  // Editar a mano la coordenada del vértice 1 quita su procedencia de «Mi ubicación» (ya no es esa lectura).
  await filas.nth(0).locator('input').nth(1).fill('-0.8501');
  await expect(filas.nth(0)).toContainText('Escrito o dibujado');
  await filas.nth(0).locator('input').nth(1).fill('-0.85');                 // la vuelve a escribir: sigue siendo manual
  await expect(filas.nth(0)).not.toContainText('Mi ubicación');
  await ctx.close();
});

test('[SIMULADA] la revisión y la versión guardada distinguen el vértice de Mi ubicación y no atribuyen su precisión al polígono', async ({ browser }) => {
  test.skip(!hayMapa, `Sin cartografía local preparada en ${MAPS}.`);
  const ctx = await contexto(browser, adminTok);
  const page = await abrirParcela(ctx, plots['MU-1']);
  await page.getByRole('button', { name: 'Escribir o dibujar' }).click();
  await page.getByRole('radio', { name: /Un polígono/ }).check();
  await page.getByRole('button', { name: 'Dibujar en el mapa' }).click();
  await mapaListo(page);
  await page.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' }).click();
  await expect(page.getByLabel('Lectura de Mi ubicación')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Añadir vértice aquí' }).click();
  // Los otros dos vértices se escriben a mano.
  const filas = page.getByRole('table', { name: 'Coordenadas a registrar' }).locator('tbody tr');
  await filas.nth(1).locator('input').nth(0).fill('-80.159'); await filas.nth(1).locator('input').nth(1).fill('-0.85');
  await filas.nth(2).locator('input').nth(0).fill('-80.159'); await filas.nth(2).locator('input').nth(1).fill('-0.849');
  await page.getByRole('button', { name: 'Revisar antes de guardar' }).click();
  const revision = page.getByText('todavía no se guardó nada');
  await expect(revision).toBeVisible();
  await expect(page.getByText('Vértices de Mi ubicación')).toBeVisible();
  await expect(page.getByText(/Cada precisión es la de su propia lectura/)).toBeVisible();
  await expect(page.getByText('No informada: no hay medición.')).toBeVisible(); // la precisión del POLÍGONO sigue sin informarse
  await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
  await expect(page.getByText('Ubicación guardada como versión 1.')).toBeVisible();
  const v = (await versiones(plots['MU-1']))[0];
  expect(v.survey_method).toBe('MANUAL_COORDINATES');   // sigue siendo una captura manual: no se promueve a medición
  expect(v.accuracy_m ?? null).toBeNull();               // la precisión de UNA lectura no pasa a todo el polígono
  expect(String(v.notes)).toContain('«Mi ubicación»');
  expect(String(v.notes)).toContain('#1 ±15 m');
  await ctx.close();
});

test('[SIMULADA] polígono por vértices: «Añadir vértice aquí» abre la revisión de la muestra y solo «Guardar vértice» la guarda, con su precisión', async ({ browser }) => {
  test.skip(!hayMapa, `Sin cartografía local preparada en ${MAPS}.`);
  const ctx = await contexto(browser, adminTok);
  const page = await abrirParcela(ctx, plots['MU-2']);
  await page.getByRole('button', { name: 'Polígono por vértices' }).click();
  await page.getByRole('button', { name: 'Iniciar captura de polígono' }).click();
  await expect(page.getByText('Borrador abierto')).toBeVisible();
  await page.getByRole('button', { name: 'Ver el mapa con Mi ubicación' }).click();
  await mapaListo(page);
  await expect(page.getByRole('button', { name: 'Fijar vértice en la mira' })).toHaveCount(0); // vista: aquí no se traza
  await page.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' }).click();
  await expect(page.getByLabel('Lectura de Mi ubicación')).toBeVisible({ timeout: 20_000 });
  const borrador = async () => (await api(`/api/v1/organizations/${orgId}/plots/${plots['MU-2']}/polygon-drafts/current`, { token: adminTok })).draft;
  expect((await borrador()).vertices.length).toBe(0);              // localizarse no creó ningún vértice
  await page.getByRole('button', { name: 'Añadir vértice aquí' }).click();
  const muestra = page.getByLabel('Muestra del vértice');
  await expect(muestra).toContainText('± 15 m (informada)');
  expect((await borrador()).vertices.length).toBe(0);              // la revisión tampoco guarda
  await page.getByRole('button', { name: 'Guardar vértice' }).click();
  await expect(page.getByText(/Vértice 1 guardado/)).toBeVisible();
  const d = await borrador();
  expect(d.vertices).toHaveLength(1);
  expect(d.vertices[0].horizontal_accuracy_m).toBe(15);            // SU precisión
  expect(d.vertices[0].source).toBe('BROWSER_GEOLOCATION');         // SU procedencia
  await ctx.close();
});

test('[SIMULADA] punto de referencia (productor vinculado): «Usar como punto de referencia» abre la revisión y no guarda hasta confirmar', async ({ browser }) => {
  test.skip(!hayMapa, `Sin cartografía local preparada en ${MAPS}.`);
  const ctx = await contexto(browser, prodTok);
  const page = await ctx.newPage();
  await page.goto(`/organizaciones/${orgId}/captura`);
  const opcion = await page.locator('option', { hasText: 'MU-3' }).first().getAttribute('value');
  await page.getByLabel('Parcela', { exact: true }).selectOption(opcion!);
  await page.getByRole('button', { name: 'Ver el mapa con Mi ubicación' }).click();
  await mapaListo(page);
  await page.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' }).click();
  await expect(page.getByLabel('Lectura de Mi ubicación')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Usar como punto de referencia' }).click();
  await expect(page.getByLabel('Muestra de ubicación')).toContainText('± 15 m (informada)');
  expect((await versiones(plots['MU-3'])).length).toBe(0);
  await page.getByRole('button', { name: 'Descartar' }).click();    // descartar tampoco guarda
  expect((await versiones(plots['MU-3'])).length).toBe(0);
  await ctx.close();
});

test('[SIMULADA] ubicación aproximada: se anuncia sin bloquear; permiso denegado: mensaje, reintento y la captura manual sigue disponible', async ({ browser }) => {
  test.skip(!hayMapa, `Sin cartografía local preparada en ${MAPS}.`);
  // Aproximada (red / IP): precisión 1800 m.
  const ctxA = await contexto(browser, adminTok, { geo: { accuracy: 1800 } });
  const pa = await abrirParcela(ctxA, plots['MU-2']);
  await pa.getByRole('button', { name: 'Escribir o dibujar' }).click();
  await pa.getByRole('button', { name: 'Dibujar en el mapa' }).click();
  await mapaListo(pa);
  await pa.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' }).click();
  await expect(pa.getByText(/Ubicación aproximada: la precisión informada supera 100 m/)).toBeVisible({ timeout: 20_000 });
  await expect(pa.getByLabel('Lectura de Mi ubicación')).toContainText('± 1.800 m');
  await expect(pa.getByRole('button', { name: 'Usar como punto' }).or(pa.getByRole('button', { name: 'Añadir vértice aquí' }))).toBeEnabled(); // no bloquea
  await ctxA.close();

  // Permiso denegado (sin conceder la geolocalización).
  const ctxD = await contexto(browser, adminTok, { geo: null });
  const pd = await abrirParcela(ctxD, plots['MU-2']);
  await pd.getByRole('button', { name: 'Escribir o dibujar' }).click();
  await pd.getByRole('button', { name: 'Dibujar en el mapa' }).click();
  await mapaListo(pd);
  await pd.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' }).click();
  await expect(pd.getByText('El navegador no tiene permiso para usar tu ubicación.')).toBeVisible({ timeout: 20_000 });
  await expect(pd.getByText(/Puedes seguir con la captura manual/)).toBeVisible();
  await expect(pd.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' })).toBeEnabled(); // reintento posible
  await expect(pd.locator('.map-me')).toHaveCount(0);                                                                   // no inventa una posición
  await pd.getByLabel(/Longitud.*vértice 1/).fill('-80.2');                                                             // la entrada manual funciona
  await expect(pd.getByLabel(/Longitud.*vértice 1/)).toHaveValue('-80.2');
  await ctxD.close();
});

test('[SIMULADA] una lectura vieja no se usa como si acabara de medirse: pasado un minuto exige localizarse otra vez', async ({ browser }) => {
  test.skip(!hayMapa, `Sin cartografía local preparada en ${MAPS}.`);
  const ctx = await contexto(browser, adminTok);
  const page = await abrirParcela(ctx, plots['MU-2']);
  await page.clock.install();
  await page.getByRole('button', { name: 'Escribir o dibujar' }).click();
  await page.getByRole('button', { name: 'Dibujar en el mapa' }).click();
  await mapaListo(page);
  await page.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' }).click();
  await expect(page.getByLabel('Lectura de Mi ubicación')).toBeVisible({ timeout: 20_000 });
  const usar = page.getByRole('button', { name: /Usar como punto|Añadir vértice aquí|Reemplazar el punto/ });
  await expect(usar).toBeEnabled();
  await page.clock.fastForward(75_000);
  await expect(page.getByText(/La lectura tiene más de 60 s/)).toBeVisible({ timeout: 15_000 });
  await expect(usar).toBeDisabled();
  await page.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' }).click(); // se localiza otra vez
  await expect(page.getByText(/La lectura tiene más de 60 s/)).toHaveCount(0, { timeout: 15_000 });
  await expect(usar).toBeEnabled();
  await ctx.close();
});

test('un auditor (sin permiso de captura) no ve el botón «Mi ubicación» ni los métodos de captura', async ({ browser }) => {
  const ctx = await contexto(browser, audiTok);
  const page = await abrirParcela(ctx, plots['MU-1']);
  await expect(page.getByRole('heading', { name: /MU-1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mi ubicación/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dibujar en el mapa' })).toHaveCount(0);
  // La API mantiene su comprobación: un POST directo del auditor se rechaza.
  const res = await fetch(`${API_URL}/api/v1/organizations/${orgId}/plots/${plots['MU-1']}/location-samples`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${audiTok}` },
    body: JSON.stringify({ expected_version: 1, source: 'BROWSER_GEOLOCATION', operation_id: crypto.randomUUID(), latitude: -0.85, longitude: -80.16, accuracy_m: 15, captured_at: new Date().toISOString() }),
  });
  expect(res.status).toBe(403);
  await ctx.close();
});

test('[SIMULADA] inglés y 390 px: textos traducidos, sin códigos internos y sin desborde horizontal', async ({ browser }) => {
  test.skip(!hayMapa, `Sin cartografía local preparada en ${MAPS}.`);
  const ctx = await contexto(browser, adminTok, { lang: 'en', viewport: { width: 390, height: 844 } });
  const page = await abrirParcela(ctx, plots['MU-2']);
  await page.getByRole('button', { name: 'Type or draw' }).click();
  await page.getByRole('radio', { name: /A polygon/ }).check();
  await page.getByRole('button', { name: 'Draw on the map' }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
  const boton = page.getByRole('button', { name: 'My location: center the map on your current position' });
  await expect(boton).toBeVisible({ timeout: 20_000 });
  await boton.click();
  const lectura = page.getByLabel('My location reading');
  await expect(lectura).toBeVisible({ timeout: 20_000 });
  await expect(lectura).toContainText('± 15 m (reported)');
  await expect(page.getByText(/Locating yourself does not save or change the plot/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add vertex here' })).toBeVisible();
  const caja = await boton.boundingBox();
  expect(caja!.x + caja!.width).toBeLessThanOrEqual(391);
  const cuerpo = await page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/\b(BROWSER_GEOLOCATION|NOT_REPORTED|APPROXIMATE|DENIED|UNAVAILABLE)\b/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/mi-ubicacion-390.png', fullPage: true });
  await ctx.close();
});
