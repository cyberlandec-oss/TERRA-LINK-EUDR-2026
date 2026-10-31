import { expect, test, type Browser, type Page } from '@playwright/test';
import { Client } from 'pg';
import { API_URL, E2E_DATABASE_URL, SUPER_EMAIL } from '../env';

// P1-005 — acto de REVISIÓN del perfil jurídico desde la web (plataforma). Perfil y revisiones SINTÉTICOS en la base de prueba: el perfil
// sintético se escribe en la base (ningún endpoint publica perfiles); las REVISIONES se registran por la pantalla y la API reales.
// Recorrido: los perfiles reales no tienen revisión → un borrador local NO es una revisión → revisión favorable (teclado) → objeción posterior
// (el pasado se conserva, se pierde la elegibilidad) → español, inglés y 390 px. El perfil sintético termina objetado.
test.describe.configure({ mode: 'serial' });

let tokenSuper = '';
async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body?.error?.code)}`);
  return body;
}
async function abrir(browser: Browser, opts: { lang?: 'es' | 'en'; viewport?: { width: number; height: number } } = {}) {
  const ctx = await browser.newContext({ ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [tokenSuper, opts.lang ?? 'es'] as const);
  const page = await ctx.newPage();
  await page.goto('/plataforma/perfil-juridico');
  return { ctx, page };
}
async function conDb<T>(fn: (db: Client) => Promise<T>) {
  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  try { return await fn(db); } finally { await db.end(); }
}
const numRevisiones = (v: string) => conDb(async (db) => Number((await db.query(`SELECT count(*) AS n FROM legal_profile_reviews WHERE version = $1`, [v])).rows[0].n));
async function rellenar(page: Page, o: { nombre: string; capacidad: string; fecha: string; fundamento: string }) {
  await page.getByLabel('Persona revisora', { exact: true }).fill(o.nombre);
  await page.getByLabel('Cargo o capacidad declarada').fill(o.capacidad);
  await page.getByLabel('Fecha de la revisión').fill(o.fecha);
  await page.getByLabel('Fundamento de la decisión').fill(o.fundamento);
}
const hoy = new Date().toISOString().slice(0, 10);

test('preparación: sesión de plataforma y un perfil SINTÉTICO completo y publicado (sin revisión)', async () => {
  tokenSuper = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  await conDb(async (db) => {
    await db.query(`INSERT INTO legal_profile_versions (version, jurisdiction, scope, scope_note, covered_matters, pending_matters, technical_status, published_by, reason)
      VALUES ('6.6.0', 'EC', 'COMPLETE', 'Fixture sintética de prueba, sin valor jurídico', ARRAY['TENURE'], ARRAY[]::text[], 'PUBLISHED', 'fixture', 'fixture sintética')`);
    await db.query(`INSERT INTO legal_profile_sources (version, code, title, authority, publication, publication_date, url, file_sha256, document_obtained, text_contrasted, legal_validity_reviewed, modifications_found, gaps)
      VALUES ('6.6.0', 'SINT-1', 'Fuente sintética de prueba', 'Autoridad sintética', 'Publicación sintética', '2020-01-01', 'https://example.test/sintetica', repeat('a', 64), true, true, false, 'ninguna', 'ninguna')`);
  });
  expect(tokenSuper.length).toBeGreaterThan(20);
});

test('los perfiles reales no tienen ninguna revisión; el perfil sintético tampoco; un borrador local NO es una revisión', async ({ browser }) => {
  const { ctx, page } = await abrir(browser);
  await expect(page.getByRole('heading', { name: 'Revisión de perfiles jurídicos', level: 1 })).toBeVisible();
  await page.locator('#rv-version').selectOption('0.1.0'); // la base es compartida: otros specs pueden haber dejado perfiles sintéticos con revisión
  const opciones = page.locator('#rv-version option');
  await expect(opciones.filter({ hasText: '0.1.0' })).toContainText('Sin revisión');
  await expect(opciones.filter({ hasText: '0.2.0' })).toContainText('Sin revisión');
  await expect(page.getByText('Esta versión no tiene ninguna revisión registrada.')).toBeVisible();
  const boton = page.getByRole('button', { name: 'Registrar revisión efectiva' });
  await expect(boton).toBeDisabled();
  // el borrador local se conserva al recargar (solo este navegador) y NO crea ninguna revisión
  await page.getByLabel('Persona revisora', { exact: true }).fill('Persona sintética de prueba');
  await page.reload();
  await expect(page.getByLabel('Persona revisora', { exact: true })).toHaveValue('Persona sintética de prueba');
  expect(await numRevisiones('0.1.0') + await numRevisiones('0.2.0') + await numRevisiones('6.6.0')).toBe(0);
  await ctx.close();
});

test('REVISIÓN FAVORABLE con el teclado: soportes, resumen, confirmación y registro; queda vigente y el perfil es elegible', async ({ browser }) => {
  const { ctx, page } = await abrir(browser);
  await page.locator('#rv-version').selectOption('6.6.0');
  await rellenar(page, { nombre: 'Persona sintética de prueba', capacidad: 'Responsable sintético (fixture)', fecha: hoy, fundamento: 'Fundamento sintético de prueba: no acredita ninguna revisión jurídica real' });
  const boton = page.getByRole('button', { name: 'Registrar revisión efectiva' });
  await expect(boton).toBeDisabled(); // falta el soporte exigido para una revisión favorable
  await page.getByLabel(/Fuente sintética de prueba/).focus();
  await page.keyboard.press('Space');
  await expect(boton).toBeDisabled(); // falta confirmar
  await page.getByRole('button', { name: 'Añadir una cita' }).click();
  await page.getByLabel('Cita 1', { exact: true }).fill('Cita sintética de prueba');
  const resumen = page.locator('dl[aria-label="Resumen antes de registrar"]');
  await expect(resumen).toContainText('6.6.0');
  await expect(resumen).toContainText('Ninguna'); // no sustituye a ninguna revisión
  await page.getByLabel('Entiendo que se registra una revisión efectiva e inmutable, no un borrador').focus();
  await page.keyboard.press('Space');
  await expect(boton).toBeEnabled();
  await boton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Revisión efectiva registrada para la versión 6.6.0.', { exact: false })).toBeVisible();
  const hist = page.getByRole('table', { name: 'Historial de revisiones de esta versión' });
  await expect(hist.getByRole('row').nth(1)).toContainText('Revisado (favorable)');
  await expect(hist.getByRole('row').nth(1)).toContainText('Vigente');
  await expect(hist.getByRole('row').nth(1)).toContainText('Persona sintética de prueba');
  await expect(page.getByText('Elegible para vincular un catálogo')).toBeVisible();
  expect(await numRevisiones('6.6.0')).toBe(1);
  // el borrador local se descartó al registrar
  await page.reload();
  await expect(page.getByLabel('Persona revisora', { exact: true })).toHaveValue('');
  await ctx.close();
});

test('OBJECIÓN posterior: se conserva la anterior como reemplazada, se pierde la elegibilidad y la retirada ya no aplica', async ({ browser }) => {
  const { ctx, page } = await abrir(browser);
  await page.locator('#rv-version').selectOption('6.6.0');
  await expect(page.getByRole('radio', { name: /Retirado/ })).toBeEnabled(); // la vigente es favorable
  await page.getByRole('radio', { name: 'Objetado' }).check();
  await rellenar(page, { nombre: 'Segunda persona sintética', capacidad: 'Revisora sintética (fixture)', fecha: hoy, fundamento: 'Objeción sintética: el soporte no respalda la regla de prueba' });
  await page.getByLabel('Entiendo que se registra una revisión efectiva e inmutable, no un borrador').check();
  await page.getByRole('button', { name: 'Registrar revisión efectiva' }).click();
  await expect(page.getByText('Revisión efectiva registrada para la versión 6.6.0.', { exact: false })).toBeVisible();
  const hist = page.getByRole('table', { name: 'Historial de revisiones de esta versión' });
  await expect(hist.getByRole('row')).toHaveCount(3); // encabezado + 2
  await expect(hist.getByRole('row').nth(1)).toContainText('Objetado');
  await expect(hist.getByRole('row').nth(1)).toContainText('Vigente');
  await expect(hist.getByRole('row').nth(2)).toContainText('Revisado (favorable)');
  await expect(hist.getByRole('row').nth(2)).toContainText('Reemplazada');
  await expect(page.getByText('No elegible para vincular un catálogo')).toBeVisible();
  await expect(page.getByText('La última decisión de revisión es «objetada».').first()).toBeVisible();
  await expect(page.getByRole('radio', { name: /Retirado/ })).toBeDisabled();
  expect(await numRevisiones('6.6.0')).toBe(2);
  await ctx.close();
});

test('inglés y 390 px: textos traducidos, sin códigos internos, sin desborde y la consecuencia técnica visible', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, { lang: 'en', viewport: { width: 390, height: 844 } });
  await expect(page.getByRole('heading', { name: 'Legal profile reviews', level: 1 })).toBeVisible();
  await page.locator('#rv-version').selectOption('6.6.0');
  await expect(page.getByText('Not eligible to link a catalog')).toBeVisible();
  const razon = page.getByText('The latest review decision is "objected".').first();
  await expect(razon).toBeVisible();
  const caja = await razon.boundingBox();
  expect(caja!.x + caja!.width).toBeLessThanOrEqual(391);
  const hist = page.getByRole('table', { name: 'Review history of this version' });
  await expect(hist.getByRole('row').nth(1)).toContainText('Objected');
  await expect(hist.getByRole('row').nth(2)).toContainText('Superseded');
  await expect(page.getByRole('button', { name: 'Record effective review' })).toBeDisabled();
  // el fundamento del historial se lee SIN desplazar la tabla horizontalmente
  const fund = hist.getByText('Objeción sintética: el soporte no respalda la regla de prueba');
  await expect(fund).toBeVisible();
  const cf = await fund.boundingBox();
  expect(cf!.x + cf!.width).toBeLessThanOrEqual(391);
  // los controles de opción tienen tamaño de control (no ocupan el ancho) y la etiqueta queda a su lado
  const radio = page.getByRole('radio', { name: 'Objected' });
  const cr = await radio.boundingBox();
  expect(cr!.width).toBeLessThanOrEqual(24);
  const cl = await page.getByText('Objected', { exact: true }).last().boundingBox();
  expect(Math.abs(cl!.y - cr!.y)).toBeLessThan(24); // en la misma línea
  await page.screenshot({ path: 'test-results/revision-perfil-390.png', fullPage: true });
  const cuerpo = await page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/\b(REVIEW_OBJECTED|REVIEW_WITHDRAWN|SCOPE_PARTIAL|NO_REVIEW|PROFILE_SOURCE|CITATION|PUBLISHED|DRAFT|OBJECTED|REVIEWED)\b/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});
