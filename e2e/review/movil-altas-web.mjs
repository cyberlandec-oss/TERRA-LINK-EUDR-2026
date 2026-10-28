// Revisión VISUAL de la pantalla «Altas» de la app móvil en la vista previa web (http://localhost:3001; `npm run web:preview --prefix apps/mobile`).
// Servidor SIMULADO y datos sintéticos (cuentas @vista-previa.invalid): el prefijo del correo elige los permisos. No prueba Android, cifrado ni cámara.
//   tecnico@  → sin permisos de alta (la pantalla lo dice, no pide descargar nada)
//   jefe@     → productor, parcela y entrega
//   productor@→ solo parcela propia
// Recorre: vacíos, productor autorizado SIN parcelas → primera parcela offline, productor rechazado → corrección → recuperación de dependientes,
// entrega rechazada (corregible y de intervención externa). Capturas: docs/qa/capturas/movil-altas/ · resultado: docs/qa/movil-web/altas.json
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const URL_ = process.env.TL_PREVIEW_URL ?? 'http://localhost:3001';
const SHOTS = join(ROOT, 'docs/qa/capturas/movil-altas');
mkdirSync(SHOTS, { recursive: true }); mkdirSync(join(ROOT, 'docs/qa/movil-web'), { recursive: true });
const results = []; const consoleErrors = []; let n = 0;
const browser = await chromium.launch();

async function sesion(email, tag) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 2600 }, locale: 'es-EC' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ tag, text: m.text().slice(0, 300) }); });
  page.on('pageerror', (e) => consoleErrors.push({ tag, text: `pageerror: ${e.message.slice(0, 300)}` }));
  const btn = (name) => page.getByRole('button', { name, exact: false }).first();
  const tab = (name) => page.getByRole('tab', { name }).click();
  const see = (re) => page.getByText(re).first().waitFor({ timeout: 15000 });
  const shot = async (name) => { n += 1; const f = `${String(n).padStart(2, '0')}-${tag}-${name}.png`; await page.screenshot({ path: join(SHOTS, f), fullPage: true }); return `docs/qa/capturas/movil-altas/${f}`; };
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const step = async (name, fn) => {
    try { const d = await fn(); const ov = await overflow(); results.push({ tag, paso: name, ok: ov <= 0, desborde_px: ov, ...d }); }
    catch (e) { results.push({ tag, paso: name, ok: false, error: String(e.message).slice(0, 300), captura: await shot(`fallo-${name}`).catch(() => null) }); }
  };
  await page.goto(URL_);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('tlprev.')) localStorage.removeItem(k); });
  await page.reload();
  await page.getByLabel('Correo').fill(email); await page.getByLabel('Contraseña').fill('x'); await btn('Iniciar sesión').click();
  await see(/Elige la organización/); await btn('VISTA PREVIA').click(); await see(/Mi jornada/);
  await btn('Descargar datos asignados').click(); await see(/parcela\(s\) autorizadas descargadas/);
  await tab('Altas'); await see(/Altas sin conexión/);
  return { page, btn, see, shot, step, ctx, tab };
}

// ── 1. Técnico sin permisos de alta ─────────────────────────────────────────────────────────────────────────────
{
  const { page, step, shot, ctx } = await sesion('tecnico@vista-previa.invalid', 'tecnico');
  await step('sin-permisos', async () => {
    await page.getByText(/Tu rol no registra altas/).waitFor();
    const forms = await page.getByText(/Nuevo productor|Nueva parcela|Nueva entrega/).count();
    const catalogo = await page.getByText(/Falta el catálogo/).count();
    return { formularios_visibles: forms, aviso_catalogo: catalogo, ok_esperado: forms === 0 && catalogo === 0, captura: await shot('altas-sin-permisos') };
  });
  await ctx.close();
}

// ── 2. Productor autorizado sin parcelas → primera parcela y entrega ─────────────────────────────────────────────
{
  const { page, btn, see, shot, step, ctx, tab } = await sesion('jefe@vista-previa.invalid', 'jefe');
  await step('vacio-con-permisos', async () => ({ captura: await shot('altas-vacio') }));
  await step('productor-sin-parcelas-visible', async () => {
    await see(/VP-PR-SIN · Productor sin parcelas/);
    await btn('VP-PR-SIN').click();
    return { captura: await shot('productor-sin-parcelas-elegido') };
  });
  await step('primera-parcela-offline', async () => {
    await page.getByLabel('Código de la parcela').fill('PRIMERA-01');
    await btn('Guardar parcela como borrador local').click(); await see(/Parcela guardada como borrador local/);
    await btn('Poner el alta en cola').first().click(); await see(/Alta de la parcela en cola/);
    return { captura: await shot('primera-parcela-en-cola') };
  });
  await step('entrega-sin-parcelas-del-servidor', async () => {
    await see(/Este productor aún no tiene parcelas disponibles|Parcelas de origen del productor elegido/);
    return { captura: await shot('entrega-formulario') };
  });
  // Productor nuevo con código repetido → rechazo → corrección
  await step('productor-rechazado', async () => {
    await page.getByLabel('Código del productor').fill('DUP-1'); await page.getByLabel('Nombre', { exact: true }).fill('Eva'); await page.getByLabel('Apellido', { exact: true }).fill('Zambrano');
    await btn('Guardar productor como borrador local').click(); await see(/Productor guardado como borrador local/);
    await btn('Poner el alta en cola').first().click();
    await btn('Nuevo: DUP-1').click();
    await page.getByLabel('Código de la parcela').fill('DEP-1'); await btn('Guardar parcela como borrador local').click();
    await page.getByRole('button', { name: 'Poner el alta en cola' }).last().click();
    await tab('Inicio'); await see(/Sincronizar ahora/);
    await btn('Sincronizar ahora').click(); await see(/Sincronización terminada/);
    await tab('Altas'); await see(/Altas sin conexión/);
    await see(/Puedes corregirlo/);
    return { captura: await shot('productor-rechazado') };
  });
  await step('productor-corregido', async () => {
    await page.getByLabel(/Corregir: código del productor/).fill('EVA-1');
    await btn('Corregir y reenviar').first().click(); await see(/Corrección en cola/);
    await tab('Inicio'); await btn('Sincronizar ahora').click(); await see(/Sincronización terminada/);
    await tab('Altas'); await see(/Altas sin conexión/);
    const reg = await page.getByText(/Registrado en el servidor/).count();
    return { registrados: reg, ok_esperado: reg >= 3, captura: await shot('productor-recuperado') };
  });
  // Entrega rechazada corregible
  await step('entrega-rechazada-corregible', async () => {
    await btn('EVA-1').click();
    await page.getByRole('button', { name: /Producto: CACAO_BABA/ }).click(); await page.getByRole('button', { name: /Centro: CA-VP-01/ }).click();
    await page.getByLabel('Cantidad declarada (KG)').fill('999');
    await page.getByRole('button', { name: /DEP-1/ }).last().click();
    await btn('Guardar entrega como borrador local').click(); await see(/Entrega guardada como borrador local/);
    await btn('Poner la declaración en cola').click();
    await tab('Inicio'); await btn('Sincronizar ahora').click(); await see(/Sincronización terminada/);
    await tab('Altas'); await see(/ORIGIN_QUANTITY_EXCEEDS/);
    return { captura: await shot('entrega-rechazada-corregible') };
  });
  await step('entrega-rechazada-externa', async () => {
    await btn('EVA-1').click(); // (al cambiar de pestaña el formulario se reinicia)
    await page.getByRole('button', { name: /Producto: CACAO_BABA/ }).click(); await page.getByRole('button', { name: /Centro: CA-VP-01/ }).click();
    await page.getByRole('button', { name: /DEP-1/ }).last().click();
    await page.getByLabel('Cantidad declarada (KG)').fill('777');
    await btn('Guardar entrega como borrador local').click();
    await page.getByRole('button', { name: 'Poner la declaración en cola' }).first().click();
    await tab('Inicio'); await btn('Sincronizar ahora').click(); await see(/Sincronización terminada/);
    await tab('Altas'); await see(/Requiere una intervención externa/);
    return { captura: await shot('entrega-rechazada-externa') };
  });
  await ctx.close();
}

// ── 3. Productor: solo parcela propia ───────────────────────────────────────────────────────────────────────────
{
  const { page, step, shot, ctx } = await sesion('productor@vista-previa.invalid', 'productor');
  await step('solo-parcela', async () => {
    const prod = await page.getByText('Nuevo productor').count(); const ent = await page.getByText('Nueva entrega').count(); const par = await page.getByText('Nueva parcela').count();
    return { nuevo_productor: prod, nueva_entrega: ent, nueva_parcela: par, ok_esperado: prod === 0 && ent === 0 && par >= 1, captura: await shot('altas-solo-parcela') };
  });
  await ctx.close();
}

await browser.close();
const ok = results.every((r) => r.ok && r.ok_esperado !== false);
writeFileSync(join(ROOT, 'docs/qa/movil-web/altas.json'), JSON.stringify({ fecha: new Date().toISOString(), url: URL_, resultados: results, errores_de_consola: consoleErrors, ok }, null, 2));
console.log(JSON.stringify(results.map((r) => ({ tag: r.tag, paso: r.paso, ok: r.ok && r.ok_esperado !== false, error: r.error })), null, 1));
console.log('errores de consola:', consoleErrors.length);
process.exit(ok ? 0 : 1);
