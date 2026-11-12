import { expect, test } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

test.describe.configure({ mode: 'serial' });
const admin = { email: `offline-photo-admin-${randomBytes(5).toString('hex')}@e2e.local`, password: randomBytes(12).toString('base64url') };
const producer = { email: `offline-photo-producer-${randomBytes(5).toString('hex')}@e2e.local`, password: randomBytes(12).toString('base64url') };
let orgId = '';
let plotId = '';
let producerToken = '';

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const response = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function ok(path: string, init: Parameters<typeof api>[1] = {}) {
  const result = await api(path, init);
  if (result.status >= 300) throw new Error(`${init.method ?? 'GET'} ${path} -> ${result.status}`);
  return result.body;
}
async function queueHas(page: import('@playwright/test').Page, title: string) {
  return page.evaluate(async (expected) => new Promise<boolean>((resolve) => {
    const request = indexedDB.open('terra-link-offline-capture', 1);
    request.onerror = () => resolve(false);
    request.onsuccess = () => { const tx = request.result.transaction('location-captures', 'readonly'); const get = tx.objectStore('location-captures').getAll(); get.onsuccess = () => resolve(get.result.some((row: { title?: string; status?: string }) => row.title === expected && row.status === 'PENDING')); };
  }), title);
}

test('prepare isolated producer and plot', async () => {
  const superToken = (await ok('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgId = (await ok('/api/v1/organizations', { method: 'POST', token: superToken, body: { name: `Offline Photo ${randomBytes(4).toString('hex')}`, organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const invite = async (user: { email: string; password: string }, role: string, token: string) => { const invitation = await ok(`/api/v1/organizations/${orgId}/invitations`, { method: 'POST', token, body: { email: user.email, role_code: role } }); await ok('/api/v1/invitations/accept', { method: 'POST', body: { token: invitation.token, first_name: 'Offline', last_name: 'Photo', password: user.password } }); };
  await invite(admin, 'ORG_ADMIN', superToken);
  const adminToken = (await ok('/api/v1/auth/login', { method: 'POST', body: admin })).access_token;
  await invite(producer, 'PRODUCER', adminToken);
  producerToken = (await ok('/api/v1/auth/login', { method: 'POST', body: producer })).access_token;
  const producerRow = (await ok(`/api/v1/organizations/${orgId}/producers`, { method: 'POST', token: adminToken, body: { producer_code: `OFF-${randomBytes(4).toString('hex')}`, legal_name: 'Synthetic offline producer' } })).id;
  const members = await ok(`/api/v1/organizations/${orgId}/members`, { token: adminToken });
  const member = (Array.isArray(members) ? members : members.members).find((item: { email: string }) => item.email === producer.email);
  const detail = await ok(`/api/v1/organizations/${orgId}/producers/${producerRow}`, { token: adminToken });
  await ok(`/api/v1/organizations/${orgId}/producers/${producerRow}/self-membership`, { method: 'PUT', token: adminToken, body: { expected_version: detail.row_version, membership_id: member.membership_id, reason: 'Offline test' } });
  plotId = (await ok(`/api/v1/organizations/${orgId}/plots`, { method: 'POST', token: adminToken, body: { producer_id: producerRow, plot_code: `OFF-PLOT-${randomBytes(4).toString('hex')}`, crop: 'Cacao' } })).id;
});

async function openCapture(browser: import('@playwright/test').Browser, title: string) {
  const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
  const me = await ok('/api/v1/me', { token: producerToken });
  await context.addInitScript(([token, owner]) => { sessionStorage.setItem('tl_token', token); sessionStorage.setItem('tl_offline_owner_key', owner); }, [producerToken, me.id] as const);
  const page = await context.newPage();
  await page.goto(`/organizaciones/${orgId}/captura?plot_id=${plotId}`);
  await page.locator('#cap-plotsel').selectOption(plotId);
  await page.locator('#fe-file').setInputFiles({ name: 'offline-evidence.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% synthetic\n%%EOF\n') });
  await page.locator('#fe-title-in').fill(title);
  return { context, page };
}

test('offline photo syncs once after reconnect', async ({ browser }) => {
  const title = `Photo offline ${randomBytes(6).toString('hex')}`;
  const { context, page } = await openCapture(browser, title);
  await context.setOffline(true);
  await page.getByRole('button', { name: /Subir evidencia|Upload evidence/i }).click();
  await expect.poll(() => queueHas(page, title)).toBe(true);
  await page.reload();
  await expect(page.getByText(title)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: /Captura de campo|Field capture/i })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => { const docs = await ok(`/api/v1/organizations/${orgId}/documents?owner_type=plot&owner_id=${plotId}`, { token: producerToken }); const items = (Array.isArray(docs) ? docs : docs.items ?? docs.data) as Array<{ title?: string; document_type: string }>; return items.filter((item) => item.title === title && item.document_type === 'FIELD_EVIDENCE').length; }, { timeout: 30_000 }).toBe(1);
  await context.close();
});

test('lost response keeps pending and retry remains idempotent', async ({ browser }) => {
  const title = `Photo retry ${randomBytes(6).toString('hex')}`;
  const { context, page } = await openCapture(browser, title);
  await context.setOffline(true);
  await page.getByRole('button', { name: /Subir evidencia|Upload evidence/i }).click();
  await expect.poll(() => queueHas(page, title)).toBe(true);
  await page.reload();
  await expect(page.getByText(title)).toBeVisible();
  let cutResponse = true;
  await page.route('**/api/v1/organizations/*/documents', async (route) => { if (!cutResponse || route.request().method() !== 'POST') return route.continue(); await route.fetch(); cutResponse = false; await route.abort('connectionreset'); });
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: /Captura de campo|Field capture/i })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => queueHas(page, title), { timeout: 30_000 }).toBe(true);
  await page.unroute('**/api/v1/organizations/*/documents');
  await page.reload();
  await expect.poll(async () => { const docs = await ok(`/api/v1/organizations/${orgId}/documents?owner_type=plot&owner_id=${plotId}`, { token: producerToken }); const items = (Array.isArray(docs) ? docs : docs.items ?? docs.data) as Array<{ title?: string; document_type: string }>; return items.filter((item) => item.title === title && item.document_type === 'FIELD_EVIDENCE').length; }, { timeout: 30_000 }).toBe(1);
  await page.reload();
  await expect.poll(() => queueHas(page, title)).toBe(false);
  await context.close();
});
