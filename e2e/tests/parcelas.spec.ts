import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'crypto';
import { SUPER_EMAIL } from '../env';

// Recorrido P0-006 en navegador: alta contextual desde el productor → ficha → edición con conflicto
// (borrador conservado) → superficie declarada como versión nueva → volver al productor → listado.
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-parcelas@e2e.local', password: randomBytes(12).toString('base64url') };
let page: Page;
let orgUrl: string;
let plotUrl: string;

test('preparación: organización, administrador y productor', async ({ browser }) => {
  const sp = await (await browser.newContext()).newPage();
  await sp.goto('/');
  await sp.getByLabel('Correo').fill(SUPER_EMAIL);
  await sp.getByLabel('Contraseña', { exact: true }).fill(process.env.E2E_SUPER_PASSWORD!);
  await sp.getByRole('button', { name: 'Iniciar sesión' }).click();
  await sp.getByLabel('Nombre').fill('Cooperativa Parcelas');
  await sp.getByLabel('Tipo de organización (catálogo provisional, no concede permisos)').selectOption({ label: 'Cooperativa' });
  await sp.getByRole('button', { name: 'Crear organización' }).click();
  await sp.getByRole('link', { name: 'Cooperativa Parcelas' }).click();
  await sp.getByRole('link', { name: 'Incorporar administrador' }).click();
  await sp.getByLabel('Correo', { exact: true }).last().fill(ADMIN.email);
  await sp.getByLabel('Rol').selectOption({ label: 'Administrador de organización' });
  await sp.getByRole('button', { name: 'Generar enlace de invitación' }).click();
  const link = await sp.getByLabel('Enlace de invitación').inputValue();

  page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await page.getByLabel('Nombre').fill('Inés');
  await page.getByLabel('Apellido').fill('Parcelas');
  await page.getByLabel('Contraseña (mínimo 12 caracteres)').fill(ADMIN.password);
  await page.getByLabel('Repite la contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Aceptar invitación' }).click();
  await expect(page.getByRole('heading', { name: 'Cooperativa Parcelas' })).toBeVisible();
  orgUrl = page.url();
  await page.getByRole('link', { name: 'Productores', exact: true }).click();
  await page.getByLabel('Código de productor', { exact: true }).fill('PP-001');
  await page.getByLabel('Razón social', { exact: true }).fill('Finca La Esperanza');
  await page.getByRole('button', { name: 'Registrar productor' }).click();
  await expect(page.getByRole('heading', { name: 'PP-001 · Finca La Esperanza' })).toBeVisible();
});

test('alta contextual desde el productor, con código repetido recuperable', async () => {
  await expect(page.getByText('Este productor aún no tiene parcelas.')).toBeVisible();
  await page.getByLabel('Código de parcela').fill('PAR-01');
  await page.getByLabel('Nombre (opcional)').fill('Lote norte');
  await page.getByRole('button', { name: 'Registrar parcela' }).click();
  await expect(page.getByRole('heading', { name: 'PAR-01 · Lote norte' })).toBeVisible();
  plotUrl = page.url();
  await expect(page.getByText('Geometría pendiente').first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Ruta de navegación' })).toContainText('PP-001');
  // Ningún botón presenta la captura como GPS (A-01 añade métodos de captura rotulados con su procedencia, p. ej. «Importar GeoJSON»).
  await expect(page.getByRole('button', { name: /GPS/ })).toHaveCount(0);

  await page.getByRole('link', { name: 'PP-001 · Finca La Esperanza' }).click();
  await expect(page.getByRole('heading', { name: 'PP-001 · Finca La Esperanza' })).toBeVisible();
  await page.getByLabel('Código de parcela').fill('PAR-01');
  await page.getByRole('button', { name: 'Registrar parcela' }).click();
  await expect(page.locator('.error[role="alert"]')).toContainText('Ya existe una parcela con ese código');
  await expect(page.getByLabel('Código de parcela')).toHaveValue('PAR-01');
  await expect(page.getByRole('list', { name: 'Parcelas del productor' })).toContainText('PAR-01 · Lote norte');
});

test('edición con conflicto entre pestañas: el borrador se conserva y se guarda tras recargar', async () => {
  await page.goto(plotUrl);
  const token = await page.evaluate(() => sessionStorage.getItem('tl_token'));
  const other = await page.context().newPage();
  await other.addInitScript((t) => sessionStorage.setItem('tl_token', t ?? ''), token);
  await other.goto(plotUrl);
  await expect(other.getByRole('heading', { name: 'PAR-01 · Lote norte' })).toBeVisible();

  await page.getByLabel('Variedad (opcional)').fill('Nacional');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Cambios guardados.')).toBeVisible();

  await other.getByLabel('Parroquia (opcional)').fill('Calceta');
  await other.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(other.locator('.error[role="alert"]')).toContainText('Otra persona modificó esta parcela');
  await expect(other.getByLabel('Parroquia (opcional)')).toHaveValue('Calceta');
  await other.getByRole('button', { name: 'Recargar versión actual' }).click();
  await expect(other.getByLabel('Parroquia (opcional)')).toHaveValue('Calceta');
  await other.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(other.getByText('Cambios guardados.')).toBeVisible();
  await other.close();
});

test('superficie declarada crea una versión nueva sin geometría; listado con filtros', async () => {
  await page.goto(plotUrl);
  await page.getByLabel('Superficie declarada (ha)').fill('2,5');
  await page.getByRole('button', { name: 'Registrar superficie' }).click();
  await expect(page.getByText('Solo superficie declarada').first()).toBeVisible();
  const versions = page.getByRole('table', { name: 'Versiones geométricas' });
  await expect(versions).toContainText('v1');
  await expect(versions).toContainText('2,5 ha');
  await expect(page.getByText('No validada')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Historial de la parcela' })).toContainText('Nueva versión geométrica');

  await page.goto(`${orgUrl}/parcelas`);
  const table = page.getByRole('table', { name: 'Parcelas' });
  await expect(table).toContainText('PAR-01 · Lote norte');
  await page.getByLabel('Situación geométrica').selectOption({ label: 'Con ubicación registrada' });
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('No encontramos resultados con estos filtros.')).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(table).toContainText('PAR-01 · Lote norte');
});
