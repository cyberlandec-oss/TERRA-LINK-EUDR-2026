import { expect, test, type Browser } from '@playwright/test';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { API_URL, E2E_DATABASE_URL, SUPER_EMAIL } from '../env';

// D-07.5(b), opción b-1 — pantalla de vinculación del catálogo de riesgo con un perfil jurídico revisado.
// Recorrido: sin perfil elegible la pantalla EXPLICA qué falta y no ofrece confirmar → (fixture SINTÉTICA escrita en la base de prueba:
// ningún endpoint produce una revisión jurídica) → revisar la referencia propuesta, confirmar con el teclado y consultar el historial →
// una revisión posterior objetada deja el acto en el historial como «ya no vigente». Español, inglés y 390 px.
test.describe.configure({ mode: 'serial' });

let tokenSuper = '';
async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body?.error?.code)}`);
  return body;
}
async function abrir(browser: Browser, ruta: string, opts: { lang?: 'es' | 'en'; viewport?: { width: number; height: number } } = {}) {
  const ctx = await browser.newContext({ ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [tokenSuper, opts.lang ?? 'es'] as const);
  const page = await ctx.newPage();
  await page.goto(ruta);
  return { ctx, page };
}
async function conDb<T>(fn: (db: Client) => Promise<T>) {
  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  try { return await fn(db); } finally { await db.end(); }
}
// Por el camino REAL de la API (acto de plataforma) con datos SINTÉTICOS: no se escribe la revisión en la base a mano.
const revisionSintetica = async (decision: 'REVIEWED' | 'OBJECTED') => {
  const actual = await conDb(async (db) => (await db.query(`SELECT id FROM legal_profile_reviews WHERE version = '8.8.8' ORDER BY decided_at DESC, id DESC LIMIT 1`)).rows[0]?.id ?? null);
  await api('/api/v1/platform/legal-profile/reviews', { method: 'POST', token: tokenSuper, body: {
    operation_id: randomUUID(), version: '8.8.8', decision, reviewer_name: 'Persona sintética de prueba', reviewer_capacity: 'FIXTURE SINTÉTICA DE PRUEBA',
    reviewed_on: new Date().toISOString().slice(0, 10), basis: 'Fixture sintética: no acredita ninguna revisión jurídica real', supports: [{ kind: 'CITATION', citation: 'Cita sintética de prueba' }], expected_current_review_id: actual } });
};

test('preparación: sesión de plataforma', async () => {
  tokenSuper = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  expect(tokenSuper.length).toBeGreaterThan(20);
});

test('sin perfil elegible: explica qué falta de cada perfil y no ofrece confirmar', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, '/plataforma/catalogo-riesgo');
  await expect(page.getByRole('heading', { name: 'Vinculación del catálogo de riesgo con un perfil jurídico', level: 1 })).toBeVisible();
  await expect(page.getByText('Ningún perfil es elegible todavía')).toBeVisible();
  const tabla = page.getByRole('table', { name: 'Perfiles jurídicos y su elegibilidad' });
  await expect(tabla.getByRole('row', { name: /^0\.1\.0/ })).toContainText('El alcance del perfil es PARCIAL.');
  await expect(tabla.getByRole('row', { name: /^0\.2\.0/ })).toContainText('El perfil es un borrador (no publicado).');
  await expect(tabla.getByRole('row', { name: /^0\.2\.0/ })).toContainText('El perfil no tiene ninguna revisión jurídica registrada.');
  await expect(page.getByRole('button', { name: 'Registrar la vinculación' })).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Historial de vinculaciones' }).getByRole('row', { name: /^1\.1\.0/ })).toHaveCount(0); // aún no hay un acto propio (el historial global puede traer los de otros specs)
  await ctx.close();
});

test('con un perfil SINTÉTICO completo y revisado: revisar la referencia, confirmar con el teclado y ver el historial', async ({ browser }) => {
  await conDb(async (db) => {
    await db.query(`INSERT INTO legal_profile_versions (version, jurisdiction, scope, scope_note, covered_matters, pending_matters, technical_status, published_by, reason)
      VALUES ('8.8.8', 'EC', 'COMPLETE', 'Fixture sintética de prueba, sin valor jurídico', ARRAY['TENURE'], ARRAY[]::text[], 'PUBLISHED', 'fixture', 'fixture sintética')`);
  });
  await revisionSintetica('REVIEWED');
  const { ctx, page } = await abrir(browser, '/plataforma/catalogo-riesgo');
  await expect(page.getByRole('row', { name: /^8\.8\.8/ })).toContainText('Elegible');
  await expect(page.getByText('Ningún perfil es elegible todavía')).toHaveCount(0);
  await page.getByLabel('Versión nueva del catálogo').fill('1.1.0');
  await page.getByLabel('Motivo del acto').fill('Vinculación de ensayo con un perfil sintético');
  const prop = page.getByRole('list', { name: 'Referencia propuesta' }).or(page.locator('dl[aria-label="Referencia propuesta"]'));
  await expect(prop).toContainText('8.8.8');
  await expect(prop).toContainText('FIXTURE SINTÉTICA DE PRUEBA');
  const boton = page.getByRole('button', { name: 'Registrar la vinculación' });
  await expect(boton).toBeDisabled(); // sin confirmar la referencia no se registra
  await page.getByLabel('Confirmo que la referencia y la revisión indicadas son las que quiero registrar').focus();
  await page.keyboard.press('Space');
  await expect(boton).toBeEnabled();
  await boton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Vinculación registrada: la versión 1.1.0 existe y no está adoptada en ninguna organización.')).toBeVisible();
  const hist = page.getByRole('table', { name: 'Historial de vinculaciones' });
  await expect(hist.getByRole('row', { name: /^1\.1\.0/ })).toContainText('Vigente');
  await expect(hist.getByRole('row', { name: /^1\.1\.0/ })).toContainText('Vinculación de ensayo con un perfil sintético');
  await expect(page.getByRole('table', { name: 'Catálogos publicados' }).getByRole('row', { name: /^1\.1\.0/ })).toContainText('8.8.8');
  // 1.0.0 sigue sin perfil declarado, y la versión nueva no quedó adoptada en ninguna organización.
  await expect(page.getByRole('table', { name: 'Catálogos publicados' }).getByRole('row', { name: /^1\.0\.0/ })).toContainText('—');
  const adoptada = await conDb(async (db) => Number((await db.query(`SELECT count(*) AS n FROM risk_rule_set_adoptions WHERE rule_set_version = '1.1.0'`)).rows[0].n));
  expect(adoptada).toBe(0);
  await ctx.close();
});

test('una revisión posterior objetada: el acto permanece en el historial y deja de figurar como vigente', async ({ browser }) => {
  await revisionSintetica('OBJECTED');
  const { ctx, page } = await abrir(browser, '/plataforma/catalogo-riesgo');
  const fila = page.getByRole('table', { name: 'Historial de vinculaciones' }).getByRole('row', { name: /^1\.1\.0/ });
  await expect(fila).toContainText('Ya no vigente');
  await expect(fila).toContainText('La última decisión de revisión es «objetada».');
  await expect(fila).toContainText('ya no se usa como aprobación vigente');
  await expect(page.getByRole('row', { name: /^8\.8\.8/ })).toContainText('No elegible');
  await expect(page.getByText('Ningún perfil es elegible todavía')).toBeVisible();
  await ctx.close();
});

test('inglés y 390 px: mismos textos traducidos, sin códigos internos y sin desborde horizontal', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, '/plataforma/catalogo-riesgo', { lang: 'en', viewport: { width: 390, height: 844 } });
  await expect(page.getByRole('heading', { name: 'Linking the risk catalog to a legal profile', level: 1 })).toBeVisible();
  await expect(page.getByText('No profile is eligible yet')).toBeVisible();
  const fila = page.getByRole('table', { name: 'Link history' }).getByRole('row', { name: /^1\.1\.0/ });
  await expect(fila).toContainText('No longer valid');
  await expect(fila).toContainText('The latest review decision is "objected".');
  // Lo que falta de cada perfil se ve SIN desplazar la tabla: queda dentro del ancho de 390 px.
  const razon = page.getByRole('table', { name: 'Legal profiles and their eligibility' }).getByText('The latest review decision is "objected".').first();
  await expect(razon).toBeVisible();
  const caja = await razon.boundingBox();
  expect(caja!.x + caja!.width).toBeLessThanOrEqual(391);
  const cuerpo = await page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/\b(NO_LONGER_VALID|REVIEW_OBJECTED|SCOPE_PARTIAL|NO_REVIEW|NOT_APPROVED|PUBLISHED)\b/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});
