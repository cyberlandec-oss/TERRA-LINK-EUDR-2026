import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength,
} from 'class-validator';
import { createHash, randomBytes } from 'crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, forbidden, notFound, unauthenticated } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { PlatformElevationService } from '../authz/platform-elevation';
import { AuthorizationService } from '../authz/authorization.service';
import { ORGANIZATION_ROLES, assignableRoles, canGrantRole, type Permission } from '../authz/catalog';
import { CurrentUser, Public, issueAccessToken, type AuthUser, type AuthedRequest } from '../auth/auth';
import { hashPassword } from '../auth/passwords';

// P0-002 — Usuarios (RF-02). Invitación por enlace de un solo uso: MECANISMO PROVISIONAL de
// desarrollo sin servicio de correo (ADR-0005). El token solo se devuelve una vez a quien invita;
// se guarda únicamente su SHA-256 y nunca se registra en logs ni auditoría.

const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

class CreateInvitationDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty({ enum: ORGANIZATION_ROLES }) @IsIn(ORGANIZATION_ROLES) role_code!: string;
}

class TokenDto {
  @ApiProperty({ description: 'Token del enlace (secreto)' }) @Matches(TOKEN_PATTERN) token!: string;
}

// Solo token + datos del nuevo usuario. Organización, destinatario y rol salen de la invitación;
// cualquier otro campo se rechaza (ValidationPipe forbidNonWhitelisted).
class AcceptInvitationDto {
  @ApiProperty() @Matches(TOKEN_PATTERN) token!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) first_name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) last_name?: string;
  @ApiPropertyOptional({ minLength: 12 }) @IsOptional() @IsString() @MinLength(12) @MaxLength(200) password?: string;
}

class ChangeRolesDto {
  @ApiProperty({ enum: ORGANIZATION_ROLES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(11)
  @IsIn(ORGANIZATION_ROLES, { each: true })
  roles!: string[];
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

class ReasonDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

type Db = Kysely<Database> | Transaction<Database>;

@Injectable()
export class MembersService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly elevation: PlatformElevationService,
  ) {}

  /**
   * Resuelve al actor. Miembro activo: sus permisos en ESA organización (los roles de otra org no
   * cuentan). SUPER_ADMIN sin membresía: modo `onboarding` (solo invitaciones ORG_ADMIN). Resto: 404.
   */
  private async actor(
    user: AuthUser,
    orgId: string,
    need: 'membership:read' | 'membership:assign',
    mutation: boolean,
  ): Promise<{ perms: Permission[]; onboarding: boolean }> {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (ctx) {
      await this.authz.require(user, orgId, need, { mutation });
      return { perms: ctx.permissions, onboarding: false };
    }
    if (this.authz.hasPlatform(user, 'organization:onboard_admin')) {
      const org = await this.db.selectFrom('organizations').select('status').where('id', '=', orgId).executeTakeFirst();
      if (!org) throw notFound();
      if (mutation && org.status !== 'ACTIVE') {
        throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
      }
      return { perms: [], onboarding: true };
    }
    throw notFound();
  }

  /** Acceso a miembros y datos personales de una org ajena: bloqueado hasta definir D-04. */
  private elevationRequired(): never {
    throw forbidden(
      'ELEVATION_REQUIRED',
      'El acceso de plataforma a miembros de una organización requiere una elevación auditada que aún no está definida (D-04).',
    );
  }

  async assignable(user: AuthUser, orgId: string) {
    const a = await this.actor(user, orgId, 'membership:read', false);
    return { roles: a.onboarding ? ['ORG_ADMIN'] : assignableRoles(a.perms), onboarding_only: a.onboarding };
  }

  async createInvitation(user: AuthUser, orgId: string, dto: CreateInvitationDto, requestId?: string) {
    const a = await this.actor(user, orgId, 'membership:assign', true);
    if (a.onboarding ? dto.role_code !== 'ORG_ADMIN' : !canGrantRole(a.perms, dto.role_code)) {
      throw forbidden('ROLE_NOT_GRANTABLE', a.onboarding
        ? 'Desde la administración de plataforma solo se invita al administrador de la organización.'
        : 'No puedes conceder un rol con permisos que no tienes.');
    }
    const email = dto.email.trim().toLowerCase();
    const token = newToken();
    return this.db.transaction().execute(async (trx) => {
      const member = await trx
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .select('m.status')
        .where('m.organization_id', '=', orgId)
        .where('u.email', '=', email)
        .executeTakeFirst();
      if (member?.status === 'ACTIVE') {
        throw conflict('ALREADY_MEMBER', 'Esa persona ya es miembro activo de la organización.');
      }
      // Una pendiente vencida no bloquea: se revoca automáticamente para permitir reemitir.
      await trx
        .updateTable('invitations')
        .set({ status: 'REVOKED', revoked_at: new Date(), revoked_by: user.id })
        .where('organization_id', '=', orgId)
        .where('email', '=', email)
        .where('status', '=', 'PENDING')
        .where('expires_at', '<=', new Date())
        .execute();
      const expiresAt = new Date(Date.now() + this.config.invitationTtlHours * 3600_000);
      let inv;
      try {
        inv = await trx
          .insertInto('invitations')
          .values({
            organization_id: orgId, email, role_code: dto.role_code, token_hash: hashToken(token),
            status: 'PENDING', expires_at: expiresAt, created_by: user.id,
          })
          .returning(['id', 'email', 'role_code', 'status', 'expires_at', 'created_at'])
          .executeTakeFirstOrThrow();
      } catch (e) {
        if ((e as { constraint?: string }).constraint === 'invitations_pending_uq') {
          throw conflict('INVITATION_PENDING', 'Ya existe una invitación pendiente para ese correo. Revócala para emitir otra.');
        }
        throw e;
      }
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'invitation.create', entityType: 'invitation',
        entityId: inv.id, requestId, result: 'SUCCESS',
        after: { email, role_code: dto.role_code, expires_at: expiresAt.toISOString() },
      });
      // El token sale una única vez en esta respuesta; no se puede recuperar después.
      return { ...inv, token };
    });
  }

  async listInvitations(user: AuthUser, orgId: string) {
    const a = await this.actor(user, orgId, 'membership:read', false);
    let q = this.db
      .selectFrom('invitations')
      .select(['id', 'email', 'role_code', 'status', 'expires_at', 'created_at', 'accepted_at', 'revoked_at'])
      .where('organization_id', '=', orgId);
    if (a.onboarding) q = q.where('role_code', '=', 'ORG_ADMIN');
    const rows = await q.orderBy('created_at', 'desc').execute();
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      status: r.status === 'PENDING' && new Date(r.expires_at).getTime() <= now ? 'EXPIRED' : r.status,
    }));
  }

  async revokeInvitation(user: AuthUser, orgId: string, invitationId: string, requestId?: string) {
    const a = await this.actor(user, orgId, 'membership:assign', true);
    const allowed = a.onboarding ? ['ORG_ADMIN'] : ORGANIZATION_ROLES;
    return this.db.transaction().execute(async (trx) => {
      const inv = await trx
        .updateTable('invitations')
        .set({ status: 'REVOKED', revoked_at: new Date(), revoked_by: user.id })
        .where('id', '=', invitationId)
        .where('organization_id', '=', orgId)
        .where('role_code', 'in', allowed)
        .where('status', '=', 'PENDING')
        .returning(['id', 'email', 'role_code', 'status'])
        .executeTakeFirst();
      if (!inv) {
        const exists = await trx.selectFrom('invitations').select('status').where('id', '=', invitationId).where('organization_id', '=', orgId).where('role_code', 'in', allowed).executeTakeFirst();
        if (!exists) throw notFound();
        throw conflict('INVALID_TRANSITION', 'La invitación ya no está pendiente.');
      }
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'invitation.revoke', entityType: 'invitation',
        entityId: inv.id, requestId, result: 'SUCCESS', after: { email: inv.email, role_code: inv.role_code },
      });
      return inv;
    });
  }

  /** Estado de una invitación para quien posee el token. Inválido/inexistente → 404 genérico. */
  async preview(token: string, currentUser?: AuthUser) {
    const inv = await this.db
      .selectFrom('invitations as i')
      .innerJoin('organizations as o', 'o.id', 'i.organization_id')
      .select(['i.email', 'i.role_code', 'i.status', 'i.expires_at', 'o.name as organization_name', 'o.status as organization_status'])
      .where('i.token_hash', '=', hashToken(token))
      .executeTakeFirst();
    if (!inv) throw notFound('El enlace de invitación no es válido.');
    this.assertUsable(inv);
    const existing = await this.db.selectFrom('users').select('id').where('email', '=', inv.email).executeTakeFirst();
    return {
      organization_name: inv.organization_name,
      email: inv.email,
      role_code: inv.role_code,
      expires_at: inv.expires_at,
      requires_login: !!existing,
      signed_in_as_recipient: !!currentUser && currentUser.email === inv.email,
    };
  }

  private assertUsable(inv: { status: string; expires_at: Date | string; organization_status: string }) {
    if (inv.status === 'ACCEPTED') throw new AppError(410, 'INVITATION_USED', 'Esta invitación ya fue utilizada. Inicia sesión o pide una nueva.');
    if (inv.status === 'REVOKED') throw new AppError(410, 'INVITATION_REVOKED', 'Esta invitación fue revocada. Pide una nueva al administrador.');
    if (new Date(inv.expires_at).getTime() <= Date.now()) throw new AppError(410, 'INVITATION_EXPIRED', 'Esta invitación venció. Pide una nueva al administrador.');
    if (inv.organization_status !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas incorporaciones.');
  }

  async accept(dto: AcceptInvitationDto, currentUser: AuthUser | undefined, requestId?: string) {
    const tokenHash = hashToken(dto.token);
    // Se calcula fuera de la transacción (argon2 es lento) y solo se usa si hay que crear la cuenta.
    const passwordHash = dto.password ? await hashPassword(dto.password) : null;
    const result = await this.db.transaction().execute(async (trx) => {
      // Consumo atómico: solo una transacción puede pasar PENDING → ACCEPTED (bloqueo de fila).
      const inv = await trx
        .selectFrom('invitations as i')
        .innerJoin('organizations as o', 'o.id', 'i.organization_id')
        .select(['i.id', 'i.organization_id', 'i.email', 'i.role_code', 'i.status', 'i.expires_at', 'i.created_by', 'o.status as organization_status'])
        .where('i.token_hash', '=', tokenHash)
        .forUpdate('i')
        .executeTakeFirst();
      if (!inv) throw notFound('El enlace de invitación no es válido.');
      this.assertUsable(inv);

      let userId: string;
      let tokenVersion: number;
      let createdUser = false;
      const existing = await trx.selectFrom('users').select(['id', 'status', 'token_version']).where('email', '=', inv.email).forUpdate().executeTakeFirst();
      if (existing) {
        // Cuenta existente: solo su titular autenticado puede aceptar; el enlace no prueba la identidad.
        if (!currentUser) throw unauthenticated();
        if (currentUser.id !== existing.id) {
          throw forbidden('INVITATION_RECIPIENT_MISMATCH', 'Esta invitación es para otra cuenta. Inicia sesión con el correo invitado.');
        }
        if (existing.status !== 'ACTIVE') throw forbidden('USER_INACTIVE', 'Tu cuenta está desactivada.');
        userId = existing.id;
        tokenVersion = existing.token_version;
      } else {
        if (!dto.first_name || !dto.last_name || !passwordHash) {
          throw new AppError(400, 'VALIDATION_FAILED', 'Completa nombre, apellido y una contraseña de al menos 12 caracteres.', [
            { field: 'first_name', reason: 'REQUIRED' }, { field: 'last_name', reason: 'REQUIRED' }, { field: 'password', reason: 'REQUIRED' },
          ]);
        }
        const u = await trx
          .insertInto('users')
          .values({
            email: inv.email, first_name: dto.first_name.trim(), last_name: dto.last_name.trim(),
            password_hash: passwordHash, status: 'ACTIVE', platform_role: null,
            // email_verified_at queda null: aceptar el enlace no verifica el correo.
          })
          .returning(['id', 'token_version'])
          .executeTakeFirstOrThrow();
        userId = u.id;
        tokenVersion = u.token_version;
        createdUser = true;
      }

      const membership = await this.upsertMembership(trx, inv.organization_id, userId, inv.created_by);
      await trx
        .insertInto('role_assignments')
        .values({ organization_id: inv.organization_id, membership_id: membership.id, role_code: inv.role_code, created_by: inv.created_by })
        .onConflict((oc) => oc.columns(['membership_id', 'role_code']).doNothing())
        .execute();
      await trx
        .updateTable('invitations')
        .set({ status: 'ACCEPTED', accepted_at: new Date(), accepted_by: userId })
        .where('id', '=', inv.id)
        .where('status', '=', 'PENDING')
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        organizationId: inv.organization_id, actorUserId: userId, action: 'invitation.accept', entityType: 'invitation',
        entityId: inv.id, requestId, result: 'SUCCESS',
        after: { membership_id: membership.id, role_code: inv.role_code, user_created: createdUser, membership_reactivated: membership.reactivated },
      });
      return { userId, tokenVersion, organizationId: inv.organization_id, membershipId: membership.id };
    });
    return {
      organization_id: result.organizationId,
      membership_id: result.membershipId,
      session: issueAccessToken(this.config, result.userId, result.tokenVersion),
    };
  }

  private async upsertMembership(trx: Db, orgId: string, userId: string, actorId: string) {
    const current = await trx.selectFrom('memberships').select(['id', 'status']).where('organization_id', '=', orgId).where('user_id', '=', userId).forUpdate().executeTakeFirst();
    if (!current) {
      const m = await trx
        .insertInto('memberships')
        .values({ organization_id: orgId, user_id: userId, status: 'ACTIVE', created_by: actorId, updated_by: actorId })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { id: m.id, reactivated: false };
    }
    if (current.status === 'ACTIVE') throw conflict('ALREADY_MEMBER', 'Ya eres miembro activo de esta organización.');
    // Reingreso por nueva invitación: los roles previos se retiran; solo vale el rol invitado.
    await trx.deleteFrom('role_assignments').where('membership_id', '=', current.id).where('organization_id', '=', orgId).execute();
    await trx.updateTable('memberships').set({ status: 'ACTIVE', status_reason: null, updated_by: actorId, updated_at: new Date() }).where('id', '=', current.id).execute();
    return { id: current.id, reactivated: true };
  }

  async listMembers(user: AuthUser, orgId: string, requestId?: string) {
    if ((await this.actor(user, orgId, 'membership:read', false)).onboarding) {
      // D-04: sin elevación aprobada y vigente, sigue bloqueado. Con ella, SOLO lectura y **sin datos
      // personales**: el perfil adoptado excluye la identidad protegida, así que la plataforma ve la forma de
      // la organización —cuántas membresías, con qué roles y en qué estado—, no quiénes son.
      const elev = await this.elevation.vigente(user, orgId, 'members:read');
      if (!elev) this.elevationRequired();
      await this.elevation.registrarUso(user, orgId, elev.id, 'listado de miembros sin datos personales', requestId);
      const filas = await this.db
        .selectFrom('memberships as m')
        .select([
          'm.id as membership_id', 'm.status', 'm.status_reason',
          sql<string[]>`coalesce((select array_agg(ra.role_code order by ra.role_code) from role_assignments ra
            where ra.membership_id = m.id and ra.organization_id = m.organization_id), '{}')`.as('roles'),
        ])
        .where('m.organization_id', '=', orgId)
        .orderBy('m.id')
        .execute();
      return filas.map((f) => ({ ...f, redacted: true, note: 'Elevación de plataforma: sin nombres ni correos. No es acceso de miembro.' }));
    }
    return this.db
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select([
        'm.id as membership_id', 'u.id as user_id', 'u.email', 'u.first_name', 'u.last_name', 'u.email_verified_at',
        'm.status', 'm.status_reason', 'u.status as user_status',
        sql<string[]>`coalesce((select array_agg(ra.role_code order by ra.role_code) from role_assignments ra
          where ra.membership_id = m.id and ra.organization_id = m.organization_id), '{}')`.as('roles'),
      ])
      .where('m.organization_id', '=', orgId)
      .orderBy('u.last_name')
      .orderBy('u.id')
      .execute();
  }

  async changeMembership(user: AuthUser, orgId: string, membershipId: string, target: 'ACTIVE' | 'INACTIVE', reason: string, requestId?: string) {
    const a = await this.actor(user, orgId, 'membership:assign', true);
    if (a.onboarding) this.elevationRequired();
    const perms = a.perms;
    return this.db.transaction().execute(async (trx) => {
      const m = await trx
        .selectFrom('memberships')
        .select(['id', 'user_id', 'status'])
        .where('id', '=', membershipId)
        .where('organization_id', '=', orgId)
        .forUpdate()
        .executeTakeFirst();
      if (!m) throw notFound();
      if (m.user_id === user.id) throw conflict('SELF_MEMBERSHIP_CHANGE', 'No puedes desactivar ni reactivar tu propia membresía.');
      if (m.status === target) throw conflict('INVALID_TRANSITION', target === 'INACTIVE' ? 'La membresía ya está desactivada.' : 'La membresía ya está activa.');
      const roles = (await trx.selectFrom('role_assignments').select('role_code').where('membership_id', '=', m.id).execute()).map((r) => r.role_code);
      // Anti-escalamiento: no se gestiona a quien tiene permisos que el actor no posee.
      if (!roles.every((r) => canGrantRole(perms, r))) {
        throw forbidden('ROLE_NOT_GRANTABLE', 'No puedes gestionar a un miembro con permisos que no tienes.');
      }
      await trx
        .updateTable('memberships')
        .set({ status: target, status_reason: target === 'INACTIVE' ? reason : null, updated_by: user.id, updated_at: new Date() })
        .where('id', '=', m.id)
        .execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id,
        action: target === 'INACTIVE' ? 'membership.deactivate' : 'membership.reactivate',
        entityType: 'membership', entityId: m.id, requestId, result: 'SUCCESS', reason,
        before: { status: m.status, roles }, after: { status: target, roles },
      });
      return { membership_id: m.id, status: target };
    });
  }

  /**
   * Reemplaza los roles de un miembro. Anti-escalamiento: el actor debe poder conceder cada rol que
   * añade, que retira y que el miembro ya tiene. Nadie cambia sus propios roles. Efecto inmediato:
   * la autorización se recalcula en cada solicitud.
   */
  async changeRoles(user: AuthUser, orgId: string, membershipId: string, roles: string[], reason: string, requestId?: string) {
    const a = await this.actor(user, orgId, 'membership:assign', true);
    if (a.onboarding) this.elevationRequired();
    const target = [...new Set(roles)].sort();
    return this.db.transaction().execute(async (trx) => {
      const m = await trx
        .selectFrom('memberships')
        .select(['id', 'user_id', 'status'])
        .where('id', '=', membershipId)
        .where('organization_id', '=', orgId)
        .forUpdate()
        .executeTakeFirst();
      if (!m) throw notFound();
      if (m.user_id === user.id) throw conflict('SELF_ROLE_CHANGE', 'No puedes cambiar tus propios roles.');
      const current = (await trx.selectFrom('role_assignments').select('role_code')
        .where('membership_id', '=', m.id).where('organization_id', '=', orgId).execute())
        .map((r) => r.role_code).sort();
      const touched = [...new Set([...current, ...target])];
      if (!touched.every((r) => canGrantRole(a.perms, r))) {
        throw forbidden('ROLE_NOT_GRANTABLE', 'No puedes conceder ni retirar roles con permisos que no tienes.');
      }
      const added = target.filter((r) => !current.includes(r));
      const removed = current.filter((r) => !target.includes(r));
      if (added.length === 0 && removed.length === 0) throw conflict('NO_CHANGE', 'El miembro ya tiene exactamente esos roles.');
      if (removed.length) {
        await trx.deleteFrom('role_assignments')
          .where('membership_id', '=', m.id).where('organization_id', '=', orgId).where('role_code', 'in', removed).execute();
      }
      if (added.length) {
        await trx.insertInto('role_assignments')
          .values(added.map((role_code) => ({ organization_id: orgId, membership_id: m.id, role_code, created_by: user.id })))
          .execute();
      }
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'membership.roles_change', entityType: 'membership',
        entityId: m.id, requestId, result: 'SUCCESS', reason,
        before: { roles: current }, after: { roles: target, added, removed },
      });
      return { membership_id: m.id, roles: target };
    });
  }

  /** SUPER_ADMIN: desactiva/reactiva la cuenta global e invalida todas sus sesiones (token_version + 1). */
  async changeUser(user: AuthUser, userId: string, target: 'ACTIVE' | 'INACTIVE', reason: string, requestId?: string) {
    this.authz.requirePlatform(user, 'user:deactivate');
    if (userId === user.id) throw conflict('SELF_USER_CHANGE', 'No puedes desactivar tu propia cuenta.');
    return this.db.transaction().execute(async (trx) => {
      const u = await trx.selectFrom('users').select(['id', 'status']).where('id', '=', userId).forUpdate().executeTakeFirst();
      if (!u) throw notFound();
      if (u.status === target) throw conflict('INVALID_TRANSITION', 'La cuenta ya está en ese estado.');
      await trx
        .updateTable('users')
        .set({ status: target, token_version: sql`token_version + 1`, updated_at: new Date() })
        .where('id', '=', userId)
        .execute();
      await this.audit.record(trx, {
        actorUserId: user.id, action: target === 'INACTIVE' ? 'user.deactivate' : 'user.reactivate',
        entityType: 'user', entityId: userId, requestId, result: 'SUCCESS', reason,
        before: { status: u.status }, after: { status: target, sessions_revoked: true },
      });
      return { user_id: userId, status: target };
    });
  }
}

@ApiTags('members')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class MembersController {
  constructor(private readonly service: MembersService) {}

  @Get('assignable-roles')
  assignable(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.assignable(user, orgId);
  }

  @Get('members')
  members(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Req() req: AuthedRequest) {
    return this.service.listMembers(user, orgId, req.requestId);
  }

  @Post('members/:membershipId/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string, @Body() dto: ReasonDto, @Req() req: AuthedRequest,
  ) {
    return this.service.changeMembership(user, orgId, membershipId, 'INACTIVE', dto.reason, req.requestId);
  }

  @Post('members/:membershipId/reactivate')
  @HttpCode(200)
  reactivate(
    @CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string, @Body() dto: ReasonDto, @Req() req: AuthedRequest,
  ) {
    return this.service.changeMembership(user, orgId, membershipId, 'ACTIVE', dto.reason, req.requestId);
  }

  @Put('members/:membershipId/roles')
  changeRoles(
    @CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string, @Body() dto: ChangeRolesDto, @Req() req: AuthedRequest,
  ) {
    return this.service.changeRoles(user, orgId, membershipId, dto.roles, dto.reason, req.requestId);
  }

  @Get('invitations')
  invitations(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.listInvitations(user, orgId);
  }

  @Post('invitations')
  invite(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: CreateInvitationDto, @Req() req: AuthedRequest) {
    return this.service.createInvitation(user, orgId, dto, req.requestId);
  }

  @Post('invitations/:invitationId/revoke')
  @HttpCode(200)
  revoke(
    @CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string, @Req() req: AuthedRequest,
  ) {
    return this.service.revokeInvitation(user, orgId, invitationId, req.requestId);
  }
}

@ApiTags('invitations')
@Controller('api/v1/invitations')
export class InvitationsController {
  constructor(private readonly service: MembersService) {}

  // POST (no GET con query) para que el token no quede en logs de acceso ni en Referer.
  @Public()
  @Post('preview')
  @HttpCode(200)
  preview(@Body() dto: TokenDto, @Req() req: AuthedRequest) {
    return this.service.preview(dto.token, req.user);
  }

  @Public()
  @Post('accept')
  @HttpCode(200)
  accept(@Body() dto: AcceptInvitationDto, @Req() req: AuthedRequest) {
    return this.service.accept(dto, req.user, req.requestId);
  }
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('api/v1/users')
export class UsersController {
  constructor(private readonly service: MembersService) {}

  @Post(':userId/deactivate')
  @HttpCode(200)
  deactivate(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: ReasonDto, @Req() req: AuthedRequest) {
    return this.service.changeUser(user, userId, 'INACTIVE', dto.reason, req.requestId);
  }

  @Post(':userId/reactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() user: AuthUser, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: ReasonDto, @Req() req: AuthedRequest) {
    return this.service.changeUser(user, userId, 'ACTIVE', dto.reason, req.requestId);
  }
}
