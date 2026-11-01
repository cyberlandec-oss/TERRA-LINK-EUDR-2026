// Demostración sobre el DESPLIEGUE con la cuenta EXISTENTE del Productor (productor.cooperativa): subida web de dos soportes FICTICIOS («ENSAYO-LOCAL-DD-…») al productor vinculado,
// consulta posterior, estado sin aprobar y restricciones (contenido personal, documento ajeno, revisión). No crea cuentas ni cambia claves; no imprime contraseñas.
//   node e2e/review/productor-documento-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000] [--marca ENSAYO-LOCAL-DD-1101]
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const MARCA = arg('--marca', 'ENSAYO-LOCAL-DD-1101');
const res = [];
const caso = (titulo, ok, det = '') => { console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(100)} ${det}`); res.push(ok); };
const pdf = (tag) => Buffer.from(`%PDF-1.4\n% ${MARCA} documento ficticio de ensayo ${tag} ${Date.now()}\n%%EOF\n`);

const c = cuentaDemo('productor.cooperativa');
const token = (await (await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) })).json()).access_token;
const pedir = async (m, p) => { const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: m === 'POST' ? '{}' : undefined }); return { s: r.status, b: await r.json().catch(() => null), h: r.headers }; };
const orgs = (await pedir('GET', '/api/v1/organizations')).b;
const org = (Array.isArray(orgs) ? orgs : orgs.items).find((o) => o.name.includes('Cooperativa'));
const A = `/api/v1/organizations/${org.id}`;

const antes = (await pedir('GET', `${A}/documents`)).b;
const idsAntes = new Set((Array.isArray(antes) ? antes : antes.items).map((d) => d.id));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-EC' });
const page = await ctx.newPage();
await page.goto(WEB);
await page.getByLabel('Correo').fill(c.email);
await page.getByLabel('Contraseña', { exact: true }).fill(c.contrasena);
await page.getByRole('button', { name: 'Iniciar sesión' }).click();
await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 20000 });
await page.getByRole('link', { name: /Cooperativa/ }).first().click();
await page.goto(`${WEB}/organizaciones/${org.id}/documentos`);
await page.waitForTimeout(2000);

async function subirPorWeb(tipoValor, titulo, tag) {
  await page.getByLabel('Tipo de documento').selectOption(tipoValor);
  const titular = page.getByLabel('Titular');
  if (await titular.count()) await titular.selectOption('producer');
  const prod = page.getByLabel('Productor', { exact: true });
  await prod.waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  const opciones = await prod.locator('option').allInnerTexts();
  const valor = await prod.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean)[0]);
  if (valor) await prod.selectOption(valor);
  await page.getByLabel('Título').fill(titulo);
  await page.getByLabel('Archivo').setInputFiles({ name: 'ensayo.pdf', mimeType: 'application/pdf', buffer: pdf(tag) });
  await page.getByRole('button', { name: 'Subir documento' }).click();
  await page.waitForTimeout(6000);
  return opciones;
}

const previos = (Array.isArray(antes) ? antes : antes.items).filter((x) => (x.title ?? '').includes(MARCA));
const yaSubidos = previos.some((x) => x.document_type === 'FIELD_EVIDENCE') && previos.some((x) => x.document_type === 'LAND_TENURE'); // un reintento no duplica registros
const op1 = yaSubidos ? ['(reutiliza los de la ejecución anterior)'] : await subirPorWeb('FIELD_EVIDENCE', `${MARCA} evidencia del productor (ficticio)`, 'operativo');
const per1 = yaSubidos ? null : await subirPorWeb('LAND_TENURE', `${MARCA} tenencia del productor (ficticio)`, 'personal');
await page.screenshot({ path: 'docs/qa/capturas/productor-documentos-subida.png', fullPage: true });

const despues = (await pedir('GET', `${A}/documents`)).b;
const filas = Array.isArray(despues) ? despues : despues.items;
const nuevos = yaSubidos ? filas.filter((x) => (x.title ?? '').includes(MARCA)) : filas.filter((d) => !idsAntes.has(d.id));
caso('subida web: aparecen dos documentos nuevos del productor vinculado', nuevos.length === 2, `opciones de Productor visibles: ${JSON.stringify(op1)}`);
const dOp = nuevos.find((d) => d.document_type === 'FIELD_EVIDENCE');
const dPer = nuevos.find((d) => d.document_type === 'LAND_TENURE');
if (!dOp || !dPer) { console.log('FALLA sin documentos nuevos; se detiene'); await browser.close(); process.exit(1); }

const fOp = (await pedir('GET', `${A}/documents/${dOp.id}`)).b;
const fPer = (await pedir('GET', `${A}/documents/${dPer.id}`)).b;
caso('operativo: titular productor, versión 1 disponible, escaneo limpio, SIN revisión', fOp.owner_type === 'producer' && fOp.versions[0].availability === 'AVAILABLE' && fOp.versions[0].scan?.status === 'CLEAN' && fOp.versions[0].review === null, `estado: ${fOp.versions[0].availability}/${fOp.versions[0].scan?.status}/review=${fOp.versions[0].review}`);
caso('personal: metadatos visibles, contenido RESTRINGIDO, sin nombre de archivo, SIN revisión', fPer.classification === 'PERSONAL_DATA' && fPer.content_access === 'RESTRICTED' && fPer.versions[0].file_name === null && fPer.versions[0].downloadable === false && fPer.versions[0].review === null, `sha256 presente=${!!fPer.versions[0].sha256}`);

const dlOp = await fetch(`${API}${A}/documents/${dOp.id}/versions/${fOp.versions[0].id}/content`, { headers: { authorization: `Bearer ${token}` } });
caso('descarga del operativo propio: 200 y huella coincide', dlOp.status === 200 && dlOp.headers.get('x-content-sha256') === fOp.versions[0].sha256);
const dlPer = await fetch(`${API}${A}/documents/${dPer.id}/versions/${fPer.versions[0].id}/content`, { headers: { authorization: `Bearer ${token}` } });
caso('descarga del personal propio: 403 CONTENT_RESTRICTED', dlPer.status === 403 && /CONTENT_RESTRICTED/.test(await dlPer.text()));
const rutaRev = `${A}/documents/${dOp.id}/versions/${fOp.versions[0].id}/reviews`;
const rev = await fetch(API + rutaRev, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'ACCEPTED', reason: 'Lo reviso yo mismo (ensayo)' }) });
const tAdm0 = (await (await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: cuentaDemo('admin.cooperativa').email, password: cuentaDemo('admin.cooperativa').contrasena }) })).json()).access_token;
const ctrl = await fetch(API + rutaRev, { method: 'POST', headers: { authorization: `Bearer ${tAdm0}`, 'content-type': 'application/json' }, body: '{}' }); // control de ruta: cuerpo vacío => 400 si existe; no aprueba nada
caso('el productor no revisa su propio documento: 403 (control: la ruta existe, 400 con cuerpo inválido; sin aprobar nada)', rev.status === 403 && ctrl.status === 400, `productor ${rev.status}; control ${ctrl.status}`);


// Documento ajeno: cualquiera de la cooperativa que no sea suyo.
const adm = cuentaDemo('admin.cooperativa');
const tAdm = (await (await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: adm.email, password: adm.contrasena }) })).json()).access_token;
const todos = await (await fetch(`${API}${A}/documents`, { headers: { authorization: `Bearer ${tAdm}` } })).json();
const lista = Array.isArray(todos) ? todos : todos.items;
const propiosIds = new Set(filas.map((d) => d.id));
const ajeno = lista.find((d) => !propiosIds.has(d.id));
const rAj = ajeno ? await pedir('GET', `${A}/documents/${ajeno.id}`) : { s: 0 };
caso(`documento ajeno (control: la administración sí ve ${lista.length}, el productor ${filas.length}): ficha 404`, !!ajeno && rAj.s === 404, ajeno ? '' : 'no hay documento ajeno en el DEMO');

// Consulta posterior desde la pantalla.
await page.goto(`${WEB}/organizaciones/${org.id}/documentos/${dPer.id}`);
await page.waitForTimeout(2500);
const texto = await page.locator('main').innerText();
caso('pantalla del personal: título visible y aviso de contenido restringido; sin botón de descarga ni revisión', texto.includes(MARCA) && /restring|datos personales/i.test(texto) && (await page.getByRole('button', { name: /Descargar|Aceptar|Rechazar|Revisar/ }).count()) === 0);
await page.screenshot({ path: 'docs/qa/capturas/productor-documento-personal.png', fullPage: true });
await browser.close();
console.log(`\n${res.filter(Boolean).length}/${res.length}`);
process.exit(res.every(Boolean) ? 0 : 1);
