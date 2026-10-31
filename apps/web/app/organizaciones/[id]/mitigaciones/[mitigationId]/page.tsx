'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';
import { ErrorDetails } from '../../../../../lib/deliveries';
import { MIT_TONE, OUTCOME_TONE } from '../../../../../lib/risk';

interface Mitigation {
  id: string; status: string; status_label: string; row_version: number;
  cause: { evaluation_id: string; evaluation_number: number; rule_set_version: string; factor_code: string; factor: { reason: string; result: string; category: string } | null; subject: { id: string; code: string } };
  title: string; acceptance_criteria: string; evidence_required: string; due_date: string; overdue: boolean; assignee: { name: string }; created_by: string;
  supports: Array<{ id: string; submission_number: number; kind: string; title: string | null; version_number: number | null; availability: string | null; expired: boolean | null; newer_version_exists: boolean | null; claim_type: string | null; added_by: string }>;
  submissions: Array<{ number: number; note: string; at: string; executor: string }>;
  decisions: Array<{ submission_number: number; decision: string; reason: string; at: string; verifier: string; criterion_met: boolean | null }>;
  corrections: Array<{ submission_number: number; support_accepted: boolean; reason: string; at: string; corrected_by: string }>;
  outcome: { support: { status: string; label: string }; action: { status: string; label: string }; cause: { status: string; label: string }; warning: string | null };
  reevaluation: { status: string; evaluation_id?: string; evaluation_number?: number; note: string } | null; requires_review: string[]; note: string;
  actions: { add_support: boolean; submit: boolean; decide: boolean; correct: boolean };
}
interface Candidate { document_id: string; title: string; versions: Array<{ id: string; version_number: number; availability: string }> }

// Detalle de mitigación (UX_UI §18.2): quién ejecuta y quién verifica; rechazo conserva soporte y motivo.
export default function MitigationDetailPage() {
  const ws = useWorkspace();
  const { mitigationId } = useParams<{ mitigationId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const [m, setM] = useState<Mitigation | null>(null);
  const [docs, setDocs] = useState<Candidate[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [op, setOp] = useState(() => crypto.randomUUID());
  const [f, setF] = useState({ version: '', note: '', reason: '', criterion: false, supportOk: true });
  const base = `/api/v1/organizations/${orgId}/mitigations/${mitigationId}`;
  const load = useCallback(async () => {
    if (!orgId || !ws.can('mitigation:read')) return;
    try { setM(await api<Mitigation>(base)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, ws, base]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!m?.actions.add_support) return;
    api<Array<{ id: string; title: string; versions: Array<{ id: string; version_number: number; availability: string }> }>>(`/api/v1/organizations/${orgId}/documents`)
      .then((d) => setDocs(d.map((x) => ({ document_id: x.id, title: x.title, versions: x.versions ?? [] })))).catch(() => setDocs([]));
  }, [m?.actions.add_support, orgId]);
  if (!ws.activeOrg) return null;
  if (!ws.can('mitigation:read')) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar mitigaciones.', request_id: null })} />;
  const crumbs = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Mitigaciones', href: `/organizaciones/${orgId}/mitigaciones` }];
  if (error) return <><Breadcrumb items={[...crumbs, { label: 'Mitigación' }]} /><ErrorPanel error={error} onRetry={load} /></>;
  if (!m) return <Loading label="Cargando mitigación…" />;
  async function run(path: string, body: Record<string, unknown>) {
    setActionError(null);
    try { const r = await api<{ mitigation: Mitigation }>(`${base}${path}`, { method: 'POST', body: { operation_id: op, ...body } }); setM(r.mitigation); setOp(crypto.randomUUID()); setF({ version: '', note: '', reason: '', criterion: false, supportOk: true }); } catch (err) { setActionError(err as ApiError); }
  }
  const decide = (decision: string) => (e?: FormEvent) => { e?.preventDefault(); void run('/decisions', { expected_version: m.row_version, decision, reason: f.reason, ...(decision === 'VERIFIED' ? { criterion_met: f.criterion } : {}) }); };
  return (
    <>
      <Breadcrumb items={[...crumbs, { label: m.title }]} />
      <PageHeader title={m.title} meta={<StatusBadge tone={MIT_TONE[m.status]}>{m.status_label}</StatusBadge>} />
      <Alert tone="info">{m.note}</Alert>
      {m.requires_review.length > 0 && <Alert tone="review" title="Requiere revisión"><ul>{m.requires_review.map((r, i) => <li key={i}>{r}</li>)}</ul></Alert>}
      <section className="card" aria-labelledby="mt-out">
        <h2 id="mt-out">Resultado por dimensión</h2>
        <dl className="props">
          <dt>Soporte</dt><dd><StatusBadge tone={OUTCOME_TONE[m.outcome.support.status]}>{m.outcome.support.label}</StatusBadge></dd>
          <dt>Acción (criterio)</dt><dd><StatusBadge tone={OUTCOME_TONE[m.outcome.action.status]}>{m.outcome.action.label}</StatusBadge></dd>
          <dt>Causa</dt><dd><StatusBadge tone={OUTCOME_TONE[m.outcome.cause.status]}>{m.outcome.cause.label}</StatusBadge></dd>
        </dl>
        {m.outcome.warning && <Alert tone="review" title="Revisa la verificación">{m.outcome.warning}</Alert>}
      </section>
      <section className="card" aria-labelledby="mt-case">
        <h2 id="mt-case">Caso y acción</h2>
        <dl className="props">
          <dt>Causa</dt><dd>{m.cause.factor_code}{m.cause.factor ? ` · ${m.cause.factor.reason}` : ''}</dd>
          <dt>Evaluación</dt><dd><Link href={`/organizaciones/${orgId}/riesgo/${m.cause.subject.id}`}>Evaluación {m.cause.evaluation_number} del lote {m.cause.subject.code}</Link> · reglas {m.cause.rule_set_version} (sin aprobar)</dd>
          <dt>Criterio de aceptación</dt><dd>{m.acceptance_criteria}</dd>
          <dt>Evidencia requerida</dt><dd>{m.evidence_required}</dd>
          <dt>Responsable</dt><dd>{m.assignee.name}</dd>
          <dt>Plazo</dt><dd>{m.due_date}{m.overdue && <> <StatusBadge tone="review">Vencida</StatusBadge></>}</dd>
          <dt>Creada por</dt><dd>{m.created_by}</dd>
        </dl>
      </section>
      <section className="card" aria-labelledby="mt-sup">
        <h2 id="mt-sup">Soportes por entrega</h2>
        {m.supports.length === 0 && <p className="muted">Sin soportes. Aportar un soporte no verifica la mitigación.</p>}
        <ul className="plain" aria-label="Soportes de la mitigación">{m.supports.map((s) => (
          <li key={s.id}>Entrega {s.submission_number}: {s.kind === 'DOCUMENT_VERSION' ? `${s.title} · versión ${s.version_number}${s.newer_version_exists ? ' (hay una más reciente; no la sustituye)' : ''}${s.expired ? ' · vencido' : ''}` : `Evidencia ${s.claim_type ?? ''}`} · aportado por {s.added_by}</li>
        ))}</ul>
        {m.actions.add_support && (
          <form className="form" onSubmit={(e) => { e.preventDefault(); void run('/supports', { document_version_id: f.version }); }}>
            <label htmlFor="mt-doc">Versión de documento</label>
            <select id="mt-doc" required value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })}>
              <option value="">Selecciona…</option>
              {docs.flatMap((d) => d.versions.map((v) => <option key={v.id} value={v.id}>{d.title} · v{v.version_number}{v.availability !== 'AVAILABLE' ? ' (no disponible)' : ''}</option>))}
            </select>
            <div className="actions"><button type="submit" className="secondary">Aportar soporte</button></div>
          </form>
        )}
        {m.actions.submit && (
          <form className="form" onSubmit={(e) => { e.preventDefault(); void run('/submit', { expected_version: m.row_version, note: f.note }); }}>
            <label htmlFor="mt-note">Nota de entrega</label><input id="mt-note" required minLength={3} maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
            <div className="actions"><button type="submit">Entregar para verificación</button></div>
          </form>
        )}
      </section>
      <section className="card" aria-labelledby="mt-rev">
        <h2 id="mt-rev">Revisión</h2>
        <ol className="plain" aria-label="Historia de la mitigación">
          {m.submissions.map((s) => <li key={`s${s.number}`}>Entrega {s.number} por {s.executor}: {s.note}</li>)}
          {m.decisions.map((d) => <li key={`d${d.submission_number}`}>{d.decision === 'VERIFIED' ? 'Verificada' : 'Rechazada'} (entrega {d.submission_number}) por {d.verifier}: {d.reason}{d.decision === 'VERIFIED' ? (d.criterion_met === true ? ' · criterio declarado cumplido' : ' · criterio no registrado') : ''}</li>)}
          {m.corrections.map((c) => <li key={`c${c.submission_number}`}>Verificación corregida (entrega {c.submission_number}) por {c.corrected_by}: {c.reason} · soporte {c.support_accepted ? 'aceptado' : 'no aceptado'} · criterio no cumplido</li>)}
        </ol>
        {m.actions.decide && (
          <form className="form" onSubmit={decide('VERIFIED')}>
            <p className="field-help">Quien ejecutó la mitigación no puede verificarla ni rechazarla (docs/13; sin política de excepción).</p>
            <label className="checkbox-row"><input type="checkbox" checked={f.criterion} onChange={(e) => setF({ ...f, criterion: e.target.checked })} /> Para verificar: confirmo que se cumple el criterio de aceptación («{m.acceptance_criteria}»), no solo que el soporte es aceptable.</label>
            <label htmlFor="mt-reason">Motivo de la decisión</label><input id="mt-reason" required minLength={3} maxLength={1000} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            <div className="actions"><button type="submit">Verificar</button><button type="button" className="secondary" onClick={() => decide('REJECTED')()}>Rechazar</button></div>
          </form>
        )}
        {m.actions.correct && (
          <form className="form" aria-label="Corregir verificación" onSubmit={(e) => { e.preventDefault(); void run('/corrections', { expected_version: m.row_version, support_accepted: f.supportOk, reason: f.reason }); }}>
            <p className="field-help">Si el criterio de aceptación no se cumple, corrige la verificación: la decisión original se conserva, la acción se reabre para una nueva entrega y se reevalúa el riesgo. Quien ejecutó no corrige.</p>
            <label className="checkbox-row"><input type="checkbox" checked={f.supportOk} onChange={(e) => setF({ ...f, supportOk: e.target.checked })} /> El soporte aportado sigue aceptado como soporte</label>
            <label htmlFor="mt-corr">Motivo de la corrección</label><input id="mt-corr" required minLength={10} maxLength={1000} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            <div className="actions"><button type="submit" className="secondary">Corregir verificación: criterio no cumplido</button></div>
          </form>
        )}
        {actionError && <><ErrorPanel error={actionError} /><ErrorDetails details={actionError.body.details} /></>}
      </section>
      {m.reevaluation && (
        <section className="card" aria-labelledby="mt-reev">
          <h2 id="mt-reev">Reevaluación</h2>
          <p>{m.reevaluation.status === 'PENDING' ? <StatusBadge tone="process">Pendiente</StatusBadge> : m.reevaluation.status === 'DONE' ? `Evaluación ${m.reevaluation.evaluation_number} registrada` : `Cubierta por la evaluación ${m.reevaluation.evaluation_number}`} · {m.reevaluation.note}</p>
          {m.reevaluation.status === 'PENDING' && <button type="button" className="secondary" onClick={() => void load()}>Actualizar</button>}
        </section>
      )}
    </>
  );
}
