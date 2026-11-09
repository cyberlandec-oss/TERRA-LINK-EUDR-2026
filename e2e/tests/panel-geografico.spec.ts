import { expect, test, type Browser } from '@playwright/test';
import { randomBytes, randomUUID } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// Panel «Evaluación geográfica técnica actual» del expediente (implementación del requisito original GEOLOCATION_PROFILE, I1–I4): consulta separada de la
// instantánea, con vigencia, pendientes distinguidos, permisos, español e inglés, teclado y 390 px. NO cumple GEOLOCATION_PROFILE (D-05.B pendiente). Datos SINTÉTICOS.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-geo@e2e.local', password: randomBytes(12).toString('base64url') };
const EUDR = { email: 'eudr-geo@e2e.local', password: randomBytes(12).toString('base64url') };
const AUD = { email: 'auditor-geo@e2e.local', password: randomBytes(12).toString('base64url') };
const ADMIN_B = { email: 'admin-geo-b@e2e.local', password: randomBytes(12).toString('base64url') };
const tok: Record<string, string> = {};
let orgA = ''; let orgB = ''; let caseId = ''; let snapId = ''; let hashAntes = ''; let plotObs = '';

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body?.error?.code)}`);
  return body;
}
async function abrir(browser: Browser, quien: string, ruta: string, opts: { lang?: 'es' | 'en'; viewport?: { width: number; height: number } } = {}) {
  const ctx = await browser.newContext({ ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [tok[quien], opts.lang ?? 'es'] as const);
  const page = await ctx.newPage();
  await page.goto(ruta);
  return { ctx, page };
}

test('preparación: expediente con tres parcelas (vigente, sin evaluación y obsoleta) y una instantánea capturada ANTES de consultar el panel', async () => {
  const superTok = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgA = (await api('/api/v1/organizations', { method: 'POST', token: superTok, body: { name: 'Cooperativa Panel Geográfico A', organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  orgB = (await api('/api/v1/organizations', { method: 'POST', token: superTok, body: { name: 'Cooperativa Panel Geográfico B', organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const alta = async (org: string, u: { email: string; password: string }, rol: string, por: string) => {
    const inv = await api(`/api/v1/organizations/${org}/invitations`, { method: 'POST', token: por, body: { email: u.email, role_code: rol } });
    await api('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: 'Prueba', last_name: 'Geo', password: u.password } });
  };
  const login = async (u: { email: string; password: string }) => (await api('/api/v1/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).access_token as string;
  await alta(orgA, ADMIN, 'ORG_ADMIN', superTok); tok.admin = await login(ADMIN);
  await alta(orgB, ADMIN_B, 'ORG_ADMIN', superTok); tok.adminB = await login(ADMIN_B);
  await alta(orgA, EUDR, 'EUDR_MANAGER', tok.admin); tok.eudr = await login(EUDR);
  await alta(orgA, AUD, 'AUDITOR', tok.admin); tok.aud = await login(AUD);
  const b = `/api/v1/organizations/${orgA}`; const hoy = new Date().toISOString().slice(0, 10);
  await api(`${b}/products`, { method: 'POST', token: tok.admin, body: { code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' } });
  const producto = ((await api(`${b}/products?limit=100`, { token: tok.admin })).items as Array<{ id: string; code: string }>).find((p) => p.code === 'CACAO_BABA')!.id;
  await api(`${b}/locations`, { method: 'POST', token: tok.admin, body: { code: 'C-GEO', name: 'Centro geo', location_type: 'COLLECTION_CENTER' } });
  const centro = ((await api(`${b}/locations`, { token: tok.admin })) as Array<{ id: string; code: string }>).find((l) => l.code === 'C-GEO')!.id;
  const prod = (await api(`${b}/producers`, { method: 'POST', token: tok.admin, body: { producer_code: 'P-GEO', legal_name: 'Finca Panel Geo' } })).id;
  const mkPlot = async (code: string, x: number) => {
    const id = (await api(`${b}/plots`, { method: 'POST', token: tok.admin, body: { producer_id: prod, plot_code: code, crop: 'Cacao' } })).id as string;
    await api(`${b}/plots/${id}/geometry-versions`, { method: 'POST', token: tok.admin, body: { expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [x, -0.85] }, area_declared_ha: 2 } });
    return id;
  };
  const pOk = await mkPlot('GEO-OK', -80.1); const pAus = await mkPlot('GEO-AUS', -80.2); plotObs = await mkPlot('GEO-OBS', -80.3);
  const lote = async () => {
    const d = (await api(`${b}/deliveries`, { method: 'POST', token: tok.admin, body: { operation_id: randomUUID(), producer_id: prod, product_id: producto, delivery_date: hoy, quantity_declared: '30', unit: 'KG', origins: [pOk, pAus, plotObs].map((p) => ({ plot_id: p })), register: true } })).delivery;
    const rec = (await api(`${b}/deliveries/${d.id}/receptions`, { method: 'POST', token: tok.admin, body: { operation_id: randomUUID(), location_id: centro, received_at: new Date().toISOString(), weighing: { method: 'Báscula', quantity: '30', unit: 'KG', weighed_on: hoy } } })).reception_id;
    const l = await api(`${b}/lots`, { method: 'POST', token: tok.admin, body: { operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '30' }] } });
    return (l.id ?? l.lot?.id) as string;
  };
  const lot = await lote();
  await api(`${b}/risk/lots/${lot}/evaluations`, { method: 'POST', token: tok.eudr, body: { operation_id: randomUUID() } });
  caseId = (await api(`${b}/dd-cases`, { method: 'POST', token: tok.eudr, body: { operation_id: randomUUID(), lot_id: lot, scope_note: 'Expediente sintético del panel geográfico' } })).case.id;
  const s = (await api(`${b}/dd-cases/${caseId}/snapshots`, { method: 'POST', token: tok.eudr, body: { operation_id: randomUUID() } })).snapshot;
  snapId = s.id; hashAntes = s.content_hash;
  // Evaluaciones DESPUÉS de la instantánea (no forman parte de su contenido): una vigente y una que se vuelve obsoleta al cambiar la geometría.
  for (const p of [pOk, plotObs]) await api(`${b}/plots/${p}/geo-profile/evaluations`, { method: 'POST', token: tok.admin, body: { operation_id: randomUUID() } });
  const rv = (await api(`${b}/plots/${plotObs}`, { token: tok.admin })).row_version as number;
  await api(`${b}/plots/${plotObs}/geometry-versions`, { method: 'POST', token: tok.admin, body: { expected_version: rv, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.31, -0.85] }, area_declared_ha: 2 } });
  expect(hashAntes).toMatch(/^[0-9a-f]{64}$/);
});

test('panel en español: vigencia, ausencia y obsolescencia distinguidas, pendientes, aviso de que no es la instantánea ni el requisito', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'admin', `/organizaciones/${orgA}/diligencia/${caseId}`);
  const panel = page.getByRole('region', { name: 'Evaluación geográfica técnica actual' });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText('Consulta actual, separada de la instantánea')).toBeVisible();
  await expect(panel).toContainText('No forma parte del contenido de ninguna instantánea');
  const filas = panel.getByRole('table', { name: 'Evaluación geográfica técnica por parcela' }).locator('tbody tr');
  await expect(filas).toHaveCount(3);
  await expect(filas.filter({ hasText: 'GEO-OK' })).toContainText('Cumple el perfil técnico');
  await expect(filas.filter({ hasText: 'GEO-OK' })).toContainText('Vigente');
  await expect(filas.filter({ hasText: 'GEO-AUS' })).toContainText('Sin evaluación');
  await expect(filas.filter({ hasText: 'GEO-OBS' })).toContainText('Obsoleta');
  await expect(filas.filter({ hasText: 'GEO-OBS' })).toContainText('La geometría cambió');
  await expect(filas.filter({ hasText: 'GEO-AUS' })).toContainText('Evaluar el perfil técnico de la versión vigente');
  const pendientes = panel.getByRole('heading', { name: 'Pendientes de evaluación vigente' });
  await expect(pendientes).toBeVisible();
  await expect(panel.getByRole('listitem').filter({ hasText: 'GEO-AUS' })).toContainText('Sin evaluación');
  await expect(panel.getByRole('listitem').filter({ hasText: 'GEO-OBS' })).toContainText('Obsoleta');
  await expect(panel.getByRole('link', { name: 'GEO-AUS' }).first()).toHaveAttribute('href', new RegExp(`/organizaciones/${orgA}/parcelas/`));
  // El aviso ya no es fijo: muestra el estado ACTUAL del requisito con su motivo (aquí, sin configuración adoptada), aparte de lo guardado en la instantánea.
  await expect(panel.getByText('Estado actual del requisito GEOLOCATION_PROFILE', { exact: true })).toBeVisible();
  await expect(panel).toContainText('no ha adoptado ninguna configuración de geolocalización');
  await expect(panel).toContainText('Sin configuración adoptada');
  await expect(panel).toContainText('Esto no habilita READY');
  await expect(panel).toContainText('Estado de GEOLOCATION_PROFILE en la última instantánea (1): No evaluable');
  await ctx.close();
});

test('la instantánea no cambia: mismo hash, no desactualizada por consultar el panel; sigue consultable con su contenido original', async () => {
  const s = await api(`/api/v1/organizations/${orgA}/dd-snapshots/${snapId}`, { token: tok.admin });
  expect(s.content_hash).toBe(hashAntes);
  // La instantánea SÍ está desactualizada, pero por su mecanismo existente (cambió la geometría de GEO-OBS), no por el panel.
  expect(s.readiness.effective).toBe('STALE');
  expect(s.readiness.changed_sections).toEqual(expect.arrayContaining(['plots']));
  expect(JSON.stringify(s.content)).not.toMatch(/EUDR_GEO_V1|MEETS_PROFILE|geo_profile/);
  expect(s.content.plots.map((p: { plot_code: string }) => p.plot_code).sort()).toEqual(['GEO-AUS', 'GEO-OBS', 'GEO-OK']);
  const req = s.requirements.find((r: { code: string }) => r.code === 'GEOLOCATION_PROFILE');
  expect(req.status).toBe('NOT_EVALUABLE');
});

test('permisos: el auditor ve el estado pero no la explicación detallada; otra organización recibe 404; sin sesión de organización no hay panel', async ({ browser }) => {
  const a = await abrir(browser, 'aud', `/organizaciones/${orgA}/diligencia/${caseId}`);
  const panel = a.page.getByRole('region', { name: 'Evaluación geográfica técnica actual' });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole('table').locator('tbody tr')).toHaveCount(3);
  const cuerpo = await panel.innerText();
  expect(cuerpo).not.toMatch(/coordinates/);
  await a.ctx.close();
  const api2 = async (org: string, quien: string) => (await fetch(`${API_URL}/api/v1/organizations/${org}/dd-cases/${caseId}/geo-evaluation`, { headers: { authorization: `Bearer ${tok[quien]}` } })).status;
  expect(await api2(orgA, 'admin')).toBe(200);         // control autorizado
  expect(await api2(orgA, 'adminB')).toBe(404);
  expect(await api2(orgB, 'adminB')).toBe(404);
  const det = await (await fetch(`${API_URL}/api/v1/organizations/${orgA}/dd-cases/${caseId}/geo-evaluation`, { headers: { authorization: `Bearer ${tok.aud}` } })).json();
  expect(det.plots.every((p: { detail_restricted: boolean }) => p.detail_restricted)).toBe(true);
});

test('inglés, teclado y 390 px: el mismo panel, sin desborde y sin códigos internos', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'admin', `/organizaciones/${orgA}/diligencia/${caseId}`, { lang: 'en', viewport: { width: 390, height: 844 } });
  const panel = page.getByRole('region', { name: 'Current technical geographic evaluation' });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText('Current lookup, separate from the snapshot')).toBeVisible();
  const filas = panel.getByRole('table', { name: 'Technical geographic evaluation by plot' }).locator('tbody tr');
  await expect(filas.filter({ hasText: 'GEO-OBS' })).toContainText('Outdated');
  await expect(filas.filter({ hasText: 'GEO-AUS' })).toContainText('No evaluation');
  await expect(filas.filter({ hasText: 'GEO-OK' })).toContainText('Current');
  await expect(panel).toContainText('Current status of requirement GEOLOCATION_PROFILE');
  await expect(panel).toContainText('No configuration adopted');
  const texto = await panel.innerText();
  expect(texto).not.toMatch(/\b(NEVER_EVALUATED|GEOMETRY_VERSION_CHANGED|PROFILE_VERSION_CHANGED|NO_GEOMETRY_VERSION|MEETS_PROFILE|DOES_NOT_MEET|EVALUATE_PROFILE|CORRECT_GEOMETRY)\b/);
  const boton = panel.getByRole('button', { name: 'Look up again' });
  await boton.focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByText('Current lookup, separate from the snapshot')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});
