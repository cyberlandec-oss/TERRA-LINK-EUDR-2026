'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { UploadDocument } from '../../../../lib/document-upload';
import { AVAILABILITY, OWNER_LABEL, VALIDITY, type Doc, type DocType } from '../../../../lib/documents';

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
