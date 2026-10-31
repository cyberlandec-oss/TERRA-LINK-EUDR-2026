// Revisión de P0-010 (evaluación GIS técnica) en navegador sobre datos DEMO: administrador, técnico
// asignado (390 px y teclado) y auditor. Evaluar crea registros inmutables de evaluación (historial);
// no modifica geometrías ni parcelas DEMO.
import { join } from 'node:path';

export async function reviewGis({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
  const acc = (local, orgPart) => accounts.find((x) => x.email.startsWith(local) && x.organizacion.includes(orgPart));
  const coopId = orgIdByName[DEMO_ORGS.find((o) => o.includes('Cooperativa'))];
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
  const openPlot = async (page, code) => {
    await page.goto(`${BASE}/organizaciones/${coopId}/parcelas`);
    await page.getByRole('link', { name: new RegExp(code) }).click();
    await page.getByRole('heading', { name: new RegExp(code) }).waitFor();
    const section = page.getByRole('region', { name: 'Evaluación GIS (técnica)' });
    await section.waitFor();
    await page.waitForTimeout(1200);
    return section;
  };
  const casos = [];

  // Administrador: evalúa la versión poligonal de DEMO-PAR-001.
  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa', 'Cooperativa'));
    const section = await openPlot(page, 'DEMO-PAR-001');
    await section.getByRole('button', { name: /Evaluar geometría|Volver a evaluar/ }).click();
    await section.getByRole('table', { name: 'Comprobaciones técnicas' }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    const text = await section.innerText();
    await page.screenshot({ path: join(shots, 'gis--admin-evaluacion.png'), fullPage: true });
    const scoped = text.includes('no es conformidad EUDR') && text.includes('TL_GIS_TECH') && text.includes('No evaluado: el perfil de destino requiere definición (D-05)');
    const status = /VALID|WARNING|INVALID|REVIEW_REQUIRED/.exec(text)?.[0];
    casos.push({ cuenta: 'admin.cooperativa', resultado: `DEMO-PAR-001 evaluada: estado ${status}; alcance técnico y perfil de destino no evaluado=${scoped}; calidad de captura «${/Calidad y cobertura de captura\s+([^\n]+)/.exec(text)?.[1] ?? ''}»`, ok: !!status && scoped });
    await ctx.close();
  }

  // Técnico asignado a 390 px con teclado: evalúa DEMO-PAR-002 (punto; DEMO-PAR-003 no tiene versión y no muestra el botón).
  {
    const { ctx, page } = await loginAs(acc('tecnico1.cooperativa', 'Cooperativa'), { width: 390, height: 844 });
    const section = await openPlot(page, 'DEMO-PAR-002');
    const btn = section.getByRole('button', { name: /Evaluar geometría|Volver a evaluar/ });
    const can = await btn.count();
    if (can) {
      await btn.focus();
      await page.keyboard.press('Enter');
      await section.getByRole('table', { name: 'Comprobaciones técnicas' }).waitFor({ timeout: 15000 });
      await page.waitForTimeout(500);
    }
    const text = await section.innerText();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: join(shots, 'gis--tecnico1-390.png'), fullPage: true });
    casos.push({ cuenta: 'tecnico1.cooperativa (asignado, 390 px, teclado)', resultado: `botón de evaluación=${can}; resultado visible=${text.includes('Validez técnica')}; desborde=${overflow}`,
      ok: can === 1 && text.includes('Validez técnica') && !overflow });
    await ctx.close();
  }

  // Auditor: consulta, sin botón de evaluación ni ubicación de errores.
  {
    const auditor = acc('auditor.cooperativa', 'Cooperativa');
    if (auditor) {
      const { ctx, page } = await loginAs(auditor);
      const section = await openPlot(page, 'DEMO-PAR-001');
      const btn = await section.getByRole('button', { name: /Evaluar geometría|Volver a evaluar/ }).count();
      const text = await section.innerText();
      await page.screenshot({ path: join(shots, 'gis--auditor-consulta.png'), fullPage: true });
      casos.push({ cuenta: 'auditor.cooperativa', resultado: `botón de evaluación=${btn}; ve el resultado=${text.includes('Estado técnico')}; coordenadas o ubicación del problema=${/Ubicación del problema|-80\.\d/.test(text)}`,
        ok: btn === 0 && text.includes('Estado técnico') && !/Ubicación del problema|-80\.\d/.test(text) });
      await ctx.close();
    }
  }
  return { tipo: 'gis', casos, ok: casos.every((c) => c.ok) };
}
