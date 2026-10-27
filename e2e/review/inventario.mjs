// Revisión de P0-017 sobre el recorrido DEMO (Cooperativa; ledger incorporado desde recepciones, lotes y procesos):
// administrador (saldos, conciliación), gerente coordinador.multi (lectura sin formularios, 390 px y teclado),
// operador de recepción (lectura) y auditor (lectura). No registra movimientos sobre los datos DEMO.
import { join } from 'node:path';

export async function reviewInventory({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
  const acc = (local) => accounts.find((x) => x.email.startsWith(local));
  const coop = orgIdByName[DEMO_ORGS.find((o) => o.includes('Cooperativa'))];
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
  const open = async (page) => {
    await page.goto(`${BASE}/organizaciones/${coop}/inventario`);
    await page.getByRole('heading', { name: 'Totales' }).waitFor({ timeout: 15000 });
  };
  const casos = [];
  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa'));
    await open(page);
    const table = page.getByRole('table', { name: 'Existencias por lote y centro' });
    const rows = await table.locator('tbody tr').allInnerTexts();
    const fermented = rows.find((r) => r.includes('Cacao fermentado')) ?? '';
    const incomplete = rows.find((r) => r.includes('Origen incompleto')) ?? '';
    const withoutLot = await page.getByRole('list', { name: 'Material recibido sin lote' }).innerText().catch(() => '');
    await page.getByRole('button', { name: 'Comprobar conciliación' }).click();
    await page.getByText(/Conciliado:|Diferencias/).first().waitFor({ timeout: 15000 });
    const reconciled = await page.getByText(/Conciliado:/).count();
    await page.screenshot({ path: join(shots, 'inventario--admin.png'), fullPage: true });
    const ok = /140 kg[\s\S]*140 kg[\s\S]*0 kg/.test(fermented) && incomplete.includes('120 kg') && withoutLot.includes('ENT-2026-00001') && reconciled === 1;
    casos.push({ cuenta: 'admin.cooperativa', resultado: `fermentado: existencia 140, reservado 140 (secado), disponible 0; lote «Origen incompleto» 120 disponible; material sin lote de ENT-2026-00001; conciliación sin diferencias=${ok}`, ok });
    await ctx.close();
  }
  {
    const m = acc('coordinador.multi');
    if (m) {
      const { ctx, page } = await loginAs(m, { width: 390, height: 844 });
      await open(page);
      const forms = await page.getByRole('heading', { name: 'Registrar movimiento' }).count();
      await page.getByLabel('Tipo').focus();
      await page.keyboard.press('Tab');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      await page.screenshot({ path: join(shots, 'inventario--gerente-390.png'), fullPage: true });
      casos.push({ cuenta: 'coordinador.multi (MANAGER, 390 px, teclado)', resultado: `lectura de existencias; formularios de movimiento=${forms}; desborde=${overflow}`, ok: forms === 0 && !overflow });
      await ctx.close();
    }
  }
  for (const local of ['recepcion.acopio', 'auditor.cooperativa']) {
    const a = acc(local);
    if (!a) continue;
    const { ctx, page } = await loginAs(a);
    await open(page);
    const forms = await page.getByRole('heading', { name: 'Registrar movimiento' }).count();
    const reconcile = await page.getByRole('button', { name: 'Comprobar conciliación' }).count();
    casos.push({ cuenta: local, resultado: `consulta sin formularios (${forms}) ni conciliación (${reconcile})`, ok: forms === 0 && reconcile === 0 });
    await ctx.close();
  }
  return { tipo: 'inventario', casos, ok: casos.every((c) => c.ok) };
}
