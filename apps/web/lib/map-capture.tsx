'use client';

import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from './i18n';
import { Alert } from './ui';

// A-01 — Dibujar la parcela SOBRE UN MAPA, con cartografía 100 % LOCAL.
//
//   · Teselas vectoriales (PMTiles), estilo y tipografías salen del servicio local `maps` (infra/maps). No hay teselas,
//     geocodificación, CDN ni estilos de terceros; cualquier URL que no sea del servicio local se bloquea (`transformRequest`),
//     no se reemplaza por otra fuente. Nada de la parcela, de las coordenadas ni de las personas sale del equipo hacia el mapa.
//   · La cartografía es una REFERENCIA VISUAL de OpenStreetMap: no acredita límites de propiedad, precisión GPS, deforestación
//     ni conformidad, y NO se ajusta ningún vértice a elementos del mapa (lo que se marca es lo que se guarda).
//   · Si faltan los datos (servicio apagado, archivo sin preparar, navegador sin WebGL) se dice, y la entrada por tabla de
//     coordenadas y el croquis sin mapa base siguen disponibles.
//   · Teclado: el mapa es enfocable (flechas desplazan, + y − acercan); «Fijar vértice en la mira» y Enter colocan un vértice en el
//     centro; cada vértice además se corrige en la tabla de coordenadas. La revisión del servidor y la confirmación son las de siempre.

export const MAPS_URL = (process.env.NEXT_PUBLIC_MAPS_URL ?? 'http://localhost:8090').replace(/\/$/, '');

interface LonLat { lon: number; lat: number }
interface MapMeta { fecha_extracto?: string; fuente?: string; cobertura?: string; limites?: string }
type State = { kind: 'loading' } | { kind: 'ready'; meta: MapMeta } | { kind: 'unavailable'; reason: 'SERVICE' | 'DATA' | 'WEBGL' };

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const ECUADOR: LonLat = { lon: -78.5, lat: -1.5 };

/** Metros por píxel de pantalla en el centro (teselas de 512 px). */
export const metersPerPixel = (zoom: number, lat: number) => (78271.51696 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

export function MapCapture({ mode, vertices, initialCenter, onChange }: {
  mode: 'POINT' | 'POLYGON'; vertices: LonLat[]; initialCenter: LonLat | null; onChange: (vs: LonLat[]) => void;
}) {
  const { t, num } = useI18n();
  const uid = useId();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const live = useRef({ mode, vertices, onChange });
  live.current = { mode, vertices, onChange };
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [view, setView] = useState({ lon: (initialCenter ?? ECUADOR).lon, lat: (initialCenter ?? ECUADOR).lat, zoom: initialCenter ? 15 : 6 });
  const [goto, setGoto] = useState({ lon: '', lat: '' });
  const [pointer, setPointer] = useState<LonLat | null>(null);

  // ------------------------------------------------------------------ arranque: estilo + datos locales
  useEffect(() => {
    let cancelled = false;
    maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs'); // servido por esta misma web (scripts/copiar-maplibre.mjs); sin CDN
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    (async () => {
      let style: maplibregl.StyleSpecification; let meta: MapMeta = {};
      try {
        const res = await fetch(`${MAPS_URL}/estilo.json`);
        if (!res.ok) throw new Error('estilo');
        style = JSON.parse((await res.text()).split('__MAPS__').join(MAPS_URL));
      } catch { if (!cancelled) setState({ kind: 'unavailable', reason: 'SERVICE' }); return; }
      try {
        const head = await fetch(`${MAPS_URL}/tiles/ecuador.pmtiles`, { headers: { Range: 'bytes=0-0' } });
        if (!(head.status === 200 || head.status === 206)) throw new Error('teselas');
        meta = await fetch(`${MAPS_URL}/metadata.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      } catch { if (!cancelled) setState({ kind: 'unavailable', reason: 'DATA' }); return; }
      if (cancelled || !box.current) return;
      let map: maplibregl.Map;
      try {
        map = new maplibregl.Map({
          container: box.current, style, center: [view.lon, view.lat], zoom: view.zoom, minZoom: 4, maxZoom: 19, attributionControl: { compact: true },
          // Sin respaldo silencioso: lo que no sea del servicio local se bloquea en vez de pedirse a otro sitio.
          transformRequest: (url) => (url.startsWith(MAPS_URL) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('pmtiles://')
            ? { url } : { url: `${MAPS_URL}/bloqueado` }),
        });
      } catch { if (!cancelled) setState({ kind: 'unavailable', reason: 'WEBGL' }); return; }
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      map.on('load', () => {
        map.addSource('captura', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'captura-relleno', type: 'fill', source: 'captura', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#2b6650', 'fill-opacity': 0.22 } });
        map.addLayer({ id: 'captura-borde', type: 'line', source: 'captura', paint: { 'line-color': '#1f4d3b', 'line-width': 2.5 } });
        draw();
        if (!cancelled) setState({ kind: 'ready', meta });
      });
      map.on('error', (e) => {
        const status = (e as { error?: { status?: number } }).error?.status;
        if (status === 404 && !cancelled) setState((s) => (s.kind === 'ready' || s.kind === 'loading' ? { kind: 'unavailable', reason: 'DATA' } : s));
      });
      map.on('moveend', () => { const c = map.getCenter(); setView({ lon: r6(c.lng), lat: r6(c.lat), zoom: Math.round(map.getZoom() * 10) / 10 }); });
      map.on('mousemove', (e) => setPointer({ lon: r6(e.lngLat.lng), lat: r6(e.lngLat.lat) }));
      map.on('mouseout', () => setPointer(null));
      map.on('click', (e) => place({ lon: r6(e.lngLat.lng), lat: r6(e.lngLat.lat) }));
    })();
    return () => {
      cancelled = true;
      markers.current.forEach((m) => m.remove()); markers.current = [];
      mapRef.current?.remove(); mapRef.current = null;
      maplibregl.removeProtocol('pmtiles');
    };
  }, []);

  function place(p: LonLat) {
    const { mode: m, vertices: vs, onChange: cb } = live.current;
    cb(m === 'POINT' ? [p] : [...vs, p]);
  }

  // ------------------------------------------------------------------ dibujo: marcadores arrastrables + polígono
  function draw() {
    const map = mapRef.current; if (!map) return;
    const { vertices: vs, mode: m, onChange: cb } = live.current;
    markers.current.forEach((x) => x.remove()); markers.current = [];
    vs.forEach((v, i) => {
      const el = document.createElement('div');
      el.className = 'map-vertex'; el.textContent = String(i + 1); el.setAttribute('role', 'img');
      el.setAttribute('aria-label', `${t('vértice {n}', { n: i + 1 })}: ${t('Longitud')} ${v.lon}, ${t('Latitud')} ${v.lat}`);
      const mk = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([v.lon, v.lat]).addTo(map);
      mk.on('dragend', () => { const ll = mk.getLngLat(); const cur = live.current.vertices.slice(); cur[i] = { lon: r6(ll.lng), lat: r6(ll.lat) }; cb(cur); });
      markers.current.push(mk);
    });
    const src = map.getSource('captura') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const coords = vs.map((v) => [v.lon, v.lat]);
    const features: GeoJSON.Feature[] = [];
    if (m === 'POLYGON' && coords.length >= 3) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] } });
    else if (coords.length >= 2) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
    src.setData({ type: 'FeatureCollection', features });
  }
  useEffect(() => { draw(); }, [vertices, mode, state.kind]);

  function fixAtCenter() { const c = mapRef.current?.getCenter(); if (c) place({ lon: r6(c.lng), lat: r6(c.lat) }); }
  function go() {
    const lon = Number(goto.lon.trim().replace(',', '.')); const lat = Number(goto.lat.trim().replace(',', '.'));
    if (!goto.lon.trim() || !goto.lat.trim() || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return;
    mapRef.current?.flyTo({ center: [lon, lat], zoom: 16 });
  }

  if (state.kind === 'unavailable') {
    return (
      <Alert tone="review" title={t('La cartografía local no está disponible.')}>
        <p>{state.reason === 'WEBGL' ? t('Este navegador no puede dibujar el mapa (falta WebGL).')
          : state.reason === 'DATA' ? t('El servicio de mapas responde, pero faltan los datos cartográficos de Ecuador (aún no se han preparado).')
            : t('No se pudo contactar el servicio de mapas local.')}</p>
        <p>{t('No se usa ningún mapa externo como reemplazo. Puedes escribir las coordenadas en la tabla o usar el croquis sin mapa base.')}</p>
      </Alert>
    );
  }
  const mpp = metersPerPixel(view.zoom, view.lat);
  return (
    <div className="map-capture">
      <p className="field-help">
        {t('Mapa de referencia (OpenStreetMap, servido desde este mismo despliegue). Desplaza y acerca; haz clic para fijar un vértice, o centra la mira y pulsa «Fijar vértice en la mira». Con el mapa enfocado: flechas desplazan, + y − acercan, Enter fija un vértice en la mira. Puedes arrastrar un vértice para corregirlo.')}
      </p>
      <div className="map-frame">
        <div ref={box} className="map-box" tabIndex={0} role="application"
          aria-label={t('Mapa para dibujar la parcela. Centro: longitud {lon}, latitud {lat}. Zoom {z}.', { lon: num(view.lon, 5), lat: num(view.lat, 5), z: num(view.zoom, 1) })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); fixAtCenter(); } }} />
        {state.kind === 'ready' && <div className="map-crosshair" aria-hidden="true" />}
        {state.kind === 'loading' && <p className="map-loading muted" role="status">{t('Cargando el mapa local…')}</p>}
      </div>
      <p className="muted" role="status" id={`${uid}-pos`}>
        {t('Centro de la mira')}: {t('longitud')} {view.lon}, {t('latitud')} {view.lat} · {t('Zoom')} {num(view.zoom, 1)} · {t('unos {m} m por píxel', { m: num(mpp, mpp < 10 ? 1 : 0) })}
        {pointer && <> · {t('Puntero')}: {pointer.lon}, {pointer.lat}</>}
      </p>
      <div className="actions" role="group" aria-label={t('Acciones del mapa')}>
        <button type="button" onClick={fixAtCenter} disabled={state.kind !== 'ready'}>{t('Fijar vértice en la mira')}</button>
        <button type="button" className="secondary inline" onClick={() => onChange(vertices.slice(0, -1))} disabled={vertices.length === 0}>{t('Deshacer último')}</button>
        <button type="button" className="secondary inline" onClick={() => onChange([])} disabled={vertices.length === 0}>{t('Borrar todo')}</button>
      </div>
      <div className="grid-3">
        <div><label htmlFor={`${uid}-glon`}>{t('Ir a longitud')}</label><input id={`${uid}-glon`} inputMode="decimal" value={goto.lon} onChange={(e) => setGoto({ ...goto, lon: e.target.value })} placeholder="-80.16" /></div>
        <div><label htmlFor={`${uid}-glat`}>{t('Ir a latitud')}</label><input id={`${uid}-glat`} inputMode="decimal" value={goto.lat} onChange={(e) => setGoto({ ...goto, lat: e.target.value })} placeholder="-0.85" /></div>
        <div><button type="button" className="secondary" onClick={go}>{t('Centrar el mapa aquí')}</button></div>
      </div>
      {state.kind === 'ready' && (
        <p className="muted">
          {t('Fuente cartográfica')}: OpenStreetMap{state.meta.fecha_extracto ? ` (${t('extracto del')} ${state.meta.fecha_extracto})` : ''}. {t('Es una referencia visual: no acredita límites de propiedad, precisión GPS, deforestación ni conformidad, y los vértices NO se ajustan a elementos del mapa.')}
        </p>
      )}
    </div>
  );
}
