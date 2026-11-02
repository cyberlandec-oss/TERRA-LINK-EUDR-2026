import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// P1-007 — Pantalla «Conexión EUDR-IS». Datos y credenciales SINTÉTICOS propios; la plataforma de pruebas tiene las llamadas a EUDR-IS DESHABILITADAS (no sale ninguna llamada).
// Comprueba: se registra una credencial, NO se vuelve a mostrar (ni en pantalla ni en la API), el Echo queda deshabilitado con su motivo, ACCEPTANCE y PRODUCTION son
// independientes, quien solo lee no administra, y 390 px.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-eudris@e2e.local', password: randomBytes(12).toString('base64url') };
const GERENTE = { email: 'gerente-eudris@e2e.local', password: randomBytes(12).toString('base64url') };
let adminTok = ''; let audTok = ''; let orgId = '';
const CLAVE = `clave-sintetica-${randomBytes(6).toString('hex')}`;

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body?.error?.code)}`);
  return body;
}
const abrir = async (browser: import('@playwright/test').Browser, token: string, viewport?: { width: number; height: number }): Promise<Page> => {
  const ctx = await browser.newContext({ ...(viewport ? { viewport } : {}) });
  await ctx.addInitScript((t) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', 'es'); }, token);
  const page = await ctx.newPage();
  await page.goto(`/organizaciones/${orgId}/eudr-is`);
  return page;
};

test('preparación: organización, administrador y gerente (solo lectura)', async () => {
  const superTok = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgId = (await api('/api/v1/organizations', { method: 'POST', token: superTok, body: { name: 'Exportadora EUDR-IS (sintética)', organization_type: 'EXPORTER', country: 'EC' } })).id;
  const alta = async (u: { email: string; password: string }, rol: string, por: string, nombre: string) => {
    const inv = await api(`/api/v1/organizations/${orgId}/invitations`, { method: 'POST', token: por, body: { email: u.email, role_code: rol } });
    await api('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: nombre, last_name: 'Prueba', password: u.password } });
    return (await api('/api/v1/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).access_token as string;
  };
  adminTok = await alta(ADMIN, 'ORG_ADMIN', superTok, 'Administradora');
  audTok = await alta(GERENTE, 'MANAGER', adminTok, 'Gerente');
});

test('registrar una credencial de ACCEPTANCE: queda guardada, no se vuelve a mostrar y el Echo está deshabilitado con su motivo', async ({ browser }) => {
  const page = await abrir(browser, adminTok);
  await expect(page.getByRole('heading', { name: 'Conexión con EUDR-IS' })).toBeVisible();
  await expect(page.getByText('Las llamadas a EUDR-IS están deshabilitadas en esta plataforma')).toBeVisible();
  const aceptacion = page.locator('section', { has: page.getByRole('heading', { name: /ACCEPTANCE/ }) });
  await expect(aceptacion.getByText('Sin credenciales')).toBeVisible();
  await expect(aceptacion.getByRole('button', { name: 'Comprobar conexión (Echo)' })).toBeDisabled();
  await aceptacion.getByText('Registrar o rotar credenciales de ACCEPTANCE').click();
  await aceptacion.getByLabel('Usuario de servicios web').fill('usuario-sintetico');
  await aceptacion.getByLabel('Authentication Key').fill(CLAVE);
  await aceptacion.getByLabel('WebServiceClientId').fill('cliente-sintetico');
  await aceptacion.getByRole('button', { name: 'Guardar credenciales' }).click();
  await expect(page.getByText('Credenciales de ACCEPTANCE guardadas (cifradas).')).toBeVisible();
  await expect(aceptacion.getByText('Credenciales registradas')).toBeVisible();
  // El valor no permanece en pantalla ni en los campos; PRODUCTION sigue sin credenciales (independientes).
  await expect(page.getByText(CLAVE)).toHaveCount(0);
  expect(await page.content()).not.toContain(CLAVE);
  const produccion = page.locator('section', { has: page.getByRole('heading', { name: /PRODUCTION/ }) });
  await expect(produccion.getByText('Sin credenciales')).toBeVisible();
  await expect(produccion.getByText(/no documenta un servicio Echo/)).toBeVisible();
  // La API tampoco lo devuelve.
  const estado = JSON.stringify(await api(`/api/v1/organizations/${orgId}/eudr-is/credentials`, { token: adminTok }));
  expect(estado).not.toContain(CLAVE);
  expect(estado).not.toContain('usuario-sintetico');
});

test('el gerente consulta el estado pero no registra credenciales ni comprueba la conexión (control: el administrador sí)', async ({ browser }) => {
  const page = await abrir(browser, audTok);
  await expect(page.getByRole('heading', { name: 'Conexión con EUDR-IS' })).toBeVisible();
  await expect(page.getByText('Tu rol puede consultar el estado, no registrar credenciales ni comprobar la conexión.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar credenciales' })).toHaveCount(0);
  const res = await fetch(`${API_URL}/api/v1/organizations/${orgId}/eudr-is/credentials/ACCEPTANCE`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${audTok}` }, body: JSON.stringify({ username: 'x-sintetico', authentication_key: 'clave-sintetica-1', web_service_client_id: 'c-sintetico' }) });
  expect(res.status).toBe(403);
});

test('390 px sin desplazamiento horizontal', async ({ browser }) => {
  const page = await abrir(browser, adminTok, { width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Conexión con EUDR-IS' })).toBeVisible();
  const exceso = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(exceso).toBeLessThanOrEqual(0);
});
