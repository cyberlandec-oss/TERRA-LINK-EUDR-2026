import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiPropertyOptional, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AuthorizationService } from './authorization.service';
import type { Permission } from './catalog';
import { referenciaDe } from '../traceability/public-references';
import { DdService } from '../dd/dd';
import { evaluateRequirements } from '../dd/requirements';
import { indicadoresDe, periodoDeProduccion } from '../sharing/indicadores';

// P0-003 / D-P0003.1 opción A — Concesiones externas de LECTURA y DESCARGA, sin portal comprador.
//
// Una concesión **no crea membresía, no asigna roles y no da acceso general**. La vía del concesionario
// (`/api/v1/granted/...`) **no consulta membresías en absoluto**: consulta la concesión, el vencimiento y la
// revocación, en **cada** acceso y en **cada** descarga. Por eso una segunda membresía no puede hacerse pasar
// por una concesión.
//
// A-02 (2026-10-21) — administración WEB de concesiones. La pantalla reutiliza esta API y `grant:manage`; no amplía permisos. Novedades de contrato:
//   · el destinatario se identifica por su CORREO EXACTO (`grantee_email`), sin buscador, lista ni autocompletado; «no existe» y «no está disponible»
//     responden lo mismo, y los intentos fallidos se auditan y se limitan por persona (10 por hora);
//   · `GET …/access-grants/shareable` ofrece solo los recursos que quien concede PUEDE leer (no se concede lo que no se tiene);
//   · `GET …/access-grants` añade código del recurso, quién concedió/revocó, cuándo y el motivo.
//
// Lo que esta entrega NO hace: no construye el portal comprador (RF-32/P1-001), no introduce elevación de
// plataforma —D-04 sigue pendiente y no se cierra por omisión—, no crea permisos para `BUYER` ni para
// `SUPER_ADMIN`, y no infiere acceso por identidad (ni correo, ni nombre, ni país).

type Tipo = 'LOT' | 'SHIPMENT' | 'DD_SNAPSHOT';

/** Permiso que el CONCEDENTE debe tener para poder conceder lectura de cada tipo: no se concede lo que no se tiene. */
const LECTURA: Record<Tipo, Permission> = { LOT: 'lot:read', SHIPMENT: 'shipment:read', DD_SNAPSHOT: 'dd:read' };

class CrearConcesionDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiPropertyOptional({ description: 'Cuenta destinataria, existente y activa. No se crea ni se invita desde aquí. Alternativa a `grantee_email`.' })
  @IsOptional() @IsUUID() grantee_user_id?: string;
  @ApiPropertyOptional({ description: 'Correo EXACTO de la cuenta destinataria (alternativa a `grantee_user_id`). No hay búsqueda ni lista: si no se puede identificar una cuenta activa, la respuesta es la misma.' })
  @IsOptional() @IsEmail() @Length(3, 254) grantee_email?: string;
  @ApiProperty({ enum: ['LOT', 'SHIPMENT', 'DD_SNAPSHOT'] }) @IsIn(['LOT', 'SHIPMENT', 'DD_SNAPSHOT']) resource_type!: Tipo;
  @ApiProperty({ description: 'Instancia concreta. No se admiten comodines ni alcances por organización.' })
  @IsUUID() resource_id!: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() can_read?: boolean;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() can_download?: boolean;
  @ApiProperty({ description: 'Vencimiento obligatorio, en el futuro. No existe la concesión indefinida.' })
  @IsISO8601() expires_at!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

class RevocarDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

@Injectable()
export class AccessGrantsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    /** RF-32: los indicadores salen de la MISMA evaluación del expediente, no de un motor paralelo. */
    private readonly dd: DdService,
  ) {}

  /** Lo mismo para «no existe» y «no te corresponde»: una concesión no es un oráculo de existencia. */
  private get opaca() {
    return notFound('No hay ningún recurso concedido a tu cuenta con ese identificador.');
  }

  // --------------------------------------------------------------- lado del CONCEDENTE
  async crear(user: AuthUser, orgId: string, dto: CrearConcesionDto, requestId?: string) {
    const ctx = await this.authz.require(user, orgId, 'grant:manage', { mutation: true });

    // 1) No se concede lo que no se tiene: el concedente necesita autorización efectiva sobre el recurso y la acción.
    const quiereLeer = dto.can_read !== false;
    const quiereDescargar = dto.can_download === true;
    if (quiereLeer && !ctx.permissions.includes(LECTURA[dto.resource_type])) {
      throw forbidden('GRANT_BEYOND_GRANTOR', 'No puedes conceder una lectura que tú no tienes sobre ese recurso.');
    }
    // DESCARGA adoptada (2026-10-17): es un **archivo interno de la MISMA proyección** que el destinatario ya
    // puede leer, no el paquete final. Por eso basta con que el concedente pueda conceder esa lectura; no se
    // exige una facultad de exportación, porque no se exporta el paquete. El contenido lo produce `leer()`:
    // una sola proyección, sin una segunda más amplia.
    if (quiereDescargar && !ctx.permissions.includes(LECTURA[dto.resource_type])) {
      throw forbidden('GRANT_BEYOND_GRANTOR', 'No puedes conceder una descarga de algo que tú no puedes leer.');
    }

    // 2) Vencimiento obligatorio y futuro.
    const vence = new Date(dto.expires_at);
    if (Number.isNaN(vence.getTime()) || vence.getTime() <= Date.now()) {
      throw new AppError(422, 'GRANT_EXPIRY_INVALID', 'El vencimiento debe ser una fecha futura.', [{ field: 'expires_at', reason: 'no futura' }]);
    }

    // 3) Destinatario: cuenta existente y activa. No se crea ni se invita desde aquí, y no se infiere por identidad.
    if (!!dto.grantee_user_id === !!dto.grantee_email) {
      throw new AppError(422, 'GRANTEE_REQUIRED', 'Indica la cuenta destinataria por su correo exacto.', [{ field: 'grantee_email', reason: 'indica uno solo' }]);
    }
    const granteeId = dto.grantee_email ? await this.resolverCorreo(user, orgId, dto.grantee_email, requestId) : dto.grantee_user_id!;
    const destinatario = await this.db.selectFrom('users').select(['id', 'status']).where('id', '=', granteeId).executeTakeFirst();
    if (!destinatario) throw new AppError(422, 'REFERENCE_NOT_FOUND', 'La cuenta destinataria no existe.', [{ field: 'grantee_user_id', reason: 'no existe' }]);
    if (destinatario.status !== 'ACTIVE') throw new AppError(422, 'GRANTEE_NOT_ACTIVE', 'La cuenta destinataria no está activa.', [{ field: 'grantee_user_id', reason: destinatario.status }]);
    if (destinatario.id === user.id) throw new AppError(422, 'GRANT_TO_SELF', 'No tiene sentido concederte acceso a ti mismo.', [{ field: 'grantee_user_id', reason: 'es quien concede' }]);

    const id = randomUUID();
    try {
      await this.db.transaction().execute(async (trx) => {
        const previa = await trx.selectFrom('access_grants').select('id').where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
        if (previa) return; // reintento idempotente
        await trx.insertInto('access_grants').values({
          id, organization_id: orgId, grantee_user_id: granteeId, resource_type: dto.resource_type, resource_id: dto.resource_id,
          can_read: quiereLeer, can_download: quiereDescargar, expires_at: vence, reason: dto.reason.trim(),
          granted_by: user.id, operation_id: dto.operation_id,
        }).execute();
        await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'grant.create', entityType: 'access_grant', entityId: id, requestId, result: 'SUCCESS',
          after: { resource_type: dto.resource_type, resource_id: dto.resource_id, grantee_user_id: granteeId, can_read: quiereLeer, can_download: quiereDescargar, expires_at: vence.toISOString(), reason: dto.reason.trim() } });
      });
    } catch (e) {
      const c = (e as { constraint?: string }).constraint;
      if (c === 'access_grants_activa_uq') throw conflict('GRANT_ALREADY_ACTIVE', 'Ya hay una concesión activa para esa cuenta sobre ese recurso. Revócala antes de conceder otra.');
      if (c === 'access_grants_operacion_uq') throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó para otra concesión.');
      // El disparador de correspondencia es la última defensa: nadie concede un recurso que no es suyo. Se
      // traduce a 422 para que la respuesta diga qué pasó, en vez de un 500 opaco.
      if (/no pertenece a la organizacion/.test((e as Error).message ?? '')) {
        throw new AppError(422, 'REFERENCE_NOT_FOUND', 'El recurso no pertenece a tu organización.', [{ field: 'resource_id', reason: 'de otra organización' }]);
      }
      throw e;
    }
    return { grant: await this.ver(orgId, dto.operation_id) };
  }

  async revocar(user: AuthUser, orgId: string, id: string, dto: RevocarDto, requestId?: string) {
    const ctx = await this.authz.require(user, orgId, 'grant:manage', { mutation: true });
    await this.db.transaction().execute(async (trx) => {
      const g = await trx.selectFrom('access_grants').selectAll().where('organization_id', '=', ctx.organizationId).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!g) throw notFound('La concesión no existe en tu organización.');
      if (g.revoked_at) return; // revocar dos veces no es un error: ya no concede nada
      await trx.updateTable('access_grants').set({ revoked_at: new Date(), revoked_by: user.id, revoke_reason: dto.reason.trim() } as never).where('id', '=', id).execute();
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'grant.revoke', entityType: 'access_grant', entityId: id, requestId, result: 'SUCCESS',
        after: { reason: dto.reason.trim() } });
    });
    return { grant: await this.verPorId(orgId, id) };
  }

  /**
   * Identifica al destinatario por su correo exacto SIN permitir enumerar cuentas: quien no encuentra a nadie recibe siempre la
   * misma respuesta (no existe, está inactiva o no se puede conceder), cada fallo queda auditado sin guardar el correo en claro y
   * cada persona tiene un máximo de intentos fallidos por hora.
   */
  private async resolverCorreo(user: AuthUser, orgId: string, correo: string, requestId?: string): Promise<string> {
    const fallos = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM audit_logs
      WHERE organization_id = ${orgId} AND actor_user_id = ${user.id} AND action = 'grant.recipient_unavailable' AND occurred_at > now() - interval '1 hour'`.execute(this.db);
    if ((fallos.rows[0]?.n ?? 0) >= 10) {
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos con destinatarios no disponibles. Espera un rato antes de volver a intentarlo.');
    }
    const email = correo.trim().toLowerCase();
    const u = await sql<{ id: string }>`SELECT id FROM users WHERE lower(email) = ${email} AND status = 'ACTIVE' LIMIT 1`.execute(this.db);
    if (!u.rows[0]) {
      await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'grant.recipient_unavailable', entityType: 'access_grant', entityId: null, requestId, result: 'DENIED',
        after: { email_sha256_prefix: createHash('sha256').update(email).digest('hex').slice(0, 12) } });
      throw new AppError(422, 'GRANTEE_NOT_AVAILABLE', 'No se pudo identificar una cuenta destinataria disponible con ese correo. Revisa que sea el correo exacto de una cuenta activa.', [{ field: 'grantee_email', reason: 'no disponible' }]);
    }
    return u.rows[0].id;
  }

  async listar(user: AuthUser, orgId: string) {
    const ctx = await this.authz.require(user, orgId, 'grant:manage', { mutation: false });
    const filas = await sql<{ id: string; grantee_user_id: string; grantee_email: string; resource_type: Tipo; resource_id: string; resource_label: string | null; can_read: boolean; can_download: boolean; expires_at: string; revoked_at: string | null; reason: string; created_at: string; granted_by_name: string | null; revoked_by_name: string | null; revoke_reason: string | null }>`
      SELECT g.id, g.grantee_user_id, u.email AS grantee_email, g.resource_type, g.resource_id,
             COALESCE(l.lot_code, s.shipment_code, CASE WHEN sn.id IS NOT NULL THEN c.case_number || ' · instantánea ' || sn.snapshot_number END) AS resource_label,
             g.can_read, g.can_download, g.expires_at::text, g.revoked_at::text, g.reason, g.created_at::text,
             NULLIF(trim(coalesce(gb.first_name, '') || ' ' || coalesce(gb.last_name, '')), '') AS granted_by_name,
             NULLIF(trim(coalesce(rb.first_name, '') || ' ' || coalesce(rb.last_name, '')), '') AS revoked_by_name,
             g.revoke_reason
      FROM access_grants g JOIN users u ON u.id = g.grantee_user_id
      LEFT JOIN users gb ON gb.id = g.granted_by LEFT JOIN users rb ON rb.id = g.revoked_by
      LEFT JOIN lots l ON g.resource_type = 'LOT' AND l.id = g.resource_id AND l.organization_id = g.organization_id
      LEFT JOIN shipments s ON g.resource_type = 'SHIPMENT' AND s.id = g.resource_id AND s.organization_id = g.organization_id
      LEFT JOIN dd_snapshots sn ON g.resource_type = 'DD_SNAPSHOT' AND sn.id = g.resource_id AND sn.organization_id = g.organization_id
      LEFT JOIN dd_cases c ON c.id = sn.case_id
      WHERE g.organization_id = ${ctx.organizationId} ORDER BY g.created_at DESC`.execute(this.db);
    return { grants: filas.rows.map((g) => ({ ...g, estado: this.estado(g) })) };
  }

  /** Recursos que ESTA persona puede compartir: solo los que puede leer (no se concede lo que no se tiene). Sin comodines. */
  async compartibles(user: AuthUser, orgId: string, tipo: string) {
    const ctx = await this.authz.require(user, orgId, 'grant:manage', { mutation: false });
    if (!['LOT', 'SHIPMENT', 'DD_SNAPSHOT'].includes(tipo)) throw new AppError(422, 'VALIDATION_FAILED', 'Tipo de recurso no admitido.', [{ field: 'type', reason: 'LOT, SHIPMENT o DD_SNAPSHOT' }]);
    const t = tipo as Tipo;
    if (!ctx.permissions.includes(LECTURA[t])) return { type: t, available: false, items: [], note: 'No puedes compartir este tipo de recurso: no tienes permiso para leerlo.' };
    const org = ctx.organizationId;
    const items = t === 'LOT'
      ? (await sql<{ id: string; label: string; detail: string }>`SELECT l.id, l.lot_code AS label, p.name || ' · ' || l.status AS detail FROM lots l JOIN products p ON p.id = l.product_id WHERE l.organization_id = ${org} ORDER BY l.created_at DESC LIMIT 200`.execute(this.db)).rows
      : t === 'SHIPMENT'
        ? (await sql<{ id: string; label: string; detail: string }>`SELECT s.id, s.shipment_code AS label, s.destination_country || ' · ' || s.status AS detail FROM shipments s WHERE s.organization_id = ${org} ORDER BY s.created_at DESC LIMIT 200`.execute(this.db)).rows
        : (await sql<{ id: string; label: string; detail: string }>`SELECT sn.id, c.case_number || ' · instantánea ' || sn.snapshot_number AS label, sn.readiness AS detail FROM dd_snapshots sn JOIN dd_cases c ON c.id = sn.case_id WHERE sn.organization_id = ${org} ORDER BY sn.created_at DESC LIMIT 200`.execute(this.db)).rows;
    return { type: t, available: true, items, note: items.length === 200 ? 'Se muestran los 200 más recientes.' : null };
  }

  private estado(g: { expires_at: string; revoked_at: string | null }) {
    if (g.revoked_at) return 'REVOCADA';
    return new Date(g.expires_at).getTime() <= Date.now() ? 'VENCIDA' : 'ACTIVA';
  }

  private async ver(orgId: string, operationId: string) {
    const g = await this.db.selectFrom('access_grants').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', operationId).executeTakeFirstOrThrow();
    return { id: g.id, resource_type: g.resource_type, resource_id: g.resource_id, grantee_user_id: g.grantee_user_id, can_read: g.can_read, can_download: g.can_download, expires_at: g.expires_at, revoked_at: g.revoked_at };
  }
  private async verPorId(orgId: string, id: string) {
    const g = await this.db.selectFrom('access_grants').selectAll().where('organization_id', '=', orgId).where('id', '=', id).executeTakeFirstOrThrow();
    return { id: g.id, resource_type: g.resource_type, resource_id: g.resource_id, grantee_user_id: g.grantee_user_id, can_read: g.can_read, can_download: g.can_download, expires_at: g.expires_at, revoked_at: g.revoked_at };
  }

  // --------------------------------------------------------------- lado del CONCESIONARIO
  /**
   * Revalida TODO en cada acceso: cuenta activa, concesión viva, no vencida, no revocada, y la acción pedida.
   * **No mira membresías**: el acceso viene de la concesión, no de pertenecer a la organización.
   */
  private async vigente(user: AuthUser, grantId: string, accion: 'read' | 'download') {
    const cuenta = await this.db.selectFrom('users').select(['id', 'status']).where('id', '=', user.id).executeTakeFirst();
    if (!cuenta || cuenta.status !== 'ACTIVE') throw this.opaca;
    const g = await this.db.selectFrom('access_grants').selectAll()
      .where('id', '=', grantId).where('grantee_user_id', '=', user.id).executeTakeFirst();
    if (!g) throw this.opaca;
    if (g.revoked_at) throw this.opaca;
    if (new Date(g.expires_at as unknown as string).getTime() <= Date.now()) throw this.opaca;
    if (accion === 'read' && !g.can_read) throw this.opaca;
    if (accion === 'download' && !g.can_download) throw this.opaca;
    return g;
  }

  /** Lo que una cuenta externa tiene concedido. No revela nada de la organización más allá de su nombre. */
  async mias(user: AuthUser) {
    const filas = await sql<{ id: string; organization: string; resource_type: Tipo; can_read: boolean; can_download: boolean; expires_at: string }>`
      SELECT g.id, o.name AS organization, g.resource_type, g.can_read, g.can_download, g.expires_at::text
      FROM access_grants g JOIN organizations o ON o.id = g.organization_id
      JOIN users u ON u.id = g.grantee_user_id AND u.status = 'ACTIVE'
      WHERE g.grantee_user_id = ${user.id} AND g.revoked_at IS NULL AND g.expires_at > now()
      ORDER BY g.expires_at`.execute(this.db);
    return { grants: filas.rows };
  }

  /**
   * Proyección permitida. **La concesión no levanta la clasificación**: se construye con las reglas existentes
   * aplicadas a un contexto SIN permisos, que es lo más restrictivo que el producto sabe producir. No hay
   * identidad de productores, ni geometrías, ni documentos personales: solo códigos, estados y agregados,
   * como el Buyer Portal de S3 §22.8 («183 productores», no sus nombres).
   */
  async leer(user: AuthUser, grantId: string) {
    const g = await this.vigente(user, grantId, 'read');
    await this.registrarUso(user, g.organization_id, g.id, 'grant.read');
    return this.proyeccion(g);
  }

  /**
   * **La** proyección permitida — una sola, compartida por la lectura y por la descarga, para que no existan
   * dos con alcances distintos. La concesión **no levanta la clasificación**: no hay identidad de productores,
   * ni geometrías, ni documentos personales; solo códigos, estados y agregados, como el Buyer Portal de
   * S3 §22.8 («183 productores», no sus nombres).
   */
  private async proyeccion(g: { organization_id: string; resource_type: Tipo; resource_id: string }) {
    const org = g.organization_id;
    if (g.resource_type === 'LOT') {
      const l = (await sql<{ id: string; lot_code: string; status: string; origin_status: string; product: string; productores: number; parcelas: number }>`
        SELECT l.id, l.lot_code, l.status, l.origin_status, p.name AS product,
               (SELECT count(DISTINCT d.producer_id)::int FROM lot_inputs i JOIN receptions r ON r.id = i.reception_id JOIN deliveries d ON d.id = r.delivery_id WHERE i.lot_id = l.id) AS productores,
               (SELECT count(DISTINCT o.plot_id)::int FROM lot_inputs i JOIN receptions r ON r.id = i.reception_id JOIN delivery_origins o ON o.delivery_id = r.delivery_id WHERE i.lot_id = l.id) AS parcelas
        FROM lots l JOIN products p ON p.id = l.product_id WHERE l.id = ${g.resource_id} AND l.organization_id = ${org}`.execute(this.db)).rows[0];
      if (!l) throw this.opaca;
      // D-48(A) — Los once indicadores de S3 §22.8. Se construyen desde el contenido que el expediente ya
      // calcula para ESTE lote y se proyectan como ESTADO: ni geometrías, ni identidad, ni documentos, ni
      // identificadores de recursos relacionados. El contenido NO sale de aquí; solo su lectura.
      const contenido = await this.dd.capture(this.db, { organizationId: org, organizationStatus: 'ACTIVE', membershipId: '', roles: [], permissions: [] }, l.id);
      const indicadores = indicadoresDe(contenido, evaluateRequirements(contenido));
      // Período de producción (S1 §44): SOLO lo declarado como cosecha. Sin declaración queda desconocido;
      // la fecha de entrega no lo sustituye.
      const cosechas = (await sql<{ harvest_precision: string | null; harvest_start: string | null; harvest_end: string | null; harvest_derived_start: string | null; harvest_derived_end: string | null }>`
        SELECT DISTINCT d.harvest_precision, d.harvest_start::text, d.harvest_end::text, d.harvest_derived_start::text, d.harvest_derived_end::text
        FROM lot_inputs i JOIN receptions r ON r.id = i.reception_id JOIN deliveries d ON d.id = r.delivery_id
        WHERE i.lot_id = ${l.id} AND d.organization_id = ${org}`.execute(this.db)).rows;
      return { resource_type: 'LOT', lot_code: l.lot_code, status: l.status, product: l.product,
        origin_status: l.origin_status, productores: l.productores, parcelas: l.parcelas,
        production_period: periodoDeProduccion(cosechas),
        indicators: indicadores,
        public_reference: await referenciaDe(this.db, org, 'LOT', l.id),
        nota: 'Agregados y estados sin identidad: la concesión no levanta la clasificación de datos. Ningún indicador acredita conformidad EUDR ni sustituye una DDS.' };
    }
    if (g.resource_type === 'SHIPMENT') {
      const s = (await sql<{ id: string; shipment_code: string; status: string; destination_country: string; dispatch_at: string | null; items: number }>`
        SELECT s.id, s.shipment_code, s.status, s.destination_country, s.dispatch_at::text,
               (SELECT count(*)::int FROM shipment_items i WHERE i.shipment_id = s.id) AS items
        FROM shipments s WHERE s.id = ${g.resource_id} AND s.organization_id = ${org}`.execute(this.db)).rows[0];
      if (!s) throw this.opaca;
      return { resource_type: 'SHIPMENT', shipment_code: s.shipment_code, status: s.status,
        destination_country: s.destination_country, dispatch_at: s.dispatch_at, items: s.items,
        public_reference: await referenciaDe(this.db, org, 'SHIPMENT', s.id),
        nota: 'Destino declarado por la organización; Terra Link no lo verifica.' };
    }
    const sn = (await sql<{ id: string; snapshot_number: number; readiness: string; content_hash: string; case_number: string; requirements: Array<{ code: string; status: string }> }>`
      SELECT sn.id, sn.snapshot_number, sn.readiness, sn.content_hash, c.case_number, sn.requirements
      FROM dd_snapshots sn JOIN dd_cases c ON c.id = sn.case_id WHERE sn.id = ${g.resource_id} AND sn.organization_id = ${org}`.execute(this.db)).rows[0];
    if (!sn) throw this.opaca;
    return { resource_type: 'DD_SNAPSHOT', case_number: sn.case_number, snapshot_number: sn.snapshot_number,
      readiness: sn.readiness, content_hash: sn.content_hash,
      requirements: (sn.requirements ?? []).map((r) => ({ code: r.code, status: r.status })),
      public_reference: await referenciaDe(this.db, org, 'DD_SNAPSHOT', sn.id),
      nota: 'Preparación interna. NO acredita presentación de DDS ni conformidad EUDR.' };
  }

  /**
   * Descarga por concesión: **vista compartida interna**, no el paquete final. Reutiliza exactamente la misma
   * proyección de `leer()` —no hay una segunda, más amplia— y se identifica como lo que es, con su recurso, su
   * fecha y sus límites. Revalida cuenta, concesión, vencimiento, revocación y acción, como cualquier acceso.
   */
  async descargar(user: AuthUser, grantId: string) {
    const g = await this.vigente(user, grantId, 'download');
    const proyeccion = await this.proyeccion(g);
    await this.registrarUso(user, g.organization_id, g.id, 'grant.download');
    const org = await this.db.selectFrom('organizations').select('name').where('id', '=', g.organization_id).executeTakeFirst();
    const generado = new Date().toISOString();
    const cuerpo = {
      tipo_de_archivo: 'VISTA_COMPARTIDA_INTERNA',
      aviso: 'Vista compartida interna de Terra Link. NO es un DD_PACKAGE, NO es una DDS, NO acredita conformidad EUDR y NO es una presentación oficial.',
      limitaciones: [
        'Contiene exactamente lo que la concesión permite leer: agregados, sin identidad, geometrías ni documentos.',
        'Refleja el estado en la fecha de generación; no se actualiza y no prueba vigencia posterior.',
        'La concesión que la habilita puede vencer o revocarse en cualquier momento.',
      ],
      organizacion_emisora: org?.name ?? null,
      recurso: proyeccion,
      generado_en: generado,
      concesion: { id: g.id, vence: g.expires_at },
    };
    const nombre = `vista-compartida-${g.resource_type.toLowerCase()}-${generado.slice(0, 10)}.json`;
    return { nombre, cuerpo };
  }

  /** Registra el USO, no solo la creación: el contrato exige auditar creación, cambios, revocación y uso. */
  private async registrarUso(user: AuthUser, orgId: string, grantId: string, action: string) {
    await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action, entityType: 'access_grant', entityId: grantId, result: 'SUCCESS', after: { via: 'concesión externa' } });
  }

}

@ApiTags('Autorización')
@Controller('api/v1/organizations/:orgId/access-grants')
export class AccessGrantsController {
  constructor(private readonly service: AccessGrantsService) {}

  @Post()
  @ApiOperation({ summary: 'Conceder acceso externo a una instancia concreta (P0-003)',
    description: 'La concesión NO crea membresía ni asigna roles. Exige vencimiento futuro y solo puede conceder lo que el concedente ya tiene.' })
  crear(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: CrearConcesionDto, @Req() req: AuthedRequest) {
    return this.service.crear(u, o, dto, req.requestId);
  }

  @Get()
  listar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) {
    return this.service.listar(u, o);
  }

  @Get('shareable')
  @ApiOperation({ summary: 'Recursos que puedes compartir (A-02)', description: 'Solo los de tu organización que tú puedes leer. Sin búsqueda de destinatarios.' })
  compartibles(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Query('type') tipo: string) {
    return this.service.compartibles(u, o, tipo);
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Revocar una concesión, con efecto inmediato' })
  revocar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RevocarDto, @Req() req: AuthedRequest) {
    return this.service.revocar(u, o, id, dto, req.requestId);
  }
}

@ApiTags('Autorización')
@Controller('api/v1/granted')
export class GrantedController {
  constructor(private readonly service: AccessGrantsService) {}

  @Get()
  @ApiOperation({ summary: 'Lo que otras organizaciones han concedido a mi cuenta (P0-003)' })
  mias(@CurrentUser() u: AuthUser) {
    return this.service.mias(u);
  }

  @Get(':grantId/download')
  @ApiOperation({ summary: 'Descargar la vista compartida interna del recurso concedido',
    description: 'Archivo interno con la MISMA proyección que la lectura. No es DD_PACKAGE, DDS ni prueba de conformidad. Revalida cuenta, concesión, vencimiento, revocación y acción.' })
  async descargar(@CurrentUser() u: AuthUser, @Param('grantId', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { nombre, cuerpo } = await this.service.descargar(u, id);
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${nombre}"`);
    res.send(JSON.stringify(cuerpo, null, 2));
  }

  @Get(':grantId')
  @ApiOperation({ summary: 'Proyección permitida del recurso concedido',
    description: 'Revalida cuenta, concesión, vencimiento, revocación y acción en CADA acceso. Un recurso inexistente y uno no concedido responden igual.' })
  leer(@CurrentUser() u: AuthUser, @Param('grantId', ParseUUIDPipe) id: string) {
    return this.service.leer(u, id);
  }
}
