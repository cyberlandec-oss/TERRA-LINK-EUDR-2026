'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { ErrorDetails } from '../../../../lib/deliveries';
import { kg, type Lot, type LotOptions, type LotRow } from '../../../../lib/lots';

// UX_UI §15: lotes. Cantidades = saldo de procesamiento (asignado − reservado − consumido); no es inventario (P0-017).
export default function LotsPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const can = ws.can('lot:read');
  const [rows, setRows] = useState<LotRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    if (!orgId || !can) return;
    try { setRows(await api<LotRow[]>(`/api/v1/organizations/${orgId}/lots`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, can]);
  useEffect(() => { void load(); }, [load]);
  if (!ws.activeOrg) return null;
  if (!can) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar lotes.', request_id: null })} />;
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Lotes' }]} />
      <PageHeader title="Lotes" meta="Lotes formados con recepciones físicas o producidos por procesos. El saldo mostrado es de procesamiento, no inventario." />
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!rows && !error && <Loading label="Cargando lotes…" />}
      {rows && rows.length === 0 && <EmptyState title="Aún no hay lotes." />}
      {rows && rows.length > 0 && (
        <div className="table-wrap"><table aria-label="Lotes">
          <thead><tr><th scope="col">Lote</th><th scope="col">Producto</th><th scope="col">Origen</th><th scope="col">Calidad</th><th scope="col">Saldo de procesamiento</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/organizaciones/${orgId}/lotes/${r.id}`}>{r.lot_code}</Link><div className="muted">{r.source === 'RECEPTIONS' ? 'de recepciones' : 'salida de proceso'}</div></td>
              <td>{r.product_name}</td>
              <td>{r.origin_status === 'COMPLETE' ? <StatusBadge tone="valid">Origen declarado</StatusBadge> : <StatusBadge tone="review">Origen incompleto</StatusBadge>}</td>
              <td><StatusBadge tone={r.quality.status === 'PENDING_EVALUATION' ? 'review' : r.quality.status === 'INCLUDES_REJECTED' ? 'blocked' : 'neutral'}>{r.quality.label}</StatusBadge></td>
              <td>{kg(r.quantities.available)} <span className="muted">de {kg(r.quantities.base)}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {ws.can('lot:create') && <NewLot orgId={orgId} />}
    </>
  );
}

function NewLot({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [opts, setOpts] = useState<LotOptions | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [op, setOp] = useState(() => crypto.randomUUID());
  useEffect(() => { api<LotOptions>(`/api/v1/organizations/${orgId}/lot-options`).then(setOpts).catch((e) => setError(e as ApiError)); }, [orgId]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const inputs = Object.entries(qty).filter(([, v]) => v.trim()).map(([reception_id, v]) => ({ reception_id, quantity: v.replace(',', '.') }));
      const r = await api<{ lot: Lot }>(`/api/v1/organizations/${orgId}/lots`, { method: 'POST', body: { operation_id: op, inputs } });
      setOp(crypto.randomUUID());
      router.push(`/organizaciones/${orgId}/lotes/${r.lot.id}`);
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }
  return (
    <section className="card form" aria-labelledby="nl-title">
      <h2 id="nl-title">Formar lote con recepciones</h2>
      <p className="muted">Asigna cantidades de recepciones físicas confirmadas (peso vigente), sin superar lo disponible. Mismo producto; no se mezcla origen conocido con origen incompleto. La calidad pendiente se conserva.</p>
      {!opts && !error && <Loading label="Cargando recepciones…" />}
      {opts && opts.receptions.length === 0 && <p className="muted">No hay recepciones con cantidad disponible.</p>}
      {opts && opts.receptions.length > 0 && (
        <form onSubmit={submit}>
          <div className="table-wrap"><table aria-label="Recepciones disponibles">
            <thead><tr><th scope="col">Recepción</th><th scope="col">Producto</th><th scope="col">Origen</th><th scope="col">Calidad</th><th scope="col">Disponible</th><th scope="col">Asignar (kg)</th></tr></thead>
            <tbody>{opts.receptions.map((r) => (
              <tr key={r.id}>
                <td>{r.delivery_code} · {r.producer_code}<div className="muted">{new Date(r.received_at).toLocaleDateString('es-EC')}</div></td>
                <td>{r.product_name}</td>
                <td>{r.origin_known ? 'declarado' : <StatusBadge tone="review">incompleto</StatusBadge>}</td>
                <td>{r.quality === 'PENDING_EVALUATION' ? 'pendiente' : r.quality === 'RELEASED' ? 'liberada (decisión humana)' : 'rechazada'}</td>
                <td>{kg(r.available)}</td>
                <td><label className="visually-hidden" htmlFor={`as-${r.id}`}>Asignar de {r.delivery_code}</label><input id={`as-${r.id}`} inputMode="decimal" value={qty[r.id] ?? ''} onChange={(e) => setQty({ ...qty, [r.id]: e.target.value })} /></td>
              </tr>
            ))}</tbody>
          </table></div>
          {error && <><ErrorPanel error={error} /><ErrorDetails details={error.body.details} /></>}
          <div className="actions"><button type="submit" disabled={busy}>Formar lote</button></div>
        </form>
      )}
      {!opts && error && <ErrorPanel error={error} />}
    </section>
  );
}
