import { Body, Controller, Delete, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, MaxLength, MinLength } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database, SatelliteOperation } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { PlotsService } from '../plots/plots';
import { PII_CIPHER, type PiiCipher } from '../crypto/pii';
import { OBJECT_STORE, sha256, type ObjectStore } from '../storage/object-store';
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

export const SATELLITE_AUTHORIZE = 'satellite:authorize';
/** Tope PROVISIONAL del vencimiento de una autorización entre organizaciones (no existe «indefinida»); cifra por confirmar con el propietario del producto. */
export const MAX_AUTHORIZATION_DAYS = 180;

export class AuthorizeAnalysisDto {
  @ApiProperty({ description: 'Identificador de la operación (idempotencia).' })
  @IsUUID()
  operation_id!: string;

  @ApiProperty({ description: 'Organización que podrá encargar el análisis de ESTA parcela.' })
  @IsUUID()
  grantee_organization_id!: string;

  @ApiPropertyOptional({ description: 'Permite descargar la respuesta original (contiene la geometría enviada). Por omisión, no.' })
  @IsOptional()
  @IsBoolean()
  can_download?: boolean;

  @ApiProperty({ description: 'Vencimiento obligatorio (ISO 8601); máximo 180 días.' })
  @IsISO8601()
  expires_at!: string;

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Length(3, 500)
  reason!: string;
}

export class RevokeAuthorizationDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Length(3, 500)
  reason!: string;
}

export class SetCredentialDto {
  @ApiProperty({ description: 'Clave de API del proveedor. Se cifra al guardarla y nunca se devuelve.' })
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  secret!: string;
}

/** Whisp no recibe fechas: pedir un periodo se rechaza en vez de presentarlo como un filtro que no se aplicó. */
export function periodRejection(providerCode: string, periodStart?: string | null, periodEnd?: string | null): AppError | null {
  if (providerCode === 'WHISP' && (periodStart || periodEnd)) {
    return new AppError(422, 'PERIOD_NOT_SUPPORTED_BY_PROVIDER', 'Whisp no admite un periodo de análisis: aplica su propia metodología y fecha de corte. Encarga el análisis sin periodo.');
  }
  return null;
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
    @Inject(PII_CIPHER) private readonly cipher: PiiCipher,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
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
    return this.submit(user, orgId, plot, orgId, null, dto, requestId, true);
  }

  /**
   * Núcleo común del encargo: la organización propietaria encarga el de sus parcelas, o una exportadora el de una parcela que se le autorizó.
   * El trabajo vive SIEMPRE en el tenant de la parcela; `requestingOrgId` es quien solicita (su credencial se usa) y `authorizationId`, la autorización vigente.
   */
  private async submit(user: AuthUser, orgId: string, plot: { id: string; current_version_id: string | null }, requestingOrgId: string, authorizationId: string | null, dto: RequestAnalysisDto, requestId: string | undefined, canDownloadRaw: boolean) {
    const plotId = plot.id;
    const prior = await this.db.selectFrom('satellite_jobs').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.plot_id !== plotId || prior.operation !== dto.operation || prior.requesting_organization_id !== requestingOrgId) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó en otro encargo.');
      return { replayed: true, job: await this.jobView(this.db, orgId, prior.id, canDownloadRaw) };
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
    // El periodo es contexto local: Whisp no recibe fechas (su análisis tiene su propia metodología y corte). Aceptarlo en silencio lo presentaría como un filtro que no se aplicó.
    const periodo = periodRejection(provider.code, dto.period_start, dto.period_end);
    if (periodo) throw periodo;
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
        requesting_organization_id: requestingOrgId, authorization_id: authorizationId,
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
        requestId, result: 'SUCCESS', after: { plot_id: plotId, plot_version_id: version.id, geometry_hash: version.geometry_hash, provider_code: provider.code, operation: dto.operation, requesting_organization_id: requestingOrgId, authorization_id: authorizationId },
      });
      // Una solicitud de otra organización queda también en SU registro de auditoría (quien analiza deja rastro propio).
      if (requestingOrgId !== orgId) {
        await this.audit.record(trx, {
          organizationId: requestingOrgId, actorUserId: user.id, action: 'satellite.request_authorized_plot', entityType: 'satellite_job', entityId: id,
          requestId, result: 'SUCCESS', after: { owner_organization_id: orgId, plot_id: plotId, plot_version_id: version.id, geometry_hash: version.geometry_hash, authorization_id: authorizationId },
        });
      }
    });
    return { replayed: false, job: await this.jobView(this.db, orgId, id, canDownloadRaw) };
  }

  async cancel(user: AuthUser, orgId: string, jobId: string, dto: CancelAnalysisDto, requestId?: string) {
    const ctx = await this.ctxFor(user, orgId, SATELLITE_REQUEST);
    const job = await this.db.selectFrom('satellite_jobs').selectAll().where('organization_id', '=', orgId).where('id', '=', jobId).executeTakeFirst();
    // La propietaria no cancela el encargo de otra organización por esta vía: para cortarlo revoca la autorización (que lo cancela).
    if (!job || job.requesting_organization_id !== orgId) throw notFound();
    await this.plots.load(this.db, ctx, job.plot_id, 'read');
    return this.cancelJob(user, orgId, job, dto, requestId, true);
  }

  private async cancelJob(user: AuthUser, orgId: string, job: { id: string; status: string; cancel_requested_at: Date | null }, dto: CancelAnalysisDto, requestId: string | undefined, canDownloadRaw: boolean) {
    const jobId = job.id;
    // Un trabajo YA INICIADO no se detiene a la fuerza desde la petición: se registra la petición y el corredor la atiende en su siguiente consulta,
    // cancelando también el trabajo en el proveedor. Hasta entonces el trabajo sigue «En proceso» con la cancelación pedida a la vista.
    if (job.status === 'RUNNING') {
      if (!job.cancel_requested_at) {
        await this.db.transaction().execute(async (trx) => {
          const r = await trx.updateTable('satellite_jobs')
            .set({ cancel_requested_at: new Date(), cancel_requested_by: user.id, cancel_reason: dto.reason })
            .where('id', '=', jobId).where('status', '=', 'RUNNING').where('cancel_requested_at', 'is', null).executeTakeFirst();
          if (Number(r.numUpdatedRows) !== 1) return;
          await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'satellite.cancel_requested', entityType: 'satellite_job', entityId: jobId, requestId, result: 'SUCCESS', reason: dto.reason });
        });
      }
      return await this.jobView(this.db, orgId, jobId, canDownloadRaw);
    }
    if (job.status !== 'REQUESTED') throw conflict('SATELLITE_JOB_NOT_CANCELLABLE', `El trabajo está en estado ${job.status}: ya no se cancela.`);
    await this.db.transaction().execute(async (trx) => {
      const r = await trx.updateTable('satellite_jobs')
        .set({ status: 'CANCELLED', outcome: 'CANCELLED', finished_at: new Date(), last_error_code: 'CANCELLED_BY_ORGANIZATION' })
        .where('id', '=', jobId).where('status', '=', 'REQUESTED').executeTakeFirst();
      if (Number(r.numUpdatedRows) !== 1) throw conflict('SATELLITE_JOB_NOT_CANCELLABLE', 'El trabajo cambió de estado durante la cancelación.');
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'satellite.cancel', entityType: 'satellite_job', entityId: jobId, requestId, result: 'SUCCESS', reason: dto.reason });
    });
    return await this.jobView(this.db, orgId, jobId, canDownloadRaw);
  }

  // ------------------------------------------------------------------ credencial del proveedor por organización
  // La clave la registra quien administra las integraciones de la organización (`integration:manage`). Se CIFRA con el contexto
  // `satellite_credentials:{org}:{proveedor}` (la de otra organización no descifra con este contexto) y NUNCA se devuelve ni se audita su valor.

  private async externalProvider(code: string) {
    const p = await this.db.selectFrom('satellite_providers').select(['code', 'kind']).where('code', '=', code).executeTakeFirst();
    if (!p) throw notFound();
    if (p.kind !== 'EXTERNAL_HTTP') throw new AppError(422, 'PROVIDER_WITHOUT_CREDENTIAL', 'Ese proveedor no usa credencial: no es un servicio externo.');
    return p;
  }

  async credentials(user: AuthUser, orgId: string) {
    await this.authz.require(user, orgId, 'integration:read', { mutation: false });
    const providers = await this.db.selectFrom('satellite_providers').select(['code', 'name']).where('kind', '=', 'EXTERNAL_HTTP').orderBy('code').execute();
    const rows = await this.db.selectFrom('satellite_credentials').select(['provider_code', 'created_at', 'rotated_at']).where('organization_id', '=', orgId).execute();
    return {
      providers: providers.map((p) => {
        const c = rows.find((r) => r.provider_code === p.code);
        return { provider_code: p.code, name: p.name, configured: !!c, registered_at: c?.created_at ?? null, rotated_at: c?.rotated_at ?? null };
      }),
      note: 'La clave se guarda cifrada y no se vuelve a mostrar. Registrarla no activa llamadas reales: eso depende además del interruptor de la plataforma y de la selección del proveedor.',
    };
  }

  async setCredential(user: AuthUser, orgId: string, providerCode: string, dto: SetCredentialDto, requestId?: string) {
    await this.authz.require(user, orgId, 'integration:manage', { mutation: true });
    await this.externalProvider(providerCode);
    const cipher = this.cipher.encrypt(dto.secret.trim(), `satellite_credentials:${orgId}:${providerCode}`);
    await this.db.transaction().execute(async (trx) => {
      const prior = await trx.selectFrom('satellite_credentials').select('provider_code').where('organization_id', '=', orgId).where('provider_code', '=', providerCode).executeTakeFirst();
      if (prior) {
        await trx.updateTable('satellite_credentials').set({ secret_ciphertext: cipher, rotated_at: new Date() }).where('organization_id', '=', orgId).where('provider_code', '=', providerCode).execute();
      } else {
        await trx.insertInto('satellite_credentials').values({ organization_id: orgId, provider_code: providerCode, secret_ciphertext: cipher, created_by: user.id }).execute();
      }
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: prior ? 'satellite.credential_rotated' : 'satellite.credential_registered', entityType: 'satellite_credential', entityId: null, requestId, result: 'SUCCESS', after: { provider_code: providerCode } });
    });
    return await this.credentials(user, orgId);
  }

  async deleteCredential(user: AuthUser, orgId: string, providerCode: string, requestId?: string) {
    await this.authz.require(user, orgId, 'integration:manage', { mutation: true });
    await this.externalProvider(providerCode);
    await this.db.transaction().execute(async (trx) => {
      const r = await trx.deleteFrom('satellite_credentials').where('organization_id', '=', orgId).where('provider_code', '=', providerCode).executeTakeFirst();
      if (Number(r.numDeletedRows) === 1) await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'satellite.credential_removed', entityType: 'satellite_credential', entityId: null, requestId, result: 'SUCCESS', after: { provider_code: providerCode } });
    });
    return await this.credentials(user, orgId);
  }

  /**
   * Respuesta ORIGINAL del proveedor, tal como se guardó. Contiene la geometría enviada, así que exige el mismo permiso que clasifica las coordenadas
   * (`plot:read_geometry`) además de leer análisis y alcanzar la parcela. Se verifica su huella antes de entregarla: si no coincide, no se entrega.
   */
  async original(user: AuthUser, orgId: string, jobId: string, requestId?: string) {
    const ctx = await this.ctxFor(user, orgId, SATELLITE_READ);
    const job = await this.db.selectFrom('satellite_jobs').select(['id', 'plot_id']).where('organization_id', '=', orgId).where('id', '=', jobId).executeTakeFirst();
    if (!job) throw notFound();
    await this.plots.load(this.db, ctx, job.plot_id, 'read');
    if (!this.plots.has(ctx, 'plot:read_geometry')) throw forbidden('PERMISSION_DENIED', 'La respuesta original contiene la geometría enviada: requiere acceso a coordenadas (plot:read_geometry).');
    return this.rawBytes(user, orgId, orgId, jobId, requestId);
  }

  /** Entrega la respuesta original verificando su huella. La descarga se audita en la organización de quien descarga y en la propietaria. */
  private async rawBytes(user: AuthUser, ownerOrgId: string, actorOrgId: string, jobId: string, requestId?: string) {
    const r = await this.db.selectFrom('satellite_results').select(['raw_object_key', 'raw_sha256', 'is_synthetic']).where('organization_id', '=', ownerOrgId).where('job_id', '=', jobId).executeTakeFirst();
    if (!r || !r.raw_object_key || !r.raw_sha256) throw notFound();
    const bytes = await this.store.get(r.raw_object_key);
    const orgs = actorOrgId === ownerOrgId ? [ownerOrgId] : [actorOrgId, ownerOrgId];
    if (sha256(bytes) !== r.raw_sha256) {
      for (const o of orgs) await this.audit.record(this.db, { organizationId: o, actorUserId: user.id, action: 'satellite.original_download', entityType: 'satellite_job', entityId: jobId, requestId, result: 'FAILED', reason: 'INTEGRITY_MISMATCH' });
      throw new AppError(500, 'ORIGINAL_INTEGRITY_FAILED', 'La respuesta original guardada no coincide con su huella: no se entrega.');
    }
    for (const o of orgs) await this.audit.record(this.db, { organizationId: o, actorUserId: user.id, action: 'satellite.original_download', entityType: 'satellite_job', entityId: jobId, requestId, result: 'SUCCESS' });
    return { bytes, sha256: r.raw_sha256, isSynthetic: r.is_synthetic, name: `analisis-${jobId}${r.is_synthetic ? '-ENSAYO' : ''}.json` };
  }

  /**
   * Indicadores del resultado en CSV, con su procedencia en cada fila. NO contiene la geometría (es lo que se guardó como indicadores, no la respuesta original),
   * así que no exige `plot:read_geometry` ni la autorización de descarga: basta poder leer el análisis. Se audita. No interpreta los indicadores (D-07).
   */
  private async indicatorsCsv(user: AuthUser, ownerOrgId: string, actorOrgId: string, jobId: string, requestId?: string) {
    const j = await this.db.selectFrom('satellite_jobs as j').innerJoin('satellite_results as r', 'r.job_id', 'j.id')
      .select(['j.plot_version_id', 'j.geometry_hash', 'j.provider_code', 'r.dataset', 'r.dataset_version', 'r.analysis_date', 'r.is_synthetic', 'r.indicators', 'r.coverage_status'])
      .where('j.organization_id', '=', ownerOrgId).where('j.id', '=', jobId).executeTakeFirst();
    if (!j) throw notFound();
    const ind = (j.indicators && typeof j.indicators === 'object' ? j.indicators : {}) as Record<string, unknown>;
    const celda = (v: unknown) => {
      let t = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // evita que una hoja de cálculo ejecute el valor como fórmula
      return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const fijo = [j.provider_code, j.dataset, j.dataset_version, j.analysis_date instanceof Date ? j.analysis_date.toISOString() : j.analysis_date, j.coverage_status, j.plot_version_id, j.geometry_hash, j.is_synthetic ? 'SINTETICO' : 'REAL'];
    const lines = [['indicador', 'valor', 'proveedor', 'dataset', 'version_dataset', 'fecha_analisis', 'cobertura', 'version_parcela', 'huella_geometria', 'origen'].join(',')];
    for (const [k, v] of Object.entries(ind)) lines.push([celda(k), celda(v), ...fijo.map(celda)].join(','));
    const orgs = actorOrgId === ownerOrgId ? [ownerOrgId] : [actorOrgId, ownerOrgId];
    for (const o of orgs) await this.audit.record(this.db, { organizationId: o, actorUserId: user.id, action: 'satellite.indicators_download', entityType: 'satellite_job', entityId: jobId, requestId, result: 'SUCCESS' });
    return { text: lines.join('\r\n') + '\r\n', name: `indicadores-${jobId}${j.is_synthetic ? '-ENSAYO' : ''}.csv` };
  }

  async indicators(user: AuthUser, orgId: string, jobId: string, requestId?: string) {
    const ctx = await this.ctxFor(user, orgId, SATELLITE_READ);
    const job = await this.db.selectFrom('satellite_jobs').select(['id', 'plot_id']).where('organization_id', '=', orgId).where('id', '=', jobId).executeTakeFirst();
    if (!job) throw notFound();
    await this.plots.load(this.db, ctx, job.plot_id, 'read');
    return this.indicatorsCsv(user, orgId, orgId, jobId, requestId);
  }

  async indicatorsAuthorized(user: AuthUser, orgId: string, jobId: string, requestId?: string) {
    await this.ctxFor(user, orgId, SATELLITE_READ);
    const j = await this.authorizedJobRow(orgId, jobId);
    return this.indicatorsCsv(user, j.organization_id, orgId, jobId, requestId);
  }

  // ------------------------------------------------------------------ autorización entre organizaciones
  // La PROPIETARIA autoriza parcelas concretas a otra organización (acto explícito, vencido y revocable). La destinataria encarga, sigue, cancela y descarga
  // ÚNICAMENTE por estas rutas: no lee la parcela, su geometría ni su productor, y la autorización no le concede ninguna otra facultad.

  async authorize(user: AuthUser, orgId: string, plotId: string, dto: AuthorizeAnalysisDto, requestId?: string) {
    const ctx = await this.ctxFor(user, orgId, SATELLITE_AUTHORIZE);
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    const plot = await this.plots.load(this.db, ctx, plotId, 'read');
    if (plot.deleted_at || plot.status !== 'ACTIVE') throw new AppError(422, 'PLOT_NOT_ACTIVE', 'Una parcela inactiva o archivada no se autoriza.');
    if (dto.grantee_organization_id === orgId) throw new AppError(422, 'AUTHORIZATION_SAME_ORGANIZATION', 'La organización propietaria no se autoriza a sí misma: ya puede encargar el análisis.');
    const grantee = await this.db.selectFrom('organizations').select(['id', 'name', 'status']).where('id', '=', dto.grantee_organization_id).executeTakeFirst();
    if (!grantee || grantee.status !== 'ACTIVE') throw new AppError(422, 'AUTHORIZATION_GRANTEE_INVALID', 'La organización destinataria no existe o no está activa.');
    const expires = new Date(dto.expires_at);
    const now = Date.now();
    if (!(expires.getTime() > now)) throw new AppError(422, 'AUTHORIZATION_EXPIRY_INVALID', 'El vencimiento debe ser posterior a este momento.');
    if (expires.getTime() > now + MAX_AUTHORIZATION_DAYS * 86400000) throw new AppError(422, 'AUTHORIZATION_EXPIRY_TOO_LONG', `El vencimiento no puede superar ${MAX_AUTHORIZATION_DAYS} días: no hay autorizaciones indefinidas.`);

    const prior = await this.db.selectFrom('satellite_plot_authorizations').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.plot_id !== plotId || prior.grantee_organization_id !== dto.grantee_organization_id) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó en otra autorización.');
      return { replayed: true, authorization: this.authView(prior, grantee.name) };
    }
    const active = await this.db.selectFrom('satellite_plot_authorizations').select(['id', 'expires_at']).where('organization_id', '=', orgId).where('plot_id', '=', plotId)
      .where('grantee_organization_id', '=', dto.grantee_organization_id).where('revoked_at', 'is', null).executeTakeFirst();
    if (active && active.expires_at.getTime() > now) throw conflict('AUTHORIZATION_ALREADY_ACTIVE', 'Esa parcela ya está autorizada a esa organización. Revócala para otorgar otra con distintos términos.');

    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      // Una autorización vencida que nadie revocó se cierra al otorgar la nueva: el historial queda y la restricción de «una activa» se mantiene.
      if (active) {
        await trx.updateTable('satellite_plot_authorizations').set({ revoked_at: new Date(), revoked_by: user.id, revoke_reason: 'Vencida: sustituida por una nueva autorización.' })
          .where('id', '=', active.id).where('revoked_at', 'is', null).execute();
        await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'satellite.authorization_revoked', entityType: 'satellite_plot_authorization', entityId: active.id, requestId, result: 'SUCCESS', reason: 'Vencida: sustituida por una nueva autorización.' });
      }
      await trx.insertInto('satellite_plot_authorizations').values({
        id, organization_id: orgId, plot_id: plotId, grantee_organization_id: dto.grantee_organization_id, can_download: dto.can_download ?? false,
        expires_at: expires, reason: dto.reason, granted_by: user.id, operation_id: dto.operation_id,
      }).execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'satellite.authorization_granted', entityType: 'satellite_plot_authorization', entityId: id, requestId, result: 'SUCCESS',
        reason: dto.reason, after: { plot_id: plotId, grantee_organization_id: dto.grantee_organization_id, can_download: dto.can_download ?? false, expires_at: expires.toISOString() },
      });
    });
    const row = await this.db.selectFrom('satellite_plot_authorizations').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    return { replayed: false, authorization: this.authView(row, grantee.name) };
  }

  async authorizations(user: AuthUser, orgId: string, plotId: string) {
    const ctx = await this.ctxFor(user, orgId, SATELLITE_AUTHORIZE);
    await this.plots.load(this.db, ctx, plotId, 'read');
    const rows = await this.db.selectFrom('satellite_plot_authorizations as a').innerJoin('organizations as o', 'o.id', 'a.grantee_organization_id')
      .selectAll('a').select('o.name as grantee_name').where('a.organization_id', '=', orgId).where('a.plot_id', '=', plotId).orderBy('a.created_at', 'desc').execute();
    return { plot_id: plotId, authorizations: rows.map((r) => this.authView(r, r.grantee_name)) };
  }

  async revokeAuthorization(user: AuthUser, orgId: string, authId: string, dto: RevokeAuthorizationDto, requestId?: string) {
    const ctx = await this.ctxFor(user, orgId, SATELLITE_AUTHORIZE);
    const a = await this.db.selectFrom('satellite_plot_authorizations').selectAll().where('organization_id', '=', orgId).where('id', '=', authId).executeTakeFirst();
    if (!a) throw notFound();
    await this.plots.load(this.db, ctx, a.plot_id, 'read');
    const grantee = await this.db.selectFrom('organizations').select('name').where('id', '=', a.grantee_organization_id).executeTakeFirstOrThrow();
    if (a.revoked_at) return { replayed: true, authorization: this.authView(a, grantee.name), cancelled_jobs: 0 };
    let cancelled = 0;
    await this.db.transaction().execute(async (trx) => {
      const r = await trx.updateTable('satellite_plot_authorizations').set({ revoked_at: new Date(), revoked_by: user.id, revoke_reason: dto.reason })
        .where('id', '=', authId).where('revoked_at', 'is', null).executeTakeFirst();
      if (Number(r.numUpdatedRows) !== 1) return;
      // Lo que aún no salió hacia el proveedor se cancela; lo que está en curso recibe la petición de cancelación (la atiende el corredor).
      const pending = await trx.updateTable('satellite_jobs')
        .set({ status: 'CANCELLED', outcome: 'CANCELLED', finished_at: new Date(), last_error_code: 'AUTHORIZATION_REVOKED' })
        .where('authorization_id', '=', authId).where('status', '=', 'REQUESTED').executeTakeFirst();
      const running = await trx.updateTable('satellite_jobs')
        .set({ cancel_requested_at: new Date(), cancel_requested_by: user.id, cancel_reason: 'Autorización revocada por la organización propietaria.' })
        .where('authorization_id', '=', authId).where('status', '=', 'RUNNING').where('cancel_requested_at', 'is', null).executeTakeFirst();
      cancelled = Number(pending.numUpdatedRows) + Number(running.numUpdatedRows);
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'satellite.authorization_revoked', entityType: 'satellite_plot_authorization', entityId: authId, requestId, result: 'SUCCESS', reason: dto.reason, after: { cancelled_jobs: cancelled } });
    });
    const row = await this.db.selectFrom('satellite_plot_authorizations').selectAll().where('id', '=', authId).executeTakeFirstOrThrow();
    return { replayed: false, authorization: this.authView(row, grantee.name), cancelled_jobs: cancelled };
  }

  private authView(a: { id: string; plot_id: string; grantee_organization_id: string; can_download: boolean; expires_at: Date; reason: string; created_at: Date; revoked_at: Date | null; revoke_reason: string | null }, granteeName: string) {
    const status = a.revoked_at ? 'REVOKED' : a.expires_at.getTime() <= Date.now() ? 'EXPIRED' : 'ACTIVE';
    return {
      id: a.id, plot_id: a.plot_id, grantee: { id: a.grantee_organization_id, name: granteeName }, can_download: a.can_download, status,
      expires_at: a.expires_at, reason: a.reason, created_at: a.created_at, revoked_at: a.revoked_at, revoke_reason: a.revoke_reason,
    };
  }

  /** Autorización vigente de la destinataria (no revocada ni vencida) y propietaria activa; si no, el motivo en claro. Un id ajeno es 404. */
  private async activeAuthorization(orgId: string, authId: string) {
    const a = await this.db.selectFrom('satellite_plot_authorizations').selectAll().where('id', '=', authId).where('grantee_organization_id', '=', orgId).executeTakeFirst();
    if (!a) throw notFound();
    if (a.revoked_at) throw forbidden('SATELLITE_AUTHORIZATION_REVOKED', 'La organización propietaria revocó esta autorización.');
    if (a.expires_at.getTime() <= Date.now()) throw forbidden('SATELLITE_AUTHORIZATION_EXPIRED', 'Esta autorización venció.');
    return a;
  }

  /** Parcelas que otras organizaciones autorizaron a la propia, con lo mínimo para decidir: sin coordenadas ni productor. */
  async authorizedPlots(user: AuthUser, orgId: string) {
    await this.ctxFor(user, orgId, SATELLITE_READ);
    const rows = await sql<{ id: string; plot_code: string; owner_id: string; owner_name: string; can_download: boolean; expires_at: Date; reason: string; created_at: Date; current_version_id: string | null; geometry_type: string | null; geometry_hash: string | null; has_active_job: boolean }>`
      SELECT a.id, p.plot_code, o.id AS owner_id, o.name AS owner_name, a.can_download, a.expires_at, a.reason, a.created_at,
             p.current_version_id, v.geometry_type, v.geometry_hash,
             EXISTS (SELECT 1 FROM satellite_jobs j WHERE j.authorization_id = a.id AND j.status IN ('REQUESTED','RUNNING')) AS has_active_job
        FROM satellite_plot_authorizations a
        JOIN plots p ON p.organization_id = a.organization_id AND p.id = a.plot_id
        JOIN organizations o ON o.id = a.organization_id
        LEFT JOIN plot_versions v ON v.organization_id = p.organization_id AND v.id = p.current_version_id
       WHERE a.grantee_organization_id = ${orgId} AND a.revoked_at IS NULL AND a.expires_at > now() AND p.deleted_at IS NULL
       ORDER BY o.name, p.plot_code`.execute(this.db);
    return {
      authorized_plots: rows.rows.map((r) => ({
        authorization_id: r.id, plot_code: r.plot_code, owner_organization: { id: r.owner_id, name: r.owner_name }, can_download: r.can_download,
        expires_at: r.expires_at, reason: r.reason, authorized_at: r.created_at,
        current_version: r.current_version_id ? { plot_version_id: r.current_version_id, geometry_type: r.geometry_type, geometry_hash: r.geometry_hash } : null,
        has_active_job: r.has_active_job,
      })),
      limits: ['La autorización solo permite analizar esa parcela: no da acceso a su geometría, a su productor ni a sus datos.',
        'El resultado de un proveedor externo no es una conclusión jurídica ni una certificación (S1 §41).'],
    };
  }

  /** Estado de una parcela autorizada para la destinataria: los trabajos que ELLA solicitó, con su procedencia. */
  async authorizedPlot(user: AuthUser, orgId: string, authId: string) {
    const ctx = await this.ctxFor(user, orgId, SATELLITE_READ);
    const a = await this.activeAuthorization(orgId, authId);
    const jobs = await this.db.selectFrom('satellite_jobs').select('id').where('authorization_id', '=', authId).where('requesting_organization_id', '=', orgId)
      .orderBy('requested_at', 'desc').limit(50).execute();
    const views = [];
    for (const j of jobs) views.push(await this.jobView(this.db, a.organization_id, j.id, a.can_download));
    const { provider, blocked } = await this.effectiveProvider(this.db);
    const reason = !ctx.permissions.includes(SATELLITE_REQUEST as never) ? 'Tu rol no encarga análisis satelitales.'
      : ctx.organizationStatus !== 'ACTIVE' ? 'La organización está suspendida; no admite nuevas operaciones.'
      : !provider ? (blocked ?? 'No hay proveedor satelital seleccionado (D-09).') : null;
    return { authorization_id: authId, can_request: reason === null, request_blocked_reason: reason, can_download: a.can_download, supported_operations: provider ? provider.supported_operations : [], jobs: views };
  }

  async requestAuthorized(user: AuthUser, orgId: string, authId: string, dto: RequestAnalysisDto, requestId?: string) {
    const ctx = await this.ctxFor(user, orgId, SATELLITE_REQUEST);
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    const a = await this.activeAuthorization(orgId, authId);
    const owner = await this.db.selectFrom('organizations').select('status').where('id', '=', a.organization_id).executeTakeFirstOrThrow();
    if (owner.status !== 'ACTIVE') throw forbidden('OWNER_ORGANIZATION_SUSPENDED', 'La organización propietaria está suspendida.');
    const plot = await this.db.selectFrom('plots').select(['id', 'current_version_id', 'deleted_at']).where('organization_id', '=', a.organization_id).where('id', '=', a.plot_id).executeTakeFirst();
    if (!plot || plot.deleted_at) throw notFound();
    // La destinataria no elige versión: se analiza la versión vigente de la parcela autorizada (la huella queda en el trabajo).
    if (dto.plot_version_id && dto.plot_version_id !== plot.current_version_id) throw new AppError(422, 'AUTHORIZED_VERSION_ONLY_CURRENT', 'Una parcela autorizada solo se analiza en su versión vigente.');
    return this.submit(user, a.organization_id, plot, orgId, authId, dto, requestId, a.can_download);
  }

  async authorizedJob(user: AuthUser, orgId: string, jobId: string) {
    await this.ctxFor(user, orgId, SATELLITE_READ);
    const j = await this.authorizedJobRow(orgId, jobId);
    return this.jobView(this.db, j.organization_id, jobId, j.can_download);
  }

  async cancelAuthorized(user: AuthUser, orgId: string, jobId: string, dto: CancelAnalysisDto, requestId?: string) {
    await this.ctxFor(user, orgId, SATELLITE_REQUEST);
    const j = await this.authorizedJobRow(orgId, jobId);
    return this.cancelJob(user, j.organization_id, { id: j.id, status: j.status, cancel_requested_at: j.cancel_requested_at }, dto, requestId, j.can_download);
  }

  async originalAuthorized(user: AuthUser, orgId: string, jobId: string, requestId?: string) {
    // La respuesta original contiene la geometría enviada: además de la autorización de descarga de la propietaria, la pide un rol que puede encargar (no basta leer).
    await this.ctxFor(user, orgId, SATELLITE_REQUEST);
    const j = await this.authorizedJobRow(orgId, jobId);
    if (!j.can_download) throw forbidden('PERMISSION_DENIED', 'La organización propietaria no autorizó la descarga de la respuesta original (contiene la geometría enviada).');
    return this.rawBytes(user, j.organization_id, orgId, jobId, requestId);
  }

  /** Trabajo solicitado por la organización con una autorización VIGENTE; revocada o vencida deja de ser accesible. */
  private async authorizedJobRow(orgId: string, jobId: string) {
    const j = await this.db.selectFrom('satellite_jobs').select(['id', 'organization_id', 'authorization_id', 'status', 'cancel_requested_at'])
      .where('id', '=', jobId).where('requesting_organization_id', '=', orgId).where('authorization_id', 'is not', null).executeTakeFirst();
    if (!j) throw notFound();
    const a = await this.activeAuthorization(orgId, j.authorization_id!);
    return { ...j, can_download: a.can_download };
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
    for (const j of jobs) views.push(await this.jobView(this.db, orgId, j.id, this.plots.has(ctx, 'plot:read_geometry')));
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
      // Solo las operaciones que el proveedor efectivo declara: la pantalla no ofrece botones que el servidor va a rechazar.
      supported_operations: provider ? provider.supported_operations : [],
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
    return await this.jobView(this.db, orgId, jobId, this.plots.has(ctx, 'plot:read_geometry'));
  }

  /**
   * Vista de un trabajo con su procedencia completa. Nunca devuelve coordenadas ni credenciales.
   * `ownerOrgId` es el tenant de la parcela (donde vive el trabajo); `canDownloadRaw` lo decide quien llama según su vía de acceso.
   */
  private async jobView(db: Db, ownerOrgId: string, jobId: string, canDownloadRaw: boolean) {
    const j = await db.selectFrom('satellite_jobs').selectAll().where('organization_id', '=', ownerOrgId).where('id', '=', jobId).executeTakeFirstOrThrow();
    const result = await db.selectFrom('satellite_results').selectAll().where('organization_id', '=', ownerOrgId).where('job_id', '=', jobId).executeTakeFirst();
    const current = await sql<{ current_version_id: string | null }>`SELECT current_version_id FROM plots WHERE organization_id = ${ownerOrgId} AND id = ${j.plot_id}`.execute(db);
    const requester = j.requesting_organization_id === ownerOrgId ? null
      : await db.selectFrom('organizations').select(['id', 'name']).where('id', '=', j.requesting_organization_id).executeTakeFirst();
    return {
      id: j.id,
      // Quién solicitó el servicio y con qué autorización (null = la propia organización propietaria).
      requested_by_organization: requester ? { id: requester.id, name: requester.name, authorization_id: j.authorization_id } : null,
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
      // Avance DECLARADO por el proveedor (no inventado); el identificador del trabajo en el proveedor no se expone.
      progress: j.provider_progress_at ? { percent: j.provider_progress_percent, note: j.provider_progress_note, at: j.provider_progress_at } : null,
      provider_job_started: j.provider_job_ref !== null,
      cancel_requested: j.cancel_requested_at ? { at: j.cancel_requested_at, reason: j.cancel_reason } : null,
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
            raw_evidence: result.raw_object_key ? { stored: true, sha256: result.raw_sha256, can_download: canDownloadRaw } : null,
            conclusion: result.conclusion,
            conclusion_note: 'NOT_EVALUATED: el resultado de un proveedor externo no se convierte en conclusión regulatoria (S1 §41).',
          }
        : null,
    };
  }
}

function sendCsv(res: Response, o: { text: string; name: string }) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${o.name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(String.fromCharCode(0xfeff) + o.text);
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

  @Get('satellite/credentials')
  credentials(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.credentials(user, orgId);
  }

  @Put('satellite/credentials/:providerCode')
  setCredential(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('providerCode') providerCode: string, @Body() dto: SetCredentialDto, @Req() req: AuthedRequest) {
    return this.service.setCredential(user, orgId, providerCode, dto, req.requestId);
  }

  @Delete('satellite/credentials/:providerCode')
  deleteCredential(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('providerCode') providerCode: string, @Req() req: AuthedRequest) {
    return this.service.deleteCredential(user, orgId, providerCode, req.requestId);
  }

  @Get('satellite/analyses/:jobId/original')
  async original(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const o = await this.service.original(user, orgId, jobId, req.requestId);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${o.name}"`);
    res.setHeader('X-Content-SHA256', o.sha256);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(o.bytes);
  }

  // ---- Propietaria: autoriza (y revoca) el análisis de parcelas concretas por otra organización.
  @Post('plots/:plotId/satellite/authorizations')
  authorize(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('plotId', ParseUUIDPipe) plotId: string, @Body() dto: AuthorizeAnalysisDto, @Req() req: AuthedRequest) {
    return this.service.authorize(user, orgId, plotId, dto, req.requestId);
  }

  @Get('plots/:plotId/satellite/authorizations')
  authorizations(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('plotId', ParseUUIDPipe) plotId: string) {
    return this.service.authorizations(user, orgId, plotId);
  }

  @Post('satellite/authorizations/:authId/revoke')
  revokeAuthorization(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('authId', ParseUUIDPipe) authId: string, @Body() dto: RevokeAuthorizationDto, @Req() req: AuthedRequest) {
    return this.service.revokeAuthorization(user, orgId, authId, dto, req.requestId);
  }

  // ---- Destinataria (p. ej. exportadora): solo parcelas autorizadas; `orgId` es SU organización.
  @Get('satellite/authorized-plots')
  authorizedPlots(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.authorizedPlots(user, orgId);
  }

  @Get('satellite/authorized-plots/:authId')
  authorizedPlot(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('authId', ParseUUIDPipe) authId: string) {
    return this.service.authorizedPlot(user, orgId, authId);
  }

  @Post('satellite/authorized-plots/:authId/analyses')
  requestAuthorized(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('authId', ParseUUIDPipe) authId: string, @Body() dto: RequestAnalysisDto, @Req() req: AuthedRequest) {
    return this.service.requestAuthorized(user, orgId, authId, dto, req.requestId);
  }

  @Get('satellite/authorized-analyses/:jobId')
  authorizedJob(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.service.authorizedJob(user, orgId, jobId);
  }

  @Post('satellite/authorized-analyses/:jobId/cancel')
  cancelAuthorized(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Body() dto: CancelAnalysisDto, @Req() req: AuthedRequest) {
    return this.service.cancelAuthorized(user, orgId, jobId, dto, req.requestId);
  }

  @Get('satellite/authorized-analyses/:jobId/original')
  async originalAuthorized(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const o = await this.service.originalAuthorized(user, orgId, jobId, req.requestId);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${o.name}"`);
    res.setHeader('X-Content-SHA256', o.sha256);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(o.bytes);
  }

  @Get('satellite/analyses/:jobId/indicators.csv')
  indicators(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Req() req: AuthedRequest, @Res() res: Response) {
    return this.service.indicators(user, orgId, jobId, req.requestId).then((o) => sendCsv(res, o));
  }

  @Get('satellite/authorized-analyses/:jobId/indicators.csv')
  indicatorsAuthorized(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Req() req: AuthedRequest, @Res() res: Response) {
    return this.service.indicatorsAuthorized(user, orgId, jobId, req.requestId).then((o) => sendCsv(res, o));
  }

  @Post('satellite/analyses/:jobId/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('jobId', ParseUUIDPipe) jobId: string, @Body() dto: CancelAnalysisDto, @Req() req: AuthedRequest) {
    return this.service.cancel(user, orgId, jobId, dto, req.requestId);
  }
}
