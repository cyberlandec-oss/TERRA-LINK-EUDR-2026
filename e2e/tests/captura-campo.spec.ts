import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// A-01 en navegador — captura de campo desde la web con alcance PROPIO.
// Un productor vinculado registra la ubicación de SU parcela (coordenadas escritas → revisión del servidor → guardado →
// corrección con motivo → evidencia), en español y en inglés, con teclado y a 390 px; y no alcanza la parcela de otro.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-a01@e2e.local', password: randomBytes(12).toString('base64url') };
const PROD = { email: 'productor-a01@e2e.local', password: randomBytes(12).toString('base64url') };
let adminTok = '';
let prodTok = '';
let orgId = '';
let plotPropia = '';
let plotAjena = '';

async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
async function ok(path: string, init: Parameters<typeof api>[1] = {}) {
  const r = await api(path, init);
  if (r.status >= 300) throw new Error(`${init.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(r.body?.error?.code)}`);
  return r.body;
}
async function abrir(browser: Browser, ruta: string, opts: { lang?: 'es' | 'en'; viewport?: { width: number; height: number } } = {}) {
  const ctx = await browser.newContext({ ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); if (l) localStorage.setItem('tl_lang', l); }, [prodTok, opts.lang ?? ''] as const);
  const page = await ctx.newPage();
  await page.goto(ruta);
  return { ctx, page };
}
const sinDesbordeHorizontal = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

test('preparación: organización, administrador, productor vinculado y dos parcelas', async () => {
  const superTok = (await ok('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgId = (await ok('/api/v1/organizations', { method: 'POST', token: superTok, body: { name: 'Cooperativa Captura A01', organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const aceptar = async (u: { email: string; password: string }, rol: string, por: string) => {
    const inv = await ok(`/api/v1/organizations/${orgId}/invitations`, { method: 'POST', token: por, body: { email: u.email, role_code: rol } });
    await ok('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: 'Uno', last_name: 'A01', password: u.password } });
  };
  await aceptar(ADMIN, 'ORG_ADMIN', superTok);
  adminTok = (await ok('/api/v1/auth/login', { method: 'POST', body: { email: ADMIN.email, password: ADMIN.password } })).access_token;
  await aceptar(PROD, 'PRODUCER', adminTok);
  prodTok = (await ok('/api/v1/auth/login', { method: 'POST', body: { email: PROD.email, password: PROD.password } })).access_token;
  const base = `/api/v1/organizations/${orgId}`;
  const members = await ok(`${base}/members`, { token: adminTok });
  const lista = (Array.isArray(members) ? members : members.members) as Array<{ email: string; membership_id: string }>;
  const mem = lista.find((m) => m.email === PROD.email)!.membership_id;
  const propio = (await ok(`${base}/producers`, { method: 'POST', token: adminTok, body: { producer_code: 'A01-PROPIO', legal_name: 'Finca Propia (sintética)' } })).id;
  const ajeno = (await ok(`${base}/producers`, { method: 'POST', token: adminTok, body: { producer_code: 'A01-AJENO', legal_name: 'Finca Ajena (sintética)' } })).id;
  const det = await ok(`${base}/producers/${propio}`, { token: adminTok });
  await ok(`${base}/producers/${propio}/self-membership`, { method: 'PUT', token: adminTok, body: { expected_version: det.row_version, membership_id: mem, reason: 'Alta del productor en la plataforma' } });
  plotPropia = (await ok(`${base}/plots`, { method: 'POST', token: adminTok, body: { producer_id: propio, plot_code: 'A01-L-PROPIA', crop: 'Cacao' } })).id;
  plotAjena = (await ok(`${base}/plots`, { method: 'POST', token: adminTok, body: { producer_id: ajeno, plot_code: 'A01-L-AJENA', crop: 'Cacao' } })).id;
  expect(prodTok.length).toBeGreaterThan(20);
});

test('alcance: la parcela ajena no existe para el productor, ni en la API ni en la lista', async () => {
  const base = `/api/v1/organizations/${orgId}`;
  expect((await api(`${base}/plots/${plotAjena}`, { token: prodTok })).status).toBe(404);
  expect((await api(`${base}/plots/${plotPropia}`, { token: prodTok })).status).toBe(200);          // control autorizado
  const lista = (await ok(`${base}/plots`, { token: prodTok })).items as Array<{ id: string }>;
  expect(lista.map((p) => p.id)).toEqual([plotPropia]);
});

test('recorrido en español: escribir coordenadas, revisar sin guardar, guardar, corregir con motivo y adjuntar evidencia', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, `/organizaciones/${orgId}/captura`);
  await expect(page.getByRole('heading', { name: 'Captura de campo' })).toBeVisible();
  // Un único productor propio se elige solo; la parcela ajena no aparece entre las opciones.
  await expect(page.getByLabel('Productor', { exact: true })).toHaveValue(/.+/);
  const parcela = page.getByLabel('Parcela', { exact: true });
  await expect(parcela.locator('option', { hasText: 'A01-L-PROPIA' })).toHaveCount(1);
  await expect(parcela.locator('option', { hasText: 'A01-L-AJENA' })).toHaveCount(0);
  await parcela.selectOption({ index: 1 });

  await page.getByRole('button', { name: 'Escribir o dibujar' }).click();
  await page.getByLabel(/Longitud.*vértice 1/).fill('-80.16');
  await page.getByLabel(/Latitud.*vértice 1/).fill('-0.85');
  await page.getByRole('button', { name: 'Revisar antes de guardar' }).click();
  await expect(page.getByText('todavía no se guardó nada')).toBeVisible();
  await expect(page.getByText('NO acreditan', { exact: false }).first()).toBeVisible();   // procedencia: no es GPS
  await expect(page.getByText('No informada: no hay medición.')).toBeVisible();
  // La revisión no creó ninguna versión.
  const antes = await ok(`/api/v1/organizations/${orgId}/plots/${plotPropia}/geometry-versions`, { token: prodTok });
  expect((antes.items ?? antes.data ?? antes).length).toBe(0);
  await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
  await expect(page.getByText('Ubicación guardada como versión 1.')).toBeVisible();

  // Corregir exige un motivo y conserva la versión anterior.
  await page.getByLabel(/Longitud.*vértice 1/).fill('-80.161');
  await page.getByLabel(/Latitud.*vértice 1/).fill('-0.851');
  await page.getByRole('button', { name: 'Revisar antes de guardar' }).click();
  await expect(page.getByRole('button', { name: 'Guardar como nueva versión' })).toBeDisabled();
  await page.getByLabel(/Motivo de la corrección/).fill('Corrección tras recorrer el lindero');
  await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
  await expect(page.getByText('Ubicación guardada como versión 2.')).toBeVisible();
  const despues = await ok(`/api/v1/organizations/${orgId}/plots/${plotPropia}/geometry-versions`, { token: prodTok });
  expect((despues.items ?? despues.data ?? despues).length).toBe(2);

  // Evidencia: se recibe, pero NO se aprueba (queda pendiente del análisis antimalware y de otra persona autorizada).
  await page.getByLabel('Archivo (PDF, JPEG o PNG)').setInputFiles({
    name: 'recorrido.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% evidencia sintetica ${randomBytes(6).toString('hex')}\n%%EOF\n`),
  });
  await page.getByLabel('Título', { exact: true }).fill('Recorrido de campo (sintético)');
  await page.getByRole('button', { name: 'Subir evidencia' }).click();
  await expect(page.getByText(/Evidencia recibida/)).toBeVisible();
  await ctx.close();
});

test('inglés, teclado y 390 px: mismas pantallas, sin desborde y con la revisión alcanzable por teclado', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, `/organizaciones/${orgId}/captura`, { lang: 'en', viewport: { width: 390, height: 844 } });
  await expect(page.getByRole('heading', { name: 'Field capture' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Plot/ }).first()).toBeVisible();
  await page.getByLabel('Plot', { exact: true }).selectOption({ index: 1 });
  await expect(page.getByText('Field visit evidence', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Type or draw' }).click();
  await page.getByRole('button', { name: 'Draw on the sketch' }).click();
  // El croquis se maneja con teclado: foco, flechas y Enter fijan un vértice.
  const croquis = page.getByRole('application');
  await croquis.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel(/Longitude.*vertex 1/)).not.toHaveValue('');
  await page.getByRole('button', { name: 'Review before saving' }).click();
  await expect(page.getByText('nothing has been saved yet', { exact: false })).toBeVisible();
  await expect(page.getByText('Coordinate order')).toBeVisible();
  const cuerpo = await page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/\b[a-z]+\.[a-z_]+\.[a-z_]+\b/);        // ninguna clave de traducción a la vista
  await sinDesbordeHorizontal(page);
  await ctx.close();
});

test('fotografía (D-41): la web sube una copia SIN metadatos como «Fotografía de campo»; el original no se toca', async ({ browser }) => {
  // JPEG sintético con EXIF (orientación y puntero a GPS), XMP y comentario, como lo entrega una cámara.
  const ascii = (x: string) => Array.from(x, (c) => c.charCodeAt(0));
  const seg = (m: number, d: number[]) => [0xff, m, (d.length + 2) >> 8, (d.length + 2) & 0xff, ...d];
  const tiff = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 2, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 0x30, 0, 0, 0, 0, 0, 0, 0];
  const jpeg = Buffer.from([0xff, 0xd8, ...seg(0xe1, [...ascii('Exif  '), ...tiff]), ...seg(0xe1, ascii('http://ns.adobe.com/xap/1.0/ <xmpmeta>TelefonoSintetico</xmpmeta>')),
    ...seg(0xfe, ascii('comentario')), ...seg(0xdb, [0, 1, 2, 3]), 0xff, 0xda, 0, 4, 1, 0, ...ascii(`datos-${randomBytes(6).toString('hex')}`), 0xff, 0xd9]);
  const { ctx, page } = await abrir(browser, `/organizaciones/${orgId}/captura`);
  await page.getByLabel('Parcela', { exact: true }).selectOption({ index: 1 });
  await expect(page.getByText(/«Fotografía de campo»: se prepara una copia sin metadatos/)).toBeVisible();
  await page.getByLabel('Archivo (PDF, JPEG o PNG)').setInputFiles({ name: 'IMG_0001.JPG', mimeType: 'image/jpeg', buffer: jpeg });
  await page.getByLabel('Título', { exact: true }).fill('Foto del lindero (sintética)');
  await page.getByRole('button', { name: 'Subir evidencia' }).click();
  await expect(page.getByText(/Evidencia recibida/)).toBeVisible();
  await expect(page.getByText('Se quitaron los metadatos de la copia subida; tu archivo original no se modificó.')).toBeVisible();
  // El servidor guardó la COPIA: otro SHA-256 que el original, con nombre neutro y tipo «Fotografía de campo».
  const { createHash } = await import('crypto');
  const docs = await ok(`/api/v1/organizations/${orgId}/documents?owner_type=plot&owner_id=${plotPropia}`, { token: prodTok });
  const lista = (Array.isArray(docs) ? docs : docs.items ?? docs.data) as Array<{ document_type: string; versions: Array<{ sha256: string; file_name: string | null }> }>;
  const foto = lista.find((d) => d.document_type === 'FIELD_PHOTO');
  expect(foto).toBeTruthy();
  expect(foto!.versions[0].sha256).not.toBe(createHash('sha256').update(jpeg).digest('hex'));
  expect(JSON.stringify(foto)).not.toContain('IMG_0001');
  // El productor vinculado ve y puede descargar SU fotografía (permiso propio), aunque sea dato personal.
  await page.getByRole('link', { name: 'Foto del lindero (sintética)' }).click();
  await expect(page.getByRole('button', { name: /Descargar v1/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('tu rol puede ver los metadatos, no el contenido')).toHaveCount(0);
  await ctx.close();
});

test('captura no es decidir: el productor no puede evaluar, encargar satélite ni ver riesgo', async () => {
  const base = `/api/v1/organizations/${orgId}`;
  expect((await api(`${base}/plots/${plotPropia}/gis-evaluations`, { method: 'POST', token: prodTok, body: { operation_id: crypto.randomUUID() } })).status).toBe(403);
  expect((await api(`${base}/plots/${plotPropia}/satellite/analyses`, { method: 'POST', token: prodTok, body: { operation_id: crypto.randomUUID(), operation: 'FOREST_COVER' } })).status).toBe(403);
  expect((await api(`${base}/risk/lots`, { token: prodTok })).status).toBe(403);
});
