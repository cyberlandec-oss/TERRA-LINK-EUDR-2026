// Comprobaciones ESTRUCTURALES de una geometría GeoJSON antes de almacenarla (P0-006).
// Garantizan datos seguros y coherentes para PostGIS: tipo admitido, coordenadas numéricas en rango
// WGS84 ([longitud, latitud]), anillos cerrados con mínimo de posiciones y límites de tamaño.
// NO son la validación GIS de P0-010: autointersecciones, solapes, área mínima, umbral de 4 ha, CRS
// alternativos o cobertura quedan para esa historia (la versión se guarda como NOT_VALIDATED).

export type SupportedGeometry =
  | { type: 'Point'; coordinates: number[] }
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface StructuralIssue { path: string; reason: string }

export const MAX_POSITIONS = 5000;

function checkPosition(pos: unknown, path: string, issues: StructuralIssue[]): boolean {
  if (!Array.isArray(pos) || pos.length < 2 || pos.length > 3) {
    issues.push({ path, reason: 'POSITION_MUST_BE_[LON,LAT]' });
    return false;
  }
  const [lon, lat] = pos as unknown[];
  if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    issues.push({ path, reason: 'COORDINATE_NOT_NUMERIC' });
    return false;
  }
  if (lon < -180 || lon > 180) issues.push({ path, reason: 'LONGITUDE_OUT_OF_RANGE' });
  if (lat < -90 || lat > 90) issues.push({ path, reason: 'LATITUDE_OUT_OF_RANGE' });
  return true;
}

function checkRing(ring: unknown, path: string, issues: StructuralIssue[], count: { n: number }) {
  if (!Array.isArray(ring) || ring.length < 4) {
    issues.push({ path, reason: 'RING_NEEDS_AT_LEAST_4_POSITIONS' });
    return;
  }
  ring.forEach((p, i) => checkPosition(p, `${path}[${i}]`, issues));
  count.n += ring.length;
  const first = ring[0] as number[];
  const last = ring[ring.length - 1] as number[];
  if (Array.isArray(first) && Array.isArray(last) && (first[0] !== last[0] || first[1] !== last[1])) {
    issues.push({ path, reason: 'RING_NOT_CLOSED' });
  }
}

function checkPolygon(rings: unknown, path: string, issues: StructuralIssue[], count: { n: number }) {
  if (!Array.isArray(rings) || rings.length === 0) {
    issues.push({ path, reason: 'POLYGON_WITHOUT_RINGS' });
    return;
  }
  rings.forEach((r, i) => checkRing(r, `${path}[${i}]`, issues, count));
}

/** Devuelve la lista de problemas estructurales; vacía si la geometría puede almacenarse. */
export function structuralIssues(input: unknown): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  if (!input || typeof input !== 'object') return [{ path: 'geometry', reason: 'GEOMETRY_MUST_BE_OBJECT' }];
  const g = input as { type?: unknown; coordinates?: unknown; crs?: unknown };
  if (g.crs !== undefined) issues.push({ path: 'geometry.crs', reason: 'CRS_MEMBER_NOT_ALLOWED_WGS84_ONLY' });
  const count = { n: 0 };
  switch (g.type) {
    case 'Point':
      checkPosition(g.coordinates, 'geometry.coordinates', issues);
      break;
    case 'Polygon':
      checkPolygon(g.coordinates, 'geometry.coordinates', issues, count);
      break;
    case 'MultiPolygon':
      if (!Array.isArray(g.coordinates) || g.coordinates.length === 0) issues.push({ path: 'geometry.coordinates', reason: 'MULTIPOLYGON_EMPTY' });
      else g.coordinates.forEach((poly, i) => checkPolygon(poly, `geometry.coordinates[${i}]`, issues, count));
      break;
    default:
      issues.push({ path: 'geometry.type', reason: 'TYPE_MUST_BE_POINT_POLYGON_OR_MULTIPOLYGON' });
  }
  if (count.n > MAX_POSITIONS) issues.push({ path: 'geometry.coordinates', reason: `MORE_THAN_${MAX_POSITIONS}_POSITIONS` });
  return issues;
}

export const geometryTypeCode = (g: SupportedGeometry) =>
  g.type === 'Point' ? 'POINT' : g.type === 'Polygon' ? 'POLYGON' : 'MULTIPOLYGON';

/** Motivo de PostGIS sin la coordenada que lo acompaña (eventos, auditoría, notas y errores no llevan coordenadas). */
export const reasonWithoutCoordinates = (r: string | null) => (r ? r.replace(/\s*\[[^\]]*\]\s*$/, '').trim() : null);
