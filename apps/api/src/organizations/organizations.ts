import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator';
import { sql, type Kysely, type Selectable } from 'kysely';
import { DB } from '../db/database';
import type { Database, OrganizationsTable } from '../db/schema';
import { AppError, conflict, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';

// P0-001 — Organización (RF-01). Crear y suspender: SUPER_ADMIN de plataforma.
// Configurar: ORG_ADMIN con organization:update. Suspensión bloquea escrituras sin borrar historia.

class CreateOrganizationDto {
  @ApiProperty() @IsString() @Length(1, 200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) legal_name?: string;
  @ApiProperty({ description: 'Código del catálogo provisional D-18 (GET /api/v1/catalog/organization-types)', example: 'EXPORTER' })
  @Matches(/^[A-Z_]{2,40}$/)
  organization_type!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) tax_id?: string;
  @ApiProperty({ example: 'EC' }) @Matches(/^[A-Z]{2}$/) country!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) province?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) canton?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) parish?: string;
  @ApiPropertyOptional({ description: 'Usuario existente que recibe ORG_ADMIN' })
  @IsOptional()
  @IsEmail()
  initial_admin_email?: string;
}

class UpdateOrganizationDto {
  @ApiProperty({ description: 'row_version leída; rechazo 409 si cambió' }) @IsInt() @Min(1) expected_version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) legal_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) tax_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) province?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) canton?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) parish?: string;
}

class StatusChangeDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

class ListQuery {
  @IsOptional() @IsIn(['mine', 'all']) scope?: 'mine' | 'all';
}

type OrgRow = Selectable<OrganizationsTable>;

function toView(o: OrgRow, extra: Record<string, unknown> = {}) {
  return {
    id: o.id,
    name: o.name,
    legal_name: o.legal_name,
    organization_type: o.organization_type,
    tax_id: o.tax_id,
    country: o.country,
    province: o.province,
    canton: o.canton,
    parish: o.parish,
    status: o.status,
    status_reason: o.status_reason,
    row_version: Number(o.row_version),
    created_at: o.created_at,
    updated_at: o.updated_at,
    ...extra,
  };
}

const AUDITED_FIELDS = ['name', 'legal_name', 'tax_id', 'province', 'canton', 'parish', 'status', 'status_reason'] as const;
const pick = (o: OrgRow) => Object.fromEntries(AUDITED_FIELDS.map((k) => [k, o[k]]));

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthUser, dto: CreateOrganizationDto, requestId?: string) {
    this.authz.requirePlatform(user, 'organization:create');
    return this.db.transaction().execute(async (trx) => {
      const type = await trx.selectFrom('organization_types').select('status').where('code', '=', dto.organization_type).executeTakeFirst();
      if (!type || type.status === 'RETIRED' || type.status === 'LEGACY') {
        throw new AppError(422, 'ORGANIZATION_TYPE_UNKNOWN', 'Elige un tipo de organización del catálogo.', [
          { field: 'organization_type', reason: 'NOT_IN_CATALOG' },
        ]);
      }
      let adminId: string | null = null;
      if (dto.initial_admin_email) {
        const admin = await trx
          .selectFrom('users')
          .select(['id', 'status'])
          .where('email', '=', dto.initial_admin_email.trim().toLowerCase())
          .executeTakeFirst();
        if (!admin || admin.status !== 'ACTIVE') {
          throw new AppError(422, 'INITIAL_ADMIN_NOT_FOUND', 'El usuario administrador indicado no existe o está inactivo.', [
            { field: 'initial_admin_email', reason: 'USER_NOT_ACTIVE' },
          ]);
        }
        adminId = admin.id;
      }
      const org = await trx
        .insertInto('organizations')
        .values({
          name: dto.name.trim(),
          legal_name: dto.legal_name ?? null,
          organization_type: dto.organization_type,
          tax_id: dto.tax_id ?? null,
          country: dto.country,
          province: dto.province ?? null,
          canton: dto.canton ?? null,
          parish: dto.parish ?? null,
          status: 'ACTIVE',
          created_by: user.id,
          updated_by: user.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        organizationId: org.id, actorUserId: user.id, action: 'organization.create', entityType: 'organization',
        entityId: org.id, requestId, result: 'SUCCESS', after: pick(org),
      });
      if (adminId) {
        const m = await trx
          .insertInto('memberships')
          .values({ organization_id: org.id, user_id: adminId, status: 'ACTIVE', created_by: user.id, updated_by: user.id })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('role_assignments')
          .values({ organization_id: org.id, membership_id: m.id, role_code: 'ORG_ADMIN', created_by: user.id })
          .execute();
        await this.audit.record(trx, {
          organizationId: org.id, actorUserId: user.id, action: 'membership.create', entityType: 'membership',
          entityId: m.id, requestId, result: 'SUCCESS', after: { user_id: adminId, roles: ['ORG_ADMIN'] },
        });
      }
      return toView(org);
    });
  }

  async list(user: AuthUser, scope: 'mine' | 'all' = 'mine') {
    if (scope === 'all') {
      this.authz.requirePlatform(user, 'organization:list_all');
      const all = await this.db.selectFrom('organizations').selectAll().orderBy('name').orderBy('id').execute();
      return all.map((o) => toView(o));
    }
    const rows = await this.db
      .selectFrom('memberships as m')
      .innerJoin('organizations as o', 'o.id', 'm.organization_id')
      .selectAll('o')
      .select(
        sql<string[]>`coalesce((select array_agg(ra.role_code order by ra.role_code) from role_assignments ra
          where ra.membership_id = m.id and ra.organization_id = m.organization_id), '{}')`.as('roles'),
      )
      .where('m.user_id', '=', user.id)
      .where('m.status', '=', 'ACTIVE')
      .orderBy('o.name')
      .orderBy('o.id')
      .execute();
    return rows.map(({ roles, ...o }) => toView(o as OrgRow, { roles }));
  }

  async get(user: AuthUser, id: string) {
    const org = await this.db.selectFrom('organizations').selectAll().where('id', '=', id).executeTakeFirst();
    if (this.authz.hasPlatform(user, 'organization:list_all')) {
      if (!org) throw notFound();
      return toView(org);
    }
    const ctx = await this.authz.require(user, id, 'organization:read', { mutation: false });
    if (!org) throw notFound();
    return toView(org, { roles: ctx.roles, permissions: ctx.permissions });
  }

  async update(user: AuthUser, id: string, dto: UpdateOrganizationDto, requestId?: string) {
    await this.authz.require(user, id, 'organization:update', { mutation: true });
    const { expected_version, ...changes } = dto;
    const patch = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    return this.db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('organizations').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw notFound();
      if (Number(before.row_version) !== expected_version) {
        throw conflict('VERSION_CONFLICT', 'La organización cambió desde que la abriste. Recarga y vuelve a aplicar tus cambios.');
      }
      const after = await trx
        .updateTable('organizations')
        .set({ ...patch, updated_by: user.id, updated_at: new Date(), row_version: sql`row_version + 1` })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        organizationId: id, actorUserId: user.id, action: 'organization.update', entityType: 'organization',
        entityId: id, requestId, result: 'SUCCESS', before: pick(before), after: pick(after),
      });
      return toView(after);
    });
  }

  async changeStatus(user: AuthUser, id: string, target: 'ACTIVE' | 'SUSPENDED', reason: string, requestId?: string) {
    this.authz.requirePlatform(user, 'organization:suspend');
    return this.db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('organizations').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw notFound();
      if (before.status === target) {
        throw conflict('INVALID_TRANSITION', target === 'SUSPENDED' ? 'La organización ya está suspendida.' : 'La organización ya está activa.');
      }
      const after = await trx
        .updateTable('organizations')
        .set({
          status: target,
          status_reason: target === 'SUSPENDED' ? reason : null,
          updated_by: user.id,
          updated_at: new Date(),
          row_version: sql`row_version + 1`,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        organizationId: id, actorUserId: user.id,
        action: target === 'SUSPENDED' ? 'organization.suspend' : 'organization.reactivate',
        entityType: 'organization', entityId: id, requestId, result: 'SUCCESS', reason,
        before: pick(before), after: pick(after),
      });
      return toView(after);
    });
  }
}

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('api/v1/organizations')
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrganizationDto, @Req() req: AuthedRequest) {
    return this.service.create(user, dto, req.requestId);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    return this.service.list(user, q.scope);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
    @Req() req: AuthedRequest,
  ) {
    return this.service.update(user, id, dto, req.requestId);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusChangeDto, @Req() req: AuthedRequest) {
    return this.service.changeStatus(user, id, 'SUSPENDED', dto.reason, req.requestId);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusChangeDto, @Req() req: AuthedRequest) {
    return this.service.changeStatus(user, id, 'ACTIVE', dto.reason, req.requestId);
  }
}

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('api/v1/catalog')
export class CatalogController {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  // D-18: catálogo PROVISIONAL (no ratificado). El tipo no concede permisos.
  @Get('organization-types')
  async organizationTypes() {
    return this.db
      .selectFrom('organization_types')
      .select(['code', 'label_es', 'status'])
      .where('status', 'in', ['PROVISIONAL', 'RATIFIED'])
      .orderBy('sort_order')
      .execute();
  }
}
