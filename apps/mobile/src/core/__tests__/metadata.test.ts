import { createHash } from 'node:crypto';
import { fixtureJpeg, fixtureTiff } from '../fixtures';
import { hasImageMetadata, imageOrientation, stripImageMetadata } from '../metadata';

// Fixtures sintéticos (no son fotos). La orientación visual depende de la etiqueta EXIF 0x0112: se comprueba que se
// conserva con el mismo valor tras eliminar el resto de metadatos (no se renderizan píxeles).
const has = (b: Uint8Array, t: string) => Buffer.from(b).includes(Buffer.from(t, 'latin1'));

describe('D-41 metadatos de fotos', () => {
  it.each([1, 3, 6, 8])('JPEG con orientación %i: se conserva la orientación; desaparecen modelo, GPS y XMP', (o) => {
    const original = fixtureJpeg('x', true, o);
    expect(imageOrientation(original, 'image/jpeg')).toBe(o);
    expect(has(original, 'TelefonoSintetico') && has(original, 'xmpmeta')).toBe(true);
    const s = stripImageMetadata(original, 'image/jpeg');
    expect(imageOrientation(s, 'image/jpeg')).toBe(o);
    expect(has(s, 'TelefonoSintetico')).toBe(false);
    expect(has(s, 'xmpmeta')).toBe(false);
    expect(Buffer.from(s).includes(Buffer.from([0x88, 0x25]))).toBe(false); // sin puntero a IFD GPS
    expect(has(s, 'datos-sinteticos-x')).toBe(true); // datos de imagen intactos
    if (o === 1) expect(has(s, 'Exif')).toBe(false); // orientación normal: sin segmento EXIF
    // idempotente y aceptada por la regla del servidor; el original no
    expect(Buffer.from(stripImageMetadata(s, 'image/jpeg')).equals(Buffer.from(s))).toBe(true);
    expect(hasImageMetadata(s, 'image/jpeg')).toBe(false);
    expect(hasImageMetadata(original, 'image/jpeg')).toBe(true);
  });

  it('el archivo procesado tiene otro SHA-256 que el original de la cámara (es un archivo procesado por la app)', () => {
    const original = fixtureJpeg('y', true, 6);
    const s = stripImageMetadata(original, 'image/jpeg');
    const h = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    expect(h(s)).not.toBe(h(original));
  });

  it('PNG: eXIf con orientación se reduce a la orientación; tEXt se elimina', () => {
    const chunk = (type: string, data: number[]) => { const t = Array.from(type, (c) => c.charCodeAt(0)); return [...[24, 16, 8, 0].map((s) => (data.length >>> s) & 0xff), ...t, ...data, 0, 0, 0, 0]; };
    const ihdr = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ihdr, ...chunk('eXIf', fixtureTiff(8)), ...chunk('tEXt', Array.from('Author\0Persona', (c) => c.charCodeAt(0))), ...chunk('IEND', [])]);
    expect(imageOrientation(png, 'image/png')).toBe(8);
    const s = stripImageMetadata(png, 'image/png');
    expect(imageOrientation(s, 'image/png')).toBe(8);
    expect(has(s, 'TelefonoSintetico') || has(s, 'Persona')).toBe(false);
    expect(hasImageMetadata(s, 'image/png')).toBe(false);
  });

  it('estructura inválida: se rechaza (no se guarda un archivo sin poder limpiarlo)', () => {
    expect(() => stripImageMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x20, 0x66]), 'image/jpeg')).toThrow();
    expect(hasImageMetadata(new Uint8Array([1, 2, 3]), 'image/jpeg')).toBe(true);
  });
});
