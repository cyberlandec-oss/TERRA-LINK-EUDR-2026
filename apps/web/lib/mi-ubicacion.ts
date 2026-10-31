'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// «Mi ubicación» (mejora sobre A-01/P0-007/P0-008). Obtiene la posición del dispositivo EN PRIMER PLANO y solo cuando la persona lo pide.
//   · Localizarse NO guarda nada, no mueve ninguna geometría y no añade vértices: devuelve una lectura que la pantalla muestra.
//   · La lectura conserva SU precisión y SU hora; nunca se atribuye a un polígono. No hay seguimiento (sin watchPosition) ni segundo plano.
//   · La Geolocation API puede resolver por GPS, Wi-Fi, red o IP: se presenta como «ubicación del navegador», nunca como medición GPS.
//     En un computador suele ser aproximada; por eso una precisión baja o ausente se anuncia, sin bloquear.
//   · Una lectura vieja no se usa como si acabara de medirse: pasado `FRESH_MAX_AGE_S` hay que volver a localizarse antes de usarla.

export interface MyLocation {
  latitude: number;
  longitude: number;
  /** Precisión horizontal informada por el navegador (m), o null si no la informó. Nunca inventada. */
  accuracy_m: number | null;
  /** Hora de adquisición informada por el dispositivo (ISO). */
  captured_at: string;
  /** Marca de tiempo del reloj local cuando llegó la lectura (para calcular su antigüedad). */
  received_ms: number;
}

export type LocateFailure = 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED';
export type LocateState =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'ready'; location: MyLocation }
  | { kind: 'failed'; code: LocateFailure };

/** Aviso orientativo de la interfaz (no es un criterio de validez ni regulatorio): por encima de este valor la lectura se anuncia como aproximada. */
export const APPROXIMATE_ABOVE_M = 100;
/** Una lectura más vieja que esto exige localizarse otra vez antes de usarla. */
export const FRESH_MAX_AGE_S = 60;
const TIMEOUT_MS = 20_000;

export type Quality = 'NOT_REPORTED' | 'APPROXIMATE' | 'REPORTED';

export function qualityOf(accuracy: number | null): Quality {
  if (accuracy === null) return 'NOT_REPORTED';
  return accuracy > APPROXIMATE_ABOVE_M ? 'APPROXIMATE' : 'REPORTED';
}

/** Segundos transcurridos desde que se obtuvo la lectura (nunca negativo). */
export function ageSeconds(loc: Pick<MyLocation, 'received_ms'>, now = Date.now()): number {
  return Math.max(0, Math.round((now - loc.received_ms) / 1000));
}

export const isFresh = (loc: Pick<MyLocation, 'received_ms'>, now = Date.now()): boolean => ageSeconds(loc, now) <= FRESH_MAX_AGE_S;

export const geolocationSupported = (): boolean => typeof window !== 'undefined' && 'geolocation' in navigator && window.isSecureContext;

/** Convierte la lectura del navegador sin completar nada: sin precisión válida queda null. */
export function toMyLocation(pos: { coords: { latitude: number; longitude: number; accuracy: number }; timestamp: number }, now = Date.now()): MyLocation {
  const acc = pos.coords.accuracy;
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy_m: typeof acc === 'number' && Number.isFinite(acc) && acc >= 0 ? acc : null,
    captured_at: new Date(pos.timestamp).toISOString(),
    received_ms: now,
  };
}

export function failureCode(err: { code: number; PERMISSION_DENIED?: number; TIMEOUT?: number }): LocateFailure {
  const denied = err.PERMISSION_DENIED ?? 1; const timeout = err.TIMEOUT ?? 3;
  return err.code === denied ? 'DENIED' : err.code === timeout ? 'TIMEOUT' : 'UNAVAILABLE';
}

/** Polígono aproximado (64 lados) de un círculo geográfico, para dibujar la precisión de la lectura. */
export function accuracyCircle(lon: number, lat: number, radiusM: number, steps = 64): Array<[number, number]> {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([Math.round((lon + dLon * Math.cos(a)) * 1e6) / 1e6, Math.round((lat + dLat * Math.sin(a)) * 1e6) / 1e6]);
  }
  ring.push(ring[0]);
  return ring;
}

/**
 * Estado de «Mi ubicación». `locate()` ignora una pulsación mientras hay una solicitud en curso (sin solicitudes simultáneas);
 * `clear()` descarta la lectura. Nada se guarda aquí.
 */
export function useMyLocation() {
  const [state, setState] = useState<LocateState>({ kind: 'idle' });
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const locate = useCallback(() => {
    if (busy.current) return;
    if (!geolocationSupported()) { setState({ kind: 'failed', code: 'UNSUPPORTED' }); return; }
    busy.current = true;
    setState({ kind: 'requesting' });
    navigator.geolocation.getCurrentPosition(
      (pos) => { busy.current = false; if (alive.current) setState({ kind: 'ready', location: toMyLocation(pos) }); },
      (err) => { busy.current = false; if (alive.current) setState({ kind: 'failed', code: failureCode(err) }); },
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 0 }, // maximumAge 0: nunca una posición en caché
    );
  }, []);
  const clear = useCallback(() => setState({ kind: 'idle' }), []);
  return { state, locate, clear };
}
