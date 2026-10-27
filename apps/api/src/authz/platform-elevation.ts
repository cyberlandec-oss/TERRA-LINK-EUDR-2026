import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { verifyPassword } from '../auth/passwords';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AuthorizationService } from './authorization.service';

// D-04 — Elevación de plataforma **supervisada**. Contrato y políticas:
// `docs/decisiones/P0-003-CONCESIONES-Y-ELEVACION.md`.
//
// **Una elevación NO es una concesión.** La concesión la otorga el dueño sobre datos propios y apunta a un
// recurso concreto; la elevación la pide la plataforma, la **aprueba un ORG_ADMIN distinto** de la organización
// afectada, dura como mucho **15 minutos** y solo habilita acciones de un catálogo cerrado. Ningún camino de
// esta clase concede permisos de organización ni crea membresías.
//
// **Sin autoaprobación y sin excepción de emergencia** en esta entrega.

/** Catálogo CERRADO. `members:read` es la única acción, y solo de lectura. Ver la migración 0047. */
export const ACCIONES_ELEVABLES = ['members:read'] as const;
export type AccionElevable = (typeof ACCIONES_ELEVABLES)[number];

/** 15 minutos: decisión de diseño del MVP local, no una obligación deducida de las fuentes. */
export const MAX_DURACION_SEGUNDOS = 900;

class SolicitarDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ description: 'Contraseña del solicitante: la elevación exige comprobación reciente, no basta el token.' })
  @IsString() @Length(8, 200) password!: string;
  @ApiProperty() @IsString() @Length(3, 200) purpose!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
  @ApiProperty({ description: 'Recursos o ámbito concreto al que se limita el soporte.' })
  @IsString() @Length(3, 500) scope_note!: string;
  @ApiProperty({ enum: ACCIONES_ELEVABLES, isArray: true })
  @IsArray() @ArrayMinSize(1) @IsIn(ACCIONES_ELEVABLES, { each: true }) actions!: AccionElevable[];
  @ApiProperty({ description: 'Duración en segundos, máximo 900 (15 minutos).' })
  @IsInt() @Min(60) @Max(MAX_DURACION_SEGUNDOS) duration_seconds!: number;
}
class DecidirDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

@Injectable()
export class PlatformElevationService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- solicitar (SUPER_ADMIN)
  async solicitar(user: AuthUser, orgId: string, dto: SolicitarDto, requestId?: string) {
    this.authz.requirePlatform(user, 'organization:list_all');
    // La comprobación de contraseña queda ligada a ESTA sesión: sin identidad de sesión no se solicita.
    if (!user.sessionId) throw forbidden('SESSION_NOT_IDENTIFIED', 'Vuelve a iniciar sesión: tu sesión no está identificada.');
    // Comprobación RECIENTE de la contraseña: conocer un identificador de organización no basta.
    const cuenta = await this.db.selectFrom('users').select(['password_hash', 'status']).where('id', '=', user.id).executeTakeFirst();
    if (!cuenta || cuenta.status !== 'ACTIVE' || !(await verifyPassword(cuenta.password_hash, dto.password))) {
      throw forbidden('REAUTHENTICATION_REQUIRED', 'La elevación exige comprobar tu contraseña.');
    }
    const org = await this.db.selectFrom('organizations').select(['id', 'status']).where('id', '=', orgId).executeTakeFirst();
    if (!org) throw notFound();
    // Quien ya es miembro no necesita elevarse: usaría sus permisos, y mezclarlo abriría una vía paralela.
    if (await this.authz.tenantContext(user, orgId)) {
      throw new AppError(422, 'ELEVATION_NOT_NEEDED', 'Ya eres miembro de esa organización: usa tus permisos, no una elevación.', [{ field: 'organization', reason: 'es miembro' }]);
    }

    const id = randomUUID();
    try {
      await this.db.transaction().execute(async (trx) => {
        const previa = await trx.selectFrom('platform_elevations').select('id').where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
        if (previa) return;
        await trx.insertInto('platform_elevations').values({
          id, organization_id: orgId, requested_by: user.id, purpose: dto.purpose.trim(), reason: dto.reason.trim(),
          scope_note: dto.scope_note.trim(), actions: dto.actions, duration_seconds: dto.duration_seconds, status: 'PENDING',
          // La sesión que probó la contraseña es la única que podrá usar la elevación.
          session_id: user.sessionId, operation_id: dto.operation_id,
        } as never).execute();
        await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'elevation.request', entityType: 'platform_elevation', entityId: id, requestId, result: 'SUCCESS',
          after: { purpose: dto.purpose.trim(), scope_note: dto.scope_note.trim(), actions: dto.actions, duration_seconds: dto.duration_seconds, reason: dto.reason.trim() } });
      });
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'platform_elevations_viva_uq') {
        throw conflict('ELEVATION_ALREADY_OPEN', 'Ya tienes una elevación pendiente o activa en esa organización.');
      }
      throw e;
    }
    return { elevation: await this.ver(orgId, id) };
  }

  // ------------------------------------------------------------- aprobar / rechazar (ORG_ADMIN distinto)
  private async decidirCtx(user: AuthUser, orgId: string) {
    // El aprobador actúa con sus permisos de organización; la base además comprueba que es ORG_ADMIN activo.
    return this.authz.require(user, orgId, 'membership:assign', { mutation: true });
  }

  async aprobar(user: AuthUser, orgId: string, id: string, dto: DecidirDto, requestId?: string) {
    await this.decidirCtx(user, orgId);
    const salida = await this.db.transaction().execute(async (trx) => {
      const e = await trx.selectFrom('platform_elevations').selectAll().where('organization_id', '=', orgId).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!e) throw notFound('La solicitud de elevación no existe en tu organización.');
      if (e.status !== 'PENDING') throw conflict('ELEVATION_NOT_PENDING', `La solicitud ya está ${e.status}.`);
      if (e.requested_by === user.id) throw forbidden('SELF_APPROVAL_FORBIDDEN', 'Quien solicita una elevación no puede aprobarla.');
      // La sesión del solicitante queda ligada: si cierra sesión o se desactiva su cuenta, el acceso cae.
      const sol = await trx.selectFrom('users').select(['token_version', 'status']).where('id', '=', e.requested_by).executeTakeFirst();
      if (!sol || sol.status !== 'ACTIVE') throw conflict('REQUESTER_NOT_ACTIVE', 'La cuenta solicitante ya no está activa.');
      if (!e.session_id) throw conflict('SESSION_NOT_IDENTIFIED', 'La solicitud no tiene sesión ligada: no puede aprobarse.');
      const ahora = new Date();
      const vence = new Date(ahora.getTime() + e.duration_seconds * 1000);
      await trx.updateTable('platform_elevations').set({
        status: 'APPROVED', approved_by: user.id, approved_at: ahora, expires_at: vence, session_token_version: sol.token_version,
      } as never).where('id', '=', id).execute();
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'elevation.approve', entityType: 'platform_elevation', entityId: id, requestId, result: 'SUCCESS',
        after: { approved_for: e.requested_by, expires_at: vence.toISOString(), actions: e.actions, reason: dto.reason.trim() } });
      return vence;
    });
    return { elevation: await this.ver(orgId, id), expires_at: salida };
  }

  async rechazar(user: AuthUser, orgId: string, id: string, dto: DecidirDto, requestId?: string) {
    await this.decidirCtx(user, orgId);
    await this.db.transaction().execute(async (trx) => {
      const e = await trx.selectFrom('platform_elevations').selectAll().where('organization_id', '=', orgId).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!e) throw notFound('La solicitud de elevación no existe en tu organización.');
      if (e.status !== 'PENDING') throw conflict('ELEVATION_NOT_PENDING', `La solicitud ya está ${e.status}.`);
      await trx.updateTable('platform_elevations').set({ status: 'REJECTED', rejected_at: new Date(), reject_reason: dto.reason.trim() } as never).where('id', '=', id).execute();
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'elevation.reject', entityType: 'platform_elevation', entityId: id, requestId, result: 'SUCCESS', after: { reason: dto.reason.trim() } });
    });
    return { elevation: await this.ver(orgId, id) };
  }

  /** Revocación por el aprobador (o cualquier ORG_ADMIN de la organización): corta el acceso de inmediato. */
  async revocar(user: AuthUser, orgId: string, id: string, dto: DecidirDto, requestId?: string) {
    await this.decidirCtx(user, orgId);
    await this.db.transaction().execute(async (trx) => {
      const e = await trx.selectFrom('platform_elevations').selectAll().where('organization_id', '=', orgId).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!e) throw notFound('La solicitud de elevación no existe en tu organización.');
      if (e.status !== 'APPROVED') throw conflict('ELEVATION_NOT_ACTIVE', `La elevación está ${e.status}.`);
      await trx.updateTable('platform_elevations').set({ status: 'REVOKED', revoked_at: new Date(), revoked_by: user.id, revoke_reason: dto.reason.trim() } as never).where('id', '=', id).execute();
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'elevation.revoke', entityType: 'platform_elevation', entityId: id, requestId, result: 'SUCCESS', after: { reason: dto.reason.trim() } });
    });
    return { elevation: await this.ver(orgId, id) };
  }

  /** Finalización anticipada por el propio solicitante: no necesita a nadie para devolver el acceso. */
  async terminar(user: AuthUser, orgId: string, id: string, requestId?: string) {
    this.authz.requirePlatform(user, 'organization:list_all');
    await this.db.transaction().execute(async (trx) => {
      const e = await trx.selectFrom('platform_elevations').selectAll().where('organization_id', '=', orgId).where('id', '=', id).forUpdate().executeTakeFirst();
      // Solo la MISMA sesión que la solicitó puede terminarla: otra sesión de la cuenta no la gobierna.
      if (!e || e.requested_by !== user.id || !user.sessionId || e.session_id !== user.sessionId) throw notFound();
      if (e.status !== 'APPROVED') throw conflict('ELEVATION_NOT_ACTIVE', `La elevación está ${e.status}.`);
      await trx.updateTable('platform_elevations').set({ status: 'ENDED', ended_at: new Date() } as never).where('id', '=', id).execute();
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'elevation.end', entityType: 'platform_elevation', entityId: id, requestId, result: 'SUCCESS', after: { reason: 'finalización anticipada por el solicitante' } });
    });
    return { elevation: await this.ver(orgId, id) };
  }

  // ------------------------------------------------------------- uso
  /**
   * ¿Hay una elevación viva de este usuario sobre esta organización para esta acción? Revalida **todo** en cada
   * uso: estado, vencimiento con la hora del servidor, cuenta activa y **la sesión ligada**. Si el solicitante
   * cerró sesión o su cuenta se desactivó, su `token_version` cambió y la elevación deja de aplicar.
   */
  async vigente(user: AuthUser, orgId: string, accion: AccionElevable): Promise<{ id: string; scope_note: string } | null> {
    // Sin identidad de sesión no hay elevación posible: no se puede comprobar a quién pertenece.
    if (!user.sessionId) return null;
    const filas = await sql<{ id: string; scope_note: string }>`
      SELECT e.id, e.scope_note FROM platform_elevations e
      JOIN users u ON u.id = e.requested_by AND u.status = 'ACTIVE' AND u.token_version = e.session_token_version
      -- El aprobador debe SEGUIR siendo ORG_ADMIN activo: si pierde la condición habilitante, lo que aprobó
      -- deja de sostenerse.
      JOIN memberships am ON am.user_id = e.approved_by AND am.organization_id = e.organization_id AND am.status = 'ACTIVE'
      JOIN users au ON au.id = e.approved_by AND au.status = 'ACTIVE'
      JOIN role_assignments ara ON ara.membership_id = am.id AND ara.organization_id = am.organization_id AND ara.role_code = 'ORG_ADMIN'
      WHERE e.organization_id = ${orgId} AND e.requested_by = ${user.id}
        -- La SESION, no la cuenta: token_version es por cuenta y no distingue sesiones simultaneas.
        AND e.session_id = ${user.sessionId}
        AND e.status = 'APPROVED' AND e.expires_at > now() AND ${accion} = ANY(e.actions)
      LIMIT 1`.execute(this.db);
    return filas.rows[0] ?? null;
  }

  /** Deja constancia de CADA uso: una elevación sin rastro de uso no es supervisada. */
  async registrarUso(user: AuthUser, orgId: string, elevationId: string, detalle: string, requestId?: string) {
    await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'elevation.use', entityType: 'platform_elevation', entityId: elevationId, requestId, result: 'SUCCESS', after: { detalle } });
  }

  // ------------------------------------------------------------- consulta
  private async ver(orgId: string, id: string) {
    const e = await this.db.selectFrom('platform_elevations').selectAll().where('organization_id', '=', orgId).where('id', '=', id).executeTakeFirstOrThrow();
    return {
      id: e.id, status: this.estadoEfectivo(e), purpose: e.purpose, scope_note: e.scope_note, actions: e.actions,
      duration_seconds: e.duration_seconds, approved_at: e.approved_at, expires_at: e.expires_at, revoked_at: e.revoked_at, ended_at: e.ended_at,
    };
  }

  /** `APPROVED` con vencimiento pasado se informa como `EXPIRED`: el estado guardado no miente al lector. */
  private estadoEfectivo(e: { status: string; expires_at: unknown }) {
    if (e.status === 'APPROVED' && e.expires_at && new Date(e.expires_at as string).getTime() <= Date.now()) return 'EXPIRED';
    return e.status;
  }

  /**
   * **Visibilidad de la organización**: sus solicitudes y accesos de plataforma, legibles por quien administra
   * membresías. Una fila de auditoría escondida no sustituye esto.
   */
  async listarParaOrganizacion(user: AuthUser, orgId: string) {
    await this.authz.require(user, orgId, 'membership:read', { mutation: false });
    const filas = await sql<{ id: string; status: string; purpose: string; scope_note: string; actions: string[]; requested_by_name: string; approved_by_name: string | null; created_at: string; expires_at: string | null; usos: number }>`
      SELECT e.id, e.status, e.purpose, e.scope_note, e.actions,
             coalesce(r.first_name || ' ' || r.last_name, 'cuenta de plataforma') AS requested_by_name,
             (a.first_name || ' ' || a.last_name) AS approved_by_name,
             e.created_at::text, e.expires_at::text,
             (SELECT count(*)::int FROM audit_logs l WHERE l.entity_id = e.id AND l.action = 'elevation.use') AS usos
      FROM platform_elevations e
      JOIN users r ON r.id = e.requested_by
      LEFT JOIN users a ON a.id = e.approved_by
      WHERE e.organization_id = ${orgId} ORDER BY e.created_at DESC`.execute(this.db);
    return { elevations: filas.rows.map((e) => ({ ...e, status: this.estadoEfectivo(e as never) })) };
  }
}

@ApiTags('Autorización')
@Controller('api/v1/organizations/:orgId/platform-elevations')
export class PlatformElevationController {
  constructor(private readonly service: PlatformElevationService) {}

  @Post()
  @ApiOperation({ summary: 'Solicitar elevación de plataforma (D-04)',
    description: 'Solo SUPER_ADMIN, con comprobación reciente de contraseña. Queda PENDIENTE hasta que la apruebe un ORG_ADMIN distinto de la organización afectada. Máximo 15 minutos.' })
  solicitar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: SolicitarDto, @Req() req: AuthedRequest) {
    return this.service.solicitar(u, o, dto, req.requestId);
  }

  @Get()
  @ApiOperation({ summary: 'Solicitudes y accesos de plataforma sobre esta organización',
    description: 'Visibilidad para la organización afectada: quién pidió qué, con qué alcance, si se aprobó y cuántas veces se usó.' })
  listar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) {
    return this.service.listarParaOrganizacion(u, o);
  }

  @Post(':id/approve')
  aprobar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecidirDto, @Req() req: AuthedRequest) {
    return this.service.aprobar(u, o, id, dto, req.requestId);
  }

  @Post(':id/reject')
  rechazar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecidirDto, @Req() req: AuthedRequest) {
    return this.service.rechazar(u, o, id, dto, req.requestId);
  }

  @Post(':id/revoke')
  revocar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecidirDto, @Req() req: AuthedRequest) {
    return this.service.revocar(u, o, id, dto, req.requestId);
  }

  @Post(':id/end')
  @ApiOperation({ summary: 'Finalización anticipada por el propio solicitante' })
  terminar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.terminar(u, o, id, req.requestId);
  }
}
