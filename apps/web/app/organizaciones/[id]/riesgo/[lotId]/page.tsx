'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';
import { CATEGORY, CATEGORY_STATUS, EFFECT, FACTOR_RESULT, PROCESS, RESULT_TONE, type RiskEvaluation, type RiskFactor } from '../../../../../lib/risk';

interface LotRisk { lot: { id: string; lot_code: string }; latest: RiskEvaluation | null; history: Array<{ id: string; evaluation_number: number; technical_result: { status: string; label: string }; freshness: { status: string }; evaluated_at: string; evaluated_by: string; process_status: string }>; rule_set: { version: string; approval_status: string; notes: string }; can_evaluate: boolean }

function FactorList({ items, label }: { items: RiskFactor[]; label: string }) {
  if (!items.length) return <p className="muted">Ninguno.</p>;
  return (
    <ul className="plain" aria-label={label}>{items.map((f) => (
      <li key={f.code}><strong>{f.code}</strong> · {CATEGORY[f.category] ?? f.category} · {FACTOR_RESULT[f.result]}{f.result === 'HIT' ? ` (${EFFECT[f.effect] ?? f.effect})` : ''}
        <div>{f.reason}{f.references.length ? ` · ${f.references.join(', ')}` : ''}</div>
        <div className="field-help">{f.limit} Fuente: {f.source}.</div></li>
    ))}</ul>
  );
}

// Riesgo de un lote: dimensiones separadas (hallazgos técnicos, calidad de datos, resultado de riesgo, revisión humana).
export default function LotRiskPage() {
  const ws = useWorkspace();
  const { lotId } = useParams<{ lotId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const [d, setD] = useState<LotRisk | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [op, setOp] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState('');
  const load = useCallback(async () => {
    if (!orgId || !ws.can('risk:read')) return;
    try { setD(await api<LotRisk>(`/api/v1/organizations/${orgId}/risk/lots/${lotId}`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, lotId, ws]);
  useEffect(() => { void load(); }, [load]);
  if (!ws.activeOrg) return null;
  if (!ws.can('risk:read')) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar evaluaciones de riesgo.', request_id: null })} />;
  const crumbs = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Riesgo', href: `/organizaciones/${orgId}/riesgo` }];
  if (error) return <><Breadcrumb items={[...crumbs, { label: 'Lote' }]} /><ErrorPanel error={error} onRetry={load} /></>;
  if (!d) return <Loading label="Cargando evaluación…" />;
  const e = d.latest;
  async function run(fn: () => Promise<unknown>) {
    setActionError(null); setBusy(true);
    try { await fn(); setOp(crypto.randomUUID()); setReason(''); await load(); } catch (err) { setActionError(err as ApiError); } finally { setBusy(false); }
  }
  const evaluate = () => run(() => api(`/api/v1/organizations/${orgId}/risk/lots/${lotId}/evaluations`, { method: 'POST', body: { operation_id: op, ...(e ? { based_on_evaluation_id: e.id } : {}) } }));
  const review = (ev: FormEvent) => { ev.preventDefault(); if (!e) return; void run(() => api(`/api/v1/organizations/${orgId}/risk/evaluations/${e.id}/reviews`, { method: 'POST', body: { operation_id: op, action: e.review.process_status === 'OPEN' ? 'START_REVIEW' : 'RESOLVE', reason } })); };
  return (
    <>
      <Breadcrumb items={[...crumbs, { label: d.lot.lot_code }]} />
      <PageHeader title={`Riesgo del lote ${d.lot.lot_code}`} meta={<Link href={`/organizaciones/${orgId}/lotes/${d.lot.id}`}>Abrir el lote</Link>} />
      <Alert tone="info">Reglas {d.rule_set.version} ({d.rule_set.approval_status === 'NOT_APPROVED' ? 'sin aprobar' : 'aprobadas'}): {d.rule_set.notes}</Alert>
      {d.can_evaluate && <p><button type="button" disabled={busy} onClick={() => void evaluate()}>{e ? 'Reevaluar (nueva versión)' : 'Evaluar'}</button></p>}
      {e && <p><Link href={`/organizaciones/${orgId}/riesgo/${lotId}/conclusion`}>Conclusión humana de esta evaluación</Link></p>}
      {actionError && <ErrorPanel error={actionError} />}
      {!e && <p className="muted">Sin evaluaciones todavía.</p>}
      {e && <>
        {e.freshness.status === 'STALE' && <Alert tone="review" title="Evaluación desactualizada">{e.freshness.reason}</Alert>}
        <section className="card" aria-labelledby="rk-res">
          <h2 id="rk-res">Evaluación {e.evaluation_number}</h2>
          <dl className="props">
            <dt>Resultado técnico</dt><dd><StatusBadge tone={RESULT_TONE[e.technical_result.status]}>{e.technical_result.label}</StatusBadge></dd>
            {/* La severidad NUNCA se muestra sola: va con su cobertura, y una clasificación parcial se declara
                parcial. Sin esto, un «Alto» se leería como si se hubiera evaluado todo. */}
            <dt>Severidad de los hallazgos evaluados</dt>
            <dd>
              {e.risk_result.severity === 'NOT_ASSESSED' ? 'Sin clasificar' : (e.risk_result.severity_label ?? e.risk_result.severity)}
              {e.risk_result.severity_coverage && (
                <div className="field-help">
                  {e.risk_result.severity !== 'NOT_ASSESSED' && !e.risk_result.severity_coverage.complete && (
                    <strong>Clasificación PARCIAL: no es una evaluación completa del riesgo del lote. </strong>
                  )}
                  {e.risk_result.severity_coverage.reason}
                  <div>
                    Reglas evaluadas {e.risk_result.severity_coverage.evaluated} de {e.risk_result.severity_coverage.rules_total}
                    {e.risk_result.severity_coverage.not_evaluable > 0 && <> · sin poder evaluar: {e.risk_result.severity_coverage.not_evaluable_codes.join(', ')}</>}
                    {e.risk_result.severity_coverage.hits_without_declared_severity.length > 0 && <> · hallazgos sin severidad declarada: {e.risk_result.severity_coverage.hits_without_declared_severity.join(', ')}</>}
                    {e.risk_result.severity_coverage.categories_without_rules.length > 0 && <> · categorías SIN ninguna regla: {e.risk_result.severity_coverage.categories_without_rules.join(', ')}</>}
                  </div>
                  <div>{e.risk_result.severity_coverage.note}</div>
                </div>
              )}
            </dd>
            <dt>Conclusión regulatoria</dt><dd>{e.risk_result.conclusion === 'UNDETERMINED' ? 'Indeterminada' : e.risk_result.conclusion}<div className="field-help">{e.risk_result.note}</div></dd>
            <dt>Revisión humana</dt><dd>{PROCESS[e.review.process_status]}</dd>
            <dt>Evaluada</dt><dd>{new Date(e.evaluated_at).toLocaleString('es-EC')}</dd>
            <dt>{e.provenance.mode === 'AUTOMATIC' ? 'Desencadenada por' : 'Solicitada por'}</dt><dd>{e.provenance.triggered_by}{e.provenance.trigger_kind === 'MITIGATION_VERIFIED' ? ' (verificación de mitigación)' : e.provenance.trigger_kind === 'MITIGATION_VERIFICATION_CORRECTED' ? ' (corrección de una verificación)' : ''}</dd>
            <dt>Ejecutada por</dt><dd>{e.provenance.executed_by}</dd>
            <dt>Resultado revisado por</dt><dd>{e.provenance.reviewed_by ?? 'Nadie todavía (revisión humana pendiente)'}</dd>
            <dt>Instantánea</dt><dd><code className="hash">{e.snapshot.hash}</code></dd>
          </dl>
        </section>
        <section className="card" aria-labelledby="rk-find"><h2 id="rk-find">Hallazgos técnicos</h2><FactorList items={e.technical_findings} label="Hallazgos técnicos" /></section>
        <section className="card" aria-labelledby="rk-dq"><h2 id="rk-dq">Calidad de datos: no evaluable o faltante</h2><p className="muted">Lo no evaluable nunca cuenta como favorable.</p><FactorList items={e.data_quality} label="No evaluable o faltante" /></section>
        <section className="card" aria-labelledby="rk-cat"><h2 id="rk-cat">Categorías</h2>
          <ul className="plain" aria-label="Categorías">{e.categories.map((c) => <li key={c.category}>{CATEGORY[c.category] ?? c.category}: {CATEGORY_STATUS[c.status] ?? c.status}{c.note ? ` · ${c.note}` : ''}</li>)}</ul>
        </section>
        <section className="card" aria-labelledby="rk-rev">
          <h2 id="rk-rev">Revisión humana</h2>
          <p className="muted">{e.review.note}</p>
          <ol className="plain" aria-label="Historia de revisión">{e.review.history.map((r, i) => <li key={i}>{r.action === 'START_REVIEW' ? 'Revisión iniciada' : 'Revisión resuelta'}: {r.reason} · {r.reviewer}</li>)}</ol>
          {e.actions.review && (
            <form className="inline-form" onSubmit={review}>
              <label htmlFor="rk-reason">{e.review.process_status === 'OPEN' ? 'Motivo para iniciar la revisión' : 'Motivo de la resolución'}</label>
              <input id="rk-reason" required minLength={3} maxLength={500} value={reason} onChange={(x) => setReason(x.target.value)} />
              <button type="submit" className="secondary inline" disabled={busy}>{e.review.process_status === 'OPEN' ? 'Iniciar revisión' : 'Resolver revisión'}</button>
            </form>
          )}
        </section>
      </>}
      {e && <LotMitigations orgId={orgId} lotId={d.lot.id} evaluationId={e.id} canManage={ws.can('mitigation:manage')} canRead={ws.can('mitigation:read')} />}
      {d.history.length > 0 && (
        <section className="card" aria-labelledby="rk-hist">
          <h2 id="rk-hist">Versiones</h2>
          <ol className="plain" aria-label="Versiones de la evaluación">{d.history.map((h) => <li key={h.id}>Evaluación {h.evaluation_number}: {h.technical_result.label} · {h.freshness.status === 'STALE' ? 'desactualizada' : 'vigente'} · {new Date(h.evaluated_at).toLocaleString('es-EC')} · {h.evaluated_by}</li>)}</ol>
        </section>
      )}
    </>
  );
}

interface MitRow { id: string; title: string; factor_code: string; status: string; status_label: string; due_date: string; assignee: string }
interface MitOptions { factors: Array<{ code: string; result: string; reason: string; evidence_required: string | null }>; not_actionable_note: string; assignees: Array<{ membership_id: string; name: string }> }

/** Mitigaciones del lote y alta ligada a una causa de la evaluación vigente (solo causas mitigables). */
function LotMitigations({ orgId, lotId, evaluationId, canManage, canRead }: { orgId: string; lotId: string; evaluationId: string; canManage: boolean; canRead: boolean }) {
  const [rows, setRows] = useState<MitRow[]>([]);
  const [opts, setOpts] = useState<MitOptions | null>(null);
  const [f, setF] = useState({ factor: '', title: '', criteria: '', assignee: '', due: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [op, setOp] = useState(() => crypto.randomUUID());
  const load = useCallback(async () => {
    if (canRead) setRows(await api<MitRow[]>(`/api/v1/organizations/${orgId}/mitigations?lot_id=${lotId}`).catch(() => []));
    if (canManage) setOpts(await api<MitOptions>(`/api/v1/organizations/${orgId}/mitigation-options?evaluation_id=${evaluationId}`).catch(() => null));
  }, [orgId, lotId, evaluationId, canManage, canRead]);
  useEffect(() => { void load(); }, [load]);
  if (!canRead) return null;
  async function create(ev: FormEvent) {
    ev.preventDefault(); setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/mitigations`, { method: 'POST', body: { operation_id: op, evaluation_id: evaluationId, factor_code: f.factor, title: f.title, acceptance_criteria: f.criteria, assignee_membership_id: f.assignee, due_date: f.due } });
      setOp(crypto.randomUUID()); setF({ factor: '', title: '', criteria: '', assignee: '', due: '' }); await load();
    } catch (err) { setError(err as ApiError); }
  }
  return (
    <section className="card" aria-labelledby="rk-mit">
      <h2 id="rk-mit">Mitigaciones</h2>
      {rows.length === 0 ? <p className="muted">Sin mitigaciones para este lote.</p> : (
        <ul className="plain" aria-label="Mitigaciones del lote">{rows.map((r) => <li key={r.id}><Link href={`/organizaciones/${orgId}/mitigaciones/${r.id}`}>{r.title}</Link> · {r.factor_code} · {r.status_label} · {r.assignee} · plazo {r.due_date}</li>)}</ul>
      )}
      {canManage && opts && (
        <form className="form" onSubmit={create} aria-label="Crear mitigación">
          <h3>Crear mitigación</h3>
          <p className="field-help">{opts.not_actionable_note}</p>
          <div className="grid-2">
            <div><label htmlFor="mi-factor">Causa</label>
              <select id="mi-factor" required value={f.factor} onChange={(x) => setF({ ...f, factor: x.target.value })}>
                <option value="">Selecciona…</option>{opts.factors.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.result === 'HIT' ? 'hallazgo' : 'dato faltante'}</option>)}
              </select></div>
            <div><label htmlFor="mi-assignee">Responsable</label>
              <select id="mi-assignee" required value={f.assignee} onChange={(x) => setF({ ...f, assignee: x.target.value })}>
                <option value="">Selecciona…</option>{opts.assignees.map((a) => <option key={a.membership_id} value={a.membership_id}>{a.name}</option>)}
              </select></div>
            <div><label htmlFor="mi-title">Acción</label><input id="mi-title" required minLength={3} maxLength={160} value={f.title} onChange={(x) => setF({ ...f, title: x.target.value })} /></div>
            <div><label htmlFor="mi-due">Plazo</label><input id="mi-due" type="date" required value={f.due} onChange={(x) => setF({ ...f, due: x.target.value })} /></div>
          </div>
          <label htmlFor="mi-criteria">Criterio de aceptación</label><textarea id="mi-criteria" required minLength={3} maxLength={1000} value={f.criteria} onChange={(x) => setF({ ...f, criteria: x.target.value })} />
          {f.factor && <p className="field-help">Evidencia requerida por la regla: {opts.factors.find((c) => c.code === f.factor)?.evidence_required ?? '—'}</p>}
          {error && <ErrorPanel error={error} />}
          <div className="actions"><button type="submit">Crear mitigación</button></div>
        </form>
      )}
    </section>
  );
}
