import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/schema';
import type { TenantContext } from '../authz/authorization.service';
import { GEO_PROFILE, STATUS_LABEL, type ProfileStatus } from '../plots/geo-profile';

// «Evaluación geográfica técnica actual» del expediente (requisito original GEOLOCATION_PROFILE, implementación pendiente I1–I4).
//
// QUÉ ES: una CONSULTA de lo que hoy dicen las evaluaciones del perfil técnico `EUDR_GEO_V1` (tabla `geo_profile_evaluations`, append-only) sobre las
// parcelas de origen del lote del expediente. Reutiliza el evaluador y sus resultados: este módulo SOLO LEE; no evalúa, no recalcula y no escribe.
//
// QUÉ NO ES: no es contenido de ninguna instantánea. No entra en `DdContent`, en su hash ni en sus secciones, de modo que añadirlo NO modifica las
// instantáneas existentes ni las declara obsoletas. Los mecanismos que detectan cambios materiales en sus fuentes (`isStale`) no se tocan. Tampoco es una
// conclusión regulatoria ni cumple el requisito `GEOLOCATION_PROFILE`, que sigue pendiente de D-05.B y de la definición de «satisfecho». Si más adelante el
// resultado debe entrar al contenido formal de la instantánea, será mediante un contrato versionado y una transición explícita.

export type Vigencia = 'CURRENT' | 'OBSOLETE' | 'ABSENT';
export type PendienteKind = 'ABSENT' | 'OBSOLETE' | 'NOT_EVALUABLE';

export const GEO_PANEL_NOTE = 'Consulta ACTUAL de las evaluaciones del perfil técnico de destino. No forma parte del contenido de ninguna instantánea, no la modifica ni cambia su frescura, y no es una conclusión regulatoria: el requisito GEOLOCATION_PROFILE sigue pendiente (D-05.B).';
export const VIGENCIA_LABEL: Record<Vigencia, string> = { CURRENT: 'Vigente', OBSOLETE: 'Obsoleta', ABSENT: 'Sin evaluación' };
export const REASON_LABEL: Record<string, string> = {
  NO_GEOMETRY_VERSION: 'La parcela no tiene versión geométrica que evaluar.',
  NEVER_EVALUATED: 'La versión geométrica vigente nunca se evaluó con el perfil.',
  GEOMETRY_VERSION_CHANGED: 'La geometría cambió: la última evaluación es de una versión anterior.',
  PROFILE_VERSION_CHANGED: 'El perfil técnico tiene una versión nueva: la evaluación es de la anterior.',
};
export const NEXT_ACTION: Record<string, string> = {
  CAPTURE_GEOMETRY: 'Registrar la geometría de la parcela desde su ficha.',
  EVALUATE_PROFILE: 'Evaluar el perfil técnico de la versión vigente desde la ficha de la parcela.',
  REVIEW_RESULT: 'Revisar el resultado: hay una discrepancia que decide una persona.',
  CORRECT_GEOMETRY: 'Corregir mediante una versión geométrica nueva (la geometría guardada no se repara).',
  COMPLETE_DATA: 'Completar el dato que falta (por ejemplo, la superficie de un punto) y volver a evaluar.',
  NONE: 'Sin acción técnica pendiente. Esto no cumple el requisito regulatorio.',
};

interface EvalRow {
  id: string; plot_id: string; plot_version_id: string; version_number: number; profile_id: string; profile_version: string;
  source_service_version: string; source_document_version: string; source_page_date: string; status: ProfileStatus;
  checks: Array<{ code: string; outcome: string; reason_code?: string | null; message?: string }>; area_basis: string; area_value_ha: string | null; evaluated_at: string;
}

export async function geoEvaluationPanel(db: Kysely<Database>, ctx: TenantContext, caseRow: { id: string; case_number: string; subject_id: string }, plotIds: string[]) {
  const orgId = ctx.organizationId;
  const detail = ctx.permissions.includes('plot:read_geometry'); // explicación y superficie: mismo permiso que la geometría
  const canEvaluate = ctx.permissions.includes('plot:evaluate_gis');
  const plots = plotIds.length ? (await sql<{ plot_id: string; plot_code: string; version_id: string | null; version_number: number | null; geometry_type: string | null; geometry_hash: string | null }>`
    SELECT p.id AS plot_id, p.plot_code, v.id AS version_id, v.version_number, v.geometry_type, v.geometry_hash
    FROM plots p LEFT JOIN plot_versions v ON v.id = p.current_version_id AND v.organization_id = p.organization_id
    WHERE p.organization_id = ${orgId} AND p.id = ANY(${plotIds}::uuid[]) ORDER BY p.plot_code`.execute(db)).rows : [];
  const evals = plotIds.length ? (await sql<EvalRow>`
    SELECT e.id, e.plot_id, e.plot_version_id, v.version_number, e.profile_id, e.profile_version, e.source_service_version, e.source_document_version,
           e.source_page_date::text AS source_page_date, e.status, e.checks, e.area_basis, e.area_value_ha::text AS area_value_ha, e.evaluated_at
    FROM geo_profile_evaluations e JOIN plot_versions v ON v.id = e.plot_version_id AND v.organization_id = e.organization_id
    WHERE e.organization_id = ${orgId} AND e.plot_id = ANY(${plotIds}::uuid[]) ORDER BY e.evaluated_at DESC, e.id DESC`.execute(db)).rows : [];
  const snap = (await sql<{ snapshot_number: number; captured_at: string; requirements: Array<{ code: string; status: string }> }>`
    SELECT snapshot_number, captured_at, requirements FROM dd_snapshots WHERE organization_id = ${orgId} AND case_id = ${caseRow.id} ORDER BY snapshot_number DESC LIMIT 1`.execute(db)).rows[0] ?? null;

  const items = plots.map((p) => {
    const mine = evals.filter((e) => e.plot_id === p.plot_id);
    let vigencia: Vigencia; let reason: string; let shown: EvalRow | null = null;
    if (!p.version_id) { vigencia = 'ABSENT'; reason = 'NO_GEOMETRY_VERSION'; }
    else {
      const current = mine.find((e) => e.plot_version_id === p.version_id && e.profile_version === GEO_PROFILE.version);
      if (current) { vigencia = 'CURRENT'; reason = 'CURRENT'; shown = current; }
      else {
        const sameVersion = mine.find((e) => e.plot_version_id === p.version_id);
        if (sameVersion) { vigencia = 'OBSOLETE'; reason = 'PROFILE_VERSION_CHANGED'; shown = sameVersion; }
        else if (mine.length) { vigencia = 'OBSOLETE'; reason = 'GEOMETRY_VERSION_CHANGED'; shown = mine[0]; }
        else { vigencia = 'ABSENT'; reason = 'NEVER_EVALUATED'; }
      }
    }
    const status = shown?.status ?? null;
    const next = !p.version_id ? 'CAPTURE_GEOMETRY'
      : vigencia !== 'CURRENT' ? 'EVALUATE_PROFILE'
        : status === 'REVIEW_REQUIRED' ? 'REVIEW_RESULT'
          : status === 'DOES_NOT_MEET' ? 'CORRECT_GEOMETRY'
            : status === 'NOT_EVALUABLE' ? 'COMPLETE_DATA' : 'NONE';
    const kind: PendienteKind | null = vigencia === 'ABSENT' ? 'ABSENT' : vigencia === 'OBSOLETE' ? 'OBSOLETE' : status === 'NOT_EVALUABLE' ? 'NOT_EVALUABLE' : null;
    return {
      plot_id: p.plot_id, plot_code: p.plot_code,
      geometry: p.version_id ? { version_id: p.version_id, version_number: p.version_number, geometry_type: p.geometry_type } : null,
      vigencia, vigencia_label: VIGENCIA_LABEL[vigencia], reason: reason === 'CURRENT' ? null : reason, reason_label: reason === 'CURRENT' ? null : REASON_LABEL[reason],
      evaluation: shown ? {
        id: shown.id, evaluated_version_number: shown.version_number, profile: { id: shown.profile_id, version: shown.profile_version },
        source: { service_version: shown.source_service_version, document_version: shown.source_document_version, page_date: shown.source_page_date },
        status: shown.status, label: STATUS_LABEL[shown.status], evaluated_at: shown.evaluated_at,
        // Detalle solo con permiso de geometría: la explicación y la superficie salen de la geometría.
        explanation: detail ? shown.checks.filter((c) => c.outcome !== 'PASS' && c.outcome !== 'NOT_APPLICABLE').map((c) => ({ code: c.code, outcome: c.outcome, reason_code: c.reason_code ?? null, message: c.message ?? '' })) : null,
        area: detail ? { basis: shown.area_basis, value_ha: shown.area_value_ha } : null,
      } : null,
      detail_restricted: !detail,
      next_action: { code: next, message: NEXT_ACTION[next], can_act: (next === 'EVALUATE_PROFILE' || next === 'REVIEW_RESULT') ? canEvaluate : next === 'CAPTURE_GEOMETRY' ? ctx.permissions.includes('plot:update') : null },
      pending: kind,
    };
  });
  const count = (f: (i: (typeof items)[number]) => boolean) => items.filter(f).length;
  const cur = (s: ProfileStatus) => count((i) => i.vigencia === 'CURRENT' && i.evaluation?.status === s);
  return {
    kind: 'CURRENT_TECHNICAL_GEO_EVALUATION',
    consulted_at: new Date().toISOString(),
    note: GEO_PANEL_NOTE,
    not_snapshot_content: true,
    profile: { id: GEO_PROFILE.id, version: GEO_PROFILE.version, status: GEO_PROFILE.status },
    case: { id: caseRow.id, number: caseRow.case_number },
    counts: {
      total: items.length, meets_profile: cur('MEETS_PROFILE'), does_not_meet: cur('DOES_NOT_MEET'), review_required: cur('REVIEW_REQUIRED'), not_evaluable: cur('NOT_EVALUABLE'),
      obsolete: count((i) => i.vigencia === 'OBSOLETE'), absent: count((i) => i.vigencia === 'ABSENT'),
    },
    pending: items.filter((i) => i.pending).map((i) => ({ plot_id: i.plot_id, plot_code: i.plot_code, kind: i.pending as PendienteKind })),
    plots: items,
    // La guarda: el panel informa del requisito, no lo cambia. Se muestra el estado que quedó en la ÚLTIMA instantánea.
    regulatory: {
      requirement: 'GEOLOCATION_PROFILE',
      latest_snapshot: snap ? { number: snap.snapshot_number, captured_at: snap.captured_at, status: snap.requirements.find((r) => r.code === 'GEOLOCATION_PROFILE')?.status ?? null } : null,
      message: 'Tener todas las parcelas en «Cumple el perfil técnico» NO cumple GEOLOCATION_PROFILE ni habilita READY: falta la condición regulatoria revisada (D-05.B).',
    },
  };
}
