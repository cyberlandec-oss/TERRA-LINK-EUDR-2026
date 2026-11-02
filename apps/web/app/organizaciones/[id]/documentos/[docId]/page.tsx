'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, apiDownload, apiUpload } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';
import { AVAILABILITY, OWNER_LABEL, VALIDITY, kb, type Doc, type DocVersion } from '../../../../../lib/documents';

// UX_UI §17: ficha de documento — metadatos, versiones, análisis, revisión por versión, descarga autorizada y vínculos.
export default function DocumentDetailPage() {
  const ws = useWorkspace();
  const { docId } = useParams<{ docId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const [d, setD] = useState<Doc | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try { setD(await api<Doc>(`/api/v1/organizations/${orgId}/documents/${docId}`)); setError(null); } catch (e) { setError(e as ApiError); }
  }, [orgId, docId]);
  useEffect(() => { void load(); }, [load]);

  if (!ws.activeOrg) return null;
  if (error && !d) return <ErrorPanel error={error} />;
  if (!d) return <Loading label="Cargando documento…" />;
  const base = `/api/v1/organizations/${orgId}/documents/${d.id}`;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null); setError(null);
    try { await fn(); setMsg(ok); await load(); } catch (e) { setError(e as ApiError); }
  };
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Documentos', href: `/organizaciones/${orgId}/documentos` }, { label: d.title }]} />
      <PageHeader title={d.title} meta={`${d.type_label} · titular: ${OWNER_LABEL[d.owner_type] ?? d.owner_type}`} />
      <p className="muted">{d.note}</p>
      {d.content_access === 'RESTRICTED' && <p className="alert review" role="note">Contiene datos personales: tu rol puede ver los metadatos, no el contenido.</p>}
      {msg && <p className="alert valid" role="status">{msg}</p>}
      {error && <ErrorPanel error={error} />}
      <section className="card" aria-labelledby="versions-h">
        <h2 id="versions-h">Versiones</h2>
        <ol className="plain" aria-label="Versiones del documento">
          {d.versions.map((v) => <VersionItem key={v.id} v={v} canReview={ws.can('document:review')} canUpload={ws.can('document:upload')}
            extractionHref={ws.can('document:read') ? `/organizaciones/${orgId}/documentos/${d.id}/extraccion/${v.id}` : null}
            onDownload={() => act(() => apiDownload(`${base}/versions/${v.id}/content`, v.file_name ?? 'documento'), `Versión ${v.version_number} descargada.`)}
            onRetry={() => act(() => api(`${base}/versions/${v.id}/scan`, { method: 'POST' }), 'Análisis reintentado.')}
            onReview={(decision, reason) => act(() => api(`${base}/versions/${v.id}/reviews`, { method: 'POST', body: { decision, reason } }), 'Revisión registrada para esta versión.')} />)}
        </ol>
      </section>
      {ws.can('document:upload') && <NewVersion orgId={orgId} doc={d} onDone={load} />}
      <section className="card" aria-labelledby="links-h">
        <h2 id="links-h">Dónde se usa</h2>
        <p><strong>Titular:</strong> {OWNER_LABEL[d.owner_type] ?? d.owner_type}. El titular es a quién pertenece el documento; no es lo mismo que usarlo como soporte de una entrega.</p>
        <h3>Soporte de entregas</h3>
        {d.delivery_usage === null ? (
          <p className="muted">{ws.can('document:upload') && !ws.can('delivery:create') ? 'Puedes aportar el archivo; el personal autorizado de acopio lo vincula a la entrega correspondiente. ' : ''}Tu alcance no permite consultar las entregas de la organización, por lo que aquí no se puede saber si este documento ya se usa como soporte.</p>
        ) : d.delivery_usage.length === 0 ? (
          <p className="muted">Este documento todavía no está asociado a una entrega.{ws.can('delivery:create') ? <> Para vincularlo: <a href={`/organizaciones/${orgId}/entregas`}>Entregas</a> → abrir la entrega → «Soportes documentales» → «Vincular soporte».</> : null}</p>
        ) : (
          <ul className="plain">{d.delivery_usage.map((u) => (
            <li key={`${u.delivery_id}:${u.version_id}:${u.added_at}`}>
              <a href={`/organizaciones/${orgId}/entregas/${u.delivery_id}`}>{u.delivery_code}</a> · versión {u.version_number} · {u.status === 'ACTIVE' ? 'vínculo vigente' : `vínculo retirado${u.withdrawn_reason ? `: ${u.withdrawn_reason}` : ''}`}
            </li>
          ))}</ul>
        )}
        {d.links.length > 0 && <>
          <h3>Otros vínculos</h3>
          <ul className="plain">{d.links.map((l) => <li key={`${l.entity_type}:${l.entity_id}`}>{OWNER_LABEL[l.entity_type] ?? l.entity_type} · <code>{l.entity_id}</code></li>)}</ul>
        </>}
        <p className="muted">Vincular o subir un archivo no certifica su autenticidad ni lo aprueba: la revisión humana de cada versión es un paso aparte.</p>
      </section>
    </>
  );
}

function VersionItem({ v, canReview, canUpload, extractionHref, onDownload, onRetry, onReview }: {
  v: DocVersion; canReview: boolean; canUpload: boolean; extractionHref: string | null;
  onDownload: () => void; onRetry: () => void; onReview: (d: 'ACCEPTED' | 'REJECTED', r: string) => void;
}) {
  const [reason, setReason] = useState('');
  const id = `rv-${v.id}`;
  return (
    <li className="card">
      <strong>v{v.version_number}{v.is_current ? ' (vigente)' : ''}</strong>{' '}
      <StatusBadge tone={AVAILABILITY[v.availability].tone}>{AVAILABILITY[v.availability].label}</StatusBadge>
      <dl className="props">
        <dt>Archivo</dt><dd>{v.file_name ?? 'restringido'} · {v.mime_type} · {kb(v.size_bytes)}</dd>
        <dt>SHA-256 (servidor)</dt><dd><code className="hash">{v.sha256}</code></dd>
        {/* P1-013: la extracción cuelga de ESTA versión, no del documento. */}
        {extractionHref && <><dt>Extracción asistida</dt><dd><a href={extractionHref}>Ver o extraer de esta versión</a></dd></>}
        <dt>Análisis antimalware</dt><dd>{v.scan.status}{v.scan.error_code ? ` · ${v.scan.error_code}` : ''}{v.scan.signature ? ` · ${v.scan.signature}` : ''}</dd>
        <dt>Emisor / emisión / vencimiento</dt><dd>{v.issuer ?? '—'} / {v.issued_at ?? '—'} / {v.expires_at ?? '—'} · {VALIDITY[v.validity]}</dd>
        <dt>Revisión de esta versión</dt><dd>{v.review ? `Revisión humana: ${v.review.decision === 'ACCEPTED' ? 'aceptada' : 'rechazada'} por ${v.review.reviewer ?? 'una persona autorizada'} el ${new Date(v.review.reviewed_at).toLocaleString('es-EC')}. Motivo: ${v.review.reason}${v.review.reviewer_is_uploader ? ' (revisó quien la subió)' : ''}. Es la valoración de esa persona; no es una certificación de Terra Link.` : 'Sin revisar (las revisiones no se heredan entre versiones)'}</dd>
      </dl>
      <div className="actions">
        {v.downloadable && <button type="button" className="secondary" onClick={onDownload}>Descargar v{v.version_number}</button>}
        {canUpload && v.scan.status === 'FAILED' && <button type="button" className="secondary" onClick={onRetry}>Reintentar análisis</button>}
      </div>
      {canReview && v.availability === 'AVAILABLE' && (
        <div className="actions">
          <label htmlFor={id}>Motivo de la revisión</label>
          <input id={id} value={reason} minLength={3} onChange={(e) => setReason(e.target.value)} />
          <button type="button" disabled={reason.trim().length < 3} onClick={() => onReview('ACCEPTED', reason.trim())}>Aceptar versión</button>
          <button type="button" className="secondary" disabled={reason.trim().length < 3} onClick={() => onReview('REJECTED', reason.trim())}>Rechazar versión</button>
        </div>
      )}
    </li>
  );
}

function NewVersion({ orgId, doc, onDone }: { orgId: string; doc: Doc; onDone: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState({ issuer: '', issued_at: '', expires_at: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const op = useRef<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    op.current ??= crypto.randomUUID();
    setBusy(true); setError(null);
    const form = new FormData();
    form.append('operation_id', op.current);
    form.append('expected_version', String(doc.row_version));
    for (const [k, v] of Object.entries(meta)) if (v) form.append(k, v);
    form.append('file', file, file.name);
    try { await apiUpload(`/api/v1/organizations/${orgId}/documents/${doc.id}/versions`, form); op.current = null; setFile(null); await onDone(); }
    catch (err) { const ae = err as ApiError; if (!(ae.status === 0 || ae.status >= 500)) op.current = null; setError(ae); }
    finally { setBusy(false); }
  }
  return (
    <section className="card form" aria-labelledby="nv-h">
      <h2 id="nv-h">Subir nueva versión</h2>
      <p className="muted">La versión anterior se conserva con sus bytes, análisis y revisión. La nueva versión empieza sin revisar.</p>
      <form onSubmit={submit}>
        <div className="grid-2">
          <div><label htmlFor="nv-file">Archivo</label><input id="nv-file" type="file" required accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { setFile(e.target.files?.[0] ?? null); op.current = null; }} /></div>
          <div><label htmlFor="nv-issuer">Emisor <span className="muted">(opcional)</span></label><input id="nv-issuer" value={meta.issuer} onChange={(e) => setMeta({ ...meta, issuer: e.target.value })} /></div>
          <div><label htmlFor="nv-issued">Emisión <span className="muted">(opcional)</span></label><input id="nv-issued" type="date" value={meta.issued_at} onChange={(e) => setMeta({ ...meta, issued_at: e.target.value })} /></div>
          <div><label htmlFor="nv-expires">Vencimiento <span className="muted">(opcional)</span></label><input id="nv-expires" type="date" value={meta.expires_at} onChange={(e) => setMeta({ ...meta, expires_at: e.target.value })} /></div>
        </div>
        {error && <ErrorPanel error={error} />}
        {error?.body.code === 'VERSION_CONFLICT' && <p className="muted">Recarga la ficha: otra persona subió una versión. Tu archivo y metadatos se conservan en el formulario.</p>}
        <div className="actions"><button type="submit" disabled={busy || !file} aria-busy={busy}>{busy ? 'Subiendo y analizando…' : 'Subir versión'}</button></div>
      </form>
    </section>
  );
}
