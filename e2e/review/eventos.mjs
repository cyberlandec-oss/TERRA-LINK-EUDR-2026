// Revisión de P0-015 sobre datos DEMO: historial de eventos en fichas, acciones según permiso y contrato,
// y página de entregas DEAD. No modifica datos DEMO (no registra correcciones ni reprocesos).
import { join } from 'node:path';

export async function reviewEvents({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
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
  const producerUrl = async (page, code) => {
    await page.goto(`${BASE}/organizaciones/${coop}/productores`);
    await page.getByRole('link', { name: new RegExp(code) }).first().click();
    await page.getByRole('region', { name: 'Historial de eventos' }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    return page.url();
  };
  const casos = [];
  let assignedUrl = null;

  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa'), { width: 390, height: 844 });
    await producerUrl(page, 'DEMO-RV-001');
    const region = page.getByRole('region', { name: 'Historial de eventos' });
    const items = await region.getByRole('listitem').count();
    const text = await region.innerText();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: join(shots, 'eventos--admin-productor-390.png'), fullPage: true });
    await page.goto(`${BASE}/organizaciones/${coop}/entregas-eventos`);
    await page.getByRole('heading', { name: 'Entregas de eventos fallidas' }).waitFor({ timeout: 15000 });
    const deadText = await page.locator('main').innerText();
    await page.screenshot({ path: join(shots, 'eventos--admin-entregas-dead.png'), fullPage: true });
    casos.push({ cuenta: 'admin.cooperativa (390 px)', resultado: `${items} eventos en la ficha; muestra «Productor registrado»=${text.includes('Productor registrado')}; sin correo ni documento=${!/@|09\d{8}/.test(text)}; página DEAD accesible=${deadText.includes('al menos una vez')}; desborde=${overflow}`,
      ok: items >= 1 && text.includes('Productor registrado') && !/@|09\d{8}/.test(text) && deadText.includes('al menos una vez') && !overflow });
    await ctx.close();
  }
  {
    const { ctx, page } = await loginAs(acc('tecnico1.cooperativa'));
    assignedUrl = await producerUrl(page, 'DEMO-RV-002');
    const region = page.getByRole('region', { name: 'Historial de eventos' });
    const items = await region.getByRole('listitem').count();
    const deadLink = await page.getByRole('link', { name: 'Entregas de eventos' }).count();
    await page.screenshot({ path: join(shots, 'eventos--tecnico1-asignado.png'), fullPage: true });
    casos.push({ cuenta: 'tecnico1.cooperativa (operativo asignado)', resultado: `${items} eventos en su productor asignado; enlace a entregas DEAD=${deadLink}`, ok: items >= 1 && deadLink === 0 });
    await ctx.close();
  }
  {
    const { ctx, page } = await loginAs(acc('tecnico2.cooperativa'));
    await page.goto(assignedUrl);
    await page.locator('.error[role="alert"]').or(page.getByRole('region', { name: 'Historial de eventos' })).first().waitFor({ timeout: 15000 });
    const history = await page.getByRole('region', { name: 'Historial de eventos' }).count();
    await page.screenshot({ path: join(shots, 'eventos--tecnico2-sin-asignacion.png'), fullPage: true });
    casos.push({ cuenta: 'tecnico2.cooperativa (sin asignación)', resultado: `historial de un productor ajeno visible=${history}`, ok: history === 0 });
    await ctx.close();
  }
  {
    const auditor = acc('auditor.cooperativa');
    if (auditor) {
      const { ctx, page } = await loginAs(auditor);
      await page.goto(assignedUrl);
      const region = page.getByRole('region', { name: 'Historial de eventos' });
      await region.waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      const items = await region.getByRole('listitem').count();
      const correct = await region.getByRole('button', { name: /Corregir/ }).count();
      await page.goto(`${BASE}/organizaciones/${coop}/entregas-eventos`);
      await page.getByText('Tu rol no permite reprocesar entregas de eventos.').waitFor({ timeout: 15000 });
      await page.screenshot({ path: join(shots, 'eventos--auditor.png'), fullPage: true });
      casos.push({ cuenta: 'auditor.cooperativa', resultado: `${items} eventos visibles; botones de corrección=${correct}; entregas DEAD denegadas`, ok: items >= 1 && correct === 0 });
      await ctx.close();
    }
  }
  return { tipo: 'eventos', casos, ok: casos.every((c) => c.ok) };
}
