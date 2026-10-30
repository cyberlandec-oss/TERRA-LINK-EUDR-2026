// QA integral — PARTE B: cadena con cambio de actor sobre las CUENTAS VIGENTES (sin crear usuarios ni cambiar claves; sin seed).
//   node e2e/review/qa-cadena-distribuida.mjs [--base http://localhost:4000] [--web http://localhost:3000]
// Productor (hecho aparte) → técnico → acopio → calidad → lote → expediente → concesión de soportes → comprador → auditoría, y la autorización satelital
// propietaria → exportadora. Crea registros SINTÉTICOS rotulados «QA-1030» en la Cooperativa Río Verde (el DEMO); idempotente: reutiliza los que ya existan.
// No imprime contraseñas ni testigos. Cada comprobación verifica sus precondiciones y acompaña toda denegación con un control autorizado.
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--base', 'http://localhost:4000');
const WEB = arg('--web', 'http://localhost:3000');
const SALIDA = join('validation-results', 'qa-integral-2026-10-30');
mkdirSync(SALIDA, { recursive: true });
const res = [];
async function caso(titulo, fn) {
  try { const [ok, det] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(118)} ${det ?? ''}`); res.push({ titulo, ok, det }); return ok; }
  catch (e) { console.log(`FALLA ${titulo.padEnd(118)} ${String(e.message).slice(0, 240)}`); res.push({ titulo, ok: false, det: String(e.message).slice(0, 240) }); return false; }
}
const pedir = async (t, m, p, body) => { const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); let b = null; try { b = await r.json(); } catch { /* sin cuerpo */ } return { s: r.status, b }; };
const login = async (l) => { const c = cuentaDemo(l); const r = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) }); if (r.status !== 200) throw new Error('login ' + l); return (await r.json()).access_token; };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.members ?? b?.grants ?? []);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hoy = new Date().toISOString().slice(0, 10);

const T = {};
for (const a of ['admin.cooperativa', 'tecnico1.cooperativa', 'tecnico2.cooperativa', 'recepcion.acopio', 'calidad.acopio', 'supervisor.cooperativa', 'eudr.cooperativa', 'auditor.cooperativa', 'admin.exportadora', 'exportacion.exportadora', 'comprador.importador', 'admin.importador']) T[a] = await login(a);
const orgsDe = async (t) => lista((await pedir(t, 'GET', '/api/v1/organizations')).b);
const coop = (await orgsDe(T['admin.cooperativa'])).find((o) => o.name.includes('Cooperativa'));
const expo = (await orgsDe(T['admin.exportadora'])).find((o) => o.name.includes('Exportadora'));
const B = `/api/v1/organizations/${coop.id}`;
// «recepcion.acopio» y «calidad.acopio» tienen DOS membresías: operan en la Cooperativa con SU contexto de cooperativa.
const rolesEn = async (t, org) => (await pedir(t, 'GET', '/api/v1/me/permissions')).b.organizations.find((o) => o.organization_id === org)?.roles ?? [];
const E = {}; // estado de la cadena
import { execFileSync } from 'node:child_process';
const psql = (q) => execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-At', '-F', '|', '-c', q], { encoding: 'utf8' }).trim();

await caso('0. Contextos: las cuentas operan con el rol que corresponde en la Cooperativa (recepción y calidad tienen dos membresías)', async () => {
  const r = { recep: await rolesEn(T['recepcion.acopio'], coop.id), cal: await rolesEn(T['calidad.acopio'], coop.id), tec: await rolesEn(T['tecnico1.cooperativa'], coop.id), eudr: await rolesEn(T['eudr.cooperativa'], coop.id) };
  return [r.recep.join() === 'RECEPTION_OPERATOR' && r.cal.join() === 'QUALITY_OPERATOR' && r.tec.join() === 'FIELD_TECHNICIAN' && r.eudr.join() === 'EUDR_MANAGER', JSON.stringify(r)];
});

// ---------------------------------------------------------------- 1. Administración crea el productor QA asignado al técnico 1; el técnico captura
await caso('1. ORG_ADMIN registra productor y parcela QA-1030 (asignado al técnico 1); el técnico 1 captura el polígono; el técnico 2 y lo no asignado → 404', async () => {
  const miembros = lista((await pedir(T['admin.cooperativa'], 'GET', `${B}/members`)).b);
  const memT1 = miembros.find((m) => m.email === 'tecnico1.cooperativa@demo.terralink.local')?.membership_id;
  if (!memT1) throw new Error('no se halló la membresía del técnico 1');
  const ya = lista((await pedir(T['admin.cooperativa'], 'GET', `${B}/producers?status=ALL&q=QA-1030`)).b).find((p) => p.producer_code === 'QA-1030-P');
  E.prod = ya?.id ?? (await pedir(T['admin.cooperativa'], 'POST', `${B}/producers`, { producer_code: 'QA-1030-P', legal_name: 'Finca QA-1030 (sintética)', assigned_membership_id: memT1 })).b?.id;
  const planos = lista((await pedir(T['admin.cooperativa'], 'GET', `${B}/plots?limit=100`)).b);
  E.plot = planos.find((p) => p.plot_code === 'QA-1030-PAR')?.id ?? (await pedir(T['admin.cooperativa'], 'POST', `${B}/plots`, { producer_id: E.prod, plot_code: 'QA-1030-PAR', crop: 'Cacao' })).b?.id;
  const vs0 = lista((await pedir(T['tecnico1.cooperativa'], 'GET', `${B}/plots/${E.plot}/geometry-versions`)).b).length;
  if (vs0 === 0) {
    const g = await pedir(T['tecnico1.cooperativa'], 'POST', `${B}/plots/${E.plot}/geometry-versions`, { expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Polygon', coordinates: [[[-79.401, -1.001], [-79.4, -1.001], [-79.4, -1], [-79.401, -1], [-79.401, -1.001]]] } });
    if (g.s !== 201) throw new Error('captura del técnico ' + g.s);
  }
  const vs = lista((await pedir(T['tecnico1.cooperativa'], 'GET', `${B}/plots/${E.plot}/geometry-versions`)).b);
  const mia = (await pedir(T['tecnico1.cooperativa'], 'GET', `${B}/plots/${E.plot}`)).s;
  const otro = (await pedir(T['tecnico2.cooperativa'], 'GET', `${B}/plots/${E.plot}`)).s;
  const noAsignada = lista((await pedir(T['admin.cooperativa'], 'GET', `${B}/plots?limit=100`)).b).find((p) => p.plot_code === 'DEMO-PAR-005');
  const t1NoAsig = noAsignada ? (await pedir(T['tecnico1.cooperativa'], 'GET', `${B}/plots/${noAsignada.id}`)).s : 'n/d';
  const escribeAjena = (await pedir(T['tecnico2.cooperativa'], 'POST', `${B}/plots/${E.plot}/geometry-versions`, { expected_version: 2, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-79.4, -1] } })).s;
  return [E.prod && E.plot && vs.length >= 1 && mia === 200 && otro === 404 && t1NoAsig === 404 && escribeAjena === 404,
    `versiones=${vs.length} (${vs[0]?.survey_method}) · técnico1 propia=${mia} · técnico2=${otro} · técnico1 sobre DEMO-PAR-005 (de otro técnico)=${t1NoAsig} · escribir sin asignación=${escribeAjena}`];
});

// ---------------------------------------------------------------- 2. Acopio: entrega y recepción sin doble stock
await caso('2. RECEPCIÓN: entrega declarada con su origen y recepción con peso y muestra; el reintento NO duplica la recepción ni el stock; no crea productores', async () => {
  const productos = lista((await pedir(T['recepcion.acopio'], 'GET', `${B}/products?limit=100`)).b);
  const producto = productos.find((p) => p.code === 'CACAO_BABA') ?? productos[0];
  const centros = lista((await pedir(T['recepcion.acopio'], 'GET', `${B}/locations`)).b);
  const centro = centros.find((l) => l.location_type === 'COLLECTION_CENTER') ?? centros[0];
  const prev = psql(`select id from deliveries where producer_id = '${E.prod}' order by created_at limit 1`);
  if (prev) E.delivery = prev;
  else {
    const d = await pedir(T['recepcion.acopio'], 'POST', `${B}/deliveries`, { operation_id: randomUUID(), producer_id: E.prod, product_id: producto.id, delivery_date: hoy, quantity_declared: '100', unit: 'KG', origins: [{ plot_id: E.plot }], register: true, notes: 'QA-1030 recorrido integral (sintético)' });
    if (d.s !== 201) throw new Error('entrega ' + d.s + ' ' + JSON.stringify(d.b?.error?.code));
    E.delivery = d.b.delivery.id;
  }
  const ver = async () => (await pedir(T['recepcion.acopio'], 'GET', `${B}/deliveries/${E.delivery}`)).b;
  let v = await ver();
  if (!(v.receptions ?? []).length) {
    E.opRec = randomUUID();
    const cuerpo = { operation_id: E.opRec, location_id: centro.id, received_at: new Date().toISOString(), weighing: { method: 'Báscula sintética', quantity: '100', unit: 'KG', weighed_on: hoy }, quality_sample: { sample_reference: 'M-QA-1030' } };
    const r1 = await pedir(T['recepcion.acopio'], 'POST', `${B}/deliveries/${E.delivery}/receptions`, cuerpo);
    const r2 = await pedir(T['recepcion.acopio'], 'POST', `${B}/deliveries/${E.delivery}/receptions`, cuerpo); // reintento idempotente
    if (r1.s !== 201) throw new Error('recepción ' + r1.s + ' ' + JSON.stringify(r1.b?.error?.code));
    E.reintento = `${r2.s}/${r2.b?.reception_id === r1.b?.reception_id}`;
    v = await ver();
  }
  E.rec = v.receptions[0].id ?? v.receptions[0].reception_id;
  const prohib = (await pedir(T['recepcion.acopio'], 'POST', `${B}/producers`, { producer_code: 'QA-1030-X', legal_name: 'No debe crearse' })).s;
  const n = v.receptions.length;
  return [n === 1 && prohib === 403 && (E.reintento === undefined || /^(200|201)\/true$/.test(E.reintento)), `recepciones=${n} · reintento idempotente=${E.reintento ?? '(ya existía)'} · recepción crea productor=${prohib}`];
});

// ---------------------------------------------------------------- 3. Calidad
await caso('3. CALIDAD: decisión humana (liberada, límites declarados) guardada; la recepción NO decide calidad', async () => {
  const v = (await pedir(T['calidad.acopio'], 'GET', `${B}/deliveries/${E.delivery}`)).b;
  const muestra = v.receptions[0].quality.samples[0];
  const rec = v.receptions[0].id ?? v.receptions[0].reception_id;
  const cuerpo = { operation_id: randomUUID(), method: 'Prueba sintética QA-1030', decision: 'RELEASED', limits_version: 'LIMITES-QA-1030 (declarados)' };
  const yaDecidida = v.receptions[0].quality.status === 'RELEASED';
  const nega = (await pedir(T['recepcion.acopio'], 'POST', `${B}/deliveries/${E.delivery}/receptions/${rec}/quality-samples/${muestra.id}/results`, cuerpo)).s;
  let dec = 201;
  if (!yaDecidida) dec = (await pedir(T['calidad.acopio'], 'POST', `${B}/deliveries/${E.delivery}/receptions/${rec}/quality-samples/${muestra.id}/results`, cuerpo)).s;
  const despues = (await pedir(T['calidad.acopio'], 'GET', `${B}/deliveries/${E.delivery}`)).b.receptions[0].quality;
  return [nega === 403 && dec === 201 && despues.status === 'RELEASED' && /No es liberación jurídica/.test(despues.note ?? ''), `recepción decide=${nega} · calidad decide=${dec} · estado=${despues.status} · «${(despues.status_label ?? '').slice(0, 70)}»`];
});

// ---------------------------------------------------------------- 4. Soporte de la entrega y lote
await caso('4. Soporte de la entrega (PDF) con huella, vinculado por la administración; el MANAGER crea el lote desde la recepción (cantidad y origen conservados)', async () => {
  E.pdf = Buffer.from(`%PDF-1.4\n% soporte sintético QA-1030 ${randomUUID()}\n%%EOF\n`);
  const docs = lista((await pedir(T['admin.cooperativa'], 'GET', `${B}/documents?owner_type=producer&owner_id=${E.prod}`)).b).filter((d) => /QA-1030/.test(d.title));
  if (docs.length) { E.docV = docs[0].versions[0].id; E.docSha = docs[0].versions[0].sha256; E.docTitulo = docs[0].title; }
  else {
    const f = new FormData(); f.append('operation_id', randomUUID()); f.append('document_type', 'DELIVERY_SUPPORT'); f.append('owner_type', 'producer'); f.append('owner_id', E.prod); f.append('title', 'Nota de entrega QA-1030 (sintética)');
    f.append('file', new Blob([E.pdf], { type: 'application/pdf' }), 'nota-qa-1030.pdf');
    const up = await fetch(`${API}${B}/documents`, { method: 'POST', headers: { authorization: `Bearer ${T['admin.cooperativa']}` }, body: f });
    if (up.status !== 201) throw new Error('subir soporte ' + up.status);
    const d = (await up.json()).document; E.docV = d.versions[0].id; E.docSha = d.versions[0].sha256; E.docTitulo = d.title;
    const l = await pedir(T['admin.cooperativa'], 'POST', `${B}/deliveries/${E.delivery}/supports`, { operation_id: randomUUID(), document_version_id: E.docV, support_kind: 'DELIVERY_NOTE' });
    if (l.s !== 201) throw new Error('vincular soporte ' + l.s + ' ' + JSON.stringify(l.b?.error?.code));
  }
  let lot = psql(`select i.lot_id from lot_inputs i join receptions r on r.id = i.reception_id where r.delivery_id = '${E.delivery}'  limit 1`) || undefined;
  if (!lot) {
    const c = await pedir(T['supervisor.cooperativa'], 'POST', `${B}/lots`, { operation_id: randomUUID(), inputs: [{ reception_id: E.rec, quantity: '100' }] });
    if (c.s !== 201) throw new Error('lote ' + c.s + ' ' + JSON.stringify(c.b?.error?.code) + ' ' + JSON.stringify(c.b?.error?.details ?? ''));
    lot = c.b.lot.id;
  }
  E.lot = lot;
  const det = (await pedir(T['supervisor.cooperativa'], 'GET', `${B}/lots/${lot}`)).b;
  const noCrea = (await pedir(T['auditor.cooperativa'], 'POST', `${B}/lots`, { operation_id: randomUUID(), inputs: [{ reception_id: E.rec, quantity: '1' }] })).s;
  return [!!E.docV && !!lot && noCrea === 403, `soporte v${E.docV.slice(0, 8)}… sha=${E.docSha.slice(0, 12)}… · lote=${(det.lot_code ?? det.lot?.lot_code ?? '')} origen=${det.origin_status ?? det.lot?.origin_status ?? '?'} · auditor crea lote=${noCrea}`];
});

// ---------------------------------------------------------------- 5. Expediente
await caso('5. EUDR: expediente e instantánea del lote; los requisitos pendientes se muestran como lo que son (no se fuerza READY); quien no gestiona no abre expedientes', async () => {
  const casos = lista((await pedir(T['eudr.cooperativa'], 'GET', `${B}/dd-cases`)).b);
  let caso0 = casos.find((c) => c.lot_id === E.lot || c.subject_id === E.lot);
  if (!caso0) {
    const c = await pedir(T['eudr.cooperativa'], 'POST', `${B}/dd-cases`, { operation_id: randomUUID(), lot_id: E.lot, scope_note: 'QA-1030 expediente de prueba (sintético)' });
    if (c.s === 409 && c.b?.error?.code === 'CASE_EXISTS') caso0 = { id: c.b.error.details?.[0]?.reason }; // ya existía (pasada anterior): se reutiliza
    else if (c.s !== 201) throw new Error('expediente ' + c.s + ' ' + JSON.stringify(c.b?.error?.code));
    else caso0 = c.b.case;
  }
  E.caso = caso0.id;
  const s = await pedir(T['eudr.cooperativa'], 'POST', `${B}/dd-cases/${E.caso}/snapshots`, { operation_id: randomUUID() });
  if (s.s !== 201) throw new Error('instantánea ' + s.s + ' ' + JSON.stringify(s.b?.error?.code));
  E.snap = s.b.snapshot.id; E.snapNum = s.b.snapshot.snapshot_number; E.readiness = s.b.snapshot.readiness?.effective ?? s.b.snapshot.readiness;
  const reqs = s.b.snapshot.requirements ?? [];
  const estados = Object.fromEntries(['DELIVERY_SUPPORTS', 'DEFORESTATION_ANALYSIS', 'LEGAL_PROFILE', 'RISK_REVIEW_RESOLVED'].map((c) => [c, reqs.find((r) => r.code === c)?.status]));
  const t1 = (await pedir(T['tecnico1.cooperativa'], 'POST', `${B}/dd-cases`, { operation_id: randomUUID(), lot_id: E.lot, scope_note: 'No debe abrirse' })).s;
  const content = (await pedir(T['eudr.cooperativa'], 'GET', `${B}/dd-snapshots/${E.snap}`)).b;
  const docs = (content?.snapshot?.content ?? content?.content)?.documents ?? [];
  return [t1 === 403 && E.readiness !== 'READY' && docs.some((d) => d.version_id === E.docV && d.sha256 === E.docSha), `preparación=${E.readiness} (no READY) · ${JSON.stringify(estados)} · el soporte figura en la instantánea con su huella=${docs.some((d) => d.version_id === E.docV)} · técnico abre expediente=${t1}`];
});

// ---------------------------------------------------------------- 6. Paquete interno: qué contiene
await caso('6. Paquete INTERNO: el borrador es un JSON con referencias por versión y huella (attachments.included=false), NOT_SUBMITTED; no contiene los archivos', async () => {
  const ex = await pedir(T['eudr.cooperativa'], 'POST', `${B}/dd-snapshots/${E.snap}/exports`, { operation_id: randomUUID(), kind: 'INTERNAL_REVIEW' });
  if (![200, 201].includes(ex.s)) return [false, `exportación ${ex.s} ${JSON.stringify(ex.b?.error?.code)}`];
  const id = ex.b.export?.id ?? ex.b.id;
  const dl = await fetch(`${API}${B}/dd-exports/${id}/download`, { headers: { authorization: `Bearer ${T['eudr.cooperativa']}` } });
  const txt = await dl.text(); let pk = null; try { pk = JSON.parse(txt); } catch { /* no JSON */ }
  const refs = pk?.attachments?.items ?? [];
  return [dl.status === 200 && pk?.attachments?.included === false && pk?.submission?.status === 'NOT_SUBMITTED' && refs.some((r) => r.sha256 === E.docSha) && !txt.includes('%PDF'), `HTTP ${dl.status} · adjuntos incluidos=${pk?.attachments?.included} · referencias=${refs.length} · presentación=${pk?.submission?.status} · bytes del PDF dentro=${txt.includes('%PDF')}`];
});

// ---------------------------------------------------------------- 7-8. Concesión con soportes y comprador
await caso('7. ORG_ADMIN concede la instantánea CON soportes al comprador; el comprador lista la versión exacta y descarga los bytes (huella igual); lo ajeno → 404', async () => {
  for (const g of lista((await pedir(T['admin.cooperativa'], 'GET', `${B}/access-grants`)).b).filter((x) => x.estado === 'ACTIVA' && /QA-1030/.test(x.reason) && x.resource_id !== E.snap)) await pedir(T['admin.cooperativa'], 'POST', `${B}/access-grants/${g.id}/revoke`, { operation_id: randomUUID(), reason: 'QA-1030: concesión de una pasada anterior sobre otra instantánea' });
  const prev = lista((await pedir(T['admin.cooperativa'], 'GET', `${B}/access-grants`)).b).find((g) => g.resource_type === 'DD_SNAPSHOT' && g.resource_id === E.snap && g.estado === 'ACTIVA' && g.include_documents);
  if (prev) E.grant = prev.id;
  else {
    const g = await pedir(T['admin.cooperativa'], 'POST', `${B}/access-grants`, { operation_id: randomUUID(), grantee_email: 'comprador.importador@demo.terralink.local', resource_type: 'DD_SNAPSHOT', resource_id: E.snap, can_download: true, include_documents: true, expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), reason: 'QA-1030: soportes de la instantánea para el comprador (sintético)' });
    if (g.s !== 201) throw new Error('conceder ' + g.s + ' ' + JSON.stringify(g.b?.error?.code));
    E.grant = g.b.grant.id;
  }
  const mias = lista((await pedir(T['comprador.importador'], 'GET', '/api/v1/granted')).b).find((g) => g.id === E.grant);
  const doc = await pedir(T['comprador.importador'], 'GET', `/api/v1/granted/${E.grant}/documents`);
  const item = doc.b?.documents?.find((d) => d.version_id === E.docV);
  const bytes = await fetch(`${API}/api/v1/granted/${E.grant}/documents/${E.docV}/content`, { headers: { authorization: `Bearer ${T['comprador.importador']}` } });
  const buf = Buffer.from(await bytes.arrayBuffer());
  const ajeno = (await fetch(`${API}/api/v1/granted/${E.grant}/documents/${randomUUID()}/content`, { headers: { authorization: `Bearer ${T['comprador.importador']}` } })).status;
  const otroUsuario = (await pedir(T['admin.importador'], 'GET', `/api/v1/granted/${E.grant}/documents`)).s;
  const backoffice = (await pedir(T['comprador.importador'], 'GET', `${B}/lots`)).s;
  const proy = (await pedir(T['comprador.importador'], 'GET', `/api/v1/granted/${E.grant}`)).b;
  return [!!mias?.include_documents && !!item && item.sha256 === E.docSha && bytes.status === 200 && sha(buf) === E.docSha && ajeno === 404 && otroUsuario === 404 && (backoffice === 403 || backoffice === 404) && proy.documents?.shared === true,
    `lista=${doc.s} (${doc.b?.documents?.length ?? '?'} soporte[s], ${doc.b?.restricted_count ?? '?'} excluido[s]) · descarga=${bytes.status} sha_igual=${sha(buf) === E.docSha} · versión ajena=${ajeno} · otra cuenta del importador=${otroUsuario} · backoffice del comprador=${backoffice}`];
});

await caso('8. Pantallas (1280 y 390 px): el concedente ve el alcance y el comprador encuentra el soporte, descarga la versión exacta y lee la advertencia de vista limitada', async () => {
  const browser = await chromium.launch();
  const abrir = async (tok, ruta, ancho) => { const ctx = await browser.newContext({ viewport: { width: ancho, height: 900 }, acceptDownloads: true }); await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [tok, 'es']); const page = await ctx.newPage(); await page.goto(`${WEB}${ruta}`); return { ctx, page }; };
  const salida = [];
  for (const ancho of [1280, 390]) {
    const c = await abrir(T['comprador.importador'], '/compartido', ancho);
    await c.page.getByRole('row', { name: /Instantánea de diligencia/ }).first().getByRole('button', { name: 'Ver' }).click();
    await c.page.getByRole('heading', { name: 'Soportes de la instantánea' }).waitFor();
    const aviso = await c.page.getByText('Vista limitada, no el expediente completo').isVisible();
    const tabla = c.page.getByRole('table', { name: 'Soportes de la instantánea' });
    const hay = (await tabla.innerText()).includes('Nota de entrega QA-1030');
    const [d] = await Promise.all([c.page.waitForEvent('download'), tabla.getByRole('button', { name: 'Descargar esta versión' }).first().click()]);
    const { readFileSync } = await import('node:fs'); const p = await d.path(); const igual = sha(readFileSync(p)) === E.docSha;
    const sinDesborde = await c.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await c.page.screenshot({ path: join(SALIDA, `comprador-soportes-${ancho}.png`), fullPage: true });
    salida.push([ancho, aviso, hay, igual, sinDesborde]); await c.ctx.close();
  }
  const a = await abrir(T['admin.cooperativa'], '/organizaciones/' + coop.id + '/concesiones', 1280);
  await a.page.getByRole('table', { name: 'Concesiones' }).waitFor();
  const tablaA = await a.page.getByRole('table', { name: 'Concesiones' }).innerText();
  await a.page.screenshot({ path: join(SALIDA, 'concedente-concesiones-1280.png'), fullPage: true }); await a.ctx.close();
  await browser.close();
  return [salida.every((x) => x.slice(1).every(Boolean)) && /Incluye los soportes de la instantánea/.test(tablaA), JSON.stringify(salida.map((x) => ({ px: x[0], aviso: x[1], soporte: x[2], bytes_exactos: x[3], sin_desborde: x[4] }))) + ` · concedente ve «Incluye los soportes»=${/Incluye los soportes/.test(tablaA)}`];
});

// ---------------------------------------------------------------- 9. Satélite entre organizaciones
await caso('9. Propietaria → exportadora: la parcela QA se autoriza a la Exportadora; la exportadora la ve sin coordenadas ni productor; encargar hoy está BLOQUEADO con su causa (D-09 B); revocar corta el acceso', async () => {
  const au = await pedir(T['admin.cooperativa'], 'GET', `${B}/plots/${E.plot}/satellite/authorizations`);
  let a = au.b?.authorizations?.find((x) => x.status === 'ACTIVE' && x.grantee.id === expo.id);
  if (!a) {
    const c = await pedir(T['admin.cooperativa'], 'POST', `${B}/plots/${E.plot}/satellite/authorizations`, { operation_id: randomUUID(), grantee_organization_id: expo.id, can_download: false, expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), reason: 'QA-1030: análisis de la parcela por la exportadora (sintético)' });
    if (c.s !== 201) throw new Error('autorizar ' + c.s + ' ' + JSON.stringify(c.b?.error?.code));
    a = c.b.authorization;
  }
  const X = `/api/v1/organizations/${expo.id}/satellite`;
  const lst = await pedir(T['exportacion.exportadora'], 'GET', `${X}/authorized-plots`);
  const mia = lst.b?.authorized_plots?.find((p) => p.authorization_id === a.id);
  const txt = JSON.stringify(lst.b);
  const sinGeo = !txt.includes('-79.4') && !txt.includes('Finca QA-1030') && !/producer/i.test(txt);
  const pedirAn = await pedir(T['exportacion.exportadora'], 'POST', `${X}/authorized-plots/${a.id}/analyses`, { operation_id: randomUUID(), operation: 'FOREST_COVER' });
  const bloqueado = pedirAn.s === 409 && /SATELLITE_(REQUESTS_NOT_AUTHORIZED|PROVIDER_NOT_SELECTED)/.test(pedirAn.b?.error?.code ?? '');
  const porPropietaria = (await pedir(T['exportacion.exportadora'], 'POST', `${B}/plots/${E.plot}/satellite/analyses`, { operation_id: randomUUID(), operation: 'FOREST_COVER' })).s;
  const auditorX = await login('auditor.exportadora'); const auditorEncarga = (await pedir(auditorX, 'POST', `${X}/authorized-plots/${a.id}/analyses`, { operation_id: randomUUID(), operation: 'FOREST_COVER' })).s;
  const rev = await pedir(T['admin.cooperativa'], 'POST', `${B}/satellite/authorizations/${a.id}/revoke`, { reason: 'QA-1030: fin de la comprobación (se conserva el historial)' });
  const tras = await pedir(T['exportacion.exportadora'], 'GET', `${X}/authorized-plots/${a.id}`);
  const lstTras = (await pedir(T['exportacion.exportadora'], 'GET', `${X}/authorized-plots`)).b.authorized_plots.some((p) => p.authorization_id === a.id);
  return [!!mia && sinGeo && bloqueado && (porPropietaria === 404 || porPropietaria === 403) && auditorEncarga === 403 && rev.s === 201 && tras.s === 403 && !lstTras,
    `ve la parcela=${!!mia} sin coordenadas/productor=${sinGeo} · encargar hoy=${pedirAn.s} ${pedirAn.b?.error?.code ?? ''} · por la ruta de la propietaria=${porPropietaria} · auditor encarga=${auditorEncarga} · revocar=${rev.s} → exportadora ${tras.s} y desaparece de su lista=${!lstTras}`];
});

// ---------------------------------------------------------------- 10. Auditoría
await caso('10. AUDITOR: reconstruye quién hizo qué en esta cadena (actores distintos, fechas) y no puede modificar nada', async () => {
  const al = await pedir(T['auditor.cooperativa'], 'GET', `${B}/audit-logs?limit=100`);
  const filas = lista(al.b);
  const idDe = (acc) => psql(`select m.id from memberships m join users u on u.id = m.user_id where u.email = '${acc}@demo.terralink.local' and m.organization_id = '${coop.id}'`);
  const quien = (acc) => { const id = idDe(acc); return filas.filter((f) => f.actor?.key === id).map((f) => f.action); };
  const vistos = { admin: quien('admin.cooperativa'), recepcion: quien('recepcion.acopio'), calidad: quien('calidad.acopio'), supervisor: quien('supervisor.cooperativa'), eudr: quien('eudr.cooperativa'), comprador: quien('comprador.importador') };
  const hay = (l, re) => l.some((a) => re.test(a));
  const escribe = (await pedir(T['auditor.cooperativa'], 'POST', `${B}/producers`, { producer_code: 'QA-AUD', legal_name: 'No debe crearse' })).s;
  return [al.s === 200 && filas.length > 0 && hay(vistos.admin, /grant\.create|producer\./) && hay(vistos.eudr, /dd\./) && escribe === 403, `audit-logs=${al.s} (${filas.length} filas) · acciones por actor: ${Object.entries(vistos).map(([k, v]) => `${k}=${v.length}`).join(' ')} · auditor escribe=${escribe}`];
});

writeFileSync(join(SALIDA, 'cadena.json'), JSON.stringify({ fecha: '2026-10-30', ids: { productor: E.prod, parcela: E.plot, entrega: E.delivery, lote: E.lot, expediente: E.caso, instantanea: E.snap, concesion: E.grant }, resultados: res }, null, 1));
const fallas = res.filter((r) => !r.ok).length;
console.log(`\n${res.length - fallas}/${res.length} comprobaciones OK`);
process.exit(fallas ? 1 : 0);
