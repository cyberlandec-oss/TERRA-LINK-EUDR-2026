'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../../lib/api';
import { useI18n } from '../../../../../lib/i18n';
import { useWorkspace } from '../../../../../lib/workspace';
import { CIERRES, COMPROBACIONES, DIFERENCIAS, ESTADO_TRASPASO, LADOS, PASOS, RESOLUCIONES, type ControlSalida, type OpcionesTraspaso, type Traspaso } from '../../../../../lib/traspasos';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';

// A-03 — Detalle de un traspaso, POR LADO: cada organización ve el estado, las cantidades del traspaso y sus diferencias; nunca el inventario ni los
// centros de la otra. Las acciones salen de `next_actions` (que decide la API según estado y lado) y del permiso efectivo; el servidor decide siempre.
// Cuatro cantidades se mantienen separadas y nunca se suman entre sí: reservada/ofrecida, en tránsito, recibida y diferencias pendientes.
export default function TraspasoDetallePage() {
  const ws = useWorkspace();
  const { t, dt } = useI18n();
  const { transferId } = useParams<{ transferId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const base = `/api/v1/organizations/${orgId}/custody-transfers/${transferId}`;
  const [tr, setTr] = useState<Traspaso | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [salida, setSalida] = useState<{ data: ControlSalida | null; error: ApiError | null }>({ data: null, error: null });
  const [opciones, setOpciones] = useState<OpcionesTraspaso | null>(null);

  const cargarSalida = useCallback(async () => {
    try { setSalida({ data: await api<ControlSalida>(`${base}/preflight`), error: null }); } catch (e) { setSalida({ data: null, error: e as ApiError }); }
  }, [base]);
  const cargar = useCallback(async () => {
    if (!orgId || !ws.can('transfer:read')) return;
    try {
      const x = await api<Traspaso>(base);
      setTr(x); setError(null);
      if (x.side === 'SENDER' && x.status === 'ACCEPTED') void cargarSalida();
      if (x.side === 'RECEIVER' && x.status === 'OFFERED') api<OpcionesTraspaso>(`/api/v1/organizations/${orgId}/custody-transfers/options`).then(setOpciones).catch(() => undefined);
    } catch (e) { setError(e as ApiError); }
  }, [orgId, ws, base, cargarSalida]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!ws.activeOrg) return null;
  const crumbs = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Traspasos'), href: `/organizaciones/${orgId}/traspasos` }];
  if (!ws.can('transfer:read')) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar traspasos.', request_id: null })} />;
  if (error) return <><Breadcrumb items={[...crumbs, { label: t('Traspaso') }]} /><ErrorPanel error={error} onRetry={cargar} /></>;
  if (!tr) return <Loading label={t('Cargando traspaso…')} />;

  const hecho = (x: Traspaso) => { setTr(x); setSalida({ data: null, error: null }); if (x.side === 'SENDER' && x.status === 'ACCEPTED') void cargarSalida(); };
  const puede = (accion: string, permiso: string) => tr.next_actions.includes(accion) && ws.can(permiso);
  const q = tr.quantities;
  const otra = tr.side === 'SENDER' ? tr.receiver : tr.sender;

  return (
    <>
      <Breadcrumb items={[...crumbs, { label: tr.code }]} />
      <PageHeader title={`${t('Traspaso')} ${tr.code}`} meta={<><StatusBadge tone={ESTADO_TRASPASO[tr.status].tone}>{t(ESTADO_TRASPASO[tr.status].label)}</StatusBadge> <span>{t('Tu lado')}: {t(LADOS[tr.side])}</span></>} />
      <Alert tone="info" title={t('Qué es este traspaso y qué no')}>
        <ul>{tr.boundaries.map((b) => <li key={b}>{t(b)}</li>)}</ul>
      </Alert>

      <section className="card" aria-labelledby="td-res">
        <h2 id="td-res">{t('Resumen')}</h2>
        <dl className="props">
          <dt>{t('Emisora')}</dt><dd>{tr.sender.name}{tr.side === 'SENDER' && <span className="muted"> · {t('tu organización')}</span>}</dd>
          <dt>{t('Receptora')}</dt><dd>{tr.receiver.name}{tr.side === 'RECEIVER' && <span className="muted"> · {t('tu organización')}</span>}</dd>
          <dt>{t('Cantidad ofrecida')}</dt><dd>{tr.quantity} kg</dd>
          <dt>{tr.side === 'SENDER' ? t('Tu lote de salida') : t('Tu lote recibido')}</dt><dd>{tr.your_lot_code ?? <span className="muted">{t('Se crea con la primera recepción')}</span>}</dd>
          <dt>{tr.side === 'SENDER' ? t('Tu centro de salida') : t('Tu centro de recepción')}</dt><dd>{tr.your_location_code ?? <span className="muted">{t('Lo eliges al aceptar')}</span>}</dd>
          {tr.your_product_name && <><dt>{t('Producto con el que lo registras')}</dt><dd>{tr.your_product_name}</dd></>}
          {tr.note && <><dt>{t('Nota')}</dt><dd>{tr.note}</dd></>}
          {tr.closure && <><dt>{t('Cierre')}</dt><dd>{t(CIERRES[tr.closure])}</dd></>}
          {tr.reject_reason && <><dt>{t('Motivo del rechazo')}</dt><dd>{tr.reject_reason}</dd></>}
          {tr.cancel_reason && <><dt>{t('Motivo de la cancelación')}</dt><dd>{tr.cancel_reason}</dd></>}
          {tr.is_return_of && <><dt>{t('Devolución de')}</dt><dd><a href={`/organizaciones/${orgId}/traspasos/${tr.is_return_of.id}`}>{tr.is_return_of.transfer_code}</a></dd></>}
        </dl>
        <p className="field-help">{t('Contraparte: {nombre}. Solo ves el estado y las cantidades de este traspaso, no su inventario ni sus centros.', { nombre: otra.name })}</p>
      </section>

      {tr.origin_projection && (
        <section className="card" aria-labelledby="td-or">
          <h2 id="td-or">{t('Instantánea técnica del origen declarado')}</h2>
          <dl className="props">
            <dt>{t('Organización emisora')}</dt><dd>{tr.origin_projection.sender_organization}</dd>
            <dt>{t('Lote de la emisora')}</dt><dd>{tr.origin_projection.sender_lot_code}</dd>
            <dt>{t('Producto')}</dt><dd>{tr.origin_projection.product.code} · {tr.origin_projection.product.name}</dd>
            <dt>{t('Origen declarado por la emisora')}</dt><dd>{tr.origin_projection.origin_status === 'COMPLETE' ? t('Declarado en todos los insumos') : t('Incompleto')}</dd>
            <dt>{t('Capturada')}</dt><dd>{dt(tr.origin_projection.captured_at)}</dd>
            <dt>{t('Huella (SHA-256)')}</dt><dd className="hash">{tr.origin_projection_hash}</dd>
          </dl>
          <p className="field-help">{t('Es una instantánea inmutable: no prueba origen completo ni cumplimiento, y no transfiere expediente, severidad ni conclusión. Tu lote recibido queda con origen incompleto.')}</p>
        </section>
      )}

      <section className="card" aria-labelledby="td-can">
        <h2 id="td-can">{t('Cantidades (se mantienen separadas)')}</h2>
        <div className="table-wrap">
          <table aria-label={t('Cantidades del traspaso')}>
            <thead><tr><th scope="col">{t('Concepto')}</th><th scope="col">{t('Cantidad')}</th><th scope="col">{t('Qué significa')}</th></tr></thead>
            <tbody>
              <tr><th scope="row">{t('Ofrecida')}</th><td>{q.offered} kg</td><td className="muted">{t('Lo que se propuso trasladar. Hasta la salida está reservada en el inventario de la emisora.')}</td></tr>
              <tr><th scope="row">{t('Salida registrada')}</th><td>{q.dispatched} kg</td><td className="muted">{t('Lo que ya salió del inventario de la emisora.')}</td></tr>
              <tr><th scope="row">{t('En tránsito')}</th><td>{q.in_transit} kg</td><td className="muted">{t('Salió y todavía no está recibido, devuelto ni confirmado como pérdida. No es saldo de ninguna de las dos.')}</td></tr>
              <tr><th scope="row">{t('Recibida')}</th><td>{q.received} kg</td><td className="muted">{t('Ya está en el inventario de la receptora.')}</td></tr>
              <tr><th scope="row">{t('Devuelta a la emisora (rechazo en tránsito)')}</th><td>{q.returned_to_sender_in_transit} kg</td><td className="muted">{t('Rechazada por la receptora; vuelve al lote y centro de origen de la emisora.')}</td></tr>
              <tr><th scope="row">{t('Pérdida confirmada')}</th><td>{q.loss_confirmed} kg</td><td className="muted">{t('Solo cuando la contraparte la confirma con motivo. Una diferencia pendiente no es una pérdida.')}</td></tr>
              <tr><th scope="row">{t('Faltante pendiente')}</th><td>{q.open_shortage} kg</td><td className="muted">{t('Declarado y sin conciliar: sigue contando como tránsito.')}</td></tr>
              <tr><th scope="row">{t('Sobrante pendiente')}</th><td>{q.open_overage} kg</td><td className="muted">{t('Declarado y sin confirmar: no crea existencias hasta que la emisora lo confirme.')}</td></tr>
              {Number(q.overage_confirmed) > 0 && <tr><th scope="row">{t('Sobrante confirmado')}</th><td>{q.overage_confirmed} kg</td><td className="muted">{t('Confirmado por la emisora; ya está en el inventario de la receptora.')}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {tr.side === 'SENDER' && tr.status === 'ACCEPTED' && (
        <section className="card" aria-labelledby="td-pf">
          <h2 id="td-pf">{t('Comprobaciones para registrar la salida')}</h2>
          {salida.error && <ErrorPanel error={salida.error} onRetry={cargarSalida} />}
          {!salida.data && !salida.error && <Loading label={t('Evaluando comprobaciones…')} />}
          {salida.data && (
            <ul className="stack">
              {salida.data.checks.map((c) => (
                <li key={c.code}><StatusBadge tone={c.status === 'OK' ? 'valid' : 'blocked'}>{c.status === 'OK' ? t('Cumple') : t('Bloquea')}</StatusBadge> <strong>{t(COMPROBACIONES[c.code] ?? c.label)}</strong><div className="muted">{c.message}</div></li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card" aria-labelledby="td-acc">
        <h2 id="td-acc">{t('Acciones')}</h2>
        {tr.next_actions.length === 0 && <p className="muted">{t('Este traspaso no admite más acciones.')}</p>}
        <div className="stack">
          {puede('ACCEPT', 'transfer:accept') && <Aceptar base={base} tr={tr} opciones={opciones} onDone={hecho} />}
          {puede('REJECT', 'transfer:accept') && <Accion base={base} tr={tr} path="reject" etiqueta={t('Rechazar la oferta')} motivo onDone={hecho} />}
          {puede('CANCEL', 'transfer:offer') && <Accion base={base} tr={tr} path="cancel" etiqueta={t('Cancelar el traspaso')} motivo onDone={hecho} ayuda={t('Libera la reserva. Solo antes de la salida.')} />}
          {puede('DISPATCH', 'transfer:dispatch') && <Accion base={base} tr={tr} path="dispatch" etiqueta={t('Registrar la salida')} onDone={hecho} bloqueada={!!salida.data && !salida.data.allowed} ayuda={t('Consume la reserva y la existencia de tu lote. El servidor rechaza la salida mientras la compuerta de diligencia debida esté cerrada.')} />}
          {puede('RECEIVE', 'transfer:receive') && <Accion base={base} tr={tr} path="receive" etiqueta={t('Registrar una recepción')} cantidad motivo motivoOpcional onDone={hecho}
            ayuda={t('Registra lo que llegó de verdad. Si llega menos, lo demás sigue en tránsito. Si llega más que lo que está en tránsito, el motivo es obligatorio y el excedente queda como sobrante pendiente.')} />}
          {puede('DECLARE_SHORTAGE', 'transfer:receive') && <Accion base={base} tr={tr} path="shortage" etiqueta={t('Declarar un faltante')} cantidad motivo onDone={hecho} ayuda={t('No es una pérdida: queda pendiente hasta que la emisora la confirme o se reabra.')} />}
          {puede('REJECT_TRANSIT', 'transfer:receive') && <Accion base={base} tr={tr} path="reject-in-transit" etiqueta={t('Rechazar en tránsito')} cantidad motivo onDone={hecho} ayuda={t('Lo rechazado vuelve al lote y centro de origen de la emisora.')} />}
        </div>
      </section>

      {tr.discrepancies.length > 0 && (
        <section className="card" aria-labelledby="td-dif">
          <h2 id="td-dif">{t('Diferencias')}</h2>
          <div className="table-wrap">
            <table aria-label={t('Diferencias del traspaso')}>
              <thead><tr><th scope="col">{t('Tipo')}</th><th scope="col">{t('Cantidad')}</th><th scope="col">{t('Estado')}</th><th scope="col">{t('Motivo')}</th><th scope="col"><span className="visually-hidden">{t('Acciones')}</span></th></tr></thead>
              <tbody>
                {tr.discrepancies.map((d) => (
                  <tr key={d.id}>
                    <td>{t(DIFERENCIAS[d.kind])}<div className="muted">{d.recorded_by === 'YOU' ? t('La declaraste tú') : t('La declaró la otra organización')}</div></td>
                    <td>{d.quantity} kg</td>
                    <td>{d.status === 'OPEN' ? <StatusBadge tone="review">{t('Pendiente')}</StatusBadge> : <StatusBadge tone="valid">{t(RESOLUCIONES[d.resolution ?? ''] ?? 'Resuelta')}</StatusBadge>}</td>
                    <td className="muted">{d.reason}{d.resolution_reason && <><br />{t('Resolución')}: {d.resolution_reason}</>}</td>
                    <td>{d.status === 'OPEN' && ws.can('transfer:resolve') && <Resolver base={base} tr={tr} d={d} onDone={hecho} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tr.returns.length > 0 && (
        <section className="card" aria-labelledby="td-dev">
          <h2 id="td-dev">{t('Devoluciones vinculadas')}</h2>
          <ul>{tr.returns.map((r) => <li key={r.id}><a href={`/organizaciones/${orgId}/traspasos/${r.id}`}>{r.transfer_code}</a> · {r.quantity} kg · {t(ESTADO_TRASPASO[r.status].label)}</li>)}</ul>
        </section>
      )}

      <section className="card" aria-labelledby="td-his">
        <h2 id="td-his">{t('Historia (no se borra ni se reescribe)')}</h2>
        <ol className="timeline">
          {tr.steps.map((s) => (
            <li key={s.id}>
              <strong>{t(PASOS[s.step] ?? s.step)}</strong>{s.quantity && <> · {s.quantity} kg</>} · {s.by === 'YOU' ? t('tú') : s.organization_name} · <span className="muted">{dt(s.at)}</span>
              {s.reason && <div className="muted">{t('Motivo')}: {s.reason}</div>}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function useOperacion() {
  const op = useRef<string | null>(null);
  return { get: () => (op.current ??= crypto.randomUUID()), reset: () => { op.current = null; } };
}

/** Acción con cantidad y/o motivo. Reintenta con la misma operación si hubo un corte; un rechazo del servidor exige revisar y estrena operación. */
function Accion({ base, tr, path, etiqueta, cantidad, motivo, motivoOpcional, ayuda, bloqueada, onDone }: {
  base: string; tr: Traspaso; path: string; etiqueta: string; cantidad?: boolean; motivo?: boolean; motivoOpcional?: boolean; ayuda?: string; bloqueada?: boolean; onDone: (x: Traspaso) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const op = useOperacion();
  const numero = /^\d{1,14}(\.\d{1,6})?$/.test(qty.trim()) && Number(qty) > 0;
  const listo = (!cantidad || numero) && (!motivo || motivoOpcional || why.trim().length >= 3);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ transfer: Traspaso }>(`${base}/${path}`, { method: 'POST', body: { operation_id: op.get(), expected_version: tr.version, ...(cantidad ? { quantity: qty.trim() } : {}), ...(motivo && why.trim() ? { reason: why.trim() } : {}) } });
      op.reset(); setOpen(false); setQty(''); setWhy(''); onDone(r.transfer);
    } catch (err) { const x = err as ApiError; if (!(x.status === 0 || x.status >= 500)) op.reset(); setError(x); } finally { setBusy(false); }
  }
  if (!open) return <div><button type="button" className="secondary" onClick={() => setOpen(true)}>{etiqueta}</button>{bloqueada && <span className="muted"> {t('Hoy la compuerta lo bloquea.')}</span>}</div>;
  return (
    <form onSubmit={submit} className="stack card" aria-label={etiqueta}>
      <h3>{etiqueta}</h3>
      {ayuda && <p className="field-help">{ayuda}</p>}
      {cantidad && (<><label htmlFor={`q-${path}`}>{t('Cantidad (kg)')}</label><input id={`q-${path}`} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></>)}
      {motivo && (<><label htmlFor={`m-${path}`}>{motivoOpcional ? t('Motivo (obligatorio si hay diferencia)') : t('Motivo')}</label><input id={`m-${path}`} maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} /></>)}
      {error && <ErrorPanel error={error} />}
      <div className="actions">
        <button type="submit" disabled={busy || !listo} aria-busy={busy}>{busy ? t('Enviando…') : t('Confirmar')}</button>
        <button type="button" className="secondary" onClick={() => { setOpen(false); setError(null); }} disabled={busy}>{t('Cancelar')}</button>
      </div>
    </form>
  );
}

function Aceptar({ base, tr, opciones, onDone }: { base: string; tr: Traspaso; opciones: OpcionesTraspaso | null; onDone: (x: Traspaso) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [producto, setProducto] = useState('');
  const [centro, setCentro] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const op = useOperacion();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ transfer: Traspaso }>(`${base}/accept`, { method: 'POST', body: { operation_id: op.get(), expected_version: tr.version, product_id: producto, location_id: centro } });
      op.reset(); setOpen(false); onDone(r.transfer);
    } catch (err) { const x = err as ApiError; if (!(x.status === 0 || x.status >= 500)) op.reset(); setError(x); } finally { setBusy(false); }
  }
  if (!open) return <div><button type="button" onClick={() => setOpen(true)}>{t('Aceptar la oferta')}</button></div>;
  return (
    <form onSubmit={submit} className="stack card" aria-label={t('Aceptar la oferta')}>
      <h3>{t('Aceptar la oferta')}</h3>
      <p className="field-help">{t('Elige con qué producto y en qué centro tuyo se registrará lo que recibas. Aceptar no recibe nada: la cantidad entra a tu inventario cuando registres la recepción.')}</p>
      {!opciones && <Loading label={t('Cargando tus productos y centros…')} />}
      {opciones && (
        <>
          <label htmlFor="ac-prod">{t('Producto (en KG)')}</label>
          <select id="ac-prod" value={producto} onChange={(e) => setProducto(e.target.value)}>
            <option value="">{t('Elige un producto…')}</option>
            {opciones.products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
          {opciones.products.length === 0 && <p className="muted" role="status">{t('No tienes productos activos medidos en KG.')}</p>}
          <label htmlFor="ac-centro">{t('Centro de recepción')}</label>
          <select id="ac-centro" value={centro} onChange={(e) => setCentro(e.target.value)}>
            <option value="">{t('Elige un centro…')}</option>
            {opciones.locations.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}
          </select>
        </>
      )}
      {error && <ErrorPanel error={error} />}
      <div className="actions">
        <button type="submit" disabled={busy || !producto || !centro} aria-busy={busy}>{busy ? t('Enviando…') : t('Confirmar')}</button>
        <button type="button" className="secondary" onClick={() => { setOpen(false); setError(null); }} disabled={busy}>{t('Cancelar')}</button>
      </div>
    </form>
  );
}

function Resolver({ base, tr, d, onDone }: { base: string; tr: Traspaso; d: Traspaso['discrepancies'][number]; onDone: (x: Traspaso) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const op = useOperacion();
  // Confirmar una pérdida o un sobrante lo hace la CONTRAPARTE de quien lo declaró; el sobrante, además, lo confirma la emisora.
  const opciones = d.kind === 'SHORTAGE'
    ? [...(d.recorded_by === 'COUNTERPART' ? ['LOSS_CONFIRMED'] : []), 'SHORTAGE_REOPENED']
    : [...(d.recorded_by === 'COUNTERPART' && tr.side === 'SENDER' ? ['OVERAGE_CONFIRMED'] : []), 'OVERAGE_WITHDRAWN'];
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ transfer: Traspaso }>(`${base}/discrepancies/${d.id}/resolve`, { method: 'POST', body: { operation_id: op.get(), expected_version: tr.version, resolution: res, reason: why.trim() } });
      op.reset(); setOpen(false); onDone(r.transfer);
    } catch (err) { const x = err as ApiError; if (!(x.status === 0 || x.status >= 500)) op.reset(); setError(x); } finally { setBusy(false); }
  }
  if (!open) return <button type="button" className="secondary inline" onClick={() => setOpen(true)}>{t('Resolver')}</button>;
  return (
    <form onSubmit={submit} className="stack" aria-label={t('Resolver la diferencia')}>
      <label htmlFor={`rs-${d.id}`}>{t('Resolución')}</label>
      <select id={`rs-${d.id}`} value={res} onChange={(e) => setRes(e.target.value)}>
        <option value="">{t('Elige una resolución…')}</option>
        {opciones.map((o) => <option key={o} value={o}>{t(RESOLUCIONES[o])}</option>)}
      </select>
      <label htmlFor={`rm-${d.id}`}>{t('Motivo')}</label>
      <input id={`rm-${d.id}`} maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} />
      {error && <ErrorPanel error={error} />}
      <div className="actions">
        <button type="submit" disabled={busy || !res || why.trim().length < 3} aria-busy={busy}>{busy ? t('Enviando…') : t('Confirmar')}</button>
        <button type="button" className="secondary" onClick={() => { setOpen(false); setError(null); }} disabled={busy}>{t('Cancelar')}</button>
      </div>
    </form>
  );
}
