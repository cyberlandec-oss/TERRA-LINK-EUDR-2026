import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Kysely } from 'kysely';
import { CurrentUser, type AuthUser } from '../auth/auth';
import { AuthorizationService } from '../authz/authorization.service';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict } from '../common/errors';

class GovernanceApprovalDto {
  @IsUUID() operation_id!: string;
  @IsIn(['APPROVE', 'RETIRE']) decision!: 'APPROVE' | 'RETIRE';
  @IsString() @Length(10, 2000) basis!: string;
}

class GovernanceControlDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_-]{2,79}$/) code!: string;
  @IsIn(['APPLICABILITY', 'RETENTION', 'LEGAL_BASIS', 'RESPONSIBILITY']) kind!: 'APPLICABILITY' | 'RETENTION' | 'LEGAL_BASIS' | 'RESPONSIBILITY';
  @IsString() @Length(3, 300) title!: string;
  @IsIn(['PENDING', 'ACTIVE', 'EXPIRED']) status!: 'PENDING' | 'ACTIVE' | 'EXPIRED';
  @IsOptional() @IsString() @Length(1, 1000) value_text?: string;
  @IsString() @Length(3, 500) source_reference!: string;
  @IsOptional() @IsString() @Length(3, 100) responsible_role?: string;
  @IsString() @Length(3, 2000) notes!: string;
}

class CreateGovernanceDto {
  @IsString() @Matches(/^\d+\.\d+\.\d+$/) version!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) effective_from!: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) effective_to?: string;
  @IsString() @Matches(/^https:\/\/\S+$/) source_url!: string;
  @IsOptional() @IsString() @Matches(/^[0-9a-f]{64}$/) source_sha256?: string;
  @IsString() @Length(10, 2000) purpose!: string;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => GovernanceControlDto) controls!: GovernanceControlDto[];
}

@Injectable()
export class LegalGovernanceService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>, private readonly authz: AuthorizationService, private readonly audit: AuditService) {}

  async list(user: AuthUser) {
    this.authz.requirePlatform(user, 'legal_governance:read');
    const versions = await this.db.selectFrom('legal_governance_versions').selectAll().orderBy('effective_from', 'desc').execute();
    const controls = await this.db.selectFrom('legal_governance_controls').selectAll().orderBy('version').orderBy('code').execute();
    return { versions: versions.map((v) => ({ ...v, controls: controls.filter((c) => c.version === v.version) })),
      note: 'Marco técnico versionado. DRAFT, PENDING y RETIRED bloquean conclusiones; el sistema no infiere bases jurídicas ni responsables.' };
  }

  async create(user: AuthUser, dto: CreateGovernanceDto) {
    this.authz.requirePlatform(user, 'legal_governance:manage');
    const prior = await this.db.selectFrom('legal_governance_versions').select('version').where('version', '=', dto.version).executeTakeFirst();
    if (prior) throw conflict('LEGAL_GOVERNANCE_VERSION_EXISTS', 'La versión de gobernanza ya existe y es inmutable.');
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('legal_governance_versions').values({ version: dto.version, jurisdiction: 'EC', status: 'DRAFT', effective_from: dto.effective_from, effective_to: dto.effective_to ?? null, source_url: dto.source_url, source_sha256: dto.source_sha256 ?? null, purpose: dto.purpose.trim(), created_by: user.email }).execute();
      await trx.insertInto('legal_governance_controls').values(dto.controls.map((c) => ({ version: dto.version, code: c.code, kind: c.kind, title: c.title.trim(), status: c.status, value_text: c.value_text ?? null, source_reference: c.source_reference.trim(), responsible_role: c.responsible_role ?? null, notes: c.notes.trim() }))).execute();
      await this.audit.record(trx, { organizationId: null, actorUserId: user.id, action: 'legal_governance.create', entityType: 'legal_governance_version', entityId: dto.version, result: 'SUCCESS', reason: dto.purpose.trim(), after: { version: dto.version, controls: dto.controls.length } });
    });
    return { version: dto.version, status: 'DRAFT', controls: dto.controls.length, note: 'Versión creada como DRAFT; requiere aprobación posterior y no habilita READY.' };
  }

  async approve(user: AuthUser, version: string, dto: GovernanceApprovalDto) {
    this.authz.requirePlatform(user, 'legal_governance:manage');
    const existing = await this.db.selectFrom('legal_governance_versions').select(['version', 'status', 'effective_from', 'effective_to']).where('version', '=', version).executeTakeFirst();
    if (!existing) throw new AppError(422, 'LEGAL_GOVERNANCE_UNKNOWN', 'La versión de gobernanza no existe.', [{ field: 'version', reason: 'UNKNOWN' }]);
    if (existing.status !== 'DRAFT' && dto.decision === 'APPROVE') throw conflict('LEGAL_GOVERNANCE_NOT_DRAFT', 'Solo se puede aprobar una versión en DRAFT.');
    if (dto.decision === 'APPROVE') {
      const today = new Date().toISOString().slice(0, 10);
      if (existing.effective_from > today || (existing.effective_to !== null && existing.effective_to < today)) {
        throw new AppError(422, 'LEGAL_GOVERNANCE_NOT_EFFECTIVE', 'No se puede aprobar una versión fuera de su periodo de vigencia.', [{ field: 'effective_from', reason: 'OUTSIDE_EFFECTIVE_WINDOW' }]);
      }
      const pending = await this.db.selectFrom('legal_governance_controls').select(['code']).where('version', '=', version).where('status', '=', 'PENDING').execute();
      if (pending.length) throw new AppError(422, 'LEGAL_GOVERNANCE_PENDING_CONTROLS', 'No se puede aprobar el marco mientras existan controles PENDING.', pending.map((p) => ({ field: p.code, reason: 'PENDING' })));
    }
    const status = dto.decision === 'APPROVE' ? 'APPROVED' : 'RETIRED';
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('legal_governance_versions').set({ status, approved_by: user.id, approved_at: new Date(), approval_basis: dto.basis.trim() }).where('version', '=', version).execute();
      await this.audit.record(trx, { organizationId: null, actorUserId: user.id, action: `legal_governance.${dto.decision.toLowerCase()}`, entityType: 'legal_governance_version', entityId: version, result: 'SUCCESS', reason: dto.basis.trim(), after: { version, status } });
    });
    return { version, status, note: 'La decisión quedó auditada. Aprobar el marco no emite una conclusión EUDR sobre ningún expediente.' };
  }
}

@ApiTags('Gobernanza legal')
@ApiBearerAuth()
@Controller('api/v1/platform/legal-governance')
export class LegalGovernanceController {
  constructor(private readonly service: LegalGovernanceService) {}
  @Get('versions') @ApiOperation({ summary: 'Consultar el marco legal versionado y sus controles' })
  list(@CurrentUser() user: AuthUser) { return this.service.list(user); }
  @Post('versions') @ApiOperation({ summary: 'Crear una versión DRAFT del marco legal' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateGovernanceDto) { return this.service.create(user, dto); }
  @Post('versions/:version/decision') @ApiOperation({ summary: 'Aprobar o retirar un marco legal versionado' })
  approve(@CurrentUser() user: AuthUser, @Param('version') version: string, @Body() dto: GovernanceApprovalDto) { return this.service.approve(user, version, dto); }
}
