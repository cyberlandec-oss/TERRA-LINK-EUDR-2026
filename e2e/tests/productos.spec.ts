import { expect, test, type Browser } from '@playwright/test';
import { randomBytes } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// P0-011 UI-09 Productos en navegador: catálogo de la organización con estados y unidades de la API.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-productos@e2e.local', password: randomBytes(12).toString('base64url') };
const BUYER = { email: 'comprador-productos@e2e.local', password: randomBytes(12).toString('base64url') };
let token: string;
let orgUrl: string;

async function open(browser: Browser, t = token, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  await ctx.addInitScript((tk) => sessionStorage.setItem('tl_token', tk), t);
  const page = await ctx.newPage();
  return { ctx, page };
}

test('preparación: organización y administrador', async ({ browser }) => {
  const sp = await (await browser.newContext()).newPage();
  await sp.goto('/');
  await sp.getByLabel('Correo').fill(SUPER_EMAIL);
  await sp.getByLabel('Contraseña', { exact: true }).fill(process.env.E2E_SUPER_PASSWORD!);
  await sp.getByRole('button', { name: 'Iniciar sesión' }).click();
  await sp.getByLabel('Nombre').fill('Cooperativa Productos');
  await sp.getByLabel('Tipo de organización (catálogo provisional, no concede permisos)').selectOption({ label: 'Cooperativa' });
  await sp.getByRole('button', { name: 'Crear organización' }).click();
  await sp.getByRole('link', { name: 'Cooperativa Productos' }).click();
  await sp.getByRole('link', { name: 'Incorporar administrador' }).click();
  await sp.getByLabel('Correo', { exact: true }).last().fill(ADMIN.email);
  await sp.getByLabel('Rol').selectOption({ label: 'Administrador de organización' });
  await sp.getByRole('button', { name: 'Generar enlace de invitación' }).click();
  const link = await sp.getByLabel('Enlace de invitación').inputValue();

  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await page.getByLabel('Nombre').fill('Pablo');
  await page.getByLabel('Apellido').fill('Productos');
  await page.getByLabel('Contraseña (mínimo 12 caracteres)').fill(ADMIN.password);
  await page.getByLabel('Repite la contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Aceptar invitación' }).click();
  await expect(page.getByRole('link', { name: 'Productos', exact: true })).toBeVisible();
  orgUrl = page.url().split('/organizaciones/')[0] + '/organizaciones/' + page.url().split('/organizaciones/')[1].split('/')[0];
  token = (await page.evaluate(() => sessionStorage.getItem('tl_token')))!;
});

test('catálogo vacío, alta con opciones de la API y código duplicado con el formulario conservado', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  await page.goto(`${orgUrl}/productos`);
  await expect(page.getByText('Aún no hay productos en el catálogo.')).toBeVisible();
  await expect(page.getByText(/no define conversiones entre unidades/)).toBeVisible();
  const add = async (code: string, name: string, state: string) => {
    await page.getByLabel('Código', { exact: true }).fill(code);
    await page.getByLabel('Nombre', { exact: true }).fill(name);
    await page.getByLabel('Estado o presentación', { exact: true }).last().selectOption({ label: state });
    await expect(page.getByLabel('Unidad de medida')).toHaveValue('KG'); // única unidad del catálogo
    await page.getByRole('button', { name: 'Registrar producto' }).click();
  };
  await add('CACAO_SECO', 'Cacao seco', 'Cacao seco');
  await expect(page.getByText('Producto CACAO_SECO registrado.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Productos' })).toContainText('Kilogramo (kg, masa)');
  await add('CACAO_SECO', 'Otro nombre', 'Cacao en baba');
  await expect(page.getByText('Ya existe un producto con ese código en tu organización.')).toBeVisible();
  await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Otro nombre'); // captura conservada
  await page.getByLabel('Buscar por código, nombre o variedad').fill('inexistente');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('No encontramos productos con estos filtros.')).toBeVisible();
  await ctx.close();
});

test('edición concurrente en dos pestañas: conflicto con el borrador conservado', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  await page.goto(`${orgUrl}/productos`);
  await page.getByRole('link', { name: 'CACAO_SECO' }).click();
  await expect(page.getByRole('heading', { name: /CACAO_SECO/ })).toBeVisible();
  const tab2 = await ctx.newPage();
  await tab2.goto(page.url());
  await tab2.getByLabel('Variedad (opcional)').fill('Nacional');
  await tab2.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(tab2.getByText('Cambios guardados.')).toBeVisible();
  await page.getByLabel('Nombre', { exact: true }).fill('Cacao seco en grano');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText(/Otra persona modificó este producto/)).toBeVisible();
  await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Cacao seco en grano');
  await page.getByRole('button', { name: 'Recargar versión actual' }).click();
  // la recarga termina cuando desaparece el aviso de conflicto: guardar antes enviaría todavía la versión vieja (misma carrera que parcelas.spec; corrida 2026-10-23T02-09-54)
  await expect(page.locator('.error[role="alert"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Cambios guardados.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Historial del producto' })).toContainText('Edición');
  await ctx.close();
});

test('desactivar con confirmación que explica efectos; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  await page.goto(`${orgUrl}/productos`);
  await page.getByRole('link', { name: 'CACAO_SECO' }).click();
  await page.getByLabel('Motivo').fill('Fin de temporada');
  await page.getByRole('button', { name: 'Desactivar', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Los registros históricos que lo usen se conservan sin cambios/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar desactivación' }).click();
  await expect(page.getByText('Inactivo: Fin de temporada')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('usuario sin permiso: sin enlace en el menú y acceso directo denegado', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  const orgId = orgUrl.split('/organizaciones/')[1];
  const inv = await page.request.post(`${API_URL}/api/v1/organizations/${orgId}/invitations`, { headers: { authorization: `Bearer ${token}` }, data: { email: BUYER.email, role_code: 'BUYER' } });
  expect(inv.status()).toBe(201);
  const accept = await page.request.post(`${API_URL}/api/v1/invitations/accept`, { data: { token: (await inv.json()).token, first_name: 'Bruno', last_name: 'Comprador', password: BUYER.password } });
  expect(accept.status()).toBe(200);
  await ctx.close();
  const bctx = await browser.newContext();
  const bp = await bctx.newPage();
  await bp.goto('/');
  await bp.getByLabel('Correo').fill(BUYER.email);
  await bp.getByLabel('Contraseña', { exact: true }).fill(BUYER.password);
  await bp.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(bp.getByRole('heading', { level: 1, name: /organizaciones/i })).toBeVisible();
  await bp.goto(`${orgUrl}/productos`);
  await expect(bp.getByText('Tu rol no permite consultar el catálogo de productos.')).toBeVisible();
  await expect(bp.getByRole('link', { name: 'Productos', exact: true })).toHaveCount(0);
  await bctx.close();
});

test('P0-013 hitos (CTE): consulta de solo lectura con versión, vigencia e integración (P0-012, fermentación, secado y embarque integrados); sin acciones operativas', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  await page.goto(`${orgUrl}/trazabilidad/hitos`);
  const table = page.getByRole('table', { name: 'Hitos de trazabilidad' });
  await expect(table.locator('tbody tr')).toHaveCount(11);
  await expect(page.getByText(/Catálogo versión 1\.6\.0/)).toBeVisible();
  await expect(table).toContainText('DELIVERY@2');
  await expect(table).toContainText('DeliveryRegistered');
  // 1.4.0 (P0-029): SHIPMENT pasa a INTEGRATED con SHIPMENT_DISPATCH → ShipmentDispatched.
  // 1.6.0 (D-32, 2026-10-15): DRYING pasa a INTEGRATED; su cierre existe y publica ProcessingRunClosed.
  // Integradas: CLASSIFICATION, DELIVERY, DRYING, FERMENTATION, RECEPTION, SHIPMENT, STORAGE, WEIGHING.
  // Pendientes: HARVEST, PACKAGING, SALE (sin historia asignada, D-33).
  await expect(page.getByText(/8 operación\(es\) integrada\(s\) y 3 pendiente\(s\)/)).toBeVisible();
  // Contrato de INTEGRATED (cte-release.ts): la operación y su evento EXISTEN; no que esté acreditada de extremo a
  // extremo. La pantalla debe decirlo, para que «Integrada» no se lea como «demostrada».
  await expect(page.getByText(/Integrada.*significa que la operación y su evento existen en la plataforma/)).toBeVisible();
  await expect(page.getByText(/No significa que se haya ejercitado de extremo a extremo/)).toBeVisible();
  // SHIPMENT es el caso que obliga a esa distinción: está integrada y, aun así, hoy ningún embarque se despacha.
  // Reservar no es despachar. Si alguien marcara el despacho como acreditado sin estarlo, esta comprobación falla.
  const shipment = table.locator('tbody tr', { hasText: 'SHIPMENT@2' });
  await expect(shipment).toContainText('Integrada');
  await expect(shipment).toContainText('ShipmentDispatched');
  await expect(shipment).toContainText(/la compuerta bloquea mientras D-34 no defina/);
  await expect(page.getByRole('button', { name: /cosecha|entrega|recepción|procesar|registrar/i })).toHaveCount(0);
  await page.getByLabel('Mostrar definiciones retiradas o sustituidas').press('Space');
  await expect(table.locator('tbody tr')).toHaveCount(19); // las 8 versiones sustituidas (1.1.0 a 1.6.0) siguen consultables
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('P0-014 datos mínimos (KDE) de un hito: tipo, unidad, obligatoriedad, condición y responsable; sin formularios operativos', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  await page.goto(`${orgUrl}/trazabilidad/hitos`);
  await page.getByRole('link', { name: 'Ver datos mínimos de Recepción' }).focus();
  await page.keyboard.press('Enter');
  const table = page.getByRole('table', { name: 'Datos mínimos del hito' });
  await expect(table).toContainText('RECEPTION_RECEIVED_WEIGHT@2');
  await expect(table).toContainText('KG (masa)');
  await expect(table).toContainText('Requerido');
  await expect(table).toContainText('Condición no definida en el contrato'); // 1.1.0: la diferencia se evalúa al cierre (no definido, D-33)
  await expect(table).toContainText('Operador de recepción');
  await expect(page.getByText(/en P0-012: la operación comprueba estos datos con su compuerta por transición/)).toBeVisible();
  await expect(page.getByText(/Qué hitos son obligatorios en cada flujo sigue pendiente \(D-33\)/)).toBeVisible();
  await expect(page.locator('form')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('P0-015 historial de eventos y corrección de una actualización de productor; original visible; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  const orgId = orgUrl.split('/organizaciones/')[1];
  const h = { authorization: `Bearer ${token}` };
  const created = await (await page.request.post(`${API_URL}/api/v1/organizations/${orgId}/producers`, { headers: h, data: { producer_code: 'EV-001', legal_name: 'Finca Eventos', community: 'El Carmen' } })).json();
  const upd = await page.request.patch(`${API_URL}/api/v1/organizations/${orgId}/producers/${created.id}`, { headers: h, data: { expected_version: created.row_version, community: 'Chone' } });
  expect(upd.status()).toBe(200);
  await page.goto(`${orgUrl}/productores/${created.id}`);
  const history = page.getByRole('region', { name: 'Historial de eventos' });
  await expect(history).toContainText('Datos actualizados');
  await history.getByRole('button', { name: 'Corregir la versión 2' }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Valor correcto de comunidad').fill('El Carmen Alto');
  await page.getByLabel('Motivo de la corrección').fill('Se registró la comunidad equivocada');
  await page.getByRole('button', { name: 'Registrar corrección' }).click();
  await expect(history).toContainText('Corrección de datos');
  await expect(history).toContainText('Corrige v2 (Datos actualizados) · motivo: Se registró la comunidad equivocada');
  await expect(history).toContainText('Corregido'); // el original sigue visible y marcado
  await expect(history.getByRole('button', { name: 'Corregir la versión 2' })).toHaveCount(0);
  const after = await (await page.request.get(`${API_URL}/api/v1/organizations/${orgId}/producers/${created.id}`, { headers: h })).json();
  expect(after.community).toBe('El Carmen Alto'); // efecto de dominio
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.goto(`${orgUrl}/entregas-eventos`);
  await expect(page.getByRole('heading', { name: 'Entregas de eventos fallidas' })).toBeVisible();
  await ctx.close();
});

test('P0-018 documentos: carga con etapas y análisis real, disponible, descarga, revisión por versión; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  const orgId = orgUrl.split('/organizaciones/')[1];
  await page.request.post(`${API_URL}/api/v1/organizations/${orgId}/producers`, { headers: { authorization: `Bearer ${token}` }, data: { producer_code: 'DOC-001', legal_name: 'Finca Documentos' } });
  await page.goto(`${orgUrl}/documentos`);
  await expect(page.getByText('Aún no hay documentos a tu alcance.')).toBeVisible();
  await page.getByLabel('Tipo de documento').selectOption({ label: 'Soporte de entrega' });
  await page.getByLabel('Titular').selectOption({ label: 'Productor' });
  await page.getByLabel('Productor', { exact: true }).selectOption({ index: 1 }); // DOC-001 (orden por código)
  await page.getByLabel('Título').fill('Guía de entrega sintética');
  await page.getByLabel('Emisor (opcional)').fill('Centro de acopio (ficticio)');
  await page.getByLabel('Archivo').setInputFiles({ name: 'guia.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% archivo sintético de prueba\n%%EOF\n') });
  await page.getByRole('button', { name: 'Subir documento' }).focus();
  await page.keyboard.press('Enter');
  const stages = page.getByRole('list', { name: 'Etapas de la carga' });
  await expect(stages).toContainText('Análisis antimalware: limpio');
  await expect(stages).toContainText('Registro: versión 1 registrada');
  await expect(page.getByRole('table', { name: 'Documentos' })).toContainText('Disponible (análisis limpio)');
  await page.getByRole('link', { name: 'Guía de entrega sintética' }).first().click();
  await expect(page.getByText(/no prueban autenticidad ni validez jurídica/)).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar v1' }).click()]);
  expect(dl.suggestedFilename()).toBe('guia.pdf');
  await page.getByLabel('Motivo de la revisión').fill('Coincide con la guía física');
  await page.getByRole('button', { name: 'Aceptar versión' }).click();
  await expect(page.getByText(/Revisión humana: aceptada por .+ el .+ Motivo: Coincide con la guía física/)).toBeVisible(); // atribución: quién, cuándo y por qué
  await expect(page.getByText(/no es una certificación de Terra Link/)).toBeVisible();
  await page.getByLabel('Archivo').setInputFiles({ name: 'guia-v2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% versión 2 sintética\n%%EOF\n') });
  await page.getByRole('button', { name: 'Subir versión' }).click();
  const versions = page.getByRole('list', { name: 'Versiones del documento' });
  await expect(versions).toContainText('v2 (vigente)');
  await expect(versions).toContainText('Sin revisar (las revisiones no se heredan entre versiones)');
  await expect(versions).toContainText('Revisión humana: aceptada por');   // la v1 conserva su revisión, con su responsable
  await expect(versions).toContainText('Motivo: Coincide con la guía física');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('P0-019 evidencias: afirmación → soporte por versión → envío → verificación; estados distintos; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  const orgId = orgUrl.split('/organizaciones/')[1];
  const h = { authorization: `Bearer ${token}` };
  const producer = await (await page.request.post(`${API_URL}/api/v1/organizations/${orgId}/producers`, { headers: h, data: { producer_code: 'EVI-001', legal_name: 'Finca Evidencias' } })).json();
  const up = await page.request.post(`${API_URL}/api/v1/organizations/${orgId}/documents`, { headers: h, multipart: {
    operation_id: crypto.randomUUID(), document_type: 'LAND_TENURE', owner_type: 'producer', owner_id: producer.id, title: 'Tenencia EVI (sintética)',
    file: { name: 'tenencia.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% sintético evidencias\n%%EOF\n') } } });
  expect(up.status()).toBe(201);
  await page.goto(`${orgUrl}/evidencias`);
  await page.getByLabel('Afirmación', { exact: true }).selectOption({ label: 'Existe documentación de tenencia' });
  await page.getByLabel('Tipo de entidad').selectOption({ label: 'Productor' });
  await expect(page.getByLabel('Entidad', { exact: true }).locator('option', { hasText: 'EVI-001' })).toHaveCount(1);
  const options = await page.getByLabel('Entidad', { exact: true }).locator('option').allInnerTexts();
  await page.getByLabel('Entidad', { exact: true }).selectOption({ index: options.findIndex((o) => o.includes('EVI-001')) });
  await page.getByRole('button', { name: 'Registrar afirmación' }).click();
  await page.getByRole('link', { name: 'abrir para vincular soportes' }).click();
  await expect(page.getByRole('heading', { name: 'Existe documentación de tenencia' })).toBeVisible();
  await page.getByLabel('Documento', { exact: true }).selectOption({ label: 'Tenencia EVI (sintética) (Documento de tenencia de la tierra)' });
  await page.getByLabel('Versión').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Vincular soporte' }).focus();
  await page.keyboard.press('Enter');
  const sources = page.getByRole('list', { name: 'Soportes de la afirmación' });
  await expect(sources).toContainText('Respalda');
  await expect(sources).toContainText('Archivo disponible (análisis limpio)'); // estado del archivo
  await expect(sources).toContainText('revisión documental: sin revisar'); // estado del documento
  await expect(page.getByText('Borrador', { exact: true })).toBeVisible(); // la afirmación sigue en borrador
  await page.getByRole('button', { name: 'Enviar a revisión' }).click();
  await expect(page.getByText('En revisión', { exact: true })).toBeVisible();
  await page.getByLabel('Motivo').fill('Constancia coherente con el registro');
  await page.getByRole('button', { name: 'Verificar afirmación' }).click();
  await expect(page.getByText('Afirmación verificada', { exact: true })).toBeVisible();
  await expect(page.getByText(/no significa conformidad EUDR ni riesgo nulo/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Decisiones' })).toContainText('Verificación');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('P0-025 auditoría: filtros, detalle con campos y exportación verificable; estados distintos; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  await page.goto(`${orgUrl}/auditoria`);
  const table = page.getByRole('table', { name: 'Registros de auditoría' });
  await expect(table).toBeVisible();
  await expect(page.getByText(/Mostrando \d+ de \d+ registros a tu alcance/)).toBeVisible();
  // filtro por operación con teclado: elegir y aplicar con Enter sobre el botón
  await page.getByLabel('Operación').selectOption({ label: 'Producto creado' });
  await page.getByRole('button', { name: 'Aplicar filtros' }).focus();
  await page.keyboard.press('Enter');
  await expect(table.locator('tbody tr').first()).toContainText('Producto creado');
  expect(await table.locator('tbody tr').filter({ hasNotText: 'Producto creado' }).count()).toBe(0);
  // vacío con filtros (distinto de denegado y de error)
  await page.getByLabel('Desde').fill('2099-01-01');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(page.getByText('Ningún registro a tu alcance coincide con estos filtros.')).toBeVisible();
  await page.getByRole('button', { name: 'Quitar filtros' }).click();
  await expect(table).toBeVisible();
  // detalle: qué cambió, historia y aviso de solo lectura
  await page.getByLabel('Operación').selectOption({ label: 'Producto creado' });
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await table.getByRole('link', { name: 'Producto creado' }).first().click();
  await expect(page.getByRole('heading', { name: 'Qué cambió' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Campos del registro' })).toContainText('code');
  await expect(page.getByRole('list', { name: 'Historia del registro' })).toContainText('este registro');
  await expect(page.getByText('Registro de solo lectura · no se puede editar ni borrar.')).toBeVisible();
  expect(await page.getByRole('button', { name: /Editar|Borrar|Eliminar/ }).count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // exportación con los mismos filtros: archivo con metadatos y hash informado
  await page.goBack();
  await expect(table).toBeVisible();
  await expect(page.getByLabel('Operación')).toHaveValue('product.created'); // filtros conservados en la URL
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  const file = await download;
  const text = (await import('fs')).readFileSync((await file.path())!, 'utf8');
  expect(text).toContain('# formato,TL_AUDIT_CSV 0.1 (provisional)');
  expect(text).toContain('product.created');
  expect(text).not.toContain('product.updated'); // mismos filtros que la pantalla
  await expect(page.getByText('Exportación descargada')).toBeVisible();
  await expect(page.locator('code.hash').last()).toHaveText(/^[0-9a-f]{64}$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('P0-025 auditoría: sin audit:read la sección muestra acceso denegado, no «sin datos»', async ({ browser }) => {
  const login = await (await browser.newContext()).request.post(`${API_URL}/api/v1/auth/login`, { data: { email: BUYER.email, password: BUYER.password } });
  test.skip(!login.ok(), 'requiere la cuenta de comprador creada en las pruebas anteriores');
  const t = (await login.json()).access_token as string;
  const { ctx, page } = await open(browser, t);
  await page.goto(`${orgUrl}/auditoria`);
  await expect(page.getByText('Tu rol no permite consultar la auditoría de esta organización.')).toBeVisible();
  await expect(page.getByText('Aún no hay registros a tu alcance.')).toHaveCount(0);
  await ctx.close();
});

test('P0-012 entregas: registrar con periodo por mes, recibir sin documento con revisión previa; pendientes visibles; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  const orgId = orgUrl.split('/organizaciones/')[1];
  const h = { authorization: `Bearer ${token}` };
  const o = `${API_URL}/api/v1/organizations/${orgId}`;
  const producer = await (await page.request.post(`${o}/producers`, { headers: h, data: { producer_code: 'ENT-E2E-1', legal_name: 'Finca Entregas E2E' } })).json();
  await page.request.post(`${o}/plots`, { headers: h, data: { producer_id: producer.id, plot_code: 'ENT-E2E-P1', crop: 'Cacao' } });
  await page.request.post(`${o}/products`, { headers: h, data: { code: 'CACAO_BABA_E2E', name: 'Cacao en baba E2E', product_state: 'CACAO_BABA', unit: 'KG' } });
  expect((await page.request.post(`${o}/locations`, { headers: h, data: { code: 'CA-E2E', name: 'Centro E2E', location_type: 'COLLECTION_CENTER' } })).status()).toBe(201);
  await page.goto(`${orgUrl}/entregas`);
  await expect(page.getByText('Aún no hay entregas a tu alcance.')).toBeVisible();
  await page.getByLabel('Productor', { exact: true }).selectOption({ label: 'ENT-E2E-1 · Finca Entregas E2E' });
  await page.getByRole('checkbox', { name: 'ENT-E2E-P1' }).check();
  await page.getByLabel('Producto', { exact: true }).selectOption({ label: 'Cacao en baba E2E (CACAO_BABA_E2E)' });
  await page.getByLabel('Cantidad declarada').fill('300');
  await page.getByLabel('Centro de acopio (opcional)').selectOption({ label: 'Centro E2E (CA-E2E)' });
  await expect(page.getByRole('radio', { name: 'Mes o meses' })).toBeChecked(); // modalidad principal: meses (D-34)
  await page.getByLabel('Mes inicial').fill('2026-09');
  await page.getByRole('button', { name: 'Registrar entrega' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Entrega ENT-/ })).toBeVisible();
  await expect(page.getByText('Mes: septiembre de 2026')).toBeVisible();
  await expect(page.getByText('Evidencia documental pendiente').first()).toBeVisible();
  await expect(page.getByText(/no es un expediente completo, producto liberado ni cumplimiento EUDR/)).toBeVisible();
  // recepción física sin documento, con revisión previa a confirmar
  await page.getByLabel('Peso recibido (kg)').fill('120');
  await page.getByLabel('Método de pesaje').fill('Báscula E2E');
  await page.getByRole('button', { name: 'Revisar recepción' }).click();
  await expect(page.getByText('Revisa antes de confirmar')).toBeVisible();
  await expect(page.getByText(/Sin soporte documental: la recepción se registra y la evidencia queda pendiente/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar recepción' }).focus();
  await page.keyboard.press('Enter');
  const rec = page.getByRole('article', { name: 'Recepción 1' });
  await expect(rec).toContainText('120 kg');
  await expect(rec).toContainText('Pendiente de evaluación');
  await expect(rec).toContainText('Soporte documental');
  await expect(page.getByText('Recepción parcial').first()).toBeVisible();
  // La entrega sigue ABIERTA: recibir no la cierra sola y su declaración no se ajusta (D-33, desde el 2026-10-15
  // el cierre existe, pero es explícito).
  const cierreParcial = page.getByRole('region', { name: 'Cierre de la entrega' });
  await expect(cierreParcial).toContainText('Abierta');
  await expect(cierreParcial).toContainText(/La entrega no se ha cerrado; admite recepciones/);
  await expect(cierreParcial).toContainText('180 kg'); // 300 declarados − 120 recibidos, ambas cifras conservadas
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // la lista muestra declarado y recibido por separado
  await page.goto(`${orgUrl}/entregas`);
  const row = page.getByRole('table', { name: 'Entregas' }).locator('tbody tr').first();
  await expect(row).toContainText('300 kg');
  await expect(row).toContainText('120 kg');
  await ctx.close();
});

// ---------------------------------------------------------------------------------------------------
// D-32 y D-33 en pantalla. Estas tres pruebas preparan por API su PROPIO material —productor, centro de acopio y
// productos exclusivos— y no tocan el productor ENT-E2E-1, el centro CA-E2E ni los productos CACAO_BABA_E2E /
// CACAO_FERM_E2E que usan entregas, lotes e inventario. Por eso su posición en el archivo ya no cambia ningún
// resultado: el secado consume solo el lote que él mismo formó, y los cierres solo cierran entregas suyas.
// Las comprobaciones de inventario (750 kg de Cacao fermentado E2E en Centro E2E, traslado y merma) se conservan
// intactas; lo que se elimina es la dependencia de orden, no la verificación. Hasta el 2026-10-15 este bloque iba
// al final del archivo justamente para evitar ese choque; ahora va ANTES de lotes, inventario, riesgo y reportes,
// que es la posición que antes lo rompía: si el archivo entero pasa aquí, el aislamiento está demostrado por
// ejecución y no por argumento.
// Material propio de este bloque, creado por cada prueba que lo necesita y nunca compartido con las anteriores.
const SECADO = { producer: 'SEC-E2E-1', center: 'CA-SEC-E2E', input: 'CACAO_FERM_SEC_E2E', output: 'CACAO_SECO_E2E' };
const CIERRE = { producer: 'CIE-E2E-1', center: 'CA-CIE-E2E', product: 'CACAO_BABA_CIE_E2E' };

/** Crea (o recupera, si ya existe) productor, centro y producto propios de una prueba. Sin tocar los de otras. */
async function materialPropio(
  request: import('@playwright/test').APIRequestContext,
  orgId: string,
  spec: { producer: string; center: string; products: Array<{ code: string; name: string; product_state: string }> },
) {
  const h = { authorization: `Bearer ${token}` };
  const o = `${API_URL}/api/v1/organizations/${orgId}`;
  await request.post(`${o}/producers`, { headers: h, data: { producer_code: spec.producer, legal_name: `Finca ${spec.producer}` } });
  await request.post(`${o}/locations`, { headers: h, data: { code: spec.center, name: `Centro ${spec.center}`, location_type: 'COLLECTION_CENTER' } });
  for (const p of spec.products) await request.post(`${o}/products`, { headers: h, data: { ...p, unit: 'KG' } });
  const producer = (await (await request.get(`${o}/producers?q=${spec.producer}`, { headers: h })).json()).items[0].id as string;
  const center = (await (await request.get(`${o}/locations`, { headers: h })).json()).find((l: { code: string }) => l.code === spec.center).id as string;
  const catalogo = (await (await request.get(`${o}/products?limit=100`, { headers: h })).json()).items as Array<{ id: string; code: string }>;
  const products = Object.fromEntries(spec.products.map((p) => [p.code, catalogo.find((c) => c.code === p.code)!.id])) as Record<string, string>;
  return { o, h, producer, center, products };
}

/** Entrega registrada con su recepción, por API. Devuelve la entrega para operarla en pantalla. */
async function entregaRecibida(
  request: import('@playwright/test').APIRequestContext,
  m: { o: string; h: Record<string, string>; producer: string; center: string },
  productId: string,
  declarado: string,
  recibido: string,
) {
  const hoy = new Date().toISOString().slice(0, 10);
  const delivery = (await (await request.post(`${m.o}/deliveries`, { headers: m.h, data: { operation_id: crypto.randomUUID(), producer_id: m.producer, product_id: productId, delivery_date: hoy, quantity_declared: declarado, unit: 'KG', register: true } })).json()).delivery as { id: string; delivery_code: string };
  const reception = (await (await request.post(`${m.o}/deliveries/${delivery.id}/receptions`, { headers: m.h, data: { operation_id: crypto.randomUUID(), location_id: m.center, received_at: new Date().toISOString(), weighing: { method: 'Báscula E2E', quantity: recibido, unit: 'KG', weighed_on: hoy } } })).json()).reception_id as string;
  return { delivery, reception };
}
test('D-32 secado en pantalla: la humedad se exige al cerrar, en %BH y con método; la medición queda visible; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  const orgId = orgUrl.split('/organizaciones/')[1];
  // Material propio: productor, centro y productos exclusivos del secado. El lote que se seca lo forma esta misma
  // prueba, así que no consume el cacao fermentado cuyos saldos comprueban inventario, riesgo y reportes.
  const m = await materialPropio(page.request, orgId, {
    producer: SECADO.producer, center: SECADO.center,
    products: [
      { code: SECADO.input, name: 'Cacao fermentado para secado E2E', product_state: 'CACAO_FERMENTADO' },
      { code: SECADO.output, name: 'Cacao seco E2E', product_state: 'CACAO_SECO' },
    ],
  });
  const { reception } = await entregaRecibida(page.request, m, m.products[SECADO.input], '100', '100');
  const ferm = (await (await page.request.post(`${m.o}/lots`, { headers: m.h, data: { operation_id: crypto.randomUUID(), inputs: [{ reception_id: reception, quantity: '100' }] } })).json()).lot as { id: string; lot_code: string };

  await page.goto(`${orgUrl}/procesos`);
  await page.getByLabel('Tipo', { exact: true }).selectOption('DRYING');
  await page.getByLabel('Producto de salida').selectOption({ label: 'Cacao seco E2E (CACAO_SECO_E2E)' });
  await page.getByRole('button', { name: 'Preparar proceso' }).click();
  await expect(page.getByRole('heading', { name: /Secado PRC-/ })).toBeVisible();
  // El aviso del secado ya no dice «bloqueado por una decisión pendiente»: dice qué dato hace falta.
  await expect(page.getByText(/exige la humedad final medida en %BH, con método y responsable/)).toBeVisible();
  await page.getByLabel(`Reservar de ${ferm.lot_code}`).fill('100');
  await page.getByRole('button', { name: 'Iniciar proceso' }).click();
  await expect(page.getByText('En curso (entradas reservadas)')).toBeVisible();

  // Cerrar sin humedad: el formulario la exige, así que ni siquiera se envía.
  await page.getByLabel('Salida (kg)').fill('90');
  await page.getByLabel('Pérdida (kg)').fill('10');
  await page.getByRole('button', { name: 'Cerrar proceso' }).click();
  await expect(page.getByText('Cerrado', { exact: true })).toHaveCount(0);

  // Más precisión de la que se conserva: el servidor la RECHAZA con su motivo, no la redondea.
  await page.getByLabel('Humedad final (% en base húmeda)').fill('7.1234567');
  await page.getByLabel('Método de medición').fill('Medidor portátil E2E');
  await page.getByRole('button', { name: 'Cerrar proceso' }).click();
  await expect(page.getByText(/No se redondea/)).toBeVisible();

  await page.getByLabel('Humedad final (% en base húmeda)').fill('7.25');
  await page.getByRole('button', { name: 'Cerrar proceso' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Cerrado', { exact: true })).toBeVisible();
  // La medición queda a la vista con su método y su responsable; un decimal es presentación, no el dato guardado.
  await expect(page.getByText(/7\.3 %BH/)).toBeVisible();
  await expect(page.getByText(/valor registrado: 7\.25/)).toBeVisible();
  await expect(page.getByText('Medidor portátil E2E')).toBeVisible();
  await expect(page.getByText(/No hay límites de aceptación/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  // El secado solo movió su propio material: en inventario, el lote secado aparece en SU centro y el cacao
  // fermentado de las otras pruebas no figura en él. No se comprueba aquí el saldo de Centro E2E: esa cifra la
  // mueve el traslado de P0-017 y comprobarla desde aquí reintroduciría la dependencia de orden que se elimina.
  await page.goto(`${orgUrl}/inventario`);
  const propias = page.getByRole('table', { name: 'Existencias por lote y centro' }).locator('tbody tr').filter({ hasText: `Centro ${SECADO.center}` });
  await expect(propias.filter({ hasText: 'Cacao seco E2E' }).first()).toContainText('90 kg');
  await expect(propias.filter({ hasText: 'Cacao fermentado E2E' })).toHaveCount(0);
  await ctx.close();
});

test('D-33 cierre de entrega en pantalla: toda diferencia exige motivo, lo cerrado no se reabre y la justificación se conserva; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  const orgId = orgUrl.split('/organizaciones/')[1];
  // Productor, centro y producto propios: las entregas que esta prueba crea y cierra no entran en los saldos ni en
  // las listas que comprueban entregas, lotes e inventario, y da igual dónde se ejecute el archivo.
  const m = await materialPropio(page.request, orgId, {
    producer: CIERRE.producer, center: CIERRE.center,
    products: [{ code: CIERRE.product, name: 'Cacao en baba para cierre E2E', product_state: 'CACAO_BABA' }],
  });
  const producto = m.products[CIERRE.product];
  const { delivery: conDiferencia } = await entregaRecibida(page.request, m, producto, '100', '90');

  await page.goto(`${orgUrl}/entregas/${conDiferencia.id}`);
  const cierre = page.getByRole('region', { name: 'Cierre de la entrega' });
  await expect(cierre).toContainText('Abierta');
  await expect(cierre).toContainText('10 kg');
  await expect(cierre).toContainText('faltó respecto de lo declarado');
  await cierre.getByText('Cerrar la entrega', { exact: true }).click();
  await expect(page.getByText(/el motivo es obligatorio/)).toBeVisible();
  await page.getByLabel('Motivo de la diferencia').fill('Merma de transporte verificada en el centro');
  await page.getByRole('button', { name: 'Cerrar entrega' }).focus();
  await page.keyboard.press('Enter');
  await expect(cierre).toContainText('Cerrada y justificada');
  await expect(cierre).toContainText('Merma de transporte verificada en el centro');
  // Cerrada: ni se registran recepciones nuevas ni hay forma de reabrir en pantalla.
  await expect(page.getByRole('button', { name: 'Revisar recepción' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /reabrir/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  // Sin diferencia no se pide motivo alguno: cerrar es rutina.
  const { delivery: sinDiferencia } = await entregaRecibida(page.request, m, producto, '50', '50');
  await page.goto(`${orgUrl}/entregas/${sinDiferencia.id}`);
  await page.getByRole('region', { name: 'Cierre de la entrega' }).getByText('Cerrar la entrega', { exact: true }).click();
  await expect(page.getByText('No hay diferencia que explicar.')).toBeVisible();
  await expect(page.getByLabel('Motivo de la diferencia')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar entrega' }).click();
  await expect(page.getByRole('region', { name: 'Cierre de la entrega' })).toContainText('Cerrada y justificada');
  await ctx.close();
});

test('D-33: un rol sin lectura de entregas no ve ni la pantalla ni el cierre; la negación se explica', async ({ browser }) => {
  // Entrega cerrada propia, creada y cerrada por API con la cuenta administradora: la prueba ya no depende de que
  // otra haya dejado una entrega en CLOSED, así que tampoco se salta en silencio cuando no la encuentra.
  const admin = await browser.newContext();
  const orgId = orgUrl.split('/organizaciones/')[1];
  const m = await materialPropio(admin.request, orgId, {
    producer: CIERRE.producer, center: CIERRE.center,
    products: [{ code: CIERRE.product, name: 'Cacao en baba para cierre E2E', product_state: 'CACAO_BABA' }],
  });
  const { delivery: cerrada } = await entregaRecibida(admin.request, m, m.products[CIERRE.product], '40', '40');
  const detalle = await (await admin.request.get(`${m.o}/deliveries/${cerrada.id}`, { headers: m.h })).json() as { row_version: number };
  const cierre = await admin.request.post(`${m.o}/deliveries/${cerrada.id}/close`, { headers: m.h, data: { operation_id: crypto.randomUUID(), expected_version: detalle.row_version } });
  expect(cierre.status()).toBe(200);
  await admin.close();

  const login = await (await browser.newContext()).request.post(`${API_URL}/api/v1/auth/login`, { data: { email: BUYER.email, password: BUYER.password } });
  expect(login.ok()).toBe(true); // la cuenta de comprador se crea en «usuario sin permiso», al principio del archivo
  const t = (await login.json()).access_token as string;
  const { ctx, page } = await open(browser, t, { width: 390, height: 844 });
  await page.goto(`${orgUrl}/entregas/${cerrada.id}`);
  await expect(page.getByText('Tu rol no permite consultar entregas.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar entrega' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('P0-016 lotes y fermentación: formar lote, reservar, rechazo de balance, cierre 800 → 750 + 50 con rendimiento; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  const orgId = orgUrl.split('/organizaciones/')[1];
  const h = { authorization: `Bearer ${token}` };
  const o = `${API_URL}/api/v1/organizations/${orgId}`;
  const products = (await (await page.request.get(`${o}/products?limit=100`, { headers: h })).json()).items as Array<{ id: string; code: string }>;
  const baba = products.find((p) => p.code === 'CACAO_BABA_E2E')!.id;
  await page.request.post(`${o}/products`, { headers: h, data: { code: 'CACAO_FERM_E2E', name: 'Cacao fermentado E2E', product_state: 'CACAO_FERMENTADO', unit: 'KG' } });
  const producer = (await (await page.request.get(`${o}/producers?q=ENT-E2E-1`, { headers: h })).json()).items[0].id;
  const plotId = (await (await page.request.get(`${o}/plots?limit=100`, { headers: h })).json()).items.find((p: { plot_code: string }) => p.plot_code === 'ENT-E2E-P1').id;
  const center = (await (await page.request.get(`${o}/locations`, { headers: h })).json()).find((l: { code: string }) => l.code === 'CA-E2E').id;
  const today = new Date().toISOString().slice(0, 10);
  const d = (await (await page.request.post(`${o}/deliveries`, { headers: h, data: { operation_id: crypto.randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: '800', unit: 'KG', origins: [{ plot_id: plotId }], register: true } })).json()).delivery;
  await page.request.post(`${o}/deliveries/${d.id}/receptions`, { headers: h, data: { operation_id: crypto.randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'Báscula E2E', quantity: '800', unit: 'KG', weighed_on: today } } });
  // formar lote
  await page.goto(`${orgUrl}/lotes`);
  await page.getByLabel(`Asignar de ${d.delivery_code}`).fill('800');
  await page.getByRole('button', { name: 'Formar lote' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Lote LOT-/ })).toBeVisible();
  await expect(page.getByText(/Reservar no reduce la existencia/).first()).toBeVisible();
  await expect(page.getByText('Calidad pendiente de evaluación en algún insumo')).toBeVisible();
  const lotCode = (await page.getByRole('heading', { name: /Lote LOT-/ }).innerText()).replace('Lote ', '');
  // preparar e iniciar fermentación
  await page.goto(`${orgUrl}/procesos`);
  await page.getByLabel('Producto de salida').selectOption({ label: 'Cacao fermentado E2E (CACAO_FERM_E2E)' });
  await page.getByRole('button', { name: 'Preparar proceso' }).click();
  await expect(page.getByRole('heading', { name: /Fermentación PRC-/ })).toBeVisible();
  await page.getByLabel(`Reservar de ${lotCode}`).fill('800');
  await page.getByRole('button', { name: 'Iniciar proceso' }).click();
  await expect(page.getByText('En curso (entradas reservadas)')).toBeVisible();
  // balance que no cuadra → rechazo explicado; luego 750 + 50
  await page.getByLabel('Salida (kg)').fill('760');
  await page.getByLabel('Pérdida (kg)').fill('50');
  await page.getByRole('button', { name: 'Cerrar proceso' }).click();
  await expect(page.getByText(/El balance no cuadra/)).toBeVisible();
  await page.getByLabel('Salida (kg)').fill('750');
  await page.getByRole('button', { name: 'Cerrar proceso' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Cerrado', { exact: true })).toBeVisible();
  await expect(page.getByText(/rendimiento en masa 93\.75 %/)).toBeVisible();
  await expect(page.getByText(/No es base seca/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // la salida conserva origen y enlaza el lote padre
  await page.getByRole('list', { name: 'Salidas del proceso' }).getByRole('link').first().click();
  await expect(page.getByRole('list', { name: 'Origen hacia atrás' })).toContainText(lotCode);
  await expect(page.getByText('Origen declarado en todos los insumos')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('P0-017 inventario: existencia, reservado y disponible; traslado y merma con motivo; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  const orgId = orgUrl.split('/organizaciones/')[1];
  const h = { authorization: `Bearer ${token}` };
  expect((await page.request.post(`${API_URL}/api/v1/organizations/${orgId}/locations`, { headers: h, data: { code: 'BOD-E2E', name: 'Bodega E2E', location_type: 'WAREHOUSE' } })).status()).toBe(201);
  await page.goto(`${orgUrl}/inventario`);
  await expect(page.getByRole('heading', { name: 'Totales' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Existencias por lote y centro' });
  const outRow = table.locator('tbody tr').filter({ hasText: 'Cacao fermentado E2E' }).first();
  await expect(outRow).toContainText('750 kg');
  await expect(outRow).toContainText('Centro E2E (CA-E2E)');
  // traslado con teclado
  await page.getByLabel('Movimiento', { exact: true }).selectOption({ value: 'transfer' });
  const option = await page.getByLabel('Lote y centro de origen').locator('option').filter({ hasText: 'Centro E2E' }).filter({ hasText: '750 kg' }).first().getAttribute('value');
  await page.getByLabel('Lote y centro de origen').selectOption(option!);
  await page.getByLabel('Centro de destino').selectOption({ label: 'Bodega E2E (BOD-E2E)' });
  await page.getByLabel(/Cantidad \(kg\)/).fill('100');
  await page.getByRole('button', { name: 'Registrar movimiento' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Movimiento registrado.')).toBeVisible();
  await expect(table.locator('tbody tr').filter({ hasText: 'Bodega E2E' }).first()).toContainText('100 kg');
  // merma sin motivo no se envía; con motivo se registra y aparece en movimientos
  await page.getByLabel('Movimiento', { exact: true }).selectOption({ value: 'loss' });
  const bod = await page.getByLabel('Lote y centro de origen').locator('option').filter({ hasText: 'Bodega E2E' }).first().getAttribute('value');
  await page.getByLabel('Lote y centro de origen').selectOption(bod!);
  await page.getByLabel(/Cantidad \(kg\)/).fill('2');
  await page.getByLabel(/^Motivo/).fill('Granos dañados (E2E)');
  await page.getByRole('button', { name: 'Registrar movimiento' }).click();
  await expect(page.getByText('Movimiento registrado.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Movimientos del ledger' })).toContainText('Merma');
  // P0-029: la reserva para embarques ya existe sobre este mismo ledger; el despacho sigue bloqueado por D-34.
  await expect(page.getByText(/Lo reservado incluye procesos en curso y embarques/)).toBeVisible();
  await expect(page.getByText(/El despacho está bloqueado mientras D-34 no defina sus condiciones/)).toBeVisible();
  await page.getByRole('button', { name: 'Comprobar conciliación' }).click();
  await expect(page.getByText(/Conciliado:/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('P0-020 riesgo: evaluar un lote, dimensiones separadas, no evaluable visible, revisión humana; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  await page.goto(`${orgUrl}/riesgo`);
  const table = page.getByRole('table', { name: 'Riesgo por lote' });
  await table.locator('tbody tr').filter({ hasText: 'Cacao fermentado E2E' }).first().getByRole('link').click();
  await expect(page.getByRole('heading', { name: /Riesgo del lote LOT-/ })).toBeVisible();
  await page.getByRole('button', { name: 'Evaluar' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Evaluación 1' })).toBeVisible();
  await expect(page.getByText('Incompleto: hay reglas no evaluables o datos faltantes', { exact: true })).toBeVisible(); // nunca favorable por defecto
  await expect(page.getByText('Indeterminada')).toBeVisible();
  // D-07.2: la severidad se presenta como severidad de los hallazgos EVALUADOS y NUNCA sin su cobertura.
  // Hoy sale «Sin clasificar» porque esta organización no ha adoptado ningún catálogo que declare severidades.
  await expect(page.getByText('Severidad de los hallazgos evaluados')).toBeVisible();
  await expect(page.getByText('Sin clasificar')).toBeVisible();
  await expect(page.getByText(/no ha adoptado el catálogo/i)).toBeVisible();
  // Las categorías sin ninguna regla quedan a la vista: la cobertura no se oculta.
  await expect(page.getByText(/categorías SIN ninguna regla/i)).toBeVisible();
  await expect(page.getByText(/no es conclusión regulatoria/i).first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'No evaluable o faltante' })).toContainText('GEOLOCATION_PROFILE');
  await expect(page.getByRole('list', { name: 'No evaluable o faltante' })).toContainText('D-05');
  await expect(page.getByText(/no prueba ausencia de deforestación/i).first()).toBeVisible(); // el catálogo 1.0.0 lo escribe «NO prueba»
  await page.getByLabel('Motivo para iniciar la revisión').fill('Revisión de datos faltantes (E2E)');
  await page.getByRole('button', { name: 'Iniciar revisión' }).click();
  await expect(page.getByRole('list', { name: 'Historia de revisión' })).toContainText('Revisión iniciada');
  await expect(page.getByText('Incompleto: hay reglas no evaluables o datos faltantes', { exact: true })).toBeVisible(); // la revisión no cambia el resultado
  await page.getByRole('button', { name: 'Reevaluar (nueva versión)' }).click();
  await expect(page.getByRole('heading', { name: 'Evaluación 2' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Versiones de la evaluación' })).toContainText('Evaluación 1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('P0-021 mitigación: crear desde la causa, aportar soporte por versión, entregar; el ejecutor no puede verificar; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  await page.goto(`${orgUrl}/riesgo`);
  await page.getByRole('table', { name: 'Riesgo por lote' }).locator('tbody tr').filter({ hasText: 'Cacao fermentado E2E' }).first().getByRole('link').click();
  await expect(page.getByRole('heading', { name: /Riesgo del lote LOT-/ })).toBeVisible();
  const form = page.getByRole('form', { name: 'Crear mitigación' });
  await form.getByLabel('Causa').selectOption({ label: 'DOCUMENT_EXPIRED · dato faltante' });
  await expect(form.getByText(/Evidencia requerida por la regla/)).toBeVisible();
  await form.getByLabel('Responsable').selectOption({ index: 1 });
  await form.getByLabel('Acción').fill('Aportar soporte documental vigente (E2E)');
  await form.getByLabel('Plazo').fill('2026-12-31');
  await form.getByLabel('Criterio de aceptación').fill('Soporte de entrega vigente y disponible (E2E)');
  await form.getByRole('button', { name: 'Crear mitigación' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('list', { name: 'Mitigaciones del lote' }).getByRole('link', { name: 'Aportar soporte documental vigente (E2E)' }).click();
  await expect(page.getByText('Abierta (sin entrega)')).toBeVisible();
  await page.getByLabel('Versión de documento').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Aportar soporte' }).click();
  await expect(page.getByRole('list', { name: 'Soportes de la mitigación' })).toContainText('Entrega 1');
  await expect(page.getByText('Abierta (sin entrega)')).toBeVisible(); // aportar no verifica
  await page.getByLabel('Nota de entrega').fill('Soporte aportado (E2E)');
  await page.getByRole('button', { name: 'Entregar para verificación' }).click();
  await expect(page.getByText('Entregada: pendiente de verificación')).toBeVisible();
  await page.getByLabel(/confirmo que se cumple el criterio de aceptación/).check();
  await page.getByLabel('Motivo de la decisión').fill('Autoverificación (no debe permitirse)');
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.getByText(/no puede verificarla ni rechazarla/).first()).toBeVisible();
  await expect(page.getByText('Entregada: pendiente de verificación')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('P0-022 expediente: requisitos bloqueados explicados, borrador interno descargable, paquete y aprobación bloqueados; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  await page.goto(`${orgUrl}/diligencia`);
  await expect(page.getByRole('heading', { name: 'Debida diligencia', level: 1 })).toBeVisible();
  const form = page.getByRole('form', { name: 'Crear expediente' });
  await form.getByLabel('Lote').selectOption({ index: 1 });
  await form.getByLabel('Alcance').fill('Expediente E2E sintético');
  await form.getByRole('button', { name: 'Crear expediente' }).focus();
  await page.keyboard.press('Enter');
  const rows = page.getByRole('table', { name: 'Expedientes' }).locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole('link').click();
  await expect(page.getByRole('heading', { name: /Expediente DD-/ })).toBeVisible();
  await page.getByRole('button', { name: 'Capturar instantánea' }).click();
  await expect(page.getByRole('heading', { name: 'Preparación (instantánea 1)' })).toBeVisible();
  const reqs = page.getByRole('table', { name: 'Requisitos' });
  await expect(reqs.locator('tr').filter({ hasText: 'RISK_CATALOG_APPROVED' })).toContainText('No evaluable');
  await expect(reqs.locator('tr').filter({ hasText: 'REGULATORY_CONCLUSION' })).toContainText('No evaluable');
  // Cómo se resuelve: naturaleza, roles del catálogo y pantalla; un requisito pendiente de un tercero lo dice sin prometer lo que Terra Link no puede hacer.
  await expect(reqs.locator('tr').filter({ hasText: 'REGULATORY_CONCLUSION' })).toContainText('Requiere una decisión humana');
  await expect(reqs.locator('tr').filter({ hasText: 'REGULATORY_CONCLUSION' }).getByRole('link', { name: /Ir a Riesgo del lote/ })).toBeVisible();
  await expect(reqs.locator('tr').filter({ hasText: 'RISK_CATALOG_APPROVED' })).toContainText('Depende de un tercero');
  await expect(page.getByText('Bloqueada').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generar paquete de diligencia' })).toBeDisabled();
  await page.getByRole('button', { name: 'Generar borrador interno' }).click();
  await expect(page.getByRole('list', { name: 'Paquetes generados' })).toContainText('Borrador interno para revisión');
  const download = page.waitForEvent('download');
  await page.getByRole('list', { name: 'Paquetes generados' }).getByRole('button', { name: 'Descargar' }).click();
  expect((await download).suggestedFilename()).toMatch(/borrador-interno\.json$/);
  await page.getByLabel('Motivo').fill('Revisión E2E');
  await page.getByRole('button', { name: 'Iniciar revisión' }).click();
  await expect(page.getByText('Estado: En revisión')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprobar preparación' })).toBeDisabled();
  await expect(page.getByText(/Aprobar exige todos los requisitos cumplidos/)).toBeVisible();
  await expect(page.getByText(/no presentada/).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('P0-030 reportes: indicadores con definición y denominador; no calculable no es cero; filtros en la URL; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  await page.goto(`${orgUrl}/reportes`);
  const table = page.getByRole('table', { name: 'Indicadores' });
  await expect(table).toBeVisible();
  // Los 11 KPI de S1 §60, ni uno más ni uno menos, MÁS una extensión declarada: `risk_critical`. No se cuela sin
  // decirlo: la fila se marca en pantalla como extensión de Terra Link y las otras tres de riesgo no llevan esa marca.
  await expect(table.locator('tbody tr')).toHaveCount(12);
  const critico = table.locator('tbody tr', { hasText: 'risk_critical' });
  await expect(critico).toContainText(/Extensión de Terra Link: no está en la lista de S1 §60/);
  await expect(table.locator('tbody tr', { hasText: 'risk_high' })).not.toContainText(/Extensión de Terra Link/);
  await expect(table.locator('tbody tr').filter({ hasText: /Extensión de Terra Link/ })).toHaveCount(1);
  // Lo que se puede calcular, se calcula: esta organización tiene productores y parcelas de las pruebas anteriores.
  const productores = table.locator('tbody tr', { hasText: 'producers_total' });
  await expect(productores).toContainText('Estado actual');
  await expect(productores).toContainText(/no se filtra por .created_at./i);
  // Cada situación tiene su propio estado, y ninguna se publica como cero. Lo que se comprueba aquí es que la pantalla
  // muestre el estado que corresponde a los datos y lo explique; las cinco situaciones se fijan una a una en
  // apps/api/test/reports.int-spec.ts, con fixtures construidas para cada caso.
  const gis = table.locator('tbody tr', { hasText: 'plots_valid' });
  // Desde D-05.A el criterio EXISTE y tiene versión: ya no es «criterio sin definir». Lo que puede faltar es
  // haberlo ejecutado (Desconocido) o que no haya denominador.
  await expect(gis).toContainText(/Desconocido|Sin denominador|OK/);
  await expect(gis).not.toContainText('Criterio sin definir');
  if (/Desconocido/.test(await gis.innerText())) {
    // Hay parcelas con versión vigente y ninguna se ha evaluado con el perfil. Desconocido no es cero.
    await expect(gis).toContainText(/El criterio existe y tiene versión/i);
    await expect(gis).toContainText(/Desconocido no es cero/i);
    await expect(gis).toContainText(/sin evaluar/i);
  } else if (/Sin denominador/.test(await gis.innerText())) {
    // Ninguna parcela tiene versión vigente: no hay denominador, que no es lo mismo que «ninguna cumple».
    await expect(gis).toContainText(/no hay denominador/i);
    await expect(gis).toContainText(/No es 0 ni 100 %/);
  }
  // En cualquier caso, la pantalla dice CONTRA QUÉ criterio cuenta, con su versión, y que no es conformidad.
  await expect(gis).toContainText('EUDR_GEO_V1');
  await expect(gis).toContainText(/no es conformidad EUDR/i);
  await expect(gis).not.toContainText(/^0$/);
  // Riesgo: o no hay sujetos evaluados (sin denominador) o están evaluados sin severidad (desconocido). Nunca 0.
  const riesgo = table.locator('tbody tr', { hasText: 'risk_high' });
  await expect(riesgo).toContainText(/Desconocido|Sin denominador/);
  await expect(riesgo).toContainText(/NOT_ASSESSED|denominador es cero/);
  // El crítico está en el mismo estado y con el mismo trato: no se publica como cero ni se esconde.
  await expect(critico).toContainText(/Desconocido|Sin denominador/);
  await expect(critico).toContainText(/NOT_ASSESSED|denominador es cero/);
  // La leyenda explica los cinco estados, para que «desconocido» no se confunda con «cero».
  await expect(page.getByRole('heading', { name: 'Qué significa cada estado' })).toBeVisible();
  await expect(page.getByText(/Un 0 es un cero observado/)).toBeVisible();
  // La entrega usa la fecha declarada, y se dice en pantalla.
  await expect(table.locator('tbody tr', { hasText: 'deliveries_total' })).toContainText('delivery_date');
  // Interpretación y laguna histórica declaradas, no implícitas.
  await expect(page.getByText(/Readiness no es conformidad/)).toBeVisible();
  await expect(page.getByText(/Reserva no es despacho/)).toBeVisible();
  // Cobertura histórica: incompleta por pérdida de almacenamiento, SIN afirmar que lo anterior esté vacío.
  await expect(page.getByText(/Cobertura histórica incompleta/)).toBeVisible();
  await expect(page.getByText(/Los registros disponibles se incluyen SIEMPRE por su fecha operativa declarada/)).toBeVisible();
  await expect(page.getByText(/toda serie anterior.*vacía/i)).toHaveCount(0);
  await expect(page.getByText(/no contiene datos personales ni coordenadas/)).toBeVisible();
  // Comparación de actividad entre dos períodos: usa fechas operativas y declara si los tramos son equivalentes.
  await page.getByLabel('Desde', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Hasta', { exact: true }).fill('2026-09-30');
  await page.getByLabel('Comparar desde').fill('2026-10-01');
  await page.getByLabel('Comparar hasta').fill('2026-10-31');
  await page.getByRole('button', { name: 'Aplicar período' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Comparación de actividad' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Comparación de actividad' })).toBeVisible();
  // 30 días frente a 31: se declara que NO son equivalentes en vez de corregirlo en silencio.
  await expect(page.getByText('Períodos no equivalentes')).toBeVisible();
  // Comparar actividad no es reconstruir existencias, y la pantalla lo dice.
  await expect(page.getByText(/saldo a una fecha es una capacidad distinta/i)).toBeVisible();
  await expect(page).toHaveURL(/comp_desde=2026-10-01/);

  // Período solo con teclado; el filtro queda en la URL y se conserva al volver de otra pantalla.
  await page.getByLabel('Desde', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Hasta', { exact: true }).fill('2026-09-30');
  await page.getByRole('button', { name: 'Aplicar período' }).press('Enter');
  await expect(page).toHaveURL(/desde=2026-09-01/);
  await expect(page).toHaveURL(/hasta=2026-09-30/);
  const conPeriodo = page.url();
  await page.goto(`${orgUrl}/lotes`);
  await page.goto(conPeriodo); // volver con el período en la URL lo restituye en el formulario
  await expect(page.getByLabel('Desde', { exact: true })).toHaveValue('2026-09-01');
  await expect(page.getByLabel('Hasta', { exact: true })).toHaveValue('2026-09-30');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // Zoom 200 % con la convención del proyecto (1280 px a 640 px CSS; e2e/review/web-por-rol.mjs).
  await page.setViewportSize({ width: 640, height: 430 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('P0-030 reportes por entidad: §97 en pantalla, desconocidos visibles, GeoJSON con su aviso; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, token, { width: 390, height: 844 });
  await page.goto(`${orgUrl}/reportes`);
  const selector = page.getByRole('navigation', { name: 'Reportes disponibles' });
  await expect(selector).toBeVisible();
  // Los seis reportes por entidad de S1 §97, además de los indicadores de §60.
  for (const nombre of ['productores', 'parcelas', 'lotes', 'riesgo', 'trazabilidad', 'debida diligencia']) {
    await expect(selector.getByRole('button', { name: new RegExp(nombre, 'i') })).toBeVisible();
  }
  // El reporte activo se distingue del resto, y no solo por color: `aria-current` lo anuncia.
  await expect(selector.getByRole('button', { name: 'Indicadores (§60)' })).toHaveAttribute('aria-current', 'page');
  // Parcelas: la validación sin evaluar no se presenta como incumplimiento, y el total de válidas no es 0.
  await selector.getByRole('button', { name: /parcelas/i }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Reporte de parcelas', exact: true })).toBeVisible();
  await expect(selector.getByRole('button', { name: 'parcelas', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(selector.getByRole('button', { name: 'Indicadores (§60)' })).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('table', { name: 'Reporte de parcelas' })).toBeVisible();
  await expect(page.getByText(/Válidas \(VALID\)/)).toBeVisible();
  await expect(page.getByText(/DESCONOCIDO/).first()).toBeVisible();
  await expect(page).toHaveURL(/reporte=plots/);
  // La exportación GeoJSON vive aquí, con su aviso: exportación técnica, perfil regulatorio pendiente de D-05.
  await expect(page.getByRole('heading', { name: 'Exportación GeoJSON de parcelas' })).toBeVisible();
  await expect(page.getByText(/Aplicabilidad jurídica del perfil pendiente \(D-05\.B\)/)).toBeVisible();
  await expect(page.getByText(/no es un paquete de debida diligencia/i)).toBeVisible();
  // Las filas se paginan y los totales cubren el conjunto completo, no la página mostrada.
  const paginas = page.getByRole('navigation', { name: 'Páginas del reporte' });
  await expect(paginas).toBeVisible();
  await expect(paginas).toContainText(/Mostrando \d+ de \d+ fila/);
  await expect(paginas.getByRole('button', { name: 'Primera página' })).toBeDisabled(); // ya estamos en la primera
  await expect(page.getByText(/Los TOTALES se calculan siempre sobre el conjunto completo/)).toBeVisible();

  // Riesgo: los lotes sin evaluar aparecen como tales, no se omiten.
  await selector.getByRole('button', { name: /riesgo/i }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Reporte de riesgo', exact: true })).toBeVisible();
  await expect(page.getByText(/no se omite/i)).toBeVisible();
  // La descarga declara que recalcula y que no es la instantánea de la pantalla.
  await expect(page.getByText(/Se RECALCULA al descargar/)).toBeVisible();
  // La pantalla no promete «todas las filas» sin más: declara el tope y cómo se rotula un archivo truncado.
  await expect(page.getByText(/hasta un tope de 20\.000/)).toBeVisible();
  await expect(page.getByText(/se rotula TRUNCADO en su cabecera/)).toBeVisible();
  // Y el alcance exacto de la instantánea: una petición y una exportación, no la navegación entre páginas.
  // Aparece junto a la navegación y junto a los totales: basta con que se declare donde se usa.
  await expect(page.getByText(/navegar entre páginas son peticiones distintas/).first()).toBeVisible();
  // El reporte activo queda en la URL y se conserva al volver desde otra pantalla.
  const conReporte = page.url();
  await page.goto(`${orgUrl}/lotes`);
  await page.goto(conReporte);
  await expect(page.getByRole('heading', { level: 2, name: 'Reporte de riesgo', exact: true })).toBeVisible();
  // Teclado: se puede cambiar de reporte sin ratón.
  await selector.getByRole('button', { name: /trazabilidad/i }).press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Reporte de trazabilidad', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // Zoom 200 % con la convención del proyecto (1280 px a 640 px CSS; e2e/review/web-por-rol.mjs).
  await page.setViewportSize({ width: 640, height: 430 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await ctx.close();
});

test('P0-030 reportes: sin permiso no hay menú ni acceso; la exportación exige su propio permiso', async ({ browser }) => {
  // El comprador no tiene report:read: ni enlace ni acceso directo.
  const bctx = await browser.newContext();
  const bp = await bctx.newPage();
  await bp.goto('/');
  await bp.getByLabel('Correo').fill(BUYER.email);
  await bp.getByLabel('Contraseña', { exact: true }).fill(BUYER.password);
  await bp.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(bp.getByRole('heading', { level: 1, name: /organizaciones/i })).toBeVisible();
  await bp.goto(`${orgUrl}/reportes`);
  await expect(bp.getByText(/Tu rol no permite consultar los reportes/)).toBeVisible();
  await expect(bp.getByRole('link', { name: 'Reportes' })).toHaveCount(0);
  await bctx.close();
  // El administrador sí exporta, y la pantalla declara que la descarga se revalida y queda auditada.
  const { ctx, page } = await open(browser);
  await page.goto(`${orgUrl}/reportes`);
  await expect(page.getByText(/vuelve a comprobar tu permiso/)).toBeVisible();
  await expect(page.getByText(/queda registrada en la auditoría con el hash del archivo/)).toBeVisible();
  await expect(page.getByText(/se recalcula en ese momento/)).toBeVisible(); // la descarga no es la instantánea mostrada
  await expect(page.getByText(/No genera enlaces públicos/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar CSV' })).toBeEnabled();
  await ctx.close();
});

