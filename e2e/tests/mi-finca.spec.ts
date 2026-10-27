import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// A-05 · CTX-01/CTX-05/CTX-06 — «Mi finca» y los documentos EN CONTEXTO, con datos SINTÉTICOS propios de este spec.
// Comprueba: alcance propio (la parcela de otro no existe), estados diferenciados (cuenta sin vínculo ≠ sin datos ≠ sin permiso),
// pendientes derivados, guía orientativa sin bloquear la carga, carga desde la parcela y desde Mi finca con el mismo servicio, que subir NO aprueba
// (queda «pendiente de revisión»), roles sin Mi finca, y español, inglés, teclado y 390 px.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-mifinca@e2e.local', password: randomBytes(12).toString('base64url') };
const PROD_A = { email: 'productor-a-mifinca@e2e.local', password: randomBytes(12).toString('base64url') };
const PROD_B = { email: 'productor-b-mifinca@e2e.local', password: randomBytes(12).toString('base64url') };
const AUDI = { email: 'auditor-mifinca@e2e.local', password: randomBytes(12).toString('base64url') };
let adminTok = ''; let prodATok = ''; let prodBTok = ''; let audiTok = '';
let orgId = ''; let entregaA = ''; let entregaOtra = ''; let plotA1 = ''; let plotA2 = ''; let plotOtro = ''; let producerA = ''; let producerOtro = '';
const PDF = Buffer.from('%PDF-1.4\n% soporte sintético A-05\n%%EOF\n');

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(body?.error?.code)}`);
  return body;
}
const items = (r: { items?: unknown[]; data?: unknown[] } | unknown[]) => (Array.isArray(r) ? r : (r.items ?? r.data ?? [])) as Array<Record<string, unknown>>;
async function contexto(browser: Browser, token: string, o: { lang?: 'es' | 'en'; viewport?: { width: number; height: number } } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...(o.viewport ? { viewport: o.viewport } : {}) });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, o.lang ?? 'es'] as const);
  return ctx;
}
async function abrir(ctx: BrowserContext, ruta: string): Promise<Page> { const p = await ctx.newPage(); await p.goto(`/organizaciones/${orgId}${ruta}`); return p; }

test('preparación: organización, dos productores (uno vinculado), una cuenta sin vínculo y un auditor', async () => {
  const superTok = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgId = (await api('/api/v1/organizations', { method: 'POST', token: superTok, body: { name: 'Cooperativa Mi Finca', organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const alta = async (u: { email: string; password: string }, rol: string, por: string) => {
    const inv = await api(`/api/v1/organizations/${orgId}/invitations`, { method: 'POST', token: por, body: { email: u.email, role_code: rol } });
    await api('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: 'Mi', last_name: 'Finca', password: u.password } });
    return (await api('/api/v1/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).access_token as string;
  };
  adminTok = await alta(ADMIN, 'ORG_ADMIN', superTok);
  prodATok = await alta(PROD_A, 'PRODUCER', adminTok);
  prodBTok = await alta(PROD_B, 'PRODUCER', adminTok);
  audiTok = await alta(AUDI, 'AUDITOR', adminTok);
  const base = `/api/v1/organizations/${orgId}`;
  const members = await api(`${base}/members`, { token: adminTok });
  const memberOf = (email: string) => ((Array.isArray(members) ? members : members.members) as Array<{ email: string; membership_id: string }>).find((m) => m.email === email)!.membership_id;
  producerA = (await api(`${base}/producers`, { method: 'POST', token: adminTok, body: { producer_code: 'MF-A', legal_name: 'Finca A (sintética)' } })).id;
  producerOtro = (await api(`${base}/producers`, { method: 'POST', token: adminTok, body: { producer_code: 'MF-OTRO', legal_name: 'Finca de otra persona (sintética)' } })).id;
  const det = await api(`${base}/producers/${producerA}`, { token: adminTok });
  await api(`${base}/producers/${producerA}/self-membership`, { method: 'PUT', token: adminTok, body: { expected_version: det.row_version, membership_id: memberOf(PROD_A.email), reason: 'Alta del productor en la plataforma' } });
  const plot = async (producer: string, code: string) => (await api(`${base}/plots`, { method: 'POST', token: adminTok, body: { producer_id: producer, plot_code: code, crop: 'Cacao' } })).id as string;
  plotA1 = await plot(producerA, 'MF-A1'); plotA2 = await plot(producerA, 'MF-A2'); plotOtro = await plot(producerOtro, 'MF-X1');
  // Entregas: una del productor vinculado y otra de otra persona (AJ-02: el productor ve solo las suyas, y solo el listado).
  const producto = (await api(`${base}/products`, { method: 'POST', token: adminTok, body: { code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' } })).id;
  const centro = (await api(`${base}/locations`, { method: 'POST', token: adminTok, body: { code: 'MF-C1', name: 'Centro Mi Finca', location_type: 'COLLECTION_CENTER' } })).id;
  const hoy = new Date().toISOString().slice(0, 10);
  const entrega = async (productor: string) => (await api(`${base}/deliveries`, { method: 'POST', token: adminTok, body: { operation_id: crypto.randomUUID(), producer_id: productor, product_id: producto, location_id: centro, delivery_date: hoy, quantity_declared: '500', unit: 'KG', register: false } })).delivery as { id: string; delivery_code: string };
  const eA = await entrega(producerA); const eO = await entrega(producerOtro);
  entregaA = eA.delivery_code; entregaOtra = eO.delivery_code;
  // MF-A2 tiene ubicación registrada; MF-A1 no (pendiente).
  await api(`${base}/plots/${plotA2}/geometry-versions`, { method: 'POST', token: adminTok, body: { expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.16, -0.85] }, notes: 'sintética' } });
});

test('Mi finca (productor vinculado): menú, solo lo propio, pendientes derivados, entregas explicadas y nada ajeno', async ({ browser }) => {
  const ctx = await contexto(browser, prodATok);
  const page = await abrirDesdeMenu(ctx);
  await expect(page.getByRole('heading', { name: 'Mi finca', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /MF-A · / })).toBeVisible();
  const parcelas = page.getByRole('table', { name: 'Mis parcelas' });
  await expect(parcelas.getByRole('row')).toHaveCount(3);                                   // encabezado + las dos parcelas propias
  await expect(parcelas).toContainText('MF-A1'); await expect(parcelas).toContainText('MF-A2');
  await expect(page.getByText('MF-X1')).toHaveCount(0);                                     // la parcela de otro no existe para esta cuenta
  await expect(page.getByText('MF-OTRO')).toHaveCount(0);
  const pend = page.getByRole('list', { name: 'Pendientes' });
  await expect(pend).toContainText('La parcela MF-A1 no tiene ubicación registrada.');     // pendiente derivado de lo registrado
  await expect(pend).not.toContainText('MF-A2');                                            // la que ya tiene ubicación no figura
  await expect(page.getByText(/no son una evaluación de cumplimiento/)).toBeVisible();
  // Entregas propias (AJ-02): solo el listado de las suyas; la de otra persona no existe y no hay enlace al detalle.
  const entregas = page.getByRole('table', { name: 'Mis entregas' });
  await expect(entregas).toContainText(entregaA);
  await expect(page.getByText(entregaOtra)).toHaveCount(0);
  await expect(entregas.getByRole('link')).toHaveCount(0);
  await expect(page.getByText('Tu rol no incluye la consulta de entregas.')).toHaveCount(0);
  await expect(page.getByText('Tu cuenta todavía no está vinculada a un productor.')).toHaveCount(0);
  await ctx.close();
});

async function abrirDesdeMenu(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`/organizaciones/${orgId}`);
  await page.getByRole('complementary', { name: 'Navegación principal' }).getByRole('link', { name: 'Mi finca', exact: true }).click();
  return page;
}

test('guía documental: orientativa, no bloquea la carga, sin lista uniforme y con su fuente; la situación de trabajo no se guarda', async ({ browser }) => {
  const ctx = await contexto(browser, prodATok);
  const page = await abrirDesdeMenu(ctx);
  await page.getByLabel('Aportar o consultar documentos de').selectOption({ label: 'Productor MF-A' });
  await page.getByText('Qué puedes documentar y por qué (guía orientativa)').click();
  await expect(page.getByText('Esto es una guía de orientación, no una lista obligatoria: cada situación es distinta.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trabajo y aspectos sociales' })).toBeVisible();
  const sit = page.getByLabel('¿Cómo se trabaja la finca?');
  await sit.selectOption({ label: 'Trabajo familiar' });
  await expect(page.getByText(/Normalmente no hay contratos de trabajo/)).toBeVisible();
  await expect(page.getByText(/soportes laborales de trabajadores contratados no suelen aplicar/)).toBeVisible();
  await sit.selectOption({ label: 'Con trabajadores contratados' });
  await expect(page.getByText(/Suelen corresponder soportes laborales de esas personas/)).toBeVisible();   // el contenido se ADAPTA al caso
  await expect(page.getByText('Es solo orientación: no se guarda y no es una calificación jurídica.')).toBeVisible();
  await expect(page.getByText(/Referencia en las guías: B09/)).toBeVisible();                                // fuente visible
  await expect(page.getByText(/no es una lista obligatoria|Orientación, no un dictamen/).first()).toBeVisible();
  // El aspecto laboral tiene su tipo (migración 0066) y dice que puede contener datos personales; ya no hay aspectos «sin tipo».
  await expect(page.getByText(/Tipo de documento disponible: Soporte laboral/)).toBeVisible();
  await expect(page.getByText(/Este tipo puede contener datos personales/).first()).toBeVisible();
  await expect(page.getByText(/El catálogo actual no tiene un tipo de documento específico/)).toHaveCount(0);
  // El productor (rol PRODUCER) puede consultar pero no aportar a nivel de productor (la API exige poder actualizarlo).
  await expect(page.getByText('Tu rol puede consultar estos documentos, pero no aportar nuevos aquí.')).toBeVisible();
  await ctx.close();
});

test('aportar un documento desde Mi finca: queda aportado y PENDIENTE DE REVISIÓN (subir no aprueba); la carga no depende de ninguna revisión global', async ({ browser }) => {
  const ctx = await contexto(browser, prodATok);
  const page = await abrirDesdeMenu(ctx);
  await page.getByLabel('Aportar o consultar documentos de').selectOption({ label: 'Parcela MF-A1' });
  await page.getByLabel('Tipo de documento').selectOption({ label: 'Documento de tenencia de la tierra (datos personales)' });
  await page.getByLabel('Título').fill('Contrato de uso (sintético)');
  await page.getByLabel('Emisor').fill('Comunidad sintética');
  await page.getByLabel('Archivo').setInputFiles({ name: 'contrato.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByRole('button', { name: 'Subir documento' }).click();
  await expect(page.getByText(/Documento registrado:/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Queda aportado, pendiente de revisión: subirlo no lo aprueba.')).toBeVisible();
  const tabla = page.getByRole('table', { name: 'Documentos aportados' });
  const fila = tabla.getByRole('row', { name: /Contrato de uso/ });
  await expect(fila).toContainText('Pendiente de revisión');
  await expect(fila).not.toContainText('Revisado: aceptado');
  // El mismo documento figura en «Todos mis documentos» y en la API, con su titular (la parcela) y sin revisión alguna.
  await expect(page.getByRole('table', { name: 'Todos mis documentos' })).toContainText('Contrato de uso (sintético)');
  const docs = items(await api(`/api/v1/organizations/${orgId}/documents?owner_type=plot&owner_id=${plotA1}`, { token: adminTok }));
  expect(docs).toHaveLength(1);
  const v = (docs[0].versions as Array<Record<string, unknown>>)[0];
  expect(v.review).toBeNull();                                  // ninguna aprobación automática
  expect(docs[0].owner_id).toBe(plotA1);
  await ctx.close();
});

test('AJ-03 soportes ambiental, laboral y de terceros: el Productor vinculado los aporta a su parcela con su tipo, quedan pendientes de revisión y el contenido personal se restringe', async ({ browser }) => {
  const ctx = await contexto(browser, prodATok);
  const page = await abrirDesdeMenu(ctx);
  await page.getByLabel('Aportar o consultar documentos de').selectOption({ label: 'Parcela MF-A2' });
  await page.getByText('Qué puedes documentar y por qué (guía orientativa)').click();
  await expect(page.getByText(/Tipo de documento disponible: Soporte ambiental/)).toBeVisible();
  await expect(page.getByText(/Tipo de documento disponible: Soporte de derechos de terceros o comunidades/)).toBeVisible();
  const subir = async (tipo: string, titulo: string) => {
    await page.getByLabel('Tipo de documento').selectOption({ label: tipo });
    await page.getByLabel('Título').fill(titulo);
    await page.getByLabel('Archivo').setInputFiles({ name: 'soporte.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4
% soporte sintético ${titulo}
%%EOF
`) });
    await page.getByRole('button', { name: 'Subir documento' }).click();
    await expect(page.getByText(/Documento registrado:/)).toBeVisible({ timeout: 30_000 });
  };
  await subir('Soporte ambiental', 'Gestión ambiental (sintética)');
  await subir('Soporte laboral (datos personales)', 'Registro laboral (sintético)');
  await subir('Soporte de derechos de terceros o comunidades (datos personales)', 'Acta con la comunidad (sintética)');
  const tabla = page.getByRole('table', { name: 'Documentos aportados' });
  for (const [titulo, tipo] of [['Gestión ambiental (sintética)', 'Soporte ambiental'], ['Registro laboral (sintético)', 'Soporte laboral'], ['Acta con la comunidad (sintética)', 'Soporte de derechos de terceros o comunidades']]) {
    const fila = tabla.getByRole('row').filter({ hasText: titulo });
    await expect(fila).toContainText(tipo);                       // clasificado con su tipo, no como «tenencia» ni «evidencia del recorrido»
    await expect(fila).toContainText('Pendiente de revisión');    // subir no aprueba
  }
  // Ninguno quedó como obligatorio ni aprobado: la API no muestra revisión alguna.
  const docs = items(await api(`/api/v1/organizations/${orgId}/documents?owner_type=plot&owner_id=${plotA2}`, { token: adminTok }));
  expect(docs.map((d) => d.document_type).sort()).toEqual(['ENVIRONMENTAL_SUPPORT', 'LABOR_SUPPORT', 'THIRD_PARTY_RIGHTS_SUPPORT']);
  for (const d of docs) expect((d.versions as Array<Record<string, unknown>>)[0].review).toBeNull();
  // Privacidad: el soporte laboral es dato personal; el Productor ve su estado, no su contenido.
  await tabla.getByRole('link', { name: 'Registro laboral (sintético)' }).click();
  await expect(page.getByText('Contiene datos personales: tu rol puede ver los metadatos, no el contenido.')).toBeVisible();
  await ctx.close();
});

test('la parcela ofrece los mismos documentos en contexto, y la lista de evidencias de campo no los duplica', async ({ browser }) => {
  const ctx = await contexto(browser, prodATok);
  const page = await abrirParcela(ctx, plotA1);
  await expect(page.getByRole('heading', { name: 'Documentos y soportes' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Documentos aportados' })).toContainText('Contrato de uso (sintético)');
  await expect(page.getByText('Todavía no hay evidencias de esta parcela.')).toBeVisible(); // el contrato NO aparece entre las evidencias del recorrido
  await ctx.close();
});
async function abrirParcela(ctx: BrowserContext, plot: string): Promise<Page> { const p = await ctx.newPage(); await p.goto(`/organizaciones/${orgId}/parcelas/${plot}`); return p; }

test('aislamiento: el documento de una parcela ajena no se ve ni se puede aportar (y se comprueba con un control propio)', async () => {
  const base = `/api/v1/organizations/${orgId}`;
  // Control positivo: la cuenta A sí lista los documentos de SU parcela.
  expect(items(await api(`${base}/documents?owner_type=plot&owner_id=${plotA1}`, { token: prodATok }))).toHaveLength(1);
  // Negativo: la parcela ajena no existe para A (la lista queda vacía y subir no es posible).
  expect(items(await api(`${base}/documents?owner_type=plot&owner_id=${plotOtro}`, { token: prodATok }))).toHaveLength(0);
  const form = new FormData();
  form.append('operation_id', crypto.randomUUID()); form.append('document_type', 'LAND_TENURE'); form.append('owner_type', 'plot'); form.append('owner_id', plotOtro); form.append('title', 'intento ajeno');
  form.append('file', new Blob([PDF], { type: 'application/pdf' }), 'x.pdf');
  const res = await fetch(`${API_URL}${base}/documents`, { method: 'POST', headers: { authorization: `Bearer ${prodATok}` }, body: form });
  expect([403, 404]).toContain(res.status);
  expect(items(await api(`${base}/documents?owner_type=plot&owner_id=${plotOtro}`, { token: adminTok }))).toHaveLength(0); // y no se escribió nada
});

test('cuenta sin vínculo: «configuración pendiente», distinta de «sin datos» y de «sin permiso», sin acceso a lo de otros', async ({ browser }) => {
  const ctx = await contexto(browser, prodBTok);
  const page = await abrirDesdeMenu(ctx);
  await expect(page.getByText('Tu cuenta todavía no está vinculada a un productor.')).toBeVisible();
  await expect(page.getByText(/configuración pendiente, no un error ni que no tengas datos/)).toBeVisible();
  await expect(page.getByText(/Vincular cuenta/)).toBeVisible();                              // dice cómo se resuelve
  await expect(page.getByRole('table', { name: 'Mis parcelas' })).toHaveCount(0);
  await expect(page.getByText('MF-A1')).toHaveCount(0);
  await expect(page.getByText('Tu rol no incluye «Mi finca»')).toHaveCount(0);
  await expect(page.getByText('Sin vínculo de cuenta no hay entregas que mostrar.')).toBeVisible(); // ni entregas ni error de permiso
  await ctx.close();
});

test('un auditor no tiene «Mi finca» (sin permiso) y la ruta directa lo explica', async ({ browser }) => {
  const ctx = await contexto(browser, audiTok);
  const page = await abrirParcelaOrg(ctx);
  await expect(page.getByRole('complementary', { name: 'Navegación principal' }).getByRole('link', { name: 'Mi finca', exact: true })).toHaveCount(0);
  await page.goto(`/organizaciones/${orgId}/mi-finca`);
  await expect(page.getByText(/Tu rol no incluye «Mi finca»/)).toBeVisible();
  await ctx.close();
});
async function abrirParcelaOrg(ctx: BrowserContext): Promise<Page> { const p = await ctx.newPage(); await p.goto(`/organizaciones/${orgId}`); return p; }

test('inglés, teclado y 390 px: textos traducidos, controles alcanzables y sin desborde horizontal', async ({ browser }) => {
  const ctx = await contexto(browser, prodATok, { lang: 'en', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`/organizaciones/${orgId}/mi-finca`);
  await expect(page.getByRole('heading', { name: 'My farm', level: 1 })).toBeVisible();
  await expect(page.getByRole('table', { name: 'My plots' })).toContainText('MF-A1');
  await expect(page.getByRole('table', { name: 'My deliveries' })).toContainText(entregaA);
  await expect(page.getByRole('list', { name: 'Pending items' })).toContainText('Plot MF-A1 has no recorded location.');
  // Teclado: el resumen de la guía se abre con Enter y el selector se maneja con el teclado.
  await page.getByText('What you can document and why (guidance)').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('This is guidance, not a mandatory list: every situation is different.')).toBeVisible();
  const cuerpo = await page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/\b(PERMISSION_DENIED|SCAN_FAILED|AVAILABLE|PENDING|LAND_TENURE|DELIVERY_SUPPORT)\b/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/mi-finca-390.png', fullPage: true });
  await ctx.close();
});
