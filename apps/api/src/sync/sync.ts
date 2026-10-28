import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { plainToInstance, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested, validate } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { PlotsService } from '../plots/plots';
import { PolygonDraftsService } from '../plots/polygon-drafts';
import { ProducersService } from '../producers/producers';
import { DeliveriesService } from '../deliveries/deliveries';
import { ProductsService } from '../products/products';
import { DocumentsService } from '../documents/documents';
import { hasImageMetadata } from './image-metadata';

// P0-024 Sync (RF-24, QA-08/02; docs/11 §Contrato de servidor). Cada petición revalida sesión (guardia JWT + estado del
// usuario), dispositivo (del usuario, en la organización, no revocado), membresía, organización y permisos. El device_id
// no autoriza: solo identifica un dispositivo ya registrado por el usuario autenticado.
// Push: lote ≤ 50; por operación: ACCEPTED · DUPLICATE · REJECTED · CONFLICT · DEPENDENCY_PENDING · FORBIDDEN ·
// TRANSIENT_ERROR. Hash recalculado sobre el contenido validado; mismo id + hash → mismo resultado (revalidando permisos);
// mismo id + otro hash → conflicto; el dispositivo no forma parte del hash (cambiar de dispositivo no duplica efectos).
// Efectos idempotentes por operation_id en los servicios de dominio: un timeout tras el commit se recupera al reintentar.
// Pull: cursor de servidor ligado a organización, usuario y dispositivo, con el conjunto visible al emitirlo; los
// tombstones solo cubren recursos que ese cursor había entregado; la visibilidad se recalcula en cada pull.
// Tipos soportados: PLOT_LOCATION_SAMPLE_CREATE y PLOT_PHOTO_ATTACH. Entregas, inventario y demás: no soportados.

export const MAX_BATCH = 50;
export const CURSOR_TTL_DAYS = 7;
export const SUPPORTED_OPERATION_TYPES = ['PLOT_LOCATION_SAMPLE_CREATE', 'PLOT_PHOTO_ATTACH', 'PLOT_POLYGON_VERTEX_ADD', 'PRODUCER_CREATE', 'PLOT_CREATE', 'DELIVERY_CREATE'] as const;

export const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
    : JSON.stringify(v ?? null);
/** Mismo algoritmo que apps/mobile/src/core/canonical.ts. */
export function operationHash(o: { operation_type: string; entity_id: string; base_version: number | null; depends_on: string[]; captured_at: string; payload: Record<string, unknown> }) {
  return createHash('sha256').update(canonical({ operation_type: o.operation_type, entity_id: o.entity_id, base_version: o.base_version, depends_on: [...o.depends_on].sort(), captured_at: o.captured_at, payload: o.payload })).digest('hex');
}

class RegisterDeviceDto {
  @ApiProperty({ description: 'Identificador generado por la app (informativo; no autoriza)' }) @IsString() @Length(8, 100) client_device_id!: string;
  @ApiProperty({ enum: ['ANDROID', 'IOS', 'OTHER'] }) @IsIn(['ANDROID', 'IOS', 'OTHER']) platform!: 'ANDROID' | 'IOS' | 'OTHER';
  @ApiProperty() @IsString() @Length(1, 80) label!: string;
}
class RevokeDto { @ApiProperty() @IsString() @Length(3, 500) reason!: string }
class OperationDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ enum: SUPPORTED_OPERATION_TYPES }) @IsString() @Length(3, 60) operation_type!: string;
  @ApiProperty() @IsUUID() entity_id!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) base_version!: number | null;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) depends_on!: string[];
  @ApiProperty() @IsISO8601({ strict: true }) captured_at!: string;
  @ApiProperty({ type: Object }) @IsObject() payload!: Record<string, unknown>;
  @ApiProperty({ description: 'SHA-256 del contenido canónico calculado por el cliente' }) @Matches(/^[0-9a-f]{64}$/) content_hash!: string;
}
class PushDto {
  @ApiProperty({ description: 'Dispositivo registrado (emitido por el servidor)' }) @IsUUID() device_id!: string;
  @ApiProperty({ type: [OperationDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_BATCH) @ValidateNested({ each: true }) @Type(() => OperationDto) operations!: OperationDto[];
}
class LocationPayload {
  @IsUUID() plot_id!: string;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-90) @Max(90) latitude!: number;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180) longitude!: number;
  @ValidateIf((_, v) => v !== null) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) accuracy_m!: number | null;
  @IsISO8601({ strict: true }) acquired_at!: string;
  @IsIn(['DEVICE_LOCATION_SERVICE']) source!: 'DEVICE_LOCATION_SERVICE';
  @IsString() @Length(3, 500) provider_detail!: string;
  @ValidateIf((_, v) => v !== null) @IsBoolean() mocked!: boolean | null;
  @IsOptional() @IsUUID() resolves_operation_id?: string;
}
// D: un vértice de polígono capturado en el dispositivo. Entra al BORRADOR de polígono de la parcela; confirmarlo (versión nueva) sigue siendo una decisión humana en la web.
class VertexPayload {
  @IsUUID() plot_id!: string;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-90) @Max(90) latitude!: number;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180) longitude!: number;
  @ValidateIf((_, v) => v !== null) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) accuracy_m!: number | null;
  @IsISO8601({ strict: true }) acquired_at!: string;
  @IsIn(['DEVICE_LOCATION_SERVICE']) source!: 'DEVICE_LOCATION_SERVICE';
  @IsString() @Length(3, 500) provider_detail!: string;
  @ValidateIf((_, v) => v !== null) @IsBoolean() mocked!: boolean | null;
  /** Captura (borrador local del teléfono) a la que pertenece el vértice: identifica el borrador de destino. */
  @IsUUID() capture_id!: string;
  /** Posición del vértice dentro de la captura (1 = el primero). */
  @IsInt() @Min(1) vertex_seq!: number;
  @IsOptional() @IsUUID() resolves_operation_id?: string;
}
// D: altas sin conexión. El `entity_id` de la operación es la referencia LOCAL del teléfono (UUID propio); el servidor la mapea a su identificador definitivo.
class ProducerCreatePayload {
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/) producer_code!: string;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE']) status?: 'DRAFT' | 'ACTIVE';
  @IsOptional() @IsString() @Length(1, 100) first_name?: string | null;
  @IsOptional() @IsString() @Length(1, 100) last_name?: string | null;
  @IsOptional() @IsString() @Length(1, 200) legal_name?: string | null;
  @IsOptional() @IsString() @Length(1, 40) document_type?: string | null;
  @IsOptional() @IsString() @Length(1, 40) document_number?: string | null;
  @IsOptional() @Matches(/^[+0-9 ()-]{6,20}$/) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @IsString() @MaxLength(120) community?: string | null;
  @IsOptional() @IsString() @MaxLength(100) province?: string | null;
  @IsOptional() @IsString() @MaxLength(100) canton?: string | null;
  @IsOptional() @IsString() @MaxLength(100) parish?: string | null;
}
class PlotCreatePayload {
  @IsOptional() @IsUUID() producer_id?: string;
  @IsOptional() @IsUUID() producer_local_ref?: string;
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/) plot_code!: string;
  @IsString() @Length(1, 60) crop!: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string | null;
  @IsOptional() @IsString() @MaxLength(60) variety?: string | null;
  @IsOptional() @IsString() @MaxLength(80) land_use?: string | null;
  @IsOptional() @IsString() @MaxLength(100) province?: string | null;
  @IsOptional() @IsString() @MaxLength(100) canton?: string | null;
  @IsOptional() @IsString() @MaxLength(100) parish?: string | null;
}
/** Declaración de entrega capturada sin conexión. Es una DECLARACIÓN (borrador o, si se pide y la compuerta lo permite, registrada): no es recepción, pesaje ni movimiento de inventario. */
class DeliveryOriginPayload {
  @IsOptional() @IsUUID() plot_id?: string;
  @IsOptional() @IsUUID() plot_local_ref?: string;
  @IsOptional() @IsString() @Matches(/^\d{1,12}(\.\d{1,3})?$/) quantity?: string;
}
class DeliveryCreatePayload {
  @IsOptional() @IsUUID() producer_id?: string;
  @IsOptional() @IsUUID() producer_local_ref?: string;
  @IsOptional() @IsUUID() product_id?: string;
  @IsOptional() @IsUUID() location_id?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) delivery_date?: string;
  @IsOptional() @IsString() @Matches(/^\d{1,12}(\.\d{1,3})?$/) quantity_declared?: string;
  @IsOptional() @IsIn(['KG']) unit?: 'KG';
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => DeliveryOriginPayload) origins?: DeliveryOriginPayload[];
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @IsOptional() @IsBoolean() register?: boolean;
}
class PhotoPayload {
  @IsUUID() plot_id!: string;
  @Matches(/^[0-9a-f]{64}$/) sha256!: string;
  @IsInt() @Min(1) size_bytes!: number;
  @IsIn(['image/jpeg', 'image/png']) mime_type!: string;
  @IsString() @Length(1, 160) caption!: string;
}
class PullQuery { @IsUUID() device_id!: string; @IsOptional() @IsUUID() cursor?: string }
class UploadFields { @IsUUID() device_id!: string }

type Status = 'ACCEPTED' | 'DUPLICATE' | 'REJECTED' | 'CONFLICT' | 'DEPENDENCY_PENDING' | 'FORBIDDEN' | 'TRANSIENT_ERROR';
interface OpResult { operation_id: string; status: Status; replayed: boolean; result: Record<string, unknown> | null; error: { code: string; message: string; details?: unknown } | null }
const err = (code: string, message: string, details?: unknown) => ({ code, message, ...(details === undefined ? {} : { details }) });

@Injectable()
export class SyncService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly plots: PlotsService,
    private readonly documents: DocumentsService,
    private readonly polygons: PolygonDraftsService,
    private readonly producers: ProducersService,
    private readonly deliveries: DeliveriesService,
    private readonly products: ProductsService,
  ) {}

  private has(ctx: TenantContext, p: string) { return (ctx.permissions as string[]).includes(p); }
  private async ctx(user: AuthUser, orgId: string, mutation: boolean) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, 'sync:use')) throw forbidden('PERMISSION_DENIED', 'Tu rol no usa la sincronización de campo en esta organización.');
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }
  /** El dispositivo debe ser del usuario autenticado, de esta organización y estar activo. Otro dispositivo = inexistente. */
  private async device(ctx: TenantContext, user: AuthUser, deviceId: string) {
    const d = await this.db.selectFrom('devices').selectAll().where('organization_id', '=', ctx.organizationId).where('id', '=', deviceId).executeTakeFirst();
    if (!d || d.user_id !== user.id) throw new AppError(404, 'DEVICE_NOT_FOUND', 'El dispositivo no está registrado para tu cuenta en esta organización.');
    if (d.status !== 'ACTIVE') throw forbidden('DEVICE_REVOKED', 'Este dispositivo fue revocado: no puede enviar ni recibir datos. Tus capturas locales se conservan; contacta al administrador.');
    return d;
  }

  // ---- Dispositivos ----
  async registerDevice(user: AuthUser, orgId: string, dto: RegisterDeviceDto, requestId?: string) {
    await this.ctx(user, orgId, true);
    const existing = await this.db.selectFrom('devices').selectAll().where('organization_id', '=', orgId).where('user_id', '=', user.id).where('client_device_id', '=', dto.client_device_id).executeTakeFirst();
    if (existing) {
      if (existing.status === 'REVOKED') throw forbidden('DEVICE_REVOKED', 'Este dispositivo fue revocado y no puede volver a registrarse.');
      return { replayed: true, device: this.deviceView(existing) };
    }
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('devices').values({ id, organization_id: orgId, user_id: user.id, client_device_id: dto.client_device_id, platform: dto.platform, label: dto.label.trim(), status: 'ACTIVE', revoked_at: null, revoked_by: null, revoke_reason: null }).execute();
      await this.events.append(trx, { organizationId: orgId, eventType: 'DeviceRegistered', schemaVersion: 1, aggregateType: 'DEVICE', aggregateId: id, aggregateVersion: 1, actorId: user.id, correlationId: requestId, payload: { device_id: id, platform: dto.platform } });
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'device.register', entityType: 'device', entityId: id, requestId, result: 'SUCCESS', after: { reason: dto.platform } });
    });
    return { replayed: false, device: this.deviceView((await this.db.selectFrom('devices').selectAll().where('id', '=', id).executeTakeFirstOrThrow())) };
  }
  private deviceView(d: { id: string; user_id: string; platform: string; label: string; status: string; registered_at: unknown; revoked_at: unknown; revoke_reason: string | null }) {
    return { id: d.id, user_id: d.user_id, platform: d.platform, label: d.label, status: d.status, registered_at: d.registered_at, revoked_at: d.revoked_at, revoke_reason: d.revoke_reason,
      note: 'El identificador del dispositivo no concede autorización: cada envío revalida sesión, membresía y permisos.' };
  }
  async listDevices(user: AuthUser, orgId: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    const all = this.has(ctx, 'device:manage');
    if (!all && !this.has(ctx, 'sync:use')) throw forbidden();
    let q = this.db.selectFrom('devices').selectAll().where('organization_id', '=', orgId);
    if (!all) q = q.where('user_id', '=', user.id);
    return (await q.orderBy('registered_at', 'desc').execute()).map((d) => this.deviceView(d));
  }
  async revokeDevice(user: AuthUser, orgId: string, id: string, dto: RevokeDto, requestId?: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    const d = await this.db.selectFrom('devices').selectAll().where('organization_id', '=', orgId).where('id', '=', id).executeTakeFirst();
    const allowed = d && (this.has(ctx, 'device:manage') || (d.user_id === user.id && this.has(ctx, 'sync:use')));
    if (!d || !allowed) throw new AppError(404, 'DEVICE_NOT_FOUND', 'Dispositivo inexistente o fuera de tu alcance.');
    if (d.status === 'REVOKED') return { replayed: true, device: this.deviceView(d) };
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('devices').set({ status: 'REVOKED', revoked_at: new Date(), revoked_by: user.id, revoke_reason: dto.reason.trim() }).where('id', '=', id).execute();
      await this.events.append(trx, { organizationId: orgId, eventType: 'DeviceRevoked', schemaVersion: 1, aggregateType: 'DEVICE', aggregateId: id, aggregateVersion: 2, actorId: user.id, correlationId: requestId, payload: { device_id: id } });
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'device.revoke', entityType: 'device', entityId: id, requestId, result: 'SUCCESS', after: { reason: dto.reason.trim() } });
    });
    return { replayed: false, device: this.deviceView((await this.db.selectFrom('devices').selectAll().where('id', '=', id).executeTakeFirstOrThrow())) };
  }

  // ---- Push ----
  async push(user: AuthUser, orgId: string, dto: PushDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, true);
    const device = await this.device(ctx, user, dto.device_id);
    const results: OpResult[] = [];
    for (const op of dto.operations) results.push(await this.pushOne(user, ctx, device.id, op, requestId));
    const count = (s: Status) => results.filter((r) => r.status === s).length;
    await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'sync.push', entityType: 'device', entityId: device.id, requestId, result: 'SUCCESS',
      after: { reason: `${results.length} operación(es): ${count('ACCEPTED')} aceptadas, ${count('DUPLICATE')} duplicadas, ${count('REJECTED')} rechazadas, ${count('CONFLICT')} en conflicto, ${count('DEPENDENCY_PENDING')} con dependencia pendiente, ${count('FORBIDDEN')} prohibidas` } });
    return { device_id: device.id, results };
  }

  private async validatePayload<T extends object>(cls: new () => T, payload: unknown): Promise<T | { invalid: string[] }> {
    const inst = plainToInstance(cls, payload);
    const errors = await validate(inst as object, { whitelist: true, forbidNonWhitelisted: true });
    return errors.length ? { invalid: errors.map((e) => e.property) } : inst;
  }

  /** Autorización actual para el tipo y el recurso (también al devolver un resultado anterior). */
  private async authorizeType(user: AuthUser, ctx: TenantContext, type: string, plotId: string | undefined): Promise<{ code: string; message: string } | null> {
    const need: Permission[] = type === 'PLOT_LOCATION_SAMPLE_CREATE' || type === 'PLOT_POLYGON_VERTEX_ADD' ? ['plot:read_geometry'] : type === 'PLOT_PHOTO_ATTACH' ? ['document:upload'] : [];
    if ((type === 'PLOT_LOCATION_SAMPLE_CREATE' || type === 'PLOT_POLYGON_VERTEX_ADD') && !this.has(ctx, 'plot:update') && !this.has(ctx, 'plot:update_assigned') && !this.has(ctx, 'plot:update_own')) return { code: 'PERMISSION_DENIED', message: 'Tu rol ya no permite registrar ubicaciones en parcelas.' };
    if (type === 'PRODUCER_CREATE' && !this.has(ctx, 'producer:create')) return { code: 'PERMISSION_DENIED', message: 'Tu rol no permite registrar productores.' };
    if (type === 'DELIVERY_CREATE' && !this.has(ctx, 'delivery:create') && !this.has(ctx, 'delivery:create_assigned')) return { code: 'PERMISSION_DENIED', message: 'Tu rol no permite declarar entregas.' };
    if (type === 'PLOT_CREATE' && !this.has(ctx, 'plot:create') && !this.has(ctx, 'plot:create_assigned') && !this.has(ctx, 'plot:create_own')) return { code: 'PERMISSION_DENIED', message: 'Tu rol no permite registrar parcelas.' };
    if (!need.every((p) => this.has(ctx, p))) return { code: 'PERMISSION_DENIED', message: 'Tu rol ya no permite esta operación.' };
    if (plotId) {
      try { await this.plots.get(user, ctx.organizationId, plotId); } catch { return { code: 'RESOURCE_NOT_AVAILABLE', message: 'La parcela no existe o ya no está en tu alcance.' }; }
    }
    return null;
  }

  private async attachmentStatus(orgId: string, operationId: string) {
    const u = await this.db.selectFrom('sync_attachment_uploads').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', operationId).executeTakeFirst();
    if (!u) return { status: 'AWAITING_CONTENT', note: 'El registro llegó; el archivo todavía no. Metadata recibida no significa archivo disponible.' };
    const scan = (await sql<{ result: string | null }>`SELECT result FROM document_version_scans WHERE version_id = ${u.version_id} ORDER BY id DESC LIMIT 1`.execute(this.db)).rows[0]?.result ?? null;
    return { status: scan === 'CLEAN' ? 'AVAILABLE' : scan === 'INFECTED' ? 'REJECTED' : 'PENDING_SCAN', document_id: u.document_id, version_id: u.version_id,
      note: scan === 'CLEAN' ? 'Archivo procesado por la app (sin metadatos embebidos salvo la orientación), íntegro y analizado; disponible según los permisos de Documentos. No prueba captura real ni verifica ninguna afirmación.' : 'Archivo recibido; análisis antimalware pendiente o fallido: no disponible todavía.' };
  }

  private async pushOne(user: AuthUser, ctx: TenantContext, deviceId: string, op0: OperationDto, requestId?: string): Promise<OpResult> {
    let op = op0; // `op0` es lo recibido (el hash se calcula sobre ello); `op` es la operación con las referencias locales ya resueltas
    const orgId = ctx.organizationId;
    const base = { operation_id: op.operation_id, replayed: false, result: null, error: null } as OpResult;
    const content = { operation_type: op0.operation_type, entity_id: op0.entity_id, base_version: op0.base_version ?? null, depends_on: op0.depends_on, captured_at: op0.captured_at, payload: op0.payload };
    const hash = operationHash(content);
    if (hash !== op0.content_hash) return { ...base, status: 'REJECTED', error: err('HASH_MISMATCH', 'El hash del contenido no coincide con lo recibido: la operación llegó alterada o incompleta. Se conserva en el dispositivo.') };
    let plotId = typeof op0.payload.plot_id === 'string' ? op0.payload.plot_id : undefined;
    try {
      return await this.db.transaction().execute(async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${`sync:${orgId}:${op.operation_id}`}))`.execute(trx);
        // Referencias locales: se resuelven SOLO por la tabla de correspondencias de ESTA organización y ESTE usuario (nunca por nombre ni proximidad).
        const refOf = (local: string, type: 'PRODUCER' | 'PLOT' | 'DELIVERY') => trx.selectFrom('sync_entity_refs').selectAll().where('organization_id', '=', orgId).where('user_id', '=', user.id).where('local_ref', '=', local).where('entity_type', '=', type).executeTakeFirst();
        // Si una dependencia ya fue rechazada o quedó en conflicto, la referencia no se va a resolver con ella: se dice así, no como espera.
        const unresolved = async (message: string) => {
          const deps = op0.depends_on.length ? await trx.selectFrom('sync_operations').select(['operation_id', 'status']).where('organization_id', '=', orgId).where('operation_id', 'in', op0.depends_on).execute() : [];
          const failed = deps.filter((d) => d.status !== 'ACCEPTED');
          if (failed.length) return this.store(trx, user, ctx, deviceId, op0, hash, 'REJECTED', null, err('DEPENDENCY_FAILED', 'Una operación previa fue rechazada o quedó en conflicto: resuélvela primero.', failed.map((d) => d.operation_id)));
          return { ...base, status: 'DEPENDENCY_PENDING' as Status, error: err('LOCAL_REF_UNRESOLVED', message) };
        };
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const k of ['plot_local_ref', 'producer_local_ref']) { // (las de los orígenes de una entrega se validan con su clase)
          const v = op0.payload[k];
          if (v !== undefined && (typeof v !== 'string' || !UUID_RE.test(v))) return this.store(trx, user, ctx, deviceId, op0, hash, 'REJECTED', null, err('PAYLOAD_INVALID', 'Una referencia local debe ser un UUID generado por el dispositivo; no se resuelve por nombre ni por otros datos.', [k]));
        }
        if (typeof op0.payload.plot_local_ref === 'string') {
          const ref = await refOf(op0.payload.plot_local_ref, 'PLOT');
          if (!ref) return unresolved('La parcela creada sin conexión todavía no está registrada en el servidor: se reintentará cuando su alta se acepte.');
          const { plot_local_ref: _drop, ...rest } = op0.payload; void _drop;
          // Primera captura sobre una parcela recién creada: la versión esperada es la que produjo su alta.
          op = { ...op0, payload: { ...rest, plot_id: ref.server_id }, base_version: op0.base_version ?? (ref.produced_row_version == null ? null : Number(ref.produced_row_version)) };
          plotId = ref.server_id;
        }
        const prior = await trx.selectFrom('sync_operations').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', op.operation_id).executeTakeFirst();
        if (prior) {
          if (prior.content_hash !== hash) return { ...base, status: 'CONFLICT' as Status, error: err('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.') };
          const denied = await this.authorizeType(user, ctx, prior.operation_type, plotId);
          if (denied) return { ...base, status: 'FORBIDDEN' as Status, error: err(denied.code, denied.message) };
          const r = prior.result as Record<string, unknown>;
          const result = prior.operation_type === 'PLOT_PHOTO_ATTACH' && prior.status === 'ACCEPTED' ? { ...r, attachment: await this.attachmentStatus(orgId, op.operation_id) } : r;
          return { ...base, replayed: true, status: (prior.status === 'ACCEPTED' ? 'DUPLICATE' : prior.status) as Status, result: prior.status === 'ACCEPTED' ? result : null,
            error: prior.status === 'ACCEPTED' ? null : (r.error as OpResult['error']) };
        }
        // Dependencias: deben estar aceptadas en ESTA organización (una ajena cuenta como inexistente).
        if (op.depends_on.length) {
          const deps = await trx.selectFrom('sync_operations').select(['operation_id', 'status']).where('organization_id', '=', orgId).where('operation_id', 'in', op.depends_on).execute();
          if (deps.length < new Set(op.depends_on).size) return { ...base, status: 'DEPENDENCY_PENDING' as Status, error: err('DEPENDENCY_PENDING', 'Falta confirmar una operación de la que depende; se reintentará.', op.depends_on.filter((d) => !deps.some((x) => x.operation_id === d))) };
          const failed = deps.filter((d) => d.status !== 'ACCEPTED');
          if (failed.length) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('DEPENDENCY_FAILED', 'Una operación previa fue rechazada o quedó en conflicto: resuélvela primero.', failed.map((f) => f.operation_id)));
        }
        if (!(SUPPORTED_OPERATION_TYPES as readonly string[]).includes(op.operation_type)) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('UNSUPPORTED_OPERATION_TYPE', `Tipo de operación no soportado por la sincronización: ${op.operation_type}.`));
        const denied = await this.authorizeType(user, ctx, op.operation_type, plotId);
        if (denied) return { ...base, status: 'FORBIDDEN' as Status, error: err(denied.code, denied.message) };

        if (op.operation_type === 'PLOT_LOCATION_SAMPLE_CREATE') {
          const p = await this.validatePayload(LocationPayload, op.payload);
          if ('invalid' in p) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('PAYLOAD_INVALID', 'Contenido de la muestra no válido.', p.invalid));
          if (op.base_version == null) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('BASE_VERSION_REQUIRED', 'Falta la versión de la parcela sobre la que se capturó.'));
          if (p.resolves_operation_id) {
            const r = await trx.selectFrom('sync_operations').select(['status', 'operation_type']).where('organization_id', '=', orgId).where('operation_id', '=', p.resolves_operation_id).executeTakeFirst();
            if (!r || r.status !== 'CONFLICT' || r.operation_type !== op.operation_type) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('RESOLVES_INVALID', 'La operación que dice resolver no existe o no está en conflicto.'));
          }
          try {
            const r = await this.plots.captureLocation(user, orgId, p.plot_id, { expected_version: op.base_version, operation_id: op.operation_id, source: 'BROWSER_GEOLOCATION', longitude: p.longitude, latitude: p.latitude, accuracy_m: p.accuracy_m, captured_at: p.acquired_at },
              requestId, { provider_detail: p.provider_detail, mocked: p.mocked, device_id: deviceId });
            return this.store(trx, user, ctx, deviceId, op, hash, 'ACCEPTED', { plot_id: p.plot_id, plot_version_id: r.version.id, plot_row_version: r.plot_row_version, source: 'DEVICE_LOCATION_SERVICE', accuracy_m: p.accuracy_m, acquired_at: p.acquired_at }, null, p.resolves_operation_id);
          } catch (e) {
            if (e instanceof AppError && e.status === 409) {
              const code = e.code;
              const current = await this.plots.get(user, orgId, p.plot_id).then((x) => Number((x as { row_version: number }).row_version)).catch(() => null);
              return this.store(trx, user, ctx, deviceId, op, hash, 'CONFLICT', null, err(code, (e as Error).message, { base_version: op.base_version, server_row_version: current, resolution: 'Revisa la parcela y reenvía la muestra sobre la versión actual (nueva operación). No hay sobrescritura automática.' }));
            }
            if (e instanceof AppError && e.status < 500) {
              return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err(e.code, e.message, e.details));
            }
            throw e;
          }
        }
        if (op.operation_type === 'DELIVERY_CREATE') {
          const p = await this.validatePayload(DeliveryCreatePayload, op.payload);
          if ('invalid' in p) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('PAYLOAD_INVALID', 'Contenido de la entrega no válido.', p.invalid));
          if ((p.producer_id ? 1 : 0) + (p.producer_local_ref ? 1 : 0) !== 1) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('PRODUCER_REFERENCE_INVALID', 'Indica el productor con exactamente una referencia: su identificador del servidor o su referencia local.'));
          if ((p.origins ?? []).some((o) => (o.plot_id ? 1 : 0) + (o.plot_local_ref ? 1 : 0) !== 1)) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('ORIGIN_REFERENCE_INVALID', 'Cada origen debe citar su parcela con exactamente una referencia.'));
          let producerId = p.producer_id;
          if (p.producer_local_ref) {
            const pr = await refOf(p.producer_local_ref, 'PRODUCER');
            if (!pr) return unresolved('El productor creado sin conexión todavía no está registrado en el servidor.');
            producerId = pr.server_id;
          }
          const origins: Array<{ plot_id: string; quantity?: string }> = [];
          for (const o of p.origins ?? []) {
            let pid = o.plot_id;
            if (o.plot_local_ref) {
              const q = await refOf(o.plot_local_ref, 'PLOT');
              if (!q) return unresolved('Una parcela de origen creada sin conexión todavía no está registrada en el servidor.');
              pid = q.server_id;
            }
            origins.push({ plot_id: pid!, ...(o.quantity ? { quantity: o.quantity } : {}) });
          }
          try {
            // Idempotente por operation_id (la entrega guarda el identificador de operación): un reintento tras una respuesta perdida no duplica.
            const r = await this.deliveries.create(user, orgId, { operation_id: op.operation_id, producer_id: producerId!, product_id: p.product_id, location_id: p.location_id, delivery_date: p.delivery_date, quantity_declared: p.quantity_declared, unit: p.unit, origins, notes: p.notes, register: p.register === true } as never, requestId);
            const d = r.delivery as { id: string; code?: string; status?: string };
            await trx.insertInto('sync_entity_refs').values({ organization_id: orgId, user_id: user.id, local_ref: op.entity_id, entity_type: 'DELIVERY', server_id: d.id, operation_id: op.operation_id, device_id: deviceId, produced_row_version: null }).onConflict((oc) => oc.doNothing()).execute();
            return this.store(trx, user, ctx, deviceId, op, hash, 'ACCEPTED', { entity: 'DELIVERY', local_ref: op.entity_id, server_id: d.id, delivery_code: d.code ?? null, delivery_status: d.status ?? null, replayed: r.replayed,
              note: 'Declaración registrada. No es una recepción, un pesaje confirmado ni un movimiento de inventario: esas son transiciones aparte, con su autorización.' }, null);
          } catch (e) {
            if (e instanceof AppError && e.status < 500) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err(e.code, e.message, e.details));
            throw e;
          }
        }
        if (op.operation_type === 'PRODUCER_CREATE' || op.operation_type === 'PLOT_CREATE') {
          const isProducer = op.operation_type === 'PRODUCER_CREATE';
          const p = isProducer ? await this.validatePayload(ProducerCreatePayload, op.payload) : await this.validatePayload(PlotCreatePayload, op.payload);
          if ('invalid' in p) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('PAYLOAD_INVALID', 'Contenido del alta no válido.', p.invalid));
          const used = await trx.selectFrom('sync_entity_refs').select('server_id').where('organization_id', '=', orgId).where('user_id', '=', user.id).where('local_ref', '=', op.entity_id).executeTakeFirst();
          if (used) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('LOCAL_REF_ALREADY_USED', 'Esa referencia local ya se resolvió con otra operación.', { server_id: used.server_id }));
          // Un alta que falla por una regla (código repetido, productor fuera de alcance) no debe dejar la transacción abortada: punto de guarda.
          await sql`SAVEPOINT alta_local`.execute(trx);
          try {
            let entity: Record<string, unknown>; let serverId: string; let version: number | null = null;
            if (isProducer) {
              const r = await this.producers.createForSync(trx, ctx, user, p as ProducerCreatePayload, requestId);
              serverId = r.id; entity = { entity: 'PRODUCER', producer_code: r.producer_code, duplicate_reviews_pending: r.duplicate_reviews_pending };
            } else {
              const pc = p as PlotCreatePayload;
              if ((pc.producer_id ? 1 : 0) + (pc.producer_local_ref ? 1 : 0) !== 1) {
                await sql`ROLLBACK TO SAVEPOINT alta_local`.execute(trx);
                return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('PRODUCER_REFERENCE_INVALID', 'Indica el productor con exactamente una referencia: su identificador del servidor o su referencia local.'));
              }
              let producerId = pc.producer_id;
              if (pc.producer_local_ref) {
                const pr = await refOf(pc.producer_local_ref, 'PRODUCER');
                if (!pr) { await sql`ROLLBACK TO SAVEPOINT alta_local`.execute(trx); return unresolved('El productor creado sin conexión todavía no está registrado en el servidor.'); }
                producerId = pr.server_id;
              }
              const r = await this.plots.createForSync(trx, ctx, user, { ...pc, producer_id: producerId! }, requestId);
              serverId = r.id; version = r.row_version; entity = { entity: 'PLOT', plot_code: r.plot_code, plot_row_version: r.row_version, producer_id: producerId };
            }
            await trx.insertInto('sync_entity_refs').values({ organization_id: orgId, user_id: user.id, local_ref: op.entity_id, entity_type: isProducer ? 'PRODUCER' : 'PLOT', server_id: serverId, operation_id: op.operation_id, device_id: deviceId, produced_row_version: version === null ? null : String(version) }).execute();
            await sql`RELEASE SAVEPOINT alta_local`.execute(trx);
            return this.store(trx, user, ctx, deviceId, op, hash, 'ACCEPTED', { ...entity, local_ref: op.entity_id, server_id: serverId, note: 'Alta registrada con su identificador definitivo. Lo que dependa de la referencia local se resuelve con esta correspondencia.' }, null);
          } catch (e) {
            await sql`ROLLBACK TO SAVEPOINT alta_local`.execute(trx);
            if (e instanceof AppError && e.status < 500) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err(e.code, e.message, e.details));
            throw e;
          }
        }
        if (op.operation_type === 'PLOT_POLYGON_VERTEX_ADD') {
          const p = await this.validatePayload(VertexPayload, op.payload);
          if ('invalid' in p) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('PAYLOAD_INVALID', 'Contenido del vértice no válido.', p.invalid));
          if (p.vertex_seq === 1 && op.base_version == null) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('BASE_VERSION_REQUIRED', 'Falta la versión de la parcela sobre la que se capturó el primer vértice.'));
          if (p.resolves_operation_id) {
            const r = await trx.selectFrom('sync_operations').select(['status', 'operation_type']).where('organization_id', '=', orgId).where('operation_id', '=', p.resolves_operation_id).executeTakeFirst();
            if (!r || r.status !== 'CONFLICT' || r.operation_type !== op.operation_type) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('RESOLVES_INVALID', 'La operación que dice resolver no existe o no está en conflicto.'));
          }
          const conflict = async (code: string, message: string, resolution: string) => {
            const server = await this.plots.get(user, orgId, p.plot_id).then((x) => Number((x as { row_version: number }).row_version)).catch(() => null);
            return this.store(trx, user, ctx, deviceId, op, hash, 'CONFLICT', null, err(code, message, { base_version: op.base_version, server_row_version: server, resolution }), p.resolves_operation_id);
          };
          try {
            const open = (await this.polygons.current(user, orgId, p.plot_id)).draft;
            let draft = open;
            if (p.vertex_seq === 1) {
              // Primer vértice: la captura abre su borrador, o continúa el que ya abrió ella (reenvío). Un borrador de otra captura o de la web NO se mezcla.
              if (open && open.origin_capture_id !== p.capture_id) {
                return conflict('DRAFT_OPEN_FROM_OTHER_SOURCE', 'La parcela ya tiene un borrador de polígono abierto que no es de esta captura (otra captura o la web). Los vértices no se mezclan.',
                  'Cierra o confirma ese borrador en la web y reenvía la captura; tus vértices se conservan en el dispositivo.');
              }
              if (!open) {
                const current = await this.plots.get(user, orgId, p.plot_id).then((x) => Number((x as { row_version: number }).row_version));
                // Si esta misma captura ya registró su punto de ubicación (operación de la que depende), la versión esperada es la que produjo
                // esa operación: un cambio provocado por la propia sincronización no es un conflicto.
                const own = op.depends_on.length ? await trx.selectFrom('sync_operations').select('result').where('organization_id', '=', orgId).where('operation_id', 'in', op.depends_on)
                  .where('operation_type', '=', 'PLOT_LOCATION_SAMPLE_CREATE').where('status', '=', 'ACCEPTED').execute() : [];
                const ownVersions = own.map((x) => Number((typeof x.result === 'string' ? JSON.parse(x.result) : x.result as Record<string, unknown>).plot_row_version)).filter((n) => Number.isFinite(n));
                const expected = ownVersions.length ? Math.max(...ownVersions) : op.base_version;
                if (current !== expected) {
                  return conflict('VERSION_CONFLICT', 'La parcela cambió (por ejemplo, desde la web) mientras capturabas sin conexión.', `Revisa la parcela (versión ${current}) y reenvía la captura sobre ella; tus vértices se conservan.`);
                }
                draft = await this.polygons.start(user, orgId, p.plot_id, requestId, { capture_id: p.capture_id, device_id: deviceId });
              }
            } else if (!open || open.origin_capture_id !== p.capture_id) {
              return conflict('DRAFT_NOT_OPEN_FOR_CAPTURE', 'El borrador de polígono de esta captura ya no está abierto (se confirmó o canceló en la web) o lo reemplazó otro.',
                'Revisa el estado del borrador en la web; tus vértices se conservan en el dispositivo y se pueden reenviar sobre un borrador nuevo.');
            }
            const r = await this.polygons.addVertex(user, orgId, draft!.id, { expected_version: draft!.row_version, operation_id: op.operation_id, source: 'BROWSER_GEOLOCATION', longitude: p.longitude, latitude: p.latitude, accuracy_m: p.accuracy_m, captured_at: p.acquired_at },
              requestId, { provider_detail: p.provider_detail, mocked: p.mocked, device_id: deviceId, expect: { capture_id: p.capture_id, prior_vertices: p.vertex_seq - 1 } });
            return this.store(trx, user, ctx, deviceId, op, hash, 'ACCEPTED', { plot_id: p.plot_id, draft_id: r.draft.id, draft_row_version: r.draft.row_version, vertex_count: r.draft.vertices.length, confirmed: false,
              note: 'El vértice quedó en el borrador de polígono de la parcela. No hay geometría nueva hasta que una persona revise y confirme el borrador en la web.' }, null, p.resolves_operation_id);
          } catch (e) {
            if (e instanceof AppError && e.status === 409) return conflict(e.code, e.message, 'Revisa el borrador de la parcela en la web; tu vértice se conserva en el dispositivo.');
            if (e instanceof AppError && e.status < 500) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err(e.code, e.message, e.details));
            throw e;
          }
        }
        // PLOT_PHOTO_ATTACH: se acepta el registro; el archivo llega aparte y pasa por Documentos (integridad, escaneo, permisos).
        const p = await this.validatePayload(PhotoPayload, op.payload);
        if ('invalid' in p) return this.store(trx, user, ctx, deviceId, op, hash, 'REJECTED', null, err('PAYLOAD_INVALID', 'Contenido de la foto no válido.', p.invalid));
        return this.store(trx, user, ctx, deviceId, op, hash, 'ACCEPTED', { plot_id: p.plot_id, sha256: p.sha256, size_bytes: p.size_bytes, mime_type: p.mime_type, caption: p.caption, attachment: { status: 'AWAITING_CONTENT', note: 'El registro llegó; el archivo todavía no.' } }, null);
      });
    } catch (e) {
      if (e instanceof AppError && e.status < 500) {
        return { ...base, status: 'REJECTED', error: err(e.code, e.message) };
      }
      return { ...base, status: 'TRANSIENT_ERROR', error: err('TRANSIENT_ERROR', 'Error temporal del servidor: la operación se conserva y se reintentará con el mismo identificador.') };
    }
  }

  private async store(trx: Kysely<Database>, user: AuthUser, ctx: TenantContext, deviceId: string, op: OperationDto, hash: string, status: 'ACCEPTED' | 'REJECTED' | 'CONFLICT', result: Record<string, unknown> | null, error: OpResult['error'], resolves?: string): Promise<OpResult> {
    await trx.insertInto('sync_operations').values({ id: randomUUID(), organization_id: ctx.organizationId, operation_id: op.operation_id, operation_type: op.operation_type, entity_id: op.entity_id, content_hash: hash,
      depends_on: JSON.stringify(op.depends_on), base_version: op.base_version == null ? null : String(op.base_version), captured_at: new Date(op.captured_at), resolves_operation_id: resolves ?? null,
      status, result: JSON.stringify(result ?? { error }), user_id: user.id, device_id: deviceId }).execute();
    return { operation_id: op.operation_id, status, replayed: false, result, error };
  }

  // ---- Adjuntos ----
  async uploadAttachment(user: AuthUser, orgId: string, operationId: string, fields: UploadFields, file: { buffer: Buffer; mimetype: string; originalname: string } | undefined, requestId?: string) {
    const ctx = await this.ctx(user, orgId, true);
    const v = await validate(plainToInstance(UploadFields, fields));
    if (v.length) throw new AppError(400, 'VALIDATION_FAILED', 'device_id es obligatorio.', [{ field: 'device_id', reason: 'REQUIRED_UUID' }]);
    const device = await this.device(ctx, user, fields.device_id);
    const op = await this.db.selectFrom('sync_operations').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', operationId).executeTakeFirst();
    if (!op || op.user_id !== user.id || op.operation_type !== 'PLOT_PHOTO_ATTACH') throw new AppError(404, 'OPERATION_NOT_FOUND', 'No hay una foto registrada con ese identificador para tu cuenta.');
    if (op.status !== 'ACCEPTED') throw conflict('OPERATION_NOT_ACCEPTED', 'La operación de la foto no fue aceptada.');
    const r = op.result as { plot_id: string; sha256: string; size_bytes: number; mime_type: string; caption: string };
    const denied = await this.authorizeType(user, ctx, 'PLOT_PHOTO_ATTACH', r.plot_id);
    if (denied) throw forbidden(denied.code, denied.message);
    const existing = await this.db.selectFrom('sync_attachment_uploads').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', operationId).executeTakeFirst();
    if (existing) return { replayed: true, attachment: await this.attachmentStatus(orgId, operationId) };
    if (!file?.buffer?.length) throw new AppError(400, 'VALIDATION_FAILED', 'Adjunta el archivo.', [{ field: 'file', reason: 'REQUIRED' }]);
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    if (file.buffer.length !== r.size_bytes || sha !== r.sha256) {
      await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'sync.attachment_rejected', entityType: 'device', entityId: device.id, requestId, result: 'DENIED', after: { reason: 'ATTACHMENT_INTEGRITY_MISMATCH' } });
      throw new AppError(422, 'ATTACHMENT_INTEGRITY_MISMATCH', 'El archivo recibido no coincide con el registrado (tamaño o SHA-256): transferencia incompleta o alterada. Se conserva en el dispositivo; reintenta.', [{ field: 'file', reason: 'INTEGRITY_MISMATCH' }]);
    }
    // D-41: metadatos embebidos (EXIF/XMP con coordenadas o dispositivo) eludirían la clasificación: se rechaza.
    if (hasImageMetadata(new Uint8Array(file.buffer), r.mime_type)) {
      await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'sync.attachment_rejected', entityType: 'device', entityId: device.id, requestId, result: 'DENIED', after: { reason: 'PHOTO_METADATA_PRESENT' } });
      throw new AppError(422, 'PHOTO_METADATA_PRESENT', 'La foto conserva metadatos embebidos (EXIF/XMP) o no tiene una estructura válida: la app debe quitarlos antes de enviarla.', [{ field: 'file', reason: 'METADATA_PRESENT' }]);
    }
    // Título y nombre de archivo neutros: la leyenda libre de campo no se publica en el documento (podría contener datos
    // personales visibles sin permiso de identidad); se conserva solo en el registro de sincronización de su autor.
    const plotCode = await this.plots.get(user, orgId, r.plot_id).then((x) => (x as { plot_code: string }).plot_code).catch(() => 'parcela');
    const ext = r.mime_type === 'image/png' ? 'png' : 'jpg';
    const up = await this.documents.upload(user, orgId, { operation_id: operationId, document_type: 'FIELD_PHOTO', owner_type: 'plot', owner_id: r.plot_id, title: `Fotografía de campo · ${plotCode}` },
      { buffer: file.buffer, mimetype: r.mime_type, originalname: `foto-campo-${operationId.slice(0, 8)}.${ext}` } as never, null, requestId);
    const docView = up.document as { id: string; versions: Array<{ id: string; operation_id?: string; sha256?: string }> };
    const version = await this.db.selectFrom('document_versions').select('id').where('organization_id', '=', orgId).where('operation_id', '=', operationId).executeTakeFirstOrThrow();
    await this.db.insertInto('sync_attachment_uploads').values({ operation_id: operationId, organization_id: orgId, document_id: docView.id, version_id: version.id, sha256: sha, uploaded_by: user.id, device_id: device.id })
      .onConflict((oc) => oc.doNothing()).execute();
    return { replayed: up.replayed, attachment: await this.attachmentStatus(orgId, operationId) };
  }

  // ---- Pull ----
  async pull(user: AuthUser, orgId: string, q: PullQuery) {
    const ctx = await this.ctx(user, orgId, false);
    const device = await this.device(ctx, user, q.device_id);
    let prev: Record<string, number> = {};
    if (q.cursor) {
      const c = await this.db.selectFrom('sync_cursors').selectAll().where('organization_id', '=', orgId).where('id', '=', q.cursor).executeTakeFirst();
      if (!c || c.user_id !== user.id || c.device_id !== device.id) throw new AppError(400, 'CURSOR_INVALID', 'El cursor no corresponde a esta cuenta, organización y dispositivo: haz una descarga completa.');
      if (new Date(c.expires_at) < new Date()) throw new AppError(410, 'CURSOR_EXPIRED', 'El cursor caducó: haz una descarga completa. Tus operaciones pendientes se conservan.');
      prev = c.visible as Record<string, number>;
    }
    // Visibilidad ACTUAL (asignación y permisos de hoy): un cursor antiguo no conserva acceso.
    const current: Array<{ id: string; plot_code: string; name: string | null; row_version: number; status: string; producer: { id: string; producer_code: string | null; display_name: string | null }; geometry_status: string }> = [];
    let next: string | null | undefined;
    do {
      const page = await this.plots.list(user, orgId, { status: 'ACTIVE', limit: 100, ...(next ? { cursor: next } : {}) } as never) as { items: typeof current; next_cursor: string | null };
      current.push(...page.items);
      next = page.next_cursor;
    } while (next && current.length < 5000);
    const visible = Object.fromEntries(current.map((p) => [p.id, p.row_version]));
    const changes = current.filter((p) => prev[p.id] !== p.row_version).map((p) => ({ id: p.id, plot_code: p.plot_code, name: p.name, row_version: p.row_version, status: p.status, producer_id: p.producer.id,
      producer_code: p.producer.producer_code, producer_display_name: p.producer.display_name || null, geometry_status: p.geometry_status }));
    const tombstones = Object.keys(prev).filter((id) => !(id in visible));
    const id = randomUUID();
    const expires = new Date(Date.now() + CURSOR_TTL_DAYS * 86_400_000);
    await this.db.insertInto('sync_cursors').values({ id, organization_id: orgId, user_id: user.id, device_id: device.id, scope: 'PLOTS', visible: JSON.stringify(visible), expires_at: expires }).execute();
    // Datos de referencia para declarar entregas sin conexión (catálogo de productos y centros de la organización), solo si el rol los puede leer.
    const reference: { products: unknown[]; locations: unknown[] } = { products: [], locations: [] };
    if (this.has(ctx, 'delivery:create') || this.has(ctx, 'delivery:create_assigned')) {
      try { reference.products = (await this.products.list(user, orgId, { limit: 200 } as never)).items.map((p) => ({ id: p.id, code: p.code, name: p.name, product_state: p.product_state.code, unit: p.unit.code, status: p.status })); } catch { /* sin permiso de catálogo: vacío */ }
      try { reference.locations = (await this.deliveries.locations(user, orgId)).filter((l) => l.status === 'ACTIVE').map((l) => ({ id: l.id, code: l.code, name: l.name, location_type: l.location_type })); } catch { /* sin permiso de centros: vacío */ }
    }
    return { cursor: id, full: !q.cursor, expires_at: expires.toISOString(), changes, tombstones, reference,
      note: 'Los tombstones solo incluyen recursos que este cursor había entregado y que ya no están en tu alcance (baja, reasignación o permisos).' };
  }
}

@ApiTags('sync')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @Post('devices') register(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: RegisterDeviceDto, @Req() req: AuthedRequest) { return this.service.registerDevice(u, o, dto, req.requestId); }
  @Get('devices') devices(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.listDevices(u, o); }
  @Post('devices/:id/revoke') @HttpCode(200) revoke(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RevokeDto, @Req() req: AuthedRequest) { return this.service.revokeDevice(u, o, id, dto, req.requestId); }
  @Post('sync/push') @HttpCode(200) push(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: PushDto, @Req() req: AuthedRequest) { return this.service.push(u, o, dto, req.requestId); }
  @Get('sync/pull') pull(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Query() q: PullQuery) { return this.service.pull(u, o, q); }
  @Post('sync/attachments/:operationId/content')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['device_id', 'file'], properties: { device_id: { type: 'string', format: 'uuid' }, file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 16 * 1024 * 1024 } }))
  upload(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('operationId', ParseUUIDPipe) id: string, @Body() body: UploadFields, @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string } | undefined, @Req() req: AuthedRequest) {
    return this.service.uploadAttachment(u, o, id, body, file, req.requestId);
  }
}
