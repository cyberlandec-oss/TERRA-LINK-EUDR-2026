'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useUrlFilters } from '../../../../lib/url-filters';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { ErrorDetails, RECEPTION_TONE, STATUS_LABEL, qty, todayLocal, type Delivery, type DeliveryOptions, type DeliveryRow } from '../../../../lib/deliveries';

// UX_UI §14 / §7.6: entregas declaradas y su recepción física. La lista muestra declarado y recibido por separado.
export default function DeliveriesPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const canRead = ws.can('delivery:read') || ws.can('delivery:read_assigned');
  const canCreate = ws.can('delivery:create') || ws.can('delivery:create_assigned');
  const [rows, setRows] = useState<DeliveryRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // Filtros en la URL: se conservan al volver desde el detalle (P0-027).
  const [filters, setFilters, ready] = useUrlFilters({ status: '', reception: '', q: '' });
  const { status, reception, q } = filters;
  const setStatus = (v: string) => setFilters({ status: v });
  const setReception = (v: string) => setFilters({ reception: v });
  const setQ = (v: string) => setFilters({ q: v });

  const load = useCallback(async () => {
    if (!orgId || !canRead || !ready) return;
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (reception) p.set('reception', reception);
    if (q.trim()) p.set('q', q.trim());
    try { setRows(await api<DeliveryRow[]>(`/api/v1/organizations/${orgId}/deliveries${p.size ? `?${p}` : ''}`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, canRead, status, reception, q, ready]);
  useEffect(() => { void load(); }, [load]);

  if (!ws.activeOrg) return null;
  if (!canRead) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar entregas.', request_id: null })} />;
  const filtered = !!(status || reception || q.trim());
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Entregas' }]} />
      <PageHeader title="Entregas" meta="Entregas declaradas y su recepción física. Registrar con pendientes no es un expediente completo ni conformidad EUDR." />
      {canCreate && <p><a href="#nueva-entrega">Ir a «Nueva entrega»</a></p>}
      <div className="card">
        <div className="grid-3">
          <div><label htmlFor="en-status">Estado</label>
            <select id="en-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option><option value="DRAFT">Borrador</option><option value="REGISTERED">Registrada</option><option value="CLOSED">Cerrada</option></select></div>
          <div><label htmlFor="en-rec">Recepción</label>
            <select id="en-rec" value={reception} onChange={(e) => setReception(e.target.value)}>
              <option value="">Todas</option><option value="NOT_RECEIVED">Sin recepción</option><option value="PARTIAL">Recepción parcial</option>
              <option value="RECEIVED_DECLARED">Recibida por lo declarado</option><option value="ABOVE_DECLARED">Recibido supera lo declarado</option>
            </select></div>
          <div><label htmlFor="en-q">Buscar por código</label><input id="en-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ENT-… o código de productor" /></div>
        </div>
      </div>
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!rows && !error && <Loading label="Cargando entregas…" />}
      {rows && rows.length === 0 && <EmptyState title={filtered ? 'Ninguna entrega a tu alcance coincide con estos filtros.' : 'Aún no hay entregas a tu alcance.'} />}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table aria-label="Entregas">
            <thead><tr><th scope="col">Entrega</th><th scope="col">Productor</th><th scope="col">Producto</th><th scope="col">Declarado</th><th scope="col">Recibido</th><th scope="col">Estado</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/organizaciones/${orgId}/entregas/${r.id}`}>{r.delivery_code}</Link><div className="muted">{r.delivery_date ?? 'fecha pendiente'}</div></td>
                  <td>{r.producer.code}{r.producer.name ? ` · ${r.producer.name}` : ''}</td>
                  <td>{r.product ?? <span className="muted">pendiente</span>}</td>
                  <td>{qty(r.quantity_declared)}</td>
                  <td>{qty(r.received)}{r.receptions > 0 && <div className="muted">{r.receptions} recepción(es)</div>}</td>
                  <td><StatusBadge tone={STATUS_LABEL[r.status].tone}>{STATUS_LABEL[r.status].label}</StatusBadge>{r.status !== 'DRAFT' && <div><StatusBadge tone={RECEPTION_TONE[r.reception_status]}>{r.reception_status_label}</StatusBadge></div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canCreate && <NewDelivery orgId={orgId} />}
    </>
  );
}

type Precision = 'MONTH' | 'DAY' | 'UNKNOWN' | '';
const EMPTY = { producer_id: '', product_id: '', location_id: '', delivery_date: todayLocal(), quantity: '', unit: 'KG', precision: 'MONTH' as Precision, m_start: '', m_end: '', d_start: '', d_end: '', notes: '' };

function NewDelivery({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [opts, setOpts] = useState<DeliveryOptions | null>(null);
  const [f, setF] = useState(EMPTY);
  const [plots, setPlots] = useState<string[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    api<DeliveryOptions>(`/api/v1/organizations/${orgId}/delivery-options${f.producer_id ? `?producer_id=${f.producer_id}` : ''}`).then(setOpts).catch((e) => setError(e as ApiError));
  }, [orgId, f.producer_id]);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const period = () => {
    if (f.precision === 'UNKNOWN') return { precision: 'UNKNOWN' };
    if (f.precision === 'MONTH' && f.m_start) return { precision: 'MONTH', start: f.m_start, end: f.m_end || f.m_start };
    if (f.precision === 'DAY' && f.d_start) return { precision: 'DAY', start: f.d_start, end: f.d_end || f.d_start };
    return undefined; // no declarado: queda pendiente, no se deriva de la fecha de entrega
  };
  async function submit(register: boolean, e?: FormEvent) {
    e?.preventDefault();
    setError(null); setBusy(true);
    try {
      const r = await api<{ delivery: Delivery }>(`/api/v1/organizations/${orgId}/deliveries`, { method: 'POST', body: {
        operation_id: operationId, producer_id: f.producer_id, register,
        ...(f.product_id ? { product_id: f.product_id } : {}), ...(f.location_id ? { location_id: f.location_id } : {}),
        ...(f.delivery_date ? { delivery_date: f.delivery_date } : {}), ...(f.quantity ? { quantity_declared: f.quantity.replace(',', '.'), unit: f.unit } : {}),
        ...(period() ? { harvest_period: period() } : {}), origins: plots.map((plot_id) => ({ plot_id })), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
      } });
      setOperationId(crypto.randomUUID());
      router.push(`/organizaciones/${orgId}/entregas/${r.delivery.id}`);
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }
  if (!opts && !error) return <Loading label="Cargando opciones…" />;
  return (
    <section className="card form" aria-labelledby="nd-title" id="nueva-entrega">
      <h2 id="nd-title">Nueva entrega</h2>
      <p className="muted">Origen → producto y cantidad → fecha, centro y periodo de cosecha → revisar. Lo que falte queda como pendiente visible; no se completa con datos supuestos.</p>
      <form onSubmit={(e) => submit(true, e)}>
        <div className="grid-2">
          <div><label htmlFor="nd-producer">Productor</label>
            <select id="nd-producer" required value={f.producer_id} onChange={(e) => { setPlots([]); set('producer_id')(e); }}>
              <option value="">Selecciona…</option>{opts?.producers.map((p) => <option key={p.id} value={p.id}>{p.code}{p.name ? ` · ${p.name}` : ''}</option>)}
            </select></div>
          <fieldset><legend>Parcela(s) de origen</legend>
            {!f.producer_id && <p className="muted">Elige primero el productor.</p>}
            {f.producer_id && opts?.plots.length === 0 && <p className="muted">El productor no tiene parcelas activas: el origen quedará como faltante.</p>}
            {opts?.plots.map((p) => (
              <label key={p.id} className="checkbox-row"><input type="checkbox" checked={plots.includes(p.id)} onChange={(e) => setPlots((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))} /> {p.plot_code}</label>
            ))}
          </fieldset>
          <div><label htmlFor="nd-product">Producto</label>
            <select id="nd-product" value={f.product_id} onChange={set('product_id')}><option value="">Selecciona…</option>{opts?.products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}</select></div>
          <div className="grid-2">
            <div><label htmlFor="nd-qty">Cantidad declarada</label><input id="nd-qty" inputMode="decimal" value={f.quantity} onChange={set('quantity')} placeholder="0.000" /></div>
            <div><label htmlFor="nd-unit">Unidad</label><select id="nd-unit" value={f.unit} onChange={set('unit')}>{opts?.units.map((u) => <option key={u} value={u}>{u === 'KG' ? 'kg (kilogramo)' : u}</option>)}</select></div>
          </div>
          <div><label htmlFor="nd-date">Fecha de entrega</label><input id="nd-date" type="date" value={f.delivery_date} onChange={set('delivery_date')} /></div>
          <div><label htmlFor="nd-center">Centro de acopio <span className="muted">(opcional)</span></label>
            <select id="nd-center" value={f.location_id} onChange={set('location_id')}><option value="">Sin indicar</option>{opts?.locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}</select></div>
        </div>
        <fieldset><legend>Periodo de cosecha del cacao entregado</legend>
          <p className="field-help">Es el periodo de la cosecha, distinto de la fecha de entrega. Declara solo la precisión que conoces.</p>
          <div className="checkbox-row" role="radiogroup" aria-label="Precisión del periodo">
            {([['MONTH', 'Mes o meses'], ['DAY', 'Fechas exactas'], ['UNKNOWN', 'Desconocido']] as const).map(([v, l]) => (
              <label key={v}><input type="radio" name="precision" value={v} checked={f.precision === v} onChange={() => setF((x) => ({ ...x, precision: v }))} /> {l}</label>
            ))}
          </div>
          {f.precision === 'MONTH' && <div className="grid-2">
            <div><label htmlFor="nd-mstart">Mes inicial</label><input id="nd-mstart" type="month" value={f.m_start} onChange={set('m_start')} /></div>
            <div><label htmlFor="nd-mend">Mes final <span className="muted">(si es un intervalo)</span></label><input id="nd-mend" type="month" value={f.m_end} onChange={set('m_end')} /></div>
          </div>}
          {f.precision === 'DAY' && <div className="grid-2">
            <div><label htmlFor="nd-dstart">Desde</label><input id="nd-dstart" type="date" value={f.d_start} onChange={set('d_start')} /></div>
            <div><label htmlFor="nd-dend">Hasta</label><input id="nd-dend" type="date" value={f.d_end} onChange={set('d_end')} /></div>
          </div>}
          {f.precision === 'UNKNOWN' && <p className="alert review">El periodo quedará registrado como desconocido y pendiente; permite registrar la entrega y la recepción.</p>}
        </fieldset>
        <label htmlFor="nd-notes">Observaciones <span className="muted">(opcional)</span></label>
        <textarea id="nd-notes" maxLength={500} value={f.notes} onChange={set('notes')} />
        {error && <ErrorPanel error={error} />}
        <ErrorDetails details={error?.body.details} />
        <div className="actions">
          <button type="submit" disabled={busy}>Registrar entrega</button>
          <button type="button" className="secondary" disabled={busy || !f.producer_id} onClick={() => void submit(false)}>Guardar borrador</button>
        </div>
      </form>
    </section>
  );
}
