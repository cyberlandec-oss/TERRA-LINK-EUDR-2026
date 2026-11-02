'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '../../../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';
import { ApiError, api } from '../../../../../lib/api';
import { ENTITY_LABELS, RESULT_LABELS, actionLabel, fieldValue, type AuditDetail, type AuditRecord } from '../../../../../lib/audit';

const ENTITY_ROUTE: Record<string, string> = { producer: 'productores', plot: 'parcelas', document: 'documentos', evidence: 'evidencias', product: 'productos' };

function Timeline({ items, current, orgId, label }: { items: AuditRecord[]; current: string; orgId: string; label: string }) {
  return (
    <ol className="plain" aria-label={label}>
      {items.map((r) => (
        <li key={r.id}>
          {r.id === current ? <strong>{actionLabel(r.action)} (este registro)</strong> : <Link href={`/organizaciones/${orgId}/auditoria/${r.id}`}>{actionLabel(r.action)}</Link>}
          <span className="muted"> · {r.actor.label} · {new Date(r.occurred_at).toLocaleString('es-EC')}</span>
        </li>
      ))}
    </ol>
  );
}

// Detalle de un registro de auditoría (UX_UI §20.1): qué cambió, cuándo, quién y relaciones permitidas. Solo lectura.
export default function AuditDetailPage() {
  const ws = useWorkspace();
  const { logId } = useParams<{ logId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const canRead = ws.can('audit:read');
  const [d, setD] = useState<AuditDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !canRead) return;
    try { setD(await api<AuditDetail>(`/api/v1/organizations/${orgId}/audit-logs/${logId}`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, canRead, logId]);
  useEffect(() => { void load(); }, [load]);

  if (!ws.activeOrg) return null;
  if (!canRead) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar la auditoría de esta organización.', request_id: null })} />;
  const crumbs = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Auditoría', href: `/organizaciones/${orgId}/auditoria` }];
  if (error) return <><Breadcrumb items={[...crumbs, { label: 'Registro' }]} /><ErrorPanel error={error} onRetry={load} /></>;
  if (!d) return <Loading label="Cargando registro…" />;
  const r = d.record;
  const keys = [...new Set([...Object.keys(r.before ?? {}), ...Object.keys(r.after ?? {})])].sort();
  const route = ENTITY_ROUTE[r.entity_type];
  return (
    <>
      <Breadcrumb items={[...crumbs, { label: actionLabel(r.action) }]} />
      <PageHeader title={actionLabel(r.action)} meta={<>Registro de solo lectura · no se puede editar ni borrar.</>} />
      <section className="card" aria-labelledby="ad-summary">
        <h2 id="ad-summary">Resumen</h2>
        <dl className="props">
          <dt>Fecha de registro</dt><dd>{new Date(r.occurred_at).toLocaleString('es-EC')}</dd>
          <dt>Actor</dt><dd>{r.actor.label}{r.actor.email ? ` · ${r.actor.email}` : ''}</dd>
          <dt>Resultado</dt><dd><StatusBadge tone={RESULT_LABELS[r.result]?.tone ?? 'neutral'}>{RESULT_LABELS[r.result]?.label ?? r.result}</StatusBadge></dd>
          <dt>Registro</dt><dd>{ENTITY_LABELS[r.entity_type] ?? r.entity_type}{r.entity_id && route ? <> · <Link href={`/organizaciones/${orgId}/${route}/${r.entity_id}`}>abrir {(ENTITY_LABELS[r.entity_type] ?? '').toLowerCase()}</Link></> : ''}</dd>
          {r.reason && <><dt>Motivo</dt><dd>{r.reason}</dd></>}
          <dt>Identificador de correlación</dt><dd><code className="hash">{r.request_id ?? 'no registrado'}</code></dd>
          {d.links.version_id && <><dt>Versión</dt><dd><code className="hash">{d.links.version_id}</code></dd></>}
        </dl>
      </section>

      <section className="card" aria-labelledby="ad-fields">
        <h2 id="ad-fields">Qué cambió</h2>
        {keys.length === 0 ? <p className="muted">Este registro no incluye campos presentables.</p> : (
          <div className="table-wrap">
            <table aria-label="Campos del registro">
              <thead><tr><th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Después</th></tr></thead>
              <tbody>
                {keys.map((k) => <tr key={k}><td><code>{k}</code></td><td>{r.before ? fieldValue(r.before[k]) : '—'}</td><td>{r.after ? fieldValue(r.after[k]) : '—'}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
        {r.redacted_fields.length > 0 && (
          <Alert tone="info" title="Campos no mostrados">
            Por tu permiso o por política (secretos, coordenadas, contenido o identidad protegida) se omiten: {r.redacted_fields.join(', ')}. El registro original se conserva sin cambios.
          </Alert>
        )}
      </section>

      {(d.links.corrects_event_id || d.links.correction_event_id) && (
        <section className="card" aria-labelledby="ad-corr">
          <h2 id="ad-corr">Corrección</h2>
          <dl className="props">
            {d.links.corrects_event_id && <><dt>Corrige el evento</dt><dd><code className="hash">{d.links.corrects_event_id}</code></dd></>}
            {d.links.correction_event_id && <><dt>Evento de corrección</dt><dd><code className="hash">{d.links.correction_event_id}</code></dd></>}
          </dl>
          <p className="muted">El valor original no se sobrescribe: la corrección es un registro nuevo enlazado. {route && r.entity_id && <Link href={`/organizaciones/${orgId}/${route}/${r.entity_id}`}>Ver historial de eventos del registro</Link>}</p>
        </section>
      )}

      <section className="card" aria-labelledby="ad-timeline">
        <h2 id="ad-timeline">Historia del registro</h2>
        <Timeline items={d.timeline} current={r.id} orgId={orgId} label="Historia del registro" />
      </section>

      {d.correlated.length > 0 && (
        <section className="card" aria-labelledby="ad-corr-ops">
          <h2 id="ad-corr-ops">Misma operación</h2>
          <p className="muted">Registros con el mismo identificador de correlación.</p>
          <Timeline items={d.correlated} current={r.id} orgId={orgId} label="Registros de la misma operación" />
        </section>
      )}
    </>
  );
}
