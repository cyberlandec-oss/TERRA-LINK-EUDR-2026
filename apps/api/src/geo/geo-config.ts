import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateNested } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, forbidden } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { GEO_PROFILE } from '../plots/geo-profile';
import type { GeoConfigContent } from '../dd/requirements';

// GEOLOCATION_PROFILE (requisito original, D-05.B Q4) — CONFIGURACIÓN VERSIONADA de reglas y su aplicación.
//
// OBJETOS Y QUIÉN HACE QUÉ (todo distinto y ninguno implica a otro):
//   · PREPARAR una versión (plataforma, `geo_config:manage`): reglas explícitas con fuentes. Una regla es ACTIVE (el sistema sabe evaluarla con datos
//     propios) o CANDIDATE (interpretación pendiente: no se aplica, no se inventan umbrales). Inmutable: corregir = versión nueva.
//   · REVISAR esa versión (plataforma, `geo_config:manage`): registra quién revisó ESTE objeto y versión, con fundamento, soporte y el ALCANCE DE
//     APLICABILIDAD que declara (organizaciones y nota de operación). No es la revisión del perfil jurídico y no se convierte en ella.
//   · ADOPTAR (cada organización, `risk:approve_rules`): decide usar esa versión. Adoptar no la revisa ni la declara aplicable.
//   · APLICAR (el expediente): el requisito lee la configuración adoptada, su revisión vigente, su aplicabilidad y las evaluaciones vigentes del perfil
//     técnico EUDR_GEO_V1. No existe un evaluador paralelo: se reutilizan `geo_profile_evaluations`.
// Nada de esto concluye riesgo ni concede permisos para concluir, y ninguna configuración «aplica a todas» por defecto.

type Db = Kysely<Database>;
type Status = 'MEETS_PROFILE' | 'DOES_NOT_MEET' | 'REVIEW_REQUIRED' | 'NOT_EVALUABLE';
const KINDS = ['GEO_TECH_PROFILE', 'PRODUCTION_PERIOD', 'PRODUCTION_COUNTRY'] as const;

class SourceDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z][A-Z0-9_-]{2,59}$/) code!: string;
  @ApiProperty() @IsString() @Length(3, 300) title!: string;
  @ApiProperty({ description: 'Cita (artículo y apartado)' }) @IsString() @Length(3, 500) citation!: string;
  @ApiProperty() @IsString() @Matches(/^https:\/\/\S+$/) url!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[0-9a-f]{64}$/) file_sha256?: string;
}
class RuleDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z][A-Z0-9_-]{2,59}$/) code!: string;
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS as unknown as string[]) kind!: (typeof KINDS)[number];
  @ApiProperty({ enum: ['ACTIVE', 'CANDIDATE'], description: 'Solo GEO_TECH_PROFILE puede ser ACTIVE: período y país no están vinculados por parcela' }) @IsIn(['ACTIVE', 'CANDIDATE']) status!: 'ACTIVE' | 'CANDIDATE';
  @ApiProperty() @IsString() @Matches(/^[A-Z][A-Z0-9_-]{2,59}$/) source_code!: string;
  @ApiProperty() @IsString() @Length(3, 300) article!: string;
  @ApiProperty() @IsString() @Length(10, 1000) criterion!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 1000) proposed_interpretation?: string;
  @ApiPropertyOptional({ description: 'Obligatoria en una CANDIDATE: qué falta para poder aplicarla' }) @IsOptional() @IsString() @Length(10, 1000) pending_questions?: string;
}
class PrepareConfigDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsString() @Matches(/^[0-9]+\.[0-9]+\.[0-9]+$/) version!: string;
  @ApiProperty({ description: 'Versión del perfil técnico EUDR_GEO_V1 para la que se redacta; debe ser la vigente' }) @IsString() @Matches(/^[0-9]+\.[0-9]+\.[0-9]+$/) technical_profile_version!: string;
  @ApiProperty() @IsString() @Length(10, 2000) scope_note!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
  @ApiProperty({ type: [SourceDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SourceDto) sources!: SourceDto[];
  @ApiProperty({ type: [RuleDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => RuleDto) rules!: RuleDto[];
}
class SupportDto {
  @ApiProperty({ enum: ['CONFIG_SOURCE', 'CITATION'] }) @IsIn(['CONFIG_SOURCE', 'CITATION']) kind!: 'CONFIG_SOURCE' | 'CITATION';
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[A-Z][A-Z0-9_-]{2,59}$/) source_code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 500) citation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^https:\/\/\S+$/) url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[0-9a-f]{64}$/) file_sha256?: string;
}
class ReviewConfigDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsString() @Matches(/^[0-9]+\.[0-9]+\.[0-9]+$/) version!: string;
  @ApiProperty({ enum: ['REVIEWED', 'OBJECTED', 'WITHDRAWN'] }) @IsIn(['REVIEWED', 'OBJECTED', 'WITHDRAWN']) decision!: 'REVIEWED' | 'OBJECTED' | 'WITHDRAWN';
  @ApiProperty() @IsString() @Length(3, 200) reviewer_name!: string;
  @ApiProperty() @IsString() @Length(3, 300) reviewer_capacity!: string;
  @ApiProperty() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) reviewed_on!: string;
  @ApiProperty() @IsString() @Length(10, 2000) basis!: string;
  @ApiProperty({ type: [SupportDto] }) @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SupportDto) supports!: SupportDto[];
  @ApiProperty({ type: [String], description: 'ALCANCE DE APLICABILIDAD declarado: organizaciones a las que se declara aplicable. Vacío = revisada pero no aplicable a ninguna' })
  @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) applicable_organizations!: string[];
  @ApiProperty({ description: 'Operación y condiciones a las que se refiere la aplicabilidad declarada' }) @IsString() @Length(3, 1000) applicability_note!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() expected_current_review_id?: string | null;
}
class AdoptDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsString() @Matches(/^[0-9]+\.[0-9]+\.[0-9]+$/) version!: string;
  @ApiProperty({ enum: ['ADOPT', 'WITHDRAW'] }) @IsIn(['ADOPT', 'WITHDRAW']) decision!: 'ADOPT' | 'WITHDRAW';
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

const dia = (d: string | Date) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);
interface ReviewRow { id: string; version: string; decision: 'REVIEWED' | 'OBJECTED' | 'WITHDRAWN'; reviewer_name: string; reviewer_capacity: string; reviewed_on: string | Date; basis: string; applicable_organizations: string[]; applicability_note: string; decided_at: Date; first_name: string | null; last_name: string | null }
interface SupportRow { review_id: string; kind: string; source_code: string | null; citation: string | null; url: string | null; file_sha256: string | null }

/** Revisión VIGENTE (la última) de cada versión. */
async function ultimaRevision(db: Db, version?: string) {
  return (await sql<{ id: string; version: string; decision: ReviewRow['decision']; applicable_organizations: string[] }>`
    SELECT DISTINCT ON (version) id, version, decision, applicable_organizations FROM geo_requirement_config_reviews
    ${version ? sql`WHERE version = ${version}` : sql``} ORDER BY version, decided_at DESC, id DESC`.execute(db)).rows;
}

/** Configuración adoptada (vigente) por la organización, o null. */
export async function configAdoptada(db: Db, orgId: string): Promise<string | null> {
  const a = (await sql<{ version: string; decision: string }>`
    SELECT version, decision FROM geo_requirement_config_adoptions WHERE organization_id = ${orgId} ORDER BY decided_at DESC, id DESC LIMIT 1`.execute(db)).rows[0];
  return a && a.decision === 'ADOPT' ? a.version : null;
}

/**
 * Contenido de `profiles.geolocation_profile` del expediente: la configuración adoptada, SU revisión vigente, su aplicabilidad a ESTA organización y,
 * por parcela de origen, la evaluación VIGENTE del perfil técnico (misma versión geométrica y versión de perfil actual). Solo lee.
 */
export async function geoConfigContent(db: Db, orgId: string, plots: Array<{ plot_id: string; version_id: string | null }>): Promise<GeoConfigContent | null> {
  const version = await configAdoptada(db, orgId);
  if (!version) return null;
  const cfg = (await sql<{ technical_profile_id: string; technical_profile_version: string }>`SELECT technical_profile_id, technical_profile_version FROM geo_requirement_configs WHERE version = ${version}`.execute(db)).rows[0];
  if (!cfg) return null;
  const rules = (await sql<{ code: string; kind: string; status: 'ACTIVE' | 'CANDIDATE' }>`SELECT code, kind, status FROM geo_requirement_config_rules WHERE version = ${version} ORDER BY code`.execute(db)).rows;
  const rev = (await ultimaRevision(db, version))[0] ?? null;
  const ids = [...new Set(plots.map((p) => p.plot_id))];
  const evals = ids.length ? (await sql<{ id: string; plot_id: string; plot_version_id: string; profile_version: string; status: Status }>`
    SELECT DISTINCT ON (plot_id, plot_version_id) id, plot_id, plot_version_id, profile_version, status FROM geo_profile_evaluations
     WHERE organization_id = ${orgId} AND plot_id = ANY(${ids}::uuid[]) AND profile_id = ${GEO_PROFILE.id} AND profile_version = ${GEO_PROFILE.version}
     ORDER BY plot_id, plot_version_id, evaluated_at DESC, id DESC`.execute(db)).rows : [];
  const unicos = [...new Map(plots.map((p) => [p.plot_id, p])).values()].sort((a, b) => a.plot_id.localeCompare(b.plot_id));
  return {
    config_version: version,
    technical_profile: { id: cfg.technical_profile_id, version: cfg.technical_profile_version, current_version: GEO_PROFILE.version },
    review: { id: rev?.id ?? null, decision: rev?.decision ?? null },
    applicable_to_organization: !!rev && rev.decision === 'REVIEWED' && rev.applicable_organizations.includes(orgId),
    rules,
    plots: unicos.map((p) => {
      const e = p.version_id ? evals.find((x) => x.plot_id === p.plot_id && x.plot_version_id === p.version_id) : undefined;
      return { plot_id: p.plot_id, plot_version_id: p.version_id, evaluation_id: e?.id ?? null, evaluated_profile_version: e?.profile_version ?? null, status: e?.status ?? null };
    }),
  };
}

@Injectable()
export class GeoConfigService {
  constructor(@Inject(DB) private readonly db: Db, private readonly authz: AuthorizationService, private readonly audit: AuditService) {}

  private async catalogo(opts: { orgId?: string; platform: boolean }) {
    const configs = (await sql<{ version: string; technical_profile_id: string; technical_profile_version: string; scope_note: string; reason: string; origin: string; created_at: Date }>`
      SELECT version, technical_profile_id, technical_profile_version, scope_note, reason, origin, created_at FROM geo_requirement_configs ORDER BY created_at DESC, version DESC`.execute(this.db)).rows;
    const sources = (await sql<{ version: string; code: string; title: string; citation: string; url: string; file_sha256: string | null }>`SELECT version, code, title, citation, url, file_sha256 FROM geo_requirement_config_sources ORDER BY code`.execute(this.db)).rows;
    const rules = (await sql<{ version: string; code: string; kind: string; status: string; source_code: string; article: string; criterion: string; proposed_interpretation: string | null; pending_questions: string | null }>`SELECT version, code, kind, status, source_code, article, criterion, proposed_interpretation, pending_questions FROM geo_requirement_config_rules ORDER BY code`.execute(this.db)).rows;
    const reviews = (await sql<ReviewRow>`
      SELECT r.id, r.version, r.decision, r.reviewer_name, r.reviewer_capacity, r.reviewed_on, r.basis, r.applicable_organizations, r.applicability_note, r.decided_at, u.first_name, u.last_name
      FROM geo_requirement_config_reviews r JOIN users u ON u.id = r.recorded_by ORDER BY r.decided_at DESC, r.id DESC`.execute(this.db)).rows;
    const supports = (await sql<SupportRow>`SELECT review_id, kind, source_code, citation, url, file_sha256 FROM geo_requirement_config_review_supports ORDER BY id`.execute(this.db)).rows;
    const adoptada = opts.orgId ? await configAdoptada(this.db, opts.orgId) : null;
    return configs.map((c) => {
      const hist = reviews.filter((r) => r.version === c.version).map((r, i) => ({
        id: r.id, decision: r.decision, reviewer_name: r.reviewer_name, reviewer_capacity: r.reviewer_capacity, reviewed_on: dia(r.reviewed_on), recorded_at: r.decided_at,
        recorded_by: [r.first_name, r.last_name].filter(Boolean).join(' ') || null, basis: r.basis, applicability_note: r.applicability_note,
        // Aislamiento: una organización NO ve qué otras organizaciones declara aplicables la revisión; solo si la incluye a ella.
        ...(opts.platform ? { applicable_organizations: r.applicable_organizations } : { applies_to_this_organization: r.decision === 'REVIEWED' && !!opts.orgId && r.applicable_organizations.includes(opts.orgId) }),
        supports: supports.filter((s) => s.review_id === r.id).map(({ review_id: _r, ...s }) => s), is_current: i === 0,
      }));
      const cur = hist[0] ?? null;
      const technicalOk = c.technical_profile_version === GEO_PROFILE.version;
      const candidatas = rules.filter((x) => x.version === c.version && x.status === 'CANDIDATE').map((x) => x.code);
      const motivos = [
        ...(!technicalOk ? ['TECHNICAL_PROFILE_MISMATCH'] : []),
        ...(!cur ? ['NO_REVIEW'] : cur.decision !== 'REVIEWED' ? [`REVIEW_${cur.decision}`] : []),
        ...(cur?.decision === 'REVIEWED' && opts.orgId && !('applies_to_this_organization' in cur && cur.applies_to_this_organization) ? ['NOT_APPLICABLE_TO_ORGANIZATION'] : []),
        ...(candidatas.length ? ['CANDIDATE_RULES_PENDING'] : []),
      ];
      return {
        ...c, sources: sources.filter((s) => s.version === c.version).map(({ version: _v, ...s }) => s), rules: rules.filter((x) => x.version === c.version).map(({ version: _v, ...x }) => x),
        status: cur?.decision ?? 'NONE', current_review: cur, history: hist, candidate_rules: candidatas,
        adopted_by_this_organization: opts.orgId ? adoptada === c.version : undefined,
        // Qué falta para que esta versión permita evaluar el requisito (sin aprobar nada).
        gaps: motivos,
      };
    });
  }

  // ------------------------------------------------------------------ plataforma
  async listPlatform(user: AuthUser) {
    this.authz.requirePlatform(user, 'geo_config:manage');
    return { technical_profile: { id: GEO_PROFILE.id, version: GEO_PROFILE.version }, configs: await this.catalogo({ platform: true }), note: NOTE_PLATFORM };
  }

  async prepare(user: AuthUser, dto: PrepareConfigDto, requestId?: string) {
    this.authz.requirePlatform(user, 'geo_config:manage');
    const prior = (await sql<{ version: string }>`SELECT version FROM geo_requirement_configs WHERE operation_id = ${dto.operation_id}`.execute(this.db)).rows[0];
    if (prior) {
      if (prior.version !== dto.version) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, config: { version: prior.version } };
    }
    if ((await sql`SELECT 1 FROM geo_requirement_configs WHERE version = ${dto.version}`.execute(this.db)).rows[0]) {
      throw conflict('CONFIG_VERSION_EXISTS', 'Esa versión de la configuración ya existe: las versiones no se editan, se crea una nueva.');
    }
    if (dto.technical_profile_version !== GEO_PROFILE.version) {
      throw new AppError(422, 'TECHNICAL_PROFILE_MISMATCH', `La configuración debe redactarse para el perfil técnico vigente (${GEO_PROFILE.id} ${GEO_PROFILE.version}).`, [{ field: 'technical_profile_version', reason: 'NOT_CURRENT' }]);
    }
    const codigos = new Set(dto.sources.map((s) => s.code));
    if (codigos.size !== dto.sources.length || new Set(dto.rules.map((r) => r.code)).size !== dto.rules.length) {
      throw new AppError(422, 'CONFIG_DUPLICATE_CODE', 'Los códigos de fuentes y reglas no pueden repetirse.', [{ field: 'rules', reason: 'DUPLICATE' }]);
    }
    for (const [i, r] of dto.rules.entries()) {
      if (!codigos.has(r.source_code)) throw new AppError(422, 'CONFIG_RULE_SOURCE_UNKNOWN', 'Cada regla cita una fuente de esta misma versión.', [{ field: `rules[${i}].source_code`, reason: 'UNKNOWN' }]);
      if (r.status === 'ACTIVE' && r.kind !== 'GEO_TECH_PROFILE') {
        throw new AppError(422, 'CONFIG_RULE_NOT_APPLICABLE', 'Solo la regla GEO_TECH_PROFILE puede estar activa: el período y el país de producción no están vinculados por parcela y no se deducen.', [{ field: `rules[${i}].status`, reason: 'KIND_NOT_EVALUABLE' }]);
      }
      if (r.status === 'CANDIDATE' && !(r.pending_questions && r.pending_questions.trim().length >= 10)) {
        throw new AppError(422, 'CONFIG_CANDIDATE_QUESTIONS_REQUIRED', 'Una regla candidata declara qué falta para poder aplicarla.', [{ field: `rules[${i}].pending_questions`, reason: 'REQUIRED' }]);
      }
    }
    await this.db.transaction().execute(async (trx) => {
      await sql`INSERT INTO geo_requirement_configs (version, technical_profile_id, technical_profile_version, scope_note, reason, created_by, origin, operation_id)
        VALUES (${dto.version}, ${GEO_PROFILE.id}, ${dto.technical_profile_version}, ${dto.scope_note.trim()}, ${dto.reason.trim()}, ${user.id}, 'API', ${dto.operation_id})`.execute(trx);
      for (const s of dto.sources) {
        await sql`INSERT INTO geo_requirement_config_sources (version, code, title, citation, url, file_sha256) VALUES (${dto.version}, ${s.code}, ${s.title.trim()}, ${s.citation.trim()}, ${s.url}, ${s.file_sha256 ?? null})`.execute(trx);
      }
      for (const r of dto.rules) {
        await sql`INSERT INTO geo_requirement_config_rules (version, code, kind, status, source_code, article, criterion, proposed_interpretation, pending_questions)
          VALUES (${dto.version}, ${r.code}, ${r.kind}, ${r.status}, ${r.source_code}, ${r.article.trim()}, ${r.criterion.trim()}, ${r.proposed_interpretation?.trim() ?? null}, ${r.pending_questions?.trim() ?? null})`.execute(trx);
      }
      await this.audit.record(trx, { organizationId: null, actorUserId: user.id, action: 'geo_config.prepare', entityType: 'geo_requirement_config', entityId: null, requestId, result: 'SUCCESS',
        reason: dto.reason.trim(), after: { version: dto.version, rules: dto.rules.map((r) => `${r.code}:${r.status}`), sources: dto.sources.length } });
    });
    return { replayed: false, config: { version: dto.version }, note: 'Versión preparada, inmutable y SIN revisión: no se aplica a ningún expediente hasta que se revise, se declare aplicable y la organización la adopte.' };
  }

  async review(user: AuthUser, dto: ReviewConfigDto, requestId?: string) {
    this.authz.requirePlatform(user, 'geo_config:manage');
    const prior = (await sql<{ id: string; version: string; decision: string }>`SELECT id, version, decision FROM geo_requirement_config_reviews WHERE operation_id = ${dto.operation_id}`.execute(this.db)).rows[0];
    if (prior) {
      if (prior.version !== dto.version || prior.decision !== dto.decision) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, review: prior };
    }
    if (!(await sql`SELECT 1 FROM geo_requirement_configs WHERE version = ${dto.version}`.execute(this.db)).rows[0]) {
      throw new AppError(422, 'CONFIG_UNKNOWN', 'Esa versión de configuración no existe: una revisión se registra sobre una versión exacta.', [{ field: 'version', reason: 'UNKNOWN' }]);
    }
    if (Number.isNaN(Date.parse(dto.reviewed_on)) || dto.reviewed_on > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) {
      throw new AppError(422, 'REVIEW_DATE_INVALID', 'La fecha de la revisión no es válida o es futura.', [{ field: 'reviewed_on', reason: 'FUTURE_OR_INVALID' }]);
    }
    if (dto.decision === 'REVIEWED' && dto.supports.length === 0) {
      throw new AppError(422, 'REVIEW_SUPPORT_REQUIRED', 'Una revisión REVIEWED exige al menos un soporte: una fuente de la configuración o una cita.', [{ field: 'supports', reason: 'REQUIRED' }]);
    }
    const codigos = (await sql<{ code: string }>`SELECT code FROM geo_requirement_config_sources WHERE version = ${dto.version}`.execute(this.db)).rows.map((s) => s.code);
    for (const [i, s] of dto.supports.entries()) {
      const ok = s.kind === 'CONFIG_SOURCE' ? !!s.source_code && codigos.includes(s.source_code) && !s.citation : !!s.citation && !s.source_code;
      if (!ok) throw new AppError(422, 'REVIEW_SUPPORT_INVALID', 'Cada soporte es una fuente de ESTA versión de la configuración o una cita; no ambas, ni una fuente de otra versión.', [{ field: `supports[${i}]`, reason: 'INVALID' }]);
    }
    const orgs = [...new Set(dto.applicable_organizations)];
    if (orgs.length !== dto.applicable_organizations.length) throw new AppError(422, 'APPLICABILITY_INVALID', 'La lista de organizaciones tiene repetidas.', [{ field: 'applicable_organizations', reason: 'DUPLICATE' }]);
    if (orgs.length) {
      const n = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM organizations WHERE id = ANY(${orgs}::uuid[])`.execute(this.db)).rows[0].n;
      if (Number(n) !== orgs.length) throw new AppError(422, 'APPLICABILITY_INVALID', 'La aplicabilidad nombra una organización que no existe.', [{ field: 'applicable_organizations', reason: 'UNKNOWN_ORGANIZATION' }]);
    }
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'geo-config-review:' + dto.version}))`.execute(trx);
      const vigente = (await ultimaRevision(trx as unknown as Db, dto.version))[0] ?? null;
      if (dto.expected_current_review_id !== undefined && (vigente?.id ?? null) !== dto.expected_current_review_id) {
        throw conflict('REVIEW_SUPERSEDED', 'La revisión vigente de esta versión cambió mientras la preparabas: revisa el historial y vuelve a registrar.');
      }
      if (dto.decision === 'WITHDRAWN' && vigente?.decision !== 'REVIEWED') {
        throw new AppError(422, 'NOTHING_TO_WITHDRAW', 'Solo se retira una revisión vigente en estado REVIEWED.', [{ field: 'decision', reason: 'NO_CURRENT_REVIEWED' }]);
      }
      await sql`INSERT INTO geo_requirement_config_reviews (id, version, decision, reviewer_name, reviewer_capacity, reviewed_on, basis, applicable_organizations, applicability_note, recorded_by, operation_id)
        VALUES (${id}, ${dto.version}, ${dto.decision}, ${dto.reviewer_name.trim()}, ${dto.reviewer_capacity.trim()}, ${dto.reviewed_on}, ${dto.basis.trim()}, ${orgs}::uuid[], ${dto.applicability_note.trim()}, ${user.id}, ${dto.operation_id})`.execute(trx);
      for (const s of dto.supports) {
        await sql`INSERT INTO geo_requirement_config_review_supports (id, review_id, version, kind, source_code, citation, url, file_sha256)
          VALUES (${randomUUID()}, ${id}, ${dto.version}, ${s.kind}, ${s.kind === 'CONFIG_SOURCE' ? s.source_code! : null}, ${s.kind === 'CITATION' ? s.citation!.trim() : null}, ${s.url ?? null}, ${s.file_sha256 ?? null})`.execute(trx);
      }
      await this.audit.record(trx, { organizationId: null, actorUserId: user.id, action: `geo_config.review_${dto.decision.toLowerCase()}`, entityType: 'geo_requirement_config_review', entityId: id, requestId, result: 'SUCCESS',
        reason: dto.basis.trim(), after: { version: dto.version, decision: dto.decision, reviewer_name: dto.reviewer_name.trim(), applicable_organizations: orgs.length, supports: dto.supports.length, supersedes: vigente?.id ?? null } });
    });
    return { replayed: false, review: { id, version: dto.version, decision: dto.decision },
      note: 'Revisión de ESTA configuración registrada e inmutable. No es la revisión del perfil jurídico, no la adopta en ninguna organización y solo la declara aplicable a las organizaciones indicadas.' };
  }

  // ------------------------------------------------------------------ organización
  private async orgCtx(user: AuthUser, orgId: string, permission: 'traceability:read_catalog' | 'risk:approve_rules', mutation: boolean): Promise<TenantContext> {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw new AppError(404, 'NOT_FOUND', 'No existe.');
    if (!(ctx.permissions as string[]).includes(permission)) throw forbidden();
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }

  async catalogOrg(user: AuthUser, orgId: string) {
    await this.orgCtx(user, orgId, 'traceability:read_catalog', false);
    const configs = await this.catalogo({ orgId, platform: false });
    const adoptada = await configAdoptada(this.db, orgId);
    const hist = (await sql<{ id: string; version: string; decision: string; reason: string; decided_at: Date }>`SELECT id, version, decision, reason, decided_at FROM geo_requirement_config_adoptions WHERE organization_id = ${orgId} ORDER BY decided_at DESC, id DESC`.execute(this.db)).rows;
    return { technical_profile: { id: GEO_PROFILE.id, version: GEO_PROFILE.version }, adopted: adoptada, configs, adoptions: hist, note: NOTE_ORG };
  }

  async adopt(user: AuthUser, orgId: string, dto: AdoptDto, requestId?: string) {
    await this.orgCtx(user, orgId, 'risk:approve_rules', true);
    const prior = (await sql<{ id: string; version: string; decision: string }>`SELECT id, version, decision FROM geo_requirement_config_adoptions WHERE organization_id = ${orgId} AND operation_id = ${dto.operation_id}`.execute(this.db)).rows[0];
    if (prior) {
      if (prior.version !== dto.version || prior.decision !== dto.decision) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, adoption: prior };
    }
    if (!(await sql`SELECT 1 FROM geo_requirement_configs WHERE version = ${dto.version}`.execute(this.db)).rows[0]) {
      throw new AppError(422, 'CONFIG_UNKNOWN', 'Esa versión de configuración no existe.', [{ field: 'version', reason: 'UNKNOWN' }]);
    }
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'geo-config-adopt:' + orgId}))`.execute(trx);
      const actual = await configAdoptada(trx as unknown as Db, orgId);
      if (dto.decision === 'ADOPT' && actual === dto.version) throw conflict('ALREADY_ADOPTED', 'Esa versión ya está adoptada en esta organización.');
      if (dto.decision === 'WITHDRAW' && actual !== dto.version) throw conflict('NOT_ADOPTED', 'Esa versión no es la adoptada en esta organización.');
      await sql`INSERT INTO geo_requirement_config_adoptions (id, organization_id, version, decision, reason, decided_by, operation_id) VALUES (${id}, ${orgId}, ${dto.version}, ${dto.decision}, ${dto.reason.trim()}, ${user.id}, ${dto.operation_id})`.execute(trx);
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: `geo_config.${dto.decision.toLowerCase()}`, entityType: 'geo_requirement_config', entityId: id, requestId, result: 'SUCCESS', reason: dto.reason.trim(), after: { version: dto.version, decision: dto.decision } });
    });
    return { replayed: false, adoption: { id, version: dto.version, decision: dto.decision }, note: 'Adoptar no revisa la configuración ni la declara aplicable: el requisito sigue sin evaluarse mientras falte una revisión vigente favorable que la declare aplicable a esta organización.' };
  }
}

const NOTE_PLATFORM = 'Una configuración revisada NO demuestra que aplique a todas las organizaciones: la revisión declara su alcance. Una regla CANDIDATA nunca se aplica. Preparar o revisar no es una conclusión regulatoria ni concede permisos para concluir.';
const NOTE_ORG = 'Adoptar una configuración no la revisa ni la declara aplicable. El requisito GEOLOCATION_PROFILE solo se evalúa con una configuración adoptada, revisada de forma favorable, declarada aplicable a esta organización y sin reglas candidatas pendientes; aun así es una condición técnica, no una conclusión regulatoria.';

@ApiTags('platform')
@ApiBearerAuth()
@Controller('api/v1/platform/geolocation-config')
export class GeoConfigPlatformController {
  constructor(private readonly service: GeoConfigService) {}
  @Get('versions') list(@CurrentUser() u: AuthUser) { return this.service.listPlatform(u); }
  @Post('versions') prepare(@CurrentUser() u: AuthUser, @Body() dto: PrepareConfigDto, @Req() req: AuthedRequest) { return this.service.prepare(u, dto, req.requestId); }
  @Post('reviews') review(@CurrentUser() u: AuthUser, @Body() dto: ReviewConfigDto, @Req() req: AuthedRequest) { return this.service.review(u, dto, req.requestId); }
}

@ApiTags('geolocation')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/geolocation-config')
export class GeoConfigOrgController {
  constructor(private readonly service: GeoConfigService) {}
  @Get('catalog') catalog(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.catalogOrg(u, o); }
  @Post('adoptions') adopt(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: AdoptDto, @Req() req: AuthedRequest) { return this.service.adopt(u, o, dto, req.requestId); }
}
