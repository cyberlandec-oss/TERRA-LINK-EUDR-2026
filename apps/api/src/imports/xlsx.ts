import { crc32, deflateRawSync, inflateRawSync } from 'zlib';

// P0-026 — Lectura y escritura mínimas de XLSX (Office Open XML) sin dependencias.
// Lectura acotada a lo que la importación necesita: una hoja, valores de celda como texto. Defensas:
// - Límites del ZIP comprobados sobre los bytes REALES descomprimidos (maxOutputLength), no sobre la cabecera:
//   número de entradas, tamaño por entrada, total y razón de compresión (bombas ZIP).
// - Sin ZIP64, sin cifrado, solo métodos 0 (store) y 8 (deflate).
// - Macros: un libro con vbaProject.bin o tipo macroEnabled se rechaza; nada se ejecuta nunca.
// - Fórmulas: no se evalúan; la celda queda marcada `formula` y la importación la rechaza como error de fila.
// - XML sin DOCTYPE ni entidades declaradas (evita expansión de entidades).

export interface XlsxLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxRatio: number;
  maxRows: number;
  maxColumns: number;
}

export const DEFAULT_XLSX_LIMITS: XlsxLimits = {
  maxEntries: 200, maxEntryBytes: 16 * 1024 * 1024, maxTotalBytes: 40 * 1024 * 1024, maxRatio: 200, maxRows: 5000, maxColumns: 50,
};

export class XlsxError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** `numeric`: celda numérica de Excel (un documento o teléfono así pudo perder ceros iniciales). */
export interface XlsxCell { value: string; formula: boolean; numeric: boolean }
export interface XlsxRow { rowNumber: number; cells: Array<XlsxCell | undefined> }
export interface XlsxSheet { name: string; rows: XlsxRow[] }

interface ZipEntry { name: string; method: number; flags: number; compressedSize: number; uncompressedSize: number; offset: number }

function readEntries(buf: Buffer, limits: XlsxLimits): ZipEntry[] {
  // Fin del directorio central: firma 0x06054b50 en los últimos 65 557 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError('FILE_NOT_XLSX', 'El archivo no es un libro de Excel (.xlsx) válido.');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new XlsxError('FILE_NOT_SUPPORTED', 'Formato ZIP64 no admitido.');
  if (count > limits.maxEntries) throw new XlsxError('FILE_TOO_COMPLEX', `El libro tiene demasiadas partes internas (máximo ${limits.maxEntries}).`);
  if (cdOffset + cdSize > buf.length) throw new XlsxError('FILE_NOT_XLSX', 'El archivo está dañado o incompleto.');
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError('FILE_NOT_XLSX', 'El archivo está dañado o incompleto.');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (flags & 0x1) throw new XlsxError('FILE_ENCRYPTED', 'El libro está protegido con contraseña; guárdalo sin protección.');
    if (method !== 0 && method !== 8) throw new XlsxError('FILE_NOT_SUPPORTED', 'El libro usa una compresión no admitida.');
    entries.push({ name, method, flags, compressedSize, uncompressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

class ZipReader {
  private readonly entries: Map<string, ZipEntry>;
  private total = 0;

  constructor(private readonly buf: Buffer, private readonly limits: XlsxLimits) {
    this.entries = new Map(readEntries(buf, limits).map((e) => [e.name, e]));
  }

  names() { return [...this.entries.keys()]; }

  read(name: string): Buffer | null {
    const e = this.entries.get(name);
    if (!e) return null;
    const p = e.offset;
    if (p + 30 > this.buf.length || this.buf.readUInt32LE(p) !== 0x04034b50) throw new XlsxError('FILE_NOT_XLSX', 'El archivo está dañado o incompleto.');
    const start = p + 30 + this.buf.readUInt16LE(p + 26) + this.buf.readUInt16LE(p + 28);
    const data = this.buf.subarray(start, start + e.compressedSize);
    const cap = Math.min(this.limits.maxEntryBytes, this.limits.maxTotalBytes - this.total);
    let out: Buffer;
    try {
      out = e.method === 0 ? Buffer.from(data) : inflateRawSync(data, { maxOutputLength: cap + 1 });
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new XlsxError('FILE_TOO_LARGE_UNCOMPRESSED', 'El contenido descomprimido supera el límite permitido.');
      throw new XlsxError('FILE_NOT_XLSX', 'El archivo está dañado o incompleto.');
    }
    if (out.length > cap) throw new XlsxError('FILE_TOO_LARGE_UNCOMPRESSED', 'El contenido descomprimido supera el límite permitido.');
    if (data.length > 0 && out.length / data.length > this.limits.maxRatio && out.length > 1024 * 1024) {
      throw new XlsxError('FILE_SUSPICIOUS_COMPRESSION', 'El archivo tiene una compresión anómala y no se procesa.');
    }
    this.total += out.length;
    return out;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return ENTITIES[e] ?? m;
  });
}

function xmlText(buf: Buffer): string {
  const s = buf.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(s)) throw new XlsxError('FILE_NOT_SUPPORTED', 'El libro contiene declaraciones XML no admitidas.');
  return s;
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
};

/** Texto de un <si> o <is>: concatena los <t> (incluidos los de texto enriquecido), sin la guía fonética <rPh>. */
function richText(xml: string): string {
  const noPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of noPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decodeXml(m[1] ?? '');
  return out;
}

const colIndex = (ref: string) => {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/**
 * Lee una hoja de un libro XLSX: la llamada `preferredSheet` si existe; si no, la primera. Devuelve solo filas con
 * algún valor. Las celdas con fórmula llevan `formula: true` y su valor almacenado NO se usa como dato.
 */
export function readXlsx(buf: Buffer, preferredSheet: string, limits: XlsxLimits = DEFAULT_XLSX_LIMITS): XlsxSheet {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new XlsxError('FILE_NOT_XLSX', 'El archivo no es un libro de Excel (.xlsx) válido.');
  const zip = new ZipReader(buf, limits);
  const names = zip.names();
  const types = zip.read('[Content_Types].xml');
  if (!types || !names.includes('xl/workbook.xml')) throw new XlsxError('FILE_NOT_XLSX', 'El archivo no es un libro de Excel (.xlsx) válido.');
  if (names.some((n) => /vbaProject\.bin$/i.test(n)) || /macroEnabled/i.test(xmlText(types))) {
    throw new XlsxError('MACROS_NOT_ALLOWED', 'El libro contiene macros. Guárdalo como «Libro de Excel (.xlsx)» sin macros.');
  }

  const workbook = xmlText(zip.read('xl/workbook.xml')!);
  const rels = xmlText(zip.read('xl/_rels/workbook.xml.rels') ?? Buffer.from(''));
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: attr(m[0], 'name') ?? '', rid: attr(m[0], 'r:id') }));
  if (sheets.length === 0) throw new XlsxError('FILE_EMPTY', 'El libro no tiene hojas.');
  const chosen = sheets.find((s) => s.name.trim().toLowerCase() === preferredSheet.toLowerCase()) ?? sheets[0];
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, 'Id') === chosen.rid);
  const target = rel ? attr(rel, 'Target') ?? '' : '';
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`.replace(/\/\.\//g, '/');
  const sheetBuf = zip.read(path);
  if (!sheetBuf) throw new XlsxError('FILE_NOT_XLSX', 'No se encontró la hoja del libro.');

  const sharedBuf = zip.read('xl/sharedStrings.xml');
  const shared = sharedBuf ? [...xmlText(sharedBuf).matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map((m) => richText(m[1] ?? '')) : [];

  const sheet = xmlText(sheetBuf);
  const rows: XlsxRow[] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = Number(attr(rm[0], 'r'));
    if (!Number.isInteger(rowNumber) || rowNumber < 1) throw new XlsxError('FILE_NOT_XLSX', 'La hoja tiene filas sin número.');
    const cells: Array<XlsxCell | undefined> = [];
    let any = false;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const open = `<c${cm[1]}>`;
      const ref = attr(open, 'r');
      if (!ref) continue;
      const col = colIndex(ref);
      if (col >= limits.maxColumns) throw new XlsxError('FILE_TOO_MANY_COLUMNS', `La hoja tiene más de ${limits.maxColumns} columnas.`);
      const inner = cm[2] ?? '';
      const type = attr(open, 't');
      const formula = /<f\b/.test(inner);
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = v !== undefined ? shared[Number(v)] ?? '' : '';
      else if (type === 'inlineStr') value = richText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '');
      else if (type === 'b') value = v === '1' ? 'VERDADERO' : v === '0' ? 'FALSO' : '';
      else value = v !== undefined ? decodeXml(v) : '';
      if (formula) value = '';
      if (value !== '' || formula) any = true;
      cells[col] = { value, formula, numeric: !formula && value !== '' && (type === null || type === 'n') };
    }
    if (!any) continue;
    rows.push({ rowNumber, cells });
    if (rows.length > limits.maxRows + 1) throw new XlsxError('FILE_TOO_MANY_ROWS', `La hoja tiene más de ${limits.maxRows} filas de datos.`);
  }
  return { name: chosen.name, rows };
}

// ---------------------------------------------------------------- escritura (plantillas e informes)

const escXml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = (i: number) => { let s = ''; let n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

function sheetXml(rows: string[][], widths: number[]): string {
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${colName(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${escXml(v)}</t></is></c>`).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

/** ZIP mínimo. `method` 8 = deflate (solo para fabricar casos en pruebas); por defecto 0 = sin compresión. */
export function buildZip(files: Array<{ name: string; data: Buffer; method?: 0 | 8; flags?: number }>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const method = f.method ?? 0;
    const body = method === 8 ? deflateRawSync(f.data) : f.data;
    const flags = 0x0800 | (f.flags ?? 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(flags, 8); cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(0, 12); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    central.push(cd, name);
    offset += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, end]);
}

/** Libro XLSX de solo texto (celdas inlineStr), sin fórmulas ni macros. La primera fila de cada hoja va en negrita. */
export function writeXlsx(sheets: Array<{ name: string; rows: string[][]; widths?: number[] }>): Buffer {
  const b = (s: string) => Buffer.from(s, 'utf8');
  const files = [
    { name: '[Content_Types].xml', data: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
    { name: '_rels/.rels', data: b('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: b(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: b('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" applyFont="1" applyNumberFormat="1"/></cellXfs></styleSheet>') },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: b(sheetXml(s.rows, s.widths ?? [])) })),
  ];
  return buildZip(files);
}
