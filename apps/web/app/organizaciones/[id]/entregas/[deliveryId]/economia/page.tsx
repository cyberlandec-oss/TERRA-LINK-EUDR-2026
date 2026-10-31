'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ApiError, api } from '../../../../../../lib/api';
import { useWorkspace } from '../../../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../../lib/ui';

// P1-012 — Precio, prima y pagos informados de una entrega (RF-43; S3 §32).
//
// Lo que esta pantalla no puede dejar de decir:
//   · **lo acordado y lo pagado van separados**, y un precio registrado **no demuestra un pago**;
//   · una **prima no declarada** se muestra como tal, **nunca como 0**, y el total se marca **incompleto**;
//   · un importe **no calculable** —unidades o monedas distintas— se explica, no se rellena;
//   · corregir **pide motivo** y **conserva** la versión anterior, visible en el historial;
//   · esto **no es** el presupuesto de preparación de P1-010.

interface Calc {
  currency: string | null; amount: string; premium: string | null; premium_status: string;
  premium_note: string; total: string; complete: boolean; reasons: string[]; note: string;
}
interface Version {
  record_number: number; corrects_record_id: string | null; reason: string | null;
  price: { amount: string; currency: string; per_unit: string } | null;
  basis: { kind: string; quantity: string | null; unit: string | null };
  premium: { amount: string; kind: string; currency: string; per_unit: string | null; grounds: string } | null;
  computed: Calc;
  provenance: { source: string; note: string | null; document_id: string | null; agreed_on: string | null };
  recorded_at: string; author: string;
}
interface Pago {
  payment_number: number; amount: string; currency: string; paid_on: string;
  method_declared: string; reference_declared: string | null; corrects_payment_id: string | null;
  reason: string | null; superseded: boolean; informed_at: string; author: string;
}
interface Vista {
  delivery: { id: string; code: string; status: string; producer_code: string; product: string | null; delivery_date: string | null; quantity_declared: string | null; unit: string | null };
  current: Version | null; history: Version[];
  payments: { items: Pago[]; informed_total: string; currency: string | null; currencies_note: string | null; note: string };
  state: string; note: string; not_the_same: string;
}

const FUENTE: Record<string, string> = {
  DECLARADO_POR_LA_ORGANIZACION: 'Declarado por la organización',
  DECLARADO_POR_EL_PRODUCTOR: 'Declarado por el productor',
  ACTA_O_DOCUMENTO: 'Consta en un acta o documento',
};
const BASE: Record<string, string> = {
  CANTIDAD_DECLARADA_EN_ENTREGA: 'Cantidad declarada en la entrega',
  CANTIDAD_RECIBIDA: 'Cantidad recibida (pesaje)',
  SIN_BASE_DECLARADA: 'Sin base declarada',
};

function Dinero({ valor, moneda }: { valor: string; moneda: string | null }) {
  if (valor === 'NO_CALCULABLE') return <StatusBadge tone="neutral">No calculable</StatusBadge>;
  return <strong>{valor}{moneda ? ` ${moneda}` : ''}</strong>;
}

export default function EconomiaEntregaPage() {
  const ws = useWorkspace();
  const params = useParams<{ id: string; deliveryId: string }>();
  const orgId = ws.activeOrg?.id;
  const deliveryId = params?.deliveryId;
  const [v, setV] = useState<Vista | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [modo, setModo] = useState<'ninguno' | 'registrar' | 'corregir' | 'pago'>('ninguno');
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!orgId || !deliveryId) return;
    setError(null);
    try { setV(await api<Vista>(`/api/v1/organizations/${orgId}/deliveries/${deliveryId}/economics`)); }
    catch (err) { setError(err as ApiError); }
  }, [orgId, deliveryId]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function enviar(e: React.FormEvent<HTMLFormElement>, destino: 'registrar' | 'corregir' | 'pago') {
    e.preventDefault();
    if (!orgId || !deliveryId) return;
    const f = new FormData(e.currentTarget);
    const t = (k: string) => { const x = String(f.get(k) ?? '').trim(); return x === '' ? undefined : x; };
    setEnviando(true); setError(null); setAviso(null);
    try {
      if (destino === 'pago') {
        await api(`/api/v1/organizations/${orgId}/deliveries/${deliveryId}/payments`, {
          method: 'POST',
          body: {
            operation_id: crypto.randomUUID(), amount: t('amount'), currency: t('currency'),
            paid_on: t('paid_on'), method_declared: t('method_declared'), reference_declared: t('reference_declared'),
          },
        });
        setAviso('Pago informado. Terra Link no ha movido dinero: solo quedó registrado lo que declaraste.');
      } else {
        const cuerpo: Record<string, unknown> = {
          operation_id: crypto.randomUUID(),
          price_amount: t('price_amount'), price_currency: t('price_currency'), price_unit: t('price_unit'),
          basis_kind: t('basis_kind'),
          premium_amount: t('premium_amount'), premium_kind: t('premium_kind'),
          premium_currency: t('premium_currency'), premium_unit: t('premium_unit'), premium_grounds: t('premium_grounds'),
          source: t('source'), source_note: t('source_note'), agreed_on: t('agreed_on'),
        };
        if (destino === 'corregir') {
          cuerpo.reason = t('reason');
          cuerpo.expected_record_number = v?.current?.record_number ?? 1;
        }
        await api(`/api/v1/organizations/${orgId}/deliveries/${deliveryId}/economics${destino === 'corregir' ? '/corrections' : ''}`, { method: 'POST', body: cuerpo });
        setAviso(destino === 'corregir'
          ? 'Corrección registrada. La versión anterior se conserva en el historial.'
          : 'Dato económico registrado. Es lo declarado, no una prueba de pago.');
      }
      setModo('ninguno');
      await cargar();
    } catch (err) { setError(err as ApiError); } finally { setEnviando(false); }
  }

  if (!ws.activeOrg) {
    return <ErrorPanel error={new ApiError(404, { code: 'NOT_FOUND', message: 'El recurso no existe o no está disponible para ti.', request_id: null })} />;
  }
  const migas = [
    { label: ws.activeOrg.name, href: `/organizaciones/${orgId}` },
    { label: 'Entregas', href: `/organizaciones/${orgId}/entregas` },
    ...(v ? [{ label: v.delivery.code, href: `/organizaciones/${orgId}/entregas/${deliveryId}` }] : []),
    { label: 'Precio y pagos' },
  ];

  if (!ws.can('economics:read')) {
    return (
      <>
        <Breadcrumb items={migas} />
        <PageHeader title="Precio, prima y pagos" />
        <Alert tone="blocked" title="Tu rol no lee los datos económicos de las entregas.">
          <p>Leer una entrega <strong>no da acceso a su dinero</strong>: es un permiso aparte. No es que no haya datos.</p>
        </Alert>
      </>
    );
  }

  const puedeRegistrar = ws.can('economics:record');
  const puedeCorregir = ws.can('economics:correct');

  return (
    <>
      <Breadcrumb items={migas} />
      <PageHeader
        title="Precio, prima y pagos"
        meta={v ? <span>Entrega {v.delivery.code} · {v.delivery.producer_code} · {v.delivery.quantity_declared ?? '—'} {v.delivery.unit ?? ''}</span> : undefined}
      />

      <Alert tone="info" title="Lo acordado y lo pagado son cosas distintas.">
        <p>
          Un <strong>precio registrado no demuestra que se haya pagado</strong>, y un <strong>pago informado</strong> lo
          declara una persona: Terra Link <strong>no ejecuta transferencias</strong> ni consulta ningún banco.
          Esto tampoco es el <a href={`/organizaciones/${orgId}/presupuesto`}>presupuesto de preparación</a>,
          que es lo que cuesta cumplir EUDR.
        </p>
      </Alert>

      {aviso && <Alert tone="valid" title={aviso} />}
      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {!v && !error && <Loading label="Cargando el dato económico…" />}

      {v && (
        <>
          <section className="card" aria-labelledby="eco-actual">
            <h2 id="eco-actual">Dato económico vigente</h2>
            {!v.current ? (
              <>
                <EmptyState title="Esta entrega no tiene dato económico registrado." />
                <p className="muted">{v.note}</p>
              </>
            ) : (
              <>
                <dl className="props">
                  <dt>Precio</dt>
                  <dd>{v.current.price ? <>{v.current.price.amount} {v.current.price.currency} por {v.current.price.per_unit}</> : <span className="muted">no declarado</span>}</dd>
                  <dt>Base del precio</dt>
                  <dd>
                    {BASE[v.current.basis.kind] ?? v.current.basis.kind}
                    {v.current.basis.quantity ? <> — {v.current.basis.quantity} {v.current.basis.unit}</> : null}
                  </dd>
                  <dt>Importe</dt><dd><Dinero valor={v.current.computed.amount} moneda={v.current.computed.currency} /></dd>
                  <dt>Prima</dt>
                  <dd>
                    {v.current.premium
                      ? <>{v.current.premium.amount} {v.current.premium.currency}{v.current.premium.per_unit ? ` por ${v.current.premium.per_unit}` : ' (importe fijo)'}</>
                      : <StatusBadge tone="review">No declarada</StatusBadge>}
                  </dd>
                  {v.current.premium && <><dt>Fundamento de la prima</dt><dd>{v.current.premium.grounds}</dd></>}
                  <dt>Total acordado</dt>
                  <dd>
                    <Dinero valor={v.current.computed.total} moneda={v.current.computed.currency} />{' '}
                    {!v.current.computed.complete && <StatusBadge tone="review">Incompleto</StatusBadge>}
                  </dd>
                  <dt>Procedencia</dt>
                  <dd>
                    {FUENTE[v.current.provenance.source] ?? v.current.provenance.source}
                    {v.current.provenance.note ? <> — {v.current.provenance.note}</> : null}
                    {v.current.provenance.agreed_on ? <> · corresponde al {v.current.provenance.agreed_on}</> : null}
                  </dd>
                  <dt>Registrado por</dt><dd>{v.current.author} · versión {v.current.record_number}</dd>
                </dl>
                <p className="muted">{v.current.computed.premium_note}</p>
                <p className="muted">{v.current.computed.note}</p>
                {v.current.computed.reasons.length > 0 && (
                  <ul className="plain">
                    {v.current.computed.reasons.map((r, i) => (
                      <li key={i}><StatusBadge tone="blocked">No calculable</StatusBadge> {r}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <p className="muted">{v.not_the_same}</p>
            <div className="actions">
              {!v.current && puedeRegistrar && <button type="button" onClick={() => setModo(modo === 'registrar' ? 'ninguno' : 'registrar')}>Registrar el dato económico</button>}
              {v.current && puedeCorregir && <button type="button" onClick={() => setModo(modo === 'corregir' ? 'ninguno' : 'corregir')}>Corregir con motivo</button>}
              {puedeRegistrar && <button type="button" onClick={() => setModo(modo === 'pago' ? 'ninguno' : 'pago')}>Informar un pago</button>}
            </div>
          </section>

          {(modo === 'registrar' || modo === 'corregir') && (
            <section className="card" aria-labelledby="eco-form">
              <h2 id="eco-form">{modo === 'corregir' ? 'Corregir el dato económico' : 'Registrar el dato económico'}</h2>
              <p className="muted">
                Nada de esto se consulta fuera: lo que escribas es <strong>lo declarado</strong>. Si dejas la prima vacía,
                queda <strong>no declarada</strong> —no cero—.
              </p>
              <form onSubmit={(e) => enviar(e, modo)}>
                <label htmlFor="price_amount">Precio (importe)</label>
                <input id="price_amount" name="price_amount" inputMode="decimal" placeholder="2.50" />
                <label htmlFor="price_currency">Moneda del precio</label>
                <input id="price_currency" name="price_currency" defaultValue="USD" maxLength={3} />
                <label htmlFor="price_unit">Precio por unidad</label>
                <select id="price_unit" name="price_unit" defaultValue="KG">
                  {['KG', 'QQ', 'TON', 'LB'].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <label htmlFor="basis_kind">Base del precio</label>
                <select id="basis_kind" name="basis_kind" defaultValue="CANTIDAD_DECLARADA_EN_ENTREGA">
                  {Object.entries(BASE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <label htmlFor="premium_amount">Prima (importe, opcional)</label>
                <input id="premium_amount" name="premium_amount" inputMode="decimal" placeholder="déjalo vacío si no hay prima declarada" />
                <label htmlFor="premium_kind">Tipo de prima</label>
                <select id="premium_kind" name="premium_kind" defaultValue="">
                  <option value="">—</option>
                  <option value="POR_UNIDAD">Por unidad</option>
                  <option value="IMPORTE_FIJO">Importe fijo</option>
                </select>
                <label htmlFor="premium_currency">Moneda de la prima</label>
                <input id="premium_currency" name="premium_currency" maxLength={3} placeholder="USD" />
                <label htmlFor="premium_unit">Prima por unidad</label>
                <select id="premium_unit" name="premium_unit" defaultValue="">
                  <option value="">— (importe fijo)</option>
                  {['KG', 'QQ', 'TON', 'LB'].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <label htmlFor="premium_grounds">Fundamento de la prima</label>
                <input id="premium_grounds" name="premium_grounds" placeholder="En qué se basa: acta, contrato, acuerdo…" />
                <label htmlFor="source">Procedencia del dato</label>
                <select id="source" name="source" defaultValue="DECLARADO_POR_LA_ORGANIZACION">
                  {Object.entries(FUENTE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <label htmlFor="source_note">Nota de procedencia</label>
                <input id="source_note" name="source_note" placeholder="Quién lo dijo, dónde consta…" />
                <label htmlFor="agreed_on">Fecha a la que corresponde</label>
                <input id="agreed_on" name="agreed_on" type="date" />
                {modo === 'corregir' && (
                  <>
                    <label htmlFor="reason">Motivo de la corrección</label>
                    <input id="reason" name="reason" required minLength={5} placeholder="Por qué cambia el dato" />
                  </>
                )}
                <div className="actions">
                  <button type="submit" disabled={enviando}>{enviando ? 'Guardando…' : modo === 'corregir' ? 'Registrar la corrección' : 'Registrar'}</button>
                  <button type="button" onClick={() => setModo('ninguno')}>Cancelar</button>
                </div>
              </form>
            </section>
          )}

          {modo === 'pago' && (
            <section className="card" aria-labelledby="eco-pago">
              <h2 id="eco-pago">Informar un pago</h2>
              <Alert tone="review" title="Esto no mueve dinero.">
                <p>Queda registrado que <strong>alguien informa</strong> un pago. No se verifica con ningún banco.</p>
              </Alert>
              <form onSubmit={(e) => enviar(e, 'pago')}>
                <label htmlFor="amount">Importe pagado</label>
                <input id="amount" name="amount" inputMode="decimal" required />
                <label htmlFor="currency">Moneda</label>
                <input id="currency" name="currency" defaultValue="USD" maxLength={3} required />
                <label htmlFor="paid_on">Fecha declarada del pago</label>
                <input id="paid_on" name="paid_on" type="date" required />
                <label htmlFor="method_declared">Medio declarado</label>
                <input id="method_declared" name="method_declared" required placeholder="Transferencia, efectivo…" />
                <label htmlFor="reference_declared">Referencia declarada</label>
                <input id="reference_declared" name="reference_declared" placeholder="Número de comprobante, opcional" />
                <div className="actions">
                  <button type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Informar el pago'}</button>
                  <button type="button" onClick={() => setModo('ninguno')}>Cancelar</button>
                </div>
              </form>
            </section>
          )}

          <section className="card" aria-labelledby="eco-pagos">
            <h2 id="eco-pagos">Pagos informados</h2>
            {v.payments.items.length === 0 ? <EmptyState title="Ningún pago informado." /> : (
              <div className="table-wrap"><table aria-label="Pagos informados">
                <thead><tr>
                  <th scope="col">#</th><th scope="col">Importe</th><th scope="col">Fecha declarada</th>
                  <th scope="col">Medio</th><th scope="col">Referencia</th><th scope="col">Estado</th><th scope="col">Informado por</th>
                </tr></thead>
                <tbody>{v.payments.items.map((p) => (
                  <tr key={p.payment_number}>
                    <td>{p.payment_number}</td>
                    <td>{p.amount} {p.currency}</td>
                    <td>{p.paid_on}</td>
                    <td>{p.method_declared}</td>
                    <td>{p.reference_declared ?? <span className="muted">sin referencia</span>}</td>
                    <td>{p.superseded
                      ? <StatusBadge tone="neutral">Corregido</StatusBadge>
                      : <StatusBadge tone="valid">Vigente</StatusBadge>}
                      {p.reason ? <div className="muted">{p.reason}</div> : null}</td>
                    <td>{p.author}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <p>
              Total informado: <Dinero valor={v.payments.informed_total} moneda={v.payments.currency} />
              {v.payments.currencies_note ? <span className="muted"> {v.payments.currencies_note}</span> : null}
            </p>
            <p className="muted">{v.payments.note}</p>
          </section>

          <section className="card" aria-labelledby="eco-hist">
            <h2 id="eco-hist">Historial del dato económico</h2>
            {v.history.length === 0 ? <EmptyState title="Todavía no hay ninguna versión." /> : (
              <div className="table-wrap"><table aria-label="Historial del dato económico">
                <thead><tr>
                  <th scope="col">Versión</th><th scope="col">Precio</th><th scope="col">Prima</th>
                  <th scope="col">Total</th><th scope="col">Motivo</th><th scope="col">Registrado</th>
                </tr></thead>
                <tbody>{v.history.map((x) => (
                  <tr key={x.record_number}>
                    <td>{x.record_number}{x.record_number === v.current?.record_number ? ' (vigente)' : ''}</td>
                    <td>{x.price ? `${x.price.amount} ${x.price.currency}/${x.price.per_unit}` : '—'}</td>
                    <td>{x.premium ? `${x.premium.amount} ${x.premium.currency}` : <span className="muted">no declarada</span>}</td>
                    <td>{x.computed.total === 'NO_CALCULABLE' ? <span className="muted">no calculable</span> : `${x.computed.total} ${x.computed.currency ?? ''}`}</td>
                    <td className="muted">{x.reason ?? <span className="muted">registro inicial</span>}</td>
                    <td className="muted">{x.recorded_at.slice(0, 19).replace('T', ' ')} · {x.author}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <p className="muted">Nada se edita ni se borra: corregir añade una versión y la anterior se conserva.</p>
          </section>
        </>
      )}
    </>
  );
}
