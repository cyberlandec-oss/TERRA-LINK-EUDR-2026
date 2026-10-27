// Revisión de P0-020 sobre el recorrido DEMO (Cooperativa): administrador (lote con origen incompleto bloqueado; lote con
// origen declarado incompleto por reglas no evaluables), auditor (390 px, teclado; lectura sin evaluar ni revisar) y
// gerente (sin acceso a riesgo). No registra evaluaciones ni revisiones nuevas sobre los datos DEMO.
import { join } from 'node:path';

export async function reviewRisk({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
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
  const openLot = async (page, code) => {
    await page.goto(`${BASE}/organizaciones/${coop}/riesgo`);
    await page.getByRole('table', { name: 'Riesgo por lote' }).waitFor({ timeout: 15000 });
    await page.getByRole('row', { name: new RegExp(code) }).getByRole('link').first().click();
    await page.getByRole('heading', { name: /Riesgo del lote/ }).waitFor({ timeout: 15000 });
    await page.getByText(/Evaluación \d|Sin evaluaciones/).first().waitFor({ timeout: 15000 });
    return page.locator('main').innerText();
  };
  const casos = [];
  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa'));
    const blocked = await openLot(page, 'LOT-2026-00002');
    await page.screenshot({ path: join(shots, 'riesgo--admin-bloqueado.png'), fullPage: true });
    const known = await openLot(page, 'LOT-2026-00001');
    const ok = blocked.includes('Bloqueado por un hallazgo') && blocked.includes('MATERIAL_OF_UNKNOWN_ORIGIN') && blocked.includes('Indeterminada')
      && known.includes('Incompleto') && known.includes('GEOLOCATION_PROFILE') && !/score/i.test(known);
    casos.push({ cuenta: 'admin.cooperativa', resultado: `lote «Origen incompleto» bloqueado sin dilución; lote con origen declarado incompleto (reglas no evaluables visibles); conclusión indeterminada; sin puntuación=${ok}`, ok });
    await ctx.close();
  }
  {
    const a = acc('auditor.cooperativa');
    if (a) {
      const { ctx, page } = await loginAs(a, { width: 390, height: 844 });
      await openLot(page, 'LOT-2026-00002');
      const evaluate = await page.getByRole('button', { name: /Evaluar|Reevaluar/ }).count();
      const review = await page.getByRole('button', { name: /revisión/ }).count();
      await page.keyboard.press('Tab');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      await page.screenshot({ path: join(shots, 'riesgo--auditor-390.png'), fullPage: true });
      casos.push({ cuenta: 'auditor.cooperativa (390 px, teclado)', resultado: `lectura; puede evaluar=${evaluate}; puede revisar=${review}; desborde=${overflow}`, ok: evaluate === 0 && review === 0 && !overflow });
      await ctx.close();
    }
  }
  {
    const m = acc('coordinador.multi');
    if (m) {
      const { ctx, page } = await loginAs(m);
      await page.goto(`${BASE}/organizaciones/${coop}`);
      await page.waitForLoadState('networkidle');
      const link = await page.getByRole('link', { name: 'Riesgo' }).count();
      await page.goto(`${BASE}/organizaciones/${coop}/riesgo`);
      await page.waitForLoadState('networkidle');
      const denied = /no permite consultar evaluaciones de riesgo/.test(await page.locator('main').innerText());
      casos.push({ cuenta: 'coordinador.multi (MANAGER)', resultado: `sin enlace=${link === 0}; acceso directo denegado=${denied}`, ok: link === 0 && denied });
      await ctx.close();
    }
  }
  return { tipo: 'riesgo', casos, ok: casos.every((c) => c.ok) };
}
