// Perfil de importación GeoJSON de Terra Link (P0-009), conforme a RFC 7946.
// Versión: GEOJSON_IMPORT_V1. Se aplica sobre los BYTES recibidos; nunca modifica la geometría:
// sin reproyección, sin intercambio de ejes, sin eliminar dimensiones, sin cerrar anillos ni reparar.
//
// Admite
// - Geometría directa Polygon o MultiPolygon; Feature con esa geometría; FeatureCollection con
//   EXACTAMENTE un Feature (advertencia explícita). Varias features → rechazo: un archivo = una parcela.
// - Posiciones [longitud, latitud] en grados decimales WGS84 (CRS84). Exactamente 2 valores.
// Rechaza (error comprensible, sin eco del contenido)
// - JSON mal formado o no UTF-8; tipos distintos de Polygon/MultiPolygon (Point, LineString,
//   GeometryCollection…); Feature sin geometría; FeatureCollection vacía o con varias features.
// - Altitud u otras dimensiones (3+ valores): no se descartan en silencio.
// - Miembro `crs` heredado (GeoJSON 2008) distinto de CRS84; EPSG:4326 declarado también se rechaza
//   porque su orden de ejes es ambiguo. CRS84 declarado se acepta con advertencia (RFC 7946 lo ignora).
// - Anillos con menos de 4 posiciones o no cerrados; coordenadas fuera de rango o no numéricas.
// - Límites configurables: bytes, profundidad JSON, componentes, anillos por polígono, posiciones.
// Ignora con advertencia: `properties`, `id` y `bbox` (nunca se usan como parcela, organización ni CRS).
// La validez técnica (autointersección, huecos fuera del exterior…) la decide PostGIS después; la
// validación GIS (P0-010) sigue pendiente.

import type { GeoJsonLimits } from '../config';

export const GEOJSON_PROFILE_VERSION = 'GEOJSON_IMPORT_V1';

export type ImportGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface ProfileWarning { code: string; message: string }

export interface ProfileResult {
  geometry: ImportGeometry;
  envelope: 'GEOMETRY' | 'FEATURE' | 'FEATURE_COLLECTION_SINGLE';
  warnings: ProfileWarning[];
  stats: { components: number; rings: number; holes: number; positions: number; max_decimal_places: number };
}

export class ProfileError extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) {
    super(message);
  }
}

const CRS84 = new Set(['urn:ogc:def:crs:OGC:1.3:CRS84', 'urn:ogc:def:crs:OGC::CRS84', 'OGC:CRS84']);
const KNOWN_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection', 'Feature', 'FeatureCollection']);

function depthOf(v: unknown, limit: number, d = 1): number {
  if (d > limit) return d;
  let max = d;
  if (Array.isArray(v)) for (const x of v) { max = Math.max(max, depthOf(x, limit, d + 1)); if (max > limit) break; }
  else if (v && typeof v === 'object') for (const x of Object.values(v)) { max = Math.max(max, depthOf(x, limit, d + 1)); if (max > limit) break; }
  return max;
}

const decimals = (n: number) => {
  const s = String(n);
  if (s.includes('e')) return 0;
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

export function parseGeoJson(bytes: Buffer, limits: GeoJsonLimits): ProfileResult {
  const warnings: ProfileWarning[] = [];
  if (bytes.length === 0) throw new ProfileError('FILE_EMPTY', 'El archivo está vacío.');
  if (bytes.length > limits.maxBytes) throw new ProfileError('FILE_TOO_LARGE', `El archivo supera el límite de ${limits.maxBytes} bytes.`);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ProfileError('INVALID_ENCODING', 'El archivo no está codificado en UTF-8.');
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    warnings.push({ code: 'BOM_IGNORED', message: 'El archivo empieza con una marca BOM; se ignoró para leerlo (el original se conserva intacto).' });
  }
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new ProfileError('MALFORMED_JSON', 'El archivo no es JSON válido. Revisa que esté completo y que sea un GeoJSON.');
  }
  if (depthOf(root, limits.maxDepth) > limits.maxDepth) throw new ProfileError('TOO_DEEP', `La estructura supera la profundidad máxima (${limits.maxDepth}).`);
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new ProfileError('NOT_GEOJSON_OBJECT', 'El archivo debe contener un objeto GeoJSON.');

  const checkCrs = (o: Record<string, unknown>, path: string) => {
    if (o.crs === undefined) return;
    const name = (o.crs as { properties?: { name?: unknown } } | null)?.properties?.name;
    if (typeof name === 'string' && CRS84.has(name)) {
      warnings.push({ code: 'LEGACY_CRS84_IGNORED', message: 'El archivo declara CRS84 con el miembro «crs» heredado; RFC 7946 ya usa WGS84 longitud/latitud, así que no cambia nada.' });
      return;
    }
    throw new ProfileError('CRS_NOT_SUPPORTED', 'El archivo declara un sistema de coordenadas distinto de WGS84 longitud/latitud (CRS84), o uno de orden de ejes ambiguo como EPSG:4326. No se reproyecta ni se intercambian ejes: exporta el archivo en WGS84 [longitud, latitud] sin miembro «crs».', `${path}.crs`);
  };
  const ignoreMembers = (o: Record<string, unknown>, path: string) => {
    if (o.properties && typeof o.properties === 'object') {
      const n = Object.keys(o.properties).length;
      if (n) warnings.push({ code: 'PROPERTIES_IGNORED', message: `Se ignoraron ${n} propiedad(es) de ${path}: la parcela y la organización salen de la pantalla, no del archivo.` });
    }
    if (o.id !== undefined) warnings.push({ code: 'ID_IGNORED', message: `Se ignoró el identificador de ${path}.` });
    if (o.bbox !== undefined) warnings.push({ code: 'BBOX_IGNORED', message: `Se ignoró el «bbox» de ${path}; la extensión se calcula de la geometría.` });
  };
  const typeName = (t: unknown) => (typeof t === 'string' && KNOWN_TYPES.has(t) ? t : 'desconocido');

  const obj = root as Record<string, unknown>;
  checkCrs(obj, 'raíz');
  let envelope: ProfileResult['envelope'] = 'GEOMETRY';
  let geom: unknown = obj;
  let gpath = 'raíz';
  if (obj.type === 'FeatureCollection') {
    const features = obj.features;
    if (!Array.isArray(features)) throw new ProfileError('INVALID_FEATURE_COLLECTION', 'La FeatureCollection no tiene una lista «features».', 'features');
    if (features.length === 0) throw new ProfileError('EMPTY_FEATURE_COLLECTION', 'La FeatureCollection no contiene ninguna feature.', 'features');
    if (features.length > 1) throw new ProfileError('MULTIPLE_FEATURES', `La FeatureCollection contiene ${features.length} features. Importa una parcela por archivo; no se importan varias parcelas a la vez.`, 'features');
    ignoreMembers(obj, 'la colección');
    warnings.push({ code: 'FEATURE_COLLECTION_SINGLE', message: 'El archivo es una FeatureCollection con una sola feature; se importa esa feature.' });
    envelope = 'FEATURE_COLLECTION_SINGLE';
    geom = features[0];
    gpath = 'features[0]';
  }
  const g0 = geom as Record<string, unknown>;
  if (g0 && typeof g0 === 'object' && g0.type === 'Feature') {
    checkCrs(g0, gpath);
    ignoreMembers(g0, 'la feature');
    if (envelope === 'GEOMETRY') envelope = 'FEATURE';
    if (g0.geometry === null || g0.geometry === undefined) throw new ProfileError('FEATURE_WITHOUT_GEOMETRY', 'La feature no tiene geometría.', `${gpath}.geometry`);
    geom = g0.geometry;
    gpath = `${gpath}.geometry`;
  } else if (envelope === 'FEATURE_COLLECTION_SINGLE') {
    throw new ProfileError('INVALID_FEATURE', 'El elemento de «features» no es una Feature.', gpath);
  }
  if (!geom || typeof geom !== 'object' || Array.isArray(geom)) throw new ProfileError('NOT_GEOJSON_OBJECT', 'No se encontró una geometría GeoJSON.', gpath);
  const g = geom as Record<string, unknown>;
  if (g !== obj) checkCrs(g, gpath);
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') {
    throw new ProfileError('TYPE_NOT_SUPPORTED', `Tipo de geometría no admitido (${typeName(g.type)}). Solo se importan Polygon y MultiPolygon.`, `${gpath}.type`);
  }
  if (g !== obj && g.bbox !== undefined) warnings.push({ code: 'BBOX_IGNORED', message: 'Se ignoró el «bbox» de la geometría; la extensión se calcula de la geometría.' });

  const stats = { components: 0, rings: 0, holes: 0, positions: 0, max_decimal_places: 0 };
  const cpath = `${gpath}.coordinates`;
  const checkRing = (ring: unknown, path: string) => {
    if (!Array.isArray(ring)) throw new ProfileError('INVALID_RING', 'Un anillo no es una lista de posiciones.', path);
    if (ring.length < 4) throw new ProfileError('RING_TOO_SHORT', 'Cada anillo necesita al menos 4 posiciones (3 vértices y el cierre).', path);
    ring.forEach((pos, i) => {
      const p = `${path}[${i}]`;
      if (!Array.isArray(pos)) throw new ProfileError('INVALID_POSITION', 'Una posición no es una lista [longitud, latitud].', p);
      if (pos.length > 2) throw new ProfileError('EXTRA_DIMENSIONS_NOT_SUPPORTED', 'El archivo incluye altitud u otras dimensiones. El perfil admite solo [longitud, latitud]; no se eliminan dimensiones automáticamente.', p);
      if (pos.length < 2) throw new ProfileError('INVALID_POSITION', 'Cada posición necesita longitud y latitud.', p);
      const [lon, lat] = pos as unknown[];
      if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) {
        throw new ProfileError('COORDINATE_NOT_NUMERIC', 'Las coordenadas deben ser números.', p);
      }
      if (lon < -180 || lon > 180) throw new ProfileError('LONGITUDE_OUT_OF_RANGE', 'Una longitud está fuera de −180…180.', p);
      if (lat < -90 || lat > 90) throw new ProfileError('LATITUDE_OUT_OF_RANGE', 'Una latitud está fuera de −90…90.', p);
      stats.max_decimal_places = Math.max(stats.max_decimal_places, decimals(lon), decimals(lat));
    });
    const [a, b] = [ring[0] as number[], ring[ring.length - 1] as number[]];
    if (a[0] !== b[0] || a[1] !== b[1]) throw new ProfileError('RING_NOT_CLOSED', 'Un anillo no está cerrado: la última posición debe ser igual a la primera. No se cierra automáticamente.', path);
    stats.positions += ring.length;
    stats.rings++;
    if (stats.positions > limits.maxPositions) throw new ProfileError('TOO_MANY_POSITIONS', `La geometría supera el máximo de ${limits.maxPositions} posiciones.`, cpath);
  };
  const checkPolygon = (rings: unknown, path: string) => {
    if (!Array.isArray(rings) || rings.length === 0) throw new ProfileError('POLYGON_WITHOUT_RINGS', 'Un polígono no tiene anillos.', path);
    if (rings.length > limits.maxRingsPerPolygon) throw new ProfileError('TOO_MANY_RINGS', `Un polígono supera el máximo de ${limits.maxRingsPerPolygon} anillos.`, path);
    rings.forEach((r, i) => checkRing(r, `${path}[${i}]`));
    stats.components++;
    stats.holes += rings.length - 1;
  };
  if (g.type === 'Polygon') checkPolygon(g.coordinates, cpath);
  else {
    if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) throw new ProfileError('MULTIPOLYGON_EMPTY', 'El MultiPolygon no tiene componentes.', cpath);
    if (g.coordinates.length > limits.maxComponents) throw new ProfileError('TOO_MANY_COMPONENTS', `El MultiPolygon supera el máximo de ${limits.maxComponents} componentes.`, cpath);
    g.coordinates.forEach((poly, i) => checkPolygon(poly, `${cpath}[${i}]`));
  }

  // Orden de ejes: solo advertencia (nunca se intercambian). Referencia: Ecuador continental y Galápagos.
  const all = (g.type === 'Polygon' ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][])).flat(2);
  const inEcuador = (lon: number, lat: number) => (lon >= -81.1 && lon <= -75.1 && lat >= -5.1 && lat <= 1.7) || (lon >= -92.1 && lon <= -89.2 && lat >= -1.5 && lat <= 0.7);
  if (!all.some(([lon, lat]) => inEcuador(lon, lat)) && all.every(([lon, lat]) => inEcuador(lat, lon))) {
    warnings.push({ code: 'POSSIBLE_AXIS_SWAP', message: 'Las coordenadas parecen estar en orden [latitud, longitud]. GeoJSON exige [longitud, latitud]; no se intercambian automáticamente. Revisa el archivo antes de confirmar.' });
  }

  return { geometry: { type: g.type, coordinates: g.coordinates } as ImportGeometry, envelope, warnings, stats };
}
