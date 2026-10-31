import { crc32, deflateRawSync, deflateSync } from 'zlib';
import { ClamdScanner, interpretReply } from '../src/storage/scanner';
import { describeDb } from './helpers';

// Comprobación del escáner real (ClamAV local, infra/clamav/clamd.conf). Fixtures SINTÉTICOS generados en
// memoria: un flujo mayor que StreamMaxLength y un ZIP cuyo archivo interno supera MaxFileSize. Ninguno es
// malicioso; verifican que un análisis INCOMPLETO no se interpreta como limpio.
const scanner = () => new ClamdScanner(process.env.SCANNER_HOST ?? 'localhost', Number(process.env.SCANNER_PORT ?? 3310), 30_000);

/** ZIP mínimo con un único archivo comprimido (deflate). */
function zipOf(name: string, content: Buffer): Buffer {
  const data = deflateRawSync(content);
  const crc = crc32(content);
  const fname = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 10); local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(fname.length, 26); local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 12); central.writeUInt32LE(crc >>> 0, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(fname.length, 28); central.writeUInt32LE(0, 42);
  const offsetCentral = local.length + fname.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fname.length, 12); end.writeUInt32LE(offsetCentral, 16);
  return Buffer.concat([local, fname, data, central, fname, end]);
}

describe('interpretación de respuestas de clamd', () => {
  it('limpio, malware, límite alcanzado (incompleto), tamaño de flujo y respuesta desconocida', () => {
    expect(interpretReply('stream: OK\0')).toMatchObject({ result: 'CLEAN' });
    expect(interpretReply('stream: Eicar-Test-Signature FOUND\0')).toMatchObject({ result: 'INFECTED', signature: 'Eicar-Test-Signature' });
    expect(interpretReply('stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND\0')).toMatchObject({ result: 'FAILED', error_code: 'SCAN_INCOMPLETE_LIMITS' });
    expect(interpretReply('INSTREAM size limit exceeded. ERROR\0')).toMatchObject({ result: 'FAILED', error_code: 'SCANNER_SIZE_LIMIT' });
    expect(interpretReply('algo raro')).toMatchObject({ result: 'FAILED', error_code: 'SCANNER_UNEXPECTED_REPLY' });
  });
});

describeDb('escáner real: límites efectivos', () => {
  it('flujo mayor que StreamMaxLength (16 MiB) → FAILED, nunca limpio', async () => {
    const r = await scanner().scan(Buffer.alloc(17 * 1024 * 1024, 0x41));
    expect(r.result).toBe('FAILED');
    expect(['SCANNER_SIZE_LIMIT', 'SCANNER_ERROR']).toContain(r.error_code);
  });

  it('ZIP anidado por encima de MaxRecursion (17) → análisis incompleto (AlertExceedsMax), no limpio', async () => {
    let data: Buffer = Buffer.from('contenido sintético');
    for (let i = 0; i < 20; i++) data = zipOf(i === 0 ? 'a.txt' : `n${i}.zip`, data);
    const r = await scanner().scan(data);
    expect(r).toMatchObject({ result: 'FAILED', error_code: 'SCAN_INCOMPLETE_LIMITS' });
    expect(r.signature).toBe('Heuristics.Limits.Exceeded.MaxRecursion');
  });

  // Formato admitido (PDF): un flujo FlateDecode pequeño en el envío (~110 KiB) que se descomprime por encima de
  // MaxFileSize (100 MiB) no queda «limpio» parcialmente: clamd lo informa como límite excedido → incompleto.
  it('PDF con flujo comprimido que se infla sobre MaxFileSize → análisis incompleto, no limpio', async () => {
    const data = deflateSync(Buffer.alloc(110 * 1024 * 1024, 0x20), { level: 9 });
    const pdf = Buffer.concat([
      Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`), data,
      Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'),
    ]);
    expect(pdf.length).toBeLessThan(10 * 1024 * 1024); // cabe en el límite de subida
    const r = await scanner().scan(pdf);
    expect(r).toMatchObject({ result: 'FAILED', error_code: 'SCAN_INCOMPLETE_LIMITS', signature: 'Heuristics.Limits.Exceeded.MaxFileSize' });
  });

  it('archivo pequeño sintético → limpio', async () => {
    expect((await scanner().scan(Buffer.from('%PDF-1.4\n% sintético\n%%EOF\n'))).result).toBe('CLEAN');
  });
});
