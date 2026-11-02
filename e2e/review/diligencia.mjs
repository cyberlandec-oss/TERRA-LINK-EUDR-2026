// Revisión de P0-022 sobre el expediente DEMO de LOT-2026-00002 (Cooperativa): responsable EUDR (requisitos y bloqueos
// explicados; paquete y aprobación bloqueados), auditor (390 px, teclado; lectura sin acciones y sin coordenadas) y
// gerente/técnico (sin acceso). No captura, revisa ni exporta: solo consulta.
import { join } from 'node:path';

export async function reviewDueDiligence({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
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
    await page.goto(`${BASE}/organizaciones/${coop}/diligencia`);
    await page.getByRole('table', { name: 'Expedientes' }).locator('tbody tr').filter({ hasText: 'LOT-2026-00002' }).first().getByRole('link').click();
    await page.getByRole('table', { name: 'Requisitos' }).waitFor({ timeout: 20000 });
    return page.locator('main').innerText();
  };
  const casos = [];
  {
    const { ctx, page } = await loginAs(acc('eudr.cooperativa'));
    const text = await open(page);
    const row = async (code) => page.getByRole('table', { name: 'Requisitos' }).locator('tr').filter({ hasText: code }).innerText();
    const ne = (await Promise.all(['RISK_CATALOG_APPROVED', 'REGULATORY_CONCLUSION', 'LEGAL_PROFILE', 'GEOLOCATION_PROFILE', 'SHIPMENT_LINK'].map(row))).every((t) => t.includes('No evaluable'));
    const origin = await row('RISK_NO_BLOCKING_FINDINGS');
    const pkgDisabled = await page.getByRole('button', { name: 'Generar paquete de diligencia' }).isDisabled();
    await page.screenshot({ path: join(shots, 'diligencia--eudr.png'), fullPage: true });
    const ok = ne && origin.includes('Inválido') && origin.includes('DATA_MISSING_ORIGIN') && /Bloqueada|Desactualizada/.test(text) && pkgDisabled && text.includes('no presentada') && text.includes('Indeterminada');
    casos.push({ cuenta: 'eudr.cooperativa (responsable EUDR)', resultado: `perfil/D-05/catálogo/conclusión/embarques no evaluables=${ne}; hallazgo DATA_MISSING_ORIGIN inválido=${origin.includes('Inválido')}; paquete deshabilitado=${pkgDisabled}; presentación oficial no presentada`, ok });
    await ctx.close();
  }
  {
    const a = acc('auditor.cooperativa');
    if (a) {
      const { ctx, page } = await loginAs(a, { width: 390, height: 844 });
      const text = await open(page);
      const buttons = await page.getByRole('button', { name: /Capturar|Iniciar revisión|Generar|Aprobar|Devolver/ }).count();
      await page.keyboard.press('Tab');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      await page.screenshot({ path: join(shots, 'diligencia--auditor-390.png'), fullPage: true });
      const noCoords = text.includes('no permite ver coordenadas');
      casos.push({ cuenta: 'auditor.cooperativa (390 px, teclado)', resultado: `lectura sin acciones (${buttons}); sin coordenadas=${noCoords}; desborde=${overflow}`, ok: buttons === 0 && noCoords && !overflow });
      await ctx.close();
    }
  }
  for (const local of ['coordinador.multi', 'tecnico1.cooperativa']) {
    const m = acc(local);
    if (!m) continue;
    const { ctx, page } = await loginAs(m);
    await page.goto(`${BASE}/organizaciones/${coop}/diligencia`);
    await page.waitForLoadState('networkidle');
    const denied = /no permite consultar expedientes/.test(await page.locator('main').innerText());
    const link = await page.getByRole('link', { name: 'Debida diligencia' }).count();
    casos.push({ cuenta: local, resultado: `acceso denegado=${denied}; sin enlace=${link === 0}`, ok: denied && link === 0 });
    await ctx.close();
  }
  return { tipo: 'diligencia', casos, ok: casos.every((c) => c.ok) };
}
