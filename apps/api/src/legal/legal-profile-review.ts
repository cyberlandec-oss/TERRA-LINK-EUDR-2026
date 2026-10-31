import { Body, Controller, Get, Inject, Injectable, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateNested } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { perfilesElegibles } from '../risk/risk-profile-link';

// P1-005 — ACTO DE REVISIÓN del perfil jurídico (mecanismo).
//
// QUÉ ES: el registro, por una persona de plataforma (SUPER_ADMIN), de que alguien revisó una versión EXACTA del perfil con un resultado
// (REVIEWED, OBJECTED o WITHDRAWN), con su persona revisora declarada, capacidad, fecha, fundamento y soporte (fuentes del propio perfil o
// citas). Es un acto de PLATAFORMA porque el perfil es un catálogo global.
//
// QUÉ NO ES: registrar el acto NO es que el sistema emita una conclusión jurídica ni que el contenido del perfil quede aprobado por el
// software: el sistema conserva lo que la persona declara y aplica las consecuencias técnicas ya definidas (elegibilidad, vinculación del
// catálogo, obsolescencia de instantáneas). No hay borradores en el servidor: una petición incompleta no escribe nada; lo que se escribe es
// una revisión EFECTIVA, inmutable. Una revisión posterior no reescribe la anterior: la vigente es la última.
//
// QUÉ NO CAMBIA: no publica ni adopta ningún perfil, no vincula ningún catálogo y no concede ni ejerce la facultad de concluir riesgo.

type Db = Kysely<Database>;

class SupportDto {
  @ApiProperty({ enum: ['PROFILE_SOURCE', 'CITATION'], description: 'Fuente del propio perfil (misma versión) o cita externa' })
  @IsIn(['PROFILE_SOURCE', 'CITATION']) kind!: 'PROFILE_SOURCE' | 'CITATION';
  @ApiPropertyOptional({ description: 'Código de una fuente de ESTA versión del perfil (kind = PROFILE_SOURCE)' }) @IsOptional() @IsString() @Matches(/^[A-Z][A-Z0-9_-]{2,59}$/) source_code?: string;
  @ApiPropertyOptional({ description: 'Cita (kind = CITATION)' }) @IsOptional() @IsString() @Length(3, 500) citation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^https:\/\/\S+$/) url?: string;
  @ApiPropertyOptional({ description: 'Huella sha256 de la copia consultada (hex, 64)' }) @IsOptional() @IsString() @Matches(/^[0-9a-f]{64}$/) file_sha256?: string;
}

class RecordReviewDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ description: 'Versión EXACTA del perfil (x.y.z)' }) @IsString() @Matches(/^[0-9]+\.[0-9]+\.[0-9]+$/) version!: string;
  @ApiProperty({ enum: ['REVIEWED', 'OBJECTED', 'WITHDRAWN'] }) @IsIn(['REVIEWED', 'OBJECTED', 'WITHDRAWN']) decision!: 'REVIEWED' | 'OBJECTED' | 'WITHDRAWN';
  @ApiProperty({ description: 'Persona revisora declarada (puede no tener cuenta en la plataforma)' }) @IsString() @Length(3, 200) reviewer_name!: string;
  @ApiProperty({ description: 'Cargo o capacidad declarada' }) @IsString() @Length(3, 300) reviewer_capacity!: string;
  @ApiProperty({ description: 'Fecha de la revisión (YYYY-MM-DD); no puede ser futura' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) reviewed_on!: string;
  @ApiProperty({ description: 'Fundamento de la decisión' }) @IsString() @Length(10, 2000) basis!: string;
  @ApiProperty({ type: [SupportDto], description: 'Fuentes y soporte. REVIEWED exige al menos uno' })
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SupportDto) supports!: SupportDto[];
  @ApiPropertyOptional({ nullable: true, description: 'Revisión que quien registra veía como vigente (null si no había ninguna). Si ya no lo es, se rechaza: no se pisa a ciegas' })
  @IsOptional() @IsUUID() expected_current_review_id?: string | null;
}

interface ReviewRow { id: string; version: string; decision: string; reviewer_name: string; reviewer_capacity: string; reviewed_on: string | Date; basis: string; decided_at: Date; first_name: string | null; last_name: string | null }
interface SupportRow { review_id: string; kind: string; source_code: string | null; citation: string | null; url: string | null; file_sha256: string | null }

const dia = (d: string | Date) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);

@Injectable()
export class LegalProfileReviewService {
  constructor(@Inject(DB) private readonly db: Db, private readonly authz: AuthorizationService, private readonly audit: AuditService) {}

  /** Todas las versiones con sus fuentes, su revisión vigente, su historial y la consecuencia técnica actual (elegibilidad). */
  async list(user: AuthUser) {
    this.authz.requirePlatform(user, 'legal_profile:record_review');
    const versions = await this.db.selectFrom('legal_profile_versions').selectAll().orderBy('version', 'desc').execute();
    const sources = await this.db.selectFrom('legal_profile_sources').select(['version', 'code', 'title', 'publication', 'url', 'file_sha256']).execute();
    const reviews = (await sql<ReviewRow>`
      SELECT r.id, r.version, r.decision, r.reviewer_name, r.reviewer_capacity, r.reviewed_on, r.basis, r.decided_at, u.first_name, u.last_name
      FROM legal_profile_reviews r JOIN users u ON u.id = r.reviewer_id ORDER BY r.decided_at DESC, r.id DESC`.execute(this.db)).rows;
    const supports = (await sql<SupportRow>`SELECT review_id, kind, source_code, citation, url, file_sha256 FROM legal_profile_review_supports ORDER BY id`.execute(this.db)).rows;
    const elegibles = new Map((await perfilesElegibles(this.db)).map((p) => [p.version, p]));
    return {
      versions: versions.map((v) => {
        const hist = reviews.filter((r) => r.version === v.version).map((r, i) => ({
          id: r.id, decision: r.decision, reviewer_name: r.reviewer_name, reviewer_capacity: r.reviewer_capacity, reviewed_on: dia(r.reviewed_on),
          recorded_at: r.decided_at, recorded_by: [r.first_name, r.last_name].filter(Boolean).join(' ') || null, basis: r.basis,
          supports: supports.filter((s) => s.review_id === r.id).map(({ review_id: _r, ...s }) => s), is_current: i === 0,
        }));
        const e = elegibles.get(v.version)!;
        return {
          version: v.version, technical_status: v.technical_status, scope: v.scope, scope_note: v.scope_note, pending_matters: v.pending_matters,
          sources: sources.filter((s) => s.version === v.version).map(({ version: _v, ...s }) => s),
          status: hist[0]?.decision ?? 'NONE', current_review: hist[0] ?? null, history: hist,
          link_eligibility: { eligible: e.eligible, reasons: e.reasons.map((r) => r.code) },
        };
      }),
      note: 'Registrar un acto no es una conclusión jurídica del sistema: conserva lo que declara la persona revisora y aplica las consecuencias técnicas definidas. La revisión vigente es la última; las anteriores se conservan.',
    };
  }

  async record(user: AuthUser, dto: RecordReviewDto, requestId?: string) {
    this.authz.requirePlatform(user, 'legal_profile:record_review');
    const prior = (await sql<{ id: string; version: string; decision: string }>`SELECT id, version, decision FROM legal_profile_reviews WHERE operation_id = ${dto.operation_id}`.execute(this.db)).rows[0];
    if (prior) {
      if (prior.version !== dto.version || prior.decision !== dto.decision) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, review: prior };
    }
    const v = await this.db.selectFrom('legal_profile_versions').select(['version']).where('version', '=', dto.version).executeTakeFirst();
    if (!v) throw new AppError(422, 'LEGAL_PROFILE_UNKNOWN', 'Esa versión de perfil jurídico no existe: una revisión se registra sobre una versión exacta.', [{ field: 'version', reason: 'UNKNOWN' }]);
    const hoy = new Date().toISOString().slice(0, 10);
    const maniana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    if (Number.isNaN(Date.parse(dto.reviewed_on)) || dto.reviewed_on > maniana) {
      throw new AppError(422, 'REVIEW_DATE_INVALID', 'La fecha de la revisión no es válida o es futura.', [{ field: 'reviewed_on', reason: 'FUTURE_OR_INVALID' }]);
    }
    void hoy;
    if (dto.decision === 'REVIEWED' && dto.supports.length === 0) {
      throw new AppError(422, 'REVIEW_SUPPORT_REQUIRED', 'Una revisión REVIEWED exige al menos un soporte: una fuente del perfil o una cita.', [{ field: 'supports', reason: 'REQUIRED' }]);
    }
    const codigos = (await this.db.selectFrom('legal_profile_sources').select('code').where('version', '=', dto.version).execute()).map((s) => s.code);
    for (const [i, s] of dto.supports.entries()) {
      const ok = s.kind === 'PROFILE_SOURCE' ? !!s.source_code && codigos.includes(s.source_code) && !s.citation : !!s.citation && !s.source_code;
      if (!ok) throw new AppError(422, 'REVIEW_SUPPORT_INVALID', 'Cada soporte es una fuente de ESTA versión del perfil o una cita; no ambas, ni una fuente de otra versión.', [{ field: `supports[${i}]`, reason: 'INVALID' }]);
    }
    const id = randomUUID();
    try {
      await this.db.transaction().execute(async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${'legal-review:' + dto.version}))`.execute(trx);
        const vigente = (await sql<{ id: string; decision: string }>`SELECT id, decision FROM legal_profile_reviews WHERE version = ${dto.version} ORDER BY decided_at DESC, id DESC LIMIT 1`.execute(trx)).rows[0] ?? null;
        if (dto.expected_current_review_id !== undefined && (vigente?.id ?? null) !== dto.expected_current_review_id) {
          throw conflict('REVIEW_SUPERSEDED', 'La revisión vigente de esta versión cambió mientras la preparabas: revisa el historial y vuelve a registrar.');
        }
        if (dto.decision === 'WITHDRAWN' && vigente?.decision !== 'REVIEWED') {
          throw new AppError(422, 'NOTHING_TO_WITHDRAW', 'Solo se retira una revisión vigente en estado REVIEWED.', [{ field: 'decision', reason: 'NO_CURRENT_REVIEWED' }]);
        }
        await sql`
          INSERT INTO legal_profile_reviews (id, version, decision, reviewer_id, reviewer_name, reviewer_capacity, reviewed_on, basis, operation_id)
          VALUES (${id}, ${dto.version}, ${dto.decision}, ${user.id}, ${dto.reviewer_name.trim()}, ${dto.reviewer_capacity.trim()}, ${dto.reviewed_on}, ${dto.basis.trim()}, ${dto.operation_id})`.execute(trx);
        for (const s of dto.supports) {
          await sql`
            INSERT INTO legal_profile_review_supports (id, review_id, version, kind, source_code, citation, url, file_sha256)
            VALUES (${randomUUID()}, ${id}, ${dto.version}, ${s.kind}, ${s.kind === 'PROFILE_SOURCE' ? s.source_code! : null}, ${s.kind === 'CITATION' ? s.citation!.trim() : null}, ${s.url ?? null}, ${s.file_sha256 ?? null})`.execute(trx);
        }
        await this.audit.record(trx, {
          organizationId: null, actorUserId: user.id, action: `legal_profile.review_${dto.decision.toLowerCase()}`, entityType: 'legal_profile_review', entityId: id, requestId, result: 'SUCCESS',
          reason: dto.basis.trim(), after: { version: dto.version, decision: dto.decision, reviewer_name: dto.reviewer_name.trim(), reviewer_capacity: dto.reviewer_capacity.trim(), reviewed_on: dto.reviewed_on, supports: dto.supports.length, supersedes: vigente?.id ?? null },
        });
      });
    } catch (e) {
      if (e instanceof AppError) throw e;
      if ((e as { constraint?: string }).constraint === 'legal_profile_reviews_operation_id_key') throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó.');
      throw e;
    }
    return {
      replayed: false, review: { id, version: dto.version, decision: dto.decision },
      note: 'Revisión EFECTIVA registrada e inmutable. No es una conclusión jurídica del sistema ni publica ni adopta el perfil; las consecuencias técnicas (elegibilidad, vinculación del catálogo, obsolescencia de instantáneas) se aplican a partir de ahora.',
    };
  }
}

@ApiTags('platform')
@ApiBearerAuth()
@Controller('api/v1/platform/legal-profile')
export class LegalProfileReviewController {
  constructor(private readonly service: LegalProfileReviewService) {}

  @Get('reviews') list(@CurrentUser() u: AuthUser) { return this.service.list(u); }
  @Post('reviews') record(@CurrentUser() u: AuthUser, @Body() dto: RecordReviewDto, @Req() req: AuthedRequest) { return this.service.record(u, dto, req.requestId); }
}
