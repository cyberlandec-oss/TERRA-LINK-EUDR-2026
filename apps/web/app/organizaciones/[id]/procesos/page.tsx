'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { RUN_STATUS, RUN_TYPE, type LotOptions, type Run } from '../../../../lib/lots';

interface RunRow { id: string; run_code: string; process_type: string; status: string; started_at: string | null; closed_at: string | null; output_product: string }

// UX_UI §15.2: procesos de fermentación y secado. Preparar → iniciar (reserva) → cerrar (consumo y salidas).
export default function RunsPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    if (!orgId || !ws.can('lot:read')) return;
    try { setRows(await api<RunRow[]>(`/api/v1/organizations/${orgId}/process-runs`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, ws]);
  useEffect(() => { void load(); }, [load]);
  if (!ws.activeOrg) return null;
  if (!ws.can('lot:read')) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar procesos.', request_id: null })} />;
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Procesos' }]} />
      <PageHeader title="Procesos" meta="Fermentación y secado: las entradas se reservan al iniciar y se consumen al cerrar con balance exacto en kg." />
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!rows && !error && <Loading label="Cargando procesos…" />}
      {rows && rows.length === 0 && <EmptyState title="Aún no hay procesos." />}
      {rows && rows.length > 0 && (
        <div className="table-wrap"><table aria-label="Procesos">
          <thead><tr><th scope="col">Proceso</th><th scope="col">Tipo</th><th scope="col">Producto de salida</th><th scope="col">Estado</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td><Link href={`/organizaciones/${orgId}/procesos/${r.id}`}>{r.run_code}</Link></td><td>{RUN_TYPE[r.process_type]}</td><td>{r.output_product}</td>
              <td><StatusBadge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</StatusBadge></td></tr>
          ))}</tbody>
        </table></div>
      )}
      {ws.can('process:manage') && <NewRun orgId={orgId} />}
    </>
  );
}

function NewRun({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [opts, setOpts] = useState<LotOptions | null>(null);
  const [f, setF] = useState({ process_type: 'FERMENTATION', output_product_id: '', notes: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [op, setOp] = useState(() => crypto.randomUUID());
  useEffect(() => { api<LotOptions>(`/api/v1/organizations/${orgId}/lot-options`).then(setOpts).catch((e) => setError(e as ApiError)); }, [orgId]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    try {
      const r = await api<{ run: Run }>(`/api/v1/organizations/${orgId}/process-runs`, { method: 'POST', body: { operation_id: op, ...f, notes: f.notes || undefined } });
      setOp(crypto.randomUUID());
      router.push(`/organizaciones/${orgId}/procesos/${r.run.id}`);
    } catch (err) { setError(err as ApiError); }
  }
  return (
    <section className="card form" aria-labelledby="nr-title">
      <h2 id="nr-title">Preparar proceso</h2>
      <form onSubmit={submit}>
        <div className="grid-3">
          <div><label htmlFor="pr-type">Tipo</label><select id="pr-type" value={f.process_type} onChange={(e) => setF({ ...f, process_type: e.target.value })}><option value="FERMENTATION">Fermentación</option><option value="DRYING">Secado</option></select></div>
          <div><label htmlFor="pr-prod">Producto de salida</label><select id="pr-prod" required value={f.output_product_id} onChange={(e) => setF({ ...f, output_product_id: e.target.value })}><option value="">Selecciona…</option>{opts?.products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}</select></div>
          <div><label htmlFor="pr-notes">Observaciones <span className="muted">(opcional)</span></label><input id="pr-notes" maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        {f.process_type === 'DRYING' && <p className="alert review">El secado puede prepararse e iniciarse, pero no podrá cerrarse hasta definir la unidad de humedad (D-32).</p>}
        {error && <ErrorPanel error={error} />}
        <div className="actions"><button type="submit">Preparar proceso</button></div>
      </form>
    </section>
  );
}
