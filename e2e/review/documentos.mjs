// Revisión de P0-018 sobre datos DEMO (documento SINTÉTICO del seed): administrador, técnico capturador
// asignado (390 px y teclado), técnico sin asignación y productor sin permiso. No sube ni revisa documentos.
import { join } from 'node:path';

export async function reviewDocuments({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
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
  const center = async (page) => {
    await page.goto(`${BASE}/organizaciones/${coop}/documentos`);
    await page.getByRole('table', { name: 'Documentos' }).or(page.getByText(/Aún no hay documentos|Tu rol no permite consultar documentos/)).first().waitFor({ timeout: 15000 });
  };
  const casos = [];
  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa'));
    await center(page);
    const rows = await page.getByRole('table', { name: 'Documentos' }).locator('tbody tr').allInnerTexts();
    const upload = await page.getByRole('heading', { name: 'Subir documento' }).count();
    await page.screenshot({ path: join(shots, 'documentos--admin-centro.png'), fullPage: true });
    await page.getByRole('link', { name: /Guía de entrega DEMO-RV-001/ }).click();
    await page.getByRole('list', { name: 'Versiones del documento' }).waitFor({ timeout: 15000 });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar v1' }).click()]);
    const review = await page.getByRole('button', { name: 'Aceptar versión' }).count();
    await page.screenshot({ path: join(shots, 'documentos--admin-ficha.png'), fullPage: true });
    casos.push({ cuenta: 'admin.cooperativa', resultado: `${rows.length} documento(s); disponible=${rows.some((r) => r.includes('Disponible'))}; formulario de carga=${upload}; descarga ${dl.suggestedFilename()}; puede revisar=${review}`,
      ok: rows.length >= 1 && rows.some((r) => r.includes('Disponible')) && upload === 1 && dl.suggestedFilename() === 'guia-demo.pdf' && review === 1 });
    await ctx.close();
  }
  {
    const { ctx, page } = await loginAs(acc('tecnico1.cooperativa'), { width: 390, height: 844 });
    await center(page);
    const rows = await page.getByRole('table', { name: 'Documentos' }).locator('tbody tr').count();
    await page.getByLabel('Tipo de documento').focus();
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.id);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const reviewBtn = await page.getByRole('button', { name: 'Aceptar versión' }).count();
    await page.screenshot({ path: join(shots, 'documentos--tecnico1-390.png'), fullPage: true });
    casos.push({ cuenta: 'tecnico1.cooperativa (capturador asignado, 390 px, teclado)', resultado: `${rows} documento(s) de sus productores; foco tras Tab en «${focused}»; botón de revisión=${reviewBtn}; desborde=${overflow}`,
      ok: rows >= 1 && focused === 'up-title' && reviewBtn === 0 && !overflow }); // los selectores deshabilitados (sin tipo) se omiten al tabular
    await ctx.close();
  }
  {
    const { ctx, page } = await loginAs(acc('tecnico2.cooperativa'));
    await center(page);
    const empty = await page.getByText('Aún no hay documentos a tu alcance.').count();
    casos.push({ cuenta: 'tecnico2.cooperativa (sin asignación)', resultado: `documentos de productores ajenos visibles=${empty === 1 ? 0 : 'sí'}`, ok: empty === 1 });
    await ctx.close();
  }
  {
    const { ctx, page } = await loginAs(acc('productor.cooperativa'));
    await center(page);
    const denied = await page.getByText('Tu rol no permite consultar documentos.').count();
    const link = await page.getByRole('link', { name: 'Documentos', exact: true }).count();
    await page.screenshot({ path: join(shots, 'documentos--productor-sin-permiso.png'), fullPage: true });
    casos.push({ cuenta: 'productor.cooperativa (sin permiso)', resultado: `enlace=${link}; acceso denegado=${denied}`, ok: link === 0 && denied === 1 });
    await ctx.close();
  }
  return { tipo: 'documentos', casos, ok: casos.every((c) => c.ok) };
}
