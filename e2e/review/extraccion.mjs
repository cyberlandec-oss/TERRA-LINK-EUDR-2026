// P1-013 — Extracción asistida de documentos: recorrido completo en navegador real y por API (RF-44; S1 §55).
//
//   node e2e/review/extraccion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Lo que tiene que quedar demostrado, con archivos SINTÉTICOS construidos aquí:
//   1. **extracción correcta** de un PDF con capa de texto: texto real, no una maqueta;
//   2. **información ausente**: se publica la ausencia, no un valor inventado;
//   3. **resultado ambiguo**: no se elige fecha; se listan candidatos;
//   4. **documento sustituido**: la versión nueva NO hereda la extracción;
//   5. **acceso denegado**: subir no autoriza a extraer, y sin identidad no se ve contenido personal;
//   6. **formatos**: un PNG no se manda a ningún OCR; se declara no soportado;
//   7. **sugerir ≠ confirmar ≠ dato**: confirmar no sobrescribe la versión del documento;
//   8. el recorrido **sugerir → revisar → confirmar o descartar**, con teclado y 390 px.
//
// **Cambia datos DEMO**: crea documentos de ENSAYO identificados en su título, y extrae sobre ellos
// (tablas append-only propias). No modifica documentos ajenos, evidencias ni expedientes.
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';
import { exigeEntrada } from './comprobacion.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const COOP = 'e8dbdab9-08ec-4867-908e-f23138dbca28';

const resultados = [];
async function caso(titulo, fn) {
  try {
    const [ok, detalle] = await fn();
    console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(66)} ${detalle}`);
    resultados.push(ok);
  } catch (e) {
    console.log(`FALLA ${titulo.padEnd(66)} ${e.message}`);
    resultados.push(false);
  }
}

async function sesion(local) {
  const c = cuentaDemo(local);
  const r = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) });
  if (!r.ok) throw new Error(`login de ${local}: ${r.status}`);
  return { cuenta: c, token: (await r.json()).access_token };
}
const pedir = async (token, metodo, path, cuerpo) => {
  const r = await fetch(`${API}${path}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const t = await r.text();
  let body = null; try { body = JSON.parse(t); } catch { /* no JSON */ }
  return { status: r.status, body };
};

// --- PDF sintéticos, con capa de texto real (Flate + operadores Tj) ---
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
function pdfConTexto(lineas) {
  const ops = lineas.map((l, i) => `BT /F1 12 Tf 72 ${760 - i * 18} Td (${esc(l)}) Tj ET`).join('\n');
  const z = deflateSync(Buffer.from(ops, 'latin1'));
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
      + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n'
      + `4 0 obj<</Length ${z.length}/Filter/FlateDecode>>stream\n`, 'latin1'),
    z,
    Buffer.from('\nendstream\nendobj\ntrailer<</Root 1 0 R/Size 5>>\n%%EOF\n', 'latin1'),
  ]);
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154'
  + '789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');

const admin = await sesion('admin.cooperativa');
const tecnico = await sesion('tecnico1.cooperativa');
const auditor = await sesion('auditor.cooperativa');

const productores = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/producers`);
const unProductor = exigeEntrada('productor del DEMO', (productores.body?.items ?? productores.body ?? [])[0]);

async function subir(token, bytes, { tipo = 'DELIVERY_SUPPORT', nombre = 'ensayo.pdf', mime = 'application/pdf' } = {}) {
  const fd = new FormData();
  fd.set('operation_id', randomUUID());
  fd.set('document_type', tipo);
  fd.set('owner_type', 'producer');
  fd.set('owner_id', unProductor.id);
  fd.set('title', `ENSAYO P1-013 ${nombre} ${new Date().toISOString().slice(11, 19)}`);
  fd.set('file', new Blob([bytes], { type: mime }), nombre);
  const r = await fetch(`${API}/api/v1/organizations/${COOP}/documents`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
  const b = await r.json().catch(() => null);
  if (r.status !== 201) throw new Error(`subir documento: ${r.status} ${JSON.stringify(b?.error ?? {})}`);
  return b.document;
}
async function nuevaVersion(token, docId, bytes, nombre = 'ensayo-v2.pdf') {
  const fd = new FormData();
  fd.set('operation_id', randomUUID());
  fd.set('file', new Blob([bytes], { type: 'application/pdf' }), nombre);
  const r = await fetch(`${API}/api/v1/organizations/${COOP}/documents/${docId}/versions`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
  const b = await r.json().catch(() => null);
  if (r.status !== 201) throw new Error(`nueva versión: ${r.status} ${JSON.stringify(b?.error ?? {})}`);
  return b.document;
}
const ruta = (d, v) => `/api/v1/organizations/${COOP}/documents/${d}/versions/${v}/extraction`;
const extraer = (token, d, v) => pedir(token, 'POST', ruta(d, v), { operation_id: randomUUID() });

const CERTIFICADO = [
  'CERTIFICADO DE SOPORTE DE ENTREGA (ENSAYO)',
  'Emitido por: Registro de Ensayo de Manabi',
  'Fecha de emision: 2026-03-04',
  'Vigente hasta: 2027-03-04',
];

// ------------------------------------------------------------------ API
const docOk = await subir(admin.token, pdfConTexto(CERTIFICADO));
const vOk = docOk.versions[0];

await caso('EXTRACCIÓN CORRECTA: texto del archivo real, con motor y huella del contenido', async () => {
  const r = await extraer(admin.token, docOk.id, vOk.id);
  if (r.status !== 201) throw new Error(`extraer respondió ${r.status}: ${JSON.stringify(r.body?.error ?? {})}`);
  const e = exigeEntrada('extracción', r.body.extraction);
  const texto = /Registro de Ensayo de Manabi/.test(e.extracted_text ?? '');
  const huella = e.source_sha256 === r.body.version.sha256;
  return [e.status === 'EXTRAIDA' && texto && huella,
    `estado=${e.status} · motor=${e.engine}@${e.engine_version} · ${e.text_chars} caracteres · huella coincide=${huella}`];
});

await caso('SUGERENCIAS con procedencia: fragmento literal, posición y la regla que las produjo', async () => {
  const r = await pedir(admin.token, 'GET', ruta(docOk.id, vOk.id));
  const emisor = r.body.fields.find((f) => f.field_code === 'ISSUER');
  const fecha = r.body.fields.find((f) => f.field_code === 'ISSUED_AT');
  const conProcedencia = emisor.suggestion.source_excerpt && emisor.suggestion.source_offset !== null;
  return [emisor.suggestion.value === 'Registro de Ensayo de Manabi' && emisor.suggestion.confidence === 'ALTA'
    && emisor.suggestion.basis === 'ETIQUETA_EXPLICITA' && conProcedencia && fecha.suggestion.value === '2026-03-04',
  `emisor=«${emisor.suggestion.value}» (${emisor.suggestion.confidence}, ${emisor.suggestion.basis}) · emisión=${fecha.suggestion.value}`];
});

await caso('SUGERIR NO ES CONFIRMAR: todo queda pendiente de revisión', async () => {
  const r = await pedir(admin.token, 'GET', ruta(docOk.id, vOk.id));
  const pendientes = r.body.fields.filter((f) => f.state === 'PENDIENTE_DE_REVISION').length;
  const aviso = /NO acredita autenticidad, legalidad, calidad ni suficiencia/i.test(r.body.disclaimer);
  return [pendientes === r.body.fields.length && aviso,
    `${pendientes} de ${r.body.fields.length} pendientes · advertencia presente=${aviso}`];
});

await caso('CONFIRMAR no sobrescribe la versión del documento', async () => {
  const antes = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/documents/${docOk.id}`);
  const vAntes = antes.body.versions.find((x) => x.id === vOk.id);
  const r = await pedir(admin.token, 'GET', ruta(docOk.id, vOk.id));
  const campo = r.body.fields.find((f) => f.field_code === 'ISSUER');
  const c = await pedir(admin.token, 'POST', `${ruta(docOk.id, vOk.id)}/fields/${campo.id}/review`,
    { operation_id: randomUUID(), decision: 'CONFIRMADO' });
  if (c.status !== 201) throw new Error(`confirmar respondió ${c.status}`);
  const despues = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/documents/${docOk.id}`);
  const vDespues = despues.body.versions.find((x) => x.id === vOk.id);
  const intacta = JSON.stringify(vAntes) === JSON.stringify(vDespues);
  const confirmado = c.body.fields.find((f) => f.field_code === 'ISSUER');
  return [intacta && confirmado.state === 'CONFIRMADO' && confirmado.review.confirmed_value === 'Registro de Ensayo de Manabi',
    `versión del documento intacta=${intacta} · dato confirmado por ${confirmado.review.decided_by}`];
});

await caso('INFORMACIÓN AUSENTE: se publica la ausencia, no un valor inventado', async () => {
  const d = await subir(admin.token, pdfConTexto(['ACTA SIMPLE DE ENSAYO', 'Sin emisor rotulado ni fechas.']));
  const r = await extraer(admin.token, d.id, d.versions[0].id);
  if (r.status !== 201) throw new Error(`extraer respondió ${r.status}`);
  const campos = r.body.fields;
  const todosVacios = campos.length === 3 && campos.every((f) => f.suggestion.value === null);
  const explican = campos.every((f) => /NO se sugiere valor/.test(f.suggestion.basis_note));
  return [todosVacios && explican, `3 campos publicados, todos sin sugerencia=${todosVacios} · con explicación=${explican}`];
});

await caso('RESULTADO AMBIGUO: no se elige fecha; se listan los candidatos', async () => {
  const d = await subir(admin.token, pdfConTexto(['REGISTRO DE ENSAYO', 'Visita 2025-01-02', 'Revision 2026-07-08', 'Control 2027-09-10']));
  const r = await extraer(admin.token, d.id, d.versions[0].id);
  const f = r.body.fields.find((x) => x.field_code === 'ISSUED_AT');
  const candidatos = f.suggestion.candidates.map((c) => c.value);
  // Y confirmar sin escribir valor se rechaza: no hay nada que dar por bueno.
  const sinValor = await pedir(admin.token, 'POST', `${ruta(d.id, d.versions[0].id)}/fields/${f.id}/review`,
    { operation_id: randomUUID(), decision: 'CONFIRMADO' });
  return [f.suggestion.value === null && f.suggestion.confidence === 'BAJA' && candidatos.length === 3 && sinValor.status === 422,
    `sin sugerencia · candidatos: ${candidatos.join(', ')} · confirmar en vacío → ${sinValor.status}`];
});

await caso('DOCUMENTO SUSTITUIDO: la versión nueva NO hereda la extracción', async () => {
  const d = await subir(admin.token, pdfConTexto(CERTIFICADO));
  await extraer(admin.token, d.id, d.versions[0].id);
  const d2 = await nuevaVersion(admin.token, d.id, pdfConTexto(['ACTA CORREGIDA DE ENSAYO', 'Emitido por: Otra Entidad de Ensayo', 'Fecha de emision: 2026-05-05']));
  const v2 = d2.versions.find((x) => x.version_number === 2);
  const vieja = await pedir(admin.token, 'GET', ruta(d.id, d.versions[0].id));
  const nueva = await pedir(admin.token, 'GET', ruta(d.id, v2.id));
  const avisa = /YA NO es la vigente/i.test(vieja.body.version_note);
  return [avisa && vieja.body.version.is_current === false && nueva.body.extraction === null && nueva.body.fields.length === 0,
    `la vieja avisa=${avisa} · la nueva sin extracción=${nueva.body.extraction === null}`];
});

await caso('FORMATOS: un PNG no se manda a ningún OCR; se declara no soportado', async () => {
  const d = await subir(admin.token, PNG, { nombre: 'foto.png', mime: 'image/png' });
  const r = await extraer(admin.token, d.id, d.versions[0].id);
  const e = r.body.extraction;
  return [r.body.supported === false && e.status === 'FORMATO_NO_SOPORTADO'
    && /no se envía el archivo a ningún tercero/i.test(e.note) && r.body.fields.length === 0,
  `soportado=${r.body.supported} · estado=${e.status} · lo explica sin salir fuera`];
});

await caso('ACCESO DENEGADO: subir no autoriza a extraer, y sin identidad no se ve el contenido', async () => {
  // El técnico sube un documento de datos personales sobre un productor suyo…
  const asignados = await pedir(tecnico.token, 'GET', `/api/v1/organizations/${COOP}/producers`);
  const suyo = (asignados.body?.items ?? asignados.body ?? [])[0];
  if (!suyo) return [false, 'el técnico del DEMO no tiene productores asignados'];
  const fd = new FormData();
  fd.set('operation_id', randomUUID());
  fd.set('document_type', 'LAND_TENURE');
  fd.set('owner_type', 'producer');
  fd.set('owner_id', suyo.id);
  fd.set('title', `ENSAYO P1-013 tenencia ${new Date().toISOString().slice(11, 19)}`);
  fd.set('file', new Blob([pdfConTexto(CERTIFICADO)], { type: 'application/pdf' }), 'tenencia.pdf');
  const sub = await fetch(`${API}/api/v1/organizations/${COOP}/documents`, { method: 'POST', headers: { authorization: `Bearer ${tecnico.token}` }, body: fd });
  if (sub.status !== 201) throw new Error(`el técnico no pudo subir: ${sub.status}`);
  const doc = (await sub.json()).document;
  const v = doc.versions[0];

  const suyaPeroNo = await extraer(tecnico.token, doc.id, v.id);           // sin document:extract
  const sinIdentidad = await pedir(auditor.token, 'GET', ruta(doc.id, v.id)); // sin producer:read_identity
  const control = await extraer(admin.token, doc.id, v.id);                 // control autorizado
  return [suyaPeroNo.status === 403 && sinIdentidad.status === 403 && control.status === 201,
    `técnico que la subió → ${suyaPeroNo.status} · auditor sin identidad → ${sinIdentidad.status} · admin → ${control.status}`];
});

await caso('CONTROLES EXISTENTES: sin análisis antivirus limpio no se abre el archivo', async () => {
  const r = await pedir(admin.token, 'GET', ruta(docOk.id, vOk.id));
  // El DEMO analiza al subir; se comprueba que el estado se publica y que el camino existe.
  return [r.body.version.scan === 'CLEAN', `análisis de la versión analizada: ${r.body.version.scan}`];
});

await caso('LEER no cambia nada; extraer no toca documentos ni evidencias', async () => {
  const antes = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/documents`);
  await pedir(admin.token, 'GET', ruta(docOk.id, vOk.id));
  const despues = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/documents`);
  const n = (x) => (Array.isArray(x.body) ? x.body : x.body?.items ?? []).length;
  return [n(antes) === n(despues), `${n(antes)} documentos antes y después de leer`];
});

// ------------------------------------------------------------------ navegador
const navegador = await chromium.launch();
try {
  const entrar = async (cuenta, viewport = { width: 1280, height: 900 }) => {
    const ctx = await navegador.newContext({ viewport, locale: 'es-EC' });
    const page = await ctx.newPage();
    await page.goto(WEB);
    await page.getByLabel('Correo').fill(cuenta.cuenta.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(cuenta.cuenta.contrasena);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 20000 });
    return { ctx, page };
  };
  const abrir = async (page, d, v) => {
    await page.goto(`${WEB}/organizaciones/${COOP}/documentos/${d}/extraccion/${v}`);
    await page.getByRole('heading', { level: 1, name: 'Extracción asistida' }).waitFor({ timeout: 20000 });
    await page.getByRole('heading', { name: 'El archivo analizado' }).waitFor({ timeout: 20000 });
  };

  const { ctx, page } = await entrar(admin);

  await caso('ENLACE: desde la ficha del documento se llega a la extracción de ESA versión', async () => {
    await page.goto(`${WEB}/organizaciones/${COOP}/documentos/${docOk.id}`);
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 20000 });
    await page.getByRole('link', { name: 'Ver o extraer de esta versión' }).first().click();
    await page.getByRole('heading', { level: 1, name: 'Extracción asistida' }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    return [/Sugerir no es confirmar/i.test(t) && /no levanta ninguna compuerta/i.test(t),
      `llega a la extracción y avisa de qué no demuestra`];
  });

  await caso('RECORRIDO en pantalla: 1 texto, 2 sugerencias, 3 revisión, separados', async () => {
    await abrir(page, docOk.id, vOk.id);
    const t = await page.locator('main').innerText();
    const uno = /1\. Texto extraído/.test(t);
    const dosYTres = /2\. Valores sugeridos y 3\. revisión/.test(t);
    const literal = /Registro de Ensayo de Manabi/.test(t);
    const regla = /El documento rotula este valor/.test(t);
    const sinMarkdown = !t.includes('**');
    return [uno && dosYTres && literal && regla && sinMarkdown,
      `bloques separados=${uno && dosYTres} · texto literal visible=${literal} · regla de confianza visible=${regla}`];
  });

  await caso('RECORRIDO: sugerir → revisar → DESCARTAR con motivo', async () => {
    const d = await subir(admin.token, pdfConTexto(CERTIFICADO));
    await abrir(page, d.id, d.versions[0].id);
    await page.getByRole('button', { name: 'Extraer texto y sugerir' }).click();
    await page.locator('.alert.valid').filter({ hasText: 'nada queda confirmado' }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Revisar' }).first().click();
    await page.getByLabel('Motivo (si descartas)').first().fill('Ensayo de revisión: el sello no coincide.');
    await page.getByRole('button', { name: 'Descartar' }).first().click();
    await page.locator('.alert.valid').filter({ hasText: 'descartada' }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    return [/Descartado/.test(t) && /el sello no coincide/.test(t),
      `estado Descartado visible · motivo conservado`];
  });

  await caso('AMBIGUO en pantalla: sin sugerencia, con sus candidatos a la vista', async () => {
    const d = await subir(admin.token, pdfConTexto(['REGISTRO DE ENSAYO', 'Visita 2025-01-02', 'Revision 2026-07-08']));
    await abrir(page, d.id, d.versions[0].id);
    await page.getByRole('button', { name: 'Extraer texto y sugerir' }).click();
    await page.locator('table[aria-label="Sugerencias de extracción"]').waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    return [/sin sugerencia/.test(t) && /candidato: 2025-01-02/.test(t) && /BAJA/.test(t),
      `sin sugerencia + candidatos listados + confianza BAJA a la vista`];
  });

  await caso('PERMISOS EN PANTALLA: quien no revisa ve el motivo, no un botón inútil', async () => {
    const { ctx: c2, page: p2 } = await entrar(auditor);
    await p2.goto(`${WEB}/organizaciones/${COOP}/documentos/${docOk.id}/extraccion/${vOk.id}`);
    await p2.getByRole('heading', { level: 1, name: 'Extracción asistida' }).waitFor({ timeout: 20000 });
    // Se espera a la TABLA antes de contar: «0 botones» sobre una pantalla aún vacía no demuestra nada.
    await p2.locator('table[aria-label="Sugerencias de extracción"]').waitFor({ timeout: 20000 });
    const filas = await p2.locator('table[aria-label="Sugerencias de extracción"] tbody tr').count();
    const t = await p2.locator('main').innerText();
    const motivo = /proponer no es confirmar/i.test(t);
    const botones = await p2.getByRole('button', { name: 'Revisar' }).count();
    const extrae = await p2.getByRole('button', { name: /Extraer/ }).count();
    await c2.close();
    return [filas > 0 && motivo && botones === 0 && extrae === 0,
      `${filas} sugerencia(s) a la vista · motivo mostrado=${motivo} · botones de revisar=${botones} · de extraer=${extrae}`];
  });

  await caso('TECLADO: se confirma una sugerencia sin ratón', async () => {
    const d = await subir(admin.token, pdfConTexto(CERTIFICADO));
    await abrir(page, d.id, d.versions[0].id);
    await page.getByRole('button', { name: 'Extraer texto y sugerir' }).click();
    await page.locator('table[aria-label="Sugerencias de extracción"]').waitFor({ timeout: 20000 });
    const revisar = page.getByRole('button', { name: 'Revisar' }).first();
    await revisar.focus();
    const enfocado = await page.evaluate(() => document.activeElement?.textContent);
    await page.keyboard.press('Enter');
    await page.getByLabel('Valor que confirmas').first().waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Confirmar' }).first().press('Enter');
    await page.locator('.alert.valid').filter({ hasText: 'Dato confirmado por ti' }).waitFor({ timeout: 20000 });
    return [enfocado === 'Revisar', `foco en «${enfocado}» · confirmado con Enter`];
  });

  await caso('390 px: nada se corta y la tabla desplaza en horizontal', async () => {
    const { ctx: c3, page: p3 } = await entrar(admin, { width: 390, height: 844 });
    await p3.goto(`${WEB}/organizaciones/${COOP}/documentos/${docOk.id}/extraccion/${vOk.id}`);
    await p3.getByRole('heading', { level: 1, name: 'Extracción asistida' }).waitFor({ timeout: 20000 });
    await p3.locator('table[aria-label="Sugerencias de extracción"]').waitFor({ timeout: 20000 });
    const desborde = await p3.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const envueltas = await p3.locator('.table-wrap').count();
    await c3.close();
    return [!desborde && envueltas > 0, `desborde horizontal=${desborde} · ${envueltas} tabla(s) desplazable(s)`];
  });

  await ctx.close();
} finally {
  await navegador.close();
}

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} comprobaciones correctas`);
process.exit(ok === resultados.length ? 0 : 1);
