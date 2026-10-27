// D-05.A — Perfil técnico de intercambio geoespacial `EUDR_GEO_V1`.
//
// SEPARADO DE `TL_GIS_TECH`, a propósito y con tabla propia. Son dos dictámenes distintos sobre la misma
// geometría y **pueden discrepar**: un polígono con hueco es técnicamente válido (OGC) y NO cumple el perfil,
// porque el sistema de destino no procesa huecos. Mostrar uno solo haría creer que hay un único veredicto.
//
// QUÉ ACREDITA Y QUÉ NO
// - `MEETS_PROFILE` significa: **con la documentación fechada del destino a la vista, este archivo está bien
//   formado para él**. No significa conforme, ni legal, ni aceptado.
// - **Nada aquí se ha probado contra el servicio real.** Leer la documentación no demuestra una importación
//   aceptada. La aplicabilidad jurídica es D-05.B y sigue pendiente.
//
// CAPAS (cada comprobación declara la suya)
//   `NORM`   Reglamento (UE) 2023/1115 consolidado — copia en docs/sources/eudr-norma-2026-10-15/
//   `DEST`   Documentación del EUDR Information System — copia en docs/sources/eudr-is-2026-10-15/
//   `TL`     Regla propia de Terra Link, que no exige ninguna fuente externa
import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database, GeoProfileEvaluationsTable } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { PlotsService } from './plots';

/** Fuente contra la que evalúa esta versión del perfil. Tres identificadores distintos, nunca intercambiables. */
export const PROFILE_SOURCE = {
  /** Versión del SERVICIO de destino. Es lo que importa para integrar. */
  service_version: 'V3',
  /** Versión del DOCUMENTO «EUDR Information System — Operator API Reference». Es lo que importa para citar. */
  document_version: '1.2',
  /** Fecha publicada por la página «GeoJSON File Description». Las otras páginas no publican fecha. */
  page_date: '2026-08-17',
  copy: 'docs/sources/eudr-is-2026-10-15/',
  verification: 'DOCUMENTED_NOT_TESTED_AGAINST_SERVICE',
  verification_note: 'Comprobado contra la documentación fechada del destino. NO se ha probado contra el servicio real: leer la documentación no demuestra una importación aceptada.',
} as const;

export const GEO_PROFILE = {
  id: 'EUDR_GEO_V1',
  version: '1.0.0',
  status: 'PROVISIONAL_LOCAL_DEVELOPMENT',
  status_note: 'Perfil técnico provisional adoptado para desarrollo local (D-05.A, 2026-10-15). No acredita conformidad jurídica (D-05.B, pendiente) ni autoriza presentar declaraciones.',
  parameters: {
    threshold_ha: 4,
    /** ESTRICTO: por encima de 4 ha exige polígono. Exactamente 4 ha se admite. NORM art. 2(28) + DEST. */
    threshold_operator: 'polygon_required_if_area_gt',
    area_min_ha: 0.0001,
    /** Decimales del FORMATO DE INTERCAMBIO. No es precisión de medición ni resolución del dato. */
    interchange_decimals: 6,
    truncation: 'TOWARD_ZERO',
    supported_types: ['POINT', 'POLYGON', 'MULTIPOLYGON'],
    /** El destino admite MultiPoint; Terra Link no lo modela. Se declara, no se improvisa. */
    not_implemented_types: ['MULTIPOINT'],
    holes_allowed: false,
    /** Sin banda de tolerancia: el umbral es exacto y la igualdad solo se avisa. */
    near_threshold_band: null,
  },
  checks: [
    { code: 'GEOMETRY_PRESENT', layer: 'TL', description: 'La versión tiene geometría: una superficie declarada no es una ubicación' },
    { code: 'GEOMETRY_TYPE', layer: 'DEST', description: 'Punto, polígono o multipolígono (MultiPoint no está implementado en Terra Link)' },
    { code: 'CRS', layer: 'DEST', description: 'WGS84 / EPSG:4326, longitud antes que latitud' },
    { code: 'COORDINATE_RANGE', layer: 'DEST', description: 'Longitud −180…180 y latitud −90…90' },
    { code: 'TECHNICAL_VALIDITY', layer: 'DEST', description: 'Geometría válida: prerrequisito de todo lo demás' },
    { code: 'NO_HOLES', layer: 'DEST', description: 'El destino no procesa polígonos con huecos' },
    { code: 'AREA_BASIS', layer: 'TL', description: 'Qué superficie se usa para el umbral y de dónde sale' },
    { code: 'AREA_MINIMUM', layer: 'DEST', description: 'El área de un punto no baja de 0,0001 ha' },
    { code: 'THRESHOLD', layer: 'NORM', description: 'Más de 4 ha exige polígono; exactamente 4 ha no lo exige' },
    { code: 'AREA_DISCREPANCY', layer: 'TL', description: 'Declarada y calculada a distinto lado del umbral: revisión humana' },
    { code: 'INTERCHANGE_PRECISION', layer: 'DEST', description: 'El destino trunca a 6 decimales: se comprueba qué le pasa a esta geometría' },
  ],
  not_in_scope: [
    'Conformidad jurídica y qué actor es cada usuario — D-05.B',
    'Presentar declaraciones o llamar al servicio del destino — no autorizado',
    'Severidad y conclusión de riesgo — D-07',
    'Precisión mínima de captura — D-25',
    'Análisis satelital, deforestación y legalidad',
  ],
} as const;

export /** Fecha de página como fecha, no como instante: no tiene hora ni zona. */
const ymd = (d: string | Date): string => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

const PROFILE_TAG = `${GEO_PROFILE.id}@${GEO_PROFILE.version}`;

type Outcome = 'PASS' | 'FAIL' | 'REVIEW' | 'NOT_APPLICABLE' | 'NOT_EXECUTED';
export type ProfileStatus = 'MEETS_PROFILE' | 'DOES_NOT_MEET' | 'REVIEW_REQUIRED' | 'NOT_EVALUABLE';
interface Check { code: string; layer: string; outcome: Outcome; reason_code: string | null; message: string; details?: Record<string, unknown> }
type Row = Selectable<GeoProfileEvaluationsTable>;
type Db = Kysely<Database> | Transaction<Database>;

const MESSAGES: Record<string, string> = {
  PASS: 'Correcto.',
  GEOMETRY_MISSING: 'La versión solo tiene superficie declarada: no hay geometría que preparar. Una superficie no es una ubicación.',
  TYPE_NOT_IMPLEMENTED: 'El tipo de geometría no está implementado en Terra Link. El destino admite MultiPoint; Terra Link no lo modela, y no se improvisa aquí.',
  TYPE_NOT_SUPPORTED: 'El destino no procesa este tipo de geometría para declarar lugares de producción.',
  SRID_NOT_4326: 'La geometría no está en WGS84 (SRID 4326). No se reproyecta: el perfil informa, no transforma.',
  COORDINATES_OUT_OF_RANGE: 'Hay coordenadas fuera de los rangos admitidos de longitud o latitud.',
  GEOMETRY_INVALID: 'La geometría no es válida técnicamente. El perfil no se evalúa sobre una geometría inválida, y no se repara nada.',
  GEOMETRY_EMPTY: 'La geometría está vacía.',
  HOLES_PRESENT: 'El polígono tiene huecos. El destino no los procesa, aunque la geometría sea técnicamente válida: son dos dictámenes distintos.',
  DEGENERATE: 'El polígono no encierra superficie: sus vértices están alineados o repetidos.',
  AREA_FROM_CALCULATED: 'Superficie de referencia: la CALCULADA sobre la geometría.',
  AREA_FROM_DECLARED: 'Superficie de referencia: la DECLARADA. Un punto no tiene superficie calculada.',
  AREA_UNKNOWN_FOR_POINT: 'Punto sin superficie declarada: no se puede situar respecto del umbral. No se exporta, porque el destino asumiría 4 ha por defecto y eso convertiría un desconocido en un dato afirmado.',
  AREA_BELOW_MINIMUM: 'La superficie declarada está por debajo del mínimo que admite el destino.',
  POLYGON_REQUIRED_ABOVE_THRESHOLD: 'La superficie supera el umbral y la geometría es un punto: por encima del umbral se exige polígono.',
  AT_THRESHOLD: 'La superficie es exactamente igual al umbral. No lo supera, así que el punto se admite. Es un aviso de borde, no una tolerancia.',
  BELOW_THRESHOLD: 'La superficie no supera el umbral.',
  ABOVE_THRESHOLD_WITH_POLYGON: 'La superficie supera el umbral y la geometría es un polígono, que es lo exigido.',
  AREA_DISCREPANCY_CROSSES_THRESHOLD: 'La superficie declarada y la calculada quedan a distinto lado del umbral. No se elige la favorable: decide una persona.',
  AREA_DISCREPANCY_NONE: 'Declarada y calculada quedan del mismo lado del umbral.',
  NO_DECLARED_AREA: 'No hay superficie declarada con la que contrastar la calculada.',
  TRUNCATION_SAFE: 'Truncar a 6 decimales no altera la validez de esta geometría.',
  INVALID_AFTER_TRUNCATION: 'Truncada a 6 decimales por el destino, esta geometría dejaría de ser válida. El original NO se modifica.',
  DEGENERATE_AFTER_TRUNCATION: 'Truncada a 6 decimales, esta geometría dejaría de encerrar superficie. El original NO se modifica.',
  VERTEX_COLLAPSE_ON_TRUNCATION: 'Al truncar a 6 decimales, dos vértices distintos pasan a ser el mismo. No es el cierre del anillo, que es obligatorio y se excluye de esta comprobación.',
  DUPLICATE_VERTEX_IN_SOURCE: 'La geometría ya repite vértices antes de truncar, al margen del cierre del anillo.',
  REQUIRES_VALID_GEOMETRY: 'No se ejecutó: requiere una geometría válida.',
  REQUIRES_PRESENT_GEOMETRY: 'No se ejecutó: la versión no tiene geometría.',
  REQUIRES_KNOWN_AREA: 'No se ejecutó: la superficie de referencia es desconocida.',
  POINT_HAS_NO_RINGS: 'No aplica: un punto no tiene anillos ni huecos.',
  POINT_HAS_NO_AREA: 'No aplica: un punto no encierra superficie.',
};

const chk = (code: string, outcome: Outcome, reason: string | null, details?: Record<string, unknown>): Check => {
  const def = GEO_PROFILE.checks.find((c) => c.code === code);
  return { code, layer: def?.layer ?? 'TL', outcome, reason_code: reason, message: MESSAGES[reason ?? 'PASS'] ?? MESSAGES.PASS, ...(details ? { details } : {}) };
};

/**
 * Contrato de decimales. Cuatro cosas distintas que el perfil NO mezcla:
 *
 * 1. **Valor numérico**: lo que la coordenada vale. `-79.5` y `-79.500000` son el MISMO valor.
 * 2. **Formato de intercambio**: con cuántos decimales se escribe. El destino trunca a 6 y la norma exige al
 *    menos 6 dígitos decimales; por eso se emite con 6. **Escribir ceros no mejora ninguna medición.**
 * 3. **Resolución del dato**: el escalón mínimo que el almacenamiento puede distinguir.
 * 4. **Exactitud de captura**: cuánto se parece el valor al terreno. **No se deduce de los decimales**, ni de
 *    los que trae el archivo ni de los que se escriben (RFC 7946 §11.2 advierte justo de esto).
 *
 * Consecuencia operativa: una coordenada NO se rechaza por cómo estén escritos sus ceros finales. Lo único que
 * se comprueba es qué le pasa a la GEOMETRÍA cuando el destino trunca su valor numérico.
 */
export const DECIMALS_CONTRACT = {
  numeric_value: 'El valor de la coordenada. -79.5 y -79.500000 son el mismo valor; los ceros finales no lo cambian.',
  interchange_format: `Se emite con ${GEO_PROFILE.parameters.interchange_decimals} decimales: la norma exige al menos seis dígitos decimales y el destino trunca a seis. Es formato, no precisión.`,
  data_resolution: 'Superficie declarada: escalón de 0,0001 ha (4 decimales). Superficie calculada: 6 decimales. Son capacidades de representación.',
  capture_accuracy: 'No se infiere de los decimales. Vive en la evaluación técnica (TL_GIS_TECH, bloque de calidad de captura) y hoy no tiene umbral (D-25).',
  never: 'Seis decimales NO son prueba de precisión física, y una coordenada no se rechaza por sus ceros finales.',
} as const;

class EvaluateProfileDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiPropertyOptional({ description: 'Versión a evaluar; por omisión la vigente' }) @IsOptional() @IsUUID() plot_version_id?: string;
}

interface GeometryFacts {
  missing: boolean;
  gtype: string | null;
  registered_type: string | null;
  srid: number | null;
  empty: boolean | null;
  in_range: boolean | null;
  valid: boolean | null;
  holes: number | null;
  planar_area: number | null;
  area_calculated_ha: string | null;
  area_declared_ha: string | null;
  geometry_hash: string | null;
}

/** Simulación del truncamiento del destino. Trabaja sobre una COPIA; el original nunca se toca. */
interface TruncationFacts {
  executed: boolean;
  valid_after: boolean | null;
  area_after: number | null;
  /** Vértices repetidos EXCLUYENDO el cierre del anillo, antes y después de truncar. */
  duplicates_before: number;
  duplicates_after: number;
}

@Injectable()
export class GeoProfileService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly plots: PlotsService,
  ) {}

  private async readCtx(user: AuthUser, orgId: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.plots.has(ctx, 'plot:read') && !this.plots.has(ctx, 'plot:read_assigned') && !this.plots.has(ctx, 'plot:read_own')) throw forbidden();
    return ctx;
  }

  /**
   * Hechos geométricos. `trunc(numeric, 6)` de PostgreSQL trunca **hacia cero** y en decimal exacto, que es lo
   * que hace el destino y lo que muestran sus propios ejemplos con coordenadas negativas. No se usa aritmética
   * de coma flotante para esto, ni se pasa por texto.
   */
  private async facts(db: Db, orgId: string, plotId: string, versionId: string): Promise<GeometryFacts | null> {
    const r = await sql<GeometryFacts>`
      SELECT v.geometry IS NULL AS missing, GeometryType(v.geometry) AS gtype, v.geometry_type AS registered_type,
             ST_SRID(v.geometry) AS srid, ST_IsEmpty(v.geometry) AS empty,
             CASE WHEN ST_IsEmpty(v.geometry) THEN NULL ELSE ST_XMin(v.geometry) >= -180 AND ST_XMax(v.geometry) <= 180
                  AND ST_YMin(v.geometry) >= -90 AND ST_YMax(v.geometry) <= 90 END AS in_range,
             (ST_IsValidDetail(v.geometry)).valid AS valid,
             CASE WHEN GeometryType(v.geometry) IN ('POLYGON','MULTIPOLYGON')
                  THEN (SELECT coalesce(sum(ST_NumInteriorRings(g.geom)), 0)::int FROM ST_Dump(v.geometry) g) END AS holes,
             CASE WHEN GeometryType(v.geometry) IN ('POLYGON','MULTIPOLYGON') THEN ST_Area(v.geometry) END AS planar_area,
             v.area_calculated_ha::text, v.area_declared_ha::text, v.geometry_hash
      FROM plot_versions v
      WHERE v.organization_id = ${orgId} AND v.plot_id = ${plotId} AND v.id = ${versionId}`.execute(db);
    return r.rows[0] ?? null;
  }

  /**
   * Reconstruye la geometría con cada coordenada truncada a 6 decimales hacia cero y la mide. Solo se ejecuta
   * sobre geometrías válidas y sin huecos: con huecos el perfil ya falla antes y rehacer anillos interiores
   * sería trabajo inútil sobre un caso que no se exporta.
   */
  private async truncation(db: Db, versionId: string, gtype: string): Promise<TruncationFacts> {
    const none: TruncationFacts = { executed: false, valid_after: null, area_after: null, duplicates_before: 0, duplicates_after: 0 };
    if (gtype === 'POINT') {
      // Un punto no puede invalidarse ni colapsar contra sí mismo: truncar solo mueve el valor.
      return { executed: true, valid_after: true, area_after: null, duplicates_before: 0, duplicates_after: 0 };
    }
    if (gtype !== 'POLYGON' && gtype !== 'MULTIPOLYGON') return none;
    const r = await sql<{ valid_after: boolean | null; area_after: number | null; dup_before: number; dup_after: number }>`
      WITH src AS (SELECT geometry AS g FROM plot_versions WHERE id = ${versionId}),
      pts AS (
        SELECT CASE WHEN GeometryType(src.g) = 'POLYGON' THEN 1 ELSE (dp.path)[1] END AS comp,
               CASE WHEN GeometryType(src.g) = 'POLYGON' THEN (dp.path)[1] ELSE (dp.path)[2] END AS ring,
               CASE WHEN GeometryType(src.g) = 'POLYGON' THEN (dp.path)[2] ELSE (dp.path)[3] END AS idx,
               ST_X(dp.geom)::numeric AS x0, ST_Y(dp.geom)::numeric AS y0,
               trunc(ST_X(dp.geom)::numeric, 6) AS x, trunc(ST_Y(dp.geom)::numeric, 6) AS y
        FROM src, ST_DumpPoints(src.g) dp),
      -- El cierre del anillo repite la primera posición por obligación: se EXCLUYE de la cuenta de duplicados.
      open_ring AS (SELECT p.* FROM pts p WHERE p.idx < (SELECT max(q.idx) FROM pts q WHERE q.comp = p.comp AND q.ring = p.ring)),
      dups AS (
        SELECT count(*) FILTER (WHERE n0 > 1) AS dup_before, count(*) FILTER (WHERE n > 1) AS dup_after FROM (
          SELECT count(*) OVER (PARTITION BY comp, ring, x0, y0) AS n0, count(*) OVER (PARTITION BY comp, ring, x, y) AS n
          FROM open_ring) s),
      rings AS (
        SELECT comp, ring, ST_MakeLine(ST_SetSRID(ST_MakePoint(x::float8, y::float8), 4326) ORDER BY idx) AS line
        FROM pts GROUP BY comp, ring),
      polys AS (SELECT comp, ST_MakePolygon(line) AS poly FROM rings WHERE ST_NPoints(line) >= 4 AND ST_IsClosed(line)),
      built AS (SELECT ST_Multi(ST_Collect(poly)) AS g FROM polys)
      SELECT CASE WHEN built.g IS NULL THEN false ELSE (ST_IsValidDetail(built.g)).valid END AS valid_after,
             CASE WHEN built.g IS NULL THEN 0 ELSE ST_Area(built.g) END AS area_after,
             dups.dup_before::int AS dup_before, dups.dup_after::int AS dup_after
      FROM built, dups`.execute(db);
    const row = r.rows[0];
    if (!row) return none;
    return {
      executed: true, valid_after: row.valid_after, area_after: row.area_after,
      duplicates_before: row.dup_before, duplicates_after: row.dup_after,
    };
  }

  /** Evalúa el perfil. Append-only e idempotente por `operation_id`, como la evaluación técnica. */
  async evaluate(user: AuthUser, orgId: string, plotId: string, dto: EvaluateProfileDto, requestId?: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.plots.has(ctx, 'plot:evaluate_gis') && !this.plots.has(ctx, 'plot:evaluate_gis_assigned')) throw forbidden();
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    const plot = await this.plots.load(this.db, ctx, plotId, 'read');

    const prior = await this.db.selectFrom('geo_profile_evaluations').selectAll()
      .where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.plot_id !== plotId || (dto.plot_version_id && prior.plot_version_id !== dto.plot_version_id)) {
        throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó en otra evaluación de perfil.');
      }
      return { replayed: true, evaluation: this.view(prior) };
    }
    const versionId = dto.plot_version_id ?? plot.current_version_id;
    if (!versionId) throw new AppError(422, 'PLOT_WITHOUT_VERSION', 'La parcela no tiene versiones geométricas que evaluar.');

    try {
      const row = await this.db.transaction().execute(async (trx) => {
        const g = await this.facts(trx, orgId, plotId, versionId);
        if (!g) throw notFound('La versión no existe en esta parcela.');
        const { checks, status, areaBasis, areaValue } = await this.run(trx, versionId, g);
        const id = randomUUID();
        const inserted = await sql<Row>`
          INSERT INTO geo_profile_evaluations (id, organization_id, plot_id, plot_version_id, geometry_hash,
            profile_id, profile_version, source_service_version, source_document_version, source_page_date,
            parameters, status, checks, area_basis, area_value_ha, exportable, operation_id, evaluated_by)
          VALUES (${id}, ${orgId}, ${plotId}, ${versionId}, ${g.geometry_hash},
            ${GEO_PROFILE.id}, ${GEO_PROFILE.version}, ${PROFILE_SOURCE.service_version}, ${PROFILE_SOURCE.document_version}, ${PROFILE_SOURCE.page_date},
            ${JSON.stringify(GEO_PROFILE.parameters)}::jsonb, ${status}, ${JSON.stringify(checks)}::jsonb,
            ${areaBasis}, ${areaValue}, ${status === 'MEETS_PROFILE'}, ${dto.operation_id}, ${user.id})
          RETURNING *`.execute(trx);
        await this.events.append(trx, {
          organizationId: orgId, eventType: 'PlotGeoProfileEvaluated', schemaVersion: 1,
          aggregateType: 'GEO_PROFILE_EVALUATION', aggregateId: id, aggregateVersion: 1, actorId: user.id, correlationId: requestId,
          payload: {
            evaluation_id: id, plot_id: plotId, plot_version_id: versionId, profile: PROFILE_TAG, status,
            area_basis: areaBasis, failed_checks: checks.filter((c) => c.outcome === 'FAIL').map((c) => c.reason_code),
            source: { service: PROFILE_SOURCE.service_version, document: PROFILE_SOURCE.document_version, page_date: PROFILE_SOURCE.page_date },
          },
        });
        await this.audit.record(trx, {
          organizationId: orgId, actorUserId: user.id, action: 'plot.geo_profile_evaluate', entityType: 'plot', entityId: plotId,
          requestId, result: 'SUCCESS', after: { evaluation_id: id, plot_version_id: versionId, profile: PROFILE_TAG, status },
        });
        return inserted.rows[0];
      });
      return { replayed: false, evaluation: this.view(row) };
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'geo_profile_evaluations_operation_uq') {
        const again = await this.db.selectFrom('geo_profile_evaluations').selectAll()
          .where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
        if (again && again.plot_id === plotId) return { replayed: true, evaluation: this.view(again) };
      }
      throw e;
    }
  }

  /** El motor de reglas. Puro respecto de la base salvo la simulación de truncamiento. */
  private async run(db: Db, versionId: string, g: GeometryFacts) {
    const checks: Check[] = [];
    const P = GEO_PROFILE.parameters;

    if (g.missing) {
      checks.push(chk('GEOMETRY_PRESENT', 'FAIL', 'GEOMETRY_MISSING'));
      for (const c of GEO_PROFILE.checks.slice(1)) checks.push(chk(c.code, 'NOT_EXECUTED', 'REQUIRES_PRESENT_GEOMETRY'));
      return { checks, status: 'NOT_EVALUABLE' as ProfileStatus, areaBasis: 'NONE', areaValue: null };
    }
    checks.push(chk('GEOMETRY_PRESENT', 'PASS', null));

    const gtype = g.gtype ?? '';
    const polygonal = gtype === 'POLYGON' || gtype === 'MULTIPOLYGON';
    const supported = (P.supported_types as readonly string[]).includes(gtype);
    const notImplemented = (P.not_implemented_types as readonly string[]).includes(gtype);
    checks.push(supported ? chk('GEOMETRY_TYPE', 'PASS', null)
      : chk('GEOMETRY_TYPE', 'FAIL', notImplemented ? 'TYPE_NOT_IMPLEMENTED' : 'TYPE_NOT_SUPPORTED', { geometry_type: gtype }));
    checks.push(g.srid === 4326 ? chk('CRS', 'PASS', null) : chk('CRS', 'FAIL', 'SRID_NOT_4326', { srid: g.srid }));
    checks.push(g.empty ? chk('COORDINATE_RANGE', 'NOT_EXECUTED', 'GEOMETRY_EMPTY')
      : g.in_range ? chk('COORDINATE_RANGE', 'PASS', null) : chk('COORDINATE_RANGE', 'FAIL', 'COORDINATES_OUT_OF_RANGE'));

    const degenerate = polygonal && !g.empty && (g.planar_area ?? 0) === 0;
    const technicallyUsable = !!g.valid && !g.empty && !degenerate && g.srid === 4326 && supported;
    checks.push(g.empty ? chk('TECHNICAL_VALIDITY', 'FAIL', 'GEOMETRY_EMPTY')
      : degenerate ? chk('TECHNICAL_VALIDITY', 'FAIL', 'DEGENERATE')
        : g.valid ? chk('TECHNICAL_VALIDITY', 'PASS', null) : chk('TECHNICAL_VALIDITY', 'FAIL', 'GEOMETRY_INVALID'));

    const holes = g.holes ?? 0;
    checks.push(!polygonal ? chk('NO_HOLES', 'NOT_APPLICABLE', 'POINT_HAS_NO_RINGS')
      : holes > 0 ? chk('NO_HOLES', 'FAIL', 'HOLES_PRESENT', { holes }) : chk('NO_HOLES', 'PASS', null));

    // --- Superficie de referencia. Se usa el valor ALMACENADO tal cual: no se reduce antes de comparar.
    const declared = g.area_declared_ha === null ? null : Number(g.area_declared_ha);
    const calculated = g.area_calculated_ha === null ? null : Number(g.area_calculated_ha);
    let areaBasis: 'CALCULATED' | 'DECLARED' | 'NONE' = 'NONE';
    let areaValue: string | null = null;
    if (polygonal && technicallyUsable && calculated !== null) {
      areaBasis = 'CALCULATED'; areaValue = g.area_calculated_ha;
      checks.push(chk('AREA_BASIS', 'PASS', 'AREA_FROM_CALCULATED', { area_ha: areaValue, source: 'CALCULATED' }));
    } else if (!polygonal && declared !== null) {
      areaBasis = 'DECLARED'; areaValue = g.area_declared_ha;
      checks.push(chk('AREA_BASIS', 'PASS', 'AREA_FROM_DECLARED', { area_ha: areaValue, source: 'DECLARED' }));
    } else if (!polygonal) {
      // Falta el dato, no falla la regla: no se puede situar el punto respecto del umbral. Decir DOES_NOT_MEET
      // afirmaría que se comprobó y no cumple; lo cierto es que no se pudo comprobar. Queda NOT_EVALUABLE, y
      // tampoco se exporta.
      checks.push(chk('AREA_BASIS', 'NOT_EXECUTED', 'AREA_UNKNOWN_FOR_POINT'));
    } else {
      checks.push(chk('AREA_BASIS', 'NOT_EXECUTED', 'REQUIRES_VALID_GEOMETRY'));
    }
    const ref = areaValue === null ? null : Number(areaValue);

    // --- Mínimo (solo aplica al área que acompaña a un punto).
    checks.push(polygonal ? chk('AREA_MINIMUM', 'NOT_APPLICABLE', 'POINT_HAS_NO_AREA')
      : ref === null ? chk('AREA_MINIMUM', 'NOT_EXECUTED', 'REQUIRES_KNOWN_AREA')
        : ref >= P.area_min_ha ? chk('AREA_MINIMUM', 'PASS', null)
          : chk('AREA_MINIMUM', 'FAIL', 'AREA_BELOW_MINIMUM', { area_ha: areaValue, minimum_ha: P.area_min_ha }));

    // --- Umbral ESTRICTO. Exactamente igual NO lo supera: se admite y se avisa. Sin banda de tolerancia.
    if (ref === null) {
      checks.push(chk('THRESHOLD', 'NOT_EXECUTED', 'REQUIRES_KNOWN_AREA'));
    } else {
      const above = ref > P.threshold_ha;
      const detail = { area_ha: areaValue, area_basis: areaBasis, threshold_ha: P.threshold_ha, operator: P.threshold_operator };
      if (above && !polygonal) checks.push(chk('THRESHOLD', 'FAIL', 'POLYGON_REQUIRED_ABOVE_THRESHOLD', detail));
      else if (above) checks.push(chk('THRESHOLD', 'PASS', 'ABOVE_THRESHOLD_WITH_POLYGON', detail));
      else if (ref === P.threshold_ha) checks.push(chk('THRESHOLD', 'PASS', 'AT_THRESHOLD', { ...detail, at_threshold: true }));
      else checks.push(chk('THRESHOLD', 'PASS', 'BELOW_THRESHOLD', detail));
    }

    // --- Discrepancia: solo importa si las dos cifras caen a distinto lado del umbral.
    if (declared === null || calculated === null) {
      checks.push(chk('AREA_DISCREPANCY', 'NOT_EXECUTED', declared === null ? 'NO_DECLARED_AREA' : 'REQUIRES_KNOWN_AREA'));
    } else {
      const crosses = (declared > P.threshold_ha) !== (calculated > P.threshold_ha);
      checks.push(crosses
        ? chk('AREA_DISCREPANCY', 'REVIEW', 'AREA_DISCREPANCY_CROSSES_THRESHOLD', { declared_ha: g.area_declared_ha, calculated_ha: g.area_calculated_ha, threshold_ha: P.threshold_ha })
        : chk('AREA_DISCREPANCY', 'PASS', 'AREA_DISCREPANCY_NONE', { declared_ha: g.area_declared_ha, calculated_ha: g.area_calculated_ha }));
    }

    // --- Truncamiento. Sobre una copia; el original no se toca, no se repara y no se sustituye.
    if (!technicallyUsable || holes > 0) {
      checks.push(chk('INTERCHANGE_PRECISION', 'NOT_EXECUTED', holes > 0 ? 'HOLES_PRESENT' : 'REQUIRES_VALID_GEOMETRY'));
    } else {
      const t = await this.truncation(db, versionId, gtype);
      const detail = {
        decimals: P.interchange_decimals, mode: P.truncation,
        duplicates_before: t.duplicates_before, duplicates_after: t.duplicates_after,
        note: 'Comprobación sobre una copia. La geometría almacenada no se modifica ni se repara.',
      };
      if (!t.executed) checks.push(chk('INTERCHANGE_PRECISION', 'NOT_EXECUTED', 'REQUIRES_VALID_GEOMETRY'));
      else if (t.valid_after === false) checks.push(chk('INTERCHANGE_PRECISION', 'FAIL', 'INVALID_AFTER_TRUNCATION', detail));
      else if (polygonal && (t.area_after ?? 0) === 0) checks.push(chk('INTERCHANGE_PRECISION', 'FAIL', 'DEGENERATE_AFTER_TRUNCATION', detail));
      else if (t.duplicates_after > t.duplicates_before) checks.push(chk('INTERCHANGE_PRECISION', 'FAIL', 'VERTEX_COLLAPSE_ON_TRUNCATION', detail));
      else if (t.duplicates_before > 0) checks.push(chk('INTERCHANGE_PRECISION', 'REVIEW', 'DUPLICATE_VERTEX_IN_SOURCE', detail));
      else checks.push(chk('INTERCHANGE_PRECISION', 'PASS', 'TRUNCATION_SAFE', detail));
    }

    const outcomes = checks.map((c) => c.outcome);
    // Un caso que no se pudo evaluar NO se convierte en aceptado ni arrastra a los demás a rechazo: queda
    // NOT_EVALUABLE con su motivo. Un fallo sí es un fallo, y pesa más que un «no ejecutado».
    const status: ProfileStatus = outcomes.includes('FAIL') ? 'DOES_NOT_MEET'
      : outcomes.includes('REVIEW') ? 'REVIEW_REQUIRED'
        : outcomes.some((o, i) => o === 'NOT_EXECUTED' && checks[i].code !== 'AREA_DISCREPANCY') ? 'NOT_EVALUABLE'
          : 'MEETS_PROFILE';
    return { checks, status, areaBasis, areaValue };
  }

  view(row: Row) {
    const checks = row.checks as Check[];
    return {
      id: row.id,
      plot_id: row.plot_id,
      plot_version_id: row.plot_version_id,
      profile: { id: row.profile_id, version: row.profile_version, status: GEO_PROFILE.status, note: GEO_PROFILE.status_note },
      source: {
        service_version: row.source_service_version,
        document_version: row.source_document_version,
        page_date: ymd(row.source_page_date),
        copy: PROFILE_SOURCE.copy,
        verification: PROFILE_SOURCE.verification,
        verification_note: PROFILE_SOURCE.verification_note,
      },
      status: row.status,
      label: STATUS_LABEL[row.status as ProfileStatus],
      exportable: row.exportable,
      area: { basis: row.area_basis, value_ha: row.area_value_ha, note: AREA_NOTE[row.area_basis as 'CALCULATED' | 'DECLARED' | 'NONE'] },
      parameters: row.parameters,
      checks,
      failed: checks.filter((c) => c.outcome === 'FAIL').map((c) => ({ code: c.code, reason_code: c.reason_code, message: c.message })),
      decimals_contract: DECIMALS_CONTRACT,
      not_in_scope: GEO_PROFILE.not_in_scope,
      disclaimer: 'Cumplir el perfil técnico NO es conformidad EUDR ni aprobación: dice que el archivo está bien formado para una versión documentada del destino. La aplicabilidad jurídica es D-05.B y sigue pendiente.',
      evaluated_at: row.evaluated_at,
    };
  }

  /** Último dictamen de perfil de una versión, o null. Se lee; nunca se evalúa al vuelo en una lectura. */
  async latestForVersion(db: Db, orgId: string, versionId: string) {
    const r = await db.selectFrom('geo_profile_evaluations').selectAll()
      .where('organization_id', '=', orgId).where('plot_version_id', '=', versionId)
      .orderBy('evaluated_at', 'desc').limit(1).executeTakeFirst();
    return r ?? null;
  }

  async history(user: AuthUser, orgId: string, plotId: string) {
    const ctx = await this.readCtx(user, orgId);
    await this.plots.load(this.db, ctx, plotId, 'read');
    const rows = await this.db.selectFrom('geo_profile_evaluations').selectAll()
      .where('organization_id', '=', orgId).where('plot_id', '=', plotId).orderBy('evaluated_at', 'desc').execute();
    return {
      profile: { id: GEO_PROFILE.id, version: GEO_PROFILE.version, status: GEO_PROFILE.status, note: GEO_PROFILE.status_note },
      source: PROFILE_SOURCE,
      decimals_contract: DECIMALS_CONTRACT,
      evaluations: rows.map((r) => this.view(r)),
      note: 'Las evaluaciones son append-only: no se corrigen, se añade otra. El dictamen de perfil es independiente del técnico (TL_GIS_TECH) y pueden discrepar.',
    };
  }
}

export const STATUS_LABEL: Record<ProfileStatus, string> = {
  MEETS_PROFILE: 'Cumple el perfil técnico de destino',
  DOES_NOT_MEET: 'No cumple el perfil técnico de destino',
  REVIEW_REQUIRED: 'Requiere revisión humana antes de decidir',
  NOT_EVALUABLE: 'No evaluable con los datos disponibles',
};
const AREA_NOTE: Record<'CALCULATED' | 'DECLARED' | 'NONE', string> = {
  CALCULATED: 'Calculada sobre la geometría. Seis decimales son capacidad de representación, no exactitud de medición.',
  DECLARED: 'Declarada por una persona, con escalón de 0,0001 ha. Un punto no tiene superficie calculada.',
  NONE: 'Sin superficie de referencia: el umbral no se puede evaluar.',
};

@ApiTags('plots')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/plots/:plotId/geo-profile')
export class GeoProfileController {
  constructor(private readonly service: GeoProfileService) {}

  @Post('evaluations')
  evaluate(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('plotId', ParseUUIDPipe) p: string,
    @Body() dto: EvaluateProfileDto, @Req() req: AuthedRequest) {
    return this.service.evaluate(u, o, p, dto, req.requestId);
  }

  @Get('evaluations')
  history(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('plotId', ParseUUIDPipe) p: string) {
    return this.service.history(u, o, p);
  }
}
