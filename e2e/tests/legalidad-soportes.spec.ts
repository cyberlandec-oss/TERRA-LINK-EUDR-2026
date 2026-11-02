import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// «Legalidad y soportes»: la pantalla operativa que responde ¿qué documento necesito?, ¿dónde lo aporto? y ¿qué falta o qué observaciones hay?
// Datos SINTÉTICOS propios. Comprueba que el perfil técnico («parcial») NO es el contenido principal ni condiciona aportar, que las recomendaciones, lo declarado y lo
// formalmente adoptado se distinguen, que el resumen sale de lo registrado, que las observaciones de una persona responsable llegan con su nombre, fecha y motivo, y
// español, inglés, teclado y 390 px.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-legal@e2e.local', password: randomBytes(12).toString('base64url') };
const PROD = { email: 'productor-legal@e2e.local', password: randomBytes(12).toString('base64url') };
let adminTok = ''; let prodTok = '';
let orgId = ''; let plotA = ''; let plotB = '';
const PDF = Buffer.from('%PDF-1.4\n% soporte sintético legalidad\n%%EOF\n');

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body?.error?.code)}`);
  return body;
}
async function contexto(browser: Browser, token: string, o: { lang?: 'es' | 'en'; viewport?: { width: number; height: number } } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...(o.viewport ? { viewport: o.viewport } : {}) });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, o.lang ?? 'es'] as const);
  return ctx;
}
async function legalidad(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`/organizaciones/${orgId}`);
  await page.getByRole('link', { name: /Legalidad y soportes|Legality and supporting documents/ }).click();
  return page;
}

test('preparación: organización, administrador y un productor vinculado con dos parcelas', async () => {
  const superTok = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgId = (await api('/api/v1/organizations', { method: 'POST', token: superTok, body: { name: 'Cooperativa Legalidad', organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const alta = async (u: { email: string; password: string }, rol: string, por: string, nombre: string) => {
    const inv = await api(`/api/v1/organizations/${orgId}/invitations`, { method: 'POST', token: por, body: { email: u.email, role_code: rol } });
    await api('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: nombre, last_name: 'Prueba', password: u.password } });
    return (await api('/api/v1/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).access_token as string;
  };
  adminTok = await alta(ADMIN, 'ORG_ADMIN', superTok, 'Revisora');
  prodTok = await alta(PROD, 'PRODUCER', adminTok, 'Productor');
  const base = `/api/v1/organizations/${orgId}`;
  const members = await api(`${base}/members`, { token: adminTok });
  const mem = ((Array.isArray(members) ? members : members.members) as Array<{ email: string; membership_id: string }>).find((m) => m.email === PROD.email)!.membership_id;
  const p = (await api(`${base}/producers`, { method: 'POST', token: adminTok, body: { producer_code: 'LG-P', legal_name: 'Finca Legalidad (sintética)' } })).id;
  const det = await api(`${base}/producers/${p}`, { token: adminTok });
  await api(`${base}/producers/${p}/self-membership`, { method: 'PUT', token: adminTok, body: { expected_version: det.row_version, membership_id: mem, reason: 'Alta del productor en la plataforma' } });
  plotA = (await api(`${base}/plots`, { method: 'POST', token: adminTok, body: { producer_id: p, plot_code: 'LG-A', crop: 'Cacao' } })).id;
  plotB = (await api(`${base}/plots`, { method: 'POST', token: adminTok, body: { producer_id: p, plot_code: 'LG-B', crop: 'Cacao' } })).id;
});

test('la puerta de entrada documental NO es el perfil técnico: orienta, distingue tres cosas, cita fuente y fecha y dice dónde aportar', async ({ browser }) => {
  const ctx = await contexto(browser, prodTok);
  const page = await legalidad(ctx);
  await expect(page.getByRole('heading', { name: 'Legalidad y soportes', level: 1 })).toBeVisible();
  const main = page.locator('main');
  // Lo que NO es el contenido principal: el perfil técnico parcial.
  await expect(main).not.toContainText('PARCIAL');
  await expect(main).not.toContainText('0.1.0');
  await expect(main).not.toContainText('borrador');
  // Tres cosas distintas, explícitas.
  await expect(page.getByRole('heading', { name: 'Tres cosas distintas' })).toBeVisible();
  await expect(page.getByText('Los fija un perfil jurídico revisado y adoptado. Hoy no hay uno: por eso esta pantalla orienta y registra soportes, pero no declara requisitos cumplidos.')).toBeVisible();
  // Aspectos con orientación, fuente y fecha; los de registro apuntan a su módulo.
  await expect(page.getByRole('heading', { name: 'Tenencia o derecho de uso', level: 3 }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aspectos ambientales', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Origen y trazabilidad del cacao', level: 3 })).toBeVisible();
  await expect(page.getByText(/Referencia en las guías: B04 pp\. 8–15.* Incorporada el 2026-10-22\./)).toBeVisible();
  await expect(page.getByText(/no están armonizadas normativamente/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ir a Captura de campo' })).toBeVisible();
  // Dónde aportarlo: cada parcela, con su acceso directo.
  const tabla = page.getByRole('table', { name: 'Soportes por parcela' });
  await expect(tabla).toContainText('LG-A'); await expect(tabla).toContainText('LG-B');
  await expect(tabla.getByRole('link', { name: 'Aportar soportes' })).toHaveCount(2);
  await expect(tabla.getByText('Sin soporte aportado aún').first()).toBeVisible();   // orientativo, no incumplimiento
  await ctx.close();
});

test('aportar desde la parcela y volver: el resumen refleja lo registrado; subir NO aprueba y la carga no depende de ningún perfil', async ({ browser }) => {
  const ctx = await contexto(browser, prodTok);
  const page = await legalidad(ctx);
  await page.getByRole('table', { name: 'Soportes por parcela' }).getByRole('row', { name: /LG-A/ }).getByRole('link', { name: 'Aportar soportes' }).click();
  await expect(page.getByRole('heading', { name: 'Documentos y soportes' })).toBeVisible();
  const sec = page.locator('#documentos-y-soportes');
  await sec.getByLabel('Tipo de documento').selectOption({ label: 'Documento de tenencia de la tierra (datos personales)' });
  await sec.getByLabel('Título').fill('Contrato de uso (sintético)');
  await sec.getByLabel('Archivo').setInputFiles({ name: 'contrato.pdf', mimeType: 'application/pdf', buffer: PDF });
  await sec.getByRole('button', { name: 'Subir documento' }).click();
  await expect(page.getByText(/Documento registrado:/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: /Legalidad y soportes/ }).first().click();
  const fila = page.getByRole('table', { name: 'Soportes por parcela' }).getByRole('row', { name: /LG-A/ });
  await expect(fila).toContainText('1 aportado(s)');
  await expect(page.getByRole('table', { name: 'Soportes por parcela' }).getByRole('row', { name: /LG-B/ })).toContainText('Sin soporte aportado aún');
  await expect(page.getByText('1 documento(s) disponible(s) esperan una revisión humana.', { exact: false })).toBeVisible();
  const docs = (await api(`/api/v1/organizations/${orgId}/documents?owner_type=plot&owner_id=${plotA}`, { token: adminTok })) as Array<{ versions: Array<{ review: unknown }> }>;
  expect(docs[0].versions[0].review).toBeNull();                        // ninguna aprobación automática
  await ctx.close();
});

test('observaciones de una persona responsable: llegan con su nombre, fecha y motivo, y llevan a aportar una versión nueva', async ({ browser }) => {
  const docs = (await api(`/api/v1/organizations/${orgId}/documents?owner_type=plot&owner_id=${plotA}`, { token: adminTok })) as Array<{ id: string; versions: Array<{ id: string }> }>;
  await api(`/api/v1/organizations/${orgId}/documents/${docs[0].id}/versions/${docs[0].versions[0].id}/reviews`, { method: 'POST', token: adminTok, body: { decision: 'REJECTED', reason: 'El contrato está incompleto: falta la última página' } });
  const ctx = await contexto(browser, prodTok);
  const page = await legalidad(ctx);
  const lista = page.getByRole('list', { name: 'Documentos que requieren atención' });
  await expect(lista).toContainText('Con observaciones de Revisora Prueba');
  await expect(lista).toContainText('El contrato está incompleto: falta la última página');
  await expect(lista.getByRole('link', { name: 'Aportar una versión nueva' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Documentos aportados' }).getByRole('row', { name: /Contrato de uso/ })).toContainText('Con observaciones');
  await ctx.close();
});

test('el perfil técnico queda en su contexto: Administración, y solo para quien lo gestiona; enlazado desde la pantalla y con el aviso de que no condiciona', async ({ browser }) => {
  const ctxA = await contexto(browser, adminTok);
  const pa = await legalidad(ctxA);
  await pa.getByText('Para quien revisa: perfil jurídico y evaluación de legalidad').click();
  await expect(pa.getByText(/No condicionan que aportes ni consultes soportes aquí/)).toBeVisible();
  await pa.getByRole('link', { name: 'Abrir el perfil jurídico (configuración técnica)' }).click();
  await expect(pa.getByText('Para aportar soportes no hace falta adoptar un perfil')).toBeVisible();
  await expect(pa.getByText(/no depende de que este perfil esté aprobado/)).toBeVisible();
  await ctxA.close();
  // El productor no ve el perfil técnico en su menú ni en la pantalla.
  const ctxP = await contexto(browser, prodTok);
  const pp = await legalidad(ctxP);
  await expect(pp.getByRole('link', { name: /Perfil jurídico/ })).toHaveCount(0);
  await expect(pp.getByText('Para quien revisa: perfil jurídico y evaluación de legalidad')).toHaveCount(0);
  await ctxP.close();
});

test('inglés, teclado y 390 px: textos traducidos, sin códigos internos y sin desborde horizontal', async ({ browser }) => {
  const ctx = await contexto(browser, prodTok, { lang: 'en', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`/organizaciones/${orgId}/legalidad`);
  await expect(page.getByRole('heading', { name: 'Legality and supporting documents', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1 · Which aspect do I need to document?' })).toBeVisible();
  await expect(page.getByText('Three different things'.toString())).toBeVisible();
  await expect(page.getByRole('table', { name: 'Supporting documents by plot' })).toContainText('LG-A');
  const link = page.getByRole('table', { name: 'Supporting documents by plot' }).getByRole('link', { name: 'Provide supporting documents' }).first();
  await link.focus();
  await expect(link).toBeFocused();
  const cuerpo = await page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/\b(LAND_TENURE|LABOR_SUPPORT|ENVIRONMENTAL_SUPPORT|SCAN_FAILED|PERMISSION_DENIED|PARTIAL)\b/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/legalidad-390.png', fullPage: true });
  await ctx.close();
  void plotB;
});
