// Revisión de P0-009 GeoJSON en navegador sobre datos DEMO: administrador, técnico asignado (390 px y
// teclado) y auditor. Los archivos son sintéticos. Cada análisis se DESCARTA para no alterar DEMO; la
// exportación descarga la versión poligonal existente de DEMO-PAR-001 sin modificarla.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SQUARE = [[-80.16, -0.848], [-80.159, -0.848], [-80.159, -0.847], [-80.16, -0.847], [-80.16, -0.848]];
const BOWTIE = [[-80.16, -0.848], [-80.159, -0.847], [-80.159, -0.848], [-80.16, -0.847], [-80.16, -0.848]];
const file = (o) => Buffer.from(JSON.stringify(o, null, 2));

export async function reviewGeoJson({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
  const acc = (local, orgPart) => accounts.find((x) => x.email.startsWith(local) && x.organizacion.includes(orgPart));
  const coopId = orgIdByName[DEMO_ORGS.find((o) => o.includes('Cooperativa'))];
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
  const openPlot = async (page, code) => {
    await page.goto(`${BASE}/organizaciones/${coopId}/parcelas`);
    await page.getByRole('link', { name: new RegExp(code) }).click();
    await page.getByRole('heading', { name: new RegExp(code) }).waitFor();
    await page.getByRole('heading', { name: 'Versiones geométricas' }).waitFor();
    await page.waitForTimeout(1200);
  };
  const casos = [];

  // Administrador: análisis con revisión (descartado) y exportación de la versión poligonal.
  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa', 'Cooperativa'));
    await openPlot(page, 'DEMO-PAR-001');
    const bytes = file({ type: 'Feature', properties: { nota: 'sintético' }, geometry: { type: 'Polygon', coordinates: [SQUARE] } });
    await page.getByLabel('Archivo GeoJSON (.geojson o .json)').setInputFiles({ name: 'revision-admin.geojson', mimeType: 'application/geo+json', buffer: bytes });
    await page.getByRole('button', { name: 'Analizar archivo' }).click();
    const review = page.getByRole('region', { name: 'Revisión de la importación' });
    await review.waitFor({ timeout: 15000 });
    const text = await review.innerText();
    const hashOk = text.includes(createHash('sha256').update(bytes).digest('hex'));
    await page.screenshot({ path: join(shots, 'geojson--admin-revision.png'), fullPage: true });
    await page.getByRole('button', { name: 'Descartar importación' }).click();
    await page.getByText('Importación descartada').waitFor();
    const row = page.getByRole('table', { name: 'Versiones geométricas' }).locator('tbody tr').filter({ hasText: 'Polígono' }).first();
    const [dl] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: /Exportar GeoJSON/ }).click()]);
    const feature = JSON.parse(readFileSync(await dl.path(), 'utf8'));
    const exportOk = feature.type === 'Feature' && feature.geometry?.type === 'Polygon' && /No es un paquete/.test(feature.properties?.notice ?? '');
    const noIdentity = !JSON.stringify(feature).includes('DEMO-RV-001') && feature.properties.producer === undefined;
    await page.screenshot({ path: join(shots, 'geojson--admin-exportacion.png'), fullPage: true });
    casos.push({ cuenta: 'admin.cooperativa', resultado: `revisión: hash del servidor=${hashOk}, válida=${text.includes('Válida')}, GIS pendiente=${text.includes('P0-010')}, descartada; exportación ${dl.suggestedFilename()}: Feature/Polygon con aviso=${exportOk}, sin identidad del productor=${noIdentity}`,
      ok: hashOk && text.includes('Válida') && text.includes('P0-010') && exportOk && noIdentity });
    await ctx.close();
  }

  // Técnico asignado a 390 px: teclado, geometría no válida sin superficie, recarga y retoma, descarta.
  {
    const { ctx, page } = await loginAs(acc('tecnico1.cooperativa', 'Cooperativa'), { width: 390, height: 844 });
    await openPlot(page, 'DEMO-PAR-003');
    await page.getByLabel('Archivo GeoJSON (.geojson o .json)').setInputFiles({ name: 'cruzado.geojson', mimeType: 'application/geo+json', buffer: file({ type: 'Polygon', coordinates: [BOWTIE] }) });
    await page.getByRole('button', { name: 'Analizar archivo' }).focus();
    await page.keyboard.press('Enter');
    const review = page.getByRole('region', { name: 'Revisión de la importación' });
    await review.waitFor({ timeout: 15000 });
    const text = await review.innerText();
    const disabled = await page.getByRole('button', { name: 'Confirmar nueva versión' }).isDisabled();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: join(shots, 'geojson--tecnico1-no-valida-390.png'), fullPage: true });
    await page.reload();
    await page.getByRole('button', { name: 'Retomar revisión' }).click();
    await review.waitFor();
    await page.getByRole('button', { name: 'Descartar importación' }).click();
    await page.getByText('Importación descartada').waitFor();
    casos.push({ cuenta: 'tecnico1.cooperativa (asignado, 390 px)', resultado: `autointersección: no válida=${text.includes('No válida')}, sin superficie=${text.includes('No calculada')}, confirmar bloqueado=${disabled}; retomada tras recargar y descartada; desborde=${overflow}`,
      ok: text.includes('No válida') && text.includes('No calculada') && disabled && !overflow });
    await ctx.close();
  }

  // Auditor: sin panel de importación, sin descargas y la API rechaza original/exportación.
  {
    const auditor = acc('auditor.cooperativa', 'Cooperativa');
    if (auditor) {
      const { ctx, page } = await loginAs(auditor);
      await openPlot(page, 'DEMO-PAR-001');
      const panel = await page.getByRole('heading', { name: 'Importar GeoJSON' }).count();
      const downloads = await page.getByRole('button', { name: /Exportar GeoJSON|archivo original/ }).count();
      const status = await page.evaluate(async (url) => {
        const org = url.split('/organizaciones/')[1].split('/')[0];
        const id = url.split('?')[0].split('/').pop();
        const t = sessionStorage.getItem('tl_token');
        const h = { authorization: `Bearer ${t}` };
        const versions = await (await fetch(`http://localhost:4000/api/v1/organizations/${org}/plots/${id}/geometry-versions`, { headers: h })).json();
        const v = versions.find((x) => x.geometry_type);
        const exp = await fetch(`http://localhost:4000/api/v1/organizations/${org}/plots/${id}/geometry-versions/${v.id}/geojson`, { headers: h });
        const list = await fetch(`http://localhost:4000/api/v1/organizations/${org}/plots/${id}/geometry-imports`, { headers: h });
        return [exp.status, list.status];
      }, page.url());
      await page.screenshot({ path: join(shots, 'geojson--auditor-sin-acceso.png'), fullPage: true });
      casos.push({ cuenta: 'auditor.cooperativa', resultado: `panel de importación=${panel}; botones de descarga=${downloads}; API exportación/importaciones=${status.join('/')}`,
        ok: panel === 0 && downloads === 0 && status[0] === 403 && status[1] === 403 });
      await ctx.close();
    }
  }
  return { tipo: 'geojson', casos, ok: casos.every((c) => c.ok) };
}
