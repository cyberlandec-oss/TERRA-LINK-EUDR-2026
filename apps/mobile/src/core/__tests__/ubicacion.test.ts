import { APPROXIMATE_ABOVE_M, FRESH_MAX_AGE_S, ageSeconds, isFresh, locationErrorMessage, qualityNotice, qualityOf, readingFrom } from '../ubicacion';

// «Mi ubicación» (móvil): reglas puras. La lectura conserva SU precisión y SU hora; nada se inventa.
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const pos = (accuracy: number | null, extra: { mocked?: boolean } = {}) => ({ coords: { latitude: -0.85, longitude: -80.16, accuracy }, timestamp: T0, ...extra });

describe('Mi ubicación (móvil)', () => {
  it('la precisión nunca se inventa: nula, negativa o no finita queda como no informada; 0 es un valor informado', () => {
    expect(readingFrom(pos(12), 'p', 5).accuracy_m).toBe(12);
    expect(readingFrom(pos(0), 'p', 5).accuracy_m).toBe(0);
    expect(readingFrom(pos(null), 'p', 5).accuracy_m).toBeNull();
    expect(readingFrom(pos(-3), 'p', 5).accuracy_m).toBeNull();
    expect(readingFrom(pos(Number.NaN), 'p', 5).accuracy_m).toBeNull();
  });

  it('conserva la hora del dispositivo, el indicador de simulada y el proveedor; no afirma GPS', () => {
    const r = readingFrom(pos(8, { mocked: true }), 'expo-location; no garantiza GPS', 123);
    expect(r.acquired_at).toBe('2026-10-22T12:00:00.000Z');
    expect(r.mocked).toBe(true);
    expect(r.provider_detail).toContain('no garantiza GPS');
    expect(readingFrom(pos(8), 'p', 1).mocked).toBeNull(); // si el sistema no lo informa, no se supone
  });

  it('la calidad se anuncia sin bloquear', () => {
    expect(qualityOf(null)).toBe('NOT_REPORTED');
    expect(qualityOf(APPROXIMATE_ABOVE_M)).toBe('REPORTED');
    expect(qualityOf(APPROXIMATE_ABOVE_M + 1)).toBe('APPROXIMATE');
    expect(qualityNotice('REPORTED')).toBeNull();
    expect(qualityNotice('APPROXIMATE')).toContain('aproximada');
    expect(qualityNotice('NOT_REPORTED')).toContain('no informó la precisión');
  });

  it('una lectura vieja no se usa como si acabara de medirse', () => {
    const r = { received_ms: 10_000 };
    expect(ageSeconds(r, 10_000 + 20_000)).toBe(20);
    expect(isFresh(r, 10_000 + FRESH_MAX_AGE_S * 1000)).toBe(true);
    expect(isFresh(r, 10_000 + (FRESH_MAX_AGE_S + 1) * 1000)).toBe(false);
    expect(ageSeconds(r, 5_000)).toBe(0);
  });

  it('los errores del sistema dan mensajes recuperables y conservan el borrador', () => {
    expect(locationErrorMessage('Location provider is unavailable')).toContain('modo de alta precisión');
    expect(locationErrorMessage('boom')).toContain('vuelve a intentarlo');
    expect(locationErrorMessage('boom')).toContain('El borrador se conserva');
  });
});
