import { resolveSatelliteCredential } from './runner';

describe('credencial global de Whisp', () => {
  it('usa la clave global del backend aunque exista una fila antigua por organización', () => {
    expect(resolveSatelliteCredential('  clave-global-controlada  ', 'clave-legada')).toBe('clave-global-controlada');
  });

  it('usa la credencial heredada solo durante la migración si no existe clave global', () => {
    expect(resolveSatelliteCredential(null, '  clave-legada  ')).toBe('clave-legada');
  });

  it('no convierte una configuración vacía en una credencial', () => {
    expect(resolveSatelliteCredential('  ', '\t')).toBeNull();
  });
});
