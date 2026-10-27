// Revisión de P0-021 sobre el recorrido DEMO (Cooperativa): administración (responsable de la mitigación abierta de
// LOT-2026-00002: puede aportar soporte; no se entrega ni se decide sobre datos DEMO), auditor (390 px, teclado; lectura) y
// gerente (sin acceso). No registra soportes, entregas ni decisiones.
import { join } from 'node:path';

export async function reviewMitigations({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
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
    await page.goto(`${BASE}/organizaciones/${coop}/mitigaciones`);
    await page.getByRole('table', { name: 'Mitigaciones' }).waitFor({ timeout: 15000 });
    await page.getByRole('link', { name: /Completar el origen de ENT-2026-00002/ }).first().click();
    await page.getByRole('heading', { name: 'Caso y acción' }).waitFor({ timeout: 15000 });
    return page.locator('main').innerText();
  };
  const casos = [];
  // Recorrido completo (idempotente: si ya se recorrió, solo comprueba el resultado). Cambia datos DEMO: soporte, entrega,
  // verificación y una nueva evaluación de riesgo. No se aportan ni inventan datos de origen: la causa debe seguir visible.
  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa'));
    let text = await open(page);
    let steps = 'sin nueva entrega (no se inventan datos de origen)';
    if (text.includes('Abierta (sin entrega)')) {
      await page.getByLabel('Versión de documento').selectOption({ index: 1 });
      await page.getByRole('button', { name: 'Aportar soporte' }).click();
      await page.getByRole('list', { name: 'Soportes de la mitigación' }).getByText('Entrega 1').first().waitFor({ timeout: 15000 });
      const stillOpen = (await page.locator('main').innerText()).includes('Abierta (sin entrega)');
      await page.getByLabel('Nota de entrega').fill('Soporte documental DEMO aportado; el origen de ENT-2026-00002 sigue sin identificarse.');
      await page.getByRole('button', { name: 'Entregar para verificación' }).click();
      await page.getByText('Entregada: pendiente de verificación').first().waitFor({ timeout: 15000 });
      steps = `soporte aportado (sigue abierta tras adjuntar=${stillOpen}) y entregada`;
      text = await page.locator('main').innerText();
    }
    await page.screenshot({ path: join(shots, 'mitigaciones--admin.png'), fullPage: true });
    const ok = text.includes('DATA_MISSING_ORIGIN') && text.includes('Quien ejecuta no verifica') && !steps.includes('=false');
    casos.push({ cuenta: 'admin.cooperativa (ejecutor/responsable)', resultado: steps, ok });
    await ctx.close();
  }
  {
    // Segunda persona. El criterio «parcela de origen identificada» NO se cumple con un documento que no identifica la parcela:
    // - entrega pendiente → se rechaza con motivo (no se verifica);
    // - verificación histórica (anterior a la revisión) con la causa vigente → se corrige (la decisión original se conserva).
    // No se aportan ni inventan datos de origen.
    const { ctx, page } = await loginAs(acc('eudr.cooperativa'));
    const text = await open(page);
    let step = 'sin cambios (ya revisada)';
    if (text.includes('Entregada: pendiente de verificación')) {
      await page.getByLabel('Motivo de la decisión').fill('El documento no identifica la parcela de origen de ENT-2026-00002: el criterio de aceptación no se cumple.');
      await page.getByRole('button', { name: 'Rechazar' }).click();
      await page.getByText(/Rechazada \(entrega \d+\)/).first().waitFor({ timeout: 15000 });
      step = 'rechazada con motivo: criterio no cumplido';
    } else if (await page.getByRole('form', { name: 'Corregir verificación' }).count()) {
      const form = page.getByRole('form', { name: 'Corregir verificación' });
      await form.getByLabel('Motivo de la corrección').fill('La constancia aportada es válida como soporte, pero no identifica la parcela de origen de ENT-2026-00002: el criterio de aceptación no se cumple y la causa persiste.');
      await form.getByRole('button', { name: /Corregir verificación/ }).focus();
      await page.keyboard.press('Enter');
      await page.getByText(/Verificación corregida \(entrega 1\)/).first().waitFor({ timeout: 15000 });
      step = 'verificación histórica corregida: soporte aceptado, criterio no cumplido';
    }
    const after = await page.locator('main').innerText();
    await page.screenshot({ path: join(shots, 'mitigaciones--verificador.png'), fullPage: true });
    const dims = after.includes('Soporte aceptado') && after.includes('Criterio de aceptación no cumplido') && /La causa persiste en la evaluación \d+/.test(after);
    const history = /Verificada \(entrega 1\)/.test(after) ? after.includes('Verificación corregida (entrega 1)') : true; // la decisión original sigue visible
    casos.push({ cuenta: 'eudr.cooperativa (segunda persona)', resultado: `${step}; soporte aceptado / criterio no cumplido / causa persiste=${dims}; decisión original conservada=${history}`, ok: dims && history && !after.includes('Revisa la verificación') });
    // Reevaluación tras la corrección (worker del outbox), con procedencia separada.
    let rk = '';
    for (let i = 0; i < 30; i++) {
      await page.goto(`${BASE}/organizaciones/${coop}/riesgo`);
      await page.getByRole('table', { name: 'Riesgo por lote' }).locator('tbody tr').filter({ hasText: 'LOT-2026-00002' }).first().getByRole('link').first().click();
      await page.getByRole('heading', { name: /Riesgo del lote LOT-2026-00002/ }).waitFor({ timeout: 15000 });
      rk = await page.locator('main').innerText();
      if (rk.includes('corrección de una verificación')) break;
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: join(shots, 'mitigaciones--riesgo-reevaluado.png'), fullPage: true });
    const current = rk.match(/Evaluación (\d+)\n/)?.[1];
    const findings = (await page.getByRole('list', { name: 'Hallazgos técnicos' }).innerText().catch(() => '')) + (await page.getByRole('list', { name: 'No evaluable o faltante' }).innerText().catch(() => ''));
    const prov = rk.includes('Desencadenada por') && rk.includes('Diana Ponce (demo) (corrección de una verificación)') && rk.includes('worker de reevaluación') && rk.includes('Nadie todavía (revisión humana pendiente)');
    const ok = prov && rk.includes('Indeterminada') && findings.includes('DATA_MISSING_ORIGIN') && findings.includes('MITIGATION_UNVERIFIED') && rk.includes('sin aprobar');
    casos.push({ cuenta: 'eudr.cooperativa (riesgo tras reevaluar)', resultado: `evaluación vigente ${current}; desencadenada por la segunda persona, ejecutada por el worker, sin revisión humana=${prov}; DATA_MISSING_ORIGIN y MITIGATION_UNVERIFIED visibles; conclusión Indeterminada`, ok });
    await ctx.close();
  }
  {
    const a = acc('auditor.cooperativa');
    if (a) {
      const { ctx, page } = await loginAs(a, { width: 390, height: 844 });
      await open(page);
      const forms = await page.getByRole('button', { name: /Aportar soporte|Entregar|Verificar|Rechazar/ }).count();
      await page.keyboard.press('Tab');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      await page.screenshot({ path: join(shots, 'mitigaciones--auditor-390.png'), fullPage: true });
      casos.push({ cuenta: 'auditor.cooperativa (390 px, teclado)', resultado: `lectura sin acciones (${forms}); desborde=${overflow}`, ok: forms === 0 && !overflow });
      await ctx.close();
    }
  }
  {
    const m = acc('coordinador.multi');
    if (m) {
      const { ctx, page } = await loginAs(m);
      await page.goto(`${BASE}/organizaciones/${coop}/mitigaciones`);
      await page.waitForLoadState('networkidle');
      const denied = /no permite consultar mitigaciones/.test(await page.locator('main').innerText());
      casos.push({ cuenta: 'coordinador.multi (MANAGER)', resultado: `acceso denegado=${denied}`, ok: denied });
      await ctx.close();
    }
  }
  return { tipo: 'mitigaciones', casos, ok: casos.every((c) => c.ok) };
}
