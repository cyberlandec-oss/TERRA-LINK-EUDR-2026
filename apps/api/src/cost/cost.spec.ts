import { dividir, multiplicar, normalizar } from './cost';

// P1-010 — La aritmética del presupuesto, probada sola. Son tres reglas pequeñas de las que depende que una
// cifra de dinero no mienta.
describe('aritmética del presupuesto', () => {
  const e = (s: string) => BigInt(Math.round(Number(s) * 1e6));

  it('multiplica en decimal exacto: 0,1 × 3 es 0,3, no 0,30000000000000004', () => {
    expect(normalizar(String(Number(multiplicar(e('0.1'), e('3'))) / 1e6))).toBe('0.3');
    expect(multiplicar(e('0.1'), e('3'))).toBe(300000n);
    expect(multiplicar(e('0.123456'), e('2'))).toBe(246912n);
  });

  it('divide a seis decimales, y con divisor CERO devuelve «no calculable»', () => {
    // 13 / 0,25 = 52
    expect(dividir(e('13'), e('0.25'))).toBe('52');
    // El caso que con datos normales no se alcanza, y por eso se prueba aquí: dividir por cero NO da
    // cero ni infinito. Devuelve null, que la respuesta publica como NO_CALCULABLE.
    expect(dividir(e('13'), 0n)).toBeNull();
    expect(dividir(0n, 0n)).toBeNull();
  });

  it('normaliza a un solo formato: el mismo número no se publica de dos maneras', () => {
    // `numeric` de Postgres devuelve «250.000000»; el cálculo propio, «250».
    expect(normalizar('250.000000')).toBe('250');
    expect(normalizar('13.000000')).toBe('13');
    expect(normalizar('0.100000')).toBe('0.1');
    expect(normalizar('0.123456')).toBe('0.123456');
  });
});
