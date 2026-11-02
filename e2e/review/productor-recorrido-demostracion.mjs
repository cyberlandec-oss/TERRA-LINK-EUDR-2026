// Recorrido del Productor con la cuenta DEMO vigente vinculada (sin crear usuarios ni cambiar contraseñas; no imprime credenciales ni testigos).
//   node e2e/review/productor-recorrido-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
// Mi finca → parcela propia → Mi ubicación/mapa → polígono → revisión → guardar → volver a consultar → adjuntar foto y documento → rechazo de parcela ajena.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'productor-recorrido-2026-10-30');
mkdirSync(SALIDA, { recursive: true });
const resultados = [];
async function caso(titulo, fn) {
  try { const [ok, detalle] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(100)} ${detalle ?? ''}`); resultados.push({ titulo, ok, detalle }); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(100)} ${String(e.message).slice(0, 260)}`); resultados.push({ titulo, ok: false, detalle: String(e.message).slice(0, 260) }); }
}
const pedir = async (t, m, p, body) => { const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); let b = null; try { b = await r.json(); } catch { /* sin cuerpo */ } return { s: r.status, b }; };
const login = async (l) => { const c = cuentaDemo(l); const r = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) }); const j = await r.json(); if (r.status !== 200) throw new Error('login ' + l); return j.access_token; };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? []);

const prod = await login('productor.cooperativa');
const adm = await login('admin.cooperativa');
const org = lista((await pedir(prod, 'GET', '/api/v1/organizations')).b)[0];
const base = `/api/v1/organizations/${org.id}`;
const propias = () => pedir(prod, 'GET', `${base}/plots?limit=100`);
const versiones = async (plot) => lista((await pedir(prod, 'GET', `${base}/plots/${plot}/geometry-versions`)).b);

let plot = null;
await caso('1. Estado real: versión desplegada, organización activa, permisos efectivos y vínculo cuenta–productor', async () => {
  const v = await (await fetch(API + '/version')).json();
  const perms = (await pedir(prod, 'GET', '/api/v1/me/permissions')).b.organizations.find((o) => o.organization_id === org.id);
  const pr = await pedir(prod, 'GET', `${base}/producers?limit=100`);
  const pl = await propias();
  const sinFacultades = ['plot:evaluate_gis', 'document:review', 'risk:read', 'risk:conclude', 'satellite:request', 'evidence:verify'].every((p) => !perms.permissions.includes(p));
  plot = lista(pl.b)[0];
  return [org.status === 'ACTIVE' && perms.roles.join() === 'PRODUCER' && pr.s === 200 && lista(pr.b).length === 1 && pl.s === 200 && lista(pl.b).length >= 1 && sinFacultades,
    `commit=${v.commit} schema=${v.schema?.applied} · org=${org.status} · rol=${perms.roles} · productores=${lista(pr.b).map((p) => p.producer_code)} · parcelas=${lista(pl.b).length} · sin facultades de decidir=${sinFacultades}`];
});
if (!plot) { console.log('Sin parcela propia: el recorrido web no puede continuar.'); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: -0.8512, longitude: -80.1611, accuracy: 12 } });
await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [prod, 'es']);
const page = await ctx.newPage();
const externas = [];
page.on('request', (r) => { const u = r.url(); if (!/^(http:\/\/localhost|data:|blob:)/.test(u)) externas.push(u); });
const antesVersiones = (await versiones(plot.id)).length;

await caso('2. Mi finca: muestra su productor y su parcela propia, con la acción de ubicarla (o corregirla)', async () => {
  await page.goto(`${WEB}/organizaciones/${org.id}/mi-finca`);
  await page.getByRole('heading', { name: 'Mis parcelas' }).waitFor();
  const t = await page.locator('main').innerText();
  await page.screenshot({ path: join(SALIDA, '01-mi-finca.png'), fullPage: true });
  return [t.includes('DEMO-RV-010') && t.includes(plot.plot_code) && /Ubicar la parcela|Ver o corregir la ubicación/.test(t), `ve ${plot.plot_code}`];
});

await caso('3. Mi ubicación + mapa + polígono: vértice 1 desde «Mi ubicación», otros por la mira; REVISAR no guarda nada; guardar crea la versión', async () => {
  await page.getByRole('link', { name: new RegExp(plot.plot_code) }).first().click();
  await page.getByRole('button', { name: /Escribir o dibujar/ }).click();
  await page.getByRole('radio', { name: /Un polígono/ }).check();
  await page.getByRole('button', { name: /Dibujar en el mapa/ }).click();
  await page.locator('.maplibregl-canvas').waitFor({ timeout: 30000 });
  await page.getByText('Cargando el mapa local…').waitFor({ state: 'detached', timeout: 30000 });
  await page.getByRole('button', { name: 'Mi ubicación: centrar el mapa en tu posición actual' }).click();
  await page.getByLabel('Lectura de Mi ubicación').waitFor({ timeout: 20000 });
  const lectura = (await page.getByLabel('Lectura de Mi ubicación').innerText()).replace(/\s+/g, ' ');
  await page.getByRole('button', { name: 'Añadir vértice aquí' }).click();
  const mapa = page.getByRole('application', { name: /Mapa para dibujar la parcela/ });
  for (const [lon, lat] of [['-80.1601', '-0.8512'], ['-80.1601', '-0.8502']]) {
    await page.getByLabel('Ir a longitud').fill(lon); await page.getByLabel('Ir a latitud').fill(lat);
    await page.getByRole('button', { name: 'Centrar el mapa aquí' }).click();
    await page.getByText(new RegExp('longitud ' + lon.replace('.', '\\.'))).waitFor({ timeout: 20000 });
    await mapa.focus(); await page.keyboard.press('Enter');
  }
  const filas = await page.getByRole('table', { name: 'Coordenadas a registrar' }).locator('tbody tr').count();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(SALIDA, '02-mapa-vertices.png'), fullPage: true });
  await page.getByRole('button', { name: 'Revisar antes de guardar' }).click();
  await page.getByText('todavía no se guardó nada').waitFor();
  const trasRevisar = (await versiones(plot.id)).length;
  await page.screenshot({ path: join(SALIDA, '03-revision.png'), fullPage: true });
  // El motivo solo se pide cuando la parcela ya tenía ubicación (versión nueva que reemplaza a otra).
  const motivo = page.getByLabel(/Motivo de la corrección/);
  if (await motivo.count()) await motivo.fill('Trazado con Mi ubicación y el mapa de referencia (demostración del Productor)');
  await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
  await page.getByText(/Ubicación guardada como versión \d+\./).waitFor();
  const v = (await versiones(plot.id))[0];
  return [filas === 3 && trasRevisar === antesVersiones && (await versiones(plot.id)).length === antesVersiones + 1 && /± 12 m/.test(lectura) && externas.length === 0,
    `lectura=${lectura.slice(0, 70)} · vértices=${filas} · versiones antes/tras revisar/tras guardar=${antesVersiones}/${trasRevisar}/${antesVersiones + 1} · método=${v?.survey_method} · solicitudes externas=${externas.length}`];
});

await caso('4. Volver a consultar: la API y la ficha conservan la versión (geometría vigente, método y huella) y Mi finca ofrece «Ver o corregir»', async () => {
  const det = await pedir(prod, 'GET', `${base}/plots/${plot.id}`);
  await page.goto(`${WEB}/organizaciones/${org.id}/parcelas/${plot.id}`);
  await page.getByRole('table', { name: 'Versiones geométricas' }).waitFor();
  const cuerpo = await page.locator('main').innerText();
  await page.screenshot({ path: join(SALIDA, '04-ficha-tras-guardar.png'), fullPage: true });
  await page.goto(`${WEB}/organizaciones/${org.id}/mi-finca`);
  await page.getByRole('heading', { name: 'Mis parcelas' }).waitFor();
  const mf = await page.locator('main').innerText();
  return [det.s === 200 && !!det.b.current_version && /Ver o corregir la ubicación/.test(mf) && !/GPS acreditado/.test(cuerpo), `versión vigente=${det.b.current_version?.version_number} · estado=${det.b.geometry_status}`];
});

await caso('5. Adjuntar una fotografía y un documento a la parcela: quedan recibidos «pendientes de revisión», sin aprobación', async () => {
  await page.goto(`${WEB}/organizaciones/${org.id}/captura`);
  await page.getByLabel('Productor', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Parcela', { exact: true }).selectOption({ index: 1 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 1, 0xff, 0xda, 0, 4, 1, 0, ...Buffer.from('foto-' + randomUUID()), 0xff, 0xd9]);
  await page.getByLabel('Archivo (PDF, JPEG o PNG)').setInputFiles({ name: 'IMG_0001.JPG', mimeType: 'image/jpeg', buffer: jpeg });
  await page.getByLabel('Título', { exact: true }).fill('Foto del lindero (demostración del Productor)');
  await page.getByRole('button', { name: 'Subir evidencia' }).click();
  await page.getByText(/Evidencia recibida/).waitFor({ timeout: 30000 });
  await page.getByLabel('Archivo (PDF, JPEG o PNG)').setInputFiles({ name: 'recorrido.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% demostracion ${randomUUID()}\n%%EOF\n`) });
  await page.getByLabel('Título', { exact: true }).fill('Croquis del recorrido (demostración del Productor)');
  await page.getByRole('button', { name: 'Subir evidencia' }).click();
  await page.getByText(/Evidencia recibida/).waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(SALIDA, '05-evidencias.png'), fullPage: true });
  const docs = lista((await pedir(prod, 'GET', `${base}/documents?owner_type=plot&owner_id=${plot.id}`)).b);
  const mios = docs.filter((d) => /demostración del Productor/.test(d.title));
  const sinAprobar = mios.every((d) => !(d.versions ?? []).some((v) => v.review?.decision === 'APPROVED'));
  return [mios.length >= 2 && sinAprobar, `documentos propios=${mios.length} · ninguno aprobado=${sinAprobar}`];
});

await caso('6. Rechazo de lo ajeno (con control autorizado): parcela y productor de otra persona → 404 en API y en pantalla; revisar documentos → denegado', async () => {
  const ajenaP = lista((await pedir(adm, 'GET', `${base}/plots?limit=100`)).b).find((p) => p.plot_code === 'DEMO-PAR-001');
  const ajenoPr = lista((await pedir(adm, 'GET', `${base}/producers?limit=100&status=ALL`)).b).find((p) => p.producer_code === 'DEMO-RV-001');
  if (!ajenaP || !ajenoPr) throw new Error('faltan las entidades ajenas de control');
  const control = (await pedir(prod, 'GET', `${base}/plots/${plot.id}`)).s;               // propia: 200
  const verAjena = (await pedir(prod, 'GET', `${base}/plots/${ajenaP.id}`)).s;
  const escribirAjena = (await pedir(prod, 'POST', `${base}/plots/${ajenaP.id}/geometry-versions`, { expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.1, -0.9] } })).s;
  const verProd = (await pedir(prod, 'GET', `${base}/producers/${ajenoPr.id}`)).s;
  const satelite = (await pedir(prod, 'GET', `${base}/plots/${ajenaP.id}/satellite`)).s;
  const f = new FormData(); f.append('operation_id', randomUUID()); f.append('document_type', 'FIELD_PHOTO'); f.append('owner_type', 'plot'); f.append('owner_id', ajenaP.id); f.append('title', 'x'); f.append('file', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'x.jpg');
  const subirAjena = (await fetch(`${API}${base}/documents`, { method: 'POST', headers: { authorization: `Bearer ${prod}` }, body: f })).status;
  const mio = lista((await pedir(prod, 'GET', `${base}/documents?owner_type=plot&owner_id=${plot.id}`)).b)[0];
  const revisar = (await pedir(prod, 'POST', `${base}/documents/${mio.id}/versions/${mio.versions[0].id}/reviews`, { decision: 'ACCEPTED', reason: 'intento del Productor' })).s;
  await page.goto(`${WEB}/organizaciones/${org.id}/parcelas/${ajenaP.id}`);
  await page.waitForLoadState('networkidle');
  const t = await page.locator('main').innerText();
  await page.screenshot({ path: join(SALIDA, '06-parcela-ajena.png'), fullPage: true });
  const sinDatos = !t.includes('DEMO-PAR-001') && !t.includes('Lote del río');
  return [control === 200 && verAjena === 404 && escribirAjena === 404 && verProd === 404 && (satelite === 404 || satelite === 403) && subirAjena === 404 && revisar === 403 && sinDatos,
    `propia=${control} · ajena ver/escribir/subir/satélite=${verAjena}/${escribirAjena}/${subirAjena}/${satelite} · productor ajeno=${verProd} · aprobar documento=${revisar} · pantalla sin datos ajenos=${sinDatos}`];
});

await browser.close();
const fallas = resultados.filter((r) => !r.ok).length;
writeFileSync(join(SALIDA, 'resultado.json'), JSON.stringify({ fecha: '2026-10-30', web: WEB, api: API, resultados }, null, 2));
console.log(`\n${resultados.length - fallas}/${resultados.length} comprobaciones OK`);
process.exit(fallas ? 1 : 0);
