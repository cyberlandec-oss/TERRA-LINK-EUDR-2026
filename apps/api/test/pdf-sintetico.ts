import { deflateSync } from 'node:zlib';

// Generador de PDF **sintéticos** para las pruebas de P1-013.
//
// Construye un PDF mínimo **con capa de texto real** —flujo de contenido comprimido con Flate y operadores
// `Tj`—, que es exactamente lo que el extractor lee. No es una maqueta: el archivo es un PDF válido y el
// extractor tiene que descomprimirlo de verdad para encontrar el texto.
//
// `pdfEscaneado()` produce un PDF **sin** capa de texto, como un escaneo: sirve para demostrar que ese caso
// se declara «sin texto» en vez de inventarse nada.

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** PDF con una página y las líneas dadas, cada una como un `Tj` independiente. */
export function pdfConTexto(lineas: string[]): Buffer {
  const ops = lineas
    .map((l, i) => `BT /F1 12 Tf 72 ${760 - i * 18} Td (${esc(l)}) Tj ET`)
    .join('\n');
  const contenido = deflateSync(Buffer.from(ops, 'latin1'));

  const objetos: Buffer[] = [];
  const push = (s: string | Buffer) => objetos.push(Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1'));

  push('%PDF-1.4\n');
  push('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n');
  push('2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n');
  push('3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n');
  push(`4 0 obj<</Length ${contenido.length}/Filter/FlateDecode>>stream\n`);
  push(contenido);
  push('\nendstream\nendobj\n');
  push('trailer<</Root 1 0 R/Size 5>>\n%%EOF\n');
  return Buffer.concat(objetos);
}

/** PDF sin capa de texto: una página con un flujo que solo dibuja, como un escaneo. */
export function pdfEscaneado(): Buffer {
  const contenido = deflateSync(Buffer.from('0 0 0 RG 10 10 m 100 100 l S', 'latin1'));
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n', 'latin1'),
    Buffer.from('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n', 'latin1'),
    Buffer.from('2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n', 'latin1'),
    Buffer.from('3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n', 'latin1'),
    Buffer.from(`4 0 obj<</Length ${contenido.length}/Filter/FlateDecode>>stream\n`, 'latin1'),
    contenido,
    Buffer.from('\nendstream\nendobj\ntrailer<</Root 1 0 R/Size 5>>\n%%EOF\n', 'latin1'),
  ]);
}

/** PNG mínimo válido (1×1). Sirve para demostrar el formato NO soportado sin salir a ningún OCR. */
export function pngMinimo(): Buffer {
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154'
    + '789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
}
