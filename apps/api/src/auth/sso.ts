import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Logger, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import { custom, generators, Issuer, type BaseClient } from 'openid-client';
import { sql, type Kysely } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, forbidden, notFound, unauthenticated } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Public, issueAccessToken, type AuthUser, type AuthedRequest } from './auth';

// P1-015 / D-54 — Acceso federado OIDC: Authorization Code + PKCE (S256), con Keycloak autoalojado como proveedor
// local de ensayo (ADR-0008).
//
// QUÉ HACE Y QUÉ NO
//   · Reutiliza la identidad, las sesiones, los permisos y la auditoría actuales: al terminar emite el MISMO testigo
//     de acceso que el inicio de sesión local, que sigue disponible como alternativa.
//   · La identidad externa se vincula por EMISOR + SUJETO. NUNCA por correo: un correo que coincida con una cuenta
//     local no vincula nada ni concede acceso.
//   · La autenticación externa NO concede organización, rol ni permiso: eso lo siguen decidiendo las membresías.
//   · Un inicio de sesión de una identidad sin vínculo se rechaza (403 SSO_IDENTITY_NOT_LINKED); se vincula desde
//     una sesión ya iniciada de la propia persona (modo LINK).
//   · El protocolo lo implementa `openid-client` (certificado OpenID, mantenido): state, nonce, PKCE, firma del
//     token, emisor, audiencia y caducidad se comprueban ahí; este módulo añade la lista cerrada de destinos de
//     retorno, el estado de un solo uso y el vínculo por emisor+sujeto.
//   · No conecta con proveedores de clientes reales: el emisor es el configurado en el despliegue.

const MAX_FLUJOS_ABIERTOS = 5000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

class StartDto {
  @ApiProperty({ description: 'Destino de retorno: debe coincidir EXACTAMENTE con uno de los permitidos' })
  @IsString() @MaxLength(500) redirect_uri!: string;
  @ApiProperty({ required: false, enum: ['LOGIN', 'LINK'] }) @IsOptional() @IsIn(['LOGIN', 'LINK']) mode?: 'LOGIN' | 'LINK';
}
class CallbackDto {
  @ApiProperty() @IsString() @Length(1, 2000) code!: string;
  @ApiProperty() @IsString() @Length(16, 300) state!: string;
  @ApiProperty({ required: false, description: 'Emisor devuelto en la respuesta de autorización (RFC 9207); obligatorio si el proveedor lo declara' })
  @IsOptional() @IsString() @MaxLength(2000) iss?: string;
}

@Injectable()
export class SsoService {
  private readonly logger = new Logger('SsoService');
  private cache: { client: BaseClient; endSession: string | null; at: number } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  private habilitado() {
    if (!this.config.sso.enabled) {
      throw new AppError(404, 'SSO_NOT_ENABLED', 'El acceso federado no está habilitado en este despliegue.');
    }
  }

  /** Descubre el proveedor (con caché breve) y comprueba que su emisor es el configurado. */
  private async cliente() {
    const c = this.config.sso;
    if (this.cache && Date.now() - this.cache.at < 10 * 60_000) return this.cache;
    let issuer: Issuer;
    try {
      issuer = await Issuer.discover(c.discoveryUrl);
    } catch (err) {
      this.logger.error(`descubrimiento OIDC fallido: ${err instanceof Error ? err.name : 'error'}`);
      throw new AppError(503, 'SSO_PROVIDER_UNAVAILABLE', 'El proveedor de acceso no está disponible. Usa el acceso con contraseña o inténtalo más tarde.');
    }
    // El emisor declarado por el proveedor debe ser el configurado: si no, un descubrimiento redirigido
    // podría hacer confiar en otro emisor.
    if (issuer.metadata.issuer !== c.issuer) {
      this.logger.error('el emisor descubierto no coincide con el configurado');
      throw new AppError(503, 'SSO_PROVIDER_MISCONFIGURED', 'El proveedor de acceso no coincide con la configuración. Contacta con el administrador.');
    }
    const client = new issuer.Client({
      client_id: c.clientId,
      ...(c.clientSecret ? { client_secret: c.clientSecret } : {}),
      redirect_uris: c.redirectUris,
      response_types: ['code'],
      token_endpoint_auth_method: c.clientSecret ? 'client_secret_basic' : 'none',
      id_token_signed_response_alg: 'RS256',
    });
    client[custom.clock_tolerance] = c.clockToleranceSeconds;
    this.cache = { client, endSession: (issuer.metadata.end_session_endpoint as string | undefined) ?? null, at: Date.now() };
    return this.cache;
  }

  publico() {
    return {
      enabled: this.config.sso.enabled,
      label: this.config.sso.enabled ? this.config.sso.label : null,
      method: 'OIDC Authorization Code + PKCE',
      local_login_available: true,
    };
  }

  async iniciar(dto: StartDto, user: AuthUser | undefined) {
    this.habilitado();
    const mode = dto.mode ?? 'LOGIN';
    if (mode === 'LINK' && !user) throw unauthenticated();
    // Lista cerrada: coincidencia exacta, sin comodines ni prefijos.
    if (!this.config.sso.redirectUris.includes(dto.redirect_uri)) {
      throw new AppError(422, 'SSO_REDIRECT_NOT_ALLOWED', 'Ese destino de retorno no está permitido.', [{ field: 'redirect_uri', reason: 'SSO_REDIRECT_NOT_ALLOWED' }]);
    }
    const { client } = await this.cliente();
    const state = generators.state();
    const nonce = generators.nonce();
    const verifier = generators.codeVerifier();
    const ttl = this.config.sso.flowTtlSeconds;
    await this.db.deleteFrom('sso_flows').where('expires_at', '<', new Date()).execute();
    // Ruta pública: un tope de inicios en curso evita llenar la tabla con peticiones anónimas.
    const abiertos = await this.db.selectFrom('sso_flows').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    if (Number(abiertos.n) >= MAX_FLUJOS_ABIERTOS) {
      throw new AppError(429, 'SSO_TOO_MANY_FLOWS', 'Hay demasiados inicios de sesión federados en curso. Espera unos minutos e inténtalo de nuevo.');
    }
    await this.db.insertInto('sso_flows').values({
      state_hash: sha256(state), mode, user_id: mode === 'LINK' ? user!.id : null, nonce, code_verifier: verifier,
      redirect_uri: dto.redirect_uri, expires_at: new Date(Date.now() + ttl * 1000),
    }).execute();
    const url = client.authorizationUrl({
      scope: this.config.sso.scope, redirect_uri: dto.redirect_uri, state, nonce,
      code_challenge: generators.codeChallenge(verifier), code_challenge_method: 'S256',
    });
    return { authorization_url: url, expires_in: ttl, mode };
  }

  async completar(dto: CallbackDto, user: AuthUser | undefined, requestId?: string) {
    this.habilitado();
    // De un solo uso: se consume al leerlo. Reutilizar un state falla.
    const flow = (await sql<{ mode: 'LOGIN' | 'LINK'; user_id: string | null; nonce: string; code_verifier: string; redirect_uri: string; expires_at: Date }>`
      DELETE FROM sso_flows WHERE state_hash = ${sha256(dto.state)} RETURNING mode, user_id, nonce, code_verifier, redirect_uri, expires_at`
      .execute(this.db)).rows[0];
    if (!flow || new Date(flow.expires_at).getTime() < Date.now()) {
      throw new AppError(400, 'SSO_FLOW_INVALID', 'El inicio de sesión federado venció o ya se usó. Empieza de nuevo.');
    }
    if (flow.mode === 'LINK' && (!user || user.id !== flow.user_id)) throw forbidden('SSO_LINK_SESSION_MISMATCH', 'Este vínculo debe completarse desde la misma sesión que lo inició.');

    const { client } = await this.cliente();
    let claims: { iss: string; sub: string; email?: unknown };
    try {
      // `iss` (RFC 9207) protege contra la confusión de emisor: si el proveedor lo declara, la librería exige que llegue
      // y que sea el suyo.
      const tokens = await client.callback(flow.redirect_uri, { code: dto.code, state: dto.state, ...(dto.iss ? { iss: dto.iss } : {}) },
        { code_verifier: flow.code_verifier, state: dto.state, nonce: flow.nonce });
      claims = tokens.claims() as typeof claims;
    } catch (err) {
      // No se devuelve el detalle del protocolo al cliente: queda solo en el registro del servidor.
      this.logger.warn(`request_id=${requestId} callback OIDC rechazado: ${err instanceof Error ? `${err.name}: ${err.message}` : 'error'}`);
      throw new AppError(401, 'SSO_PROTOCOL_ERROR', 'No se pudo verificar la respuesta del proveedor de acceso.');
    }
    if (!claims.iss || !claims.sub) throw new AppError(401, 'SSO_PROTOCOL_ERROR', 'No se pudo verificar la respuesta del proveedor de acceso.');
    const emailClaim = typeof claims.email === 'string' ? claims.email.slice(0, 254) : null;

    if (flow.mode === 'LINK') return this.vincular(user!, claims.iss, claims.sub, emailClaim, requestId);

    const link = await this.db.selectFrom('identity_links').select(['id', 'user_id'])
      .where('issuer', '=', claims.iss).where('subject', '=', claims.sub).where('unlinked_at', 'is', null).executeTakeFirst();
    if (!link) {
      // Nunca se busca por correo: aunque exista una cuenta con ese correo, no se vincula ni se entra.
      throw forbidden('SSO_IDENTITY_NOT_LINKED', 'Tu identidad corporativa no está vinculada a ninguna cuenta de Terra Link. Inicia sesión con contraseña y vincúlala desde tu perfil.');
    }
    const u = await this.db.selectFrom('users').select(['id', 'status', 'token_version']).where('id', '=', link.user_id).executeTakeFirst();
    if (!u || u.status !== 'ACTIVE') {
      await this.audit.record(this.db, { actorUserId: link.user_id, action: 'auth.sso_login', entityType: 'user', entityId: link.user_id, requestId, result: 'DENIED' });
      throw forbidden('SSO_ACCOUNT_DISABLED', 'Esta cuenta está deshabilitada.');
    }
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('identity_links').set({ last_login_at: new Date() }).where('id', '=', link.id).execute();
      await trx.updateTable('users').set({ last_login_at: new Date() }).where('id', '=', u.id).execute();
      await this.audit.record(trx, { actorUserId: u.id, action: 'auth.sso_login', entityType: 'user', entityId: u.id, requestId, result: 'SUCCESS', after: { issuer: claims.iss } });
    });
    return { mode: 'LOGIN' as const, ...issueAccessToken(this.config, u.id, u.token_version, 'sso') };
  }

  private async vincular(user: AuthUser, issuer: string, subject: string, emailClaim: string | null, requestId?: string) {
    const propio = await this.db.selectFrom('identity_links').select('id')
      .where('user_id', '=', user.id).where('issuer', '=', issuer).where('unlinked_at', 'is', null).executeTakeFirst();
    if (propio) throw conflict('SSO_USER_ALREADY_LINKED', 'Tu cuenta ya tiene una identidad vinculada con este proveedor. Desvincúlala primero.');
    const ajeno = await this.db.selectFrom('identity_links').select('id')
      .where('issuer', '=', issuer).where('subject', '=', subject).where('unlinked_at', 'is', null).executeTakeFirst();
    if (ajeno) throw conflict('SSO_IDENTITY_ALREADY_LINKED', 'Esa identidad ya está vinculada a otra cuenta.');
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('identity_links').values({ id, user_id: user.id, issuer, subject, email_claim: emailClaim, last_login_at: null, unlinked_at: null }).execute();
      await this.audit.record(trx, { actorUserId: user.id, action: 'auth.sso_linked', entityType: 'identity_link', entityId: id, requestId, result: 'SUCCESS', after: { issuer } });
    });
    return { mode: 'LINK' as const, linked: true, link_id: id, issuer };
  }

  async vinculos(user: AuthUser) {
    const filas = await this.db.selectFrom('identity_links').select(['id', 'issuer', 'subject', 'email_claim', 'created_at', 'last_login_at'])
      .where('user_id', '=', user.id).where('unlinked_at', 'is', null).orderBy('created_at').execute();
    return {
      links: filas.map((f) => ({
        id: f.id, issuer: f.issuer, subject_hint: `…${f.subject.slice(-6)}`, email_claim: f.email_claim,
        created_at: f.created_at, last_login_at: f.last_login_at,
      })),
      note: 'El vínculo se establece por emisor y sujeto, no por correo. El correo que declara el proveedor es solo informativo.',
    };
  }

  async desvincular(user: AuthUser, id: string, requestId?: string) {
    const r = await this.db.updateTable('identity_links').set({ unlinked_at: new Date() })
      .where('id', '=', id).where('user_id', '=', user.id).where('unlinked_at', 'is', null).executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw notFound();
    await this.audit.record(this.db, { actorUserId: user.id, action: 'auth.sso_unlinked', entityType: 'identity_link', entityId: id, requestId, result: 'SUCCESS' });
    return { unlinked: true };
  }

  /** Cierra ESTA sesión (por `jti`) y, si entró por el proveedor federado, ofrece cerrar también su sesión allí. */
  async cerrarSesion(user: AuthUser, requestId?: string) {
    if (user.sessionId) {
      await this.db.insertInto('revoked_sessions').values({ jti: user.sessionId, user_id: user.id }).onConflict((oc) => oc.doNothing()).execute();
    } else {
      // Testigo anterior a la identidad de sesión: la única forma de cerrarlo es invalidar las sesiones de la cuenta.
      await this.db.updateTable('users').set({ token_version: sql`token_version + 1` }).where('id', '=', user.id).execute();
    }
    await this.audit.record(this.db, { actorUserId: user.id, action: 'auth.logout', entityType: 'user', entityId: user.id, requestId, result: 'SUCCESS', after: { method: user.method } });
    let sso_end_session_url: string | null = null;
    if (user.method === 'sso' && this.config.sso.enabled) {
      try {
        const { endSession } = await this.cliente();
        if (endSession) {
          const u = new URL(endSession);
          u.searchParams.set('client_id', this.config.sso.clientId);
          u.searchParams.set('post_logout_redirect_uri', `${this.config.webOrigin.replace(/\/$/, '')}/`);
          sso_end_session_url = u.toString();
        }
      } catch { /* si el proveedor no responde, la sesión local ya está cerrada */ }
    }
    return { logged_out: true, sso_end_session_url };
  }
}

@ApiTags('auth')
@Controller('api/v1/auth')
export class SsoController {
  constructor(private readonly service: SsoService) {}

  @Public()
  @Get('sso/config')
  @ApiOperation({ summary: 'Si hay acceso federado en este despliegue (sin secretos ni datos del proveedor)' })
  config() { return this.service.publico(); }

  @Public()
  @Post('sso/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Iniciar el flujo OIDC (Authorization Code + PKCE). LINK exige sesión' })
  iniciar(@Body() dto: StartDto, @Req() req: AuthedRequest) { return this.service.iniciar(dto, req.user); }

  @Public()
  @Post('sso/callback')
  @HttpCode(200)
  @ApiOperation({ summary: 'Completar el flujo: verifica el protocolo y emite el mismo testigo que el acceso local' })
  completar(@Body() dto: CallbackDto, @Req() req: AuthedRequest) { return this.service.completar(dto, req.user, req.requestId); }

  @ApiBearerAuth()
  @Get('sso/links')
  @ApiOperation({ summary: 'Identidades externas vinculadas a mi cuenta' })
  vinculos(@CurrentUser() u: AuthUser) { return this.service.vinculos(u); }

  @ApiBearerAuth()
  @Delete('sso/links/:id')
  @ApiOperation({ summary: 'Desvincular una identidad externa de mi cuenta' })
  desvincular(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.desvincular(u, id, req.requestId);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cerrar esta sesión (las demás sesiones de la cuenta no se tocan)' })
  cerrar(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest) { return this.service.cerrarSesion(u, req.requestId); }
}
