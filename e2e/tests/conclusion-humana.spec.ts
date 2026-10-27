import { expect, test, type Browser, type Locator } from '@playwright/test';
import { randomBytes, randomUUID } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// AISLAMIENTO: la base E2E es compartida y el perfil jurídico y el catálogo son GLOBALES (append-only): este spec usa versiones PROPIAS (perfil 7.7.0, catálogo 1.7.0), correos propios y deja el perfil objetado.
// D-07.6 — conclusión humana del responsable EUDR desde la web. Datos SINTÉTICOS: el perfil jurídico «completo y revisado» y el catálogo vinculado son de ensayo (se crean por
// la API de plataforma sobre un perfil sintético escrito en la base de prueba) y no aprueban nada real. Recorrido: consultar la evaluación y sus limitaciones → la favorable
// explica qué falta → registrar una no favorable con el teclado → cumplir las condiciones sintéticas y registrar una favorable posterior (la anterior se conserva) → una objeción
// del perfil la deja «ya no vigente». También: quien administra solo consulta y quien evaluó no concluye. Español, inglés, teclado y 390 px (inspeccionado antes de congelar).
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-conclusion-humana@e2e.local', password: randomBytes(12).toString('base64url') };
const EUDR = { email: 'eudr-conclusion-humana@e2e.local', password: randomBytes(12).toString('base64url') };
const tok: Record<string, string> = {};
let org = ''; let lote = ''; let codigoLote = ''; let evaluacion = ''; let revisionPerfil = '';
const hoy = new Date().toISOString().slice(0, 10);

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body?.error?.code)}`);
  return body;
}
async function abrir(browser: Browser, quien: 'adminA' | 'eudr', opts: { lang?: 'es' | 'en'; viewport?: { width: number; height: number } } = {}) {
  const ctx = await browser.newContext({ ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [tok[quien], opts.lang ?? 'es'] as const);
  const page = await ctx.newPage();
  await page.goto(`/organizaciones/${org}/riesgo/${lote}/conclusion`);
  return { ctx, page };
}
const dentro = async (loc: Locator) => { const b = await loc.boundingBox(); expect(b!.x + b!.width).toBeLessThanOrEqual(391); };
const reevaluar = async () => { evaluacion = (await api(`/api/v1/organizations/${org}/risk/lots/${lote}/evaluations`, { method: 'POST', token: tok.adminA, body: { operation_id: randomUUID() } })).evaluation.id; };

test('preparación: organización, administración y responsable EUDR (la administración PUEDE asignar el rol), lote con origen declarado y una evaluación de la administración', async () => {
  tok.super = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  org = (await api('/api/v1/organizations', { method: 'POST', token: tok.super, body: { name: 'Coop Conclusión E2E', organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const alta = async (u: { email: string; password: string }, rol: string, por: string) => {
    const inv = await api(`/api/v1/organizations/${org}/invitations`, { method: 'POST', token: por, body: { email: u.email, role_code: rol } });
    await api('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: 'Prueba', last_name: 'Conclusión', password: u.password } });
    return (await api('/api/v1/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).access_token as string;
  };
  tok.adminA = await alta(ADMIN, 'ORG_ADMIN', tok.super);
  tok.eudr = await alta(EUDR, 'EUDR_MANAGER', tok.adminA); // la administración asigna el rol responsable sin poseer risk:conclude
  const b = `/api/v1/organizations/${org}`;
  await api(`${b}/products`, { method: 'POST', token: tok.adminA, body: { code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' } });
  await api(`${b}/locations`, { method: 'POST', token: tok.adminA, body: { code: 'CC-E2E', name: 'Centro', location_type: 'COLLECTION_CENTER' } });
  const centro = ((await api(`${b}/locations`, { token: tok.adminA })) as Array<{ id: string; code: string }>).find((l) => l.code === 'CC-E2E')!.id;
  const prod = (await api(`${b}/producers`, { method: 'POST', token: tok.adminA, body: { producer_code: 'P-CC', legal_name: 'Finca Conclusión' } })).id;
  const producto = ((await api(`${b}/products?limit=100`, { token: tok.adminA })).items as Array<{ id: string; code: string }>).find((p) => p.code === 'CACAO_BABA')!.id;
  const parcela = (await api(`${b}/plots`, { method: 'POST', token: tok.adminA, body: { producer_id: prod, plot_code: 'P-CC-1', crop: 'Cacao' } })).id;
  await api(`${b}/plots/${parcela}/geometry-versions`, { method: 'POST', token: tok.adminA, body: { expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.1601, -0.8479] }, area_declared_ha: 2 } });
  const d = (await api(`${b}/deliveries`, { method: 'POST', token: tok.adminA, body: { operation_id: randomUUID(), producer_id: prod, product_id: producto, delivery_date: hoy, quantity_declared: '30', unit: 'KG', origins: [{ plot_id: parcela }], register: true } })).delivery;
  const rec = (await api(`${b}/deliveries/${d.id}/receptions`, { method: 'POST', token: tok.adminA, body: { operation_id: randomUUID(), location_id: centro, received_at: new Date().toISOString(), weighing: { method: 'B', quantity: '30', unit: 'KG', weighed_on: hoy } } })).reception_id;
  const l = await api(`${b}/lots`, { method: 'POST', token: tok.adminA, body: { operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '30' }] } });
  lote = (l.id ?? l.lot?.id) as string; codigoLote = (l.lot_code ?? l.lot?.lot_code) as string;
  await reevaluar();
  expect(codigoLote).toMatch(/^LOT-/);
});

test('el responsable EUDR consulta la evaluación y sus limitaciones; la favorable explica qué falta y no se puede elegir', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'eudr');
  await expect(page.getByRole('heading', { name: `Conclusión humana del lote ${codigoLote}`, level: 1 })).toBeVisible();
  await expect(page.getByText('El motor no concluye: esta conclusión es de una persona autorizada.')).toBeVisible();
  await expect(page.getByText('Hay categorías sin ninguna regla en el catálogo')).toBeVisible();
  await expect(page.getByText('Nadie ha registrado todavía una conclusión humana sobre esta evaluación.')).toBeVisible();
  const neg = page.getByRole('radio', { name: /Riesgo insignificante \(NEGLIGIBLE\)/ });
  await expect(neg).toBeDisabled();
  await expect(page.getByText('El catálogo no declara ningún perfil jurídico (regulatory_profile vacío).')).toBeVisible();
  await expect(page.getByText('La organización no ha adoptado el catálogo de reglas con que se evaluó.')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Riesgo no insignificante/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Registrar la conclusión' })).toBeDisabled();
  await ctx.close();
});

test('quien administra solo consulta: no ve el formulario; y quien evaluó no puede concluir su propia evaluación', async ({ browser }) => {
  const a = await abrir(browser, 'adminA');
  await expect(a.page.getByRole('heading', { name: `Conclusión humana del lote ${codigoLote}`, level: 1 })).toBeVisible();
  await expect(a.page.getByText('Tu rol permite consultar, no registrar conclusiones. Solo el rol responsable EUDR puede registrarlas.')).toBeVisible();
  await expect(a.page.getByRole('button', { name: 'Registrar la conclusión' })).toHaveCount(0);
  await a.ctx.close();
  // el responsable EUDR evalúa y entonces ya no puede concluir esa evaluación
  const eval0 = evaluacion;
  evaluacion = (await api(`/api/v1/organizations/${org}/risk/lots/${lote}/evaluations`, { method: 'POST', token: tok.eudr, body: { operation_id: randomUUID() } })).evaluation.id;
  const e = await abrir(browser, 'eudr');
  await expect(e.page.getByText('Tu rol puede concluir, pero esta evaluación la realizaste tú: debe concluirla otra persona.')).toBeVisible();
  await expect(e.page.getByRole('radio', { name: /Riesgo no insignificante/ })).toBeDisabled(); // sus propias evaluaciones no se concluyen
  await expect(e.page.getByText('Quien realizó la evaluación no puede concluirla: debe hacerlo otra persona.').first()).toBeVisible();
  await expect(e.page.getByRole('button', { name: 'Registrar la conclusión' })).toBeDisabled();
  await e.ctx.close();
  expect(eval0).not.toBe(evaluacion);
  await reevaluar(); // la evaluación vigente vuelve a ser de la administración
});

test('registrar una conclusión NO favorable con el teclado: motivo, evidencia, resumen y confirmación; queda vigente y en el historial', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'eudr');
  const boton = page.getByRole('button', { name: 'Registrar la conclusión' });
  await page.getByLabel('Motivo de la conclusión').fill('Conclusión sintética: los datos disponibles no permiten considerar el riesgo insignificante.');
  await expect(boton).toBeDisabled(); // falta la evidencia
  await page.getByRole('button', { name: 'Añadir una cita' }).click();
  await page.getByLabel('Cita 1', { exact: true }).fill('Evidencia sintética de ensayo');
  const resumen = page.locator('dl[aria-label="Resumen antes de registrar"]');
  await expect(resumen).toContainText('Riesgo no insignificante (NON_NEGLIGIBLE)');
  await expect(resumen).toContainText('Ninguna'); // no sustituye a ninguna
  await page.getByLabel('Confirmo que registro una conclusión humana sobre esta evaluación, no un borrador').focus();
  await page.keyboard.press('Space');
  await expect(boton).toBeEnabled();
  await boton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Conclusión humana registrada. No anula requisitos pendientes ni habilita READY ni despacho por sí sola.')).toBeVisible();
  const hist = page.locator('section[aria-labelledby="c-hist"]');
  await expect(hist).toContainText('Riesgo no insignificante (NON_NEGLIGIBLE)');
  await expect(hist).toContainText('Vigente');
  await expect(hist).toContainText('Cita: Evidencia sintética de ensayo');
  await expect(page.locator('section[aria-labelledby="c-vig"]')).toContainText('Riesgo no insignificante (NON_NEGLIGIBLE)');
  await ctx.close();
});

test('condiciones SINTÉTICAS cumplidas (perfil revisado, catálogo vinculado y adoptado): la favorable se habilita y sustituye a la anterior, que se conserva', async ({ browser }) => {
  const b = `/api/v1/organizations/${org}`;
  const pg = await import('pg');
  const { E2E_DATABASE_URL } = await import('../env');
  const db = new pg.Client({ connectionString: E2E_DATABASE_URL }); await db.connect();
  await db.query(`INSERT INTO legal_profile_versions (version, jurisdiction, scope, scope_note, covered_matters, pending_matters, technical_status, published_by, reason)
    VALUES ('7.7.0', 'EC', 'COMPLETE', 'Fixture sintética de prueba, sin valor jurídico', ARRAY['TENURE'], ARRAY[]::text[], 'PUBLISHED', 'fixture', 'fixture sintética')`);
  await db.end();
  revisionPerfil = (await api('/api/v1/platform/legal-profile/reviews', { method: 'POST', token: tok.super, body: { operation_id: randomUUID(), version: '7.7.0', decision: 'REVIEWED', reviewer_name: 'Persona sintética', reviewer_capacity: 'Fixture', reviewed_on: hoy,
    basis: 'Fundamento sintético que no acredita ninguna revisión real', supports: [{ kind: 'CITATION', citation: 'Cita sintética' }], expected_current_review_id: null } })).review.id;
  await api('/api/v1/platform/risk-catalog/profile-links', { method: 'POST', token: tok.super, body: { operation_id: randomUUID(), base_rule_set_version: '1.0.0', new_rule_set_version: '1.7.0', profile_version: '7.7.0', review_id: revisionPerfil, reason: 'Vinculación sintética de ensayo' } });
  await api(`${b}/legal-profile/adoptions`, { method: 'POST', token: tok.adminA, body: { operation_id: randomUUID(), version: '7.7.0', decision: 'ADOPT', reason: 'Adopción sintética' } });
  await api(`${b}/risk/rule-sets/adoptions`, { method: 'POST', token: tok.adminA, body: { operation_id: randomUUID(), rule_set_version: '1.7.0', decision: 'ADOPT', reason: 'Adopción sintética' } });
  const stale = await abrir(browser, 'eudr');
  await expect(stale.page.locator('dl[aria-label="Evaluación"]').getByText('Desactualizada')).toBeVisible(); // cambió el catálogo que aplica: reevaluar
  await stale.ctx.close();
  await reevaluar();
  const { ctx, page } = await abrir(browser, 'eudr');
  const neg = page.getByRole('radio', { name: /Riesgo insignificante \(NEGLIGIBLE\)/ });
  await expect(neg).toBeEnabled();
  // Inspección a 390 px (inglés) de los bloques de carencias ANTES de registrar: dentro del ancho, controles de tamaño usable y sin desborde.
  const movil = await abrir(browser, 'eudr', { lang: 'en', viewport: { width: 390, height: 844 } });
  await movil.page.getByRole('radio', { name: /Negligible risk \(NEGLIGIBLE\)/ }).check();
  const bloque = movil.page.locator('fieldset[data-gap]').first();
  await expect(bloque).toBeVisible();
  const cb = await bloque.boundingBox(); expect(cb!.x + cb!.width).toBeLessThanOrEqual(391);
  await expect(bloque.getByLabel('How it is resolved')).toBeVisible();
  await expect(movil.page.getByText('Showing a limitation does not resolve it.', { exact: false })).toBeVisible();
  expect(await movil.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await movil.page.locator('fieldset[data-gap]').first().scrollIntoViewIfNeeded();
  await movil.page.screenshot({ path: 'test-results/conclusion-carencias-390.png', fullPage: true });
  await movil.ctx.close();
  await neg.check();
  await page.getByLabel('Motivo de la conclusión').fill('Conclusión favorable sintética: se cumplen las condiciones de ensayo.');
  await page.getByRole('button', { name: 'Añadir una cita' }).click();
  await page.getByLabel('Cita 1', { exact: true }).fill('Evidencia sintética favorable');
  await expect(page.locator('dl[aria-label="Resumen antes de registrar"]')).toContainText('Ninguna'); // la evaluación nueva aún no tiene conclusión
  // CARENCIAS: mostrar una limitación NO la resuelve; cada carencia exige su propia resolución, justificación y evidencia
  const gaps = page.locator('fieldset[data-gap]');
  const n = await gaps.count();
  expect(n).toBeGreaterThan(0);
  const boton = page.getByRole('button', { name: 'Registrar la conclusión' });
  const confirmar = page.getByLabel('Confirmo que registro una conclusión humana sobre esta evaluación, no un borrador');
  await expect(page.locator('dl[aria-label="Resumen antes de registrar"]')).toContainText(`0 / ${n}`);
  await confirmar.check();
  await expect(boton).toBeDisabled(); // con una evidencia pero sin resolver las carencias
  for (let i = 0; i < n; i++) {
    const g = gaps.nth(i); const clave = await g.getAttribute('data-gap');
    await g.getByLabel('Cómo se resuelve').selectOption('NOT_APPLICABLE');
    await g.getByLabel('Justificación propia de esta carencia').fill('Justificación de ensayo repetida para todas las carencias de la evaluación.');
    await g.getByLabel('Evidencia que la sustenta').selectOption('0');
    void clave;
  }
  await expect(page.getByText('Las justificaciones no pueden repetirse: cada carencia tiene la suya.')).toBeVisible();
  await confirmar.check();
  await expect(boton).toBeDisabled(); // la misma justificación copiada para todas no vale
  for (let i = 0; i < n; i++) {
    const g = gaps.nth(i); const clave = await g.getAttribute('data-gap');
    await g.getByLabel('Justificación propia de esta carencia').fill(`Justificación de ensayo propia de la carencia ${clave}: no aplica a esta operación sintética.`);
  }
  await expect(page.locator('dl[aria-label="Resumen antes de registrar"]')).toContainText(`${n} / ${n}`);
  await confirmar.check();
  await expect(boton).toBeEnabled();
  await boton.click();
  await expect(page.getByText('Conclusión humana registrada.', { exact: false })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="c-vig"]')).toContainText('Riesgo insignificante (NEGLIGIBLE)');
  await expect(page.locator('section[aria-labelledby="c-hist"]').getByRole('list', { name: 'Carencias resueltas' }).first().getByRole('listitem')).toHaveCount(n); // cada carencia con su resolución
  await ctx.close();
});

test('una objeción posterior del perfil jurídico deja la conclusión favorable «ya no vigente» y la conserva en el historial', async ({ browser }) => {
  await api('/api/v1/platform/legal-profile/reviews', { method: 'POST', token: tok.super, body: { operation_id: randomUUID(), version: '7.7.0', decision: 'OBJECTED', reviewer_name: 'Segunda persona', reviewer_capacity: 'Fixture', reviewed_on: hoy,
    basis: 'Objeción sintética posterior que invalida la condición', supports: [], expected_current_review_id: revisionPerfil } });
  const { ctx, page } = await abrir(browser, 'eudr');
  await expect(page.getByText('La última conclusión registrada ya no está vigente')).toBeVisible();
  const vig = page.locator('section[aria-labelledby="c-vig"]');
  await expect(vig).toContainText('La revisión favorable del perfil jurídico dejó de estar vigente.');
  await expect(vig).toContainText('Sin conclusión vigente (indeterminada)');
  const hist = page.locator('section[aria-labelledby="c-hist"]');
  await expect(hist).toContainText('Ya no vigente');
  await expect(hist).toContainText('Reemplazada');
  await expect(hist).toContainText('Riesgo no insignificante (NON_NEGLIGIBLE)'); // la anterior sigue ahí
  await expect(page.getByRole('radio', { name: /Riesgo insignificante \(NEGLIGIBLE\)/ })).toBeDisabled(); // ya no se puede registrar otra favorable
  await ctx.close();
});

test('inglés y 390 px: textos traducidos, radios con tamaño de control, lo que falta y el historial dentro del ancho, sin códigos internos ni desborde', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'eudr', { lang: 'en', viewport: { width: 390, height: 844 } });
  await expect(page.getByRole('heading', { name: `Human conclusion for lot ${codigoLote}`, level: 1 })).toBeVisible();
  const motivo = page.getByText('The declared legal profile has no current favorable review.');
  await expect(motivo).toBeVisible(); await dentro(motivo);
  const radio = page.getByRole('radio', { name: /Non-negligible risk/ });
  expect((await radio.boundingBox())!.width).toBeLessThanOrEqual(24);
  const etiqueta = page.locator('label.checkbox-row', { hasText: 'Non-negligible risk' });
  expect(Math.abs((await etiqueta.boundingBox())!.y - (await radio.boundingBox())!.y)).toBeLessThan(24);
  const razon = page.getByText('The favorable review of the legal profile is no longer current.').first();
  await expect(razon).toBeVisible(); await dentro(razon);
  const hist = page.locator('section[aria-labelledby="c-hist"]');
  await expect(hist).toContainText('No longer valid');
  await expect(hist).toContainText('Superseded');
  const fund = hist.getByText('Conclusión favorable sintética: se cumplen las condiciones de ensayo.');
  await expect(fund).toBeVisible(); await dentro(fund);
  const cuerpo = await page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/\b(LOST_[A-Z_]+|EVALUATION_STALE|RECORDER_IS_EVALUATOR|PROFILE_REVIEW_NOT_CURRENT|PROFILE_REFERENCE_MISSING|RULE_SET_NOT_ADOPTED|ENGINE_NEVER_CONCLUDES|NOT_ASSESSED|INCOMPLETE)\b/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/conclusion-390.png', fullPage: true });
  await ctx.close();
});
