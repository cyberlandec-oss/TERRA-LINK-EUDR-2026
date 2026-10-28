import {
  Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database, ProducerStatus, ProducersTable } from '../db/schema';
import { referenciaDe } from '../traceability/public-references';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventConsumer, type EventStore } from '../events/events';
import { permissionsForRoles } from '../authz/catalog';
import { PII_CIPHER, PiiCipher, normalizeDocumentNumber, producerAad, versionAad } from '../crypto/pii';
import { ProducerMatchingService } from './matching';

// P0-004 — Productor (RF-04). Alcance:
// - producer:read ve todos los productores de la organización; producer:read_assigned solo los
//   asignados a su membresía. Igual para update/update_assigned.
// - Identidad (documento, teléfono, dirección) solo con producer:read_identity; nunca en eventos,
//   auditoría ni logs. El historial completo vive en producer_versions y se redacta al leerlo.
// - Fuera de alcance (P0-005): deduplicación asistida, fusiones, corrección del código.

const IDENTITY_FIELDS = ['document_type', 'document_number', 'phone', 'address'] as const;
const EDITABLE_FIELDS = [
  'first_name', 'last_name', 'legal_name', 'document_type', 'document_number', 'phone', 'address',
  'community', 'province', 'canton', 'parish',
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
type ProducerRow = Selectable<ProducersTable>;
type IdentityField = (typeof IDENTITY_FIELDS)[number];
/** Productor con identidad descifrada en memoria (nunca se persiste ni se registra así). */
type ProducerPlain = Omit<ProducerRow, 'document_type_enc' | 'document_number_enc' | 'phone_enc' | 'address_enc' | 'document_number_bidx'>
  & Record<IdentityField, string | null>;

const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;

class ProducerFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) first_name?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) last_name?: string | null;
  @ApiPropertyOptional({ description: 'Razón social (alternativa a nombre y apellido)' })
  @IsOptional() @IsString() @Length(1, 200) legal_name?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) document_type?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) document_number?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[+0-9 ()-]{6,20}$/, { message: 'phone: formato no válido' }) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) address?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) community?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) province?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) canton?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) parish?: string | null;
}

class CreateProducerDto extends ProducerFieldsDto {
  @ApiProperty({ example: 'PRD-0001' }) @Matches(CODE, { message: 'producer_code: 1–40 caracteres alfanuméricos, . _ -' }) producer_code!: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE'], default: 'ACTIVE' }) @IsOptional() @IsIn(['DRAFT', 'ACTIVE']) status?: 'DRAFT' | 'ACTIVE';
  @ApiPropertyOptional({ description: 'Membresía responsable (misma organización)' })
  @IsOptional() @IsUUID() assigned_membership_id?: string;
}

/** Campos corregibles (P0-015): descriptivos en claro. La identidad cifrada no se corrige por esta vía. */
export const CORRECTABLE_FIELDS = ['first_name', 'last_name', 'legal_name', 'community', 'province', 'canton', 'parish'] as const;
export const CORRECTABLE_EVENT_TYPES = ['ProducerUpdated', 'ProducerUpdateCorrected'];

class CorrectionFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) first_name?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) last_name?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) legal_name?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) community?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) province?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) canton?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) parish?: string | null;
}

export class CorrectUpdateDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ description: 'row_version del productor leído' }) @IsInt() @Min(1) expected_version!: number;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
  @ApiProperty({ type: CorrectionFieldsDto }) @IsObject() @ValidateNested() @Type(() => CorrectionFieldsDto) fields!: CorrectionFieldsDto;
}

class UpdateProducerDto extends ProducerFieldsDto {
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
}

class AssignDto {
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty({ nullable: true }) @ValidateIf((_, v) => v !== null) @IsUUID() membership_id!: string | null;
}

class LinkSelfDto {
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty({ nullable: true, description: 'Membresía de la persona que ES este productor; null desvincula' }) @ValidateIf((_, v) => v !== null) @IsUUID() membership_id!: string | null;
  @ApiProperty({ description: 'Motivo obligatorio: el vínculo da acceso propio a la persona vinculada' }) @IsString() @Length(3, 500) reason!: string;
}

class StatusDto {
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

class ListQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'INACTIVE', 'ALL']) status?: ProducerStatus | 'ALL';
  @IsOptional() @IsIn(['me']) assigned?: 'me';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

const encodeCursor = (code: string, id: string) => Buffer.from(JSON.stringify([code, id])).toString('base64url');
function decodeCursor(c: string): [string, string] {
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string') return [v[0], v[1]];
  } catch {
    /* cae al error */
  }
  throw new AppError(400, 'INVALID_CURSOR', 'El cursor de paginación no es válido. Vuelve a la primera página.');
}

const blankToNull = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v.trim() === '' ? null : v.trim());

@Injectable()
export class ProducersService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    @Inject(PII_CIPHER) private readonly cipher: PiiCipher,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly matching: ProducerMatchingService,
  ) {}

  /** Descifra la identidad solo cuando se necesita (lectura con permiso o comparación de cambios). */
  private plain(row: ProducerRow, decrypt: boolean): ProducerPlain {
    const { document_type_enc, document_number_enc, phone_enc, address_enc, ...withIndex } = row;
    const rest = { ...withIndex } as Partial<ProducerRow>;
    delete rest.document_number_bidx;
    const enc: Record<IdentityField, string | null> = {
      document_type: document_type_enc, document_number: document_number_enc, phone: phone_enc, address: address_enc,
    };
    const identity = Object.fromEntries(IDENTITY_FIELDS.map((f) => [
      f, decrypt ? this.cipher.decryptNullable(enc[f], producerAad(row.organization_id, row.id, f)) : null,
    ])) as Record<IdentityField, string | null>;
    return { ...(rest as Omit<ProducerPlain, IdentityField>), ...identity };
  }

  /** Columnas cifradas (y el índice ciego del documento) para los campos de identidad presentes. */
  private encryptIdentity(orgId: string, id: string, fields: Partial<Record<EditableField, string | null>>) {
    const out: Record<string, string | null> = {};
    for (const f of IDENTITY_FIELDS) {
      if (fields[f] === undefined) continue;
      out[`${f}_enc`] = this.cipher.encryptNullable(fields[f], producerAad(orgId, id, f));
    }
    if (fields.document_number !== undefined) {
      out.document_number_bidx = fields.document_number == null
        ? null
        : this.cipher.blindIndex(orgId, 'DOC', normalizeDocumentNumber(fields.document_number));
    }
    return out;
  }

  private splitFields(fields: Partial<Record<EditableField, string | null>>) {
    const nonIdentity = Object.fromEntries(Object.entries(fields).filter(([k]) => !(IDENTITY_FIELDS as readonly string[]).includes(k)));
    return nonIdentity;
  }

  /** Contexto con permiso de lectura (todos o asignados). */
  private async readContext(user: AuthUser, orgId: string): Promise<TenantContext> {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!ctx.permissions.includes('producer:read') && !ctx.permissions.includes('producer:read_assigned') && !ctx.permissions.includes('producer:read_own')) throw forbidden();
    return ctx;
  }

  /** Alcance sobre un productor: amplio, por asignación del técnico, o PROPIO (A-01: la membresía vinculada al productor). */
  private inScope(ctx: TenantContext, p: Pick<ProducerRow, 'assigned_membership_id'> & { self_membership_id?: string | null }, kind: 'read' | 'update'): boolean {
    if (ctx.permissions.includes(`producer:${kind}` as never)) return true;
    if (ctx.permissions.includes(`producer:${kind}_assigned` as never) && p.assigned_membership_id === ctx.membershipId) return true;
    return ctx.permissions.includes(`producer:${kind}_own` as never) && !!p.self_membership_id && p.self_membership_id === ctx.membershipId;
  }

  /** Carga un productor de la organización respetando el alcance; fuera de alcance = 404. */
  async load(db: Kysely<Database> | Transaction<Database>, ctx: TenantContext, id: string, kind: 'read' | 'update', lock = false) {
    let q = db.selectFrom('producers').selectAll().where('organization_id', '=', ctx.organizationId).where('id', '=', id);
    if (lock) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    if (!row || !this.inScope(ctx, row, 'read')) throw notFound();
    if (kind === 'update' && !this.inScope(ctx, row, 'update')) throw forbidden();
    return this.plain(row, true);
  }

  private view(p: ProducerPlain, ctx: TenantContext) {
    const identity = ctx.permissions.includes('producer:read_identity');
    return {
      id: p.id,
      producer_code: p.producer_code,
      first_name: p.first_name,
      last_name: p.last_name,
      legal_name: p.legal_name,
      display_name: p.legal_name ?? [p.first_name, p.last_name].filter(Boolean).join(' '),
      community: p.community,
      province: p.province,
      canton: p.canton,
      parish: p.parish,
      status: p.status,
      assigned_membership_id: p.assigned_membership_id,
      // A-01: quién ES el productor solo lo ve quien administra el vínculo; cualquiera ve si el registro es suyo.
      ...(ctx.permissions.includes('producer:link_self') ? { self_membership_id: p.self_membership_id ?? null } : {}),
      is_own: !!p.self_membership_id && p.self_membership_id === ctx.membershipId,
      row_version: Number(p.row_version),
      created_at: p.created_at,
      updated_at: p.updated_at,
      deleted_at: p.deleted_at,
      deletion_reason: p.deletion_reason,
      identity_visible: identity,
      ...(identity
        ? { document_type: p.document_type, document_number: p.document_number, phone: p.phone, address: p.address }
        : {}),
    };
  }

  /** La membresía asignada debe estar activa, en la misma organización y con acceso a productores. */
  private async assertAssignee(trx: Transaction<Database>, orgId: string, membershipId: string) {
    const ctx = await trx
      .selectFrom('memberships as m')
      .leftJoin('role_assignments as ra', (j) => j.onRef('ra.membership_id', '=', 'm.id').onRef('ra.organization_id', '=', 'm.organization_id'))
      .select(['m.id', 'm.status', 'ra.role_code'])
      .where('m.id', '=', membershipId)
      .where('m.organization_id', '=', orgId)
      .execute();
    if (ctx.length === 0) {
      throw new AppError(422, 'ASSIGNEE_NOT_FOUND', 'El responsable indicado no es miembro de esta organización.', [{ field: 'assigned_membership_id', reason: 'NOT_IN_ORGANIZATION' }]);
    }
    if (ctx[0].status !== 'ACTIVE') {
      throw new AppError(422, 'ASSIGNEE_INACTIVE', 'El responsable indicado tiene la membresía desactivada.', [{ field: 'assigned_membership_id', reason: 'INACTIVE' }]);
    }
    const perms = permissionsForRoles(ctx.map((r) => r.role_code).filter((r): r is string => !!r));
    if (!perms.includes('producer:read') && !perms.includes('producer:read_assigned')) {
      throw new AppError(422, 'ASSIGNEE_WITHOUT_ACCESS', 'El responsable indicado no tiene acceso a productores.', [{ field: 'assigned_membership_id', reason: 'NO_PRODUCER_ACCESS' }]);
    }
  }

  /** Instantánea de versión: identidad cifrada con el contexto de esa versión. */
  private snapshot(p: ProducerPlain) {
    const snap: Record<string, unknown> = { ...p, row_version: Number(p.row_version) };
    for (const f of IDENTITY_FIELDS) {
      delete snap[f];
      snap[`${f}_enc`] = this.cipher.encryptNullable(p[f], versionAad(p.organization_id, p.id, String(p.row_version), f));
    }
    return snap;
  }

  private async recordVersion(trx: Transaction<Database>, p: ProducerPlain, changeType: string, changed: string[], actorId: string, reason?: string | null) {
    await trx
      .insertInto('producer_versions')
      .values({
        organization_id: p.organization_id, producer_id: p.id, version: String(p.row_version), change_type: changeType,
        changed_fields: changed, snapshot: JSON.stringify(this.snapshot(p)), reason: reason ?? null, changed_by: actorId,
      })
      .execute();
  }

  async create(user: AuthUser, orgId: string, dto: CreateProducerDto, requestId?: string) {
    const ctx = await this.authz.require(user, orgId, 'producer:create', { mutation: true });
    let assignee = dto.assigned_membership_id ?? null;
    if (assignee && assignee !== ctx.membershipId && !ctx.permissions.includes('producer:assign')) {
      throw forbidden('PERMISSION_DENIED', 'No tienes permiso para asignar productores a otra persona.');
    }
    // Quien solo trabaja con asignados queda como responsable de lo que registra (si no, no podría verlo).
    if (!assignee && !ctx.permissions.includes('producer:read')) assignee = ctx.membershipId;
    const fields = this.normalize(dto);
    this.assertNames(fields);
    return this.db.transaction().execute(async (trx) => {
      const { producer, pendingReviews } = await this.createInTx(trx, ctx, user, dto.producer_code, fields, { status: dto.status ?? 'ACTIVE', assignee, requestId });
      return { ...this.view(producer, ctx), duplicate_reviews_pending: pendingReviews };
    });
  }

  /**
   * Alta dentro de una transacción del llamador (también la usa P0-026 Importación). Mismos efectos que create():
   * responsable válido, identidad cifrada, versión, evento, auditoría y detección de posibles duplicados (P0-005).
   * El llamador ya autorizó producer:create y validó/normalizó los campos.
   */
  async createInTx(
    trx: Transaction<Database>, ctx: TenantContext, user: AuthUser, code: string, fields: Partial<Record<EditableField, string | null>>,
    opts: { status: 'DRAFT' | 'ACTIVE'; assignee: string | null; requestId?: string; changeType?: string; reason?: string | null; source?: Record<string, unknown> },
  ) {
    const orgId = ctx.organizationId;
    if (opts.assignee) await this.assertAssignee(trx, orgId, opts.assignee);
    const id = randomUUID(); // se genera antes para ligar el cifrado (AAD) al registro
    let p: ProducerPlain;
    try {
      const row = await trx
        .insertInto('producers')
        .values({
          ...this.splitFields(fields), ...this.encryptIdentity(orgId, id, fields), id, organization_id: orgId,
          producer_code: code.trim(), status: opts.status,
          assigned_membership_id: opts.assignee, created_by: user.id, updated_by: user.id,
        } as never)
        .returningAll()
        .executeTakeFirstOrThrow();
      p = this.plain(row, true);
    } catch (e) {
      throw this.mapConstraint(e);
    }
    await this.recordVersion(trx, p, opts.changeType ?? 'CREATE', Object.keys(fields).filter((k) => fields[k as EditableField] != null), user.id, opts.reason);
    const source = opts.source ? { source: opts.source } : {};
    await this.events.append(trx, {
      organizationId: orgId, eventType: 'ProducerRegistered', schemaVersion: 1, aggregateType: 'PRODUCER',
      aggregateId: p.id, aggregateVersion: Number(p.row_version), actorId: user.id, correlationId: opts.requestId,
      payload: { producer_code: p.producer_code, status: p.status, assigned_membership_id: p.assigned_membership_id, ...source },
    });
    await this.audit.record(trx, {
      organizationId: orgId, actorUserId: user.id, action: 'producer.create', entityType: 'producer', entityId: p.id,
      requestId: opts.requestId, result: 'SUCCESS', after: { producer_code: p.producer_code, status: p.status, assigned_membership_id: p.assigned_membership_id, ...source },
    });
    // P0-005: abre casos de revisión si hay coincidencia de identidad; nunca bloquea ni fusiona.
    const pendingReviews = await this.matching.detect(trx, orgId, p.id, user.id, opts.requestId);
    return { producer: p, pendingReviews };
  }

  /**
   * Alta desde la sincronización de campo (operación PRODUCER_CREATE), DENTRO de la transacción del llamador para que el alta y el
   * registro de la operación sean atómicos. El llamador ya revalidó producer:create; aquí se aplica la misma regla de responsable que create().
   */
  async createForSync(trx: Transaction<Database>, ctx: TenantContext, user: AuthUser, dto: ProducerFieldsDto & { producer_code: string; status?: 'DRAFT' | 'ACTIVE' }, requestId?: string) {
    if (!CODE.test(dto.producer_code)) throw new AppError(422, 'PAYLOAD_INVALID', 'producer_code: 1–40 caracteres alfanuméricos, . _ -');
    let assignee: string | null = null;
    if (!ctx.permissions.includes('producer:read')) assignee = ctx.membershipId; // quien solo trabaja con asignados queda como responsable
    const fields = this.normalize(dto);
    this.assertNames(fields);
    const { producer, pendingReviews } = await this.createInTx(trx, ctx, user, dto.producer_code, fields, { status: dto.status ?? 'ACTIVE', assignee, requestId, source: { channel: 'MOBILE_SYNC' } });
    return { id: producer.id, producer_code: producer.producer_code, duplicate_reviews_pending: pendingReviews };
  }

  private normalize(dto: ProducerFieldsDto): Partial<Record<EditableField, string | null>> {
    const out: Partial<Record<EditableField, string | null>> = {};
    for (const f of EDITABLE_FIELDS) {
      const v = blankToNull((dto as Record<string, string | null | undefined>)[f]);
      if (v !== undefined) out[f] = v;
    }
    return out;
  }

  private assertNames(f: Partial<Record<EditableField, string | null>>) {
    const hasPerson = !!f.first_name && !!f.last_name;
    if (!hasPerson && !f.legal_name) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Indica nombre y apellido, o la razón social.', [
        { field: 'first_name', reason: 'NAME_OR_LEGAL_NAME_REQUIRED' }, { field: 'legal_name', reason: 'NAME_OR_LEGAL_NAME_REQUIRED' },
      ]);
    }
    if ((f.document_type == null) !== (f.document_number == null)) {
      throw new AppError(400, 'VALIDATION_FAILED', 'El tipo y el número de documento van juntos.', [
        { field: 'document_number', reason: 'DOCUMENT_PAIR_REQUIRED' },
      ]);
    }
  }

  private mapConstraint(e: unknown): unknown {
    const c = (e as { constraint?: string }).constraint;
    if (c === 'producers_code_uq') return conflict('PRODUCER_CODE_TAKEN', 'Ya existe un productor con ese código en tu organización.');
    if (c === 'producers_assignee_fk') return new AppError(422, 'ASSIGNEE_NOT_FOUND', 'El responsable indicado no es miembro de esta organización.');
    if (c === 'producers_name_required' || c === 'producers_document_pair' || c === 'producers_document_bidx_consistent') {
      return new AppError(400, 'VALIDATION_FAILED', 'Revisa nombre/razón social y el par tipo–número de documento.');
    }
    return e;
  }

  async list(user: AuthUser, orgId: string, q: ListQuery) {
    const ctx = await this.readContext(user, orgId);
    const limit = q.limit ?? 25;
    const status = q.status ?? 'ACTIVE_OR_DRAFT';
    let query = this.db.selectFrom('producers').selectAll().where('organization_id', '=', orgId);
    if (status === 'ACTIVE_OR_DRAFT') query = query.where('status', 'in', ['ACTIVE', 'DRAFT']);
    else if (status !== 'ALL') query = query.where('status', '=', status);
    if (!ctx.permissions.includes('producer:read') || q.assigned === 'me') {
      // Alcance estrecho: lo asignado al técnico y/o lo propio del productor; nunca el resto de la organización.
      const asignados = ctx.permissions.includes('producer:read_assigned');
      const propios = ctx.permissions.includes('producer:read_own');
      query = query.where((eb) => eb.or([
        ...(asignados || q.assigned === 'me' ? [eb('assigned_membership_id', '=', ctx.membershipId)] : []),
        ...(propios && q.assigned !== 'me' ? [eb('self_membership_id', '=', ctx.membershipId)] : []),
      ]));
    }
    if (q.q?.trim()) {
      const term = q.q.trim();
      const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const identity = ctx.permissions.includes('producer:read_identity');
      query = query.where((eb) => {
        const ors = [
          eb('producer_code', 'ilike', like),
          eb(sql`coalesce(first_name,'') || ' ' || coalesce(last_name,'')`, 'ilike', like),
          eb('legal_name', 'ilike', like),
          eb('community', 'ilike', like),
        ];
        // Buscar por documento solo con permiso de identidad, por coincidencia exacta (índice ciego).
        if (identity) ors.push(eb('document_number_bidx', '=', this.cipher.blindIndex(orgId, 'DOC', normalizeDocumentNumber(term))));
        return eb.or(ors);
      });
    }
    if (q.cursor) {
      const [code, id] = decodeCursor(q.cursor);
      query = query.where((eb) => eb.or([eb('producer_code', '>', code), eb.and([eb('producer_code', '=', code), eb('id', '>', id)])]));
    }
    const rows = await query.orderBy('producer_code').orderBy('id').limit(limit + 1).execute();
    const page = rows.slice(0, limit);
    const identity = ctx.permissions.includes('producer:read_identity');
    return {
      items: page.map((p) => this.view(this.plain(p, identity), ctx)),
      next_cursor: rows.length > limit ? encodeCursor(page[page.length - 1].producer_code, page[page.length - 1].id) : null,
    };
  }

  async get(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.readContext(user, orgId);
    const p = await this.load(this.db, ctx, id, 'read');
    return {
      ...this.view(p, ctx),
      // RF-47: la referencia se entrega en la LECTURA AUTORIZADA. No la publica por audiencias (RF-33) ni
      // concede acceso: quien lee esto ya está autorizado sobre el productor.
      public_reference: await referenciaDe(this.db, ctx.organizationId, 'PRODUCER', p.id),
      can_update: p.status !== 'INACTIVE' && this.inScope(ctx, p, 'update') && ctx.organizationStatus === 'ACTIVE',
      can_assign: ctx.permissions.includes('producer:assign') && ctx.organizationStatus === 'ACTIVE',
      can_link_self: ctx.permissions.includes('producer:link_self') && ctx.organizationStatus === 'ACTIVE',
      can_archive: ctx.permissions.includes('producer:archive') && ctx.organizationStatus === 'ACTIVE',
    };
  }

  /**
   * P0-015 — Corrección de una actualización de productor (contrato de corrección implementado).
   * Efecto de dominio: los campos corregidos del productor toman los valores indicados (nueva versión con
   * change_type CORRECTION y motivo). Registro: evento ProducerUpdateCorrected con correction_of al evento
   * corregido (mismo agregado y organización, protegido también en BD). El evento original y su versión
   * no se modifican. Solo se corrigen campos que el evento corregido cambió y que sean corregibles; un
   * campo vuelto a cambiar después por otra operación hace la corrección obsoleta (409). Un evento se
   * corrige una vez: para volver a corregir se corrige la última corrección (cadena).
   */
  async correctUpdate(user: AuthUser, orgId: string, id: string, eventId: string, dto: CorrectUpdateDto, requestId?: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!ctx.permissions.includes('producer:update') && !ctx.permissions.includes('producer:update_assigned')) throw forbidden();
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    const fields = Object.fromEntries(Object.entries(dto.fields ?? {}).filter(([, v]) => v !== undefined)) as Partial<Record<(typeof CORRECTABLE_FIELDS)[number], string | null>>;
    const requestHash = createHash('sha256').update(JSON.stringify([eventId, dto.reason.trim(), Object.entries(fields).sort()])).digest('hex');

    // Reintento: se revalida el alcance sobre el recurso ANTES de devolver el resultado.
    const prior = await this.db.selectFrom('domain_events').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      await this.load(this.db, ctx, id, 'update');
      const pl = prior.payload as { request_hash?: string };
      if (prior.event_type !== 'ProducerUpdateCorrected' || prior.aggregate_id !== id || prior.correction_of_event_id !== eventId || pl.request_hash !== requestHash) {
        throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      }
      return { replayed: true, correction_event_id: prior.event_id, producer: this.view(await this.load(this.db, ctx, id, 'read'), ctx) };
    }
    if (Object.keys(fields).length === 0) throw new AppError(400, 'VALIDATION_FAILED', 'Indica al menos un campo a corregir.', [{ field: 'fields', reason: 'EMPTY' }]);

    try {
      return await this.db.transaction().execute(async (trx) => {
        const before = await this.load(trx, ctx, id, 'update', true);
        if (before.status === 'INACTIVE') throw conflict('PRODUCER_INACTIVE', 'El productor está dado de baja; reactívalo para corregirlo.');
        if (Number(before.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó este productor. Recarga para ver la versión actual.');
        const original = await trx.selectFrom('domain_events').selectAll()
          .where('organization_id', '=', orgId).where('event_id', '=', eventId).where('aggregate_type', '=', 'PRODUCER').where('aggregate_id', '=', id).executeTakeFirst();
        if (!original) throw notFound('El evento no existe en el historial de este productor.');
        if (!CORRECTABLE_EVENT_TYPES.includes(original.event_type)) {
          throw new AppError(422, 'CORRECTION_NOT_SUPPORTED', 'Este tipo de evento no tiene un contrato de corrección.', [{ field: 'event_id', reason: original.event_type }]);
        }
        const next = await trx.selectFrom('domain_events').select('event_id').where('organization_id', '=', orgId).where('correction_of_event_id', '=', eventId).executeTakeFirst();
        if (next) {
          let last = next.event_id;
          for (;;) {
            const n = await trx.selectFrom('domain_events').select('event_id').where('organization_id', '=', orgId).where('correction_of_event_id', '=', last).executeTakeFirst();
            if (!n) break;
            last = n.event_id;
          }
          throw new AppError(409, 'EVENT_ALREADY_CORRECTED', 'Este evento ya fue corregido: corrige la última corrección de la cadena.', [{ field: 'latest_correction_event_id', reason: last }]);
        }
        const changedByOriginal = ((original.payload as { changed_fields?: string[] }).changed_fields ?? []);
        for (const f of Object.keys(fields)) {
          if (!(CORRECTABLE_FIELDS as readonly string[]).includes(f)) throw new AppError(422, 'FIELD_NOT_CORRECTABLE', 'Ese campo no se corrige por esta vía.', [{ field: f, reason: 'NOT_CORRECTABLE' }]);
          if (!changedByOriginal.includes(f)) throw new AppError(422, 'FIELD_NOT_IN_CORRECTED_EVENT', 'Solo se corrigen campos que cambió el evento corregido.', [{ field: f, reason: 'NOT_CHANGED_BY_EVENT' }]);
        }
        const later = await trx.selectFrom('domain_events').select(['payload'])
          .where('organization_id', '=', orgId).where('aggregate_type', '=', 'PRODUCER').where('aggregate_id', '=', id)
          .where(sql<boolean>`aggregate_version > ${original.aggregate_version}`)
          .where('event_type', 'in', CORRECTABLE_EVENT_TYPES).execute();
        const touched = new Set(later.flatMap((e) => (e.payload as { changed_fields?: string[] }).changed_fields ?? []));
        const stale = Object.keys(fields).filter((f) => touched.has(f));
        if (stale.length) throw new AppError(409, 'CORRECTION_SUPERSEDED', 'Un cambio posterior ya modificó ese campo; la corrección quedaría sin sentido. Revisa el historial.', stale.map((f) => ({ field: f, reason: 'CHANGED_LATER' })));
        const patch = this.normalize(fields as ProducerFieldsDto);
        const changed = (Object.keys(patch) as EditableField[]).filter((k) => patch[k] !== before[k]);
        if (changed.length === 0) throw conflict('NO_CHANGE', 'Los valores indicados ya son los vigentes.');
        this.assertNames({ ...before, ...patch });
        const changedPatch = Object.fromEntries(changed.map((k) => [k, patch[k]])) as Partial<Record<EditableField, string | null>>;
        const row = await trx.updateTable('producers')
          .set({ ...this.splitFields(changedPatch), updated_by: user.id, updated_at: new Date(), row_version: sql`row_version + 1` } as never)
          .where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
        const after = this.plain(row, true);
        await this.recordVersion(trx, after, 'CORRECTION', changed, user.id, dto.reason.trim());
        const ev = await this.events.append(trx, {
          organizationId: orgId, eventType: 'ProducerUpdateCorrected', schemaVersion: 1, aggregateType: 'PRODUCER',
          aggregateId: id, aggregateVersion: Number(after.row_version), actorId: user.id, correlationId: requestId,
          operationId: dto.operation_id, correctionOf: { eventId, reason: dto.reason.trim() },
          payload: { changed_fields: changed, corrected_event_id: eventId, request_hash: requestHash },
        });
        await this.audit.record(trx, {
          organizationId: orgId, actorUserId: user.id, action: 'producer.correct', entityType: 'producer', entityId: id, requestId, result: 'SUCCESS',
          after: { corrected_event_id: eventId, correction_event_id: ev.event_id, changed_fields: changed, reason: dto.reason.trim(), version: Number(after.row_version) },
        });
        return { replayed: false, correction_event_id: ev.event_id, producer: this.view(after, ctx) };
      });
    } catch (e) {
      const c = (e as { constraint?: string }).constraint;
      if (c === 'domain_events_corrected_once') throw conflict('EVENT_ALREADY_CORRECTED', 'Otra persona corrigió este evento al mismo tiempo. Recarga el historial.');
      if (c === 'domain_events_operation_uq') throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó.');
      if (c === 'domain_events_aggregate_version_uq') throw conflict('VERSION_CONFLICT', 'Otra persona modificó este productor. Recarga para ver la versión actual.');
      throw e;
    }
  }

  async update(user: AuthUser, orgId: string, id: string, dto: UpdateProducerDto, requestId?: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!ctx.permissions.includes('producer:update') && !ctx.permissions.includes('producer:update_assigned')) throw forbidden();
    if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    const { expected_version, ...rest } = dto;
    const patch = this.normalize(rest);
    if (Object.keys(patch).length === 0) throw conflict('NO_CHANGE', 'No hay cambios que guardar.');
    return this.db.transaction().execute(async (trx) => {
      const { after, pendingReviews } = await this.updateInTx(trx, ctx, user, id, expected_version, patch, { requestId });
      return { ...this.view(after, ctx), ...(pendingReviews !== undefined ? { duplicate_reviews_pending: pendingReviews } : {}) };
    });
  }

  /**
   * Edición dentro de una transacción del llamador (también la usa P0-026 Importación). Mismos controles que update():
   * alcance actual (bloqueo de fila), estado, versión esperada, permiso de identidad, nombre/documento coherentes,
   * versión, evento, auditoría y detección de duplicados si cambia el documento. `patch` solo trae los campos a escribir:
   * un campo ausente no cambia.
   */
  async updateInTx(
    trx: Transaction<Database>, ctx: TenantContext, user: AuthUser, id: string, expectedVersion: number, patch: Partial<Record<EditableField, string | null>>,
    opts: { requestId?: string; changeType?: string; reason?: string | null; source?: Record<string, unknown> },
  ) {
    const orgId = ctx.organizationId;
    const before = await this.load(trx, ctx, id, 'update', true);
    if (before.status === 'INACTIVE') throw conflict('PRODUCER_INACTIVE', 'El productor está dado de baja; reactívalo para editarlo.');
    if (Number(before.row_version) !== expectedVersion) {
      throw conflict('VERSION_CONFLICT', 'Otra persona modificó este productor. Recarga para ver la versión actual.');
    }
    // Sin permiso de identidad no se pueden escribir campos de identidad (no se ven, no se editan).
    if (!ctx.permissions.includes('producer:read_identity') && IDENTITY_FIELDS.some((f) => patch[f] !== undefined)) {
      throw forbidden('PERMISSION_DENIED', 'No tienes permiso para modificar datos de identidad.');
    }
    const changed = (Object.keys(patch) as EditableField[]).filter((k) => patch[k] !== before[k]);
    if (changed.length === 0) throw conflict('NO_CHANGE', 'No hay cambios que guardar.');
    this.assertNames({ ...before, ...patch });
    const changedPatch = Object.fromEntries(changed.map((k) => [k, patch[k]])) as Partial<Record<EditableField, string | null>>;
    let after: ProducerPlain;
    try {
      const row = await trx
        .updateTable('producers')
        .set({
          ...this.splitFields(changedPatch), ...this.encryptIdentity(orgId, id, changedPatch),
          updated_by: user.id, updated_at: new Date(), row_version: sql`row_version + 1`,
        } as never)
        .where('id', '=', id)
        .where('organization_id', '=', orgId)
        .returningAll()
        .executeTakeFirstOrThrow();
      after = this.plain(row, true);
    } catch (e) {
      throw this.mapConstraint(e);
    }
    await this.recordVersion(trx, after, opts.changeType ?? 'UPDATE', changed, user.id, opts.reason);
    // Eventos y auditoría: nombres de campos cambiados, nunca sus valores personales.
    const source = opts.source ? { source: opts.source } : {};
    await this.events.append(trx, {
      organizationId: orgId, eventType: 'ProducerUpdated', schemaVersion: 1, aggregateType: 'PRODUCER',
      aggregateId: id, aggregateVersion: Number(after.row_version), actorId: user.id, correlationId: opts.requestId,
      payload: { changed_fields: changed, ...source },
    });
    await this.audit.record(trx, {
      organizationId: orgId, actorUserId: user.id, action: 'producer.update', entityType: 'producer', entityId: id,
      requestId: opts.requestId, result: 'SUCCESS', after: { changed_fields: changed, version: Number(after.row_version), ...source },
    });
    const pendingReviews = changed.some((f) => f === 'document_type' || f === 'document_number')
      ? await this.matching.detect(trx, orgId, id, user.id, opts.requestId)
      : undefined;
    return { after, changed, pendingReviews };
  }

  /** P0-026: productores de la organización por código (para la vista previa y la confirmación de una importación). */
  async byCodes(db: Kysely<Database> | Transaction<Database>, orgId: string, codes: string[], lock = false) {
    if (codes.length === 0) return new Map<string, ProducerRow>();
    let q = db.selectFrom('producers').selectAll().where('organization_id', '=', orgId).where('producer_code', 'in', codes);
    if (lock) q = q.orderBy('id').forUpdate();
    return new Map((await q.execute()).map((r) => [r.producer_code, r]));
  }

  /** Alcance (lectura/edición) de un productor para un contexto: lo mismo que aplica load(). */
  scopeOf(ctx: TenantContext, p: Pick<ProducerRow, 'assigned_membership_id'> & { self_membership_id?: string | null }) {
    return { read: this.inScope(ctx, p, 'read'), update: this.inScope(ctx, p, 'update') };
  }

  /** Identidad descifrada en memoria para comparar (solo si el llamador tiene producer:read_identity). */
  decrypted(row: ProducerRow, identity: boolean): Record<EditableField, string | null> {
    const p = this.plain(row, identity);
    return Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, p[f]])) as Record<EditableField, string | null>;
  }

  /** Comprueba nombre/razón social y par de documento sobre el resultado final (mismas reglas que alta/edición). */
  validateNames(f: Partial<Record<EditableField, string | null>>): string[] {
    const out: string[] = [];
    if (!(f.first_name && f.last_name) && !f.legal_name) out.push('NAME_OR_LEGAL_NAME_REQUIRED');
    if ((f.document_type == null) !== (f.document_number == null)) out.push('DOCUMENT_PAIR_REQUIRED');
    return out;
  }

  /** Responsable por defecto de un alta: quien solo trabaja con asignados queda como responsable (como en create()). */
  defaultAssignee(ctx: TenantContext): string | null {
    return ctx.permissions.includes('producer:read') ? null : ctx.membershipId;
  }

  async assign(user: AuthUser, orgId: string, id: string, dto: AssignDto, requestId?: string) {
    const ctx = await this.authz.require(user, orgId, 'producer:assign', { mutation: true });
    return this.db.transaction().execute(async (trx) => {
      const before = await this.load(trx, ctx, id, 'read', true);
      if (before.status === 'INACTIVE') throw conflict('PRODUCER_INACTIVE', 'El productor está dado de baja.');
      if (Number(before.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó este productor. Recarga.');
      if (before.assigned_membership_id === dto.membership_id) throw conflict('NO_CHANGE', 'Ese responsable ya está asignado.');
      if (dto.membership_id) await this.assertAssignee(trx, orgId, dto.membership_id);
      const after = this.plain(await trx
        .updateTable('producers')
        .set({ assigned_membership_id: dto.membership_id, updated_by: user.id, updated_at: new Date(), row_version: sql`row_version + 1` })
        .where('id', '=', id).where('organization_id', '=', orgId)
        .returningAll().executeTakeFirstOrThrow(), true);
      await this.recordVersion(trx, after, 'ASSIGN', ['assigned_membership_id'], user.id);
      await this.events.append(trx, {
        organizationId: orgId, eventType: 'ProducerAssigned', schemaVersion: 1, aggregateType: 'PRODUCER',
        aggregateId: id, aggregateVersion: Number(after.row_version), actorId: user.id, correlationId: requestId,
        payload: { from_membership_id: before.assigned_membership_id, to_membership_id: dto.membership_id },
      });
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'producer.assign', entityType: 'producer', entityId: id, requestId,
        result: 'SUCCESS', before: { assigned_membership_id: before.assigned_membership_id }, after: { assigned_membership_id: dto.membership_id },
      });
      return this.view(after, ctx);
    });
  }

  /**
   * A-01 — Vincula (o desvincula) a la persona que ES este productor. Es un acto explícito, con motivo, versionado y
   * auditado: ni el correo ni el nombre vinculan nada. La membresía debe ser de la organización, estar activa y tener el rol
   * PRODUCER; una membresía no puede ser dos productores. Dar acceso propio NO es asignar un técnico (son relaciones
   * distintas) ni concede facultades de revisión.
   */
  async linkSelf(user: AuthUser, orgId: string, id: string, dto: LinkSelfDto, requestId?: string) {
    const ctx = await this.authz.require(user, orgId, 'producer:link_self', { mutation: true });
    return this.db.transaction().execute(async (trx) => {
      const before = await this.load(trx, ctx, id, 'read', true);
      if (before.status === 'INACTIVE') throw conflict('PRODUCER_INACTIVE', 'El productor está dado de baja.');
      if (Number(before.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó este productor. Recarga.');
      if ((before.self_membership_id ?? null) === dto.membership_id) throw conflict('NO_CHANGE', 'Ese vínculo ya está registrado.');
      if (dto.membership_id) {
        const m = await trx.selectFrom('memberships').select(['id', 'status']).where('organization_id', '=', orgId).where('id', '=', dto.membership_id).executeTakeFirst();
        if (!m) throw new AppError(422, 'MEMBERSHIP_NOT_FOUND', 'La persona indicada no es miembro de esta organización.', [{ field: 'membership_id', reason: 'NOT_IN_ORGANIZATION' }]);
        if (m.status !== 'ACTIVE') throw new AppError(422, 'MEMBERSHIP_INACTIVE', 'La persona indicada tiene la membresía desactivada.', [{ field: 'membership_id', reason: 'INACTIVE' }]);
        const rol = await trx.selectFrom('role_assignments').select('id').where('organization_id', '=', orgId).where('membership_id', '=', dto.membership_id).where('role_code', '=', 'PRODUCER').executeTakeFirst();
        if (!rol) throw new AppError(422, 'MEMBERSHIP_WITHOUT_PRODUCER_ROLE', 'La persona indicada no tiene el rol Productor: asígnalo primero.', [{ field: 'membership_id', reason: 'NO_PRODUCER_ROLE' }]);
        const otro = await trx.selectFrom('producers').select('id').where('organization_id', '=', orgId).where('self_membership_id', '=', dto.membership_id).where('id', '<>', id).executeTakeFirst();
        if (otro) throw conflict('MEMBERSHIP_ALREADY_LINKED', 'Esa persona ya está vinculada a otro productor.');
      }
      const after = this.plain(await trx
        .updateTable('producers')
        .set({ self_membership_id: dto.membership_id, updated_by: user.id, updated_at: new Date(), row_version: sql`row_version + 1` })
        .where('id', '=', id).where('organization_id', '=', orgId)
        .returningAll().executeTakeFirstOrThrow(), true);
      await this.recordVersion(trx, after, 'LINK_SELF', ['self_membership_id'], user.id, dto.reason);
      await this.events.append(trx, {
        organizationId: orgId, eventType: 'ProducerSelfLinked', schemaVersion: 1, aggregateType: 'PRODUCER',
        aggregateId: id, aggregateVersion: Number(after.row_version), actorId: user.id, correlationId: requestId,
        payload: { from_membership_id: before.self_membership_id ?? null, to_membership_id: dto.membership_id },
      });
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'producer.link_self', entityType: 'producer', entityId: id, requestId,
        result: 'SUCCESS', reason: dto.reason, before: { self_membership_id: before.self_membership_id ?? null }, after: { self_membership_id: dto.membership_id },
      });
      return this.view(after, ctx);
    });
  }

  async changeStatus(user: AuthUser, orgId: string, id: string, target: ProducerStatus, dto: StatusDto, requestId?: string) {
    // Activar un borrador, dar de baja y reactivar son decisiones de gestión: producer:archive.
    const ctx = await this.authz.require(user, orgId, 'producer:archive', { mutation: true });
    return this.db.transaction().execute(async (trx) => {
      const before = await this.load(trx, ctx, id, 'read', true);
      if (Number(before.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó este productor. Recarga.');
      const allowed: Record<ProducerStatus, ProducerStatus[]> = { DRAFT: ['ACTIVE', 'INACTIVE'], ACTIVE: ['INACTIVE'], INACTIVE: ['ACTIVE'] };
      if (!allowed[before.status].includes(target)) throw conflict('INVALID_TRANSITION', 'Ese cambio de estado no está permitido.');
      const archiving = target === 'INACTIVE';
      const after = this.plain(await trx
        .updateTable('producers')
        .set({
          status: target,
          deleted_at: archiving ? new Date() : null,
          deleted_by: archiving ? user.id : null,
          deletion_reason: archiving ? dto.reason : null,
          updated_by: user.id, updated_at: new Date(), row_version: sql`row_version + 1`,
        })
        .where('id', '=', id).where('organization_id', '=', orgId)
        .returningAll().executeTakeFirstOrThrow(), true);
      await this.recordVersion(trx, after, archiving ? 'ARCHIVE' : 'ACTIVATE', ['status'], user.id, dto.reason);
      await this.events.append(trx, {
        organizationId: orgId, eventType: 'ProducerStatusChanged', schemaVersion: 1, aggregateType: 'PRODUCER',
        aggregateId: id, aggregateVersion: Number(after.row_version), actorId: user.id, correlationId: requestId,
        payload: { from_status: before.status, to_status: target },
      });
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: archiving ? 'producer.archive' : 'producer.activate',
        entityType: 'producer', entityId: id, requestId, result: 'SUCCESS', reason: dto.reason,
        before: { status: before.status }, after: { status: target },
      });
      return this.view(after, ctx);
    });
  }

  async history(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.readContext(user, orgId);
    await this.load(this.db, ctx, id, 'read');
    const identity = ctx.permissions.includes('producer:read_identity');
    const rows = await this.db
      .selectFrom('producer_versions as v')
      .leftJoin('memberships as m', (j) => j.onRef('m.user_id', '=', 'v.changed_by').onRef('m.organization_id', '=', 'v.organization_id'))
      .leftJoin('users as u', 'u.id', 'm.user_id')
      .select(['v.version', 'v.change_type', 'v.changed_fields', 'v.snapshot', 'v.reason', 'v.changed_at', 'u.email as actor_email'])
      .where('v.organization_id', '=', orgId)
      .where('v.producer_id', '=', id)
      .orderBy('v.version', 'desc')
      .execute();
    return rows.map((r) => {
      const snap = { ...(r.snapshot as Record<string, unknown>) };
      for (const f of IDENTITY_FIELDS) {
        const token = snap[`${f}_enc`] as string | null | undefined;
        delete snap[`${f}_enc`];
        if (identity) snap[f] = this.cipher.decryptNullable(token, versionAad(orgId, id, r.version, f));
      }
      return {
        version: Number(r.version), change_type: r.change_type, changed_fields: r.changed_fields, reason: r.reason,
        changed_at: r.changed_at, actor: r.actor_email ?? 'PLATFORM', snapshot: snap, identity_visible: identity,
      };
    });
  }

  async summary(user: AuthUser, orgId: string) {
    await this.authz.require(user, orgId, 'producer:read', { mutation: false });
    const rows = await this.db.selectFrom('producer_status_counts').select(['status', 'producer_count']).where('organization_id', '=', orgId).execute();
    const counts = { DRAFT: 0, ACTIVE: 0, INACTIVE: 0 } as Record<ProducerStatus, number>;
    for (const r of rows) counts[r.status] = Number(r.producer_count);
    return { counts, consistency: 'EVENTUAL' };
  }
}

/** Proyección por eventos: productores por estado (S1 «producers_total»). Idempotente por recibo. */
export const producerStatusCountsConsumer: EventConsumer = {
  name: 'producer-status-counts',
  eventTypes: ['ProducerRegistered', 'ProducerStatusChanged'],
  async handle(trx, event) {
    const p = event.payload as { status?: ProducerStatus; from_status?: ProducerStatus; to_status?: ProducerStatus };
    const bump = async (status: ProducerStatus, delta: number) => {
      await trx
        .insertInto('producer_status_counts')
        .values({ organization_id: event.organization_id, status, producer_count: String(Math.max(delta, 0)) })
        .onConflict((oc) => oc.columns(['organization_id', 'status']).doUpdateSet({
          producer_count: sql`producer_status_counts.producer_count + ${delta}`,
        }))
        .execute();
    };
    if (event.event_type === 'ProducerRegistered' && p.status) await bump(p.status, 1);
    if (event.event_type === 'ProducerStatusChanged' && p.from_status && p.to_status) {
      await bump(p.from_status, -1);
      await bump(p.to_status, 1);
    }
  },
};

@ApiTags('producers')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/producers')
export class ProducersController {
  constructor(private readonly service: ProducersService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: CreateProducerDto, @Req() req: AuthedRequest) {
    return this.service.create(user, orgId, dto, req.requestId);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: ListQuery) {
    return this.service.list(user, orgId, q);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.summary(user, orgId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, orgId, id);
  }

  @Get(':id/history')
  history(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.history(user, orgId, id);
  }

  @Post(':id/events/:eventId/corrections')
  @ApiOperation({ summary: 'Corregir una actualización del productor (correction_of)' })
  correct(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Param('eventId', ParseUUIDPipe) eventId: string, @Body() dto: CorrectUpdateDto, @Req() req: AuthedRequest) {
    return this.service.correctUpdate(user, orgId, id, eventId, dto, req.requestId);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProducerDto, @Req() req: AuthedRequest) {
    return this.service.update(user, orgId, id, dto, req.requestId);
  }

  @Put(':id/self-membership')
  @ApiOperation({ summary: 'A-01: vincular o desvincular a la persona que ES el productor (alcance propio), con motivo' })
  linkSelf(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkSelfDto, @Req() req: AuthedRequest) {
    return this.service.linkSelf(user, orgId, id, dto, req.requestId);
  }

  @Put(':id/assignment')
  assign(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto, @Req() req: AuthedRequest) {
    return this.service.assign(user, orgId, id, dto, req.requestId);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto, @Req() req: AuthedRequest) {
    return this.service.changeStatus(user, orgId, id, 'INACTIVE', dto, req.requestId);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto, @Req() req: AuthedRequest) {
    return this.service.changeStatus(user, orgId, id, 'ACTIVE', dto, req.requestId);
  }
}
