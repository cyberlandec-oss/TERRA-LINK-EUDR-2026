import { EgressBlocked, redact, requestExternal } from './egress';
import { outcomeFromError, outcomeFromStatus, type AnalysisRequest, type ProviderOutcome, type ProviderResult, type SatelliteProviderPort } from './provider';

// P0-028 · adaptador de **Whisp** (Open Foris / FAO · Forest Data Partnership).
//
// ALCANCE AUTORIZADO: **D-09 parte A** — adaptador de desarrollo. La parte B (llamar al servicio real, enviar
// geometrías, registrar claves reales) **sigue pendiente**. Por eso el adaptador nace con las llamadas reales
// DESHABILITADAS: `liveCalls` es un interruptor explícito de configuración, y ni seleccionar Whisp ni encontrar una
// credencial guardada lo activan. Sin él, `analyze` devuelve `LIVE_CALLS_DISABLED` sin tocar la red.
//
// CONTRATO: `docs/decisiones/P0-028-WHISP-CONTRATO.md` — OpenAPI **2.3.0**, consultado el **2026-10-15**. No se
// inventan endpoints, campos, versiones de dataset ni garantías: lo que el proveedor no declara, queda nulo.
//
// INCOMPLETITUD (lo que el proveedor sí declara): «Occasionally a dataset can't be read from Earth Engine … Whisp
// skips it and records its name in the `whisp_processing_metadata` column, under `unavailable_datasets`», y
// `risk_inputs_unavailable` cuando lo omitido alimentaba su evaluación. Un `200` y un trabajo terminado **no**
// significan cobertura completa: ese es justamente el caso que hay que conservar, no suavizar.

export const WHISP_CONTRACT = {
  spec_version: '2.3.0',
  consulted_at: '2026-10-15',
  source: 'https://whisp.openforis.org/api/openapi.json',
  default_base_url: 'https://whisp.openforis.org',
  default_host: 'whisp.openforis.org',
} as const;

/** Estados de `code` de la enumeración `SystemCode` del contrato. */
const COMPLETED = 'analysis_completed';
const ERROR = 'analysis_error';
const TIMEOUT = 'analysis_timeout';
const NOT_FOUND = 'analysis_job_not_found';
const IN_PROGRESS = ['analysis_queued', 'analysis_processing'];

export interface WhispOptions {
  /** Interruptor explícito: sin él no se abre ninguna conexión. Por omisión, **false**. */
  liveCalls?: boolean;
  /** Base del servicio. En pruebas apunta a un servidor controlado del equipo. */
  baseUrl?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** Sondeo del trabajo asíncrono: separación entre consultas y número máximo. */
  pollMs?: number;
  maxPolls?: number;
  /** Ancla una CA concreta (un servidor controlado en pruebas, o un proveedor con CA privada). */
  ca?: string | Buffer;
  /** Solo pruebas: resolución inyectada. */
  lookup?: AnalysisRequest extends never ? never : Parameters<typeof requestExternal>[0]['lookup'];
  /** Solo pruebas: espera entre sondeos. */
  sleep?: (ms: number) => Promise<void>;
}

interface WhispConfig {
  maxRequestBodySizeKb: number | null;
  maxPlotAreaHa: number | null;
  geometryLimitSync: number;
  analysisTimeoutSyncSeconds: number;
  openforisWhispVersion: string;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export class WhispSatelliteProvider implements SatelliteProviderPort {
  readonly code = 'WHISP';
  readonly kind = 'EXTERNAL_HTTP' as const;
  private readonly o: Required<Pick<WhispOptions, 'liveCalls' | 'baseUrl' | 'timeoutMs' | 'maxBytes' | 'pollMs' | 'maxPolls'>> & WhispOptions;

  constructor(options: WhispOptions = {}) {
    this.o = {
      liveCalls: options.liveCalls === true,
      baseUrl: options.baseUrl ?? WHISP_CONTRACT.default_base_url,
      timeoutMs: options.timeoutMs ?? 90_000,
      maxBytes: options.maxBytes ?? 8 * 1024 * 1024,
      pollMs: options.pollMs ?? 3000,
      maxPolls: options.maxPolls ?? 40,
      ...options,
    };
  }

  private async call(req: AnalysisRequest, path: string, init: { method?: 'GET' | 'POST'; body?: string; auth?: boolean } = {}) {
    return await requestExternal({
      url: `${this.o.baseUrl}${path}`,
      allowedHosts: req.allowedHosts,
      method: init.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        // La credencial viaja SOLO a un destino ya validado por la defensa de salida, y nunca en la URL.
        ...(init.auth && req.credential ? { 'x-api-key': req.credential } : {}),
      },
      body: init.body,
      timeoutMs: this.o.timeoutMs,
      maxBytes: this.o.maxBytes,
      ca: this.o.ca,
      lookup: this.o.lookup,
    });
  }

  private parseJson(body: Buffer): Json | null {
    try {
      const v: unknown = JSON.parse(body.toString('utf8'));
      return isObj(v) ? v : null;
    } catch {
      return null;
    }
  }

  async analyze(req: AnalysisRequest): Promise<ProviderOutcome> {
    // 1) Interruptor de llamadas reales. Primero que nada: no se resuelve DNS, no se abre socket, no sale nada.
    if (!this.o.liveCalls) {
      return { kind: 'LIVE_CALLS_DISABLED', errorCode: 'LIVE_CALLS_DISABLED',
        note: 'Las llamadas reales al proveedor están deshabilitadas por configuración (D-09 parte B pendiente). No se envió ninguna geometría.' };
    }
    if (!req.credential) {
      return { kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_CREDENTIAL_MISSING',
        note: 'La organización no tiene credencial registrada para este proveedor: no se envía nada.' };
    }
    const secrets = [req.credential];
    try {
      // 2) Límites declarados por el proveedor, ANTES de enviar la geometría. Si no se pueden leer, no se envía:
      //    no se adivina un límite que el proveedor publica.
      const cfgRes = await this.call(req, '/api/config');
      const byStatus = outcomeFromStatus(cfgRes.status);
      if (byStatus) return byStatus;
      const cfg = this.parseJson(cfgRes.body) as unknown as WhispConfig | null;
      if (!cfg || typeof cfg.geometryLimitSync !== 'number') {
        return { kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_CONFIG_UNREADABLE', note: 'La configuración publicada por el proveedor no es legible según el contrato.' };
      }

      // 3) Una geometría por trabajo: entra en el límite síncrono del proveedor (≥ 1 en todo el contrato).
      const feature = { type: 'Feature', properties: {}, geometry: req.geometry };
      const body = JSON.stringify({ type: 'FeatureCollection', features: [feature], analysisOptions: { async: false } });
      const sizeKb = Buffer.byteLength(body, 'utf8') / 1024;
      if (cfg.maxRequestBodySizeKb !== null && sizeKb > cfg.maxRequestBodySizeKb) {
        return { kind: 'GEOMETRY_UNSUPPORTED', errorCode: 'REQUEST_TOO_LARGE_FOR_PROVIDER',
          note: `La geometría supera el tamaño máximo que el proveedor declara (${cfg.maxRequestBodySizeKb} KB).` };
      }

      // 4) Envío.
      const submit = await this.call(req, '/api/submit/geojson', { method: 'POST', body, auth: true });
      const bySubmit = outcomeFromStatus(submit.status);
      if (bySubmit) return bySubmit;
      const first = this.parseJson(submit.body);
      if (!first) return { kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_RESPONSE_NOT_JSON', note: 'La respuesta del proveedor no es JSON conforme al contrato.' };

      let payload: Json = first;
      let raw: Buffer = submit.body;

      // 5) Trabajo asíncrono: 202 con `token`. Se sondea `/api/status/{token}` según el contrato.
      if (submit.status === 202 || (typeof first.token === 'string' && !isObj(first.data))) {
        const token = typeof first.token === 'string' ? first.token : null;
        if (!token) return { kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_TOKEN_MISSING', note: 'El proveedor aceptó el trabajo sin devolver el identificador que exige su contrato.' };
        const polled = await this.poll(req, token, secrets);
        if ('kind' in polled) return polled;
        payload = polled.payload;
        raw = polled.raw;
      }

      // 6) Resultado. Si el estado terminó sin traer `data`, se descarga por el endpoint publicado para eso.
      if (!isObj(payload.data)) {
        const token = typeof payload.token === 'string' ? payload.token : (typeof first.token === 'string' ? first.token : null);
        if (!token) return { kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_RESULT_MISSING', note: 'El proveedor terminó el trabajo sin entregar resultado ni identificador de descarga.' };
        // La descarga pasa por la MISMA política de salida: mismo host de la lista blanca, sin seguir redirecciones.
        const dl = await this.call(req, `/api/generate-geojson/${encodeURIComponent(token)}`);
        const byDl = outcomeFromStatus(dl.status);
        if (byDl) return byDl;
        const parsed = this.parseJson(dl.body);
        if (!parsed) return { kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_DOWNLOAD_NOT_JSON', note: 'La descarga del resultado no es JSON conforme al contrato.' };
        payload = isObj(parsed.data) ? parsed : { data: parsed };
        raw = dl.body;
      }

      return this.toResult(payload, cfg, raw);
    } catch (err) {
      return outcomeFromError(err, secrets);
    }
  }

  /** Sondeo acotado del trabajo asíncrono, con los códigos del contrato. */
  private async poll(req: AnalysisRequest, token: string, secrets: readonly string[]): Promise<{ payload: Json; raw: Buffer } | ProviderOutcome> {
    const sleep = this.o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let i = 0; i < this.o.maxPolls; i++) {
      const res = await this.call(req, `/api/status/${encodeURIComponent(token)}`, { auth: true });
      const byStatus = outcomeFromStatus(res.status);
      if (byStatus) return byStatus;
      const payload = this.parseJson(res.body);
      if (!payload) return { kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_STATUS_NOT_JSON', note: 'El estado del trabajo no es JSON conforme al contrato.' };
      const code = typeof payload.code === 'string' ? payload.code : '';
      if (code === COMPLETED) return { payload, raw: res.body };
      if (code === TIMEOUT) return { kind: 'TIMEOUT', errorCode: 'PROVIDER_ANALYSIS_TIMEOUT', note: 'El proveedor declaró que su análisis venció por plazo. Sin resultado: no evaluable.' };
      if (code === ERROR) return { kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_ANALYSIS_ERROR', note: redact('El proveedor declaró un error en el análisis.', secrets) };
      if (code === NOT_FOUND) return { kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_JOB_NOT_FOUND', note: 'El proveedor no reconoce el trabajo enviado.' };
      if (!IN_PROGRESS.includes(code)) return { kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_STATUS_UNKNOWN', note: 'El proveedor devolvió un estado que no está en su contrato.' };
      await sleep(this.o.pollMs);
    }
    return { kind: 'TIMEOUT', errorCode: 'PROVIDER_POLL_EXHAUSTED', note: 'El trabajo seguía en proceso tras el número máximo de consultas. Sin resultado: no evaluable.' };
  }

  /**
   * Traduce la respuesta a un resultado del contrato interno. **Sin interpretar**: los indicadores se conservan tal
   * como vinieron y lo que el proveedor no declara queda nulo.
   */
  private toResult(payload: Json, cfg: WhispConfig, raw: Buffer): ProviderOutcome {
    const features = isObj(payload.data) ? asArray((payload.data as Json).features) : [];
    const first = features.find(isObj);
    if (!first) return { kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_NO_FEATURES', note: 'El proveedor devolvió un resultado sin ninguna parcela analizada.' };
    const props = isObj(first.properties) ? first.properties : {};

    // Incompletitud DECLARADA por el proveedor (nombres del contrato, no inventados).
    const meta = isObj(props.whisp_processing_metadata) ? props.whisp_processing_metadata : {};
    const unavailable = asArray(meta.unavailable_datasets).filter((x): x is string => typeof x === 'string');
    const riskUnavailable = asArray(meta.risk_inputs_unavailable).filter((x): x is string => typeof x === 'string');
    const messages = asArray(payload.processStatusMessages ?? payload.processStatusMessage).filter((x): x is string => typeof x === 'string');
    const incompleto = unavailable.length > 0 || riskUnavailable.length > 0;

    const result: ProviderResult = {
      // El contrato no declara dataset ni versión de dataset por resultado: quedan nulos.
      dataset: null,
      datasetVersion: null,
      // Tampoco declara fecha de análisis, resolución ni confianza. No se rellenan con el reloj ni con la FAQ.
      analysisDate: null,
      resolutionM: null,
      confidence: null,
      method: `Whisp API ${WHISP_CONTRACT.spec_version} (contrato consultado ${WHISP_CONTRACT.consulted_at}); openforis-whisp ${cfg.openforisWhispVersion}`,
      coverageStatus: incompleto ? 'PARTIAL' : 'UNKNOWN',
      coverageNote: incompleto
        ? `Análisis PARCIAL declarado por el proveedor: ${unavailable.length} dataset(s) no disponible(s)${unavailable.length ? ` (${unavailable.join(', ')})` : ''}${riskUnavailable.length ? `; ${riskUnavailable.length} de ellos alimentaban su propia evaluación (${riskUnavailable.join(', ')})` : ''}. El resultado no cubre lo que faltó.`
        : 'El proveedor no declara cobertura en su respuesta. La ausencia de incidencias NO equivale a cobertura completa: se conserva como desconocida.',
      limitations: [
        'Resultado de un proveedor externo: no es conclusión regulatoria ni certificación («there is no certification involved», FAQ oficial).',
        'Los indicadores se conservan sin interpretar; qué significa cada uno es una decisión pendiente (D-07).',
        incompleto ? 'El propio proveedor declara datasets no disponibles en este análisis.' : 'El contrato no publica un campo de cobertura: no se presume completa.',
      ].join(' '),
      indicators: { ...props, ...(messages.length ? { process_status_messages: messages } : {}) },
      raw,
    };
    return { kind: 'RESULT', result };
  }
}

/** Mensaje único para la API y la pantalla cuando el adaptador existe pero su uso real no está autorizado. */
export const DEVELOPMENT_ONLY_NOTE =
  'Whisp está seleccionado solo como ADAPTADOR DE DESARROLLO (D-09 parte A). Llamar al servicio real y enviar geometrías exige la parte B, que sigue pendiente.';

export { EgressBlocked };
