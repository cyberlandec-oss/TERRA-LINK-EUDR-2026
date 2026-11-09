import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, Length } from 'class-validator';
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

  async approve(user: AuthUser, version: string, dto: GovernanceApprovalDto) {
    this.authz.requirePlatform(user, 'legal_governance:manage');
    const existing = await this.db.selectFrom('legal_governance_versions').select(['version', 'status']).where('version', '=', version).executeTakeFirst();
    if (!existing) throw new AppError(422, 'LEGAL_GOVERNANCE_UNKNOWN', 'La versión de gobernanza no existe.', [{ field: 'version', reason: 'UNKNOWN' }]);
    if (existing.status !== 'DRAFT' && dto.decision === 'APPROVE') throw conflict('LEGAL_GOVERNANCE_NOT_DRAFT', 'Solo se puede aprobar una versión en DRAFT.');
    if (dto.decision === 'APPROVE') {
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
  @Post('versions/:version/decision') @ApiOperation({ summary: 'Aprobar o retirar un marco legal versionado' })
  approve(@CurrentUser() user: AuthUser, @Param('version') version: string, @Body() dto: GovernanceApprovalDto) { return this.service.approve(user, version, dto); }
}
