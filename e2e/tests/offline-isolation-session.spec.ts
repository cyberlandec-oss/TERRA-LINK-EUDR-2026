import { expect, test } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

test.describe.configure({ mode: 'serial' });
type User = { email: string; password: string };
type Fixture = { orgId: string; plotId: string; producerId: string; user: User; token: string; meId: string };
let a: Fixture;
let b: Fixture;

async function call(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const response = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function ok(path: string, init: Parameters<typeof call>[1] = {}) { const result = await call(path, init); if (result.status >= 300) throw new Error(`${init.method ?? 'GET'} ${path} -> ${result.status}`); return result.body; }

async function provision(superToken: string, orgId: string, label: string): Promise<Fixture> {
  const admin = { email: `offline-isolation-admin-${label}-${randomBytes(5).toString('hex')}@e2e.local`, password: randomBytes(12).toString('base64url') };
  const adminInvite = await ok(`/api/v1/organizations/${orgId}/invitations`, { method: 'POST', token: superToken, body: { email: admin.email, role_code: 'ORG_ADMIN' } });
  await ok('/api/v1/invitations/accept', { method: 'POST', body: { token: adminInvite.token, first_name: 'Offline', last_name: `Admin ${label}`, password: admin.password } });
  const adminToken = (await ok('/api/v1/auth/login', { method: 'POST', body: admin })).access_token;
  const user = { email: `offline-isolation-${label}-${randomBytes(5).toString('hex')}@e2e.local`, password: randomBytes(12).toString('base64url') };
  const invite = await ok(`/api/v1/organizations/${orgId}/invitations`, { method: 'POST', token: adminToken, body: { email: user.email, role_code: 'PRODUCER' } });
  await ok('/api/v1/invitations/accept', { method: 'POST', body: { token: invite.token, first_name: 'Offline', last_name: label, password: user.password } });
  const token = (await ok('/api/v1/auth/login', { method: 'POST', body: user })).access_token;
  const me = await ok('/api/v1/me', { token });
  const producer = await ok(`/api/v1/organizations/${orgId}/producers`, { method: 'POST', token: adminToken, body: { producer_code: `ISO-${label}-${randomBytes(4).toString('hex')}`, legal_name: `Synthetic ${label}` } });
  const members = await ok(`/api/v1/organizations/${orgId}/members`, { token: adminToken });
  const memberList = (Array.isArray(members) ? members : members.members) as Array<{ email?: string; user?: { email?: string }; membership_id?: string; id?: string }>;
  const member = memberList.find((item) => (item.email ?? item.user?.email ?? '').includes(`offline-isolation-${label.toLowerCase()}`));
  if (!member) throw new Error(`producer membership not found; returned=${JSON.stringify(memberList.map((item) => ({ email: item.email ?? item.user?.email ?? null, keys: Object.keys(item), membership_id: item.membership_id ?? item.id ?? null })))}`);
  const detail = await ok(`/api/v1/organizations/${orgId}/producers/${producer.id}`, { token: adminToken });
  await ok(`/api/v1/organizations/${orgId}/producers/${producer.id}/self-membership`, { method: 'PUT', token: adminToken, body: { expected_version: detail.row_version, membership_id: member.membership_id ?? member.id, reason: 'Offline isolation E2E' } });
  const plot = await ok(`/api/v1/organizations/${orgId}/plots`, { method: 'POST', token: adminToken, body: { producer_id: producer.id, plot_code: `ISO-PLOT-${label}-${randomBytes(4).toString('hex')}`, crop: 'Cacao' } });
  return { orgId, plotId: plot.id, producerId: producer.id, user, token, meId: me.id };
}

async function putRows(page: import('@playwright/test').Page, rows: unknown[]) {
  await page.evaluate(async (items) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('terra-link-offline-capture', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('location-captures', { keyPath: 'operation_id' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const tx = request.result.transaction('location-captures', 'readwrite'); for (const item of items) tx.objectStore('location-captures').put(item); tx.oncomplete = () => { request.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  }), rows);
}
async function rows(page: import('@playwright/test').Page) { return page.evaluate(() => new Promise<unknown[]>((resolve) => { const r = indexedDB.open('terra-link-offline-capture', 1); r.onsuccess = () => { const t = r.result.transaction('location-captures', 'readonly'); const g = t.objectStore('location-captures').getAll(); g.onsuccess = () => { r.result.close(); resolve(g.result); }; }; })); }
function pending(f: Fixture, operationId: string, status: 'PENDING' | 'CONFLICT' = 'PENDING') { return { operation_id: operationId, owner_key: f.meId, organization_id: f.orgId, plot_id: f.plotId, expected_version: 0, source: 'BROWSER_GEOLOCATION', latitude: -0.8, longitude: -80.1, accuracy_m: 4, captured_at: new Date().toISOString(), status, confirmed: true, capture_kind: 'LOCATION' }; }
async function loginThroughUi(page: import('@playwright/test').Page, user: User) {
  await page.locator('#email').fill(user.email); await page.locator('#password').fill(user.password); await page.getByRole('button', { name: /Iniciar sesi/i }).click();
  await page.waitForURL(/\/organizaciones/);
}

test('prepare isolated organization and two producers', async () => {
  const superToken = (await ok('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  const orgA = await ok('/api/v1/organizations', { method: 'POST', token: superToken, body: { name: `Offline isolation A ${randomBytes(4).toString('hex')}`, organization_type: 'COOPERATIVE', country: 'EC' } });
  const orgB = await ok('/api/v1/organizations', { method: 'POST', token: superToken, body: { name: `Offline isolation B ${randomBytes(4).toString('hex')}`, organization_type: 'COOPERATIVE', country: 'EC' } });
  a = await provision(superToken, orgA.id, 'A');
  b = await provision(superToken, orgB.id, 'B');
});

test('switching account keeps pending work isolated', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(([token, owner]) => { sessionStorage.setItem('tl_token', token); sessionStorage.setItem('tl_offline_owner_key', owner); }, [a.token, a.meId] as const);
  const page = await context.newPage();
  await page.goto(`/organizaciones/${a.orgId}/captura?plot_id=${a.plotId}`);
  await putRows(page, [pending(a, 'isolation-a')]);
  await page.getByRole('button', { name: /Cerrar sesi/i }).click(); await page.waitForURL(/\/$/);
  await loginThroughUi(page, b.user);
  await expect(page.getByTestId('contexto-usuario')).toHaveText(new RegExp(b.user.email, 'i'));
  await page.goto(`/organizaciones/${b.orgId}/captura?plot_id=${b.plotId}`);
  await expect(page.getByText(/captura\(s\) pendiente|captura pendiente/i)).not.toBeVisible();
  expect((await rows(page)).filter((row: any) => row.owner_key === b.meId)).toHaveLength(0);
  expect((await rows(page)).some((row: any) => row.operation_id === 'isolation-a')).toBe(true);
  a.token = (await ok('/api/v1/auth/login', { method: 'POST', body: a.user })).access_token;
  await page.evaluate(([token, owner]) => { sessionStorage.setItem('tl_token', token); sessionStorage.setItem('tl_offline_owner_key', owner); }, [a.token, a.meId]);
  await page.goto(`/organizaciones/${a.orgId}/captura?plot_id=${a.plotId}`);
  expect((await rows(page)).some((row: any) => row.operation_id === 'isolation-a')).toBe(true);
  await context.close();
});

test('expired session pauses and reauthentication resumes once', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(([token, owner]) => { sessionStorage.setItem('tl_token', token); sessionStorage.setItem('tl_offline_owner_key', owner); }, [a.token, a.meId] as const);
  const page = await context.newPage(); let attempts = 0; let expired = true;
  await page.route('**/api/v1/organizations/*/plots/*/location-samples', async (route) => { attempts += 1; if (expired) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHENTICATED', message: 'session expired' }) }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: { version_number: 1, sample: { received_at: new Date().toISOString() } } }) }); });
  await page.goto(`/organizaciones/${a.orgId}/captura?plot_id=${a.plotId}`);
  await putRows(page, [pending(a, 'session-a')]);
  await page.reload();
  await expect(page.getByText(/Capturar ubicaci|Capturar ubicación/i).first()).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => rows(page).then((r) => (r[0] as any)?.status)).toBe('PENDING');
  // El montaje y el evento online pueden observar el mismo pendiente una vez cada uno;
  // ambos deben detenerse tras 401, sin bucle automático.
  expect(attempts).toBeLessThanOrEqual(2);
  expired = false;
  await page.evaluate((token) => { sessionStorage.setItem('tl_token', token); window.dispatchEvent(new Event('online')); }, a.token);
  await expect.poll(() => rows(page).then((r) => r.some((x: any) => x.operation_id === 'session-a')), { timeout: 15_000 }).toBe(false);
  expect(attempts).toBeLessThanOrEqual(3);
  await context.close();
});

test('version conflict preserves local capture and exposes resolution', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(([token, owner]) => { sessionStorage.setItem('tl_token', token); sessionStorage.setItem('tl_offline_owner_key', owner); }, [a.token, a.meId] as const);
  const page = await context.newPage();
  page.on('response', async (response) => { if (response.url().includes('/location-samples')) console.log(`conflict-response=${response.status()} ${response.request().method()}`); });
  const before = await ok(`/api/v1/organizations/${a.orgId}/plots/${a.plotId}`, { token: a.token });
  await ok(`/api/v1/organizations/${a.orgId}/plots/${a.plotId}`, { method: 'PATCH', token: a.token, body: { expected_version: before.row_version, crop: 'Cacao actualizado' } });
  await page.goto(`/organizaciones/${a.orgId}/captura?plot_id=${a.plotId}`);
  const operationId = '00000000-0000-4000-8000-000000000001';
  await putRows(page, [{ ...pending(a, operationId, 'PENDING'), expected_version: before.row_version }]);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.reload();
  await expect.poll(() => rows(page).then((r) => (r[0] as any)?.status)).toBe('CONFLICT');
  await expect(page.getByText(/conflicto.*revisi|captura local se conserva/i).first()).toBeVisible();
  await page.getByRole('button', { name: /Revisar y resolver/i }).click();
  await expect.poll(() => rows(page).then((r) => r.some((x: any) => x.operation_id === operationId)), { timeout: 15_000 }).toBe(false);
  const versions = await ok(`/api/v1/organizations/${a.orgId}/plots/${a.plotId}/geometry-versions`, { token: a.token });
  expect((Array.isArray(versions) ? versions : versions.items ?? versions.data).length).toBeGreaterThan(0);
  await context.close();
});

test('service worker update does not delete pending storage', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.addInitScript(([token, owner]) => { sessionStorage.setItem('tl_token', token); sessionStorage.setItem('tl_offline_owner_key', owner); }, [a.token, a.meId] as const);
  const page = await context.newPage(); await page.goto(`/organizaciones/${a.orgId}/captura?plot_id=${a.plotId}`); await putRows(page, [pending(a, 'pwa-a')]);
  const before = await rows(page);
  await page.evaluate(async () => {
    await caches.open('terra-link-shell-v3');
    const old = await navigator.serviceWorker.ready;
    await old.update();
    const next = await navigator.serviceWorker.register('/sw.js?version=v4', { updateViaCache: 'none' });
    if (next.waiting) next.waiting.postMessage({ type: 'SKIP_WAITING' });
    await navigator.serviceWorker.ready;
    await new Promise<void>((resolve) => { if (navigator.serviceWorker.controller) resolve(); else navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }); });
  });
  await page.reload();
  const cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames.some((name) => name === 'terra-link-shell-v4')).toBe(true);
  expect(cacheNames.some((name) => name === 'terra-link-shell-v3')).toBe(false);
  expect((await rows(page)).some((row: any) => row.operation_id === 'pwa-a')).toBe(true); expect(before).toHaveLength(1); await context.close();
});
