// D — Preparación de la cartografía del área de trabajo, CON conexión y ANTES de salir al campo.
// Lee, por rangos de bytes, solo las teselas del área desde el servicio `maps` del propio despliegue (PMTiles) y las guarda en la base
// de la cuenta. No se envía ninguna coordenada de parcela, identidad ni dato de captura: el servicio solo ve qué teselas públicas se piden
// (una zona aproximada) y nunca se contacta a otro proveedor.
import { PMTiles } from 'pmtiles';
import { MAX_PREP_ZOOM, MIN_PREP_ZOOM, tilesForArea, validLonLat, type LonLat } from './mapa';
import type { LocalStore } from './store';

export interface TileSource { label: string; getTile(z: number, x: number, y: number): Promise<Uint8Array | null> }

/** Fuente PMTiles remota (lecturas por rango). Las teselas vuelven descomprimidas (MVT). */
export function pmtilesSource(mapsUrl: string, label = 'servicio de cartografía del despliegue (OpenStreetMap)'): TileSource {
  const pm = new PMTiles(`${mapsUrl.replace(/\/+$/, '')}/tiles/ecuador.pmtiles`);
  return {
    label,
    async getTile(z, x, y) {
      const r = await pm.getZxy(z, x, y);
      return r ? new Uint8Array(r.data) : null;
    },
  };
}

export interface PrepareInput { label: string; center: LonLat; radius_km: number; min_zoom?: number; max_zoom?: number }
export interface PrepareProgress { done: number; total: number; bytes: number }
export interface PrepareResult { area_id: string; tiles_requested: number; tiles_stored: number; tiles_empty: number; bytes: number; max_zoom: number; reduced: boolean; stopped: boolean }

export async function prepareArea(store: LocalStore, source: TileSource, input: PrepareInput, opts: { onProgress?: (p: PrepareProgress) => void; shouldStop?: () => boolean; batch?: number } = {}): Promise<PrepareResult> {
  if (!validLonLat(input.center)) throw new Error('El centro del área no es una coordenada válida.');
  if (!(input.radius_km > 0 && input.radius_km <= 50)) throw new Error('El radio debe estar entre 0 y 50 km.');
  const minZ = input.min_zoom ?? MIN_PREP_ZOOM; const maxZ = input.max_zoom ?? MAX_PREP_ZOOM;
  const plan = tilesForArea(input.center, input.radius_km, minZ, maxZ);
  const batch = Math.max(1, opts.batch ?? 8);
  let done = 0; let bytes = 0; let stored = 0; let empty = 0; let stopped = false;
  for (let i = 0; i < plan.tiles.length; i += batch) {
    if (opts.shouldStop?.()) { stopped = true; break; }
    const chunk = plan.tiles.slice(i, i + batch);
    const got = await Promise.all(chunk.map(async ([z, x, y]) => ({ z, x, y, data: await source.getTile(z, x, y) })));
    const real = got.filter((g): g is { z: number; x: number; y: number; data: Uint8Array } => !!g.data && g.data.length > 0);
    empty += got.length - real.length;
    if (real.length) { await store.saveMapTiles(real); stored += real.length; bytes += real.reduce((n, g) => n + g.data.length, 0); }
    done += chunk.length;
    opts.onProgress?.({ done, total: plan.tiles.length, bytes });
  }
  // Un área interrumpida NO se registra como preparada: lo guardado queda como caché, pero el mapa no promete cobertura que no tiene.
  const area_id = stopped ? '' : await store.saveMapArea({ label: input.label, center_lat: input.center.lat, center_lon: input.center.lon, radius_km: input.radius_km, min_zoom: minZ, max_zoom: plan.max_zoom, tiles: stored, bytes, source_label: source.label });
  return { area_id, tiles_requested: plan.tiles.length, tiles_stored: stored, tiles_empty: empty, bytes, max_zoom: plan.max_zoom, reduced: plan.reduced, stopped };
}
