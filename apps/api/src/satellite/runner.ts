import { randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import type { Database, SatelliteOutcome } from '../db/schema';
import type { PiiCipher } from '../crypto/pii';
import { EventStore } from '../events/events';
import { sha256, type ObjectStore } from '../storage/object-store';
import { FixtureSatelliteProvider, type AnalysisHooks, type AnalysisRequest, type ProviderOutcome, type SatelliteProviderPort } from './provider';
import { WhispSatelliteProvider } from './whisp';

// P0-028 · corredor de trabajos satelitales. S1 §54: «No bloquear una petición HTTP durante un análisis satelital».
// Vive en el proceso worker, igual que el outbox, y con la misma semántica de arrendamiento:
// - reclama con FOR UPDATE SKIP LOCKED (varios corredores a la vez, cada trabajo en uno solo);
// - la llamada al proveedor ocurre FUERA de toda transacción (una llamada externa no mantiene abierta una
//   transacción de base de datos);
// - el cierre comprueba el token de arrendamiento: un corredor que perdió el suyo no escribe el desenlace;
// - un trabajo atrasado NO se ejecuta si la parcela ya cambió de versión vigente (docs/13: «comprobar versión
//   objetivo»); termina `SUPERSEDED_GEOMETRY` y no se traslada a la geometría nueva.
//
// Reintentos: solo lo que puede ser transitorio (TIMEOUT, RATE_LIMITED, PROVIDER_ERROR). `NO_COVERAGE` es una
// respuesta del proveedor y `EGRESS_BLOCKED` es un incidente de seguridad: ambos terminan en el acto.

// Desenlaces que NO se reintentan aunque su clase lo permita: reintentar podría duplicar el análisis o reenviar algo que la organización canceló.
const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set(['PROVIDER_SUBMIT_UNCERTAIN', 'PROVIDER_CANCEL_NOT_CONFIRMED']);
const RETRYABLE: ReadonlySet<SatelliteOutcome> = new Set<SatelliteOutcome>(['TIMEOUT', 'RATE_LIMITED', 'PROVIDER_ERROR']);

export interface RunnerOptions {
  runnerId?: string;
  batchSize?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface RunnerResult { claimed: number; completed: number; failed: number; retried: number; superseded: number }

export class SatelliteRunner {
  readonly runnerId: string;
  private readonly opts: Required<Omit<RunnerOptions, 'runnerId'>>;
  private readonly byCode: Map<string, SatelliteProviderPort>;
  private stopped = false;

  constructor(
    private readonly db: Kysely<Database>,
    providers: SatelliteProviderPort[],
    // `events`: el mismo registro de eventos de la API, para que el desenlace llegue a los consumidores del outbox
    // igual que cualquier otro hecho de dominio. Sin él (pruebas) se registra el evento sin entregas.
    private readonly deps: { store?: ObjectStore | null; cipher?: PiiCipher | null; events?: EventStore | null } = {},
    options: RunnerOptions = {},
  ) {
    this.runnerId = options.runnerId ?? `sat-${randomUUID().slice(0, 8)}`;
    this.opts = {
      batchSize: options.batchSize ?? 5,
      leaseSeconds: options.leaseSeconds ?? 120,
      maxAttempts: options.maxAttempts ?? 4,
      backoffBaseMs: options.backoffBaseMs ?? 5000,
      timeoutMs: options.timeoutMs ?? 90_000,
      maxResponseBytes: options.maxResponseBytes ?? 8 * 1024 * 1024,
    };
    this.byCode = new Map(providers.map((p) => [p.code, p]));
  }

  private async claim(limit = this.opts.batchSize, exclude: string[] = []) {
    const res = await sql<{ id: string; organization_id: string; requesting_organization_id: string; plot_id: string; plot_version_id: string; geometry_hash: string; geometry_type: string; provider_code: string; operation: string; period_start: string | null; period_end: string | null; attempts: number; lease_token: string; provider_job_ref: string | null; provider_submit_started_at: Date | null }>`
      UPDATE satellite_jobs j
         SET status = 'RUNNING', locked_by = ${this.runnerId}, lease_token = gen_random_uuid(),
             locked_until = now() + make_interval(secs => ${this.opts.leaseSeconds}), attempts = j.attempts + 1
       WHERE j.id IN (
         SELECT id FROM satellite_jobs
          WHERE ((status = 'REQUESTED' AND next_attempt_at <= now())
             OR (status = 'RUNNING' AND locked_until < now()))
            AND id <> ALL(${exclude}::uuid[])
          ORDER BY next_attempt_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
      RETURNING j.id, j.organization_id, j.requesting_organization_id, j.plot_id, j.plot_version_id, j.geometry_hash, j.geometry_type, j.provider_code,
                j.operation, j.period_start::text, j.period_end::text, j.attempts, j.lease_token, j.provider_job_ref, j.provider_submit_started_at`.execute(this.db);
    return res.rows;
  }

  /**
   * Enlaces del adaptador con el trabajo: conservan el identificador del proveedor y su avance, renuevan el arrendamiento (un análisis largo no debe perderlo mientras
   * avanza) y le dicen si la organización pidió cancelar. Todo con la comprobación del arrendamiento: un corredor que lo perdió no escribe.
   */
  private hooksFor(j: { id: string; lease_token: string }): AnalysisHooks {
    return {
      // Antes de enviar se comprueba que el corredor CONSERVA su reserva: si la perdió, no sale nada.
      onSubmitting: async () => {
        const r = await this.db.updateTable('satellite_jobs').set({ provider_submit_started_at: new Date() }).where('id', '=', j.id).where('lease_token', '=', j.lease_token).executeTakeFirst();
        if (Number(r.numUpdatedRows) !== 1) throw new Error('LEASE_LOST');
      },
      onSubmitAnswered: async () => {
        const r = await this.db.updateTable('satellite_jobs').set({ provider_submit_started_at: null }).where('id', '=', j.id).where('lease_token', '=', j.lease_token).executeTakeFirst();
        if (Number(r.numUpdatedRows) !== 1) throw new Error('LEASE_LOST');
      },
      // Identificador y fin de la incertidumbre en UNA sola escritura: o quedan los dos o no queda ninguno (la marca se conserva).
      onSubmitted: async (ref) => {
        const r = await this.db.updateTable('satellite_jobs').set({ provider_job_ref: ref, provider_submit_started_at: null }).where('id', '=', j.id).where('lease_token', '=', j.lease_token).executeTakeFirst();
        if (Number(r.numUpdatedRows) !== 1) throw new Error('LEASE_LOST');
      },
      onProgress: async ({ percent, message }) => {
        const r = await this.db.updateTable('satellite_jobs')
          .set({ provider_progress_percent: percent, provider_progress_note: message, provider_progress_at: new Date(), locked_until: new Date(Date.now() + this.opts.leaseSeconds * 1000) })
          .where('id', '=', j.id).where('lease_token', '=', j.lease_token).executeTakeFirst();
        if (Number(r.numUpdatedRows) !== 1) throw new Error('LEASE_LOST');
      },
      cancelRequested: async () => {
        const r = await this.db.selectFrom('satellite_jobs').select('cancel_requested_at').where('id', '=', j.id).executeTakeFirst();
        return !!r?.cancel_requested_at;
      },
    };
  }

  /** Escenario de fixture: viaja en el evento del encargo, nunca en el trabajo (solo la fixture lo usa). */
  private async fixtureScenario(orgId: string, jobId: string): Promise<AnalysisRequest['fixtureScenario']> {
    const r = await sql<{ payload: { fixture_scenario?: string | null } }>`
      SELECT payload FROM domain_events WHERE organization_id = ${orgId} AND aggregate_type = 'SATELLITE_JOB' AND aggregate_id = ${jobId} AND event_type = 'SatelliteAnalysisRequested' LIMIT 1`.execute(this.db);
    return (r.rows[0]?.payload?.fixture_scenario ?? null) as AnalysisRequest['fixtureScenario'];
  }

  async runOnce(): Promise<RunnerResult> {
    const out: RunnerResult = { claimed: 0, completed: 0, failed: 0, retried: 0, superseded: 0 };
    // Se reclama de a UNO: un trabajo reclamado que espera detrás de otro dejaría vencer su reserva y otro corredor lo tomaría mientras aún está en cola aquí.
    // Un trabajo ya tratado en esta pasada (p. ej. devuelto a la cola para reintentar) no se vuelve a tomar en la misma: el reintento espera su espera.
    const tratados: string[] = [];
    for (let n = 0; n < this.opts.batchSize; n++) {
      const [j] = await this.claim(1, tratados);
      if (!j) break;
      tratados.push(j.id);
      out.claimed++;
      // Versión objetivo: si la parcela ya avanzó de versión, el trabajo no se ejecuta ni se traslada.
      const cur = await sql<{ current_version_id: string | null }>`SELECT current_version_id FROM plots WHERE organization_id = ${j.organization_id} AND id = ${j.plot_id}`.execute(this.db);
      if (cur.rows[0]?.current_version_id !== j.plot_version_id) {
        if (await this.finish(j, 'SUPERSEDED_GEOMETRY', 'SUPERSEDED_GEOMETRY', null)) out.superseded++;
        continue;
      }
      const provider = this.byCode.get(j.provider_code);
      if (!provider) {
        if (await this.finish(j, 'PROVIDER_ERROR', 'PROVIDER_ADAPTER_NOT_REGISTERED', null)) out.failed++;
        continue;
      }
      // Envío incierto: se empezó a enviar al proveedor y nunca se supo su identificador. Reenviar podría duplicar el trabajo; se termina con un error explícito.
      if (j.provider_submit_started_at && !j.provider_job_ref) {
        if (await this.finish(j, 'PROVIDER_ERROR', 'PROVIDER_SUBMIT_UNCERTAIN', null)) out.failed++;
        continue;
      }
      const geom = await sql<{ geojson: string | null }>`
        SELECT ST_AsGeoJSON(geometry) AS geojson FROM plot_versions WHERE organization_id = ${j.organization_id} AND id = ${j.plot_version_id}`.execute(this.db);
      const raw = geom.rows[0]?.geojson;
      if (!raw) {
        if (await this.finish(j, 'GEOMETRY_UNSUPPORTED', 'GEOMETRY_MISSING', null)) out.failed++;
        continue;
      }
      const prov = await this.db.selectFrom('satellite_providers').select(['allowed_hosts', 'kind']).where('code', '=', j.provider_code).executeTakeFirst();
      let credential: string | null = null;
      if (prov?.kind === 'EXTERNAL_HTTP' && this.deps.cipher) {
        const row = await this.db.selectFrom('satellite_credentials').select('secret_ciphertext')
          .where('organization_id', '=', j.requesting_organization_id).where('provider_code', '=', j.provider_code).executeTakeFirst();
        // La credencial es la de la organización que SOLICITA el servicio (puede no ser la propietaria de la parcela).
        if (row) credential = this.deps.cipher.decrypt(row.secret_ciphertext, `satellite_credentials:${j.requesting_organization_id}:${j.provider_code}`);
      }

      let outcome: ProviderOutcome;
      try {
        outcome = await provider.analyze({
          operation: j.operation as AnalysisRequest['operation'],
          geometry: JSON.parse(raw), geometryType: j.geometry_type as AnalysisRequest['geometryType'], geometryHash: j.geometry_hash,
          periodStart: j.period_start, periodEnd: j.period_end, credential,
          allowedHosts: prov?.allowed_hosts ?? [], fixtureScenario: await this.fixtureScenario(j.organization_id, j.id),
          resumeJobRef: j.provider_job_ref, hooks: this.hooksFor(j),
        });
      } catch {
        // Un adapter que lanza es un fallo del proveedor; el mensaje crudo nunca se conserva.
        outcome = { kind: 'PROVIDER_ERROR', errorCode: 'ADAPTER_THREW', note: 'El adapter del proveedor falló.' };
      }

      if (outcome.kind === 'RESULT') {
        let key: string | null = null;
        let digest: string | null = null;
        if (outcome.result.raw && this.deps.store) {
          // El objeto lleva el arrendamiento de quien cierra: un corredor atrasado escribe OTRO objeto y no puede alterar los bytes de un resultado ya confirmado.
          key = `satellite/${j.organization_id}/${j.id}-${j.lease_token}.json`;
          digest = sha256(outcome.result.raw);
          await this.deps.store.put(key, outcome.result.raw, 'application/json');
        }
        if (await this.finish(j, 'RESULT_AVAILABLE', null, { ...outcome.result, rawKey: key, rawSha256: digest, isSynthetic: prov?.kind === 'SYNTHETIC_FIXTURE' })) out.completed++;
        continue;
      }
      const retryable = RETRYABLE.has(outcome.kind) && j.attempts < this.opts.maxAttempts && !NON_RETRYABLE_CODES.has(outcome.errorCode);
      if (retryable) {
        const delay = Math.min(this.opts.backoffBaseMs * 2 ** (j.attempts - 1), 15 * 60_000);
        const r = await this.db.updateTable('satellite_jobs')
          .set({ status: 'REQUESTED', locked_by: null, locked_until: null, lease_token: null, last_error_code: outcome.errorCode, next_attempt_at: new Date(Date.now() + delay) })
          .where('id', '=', j.id).where('lease_token', '=', j.lease_token).executeTakeFirst();
        if (Number(r.numUpdatedRows) === 1) out.retried++;
        continue;
      }
      if (await this.finish(j, outcome.kind, outcome.errorCode, null)) out.failed++;
    }
    return out;
  }

  /** Cierre con comprobación de arrendamiento: un corredor que perdió el suyo no escribe el desenlace. */
  private async finish(
    j: { id: string; organization_id: string; plot_id: string; plot_version_id: string; provider_code: string; lease_token: string },
    outcome: SatelliteOutcome,
    errorCode: string | null,
    result: null | { dataset: string | null; datasetVersion: string | null; analysisDate: Date | null; resolutionM: string | null; method: string | null; coverageStatus: 'COVERED' | 'PARTIAL' | 'NOT_COVERED' | 'UNKNOWN'; coverageNote: string; confidence: string | null; limitations: string; indicators: Record<string, unknown>; rawKey: string | null; rawSha256: string | null; isSynthetic: boolean },
  ): Promise<boolean> {
    return await this.db.transaction().execute(async (trx) => {
      const r = await trx.updateTable('satellite_jobs')
        .set({ status: outcome === 'RESULT_AVAILABLE' ? 'COMPLETED' : outcome === 'CANCELLED' ? 'CANCELLED' : 'FAILED', outcome, finished_at: new Date(), last_error_code: errorCode, locked_by: null, locked_until: null, lease_token: null })
        .where('id', '=', j.id).where('lease_token', '=', j.lease_token).executeTakeFirst();
      if (Number(r.numUpdatedRows) !== 1) return false;
      if (result) {
        await trx.insertInto('satellite_results').values({
          id: randomUUID(), organization_id: j.organization_id, job_id: j.id, provider_code: j.provider_code,
          is_synthetic: result.isSynthetic, dataset: result.dataset, dataset_version: result.datasetVersion,
          analysis_date: result.analysisDate, resolution_m: result.resolutionM, method: result.method,
          coverage_status: result.coverageStatus, coverage_note: result.coverageNote, confidence: result.confidence,
          limitations: result.limitations, indicators: JSON.stringify(result.indicators),
          raw_object_key: result.rawKey, raw_sha256: result.rawSha256,
        }).execute();
      }
      const events = this.deps.events ?? new EventStore([]);
      await events.append(trx, {
        organizationId: j.organization_id,
        eventType: outcome === 'RESULT_AVAILABLE' ? 'SatelliteAnalysisCompleted' : 'SatelliteAnalysisFailed',
        schemaVersion: 1, aggregateType: 'SATELLITE_JOB', aggregateId: j.id, aggregateVersion: 2, actorId: null,
        payload: { job_id: j.id, plot_id: j.plot_id, plot_version_id: j.plot_version_id, provider_code: j.provider_code, outcome, error_code: errorCode, is_synthetic: result?.isSynthetic ?? null },
      });
      return true;
    });
  }

  async start(pollMs: number, onError: (err: unknown) => void = () => undefined): Promise<void> {
    while (!this.stopped) {
      try {
        const r = await this.runOnce();
        if (r.claimed > 0) continue;
      } catch (err) {
        onError(err);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  stop(): void {
    this.stopped = true;
  }
}

/**
 * Adapters registrados.
 * - **Whisp** siempre está registrado (D-09 parte A: adaptador de desarrollo), pero con las llamadas reales
 *   gobernadas por un interruptor explícito, `SATELLITE_LIVE_CALLS=enabled`. Registrarlo sin ese interruptor es
 *   deliberado: así un trabajo termina diciendo `LIVE_CALLS_DISABLED` —un desenlace explícito y no favorable— en vez
 *   de «adapter no registrado», que confundiría una decisión pendiente con una avería.
 * - La **fixture sintética** solo con `SATELLITE_FIXTURE_ENABLED=true`.
 */
export function registeredProviders(env: NodeJS.ProcessEnv = process.env): SatelliteProviderPort[] {
  const list: SatelliteProviderPort[] = [new WhispSatelliteProvider({ liveCalls: liveCallsEnabled(env) })];
  if (env.SATELLITE_FIXTURE_ENABLED === 'true') list.push(new FixtureSatelliteProvider());
  return list;
}

/** Interruptor explícito de llamadas reales. Seleccionar un proveedor o tener credencial NO lo activa. */
export const liveCallsEnabled = (env: NodeJS.ProcessEnv = process.env) => env.SATELLITE_LIVE_CALLS === 'enabled';
