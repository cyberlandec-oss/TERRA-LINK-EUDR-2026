'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';
import { ErrorDetails } from '../../../../../lib/deliveries';
import { kg } from '../../../../../lib/lots';
import { SHIPMENT_STATUS, type Preflight, type Shipment, type ShipmentOptions } from '../../../../../lib/shipments';

// P0-029 Detalle de embarque: ítems, reservas en el ledger, preflight y despacho (bloqueado mientras falte cualquier
// comprobación; hoy, siempre por D-34). Despachar no presenta una DDS.
export default function ShipmentDetailPage() {
  const ws = useWorkspace();
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const [s, setS] = useState<Shipment | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [pf, setPf] = useState<{ data: Preflight | null; error: ApiError | null }>({ data: null, error: null });
  const base = `/api/v1/organizations/${orgId}/shipments/${shipmentId}`;
  const loadPreflight = useCallback(async () => {
    try { setPf({ data: await api<Preflight>(`${base}/preflight`), error: null }); } catch (err) { setPf({ data: null, error: err as ApiError }); }
  }, [base]);
  const load = useCallback(async () => {
    if (!orgId || !ws.can('shipment:read')) return;
    try { setS(await api<Shipment>(base)); setError(null); } catch (err) { setError(err as ApiError); }
    void loadPreflight();
  }, [orgId, ws, base, loadPreflight]);
  useEffect(() => { void load(); }, [load]);
  if (!ws.activeOrg) return null;
  if (!ws.can('shipment:read')) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar embarques.', request_id: null })} />;
  const crumbs = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Embarques', href: `/organizaciones/${orgId}/embarques` }];
  if (error) return <><Breadcrumb items={[...crumbs, { label: 'Embarque' }]} /><ErrorPanel error={error} onRetry={load} /></>;
  if (!s) return <Loading label="Cargando embarque…" />;
  const done = (x: Shipment) => { setS(x); void loadPreflight(); };
  return (
    <>
      <Breadcrumb items={[...crumbs, { label: s.shipment_code }]} />
      <PageHeader title={`Embarque ${s.shipment_code}`} meta={<StatusBadge tone={SHIPMENT_STATUS[s.status].tone}>{SHIPMENT_STATUS[s.status].label}</StatusBadge>} />
      <section className="card" aria-labelledby="sh-sum">
        <h2 id="sh-sum">Resumen</h2>
        <dl className="props">
          <dt>Comprador</dt><dd>{s.buyer.code} · {s.buyer.name} ({s.buyer.country}) <span className="muted">· declarado</span></dd>
          <dt>Destino</dt><dd>{s.destination.country}{s.destination.place ? ` · ${s.destination.place}` : ''} <span className="muted">· declarado</span></dd>
          <dt>Centro de salida</dt><dd>{s.origin_location.code} · {s.origin_location.name}</dd>
          <dt>Total</dt><dd>{kg(s.totals.quantity.value)}</dd>
          <dt>Creado</dt><dd>{new Date(s.created_at).toLocaleString('es-EC')} · {s.created_by}</dd>
          {s.dispatch_at && <><dt>Despachado</dt><dd>{new Date(s.dispatch_at).toLocaleString('es-EC')} · {s.dispatched_by}</dd></>}
          {s.cancel_reason && <><dt>Cancelado</dt><dd>{s.cancel_reason}</dd></>}
          {s.notes && <><dt>Notas</dt><dd>{s.notes}</dd></>}
        </dl>
        <p className="field-help">{s.submission.note}</p>
      </section>
      <Items s={s} orgId={orgId} base={base} onDone={done} />
      {s.actions.manage && <AddItem s={s} orgId={orgId} base={base} onDone={done} />}
      <section className="card" aria-labelledby="sh-pf">
        <h2 id="sh-pf">Comprobaciones para despachar</h2>
        {pf.error && <ErrorPanel error={pf.error} onRetry={loadPreflight} />}
        {!pf.data && !pf.error && <Loading label="Evaluando comprobaciones…" />}
        {pf.data && <PreflightView p={pf.data} />}
        {s.actions.dispatch && pf.data && <Dispatch s={s} base={base} allowed={pf.data.allowed} onDone={done} />}
      </section>
      {s.actions.manage && <Cancel s={s} base={base} onDone={done} />}
    </>
  );
}

function useAction(onDone: (s: Shipment) => void) {
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<{ shipment: Shipment }>) {
    setError(null); setBusy(true);
    try { onDone((await fn()).shipment); return true; } catch (err) { setError(err as ApiError); return false; } finally { setBusy(false); }
  }
  return { error, busy, run };
}

function Items({ s, orgId, base, onDone }: { s: Shipment; orgId: string; base: string; onDone: (s: Shipment) => void }) {
  const a = useAction(onDone);
  const [ops] = useState(() => new Map<string, string>());
  const opFor = (k: string) => { if (!ops.has(k)) ops.set(k, crypto.randomUUID()); return ops.get(k)!; };
  const [reason, setReason] = useState<Record<string, string>>({});
  return (
    <section className="card" aria-labelledby="sh-items">
      <h2 id="sh-items">Lotes y reservas</h2>
      {s.items.length === 0 ? <p className="muted">Aún no hay lotes en este embarque.</p> : (
        <div className="table-wrap"><table aria-label="Lotes del embarque">
          <thead><tr><th scope="col">Lote</th><th scope="col">Cantidad</th><th scope="col">Reserva</th><th scope="col">Acciones</th></tr></thead>
          <tbody>{s.items.map((i) => (
            <tr key={i.id}>
              <td><Link href={`/organizaciones/${orgId}/lotes/${i.lot_id}`}>{i.lot_code}</Link><div className="muted">{i.product}{i.origin_status === 'INCOMPLETE' ? ' · origen incompleto' : ''}</div></td>
              <td>{kg(i.quantity.value)}</td>
              <td>{i.reservation ? <StatusBadge tone={i.reservation.status === 'CONSUMED' ? 'valid' : 'process'}>{i.reservation.status === 'CONSUMED' ? 'Despachada' : `Reservado ${kg(i.reservation.quantity.value)}`}</StatusBadge> : <span className="muted">sin reserva</span>}
                {i.history.filter((h) => h.status === 'RELEASED').length > 0 && <div className="muted">{i.history.filter((h) => h.status === 'RELEASED').length} reserva(s) liberada(s)</div>}</td>
              <td>
                {s.actions.reserve && !i.reservation && <button type="button" disabled={a.busy} onClick={() => a.run(async () => { const r = await api<{ shipment: Shipment }>(`${base}/reserve`, { method: 'POST', body: { operation_id: opFor(`r:${i.id}`), item_id: i.id } }); ops.delete(`r:${i.id}`); return r; })}>Reservar</button>}
                {s.actions.reserve && i.reservation?.status === 'ACTIVE' && (
                  <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { const r = await api<{ shipment: Shipment }>(`${base}/reservations/${i.reservation!.id}/release`, { method: 'POST', body: { operation_id: opFor(`l:${i.id}`), reason: (reason[i.id] ?? '').trim() } }); ops.delete(`l:${i.id}`); return r; }); }}>
                    <label htmlFor={`rl-${i.id}`}>Motivo para liberar</label>
                    <input id={`rl-${i.id}`} required minLength={3} value={reason[i.id] ?? ''} onChange={(e) => setReason({ ...reason, [i.id]: e.target.value })} />
                    <button type="submit" className="secondary" disabled={a.busy}>Liberar reserva</button>
                  </form>
                )}
                {s.actions.manage && !i.reservation && i.history.length === 0 && <button type="button" className="secondary" disabled={a.busy} onClick={() => a.run(() => api<{ shipment: Shipment }>(`${base}/items/${i.id}/remove`, { method: 'POST', body: { expected_version: s.row_version } }))}>Quitar</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {a.error && <><ErrorPanel error={a.error} /><ErrorDetails details={a.error.body.details} /></>}
    </section>
  );
}

function AddItem({ s, orgId, base, onDone }: { s: Shipment; orgId: string; base: string; onDone: (s: Shipment) => void }) {
  const [opts, setOpts] = useState<ShipmentOptions | null>(null);
  const [f, setF] = useState({ lot_id: '', quantity: '' });
  const a = useAction((x) => { onDone(x); setF({ lot_id: '', quantity: '' }); });
  useEffect(() => { api<ShipmentOptions>(`/api/v1/organizations/${orgId}/shipments/options`).then(setOpts).catch(() => setOpts({ buyers: [], locations: [], lots: [] })); }, [orgId, s.row_version]);
  const here = (opts?.lots ?? []).filter((l) => l.location_id === s.origin_location.id && !s.items.some((i) => i.lot_id === l.lot_id));
  function submit(e: FormEvent) {
    e.preventDefault();
    void a.run(() => api<{ shipment: Shipment }>(`${base}/items`, { method: 'POST', body: { expected_version: s.row_version, lot_id: f.lot_id, quantity: f.quantity.replace(',', '.') } }));
  }
  return (
    <section className="card form" aria-labelledby="ai-title">
      <h2 id="ai-title">Agregar lote</h2>
      {!opts && <Loading label="Cargando lotes disponibles…" />}
      {opts && here.length === 0 && <p className="muted">No hay lotes con disponible en {s.origin_location.code}. Traslada existencia desde Inventario.</p>}
      {opts && here.length > 0 && (
        <form onSubmit={submit}>
          <label htmlFor="ai-lot">Lote (disponible en {s.origin_location.code})</label>
          <select id="ai-lot" required value={f.lot_id} onChange={(e) => setF({ ...f, lot_id: e.target.value })}>
            <option value="">Selecciona…</option>{here.map((l) => <option key={l.lot_id} value={l.lot_id}>{l.lot_code} · {l.product} · {kg(l.available)} disponible{l.origin_status === 'INCOMPLETE' ? ' · origen incompleto' : ''}</option>)}
          </select>
          <label htmlFor="ai-q">Cantidad (kg)</label>
          <input id="ai-q" required inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
          {a.error && <><ErrorPanel error={a.error} /><ErrorDetails details={a.error.body.details} /></>}
          <div className="actions"><button type="submit" disabled={a.busy}>Agregar lote</button></div>
        </form>
      )}
    </section>
  );
}

function PreflightView({ p }: { p: Preflight }) {
  return (
    <>
      {p.allowed ? <Alert tone="valid">Todas las comprobaciones pasan.</Alert> : <Alert tone="blocked" title="No se puede despachar todavía">Resuelve cada comprobación bloqueada. Ningún bloqueo se omite.</Alert>}
      <ul className="plain" aria-label="Comprobaciones">
        {p.checks.map((c, k) => (
          <li key={k}><StatusBadge tone={c.status === 'OK' ? 'valid' : 'blocked'}>{c.status === 'OK' ? 'Cumple' : 'Bloquea'}</StatusBadge> {c.label}{c.subject ? ` · ${c.subject}` : ''}: <span className="muted">{c.message}</span></li>
        ))}
      </ul>
      <p className="field-help">{p.note}</p>
    </>
  );
}

function Dispatch({ s, base, allowed, onDone }: { s: Shipment; base: string; allowed: boolean; onDone: (s: Shipment) => void }) {
  const a = useAction(onDone);
  const [op, setOp] = useState(() => crypto.randomUUID());
  return (
    <div className="actions">
      <button type="button" disabled={!allowed || a.busy} aria-describedby="dp-help"
        onClick={async () => { if (await a.run(() => api<{ shipment: Shipment }>(`${base}/dispatch`, { method: 'POST', body: { operation_id: op, expected_version: s.row_version } }))) setOp(crypto.randomUUID()); }}>Despachar</button>
      <p id="dp-help" className="field-help">{allowed ? 'Consume las reservas una sola vez y deja el embarque como despachado.' : 'Deshabilitado: hay comprobaciones bloqueadas.'}</p>
      {a.error && <><ErrorPanel error={a.error} /><ErrorDetails details={a.error.body.details} /></>}
    </div>
  );
}

function Cancel({ s, base, onDone }: { s: Shipment; base: string; onDone: (s: Shipment) => void }) {
  const a = useAction(onDone);
  const [reason, setReason] = useState('');
  const [op] = useState(() => crypto.randomUUID());
  return (
    <section className="card form" aria-labelledby="cn-title">
      <h2 id="cn-title">Cancelar embarque</h2>
      <form onSubmit={(e) => { e.preventDefault(); void a.run(() => api<{ shipment: Shipment }>(`${base}/cancel`, { method: 'POST', body: { operation_id: op, expected_version: s.row_version, reason: reason.trim() } })); }}>
        <label htmlFor="cn-reason">Motivo</label>
        <input id="cn-reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby="cn-help" />
        <p id="cn-help" className="field-help">Libera todas las reservas activas. Un embarque cancelado no se reabre.</p>
        {a.error && <><ErrorPanel error={a.error} /><ErrorDetails details={a.error.body.details} /></>}
        <div className="actions"><button type="submit" className="secondary" disabled={a.busy}>Cancelar embarque</button></div>
      </form>
    </section>
  );
}
