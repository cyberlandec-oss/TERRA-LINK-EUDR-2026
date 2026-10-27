import { expect, test, type Browser } from '@playwright/test';
import { createHash, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { SUPER_EMAIL } from '../env';

// P0-009 en navegador: importación GeoJSON con revisión previa, exportación y descarga del original.
// Archivos GeoJSON sintéticos (no son levantamientos reales).
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-geojson@e2e.local', password: randomBytes(12).toString('base64url') };
let token: string;
let plotUrl: string;
// [longitud, latitud] inequívoco: −80.x es longitud (Manabí), −0.8x latitud.
const SQUARE = [[-80.16, -0.848], [-80.159, -0.848], [-80.159, -0.847], [-80.16, -0.847], [-80.16, -0.848]];
const BOWTIE = [[-80.16, -0.848], [-80.159, -0.847], [-80.159, -0.848], [-80.16, -0.847], [-80.16, -0.848]];
const fileOf = (o: unknown) => Buffer.from(JSON.stringify(o, null, 2));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function open(browser: Browser, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext({ acceptDownloads: true, ...(viewport ? { viewport } : {}) });
  await ctx.addInitScript((t) => sessionStorage.setItem('tl_token', t), token);
  const page = await ctx.newPage();
  await page.goto(plotUrl);
  await expect(page.getByRole('heading', { name: 'GJ-01' })).toBeVisible();
  // A-01: los métodos de captura se eligen primero (la ficha ya no muestra todos a la vez).
  await page.getByRole('button', { name: 'Importar GeoJSON' }).click();
  return { ctx, page };
}

test('preparación: organización, administrador, productor y parcela sin geometría', async ({ browser }) => {
  const sp = await (await browser.newContext()).newPage();
  await sp.goto('/');
  await sp.getByLabel('Correo').fill(SUPER_EMAIL);
  await sp.getByLabel('Contraseña', { exact: true }).fill(process.env.E2E_SUPER_PASSWORD!);
  await sp.getByRole('button', { name: 'Iniciar sesión' }).click();
  await sp.getByLabel('Nombre').fill('Cooperativa GeoJSON');
  await sp.getByLabel('Tipo de organización (catálogo provisional, no concede permisos)').selectOption({ label: 'Cooperativa' });
  await sp.getByRole('button', { name: 'Crear organización' }).click();
  await sp.getByRole('link', { name: 'Cooperativa GeoJSON' }).click();
  await sp.getByRole('link', { name: 'Incorporar administrador' }).click();
  await sp.getByLabel('Correo', { exact: true }).last().fill(ADMIN.email);
  await sp.getByLabel('Rol').selectOption({ label: 'Administrador de organización' });
  await sp.getByRole('button', { name: 'Generar enlace de invitación' }).click();
  const link = await sp.getByLabel('Enlace de invitación').inputValue();

  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await page.getByLabel('Nombre').fill('Gina');
  await page.getByLabel('Apellido').fill('GeoJSON');
  await page.getByLabel('Contraseña (mínimo 12 caracteres)').fill(ADMIN.password);
  await page.getByLabel('Repite la contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Aceptar invitación' }).click();
  await page.getByRole('link', { name: 'Productores', exact: true }).click();
  await page.getByLabel('Código de productor', { exact: true }).fill('GP-001');
  await page.getByLabel('Razón social', { exact: true }).fill('Finca GeoJSON');
  await page.getByRole('button', { name: 'Registrar productor' }).click();
  await page.getByLabel('Código de parcela').fill('GJ-01');
  await page.getByRole('button', { name: 'Registrar parcela' }).click();
  await expect(page.getByRole('heading', { name: 'GJ-01' })).toBeVisible();
  plotUrl = page.url();
  token = (await page.evaluate(() => sessionStorage.getItem('tl_token')))!;
});

const ORIGINAL = fileOf({ type: 'Feature', properties: { titular: 'Ignorado', organization_id: 'ajena' }, geometry: { type: 'Polygon', coordinates: [SQUARE] } });

test('importar: analizar, revisar (hash, tipo, validez, advertencias) y confirmar una versión', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  await page.getByLabel('Archivo GeoJSON (.geojson o .json)').setInputFiles({ name: 'finca.geojson', mimeType: 'application/geo+json', buffer: ORIGINAL });
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  const review = page.getByRole('region', { name: 'Revisión de la importación' });
  await expect(review).toContainText(sha(ORIGINAL));
  await expect(review).toContainText('Feature');
  await expect(review).toContainText('Polígono');
  await expect(review).toContainText('Válida');
  await expect(review).toContainText('no indican la precisión de la medición');
  await expect(review).toContainText('Pendiente (P0-010)');
  await expect(review).toContainText(/Se ignoraron 2 propiedad/);
  await expect(review).not.toContainText('Ignorado');
  await page.getByRole('button', { name: 'Confirmar nueva versión' }).click();
  await expect(page.getByText(/Geometría importada como versión \d+/)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Versiones geométricas' })).toContainText('Importación de archivo');
  await expect(page.getByText(sha(ORIGINAL)).first()).toBeVisible();
  await ctx.close();
});

test('exportar GeoJSON de la versión y descargar el original con bytes idénticos', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  const row = page.getByRole('table', { name: 'Versiones geométricas' }).locator('tbody tr').filter({ hasText: 'Importación de archivo' });
  const [exp] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: /Exportar GeoJSON/ }).click()]);
  const feature = JSON.parse(readFileSync((await exp.path())!, 'utf8'));
  expect(feature.geometry.coordinates).toEqual([SQUARE]); // [lon, lat]
  expect(feature.properties.notice).toMatch(/No es un paquete de debida diligencia EUDR/);
  expect(JSON.stringify(feature)).not.toContain('Finca GeoJSON');
  const [orig] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: /archivo original/ }).click()]);
  const bytes = readFileSync((await orig.path())!);
  expect(Buffer.compare(bytes, ORIGINAL)).toBe(0);
  expect(sha(bytes)).toBe(sha(ORIGINAL));
  await ctx.close();
});

test('archivo fuera del perfil: mensaje comprensible y ubicación, sin crear versión', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  const input = page.getByLabel('Archivo GeoJSON (.geojson o .json)');
  await input.setInputFiles({ name: 'roto.geojson', mimeType: 'application/json', buffer: Buffer.from('{"type": "Polygon", ') });
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await expect(page.getByText('El archivo no es JSON válido.', { exact: false })).toBeVisible();
  await input.setInputFiles({ name: 'altitud.geojson', mimeType: 'application/json', buffer: fileOf({ type: 'Polygon', coordinates: [SQUARE.map(([x, y]) => [x, y, 15])] }) });
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await expect(page.getByText(/incluye altitud u otras dimensiones/)).toBeVisible();
  await expect(page.getByText('Ubicación en el archivo: raíz.coordinates[0][0]')).toBeVisible();
  await ctx.close();
});

test('autointersección: no válida sin superficie; recarga y retoma la revisión; 390 px y teclado; descartar', async ({ browser }) => {
  const { ctx, page } = await open(browser, { width: 390, height: 844 });
  await page.getByLabel('Archivo GeoJSON (.geojson o .json)').setInputFiles({ name: 'cruzado.geojson', mimeType: 'application/geo+json', buffer: fileOf({ type: 'Polygon', coordinates: [BOWTIE] }) });
  await page.getByRole('button', { name: 'Analizar archivo' }).focus();
  await page.keyboard.press('Enter');
  const review = page.getByRole('region', { name: 'Revisión de la importación' });
  await expect(review).toContainText('No válida');
  await expect(review).toContainText('No calculada');
  await expect(page.getByRole('button', { name: 'Confirmar nueva versión' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Retomar revisión' }).click();
  await expect(page.getByRole('region', { name: 'Revisión de la importación' })).toContainText('No válida');
  await page.getByRole('button', { name: 'Descartar importación' }).click();
  await expect(page.getByText('Importación descartada. No se creó ninguna versión.')).toBeVisible();
  await ctx.close();
});

test('evaluación GIS técnica: estado con alcance técnico, precisión no disponible, perfil de destino no evaluado; teclado y 390 px', async ({ browser }) => {
  const { ctx, page } = await open(browser, { width: 390, height: 844 });
  const section = page.getByRole('region', { name: 'Evaluación GIS (técnica)' });
  await section.getByRole('button', { name: /Evaluar geometría|Volver a evaluar/ }).focus();
  await page.keyboard.press('Enter');
  await expect(section).toContainText('VALID · técnicamente válida');
  await expect(section).toContainText('no es conformidad EUDR');
  await expect(section).toContainText('TL_GIS_TECH · versión 1.0.1');
  await expect(section).toContainText('Precisión de captura no disponible');
  await expect(section).toContainText('No evaluado: el perfil de destino requiere definición (D-05)');
  // Desde D-05.A el perfil se evalúa aparte: la evaluación técnica lo dice y remite a la otra sección.
  await expect(section).toContainText('se evalúa con una regla propia y versionada aparte');
  await expect(section.getByRole('table', { name: 'Comprobaciones técnicas' })).toContainText('Validez técnica');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // una versión nueva deja la evaluación anterior como historial desactualizado
  await page.getByLabel('Archivo GeoJSON (.geojson o .json)').setInputFiles({ name: 'nueva.geojson', mimeType: 'application/geo+json', buffer: fileOf({ type: 'Polygon', coordinates: [SQUARE.map(([x, y]) => [x + 0.002, y])] }) });
  await page.getByRole('button', { name: 'Analizar archivo' }).click();
  await page.getByRole('button', { name: 'Confirmar nueva versión' }).click();
  await expect(page.getByText(/Geometría importada como versión \d+/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Evaluación GIS (técnica)' })).toContainText('Evaluación desactualizada');
  await ctx.close();
});

test('D-05.A perfil de destino: dictámenes separados, fuente fechada y límites a la vista; teclado y 390 px', async ({ browser }) => {
  const { ctx, page } = await open(browser, { width: 390, height: 844 });
  // Los DOS dictámenes están en la misma pantalla, cada uno en su sección: pueden discrepar.
  const tecnica = page.getByRole('region', { name: 'Evaluación GIS (técnica)' });
  const perfil = page.getByRole('region', { name: 'Perfil técnico de destino' });
  await expect(tecnica).toBeVisible();
  await expect(perfil).toBeVisible();
  await expect(perfil).toContainText('pueden discrepar');

  await perfil.getByRole('button', { name: /Evaluar el perfil|Volver a evaluar el perfil/ }).focus();
  await page.keyboard.press('Enter');
  await expect(perfil).toContainText('Cumple el perfil técnico');
  // Cumplir el perfil NO se presenta como conformidad.
  await expect(perfil).toContainText('no es conformidad EUDR');
  // Los identificadores de la fuente, separados: servicio, documento y fecha de página.
  await expect(perfil).toContainText('EUDR_GEO_V1');
  await expect(perfil).toContainText('V3');
  await expect(perfil).toContainText('v1.2');
  await expect(perfil).toContainText('2026-08-17');
  // Y el grado de comprobación: documentado, no probado contra el servicio real.
  await expect(perfil).toContainText(/NO se ha probado contra el servicio real/);
  // Cada comprobación declara quién la exige.
  const tabla = perfil.getByRole('table', { name: 'Comprobaciones del perfil de destino' });
  await expect(tabla).toContainText('Umbral de 4 ha');
  await expect(tabla).toContainText('Truncamiento a 6 decimales');
  await expect(tabla).toContainText('Sistema de destino');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  // El contrato de decimales separa valor, formato, resolución y exactitud: seis decimales no son precisión.
  await perfil.getByRole('group').filter({ hasText: 'Qué significan los decimales' }).first().click();
  await expect(perfil).toContainText(/NO es prueba de precisión física|no son prueba de precisión/i);
  await ctx.close();
});
