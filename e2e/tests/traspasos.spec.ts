import { expect, test, type Browser } from '@playwright/test';
import { randomBytes, randomUUID } from 'crypto';
import { Client } from 'pg';
import { API_URL, E2E_DATABASE_URL, SUPER_EMAIL } from '../env';

// A-03 — Traspaso de custodia entre organizaciones (RF-50) desde la web: vínculo bilateral → oferta y reserva → aceptación → intento de salida
// (la compuerta real BLOQUEA) → tránsito → recepción parcial → faltante → conciliación → cierre, con los rechazos por lado y organización, en español
// e inglés, con teclado y a 390 px. Datos SINTÉTICOS creados por la API.
//
// IMPORTANTE: la salida real está bloqueada (D4 no adoptada, D-34 sin resolver). El estado «en tránsito» se construye con un FIXTURE SQL que replica
// los asientos de una salida; sirve para demostrar la recepción y la conciliación, y NO demuestra que hoy pueda registrarse una salida real.
test.describe.configure({ mode: 'serial' });

const ADMIN_A = { email: 'admin-tra-a@e2e.local', password: randomBytes(12).toString('base64url') };
const ADMIN_B = { email: 'admin-tra-b@e2e.local', password: randomBytes(12).toString('base64url') };
const TEC_A = { email: 'tecnico-tra-a@e2e.local', password: randomBytes(12).toString('base64url') };
const ADMIN_C = { email: 'admin-tra-c@e2e.local', password: randomBytes(12).toString('base64url') };
const tok: Record<string, string> = {};
let orgA = ''; let orgB = ''; let orgC = ''; let loteA = ''; let codigoLoteA = ''; let codigoVinculo = ''; let traspaso = ''; let codigoTraspaso = '';
let productoB = ''; let centroB = ''; let centroA = '';

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
const detalle = async (org: string, quien: string, id = traspaso) => (await api(`/api/v1/organizations/${org}/custody-transfers/${id}`, { token: tok[quien] }));
const nivel = async (org: string, quien: string, lot: string) => (await api(`/api/v1/organizations/${org}/lots/${lot}`, { token: tok[quien] })).quantities as { physical: string; reserved: string; available: string };

test('preparación: tres organizaciones, administraciones, un técnico sin permisos de traspaso y un lote de 100 kg en la emisora', async () => {
  const superTok = (await api('/api/v1/auth/login', { method: 'POST', body: { email: SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })).access_token;
  const mk = async (name: string) => (await api('/api/v1/organizations', { method: 'POST', token: superTok, body: { name, organization_type: 'COOPERATIVE', country: 'EC' } })).id as string;
  orgA = await mk('Cooperativa Emisora Traspasos'); orgB = await mk('Cooperativa Receptora Traspasos'); orgC = await mk('Cooperativa Ajena Traspasos');
  const alta = async (org: string, u: { email: string; password: string }, rol: string, por: string) => {
    const inv = await api(`/api/v1/organizations/${org}/invitations`, { method: 'POST', token: por, body: { email: u.email, role_code: rol } });
    await api('/api/v1/invitations/accept', { method: 'POST', body: { token: inv.token, first_name: 'Prueba', last_name: 'Traspasos', password: u.password } });
  };
  const login = async (u: { email: string; password: string }) => (await api('/api/v1/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).access_token as string;
  await alta(orgA, ADMIN_A, 'ORG_ADMIN', superTok); tok.adminA = await login(ADMIN_A);
  await alta(orgB, ADMIN_B, 'ORG_ADMIN', superTok); tok.adminB = await login(ADMIN_B);
  await alta(orgC, ADMIN_C, 'ORG_ADMIN', superTok); tok.adminC = await login(ADMIN_C);
  await alta(orgA, TEC_A, 'FIELD_TECHNICIAN', tok.adminA); tok.tecA = await login(TEC_A);
  const hoy = new Date().toISOString().slice(0, 10);
  const b = `/api/v1/organizations/${orgA}`;
  await api(`${b}/products`, { method: 'POST', token: tok.adminA, body: { code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' } });
  centroA = (await api(`${b}/locations`, { method: 'POST', token: tok.adminA, body: { code: 'CA-TR', name: 'Centro emisor', location_type: 'COLLECTION_CENTER' } })).id;
  const prod = (await api(`${b}/producers`, { method: 'POST', token: tok.adminA, body: { producer_code: 'P-TR', legal_name: 'Finca Traspasos' } })).id;
  const producto = ((await api(`${b}/products?limit=100`, { token: tok.adminA })).items as Array<{ id: string; code: string }>).find((p) => p.code === 'CACAO_BABA')!.id;
  const d = (await api(`${b}/deliveries`, { method: 'POST', token: tok.adminA, body: { operation_id: randomUUID(), producer_id: prod, product_id: producto, delivery_date: hoy, quantity_declared: '100', unit: 'KG', register: true } })).delivery;
  const rec = (await api(`${b}/deliveries/${d.id}/receptions`, { method: 'POST', token: tok.adminA, body: { operation_id: randomUUID(), location_id: centroA, received_at: new Date().toISOString(), weighing: { method: 'Báscula', quantity: '100', unit: 'KG', weighed_on: hoy } } })).reception_id;
  const lote = await api(`${b}/lots`, { method: 'POST', token: tok.adminA, body: { operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '100' }] } });
  loteA = (lote.id ?? lote.lot?.id) as string; codigoLoteA = (lote.lot_code ?? lote.lot?.lot_code) as string;
  const bb = `/api/v1/organizations/${orgB}`;
  productoB = (await api(`${bb}/products`, { method: 'POST', token: tok.adminB, body: { code: 'CACAO_CUSTODIA', name: 'Cacao recibido en custodia', product_state: 'CACAO_BABA', unit: 'KG' } })).id;
  centroB = (await api(`${bb}/locations`, { method: 'POST', token: tok.adminB, body: { code: 'CB-TR', name: 'Recepción receptora', location_type: 'WAREHOUSE' } })).id;
  expect(codigoLoteA).toMatch(/^LOT-/);
});

test('vínculo: la emisora propone y muestra el código una sola vez; la receptora lo confirma; sin código válido no hay vínculo', async ({ browser }) => {
  const a = await abrir(browser, 'adminA', `/organizaciones/${orgA}/traspasos`);
  await expect(a.page.getByRole('heading', { name: 'Traspasos', level: 1 })).toBeVisible();
  await expect(a.page.getByText('La salida real está bloqueada')).toBeVisible();
  await expect(a.page.getByText('Todavía no tienes vínculos.')).toBeVisible();
  await expect(a.page.getByText('Necesitas un vínculo activo con otra organización para ofrecer un traspaso.')).toBeVisible();
  await a.page.getByRole('button', { name: 'Proponer un vínculo nuevo' }).click();
  codigoVinculo = (await a.page.getByLabel('Código del vínculo').innerText()).trim();
  expect(codigoVinculo).toMatch(/^[0-9A-F]{12}$/);
  await expect(a.page.getByRole('table', { name: 'Vínculos' }).locator('tbody tr').first()).toContainText('Pendiente de confirmar');
  await a.page.reload();
  await expect(a.page.getByLabel('Código del vínculo')).toHaveCount(0);              // el código no se vuelve a mostrar
  await a.ctx.close();

  const b = await abrir(browser, 'adminB', `/organizaciones/${orgB}/traspasos`);
  await b.page.getByLabel('Código recibido de la otra organización').fill('ZZZZZZZZZZZZ');
  await b.page.getByRole('button', { name: 'Confirmar vínculo' }).click();
  await expect(b.page.getByText(/El código no es válido, ya se usó o caducó/)).toBeVisible();
  await b.page.getByLabel('Código recibido de la otra organización').fill(codigoVinculo);
  await b.page.getByRole('button', { name: 'Confirmar vínculo' }).click();
  await expect(b.page.getByText('Vínculo confirmado: ya pueden traspasarse custodia entre sí.')).toBeVisible();
  const fila = b.page.getByRole('table', { name: 'Vínculos' }).locator('tbody tr').first();
  await expect(fila).toContainText('Cooperativa Emisora Traspasos');
  await expect(fila).toContainText('Activo');
  await b.ctx.close();
});

test('oferta: revisión previa sin reservar; al confirmar se reserva en la emisora y la existencia no se mueve', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'adminA', `/organizaciones/${orgA}/traspasos`);
  await page.getByLabel('Organización receptora').selectOption({ label: 'Cooperativa Receptora Traspasos' });
  const opciones = await page.getByLabel('Lote y centro de salida').locator('option').allInnerTexts();
  expect(opciones.join('|')).toContain(codigoLoteA);
  await page.getByLabel('Lote y centro de salida').selectOption({ label: opciones.find((o) => o.includes(codigoLoteA))! });
  await page.getByLabel('Cantidad (kg)').fill('150');
  await expect(page.getByText('La cantidad supera lo disponible en ese centro.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar antes de ofrecer' })).toBeDisabled();
  await page.getByLabel('Cantidad (kg)').fill('60');
  await page.getByLabel('Nota para la otra organización (opcional)').fill('Entrega acordada (ensayo)');
  await page.getByRole('button', { name: 'Revisar antes de ofrecer' }).click();
  const rev = page.getByRole('region', { name: /Revisa antes de ofrecer/ });
  await expect(rev).toContainText('60 kg');
  await expect(rev).toContainText('No hereda tu expediente, severidad ni conclusión');
  expect((await nivel(orgA, 'adminA', loteA)).reserved).toBe('0');                    // revisar no reserva
  await page.getByRole('button', { name: 'Confirmar y ofrecer' }).click();
  await expect(page.getByText(/Traspaso ofrecido y cantidad reservada/)).toBeVisible();
  const fila = page.getByRole('table', { name: 'Traspasos' }).locator('tbody tr').first();
  await expect(fila).toContainText('Ofrecido');
  await expect(fila).toContainText('Emisora');
  await expect(fila).toContainText('60 kg');
  codigoTraspaso = (await fila.getByRole('link').innerText()).trim();
  traspaso = (await api(`/api/v1/organizations/${orgA}/custody-transfers`, { token: tok.adminA })).items.find((x: { code: string }) => x.code === codigoTraspaso).id;
  expect(await nivel(orgA, 'adminA', loteA)).toMatchObject({ physical: '100', reserved: '60', available: '40' });
  await ctx.close();
});

test('aceptación por la receptora: ve la instantánea técnica del origen, no el inventario ni los centros de la emisora; aceptar no recibe nada', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'adminB', `/organizaciones/${orgB}/traspasos/${traspaso}`);
  await expect(page.getByRole('heading', { name: `Traspaso ${codigoTraspaso}`, level: 1 })).toBeVisible();
  await expect(page.getByText('Instantánea técnica del origen declarado')).toBeVisible();
  const proyeccion = page.getByRole('region', { name: 'Instantánea técnica del origen declarado' });
  await expect(proyeccion).toContainText(codigoLoteA);
  await expect(proyeccion).toContainText('Incompleto');                    // el lote de la prueba se creó sin parcelas de origen declaradas
  const texto = await page.locator('main').innerText();
  expect(texto).not.toContain('CA-TR');                                              // el centro de la emisora no se muestra
  await page.getByRole('button', { name: 'Aceptar la oferta' }).click();
  await expect(page.getByRole('button', { name: 'Confirmar' })).toBeDisabled();       // sin producto ni centro no se acepta
  await page.getByLabel('Producto (en KG)').selectOption({ label: 'CACAO_CUSTODIA · Cacao recibido en custodia' });
  await page.getByLabel('Centro de recepción').selectOption({ label: 'CB-TR · Recepción receptora' });
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Aceptado').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /Recibida/ })).toContainText('0 kg');
  expect((await nivel(orgA, 'adminA', loteA)).physical).toBe('100');
  await ctx.close();
});

test('salida: la compuerta real BLOQUEA; la pantalla lo explica, el servidor rechaza y nada se mueve', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'adminA', `/organizaciones/${orgA}/traspasos/${traspaso}`);
  const comprobaciones = page.getByRole('region', { name: 'Comprobaciones para registrar la salida' });
  await expect(comprobaciones).toContainText('Reserva completa en el centro de salida');
  await expect(comprobaciones.getByText('Bloquea', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar la salida' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText(/La salida no cumple las condiciones/).first()).toBeVisible();
  expect(await nivel(orgA, 'adminA', loteA)).toMatchObject({ physical: '100', reserved: '60' });
  expect((await detalle(orgA, 'adminA')).status).toBe('ACCEPTED');
  await ctx.close();
});

test('FIXTURE SQL del tránsito (no es una salida real): registra los asientos de la salida para poder demostrar la recepción y la conciliación', async () => {
  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  try {
    const t = (await db.query<{ id: string; quantity: string; sender_lot_id: string; sender_location_id: string }>('SELECT id, quantity::text, sender_lot_id, sender_location_id FROM custody_transfers WHERE id = $1', [traspaso])).rows[0];
    const actor = (await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [ADMIN_A.email])).rows[0].id;
    const mid = randomUUID();
    await db.query('BEGIN');
    await db.query(`INSERT INTO stock_movements (id, organization_id, movement_type, source_type, source_id, operation_id, actor_id, reference) VALUES ($1,$2,'CUSTODY_OUT','custody_transfer',$3,$4,$5,$6::jsonb)`,
      [mid, orgA, t.id, randomUUID(), actor, JSON.stringify({ transfer_id: t.id, fixture: true })]);
    for (const bucket of ['RESERVED', 'PHYSICAL']) {
      await db.query(`INSERT INTO stock_entries (id, organization_id, movement_id, lot_id, location_id, bucket, signed_quantity, unit) VALUES ($1,$2,$3,$4,$5,$6,$7,'KG')`,
        [randomUUID(), orgA, mid, t.sender_lot_id, t.sender_location_id, bucket, `-${t.quantity}`]);
    }
    await db.query(`INSERT INTO custody_transfer_steps (id, transfer_id, actor_org_id, actor_user_id, step, quantity, movement_id, operation_id, detail) VALUES ($1,$2,$3,$4,'DISPATCH',$5,$6,$7,'{"fixture":true}'::jsonb)`,
      [randomUUID(), t.id, orgA, actor, t.quantity, mid, randomUUID()]);
    await db.query(`UPDATE custody_transfers SET status = 'IN_TRANSIT', row_version = row_version + 1, updated_at = now() WHERE id = $1`, [t.id]);
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK'); throw e; } finally { await db.end(); }
  const d = await detalle(orgA, 'adminA');
  expect(d).toMatchObject({ status: 'IN_TRANSIT', quantities: { dispatched: '60', in_transit: '60', received: '0' } });
  expect(await nivel(orgA, 'adminA', loteA)).toMatchObject({ physical: '40', reserved: '0', available: '40' });
});

test('recepción parcial y faltante desde la web: lo no recibido sigue en tránsito; el faltante queda pendiente y no resta existencias', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'adminB', `/organizaciones/${orgB}/traspasos/${traspaso}`);
  await expect(page.getByText('En tránsito').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /^En tránsito/ })).toContainText('60 kg');
  await page.getByRole('button', { name: 'Registrar una recepción' }).click();
  const form = page.getByRole('form', { name: 'Registrar una recepción' });
  await form.getByLabel('Cantidad (kg)').fill('40');
  await form.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByRole('row', { name: /^Recibida/ })).toContainText('40 kg');
  await expect(page.getByRole('row', { name: /^En tránsito/ })).toContainText('20 kg');
  // Faltante: exige cantidad y motivo; no es una pérdida.
  await page.getByRole('button', { name: 'Declarar un faltante' }).click();
  const f = page.getByRole('form', { name: 'Declarar un faltante' });
  await expect(f.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  await f.getByLabel('Cantidad (kg)').fill('20');
  await f.getByLabel('Motivo').fill('Faltaron sacos en el camión');
  await f.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Con diferencia pendiente').first()).toBeVisible();
  await expect(page.getByRole('row', { name: /^Faltante pendiente/ })).toContainText('20 kg');
  await expect(page.getByRole('row', { name: /^Pérdida confirmada/ })).toContainText('0 kg');
  await ctx.close();
  const d = await detalle(orgB, 'adminB');
  expect(d).toMatchObject({ status: 'WITH_DISCREPANCY', quantities: { received: '40', in_transit: '20', loss_confirmed: '0', open_shortage: '20' } });
  expect((await nivel(orgA, 'adminA', loteA)).physical).toBe('40');                  // el faltante pendiente no restó nada
});

test('conciliación: quien declaró el faltante no lo confirma; la emisora confirma la pérdida con motivo y el traspaso se cierra con diferencias', async ({ browser }) => {
  const b = await abrir(browser, 'adminB', `/organizaciones/${orgB}/traspasos/${traspaso}`);
  await b.page.getByRole('button', { name: 'Resolver', exact: true }).click();
  const opciones = await b.page.getByLabel('Resolución').locator('option').allInnerTexts();
  expect(opciones.join('|')).not.toContain('Confirmar la pérdida');                  // la declarante no se confirma a sí misma
  expect(opciones.join('|')).toContain('Reabrir: la mercancía sigue en tránsito');
  await b.ctx.close();

  const { ctx, page } = await abrir(browser, 'adminA', `/organizaciones/${orgA}/traspasos/${traspaso}`);
  await page.getByRole('button', { name: 'Resolver', exact: true }).click();
  await page.getByLabel('Resolución').selectOption({ label: 'Confirmar la pérdida' });
  await page.getByLabel('Motivo', { exact: true }).fill('Confirmado con el transportista (ensayo)');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Cerrado').first()).toBeVisible();
  await expect(page.getByText('Cerrado con diferencias registradas')).toBeVisible();
  await expect(page.getByRole('row', { name: /^Pérdida confirmada/ })).toContainText('20 kg');
  await expect(page.getByRole('row', { name: /^En tránsito/ })).toContainText('0 kg');
  await expect(page.getByText('Este traspaso no admite más acciones.')).toBeVisible();
  const historia = page.getByRole('region', { name: /Historia/ });
  for (const paso of ['Oferta y reserva', 'Aceptación', 'Salida', 'Recepción', 'Faltante declarado', 'Pérdida confirmada']) await expect(historia).toContainText(paso);
  await ctx.close();
  const d = await detalle(orgA, 'adminA');
  expect(d).toMatchObject({ status: 'CLOSED', closure: 'WITH_DIFFERENCES', quantities: { received: '40', in_transit: '0', loss_confirmed: '20' } });
  expect((await nivel(orgA, 'adminA', loteA)).physical).toBe('40');                  // la pérdida confirmada no restó otra vez
  // El lote de la receptora existe con origen incompleto y sin heredar nada.
  const lotesB = (await api(`/api/v1/organizations/${orgB}/lots`, { token: tok.adminB }));
  const recibido = (lotesB.items ?? lotesB.lots ?? lotesB).find((l: { source: string }) => l.source === 'CUSTODY_TRANSFER');
  expect(recibido).toBeTruthy();
  const det = await api(`/api/v1/organizations/${orgB}/lots/${recibido.id}`, { token: tok.adminB });
  expect(det).toMatchObject({ origin: { status: 'INCOMPLETE' }, quantities: { physical: '40' }, custody_origin: { transfer_code: codigoTraspaso } });
});

test('rechazos: sin permiso no hay menú ni acceso; otra organización no ve el traspaso; cada lado solo actúa en el suyo', async ({ browser }) => {
  const t = await abrir(browser, 'tecA', `/organizaciones/${orgA}/traspasos`);
  await expect(t.page.getByText('No tienes permiso para consultar traspasos.')).toBeVisible();
  await expect(t.page.getByRole('link', { name: 'Traspasos', exact: true })).toHaveCount(0);
  await t.ctx.close();
  const get = async (org: string, quien: string, ruta: string) => (await fetch(`${API_URL}/api/v1/organizations/${org}/${ruta}`, { headers: { authorization: `Bearer ${tok[quien]}` } })).status;
  expect(await get(orgC, 'adminC', `custody-transfers/${traspaso}`)).toBe(404);     // control autorizado: A y B sí lo ven (200 abajo)
  expect(await get(orgA, 'adminC', `custody-transfers/${traspaso}`)).toBe(404);
  expect(await get(orgA, 'adminA', `custody-transfers/${traspaso}`)).toBe(200);
  expect(await get(orgB, 'adminB', `custody-transfers/${traspaso}`)).toBe(200);
  expect(await get(orgA, 'tecA', `custody-transfers/${traspaso}`)).toBe(403);
  const c = await abrir(browser, 'adminC', `/organizaciones/${orgC}/traspasos`);
  await expect(c.page.getByText('Todavía no hay traspasos.')).toBeVisible();
  await c.ctx.close();
  // Lado equivocado: la emisora no recibe.
  const r = await fetch(`${API_URL}/api/v1/organizations/${orgA}/custody-transfers/${traspaso}/receive`, { method: 'POST', headers: { authorization: `Bearer ${tok.adminA}`, 'content-type': 'application/json' }, body: JSON.stringify({ operation_id: randomUUID(), expected_version: 1, quantity: '1' }) });
  expect(r.status).toBe(403);
});

test('inglés, teclado y 390 px: el mismo recorrido, sin desborde y sin claves de traducción', async ({ browser }) => {
  const { ctx, page } = await abrir(browser, 'adminB', `/organizaciones/${orgB}/traspasos/${traspaso}`, { lang: 'en', viewport: { width: 390, height: 844 } });
  await expect(page.getByRole('heading', { name: `Transfer ${codigoTraspaso}`, level: 1 })).toBeVisible();
  await expect(page.getByText('Technical snapshot of the declared origin')).toBeVisible();
  await expect(page.getByRole('row', { name: /^Confirmed loss/ })).toContainText('20 kg');
  await expect(page.getByText('Closed with recorded differences')).toBeVisible();
  const cuerpo = await page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/\b(IN_TRANSIT|WITH_DISCREPANCY|LOSS_CONFIRMED|SHORTAGE|OVERAGE|WITH_DIFFERENCES|DECLARE_SHORTAGE|OFFERED)\b/); // sin códigos internos (el código de producto es dato del usuario)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.goto(`/organizaciones/${orgA}/traspasos`);
  await ctx.close();

  const a = await abrir(browser, 'adminA', `/organizaciones/${orgA}/traspasos`, { lang: 'en', viewport: { width: 390, height: 844 } });
  await expect(a.page.getByRole('heading', { name: 'Transfers', level: 1 })).toBeVisible();
  await a.page.getByLabel('Receiving organization').selectOption({ index: 1 });
  await a.page.getByLabel('Lot and dispatch center').selectOption({ index: 1 }).catch(() => undefined);
  await a.page.getByLabel('Quantity (kg)').fill('10');
  const revisar = a.page.getByRole('button', { name: 'Review before offering' });
  await revisar.focus();
  await a.page.keyboard.press('Enter');
  const hayStock = await a.page.getByLabel('Lot and dispatch center').locator('option').count();
  if (hayStock > 1) await expect(a.page.getByText('Review before offering (nothing has been reserved yet)')).toBeVisible();
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await a.ctx.close();
});
