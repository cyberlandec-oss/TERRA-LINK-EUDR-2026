import {
  Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsISO8601, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database, PlotStatus, PlotsTable } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { geometryTypeCode, reasonWithoutCoordinates, structuralIssues, type SupportedGeometry } from './geometry';

// P0-006 — Parcela (RF-06).
// Alcance: plot:read ve todas; plot:read_assigned solo parcelas de productores asignados a la membresía
// del usuario (misma política que productores). Igual para create/update.
// La geometría vive en plot_versions (inmutable). Métodos disponibles en esta historia: DECLARED (solo
// superficie declarada) y MANUAL_COORDINATES (coordenadas ingresadas). GPS (P0-007/P0-008) e importación
// (P0-009) se rechazan hasta implementarse. Validación GIS: P0-010 (estado NOT_VALIDATED).
// Eventos y auditoría sin coordenadas: solo identificadores, tipo, hash y método.

type PlotRow = Selectable<PlotsTable>;
export const PLOT_EDITABLE = ['name', 'crop', 'variety', 'land_use', 'province', 'canton', 'parish'] as const;
const EDITABLE = PLOT_EDITABLE;
export type PlotEditable = (typeof EDITABLE)[number];
type Editable = PlotEditable;
/** Procedencia de un cambio hecho por otro caso de uso (P0-026 Importación): motivo del historial y `source` en evento y auditoría. */
export interface PlotChangeSource { reason: string; source: Record<string, unknown> }
export const PLOT_CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
export const STRUCTURAL_RULE = 'STRUCTURAL_ONLY_V1';
const AVAILABLE_METHODS = ['DECLARED', 'MANUAL_COORDINATES'] as const;
const PENDING_METHODS: Record<string, string> = { GPS_POINT: 'P0-007', GPS_POLYGON: 'P0-008', FILE_IMPORT: 'P0-009' };

class PlotFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) variety?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) land_use?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) province?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) canton?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) parish?: string | null;
}

class CreatePlotDto extends PlotFieldsDto {
  @ApiProperty() @IsUUID() producer_id!: string;
  @ApiProperty({ example: 'PAR-0001' }) @Matches(PLOT_CODE, { message: 'plot_code: 1–40 caracteres alfanuméricos, . _ -' }) plot_code!: string;
  @ApiProperty({ description: 'Cultivo (obligatorio, doc 06)' }) @IsString() @Length(1, 60) crop!: string;
}

class UpdatePlotDto extends PlotFieldsDto {
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 60) crop?: string;
}

class CreateVersionDto {
  @ApiProperty({ description: 'row_version de la parcela leída' }) @IsInt() @Min(1) expected_version!: number;
  @ApiProperty({ enum: ['DECLARED', 'MANUAL_COORDINATES', 'GPS_POINT', 'GPS_POLYGON', 'FILE_IMPORT'] })
  @IsIn(['DECLARED', 'MANUAL_COORDINATES', 'GPS_POINT', 'GPS_POLYGON', 'FILE_IMPORT'])
  survey_method!: string;
  @ApiPropertyOptional({ description: 'GeoJSON Point/Polygon/MultiPolygon en WGS84 [lon, lat]' }) @IsOptional() @IsObject() geometry?: Record<string, unknown>;
  @ApiPropertyOptional({ description: 'Hectáreas declaradas' }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(99999999) area_declared_ha?: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() surveyed_at?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional({ description: 'A-01: motivo de la captura o corrección; queda en el historial y en la auditoría. La web lo exige al corregir una geometría existente' })
  @IsOptional() @IsString() @Length(3, 500) reason?: string;
}

class PreviewGeometryDto {
  @ApiProperty({ description: 'GeoJSON Point/Polygon/MultiPolygon en WGS84 con coordenadas [longitud, latitud]' }) @IsObject() geometry!: Record<string, unknown>;
}

class DeclaredAreaDto {
  @ApiProperty({ description: 'row_version de la parcela leída' }) @IsInt() @Min(1) expected_version!: number;
  @ApiProperty({ description: 'Hectáreas declaradas (> 0, hasta 4 decimales)' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(99999999) area_declared_ha!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

const CAPTURE_FUTURE_TOLERANCE_MS = 5 * 60_000;

class CaptureLocationDto {
  @ApiProperty({ description: 'row_version de la parcela leída' }) @IsInt() @Min(1) expected_version!: number;
  @ApiProperty({ description: 'Identificador del envío (idempotencia)' }) @IsUUID() operation_id!: string;
  @ApiProperty({ enum: ['BROWSER_GEOLOCATION'] }) @IsIn(['BROWSER_GEOLOCATION']) source!: 'BROWSER_GEOLOCATION';
  @ApiProperty({ description: 'Longitud WGS84 reportada' }) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180) longitude!: number;
  @ApiProperty({ description: 'Latitud WGS84 reportada' }) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-90) @Max(90) latitude!: number;
  @ApiProperty({ nullable: true, description: 'Precisión horizontal informada en metros (>= 0) o null si no se informó' })
  @IsDefined({ message: 'accuracy_m es obligatorio: envía null si el dispositivo no la informó' })
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  accuracy_m!: number | null;
  @ApiProperty({ description: 'Momento de adquisición informado por el dispositivo (ISO 8601)' }) @IsISO8601({ strict: true }) captured_at!: string;
}

class StatusDto {
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

class ListQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() producer_id?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'ALL']) status?: PlotStatus | 'ALL';
  @IsOptional() @IsIn(['WITH', 'WITHOUT']) geometry?: 'WITH' | 'WITHOUT';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

const blankToNull = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim());
const enc = (code: string, id: string) => Buffer.from(JSON.stringify([code, id])).toString('base64url');
function dec(c: string): [string, string] {
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string') return [v[0], v[1]];
  } catch {
    /* error abajo */
  }
  throw new AppError(400, 'INVALID_CURSOR', 'El cursor de paginación no es válido. Vuelve a la primera página.');
}

interface VersionView {
  id: string; version_number: number; geometry_type: string | null; geometry: unknown | null; geometry_hash: string | null;
  area_declared_ha: string | null; area_calculated_ha: string | null; survey_method: string; surveyed_at: Date | string | null;
  accuracy_m: string | null; validation_status: string; validation_rule_version: string; previous_version_id: string | null;
  notes: string | null; created_at: Date | string;
  geometry_visible: boolean;
  technically_valid: boolean | null;
  source_import_id: string | null;
  source_import_sha256: string | null;
  geometry_origin_version_id: string | null;
  geometry_origin_version_number: number | null;
  change_kind: 'GEOMETRY_CAPTURE' | 'DECLARED_AREA' | 'DECLARED_AREA_UPDATE';
  sample: null | {
    id: string; source: string; captured_at: Date | string; received_at: Date | string;
    horizontal_accuracy_m: number | null; longitude?: number; latitude?: number;
  };
}

/**
 * Columnas de versión. Sin permiso de geometría exacta las coordenadas NO se leen de la base (NULL en SQL):
 * la clasificación se aplica en el servidor, no ocultando datos en la interfaz (doc 06, UX_UI §22.3).
 */
const versionColumns = (withGeometry: boolean) => sql`
  v.id, v.version_number, v.geometry_type,
  ${withGeometry ? sql`ST_AsGeoJSON(v.geometry, 17)::jsonb` : sql`NULL::jsonb`} AS geometry,
  v.geometry_hash, v.area_declared_ha::text, v.area_calculated_ha::text, v.survey_method, v.surveyed_at, v.accuracy_m::text,
  v.validation_status, v.validation_rule_version, v.previous_version_id, v.notes, v.created_at,
  CASE WHEN v.geometry IS NULL THEN NULL ELSE (ST_IsValidDetail(v.geometry)).valid END AS technically_valid,
  ${withGeometry}::boolean AS geometry_visible,
  coalesce(v.source_import_id, (SELECT o.source_import_id FROM plot_versions o WHERE o.id = v.geometry_origin_version_id AND o.organization_id = v.organization_id)) AS source_import_id,
  (SELECT gi.sha256 FROM geometry_imports gi WHERE gi.organization_id = v.organization_id
     AND gi.id = coalesce(v.source_import_id, (SELECT o.source_import_id FROM plot_versions o WHERE o.id = v.geometry_origin_version_id AND o.organization_id = v.organization_id))) AS source_import_sha256,
  v.geometry_origin_version_id,
  (SELECT o.version_number FROM plot_versions o WHERE o.id = v.geometry_origin_version_id AND o.organization_id = v.organization_id) AS geometry_origin_version_number,
  CASE WHEN v.geometry_origin_version_id IS NOT NULL THEN 'DECLARED_AREA_UPDATE' WHEN v.geometry IS NULL THEN 'DECLARED_AREA' ELSE 'GEOMETRY_CAPTURE' END AS change_kind,
  CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
    'id', s.id, 'source', s.source, 'captured_at', s.captured_at, 'received_at', s.received_at,
    'horizontal_accuracy_m', s.horizontal_accuracy_m,
    'longitude', ${withGeometry ? sql`s.longitude` : sql`NULL::double precision`},
    'latitude', ${withGeometry ? sql`s.latitude` : sql`NULL::double precision`}
  )) || jsonb_build_object('horizontal_accuracy_m', s.horizontal_accuracy_m) END AS sample`;

@Injectable()
export class PlotsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  has(ctx: TenantContext, p: string) {
    return ctx.permissions.includes(p as never);
  }

  private async readContext(user: AuthUser, orgId: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, 'plot:read') && !this.has(ctx, 'plot:read_assigned') && !this.has(ctx, 'plot:read_own')) throw forbidden();
    return ctx;
  }

  /**
   * Alcance sobre una parcela (o su productor): amplio, por ASIGNACIÓN del técnico, o PROPIO del productor (A-01). El
   * alcance propio exige que la membresía sea la vinculada al productor (`self_membership_id`): el rol por sí solo no basta.
   */
  private inScope(ctx: TenantContext, producerAssignee: string | null, kind: 'read' | 'update' | 'create', producerSelf: string | null = null) {
    if (this.has(ctx, `plot:${kind}`)) return true;
    if (this.has(ctx, `plot:${kind}_assigned`) && producerAssignee === ctx.membershipId) return true;
    return this.has(ctx, `plot:${kind}_own`) && producerSelf !== null && producerSelf === ctx.membershipId;
  }

  /** Carga la parcela con el responsable de su productor; fuera de alcance = 404 (conocer el id no basta). */
  async load(db: Kysely<Database> | Transaction<Database>, ctx: TenantContext, id: string, kind: 'read' | 'update', lock = false) {
    let q = db.selectFrom('plots as pl')
      .innerJoin('producers as pr', (j) => j.onRef('pr.id', '=', 'pl.producer_id').onRef('pr.organization_id', '=', 'pl.organization_id'))
      .selectAll('pl')
      .select(['pr.assigned_membership_id as producer_assignee', 'pr.self_membership_id as producer_self', 'pr.producer_code', 'pr.first_name', 'pr.last_name', 'pr.legal_name', 'pr.status as producer_status'])
      .where('pl.organization_id', '=', ctx.organizationId)
      .where('pl.id', '=', id);
    if (lock) q = q.forUpdate('pl');
    const row = await q.executeTakeFirst();
    if (!row || !this.inScope(ctx, row.producer_assignee, 'read', row.producer_self)) throw notFound();
    if (kind === 'update' && !this.inScope(ctx, row.producer_assignee, 'update', row.producer_self)) throw forbidden();
    return row;
  }

  /** Permiso de geometría exacta (dentro del alcance ya comprobado por `load`). */
  geometryAllowed(ctx: TenantContext) {
    return this.has(ctx, 'plot:read_geometry');
  }

  async versionView(db: Kysely<Database> | Transaction<Database>, orgId: string, versionId: string | null, withGeometry: boolean): Promise<VersionView | null> {
    if (!versionId) return null;
    const r = await sql<VersionView>`
      SELECT ${versionColumns(withGeometry)}
      FROM plot_versions v LEFT JOIN location_samples s ON s.plot_version_id = coalesce(v.geometry_origin_version_id, v.id) AND s.organization_id = v.organization_id
      WHERE v.organization_id = ${orgId} AND v.id = ${versionId}`.execute(db);
    return r.rows[0] ?? null;
  }

  private view(p: PlotRow & { producer_code?: string; first_name?: string | null; last_name?: string | null; legal_name?: string | null }, current: VersionView | null) {
    return {
      id: p.id,
      plot_code: p.plot_code,
      name: p.name,
      crop: p.crop,
      variety: p.variety,
      land_use: p.land_use,
      province: p.province,
      canton: p.canton,
      parish: p.parish,
      status: p.status,
      producer: { id: p.producer_id, producer_code: p.producer_code, display_name: p.legal_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ') },
      row_version: Number(p.row_version),
      deleted_at: p.deleted_at,
      deletion_reason: p.deletion_reason,
      // Situación geométrica: sin versión / solo superficie declarada / con geometría (sin validar hasta P0-010).
      geometry_status: !current ? 'NONE' : current.geometry_type ? 'GEOMETRY_RECORDED' : 'DECLARED_AREA_ONLY',
      current_version: current,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  }

  private normalize(dto: PlotFieldsDto & { crop?: string }) {
    const out: Partial<Record<Editable, string | null>> = {};
    for (const f of EDITABLE) {
      const v = blankToNull((dto as Record<string, string | null | undefined>)[f]);
      if (v !== undefined) out[f] = v;
    }
    if (out.crop === null) throw new AppError(400, 'VALIDATION_FAILED', 'El cultivo es obligatorio.', [{ field: 'crop', reason: 'REQUIRED' }]);
    return out;
  }

  async recordHistory(trx: Transaction<Database>, p: PlotRow, changeType: string, changed: string[], actorId: string, reason?: string | null) {
    await trx.insertInto('plot_history').values({
      organization_id: p.organization_id, plot_id: p.id, row_version: String(p.row_version), change_type: changeType,
      changed_fields: changed, snapshot: JSON.stringify({ ...p, row_version: Number(p.row_version) }), reason: reason ?? null, changed_by: actorId,
    }).execute();
  }

  private mapConstraint(e: unknown): unknown {
    const c = (e as { constraint?: string }).constraint;
    if (c === 'plots_code_uq') return conflict('PLOT_CODE_TAKEN', 'Ya existe una parcela con ese código en tu organización.');
    if (c === 'plots_producer_fk') return new AppError(422, 'PRODUCER_NOT_AVAILABLE', 'El productor indicado no está disponible en esta organización.');
    return e;
  }

  async create(user: AuthUser, orgId: string, dto: CreatePlotDto, requestId?: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, 'plot:create') && !this.has(ctx, 'plot:create_assigned') && !this.has(ctx, 'plot:create_own')) throw forbidden();
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    const fields = this.normalize(dto);
    return this.db.transaction().execute(async (trx) => {
      const { plot, producer } = await this.createInTx(trx, ctx, user, dto.producer_id, dto.plot_code, { ...fields, crop: fields.crop ?? dto.crop.trim() }, requestId);
      return this.view({ ...plot, producer_code: producer.producer_code, first_name: producer.first_name, last_name: producer.last_name, legal_name: producer.legal_name }, null);
    });
  }

  /**
   * Alta dentro de una transacción del llamador (también P0-026 Importación). El llamador ya comprobó plot:create o
   * plot:create_assigned y la organización activa. Mismos efectos que create(): productor de la organización, en el
   * alcance de alta y no dado de baja (fuera de alcance o inexistente: misma respuesta), historial, evento y auditoría.
   */
  async createInTx(trx: Transaction<Database>, ctx: TenantContext, user: AuthUser, producerId: string, plotCode: string, fields: Partial<Record<Editable, string | null>> & { crop: string }, requestId?: string, from?: PlotChangeSource) {
    const orgId = ctx.organizationId;
    const producer = await trx.selectFrom('producers')
      .select(['id', 'status', 'assigned_membership_id', 'self_membership_id', 'producer_code', 'first_name', 'last_name', 'legal_name'])
      .where('organization_id', '=', orgId).where('id', '=', producerId).forShare().executeTakeFirst();
    // Productor de otra organización o fuera del alcance del usuario: misma respuesta (no revela existencia).
    if (!producer || !this.inScope(ctx, producer.assigned_membership_id, 'create', producer.self_membership_id)) {
      throw new AppError(422, 'PRODUCER_NOT_AVAILABLE', 'El productor indicado no está disponible para ti en esta organización.', [{ field: 'producer_id', reason: 'NOT_AVAILABLE' }]);
    }
    if (producer.status === 'INACTIVE') throw conflict('PRODUCER_INACTIVE', 'El productor está dado de baja; reactívalo antes de registrar parcelas.');
    const id = randomUUID();
    let p: PlotRow;
    try {
      p = await trx.insertInto('plots').values({
        ...fields, id, organization_id: orgId, producer_id: producer.id, plot_code: plotCode.trim(),
        status: 'ACTIVE', created_by: user.id, updated_by: user.id,
      } as never).returningAll().executeTakeFirstOrThrow();
    } catch (e) {
      throw this.mapConstraint(e);
    }
    const src = from ? { source: from.source } : {};
    await this.recordHistory(trx, p, 'CREATE', Object.keys(fields), user.id, from?.reason);
    await this.events.append(trx, {
      organizationId: orgId, eventType: 'PlotRegistered', schemaVersion: 1, aggregateType: 'PLOT', aggregateId: id,
      aggregateVersion: Number(p.row_version), actorId: user.id, correlationId: requestId,
      payload: { plot_code: p.plot_code, producer_id: p.producer_id, ...src },
    });
    await this.audit.record(trx, {
      organizationId: orgId, actorUserId: user.id, action: 'plot.create', entityType: 'plot', entityId: id, requestId,
      result: 'SUCCESS', after: { plot_code: p.plot_code, producer_id: p.producer_id, crop: p.crop, ...src },
    });
    return { plot: p, producer };
  }

  async list(user: AuthUser, orgId: string, q: ListQuery) {
    const ctx = await this.readContext(user, orgId);
    const limit = q.limit ?? 25;
    let query = this.db.selectFrom('plots as pl')
      .innerJoin('producers as pr', (j) => j.onRef('pr.id', '=', 'pl.producer_id').onRef('pr.organization_id', '=', 'pl.organization_id'))
      .leftJoin('plot_versions as v', (j) => j.onRef('v.id', '=', 'pl.current_version_id').onRef('v.organization_id', '=', 'pl.organization_id'))
      .selectAll('pl')
      .select(['pr.producer_code', 'pr.first_name', 'pr.last_name', 'pr.legal_name', 'v.geometry_type', 'v.area_declared_ha', 'v.area_calculated_ha', 'v.validation_status'])
      .where('pl.organization_id', '=', orgId);
    if (!this.has(ctx, 'plot:read')) {
      // Alcance estrecho: lo asignado al técnico y/o lo propio del productor, nunca el resto de la organización.
      const asignadas = this.has(ctx, 'plot:read_assigned');
      const propias = this.has(ctx, 'plot:read_own');
      query = query.where((eb) => eb.or([
        ...(asignadas ? [eb('pr.assigned_membership_id', '=', ctx.membershipId)] : []),
        ...(propias ? [eb('pr.self_membership_id', '=', ctx.membershipId)] : []),
      ]));
    }
    const status = q.status ?? 'ACTIVE';
    if (status !== 'ALL') query = query.where('pl.status', '=', status);
    if (q.producer_id) query = query.where('pl.producer_id', '=', q.producer_id);
    if (q.geometry === 'WITH') query = query.where('v.geometry_type', 'is not', null);
    if (q.geometry === 'WITHOUT') query = query.where((eb) => eb.or([eb('pl.current_version_id', 'is', null), eb('v.geometry_type', 'is', null)]));
    if (q.q?.trim()) {
      const like = `%${q.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      query = query.where((eb) => eb.or([eb('pl.plot_code', 'ilike', like), eb('pl.name', 'ilike', like), eb('pr.producer_code', 'ilike', like)]));
    }
    if (q.cursor) {
      const [code, id] = dec(q.cursor);
      query = query.where((eb) => eb.or([eb('pl.plot_code', '>', code), eb.and([eb('pl.plot_code', '=', code), eb('pl.id', '>', id)])]));
    }
    const rows = await query.orderBy('pl.plot_code').orderBy('pl.id').limit(limit + 1).execute();
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id, plot_code: r.plot_code, name: r.name, crop: r.crop, status: r.status, row_version: Number(r.row_version),
        producer: { id: r.producer_id, producer_code: r.producer_code, display_name: r.legal_name ?? [r.first_name, r.last_name].filter(Boolean).join(' ') },
        geometry_status: !r.current_version_id ? 'NONE' : r.geometry_type ? 'GEOMETRY_RECORDED' : 'DECLARED_AREA_ONLY',
        geometry_type: r.geometry_type, area_declared_ha: r.area_declared_ha, area_calculated_ha: r.area_calculated_ha, validation_status: r.validation_status,
      })),
      next_cursor: rows.length > limit ? enc(page[page.length - 1].plot_code, page[page.length - 1].id) : null,
    };
  }

  async get(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.readContext(user, orgId);
    const p = await this.load(this.db, ctx, id, 'read');
    const active = ctx.organizationStatus === 'ACTIVE';
    return {
      ...this.view(p, await this.versionView(this.db, orgId, p.current_version_id, this.geometryAllowed(ctx))),
      geometry_access: this.geometryAllowed(ctx),
      can_update: active && p.status === 'ACTIVE' && this.inScope(ctx, p.producer_assignee, 'update', p.producer_self),
      can_capture_location: active && p.status === 'ACTIVE' && this.inScope(ctx, p.producer_assignee, 'update', p.producer_self) && this.geometryAllowed(ctx),
      can_evaluate_gis: active && (this.has(ctx, 'plot:evaluate_gis') || (this.has(ctx, 'plot:evaluate_gis_assigned') && this.inScope(ctx, p.producer_assignee, 'read', p.producer_self))),
      can_archive: active && this.has(ctx, 'plot:archive'),
    };
  }

  async update(user: AuthUser, orgId: string, id: string, dto: UpdatePlotDto, requestId?: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, 'plot:update') && !this.has(ctx, 'plot:update_assigned') && !this.has(ctx, 'plot:update_own')) throw forbidden();
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    const { expected_version, ...rest } = dto;
    const patch = this.normalize(rest);
    if (Object.keys(patch).length === 0) throw conflict('NO_CHANGE', 'No hay cambios que guardar.');
    return this.db.transaction().execute(async (trx) => {
      const { before, after } = await this.updateInTx(trx, ctx, user, id, expected_version, patch, requestId);
      return this.view({ ...after, producer_code: before.producer_code, first_name: before.first_name, last_name: before.last_name, legal_name: before.legal_name },
        await this.versionView(trx, orgId, after.current_version_id, this.geometryAllowed(ctx)));
    });
  }

  /**
   * Edición dentro de una transacción del llamador (también P0-026 Importación). El llamador ya comprobó plot:update o
   * plot:update_assigned y la organización activa. Mismos controles que update(): alcance actual (bloqueo), parcela activa,
   * versión esperada, solo campos que cambian; historial, evento y auditoría. No toca productor, estado ni geometría.
   */
  async updateInTx(trx: Transaction<Database>, ctx: TenantContext, user: AuthUser, id: string, expectedVersion: number, patch: Partial<Record<Editable, string | null>>, requestId?: string, from?: PlotChangeSource) {
    const orgId = ctx.organizationId;
    const before = await this.load(trx, ctx, id, 'update', true);
    if (before.status === 'INACTIVE') throw conflict('PLOT_INACTIVE', 'La parcela está dada de baja; reactívala para editarla.');
    if (Number(before.row_version) !== expectedVersion) throw conflict('VERSION_CONFLICT', 'Otra persona modificó esta parcela. Recarga para ver la versión actual.');
    if (patch.crop === null) throw new AppError(400, 'VALIDATION_FAILED', 'El cultivo es obligatorio.', [{ field: 'crop', reason: 'REQUIRED' }]);
    const changed = (Object.keys(patch) as Editable[]).filter((k) => patch[k] !== before[k]);
    if (changed.length === 0) throw conflict('NO_CHANGE', 'No hay cambios que guardar.');
    const after = await trx.updateTable('plots')
      .set({ ...Object.fromEntries(changed.map((k) => [k, patch[k]])), updated_by: user.id, updated_at: new Date(), row_version: sql`row_version + 1` } as never)
      .where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
    const src = from ? { source: from.source } : {};
    await this.recordHistory(trx, after, 'UPDATE', changed, user.id, from?.reason);
    await this.events.append(trx, {
      organizationId: orgId, eventType: 'PlotUpdated', schemaVersion: 1, aggregateType: 'PLOT', aggregateId: id,
      aggregateVersion: Number(after.row_version), actorId: user.id, correlationId: requestId, payload: { changed_fields: changed, ...src },
    });
    await this.audit.record(trx, {
      organizationId: orgId, actorUserId: user.id, action: 'plot.update', entityType: 'plot', entityId: id, requestId,
      result: 'SUCCESS', after: { changed_fields: changed, version: Number(after.row_version), ...src },
    });
    return { before, after, changed };
  }

  /**
   * Superficie declarada (adopción para desarrollo local 2026-10-12, docs/decisiones/SUPERFICIE-DECLARADA-CONSERVA-GEOMETRIA.md).
   * Un solo caso de uso para formulario (POST declared-area y geometry-versions con método DECLARED) e importación (P0-026).
   * Crea una versión NUEVA (append-only) que pasa a ser la actual; las anteriores no cambian:
   * - sin geometría vigente: versión DECLARED solo con superficie (como antes);
   * - con geometría vigente: la versión COPIA la geometría, su hash, su superficie calculada y sus datos de captura
   *   (método, fecha, precisión) y apunta a la versión capturada (geometry_origin_version_id). No es una captura nueva:
   *   change_kind = DECLARED_AREA_UPDATE y evento PlotDeclaredAreaUpdated (no PlotGeometryVersionCreated).
   * Declarada y calculada siguen separadas. validation_status = NOT_VALIDATED: no hereda evaluaciones GIS (las anteriores
   * siguen ligadas a su versión) ni aprobación alguna. Misma superficie → NO_CHANGE.
   */
  async updateDeclaredAreaInTx(trx: Transaction<Database>, ctx: TenantContext, user: AuthUser, id: string, expectedVersion: number, areaHa: string, requestId?: string, from?: Partial<PlotChangeSource> & { notes?: string }) {
    const orgId = ctx.organizationId;
    const plot = await this.load(trx, ctx, id, 'update', true);
    if (plot.status === 'INACTIVE') throw conflict('PLOT_INACTIVE', 'La parcela está dada de baja.');
    if (Number(plot.row_version) !== expectedVersion) throw conflict('VERSION_CONFLICT', 'Otra persona modificó esta parcela. Recarga para ver la versión actual.');
    const cur = plot.current_version_id
      ? await trx.selectFrom('plot_versions').selectAll().where('organization_id', '=', orgId).where('id', '=', plot.current_version_id).executeTakeFirstOrThrow()
      : null;
    if (cur?.area_declared_ha != null && Number(cur.area_declared_ha) === Number(areaHa)) throw conflict('NO_CHANGE', 'Esa superficie declarada ya es la vigente.');
    const last = await trx.selectFrom('plot_versions').select(sql<number>`coalesce(max(version_number), 0)::int`.as('n'))
      .where('organization_id', '=', orgId).where('plot_id', '=', id).executeTakeFirstOrThrow();
    const versionId = randomUUID();
    const keeps = !!cur?.geometry_type;
    const origin = keeps ? (cur!.geometry_origin_version_id ?? cur!.id) : null;
    const notes = [from?.notes, from?.reason].filter(Boolean).join(' · ') || null;
    if (keeps) {
      await sql`
        INSERT INTO plot_versions (id, organization_id, plot_id, version_number, geometry, geometry_type, geometry_hash,
          area_declared_ha, area_calculated_ha, survey_method, surveyed_at, accuracy_m, validation_status, validation_rule_version,
          previous_version_id, notes, created_by, geometry_origin_version_id)
        SELECT ${versionId}, c.organization_id, c.plot_id, ${last.n + 1}, c.geometry, c.geometry_type, c.geometry_hash,
          ${areaHa}::numeric, c.area_calculated_ha, c.survey_method, c.surveyed_at, c.accuracy_m, 'NOT_VALIDATED', ${STRUCTURAL_RULE},
          c.id, ${notes}, ${user.id}, ${origin}
        FROM plot_versions c WHERE c.id = ${cur!.id} AND c.organization_id = ${orgId}`.execute(trx);
    } else {
      await sql`
        INSERT INTO plot_versions (id, organization_id, plot_id, version_number, geometry, geometry_type, geometry_hash,
          area_declared_ha, area_calculated_ha, survey_method, surveyed_at, accuracy_m, validation_status, validation_rule_version,
          previous_version_id, notes, created_by)
        VALUES (${versionId}, ${orgId}, ${id}, ${last.n + 1}, NULL, NULL, NULL, ${areaHa}::numeric, NULL, 'DECLARED', NULL, NULL,
          'NOT_VALIDATED', ${STRUCTURAL_RULE}, ${plot.current_version_id}, ${notes}, ${user.id})`.execute(trx);
    }
    const after = await trx.updateTable('plots')
      .set({ current_version_id: versionId, updated_by: user.id, updated_at: new Date(), row_version: sql`row_version + 1` })
      .where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
    const src = from?.source ? { source: from.source } : {};
    await this.recordHistory(trx, after, keeps ? 'DECLARED_AREA' : 'GEOMETRY_VERSION', ['current_version_id'], user.id, from?.reason);
    const payload = {
      plot_version_id: versionId, version_number: last.n + 1, previous_version_id: plot.current_version_id,
      change_kind: keeps ? 'DECLARED_AREA_UPDATE' : 'DECLARED_AREA', geometry_origin_version_id: origin,
      geometry_type: cur?.geometry_type ?? null, geometry_hash: keeps ? cur!.geometry_hash : null, survey_method: keeps ? cur!.survey_method : 'DECLARED', ...src,
    };
    await this.events.append(trx, {
      organizationId: orgId, eventType: keeps ? 'PlotDeclaredAreaUpdated' : 'PlotGeometryVersionCreated', schemaVersion: 1, aggregateType: 'PLOT', aggregateId: id,
      aggregateVersion: Number(after.row_version), actorId: user.id, correlationId: requestId, payload,
    });
    await this.audit.record(trx, {
      organizationId: orgId, actorUserId: user.id, action: keeps ? 'plot.declared_area_update' : 'plot.geometry_version', entityType: 'plot', entityId: id, requestId,
      result: 'SUCCESS', after: { plot_version_id: versionId, version_number: last.n + 1, change_kind: payload.change_kind, geometry_origin_version_id: origin, geometry_kept: keeps, ...src },
    });
    return { plot, after, versionId, keptGeometry: keeps };
  }

  /** Formulario: actualizar la superficie declarada (conserva la geometría vigente). */
  async updateDeclaredArea(user: AuthUser, orgId: string, id: string, dto: DeclaredAreaDto, requestId?: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, 'plot:update') && !this.has(ctx, 'plot:update_assigned') && !this.has(ctx, 'plot:update_own')) throw forbidden();
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return this.db.transaction().execute(async (trx) => {
      const r = await this.updateDeclaredAreaInTx(trx, ctx, user, id, dto.expected_version, String(dto.area_declared_ha), requestId, dto.notes ? { notes: dto.notes } : undefined);
      const version = (await this.versionView(trx, orgId, r.versionId, this.geometryAllowed(ctx)))!;
      return { plot: this.view({ ...r.after, producer_code: r.plot.producer_code, first_name: r.plot.first_name, last_name: r.plot.last_name, legal_name: r.plot.legal_name }, version), version, geometry_kept: r.keptGeometry };
    });
  }

  /** P0-026: parcelas de la organización por código, con el responsable de su productor y la versión vigente (sin coordenadas). */
  async byCodes(db: Kysely<Database> | Transaction<Database>, orgId: string, codes: string[], lock = false) {
    if (codes.length === 0) return new Map<string, PlotRow & { producer_assignee: string | null; producer_code: string; current_geometry_type: string | null; current_area_declared_ha: string | null }>();
    let q = db.selectFrom('plots as pl')
      .innerJoin('producers as pr', (j) => j.onRef('pr.id', '=', 'pl.producer_id').onRef('pr.organization_id', '=', 'pl.organization_id'))
      .leftJoin('plot_versions as v', (j) => j.onRef('v.id', '=', 'pl.current_version_id').onRef('v.organization_id', '=', 'pl.organization_id'))
      .selectAll('pl')
      .select(['pr.assigned_membership_id as producer_assignee', 'pr.self_membership_id as producer_self', 'pr.producer_code', 'v.geometry_type as current_geometry_type', sql<string | null>`v.area_declared_ha::text`.as('current_area_declared_ha')])
      .where('pl.organization_id', '=', orgId).where('pl.plot_code', 'in', codes);
    if (lock) q = q.orderBy('pl.id').forUpdate('pl');
    return new Map((await q.execute()).map((r) => [r.plot_code, r]));
  }

  /** P0-026: alcance de un contexto sobre una parcela/productor (misma regla que load() y create()). */
  scope(ctx: TenantContext, producerAssignee: string | null, producerSelf: string | null = null) {
    return { read: this.inScope(ctx, producerAssignee, 'read', producerSelf), update: this.inScope(ctx, producerAssignee, 'update', producerSelf), create: this.inScope(ctx, producerAssignee, 'create', producerSelf) };
  }

  /**
   * A-01 — Revisión PREVIA de una geometría escrita o dibujada en la web: la misma validación del servidor (estructura y
   * validez topológica con PostGIS, superficie geodésica) SIN guardar nada. El navegador nunca decide por sí solo si una
   * geometría es válida. Declara el orden de las coordenadas y que una coordenada escrita NO es una medición GPS.
   */
  async previewGeometry(user: AuthUser, orgId: string, id: string, dto: PreviewGeometryDto) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, 'plot:update') && !this.has(ctx, 'plot:update_assigned') && !this.has(ctx, 'plot:update_own')) throw forbidden();
    if (!this.geometryAllowed(ctx)) throw forbidden('PERMISSION_DENIED', 'Tu rol no permite registrar coordenadas exactas.');
    const plot = await this.load(this.db, ctx, id, 'update');
    const issues = structuralIssues(dto.geometry);
    const base = {
      order: 'Cada posición es [longitud, latitud] en WGS84 (EPSG:4326): primero la longitud (este-oeste), luego la latitud (norte-sur).',
      provenance: {
        survey_method: 'MANUAL_COORDINATES',
        is_gps_measurement: false,
        note: 'Coordenadas escritas o dibujadas por una persona: NO acreditan una medición GPS ni su precisión.',
      },
      will_create_version: true,
      current_version_id: plot.current_version_id,
    };
    if (issues.length) {
      return { ...base, structurally_valid: false, issues: issues.map((i) => ({ path: i.path, reason: i.reason })), geometry_type: null, technically_valid: null, validity_reason: null, area_calculated_ha: null, vertex_count: 0, bbox: null };
    }
    const geojson = JSON.stringify(dto.geometry);
    const typeCode = geometryTypeCode(dto.geometry as unknown as SupportedGeometry);
    const r = await sql<{ valid: boolean; reason: string | null; area: string | null; n: number; bbox: string }>`
      WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}::text), 4326) AS geom)
      SELECT (ST_IsValidDetail(geom)).valid AS valid, (ST_IsValidDetail(geom)).reason AS reason,
             CASE WHEN ${typeCode}::text IN ('POLYGON','MULTIPOLYGON') AND (ST_IsValidDetail(geom)).valid
                  THEN round((ST_Area(geom::geography) / 10000)::numeric, 6)::text ELSE NULL END AS area,
             ST_NPoints(geom) AS n,
             concat_ws(',', ST_XMin(geom), ST_YMin(geom), ST_XMax(geom), ST_YMax(geom)) AS bbox
      FROM g`.execute(this.db);
    const row = r.rows[0];
    const [minx, miny, maxx, maxy] = row.bbox.split(',').map(Number);
    return {
      ...base,
      structurally_valid: true, issues: [],
      geometry_type: typeCode,
      technically_valid: typeCode === 'POINT' ? null : row.valid,
      validity_reason: row.valid ? null : reasonWithoutCoordinates(row.reason ?? ''),
      area_calculated_ha: row.area,
      vertex_count: row.n,
      bbox: { min_longitude: minx, min_latitude: miny, max_longitude: maxx, max_latitude: maxy },
    };
  }

  /** Crea una versión geométrica nueva (inmutable) y la marca como actual. La anterior no cambia. */
  async createVersion(user: AuthUser, orgId: string, id: string, dto: CreateVersionDto, requestId?: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, 'plot:update') && !this.has(ctx, 'plot:update_assigned') && !this.has(ctx, 'plot:update_own')) throw forbidden();
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    if (dto.geometry && !this.geometryAllowed(ctx)) throw forbidden('PERMISSION_DENIED', 'Tu rol no permite registrar coordenadas exactas.');
    if (PENDING_METHODS[dto.survey_method]) {
      throw new AppError(422, 'SURVEY_METHOD_NOT_AVAILABLE', `El método ${dto.survey_method} aún no está disponible (${PENDING_METHODS[dto.survey_method]}).`, [{ field: 'survey_method', reason: 'NOT_IMPLEMENTED' }]);
    }
    if (!(AVAILABLE_METHODS as readonly string[]).includes(dto.survey_method)) throw new AppError(422, 'SURVEY_METHOD_NOT_AVAILABLE', 'Método no admitido.');
    if (dto.survey_method === 'DECLARED') {
      if (dto.geometry) throw new AppError(400, 'VALIDATION_FAILED', 'Una superficie declarada no lleva geometría.', [{ field: 'geometry', reason: 'NOT_ALLOWED_FOR_DECLARED' }]);
      if (dto.area_declared_ha === undefined) throw new AppError(400, 'VALIDATION_FAILED', 'Indica la superficie declarada en hectáreas.', [{ field: 'area_declared_ha', reason: 'REQUIRED' }]);
      // Superficie declarada: el mismo caso de uso que el formulario y la importación (conserva la geometría vigente).
      return this.db.transaction().execute(async (trx) => {
        const r = await this.updateDeclaredAreaInTx(trx, ctx, user, id, dto.expected_version, String(dto.area_declared_ha), requestId, dto.notes ? { notes: dto.notes } : undefined);
        const version = (await this.versionView(trx, orgId, r.versionId, this.geometryAllowed(ctx)))!;
        return { plot: this.view({ ...r.after, producer_code: r.plot.producer_code, first_name: r.plot.first_name, last_name: r.plot.last_name, legal_name: r.plot.legal_name }, version), version };
      });
    } else {
      if (!dto.geometry) throw new AppError(400, 'VALIDATION_FAILED', 'Indica la geometría (GeoJSON en WGS84).', [{ field: 'geometry', reason: 'REQUIRED' }]);
      const issues = structuralIssues(dto.geometry);
      if (issues.length) {
        throw new AppError(422, 'GEOMETRY_STRUCTURE_INVALID', 'La geometría no tiene una estructura válida para almacenarse.', issues.map((i) => ({ field: i.path, reason: i.reason })));
      }
    }
    return this.db.transaction().execute(async (trx) => {
      const plot = await this.load(trx, ctx, id, 'update', true);
      if (plot.status === 'INACTIVE') throw conflict('PLOT_INACTIVE', 'La parcela está dada de baja.');
      if (Number(plot.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó esta parcela. Recarga para ver la versión actual.');
      const last = await trx.selectFrom('plot_versions').select(sql<number>`coalesce(max(version_number), 0)::int`.as('n'))
        .where('organization_id', '=', orgId).where('plot_id', '=', id).executeTakeFirstOrThrow();
      const versionId = randomUUID();
      const geojson = dto.geometry ? JSON.stringify(dto.geometry) : null;
      const typeCode = dto.geometry ? geometryTypeCode(dto.geometry as unknown as SupportedGeometry) : null;
      // Superficie calculada: solo polígonos topológicamente válidos, con geodesia (geography) en hectáreas.
      // Puntos: NULL (un punto no tiene superficie). Polígono no válido: NULL (desconocida hasta P0-010).
      await sql`
        WITH g AS (SELECT CASE WHEN ${geojson}::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON(${geojson}::text), 4326) END AS geom)
        INSERT INTO plot_versions (id, organization_id, plot_id, version_number, geometry, geometry_type, geometry_hash,
          area_declared_ha, area_calculated_ha, survey_method, surveyed_at, accuracy_m, validation_status, validation_rule_version,
          previous_version_id, notes, created_by)
        SELECT ${versionId}, ${orgId}, ${id}, ${last.n + 1}, g.geom, ${typeCode}::text,
          CASE WHEN g.geom IS NULL THEN NULL ELSE encode(sha256(ST_AsBinary(g.geom)), 'hex') END,
          ${dto.area_declared_ha ?? null}::numeric,
          CASE WHEN ${typeCode}::text IN ('POLYGON','MULTIPOLYGON') AND (ST_IsValidDetail(g.geom)).valid THEN round((ST_Area(g.geom::geography) / 10000)::numeric, 6) ELSE NULL END,
          ${dto.survey_method}, ${dto.surveyed_at ?? null}::timestamptz, NULL, 'NOT_VALIDATED', ${STRUCTURAL_RULE},
          ${plot.current_version_id}, ${dto.notes ?? null}, ${user.id}
        FROM g`.execute(trx);
      const after = await trx.updateTable('plots')
        .set({ current_version_id: versionId, updated_by: user.id, updated_at: new Date(), row_version: sql`row_version + 1` })
        .where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
      const version = (await this.versionView(trx, orgId, versionId, this.geometryAllowed(ctx)))!;
      await this.recordHistory(trx, after, 'GEOMETRY_VERSION', ['current_version_id'], user.id, dto.reason);
      await this.events.append(trx, {
        organizationId: orgId, eventType: 'PlotGeometryVersionCreated', schemaVersion: 1, aggregateType: 'PLOT', aggregateId: id,
        aggregateVersion: Number(after.row_version), actorId: user.id, correlationId: requestId,
        payload: {
          plot_version_id: versionId, version_number: version.version_number, previous_version_id: version.previous_version_id,
          geometry_type: version.geometry_type, geometry_hash: version.geometry_hash, survey_method: version.survey_method,
        },
      });
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'plot.geometry_version', entityType: 'plot', entityId: id, requestId,
        result: 'SUCCESS', reason: dto.reason, after: { plot_version_id: versionId, version_number: version.version_number, geometry_type: version.geometry_type, survey_method: version.survey_method },
      });
      return { plot: this.view({ ...after, producer_code: plot.producer_code, first_name: plot.first_name, last_name: plot.last_name, legal_name: plot.legal_name }, version), version };
    });
  }

  /**
   * P0-007: registra una muestra de ubicación reportada por el navegador y crea, en la misma transacción,
   * una versión POINT (método BROWSER_GEOLOCATION) que pasa a ser la actual. Idempotente por operation_id:
   * repetir el mismo envío devuelve el resultado original; reutilizar el id con otro contenido es conflicto.
   * La superficie declarada vigente se arrastra a la nueva versión (no es un dato de la captura); la
   * superficie calculada queda NULL (un punto no tiene superficie).
   */
  /**
   * `native` solo lo pasa la sincronización (P0-024) tras validar sesión y dispositivo: procedencia DEVICE_LOCATION_SERVICE
   * (servicio de ubicación del sistema; no se afirma GPS ni autenticidad física), con detalle del proveedor y marca de
   * simulación informada. La API pública sigue aceptando solo BROWSER_GEOLOCATION.
   */
  async captureLocation(user: AuthUser, orgId: string, id: string, dto: CaptureLocationDto, requestId?: string, native?: { provider_detail: string; mocked: boolean | null; device_id: string }) {
    const source = native ? 'DEVICE_LOCATION_SERVICE' as const : 'BROWSER_GEOLOCATION' as const;
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, 'plot:update') && !this.has(ctx, 'plot:update_assigned') && !this.has(ctx, 'plot:update_own')) throw forbidden();
    if (!this.geometryAllowed(ctx)) throw forbidden('PERMISSION_DENIED', 'Tu rol no permite registrar ubicaciones exactas.');
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    const capturedAt = new Date(dto.captured_at);
    if (capturedAt.getTime() > Date.now() + CAPTURE_FUTURE_TOLERANCE_MS) {
      throw new AppError(422, 'CAPTURED_AT_IN_FUTURE', 'La hora de adquisición informada está en el futuro. Revisa el reloj del dispositivo y vuelve a capturar.', [{ field: 'captured_at', reason: 'IN_FUTURE' }]);
    }
    const payloadHash = createHash('sha256').update(JSON.stringify(native ? [id, source, dto.longitude, dto.latitude, dto.accuracy_m, capturedAt.toISOString(), native.provider_detail, native.mocked]
      : [id, dto.source, dto.longitude, dto.latitude, dto.accuracy_m, capturedAt.toISOString()])).digest('hex');

    const replay = async () => {
      const prior = await this.db.selectFrom('location_samples').select(['plot_id', 'plot_version_id', 'payload_hash'])
        .where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
      if (!prior) return null;
      if (prior.plot_id !== id || prior.payload_hash !== payloadHash) {
        throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otros datos. Captura de nuevo.');
      }
      const plot = await this.load(this.db, ctx, id, 'read');
      return { replayed: true, version: (await this.versionView(this.db, orgId, prior.plot_version_id, true))!, plot_row_version: Number(plot.row_version) };
    };
    const earlier = await replay();
    if (earlier) return earlier;

    try {
      const result = await this.db.transaction().execute(async (trx) => {
        // El alcance se comprueba al guardar: si el productor se reasignó a otro técnico, se rechaza.
        const plot = await this.load(trx, ctx, id, 'update', true);
        // Envío simultáneo con el mismo operation_id: tras esperar el bloqueo, el original ya existe.
        const already = await trx.selectFrom('location_samples').select('id').where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
        if (already) return null;
        if (plot.status === 'INACTIVE') throw conflict('PLOT_INACTIVE', 'La parcela está dada de baja.');
        if (Number(plot.row_version) !== dto.expected_version) {
          throw conflict('VERSION_CONFLICT', 'La parcela cambió mientras capturabas. Tu muestra se conserva: recarga y vuelve a guardarla.');
        }
        const previous = plot.current_version_id
          ? await trx.selectFrom('plot_versions').select('area_declared_ha').where('organization_id', '=', orgId).where('id', '=', plot.current_version_id).executeTakeFirst()
          : undefined;
        const last = await trx.selectFrom('plot_versions').select(sql<number>`coalesce(max(version_number), 0)::int`.as('n'))
          .where('organization_id', '=', orgId).where('plot_id', '=', id).executeTakeFirstOrThrow();
        const versionId = randomUUID();
        // ST_MakePoint(x = longitud, y = latitud): orden GeoJSON/PostGIS.
        await sql`
          WITH g AS (SELECT ST_SetSRID(ST_MakePoint(${dto.longitude}::double precision, ${dto.latitude}::double precision), 4326) AS geom)
          INSERT INTO plot_versions (id, organization_id, plot_id, version_number, geometry, geometry_type, geometry_hash,
            area_declared_ha, area_calculated_ha, survey_method, surveyed_at, accuracy_m, validation_status, validation_rule_version,
            previous_version_id, notes, created_by)
          SELECT ${versionId}, ${orgId}, ${id}, ${last.n + 1}, g.geom, 'POINT', encode(sha256(ST_AsBinary(g.geom)), 'hex'),
            ${previous?.area_declared_ha ?? null}::numeric, NULL, ${source}, ${capturedAt.toISOString()}::timestamptz,
            ${dto.accuracy_m === null ? null : Math.round(dto.accuracy_m * 100) / 100}::numeric, 'NOT_VALIDATED', ${STRUCTURAL_RULE},
            ${plot.current_version_id}, NULL, ${user.id}
          FROM g`.execute(trx);
        const sampleId = randomUUID();
        await trx.insertInto('location_samples').values({
          id: sampleId, organization_id: orgId, plot_id: id, plot_version_id: versionId, source,
          provider_detail: native?.provider_detail ?? null, mocked: native ? native.mocked : null, device_id: native?.device_id ?? null,
          longitude: dto.longitude, latitude: dto.latitude, horizontal_accuracy_m: dto.accuracy_m, captured_at: capturedAt,
          operation_id: dto.operation_id, payload_hash: payloadHash, created_by: user.id,
        }).execute();
        const after = await trx.updateTable('plots')
          .set({ current_version_id: versionId, updated_by: user.id, updated_at: new Date(), row_version: sql`row_version + 1` })
          .where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
        await this.recordHistory(trx, after, 'GEOMETRY_VERSION', ['current_version_id'], user.id);
        // Evento y auditoría sin coordenadas exactas.
        await this.events.append(trx, {
          organizationId: orgId, eventType: 'PlotGeometryVersionCreated', schemaVersion: 1, aggregateType: 'PLOT', aggregateId: id,
          aggregateVersion: Number(after.row_version), actorId: user.id, correlationId: requestId, operationId: dto.operation_id,
          payload: {
            plot_version_id: versionId, version_number: last.n + 1, previous_version_id: plot.current_version_id, geometry_type: 'POINT',
            survey_method: source, location_sample_id: sampleId, accuracy_reported: dto.accuracy_m !== null,
          },
        });
        await this.audit.record(trx, {
          organizationId: orgId, actorUserId: user.id, action: 'plot.location_capture', entityType: 'plot', entityId: id, requestId, result: 'SUCCESS',
          after: { plot_version_id: versionId, location_sample_id: sampleId, source, accuracy_reported: dto.accuracy_m !== null },
        });
        return { replayed: false, version: (await this.versionView(trx, orgId, versionId, true))!, plot_row_version: Number(after.row_version) };
      });
      return result ?? (await replay())!;
    } catch (e) {
      // Dos envíos simultáneos del mismo operation_id: el segundo choca con la unicidad y recibe el original.
      if ((e as { constraint?: string }).constraint === 'location_samples_operation_uq') {
        const again = await replay();
        if (again) return again;
      }
      throw e;
    }
  }

  async versions(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.readContext(user, orgId);
    const p = await this.load(this.db, ctx, id, 'read');
    const r = await sql<VersionView>`
      SELECT ${versionColumns(this.geometryAllowed(ctx))}
      FROM plot_versions v LEFT JOIN location_samples s ON s.plot_version_id = coalesce(v.geometry_origin_version_id, v.id) AND s.organization_id = v.organization_id
      WHERE v.organization_id = ${orgId} AND v.plot_id = ${id} ORDER BY v.version_number DESC`.execute(this.db);
    return r.rows.map((v) => ({ ...v, is_current: v.id === p.current_version_id }));
  }

  async history(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.readContext(user, orgId);
    await this.load(this.db, ctx, id, 'read');
    const rows = await this.db.selectFrom('plot_history as h')
      .leftJoin('memberships as m', (j) => j.onRef('m.user_id', '=', 'h.changed_by').onRef('m.organization_id', '=', 'h.organization_id'))
      .leftJoin('users as u', 'u.id', 'm.user_id')
      .select(['h.row_version', 'h.change_type', 'h.changed_fields', 'h.reason', 'h.changed_at', 'u.email as actor_email'])
      .where('h.organization_id', '=', orgId).where('h.plot_id', '=', id).orderBy('h.row_version', 'desc').execute();
    return rows.map((r) => ({ version: Number(r.row_version), change_type: r.change_type, changed_fields: r.changed_fields, reason: r.reason, changed_at: r.changed_at, actor: r.actor_email ?? 'PLATFORM' }));
  }

  async changeStatus(user: AuthUser, orgId: string, id: string, target: PlotStatus, dto: StatusDto, requestId?: string) {
    const ctx = await this.authz.require(user, orgId, 'plot:archive', { mutation: true });
    return this.db.transaction().execute(async (trx) => {
      const before = await this.load(trx, ctx, id, 'read', true);
      if (Number(before.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó esta parcela. Recarga.');
      if (before.status === target) throw conflict('INVALID_TRANSITION', 'La parcela ya está en ese estado.');
      const archiving = target === 'INACTIVE';
      const after = await trx.updateTable('plots').set({
        status: target, deleted_at: archiving ? new Date() : null, deleted_by: archiving ? user.id : null, deletion_reason: archiving ? dto.reason : null,
        updated_by: user.id, updated_at: new Date(), row_version: sql`row_version + 1`,
      }).where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
      await this.recordHistory(trx, after, archiving ? 'ARCHIVE' : 'ACTIVATE', ['status'], user.id, dto.reason);
      await this.events.append(trx, {
        organizationId: orgId, eventType: 'PlotStatusChanged', schemaVersion: 1, aggregateType: 'PLOT', aggregateId: id,
        aggregateVersion: Number(after.row_version), actorId: user.id, correlationId: requestId, payload: { from_status: before.status, to_status: target },
      });
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: archiving ? 'plot.archive' : 'plot.activate', entityType: 'plot', entityId: id,
        requestId, result: 'SUCCESS', reason: dto.reason, before: { status: before.status }, after: { status: target },
      });
      return this.view({ ...after, producer_code: before.producer_code, first_name: before.first_name, last_name: before.last_name, legal_name: before.legal_name },
        await this.versionView(trx, orgId, after.current_version_id, this.geometryAllowed(ctx)));
    });
  }
}

@ApiTags('plots')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/plots')
export class PlotsController {
  constructor(private readonly service: PlotsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: CreatePlotDto, @Req() req: AuthedRequest) {
    return this.service.create(user, orgId, dto, req.requestId);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: ListQuery) {
    return this.service.list(user, orgId, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, orgId, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlotDto, @Req() req: AuthedRequest) {
    return this.service.update(user, orgId, id, dto, req.requestId);
  }

  @Get(':id/geometry-versions')
  versions(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.versions(user, orgId, id);
  }

  @Post(':id/geometry-preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'A-01: revisión previa (no guarda) de una geometría escrita o dibujada, validada en el servidor' })
  previewGeometry(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PreviewGeometryDto) {
    return this.service.previewGeometry(user, orgId, id, dto);
  }

  @Post(':id/geometry-versions')
  createVersion(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateVersionDto, @Req() req: AuthedRequest) {
    return this.service.createVersion(user, orgId, id, dto, req.requestId);
  }

  @Post(':id/declared-area')
  declaredArea(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclaredAreaDto, @Req() req: AuthedRequest) {
    return this.service.updateDeclaredArea(user, orgId, id, dto, req.requestId);
  }

  @Post(':id/location-samples')
  async captureLocation(
    @CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CaptureLocationDto, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.service.captureLocation(user, orgId, id, dto, req.requestId);
    if (r.replayed) res.status(200);
    return r;
  }

  @Get(':id/history')
  history(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.history(user, orgId, id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto, @Req() req: AuthedRequest) {
    return this.service.changeStatus(user, orgId, id, 'INACTIVE', dto, req.requestId);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto, @Req() req: AuthedRequest) {
    return this.service.changeStatus(user, orgId, id, 'ACTIVE', dto, req.requestId);
  }
}
