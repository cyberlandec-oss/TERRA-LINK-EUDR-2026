import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database, EvidenceTable } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { ProducersService } from '../producers/producers';
import { PlotsService } from '../plots/plots';

// P0-019 Evidencias. Distingue (docs/12, UX_UI §17):
//   documento/versión (archivo) · afirmación (claim) · soporte (versión EXACTA con relación SUPPORTS /
//   CONTRADICTS / BASED_ON) · decisión autorizada (verificar, rechazar, revocar) con motivo y responsable.
// Adjuntar un documento técnicamente disponible NO valida la afirmación. «Archivo limpio», «documento
// revisado» y «afirmación verificada» son estados distintos. Sin conclusiones regulatorias ni de riesgo.
// Privacidad del grafo: cada soporte se muestra solo si el usuario puede leer ese documento y su titular;
// los no visibles se omiten (sin conteos, tipos ni identificadores), también en consultas inversas.

type Db = Kysely<Database> | Transaction<Database>;
type Evidence = Selectable<EvidenceTable>;
type Entity = 'producer' | 'plot';

class CreateDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsString() @Length(2, 60) claim_type!: string;
  @ApiProperty({ enum: ['producer', 'plot'] }) @IsIn(['producer', 'plot']) entity_type!: Entity;
  @ApiProperty() @IsUUID() entity_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) valid_from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true }) valid_to?: string;
}
class SourceDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty() @IsUUID() document_version_id!: string;
  @ApiProperty({ enum: ['SUPPORTS', 'CONTRADICTS', 'BASED_ON'] }) @IsIn(['SUPPORTS', 'CONTRADICTS', 'BASED_ON']) relationship!: 'SUPPORTS' | 'CONTRADICTS' | 'BASED_ON';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) note?: string;
}
class DecisionDto {
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() contradictions_acknowledged?: boolean;
}
class ListQuery {
  @IsOptional() @IsIn(['producer', 'plot']) entity_type?: Entity;
  @IsOptional() @IsUUID() entity_id?: string;
  @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'REVOKED']) status?: string;
  @IsOptional() @IsString() @Length(2, 60) claim_type?: string;
}

const NEXT: Record<string, string> = {
  DRAFT: 'Agrega al menos un soporte que respalde la afirmación y envíala a revisión.',
  SUBMITTED: 'Un verificador autorizado debe revisar los soportes y decidir (verificar o rechazar) con motivo.',
  VERIFIED: 'Verificada. Revísala si cambia un soporte (nueva versión, vencimiento, rechazo o contradicción).',
  REJECTED: 'Rechazada. Reábrela para corregir los soportes.',
  REVOKED: 'Revocada. Reábrela para preparar una nueva revisión.',
};

@Injectable()
export class EvidenceService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly producers: ProducersService,
    private readonly plots: PlotsService,
  ) {}

  private has(ctx: TenantContext, p: string) { return (ctx.permissions as string[]).includes(p); }

  private async ctx(user: AuthUser, orgId: string, perm: 'evidence:read' | 'evidence:link' | 'evidence:verify', mutation: boolean) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, perm)) throw forbidden();
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }

  private async entityVisible(db: Db, ctx: TenantContext, type: string, id: string) {
    try {
      if (type === 'producer') await this.producers.load(db, ctx, id, 'read');
      else if (type === 'plot') await this.plots.load(db, ctx, id, 'read');
      else return false;
      return true;
    } catch { return false; }
  }

  private async loadEvidence(db: Db, ctx: TenantContext, id: string, lock = false) {
    let q = db.selectFrom('evidence').selectAll().where('organization_id', '=', ctx.organizationId).where('id', '=', id);
    if (lock) q = q.forUpdate();
    const e = await q.executeTakeFirst();
    if (!e || !(await this.entityVisible(db, ctx, e.entity_type, e.entity_id))) throw notFound();
    return e;
  }

  /** Estado actual de una versión de documento + visibilidad para el usuario (null si no puede verla). */
  private async versionInfo(db: Db, ctx: TenantContext, versionId: string) {
    const v = (await sql<{
      version_id: string; version_number: number; document_id: string; title: string; type_label: string; classification: string;
      owner_type: string; owner_id: string; current_version_id: string | null; current_number: number; scan: string | null; expired: boolean; review: string | null;
    }>`
      SELECT v.id AS version_id, v.version_number, d.id AS document_id, d.title, t.label AS type_label, t.classification, d.owner_type, d.owner_id, d.current_version_id,
             (SELECT max(x.version_number) FROM document_versions x WHERE x.document_id = d.id)::int AS current_number,
             (SELECT s.result FROM document_version_scans s WHERE s.version_id = v.id ORDER BY s.id DESC LIMIT 1) AS scan,
             (v.expires_at IS NOT NULL AND v.expires_at < current_date) AS expired,
             (SELECT r.decision FROM document_version_reviews r WHERE r.version_id = v.id ORDER BY r.id DESC LIMIT 1) AS review
      FROM document_versions v JOIN documents d ON d.id = v.document_id AND d.organization_id = v.organization_id
      JOIN document_types t ON t.code = d.document_type
      WHERE v.organization_id = ${ctx.organizationId} AND v.id = ${versionId}`.execute(db)).rows[0];
    if (!v) return null;
    if (!this.has(ctx, 'document:read') || !(await this.entityVisible(db, ctx, v.owner_type, v.owner_id))) return null;
    return {
      ...v,
      availability: v.scan === 'CLEAN' ? 'AVAILABLE' : v.scan === 'INFECTED' ? 'REJECTED' : v.scan === 'FAILED' ? 'SCAN_FAILED' : 'PENDING',
      newer_version_exists: v.current_number > v.version_number,
      content_access: v.classification === 'PERSONAL_DATA' && !this.has(ctx, 'producer:read_identity') ? 'RESTRICTED' : 'ALLOWED',
    };
  }

  private async sources(db: Db, orgId: string, evidenceId: string) {
    return db.selectFrom('evidence_sources as s').leftJoin('evidence_source_withdrawals as w', 'w.source_id', 's.id')
      .select(['s.id', 's.document_version_id', 's.relationship', 's.note', 's.added_at', 's.added_by', 'w.reason as withdrawn_reason', 'w.withdrawn_at'])
      .where('s.organization_id', '=', orgId).where('s.evidence_id', '=', evidenceId).orderBy('s.added_at').execute();
  }

  /** Motivos de revisión/bloqueo calculados sobre TODOS los soportes vigentes (para la compuerta de verificación). */
  private async sourceIssues(db: Db, ctx: TenantContext, e: Evidence) {
    const all = (await this.sources(db, e.organization_id, e.id)).filter((s) => !s.withdrawn_at);
    const issues: Array<{ source_id: string; code: string }> = [];
    let supports = 0; let contradictions = 0; let inaccessible = 0;
    for (const s of all) {
      if (s.relationship === 'CONTRADICTS') contradictions++;
      if (s.relationship !== 'SUPPORTS') continue;
      supports++;
      const v = await this.versionInfo(db, ctx, s.document_version_id);
      if (!v) { inaccessible++; continue; }
      if (v.availability !== 'AVAILABLE') issues.push({ source_id: s.id, code: 'SOURCE_UNAVAILABLE' });
      if (v.expired) issues.push({ source_id: s.id, code: 'SOURCE_EXPIRED' });
      if (v.review === 'REJECTED') issues.push({ source_id: s.id, code: 'SOURCE_REJECTED' });
      if (v.newer_version_exists) issues.push({ source_id: s.id, code: 'NEWER_DOCUMENT_VERSION' });
    }
    return { all, supports, contradictions, inaccessible, issues };
  }

  private async view(db: Db, ctx: TenantContext, e: Evidence) {
    const claim = await db.selectFrom('evidence_claim_types').selectAll().where('code', '=', e.claim_type).executeTakeFirstOrThrow();
    const raw = await this.sources(db, e.organization_id, e.id);
    const visible = [];
    const reviewReasons = new Set<string>();
    let activeContradictions = 0;
    for (const s of raw) {
      const v = await this.versionInfo(db, ctx, s.document_version_id);
      if (!v) continue; // fuera de alcance: se omite por completo
      const active = !s.withdrawn_at;
      if (active && s.relationship === 'CONTRADICTS') activeContradictions++;
      if (active && s.relationship === 'SUPPORTS') {
        if (v.availability !== 'AVAILABLE') reviewReasons.add('SOURCE_UNAVAILABLE');
        if (v.expired) reviewReasons.add('SOURCE_EXPIRED');
        if (v.review === 'REJECTED') reviewReasons.add('SOURCE_REJECTED');
        if (v.newer_version_exists) reviewReasons.add('NEWER_DOCUMENT_VERSION');
      }
      visible.push({
        id: s.id, relationship: s.relationship, note: s.note, added_at: s.added_at, active,
        withdrawn: s.withdrawn_at ? { reason: s.withdrawn_reason, at: s.withdrawn_at } : null,
        document: { id: v.document_id, title: v.title, type_label: v.type_label, classification: v.classification, content_access: v.content_access },
        version: { id: v.version_id, version_number: v.version_number, newer_version_exists: v.newer_version_exists, availability: v.availability, validity: v.expired ? 'EXPIRED' : 'VALID_OR_NO_EXPIRY', review: v.review },
      });
    }
    // En VERIFIED la contradicción ya fue evaluada expresamente al verificar (no se agregan soportes después).
    if (activeContradictions && e.status !== 'VERIFIED') reviewReasons.add('ACTIVE_CONTRADICTION');
    const decisions = await sql<{ action: string; from_status: string; to_status: string; reason: string; decided_at: string; contradictions_acknowledged: boolean; first: string | null; last: string | null }>`
      SELECT d.action, d.from_status, d.to_status, d.reason, d.decided_at, d.contradictions_acknowledged, u.first_name AS first, u.last_name AS last
      FROM evidence_decisions d LEFT JOIN users u ON u.id = d.actor_id
      WHERE d.organization_id = ${e.organization_id} AND d.evidence_id = ${e.id} ORDER BY d.id DESC`.execute(db);
    const expired = !!e.valid_to && e.valid_to < new Date().toISOString().slice(0, 10);
    const canLink = this.has(ctx, 'evidence:link') && ctx.organizationStatus === 'ACTIVE';
    const canVerify = this.has(ctx, 'evidence:verify') && ctx.organizationStatus === 'ACTIVE';
    return {
      id: e.id, claim: { code: claim.code, label: claim.label, limitation: claim.limitation, source: claim.source },
      entity: { type: e.entity_type, id: e.entity_id },
      status: e.status, validity: { from: e.valid_from, to: e.valid_to, expired },
      row_version: Number(e.row_version), created_at: e.created_at,
      requires_review: e.status === 'VERIFIED' && reviewReasons.size > 0, review_reasons: [...reviewReasons],
      sources: visible,
      decisions: decisions.rows.map((d) => ({ action: d.action, from_status: d.from_status, to_status: d.to_status, reason: d.reason, decided_at: d.decided_at, contradictions_acknowledged: d.contradictions_acknowledged, actor: `${d.first ?? ''} ${d.last ?? ''}`.trim() || 'Miembro' })),
      next_step: expired && e.status === 'VERIFIED' ? 'La vigencia de la afirmación terminó: requiere una nueva revisión.' : NEXT[e.status],
      actions: {
        add_source: canLink && e.status === 'DRAFT', submit: canLink && e.status === 'DRAFT',
        verify: canVerify && e.status === 'SUBMITTED', reject: canVerify && e.status === 'SUBMITTED',
        revoke: canVerify && e.status === 'VERIFIED', reopen: canLink && (e.status === 'REJECTED' || e.status === 'REVOKED'),
      },
      note: 'Adjuntar un documento disponible no valida la afirmación. Verificada no significa conformidad EUDR ni riesgo nulo.',
    };
  }

  async claimTypes(user: AuthUser, orgId: string) {
    await this.ctx(user, orgId, 'evidence:read', false);
    return this.db.selectFrom('evidence_claim_types').selectAll().orderBy('code').execute();
  }

  async list(user: AuthUser, orgId: string, q: ListQuery) {
    const ctx = await this.ctx(user, orgId, 'evidence:read', false);
    let query = this.db.selectFrom('evidence').selectAll().where('organization_id', '=', orgId);
    if (q.entity_type) query = query.where('entity_type', '=', q.entity_type);
    if (q.entity_id) query = query.where('entity_id', '=', q.entity_id);
    if (q.status) query = query.where('status', '=', q.status as Evidence['status']);
    if (q.claim_type) query = query.where('claim_type', '=', q.claim_type);
    const rows = await query.orderBy('created_at', 'desc').limit(200).execute();
    const out = [];
    for (const e of rows) if (await this.entityVisible(this.db, ctx, e.entity_type, e.entity_id)) out.push(await this.view(this.db, ctx, e));
    return out;
  }

  async get(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, 'evidence:read', false);
    return this.view(this.db, ctx, await this.loadEvidence(this.db, ctx, id));
  }

  /** Consulta inversa: afirmaciones que usan alguna versión de un documento (solo las visibles). */
  async byDocument(user: AuthUser, orgId: string, documentId: string) {
    const ctx = await this.ctx(user, orgId, 'evidence:read', false);
    const doc = await this.db.selectFrom('documents').select(['id', 'owner_type', 'owner_id']).where('organization_id', '=', orgId).where('id', '=', documentId).executeTakeFirst();
    if (!doc || !this.has(ctx, 'document:read') || !(await this.entityVisible(this.db, ctx, doc.owner_type, doc.owner_id))) throw notFound();
    const ids = await this.db.selectFrom('evidence_sources as s').innerJoin('document_versions as v', 'v.id', 's.document_version_id')
      .select('s.evidence_id').distinct().where('s.organization_id', '=', orgId).where('v.document_id', '=', documentId).execute();
    const out = [];
    for (const { evidence_id } of ids) {
      const e = await this.db.selectFrom('evidence').selectAll().where('organization_id', '=', orgId).where('id', '=', evidence_id).executeTakeFirstOrThrow();
      if (await this.entityVisible(this.db, ctx, e.entity_type, e.entity_id)) out.push(await this.view(this.db, ctx, e));
    }
    return out;
  }

  private async record(trx: Transaction<Database>, e: Evidence, eventType: string, action: string, actorId: string, payload: Record<string, unknown>, requestId?: string) {
    await this.events.append(trx, {
      organizationId: e.organization_id, eventType, schemaVersion: 1, aggregateType: 'EVIDENCE', aggregateId: e.id,
      aggregateVersion: Number(e.row_version), actorId, correlationId: requestId,
      payload: { evidence_id: e.id, claim_type: e.claim_type, entity_type: e.entity_type, status: e.status, ...payload },
    });
    await this.audit.record(trx, { organizationId: e.organization_id, actorUserId: actorId, action, entityType: 'evidence', entityId: e.id, requestId, result: 'SUCCESS', after: { status: e.status, ...payload } });
  }

  private bump(trx: Transaction<Database>, e: Evidence, status?: Evidence['status']) {
    return trx.updateTable('evidence').set({ ...(status ? { status } : {}), row_version: sql`row_version + 1` } as never)
      .where('id', '=', e.id).where('organization_id', '=', e.organization_id).returningAll().executeTakeFirstOrThrow();
  }

  async create(user: AuthUser, orgId: string, dto: CreateDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'evidence:link', true);
    const claim = await this.db.selectFrom('evidence_claim_types').selectAll().where('code', '=', dto.claim_type).executeTakeFirst();
    if (!claim) throw new AppError(422, 'CLAIM_TYPE_UNKNOWN', 'Tipo de afirmación no admitido.', [{ field: 'claim_type', reason: 'UNKNOWN' }]);
    if (!claim.entity_types.includes(dto.entity_type)) throw new AppError(422, 'ENTITY_TYPE_NOT_ALLOWED', 'Esta afirmación no aplica a ese tipo de entidad.', [{ field: 'entity_type', reason: 'NOT_ALLOWED' }]);
    if (!(await this.entityVisible(this.db, ctx, dto.entity_type, dto.entity_id))) throw notFound();
    if (dto.valid_from && dto.valid_to && dto.valid_from > dto.valid_to) throw new AppError(400, 'VALIDATION_FAILED', 'La vigencia empieza después de terminar.', [{ field: 'valid_to', reason: 'BEFORE_VALID_FROM' }]);
    const prior = await this.db.selectFrom('evidence').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.claim_type !== dto.claim_type || prior.entity_id !== dto.entity_id) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, evidence: await this.view(this.db, ctx, prior) };
    }
    try {
      const e = await this.db.transaction().execute(async (trx) => {
        const row = await trx.insertInto('evidence').values({
          id: randomUUID(), organization_id: orgId, claim_type: dto.claim_type, entity_type: dto.entity_type, entity_id: dto.entity_id,
          status: 'DRAFT', valid_from: dto.valid_from?.slice(0, 10) ?? null, valid_to: dto.valid_to?.slice(0, 10) ?? null, operation_id: dto.operation_id, created_by: user.id,
        } as never).returningAll().executeTakeFirstOrThrow();
        await this.record(trx, row, 'EvidenceCreated', 'evidence.create', user.id, { entity_id: dto.entity_id }, requestId);
        return row;
      });
      return { replayed: false, evidence: await this.view(this.db, ctx, e) };
    } catch (err) {
      if ((err as { constraint?: string }).constraint === 'evidence_operation_uq') {
        const again = await this.db.selectFrom('evidence').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirstOrThrow();
        return { replayed: true, evidence: await this.view(this.db, ctx, again) };
      }
      throw err;
    }
  }

  async addSource(user: AuthUser, orgId: string, id: string, dto: SourceDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'evidence:link', true);
    const prior = await this.db.selectFrom('evidence_sources').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      const e = await this.loadEvidence(this.db, ctx, id);
      if (prior.evidence_id !== id || prior.document_version_id !== dto.document_version_id || prior.relationship !== dto.relationship) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, evidence: await this.view(this.db, ctx, e) };
    }
    return this.db.transaction().execute(async (trx) => {
      const e = await this.loadEvidence(trx, ctx, id, true);
      if (e.status !== 'DRAFT') throw conflict('EVIDENCE_NOT_EDITABLE', 'Solo se agregan soportes a una afirmación en borrador (reábrela si fue rechazada o revocada).');
      if (Number(e.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó esta afirmación. Recarga.');
      const v = await this.versionInfo(trx, ctx, dto.document_version_id);
      if (!v) throw notFound('La versión del documento no existe o no está disponible para ti.');
      await trx.insertInto('evidence_sources').values({
        id: randomUUID(), organization_id: orgId, evidence_id: id, document_version_id: dto.document_version_id, relationship: dto.relationship,
        note: dto.note?.trim() || null, operation_id: dto.operation_id, added_by: user.id,
      } as never).execute();
      const after = await this.bump(trx, e);
      await this.record(trx, after, 'EvidenceSourceLinked', 'evidence.link_source', user.id, { document_version_id: dto.document_version_id, relationship: dto.relationship }, requestId);
      return { replayed: false, evidence: await this.view(trx, ctx, after) };
    });
  }

  async withdrawSource(user: AuthUser, orgId: string, id: string, sourceId: string, dto: DecisionDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'evidence:link', true);
    return this.db.transaction().execute(async (trx) => {
      const e = await this.loadEvidence(trx, ctx, id, true);
      if (e.status !== 'DRAFT') throw conflict('EVIDENCE_NOT_EDITABLE', 'Solo se retiran soportes de una afirmación en borrador.');
      if (Number(e.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó esta afirmación. Recarga.');
      const s = await trx.selectFrom('evidence_sources').select(['id', 'document_version_id']).where('organization_id', '=', orgId).where('evidence_id', '=', id).where('id', '=', sourceId).executeTakeFirst();
      if (!s || !(await this.versionInfo(trx, ctx, s.document_version_id))) throw notFound();
      await trx.insertInto('evidence_source_withdrawals').values({ source_id: sourceId, organization_id: orgId, reason: dto.reason.trim(), withdrawn_by: user.id } as never).execute();
      const after = await this.bump(trx, e);
      await this.record(trx, after, 'EvidenceSourceWithdrawn', 'evidence.withdraw_source', user.id, { source_id: sourceId, reason: dto.reason.trim() }, requestId);
      return this.view(trx, ctx, after);
    });
  }

  /** Transiciones con motivo y responsable. La verificación exige soportes vigentes y disponibles. */
  async decide(user: AuthUser, orgId: string, id: string, action: 'SUBMIT' | 'VERIFY' | 'REJECT' | 'REVOKE' | 'REOPEN', dto: DecisionDto, requestId?: string) {
    const perm = action === 'SUBMIT' || action === 'REOPEN' ? 'evidence:link' : 'evidence:verify';
    const ctx = await this.ctx(user, orgId, perm, true);
    const flow: Record<string, { from: Evidence['status'][]; to: Evidence['status']; event: string }> = {
      SUBMIT: { from: ['DRAFT'], to: 'SUBMITTED', event: 'EvidenceSubmitted' },
      VERIFY: { from: ['SUBMITTED'], to: 'VERIFIED', event: 'EvidenceVerified' },
      REJECT: { from: ['SUBMITTED'], to: 'REJECTED', event: 'EvidenceRejected' },
      REVOKE: { from: ['VERIFIED'], to: 'REVOKED', event: 'EvidenceRevoked' },
      REOPEN: { from: ['REJECTED', 'REVOKED'], to: 'DRAFT', event: 'EvidenceReopened' },
    };
    const f = flow[action];
    return this.db.transaction().execute(async (trx) => {
      const e = await this.loadEvidence(trx, ctx, id, true);
      if (Number(e.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó esta afirmación. Recarga para ver su estado actual.');
      if (!f.from.includes(e.status)) throw conflict('INVALID_TRANSITION', `No se puede ${action.toLowerCase()} una afirmación en estado ${e.status}.`);
      const st = await this.sourceIssues(trx, ctx, e);
      if (action === 'SUBMIT' && st.supports === 0) throw new AppError(422, 'NO_SUPPORTING_SOURCE', 'Agrega al menos un soporte que respalde la afirmación antes de enviarla.');
      if (action === 'VERIFY') {
        if (st.inaccessible > 0) throw forbidden('SOURCES_NOT_ACCESSIBLE', 'No tienes acceso a todos los soportes de esta afirmación; no puedes verificarla.');
        if (st.supports === 0) throw new AppError(422, 'NO_SUPPORTING_SOURCE', 'No hay soportes vigentes que respalden la afirmación.');
        const blocking = st.issues.filter((i) => i.code !== 'NEWER_DOCUMENT_VERSION');
        if (blocking.length) throw new AppError(422, 'SOURCES_NOT_VERIFIABLE', 'Hay soportes no disponibles, vencidos o rechazados; no se puede verificar.', blocking.map((i) => ({ field: i.source_id, reason: i.code })));
        if (st.issues.some((i) => i.code === 'NEWER_DOCUMENT_VERSION')) throw new AppError(422, 'SOURCE_SUPERSEDED', 'Un soporte apunta a una versión anterior del documento: revísalo y vincula la versión que corresponda.', st.issues.filter((i) => i.code === 'NEWER_DOCUMENT_VERSION').map((i) => ({ field: i.source_id, reason: i.code })));
        if (st.contradictions > 0 && !dto.contradictions_acknowledged) throw new AppError(422, 'CONTRADICTION_NOT_ACKNOWLEDGED', 'Hay soportes que contradicen la afirmación: confirma expresamente que los evaluaste.');
      }
      const after = await this.bump(trx, e, f.to);
      await trx.insertInto('evidence_decisions').values({
        organization_id: orgId, evidence_id: id, action, from_status: e.status, to_status: f.to, reason: dto.reason.trim(),
        sources_snapshot: JSON.stringify(st.all.map((s) => ({ id: s.id, version: s.document_version_id, relationship: s.relationship }))),
        contradictions_acknowledged: !!dto.contradictions_acknowledged, actor_id: user.id,
      } as never).execute();
      await this.record(trx, after, f.event, `evidence.${action.toLowerCase()}`, user.id, { from_status: e.status, reason: dto.reason.trim() }, requestId);
      return this.view(trx, ctx, after);
    });
  }
}

@ApiTags('evidence')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class EvidenceController {
  constructor(private readonly service: EvidenceService) {}

  @Get('evidence-claim-types')
  types(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) { return this.service.claimTypes(user, orgId); }

  @Get('evidence')
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: ListQuery) { return this.service.list(user, orgId, q); }

  @Post('evidence')
  async create(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: CreateDto, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.create(user, orgId, dto, req.requestId);
    if (r.replayed) res.status(200);
    return r;
  }

  @Get('evidence/:id')
  get(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.get(user, orgId, id); }

  @Post('evidence/:id/sources')
  async addSource(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SourceDto, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.addSource(user, orgId, id, dto, req.requestId);
    if (r.replayed) res.status(200);
    return r;
  }

  @Post('evidence/:id/sources/:sourceId/withdraw')
  @HttpCode(200)
  withdraw(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Param('sourceId', ParseUUIDPipe) sourceId: string, @Body() dto: DecisionDto, @Req() req: AuthedRequest) {
    return this.service.withdrawSource(user, orgId, id, sourceId, dto, req.requestId);
  }

  @Post('evidence/:id/:action')
  @HttpCode(200)
  decide(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Param('action') action: string, @Body() dto: DecisionDto, @Req() req: AuthedRequest) {
    const map: Record<string, 'SUBMIT' | 'VERIFY' | 'REJECT' | 'REVOKE' | 'REOPEN'> = { submit: 'SUBMIT', verify: 'VERIFY', reject: 'REJECT', revoke: 'REVOKE', reopen: 'REOPEN' };
    if (!map[action]) throw notFound();
    return this.service.decide(user, orgId, id, map[action], dto, req.requestId);
  }

  @Get('documents/:documentId/evidence')
  byDocument(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.service.byDocument(user, orgId, documentId);
  }
}
