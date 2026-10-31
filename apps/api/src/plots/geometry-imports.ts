import {
  Body, Controller, Get, HttpCode, Inject, Injectable, Logger, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../db/database';
import type { Database, GeometryImportsTable } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { OBJECT_STORE, sha256, type ObjectStore } from '../storage/object-store';
import { DEFAULT_SWEEPER, StorageSweeper, type SweeperOptions } from '../storage/sweeper';
import { PlotsService, STRUCTURAL_RULE } from './plots';
import { reasonWithoutCoordinates } from './geometry';
import { GEOJSON_PROFILE_VERSION, ProfileError, parseGeoJson, type ProfileWarning } from './geojson-profile';

// P0-009 — GeoJSON: importación con revisión previa y exportación de una versión.
// Flujo: subir archivo → análisis (perfil GEOJSON_IMPORT_V1 + validez técnica PostGIS) → revisión →
// confirmar una versión FILE_IMPORT. Tres niveles distintos: perfil/estructura (rechazo 422), validez
// técnica (ST_IsValid; una no válida solo se conserva para revisión, sin superficie, D-26) y
// validación GIS de P0-010 (pendiente: toda versión queda NOT_VALIDATED).
// El original (coordenadas exactas) vive en almacenamiento privado; se entrega solo tras autorizar con
// `plot:read_geometry`. Staging y compensación descritos en la migración 0011.

type ImportRow = Selectable<GeometryImportsTable>;
export const IMPORT_PREFIX = 'organizations/';
const objectKey = (orgId: string, id: string) => `${IMPORT_PREFIX}${orgId}/geometry-imports/${id}.geojson`;
const MEDIA_TYPE = 'application/geo+json';
const EXPORT_NOTICE = 'Exportación técnica de una versión geométrica de Terra Link. No es un paquete de debida diligencia EUDR ni una declaración presentada.';

/** Archivo recibido por multer (memoria). */
interface UploadedGeoJson { buffer: Buffer; originalname?: string; size: number }

class ConfirmImportDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ description: 'row_version de la parcela leída' }) @IsInt() @Min(1) plot_expected_version!: number;
  @ApiPropertyOptional({ description: 'Conservar para revisión una geometría técnicamente no válida (sin superficie)' })
  @IsOptional() @IsBoolean() keep_invalid_for_review?: boolean;
}

interface Analysis {
  envelope: string;
  warnings: ProfileWarning[];
  stats: { components: number; rings: number; holes: number; positions: number; max_decimal_places: number };
}

@Injectable()
export class GeometryImportsService {
  private readonly logger = new Logger('GeometryImports');

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly plots: PlotsService,
  ) {}

  /** Escritura: editar la parcela en su alcance + geometría exacta + organización activa. */
  private async writeCtx(user: AuthUser, orgId: string): Promise<TenantContext> {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.plots.has(ctx, 'plot:update') && !this.plots.has(ctx, 'plot:update_assigned') && !this.plots.has(ctx, 'plot:update_own')) throw forbidden();
    if (!this.plots.geometryAllowed(ctx)) throw forbidden('PERMISSION_DENIED', 'Tu rol no permite importar ni ver geometrías exactas.');
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }

  /** Lectura de coordenadas exactas (original, exportación): leer la parcela en su alcance + geometría exacta. */
  private async geometryReadCtx(user: AuthUser, orgId: string): Promise<TenantContext> {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.plots.has(ctx, 'plot:read') && !this.plots.has(ctx, 'plot:read_assigned') && !this.plots.has(ctx, 'plot:read_own')) throw forbidden();
    if (!this.plots.geometryAllowed(ctx)) throw forbidden('PERMISSION_DENIED', 'Tu rol no tiene acceso a las coordenadas exactas ni a los archivos originales.');
    return ctx;
  }

  private async loadImport(db: Kysely<Database> | Transaction<Database>, ctx: TenantContext, id: string, kind: 'read' | 'update', lock = false) {
    let q = db.selectFrom('geometry_imports').selectAll().where('organization_id', '=', ctx.organizationId).where('id', '=', id);
    if (lock) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    if (!row) throw notFound();
    const plot = await this.plots.load(db, ctx, row.plot_id, kind, lock); // alcance actual (reasignación → 404)
    return { row, plot };
  }

  private async view(db: Kysely<Database> | Transaction<Database>, row: ImportRow) {
    const g = await sql<{ geometry: unknown; area: string | null; location: unknown }>`
      SELECT ST_AsGeoJSON(geometry, 17)::jsonb AS geometry,
             CASE WHEN technically_valid THEN round((ST_Area(geometry::geography) / 10000)::numeric, 6)::text ELSE NULL END AS area,
             CASE WHEN technically_valid THEN NULL ELSE ST_AsGeoJSON((ST_IsValidDetail(geometry)).location, 17)::jsonb END AS location
      FROM geometry_imports WHERE id = ${row.id}`.execute(db);
    const a = row.analysis as Analysis;
    return {
      id: row.id, plot_id: row.plot_id, status: row.status, created_at: row.created_at,
      original: { filename: row.original_filename, media_type: row.media_type, byte_size: row.byte_size, sha256: row.sha256 },
      profile_version: row.profile_version, envelope: a.envelope, geometry_type: row.geometry_type,
      stats: a.stats,
      decimal_places_note: 'Los decimales del archivo no indican la precisión de la medición.',
      technically_valid: row.technically_valid, validity_reason: row.validity_reason, validity_location: g.rows[0].location,
      area_calculated_ha: g.rows[0].area,
      gis_validation: 'PENDIENTE_P0_010',
      warnings: a.warnings, geometry: g.rows[0].geometry, confirmed_version_id: row.confirmed_version_id,
    };
  }

  async analyze(user: AuthUser, orgId: string, plotId: string, operationId: string | undefined, file: UploadedGeoJson | undefined, requestId?: string) {
    if (!operationId || !/^[0-9a-f-]{36}$/i.test(operationId)) throw new AppError(400, 'VALIDATION_FAILED', 'operation_id es obligatorio (UUID).', [{ field: 'operation_id', reason: 'REQUIRED_UUID' }]);
    if (!file) throw new AppError(400, 'VALIDATION_FAILED', 'Adjunta un archivo GeoJSON.', [{ field: 'file', reason: 'REQUIRED' }]);
    const ctx = await this.writeCtx(user, orgId);
    const plot = await this.plots.load(this.db, ctx, plotId, 'update');
    if (plot.status === 'INACTIVE') throw conflict('PLOT_INACTIVE', 'La parcela está dada de baja.');
    const bytes = file.buffer;
    const hash = sha256(bytes);

    const replay = async () => {
      const prior = await this.db.selectFrom('geometry_imports').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', operationId).executeTakeFirst();
      if (!prior) return null;
      if (prior.plot_id !== plotId || prior.sha256 !== hash) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro archivo. Vuelve a seleccionar el archivo.');
      return { replayed: true, import: await this.view(this.db, prior) };
    };
    const earlier = await replay();
    if (earlier) return earlier;

    let profile;
    try {
      profile = parseGeoJson(bytes, this.config.geojson);
    } catch (e) {
      if (e instanceof ProfileError) throw new AppError(422, e.code, e.message, e.path ? [{ field: e.path, reason: e.code }] : []);
      throw e;
    }
    const geojson = JSON.stringify(profile.geometry);
    const tech = await sql<{ valid: boolean; reason: string | null }>`
      SELECT (d).valid AS valid, (d).reason AS reason
      FROM (SELECT ST_IsValidDetail(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)) AS d) x`.execute(this.db);
    const valid = tech.rows[0].valid;
    const reason = valid ? null : reasonWithoutCoordinates(tech.rows[0].reason);
    const analysis: Analysis = { envelope: profile.envelope, warnings: profile.warnings, stats: profile.stats };

    // 1) staging del original en el almacenamiento privado (antes de la fila)
    const id = randomUUID();
    const key = objectKey(orgId, id);
    try {
      await this.store.put(key, bytes, MEDIA_TYPE);
    } catch {
      throw new AppError(503, 'STORAGE_UNAVAILABLE', 'No pudimos guardar el archivo original. No se registró ninguna importación; vuelve a intentarlo.');
    }
    // 2) fila + auditoría en una transacción; si falla, compensación: borrar el objeto
    try {
      const row = await this.db.transaction().execute(async (trx) => {
        const locked = await this.plots.load(trx, ctx, plotId, 'update', true);
        if (locked.status === 'INACTIVE') throw conflict('PLOT_INACTIVE', 'La parcela está dada de baja.');
        const inserted = await sql<ImportRow>`
          INSERT INTO geometry_imports (id, organization_id, plot_id, status, object_key, sha256, byte_size, original_filename, media_type,
            profile_version, geometry, geometry_type, technically_valid, validity_reason, analysis, operation_id, created_by)
          VALUES (${id}, ${orgId}, ${plotId}, 'ANALYZED', ${key}, ${hash}, ${bytes.length}, ${(file.originalname ?? '').slice(0, 255) || null}, ${MEDIA_TYPE},
            ${GEOJSON_PROFILE_VERSION}, ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326), ${profile.geometry.type === 'Polygon' ? 'POLYGON' : 'MULTIPOLYGON'},
            ${valid}, ${reason}, ${JSON.stringify(analysis)}::jsonb, ${operationId}, ${user.id})
          RETURNING *`.execute(trx);
        await this.audit.record(trx, {
          organizationId: orgId, actorUserId: user.id, action: 'plot.geometry_import_analyze', entityType: 'plot', entityId: plotId, requestId, result: 'SUCCESS',
          after: { import_id: id, sha256: hash, byte_size: bytes.length, geometry_type: inserted.rows[0].geometry_type, technically_valid: valid, positions: profile.stats.positions },
        });
        return inserted.rows[0];
      });
      return { replayed: false, import: await this.view(this.db, row) };
    } catch (e) {
      await this.compensate(key);
      if ((e as { constraint?: string }).constraint === 'geometry_imports_operation_uq') {
        const again = await replay();
        if (again) return again;
      }
      throw e;
    }
  }

  /** Compensación: un objeto sin fila no se sirve nunca; si el borrado falla, lo elimina el barrido. */
  private async compensate(key: string) {
    try {
      await this.store.delete(key);
    } catch {
      this.logger.warn('Compensación pendiente: se registra una tarea de borrado reintentable');
      await new StorageSweeper(this.db, this.store).enqueue(key, 'ORPHAN').catch(() => undefined); // si la base tampoco responde, lo descubre el barrido
    }
  }

  async list(user: AuthUser, orgId: string, plotId: string) {
    const ctx = await this.geometryReadCtx(user, orgId);
    await this.plots.load(this.db, ctx, plotId, 'read');
    const rows = await this.db.selectFrom('geometry_imports')
      .select(['id', 'status', 'original_filename', 'byte_size', 'sha256', 'geometry_type', 'technically_valid', 'confirmed_version_id', 'created_at'])
      .where('organization_id', '=', orgId).where('plot_id', '=', plotId).orderBy('created_at', 'desc').limit(20).execute();
    return rows;
  }

  async get(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.geometryReadCtx(user, orgId);
    const { row } = await this.loadImport(this.db, ctx, id, 'read');
    return this.view(this.db, row);
  }

  async confirm(user: AuthUser, orgId: string, id: string, dto: ConfirmImportDto, requestId?: string) {
    const ctx = await this.writeCtx(user, orgId);
    try {
      return await this.db.transaction().execute(async (trx) => {
        const { row, plot } = await this.loadImport(trx, ctx, id, 'update', true);
        if (row.status === 'CONFIRMED') {
          if (row.confirm_operation_id === dto.operation_id) {
            return { replayed: true, plot_row_version: Number(plot.row_version), version: await this.plots.versionView(trx, orgId, row.confirmed_version_id!, true) };
          }
          throw conflict('IMPORT_ALREADY_CONFIRMED', 'Esta importación ya se confirmó como una versión.');
        }
        if (row.status === 'DISCARDED') throw conflict('IMPORT_DISCARDED', 'Esta importación fue descartada. Vuelve a subir el archivo.');
        if (plot.status === 'INACTIVE') throw conflict('PLOT_INACTIVE', 'La parcela está dada de baja.');
        if (Number(plot.row_version) !== dto.plot_expected_version) throw conflict('VERSION_CONFLICT', 'La parcela cambió después del análisis. Recarga y revisa antes de confirmar; la importación se conserva.');
        if (!row.technically_valid && !dto.keep_invalid_for_review) {
          throw new AppError(422, 'GEOMETRY_NOT_VALID', `La geometría no es válida (${row.validity_reason}). Corrige el archivo o confírmala expresamente para revisión, sin superficie.`, [{ reason: row.validity_reason ?? 'INVALID' }]);
        }
        let present: boolean;
        try {
          present = await this.store.exists(row.object_key);
        } catch {
          throw new AppError(503, 'STORAGE_UNAVAILABLE', 'No pudimos comprobar el archivo original. No se creó ninguna versión; vuelve a intentarlo.');
        }
        if (!present) throw conflict('ORIGINAL_MISSING', 'No se encontró el archivo original de esta importación; no se creó ninguna versión. Vuelve a subir el archivo.');

        const previous = plot.current_version_id
          ? await trx.selectFrom('plot_versions').select('area_declared_ha').where('organization_id', '=', orgId).where('id', '=', plot.current_version_id).executeTakeFirst()
          : undefined;
        const last = await trx.selectFrom('plot_versions').select(sql<number>`coalesce(max(version_number), 0)::int`.as('n')).where('organization_id', '=', orgId).where('plot_id', '=', plot.id).executeTakeFirstOrThrow();
        const versionId = randomUUID();
        const notes = row.technically_valid ? null : `Geometría importada técnicamente no válida conservada para revisión: ${row.validity_reason}`;
        await sql`
          INSERT INTO plot_versions (id, organization_id, plot_id, version_number, geometry, geometry_type, geometry_hash,
            area_declared_ha, area_calculated_ha, survey_method, surveyed_at, accuracy_m, validation_status, validation_rule_version,
            previous_version_id, notes, created_by, source_import_id)
          SELECT ${versionId}, ${orgId}, ${plot.id}, ${last.n + 1}, gi.geometry, gi.geometry_type, encode(sha256(ST_AsBinary(gi.geometry)), 'hex'),
            ${previous?.area_declared_ha ?? null}::numeric,
            CASE WHEN (ST_IsValidDetail(gi.geometry)).valid THEN round((ST_Area(gi.geometry::geography) / 10000)::numeric, 6) ELSE NULL END,
            'FILE_IMPORT', NULL, NULL, 'NOT_VALIDATED', ${STRUCTURAL_RULE}, ${plot.current_version_id}, ${notes}, ${user.id}, gi.id
          FROM geometry_imports gi WHERE gi.id = ${row.id} AND gi.organization_id = ${orgId}`.execute(trx);
        const plotAfter = await trx.updateTable('plots')
          .set({ current_version_id: versionId, updated_by: user.id, updated_at: new Date(), row_version: sql`row_version + 1` })
          .where('id', '=', plot.id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
        await trx.updateTable('geometry_imports')
          .set({ status: 'CONFIRMED', confirmed_version_id: versionId, confirm_operation_id: dto.operation_id, closed_at: new Date(), closed_by: user.id, row_version: sql`row_version + 1` })
          .where('id', '=', row.id).where('organization_id', '=', orgId).execute();
        await this.plots.recordHistory(trx, plotAfter, 'GEOMETRY_VERSION', ['current_version_id'], user.id);
        const stats = (row.analysis as Analysis).stats;
        await this.events.append(trx, {
          organizationId: orgId, eventType: 'PlotGeometryVersionCreated', schemaVersion: 1, aggregateType: 'PLOT', aggregateId: plot.id,
          aggregateVersion: Number(plotAfter.row_version), actorId: user.id, correlationId: requestId,
          payload: {
            plot_version_id: versionId, version_number: last.n + 1, previous_version_id: plot.current_version_id, geometry_type: row.geometry_type,
            survey_method: 'FILE_IMPORT', geometry_import_id: row.id, original_sha256: row.sha256, components: stats.components, holes: stats.holes,
            positions: stats.positions, technically_valid: row.technically_valid,
          },
        });
        await this.audit.record(trx, {
          organizationId: orgId, actorUserId: user.id, action: 'plot.geometry_import_confirm', entityType: 'plot', entityId: plot.id, requestId, result: 'SUCCESS',
          after: { plot_version_id: versionId, import_id: row.id, sha256: row.sha256, technically_valid: row.technically_valid },
        });
        return { replayed: false, plot_row_version: Number(plotAfter.row_version), version: await this.plots.versionView(trx, orgId, versionId, true) };
      });
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'geometry_imports_confirm_operation_uq') {
        throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó en otra confirmación.');
      }
      throw e;
    }
  }

  async discard(user: AuthUser, orgId: string, id: string, requestId?: string) {
    const ctx = await this.writeCtx(user, orgId);
    const row = await this.db.transaction().execute(async (trx) => {
      const { row } = await this.loadImport(trx, ctx, id, 'update', true);
      if (row.status !== 'ANALYZED') throw conflict(row.status === 'CONFIRMED' ? 'IMPORT_ALREADY_CONFIRMED' : 'IMPORT_DISCARDED', 'Esta importación ya está cerrada.');
      const after = await trx.updateTable('geometry_imports')
        .set({ status: 'DISCARDED', closed_at: new Date(), closed_by: user.id, row_version: sql`row_version + 1` })
        .where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
      await new StorageSweeper(trx as unknown as Kysely<Database>, this.store).enqueue(row.object_key, 'DISCARDED', trx as unknown as Kysely<Database>);
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'plot.geometry_import_discard', entityType: 'plot', entityId: row.plot_id, requestId, result: 'SUCCESS', after: { import_id: id } });
      return after;
    });
    // después del commit: intento inmediato de la tarea registrada; un fallo queda FAILED y se reintenta
    await new StorageSweeper(this.db, this.store).process([row.object_key]).catch(() => undefined);
    return { id: row.id, status: row.status };
  }

  /** Descarga del original: bytes intactos, verificados contra el SHA-256 registrado. */
  async original(user: AuthUser, orgId: string, id: string, requestId?: string) {
    const ctx = await this.geometryReadCtx(user, orgId);
    const { row } = await this.loadImport(this.db, ctx, id, 'read');
    if (row.status === 'DISCARDED') throw notFound('El archivo original de una importación descartada no se conserva.');
    let bytes: Buffer;
    try {
      bytes = await this.store.get(row.object_key);
    } catch {
      throw new AppError(503, 'STORAGE_UNAVAILABLE', 'No pudimos leer el archivo original. Vuelve a intentarlo.');
    }
    if (sha256(bytes) !== row.sha256) throw new AppError(500, 'ORIGINAL_INTEGRITY_FAILED', 'El archivo almacenado no coincide con su huella registrada; no se entrega.');
    await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'plot.geometry_import_original_download', entityType: 'plot', entityId: row.plot_id, requestId, result: 'SUCCESS', after: { import_id: id, sha256: row.sha256 } });
    return { bytes, row };
  }

  /** Exportación GeoJSON (RFC 7946) de una versión almacenada; no modifica la versión. */
  async exportVersion(user: AuthUser, orgId: string, plotId: string, versionId: string, requestId?: string) {
    const ctx = await this.geometryReadCtx(user, orgId);
    const plot = await this.plots.load(this.db, ctx, plotId, 'read');
    const r = await sql<{ geometry: unknown; version_number: number; geometry_type: string; survey_method: string; validation_status: string; technically_valid: boolean; area_declared_ha: string | null; area_calculated_ha: string | null; geometry_hash: string; source_import_sha256: string | null }>`
      SELECT ST_AsGeoJSON(v.geometry, 17)::jsonb AS geometry, v.version_number, v.geometry_type, v.survey_method, v.validation_status,
             (ST_IsValidDetail(v.geometry)).valid AS technically_valid, v.area_declared_ha::text, v.area_calculated_ha::text, v.geometry_hash,
             gi.sha256 AS source_import_sha256
      FROM plot_versions v LEFT JOIN geometry_imports gi ON gi.id = v.source_import_id AND gi.organization_id = v.organization_id
      WHERE v.organization_id = ${orgId} AND v.plot_id = ${plotId} AND v.id = ${versionId}`.execute(this.db);
    const v = r.rows[0];
    if (!v) throw notFound();
    if (!v.geometry) throw new AppError(422, 'VERSION_WITHOUT_GEOMETRY', 'Esta versión solo tiene superficie declarada; no hay geometría que exportar.');
    await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'plot.geometry_export', entityType: 'plot', entityId: plotId, requestId, result: 'SUCCESS', after: { plot_version_id: versionId, format: 'GEOJSON_RFC7946' } });
    const feature = {
      type: 'Feature',
      geometry: v.geometry,
      properties: {
        plot_code: plot.plot_code, version_id: versionId, version_number: v.version_number, geometry_type: v.geometry_type,
        survey_method: v.survey_method, validation_status: v.validation_status, technically_valid: v.technically_valid,
        area_declared_ha: v.area_declared_ha, area_calculated_ha: v.area_calculated_ha, geometry_hash: v.geometry_hash,
        source_import_sha256: v.source_import_sha256, crs: 'WGS84 longitud/latitud (RFC 7946)', notice: EXPORT_NOTICE,
      },
    };
    return { feature, filename: `${plot.plot_code}-v${v.version_number}.geojson` };
  }

  /** Barrido bajo demanda (el worker lo programa); misma lógica y garantías que en el worker. */
  async sweepOrphans(opts?: Partial<SweeperOptions>) {
    return new StorageSweeper(this.db, this.store, { ...DEFAULT_SWEEPER, ...opts }).runOnce();
  }
}

@ApiTags('plots')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class GeometryImportsController {
  constructor(private readonly service: GeometryImportsService) {}

  @Post('plots/:plotId/geometry-imports')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file', 'operation_id'], properties: { file: { type: 'string', format: 'binary' }, operation_id: { type: 'string', format: 'uuid' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 16 * 1024 * 1024, files: 1 } }))
  async analyze(
    @CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('plotId', ParseUUIDPipe) plotId: string,
    @UploadedFile() file: UploadedGeoJson | undefined, @Body() body: Record<string, string>, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.service.analyze(user, orgId, plotId, body?.operation_id, file, req.requestId);
    if (r.replayed) res.status(200);
    return r;
  }

  @Get('plots/:plotId/geometry-imports')
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('plotId', ParseUUIDPipe) plotId: string) {
    return this.service.list(user, orgId, plotId);
  }

  @Get('plots/:plotId/geometry-versions/:versionId/geojson')
  async export(
    @CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('plotId', ParseUUIDPipe) plotId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string, @Req() req: AuthedRequest, @Res() res: Response,
  ) {
    const { feature, filename } = await this.service.exportVersion(user, orgId, plotId, versionId, req.requestId);
    res.setHeader('Content-Type', 'application/geo+json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^A-Za-z0-9_.-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(JSON.stringify(feature, null, 2));
  }

  @Get('geometry-imports/:importId')
  get(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('importId', ParseUUIDPipe) importId: string) {
    return this.service.get(user, orgId, importId);
  }

  @Get('geometry-imports/:importId/original')
  async original(
    @CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('importId', ParseUUIDPipe) importId: string,
    @Req() req: AuthedRequest, @Res() res: Response,
  ) {
    const { bytes, row } = await this.service.original(user, orgId, importId, req.requestId);
    res.setHeader('Content-Type', row.media_type);
    res.setHeader('Content-Disposition', `attachment; filename="${(row.original_filename ?? 'original.geojson').replace(/[^A-Za-z0-9_.-]/g, '_')}"`);
    res.setHeader('X-Content-SHA256', row.sha256);
    res.setHeader('Cache-Control', 'no-store');
    res.send(bytes);
  }

  @Post('geometry-imports/:importId/confirm')
  async confirm(
    @CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('importId', ParseUUIDPipe) importId: string,
    @Body() dto: ConfirmImportDto, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.service.confirm(user, orgId, importId, dto, req.requestId);
    if (r.replayed) res.status(200);
    return r;
  }

  @Post('geometry-imports/:importId/discard')
  @HttpCode(200)
  discard(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('importId', ParseUUIDPipe) importId: string, @Req() req: AuthedRequest) {
    return this.service.discard(user, orgId, importId, req.requestId);
  }
}
