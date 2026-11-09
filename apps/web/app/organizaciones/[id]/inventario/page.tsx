'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { ErrorDetails } from '../../../../lib/deliveries';
import { kg } from '../../../../lib/lots';

interface Loc { id: string; code: string | null; name: string | null }
interface LotBal { lot_id: string; lot_code: string; product: string; origin_status: string; quality: { status: string; label: string }; location: Loc | null; pending_location: boolean; physical: string; reserved: string; available: string }
interface Balances {
  lots: LotBal[]; receptions_without_lot: Array<{ reception_id: string; delivery_code: string; producer_code: string; product: string; location: Loc | null; physical: string }>;
  totals: { physical: string; reserved: string; available: string; scope: string }; pending_location: string[];
  reservations_for_shipments: { status: string; note: string }; note: string;
}
interface Movement { id: string; movement_type: string; label: string; reason: string | null; process_loss: string | null; recorded_at: string; actor: string; lines: Array<{ holder: string; location: string; bucket: string; quantity: string }> }
interface Location { id: string; code: string; name: string; status: string }

// UX_UI §15.3: inventario y balance de masa desde el ledger. Existencia, reservado y disponible separados; pendientes visibles.
export default function InventoryPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const can = ws.can('stock:read');
  const [b, setB] = useState<Balances | null>(null);
  const [mv, setMv] = useState<Movement[] | null>(null);
  const [locs, setLocs] = useState<Location[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [type, setType] = useState('');
  const load = useCallback(async () => {
    if (!orgId || !can) return;
    try {
      const [bal, mov] = await Promise.all([api<Balances>(`/api/v1/organizations/${orgId}/inventory/balances`), api<Movement[]>(`/api/v1/organizations/${orgId}/inventory/movements${type ? `?movement_type=${type}` : ''}`)]);
      setB(bal); setMv(mov); setError(null);
      if (ws.can('location:read')) setLocs((await api<Location[]>(`/api/v1/organizations/${orgId}/locations`)).filter((l) => l.status === 'ACTIVE'));
    } catch (err) { setError(err as ApiError); }
  }, [orgId, can, type, ws]);
  useEffect(() => { void load(); }, [load]);
  if (!ws.activeOrg) return null;
  if (!can) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar el inventario.', request_id: null })} />;
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Inventario' }]} />
      <PageHeader title="Inventario" meta="Existencia física, reservado y disponible por lote y centro, desde el ledger. Reservar no reduce la existencia." />
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!b && !error && <Loading label="Cargando inventario…" />}
      {b && <>
        <section className="card" aria-labelledby="iv-tot">
          <h2 id="iv-tot">Totales</h2>
          <dl className="props">
            <dt>Existencia física</dt><dd><strong>{kg(b.totals.physical)}</strong></dd>
            <dt>Reservado (procesos)</dt><dd>{kg(b.totals.reserved)}</dd>
            <dt>Disponible</dt><dd>{kg(b.totals.available)}</dd>
            <dt>Alcance</dt><dd className="muted">{b.totals.scope}</dd>
          </dl>
          {b.pending_location.length > 0 && <Alert tone="review" title="Ubicación pendiente de asignación">{b.pending_location.join(', ')}: asigna un centro con un movimiento; no se elige un almacén automáticamente.</Alert>}
          <p className="field-help">{b.note}</p>
          <p className="muted">{b.reservations_for_shipments.note}</p>
        </section>
        <section className="card" aria-labelledby="iv-lots">
          <h2 id="iv-lots">Lotes por centro</h2>
          {b.lots.length === 0 ? <EmptyState title="Sin existencias en lotes." /> : (
            <div className="table-wrap"><table aria-label="Existencias por lote y centro">
              <thead><tr><th scope="col">Lote</th><th scope="col">Centro</th><th scope="col">Existencia</th><th scope="col">Reservado</th><th scope="col">Disponible</th><th scope="col">Condiciones</th></tr></thead>
              <tbody>{b.lots.map((l) => (
                <tr key={`${l.lot_id}-${l.location?.id ?? 'pend'}`}>
                  <td><Link href={`/organizaciones/${orgId}/lotes/${l.lot_id}`}>{l.lot_code}</Link><div className="muted">{l.product}</div></td>
                  <td>{l.location ? `${l.location.name} (${l.location.code})` : <StatusBadge tone="review">Pendiente de asignación</StatusBadge>}</td>
                  <td>{kg(l.physical)}</td><td>{kg(l.reserved)}</td><td><strong>{kg(l.available)}</strong></td>
                  <td>{l.origin_status === 'INCOMPLETE' && <StatusBadge tone="review">Origen incompleto</StatusBadge>} <span className="muted">{l.quality.label}</span></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
        <section className="card" aria-labelledby="iv-rec">
          <h2 id="iv-rec">Material recibido sin lote</h2>
          {b.receptions_without_lot.length === 0 ? <p className="muted">Sin material recibido pendiente de formar lote (a tu alcance).</p> : (
            <ul className="plain" aria-label="Material recibido sin lote">{b.receptions_without_lot.map((r) => <li key={`${r.reception_id}-${r.location?.id}`}>{r.delivery_code} · {r.producer_code} · {r.product}: {kg(r.physical)} en {r.location?.name ?? 'ubicación pendiente'}</li>)}</ul>
          )}
        </section>
        {(ws.can('stock:move') || ws.can('stock:adjust')) && <MovementForms orgId={orgId} lots={b.lots} locs={locs} canMove={ws.can('stock:move')} canAdjust={ws.can('stock:adjust')} onDone={load} />}
        {ws.can('stock:incorporate') && <Reconcile orgId={orgId} />}
        <section className="card" aria-labelledby="iv-mv">
          <h2 id="iv-mv">Movimientos</h2>
          <label htmlFor="iv-type">Tipo</label>
          <select id="iv-type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Todos</option>
            {[['RECEPTION_IN', 'Entrada por recepción'], ['LOT_ASSIGN', 'Asignación a lote'], ['PROCESS_RESERVE', 'Reserva por proceso'], ['PROCESS_CLOSE', 'Cierre de proceso'], ['TRANSFER', 'Traslado'], ['LOCATION_ASSIGN', 'Asignación de ubicación'], ['STOCK_LOSS', 'Merma'], ['ADJUSTMENT', 'Ajuste']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {mv && mv.length === 0 && <p className="muted">Sin movimientos a tu alcance.</p>}
          {mv && mv.length > 0 && <ol className="plain" aria-label="Movimientos del ledger">{mv.slice(0, 50).map((m) => (
            <li key={m.id}><strong>{m.label}</strong> <span className="muted">· {m.actor} · {new Date(m.recorded_at).toLocaleString('es-EC')}{m.reason ? ` · motivo: ${m.reason}` : ''}{m.process_loss ? ` · pérdida del proceso ${kg(m.process_loss)}` : ''}</span>
              <div className="muted">{m.lines.map((l) => `${l.holder} @ ${l.location} ${l.bucket === 'RESERVED' ? '(reserva) ' : ''}${Number(l.quantity) > 0 ? '+' : ''}${kg(l.quantity)}`).join(' · ')}</div></li>
          ))}</ol>}
        </section>
      </>}
    </>
  );
}

function MovementForms({ orgId, lots, locs, canMove, canAdjust, onDone }: { orgId: string; lots: LotBal[]; locs: Location[]; canMove: boolean; canAdjust: boolean; onDone: () => Promise<void> }) {
  const [kind, setKind] = useState(canMove ? 'transfer' : 'adjust');
  const [f, setF] = useState({ row: '', to: '', quantity: '', reason: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [op, setOp] = useState(() => crypto.randomUUID());
  const row = lots.find((l) => `${l.lot_id}|${l.location?.id ?? ''}` === f.row);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setDone(null);
    if (!row) return;
    const from = row.location?.id ?? null;
    const path = kind === 'transfer' ? 'transfers' : kind === 'loss' ? 'losses' : 'adjustments';
    const body = kind === 'transfer' ? { operation_id: op, lot_id: row.lot_id, from_location_id: from, to_location_id: f.to, quantity: f.quantity.replace(',', '.'), ...(f.reason ? { reason: f.reason } : {}) }
      : { operation_id: op, lot_id: row.lot_id, location_id: from, quantity: f.quantity.replace(',', '.'), reason: f.reason };
    try { await api(`/api/v1/organizations/${orgId}/inventory/${path}`, { method: 'POST', body }); setOp(crypto.randomUUID()); setDone('Movimiento registrado.'); setF({ row: '', to: '', quantity: '', reason: '' }); await onDone(); } catch (err) { setError(err as ApiError); }
  }
  return (
    <section className="card form" aria-labelledby="iv-move">
      <h2 id="iv-move">Registrar movimiento</h2>
      <form onSubmit={submit}>
        <div className="grid-2">
          <div><label htmlFor="mv-kind">Movimiento</label>
            <select id="mv-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {canMove && <option value="transfer">Traslado o asignación de ubicación</option>}
              {canMove && <option value="loss">Merma (con motivo)</option>}
              {canAdjust && <option value="adjust">Ajuste con motivo (+/−)</option>}
            </select></div>
          <div><label htmlFor="mv-row">Lote y centro de origen</label>
            <select id="mv-row" required value={f.row} onChange={(e) => setF({ ...f, row: e.target.value })}>
              <option value="">Selecciona…</option>
              {lots.map((l) => <option key={`${l.lot_id}|${l.location?.id ?? ''}`} value={`${l.lot_id}|${l.location?.id ?? ''}`}>{l.lot_code} · {l.location?.name ?? 'ubicación pendiente'} · disponible {kg(l.available)}</option>)}
            </select></div>
          {kind === 'transfer' && <div><label htmlFor="mv-to">Centro de destino</label>
            <select id="mv-to" required value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}><option value="">Selecciona…</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}</select></div>}
          <div><label htmlFor="mv-qty">Cantidad (kg){kind === 'adjust' ? ', con signo' : ''}</label><input id="mv-qty" required inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></div>
          <div><label htmlFor="mv-reason">Motivo{kind === 'transfer' ? ' (opcional)' : ''}</label><input id="mv-reason" required={kind !== 'transfer'} minLength={3} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        </div>
        <p className="field-help">Lo reservado no se traslada ni se descuenta; un ajuste nunca deja la existencia por debajo de lo reservado.</p>
        {error && <><ErrorPanel error={error} /><ErrorDetails details={error.body.details} /></>}
        {done && <p className="alert valid" role="status">{done}</p>}
        <div className="actions"><button type="submit">Registrar movimiento</button></div>
      </form>
    </section>
  );
}

function Reconcile({ orgId }: { orgId: string }) {
  const [r, setR] = useState<{ consistent: boolean; differences: Array<{ kind: string; code?: string; expected: string; ledger: string }>; checked: { receptions: number; lots: number } } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const check = async () => { setError(null); try { setR(await api(`/api/v1/organizations/${orgId}/inventory/reconciliation`)); } catch (err) { setError(err as ApiError); } };
  return (
    <section className="card" aria-labelledby="iv-rc">
      <h2 id="iv-rc">Conciliación con recepciones y procesos</h2>
      <p className="muted">Compara el ledger con los registros de recepción, asignación y procesamiento. Las diferencias se informan; nunca se corrigen con ajustes automáticos.</p>
      <button type="button" className="secondary" onClick={() => void check()}>Comprobar conciliación</button>
      {error && <ErrorPanel error={error} />}
      {r && (r.consistent ? <p className="alert valid" role="status">Conciliado: {r.checked.receptions} recepciones y {r.checked.lots} lotes sin diferencias.</p>
        : <div className="alert review" role="status"><p className="alert-title">Diferencias</p><ul>{r.differences.map((d, i) => <li key={i}>{d.kind} {d.code ?? ''}: esperado {d.expected} · ledger {d.ledger}</li>)}</ul></div>)}
    </section>
  );
}
