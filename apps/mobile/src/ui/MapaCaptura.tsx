import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { bytesToBase64 } from '../core/base64';
import type { LonLat, MapScene } from '../core/mapa';
import { Notice, s } from './kit';
import { mapaHtml } from './mapa-html';

// Mapa de la captura (Android). Solo DIBUJA lo que la captura ya tiene: vértices, ubicación guardada y la lectura de «Mi ubicación» con su
// precisión. No guarda geometría, no ajusta puntos al mapa y no toca la red: las teselas salen de la base de la cuenta (cartografía preparada).
export interface MapRuntime { status: 'loading' | 'ready' | 'unsupported'; requested: number; empty: number; zoom: number | null }
export const MAP_RUNTIME_INITIAL: MapRuntime = { status: 'loading', requested: 0, empty: 0, zoom: null };

// Origen propio y no resoluble: el worker del mapa se crea desde un blob, que exige un origen real (con about:blank el navegador lo rechaza). No hay red hacia él.
const MAP_ORIGIN = 'https://terra-link.invalid/';
const HTML = mapaHtml();

export function MapaCaptura({ scene, focus, readTile, onRuntime, refitKey }: { scene: MapScene; focus: LonLat | null; readTile: (z: number, x: number, y: number) => Promise<Uint8Array | null>; onRuntime: (r: MapRuntime) => void; refitKey: number }) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const rt = useRef<MapRuntime>(MAP_RUNTIME_INITIAL);
  const publish = useCallback((p: Partial<MapRuntime>) => { rt.current = { ...rt.current, ...p }; onRuntime(rt.current); }, [onRuntime]);
  const run = useCallback((js: string) => ref.current?.injectJavaScript(`${js};true;`), []);

  useEffect(() => {
    if (!ready) return;
    run(`window.__scene(${JSON.stringify(JSON.stringify({ ...scene, focus, refit: refitKey > 0 }))})`);
  }, [ready, scene, focus, refitKey, run]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let m: { t: string; id?: number; z?: number; x?: number; y?: number; requested?: number; empty?: number; zoom?: number };
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.t === 'ready') { setReady(true); publish({ status: 'ready' }); }
    else if (m.t === 'unsupported') publish({ status: 'unsupported' });
    else if (m.t === 'stats') publish({ requested: m.requested ?? 0, empty: m.empty ?? 0 });
    else if (m.t === 'view') publish({ zoom: m.zoom ?? null });
    else if (m.t === 'tile' && typeof m.id === 'number') {
      const id = m.id;
      void readTile(m.z!, m.x!, m.y!).then((b) => run(`window.__tile(${id}, ${b ? JSON.stringify(bytesToBase64(b)) : 'null'})`)).catch(() => run(`window.__tile(${id}, null)`));
    }
  }, [publish, readTile, run]);

  return (
    <View style={{ height: 320, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#c9c3b0' }} accessibilityLabel="Mapa de la captura">
      <WebView
        ref={ref}
        source={{ html: HTML, baseUrl: MAP_ORIGIN }}
        originWhitelist={['about:*', 'data:*', 'https://terra-link.invalid*']}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowsInlineMediaPlayback={false}
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(r) => r.url === 'about:blank' || r.url.startsWith('data:') || r.url === MAP_ORIGIN}
        onMessage={onMessage}
        onError={() => publish({ status: 'unsupported' })}
        onRenderProcessGone={() => { setReady(false); publish({ status: 'loading' }); ref.current?.reload(); }}
      />
      {rt.current.status === 'unsupported' && <View style={{ position: 'absolute', inset: 0, padding: 12, backgroundColor: '#f5f2e9' }}><Notice tone="review" title="No se pudo mostrar el mapa">Este dispositivo no pudo iniciar el mapa (WebGL no disponible). La tabla de coordenadas y precisión sigue funcionando y puedes capturar igual.</Notice></View>}
    </View>
  );
}
