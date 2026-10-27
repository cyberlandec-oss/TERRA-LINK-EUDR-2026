'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';
import { ACTION_LABEL, FILE_STATE, RELATION, REVIEW_REASON, STATUS, type Evidence } from '../../../../../lib/evidence';
import type { Doc } from '../../../../../lib/documents';

// UX_UI §17.3: explicación de una afirmación — soportes por versión, estados separados, decisiones y siguiente paso.
export default function EvidenceDetailPage() {
  const ws = useWorkspace();
  const { evidenceId } = useParams<{ evidenceId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const [e, setE] = useState<Evidence | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    try { setE(await api<Evidence>(`/api/v1/organizations/${orgId}/evidence/${evidenceId}`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, evidenceId]);
  useEffect(() => { void load(); }, [load]);

  if (!ws.activeOrg) return null;
  if (error && !e) return <ErrorPanel error={error} />;
  if (!e) return <Loading label="Cargando afirmación…" />;
  const base = `/api/v1/organizations/${orgId}/evidence/${e.id}`;
  const decide = async (action: string, label: string) => {
    setMsg(null); setError(null);
    try {
      await api(`${base}/${action}`, { method: 'POST', body: { expected_version: e.row_version, reason: reason.trim() || label, ...(action === 'verify' ? { contradictions_acknowledged: ack } : {}) } });
      setReason(''); setAck(false); setMsg(`${label}: registrado.`); await load();
    } catch (err) { setError(err as ApiError); if ((err as ApiError).status === 409) await load(); }
  };
  const anyDecision = e.actions.submit || e.actions.verify || e.actions.reject || e.actions.revoke || e.actions.reopen;
  const hasContradiction = e.sources.some((s) => s.active && s.relationship === 'CONTRADICTS');
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Evidencias', href: `/organizaciones/${orgId}/evidencias` }, { label: e.claim.label }]} />
      <PageHeader title={e.claim.label} meta={<StatusBadge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</StatusBadge>} />
      <section className="card">
        <dl className="props">
          <dt>Entidad</dt><dd>{e.entity.type === 'producer' ? <Link href={`/organizaciones/${orgId}/productores/${e.entity.id}`}>Productor</Link> : <Link href={`/organizaciones/${orgId}/parcelas/${e.entity.id}`}>Parcela</Link>}</dd>
          <dt>Alcance de la afirmación</dt><dd>{e.claim.limitation} <span className="muted">Fuente: {e.claim.source}</span></dd>
          <dt>Vigencia</dt><dd>{e.validity.from ?? '—'} → {e.validity.to ?? 'sin término'}{e.validity.expired ? ' (terminada)' : ''}</dd>
          <dt>Siguiente paso</dt><dd>{e.next_step}</dd>
        </dl>
        {e.requires_review && <p className="alert review" role="status">Requiere nueva revisión: {e.review_reasons.map((r) => REVIEW_REASON[r] ?? r).join('; ')}. La decisión anterior se conserva en el historial.</p>}
        <p className="muted">{e.note}</p>
      </section>
      {msg && <p className="alert valid" role="status">{msg}</p>}
      {error && <ErrorPanel error={error} />}
      <section className="card" aria-labelledby="src-h">
        <h2 id="src-h">Soportes</h2>
        {e.sources.length === 0 ? <p className="muted">Sin soportes visibles para ti.</p> : (
          <ol className="plain" aria-label="Soportes de la afirmación">
            {e.sources.map((s) => (
              <li key={s.id} className={s.active ? 'card' : 'card muted'}>
                <strong>{RELATION[s.relationship]}</strong> · {ws.can('document:read') ? <Link href={`/organizaciones/${orgId}/documentos/${s.document.id}`}>{s.document.title}</Link> : s.document.title} · versión {s.version.version_number}
                {s.version.newer_version_exists && <span> · <StatusBadge tone="review">Hay una versión más reciente</StatusBadge></span>}
                <div className="muted">{s.document.type_label}{s.document.content_access === 'RESTRICTED' ? ' · contenido restringido para tu rol' : ''}</div>
                <div>{FILE_STATE[s.version.availability] ?? s.version.availability} · {s.version.validity === 'EXPIRED' ? 'Vencido' : 'Vigente o sin vencimiento'} · revisión documental: {s.version.review === 'ACCEPTED' ? 'aceptada' : s.version.review === 'REJECTED' ? 'rechazada' : 'sin revisar'}</div>
                {s.note && <div className="muted">Nota: {s.note}</div>}
                {s.withdrawn && <div>Retirado: {s.withdrawn.reason}</div>}
              </li>
            ))}
          </ol>
        )}
        {e.actions.add_source && <AddSource orgId={orgId} e={e} onDone={load} />}
      </section>
      {anyDecision && (
        <section className="card form" aria-labelledby="dec-h">
          <h2 id="dec-h">Decisión</h2>
          <label htmlFor="dec-reason">Motivo</label>
          <input id="dec-reason" value={reason} onChange={(x) => setReason(x.target.value)} />
          {e.actions.verify && hasContradiction && <label><input type="checkbox" checked={ack} onChange={(x) => setAck(x.target.checked)} /> Evalué expresamente los soportes que contradicen la afirmación</label>}
          <div className="actions">
            {e.actions.submit && <button type="button" onClick={() => decide('submit', 'Envío a revisión')}>Enviar a revisión</button>}
            {e.actions.verify && <button type="button" disabled={reason.trim().length < 3} onClick={() => decide('verify', 'Verificación')}>Verificar afirmación</button>}
            {e.actions.reject && <button type="button" className="secondary" disabled={reason.trim().length < 3} onClick={() => decide('reject', 'Rechazo')}>Rechazar</button>}
            {e.actions.revoke && <button type="button" className="secondary" disabled={reason.trim().length < 3} onClick={() => decide('revoke', 'Revocación')}>Revocar verificación</button>}
            {e.actions.reopen && <button type="button" className="secondary" disabled={reason.trim().length < 3} onClick={() => decide('reopen', 'Reapertura')}>Reabrir</button>}
          </div>
        </section>
      )}
      <section className="card" aria-labelledby="hist-h">
        <h2 id="hist-h">Historial de decisiones</h2>
        {e.decisions.length === 0 ? <p className="muted">Sin decisiones.</p> : (
          <ol className="plain" aria-label="Decisiones">
            {e.decisions.map((d, i) => <li key={i}><strong>{ACTION_LABEL[d.action] ?? d.action}</strong> · {STATUS[d.from_status as Evidence['status']]?.label ?? d.from_status} → {STATUS[d.to_status as Evidence['status']]?.label ?? d.to_status} · {d.actor} · {new Date(d.decided_at).toLocaleString('es-EC')} · motivo: {d.reason}{d.contradictions_acknowledged ? ' · contradicciones evaluadas' : ''}</li>)}
          </ol>
        )}
      </section>
    </>
  );
}

function AddSource({ orgId, e, onDone }: { orgId: string; e: Evidence; onDone: () => Promise<void> }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docId, setDocId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [relationship, setRelationship] = useState('SUPPORTS');
  const [note, setNote] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  useEffect(() => { api<Doc[]>(`/api/v1/organizations/${orgId}/documents`).then(setDocs).catch(() => setDocs([])); }, [orgId]);
  const doc = docs.find((d) => d.id === docId);
  async function add() {
    setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/evidence/${e.id}/sources`, { method: 'POST', body: { operation_id: operationId, expected_version: e.row_version, document_version_id: versionId, relationship, ...(note.trim() ? { note: note.trim() } : {}) } });
      setOperationId(crypto.randomUUID()); setDocId(''); setVersionId(''); setNote('');
      await onDone();
    } catch (err) { setError(err as ApiError); }
  }
  return (
    <div className="form">
      <h3>Vincular soporte</h3>
      <p className="muted">El soporte apunta a una versión concreta. Una versión nueva del documento no sustituye este vínculo ni hereda su revisión.</p>
      <div className="grid-2">
        <div><label htmlFor="src-doc">Documento</label>
          <select id="src-doc" value={docId} onChange={(x) => { setDocId(x.target.value); setVersionId(''); }}>
            <option value="">Selecciona…</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.title} ({d.type_label})</option>)}
          </select></div>
        <div><label htmlFor="src-ver">Versión</label>
          <select id="src-ver" value={versionId} disabled={!doc} onChange={(x) => setVersionId(x.target.value)}>
            <option value="">Selecciona…</option>{doc?.versions.map((v) => <option key={v.id} value={v.id}>v{v.version_number}{v.is_current ? ' (vigente)' : ''} · {FILE_STATE[v.availability] ?? v.availability}</option>)}
          </select></div>
        <div><label htmlFor="src-rel">Relación</label>
          <select id="src-rel" value={relationship} onChange={(x) => setRelationship(x.target.value)}>
            {Object.entries(RELATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label htmlFor="src-note">Nota <span className="muted">(opcional)</span></label><input id="src-note" value={note} onChange={(x) => setNote(x.target.value)} /></div>
      </div>
      {error && <ErrorPanel error={error} />}
      <div className="actions"><button type="button" disabled={!versionId} onClick={add}>Vincular soporte</button></div>
    </div>
  );
}
