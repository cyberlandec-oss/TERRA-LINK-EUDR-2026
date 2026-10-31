import { describe, expect, it } from 'vitest';
import { APPROXIMATE_ABOVE_M, FRESH_MAX_AGE_S, accuracyCircle, ageSeconds, failureCode, isFresh, qualityOf, toMyLocation } from './mi-ubicacion';

// «Mi ubicación»: reglas puras. Una lectura conserva SU precisión y SU hora; nada se inventa ni se rellena.
describe('Mi ubicación', () => {
  it('la precisión nunca se inventa: ausente, negativa o no finita queda como no informada', () => {
    const pos = (accuracy: number) => ({ coords: { latitude: -0.85, longitude: -80.16, accuracy }, timestamp: Date.UTC(2026, 9, 22, 12, 0, 0) });
    expect(toMyLocation(pos(12)).accuracy_m).toBe(12);
    expect(toMyLocation(pos(0)).accuracy_m).toBe(0); // 0 es un valor informado, no una ausencia
    expect(toMyLocation(pos(-1)).accuracy_m).toBeNull();
    expect(toMyLocation(pos(Number.NaN)).accuracy_m).toBeNull();
    expect(toMyLocation(pos(Number.POSITIVE_INFINITY)).accuracy_m).toBeNull();
    expect(toMyLocation(pos(12)).captured_at).toBe('2026-10-22T12:00:00.000Z'); // la hora es la del dispositivo
  });

  it('la calidad se anuncia sin bloquear: sin precisión → no informada; por encima del umbral → aproximada', () => {
    expect(qualityOf(null)).toBe('NOT_REPORTED');
    expect(qualityOf(APPROXIMATE_ABOVE_M)).toBe('REPORTED');
    expect(qualityOf(APPROXIMATE_ABOVE_M + 0.1)).toBe('APPROXIMATE');
    expect(qualityOf(5)).toBe('REPORTED');
  });

  it('una lectura vieja no se usa como si acabara de medirse', () => {
    const l = { received_ms: 1_000_000 };
    expect(ageSeconds(l, 1_000_000 + 30_000)).toBe(30);
    expect(isFresh(l, 1_000_000 + FRESH_MAX_AGE_S * 1000)).toBe(true);
    expect(isFresh(l, 1_000_000 + (FRESH_MAX_AGE_S + 1) * 1000)).toBe(false);
    expect(ageSeconds(l, 999_000)).toBe(0); // un reloj atrasado nunca da una antigüedad negativa
  });

  it('los errores del navegador se traducen a causas distintas, con recuperación', () => {
    expect(failureCode({ code: 1 })).toBe('DENIED');
    expect(failureCode({ code: 2 })).toBe('UNAVAILABLE');
    expect(failureCode({ code: 3 })).toBe('TIMEOUT');
    expect(failureCode({ code: 99 })).toBe('UNAVAILABLE');
  });

  it('el círculo de precisión es un anillo cerrado cuyo radio coincide con la precisión informada', () => {
    const ring = accuracyCircle(-80.16, -0.85, 50);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring).toHaveLength(65);
    const metrosNorte = (ring[16][1] - -0.85) * 111_320; // vértice a 90°
    expect(metrosNorte).toBeGreaterThan(49.9);
    expect(metrosNorte).toBeLessThan(50.1);
  });
});
