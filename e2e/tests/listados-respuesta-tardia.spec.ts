import { expect, test } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// Defecto de la corrida 2026-10-23T06-53-02: en «Productores», el listado inicial (sin filtro) terminó 1 ms DESPUÉS de la búsqueda del formulario y pisó su resultado
// (3 filas en vez de 1). Aquí se reproduce de forma DETERMINISTA retrasando a propósito la respuesta del listado sin filtro: la búsqueda más reciente debe prevalecer.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-tardia@e2e.local', password: randomBytes(12).toString('base64url') };
let token = ''; let orgId = '';

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body?.error?.code)}`);
  return body;
}

test('preparación: organización con tres productores de comunidades distintas', async () => {
  const superTok = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgId = (await api('/api/v1/organizations', { method: 'POST', token: superTok, body: { name: 'Cooperativa Respuesta Tardía', organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const inv = await api(`/api/v1/organizations/${orgId}/invitations`, { method: 'POST', token: superTok, body: { email: ADMIN.email, role_code: 'ORG_ADMIN' } });
  await api('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: 'Tardía', last_name: 'Prueba', password: ADMIN.password } });
  token = (await api('/api/v1/auth/login', { method: 'POST', body: { email: ADMIN.email, password: ADMIN.password } })).access_token;
  for (const [code, name, community] of [['TD-1', 'Finca Uno', 'Río Chico'], ['TD-2', 'Finca Dos', 'La Esperanza'], ['TD-3', 'Finca Tres', 'San Isidro']]) {
    await api(`/api/v1/organizations/${orgId}/producers`, { method: 'POST', token, body: { producer_code: code, legal_name: name, community } });
  }
});

test('una respuesta vieja (listado sin filtro, tardía) no pisa el resultado de la búsqueda más reciente', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript((t) => sessionStorage.setItem('tl_token', t), token);
  const page = await ctx.newPage();
  // Retrasa SOLO el listado sin filtro de la carga inicial; la búsqueda con `q=` responde enseguida.
  await page.route(/\/producers\?(?!.*q=)/, async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
  await page.goto(`/organizaciones/${orgId}/productores`);
  await page.getByLabel('Buscar por código, nombre o comunidad').fill('río chico');
  await page.getByRole('button', { name: 'Buscar' }).click();
  const filas = page.getByRole('table', { name: 'Productores' }).locator('tbody tr');
  await expect(filas).toHaveCount(1);                       // el resultado de la búsqueda
  await page.waitForTimeout(3500);                          // llega la respuesta vieja del listado sin filtro
  await expect(filas).toHaveCount(1);                       // y NO lo pisa
  await expect(filas.first()).toContainText('TD-1');
  await ctx.close();
});
