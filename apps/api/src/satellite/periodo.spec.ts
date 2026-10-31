import { periodRejection } from './satellite';

describe('periodo de análisis (AJ-07)', () => {
  it('Whisp no admite periodo: se rechaza con su código, sea inicio, fin o ambos', () => {
    for (const [a, b] of [['2020-12-31', null], [null, '2024-12-31'], ['2020-12-31', '2024-12-31']] as const) {
      expect(periodRejection('WHISP', a, b)).toMatchObject({ status: 422, code: 'PERIOD_NOT_SUPPORTED_BY_PROVIDER' });
    }
  });
  it('sin periodo, o con otro proveedor, no hay rechazo', () => {
    expect(periodRejection('WHISP', undefined, undefined)).toBeNull();
    expect(periodRejection('WHISP', null, null)).toBeNull();
    expect(periodRejection('FIXTURE_SYNTHETIC', '2020-12-31', '2024-12-31')).toBeNull();
  });
});
