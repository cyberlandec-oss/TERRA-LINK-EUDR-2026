import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import type { Response } from 'express';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database, GisEvaluationsTable } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { PlotsService } from './plots';
import { summarizeAccuracy } from './accuracy-summary';

// P0-010 — Evaluación GIS TÉCNICA (perfil TL_GIS_TECH). Evalúa una versión geométrica SIN modificarla y
// guarda un registro inmutable. Tres bloques separados:
//   1. Validez técnica (estado VALID/WARNING/INVALID/REVIEW_REQUIRED, alcance técnico únicamente).
//   2. Calidad y cobertura de captura (informativa; sin umbrales: D-25).
//   3. Perfil de destino / requisitos regulatorios: NO EVALUADO, requiere definición (D-05).
// «VALID» significa técnicamente válida bajo esta regla; no es conformidad EUDR ni aprobación.
// Sin umbral de 4 ha, sin área mínima, sin precisión mínima, sin restricciones territoriales.

export const GIS_RULE = {
  id: 'TL_GIS_TECH',
  // 1.0.0: comparación siempre con toda la organización (registros anteriores a la migración 0013).
  // 1.0.1 (corrección de privacidad): el conjunto comparado depende del alcance del evaluador
  // (ORGANIZATION o EVALUATOR_ASSIGNED, guardado en cada registro). Mismas comprobaciones geométricas.
  version: '1.0.1',
  parameters: {
    srid: 4326,
    coordinate_ranges: { longitude: [-180, 180], latitude: [-90, 90] },
    comparison_scope: 'ORGANIZATION (evaluador con plot:read) o EVALUATOR_ASSIGNED (solo parcelas asignadas al evaluador); otras parcelas activas, versión vigente',
    equality: 'ST_Equals (igualdad topológica; independiente del orden o del punto inicial de los vértices)',
    overlap: 'intersección con superficie (DE-9IM 2********)',
    touch: 'contacto solo por borde o vértice (ST_Touches)',
    area: 'ST_Area(geography) / 10000, solo polígonos válidos y no degenerados',
    accuracy_thresholds: null,
    area_threshold_ha: null,
    destination_profile: null,
  },
  checks: [
    { code: 'GEOMETRY_PRESENT', category: 'TECHNICAL', description: 'La versión tiene geometría' },
    { code: 'GEOMETRY_TYPE', category: 'TECHNICAL', description: 'Punto, polígono o multipolígono coherente con el tipo registrado' },
    { code: 'SRID', category: 'TECHNICAL', description: 'SRID 4326 (WGS84, longitud/latitud)' },
    { code: 'COORDINATE_RANGE', category: 'TECHNICAL', description: 'Longitud −180…180 y latitud −90…90' },
    { code: 'NOT_EMPTY', category: 'TECHNICAL', description: 'La geometría no está vacía' },
    { code: 'NOT_DEGENERATE', category: 'TECHNICAL', description: 'Un polígono encierra superficie (no colapsa en línea o punto)' },
    { code: 'TECHNICAL_VALIDITY', category: 'TECHNICAL', description: 'Validez OGC (autointersección, huecos, anillos)' },
    { code: 'AREA', category: 'TECHNICAL', description: 'Superficie calculada cuando corresponde' },
    { code: 'GEOMETRIC_EQUALITY', category: 'TECHNICAL', description: 'Igualdad geométrica con otras parcelas activas de la organización' },
    { code: 'OVERLAP', category: 'TECHNICAL', description: 'Superficie compartida con otras parcelas activas (el contacto por borde no cuenta)' },
  ],
  not_in_scope: [
    'Umbral de superficie (incluido el caso igual a 4 ha) — D-05',
    'Formato y precisión del sistema de destino — D-05',
    'Precisión mínima de captura — D-25',
    'Punto dentro de otra parcela, cobertura territorial y capas externas',
    'Análisis satelital, deforestación y legalidad',
  ],
} as const;

const RULE_TAG = `${GIS_RULE.id}@${GIS_RULE.version}`;

type Outcome = 'PASS' | 'FAIL' | 'REVIEW' | 'WARNING' | 'NOT_APPLICABLE' | 'NOT_EXECUTED' | 'RESTRICTED';
interface Check { code: string; category: 'TECHNICAL'; outcome: Outcome; reason_code: string | null; message: string; details?: Record<string, unknown> }
type EvalRow = Selectable<GisEvaluationsTable>;

/** Motivos de PostGIS → códigos controlados (sin texto libre ni coordenadas). */
export function validityCode(reason: string | null): string {
  if (!reason) return 'INVALID_OTHER';
  const r = reason.toLowerCase();
  if (r.startsWith('ring self-intersection')) return 'RING_SELF_INTERSECTION';
  if (r.startsWith('self-intersection')) return 'SELF_INTERSECTION';
  if (r.startsWith('hole lies outside shell')) return 'HOLE_OUTSIDE_SHELL';
  if (r.startsWith('holes are nested')) return 'NESTED_HOLES';
  if (r.startsWith('nested shells')) return 'NESTED_SHELLS';
  if (r.startsWith('interior is disconnected')) return 'INTERIOR_DISCONNECTED';
  if (r.startsWith('too few points')) return 'TOO_FEW_POINTS';
  if (r.startsWith('invalid coordinate')) return 'INVALID_COORDINATE';
  if (r.startsWith('ring is not closed')) return 'RING_NOT_CLOSED';
  if (r.startsWith('duplicate rings')) return 'DUPLICATE_RINGS';
  return 'INVALID_OTHER';
}

const MESSAGES: Record<string, string> = {
  GEOMETRY_MISSING: 'La versión solo tiene superficie declarada: no hay geometría que evaluar.',
  TYPE_NOT_SUPPORTED: 'El tipo de geometría no es punto, polígono ni multipolígono, o no coincide con el registrado.',
  SRID_NOT_4326: 'La geometría no está en WGS84 (SRID 4326).',
  COORDINATES_OUT_OF_RANGE: 'Hay coordenadas fuera de los rangos de longitud o latitud.',
  GEOMETRY_EMPTY: 'La geometría está vacía.',
  GEOMETRY_DEGENERATE: 'El polígono no encierra superficie (sus vértices están alineados o repetidos).',
  SELF_INTERSECTION: 'El borde se cruza consigo mismo.',
  RING_SELF_INTERSECTION: 'Un anillo se toca o cruza consigo mismo.',
  HOLE_OUTSIDE_SHELL: 'Un hueco queda fuera del borde exterior.',
  NESTED_HOLES: 'Hay huecos dentro de otros huecos.',
  NESTED_SHELLS: 'Un componente del multipolígono queda dentro de otro.',
  INTERIOR_DISCONNECTED: 'Los huecos dividen el interior en partes separadas.',
  TOO_FEW_POINTS: 'Un anillo tiene muy pocos vértices.',
  INVALID_COORDINATE: 'Hay una coordenada no válida.',
  RING_NOT_CLOSED: 'Un anillo no está cerrado.',
  DUPLICATE_RINGS: 'Hay anillos repetidos.',
  INVALID_OTHER: 'La geometría no es válida técnicamente.',
  POINT_HAS_NO_AREA: 'Un punto no tiene superficie.',
  REQUIRES_VALID_GEOMETRY: 'No se ejecutó: requiere una geometría técnicamente válida.',
  REQUIRES_PRESENT_GEOMETRY: 'No se ejecutó: la versión no tiene geometría.',
  EQUAL_GEOMETRY_FOUND: 'Otra parcela activa tiene la misma geometría. No prueba un duplicado ni ilegalidad, y no autoriza fusionar parcelas: requiere revisión.',
  OVERLAP_FOUND: 'Comparte superficie con otra parcela activa. No prueba ilegalidad ni autoriza fusionar parcelas: requiere revisión.',
  NO_MATCHES: 'Sin coincidencias ni superficie compartida con otras parcelas activas.',
  TOUCH_ONLY: 'Solo hay contacto por borde o vértice con otras parcelas; no se comparte superficie.',
  COMPARISONS_INCOMPLETE: 'Algunas parcelas no se compararon porque su geometría no es válida técnicamente.',
  POINT_OVERLAP_NOT_IN_RULE: 'No se ejecutó: «punto dentro de otra parcela» no forma parte de esta versión de la regla.',
  COMPARISON_RESTRICTED: 'Reservada: la comparación con otras parcelas solo se muestra a usuarios con acceso a todas las parcelas de la organización.',
  PASS: 'Correcto.',
};
const ACTIONS: Record<string, string> = {
  GEOMETRY_MISSING: 'Captura un punto o polígono, o importa un GeoJSON.',
  INVALID: 'Corrige la geometría con una nueva versión (captura o importación). No hay reparación automática.',
  REVIEW: 'Un usuario con acceso a toda la organización debe revisar las parcelas relacionadas y decidir; la evaluación no modifica ni fusiona parcelas.',
  WARNING: 'Revisa los datos faltantes indicados y vuelve a evaluar cuando se corrijan.',
  VALID: 'Sin acciones técnicas pendientes. La conformidad regulatoria no se evalúa aquí (D-05).',
};

const chk = (code: string, outcome: Outcome, reason: string | null, details?: Record<string, unknown>): Check =>
  ({ code, category: 'TECHNICAL', outcome, reason_code: reason, message: MESSAGES[reason ?? 'PASS'] ?? MESSAGES.PASS, ...(details ? { details } : {}) });

class EvaluateDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiPropertyOptional({ description: 'Versión a evaluar; por omisión la vigente' }) @IsOptional() @IsUUID() plot_version_id?: string;
}

@Injectable()
export class GisEvaluationService {
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

  /** Filtro del alcance efectivo de comparación (doc 09: no revelar recursos fuera del alcance). */
  private scopeFilter(scopeMembership: string | null) {
    return scopeMembership
      ? sql`AND EXISTS (SELECT 1 FROM producers pr WHERE pr.id = p.producer_id AND pr.organization_id = p.organization_id AND (pr.assigned_membership_id = ${scopeMembership} OR pr.self_membership_id = ${scopeMembership}))`
      : sql``;
  }

  /** Huella del conjunto comparable (otras parcelas activas con geometría vigente, dentro del alcance). */
  private async comparedSet(db: Kysely<Database> | Transaction<Database>, orgId: string, plotId: string, scopeMembership: string | null) {
    const r = await sql<{ agg: string | null; n: number }>`
      SELECT string_agg(p.id || ':' || v.id || ':' || v.geometry_hash, ',' ORDER BY p.id) AS agg, count(*)::int AS n
      FROM plots p JOIN plot_versions v ON v.id = p.current_version_id AND v.organization_id = p.organization_id
      WHERE p.organization_id = ${orgId} AND p.id <> ${plotId} AND p.status = 'ACTIVE' AND v.geometry IS NOT NULL ${this.scopeFilter(scopeMembership)}`.execute(db);
    return { hash: createHash('sha256').update(r.rows[0].agg ?? '').digest('hex'), count: r.rows[0].n };
  }

  async evaluate(user: AuthUser, orgId: string, plotId: string, dto: EvaluateDto, requestId?: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.plots.has(ctx, 'plot:evaluate_gis') && !this.plots.has(ctx, 'plot:evaluate_gis_assigned')) throw forbidden();
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    const plot = await this.plots.load(this.db, ctx, plotId, 'read'); // alcance del técnico (asignación vigente)

    const prior = await this.db.selectFrom('gis_evaluations').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.plot_id !== plotId || (dto.plot_version_id && prior.plot_version_id !== dto.plot_version_id)) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó en otra evaluación.');
      return { replayed: true, evaluation: await this.view(this.db, ctx, prior) };
    }
    const versionId = dto.plot_version_id ?? plot.current_version_id;
    // Alcance efectivo: quien no lee toda la organización compara solo con sus parcelas asignadas.
    const scopeMembership = this.plots.has(ctx, 'plot:read') ? null : ctx.membershipId;
    const comparisonScope = scopeMembership ? 'EVALUATOR_ASSIGNED' : 'ORGANIZATION';
    if (!versionId) throw new AppError(422, 'PLOT_WITHOUT_VERSION', 'La parcela no tiene versiones geométricas que evaluar.');

    try {
      const row = await this.db.transaction().execute(async (trx) => {
        const info = await sql<{
          found: boolean; missing: boolean; registered_type: string | null; gtype: string | null; srid: number | null; empty: boolean | null;
          in_range: boolean | null; valid: boolean | null; reason: string | null; planar_area: number | null; area_ha: string | null;
          geometry_hash: string | null; survey_method: string; source_import_id: string | null;
        }>`
          SELECT true AS found, v.geometry IS NULL AS missing, v.geometry_type AS registered_type, GeometryType(v.geometry) AS gtype,
                 ST_SRID(v.geometry) AS srid, ST_IsEmpty(v.geometry) AS empty,
                 CASE WHEN ST_IsEmpty(v.geometry) THEN NULL ELSE ST_XMin(v.geometry) >= -180 AND ST_XMax(v.geometry) <= 180 AND ST_YMin(v.geometry) >= -90 AND ST_YMax(v.geometry) <= 90 END AS in_range,
                 (ST_IsValidDetail(v.geometry)).valid AS valid, (ST_IsValidDetail(v.geometry)).reason AS reason,
                 CASE WHEN GeometryType(v.geometry) IN ('POLYGON','MULTIPOLYGON') THEN ST_Area(v.geometry) ELSE NULL END AS planar_area,
                 CASE WHEN GeometryType(v.geometry) IN ('POLYGON','MULTIPOLYGON') AND (ST_IsValidDetail(v.geometry)).valid AND ST_Area(v.geometry) > 0
                      THEN round((ST_Area(v.geometry::geography) / 10000)::numeric, 6)::text ELSE NULL END AS area_ha,
                 v.geometry_hash, v.survey_method, v.source_import_id
          FROM plot_versions v WHERE v.organization_id = ${orgId} AND v.plot_id = ${plotId} AND v.id = ${versionId}`.execute(trx);
        const g = info.rows[0];
        if (!g) throw notFound('La versión no existe en esta parcela.');

        const checks: Check[] = [];
        const comparisons: Array<{ plot_id: string; version_id: string; hash: string; relation: 'EQUAL' | 'OVERLAP' | 'TOUCH'; same_hash: boolean; shared_m2: string | null }> = [];
        let locationSql = sql`NULL::geometry`;
        let status: EvalRow['status'];
        const set = await this.comparedSet(trx, orgId, plotId, scopeMembership);

        if (g.missing) {
          checks.push(chk('GEOMETRY_PRESENT', 'FAIL', 'GEOMETRY_MISSING'));
          for (const c of GIS_RULE.checks.slice(1)) checks.push(chk(c.code, 'NOT_APPLICABLE', 'REQUIRES_PRESENT_GEOMETRY'));
          status = 'REVIEW_REQUIRED';
        } else {
          checks.push(chk('GEOMETRY_PRESENT', 'PASS', null));
          const polygonal = g.gtype === 'POLYGON' || g.gtype === 'MULTIPOLYGON';
          checks.push(['POINT', 'POLYGON', 'MULTIPOLYGON'].includes(g.gtype ?? '') && g.gtype === g.registered_type ? chk('GEOMETRY_TYPE', 'PASS', null) : chk('GEOMETRY_TYPE', 'FAIL', 'TYPE_NOT_SUPPORTED'));
          checks.push(g.srid === 4326 ? chk('SRID', 'PASS', null) : chk('SRID', 'FAIL', 'SRID_NOT_4326'));
          checks.push(g.empty ? chk('COORDINATE_RANGE', 'NOT_APPLICABLE', 'GEOMETRY_EMPTY') : g.in_range ? chk('COORDINATE_RANGE', 'PASS', null) : chk('COORDINATE_RANGE', 'FAIL', 'COORDINATES_OUT_OF_RANGE'));
          checks.push(g.empty ? chk('NOT_EMPTY', 'FAIL', 'GEOMETRY_EMPTY') : chk('NOT_EMPTY', 'PASS', null));
          const degenerate = polygonal && !g.empty && (g.planar_area ?? 0) === 0;
          checks.push(!polygonal ? chk('NOT_DEGENERATE', 'NOT_APPLICABLE', 'POINT_HAS_NO_AREA') : g.empty ? chk('NOT_DEGENERATE', 'NOT_EXECUTED', 'GEOMETRY_EMPTY') : degenerate ? chk('NOT_DEGENERATE', 'FAIL', 'GEOMETRY_DEGENERATE') : chk('NOT_DEGENERATE', 'PASS', null));
          if (g.valid) checks.push(chk('TECHNICAL_VALIDITY', 'PASS', null));
          else {
            checks.push(chk('TECHNICAL_VALIDITY', 'FAIL', validityCode(g.reason)));
            locationSql = sql`(SELECT (ST_IsValidDetail(v.geometry)).location FROM plot_versions v WHERE v.id = ${versionId})`;
          }
          const usable = !!g.valid && !g.empty && !degenerate && g.srid === 4326;
          checks.push(!polygonal ? chk('AREA', 'NOT_APPLICABLE', 'POINT_HAS_NO_AREA') : usable ? { ...chk('AREA', 'PASS', null), details: { area_calculated_ha: g.area_ha } } : chk('AREA', 'NOT_EXECUTED', 'REQUIRES_VALID_GEOMETRY'));

          if (!usable) {
            checks.push(chk('GEOMETRIC_EQUALITY', 'NOT_EXECUTED', 'REQUIRES_VALID_GEOMETRY'));
            checks.push(chk('OVERLAP', 'NOT_EXECUTED', 'REQUIRES_VALID_GEOMETRY'));
          } else {
            // Solo otras parcelas (nunca versiones históricas de la misma) y solo geometrías válidas: GEOS no
            // compara geometrías inválidas de forma fiable.
            const rel = await sql<{ plot_id: string; version_id: string; hash: string; valid: boolean; equal: boolean | null; overlap: boolean | null; touch: boolean | null; shared_m2: string | null }>`
              WITH me AS (SELECT geometry FROM plot_versions WHERE id = ${versionId}),
              cand AS (
                SELECT p.id AS plot_id, v.id AS version_id, v.geometry_hash AS hash, v.geometry, (ST_IsValidDetail(v.geometry)).valid AS valid
                FROM plots p JOIN plot_versions v ON v.id = p.current_version_id AND v.organization_id = p.organization_id
                WHERE p.organization_id = ${orgId} AND p.id <> ${plotId} AND p.status = 'ACTIVE' AND v.geometry IS NOT NULL
                  AND v.geometry && (SELECT geometry FROM me) ${this.scopeFilter(scopeMembership)})
              SELECT c.plot_id, c.version_id, c.hash, c.valid,
                     CASE WHEN c.valid THEN ST_Equals(c.geometry, me.geometry) END AS equal,
                     CASE WHEN c.valid AND ${polygonal} AND GeometryType(c.geometry) IN ('POLYGON','MULTIPOLYGON') THEN ST_Relate(c.geometry, me.geometry, '2********') END AS overlap,
                     CASE WHEN c.valid AND ${polygonal} THEN ST_Touches(c.geometry, me.geometry) END AS touch,
                     CASE WHEN c.valid AND ${polygonal} AND GeometryType(c.geometry) IN ('POLYGON','MULTIPOLYGON') AND ST_Relate(c.geometry, me.geometry, '2********')
                          THEN round(ST_Area(ST_Intersection(c.geometry, me.geometry)::geography)::numeric, 2)::text END AS shared_m2
              FROM cand c, me`.execute(trx);
            const skipped = rel.rows.filter((r) => !r.valid).length;
            for (const r of rel.rows.filter((x) => x.valid)) {
              const relation = r.equal ? 'EQUAL' : r.overlap ? 'OVERLAP' : r.touch ? 'TOUCH' : null;
              if (relation) comparisons.push({ plot_id: r.plot_id, version_id: r.version_id, hash: r.hash, relation, same_hash: r.hash === g.geometry_hash, shared_m2: relation === 'TOUCH' ? null : r.shared_m2 });
            }
            const equal = comparisons.filter((c) => c.relation === 'EQUAL').length;
            const overlap = comparisons.filter((c) => c.relation === 'OVERLAP').length;
            const touch = comparisons.filter((c) => c.relation === 'TOUCH').length;
            checks.push(equal ? chk('GEOMETRIC_EQUALITY', 'REVIEW', 'EQUAL_GEOMETRY_FOUND', { count: equal }) : skipped ? chk('GEOMETRIC_EQUALITY', 'WARNING', 'COMPARISONS_INCOMPLETE', { skipped }) : chk('GEOMETRIC_EQUALITY', 'PASS', 'NO_MATCHES'));
            if (!polygonal) checks.push(chk('OVERLAP', 'NOT_EXECUTED', 'POINT_OVERLAP_NOT_IN_RULE'));
            else checks.push(overlap ? chk('OVERLAP', 'REVIEW', 'OVERLAP_FOUND', { count: overlap, touch_only: touch }) : skipped ? chk('OVERLAP', 'WARNING', 'COMPARISONS_INCOMPLETE', { skipped, touch_only: touch }) : chk('OVERLAP', 'PASS', touch ? 'TOUCH_ONLY' : 'NO_MATCHES', { touch_only: touch }));
          }
          const outcomes = checks.map((c) => c.outcome);
          status = outcomes.includes('FAIL') ? 'INVALID' : outcomes.includes('REVIEW') ? 'REVIEW_REQUIRED' : outcomes.includes('WARNING') ? 'WARNING' : 'VALID';
        }

        const capture = await this.captureQuality(trx, orgId, versionId, g.missing, g.survey_method, g.source_import_id);
        const destination = {
          status: 'NOT_EVALUATED', reason_code: 'PROFILE_REQUIRES_DEFINITION', decision: 'D-05',
          label: 'No evaluado: el perfil de destino requiere definición (D-05). Esta evaluación no acredita conformidad EUDR.',
          not_evaluated: GIS_RULE.not_in_scope.slice(0, 2),
        };
        const id = randomUUID();
        const inserted = await sql<EvalRow>`
          INSERT INTO gis_evaluations (id, organization_id, plot_id, plot_version_id, geometry_hash, rule_id, rule_version, parameters, status,
            checks, capture_quality, destination_profile, error_location, compared_set_hash, compared_count, operation_id, evaluated_by,
            comparison_scope, scope_membership_id)
          VALUES (${id}, ${orgId}, ${plotId}, ${versionId}, ${g.geometry_hash}, ${GIS_RULE.id}, ${GIS_RULE.version},
            ${JSON.stringify({ ...GIS_RULE.parameters, comparison_scope: comparisonScope })}::jsonb, ${status},
            ${JSON.stringify(checks)}::jsonb, ${JSON.stringify(capture)}::jsonb, ${JSON.stringify(destination)}::jsonb, ${locationSql},
            ${set.hash}, ${set.count}, ${dto.operation_id}, ${user.id}, ${comparisonScope}, ${scopeMembership})
          RETURNING *`.execute(trx);
        for (const c of comparisons) {
          await trx.insertInto('gis_evaluation_comparisons').values({
            evaluation_id: id, organization_id: orgId, compared_plot_id: c.plot_id, compared_version_id: c.version_id,
            compared_geometry_hash: c.hash, relation: c.relation, same_hash: c.same_hash, shared_area_m2: c.shared_m2,
          }).execute();
        }
        const counts = { equal: comparisons.filter((c) => c.relation === 'EQUAL').length, overlap: comparisons.filter((c) => c.relation === 'OVERLAP').length, touch: comparisons.filter((c) => c.relation === 'TOUCH').length };
        await this.events.append(trx, {
          // La evaluación no cambia la parcela: el agregado es la propia evaluación (inmutable, versión 1).
          organizationId: orgId, eventType: 'PlotGisEvaluated', schemaVersion: 1, aggregateType: 'GIS_EVALUATION', aggregateId: id,
          aggregateVersion: 1, actorId: user.id, correlationId: requestId,
          payload: { evaluation_id: id, plot_id: plotId, plot_version_id: versionId, rule: RULE_TAG, status, failed_checks: checks.filter((c) => c.outcome === 'FAIL').map((c) => c.reason_code), relations: counts },
        });
        await this.audit.record(trx, {
          organizationId: orgId, actorUserId: user.id, action: 'plot.gis_evaluate', entityType: 'plot', entityId: plotId, requestId, result: 'SUCCESS',
          after: { evaluation_id: id, plot_version_id: versionId, rule: RULE_TAG, status, relations: counts },
        });
        return inserted.rows[0];
      });
      return { replayed: false, evaluation: await this.view(this.db, ctx, row) };
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'gis_evaluations_operation_uq') {
        const again = await this.db.selectFrom('gis_evaluations').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
        if (again && again.plot_id === plotId) return { replayed: true, evaluation: await this.view(this.db, ctx, again) };
        throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó en otra evaluación.');
      }
      throw e;
    }
  }

  /** Calidad/cobertura de captura: informativa, sin umbrales (D-25); nunca se infiere de decimales. */
  private async captureQuality(db: Kysely<Database> | Transaction<Database>, orgId: string, versionId: string, missing: boolean, method: string, importId: string | null) {
    const base = { thresholds: null, threshold_note: 'Sin umbral de precisión: política pendiente (D-25).' };
    if (missing) return { ...base, status: 'NOT_APPLICABLE', reason_code: 'NO_GEOMETRY', label: 'No aplica: la versión no tiene geometría.' };
    if (importId || method === 'FILE_IMPORT') return { ...base, status: 'NOT_AVAILABLE', reason_code: 'IMPORTED_WITHOUT_SAMPLES', label: 'Precisión de captura no disponible (geometría importada; los decimales del archivo no son precisión).' };
    let values: Array<number | null> = [];
    if (method === 'BROWSER_GEOLOCATION') {
      const pt = await db.selectFrom('location_samples').select('horizontal_accuracy_m').where('organization_id', '=', orgId).where('plot_version_id', '=', versionId).execute();
      const poly = await sql<{ acc: number | null }>`
        SELECT dv.horizontal_accuracy_m AS acc FROM polygon_drafts d
        JOIN draft_vertices dv ON dv.draft_id = d.id AND dv.organization_id = d.organization_id
        LEFT JOIN draft_vertex_exclusions x ON x.vertex_id = dv.id
        WHERE d.organization_id = ${orgId} AND d.confirmed_version_id = ${versionId} AND x.vertex_id IS NULL`.execute(db);
      values = [...pt.map((r) => r.horizontal_accuracy_m), ...poly.rows.map((r) => r.acc)];
    }
    if (values.length === 0) return { ...base, status: 'NOT_AVAILABLE', reason_code: 'NO_CAPTURE_SAMPLES', label: 'Precisión de captura no disponible (sin muestras de captura para este método).' };
    const s = summarizeAccuracy(values);
    return { ...base, status: s.complete ? 'COMPLETE' : s.with_accuracy === 0 ? 'ABSENT' : 'PARTIAL', reason_code: null, label: s.label, summary: s, samples: values.length };
  }

  /**
   * Proyección por lector (doc 09: «no revelar counts o identidades ocultas»):
   * - Lector con plot:read ve el registro completo.
   * - Lector restringido (solo _assigned) ve las comparaciones únicamente si la evaluación se hizo con SU
   *   alcance asignado; aun así se recalculan solo con las parcelas que hoy puede leer.
   * - En cualquier otro caso el bloque de comparación se muestra como RESERVADO SIEMPRE, con el mismo texto
   *   haya o no coincidencias, y el estado se calcula solo con las comprobaciones de la propia geometría.
   *   Así ni el estado, ni los conteos, ni los tipos de relación permiten inferir parcelas ocultas.
   */
  private async view(db: Kysely<Database> | Transaction<Database>, ctx: TenantContext, row: EvalRow & { comparison_scope?: string; scope_membership_id?: string | null }) {
    const full = this.plots.has(ctx, 'plot:read');
    const scope = row.comparison_scope ?? 'ORGANIZATION';
    const scopeMembership = row.scope_membership_id ?? null;
    const comparisonsVisible = full || (scope === 'EVALUATOR_ASSIGNED' && scopeMembership === ctx.membershipId);
    const plot = await db.selectFrom('plots').select(['current_version_id']).where('organization_id', '=', row.organization_id).where('id', '=', row.plot_id).executeTakeFirstOrThrow();
    const version = await db.selectFrom('plot_versions').select(['version_number']).where('id', '=', row.plot_version_id).executeTakeFirstOrThrow();
    const stale: string[] = [];
    if (plot.current_version_id !== row.plot_version_id) {
      // Versión nueva: si su geometría es la misma (p. ej. solo cambió la superficie declarada, que esta evaluación no usa),
      // se informa con precisión; la evaluación sigue ligada a su versión y NO se hereda para la vigente.
      // Solo cuenta como «misma geometría» si la vigente COPIA la misma captura evaluada (superficie declarada); volver a
      // capturar coordenadas idénticas es una captura nueva (GEOMETRY_CHANGED).
      const vs = await db.selectFrom('plot_versions').select(['id', 'geometry_origin_version_id']).where('organization_id', '=', row.organization_id)
        .where('id', 'in', [row.plot_version_id, plot.current_version_id].filter((x): x is string => !!x)).execute();
      const evaluated = vs.find((x) => x.id === row.plot_version_id);
      const current = vs.find((x) => x.id === plot.current_version_id);
      const capture = evaluated ? (evaluated.geometry_origin_version_id ?? evaluated.id) : null;
      stale.push(current?.geometry_origin_version_id && current.geometry_origin_version_id === capture ? 'PLOT_VERSION_CHANGED_SAME_GEOMETRY' : 'GEOMETRY_CHANGED');
    }
    if (row.rule_version !== GIS_RULE.version || row.rule_id !== GIS_RULE.id) stale.push('RULES_CHANGED');
    if (comparisonsVisible) {
      const set = await this.comparedSet(db, row.organization_id, row.plot_id, scopeMembership);
      if (set.hash !== row.compared_set_hash) stale.push('COMPARED_PLOTS_CHANGED');
    }
    const geometry = this.plots.geometryAllowed(ctx);
    const loc = geometry && row.error_location
      ? (await sql<{ g: unknown }>`SELECT ST_AsGeoJSON(error_location, 17)::jsonb AS g FROM gis_evaluations WHERE id = ${row.id}`.execute(db)).rows[0].g
      : null;

    let checks = row.checks as Check[];
    let status = row.status;
    const relations: unknown[] = [];
    if (comparisonsVisible) {
      const cmps = await db.selectFrom('gis_evaluation_comparisons as c')
        .innerJoin('plots as p', (j) => j.onRef('p.id', '=', 'c.compared_plot_id').onRef('p.organization_id', '=', 'c.organization_id'))
        .innerJoin('plot_versions as v', 'v.id', 'c.compared_version_id')
        .select(['c.compared_plot_id', 'c.relation', 'c.same_hash', 'c.shared_area_m2', 'p.plot_code', 'v.version_number'])
        .where('c.evaluation_id', '=', row.id).execute();
      for (const c of cmps) {
        const can = full || (await this.plots.load(db, ctx, c.compared_plot_id, 'read').then(() => true, () => false));
        if (can) relations.push({ plot_id: c.compared_plot_id, plot_code: c.plot_code, version_number: c.version_number, relation: c.relation, same_hash: c.same_hash, shared_area_m2: c.shared_area_m2 });
      }
      if (!full) {
        // recalcular con lo visible (una reasignación posterior no debe filtrar relaciones ocultas)
        const vis = relations as Array<{ relation: string }>;
        const equal = vis.filter((r) => r.relation === 'EQUAL').length;
        const overlap = vis.filter((r) => r.relation === 'OVERLAP').length;
        const touch = vis.filter((r) => r.relation === 'TOUCH').length;
        checks = checks.map((c) => {
          if (c.code === 'GEOMETRIC_EQUALITY' && (c.outcome === 'REVIEW' || c.outcome === 'PASS')) return equal ? chk(c.code, 'REVIEW', 'EQUAL_GEOMETRY_FOUND', { count: equal }) : chk(c.code, 'PASS', 'NO_MATCHES');
          if (c.code === 'OVERLAP' && (c.outcome === 'REVIEW' || c.outcome === 'PASS')) return overlap ? chk(c.code, 'REVIEW', 'OVERLAP_FOUND', { count: overlap, touch_only: touch }) : chk(c.code, 'PASS', touch ? 'TOUCH_ONLY' : 'NO_MATCHES', { touch_only: touch });
          return c;
        });
        status = this.statusOf(checks);
      }
    } else {
      checks = checks.map((c) => (c.code === 'GEOMETRIC_EQUALITY' || c.code === 'OVERLAP') && c.outcome !== 'NOT_APPLICABLE' && c.outcome !== 'NOT_EXECUTED'
        ? { code: c.code, category: 'TECHNICAL', outcome: 'RESTRICTED' as Outcome, reason_code: 'COMPARISON_RESTRICTED', message: MESSAGES.COMPARISON_RESTRICTED }
        : c);
      status = this.statusOf(checks);
    }
    const viewScope = full ? 'FULL' : comparisonsVisible ? 'ASSIGNED_SCOPE' : 'GEOMETRY_ONLY';
    return {
      id: row.id, plot_id: row.plot_id, plot_version_id: row.plot_version_id, version_number: version.version_number,
      rule: { id: row.rule_id, version: row.rule_version }, parameters: row.parameters, evaluated_at: row.evaluated_at,
      comparison_scope: scope,
      status, status_scope: 'TECHNICAL', view_scope: viewScope,
      status_note: viewScope === 'FULL'
        ? 'Estado técnico de la geometría bajo esta regla; no es conformidad EUDR ni aprobación regulatoria.'
        : viewScope === 'ASSIGNED_SCOPE'
          ? 'Estado técnico calculado con las parcelas de tu alcance; no es conformidad EUDR ni aprobación regulatoria.'
          : 'Estado técnico de la propia geometría; la comparación con otras parcelas está reservada. No es conformidad EUDR ni aprobación regulatoria.',
      next_action: ACTIONS[status === 'VALID' ? 'VALID' : status === 'INVALID' ? 'INVALID' : status === 'WARNING' ? 'WARNING' : checks[0]?.reason_code === 'GEOMETRY_MISSING' ? 'GEOMETRY_MISSING' : 'REVIEW'],
      checks, capture_quality: row.capture_quality, destination_profile: row.destination_profile,
      relations,
      error_location: loc, error_location_visible: geometry && !!row.error_location,
      stale: stale.length > 0, stale_reasons: stale,
      limits: GIS_RULE.not_in_scope,
    };
  }

  private statusOf(checks: Check[]): EvalRow['status'] {
    if (checks[0]?.reason_code === 'GEOMETRY_MISSING') return 'REVIEW_REQUIRED';
    const o = checks.map((c) => c.outcome);
    return o.includes('FAIL') ? 'INVALID' : o.includes('REVIEW') ? 'REVIEW_REQUIRED' : o.includes('WARNING') ? 'WARNING' : 'VALID';
  }

  async list(user: AuthUser, orgId: string, plotId: string) {
    const ctx = await this.readCtx(user, orgId);
    await this.plots.load(this.db, ctx, plotId, 'read');
    const rows = await this.db.selectFrom('gis_evaluations').selectAll().where('organization_id', '=', orgId).where('plot_id', '=', plotId).orderBy('evaluated_at', 'desc').limit(20).execute();
    const out = [];
    for (const r of rows) out.push(await this.view(this.db, ctx, r));
    return out;
  }

  async get(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.readCtx(user, orgId);
    const row = await this.db.selectFrom('gis_evaluations').selectAll().where('organization_id', '=', orgId).where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound();
    await this.plots.load(this.db, ctx, row.plot_id, 'read');
    return this.view(this.db, ctx, row);
  }

  async rule(user: AuthUser, orgId: string) {
    await this.readCtx(user, orgId);
    return {
      ...GIS_RULE,
      statuses: {
        VALID: 'Todas las comprobaciones técnicas ejecutadas son correctas.',
        WARNING: 'Sin fallos, pero alguna comprobación quedó incompleta (p. ej. parcelas no comparables).',
        INVALID: 'Al menos una comprobación técnica falla.',
        REVIEW_REQUIRED: 'Falta la geometría o hay igualdad/solapamiento con otra parcela: requiere revisión humana.',
      },
      permissions: { evaluate: ['plot:evaluate_gis', 'plot:evaluate_gis_assigned (parcelas asignadas)'], read: ['plot:read', 'plot:read_assigned'], error_location: ['plot:read_geometry'] },
    };
  }
}

@ApiTags('plots')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class GisEvaluationController {
  constructor(private readonly service: GisEvaluationService) {}

  @Get('gis-rules/current')
  rule(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.rule(user, orgId);
  }

  @Post('plots/:plotId/gis-evaluations')
  async evaluate(
    @CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('plotId', ParseUUIDPipe) plotId: string,
    @Body() dto: EvaluateDto, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.service.evaluate(user, orgId, plotId, dto, req.requestId);
    if (r.replayed) res.status(200);
    return r;
  }

  @Get('plots/:plotId/gis-evaluations')
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('plotId', ParseUUIDPipe) plotId: string) {
    return this.service.list(user, orgId, plotId);
  }

  @Get('gis-evaluations/:evaluationId')
  get(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('evaluationId', ParseUUIDPipe) evaluationId: string) {
    return this.service.get(user, orgId, evaluationId);
  }
}
