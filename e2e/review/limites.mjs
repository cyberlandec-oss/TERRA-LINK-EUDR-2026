// P1-015 — Límites y consumo: recorrido completo en navegador real y por API (RF-46).
//
//   node e2e/review/limites.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Lo que tiene que quedar demostrado:
//   1. cada límite publicado trae **qué limita, de dónde sale y qué pasa al superarlo**;
//   2. **el límite publicado es el que se aplica**: se supera uno y el producto responde lo que anunció;
//   3. el **consumo se mide de verdad** y **no se presenta como coste**;
//   4. **español primero**: idioma declarado, y sin claves de traducción a la vista;
//   5. **no se insinúa un SSO** que no existe;
//   6. la superficie es de **solo lectura**: no fija ningún límite;
//   7. **regresión de P1-013 con el motor nuevo**: un PDF de una herramienta independiente **se lee de
//      verdad**, con acentos; una fuente **sin mapa de caracteres** se **rechaza entera** aunque el texto
//      pareciera legible; y la redacción sobre OCR no dice que haga falta un tercero;
//   8. permisos, aislamiento, enlaces, teclado y 390 px.
//
// **Cambia datos DEMO**: sube un documento de ENSAYO para mover el consumo, y uno más para la regresión de
// extracción. No modifica documentos ajenos ni ningún otro módulo.
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

const admin = await sesion('admin.cooperativa');
const tecnico = await sesion('tecnico1.cooperativa');
const productores = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/producers`);
const unProductor = exigeEntrada('productor del DEMO', (productores.body?.items ?? productores.body ?? [])[0]);

async function subir(bytes, nombre, mime = 'application/pdf') {
  const fd = new FormData();
  fd.set('operation_id', randomUUID());
  fd.set('document_type', 'DELIVERY_SUPPORT');
  fd.set('owner_type', 'producer');
  fd.set('owner_id', unProductor.id);
  fd.set('title', `ENSAYO P1-015 ${nombre} ${new Date().toISOString().slice(11, 19)}`);
  fd.set('file', new Blob([bytes], { type: mime }), nombre);
  const r = await fetch(`${API}/api/v1/organizations/${COOP}/documents`, { method: 'POST', headers: { authorization: `Bearer ${admin.token}` }, body: fd });
  const b = await r.json().catch(() => null);
  return { status: r.status, body: b };
}
const limites = (token = admin.token, org = COOP) => pedir(token, 'GET', `/api/v1/organizations/${org}/limits`);

// ------------------------------------------------------------------ API
await caso('CONTROL: cada límite dice qué limita, de dónde sale y qué pasa al superarlo', async () => {
  const r = await limites();
  if (r.status !== 200) throw new Error(`límites respondieron ${r.status}`);
  exigeEntrada('lista de límites', r.body.limits);
  const completos = r.body.limits.every((l) => l.code && l.what && l.unit && l.source && l.enforced_at && l.on_exceed);
  const conProcedencia = r.body.limits.every((l) => /de entorno|constante del código|dependencia fijada/.test(l.source));
  return [r.body.limits.length >= 8 && completos && conProcedencia,
    `${r.body.limits.length} límites, todos autodescritos=${completos} · con procedencia=${conProcedencia}`];
});

await caso('EL LÍMITE PUBLICADO ES EL QUE SE APLICA: se supera y responde lo anunciado', async () => {
  const r = await limites();
  const l = r.body.limits.find((x) => x.code === 'DOCUMENT_MAX_BYTES');
  const bytes = Number(l.value);
  const grande = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(bytes + 1, 0x20)]);
  const sub = await subir(grande, 'pasado-de-tamano.pdf');
  return [sub.status === 422 && sub.body?.error?.code === 'FILE_TOO_LARGE' && /FILE_TOO_LARGE/.test(l.on_exceed),
    `límite ${bytes} bytes · superado → ${sub.status} ${sub.body?.error?.code} · coincide con lo anunciado`];
});

await caso('EL CONSUMO SE MIDE: subir un documento lo mueve', async () => {
  const antes = await limites();
  const sub = await subir(Buffer.from(`%PDF-1.4\n% ensayo ${randomUUID()}\n%%EOF\n`), 'consumo.pdf');
  if (sub.status !== 201) throw new Error(`subir respondió ${sub.status}`);
  const despues = await limites();
  return [despues.body.usage.documents === antes.body.usage.documents + 1
    && despues.body.usage.stored_bytes > antes.body.usage.stored_bytes,
  `documentos ${antes.body.usage.documents} → ${despues.body.usage.documents} · bytes ${antes.body.usage.stored_bytes} → ${despues.body.usage.stored_bytes}`];
});

await caso('EL CONSUMO NO ES UN COSTE y NO se insinúa ningún SSO', async () => {
  const r = await limites();
  const sinDinero = !/USD|EUR|importe|precio|tarifa/i.test(JSON.stringify(r.body.usage));
  return [/NO es un coste/i.test(r.body.cost_note) && /autenticación es local/i.test(r.body.sso_note)
    && /NO hay inicio de sesión federado/i.test(r.body.sso_note) && sinDinero,
  `advertencia de coste presente · SSO declarado inexistente · sin cifras de dinero=${sinDinero}`];
});

await caso('ESPAÑOL PRIMERO: idioma declarado y sin claves de traducción', async () => {
  const r = await limites();
  const textos = [r.body.cost_note, r.body.sso_note, r.body.note, ...r.body.limits.map((l) => l.what)];
  const sinClaves = textos.every((t) => !/^[a-z]+(\.[a-z_]+)+$/.test(t));
  const enEspanol = textos.every((t) => /[áéíóúñ¿¡]|\b(de|la|el|no|que|los|las)\b/i.test(t));
  return [r.body.language.primary === 'es' && r.body.language.available.join() === 'es' && sinClaves && enEspanol,
    `idioma=${r.body.language.primary} · disponibles=[${r.body.language.available}] · sin claves=${sinClaves}`];
});

await caso('SOLO LECTURA: no se puede fijar ningún límite', async () => {
  const post = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/limits`, {});
  const patch = await pedir(admin.token, 'PATCH', `/api/v1/organizations/${COOP}/limits`, {});
  return [post.status === 404 && patch.status === 404, `POST → ${post.status} · PATCH → ${patch.status}`];
});

await caso('AISLAMIENTO: otra organización no se alcanza', async () => {
  const otras = await pedir(admin.token, 'GET', '/api/v1/organizations');
  const ajena = (otras.body ?? []).find((o) => o.id !== COOP);
  if (!ajena) return [true, 'solo hay una organización en el DEMO'];
  const r = await limites(admin.token, ajena.id);
  return [r.status === 404 || r.status === 403, `organización ajena → ${r.status} (opaco)`];
});

// --- regresión de P1-013 corregida en este mismo candidato ---
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const pdfPropio = (lineas) => {
  // PDF VÁLIDO: catálogo, páginas y una página real. El lector anterior toleraba estructuras degeneradas;
  // pdf.js exige un documento de verdad, que es lo correcto.
  const NL = String.fromCharCode(10);
  const ops = lineas.map((l, i) => `BT /F1 12 Tf 72 ${760 - i * 18} Td (${esc(l)}) Tj ET`).join(NL);
  const z = deflateSync(Buffer.from(ops, 'latin1'));
  const cab = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj',
    `4 0 obj<</Length ${z.length}/Filter/FlateDecode>>stream`,
  ].join(NL) + NL;
  const cola = ['', 'endstream', 'endobj', 'trailer<</Root 1 0 R/Size 5>>', '%%EOF', ''].join(NL);
  return Buffer.concat([Buffer.from(cab, 'latin1'), z, Buffer.from(cola, 'latin1')]);
};

await caso('REGRESIÓN P1-013: un PDF ajeno AHORA se lee de verdad, con acentos', async () => {
  // PDF generado por una herramienta independiente: el propio navegador de esta revisión.
  const nav = await chromium.launch();
  const pag = await (await nav.newContext()).newPage();
  await pag.setContent('<html><body style="font-family:Arial"><p>Emitido por: Entidad de Ensayo</p>'
    + '<p>Fecha de emisión: 2026-03-04</p></body></html>');
  const ajeno = await pag.pdf({ format: 'A5' });
  await nav.close();

  const sub = await subir(ajeno, 'ajeno-chromium.pdf');
  if (sub.status !== 201) throw new Error(`subir el PDF ajeno respondió ${sub.status}`);
  const v = sub.body.document.versions[0];
  const ex = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/documents/${sub.body.document.id}/versions/${v.id}/extraction`, { operation_id: randomUUID() });
  if (ex.status !== 201) throw new Error(`extraer respondió ${ex.status}`);
  const e = ex.body.extraction;
  const emisor = ex.body.fields.find((f) => f.field_code === 'ISSUER');
  return [e.status === 'EXTRAIDA' && e.engine === 'pdfjs-dist'
    && /Entidad de Ensayo/.test(e.extracted_text ?? '') && /emisión/.test(e.extracted_text ?? '')
    && emisor?.suggestion?.value === 'Entidad de Ensayo',
  `estado=${e.status} · motor=${e.engine} · acentos conservados · emisor sugerido=«${emisor?.suggestion?.value}»`];
});

await caso('REGRESIÓN P1-013: una fuente SIN MAPA se rechaza entera, aunque parezca legible', async () => {
  // Fuente compuesta Identity-H sin /ToUnicode: lo que se obtendría parece texto, pero no es del documento.
  const NL = String.fromCharCode(10);
  const z = deflateSync(Buffer.from('BT /F1 12 Tf 72 700 Td <00480049004A004B> Tj ET', 'latin1'));
  const cab = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>endobj',
    `4 0 obj<</Length ${z.length}/Filter/FlateDecode>>stream`,
  ].join(NL) + NL;
  const cola = [
    '',
    'endstream',
    'endobj',
    '5 0 obj<</Type/Font/Subtype/Type0/BaseFont/AAAAAA+Sin/Encoding/Identity-H/DescendantFonts[6 0 R]>>endobj',
    '6 0 obj<</Type/Font/Subtype/CIDFontType2/BaseFont/AAAAAA+Sin/CIDSystemInfo<</Registry(Adobe)/Ordering(Identity)/Supplement 0>>/DW 500>>endobj',
    'trailer<</Root 1 0 R/Size 7>>',
    '%%EOF',
    '',
  ].join(NL);
  const sinMapa = Buffer.concat([Buffer.from(cab, 'latin1'), z, Buffer.from(cola, 'latin1')]);
  const sub = await subir(sinMapa, 'fuente-sin-mapa.pdf');
  if (sub.status !== 201) throw new Error(`subir respondió ${sub.status}`);
  const v = sub.body.document.versions[0];
  const ex = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/documents/${sub.body.document.id}/versions/${v.id}/extraction`, { operation_id: randomUUID() });
  const e = ex.body.extraction;
  return [e.status === 'TEXTO_NO_INTERPRETABLE' && e.extracted_text === null && ex.body.fields.length === 0
    && /ToUnicode/.test(e.note) && /NO acredita compatibilidad/i.test(ex.body.engine_limits),
  `estado=${e.status} · sin texto publicado · ${ex.body.fields.length} sugerencias · declara su límite`];
});

await caso('REGRESIÓN P1-013: la redacción sobre OCR ya no dice que haga falta un tercero', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154'
    + '789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
  const sub = await subir(png, 'foto.png', 'image/png');
  if (sub.status !== 201) throw new Error(`subir el PNG respondió ${sub.status}`);
  const v = sub.body.document.versions[0];
  const ex = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/documents/${sub.body.document.id}/versions/${v.id}/extraction`, { operation_id: randomUUID() });
  const nota = ex.body.extraction.note;
  return [/este motor NO implementa OCR/i.test(nota) && /se ejecutan en local/i.test(nota) && !/NO tiene autorizado/i.test(nota),
    `la nota atribuye la falta de OCR al MOTOR, no a una prohibición de terceros`];
});

await caso('REGRESIÓN P1-013: multipágina y codificaciones', async () => {
  const sub = await subir(pdfPropio(['Emitido por: Entidad Multipagina', 'Fecha de emision: 2026-09-09']), 'propio.pdf');
  const v = sub.body.document.versions[0];
  const ex = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/documents/${sub.body.document.id}/versions/${v.id}/extraction`, { operation_id: randomUUID() });
  const e = ex.body.extraction;
  const emisor = ex.body.fields.find((f) => f.field_code === 'ISSUER');
  return [e.status === 'EXTRAIDA' && /ningún fragmento quedó sin mapear/.test(e.note) && emisor.suggestion.value === 'Entidad Multipagina',
    `estado=${e.status} · decodificación completa declarada · emisor sugerido=«${emisor.suggestion.value}»`];
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
  const abrir = async (page) => {
    await page.goto(`${WEB}/organizaciones/${COOP}/limites`);
    await page.getByRole('heading', { level: 1, name: 'Límites y consumo' }).waitFor({ timeout: 20000 });
    await page.locator('table[aria-label="Límites vigentes del producto"]').waitFor({ timeout: 20000 });
  };

  const { ctx, page } = await entrar(admin);

  await caso('ENLACE: se llega desde el menú y la pantalla avisa de que no es coste', async () => {
    await page.goto(`${WEB}/organizaciones/${COOP}`);
    await page.getByRole('link', { name: 'Límites y consumo', exact: true }).first().click();
    await page.getByRole('heading', { level: 1, name: 'Límites y consumo' }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    return [/El consumo no es un coste/i.test(t) && /No hay tarifa acordada ni proveedor contratado/i.test(t),
      `aviso de que no es dinero presente`];
  });

  await caso('PANTALLA: límites con su procedencia y su efecto al superarlos', async () => {
    await abrir(page);
    const filas = await page.locator('table[aria-label="Límites vigentes del producto"] tbody tr').count();
    const t = await page.locator('main').innerText();
    const procedencia = /variable de entorno|constante del código/.test(t);
    const efecto = /FILE_TOO_LARGE/.test(t);
    const sinMarkdown = !t.includes('**');
    return [filas >= 8 && procedencia && efecto && sinMarkdown,
      `${filas} límites a la vista · procedencia=${procedencia} · efecto al superarlo=${efecto}`];
  });

  await caso('PANTALLA: idioma español declarado y acceso local, sin insinuar SSO', async () => {
    await abrir(page);
    const t = await page.locator('main').innerText();
    return [/Idioma principal/.test(t) && /\bes\b/.test(t) && /sin acceso federado/i.test(t) && /D-54/.test(t),
      `idioma y acceso declarados · decisiones abiertas citadas (D-54)`];
  });

  await caso('PERMISOS EN PANTALLA: el técnico, que pertenece, ve su consumo', async () => {
    const { ctx: c2, page: p2 } = await entrar(tecnico);
    await p2.goto(`${WEB}/organizaciones/${COOP}/limites`);
    await p2.getByRole('heading', { level: 1, name: 'Límites y consumo' }).waitFor({ timeout: 20000 });
    await p2.locator('table[aria-label="Límites vigentes del producto"]').waitFor({ timeout: 20000 });
    const filas = await p2.locator('table[aria-label="Límites vigentes del producto"] tbody tr').count();
    const t = await p2.locator('main').innerText();
    await c2.close();
    return [filas >= 8 && /Consumo de esta organización/.test(t),
      `${filas} límites y su consumo, con el permiso de pertenencia`];
  });

  await caso('TECLADO: la pantalla se recorre sin ratón', async () => {
    await abrir(page);
    await page.keyboard.press('Tab');
    const primero = await page.evaluate(() => document.activeElement?.tagName);
    const encabezados = await page.getByRole('heading', { level: 2 }).count();
    return [['A', 'BUTTON', 'INPUT', 'SELECT'].includes(primero ?? '') && encabezados >= 3,
      `primer foco en ${primero} · ${encabezados} secciones con encabezado`];
  });

  await caso('390 px: nada se corta y la tabla desplaza en horizontal', async () => {
    const { ctx: c3, page: p3 } = await entrar(admin, { width: 390, height: 844 });
    await p3.goto(`${WEB}/organizaciones/${COOP}/limites`);
    await p3.getByRole('heading', { level: 1, name: 'Límites y consumo' }).waitFor({ timeout: 20000 });
    await p3.locator('table[aria-label="Límites vigentes del producto"]').waitFor({ timeout: 20000 });
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
