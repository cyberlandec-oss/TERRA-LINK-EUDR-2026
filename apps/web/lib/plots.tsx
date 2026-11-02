'use client';

import { useI18n } from './i18n';

// Tipos y presentación compartida de parcelas (UI-06, docs/UX_UI.md §13).

export interface PlotVersion {
  id: string;
  version_number: number;
  geometry_type: 'POINT' | 'POLYGON' | 'MULTIPOLYGON' | null;
  geometry: { type: string; coordinates: unknown } | null;
  geometry_hash: string | null;
  area_declared_ha: string | null;
  area_calculated_ha: string | null;
  survey_method: string;
  surveyed_at: string | null;
  validation_status: string;
  validation_rule_version: string;
  previous_version_id: string | null;
  /** DECLARED_AREA_UPDATE: copia la geometría de la versión capturada (no es una captura nueva). */
  change_kind?: 'GEOMETRY_CAPTURE' | 'DECLARED_AREA' | 'DECLARED_AREA_UPDATE';
  geometry_origin_version_number?: number | null;
  notes: string | null;
  created_at: string;
  is_current?: boolean;
  geometry_visible?: boolean;
  technically_valid?: boolean | null;
  source_import_id?: string | null;
  source_import_sha256?: string | null;
  sample?: null | { id: string; source: string; captured_at: string; received_at: string; horizontal_accuracy_m: number | null; longitude?: number; latitude?: number };
}

export interface Plot {
  id: string;
  plot_code: string;
  name: string | null;
  crop: string;
  variety: string | null;
  land_use: string | null;
  province: string | null;
  canton: string | null;
  parish: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  producer: { id: string; producer_code?: string; display_name: string };
  row_version: number;
  deletion_reason: string | null;
  geometry_status: 'NONE' | 'DECLARED_AREA_ONLY' | 'GEOMETRY_RECORDED';
  current_version: PlotVersion | null;
  geometry_type?: string | null;
  area_declared_ha?: string | null;
  area_calculated_ha?: string | null;
  can_update?: boolean;
  can_archive?: boolean;
  can_capture_location?: boolean;
  can_evaluate_gis?: boolean;
  geometry_access?: boolean;
}

export const GEOMETRY_STATUS: Record<Plot['geometry_status'], { label: string; tone: 'review' | 'process' | 'neutral' }> = {
  NONE: { label: 'Geometría pendiente', tone: 'review' },
  DECLARED_AREA_ONLY: { label: 'Solo superficie declarada', tone: 'review' },
  GEOMETRY_RECORDED: { label: 'Ubicación registrada (sin validar)', tone: 'process' },
};

export const METHOD_LABEL: Record<string, string> = {
  DECLARED: 'Superficie declarada',
  MANUAL_COORDINATES: 'Coordenadas ingresadas',
  BROWSER_GEOLOCATION: 'Ubicación del navegador',
  DEVICE_LOCATION_SERVICE: 'Servicio de ubicación del dispositivo móvil (no se afirma GPS)',
  MIXED_ACQUISITION: 'Vértices de orígenes distintos (navegador y dispositivo móvil)',
  GPS_POINT: 'Punto GPS',
  GPS_POLYGON: 'Polígono GPS',
  FILE_IMPORT: 'Importación de archivo',
};

export const GEOMETRY_TYPE_LABEL: Record<string, string> = { POINT: 'Punto', POLYGON: 'Polígono', MULTIPOLYGON: 'Multipolígono' };

/** Hectáreas con los separadores del idioma. Sin idioma explícito usa el español (fuente). */
export const ha = (v: string | null | undefined, region = 'es-EC') =>
  v == null ? null : `${Number(v).toLocaleString(region, { maximumFractionDigits: 4 })} ha`;

/** Posiciones [lon, lat] de una geometría GeoJSON (para la tabla y el esquema). */
export function positions(g: PlotVersion['geometry']): Array<{ ring: number; lon: number; lat: number }> {
  if (!g) return [];
  if (g.type === 'Point') {
    const [lon, lat] = g.coordinates as number[];
    return [{ ring: 1, lon, lat }];
  }
  const polys = g.type === 'Polygon' ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][]);
  const out: Array<{ ring: number; lon: number; lat: number }> = [];
  let ring = 0;
  for (const poly of polys) for (const r of poly) { ring++; for (const [lon, lat] of r) out.push({ ring, lon, lat }); }
  return out;
}

/**
 * Vista esquemática de la geometría SIN mapa base ni proveedor externo. Proyección lineal local:
 * orienta la forma, no sirve para medir. Siempre acompañada de la tabla de coordenadas.
 */
export function GeometrySketch({ geometry, label }: { geometry: PlotVersion['geometry']; label: string }) {
  const { t } = useI18n();
  const pts = positions(geometry);
  if (!geometry || pts.length === 0) return null;
  const size = 220;
  const pad = 16;
  const lons = pts.map((p) => p.lon);
  const lats = pts.map((p) => p.lat);
  const [minX, maxX, minY, maxY] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const px = (lon: number) => pad + ((lon - minX) / span) * (size - 2 * pad);
  const py = (lat: number) => size - pad - ((lat - minY) / span) * (size - 2 * pad);
  const rings = new Map<number, string[]>();
  for (const p of pts) rings.set(p.ring, [...(rings.get(p.ring) ?? []), `${px(p.lon).toFixed(1)},${py(p.lat).toFixed(1)}`]);
  return (
    <figure className="sketch">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <rect x="0" y="0" width={size} height={size} fill="var(--tl-surface-subtle)" />
        {geometry.type === 'Point'
          ? <circle cx={px(pts[0].lon)} cy={py(pts[0].lat)} r="7" fill="var(--tl-forest)" stroke="#fff" strokeWidth="2" />
          : [...rings.values()].map((r, i) => <polygon key={i} points={r.join(' ')} fill="rgba(43,102,80,0.18)" stroke="var(--tl-forest)" strokeWidth="2" />)}
      </svg>
      <figcaption className="muted">{t('Vista esquemática sin mapa base: orienta la forma, no sirve para medir.')}</figcaption>
    </figure>
  );
}
