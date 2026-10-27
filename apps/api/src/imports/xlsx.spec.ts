import { DEFAULT_XLSX_LIMITS, XlsxError, buildZip, readXlsx, writeXlsx } from './xlsx';

// P0-026: lector XLSX acotado. Casos hostiles fabricados aquí (sin archivos binarios versionados).
const b = (s: string) => Buffer.from(s, 'utf8');
const TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';
const WB = '<workbook xmlns:r="r"><sheets><sheet name="productores" sheetId="1" r:id="rId1"/></sheets></workbook>';
const RELS = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>';
function book(sheet: string, extra: Array<{ name: string; data: Buffer; method?: 0 | 8; flags?: number }> = [], opts: { types?: string; shared?: string; method?: 0 | 8 } = {}) {
  return buildZip([
    { name: '[Content_Types].xml', data: b(opts.types ?? TYPES) },
    { name: 'xl/workbook.xml', data: b(WB) },
    { name: 'xl/_rels/workbook.xml.rels', data: b(RELS) },
    ...(opts.shared ? [{ name: 'xl/sharedStrings.xml', data: b(opts.shared) }] : []),
    { name: 'xl/worksheets/sheet1.xml', data: b(`<worksheet><sheetData>${sheet}</sheetData></worksheet>`), method: opts.method },
    ...extra,
  ]);
}
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof XlsxError ? e.code : `OTRO:${String(e)}`; } return 'SIN_ERROR'; };

describe('readXlsx (P0-026)', () => {
  it('lee la plantilla escrita (ida y vuelta) y elige la hoja por nombre', () => {
    const buf = writeXlsx([{ name: 'otra', rows: [['x']] }, { name: 'productores', rows: [['codigo_productor', 'nombres'], ['PRD-1', 'Ana & <Luz>'], ['0912', '']] }]);
    const s = readXlsx(buf, 'productores');
    expect(s.name).toBe('productores');
    expect(s.rows.map((r) => [r.rowNumber, r.cells.map((c) => c?.value)])).toEqual([[1, ['codigo_productor', 'nombres']], [2, ['PRD-1', 'Ana & <Luz>']], [3, ['0912', '']]]);
    expect(s.rows[2].cells[0]).toMatchObject({ numeric: false, formula: false });
  });

  it('cadenas compartidas, texto enriquecido sin guía fonética, numéricas, booleanas y filas vacías omitidas', () => {
    const shared = '<sst><si><t>uno</t></si><si><r><t>do</t></r><r><t xml:space="preserve">s </t></r><rPh><t>X</t></rPh></si></sst>';
    const s = readXlsx(book('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"/><row r="3"><c r="B3"><v>912345678</v></c><c r="D3" t="b"><v>1</v></c></row>', [], { shared }), 'productores');
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0].cells.map((c) => c?.value)).toEqual(['uno', undefined, 'dos ']);
    expect(s.rows[1].cells[1]).toEqual({ value: '912345678', formula: false, numeric: true });
    expect(s.rows[1].cells[3]?.value).toBe('VERDADERO');
  });

  it('fórmulas: nunca se usa el valor calculado; la celda queda marcada', () => {
    const s = readXlsx(book('<row r="1"><c r="A1" t="str"><f>CONCAT("a","b")</f><v>ab</v></c><c r="B1"><f>1+1</f><v>2</v></c></row>'), 'productores');
    expect(s.rows[0].cells[0]).toEqual({ value: '', formula: true, numeric: false });
    expect(s.rows[0].cells[1]).toEqual({ value: '', formula: true, numeric: false });
  });

  it('rechaza macros (vbaProject.bin o tipo macroEnabled)', () => {
    expect(code(() => readXlsx(book('', [{ name: 'xl/vbaProject.bin', data: b('x') }]), 'p'))).toBe('MACROS_NOT_ALLOWED');
    expect(code(() => readXlsx(book('', [], { types: TYPES.replace('sheet.main+xml', 'sheet.macroEnabled.main+xml') }), 'p'))).toBe('MACROS_NOT_ALLOWED');
  });

  it('rechaza DOCTYPE/ENTITY (expansión de entidades)', () => {
    const evil = '<!DOCTYPE x [<!ENTITY a "aaaa">]><sst><si><t>&a;</t></si></sst>';
    expect(code(() => readXlsx(book('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', [], { shared: evil }), 'p'))).toBe('FILE_NOT_SUPPORTED');
  });

  it('bomba ZIP: el límite se aplica a los bytes reales descomprimidos', () => {
    const huge = `<row r="1"><c r="A1" t="inlineStr"><is><t>${'0'.repeat(3 * 1024 * 1024)}</t></is></c></row>`;
    expect(code(() => readXlsx(book(huge, [], { method: 8 }), 'p', { ...DEFAULT_XLSX_LIMITS, maxEntryBytes: 1024 * 1024 }))).toBe('FILE_TOO_LARGE_UNCOMPRESSED');
    expect(code(() => readXlsx(book(huge, [], { method: 8 }), 'p', { ...DEFAULT_XLSX_LIMITS, maxRatio: 10 }))).toBe('FILE_SUSPICIOUS_COMPRESSION');
  });

  it('cifrado, no-ZIP, demasiadas filas o columnas', () => {
    expect(code(() => readXlsx(book('', [{ name: 'x', data: b('x'), flags: 1 }]), 'p'))).toBe('FILE_ENCRYPTED');
    expect(code(() => readXlsx(b('codigo,nombre\nA,B'), 'p'))).toBe('FILE_NOT_XLSX');
    const rows = Array.from({ length: 12 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>v</t></is></c></row>`).join('');
    expect(code(() => readXlsx(book(rows), 'p', { ...DEFAULT_XLSX_LIMITS, maxRows: 10 }))).toBe('FILE_TOO_MANY_ROWS');
    expect(code(() => readXlsx(book('<row r="1"><c r="AZ1" t="inlineStr"><is><t>v</t></is></c></row>'), 'p'))).toBe('FILE_TOO_MANY_COLUMNS');
  });
});
