// «Mi ubicación» en la app de campo. Reglas PURAS (sin Expo) para poder probarlas en Node.
//   · Localizarse NO guarda nada: devuelve una lectura que la pantalla muestra; el borrador solo cambia con la acción explícita «Usar esta ubicación».
//   · La lectura conserva SU precisión y SU hora; nunca se inventa una precisión ni se presenta como GPS (el sistema elige el proveedor).
//   · Una lectura vieja no se usa como si acabara de medirse. Primer plano y a petición de la persona: sin seguimiento ni segundo plano.
//   · La app NO incluye mapa: la ubicación se ofrece como coordenadas y precisión. La disponibilidad de ubicación y la de cartografía son cosas distintas.

export interface Reading {
  latitude: number;
  longitude: number;
  /** Precisión horizontal informada (m) o null si el dispositivo no la informó. */
  accuracy_m: number | null;
  /** Hora de adquisición informada por el dispositivo (ISO). */
  acquired_at: string;
  /** El sistema la marcó como simulada (true/false) o no lo informó (null). */
  mocked: boolean | null;
  provider_detail: string;
  /** Reloj local cuando llegó la lectura (para calcular su antigüedad). */
  received_ms: number;
}

/** Aviso orientativo de la interfaz (no es un criterio de validez ni regulatorio). */
export const APPROXIMATE_ABOVE_M = 100;
export const FRESH_MAX_AGE_S = 60;

export type Quality = 'NOT_REPORTED' | 'APPROXIMATE' | 'REPORTED';

export const qualityOf = (accuracy: number | null): Quality => (accuracy === null ? 'NOT_REPORTED' : accuracy > APPROXIMATE_ABOVE_M ? 'APPROXIMATE' : 'REPORTED');

export const ageSeconds = (r: Pick<Reading, 'received_ms'>, now = Date.now()): number => Math.max(0, Math.round((now - r.received_ms) / 1000));
export const isFresh = (r: Pick<Reading, 'received_ms'>, now = Date.now()): boolean => ageSeconds(r, now) <= FRESH_MAX_AGE_S;

export function qualityNotice(q: Quality): string | null {
  if (q === 'APPROXIMATE') return `Ubicación aproximada: la precisión informada supera ${APPROXIMATE_ABOVE_M} m. Acércate al punto o vuelve a intentarlo a cielo abierto antes de usarla.`;
  if (q === 'NOT_REPORTED') return 'El dispositivo no informó la precisión: trátala como aproximada.';
  return null;
}

export interface RawPosition { coords: { latitude: number; longitude: number; accuracy: number | null }; timestamp: number; mocked?: boolean }

/** Convierte la lectura del sistema sin completar nada: sin precisión válida queda null. */
export function readingFrom(loc: RawPosition, providerDetail: string, now = Date.now()): Reading {
  const acc = loc.coords.accuracy;
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy_m: typeof acc === 'number' && Number.isFinite(acc) && acc >= 0 ? acc : null,
    acquired_at: new Date(loc.timestamp).toISOString(),
    mocked: typeof loc.mocked === 'boolean' ? loc.mocked : null,
    provider_detail: providerDetail,
    received_ms: now,
  };
}

/** Mensaje recuperable cuando el sistema no entrega la ubicación (el borrador siempre se conserva). */
export function locationErrorMessage(message: string): string {
  if (/unsatisfied device settings|services are disabled|location is unavailable|Location provider is unavailable/i.test(message)) {
    return 'No se pudo obtener la ubicación: activa la ubicación del dispositivo en modo de alta precisión y vuelve a intentarlo. El borrador se conserva.';
  }
  return 'No se pudo obtener la ubicación del dispositivo. El borrador se conserva; vuelve a intentarlo.';
}
