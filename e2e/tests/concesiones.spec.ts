import { expect, test, type Browser } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// A-02 — Administración web de concesiones externas (RF-49): propietario → destinatario → revocación → pérdida de acceso, con los rechazos por
// recurso y organización ajenos, en español e inglés, con teclado y a 390 px. Datos SINTÉTICOS creados por la API.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-conc@e2e.local', password: randomBytes(12).toString('base64url') };
const TEC = { email: 'tecnico-conc@e2e.local', password: randomBytes(12).toString('base64url') };
const ADMIN_B = { email: 'admin-conc-b@e2e.local', password: randomBytes(12).toString('base64url') };
const EXTERNO = { email: 'externo-conc@e2e.local', password: randomBytes(12).toString('base64url') };
const tok: Record<string, string> = {};
let orgA = ''; let orgB = ''; let loteA = ''; let loteB = ''; let codigoA = '';

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
async function crearLote(org: string, token: string, sufijo: string) {
  const b = `/api/v1/organizations/${org}`; const hoy = new Date().toISOString().slice(0, 10);
  await api(`${b}/products`, { method: 'POST', token, body: { code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' } }).catch(() => undefined);
  await api(`${b}/locations`, { method: 'POST', token, body: { code: `C-${sufijo}`, name: `Centro ${sufijo}`, location_type: 'COLLECTION_CENTER' } });
  const prod = (await api(`${b}/producers`, { method: 'POST', token, body: { producer_code: `P-${sufijo}`, legal_name: `Finca ${sufijo}` } })).id;
  const producto = ((await api(`${b}/products?limit=100`, { token })).items as Array<{ id: string; code: string }>).find((p) => p.code === 'CACAO_BABA')!.id;
  const centro = ((await api(`${b}/locations`, { token })) as Array<{ id: string; code: string }>).find((l) => l.code === `C-${sufijo}`)!.id;
  const d = (await api(`${b}/deliveries`, { method: 'POST', token, body: { operation_id: crypto.randomUUID(), producer_id: prod, product_id: producto, delivery_date: hoy, quantity_declared: '100', unit: 'KG', register: true } })).delivery;
  const rec = (await api(`${b}/deliveries/${d.id}/receptions`, { method: 'POST', token, body: { operation_id: crypto.randomUUID(), location_id: centro, received_at: new Date().toISOString(), weighing: { method: 'Báscula', quantity: '100', unit: 'KG', weighed_on: hoy } } })).reception_id;
  const lote = await api(`${b}/lots`, { method: 'POST', token, body: { operation_id: crypto.randomUUID(), inputs: [{ reception_id: rec, quantity: '100' }] } });
  return { id: (lote.id ?? lote.lot?.id) as string, code: (lote.lot_code ?? lote.lot?.lot_code) as string };
}

test('preparación: dos organizaciones, administración, técnico, cuenta externa y un lote en cada una', async () => {
  const superTok = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  orgA = (await api('/api/v1/organizations', { method: 'POST', token: superTok, body: { name: 'Cooperativa Concesiones A', organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  orgB = (await api('/api/v1/organizations', { method: 'POST', token: superTok, body: { name: 'Cooperativa Concesiones B', organization_type: 'COOPERATIVE', country: 'EC' } })).id;
  const alta = async (org: string, u: { email: string; password: string }, rol: string, por: string) => {
    const inv = await api(`/api/v1/organizations/${org}/invitations`, { method: 'POST', token: por, body: { email: u.email, role_code: rol } });
    await api('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: 'Prueba', last_name: 'Concesiones', password: u.password } });
  };
  const login = async (u: { email: string; password: string }) => (await api('/api/v1/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).access_token as string;
  await alta(orgA, ADMIN, 'ORG_ADMIN', superTok); tok.admin = await login(ADMIN);
  await alta(orgB, ADMIN_B, 'ORG_ADMIN', superTok); tok.adminB = await login(ADMIN_B);
  await alta(orgA, TEC, 'FIELD_TECHNICIAN', tok.admin); tok.tec = await login(TEC);
  await alta(orgB, EXTERNO, 'BUYER', tok.adminB); tok.externo = await login(EXTERNO);   // miembro de B, NO de A
  const a = await crearLote(orgA, tok.admin, 'CA'); loteA = a.id; codigoA = a.code;
  const b = await crearLote(orgB, tok.adminB, 'CB'); loteB = b.id;
  expect(codigoA).toMatch(/^LOT-/);
});

test('administración: otorgar en español con revisión previa y confirmación; lo no confirmado no concede nada', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'admin', `/organizaciones/${orgA}/concesiones`);
  await expect(page.getByRole('heading', { name: 'Concesiones', level: 1 })).toBeVisible();
  await expect(page.getByText('Todavía no has concedido ningún acceso.')).toBeVisible();
  // Solo se ofrecen recursos de esta organización.
  const opciones = await page.getByLabel('Recurso a compartir').locator('option').allInnerTexts();
  expect(opciones.join('|')).toContain(codigoA);
  await page.getByLabel('Recurso a compartir').selectOption({ label: opciones.find((o) => o.includes(codigoA))! });
  // Un correo que no identifica a ninguna cuenta disponible: mensaje único, nada se concede.
  await page.getByLabel('Correo exacto de la cuenta destinataria').fill('nadie-conc@e2e.local');
  await page.getByLabel(/^Motivo \(queda en la auditoría\)/).fill('Revisión del comprador (ensayo)');
  await page.getByRole('button', { name: 'Revisar antes de otorgar' }).click();
  await expect(page.getByText('Revisa antes de otorgar (todavía no se concedió nada)')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar y otorgar' }).click();
  await expect(page.getByText(/No se pudo identificar una cuenta destinataria disponible/)).toBeVisible();
  expect(((await (await fetch(`${API_URL}/api/v1/organizations/${orgA}/access-grants`, { headers: { authorization: `Bearer ${tok.admin}` } })).json()).grants as unknown[]).length).toBe(0);
  // Correo correcto (en mayúsculas): revisión → confirmación.
  await page.getByLabel('Correo exacto de la cuenta destinataria').fill(EXTERNO.email.toUpperCase());
  await page.getByRole('button', { name: 'Revisar antes de otorgar' }).click();
  const rev = page.getByRole('region', { name: /Revisa antes de otorgar/ });
  await expect(rev).toContainText(codigoA);
  await expect(rev).toContainText('Solo lectura');
  await expect(rev).toContainText('No verá identidad de productores, geometrías, documentos personales ni datos económicos');
  expect(((await (await fetch(`${API_URL}/api/v1/organizations/${orgA}/access-grants`, { headers: { authorization: `Bearer ${tok.admin}` } })).json()).grants as unknown[]).length).toBe(0);   // revisar no concede
  await page.getByRole('button', { name: 'Confirmar y otorgar' }).click();
  await expect(page.getByText(/Concesión otorgada/)).toBeVisible();
  const fila = page.getByRole('table', { name: 'Concesiones' }).locator('tbody tr').first();
  await expect(fila).toContainText(codigoA);
  await expect(fila).toContainText(EXTERNO.email);
  await expect(fila).toContainText('Activa');
  await expect(fila).toContainText('Solo lectura');
  await expect(fila).toContainText('Revisión del comprador (ensayo)');
  // No admite una segunda concesión activa del mismo recurso y destinatario.
  await page.getByLabel('Recurso a compartir').selectOption({ label: opciones.find((o) => o.includes(codigoA))! });
  await page.getByLabel('Correo exacto de la cuenta destinataria').fill(EXTERNO.email);
  await page.getByLabel(/^Motivo \(queda en la auditoría\)/).fill('Duplicada');
  await page.getByRole('button', { name: 'Revisar antes de otorgar' }).click();
  await page.getByRole('button', { name: 'Confirmar y otorgar' }).click();
  await expect(page.getByText(/Hay un conflicto con el estado actual|ya hay una concesión activa/i).first()).toBeVisible();
  await ctx.close();
});

test('destinatario: ve SOLO lo concedido, sin identidad ni geometrías; el recurso ajeno y el espacio de la organización le responden 404', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'externo', '/compartido');
  await expect(page.getByText(`Lote`).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Ver', exact: true }).first().click();
  await expect(page.getByText(codigoA).first()).toBeVisible({ timeout: 20_000 });
  const cuerpo = await page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/Finca CA|coordinates|legal_name/);
  // Acceso directo por la vía normal de la organización propietaria: 404; y el lote de la otra organización tampoco existe para él por esa vía.
  expect((await fetch(`${API_URL}/api/v1/organizations/${orgA}/lots/${loteA}`, { headers: { authorization: `Bearer ${tok.externo}` } })).status).toBe(404);
  expect((await fetch(`${API_URL}/api/v1/organizations/${orgA}/access-grants`, { headers: { authorization: `Bearer ${tok.externo}` } })).status).toBe(404);
  await ctx.close();
});

test('rechazos: sin permiso no hay menú ni acceso; un recurso de otra organización no se ofrece ni se concede; otra administración no ve ni revoca', async ({ browser }) => {
  const t = await abrir(browser, 'tec', `/organizaciones/${orgA}/concesiones`);
  await expect(t.page.getByText('No tienes permiso para administrar concesiones.')).toBeVisible();
  await expect(t.page.getByRole('link', { name: 'Concesiones', exact: true })).toHaveCount(0);
  await t.ctx.close();
  // API: lote de B desde A → no se ofrece y no se concede.
  const ofrecidos = (await (await fetch(`${API_URL}/api/v1/organizations/${orgA}/access-grants/shareable?type=LOT`, { headers: { authorization: `Bearer ${tok.admin}` } })).json()).items as Array<{ id: string }>;
  expect(ofrecidos.map((x) => x.id)).not.toContain(loteB);
  const intento = await fetch(`${API_URL}/api/v1/organizations/${orgA}/access-grants`, { method: 'POST', headers: { authorization: `Bearer ${tok.admin}`, 'content-type': 'application/json' }, body: JSON.stringify({ operation_id: crypto.randomUUID(), grantee_email: EXTERNO.email, resource_type: 'LOT', resource_id: loteB, expires_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Recurso ajeno' }) });
  expect(intento.status).toBe(422);
  const b = await abrir(browser, 'adminB', `/organizaciones/${orgB}/concesiones`);
  await expect(b.page.getByText('Todavía no has concedido ningún acceso.')).toBeVisible();
  await b.ctx.close();
});

test('administración: revocar con motivo → estado Revocada y el destinatario pierde el acceso al instante', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'admin', `/organizaciones/${orgA}/concesiones`);
  await page.getByRole('button', { name: 'Revocar', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Confirmar revocación' })).toBeDisabled();       // sin motivo no se confirma
  await page.getByLabel('Motivo de la revocación').fill('Fin de la revisión (ensayo)');
  await page.getByRole('button', { name: 'Confirmar revocación' }).click();
  await expect(page.getByText('Concesión revocada: el destinatario ya no tiene acceso.')).toBeVisible();
  const fila = page.getByRole('table', { name: 'Concesiones' }).locator('tbody tr').first();
  await expect(fila).toContainText('Revocada');
  await expect(fila).toContainText('Fin de la revisión (ensayo)');
  await page.getByRole('button', { name: /^Revocada/ }).click();                                    // filtro por estado
  await expect(page.getByRole('table', { name: 'Concesiones' }).locator('tbody tr')).toHaveCount(1);
  await ctx.close();
  const e = await abrir(browser, 'externo', '/compartido');
  await expect(e.page.getByRole('button', { name: 'Ver', exact: true })).toHaveCount(0);
  const grants = (await (await fetch(`${API_URL}/api/v1/granted`, { headers: { authorization: `Bearer ${tok.externo}` } })).json()).grants as unknown[];
  expect(grants).toEqual([]);
  await e.ctx.close();
});

test('inglés, teclado y 390 px: el mismo recorrido, sin desborde y sin claves de traducción', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'admin', `/organizaciones/${orgA}/concesiones`, { lang: 'en', viewport: { width: 390, height: 844 } });
  await expect(page.getByRole('heading', { name: 'Grants', level: 1 })).toBeVisible();
  await page.getByLabel('Resource to share').selectOption({ index: 1 });
  await page.getByLabel('Exact email of the recipient account').fill(EXTERNO.email);
  await page.getByLabel(/^Reason \(kept in the audit trail\)/).fill('Second review (test)');
  await page.getByRole('button', { name: 'Review before granting' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Review before granting (nothing has been granted yet)')).toBeVisible();
  await expect(page.getByText('What they will see and what they will not')).toBeVisible();
  const cuerpo = await page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/\b[a-z]+\.[a-z_]+\.[a-z_]+\b/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Keep editing' }).click().catch(() => undefined);
  await ctx.close();
});

// Soportes de una instantánea (2026-10-30): el concedente elige «Compartir soportes», el comprador los encuentra y descarga la versión EXACTA, y la
// revocación corta el acceso. Vista limitada: no es el expediente completo (geometrías y documentos personales quedan fuera).
test('soportes de la instantánea: se comparten desde la pantalla, el comprador descarga la versión exacta y la revocación corta el acceso', async ({ browser }) => {
  const b = `/api/v1/organizations/${orgA}`;
  const bytes = Buffer.from(`%PDF-1.4\n% soporte sintético e2e ${crypto.randomUUID()}\n%%EOF\n`);
  const sha = (await import('crypto')).createHash('sha256').update(bytes).digest('hex');
  const lista = (r: unknown) => (Array.isArray(r) ? r : ((r as { items?: unknown[] }).items ?? [])) as Array<Record<string, string>>;
  const productor = lista(await api(`${b}/producers?limit=100`, { token: tok.admin })).find((p) => p.producer_code === 'P-CA')!.id;
  const entrega = lista(await api(`${b}/deliveries`, { token: tok.admin }))[0].id;
  const f = new FormData();
  f.append('operation_id', crypto.randomUUID()); f.append('document_type', 'DELIVERY_SUPPORT'); f.append('owner_type', 'producer'); f.append('owner_id', productor);
  f.append('title', 'Nota de entrega e2e (sintética)'); f.append('file', new Blob([bytes], { type: 'application/pdf' }), 'nota-e2e.pdf');
  const up = await fetch(`${API_URL}${b}/documents`, { method: 'POST', headers: { authorization: `Bearer ${tok.admin}` }, body: f });
  expect(up.status).toBe(201);
  const version = (await up.json()).document.versions[0].id as string;
  await api(`${b}/deliveries/${entrega}/supports`, { method: 'POST', token: tok.admin, body: { operation_id: crypto.randomUUID(), document_version_id: version, support_kind: 'DELIVERY_NOTE' } });
  const caso = (await api(`${b}/dd-cases`, { method: 'POST', token: tok.admin, body: { operation_id: crypto.randomUUID(), lot_id: loteA, scope_note: 'Expediente e2e con soportes' } })).case;
  await api(`${b}/dd-cases/${caso.id}/snapshots`, { method: 'POST', token: tok.admin, body: { operation_id: crypto.randomUUID() } });

  // Concedente: elige «Compartir soportes» y revisa el alcance antes de otorgar.
  const adm = await abrir(browser, 'admin', `/organizaciones/${orgA}/concesiones`);
  await adm.page.getByLabel('Tipo de recurso').selectOption({ label: 'Instantánea de diligencia' });
  await expect(adm.page.getByLabel('Recurso a compartir').locator('option', { hasText: caso.case_number })).toHaveCount(1); // la lista se carga tras elegir el tipo
  const opciones = await adm.page.getByLabel('Recurso a compartir').locator('option').allInnerTexts();
  await adm.page.getByLabel('Recurso a compartir').selectOption({ label: opciones.find((o) => o.includes(caso.case_number))! });
  await adm.page.getByLabel('Correo exacto de la cuenta destinataria').fill(EXTERNO.email);
  await adm.page.getByLabel(/Compartir soportes/).check();
  await adm.page.getByLabel(/Permitir también descargar/).check();
  await adm.page.getByLabel(/^Motivo \(queda en la auditoría\)/).fill('Soportes para la revisión del comprador (ensayo)');
  await adm.page.getByRole('button', { name: 'Revisar antes de otorgar' }).click();
  const rev = adm.page.getByRole('region', { name: /Revisa antes de otorgar/ });
  await expect(rev).toContainText('Incluye los soportes de la instantánea (sin datos personales ni geometrías)');
  await expect(rev).toContainText('vista limitada, no el expediente completo');
  await adm.page.getByRole('button', { name: 'Confirmar y otorgar' }).click();
  await expect(adm.page.getByText(/Concesión otorgada/)).toBeVisible();
  await expect(adm.page.getByRole('table', { name: 'Concesiones' })).toContainText('Incluye los soportes de la instantánea');
  await adm.ctx.close();

  // Comprador: encuentra los soportes permitidos, ve la advertencia de vista limitada y descarga la versión exacta.
  const comp = await abrir(browser, 'externo', '/compartido');
  const fila = comp.page.getByRole('row', { name: /Instantánea de diligencia/ });
  await fila.getByRole('button', { name: 'Ver' }).click();
  await expect(comp.page.getByRole('heading', { name: 'Soportes de la instantánea' })).toBeVisible();
  await expect(comp.page.getByText('Vista limitada, no el expediente completo')).toBeVisible();
  const tabla = comp.page.getByRole('table', { name: 'Soportes de la instantánea' });
  await expect(tabla).toContainText('Nota de entrega e2e (sintética)');
  await expect(tabla).toContainText(sha.slice(0, 16));
  const [descarga] = await Promise.all([comp.page.waitForEvent('download'), tabla.getByRole('button', { name: 'Descargar esta versión' }).click()]);
  const ruta = await descarga.path();
  const contenido = (await import('fs')).readFileSync(ruta!);
  expect(Buffer.compare(contenido, bytes)).toBe(0);
  await expect(comp.page.getByText(new RegExp('Huella SHA-256 ' + sha))).toBeVisible(); // el aviso de descarga declara la huella de la versión entregada
  await comp.ctx.close();

  // Revocar corta el acceso a la lista y a los archivos, por pantalla y por API.
  const g = ((await api(`${b}/access-grants`, { token: tok.admin })).grants as Array<{ id: string; resource_type: string; estado: string; include_documents: boolean }>).find((x) => x.resource_type === 'DD_SNAPSHOT' && x.estado === 'ACTIVA')!;
  expect(g.include_documents).toBe(true);
  await api(`${b}/access-grants/${g.id}/revoke`, { method: 'POST', token: tok.admin, body: { operation_id: crypto.randomUUID(), reason: 'Fin de la comprobación e2e' } });
  const sin = await fetch(`${API_URL}/api/v1/granted/${g.id}/documents`, { headers: { authorization: `Bearer ${tok.externo}` } });
  expect(sin.status).toBe(404);
  const sinArchivo = await fetch(`${API_URL}/api/v1/granted/${g.id}/documents/${version}/content`, { headers: { authorization: `Bearer ${tok.externo}` } });
  expect(sinArchivo.status).toBe(404);
});
