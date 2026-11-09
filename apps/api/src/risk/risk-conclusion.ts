import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min, ValidateNested } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { perfilDeOrganizacion } from '../legal/legal-profile';
import { RiskService } from './risk';

// D-07.6 — CONCLUSIÓN HUMANA del responsable EUDR sobre una evaluación de riesgo concreta.
//
// QUIÉN: el rol `EUDR_MANAGER` (identificador canónico vigente) con el permiso específico `risk:conclude`; ningún otro rol lo recibe y no se crea otro rol.
// EL MOTOR NO CONCLUYE: `risk_evaluations.conclusion` sigue `UNDETERMINED` por su CHECK. La conclusión humana es un registro APARTE, append-only, con motivo, responsable,
// evidencias y las VERSIONES EXACTAS que la sustentan (evaluación y hash de su instantánea, catálogo y perfil jurídico referenciado con su revisión, instantánea del expediente).
// QUÉ NO HACE: no anula requisitos pendientes, no habilita READY ni despacho por sí sola, no inventa umbrales y no cambia permisos de otros roles. Una conclusión posterior no
// borra la anterior: la vigente es la última y cada una conserva su vínculo. La VIGENCIA se calcula al leer: una conclusión deja de valer si la evaluación queda desactualizada
// o, en la favorable, si se pierde alguna de las condiciones que la hicieron posible.
//
// CONDICIONES (D-07.6, opción B, acumulativas), todas con datos y mecanismos que YA existen:
//   común      · evaluación VIGENTE y la última del lote · quien registra NO es quien evaluó · motivo escrito y al menos una evidencia
//   favorable  · CADA carencia de la evaluación (regla no evaluable o categoría sin ninguna regla) resuelta por separado, con justificación propia y una evidencia concreta (ver abajo)
//              · catálogo ADOPTADO por la organización · catálogo con `regulatory_profile` que resuelve contra el perfil jurídico ADOPTADO, COMPLETO y con revisión VIGENTE (b-1)
//              · sin hallazgos BLOQUEANTES (la precedencia técnica existente: un bloqueante no se diluye) y, si hay hallazgos que requieren revisión, con la revisión humana RESUELTA.
//   CARENCIAS: el Reglamento (UE) 2023/1115 define el riesgo insignificante sobre una evaluación COMPLETA de la información (art. 2(26)) y obliga a verificar y analizar la información
//   reunida con los criterios del art. 10(2); docs/13 deja lo no mirado en NOT_ASSESSED con revisión requerida. Por eso mostrar una limitación NO la resuelve: una conclusión favorable exige
//   una resolución EXPLÍCITA por cada carencia —NOT_APPLICABLE (con justificación y una evidencia) o ASSESSED_BY_HUMAN (con justificación y una VERSIÓN DE DOCUMENTO del sistema)—,
//   cada una con su propia justificación y su evidencia referenciada. Una sola evidencia adjunta no resuelve las demás. Sin eso la favorable se rechaza y se dice qué falta.
//   no favorable (NON_NEGLIGIBLE) · solo las comunes: es la lectura conservadora y no habilita nada.

type Db = Kysely<Database>;
export const RESULTADOS = ['NEGLIGIBLE', 'NON_NEGLIGIBLE'] as const;
export type Resultado = (typeof RESULTADOS)[number];

class SupportDto {
  @ApiProperty({ enum: ['DOCUMENT_VERSION', 'CITATION'] }) @IsIn(['DOCUMENT_VERSION', 'CITATION']) kind!: 'DOCUMENT_VERSION' | 'CITATION';
  @ApiPropertyOptional({ description: 'Versión de un documento de ESTA organización' }) @IsOptional() @IsUUID() document_version_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 500) citation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^https:\/\/\S+$/) url?: string;
}
class GapResolutionDto {
  @ApiProperty({ enum: ['FACTOR', 'CATEGORY'], description: 'FACTOR = regla no evaluable; CATEGORY = categoría sin ninguna regla en el catálogo' }) @IsIn(['FACTOR', 'CATEGORY']) scope!: 'FACTOR' | 'CATEGORY';
  @ApiProperty() @IsString() @Length(1, 100) code!: string;
  @ApiProperty({ enum: ['NOT_APPLICABLE', 'ASSESSED_BY_HUMAN'], description: 'ASSESSED_BY_HUMAN exige una versión de documento del sistema como evidencia' }) @IsIn(['NOT_APPLICABLE', 'ASSESSED_BY_HUMAN']) kind!: 'NOT_APPLICABLE' | 'ASSESSED_BY_HUMAN';
  @ApiProperty({ description: 'Justificación PROPIA de esta carencia (no se repite entre carencias)' }) @IsString() @Length(30, 1000) justification!: string;
  @ApiProperty({ description: 'Posición (desde 0) en `supports` de la evidencia concreta que sustenta ESTA resolución' }) @IsInt() @Min(0) support_index!: number;
}
class RecordConclusionDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ enum: RESULTADOS }) @IsIn(RESULTADOS as unknown as string[]) result!: Resultado;
  @ApiProperty({ description: 'Motivo escrito de la conclusión' }) @IsString() @Length(10, 2000) reason!: string;
  @ApiProperty({ type: [SupportDto], description: 'Evidencias: al menos una' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SupportDto) supports!: SupportDto[];
  @ApiPropertyOptional({ type: [GapResolutionDto], description: 'Obligatorio y completo en NEGLIGIBLE: una resolución por cada carencia de la evaluación; no se admite en NON_NEGLIGIBLE' })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => GapResolutionDto) gap_resolutions?: GapResolutionDto[];
  @ApiPropertyOptional({ nullable: true, description: 'Conclusión que quien registra veía como vigente (null si ninguna). Si ya no lo es, se rechaza: no se pisa a ciegas' }) @IsOptional() @IsUUID() expected_current_conclusion_id?: string | null;
}

export interface VistaEvaluacion {
  id: string; evaluation_number: number; is_latest: boolean; freshness: { status: string };
  rules: { version: string; regulatory_profile: string | null; adopted_by_organization: boolean };
  technical_result: { status: string };
  review: { process_status: string };
}
type PerfilOrg = Awaited<ReturnType<typeof perfilDeOrganizacion>>;

/** Condiciones de una conclusión FAVORABLE sobre el catálogo y el resultado. Códigos, no textos: la interfaz los traduce. */
export function brechasFavorable(v: VistaEvaluacion, lp: PerfilOrg): string[] {
  const out: string[] = [];
  if (!v.rules.adopted_by_organization) out.push('RULE_SET_NOT_ADOPTED');
  const ref = v.rules.regulatory_profile;
  if (!ref) out.push('PROFILE_REFERENCE_MISSING');
  else if (!/^\d+\.\d+\.\d+$/.test(ref)) out.push('PROFILE_REFERENCE_INVALID');
  else if (!lp) out.push('PROFILE_NOT_ADOPTED');
  else if (lp.version !== ref) out.push('PROFILE_VERSION_MISMATCH');
  else {
    if (lp.scope !== 'COMPLETE') out.push('PROFILE_SCOPE_PARTIAL');
    if (lp.legal_review_status !== 'REVIEWED') out.push('PROFILE_REVIEW_NOT_CURRENT');
  }
  if (v.technical_result.status === 'BLOCKED') out.push('HAS_BLOCKING_FINDINGS');
  if (v.technical_result.status === 'REVIEW_REQUIRED' && v.review.process_status !== 'RESOLVED') out.push('FINDINGS_REVIEW_NOT_RESOLVED');
  return out;
}

interface FilaConclusion {
  id: string; evaluation_id: string; evaluation_number: number; evaluation_snapshot_hash: string; rule_set_version: string; regulatory_profile: string | null;
  legal_profile_version: string | null; legal_review_id: string | null; dd_snapshot_id: string | null; dd_snapshot_number: number | null; dd_content_hash: string | null;
  result: Resultado; reason: string; recorded_at: Date; supersedes_id: string | null; first_name: string | null; last_name: string | null;
}

/**
 * Conclusión EFECTIVA de una evaluación: la última registrada, si SIGUE vigente. Sin conclusión vigente es UNDETERMINED. Solo lee. La usa el expediente.
 * Una conclusión no vigente se conserva y se explica (`invalid_reasons`), pero no vale como conclusión.
 */
export async function conclusionEfectiva(db: Db, orgId: string, v: VistaEvaluacion) {
  const row = (await sql<FilaConclusion>`
    SELECT c.id, c.evaluation_id, c.evaluation_number, c.evaluation_snapshot_hash, c.rule_set_version, c.regulatory_profile, c.legal_profile_version, c.legal_review_id,
           c.dd_snapshot_id, c.dd_snapshot_number, c.dd_content_hash, c.result, c.reason, c.recorded_at, c.supersedes_id, u.first_name, u.last_name
    FROM risk_conclusions c JOIN users u ON u.id = c.recorded_by
    WHERE c.organization_id = ${orgId} AND c.evaluation_id = ${v.id} ORDER BY c.recorded_at DESC, c.id DESC LIMIT 1`.execute(db)).rows[0] ?? null;
  if (!row) return { record: null, effective: 'UNDETERMINED' as const, valid: false, invalid_reasons: [] as string[] };
  const reasons: string[] = [];
  if (v.freshness.status === 'STALE') reasons.push('EVALUATION_STALE');
  if (row.result === 'NEGLIGIBLE') {
    const lp = await perfilDeOrganizacion(db, orgId);
    for (const b of brechasFavorable(v, lp)) reasons.push(`LOST_${b}`);
    // La revisión del perfil en que se apoyó debe seguir siendo favorable (una revisión posterior objetada o retirada la invalida; una favorable posterior la conserva).
    if (row.legal_profile_version) {
      const ultima = (await sql<{ id: string; decision: string }>`SELECT id, decision FROM legal_profile_reviews WHERE version = ${row.legal_profile_version} ORDER BY decided_at DESC, id DESC LIMIT 1`.execute(db)).rows[0];
      if (!ultima || ultima.decision !== 'REVIEWED') reasons.push('LOST_PROFILE_REVIEW_NOT_CURRENT');
    }
  }
  const unicas = [...new Set(reasons)];
  return { record: row, effective: unicas.length ? ('UNDETERMINED' as const) : row.result, valid: unicas.length === 0, invalid_reasons: unicas };
}

@Injectable()
export class RiskConclusionService {
  constructor(@Inject(DB) private readonly db: Db, private readonly authz: AuthorizationService, private readonly audit: AuditService, private readonly risk: RiskService) {}

  private async ctx(user: AuthUser, orgId: string, perm: Permission, mutation: boolean): Promise<TenantContext> {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!ctx.permissions.includes(perm)) throw forbidden();
    // Mismo alcance que las evaluaciones: usan datos de toda la organización.
    const need: Permission[] = ['delivery:read', 'lot:read', 'plot:read', 'producer:read', 'document:read'];
    if (!need.every((p) => ctx.permissions.includes(p))) throw forbidden('PERMISSION_DENIED', 'Las conclusiones de riesgo usan datos de toda la organización: requieren alcance de organización completo.');
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }

  private async cargar(db: Db, ctx: TenantContext, evaluationId: string) {
    const meta = (await sql<{ evaluated_by: string; subject_id: string; snapshot_hash: string; evaluation_number: number; rule_set_version: string }>`
      SELECT evaluated_by::text, subject_id::text, snapshot_hash, evaluation_number, rule_set_version FROM risk_evaluations WHERE organization_id = ${ctx.organizationId} AND id = ${evaluationId}`.execute(db)).rows[0];
    if (!meta) throw notFound();
    const view = await this.risk.view(db, ctx, evaluationId);
    return { meta, view };
  }

  private opciones(view: VistaEvaluacion, lp: PerfilOrg, esEvaluador: boolean, carencias: Array<{ scope: string; code: string }>) {
    const comunes = [
      ...(view.freshness.status === 'STALE' ? ['EVALUATION_STALE'] : []),
      ...(!view.is_latest ? ['EVALUATION_SUPERSEDED'] : []),
      ...(esEvaluador ? ['RECORDER_IS_EVALUATOR'] : []),
    ];
    const fav = [...comunes, ...brechasFavorable(view, lp)];
    // `allowed` = no hay un impedimento DURO. Las carencias no se cuentan como impedimento duro pero SÍ son obligatorias: la favorable se registra solo con una resolución explícita por cada una.
    return { NEGLIGIBLE: { allowed: fav.length === 0, missing: fav, gaps_to_resolve: carencias }, NON_NEGLIGIBLE: { allowed: comunes.length === 0, missing: comunes, gaps_to_resolve: [] as Array<{ scope: string; code: string }> } };
  }

  /** Carencias de la evaluación: reglas no evaluables y categorías sin ninguna regla. Misma fuente que la base (`risk_evaluation_gaps`). */
  private async carencias(db: Db, evaluationId: string) {
    return (await sql<{ scope: string; code: string }>`SELECT scope, code FROM risk_evaluation_gaps(${evaluationId}::uuid) ORDER BY scope, code`.execute(db)).rows;
  }

  /** La evaluación, sus limitaciones, qué permite cada resultado y qué falta, la conclusión vigente y el historial. */
  async context(user: AuthUser, orgId: string, evaluationId: string) {
    const ctx = await this.ctx(user, orgId, 'risk:read', false);
    const { meta, view } = await this.cargar(this.db, ctx, evaluationId);
    const lp = await perfilDeOrganizacion(this.db, orgId);
    const v = view as unknown as VistaEvaluacion & { risk_result: { severity: string; severity_coverage: { categories_without_rules?: string[]; not_evaluable_codes?: string[]; not_evaluable?: number; hits?: number; complete?: boolean } }; subject: { id: string; code: string }; evaluated_at: string; evaluated_by: string; snapshot: { hash: string } };
    const cov = v.risk_result.severity_coverage ?? {};
    const limitaciones = [
      'ENGINE_NEVER_CONCLUDES', 'SEVERITY_IS_NOT_CONCLUSION',
      ...(cov.categories_without_rules?.length ? ['CATEGORIES_WITHOUT_RULES'] : []),
      ...((cov.not_evaluable ?? 0) > 0 || cov.not_evaluable_codes?.length ? ['RULES_NOT_EVALUABLE'] : []),
      ...((cov.hits ?? 0) > 0 ? ['HAS_FINDINGS'] : []),
      ...(v.review.process_status !== 'RESOLVED' ? ['REVIEW_NOT_RESOLVED'] : []),
    ];
    const ef = await conclusionEfectiva(this.db, orgId, v);
    const rows = (await sql<FilaConclusion & { recorded_by_name: string }>`
      SELECT c.id, c.evaluation_id, c.evaluation_number, c.evaluation_snapshot_hash, c.rule_set_version, c.regulatory_profile, c.legal_profile_version, c.legal_review_id, c.dd_snapshot_id,
             c.dd_snapshot_number, c.dd_content_hash, c.result, c.reason, c.recorded_at, c.supersedes_id, u.first_name, u.last_name
      FROM risk_conclusions c JOIN users u ON u.id = c.recorded_by WHERE c.organization_id = ${orgId} AND c.subject_id = ${meta.subject_id} ORDER BY c.recorded_at DESC, c.id DESC`.execute(this.db)).rows;
    // El historial es el del LOTE (todas sus evaluaciones): una conclusión sobre una evaluación anterior se conserva y se lee. La VIGENTE es solo la última de ESTA evaluación.
    const vigenteId = rows.find((r) => r.evaluation_id === evaluationId)?.id ?? null;
    const supports = rows.length ? (await sql<{ conclusion_id: string; kind: string; document_version_id: string | null; citation: string | null; url: string | null }>`
      SELECT conclusion_id, kind, document_version_id, citation, url FROM risk_conclusion_supports WHERE organization_id = ${orgId} AND conclusion_id = ANY(${rows.map((r) => r.id)}::uuid[]) ORDER BY id`.execute(this.db)).rows : [];
    const resoluciones = rows.length ? (await sql<{ conclusion_id: string; scope: string; code: string; kind: string; justification: string; s_kind: string; s_document_version_id: string | null; s_citation: string | null }>`
      SELECT r.conclusion_id, r.scope, r.code, r.kind, r.justification, s.kind AS s_kind, s.document_version_id AS s_document_version_id, s.citation AS s_citation
      FROM risk_conclusion_gap_resolutions r JOIN risk_conclusion_supports s ON s.organization_id = r.organization_id AND s.id = r.support_id
      WHERE r.organization_id = ${orgId} AND r.conclusion_id = ANY(${rows.map((r) => r.id)}::uuid[]) ORDER BY r.scope, r.code`.execute(this.db)).rows : [];
    const esEvaluador = meta.evaluated_by === user.id;
    const carencias = await this.carencias(this.db, evaluationId);
    return {
      evaluation: { id: v.id, number: v.evaluation_number, lot: v.subject, is_latest: v.is_latest, evaluated_at: v.evaluated_at, evaluated_by: v.evaluated_by, freshness: v.freshness,
        technical_result: v.technical_result, severity: v.risk_result.severity, severity_coverage: cov, review_process: v.review.process_status,
        rules: { version: v.rules.version, adopted: v.rules.adopted_by_organization, regulatory_profile: v.rules.regulatory_profile }, snapshot_hash: meta.snapshot_hash },
      limitations: limitaciones,
      options: this.opciones(v, lp, esEvaluador, carencias),
      can_record: ctx.permissions.includes('risk:conclude'), recorder_is_evaluator: esEvaluador,
      current: ef.record ? { id: ef.record.id, result: ef.record.result, effective: ef.effective, valid: ef.valid, invalid_reasons: ef.invalid_reasons } : null,
      history: rows.map((r) => ({
        id: r.id, result: r.result, reason: r.reason, recorded_at: r.recorded_at, recorded_by: [r.first_name, r.last_name].filter(Boolean).join(' ') || null, is_latest_record: r.id === vigenteId,
        on_this_evaluation: r.evaluation_id === evaluationId,
        valid_now: r.id === vigenteId ? ef.valid : false, invalid_reasons: r.id === vigenteId ? ef.invalid_reasons : [], supersedes_id: r.supersedes_id,
        links: { evaluation_number: r.evaluation_number, evaluation_snapshot_hash: r.evaluation_snapshot_hash, rule_set_version: r.rule_set_version, regulatory_profile: r.regulatory_profile,
          legal_profile_version: r.legal_profile_version, legal_review_id: r.legal_review_id, dd_snapshot_number: r.dd_snapshot_number, dd_content_hash: r.dd_content_hash },
        supports: supports.filter((s) => s.conclusion_id === r.id).map(({ conclusion_id: _c, ...s }) => s),
        gap_resolutions: resoluciones.filter((x) => x.conclusion_id === r.id).map((x) => ({ scope: x.scope, code: x.code, kind: x.kind, justification: x.justification, evidence: { kind: x.s_kind, document_version_id: x.s_document_version_id, citation: x.s_citation } })),
      })),
      note: 'La conclusión es de una PERSONA autorizada: el motor no concluye. Registrarla no anula requisitos pendientes ni habilita READY ni despacho por sí sola; una conclusión posterior no borra la anterior.',
    };
  }

  async record(user: AuthUser, orgId: string, evaluationId: string, dto: RecordConclusionDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'risk:conclude', true);
    const prior = (await sql<{ id: string; evaluation_id: string; result: string }>`SELECT id, evaluation_id, result FROM risk_conclusions WHERE organization_id = ${orgId} AND operation_id = ${dto.operation_id}`.execute(this.db)).rows[0];
    if (prior) {
      if (prior.evaluation_id !== evaluationId || prior.result !== dto.result) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, conclusion: { id: prior.id, result: prior.result }, context: await this.context(user, orgId, evaluationId) };
    }
    for (const [i, s] of dto.supports.entries()) {
      const ok = s.kind === 'DOCUMENT_VERSION' ? !!s.document_version_id && !s.citation : !!s.citation && !s.document_version_id;
      if (!ok) throw new AppError(422, 'CONCLUSION_SUPPORT_INVALID', 'Cada evidencia es una versión de documento de esta organización o una cita; no ambas.', [{ field: `supports[${i}]`, reason: 'INVALID' }]);
      if (s.kind === 'DOCUMENT_VERSION') {
        const d = (await sql`SELECT 1 FROM document_versions WHERE organization_id = ${orgId} AND id = ${s.document_version_id!}`.execute(this.db)).rows[0];
        if (!d) throw new AppError(422, 'REFERENCE_NOT_FOUND', 'La versión de documento no existe en esta organización.', [{ field: `supports[${i}].document_version_id`, reason: 'NOT_FOUND' }]);
      }
    }
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'risk-conclusion:' + evaluationId}))`.execute(trx);
      const { meta, view } = await this.cargar(trx as unknown as Db, ctx, evaluationId);
      const v = view as unknown as VistaEvaluacion;
      const lp = await perfilDeOrganizacion(trx as unknown as Db, orgId);
      const carencias = await this.carencias(trx as unknown as Db, evaluationId);
      const op = this.opciones(v, lp, meta.evaluated_by === user.id, carencias)[dto.result];
      if (!op.allowed) {
        throw new AppError(422, 'CONCLUSION_PRECONDITIONS_NOT_MET', 'Faltan condiciones para registrar esta conclusión: no se registra y el estado se conserva.', op.missing.map((m) => ({ field: 'result', reason: m })));
      }
      const resoluciones = dto.gap_resolutions ?? [];
      const invalida = (reason: string, field = 'gap_resolutions') => new AppError(422, 'CONCLUSION_GAP_RESOLUTION_INVALID', 'Las resoluciones de carencias no son válidas: la conclusión no se registra y el estado se conserva.', [{ field, reason }]);
      if (dto.result === 'NON_NEGLIGIBLE' && resoluciones.length) throw invalida('NOT_APPLICABLE_TO_RESULT');
      if (dto.result === 'NEGLIGIBLE') {
        const clave = (x: { scope: string; code: string }) => `${x.scope}:${x.code}`;
        const dadas = new Map(resoluciones.map((r) => [clave(r), r]));
        if (dadas.size !== resoluciones.length) throw invalida('DUPLICATE_GAP');
        if (resoluciones.some((r) => !carencias.some((c) => clave(c) === clave(r)))) throw invalida('UNKNOWN_GAP');
        const faltan = carencias.filter((c) => !dadas.has(clave(c)));
        if (faltan.length) {
          // Una limitación mostrada no está resuelta: cada carencia exige su propia resolución, con justificación y evidencia concreta.
          throw new AppError(422, 'CONCLUSION_GAPS_UNRESOLVED', 'Una conclusión favorable exige resolver cada carencia de la evaluación: faltan resoluciones y la conclusión no se registra.', faltan.map((c) => ({ field: 'gap_resolutions', reason: `UNRESOLVED:${c.scope}:${c.code}` })));
        }
        const vistas = new Set<string>();
        for (const r of resoluciones) {
          const ev = dto.supports[r.support_index];
          if (!ev) throw invalida(`SUPPORT_INDEX:${clave(r)}`);
          if (r.kind === 'ASSESSED_BY_HUMAN' && ev.kind !== 'DOCUMENT_VERSION') throw invalida(`DOCUMENT_REQUIRED:${clave(r)}`);
          const j = r.justification.trim().toLowerCase();
          if (vistas.has(j)) throw invalida(`DUPLICATE_JUSTIFICATION:${clave(r)}`);
          vistas.add(j);
        }
      }
      const actual = (await sql<{ id: string }>`SELECT id FROM risk_conclusions WHERE organization_id = ${orgId} AND evaluation_id = ${evaluationId} ORDER BY recorded_at DESC, id DESC LIMIT 1`.execute(trx)).rows[0] ?? null;
      if (dto.expected_current_conclusion_id !== undefined && (actual?.id ?? null) !== dto.expected_current_conclusion_id) {
        throw conflict('CONCLUSION_SUPERSEDED', 'La conclusión vigente de esta evaluación cambió mientras la preparabas: revisa el historial y vuelve a registrar.');
      }
      const reviewId = dto.result === 'NEGLIGIBLE' ? (await sql<{ id: string }>`SELECT id FROM legal_profile_reviews WHERE version = ${v.rules.regulatory_profile!} ORDER BY decided_at DESC, id DESC LIMIT 1`.execute(trx)).rows[0]?.id ?? null : null;
      const dd = (await sql<{ id: string; snapshot_number: number; content_hash: string }>`
        SELECT s.id, s.snapshot_number, s.content_hash FROM dd_snapshots s JOIN dd_cases c ON c.id = s.case_id AND c.organization_id = s.organization_id
        WHERE c.organization_id = ${orgId} AND c.subject_id = ${meta.subject_id} ORDER BY s.snapshot_number DESC LIMIT 1`.execute(trx)).rows[0] ?? null;
      await sql`
        INSERT INTO risk_conclusions (id, organization_id, evaluation_id, subject_id, evaluation_number, evaluation_snapshot_hash, rule_set_version, regulatory_profile, legal_profile_version, legal_review_id,
                                      dd_snapshot_id, dd_snapshot_number, dd_content_hash, result, reason, recorded_by, operation_id, supersedes_id)
        VALUES (${id}, ${orgId}, ${evaluationId}, ${meta.subject_id}, ${meta.evaluation_number}, ${meta.snapshot_hash}, ${meta.rule_set_version}, ${dto.result === 'NEGLIGIBLE' ? v.rules.regulatory_profile : null},
                ${dto.result === 'NEGLIGIBLE' ? v.rules.regulatory_profile : null}, ${reviewId}, ${dd?.id ?? null}, ${dd?.snapshot_number ?? null}, ${dd?.content_hash ?? null}, ${dto.result}, ${dto.reason.trim()}, ${user.id}, ${dto.operation_id}, ${actual?.id ?? null})`.execute(trx);
      const soporteIds = dto.supports.map(() => randomUUID());
      for (const [i, s] of dto.supports.entries()) {
        await sql`INSERT INTO risk_conclusion_supports (id, organization_id, conclusion_id, kind, document_version_id, citation, url)
          VALUES (${soporteIds[i]}, ${orgId}, ${id}, ${s.kind}, ${s.kind === 'DOCUMENT_VERSION' ? s.document_version_id! : null}, ${s.kind === 'CITATION' ? s.citation!.trim() : null}, ${s.url ?? null})`.execute(trx);
      }
      for (const r of resoluciones) {
        await sql`INSERT INTO risk_conclusion_gap_resolutions (id, organization_id, conclusion_id, scope, code, kind, justification, support_id)
          VALUES (${randomUUID()}, ${orgId}, ${id}, ${r.scope}, ${r.code}, ${r.kind}, ${r.justification.trim()}, ${soporteIds[r.support_index]})`.execute(trx);
      }
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'risk.conclude', entityType: 'lot', entityId: meta.subject_id, requestId, result: 'SUCCESS', reason: dto.reason.trim(),
        after: { conclusion_id: id, evaluation_id: evaluationId, evaluation_number: meta.evaluation_number, result: dto.result, supports: dto.supports.length, gap_resolutions: resoluciones.length, supersedes: actual?.id ?? null } });
    });
    return { replayed: false, conclusion: { id, result: dto.result }, context: await this.context(user, orgId, evaluationId) };
  }
}

@ApiTags('risk')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class RiskConclusionController {
  constructor(private readonly service: RiskConclusionService) {}

  @Get('risk/evaluations/:id/conclusions') context(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.context(u, o, id); }
  @Post('risk/evaluations/:id/conclusions') record(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordConclusionDto, @Req() req: AuthedRequest) { return this.service.record(u, o, id, dto, req.requestId); }
}
