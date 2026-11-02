import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// P1-015 / D-54 en navegador: idiomas (español fuente, inglés), coste estimado, Mi cuenta y acceso, con teclado y a 390 px.
// Las tarifas son SINTÉTICAS y se rotulan como tales; el acceso federado está deshabilitado en este entorno E2E.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-p1015@e2e.local', password: randomBytes(12).toString('base64url') };
let token = '';
let orgId = '';

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body?.error?.code)}`);
  return body;
}

async function abrir(browser: Browser, ruta: string, opts: { lang?: 'es' | 'en'; viewport?: { width: number; height: number } } = {}) {
  const ctx = await browser.newContext({ ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); if (l) localStorage.setItem('tl_lang', l); }, [token, opts.lang ?? ''] as const);
  const page = await ctx.newPage();
  await page.goto(ruta);
  return { ctx, page };
}
const sinDesbordeHorizontal = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

test('preparación: organización y administrador por la API', async () => {
  const superTok = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgId = (await api('/api/v1/organizations', { method: 'POST', token: superTok, body: { name: 'Cooperativa Idiomas', organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const inv = await api(`/api/v1/organizations/${orgId}/invitations`, { method: 'POST', token: superTok, body: { email: ADMIN.email, role_code: 'ORG_ADMIN' } });
  await api('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: 'Ida', last_name: 'Idiomas', password: ADMIN.password } });
  token = (await api('/api/v1/auth/login', { method: 'POST', body: { email: ADMIN.email, password: ADMIN.password } })).access_token;
  expect(token.length).toBeGreaterThan(20);
});

test('acceso: español por defecto, inglés con el selector (teclado) y se recuerda', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  // Sin acceso federado en este entorno, no se ofrece un botón que no funciona.
  await expect(page.getByRole('button', { name: /Entrar con/ })).toHaveCount(0);
  await page.getByLabel('Idioma de la interfaz').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  // Un error de credenciales también se traduce, y el correo escrito se conserva.
  await page.getByLabel('Email').fill('nadie@e2e.local');
  await page.getByLabel('Password', { exact: true }).fill('incorrecta-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.error[role="alert"]')).toContainText('Incorrect email or password.');
  await expect(page.getByLabel('Email')).toHaveValue('nadie@e2e.local');
  await ctx.close();
});

test('límites en inglés y en español: mismos valores, textos traducidos, sin claves a la vista', async ({ browser }) => {
  const es = await abrir(browser, `/organizaciones/${orgId}/limites`);
  await expect(es.page.getByRole('heading', { name: 'Límites y consumo' })).toBeVisible();
  await expect(es.page.getByText('Tamaño máximo de un documento')).toBeVisible();
  await es.ctx.close();
  const en = await abrir(browser, `/organizaciones/${orgId}/limites`, { lang: 'en' });
  await expect(en.page.getByRole('heading', { name: 'Limits and consumption' })).toBeVisible();
  await expect(en.page.getByText('Maximum size of a document')).toBeVisible();
  await expect(en.page.getByText('Consumption is not a cost.')).toBeVisible();
  await expect(en.page.getByText(/not certified legal translations/).first()).toBeVisible();
  // El menú también cambia, y nada parece una clave de traducción.
  await expect(en.page.getByRole('link', { name: 'Platform cost', exact: true })).toBeVisible();
  const cuerpo = await en.page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/\b[a-z]+\.[a-z_]+\.[a-z_]+\b/);
  await en.ctx.close();
});

test('coste: sin tarifa no hay precio; con una tarifa sintética declarada se estima; en inglés también', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, `/organizaciones/${orgId}/coste`);
  await expect(page.getByRole('heading', { name: 'Coste de la plataforma' })).toBeVisible();
  await expect(page.getByText('No hay ninguna tarifa declarada.')).toBeVisible();
  // Estimar sin tarifa: «Sin tarifa», sin importe y sin ceros inventados.
  await page.getByLabel('Primer mes').fill('2026-01');
  await page.getByLabel('Número de meses').selectOption('2');
  await page.getByRole('button', { name: 'Registrar estimación' }).click();
  await expect(page.getByText('Sin estimación: no hay tarifa que cubra un mes completo (no es cero).')).toBeVisible();
  await expect(page.getByText('USD 0')).toHaveCount(0);
  // Declarar una tarifa SINTÉTICA.
  await page.getByLabel('USD por organización y mes').fill('10.0000');
  await page.getByLabel('Vigente desde (incluido)').fill('2026-01-01');
  await page.getByLabel('Nombre de la tarifa').fill('Tarifa SINTÉTICA de la prueba E2E');
  await page.getByLabel('De dónde sale').fill('Prueba automática: no es un acuerdo');
  await page.getByRole('button', { name: 'Declarar tarifa' }).click();
  await expect(page.getByText('Tarifa declarada. Queda versionada y no se puede editar.')).toBeVisible();
  await expect(page.getByText('Sintética (demostración)').first()).toBeVisible();
  // Estimar con tarifa.
  await page.getByLabel('Primer mes').fill('2026-01');
  await page.getByLabel('Número de meses').selectOption('2');
  await page.getByRole('button', { name: 'Registrar estimación' }).click();
  await expect(page.getByText('USD 20.0000').first()).toBeVisible();
  await expect(page.getByText('Es una estimación, no una factura.')).toBeVisible();
  // Reproducibilidad comprobada desde la pantalla.
  await page.getByRole('button', { name: 'Comprobar que se puede reproducir' }).first().click();
  await expect(page.getByText('Reproducible con sus entradas guardadas').first()).toBeVisible();
  await ctx.close();

  const en = await abrir(browser, `/organizaciones/${orgId}/coste`, { lang: 'en' });
  await expect(en.page.getByRole('heading', { name: 'Platform cost' })).toBeVisible();
  await expect(en.page.getByText('This is an estimate, not an invoice.')).toBeVisible();
  await expect(en.page.getByText('USD 20.0000').first()).toBeVisible();
  await expect(en.page.getByText('Synthetic (demonstration)').first()).toBeVisible();
  await expect(en.page.getByText('Items that are not priced').first()).toBeVisible();
  await en.ctx.close();
});

test('Mi cuenta: acceso federado deshabilitado se dice; el idioma se cambia con el teclado', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, '/cuenta');
  await expect(page.getByRole('heading', { name: 'Mi cuenta' })).toBeVisible();
  await expect(page.getByText('El acceso federado no está habilitado en este despliegue.')).toBeVisible();
  await page.locator('main #lang-switch').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
  await expect(page.getByText('Federated sign-in is not enabled in this deployment.')).toBeVisible();
  await ctx.close();
});

test('390 px: ninguna pantalla del recorrido desborda horizontalmente y se navega con teclado', async ({ browser }) => {
  for (const [ruta, titulo] of [['/cuenta', 'Mi cuenta'], [`/organizaciones/${orgId}/limites`, 'Límites y consumo'], [`/organizaciones/${orgId}/coste`, 'Coste de la plataforma']] as const) {
    const { ctx, page } = await abrir(browser, ruta, { viewport: { width: 390, height: 800 } });
    await expect(page.getByRole('heading', { name: titulo, level: 1 })).toBeVisible();
    await sinDesbordeHorizontal(page);
    // El menú se abre y se cierra con el teclado.
    await page.getByRole('button', { name: 'Menú' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: 'Mi cuenta' })).toBeVisible();
    await page.keyboard.press('Escape');
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await sinDesbordeHorizontal(page);
  await ctx.close();
});
