'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { ErrorDetails } from '../../../../lib/deliveries';
import { kg } from '../../../../lib/lots';
import { SHIPMENT_STATUS, type Buyer, type Shipment, type ShipmentOptions, type ShipmentRow } from '../../../../lib/shipments';

// P0-029 Embarques: lista, nuevo embarque y compradores declarados (UX_UI §14 EXPORT_MANAGER).
export default function ShipmentsPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const can = ws.can('shipment:read');
  const [rows, setRows] = useState<ShipmentRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    if (!orgId || !can) return;
    try { setRows(await api<ShipmentRow[]>(`/api/v1/organizations/${orgId}/shipments`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, can]);
  useEffect(() => { void load(); }, [load]);
  if (!ws.activeOrg) return null;
  if (!can) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar embarques.', request_id: null })} />;
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Embarques' }]} />
      <PageHeader title="Embarques" meta="Comprador y destino declarados por tu organización. Reservar aparta existencia en el centro de salida; despachar exige que todas las comprobaciones pasen." />
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!rows && !error && <Loading label="Cargando embarques…" />}
      {rows && rows.length === 0 && <EmptyState title="Aún no hay embarques." />}
      {rows && rows.length > 0 && (
        <div className="table-wrap"><table aria-label="Embarques">
          <thead><tr><th scope="col">Embarque</th><th scope="col">Comprador</th><th scope="col">Destino</th><th scope="col">Salida</th><th scope="col">Lotes</th><th scope="col">Estado</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/organizaciones/${orgId}/embarques/${r.id}`}>{r.shipment_code}</Link></td>
              <td>{r.buyer_code}<div className="muted">{r.buyer_name}</div></td>
              <td>{r.destination_country}{r.destination_place ? ` · ${r.destination_place}` : ''}</td>
              <td>{r.location_code}</td>
              <td>{r.items} · {kg(r.quantity.value)}</td>
              <td><StatusBadge tone={SHIPMENT_STATUS[r.status].tone}>{SHIPMENT_STATUS[r.status].label}</StatusBadge></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {ws.can('shipment:manage') && <NewShipment orgId={orgId} />}
      <Buyers orgId={orgId} canManage={ws.can('shipment:manage')} />
    </>
  );
}

function NewShipment({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [opts, setOpts] = useState<ShipmentOptions | null>(null);
  const [f, setF] = useState({ buyer_id: '', destination_country: '', destination_place: '', origin_location_id: '', notes: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [op, setOp] = useState(() => crypto.randomUUID());
  const loadOpts = useCallback(() => { api<ShipmentOptions>(`/api/v1/organizations/${orgId}/shipments/options`).then(setOpts).catch((e) => setError(e as ApiError)); }, [orgId]);
  useEffect(() => { loadOpts(); }, [loadOpts]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const r = await api<{ shipment: Shipment }>(`/api/v1/organizations/${orgId}/shipments`, { method: 'POST', body: { operation_id: op, buyer_id: f.buyer_id, destination_country: f.destination_country.trim().toUpperCase(),
        origin_location_id: f.origin_location_id, ...(f.destination_place.trim() ? { destination_place: f.destination_place.trim() } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) } });
      setOp(crypto.randomUUID());
      router.push(`/organizaciones/${orgId}/embarques/${r.shipment.id}`);
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }
  return (
    <section className="card form" aria-labelledby="ns-title">
      <h2 id="ns-title">Nuevo embarque</h2>
      {!opts && !error && <Loading label="Cargando opciones…" />}
      {opts && opts.buyers.length === 0 && <p className="muted">Registra primero un comprador (abajo).</p>}
      {opts && opts.buyers.length > 0 && (
        <form onSubmit={submit}>
          <label htmlFor="ns-buyer">Comprador</label>
          <select id="ns-buyer" required value={f.buyer_id} onChange={(e) => setF({ ...f, buyer_id: e.target.value })}>
            <option value="">Selecciona…</option>{opts.buyers.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name} ({b.country})</option>)}
          </select>
          <label htmlFor="ns-country">País de destino (ISO, dos letras)</label>
          <input id="ns-country" required maxLength={2} autoComplete="off" value={f.destination_country} onChange={(e) => setF({ ...f, destination_country: e.target.value })} aria-describedby="ns-country-help" />
          <p id="ns-country-help" className="field-help">Por ejemplo NL, DE, US. Es un dato declarado; Terra Link no lo verifica.</p>
          <label htmlFor="ns-place">Puerto o lugar de destino (opcional)</label>
          <input id="ns-place" value={f.destination_place} onChange={(e) => setF({ ...f, destination_place: e.target.value })} />
          <label htmlFor="ns-loc">Centro de salida</label>
          <select id="ns-loc" required value={f.origin_location_id} onChange={(e) => setF({ ...f, origin_location_id: e.target.value })} aria-describedby="ns-loc-help">
            <option value="">Selecciona…</option>{opts.locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}
          </select>
          <p id="ns-loc-help" className="field-help">Las reservas usan el disponible de este centro; si un lote está en otro, trasládalo antes desde Inventario.</p>
          <label htmlFor="ns-notes">Notas (opcional)</label>
          <textarea id="ns-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          {error && <><ErrorPanel error={error} /><ErrorDetails details={error.body.details} /></>}
          <div className="actions"><button type="submit" disabled={busy}>Crear embarque</button></div>
        </form>
      )}
      {!opts && error && <ErrorPanel error={error} onRetry={loadOpts} />}
    </section>
  );
}

function Buyers({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const [rows, setRows] = useState<{ items: Buyer[]; note: string } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [f, setF] = useState({ code: '', name: '', country: '' });
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [op, setOp] = useState(() => crypto.randomUUID());
  const load = useCallback(async () => {
    try { setRows(await api<{ items: Buyer[]; note: string }>(`/api/v1/organizations/${orgId}/buyers`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setFormError(null); setBusy(true);
    try {
      await api(`/api/v1/organizations/${orgId}/buyers`, { method: 'POST', body: { operation_id: op, code: f.code.trim().toUpperCase(), name: f.name.trim(), country: f.country.trim().toUpperCase() } });
      setOp(crypto.randomUUID()); setF({ code: '', name: '', country: '' }); await load();
    } catch (err) { setFormError(err as ApiError); } finally { setBusy(false); }
  }
  return (
    <section className="card" aria-labelledby="by-title">
      <h2 id="by-title">Compradores</h2>
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!rows && !error && <Loading label="Cargando compradores…" />}
      {rows && <p className="muted">{rows.note}</p>}
      {rows && rows.items.length === 0 && <p className="muted">Aún no hay compradores.</p>}
      {rows && rows.items.length > 0 && <ul className="plain" aria-label="Compradores">{rows.items.map((b) => <li key={b.id}>{b.code} · {b.name} ({b.country}){b.status === 'INACTIVE' ? ' · inactivo' : ''}</li>)}</ul>}
      {canManage && (
        <form className="form" onSubmit={submit} aria-labelledby="nb-title">
          <h3 id="nb-title">Registrar comprador</h3>
          <label htmlFor="nb-code">Código</label>
          <input id="nb-code" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} aria-describedby="nb-code-help" />
          <p id="nb-code-help" className="field-help">Mayúsculas, números, guion o guion bajo (por ejemplo IMP-NL-01).</p>
          <label htmlFor="nb-name">Nombre</label>
          <input id="nb-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <label htmlFor="nb-country">País (ISO, dos letras)</label>
          <input id="nb-country" required maxLength={2} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} />
          {formError && <><ErrorPanel error={formError} /><ErrorDetails details={formError.body.details} /></>}
          <div className="actions"><button type="submit" disabled={busy}>Registrar comprador</button></div>
        </form>
      )}
    </section>
  );
}
