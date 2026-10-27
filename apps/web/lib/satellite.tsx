'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from './api';
import { useI18n } from './i18n';
import { Alert, EmptyState, ErrorPanel, StatusBadge, type Tone } from './ui';

// P0-028 Análisis satelital (UX_UI §13.4): «solicitado, en cola, en proceso, fallido o disponible según contrato de
// job. Resultado muestra fecha de análisis y del dataset, fuente y límites. Una alerta de cobertura requiere
// interpretación; no escribir "deforestación confirmada" por el solo resultado de un proveedor.»
//
// A-01: recorrido web de ENSAYO. Con la fixture sintética activa, la tarjeta ofrece escenarios controlados (con
// hallazgos, sin hallazgos, cobertura parcial, sin cobertura, error…) y los separa de lo operativo bajo el rótulo
// ENSAYO. Ningún resultado de ensayo acredita deforestación ni su ausencia, ni cambia conclusiones, READY o despacho.
// Esta tarjeta NO interpreta: muestra el estado, la procedencia y los límites que devuelve el servidor.

interface Result {
  is_synthetic: boolean;
  synthetic_warning: string | null;
  provenance: { provider_code: string; dataset: string | null; dataset_version: string | null; analysis_date: string | null; resolution_m: string | null; method: string | null };
  coverage: { status: 'COVERED' | 'PARTIAL' | 'NOT_COVERED' | 'UNKNOWN'; note: string };
  confidence: string | null;
  confidence_note: string | null;
  limitations: string;
  indicators?: { findings?: { count: number; kind: string; note: string } } | null;
  raw_evidence: { stored: boolean; sha256: string } | null;
  conclusion: string;
  conclusion_note: string;
}
interface Job {
  id: string;
  subject: { plot_version_id: string; geometry_hash: string; geometry_type: string };
  applies_to_current_version: boolean;
  is_ensayo?: boolean;
  provider: { code: string; kind: string; adapter_contract_version: string };
  operation: string;
  period: { start: string | null; end: string | null };
  status: 'REQUESTED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  outcome: string | null;
  outcome_note: string;
  attempts: number;
  error_code: string | null;
  requested_at: string;
  finished_at: string | null;
  result: Result | null;
}
interface PlotSatellite {
  can_request: boolean;
  request_blocked_reason: string | null;
  ensayo_mode?: boolean;
  fixture_scenarios?: string[];
  provider_selection: { status: 'SELECTED' | 'SELECTED_FOR_DEVELOPMENT' | 'NOT_SELECTED'; provider_code?: string; decision?: string; note?: string };
  analysis_status: 'RESULT_AVAILABLE' | 'IN_PROGRESS' | 'NOT_EVALUATED';
  jobs: Job[];
  limits: string[];
}

export const SAT_STATUS: Record<Job['status'], { label: string; tone: Tone }> = {
  REQUESTED: { label: 'Solicitado', tone: 'neutral' },
  RUNNING: { label: 'En proceso', tone: 'process' },
  COMPLETED: { label: 'Disponible', tone: 'valid' },
  FAILED: { label: 'Fallido', tone: 'blocked' },
  CANCELLED: { label: 'Cancelado', tone: 'neutral' },
};
export const SAT_ANALYSIS: Record<PlotSatellite['analysis_status'], { label: string; tone: Tone }> = {
  RESULT_AVAILABLE: { label: 'Resultado disponible', tone: 'valid' },
  IN_PROGRESS: { label: 'Análisis en curso', tone: 'process' },
  NOT_EVALUATED: { label: 'NO EVALUADO', tone: 'neutral' },
};
export const SAT_OPERATION: Record<string, string> = {
  FOREST_COVER: 'Cobertura forestal',
  DEFORESTATION_ALERTS: 'Alertas de cambio de cobertura',
  HISTORICAL_ANALYSIS: 'Análisis histórico',
};
export const SAT_COVERAGE: Record<Result['coverage']['status'], string> = {
  COVERED: 'Cubierta', PARTIAL: 'Cobertura parcial', NOT_COVERED: 'Sin cobertura', UNKNOWN: 'Cobertura desconocida',
};
export const SAT_SCENARIO: Record<string, string> = {
  RESULT_COVERED: 'Resultado con cobertura completa',
  RESULT_FINDINGS: 'Resultado CON hallazgos',
  RESULT_NO_FINDINGS: 'Resultado SIN hallazgos',
  RESULT_PARTIAL: 'Cobertura insuficiente (parcial)',
  NO_COVERAGE: 'Sin cobertura',
  TIMEOUT: 'Plazo vencido',
  RATE_LIMITED: 'Cupo agotado',
  PROVIDER_ERROR: 'Error del proveedor',
  EGRESS_BLOCKED: 'Destino bloqueado',
};

export function SatelliteAnalysis({ orgId, plotId }: { orgId: string; plotId: string }) {
  const { t, dt } = useI18n();
  const [data, setData] = useState<PlotSatellite | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scenario, setScenario] = useState('RESULT_FINDINGS');

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setData(await api<PlotSatellite>(`/api/v1/organizations/${orgId}/plots/${plotId}/satellite`));
      setError(null);
    } catch (err) {
      if ((err as ApiError).status === 403) { setDenied(true); return; }
      setError(err as ApiError);
    }
  }, [orgId, plotId]);

  useEffect(() => { void load(); }, [load]);

  // El análisis corre fuera de la petición (S1 §54): mientras haya encargos en curso se consulta su estado.
  const enCurso = !!data?.jobs.some((j) => j.status === 'REQUESTED' || j.status === 'RUNNING');
  useEffect(() => {
    if (!enCurso) return;
    const id = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(id);
  }, [enCurso, load]);

  // Sin permiso de lectura la tarjeta no existe: no se insinúa lo que no se puede ver.
  if (denied) return null;
  if (!data && !error) return null;

  const request = async (operation: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/plots/${plotId}/satellite/analyses`, {
        method: 'POST',
        body: { operation_id: crypto.randomUUID(), operation, ...(data?.ensayo_mode ? { fixture_scenario: scenario } : {}) },
      });
      await load();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const jobView = (j: Job) => (
    <li key={j.id} className="subcard">
      <p>
        {j.is_ensayo && <><StatusBadge tone="review">ENSAYO</StatusBadge>{' '}</>}
        <StatusBadge tone={SAT_STATUS[j.status].tone}>{t(SAT_STATUS[j.status].label)}</StatusBadge>{' '}
        {t(SAT_OPERATION[j.operation] ?? j.operation)} · {t('solicitado')} {dt(j.requested_at)}
        {!j.applies_to_current_version && <> · <StatusBadge tone="review">{t('No corresponde a la versión vigente')}</StatusBadge></>}
      </p>
      <p className="muted">{t(j.outcome_note)}</p>
      {j.result && (
        <>
          {j.result.synthetic_warning && <Alert tone="review" title={t('Resultado de ENSAYO (fixture sintética)')}>{t(j.result.synthetic_warning)}</Alert>}
          {j.result.indicators?.findings && (
            <Alert tone={j.result.indicators.findings.count > 0 ? 'review' : 'info'}
              title={j.result.indicators.findings.count > 0 ? t('Hallazgos de ensayo: {n}', { n: j.result.indicators.findings.count }) : t('Sin hallazgos en el ensayo')}>
              <p>{t(j.result.indicators.findings.note)}</p>
            </Alert>
          )}
          <dl className="props">
            <dt>{t('Fuente')}</dt><dd>{j.result.provenance.provider_code} · {t('contrato')} {j.provider.adapter_contract_version}</dd>
            <dt>{t('Conjunto de datos')}</dt><dd>{j.result.provenance.dataset ?? t('No informado')}{j.result.provenance.dataset_version ? ` · ${t('versión')} ${j.result.provenance.dataset_version}` : ''}</dd>
            <dt>{t('Versión geométrica analizada')}</dt><dd><code className="hash">{j.subject.plot_version_id.slice(0, 8)}…</code> · {t('huella')} <code className="hash">{j.subject.geometry_hash.slice(0, 12)}…</code></dd>
            <dt>{t('Fecha del análisis')}</dt><dd>{j.result.provenance.analysis_date ? dt(j.result.provenance.analysis_date) : '—'}</dd>
            <dt>{t('Resolución')}</dt><dd>{j.result.provenance.resolution_m ? `${j.result.provenance.resolution_m} m` : t('No informada')}</dd>
            <dt>{t('Método')}</dt><dd>{j.result.provenance.method ?? t('No informado')}</dd>
            <dt>{t('Cobertura')}</dt><dd>{t(SAT_COVERAGE[j.result.coverage.status])} · {t(j.result.coverage.note)}</dd>
            <dt>{t('Confianza')}</dt><dd>{j.result.confidence ?? t(j.result.confidence_note ?? '')}</dd>
            <dt>{t('Conclusión')}</dt><dd><StatusBadge tone="neutral">{t('No evaluada')}</StatusBadge> <span className="muted">{t(j.result.conclusion_note)}</span></dd>
            <dt>{t('Límites declarados')}</dt><dd>{t(j.result.limitations)}</dd>
            {j.result.raw_evidence && (<>
              <dt>{t('Respuesta original')}</dt><dd>SHA-256 <code className="hash">{j.result.raw_evidence.sha256}</code></dd>
            </>)}
          </dl>
        </>
      )}
      {j.status === 'FAILED' && (
        <div className="error" role="alert">
          <p className="alert-title">{t('El análisis no produjo resultado.')}</p>
          <p>{t('Un error no es un resultado favorable ni desfavorable: la parcela sigue sin evaluar.')} {j.error_code && <>{t('Código del fallo')}: <code>{j.error_code}</code> · {t('intentos')}: {j.attempts}</>}</p>
          {data?.can_request && (
            <button type="button" className="secondary" disabled={busy} onClick={() => void request(j.operation)}>
              {data.ensayo_mode ? t('Reintentar con el escenario elegido') : t('Reintentar el análisis')}
            </button>
          )}
        </div>
      )}
      {j.error_code && j.status !== 'FAILED' && <p className="muted">{t('Código del fallo')}: {j.error_code} · {t('intentos')}: {j.attempts}</p>}
    </li>
  );

  const operativos = data?.jobs.filter((j) => !j.is_ensayo) ?? [];
  const ensayos = data?.jobs.filter((j) => j.is_ensayo) ?? [];

  return (
    <section className="card" aria-labelledby="sat-title">
      <h2 id="sat-title">{t('Análisis satelital')}</h2>
      {error && <ErrorPanel error={error} onRetry={load} />}
      {data && (
        <>
          <p>
            <StatusBadge tone={SAT_ANALYSIS[data.analysis_status].tone}>{t(SAT_ANALYSIS[data.analysis_status].label)}</StatusBadge>{' '}
            {data.provider_selection.status === 'SELECTED'
              ? <span className="muted">{t('Proveedor')}: {data.provider_selection.provider_code}</span>
              : data.provider_selection.status === 'SELECTED_FOR_DEVELOPMENT'
                ? <span className="muted">{t('Adaptador en desarrollo')}: {data.provider_selection.provider_code}</span>
                : <span className="muted">{t('Sin proveedor seleccionado')} ({data.provider_selection.decision})</span>}
          </p>
          {data.ensayo_mode && (
            <Alert tone="review" title={t('MODO ENSAYO: proveedor sintético local')}>
              <p>{t('Los resultados de este modo son inventados por una fixture para probar el recorrido. No observan la parcela, no acreditan deforestación ni su ausencia, y no cambian conclusiones, READY ni el despacho. Las llamadas reales al proveedor siguen deshabilitadas.')}</p>
            </Alert>
          )}
          {data.provider_selection.status !== 'SELECTED' && !data.ensayo_mode && (
            <Alert
              tone="info"
              title={data.provider_selection.status === 'SELECTED_FOR_DEVELOPMENT'
                ? t('El adaptador existe, pero su uso real no está autorizado.')
                : t('No hay proveedor satelital seleccionado.')}
            >
              <p>{t(data.provider_selection.note ?? '')}</p>
            </Alert>
          )}
          {data.can_request ? (
            <div className="actions">
              {data.ensayo_mode && (
                <div>
                  <label htmlFor="sat-scenario">{t('Escenario de ensayo')}</label>
                  <select id="sat-scenario" value={scenario} onChange={(e) => setScenario(e.target.value)}>
                    {(data.fixture_scenarios ?? []).map((s) => <option key={s} value={s}>{t(SAT_SCENARIO[s] ?? s)}</option>)}
                  </select>
                </div>
              )}
              {Object.entries(SAT_OPERATION).map(([code, label]) => (
                <button key={code} type="button" className="secondary" disabled={busy} onClick={() => void request(code)}>
                  {t('Solicitar')}: {t(label)}
                </button>
              ))}
            </div>
          ) : (
            // Si el aviso de arriba ya explica el motivo, no se repite la misma frase dos veces.
            data.request_blocked_reason && data.request_blocked_reason !== data.provider_selection.note
              && <p className="muted">{t('No se puede solicitar un análisis')}: {t(data.request_blocked_reason)}</p>
          )}
          {enCurso && <p className="muted" role="status">{t('Hay un análisis en curso: esta tarjeta se actualiza sola.')}</p>}

          {data.jobs.length === 0 ? (
            <EmptyState title={t('Sin análisis solicitados.')}>
              <p className="muted">{t('Esta parcela no tiene ningún análisis satelital encargado.')}</p>
            </EmptyState>
          ) : (
            <>
              {operativos.length > 0 && (<><h3>{t('Resultados operativos')}</h3><ul className="plain">{operativos.map(jobView)}</ul></>)}
              {ensayos.length > 0 && (<><h3>{t('Resultados de ENSAYO (sintéticos, separados de lo operativo)')}</h3><ul className="plain">{ensayos.map(jobView)}</ul></>)}
            </>
          )}
          <ul className="muted">
            {data.limits.map((l) => <li key={l}>{t(l)}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
