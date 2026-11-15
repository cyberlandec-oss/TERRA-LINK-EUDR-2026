import { describe, expect, it } from 'vitest';
import { datasetsNoDisponibles, datasetsRiesgoNoDisponibles, indicadorRiesgoParaCultivo, resumenForestal } from './satellite';

describe('satellite result presentation', () => {
  it('keeps high risk and full coverage as separate provider values', () => {
    expect(indicadorRiesgoParaCultivo('Cacao')).toBe('risk_pcrop');
    expect(resumenForestal({ risk_pcrop: 'HIGH', Cocoa_FDaP: 'COVERED' })).toEqual([
      ['risk_pcrop', 'HIGH'],
      ['Cocoa_FDaP', 'COVERED'],
    ]);
  });

  it('maps soybean to its annual-crop risk indicator and leaves unknown crops unmapped', () => {
    expect(indicadorRiesgoParaCultivo('soya')).toBe('risk_acrop');
    expect(indicadorRiesgoParaCultivo('producto no documentado')).toBeNull();
  });

  it('exposes insufficient information and unavailable risk inputs distinctly', () => {
    const indicators = { more_info_needed: true, whisp_processing_metadata: { unavailable_datasets: ['IDEAM'], risk_inputs_unavailable: ['tree_cover', 'disturbance_after_2020'] } };
    expect(resumenForestal(indicators)).toEqual([['more_info_needed', 'true']]);
    expect(datasetsNoDisponibles(indicators)).toEqual(['IDEAM']);
    expect(datasetsRiesgoNoDisponibles(indicators)).toEqual(['tree_cover', 'disturbance_after_2020']);
  });
});
