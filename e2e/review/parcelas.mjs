// Revisión de P0-006/P0-007/P0-008 Parcelas en navegador: administrador, técnico asignado, técnico NO asignado (abre una
// parcela ajena por id directo), usuario con dos organizaciones, teclado y 390 px. Datos DEMO sintéticos.
import { join } from 'node:path';

export async function reviewPlots({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
  const acc = (local, orgPart) => accounts.find((x) => x.email.startsWith(local) && x.organizacion.includes(orgPart));
  const coopId = orgIdByName[DEMO_ORGS.find((o) => o.includes('Cooperativa'))];
  const exportId = orgIdByName[DEMO_ORGS.find((o) => o.includes('Exportadora'))];
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
  const plotRows = async (page, orgId) => {
    await page.goto(`${BASE}/organizaciones/${orgId}/parcelas`);
    await page.getByRole('table', { name: 'Parcelas' }).or(page.getByText(/Aún no hay parcelas|aún no tienen parcelas/)).first().waitFor({ timeout: 15000 });
    return page.locator('tbody tr').allInnerTexts();
  };
  const casos = [];

  // Administrador: todas las parcelas; ficha con geometría; teclado; vuelta al productor.
  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa', 'Cooperativa'));
    const rows = await plotRows(page, coopId);
    await page.screenshot({ path: join(shots, 'parcelas--admin-listado.png'), fullPage: true });
    await page.getByRole('link', { name: /DEMO-PAR-001/ }).click();
    await page.getByRole('heading', { name: /DEMO-PAR-001/ }).waitFor();
    await page.getByRole('table', { name: 'Versiones geométricas' }).waitFor();
    const sketch = await page.getByRole('img', { name: /Esquema de DEMO-PAR-001/ }).count();
    const coords = await page.getByRole('table', { name: 'Coordenadas (WGS84)' }).locator('tbody tr').count();
    const versions = await page.getByRole('table', { name: 'Versiones geométricas' }).locator('tbody tr').count();
    const forbiddenButtons = await page.getByRole('button', { name: /GPS|satelital|riesgo/i }).count();
    const captureButton = await page.getByRole('button', { name: 'Capturar ubicación' }).count();
    await page.getByRole('button', { name: 'Capturar ubicación' }).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab'); // llegar por teclado activa :focus-visible
    const captureFocus = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    await page.screenshot({ path: join(shots, 'parcelas--admin-ficha-poligono.png'), fullPage: true });
    await page.getByLabel('Nombre (opcional)').focus();
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    await page.getByRole('link', { name: /DEMO-RV-001/ }).first().click();
    await page.getByRole('list', { name: 'Parcelas del productor' }).waitFor();
    const back = await page.getByRole('list', { name: 'Parcelas del productor' }).getByRole('listitem').count();
    casos.push({ cuenta: 'admin.cooperativa', resultado: `${rows.length} parcelas; ficha: esquema=${sketch}, ${coords} coordenadas, ${versions} versiones, botones de funciones no implementadas (GPS nativo, satélite, riesgo)=${forbiddenButtons}, «Capturar ubicación»=${captureButton} (foco ${captureFocus}); foco campo=${outline}; productor→parcelas=${back}`,
      // El seed DEMO tiene 6 parcelas; la DEMO puede tener además parcelas importadas (P0-026) y más versiones.
      ok: ['DEMO-PAR-001','DEMO-PAR-002','DEMO-PAR-003','DEMO-PAR-004','DEMO-PAR-005','DEMO-PAR-006'].every((c) => rows.some((r) => r.includes(c))) && sketch === 1 && coords >= 1 && versions >= 2 && forbiddenButtons === 0 && captureButton === 1 && captureFocus === 'solid' && outline === 'solid' && back === 2 });
    await ctx.close();
  }

  // Técnico asignado: solo parcelas de sus productores; guarda la URL de una para el no asignado.
  let foreignPlotUrl = null;
  {
    const { ctx, page } = await loginAs(acc('tecnico1.cooperativa', 'Cooperativa'));
    const rows = await plotRows(page, coopId);
    await page.getByRole('link', { name: /DEMO-PAR-002/ }).click();
    await page.getByRole('heading', { name: /DEMO-PAR-002/ }).waitFor();
    await page.getByRole('button', { name: 'Guardar cambios' }).waitFor();
    foreignPlotUrl = page.url();
    const canEdit = await page.getByRole('button', { name: 'Guardar cambios' }).count();
    const pointArea = await page.getByText('No aplica: un punto no tiene superficie').count();
    const capture = await page.getByRole('button', { name: 'Capturar ubicación' }).count();
    await page.screenshot({ path: join(shots, 'parcelas--tecnico1-ficha-punto.png'), fullPage: true });
    casos.push({ cuenta: 'tecnico1.cooperativa (asignado)', resultado: `${rows.length} parcelas visibles; puede editar=${canEdit}; punto sin superficie calculada=${pointArea}; «Capturar ubicación»=${capture}`,
      ok: rows.length === 5 && !rows.some((r) => r.includes('DEMO-PAR-005')) && canEdit === 1 && pointArea === 1 && capture === 1 });
    await ctx.close();
  }

  // Técnico NO asignado: conocer el id/URL no da acceso.
  {
    const { ctx, page } = await loginAs(acc('tecnico2.cooperativa', 'Cooperativa'));
    const rows = await plotRows(page, coopId);
    await page.goto(foreignPlotUrl);
    await page.locator('.error[role="alert"]').or(page.getByRole('heading', { name: /DEMO-PAR-002/ })).first().waitFor({ timeout: 15000 });
    const text = await page.locator('main').innerText();
    const denied = /no está disponible|no existe/i.test(text) && !text.includes('Loma alta');
    await page.screenshot({ path: join(shots, 'parcelas--tecnico2-id-ajeno.png'), fullPage: true });
    casos.push({ cuenta: 'tecnico2.cooperativa (no asignado)', resultado: `${rows.length} parcela(s) propias; DEMO-PAR-002 por URL directa: ${denied ? 'no disponible, sin datos' : 'INESPERADO'}`,
      ok: rows.length === 1 && rows[0].includes('DEMO-PAR-005') && denied });
    await ctx.close();
  }

  // Auditor de la cooperativa: lee parcelas pero NO recibe coordenadas exactas (clasificación de geometría).
  {
    const auditor = acc('auditor.cooperativa', 'Cooperativa');
    if (auditor) {
      const { ctx, page } = await loginAs(auditor);
      const rows = await plotRows(page, coopId);
      await page.getByRole('link', { name: /DEMO-PAR-001/ }).click();
      await page.getByRole('heading', { name: /DEMO-PAR-001/ }).waitFor();
      await page.getByRole('table', { name: 'Versiones geométricas' }).waitFor();
      const text = await page.locator('main').innerText();
      const noCoords = !text.includes('-80.16') && (await page.getByRole('table', { name: 'Coordenadas (WGS84)' }).count()) === 0;
      const notice = await page.getByText('Tu rol no tiene acceso a las coordenadas exactas').count();
      const capture = await page.getByRole('button', { name: 'Capturar ubicación' }).count();
      const api = await page.evaluate(async (url) => {
        const id = url.split('/').pop();
        const org = url.split('/organizaciones/')[1].split('/')[0];
        const t = sessionStorage.getItem('tl_token');
        const r = await fetch(`http://localhost:4000/api/v1/organizations/${org}/plots/${id}/geometry-versions`, { headers: { authorization: `Bearer ${t}` } });
        return JSON.stringify(await r.json());
      }, page.url());
      await page.screenshot({ path: join(shots, 'parcelas--auditor-sin-coordenadas.png'), fullPage: true });
      casos.push({ cuenta: 'auditor.cooperativa (sin geometría exacta)', resultado: `${rows.length} parcelas; coordenadas en pantalla=${!noCoords}; aviso=${notice}; «Capturar ubicación»=${capture}; respuesta API con coordenadas=${api.includes('coordinates') || api.includes('-80.16')}`,
        ok: ['DEMO-PAR-001','DEMO-PAR-002','DEMO-PAR-003','DEMO-PAR-004','DEMO-PAR-005','DEMO-PAR-006'].every((c) => rows.some((r) => r.includes(c))) && noCoords && notice === 1 && capture === 0 && !api.includes('coordinates') && !api.includes('-80.16') });
      await ctx.close();
    }
  }

  // P0-008 Polígono [SIMULADA]: borrador en el servidor con posiciones emuladas (no es captura real).
  // La emulación de Chromium siempre informa precisión: «no informada» se prueba en integración (API real).
  // Técnico asignado en DEMO-PAR-003: 3 vértices, recarga, revisión; al final cancela para no alterar DEMO.
  // Admin ve la acción; auditor no (sin plot:read_geometry); técnico no asignado no accede a la parcela.
  {
    const tech = acc('tecnico1.cooperativa', 'Cooperativa');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-EC', permissions: ['geolocation'], geolocation: { latitude: -0.848, longitude: -80.16, accuracy: 6 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.getByLabel('Correo').fill(tech.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(tech.contrasena);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 15000 });
    await plotRows(page, coopId);
    await page.getByRole('link', { name: /DEMO-PAR-003/ }).click();
    await page.getByRole('heading', { name: /DEMO-PAR-003/ }).waitFor();
    const startBtn = page.getByRole('button', { name: 'Iniciar captura de polígono' });
    await startBtn.or(page.getByRole('button', { name: 'Añadir vértice' })).first().waitFor({ timeout: 15000 });
    if (await startBtn.count()) await startBtn.click();
    const pts = [[-0.848, -80.16, 6], [-0.848, -80.159, 9], [-0.847, -80.1595, 11]];
    for (const [lat, lon, a] of pts) {
      await ctx.setGeolocation({ latitude: lat, longitude: lon, ...(a === null ? {} : { accuracy: a }) });
      await page.getByRole('button', { name: 'Añadir vértice' }).click();
      await page.getByRole('button', { name: 'Guardar vértice' }).click();
      await page.getByRole('button', { name: 'Añadir vértice' }).waitFor();
    }
    await page.screenshot({ path: join(shots, 'poligono--tecnico1-borrador-390.png'), fullPage: true });
    await page.reload();
    await page.getByRole('table', { name: 'Vértices del borrador' }).waitFor({ timeout: 15000 });
    const persisted = await page.getByRole('table', { name: 'Vértices del borrador' }).locator('tbody tr').filter({ hasText: '-80.1' }).count();
    const summary = await page.getByText(/con precisión informada/).first().innerText().catch(() => '');
    await page.getByRole('button', { name: 'Revisar y confirmar' }).click();
    const review = await page.getByRole('region', { name: 'Revisión antes de confirmar' }).innerText();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: join(shots, 'poligono--tecnico1-revision-390.png'), fullPage: true });
    await page.getByRole('button', { name: 'Seguir capturando' }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Cancelar borrador' }).click();
    await startBtn.waitFor();
    casos.push({ cuenta: 'tecnico1.cooperativa — polígono [SIMULADA]', resultado: `vértices tras recargar=${persisted}; resumen «${summary.replace('Precisión: ', '')}»; revisión con validez técnica=${review.includes('Válida')} y GIS pendiente=${review.includes('P0-010')}; desborde 390 px=${overflow}; borrador cancelado (DEMO intacto)`,
      ok: persisted >= 3 && /3 vértices con precisión informada; 0 sin informar; peor precisión conocida 11 m/.test(summary) && review.includes('Válida') && review.includes('P0-010') && !overflow });
    await ctx.close();
  }
  {
    const check = async (local, plotCode) => {
      const { ctx, page } = await loginAs(acc(local, 'Cooperativa'));
      await plotRows(page, coopId);
      await page.getByRole('link', { name: new RegExp(plotCode) }).click();
      await page.getByRole('heading', { name: new RegExp(plotCode) }).waitFor();
      await page.getByRole('heading', { name: 'Versiones geométricas' }).waitFor();
      await page.waitForTimeout(1500);
      const n = await page.getByRole('button', { name: /Iniciar captura de polígono|Añadir vértice/ }).count();
      await page.screenshot({ path: join(shots, `poligono--${local.split('.')[0]}-accion.png`), fullPage: true });
      await ctx.close();
      return n;
    };
    const admin = await check('admin.cooperativa', 'DEMO-PAR-003');
    const auditor = acc('auditor.cooperativa', 'Cooperativa') ? await check('auditor.cooperativa', 'DEMO-PAR-003') : null;
    casos.push({ cuenta: 'polígono por rol', resultado: `admin: acción de polígono=${admin}; auditor: acción de polígono=${auditor} (sin plot:read_geometry); técnico no asignado: parcela ajena no disponible (caso anterior)`,
      ok: admin === 1 && auditor === 0 });
  }

  // Usuario con dos organizaciones: roles y datos de cada una por separado.
  {
    const { ctx, page } = await loginAs(acc('coordinador.multi', 'Cooperativa'));
    const coop = await plotRows(page, coopId);
    const exp = await plotRows(page, exportId);
    const emptyExport = await page.getByText('Aún no hay parcelas registradas.').count();
    casos.push({ cuenta: 'coordinador.multi', resultado: `cooperativa (Supervisor): ${coop.length} parcelas; exportadora (Trazabilidad): ${exp.length} filas, vacío autorizado=${emptyExport}`,
      ok: ['DEMO-PAR-001','DEMO-PAR-006'].every((c) => coop.some((r) => r.includes(c))) && exp.length === 0 && emptyExport === 1 });
    await ctx.close();
  }

  // 390 px: ficha de parcela sin desbordamiento horizontal.
  {
    const { ctx, page } = await loginAs(acc('tecnico1.cooperativa', 'Cooperativa'), { width: 390, height: 844 });
    await plotRows(page, coopId);
    await page.getByRole('link', { name: /DEMO-PAR-001/ }).click();
    await page.getByRole('table', { name: 'Versiones geométricas' }).waitFor();
    await page.getByRole('button', { name: 'Capturar ubicación' }).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: join(shots, 'movil--parcela-ficha.png'), fullPage: true });
    casos.push({ cuenta: 'tecnico1.cooperativa (390 px)', resultado: `desbordamiento horizontal en la ficha=${overflow}`, ok: !overflow });
    await ctx.close();
  }

  return { tipo: 'parcelas', casos, ok: casos.every((c) => c.ok) };
}
