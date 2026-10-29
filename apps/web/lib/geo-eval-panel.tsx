'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from './api';
import { useI18n } from './i18n';
import { PROFILE_TABLES } from './geo-profile';
import { useWorkspace } from './workspace';
import { Alert, ErrorPanel, Loading, StatusBadge, type Tone } from './ui';

// «Evaluación geográfica técnica actual» del expediente. Es una CONSULTA de solo lectura, separada del contenido de la instantánea: no la modifica, no cambia su
// frescura y no es una conclusión regulatoria. Muestra por separado (1) la evaluación técnica actual de las parcelas, (2) el estado ACTUAL del requisito GEOLOCATION_PROFILE con su motivo (mismo mecanismo que la instantánea) y (3) lo guardado en la última instantánea.

interface PanelEval {
  id: string; evaluated_version_number: number; profile: { id: string; version: string }; source: { service_version: string; document_version: string; page_date: string };
  status: keyof typeof PROFILE_TABLES.STATUS; label: string; evaluated_at: string;
  explanation: Array<{ code: string; outcome: string; reason_code: string | null; message: string }> | null; area: { basis: string; value_ha: string | null } | null;
}
interface PanelPlot {
  plot_id: string; plot_code: string; geometry: { version_id: string; version_number: number | null; geometry_type: string | null } | null;
  vigencia: 'CURRENT' | 'OBSOLETE' | 'ABSENT'; vigencia_label: string; reason: string | null; reason_label: string | null; evaluation: PanelEval | null; detail_restricted: boolean;
  next_action: { code: string; message: string; can_act: boolean | null }; pending: 'ABSENT' | 'OBSOLETE' | 'NOT_EVALUABLE' | null;
}
interface Panel {
  consulted_at: string; note: string; profile: { id: string; version: string };
  counts: { total: number; meets_profile: number; does_not_meet: number; review_required: number; not_evaluable: number; obsolete: number; absent: number };
  pending: Array<{ plot_id: string; plot_code: string; kind: 'ABSENT' | 'OBSOLETE' | 'NOT_EVALUABLE' }>; plots: PanelPlot[];
  regulatory: {
    requirement: string; message: string;
    current: { status: string; status_label: string; detail: string; mechanism: { config_adopted: boolean; config_version: string | null; review_decision: string | null; applicable_to_organization: boolean; rules: { active: number; candidate: number } } };
    latest_snapshot: { number: number; captured_at: string; status: string | null; detail: string | null } | null; differs_from_latest_snapshot: boolean | null;
  };
}

const VIGENCIA_TONE: Record<PanelPlot['vigencia'], Tone> = { CURRENT: 'process', OBSOLETE: 'review', ABSENT: 'neutral' };
const PENDING_LABEL: Record<'ABSENT' | 'OBSOLETE' | 'NOT_EVALUABLE', string> = { ABSENT: 'Sin evaluación', OBSOLETE: 'Obsoleta', NOT_EVALUABLE: 'No evaluable' };
const REQ_LABEL: Record<string, string> = { MET: 'Satisfecho', PENDING: 'Pendiente', INVALID: 'Inválido', NOT_EVALUABLE: 'No evaluable' };
const DECISION_LABEL: Record<string, string> = { REVIEWED: 'revisada', OBJECTED: 'objetada', WITHDRAWN: 'retirada' };

export const GEO_PANEL_TABLAS = { PENDING_LABEL, REQ_LABEL };

export function GeoEvaluationPanel({ orgId, caseId }: { orgId: string; caseId: string }) {
  const ws = useWorkspace();
  const { t, dt } = useI18n();
  const [p, setP] = useState<Panel | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    try { setP(await api<Panel>(`/api/v1/organizations/${orgId}/dd-cases/${caseId}/geo-evaluation`)); setError(null); } catch (e) { setError(e as ApiError); }
  }, [orgId, caseId]);
  useEffect(() => { void load(); }, [load]);

  const canOpenPlot = ws.can('plot:read');
  return (
    <section className="card" aria-labelledby="dd-geo">
      <h2 id="dd-geo">{t('Evaluación geográfica técnica actual')}</h2>
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!p && !error && <Loading label={t('Cargando la evaluación geográfica…')} />}
      {p && (
        <>
          <Alert tone="info" title={t('Consulta actual, separada de la instantánea')}>
            <p>{t(p.note)}</p>
            <p className="muted">{t('Consultado el {fecha}. Perfil técnico {perfil} versión {version}. Esta consulta solo lee: no recalcula ni evalúa nada.', { fecha: dt(p.consulted_at), perfil: p.profile.id, version: p.profile.version })}</p>
          </Alert>
          <dl className="props" aria-label={t('Recuentos')}>
            <dt>{t('Parcelas de origen')}</dt><dd>{p.counts.total}</dd>
            <dt>{t('Cumplen el perfil técnico')}</dt><dd>{p.counts.meets_profile}</dd>
            <dt>{t('No cumplen el perfil técnico')}</dt><dd>{p.counts.does_not_meet}</dd>
            <dt>{t('Requieren revisión humana')}</dt><dd>{p.counts.review_required}</dd>
            <dt>{t('Resultado no evaluable')}</dt><dd>{p.counts.not_evaluable}</dd>
            <dt>{t('Evaluación obsoleta')}</dt><dd>{p.counts.obsolete}</dd>
            <dt>{t('Sin evaluación')}</dt><dd>{p.counts.absent}</dd>
          </dl>

          <h3>{t('Pendientes de evaluación vigente')}</h3>
          {p.pending.length === 0 ? <p className="muted">{t('Todas las parcelas de origen tienen una evaluación vigente y evaluable.')}</p> : (
            <ul>
              {p.pending.map((x) => (
                <li key={x.plot_id}>
                  {canOpenPlot ? <Link href={`/organizaciones/${orgId}/parcelas/${x.plot_id}`}>{x.plot_code}</Link> : x.plot_code} · <StatusBadge tone={x.kind === 'OBSOLETE' ? 'review' : 'neutral'}>{t(PENDING_LABEL[x.kind])}</StatusBadge>
                </li>
              ))}
            </ul>
          )}

          <div className="table-wrap">
            <table aria-label={t('Evaluación geográfica técnica por parcela')}>
              <thead>
                <tr>
                  <th scope="col">{t('Parcela')}</th><th scope="col">{t('Versión geométrica')}</th><th scope="col">{t('Perfil')}</th><th scope="col">{t('Veredicto')}</th>
                  <th scope="col">{t('Evaluada')}</th><th scope="col">{t('Vigencia')}</th><th scope="col">{t('Explicación y siguiente acción')}</th>
                </tr>
              </thead>
              <tbody>
                {p.plots.map((x) => (
                  <tr key={x.plot_id}>
                    <td>{canOpenPlot ? <Link href={`/organizaciones/${orgId}/parcelas/${x.plot_id}`}>{x.plot_code}</Link> : x.plot_code}</td>
                    <td>{x.geometry ? t('Versión {n}', { n: x.geometry.version_number ?? 0 }) : <span className="muted">{t('Sin geometría')}</span>}</td>
                    <td>{x.evaluation ? <>{x.evaluation.profile.id}<br /><span className="muted">{t('versión')} {x.evaluation.profile.version}</span></> : <span className="muted">—</span>}</td>
                    <td>{x.evaluation ? <StatusBadge tone={PROFILE_TABLES.STATUS[x.evaluation.status].tone}>{t(PROFILE_TABLES.STATUS[x.evaluation.status].label)}</StatusBadge> : <span className="muted">—</span>}</td>
                    <td>{x.evaluation ? <>{dt(x.evaluation.evaluated_at)}<br /><span className="muted">{t('sobre la versión {n}', { n: x.evaluation.evaluated_version_number })}</span></> : <span className="muted">—</span>}</td>
                    <td><StatusBadge tone={VIGENCIA_TONE[x.vigencia]}>{t(x.vigencia_label)}</StatusBadge>{x.reason_label && <div className="muted">{t(x.reason_label)}</div>}</td>
                    <td>
                      {x.evaluation?.explanation && x.evaluation.explanation.length > 0 && (
                        <ul>{x.evaluation.explanation.map((c) => <li key={c.code}>{c.message}</li>)}</ul>
                      )}
                      {x.detail_restricted && x.evaluation && <p className="muted">{t('Detalle restringido: tu rol no incluye el permiso de geometría.')}</p>}
                      <p>{t(x.next_action.message)}{x.next_action.can_act === false && <span className="muted"> {t('(tu rol no puede hacerlo)')}</span>}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Alert tone="review" title={t('Estado actual del requisito {req}', { req: p.regulatory.requirement })}>
            <p><strong>{t(REQ_LABEL[p.regulatory.current.status] ?? 'No evaluable')}</strong>: {t(p.regulatory.current.detail)}</p>
            <ul className="muted">
              <li>{p.regulatory.current.mechanism.config_adopted ? t('Configuración adoptada: {v}', { v: p.regulatory.current.mechanism.config_version ?? '' }) : t('Sin configuración adoptada')}</li>
              <li>{t('Revisión vigente')}: {p.regulatory.current.mechanism.review_decision ? t(DECISION_LABEL[p.regulatory.current.mechanism.review_decision] ?? p.regulatory.current.mechanism.review_decision) : t('ninguna')} · {p.regulatory.current.mechanism.applicable_to_organization ? t('aplicable a tu organización') : t('sin aplicabilidad declarada')}</li>
              <li>{t('Reglas')}: {p.regulatory.current.mechanism.rules.active} {t('activa(s)')} · {p.regulatory.current.mechanism.rules.candidate} {t('candidata(s) sin resolver')}</li>
            </ul>
            <p>{t(p.regulatory.message)}</p>
            <p className="muted">
              {p.regulatory.latest_snapshot
                ? t('Estado de {req} en la última instantánea ({n}): {estado}', { req: p.regulatory.requirement, n: p.regulatory.latest_snapshot.number, estado: t(REQ_LABEL[p.regulatory.latest_snapshot.status ?? ''] ?? 'No evaluable') })
                : t('Todavía no hay instantáneas.')}
              {p.regulatory.differs_from_latest_snapshot === true && <> {t('Difiere del estado actual: genera una instantánea nueva para registrarlo (la anterior no se modifica).')}</>}
              {p.regulatory.differs_from_latest_snapshot === false && <> {t('Coincide con el estado actual.')}</>}
            </p>
          </Alert>
          <div className="actions"><button type="button" className="secondary" onClick={() => void load()}>{t('Volver a consultar')}</button></div>
        </>
      )}
    </section>
  );
}
