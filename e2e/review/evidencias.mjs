// Revisión de P0-019 sobre el recorrido DEMO (documento y afirmación SINTÉTICOS de DEMO-RV-002, enviada a
// revisión): administrador (puede verificar), técnico capturador asignado (390 px, teclado) y auditor.
// No registra decisiones sobre los datos DEMO.
import { join } from 'node:path';

export async function reviewEvidence({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
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
  const openClaim = async (page) => {
    await page.goto(`${BASE}/organizaciones/${coop}/evidencias`);
    await page.getByRole('table', { name: 'Afirmaciones' }).waitFor({ timeout: 15000 });
    await page.getByRole('link', { name: 'Existe documentación de tenencia' }).first().click();
    await page.getByRole('list', { name: 'Soportes de la afirmación' }).waitFor({ timeout: 15000 });
    return page.locator('main').innerText();
  };
  const casos = [];
  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa'));
    const text = await openClaim(page);
    const verify = await page.getByRole('button', { name: 'Verificar afirmación' }).count();
    await page.screenshot({ path: join(shots, 'evidencias--admin-afirmacion.png'), fullPage: true });
    const distinct = text.includes('En revisión') && text.includes('Archivo disponible (análisis limpio)') && text.includes('revisión documental: sin revisar');
    casos.push({ cuenta: 'admin.cooperativa', resultado: `afirmación en revisión; estados distintos (archivo/documento/afirmación)=${distinct}; puede verificar=${verify}; sin «conformidad» como estado=${!/Cumple|Conforme EUDR/.test(text)}`,
      ok: distinct && verify === 1 && !/Cumple|Conforme EUDR/.test(text) });
    await ctx.close();
  }
  {
    const { ctx, page } = await loginAs(acc('tecnico1.cooperativa'), { width: 390, height: 844 });
    await openClaim(page);
    const verify = await page.getByRole('button', { name: 'Verificar afirmación' }).count();
    await page.goto(`${BASE}/organizaciones/${coop}/evidencias`);
    await page.getByLabel('Afirmación', { exact: true }).selectOption({ label: 'Existe documentación de tenencia' });
    await page.getByLabel('Afirmación', { exact: true }).focus();
    await page.keyboard.press('Tab'); // con la afirmación elegida, el siguiente control habilitado es el tipo de entidad
    const focused = await page.evaluate(() => document.activeElement?.id);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: join(shots, 'evidencias--tecnico1-390.png'), fullPage: true });
    casos.push({ cuenta: 'tecnico1.cooperativa (capturador, 390 px, teclado)', resultado: `ve la afirmación de su productor; puede verificar=${verify}; foco tras elegir afirmación con teclado en «${focused}»; desborde=${overflow}`,
      ok: verify === 0 && focused === 'cl-etype' && !overflow });
    await ctx.close();
  }
  {
    const auditor = acc('auditor.cooperativa');
    if (auditor) {
      const { ctx, page } = await loginAs(auditor);
      const text = await openClaim(page);
      const actions = await page.getByRole('button', { name: /Verificar|Enviar a revisión|Vincular soporte|Rechazar/ }).count();
      await page.screenshot({ path: join(shots, 'evidencias--auditor.png'), fullPage: true });
      casos.push({ cuenta: 'auditor.cooperativa', resultado: `consulta sin acciones (${actions}); contenido restringido indicado=${text.includes('contenido restringido para tu rol')}`,
        ok: actions === 0 && text.includes('contenido restringido para tu rol') });
      await ctx.close();
    }
  }
  return { tipo: 'evidencias', casos, ok: casos.every((c) => c.ok) };
}
