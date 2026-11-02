// D — Mapa en la app de campo. Reglas PURAS (sin Expo ni WebView) para poder probarlas en Node.
//   · El mapa es una REFERENCIA VISUAL (OpenStreetMap, servicio `maps` del propio despliegue). No acredita límites de propiedad, precisión GPS,
//     deforestación ni conformidad, y NO ajusta ningún vértice a elementos del mapa.
//   · Mostrar la ubicación en el mapa NO guarda nada: la geometría solo cambia con las acciones explícitas de la captura.
//   · Sin cartografía preparada para la zona el mapa no inventa un fondo: dice que falta y sigue mostrando los puntos.

export interface LonLat { lon: number; lat: number }
export interface MapArea { id: string; label: string; center_lat: number; center_lon: number; radius_km: number; min_zoom: number; max_zoom: number; tiles: number; bytes: number; prepared_at: string; source_label: string }

export const MIN_PREP_ZOOM = 6;
export const MAX_PREP_ZOOM = 14; // el servicio solo tiene detalle hasta 14; más cerca se amplía
export const DEFAULT_RADIUS_KM = 5;
export const RADIUS_OPTIONS_KM = [2, 5, 10, 20] as const;
export const MAX_PREP_TILES = 4000;

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LonLat, b: LonLat): number {
  const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function validLonLat(p: LonLat): boolean {
  return Number.isFinite(p.lon) && Number.isFinite(p.lat) && Math.abs(p.lat) <= 85 && Math.abs(p.lon) <= 180;
}

/** Teselas XYZ (esquema web mercator) que contienen el punto en el zoom z. */
export function lonLatToTile(p: LonLat, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((p.lon + 180) / 360) * n);
  const latR = rad(Math.max(-85.0511, Math.min(85.0511, p.lat)));
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/** Caja que rodea al centro con el radio dado (aproximación plana suficiente para <= 50 km). */
export function bboxAround(c: LonLat, radiusKm: number): { west: number; south: number; east: number; north: number } {
  const dLat = (radiusKm * 1000) / 111_320;
  const dLon = (radiusKm * 1000) / (111_320 * Math.max(0.05, Math.cos(rad(c.lat))));
  return { west: c.lon - dLon, east: c.lon + dLon, south: c.lat - dLat, north: c.lat + dLat };
}

/** Lista de teselas a descargar para un área. Nunca supera `cap`: si no cabe, se recorta el zoom máximo (y se informa). */
export function tilesForArea(c: LonLat, radiusKm: number, minZ = MIN_PREP_ZOOM, maxZ = MAX_PREP_ZOOM, cap = MAX_PREP_TILES): { tiles: Array<[number, number, number]>; max_zoom: number; reduced: boolean } {
  const b = bboxAround(c, radiusKm);
  const perZoom = (z: number) => {
    const a = lonLatToTile({ lon: b.west, lat: b.north }, z); const d = lonLatToTile({ lon: b.east, lat: b.south }, z);
    return { x0: a.x, x1: d.x, y0: a.y, y1: d.y, n: (d.x - a.x + 1) * (d.y - a.y + 1) };
  };
  let top = maxZ;
  const total = (zmax: number) => { let t = 0; for (let z = minZ; z <= zmax; z += 1) t += perZoom(z).n; return t; };
  while (top > minZ && total(top) > cap) top -= 1;
  const tiles: Array<[number, number, number]> = [];
  for (let z = minZ; z <= top; z += 1) { const r = perZoom(z); for (let x = r.x0; x <= r.x1; x += 1) for (let y = r.y0; y <= r.y1; y += 1) tiles.push([z, x, y]); }
  return { tiles, max_zoom: top, reduced: top < maxZ };
}

/** Un punto cae dentro del área preparada (con margen del 10 %): fuera de ella el fondo no tiene detalle. */
export function areaCovers(a: Pick<MapArea, 'center_lat' | 'center_lon' | 'radius_km'>, p: LonLat): boolean {
  return distanceM({ lat: a.center_lat, lon: a.center_lon }, p) <= a.radius_km * 1000 * 0.9;
}

export type MapBasemapState =
  | { kind: 'NONE_PREPARED'; message: string }
  | { kind: 'OUTSIDE_AREA'; message: string }
  | { kind: 'READY'; area: MapArea; message: string };

/** Estado explícito del fondo cartográfico para un punto de interés. Los puntos propios se dibujan en cualquier estado. */
export function basemapState(areas: MapArea[], focus: LonLat | null): MapBasemapState {
  if (!areas.length) return { kind: 'NONE_PREPARED', message: 'No hay cartografía preparada en este dispositivo. El mapa muestra solo tus puntos sobre un fondo vacío. Prepárala con conexión antes de salir al campo.' };
  if (!focus) return { kind: 'READY', area: areas[0], message: `Cartografía preparada: ${areas[0].label}.` };
  const hit = areas.find((a) => areaCovers(a, focus));
  if (hit) return { kind: 'READY', area: hit, message: `Cartografía preparada: ${hit.label} (radio ${hit.radius_km} km).` };
  return { kind: 'OUTSIDE_AREA', message: 'Esta zona está fuera de la cartografía preparada: el fondo no tendrá detalle aquí. Los puntos que captures se dibujan igual. Prepara esta zona con conexión.' };
}

/** Dirección del servicio de cartografía a partir de la del servidor: mismo servidor, puerto propio (por omisión 8090). */
export function mapsUrlFor(serverUrl: string, port = 8090): string | null {
  const m = /^(https?):\/\/([^/:]+)(?::\d+)?/i.exec(serverUrl.trim());
  if (!m) return null;
  return `${m[1].toLowerCase()}://${m[2]}:${port}`;
}

/** Círculo aproximado (anillo cerrado, [lon, lat]) para dibujar la precisión informada de una lectura. */
export function circleRing(c: LonLat, radiusM: number, steps = 48): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dLat = radiusM / 111_320; const dLon = radiusM / (111_320 * Math.max(0.05, Math.cos(rad(c.lat))));
  for (let i = 0; i <= steps; i += 1) { const t = (2 * Math.PI * i) / steps; out.push([c.lon + dLon * Math.cos(t), c.lat + dLat * Math.sin(t)]); }
  return out;
}

export interface MapVertex { seq: number; latitude: number; longitude: number; accuracy_m: number | null; mocked: boolean | null }
export interface MapLocation { latitude: number; longitude: number; accuracy_m: number | null }

/** Todo lo que el mapa dibuja; el componente solo lo pinta. `manual` queda reservado: esta app NO ofrece coordenadas manuales como si fueran del dispositivo. */
export interface MapScene {
  vertices: MapVertex[];
  saved_location: MapLocation | null;
  reading: (MapLocation & { fresh: boolean }) | null;
}

export function sceneBounds(sc: MapScene): { west: number; south: number; east: number; north: number } | null {
  const pts: LonLat[] = [...sc.vertices.map((v) => ({ lon: v.longitude, lat: v.latitude })), ...(sc.saved_location ? [{ lon: sc.saved_location.longitude, lat: sc.saved_location.latitude }] : []), ...(sc.reading ? [{ lon: sc.reading.longitude, lat: sc.reading.latitude }] : [])].filter(validLonLat);
  if (!pts.length) return null;
  return { west: Math.min(...pts.map((p) => p.lon)), east: Math.max(...pts.map((p) => p.lon)), south: Math.min(...pts.map((p) => p.lat)), north: Math.max(...pts.map((p) => p.lat)) };
}

/** Centro de interés para elegir qué zona preparar: lectura actual > ubicación guardada > último vértice. */
export function focusOf(sc: MapScene): LonLat | null {
  if (sc.reading) return { lon: sc.reading.longitude, lat: sc.reading.latitude };
  if (sc.saved_location) return { lon: sc.saved_location.longitude, lat: sc.saved_location.latitude };
  const v = sc.vertices[sc.vertices.length - 1];
  return v ? { lon: v.longitude, lat: v.latitude } : null;
}

/** Revisión de los vértices: avisos que la persona debe ver antes de dar por buena la captura (orientativos, no regulatorios). */
export function reviewVertices(vs: MapVertex[]): string[] {
  const out: string[] = [];
  if (vs.length > 0 && vs.length < 3) out.push(`Hay ${vs.length} vértice(s): un polígono necesita al menos 3.`);
  const bad = vs.filter((v) => v.accuracy_m === null);
  if (bad.length) out.push(`${bad.length} vértice(s) sin precisión informada: tómalos como aproximados.`);
  const loose = vs.filter((v) => v.accuracy_m !== null && v.accuracy_m > 30);
  if (loose.length) out.push(`${loose.length} vértice(s) con precisión mayor a 30 m: revisa si conviene repetirlos.`);
  const mocked = vs.filter((v) => v.mocked === true);
  if (mocked.length) out.push(`${mocked.length} vértice(s) marcados como simulados por el sistema.`);
  for (let i = 1; i < vs.length; i += 1) {
    const d = distanceM({ lat: vs[i - 1].latitude, lon: vs[i - 1].longitude }, { lat: vs[i].latitude, lon: vs[i].longitude });
    if (d < 1) { out.push(`Los vértices ${vs[i - 1].seq} y ${vs[i].seq} están a menos de 1 m: ¿se repitió la lectura?`); break; }
    if (d > 5000) { out.push(`Los vértices ${vs[i - 1].seq} y ${vs[i].seq} están a ${Math.round(d / 1000)} km: revisa que pertenezcan a la misma parcela.`); break; }
  }
  return out;
}
