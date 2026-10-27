import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { permissionsForRoles, type Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, EventStore, type DomainEvent, type EventConsumer } from '../events/events';
import { RiskService } from '../risk/risk';

// P0-021 Mitigación (RF-21, QA-11; docs/13 §Mitigación; UX_UI §18.2). Caso → acción → responsable → plazo → evidencia →
// revisión → resultado. Aportar soporte (versión exacta) no verifica nada. Verificar/rechazar con motivo y permiso; el
// ejecutor (quien entrega o aporta soportes) NO verifica su propia mitigación: no hay política expresa de excepción
// (docs/13). Esto no modifica la política de Evidencias (D-37). Verificar dispara una REEVALUACIÓN asíncrona (outbox) que
// recalcula todas las reglas con los datos actuales: no vuelve favorable el riesgo ni elimina otros bloqueos, y la causa
// no se da por resuelta por cerrar la tarea. Transiciones, evento y auditoría en la misma transacción.

type Db = Kysely<Database> | Transaction<Database>;

class CreateDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsUUID() evaluation_id!: string;
  @ApiProperty() @IsString() @Matches(/^[A-Z][A-Z0-9_]{2,59}$/) factor_code!: string;
  @ApiProperty() @IsString() @Length(3, 160) title!: string;
  @ApiProperty({ description: 'Criterio de aceptación concreto de la acción (documentado por quien la crea)' }) @IsString() @Length(3, 1000) acceptance_criteria!: string;
  @ApiPropertyOptional({ description: 'Por defecto, la evidencia requerida por la regla' }) @IsOptional() @IsString() @Length(3, 500) evidence_required?: string;
  @ApiProperty() @IsUUID() assignee_membership_id!: string;
  @ApiProperty() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) due_date!: string;
}
class SupportDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() document_version_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() evidence_id?: string;
}
class SubmitDto { @ApiProperty() @IsUUID() operation_id!: string; @ApiProperty() @IsInt() @Min(1) expected_version!: number; @ApiProperty() @IsString() @Length(3, 1000) note!: string }
class DecisionDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] }) @IsIn(['VERIFIED', 'REJECTED']) decision!: 'VERIFIED' | 'REJECTED';
  @ApiProperty() @IsString() @Length(3, 1000) reason!: string;
  @ApiPropertyOptional({ description: 'Obligatorio en VERIFIED: quien verifica declara que se cumple el criterio de aceptación de la acción (no solo que el soporte es aceptable)' }) @IsOptional() @IsBoolean() criterion_met?: boolean;
}
class CorrectionDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty({ description: '¿El soporte aportado sigue aceptado como soporte? (independiente de que la acción cumpla su criterio)' }) @IsBoolean() support_accepted!: boolean;
  @ApiProperty() @IsString() @Length(10, 1000) reason!: string;
}
class ListQuery { @IsOptional() @IsIn(['OPEN', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'REOPENED']) status?: string; @IsOptional() @IsUUID() lot_id?: string }
class OptionsQuery { @IsUUID() evaluation_id!: string }

const STATUS_LABEL: Record<string, string> = { OPEN: 'Abierta (sin entrega)', SUBMITTED: 'Entregada: pendiente de verificación', VERIFIED: 'Verificada', REJECTED: 'Rechazada: requiere nueva entrega', REOPENED: 'Reabierta: verificación corregida, requiere nueva entrega' };
const name = (f: string | null, l: string | null) => `${f ?? ''} ${l ?? ''}`.trim() || 'Miembro';

@Injectable()
export class MitigationsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private has(ctx: TenantContext, p: Permission) { return ctx.permissions.includes(p); }
  /** Las mitigaciones revelan evaluaciones y su grafo: además del permiso, alcance de organización completo (como riesgo). */
  private async ctx(user: AuthUser, orgId: string, perm: Permission, mutation: boolean) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!this.has(ctx, perm)) throw forbidden();
    const need: Permission[] = ['delivery:read', 'lot:read', 'plot:read', 'producer:read', 'document:read'];
    if (!need.every((p) => this.has(ctx, p))) throw forbidden('PERMISSION_DENIED', 'Las mitigaciones usan datos de toda la organización: requieren alcance de organización completo.');
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }

  private async eligibleAssignees(db: Db, orgId: string) {
    const rows = (await sql<{ id: string; first_name: string; last_name: string; roles: string[] }>`
      SELECT m.id, u.first_name, u.last_name, array_agg(ra.role_code) AS roles FROM memberships m JOIN users u ON u.id = m.user_id JOIN role_assignments ra ON ra.membership_id = m.id
      WHERE m.organization_id = ${orgId} AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' GROUP BY m.id, u.first_name, u.last_name ORDER BY u.first_name, u.last_name`.execute(db)).rows;
    return rows.filter((r) => permissionsForRoles(r.roles).includes('mitigation:contribute')).map((r) => ({ membership_id: r.id, name: name(r.first_name, r.last_name) }));
  }

  private async evaluationFactor(db: Db, orgId: string, evaluationId: string, code?: string) {
    const e = (await sql<{ id: string; subject_id: string; factors: Array<{ code: string; result: string; depends_on: string | null; reason: string; category: string; explanation: string }>; rule_set_version: string }>`
      SELECT id, subject_id, factors, rule_set_version FROM risk_evaluations WHERE organization_id = ${orgId} AND id = ${evaluationId}`.execute(db)).rows[0];
    if (!e) throw notFound('La evaluación no existe en tu organización.');
    const actionable = e.factors.filter((f) => f.result === 'HIT' || (f.result === 'NOT_EVALUABLE' && !f.depends_on));
    return { e, actionable, factor: code ? e.factors.find((f) => f.code === code) : undefined };
  }

  async options(user: AuthUser, orgId: string, q: OptionsQuery) {
    const ctx = await this.ctx(user, orgId, 'mitigation:manage', false);
    const { actionable, e } = await this.evaluationFactor(this.db, ctx.organizationId, q.evaluation_id);
    const evidence = (await sql<{ code: string; evidence_required: string }>`SELECT code, evidence_required FROM risk_rules WHERE rule_set_version = ${e.rule_set_version}`.execute(this.db)).rows;
    return {
      factors: actionable.map((f) => ({ code: f.code, category: f.category, result: f.result, reason: f.reason, evidence_required: evidence.find((r) => r.code === f.code)?.evidence_required ?? null })),
      not_actionable_note: 'Los factores que dependen de decisiones u operaciones inexistentes (D-05, proveedor satelital) no admiten mitigación: no se simula su resolución.',
      assignees: await this.eligibleAssignees(this.db, ctx.organizationId),
    };
  }

  async create(user: AuthUser, orgId: string, dto: CreateDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'mitigation:manage', true);
    const prior = await this.db.selectFrom('mitigation_actions').select(['id', 'evaluation_id', 'factor_code']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.evaluation_id !== dto.evaluation_id || prior.factor_code !== dto.factor_code) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, mitigation: await this.view(this.db, ctx, prior.id) };
    }
    const { e, factor, actionable } = await this.evaluationFactor(this.db, orgId, dto.evaluation_id, dto.factor_code);
    if (!factor) throw new AppError(422, 'FACTOR_NOT_IN_EVALUATION', 'El factor no pertenece a esa evaluación.', [{ field: 'factor_code', reason: 'UNKNOWN' }]);
    if (!actionable.some((f) => f.code === dto.factor_code)) throw new AppError(422, 'CAUSE_NOT_ACTIONABLE', factor.depends_on ? `La causa depende de ${factor.depends_on}: no puede mitigarse hasta que exista esa decisión u operación.` : 'El factor no tiene hallazgo ni datos faltantes que mitigar.', [{ field: 'factor_code', reason: 'NOT_ACTIONABLE' }]);
    if (!(await this.eligibleAssignees(this.db, orgId)).some((a) => a.membership_id === dto.assignee_membership_id)) throw new AppError(422, 'ASSIGNEE_NOT_ELIGIBLE', 'El responsable no es un miembro activo de tu organización con facultad para aportar soportes de mitigación.', [{ field: 'assignee_membership_id', reason: 'NOT_ELIGIBLE' }]);
    if (Number.isNaN(Date.parse(`${dto.due_date}T00:00:00Z`))) throw new AppError(422, 'DATE_INVALID', 'Plazo no válido.', [{ field: 'due_date', reason: 'DATE_INVALID' }]);
    const rule = (await sql<{ evidence_required: string }>`SELECT evidence_required FROM risk_rules WHERE rule_set_version = ${e.rule_set_version} AND code = ${dto.factor_code}`.execute(this.db)).rows[0];
    const id = await this.db.transaction().execute(async (trx) => {
      const id = randomUUID();
      await trx.insertInto('mitigation_actions').values({ id, organization_id: orgId, evaluation_id: e.id, factor_code: dto.factor_code, subject_type: 'LOT', subject_id: e.subject_id, title: dto.title.trim(),
        acceptance_criteria: dto.acceptance_criteria.trim(), evidence_required: (dto.evidence_required ?? rule?.evidence_required ?? 'Evidencia según la regla').trim(), assignee_membership_id: dto.assignee_membership_id,
        due_date: dto.due_date, status: 'OPEN', created_by: user.id, operation_id: dto.operation_id }).execute();
      await this.record(trx, ctx, user.id, id, e.subject_id, 'MitigationCreated', 1, { evaluation_id: e.id, factor_code: dto.factor_code, due_date: dto.due_date }, 'mitigation.create', requestId);
      return id;
    });
    return { replayed: false, mitigation: await this.view(this.db, ctx, id) };
  }

  private async record(trx: Transaction<Database>, ctx: TenantContext, userId: string, actionId: string, lotId: string, eventType: string, version: number, payload: Record<string, unknown>, action: string, requestId?: string) {
    await this.events.append(trx, { organizationId: ctx.organizationId, eventType, schemaVersion: 1, aggregateType: 'MITIGATION', aggregateId: actionId, aggregateVersion: version, actorId: userId, correlationId: requestId, payload: { action_id: actionId, subject_id: lotId, ...payload } });
    await this.audit.record(trx, { organizationId: ctx.organizationId, actorUserId: userId, action, entityType: 'lot', entityId: lotId, requestId, result: 'SUCCESS', after: { reason: payload.reason as string | undefined ?? payload.factor_code as string | undefined } });
  }

  private async lockAction(trx: Transaction<Database>, orgId: string, id: string) {
    const a = await trx.selectFrom('mitigation_actions').selectAll().where('organization_id', '=', orgId).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!a) throw notFound();
    return a;
  }
  private async round(db: Db, actionId: string) {
    return (await sql<{ n: number }>`SELECT count(*)::int AS n FROM mitigation_submissions WHERE action_id = ${actionId}`.execute(db)).rows[0].n + 1;
  }

  async addSupport(user: AuthUser, orgId: string, id: string, dto: SupportDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'mitigation:contribute', true);
    if (!dto.document_version_id === !dto.evidence_id) throw new AppError(400, 'VALIDATION_FAILED', 'Indica una versión de documento o una evidencia (una sola).', [{ field: 'document_version_id', reason: 'ONE_REQUIRED' }]);
    const prior = await this.db.selectFrom('mitigation_supports').select(['action_id']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.action_id !== id) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, mitigation: await this.view(this.db, ctx, id) };
    }
    await this.db.transaction().execute(async (trx) => {
      const a = await this.lockAction(trx, orgId, id);
      if (a.assignee_membership_id !== ctx.membershipId) throw forbidden('NOT_ASSIGNEE', 'Solo el responsable asignado aporta soportes a esta mitigación.');
      if (!['OPEN', 'REJECTED', 'REOPENED'].includes(a.status)) throw conflict('MITIGATION_NOT_EDITABLE', 'La mitigación ya fue entregada o verificada: no admite soportes en esta entrega.');
      let evidenceVersion: string | null = null;
      if (dto.document_version_id) {
        const v = (await sql<{ scan: string | null; expired: boolean }>`
          SELECT (SELECT s.result FROM document_version_scans s WHERE s.version_id = v.id ORDER BY s.id DESC LIMIT 1) AS scan, (v.expires_at IS NOT NULL AND v.expires_at < current_date) AS expired
          FROM document_versions v WHERE v.organization_id = ${orgId} AND v.id = ${dto.document_version_id}`.execute(trx)).rows[0];
        if (!v) throw notFound('La versión del documento no existe en tu organización.');
        if (v.scan !== 'CLEAN') throw new AppError(422, 'SUPPORT_NOT_AVAILABLE', 'El archivo no está disponible (análisis antimalware pendiente, fallido o rechazado).', [{ field: 'document_version_id', reason: 'NOT_AVAILABLE' }]);
        if (v.expired) throw new AppError(422, 'SUPPORT_EXPIRED', 'La versión del documento está vencida.', [{ field: 'document_version_id', reason: 'EXPIRED' }]);
      } else {
        if (!this.has(ctx, 'evidence:read')) throw forbidden();
        const ev = (await sql<{ row_version: string }>`SELECT row_version::text FROM evidence WHERE organization_id = ${orgId} AND id = ${dto.evidence_id}`.execute(trx)).rows[0];
        if (!ev) throw notFound('La evidencia no existe en tu organización.');
        evidenceVersion = ev.row_version;
      }
      const n = await this.round(trx, id);
      await trx.insertInto('mitigation_supports').values({ id: randomUUID(), organization_id: orgId, action_id: id, submission_number: n, document_version_id: dto.document_version_id ?? null, evidence_id: dto.evidence_id ?? null,
        evidence_version: evidenceVersion, added_by: user.id, operation_id: dto.operation_id }).execute();
      const after = await trx.updateTable('mitigation_actions').set({ row_version: sql`row_version + 1` } as never).where('id', '=', id).returning('row_version').executeTakeFirstOrThrow();
      await this.record(trx, ctx, user.id, id, a.subject_id, 'MitigationSupportAdded', Number(after.row_version), { submission_number: n, document_version_id: dto.document_version_id ?? null, evidence_id: dto.evidence_id ?? null }, 'mitigation.add_support', requestId);
    });
    return { replayed: false, mitigation: await this.view(this.db, ctx, id) };
  }

  async submit(user: AuthUser, orgId: string, id: string, dto: SubmitDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'mitigation:contribute', true);
    const prior = await this.db.selectFrom('mitigation_submissions').select('action_id').where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.action_id !== id) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, mitigation: await this.view(this.db, ctx, id) };
    }
    await this.db.transaction().execute(async (trx) => {
      const a = await this.lockAction(trx, orgId, id);
      if (a.assignee_membership_id !== ctx.membershipId) throw forbidden('NOT_ASSIGNEE', 'Solo el responsable asignado entrega esta mitigación.');
      if (!['OPEN', 'REJECTED', 'REOPENED'].includes(a.status)) throw conflict('INVALID_TRANSITION', 'La mitigación no está abierta para una entrega.');
      if (Number(a.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'La mitigación cambió. Recarga.');
      const n = await this.round(trx, id);
      const supports = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM mitigation_supports WHERE action_id = ${id} AND submission_number = ${n}`.execute(trx)).rows[0].n;
      if (!supports) throw new AppError(422, 'SUPPORT_REQUIRED', 'Aporta al menos un soporte antes de entregar (el soporte no verifica la mitigación).', [{ field: 'supports', reason: 'REQUIRED' }]);
      await trx.insertInto('mitigation_submissions').values({ id: randomUUID(), organization_id: orgId, action_id: id, submission_number: n, note: dto.note.trim(), submitted_by: user.id, operation_id: dto.operation_id }).execute();
      const after = await trx.updateTable('mitigation_actions').set({ status: 'SUBMITTED', row_version: sql`row_version + 1` } as never).where('id', '=', id).returning('row_version').executeTakeFirstOrThrow();
      await this.record(trx, ctx, user.id, id, a.subject_id, 'MitigationSubmitted', Number(after.row_version), { submission_number: n }, 'mitigation.submit', requestId);
    });
    return { replayed: false, mitigation: await this.view(this.db, ctx, id) };
  }

  async decide(user: AuthUser, orgId: string, id: string, dto: DecisionDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'mitigation:verify', true);
    const prior = await this.db.selectFrom('mitigation_decisions').select(['action_id', 'decision']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.action_id !== id || prior.decision !== dto.decision) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, mitigation: await this.view(this.db, ctx, id) };
    }
    if (dto.decision === 'VERIFIED' && dto.criterion_met !== true) throw new AppError(422, 'CRITERION_CONFIRMATION_REQUIRED', 'Para verificar, confirma que se cumple el criterio de aceptación de la acción. Un soporte aceptable no basta: si el criterio no se cumple, rechaza con motivo.', [{ field: 'criterion_met', reason: 'REQUIRED' }]);
    try {
      await this.db.transaction().execute(async (trx) => {
        const a = await this.lockAction(trx, orgId, id);
        if (a.status !== 'SUBMITTED') throw conflict('INVALID_TRANSITION', 'Solo se decide una mitigación entregada.');
        if (Number(a.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'La mitigación cambió (otra decisión o entrega). Recarga.');
        const n = (await sql<{ n: number }>`SELECT max(submission_number)::int AS n FROM mitigation_submissions WHERE action_id = ${id}`.execute(trx)).rows[0].n;
        // Separación de funciones (docs/13): sin política de excepción, quien entregó o aportó soportes no decide.
        const executor = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM (SELECT submitted_by AS u FROM mitigation_submissions WHERE action_id = ${id} AND submission_number = ${n}
          UNION SELECT added_by FROM mitigation_supports WHERE action_id = ${id} AND submission_number = ${n}) x WHERE x.u = ${user.id}`.execute(trx)).rows[0].n;
        if (executor > 0) throw forbidden('SELF_VERIFICATION_NOT_ALLOWED', 'Quien ejecutó la mitigación no puede verificarla ni rechazarla: no existe una política expresa de excepción (docs/13).');
        await trx.insertInto('mitigation_decisions').values({ id: randomUUID(), organization_id: orgId, action_id: id, submission_number: n, decision: dto.decision, reason: dto.reason.trim(), decided_by: user.id, operation_id: dto.operation_id, criterion_met: dto.decision === 'VERIFIED' }).execute();
        const after = await trx.updateTable('mitigation_actions').set({ status: dto.decision, row_version: sql`row_version + 1` } as never).where('id', '=', id).returning('row_version').executeTakeFirstOrThrow();
        await this.record(trx, ctx, user.id, id, a.subject_id, dto.decision === 'VERIFIED' ? 'MitigationVerified' : 'MitigationRejected', Number(after.row_version),
          { submission_number: n, reason: dto.reason.trim(), factor_code: a.factor_code }, dto.decision === 'VERIFIED' ? 'mitigation.verify' : 'mitigation.reject', requestId);
      });
    } catch (err) {
      const e = err as { code?: string; message?: string; constraint?: string };
      if (e.code === '23514' && /mitigation_decisions/.test(e.message ?? '')) throw forbidden('SELF_VERIFICATION_NOT_ALLOWED', 'Quien ejecutó la mitigación no puede verificarla ni rechazarla.');
      if (e.constraint === 'mitigation_decisions_uq') throw conflict('ALREADY_DECIDED', 'Otra persona ya decidió esta entrega. Recarga.');
      throw err;
    }
    return { replayed: false, mitigation: await this.view(this.db, ctx, id) };
  }

  /**
   * Corrección revisada de una verificación (docs/13; revisión de P0-021): la decisión original se conserva y se registra que
   * el criterio de aceptación NO se cumple (indicando si el soporte sigue aceptado como soporte). La acción queda REABIERTA
   * para una nueva entrega y se encola una reevaluación. No inventa ni cambia datos de la causa.
   */
  async correct(user: AuthUser, orgId: string, id: string, dto: CorrectionDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'mitigation:verify', true);
    const prior = await this.db.selectFrom('mitigation_corrections').select('action_id').where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.action_id !== id) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, mitigation: await this.view(this.db, ctx, id) };
    }
    try {
      await this.db.transaction().execute(async (trx) => {
        const a = await this.lockAction(trx, orgId, id);
        if (a.status !== 'VERIFIED') throw conflict('INVALID_TRANSITION', 'Solo se corrige una verificación vigente.');
        if (Number(a.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'La mitigación cambió. Recarga.');
        const d = (await sql<{ id: string; submission_number: number }>`SELECT id, submission_number FROM mitigation_decisions WHERE action_id = ${id} ORDER BY submission_number DESC LIMIT 1`.execute(trx)).rows[0];
        const executor = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM (SELECT submitted_by AS u FROM mitigation_submissions WHERE action_id = ${id} AND submission_number = ${d.submission_number}
          UNION SELECT added_by FROM mitigation_supports WHERE action_id = ${id} AND submission_number = ${d.submission_number}) x WHERE x.u = ${user.id}`.execute(trx)).rows[0].n;
        if (executor > 0) throw forbidden('SELF_VERIFICATION_NOT_ALLOWED', 'Quien ejecutó la mitigación no puede corregir su verificación.');
        await trx.insertInto('mitigation_corrections').values({ id: randomUUID(), organization_id: orgId, action_id: id, decision_id: d.id, submission_number: d.submission_number, support_accepted: dto.support_accepted,
          criterion_met: false, reason: dto.reason.trim(), corrected_by: user.id, operation_id: dto.operation_id }).execute();
        const after = await trx.updateTable('mitigation_actions').set({ status: 'REOPENED', row_version: sql`row_version + 1` } as never).where('id', '=', id).returning('row_version').executeTakeFirstOrThrow();
        await this.record(trx, ctx, user.id, id, a.subject_id, 'MitigationVerificationCorrected', Number(after.row_version),
          { submission_number: d.submission_number, decision_id: d.id, support_accepted: dto.support_accepted, criterion_met: false, reason: dto.reason.trim(), factor_code: a.factor_code }, 'mitigation.correct_verification', requestId);
      });
    } catch (err) {
      const e = err as { code?: string; message?: string; constraint?: string };
      if (e.code === '23514' && /mitigation_corrections/.test(e.message ?? '')) throw forbidden('SELF_VERIFICATION_NOT_ALLOWED', 'Quien ejecutó la mitigación no puede corregir su verificación.');
      if (e.constraint === 'mitigation_corrections_decision_uq') throw conflict('ALREADY_CORRECTED', 'Esa verificación ya fue corregida. Recarga.');
      throw err;
    }
    return { replayed: false, mitigation: await this.view(this.db, ctx, id) };
  }

  private async view(db: Db, ctx: TenantContext, id: string) {
    const a = (await sql<{ id: string; evaluation_id: string; factor_code: string; subject_id: string; lot_code: string; title: string; acceptance_criteria: string; evidence_required: string; assignee_membership_id: string;
      af: string | null; al: string | null; due_date: string; status: string; row_version: string; created_at: string; cf: string | null; cl: string | null; evaluation_number: number; rule_set_version: string }>`
      SELECT a.id, a.evaluation_id, a.factor_code, a.subject_id, l.lot_code, a.title, a.acceptance_criteria, a.evidence_required, a.assignee_membership_id, au.first_name AS af, au.last_name AS al,
             a.due_date::text, a.status, a.row_version::text, a.created_at, cu.first_name AS cf, cu.last_name AS cl, e.evaluation_number, e.rule_set_version
      FROM mitigation_actions a JOIN lots l ON l.id = a.subject_id JOIN memberships m ON m.id = a.assignee_membership_id JOIN users au ON au.id = m.user_id
      LEFT JOIN users cu ON cu.id = a.created_by JOIN risk_evaluations e ON e.id = a.evaluation_id
      WHERE a.organization_id = ${ctx.organizationId} AND a.id = ${id}`.execute(db)).rows[0];
    if (!a) throw notFound();
    const factor = (await sql<{ f: { code: string; reason: string; result: string; category: string } }>`SELECT f FROM risk_evaluations e, jsonb_array_elements(e.factors) f WHERE e.id = ${a.evaluation_id} AND f->>'code' = ${a.factor_code}`.execute(db)).rows[0]?.f ?? null;
    const supports = (await sql<{ id: string; submission_number: number; document_version_id: string | null; evidence_id: string | null; evidence_version: string | null; added_at: string; f: string | null; l: string | null;
      title: string | null; version_number: number | null; scan: string | null; expired: boolean | null; newer: boolean | null; current_evidence_version: string | null; claim_type: string | null }>`
      SELECT s.id, s.submission_number, s.document_version_id, s.evidence_id, s.evidence_version::text, s.added_at, u.first_name AS f, u.last_name AS l,
             d.title, v.version_number, (SELECT sc.result FROM document_version_scans sc WHERE sc.version_id = v.id ORDER BY sc.id DESC LIMIT 1) AS scan,
             (v.expires_at IS NOT NULL AND v.expires_at < current_date) AS expired,
             EXISTS (SELECT 1 FROM document_versions x WHERE x.document_id = v.document_id AND x.version_number > v.version_number) AS newer,
             ev.row_version::text AS current_evidence_version, ev.claim_type
      FROM mitigation_supports s LEFT JOIN users u ON u.id = s.added_by
      LEFT JOIN document_versions v ON v.id = s.document_version_id LEFT JOIN documents d ON d.id = v.document_id LEFT JOIN evidence ev ON ev.id = s.evidence_id
      WHERE s.action_id = ${id} ORDER BY s.submission_number, s.added_at`.execute(db)).rows;
    const submissions = (await sql<{ submission_number: number; note: string; submitted_at: string; f: string | null; l: string | null }>`
      SELECT s.submission_number, s.note, s.submitted_at, u.first_name AS f, u.last_name AS l FROM mitigation_submissions s LEFT JOIN users u ON u.id = s.submitted_by WHERE s.action_id = ${id} ORDER BY s.submission_number`.execute(db)).rows;
    const decisions = (await sql<{ submission_number: number; decision: string; reason: string; decided_at: string; f: string | null; l: string | null; criterion_met: boolean | null }>`
      SELECT d.submission_number, d.decision, d.reason, d.decided_at, d.criterion_met, u.first_name AS f, u.last_name AS l FROM mitigation_decisions d LEFT JOIN users u ON u.id = d.decided_by WHERE d.action_id = ${id} ORDER BY d.submission_number`.execute(db)).rows;
    const corrections = (await sql<{ submission_number: number; support_accepted: boolean; reason: string; corrected_at: string; f: string | null; l: string | null }>`
      SELECT c.submission_number, c.support_accepted, c.reason, c.corrected_at, u.first_name AS f, u.last_name AS l FROM mitigation_corrections c LEFT JOIN users u ON u.id = c.corrected_by WHERE c.action_id = ${id} ORDER BY c.corrected_at`.execute(db)).rows;
    // Tres dimensiones separadas: soporte aceptado · acción ejecutada (criterio) · causa (última evaluación del sujeto).
    const lastDecision = decisions[decisions.length - 1];
    const lastCorrection = lastDecision ? corrections.find((c) => c.submission_number === lastDecision.submission_number) : undefined;
    const latestEval = (await sql<{ evaluation_number: number; f: { result: string } | null }>`
      SELECT e.evaluation_number, (SELECT f FROM jsonb_array_elements(e.factors) f WHERE f->>'code' = ${a.factor_code}) AS f
      FROM risk_evaluations e WHERE e.organization_id = ${ctx.organizationId} AND e.subject_id = ${a.subject_id} ORDER BY e.evaluation_number DESC LIMIT 1`.execute(db)).rows[0];
    const support = !lastDecision ? 'NOT_REVIEWED' : lastCorrection ? (lastCorrection.support_accepted ? 'ACCEPTED' : 'NOT_ACCEPTED') : lastDecision.decision === 'VERIFIED' ? 'ACCEPTED' : 'NOT_ACCEPTED';
    const action = !lastDecision || a.status === 'SUBMITTED' && lastDecision.submission_number < Math.max(0, ...submissions.map((x) => x.submission_number)) ? 'PENDING'
      : lastCorrection || lastDecision.decision === 'REJECTED' ? 'CRITERION_NOT_MET' : lastDecision.criterion_met === true ? 'CRITERION_MET' : 'NOT_RECORDED';
    const cause = !latestEval?.f ? 'UNKNOWN' : latestEval.f.result === 'HIT' ? 'PERSISTS' : latestEval.f.result === 'NOT_HIT' ? 'NOT_DETECTED' : 'UNKNOWN';
    const n = latestEval?.evaluation_number;
    const outcome = {
      support: { status: support, label: ({ NOT_REVIEWED: 'Sin revisar', ACCEPTED: 'Soporte aceptado', NOT_ACCEPTED: 'Soporte no aceptado' } as Record<string, string>)[support] },
      action: { status: action, label: ({ PENDING: 'Pendiente de revisión', CRITERION_MET: 'Criterio de aceptación cumplido (declarado por quien verificó)', CRITERION_NOT_MET: 'Criterio de aceptación no cumplido', NOT_RECORDED: 'Criterio no registrado en la verificación (decisión anterior a esta revisión)' } as Record<string, string>)[action] },
      cause: { status: cause, evaluation_number: n ?? null, label: ({ PERSISTS: `La causa persiste en la evaluación ${n}`, NOT_DETECTED: `No se detecta en la evaluación ${n} (no es conclusión regulatoria)`, UNKNOWN: 'Causa no evaluable o sin evaluación' } as Record<string, string>)[cause] },
      warning: a.status === 'VERIFIED' && cause === 'PERSISTS' ? `La acción figura verificada pero la causa persiste en la evaluación ${n}. Si el criterio de aceptación no se cumple, corrige la verificación (la decisión original se conserva).` : null,
    };
    // Reevaluación: hecha por esta verificación, cubierta por una evaluación posterior, o pendiente (asíncrona).
    let reevaluation: { status: string; evaluation_id?: string; evaluation_number?: number; note: string } | null = null;
    const verified = decisions.find((d) => d.decision === 'VERIFIED');
    if (verified) {
      const own = (await sql<{ id: string; evaluation_number: number }>`SELECT id, evaluation_number FROM risk_evaluations WHERE organization_id = ${ctx.organizationId} AND trigger->>'action_id' = ${id} ORDER BY evaluation_number DESC LIMIT 1`.execute(db)).rows[0];
      const later = (await sql<{ id: string; evaluation_number: number }>`SELECT id, evaluation_number FROM risk_evaluations WHERE organization_id = ${ctx.organizationId} AND subject_id = ${a.subject_id} AND evaluated_at >= ${verified.decided_at} ORDER BY evaluation_number DESC LIMIT 1`.execute(db)).rows[0];
      reevaluation = own ? { status: 'DONE', evaluation_id: own.id, evaluation_number: own.evaluation_number, note: 'Nueva evaluación con todas las reglas y los datos actuales; puede seguir bloqueada por otras causas.' }
        : later ? { status: 'SUPERSEDED', evaluation_id: later.id, evaluation_number: later.evaluation_number, note: 'Una evaluación posterior a la verificación ya incluye su efecto; no se repite.' }
          : { status: 'PENDING', note: 'Reevaluación en cola (outbox): el resultado de riesgo no cambia hasta que se registre.' };
    }
    // Cambios posteriores relevantes: se informa la necesidad de revisión sin modificar el registro.
    const reviewReasons: string[] = [];
    if (a.status === 'VERIFIED') {
      const lastRound = Math.max(...decisions.map((d) => d.submission_number));
      for (const s of supports.filter((x) => x.submission_number === lastRound)) {
        if (s.document_version_id && s.newer) reviewReasons.push(`Hay una versión más reciente de «${s.title}» (no sustituye el soporte verificado ni hereda la aprobación).`);
        if (s.document_version_id && s.expired) reviewReasons.push(`El soporte «${s.title}» venció después de verificarse.`);
        if (s.document_version_id && s.scan !== 'CLEAN') reviewReasons.push(`El soporte «${s.title}» dejó de estar disponible.`);
        if (s.evidence_id && s.evidence_version !== s.current_evidence_version) reviewReasons.push('La evidencia de soporte cambió después de verificarse.');
      }
    }
    const due = new Date(`${a.due_date}T23:59:59Z`) < new Date() && ['OPEN', 'REJECTED', 'REOPENED'].includes(a.status);
    const isAssignee = a.assignee_membership_id === ctx.membershipId;
    return {
      id: a.id, status: a.status, status_label: STATUS_LABEL[a.status], row_version: Number(a.row_version),
      cause: { evaluation_id: a.evaluation_id, evaluation_number: a.evaluation_number, rule_set_version: a.rule_set_version, factor_code: a.factor_code, factor, subject: { type: 'LOT', id: a.subject_id, code: a.lot_code } },
      title: a.title, acceptance_criteria: a.acceptance_criteria, evidence_required: a.evidence_required, due_date: a.due_date, overdue: due,
      assignee: { membership_id: a.assignee_membership_id, name: name(a.af, a.al) }, created_by: name(a.cf, a.cl), created_at: a.created_at,
      supports: supports.map((s) => ({ id: s.id, submission_number: s.submission_number, kind: s.document_version_id ? 'DOCUMENT_VERSION' : 'EVIDENCE', document_version_id: s.document_version_id, title: s.title, version_number: s.version_number,
        availability: s.document_version_id ? (s.scan === 'CLEAN' ? 'AVAILABLE' : 'NOT_AVAILABLE') : null, expired: s.expired, newer_version_exists: s.newer, evidence_id: s.evidence_id, claim_type: s.claim_type,
        evidence_version: s.evidence_version, added_by: name(s.f, s.l), added_at: s.added_at })),
      submissions: submissions.map((s) => ({ number: s.submission_number, note: s.note, at: s.submitted_at, executor: name(s.f, s.l) })),
      decisions: decisions.map((d) => ({ submission_number: d.submission_number, decision: d.decision, reason: d.reason, at: d.decided_at, verifier: name(d.f, d.l), criterion_met: d.criterion_met })),
      corrections: corrections.map((c) => ({ submission_number: c.submission_number, support_accepted: c.support_accepted, criterion_met: false, reason: c.reason, at: c.corrected_at, corrected_by: name(c.f, c.l) })),
      outcome,
      reevaluation, requires_review: reviewReasons,
      note: 'Aportar soportes no verifica. Verificar no vuelve favorable el riesgo ni resuelve la causa: la reevaluación decide con los datos actuales. Quien ejecuta no verifica (docs/13).',
      actions: {
        add_support: isAssignee && this.has(ctx, 'mitigation:contribute') && ['OPEN', 'REJECTED', 'REOPENED'].includes(a.status),
        submit: isAssignee && this.has(ctx, 'mitigation:contribute') && ['OPEN', 'REJECTED', 'REOPENED'].includes(a.status),
        decide: this.has(ctx, 'mitigation:verify') && a.status === 'SUBMITTED',
        correct: this.has(ctx, 'mitigation:verify') && a.status === 'VERIFIED',
      },
    };
  }

  async detail(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, 'mitigation:read', false);
    return this.view(this.db, ctx, id);
  }

  async list(user: AuthUser, orgId: string, q: ListQuery) {
    const ctx = await this.ctx(user, orgId, 'mitigation:read', false);
    const rows = (await sql<{ id: string; title: string; factor_code: string; status: string; due_date: string; lot_code: string; subject_id: string; f: string | null; l: string | null; assignee_membership_id: string }>`
      SELECT a.id, a.title, a.factor_code, a.status, a.due_date::text, l.lot_code, a.subject_id, u.first_name AS f, u.last_name AS l, a.assignee_membership_id
      FROM mitigation_actions a JOIN lots l ON l.id = a.subject_id JOIN memberships m ON m.id = a.assignee_membership_id JOIN users u ON u.id = m.user_id
      WHERE a.organization_id = ${ctx.organizationId} ${q.status ? sql`AND a.status = ${q.status}` : sql``} ${q.lot_id ? sql`AND a.subject_id = ${q.lot_id}` : sql``}
      ORDER BY a.due_date, a.created_at`.execute(this.db)).rows;
    return rows.map((r) => ({ id: r.id, title: r.title, factor_code: r.factor_code, status: r.status, status_label: STATUS_LABEL[r.status], due_date: r.due_date, lot: { id: r.subject_id, code: r.lot_code },
      assignee: name(r.f, r.l), mine: r.assignee_membership_id === ctx.membershipId, overdue: new Date(`${r.due_date}T23:59:59Z`) < new Date() && ['OPEN', 'REJECTED', 'REOPENED'].includes(r.status) }));
  }
}

/**
 * Consumidor del outbox: reevalúa el lote tras una mitigación verificada. Idempotente por evento (operation_id = event_id;
 * recibos del consumidor) y deduplicado: si ya hay una evaluación del sujeto posterior al evento, no se crea otra (un
 * trabajo atrasado no sustituye una evaluación posterior).
 */
export const riskReevaluationConsumer: EventConsumer = {
  name: 'risk-reevaluation',
  eventTypes: ['MitigationVerified', 'MitigationVerificationCorrected'],
  async handle(trx: Transaction<Database>, event: DomainEvent) {
    const p = event.payload as { action_id: string; subject_id: string };
    const later = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM risk_evaluations WHERE organization_id = ${event.organization_id} AND subject_id = ${p.subject_id} AND evaluated_at >= ${event.recorded_at}`.execute(trx)).rows[0].n;
    if (later > 0) return;
    const { PRODUCTION_CONSUMERS } = await import('../events/consumers');
    const service = new RiskService(trx as unknown as Kysely<Database>, new EventStore(PRODUCTION_CONSUMERS), null as unknown as AuthorizationService, new AuditService());
    await service.evaluateInTrx(trx, { orgId: event.organization_id, lotId: p.subject_id, actorId: event.actor_id!, operationId: event.event_id, basedOn: null,
      trigger: { kind: event.event_type === 'MitigationVerified' ? 'MITIGATION_VERIFIED' : 'MITIGATION_VERIFICATION_CORRECTED', action_id: p.action_id, event_id: event.event_id,
        triggered_by: event.actor_id, executed_by: 'worker:risk-reevaluation' } });
  },
};

@ApiTags('mitigations')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class MitigationsController {
  constructor(private readonly service: MitigationsService) {}

  @Get('mitigation-options') options(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Query() q: OptionsQuery) { return this.service.options(u, o, q); }
  @Get('mitigations') list(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Query() q: ListQuery) { return this.service.list(u, o, q); }
  @Post('mitigations') create(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: CreateDto, @Req() req: AuthedRequest) { return this.service.create(u, o, dto, req.requestId); }
  @Get('mitigations/:id') detail(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(u, o, id); }
  @Post('mitigations/:id/supports') support(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupportDto, @Req() req: AuthedRequest) { return this.service.addSupport(u, o, id, dto, req.requestId); }
  @Post('mitigations/:id/submit') submit(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitDto, @Req() req: AuthedRequest) { return this.service.submit(u, o, id, dto, req.requestId); }
  @Post('mitigations/:id/corrections') correct(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectionDto, @Req() req: AuthedRequest) { return this.service.correct(u, o, id, dto, req.requestId); }
  @Post('mitigations/:id/decisions') decide(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @Req() req: AuthedRequest) { return this.service.decide(u, o, id, dto, req.requestId); }
}
