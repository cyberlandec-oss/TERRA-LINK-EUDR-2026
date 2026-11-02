'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';
import { ErrorDetails, GatePanel, nowLocal, withZone } from '../../../../../lib/deliveries';
import { EFFECT, RUN_STATUS, RUN_TYPE, kg, type LotOptions, type Run } from '../../../../../lib/lots';

// Detalle de proceso (UX_UI §15.2): iniciar reserva entradas; cerrar consume y materializa salidas con balance exacto.
export default function RunDetailPage() {
  const ws = useWorkspace();
  const { runId } = useParams<{ runId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const [r, setR] = useState<Run | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    if (!orgId || !ws.can('lot:read')) return;
    try { setR(await api<Run>(`/api/v1/organizations/${orgId}/process-runs/${runId}`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, runId, ws]);
  useEffect(() => { void load(); }, [load]);
  if (!ws.activeOrg) return null;
  if (!ws.can('lot:read')) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar procesos.', request_id: null })} />;
  const crumbs = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Procesos', href: `/organizaciones/${orgId}/procesos` }];
  if (error) return <><Breadcrumb items={[...crumbs, { label: 'Proceso' }]} /><ErrorPanel error={error} onRetry={load} /></>;
  if (!r) return <Loading label="Cargando proceso…" />;
  const base = `/api/v1/organizations/${orgId}/process-runs/${r.id}`;
  return (
    <>
      <Breadcrumb items={[...crumbs, { label: r.run_code }]} />
      <PageHeader title={`${RUN_TYPE[r.process_type]} ${r.run_code}`} meta={<StatusBadge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</StatusBadge>} />
      {r.drying_note && <p className="alert review" role="note">{r.drying_note}</p>}
      <section className="card" aria-labelledby="rn-sum">
        <h2 id="rn-sum">Resumen</h2>
        <dl className="props">
          <dt>Producto de salida</dt><dd>{r.output_product.name}</dd>
          <dt>Inicio</dt><dd>{r.started_at ? new Date(r.started_at).toLocaleString('es-EC') : '—'}</dd>
          <dt>Cierre</dt><dd>{r.closed_at ? new Date(r.closed_at).toLocaleString('es-EC') : '—'}</dd>
          {r.cancel_reason && <><dt>Cancelado</dt><dd>{r.cancel_reason}</dd></>}
        </dl>
        <h3>Entradas</h3>
        {r.inputs.length === 0 ? <p className="muted">Sin entradas (se reservan al iniciar).</p> : <ul className="plain" aria-label="Entradas del proceso">{r.inputs.map((i) => <li key={i.lot_id}><Link href={`/organizaciones/${orgId}/lotes/${i.lot_id}`}>{i.lot_code}</Link> · {i.product}: {kg(i.quantity.value)} {EFFECT[i.effect]}{i.origin_status === 'INCOMPLETE' ? ' · origen incompleto' : ''}</li>)}</ul>}
        {r.outputs.length > 0 && <><h3>Salidas</h3><ul className="plain" aria-label="Salidas del proceso">{r.outputs.map((o) => <li key={o.lot_id}><Link href={`/organizaciones/${orgId}/lotes/${o.lot_id}`}>{o.lot_code}</Link>: {kg(o.quantity.value)}</li>)}</ul></>}
        {r.balance && <p>Balance: entradas {kg(r.balance.input)} = salidas {kg(r.balance.output)} + pérdida {kg(r.balance.loss)} · rendimiento en masa {r.balance.mass_yield_percent} %<br /><span className="field-help">{r.balance.note}</span></p>}
        {r.moisture && <>
          <h3>Humedad final</h3>
          <dl className="props">
            <dt>Medición</dt><dd>{r.moisture.display} {r.moisture.unit} <span className="muted">(valor registrado: {r.moisture.value})</span></dd>
            <dt>Método</dt><dd>{r.moisture.method ?? <span className="muted">—</span>}</dd>
            <dt>Responsable</dt><dd>{r.moisture.measured_by ?? <span className="muted">—</span>}</dd>
          </dl>
          <p className="field-help">{r.moisture.note}</p>
        </>}
      </section>
      {r.actions.start && <StartForm base={base} orgId={orgId} onDone={setR} />}
      {r.status === 'RUNNING' && r.close_preview && <section className="card"><GatePanel title="Para cerrar el proceso" gate={r.close_preview} /></section>}
      {r.actions.close && <CloseForm r={r} base={base} onDone={setR} />}
      {r.actions.cancel && <CancelForm base={base} onDone={setR} />}
    </>
  );
}

function useRun(onDone: (r: Run) => void) {
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [op, setOp] = useState(() => crypto.randomUUID());
  async function run(fn: (op: string) => Promise<{ run: Run }>) {
    setError(null); setBusy(true);
    try { const x = await fn(op); setOp(crypto.randomUUID()); onDone(x.run); } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }
  return { busy, run, feedback: error ? <><ErrorPanel error={error} /><ErrorDetails details={error.body.details} /></> : null };
}

function StartForm({ base, orgId, onDone }: { base: string; orgId: string; onDone: (r: Run) => void }) {
  const s = useRun(onDone);
  const [opts, setOpts] = useState<LotOptions | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [at, setAt] = useState(nowLocal());
  useEffect(() => { api<LotOptions>(`/api/v1/organizations/${orgId}/lot-options`).then(setOpts).catch(() => setOpts(null)); }, [orgId]);
  return (
    <section className="card form" aria-labelledby="st-title">
      <h2 id="st-title">Iniciar: reservar entradas</h2>
      <p className="muted">Lotes del mismo producto y del mismo tipo de origen. La disponibilidad se recalcula en el servidor al iniciar.</p>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void s.run((op) => api<{ run: Run }>(`${base}/start`, { method: 'POST', body: { operation_id: op, started_at: withZone(at), inputs: Object.entries(qty).filter(([, v]) => v.trim()).map(([lot_id, v]) => ({ lot_id, quantity: v.replace(',', '.') })) } })); }}>
        <label htmlFor="st-at">Inicio</label><input id="st-at" type="datetime-local" required value={at} onChange={(e) => setAt(e.target.value)} />
        {opts && opts.lots.length === 0 && <p className="muted">No hay lotes con saldo de procesamiento.</p>}
        {opts && opts.lots.length > 0 && <div className="table-wrap"><table aria-label="Lotes disponibles">
          <thead><tr><th scope="col">Lote</th><th scope="col">Producto</th><th scope="col">Origen</th><th scope="col">Disponible</th><th scope="col">Reservar (kg)</th></tr></thead>
          <tbody>{opts.lots.map((l) => <tr key={l.id}><td>{l.lot_code}</td><td>{l.product_name}</td><td>{l.origin_status === 'COMPLETE' ? 'declarado' : 'incompleto'}</td><td>{kg(l.available)}</td>
            <td><label className="visually-hidden" htmlFor={`rs-${l.id}`}>Reservar de {l.lot_code}</label><input id={`rs-${l.id}`} inputMode="decimal" value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /></td></tr>)}</tbody>
        </table></div>}
        {s.feedback}
        <div className="actions"><button type="submit" disabled={s.busy}>Iniciar proceso</button></div>
      </form>
    </section>
  );
}

function CloseForm({ r, base, onDone }: { r: Run; base: string; onDone: (r: Run) => void }) {
  const s = useRun(onDone);
  // D-32: la humedad del secado es una medición en %BH con método declarado; la unidad no se escribe a mano.
  const [f, setF] = useState({ at: nowLocal(), output: '', loss: '', moisture: '', method: '' });
  const total = r.inputs.reduce((a, i) => a + Number(i.quantity.value), 0);
  return (
    <section className="card form" aria-labelledby="cl-title">
      <h2 id="cl-title">Cerrar: salidas y pérdida</h2>
      <p className="muted">Entradas reservadas: {kg(String(total))}. Debe cumplirse entradas = salida + pérdida explícita (0 admitido), sin tolerancia.</p>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void s.run((op) => api<{ run: Run }>(`${base}/close`, { method: 'POST', body: {
        operation_id: op, closed_at: withZone(f.at), outputs: [{ quantity: f.output.replace(',', '.') }], loss_quantity: f.loss.replace(',', '.'),
        ...(f.moisture ? { moisture: { value: f.moisture.replace(',', '.'), unit: '%BH', method: f.method.trim() } } : {}) } })); }}>
        <div className="grid-3">
          <div><label htmlFor="cl-at">Cierre</label><input id="cl-at" type="datetime-local" required value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></div>
          <div><label htmlFor="cl-out">Salida (kg)</label><input id="cl-out" required inputMode="decimal" value={f.output} onChange={(e) => setF({ ...f, output: e.target.value })} /></div>
          <div><label htmlFor="cl-loss">Pérdida (kg)</label><input id="cl-loss" required inputMode="decimal" value={f.loss} onChange={(e) => setF({ ...f, loss: e.target.value })} /></div>
        </div>
        {r.process_type === 'DRYING' && <>
          <div className="grid-2">
            <div><label htmlFor="cl-moist">Humedad final (% en base húmeda)</label><input id="cl-moist" required inputMode="decimal" value={f.moisture} onChange={(e) => setF({ ...f, moisture: e.target.value })} />
              <div className="field-help">Porcentaje en base húmeda. Se guarda el valor que midas, hasta seis decimales; más precisión se rechaza en vez de redondearse. La pantalla muestra un decimal.</div></div>
            <div><label htmlFor="cl-mm">Método de medición</label><input id="cl-mm" required minLength={3} maxLength={120} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} />
              <div className="field-help">Con qué se midió (medidor portátil, estufa, laboratorio…). El responsable es quien cierra el proceso.</div></div>
          </div>
          <p className="muted">Cerrar un secado exige la humedad (D-32). No hay límites de aceptación: el sistema no decide si un valor es «bueno».</p>
        </>}
        {s.feedback}
        <div className="actions"><button type="submit" disabled={s.busy}>Cerrar proceso</button></div>
      </form>
    </section>
  );
}

function CancelForm({ base, onDone }: { base: string; onDone: (r: Run) => void }) {
  const s = useRun(onDone);
  const [reason, setReason] = useState('');
  return (
    <section className="card form" aria-labelledby="cn-title">
      <h2 id="cn-title">Cancelar proceso</h2>
      <p className="muted">Cancelar libera las reservas; no consume entradas ni crea salidas.</p>
      <form className="inline-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void s.run((op) => api<{ run: Run }>(`${base}/cancel`, { method: 'POST', body: { operation_id: op, reason } })); }}>
        <label htmlFor="cn-reason">Motivo de la cancelación</label>
        <input id="cn-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        <button type="submit" className="secondary inline" disabled={s.busy}>Cancelar proceso</button>
        {s.feedback}
      </form>
    </section>
  );
}
