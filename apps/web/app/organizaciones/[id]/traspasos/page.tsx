'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useI18n } from '../../../../lib/i18n';
import { useWorkspace } from '../../../../lib/workspace';
import { ESTADO_TRASPASO, ESTADO_VINCULO, LADOS, type EstadoTraspaso, type FilaTraspaso, type OpcionesTraspaso, type Vinculo } from '../../../../lib/traspasos';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// A-03 — Traspaso de CUSTODIA FÍSICA entre organizaciones (RF-50). La pantalla solo muestra lo que la API ofrece a esta organización y NO amplía
// permisos: el servidor decide siempre. Un traspaso mueve custodia física; no es una compraventa, no es una exportación ni una declaración DDS, y la
// receptora no hereda el expediente, la severidad ni la conclusión de la emisora (el origen de su lote queda incompleto). La salida real depende de una
// compuerta de diligencia debida que hoy está cerrada: la pantalla lo dice, no lo oculta.
const FILTROS: Array<'TODOS' | EstadoTraspaso> = ['TODOS', 'OFFERED', 'ACCEPTED', 'IN_TRANSIT', 'WITH_DISCREPANCY', 'CLOSED', 'REJECTED', 'CANCELLED'];

export default function TraspasosPage() {
  const ws = useWorkspace();
  const { t, dt } = useI18n();
  const orgId = ws.activeOrg?.id ?? '';
  const base = `/api/v1/organizations/${orgId}`;
  const [filas, setFilas] = useState<FilaTraspaso[] | null>(null);
  const [vinculos, setVinculos] = useState<Vinculo[] | null>(null);
  const [opciones, setOpciones] = useState<OpcionesTraspaso | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [filtro, setFiltro] = useState<'TODOS' | EstadoTraspaso>('TODOS');
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!orgId) return;
    try {
      const [a, b, c] = await Promise.all([
        api<{ items: FilaTraspaso[] }>(`${base}/custody-transfers`), api<{ items: Vinculo[] }>(`${base}/partnerships`), api<OpcionesTraspaso>(`${base}/custody-transfers/options`),
      ]);
      setFilas(a.items); setVinculos(b.items); setOpciones(c); setError(null);
    } catch (e) { setError(e as ApiError); }
  }, [base, orgId]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!ws.activeOrg) return null;
  const crumbs = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Traspasos') }];
  if (!ws.can('transfer:read')) {
    return (
      <>
        <Breadcrumb items={crumbs} />
        <PageHeader title={t('Traspasos')} />
        <Alert tone="review" title={t('No tienes permiso para consultar traspasos.')}><p>{t('Pide a la administración de tu organización que lo haga o que te conceda el permiso.')}</p></Alert>
      </>
    );
  }
  const visibles = (filas ?? []).filter((f) => filtro === 'TODOS' || f.status === filtro);
  const cuenta = (e: EstadoTraspaso) => (filas ?? []).filter((f) => f.status === e).length;

  return (
    <>
      <Breadcrumb items={crumbs} />
      <PageHeader title={t('Traspasos')} meta={<span>{t('Custodia física de un lote entre dos organizaciones vinculadas, con reserva, tránsito, recepción y conciliación')}</span>} />
      <Alert tone="info" title={t('Qué es un traspaso y qué no')}>
        <p>{t('Un traspaso mueve la custodia física de una cantidad de un lote a otra organización. No es una compraventa, no es una exportación y no equivale a presentar una declaración DDS. La receptora no hereda el expediente, la severidad ni la conclusión de la emisora: su lote nace con origen incompleto y solo conserva una instantánea técnica del origen declarado.')}</p>
      </Alert>
      <Alert tone="review" title={t('La salida real está bloqueada')}>
        <p>{t('Falta resolver la condición de diligencia debida que habilita la salida (D-34 y la decisión D4). Puedes proponer vínculos, ofrecer, reservar y aceptar; el registro de la salida se rechaza hasta que esa compuerta se resuelva.')}</p>
      </Alert>
      {aviso && <Alert tone="valid" title={aviso} />}
      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {!error && !filas && <Loading label={t('Cargando traspasos…')} />}

      {vinculos && <Vinculos base={base} rows={vinculos} puede={ws.can('partnership:manage')} onDone={async (m) => { setAviso(m); await cargar(); }} />}
      {opciones && ws.can('transfer:offer') && <NuevoTraspaso base={base} opciones={opciones} onDone={async (m) => { setAviso(m); await cargar(); }} />}

      {filas && (
        <section className="card" aria-labelledby="tr-lista">
          <h2 id="tr-lista">{t('Traspasos de tu organización')}</h2>
          <div role="group" aria-label={t('Filtrar por estado')} className="actions">
            {FILTROS.map((f) => (
              <button key={f} type="button" className={filtro === f ? '' : 'secondary'} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
                {f === 'TODOS' ? `${t('Todos')} (${filas.length})` : `${t(ESTADO_TRASPASO[f].label)} (${cuenta(f)})`}
              </button>
            ))}
          </div>
          {visibles.length === 0 ? (
            <EmptyState title={filas.length === 0 ? t('Todavía no hay traspasos.') : t('No hay traspasos con este estado.')} />
          ) : (
            <div className="table-wrap">
              <table aria-label={t('Traspasos')}>
                <thead><tr><th scope="col">{t('Código')}</th><th scope="col">{t('Tu lado')}</th><th scope="col">{t('Contraparte')}</th><th scope="col">{t('Cantidad')}</th><th scope="col">{t('Tu lote')}</th><th scope="col">{t('Estado')}</th><th scope="col">{t('Actualizado')}</th></tr></thead>
                <tbody>
                  {visibles.map((f) => (
                    <tr key={f.id}>
                      <td><Link href={`/organizaciones/${orgId}/traspasos/${f.id}`}>{f.code}</Link>{f.is_return && <div className="muted">{t('Devolución vinculada')}</div>}</td>
                      <td>{t(LADOS[f.side])}</td>
                      <td>{f.counterpart_name}</td>
                      <td>{f.quantity} kg</td>
                      <td>{f.lot_code ?? <span className="muted">{t('Aún sin recibir')}</span>}</td>
                      <td><StatusBadge tone={ESTADO_TRASPASO[f.status].tone}>{t(ESTADO_TRASPASO[f.status].label)}</StatusBadge></td>
                      <td className="muted">{dt(f.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function Vinculos({ base, rows, puede, onDone }: { base: string; rows: Vinculo[]; puede: boolean; onDone: (mensaje: string) => Promise<void> }) {
  const { t, dt } = useI18n();
  const [codigo, setCodigo] = useState<string | null>(null);
  const [recibido, setRecibido] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const opInvitar = useRef<string | null>(null);
  const opConfirmar = useRef<string | null>(null);

  async function proponer() {
    opInvitar.current ??= crypto.randomUUID();
    setBusy(true); setError(null);
    try {
      const r = await api<{ code: string | null }>(`${base}/partnerships`, { method: 'POST', body: { operation_id: opInvitar.current } });
      opInvitar.current = null; setCodigo(r.code); await onDone(t('Vínculo propuesto. Entrega el código a la otra organización: se muestra una sola vez.'));
    } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  }
  async function confirmar(e: FormEvent) {
    e.preventDefault();
    opConfirmar.current ??= crypto.randomUUID();
    setBusy(true); setError(null);
    try {
      await api(`${base}/partnerships/confirm`, { method: 'POST', body: { operation_id: opConfirmar.current, code: recibido.trim() } });
      opConfirmar.current = null; setRecibido(''); await onDone(t('Vínculo confirmado: ya pueden traspasarse custodia entre sí.'));
    } catch (err) {
      const x = err as ApiError;
      if (!(x.status === 0 || x.status >= 500)) opConfirmar.current = null;
      setError(x);
    } finally { setBusy(false); }
  }

  return (
    <section className="card" aria-labelledby="tr-vinculos">
      <h2 id="tr-vinculos">{t('Vínculos con otras organizaciones')}</h2>
      <p className="field-help">{t('Un vínculo permite traspasar custodia entre dos organizaciones. Lo propone una y lo confirma la otra con un código de un solo uso; no concede acceso a los datos ni al inventario de la contraparte.')}</p>
      {rows.length === 0 ? <EmptyState title={t('Todavía no tienes vínculos.')} /> : (
        <div className="table-wrap">
          <table aria-label={t('Vínculos')}>
            <thead><tr><th scope="col">{t('Contraparte')}</th><th scope="col">{t('Estado')}</th><th scope="col">{t('Detalle')}</th><th scope="col"><span className="visually-hidden">{t('Acciones')}</span></th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>{v.counterpart_name ?? <span className="muted">{t('Aún sin confirmar')}</span>}</td>
                  <td><StatusBadge tone={ESTADO_VINCULO[v.status].tone}>{t(ESTADO_VINCULO[v.status].label)}</StatusBadge></td>
                  <td className="muted">
                    {v.status === 'PENDING' && <>{v.you_proposed ? t('Propuesto por ti') : t('Propuesto por la otra organización')}. {t('Caduca el {fecha}', { fecha: dt(v.expires_at) })}</>}
                    {v.status === 'ACTIVE' && v.confirmed_at && t('Confirmado el {fecha}', { fecha: dt(v.confirmed_at) })}
                    {v.status === 'REVOKED' && <>{t('Revocado el {fecha}', { fecha: dt(v.revoked_at ?? v.created_at) })}. {t('Motivo')}: {v.revoke_reason}</>}
                  </td>
                  <td>{puede && v.status !== 'REVOKED' && <Revocar base={base} v={v} onDone={onDone} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {puede && (
        <div className="stack">
          <div className="actions"><button type="button" className="secondary" onClick={proponer} disabled={busy} aria-busy={busy}>{busy ? t('Generando…') : t('Proponer un vínculo nuevo')}</button></div>
          {codigo && (
            <Alert tone="review" title={t('Código de un solo uso')}>
              <p><strong aria-label={t('Código del vínculo')}>{codigo}</strong></p>
              <p>{t('Entrégalo a la otra organización por un canal que ya uses con ella. Caduca en 7 días y no se vuelve a mostrar.')}</p>
            </Alert>
          )}
          <form onSubmit={confirmar} className="stack" aria-label={t('Confirmar un vínculo propuesto por otra organización')}>
            <label htmlFor="tr-codigo">{t('Código recibido de la otra organización')}</label>
            <input id="tr-codigo" autoComplete="off" value={recibido} onChange={(e) => setRecibido(e.target.value)} minLength={8} maxLength={32} />
            <div className="actions"><button type="submit" disabled={busy || recibido.trim().length < 8}>{t('Confirmar vínculo')}</button></div>
          </form>
          {error && <ErrorPanel error={error} />}
        </div>
      )}
    </section>
  );
}

function Revocar({ base, v, onDone }: { base: string; v: Vinculo; onDone: (mensaje: string) => Promise<void> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const op = useRef<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    op.current ??= crypto.randomUUID();
    setBusy(true); setError(null);
    try { await api(`${base}/partnerships/${v.id}/revoke`, { method: 'POST', body: { operation_id: op.current, reason: motivo.trim() } }); op.current = null; await onDone(t('Vínculo revocado.')); }
    catch (err) { const x = err as ApiError; if (!(x.status === 0 || x.status >= 500)) op.current = null; setError(x); } finally { setBusy(false); }
  }
  if (!open) return <button type="button" className="secondary inline" onClick={() => setOpen(true)}>{t('Revocar')}</button>;
  return (
    <form onSubmit={submit} className="stack" aria-label={t('Revocar el vínculo')}>
      <p className="muted">{t('No se puede revocar mientras haya traspasos sin cerrar con esta organización.')}</p>
      <label htmlFor={`rv-${v.id}`}>{t('Motivo de la revocación')}</label>
      <input id={`rv-${v.id}`} required minLength={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      {error && <ErrorPanel error={error} />}
      <div className="actions">
        <button type="submit" disabled={busy || motivo.trim().length < 3} aria-busy={busy}>{busy ? t('Revocando…') : t('Confirmar revocación')}</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)} disabled={busy}>{t('Cancelar')}</button>
      </div>
    </form>
  );
}

function NuevoTraspaso({ base, opciones, onDone }: { base: string; opciones: OpcionesTraspaso; onDone: (mensaje: string) => Promise<void> }) {
  const { t } = useI18n();
  const [vinculo, setVinculo] = useState('');
  const [origen, setOrigen] = useState(''); // «loteId|centroId»
  const [devuelve, setDevuelve] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [nota, setNota] = useState('');
  const [revision, setRevision] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const op = useRef<string | null>(null);

  const [loteId, centroId] = origen.split('|');
  const fila = opciones.stock.find((s) => s.lot_id === loteId && s.location_id === centroId);
  const devolucion = opciones.returnable.find((r) => r.id === devuelve);
  const socio = opciones.partners.find((p) => p.partnership_id === vinculo);
  const numero = /^\d{1,14}(\.\d{1,6})?$/.test(cantidad.trim()) && Number(cantidad) > 0;
  const cabe = !!fila && numero && Number(cantidad) <= Number(fila.available);
  const completo = !!socio && !!fila && cabe;
  const cambia = () => { setRevision(false); setError(null); op.current = null; };

  async function ofrecer() {
    op.current ??= crypto.randomUUID();
    setBusy(true); setError(null);
    try {
      await api(`${base}/custody-transfers`, { method: 'POST', body: {
        operation_id: op.current, partnership_id: vinculo, lot_id: loteId, location_id: centroId, quantity: cantidad.trim(), ...(nota.trim() ? { note: nota.trim() } : {}), ...(devuelve ? { returns_transfer_id: devuelve } : {}),
      } });
      op.current = null; setRevision(false); setCantidad(''); setNota(''); setOrigen(''); setDevuelve('');
      await onDone(t('Traspaso ofrecido y cantidad reservada en tu inventario. La otra organización debe aceptarlo.'));
    } catch (e) {
      const err = e as ApiError;
      if (!(err.status === 0 || err.status >= 500)) op.current = null; // un rechazo exige revisar; un corte se reintenta con la misma operación
      setError(err); setRevision(false);
    } finally { setBusy(false); }
  }

  return (
    <section className="card" aria-labelledby="tr-nuevo">
      <h2 id="tr-nuevo">{t('Nuevo traspaso')}</h2>
      {opciones.partners.length === 0 ? <p className="muted" role="status">{t('Necesitas un vínculo activo con otra organización para ofrecer un traspaso.')}</p> : (
        <form onSubmit={(e) => { e.preventDefault(); if (completo) setRevision(true); }} className="stack" aria-label={t('Nuevo traspaso')}>
          <label htmlFor="tr-socio">{t('Organización receptora')}</label>
          <select id="tr-socio" value={vinculo} onChange={(e) => { setVinculo(e.target.value); cambia(); }}>
            <option value="">{t('Elige una organización…')}</option>
            {opciones.partners.map((p) => <option key={p.partnership_id} value={p.partnership_id}>{p.name}</option>)}
          </select>
          <label htmlFor="tr-origen">{t('Lote y centro de salida')}</label>
          <select id="tr-origen" value={origen} onChange={(e) => { setOrigen(e.target.value); cambia(); }}>
            <option value="">{t('Elige un lote con existencia disponible…')}</option>
            {opciones.stock.map((s) => <option key={`${s.lot_id}|${s.location_id}`} value={`${s.lot_id}|${s.location_id}`}>{s.lot_code} · {s.product_name} · {s.location_code} — {t('disponible')} {s.available} kg</option>)}
          </select>
          {opciones.stock.length === 0 && <p className="muted" role="status">{t('No hay lotes con existencia disponible para ofrecer.')}</p>}
          {opciones.returnable.length > 0 && (
            <>
              <label htmlFor="tr-devuelve">{t('Devolución vinculada (opcional)')}</label>
              <select id="tr-devuelve" value={devuelve} onChange={(e) => { setDevuelve(e.target.value); cambia(); }}>
                <option value="">{t('No es una devolución')}</option>
                {opciones.returnable.map((r) => <option key={r.id} value={r.id}>{r.transfer_code} · {r.partner} — {t('se puede devolver')} {r.returnable} kg</option>)}
              </select>
              <p className="field-help">{t('Lo ya recibido se devuelve con otro traspaso vinculado al original; el original no se reabre. Elige el lote recibido como lote de salida.')}</p>
            </>
          )}
          <label htmlFor="tr-cantidad">{t('Cantidad (kg)')}</label>
          <input id="tr-cantidad" inputMode="decimal" value={cantidad} onChange={(e) => { setCantidad(e.target.value); cambia(); }} aria-describedby="tr-cantidad-ayuda" />
          <p id="tr-cantidad-ayuda" className="field-help">{fila ? t('Disponible en ese centro: {n} kg. Ofrecer reserva la cantidad; no la descuenta del inventario.', { n: fila.available }) : t('Elige primero el lote y el centro.')}</p>
          {numero && fila && !cabe && <p className="muted" role="status">{t('La cantidad supera lo disponible en ese centro.')}</p>}
          <label htmlFor="tr-nota">{t('Nota para la otra organización (opcional)')}</label>
          <input id="tr-nota" maxLength={1000} value={nota} onChange={(e) => { setNota(e.target.value); cambia(); }} />
          {error && <ErrorPanel error={error} />}
          <div className="actions"><button type="submit" disabled={!completo}>{t('Revisar antes de ofrecer')}</button></div>
        </form>
      )}

      {revision && fila && socio && (
        <section className="card capture-review" aria-labelledby="tr-rev">
          <h3 id="tr-rev">{t('Revisa antes de ofrecer (todavía no se reservó nada)')}</h3>
          <dl className="props">
            <dt>{t('Organización receptora')}</dt><dd>{socio.name}</dd>
            <dt>{t('Lote')}</dt><dd>{fila.lot_code} · {fila.product_name}</dd>
            <dt>{t('Centro de salida')}</dt><dd>{fila.location_code}</dd>
            <dt>{t('Cantidad')}</dt><dd>{cantidad.trim()} kg</dd>
            {devolucion && <><dt>{t('Devolución de')}</dt><dd>{devolucion.transfer_code}</dd></>}
            {nota.trim() && <><dt>{t('Nota')}</dt><dd>{nota.trim()}</dd></>}
          </dl>
          <Alert tone="review" title={t('Qué pasa al ofrecer')}>
            <p>{t('Se reserva la cantidad en tu inventario (sigue siendo tuya hasta la salida) y la otra organización recibe una instantánea técnica del origen declarado de tu lote. No hereda tu expediente, severidad ni conclusión, y la salida real sigue bloqueada por la compuerta de diligencia debida.')}</p>
          </Alert>
          <div className="actions">
            <button type="button" onClick={ofrecer} disabled={busy} aria-busy={busy}>{busy ? t('Ofreciendo…') : t('Confirmar y ofrecer')}</button>
            <button type="button" className="secondary" onClick={() => setRevision(false)} disabled={busy}>{t('Seguir editando')}</button>
          </div>
        </section>
      )}
    </section>
  );
}
