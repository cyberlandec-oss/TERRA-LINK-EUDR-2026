'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// P0-015: entregas del outbox en estado DEAD de la organización y reproceso manual con motivo.
// Reprocesar vuelve a encolar la MISMA entrega (sin crear eventos ni borrar recibos). Entrega al menos una
// vez con consumo idempotente: no es procesamiento exactamente una vez.

interface Attempt { attempt: number; outcome: string; error_code: string | null; recorded_at: string; reason: string | null }
interface Delivery {
  event_id: string; consumer: string; status: string; attempts: number; manual_requeues: number; last_error: string | null;
  event_type: string; aggregate_type: string; recorded_at: string; attempt_history: Attempt[];
}
const OUTCOME: Record<string, string> = { DONE: 'Completada', DUPLICATE: 'Ya procesada (sin repetir efectos)', FAILED: 'Fallo', DEAD: 'Agotada (DEAD)', LEASE_LOST: 'Arrendamiento perdido', MANUAL_REQUEUE: 'Reencolada manualmente' };

export default function DeadDeliveriesPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const allowed = ws.can('events:reprocess');
  const [items, setItems] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !allowed) return;
    try { setItems(await api<Delivery[]>(`/api/v1/organizations/${orgId}/event-deliveries?status=DEAD`)); setError(null); } catch (e) { setError(e as ApiError); }
  }, [orgId, allowed]);
  useEffect(() => { void load(); }, [load]);

  if (!ws.activeOrg) return null;
  if (!allowed) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite reprocesar entregas de eventos.', request_id: null })} />;
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Entregas de eventos' }]} />
      <PageHeader title="Entregas de eventos fallidas" meta="Entregas que agotaron sus reintentos (DEAD)." />
      <p className="muted">Reprocesar concede un intento más a la misma entrega. Los efectos ya aplicados no se repiten (cada consumidor guarda un recibo por evento). La entrega es «al menos una vez», no «exactamente una vez».</p>
      {notice && <p className="alert valid" role="status">{notice}</p>}
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!items && !error && <Loading label="Cargando entregas…" />}
      {items && items.length === 0 && <EmptyState title="No hay entregas DEAD en esta organización." />}
      {items && items.map((d) => (
        <section key={`${d.event_id}:${d.consumer}`} className="card" aria-label={`Entrega ${d.event_type} a ${d.consumer}`}>
          <h2>{d.event_type} → {d.consumer}</h2>
          <dl className="props">
            <dt>Estado</dt><dd><StatusBadge tone="blocked">DEAD</StatusBadge> · {d.attempts} intento(s) · {d.manual_requeues} reproceso(s) manual(es)</dd>
            <dt>Último error</dt><dd><code>{d.last_error ?? '—'}</code> <span className="muted">(código; sin mensajes con datos)</span></dd>
            <dt>Evento</dt><dd><code>{d.event_id}</code> · {d.aggregate_type} · {new Date(d.recorded_at).toLocaleString('es-EC')}</dd>
          </dl>
          <details>
            <summary>Historial de intentos</summary>
            <ul className="plain">{d.attempt_history.map((a, i) => <li key={i}>#{a.attempt} · {OUTCOME[a.outcome] ?? a.outcome}{a.error_code ? ` · ${a.error_code}` : ''}{a.reason ? ` · motivo: ${a.reason}` : ''} · {new Date(a.recorded_at).toLocaleString('es-EC')}</li>)}</ul>
          </details>
          <RequeueForm orgId={orgId} d={d} onDone={async () => { setNotice('Entrega reencolada. El worker la procesará en la próxima pasada.'); await load(); }} />
        </section>
      ))}
    </>
  );
}

function RequeueForm({ orgId, d, onDone }: { orgId: string; d: Delivery; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/event-deliveries/${d.event_id}/${encodeURIComponent(d.consumer)}/requeue`, { method: 'POST', body: { reason: reason.trim() } });
      await onDone();
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }
  const id = `rq-${d.event_id}-${d.consumer}`;
  return (
    <form onSubmit={submit} className="actions">
      <label htmlFor={id}>Motivo del reproceso</label>
      <input id={id} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Reencolando…' : 'Reprocesar'}</button>
      {error && <ErrorPanel error={error} />}
    </form>
  );
}
