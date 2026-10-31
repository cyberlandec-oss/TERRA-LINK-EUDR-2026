// D-41: mismas reglas que apps/mobile/src/core/metadata.ts (copia). El servidor rechaza fotos de campo con metadatos
// embebidos distintos de la orientación mínima (EXIF con coordenadas o dispositivo, XMP, IPTC, comentarios).

const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]); // APP1 (EXIF/XMP), APP13 (IPTC/Photoshop), COM
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"

export function stripImageMetadata(bytes: Uint8Array, mimeType: string): Uint8Array {
  if (mimeType === 'image/jpeg') return stripJpeg(bytes);
  if (mimeType === 'image/png') return stripPng(bytes);
  return bytes;
}

/** Orientación EXIF (1–8) de un bloque TIFF; null si no hay o no es válida. */
export function tiffOrientation(t: Uint8Array): number | null {
  if (t.length < 8) return null;
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return null;
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0 : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0);
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > t.length) return null;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) return null;
    if (u16(e) === 0x0112 && u16(e + 2) === 3) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : null; }
  }
  return null;
}

/** TIFF mínimo (big-endian) con una sola entrada: Orientation. */
function minimalTiff(orientation: number): number[] {
  return [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
}

function stripJpeg(b: Uint8Array): Uint8Array {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new Error('El archivo no es un JPEG válido.');
  const head: number[] = [0xff, 0xd8];
  const rest: number[] = [];
  let orientation: number | null = null;
  let i = 2;
  const copy = (from: number, to: number) => { for (let k = from; k < to; k++) rest.push(b[k]); };
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('JPEG con estructura no válida.');
    const marker = b[i + 1];
    if (marker === 0xd9) { rest.push(0xff, 0xd9); i = b.length; break; }
    if (marker === 0xda) { copy(i, b.length); i = b.length; break; } // datos de imagen: se copian tal cual
    if (marker >= 0xd0 && marker <= 0xd7) { rest.push(0xff, marker); i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) throw new Error('JPEG truncado.');
    if (marker === 0xe1 && EXIF_HEADER.every((v, k) => b[i + 4 + k] === v)) orientation = tiffOrientation(b.subarray(i + 10, i + 2 + len)) ?? orientation;
    if (marker === 0xe0 && head.length === 2 && rest.length === 0) for (let k = i; k < i + 2 + len; k++) head.push(b[k]); // APP0 (JFIF) primero
    else if (!JPEG_DROP.has(marker)) copy(i, i + 2 + len);
    i += 2 + len;
  }
  if (i < b.length) copy(i, b.length);
  const app1 = orientation && orientation !== 1 ? (() => { const body = [...EXIF_HEADER, ...minimalTiff(orientation)]; return [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]; })() : [];
  return new Uint8Array([...head, ...app1, ...rest]);
}

const CRC_TABLE = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } return t; })();
function crc32(bytes: number[]): number { let c = 0xffffffff; for (const x of bytes) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const u32be = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];

function stripPng(b: Uint8Array): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 8 || sig.some((v, k) => b[k] !== v)) throw new Error('El archivo no es un PNG válido.');
  const out: number[] = Array.from(b.subarray(0, 8));
  let orientation: number | null = null;
  let i = 8;
  let first = true;
  const chunks: Array<[string, Uint8Array]> = [];
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const end = i + 12 + len;
    if (end > b.length) throw new Error('PNG truncado.');
    if (type === 'eXIf') orientation = tiffOrientation(b.subarray(i + 8, i + 8 + len)) ?? orientation;
    chunks.push([type, b.subarray(i, end)]);
    i = end;
  }
  for (const [type, raw] of chunks) {
    if (PNG_DROP.has(type)) continue;
    out.push(...raw);
    if (first && type === 'IHDR' && orientation && orientation !== 1) {
      const data = minimalTiff(orientation);
      const typeBytes = [0x65, 0x58, 0x49, 0x66]; // eXIf
      out.push(...u32be(data.length), ...typeBytes, ...data, ...u32be(crc32([...typeBytes, ...data])));
    }
    first = false;
  }
  return new Uint8Array(out);
}

/** ¿Quedan metadatos distintos de la orientación mínima? (misma regla que el servidor). */
export function hasImageMetadata(b: Uint8Array, mimeType: string): boolean {
  try {
    const s = stripImageMetadata(b, mimeType);
    return s.length !== b.length || s.some((v, k) => v !== b[k]);
  } catch { return true; }
}

/** Orientación EXIF de una imagen JPEG/PNG (1 si no hay). */
export function imageOrientation(b: Uint8Array, mimeType: string): number {
  if (mimeType === 'image/jpeg') {
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff && b[i + 1] !== 0xda) {
      const len = (b[i + 2] << 8) | b[i + 3];
      if (b[i + 1] === 0xe1 && EXIF_HEADER.every((v, k) => b[i + 4 + k] === v)) return tiffOrientation(b.subarray(i + 10, i + 2 + len)) ?? 1;
      i += 2 + len;
    }
    return 1;
  }
  if (mimeType === 'image/png') {
    let i = 8;
    while (i + 12 <= b.length) {
      const len = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
      if (String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]) === 'eXIf') return tiffOrientation(b.subarray(i + 8, i + 8 + len)) ?? 1;
      i += 12 + len;
    }
  }
  return 1;
}
