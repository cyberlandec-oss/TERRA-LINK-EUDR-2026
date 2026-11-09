import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'crypto';
import { API_URL, SUPER_EMAIL } from '../env';

// P0-008 en navegador con GEOLOCALIZACIÓN SIMULADA (evidencia simulada, no captura real de campo).
// Posiciones emuladas por Playwright (setGeolocation). Borrador persistido en el servidor.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-poligono@e2e.local', password: randomBytes(12).toString('base64url') };
let token: string;
let plotUrl: string;
const SQUARE = [[-0.848, -80.16], [-0.848, -80.159], [-0.847, -80.159], [-0.847, -80.16]];

async function open(browser: Browser, viewport?: { width: number; height: number }) {
  const ctx = await browser.newContext({ geolocation: { latitude: SQUARE[0][0], longitude: SQUARE[0][1], accuracy: 10 }, permissions: ['geolocation'], ...(viewport ? { viewport } : {}) });
  await ctx.addInitScript((t) => sessionStorage.setItem('tl_token', t), token);
  const page = await ctx.newPage();
  await page.goto(plotUrl);
  await expect(page.getByRole('heading', { name: 'PG-01' })).toBeVisible();
  // A-01: los métodos de captura se eligen primero (la ficha ya no muestra todos a la vez).
  await page.getByRole('button', { name: 'Polígono por vértices' }).click();
  return { ctx, page };
}

async function addVertex(page: Page, ctx: import('@playwright/test').BrowserContext, lat: number, lon: number, accuracy?: number) {
  await ctx.setGeolocation({ latitude: lat, longitude: lon, ...(accuracy !== undefined ? { accuracy } : {}) });
  await page.getByRole('button', { name: 'Añadir vértice' }).click();
  await expect(page.getByLabel('Muestra del vértice')).toContainText(String(lat));
  await page.getByRole('button', { name: 'Guardar vértice' }).click();
  await expect(page.getByRole('button', { name: 'Añadir vértice' })).toBeVisible();
}

test('preparación: organización, administrador, productor y parcela sin geometría', async ({ browser }) => {
  const sp = await (await browser.newContext()).newPage();
  await sp.goto('/');
  await sp.getByLabel('Correo').fill(SUPER_EMAIL);
  await sp.getByLabel('Contraseña', { exact: true }).fill(process.env.E2E_SUPER_PASSWORD!);
  await sp.getByRole('button', { name: 'Iniciar sesión' }).click();
  await sp.getByLabel('Nombre').fill('Cooperativa Polígono');
  await sp.getByLabel('Tipo de organización (catálogo provisional, no concede permisos)').selectOption({ label: 'Cooperativa' });
  await sp.getByRole('button', { name: 'Crear organización' }).click();
  await sp.getByRole('link', { name: 'Cooperativa Polígono' }).click();
  await sp.getByRole('link', { name: 'Incorporar administrador' }).click();
  await sp.getByLabel('Correo', { exact: true }).last().fill(ADMIN.email);
  await sp.getByLabel('Rol').selectOption({ label: 'Administrador de organización' });
  await sp.getByRole('button', { name: 'Generar enlace de invitación' }).click();
  const link = await sp.getByLabel('Enlace de invitación').inputValue();

  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await page.getByLabel('Nombre').fill('Paula');
  await page.getByLabel('Apellido').fill('Polígono');
  await page.getByLabel('Contraseña (mínimo 12 caracteres)').fill(ADMIN.password);
  await page.getByLabel('Repite la contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Aceptar invitación' }).click();
  await page.getByRole('link', { name: 'Productores', exact: true }).click();
  await page.getByLabel('Código de productor', { exact: true }).fill('PP-001');
  await page.getByLabel('Razón social', { exact: true }).fill('Finca Polígono');
  await page.getByRole('button', { name: 'Registrar productor' }).click();
  await page.getByLabel('Código de parcela').fill('PG-01');
  await page.getByRole('button', { name: 'Registrar parcela' }).click();
  await expect(page.getByRole('heading', { name: 'PG-01' })).toBeVisible();
  plotUrl = page.url();
  token = (await page.evaluate(() => sessionStorage.getItem('tl_token')))!;
});

test('[SIMULADA] borrador: vértices, recarga, deshacer y conflicto entre pestañas', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  await page.getByRole('button', { name: 'Iniciar captura de polígono' }).click();
  await addVertex(page, ctx, SQUARE[0][0], SQUARE[0][1], 4);
  await addVertex(page, ctx, SQUARE[1][0], SQUARE[1][1], 12);
  const table = page.getByRole('table', { name: 'Vértices del borrador' });
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('table', { name: 'Vértices del borrador' }).locator('tbody tr')).toHaveCount(2);
  await expect(page.getByText('2 vértices con precisión informada; 0 sin informar; peor precisión conocida 12 m')).toBeVisible();

  // segunda pestaña modifica el borrador; la primera queda desactualizada
  const tab2 = await ctx.newPage();
  await tab2.goto(plotUrl);
  await addVertex(tab2, ctx, SQUARE[2][0], SQUARE[2][1], 8);
  await ctx.setGeolocation({ latitude: SQUARE[3][0], longitude: SQUARE[3][1], accuracy: 8 });
  await page.getByRole('button', { name: 'Añadir vértice' }).click();
  await page.getByRole('button', { name: 'Guardar vértice' }).click();
  await expect(page.getByText('El borrador cambió en otra pestaña o dispositivo.')).toBeVisible();
  await page.getByRole('button', { name: 'Recargar borrador' }).click();
  await expect(page.getByRole('table', { name: 'Vértices del borrador' }).locator('tbody tr').filter({ hasText: '-0.847' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Guardar vértice' }).click(); // la muestra se conservó
  await expect(page.getByText('4 vértices con precisión informada')).toBeVisible();
  await tab2.close();

  await page.getByRole('button', { name: 'Deshacer último' }).click();
  await expect(page.getByRole('table', { name: 'Vértices del borrador' })).toContainText('deshecho');
  await addVertex(page, ctx, SQUARE[3][0], SQUARE[3][1]);
  await ctx.close();
});

test('[SIMULADA] revisar y confirmar: cierre con el primer vértice, versión nueva sin validación GIS', async ({ browser }) => {
  const { ctx, page } = await open(browser);
  await page.getByRole('button', { name: 'Revisar y confirmar' }).click();
  const review = page.getByRole('region', { name: 'Revisión antes de confirmar' });
  await expect(review).toContainText('Estructura almacenable');
  await expect(review).toContainText('Válida');
  await expect(review).toContainText('Pendiente (P0-010)');
  await expect(page.getByText(/Cierre: vuelve al vértice 1 \(no es una muestra nueva\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar polígono' }).click();
  await expect(page.getByText(/Polígono guardado como versión \d+/)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Versiones geométricas' })).toContainText('Polígono');
  await expect(page.getByRole('button', { name: 'Iniciar captura de polígono' })).toBeVisible();
  await ctx.close();
});

test('[SIMULADA] autointersección: sin superficie, confirmación bloqueada salvo conservar para revisión; 390 px y teclado', async ({ browser }) => {
  const { ctx, page } = await open(browser, { width: 390, height: 844 });
  await page.getByRole('button', { name: 'Iniciar captura de polígono' }).click();
  for (const i of [0, 2, 1, 3]) await addVertex(page, ctx, SQUARE[i][0], SQUARE[i][1]);
  await page.getByRole('button', { name: 'Revisar y confirmar' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('La forma se cruza consigo misma o no es válida.')).toBeVisible();
  const review = page.getByRole('region', { name: 'Revisión antes de confirmar' });
  await expect(review).toContainText('No calculada');
  await expect(page.getByRole('button', { name: 'Confirmar polígono' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Seguir capturando' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Cancelar borrador' }).click();
  await expect(page.getByRole('button', { name: 'Iniciar captura de polígono' })).toBeVisible();
  await ctx.close();
});

test('[FIXTURE] precisión null en pantalla: muestras sintéticas enviadas a la API real con accuracy_m null', async ({ browser }) => {
  // No es una medición física ni sustituye la captura real: se usa porque la emulación de Chromium siempre informa precisión.
  const { ctx, page } = await open(browser);
  const [, orgId, plotId] = /\/organizaciones\/([^/?#]+)\/parcelas\/([^/?#]+)/.exec(new URL(plotUrl).pathname)!;
  const api = `${API_URL}/api/v1/organizations/${orgId}`;
  const headers = { authorization: `Bearer ${token}` };
  const start = await page.request.post(`${api}/plots/${plotId}/polygon-drafts`, { headers });
  expect(start.status()).toBe(201);
  let draft = await start.json();
  const add = async (lon: number, lat: number, acc: number | null) => {
    const r = await page.request.post(`${api}/polygon-drafts/${draft.id}/vertices`, { headers, data: {
      expected_version: draft.row_version, operation_id: randomUUID(), source: 'BROWSER_GEOLOCATION', longitude: lon, latitude: lat,
      accuracy_m: acc, captured_at: new Date(Date.now() - 30_000).toISOString() } });
    expect(r.status()).toBe(201);
    draft = (await r.json()).draft;
  };
  await add(-80.16, -0.848, null);
  await add(-80.159, -0.848, null);
  await page.reload();
  await expect(page.getByText('Precisión: Precisión no informada')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Vértices del borrador' })).toContainText('No informada por el navegador');
  await add(-80.159, -0.847, 7);
  await page.reload();
  await expect(page.getByText('1 vértice con precisión informada; 2 sin informar; peor precisión conocida 7 m (resumen incompleto)').first()).toBeVisible();
  await page.getByRole('button', { name: 'Revisar y confirmar' }).click();
  await expect(page.getByRole('region', { name: 'Revisión antes de confirmar' })).toContainText('(resumen incompleto)');
  await page.getByRole('button', { name: 'Seguir capturando' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Cancelar borrador' }).click();
  await expect(page.getByRole('button', { name: 'Iniciar captura de polígono' })).toBeVisible();
  await ctx.close();
});
