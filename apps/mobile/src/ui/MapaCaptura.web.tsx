import { useEffect } from 'react';
import type { LonLat, MapScene } from '../core/mapa';
import { Notice } from './kit';

// Vista previa web: el mapa usa WebView y WebGL del dispositivo, así que solo se comprueba en Android. Aquí se declara, no se simula.
export interface MapRuntime { status: 'loading' | 'ready' | 'unsupported'; requested: number; empty: number; zoom: number | null }
export const MAP_RUNTIME_INITIAL: MapRuntime = { status: 'loading', requested: 0, empty: 0, zoom: null };

export function MapaCaptura({ onRuntime }: { scene: MapScene; focus: LonLat | null; readTile: (z: number, x: number, y: number) => Promise<Uint8Array | null>; onRuntime: (r: MapRuntime) => void; refitKey: number }) {
  useEffect(() => { onRuntime({ status: 'unsupported', requested: 0, empty: 0, zoom: null }); }, [onRuntime]);
  return <Notice tone="review" title="El mapa se comprueba en Android">La vista previa web no incluye el mapa (usa el WebView del dispositivo). Lo que ves abajo —coordenadas, precisión y vértices— es la misma información que el mapa dibuja.</Notice>;
}
