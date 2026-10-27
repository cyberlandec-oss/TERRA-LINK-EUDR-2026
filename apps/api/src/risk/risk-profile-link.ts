import { Body, Controller, Get, Inject, Injectable, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';

// D-07.5(b), opción b-1 — acto de vinculación del catálogo de riesgo con un perfil jurídico revisado.
//
// QUÉ HACE: crea una versión NUEVA del catálogo que es copia exacta de las reglas de una versión base y declara, en
// `regulatory_profile`, una referencia explícita a una versión del perfil jurídico. Registra el acto (autor, fecha,
// motivo, versión, perfil y la revisión exacta que lo sustenta).
//
// QUÉ NO HACE, a propósito:
//   · No edita 1.0.0 ni ninguna versión publicada; no toca sus adopciones ni evaluaciones.
//   · No adopta la versión nueva en ninguna organización (adoptar es de cada organización: `risk:approve_rules`).
//   · No crea ni cambia reglas, no decide el contenido jurídico del perfil y no registra ninguna conclusión.
//   · No acepta una etiqueta: la referencia debe resolver contra un perfil PUBLICADO, COMPLETO y con revisión vigente
//     (la misma condición de `LEGAL_PROFILE`), y la base lo vuelve a comprobar (triggers de 0059 y 0061).
//   · No hereda la aprobación técnica de la base: la versión derivada nace NOT_APPROVED.
// Es un acto de PLATAFORMA (el catálogo es global): permiso `risk_catalog:link_profile`, solo SUPER_ADMIN.

type Db = Kysely<Database>;

export const RAZONES: Record<string, string> = {
  DRAFT: 'El perfil es un borrador (no publicado).',
  SCOPE_PARTIAL: 'El alcance del perfil es PARCIAL.',
  NO_REVIEW: 'El perfil no tiene ninguna revisión jurídica registrada.',
  REVIEW_OBJECTED: 'La última decisión de revisión del perfil es OBJECTED (objetada).',
  REVIEW_WITHDRAWN: 'La última decisión de revisión del perfil es WITHDRAWN (retirada).',
};

export interface PerfilElegible {
  version: string; technical_status: string; scope: string; pending_matters: string[];
  eligible: boolean; reasons: Array<{ code: string; text: string }>;
  review: { id: string; decision: string; decided_at: Date; reviewer_capacity: string } | null;
}

/** Elegibilidad = el contrato que ya usa `LEGAL_PROFILE`: publicado, completo y con la última revisión en REVIEWED. */
export async function perfilesElegibles(db: Db): Promise<PerfilElegible[]> {
  const versions = await db.selectFrom('legal_profile_versions').selectAll().orderBy('version', 'desc').execute();
  const reviews = await sql<{ id: string; version: string; decision: string; decided_at: Date; reviewer_capacity: string }>`
    SELECT id, version, decision, decided_at, reviewer_capacity FROM legal_profile_reviews ORDER BY decided_at DESC, id DESC`.execute(db);
  return versions.map((v) => {
    const review = reviews.rows.find((r) => r.version === v.version) ?? null;
    const codes = [
      ...(v.technical_status !== 'PUBLISHED' ? ['DRAFT'] : []),
      ...(v.scope !== 'COMPLETE' ? ['SCOPE_PARTIAL'] : []),
      ...(!review ? ['NO_REVIEW'] : review.decision !== 'REVIEWED' ? [`REVIEW_${review.decision}`] : []),
    ];
    return {
      version: v.version, technical_status: v.technical_status, scope: v.scope, pending_matters: v.pending_matters,
      eligible: codes.length === 0, reasons: codes.map((code) => ({ code, text: RAZONES[code] ?? code })), review,
    };
  });
}

class LinkProfileDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ description: 'Versión publicada del catálogo cuyas reglas se copian sin cambios' })
  @IsString() @Matches(/^[0-9]+\.[0-9]+\.[0-9]+$/) base_rule_set_version!: string;
  @ApiProperty({ description: 'Versión NUEVA del catálogo que nace vinculada; no puede existir' })
  @IsString() @Matches(/^[0-9]+\.[0-9]+\.[0-9]+$/) new_rule_set_version!: string;
  @ApiProperty({ description: 'Referencia exacta (x.y.z) a una versión de legal_profile_versions; no se acepta una etiqueta' })
  @IsString() @Matches(/^[0-9]+\.[0-9]+\.[0-9]+$/) profile_version!: string;
  @ApiProperty({ description: 'Revisión jurídica vigente que sustenta la referencia; si dejó de ser la vigente, se rechaza' })
  @IsUUID() review_id!: string;
  @ApiProperty({ description: 'Motivo del acto; queda en el registro y en auditoría' }) @IsString() @Length(3, 500) reason!: string;
}

@Injectable()
export class RiskProfileLinkService {
  constructor(@Inject(DB) private readonly db: Db, private readonly authz: AuthorizationService, private readonly audit: AuditService) {}

  /** Perfiles con su elegibilidad y los catálogos publicados (para revisar la referencia propuesta antes de confirmar). */
  async eligibility(user: AuthUser) {
    this.authz.requirePlatform(user, 'risk_catalog:link_profile');
    const rules = await sql<{ version: string; approval_status: string; regulatory_profile: string | null; published_at: Date }>`
      SELECT version, approval_status, regulatory_profile, published_at FROM risk_rule_sets ORDER BY published_at DESC, version DESC`.execute(this.db);
    return {
      profiles: await perfilesElegibles(this.db),
      rule_sets: rules.rows,
      note: 'Solo un perfil publicado, de alcance completo y con la última revisión en REVIEWED es elegible. Elegible no significa aprobado: el contenido jurídico lo decide quien revisa.',
    };
  }

  /** Historial de actos, con la vigencia ACTUAL de cada referencia: la histórica permanece aunque la revisión cambie. */
  async history(user: AuthUser) {
    this.authz.requirePlatform(user, 'risk_catalog:link_profile');
    const perfiles = new Map((await perfilesElegibles(this.db)).map((p) => [p.version, p]));
    const rows = await sql<{ id: string; rule_set_version: string; base_rule_set_version: string; profile_version: string; review_id: string; reason: string; decided_at: Date; first_name: string | null; last_name: string | null }>`
      SELECT l.id, l.rule_set_version, l.base_rule_set_version, l.profile_version, l.review_id, l.reason, l.decided_at, u.first_name, u.last_name
      FROM risk_rule_set_profile_links l JOIN users u ON u.id = l.decided_by ORDER BY l.decided_at DESC, l.id DESC`.execute(this.db);
    return {
      links: rows.rows.map((l) => {
        const p = perfiles.get(l.profile_version);
        const vigente = !!p?.eligible;
        return {
          id: l.id, rule_set_version: l.rule_set_version, base_rule_set_version: l.base_rule_set_version, profile_version: l.profile_version,
          review_id: l.review_id, reason: l.reason, decided_at: l.decided_at, decided_by: [l.first_name, l.last_name].filter(Boolean).join(' ') || null,
          current_status: vigente ? 'CURRENT' : 'NO_LONGER_VALID',
          current_reasons: vigente ? [] : (p?.reasons ?? [{ code: 'PROFILE_MISSING', text: 'El perfil referenciado ya no figura.' }]),
          note: vigente ? null : 'La referencia histórica se conserva, pero ya no se usa como aprobación vigente: RISK_CATALOG_APPROVED queda pendiente.',
        };
      }),
    };
  }

  async link(user: AuthUser, dto: LinkProfileDto, requestId?: string) {
    this.authz.requirePlatform(user, 'risk_catalog:link_profile');
    const prior = await sql<{ id: string; rule_set_version: string; base_rule_set_version: string; profile_version: string; review_id: string }>`
      SELECT id, rule_set_version, base_rule_set_version, profile_version, review_id FROM risk_rule_set_profile_links WHERE operation_id = ${dto.operation_id}`.execute(this.db);
    if (prior.rows[0]) {
      const p = prior.rows[0];
      if (p.rule_set_version !== dto.new_rule_set_version || p.base_rule_set_version !== dto.base_rule_set_version || p.profile_version !== dto.profile_version || p.review_id !== dto.review_id) {
        throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      }
      return { replayed: true, link: p };
    }
    const base = (await sql<{ version: string }>`SELECT version FROM risk_rule_sets WHERE version = ${dto.base_rule_set_version}`.execute(this.db)).rows[0];
    if (!base) throw new AppError(422, 'RULE_SET_NOT_PUBLISHED', 'La versión base no está publicada.', [{ field: 'base_rule_set_version', reason: 'UNKNOWN' }]);
    const existe = (await sql`SELECT 1 FROM risk_rule_sets WHERE version = ${dto.new_rule_set_version}`.execute(this.db)).rows[0];
    if (existe || dto.new_rule_set_version === dto.base_rule_set_version) {
      throw conflict('RULE_SET_VERSION_EXISTS', 'Esa versión del catálogo ya existe: las versiones publicadas no se editan, el acto crea una nueva.');
    }
    const perfil = (await perfilesElegibles(this.db)).find((p) => p.version === dto.profile_version);
    if (!perfil) throw new AppError(422, 'PROFILE_UNKNOWN', 'Esa versión de perfil jurídico no existe: una etiqueta no sustituye a la referencia.', [{ field: 'profile_version', reason: 'UNKNOWN' }]);
    if (!perfil.eligible) {
      throw new AppError(422, 'PROFILE_NOT_ELIGIBLE', 'El perfil no cumple la condición para sustentar la vinculación.',
        perfil.reasons.map((r) => ({ field: 'profile_version', reason: r.code })));
    }
    if (perfil.review?.id !== dto.review_id) {
      throw conflict('REVIEW_CHANGED', 'La revisión que se iba a confirmar ya no es la vigente del perfil: vuelve a revisar la referencia.');
    }
    const id = randomUUID();
    try {
      await this.db.transaction().execute(async (trx) => {
        await sql`
          INSERT INTO risk_rule_sets (version, approval_status, approved_by, source, notes, regulatory_profile)
          VALUES (${dto.new_rule_set_version}, 'NOT_APPROVED', NULL,
            ${`Derivada de ${dto.base_rule_set_version} por el acto de vinculación ${id}`},
            ${`Copia exacta de las reglas de ${dto.base_rule_set_version}; vinculada al perfil jurídico ${dto.profile_version} (D-07.5(b), b-1). La aprobación técnica de la versión base NO se hereda. No es una conclusión regulatoria.`},
            ${dto.profile_version})`.execute(trx);
        await sql`
          INSERT INTO risk_rule_set_profile_links (id, rule_set_version, base_rule_set_version, profile_version, review_id, reason, decided_by, operation_id)
          VALUES (${id}, ${dto.new_rule_set_version}, ${dto.base_rule_set_version}, ${dto.profile_version}, ${dto.review_id}, ${dto.reason.trim()}, ${user.id}, ${dto.operation_id})`.execute(trx);
        await sql`
          INSERT INTO risk_rules (rule_set_version, code, category, condition_kind, inputs, effect, explanation, limit_note, evidence_required, source, depends_on, severity)
          SELECT ${dto.new_rule_set_version}, code, category, condition_kind, inputs, effect, explanation, limit_note, evidence_required, source, depends_on, severity
          FROM risk_rules WHERE rule_set_version = ${dto.base_rule_set_version}`.execute(trx);
        await this.audit.record(trx, {
          organizationId: null, actorUserId: user.id, action: 'risk_catalog.link_profile', entityType: 'risk_rule_set', entityId: null, requestId, result: 'SUCCESS',
          reason: dto.reason.trim(), after: { link_id: id, rule_set_version: dto.new_rule_set_version, base_rule_set_version: dto.base_rule_set_version, profile_version: dto.profile_version, review_id: dto.review_id },
        });
      });
    } catch (e) {
      const m = String((e as { message?: string }).message ?? '');
      // La base repite las comprobaciones: si una carrera cambió la revisión entre la lectura y la escritura, no es un 500.
      if (/revisión citada|no tiene una revisión jurídica vigente|PUBLICADO y de alcance COMPLETO/.test(m)) {
        throw conflict('REVIEW_CHANGED', 'La revisión del perfil cambió mientras se confirmaba: vuelve a revisar la referencia.');
      }
      throw e;
    }
    return {
      replayed: false,
      link: { id, rule_set_version: dto.new_rule_set_version, base_rule_set_version: dto.base_rule_set_version, profile_version: dto.profile_version, review_id: dto.review_id },
      note: 'La versión nueva queda publicada pero NO adoptada: cada organización decide adoptarla. Esto no es una conclusión regulatoria ni aprueba el contenido del perfil.',
    };
  }
}

@ApiTags('platform')
@ApiBearerAuth()
@Controller('api/v1/platform/risk-catalog')
export class RiskProfileLinkController {
  constructor(private readonly service: RiskProfileLinkService) {}

  @Get('profile-links/eligibility') eligibility(@CurrentUser() u: AuthUser) { return this.service.eligibility(u); }
  @Get('profile-links') history(@CurrentUser() u: AuthUser) { return this.service.history(u); }
  @Post('profile-links') link(@CurrentUser() u: AuthUser, @Body() dto: LinkProfileDto, @Req() req: AuthedRequest) { return this.service.link(u, dto, req.requestId); }
}
