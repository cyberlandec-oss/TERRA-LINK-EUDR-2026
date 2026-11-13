import { expect, test } from '@playwright/test';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { randomBytes } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { API_URL, SUPER_EMAIL, WEB_URL } from '../env';

test.describe.configure({ mode: 'serial' });

const producer = { email: `offline-polygon-${randomBytes(5).toString('hex')}@e2e.local`, password: randomBytes(12).toString('base64url') };
const admin = { email: `offline-polygon-admin-${randomBytes(5).toString('hex')}@e2e.local`, password: randomBytes(12).toString('base64url') };
let orgId = '';
let plotId = '';
let producerId = '';
let producerToken = '';
let ownerId = '';

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const response = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function ok(path: string, init: Parameters<typeof api>[1] = {}) {
  const result = await api(path, init);
  if (result.status >= 300) throw new Error(`${init.method ?? 'GET'} ${path} -> ${result.status}`);
  return result.body;
}

test('prepara parcela aislada para captura offline', async () => {
  const superToken = (await ok('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgId = (await ok('/api/v1/organizations', { method: 'POST', token: superToken, body: { name: `Offline Polygon ${randomBytes(4).toString('hex')}`, organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const invite = async (email: string, role: string, token: string, password: string) => { const invitation = await ok(`/api/v1/organizations/${orgId}/invitations`, { method: 'POST', token, body: { email, role_code: role } }); await ok('/api/v1/invitations/accept', { method: 'POST', body: { token: invitation.token, first_name: 'Offline', last_name: 'Polygon', password } }); };
  await invite(admin.email, 'ORG_ADMIN', superToken, admin.password);
  const adminToken = (await ok('/api/v1/auth/login', { method: 'POST', body: admin })).access_token;
  await invite(producer.email, 'PRODUCER', adminToken, producer.password);
  producerToken = (await ok('/api/v1/auth/login', { method: 'POST', body: producer })).access_token;
  const producerRow = (await ok(`/api/v1/organizations/${orgId}/producers`, { method: 'POST', token: adminToken, body: { producer_code: `OFF-P-${randomBytes(4).toString('hex')}`, legal_name: 'Synthetic polygon producer' } })).id;
  producerId = producerRow;
  const members = await ok(`/api/v1/organizations/${orgId}/members`, { token: adminToken });
  const member = (Array.isArray(members) ? members : members.members).find((item: { email: string }) => item.email === producer.email);
  const detail = await ok(`/api/v1/organizations/${orgId}/producers/${producerRow}`, { token: adminToken });
  await ok(`/api/v1/organizations/${orgId}/producers/${producerRow}/self-membership`, { method: 'PUT', token: adminToken, body: { expected_version: detail.row_version, membership_id: member.membership_id, reason: 'Offline polygon test' } });
  plotId = (await ok(`/api/v1/organizations/${orgId}/plots`, { method: 'POST', token: adminToken, body: { producer_id: producerRow, plot_code: `OFF-PLOT-${randomBytes(4).toString('hex')}`, crop: 'Cacao' } })).id;
  ownerId = (await ok('/api/v1/me', { token: producerToken })).id;
});

async function openPersistent(userDataDir: string) {
  const context = await chromium.launchPersistentContext(userDataDir, { baseURL: WEB_URL, serviceWorkers: 'allow', viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: -0.848, longitude: -80.16, accuracy: 8 } });
  await context.addInitScript(([token, owner]) => { sessionStorage.setItem('tl_token', token); sessionStorage.setItem('tl_offline_owner_key', owner); }, [producerToken, ownerId] as const);
  return context;
}

async function addVertex(page: Page, context: BrowserContext, latitude: number, longitude: number, accuracy: number) {
  await context.setGeolocation({ latitude, longitude, accuracy });
  await page.getByRole('button', { name: /A.*adir v.*rtice/ }).click();
  await expect(page.getByLabel(/Muestra del v.*rtice/)).toContainText(String(latitude));
  await page.getByRole('button', { name: /Guardar v.*rtice/ }).click();
}

function observePage(page: Page) {
  page.on('console', (message) => console.log(`browser-console=${message.type()}:${message.text().slice(0, 300)}`));
  page.on('requestfailed', (request) => console.log(`request-failed=${request.method()} ${request.url().replace(/([?&])(token|authorization)=[^&]*/gi, '$1$2=REDACTED')}:${request.failure()?.errorText ?? 'unknown'}`));
  page.on('response', (response) => { if (response.status() >= 400) console.log(`response-error=${response.status()} ${response.request().method()} ${response.url().replace(/([?&])(token|authorization)=[^&]*/gi, '$1$2=REDACTED')}`); });
}

test('polígono offline sobrevive a reapertura y sincroniza una sola vez', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'tl-offline-polygon-'));
  let context: BrowserContext | undefined;
  try {
    context = await openPersistent(userDataDir);
    let page = await context.newPage();
    observePage(page);
    await page.goto(`/organizaciones/${orgId}/parcelas/${plotId}?productor=${producerId}`);
    console.log(`initial-url=${page.url()}`);
    console.log(`initial-body=${(await page.locator('body').innerText()).slice(0, 500).replace(/\s+/g, ' ')}`);
    await expect(page.getByRole('heading', { name: /OFF-PLOT/ })).toBeVisible({ timeout: 30_000 });
    await page.evaluate(async () => { if ('serviceWorker' in navigator) await navigator.serviceWorker.ready; });
    await page.getByRole('button', { name: /Pol.*gono por v.*rtices/ }).click();
    await context.setOffline(true);
    console.log('stage=offline-start');
    await page.getByRole('button', { name: /Iniciar captura de pol.*gono/ }).click();
    await addVertex(page, context, -0.848, -80.16, 8);
    await addVertex(page, context, -0.848, -80.159, 9);
    await addVertex(page, context, -0.847, -80.159, 10);
    await expect(page.getByText(/3 v.*rtices/).first()).toBeVisible();
    const localCount = await page.evaluate(() => new Promise<number>((resolve, reject) => { const request = indexedDB.open('terra-link-offline-capture', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const tx = request.result.transaction('location-captures', 'readonly'); const get = tx.objectStore('location-captures').getAll(); get.onsuccess = () => resolve(get.result.filter((row: { capture_kind: string }) => row.capture_kind === 'POLYGON_VERTEX').length); }; }));
    expect(localCount).toBe(3);
    console.log('stage=local-vertices count=3');
    await context.close();
    console.log('stage=context-closed');
    context = await openPersistent(userDataDir);
    await context.setOffline(true);
    page = await context.newPage();
    observePage(page);
    await page.goto(`/organizaciones/${orgId}/parcelas/${plotId}?productor=${producerId}`);
    await expect(page.getByText('Polígono pendiente')).toBeVisible();
    await expect(page.getByText('3 vértice(s) guardado(s) localmente')).toBeVisible();
    await expect(page.locator('ol li')).toHaveCount(3);
    console.log('stage=reopened-offline count=3');
    await context.setOffline(false);
    console.log('stage=online-event');
    await expect(page.getByRole('heading', { name: /OFF-PLOT/ })).toBeVisible({ timeout: 30_000 });
    console.log('stage=returned-to-app');
    await expect.poll(async () => { const result = await api(`/api/v1/organizations/${orgId}/plots/${plotId}/polygon-drafts/current`, { token: producerToken }); const draft = result.body?.draft; return draft?.vertices?.length ?? 0; }, { timeout: 30_000 }).toBe(3);
    console.log('stage=server-vertices count=3');
    const current = await ok(`/api/v1/organizations/${orgId}/plots/${plotId}/polygon-drafts/current`, { token: producerToken });
    expect(new Set(current.draft.vertices.map((vertex: { id: string }) => vertex.id)).size).toBe(3);
    await page.getByRole('button', { name: /Revisar y confirmar/ }).click();
    await expect(page.getByRole('heading', { name: /Revisi.n antes de confirmar/ })).toBeVisible();
    await page.getByRole('button', { name: /Confirmar pol.gono/ }).click();
    await expect(page.getByText(/Pol.gono guardado como versi.n/)).toBeVisible();
    const versions = await ok(`/api/v1/organizations/${orgId}/plots/${plotId}/geometry-versions`, { token: producerToken });
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.at(-1).geometry_type).toBe('POLYGON');
    await page.reload();
    const again = await ok(`/api/v1/organizations/${orgId}/plots/${plotId}/polygon-drafts/current`, { token: producerToken });
    expect(again.draft).toBeNull();
  } finally {
    await context?.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
