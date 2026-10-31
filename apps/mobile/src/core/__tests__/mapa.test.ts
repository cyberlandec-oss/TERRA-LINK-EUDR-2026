import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { areaCovers, basemapState, bboxAround, circleRing, distanceM, focusOf, lonLatToTile, mapsUrlFor, reviewVertices, sceneBounds, tilesForArea, type MapArea, type MapScene } from '../mapa';
import { LocalStore } from '../store';
import { prepareArea, type TileSource } from '../teselas';
import { nodePlatform } from './node-platform';

const QUITO = { lon: -78.4678, lat: -0.1807 };
const area = (o: Partial<MapArea> = {}): MapArea => ({ id: 'a1', label: 'Zona de trabajo', center_lat: -0.85, center_lon: -80.16, radius_km: 5, min_zoom: 6, max_zoom: 14, tiles: 10, bytes: 1000, prepared_at: '2026-10-28T00:00:00Z', source_label: 'maps', ...o });

describe('D mapa: reglas puras', () => {
  it('teselas XYZ: Quito en z0 es la 0/0 y en z14 coincide con la tesela XYZ calculada a mano; la caja crece con el radio', () => {
    expect(lonLatToTile(QUITO, 0)).toEqual({ x: 0, y: 0 });
    expect(lonLatToTile(QUITO, 14)).toEqual({ x: 4620, y: 8200 });
    const a = bboxAround(QUITO, 2); const b = bboxAround(QUITO, 10);
    expect(b.east - b.west).toBeGreaterThan((a.east - a.west) * 4.9);
    expect(distanceM({ lon: QUITO.lon, lat: QUITO.lat }, { lon: QUITO.lon, lat: QUITO.lat + 0.01 })).toBeGreaterThan(1100);
  });

  it('la lista de teselas respeta el tope: si no cabe se baja el zoom máximo y se informa', () => {
    const chico = tilesForArea(QUITO, 2); expect(chico.reduced).toBe(false); expect(chico.max_zoom).toBe(14); expect(chico.tiles.length).toBeLessThan(200);
    const grande = tilesForArea(QUITO, 50, 6, 14, 500);
    expect(grande.tiles.length).toBeLessThanOrEqual(500); expect(grande.reduced).toBe(true); expect(grande.max_zoom).toBeLessThan(14);
    expect(new Set(grande.tiles.map((t) => t.join('/'))).size).toBe(grande.tiles.length); // sin repetidas
  });

  it('estado del fondo: sin cartografía, fuera del área y listo; nunca se inventa cobertura', () => {
    expect(basemapState([], null).kind).toBe('NONE_PREPARED');
    expect(basemapState([area()], { lon: -80.16, lat: -0.85 }).kind).toBe('READY');
    const fuera = basemapState([area()], QUITO);
    expect(fuera.kind).toBe('OUTSIDE_AREA'); expect(fuera.message).toMatch(/fuera de la cartografía preparada/);
    expect(areaCovers(area(), { lon: -80.16 + 0.04, lat: -0.85 })).toBe(true); // ~4,4 km
    expect(areaCovers(area(), { lon: -80.16 + 0.05, lat: -0.85 })).toBe(false); // ~5,5 km, fuera del 90 % del radio
  });

  it('la dirección del mapa sale del servidor configurado (mismo servidor, puerto propio) y rechaza lo que no es URL', () => {
    expect(mapsUrlFor('http://localhost:4000')).toBe('http://localhost:8090');
    expect(mapsUrlFor('https://api.ejemplo.org/v1')).toBe('https://api.ejemplo.org:8090');
    expect(mapsUrlFor('no es url')).toBeNull();
  });

  it('el círculo de precisión se cierra y tiene el radio informado; la escena delimita lo que hay', () => {
    const ring = circleRing({ lon: -80.16, lat: -0.85 }, 20);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(Math.round(distanceM({ lon: -80.16, lat: -0.85 }, { lon: ring[0][0], lat: ring[0][1] }))).toBe(20);
    const sc: MapScene = { vertices: [{ seq: 1, latitude: -0.85, longitude: -80.16, accuracy_m: 5, mocked: false }], saved_location: null, reading: { latitude: -0.851, longitude: -80.161, accuracy_m: 9, fresh: true } };
    expect(sceneBounds(sc)).toMatchObject({ west: -80.161, east: -80.16 });
    expect(focusOf(sc)).toEqual({ lon: -80.161, lat: -0.851 }); // la lectura actual manda
    expect(sceneBounds({ vertices: [], saved_location: null, reading: null })).toBeNull();
  });

  it('revisión de vértices: avisa de pocos vértices, precisión ausente o baja, simulados, repetidos y lejanos', () => {
    const v = (seq: number, lat: number, lon: number, acc: number | null, mocked: boolean | null = false) => ({ seq, latitude: lat, longitude: lon, accuracy_m: acc, mocked });
    expect(reviewVertices([])).toEqual([]);
    expect(reviewVertices([v(1, -0.85, -80.16, 5), v(2, -0.8503, -80.1597, 5)]).join(' ')).toMatch(/al menos 3/);
    const avisos = reviewVertices([v(1, -0.85, -80.16, null), v(2, -0.85, -80.16, 50, true), v(3, -0.8506, -80.1601, 5)]).join(' | ');
    expect(avisos).toMatch(/sin precisión informada/); expect(avisos).toMatch(/mayor a 30 m/); expect(avisos).toMatch(/simulados/); expect(avisos).toMatch(/menos de 1 m/);
    expect(reviewVertices([v(1, -0.85, -80.16, 5), v(2, -0.2, -80.16, 5), v(3, -0.21, -80.16, 5)]).join(' ')).toMatch(/km/);
    expect(reviewVertices([v(1, -0.85, -80.16, 5), v(2, -0.8503, -80.1597, 5), v(3, -0.8506, -80.1601, 5)])).toEqual([]);
  });
});

describe('D mapa: cartografía preparada en la base de la cuenta', () => {
  const fuente = (huecos: (z: number, x: number, y: number) => boolean = () => false): TileSource & { pedidas: string[] } => {
    const pedidas: string[] = [];
    return { label: 'fuente de prueba', pedidas, async getTile(z, x, y) { pedidas.push(`${z}/${x}/${y}`); return huecos(z, x, y) ? null : new Uint8Array([z, x % 255, y % 255, 7]); } };
  };

  it('prepara el área, guarda teselas y área, y todo sobrevive a cerrar y reabrir; sin teselas el mapa lo dice', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tl-mapa-')); const p = nodePlatform(root, {});
    const s = await LocalStore.open(p, 'acc1');
    expect(await s.mapAreas()).toEqual([]); expect(await s.mapTile(10, 1, 1)).toBeNull();
    const src = fuente((z) => z === 6); // el nivel 6 no tiene datos aquí
    const prog: number[] = [];
    const r = await prepareArea(s, src, { label: 'Zona de prueba', center: { lon: -80.16, lat: -0.85 }, radius_km: 2 }, { onProgress: (x) => prog.push(x.done) });
    expect(r).toMatchObject({ stopped: false, reduced: false, max_zoom: 14 });
    expect(r.tiles_stored + r.tiles_empty).toBe(r.tiles_requested); expect(r.tiles_empty).toBeGreaterThan(0);
    expect(prog[prog.length - 1]).toBe(r.tiles_requested);
    const t = tilesForArea({ lon: -80.16, lat: -0.85 }, 2).tiles.find((x) => x[0] === 12)!;
    expect(await s.mapTile(...t)).toEqual(new Uint8Array([12, t[1] % 255, t[2] % 255, 7]));
    await s.close();
    const s2 = await LocalStore.open(p, 'acc1');
    expect(await s2.mapTileCount()).toBe(r.tiles_stored);
    expect((await s2.mapAreas())[0]).toMatchObject({ label: 'Zona de prueba', radius_km: 2, tiles: r.tiles_stored, bytes: r.bytes });
    // otra cuenta no ve esta cartografía (misma separación que el resto de datos)
    const otra = await LocalStore.open(p, 'acc2'); expect(await otra.mapAreas()).toEqual([]); expect(await otra.mapTileCount()).toBe(0); await otra.close();
    await s2.clearMap(); expect(await s2.mapAreas()).toEqual([]); expect(await s2.mapTileCount()).toBe(0);
    await s2.close();
  });

  it('una preparación interrumpida o con error no se registra como área lista', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tl-mapa2-')); const p = nodePlatform(root, {});
    const s = await LocalStore.open(p, 'acc1');
    let n = 0;
    const r = await prepareArea(s, fuente(), { label: 'Interrumpida', center: { lon: -80.16, lat: -0.85 }, radius_km: 2 }, { shouldStop: () => ++n > 2, batch: 4 });
    expect(r.stopped).toBe(true); expect(r.area_id).toBe(''); expect(await s.mapAreas()).toEqual([]);
    const malo: TileSource = { label: 'cae', async getTile() { throw new Error('sin red'); } };
    await expect(prepareArea(s, malo, { label: 'Sin red', center: { lon: -80.16, lat: -0.85 }, radius_km: 2 })).rejects.toThrow('sin red');
    expect(await s.mapAreas()).toEqual([]);
    await expect(prepareArea(s, fuente(), { label: 'x', center: { lon: 500, lat: 0 }, radius_km: 2 })).rejects.toThrow(/coordenada/);
    await expect(prepareArea(s, fuente(), { label: 'x', center: QUITO, radius_km: 90 })).rejects.toThrow(/radio/);
    await s.close();
  });
});
