import { summarizeAccuracy } from './accuracy-summary';

describe('resumen de precisión (sin precisión agregada inventada)', () => {
  it('completa: todas informadas, peor conocida', () => {
    expect(summarizeAccuracy([5, 12.4, 8])).toMatchObject({ with_accuracy: 3, without_accuracy: 0, worst_known_m: 12.4, complete: true, label: '3 vértices con precisión informada; 0 sin informar; peor precisión conocida 12,4 m' });
  });

  it('mixta: resumen incompleto y la peor es solo la peor CONOCIDA', () => {
    const s = summarizeAccuracy([5, null, 3]);
    expect(s).toMatchObject({ with_accuracy: 2, without_accuracy: 1, worst_known_m: 5, complete: false });
    expect(s.label).toContain('(resumen incompleto)');
  });

  it('totalmente ausente: «Precisión no informada», nunca 0', () => {
    expect(summarizeAccuracy([null, null, null])).toMatchObject({ with_accuracy: 0, without_accuracy: 3, worst_known_m: null, complete: false, label: 'Precisión no informada' });
  });

  it('un 0 reportado cuenta como informado y se conserva', () => {
    expect(summarizeAccuracy([0, 0, 0])).toMatchObject({ with_accuracy: 3, worst_known_m: 0, complete: true });
  });

  it('sin vértices', () => {
    expect(summarizeAccuracy([])).toMatchObject({ label: 'Sin vértices', complete: false });
  });
});
