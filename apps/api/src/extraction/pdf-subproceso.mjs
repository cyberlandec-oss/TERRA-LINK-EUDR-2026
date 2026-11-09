// P1-013 — Decodificación de un PDF, **en un proceso aparte**.
//
// POR QUÉ UN PROCESO APARTE (2026-10-19)
// Dos razones, y ninguna es de estilo:
//
//   1. **Los límites tienen que interrumpir de verdad.** Un control de tiempo *entre* páginas no detiene una
//      apertura ni una página que se quedan girando dentro del motor: el plazo vence, pero el trabajo sigue
//      consumiendo CPU y memoria en el mismo proceso. Matando un proceso hijo el trabajo **termina** y el
//      sistema operativo **libera** su memoria, sus hilos y sus descriptores. El tope de memoria
//      (`--max-old-space-size`) acota además las bombas de descompresión.
//   2. **pdf.js solo se publica como módulo ES.** Cargarlo desde el proceso de la aplicación obligaba a una
//      importación dinámica que, en las pruebas, se resolvía *después* de desmontarse el entorno y
//      contaminaba suites ajenas. Aquí se carga en un proceso que no comparte nada con nadie.
//
// Entra: los bytes del PDF por la entrada estándar. Sale: un único mensaje con el resultado.
// Nada de red, nada de OCR, nada que salga de la instalación.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const LIMITES = JSON.parse(process.argv[2] ?? '{}');
const MAX_CHARS = LIMITES.maxChars ?? 200000;
const MAX_PAGES = LIMITES.maxPages ?? 200;

// Caracteres que delatan un mapeo fallido. Es una red adicional, no la comprobación.
const SIN_MAPEAR = /[\uFFFD\u0000-\u0008\u000B\u000E-\u001F]/;

function responder(r) {
  process.send(r, () => process.exit(0));
}

async function entrada() {
  const partes = [];
  for await (const c of process.stdin) partes.push(c);
  return Buffer.concat(partes);
}

async function leer(bytes) {
  let tarea = null;
  let doc = null;
  try {
    tarea = getDocument({
      data: new Uint8Array(bytes),
      // Sin red, sin tipografías del sistema y sin evaluación dinámica: lectura local y acotada.
      useSystemFonts: false,
      isEvalSupported: false,
      disableFontFace: true,
      stopAtErrors: false,
    });
    doc = await tarea.promise;
  } catch {
    await tarea?.destroy().catch(() => undefined);
    return { reason: 'NO_SE_PUDO_ABRIR' };
  }

  let texto = '';
  let paginas = 0;
  let truncado = false;
  let capaDeTexto = false;
  let sinMapear = 0;

  try {
    const total = Math.min(doc.numPages, MAX_PAGES);
    if (doc.numPages > MAX_PAGES) truncado = true;
    for (let i = 1; i <= total; i += 1) {
      const pagina = await doc.getPage(i);
      const contenido = await pagina.getTextContent();
      for (const it of contenido.items) {
        const s = it.str ?? '';
        if (s.trim().length > 0) capaDeTexto = true;
        if (SIN_MAPEAR.test(s)) sinMapear += 1;
        texto += s;
        if (it.hasEOL) texto += '\n';
      }
      texto += '\n';
      paginas = i;
      if (texto.length > MAX_CHARS) { texto = texto.slice(0, MAX_CHARS); truncado = true; break; }
    }
  } catch {
    // Un fallo a media lectura deja el texto incompleto, y se declara.
    truncado = true;
  } finally {
    await doc.destroy().catch(() => undefined);
  }

  return {
    reason: 'OK',
    text: texto.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    pages: paginas,
    truncated: truncado,
    hasTextLayer: capaDeTexto,
    unmapped_items: sinMapear,
  };
}

entrada()
  .then(leer)
  .then(responder)
  .catch(() => responder({ reason: 'NO_SE_PUDO_ABRIR' }));
