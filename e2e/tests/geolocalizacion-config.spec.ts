import { expect, test, type Browser } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// GEOLOCATION_PROFILE — configuración versionada de reglas de geolocalización desde la web: preparar una versión (plataforma), registrar su revisión con el alcance de
// aplicabilidad (plataforma), consultarla y adoptarla (organización) y ver la pérdida de vigencia tras una objeción. Datos SINTÉTICOS creados por la API y la pantalla;
// ninguna configuración real se revisa ni se adopta. Español, inglés, teclado y 390 px. Las comprobaciones responsive (radios, motivos, historial) están aquí
// para cerrarse ANTES de congelar el candidato.
test.describe.configure({ mode: 'serial' });

const ADMIN_A = { email: 'admin-geo-a@e2e.local', password: randomBytes(12).toString('base64url') };
const tok: Record<string, string> = {};
let orgA = ''; const NOMBRE_A = 'Coop Geo E2E A'; const NOMBRE_B = 'Coop Geo E2E B'; let orgBid = '';
async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body?.error?.code)}`);
  return body;
}
async function abrir(browser: Browser, quien: 'super' | 'adminA', ruta: string, opts: { lang?: 'es' | 'en'; viewport?: { width: number; height: number } } = {}) {
  const ctx = await browser.newContext({ ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [tok[quien], opts.lang ?? 'es'] as const);
  const page = await ctx.newPage();
  await page.goto(ruta);
  return { ctx, page };
}
const hoy = new Date().toISOString().slice(0, 10);
const dentro = async (loc: import('@playwright/test').Locator) => { const b = await loc.boundingBox(); expect(b!.x + b!.width).toBeLessThanOrEqual(391); };

test('preparación: sesión de plataforma, dos organizaciones sintéticas y la administración de la primera', async () => {
  tok.super = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgA = (await api('/api/v1/organizations', { method: 'POST', token: tok.super, body: { name: NOMBRE_A, organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  orgBid = (await api('/api/v1/organizations', { method: 'POST', token: tok.super, body: { name: NOMBRE_B, organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const inv = await api(`/api/v1/organizations/${orgA}/invitations`, { method: 'POST', token: tok.super, body: { email: ADMIN_A.email, role_code: 'ORG_ADMIN' } });
  await api('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: 'Prueba', last_name: 'Geo', password: ADMIN_A.password } });
  tok.adminA = (await api('/api/v1/auth/login', { method: 'POST', body: { email: ADMIN_A.email, password: ADMIN_A.password } })).access_token;
  expect(orgBid).not.toBe(orgA);
});

test('plataforma: la configuración 0.1.0 sembrada es candidata, sin revisión, con una regla activa y dos candidatas que explican qué falta', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'super', '/plataforma/geolocalizacion');
  await expect(page.getByRole('heading', { name: 'Reglas de geolocalización: configuración y revisión', level: 1 })).toBeVisible();
  await page.locator('#g-sel').selectOption('0.1.0');
  await expect(page.getByText('No tiene ninguna revisión registrada.', { exact: true })).toBeVisible();
  await expect(page.getByText('Conserva reglas candidatas sin resolver')).toBeVisible();
  await expect(page.getByText('GEO-TECH-PROFILE')).toBeVisible();
  await expect(page.getByText('Candidata (no se aplica)').first()).toBeVisible();
  await expect(page.getByText('Esta versión no tiene ninguna revisión registrada.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar revisión efectiva' })).toBeDisabled();
  await ctx.close();
});

test('plataforma: preparar la versión 9.1.0 (solo regla activa), sin revisión y sin aplicarse a ningún expediente', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'super', '/plataforma/geolocalizacion');
  await page.getByLabel('Versión nueva', { exact: true }).fill('9.1.0');
  await page.getByLabel('Alcance de la configuración').fill('Configuración sintética de prueba: solo la regla de evaluación del perfil técnico.');
  await page.getByLabel('Motivo del acto').fill('Preparación sintética de ensayo');
  await page.getByLabel('Código').first().fill('SINT-1');
  await page.getByLabel('Título').fill('Fuente sintética de prueba');
  await page.getByLabel('Cita (artículo y apartado)').fill('Artículo sintético');
  await page.getByLabel('Enlace (https)').fill('https://example.test/fuente-sintetica');
  await page.getByLabel('Código').nth(1).fill('GEO-TECH');
  await page.getByLabel('Fuente que la respalda').selectOption('SINT-1');
  await page.getByLabel('Artículo', { exact: true }).fill('Artículo sintético');
  await page.getByLabel('Criterio', { exact: true }).fill('Cada parcela de origen tiene una evaluación vigente del perfil técnico que cumple.');
  const boton = page.getByRole('button', { name: 'Preparar la versión' });
  await expect(boton).toBeDisabled();
  await page.getByLabel('Entiendo que la versión será inmutable y nacerá sin revisión').check();
  await boton.click();
  await expect(page.getByText('Versión 9.1.0 preparada: inmutable y sin revisión; no se aplica a ningún expediente todavía.')).toBeVisible();
  await expect(page.locator('#g-sel option', { hasText: '9.1.0' })).toContainText('Sin revisión');
  await ctx.close();
});

test('plataforma: revisión favorable con el teclado y alcance declarado SOLO para la organización A', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'super', '/plataforma/geolocalizacion');
  await page.locator('#g-sel').selectOption('9.1.0');
  await page.getByLabel('Persona revisora', { exact: true }).fill('Persona sintética de prueba');
  await page.getByLabel('Cargo o capacidad declarada').fill('Responsable sintético (fixture)');
  await page.getByLabel('Fecha de la revisión', { exact: true }).fill(hoy);
  await page.getByLabel('Fundamento de la decisión').fill('Fundamento sintético de prueba: no acredita ninguna revisión real');
  await page.getByLabel('Operación y condiciones a las que se refiere la aplicabilidad').fill('Operación sintética de ensayo');
  const boton = page.getByRole('button', { name: 'Registrar revisión efectiva' });
  await expect(boton).toBeDisabled();
  await page.getByLabel(/Fuente sintética de prueba/).focus();
  await page.keyboard.press('Space');
  await page.getByLabel(NOMBRE_A, { exact: true }).focus();
  await page.keyboard.press('Space');
  const resumen = page.locator('dl[aria-label="Resumen antes de registrar"]');
  await expect(resumen).toContainText(NOMBRE_A);
  await expect(resumen).not.toContainText(NOMBRE_B);
  await page.getByLabel('Entiendo que se registra una revisión efectiva e inmutable de esta configuración, no un borrador').focus();
  await page.keyboard.press('Space');
  await expect(boton).toBeEnabled();
  await boton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Revisión efectiva registrada para la configuración 9.1.0.', { exact: false })).toBeVisible();
  await expect(page.locator('dl[aria-label="Versión exacta de la configuración"]').getByText('Revisada (favorable)')).toBeVisible();
  await expect(page.getByText(`Organizaciones: ${NOMBRE_A}`)).toBeVisible();
  await ctx.close();
});

test('organización A: ve la configuración revisada y aplicable a ella, qué falta, y la adopta; no ve a qué otras organizaciones se declaró', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'adminA', `/organizaciones/${orgA}/geolocalizacion`);
  await expect(page.getByRole('heading', { name: 'Reglas de geolocalización (versionadas)', level: 1 })).toBeVisible();
  const sec = page.locator('section[aria-labelledby="cfg-9.1.0"]');
  await expect(sec).toContainText('Revisada (favorable)');
  await expect(sec).toContainText('Declarada aplicable a esta organización');
  await expect(sec).toContainText('Nada: la configuración permite evaluar el requisito');
  const sec01 = page.locator('section[aria-labelledby="cfg-0.1.0"]');
  await expect(sec01).toContainText('No tiene ninguna revisión registrada.');
  await expect(sec01).toContainText('Conserva reglas candidatas sin resolver');
  await expect(page.locator('main')).not.toContainText(NOMBRE_B);
  await sec.getByRole('button', { name: 'Adoptar esta configuración' }).click();
  await expect(sec).toContainText('Adoptada por esta organización');
  await expect(sec.getByRole('button', { name: 'Retirar esta configuración' })).toBeVisible();
  await ctx.close();
});

test('revisión posterior objetada: la organización ve la pérdida de vigencia y el motivo; el historial conserva la anterior', async ({ browser }) => {
  const s = await abrir(browser, 'super', '/plataforma/geolocalizacion');
  await s.page.locator('#g-sel').selectOption('9.1.0');
  await s.page.getByRole('radio', { name: 'Objetada' }).check();
  await s.page.getByLabel('Persona revisora', { exact: true }).fill('Segunda persona sintética');
  await s.page.getByLabel('Cargo o capacidad declarada').fill('Revisora sintética (fixture)');
  await s.page.getByLabel('Fecha de la revisión', { exact: true }).fill(hoy);
  await s.page.getByLabel('Fundamento de la decisión').fill('Objeción sintética: el criterio no es suficiente para esta operación');
  await s.page.getByLabel('Operación y condiciones a las que se refiere la aplicabilidad').fill('Operación sintética de ensayo');
  await s.page.getByLabel('Entiendo que se registra una revisión efectiva e inmutable de esta configuración, no un borrador').check();
  await s.page.getByRole('button', { name: 'Registrar revisión efectiva' }).click();
  await expect(s.page.getByText('Revisión efectiva registrada para la configuración 9.1.0.', { exact: false })).toBeVisible();
  await s.ctx.close();
  const { ctx, page } = await abrir(browser, 'adminA', `/organizaciones/${orgA}/geolocalizacion`);
  const sec = page.locator('section[aria-labelledby="cfg-9.1.0"]');
  await expect(sec).toContainText('Objetada');
  await expect(sec).toContainText('Su última revisión es «objetada».');
  await expect(sec.getByText('Reemplazada')).toBeVisible();
  await expect(sec.getByText('Vigente', { exact: true })).toBeVisible();
  await ctx.close();
});

test('inglés y 390 px (plataforma): textos traducidos, radios con tamaño de control, motivos e historial dentro del ancho y sin desborde', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'super', '/plataforma/geolocalizacion', { lang: 'en', viewport: { width: 390, height: 844 } });
  await expect(page.getByRole('heading', { name: 'Geolocation rules: configuration and review', level: 1 })).toBeVisible();
  await page.locator('#g-sel').selectOption('9.1.0');
  const fund = page.getByText('Objeción sintética: el criterio no es suficiente para esta operación');
  await expect(fund).toBeVisible(); await dentro(fund);
  await expect(page.getByText('Superseded').first()).toBeVisible();
  const radio = page.getByRole('radio', { name: 'Objected' });
  expect((await radio.boundingBox())!.width).toBeLessThanOrEqual(24);
  expect(Math.abs((await page.getByText('Objected', { exact: true }).last().boundingBox())!.y - (await radio.boundingBox())!.y)).toBeLessThan(24);
  await page.locator('#g-sel').selectOption('0.1.0');
  const falta = page.getByText('It keeps unresolved candidate rules').first();
  await expect(falta).toBeVisible(); await dentro(falta);
  const cuerpo = await page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/\b(NO_REVIEW|REVIEW_OBJECTED|CANDIDATE_RULES_PENDING|GEO_TECH_PROFILE|PRODUCTION_PERIOD|CONFIG_SOURCE|REVIEWED|OBJECTED|WITHDRAWN|NONE)\b/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/geo-config-plataforma-390.png', fullPage: true });
  await ctx.close();
});

test('inglés y 390 px (organización): configuración, qué falta y botones dentro del ancho y sin códigos internos', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'adminA', `/organizaciones/${orgA}/geolocalizacion`, { lang: 'en', viewport: { width: 390, height: 844 } });
  await expect(page.getByRole('heading', { name: 'Geolocation rules (versioned)', level: 1 })).toBeVisible();
  const sec = page.locator('section[aria-labelledby="cfg-9.1.0"]');
  await expect(sec).toContainText('Objected');
  const motivo = sec.getByText('Its latest review is "objected".');
  await expect(motivo).toBeVisible(); await dentro(motivo);
  const boton = sec.getByRole('button', { name: 'Withdraw this configuration' });
  await expect(boton).toBeVisible(); await dentro(boton);
  const cuerpo = await page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/\b(NO_REVIEW|REVIEW_OBJECTED|CANDIDATE_RULES_PENDING|GEO_TECH_PROFILE|PRODUCTION_PERIOD|REVIEWED|OBJECTED|WITHDRAWN|NONE|ACTIVE|CANDIDATE)\b/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/geo-config-org-390.png', fullPage: true });
  await ctx.close();
});
