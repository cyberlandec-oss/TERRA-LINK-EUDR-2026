import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/database';
import type { Applicability, Database, ItemResult } from '../db/schema';
import { AppError, forbidden, notFound } from '../common/errors';
import { PlotsService } from '../plots/plots';

// P1-005 — Perfil jurídico **revisable**. Monta el mecanismo; **no aprueba derecho**.
//
// LO QUE ESTE MÓDULO NO HACE, Y ES LO MÁS IMPORTANTE
// No aprueba contenido jurídico, no cierra P1-005 y **no abre `READY` por ninguna vía**. El perfil sembrado es
// **PARCIAL** y su revisión jurídica está **PENDIENTE**, de modo que `LEGAL_PROFILE` se queda en `PENDING`:
// una revisión necesaria sin resolver **sigue impidiendo acreditar `READY`**, que es justo lo contrario de
// «desconocido, luego no molesta».
//
// PERMISOS: SE REUTILIZAN, NO SE INVENTAN
// Crear un rol nuevo no acredita competencia profesional, así que no se crea ninguno. Se usa el catálogo que
// ya existe, separando **competencia de aplicación** de **competencia jurídica**:
//   · `traceability:read_catalog` → leer el catálogo de perfiles (es un catálogo de sistema, como KDE/CTE);
//   · `risk:approve_rules` → **adoptar o retirar** el perfil en la organización (la misma facultad que ya
//     gobierna la adopción del catálogo de riesgo, D-07.1; solo ORG_ADMIN la tiene);
//   · `dd:manage` → preparar la evaluación de una parcela y asociarle evidencia;
//   · `dd:read` → consultarla;
//   · `risk:review` → registrar el **resultado de la revisión de aplicabilidad**.
//
// **La revisión JURÍDICA del perfil no tiene endpoint.** No existe hoy un responsable con competencia
// acreditada, y fabricar uno sería inventar el aprobador que el contrato prohíbe inventar. La tabla y sus
// restricciones existen —responsable identificado y fundamento obligatorios—, pero mientras nadie lo decida el
// perfil **permanece pendiente**. En pruebas se usa una fila **sintética**, nunca un endpoint.
//
// LOS TRES EJES, SEPARADOS
// **Aplicabilidad**, **evidencia** y **resultado** son cosas distintas y la base lo impone con `CHECK`:
// aplicabilidad desconocida → `NOT_EVALUABLE` (nunca cumplida por defecto); aplicable y sin evidencia →
// `PENDING` (ni satisfecha, ni por sí sola una infracción); `SATISFIED` exige aplicable + evidencia +
// admisibilidad **justificada por requisito** + revisor + motivo.
//
// EVIDENCIA: SE REUTILIZA EL MÓDULO DOCUMENTAL
// La evidencia es una **versión exacta** de `document_versions`, con la integridad de tenant por clave
// compuesta. No se crea otro almacén. **Admitir un archivo no lo vuelve auténtico, suficiente ni
// jurídicamente admisible**: por eso la procedencia se distingue (documento oficial o declaración del
// productor) y la admisibilidad hay que justificarla.
//
// CARTOGRAFÍA
// Se guarda como **indicio** con su fuente y su nota, y **no entra en ningún `CHECK` de resultado**: no
// declara infracción ni cumplimiento. No se envía ninguna geometría a servicios externos.

export const PERFIL_VIGENTE = '0.1.0';

class AdoptarDto {
  @IsUUID() operation_id!: string;
  @IsString() @Length(3, 20) version!: string;
  @IsIn(['ADOPT', 'WITHDRAW']) decision!: 'ADOPT' | 'WITHDRAW';
  @IsString() @Length(3, 500) reason!: string;
}

class PrepararDto {
  @IsUUID() operation_id!: string;
  @IsUUID() plot_id!: string;
}

class RevisarDto {
  @IsIn(['UNKNOWN', 'APPLICABLE', 'NOT_APPLICABLE']) applicability!: Applicability;
  @IsOptional() @IsString() @Length(3, 1000) applicability_reason?: string;
  @IsOptional() @IsUUID() evidence_version_id?: string;
  @IsOptional() @IsIn(['OFFICIAL_DOCUMENT', 'PRODUCER_DECLARATION']) evidence_origin?: 'OFFICIAL_DOCUMENT' | 'PRODUCER_DECLARATION';
  @IsOptional() @IsString() @Length(3, 1000) evidence_justification?: string;
  @IsIn(['PENDING', 'SATISFIED', 'NOT_SATISFIED', 'NOT_EVALUABLE', 'NOT_APPLICABLE']) result!: ItemResult;
  @IsOptional() @IsString() @Length(3, 1000) reason?: string;
  @IsOptional() @IsIn(['NONE', 'INDICATION', 'NOT_ASSESSED']) cartographic_indication?: 'NONE' | 'INDICATION' | 'NOT_ASSESSED';
  @IsOptional() @IsString() @Length(3, 300) cartographic_source?: string;
  @IsOptional() @IsString() @Length(3, 1000) cartographic_note?: string;
  @IsString() @Length(3, 500) change_note!: string;
  @IsString() expected_version!: string;
}

/** Estado del perfil para una organización: lo que `LEGAL_PROFILE` necesita saber, sin adornos. */
export interface EstadoPerfil {
  version: string;
  scope: 'PARTIAL' | 'COMPLETE';
  legal_review_status: 'PENDING' | 'REVIEWED';
  pending_matters: string[];
  adopted: boolean;
}

/**
 * Perfil adoptado por la organización, con su estado de revisión jurídica. `null` si no adoptó ninguno.
 * Es la única entrada que el expediente usa: la decisión de qué significa se toma en `requirements.ts`.
 */
export async function perfilDeOrganizacion(db: Kysely<Database>, orgId: string): Promise<EstadoPerfil | null> {
  const adop = await db.selectFrom('legal_profile_adoptions')
    .select(['version', 'decision'])
    .where('organization_id', '=', orgId)
    .orderBy('decided_at', 'desc').orderBy('id', 'desc')
    .executeTakeFirst();
  if (!adop || adop.decision !== 'ADOPT') return null;
  const v = await db.selectFrom('legal_profile_versions')
    .select(['version', 'scope', 'pending_matters'])
    .where('version', '=', adop.version).executeTakeFirst();
  if (!v) return null;
  // La revisión jurídica es el ÚLTIMO hecho fechado, no una columna.
  const rev = await db.selectFrom('legal_profile_reviews')
    .select(['decision']).where('version', '=', adop.version)
    .orderBy('decided_at', 'desc').orderBy('id', 'desc').executeTakeFirst();
  return {
    version: v.version,
    scope: v.scope,
    legal_review_status: rev?.decision === 'REVIEWED' ? 'REVIEWED' : 'PENDING',
    pending_matters: v.pending_matters,
    adopted: true,
  };
}

/** Cobertura legal de UN sujeto concreto (una parcela). Es lo que el expediente necesita mirar. */
export interface CoberturaSujeto {
  plot_id: string;
  /** Versión del perfil con la que se evaluó, o `null` si no hay evaluación. */
  assessed_version: string | null;
  /** Reglas sin resolver: pendientes o no evaluables. */
  unresolved: string[];
  /** Reglas con resultado NO satisfecho. */
  not_satisfied: string[];
  /** Reglas cuya versión documental de evidencia fue **sustituida** por otra posterior. */
  stale_evidence: string[];
  /** Reglas cuya evidencia pertenece a **otro sujeto** (filas anteriores a la comprobación de escritura). */
  foreign_evidence: string[];
}

/**
 * Cobertura legal de las parcelas indicadas, con el perfil ADOPTADO.
 *
 * Aquí está la diferencia que el catálogo por sí solo no da: tener un perfil completo y revisado **no dice
 * nada** sobre si ESTE sujeto tiene resueltas sus obligaciones. Se mira la evaluación del sujeto, la versión
 * con la que se hizo, si la evidencia sigue siendo la vigente y si pertenece al propio sujeto.
 */
export async function coberturaDeSujetos(db: Kysely<Database>, orgId: string, plotIds: string[]): Promise<CoberturaSujeto[]> {
  const salida: CoberturaSujeto[] = [];
  for (const plotId of plotIds) {
    // La evaluación MÁS RECIENTE de esa parcela.
    const a = await db.selectFrom('legal_assessments').select(['id', 'version'])
      .where('organization_id', '=', orgId).where('subject_id', '=', plotId)
      .orderBy('created_at', 'desc').orderBy('id', 'desc').executeTakeFirst();
    if (!a) { salida.push({ plot_id: plotId, assessed_version: null, unresolved: [], not_satisfied: [], stale_evidence: [], foreign_evidence: [] }); continue; }
    const parcela = await db.selectFrom('plots').select(['id', 'producer_id'])
      .where('organization_id', '=', orgId).where('id', '=', plotId).executeTakeFirst();
    const items = await db.selectFrom('legal_assessment_items as i')
      .leftJoin('document_versions as dv', (j) => j.onRef('dv.id', '=', 'i.evidence_version_id').onRef('dv.organization_id', '=', 'i.organization_id'))
      .leftJoin('documents as d', (j) => j.onRef('d.id', '=', 'dv.document_id').onRef('d.organization_id', '=', 'dv.organization_id'))
      .select(['i.rule_code', 'i.result', 'i.evidence_version_id', 'd.current_version_id', 'd.owner_type', 'd.owner_id'])
      .where('i.organization_id', '=', orgId).where('i.assessment_id', '=', a.id).execute();
    const c: CoberturaSujeto = { plot_id: plotId, assessed_version: a.version, unresolved: [], not_satisfied: [], stale_evidence: [], foreign_evidence: [] };
    for (const it of items) {
      if (it.result === 'PENDING' || it.result === 'NOT_EVALUABLE') c.unresolved.push(it.rule_code);
      if (it.result === 'NOT_SATISFIED') c.not_satisfied.push(it.rule_code);
      if (it.evidence_version_id) {
        // Sustituida: el documento tiene ya otra versión vigente. La historia se conserva, pero la evaluación
        // **deja de acreditar sola**: hay que volver a revisarla contra la versión nueva.
        if (it.current_version_id && it.current_version_id !== it.evidence_version_id) c.stale_evidence.push(it.rule_code);
        const propia = (it.owner_type === 'plot' && it.owner_id === parcela?.id)
          || (it.owner_type === 'producer' && it.owner_id === parcela?.producer_id);
        if (!propia) c.foreign_evidence.push(it.rule_code);
      }
    }
    salida.push(c);
  }
  return salida;
}

@Injectable()
export class LegalProfileService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly plots: PlotsService,
  ) {}

  private async ctx(user: AuthUser, orgId: string, permiso: string, mutation: boolean): Promise<TenantContext> {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!(ctx.permissions as string[]).includes(permiso)) throw forbidden();
    if (mutation && ctx.organizationStatus !== 'ACTIVE') {
      throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    }
    return ctx;
  }

  /** Catálogo: versiones, fuentes y reglas candidatas, con su estado de revisión. */
  async catalogo(user: AuthUser, orgId: string) {
    await this.ctx(user, orgId, 'traceability:read_catalog', false);
    const versions = await this.db.selectFrom('legal_profile_versions').selectAll().orderBy('version', 'desc').execute();
    const sources = await this.db.selectFrom('legal_profile_sources').selectAll().execute();
    const rules = await this.db.selectFrom('legal_profile_rules').selectAll().execute();
    const reviews = await this.db.selectFrom('legal_profile_reviews').selectAll().orderBy('decided_at', 'desc').execute();
    const estado = await perfilDeOrganizacion(this.db, orgId);
    return {
      adopted: estado,
      note: 'Catálogo de perfiles jurídicos. Una regla en DRAFT es una CANDIDATA, no una regla aprobada. '
        + 'Un perfil PARCIAL o sin revisión jurídica no satisface LEGAL_PROFILE ni habilita READY.',
      versions: versions.map((v) => ({
        ...v,
        legal_review_status: reviews.find((r) => r.version === v.version)?.decision === 'REVIEWED' ? 'REVIEWED' : 'PENDING',
        sources: sources.filter((s) => s.version === v.version),
        rules: rules.filter((r) => r.version === v.version),
      })),
    };
  }

  /** Adoptar o retirar el perfil en la organización. Append-only: cada decisión es una fila fechada. */
  async adoptar(user: AuthUser, orgId: string, dto: AdoptarDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'risk:approve_rules', true);
    const v = await this.db.selectFrom('legal_profile_versions').select(['version', 'technical_status'])
      .where('version', '=', dto.version).executeTakeFirst();
    if (!v) throw new AppError(422, 'LEGAL_PROFILE_UNKNOWN', 'Esa versión de perfil jurídico no existe.', [{ field: 'version', reason: 'UNKNOWN' }]);
    if (v.technical_status !== 'PUBLISHED') {
      throw new AppError(422, 'LEGAL_PROFILE_NOT_PUBLISHED', 'Un perfil en borrador no se adopta.', [{ field: 'version', reason: 'NOT_PUBLISHED' }]);
    }
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('legal_profile_adoptions')
        .values({ id, organization_id: orgId, version: dto.version, decision: dto.decision, reason: dto.reason, decided_by: user.id, operation_id: dto.operation_id })
        .execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: `legal_profile.${dto.decision.toLowerCase()}`,
        entityType: 'legal_profile', entityId: id, requestId, result: 'SUCCESS', reason: dto.reason,
        after: { version: dto.version, decision: dto.decision },
      });
    });
    void ctx;
    return { id, version: dto.version, decision: dto.decision, note: 'Adoptar un perfil PARCIAL no lo vuelve suficiente: LEGAL_PROFILE sigue sin satisfacerse.' };
  }

  /**
   * Prepara la evaluación de una parcela con el perfil adoptado: un ítem por regla candidata, **todos en
   * aplicabilidad desconocida y resultado no evaluable**. Ese es el estado honesto de partida.
   */
  async preparar(user: AuthUser, orgId: string, dto: PrepararDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'dd:manage', true);
    // Alcance real sobre la parcela: reutiliza la autorización de Parcelas, no una regla paralela.
    await this.plots.load(this.db, ctx, dto.plot_id, 'read');
    const perfil = await perfilDeOrganizacion(this.db, orgId);
    if (!perfil) throw new AppError(422, 'LEGAL_PROFILE_NOT_ADOPTED', 'La organización no ha adoptado ningún perfil jurídico.', [{ reason: 'NOT_ADOPTED' }]);
    const reglas = await this.db.selectFrom('legal_profile_rules').select(['code']).where('version', '=', perfil.version).execute();

    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('legal_assessments').values({
        id, organization_id: orgId, subject_type: 'PLOT', subject_id: dto.plot_id,
        version: perfil.version, status: 'OPEN', created_by: user.id, operation_id: dto.operation_id,
      }).execute();
      for (const r of reglas) {
        await trx.insertInto('legal_assessment_items').values({
          id: randomUUID(), organization_id: orgId, assessment_id: id, version: perfil.version, rule_code: r.code,
          applicability: 'UNKNOWN', result: 'NOT_EVALUABLE', evidence_admissibility: 'NOT_JUSTIFIED', cartographic_indication: 'NOT_ASSESSED',
        }).execute();
      }
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'legal_assessment.prepare',
        entityType: 'legal_assessment', entityId: id, requestId, result: 'SUCCESS',
        after: { version: perfil.version, plot_id: dto.plot_id, items: reglas.length },
      });
    });
    return this.ver(user, orgId, id);
  }

  async ver(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, 'dd:read', false);
    const a = await this.db.selectFrom('legal_assessments').selectAll()
      .where('organization_id', '=', orgId).where('id', '=', id).executeTakeFirst();
    if (!a) throw notFound();
    await this.plots.load(this.db, ctx, a.subject_id, 'read');   // alcance por recurso, también al leer
    const items = await this.db.selectFrom('legal_assessment_items as i')
      .innerJoin('legal_profile_rules as r', (j) => j.onRef('r.version', '=', 'i.version').onRef('r.code', '=', 'i.rule_code'))
      .select(['i.id', 'i.rule_code', 'i.applicability', 'i.applicability_reason', 'i.evidence_version_id', 'i.evidence_origin',
        'i.evidence_admissibility', 'i.evidence_justification', 'i.result', 'i.reviewer_id', 'i.reviewed_at', 'i.reason',
        'i.cartographic_indication', 'i.cartographic_source', 'i.cartographic_note', 'i.row_version',
        'r.matter', 'r.article', 'r.subject', 'r.applicability_condition', 'r.evidence_required', 'r.product_can_check', 'r.review_status', 'r.gaps'])
      .where('i.organization_id', '=', orgId).where('i.assessment_id', '=', id)
      .orderBy('i.rule_code').execute();
    const perfil = await this.db.selectFrom('legal_profile_versions').selectAll().where('version', '=', a.version).executeTakeFirstOrThrow();
    const rev = await this.db.selectFrom('legal_profile_reviews').select(['decision']).where('version', '=', a.version)
      .orderBy('decided_at', 'desc').executeTakeFirst();
    const pendientes = items.filter((i) => i.result === 'PENDING').map((i) => i.rule_code);
    const noEvaluables = items.filter((i) => i.result === 'NOT_EVALUABLE').map((i) => i.rule_code);
    return {
      id: a.id, subject_type: a.subject_type, subject_id: a.subject_id, status: a.status,
      profile: {
        version: perfil.version, scope: perfil.scope, scope_note: perfil.scope_note,
        pending_matters: perfil.pending_matters,
        legal_review_status: rev?.decision === 'REVIEWED' ? 'REVIEWED' : 'PENDING',
      },
      items: items.map((i) => ({ ...i, row_version: String(i.row_version) })),
      summary: {
        pending: pendientes, not_evaluable: noEvaluables,
        satisfies_legal_profile: false,
        why: 'Un perfil PARCIAL o sin revisión jurídica no satisface LEGAL_PROFILE. '
          + 'Las obligaciones pendientes y las no evaluables siguen impidiendo acreditar READY: '
          + 'desconocido no es incumplimiento, pero tampoco requisito satisfecho.',
      },
    };
  }

  /**
   * Registra la revisión de un ítem. Concurrencia por `expected_version`, y **cada cambio deja historia**.
   * Las combinaciones incoherentes las rechaza la BASE, no esta función: aquí solo se traduce el error.
   */
  async revisar(user: AuthUser, orgId: string, assessmentId: string, itemId: string, dto: RevisarDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'risk:review', true);
    const a = await this.db.selectFrom('legal_assessments').selectAll()
      .where('organization_id', '=', orgId).where('id', '=', assessmentId).executeTakeFirst();
    if (!a) throw notFound();
    if (a.status === 'CLOSED') throw new AppError(409, 'LEGAL_ASSESSMENT_CLOSED', 'La evaluación está cerrada: abre una nueva.', [{ reason: 'CLOSED' }]);
    await this.plots.load(this.db, ctx, a.subject_id, 'read');

    const decide = (r: ItemResult, reviewer: boolean) => (r === 'SATISFIED' || r === 'NOT_SATISFIED') && reviewer;

    return this.db.transaction().execute(async (trx) => {
      const prev = await trx.selectFrom('legal_assessment_items').selectAll()
        .where('organization_id', '=', orgId).where('id', '=', itemId).where('assessment_id', '=', assessmentId)
        .forUpdate().executeTakeFirst();
      if (!prev) throw notFound();
      if (String(prev.row_version) !== dto.expected_version) {
        throw new AppError(409, 'VERSION_CONFLICT', 'Otra persona cambió este requisito mientras lo revisabas. Vuelve a cargarlo.', [{ field: 'expected_version', reason: 'STALE' }]);
      }
      // La evidencia tiene que ser una versión de documento de ESTA organización. La FK compuesta lo garantiza;
      // aquí se comprueba antes para devolver 422 y no un error de integridad.
      if (dto.evidence_version_id) {
        // La evidencia tiene que ser del SUJETO de la evaluación, no de cualquier recurso de la organización.
        // Un título de otra parcela es un documento válido y, aun así, **no acredita esta**. El titular puede
        // ser la propia parcela o su productor, que es donde cuelga la documentación de tenencia.
        const v = await trx.selectFrom('document_versions as dv')
          .innerJoin('documents as d', (j) => j.onRef('d.id', '=', 'dv.document_id').onRef('d.organization_id', '=', 'dv.organization_id'))
          .select(['dv.id', 'd.owner_type', 'd.owner_id'])
          .where('dv.organization_id', '=', orgId).where('dv.id', '=', dto.evidence_version_id).executeTakeFirst();
        if (!v) throw new AppError(422, 'EVIDENCE_VERSION_UNKNOWN', 'Esa versión de documento no existe en la organización.', [{ field: 'evidence_version_id', reason: 'UNKNOWN' }]);
        const parcela = await trx.selectFrom('plots').select(['id', 'producer_id'])
          .where('organization_id', '=', orgId).where('id', '=', a.subject_id).executeTakeFirstOrThrow();
        const propia = (v.owner_type === 'plot' && v.owner_id === parcela.id)
          || (v.owner_type === 'producer' && v.owner_id === parcela.producer_id);
        if (!propia) {
          throw new AppError(422, 'EVIDENCE_FOREIGN_SUBJECT',
            'Esa evidencia pertenece a otro sujeto: no acredita esta parcela. El documento debe ser de la parcela evaluada o de su productor.',
            [{ field: 'evidence_version_id', reason: 'FOREIGN_SUBJECT' }]);
        }
      }

      const siguiente = Number(prev.row_version) + 1;
      const esRevision = decide(dto.result, true);
      try {
        await trx.updateTable('legal_assessment_items').set({
          applicability: dto.applicability,
          applicability_reason: dto.applicability_reason ?? null,
          evidence_version_id: dto.evidence_version_id ?? null,
          evidence_origin: dto.evidence_origin ?? null,
          evidence_admissibility: dto.evidence_justification ? 'JUSTIFIED' : 'NOT_JUSTIFIED',
          evidence_justification: dto.evidence_justification ?? null,
          result: dto.result,
          reviewer_id: esRevision ? user.id : null,
          reviewed_at: esRevision ? new Date() : null,
          reason: dto.reason ?? null,
          cartographic_indication: dto.cartographic_indication ?? 'NOT_ASSESSED',
          cartographic_source: dto.cartographic_source ?? null,
          cartographic_note: dto.cartographic_note ?? null,
          row_version: sql`row_version + 1`,

        }).where('organization_id', '=', orgId).where('id', '=', itemId).execute();
      } catch (e) {
        // Un CHECK violado aquí NO es un error interno: es el contrato impidiendo una conclusión incoherente.
        const code = (e as { constraint?: string }).constraint ?? '';
        if (code.startsWith('legal_assessment_items_')) {
          throw new AppError(422, 'LEGAL_ITEM_INCOHERENT',
            'Esa combinación no es admisible: la aplicabilidad desconocida no puede estar satisfecha, una obligación aplicable sin evidencia queda pendiente, y declarar satisfecha exige evidencia admisible justificada, revisor y motivo.',
            [{ reason: code }]);
        }
        throw e;
      }

      await trx.insertInto('legal_assessment_item_history').values({
        id: randomUUID(), organization_id: orgId, item_id: itemId, row_version: String(siguiente),
        applicability: dto.applicability, evidence_version_id: dto.evidence_version_id ?? null,
        evidence_origin: dto.evidence_origin ?? null,
        evidence_admissibility: dto.evidence_justification ? 'JUSTIFIED' : 'NOT_JUSTIFIED',
        result: dto.result, reviewer_id: esRevision ? user.id : null, reason: dto.reason ?? null,
        cartographic_indication: dto.cartographic_indication ?? 'NOT_ASSESSED',
        changed_by: user.id, change_note: dto.change_note,
      }).execute();

      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'legal_assessment.review',
        entityType: 'legal_assessment_item', entityId: itemId, requestId, result: 'SUCCESS', reason: dto.change_note,
        before: { applicability: prev.applicability, result: prev.result },
        after: { applicability: dto.applicability, result: dto.result },
      });
      return { id: itemId, row_version: String(siguiente), result: dto.result, applicability: dto.applicability };
    });
  }

  /** Historial del ítem: append-only, conservado aunque el ítem cambie después. */
  async historial(user: AuthUser, orgId: string, assessmentId: string, itemId: string) {
    const ctx = await this.ctx(user, orgId, 'dd:read', false);
    const a = await this.db.selectFrom('legal_assessments').selectAll()
      .where('organization_id', '=', orgId).where('id', '=', assessmentId).executeTakeFirst();
    if (!a) throw notFound();
    await this.plots.load(this.db, ctx, a.subject_id, 'read');
    const rows = await this.db.selectFrom('legal_assessment_item_history').selectAll()
      .where('organization_id', '=', orgId).where('item_id', '=', itemId)
      .orderBy('row_version', 'desc').execute();
    return { item_id: itemId, history: rows.map((r) => ({ ...r, row_version: String(r.row_version) })) };
  }
}

@ApiTags('Perfil jurídico (P1-005)')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/legal-profile')
export class LegalProfileController {
  constructor(private readonly service: LegalProfileService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Catálogo de perfiles jurídicos (P1-005)', description: 'Versiones, fuentes y reglas CANDIDATAS. Una regla en DRAFT no es una regla aprobada.' })
  catalogo(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) {
    return this.service.catalogo(u, o);
  }

  @Post('adoptions')
  @ApiOperation({ summary: 'Adoptar o retirar un perfil', description: 'Requiere `risk:approve_rules`. Append-only. Adoptar un perfil parcial no lo vuelve suficiente.' })
  adoptar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: AdoptarDto, @Req() req: AuthedRequest) {
    return this.service.adoptar(u, o, dto, req.requestId);
  }
}

@ApiTags('Perfil jurídico (P1-005)')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/legal-assessments')
export class LegalAssessmentsController {
  constructor(private readonly service: LegalProfileService) {}

  @Post()
  @ApiOperation({ summary: 'Preparar la evaluación legal de una parcela', description: 'Requiere `dd:manage`. Crea un ítem por regla candidata, en aplicabilidad DESCONOCIDA y resultado NO EVALUABLE.' })
  preparar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: PrepararDto, @Req() req: AuthedRequest) {
    return this.service.preparar(u, o, dto, req.requestId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar una evaluación legal', description: 'Requiere `dd:read` y alcance sobre la parcela.' })
  ver(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.ver(u, o, id);
  }

  @Put(':id/items/:itemId')
  @ApiOperation({ summary: 'Revisar aplicabilidad, evidencia y resultado', description: 'Requiere `risk:review`. Concurrencia por `expected_version`; cada cambio deja historia.' })
  revisar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: RevisarDto, @Req() req: AuthedRequest) {
    return this.service.revisar(u, o, id, itemId, dto, req.requestId);
  }

  @Get(':id/items/:itemId/history')
  @ApiOperation({ summary: 'Historial de un requisito', description: 'Append-only: se conserva aunque el ítem cambie después.' })
  historial(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.service.historial(u, o, id, itemId);
  }
}
