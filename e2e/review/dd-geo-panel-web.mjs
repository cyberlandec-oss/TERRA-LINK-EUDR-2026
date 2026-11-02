// Recorrido VISUAL del panel «Evaluación geográfica técnica actual» del expediente DD-2026-00002 con cuentas DEMO vigentes (solo lectura: no crea nada).
// Verifica que el aviso ya no es fijo: separa evaluación técnica, estado ACTUAL del requisito con su motivo y estado guardado en la última instantánea.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const rows = readFileSync('../CREDENCIALES.csv', 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split(','));
const h = rows[0]; const cred = (loc) => { const r = rows.find((x) => x[h.indexOf('email')]?.startsWith(loc + '@')); return { email: r[h.indexOf('email')], pwd: r[h.indexOf('contrasena')] }; };
const b = await chromium.launch(); const res = [];
for (const who of ['eudr.cooperativa', 'auditor.cooperativa']) {
  const c = cred(who); const p = await b.newPage({ viewport: { width: 1100, height: 1500 } });
  await p.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await p.getByLabel('Correo').fill(c.email); await p.getByLabel('Contraseña', { exact: true }).fill(c.pwd);
  await p.getByRole('button', { name: 'Iniciar sesión' }).last().click(); await p.waitForURL(/organizaciones/, { timeout: 20000 });
  await p.getByRole('link', { name: /Cooperativa Río Verde/ }).first().click().catch(() => {});
  await p.waitForTimeout(1500);
  const orgUrl = p.url().match(/organizaciones\/[0-9a-f-]{36}/)?.[0];
  await p.goto(`http://localhost:3000/${orgUrl}/diligencia`, { waitUntil: 'networkidle' });
  await p.getByText('DD-2026-00002').first().click(); await p.waitForTimeout(2500);
  const panel = p.getByText('Evaluación geográfica técnica actual').first();
  const visible = await panel.isVisible().catch(() => false);
  const txt = (await p.locator('main').innerText().catch(() => '')).replace(c.pwd, '***');
  res.push({ cuenta: who, panel_visible: visible, estado_actual: /Estado actual del requisito GEOLOCATION_PROFILE/.test(txt), motivo_concreto: /no ha adoptado ninguna configuración/.test(txt), ultima_instantanea: /última instantánea/.test(txt), aviso_fijo_antiguo: /sigue pendiente \(D-05\.B\)|falta la condición regulatoria revisada/.test(txt), sin_conexion: /Sin conexión con el servidor/.test(txt) });
  if (visible) await panel.scrollIntoViewIfNeeded();
  await p.screenshot({ path: `../docs/qa/capturas/dd-geo-panel/${who}.png`, fullPage: true });
  await p.close();
}
await b.close(); console.log(JSON.stringify(res, null, 1));
writeFileSync('../docs/qa/dd-geo-panel-web.json', JSON.stringify({ fecha: new Date().toISOString(), resultados: res }, null, 2));
