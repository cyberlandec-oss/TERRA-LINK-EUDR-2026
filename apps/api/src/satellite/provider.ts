import { createHash } from 'crypto';
import type { SatelliteOperation, SatelliteOutcome } from '../db/schema';
import { EgressBlocked, redact, requestExternal } from './egress';

// P0-028 · puerto del proveedor satelital (S1 §40: «No acoplar el core a un único proveedor»; S1 §103: «No acoplar el
// sistema a un proveedor satelital»). docs/15 §Contrato de adapter satelital:
//   Entrada: tenant, versión/hash de geometría, periodo de análisis, operación y credencial referenciada.
//   Salida: job/result con proveedor, dataset/version, fecha/resolución/método, cobertura, observaciones,
//           limitaciones, resultado y referencia de bytes originales.
// «No todas las APIs entregan la misma confianza; no inventarla»: `confidence` solo se rellena si el proveedor la
// define, y los campos que el proveedor no informa quedan nulos y visibles como tales.

export const ADAPTER_CONTRACT_VERSION = 'TL_SAT_ADAPTER 0.1.0';

/** Las tres operaciones que nombra S1 §40. El proveedor declara cuáles soporta; no se presume ninguna. */
export const OPERATIONS: readonly SatelliteOperation[] = ['FOREST_COVER', 'DEFORESTATION_ALERTS', 'HISTORICAL_ANALYSIS'];

export interface AnalysisRequest {
  operation: SatelliteOperation;
  /** Geometría exacta de la VERSIÓN de parcela (GeoJSON, EPSG:4326). Sale del equipo: ver clasificación en el contrato. */
  geometry: unknown;
  geometryType: 'POINT' | 'POLYGON' | 'MULTIPOLYGON';
  geometryHash: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** Credencial descifrada del proveedor para esta organización, o null si no hay. Nunca se registra. */
  credential: string | null;
  allowedHosts: readonly string[];
  /** Solo fixture: escenario a reproducir. Ignorado por cualquier adapter real. */
  fixtureScenario?: FixtureScenario | null;
  /** Reintento de un trabajo que ya se había enviado: el identificador del trabajo en el proveedor, para retomar su consulta SIN volver a enviar la geometría. */
  resumeJobRef?: string | null;
  /** Enlaces con el corredor (opcionales; la fixture no los usa). Un adapter asíncrono los invoca para que el avance, el identificador y la cancelación lleguen a Terra Link. */
  hooks?: AnalysisHooks;
}

export interface AnalysisHooks {
  /** Justo ANTES de enviar la geometría al proveedor: si el envío pierde su respuesta, el desenlace queda INCIERTO y no se reenvía solo. */
  onSubmitting(): Promise<void>;
  /** El proveedor RESPONDIÓ al envío (aceptó o rechazó): ya no hay incertidumbre sobre si recibió la geometría. */
  onSubmitAnswered(): Promise<void>;
  /** El proveedor aceptó el trabajo y devolvió su identificador: se conserva para poder retomarlo. */
  onSubmitted(jobRef: string): Promise<void>;
  /** Último avance DECLARADO por el proveedor (porcentaje solo si lo informó). También renueva el arrendamiento del corredor. */
  onProgress(p: { percent: number | null; message: string | null }): Promise<void>;
  /** ¿La organización pidió cancelar este trabajo? */
  cancelRequested(): Promise<boolean>;
}

export interface ProviderResult {
  dataset: string | null;
  datasetVersion: string | null;
  analysisDate: Date | null;
  resolutionM: string | null;
  method: string | null;
  coverageStatus: 'COVERED' | 'PARTIAL' | 'NOT_COVERED' | 'UNKNOWN';
  coverageNote: string;
  /** Solo si el proveedor la define (docs/10). */
  confidence: string | null;
  limitations: string;
  /** Lo que devolvió el proveedor, SIN interpretar. */
  indicators: Record<string, unknown>;
  /** Bytes originales de la respuesta, para conservarlos con su huella. */
  raw: Buffer | null;
}

export type ProviderOutcome =
  | { kind: 'RESULT'; result: ProviderResult }
  // Un adapter puede terminar en cualquier desenlace salvo los que decide Terra Link: que haya resultado, que no
  // haya proveedor o que la geometría quedara superada. `CANCELLED`: la organización pidió cancelar y el proveedor lo confirmó.
  | { kind: Exclude<SatelliteOutcome, 'RESULT_AVAILABLE' | 'NO_PROVIDER_SELECTED' | 'SUPERSEDED_GEOMETRY'>; errorCode: string; note: string };

export interface SatelliteProviderPort {
  readonly code: string;
  readonly kind: 'EXTERNAL_HTTP' | 'SYNTHETIC_FIXTURE';
  analyze(req: AnalysisRequest): Promise<ProviderOutcome>;
}

/** Huella de la petición: permite reconstruir QUÉ se pidió sin volver a enviarlo ni guardar coordenadas en claro. */
export function requestFingerprint(req: Pick<AnalysisRequest, 'operation' | 'geometryHash' | 'periodStart' | 'periodEnd'> & { providerCode: string }): string {
  return createHash('sha256')
    .update([ADAPTER_CONTRACT_VERSION, req.providerCode, req.operation, req.geometryHash, req.periodStart ?? '', req.periodEnd ?? ''].join('|'))
    .digest('hex');
}

/** Traduce un fallo de la llamada saliente a un desenlace del contrato. Nunca conserva el mensaje crudo. */
export function outcomeFromError(err: unknown, secrets: readonly string[] = []): ProviderOutcome {
  if (err instanceof EgressBlocked) return { kind: 'EGRESS_BLOCKED', errorCode: `EGRESS_${err.reason}`, note: redact(err.detail, secrets) };
  const code = (err as { code?: unknown })?.code;
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || (err as Error)?.message === 'timeout') {
    return { kind: 'TIMEOUT', errorCode: 'PROVIDER_TIMEOUT', note: 'El proveedor no respondió dentro del plazo. Sin resultado: no evaluable.' };
  }
  return { kind: 'PROVIDER_ERROR', errorCode: typeof code === 'string' ? `TRANSPORT_${code.replace(/[^A-Z0-9_]/gi, '').toUpperCase().slice(0, 40)}` : 'PROVIDER_UNREACHABLE', note: 'No se pudo completar la llamada al proveedor.' };
}

/** Traduce el código HTTP de un proveedor a un desenlace. 2xx lo interpreta cada adapter. */
export function outcomeFromStatus(status: number): ProviderOutcome | null {
  if (status === 429) return { kind: 'RATE_LIMITED', errorCode: 'PROVIDER_RATE_LIMITED', note: 'Cupo del proveedor agotado. Sin resultado: no evaluable.' };
  if (status === 401 || status === 403) return { kind: 'PROVIDER_ERROR', errorCode: `PROVIDER_HTTP_${status}`, note: 'El proveedor rechazó la credencial o el permiso.' };
  if (status >= 400) return { kind: 'PROVIDER_ERROR', errorCode: `PROVIDER_HTTP_${status}`, note: 'El proveedor devolvió un error.' };
  return null;
}

export type FixtureScenario = 'RESULT_COVERED' | 'RESULT_FINDINGS' | 'RESULT_NO_FINDINGS' | 'RESULT_PARTIAL' | 'NO_COVERAGE' | 'TIMEOUT' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'EGRESS_BLOCKED';

export const FIXTURE_SCENARIOS: readonly FixtureScenario[] = ['RESULT_COVERED', 'RESULT_FINDINGS', 'RESULT_NO_FINDINGS', 'RESULT_PARTIAL', 'NO_COVERAGE', 'TIMEOUT', 'RATE_LIMITED', 'PROVIDER_ERROR', 'EGRESS_BLOCKED'];

const FIXTURE_LIMITATION =
  'FIXTURE SINTÉTICA: no es análisis satelital real. No procede de ningún proveedor, no observa la parcela y no acredita ausencia ni presencia de deforestación.';

/**
 * Adapter de FIXTURE SINTÉTICA. Existe para probar el contrato, los desenlaces y los controles sin proveedor
 * (docs/15: «simuladores solo en tests/desarrollo claramente marcados»). No sale a la red. Sus resultados se
 * guardan con `is_synthetic = true` y no satisfacen ningún requisito del expediente ni ninguna regla de riesgo.
 */
export class FixtureSatelliteProvider implements SatelliteProviderPort {
  readonly code = 'FIXTURE_SYNTHETIC';
  readonly kind = 'SYNTHETIC_FIXTURE' as const;

  async analyze(req: AnalysisRequest): Promise<ProviderOutcome> {
    const scenario: FixtureScenario = req.fixtureScenario ?? 'RESULT_COVERED';
    switch (scenario) {
      case 'NO_COVERAGE':
        return { kind: 'NO_COVERAGE', errorCode: 'FIXTURE_NO_COVERAGE', note: 'La fixture declara que no cubre la geometría. «Sin alertas» no equivale a «sin deforestación».' };
      case 'TIMEOUT':
        return { kind: 'TIMEOUT', errorCode: 'FIXTURE_TIMEOUT', note: 'La fixture simula un plazo vencido. Sin resultado: no evaluable.' };
      case 'RATE_LIMITED':
        return { kind: 'RATE_LIMITED', errorCode: 'FIXTURE_RATE_LIMITED', note: 'La fixture simula cupo agotado. Sin resultado: no evaluable.' };
      case 'PROVIDER_ERROR':
        return { kind: 'PROVIDER_ERROR', errorCode: 'FIXTURE_PROVIDER_ERROR', note: 'La fixture simula un error del proveedor.' };
      case 'EGRESS_BLOCKED':
        return { kind: 'EGRESS_BLOCKED', errorCode: 'EGRESS_HOST_NOT_ALLOWED', note: 'La fixture simula un destino fuera de la lista blanca.' };
      default: {
        const partial = scenario === 'RESULT_PARTIAL';
        return {
          kind: 'RESULT',
          result: {
            dataset: 'FIXTURE_DATASET', datasetVersion: '0.0.0-sintetico', analysisDate: new Date('2026-01-01T00:00:00Z'),
            resolutionM: '10.00', method: 'FIXTURE: valores fijos, sin observación satelital',
            coverageStatus: partial ? 'PARTIAL' : 'COVERED',
            coverageNote: partial ? 'Cobertura parcial declarada por la fixture: el resultado no abarca toda la geometría.' : 'Cobertura completa declarada por la fixture (sintética).',
            confidence: null,
            limitations: FIXTURE_LIMITATION,
            indicators: {
              fixture: true, ensayo: true, scenario, geometry_type: req.geometryType, operation: req.operation,
              // ENSAYO: hallazgos SINTÉTICOS controlados para probar cómo se muestran y se explican. No observan la parcela.
              ...(scenario === 'RESULT_FINDINGS' ? { findings: { count: 3, kind: 'ALERTAS_SINTETICAS', note: 'Tres alertas inventadas por la fixture para ensayar su presentación. No corresponden a ninguna observación.' } } : {}),
              ...(scenario === 'RESULT_NO_FINDINGS' ? { findings: { count: 0, kind: 'ALERTAS_SINTETICAS', note: 'La fixture no devuelve alertas. Sin hallazgos NO es lo mismo que sin deforestación ni acredita conformidad.' } } : {}),
            },
            raw: Buffer.from(JSON.stringify({ fixture: true, scenario, geometry_hash: req.geometryHash }), 'utf8'),
          },
        };
      }
    }
  }
}

/** Se exporta para que un adapter real lo reutilice; hoy no hay ninguno (D-09). */
export const externalCall = requestExternal;
