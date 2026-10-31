// Revisión de P0-016 sobre el recorrido DEMO (Cooperativa): administrador (Lot Hub de la salida de fermentación),
// gerente (coordinador.multi, MANAGER: crea lotes, no prepara procesos; 390 px y teclado), operador de calidad
// (consulta; secado iniciado con cierre bloqueado), auditor (solo lectura). No modifica datos DEMO.
import { join } from 'node:path';

export async function reviewLots({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
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
  const lots = async (page) => {
    await page.goto(`${BASE}/organizaciones/${coop}/lotes`);
    await page.getByRole('table', { name: 'Lotes' }).or(page.getByText('Aún no hay lotes.')).first().waitFor({ timeout: 15000 });
  };
  const casos = [];
  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa'));
    await lots(page);
    await page.getByRole('row', { name: /salida de proceso/ }).getByRole('link').first().click();
    await page.getByRole('heading', { name: /Lote LOT-/ }).waitFor({ timeout: 15000 });
    const text = await page.locator('main').innerText();
    await page.screenshot({ path: join(shots, 'lotes--admin-hub.png'), fullPage: true });
    const ok = text.includes('Cacao fermentado') && text.includes('Origen declarado en todos los insumos') && text.includes('Calidad pendiente de evaluación') && /Reservar no reduce la existencia/.test(text) && text.includes('ENT-2026-00001') && text.includes('DEMO-PAR-001');
    casos.push({ cuenta: 'admin.cooperativa', resultado: `salida de fermentación con origen hasta entrega y parcela, calidad pendiente conservada, existencia, reserva y disponible del ledger separados de calidad y origen=${ok}`, ok });
    await page.getByRole('link', { name: /PRC-/ }).first().click();
    await page.getByRole('heading', { name: /Fermentación PRC-/ }).waitFor({ timeout: 15000 });
    const run = await page.locator('main').innerText();
    await page.screenshot({ path: join(shots, 'lotes--admin-fermentacion.png'), fullPage: true });
    casos.push({ cuenta: 'admin.cooperativa (proceso cerrado)', resultado: `balance 150 = 140 + 10 y rendimiento en masa visibles=${/rendimiento en masa 93\.33 %/.test(run)}; sin acciones de edición=${!run.includes('Cerrar proceso')}`, ok: /rendimiento en masa 93\.33 %/.test(run) && !run.includes('Cerrar proceso') });
    await ctx.close();
  }
  {
    const m = acc('coordinador.multi');
    if (m) {
      const { ctx, page } = await loginAs(m, { width: 390, height: 844 });
      await lots(page);
      const createForm = await page.getByRole('heading', { name: 'Formar lote con recepciones' }).count();
      await page.goto(`${BASE}/organizaciones/${coop}/procesos`);
      await page.getByRole('heading', { name: 'Procesos', level: 1 }).waitFor({ timeout: 15000 });
      const prepare = await page.getByRole('heading', { name: 'Preparar proceso' }).count();
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => document.activeElement && document.activeElement !== document.body);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      await page.screenshot({ path: join(shots, 'lotes--gerente-390.png'), fullPage: true });
      casos.push({ cuenta: 'coordinador.multi (MANAGER, 390 px, teclado)', resultado: `puede formar lotes=${createForm === 1}; puede preparar procesos=${prepare === 1}; foco con Tab=${focus}; desborde=${overflow}`, ok: createForm === 1 && prepare === 0 && focus && !overflow });
      await ctx.close();
    }
  }
  {
    const q = acc('calidad.acopio');
    if (q) {
      const { ctx, page } = await loginAs(q);
      await page.goto(`${BASE}/organizaciones/${coop}/procesos`);
      await page.getByRole('table', { name: 'Procesos' }).waitFor({ timeout: 15000 });
      await page.getByRole('row', { name: /Secado/ }).getByRole('link').first().click();
      await page.getByRole('heading', { name: /Secado PRC-/ }).waitFor({ timeout: 15000 });
      const text = await page.locator('main').innerText();
      const closeBtn = await page.getByRole('button', { name: 'Cerrar proceso' }).count();
      await page.screenshot({ path: join(shots, 'lotes--calidad-secado.png'), fullPage: true });
      casos.push({ cuenta: 'calidad.acopio (operador de calidad)', resultado: `secado en curso con cierre bloqueado explicado=${/bloqueado hasta definir la unidad de humedad/.test(text)}; puede cerrar=${closeBtn}`, ok: /bloqueado hasta definir la unidad de humedad/.test(text) && closeBtn === 0 });
      await ctx.close();
    }
  }
  {
    const a = acc('auditor.cooperativa');
    if (a) {
      const { ctx, page } = await loginAs(a);
      await lots(page);
      const forms = await page.getByRole('heading', { name: 'Formar lote con recepciones' }).count();
      casos.push({ cuenta: 'auditor.cooperativa', resultado: `consulta de lotes sin formularios (${forms})`, ok: forms === 0 });
      await ctx.close();
    }
  }
  return { tipo: 'lotes', casos, ok: casos.every((c) => c.ok) };
}
