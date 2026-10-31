'use client';

import Link from 'next/link';
import { ReferenciaPublica } from '../../../../../lib/public-reference';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';
import { ErrorDetails } from '../../../../../lib/deliveries';
import { EFFECT, RUN_TYPE, kg, type Lot } from '../../../../../lib/lots';
import { SHIPMENT_EFFECT } from '../../../../../lib/shipments';
import { EvidenceSection, RiskDdSection } from '../../../../../lib/lot-hub';

// Lot Hub (UX_UI §15.1; P0-027): resumen, operación, origen y trazabilidad, evidencias, riesgo y debida diligencia e historia.
// Solo nodos legibles; sin conteos ocultos. Cada sección se autoriza y carga por separado (lib/lot-hub.tsx).
export default function LotDetailPage() {
  const ws = useWorkspace();
  const { lotId } = useParams<{ lotId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const [l, setL] = useState<Lot | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    if (!orgId || !ws.can('lot:read')) return;
    try { setL(await api<Lot>(`/api/v1/organizations/${orgId}/lots/${lotId}`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, lotId, ws]);
  useEffect(() => { void load(); }, [load]);
  if (!ws.activeOrg) return null;
  if (!ws.can('lot:read')) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar lotes.', request_id: null })} />;
  const crumbs = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Lotes', href: `/organizaciones/${orgId}/lotes` }];
  if (error) return <><Breadcrumb items={[...crumbs, { label: 'Lote' }]} /><ErrorPanel error={error} onRetry={load} /></>;
  if (!l) return <Loading label="Cargando lote…" />;
  async function release(inputId: string) {
    const reason = window.prompt('Motivo para liberar la asignación');
    if (!reason || reason.trim().length < 3) return;
    setActionError(null);
    try { setL((await api<{ lot: Lot }>(`/api/v1/organizations/${orgId}/lots/${lotId}/inputs/${inputId}/release`, { method: 'POST', body: { operation_id: crypto.randomUUID(), reason: reason.trim() } })).lot); } catch (err) { setActionError(err as ApiError); }
  }
  return (
    <>
      <Breadcrumb items={[...crumbs, { label: l.lot_code }]} />
      <PageHeader title={`Lote ${l.lot_code}`} meta={<>{l.product.name} · {l.status === 'OPEN' ? 'admite entradas' : 'cerrado a entradas'}</>} />
      <section className="card" aria-labelledby="lt-sum">
        <h2 id="lt-sum">Resumen</h2>
        <dl className="props">
          <dt>Origen</dt><dd>{l.origin.status === 'COMPLETE' ? <StatusBadge tone="valid">{l.origin.label}</StatusBadge> : <StatusBadge tone="review">{l.origin.label}</StatusBadge>}{l.origin.note && <div className="field-help">{l.origin.note}</div>}</dd>
          <dt>Calidad</dt><dd>{l.quality.label}<div className="field-help">{l.quality.note}</div></dd>
          <dt>Existencia física</dt><dd>{kg(l.quantities.physical)}</dd>
          <dt>Reservado</dt><dd>{kg(l.quantities.reserved)}</dd>
          <dt>Disponible</dt><dd><strong>{kg(l.quantities.available)}</strong><div className="field-help">{l.quantities.note}</div></dd>
          <dt>Formado o producido</dt><dd>{kg(l.quantities.base)} <span className="muted">· consumido por procesos {kg(l.quantities.consumed)}{l.quantities.dispatched && l.quantities.dispatched !== '0' ? ` · despachado ${kg(l.quantities.dispatched)}` : ''}</span></dd>
          <dt>Por centro</dt><dd>{l.quantities.by_location.length === 0 ? <span className="muted">sin existencia</span> : <ul className="plain" aria-label="Existencia por centro">{l.quantities.by_location.map((b) => <li key={b.location_id ?? 'pend'}>{b.pending_location ? <StatusBadge tone="review">Pendiente de asignación</StatusBadge> : b.location}: {kg(b.physical)} (reservado {kg(b.reserved)})</li>)}</ul>}</dd>
        </dl>
      </section>
      <section className="card" aria-labelledby="lt-op">
        <h2 id="lt-op">Operación</h2>
        {l.produced_by && <p>Producido por <Link href={`/organizaciones/${orgId}/procesos/${l.produced_by.run_id}`}>{l.produced_by.run_code}</Link> ({RUN_TYPE[l.produced_by.process_type]}): {kg(l.produced_by.quantity.value)}</p>}
        {l.source === 'RECEPTIONS' && (
          <ul className="plain" aria-label="Entradas del lote">
            {l.inputs.length === 0 && <li className="muted">Sin entradas visibles.</li>}
            {l.inputs.map((i) => (
              <li key={i.id}>{i.delivery_id ? <Link href={`/organizaciones/${orgId}/entregas/${i.delivery_id}`}>{i.delivery_code}</Link> : i.delivery_code} · {i.producer_code}: {kg(i.quantity.value)} <span className="muted">(recepción versión {i.reception_version}; pesaje vigente usado)</span>
                {i.released ? <span className="muted"> · liberada: {i.released.reason}</span> : l.actions.release_input && <> <button type="button" className="secondary inline" onClick={() => void release(i.id)}>Liberar</button></>}
              </li>
            ))}
          </ul>
        )}
        {actionError && <><ErrorPanel error={actionError} /><ErrorDetails details={actionError.body.details} /></>}
        {l.used_by.length > 0 && <><h3>Uso en procesos</h3><ul className="plain" aria-label="Uso en procesos">{l.used_by.map((u) => <li key={u.run_id}><Link href={`/organizaciones/${orgId}/procesos/${u.run_id}`}>{u.run_code}</Link> ({RUN_TYPE[u.process_type]}): {kg(u.quantity.value)} {EFFECT[u.effect]}</li>)}</ul></>}
      </section>
      <section className="card" aria-labelledby="lt-trace">
        <h2 id="lt-trace">Origen y trazabilidad</h2>
        <h3>Hacia atrás</h3>
        {l.upstream.lots.length === 0 && l.upstream.receptions.length === 0 && <p className="muted">Sin enlaces visibles.</p>}
        <ul className="plain" aria-label="Origen hacia atrás">
          {l.upstream.lots.map((u) => <li key={u.lot_id}>{'↳ '.repeat(u.depth)}<Link href={`/organizaciones/${orgId}/lotes/${u.lot_id}`}>{u.lot_code}</Link>{u.contributed && ` · aportó ${kg(u.contributed.value)}`}</li>)}
          {l.upstream.receptions.map((r, i) => (
            <li key={i}>Recepción {r.delivery_id ? <Link href={`/organizaciones/${orgId}/entregas/${r.delivery_id}`}>{r.delivery_code}</Link> : r.delivery_code}
              {' · '}{r.producer_id ? <Link href={`/organizaciones/${orgId}/productores/${r.producer_id}`}>{r.producer_code}</Link> : r.producer_code}{r.producer_name ? ` (${r.producer_name})` : ''}
              {' · '}{r.plot_links && r.plot_links.length ? <>parcelas {r.plot_links.map((p, j) => <span key={p.id}>{j ? ', ' : ''}<Link href={`/organizaciones/${orgId}/parcelas/${p.id}`}>{p.code}</Link></span>)}</>
                : r.plots_restricted ? <span className="muted">parcelas restringidas para tu rol</span> : r.origin_known ? `parcelas ${r.plots.join(', ')}` : 'origen no declarado'}
              {' · '}{kg(r.quantity.value)}
            </li>
          ))}
        </ul>
        <p className="field-help">{l.upstream.note}</p>
        <h3>Hacia adelante</h3>
        {l.downstream.length === 0 ? <p className="muted">Sin salidas.</p> : <ul className="plain" aria-label="Destino hacia adelante">{l.downstream.map((d) => <li key={d.lot_id}>{'↳ '.repeat(d.depth)}<Link href={`/organizaciones/${orgId}/lotes/${d.lot_id}`}>{d.lot_code}</Link> · vía {d.via_run}</li>)}</ul>}
        <h3>Embarques</h3>
        {l.shipments == null ? <p className="muted">Tu rol no permite consultar embarques.</p>
          : l.shipments.length === 0 ? <p className="muted">El lote no está en ningún embarque.</p>
            : <ul className="plain" aria-label="Embarques del lote">{l.shipments.map((s) => <li key={s.shipment_id}><Link href={`/organizaciones/${orgId}/embarques/${s.shipment_id}`}>{s.shipment_code}</Link> · {s.buyer_code} → {s.destination_country} · {kg(s.quantity.value)} · {SHIPMENT_EFFECT[s.effect]}</li>)}</ul>}
      </section>
      <EvidenceSection orgId={orgId} can={ws.can}
        plots={[...new Map(l.upstream.receptions.flatMap((r) => r.plot_links ?? []).map((p) => [p.id, p])).values()]}
        producers={[...new Map(l.upstream.receptions.filter((r) => r.producer_id).map((r) => [r.producer_id!, { id: r.producer_id!, code: r.producer_code }])).values()]} />
      <RiskDdSection orgId={orgId} lotId={l.id} can={ws.can} />
      <Alert tone="info">Existencia, calidad y origen son dimensiones separadas: tener existencia no significa calidad liberada ni origen completo. Movimientos en <Link href={`/organizaciones/${orgId}/inventario`}>Inventario</Link>.</Alert>
      <section className="card">
        <ReferenciaPublica reference={l.public_reference ?? null} />
      </section>
      <section className="card" aria-labelledby="lt-hist">
        <h2 id="lt-hist">Historia</h2>
        <ol className="plain" aria-label="Historia del lote">{l.history.map((h) => <li key={h.version}><strong>{h.event_type}</strong> <span className="muted">· {h.actor} · {new Date(h.occurred_at).toLocaleString('es-EC')}</span></li>)}</ol>
      </section>
    </>
  );
}
