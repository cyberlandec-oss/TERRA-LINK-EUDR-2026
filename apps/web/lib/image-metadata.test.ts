import { describe, expect, it } from 'vitest';
import { hasImageMetadata, imageOrientation, stripImageMetadata } from './image-metadata';

// D-41 / A-01 — la web prepara una COPIA sin metadatos antes de subir una foto; el original no se toca. Fixtures sintéticos.
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const has = (b: Uint8Array, t: string) => Buffer.from(b).includes(Buffer.from(t, 'latin1'));
const seg = (marker: number, data: number[]) => [0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff, ...data];
// TIFF little-endian con orientación y un puntero a IFD GPS (0x8825), como una cámara real.
const tiff = (o: number) => [0x49, 0x49, 42, 0, 8, 0, 0, 0, 2, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 0x30, 0, 0, 0, 0, 0, 0, 0];
const jpeg = (o: number) => new Uint8Array([0xff, 0xd8,
  ...seg(0xe1, [...ascii('Exif\0\0'), ...tiff(o)]), ...seg(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<xmpmeta>TelefonoSintetico</xmpmeta>')),
  ...seg(0xfe, ascii('comentario con datos personales')), ...seg(0xdb, [0, 1, 2, 3]),
  0xff, 0xda, 0, 4, 1, 0, ...ascii('datos-sinteticos'), 0xff, 0xd9]);

describe('metadatos de fotografías en la web (D-41)', () => {
  it.each([1, 3, 6, 8])('JPEG con orientación %i: la copia conserva la orientación y pierde GPS, XMP y comentarios; el original no cambia', (o) => {
    const original = jpeg(o);
    const antes = Buffer.from(original).toString('hex');
    expect(hasImageMetadata(original, 'image/jpeg')).toBe(true);
    const copia = stripImageMetadata(original, 'image/jpeg');
    expect(Buffer.from(original).toString('hex')).toBe(antes);            // el archivo original no se modifica
    expect(imageOrientation(copia, 'image/jpeg')).toBe(o);
    expect(has(copia, 'TelefonoSintetico') || has(copia, 'comentario')).toBe(false);
    expect(Buffer.from(copia).includes(Buffer.from([0x25, 0x88]))).toBe(false);   // sin puntero a IFD GPS
    expect(has(copia, 'datos-sinteticos')).toBe(true);                    // datos de imagen intactos
    expect(hasImageMetadata(copia, 'image/jpeg')).toBe(false);            // la regla del servidor la acepta
  });
  it('estructura inválida: no se puede preparar (no se sube nada)', () => {
    expect(() => stripImageMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x20, 0x66]), 'image/jpeg')).toThrow();
  });
});
