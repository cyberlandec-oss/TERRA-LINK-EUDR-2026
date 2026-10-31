import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, notFound } from '../common/errors';
import { AuthorizationService } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { AuditService } from '../audit/audit.service';
import { PII_CIPHER, type PiiCipher } from '../crypto/pii';
import type { DomainEvent, EventConsumer } from '../events/events';

// P1-008 — Integración ERP/API por webhooks (RF-39).
//
// QUÉ EXIGEN LOS CRITERIOS, LITERALMENTE
//   · **RF-39** (`docs/03:55`, columna **Restricción**): «**Idempotencia y tenant**».
//   · **P1-008** (`docs/18:209`): «**Firma/idempotencia/tenant/mapping**; **referencia de paquete/submission
//     exacta**».
//
// LO QUE SE REUTILIZA
// El bus de eventos **ya aporta** reintentos con espera creciente, arrendamiento, cola muerta y reencolado
// manual. El envío es **un consumidor más** (`webhook`), así que hereda todo eso: **no se construye otra
// cola**. Lo nuevo es el destino, la firma y el resultado por intento.
//
// FIRMA
// Cabecera `X-Terra-Signature: t=<época>,v1=<hmac>` sobre `"<t>.<cuerpo>"` con **HMAC-SHA256** y el secreto
// del destino. El instante va **dentro** de lo firmado: así una entrega capturada no se puede reutilizar con
// otra marca de tiempo. El secreto se guarda **cifrado** y **nunca** se devuelve: solo su huella.
//
// IDEMPOTENCIA
// Cada entrega lleva `X-Terra-Delivery-Id` = `<evento>:<destino>`, **estable entre reintentos**, para que el
// receptor descarte duplicados. Y por nuestro lado, un índice único impide **reenviar** a un destino un
// evento que ya se le entregó: si el bus reintenta por culpa de otro destino, ese no se repite.
//
// TENANT
// Un destino es de **una** organización y solo recibe **sus** eventos. El consumidor filtra por la
// organización del evento; no hay forma de suscribirse a lo ajeno.
//
// DESTINOS INTERNOS
// Un destino configurable es una puerta para alcanzar la red interna. Por eso la URL se **resuelve** y se
// rechaza si apunta a **bucle local, red privada, enlace local o multicast**, salvo que la instalación
// declare explícitamente que admite destinos locales (desarrollo). Esa decisión **se publica** en la
// respuesta: no se oculta que el modo está abierto.

/** ¿Permite esta instalación destinos locales? Solo para desarrollo, y se publica. */
/**
 * Se consulta **en el momento**, no al cargar el módulo: así una instalación puede cambiarlo sin reiniciar y
 * las pruebas pueden levantar su receptor local sin depender del orden de importación.
 */
const permiteLocales = () => process.env.WEBHOOK_ALLOW_LOCAL === 'true';
/** Plazo de cada envío. Un receptor lento no bloquea la cola. */
const TIMEOUT_MS = 5_000;
/** Recorte de la respuesta que se guarda: basta para diagnosticar, no para almacenar un cuerpo entero. */
const MAX_RESPUESTA = 500;

class DestinoDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsString() @Length(2, 60) code!: string;
  @ApiProperty() @IsString() @Length(8, 500) url!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsString({ each: true }) event_types!: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() active?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(5, 500) reason?: string;
}
/**
 * Consulta de intentos. `docs/09:7` exige «Listas **paginadas con límites y orden estable**; filtros
 * whitelist»: aquí están el límite declarado, el cursor y el único filtro admitido.
 */
class DestinosQueryDto {
  @ApiProperty({ required: false }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

class IntentosQueryDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(2, 60) code?: string;
  @ApiProperty({ required: false }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

/**
 * Cursor de clave: instante del intento **e identificador**. El instante solo no sirve de desempate —dos
 * intentos pueden caer en el mismo microsegundo— y sin desempate una página puede repetir u omitir filas.
 */
const codificarCursor = (enviadoEn: string, id: string) => Buffer.from(JSON.stringify([enviadoEn, id])).toString('base64url');
function descodificarCursor(c: string): [string, string] {
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string') return [v[0], v[1]];
  } catch { /* cursor inválido */ }
  throw new AppError(400, 'VALIDATION_FAILED', 'Cursor no válido.');
}

/** El cursor de destinos es su código: la clave de orden ya es única por organización. */
function descodificarCursorCodigo(c: string): string {
  const v = Buffer.from(c, 'base64url').toString('utf8');
  if (!v || v.length > 60) throw new AppError(400, 'VALIDATION_FAILED', 'Cursor no válido.');
  return v;
}

/** Tope por página. Un cliente puede pedir menos; más, no. */
const MAX_POR_PAGINA = 100;

class VerificarDto {
  @ApiProperty() @IsString() @Length(1, 10000) body!: string;
  @ApiProperty() @Matches(/^t=\d+,v1=[0-9a-f]{64}$/) signature!: string;
}

/**
 * Tipos de evento que el sistema **publica hoy**, leídos del código que los emite. Sirve para dos cosas:
 * ofrecerlos al configurar, y **rechazar** un tipo que no existe.
 *
 * Por qué se rechaza en vez de admitirlo «por si acaso»: un destino suscrito a un tipo inexistente
 * **no recibe nada** y parece bien configurado. Un error de escritura se convertía así en un silencio.
 */
export const TIPOS_DE_EVENTO = [
  'DdCaseCreated', 'DdPackageExported', 'DdReviewRecorded', 'DdSnapshotCaptured',
  'DeviceRegistered', 'DeviceRevoked', 'DocumentScanCompleted', 'DocumentUploaded',
  'MitigationVerificationCorrected', 'MitigationVerified',
  'PlotGeoProfileEvaluated', 'PlotGeometryVersionCreated', 'PlotGisEvaluated', 'PlotRegistered',
  'PlotStatusChanged', 'PlotUpdated',
  'ProducerAssigned', 'ProducerRegistered', 'ProducerStatusChanged', 'ProducerUpdateCorrected',
  'ProducerUpdated',
  'RiskEvaluationRecorded', 'SatelliteAnalysisRequested', 'StockMovementRecorded',
] as const;

const aad = (orgId: string, code: string, version: number) => `webhook|${orgId}|${code}|${version}`;
const huella = (secreto: string) => createHmac('sha256', 'terra-link-webhook-fingerprint').update(secreto).digest('hex').slice(0, 16);

/** Firma canónica: `t=<época>,v1=HMAC(secreto, "<t>.<cuerpo>")`. */
export function firmar(secreto: string, cuerpo: string, epoca: number): string {
  const v1 = createHmac('sha256', secreto).update(`${epoca}.${cuerpo}`).digest('hex');
  return `t=${epoca},v1=${v1}`;
}

/** Comprueba una firma en tiempo constante. Una firma mal formada es simplemente inválida. */
export function verificarFirma(secreto: string, cuerpo: string, firma: string, toleranciaSegundos = 300, ahora = Date.now()): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(firma);
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(ahora / 1000 - t) > toleranciaSegundos) return false;
  const esperada = createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest();
  const recibida = Buffer.from(m[2], 'hex');
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

/** ¿La dirección pertenece a un rango que no debe alcanzarse desde un destino configurable? */
export function esDireccionInterna(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    // IPv4 mapeada en IPv6.
    const m = /::ffff:(\d+\.\d+\.\d+\.\d+)/.exec(v);
    return m ? esDireccionInterna(m[1]) : false;
  }
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n))) return true;
  if (o[0] === 127 || o[0] === 0 || o[0] === 10) return true;
  if (o[0] === 169 && o[1] === 254) return true;
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
  if (o[0] === 192 && o[1] === 168) return true;
  if (o[0] >= 224) return true;
  return false;
}

@Injectable()
export class WebhookService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(PII_CIPHER) private readonly cipher: PiiCipher,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  /** Comprueba que la URL es admisible: esquema, y que no apunte a la red interna. */
  async validarUrl(url: string): Promise<{ host: string; ips: string[] }> {
    let u: URL;
    try { u = new URL(url); } catch { throw new AppError(422, 'URL_INVALIDA', 'La dirección del destino no es una URL válida.', [{ field: 'url', reason: 'URL_INVALIDA' }]); }
    if (u.protocol !== 'https:' && !(permiteLocales() && u.protocol === 'http:')) {
      throw new AppError(422, 'ESQUEMA_NO_ADMITIDO', 'El destino debe usar https.', [{ field: 'url', reason: 'ESQUEMA_NO_ADMITIDO' }]);
    }
    let ips: string[];
    try {
      ips = isIP(u.hostname) ? [u.hostname] : (await lookup(u.hostname, { all: true })).map((d) => d.address);
    } catch {
      throw new AppError(422, 'HOST_NO_RESUELVE', 'El nombre del destino no se pudo resolver.', [{ field: 'url', reason: 'HOST_NO_RESUELVE' }]);
    }
    if (ips.length === 0) throw new AppError(422, 'HOST_NO_RESUELVE', 'El nombre del destino no resolvió a ninguna dirección.', [{ field: 'url', reason: 'HOST_NO_RESUELVE' }]);
    const internas = ips.filter((ip) => esDireccionInterna(ip));
    if (internas.length > 0 && !permiteLocales()) {
      throw new AppError(422, 'DESTINO_INTERNO', 'El destino resuelve a una dirección interna: no se permite, para que la configuración no abra el acceso a la red privada.', [{ field: 'url', reason: 'DESTINO_INTERNO' }]);
    }
    return { host: u.hostname, ips };
  }

  // ------------------------------------------------------------------ configuración

  async configurar(user: AuthUser, orgId: string, dto: DestinoDto, requestId?: string) {
    await this.authz.require(user, orgId, 'integration:manage', { mutation: true });
    const previa = await this.db.selectFrom('webhook_destinations').select(['id', 'code'])
      .where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (previa) {
      if (previa.code !== dto.code.trim()) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, secret: null, ...(await this.listar(user, orgId)) };
    }

    // Un tipo que no existe no se admite: un destino suscrito a nada parecería bien configurado.
    const desconocidos = dto.event_types.filter((t) => !(TIPOS_DE_EVENTO as readonly string[]).includes(t));
    if (desconocidos.length > 0) {
      throw new AppError(422, 'EVENT_TYPE_UNKNOWN',
        `Estos tipos de evento no existen: ${desconocidos.join(', ')}. Un destino suscrito a un tipo inexistente `
        + 'no recibiría nada y parecería bien configurado.',
        desconocidos.map((t) => ({ field: 'event_types', reason: 'EVENT_TYPE_UNKNOWN', value: t })));
    }

    const { host, ips } = await this.validarUrl(dto.url.trim());
    const ultima = await this.db.selectFrom('webhook_destinations').select(['version'])
      .where('organization_id', '=', orgId).where('code', '=', dto.code.trim())
      .orderBy('version', 'desc').executeTakeFirst();
    const version = (ultima?.version ?? 0) + 1;
    if (version > 1 && !dto.reason?.trim()) {
      throw new AppError(422, 'REASON_REQUIRED', 'Cambiar un destino existente exige un motivo.', [{ field: 'reason', reason: 'REASON_REQUIRED' }]);
    }

    // Secreto nuevo en cada versión: rotarlo es registrar otra versión.
    const secreto = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('webhook_destinations').values({
        id, organization_id: orgId, code: dto.code.trim(), version,
        url: dto.url.trim(),
        secret_cipher: this.cipher.encrypt(secreto, aad(orgId, dto.code.trim(), version)),
        secret_fingerprint: huella(secreto),
        event_types: dto.event_types as never,
        active: dto.active ?? true,
        reason: version > 1 ? dto.reason!.trim() : null,
        created_by: user.id, operation_id: dto.operation_id,
      }).execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'integration.destination_configured',
        entityType: 'webhook_destination', entityId: id, requestId, result: 'SUCCESS',
        // El secreto NO entra en la auditoría: solo su huella.
        after: { code: dto.code.trim(), version, url: dto.url.trim(), host, resolved: ips, event_types: dto.event_types, active: dto.active ?? true, secret_fingerprint: huella(secreto) },
      });
    });

    return {
      replayed: false,
      /** ÚNICA vez que el secreto se devuelve. Después solo queda su huella. */
      secret: secreto,
      secret_note: 'Guárdalo ahora: no se vuelve a mostrar. Si se pierde, configura otra versión del destino y '
        + 'se generará uno nuevo.',
      ...(await this.listar(user, orgId)),
    };
  }

  async listar(user: AuthUser, orgId: string, q: DestinosQueryDto = {}) {
    await this.authz.require(user, orgId, 'integration:read', { mutation: false });
    const limite = Math.min(q.limit ?? 50, MAX_POR_PAGINA);
    const desde = q.cursor ? descodificarCursorCodigo(q.cursor) : null;
    const filas = await sql<{
      id: string; code: string; version: number; url: string; secret_fingerprint: string;
      event_types: string[]; active: boolean; reason: string | null; created_at: string; author: string | null; entregas: number; fallos: number;
    }>`
      SELECT DISTINCT ON (d.code) d.id, d.code, d.version, d.url, d.secret_fingerprint, d.event_types,
             d.active, d.reason, d.created_at::text, u.email AS author,
             (SELECT count(*)::int FROM webhook_attempts a WHERE a.destination_id = d.id AND a.status = 'ENTREGADO') AS entregas,
             (SELECT count(*)::int FROM webhook_attempts a WHERE a.destination_id = d.id AND a.status <> 'ENTREGADO') AS fallos
      FROM webhook_destinations d
      LEFT JOIN users u ON u.id = d.created_by
      WHERE d.organization_id = ${orgId}
        AND (${desde}::text IS NULL OR d.code > ${desde})
      ORDER BY d.code, d.version DESC
      LIMIT ${limite + 1}`.execute(this.db);

    const hayMas = filas.rows.length > limite;
    const pagina = filas.rows.slice(0, limite);
    return {
      destinations: pagina.map((d) => ({
        id: d.id, code: d.code, version: d.version, url: d.url,
        /** El secreto NO se publica: solo su huella, para poder compararlo sin revelarlo. */
        secret_fingerprint: d.secret_fingerprint,
        event_types: d.event_types, active: d.active, reason: d.reason,
        created_at: d.created_at, author: d.author ?? 'PLATAFORMA',
        delivered: d.entregas, failed: d.fallos,
      })),
      limit: limite,
      /** `null` cuando no queda ninguno más. El total NO se publica aquí. */
      next_cursor: hayMas && pagina.length ? Buffer.from(pagina[pagina.length - 1].code, 'utf8').toString('base64url') : null,
      /** Lo que se puede suscribir. Si no está aquí, no se publica: no hay suscripción a ciegas. */
      event_catalog: TIPOS_DE_EVENTO,
      local_destinations_allowed: permiteLocales(),
      mode_note: permiteLocales()
        ? 'Esta instalación ADMITE destinos locales (modo de desarrollo). En una instalación normal, un destino '
          + 'que resuelva a una dirección interna se rechaza.'
        : 'Los destinos deben usar https y no pueden resolver a direcciones internas: la configuración no abre '
          + 'el acceso a la red privada.',
      signature_note: 'Cada entrega va firmada con HMAC-SHA256 sobre «<instante>.<cuerpo>» en la cabecera '
        + 'X-Terra-Signature. El instante va dentro de lo firmado, así que una entrega capturada no se puede '
        + 'reutilizar con otra marca de tiempo.',
      delivery_guarantee: 'AL_MENOS_UNA_VEZ',
      idempotency_note: 'Garantía: AL MENOS UNA VEZ. Cada entrega lleva X-Terra-Delivery-Id, estable entre '
        + 'reintentos. Terra Link no reenvía un evento cuya entrega REGISTRÓ como lograda; pero si tu sistema lo '
        + 'procesa y la respuesta se pierde —plazo agotado, conexión cortada—, aquí consta un fallo y el bus '
        + 'reintenta: recibirás el mismo mensaje otra vez, con el mismo identificador. Procesar UNA sola vez es '
        + 'responsabilidad del receptor, y ese identificador es la clave con la que conseguirlo.',
    };
  }

  async intentos(user: AuthUser, orgId: string, q: IntentosQueryDto = {}) {
    await this.authz.require(user, orgId, 'integration:read', { mutation: false });
    const limite = Math.min(q.limit ?? 50, MAX_POR_PAGINA);
    const code = q.code?.trim() || null;
    // Orden ESTABLE: instante descendente y, a igualdad, identificador. Sin el desempate una página podría
    // repetir u omitir un intento, que es justo lo que una lista paginada no puede hacer.
    const corte = q.cursor ? descodificarCursor(q.cursor) : null;
    const filas = await sql<{
      id: string; code: string; delivery_id: string; attempt: number; status: string; http_status: number | null;
      response_excerpt: string | null; error: string | null; duration_ms: number | null; sent_at: string;
      event_type: string; aggregate_type: string; aggregate_id: string;
    }>`
      SELECT a.id, d.code, a.delivery_id, a.attempt, a.status, a.http_status, a.response_excerpt, a.error,
             a.duration_ms, a.sent_at::text, e.event_type, e.aggregate_type, e.aggregate_id
      FROM webhook_attempts a
      JOIN webhook_destinations d ON d.id = a.destination_id
      JOIN domain_events e ON e.event_id = a.event_id
      WHERE a.organization_id = ${orgId}
        AND (${code}::text IS NULL OR d.code = ${code})
        AND (${corte ? corte[0] : null}::timestamptz IS NULL
             OR (a.sent_at, a.id) < (${corte ? corte[0] : null}::timestamptz, ${corte ? corte[1] : null}::uuid))
      ORDER BY a.sent_at DESC, a.id DESC
      LIMIT ${limite + 1}`.execute(this.db);

    const hayMas = filas.rows.length > limite;
    const pagina = filas.rows.slice(0, limite);
    const ultimo = pagina[pagina.length - 1];
    return {
      attempts: pagina,
      limit: limite,
      /** `null` cuando no queda nada por leer. Mientras no lo sea, **falta** por ver: no es el total. */
      next_cursor: hayMas && ultimo ? codificarCursor(ultimo.sent_at, ultimo.id) : null,
      note: 'Cada intento, con su resultado. Los reintentos los gobierna el bus de eventos: la misma cola, con '
        + 'su espera creciente y su cola muerta, que ya se consulta en el historial de eventos.',
      pagination_note: `Página de ${pagina.length} intento(s) de un total que NO se publica aquí. Mientras `
        + '«next_cursor» no sea nulo quedan más: pídelos con ese cursor. El orden es por instante de envío '
        + 'descendente, con el identificador como desempate, para que una página no repita ni omita filas.',
    };
  }

  /** Utilidad para quien integra: comprobar que su verificación de firma es correcta. */
  async verificar(user: AuthUser, orgId: string, code: string, dto: VerificarDto) {
    await this.authz.require(user, orgId, 'integration:read', { mutation: false });
    const d = await this.db.selectFrom('webhook_destinations').selectAll()
      .where('organization_id', '=', orgId).where('code', '=', code)
      .orderBy('version', 'desc').executeTakeFirst();
    if (!d) throw notFound('El destino no existe o no está disponible para ti.');
    const secreto = this.cipher.decrypt(d.secret_cipher, aad(orgId, d.code, d.version));
    const valida = verificarFirma(secreto, dto.body, dto.signature);
    return {
      valid: valida,
      note: valida
        ? 'La firma corresponde a este destino y está dentro de la ventana de tiempo.'
        : 'La firma NO es válida: no coincide, está mal formada o su instante queda fuera de la ventana.',
    };
  }
}

/**
 * El envío, como **consumidor del bus**. Hereda reintentos, arrendamiento y cola muerta: si un destino falla,
 * el bus reintenta; los destinos que ya recibieron el evento **no** lo reciben otra vez.
 */
export function webhookConsumer(db: Kysely<Database>, cipher: PiiCipher): EventConsumer {
  return {
    name: 'webhook',
    eventTypes: '*',
    // Se trabaja contra la conexión del servicio, NO contra la transacción del bus. Un envío HTTP no es
    // transaccional —cuando falla, ya salió a la red—, así que su registro no puede irse con el `ROLLBACK`
    // que provoca el propio fallo: un rechazo sin rastro es peor que un rechazo.
    async handle(_trx: Transaction<Database>, event: DomainEvent) {
      // Solo los destinos de la organización DEL EVENTO: el aislamiento es por dato, no por filtro de interfaz.
      const destinos = await sql<{ id: string; code: string; version: number; url: string; secret_cipher: string; event_types: string[]; active: boolean }>`
        SELECT DISTINCT ON (d.code) d.id, d.code, d.version, d.url, d.secret_cipher, d.event_types, d.active
        FROM webhook_destinations d
        WHERE d.organization_id = ${event.organization_id}
        ORDER BY d.code, d.version DESC`.execute(db);

      // `active` se aplica aquí: apagar un destino es registrar una versión inactiva, y desde ese momento
      // deja de recibir. Publicar el campo sin aplicarlo era ofrecer un interruptor que no apagaba nada.
      const activos = destinos.rows.filter((d) => d.active && d.event_types.includes(event.event_type));
      if (activos.length === 0) return;

      const fallos: string[] = [];
      for (const d of activos) {
        const yaEntregado = await db.selectFrom('webhook_attempts').select('id')
          .where('destination_id', '=', d.id).where('event_id', '=', event.event_id)
          .where('status', '=', 'ENTREGADO').executeTakeFirst();
        if (yaEntregado) continue;   // idempotencia: no se reenvía lo ya entregado

        const intentos = await db.selectFrom('webhook_attempts').select(sql<number>`count(*)::int`.as('n'))
          .where('destination_id', '=', d.id).where('event_id', '=', event.event_id).executeTakeFirstOrThrow();

        const cuerpo = JSON.stringify(await cuerpoDeEvento(db, event));
        const epoca = Math.floor(Date.now() / 1000);
        const secreto = cipher.decrypt(d.secret_cipher, aad(event.organization_id, d.code, d.version));
        const deliveryId = `${event.event_id}:${d.id}`;

        const t0 = Date.now();
        let estado: 'ENTREGADO' | 'RECHAZADO' | 'ERROR_DE_RED' = 'ERROR_DE_RED';
        let http: number | null = null;
        let recorte: string | null = null;
        let error: string | null = null;
        try {
          const r = await fetch(d.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-terra-signature': firmar(secreto, cuerpo, epoca),
              'x-terra-delivery-id': deliveryId,
              'x-terra-event-type': event.event_type,
              'x-terra-organization': event.organization_id,
            },
            body: cuerpo,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          http = r.status;
          recorte = (await r.text().catch(() => '')).slice(0, MAX_RESPUESTA) || null;
          estado = r.ok ? 'ENTREGADO' : 'RECHAZADO';
        } catch (e) {
          error = String((e as Error)?.message ?? 'error de red').slice(0, MAX_RESPUESTA);
        }

        await db.insertInto('webhook_attempts').values({
          id: randomUUID(), organization_id: event.organization_id, destination_id: d.id,
          event_id: event.event_id, delivery_id: deliveryId, attempt: intentos.n + 1,
          status: estado, http_status: http, response_excerpt: recorte, error,
          duration_ms: Date.now() - t0,
        }).execute();

        if (estado !== 'ENTREGADO') fallos.push(`${d.code}: ${estado}${http ? ` (${http})` : ''}`);
      }
      // Si algún destino falló, se propaga: el bus reintentará, y los ya entregados no se repiten.
      if (fallos.length > 0) throw new Error(`entrega fallida → ${fallos.join('; ')}`);
    },
  };
}

/**
 * Cuerpo de la entrega. Lleva la **asociación de referencias** que pide RF-39: el agregado y, cuando el
 * evento es de un expediente, la **referencia exacta del paquete** —caso, instantánea, número y huella— y el
 * **estado de presentación**, que hoy es siempre `NOT_SUBMITTED`: descargar no es presentar.
 */
async function cuerpoDeEvento(db: Kysely<Database>, event: DomainEvent) {
  const base = {
    delivery: { id: `${event.event_id}`, sent_at: new Date().toISOString() },
    event: {
      id: event.event_id, type: event.event_type, schema_version: event.schema_version,
      occurred_at: event.occurred_at, recorded_at: event.recorded_at,
    },
    organization_id: event.organization_id,
    subject: { aggregate_type: event.aggregate_type, aggregate_id: event.aggregate_id, aggregate_version: event.aggregate_version },
    payload: event.payload,
    references: {} as Record<string, unknown>,
    disclaimer: 'Evento interno de Terra Link. No acredita conformidad EUDR ni presentación oficial de DDS.',
  };

  if (event.aggregate_type === 'DD_CASE' || event.aggregate_type === 'DD_SNAPSHOT') {
    const s = await sql<{ case_id: string; case_number: string; snapshot_id: string; snapshot_number: number; content_hash: string; readiness: string }>`
      SELECT c.id AS case_id, c.case_number, s.id AS snapshot_id, s.snapshot_number, s.content_hash, s.readiness
      FROM dd_snapshots s JOIN dd_cases c ON c.id = s.case_id
      WHERE s.organization_id = ${event.organization_id}
        AND (s.id = ${event.aggregate_id} OR c.id = ${event.aggregate_id})
      ORDER BY s.snapshot_number DESC LIMIT 1`.execute(db);
    const r = s.rows[0];
    if (r) {
      base.references.package = {
        case_id: r.case_id, case_number: r.case_number,
        snapshot_id: r.snapshot_id, snapshot_number: r.snapshot_number,
        content_hash: r.content_hash, readiness: r.readiness,
      };
      base.references.submission = {
        status: 'NOT_SUBMITTED',
        note: 'Terra Link NO presenta declaraciones. READY es preparación interna y descargar el paquete no es '
          + 'presentar una DDS: no existe referencia de presentación porque no hay presentación.',
      };
    }
  }
  return base;
}

@ApiTags('integration')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/integration/webhooks')
export class WebhookController {
  constructor(private readonly service: WebhookService) {}

  @Get()
  @ApiOperation({ summary: 'Destinos configurados, con su huella de secreto y sus entregas' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  listar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Query() q: DestinosQueryDto) {
    return this.service.listar(u, o, q);
  }

  @Post()
  @ApiOperation({ summary: 'Configurar o rotar un destino. El secreto se devuelve UNA sola vez' })
  configurar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string,
    @Body() dto: DestinoDto, @Req() req: AuthedRequest) {
    return this.service.configurar(u, o, dto, req.requestId);
  }

  @Get('attempts')
  @ApiOperation({ summary: 'Resultado de cada intento de entrega, paginado' })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  intentos(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Query() q: IntentosQueryDto) {
    return this.service.intentos(u, o, q);
  }

  @Post(':code/verify-signature')
  @ApiOperation({ summary: 'Comprobar una firma, para validar la integración del receptor' })
  verificar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string,
    @Param('code') code: string, @Body() dto: VerificarDto) {
    return this.service.verificar(u, o, code, dto);
  }
}
