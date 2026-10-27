import { describe, expect, it } from 'vitest';
import { accuracyLabel } from './location-capture';

describe('precisión de ubicación', () => {
  it('distingue no informada, cero reportado y valor informado sin inventar nada', () => {
    expect(accuracyLabel(null)).toBe('No informada por el navegador');
    expect(accuracyLabel(0)).toMatch(/^0 m .*no implica precisión perfecta/);
    expect(accuracyLabel(12.34)).toBe('± 12,3 m (informada)');
  });
});
