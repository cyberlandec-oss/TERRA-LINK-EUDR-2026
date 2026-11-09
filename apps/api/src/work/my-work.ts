import { BadRequestException, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { notFound } from '../common/errors';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser } from '../auth/auth';

// P0-027 + **P1-003** — Mi trabajo (RF-34; docs/14 §My Work; UX_UI §11; QA-11/QA-14).
//
// LO QUE ES
// Tareas OBSERVABLES derivadas del dominio real, no un motor de tareas. Cada tipo aparece solo si el rol puede
// COMPLETARLA (permiso de la acción) y solo alcanza los registros dentro de su alcance. Una fila desaparece
// cuando **el caso de uso del dominio** la resuelve. **No hay casilla local**: aquí no se marca nada por hecho.
//
// LO QUE AÑADE P1-003
//   · **Fila completa**: tipo, entidad, problema, impacto, responsable, plazo, prioridad, estado y acción.
//   · **Dos colas separadas**: `MINE` (mi responsabilidad) y `SUPERVISION` (trabajo del equipo). La segunda solo
//     se llena si el permiso del rol alcanza más allá de lo asignado: la separación la decide la autorización.
//   · **Filtros reales** `queue`, `assignee` y `status`, aplicados **en SQL** sobre el conjunto ya autorizado.
//     Filtrar no amplía el alcance: lo que el rol no puede ver no aparece ni filtrado ni sin filtrar.
//   · **Prioridad de regla explicable**: cada fila dice POR QUÉ tiene su prioridad. Sin puntuaciones ocultas.
//
// LO QUE NO INVENTA
// El plazo existe solo donde el dominio lo registra (mitigaciones, `due_date`). En lo demás es `null` y se dice
// que el dominio no lo registra: un plazo inventado sería un dato falso con apariencia de compromiso.

type Cola = 'MINE' | 'SUPERVISION';
type Prioridad = 'ALTA' | 'MEDIA' | 'BAJA';
type EstadoPlazo = 'OVERDUE' | 'DUE_SOON' | 'SCHEDULED' | 'NONE';

interface Fila {
  code: string; title: string; queue: Cola;
  entity: { type: string; id: string; code: string; href: string };
  reason: string; impact: string;
  assignee: { membership_id: string; name: string } | null;
  assignee_note: string;
  due_date: string | null; due_state: EstadoPlazo;
  priority: Prioridad; priority_rule: string;
  status: string;
  evidence_required: string | null;
  action: string; action_href: string;
}
interface Task { code: string; title: string; reason: string; action: string; count: number; items: Array<{ id: string; label: string; href: string }>; list_href: string }

/** Tope por tipo de tarea. Lo que se recorta se declara en `truncated`; el recuento sigue siendo el real. */
const LIMIT = 50;
const EJEMPLOS = 5;

/** Prioridad base por tipo, con su motivo escrito. El plazo vencido o próximo manda sobre ella. */
const BASE: Record<string, { p: Prioridad; regla: string }> = {
  DELIVERY_DRAFTS: { p: 'BAJA', regla: 'Un borrador no afecta inventario ni trazabilidad mientras no se registre.' },
  DELIVERIES_TO_RECEIVE: { p: 'MEDIA', regla: 'La entrega registrada no entra al inventario hasta que se recibe físicamente.' },
  QUALITY_PENDING: { p: 'MEDIA', regla: 'Un resultado registrado no libera ni rechaza nada hasta que se decide.' },
  DUPLICATE_REVIEWS: { p: 'BAJA', regla: 'Revisión de identidad: no se fusiona nada automáticamente, así que nada queda bloqueado.' },
  PLOTS_WITHOUT_LOCATION: { p: 'MEDIA', regla: 'Sin punto ni polígono, la parcela no puede evaluarse geográficamente.' },
  MITIGATIONS_ASSIGNED: { p: 'MEDIA', regla: 'La reevaluación del riesgo espera por esta acción.' },
  MITIGATIONS_TO_VERIFY: { p: 'MEDIA', regla: 'Hay trabajo enviado esperando verificación de otra persona.' },
};

const SIN_PLAZO = 'El dominio no registra plazo para esta tarea; no se inventa uno.';

/** Plazo → estado y prioridad, con el motivo literal que se muestra. Exportada para poder probarla sola. */
export function porPlazo(code: string, due: string | null, hoy: string): { due_state: EstadoPlazo; priority: Prioridad; priority_rule: string } {
  const base = BASE[code];
  if (!due) return { due_state: 'NONE', priority: base.p, priority_rule: `${base.regla} ${SIN_PLAZO}` };
  const dias = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
  if (dias < 0) return { due_state: 'OVERDUE', priority: 'ALTA', priority_rule: `Plazo vencido el ${due} (hace ${-dias} día(s)). El plazo vencido manda sobre la prioridad del tipo de tarea.` };
  if (dias <= 7) return { due_state: 'DUE_SOON', priority: 'MEDIA', priority_rule: `Vence el ${due}, dentro de ${dias} día(s).` };
  return { due_state: 'SCHEDULED', priority: base.p, priority_rule: `${base.regla} Vence el ${due}.` };
}

const ORDEN: Record<Prioridad, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MyWorkService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>, private readonly authz: AuthorizationService) {}

  private has(ctx: TenantContext, p: Permission) { return ctx.permissions.includes(p); }
  /** Alcance «todo / asignados / nada» sobre la columna de responsable del productor. */
  private scope(ctx: TenantContext, all: Permission, assigned: Permission | null, col: RawBuilder<unknown>) {
    if (this.has(ctx, all)) return sql<boolean>`TRUE`;
    if (assigned && this.has(ctx, assigned)) return sql<boolean>`${col} = ${ctx.membershipId}`;
    return null;
  }

  async myWork(user: AuthUser, orgId: string, f: { queue?: string; assignee?: string; status?: string }) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();

    // Validación de filtros: un valor que no existe es un error, no un filtro que no filtra.
    const queue = f.queue?.toUpperCase();
    if (queue && queue !== 'MINE' && queue !== 'SUPERVISION') throw new BadRequestException({ code: 'QUEUE_INVALID', message: 'La cola solo puede ser MINE o SUPERVISION.' });
    const asg = f.assignee?.trim();
    if (asg && asg !== 'ME' && asg !== 'UNASSIGNED' && !UUID.test(asg)) throw new BadRequestException({ code: 'ASSIGNEE_INVALID', message: 'El responsable debe ser ME, UNASSIGNED o un identificador de membresía.' });
    const estado = f.status?.trim().toUpperCase() || null;

    const base = `/organizaciones/${orgId}`;
    const active = ctx.organizationStatus === 'ACTIVE';
    const hoy = new Date().toISOString().slice(0, 10);
    const prAssignee = sql`pr.assigned_membership_id`;
    const filas: Fila[] = [];
    /** Por tipo: cuántas coinciden de verdad, cuántas son personales y cuántas se devolvieron. */
    const totales: Record<string, { n: number; mias: number; devueltas: number }> = {};
    const mia = asg === 'ME' ? ctx.membershipId : asg === 'UNASSIGNED' ? null : asg ?? undefined;

    /** Filtro de responsable, en SQL, sobre la columna real de cada tarea. */
    const filtroResp = (col: RawBuilder<unknown> | null) => {
      if (mia === undefined) return sql<boolean>`TRUE`;
      if (!col) return mia === null ? sql<boolean>`TRUE` : sql<boolean>`FALSE`;   // tarea sin responsable en el dominio
      return mia === null ? sql<boolean>`${col} IS NULL` : sql<boolean>`${col} = ${mia}`;
    };
    /** Filtro de estado del dominio, en SQL. */
    const filtroEstado = (col: RawBuilder<unknown> | string) => (estado === null ? sql<boolean>`TRUE` : sql<boolean>`${typeof col === 'string' ? sql.lit(col) : col} = ${estado}`);

    // «Es mía» como predicado SQL. `col = null` significa que el dominio no registra responsable para ese tipo,
    // y entonces la tarea nunca es personal. `IS TRUE` / `IS NOT TRUE` para que un responsable NULL caiga del
    // lado de supervisión en vez de desaparecer por la lógica ternaria.
    const esMia = (col: RawBuilder<unknown> | null, siempreMia: boolean) =>
      (siempreMia ? sql<boolean>`TRUE` : col ? sql<boolean>`${col} = ${ctx.membershipId}` : sql<boolean>`FALSE`);
    /**
     * Filtro de COLA, en SQL y no en memoria.
     *
     * Tiene que ir dentro de la consulta: si se aplicara después del tope por tipo, una cola personal situada
     * detrás de las primeras 50 tareas autorizadas saldría vacía y el recuento mentiría.
     */
    const filtroCola = (col: RawBuilder<unknown> | null, siempreMia = false) => {
      if (!queue) return sql<boolean>`TRUE`;
      const m = esMia(col, siempreMia);
      return queue === 'MINE' ? sql<boolean>`(${m}) IS TRUE` : sql<boolean>`(${m}) IS NOT TRUE`;
    };
    /** Cuántas de las que coinciden son personales. Se calcula en la base, antes del tope. */
    const contarMias = (col: RawBuilder<unknown> | null, siempreMia = false) =>
      (siempreMia ? sql`count(*) OVER ()` : col ? sql`count(*) FILTER (WHERE (${esMia(col, false)}) IS TRUE) OVER ()` : sql`0`);

    const agregar = (code: string, total: number, mias: number, nuevas: Array<Omit<Fila, 'queue' | 'priority' | 'priority_rule' | 'due_state'>>) => {
      totales[code] = { n: total, mias, devueltas: nuevas.length };
      for (const fila of nuevas) {
        const cola: Cola = fila.assignee?.membership_id === ctx.membershipId ? 'MINE' : 'SUPERVISION';
        filas.push({ ...fila, queue: cola, ...porPlazo(code, fila.due_date, hoy) });
      }
    };

    // 1) Borradores de entrega por completar y registrar (delivery:create / _assigned).
    const delWrite = this.scope(ctx, 'delivery:create', 'delivery:create_assigned', prAssignee);
    if (active && delWrite) {
      const rows = (await sql<{ id: string; delivery_code: string; producer_code: string; resp: string | null; nombre: string | null; n: string; nm: string }>`
        SELECT d.id, d.delivery_code, pr.producer_code, pr.assigned_membership_id AS resp,
               btrim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS nombre,
               count(*) OVER ()::text AS n, ${contarMias(prAssignee)}::text AS nm
        FROM deliveries d
        JOIN producers pr ON pr.id = d.producer_id AND pr.organization_id = d.organization_id
        LEFT JOIN memberships m ON m.id = pr.assigned_membership_id AND m.organization_id = pr.organization_id
        LEFT JOIN users u ON u.id = m.user_id
        WHERE d.organization_id = ${orgId} AND d.status = 'DRAFT' AND ${delWrite}
          AND ${filtroResp(prAssignee)} AND ${filtroEstado('DRAFT')} AND ${filtroCola(prAssignee)}
        ORDER BY d.created_at LIMIT ${LIMIT}`.execute(this.db)).rows;
      agregar('DELIVERY_DRAFTS', rows.length ? Number(rows[0].n) : 0, rows.length ? Number(rows[0].nm) : 0, rows.map((r) => ({
        code: 'DELIVERY_DRAFTS', title: 'Entregas en borrador',
        entity: { type: 'DELIVERY', id: r.id, code: `${r.delivery_code} · ${r.producer_code}`, href: `${base}/entregas/${r.id}` },
        reason: 'Borrador sin registrar: faltan datos obligatorios o la confirmación.',
        impact: 'Mientras siga en borrador no existe para inventario, trazabilidad ni riesgo.',
        assignee: r.resp ? { membership_id: r.resp, name: r.nombre || 'Miembro' } : null,
        assignee_note: r.resp ? 'Técnico asignado al productor de la entrega.' : 'El productor no tiene técnico asignado.',
        due_date: null, status: 'DRAFT', evidence_required: null,
        action: 'Completar y registrar', action_href: `${base}/entregas/${r.id}`,
      })));
    }
    // 2) Entregas registradas sin ninguna recepción (reception:confirm, lectura de entregas).
    const delRead = this.scope(ctx, 'delivery:read', 'delivery:read_assigned', prAssignee);
    if (active && delRead && this.has(ctx, 'reception:confirm')) {
      const rows = (await sql<{ id: string; delivery_code: string; producer_code: string; resp: string | null; nombre: string | null; n: string; nm: string }>`
        SELECT d.id, d.delivery_code, pr.producer_code, pr.assigned_membership_id AS resp,
               btrim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS nombre,
               count(*) OVER ()::text AS n, ${contarMias(prAssignee)}::text AS nm
        FROM deliveries d
        JOIN producers pr ON pr.id = d.producer_id AND pr.organization_id = d.organization_id
        LEFT JOIN memberships m ON m.id = pr.assigned_membership_id AND m.organization_id = pr.organization_id
        LEFT JOIN users u ON u.id = m.user_id
        WHERE d.organization_id = ${orgId} AND d.status = 'REGISTERED' AND ${delRead}
          AND NOT EXISTS (SELECT 1 FROM receptions r WHERE r.delivery_id = d.id AND r.organization_id = d.organization_id)
          AND ${filtroResp(prAssignee)} AND ${filtroEstado('REGISTERED')} AND ${filtroCola(prAssignee)}
        ORDER BY d.registered_at LIMIT ${LIMIT}`.execute(this.db)).rows;
      agregar('DELIVERIES_TO_RECEIVE', rows.length ? Number(rows[0].n) : 0, rows.length ? Number(rows[0].nm) : 0, rows.map((r) => ({
        code: 'DELIVERIES_TO_RECEIVE', title: 'Entregas por recibir',
        entity: { type: 'DELIVERY', id: r.id, code: `${r.delivery_code} · ${r.producer_code}`, href: `${base}/entregas/${r.id}` },
        reason: 'Registrada y sin recepción física.',
        impact: 'El cacao declarado no está en inventario: no puede pesarse, loteficarse ni despacharse.',
        assignee: r.resp ? { membership_id: r.resp, name: r.nombre || 'Miembro' } : null,
        assignee_note: r.resp ? 'Técnico asignado al productor de la entrega.' : 'El productor no tiene técnico asignado.',
        due_date: null, status: 'REGISTERED', evidence_required: null,
        action: 'Registrar recepción y pesaje', action_href: `${base}/entregas/${r.id}`,
      })));
    }
    // 3) Resultados de calidad sin decisión (quality:decide, lectura de entregas).
    if (active && delRead && this.has(ctx, 'quality:decide')) {
      const resp = sql`p.resp`;
      const rows = (await sql<{ id: string; delivery_code: string; resp: string | null; nombre: string | null; n: string; nm: string }>`
        WITH pend AS (
          SELECT DISTINCT d.id, d.delivery_code, pr.assigned_membership_id AS resp FROM quality_results q
          JOIN quality_samples s ON s.id = q.sample_id AND s.organization_id = q.organization_id
          JOIN receptions r ON r.id = s.reception_id JOIN deliveries d ON d.id = r.delivery_id
          JOIN producers pr ON pr.id = d.producer_id AND pr.organization_id = d.organization_id
          WHERE q.organization_id = ${orgId} AND ${delRead} AND q.decision = 'PENDING'
            AND ${filtroResp(prAssignee)} AND ${filtroEstado('PENDING')} AND ${filtroCola(prAssignee)}
            AND q.id = (SELECT q2.id FROM quality_results q2 WHERE q2.sample_id = q.sample_id ORDER BY q2.recorded_at DESC, q2.id DESC LIMIT 1))
        SELECT p.id, p.delivery_code, p.resp, btrim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS nombre,
               count(*) OVER ()::text AS n, ${contarMias(resp)}::text AS nm
        FROM pend p LEFT JOIN memberships m ON m.id = p.resp AND m.organization_id = ${orgId} LEFT JOIN users u ON u.id = m.user_id
        ORDER BY p.delivery_code LIMIT ${LIMIT}`.execute(this.db)).rows;
      agregar('QUALITY_PENDING', rows.length ? Number(rows[0].n) : 0, rows.length ? Number(rows[0].nm) : 0, rows.map((r) => ({
        code: 'QUALITY_PENDING', title: 'Resultados de calidad pendientes de decisión',
        entity: { type: 'DELIVERY', id: r.id, code: r.delivery_code, href: `${base}/entregas/${r.id}` },
        reason: 'Hay un resultado registrado sin liberar ni rechazar.',
        impact: 'Sin decisión, el cacao recibido no queda liberado ni rechazado.',
        assignee: r.resp ? { membership_id: r.resp, name: r.nombre || 'Miembro' } : null,
        assignee_note: r.resp ? 'Técnico asignado al productor de la entrega.' : 'El productor no tiene técnico asignado.',
        due_date: null, status: 'PENDING', evidence_required: null,
        action: 'Decidir calidad', action_href: `${base}/entregas/${r.id}`,
      })));
    }
    // 4) Posibles duplicados de productor por revisar (producer:review_duplicates).
    if (active && this.has(ctx, 'producer:review_duplicates')) {
      // La coincidencia es entre DOS productores: la etiqueta nombra el par, no uno solo.
      const rows = (await sql<{ id: string; etiqueta: string; n: string }>`
        SELECT r.id, a.producer_code || ' ↔ ' || b.producer_code AS etiqueta, count(*) OVER ()::text AS n
        FROM producer_match_reviews r
        JOIN producers a ON a.id = r.producer_a_id AND a.organization_id = r.organization_id
        JOIN producers b ON b.id = r.producer_b_id AND b.organization_id = r.organization_id
        WHERE r.organization_id = ${orgId} AND r.status = 'PENDING'
          AND ${filtroResp(null)} AND ${filtroEstado('PENDING')} AND ${filtroCola(null)}
        ORDER BY a.producer_code, b.producer_code LIMIT ${LIMIT}`.execute(this.db)).rows;
      agregar('DUPLICATE_REVIEWS', rows.length ? Number(rows[0].n) : 0, 0, rows.map((r) => ({
        code: 'DUPLICATE_REVIEWS', title: 'Posibles duplicados de productor',
        entity: { type: 'PRODUCER_MATCH', id: r.id, code: r.etiqueta, href: `${base}/productores/coincidencias` },
        reason: 'Coincidencia de identidad pendiente de revisión.',
        impact: 'No se fusiona nada automáticamente: el duplicado sigue activo hasta que alguien decida.',
        assignee: null, assignee_note: 'Sin responsable individual: la revisión es de la organización.',
        due_date: null, status: 'PENDING', evidence_required: null,
        action: 'Revisar', action_href: `${base}/productores/coincidencias`,
      })));
    }
    // 5) Parcelas activas sin ubicación: sin versión vigente o con versión sin geometría (solo superficie declarada).
    //    La superficie declarada no es ubicación; la tarea se resuelve solo con un punto o un polígono.
    const plotWrite = this.scope(ctx, 'plot:update', 'plot:update_assigned', prAssignee);
    if (active && plotWrite) {
      const rows = (await sql<{ id: string; plot_code: string; resp: string | null; nombre: string | null; n: string; nm: string }>`
        SELECT p.id, p.plot_code, pr.assigned_membership_id AS resp,
               btrim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS nombre,
               count(*) OVER ()::text AS n, ${contarMias(prAssignee)}::text AS nm
        FROM plots p
        JOIN producers pr ON pr.id = p.producer_id AND pr.organization_id = p.organization_id
        LEFT JOIN plot_versions v ON v.id = p.current_version_id AND v.plot_id = p.id
        LEFT JOIN memberships m ON m.id = pr.assigned_membership_id AND m.organization_id = pr.organization_id
        LEFT JOIN users u ON u.id = m.user_id
        WHERE p.organization_id = ${orgId} AND p.status = 'ACTIVE' AND (p.current_version_id IS NULL OR v.geometry_type IS NULL) AND ${plotWrite}
          AND ${filtroResp(prAssignee)} AND ${filtroEstado('ACTIVE')} AND ${filtroCola(prAssignee)}
        ORDER BY p.plot_code LIMIT ${LIMIT}`.execute(this.db)).rows;
      agregar('PLOTS_WITHOUT_LOCATION', rows.length ? Number(rows[0].n) : 0, rows.length ? Number(rows[0].nm) : 0, rows.map((r) => ({
        code: 'PLOTS_WITHOUT_LOCATION', title: 'Parcelas sin ubicación',
        entity: { type: 'PLOT', id: r.id, code: r.plot_code, href: `${base}/parcelas/${r.id}` },
        reason: 'Sin punto ni polígono vigente. La superficie declarada no es ubicación y no resuelve esta tarea.',
        impact: 'Sin geometría no hay evaluación geográfica ni perfil de geolocalización.',
        assignee: r.resp ? { membership_id: r.resp, name: r.nombre || 'Miembro' } : null,
        assignee_note: r.resp ? 'Técnico asignado al productor de la parcela.' : 'El productor no tiene técnico asignado.',
        due_date: null, status: 'ACTIVE', evidence_required: null,
        action: 'Capturar ubicación', action_href: `${base}/parcelas/${r.id}`,
      })));
    }
    // 6) Mitigaciones asignadas a mí, abiertas (mitigation:contribute). Única tarea con PLAZO real del dominio.
    const mAssignee = sql`a.assignee_membership_id`;
    if (active && this.has(ctx, 'mitigation:contribute') && this.has(ctx, 'mitigation:read')) {
      const rows = (await sql<{ id: string; factor_code: string; lot_code: string; due: string; ev: string; resp: string; nombre: string | null; n: string }>`
        SELECT a.id, a.factor_code, l.lot_code, a.due_date::text AS due, a.evidence_required AS ev, a.assignee_membership_id AS resp,
               btrim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS nombre, count(*) OVER ()::text AS n
        FROM mitigation_actions a
        JOIN lots l ON l.id = a.subject_id AND l.organization_id = a.organization_id
        LEFT JOIN memberships m ON m.id = a.assignee_membership_id AND m.organization_id = a.organization_id
        LEFT JOIN users u ON u.id = m.user_id
        WHERE a.organization_id = ${orgId} AND a.assignee_membership_id = ${ctx.membershipId} AND a.status = 'OPEN'
          AND ${filtroResp(mAssignee)} AND ${filtroEstado(sql`a.status`)} AND ${filtroCola(mAssignee, true)}
        ORDER BY a.due_date, a.created_at LIMIT ${LIMIT}`.execute(this.db)).rows;
      agregar('MITIGATIONS_ASSIGNED', rows.length ? Number(rows[0].n) : 0, rows.length ? Number(rows[0].n) : 0, rows.map((r) => ({
        code: 'MITIGATIONS_ASSIGNED', title: 'Mitigaciones asignadas a ti',
        entity: { type: 'MITIGATION', id: r.id, code: `${r.lot_code} · ${r.factor_code}`, href: `${base}/mitigaciones/${r.id}` },
        reason: 'Acción abierta: aporta los soportes y envíala a verificación.',
        impact: 'El factor de riesgo sigue sin mitigar mientras la acción no se verifique.',
        assignee: { membership_id: r.resp, name: r.nombre || 'Miembro' },
        assignee_note: 'Responsable designado al crear la acción.',
        due_date: r.due, status: 'OPEN', evidence_required: r.ev,
        action: 'Aportar soportes', action_href: `${base}/mitigaciones/${r.id}`,
      })));
    }
    // 7) Mitigaciones enviadas por OTRA persona, por verificar (mitigation:verify). Separación de funciones:
    //    quien envió no se verifica a sí mismo, y por eso esta cola es de supervisión, nunca personal.
    if (active && this.has(ctx, 'mitigation:verify') && this.has(ctx, 'mitigation:read')) {
      const rows = (await sql<{ id: string; factor_code: string; lot_code: string; due: string; ev: string; n: string }>`
        SELECT a.id, a.factor_code, l.lot_code, a.due_date::text AS due, a.evidence_required AS ev, count(*) OVER ()::text AS n
        FROM mitigation_actions a JOIN lots l ON l.id = a.subject_id AND l.organization_id = a.organization_id
        WHERE a.organization_id = ${orgId} AND a.status = 'SUBMITTED'
          AND NOT EXISTS (SELECT 1 FROM mitigation_submissions s WHERE s.action_id = a.id AND s.submitted_by = ${user.id})
          AND ${filtroResp(null)} AND ${filtroEstado(sql`a.status`)} AND ${filtroCola(null)}
        ORDER BY a.due_date, a.created_at LIMIT ${LIMIT}`.execute(this.db)).rows;
      agregar('MITIGATIONS_TO_VERIFY', rows.length ? Number(rows[0].n) : 0, 0, rows.map((r) => ({
        code: 'MITIGATIONS_TO_VERIFY', title: 'Mitigaciones por verificar',
        entity: { type: 'MITIGATION', id: r.id, code: `${r.lot_code} · ${r.factor_code}`, href: `${base}/mitigaciones/${r.id}` },
        reason: 'Enviada por otra persona: verifica o rechaza con motivo.',
        impact: 'Sin verificación no hay reevaluación del riesgo del lote.',
        assignee: null,
        assignee_note: 'Separación de funciones: la verifica alguien con permiso distinto de quien la envió.',
        due_date: r.due, status: 'SUBMITTED', evidence_required: r.ev,
        action: 'Verificar', action_href: `${base}/mitigaciones/${r.id}`,
      })));
    }

    filas.sort((a, b) => ORDEN[a.priority] - ORDEN[b.priority]
      || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')
      || a.entity.code.localeCompare(b.entity.code));

    // Agrupación por tipo, que es como la portada resume la cola. El recuento es el REAL del dominio, no el de
    // las filas devueltas: recortar la lista no puede hacer creer que hay menos trabajo del que hay.
    const LISTA: Record<string, string> = {
      DELIVERY_DRAFTS: `${base}/entregas?status=DRAFT`, DELIVERIES_TO_RECEIVE: `${base}/entregas?reception=NOT_RECEIVED`,
      QUALITY_PENDING: `${base}/entregas`, DUPLICATE_REVIEWS: `${base}/productores/coincidencias`,
      PLOTS_WITHOUT_LOCATION: `${base}/parcelas?geometry=WITHOUT`, MITIGATIONS_ASSIGNED: `${base}/mitigaciones?status=OPEN`,
      MITIGATIONS_TO_VERIFY: `${base}/mitigaciones?status=SUBMITTED`,
    };
    const PRIMERA: Record<string, Fila> = {};
    for (const fila of filas) PRIMERA[fila.code] ??= fila;
    const tasks: Task[] = Object.entries(totales).filter(([code, t]) => t.n > 0 && PRIMERA[code]).map(([code, t]) => ({
      code, title: PRIMERA[code].title, reason: PRIMERA[code].reason, action: PRIMERA[code].action, count: t.n,
      items: filas.filter((x) => x.code === code).slice(0, EJEMPLOS).map((x) => ({ id: x.entity.id, label: x.entity.code, href: x.entity.href })),
      list_href: LISTA[code],
    }));

    // Los recuentos salen de la base, no de las filas devueltas: recortar la lista no puede hacer creer que
    // hay menos trabajo del que hay, ni vaciar una cola que sí tiene tareas más allá del tope.
    const suma = Object.values(totales);
    const total = suma.reduce((a, t) => a + t.n, 0);
    const mine = suma.reduce((a, t) => a + t.mias, 0);
    return {
      organization_id: orgId, organization_status: ctx.organizationStatus, generated_at: new Date().toISOString(),
      queues: { mine, supervision: total - mine },
      filters: { queue: queue ?? null, assignee: asg ?? null, status: estado, applied_in: 'BACKEND' },
      rows: filas, total, shown: filas.length, truncated: total > filas.length,
      tasks,
      note: active
        ? 'Solo tareas que tu rol puede completar, dentro de tu alcance. Cada fila desaparece cuando el dominio la resuelve: aquí no se marca nada por hecho.'
        : 'La organización está suspendida: no hay tareas de escritura.',
      priority_note: 'La prioridad sale de una regla explicable: el plazo vencido o próximo manda; si el dominio no registra plazo, se dice y decide el tipo de tarea.',
    };
  }
}

@ApiTags('work')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class MyWorkController {
  constructor(private readonly service: MyWorkService) {}

  @Get('my-work')
  @ApiOperation({ summary: 'Mi trabajo: cola personal y de supervisión, con filtros reales aplicados en el backend' })
  @ApiQuery({ name: 'queue', required: false, enum: ['MINE', 'SUPERVISION'] })
  @ApiQuery({ name: 'assignee', required: false, description: 'ME, UNASSIGNED o identificador de membresía' })
  @ApiQuery({ name: 'status', required: false, description: 'Estado del dominio de la tarea (DRAFT, REGISTERED, PENDING, ACTIVE, OPEN, SUBMITTED)' })
  myWork(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('queue') queue?: string, @Query('assignee') assignee?: string, @Query('status') status?: string) {
    return this.service.myWork(user, orgId, { queue, assignee, status });
  }
}
