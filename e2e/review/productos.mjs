// Revisión de P0-011 UI-09 Productos sobre datos DEMO: administrador de la cooperativa (administra; teclado
// y 390 px), operador de recepción del centro de acopio (solo consulta) y productor (sin permiso).
// No modifica el catálogo DEMO: abre formularios y confirmaciones sin confirmarlas.
import { join } from 'node:path';

export async function reviewProducts({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
  const acc = (local) => accounts.find((x) => x.email.startsWith(local));
  const orgOf = (part) => orgIdByName[DEMO_ORGS.find((o) => o.includes(part))];
  const loginAs = async (a, viewport = { width: 1280, height: 860 }) => {
    const ctx = await browser.newContext({ viewport, locale: 'es-EC' });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.getByLabel('Correo').fill(a.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(a.contrasena);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 15000 });
    return { ctx, page };
  };
  const casos = [];

  // Administrador de la cooperativa: listado con unidades, formulario de alta, confirmación de desactivación.
  {
    const coop = orgOf('Cooperativa');
    const { ctx, page } = await loginAs(acc('admin.cooperativa'), { width: 390, height: 844 });
    await page.goto(`${BASE}/organizaciones/${coop}/productos`);
    const table = page.getByRole('table', { name: 'Productos' });
    await table.waitFor({ timeout: 15000 });
    const rows = await table.locator('tbody tr').allInnerTexts();
    const units = rows.every((r) => r.includes('Kilogramo (kg, masa)'));
    const createForm = await page.getByRole('heading', { name: 'Registrar producto' }).count();
    const stateOptions = await page.locator('#np-state option').allInnerTexts();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: join(shots, 'productos--admin-listado-390.png'), fullPage: true });
    await table.getByRole('link', { name: 'CACAO_SECO' }).click();
    await page.getByRole('heading', { name: /CACAO_SECO/ }).waitFor();
    await page.getByLabel('Motivo').fill('Revisión visual (no se confirma)');
    await page.getByRole('button', { name: 'Desactivar', exact: true }).focus();
    await page.keyboard.press('Enter');
    const explained = await page.getByText(/Los registros históricos que lo usen se conservan sin cambios/).count();
    await page.screenshot({ path: join(shots, 'productos--admin-confirmacion.png'), fullPage: true });
    await page.getByRole('button', { name: 'Cancelar' }).click(); // no se desactiva
    casos.push({ cuenta: 'admin.cooperativa (390 px, teclado)', resultado: `${rows.length} productos; unidades explícitas=${units}; formulario de alta=${createForm}; estados desde la API=${stateOptions.length - 1}; confirmación explica efectos=${explained}; desborde=${overflow}`,
      ok: rows.length >= 4 && units && createForm === 1 && stateOptions.length === 5 && explained === 1 && !overflow });
    await ctx.close();
  }

  // Operador de recepción: consulta sin acciones de administración.
  {
    const acopio = orgOf('Acopio') ?? orgOf('acopio');
    const { ctx, page } = await loginAs(acc('recepcion.acopio'));
    const nav = await page.goto(`${BASE}/organizaciones/${acopio}/productos`).then(() => page.getByRole('table', { name: 'Productos' }).or(page.getByText('Aún no hay productos')).first().waitFor({ timeout: 15000 }));
    void nav;
    const rows = await page.getByRole('table', { name: 'Productos' }).locator('tbody tr').count();
    const createForm = await page.getByRole('heading', { name: 'Registrar producto' }).count();
    const link = await page.getByRole('link', { name: 'Productos', exact: true }).count();
    await page.screenshot({ path: join(shots, 'productos--recepcion-consulta.png'), fullPage: true });
    casos.push({ cuenta: 'recepcion.acopio (operador autorizado a consultar)', resultado: `enlace en el menú=${link}; ${rows} productos; formulario de alta=${createForm}`, ok: link >= 1 && rows >= 1 && createForm === 0 });
    await ctx.close();
  }

  // Productor: sin permiso; sin enlace y acceso directo denegado.
  {
    const coop = orgOf('Cooperativa');
    const { ctx, page } = await loginAs(acc('productor.cooperativa'));
    await page.goto(`${BASE}/organizaciones/${coop}/productos`);
    await page.getByText('Tu rol no permite consultar el catálogo de productos.').or(page.locator('.error')).first().waitFor({ timeout: 15000 });
    const denied = await page.getByText('Tu rol no permite consultar el catálogo de productos.').count();
    const link = await page.getByRole('link', { name: 'Productos', exact: true }).count();
    await page.screenshot({ path: join(shots, 'productos--productor-sin-permiso.png'), fullPage: true });
    casos.push({ cuenta: 'productor.cooperativa (sin permiso)', resultado: `enlace en el menú=${link}; acceso directo denegado=${denied}`, ok: link === 0 && denied === 1 });
    await ctx.close();
  }
  return { tipo: 'productos', casos, ok: casos.every((c) => c.ok) };
}
