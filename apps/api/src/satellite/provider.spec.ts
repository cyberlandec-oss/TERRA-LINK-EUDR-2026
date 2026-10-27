import { EgressBlocked } from './egress';
import { ADAPTER_CONTRACT_VERSION, FixtureSatelliteProvider, outcomeFromError, outcomeFromStatus, requestFingerprint, type AnalysisRequest } from './provider';

const base: AnalysisRequest = {
  operation: 'FOREST_COVER',
  geometry: { type: 'Point', coordinates: [-79.5, -1] },
  geometryType: 'POINT',
  geometryHash: 'a'.repeat(64),
  periodStart: null, periodEnd: null, credential: null, allowedHosts: [],
};

describe('P0-028 · huella de la petición', () => {
  it('cambia con el proveedor, la operación, la geometría o el periodo, y es estable si nada cambia', () => {
    const f = (o: Partial<Parameters<typeof requestFingerprint>[0]>) =>
      requestFingerprint({ providerCode: 'X', operation: 'FOREST_COVER', geometryHash: 'a'.repeat(64), periodStart: null, periodEnd: null, ...o });
    const ref = f({});
    expect(f({})).toBe(ref);
    expect(f({ providerCode: 'Y' })).not.toBe(ref);
    expect(f({ operation: 'DEFORESTATION_ALERTS' })).not.toBe(ref);
    expect(f({ geometryHash: 'b'.repeat(64) })).not.toBe(ref);
    expect(f({ periodStart: '2020-12-31' })).not.toBe(ref);
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('P0-028 · traducción de fallos a desenlaces', () => {
  it('un bloqueo de salida conserva su motivo y redacta la credencial', () => {
    const o = outcomeFromError(new EgressBlocked('HOST_NOT_ALLOWED', 'Host fuera de la lista: clave-secreta-larga'), ['clave-secreta-larga']);
    expect(o).toMatchObject({ kind: 'EGRESS_BLOCKED', errorCode: 'EGRESS_HOST_NOT_ALLOWED' });
    expect((o as { note: string }).note).toContain('[REDACTADO]');
  });

  it('el plazo vencido es TIMEOUT y cualquier otro transporte es PROVIDER_ERROR; nunca se conserva el mensaje crudo', () => {
    expect(outcomeFromError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toMatchObject({ kind: 'TIMEOUT' });
    const other = outcomeFromError(Object.assign(new Error('getaddrinfo falló para host-interno'), { code: 'ENOTFOUND' }));
    expect(other).toMatchObject({ kind: 'PROVIDER_ERROR', errorCode: 'TRANSPORT_ENOTFOUND' });
    expect(JSON.stringify(other)).not.toContain('host-interno');
  });

  it('429 es cupo agotado; 401/403 y 5xx son error del proveedor; 2xx lo interpreta el adapter', () => {
    expect(outcomeFromStatus(429)).toMatchObject({ kind: 'RATE_LIMITED' });
    expect(outcomeFromStatus(401)).toMatchObject({ kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_HTTP_401' });
    expect(outcomeFromStatus(503)).toMatchObject({ kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_HTTP_503' });
    expect(outcomeFromStatus(200)).toBeNull();
  });
});

describe('P0-028 · fixture sintética', () => {
  const fixture = new FixtureSatelliteProvider();

  it('se identifica como sintética y rotula su propio resultado', async () => {
    expect(fixture.kind).toBe('SYNTHETIC_FIXTURE');
    const o = await fixture.analyze({ ...base, fixtureScenario: 'RESULT_COVERED' });
    expect(o.kind).toBe('RESULT');
    const r = (o as { result: { limitations: string; coverageStatus: string; confidence: string | null } }).result;
    expect(r.limitations).toMatch(/FIXTURE SINTÉTICA: no es análisis satelital real/);
    expect(r.coverageStatus).toBe('COVERED');
    // No se inventa confianza que el «proveedor» no define (docs/10).
    expect(r.confidence).toBeNull();
  });

  it('reproduce cada desenlace no favorable del contrato', async () => {
    const kinds = await Promise.all(
      (['NO_COVERAGE', 'TIMEOUT', 'RATE_LIMITED', 'PROVIDER_ERROR', 'EGRESS_BLOCKED'] as const).map(async (s) => (await fixture.analyze({ ...base, fixtureScenario: s })).kind),
    );
    expect(kinds).toEqual(['NO_COVERAGE', 'TIMEOUT', 'RATE_LIMITED', 'PROVIDER_ERROR', 'EGRESS_BLOCKED']);
  });

  it('cobertura parcial se declara como parcial, no como completa', async () => {
    const o = await fixture.analyze({ ...base, fixtureScenario: 'RESULT_PARTIAL' });
    expect((o as { result: { coverageStatus: string } }).result.coverageStatus).toBe('PARTIAL');
  });

  it('el contrato de adapter está versionado', () => {
    expect(ADAPTER_CONTRACT_VERSION).toMatch(/^TL_SAT_ADAPTER \d+\.\d+\.\d+$/);
  });
});
