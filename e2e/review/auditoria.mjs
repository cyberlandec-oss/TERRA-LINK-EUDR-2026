// Revisión de P0-025 sobre el recorrido DEMO: administrador (consulta + exportación), auditor (sin correos de
// actores; campos redactados), técnico (sin audit:read → acceso denegado, no «sin datos») a 390 px con teclado.
// No registra decisiones ni modifica datos DEMO (la exportación queda auditada, como en uso real).
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

export async function reviewAudit({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
  const acc = (local) => accounts.find((x) => x.email.startsWith(local));
  const coop = orgIdByName[DEMO_ORGS.find((o) => o.includes('Cooperativa'))];
  const loginAs = async (a, viewport = { width: 1280, height: 860 }) => {
    const ctx = await browser.newContext({ viewport, locale: 'es-EC', acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.getByLabel('Correo').fill(a.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(a.contrasena);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 15000 });
    return { ctx, page };
  };
  const table = (page) => page.getByRole('table', { name: 'Registros de auditoría' });
  const casos = [];
  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa'));
    await page.goto(`${BASE}/organizaciones/${coop}/auditoria`);
    await table(page).waitFor({ timeout: 15000 });
    const summary = await page.getByText(/Mostrando \d+ de \d+/).innerText();
    await page.screenshot({ path: join(shots, 'auditoria--admin.png'), fullPage: true });
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    const file = await dl;
    const text = readFileSync(await file.path(), 'utf8');
    const hashShown = /^[0-9a-f]{64}$/.test((await page.locator('code.hash').last().innerText()).trim());
    const noSecrets = !/contrasena|password|tl_token|BEGIN|-----/.test(text) && !/CREDENCIALES/.test(text);
    casos.push({ cuenta: 'admin.cooperativa', resultado: `${summary}; exportación con metadatos=${text.includes('# formato,TL_AUDIT_CSV 0.1')}; hash visible=${hashShown}; sin secretos=${noSecrets}`,
      ok: text.includes('# formato,TL_AUDIT_CSV 0.1') && hashShown && noSecrets });
    await ctx.close();
  }
  {
    const auditor = acc('auditor.cooperativa');
    if (auditor) {
      const { ctx, page } = await loginAs(auditor);
      await page.goto(`${BASE}/organizaciones/${coop}/auditoria`);
      await table(page).waitFor({ timeout: 15000 });
      const text = await page.locator('main').innerText();
      const noEmails = !/@[a-z0-9.-]+\.[a-z]{2,}/i.test(await table(page).innerText());
      await page.getByLabel('Operación').selectOption({ index: 1 });
      await page.getByRole('button', { name: 'Aplicar filtros' }).click();
      await table(page).getByRole('link').first().click();
      await page.getByRole('heading', { name: 'Qué cambió' }).waitFor({ timeout: 15000 });
      const editable = await page.getByRole('button', { name: /Editar|Borrar|Eliminar/ }).count();
      await page.screenshot({ path: join(shots, 'auditoria--auditor-detalle.png'), fullPage: true });
      casos.push({ cuenta: 'auditor.cooperativa', resultado: `consulta sin correos de actores=${noEmails}; puede exportar=${text.includes('Exportar CSV')}; detalle sin edición (${editable})`,
        ok: noEmails && editable === 0 });
      await ctx.close();
    }
  }
  {
    const { ctx, page } = await loginAs(acc('tecnico1.cooperativa'), { width: 390, height: 844 });
    await page.goto(`${BASE}/organizaciones/${coop}/auditoria`);
    await page.waitForLoadState('networkidle');
    const text = await page.locator('main').innerText();
    const denied = /no permite consultar la auditoría|No tienes permiso/.test(text);
    const menu = await page.getByRole('link', { name: 'Auditoría' }).count();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.keyboard.press('Tab');
    const focusVisible = await page.evaluate(() => document.activeElement && document.activeElement !== document.body);
    await page.screenshot({ path: join(shots, 'auditoria--tecnico1-390.png'), fullPage: true });
    casos.push({ cuenta: 'tecnico1.cooperativa (390 px, teclado)', resultado: `acceso denegado explícito=${denied}; sin enlace en menú=${menu === 0}; desborde=${overflow}; foco con Tab=${focusVisible}`,
      ok: denied && menu === 0 && !overflow && focusVisible });
    await ctx.close();
  }
  return { tipo: 'auditoria', casos, ok: casos.every((c) => c.ok) };
}
