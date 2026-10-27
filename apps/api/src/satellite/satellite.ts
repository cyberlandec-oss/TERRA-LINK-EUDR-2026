import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsUUID, Length } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database, SatelliteOperation } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { PlotsService } from '../plots/plots';
import { ADAPTER_CONTRACT_VERSION, FIXTURE_SCENARIOS, OPERATIONS, requestFingerprint, type FixtureScenario } from './provider';
import { liveCallsEnabled } from './runner';
import { DEVELOPMENT_ONLY_NOTE } from './whisp';

// P0-028 Primer proveedor satelital (RF-28, QA-15). Contrato: docs/decisiones/P0-028-SATELITE.md.
//
// Qué hace esta historia y qué NO hace:
// - Encarga un análisis a un proveedor SUSTITUIBLE sobre una VERSIÓN de parcela y conserva su procedencia.
// - NO calcula deforestación, NO concluye nada y NO convierte el resultado de un tercero en verdad legal (S1 §41).
// - La petición HTTP devuelve ACEPTACIÓN, nunca el resultado: el análisis lo ejecuta el worker (S1 §54).
// - Hoy NO hay proveedor seleccionado (D-09): encargar un análisis real responde 409 y no se envía ninguna
//   coordenada a ningún tercero. La fixture sintética solo existe con el interruptor de desarrollo/prueba.
// - Clasificación de coordenadas: encargar un análisis SACA la geometría exacta del equipo, así que exige
//   `plot:read_geometry` además de `satellite:request` y del alcance de la parcela.

export const SATELLITE_READ = 'satellite:read';
export const SATELLITE_REQUEST = 'satellite:request';

/** Interruptor de desarrollo/prueba: habilita la fixture sintética. Nunca debe estar activo en producción. */
export const satelliteFixtureEnabled = (env: NodeJS.ProcessEnv = process.env) => env.SATELLITE_FIXTURE_ENABLED === 'true';

export class RequestAnalysisDto {
  @ApiProperty({ description: 'Identificador de la operación (idempotencia).' })
  @IsUUID()
  operation_id!: string;

  @ApiProperty({ enum: OPERATIONS as unknown as string[], description: 'Operación de S1 §40.' })
  @IsIn(OPERATIONS as unknown as string[])
  operation!: SatelliteOperation;

  @ApiPropertyOptional({ description: 'Inicio del periodo de análisis (AAAA-MM-DD).' })
  @IsOptional()
  @IsISO8601()
  period_start?: string;

  @ApiPropertyOptional({ description: 'Fin del periodo de análisis (AAAA-MM-DD).' })
  @IsOptional()
  @IsISO8601()
  period_end?: string;

  @ApiPropertyOptional({ description: 'Versión de parcela; por omisión, la vigente.' })
  @IsOptional()
  @IsUUID()
  plot_version_id?: string;

  @ApiPropertyOptional({ enum: FIXTURE_SCENARIOS as unknown as string[], description: 'SOLO fixture sintética de desarrollo/prueba. Ignorado por cualquier proveedor real.' })
  @IsOptional()
  @IsIn(FIXTURE_SCENARIOS as unknown as string[])
  fixture_scenario?: FixtureScenario;
}

export class CancelAnalysisDto {
  @ApiProperty()
  @IsUUID()
  operation_id!: string;

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Length(3, 500)
  reason!: string;
}

type Db = Kysely<Database> | Transaction<Database>;

/** Lectura legible de cada desenlace: ninguno es favorable (contrato §4). */
export const OUTCOME_NOTES: Record<string, string> = {
  RESULT_AVAILABLE: 'Resultado disponible con su procedencia. Es un insumo con límites declarados, no una conclusión.',
  NO_PROVIDER_SELECTED: 'No hay proveedor satelital seleccionado (D-09): no evaluable.',
  LIVE_CALLS_DISABLED: 'Las llamadas reales al proveedor estan deshabilitadas por configuracion (D-09 parte B pendiente): no evaluable. No se envio ninguna geometria.',
  NO_COVERAGE: 'El proveedor no cubre esta geometría o este periodo: no evaluable. «Sin alertas» no equivale a «sin deforestación».',
  TIMEOUT: 'El proveedor no respondió dentro del plazo: no evaluable.',
  RATE_LIMITED: 'Cupo del proveedor agotado: no evaluable.',
  PROVIDER_ERROR: 'El proveedor falló o respondió fuera de contrato: no evaluable.',
  EGRESS_BLOCKED: 'El destino no superó la defensa de salida: no evaluable, y queda registrado como incidente de seguridad.',
  GEOMETRY_UNSUPPORTED: 'La versión de parcela no tiene geometría analizable: no evaluable.',
  SUPERSEDED_GEOMETRY: 'La parcela cambió de versión geométrica antes de terminar: el resultado no se traslada a la versión nueva.',
  CANCELLED: 'Cancelado por la organización: sin resultado.',
};

@Injectable()
export class SatelliteService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly plots: PlotsService,
  ) {}

  private async ctxFor(user: AuthUser, orgId: string, perm: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!ctx.permissions.includes(perm as never)) throw forbidden();
    return ctx;
  }

  /** Registro de proveedores: qué se propuso, con qué licencia, coste, cobertura y qué datos saldrían del equipo. */
  async providers(user: AuthUser, orgId: string) {
    await this.ctxFor(user, orgId, SATELLITE_READ);
    const rows = await this.db.selectFrom('satellite_providers').selectAll().orderBy('selection_status').orderBy('code').execute();
    const selected = rows.find((r) => r.selection_status === 'SELECTED') ?? null;
    const development = rows.find((r) => r.selection_status === 'SELECTED_FOR_DEVELOPMENT') ?? null;
    return {
      selection: selected
        ? { status: 'SELECTED', provider_code: selected.code, decision_reference: selected.decision_reference, live_calls_enabled: liveCallsEnabled() }
        : development
          ? { status: 'SELECTED_FOR_DEVELOPMENT', provider_code: development.code, decision: 'D-09 parte A', decision_reference: development.decision_reference, note: DEVELOPMENT_ONLY_NOTE, live_calls_enabled: liveCallsEnabled() }
          : { status: 'NOT_SELECTED', decision: 'D-09', note: 'Ningún proveedor satelital está seleccionado. Sin esa decisión no se envía ninguna coordenada a un tercero y el análisis de deforestación no es evaluable.' },
      adapter_contract_version: ADAPTER_CONTRACT_VERSION,
      fixture_enabled: satelliteFixtureEnabled(),
      live_calls_enabled: liveCallsEnabled(),
      providers: rows.map((r) => ({
        code: r.code, name: r.name, kind: r.kind, selection_status: r.selection_status,
        supported_operations: r.supported_operations,
        allowed_hosts: r.allowed_hosts, docs_url: r.docs_url, license: r.license, cost: r.cost_note,
        coverage: r.coverage_note, limits: r.limits_note, data_sent_outside: r.data_sent_note, source: r.source,
      })),
      limits: ['El registro documenta candidatos; no acredita contrato, cobertura real ni coste vigente.',
        'Una fixture sintética nunca puede ser el proveedor seleccionado ni satisfacer un requisito.'],
    };
  }

  /**
   * Proveedor efectivo para encargar un análisis, y por qué no lo hay cuando no lo hay. Las dos aprobaciones de D-09
   * son estados distintos y la pantalla dice cuál falta:
   * - `SELECTED` (parte B) + interruptor de llamadas reales → se puede encargar;
   * - `SELECTED` sin el interruptor → no se encarga, y se dice que falta la configuración;
   * - `SELECTED_FOR_DEVELOPMENT` (parte A) → el adaptador existe, pero su uso real no está autorizado;
   * - ninguno → D-09 sin decidir. La fixture sintética solo entra con su propio interruptor.
   */
  private async effectiveProvider(db: Db) {
    const selected = await db.selectFrom('satellite_providers').selectAll().where('selection_status', '=', 'SELECTED').executeTakeFirst();
    if (selected) {
      return liveCallsEnabled()
        ? { provider: selected, blocked: null as string | null }
        : { provider: undefined, blocked: `Las llamadas reales al proveedor ${selected.code} están deshabilitadas por configuración (D-09 parte B).` };
    }
    if (satelliteFixtureEnabled()) {
      const fixture = await db.selectFrom('satellite_providers').selectAll().where('code', '=', 'FIXTURE_SYNTHETIC').executeTakeFirst();
      if (fixture) return { provider: fixture, blocked: null as string | null };
    }
    const dev = await db.selectFrom('satellite_providers').selectAll().where('selection_status', '=', 'SELECTED_FOR_DEVELOPMENT').executeTakeFirst();
    if (dev) return { provider: undefined, blocked: dev.code === 'WHISP' ? DEVELOPMENT_ONLY_NOTE : `${dev.code} está seleccionado solo como adaptador de desarrollo (D-09 parte A).` };
    return { provider: undefined, blocked: null as string | null };
  }

  async request(user: AuthUser, orgId: string, plotId: string, dto: RequestAnalysisDto, requestId?: string) {
    const ctx = await this.ctxFor(user, orgId, SATELLITE_REQUEST);
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    // Encargar un análisis saca las coordenadas exactas del equipo: exige el permiso que las clasifica.
    if (!this.plots.has(ctx, 'plot:read_geometry')) {
      throw forbidden('PERMISSION_DENIED', 'Encargar un análisis envía la geometría exacta de la parcela fuera del equipo: requiere plot:read_geometry.');
    }
    const plot = await this.plots.load(this.db, ctx, plotId, 'read');

    const prior = await this.db.selectFrom('satellite_jobs').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.plot_id !== plotId || prior.operation !== dto.operation) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó en otro encargo.');
      return { replayed: true, job: await this.jobView(this.db, ctx, prior.id) };
    }

    const { provider, blocked } = await this.effectiveProvider(this.db);
    if (!provider) {
      const code = blocked ? 'SATELLITE_REQUESTS_NOT_AUTHORIZED' : 'SATELLITE_PROVIDER_NOT_SELECTED';
      await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'satellite.request', entityType: 'plot', entityId: plotId, requestId, result: 'FAILED', reason: code });
      throw conflict(code, blocked ?? 'No hay proveedor satelital seleccionado (D-09). No se encarga ningún análisis ni sale ninguna coordenada del equipo.');
    }
    if (!provider.supported_operations.includes(dto.operation)) {
      throw new AppError(422, 'SATELLITE_OPERATION_NOT_SUPPORTED', `El proveedor ${provider.code} no declara soportar la operación ${dto.operation}.`);
    }
    if (dto.fixture_scenario && provider.kind !== 'SYNTHETIC_FIXTURE') {
      throw new AppError(422, 'FIXTURE_SCENARIO_NOT_APPLICABLE', 'El escenario de fixture solo aplica a la fixture sintética.');
    }

    const versionId = dto.plot_version_id ?? plot.current_version_id;
    if (!versionId) throw new AppError(422, 'PLOT_WITHOUT_VERSION', 'La parcela no tiene versiones geométricas.');
    const version = await this.db.selectFrom('plot_versions').select(['id', 'geometry_hash', 'geometry_type'])
      .where('organization_id', '=', orgId).where('plot_id', '=', plotId).where('id', '=', versionId).executeTakeFirst();
    if (!version) throw notFound();
    if (!version.geometry_hash || !version.geometry_type) {
      throw new AppError(422, 'GEOMETRY_UNSUPPORTED', 'Esa versión de la parcela no tiene geometría: no hay nada que analizar. La superficie declarada no la sustituye.');
    }
    if (dto.period_start && dto.period_end && dto.period_start > dto.period_end) {
      throw new AppError(422, 'PERIOD_INVALID', 'El fin del periodo de análisis es anterior a su inicio.');
    }

    const id = randomUUID();
    const fingerprint = requestFingerprint({
      providerCode: provider.code, operation: dto.operation, geometryHash: version.geometry_hash,
      periodStart: dto.period_start ?? null, periodEnd: dto.period_end ?? null,
    });
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('satellite_jobs').values({
        id, organization_id: orgId, plot_id: plotId, plot_version_id: version.id, geometry_hash: version.geometry_hash!,
        geometry_type: version.geometry_type as 'POINT' | 'POLYGON' | 'MULTIPOLYGON', provider_code: provider.code,
        provider_kind: provider.kind, adapter_contract_version: ADAPTER_CONTRACT_VERSION, operation: dto.operation,
        period_start: dto.period_start ?? null, period_end: dto.period_end ?? null, request_fingerprint: fingerprint,
        status: 'REQUESTED', outcome: null, requested_by: user.id, operation_id: dto.operation_id,
      }).execute();
      // El escenario de fixture no se persiste en el trabajo: viaja al corredor por el evento, y solo la fixture lo usa.
      await this.events.append(trx, {
        organizationId: orgId, eventType: 'SatelliteAnalysisRequested', schemaVersion: 1, aggregateType: 'SATELLITE_JOB',
        aggregateId: id, aggregateVersion: 1, actorId: user.id, operationId: dto.operation_id,
        payload: {
          job_id: id, plot_id: plotId, plot_version_id: version.id, geometry_hash: version.geometry_hash,
          provider_code: provider.code, provider_kind: provider.kind, operation: dto.operation,
          fixture_scenario: dto.fixture_scenario ?? null,
        },
      });
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'satellite.request', entityType: 'satellite_job', entityId: id,
        requestId, result: 'SUCCESS', after: { plot_id: plotId, plot_version_id: version.id, provider_code: provider.code, operation: dto.operation },
      });
    });
    return { replayed: false, job: await this.jobView(this.db, ctx, id) };
  }

  async cancel(user: AuthUser, orgId: string, jobId: string, dto: CancelAnalysisDto, requestId?: string) {
    const ctx = await this.ctxFor(user, orgId, SATELLITE_REQUEST);
    const job = await this.db.selectFrom('satellite_jobs').selectAll().where('organization_id', '=', orgId).where('id', '=', jobId).executeTakeFirst();
    if (!job) throw notFound();
    await this.plots.load(this.db, ctx, job.plot_id, 'read');
    if (job.status !== 'REQUESTED') throw conflict('SATELLITE_JOB_NOT_CANCELLABLE', `El trabajo está en estado ${job.status}: ya no se cancela.`);
    await this.db.transaction().execute(async (trx) => {
      const r = await trx.updateTable('satellite_jobs')
        .set({ status: 'CANCELLED', outcome: 'CANCELLED', finished_at: new Date(), last_error_code: 'CANCELLED_BY_ORGANIZATION' })
        .where('id', '=', jobId).where('status', '=', 'REQUESTED').executeTakeFirst();
      if (Number(r.numUpdatedRows) !== 1) throw conflict('SATELLITE_JOB_NOT_CANCELLABLE', 'El trabajo cambió de estado durante la cancelación.');
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'satellite.cancel', entityType: 'satellite_job', entityId: jobId, requestId, result: 'SUCCESS', reason: dto.reason });
    });
    return await this.jobView(this.db, ctx, jobId);
  }

  /** S1 §52 `GET /plots/{id}/satellite`: estado del análisis de una parcela, con sus límites escritos. */
  async forPlot(user: AuthUser, orgId: string, plotId: string) {
    const ctx = await this.ctxFor(user, orgId, SATELLITE_READ);
    const plot = await this.plots.load(this.db, ctx, plotId, 'read');
    const jobs = await this.db.selectFrom('satellite_jobs').selectAll()
      .where('organization_id', '=', orgId).where('plot_id', '=', plotId).orderBy('requested_at', 'desc').limit(50).execute();
    const { provider, blocked: providerBlocked } = await this.effectiveProvider(this.db);
    // La pantalla informa del estado REAL del registro, no solo de si se puede encargar: un adaptador seleccionado
    // para desarrollo no es «ningún proveedor seleccionado», y decirlo así sería engañoso en los dos sentidos.
    const development = await this.db.selectFrom('satellite_providers').select(['code', 'decision_reference'])
      .where('selection_status', '=', 'SELECTED_FOR_DEVELOPMENT').executeTakeFirst();
    const views = [];
    for (const j of jobs) views.push(await this.jobView(this.db, ctx, j.id));
    const applicable = views.find((v) => v.outcome === 'RESULT_AVAILABLE' && v.applies_to_current_version && !v.result?.is_synthetic) ?? null;
    // La pantalla no ofrece un botón que el servidor va a rechazar: dice por qué no se puede encargar.
    const selected = provider?.selection_status === 'SELECTED';
    const blocked = !ctx.permissions.includes(SATELLITE_REQUEST as never) ? 'Tu rol no encarga análisis satelitales.'
      : !this.plots.has(ctx, 'plot:read_geometry') ? 'Encargar un análisis envía la geometría exacta fuera del equipo: requiere acceso a coordenadas.'
      : ctx.organizationStatus !== 'ACTIVE' ? 'La organización está suspendida; no admite nuevas operaciones.'
      : !provider ? (providerBlocked ?? 'No hay proveedor satelital seleccionado (D-09).')
      : !plot.current_version_id ? 'La parcela no tiene versión geométrica que analizar.'
      : null;
    return {
      plot: { id: plot.id, plot_code: plot.plot_code, current_version_id: plot.current_version_id },
      can_request: blocked === null,
      request_blocked_reason: blocked,
      // El selector de escenarios solo existe con la fixture (ENSAYO); con un proveedor real no hay nada que elegir.
      provider_kind: provider?.kind ?? null,
      ensayo_mode: provider?.kind === 'SYNTHETIC_FIXTURE',
      fixture_scenarios: provider?.kind === 'SYNTHETIC_FIXTURE' ? [...FIXTURE_SCENARIOS] : [],
      provider_selection: selected
        ? { status: 'SELECTED', provider_code: provider!.code }
        : development
          ? { status: 'SELECTED_FOR_DEVELOPMENT', provider_code: development.code, decision: 'D-09 parte A', note: providerBlocked ?? DEVELOPMENT_ONLY_NOTE }
          : { status: 'NOT_SELECTED', decision: 'D-09', note: providerBlocked ?? OUTCOME_NOTES.NO_PROVIDER_SELECTED },
      analysis_status: applicable ? 'RESULT_AVAILABLE' : views.some((v) => v.status === 'REQUESTED' || v.status === 'RUNNING') ? 'IN_PROGRESS' : 'NOT_EVALUATED',
      jobs: views,
      limits: [
        'El resultado de un proveedor externo no es una conclusión jurídica (S1 §41).',
        '«Sin alertas» no equivale a «sin deforestación» cuando no hay cobertura suficiente (docs/10).',
        'Un resultado solo es aplicable a la versión geométrica con la que se pidió.',
        'Los resultados de fixture sintética no acreditan nada y no satisfacen ningún requisito.',
      ],
    };
  }

  async job(user: AuthUser, orgId: string, jobId: string) {
    const ctx = await this.ctxFor(user, orgId, SATELLITE_READ);
    const job = await this.db.selectFrom('satellite_jobs').select(['id', 'plot_id']).where('organization_id', '=', orgId).where('id', '=', jobId).executeTakeFirst();
    if (!job) throw notFound();
    await this.plots.load(this.db, ctx, job.plot_id, 'read');
    return await this.jobView(this.db, ctx, jobId);
  }

  /** Vista de un trabajo con su procedencia completa. Nunca devuelve coordenadas ni credenciales. */
  private async jobView(db: Db, ctx: TenantContext, jobId: string) {
    const j = await db.selectFrom('satellite_jobs').selectAll().where('organization_id', '=', ctx.organizationId).where('id', '=', jobId).executeTakeFirstOrThrow();
    const result = await db.selectFrom('satellite_results').selectAll().where('organization_id', '=', ctx.organizationId).where('job_id', '=', jobId).executeTakeFirst();
    const current = await sql<{ current_version_id: string | null }>`SELECT current_version_id FROM plots WHERE organization_id = ${ctx.organizationId} AND id = ${j.plot_id}`.execute(db);
    return {
      id: j.id,
      plot_id: j.plot_id,
      subject: { plot_version_id: j.plot_version_id, geometry_hash: j.geometry_hash, geometry_type: j.geometry_type },
      applies_to_current_version: current.rows[0]?.current_version_id === j.plot_version_id,
      provider: { code: j.provider_code, kind: j.provider_kind, adapter_contract_version: j.adapter_contract_version },
      // ENSAYO: lo produjo la fixture sintética. Se identifica y se separa de lo operativo (no acredita nada).
      is_ensayo: j.provider_kind === 'SYNTHETIC_FIXTURE',
      operation: j.operation,
      period: { start: j.period_start, end: j.period_end },
      request_fingerprint: j.request_fingerprint,
      status: j.status,
      outcome: j.outcome,
      outcome_note: j.outcome ? OUTCOME_NOTES[j.outcome] : 'Encargo aceptado; el análisis se ejecuta fuera de esta petición (S1 §54).',
      attempts: j.attempts,
      error_code: j.last_error_code,
      requested_at: j.requested_at,
      finished_at: j.finished_at,
      result: result
        ? {
            is_synthetic: result.is_synthetic,
            synthetic_warning: result.is_synthetic ? 'FIXTURE SINTÉTICA: no es análisis satelital real y no acredita nada.' : null,
            provenance: {
              provider_code: result.provider_code, dataset: result.dataset, dataset_version: result.dataset_version,
              analysis_date: result.analysis_date, resolution_m: result.resolution_m, method: result.method,
            },
            coverage: { status: result.coverage_status, note: result.coverage_note },
            confidence: result.confidence,
            confidence_note: result.confidence === null ? 'El proveedor no define confianza para este resultado; no se infiere.' : null,
            limitations: result.limitations,
            indicators: result.indicators,
            // La respuesta original se ACREDITA por su huella, no por su ruta de almacenamiento. Ningún otro módulo
            // devuelve `object_key` (los documentos exponen su SHA-256 y su versión, no la clave), y publicarla
            // revelaría la estructura interna del almacén privado.
            raw_evidence: result.raw_object_key ? { stored: true, sha256: result.raw_sha256 } : null,
            conclusion: result.conclusion,
            conclusion_note: 'NOT_EVALUATED: el resultado de un proveedor externo no se convierte en conclusión regulatoria (S1 §41).',
          }
        : null,
    };
  }
}

@ApiTags('satellite')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class SatelliteController {
  constructor(private readonly service: SatelliteService) {}

  @Get('satellite/providers')
  providers(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.providers(user, orgId);
  }

  @Get('plots/:plotId/satellite')
  forPlot(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('plotId', ParseUUIDPipe) plotId: string) {
    return this.service.forPlot(user, orgId, plotId);
  }

  @Post('plots/:plotId/satellite/analyses')
  request(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('plotId', ParseUUIDPipe) plotId: string, @Body() dto: RequestAnalysisDto, @Req() req: AuthedRequest) {
    return this.service.request(user, orgId, plotId, dto, req.requestId);
  }

  @Get('satellite/analyses/:jobId')
  job(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.service.job(user, orgId, jobId);
  }

  @Post('satellite/analyses/:jobId/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Body() dto: CancelAnalysisDto, @Req() req: AuthedRequest) {
    return this.service.cancel(user, orgId, jobId, dto, req.requestId);
  }
}
