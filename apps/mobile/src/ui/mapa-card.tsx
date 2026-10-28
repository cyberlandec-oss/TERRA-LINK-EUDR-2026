import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { isStorageFull, storageFullMessage } from '../core/ports';
import { DEFAULT_RADIUS_KM, RADIUS_OPTIONS_KM, basemapState, focusOf, reviewVertices, type MapArea, type MapScene } from '../core/mapa';
import type { DraftView, LocalStore } from '../core/store';
import { pmtilesSource, prepareArea } from '../core/teselas';
import type { Reading } from '../core/ubicacion';
import { isFresh } from '../core/ubicacion';
import { Badge, Button, Card, Notice, s } from './kit';
import { MAP_RUNTIME_INITIAL, MapaCaptura, type MapRuntime } from './MapaCaptura';

// Tarjeta «Mapa» de la captura. Muestra los vértices (con su procedencia y precisión), la ubicación guardada y la lectura actual de «Mi ubicación»
// sin guardarla; prepara la cartografía de la zona con conexión y dice con claridad cuándo falta. Las acciones que cambian la captura siguen
// siendo las explícitas de las tarjetas «Ubicación» y «Polígono»: nada se guarda por localizarse ni por mirar el mapa.
const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;

export function MapaCard({ store, draft, peek, now, mapsUrl, editable }: { store: LocalStore; draft: DraftView; peek: Reading | null; now: number; mapsUrl: string | null; editable: boolean }) {
  const [areas, setAreas] = useState<MapArea[]>([]);
  const [runtime, setRuntime] = useState<MapRuntime>(MAP_RUNTIME_INITIAL);
  const [refit, setRefit] = useState(0);
  const [radius, setRadius] = useState<number>(DEFAULT_RADIUS_KM);
  const [prep, setPrep] = useState<{ done: number; total: number; bytes: number } | null>(null);
  const stopRef = useRef(false);
  const [msg, setMsg] = useState<{ tone: 'valid' | 'review' | 'blocked'; text: string } | null>(null);
  const loadAreas = useCallback(async () => setAreas(await store.mapAreas()), [store]);
  useEffect(() => { void loadAreas(); }, [loadAreas]);

  const scene: MapScene = useMemo(() => ({
    vertices: draft.vertices.map((v) => ({ seq: v.seq, latitude: v.latitude, longitude: v.longitude, accuracy_m: v.accuracy_m, mocked: v.mocked })),
    saved_location: draft.location ? { latitude: draft.location.latitude, longitude: draft.location.longitude, accuracy_m: draft.location.accuracy_m } : null,
    reading: peek ? { latitude: peek.latitude, longitude: peek.longitude, accuracy_m: peek.accuracy_m, fresh: isFresh(peek, now) } : null,
  }), [draft.vertices, draft.location, peek, now]);
  const focus = focusOf(scene);
  const base = basemapState(areas, focus);
  const avisos = reviewVertices(scene.vertices);
  const readTile = useCallback((z: number, x: number, y: number) => store.mapTile(z, x, y), [store]);

  const prepare = async () => {
    if (!focus || !mapsUrl) return;
    stopRef.current = false; setMsg(null); setPrep({ done: 0, total: 0, bytes: 0 });
    try {
      const label = `Zona ${focus.lat.toFixed(3)}, ${focus.lon.toFixed(3)}`;
      const r = await prepareArea(store, pmtilesSource(mapsUrl), { label, center: focus, radius_km: radius }, { onProgress: setPrep, shouldStop: () => stopRef.current });
      setMsg(r.stopped ? { tone: 'review', text: 'Preparación interrumpida: lo descargado queda guardado, pero la zona no se marca como preparada.' }
        : r.tiles_stored === 0 ? { tone: 'review', text: 'El servicio de cartografía no devolvió teselas para esta zona (¿no está preparada en el servidor?). No se marcó nada como preparado con detalle.' }
          : { tone: 'valid', text: `Cartografía preparada: ${r.tiles_stored} teselas (${mb(r.bytes)}) hasta el nivel ${r.max_zoom}${r.reduced ? ' (se redujo el detalle para no superar el límite)' : ''}.` });
      await loadAreas();
    } catch (e) {
      setMsg({ tone: 'blocked', text: isStorageFull(e) ? storageFullMessage(e) : 'No se pudo descargar la cartografía. Comprueba la conexión con el servidor y vuelve a intentarlo; tus capturas no se tocaron.' });
    } finally { setPrep(null); }
  };

  const clear = async () => { await store.clearMap(); setMsg({ tone: 'review', text: 'Cartografía eliminada de este dispositivo. Tus capturas, colas y fotos no se tocaron.' }); await loadAreas(); };

  return (
    <Card title="Mapa">
      <MapaCaptura scene={scene} focus={focus} readTile={readTile} onRuntime={setRuntime} refitKey={refit} />
      <Badge tone={base.kind === 'READY' ? 'valid' : 'review'}>{base.kind === 'READY' ? 'Cartografía preparada' : base.kind === 'OUTSIDE_AREA' ? 'Fuera de la zona preparada' : 'Sin cartografía preparada'}</Badge>
      <Text style={s.muted}>{base.message}</Text>
      {runtime.status === 'ready' && base.kind === 'READY' && runtime.requested > 0 && runtime.empty > 0 && <Text style={s.muted}>{runtime.empty} de {runtime.requested} teselas de esta vista no tienen datos en la zona preparada (mar, vacío o sin cobertura).</Text>}
      <Text style={s.muted}>Verde: vértice con precisión informada · ámbar: sin precisión o mayor a 30 m · rojo: marcado como simulado por el sistema · azul: «Mi ubicación» (sin guardar) y su círculo de precisión · gris: lectura vieja.</Text>
      <Text style={s.muted}>Referencia visual (OpenStreetMap): no acredita límites de propiedad, precisión GPS ni conformidad. Los puntos no se ajustan a elementos del mapa.</Text>
      {avisos.map((a) => <Text key={a} style={s.muted}>⚠ {a}</Text>)}
      <Button kind="secondary" label="Centrar en lo capturado" onPress={() => setRefit(refit + 1)} />

      <Text accessibilityRole="header" style={s.p}>Cartografía del área de trabajo</Text>
      {areas.map((a) => <Text key={a.id} style={s.muted}>{a.label} · radio {a.radius_km} km · {a.tiles} teselas ({mb(a.bytes)}) · hasta nivel {a.max_zoom} · preparada {a.prepared_at.slice(0, 16).replace('T', ' ')}</Text>)}
      {editable && (
        <>
          <Text style={s.muted}>Se descarga con conexión desde el servicio de cartografía de tu propio servidor, centrada en {focus ? 'tu último punto o lectura' : 'un punto (usa «Mi ubicación» o captura uno primero)'}. No se envía ninguna parcela ni dato de captura.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {RADIUS_OPTIONS_KM.map((r) => <Button key={r} kind={radius === r ? 'primary' : 'secondary'} label={`${r} km`} onPress={() => setRadius(r)} disabled={!!prep} />)}
          </View>
          {!mapsUrl && <Notice tone="review">No se conoce la dirección del servidor de cartografía en esta sesión.</Notice>}
          {prep ? (
            <>
              <Text style={s.p} accessibilityLiveRegion="polite">Descargando {prep.done}/{prep.total || '…'} teselas · {mb(prep.bytes)}</Text>
              <Button kind="secondary" label="Detener" onPress={() => { stopRef.current = true; }} />
            </>
          ) : <Button kind="secondary" label={`Preparar cartografía de esta zona (${radius} km)`} disabled={!focus || !mapsUrl} onPress={() => void prepare()} />}
          {areas.length > 0 && !prep && <Button kind="secondary" label="Eliminar la cartografía de este dispositivo" onPress={() => void clear()} />}
        </>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </Card>
  );
}
