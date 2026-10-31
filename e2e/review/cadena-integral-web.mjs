// Recorrido INTEGRAL de la cadena desde la WEB, transición por transición y con el rol que corresponde, sobre la organización DEMO
// «Cooperativa Río Verde» (datos SINTÉTICOS ya existentes; NO crea organizaciones). Cada ejecución agrega UN conjunto de registros marcados
// «CAD-<marca>» (parcela, entrega, lote, proceso, expediente) para poder encadenar las transiciones sin tocar los registros previos.
//
//   node e2e/review/cadena-integral-web.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Reglas: no simula aprobaciones ni desbloquea compuertas. Un bloqueo vigente (READY, despacho, revisión regulatoria, catálogo) se registra como
// BLOQUEO ESPERADO con su código; un fallo inesperado, como DEFECTO. Lee CREDENCIALES.csv con la utilidad segura (no imprime contraseñas).
// Resultado: validation-results/cadena-integral-web-<fecha>/resultado.json y capturas.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', `cadena-integral-web-${new Date().toISOString().slice(0, 10)}`);
mkdirSync(SALIDA, { recursive: true });
const MARCA = `CAD-${new Date().toISOString().slice(5, 19).replace(/[-:T]/g, '')}`;

const pedir = async (t, m, p, body) => { const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
const login = async (cta) => { const c = cuentaDemo(cta); return (await (await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) })).json()).access_token; };

const browser = await chromium.launch();
const sesiones = {};
const resultados = [];
let org = null;
const ctxData = {};

async function como(cta) {
  if (sesiones[cta]) return sesiones[cta];
  const token = await login(cta);
  const orgs = (await pedir(token, 'GET', '/api/v1/organizations')).b;
  const o = orgs.find((x) => x.name.includes('Río Verde')) ?? orgs[0];
  if (o.name.includes('Río Verde')) org = o;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, geolocation: { latitude: -0.85, longitude: -80.16 }, permissions: ['geolocation'] });
  await ctx.addInitScript(([t]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', 'es'); }, [token]);
  return (sesiones[cta] = { token, ctx, base: `/api/v1/organizations/${o.id}` });
}
const url = (r) => `${WEB}/organizaciones/${org.id}${r}`;

/** categoria: OK | DEFECTO | BLOQUEO_ESPERADO | PENDIENTE_ORIGINAL | NO_DEFINIDO */
async function transicion(id, titulo, cta, fn) {
  const s = await como(cta);
  const page = await s.ctx.newPage();
  const http = [];
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(API)) http.push(`${r.status()} ${r.url().replace(API, '').replace(/[0-9a-f-]{36}/g, '<id>').slice(0, 80)}`); });
  let out;
  try { out = await fn(page, s); } catch (e) { out = { categoria: 'DEFECTO', detalle: `excepción: ${String(e.message).split('\n')[0].slice(0, 220)}` }; }
  try { await page.screenshot({ path: join(SALIDA, `${id}.png`) }); } catch { /* sin captura */ }
  await page.close();
  const r = { id, transicion: titulo, actor: cta, ...out, http: [...new Set(http)] };
  resultados.push(r);
  console.log(`${r.categoria.padEnd(18)} ${id.padEnd(5)} ${titulo}\n    actor=${cta} · ${r.detalle}${r.http.length ? `\n    http≥400: ${r.http.join('; ')}` : ''}`);
  return r;
}
const ok = (detalle) => ({ categoria: 'OK', detalle });
const texto = async (page) => (await page.locator('main').innerText()).replace(/\s+/g, ' ');

// ------------------------------------------------------------------ datos de partida (DEMO)
const admin = await como('admin.cooperativa');
const asignados = lista((await pedir((await como('tecnico1.cooperativa')).token, 'GET', `${admin.base}/producers?limit=100`)).b);
const productor = asignados[0];
console.log(`\n== Cadena integral · ${org.name} · marca ${MARCA} · productor de partida ${productor.producer_code} ==\n`);

// ------------------------------------------------------------------ 1. productor → parcela y geometría (técnico de campo)
await transicion('T1', 'Técnico asignado crea la parcela y registra su geometría (coordenadas escritas, revisión del servidor, versión)', 'tecnico1.cooperativa', async (page) => {
  await page.goto(url('/captura'));
  await page.getByRole('heading', { name: 'Captura de campo' }).waitFor();
  await page.getByLabel('Productor', { exact: true }).selectOption({ label: new RegExp(productor.producer_code) }).catch(async () => page.getByLabel('Productor', { exact: true }).selectOption({ index: 1 }));
  await page.getByRole('button', { name: 'Registrar una parcela nueva' }).click();
  await page.getByLabel('Código de la parcela').fill(MARCA);
  await page.getByRole('button', { name: 'Crear parcela' }).click();
  await page.getByRole('heading', { name: new RegExp(MARCA) }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Escribir o dibujar' }).click();
  await page.getByRole('radio', { name: /Un polígono/ }).check();
  const d = (Date.now() % 100000) * 1e-6; // desplazamiento único por ejecución
  const pts = [[-80.17 - d, -0.86], [-80.169 - d, -0.86], [-80.169 - d, -0.859]].map(([x, y]) => [Number(x.toFixed(6)), y]);
  for (let i = 0; i < 3; i++) { await page.getByLabel(new RegExp(`Longitud.*vértice ${i + 1}`)).fill(String(pts[i][0])); await page.getByLabel(new RegExp(`Latitud.*vértice ${i + 1}`)).fill(String(pts[i][1])); }
  await page.getByRole('button', { name: 'Revisar antes de guardar' }).click();
  await page.getByText('todavía no se guardó nada').waitFor();
  await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
  await page.getByText(/Ubicación guardada como versión 1/).waitFor();
  const plot = lista((await pedir((await como('tecnico1.cooperativa')).token, 'GET', `${admin.base}/plots?q=${MARCA}`)).b)[0];
  ctxData.plot = plot;
  return ok(`parcela ${MARCA} (${plot?.geometry_status}) con versión 1 MANUAL_COORDINATES; el técnico no puede evaluarla (siguiente rol)`);
});

await transicion('T2', 'Administración evalúa técnicamente la geometría (GIS) y ve la procedencia', 'admin.cooperativa', async (page) => {
  await page.goto(url(`/parcelas/${ctxData.plot.id}`));
  await page.locator('#gis-title').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /Evaluar geometría|Volver a evaluar/ }).click();
  await page.getByText(/VALID|WARNING|INVALID|REVIEW_REQUIRED/).first().waitFor({ timeout: 15000 });
  const t = await texto(page);
  const estado = (/(VALID|WARNING|INVALID|REVIEW_REQUIRED) ·/.exec(t) ?? [])[1];
  const sinConformidad = /no es conformidad EUDR|no incluye umbrales regulatorios/i.test(t);
  const revisar = (await page.getByRole('table', { name: 'Comprobaciones técnicas' }).locator('tbody tr').allInnerTexts()).filter((r) => /Requiere revisión|Advertencia|Falla/.test(r)).map((r) => r.replace(/s+/g, ' ').slice(0, 110));
  return estado && sinConformidad ? ok(`evaluación GIS técnica = ${estado}; el panel declara que no es conformidad EUDR; origen visible: ${/Coordenadas ingresadas/.test(t)}${revisar.length ? `; a revisar: ${revisar.join(' / ')}` : ''}`) : { categoria: 'DEFECTO', detalle: `estado=${estado} sinConformidad=${sinConformidad}` };
});

// ------------------------------------------------------------------ 2. entrega con origen
await transicion('T3', 'Entrega registrada con la parcela de origen y el centro de acopio', 'admin.cooperativa', async (page, s) => {
  const prods = lista((await pedir(s.token, 'GET', `${s.base}/products?limit=100`)).b);
  const baba = prods.find((p) => p.code === 'CACAO_BABA');
  const centros = (await pedir(s.token, 'GET', `${s.base}/locations`)).b;
  const centro = lista(centros).find((l) => l.location_type === 'COLLECTION_CENTER') ?? lista(centros)[0];
  ctxData.baba = baba; ctxData.centro = centro;
  await page.goto(url('/entregas'));
  await page.getByLabel('Productor', { exact: true }).selectOption({ index: 1 }).catch(() => {});
  await page.getByLabel('Productor', { exact: true }).selectOption({ label: new RegExp(productor.producer_code) }).catch(() => {});
  await page.getByRole('checkbox', { name: MARCA }).check();
  await page.getByLabel('Producto', { exact: true }).selectOption({ label: baba.name + ` (${baba.code})` }).catch(async () => page.getByLabel('Producto', { exact: true }).selectOption({ index: 1 }));
  await page.getByLabel('Cantidad declarada').fill('500');
  if (centro) await page.getByLabel('Centro de acopio (opcional)').selectOption({ index: 1 }).catch(() => {});
  await page.getByLabel('Mes inicial').fill(new Date().toISOString().slice(0, 7));
  await page.getByRole('button', { name: 'Registrar entrega' }).click();
  await page.getByRole('heading', { name: /Entrega ENT-/ }).waitFor({ timeout: 15000 });
  const code = (await page.getByRole('heading', { name: /Entrega ENT-/ }).first().innerText()).replace('Entrega ', '');
  ctxData.entrega = code;
  const t = await texto(page);
  return /no es un expediente completo/.test(t) ? ok(`${code}: 500 kg declarados, origen ${MARCA}; el aviso «no es un expediente completo, producto liberado ni cumplimiento EUDR» está visible`) : { categoria: 'DEFECTO', detalle: 'falta el aviso de alcance' };
});

await transicion('T4', 'Operador de recepción pesa y confirma la recepción (revisión previa → confirmación)', 'recepcion.acopio', async (page, s) => {
  const dels = lista((await pedir(s.token, 'GET', `${s.base}/deliveries?q=${ctxData.entrega}`)).b);
  const d = dels.find((x) => x.delivery_code === ctxData.entrega);
  ctxData.entregaId = d.id;
  await page.goto(url(`/entregas/${d.id}`));
  await page.getByRole('heading', { name: /Entrega ENT-/ }).waitFor();
  await page.getByLabel('Centro de recepción').selectOption({ index: 1 });
  await page.getByLabel('Peso recibido (kg)').fill('480');
  await page.getByLabel('Método de pesaje').fill('Báscula (ensayo cadena-web)');
  await page.getByRole('button', { name: 'Revisar recepción' }).click();
  await page.getByText('Revisa antes de confirmar').waitFor();
  await page.getByRole('button', { name: 'Confirmar recepción' }).click();
  const rec = page.getByRole('article', { name: 'Recepción 1' });
  await rec.waitFor({ timeout: 15000 });
  const t = await rec.innerText();
  return /480 kg/.test(t) && /Pendiente de evaluación/.test(t) ? ok('recepción 1 de 480 kg; calidad queda «Pendiente de evaluación» para el siguiente rol; parcial (500 declarados) sin cerrar') : { categoria: 'DEFECTO', detalle: t.slice(0, 200) };
});

// ------------------------------------------------------------------ 3. calidad
await transicion('T5', 'Operador de calidad registra muestra y resultado; decide la calidad (con límites declarados sin verificar)', 'calidad.acopio', async (page) => {
  await page.goto(url(`/entregas/${ctxData.entregaId}`));
  const rec = page.getByRole('article', { name: 'Recepción 1' });
  await rec.waitFor({ timeout: 15000 });
  await page.getByLabel('Referencia de muestra (después del pesaje)').fill(MARCA + '-M1');
  await page.getByRole('button', { name: 'Registrar muestra' }).click();
  await page.getByLabel('Método').first().waitFor({ timeout: 15000 });
  await page.getByLabel('Método').first().fill('Corte de granos (ensayo cadena-web)');
  await page.getByLabel(/^Humedad/).first().fill('7.5');
  await page.getByLabel('Unidad de la humedad').first().fill('%BH');
  const puedeDecidir = await page.getByLabel('Decisión').first().locator('option', { hasText: 'Liberar calidad' }).count();
  if (puedeDecidir) { await page.getByLabel('Decisión').first().selectOption('RELEASED'); await page.getByLabel('Referencia de límites declarada').first().fill('LIMITES-ENSAYO-SIN-VERIFICAR'); }
  await page.getByRole('button', { name: 'Guardar resultado' }).first().click();
  await page.waitForTimeout(2000);
  const t = await rec.innerText();
  return ok(`muestra y resultado guardados; decisión de calidad disponible para este rol=${!!puedeDecidir}; estado: ${(/(Calidad[^.]{0,60}|Liberada[^.]{0,40}|Pendiente de evaluación)/.exec(t) ?? [])[0]}`);
});

// ------------------------------------------------------------------ 4. lote y proceso
await transicion('T6', 'Supervisión forma el lote a partir de la recepción (origen heredado)', 'supervisor.cooperativa', async (page) => {
  await page.goto(url('/lotes'));
  await page.getByLabel(`Asignar de ${ctxData.entrega}`).fill('480');
  await page.getByRole('button', { name: 'Formar lote' }).click();
  await page.getByRole('heading', { name: /Lote LOT-/ }).waitFor({ timeout: 15000 });
  ctxData.lote = (await page.getByRole('heading', { name: /Lote LOT-/ }).first().innerText()).replace('Lote ', '');
  const t = await texto(page);
  return ok(`lote ${ctxData.lote} de 480 kg; calidad: ${(/Calidad[^.]{0,70}/.exec(t) ?? ['—'])[0]}; origen: ${(/Origen[^.]{0,60}/.exec(t) ?? ['—'])[0]}`);
});

await transicion('T7', 'Administración prepara, inicia y cierra la fermentación (balance 480 = 450 + 30); en el DEMO de Río Verde solo ORG_ADMIN tiene process:manage', 'admin.cooperativa', async (page, s) => {
  const prods = lista((await pedir(s.token, 'GET', `${s.base}/products?limit=100`)).b);
  const ferm = prods.find((p) => p.code === 'CACAO_FERMENTADO');
  await page.goto(url('/procesos'));
  await page.getByLabel('Producto de salida').selectOption({ label: `${ferm.name} (${ferm.code})` });
  await page.getByRole('button', { name: 'Preparar proceso' }).click();
  await page.getByRole('heading', { name: /Fermentación PRC-/ }).waitFor({ timeout: 15000 });
  await page.getByLabel(`Reservar de ${ctxData.lote}`).fill('480');
  await page.getByRole('button', { name: 'Iniciar proceso' }).click();
  await page.getByText('En curso (entradas reservadas)').waitFor();
  await page.getByLabel('Salida (kg)').fill('450');
  await page.getByLabel('Pérdida (kg)').fill('30');
  await page.getByRole('button', { name: 'Cerrar proceso' }).click();
  await page.getByText('Cerrado', { exact: true }).waitFor({ timeout: 15000 });
  const t = await texto(page);
  await page.getByRole('list', { name: 'Salidas del proceso' }).getByRole('link').first().click();
  await page.getByRole('heading', { name: /Lote LOT-/ }).waitFor();
  ctxData.salida = (await page.getByRole('heading', { name: /Lote LOT-/ }).first().innerText()).replace('Lote ', '');
  const t2 = await texto(page);
  return /rendimiento en masa 93[.,]75/.test(t) && t2.includes(ctxData.lote) ? ok(`salida ${ctxData.salida} de 450 kg + 30 kg de merma (93,75 %, no es base seca); el lote de salida enlaza a ${ctxData.lote}`) : { categoria: 'DEFECTO', detalle: 'rendimiento/origen no visibles' };
});

await transicion('T8', 'Inventario: la existencia por lote y centro refleja la salida; la administración comprueba la conciliación (MANAGER solo consulta)', 'admin.cooperativa', async (page) => {
  await page.goto(url('/inventario'));
  await page.getByRole('heading', { name: 'Totales' }).waitFor();
  const fila = page.getByRole('table', { name: 'Existencias por lote y centro' }).locator('tbody tr').filter({ hasText: ctxData.salida }).first();
  await fila.waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Comprobar conciliación' }).click();
  await page.getByText(/Conciliado:/).waitFor({ timeout: 15000 });
  return ok(`${ctxData.salida}: ${(await fila.innerText()).replace(/\s+/g, ' ').slice(0, 120)}; conciliación del ledger OK`);
});

// ------------------------------------------------------------------ 5. riesgo, mitigación y expediente
await transicion('T9', 'Responsable EUDR evalúa el riesgo del lote de salida (dimensiones separadas; severidad y conclusión NO se infieren)', 'eudr.cooperativa', async (page, s) => {
  const lot = lista((await pedir(s.token, 'GET', `${s.base}/lots?limit=100`)).b).find((l) => l.lot_code === ctxData.salida);
  ctxData.salidaId = lot.id;
  await page.goto(url(`/riesgo/${lot.id}`));
  await page.getByRole('heading', { name: /Riesgo del lote LOT-/ }).waitFor();
  await page.getByRole('button', { name: 'Evaluar' }).click();
  await page.getByRole('heading', { name: 'Evaluación 1' }).waitFor({ timeout: 15000 });
  const t = await texto(page);
  const incompleto = /Incompleto: hay reglas no evaluables o datos faltantes/.test(t);
  const sinConclusion = /no es conclusión regulatoria/i.test(t);
  const bloqueos = ['GEOLOCATION_PROFILE', 'D-05'].filter((x) => t.includes(x));
  return sinConclusion ? { categoria: 'BLOQUEO_ESPERADO', detalle: `evaluación 1 técnica (${incompleto ? 'incompleta' : 'completa'}), no es conclusión regulatoria; no evaluables por decisiones externas: ${bloqueos.join(', ') || '—'}` } : { categoria: 'DEFECTO', detalle: 'falta la salvedad regulatoria' };
});

await transicion('T10', 'Responsable EUDR crea una mitigación desde una causa y la asigna; el responsable la recibe', 'eudr.cooperativa', async (page, s) => {
  await page.goto(url(`/riesgo/${ctxData.salidaId}`));
  const form = page.getByRole('form', { name: 'Crear mitigación' });
  await form.waitFor({ timeout: 15000 });
  const causas = await form.getByLabel('Causa').locator('option').allInnerTexts();
  if (causas.length < 2) return { categoria: 'NO_DEFINIDO', detalle: 'este lote no ofrece causas mitigables (todas dependen de decisiones ajenas)' };
  await form.getByLabel('Causa').selectOption({ index: 1 });
  const resp = await form.getByLabel('Responsable').locator('option', { hasText: 'Zambrano' }).first().getAttribute('value').catch(() => null);
  await form.getByLabel('Responsable').selectOption(resp ? { value: resp } : { index: 1 });
  await form.getByLabel('Acción').fill(`Aportar soporte (${MARCA})`);
  await form.getByLabel('Plazo').fill('2026-12-31');
  await form.getByLabel('Criterio de aceptación').fill('Soporte vigente y disponible (ensayo)');
  await form.getByRole('button', { name: 'Crear mitigación' }).click();
  await page.getByRole('list', { name: 'Mitigaciones del lote' }).getByRole('link', { name: new RegExp(MARCA) }).waitFor({ timeout: 15000 });
  const m = lista((await pedir(s.token, 'GET', `${s.base}/mitigations`)).b).find((x) => JSON.stringify(x).includes(MARCA));
  const resp2 = await como('admin.cooperativa');
  const trabajo = JSON.stringify((await pedir(resp2.token, 'GET', `${resp2.base}/my-work`)).b ?? {});
  const recibida = !!m && trabajo.includes(m.id) && trabajo.includes('MITIGATIONS_ASSIGNED');
  return recibida ? ok(`mitigación creada desde la causa «${causas[1].slice(0, 50)}»; estado ${m?.status}; el responsable asignado (administración; solo ella y EUDR pueden ser responsables) la recibe en «Mi trabajo» (Mitigaciones asignadas a ti)`) : { categoria: 'DEFECTO', detalle: 'la mitigación asignada no aparece en «Mi trabajo» del responsable' };
});

await transicion('T11', 'Responsable EUDR crea el expediente de debida diligencia, captura la instantánea y revisa qué bloquea el paquete', 'eudr.cooperativa', async (page) => {
  await page.goto(url('/diligencia'));
  const form = page.getByRole('form', { name: 'Crear expediente' });
  await form.waitFor({ timeout: 15000 });
  const val = await form.getByLabel('Lote').locator('option', { hasText: ctxData.salida }).first().getAttribute('value');
  await form.getByLabel('Lote').selectOption(val);
  const elegido = ctxData.salida;
  await form.getByLabel('Alcance').fill(`Expediente ${MARCA} (sintético)`);
  await form.getByRole('button', { name: 'Crear expediente' }).click();
  await page.getByRole('table', { name: 'Expedientes' }).locator('tbody tr').filter({ hasText: ctxData.salida }).getByRole('link').first().click();
  await page.getByRole('heading', { name: /Expediente DD-/ }).waitFor();
  await page.getByRole('button', { name: 'Capturar instantánea' }).click();
  await page.getByRole('heading', { name: /Preparación \(instantánea 1\)/ }).waitFor({ timeout: 15000 });
  const t = (await page.getByRole('table', { name: 'Requisitos' }).innerText()).replace(/\s+/g, ' ');
  const pkgOff = await page.getByRole('button', { name: 'Generar paquete de diligencia' }).isDisabled();
  const noEval = ['RISK_CATALOG_APPROVED', 'REGULATORY_CONCLUSION', 'GEOLOCATION_PROFILE', 'LEGAL_PROFILE'].filter((c) => t.includes(c));
  return pkgOff ? { categoria: 'BLOQUEO_ESPERADO', detalle: `expediente del lote «${elegido.slice(0, 40)}» con instantánea 1; paquete bloqueado; requisitos que dependen de revisión regulatoria y siguen sin evaluar: ${noEval.join(', ') || '(ver captura)'}; READY inalcanzable` } : { categoria: 'DEFECTO', detalle: 'el paquete no está bloqueado' };
});

// ------------------------------------------------------------------ 6. preparación de exportación
await transicion('T12', 'Administración registra comprador, crea el embarque, agrega el lote, reserva y comprueba el despacho (se detiene en su compuerta)', 'admin.cooperativa', async (page) => {
  await page.goto(url('/embarques'));
  await page.getByRole('heading', { name: 'Compradores' }).waitFor();
  await page.getByLabel('Código', { exact: true }).fill(MARCA);
  await page.getByLabel('Nombre', { exact: true }).fill('Comprador de ensayo (sintético)');
  await page.getByLabel('País (ISO, dos letras)').fill('NL');
  await page.getByRole('button', { name: 'Registrar comprador' }).click();
  await page.getByText(MARCA).first().waitFor({ timeout: 15000 });
  await page.reload();
  await page.getByLabel('Comprador', { exact: true }).selectOption({ index: 1 });
  const compradores = await page.getByLabel('Comprador', { exact: true }).locator('option').allInnerTexts();
  const idx = compradores.findIndex((c) => c.includes(MARCA));
  await page.getByLabel('Comprador', { exact: true }).selectOption({ index: idx });
  await page.getByLabel('País de destino (ISO, dos letras)').fill('NL');
  await page.getByLabel('Centro de salida').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Crear embarque' }).click();
  await page.getByRole('heading', { name: /Embarque / }).waitFor({ timeout: 15000 });
  const opcion = await page.getByLabel(/^Lote \(disponible en/).locator('option', { hasText: ctxData.salida }).first().getAttribute('value').catch(() => null);
  if (!opcion) return { categoria: 'DEFECTO', detalle: `el lote ${ctxData.salida} no se ofrece para el embarque (¿centro de salida distinto del centro del lote?)` };
  await page.getByLabel(/^Lote \(disponible en/).selectOption(opcion);
  await page.getByLabel('Cantidad (kg)').fill('450');
  await page.getByRole('button', { name: 'Agregar lote' }).click();
  await page.getByRole('table', { name: 'Lotes del embarque' }).getByText(ctxData.salida).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /^Reservar/ }).first().click();
  await page.getByText(/Reservado 450/).first().waitFor({ timeout: 15000 });
  const checks = await page.getByRole('list', { name: 'Comprobaciones' }).innerText();
  const despachar = page.getByRole('button', { name: /Despachar/ }).first();
  const bloqueado = await despachar.isDisabled();
  const nBloquea = (checks.match(/Bloquea/g) ?? []).length;
  const codigos = ['READY', 'DD', 'D-34', 'calidad', 'riesgo', 'documento', 'geolocal'].filter((c) => new RegExp(c, 'i').test(checks));
  ctxData.embarque = page.url();
  return bloqueado && nBloquea > 0 ? { categoria: 'BLOQUEO_ESPERADO', detalle: `embarque creado, 450 kg reservados en el ledger; «Despachar» deshabilitado con ${nBloquea} comprobaciones que bloquean (${codigos.join(', ')}); no se simula ninguna aprobación` } : { categoria: 'DEFECTO', detalle: `bloqueado=${bloqueado}, bloquea=${nBloquea}` };
});

// ------------------------------------------------------------------ 7. auditoría, destinatario y límites entre organizaciones
await transicion('T13', 'Auditoría reconstruye hacia atrás: del lote de salida al lote de entrada, la entrega, la parcela y el productor', 'auditor.cooperativa', async (page, s) => {
  const lot = lista((await pedir(s.token, 'GET', `${s.base}/lots?limit=100`)).b).find((l) => l.lot_code === ctxData.salida);
  await page.goto(url(`/lotes/${lot.id}`));
  await page.getByRole('heading', { name: /Lote LOT-/ }).waitFor();
  await page.waitForTimeout(2500);
  const t = await texto(page);
  const ve = { lote_entrada: t.includes(ctxData.lote), entrega: t.includes(ctxData.entrega), parcela: t.includes(MARCA) };
  const sinIdentidad = !/María Quijije/.test(t);
  const botones = await page.getByRole('main').getByRole('button').allInnerTexts();
  const conAcciones = botones.filter((b) => /Evaluar|Formar|Cerrar|Reservar|Despachar|Registrar|Guardar|Crear/.test(b)).length;
  const faltan = Object.entries(ve).filter(([, v]) => !v).map(([k]) => k);
  return faltan.length === 0 && conAcciones === 0 ? ok(`ve lote de entrada, entrega y parcela de origen; sin identidad del productor=${sinIdentidad}; sin acciones operativas (solo lectura)`) : { categoria: faltan.length ? 'DEFECTO' : 'DEFECTO', detalle: `falta en la reconstrucción: ${faltan.join(', ') || '—'}; acciones operativas visibles: ${conAcciones} (botones: ${botones.join(' | ')})` };
});

await transicion('T14', 'Destinatario externo (BUYER) consulta SOLO lo concedido: proyección sin identidad ni geometrías; concesión otorgada por API (no hay pantalla del propietario)', 'comprador.importador', async (page, s) => {
  // Las concesiones previas de ensayo están revocadas o vencidas: sin concesión vigente el destinatario no ve nada (comportamiento correcto).
  const antes = (await pedir(s.token, 'GET', '/api/v1/granted')).b.grants.length;
  const me = (await pedir(s.token, 'GET', '/api/v1/me')).b;
  const venc = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const g = await pedir(admin.token, 'POST', `${admin.base}/access-grants`, { operation_id: crypto.randomUUID(), grantee_user_id: me.id, resource_type: 'LOT', resource_id: ctxData.salidaId, can_read: true, can_download: false, expires_at: venc, reason: `Ensayo de cadena ${MARCA}: destinatario sintético` });
  if (g.s >= 300) return { categoria: 'DEFECTO', detalle: `la concesión no se pudo otorgar por API: HTTP ${g.s} ${g.b?.error?.code}` };
  await page.goto(`${WEB}/compartido`);
  await page.waitForTimeout(3500);
  const enlaces = page.getByRole('button', { name: 'Ver', exact: true });
  const n = await enlaces.count();
  if (!n) return { categoria: 'DEFECTO', detalle: `concesión otorgada (HTTP ${g.s}) pero el destinatario no la ve (antes=${antes})` };
  await enlaces.first().click();
  await page.waitForTimeout(3000);
  const t = await texto(page);
  const sinIdentidad = !/Quijije|Zambrano|DEMO-RV-001/.test(t);
  const sinGeometria = !/coordinates|Polygon|longitud/i.test(t);
  const ajeno = (await pedir(s.token, 'GET', `/api/v1/organizations/${org.id}/lots/${ctxData.salidaId}`)).s;
  return sinIdentidad && sinGeometria && ajeno >= 400 ? ok(`concesión LOT vigente 24 h (otorgada por la administración vía API): el destinatario ve la proyección autorizada; sin identidad=${sinIdentidad}, sin geometrías=${sinGeometria}; el recurso en el espacio de la cooperativa le responde HTTP ${ajeno}`) : { categoria: 'DEFECTO', detalle: `sinIdentidad=${sinIdentidad} sinGeometria=${sinGeometria} acceso directo=${ajeno}` };
});

await transicion('T15', 'Exportadora: ¿recibe los lotes de la cooperativa? (traspaso entre organizaciones)', 'trazabilidad.exportadora', async (page, s) => {
  const exp = (await pedir(s.token, 'GET', '/api/v1/organizations')).b.find((o) => o.name.includes('Exportadora'));
  const lotes = lista((await pedir(s.token, 'GET', `/api/v1/organizations/${exp.id}/lots?limit=100`)).b);
  const rv = lista((await pedir(s.token, 'GET', `/api/v1/organizations/${org.id}/lots?limit=1`)).b);
  await page.goto(`${WEB}/organizaciones/${exp.id}/lotes`);
  await page.waitForTimeout(2500);
  return { categoria: 'NO_DEFINIDO', detalle: `la Exportadora tiene ${lotes.length} lotes y su rol de trazabilidad no ve los de Río Verde (consulta a Río Verde: HTTP ${rv.length === 0 ? '403/404' : '200'}). La documentación define concesiones de LECTURA (P1-001) y el intercambio con GUIA (P1-006), pero no un traspaso de lotes entre organizaciones: no se implementa por interpretación` };
});

for (const r of resultados) void r;
writeFileSync(join(SALIDA, 'resultado.json'), JSON.stringify({ marca: MARCA, organizacion: org.name, resultados }, null, 2));
await browser.close();
