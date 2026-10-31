import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'crypto';
import { SUPER_EMAIL } from '../env';

// Recorrido P0-004 en navegador: alta → búsqueda → detalle → edición → baja, con errores recuperables
// (código duplicado y edición concurrente).
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'admin-productores@e2e.local', password: randomBytes(12).toString('base64url') };
let adminPage: Page;
let producersUrl: string;

test('preparación: organización y administrador', async ({ browser }) => {
  const superPage = await (await browser.newContext()).newPage();
  await superPage.goto('/');
  await superPage.getByLabel('Correo').fill(SUPER_EMAIL);
  await superPage.getByLabel('Contraseña').fill(process.env.E2E_SUPER_PASSWORD!);
  await superPage.getByRole('button', { name: 'Iniciar sesión' }).click();
  await superPage.getByLabel('Nombre').fill('Cooperativa Productores');
  await superPage.getByLabel('Tipo de organización (catálogo provisional, no concede permisos)').selectOption({ label: 'Cooperativa' });
  await superPage.getByRole('button', { name: 'Crear organización' }).click();
  await superPage.getByRole('link', { name: 'Cooperativa Productores' }).click();
  await superPage.getByRole('link', { name: 'Incorporar administrador' }).click();
  await superPage.getByLabel('Correo', { exact: true }).last().fill(ADMIN.email);
  await superPage.getByLabel('Rol').selectOption({ label: 'Administrador de organización' });
  await superPage.getByRole('button', { name: 'Generar enlace de invitación' }).click();
  const link = await superPage.getByLabel('Enlace de invitación').inputValue();

  adminPage = await (await browser.newContext()).newPage();
  await adminPage.goto(link);
  await adminPage.getByLabel('Nombre').fill('Rosa');
  await adminPage.getByLabel('Apellido', { exact: true }).fill('Zambrano');
  await adminPage.getByLabel('Contraseña (mínimo 12 caracteres)').fill(ADMIN.password);
  await adminPage.getByLabel('Repite la contraseña').fill(ADMIN.password);
  await adminPage.getByRole('button', { name: 'Aceptar invitación' }).click();
  await expect(adminPage.getByRole('heading', { name: 'Cooperativa Productores' })).toBeVisible();
  await adminPage.getByRole('link', { name: 'Ver y registrar productores' }).click();
  await expect(adminPage.getByRole('heading', { name: 'Productores', exact: true, level: 1 })).toBeVisible();
  await expect(adminPage).toHaveURL(/\/productores$/);
  producersUrl = adminPage.url();
});

test('alta con validación y código duplicado recuperable', async () => {
  await expect(adminPage.getByText('Aún no hay productores registrados.')).toBeVisible();
  await adminPage.getByLabel('Código de productor', { exact: true }).fill('COOP-001');
  await adminPage.getByLabel('Nombre', { exact: true }).fill('Julio');
  await adminPage.getByLabel('Apellido', { exact: true }).fill('Vera');
  await adminPage.getByLabel('Comunidad', { exact: true }).fill('Río Chico');
  await adminPage.getByLabel('Tipo de documento', { exact: true }).fill('CEDULA');
  await adminPage.getByLabel('Número de documento', { exact: true }).fill('1309876543');
  await adminPage.getByRole('button', { name: 'Registrar productor' }).click();
  await expect(adminPage.getByRole('heading', { name: 'COOP-001 · Julio Vera' })).toBeVisible();

  await adminPage.goto(producersUrl);
  await adminPage.getByLabel('Código de productor', { exact: true }).fill('COOP-001');
  await adminPage.getByLabel('Razón social', { exact: true }).fill('Hacienda Duplicada');
  await adminPage.getByRole('button', { name: 'Registrar productor' }).click();
  await expect(adminPage.locator('.error[role="alert"]')).toContainText('Ya existe un productor con ese código');
  // El formulario conserva lo escrito para corregir.
  await expect(adminPage.getByLabel('Razón social', { exact: true })).toHaveValue('Hacienda Duplicada');
  await adminPage.getByLabel('Código de productor', { exact: true }).fill('COOP-002');
  await adminPage.getByRole('button', { name: 'Registrar productor' }).click();
  await expect(adminPage.getByRole('heading', { name: 'COOP-002 · Hacienda Duplicada' })).toBeVisible();
});

test('posible duplicado: aviso al registrar, revisión asistida y ningún cambio en los productores', async () => {
  await adminPage.goto(producersUrl);
  await adminPage.getByLabel('Código de productor', { exact: true }).fill('COOP-003');
  await adminPage.getByLabel('Nombre', { exact: true }).fill('Julio César');
  await adminPage.getByLabel('Apellido', { exact: true }).fill('Vera');
  await adminPage.getByLabel('Tipo de documento', { exact: true }).fill('cedula');
  await adminPage.getByLabel('Número de documento', { exact: true }).fill('130-987.6543');
  await adminPage.getByRole('button', { name: 'Registrar productor' }).click();
  await expect(adminPage.getByRole('heading', { name: 'COOP-003 · Julio César Vera' })).toBeVisible();
  await expect(adminPage.getByText('Se detectó una posible coincidencia de identidad')).toBeVisible();

  await adminPage.goto(producersUrl);
  await adminPage.getByRole('link', { name: 'Revisar posibles duplicados' }).click();
  await expect(adminPage.getByRole('heading', { name: 'Posibles duplicados' })).toBeVisible();
  const card = adminPage.getByRole('region', { name: /COOP-00[13] y COOP-00[13]/ });
  await expect(card).toContainText('Mismo tipo y número de documento');
  await expect(card).toContainText('130-987.6543'); // el administrador tiene permiso de identidad
  await card.getByLabel('Nota de la decisión (queda en la auditoría)').fill('Padre e hijo con el mismo nombre; documento mal digitado');
  await card.getByRole('button', { name: 'No es duplicado' }).click();
  await expect(adminPage.getByText('No hay casos en este estado.')).toBeVisible();

  // Los productores siguen intactos (versión 1, activos).
  await adminPage.goto(producersUrl);
  await adminPage.getByRole('table', { name: 'Productores' }).getByRole('link', { name: 'COOP-001 · Julio Vera' }).click();
  await expect(adminPage.getByText('versión 1')).toBeVisible();
});

test('búsqueda por comunidad y apertura del detalle', async () => {
  await adminPage.goto(producersUrl);
  await adminPage.getByLabel('Buscar por código, nombre o comunidad').fill('río chico');
  await adminPage.getByRole('button', { name: 'Buscar' }).click();
  const list = adminPage.getByRole('table', { name: 'Productores' });
  await expect(list.locator('tbody tr')).toHaveCount(1);
  await list.getByRole('link', { name: 'COOP-001 · Julio Vera' }).click();
  await expect(adminPage.getByRole('heading', { name: 'COOP-001 · Julio Vera' })).toBeVisible();
  await expect(adminPage.getByRole('list', { name: 'Historial' })).toContainText('v1 · Registro');
});

test('edición con conflicto concurrente entre dos pestañas', async ({ browser }) => {
  const detailUrl = adminPage.url();
  // La sesión vive en sessionStorage (por pestaña, ADR-0005): la segunda pestaña recibe el mismo token.
  const token = await adminPage.evaluate(() => sessionStorage.getItem('tl_token'));
  const other = await adminPage.context().newPage();
  await other.addInitScript((t) => sessionStorage.setItem('tl_token', t ?? ''), token);
  await other.goto(detailUrl);
  await expect(other.getByRole('heading', { name: 'COOP-001 · Julio Vera' })).toBeVisible();

  await adminPage.getByLabel('Parroquia', { exact: true }).fill('San Plácido');
  await adminPage.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(adminPage.getByText('Cambios guardados.')).toBeVisible();
  await expect(adminPage.getByRole('list', { name: 'Historial' })).toContainText('v2 · Edición');

  await other.getByLabel('Teléfono', { exact: true }).fill('+593 99 555 0000');
  await other.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(other.locator('.error[role="alert"]')).toContainText('Otra persona modificó este productor');
  await other.getByRole('button', { name: 'Recargar' }).click();
  await expect(other.getByText('versión 2')).toBeVisible();
  await other.close();
  void browser;
});

test('baja lógica: sale del listado por defecto y conserva historial', async () => {
  await adminPage.getByLabel('Motivo (queda en el historial)').fill('Vendió la finca');
  await adminPage.getByRole('button', { name: 'Dar de baja' }).click();
  await expect(adminPage.getByText('Productor de baja: Vendió la finca')).toBeVisible();
  await expect(adminPage.getByRole('button', { name: 'Guardar cambios' })).toHaveCount(0);
  await expect(adminPage.getByRole('list', { name: 'Historial' })).toContainText('Baja');
  await expect(adminPage.getByRole('list', { name: 'Historial' })).toContainText('v1 · Registro');

  await adminPage.goto(producersUrl);
  const list = adminPage.getByRole('table', { name: 'Productores' });
  await expect(list).not.toContainText('COOP-001');
  await adminPage.getByLabel('Estado').selectOption({ label: 'De baja' });
  await adminPage.getByRole('button', { name: 'Buscar' }).click();
  await expect(list).toContainText('COOP-001 · Julio Vera');
});
