import { expect, test } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// Presentación de un análisis de PROVEEDOR REAL guardado, de uno en curso y de uno fallido. La API se SIMULA en el navegador
// (`page.route`) con la forma del contrato de Terra Link: esta prueba acredita cómo se MUESTRA lo que el servidor devuelve (procedencia,
// fecha declarada, valores sin interpretar, datos no informados, error sin resultado). NO acredita ninguna llamada a Whisp real:
// el adaptador contra el contrato 2.3.1 se prueba en `whisp.spec.ts` y `satellite.int-spec.ts` con un servidor controlado.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-sat@e2e.local', password: randomBytes(12).toString('base64url') };
let orgId = ''; let plotId = ''; let token = '';

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}`);
  return body;
}

const job = (over: Record<string, unknown>) => ({
  id: '11111111-1111-4111-8111-111111111111', plot_id: plotId,
  subject: { plot_version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', geometry_hash: 'f'.repeat(64), geometry_type: 'POLYGON' },
  applies_to_current_version: true, is_ensayo: false, provider: { code: 'WHISP', kind: 'EXTERNAL_HTTP', adapter_contract_version: 'TL_SAT_ADAPTER 0.1.0' },
  operation: 'FOREST_COVER', period: { start: null, end: null }, request_fingerprint: 'e'.repeat(64), status: 'COMPLETED', outcome: 'RESULT_AVAILABLE',
  outcome_note: 'Resultado disponible con su procedencia. Es un insumo con límites declarados, no una conclusión.', attempts: 1, error_code: null,
  requested_at: '2026-10-23T10:00:00Z', finished_at: '2026-10-23T10:01:00Z', result: null, ...over,
});
const resultado = {
  is_synthetic: false, synthetic_warning: null,
  provenance: { provider_code: 'WHISP', dataset: null, dataset_version: null, analysis_date: '2026-06-11T01:59:15.000Z', resolution_m: null, method: 'Whisp API 2.3.1; versión de análisis declarada en el resultado: 3.0.0a14' },
  coverage: { status: 'PARTIAL', note: 'Análisis PARCIAL declarado por el proveedor: 1 dataset(s) no disponible(s) (RADD_alerts).' },
  confidence: null, confidence_note: 'El proveedor no define confianza para este resultado; no se infiere.',
  limitations: 'Resultado de un proveedor externo: no es conclusión regulatoria.',
  indicators: { Area: 1.2, risk_pcrop: 'more_info_needed', Ind_04_disturbance_after_2020: null, whisp_processing_metadata: { unavailable_datasets: ['RADD_alerts'], processing_timestamp_utc: '2026-06-11 01:59:15+0000' } },
  raw_evidence: { stored: true, sha256: 'd'.repeat(64), can_download: true }, conclusion: 'NOT_EVALUATED', conclusion_note: 'NOT_EVALUATED',
};
const ficha = (jobs: unknown[], analysis_status: string, can_request = false) => ({
  plot: { id: plotId, plot_code: 'SAT-1', current_version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, can_request, request_blocked_reason: can_request ? null : 'No se encarga en esta prueba.',
  provider_kind: 'EXTERNAL_HTTP', ensayo_mode: false, fixture_scenarios: [], provider_selection: { status: 'SELECTED', provider_code: 'WHISP' }, analysis_status, jobs,
  limits: ['El resultado de un proveedor externo no es una conclusión jurídica (S1 §41).'],
});

test('preparación: organización, administrador y una parcela', async () => {
  const superTok = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgId = (await api('/api/v1/organizations', { method: 'POST', token: superTok, body: { name: 'Cooperativa Satélite', organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const inv = await api(`/api/v1/organizations/${orgId}/invitations`, { method: 'POST', token: superTok, body: { email: ADMIN.email, role_code: 'ORG_ADMIN' } });
  await api('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: 'Admin', last_name: 'Satelite', password: ADMIN.password } });
  token = (await api('/api/v1/auth/login', { method: 'POST', body: { email: ADMIN.email, password: ADMIN.password } })).access_token;
  const p = (await api(`/api/v1/organizations/${orgId}/producers`, { method: 'POST', token, body: { producer_code: 'SAT-P', legal_name: 'Finca Satélite (sintética)' } })).id;
  plotId = (await api(`/api/v1/organizations/${orgId}/plots`, { method: 'POST', token, body: { producer_id: p, plot_code: 'SAT-1', crop: 'Cacao' } })).id;
});

async function abrir(browser: import('@playwright/test').Browser, datos: unknown, lang: 'es' | 'en' = 'es') {
  const ctx = await browser.newContext();
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, lang] as const);
  const page = await ctx.newPage();
  await page.route(/\/plots\/[^/]+\/satellite$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(datos) }));
  await page.goto(`/organizaciones/${orgId}/parcelas/${plotId}`);
  await expect(page.getByRole('heading', { name: /^Análisis satelital$|^Satellite analysis$/ })).toBeVisible();
  return { ctx, page };
}

test('resultado real guardado: origen, fecha declarada y guardada, valores sin interpretar, dato no informado ≠ cero y conclusión no evaluada', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, ficha([job({ result: resultado })], 'RESULT_AVAILABLE'));
  const card = page.locator('section[aria-labelledby="sat-title"]');
  await expect(card).toContainText('Consulta real al proveedor, guardada en Terra Link');
  await expect(card).toContainText('(declarada por el proveedor)');
  await expect(card).toContainText('Guardado en Terra Link');
  await expect(card).toContainText('Datasets no disponibles');
  await expect(card).toContainText('RADD_alerts');
  await expect(card).not.toContainText('ENSAYO');
  await card.getByText('Valores devueltos por el proveedor (sin interpretar)').click();
  const tabla = card.getByRole('table', { name: 'Valores devueltos por el proveedor' });
  await expect(tabla.getByRole('row', { name: /risk_pcrop/ })).toContainText('more_info_needed');
  await expect(tabla.getByRole('row', { name: /Ind_04_disturbance_after_2020/ })).toContainText('No informado');   // ausente ≠ 0 ≠ «no»
  await expect(tabla.getByRole('row', { name: /Ind_04_disturbance_after_2020/ })).not.toContainText(/\b0\b|\bno\b/);
  await expect(card.getByRole('button', { name: 'Descargar respuesta original (JSON)' })).toBeVisible();
  await expect(card.getByText('No evaluada')).toBeVisible();
  const texto = await card.innerText();
  expect(texto).not.toMatch(/deforestación confirmada|sin deforestación acreditada|cumple/i);
  await ctx.close();
});

test('análisis en curso y análisis fallido: ni uno ni otro muestran valores ni se leen como «sin deforestación»', async ({ browser }) => {
  const enCurso = await abrir(browser, ficha([job({ status: 'RUNNING', outcome: null, outcome_note: 'Encargo aceptado; el análisis se ejecuta fuera de esta petición (S1 §54).', finished_at: null,
    progress: { percent: 42, note: 'procesando', at: '2026-10-23T10:00:30Z' }, provider_job_started: true })], 'IN_PROGRESS', true));
  await expect(enCurso.page.getByText('Avance informado por el proveedor')).toBeVisible();
  await expect(enCurso.page.getByText('42 %')).toBeVisible();
  await expect(enCurso.page.getByRole('button', { name: 'Cancelar este análisis' })).toBeVisible();
  await expect(enCurso.page.getByText('Hay un análisis en curso: esta tarjeta se actualiza sola.')).toBeVisible();
  await expect(enCurso.page.getByText('Análisis en curso').first()).toBeVisible();
  await expect(enCurso.page.getByRole('table', { name: 'Valores devueltos por el proveedor' })).toHaveCount(0);
  await enCurso.ctx.close();

  const fallido = await abrir(browser, ficha([job({ status: 'FAILED', outcome: 'PROVIDER_ERROR', error_code: 'PROVIDER_HTTP_500', outcome_note: 'El proveedor falló o respondió fuera de contrato: no evaluable.' })], 'NOT_EVALUATED'));
  const card = fallido.page.locator('section[aria-labelledby="sat-title"]');
  await expect(card).toContainText('El análisis no produjo resultado.');
  await expect(card).toContainText('NO EVALUADO');
  await expect(card.getByRole('table')).toHaveCount(0);
  expect(await card.innerText()).not.toMatch(/sin deforestación(?! )|0 hallazgos/i);
  await fallido.ctx.close();
});

test('envío incierto: se dice que no se sabe si el proveedor recibió la geometría y que no se reenvía sola; sin descarga ni valores', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, ficha([job({ status: 'FAILED', outcome: 'PROVIDER_ERROR', error_code: 'PROVIDER_SUBMIT_UNCERTAIN', outcome_note: 'El proveedor falló o respondió fuera de contrato: no evaluable.' })], 'NOT_EVALUATED', true));
  const card = page.locator('section[aria-labelledby="sat-title"]');
  await expect(card).toContainText('No se sabe si el proveedor recibió la geometría');
  await expect(card).toContainText('No se reenvía sola');
  await expect(card.getByRole('button', { name: /Descargar respuesta original/ })).toHaveCount(0);
  await expect(card.getByRole('table')).toHaveCount(0);
  await ctx.close();
});

test('cancelación no confirmada: se dice que el proveedor no encuentra el trabajo, que no hay resultado y que no se envió otro análisis', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, ficha([job({ status: 'FAILED', outcome: 'PROVIDER_ERROR', error_code: 'PROVIDER_CANCEL_NOT_CONFIRMED', cancel_requested: { at: '2026-10-23T10:02:00Z', reason: 'x' } })], 'NOT_EVALUATED', true));
  const card = page.locator('section[aria-labelledby="sat-title"]');
  await expect(card).toContainText('la cancelación no está confirmada y no hay resultado');
  await expect(card).not.toContainText('Cancelado');
  await expect(card.getByRole('table')).toHaveCount(0);
  await ctx.close();
});

test('operaciones: solo se ofrecen las que el proveedor declara', async ({ browser }) => {
  const datos = { ...ficha([], 'NOT_EVALUATED', true), supported_operations: ['FOREST_COVER'] };
  const { ctx, page } = await abrir(browser, datos);
  const card = page.locator('section[aria-labelledby="sat-title"]');
  await expect(card.getByRole('button', { name: /^Solicitar: Cobertura forestal/ })).toBeVisible();
  await expect(card.getByRole('button', { name: /Análisis histórico|Alertas de cambio/ })).toHaveCount(0);
  await ctx.close();
});

test('cancelación pedida: se muestra como solicitada (no como cancelada) hasta que el proveedor la atienda; sin avance dice que aún no informó', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, ficha([job({ status: 'RUNNING', outcome: null, finished_at: null, progress: null, provider_job_started: true, cancel_requested: { at: '2026-10-23T10:02:00Z', reason: 'x' } })], 'IN_PROGRESS', true));
  await expect(page.getByText(/Cancelación solicitada el .*se confirmará cuando el proveedor la atienda/)).toBeVisible();
  await expect(page.getByText('Enviado al proveedor: todavía no informó avance.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar este análisis' })).toHaveCount(0);
  await ctx.close();
});

test('inglés: la procedencia y los valores del proveedor se traducen', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, ficha([job({ result: resultado })], 'RESULT_AVAILABLE'), 'en');
  const card = page.locator('section[aria-labelledby="sat-title"]');
  await expect(card).toContainText('Real provider query, saved in Terra Link');
  await expect(card).toContainText('declared by the provider');
  await card.getByText('Values returned by the provider (not interpreted)').click();
  await expect(card.getByRole('table', { name: 'Values returned by the provider' }).getByRole('row', { name: /Ind_04/ })).toContainText('Not reported');
  await ctx.close();
});
