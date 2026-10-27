import {
  Body, Controller, Get, HttpCode, Inject, Injectable, Logger, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { DocumentUploadInterceptor } from './upload-limit.interceptor';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { sql, type Kysely, type Transaction } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { OBJECT_STORE, sha256, type ObjectStore } from '../storage/object-store';
import { MALWARE_SCANNER, type MalwareScanner } from '../storage/scanner';
import { StorageSweeper } from '../storage/sweeper';
import { ProducersService } from '../producers/producers';
import { PlotsService } from '../plots/plots';
import { hasImageMetadata } from '../sync/image-metadata';

// P0-018 Documentos. Cuatro cosas distintas (docs/12, UX_UI §17):
//   archivo RECIBIDO (versión registrada) · DISPONIBLE tras comprobaciones técnicas (último escaneo CLEAN) ·
//   documento REVISADO por una persona (revisión por versión) · EVIDENCIA que respalda una afirmación (P0-019).
// El hash detecta cambios de bytes; ni el hash ni el escaneo prueban autenticidad o validez jurídica.
// Pendiente, fallido o infectado nunca es disponible; una versión nueva no hereda revisiones.

type Db = Kysely<Database> | Transaction<Database>;
type OwnerType = 'producer' | 'plot' | 'delivery';
interface UploadedFileLike { buffer: Buffer; originalname?: string; mimetype?: string; size: number }
const docKey = (orgId: string, versionId: string) => `organizations/${orgId}/documents/${versionId}.bin`;

/** Tipo real por firma de bytes (no por extensión ni por la cabecera declarada). */
export function sniffMime(b: Buffer): string | null {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];

/**
 * Contenedor de archivo incrustado (políglota): clamd omite sin aviso los objetos de un ZIP mayores que MaxFileSize y
 * responde OK, aunque el envío pese poco. Los formatos admitidos no necesitan archivos comprimidos incrustados, así
 * que se rechazan de forma detectable en lugar de quedar parcialmente sin analizar y «disponibles».
 */
export function embeddedArchive(b: Buffer): string | null {
  const zipLocal = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const zipEnd = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  if (b.includes(zipLocal) && b.includes(zipEnd)) return 'ZIP';
  if (b.includes(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]))) return 'RAR';
  if (b.includes(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return '7Z';
  return null;
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;

class ReviewDto {
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED'] }) @IsIn(['ACCEPTED', 'REJECTED']) decision!: 'ACCEPTED' | 'REJECTED';
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
class LinkDto {
  @ApiProperty({ enum: ['producer', 'plot', 'delivery'] }) @IsIn(['producer', 'plot', 'delivery']) entity_type!: OwnerType;
  @ApiProperty() @IsUUID() entity_id!: string;
}
class ListQuery {
  @IsOptional() @IsIn(['producer', 'plot']) owner_type?: 'producer' | 'plot';
  @IsOptional() @IsUUID() owner_id?: string;
  @IsOptional() @IsString() @Length(1, 40) document_type?: string;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger('Documents');

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly producers: ProducersService,
    private readonly plots: PlotsService,
  ) {}

  private has(ctx: TenantContext, p: string) { return (ctx.permissions as string[]).includes(p); }

  private async ctx(user: AuthUser, orgId: string, perm: 'document:read' | 'document:upload' | 'document:review', mutation: boolean) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, perm)) throw forbidden();
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }

  /** Alcance sobre la entidad titular o vinculada (404 si está fuera de alcance o es ajena). */
  private async entityScope(db: Db, ctx: TenantContext, type: OwnerType, id: string, kind: 'read' | 'update') {
    if (type === 'delivery') throw new AppError(422, 'ENTITY_TYPE_NOT_AVAILABLE', 'Las entregas aún no existen; la vinculación llegará con P0-012.', [{ field: 'entity_type', reason: 'NOT_AVAILABLE' }]);
    if (type === 'producer') await this.producers.load(db, ctx, id, kind);
    else await this.plots.load(db, ctx, id, kind);
  }

  private async loadDoc(db: Db, ctx: TenantContext, id: string, kind: 'read' | 'update', lock = false) {
    let q = db.selectFrom('documents').selectAll().where('organization_id', '=', ctx.organizationId).where('id', '=', id);
    if (lock) q = q.forUpdate();
    const d = await q.executeTakeFirst();
    if (!d) throw notFound();
    await this.entityScope(db, ctx, d.owner_type as OwnerType, d.owner_id, kind);
    return d;
  }

  private parseMeta(body: Record<string, string>) {
    const meta = { issuer: body.issuer?.trim() || null, issued_at: body.issued_at?.trim() || null, expires_at: body.expires_at?.trim() || null };
    for (const f of ['issued_at', 'expires_at'] as const) {
      if (meta[f] && (!DATE.test(meta[f]!) || Number.isNaN(Date.parse(`${meta[f]}T00:00:00Z`)))) throw new AppError(400, 'VALIDATION_FAILED', 'Fecha no válida (AAAA-MM-DD).', [{ field: f, reason: 'DATE_INVALID' }]);
    }
    if (meta.issued_at && meta.expires_at && meta.issued_at > meta.expires_at) throw new AppError(400, 'VALIDATION_FAILED', 'La emisión es posterior al vencimiento.', [{ field: 'expires_at', reason: 'BEFORE_ISSUED_AT' }]);
    if (meta.issuer && meta.issuer.length > 160) throw new AppError(400, 'VALIDATION_FAILED', 'Emisor demasiado largo.', [{ field: 'issuer', reason: 'TOO_LONG' }]);
    return meta;
  }

  private checkFile(file: UploadedFileLike | undefined) {
    const real = sniffMime(file!.buffer);
    if (!real) throw new AppError(422, 'FILE_TYPE_NOT_ALLOWED', 'Formato no admitido. Se aceptan PDF, JPEG y PNG.', [{ field: 'file', reason: 'TYPE_NOT_ALLOWED' }]);
    if (file?.mimetype && ALLOWED_MIME.includes(file.mimetype) && file.mimetype !== real) {
      throw new AppError(422, 'FILE_TYPE_MISMATCH', 'El tipo declarado no coincide con el contenido del archivo.', [{ field: 'file', reason: 'MIME_MISMATCH' }]);
    }
    if (file?.mimetype && !ALLOWED_MIME.includes(file.mimetype) && file.mimetype !== 'application/octet-stream') {
      throw new AppError(422, 'FILE_TYPE_MISMATCH', 'El tipo declarado no coincide con el contenido del archivo.', [{ field: 'file', reason: 'MIME_MISMATCH' }]);
    }
    if (embeddedArchive(file!.buffer)) {
      throw new AppError(422, 'EMBEDDED_ARCHIVE_NOT_ALLOWED', 'El archivo contiene un archivo comprimido incrustado que no puede analizarse por completo. Exporta el documento de nuevo como PDF, JPEG o PNG sin adjuntos.', [{ field: 'file', reason: 'EMBEDDED_ARCHIVE' }]);
    }
    const name = (file?.originalname ?? 'documento').replace(/[\\/\0]/g, '_').slice(0, 255) || 'documento';
    return { real, name };
  }

  private async view(db: Db, ctx: TenantContext, documentId: string) {
    const d = await db.selectFrom('documents as d').innerJoin('document_types as t', 't.code', 'd.document_type')
      .select(['d.id', 'd.document_type', 't.label as type_label', 't.classification', 'd.owner_type', 'd.owner_id', 'd.title', 'd.current_version_id', 'd.row_version', 'd.created_at'])
      .where('d.organization_id', '=', ctx.organizationId).where('d.id', '=', documentId).executeTakeFirstOrThrow();
    const versions = await sql<{
      id: string; version_number: number; file_name: string; mime_type: string; size_bytes: number; sha256: string; issuer: string | null;
      issued_at: string | null; expires_at: string | null; uploaded_at: string; uploaded_by: string; scan_result: string | null; scan_signature: string | null;
      scan_error: string | null; scanned_at: string | null; review_decision: string | null; review_reason: string | null; reviewed_at: string | null; reviewer_is_uploader: boolean | null; expired: boolean;
    }>`
      SELECT v.id, v.version_number, v.file_name, v.mime_type, v.size_bytes, v.sha256, v.issuer, v.issued_at::text, v.expires_at::text, v.uploaded_at, v.uploaded_by,
             s.result AS scan_result, s.signature AS scan_signature, s.error_code AS scan_error, s.scanned_at,
             r.decision AS review_decision, r.reason AS review_reason, r.reviewed_at, (r.reviewer_id = v.uploaded_by) AS reviewer_is_uploader,
             (v.expires_at IS NOT NULL AND v.expires_at < current_date) AS expired
      FROM document_versions v
      LEFT JOIN LATERAL (SELECT * FROM document_version_scans x WHERE x.version_id = v.id ORDER BY x.id DESC LIMIT 1) s ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM document_version_reviews y WHERE y.version_id = v.id ORDER BY y.id DESC LIMIT 1) r ON TRUE
      WHERE v.organization_id = ${ctx.organizationId} AND v.document_id = ${documentId}
      ORDER BY v.version_number DESC`.execute(db);
    const links = await db.selectFrom('document_links').select(['entity_type', 'entity_id', 'created_at']).where('organization_id', '=', ctx.organizationId).where('document_id', '=', documentId).execute();
    const personal = d.classification === 'PERSONAL_DATA';
    const contentAllowed = !personal || this.personalContentAllowed(ctx, d.document_type);
    return {
      ...d, row_version: Number(d.row_version), content_access: contentAllowed ? 'ALLOWED' : 'RESTRICTED',
      versions: versions.rows.map((v) => {
        const availability = v.scan_result === 'CLEAN' ? 'AVAILABLE' : v.scan_result === 'INFECTED' ? 'REJECTED' : v.scan_result === 'FAILED' ? 'SCAN_FAILED' : 'PENDING';
        return {
          id: v.id, version_number: v.version_number, is_current: v.id === d.current_version_id,
          file_name: contentAllowed ? v.file_name : null, mime_type: v.mime_type, size_bytes: v.size_bytes, sha256: v.sha256,
          issuer: v.issuer, issued_at: v.issued_at, expires_at: v.expires_at, uploaded_at: v.uploaded_at,
          upload: 'COMPLETE',
          scan: { status: v.scan_result ?? 'PENDING', signature: v.scan_signature, error_code: v.scan_error, scanned_at: v.scanned_at },
          availability, validity: v.expires_at ? (v.expired ? 'EXPIRED' : 'VALID') : 'NO_EXPIRY',
          review: v.review_decision ? { decision: v.review_decision, reason: v.review_reason, reviewed_at: v.reviewed_at, reviewer_is_uploader: v.reviewer_is_uploader } : null,
          downloadable: availability === 'AVAILABLE' && contentAllowed,
        };
      }),
      links,
      note: 'El hash y el análisis antimalware no prueban autenticidad ni validez jurídica. La revisión humana es por versión; un documento no es evidencia aprobada (P0-019).',
    };
  }

  async types(user: AuthUser, orgId: string) {
    await this.ctx(user, orgId, 'document:read', false);
    return { types: await this.db.selectFrom('document_types').selectAll().orderBy('code').execute(), limits: { max_bytes: this.config.documents.maxBytes, formats: ALLOWED_MIME } };
  }

  async list(user: AuthUser, orgId: string, q: ListQuery) {
    const ctx = await this.ctx(user, orgId, 'document:read', false);
    let query = this.db.selectFrom('documents').select(['id', 'owner_type', 'owner_id']).where('organization_id', '=', orgId);
    if (q.owner_type) query = query.where('owner_type', '=', q.owner_type);
    if (q.owner_id) query = query.where('owner_id', '=', q.owner_id);
    if (q.document_type) query = query.where('document_type', '=', q.document_type);
    const rows = await query.orderBy('created_at', 'desc').limit(200).execute();
    const out = [];
    for (const r of rows) {
      const visible = await this.entityScope(this.db, ctx, r.owner_type as OwnerType, r.owner_id, 'read').then(() => true, () => false);
      if (visible) out.push(await this.view(this.db, ctx, r.id));
    }
    return out;
  }

  async get(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, 'document:read', false);
    await this.loadDoc(this.db, ctx, id, 'read');
    return this.view(this.db, ctx, id);
  }

  /** Alta de documento (versión 1) o de una versión nueva. Staging del objeto + compensación. */
  async upload(user: AuthUser, orgId: string, body: Record<string, string>, file: UploadedFileLike | undefined, documentId: string | null, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'document:upload', true);
    const operationId = body.operation_id;
    if (!operationId || !/^[0-9a-f-]{36}$/i.test(operationId)) throw new AppError(400, 'VALIDATION_FAILED', 'operation_id es obligatorio (UUID).', [{ field: 'operation_id', reason: 'REQUIRED_UUID' }]);
    const meta = this.parseMeta(body);
    let type: { code: string; allowed_owner_types: string[] } | undefined;
    let ownerType: OwnerType; let ownerId: string; let title = '';
    if (documentId) {
      const d = await this.loadDoc(this.db, ctx, documentId, 'update');
      ownerType = d.owner_type as OwnerType; ownerId = d.owner_id;
    } else {
      type = await this.db.selectFrom('document_types').select(['code', 'allowed_owner_types']).where('code', '=', body.document_type ?? '').executeTakeFirst();
      if (!type) throw new AppError(422, 'DOCUMENT_TYPE_UNKNOWN', 'Tipo de documento no admitido.', [{ field: 'document_type', reason: 'UNKNOWN' }]);
      ownerType = body.owner_type as OwnerType; ownerId = body.owner_id;
      if (!['producer', 'plot', 'delivery'].includes(ownerType) || !/^[0-9a-f-]{36}$/i.test(ownerId ?? '')) throw new AppError(400, 'VALIDATION_FAILED', 'Indica el titular del documento.', [{ field: 'owner_id', reason: 'REQUIRED' }]);
      if (!type.allowed_owner_types.includes(ownerType)) throw new AppError(422, 'OWNER_TYPE_NOT_ALLOWED', 'Este tipo de documento no admite ese titular.', [{ field: 'owner_type', reason: 'NOT_ALLOWED' }]);
      title = (body.title ?? '').trim();
      if (title.length < 1 || title.length > 160) throw new AppError(400, 'VALIDATION_FAILED', 'Indica un título (1–160).', [{ field: 'title', reason: 'REQUIRED' }]);
      await this.entityScope(this.db, ctx, ownerType, ownerId, 'update');
    }
    if (!file || !file.buffer?.length) throw new AppError(400, 'VALIDATION_FAILED', 'Adjunta un archivo.', [{ field: 'file', reason: 'REQUIRED' }]);
    if (file.buffer.length > this.config.documents.maxBytes) throw new AppError(422, 'FILE_TOO_LARGE', `El archivo supera el límite de ${this.config.documents.maxBytes} bytes.`, [{ field: 'file', reason: 'TOO_LARGE' }]);
    const bytes = file.buffer;
    const hash = sha256(bytes);
    // Cuarentena: los bytes recibidos solo están en memoria hasta pasar el análisis. Infectado → rechazo sin
    // almacenar. Escáner caído → se almacena como PENDIENTE (nunca disponible) y se puede reintentar.
    const scan = await this.scanner.scan(bytes);
    if (scan.result === 'INFECTED') {
      await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'document.upload_rejected', entityType: 'document', entityId: documentId ?? null, requestId, result: 'DENIED',
        after: { reason: 'MALWARE', engine: scan.engine, signature: scan.signature, sha256: hash, size_bytes: bytes.length } });
      throw new AppError(422, 'FILE_REJECTED_MALWARE', `El análisis antimalware rechazó el archivo (${scan.signature}). No se almacenó.`, [{ field: 'file', reason: 'INFECTED' }]);
    }
    const { real, name } = this.checkFile(file);
    // D-41 / A-01: las fotos de campo y las evidencias del recorrido web comparten el contrato de la fotografía de campo. Una imagen
    // con metadatos embebidos (EXIF con coordenadas o dispositivo, XMP, IPTC, comentarios) eludiría la clasificación de acceso, así
    // que se rechaza aquí igual que en la sincronización móvil; el cliente entrega una copia procesada y el original no se toca.
    // Las imágenes del recorrido se suben como FIELD_PHOTO (dato personal); FIELD_EVIDENCE es para PDF (actas, croquis).
    const typeCode = type?.code ?? (documentId ? (await this.db.selectFrom('documents').select('document_type').where('id', '=', documentId).executeTakeFirst())?.document_type : undefined);
    if (real !== 'application/pdf' && (typeCode === 'FIELD_PHOTO' || typeCode === 'FIELD_EVIDENCE')) {
      if (typeCode === 'FIELD_EVIDENCE') throw new AppError(422, 'EVIDENCE_IMAGE_USE_FIELD_PHOTO', 'Las evidencias del recorrido son PDF. Las fotografías se suben como «Fotografía de campo».', [{ field: 'document_type', reason: 'USE_FIELD_PHOTO' }]);
      if (hasImageMetadata(new Uint8Array(bytes), real)) {
        await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'document.upload_rejected', entityType: 'document', entityId: documentId ?? null, requestId, result: 'DENIED', after: { reason: 'PHOTO_METADATA_PRESENT', sha256: hash } });
        throw new AppError(422, 'PHOTO_METADATA_PRESENT', 'La foto conserva metadatos embebidos (EXIF/XMP) o no tiene una estructura válida: sube la copia sin metadatos (la web la prepara sola; tu archivo original no se modifica).', [{ field: 'file', reason: 'METADATA_PRESENT' }]);
      }
    }

    // Reintento idempotente (con autorización ya revalidada arriba).
    const prior = await this.db.selectFrom('document_versions').select(['document_id', 'sha256']).where('organization_id', '=', orgId).where('operation_id', '=', operationId).executeTakeFirst();
    if (prior) {
      if (prior.sha256 !== hash || (documentId && prior.document_id !== documentId)) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro archivo.');
      return { replayed: true, document: await this.view(this.db, ctx, prior.document_id) };
    }

    const versionId = randomUUID();
    const key = docKey(orgId, versionId);
    try {
      await this.store.put(key, bytes, real);
    } catch {
      throw new AppError(503, 'STORAGE_UNAVAILABLE', 'No pudimos guardar el archivo. No se registró nada; vuelve a intentarlo.');
    }
    let docId: string;
    try {
      docId = await this.db.transaction().execute(async (trx) => {
        // Revalidación dentro de la transacción: membresía, organización y alcance pueden haber cambiado.
        const fresh = await this.authz.tenantContext(user, orgId);
        if (!fresh || !this.has(fresh, 'document:upload')) throw forbidden();
        if (fresh.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
        await this.entityScope(trx, fresh, ownerType, ownerId, 'update');
        // Cuota por organización, serializada por organización.
        await sql`SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE`.execute(trx);
        const used = await sql<{ n: string }>`SELECT coalesce(sum(size_bytes), 0)::text AS n FROM document_versions WHERE organization_id = ${orgId}`.execute(trx);
        if (BigInt(used.rows[0].n) + BigInt(bytes.length) > BigInt(this.config.documents.orgQuotaBytes)) {
          throw new AppError(422, 'QUOTA_EXCEEDED', 'La organización alcanzó su cuota de almacenamiento de documentos.', [{ field: 'file', reason: 'QUOTA_EXCEEDED' }]);
        }
        let doc;
        let versionNumber = 1;
        let previous: string | null = null;
        if (documentId) {
          doc = await this.loadDoc(trx, fresh, documentId, 'update', true);
          if (body.expected_version && Number(body.expected_version) !== Number(doc.row_version)) throw conflict('VERSION_CONFLICT', 'Otra persona subió una versión de este documento. Recarga.');
          const last = await trx.selectFrom('document_versions').select(sql<number>`coalesce(max(version_number), 0)::int`.as('n')).where('document_id', '=', documentId).executeTakeFirstOrThrow();
          versionNumber = last.n + 1;
          previous = doc.current_version_id;
        } else {
          doc = await trx.insertInto('documents').values({ id: randomUUID(), organization_id: orgId, document_type: type!.code, owner_type: ownerType, owner_id: ownerId, title, created_by: user.id } as never).returningAll().executeTakeFirstOrThrow();
        }
        await trx.insertInto('document_versions').values({
          id: versionId, organization_id: orgId, document_id: doc.id, version_number: versionNumber, object_key: key, file_name: name, mime_type: real,
          size_bytes: bytes.length, sha256: hash, issuer: meta.issuer, issued_at: meta.issued_at, expires_at: meta.expires_at,
          previous_version_id: previous, operation_id: operationId, uploaded_by: user.id,
        } as never).execute();
        await trx.updateTable('documents').set({ current_version_id: versionId, row_version: sql`row_version + ${documentId ? 1 : 0}` } as never)
          .where('id', '=', doc.id).where('organization_id', '=', orgId).execute();
        await this.events.append(trx, {
          organizationId: orgId, eventType: 'DocumentUploaded', schemaVersion: 1, aggregateType: 'DOCUMENT', aggregateId: doc.id,
          aggregateVersion: versionNumber, actorId: user.id, correlationId: requestId, operationId,
          payload: { document_id: doc.id, version_id: versionId, version_number: versionNumber, document_type: doc.document_type, size_bytes: bytes.length, sha256: hash },
        });
        await trx.insertInto('document_version_scans').values({ organization_id: orgId, version_id: versionId, result: scan.result, engine: scan.engine, signature: scan.signature, error_code: scan.error_code } as never).execute();
        await this.events.append(trx, {
          organizationId: orgId, eventType: 'DocumentScanCompleted', schemaVersion: 1, aggregateType: 'DOCUMENT_VERSION', aggregateId: versionId,
          aggregateVersion: 1, actorId: user.id, correlationId: requestId,
          payload: { document_id: doc.id, version_id: versionId, version_number: versionNumber, result: scan.result, error_code: scan.error_code },
        });
        await this.audit.record(trx, {
          organizationId: orgId, actorUserId: user.id, action: documentId ? 'document.version_upload' : 'document.upload', entityType: 'document', entityId: doc.id, requestId, result: 'SUCCESS',
          after: { version_id: versionId, version_number: versionNumber, document_type: doc.document_type, owner_type: ownerType, size_bytes: bytes.length, sha256: hash, scan: scan.result, scan_error: scan.error_code },
        });
        return doc.id as string;
      });
    } catch (e) {
      await this.compensate(key);
      if ((e as { constraint?: string }).constraint === 'document_versions_operation_uq') {
        const again = await this.db.selectFrom('document_versions').select(['document_id', 'sha256']).where('organization_id', '=', orgId).where('operation_id', '=', operationId).executeTakeFirst();
        if (again && again.sha256 === hash) return { replayed: true, document: await this.view(this.db, ctx, again.document_id) };
        throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro archivo.');
      }
      throw e;
    }
    return { replayed: false, document: await this.view(this.db, ctx, docId) };
  }

  private async compensate(key: string) {
    try {
      await this.store.delete(key);
    } catch {
      this.logger.warn('Compensación pendiente: se registra una tarea de borrado reintentable');
      await new StorageSweeper(this.db, this.store).enqueue(key, 'ORPHAN').catch(() => undefined);
    }
  }

  /** Escaneo real; el resultado (incluido FAILED por escáner caído) queda registrado y auditado. */
  private async runScan(orgId: string, documentId: string, versionId: string, bytes: Buffer, actorId: string, requestId?: string) {
    const r = await this.scanner.scan(bytes);
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('document_version_scans').values({ organization_id: orgId, version_id: versionId, result: r.result, engine: r.engine, signature: r.signature, error_code: r.error_code } as never).execute();
      const n = await trx.selectFrom('document_version_scans').select(sql<number>`count(*)::int`.as('n')).where('version_id', '=', versionId).executeTakeFirstOrThrow();
      const v = await trx.selectFrom('document_versions').select('version_number').where('id', '=', versionId).executeTakeFirstOrThrow();
      await this.events.append(trx, {
        organizationId: orgId, eventType: 'DocumentScanCompleted', schemaVersion: 1, aggregateType: 'DOCUMENT_VERSION', aggregateId: versionId,
        aggregateVersion: n.n, actorId, correlationId: requestId,
        payload: { document_id: documentId, version_id: versionId, version_number: v.version_number, result: r.result, error_code: r.error_code },
      });
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: actorId, action: 'document.scan', entityType: 'document', entityId: documentId, requestId, result: 'SUCCESS',
        after: { version_id: versionId, result: r.result, engine: r.engine, signature: r.signature, error_code: r.error_code },
      });
    });
    return r;
  }

  async retryScan(user: AuthUser, orgId: string, documentId: string, versionId: string, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'document:upload', true);
    await this.loadDoc(this.db, ctx, documentId, 'update');
    const v = await this.db.selectFrom('document_versions').select(['object_key', 'sha256']).where('organization_id', '=', orgId).where('document_id', '=', documentId).where('id', '=', versionId).executeTakeFirst();
    if (!v) throw notFound();
    const last = await this.db.selectFrom('document_version_scans').select('result').where('version_id', '=', versionId).orderBy('id', 'desc').limit(1).executeTakeFirst();
    if (last && last.result !== 'FAILED') throw conflict('SCAN_NOT_RETRYABLE', 'Solo se reintenta un análisis fallido.');
    let bytes: Buffer;
    try { bytes = await this.store.get(v.object_key); } catch { throw new AppError(503, 'STORAGE_UNAVAILABLE', 'No pudimos leer el archivo para analizarlo.'); }
    if (sha256(bytes) !== v.sha256) throw new AppError(500, 'INTEGRITY_FAILED', 'El archivo almacenado no coincide con su huella; no se analiza.');
    await this.runScan(orgId, documentId, versionId, bytes, user.id, requestId);
    return this.view(this.db, ctx, documentId);
  }

  /** Revisión humana de una versión DISPONIBLE (facultad separada). No se hereda en versiones nuevas. */
  async review(user: AuthUser, orgId: string, documentId: string, versionId: string, dto: ReviewDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'document:review', true);
    await this.loadDoc(this.db, ctx, documentId, 'read');
    return this.db.transaction().execute(async (trx) => {
      const v = await trx.selectFrom('document_versions').select('id').where('organization_id', '=', orgId).where('document_id', '=', documentId).where('id', '=', versionId).forUpdate().executeTakeFirst();
      if (!v) throw notFound();
      const last = await trx.selectFrom('document_version_scans').select('result').where('version_id', '=', versionId).orderBy('id', 'desc').limit(1).executeTakeFirst();
      if (last?.result !== 'CLEAN') throw conflict('VERSION_NOT_AVAILABLE', 'Solo se revisa una versión disponible (análisis antimalware limpio).');
      await trx.insertInto('document_version_reviews').values({ organization_id: orgId, version_id: versionId, decision: dto.decision, reason: dto.reason.trim(), reviewer_id: user.id } as never).execute();
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'document.review', entityType: 'document', entityId: documentId, requestId, result: 'SUCCESS', after: { version_id: versionId, decision: dto.decision, reason: dto.reason.trim() } });
      return this.view(trx, ctx, documentId);
    });
  }

  async link(user: AuthUser, orgId: string, documentId: string, dto: LinkDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'document:upload', true);
    await this.loadDoc(this.db, ctx, documentId, 'update');
    await this.entityScope(this.db, ctx, dto.entity_type, dto.entity_id, 'read');
    return this.db.transaction().execute(async (trx) => {
      await trx.insertInto('document_links').values({ document_id: documentId, organization_id: orgId, entity_type: dto.entity_type, entity_id: dto.entity_id, created_by: user.id } as never)
        .onConflict((c) => c.columns(['document_id', 'entity_type', 'entity_id']).doNothing()).execute();
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'document.link', entityType: 'document', entityId: documentId, requestId, result: 'SUCCESS', after: { entity_type: dto.entity_type, entity_id: dto.entity_id } });
      return this.view(trx, ctx, documentId);
    });
  }

  /**
   * Contenido de un documento PERSONAL_DATA: identidad del productor, o —solo para la FOTOGRAFÍA DE CAMPO— el permiso propio del
   * productor vinculado. El alcance por titular (parcela propia) ya se comprobó en `loadDoc`; este permiso no lo sustituye.
   */
  private personalContentAllowed(ctx: TenantContext, documentType: string): boolean {
    return this.has(ctx, 'producer:read_identity') || (documentType === 'FIELD_PHOTO' && this.has(ctx, 'document:read_field_photo_own'));
  }

  /** Descarga: permiso y alcance revalidados, versión disponible, clasificación respetada, hash verificado. */
  async content(user: AuthUser, orgId: string, documentId: string, versionId: string, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'document:read', false);
    const d = await this.loadDoc(this.db, ctx, documentId, 'read');
    const t = await this.db.selectFrom('document_types').select('classification').where('code', '=', d.document_type).executeTakeFirstOrThrow();
    if (t.classification === 'PERSONAL_DATA' && !this.personalContentAllowed(ctx, d.document_type)) throw forbidden('CONTENT_RESTRICTED', 'Este documento contiene datos personales; tu rol no permite ver su contenido.');
    const v = await this.db.selectFrom('document_versions').select(['object_key', 'sha256', 'mime_type', 'file_name']).where('organization_id', '=', orgId).where('document_id', '=', documentId).where('id', '=', versionId).executeTakeFirst();
    if (!v) throw notFound();
    const last = await this.db.selectFrom('document_version_scans').select('result').where('version_id', '=', versionId).orderBy('id', 'desc').limit(1).executeTakeFirst();
    if (last?.result !== 'CLEAN') throw conflict('VERSION_NOT_AVAILABLE', last?.result === 'INFECTED' ? 'La versión fue rechazada por el análisis antimalware.' : 'La versión aún no está disponible: su análisis está pendiente o falló.');
    let bytes: Buffer;
    try { bytes = await this.store.get(v.object_key); } catch { throw new AppError(503, 'STORAGE_UNAVAILABLE', 'El archivo no está accesible en este momento.'); }
    if (sha256(bytes) !== v.sha256) throw new AppError(500, 'INTEGRITY_FAILED', 'El archivo almacenado no coincide con su huella registrada; no se entrega.');
    await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'document.download', entityType: 'document', entityId: documentId, requestId, result: 'SUCCESS', after: { version_id: versionId, sha256: v.sha256 } });
    return { bytes, mime: v.mime_type, name: v.file_name, sha256: v.sha256 };
  }
}

const upload = () => UseInterceptors(DocumentUploadInterceptor);
const multipartBody = (extra: Record<string, unknown>) => ApiBody({ schema: { type: 'object', required: ['file', 'operation_id'], properties: { file: { type: 'string', format: 'binary' }, operation_id: { type: 'string', format: 'uuid' }, issuer: { type: 'string' }, issued_at: { type: 'string', format: 'date' }, expires_at: { type: 'string', format: 'date' }, ...extra } } });

@ApiTags('documents')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Get('document-types')
  types(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) { return this.service.types(user, orgId); }

  @Get('documents')
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: ListQuery) { return this.service.list(user, orgId, q); }

  @Post('documents')
  @ApiConsumes('multipart/form-data')
  @multipartBody({ document_type: { type: 'string' }, owner_type: { type: 'string', enum: ['producer', 'plot'] }, owner_id: { type: 'string', format: 'uuid' }, title: { type: 'string' } })
  @upload()
  async create(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @UploadedFile() file: UploadedFileLike | undefined, @Body() body: Record<string, string>, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.upload(user, orgId, body ?? {}, file, null, req.requestId);
    if (r.replayed) res.status(200);
    return r;
  }

  @Get('documents/:id')
  get(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.get(user, orgId, id); }

  @Post('documents/:id/versions')
  @ApiConsumes('multipart/form-data')
  @multipartBody({ expected_version: { type: 'integer' } })
  @upload()
  async newVersion(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: UploadedFileLike | undefined, @Body() body: Record<string, string>, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.upload(user, orgId, body ?? {}, file, id, req.requestId);
    if (r.replayed) res.status(200);
    return r;
  }

  @Post('documents/:id/versions/:versionId/scan')
  @HttpCode(200)
  retryScan(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Req() req: AuthedRequest) {
    return this.service.retryScan(user, orgId, id, versionId, req.requestId);
  }

  @Post('documents/:id/versions/:versionId/reviews')
  review(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Body() dto: ReviewDto, @Req() req: AuthedRequest) {
    return this.service.review(user, orgId, id, versionId, dto, req.requestId);
  }

  @Post('documents/:id/links')
  link(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkDto, @Req() req: AuthedRequest) {
    return this.service.link(user, orgId, id, dto, req.requestId);
  }

  @Get('documents/:id/versions/:versionId/content')
  async content(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const c = await this.service.content(user, orgId, id, versionId, req.requestId);
    res.setHeader('Content-Type', c.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${c.name.replace(/[^A-Za-z0-9_.-]/g, '_')}"`);
    res.setHeader('X-Content-SHA256', c.sha256);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(c.bytes);
  }
}
