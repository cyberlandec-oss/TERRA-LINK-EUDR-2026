'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api';
import { useI18n } from './i18n';
import { ErrorPanel, StatusBadge, type Tone } from './ui';

// D-05.A — Perfil técnico de destino `EUDR_GEO_V1`, en pantalla y SEPARADO de la evaluación técnica.
//
// Los dos dictámenes se muestran a la vez porque **pueden discrepar**: un polígono con hueco es técnicamente
// válido y no cumple el perfil. Enseñar uno solo haría creer que hay un único veredicto.
// A-01: español (fuente) e inglés. Lo que redacta el servidor se traduce por texto; sin traducción se muestra en español.

interface Check { code: string; layer: string; outcome: 'PASS' | 'FAIL' | 'REVIEW' | 'NOT_APPLICABLE' | 'NOT_EXECUTED'; reason_code: string | null; message: string; details?: Record<string, unknown> }
type Status = 'MEETS_PROFILE' | 'DOES_NOT_MEET' | 'REVIEW_REQUIRED' | 'NOT_EVALUABLE';
interface Evaluation {
  id: string; status: Status; label: string; exportable: boolean; evaluated_at: string;
  profile: { id: string; version: string; status: string; note: string };
  source: { service_version: string; document_version: string; page_date: string; verification: string; verification_note: string };
  area: { basis: 'CALCULATED' | 'DECLARED' | 'NONE'; value_ha: string | null; note: string };
  checks: Check[];
  decimals_contract: Record<string, string>;
  not_in_scope: string[];
  disclaimer: string;
}
interface Response { evaluations: Evaluation[]; note: string }

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  MEETS_PROFILE: { label: 'Cumple el perfil técnico', tone: 'process' },
  DOES_NOT_MEET: { label: 'No cumple el perfil técnico', tone: 'blocked' },
  REVIEW_REQUIRED: { label: 'Requiere revisión humana', tone: 'review' },
  NOT_EVALUABLE: { label: 'No evaluable', tone: 'neutral' },
};
const OUTCOME: Record<Check['outcome'], string> = {
  PASS: 'Correcta', FAIL: 'Falla', REVIEW: 'Requiere revisión', NOT_APPLICABLE: 'No aplica', NOT_EXECUTED: 'No ejecutada',
};
const CHECK_LABEL: Record<string, string> = {
  GEOMETRY_PRESENT: 'Geometría presente', GEOMETRY_TYPE: 'Tipo admitido por el destino', CRS: 'Sistema de referencia',
  COORDINATE_RANGE: 'Rango de coordenadas', TECHNICAL_VALIDITY: 'Validez de la geometría', NO_HOLES: 'Sin huecos',
  AREA_BASIS: 'Superficie de referencia', AREA_MINIMUM: 'Superficie mínima', THRESHOLD: 'Umbral de 4 ha',
  AREA_DISCREPANCY: 'Declarada frente a calculada', INTERCHANGE_PRECISION: 'Truncamiento a 6 decimales',
};
/** De qué fuente sale cada comprobación. Que el destino lo acepte no es que la ley lo exija. */
const LAYER: Record<string, string> = {
  NORM: 'Norma', DEST: 'Sistema de destino', TL: 'Regla de Terra Link',
};
// Exportados solo para que la prueba de traducciones los compruebe.
export const PROFILE_TABLES = { STATUS, OUTCOME, CHECK_LABEL, LAYER };

export function GeoProfileEvaluation({ orgId, plotId, canEvaluate, hasVersion }: { orgId: string; plotId: string; canEvaluate: boolean; hasVersion: boolean }) {
  const { t, dt } = useI18n();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const op = useRef<string | null>(null);
  const base = `/api/v1/organizations/${orgId}`;

  const load = useCallback(async () => {
    try { setData(await api<Response>(`${base}/plots/${plotId}/geo-profile/evaluations`)); } catch (e) { setError(e as ApiError); }
  }, [base, plotId]);
  useEffect(() => { void load(); }, [load]);

  async function evaluate() {
    op.current ??= crypto.randomUUID();
    setBusy(true); setError(null);
    try {
      await api(`${base}/plots/${plotId}/geo-profile/evaluations`, { method: 'POST', body: { operation_id: op.current } });
      op.current = null;
      await load();
    } catch (e) {
      const err = e as ApiError;
      if (!(err.status === 0 || err.status >= 500)) op.current = null;
      setError(err);
    } finally { setBusy(false); }
  }

  const latest = data?.evaluations[0];
  return (
    <section className="card" aria-labelledby="perfil-title">
      <h2 id="perfil-title">{t('Perfil técnico de destino')}</h2>
      <p className="muted">
        {t('Dictamen distinto del técnico de arriba, y pueden discrepar: una geometría puede ser técnicamente válida y no estar bien formada para el sistema de destino. Cumplir el perfil no es conformidad EUDR ni una declaración presentada.')}
      </p>
      {error && <ErrorPanel error={error} />}
      {canEvaluate && hasVersion && (
        <button type="button" onClick={evaluate} disabled={busy} aria-busy={busy}>{busy ? t('Evaluando…') : latest ? t('Volver a evaluar el perfil') : t('Evaluar el perfil')}</button>
      )}
      {data === null && !error && <p className="muted">{t('Cargando perfil…')}</p>}
      {data && !latest && <p className="muted">{t('Sin evaluaciones de perfil.')} {canEvaluate ? t('Evalúa la versión vigente.') : t('Un usuario con permiso de evaluación puede ejecutarla.')}</p>}
      {latest && (
        <div className="gis-eval">
          <dl className="props">
            <dt>{t('Resultado')}</dt>
            <dd><StatusBadge tone={STATUS[latest.status].tone}>{t(STATUS[latest.status].label)}</StatusBadge></dd>
            <dt>{t('¿Exportable con perfil?')}</dt>
            <dd>{latest.exportable ? t('Sí') : t('No. Aparecerá en la lista de no exportables, con su motivo.')}</dd>
            <dt>{t('Perfil')}</dt>
            <dd>{latest.profile.id} · {t('versión')} {latest.profile.version} · <span className="muted">{t(latest.profile.note)}</span></dd>
            <dt>{t('Fuente evaluada')}</dt>
            <dd>
              {t('Servicio')} <strong>{latest.source.service_version}</strong> · {t('documento')} <strong>v{latest.source.document_version}</strong> ·
              {' '}{t('página del')} {latest.source.page_date}
            </dd>
            <dt>{t('Grado de comprobación')}</dt>
            <dd>{t(latest.source.verification_note)}</dd>
            <dt>{t('Superficie de referencia')}</dt>
            <dd>{latest.area.value_ha ? `${latest.area.value_ha} ha` : t('Desconocida')} · <span className="muted">{t(latest.area.note)}</span></dd>
            <dt>{t('Fecha')}</dt><dd>{dt(latest.evaluated_at)}</dd>
          </dl>

          <div className="table-wrap">
            <table aria-label={t('Comprobaciones del perfil de destino')}>
              <thead><tr><th scope="col">{t('Comprobación')}</th><th scope="col">{t('Lo exige')}</th><th scope="col">{t('Resultado')}</th><th scope="col">{t('Motivo')}</th></tr></thead>
              <tbody>
                {latest.checks.map((c) => (
                  <tr key={c.code}>
                    <td>{t(CHECK_LABEL[c.code] ?? c.code)}</td>
                    <td>{t(LAYER[c.layer] ?? c.layer)}</td>
                    <td>{t(OUTCOME[c.outcome])}</td>
                    <td>{t(c.message)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details>
            <summary>{t('Qué significan los decimales')}</summary>
            <dl className="props">
              <dt>{t('Valor numérico')}</dt><dd>{t(latest.decimals_contract.numeric_value)}</dd>
              <dt>{t('Formato de intercambio')}</dt><dd>{t(latest.decimals_contract.interchange_format)}</dd>
              <dt>{t('Resolución del dato')}</dt><dd>{t(latest.decimals_contract.data_resolution)}</dd>
              <dt>{t('Exactitud de captura')}</dt><dd>{t(latest.decimals_contract.capture_accuracy)}</dd>
            </dl>
            <p className="muted">{t(latest.decimals_contract.never)}</p>
          </details>

          <details>
            <summary>{t('Qué NO decide este perfil')}</summary>
            <ul>{latest.not_in_scope.map((l) => <li key={l}>{t(l)}</li>)}</ul>
            <p className="muted">{t(latest.disclaimer)}</p>
          </details>

          {data.evaluations.length > 1 && (
            <details>
              <summary>{t('Historial del perfil')} ({data.evaluations.length})</summary>
              <ul className="plain" aria-label={t('Historial del perfil')}>
                {data.evaluations.map((e) => (
                  <li key={e.id}>{dt(e.evaluated_at)} · {t(STATUS[e.status].label)} · {e.profile.id} {e.profile.version}</li>
                ))}
              </ul>
              <p className="muted">{t(data.note)}</p>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
