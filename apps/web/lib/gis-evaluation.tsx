'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api';
import { useI18n } from './i18n';
import { ha } from './plots';
import { accuracySummaryLabel } from './polygon-capture';
import { ErrorPanel, StatusBadge, type Tone } from './ui';

// P0-010 Evaluación GIS técnica (UX_UI §13.3). El estado es TÉCNICO: «Válida» no es conformidad EUDR.
// Tres bloques separados: validez técnica, calidad/cobertura de captura y perfil de destino (D-05).
// A-01: español (fuente) e inglés. Lo que redacta el servidor se traduce por texto; sin traducción se muestra en español.

interface Check { code: string; outcome: 'PASS' | 'FAIL' | 'REVIEW' | 'WARNING' | 'NOT_APPLICABLE' | 'NOT_EXECUTED' | 'RESTRICTED'; reason_code: string | null; message: string; details?: Record<string, unknown> }
interface Evaluation {
  id: string; version_number: number; plot_version_id: string; evaluated_at: string;
  rule: { id: string; version: string };
  status: 'VALID' | 'WARNING' | 'INVALID' | 'REVIEW_REQUIRED'; status_note: string; next_action: string;
  checks: Check[];
  capture_quality: { status: string; label: string; threshold_note: string; samples?: number; summary?: { with_accuracy: number; without_accuracy: number; worst_known_m: number | null } };
  destination_profile: { status: string; label: string; not_evaluated: string[] };
  relations: Array<{ plot_id: string; plot_code: string; version_number: number; relation: 'EQUAL' | 'OVERLAP' | 'TOUCH'; same_hash: boolean; shared_area_m2: string | null }>;
  comparison_scope: 'ORGANIZATION' | 'EVALUATOR_ASSIGNED';
  error_location_visible: boolean; error_location: { type: string; coordinates: number[] } | null;
  stale: boolean; stale_reasons: string[]; limits: string[];
}

export const GIS_STATUS: Record<Evaluation['status'], { label: string; tone: Tone }> = {
  VALID: { label: 'VALID · técnicamente válida', tone: 'process' },
  WARNING: { label: 'WARNING · con advertencias', tone: 'review' },
  INVALID: { label: 'INVALID · técnicamente no válida', tone: 'blocked' },
  REVIEW_REQUIRED: { label: 'REVIEW_REQUIRED · requiere revisión', tone: 'review' },
};
const OUTCOME: Record<Check['outcome'], string> = {
  PASS: 'Correcta', FAIL: 'Falla', REVIEW: 'Requiere revisión', WARNING: 'Advertencia', NOT_APPLICABLE: 'No aplica', NOT_EXECUTED: 'No ejecutada', RESTRICTED: 'Reservada',
};
const CHECK_LABEL: Record<string, string> = {
  GEOMETRY_PRESENT: 'Geometría presente', GEOMETRY_TYPE: 'Tipo de geometría', SRID: 'Sistema de referencia (WGS84)',
  COORDINATE_RANGE: 'Rango de coordenadas', NOT_EMPTY: 'No vacía', NOT_DEGENERATE: 'No degenerada', TECHNICAL_VALIDITY: 'Validez técnica',
  AREA: 'Superficie calculada', GEOMETRIC_EQUALITY: 'Igualdad con otras parcelas', OVERLAP: 'Solapamiento con otras parcelas',
};
const RELATION: Record<string, string> = { EQUAL: 'Misma geometría', OVERLAP: 'Comparte superficie', TOUCH: 'Solo contacto por borde' };
const STALE: Record<string, string> = {
  GEOMETRY_CHANGED: 'la parcela tiene una versión geométrica más reciente',
  PLOT_VERSION_CHANGED_SAME_GEOMETRY: 'la parcela tiene una versión nueva con la misma geometría (cambió la superficie declarada); esta evaluación no se hereda: evalúa la versión vigente',
  COMPARED_PLOTS_CHANGED: 'cambiaron las parcelas con las que se comparó',
  RULES_CHANGED: 'cambió la versión de las reglas',
};
// Exportados solo para que la prueba de traducciones los compruebe.
export const GIS_TABLES = { OUTCOME, CHECK_LABEL, RELATION, STALE };

export function GisEvaluation({ orgId, plotId, canEvaluate, hasVersion }: { orgId: string; plotId: string; canEvaluate: boolean; hasVersion: boolean }) {
  const { t, dt, num, locale } = useI18n();
  const region = locale === 'en' ? 'en-US' : 'es-EC';
  const [list, setList] = useState<Evaluation[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const op = useRef<string | null>(null);
  const base = `/api/v1/organizations/${orgId}`;

  const load = useCallback(async () => {
    try { setList(await api<Evaluation[]>(`${base}/plots/${plotId}/gis-evaluations`)); } catch (e) { setError(e as ApiError); }
  }, [base, plotId]);
  useEffect(() => { void load(); }, [load]);

  async function evaluate() {
    op.current ??= crypto.randomUUID(); // un reintento tras un fallo de red no duplica la evaluación
    setBusy(true); setError(null);
    try {
      await api(`${base}/plots/${plotId}/gis-evaluations`, { method: 'POST', body: { operation_id: op.current } });
      op.current = null;
      await load();
    } catch (e) {
      const err = e as ApiError;
      if (!(err.status === 0 || err.status >= 500)) op.current = null;
      setError(err);
    } finally { setBusy(false); }
  }

  const latest = list?.[0];
  return (
    <section className="card" aria-labelledby="gis-title">
      <h2 id="gis-title">{t('Evaluación GIS (técnica)')}</h2>
      <p className="muted">{t('Comprueba la geometría con reglas técnicas versionadas, sin modificarla. No incluye umbrales regulatorios, análisis satelital ni aprobación EUDR.')}</p>
      {error && <ErrorPanel error={error} />}
      {canEvaluate && hasVersion && (
        <button type="button" onClick={evaluate} disabled={busy} aria-busy={busy}>{busy ? t('Evaluando…') : latest ? t('Volver a evaluar') : t('Evaluar geometría')}</button>
      )}
      {list === null && !error && <p className="muted">{t('Cargando evaluaciones…')}</p>}
      {list && !latest && <p className="muted">{t('Sin evaluaciones.')} {canEvaluate ? t('Evalúa la versión vigente para ver sus comprobaciones.') : t('Un usuario con permiso de evaluación puede ejecutarla.')}</p>}
      {latest && (
        <div className="gis-eval">
          {latest.stale && (
            <div className="alert" role="status">
              <p className="alert-title">{t('Evaluación desactualizada')}</p>
              <p>{t('Desde esta evaluación')} {latest.stale_reasons.map((r) => t(STALE[r] ?? r)).join('; ')}. {t('El resultado se conserva como historial; vuelve a evaluar para obtener uno vigente.')}</p>
            </div>
          )}
          <dl className="props">
            <dt>{t('Estado técnico')}</dt><dd><StatusBadge tone={GIS_STATUS[latest.status].tone}>{t(GIS_STATUS[latest.status].label)}</StatusBadge> <span className="muted">{t(latest.status_note)}</span></dd>
            <dt>{t('Versión evaluada')}</dt><dd>v{latest.version_number}</dd>
            <dt>{t('Reglas')}</dt><dd>{latest.rule.id} · {t('versión')} {latest.rule.version}</dd>
            <dt>{t('Alcance de comparación')}</dt><dd>{latest.comparison_scope === 'ORGANIZATION' ? t('Todas las parcelas activas de la organización') : t('Solo las parcelas asignadas a quien evaluó')}</dd>
            <dt>{t('Fecha')}</dt><dd>{dt(latest.evaluated_at)}</dd>
            <dt>{t('Siguiente acción')}</dt><dd>{t(latest.next_action)}</dd>
          </dl>

          <h3>{t('Validez técnica')}</h3>
          <div className="table-wrap">
            <table aria-label={t('Comprobaciones técnicas')}>
              <thead><tr><th scope="col">{t('Comprobación')}</th><th scope="col">{t('Resultado')}</th><th scope="col">{t('Motivo')}</th></tr></thead>
              <tbody>
                {latest.checks.map((c) => (
                  <tr key={c.code}>
                    <td>{t(CHECK_LABEL[c.code] ?? c.code)}</td>
                    <td>{t(OUTCOME[c.outcome])}</td>
                    <td>{t(c.message)}{c.code === 'AREA' && typeof c.details?.area_calculated_ha === 'string' ? ` ${ha(c.details.area_calculated_ha as string, region)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {latest.error_location_visible && latest.error_location?.type === 'Point' && (
            <p className="muted">{t('Ubicación del problema')}: {t('Latitud').toLowerCase()} {latest.error_location.coordinates[1]}, {t('Longitud').toLowerCase()} {latest.error_location.coordinates[0]}.</p>
          )}
          {latest.relations.length > 0 && (
            <>
              <h4>{t('Relaciones con otras parcelas')}</h4>
              <p className="muted">{t('Una coincidencia o solapamiento no prueba ilegalidad ni autoriza fusionar parcelas.')}</p>
              <ul className="plain" aria-label={t('Parcelas relacionadas')}>
                {latest.relations.map((r) => (
                  <li key={r.plot_id}>
                    <a href={`/organizaciones/${orgId}/parcelas/${r.plot_id}`}>{r.plot_code}</a> (v{r.version_number}) · {t(RELATION[r.relation])}
                    {r.relation === 'EQUAL' && (r.same_hash ? ` · ${t('mismos bytes de geometría')}` : ` · ${t('igual en forma, con otro orden de vértices')}`)}
                    {r.shared_area_m2 && ` · ${t('superficie compartida')} ${Number(r.shared_area_m2).toLocaleString(region)} m²`}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3>{t('Calidad y cobertura de captura')}</h3>
          {/* Con resumen estructurado se arma el texto desde las cifras del servidor; si no, se traduce el texto fijo o se conserva el original. */}
          <p>{latest.capture_quality.summary && typeof latest.capture_quality.samples === 'number'
            ? accuracySummaryLabel(latest.capture_quality.summary, latest.capture_quality.samples, t, num)
            : t(latest.capture_quality.label)}</p>
          <p className="muted">{t(latest.capture_quality.threshold_note)}</p>

          <h3>{t('Perfil de destino y requisitos regulatorios')}</h3>
          <p><StatusBadge tone="neutral">{t('No evaluado aquí')}</StatusBadge> {t(latest.destination_profile.label)}</p>
          <p className="muted">
            {t('Desde el 2026-10-15 el perfil técnico de destino se evalúa con una regla propia y versionada aparte (EUDR_GEO_V1, D-05.A), en la sección siguiente. Esta evaluación técnica no lo incluye a propósito: son dos dictámenes distintos y pueden discrepar.')}
          </p>

          <details>
            <summary>{t('Límites del análisis')}</summary>
            <ul>{latest.limits.map((l) => <li key={l}>{t(l)}</li>)}</ul>
          </details>
          {list.length > 1 && (
            <details>
              <summary>{t('Historial de evaluaciones')} ({list.length})</summary>
              <ul className="plain" aria-label={t('Historial de evaluaciones')}>
                {list.map((e) => <li key={e.id}>{dt(e.evaluated_at)} · v{e.version_number} · {t(GIS_STATUS[e.status].label)} · {e.rule.id} {e.rule.version}{e.stale ? ` · ${t('desactualizada')}` : ''}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
