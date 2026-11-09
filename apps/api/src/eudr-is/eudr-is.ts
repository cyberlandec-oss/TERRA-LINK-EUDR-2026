import { Body, Controller, Delete, Get, Inject, Injectable, Optional, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { randomUUID } from 'crypto';
import type { Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { PII_CIPHER, type PiiCipher } from '../crypto/pii';
import { ECHO_ENDPOINTS, callEcho, fetchTransport, type Environment, type SoapTransport } from './echo';
import type { ServiceCredentials } from './ws-security';

// P1-007 — Conector EUDR-IS. Esta entrega: credenciales cifradas por organización Y entorno + comprobación de conexión con el servicio Echo (ACCEPTANCE).
// NO presenta ninguna DDS. Echo acredita transporte y autenticación; no acredita el operador representado ni el contrato de la DDS.
export const ENVIRONMENTS: Environment[] = ['ACCEPTANCE', 'PRODUCTION'];
export const EUDR_IS_TRANSPORT = Symbol('EUDR_IS_TRANSPORT');
/** Interruptor de la plataforma: sin él NO sale ninguna llamada a EUDR-IS, aunque haya credenciales registradas. */
export const eudrIsLiveCalls = (env: NodeJS.ProcessEnv = process.env) => env.EUDR_IS_LIVE_CALLS === 'enabled';

/** Contexto de cifrado: una credencial no descifra para otra organización, otro entorno ni otro campo. */
export const credentialAad = (orgId: string, environment: Environment, field: 'username' | 'auth_key' | 'client_id') => `eudr_is_credentials:${orgId}:${environment}:${field}`;

export class SetEudrIsCredentialDto {
  @ApiProperty({ description: 'Usuario de servicios web (atributo «username» del perfil EU Login). Se cifra y nunca se devuelve.' }) @IsString() @MinLength(2) @MaxLength(200) username!: string;
  @ApiProperty({ description: 'Authentication Key del perfil (Web Services Access). Se cifra y nunca se devuelve.' }) @IsString() @MinLength(8) @MaxLength(512) authentication_key!: string;
  @ApiProperty({ description: 'WebServiceClientId. Se cifra y nunca se devuelve.' }) @IsString() @MinLength(2) @MaxLength(200) web_service_client_id!: string;
}

@Injectable()
export class EudrIsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    @Inject(PII_CIPHER) private readonly cipher: PiiCipher,
    @Optional() @Inject(EUDR_IS_TRANSPORT) private readonly transport: SoapTransport = fetchTransport,
  ) {}

  private env(e: string): Environment {
    if (!ENVIRONMENTS.includes(e as Environment)) throw new AppError(422, 'INVALID_ENVIRONMENT', 'El entorno debe ser ACCEPTANCE o PRODUCTION.');
    return e as Environment;
  }

  async status(user: AuthUser, orgId: string) {
    await this.authz.require(user, orgId, 'integration:read', { mutation: false });
    const rows = await this.db.selectFrom('eudr_is_credentials').select(['environment', 'created_at', 'rotated_at', 'registered_via']).where('organization_id', '=', orgId).execute();
    const checks = await this.db.selectFrom('eudr_is_echo_checks').select(['environment', 'outcome', 'http_status', 'detail', 'checked_at']).where('organization_id', '=', orgId).orderBy('checked_at', 'desc').limit(20).execute();
    return {
      live_calls_enabled: eudrIsLiveCalls(),
      environments: ENVIRONMENTS.map((e) => {
        const c = rows.find((r) => r.environment === e);
        const last = checks.find((k) => k.environment === e) ?? null;
        return {
          environment: e, configured: !!c, registered_at: c?.created_at ?? null, rotated_at: c?.rotated_at ?? null, registered_via: c?.registered_via ?? null,
          echo_documented: !!ECHO_ENDPOINTS[e],
          last_echo: last ? { outcome: last.outcome, http_status: last.http_status, detail: last.detail, checked_at: last.checked_at } : null,
        };
      }),
      note: 'Las credenciales se guardan cifradas y no se vuelven a mostrar. Registrarlas no activa llamadas: eso depende del interruptor de la plataforma. Echo comprueba conexión y credenciales; no acredita el operador representado ni una presentación de DDS.',
    };
  }

  async setCredential(user: AuthUser, orgId: string, environment: string, dto: SetEudrIsCredentialDto, requestId?: string) {
    await this.authz.require(user, orgId, 'integration:manage', { mutation: true });
    const env = this.env(environment);
    await this.store(orgId, env, { username: dto.username.trim(), authenticationKey: dto.authentication_key.trim(), clientId: dto.web_service_client_id.trim() }, 'API', user.id, requestId);
    return this.status(user, orgId);
  }

  /** Guarda (o rota) la credencial cifrada. Compartido con el cargador local; ni el valor ni su huella se registran. */
  async store(orgId: string, env: Environment, c: ServiceCredentials, via: 'API' | 'CLI', actorUserId: string | null, requestId?: string) {
    const username = this.cipher.encrypt(c.username, credentialAad(orgId, env, 'username'));
    const authKey = this.cipher.encrypt(c.authenticationKey, credentialAad(orgId, env, 'auth_key'));
    const clientId = this.cipher.encrypt(c.clientId, credentialAad(orgId, env, 'client_id'));
    await this.db.transaction().execute(async (trx) => {
      const prior = await trx.selectFrom('eudr_is_credentials').select('environment').where('organization_id', '=', orgId).where('environment', '=', env).executeTakeFirst();
      if (prior) {
        await trx.updateTable('eudr_is_credentials').set({ username_ciphertext: username, auth_key_ciphertext: authKey, client_id_ciphertext: clientId, registered_via: via, rotated_at: new Date() })
          .where('organization_id', '=', orgId).where('environment', '=', env).execute();
      } else {
        await trx.insertInto('eudr_is_credentials').values({ organization_id: orgId, environment: env, username_ciphertext: username, auth_key_ciphertext: authKey, client_id_ciphertext: clientId, registered_via: via, created_by: actorUserId }).execute();
      }
      await this.audit.record(trx, { organizationId: orgId, actorUserId, action: prior ? 'eudr_is.credential_rotated' : 'eudr_is.credential_registered', entityType: 'eudr_is_credential', entityId: null, requestId, result: 'SUCCESS', after: { environment: env, via } });
    });
  }

  async deleteCredential(user: AuthUser, orgId: string, environment: string, requestId?: string) {
    await this.authz.require(user, orgId, 'integration:manage', { mutation: true });
    const env = this.env(environment);
    await this.db.transaction().execute(async (trx) => {
      const r = await trx.deleteFrom('eudr_is_credentials').where('organization_id', '=', orgId).where('environment', '=', env).executeTakeFirst();
      if (Number(r.numDeletedRows) === 1) await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'eudr_is.credential_removed', entityType: 'eudr_is_credential', entityId: null, requestId, result: 'SUCCESS', after: { environment: env } });
    });
    return this.status(user, orgId);
  }

  private async load(orgId: string, env: Environment): Promise<ServiceCredentials | null> {
    const r = await this.db.selectFrom('eudr_is_credentials').select(['username_ciphertext', 'auth_key_ciphertext', 'client_id_ciphertext']).where('organization_id', '=', orgId).where('environment', '=', env).executeTakeFirst();
    if (!r) return null;
    return {
      username: this.cipher.decrypt(r.username_ciphertext, credentialAad(orgId, env, 'username')),
      authenticationKey: this.cipher.decrypt(r.auth_key_ciphertext, credentialAad(orgId, env, 'auth_key')),
      clientId: this.cipher.decrypt(r.client_id_ciphertext, credentialAad(orgId, env, 'client_id')),
    };
  }

  /** Comprobación de conexión (Echo). Solo ACCEPTANCE está documentado; exige credencial del mismo entorno y el interruptor de la plataforma. */
  async echo(user: AuthUser, orgId: string, environment: string, requestId?: string) {
    await this.authz.require(user, orgId, 'integration:manage', { mutation: true });
    const env = this.env(environment);
    if (!ECHO_ENDPOINTS[env]) throw new AppError(422, 'ECHO_NOT_DOCUMENTED_FOR_ENVIRONMENT', 'La Comisión documenta el servicio Echo solo para ACCEPTANCE. En PRODUCTION la conexión se comprobará con una consulta real y filtros restrictivos, cuando se autorice.');
    if (!eudrIsLiveCalls()) throw new AppError(409, 'EUDR_IS_LIVE_CALLS_DISABLED', 'Las llamadas a EUDR-IS están deshabilitadas en esta plataforma. Registrar credenciales no las activa.');
    const creds = await this.load(orgId, env);
    if (!creds) throw new AppError(409, 'EUDR_IS_CREDENTIAL_MISSING', 'Esta organización no tiene credenciales registradas para ese entorno.');
    const r = await callEcho(env, creds, this.transport);
    await this.db.insertInto('eudr_is_echo_checks').values({ id: randomUUID(), organization_id: orgId, environment: env, outcome: r.outcome, http_status: r.httpStatus, detail: r.detail, requested_by: user.id }).execute();
    await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'eudr_is.echo', entityType: 'eudr_is_credential', entityId: null, requestId, result: r.outcome === 'OK' ? 'SUCCESS' : 'FAILED', after: { environment: env, outcome: r.outcome, http_status: r.httpStatus } });
    return {
      environment: env, outcome: r.outcome, http_status: r.httpStatus, detail: r.detail,
      meaning: r.outcome === 'OK'
        ? 'Conexión y credenciales aceptadas por el servicio Echo. No acredita el operador representado ni una presentación de DDS.'
        : 'La comprobación no fue satisfactoria. No se ha enviado ninguna declaración.',
    };
  }
}

@ApiTags('eudr-is')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/eudr-is')
export class EudrIsController {
  constructor(private readonly service: EudrIsService) {}

  @Get('credentials')
  status(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) { return this.service.status(user, orgId); }

  @Put('credentials/:environment')
  set(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('environment') environment: string, @Body() dto: SetEudrIsCredentialDto, @Req() req: AuthedRequest) {
    return this.service.setCredential(user, orgId, environment, dto, req.requestId);
  }

  @Delete('credentials/:environment')
  remove(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('environment') environment: string, @Req() req: AuthedRequest) {
    return this.service.deleteCredential(user, orgId, environment, req.requestId);
  }

  @Post('echo/:environment')
  echo(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('environment') environment: string, @Req() req: AuthedRequest) {
    return this.service.echo(user, orgId, environment, req.requestId);
  }
}

