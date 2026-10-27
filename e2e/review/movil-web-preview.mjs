// Revisión de la VISTA PREVIA WEB de la app móvil (http://localhost:3001; `npm run web:preview --prefix apps/mobile`).
// Recorre pantallas y estados con el servidor SIMULADO del navegador y datos sintéticos, en 390 px y en escritorio.
// Registra errores de consola, desbordamiento horizontal y foco de teclado. No sustituye el ensayo en Android.
// Capturas: docs/qa/capturas/movil-web/ · resultado: docs/qa/movil-web/revision.json
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const URL_ = process.env.TL_PREVIEW_URL ?? 'http://localhost:3001';
const SHOTS = join(ROOT, 'docs/qa/capturas/movil-web');
const OUT = join(ROOT, 'docs/qa/movil-web');
mkdirSync(SHOTS, { recursive: true }); mkdirSync(OUT, { recursive: true });

const results = []; const consoleErrors = [];
let n = 0;
const browser = await chromium.launch();

async function run(viewport, tag) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'es-EC' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ tag, text: m.text().slice(0, 300) }); });
  page.on('pageerror', (e) => consoleErrors.push({ tag, text: `pageerror: ${e.message.slice(0, 300)}` }));
  const btn = (name) => page.getByRole('button', { name, exact: false }).first();
  const see = (re) => page.getByText(re).first().waitFor({ timeout: 15000 });
  const shot = async (name) => {
    // Ninguna captura con contraseña escrita: el campo se vacía antes (o no se ha llenado).
    const filledPwd = await page.locator('input[type=password]').evaluateAll((els) => els.some((e) => e.value));
    if (filledPwd) throw new Error('captura rechazada: contraseña escrita en pantalla');
    n += 1; const f = `${String(n).padStart(2, '0')}-${tag}-${name}.png`;
    await page.screenshot({ path: join(SHOTS, f), fullPage: true }); return `docs/qa/capturas/movil-web/${f}`;
  };
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const step = async (name, fn) => {
    try { const detail = await fn(); const ov = await overflow(); results.push({ tag, paso: name, ok: ov <= 0, desborde_px: ov, ...detail }); }
    catch (e) { results.push({ tag, paso: name, ok: false, error: String(e.message).slice(0, 300), captura: await shot(`fallo-${name}`).catch(() => null) }); }
  };

  await page.goto(URL_);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('tlprev.')) localStorage.removeItem(k); });
  await page.reload();

  await step('acceso', async () => {
    await see(/Iniciar sesión/); await see(/Vista previa web de la aplicación móvil/);
    const disabled = await btn('Iniciar sesión').getAttribute('aria-disabled');
    const s1 = await shot('acceso');
    // Teclado: Tab recorre los controles con foco visible.
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName);
    return { boton_deshabilitado_sin_contrasena: disabled === 'true', foco_tras_tab: focused, captura: s1 };
  });
  await step('error-de-acceso', async () => {
    await page.getByLabel('Correo').fill('alguien@ejemplo.com'); await page.getByLabel('Contraseña').fill('x');
    await btn('Iniciar sesión').click(); await see(/No se pudo iniciar sesión/);
    await page.getByLabel('Contraseña').fill('');
    return { captura: await shot('error-acceso') };
  });
  await step('organizacion', async () => {
    await page.getByLabel('Correo').fill('tecnico@vista-previa.invalid'); await page.getByLabel('Contraseña').fill('x');
    await btn('Iniciar sesión').click(); await see(/Elige la organización/);
    return { captura: await shot('organizacion') };
  });
  await step('inicio-vacio', async () => { await btn('VISTA PREVIA').click(); await see(/Mi jornada/); return { captura: await shot('inicio-sin-parcelas') }; });
  await step('parcelas', async () => {
    await btn('Descargar datos asignados').click(); await see(/parcela\(s\) autorizadas descargadas/);
    return { captura: await shot('parcelas-descargadas') };
  });
  await step('captura', async () => {
    await btn('Nueva captura').click(); await see(/Elige la parcela/); const s1 = await shot('elegir-parcela');
    await btn('VP-PAR-001').click(); await see(/Captura · VP-PAR-001/);
    await btn('Usar ubicación de prueba').click(); await see(/Lat /);
    return { captura: s1, captura_ubicacion: await shot('captura-ubicacion') };
  });
  await step('fotos', async () => {
    await btn('Usar foto de prueba').click(); await see(/Archivo procesado por la app/);
    await page.getByLabel('Observación de campo').fill('Nota sintética de la vista previa con texto largo para revisar el ajuste de líneas en pantallas estrechas.');
    return { captura: await shot('captura-foto-nota') };
  });
  await step('pendientes', async () => { await btn('Guardar en cola').click(); await see(/Pendientes/); return { captura: await shot('pendientes-en-cola') }; });
  await step('sincronizacion-sin-conexion', async () => {
    await page.getByRole('tab', { name: 'Diagnóstico' }).click(); await btn('Sin conexión').click();
    await page.getByRole('tab', { name: 'Inicio' }).click(); await btn('Sincronizar ahora').click(); await see(/Sincronización detenida/);
    return { captura: await shot('sync-sin-conexion') };
  });
  await step('sincronizacion-simulada', async () => {
    await page.getByRole('tab', { name: 'Diagnóstico' }).click(); await btn('Normal').click();
    await page.getByRole('tab', { name: 'Inicio' }).click(); await btn('Sincronizar ahora').click(); await see(/SIMULADA: nada se envió/);
    return { captura: await shot('sync-simulada') };
  });
  await step('conflicto', async () => {
    await page.getByRole('tab', { name: 'Diagnóstico' }).click(); await btn('Próxima muestra en conflicto').click();
    await page.getByRole('tab', { name: 'Inicio' }).click(); await btn('Nueva captura').click(); await btn('VP-PAR-002').click();
    await btn('Usar ubicación de prueba').click(); await see(/Lat /); await btn('Guardar en cola').click(); await see(/Pendientes/);
    await page.getByRole('tab', { name: 'Inicio' }).click(); await btn('Sincronizar ahora').click(); await see(/en conflicto/);
    await page.getByRole('tab', { name: 'Pendientes' }).click(); await see(/VERSION_CONFLICT/);
    const s1 = await shot('conflicto');
    await btn('Reenviar sobre la versión actual').click(); await see(/resuelta con otra operación/);
    return { captura: s1, captura_resuelto: await shot('conflicto-resuelto-pendiente-envio') };
  });
  await step('almacenamiento-lleno', async () => {
    await page.getByRole('tab', { name: 'Diagnóstico' }).click(); await btn('Simular almacenamiento lleno').click();
    await page.getByRole('tab', { name: 'Inicio' }).click(); await btn('Nueva captura').click(); await btn('VP-PAR-003').click();
    await btn('Usar foto de prueba').click(); await see(/menos de 5 MB libres|No hay espacio/);
    const s1 = await shot('almacenamiento-lleno');
    await page.getByRole('tab', { name: 'Diagnóstico' }).click(); await btn('Restablecer espacio libre').click();
    return { captura: s1 };
  });
  await step('dispositivo-revocado', async () => {
    await page.getByRole('tab', { name: 'Diagnóstico' }).click(); await btn('Dispositivo revocado').click();
    await page.getByRole('tab', { name: 'Inicio' }).click(); await btn('Sincronizar ahora').click(); await see(/fue revocado/);
    const s1 = await shot('dispositivo-revocado');
    await page.getByRole('tab', { name: 'Diagnóstico' }).click(); await btn('Normal').click();
    return { captura: s1 };
  });
  await step('diagnostico', async () => { await page.getByRole('tab', { name: 'Diagnóstico' }).click(); await see(/Protección local/); return { captura: await shot('diagnostico') }; });
  await step('autoprueba-no-aplica', async () => { await btn('Ejecutar autoprueba').click(); await see(/no_aplica_en_web/); return { captura: await shot('autoprueba-no-aplica') }; });
  await step('sesion-vencida', async () => {
    await btn('Simular sesión vencida').click(); await page.waitForLoadState('load');
    await btn('VISTA PREVIA').click().catch(() => undefined); await see(/Captura bloqueada/);
    return { captura: await shot('sesion-vencida') };
  });
  await ctx.close();
}

await run({ width: 390, height: 844 }, 'm390');
await run({ width: 1280, height: 800 }, 'escritorio');
await browser.close();
const out = { url: URL_, fecha: new Date().toISOString(), ambito: 'Vista previa web de la app móvil: servidor SIMULADO, datos sintéticos, sin cifrado. No acredita Android ni el ensayo físico.', resultados: results, errores_consola: consoleErrors };
writeFileSync(join(OUT, 'revision.json'), `${JSON.stringify(out, null, 2)}\n`);
for (const r of results) console.log(`${r.ok ? 'OK   ' : 'FALLA'} ${r.tag} ${r.paso}${r.error ? ` — ${r.error}` : ''}${r.desborde_px > 0 ? ` (desborde ${r.desborde_px}px)` : ''}`);
console.log(`errores de consola: ${consoleErrors.length}`); for (const e of consoleErrors.slice(0, 10)) console.log(' ·', e.tag, e.text);
