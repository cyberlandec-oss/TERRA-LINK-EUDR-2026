import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { satelliteInputs } from '../satellite/inputs';
import { coberturaDeSujetos, perfilDeOrganizacion } from '../legal/legal-profile';
import { geoConfigContent } from '../geo/geo-config';
import { conclusionEfectiva } from '../risk/risk-conclusion';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID, Length } from 'class-validator';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { sql, type Kysely, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';
import { RiskService } from '../risk/risk';
import { geoEvaluationPanel } from './geo-panel';
import { buildPackage, evaluateRequirements, manifestOf, readinessOf, sectionHashes, sha256, summary, DISCLAIMER, type DdContent, type Requirement } from './requirements';

/** D-34.A.1: el vínculo concreto que una acreditación debe cubrir para despachar ese ítem. */
export interface DispatchLink { shipment_id: string; item_id: string; reservation_id: string; quantity: string }
export type PackageStatus = 'OK' | 'NO_CASE' | 'NOT_APPROVED' | 'NOT_READY' | 'STALE' | 'NO_PACKAGE' | 'LINK_MISMATCH';
export interface PackageForDispatch { status: PackageStatus; case_number: string | null; snapshot_number: number | null; export_id: string | null }

/** Compara cantidades decimales sin depender de cómo las serialice PostgreSQL ('90' y '90.000' son la misma). */
function sameQuantity(a: string, b: string): boolean {
  const norm = (x: string) => { const [i, d = ''] = String(x).trim().split('.'); return `${BigInt(i || '0')}.${d.replace(/0+$/, '')}`; };
  try { return norm(a) === norm(b); } catch { return false; }
}

// P0-022 Diligencia y paquete (RF-22, QA-12; docs/13 §Ciclo del expediente, §Paquete, §Presentación oficial; UX_UI).
// Expediente por lote → instantánea consistente (REPEATABLE READ) con manifest, hashes y guards por requisito →
// revisión autorizada (iniciar / devolver / aprobar; aprobar exige READY vigente) → exportación auditada desde la
// instantánea. Un cambio relevante deja la instantánea STALE sin modificarla. El catálogo de riesgo NO APROBADO, la
// conclusión UNDETERMINED y los requisitos que dependen de D-05, perfil jurídico, satélite o embarques bloquean READY:
// no se inventa perfil ni se rebajan requisitos. Descargar un paquete NUNCA es presentar una DDS.
// Alcance: como riesgo, el expediente recorre datos de toda la organización (exige lectura de organización completa).

type Db = Kysely<Database> | Transaction<Database>;

class CreateCaseDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @IsUUID() lot_id!: string;
  @ApiProperty({ description: 'Alcance del expediente (operación, destino o propósito declarado)' }) @IsString() @Length(3, 1000) scope_note!: string;
}
class OperationDto { @ApiProperty() @IsUUID() operation_id!: string }
class ReviewDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ enum: ['START_REVIEW', 'RETURN', 'APPROVE'] }) @IsIn(['START_REVIEW', 'RETURN', 'APPROVE']) action!: 'START_REVIEW' | 'RETURN' | 'APPROVE';
  @ApiProperty() @IsString() @Length(3, 1000) reason!: string;
}
class ExportDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ enum: ['INTERNAL_REVIEW', 'DD_PACKAGE'], description: 'INTERNAL_REVIEW: borrador interno de cualquier instantánea. DD_PACKAGE: exige instantánea aprobada y vigente.' })
  @IsIn(['INTERNAL_REVIEW', 'DD_PACKAGE']) kind!: 'INTERNAL_REVIEW' | 'DD_PACKAGE';
}

const READINESS_LABEL: Record<string, string> = { BLOCKED: 'Bloqueada', IN_PROGRESS: 'En preparación', READY: 'Preparada (interna)', STALE: 'Desactualizada' };
const name = (f: string | null, l: string | null) => `${f ?? ''} ${l ?? ''}`.trim() || 'Miembro';

@Injectable()
export class DdService {
  private readonly risk: RiskService;
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {
    this.risk = new RiskService(db, events, authz, audit);
  }

  private async ctx(user: AuthUser, orgId: string, perm: Permission, mutation: boolean) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!ctx.permissions.includes(perm)) throw forbidden();
    const need: Permission[] = ['delivery:read', 'lot:read', 'plot:read', 'producer:read', 'document:read', 'risk:read'];
    if (!need.every((p) => ctx.permissions.includes(p))) throw forbidden('PERMISSION_DENIED', 'El expediente usa datos de toda la organización: requiere alcance de organización completo.');
    if (mutation && ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    return ctx;
  }

  /** Contenido del expediente leído en la transacción dada (debe ser REPEATABLE READ para ser consistente). */
  async capture(db: Db, ctx: TenantContext, lotId: string): Promise<DdContent> {
    const orgId = ctx.organizationId;
    const lot = (await sql<{ id: string; lot_code: string; unit: string; origin_status: string; product: string }>`
      SELECT l.id, l.lot_code, l.unit, l.origin_status, p.name AS product FROM lots l JOIN products p ON p.id = l.product_id WHERE l.organization_id = ${orgId} AND l.id = ${lotId}`.execute(db)).rows[0];
    if (!lot) throw notFound();
    const origin = await this.risk.snapshot(db, orgId, lotId);
    const q = (await sql<{ physical: string; reserved: string; available: string }>`
      SELECT coalesce(sum(signed_quantity) FILTER (WHERE bucket = 'PHYSICAL'), 0)::text AS physical, coalesce(sum(signed_quantity) FILTER (WHERE bucket = 'RESERVED'), 0)::text AS reserved,
             (coalesce(sum(signed_quantity) FILTER (WHERE bucket = 'PHYSICAL'), 0) - coalesce(sum(signed_quantity) FILTER (WHERE bucket = 'RESERVED'), 0))::text AS available
      FROM stock_entries WHERE organization_id = ${orgId} AND lot_id = ${lotId}`.execute(db)).rows[0];
    const deliveriesBase = [...new Map(origin.receptions.map((r) => [r.delivery_id, { id: r.delivery_id, code: r.delivery_code, row_version: r.delivery_version }])).values()]
      .map((d) => ({ ...d, origin_plots: origin.origins.filter((o) => o.delivery_id === d.id).map((o) => o.plot_code) }));
    // Período de producción: la cosecha EFECTIVA que la entrega declaró —la de su última corrección si la hay; la entrega conserva la original— y su número de corrección, por entrega. Nunca la fecha de entrega, de recepción ni de un análisis.
    // Una entrega sin declaración no lleva la clave: queda «sin declarar» y no se funde en un intervalo general.
    const cosechas = deliveriesBase.length ? (await sql<{ id: string; harvest_precision: string | null; harvest_start: string | null; harvest_end: string | null; correction_number: number }>`
      SELECT d.id,
             CASE WHEN c.id IS NULL THEN d.harvest_precision ELSE c.harvest_precision END AS harvest_precision,
             CASE WHEN c.id IS NULL THEN d.harvest_start ELSE c.harvest_start END::text AS harvest_start,
             CASE WHEN c.id IS NULL THEN d.harvest_end ELSE c.harvest_end END::text AS harvest_end,
             coalesce(c.correction_number, 0)::int AS correction_number
      FROM deliveries d
      LEFT JOIN LATERAL (SELECT k.id, k.correction_number, k.harvest_precision, k.harvest_start, k.harvest_end FROM delivery_corrections k
                         WHERE k.delivery_id = d.id AND k.organization_id = d.organization_id ORDER BY k.correction_number DESC LIMIT 1) c ON true
      WHERE d.organization_id = ${orgId} AND d.id = ANY(${deliveriesBase.map((d) => d.id)}::uuid[])`.execute(db)).rows : [];
    const deliveries = deliveriesBase.map((d) => {
      const c = cosechas.find((x) => x.id === d.id);
      return c?.harvest_precision ? { ...d, harvest: { precision: c.harvest_precision, start: c.harvest_start, end: c.harvest_end, correction_number: c.correction_number } } : d;
    });
    const plotIds = [...new Set(origin.origins.map((o) => o.plot_id))];
    const plotsBase = plotIds.length ? (await sql<{ plot_id: string; plot_code: string; version_id: string | null; version_number: number | null; geometry_type: string | null; geometry_hash: string | null; validation_status: string | null; geometry: unknown }>`
      SELECT p.id AS plot_id, p.plot_code, v.id AS version_id, v.version_number, v.geometry_type, v.geometry_hash, v.validation_status, ST_AsGeoJSON(v.geometry)::jsonb AS geometry
      FROM plots p LEFT JOIN plot_versions v ON v.id = p.current_version_id WHERE p.organization_id = ${orgId} AND p.id = ANY(${plotIds}::uuid[]) ORDER BY p.plot_code`.execute(db)).rows
      .map((p) => ({ ...p, gis_status: origin.origins.find((o) => o.plot_id === p.plot_id)?.gis_status ?? null })) : [];
    // País de producción: la declaración VIGENTE de cada parcela de origen (versión y fecha). Sin declaración no hay clave; no se deduce de ninguna otra fuente.
    const paises = plotIds.length ? (await sql<{ plot_id: string; declaration_number: number; country: string | null; declared_at: string }>`
      SELECT DISTINCT ON (plot_id) plot_id, declaration_number, country, declared_at::text
      FROM plot_production_declarations WHERE organization_id = ${orgId} AND plot_id = ANY(${plotIds}::uuid[]) ORDER BY plot_id, declaration_number DESC`.execute(db)).rows : [];
    const plots = plotsBase.map((p) => {
      const d = paises.find((x) => x.plot_id === p.plot_id);
      return d ? { ...p, production_country: { declaration_number: d.declaration_number, country: d.country, declared_at: d.declared_at } } : p;
    });
    const quality = [];
    for (const r of [...new Map(origin.receptions.map((x) => [x.reception_id, x])).values()]) {
      const d = (await sql<{ decision: string }>`SELECT qr.decision FROM quality_samples s JOIN quality_results qr ON qr.sample_id = s.id WHERE s.reception_id = ${r.reception_id} ORDER BY qr.recorded_at DESC, qr.id DESC LIMIT 1`.execute(db)).rows[0];
      quality.push({ reception_id: r.reception_id, delivery_code: r.delivery_code, decision: d?.decision ?? 'NO_RESULT' });
    }
    const mitigations = (await sql<{ id: string; factor_code: string; status: string; row_version: string; decision: string | null }>`
      SELECT a.id, a.factor_code, a.status, a.row_version::text, (SELECT d.decision FROM mitigation_decisions d WHERE d.action_id = a.id ORDER BY d.submission_number DESC LIMIT 1) AS decision
      FROM mitigation_actions a WHERE a.organization_id = ${orgId} AND a.subject_id = ${lotId} ORDER BY a.created_at, a.id`.execute(db)).rows;
    const mitSupports = (await sql<{ document_version_id: string; action_id: string }>`
      SELECT s.document_version_id, s.action_id FROM mitigation_supports s JOIN mitigation_actions a ON a.id = s.action_id
      WHERE a.organization_id = ${orgId} AND a.subject_id = ${lotId} AND s.document_version_id IS NOT NULL`.execute(db)).rows;
    const refs = [
      ...origin.supports.map((s) => ({ version_id: s.document_version_id, used_by: 'DELIVERY_SUPPORT', reference: deliveries.find((d) => d.id === s.delivery_id)?.code ?? '' })),
      ...mitSupports.map((s) => ({ version_id: s.document_version_id, used_by: 'MITIGATION_SUPPORT', reference: mitigations.find((m) => m.id === s.action_id)?.factor_code ?? '' })),
    ];
    const versionIds = [...new Set(refs.map((r) => r.version_id))];
    const versions = versionIds.length ? (await sql<{ version_id: string; document_id: string; title: string; document_type: string; classification: string; version_number: number; sha256: string; file_name: string; expires_at: string | null; expired: boolean; scan: string | null }>`
      SELECT v.id AS version_id, d.id AS document_id, d.title, d.document_type, t.classification, v.version_number, v.sha256, v.file_name, v.expires_at::text,
             (v.expires_at IS NOT NULL AND v.expires_at < current_date) AS expired,
             (SELECT sc.result FROM document_version_scans sc WHERE sc.version_id = v.id ORDER BY sc.scanned_at DESC LIMIT 1) AS scan
      FROM document_versions v JOIN documents d ON d.id = v.document_id JOIN document_types t ON t.code = d.document_type
      WHERE v.organization_id = ${orgId} AND v.id = ANY(${versionIds}::uuid[])`.execute(db)).rows : [];
    const documents = refs.map((r) => ({ ...versions.find((v) => v.version_id === r.version_id)!, used_by: r.used_by, reference: r.reference }))
      .sort((a, b) => `${a.used_by}${a.reference}${a.version_id}`.localeCompare(`${b.used_by}${b.reference}${b.version_id}`));
    const producerIds = deliveries.length ? (await sql<{ producer_id: string }>`SELECT DISTINCT producer_id FROM deliveries WHERE organization_id = ${orgId} AND id = ANY(${deliveries.map((d) => d.id)}::uuid[])`.execute(db)).rows.map((r) => r.producer_id) : [];
    const entityIds = [...plotIds, ...producerIds];
    const evidence = entityIds.length ? (await sql<{ id: string; claim_type: string; entity_type: string; entity_id: string; status: string; row_version: string }>`
      SELECT id, claim_type, entity_type, entity_id, status, row_version::text FROM evidence WHERE organization_id = ${orgId} AND entity_id = ANY(${entityIds}::uuid[]) ORDER BY claim_type, id`.execute(db)).rows : [];
    const latest = (await sql<{ id: string }>`SELECT id FROM risk_evaluations WHERE organization_id = ${orgId} AND subject_id = ${lotId} ORDER BY evaluation_number DESC LIMIT 1`.execute(db)).rows[0];
    let risk: DdContent['risk'] = null;
    if (latest) {
      const v = await this.risk.view(db, ctx, latest.id);
      // D-07.6: la conclusión del expediente es la HUMANA vigente (nunca la del motor, que es UNDETERMINED). Si no hay una vigente, UNDETERMINED.
      const ef = await conclusionEfectiva(db as Kysely<Database>, ctx.organizationId, v as never);
      risk = { evaluation_id: v.id, evaluation_number: v.evaluation_number, snapshot_hash: v.snapshot.hash, rule_set_version: v.rules.version, rule_set_approval: v.rules.approval_status,
        rule_set_adopted: v.rules.adopted_by_organization, rule_set_regulatory_profile: v.rules.regulatory_profile,
        technical_result: v.technical_result.status, severity: v.risk_result.severity, conclusion: ef.effective, ...(ef.record ? { conclusion_record: { id: ef.record.id, result: ef.record.result, valid: ef.valid, invalid_reasons: ef.invalid_reasons } } : {}), is_current: v.freshness.status === 'CURRENT', review_process: v.review.process_status,
        factors: v.factors.map((f) => ({ code: f.code, result: f.result, effect: f.effect })) };
    }
    // P0-028: la procedencia del requisito DEFORESTATION_ANALYSIS sale del REGISTRO de proveedores, no de una
    // constante. Es MET solo si hay proveedor seleccionado (D-09) y cada versión de parcela de origen tiene un
    // resultado aplicable, con cobertura y NO sintético. Hoy no hay proveedor: queda null → NOT_EVALUABLE.
    const satelliteProfile = await (async (): Promise<string | null> => {
      const selected = await db.selectFrom('satellite_providers').select(['code']).where('selection_status', '=', 'SELECTED').executeTakeFirst();
      if (!selected) return null;
      const versionIds = plots.map((p) => p.version_id).filter((v): v is string => !!v);
      if (!versionIds.length || versionIds.length !== plots.length) return null;
      // El resultado aplicable es el MÁS RECIENTE del proveedor seleccionado, real (no sintético), por versión de parcela: el mismo que muestra la instantánea.
      // Un resultado anterior COVERED no sostiene el requisito si el vigente declara otra cobertura. Debe declarar COVERED.
      const covered = (await satelliteInputs(db as never, orgId, versionIds))
        .filter((a) => a.provider_code === selected.code && !a.is_synthetic && a.coverage_status === 'COVERED')
        .map((a) => a.plot_version_id);
      if (!versionIds.every((v) => covered.includes(v))) return null;
      return `Proveedor ${selected.code}: resultado con cobertura para todas las versiones de parcela de origen. Insumo con sus límites; no es conclusión regulatoria.`;
    })();
    // AJ-08 (H8): qué se RECIBIÓ del proveedor para cada versión de parcela de origen, separado de si basta para el criterio. La clave solo existe si hay proveedor
    // seleccionado o algún resultado: sin ellos el contenido y su hash quedan como antes.
    const selectedProvider = (await db.selectFrom('satellite_providers').select(['code']).where('selection_status', '=', 'SELECTED').executeTakeFirst())?.code ?? null;
    const satInputs = await satelliteInputs(db as never, orgId, plots.map((p) => p.version_id).filter((v): v is string => !!v));
    const satelliteAnalysis = selectedProvider || satInputs.length
      ? { selected_provider: selectedProvider, analyses: satInputs.map((x) => ({ ...x, plot_code: plots.find((p) => p.version_id === x.plot_version_id)?.plot_code ?? null })) }
      : null;
    // D-34.A.1: vínculo previo al despacho. Solo reservas ACTIVAS de la misma organización, con su embarque,
    // ítem, lote y cantidad. Entra en el contenido, así que cambiarlo desactualiza la instantánea.
    const shipmentLinks = (await sql<{ shipment_id: string; shipment_code: string; shipment_status: string; item_id: string; reservation_id: string; lot_id: string; quantity: string; unit: string; location_id: string }>`
      SELECT s.id AS shipment_id, s.shipment_code, s.status AS shipment_status, i.id AS item_id, r.id AS reservation_id,
             r.lot_id, r.quantity::text AS quantity, r.unit, r.location_id
      FROM shipment_reservations r
      JOIN shipment_items i ON i.id = r.item_id AND i.organization_id = r.organization_id
      JOIN shipments s ON s.id = r.shipment_id AND s.organization_id = r.organization_id
      WHERE r.organization_id = ${ctx.organizationId} AND r.lot_id = ${lotId} AND r.status = 'ACTIVE'
      ORDER BY s.shipment_code, i.id`.execute(db)).rows;
    const perfilAdoptado = await perfilDeOrganizacion(db as Kysely<Database>, ctx.organizationId);
    const legalProfile = perfilAdoptado
      ? { ...perfilAdoptado, subjects: await coberturaDeSujetos(db as Kysely<Database>, ctx.organizationId, [...new Set(plots.map((p) => p.plot_id))]) }
      : null;
    // GEOLOCATION_PROFILE: la configuración de reglas adoptada, su revisión vigente, su aplicabilidad y las evaluaciones vigentes del perfil técnico por
    // versión de parcela. null si la organización no adoptó ninguna (el contenido y su hash quedan como antes).
    const geolocationProfile = await geoConfigContent(db as Kysely<Database>, ctx.organizationId, plots.map((p) => ({ plot_id: p.plot_id, version_id: p.version_id ?? null })));
    return {
      subject: { type: 'LOT', id: lot.id, code: lot.lot_code, product: lot.product, unit: lot.unit, origin_status: lot.origin_status },
      quantities: { ...q, unit: lot.unit, source: 'ledger (stock_entries)' },
      origin: { lots: origin.lots.map((l) => ({ id: l.id, lot_code: l.lot_code, origin_status: l.origin_status })), ledger_differences: origin.ledger_differences },
      deliveries, plots, quality, documents, evidence, risk, mitigations,
      shipment_links: shipmentLinks,
      // P1-005: el perfil adoptado **y la cobertura del sujeto**. Las dos cosas, porque el catálogo por sí
      // solo no dice si ESTE lote tiene resueltas sus obligaciones. Hoy el perfil es parcial y sin revisión
      // jurídica, así que LEGAL_PROFILE queda PENDING y READY sigue bloqueado.
      profiles: { legal_profile: legalProfile, geolocation_profile: geolocationProfile, satellite_provider: satelliteProfile, ...(satelliteAnalysis ? { satellite_analysis: satelliteAnalysis } : {}) },
    };
  }

  /** Versión siguiente del agregado DD_CASE (llamar con el bloqueo del expediente tomado). */
  private async nextVersion(trx: Transaction<Database>, orgId: string, caseId: string) {
    return (await sql<{ n: number }>`SELECT coalesce(max(aggregate_version), 0)::int + 1 AS n FROM domain_events WHERE organization_id = ${orgId} AND aggregate_type = 'DD_CASE' AND aggregate_id = ${caseId}`.execute(trx)).rows[0].n;
  }

  private async nextNumber(trx: Transaction<Database>, orgId: string) {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`DD:${orgId}`}))`.execute(trx);
    const n = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM dd_cases WHERE organization_id = ${orgId}`.execute(trx)).rows[0].n + 1;
    return `DD-${new Date().toISOString().slice(0, 4)}-${String(n).padStart(5, '0')}`;
  }

  async create(user: AuthUser, orgId: string, dto: CreateCaseDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'dd:manage', true);
    const prior = await this.db.selectFrom('dd_cases').select(['id', 'subject_id']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.subject_id !== dto.lot_id) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, case: await this.view(ctx, prior.id) };
    }
    const lot = await this.db.selectFrom('lots').select(['id', 'lot_code']).where('organization_id', '=', orgId).where('id', '=', dto.lot_id).executeTakeFirst();
    if (!lot) throw new AppError(422, 'REFERENCE_NOT_FOUND', 'El lote no existe en esta organización.', [{ field: 'lot_id', reason: 'NOT_FOUND' }]);
    const existing = await this.db.selectFrom('dd_cases').select('id').where('organization_id', '=', orgId).where('subject_id', '=', dto.lot_id).executeTakeFirst();
    if (existing) throw new AppError(409, 'CASE_EXISTS', 'Este lote ya tiene un expediente: captura una nueva instantánea en él.', [{ field: 'lot_id', reason: existing.id }]);
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      const code = await this.nextNumber(trx, orgId);
      await trx.insertInto('dd_cases').values({ id, organization_id: orgId, case_number: code, subject_type: 'LOT', subject_id: dto.lot_id, scope_note: dto.scope_note.trim(), created_by: user.id, operation_id: dto.operation_id }).execute();
      await this.events.append(trx, { organizationId: orgId, eventType: 'DdCaseCreated', schemaVersion: 1, aggregateType: 'DD_CASE', aggregateId: id, aggregateVersion: 1, actorId: user.id, correlationId: requestId,
        payload: { case_id: id, case_number: code, subject_type: 'LOT', subject_id: dto.lot_id } });
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'dd.create_case', entityType: 'dd_case', entityId: id, requestId, result: 'SUCCESS', after: { code, reason: lot.lot_code } });
    });
    return { replayed: false, case: await this.view(ctx, id) };
  }

  async snapshot(user: AuthUser, orgId: string, caseId: string, dto: OperationDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'dd:manage', true);
    const prior = await this.db.selectFrom('dd_snapshots').select(['id', 'case_id']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.case_id !== caseId) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, snapshot: await this.snapshotView(ctx, prior.id) };
    }
    const id = randomUUID();
    await this.db.transaction().setIsolationLevel('repeatable read').execute(async (trx) => {
      const c = (await sql<{ id: string; subject_id: string; case_number: string }>`SELECT id, subject_id, case_number FROM dd_cases WHERE organization_id = ${orgId} AND id = ${caseId}`.execute(trx)).rows[0];
      if (!c) throw notFound();
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'dd:' + caseId}))`.execute(trx);
      const n = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM dd_snapshots WHERE case_id = ${caseId}`.execute(trx)).rows[0].n + 1;
      const content = await this.capture(trx, ctx, c.subject_id);
      const reqs = evaluateRequirements(content);
      const readiness = readinessOf(reqs);
      const hash = sha256(content);
      await trx.insertInto('dd_snapshots').values({ id, organization_id: orgId, case_id: caseId, snapshot_number: n, content: JSON.stringify(content), content_hash: hash, section_hashes: JSON.stringify(sectionHashes(content)),
        manifest: JSON.stringify(manifestOf(content)), requirements: JSON.stringify(reqs), readiness, captured_by: user.id, operation_id: dto.operation_id }).execute();
      await this.events.append(trx, { organizationId: orgId, eventType: 'DdSnapshotCaptured', schemaVersion: 1, aggregateType: 'DD_CASE', aggregateId: caseId, aggregateVersion: await this.nextVersion(trx, orgId, caseId), actorId: user.id, correlationId: requestId,
        payload: { case_id: caseId, snapshot_id: id, snapshot_number: n, content_hash: hash, readiness, requirements: reqs.map((r) => ({ code: r.code, status: r.status })) } });
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'dd.capture_snapshot', entityType: 'dd_case', entityId: caseId, requestId, result: 'SUCCESS', after: { code: c.case_number, reason: `instantánea ${n}: ${readiness}` } });
    });
    return { replayed: false, snapshot: await this.snapshotView(ctx, id) };
  }

  async review(user: AuthUser, orgId: string, snapshotId: string, dto: ReviewDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'dd:approve_package', true);
    const prior = await this.db.selectFrom('dd_reviews').select(['snapshot_id', 'action']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.snapshot_id !== snapshotId || prior.action !== dto.action) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, snapshot: await this.snapshotView(ctx, snapshotId) };
    }
    await this.db.transaction().execute(async (trx) => {
      const s = (await sql<{ id: string; case_id: string; snapshot_number: number; readiness: string; requirements: Requirement[] }>`
        SELECT id, case_id, snapshot_number, readiness, requirements FROM dd_snapshots WHERE organization_id = ${orgId} AND id = ${snapshotId}`.execute(trx)).rows[0];
      if (!s) throw notFound();
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'dd:' + s.case_id}))`.execute(trx);
      const latest = (await sql<{ id: string }>`SELECT id FROM dd_snapshots WHERE case_id = ${s.case_id} ORDER BY snapshot_number DESC LIMIT 1`.execute(trx)).rows[0];
      if (latest.id !== s.id) throw conflict('SNAPSHOT_SUPERSEDED', 'Hay una instantánea más reciente: revisa esa.');
      const done = (await sql<{ action: string }>`SELECT action FROM dd_reviews WHERE snapshot_id = ${snapshotId} ORDER BY reviewed_at`.execute(trx)).rows.map((r) => r.action);
      if (done.includes('APPROVE') || done.includes('RETURN')) throw conflict('INVALID_TRANSITION', 'La revisión de esta instantánea ya terminó; captura una nueva instantánea.');
      if (dto.action === 'START_REVIEW' && done.includes('START_REVIEW')) throw conflict('INVALID_TRANSITION', 'La revisión ya se inició.');
      if (dto.action !== 'START_REVIEW' && !done.includes('START_REVIEW')) throw conflict('INVALID_TRANSITION', 'Inicia la revisión antes de devolver o aprobar.');
      if (dto.action === 'APPROVE') {
        const blockers = s.requirements.filter((r) => r.status !== 'MET');
        if (s.readiness !== 'READY' || blockers.length) throw new AppError(409, 'READINESS_NOT_MET', 'No se puede aprobar: hay requisitos no cumplidos (un porcentaje alto no elimina bloqueos).', blockers.map((b) => ({ field: b.code, reason: b.status })));
        if (await this.isStale(trx, ctx, s.id)) throw conflict('SNAPSHOT_STALE', 'Cambiaron datos relevantes desde la instantánea: captura una nueva.');
      }
      try {
        await trx.insertInto('dd_reviews').values({ id: randomUUID(), organization_id: orgId, snapshot_id: snapshotId, action: dto.action, reason: dto.reason.trim(), reviewer_id: user.id, operation_id: dto.operation_id }).execute();
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw conflict('ALREADY_DECIDED', 'Otra persona ya registró esta decisión.');
        throw err;
      }
      await this.events.append(trx, { organizationId: orgId, eventType: 'DdReviewRecorded', schemaVersion: 1, aggregateType: 'DD_CASE', aggregateId: s.case_id, aggregateVersion: await this.nextVersion(trx, orgId, s.case_id), actorId: user.id, correlationId: requestId,
        payload: { snapshot_id: snapshotId, action: dto.action } });
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: `dd.${dto.action.toLowerCase()}`, entityType: 'dd_case', entityId: s.case_id, requestId, result: 'SUCCESS', after: { reason: dto.reason.trim() } });
    });
    return { replayed: false, snapshot: await this.snapshotView(ctx, snapshotId) };
  }

  private profile(ctx: TenantContext) {
    return { geometry: ctx.permissions.includes('plot:read_geometry'), personal_documents: ctx.permissions.includes('producer:read_identity') };
  }

  private async packageFor(ctx: TenantContext, snapshotId: string, kind: 'INTERNAL_REVIEW' | 'DD_PACKAGE', db: Db = this.db) {
    const s = (await sql<{ id: string; case_id: string; snapshot_number: number; content: DdContent; content_hash: string; manifest: unknown; requirements: Requirement[]; readiness: 'BLOCKED' | 'IN_PROGRESS' | 'READY'; captured_at: string; cf: string | null; cl: string | null; case_number: string; scope_note: string; org: string }>`
      SELECT s.id, s.case_id, s.snapshot_number, s.content, s.content_hash, s.manifest, s.requirements, s.readiness, s.captured_at::text, u.first_name AS cf, u.last_name AS cl, c.case_number, c.scope_note, o.name AS org
      FROM dd_snapshots s JOIN dd_cases c ON c.id = s.case_id JOIN organizations o ON o.id = s.organization_id LEFT JOIN users u ON u.id = s.captured_by
      WHERE s.organization_id = ${ctx.organizationId} AND s.id = ${snapshotId}`.execute(db)).rows[0];
    if (!s) throw notFound();
    const approval = (await sql<{ f: string | null; l: string | null }>`SELECT u.first_name AS f, u.last_name AS l FROM dd_reviews r LEFT JOIN users u ON u.id = r.reviewer_id WHERE r.snapshot_id = ${snapshotId} AND r.action = 'APPROVE'`.execute(db)).rows[0];
    return { s, approved: !!approval, built: buildPackage({ kind, dd_case: { id: s.case_id, case_number: s.case_number, scope_note: s.scope_note, organization: s.org },
      snapshot: { id: s.id, number: s.snapshot_number, captured_at: s.captured_at, captured_by: name(s.cf, s.cl), content_hash: s.content_hash, readiness: s.readiness, approved_by: approval ? name(approval.f, approval.l) : null },
      content: s.content, requirements: s.requirements, manifest: s.manifest }, this.profile(ctx)) };
  }

  async export(user: AuthUser, orgId: string, snapshotId: string, dto: ExportDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'dd:export_package', true);
    const prior = await this.db.selectFrom('dd_exports').select(['id', 'snapshot_id', 'kind']).where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (prior) {
      if (prior.snapshot_id !== snapshotId || prior.kind !== dto.kind) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, export: await this.exportView(ctx, prior.id) };
    }
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      const { s, approved, built } = await this.packageFor(ctx, snapshotId, dto.kind, trx);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'dd:' + s.case_id}))`.execute(trx);
      if (dto.kind === 'DD_PACKAGE') {
        const blockers = s.requirements.filter((r) => r.status !== 'MET');
        if (!approved || s.readiness !== 'READY' || blockers.length) {
          await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'dd.export_package', entityType: 'dd_case', entityId: s.case_id, requestId, result: 'DENIED', after: { reason: 'READINESS_NOT_MET' } });
          throw new AppError(409, 'READINESS_NOT_MET', 'El paquete de diligencia exige una instantánea aprobada con todos los requisitos cumplidos. Puedes exportar un borrador interno para revisión.', blockers.map((b) => ({ field: b.code, reason: b.status })));
        }
        if (await this.isStale(trx, ctx, s.id)) throw conflict('SNAPSHOT_STALE', 'Cambiaron datos relevantes desde la instantánea aprobada: la preparación quedó desactualizada.');
        // Un requisito obligatorio no se omite en silencio por privacidad: sin alcance suficiente, el paquete final se bloquea.
        if (built.redactions.length) {
          await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'dd.export_package', entityType: 'dd_case', entityId: s.case_id, requestId, result: 'DENIED', after: { reason: 'EXPORT_SCOPE_INSUFFICIENT' } });
          throw new AppError(403, 'EXPORT_SCOPE_INSUFFICIENT', 'El paquete final exige contenido que tu rol no puede ver (geometrías o documentos con datos personales): no se exporta incompleto.', built.redactions.map((r) => ({ field: r, reason: 'REDACTION_REQUIRED' })));
        }
      }
      await trx.insertInto('dd_exports').values({ id, organization_id: orgId, snapshot_id: snapshotId, kind: dto.kind, redaction_profile: JSON.stringify(this.profile(ctx)), package_hash: built.hash,
        size_bytes: Buffer.byteLength(built.body), exported_by: user.id, operation_id: dto.operation_id }).execute();
      await this.events.append(trx, { organizationId: orgId, eventType: 'DdPackageExported', schemaVersion: 1, aggregateType: 'DD_CASE', aggregateId: s.case_id, aggregateVersion: await this.nextVersion(trx, orgId, s.case_id), actorId: user.id, correlationId: requestId,
        payload: { export_id: id, snapshot_id: snapshotId, kind: dto.kind, package_hash: built.hash, redactions: built.redactions.length, submission: 'NOT_SUBMITTED' } });
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'dd.export_package', entityType: 'dd_case', entityId: s.case_id, requestId, result: 'SUCCESS',
        after: { code: s.case_number, reason: `${dto.kind}; instantánea ${s.snapshot_number}; ${built.redactions.length} redacción(es); no es DDS` } });
    });
    return { replayed: false, export: await this.exportView(ctx, id) };
  }

  /** Descarga: se regenera desde la instantánea inmutable y se comprueba el hash registrado. */
  async download(user: AuthUser, orgId: string, exportId: string, requestId?: string) {
    const ctx = await this.ctx(user, orgId, 'dd:export_package', false);
    const e = await this.db.selectFrom('dd_exports').selectAll().where('organization_id', '=', orgId).where('id', '=', exportId).executeTakeFirst();
    if (!e) throw notFound();
    const prof = e.redaction_profile as { geometry: boolean; personal_documents: boolean };
    const now = this.profile(ctx);
    if ((prof.geometry && !now.geometry) || (prof.personal_documents && !now.personal_documents)) throw forbidden('CONTENT_RESTRICTED', 'Este paquete incluye contenido que tu rol no permite ver.');
    const { s, built } = await this.packageFor({ ...ctx, permissions: [...ctx.permissions.filter((p) => p !== 'plot:read_geometry' && p !== 'producer:read_identity'), ...(prof.geometry ? ['plot:read_geometry' as Permission] : []), ...(prof.personal_documents ? ['producer:read_identity' as Permission] : [])] }, e.snapshot_id, e.kind);
    if (built.hash !== e.package_hash) throw new AppError(500, 'PACKAGE_INTEGRITY', 'El paquete regenerado no coincide con el hash registrado.');
    await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'dd.download_package', entityType: 'dd_case', entityId: s.case_id, requestId, result: 'SUCCESS', after: { reason: `${e.kind}; ${e.package_hash.slice(0, 12)}` } });
    return { filename: `${s.case_number}-instantanea-${s.snapshot_number}-${e.kind === 'DD_PACKAGE' ? 'paquete' : 'borrador-interno'}.json`, body: built.body };
  }

  /**
   * P0-029: estado del paquete de diligencia de un lote para el preflight de embarque. Exige expediente, instantánea
   * aprobada con readiness READY, vigente (sin cambios posteriores) y un DD_PACKAGE exportado de ella. Solo devuelve
   * códigos y números: el contenido del expediente sigue exigiendo dd:read.
   */
  async packageForDispatch(db: Db, ctx: TenantContext, lotId: string, link?: DispatchLink): Promise<PackageForDispatch> {
    const c = (await sql<{ id: string; case_number: string }>`SELECT id, case_number FROM dd_cases WHERE organization_id = ${ctx.organizationId} AND subject_id = ${lotId}`.execute(db)).rows[0];
    if (!c) return { status: 'NO_CASE', case_number: null, snapshot_number: null, export_id: null };
    const s = (await sql<{ id: string; snapshot_number: number; readiness: string; content: DdContent }>`
      SELECT s.id, s.snapshot_number, s.readiness, s.content FROM dd_snapshots s JOIN dd_reviews r ON r.snapshot_id = s.id AND r.action = 'APPROVE'
      WHERE s.organization_id = ${ctx.organizationId} AND s.case_id = ${c.id} ORDER BY s.snapshot_number DESC LIMIT 1`.execute(db)).rows[0];
    const base = { case_number: c.case_number, snapshot_number: s?.snapshot_number ?? null, export_id: null };
    if (!s) return { status: 'NOT_APPROVED', ...base };
    if (s.readiness !== 'READY') return { status: 'NOT_READY', ...base };
    if (await this.isStale(db, ctx, s.id)) return { status: 'STALE', ...base };
    // D-34.A.1: la acreditación debe cubrir ESTE vínculo. Que el lote tenga alguna reserva no basta: la
    // instantánea aprobada tiene que contener el embarque, el ítem, la reserva y la cantidad que se despachan.
    // Un paquete del lote correcto pero de otro contexto de embarque NO acredita este despacho.
    if (link && !(s.content.shipment_links ?? []).some((l) => l.shipment_id === link.shipment_id && l.item_id === link.item_id
      && l.reservation_id === link.reservation_id && l.lot_id === lotId && sameQuantity(l.quantity, link.quantity))) {
      return { status: 'LINK_MISMATCH', ...base };
    }
    const e = (await sql<{ id: string }>`SELECT id FROM dd_exports WHERE organization_id = ${ctx.organizationId} AND snapshot_id = ${s.id} AND kind = 'DD_PACKAGE' ORDER BY exported_at DESC LIMIT 1`.execute(db)).rows[0];
    if (!e) return { status: 'NO_PACKAGE', ...base };
    return { status: 'OK', ...base, export_id: e.id };
  }

  private async isStale(db: Db, ctx: TenantContext, snapshotId: string) {
    return (await this.freshness(db, ctx, snapshotId)).status === 'STALE';
  }

  private async freshness(db: Db, ctx: TenantContext, snapshotId: string) {
    const s = (await sql<{ case_id: string; subject_id: string; content_hash: string; section_hashes: Record<string, string> }>`
      SELECT s.case_id, c.subject_id, s.content_hash, s.section_hashes FROM dd_snapshots s JOIN dd_cases c ON c.id = s.case_id WHERE s.organization_id = ${ctx.organizationId} AND s.id = ${snapshotId}`.execute(db)).rows[0];
    const current = await this.capture(db, ctx, s.subject_id);
    if (sha256(current) === s.content_hash) return { status: 'CURRENT' as const, changed: [] as string[] };
    const now = sectionHashes(current);
    return { status: 'STALE' as const, changed: Object.keys(now).filter((k) => now[k] !== s.section_hashes[k]) };
  }

  private redact(ctx: TenantContext, content: DdContent): DdContent {
    const p = this.profile(ctx);
    return { ...content,
      plots: content.plots.map((pl) => (p.geometry ? pl : { ...pl, geometry: null })),
      documents: content.documents.map((d) => (p.personal_documents || d.classification !== 'PERSONAL_DATA' ? d : { ...d, title: '[restringido: datos personales]', file_name: '[restringido]' })) };
  }

  async snapshotView(ctx: TenantContext, id: string) {
    const s = (await sql<{ id: string; case_id: string; snapshot_number: number; content: DdContent; content_hash: string; manifest: unknown; requirements: Requirement[]; readiness: string; captured_at: string; f: string | null; l: string | null }>`
      SELECT s.id, s.case_id, s.snapshot_number, s.content, s.content_hash, s.manifest, s.requirements, s.readiness, s.captured_at, u.first_name AS f, u.last_name AS l
      FROM dd_snapshots s LEFT JOIN users u ON u.id = s.captured_by WHERE s.organization_id = ${ctx.organizationId} AND s.id = ${id}`.execute(this.db)).rows[0];
    if (!s) throw notFound();
    const fresh = await this.freshness(this.db, ctx, id);
    const reviews = (await sql<{ action: string; reason: string; reviewed_at: string; f: string | null; l: string | null }>`
      SELECT r.action, r.reason, r.reviewed_at, u.first_name AS f, u.last_name AS l FROM dd_reviews r LEFT JOIN users u ON u.id = r.reviewer_id WHERE r.snapshot_id = ${id} ORDER BY r.reviewed_at`.execute(this.db)).rows;
    const exports = (await sql<{ id: string }>`SELECT id FROM dd_exports WHERE snapshot_id = ${id} ORDER BY exported_at DESC`.execute(this.db)).rows;
    const latest = (await sql<{ id: string }>`SELECT id FROM dd_snapshots WHERE case_id = ${s.case_id} ORDER BY snapshot_number DESC LIMIT 1`.execute(this.db)).rows[0];
    const process = reviews.some((r) => r.action === 'APPROVE') ? 'APPROVED' : reviews.some((r) => r.action === 'RETURN') ? 'RETURNED' : reviews.length ? 'UNDER_REVIEW' : 'OPEN';
    const effective = fresh.status === 'STALE' ? 'STALE' : s.readiness;
    const can = (p: Permission) => ctx.permissions.includes(p);
    const open = latest.id === s.id && (process === 'OPEN' || process === 'UNDER_REVIEW');
    const exportList = [];
    for (const e of exports) exportList.push(await this.exportView(ctx, e.id));
    return {
      id: s.id, case_id: s.case_id, snapshot_number: s.snapshot_number, is_latest: latest.id === s.id, captured_at: s.captured_at, captured_by: name(s.f, s.l),
      content_hash: s.content_hash, manifest: s.manifest, content: this.redact(ctx, s.content),
      redacted: { geometry: !this.profile(ctx).geometry, personal_documents: !this.profile(ctx).personal_documents },
      requirements: s.requirements, summary: summary(s.requirements),
      readiness: { captured: s.readiness, effective, label: READINESS_LABEL[effective], changed_sections: fresh.changed,
        note: fresh.status === 'STALE' ? 'Cambiaron datos relevantes desde esta instantánea: la preparación dependiente quedó desactualizada (la instantánea no se modifica).' : 'READY indica preparación interna; ninguna instantánea significa DDS presentada.' },
      review: { process_status: process, history: reviews.map((r) => ({ action: r.action, reason: r.reason, at: r.reviewed_at, reviewer: name(r.f, r.l) })) },
      submission: { status: 'NOT_SUBMITTED', note: 'Presentación oficial (DDS/TRACES): dimensión independiente, no implementada. Descargar no es presentar.' },
      exports: exportList,
      actions: {
        start_review: can('dd:approve_package') && open && process === 'OPEN',
        return: can('dd:approve_package') && open && process === 'UNDER_REVIEW',
        approve: can('dd:approve_package') && open && process === 'UNDER_REVIEW',
        approve_blocked_reason: effective === 'READY' ? null : 'Aprobar exige todos los requisitos cumplidos y una instantánea vigente.',
        export_internal: can('dd:export_package'),
        export_package: can('dd:export_package') && process === 'APPROVED' && effective === 'READY',
        export_package_blocked_reason: process === 'APPROVED' && effective === 'READY' ? null : 'El paquete de diligencia exige una instantánea aprobada con todos los requisitos cumplidos.',
      },
    };
  }

  private async exportView(ctx: TenantContext, id: string) {
    const e = (await sql<{ id: string; snapshot_id: string; kind: string; package_hash: string; size_bytes: number; exported_at: string; redaction_profile: unknown; f: string | null; l: string | null }>`
      SELECT e.id, e.snapshot_id, e.kind, e.package_hash, e.size_bytes, e.exported_at, e.redaction_profile, u.first_name AS f, u.last_name AS l FROM dd_exports e LEFT JOIN users u ON u.id = e.exported_by
      WHERE e.organization_id = ${ctx.organizationId} AND e.id = ${id}`.execute(this.db)).rows[0];
    if (!e) throw notFound();
    return { ...e, exported_by: name(e.f, e.l), label: e.kind === 'DD_PACKAGE' ? 'Paquete de diligencia (interno)' : 'Borrador interno para revisión', submission: 'NOT_SUBMITTED', disclaimer: DISCLAIMER };
  }

  private async view(ctx: TenantContext, id: string) {
    const c = (await sql<{ id: string; case_number: string; subject_id: string; lot_code: string; scope_note: string; created_at: string; f: string | null; l: string | null }>`
      SELECT c.id, c.case_number, c.subject_id, l.lot_code, c.scope_note, c.created_at, u.first_name AS f, u.last_name AS l
      FROM dd_cases c JOIN lots l ON l.id = c.subject_id LEFT JOIN users u ON u.id = c.created_by WHERE c.organization_id = ${ctx.organizationId} AND c.id = ${id}`.execute(this.db)).rows[0];
    if (!c) throw notFound();
    const snaps = (await sql<{ id: string; snapshot_number: number; readiness: string; captured_at: string; content_hash: string }>`
      SELECT id, snapshot_number, readiness, captured_at, content_hash FROM dd_snapshots WHERE case_id = ${id} ORDER BY snapshot_number DESC`.execute(this.db)).rows;
    const latest = snaps[0] ? await this.snapshotView(ctx, snaps[0].id) : null;
    return { id: c.id, case_number: c.case_number, subject: { type: 'LOT', id: c.subject_id, code: c.lot_code }, scope_note: c.scope_note, created_at: c.created_at, created_by: name(c.f, c.l),
      latest, history: snaps.map((s) => ({ ...s, readiness_label: READINESS_LABEL[s.readiness] })),
      actions: { snapshot: ctx.permissions.includes('dd:manage') && ctx.organizationStatus === 'ACTIVE' } };
  }

  async detail(user: AuthUser, orgId: string, id: string) { return this.view(await this.ctx(user, orgId, 'dd:read', false), id); }
  async snapshotDetail(user: AuthUser, orgId: string, id: string) { return this.snapshotView(await this.ctx(user, orgId, 'dd:read', false), id); }

  /**
   * «Evaluación geográfica técnica actual»: consulta de SOLO LECTURA de las evaluaciones del perfil EUDR_GEO_V1 de las parcelas de origen del lote del expediente.
   * No es contenido de la instantánea ni entra en su hash (no cambia su frescura) y no cumple GEOLOCATION_PROFILE. Mismo permiso y alcance que el expediente.
   */
  async geoEvaluation(user: AuthUser, orgId: string, caseId: string) {
    const ctx = await this.ctx(user, orgId, 'dd:read', false);
    const c = (await sql<{ id: string; case_number: string; subject_id: string }>`SELECT id, case_number, subject_id FROM dd_cases WHERE organization_id = ${orgId} AND id = ${caseId}`.execute(this.db)).rows[0];
    if (!c) throw notFound();
    const origin = await this.risk.snapshot(this.db, orgId, c.subject_id);
    const plotIds = [...new Set(origin.origins.map((o) => o.plot_id))];
    return geoEvaluationPanel(this.db, ctx, c, plotIds);
  }

  async list(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, 'dd:read', false);
    const rows = (await sql<{ id: string; case_number: string; lot_id: string; lot_code: string; snapshot_id: string | null; snapshot_number: number | null; readiness: string | null }>`
      SELECT c.id, c.case_number, c.subject_id AS lot_id, l.lot_code, s.id AS snapshot_id, s.snapshot_number, s.readiness
      FROM dd_cases c JOIN lots l ON l.id = c.subject_id
      LEFT JOIN LATERAL (SELECT id, snapshot_number, readiness FROM dd_snapshots x WHERE x.case_id = c.id ORDER BY snapshot_number DESC LIMIT 1) s ON TRUE
      WHERE c.organization_id = ${orgId} ORDER BY c.case_number`.execute(this.db)).rows;
    const out = [];
    for (const r of rows) {
      const eff = r.snapshot_id ? ((await this.freshness(this.db, ctx, r.snapshot_id)).status === 'STALE' ? 'STALE' : r.readiness!) : null;
      out.push({ ...r, readiness_effective: eff, readiness_label: eff ? READINESS_LABEL[eff] : 'Sin instantánea' });
    }
    const lots = (await sql<{ id: string; lot_code: string }>`SELECT l.id, l.lot_code FROM lots l WHERE l.organization_id = ${orgId} AND NOT EXISTS (SELECT 1 FROM dd_cases c WHERE c.subject_id = l.id) ORDER BY l.lot_code`.execute(this.db)).rows;
    return { cases: out, lots_without_case: ctx.permissions.includes('dd:manage') ? lots : [], can_create: ctx.permissions.includes('dd:manage') };
  }
}

@ApiTags('due-diligence')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class DdController {
  constructor(private readonly service: DdService) {}

  @Get('dd-cases') list(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.list(u, o); }
  @Post('dd-cases') create(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: CreateCaseDto, @Req() req: AuthedRequest) { return this.service.create(u, o, dto, req.requestId); }
  @Get('dd-cases/:id') detail(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(u, o, id); }
  @Post('dd-cases/:id/snapshots') snapshot(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OperationDto, @Req() req: AuthedRequest) { return this.service.snapshot(u, o, id, dto, req.requestId); }
  @Get('dd-cases/:id/geo-evaluation') geoEvaluation(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.geoEvaluation(u, o, id); }
  @Get('dd-snapshots/:id') snapshotDetail(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.snapshotDetail(u, o, id); }
  @Post('dd-snapshots/:id/reviews') review(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @Req() req: AuthedRequest) { return this.service.review(u, o, id, dto, req.requestId); }
  @Post('dd-snapshots/:id/exports') export(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExportDto, @Req() req: AuthedRequest) { return this.service.export(u, o, id, dto, req.requestId); }
  @Get('dd-exports/:id/download') async download(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const { filename, body } = await this.service.download(u, o, id, req.requestId);
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('cache-control', 'no-store');
    res.send(body);
  }
}
