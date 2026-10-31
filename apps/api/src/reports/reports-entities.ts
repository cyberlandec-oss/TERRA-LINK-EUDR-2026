import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Kysely, Transaction, sql } from 'kysely';
import { createHash } from 'crypto';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { AppError, forbidden, notFound } from '../common/errors';
import { GEO_PROFILE, PROFILE_SOURCE } from '../plots/geo-profile';
import { csvCell } from '../audit/audit-query';
import { ReportPageDto } from './reports.dto';
import {
  ENTITY_REPORTS, GEOJSON_REQUIRES, GEOJSON_WHY, definitionOf, denialMessage, missingPermissions,
  type Definition, type EntityKind,
} from './reports-catalog';
import {
  ASSIGNED_SCOPE_NOTE, coverageFor, coverageLine, type Coverage, EXPORT_RECALC_NOTE, GEOJSON_EXPORT_FORMAT, INTERPRETATION_NOTE, REPORT_CATALOG_VERSION,
  REPORT_EXPORT_FORMAT, SCOPE_NOTE, SNAPSHOT_NOTE, exportLimitNote, has, timeBasis, type Period,
} from './reports-shared';

// P0-030 — Reportes por entidad (S1 §97 «Sprint 11 — Reporting»: productor, parcela, lote, riesgo, trazabilidad, DD
// y exportación GeoJSON). Contrato: docs/decisiones/P0-030-REPORTES.md.
//
// Reglas propias de estos reportes, además de las de los indicadores:
//  1. **Permiso por dominio de cada dato**, no solo de la entidad que encabeza las filas: el reporte de productores
//     cuenta parcelas y entregas, así que exige también `plot:read` y `delivery:read`. Catálogo y regla, con el motivo
//     de cada permiso, en `reports-catalog.ts` (módulo puro, probado en memoria con permisos arbitrarios).
//  2. **Lectura consistente, con su alcance exacto**: dentro de UNA petición, filas y totales salen de la misma
//     transacción `REPEATABLE READ` de solo lectura, y una exportación recorre todas sus páginas dentro de esa misma
//     transacción. Reutilizar la misma función no basta: sin instantánea, sus consultas sucesivas verían estados
//     distintos. Lo que NO se garantiza: dos peticiones distintas; navegar entre páginas abre una instantánea nueva.
//  3. Organización y alcance se aplican ANTES de agregar, en la misma consulta que produce filas y totales. Los totales
//     cubren el conjunto completo ya filtrado, no la página mostrada.
//  4. Un sujeto sin evaluar NO se omite: aparece con su estado «sin evaluar». Omitirlo escondería el desconocido.
//  5. Pesos y cantidades llevan su unidad y NUNCA se suman entre unidades distintas: los totales van por unidad.
//  6. Identidad: los nombres exigen `producer:read_identity`. Coordenadas exactas: solo en la exportación GeoJSON.
export { ENTITY_REPORTS };

/** Página por omisión y máximo por petición (convención de listados del repositorio: cursor por clave natural). */
export const PAGE_DEFAULT = 100;
export const PAGE_MAX = 500;
/** Tope duro de una exportación. Se declara en el archivo; nunca se trunca en silencio. */
export const EXPORT_MAX_ROWS = 20000;

interface Column { key: string; label: string; note?: string }
type Cell = string | number | null;
interface Built {
  columns: Column[];
  rows: Record<string, Cell>[];
  totals: Array<{ key: string; label: string; value: string }>;
  notes: string[];
  total_rows: number;
  next_cursor: string | null;
}

type Db = Kysely<Database> | Transaction<Database>;

const GEOJSON_NOTICE =
  'Exportación TÉCNICA de las geometrías vigentes registradas en Terra Link (RFC 7946, WGS84 longitud/latitud). No es un paquete de debida ' +
  'diligencia EUDR, no es una declaración presentada y no sigue el perfil de ningún sistema de destino.';
/** Decimales que se ESCRIBEN en el archivo: formato de intercambio, no precision de captura. */
const PROFILE_DECIMALS = GEO_PROFILE.parameters.interchange_decimals;
const GEOJSON_PROFILE_FORMAT = 'TERRA_LINK_GEOJSON_EUDR_PROFILE_V1';
const GEOJSON_PROFILE_NOTICE =
  'Archivo preparado segun el PERFIL TECNICO de destino EUDR_GEO_V1 (D-05.A), contra una version DOCUMENTADA del sistema receptor. ' +
  'Cumplir el perfil tecnico NO es conformidad EUDR, NO es una declaracion presentada y NO se ha comprobado contra el servicio real. ' +
  'La aplicabilidad juridica (D-05.B) sigue pendiente.';
const PROFILE_STATUS_LABEL: Record<string, string> = {
  DOES_NOT_MEET: 'No cumple el perfil tecnico de destino.',
  REVIEW_REQUIRED: 'Requiere revision humana antes de decidir.',
  NOT_EVALUABLE: 'No evaluable con los datos disponibles.',
  MEETS_PROFILE: 'Cumple el perfil tecnico de destino.',
};

const GEOJSON_REGULATORY =
  'Desde el 2026-10-15 existe un PERFIL TÉCNICO provisional, EUDR_GEO_V1 1.0.0 (D-05.A): fija qué geometría admite cada caso (punto o ' +
  'polígono y su umbral de superficie), qué precisión y redondeo, y qué parcelas quedan calificadas. Lo que sigue PENDIENTE es D-05.B, la ' +
  'APLICABILIDAD JURÍDICA: qué significa cumplir ese perfil frente al destino regulatorio y qué puede afirmarse con ello. Esta exportación ' +
  'no decide ninguna de las dos cosas: entrega lo registrado, sin recortar ni reproyectar, y declara lo que falta.';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/reports/entities')
export class EntityReportsController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private async ctx(user: AuthUser, orgId: string, perm: Permission) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!ctx.permissions.includes(perm)) throw forbidden();
    return ctx;
  }

  private def(kind: string): Definition {
    const d = definitionOf(kind);
    if (!d) throw new AppError(404, 'REPORT_NOT_FOUND', 'Ese reporte no existe.');
    return d;
  }

  /** Faltando un solo permiso de dominio, se deniega el reporte entero: nunca una versión recortada. */
  private requireAll(ctx: TenantContext, d: Definition) {
    const faltan = missingPermissions(ctx.permissions, d.requires);
    if (faltan.length) throw forbidden('PERMISSION_DENIED', denialMessage(d.requires, faltan, d.why));
  }

  /**
   * Instantánea de lectura de UNA petición: filas y totales, y en la exportación todas sus páginas, dentro de la misma
   * transacción REPEATABLE READ de solo lectura. Entre peticiones distintas no hay instantánea compartida ni se simula.
   */
  private snapshot<T>(fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.db.transaction().setIsolationLevel('repeatable read').setAccessMode('read only').execute(fn);
  }

  private meta(period: Period, asOf: string, coverage: Coverage) {
    return {
      catalog_version: REPORT_CATALOG_VERSION,
      time_basis: timeBasis(asOf),
      scope_note: SCOPE_NOTE,
      assigned_scope_note: ASSIGNED_SCOPE_NOTE,
      interpretation_note: INTERPRETATION_NOTE,
      snapshot_note: SNAPSHOT_NOTE,
      export_note: exportLimitNote(EXPORT_MAX_ROWS),
      export_limit: EXPORT_MAX_ROWS,
      coverage,
      period: { from: period.from, to: period.to },
      limit_note:
        `Las filas se paginan por cursor sobre la clave natural del reporte (página por omisión ${PAGE_DEFAULT}, máximo ${PAGE_MAX}). ` +
        'Los TOTALES se calculan siempre sobre el conjunto completo ya filtrado por organización y alcance, no sobre la página mostrada: ' +
        'avanzar o truncar la tabla no altera ninguna cifra.',
    };
  }

  // ---------------------------------------------------------------- reportes

  private async build(db: Db, ctx: TenantContext, kind: EntityKind, period: Period, page: { after: string | null; limit: number }): Promise<Built> {
    const org = ctx.organizationId;
    const { after, limit } = page;
    // Alcance por asignación aplicado en la MISMA consulta (hoy estos reportes exigen el permiso completo, de modo que
    // el filtro no recorta nada; se mantiene para que un cambio de catálogo no abra un agregado por descuido).
    const todosProductores = has(ctx, 'producer:read');
    const todasParcelas = has(ctx, 'plot:read');
    const memb = ctx.membershipId;
    const identidad = has(ctx, 'producer:read_identity');
    const nombre = (r: { legal_name: string | null; first_name: string | null; last_name: string | null }) =>
      identidad ? (r.legal_name ?? ([r.first_name, r.last_name].filter(Boolean).join(' ') || null)) : null;
    /** Cursor: la clave natural de la última fila entregada. Única dentro del tenant, así la página es estable. */
    const cursorOf = (rows: Record<string, Cell>[], key: string) =>
      rows.length === limit ? String(rows[rows.length - 1][key]) : null;

    if (kind === 'producers') {
      const where = sql`pr.organization_id = ${org} AND pr.deleted_at IS NULL AND (${todosProductores} OR pr.assigned_membership_id = ${memb})`;
      const periodo = sql`(${period.from}::date IS NULL OR d.delivery_date >= ${period.from}::date) AND (${period.to}::date IS NULL OR d.delivery_date <= ${period.to}::date)`;
      const rows = (await sql<{ producer_code: string; status: string; legal_name: string | null; first_name: string | null; last_name: string | null; plots: string; plots_with_geometry: string; deliveries: string; asignado: boolean }>`
        SELECT pr.producer_code, pr.status, pr.legal_name, pr.first_name, pr.last_name,
               (SELECT count(*) FROM plots pl WHERE pl.organization_id = pr.organization_id AND pl.producer_id = pr.id AND pl.deleted_at IS NULL)::text AS plots,
               (SELECT count(*) FROM plots pl JOIN plot_versions v ON v.id = pl.current_version_id
                 WHERE pl.organization_id = pr.organization_id AND pl.producer_id = pr.id AND pl.deleted_at IS NULL AND v.geometry_type IS NOT NULL)::text AS plots_with_geometry,
               (SELECT count(*) FROM deliveries d WHERE d.organization_id = pr.organization_id AND d.producer_id = pr.id
                 AND d.status = 'REGISTERED' AND d.delivery_date IS NOT NULL AND ${periodo})::text AS deliveries,
               (pr.assigned_membership_id IS NOT NULL) AS asignado
        FROM producers pr WHERE ${where} AND (${after}::text IS NULL OR pr.producer_code > ${after}::text)
        ORDER BY pr.producer_code LIMIT ${limit}`.execute(db)).rows;
      const t = (await sql<{ productores: string; con_parcela: string; parcelas: string; con_geometria: string; entregas: string }>`
        SELECT count(*)::text AS productores,
               count(*) FILTER (WHERE (SELECT count(*) FROM plots pl WHERE pl.organization_id = pr.organization_id AND pl.producer_id = pr.id AND pl.deleted_at IS NULL) > 0)::text AS con_parcela,
               coalesce(sum((SELECT count(*) FROM plots pl WHERE pl.organization_id = pr.organization_id AND pl.producer_id = pr.id AND pl.deleted_at IS NULL)), 0)::text AS parcelas,
               coalesce(sum((SELECT count(*) FROM plots pl JOIN plot_versions v ON v.id = pl.current_version_id
                 WHERE pl.organization_id = pr.organization_id AND pl.producer_id = pr.id AND pl.deleted_at IS NULL AND v.geometry_type IS NOT NULL)), 0)::text AS con_geometria,
               coalesce(sum((SELECT count(*) FROM deliveries d WHERE d.organization_id = pr.organization_id AND d.producer_id = pr.id
                 AND d.status = 'REGISTERED' AND d.delivery_date IS NOT NULL AND ${periodo})), 0)::text AS entregas
        FROM producers pr WHERE ${where}`.execute(db)).rows[0];
      const out = rows.map((r) => ({ producer_code: r.producer_code, nombre: nombre(r), status: r.status, plots: Number(r.plots), plots_with_geometry: Number(r.plots_with_geometry), deliveries: Number(r.deliveries), asignado: r.asignado ? 'Sí' : 'No' }));
      return {
        columns: [
          { key: 'producer_code', label: 'Código' },
          { key: 'nombre', label: 'Nombre', note: 'Solo con producer:read_identity; sin ese permiso queda vacío y el reporte se lee por código.' },
          { key: 'status', label: 'Estado' },
          { key: 'plots', label: 'Parcelas', note: 'Exige plot:read: contar parcelas es leer el dominio de parcelas.' },
          { key: 'plots_with_geometry', label: 'Parcelas con geometría', note: 'Versión vigente con geometría registrada. No dice si es válida: eso exige el criterio de D-05.' },
          { key: 'deliveries', label: 'Entregas registradas en el período', note: 'Exige delivery:read. Por delivery_date (fecha civil declarada), nunca created_at.' },
          { key: 'asignado', label: '¿Asignado?' },
        ],
        rows: out,
        totals: [
          { key: 'productores', label: 'Productores vigentes', value: t.productores },
          { key: 'con_parcela', label: 'Con al menos una parcela', value: t.con_parcela },
          { key: 'parcelas', label: 'Parcelas (suma)', value: t.parcelas },
          { key: 'con_geometria', label: 'Parcelas con geometría (suma)', value: t.con_geometria },
          { key: 'entregas', label: 'Entregas registradas en el período (suma)', value: t.entregas },
        ],
        notes: [
          'No se suman cantidades entregadas: cada entrega lleva su unidad y sumar entre unidades distintas daría una cifra sin significado. El reporte cuenta entregas.',
          identidad ? 'Incluye nombres porque tu rol tiene producer:read_identity.' : 'Sin producer:read_identity: el reporte no incluye nombres, solo códigos.',
          'Nunca incluye documento, teléfono ni dirección, que están cifrados y fuera de todo reporte.',
        ],
        total_rows: Number(t.productores),
        next_cursor: cursorOf(out, 'producer_code'),
      };
    }

    if (kind === 'plots') {
      const where = sql`pl.organization_id = ${org} AND pl.deleted_at IS NULL AND (${todasParcelas} OR pr.assigned_membership_id = ${memb})`;
      const rows = (await sql<{ plot_code: string; producer_code: string; status: string; geometry_type: string | null; survey_method: string | null; validation_status: string | null; area_declared_ha: string | null; area_calculated_ha: string | null; current_version_id: string | null }>`
        SELECT pl.plot_code, pr.producer_code, pl.status, v.geometry_type, v.survey_method, v.validation_status,
               v.area_declared_ha::text, v.area_calculated_ha::text, pl.current_version_id
        FROM plots pl JOIN producers pr ON pr.id = pl.producer_id AND pr.organization_id = pl.organization_id
        LEFT JOIN plot_versions v ON v.id = pl.current_version_id AND v.organization_id = pl.organization_id
        WHERE ${where} AND (${after}::text IS NULL OR pl.plot_code > ${after}::text)
        ORDER BY pl.plot_code LIMIT ${limit}`.execute(db)).rows;
      const t = (await sql<{ parcelas: string; con_geometria: string; solo_superficie: string; sin_version: string; evaluadas: string; validas: string; superficie_declarada: string }>`
        SELECT count(*)::text AS parcelas,
               count(*) FILTER (WHERE v.geometry_type IS NOT NULL)::text AS con_geometria,
               count(*) FILTER (WHERE v.id IS NOT NULL AND v.geometry_type IS NULL)::text AS solo_superficie,
               count(*) FILTER (WHERE pl.current_version_id IS NULL)::text AS sin_version,
               count(*) FILTER (WHERE v.validation_status IS NOT NULL AND v.validation_status <> 'NOT_VALIDATED')::text AS evaluadas,
               count(*) FILTER (WHERE v.validation_status = 'VALID')::text AS validas,
               coalesce(sum(v.area_declared_ha), 0)::text AS superficie_declarada
        FROM plots pl JOIN producers pr ON pr.id = pl.producer_id AND pr.organization_id = pl.organization_id
        LEFT JOIN plot_versions v ON v.id = pl.current_version_id AND v.organization_id = pl.organization_id
        WHERE ${where}`.execute(db)).rows[0];
      const estado = (r: typeof rows[number]) => (!r.current_version_id ? 'SIN VERSIÓN' : r.geometry_type ? 'GEOMETRÍA REGISTRADA' : 'SOLO SUPERFICIE DECLARADA');
      const out = rows.map((r) => ({
        plot_code: r.plot_code, producer_code: r.producer_code, status: r.status, geometry_status: estado(r),
        survey_method: r.survey_method, validation_status: r.validation_status === 'NOT_VALIDATED' ? 'SIN EVALUAR' : r.validation_status,
        area_declared_ha: r.area_declared_ha, area_calculated_ha: r.area_calculated_ha,
      }));
      return {
        columns: [
          { key: 'plot_code', label: 'Código' },
          { key: 'producer_code', label: 'Productor', note: 'Exige producer:read: identifica un recurso del dominio de productores.' },
          { key: 'status', label: 'Estado' },
          { key: 'geometry_status', label: 'Ubicación', note: 'La superficie declarada NO es ubicación: se distingue de una geometría registrada.' },
          { key: 'survey_method', label: 'Método' },
          { key: 'validation_status', label: 'Validación GIS', note: 'NOT_VALIDATED significa SIN EVALUAR, no inválida: el criterio depende de D-05 (P0-010).' },
          { key: 'area_declared_ha', label: 'Superficie declarada (ha)' },
          { key: 'area_calculated_ha', label: 'Superficie calculada (ha)' },
        ],
        rows: out,
        totals: [
          { key: 'parcelas', label: 'Parcelas vigentes', value: t.parcelas },
          { key: 'con_geometria', label: 'Con geometría registrada', value: t.con_geometria },
          { key: 'solo_superficie', label: 'Solo superficie declarada', value: t.solo_superficie },
          { key: 'sin_version', label: 'Sin versión vigente', value: t.sin_version },
          { key: 'evaluadas', label: 'Con validación GIS evaluada', value: t.evaluadas },
          { key: 'validas', label: 'Válidas (VALID)', value: Number(t.evaluadas) === 0 ? 'DESCONOCIDO (ninguna evaluada; criterio pendiente de D-05)' : t.validas },
          { key: 'superficie_declarada', label: 'Superficie declarada (ha, suma)', value: t.superficie_declarada },
        ],
        notes: [
          'Este reporte no incluye coordenadas. Las geometrías exactas se obtienen en la exportación GeoJSON, que exige plot:read_geometry.',
          'Las superficies se suman solo entre sí, en hectáreas; no se mezclan con la superficie calculada, que procede de la geometría y no de la declaración.',
        ],
        total_rows: Number(t.parcelas),
        next_cursor: cursorOf(out, 'plot_code'),
      };
    }

    if (kind === 'lots') {
      const where = sql`l.organization_id = ${org}`;
      const rows = (await sql<{ lot_code: string; status: string; origin_status: string; unit: string; output_quantity: string | null; product_code: string | null; entradas: string; created_at: string }>`
        SELECT l.lot_code, l.status, l.origin_status, l.unit, l.output_quantity::text, p.code AS product_code,
               (SELECT count(*) FROM lot_inputs li LEFT JOIN lot_input_releases lr ON lr.input_id = li.id
                 WHERE li.organization_id = l.organization_id AND li.lot_id = l.id AND lr.input_id IS NULL)::text AS entradas,
               to_char(l.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
        FROM lots l LEFT JOIN products p ON p.id = l.product_id AND p.organization_id = l.organization_id
        WHERE ${where} AND (${after}::text IS NULL OR l.lot_code > ${after}::text)
        ORDER BY l.lot_code LIMIT ${limit}`.execute(db)).rows;
      const t = (await sql<{ lotes: string; abiertos: string; cerrados: string; origen_completo: string; origen_incompleto: string }>`
        SELECT count(*)::text AS lotes, count(*) FILTER (WHERE l.status = 'OPEN')::text AS abiertos,
               count(*) FILTER (WHERE l.status = 'CLOSED_FOR_INPUT')::text AS cerrados,
               count(*) FILTER (WHERE l.origin_status = 'COMPLETE')::text AS origen_completo,
               count(*) FILTER (WHERE l.origin_status = 'INCOMPLETE')::text AS origen_incompleto
        FROM lots l WHERE ${where}`.execute(db)).rows[0];
      // Cantidades: una línea por unidad. Nunca una suma única entre unidades distintas.
      const porUnidad = (await sql<{ unit: string; total: string; n: string }>`
        SELECT l.unit, coalesce(sum(l.output_quantity), 0)::text AS total, count(*) FILTER (WHERE l.output_quantity IS NOT NULL)::text AS n
        FROM lots l WHERE ${where} GROUP BY l.unit ORDER BY l.unit`.execute(db)).rows;
      const out = rows.map((r) => ({ lot_code: r.lot_code, product_code: r.product_code, status: r.status, origin_status: r.origin_status, entradas: Number(r.entradas), output_quantity: r.output_quantity, unit: r.unit, created_at: r.created_at }));
      return {
        columns: [
          { key: 'lot_code', label: 'Código' },
          { key: 'product_code', label: 'Producto', note: 'Exige product:read: identifica un recurso del catálogo de productos.' },
          { key: 'status', label: 'Estado' },
          { key: 'origin_status', label: 'Origen', note: 'COMPLETE significa origen declarado completo; no acredita verificación.' },
          { key: 'entradas', label: 'Entradas vigentes', note: 'Entradas no liberadas; una entrada liberada deja de contar.' },
          { key: 'output_quantity', label: 'Cantidad' },
          { key: 'unit', label: 'Unidad' },
          { key: 'created_at', label: 'Creado (UTC)' },
        ],
        rows: out,
        totals: [
          { key: 'lotes', label: 'Lotes', value: t.lotes },
          { key: 'abiertos', label: 'Abiertos (OPEN)', value: t.abiertos },
          { key: 'cerrados', label: 'Cerrados a entrada', value: t.cerrados },
          { key: 'origen_completo', label: 'Con origen declarado completo', value: t.origen_completo },
          { key: 'origen_incompleto', label: 'Con origen incompleto', value: t.origen_incompleto },
          ...porUnidad.map((u) => ({ key: `cantidad_${u.unit}`, label: `Cantidad total en ${u.unit} (${u.n} lote(s) con cantidad)`, value: u.total })),
        ],
        notes: [
          'Las cantidades se totalizan POR UNIDAD. No existe un total único entre unidades distintas.',
          'La cantidad del lote es la producida/registrada, no una existencia ni un saldo: el saldo lo lleva el ledger y no se reconstruye a una fecha aquí.',
          'Una reserva de embarque no es un despacho (P0-029) y no aparece como salida en este reporte.',
        ],
        total_rows: Number(t.lotes),
        next_cursor: cursorOf(out, 'lot_code'),
      };
    }

    if (kind === 'risk') {
      // Todos los lotes, con su ÚLTIMA evaluación si existe. Un lote sin evaluar aparece como «SIN EVALUAR»: omitirlo
      // escondería el desconocido y haría parecer que la organización está evaluada.
      const where = sql`l.organization_id = ${org}`;
      const rows = (await sql<{ lot_code: string; severity: string | null; technical_result: string | null; conclusion: string | null; rule_set_version: string | null; approval_status: string | null; evaluated_at: string | null; evaluaciones: string; revisiones: string }>`
        SELECT l.lot_code, e.severity, e.technical_result, e.conclusion, e.rule_set_version, rs.approval_status,
               to_char(e.evaluated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS evaluated_at,
               (SELECT count(*) FROM risk_evaluations x WHERE x.organization_id = l.organization_id AND x.subject_id = l.id)::text AS evaluaciones,
               (SELECT count(*) FROM risk_reviews rv WHERE rv.organization_id = l.organization_id AND rv.evaluation_id = e.id)::text AS revisiones
        FROM lots l
        LEFT JOIN LATERAL (
          SELECT * FROM risk_evaluations re WHERE re.organization_id = l.organization_id AND re.subject_id = l.id
          ORDER BY re.evaluation_number DESC LIMIT 1
        ) e ON true
        LEFT JOIN risk_rule_sets rs ON rs.version = e.rule_set_version
        WHERE ${where} AND (${after}::text IS NULL OR l.lot_code > ${after}::text)
        ORDER BY l.lot_code LIMIT ${limit}`.execute(db)).rows;
      const t = (await sql<{ lotes: string; evaluados: string; sin_evaluar: string; sin_severidad: string; alto: string; medio: string; bajo: string }>`
        SELECT count(*)::text AS lotes,
               count(*) FILTER (WHERE e.id IS NOT NULL)::text AS evaluados,
               count(*) FILTER (WHERE e.id IS NULL)::text AS sin_evaluar,
               count(*) FILTER (WHERE e.severity IN ('NOT_ASSESSED','UNDETERMINED'))::text AS sin_severidad,
               count(*) FILTER (WHERE e.severity = 'HIGH')::text AS alto,
               count(*) FILTER (WHERE e.severity = 'MEDIUM')::text AS medio,
               count(*) FILTER (WHERE e.severity = 'LOW')::text AS bajo
        FROM lots l LEFT JOIN LATERAL (
          SELECT * FROM risk_evaluations re WHERE re.organization_id = l.organization_id AND re.subject_id = l.id
          ORDER BY re.evaluation_number DESC LIMIT 1
        ) e ON true WHERE ${where}`.execute(db)).rows[0];
      const clasificados = Number(t.alto) + Number(t.medio) + Number(t.bajo);
      const lotes = Number(t.lotes);
      // Caso mixto: si hay clasificados y además sujetos sin clasificar, el conteo se publica SIEMPRE con su base,
      // nunca como distribución de todos los lotes.
      const base = (v: string) => (clasificados === 0
        ? 'DESCONOCIDO (ningún lote clasificado)'
        : `${v} de ${clasificados} lote(s) clasificado(s)${clasificados < lotes ? ` — NO es sobre los ${lotes} del tenant` : ''}`);
      const catalogo = rows.find((r) => r.approval_status)?.approval_status ?? null;
      return {
        columns: [
          { key: 'lot_code', label: 'Lote' },
          { key: 'severity', label: 'Severidad (última)', note: 'NOT_ASSESSED significa DESCONOCIDO: el catálogo de reglas vigente no está aprobado y no define pesos, umbrales ni severidades (D-07).' },
          { key: 'technical_result', label: 'Resultado técnico', note: 'Hallazgos de reglas. Es una dimensión distinta de la severidad y no la implica.' },
          { key: 'conclusion', label: 'Conclusión' },
          { key: 'rule_set_version', label: 'Versión de reglas' },
          { key: 'approval_status', label: 'Catálogo' },
          { key: 'evaluated_at', label: 'Evaluado (UTC)' },
          { key: 'evaluaciones', label: 'Evaluaciones' },
          { key: 'revisiones', label: 'Revisiones' },
        ],
        rows: rows.map((r) => ({
          lot_code: r.lot_code, severity: r.severity ?? 'SIN EVALUAR', technical_result: r.technical_result, conclusion: r.conclusion,
          rule_set_version: r.rule_set_version, approval_status: r.approval_status, evaluated_at: r.evaluated_at,
          evaluaciones: Number(r.evaluaciones), revisiones: Number(r.revisiones ?? 0),
        })),
        totals: [
          { key: 'lotes', label: 'Lotes', value: t.lotes },
          { key: 'evaluados', label: 'Con al menos una evaluación', value: t.evaluados },
          { key: 'sin_evaluar', label: 'Sin evaluación', value: t.sin_evaluar },
          { key: 'sin_severidad', label: 'Evaluados sin severidad asignada (desconocido)', value: t.sin_severidad },
          { key: 'clasificados', label: 'Lotes con severidad asignada (base de la distribución)', value: String(clasificados) },
          { key: 'alto', label: 'Riesgo alto', value: base(t.alto) },
          { key: 'medio', label: 'Riesgo medio', value: base(t.medio) },
          { key: 'bajo', label: 'Riesgo bajo', value: base(t.bajo) },
        ],
        notes: [
          'Un lote sin evaluar aparece en la tabla como «SIN EVALUAR». No se omite: omitirlo escondería lo desconocido.',
          `La severidad la decide el catálogo de reglas de riesgo${catalogo ? ` (vigente: ${catalogo})` : ''}. Mientras el catálogo no esté APROBADO no define pesos, umbrales, puntuaciones ni severidades, y el motor escribe NOT_ASSESSED para TODA evaluación: es la decisión D-07, no un efecto de otras historias.`,
          'Verificar una mitigación (P0-021, implementada) NO asigna severidad ni produce una conclusión favorable: entra en el resultado TÉCNICO del factor correspondiente, que es otra dimensión.',
          'Cuando hay lotes clasificados y lotes sin clasificar a la vez, los conteos por severidad se publican sobre la base de los clasificados, nunca como distribución de todos los lotes del tenant.',
          'La severidad es un resultado técnico interno; no es una conclusión jurídica ni acredita conformidad EUDR.',
        ],
        total_rows: lotes,
        next_cursor: cursorOf(rows.map((r) => ({ lot_code: r.lot_code })), 'lot_code'),
      };
    }

    if (kind === 'traceability') {
      // Completitud del origen declarado, lote a lote, desde las entradas reales (lot_inputs.origin_known).
      const where = sql`l.organization_id = ${org}`;
      const rows = (await sql<{ lot_code: string; origin_status: string; entradas: string; origen_conocido: string; origen_desconocido: string; entregas: string; parcelas: string }>`
        SELECT l.lot_code, l.origin_status,
               count(li.id)::text AS entradas,
               count(li.id) FILTER (WHERE li.origin_known)::text AS origen_conocido,
               count(li.id) FILTER (WHERE NOT li.origin_known)::text AS origen_desconocido,
               count(DISTINCT r.delivery_id)::text AS entregas,
               count(DISTINCT do2.plot_id)::text AS parcelas
        FROM lots l
        LEFT JOIN lot_inputs li ON li.lot_id = l.id AND li.organization_id = l.organization_id
          AND NOT EXISTS (SELECT 1 FROM lot_input_releases lr WHERE lr.input_id = li.id)
        LEFT JOIN receptions r ON r.id = li.reception_id AND r.organization_id = l.organization_id
        LEFT JOIN delivery_origins do2 ON do2.delivery_id = r.delivery_id AND do2.organization_id = l.organization_id
        WHERE ${where} AND (${after}::text IS NULL OR l.lot_code > ${after}::text)
        GROUP BY l.id, l.lot_code, l.origin_status ORDER BY l.lot_code LIMIT ${limit}`.execute(db)).rows;
      const t = (await sql<{ lotes: string; completos: string; incompletos: string; sin_entradas: string }>`
        SELECT count(*)::text AS lotes, count(*) FILTER (WHERE l.origin_status = 'COMPLETE')::text AS completos,
               count(*) FILTER (WHERE l.origin_status = 'INCOMPLETE')::text AS incompletos,
               count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM lot_inputs li WHERE li.lot_id = l.id AND li.organization_id = l.organization_id
                 AND NOT EXISTS (SELECT 1 FROM lot_input_releases lr WHERE lr.input_id = li.id)))::text AS sin_entradas
        FROM lots l WHERE ${where}`.execute(db)).rows[0];
      const lotes = Number(t.lotes);
      const out = rows.map((r) => ({ lot_code: r.lot_code, origin_status: r.origin_status, entradas: Number(r.entradas), origen_conocido: Number(r.origen_conocido), origen_desconocido: Number(r.origen_desconocido), entregas: Number(r.entregas), parcelas: Number(r.parcelas) }));
      return {
        columns: [
          { key: 'lot_code', label: 'Lote' },
          { key: 'origin_status', label: 'Origen declarado' },
          { key: 'entradas', label: 'Entradas vigentes' },
          { key: 'origen_conocido', label: 'Entradas con origen conocido' },
          { key: 'origen_desconocido', label: 'Entradas con origen desconocido', note: 'Origen desconocido sigue siendo desconocido: no se completa ni se estima.' },
          { key: 'entregas', label: 'Entregas enlazadas', note: 'Exige delivery:read: contar entregas es leer el dominio de entregas.' },
          { key: 'parcelas', label: 'Parcelas declaradas como origen', note: 'Exige plot:read: contar parcelas es leer el dominio de parcelas.' },
        ],
        rows: out,
        totals: [
          { key: 'lotes', label: 'Lotes', value: t.lotes },
          { key: 'completos', label: 'Con origen declarado completo', value: t.completos },
          { key: 'incompletos', label: 'Con origen incompleto', value: t.incompletos },
          { key: 'sin_entradas', label: 'Sin entradas vigentes', value: t.sin_entradas },
          { key: 'completitud', label: 'Completitud de origen declarado (%)', value: lotes === 0 ? 'SIN DENOMINADOR (no hay lotes)' : ((Number(t.completos) * 100) / lotes).toFixed(1) },
        ],
        notes: [
          'Mide ORIGEN DECLARADO, no verificación de campo ni conformidad EUDR.',
          'Sin lotes, la completitud sale SIN DENOMINADOR: no es 0 % ni 100 %.',
          'Las parcelas se cuentan por su vínculo declarado con la entrega; este reporte no incluye coordenadas.',
        ],
        total_rows: lotes,
        next_cursor: cursorOf(out, 'lot_code'),
      };
    }

    // kind === 'dd'
    const where = sql`c.organization_id = ${org}`;
    const rows = (await sql<{ case_number: string; subject_type: string; lot_code: string | null; readiness: string | null; snapshot_number: number | null; captured_at: string | null; instantaneas: string; revisiones: string; exportaciones: string }>`
      SELECT c.case_number, c.subject_type, l.lot_code, s.readiness, s.snapshot_number,
             to_char(s.captured_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS captured_at,
             (SELECT count(*) FROM dd_snapshots x WHERE x.organization_id = c.organization_id AND x.case_id = c.id)::text AS instantaneas,
             (SELECT count(*) FROM dd_reviews rv JOIN dd_snapshots sx ON sx.id = rv.snapshot_id WHERE rv.organization_id = c.organization_id AND sx.case_id = c.id)::text AS revisiones,
             (SELECT count(*) FROM dd_exports ex JOIN dd_snapshots sx ON sx.id = ex.snapshot_id WHERE ex.organization_id = c.organization_id AND sx.case_id = c.id)::text AS exportaciones
      FROM dd_cases c
      LEFT JOIN lots l ON l.id = c.subject_id AND l.organization_id = c.organization_id
      LEFT JOIN LATERAL (
        SELECT * FROM dd_snapshots ds WHERE ds.organization_id = c.organization_id AND ds.case_id = c.id
        ORDER BY ds.snapshot_number DESC LIMIT 1
      ) s ON true
      WHERE ${where} AND (${after}::text IS NULL OR c.case_number > ${after}::text)
      ORDER BY c.case_number LIMIT ${limit}`.execute(db)).rows;
    const t = (await sql<{ expedientes: string; ready: string; in_progress: string; blocked: string; sin_instantanea: string; exportados: string }>`
      SELECT count(*)::text AS expedientes,
             count(*) FILTER (WHERE s.readiness = 'READY')::text AS ready,
             count(*) FILTER (WHERE s.readiness = 'IN_PROGRESS')::text AS in_progress,
             count(*) FILTER (WHERE s.readiness = 'BLOCKED')::text AS blocked,
             count(*) FILTER (WHERE s.id IS NULL)::text AS sin_instantanea,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM dd_exports ex JOIN dd_snapshots sx ON sx.id = ex.snapshot_id
               WHERE ex.organization_id = c.organization_id AND sx.case_id = c.id AND ex.kind = 'DD_PACKAGE'))::text AS exportados
      FROM dd_cases c LEFT JOIN LATERAL (
        SELECT * FROM dd_snapshots ds WHERE ds.organization_id = c.organization_id AND ds.case_id = c.id
        ORDER BY ds.snapshot_number DESC LIMIT 1
      ) s ON true WHERE ${where}`.execute(db)).rows[0];
    const out = rows.map((r) => ({
      case_number: r.case_number, subject: r.lot_code ?? r.subject_type,
      readiness: r.readiness ?? 'SIN INSTANTÁNEA', snapshot_number: r.snapshot_number, captured_at: r.captured_at,
      instantaneas: Number(r.instantaneas), revisiones: Number(r.revisiones), exportaciones: Number(r.exportaciones),
    }));
    return {
      columns: [
        { key: 'case_number', label: 'Expediente' },
        { key: 'subject', label: 'Sujeto', note: 'Exige lot:read: el sujeto del expediente es un lote y se identifica por su código.' },
        { key: 'readiness', label: 'Preparación (última instantánea)', note: 'READY es preparación INTERNA; no es conformidad ni presentación de DDS.' },
        { key: 'snapshot_number', label: 'Instantánea nº' },
        { key: 'captured_at', label: 'Capturada (UTC)' },
        { key: 'instantaneas', label: 'Instantáneas' },
        { key: 'revisiones', label: 'Revisiones' },
        { key: 'exportaciones', label: 'Exportaciones', note: 'EXPORTED es descarga del paquete, no presentación oficial.' },
      ],
      rows: out,
      totals: [
        { key: 'expedientes', label: 'Expedientes', value: t.expedientes },
        { key: 'ready', label: 'READY (preparación interna)', value: t.ready },
        { key: 'in_progress', label: 'IN_PROGRESS', value: t.in_progress },
        { key: 'blocked', label: 'BLOCKED', value: t.blocked },
        { key: 'sin_instantanea', label: 'Sin instantánea', value: t.sin_instantanea },
        { key: 'exportados', label: 'Con paquete DD exportado', value: t.exportados },
      ],
      notes: [
        'Contar expedientes BLOCKED es un conteo observado y se publica: lo que no se deduce de él es conformidad.',
        'READY indica preparación interna y EXPORTED indica descarga: ninguno significa presentación oficial de DDS.',
        'Hoy READY es inalcanzable por dependencias abiertas (catálogo de riesgo sin aprobar D-07, D-05, perfil jurídico P1-005); un 0 en READY no mide el desempeño del equipo.',
      ],
      total_rows: Number(t.expedientes),
      next_cursor: cursorOf(out, 'case_number'),
    };
  }

  /** Recorre todas las páginas DENTRO de la misma instantánea, hasta el tope declarado. */
  private async buildAll(db: Db, ctx: TenantContext, d: Definition, period: Period) {
    const first = await this.build(db, ctx, d.kind, period, { after: null, limit: PAGE_MAX });
    const rows = [...first.rows];
    let cursor = first.next_cursor;
    while (cursor && rows.length < EXPORT_MAX_ROWS) {
      const next = await this.build(db, ctx, d.kind, period, { after: cursor, limit: PAGE_MAX });
      rows.push(...next.rows);
      cursor = next.next_cursor;
    }
    return { ...first, rows, truncated: Boolean(cursor) };
  }

  // ---------------------------------------------------------------- endpoints

  @Get()
  async catalog(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    const ctx = await this.ctx(user, orgId, 'report:read');
    return {
      catalog_version: REPORT_CATALOG_VERSION,
      source: 'S1 §97 «Sprint 11 — Reporting». Contrato: docs/decisiones/P0-030-REPORTES.md',
      scope_note: SCOPE_NOTE,
      assigned_scope_note: ASSIGNED_SCOPE_NOTE,
      cross_domain_note:
        'Un reporte exige el permiso de CADA dominio del que muestra datos, conteos o totales, no solo el de la entidad que encabeza las filas: ' +
        'leer productores no autoriza a conocer cuántas parcelas o entregas tienen.',
      can_export: has(ctx, 'report:export'),
      reports: ENTITY_REPORTS.map((d) => ({
        kind: d.kind, title: d.title, source: d.source, requires: d.requires, why: d.why,
        period_applies: d.period_applies, period_note: d.period_note,
        available: missingPermissions(ctx.permissions, d.requires).length === 0,
        missing: missingPermissions(ctx.permissions, d.requires),
      })),
      geojson: {
        kind: 'plots_geojson', title: 'Exportación GeoJSON de parcelas', source: 'S1 §97 «GeoJSON export»',
        requires: GEOJSON_REQUIRES, why: GEOJSON_WHY,
        available: missingPermissions(ctx.permissions, GEOJSON_REQUIRES).length === 0,
        missing: missingPermissions(ctx.permissions, GEOJSON_REQUIRES),
        notice: GEOJSON_NOTICE, regulatory_profile: GEOJSON_REGULATORY,
      },
    };
  }

  /**
   * D-05.A - Exportacion con PERFIL DE DESTINO, **por productor** (la variante de nivel de productor que
   * documenta el destino). Convive con la exportacion tecnica de abajo, que NO se toca: una entrega lo
   * registrado tal cual, esta entrega lo que el perfil deja preparar.
   *
   * Lo que esta exportacion NO hace, a proposito:
   * - **No exporta `ProducerName`**: es dato personal y la propiedad es opcional en el destino.
   * - **No anade el periodo de produccion.** El Art. 9(1)(d) lo exige junto a la geolocalizacion, pero vive en
   *   el contexto operativo (la entrega), no en la parcela, y no hay contrato que diga como viaja en este
   *   archivo. Inventar una propiedad seria fabricar el dato.
   * - **No presenta nada ante nadie.** Preparar un archivo no es declararlo.
   */
  @Get('plots/geojson/profile')
  async geojsonProfile(
    @CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('producer_id') producerId: string | undefined,
    @Req() req: AuthedRequest, @Res() res: Response,
  ) {
    const ctx = await this.ctx(user, orgId, 'report:read');
    const faltan = missingPermissions(ctx.permissions, GEOJSON_REQUIRES);
    if (faltan.length) throw forbidden('PERMISSION_DENIED', denialMessage(GEOJSON_REQUIRES, faltan, GEOJSON_WHY));
    if (!producerId || !/^[0-9a-f-]{36}$/i.test(producerId)) {
      throw new AppError(400, 'PRODUCER_REQUIRED', 'Indica el productor: esta exportacion es por productor, como la variante de nivel de productor del destino.', [{ field: 'producer_id', reason: 'REQUIRED' }]);
    }
    const org = ctx.organizationId;
    const prod = await this.db.selectFrom('producers').select(['id', 'producer_code'])
      .where('organization_id', '=', org).where('id', '=', producerId).executeTakeFirst();
    if (!prod) throw notFound();

    const rows = await this.snapshot(async (trx) => (await sql<{
      plot_code: string; version_id: string; geometry: unknown; geometry_type: string;
      profile_status: string | null; exportable: boolean | null; area_value_ha: string | null;
      profile_version: string | null; evaluated_at: Date | null; failed: unknown;
    }>`
      SELECT pl.plot_code, v.id AS version_id,
             ST_AsGeoJSON(v.geometry, ${PROFILE_DECIMALS})::jsonb AS geometry, v.geometry_type,
             e.status AS profile_status, e.exportable, e.area_value_ha::text,
             e.profile_version, e.evaluated_at,
             (SELECT jsonb_agg(c->'reason_code') FROM jsonb_array_elements(e.checks) c WHERE c->>'outcome' = 'FAIL') AS failed
      FROM plots pl
      JOIN plot_versions v ON v.id = pl.current_version_id AND v.organization_id = pl.organization_id
      LEFT JOIN LATERAL (
        SELECT * FROM geo_profile_evaluations ge
        WHERE ge.organization_id = pl.organization_id AND ge.plot_version_id = v.id
        ORDER BY ge.evaluated_at DESC LIMIT 1) e ON true
      WHERE pl.organization_id = ${org} AND pl.producer_id = ${producerId} AND pl.deleted_at IS NULL
      ORDER BY pl.plot_code LIMIT ${EXPORT_MAX_ROWS}`.execute(trx)).rows);

    const exportables = rows.filter((r) => r.exportable === true && r.geometry);
    // Lo que NO se exporta se LISTA con su motivo: omitir en silencio haria parecer completo un archivo que no lo es.
    const excluidas = rows.filter((r) => !(r.exportable === true && r.geometry)).map((r) => ({
      plot_code: r.plot_code,
      reason_code: r.geometry === null ? 'NO_GEOMETRY' : r.profile_status === null ? 'PROFILE_NOT_EVALUATED' : r.profile_status,
      reason: r.geometry === null
        ? 'La version vigente no tiene geometria: una superficie declarada no es una ubicacion.'
        : r.profile_status === null
          ? 'El perfil no se ha evaluado para la version vigente de esta parcela. NO evaluada no es lo mismo que no cumple.'
          : PROFILE_STATUS_LABEL[r.profile_status] ?? r.profile_status,
      failed_checks: (r.failed as string[] | null) ?? [],
      profile_evaluated_at: r.evaluated_at,
    }));

    const generatedAt = new Date().toISOString();
    const collection = {
      type: 'FeatureCollection',
      features: exportables.map((r) => ({
        type: 'Feature',
        geometry: r.geometry,
        properties: {
          // Propiedades del destino. ProducerName NO va: es dato personal y alli es opcional.
          ProductionPlace: r.plot_code,
          // ProducerCountry NO se emite: Terra Link no guarda pais de produccion por productor (hay provincia y
          // canton, que no es lo mismo). Es opcional en esta variante, y deducirlo del pais de la organizacion
          // seria inventarlo. Se declara abajo en vez de rellenarlo.
          // `Area` es la propiedad que el destino documenta para los PUNTOS, y va como NUMERO, no como texto.
          ...(r.geometry_type === 'POINT' && r.area_value_ha !== null ? { Area: Number(r.area_value_ha) } : {}),
        },
      })),
      terra_link: {
        format: GEOJSON_PROFILE_FORMAT, profile: { id: GEO_PROFILE.id, version: exportables[0]?.profile_version ?? GEO_PROFILE.version },
        source: {
          service_version: PROFILE_SOURCE.service_version, document_version: PROFILE_SOURCE.document_version,
          page_date: PROFILE_SOURCE.page_date, verification: PROFILE_SOURCE.verification,
        },
        organization_id: org, producer_code: prod.producer_code, generated_at: generatedAt,
        counts: { parcelas: rows.length, exportadas: exportables.length, no_exportables: excluidas.length },
        limit: { max_features: EXPORT_MAX_ROWS, truncated: rows.length >= EXPORT_MAX_ROWS },
        not_exported: excluidas,
        decimals: {
          written: PROFILE_DECIMALS,
          note: 'Seis decimales es FORMATO de intercambio: la norma exige al menos seis digitos decimales y el destino trunca a seis. NO es prueba de precision de captura, y los ceros finales no anaden informacion.',
        },
        producer_country_note: 'ProducerCountry NO se emite: Terra Link no registra pais de produccion por productor (guarda provincia y canton). Es opcional en la variante de nivel de productor; deducirlo del pais de la organizacion seria inventar el dato.',
        producer_name_note: 'ProducerName NO se exporta: es dato personal y el destino lo admite como opcional. Incluirlo seria una decision de producto y de proteccion de datos.',
        production_period_note: 'El periodo de produccion que exige el Art. 9(1)(d) NO viaja en este archivo: vive en el contexto operativo (entregas) y no hay contrato que diga como representarlo aqui.',
        notice: GEOJSON_PROFILE_NOTICE,
        snapshot: SNAPSHOT_NOTE,
        coverage: await coverageFor(this.db, ctx.organizationId),
      },
    };
    const body = Buffer.from(JSON.stringify(collection, null, 2), 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    await this.audit.record(this.db, {
      organizationId: org, actorUserId: user.id, action: 'report.geojson_profile_export', entityType: 'producer', entityId: producerId,
      requestId: req.requestId, result: 'SUCCESS',
      after: { format: GEOJSON_PROFILE_FORMAT, sha256, features: exportables.length, not_exported: excluidas.length, generated_at: generatedAt },
    });
    res.setHeader('Content-Type', 'application/geo+json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="parcelas-perfil-${prod.producer_code}-${generatedAt.slice(0, 10)}.geojson"`);
    res.setHeader('X-Content-Sha256', sha256);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  }

  @Get('plots/geojson')
  async geojson(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Req() req: AuthedRequest, @Res() res: Response) {
    // Exportación de colección (S1 §97). Reutiliza la capacidad técnica de P0-009 —misma geometría guardada, mismas
    // propiedades, sin reproyectar ni recortar— y le añade el alcance y los permisos del reporte.
    const ctx = await this.ctx(user, orgId, 'report:read');
    const faltan = missingPermissions(ctx.permissions, GEOJSON_REQUIRES);
    if (faltan.length) throw forbidden('PERMISSION_DENIED', denialMessage(GEOJSON_REQUIRES, faltan, GEOJSON_WHY));
    const org = ctx.organizationId;
    const { rows, t } = await this.snapshot(async (trx) => ({
      rows: (await sql<{ plot_code: string; producer_code: string; version_id: string; version_number: number; geometry: unknown; geometry_type: string; survey_method: string; validation_status: string; technically_valid: boolean | null; area_declared_ha: string | null; area_calculated_ha: string | null; geometry_hash: string | null; source_import_sha256: string | null }>`
        SELECT pl.plot_code, pr.producer_code, v.id AS version_id, v.version_number, ST_AsGeoJSON(v.geometry, 17)::jsonb AS geometry,
               v.geometry_type, v.survey_method, v.validation_status, (ST_IsValidDetail(v.geometry)).valid AS technically_valid,
               v.area_declared_ha::text, v.area_calculated_ha::text, v.geometry_hash, gi.sha256 AS source_import_sha256
        FROM plots pl
        JOIN producers pr ON pr.id = pl.producer_id AND pr.organization_id = pl.organization_id
        JOIN plot_versions v ON v.id = pl.current_version_id AND v.organization_id = pl.organization_id
        LEFT JOIN geometry_imports gi ON gi.id = v.source_import_id AND gi.organization_id = v.organization_id
        WHERE pl.organization_id = ${org} AND pl.deleted_at IS NULL AND v.geometry IS NOT NULL
        ORDER BY pl.plot_code LIMIT ${EXPORT_MAX_ROWS}`.execute(trx)).rows,
      t: (await sql<{ parcelas: string; solo_superficie: string; sin_version: string }>`
        SELECT count(*)::text AS parcelas,
               count(*) FILTER (WHERE v.id IS NOT NULL AND v.geometry IS NULL)::text AS solo_superficie,
               count(*) FILTER (WHERE pl.current_version_id IS NULL)::text AS sin_version
        FROM plots pl LEFT JOIN plot_versions v ON v.id = pl.current_version_id AND v.organization_id = pl.organization_id
        WHERE pl.organization_id = ${org} AND pl.deleted_at IS NULL`.execute(trx)).rows[0],
    }));
    const generatedAt = new Date().toISOString();
    const collection = {
      type: 'FeatureCollection',
      features: rows.map((r) => ({
        type: 'Feature',
        geometry: r.geometry,
        properties: {
          plot_code: r.plot_code, producer_code: r.producer_code, version_id: r.version_id, version_number: r.version_number,
          geometry_type: r.geometry_type, survey_method: r.survey_method, validation_status: r.validation_status,
          technically_valid: r.technically_valid, area_declared_ha: r.area_declared_ha, area_calculated_ha: r.area_calculated_ha,
          geometry_hash: r.geometry_hash, source_import_sha256: r.source_import_sha256,
          crs: 'WGS84 longitud/latitud (RFC 7946)',
        },
      })),
      // Miembro ajeno (RFC 7946 §6.1 lo permite): declara qué NO va dentro, en vez de dejar un archivo que parezca completo.
      terra_link: {
        format: GEOJSON_EXPORT_FORMAT, catalog_version: REPORT_CATALOG_VERSION, organization_id: org, generated_at: generatedAt,
        counts: { parcelas_vigentes: Number(t.parcelas), exportadas: rows.length, solo_superficie_declarada: Number(t.solo_superficie), sin_version_vigente: Number(t.sin_version) },
        limit: { max_features: EXPORT_MAX_ROWS, truncated: rows.length >= EXPORT_MAX_ROWS },
        omitted_note: 'Las parcelas sin geometría NO se exportan y NO se inventan: una superficie declarada no es una ubicación. Su número se declara arriba.',
        validation_note: 'validation_status = NOT_VALIDATED significa SIN EVALUAR, no inválida. technically_valid es el dictamen geométrico de PostGIS, no la validación GIS de negocio (P0-010, pendiente de D-05).',
        notice: GEOJSON_NOTICE,
        regulatory_profile: { status: 'PENDING', depends_on: 'D-05.B', technical_profile: 'EUDR_GEO_V1 1.0.0 (D-05.A, provisional)', note: GEOJSON_REGULATORY },
        snapshot: SNAPSHOT_NOTE,
        recalculation: EXPORT_RECALC_NOTE,
        coverage: await coverageFor(this.db, ctx.organizationId),
      },
    };
    const body = Buffer.from(JSON.stringify(collection, null, 2), 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    await this.audit.record(this.db, {
      organizationId: org, actorUserId: user.id, action: 'report.geojson_export', entityType: 'report', entityId: null, requestId: req.requestId, result: 'SUCCESS',
      after: { format: GEOJSON_EXPORT_FORMAT, catalog_version: REPORT_CATALOG_VERSION, sha256, features: rows.length, omitted_without_geometry: Number(t.solo_superficie) + Number(t.sin_version), generated_at: generatedAt },
    });
    res.setHeader('Content-Type', 'application/geo+json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="parcelas-${generatedAt.slice(0, 10)}.geojson"`);
    res.setHeader('X-Content-Sha256', sha256);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  }

  @Get(':kind')
  async entity(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('kind') kind: string, @Query() q: ReportPageDto) {
    const ctx = await this.ctx(user, orgId, 'report:read');
    const d = this.def(kind);
    this.requireAll(ctx, d);
    const period: Period = { from: d.period_applies ? q.from ?? null : null, to: d.period_applies ? q.to ?? null : null };
    const limit = Math.min(q.limit ?? PAGE_DEFAULT, PAGE_MAX);
    const built = await this.snapshot((trx) => this.build(trx, ctx, d.kind, period, { after: q.cursor ?? null, limit }));
    return {
      ...this.meta(period, new Date().toISOString(), await coverageFor(this.db, orgId)),
      kind: d.kind, title: d.title, source: d.source, requires: d.requires, why: d.why,
      period_applies: d.period_applies, period_note: d.period_note,
      can_export: has(ctx, 'report:export'),
      ...built,
      page: { limit, cursor: q.cursor ?? null, next_cursor: built.next_cursor, key: d.key },
      returned_rows: built.rows.length,
      has_more: built.next_cursor !== null,
    };
  }

  @Get(':kind/export')
  async exportEntity(
    @CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('kind') kind: string,
    @Req() req: AuthedRequest, @Query() q: ReportPageDto, @Res() res: Response,
  ) {
    const ctx = await this.ctx(user, orgId, 'report:export');
    const d = this.def(kind);
    this.requireAll(ctx, d);
    const period: Period = { from: d.period_applies ? q.from ?? null : null, to: d.period_applies ? q.to ?? null : null };
    // La exportación recorre TODAS las páginas dentro de una sola instantánea: el archivo cubre el conjunto completo.
    const built = await this.snapshot((trx) => this.buildAll(trx, ctx, d, period));
    const org = await this.db.selectFrom('organizations').select('name').where('id', '=', ctx.organizationId).executeTakeFirstOrThrow();
    const generatedAt = new Date().toISOString();
    const m = this.meta(period, generatedAt, await coverageFor(this.db, orgId));
    const head: Array<[string, string]> = [
      ['formato', REPORT_EXPORT_FORMAT], ['catalogo', REPORT_CATALOG_VERSION], ['reporte', d.title], ['fuente', d.source],
      ['organizacion', org.name], ['organizacion_id', ctx.organizationId],
      ['permisos_exigidos', d.requires.join(' ')],
      ['periodo_desde', period.from ?? 'no aplica'], ['periodo_hasta', period.to ?? 'no aplica'], ['periodo_nota', d.period_note],
      ['generado', generatedAt], ['recalculo', EXPORT_RECALC_NOTE], ['instantanea', m.snapshot_note], ['limite_exportacion', m.export_note],
      ['fechas', `${m.time_basis.period_bounds} ${m.time_basis.civil_dates}`],
      ['alcance', m.scope_note], ['alcance_asignado', m.assigned_scope_note], ['interpretacion', m.interpretation_note],
      ['cobertura_historica', coverageLine(m.coverage)],
      ['filas', `${built.rows.length} de ${built.total_rows}${built.truncated ? ` (TRUNCADO en el tope de ${EXPORT_MAX_ROWS}; los totales cubren el conjunto completo)` : ' (conjunto completo)'}`],
      ...built.notes.map((n, i) => [`nota_${i + 1}`, n] as [string, string]),
      ...built.totals.map((t) => [`total_${t.key}`, `${t.label}: ${t.value}`] as [string, string]),
      ['nota_formato', 'Formato local provisional. No acredita conformidad EUDR ni aprobación de ninguna autoridad.'],
    ];
    const lines = [
      ...head.map(([k, v]) => `# ${csvCell(k)},${csvCell(v)}`),
      built.columns.map((c) => csvCell(c.key)).join(','),
      ...built.rows.map((r) => built.columns.map((c) => csvCell(r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key]))).join(',')),
    ];
    const body = Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    await this.audit.record(this.db, {
      organizationId: ctx.organizationId, actorUserId: user.id, action: 'report.export', entityType: 'report', entityId: null, requestId: req.requestId, result: 'SUCCESS',
      after: { format_version: REPORT_EXPORT_FORMAT, catalog_version: REPORT_CATALOG_VERSION, report: d.kind, sha256, period, rows: built.rows.length, total_rows: built.total_rows, truncated: built.truncated, generated_at: generatedAt },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-${d.kind}-${generatedAt.slice(0, 10)}.csv"`);
    res.setHeader('X-Content-Sha256', sha256);
    res.send(body);
  }
}
