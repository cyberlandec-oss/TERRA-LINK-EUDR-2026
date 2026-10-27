'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, apiUpload } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { AVAILABILITY, OWNER_LABEL, VALIDITY, kb, type Doc, type DocType } from '../../../../lib/documents';

// UX_UI §17: centro de documentos y carga. Etapas observables: transferencia → análisis antimalware → registro.
export default function DocumentsPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const canRead = ws.can('document:read');
  const canUpload = ws.can('document:upload');
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [types, setTypes] = useState<{ types: DocType[]; limits: { max_bytes: number; formats: string[] } } | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !canRead) return;
    try {
      const [d, t] = await Promise.all([
        api<Doc[]>(`/api/v1/organizations/${orgId}/documents${filter ? `?document_type=${filter}` : ''}`),
        api<{ types: DocType[]; limits: { max_bytes: number; formats: string[] } }>(`/api/v1/organizations/${orgId}/document-types`),
      ]);
      setDocs(d); setTypes(t); setError(null);
    } catch (e) { setError(e as ApiError); }
  }, [orgId, canRead, filter]);
  useEffect(() => { void load(); }, [load]);

  if (!ws.activeOrg) return null;
  if (!canRead) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar documentos.', request_id: null })} />;
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Documentos' }]} />
      <PageHeader title="Documentos" meta="Archivos privados con versiones. Subir un documento no lo convierte en evidencia aprobada." />
      <div className="card">
        <label htmlFor="doc-filter">Tipo</label>
        <select id="doc-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todos</option>
          {types?.types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
        </select>
      </div>
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!docs && !error && <Loading label="Cargando documentos…" />}
      {docs && docs.length === 0 && <EmptyState title={filter ? 'No hay documentos de este tipo a tu alcance.' : 'Aún no hay documentos a tu alcance.'} />}
      {docs && docs.length > 0 && (
        <div className="table-wrap">
          <table aria-label="Documentos">
            <thead><tr><th scope="col">Documento</th><th scope="col">Tipo</th><th scope="col">Titular</th><th scope="col">Versión vigente</th><th scope="col">Vigencia</th></tr></thead>
            <tbody>
              {docs.map((d) => {
                const v = d.versions.find((x) => x.is_current) ?? d.versions[0];
                return (
                  <tr key={d.id}>
                    <td><Link href={`/organizaciones/${orgId}/documentos/${d.id}`}>{d.title}</Link></td>
                    <td>{d.type_label}</td>
                    <td>{OWNER_LABEL[d.owner_type] ?? d.owner_type}</td>
                    <td>v{v.version_number} · <StatusBadge tone={AVAILABILITY[v.availability].tone}>{AVAILABILITY[v.availability].label}</StatusBadge>{v.review && <span className="muted"> · revisión: {v.review.decision === 'ACCEPTED' ? 'aceptado' : 'rechazado'}</span>}</td>
                    <td>{VALIDITY[v.validity]}{v.expires_at ? ` (${v.expires_at})` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canUpload && types && <UploadDocument orgId={orgId} types={types.types} limits={types.limits} onDone={load} />}
    </>
  );
}

type Stage = 'idle' | 'transfer' | 'done' | 'error';

function UploadDocument({ orgId, types, limits, onDone }: { orgId: string; types: DocType[]; limits: { max_bytes: number; formats: string[] }; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ document_type: '', owner_type: '', owner_id: '', title: '', issuer: '', issued_at: '', expires_at: '' });
  const [file, setFile] = useState<File | null>(null);
  const [owners, setOwners] = useState<Array<{ id: string; label: string }>>([]);
  const [stage, setStage] = useState<Stage>('idle');
  const [result, setResult] = useState<Doc | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const op = useRef<string | null>(null);
  const type = types.find((t) => t.code === f.document_type);

  useEffect(() => {
    if (f.owner_type !== 'producer' && f.owner_type !== 'plot') { setOwners([]); return; }
    const path = f.owner_type === 'producer' ? 'producers' : 'plots';
    api<{ items: Array<{ id: string; producer_code?: string; plot_code?: string; legal_name?: string | null; display_name?: string; name?: string | null }> }>(`/api/v1/organizations/${orgId}/${path}?limit=100`)
      .then((r) => setOwners(r.items.map((x) => ({ id: x.id, label: x.producer_code ? `${x.producer_code} · ${x.display_name ?? x.legal_name ?? ''}` : `${x.plot_code}${x.name ? ` · ${x.name}` : ''}` }))))
      .catch(() => setOwners([]));
  }, [f.owner_type, orgId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    op.current ??= crypto.randomUUID(); // un reintento tras un fallo de red no duplica el documento
    setStage('transfer'); setError(null); setResult(null);
    const form = new FormData();
    form.append('operation_id', op.current);
    for (const [k, v] of Object.entries(f)) if (v) form.append(k, v);
    form.append('file', file, file.name);
    try {
      const r = await apiUpload<{ document: Doc }>(`/api/v1/organizations/${orgId}/documents`, form);
      setResult(r.data.document); setStage('done'); op.current = null;
      await onDone();
    } catch (err) {
      const ae = err as ApiError;
      if (!(ae.status === 0 || ae.status >= 500)) op.current = null;
      setError(ae); setStage('error'); // los metadatos se conservan
    }
  }

  const v = result?.versions[0];
  return (
    <section className="card form" aria-labelledby="up-doc">
      <h2 id="up-doc">Subir documento</h2>
      <p className="muted">Formatos: PDF, JPEG o PNG, hasta {kb(limits.max_bytes)}. Se verifica el tipo real del archivo y se analiza con antivirus antes de quedar disponible. El hash y el análisis no prueban autenticidad ni validez jurídica.</p>
      <form onSubmit={submit}>
        <div className="grid-2">
          <div>
            <label htmlFor="up-type">Tipo de documento</label>
            <select id="up-type" required value={f.document_type} onChange={(e) => setF({ ...f, document_type: e.target.value, owner_type: '', owner_id: '' })}>
              <option value="">Selecciona…</option>
              {types.map((t) => <option key={t.code} value={t.code}>{t.label}{t.classification === 'PERSONAL_DATA' ? ' (datos personales)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="up-owner-type">Titular</label>
            <select id="up-owner-type" required value={f.owner_type} onChange={(e) => setF({ ...f, owner_type: e.target.value, owner_id: '' })} disabled={!type}>
              <option value="">Selecciona…</option>
              {type?.allowed_owner_types.map((o) => <option key={o} value={o} disabled={o === 'delivery'}>{OWNER_LABEL[o] ?? o}{o === 'delivery' ? ' (disponible con P0-012)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="up-owner">{f.owner_type === 'plot' ? 'Parcela' : 'Productor'}</label>
            <select id="up-owner" required value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} disabled={!owners.length}>
              <option value="">Selecciona…</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div><label htmlFor="up-title">Título</label><input id="up-title" required maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div><label htmlFor="up-issuer">Emisor <span className="muted">(opcional)</span></label><input id="up-issuer" maxLength={160} value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></div>
          <div><label htmlFor="up-issued">Fecha de emisión <span className="muted">(opcional)</span></label><input id="up-issued" type="date" value={f.issued_at} onChange={(e) => setF({ ...f, issued_at: e.target.value })} /></div>
          <div><label htmlFor="up-expires">Fecha de vencimiento <span className="muted">(opcional)</span></label><input id="up-expires" type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></div>
          <div><label htmlFor="up-file">Archivo</label><input id="up-file" type="file" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => { setFile(e.target.files?.[0] ?? null); op.current = null; }} /></div>
        </div>
        <ol className="plain stages" aria-label="Etapas de la carga">
          <li>Transferencia: {stage === 'transfer' ? 'en curso…' : stage === 'done' ? 'completa' : stage === 'error' ? 'no completada' : 'pendiente'}</li>
          <li>Análisis antimalware: {stage === 'transfer' ? 'en curso…' : v ? (v.scan.status === 'CLEAN' ? 'limpio' : v.scan.status === 'FAILED' ? `fallido (${v.scan.error_code}); queda pendiente` : v.scan.status) : error?.body.code === 'FILE_REJECTED_MALWARE' ? 'rechazado: archivo no almacenado' : 'pendiente'}</li>
          <li>Registro: {v ? `versión ${v.version_number} registrada` : 'pendiente'}</li>
        </ol>
        {error && <ErrorPanel error={error} />}
        {result && v && <p className="alert valid" role="status">Documento registrado: <Link href={`/organizaciones/${orgId}/documentos/${result.id}`}>{result.title}</Link> · {AVAILABILITY[v.availability].label}.</p>}
        <div className="actions"><button type="submit" disabled={stage === 'transfer' || !file} aria-busy={stage === 'transfer'}>{stage === 'transfer' ? 'Subiendo y analizando…' : 'Subir documento'}</button></div>
      </form>
    </section>
  );
}
