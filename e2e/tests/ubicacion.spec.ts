import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes } from 'crypto';
import { SUPER_EMAIL } from '../env';

// P0-007 en navegador con GEOLOCALIZACIÓN SIMULADA (evidencia simulada, no captura real):
// - posición emulada por Playwright (setGeolocation) para el recorrido feliz;
// - navigator.geolocation sustituido por un doble para permiso denegado, no disponible, timeout,
//   navegador sin soporte y precisión no informada.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-ubicacion@e2e.local', password: randomBytes(12).toString('base64url') };
let token: string;
let plotUrl: string;

async function stubbedPage(ctx: BrowserContext, script: string): Promise<Page> {
  await ctx.addInitScript((t) => sessionStorage.setItem('tl_token', t), token);
  await ctx.addInitScript(script);
  const page = await ctx.newPage();
  await page.goto(plotUrl);
  await expect(page.getByRole('heading', { name: /UB-01/ })).toBeVisible();
  return page;
}

test('preparación: organización, administrador, productor y parcela sin geometría', async ({ browser }) => {
  const sp = await (await browser.newContext()).newPage();
  await sp.goto('/');
  await sp.getByLabel('Correo').fill(SUPER_EMAIL);
  await sp.getByLabel('Contraseña', { exact: true }).fill(process.env.E2E_SUPER_PASSWORD!);
  await sp.getByRole('button', { name: 'Iniciar sesión' }).click();
  await sp.getByLabel('Nombre').fill('Cooperativa Ubicación');
  await sp.getByLabel('Tipo de organización (catálogo provisional, no concede permisos)').selectOption({ label: 'Cooperativa' });
  await sp.getByRole('button', { name: 'Crear organización' }).click();
  await sp.getByRole('link', { name: 'Cooperativa Ubicación' }).click();
  await sp.getByRole('link', { name: 'Incorporar administrador' }).click();
  await sp.getByLabel('Correo', { exact: true }).last().fill(ADMIN.email);
  await sp.getByLabel('Rol').selectOption({ label: 'Administrador de organización' });
  await sp.getByRole('button', { name: 'Generar enlace de invitación' }).click();
  const link = await sp.getByLabel('Enlace de invitación').inputValue();

  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await page.getByLabel('Nombre').fill('Ulises');
  await page.getByLabel('Apellido').fill('Ubicación');
  await page.getByLabel('Contraseña (mínimo 12 caracteres)').fill(ADMIN.password);
  await page.getByLabel('Repite la contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Aceptar invitación' }).click();
  await page.getByRole('link', { name: 'Productores', exact: true }).click();
  await page.getByLabel('Código de productor', { exact: true }).fill('UP-001');
  await page.getByLabel('Razón social', { exact: true }).fill('Finca Ubicación');
  await page.getByRole('button', { name: 'Registrar productor' }).click();
  await page.getByLabel('Código de parcela').fill('UB-01');
  await page.getByRole('button', { name: 'Registrar parcela' }).click();
  await expect(page.getByRole('heading', { name: 'UB-01' })).toBeVisible();
  plotUrl = page.url();
  token = (await page.evaluate(() => sessionStorage.getItem('tl_token')))!;
});

test('[SIMULADA] captura con posición emulada: revisar antes de guardar, guardar y ver el resultado del servidor', async ({ browser }) => {
  const ctx = await browser.newContext({ geolocation: { latitude: -0.8479876, longitude: -80.1601234, accuracy: 15 }, permissions: ['geolocation'] });
  await ctx.addInitScript((t) => sessionStorage.setItem('tl_token', t), token);
  const page = await ctx.newPage();
  await page.goto(plotUrl);
  await page.getByRole('button', { name: 'Capturar ubicación' }).click();
  const review = page.getByLabel('Muestra de ubicación');
  await expect(review).toContainText('-0.8479876');
  await expect(review).toContainText('-80.1601234');
  await expect(review).toContainText('± 15 m (informada)');
  await expect(review).toContainText('no acredita un GPS');
  // No se guardó nada todavía.
  await expect(page.getByText('Geometría pendiente.')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
  await expect(page.getByText('Ubicación guardada como versión 1.')).toBeVisible();
  await expect(page.getByText('Recibida por el servidor el')).toBeVisible();
  const coords = page.getByRole('table', { name: 'Coordenadas (WGS84)' });
  await expect(coords).toContainText('-0.8479876');
  await expect(coords).toContainText('-80.1601234');
  await expect(page.getByText('No aplica: un punto no tiene superficie')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Versiones geométricas' })).toContainText('Ubicación del navegador');
  await ctx.close();
});

const failWith = (code: number) => `
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition: (_ok, err) => setTimeout(() => err({ code: ${code}, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'simulado' }), 50),
  } });`;

for (const [code, text] of [[1, 'no tiene permiso para usar tu ubicación'], [2, 'No se pudo determinar la ubicación'], [3, 'tardó demasiado']] as const) {
  test(`[SIMULADA] error ${code}: mensaje específico, recuperación y sin guardar`, async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await stubbedPage(ctx, failWith(code));
    await page.getByRole('button', { name: 'Capturar ubicación' }).click();
    await expect(page.locator('.error[role="alert"]')).toContainText(text);
    await expect(page.getByRole('button', { name: 'Intentar de nuevo' })).toBeVisible();
    await expect(page.getByLabel('Muestra de ubicación')).toHaveCount(0);
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Capturar ubicación' })).toBeVisible();
    await ctx.close();
  });
}

test('[SIMULADA] navegador sin geolocalización: botón deshabilitado con explicación', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await stubbedPage(ctx, `Object.defineProperty(Navigator.prototype, 'geolocation', { configurable: true, get: () => undefined }); delete Navigator.prototype.geolocation;`);
  await expect(page.getByRole('button', { name: 'Capturar ubicación' })).toBeDisabled();
  await expect(page.getByText('no permiten obtener la ubicación')).toBeVisible();
  await ctx.close();
});

test('[SIMULADA] precisión no informada se muestra como tal y se guarda como null; cancelar descarta', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await stubbedPage(ctx, `
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: -0.85, longitude: -80.17, accuracy: NaN }, timestamp: Date.now() - 60000 }), 50),
    } });`);
  await page.getByRole('button', { name: 'Capturar ubicación' }).click();
  await expect(page.getByLabel('Muestra de ubicación')).toContainText('No informada por el navegador');
  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(page.getByLabel('Muestra de ubicación')).toHaveCount(0);
  await page.getByRole('button', { name: 'Capturar ubicación' }).click();
  await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
  await expect(page.getByText('Ubicación guardada como versión 2.')).toBeVisible();
  await expect(page.getByText('Precisión horizontal').locator('xpath=following-sibling::dd[1]')).toContainText('No informada');
  await ctx.close();
});

test('[SIMULADA] conflicto de versión: la muestra se conserva, se recarga y se guarda', async ({ browser }) => {
  const ctx = await browser.newContext({ geolocation: { latitude: -0.86, longitude: -80.18, accuracy: 8 }, permissions: ['geolocation'] });
  await ctx.addInitScript((t) => sessionStorage.setItem('tl_token', t), token);
  const page = await ctx.newPage();
  await page.goto(plotUrl);
  await page.getByRole('button', { name: 'Capturar ubicación' }).click();
  await expect(page.getByLabel('Muestra de ubicación')).toContainText('-80.18');
  // Otra pestaña edita la parcela mientras tanto.
  const other = await ctx.newPage();
  await other.goto(plotUrl);
  await other.getByLabel('Nombre (opcional)').fill('Editada en otra pestaña');
  await other.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(other.getByText('Cambios guardados.')).toBeVisible();
  await other.close();
  await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
  await expect(page.locator('.error[role="alert"]')).toContainText('La parcela cambió mientras capturabas');
  await expect(page.getByLabel('Muestra de ubicación')).toContainText('-80.18');
  await page.getByRole('button', { name: 'Recargar parcela' }).click();
  await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
  await expect(page.getByText('Ubicación guardada como versión 3.')).toBeVisible();
  await ctx.close();
});
