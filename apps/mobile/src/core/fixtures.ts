// Fixtures SINTÉTICOS para el entorno de prueba sin cifrado (Expo Go) y para pruebas. Pertenecer a una organización DEMO
// no convierte una foto o una ubicación real en datos sintéticos: en Expo Go la app NO usa cámara ni ubicación reales,
// solo estos fixtures. El ensayo con fotos y ubicación reales corresponde al build nativo con cifrado.

export const FIXTURE_PROVIDER = 'FIXTURE SINTÉTICA (entorno de prueba sin cifrado): no es una ubicación real ni del dispositivo';

/** Muestra de ubicación de prueba (coordenadas ficticias fijas, sin precisión informada, marcada como simulada). */
export function fixtureLocation(now: Date) {
  return { latitude: -1.0, longitude: -80.0, accuracy_m: null, acquired_at: now.toISOString(), provider_detail: FIXTURE_PROVIDER, mocked: true };
}

const enc = (t: string) => Array.from(t, (c) => c.charCodeAt(0) & 0xff);
const be16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const be32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];

/** TIFF EXIF sintético (big-endian): Orientation, Model «TelefonoSintetico» y un IFD GPS con latitud «S». */
export function fixtureTiff(orientation: number): number[] {
  const model = [...enc('TelefonoSintetico'), 0];
  // cabecera 8 + IFD0 (2 + 3*12 + 4 = 42) → datos de Model en 50, IFD GPS después
  const modelOff = 8 + 42;
  const gpsOff = modelOff + model.length;
  const ifd0 = [...be16(3),
    ...be16(0x0110), ...be16(2), ...be32(model.length), ...be32(modelOff), // Model (ASCII)
    ...be16(0x0112), ...be16(3), ...be32(1), ...be16(orientation), 0, 0, // Orientation
    ...be16(0x8825), ...be16(4), ...be32(1), ...be32(gpsOff), // GPSInfo IFD
    ...be32(0)];
  const gps = [...be16(1), ...be16(0x0001), ...be16(2), ...be32(2), ...enc('S'), 0, 0, 0, ...be32(0)]; // GPSLatitudeRef = "S"
  return [0x4d, 0x4d, 0, 0x2a, ...be32(8), ...ifd0, ...model, ...gps];
}

/** JPEG sintético mínimo y válido (no es una foto). `exif` añade un EXIF real (TIFF) con orientación, modelo y GPS. */
export function fixtureJpeg(seed: string, exif = false, orientation = 6): Uint8Array {
  const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  const app0 = seg(0xe0, [...enc('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const app1 = seg(0xe1, [...enc('Exif'), 0, 0, ...fixtureTiff(orientation)]);
  const xmp = seg(0xe1, [...enc('http://ns.adobe.com/xap/1.0/'), 0, ...enc('<x:xmpmeta>GPS sintético</x:xmpmeta>')]);
  const sos = seg(0xda, [1, 1, 0, 0, 0x3f, 0]);
  const data = enc(`datos-sinteticos-${seed}`);
  return new Uint8Array([0xff, 0xd8, ...app0, ...(exif ? [...app1, ...xmp] : []), ...sos, ...data, 0xff, 0xd9]);
}
