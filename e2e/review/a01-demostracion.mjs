// A-01 — Demostración en el despliegue: captura de campo desde la web con alcance propio.
//
//   node e2e/review/a01-demostracion.mjs --fase base      [--web http://localhost:3000] [--base http://localhost:4000]
//   node e2e/review/a01-demostracion.mjs --fase satelite  (requiere SATELLITE_FIXTURE_ENABLED=true en API y worker)
//   node e2e/review/a01-demostracion.mjs --fase cierre    (verifica que el ensayo quedó DESACTIVADO de forma efectiva)
//
// Todo con datos SINTÉTICOS en una organización propia «ENSAYO A-01», sin tocar las cuentas DEMO. Las contraseñas de
// ensayo se generan en memoria; el estado entre fases (correos, contraseñas, identificadores) vive en la carpeta
// temporal del sistema, FUERA del repositorio. No se imprimen contraseñas ni testigos. Capturas en validation-results/.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';
import { exigeEntrada } from './comprobacion.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const FASE = arg('--fase', 'base');
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const ESTADO = join(tmpdir(), 'a01-demo-estado.json');
const SALIDA = join('validation-results', 'a01-demostracion-2026-10-20');
mkdirSync(SALIDA, { recursive: true });

const resultados = [];
async function caso(titulo, fn) {
  try { const [ok, detalle] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(84)} ${detalle ?? ''}`); resultados.push([titulo, ok, detalle ?? '']); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(84)} ${String(e.message).slice(0, 220)}`); resultados.push([titulo, false, String(e.message).slice(0, 220)]); }
}
const pedir = async (token, metodo, path, cuerpo) => {
  const r = await fetch(`${API}${path}`, { method: metodo, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cuerpo ? { 'content-type': 'application/json' } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (email, password) => exigeEntrada(`token de ${email}`, (await pedir(null, 'POST', '/api/v1/auth/login', { email, password })).body?.access_token);
const subirPdf = async (token, org, owner_type, owner_id, bytes, tipo = 'DELIVERY_SUPPORT') => {
  const f = new FormData();
  f.append('operation_id', randomUUID()); f.append('document_type', tipo); f.append('owner_type', owner_type); f.append('owner_id', owner_id); f.append('title', 'Documento de ensayo A-01 (sintético)');
  f.append('file', new Blob([bytes], { type: 'application/pdf' }), 'ensayo.pdf');
  const r = await fetch(`${API}/api/v1/organizations/${org}/documents`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: f });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const pdfConTexto = (lineas) => {
  const c = deflateSync(Buffer.from(lineas.map((l, i) => `BT /F1 12 Tf 72 ${760 - i * 18} Td (${esc(l)}) Tj ET`).join('\n'), 'latin1'));
  return Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n', 'latin1'),
    Buffer.from(`4 0 obj<</Length ${c.length}/Filter/FlateDecode>>stream\n`, 'latin1'), c, Buffer.from('\nendstream\nendobj\ntrailer<</Root 1 0 R/Size 5>>\n%%EOF\n', 'latin1')]);
};
const cuadro = (lon, lat, d = 0.001) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });
const lazo = { type: 'Polygon', coordinates: [[[-80.16, -0.85], [-80.159, -0.849], [-80.159, -0.85], [-80.16, -0.849], [-80.16, -0.85]]] };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
const pass = () => randomBytes(14).toString('base64url') + 'aA1!';
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function sesion(browser, token, lang = 'es', opts = {}) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, lang]);
  return { ctx, page: await ctx.newPage() };
}

// ================================================================ preparación o carga de estado
let E;
if (FASE === 'base') {
  const sup = cuentaDemo('superadmin.revision');
  const superTok = await login(sup.email, sup.contrasena);
  const suf = randomBytes(3).toString('hex');
  const org = (await pedir(superTok, 'POST', '/api/v1/organizations', { name: `ENSAYO A-01 (sintético) ${suf}`, organization_type: 'COOPERATIVE', country: 'EC' })).body;
  const orgB = (await pedir(superTok, 'POST', '/api/v1/organizations', { name: `ENSAYO A-01 otra organización ${suf}`, organization_type: 'COOPERATIVE', country: 'EC' })).body;
  const cuentas = {};
  const alta = async (clave, rol, o, por) => {
    const email = `a01.${clave}.${suf}@ensayo.terralink.local`; const password = pass();
    const inv = (await pedir(por, 'POST', `/api/v1/organizations/${o}/invitations`, { email, role_code: rol })).body;
    await pedir(null, 'POST', '/api/v1/invitations/accept', { token: exigeEntrada('invitación', inv?.token), first_name: 'Ensayo', last_name: clave, password });
    cuentas[clave] = { email, password };
  };
  await alta('admin', 'ORG_ADMIN', org.id, superTok);
  await alta('adminb', 'ORG_ADMIN', orgB.id, superTok);
  const adminTok = await login(cuentas.admin.email, cuentas.admin.password);
  for (const [c, r] of [['tec1', 'FIELD_TECHNICIAN'], ['tec2', 'FIELD_TECHNICIAN'], ['prod1', 'PRODUCER'], ['prod2', 'PRODUCER'], ['prod3', 'PRODUCER'], ['aud', 'AUDITOR'], ['buy', 'BUYER'], ['mgr', 'MANAGER']]) await alta(c, r, org.id, adminTok);
  const base = `/api/v1/organizations/${org.id}`;
  const miembros = lista((await pedir(adminTok, 'GET', `${base}/members`)).body.members ?? (await pedir(adminTok, 'GET', `${base}/members`)).body);
  const mem = (c) => exigeEntrada(`membresía ${c}`, miembros.find((m) => m.email === cuentas[c].email)?.membership_id);
  const productor = async (code, nombre, extra = {}) => exigeEntrada(`productor ${code}`, (await pedir(adminTok, 'POST', `${base}/producers`, { producer_code: code, legal_name: nombre, ...extra })).body?.id);
  const pA = await productor('A01-A', 'Finca A (sintética)');
  const pB = await productor('A01-B', 'Finca B (sintética)');
  const pC = await productor('A01-C', 'Finca C (sintética)', { assigned_membership_id: mem('tec1') });
  const pD = await productor('A01-D', 'Finca D (sintética)', { assigned_membership_id: mem('tec2') });
  const vincular = async (p, c) => { const v = (await pedir(adminTok, 'GET', `${base}/producers/${p}`)).body.row_version; return pedir(adminTok, 'PUT', `${base}/producers/${p}/self-membership`, { expected_version: v, membership_id: mem(c), reason: 'Alta del productor en la plataforma (ensayo A-01)' }); };
  await vincular(pA, 'prod1'); await vincular(pB, 'prod2');
  const parcela = async (p, code) => exigeEntrada(`parcela ${code}`, (await pedir(adminTok, 'POST', `${base}/plots`, { producer_id: p, plot_code: code, crop: 'Cacao' })).body?.id);
  const plotA = await parcela(pA, 'A01-LA'); const plotB = await parcela(pB, 'A01-LB'); const plotC = await parcela(pC, 'A01-LC'); const plotD = await parcela(pD, 'A01-LD');
  E = { suf, org: org.id, orgB: orgB.id, cuentas, pA, pB, pC, pD, plotA, plotB, plotC, plotD };
  writeFileSync(ESTADO, JSON.stringify(E));
} else {
  if (!existsSync(ESTADO)) { console.error('No hay estado de la fase base: ejecuta --fase base primero.'); process.exit(2); }
  E = JSON.parse(readFileSync(ESTADO, 'utf8'));
}
const base = `/api/v1/organizations/${E.org}`;
const tok = {};
for (const c of Object.keys(E.cuentas)) tok[c] = await login(E.cuentas[c].email, E.cuentas[c].password);
const versiones = async (t, plot) => lista((await pedir(t, 'GET', `${base}/plots/${plot}/geometry-versions`)).body);

// ================================================================ FASE BASE
if (FASE === 'base') {
  console.log(`\n== A-01 · fase base · organización ENSAYO ${E.suf} ==\n`);

  // ---- 1) Alcance autorizado, con controles
  await caso('1.1 productor SIN vínculo: no ve parcelas (control: el vinculado ve la suya)', async () => {
    const sin = await pedir(tok.prod3, 'GET', `${base}/plots`); const con = await pedir(tok.prod1, 'GET', `${base}/plots`);
    return [sin.status === 200 && lista(sin.body).length === 0 && con.status === 200 && lista(con.body).map((p) => p.id).join() === E.plotA, `sin vínculo=${lista(sin.body).length}, vinculado=${lista(con.body).length}`];
  });
  await caso('1.2 parcela propia 200 / ajena (otro productor de la MISMA organización) 404, incluso por identificador', async () => {
    const a = await pedir(tok.prod1, 'GET', `${base}/plots/${E.plotA}`); const b = await pedir(tok.prod1, 'GET', `${base}/plots/${E.plotB}`);
    const p = await pedir(tok.prod1, 'GET', `${base}/producers/${E.pB}`);
    return [a.status === 200 && b.status === 404 && p.status === 404, `propia=${a.status} ajena=${b.status} productor ajeno=${p.status}`];
  });
  await caso('1.3 técnico: solo parcelas de productores ASIGNADOS (tec1→C: sí; tec1→D: 404; tec2→D: sí)', async () => {
    const r = [await pedir(tok.tec1, 'GET', `${base}/plots/${E.plotC}`), await pedir(tok.tec1, 'GET', `${base}/plots/${E.plotD}`), await pedir(tok.tec2, 'GET', `${base}/plots/${E.plotD}`), await pedir(tok.tec2, 'GET', `${base}/plots/${E.plotC}`)].map((x) => x.status);
    return [r.join() === '200,404,200,404', r.join('/')];
  });
  await caso('1.4 otra organización: ni la administración ajena ni un productor con el mismo identificador acceden', async () => {
    const x = await pedir(tok.adminb, 'GET', `${base}/plots/${E.plotA}`); const y = await pedir(tok.prod1, 'GET', `/api/v1/organizations/${E.orgB}/plots/${E.plotA}`);
    const ctl = await pedir(tok.admin, 'GET', `${base}/plots/${E.plotA}`);
    return [x.status === 404 && y.status === 404 && ctl.status === 200, `adminB=${x.status} prod1→orgB=${y.status} control admin=${ctl.status}`];
  });
  await caso('1.5 auditor y comprador: sin facultades de captura (control: el auditor SÍ lee)', async () => {
    const g = { geometry: { type: 'Point', coordinates: [-80.1, -0.8] } };
    const r = [await pedir(tok.aud, 'GET', `${base}/plots/${E.plotA}`), await pedir(tok.aud, 'POST', `${base}/plots/${E.plotA}/geometry-preview`, g), await pedir(tok.aud, 'POST', `${base}/plots/${E.plotA}/geometry-versions`, { expected_version: 1, survey_method: 'MANUAL_COORDINATES', ...g }), await pedir(tok.buy, 'GET', `${base}/plots`)].map((x) => x.status);
    return [r.join() === '200,403,403,403', r.join('/')];
  });
  await caso('1.6 gerente: lectura de la organización completa según su rol (control: ve las 4 parcelas)', async () => {
    const r = await pedir(tok.mgr, 'GET', `${base}/plots`);
    return [r.status === 200 && lista(r.body).length === 4, `parcelas visibles=${lista(r.body).length}`];
  });
  await caso('1.7 capturar NO es decidir: el productor no evalúa GIS, no encarga satélite, no ve riesgo ni miembros', async () => {
    const r = [await pedir(tok.prod1, 'POST', `${base}/plots/${E.plotA}/gis-evaluations`, { operation_id: randomUUID() }), await pedir(tok.prod1, 'POST', `${base}/plots/${E.plotA}/satellite/analyses`, { operation_id: randomUUID(), operation: 'FOREST_COVER' }), await pedir(tok.prod1, 'GET', `${base}/risk/lots`), await pedir(tok.prod1, 'GET', `${base}/members`)].map((x) => x.status);
    return [r.every((s) => s === 403), r.join('/')];
  });

  // ---- 2) Documentos y extracción fuera de alcance, también en el reintento idempotente
  const doc = await subirPdf(tok.admin, E.org, 'producer', E.pD, pdfConTexto(['CERTIFICADO DE ENSAYO', 'Emitido por: Registro Sintetico A01', 'Fecha de emision: 2026-03-04']));
  const docId = exigeEntrada('documento D', doc.body?.document?.id); const verId = doc.body.document.versions[0].id;
  const rutaX = `${base}/documents/${docId}/versions/${verId}/extraction`;
  const opX = randomUUID();
  await caso('2.1 control: la administración extrae el documento de D y repite con la MISMA operación (reintento idempotente)', async () => {
    const a = await pedir(tok.admin, 'POST', rutaX, { operation_id: opX }); const b = await pedir(tok.admin, 'POST', rutaX, { operation_id: opX });
    return [a.status === 201 && String(JSON.stringify(b.body)).includes('Registro Sintetico A01') && b.status < 300, `1.ª=${a.status} reintento=${b.status}`];
  });
  await caso('2.2 el reintento idempotente con la operación AJENA no revela el documento (tec1, prod1, prod3: nunca 2xx ni texto)', async () => {
    const out = [];
    for (const q of ['tec1', 'prod1', 'prod3']) {
      for (const [m, body] of [['GET', undefined], ['POST', { operation_id: opX }], ['POST', { operation_id: randomUUID() }]]) {
        const r = await pedir(tok[q], m, rutaX, body);
        if (r.status < 400 || /Registro Sintetico A01|2026-03-04/.test(JSON.stringify(r.body))) out.push(`${q} ${m} ${r.status}`);
      }
    }
    return [out.length === 0, out.length ? `FUGAS: ${out.join('; ')}` : '9 intentos denegados, sin datos del documento'];
  });
  await caso('2.3 el documento de otro productor no se lista, no se abre ni se descarga para el productor vinculado', async () => {
    const l = lista((await pedir(tok.prod1, 'GET', `${base}/documents`)).body).some((d) => d.id === docId);
    const o = await pedir(tok.prod1, 'GET', `${base}/documents/${docId}`);
    const d = await fetch(`${API}${base}/documents/${docId}/versions/${verId}/content`, { headers: { authorization: `Bearer ${tok.prod1}` } });
    return [!l && o.status === 404 && d.status === 404, `en lista=${l} abrir=${o.status} descargar=${d.status}`];
  });

  // ---- 3) Geometría inválida: tres estados distintos, sin eludir reglas por la API directa
  await caso('3.1 versión REGISTRADA (lazo): campos de estado enviados por el cliente se RECHAZAN; sin ellos se guarda y queda marcada no válida', async () => {
    const ruta = `${base}/plots/${E.plotC}`;
    const ev = (await pedir(tok.admin, 'GET', ruta)).body.row_version;
    const falso = await pedir(tok.admin, 'POST', `${ruta}/geometry-versions`, { expected_version: ev, survey_method: 'MANUAL_COORDINATES', geometry: lazo, technically_valid: true, status: 'VALID' });
    const trasFalso = (await versiones(tok.admin, E.plotC)).length;
    const r = await pedir(tok.admin, 'POST', `${ruta}/geometry-versions`, { expected_version: ev, survey_method: 'MANUAL_COORDINATES', geometry: lazo });
    const leida = (await versiones(tok.admin, E.plotC))[0];
    return [falso.status === 400 && trasFalso === 0 && r.status === 201 && r.body?.version?.technically_valid === false && leida?.technically_valid === false,
      `envío con estado forjado=${falso.status} (versiones=${trasFalso}) · lazo limpio=${r.status} · technically_valid=${r.body?.version?.technically_valid} · lectura posterior=${leida?.technically_valid}`];
  });
  await caso('3.2 resultado de VALIDACIÓN GIS: INVALID, y la parcela no pasa el perfil de destino (no exportable)', async () => {
    const g = await pedir(tok.admin, 'POST', `${base}/plots/${E.plotC}/gis-evaluations`, { operation_id: randomUUID() });
    const p = await pedir(tok.admin, 'POST', `${base}/plots/${E.plotC}/geo-profile/evaluations`, { operation_id: randomUUID() });
    const ev = g.body?.evaluation?.status; const exp = p.body?.evaluation?.exportable;
    return [g.status === 201 && ev === 'INVALID' && p.status === 201 && exp === false, `GIS=${ev} · perfil=${p.body?.evaluation?.status} exportable=${exp}`];
  });
  await caso('3.3 geometría UTILIZABLE: solo una versión técnicamente válida y evaluada pasa; la corrección crea versión nueva y el lazo queda en el historial', async () => {
    const ev = (await pedir(tok.admin, 'GET', `${base}/plots/${E.plotC}`)).body.row_version;
    const ok = await pedir(tok.admin, 'POST', `${base}/plots/${E.plotC}/geometry-versions`, { expected_version: ev, survey_method: 'MANUAL_COORDINATES', geometry: cuadro(-80.17, -0.86), reason: 'Corrección del lazo (ensayo A-01)' });
    const g = await pedir(tok.admin, 'POST', `${base}/plots/${E.plotC}/gis-evaluations`, { operation_id: randomUUID() });
    const vs = await versiones(tok.admin, E.plotC);
    return [ok.status === 201 && ['VALID', 'WARNING', 'REVIEW_REQUIRED'].includes(g.body?.evaluation?.status) && vs.length === 2 && vs.some((v) => v.technically_valid === false), `versiones=${vs.length} · GIS vigente=${g.body?.evaluation?.status}`];
  });
  await caso('3.4 estructura inválida por la API directa: rechazada (4xx) y sin versión', async () => {
    const antes = (await versiones(tok.admin, E.plotC)).length;
    const ev = (await pedir(tok.admin, 'GET', `${base}/plots/${E.plotC}`)).body.row_version;
    const r = await pedir(tok.admin, 'POST', `${base}/plots/${E.plotC}/geometry-versions`, { expected_version: ev, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.1, 95] } });
    return [r.status >= 400 && r.status < 500 && (await versiones(tok.admin, E.plotC)).length === antes, `HTTP ${r.status}`];
  });

  // ---- 4) Recorridos web
  const browser = await chromium.launch();
  const ruta = (p) => `${WEB}/organizaciones/${E.org}/${p}`;

  await caso('4.1 WEB productor (es): elige su parcela, escribe coordenadas, REVISA sin guardar, guarda, corrige con motivo, adjunta evidencia', async () => {
    const { ctx, page } = await sesion(browser, tok.prod1);
    await page.goto(ruta('captura'));
    await page.getByRole('heading', { name: 'Captura de campo' }).waitFor();
    const parc = page.getByLabel('Parcela', { exact: true });
    const ajena = await parc.locator('option', { hasText: 'A01-LB' }).count();
    await parc.selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Escribir o dibujar' }).click();
    await page.getByLabel(/Longitud.*vértice 1/).fill('-80.16'); await page.getByLabel(/Latitud.*vértice 1/).fill('-0.85');
    await page.getByRole('button', { name: 'Revisar antes de guardar' }).click();
    await page.getByText('todavía no se guardó nada').waitFor();
    const sinGuardar = (await versiones(tok.prod1, E.plotA)).length;
    await page.screenshot({ path: join(SALIDA, '4.1-revision-es.png'), fullPage: true });
    await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
    await page.getByText('Ubicación guardada como versión 1.').waitFor();
    await page.getByLabel(/Longitud.*vértice 1/).fill('-80.161'); await page.getByLabel(/Latitud.*vértice 1/).fill('-0.851');
    await page.getByRole('button', { name: 'Revisar antes de guardar' }).click();
    const bloqueado = await page.getByRole('button', { name: 'Guardar como nueva versión' }).isDisabled();
    await page.getByLabel(/Motivo de la corrección/).fill('Corrección tras recorrer el lindero');
    await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
    await page.getByText('Ubicación guardada como versión 2.').waitFor();
    await page.getByLabel('Archivo (PDF, JPEG o PNG)').setInputFiles({ name: 'recorrido.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ensayo ${randomBytes(6).toString('hex')}\n%%EOF\n`) });
    await page.getByLabel('Título', { exact: true }).fill('Recorrido (sintético)');
    await page.getByRole('button', { name: 'Subir evidencia' }).click();
    await page.getByText(/Evidencia recibida/).waitFor();
    // Consulta posterior: la ficha muestra las dos versiones, la procedencia y la precisión NO informada.
    await page.goto(ruta(`parcelas/${E.plotA}`));
    await page.getByRole('table', { name: 'Versiones geométricas' }).waitFor();
    const cuerpo = await page.locator('main').innerText();
    await page.screenshot({ path: join(SALIDA, '4.1-ficha-es.png'), fullPage: true });
    const vs = await versiones(tok.prod1, E.plotA);
    await ctx.close();
    return [ajena === 0 && sinGuardar === 0 && bloqueado && vs.length === 2 && /Coordenadas ingresadas|ingresadas/.test(cuerpo) && !/GPS acreditado/.test(cuerpo),
      `parcela ajena en el selector=${ajena} · versiones tras revisar=${sinGuardar} · guardar sin motivo bloqueado=${bloqueado} · versiones finales=${vs.length}`];
  });

  await caso('4.2 WEB técnico asignado (es): croquis con teclado, revisión del servidor, guardado; no ve productores no asignados', async () => {
    const { ctx, page } = await sesion(browser, tok.tec2);
    await page.goto(ruta('captura'));
    await page.getByRole('heading', { name: 'Captura de campo' }).waitFor();
    const prods = await page.getByLabel('Productor', { exact: true }).locator('option').allInnerTexts();
    await page.getByLabel('Productor', { exact: true }).selectOption({ index: 1 });
    await page.getByLabel('Parcela', { exact: true }).selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Escribir o dibujar' }).click();
    await page.getByRole('button', { name: 'Dibujar en el croquis' }).click();
    await page.getByRole('application').focus();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    const lon = await page.getByLabel(/Longitud.*vértice 1/).inputValue();
    await page.getByRole('button', { name: 'Revisar antes de guardar' }).click();
    await page.getByText('todavía no se guardó nada').waitFor();
    await page.screenshot({ path: join(SALIDA, '4.2-croquis-tecnico-es.png'), fullPage: true });
    await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
    await page.getByText('Ubicación guardada como versión 1.').waitFor();
    const v = (await versiones(tok.tec2, E.plotD))[0];
    await ctx.close();
    return [!prods.some((p) => /A01-A|A01-B|A01-C/.test(p)) && lon !== '' && v?.survey_method === 'MANUAL_COORDINATES' && (v.accuracy_m ?? null) === null,
      `productores visibles=[${prods.filter((p) => p.includes('A01')).join(' | ')}] · método=${v?.survey_method} · precisión=${v?.accuracy_m ?? 'no informada'}`];
  });

  await caso('4.3 WEB en inglés y 390 px (productor): mismo recorrido traducido, orden de coordenadas visible, sin desborde ni claves', async () => {
    const { ctx, page } = await sesion(browser, tok.prod1, 'en', { viewport: { width: 390, height: 844 } });
    await page.goto(ruta('captura'));
    await page.getByRole('heading', { name: 'Field capture' }).waitFor();
    await page.getByLabel('Plot', { exact: true }).selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Type or draw' }).click();
    await page.getByLabel(/Longitude.*vertex 1/).fill('-80.162'); await page.getByLabel(/Latitude.*vertex 1/).fill('-0.852');
    await page.getByRole('button', { name: 'Review before saving' }).click();
    await page.getByText('nothing has been saved yet', { exact: false }).waitFor();
    const orden = await page.getByText('Coordinate order').isVisible();
    const cuerpo = await page.locator('main').innerText();
    await page.screenshot({ path: join(SALIDA, '4.3-revision-en-390px.png'), fullPage: true });
    const ok = await sinDesborde(page);
    await ctx.close();
    return [orden && ok && !/\b[a-z]+\.[a-z_]+\.[a-z_]+\b/.test(cuerpo), `orden visible=${orden} · sin desborde horizontal=${ok}`];
  });

  await caso('4.4 RECARGA: el borrador de POLÍGONO se retoma; recuperarlo NO guarda ni confirma; solo de su usuario, organización y parcela', async () => {
    const { ctx, page } = await sesion(browser, tok.tec1, 'es', { geolocation: { latitude: -0.85, longitude: -80.16, accuracy: 8 }, permissions: ['geolocation'] });
    await page.goto(`${ruta(`parcelas/${E.plotC}`)}`);
    await page.getByRole('button', { name: 'Polígono por vértices' }).click();
    await page.getByRole('button', { name: 'Iniciar captura de polígono' }).click();
    for (const [lat, lon] of [[-0.85, -80.16], [-0.85, -80.159]]) {
      await ctx.setGeolocation({ latitude: lat, longitude: lon, accuracy: 8 });
      await page.getByRole('button', { name: 'Añadir vértice' }).click();
      await page.getByRole('button', { name: 'Guardar vértice' }).click();
      await page.getByRole('button', { name: 'Añadir vértice' }).waitFor();
    }
    const antes = (await versiones(tok.tec1, E.plotC)).length;
    await page.reload();
    // Tras recargar, SIN elegir método: el borrador aparece solo.
    await page.getByRole('table', { name: 'Vértices del borrador' }).waitFor({ timeout: 15000 });
    const filas = await page.getByRole('table', { name: 'Vértices del borrador' }).locator('tbody tr').count();
    await page.screenshot({ path: join(SALIDA, '4.4-borrador-recuperado.png'), fullPage: true });
    const despues = (await versiones(tok.tec1, E.plotC)).length;
    // Autorización del borrador: otro técnico, el productor y otra organización no lo ven.
    const ruta2 = `/plots/${E.plotC}/polygon-drafts/current`;
    const otros = [await pedir(tok.tec2, 'GET', `${base}${ruta2}`), await pedir(tok.prod1, 'GET', `${base}${ruta2}`), await pedir(tok.adminb, 'GET', `${base}${ruta2}`)].map((x) => x.status);
    const propio = await pedir(tok.tec1, 'GET', `${base}${ruta2}`);
    await ctx.close();
    return [filas === 2 && antes === despues && propio.status === 200 && propio.body?.draft && otros.every((s) => s === 404 || s === 403), `vértices recuperados=${filas} · versiones antes/después=${antes}/${despues} · otros=${otros.join('/')}`];
  });

  await caso('4.5 RECARGA: la IMPORTACIÓN GeoJSON pendiente se retoma; no se confirmó sola; solo la ve quien tiene alcance', async () => {
    const { ctx, page } = await sesion(browser, tok.tec2);
    await page.goto(ruta(`parcelas/${E.plotD}`));
    await page.getByRole('button', { name: 'Importar GeoJSON' }).click();
    await page.getByLabel('Archivo GeoJSON (.geojson o .json)').setInputFiles({ name: 'finca.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(cuadro(-80.2, -0.9))) });
    await page.getByRole('button', { name: 'Analizar archivo' }).click();
    await page.getByRole('region', { name: 'Revisión de la importación' }).waitFor();
    const antes = (await versiones(tok.tec2, E.plotD)).length;
    await page.reload();
    await page.getByRole('button', { name: 'Retomar revisión' }).waitFor({ timeout: 15000 });
    await page.screenshot({ path: join(SALIDA, '4.5-importacion-pendiente.png'), fullPage: true });
    const despues = (await versiones(tok.tec2, E.plotD)).length;
    const pend = (r) => lista(r.body).filter((x) => x.status === 'ANALYZED').length;
    const propio = await pedir(tok.tec2, 'GET', `${base}/plots/${E.plotD}/geometry-imports`);
    const ajenos = [await pedir(tok.tec1, 'GET', `${base}/plots/${E.plotD}/geometry-imports`), await pedir(tok.prod1, 'GET', `${base}/plots/${E.plotD}/geometry-imports`), await pedir(tok.adminb, 'GET', `${base}/plots/${E.plotD}/geometry-imports`)].map((x) => x.status);
    await ctx.close();
    return [antes === despues && pend(propio) === 1 && ajenos.every((s) => s === 404 || s === 403), `pendientes del usuario=${pend(propio)} · versiones antes/después=${antes}/${despues} · otros=${ajenos.join('/')}`];
  });

  // ---- 5) Mapa local (MapLibre + OpenStreetMap servido por Terra Link): sin servicios externos
  const MAPS = arg('--maps', 'http://localhost:8090');
  const origenesOk = new Set([new URL(WEB).origin, new URL(API).origin, new URL(MAPS).origin]);
  const conMapa = async (lang, opts, fn) => {
    const { ctx, page } = await sesion(browser, tok.prod1, lang, opts);
    const externas = []; const total = { n: 0, maps: 0 };
    page.on('request', (r) => { const u = r.url(); if (!/^https?:/.test(u)) return; total.n++; const o = new URL(u).origin; if (o === new URL(MAPS).origin) total.maps++; if (!origenesOk.has(o)) externas.push(u); });
    try { return await fn(page, externas, total); } finally { await ctx.close(); }
  };
  await caso('5.1 WEB mapa (es): cartografía real, acercar/desplazar, fijar vértices (mira y teclado), REVISAR sin guardar y confirmar; ninguna solicitud externa', async () => {
    return conMapa('es', {}, async (page, externas, total) => {
      await page.goto(ruta('captura'));
      await page.getByLabel('Parcela', { exact: true }).selectOption({ index: 1 });
      await page.getByRole('button', { name: 'Escribir o dibujar' }).click();
      await page.getByRole('radio', { name: /Un polígono/ }).check();
      await page.getByRole('button', { name: 'Dibujar en el mapa' }).click();
      const mapa = page.getByRole('application', { name: /Mapa para dibujar la parcela/ });
      await page.locator('.maplibregl-canvas').waitFor({ timeout: 30000 });
      await page.getByText('Cargando el mapa local…').waitFor({ state: 'detached', timeout: 30000 });
      await page.getByLabel('Ir a longitud').fill('-80.16'); await page.getByLabel('Ir a latitud').fill('-0.85');
      await page.getByRole('button', { name: 'Centrar el mapa aquí' }).click();
      await page.getByText(/longitud -80\.16, latitud -0\.85/).waitFor({ timeout: 20000 });
      await mapa.focus(); await page.keyboard.press('=');
      await page.getByRole('button', { name: 'Fijar vértice en la mira' }).click();
      for (const [lon, lat] of [['-80.159', '-0.85'], ['-80.159', '-0.849']]) {
        await page.getByLabel('Ir a longitud').fill(lon); await page.getByLabel('Ir a latitud').fill(lat);
        await page.getByRole('button', { name: 'Centrar el mapa aquí' }).click();
        await page.getByText(new RegExp('longitud ' + lon.replace('.', '\\.'))).waitFor({ timeout: 20000 });
        await mapa.focus(); await page.keyboard.press('Enter');
      }
      const filas = await page.getByRole('table', { name: 'Coordenadas a registrar' }).locator('tbody tr').count();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(SALIDA, '5.1-mapa-es.png'), fullPage: true });
      const antes = (await versiones(tok.prod1, E.plotA)).length;
      await page.getByRole('button', { name: 'Revisar antes de guardar' }).click();
      await page.getByText('todavía no se guardó nada').waitFor();
      const trasRevisar = (await versiones(tok.prod1, E.plotA)).length;
      await page.getByLabel(/Motivo de la corrección/).fill('Trazado sobre el mapa de referencia (ensayo A-01)');
      await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
      await page.getByText(/Ubicación guardada como versión \d+\./).waitFor();
      const v = (await versiones(tok.prod1, E.plotA))[0];
      return [filas === 3 && trasRevisar === antes && v?.survey_method === 'MANUAL_COORDINATES' && (v.accuracy_m ?? null) === null && externas.length === 0 && total.maps > 0,
        `vértices=${filas} · versiones antes/tras revisar=${antes}/${trasRevisar} · método=${v?.survey_method}, precisión=${v?.accuracy_m ?? 'no informada'} · solicitudes=${total.n} (al servicio local de mapas=${total.maps}) · externas=${externas.length}`];
    });
  });
  await caso('5.2 WEB mapa (en, 390 px): teclado, sin desborde y sin solicitudes externas', async () => {
    return conMapa('en', { viewport: { width: 390, height: 844 } }, async (page, externas) => {
      await page.goto(ruta('captura'));
      await page.getByLabel('Plot', { exact: true }).selectOption({ index: 1 });
      await page.getByRole('button', { name: 'Type or draw' }).click();
      await page.getByRole('button', { name: 'Draw on the map' }).click();
      await page.locator('.maplibregl-canvas').waitFor({ timeout: 30000 });
      await page.getByRole('button', { name: 'Set vertex at the crosshair' }).click();
      const lon = await page.getByLabel(/Longitude.*vertex 1/).inputValue();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(SALIDA, '5.2-mapa-en-390px.png'), fullPage: true });
      const ok = await sinDesborde(page);
      return [lon !== '' && ok && externas.length === 0, `vértice fijado=${lon !== ''} · sin desborde=${ok} · externas=${externas.length}`];
    });
  });
  await caso('5.3 sin cartografía: lo declara, no usa mapa externo y conserva la entrada manual', async () => {
    return conMapa('es', {}, async (page, externas) => {
      await page.route('**/estilo.json', (r) => r.fulfill({ status: 404, body: 'no preparado' }));
      await page.goto(ruta('captura'));
      await page.getByLabel('Parcela', { exact: true }).selectOption({ index: 1 });
      await page.getByRole('button', { name: 'Escribir o dibujar' }).click();
      await page.getByRole('button', { name: 'Dibujar en el mapa' }).click();
      await page.getByText('La cartografía local no está disponible.').waitFor();
      await page.getByLabel(/Longitud.*vértice 1/).fill('-80.2'); await page.getByLabel(/Latitud.*vértice 1/).fill('-0.9');
      const habilitado = await page.getByRole('button', { name: 'Revisar antes de guardar' }).isEnabled();
      await page.screenshot({ path: join(SALIDA, '5.3-sin-mapa.png'), fullPage: true });
      return [habilitado && externas.length === 0, `entrada manual disponible=${habilitado} · externas=${externas.length}`];
    });
  });
  await caso('5.4 el productor usa polígono por vértices e importación GeoJSON SOLO en su parcela (la ajena: 404)', async () => {
    const mia = [await pedir(tok.prod1, 'POST', `${base}/plots/${E.plotA}/polygon-drafts`, {}), await pedir(tok.prod1, 'GET', `${base}/plots/${E.plotA}/polygon-drafts/current`)].map((x) => x.status);
    const ajena = [await pedir(tok.prod1, 'POST', `${base}/plots/${E.plotB}/polygon-drafts`, {}), await pedir(tok.prod1, 'GET', `${base}/plots/${E.plotB}/polygon-drafts/current`)].map((x) => x.status);
    return [mia.every((s) => s < 300) && ajena.every((s) => s === 404), `propia=${mia.join('/')} ajena=${ajena.join('/')}`];
  });

  // ---- 6) Fotografías (D-41): copia sin metadatos, FIELD_PHOTO y consulta PROPIA
  const jpegConExif = () => {
    const a = (x) => Array.from(x, (c) => c.charCodeAt(0));
    const sg = (m, d) => [0xff, m, (d.length + 2) >> 8, (d.length + 2) & 0xff, ...d];
    const tiff = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 2, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 0x30, 0, 0, 0, 0, 0, 0, 0];
    return Buffer.from([0xff, 0xd8, ...sg(0xe1, [...a('Exif\0\0'), ...tiff]), ...sg(0xe1, a('http://ns.adobe.com/xap/1.0/\0<xmpmeta>TelefonoSintetico</xmpmeta>')), ...sg(0xfe, a('comentario')), ...sg(0xdb, [0, 1, 2, 3]), 0xff, 0xda, 0, 4, 1, 0, ...a('datos-' + randomUUID()), 0xff, 0xd9]);
  };
  // Quedan fuera XMP, comentario, modelo del dispositivo y el puntero al IFD GPS; solo permanece el segmento mínimo de orientación (contrato D-41).
const tieneMeta = (b) => ['TelefonoSintetico', 'xmpmeta', 'comentario'].some((x) => b.includes(Buffer.from(x))) || b.includes(Buffer.from([0x25, 0x88]));
  const subirFoto = async (t, plot, bytes, tipo = 'FIELD_PHOTO') => {
    const f = new FormData();
    f.append('operation_id', randomUUID()); f.append('document_type', tipo); f.append('owner_type', 'plot'); f.append('owner_id', plot); f.append('title', 'Foto de ensayo A-01 (sintética)');
    f.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'fotografia.jpg');
    const r = await fetch(`${API}${base}/documents`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: f });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const bajar = async (t, doc, ver, org = E.org) => { const r = await fetch(`${API}/api/v1/organizations/${org}/documents/${doc}/versions/${ver}/content`, { headers: { authorization: `Bearer ${t}` } }); return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()) }; };
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const original = jpegConExif();
  const copia = Buffer.from(await (async () => { const { stripImageMetadata } = await import('../../apps/api/dist/sync/image-metadata.js'); return stripImageMetadata(new Uint8Array(original), 'image/jpeg'); })());
  let fotoPropia = null; let fotoAjena = null;
  await caso('6.1 la API directa NO acepta una foto con EXIF (ni como FIELD_PHOTO ni como evidencia); la copia sin metadatos sí', async () => {
    const a = await subirFoto(tok.prod1, E.plotA, original); const b = await subirFoto(tok.prod1, E.plotA, copia, 'FIELD_EVIDENCE'); const c = await subirFoto(tok.prod1, E.plotA, copia);
    fotoPropia = c.body?.document;
    return [a.status === 422 && a.body?.error?.code === 'PHOTO_METADATA_PRESENT' && b.status === 422 && c.status === 201 && c.body.document.versions[0].sha256 === sha(copia) && sha(copia) !== sha(original),
      `con EXIF=${a.status} ${a.body?.error?.code} · imagen como evidencia=${b.status} ${b.body?.error?.code} · copia=${c.status} · SHA de la copia ≠ SHA del original=${sha(copia) !== sha(original)}`];
  });
  await caso('6.2 WEB: el productor sube una foto con EXIF; el sistema prepara la copia, el original no cambia y la ve y descarga', async () => {
    const { ctx, page } = await sesion(browser, tok.prod1);
    await page.goto(ruta('captura'));
    await page.getByLabel('Parcela', { exact: true }).selectOption({ index: 1 });
    await page.getByLabel('Archivo (PDF, JPEG o PNG)').setInputFiles({ name: 'IMG_0001.JPG', mimeType: 'image/jpeg', buffer: original });
    await page.getByLabel('Título', { exact: true }).fill('Foto del lindero (ensayo A-01)');
    await page.getByRole('button', { name: 'Subir evidencia' }).click();
    await page.getByText('Se quitaron los metadatos de la copia subida; tu archivo original no se modificó.').waitFor();
    await page.getByRole('link', { name: 'Foto del lindero (ensayo A-01)' }).click();
    await page.getByRole('button', { name: /Descargar v1/ }).waitFor({ timeout: 20000 });
    await page.screenshot({ path: join(SALIDA, '6.2-foto-propia.png'), fullPage: true });
    await ctx.close();
    const docs = lista((await pedir(tok.prod1, 'GET', `${base}/documents?owner_type=plot&owner_id=${E.plotA}`)).body);
    const foto = docs.find((d) => d.title === 'Foto del lindero (ensayo A-01)');
    const dl = await bajar(tok.prod1, foto.id, foto.versions[0].id);
    return [dl.status === 200 && !tieneMeta(dl.bytes) && sha(dl.bytes) === foto.versions[0].sha256 && !JSON.stringify(foto).includes('IMG_0001') && foto.versions[0].downloadable === true,
      `descarga propia=${dl.status} · archivo servido sin metadatos=${!tieneMeta(dl.bytes)} · coincide con el SHA registrado=${sha(dl.bytes) === foto.versions[0].sha256} · nombre neutro=${!JSON.stringify(foto).includes('IMG_0001')}`];
  });
  await caso('6.3 foto de OTRA parcela sin alcance: 404 al consultar, listar y descargar; el productor de ESA parcela sí; otra organización 404; sin identidad general', async () => {
    const up = await subirFoto(tok.admin, E.plotB, copia); fotoAjena = up.body?.document;
    exigeEntrada('foto ajena', fotoAjena?.id);
    const doc = fotoAjena.id, ver = fotoAjena.versions[0].id;
    const r = {
      vista: (await pedir(tok.prod1, 'GET', `${base}/documents/${doc}`)).status, descarga: (await bajar(tok.prod1, doc, ver)).status,
      enLista: lista((await pedir(tok.prod1, 'GET', `${base}/documents`)).body).some((d) => d.id === doc),
      control: (await bajar(tok.prod2, doc, ver)).status, otraOrg: (await bajar(tok.adminb, doc, ver)).status, otraOrgProd: (await bajar(tok.prod1, doc, ver, E.orgB)).status,
      auditor: (await bajar(tok.aud, doc, ver)).status,
    };
    const ident = (await pedir(tok.prod1, 'GET', `${base}/producers/${E.pA}`)).body?.identity_visible;
    return [r.vista === 404 && r.descarga === 404 && !r.enLista && r.control === 200 && r.otraOrg === 404 && r.otraOrgProd === 404 && r.auditor === 403 && ident === false,
      `otra parcela: ver=${r.vista}, descargar=${r.descarga}, en lista=${r.enLista} · control (su productor)=${r.control} · otra organización=${r.otraOrg}/${r.otraOrgProd} · auditor=${r.auditor} · identidad visible para el productor=${ident}`];
  });
  await caso('6.4 al retirar el vínculo el productor pierde el acceso a su foto al instante; al restablecerlo, vuelve', async () => {
    exigeEntrada('foto propia', fotoPropia?.id);
    const doc = fotoPropia.id, ver = fotoPropia.versions[0].id;
    const unlink = async (m) => { const v = (await pedir(tok.admin, 'GET', `${base}/producers/${E.pA}`)).body.row_version; return pedir(tok.admin, 'PUT', `${base}/producers/${E.pA}/self-membership`, { expected_version: v, membership_id: m, reason: 'Ensayo de pérdida de acceso a fotografías (A-01)' }); };
    const miembros = lista((await pedir(tok.admin, 'GET', `${base}/members`)).body.members ?? (await pedir(tok.admin, 'GET', `${base}/members`)).body);
    const mem = exigeEntrada('membresía prod1', miembros.find((m) => m.email === E.cuentas.prod1.email)?.membership_id);
    const antes = (await bajar(tok.prod1, doc, ver)).status;
    const retirado = await unlink(null);
    const sin = [(await pedir(tok.prod1, 'GET', `${base}/documents/${doc}`)).status, (await bajar(tok.prod1, doc, ver)).status];
    const repuesto = await unlink(mem);
    const con = (await bajar(tok.prod1, doc, ver)).status;
    return [antes === 200 && retirado.status === 200 && sin.every((s) => s === 404) && repuesto.status === 200 && con === 200, `antes=${antes} · retirado=${retirado.status} → ver/descargar=${sin.join('/')} · restablecido=${repuesto.status} → descargar=${con}`];
  });

  await browser.close();
}

// ================================================================ FASE SATÉLITE (fixture encendida)
if (FASE === 'satelite') {
  console.log(`\n== A-01 · fase satélite de ENSAYO · organización ENSAYO ${E.suf} ==\n`);
  const ruta = `${base}/plots/${E.plotA}/satellite`;
  const ficha = (await pedir(tok.admin, 'GET', ruta)).body;
  await caso('S.0 modo ensayo declarado por la API, con escenarios; el productor NO puede encargar', async () => {
    const p = await pedir(tok.prod1, 'POST', `${base}/plots/${E.plotA}/satellite/analyses`, { operation_id: randomUUID(), operation: 'FOREST_COVER', fixture_scenario: 'RESULT_FINDINGS' });
    return [ficha.ensayo_mode === true && (ficha.fixture_scenarios ?? []).includes('RESULT_FINDINGS') && p.status === 403, `ensayo_mode=${ficha.ensayo_mode} · escenarios=${(ficha.fixture_scenarios ?? []).length} · productor=${p.status}`];
  });
  const cuenta = async (t) => (await pedir(tok.admin, 'GET', `${base}/${t}`)).status;
  const evAntes = lista((await pedir(tok.admin, 'GET', `${base}/evidence`)).body).length;
  const vigente = (await versiones(tok.admin, E.plotA))[0];
  const ids = {};
  for (const s of ['RESULT_FINDINGS', 'RESULT_NO_FINDINGS', 'RESULT_PARTIAL', 'PROVIDER_ERROR']) {
    const r = await pedir(tok.admin, 'POST', `${base}/plots/${E.plotA}/satellite/analyses`, { operation_id: randomUUID(), operation: 'FOREST_COVER', fixture_scenario: s });
    ids[s] = r.body?.job?.id;
  }
  const esperar = async (id) => { for (let i = 0; i < 60; i++) { const j = (await pedir(tok.admin, 'GET', `${base}/satellite/analyses/${id}`)).body; if (j && !['QUEUED', 'RUNNING', 'REQUESTED', 'PENDING'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 1000)); } return (await pedir(tok.admin, 'GET', `${base}/satellite/analyses/${id}`)).body; };
  const J = {}; for (const [s, id] of Object.entries(ids)) J[s] = await esperar(exigeEntrada(`encargo ${s}`, id));
  await caso('S.1 con hallazgos / sin hallazgos: rotulado ENSAYO, sintético, conclusión NO evaluada, versión geométrica exacta', async () => {
    const f = J.RESULT_FINDINGS; const n = J.RESULT_NO_FINDINGS;
    const okF = f?.is_ensayo && f.result?.is_synthetic && f.result.conclusion === 'NOT_EVALUATED' && f.result.indicators?.findings?.count === 3 && f.subject?.plot_version_id === vigente.id;
    const okN = n?.is_ensayo && n.result?.is_synthetic && n.result.conclusion === 'NOT_EVALUATED' && n.result.indicators?.findings?.count === 0 && n.subject?.plot_version_id === vigente.id;
    return [!!(okF && okN), `hallazgos=${f?.result?.indicators?.findings?.count} · sin hallazgos=${n?.result?.indicators?.findings?.count} · versión analizada = vigente (${vigente.id.slice(0, 8)}…)`];
  });
  await caso('S.2 cobertura insuficiente y error: se declaran; el error no deja resultado favorable; el reintento es un encargo nuevo', async () => {
    const p = J.RESULT_PARTIAL; const e = J.PROVIDER_ERROR;
    const re = await pedir(tok.admin, 'POST', `${base}/plots/${E.plotA}/satellite/analyses`, { operation_id: randomUUID(), operation: 'FOREST_COVER', fixture_scenario: 'RESULT_NO_FINDINGS' });
    const rj = await esperar(exigeEntrada('reintento', re.body?.job?.id));
    const eDespues = (await pedir(tok.admin, 'GET', `${base}/satellite/analyses/${e.id}`)).body;
    return [p?.result?.coverage?.status === 'PARTIAL' && e?.status === 'FAILED' && e.result === null && rj?.result?.is_synthetic === true && eDespues?.status === 'FAILED' && rj.id !== e.id,
      `cobertura=${p?.result?.coverage?.status} · error=${e?.status} (resultado=${e?.result}) · reintento=${rj?.status}, el fallido se conserva`];
  });
  await caso('S.3 sin efecto operativo: ni evidencia, ni evaluaciones de riesgo; el estado de la parcela sigue NOT_EVALUATED', async () => {
    const f2 = (await pedir(tok.admin, 'GET', ruta)).body;
    const evDespues = lista((await pedir(tok.admin, 'GET', `${base}/evidence`)).body).length;
    return [f2.analysis_status === 'NOT_EVALUATED' && evDespues === evAntes, `estado=${f2.analysis_status} · evidencias antes/después=${evAntes}/${evDespues}`];
  });
  await caso('S.4 cambiar la geometría: los resultados anteriores NO aplican a la versión vigente', async () => {
    const ev = (await pedir(tok.admin, 'GET', `${base}/plots/${E.plotA}`)).body.row_version;
    const nv = await pedir(tok.prod1, 'POST', `${base}/plots/${E.plotA}/geometry-versions`, { expected_version: ev, survey_method: 'MANUAL_COORDINATES', geometry: cuadro(-80.1625, -0.8525), reason: 'Ajuste posterior al análisis de ensayo' });
    const f3 = (await pedir(tok.admin, 'GET', ruta)).body;
    const todosViejos = (f3.jobs ?? []).filter((j) => j.is_ensayo).every((j) => j.applies_to_current_version === false);
    return [nv.status === 201 && todosViejos && f3.analysis_status === 'NOT_EVALUATED', `nueva versión=${nv.status} · ningún ensayo aplica a la vigente=${todosViejos}`];
  });
  const browser = await chromium.launch();
  await caso('S.5 WEB administración (es y en): panel de ENSAYO con escenario elegible, ficha sin conclusión (capturas)', async () => {
    const out = [];
    for (const lang of ['es', 'en']) {
      const { ctx, page } = await sesion(browser, tok.admin, lang);
      await page.goto(`${WEB}/organizaciones/${E.org}/parcelas/${E.plotA}`);
      await page.locator('#sat-title').waitFor({ timeout: 20000 });
      out.push(await page.locator('#sat-scenario').count());
      await page.locator('#sat-title').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SALIDA, `S.5-satelite-${lang}.png`), fullPage: true });
      await ctx.close();
    }
    return [out.every((n) => n === 1), `selector de escenario es/en=${out.join('/')}`];
  });
  await browser.close();
}

// ================================================================ FASE CIERRE (ensayo desactivado)
if (FASE === 'cierre') {
  console.log(`\n== A-01 · cierre · el ensayo debe estar DESACTIVADO ==\n`);
  await caso('C.1 la API declara fixture apagada: sin modo ensayo ni escenarios, no se puede encargar', async () => {
    const f = (await pedir(tok.admin, 'GET', `${base}/plots/${E.plotA}/satellite`)).body;
    const r = await pedir(tok.admin, 'POST', `${base}/plots/${E.plotA}/satellite/analyses`, { operation_id: randomUUID(), operation: 'FOREST_COVER', fixture_scenario: 'RESULT_FINDINGS' });
    const job = r.body?.job?.id;
    let estado = null; if (job) { await new Promise((x) => setTimeout(x, 8000)); estado = (await pedir(tok.admin, 'GET', `${base}/satellite/analyses/${job}`)).body; }
    const sinResultado = !estado || estado.result === null || estado.result === undefined;
    return [f.ensayo_mode === false && (f.fixture_scenarios ?? []).length === 0 && f.can_request === false && (r.status >= 400 || sinResultado),
      `ensayo_mode=${f.ensayo_mode} · escenarios=${(f.fixture_scenarios ?? []).length} · can_request=${f.can_request} · intento de encargo=${r.status}${estado ? ` (${estado.status}, sin resultado=${sinResultado})` : ''}`];
  });
}

const fallas = resultados.filter((r) => !r[1]).length;
writeFileSync(join(SALIDA, `resultado-${FASE}.json`), JSON.stringify({ fase: FASE, org: `ENSAYO ${E.suf}`, casos: resultados.map(([titulo, ok, detalle]) => ({ titulo, ok, detalle })) }, null, 2));
console.log(`\n${resultados.length - fallas}/${resultados.length} comprobaciones OK${fallas ? ` · ${fallas} FALLAN` : ''}`);
process.exit(fallas ? 1 : 0);
