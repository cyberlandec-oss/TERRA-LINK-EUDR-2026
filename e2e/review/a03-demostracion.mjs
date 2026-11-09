// A-03 — Demostración en el despliegue del ALCANCE TÉCNICO AUTORIZADO del traspaso de custodia: vínculo → oferta y reserva → aceptación → salida BLOQUEADA
// → cancelación con liberación de la reserva, con los rechazos por lado y organización.
//
//   node e2e/review/a03-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Sobre el DEMO ya existente (sintético): emisora = admin.cooperativa (Río Verde), receptora = admin.exportadora (Exportadora), tercera ajena =
// comprador.importador (Chocolates Europa). Lee CREDENCIALES.csv con la utilidad segura; no imprime contraseñas.
//
// QUÉ NO DEMUESTRA (a propósito): la salida real está bloqueada (D4 no adoptada, D-34 sin resolver), así que este despliegue NO llega a «en tránsito».
// Las transiciones de tránsito, recepción parcial, faltante, sobrante, rechazo en tránsito, devolución y cierre se demuestran en las pruebas de integración
// (PostgreSQL real, compuerta sustituida solo con jest.spyOn) y en el E2E aislado (base terra_link_e2e, fixture SQL rotulado); no se tocan los datos del despliegue.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'a03-demostracion-2026-10-21');
mkdirSync(SALIDA, { recursive: true });
const resultados = [];
async function caso(titulo, fn) {
  try { const [ok, detalle] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(100)} ${detalle ?? ''}`); resultados.push({ titulo, ok, detalle }); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(100)} ${String(e.message).slice(0, 240)}`); resultados.push({ titulo, ok: false, detalle: String(e.message).slice(0, 240) }); }
}
const pedir = async (t, m, p, body) => { const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); let b = null; try { b = await r.json(); } catch { /* sin cuerpo */ } return { s: r.status, b }; };
const login = async (cta) => { const c = cuentaDemo(cta); return { token: (await (await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) })).json()).access_token, email: c.email }; };
const sesion = async (browser, token, lang = 'es', viewport) => { const ctx = await browser.newContext(viewport ? { viewport } : {}); await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, lang]); const page = await ctx.newPage(); return { ctx, page }; };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);

const adm = await login('admin.cooperativa'); const exp = await login('admin.exportadora'); const tec = await login('tecnico1.cooperativa'); const aje = await login('comprador.importador');
const orgE = lista((await pedir(adm.token, 'GET', '/api/v1/organizations')).b).find((o) => o.name.includes('Río Verde'));
const orgR = lista((await pedir(exp.token, 'GET', '/api/v1/organizations')).b)[0];
const orgX = lista((await pedir(aje.token, 'GET', '/api/v1/organizations')).b)[0];
const E = `/api/v1/organizations/${orgE.id}`; const R = `/api/v1/organizations/${orgR.id}`; const X = `/api/v1/organizations/${orgX.id}`;
console.log(`\n== A-03 · emisora ${orgE.name} · receptora ${orgR.name} ==\n`);

// Preparación mínima de la receptora (solo si falta): un producto en KG y un centro. Es dato de demostración sintético de la propia organización.
const productosR = lista((await pedir(exp.token, 'GET', `${R}/products?limit=100`)).b).filter((p) => (p.unit?.code ?? p.unit) === 'KG' && p.status !== 'INACTIVE');
let productoR = productosR[0]?.id;
if (!productoR) productoR = (await pedir(exp.token, 'POST', `${R}/products`, { code: 'CACAO_CUSTODIA', name: 'Cacao recibido en custodia', product_state: 'CACAO_BABA', unit: 'KG' })).b?.id;
let centrosR = lista((await pedir(exp.token, 'GET', `${R}/locations`)).b).filter((l) => l.status !== 'INACTIVE');
if (!centrosR.length) { await pedir(exp.token, 'POST', `${R}/locations`, { code: 'EXP-CUST', name: 'Recepción de custodia', location_type: 'WAREHOUSE' }); centrosR = lista((await pedir(exp.token, 'GET', `${R}/locations`)).b); }
const centroR = centrosR[0].id;

const browser = await chromium.launch();
let pid = null; let traspaso = null; let codigoTraspaso = null; let stock = null;
const nivel = async (lotId) => (await pedir(adm.token, 'GET', `${E}/lots/${lotId}`)).b.quantities;

await caso('1 Vínculo: la emisora propone (código visible una sola vez) y la receptora lo confirma desde su pantalla', async () => {
  const previo = (await pedir(adm.token, 'GET', `${E}/partnerships`)).b.items.find((p) => p.status === 'ACTIVE' && p.counterpart_name === orgR.name);
  if (previo) { pid = previo.id; return [true, 'ya existía un vínculo activo con la receptora (se reutiliza)']; }
  const a = await sesion(browser, adm.token); await a.page.goto(`${WEB}/organizaciones/${orgE.id}/traspasos`);
  await a.page.getByRole('heading', { name: 'Traspasos', level: 1 }).waitFor();
  await a.page.getByRole('button', { name: 'Proponer un vínculo nuevo' }).click();
  const codigo = (await a.page.getByLabel('Código del vínculo').innerText()).trim();
  await a.page.screenshot({ path: join(SALIDA, '1-vinculo-propuesto.png'), fullPage: true });
  await a.page.reload();
  const oculto = (await a.page.getByLabel('Código del vínculo').count()) === 0;
  await a.ctx.close();
  const b = await sesion(browser, exp.token); await b.page.goto(`${WEB}/organizaciones/${orgR.id}/traspasos`);
  await b.page.getByLabel('Código recibido de la otra organización').fill(codigo);
  await b.page.getByRole('button', { name: 'Confirmar vínculo' }).click();
  await b.page.getByText('Vínculo confirmado: ya pueden traspasarse custodia entre sí.').waitFor({ timeout: 15000 });
  await b.page.screenshot({ path: join(SALIDA, '1-vinculo-confirmado.png'), fullPage: true });
  await b.ctx.close();
  pid = (await pedir(adm.token, 'GET', `${E}/partnerships`)).b.items.find((p) => p.status === 'ACTIVE' && p.counterpart_name === orgR.name)?.id;
  return [!!pid && oculto && /^[0-9A-F]{12}$/.test(codigo), `vínculo activo=${!!pid}, código no se vuelve a mostrar=${oculto}`];
});

await caso('2 Oferta: revisar NO reserva; confirmar reserva en el libro de la emisora y la existencia física no se mueve', async () => {
  const op = (await pedir(adm.token, 'GET', `${E}/custody-transfers/options`)).b;
  stock = op.stock.find((s) => Number(s.available) >= 10);
  if (!stock) throw new Error('No hay un lote con al menos 10 kg disponibles en la emisora');
  const antes = await nivel(stock.lot_id);
  const a = await sesion(browser, adm.token); await a.page.goto(`${WEB}/organizaciones/${orgE.id}/traspasos`);
  await a.page.getByLabel('Organización receptora').selectOption({ label: orgR.name });
  await a.page.getByLabel('Lote y centro de salida').selectOption(`${stock.lot_id}|${stock.location_id}`);
  await a.page.getByLabel('Cantidad (kg)').fill(String(Number(stock.available) + 1));
  const excede = await a.page.getByText('La cantidad supera lo disponible en ese centro.').isVisible();
  await a.page.getByLabel('Cantidad (kg)').fill('10');
  await a.page.getByLabel('Nota para la otra organización (opcional)').fill('Demostración A-03 (traspaso de ensayo)');
  await a.page.getByRole('button', { name: 'Revisar antes de ofrecer' }).click();
  await a.page.getByText('Revisa antes de ofrecer (todavía no se reservó nada)').waitFor();
  const trasRevisar = await nivel(stock.lot_id);
  await a.page.getByRole('button', { name: 'Confirmar y ofrecer' }).click();
  await a.page.getByText(/Traspaso ofrecido y cantidad reservada/).waitFor({ timeout: 15000 });
  await a.page.screenshot({ path: join(SALIDA, '2-oferta.png'), fullPage: true });
  const fila = a.page.getByRole('table', { name: 'Traspasos' }).locator('tbody tr').first();
  codigoTraspaso = (await fila.getByRole('link').innerText()).trim();
  await a.ctx.close();
  traspaso = (await pedir(adm.token, 'GET', `${E}/custody-transfers`)).b.items.find((x) => x.code === codigoTraspaso).id;
  const despues = await nivel(stock.lot_id);
  const dif = (a1, b1) => (Number(a1) - Number(b1)).toFixed(3);
  const ok = excede && trasRevisar.reserved === antes.reserved && dif(despues.reserved, antes.reserved) === '10.000' && despues.physical === antes.physical;
  return [ok, `${codigoTraspaso}: reservado ${antes.reserved}→${despues.reserved} kg; físico ${antes.physical}→${despues.physical} (sin cambio); revisar no reservó=${trasRevisar.reserved === antes.reserved}`];
});

await caso('3 Aceptación por la receptora: ve la instantánea técnica del origen, NO los centros ni el inventario de la emisora; aceptar no recibe nada', async () => {
  const r = await sesion(browser, exp.token); await r.page.goto(`${WEB}/organizaciones/${orgR.id}/traspasos/${traspaso}`);
  await r.page.getByRole('heading', { name: `Traspaso ${codigoTraspaso}`, level: 1 }).waitFor();
  const proy = await r.page.getByRole('region', { name: 'Instantánea técnica del origen declarado' }).innerText();
  const cuerpo = await r.page.locator('main').innerText();
  await r.page.getByRole('button', { name: 'Aceptar la oferta' }).click();
  await r.page.getByLabel('Producto (en KG)').selectOption(productoR);
  await r.page.getByLabel('Centro de recepción').selectOption(centroR);
  await r.page.getByRole('button', { name: 'Confirmar' }).click();
  await r.page.getByRole('row', { name: /^Recibida/ }).waitFor({ timeout: 15000 });
  const recibida = await r.page.getByRole('row', { name: /^Recibida/ }).innerText();
  await r.page.screenshot({ path: join(SALIDA, '3-aceptacion-receptora.png'), fullPage: true });
  await r.ctx.close();
  const d = (await pedir(exp.token, 'GET', `${R}/custody-transfers/${traspaso}`)).b;
  const sinCentro = !cuerpo.includes(stock.location_code);
  const lotesR = lista((await pedir(exp.token, 'GET', `${R}/lots?limit=200`)).b).filter((l) => l.source === 'CUSTODY_TRANSFER').length;
  return [d.status === 'ACCEPTED' && /0 kg/.test(recibida) && sinCentro && /Huella/.test(proy), `estado=${d.status}, recibida=${recibida.replace(/\s+/g, ' ').slice(0, 40)}, centro de la emisora oculto=${sinCentro}, lotes de custodia en la receptora=${lotesR} (esperado 0 hasta recibir)`];
});

await caso('4 Salida: la compuerta real BLOQUEA; la pantalla lo explica, el servidor responde TRANSFER_DISPATCH_BLOCKED y nada se mueve; no hay bypass', async () => {
  const antes = await nivel(stock.lot_id);
  const a = await sesion(browser, adm.token); await a.page.goto(`${WEB}/organizaciones/${orgE.id}/traspasos/${traspaso}`);
  const comp = a.page.getByRole('region', { name: 'Comprobaciones para registrar la salida' });
  await comp.waitFor();
  const bloquea = await comp.getByText('Bloquea', { exact: true }).isVisible();
  await a.page.getByRole('button', { name: 'Registrar la salida' }).click();
  await a.page.getByRole('button', { name: 'Confirmar' }).click();
  await a.page.getByText(/La salida no cumple las condiciones/).first().waitFor({ timeout: 15000 });
  await a.page.screenshot({ path: join(SALIDA, '4-salida-bloqueada.png'), fullPage: true });
  await a.ctx.close();
  const v = (await pedir(adm.token, 'GET', `${E}/custody-transfers/${traspaso}`)).b.version;
  const api = await pedir(adm.token, 'POST', `${E}/custody-transfers/${traspaso}/dispatch`, { operation_id: randomUUID(), expected_version: v });
  const bypass = await pedir(adm.token, 'POST', `${E}/custody-transfers/${traspaso}/dispatch`, { operation_id: randomUUID(), expected_version: v, skip_gate: true });
  const despues = await nivel(stock.lot_id);
  return [bloquea && api.s === 409 && api.b?.error?.code === 'TRANSFER_DISPATCH_BLOCKED' && bypass.s === 400 && despues.physical === antes.physical && despues.reserved === antes.reserved,
    `pantalla bloquea=${bloquea}; API=${api.s} ${api.b?.error?.code}; con bandera de omisión=${bypass.s}; físico ${antes.physical}→${despues.physical}, reservado ${antes.reserved}→${despues.reserved}`];
});

await caso('5 Rechazos: sin permiso no hay menú ni acceso; una cuenta de otra organización sin permiso recibe 403 en la suya y 404 en la ruta de la emisora (el 404 de un administrador de una tercera organización lo acreditan integración y E2E); cada lado solo actúa en el suyo; controles autorizados', async () => {
  const t = await sesion(browser, tec.token); await t.page.goto(`${WEB}/organizaciones/${orgE.id}/traspasos`);
  const denegado = await t.page.getByText('No tienes permiso para consultar traspasos.').waitFor({ timeout: 10000 }).then(() => true, () => false);
  const menuT = await t.page.getByRole('link', { name: 'Traspasos', exact: true }).count();
  await t.ctx.close();
  const v = (await pedir(adm.token, 'GET', `${E}/custody-transfers/${traspaso}`)).b.version;
  const tercero = await pedir(aje.token, 'GET', `${X}/custody-transfers/${traspaso}`);
  const terceroPorA = await pedir(aje.token, 'GET', `${E}/custody-transfers/${traspaso}`);
  const tecApi = await pedir(tec.token, 'GET', `${E}/custody-transfers`);
  const ladoMalo = await pedir(adm.token, 'POST', `${E}/custody-transfers/${traspaso}/receive`, { operation_id: randomUUID(), expected_version: 1, quantity: '1' });
  const ladoMalo2 = await pedir(exp.token, 'POST', `${R}/custody-transfers/${traspaso}/cancel`, { operation_id: randomUUID(), expected_version: v, reason: 'La receptora no cancela' });
  const ctrlE = await pedir(adm.token, 'GET', `${E}/custody-transfers/${traspaso}`); const ctrlR = await pedir(exp.token, 'GET', `${R}/custody-transfers/${traspaso}`);
  const sinFuga = !JSON.stringify(ctrlR.b).includes(stock.location_code) && !JSON.stringify(ctrlE.b).includes(productoR);
  return [denegado && menuT === 0 && tecApi.s === 403 && tercero.s === 403 && terceroPorA.s === 404 && ladoMalo.s === 403 && ladoMalo2.s === 403 && ctrlE.s === 200 && ctrlR.s === 200 && sinFuga,
    `técnico: pantalla=${denegado}, menú=${menuT}, API=${tecApi.s} · tercera: ${tercero.s}/${terceroPorA.s} · lado equivocado: ${ladoMalo.s}/${ladoMalo2.s} · controles: ${ctrlE.s}/${ctrlR.s} · sin fuga=${sinFuga}`];
});

await caso('6 Cancelación por la emisora antes de la salida: libera la reserva y deja la historia; la existencia queda como estaba', async () => {
  const antes = await nivel(stock.lot_id);
  const a = await sesion(browser, adm.token); await a.page.goto(`${WEB}/organizaciones/${orgE.id}/traspasos/${traspaso}`);
  await a.page.getByRole('button', { name: 'Cancelar el traspaso' }).click();
  await a.page.getByLabel('Motivo', { exact: true }).fill('Fin de la demostración A-03');
  await a.page.getByRole('button', { name: 'Confirmar' }).click();
  await a.page.getByText('Este traspaso no admite más acciones.').waitFor({ timeout: 15000 });
  const historia = await a.page.getByRole('region', { name: /Historia/ }).innerText();
  await a.page.screenshot({ path: join(SALIDA, '6-cancelado.png'), fullPage: true });
  await a.ctx.close();
  const despues = await nivel(stock.lot_id);
  const d = (await pedir(adm.token, 'GET', `${E}/custody-transfers/${traspaso}`)).b;
  const conc = (await pedir(adm.token, 'GET', `${E}/inventory/reconciliation`)).b;
  return [d.status === 'CANCELLED' && Number(antes.reserved) - Number(despues.reserved) === 10 && /Oferta y reserva/.test(historia) && /Cancelación/.test(historia) && conc.consistent === true,
    `estado=${d.status}; reservado ${antes.reserved}→${despues.reserved}; conciliación del ledger de la emisora consistente=${conc.consistent}`];
});

await caso('7 Inglés, teclado y 390 px: la lista y el detalle, sin desborde y sin códigos internos', async () => {
  const a = await sesion(browser, adm.token, 'en', { width: 390, height: 844 }); await a.page.goto(`${WEB}/organizaciones/${orgE.id}/traspasos/${traspaso}`);
  await a.page.getByRole('heading', { name: `Transfer ${codigoTraspaso}`, level: 1 }).waitFor();
  const cuerpo = await a.page.locator('main').innerText();
  const interno = /\b(IN_TRANSIT|WITH_DISCREPANCY|LOSS_CONFIRMED|SHORTAGE|OVERAGE|WITH_DIFFERENCES|OFFERED|CANCELLED)\b/.test(cuerpo);
  const desborde1 = await a.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await a.page.screenshot({ path: join(SALIDA, '7-detalle-en-390.png'), fullPage: true });
  await a.page.goto(`${WEB}/organizaciones/${orgE.id}/traspasos`);
  await a.page.getByRole('heading', { name: 'Transfers', level: 1 }).waitFor();
  const boton = a.page.getByRole('button', { name: 'Propose a new link' });
  await boton.focus(); const enfocado = await boton.evaluate((el) => el === document.activeElement);
  const desborde2 = await a.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await a.page.screenshot({ path: join(SALIDA, '7-lista-en-390.png'), fullPage: true });
  await a.ctx.close();
  return [!interno && !desborde1 && !desborde2 && enfocado, `códigos internos=${interno}; desborde detalle=${desborde1}, lista=${desborde2}; foco por teclado=${enfocado}`];
});

await browser.close();
const ok = resultados.filter((r) => r.ok).length;
writeFileSync(join(SALIDA, 'resultado.json'), JSON.stringify({ fecha: new Date().toISOString(), traspaso: codigoTraspaso, resultados }, null, 2));
console.log(`\nA-03 · demostración en el despliegue: ${ok}/${resultados.length}`);
process.exit(ok === resultados.length ? 0 : 1);
