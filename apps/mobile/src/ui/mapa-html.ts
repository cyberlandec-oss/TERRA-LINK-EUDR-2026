import { ESTILO_BASE_JSON, MAPLIBRE_CSS, MAPLIBRE_JS, MAPLIBRE_WORKER } from './mapa-embebido.generated';

// Página del mapa que corre DENTRO del WebView. No carga nada de Internet: MapLibre, su CSS y el estilo van embebidos, y las teselas las
// entrega la app desde la base de la cuenta por el protocolo `tl://` (mensajes con la app). Solo DIBUJA: no guarda ni edita geometría,
// no ajusta puntos a elementos del mapa y no pide teselas a ningún proveedor.
//
// Mensajes hacia la app: ready | unsupported | tile {id,z,x,y} | stats {requested,empty,unprepared} | view {zoom}
// Mensajes desde la app (funciones globales): __tile(id, base64|null), __scene(json), __fit()
const PAGE_JS = `
(function () {
  var maplibregl = window.__ML;
  maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([document.getElementById('worker').textContent], { type: 'text/javascript' })));
  var RN = window.ReactNativeWebView;
  function post(o) { try { RN.postMessage(JSON.stringify(o)); } catch (e) {} }
  var pending = {}; var nextId = 1; var stats = { requested: 0, empty: 0 };
  function b64(s) { var bin = atob(s); var u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  maplibregl.addProtocol('tl', function (params) {
    var m = /^tl:\\/\\/(\\d+)\\/(\\d+)\\/(\\d+)/.exec(params.url);
    return new Promise(function (resolve) {
      var id = nextId++; pending[id] = resolve; stats.requested++;
      post({ t: 'tile', id: id, z: +m[1], x: +m[2], y: +m[3] });
    });
  });
  window.__tile = function (id, data) {
    var r = pending[id]; delete pending[id]; if (!r) return;
    if (data === null) { stats.empty++; r({ data: new ArrayBuffer(0) }); } else r({ data: b64(data) });
    clearTimeout(window.__st); window.__st = setTimeout(function () { post({ t: 'stats', requested: stats.requested, empty: stats.empty }); }, 400);
  };
  var style = JSON.parse(window.__ESTILO__);
  var map;
  try { map = new maplibregl.Map({ container: 'map', style: style, center: [-78.5, -1.4], zoom: 6, minZoom: 3, maxZoom: 19, attributionControl: { compact: true }, fadeDuration: 0,
    transformRequest: function (url) { return /^(tl:|blob:|data:)/.test(url) ? { url: url } : { url: 'blob:bloqueado' }; } });
  } catch (e) { post({ t: 'unsupported', detail: String(e && e.message || e).slice(0, 120) }); return; }
  window.__map = map;
  map.on('error', function (ev) { var m = ev && ev.error && ev.error.message || ''; console.error('maplibre: ' + m); if (/webgl/i.test(m)) post({ t: 'unsupported', detail: m.slice(0, 120) }); });
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  var markers = [];
  var empty = { type: 'FeatureCollection', features: [] };
  var last = null; var fitted = false;
  map.on('load', function () {
    map.addSource('poligono', { type: 'geojson', data: empty });
    map.addLayer({ id: 'poligono-relleno', type: 'fill', source: 'poligono', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#2b6650', 'fill-opacity': 0.22 } });
    map.addLayer({ id: 'poligono-borde', type: 'line', source: 'poligono', paint: { 'line-color': '#1f4d3b', 'line-width': 2.5 } });
    map.addSource('precision', { type: 'geojson', data: empty });
    map.addLayer({ id: 'precision-relleno', type: 'fill', source: 'precision', paint: { 'fill-color': '#285d88', 'fill-opacity': 0.14 } });
    map.addLayer({ id: 'precision-borde', type: 'line', source: 'precision', paint: { 'line-color': '#285d88', 'line-width': 1.5, 'line-dasharray': [2, 2] } });
    post({ t: 'ready' });
    if (last) draw(last);
  });
  map.on('zoomend', function () { post({ t: 'view', zoom: Math.round(map.getZoom() * 10) / 10 }); });
  function dot(cls, text, title) { var d = document.createElement('div'); d.className = 'pt ' + cls; d.textContent = text || ''; if (title) d.title = title; return d; }
  function draw(sc) {
    last = sc; if (!map.isStyleLoaded() && !map.getSource('poligono')) return;
    markers.forEach(function (m) { m.remove(); }); markers = [];
    var ring = sc.vertices.map(function (v) { return [v.longitude, v.latitude]; });
    var feats = [];
    if (ring.length >= 3) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring.concat([ring[0]])] } });
    else if (ring.length === 2) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } });
    map.getSource('poligono').setData({ type: 'FeatureCollection', features: feats });
    sc.vertices.forEach(function (v) {
      var cls = v.mocked === true ? 'mock' : (v.accuracy_m === null || v.accuracy_m > 30) ? 'weak' : 'ok';
      markers.push(new maplibregl.Marker({ element: dot('v ' + cls, String(v.seq), 'Vértice ' + v.seq) }).setLngLat([v.longitude, v.latitude]).addTo(map));
    });
    if (sc.saved_location) markers.push(new maplibregl.Marker({ element: dot('saved', '●', 'Ubicación guardada en el borrador') }).setLngLat([sc.saved_location.longitude, sc.saved_location.latitude]).addTo(map));
    var pf = [];
    if (sc.reading) {
      markers.push(new maplibregl.Marker({ element: dot(sc.reading.fresh ? 'me' : 'me old', '◎', sc.reading.fresh ? 'Mi ubicación (sin guardar)' : 'Lectura vieja (sin guardar)') }).setLngLat([sc.reading.longitude, sc.reading.latitude]).addTo(map));
      if (sc.reading.accuracy_m !== null && sc.reading.accuracy_m > 0) {
        var r = sc.reading.accuracy_m, la = sc.reading.latitude, lo = sc.reading.longitude, c = [];
        for (var i = 0; i <= 48; i++) { var t = 2 * Math.PI * i / 48; c.push([lo + (r / (111320 * Math.max(0.05, Math.cos(la * Math.PI / 180)))) * Math.cos(t), la + (r / 111320) * Math.sin(t)]); }
        pf.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [c] } });
      }
    }
    map.getSource('precision').setData({ type: 'FeatureCollection', features: pf });
    if (!fitted || sc.refit) fit(sc);
  }
  function fit(sc) {
    var pts = sc.vertices.map(function (v) { return [v.longitude, v.latitude]; });
    if (sc.saved_location) pts.push([sc.saved_location.longitude, sc.saved_location.latitude]);
    if (sc.reading) pts.push([sc.reading.longitude, sc.reading.latitude]);
    if (!pts.length) { if (sc.focus) { map.jumpTo({ center: [sc.focus.lon, sc.focus.lat], zoom: 12 }); fitted = true; } return; }
    fitted = true;
    if (pts.length === 1) { map.jumpTo({ center: pts[0], zoom: 16 }); return; }
    var b = new maplibregl.LngLatBounds(pts[0], pts[0]); pts.forEach(function (p) { b.extend(p); });
    map.fitBounds(b, { padding: 40, maxZoom: 17, duration: 0 });
  }
  window.__scene = function (json) { draw(JSON.parse(json)); };
  window.__fit = function () { if (last) fit(last); };
})();
`;

const PAGE_CSS = `
html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#eef1e6;font-family:sans-serif}
.pt{box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)}
.pt.v{width:26px;height:26px;border-radius:13px;font-size:12px}
.pt.v.ok{background:#1f4d3b}.pt.v.weak{background:#8a5a00}.pt.v.mock{background:#8a1c1c}
.pt.saved{width:18px;height:18px;border-radius:9px;background:#285d88;font-size:9px}
.pt.me{width:24px;height:24px;border-radius:12px;background:#285d88;font-size:14px}.pt.me.old{background:#6b7280}
`;

export function mapaHtml(): string {
  // El estilo se pasa como cadena JSON escapada para no mezclar comillas del documento.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>${MAPLIBRE_CSS}</style><style>${PAGE_CSS}</style></head><body><div id="map"></div><script type="text/plain" id="worker">${MAPLIBRE_WORKER}</script><script type="module">${MAPLIBRE_JS}</script><script type="module">window.__ESTILO__=${JSON.stringify(ESTILO_BASE_JSON)};${PAGE_JS}</script></body></html>`;
}
