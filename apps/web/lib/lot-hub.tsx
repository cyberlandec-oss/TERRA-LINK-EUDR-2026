'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, api } from './api';
import { ErrorPanel, Loading, StatusBadge } from './ui';
import { MIT_TONE, RESULT_TONE, type RiskEvaluation } from './risk';
import { READINESS_TONE } from './dd';

// P0-027 Lot Hub (UX_UI §15.1): secciones que se autorizan y cargan por separado con los endpoints existentes. Cada una
// distingue: sin permiso (no se pide nada al servidor; no revela existencia), cargando, error con reintento y vacío.
// Ninguna afirma liberación, aprobación ni conformidad: estado técnico, preparación interna y verificación son distintos.

/** Carga una sección solo si el rol tiene permiso. */
function useSection<T>(allowed: boolean, url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    if (!allowed) return;
    setError(null);
    try { setData(await api<T>(url)); } catch (err) { setError(err as ApiError); }
  }, [allowed, url]);
  useEffect(() => { setData(null); void load(); }, [load]);
  return { data, error, load };
}

function SectionBody<T>({ allowed, deniedText, state, loadingText, children }: { allowed: boolean; deniedText: string; state: { data: T | null; error: ApiError | null; load: () => void }; loadingText: string; children: (data: T) => ReactNode }) {
  if (!allowed) return <p className="muted">{deniedText}</p>;
  if (state.error) return state.error.status === 403 ? <p className="muted">{deniedText}</p> : <ErrorPanel error={state.error} onRetry={state.load} />;
  if (!state.data) return <Loading label={loadingText} />;
  return <>{children(state.data)}</>;
}

export function RiskDdSection({ orgId, lotId, can }: { orgId: string; lotId: string; can: (p: string) => boolean }) {
  const base = `/api/v1/organizations/${orgId}`;
  const risk = useSection<{ latest: RiskEvaluation | null }>(can('risk:read'), `${base}/risk/lots/${lotId}`);
  const mits = useSection<Array<{ id: string; title: string; factor_code: string; status: string; status_label: string; due_date: string; overdue: boolean }>>(can('mitigation:read'), `${base}/mitigations?lot_id=${lotId}`);
  const dd = useSection<{ cases: Array<{ id: string; case_number: string; lot_id: string; readiness_effective: string | null; readiness_label: string }> }>(can('dd:read'), `${base}/dd-cases`);
  return (
    <section className="card" aria-labelledby="lt-risk">
      <h2 id="lt-risk">Riesgo y debida diligencia</h2>
      <p className="field-help">Resultado técnico, mitigación y preparación del expediente son dimensiones distintas. Ninguna es una conclusión regulatoria ni una DDS presentada.</p>
      <h3>Evaluación de riesgo</h3>
      <SectionBody allowed={can('risk:read')} deniedText="Tu rol no consulta evaluaciones de riesgo." state={risk} loadingText="Cargando riesgo…">
        {(d) => d.latest ? (
          <p>
            <StatusBadge tone={RESULT_TONE[d.latest.technical_result.status] ?? 'neutral'}>{d.latest.technical_result.label}</StatusBadge>{' '}
            {d.latest.freshness.status === 'STALE' ? <StatusBadge tone="review">Desactualizada</StatusBadge> : <StatusBadge tone="neutral">Vigente</StatusBadge>}{' '}
            <span className="muted">evaluación {d.latest.evaluation_number} · {new Date(d.latest.evaluated_at).toLocaleString('es-EC')}</span>{' '}
            <Link href={`/organizaciones/${orgId}/riesgo/${lotId}`}>Ver evaluación</Link>
          </p>
        ) : <p>Aún no hay evaluaciones de riesgo de este lote. <Link href={`/organizaciones/${orgId}/riesgo/${lotId}`}>Ir a riesgo</Link></p>}
      </SectionBody>
      <h3>Mitigaciones</h3>
      <SectionBody allowed={can('mitigation:read')} deniedText="Tu rol no consulta mitigaciones." state={mits} loadingText="Cargando mitigaciones…">
        {(rows) => rows.length === 0 ? <p className="muted">Sin mitigaciones para este lote.</p> : (
          <ul className="plain" aria-label="Mitigaciones del lote">
            {rows.map((m) => <li key={m.id}><StatusBadge tone={MIT_TONE[m.status] ?? 'neutral'}>{m.status_label}</StatusBadge> <Link href={`/organizaciones/${orgId}/mitigaciones/${m.id}`}>{m.title}</Link> <span className="muted">· {m.factor_code} · plazo {m.due_date}{m.overdue ? ' (vencida)' : ''}</span></li>)}
          </ul>
        )}
      </SectionBody>
      <h3>Expediente de debida diligencia</h3>
      <SectionBody allowed={can('dd:read')} deniedText="Tu rol no consulta expedientes." state={dd} loadingText="Cargando expedientes…">
        {(d) => {
          const mine = d.cases.filter((c) => c.lot_id === lotId);
          return mine.length === 0 ? <p className="muted">Este lote no tiene expediente.</p> : (
            <ul className="plain" aria-label="Expedientes del lote">
              {mine.map((c) => <li key={c.id}><Link href={`/organizaciones/${orgId}/diligencia/${c.id}`}>{c.case_number}</Link> · {c.readiness_effective ? <StatusBadge tone={READINESS_TONE[c.readiness_effective] ?? 'neutral'}>{c.readiness_label}</StatusBadge> : <span className="muted">{c.readiness_label}</span>}</li>)}
            </ul>
          );
        }}
      </SectionBody>
    </section>
  );
}

/** Evidencias: el contrato vincula evidencias a productores y parcelas (P0-019); se llega por el origen visible. */
export function EvidenceSection({ orgId, can, plots, producers }: { orgId: string; can: (p: string) => boolean; plots: Array<{ id: string; code: string }>; producers: Array<{ id: string; code: string }> }) {
  return (
    <section className="card" aria-labelledby="lt-ev">
      <h2 id="lt-ev">Evidencias</h2>
      {!can('evidence:read') ? <p className="muted">Tu rol no consulta evidencias.</p> : (
        <>
          <p className="field-help">Las evidencias se vinculan hoy a productores y parcelas (no al lote). Consulta las del origen visible de este lote:</p>
          {plots.length === 0 && producers.length === 0 ? <p className="muted">No hay origen visible para tu rol en este lote.</p> : (
            <ul className="plain" aria-label="Origen con evidencias">
              {producers.map((p) => <li key={p.id}>Productor <Link href={`/organizaciones/${orgId}/productores/${p.id}`}>{p.code}</Link></li>)}
              {plots.map((p) => <li key={p.id}>Parcela <Link href={`/organizaciones/${orgId}/parcelas/${p.id}`}>{p.code}</Link></li>)}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
