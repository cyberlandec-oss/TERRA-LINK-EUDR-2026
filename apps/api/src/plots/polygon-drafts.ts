import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDefined, IsIn, IsISO8601, IsInt, IsNumber, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import type { Response } from 'express';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database, DraftVerticesTable, PolygonDraftsTable } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { PlotsService, STRUCTURAL_RULE } from './plots';
import { reasonWithoutCoordinates, structuralIssues } from './geometry';
import { summarizeAccuracy } from './accuracy-summary';

// P0-008 — Polígono. Borrador persistido en el servidor (contrato en la migración 0010).
// Tres niveles distintos: (1) estructura almacenable (≥3 vértices distintos, anillo cerrado, rangos);
// (2) validez geométrica técnica (ST_IsValid: p. ej. autointersección); (3) validación GIS de P0-010
// (sigue NOT_VALIDATED). Una geometría técnicamente no válida solo se guarda si se pide expresamente
// conservarla para revisión: sin superficie calculada y con el motivo visible. Nunca se repara.

type Draft = Selectable<PolygonDraftsTable>;
type Vertex = Selectable<DraftVerticesTable> & { excluded: boolean };
const FUTURE_TOLERANCE_MS = 5 * 60_000;

class VersionDto {
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
}

class AddVertexDto extends VersionDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ enum: ['BROWSER_GEOLOCATION'] }) @IsIn(['BROWSER_GEOLOCATION']) source!: 'BROWSER_GEOLOCATION';
  @ApiProperty() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180) longitude!: number;
  @ApiProperty() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-90) @Max(90) latitude!: number;
  @ApiProperty({ nullable: true }) @IsDefined({ message: 'accuracy_m es obligatorio: envía null si no se informó' })
  @ValidateIf((_, v) => v !== null) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) accuracy_m!: number | null;
  @ApiProperty() @IsISO8601({ strict: true }) captured_at!: string;
}

class ConfirmDto extends VersionDto {
  @ApiProperty({ description: 'row_version de la parcela leída' }) @IsInt() @Min(1) plot_expected_version!: number;
  @ApiPropertyOptional({ description: 'Conservar para revisión una geometría técnicamente no válida (sin superficie)' })
  @IsOptional() @IsBoolean() keep_invalid_for_review?: boolean;
}

interface Preview {
  vertex_count: number;
  distinct_count: number;
  repeated_vertices: number;
  storable: boolean;
  structural_issues: string[];
  technically_valid: boolean | null;
  validity_reason: string | null;
  area_calculated_ha: string | null;
  closing: string;
}

@Injectable()
export class PolygonDraftsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly plots: PlotsService,
  ) {}

  /** Capturar exige editar la parcela en su alcance y la clasificación de geometría exacta. */
  private async ctxFor(user: AuthUser, orgId: string, mutation: boolean): Promise<TenantContext> {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.plots.has(ctx, 'plot:update') && !this.plots.has(ctx, 'plot:update_assigned') && !this.plots.has(ctx, 'plot:update_own')) throw forbidden();
    if (!this.plots.geometryAllowed(ctx)) throw forbidden('PERMISSION_DENIED', 'Tu rol no permite capturar geometrías exactas.');
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }

  /** Borrador de la organización cuya parcela está en el alcance de escritura del usuario (revalida asignación). */
  private async loadDraft(db: Kysely<Database> | Transaction<Database>, ctx: TenantContext, draftId: string, lock: boolean) {
    let q = db.selectFrom('polygon_drafts').selectAll().where('organization_id', '=', ctx.organizationId).where('id', '=', draftId);
    if (lock) q = q.forUpdate();
    const draft = await q.executeTakeFirst();
    if (!draft) throw notFound();
    const plot = await this.plots.load(db, ctx, draft.plot_id, 'update', lock);
    return { draft, plot };
  }

  private async vertices(db: Kysely<Database> | Transaction<Database>, orgId: string, draftId: string): Promise<Vertex[]> {
    const rows = await db.selectFrom('draft_vertices as v')
      .leftJoin('draft_vertex_exclusions as x', (j) => j.onRef('x.vertex_id', '=', 'v.id').onRef('x.organization_id', '=', 'v.organization_id'))
      .selectAll('v').select(sql<boolean>`(x.vertex_id IS NOT NULL)`.as('excluded'))
      .where('v.organization_id', '=', orgId).where('v.draft_id', '=', draftId).orderBy('v.acquisition_seq').execute();
    return rows as Vertex[];
  }

  private async preview(db: Kysely<Database> | Transaction<Database>, included: Vertex[]): Promise<Preview> {
    const keys = included.map((v) => `${v.longitude},${v.latitude}`);
    const distinct = new Set(keys).size;
    const repeated = keys.filter((k, i) => i > 0 && k === keys[i - 1]).length;
    const issues: string[] = [];
    if (distinct < 3) issues.push('LESS_THAN_3_DISTINCT_VERTICES');
    let valid: boolean | null = null;
    let reason: string | null = null;
    let area: string | null = null;
    if (included.length >= 3) {
      const ring = [...included.map((v) => [v.longitude, v.latitude]), [included[0].longitude, included[0].latitude]];
      const geo = { type: 'Polygon', coordinates: [ring] };
      issues.push(...structuralIssues(geo).map((i) => i.reason));
      if (distinct >= 3) {
        const r = await sql<{ valid: boolean; reason: string; area: string | null }>`
          WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geo)}), 4326) AS geom)
          SELECT (ST_IsValidDetail(geom)).valid AS valid, (ST_IsValidDetail(geom)).reason AS reason,
                 CASE WHEN (ST_IsValidDetail(geom)).valid THEN round((ST_Area(geom::geography) / 10000)::numeric, 6)::text ELSE NULL END AS area
          FROM g`.execute(db);
        valid = r.rows[0].valid;
        reason = valid ? null : reasonWithoutCoordinates(r.rows[0].reason);
        area = r.rows[0].area;
      }
    }
    return {
      vertex_count: included.length, distinct_count: distinct, repeated_vertices: repeated,
      storable: issues.length === 0, structural_issues: issues, technically_valid: valid, validity_reason: reason, area_calculated_ha: area,
      closing: 'El anillo se cierra con el primer vértice; no se crea otra muestra, fecha ni precisión.',
    };
  }

  private async view(db: Kysely<Database> | Transaction<Database>, orgId: string, draft: Draft) {
    const all = await this.vertices(db, orgId, draft.id);
    const included = all.filter((v) => !v.excluded);
    return {
      id: draft.id, plot_id: draft.plot_id, status: draft.status, row_version: Number(draft.row_version),
      origin_capture_id: draft.origin_capture_id, origin_device_id: draft.origin_device_id,
      confirmed_version_id: draft.confirmed_version_id, created_at: draft.created_at, updated_at: draft.updated_at,
      vertices: all.map((v) => ({
        id: v.id, acquisition_seq: v.acquisition_seq, source: v.source, longitude: v.longitude, latitude: v.latitude,
        horizontal_accuracy_m: v.horizontal_accuracy_m, captured_at: v.captured_at, received_at: v.received_at, excluded: v.excluded,
        provider_detail: v.provider_detail, mocked: v.mocked,
      })),
      accuracy_summary: summarizeAccuracy(included.map((v) => v.horizontal_accuracy_m)),
      preview: await this.preview(db, included),
    };
  }

  private bump(trx: Transaction<Database>, draft: Draft, userId: string, extra: Record<string, unknown> = {}) {
    return trx.updateTable('polygon_drafts')
      .set({ ...extra, row_version: sql`row_version + 1`, updated_at: new Date(), updated_by: userId } as never)
      .where('id', '=', draft.id).where('organization_id', '=', draft.organization_id).returningAll().executeTakeFirstOrThrow();
  }

  private checkOpen(draft: Draft, expected: number) {
    if (draft.status !== 'OPEN') throw conflict('DRAFT_CLOSED', draft.status === 'CONFIRMED' ? 'Este borrador ya se confirmó.' : 'Este borrador fue cancelado.');
    if (Number(draft.row_version) !== expected) throw conflict('VERSION_CONFLICT', 'El borrador cambió en otra pestaña o dispositivo. Recárgalo; tu muestra se conserva.');
  }

  async start(user: AuthUser, orgId: string, plotId: string, requestId?: string, origin?: { capture_id: string; device_id: string }) {
    const ctx = await this.ctxFor(user, orgId, true);
    return this.db.transaction().execute(async (trx) => {
      const plot = await this.plots.load(trx, ctx, plotId, 'update', true);
      if (plot.status === 'INACTIVE') throw conflict('PLOT_INACTIVE', 'La parcela está dada de baja.');
      const open = await trx.selectFrom('polygon_drafts').select('id').where('organization_id', '=', orgId).where('plot_id', '=', plotId).where('status', '=', 'OPEN').executeTakeFirst();
      if (open) throw new AppError(409, 'DRAFT_ALREADY_OPEN', 'Ya hay un borrador de polígono abierto para esta parcela.', [{ field: 'draft_id', reason: open.id }]);
      const draft = await trx.insertInto('polygon_drafts')
        .values({ id: randomUUID(), organization_id: orgId, plot_id: plotId, status: 'OPEN', created_by: user.id, updated_by: user.id, origin_capture_id: origin?.capture_id ?? null, origin_device_id: origin?.device_id ?? null })
        .returningAll().executeTakeFirstOrThrow();
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'plot.polygon_draft_start', entityType: 'plot', entityId: plotId, requestId, result: 'SUCCESS', after: { draft_id: draft.id } });
      return this.view(trx, orgId, draft);
    });
  }

  async current(user: AuthUser, orgId: string, plotId: string) {
    const ctx = await this.ctxFor(user, orgId, false);
    await this.plots.load(this.db, ctx, plotId, 'update');
    const draft = await this.db.selectFrom('polygon_drafts').selectAll().where('organization_id', '=', orgId).where('plot_id', '=', plotId).where('status', '=', 'OPEN').executeTakeFirst();
    return { draft: draft ? await this.view(this.db, orgId, draft) : null };
  }

  async get(user: AuthUser, orgId: string, draftId: string) {
    const ctx = await this.ctxFor(user, orgId, false);
    const { draft } = await this.loadDraft(this.db, ctx, draftId, false);
    return this.view(this.db, orgId, draft);
  }

  async addVertex(user: AuthUser, orgId: string, draftId: string, dto: AddVertexDto, requestId?: string, native?: { provider_detail: string; mocked: boolean | null; device_id: string; expect?: { capture_id: string; prior_vertices: number } }) {
    const ctx = await this.ctxFor(user, orgId, true);
    const capturedAt = new Date(dto.captured_at);
    if (capturedAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      throw new AppError(422, 'CAPTURED_AT_IN_FUTURE', 'La hora de adquisición informada está en el futuro. Revisa el reloj del dispositivo.', [{ field: 'captured_at', reason: 'IN_FUTURE' }]);
    }
    const source = native ? 'DEVICE_LOCATION_SERVICE' as const : dto.source;
    const hash = createHash('sha256').update(JSON.stringify(native ? [draftId, source, dto.longitude, dto.latitude, dto.accuracy_m, capturedAt.toISOString(), native.provider_detail, native.mocked, native.device_id] : [draftId, dto.source, dto.longitude, dto.latitude, dto.accuracy_m, capturedAt.toISOString()])).digest('hex');
    const replay = async () => {
      const prior = await this.db.selectFrom('draft_vertices').select(['draft_id', 'payload_hash'])
        .where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
      if (!prior) return null;
      if (prior.draft_id !== draftId || prior.payload_hash !== hash) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otros datos. Captura de nuevo.');
      const { draft } = await this.loadDraft(this.db, ctx, draftId, false);
      return { replayed: true, draft: await this.view(this.db, orgId, draft) };
    };
    const earlier = await replay();
    if (earlier) return earlier;
    try {
      const result = await this.db.transaction().execute(async (trx) => {
        const { draft } = await this.loadDraft(trx, ctx, draftId, true);
        const already = await trx.selectFrom('draft_vertices').select('id').where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
        if (already) return null;
        this.checkOpen(draft, dto.expected_version);
        // Estado esperado por la captura móvil, comprobado BAJO el bloqueo del borrador: el borrador es de esa captura y contiene exactamente
        // los vértices que ella aportó antes (ninguno añadido, deshecho o retirado desde la web entre dos envíos).
        if (native?.expect) {
          const own = await trx.selectFrom('draft_vertices as v')
            .leftJoin('draft_vertex_exclusions as x', (j) => j.onRef('x.vertex_id', '=', 'v.id').onRef('x.organization_id', '=', 'v.organization_id'))
            .select(['v.device_id', sql<boolean>`(x.vertex_id IS NOT NULL)`.as('excluded')])
            .where('v.organization_id', '=', orgId).where('v.draft_id', '=', draftId).execute();
          const intact = draft.origin_capture_id === native.expect.capture_id && own.length === native.expect.prior_vertices && own.every((v) => v.device_id === native.device_id && !v.excluded);
          if (!intact) throw conflict('DRAFT_CHANGED_FROM_WEB', 'El borrador de esta captura cambió desde la web (se añadió, deshizo o retiró un vértice) mientras el teléfono estaba sin conexión.');
        }
        const last = await trx.selectFrom('draft_vertices').select(sql<number>`coalesce(max(acquisition_seq), 0)::int`.as('n')).where('draft_id', '=', draftId).executeTakeFirstOrThrow();
        await trx.insertInto('draft_vertices').values({
          id: randomUUID(), organization_id: orgId, draft_id: draftId, acquisition_seq: last.n + 1, source,
          provider_detail: native?.provider_detail ?? null, mocked: native ? native.mocked : null, device_id: native?.device_id ?? null,
          longitude: dto.longitude, latitude: dto.latitude, horizontal_accuracy_m: dto.accuracy_m, captured_at: capturedAt,
          operation_id: dto.operation_id, payload_hash: hash, created_by: user.id,
        }).execute();
        const after = await this.bump(trx, draft, user.id);
        await this.audit.record(trx, {
          organizationId: orgId, actorUserId: user.id, action: 'plot.polygon_vertex_add', entityType: 'plot', entityId: draft.plot_id, requestId, result: 'SUCCESS',
          after: { draft_id: draftId, acquisition_seq: last.n + 1, accuracy_reported: dto.accuracy_m !== null },
        });
        return { replayed: false, draft: await this.view(trx, orgId, after) };
      });
      return result ?? (await replay())!;
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'draft_vertices_operation_uq') {
        const again = await replay();
        if (again) return again;
      }
      throw e;
    }
  }

  /** Deshacer: excluye el último vértice incluido de la composición; la muestra adquirida no cambia. */
  async undo(user: AuthUser, orgId: string, draftId: string, dto: VersionDto, requestId?: string) {
    const ctx = await this.ctxFor(user, orgId, true);
    return this.db.transaction().execute(async (trx) => {
      const { draft } = await this.loadDraft(trx, ctx, draftId, true);
      this.checkOpen(draft, dto.expected_version);
      const included = (await this.vertices(trx, orgId, draftId)).filter((v) => !v.excluded);
      const last = included[included.length - 1];
      if (!last) throw conflict('NOTHING_TO_UNDO', 'No hay vértices que deshacer.');
      await trx.insertInto('draft_vertex_exclusions').values({ vertex_id: last.id, organization_id: orgId, excluded_by: user.id }).execute();
      const after = await this.bump(trx, draft, user.id);
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'plot.polygon_vertex_undo', entityType: 'plot', entityId: draft.plot_id, requestId, result: 'SUCCESS', after: { draft_id: draftId, acquisition_seq: last.acquisition_seq } });
      return this.view(trx, orgId, after);
    });
  }

  async cancel(user: AuthUser, orgId: string, draftId: string, dto: VersionDto, requestId?: string) {
    const ctx = await this.ctxFor(user, orgId, true);
    return this.db.transaction().execute(async (trx) => {
      const { draft } = await this.loadDraft(trx, ctx, draftId, true);
      this.checkOpen(draft, dto.expected_version);
      const after = await this.bump(trx, draft, user.id, { status: 'CANCELLED', closed_at: new Date(), closed_by: user.id });
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'plot.polygon_draft_cancel', entityType: 'plot', entityId: draft.plot_id, requestId, result: 'SUCCESS', after: { draft_id: draftId } });
      return this.view(trx, orgId, after);
    });
  }

  /** Confirmación atómica: versión POLYGON inmutable + borrador CONFIRMED + historial + evento + auditoría. */
  async confirm(user: AuthUser, orgId: string, draftId: string, dto: ConfirmDto, requestId?: string) {
    const ctx = await this.ctxFor(user, orgId, true);
    return this.db.transaction().execute(async (trx) => {
      const { draft, plot } = await this.loadDraft(trx, ctx, draftId, true);
      this.checkOpen(draft, dto.expected_version);
      if (plot.status === 'INACTIVE') throw conflict('PLOT_INACTIVE', 'La parcela está dada de baja.');
      if (Number(plot.row_version) !== dto.plot_expected_version) throw conflict('VERSION_CONFLICT', 'La parcela cambió mientras capturabas. El borrador se conserva: recarga y confirma de nuevo.');
      const included = (await this.vertices(trx, orgId, draftId)).filter((v) => !v.excluded);
      const pv = await this.preview(trx, included);
      if (!pv.storable) {
        throw new AppError(422, pv.distinct_count < 3 ? 'POLYGON_NEEDS_3_DISTINCT_VERTICES' : 'GEOMETRY_STRUCTURE_INVALID',
          pv.distinct_count < 3 ? 'Un polígono necesita al menos 3 vértices distintos. El borrador se conserva.' : 'La geometría no tiene una estructura almacenable. El borrador se conserva.',
          pv.structural_issues.map((reason) => ({ reason })));
      }
      if (pv.technically_valid === false && !dto.keep_invalid_for_review) {
        throw new AppError(422, 'POLYGON_NOT_VALID', `La geometría no es válida (${pv.validity_reason}). Corrige los vértices o confírmala expresamente para revisión, sin superficie.`, [{ reason: pv.validity_reason ?? 'INVALID' }]);
      }
      const ring = [...included.map((v) => [v.longitude, v.latitude]), [included[0].longitude, included[0].latitude]];
      const geojson = JSON.stringify({ type: 'Polygon', coordinates: [ring] });
      const previous = plot.current_version_id
        ? await trx.selectFrom('plot_versions').select('area_declared_ha').where('organization_id', '=', orgId).where('id', '=', plot.current_version_id).executeTakeFirst()
        : undefined;
      const last = await trx.selectFrom('plot_versions').select(sql<number>`coalesce(max(version_number), 0)::int`.as('n')).where('organization_id', '=', orgId).where('plot_id', '=', plot.id).executeTakeFirstOrThrow();
      const versionId = randomUUID();
      const surveyedAt = new Date(Math.max(...included.map((v) => new Date(v.captured_at).getTime())));
      const summary = summarizeAccuracy(included.map((v) => v.horizontal_accuracy_m));
      const sources = new Set(included.map((v) => v.source));
      const surveyMethod = sources.size === 1 ? [...sources][0] : 'MIXED_ACQUISITION';
      const notes = pv.technically_valid === false ? `Geometría técnicamente no válida conservada para revisión: ${pv.validity_reason}` : null;
      await sql`
        WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326) AS geom)
        INSERT INTO plot_versions (id, organization_id, plot_id, version_number, geometry, geometry_type, geometry_hash,
          area_declared_ha, area_calculated_ha, survey_method, surveyed_at, accuracy_m, validation_status, validation_rule_version,
          previous_version_id, notes, created_by)
        SELECT ${versionId}, ${orgId}, ${plot.id}, ${last.n + 1}, g.geom, 'POLYGON', encode(sha256(ST_AsBinary(g.geom)), 'hex'),
          ${previous?.area_declared_ha ?? null}::numeric,
          CASE WHEN (ST_IsValidDetail(g.geom)).valid THEN round((ST_Area(g.geom::geography) / 10000)::numeric, 6) ELSE NULL END,
          ${surveyMethod}, ${surveyedAt.toISOString()}::timestamptz, NULL, 'NOT_VALIDATED', ${STRUCTURAL_RULE},
          ${plot.current_version_id}, ${notes}, ${user.id}
        FROM g`.execute(trx);
      const plotAfter = await trx.updateTable('plots')
        .set({ current_version_id: versionId, updated_by: user.id, updated_at: new Date(), row_version: sql`row_version + 1` })
        .where('id', '=', plot.id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
      await this.bump(trx, draft, user.id, { status: 'CONFIRMED', confirmed_version_id: versionId, closed_at: new Date(), closed_by: user.id });
      await this.plots.recordHistory(trx, plotAfter, 'GEOMETRY_VERSION', ['current_version_id'], user.id);
      await this.events.append(trx, {
        organizationId: orgId, eventType: 'PlotGeometryVersionCreated', schemaVersion: 1, aggregateType: 'PLOT', aggregateId: plot.id,
        aggregateVersion: Number(plotAfter.row_version), actorId: user.id, correlationId: requestId,
        payload: {
          plot_version_id: versionId, version_number: last.n + 1, previous_version_id: plot.current_version_id, geometry_type: 'POLYGON',
          survey_method: surveyMethod, polygon_draft_id: draftId, vertex_count: included.length,
          vertices_with_accuracy: summary.with_accuracy, vertices_without_accuracy: summary.without_accuracy, technically_valid: pv.technically_valid,
        },
      });
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'plot.polygon_confirm', entityType: 'plot', entityId: plot.id, requestId, result: 'SUCCESS',
        after: { plot_version_id: versionId, draft_id: draftId, vertex_count: included.length, technically_valid: pv.technically_valid },
      });
      return {
        plot_row_version: Number(plotAfter.row_version),
        version: await this.plots.versionView(trx, orgId, versionId, true),
        accuracy_summary: summary,
        preview: pv,
      };
    });
  }

  /** Vértices incluidos en una versión confirmada desde un borrador (requiere geometría exacta). */
  async versionVertices(user: AuthUser, orgId: string, plotId: string, versionId: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.plots.has(ctx, 'plot:read') && !this.plots.has(ctx, 'plot:read_assigned') && !this.plots.has(ctx, 'plot:read_own')) throw forbidden();
    await this.plots.load(this.db, ctx, plotId, 'read');
    const draft = await this.db.selectFrom('polygon_drafts').selectAll().where('organization_id', '=', orgId).where('plot_id', '=', plotId).where('confirmed_version_id', '=', versionId).executeTakeFirst();
    if (!draft) return { vertices: [], accuracy_summary: summarizeAccuracy([]) };
    const included = (await this.vertices(this.db, orgId, draft.id)).filter((v) => !v.excluded);
    const geometry = this.plots.geometryAllowed(ctx);
    return {
      accuracy_summary: summarizeAccuracy(included.map((v) => v.horizontal_accuracy_m)),
      vertices: included.map((v, i) => ({
        position: i + 1, acquisition_seq: v.acquisition_seq, source: v.source, horizontal_accuracy_m: v.horizontal_accuracy_m,
        captured_at: v.captured_at, received_at: v.received_at, ...(geometry ? { longitude: v.longitude, latitude: v.latitude } : {}),
      })),
      geometry_visible: geometry,
    };
  }
}

@ApiTags('plots')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class PolygonDraftsController {
  constructor(private readonly service: PolygonDraftsService) {}

  @Post('plots/:plotId/polygon-drafts')
  start(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('plotId', ParseUUIDPipe) plotId: string, @Req() req: AuthedRequest) {
    return this.service.start(user, orgId, plotId, req.requestId);
  }

  @Get('plots/:plotId/polygon-drafts/current')
  current(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('plotId', ParseUUIDPipe) plotId: string) {
    return this.service.current(user, orgId, plotId);
  }

  @Get('plots/:plotId/geometry-versions/:versionId/vertices')
  versionVertices(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('plotId', ParseUUIDPipe) plotId: string, @Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.service.versionVertices(user, orgId, plotId, versionId);
  }

  @Get('polygon-drafts/:draftId')
  get(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('draftId', ParseUUIDPipe) draftId: string) {
    return this.service.get(user, orgId, draftId);
  }

  @Post('polygon-drafts/:draftId/vertices')
  async addVertex(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('draftId', ParseUUIDPipe) draftId: string, @Body() dto: AddVertexDto, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.addVertex(user, orgId, draftId, dto, req.requestId);
    if (r.replayed) res.status(200);
    return r;
  }

  @Post('polygon-drafts/:draftId/undo')
  @HttpCode(200)
  undo(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('draftId', ParseUUIDPipe) draftId: string, @Body() dto: VersionDto, @Req() req: AuthedRequest) {
    return this.service.undo(user, orgId, draftId, dto, req.requestId);
  }

  @Post('polygon-drafts/:draftId/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('draftId', ParseUUIDPipe) draftId: string, @Body() dto: VersionDto, @Req() req: AuthedRequest) {
    return this.service.cancel(user, orgId, draftId, dto, req.requestId);
  }

  @Post('polygon-drafts/:draftId/confirm')
  confirm(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('draftId', ParseUUIDPipe) draftId: string, @Body() dto: ConfirmDto, @Req() req: AuthedRequest) {
    return this.service.confirm(user, orgId, draftId, dto, req.requestId);
  }
}
