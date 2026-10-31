import { Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, notFound } from '../common/errors';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser } from '../auth/auth';

// P1-011 — Histórico temporal de la parcela y alertas (RF-42; S3 §40 «GAP 14 — Histórico vivo de la parcela»).
//
// QUÉ PIDE LA FUENTE
// **S3 §40**: «una finca no debería ser una fotografía», sino una línea de tiempo —2020, 2021, 2022…— donde
// **cada año** muestre **evidencia + riesgo + cambios**, porque «el análisis de deforestación necesita comparar
// cambios temporales». **RF-42** (`docs/03:58`) añade: «**versiones comparables**; **datos no disponibles
// explícitos**». **P1-011** (`docs/18:212`): «comparar **geometría / datasets / períodos** con **limitaciones**;
// **no inferir datos inexistentes**».
//
// DE DÓNDE SALE EL HISTORIAL
// **De lo que ya está registrado**, no de una tabla nueva: versiones de geometría (`plot_versions`), análisis
// satelitales con su dataset y su cobertura (`satellite_jobs`/`satellite_results`), evidencias con su vigencia
// declarada (`evidence`) y evaluaciones de riesgo de los lotes que contienen la parcela. Nada se reconstruye:
// un año sin registros se dice **SIN_REGISTROS**, no se rellena con ceros ni se interpola.
//
// TRES FECHAS QUE NO SON LA MISMA
// Cuando existen, se publican por separado: **cuándo ocurrió el hecho** (`surveyed_at`, `analysis_date`,
// `valid_from`), **cuándo se registró** (`created_at`, `recorded_at`) y **cuándo se evaluó** (`evaluated_at`).
// Si una falta, se dice que falta; no se sustituye por otra.
//
// COMPARAR NO ES PUNTUAR
// Al comparar dos momentos se publican **versión de reglas, método, dataset y cobertura**. Si la cobertura bajó,
// si falta un análisis o si los datasets no son el mismo, la comparación se marca **NO COMPARABLE**: **menos
// hallazgos por menos datos no es una mejora**, y decirlo así sería mentir.
//
// ALERTAS CON CAUSA, SIN UMBRALES INVENTADOS
// Cada alerta nombra **el registro que la causa**. No hay umbrales de riesgo, ni caducidades, ni plazos legales
// inventados: una evidencia vence porque **su propio `valid_to` lo dice**, un análisis queda superado porque la
// geometría cambió, un resultado sintético no acredita porque **está marcado como sintético**. Las alertas son
// **derivadas y de solo lectura**: no se marcan, no se resuelven y **leerlas no cambia nada del dominio**.

type Alcance = 'ORGANIZACION' | 'ASIGNADOS' | 'RESTRINGIDO';

interface Entrada {
  kind: 'CAMBIO_DE_FICHA' | 'GEOMETRIA' | 'ANALISIS_SATELITAL' | 'EVIDENCIA' | 'RIESGO';
  id: string;
  label: string;
  /** Las tres fechas, por separado. `null` donde el dominio no la registra. */
  occurred_at: string | null;
  recorded_at: string | null;
  evaluated_at: string | null;
  dates_note: string;
  /** Versiones y cobertura, que son lo que hace comparables dos momentos. */
  versions: Record<string, string | number | null>;
  detail: string;
}
interface Periodo { year: number; status: 'CON_REGISTROS' | 'SIN_REGISTROS'; entries: Entrada[]; note: string }
interface Alerta {
  code: string; label: string; plot_id: string; plot_code: string;
  /** Qué deja de poder sustentarse con lo registrado. Nunca una consecuencia jurídica ni un plazo. */
  impact: string;
  cause: { kind: string; id: string; what: string };
  what_it_does_not_mean: string;
  action_href: string | null;
  action: string | null;
}

const SIN_FECHA = 'El dominio no registra esta fecha para este hecho; no se sustituye por otra.';

@Injectable()
export class HistoryService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>, private readonly authz: AuthorizationService) {}

  private tiene(ctx: TenantContext, p: string) { return ctx.permissions.includes(p as never); }

  /** Alcance de lectura de parcelas: toda la organización, solo las asignadas, o ninguna. */
  private alcance(ctx: TenantContext): Alcance {
    if (this.tiene(ctx, 'plot:read')) return 'ORGANIZACION';
    if (this.tiene(ctx, 'plot:read_assigned')) return 'ASIGNADOS';
    return 'RESTRINGIDO';
  }

  /** La parcela, solo si esta persona puede leerla. Fuera de alcance es 404, no 403: no se revela que existe. */
  private async parcela(ctx: TenantContext, plotId: string) {
    const a = this.alcance(ctx);
    if (a === 'RESTRINGIDO') throw notFound();
    const r = await sql<{ id: string; plot_code: string; producer_id: string; assigned: string | null; current_version_id: string | null }>`
      SELECT p.id, p.plot_code, p.producer_id, pr.assigned_membership_id AS assigned, p.current_version_id
      FROM plots p JOIN producers pr ON pr.id = p.producer_id AND pr.organization_id = p.organization_id
      WHERE p.id = ${plotId} AND p.organization_id = ${ctx.organizationId}`.execute(this.db);
    const p = r.rows[0];
    if (!p) throw notFound();
    if (a === 'ASIGNADOS' && p.assigned !== ctx.membershipId) throw notFound();
    return p;
  }

  async historial(user: AuthUser, orgId: string, plotId: string) {
    const ctx = await this.authz.require(user, orgId, 'organization:read', { mutation: false });
    const p = await this.parcela(ctx, plotId);
    const verGeometria = this.tiene(ctx, 'plot:read_geometry');
    const verSatelite = this.tiene(ctx, 'satellite:read');
    const verRiesgo = this.tiene(ctx, 'risk:read');
    const verEvidencia = this.tiene(ctx, 'evidence:read');

    const entradas: Entrada[] = [];
    const restringidas: Array<{ section: string; why: string }> = [];

    // ------------------------------------------------- qué cambió y por qué: registro de cambios YA existente
    // No se duplica: son las mismas filas que publica `GET /plots/:id/history` (PlotsService.history),
    // traídas aquí para que la evolución y el motivo del cambio se lean en un solo sitio.
    const cambios = (await sql<{ id: string; row_version: string; change_type: string; changed_fields: string[] | null; reason: string | null; changed_at: string; actor_email: string | null }>`
      SELECT h.id, h.row_version::text, h.change_type, h.changed_fields, h.reason, h.changed_at::text,
             u.email AS actor_email
      FROM plot_history h
      LEFT JOIN memberships m ON m.user_id = h.changed_by AND m.organization_id = h.organization_id
      LEFT JOIN users u ON u.id = m.user_id
      WHERE h.plot_id = ${plotId} AND h.organization_id = ${orgId}
      ORDER BY h.row_version`.execute(this.db)).rows;
    for (const c of cambios) {
      const campos = (c.changed_fields ?? []).join(', ');
      entradas.push({
        kind: 'CAMBIO_DE_FICHA', id: c.id, label: `Cambio ${Number(c.row_version)} de la ficha (${c.change_type})`,
        occurred_at: null, recorded_at: c.changed_at, evaluated_at: null,
        dates_note: `Solo hay fecha de registro: es cuándo se guardó el cambio, no cuándo ocurrió el hecho en campo. ${SIN_FECHA}`,
        versions: { row_version: Number(c.row_version), change_type: c.change_type, actor: c.actor_email ?? 'PLATAFORMA' },
        detail: `${campos ? `Cambió: ${campos}.` : 'Sin lista de campos registrada.'} ${c.reason ? `Motivo declarado: «${c.reason}».` : 'Sin motivo declarado: el registro no lo exige, y no se inventa uno.'}`,
      });
    }

    // ---------------------------------------------------------------- cambios de geometría
    const versiones = (await sql<{ id: string; version_number: number; geometry_type: string | null; geometry_hash: string | null; area_declared_ha: string | null; area_calculated_ha: string | null; survey_method: string | null; surveyed_at: string | null; created_at: string; validation_status: string | null; validation_rule_version: string | null; accuracy_m: string | null }>`
      SELECT id, version_number, geometry_type, geometry_hash, area_declared_ha::text, area_calculated_ha::text,
             survey_method, surveyed_at::text, created_at::text, validation_status, validation_rule_version, accuracy_m::text
      FROM plot_versions WHERE plot_id = ${plotId} AND organization_id = ${orgId}
      ORDER BY version_number`.execute(this.db)).rows;
    for (const v of versiones) {
      entradas.push({
        kind: 'GEOMETRIA', id: v.id, label: `Versión ${v.version_number} de la geometría`,
        occurred_at: v.surveyed_at, recorded_at: v.created_at, evaluated_at: null,
        dates_note: v.surveyed_at
          ? 'La fecha del hecho es la de levantamiento declarada; la de registro, cuándo se guardó.'
          : `Sin fecha de levantamiento declarada. ${SIN_FECHA}`,
        versions: {
          version: v.version_number,
          geometry_type: verGeometria ? v.geometry_type : null,
          geometry_hash: verGeometria ? v.geometry_hash : null,
          survey_method: v.survey_method,
          validation_status: v.validation_status,
          validation_rule_version: v.validation_rule_version,
          area_declared_ha: v.area_declared_ha,
          area_calculated_ha: verGeometria ? v.area_calculated_ha : null,
          accuracy_m: verGeometria ? v.accuracy_m : null,
        },
        detail: v.geometry_type
          ? `Geometría ${v.geometry_type}${verGeometria ? '' : ' (sin detalle: tu rol no lee geometrías)'}.`
          : 'Versión sin geometría: superficie declarada no es ubicación.',
      });
    }
    if (!verGeometria) restringidas.push({ section: 'GEOMETRIA_DETALLE', why: 'Tu rol no lee geometrías: se omiten huella, superficie calculada y precisión.' });

    // ---------------------------------------------------------------- análisis satelitales
    if (verSatelite) {
      const analisis = (await sql<{ id: string; plot_version_id: string | null; provider_code: string; operation: string; status: string; outcome: string | null; period_start: string | null; period_end: string | null; requested_at: string; finished_at: string | null; dataset: string | null; dataset_version: string | null; analysis_date: string | null; coverage_status: string | null; coverage_note: string | null; limitations: string | null; conclusion: string | null; is_synthetic: boolean | null; recorded_at: string | null; version_number: number | null }>`
        SELECT j.id, j.plot_version_id, j.provider_code, j.operation, j.status, j.outcome,
               j.period_start::text, j.period_end::text, j.requested_at::text, j.finished_at::text,
               r.dataset, r.dataset_version, r.analysis_date::text, r.coverage_status, r.coverage_note,
               r.limitations, r.conclusion, r.is_synthetic, r.recorded_at::text, v.version_number
        FROM satellite_jobs j
        LEFT JOIN satellite_results r ON r.job_id = j.id
        LEFT JOIN plot_versions v ON v.id = j.plot_version_id
        WHERE j.plot_id = ${plotId} AND j.organization_id = ${orgId}
        ORDER BY j.requested_at`.execute(this.db)).rows;
      for (const a of analisis) {
        entradas.push({
          kind: 'ANALISIS_SATELITAL', id: a.id,
          label: `Análisis ${a.operation} · ${a.provider_code}`,
          occurred_at: a.analysis_date ?? a.period_end,
          recorded_at: a.recorded_at ?? a.finished_at ?? a.requested_at,
          evaluated_at: null,
          dates_note: a.analysis_date
            ? 'La fecha del hecho es la del análisis declarada por el proveedor.'
            : `Sin fecha de análisis: se muestra el fin del período solicitado. ${SIN_FECHA}`,
          versions: {
            provider: a.provider_code, dataset: a.dataset, dataset_version: a.dataset_version,
            coverage_status: a.coverage_status, geometry_version: a.version_number,
            status: a.status, outcome: a.outcome, synthetic: a.is_synthetic ? 'SI' : 'NO',
            period: a.period_start && a.period_end ? `${a.period_start} – ${a.period_end}` : null,
          },
          detail: [a.coverage_note, a.limitations, a.conclusion ? `Conclusión registrada: ${a.conclusion}.` : null]
            .filter(Boolean).join(' ') || 'Sin resultado registrado.',
        });
      }
    } else {
      restringidas.push({ section: 'ANALISIS_SATELITAL', why: 'Tu rol no lee análisis satelitales: esta sección no se incluye, ni para decir que está vacía.' });
    }

    // ---------------------------------------------------------------- evidencias de la parcela
    if (verEvidencia) {
      const ev = (await sql<{ id: string; claim_type: string; status: string; valid_from: string | null; valid_to: string | null; created_at: string }>`
        SELECT id, claim_type, status, valid_from::text, valid_to::text, created_at::text
        FROM evidence WHERE organization_id = ${orgId} AND entity_type = 'plot' AND entity_id = ${plotId}
        ORDER BY created_at`.execute(this.db)).rows;
      for (const e of ev) {
        entradas.push({
          kind: 'EVIDENCIA', id: e.id, label: `Evidencia ${e.claim_type}`,
          occurred_at: e.valid_from, recorded_at: e.created_at, evaluated_at: null,
          dates_note: e.valid_from ? 'La vigencia la declara la propia evidencia.' : `Sin inicio de vigencia declarado. ${SIN_FECHA}`,
          versions: { claim_type: e.claim_type, status: e.status, valid_from: e.valid_from, valid_to: e.valid_to },
          detail: `Estado ${e.status}.${e.valid_to ? ` Vigencia declarada hasta ${e.valid_to}.` : ' Sin fin de vigencia declarado.'}`,
        });
      }
    } else {
      restringidas.push({ section: 'EVIDENCIA', why: 'Tu rol no lee evidencias: esta sección no se incluye.' });
    }

    // ---------------------------------------------------------------- riesgo de los lotes que la contienen
    if (verRiesgo) {
      const riesgo = (await sql<{ id: string; evaluation_number: number; rule_set_version: string; technical_result: string; conclusion: string; evaluated_at: string; lot_code: string; lot_id: string }>`
        SELECT DISTINCT re.id, re.evaluation_number, re.rule_set_version, re.technical_result, re.conclusion,
               re.evaluated_at::text, l.lot_code, l.id AS lot_id
        FROM delivery_origins o
        JOIN receptions rc ON rc.delivery_id = o.delivery_id
        JOIN lot_inputs li ON li.reception_id = rc.id
        JOIN lots l ON l.id = li.lot_id
        JOIN risk_evaluations re ON re.subject_id = l.id AND re.organization_id = l.organization_id
        WHERE o.plot_id = ${plotId} AND o.organization_id = ${orgId}
        ORDER BY re.evaluated_at::text`.execute(this.db)).rows;
      for (const r of riesgo) {
        entradas.push({
          kind: 'RIESGO', id: r.id, label: `Evaluación ${r.evaluation_number} del lote ${r.lot_code}`,
          occurred_at: null, recorded_at: r.evaluated_at, evaluated_at: r.evaluated_at,
          dates_note: 'Una evaluación no tiene «fecha del hecho»: se evalúa el estado en el momento de evaluar.',
          versions: { rule_set_version: r.rule_set_version, technical_result: r.technical_result, conclusion: r.conclusion, lot: r.lot_code },
          detail: `Resultado técnico «${r.technical_result}»; conclusión regulatoria «${r.conclusion}». El resultado técnico NO es la conclusión.`,
        });
      }
    } else {
      restringidas.push({ section: 'RIESGO', why: 'Tu rol no lee evaluaciones de riesgo: esta sección no se incluye.' });
    }

    // ---------------------------------------------------------------- línea de tiempo, sin inventar períodos
    const anio = (e: Entrada) => Number((e.occurred_at ?? e.recorded_at ?? '').slice(0, 4)) || null;
    const anios = entradas.map(anio).filter((a): a is number => a !== null);
    const periodos: Periodo[] = [];
    if (anios.length) {
      const desde = Math.min(...anios);
      const hasta = Math.max(new Date().getFullYear(), Math.max(...anios));
      for (let y = desde; y <= hasta; y += 1) {
        const dentro = entradas.filter((e) => anio(e) === y)
          .sort((a, b) => (a.occurred_at ?? a.recorded_at ?? '').localeCompare(b.occurred_at ?? b.recorded_at ?? ''));
        periodos.push({
          year: y,
          status: dentro.length ? 'CON_REGISTROS' : 'SIN_REGISTROS',
          entries: dentro,
          note: dentro.length
            ? `${dentro.length} registro(s).`
            : 'Sin registros en este año. No significa que no ocurriera nada: significa que no hay nada registrado aquí.',
        });
      }
    }

    const alertas = await this.alertasDeParcela(ctx, p, versiones, { verSatelite, verRiesgo, verEvidencia });

    return {
      plot: { id: p.id, code: p.plot_code, current_version_id: p.current_version_id },
      scope: this.alcance(ctx),
      periods: periodos,
      alerts: alertas,
      restricted_sections: restringidas,
      comparable: versiones.map((v) => ({ id: v.id, version_number: v.version_number, surveyed_at: v.surveyed_at, recorded_at: v.created_at })),
      note: periodos.length
        ? 'Línea de tiempo construida SOLO con lo registrado. Un año sin registros se declara como tal: no se rellena con ceros ni se interpola.'
        : 'Esta parcela no tiene ningún hecho registrado todavía. No se inventa una línea de tiempo vacía con años.',
      change_log_href: `/api/v1/organizations/${orgId}/plots/${plotId}/history`,
      reuse_note: 'No hay registros nuevos: la línea reúne el registro de cambios de la ficha, las versiones de geometría, los trabajos satelitales, la evidencia y las evaluaciones de riesgo que ya existían.',
      dates_note: 'Fecha del hecho, fecha de registro y fecha de evaluación son cosas distintas y se publican por separado; donde una falta, se dice.',
    };
  }

  /** Alertas DERIVADAS, cada una con el registro que la causa. Solo lectura: no se marcan ni se resuelven. */
  private async alertasDeParcela(
    ctx: TenantContext,
    p: { id: string; plot_code: string; current_version_id: string | null },
    versiones: Array<{ id: string; version_number: number; geometry_type: string | null }>,
    ve: { verSatelite: boolean; verRiesgo: boolean; verEvidencia: boolean },
  ): Promise<Alerta[]> {
    const orgId = ctx.organizationId;
    const base = `/organizaciones/${orgId}`;
    const alertas: Alerta[] = [];
    const vigente = versiones.find((v) => v.id === p.current_version_id) ?? null;

    if (ve.verSatelite) {
      const jobs = (await sql<{ id: string; plot_version_id: string | null; outcome: string | null; status: string; is_synthetic: boolean | null; coverage_status: string | null }>`
        SELECT j.id, j.plot_version_id, j.outcome, j.status, r.is_synthetic, r.coverage_status
        FROM satellite_jobs j LEFT JOIN satellite_results r ON r.job_id = j.id
        WHERE j.plot_id = ${p.id} AND j.organization_id = ${orgId}`.execute(this.db)).rows;

      for (const j of jobs) {
        if (p.current_version_id && j.plot_version_id && j.plot_version_id !== p.current_version_id) {
          alertas.push({
            code: 'ANALISIS_DE_GEOMETRIA_ANTERIOR', label: 'El análisis se hizo sobre una geometría que ya no es la vigente',
            plot_id: p.id, plot_code: p.plot_code,
            impact: 'El análisis disponible no describe la geometría vigente, así que no puede sustentar una afirmación sobre la parcela tal como está registrada hoy.',
            cause: { kind: 'satellite_job', id: j.id, what: 'La versión de geometría analizada no es la vigente de la parcela.' },
            what_it_does_not_mean: 'No significa que el resultado fuera incorrecto: significa que ya no corresponde a la geometría actual.',
            action_href: `${base}/parcelas/${p.id}`, action: 'Revisar la parcela y su análisis',
          });
        }
        if (j.is_synthetic) {
          alertas.push({
            code: 'RESULTADO_SINTETICO', label: 'El resultado procede de una fixture sintética',
            plot_id: p.id, plot_code: p.plot_code,
            impact: 'Este resultado no puede sustentar ninguna afirmación: ni a favor ni en contra de la parcela.',
            cause: { kind: 'satellite_job', id: j.id, what: 'El resultado está marcado como sintético en su propio registro.' },
            what_it_does_not_mean: 'No acredita nada: no procede de un proveedor real y no satisface ningún requisito.',
            action_href: `${base}/parcelas/${p.id}`, action: 'Ver la procedencia del resultado',
          });
        }
        if (j.outcome && j.outcome !== 'RESULT_AVAILABLE') {
          alertas.push({
            code: 'ANALISIS_SIN_RESULTADO', label: `El análisis terminó sin resultado (${j.outcome})`,
            plot_id: p.id, plot_code: p.plot_code,
            impact: 'La parcela se queda sin análisis utilizable para esta geometría, y el expediente lo arrastra como dato faltante.',
            cause: { kind: 'satellite_job', id: j.id, what: `Desenlace registrado: ${j.outcome}.` },
            what_it_does_not_mean: 'La ausencia de resultado NO es ausencia de hallazgos: no se concluye nada.',
            action_href: `${base}/parcelas/${p.id}`, action: 'Revisar el análisis',
          });
        }
      }
      if (vigente?.geometry_type && !jobs.some((j) => j.plot_version_id === p.current_version_id)) {
        alertas.push({
          code: 'GEOMETRIA_VIGENTE_SIN_ANALISIS', label: 'La geometría vigente no tiene ningún análisis',
          plot_id: p.id, plot_code: p.plot_code,
          impact: 'No hay con qué sustentar nada sobre la geometría vigente: el expediente lo verá como dato faltante, no como ausencia de hallazgos.',
          cause: { kind: 'plot_version', id: vigente.id, what: 'No hay ningún trabajo satelital asociado a la versión vigente.' },
          what_it_does_not_mean: 'No significa que haya un problema en la parcela: significa que no se ha analizado esta geometría.',
          action_href: `${base}/parcelas/${p.id}`, action: 'Solicitar análisis',
        });
      }
    }

    if (ve.verEvidencia) {
      const vencidas = (await sql<{ id: string; claim_type: string; valid_to: string }>`
        SELECT id, claim_type, valid_to::text FROM evidence
        WHERE organization_id = ${orgId} AND entity_type = 'plot' AND entity_id = ${p.id}
          AND valid_to IS NOT NULL AND valid_to < current_date AND status <> 'REVOKED'`.execute(this.db)).rows;
      for (const e of vencidas) {
        alertas.push({
          code: 'EVIDENCIA_FUERA_DE_VIGENCIA', label: `Evidencia ${e.claim_type} fuera de la vigencia que ella misma declara`,
          plot_id: p.id, plot_code: p.plot_code,
          impact: 'Fuera de la vigencia que ella misma declara, esta evidencia ya no sustenta su afirmación; quien la revise decide si sigue valiendo.',
          cause: { kind: 'evidence', id: e.id, what: `Su propio registro declara vigencia hasta ${e.valid_to}.` },
          what_it_does_not_mean: 'El plazo no lo fija Terra Link: lo declara la evidencia. Que haya vencido no decide nada por sí solo.',
          action_href: `${base}/evidencias`, action: 'Revisar la evidencia',
        });
      }
    }

    return alertas;
  }

  /** Comparación de dos versiones de geometría, con sus análisis y su veredicto de comparabilidad. */
  async comparar(user: AuthUser, orgId: string, plotId: string, fromId: string, toId: string) {
    const ctx = await this.authz.require(user, orgId, 'organization:read', { mutation: false });
    const p = await this.parcela(ctx, plotId);
    if (fromId === toId) throw new AppError(422, 'COMPARE_SAME_VERSION', 'Las dos versiones son la misma.', [{ field: 'to', reason: 'COMPARE_SAME_VERSION' }]);

    const filas = (await sql<{ id: string; version_number: number; geometry_type: string | null; geometry_hash: string | null; area_declared_ha: string | null; area_calculated_ha: string | null; survey_method: string | null; surveyed_at: string | null; created_at: string; validation_status: string | null; validation_rule_version: string | null }>`
      SELECT id, version_number, geometry_type, geometry_hash, area_declared_ha::text, area_calculated_ha::text,
             survey_method, surveyed_at::text, created_at::text, validation_status, validation_rule_version
      FROM plot_versions WHERE plot_id = ${plotId} AND organization_id = ${orgId} AND id IN (${fromId}, ${toId})`.execute(this.db)).rows;
    const a = filas.find((f) => f.id === fromId);
    const b = filas.find((f) => f.id === toId);
    if (!a || !b) throw notFound();

    const verSatelite = this.tiene(ctx, 'satellite:read');
    const analisisDe = async (versionId: string) => {
      if (!verSatelite) return null;
      const r = (await sql<{ dataset: string | null; dataset_version: string | null; coverage_status: string | null; analysis_date: string | null; outcome: string | null; is_synthetic: boolean | null; limitations: string | null }>`
        SELECT r.dataset, r.dataset_version, r.coverage_status, r.analysis_date::text, j.outcome, r.is_synthetic, r.limitations
        FROM satellite_jobs j LEFT JOIN satellite_results r ON r.job_id = j.id
        WHERE j.plot_version_id = ${versionId} AND j.organization_id = ${orgId}
        ORDER BY j.requested_at DESC LIMIT 1`.execute(this.db)).rows[0];
      return r ?? null;
    };
    const anA = await analisisDe(a.id);
    const anB = await analisisDe(b.id);

    // Veredicto de comparabilidad: se declara NO COMPARABLE antes que insinuar una mejora.
    const motivos: string[] = [];
    if (!verSatelite) motivos.push('Tu rol no lee análisis satelitales: la comparación de datasets y cobertura no se incluye.');
    else {
      if (!anA || !anB) motivos.push('Falta el análisis de al menos una de las dos versiones: sin análisis no hay nada que comparar.');
      else {
        if (anA.dataset !== anB.dataset || anA.dataset_version !== anB.dataset_version) {
          motivos.push(`Los datasets no son el mismo (${anA.dataset ?? 'sin dataset'} ${anA.dataset_version ?? ''} frente a ${anB.dataset ?? 'sin dataset'} ${anB.dataset_version ?? ''}): la diferencia puede deberse al dataset, no a la parcela.`);
        }
        const orden: Record<string, number> = { COVERED: 3, PARTIAL: 2, UNKNOWN: 1, NOT_COVERED: 0 };
        if (anA.coverage_status && anB.coverage_status && (orden[anB.coverage_status] ?? 0) < (orden[anA.coverage_status] ?? 0)) {
          motivos.push(`La cobertura BAJÓ de ${anA.coverage_status} a ${anB.coverage_status}: menos hallazgos con menos cobertura NO es una mejora.`);
        }
        if (anA.is_synthetic || anB.is_synthetic) motivos.push('Alguno de los resultados es sintético y no acredita nada.');
      }
    }
    if (a.validation_rule_version !== b.validation_rule_version) {
      motivos.push(`Las reglas de validación de geometría cambiaron (${a.validation_rule_version ?? 'sin versión'} → ${b.validation_rule_version ?? 'sin versión'}): el estado de validación no se compara directamente.`);
    }
    if (a.survey_method !== b.survey_method) {
      motivos.push(`El método de levantamiento cambió (${a.survey_method ?? 'sin método'} → ${b.survey_method ?? 'sin método'}): una diferencia de superficie puede venir del método.`);
    }

    const verGeometria = this.tiene(ctx, 'plot:read_geometry');
    const lado = (v: typeof a, an: typeof anA) => ({
      version_id: v.id, version_number: v.version_number,
      surveyed_at: v.surveyed_at, recorded_at: v.created_at,
      geometry_type: v.geometry_type, geometry_hash: verGeometria ? v.geometry_hash : null,
      area_declared_ha: v.area_declared_ha, area_calculated_ha: verGeometria ? v.area_calculated_ha : null,
      survey_method: v.survey_method, validation_status: v.validation_status, validation_rule_version: v.validation_rule_version,
      analysis: an ? { dataset: an.dataset, dataset_version: an.dataset_version, coverage_status: an.coverage_status, analysis_date: an.analysis_date, outcome: an.outcome, synthetic: an.is_synthetic === true, limitations: an.limitations } : null,
    });

    return {
      plot: { id: p.id, code: p.plot_code },
      from: lado(a, anA), to: lado(b, anB),
      changed: {
        geometry: a.geometry_hash !== b.geometry_hash,
        geometry_type: a.geometry_type !== b.geometry_type,
        area_declared: a.area_declared_ha !== b.area_declared_ha,
        survey_method: a.survey_method !== b.survey_method,
        validation_status: a.validation_status !== b.validation_status,
      },
      comparable: motivos.length === 0,
      limitations: motivos,
      note: motivos.length
        ? 'Comparación NO CONCLUYENTE: hay limitaciones declaradas arriba. Una diferencia no se interpreta como mejora ni como deterioro.'
        : 'Las dos versiones se comparan con el mismo dataset, la misma cobertura y las mismas reglas. Aun así, una diferencia de geometría NO es por sí sola una conclusión regulatoria.',
    };
  }

  /** Alertas de todas las parcelas que esta persona puede leer. Derivadas y de solo lectura. */
  async alertas(user: AuthUser, orgId: string) {
    const ctx = await this.authz.require(user, orgId, 'organization:read', { mutation: false });
    const a = this.alcance(ctx);
    if (a === 'RESTRINGIDO') {
      return { alerts: [], scope: a, note: 'Tu rol no lee parcelas: aquí no se afirma nada sobre ellas, ni siquiera que no haya alertas.' };
    }
    const parcelas = (await sql<{ id: string; plot_code: string; current_version_id: string | null }>`
      SELECT p.id, p.plot_code, p.current_version_id
      FROM plots p JOIN producers pr ON pr.id = p.producer_id AND pr.organization_id = p.organization_id
      WHERE p.organization_id = ${orgId} AND p.status = 'ACTIVE'
        AND (${a === 'ORGANIZACION'} OR pr.assigned_membership_id = ${ctx.membershipId})
      ORDER BY p.plot_code LIMIT 200`.execute(this.db)).rows;

    const ve = { verSatelite: this.tiene(ctx, 'satellite:read'), verRiesgo: this.tiene(ctx, 'risk:read'), verEvidencia: this.tiene(ctx, 'evidence:read') };
    const todas: Alerta[] = [];
    for (const p of parcelas) {
      const versiones = (await sql<{ id: string; version_number: number; geometry_type: string | null }>`
        SELECT id, version_number, geometry_type FROM plot_versions WHERE plot_id = ${p.id} AND organization_id = ${orgId}`.execute(this.db)).rows;
      todas.push(...await this.alertasDeParcela(ctx, p, versiones, ve));
    }
    return {
      alerts: todas, scope: a, plots_considered: parcelas.length,
      not_included: [
        ...(ve.verSatelite ? [] : [{ section: 'ANALISIS_SATELITAL', why: 'Tu rol no lee análisis satelitales.' }]),
        ...(ve.verEvidencia ? [] : [{ section: 'EVIDENCIA', why: 'Tu rol no lee evidencias.' }]),
      ],
      note: 'Alertas DERIVADAS del dato registrado, con la causa de cada una. Son de solo lectura: no se marcan, no se '
        + 'resuelven y leerlas no cambia nada. Ningún umbral de riesgo, caducidad ni plazo legal se inventa aquí.',
    };
  }
}

@ApiTags('history')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class HistoryController {
  constructor(private readonly service: HistoryService) {}

  @Get('plots/:plotId/timeline')
  @ApiOperation({ summary: 'Histórico temporal de la parcela: lo registrado por período, con los años sin registros declarados' })
  historial(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('plotId', ParseUUIDPipe) p: string) {
    return this.service.historial(u, o, p);
  }

  @Get('plots/:plotId/timeline/compare')
  @ApiOperation({ summary: 'Comparar dos versiones de geometría con sus datasets, cobertura y limitaciones' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  comparar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('plotId', ParseUUIDPipe) p: string,
    @Query('from') from: string, @Query('to') to: string) {
    if (!from || !to) throw new AppError(400, 'COMPARE_RANGE_REQUIRED', 'Indica las dos versiones a comparar.', [{ field: 'from', reason: 'COMPARE_RANGE_REQUIRED' }]);
    return this.service.comparar(u, o, p, from, to);
  }

  @Get('temporal-alerts')
  @ApiOperation({ summary: 'Alertas derivadas del histórico, con su causa y su acción (solo lectura)' })
  alertas(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.alertas(u, o); }
}
