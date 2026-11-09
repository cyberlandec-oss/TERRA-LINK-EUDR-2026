'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';
import {
  AVAILABILITY, CLOSURE_TONE, ErrorDetails, GatePanel, MOMENT, PARAM, QUALITY_TONE, RECEPTION_TONE, REVIEW, STATUS_LABEL, SUPPORT_KIND, nowLocal, periodLabel, qty, todayLocal, withZone,
  type Delivery, type DeliveryOptions, type Reception,
} from '../../../../../lib/deliveries';

type Reload = (d?: Delivery) => void;

// Detalle de la entrega (UX_UI §14): declaración, pendientes, soportes, recepciones físicas con pesaje y calidad separada.
export default function DeliveryDetailPage() {
  const ws = useWorkspace();
  const { deliveryId } = useParams<{ deliveryId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const canRead = ws.can('delivery:read') || ws.can('delivery:read_assigned');
  const [d, setD] = useState<Delivery | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    if (!orgId || !canRead) return;
    try { setD(await api<Delivery>(`/api/v1/organizations/${orgId}/deliveries/${deliveryId}`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, canRead, deliveryId]);
  useEffect(() => { void load(); }, [load]);
  const reload: Reload = (next) => { if (next) setD(next); else void load(); };

  if (!ws.activeOrg) return null;
  if (!canRead) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar entregas.', request_id: null })} />;
  const crumbs = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Entregas', href: `/organizaciones/${orgId}/entregas` }];
  if (error) return <><Breadcrumb items={[...crumbs, { label: 'Entrega' }]} /><ErrorPanel error={error} onRetry={load} /></>;
  if (!d) return <Loading label="Cargando entrega…" />;
  const base = `/api/v1/organizations/${orgId}/deliveries/${d.id}`;
  return (
    <>
      <Breadcrumb items={[...crumbs, { label: d.delivery_code }]} />
      <PageHeader title={`Entrega ${d.delivery_code}`} meta={<>
        <StatusBadge tone={STATUS_LABEL[d.status].tone}>{STATUS_LABEL[d.status].label}</StatusBadge>{' '}
        {d.status !== 'DRAFT' && <StatusBadge tone={RECEPTION_TONE[d.totals.reception_status]}>{d.totals.reception_status_label}</StatusBadge>}{' '}
        {d.totals.closure.status !== 'OPEN' && <StatusBadge tone={CLOSURE_TONE[d.totals.closure.status]}>{d.totals.closure.label}</StatusBadge>}
      </>} />
      <Alert tone="info">{d.disclaimer}</Alert>

      {/* P1-012: el dinero vive detrás de SU permiso. Sin él, ni el enlace aparece ni la entrega lo publica. */}
      {ws.can('economics:read') && (
        <p>
          <a href={`/organizaciones/${ws.activeOrg?.id}/entregas/${d.id}/economia`}>Precio, prima y pagos informados</a>{' '}
          <span className="muted">— lo acordado con el productor. Un precio registrado no demuestra un pago.</span>
        </p>
      )}

      <section className="card" aria-labelledby="dl-decl">
        <h2 id="dl-decl">Declaración</h2>
        <dl className="props">
          <dt>Productor</dt><dd>{d.producer.code}{d.producer.name ? ` · ${d.producer.name}` : <span className="muted"> (identidad no visible para tu rol)</span>}</dd>
          <dt>Origen</dt><dd>{d.origin_status === 'RESTRICTED' ? <span className="muted">parcelas restringidas para tu rol</span> : d.origin_status === 'MISSING' ? <StatusBadge tone="review">Origen faltante (pendiente)</StatusBadge> : d.origins.map((o) => `${o.plot_code}${o.quantity ? ` (${qty(o.quantity)})` : ''}`).join(', ')}</dd>
          <dt>Producto</dt><dd>{d.product ? `${d.product.name} (${d.product.code})` : <span className="muted">pendiente</span>}</dd>
          <dt>Cantidad declarada</dt><dd>{qty(d.quantity_declared)}</dd>
          <dt>Fecha de entrega</dt><dd>{d.delivery_date ?? <span className="muted">pendiente</span>}</dd>
          <dt>Centro de acopio</dt><dd>{d.location ? `${d.location.name} (${d.location.code})` : <span className="muted">sin indicar</span>}</dd>
          <dt>Periodo de cosecha</dt><dd>{periodLabel(d.harvest_period)}{d.harvest_period?.derived && <div className="field-help">{d.harvest_period.derived.note} ({d.harvest_period.derived.start} a {d.harvest_period.derived.end})</div>}</dd>
          {d.notes && <><dt>Observaciones</dt><dd>{d.notes}</dd></>}
        </dl>
        {d.original_declaration && (
          <div className="alert review" role="note"><p className="alert-title">Declaración corregida; el original se conserva</p>
            <p>Original: {d.original_declaration.quantity_declared ? `${d.original_declaration.quantity_declared} kg` : '—'} · {d.original_declaration.delivery_date ?? '—'} · {periodLabel(d.original_declaration.harvest_period)}</p>
            <ol>{d.corrections.map((c) => <li key={c.number}>Corrección {c.number} ({c.changed_fields.join(', ')}): {c.reason} — {c.by}, {new Date(c.at).toLocaleString('es-EC')}</li>)}</ol>
          </div>
        )}
        {d.actions.edit && <DraftForm d={d} base={base} onDone={reload} />}
      </section>

      <section className="card" aria-labelledby="dl-gates">
        <h2 id="dl-gates">Pendientes y comprobaciones</h2>
        {d.gates.register && <GatePanel title="Para registrar la entrega" gate={d.gates.register} />}
        {d.gates.registration && <GatePanel title="Comprobación guardada al registrar" gate={{ allowed: d.gates.registration.allowed, ...d.gates.registration.result }} />}
        {d.gates.reception_preview && <GatePanel title="Para confirmar una recepción física" gate={d.gates.reception_preview} hint="Medición válida con unidad, centro y receptor de tu sesión; los pendientes de evidencia no la impiden." />}
        <GatePanel title="Completitud de trazabilidad y documentación" gate={d.gates.completeness} hint="Completo aquí no significa expediente, producto liberado ni conformidad." />
        <GatePanel title="Operaciones posteriores (lotes, procesamiento, inventario)" gate={d.gates.downstream} />
        <p className="muted">{d.inventory_effect.note}</p>
      </section>

      <Supports d={d} base={base} orgId={orgId} onDone={reload} />

      <section className="card" aria-labelledby="dl-rec">
        <h2 id="dl-rec">Recepciones físicas</h2>
        <dl className="props">
          <dt>Declarado</dt><dd>{qty(d.totals.declared)}</dd>
          <dt>Recibido (suma)</dt><dd>{qty(d.totals.received)}</dd>
          <dt>Cierre</dt><dd>{d.totals.closure.label} <span className="muted">· ver «Cierre de la entrega»</span></dd>
        </dl>
        {d.receptions.length === 0 && <p className="muted">Sin recepciones registradas.</p>}
        {d.receptions.map((r, i) => <ReceptionCard key={r.id} n={i + 1} r={r} d={d} base={base} onDone={reload} />)}
        {d.actions.receive && <NewReception d={d} base={base} orgId={orgId} onDone={reload} />}
      </section>

      <ClosureSection d={d} base={base} onDone={reload} />

      {d.actions.correct_delivery && <CorrectDelivery d={d} base={base} onDone={reload} />}

      <section className="card" aria-labelledby="dl-hist">
        <h2 id="dl-hist">Historia (eventos)</h2>
        {d.history.length === 0 ? <p className="muted">Sin eventos: un borrador no emite hechos de dominio.</p> : (
          <ol className="plain" aria-label="Historia de la entrega">
            {d.history.map((h) => <li key={h.event_id}><strong>{h.event_type}</strong> <span className="muted">· {h.actor} · {new Date(h.occurred_at).toLocaleString('es-EC')}{h.correction_of ? ` · corrige un evento anterior: ${h.correction_of.reason}` : ''}</span></li>)}
          </ol>
        )}
      </section>
    </>
  );
}

function useSubmit(onDone: Reload) {
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [op, setOp] = useState(() => crypto.randomUUID());
  // El identificador de operación se conserva hasta que el envío termina bien: reintentar no duplica.
  async function run(fn: (operationId: string) => Promise<Delivery | { delivery: Delivery }>) {
    setError(null); setBusy(true);
    try { const r = await fn(op); setOp(crypto.randomUUID()); onDone('delivery' in r ? r.delivery : r); return true; } catch (err) { setError(err as ApiError); return false; } finally { setBusy(false); }
  }
  return { error, busy, run, feedback: error ? <><ErrorPanel error={error} /><ErrorDetails details={error.body.details} /></> : null as ReactNode };
}

function DraftForm({ d, base, onDone }: { d: Delivery; base: string; onDone: Reload }) {
  const s = useSubmit(onDone);
  const [f, setF] = useState({ quantity: d.quantity_declared?.value ?? '', delivery_date: d.delivery_date ?? '', notes: d.notes ?? '' });
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); void s.run(() => api<Delivery>(base, { method: 'PATCH', body: { expected_version: d.row_version, ...(f.quantity ? { quantity_declared: f.quantity.replace(',', '.'), unit: 'KG' } : {}), ...(f.delivery_date ? { delivery_date: f.delivery_date } : {}), notes: f.notes } })); }}>
      <h3>Completar borrador</h3>
      <div className="grid-2">
        <div><label htmlFor="df-qty">Cantidad declarada (kg)</label><input id="df-qty" inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></div>
        <div><label htmlFor="df-date">Fecha de entrega</label><input id="df-date" type="date" value={f.delivery_date} onChange={(e) => setF({ ...f, delivery_date: e.target.value })} /></div>
      </div>
      <label htmlFor="df-notes">Observaciones</label><textarea id="df-notes" maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      {s.feedback}
      <div className="actions">
        <button type="submit" className="secondary" disabled={s.busy}>Guardar borrador</button>
        <button type="button" disabled={s.busy || !d.actions.register} onClick={() => void s.run(() => api<{ delivery: Delivery }>(`${base}/register`, { method: 'POST', body: { expected_version: d.row_version } }))}>Registrar entrega</button>
      </div>
    </form>
  );
}

function Supports({ d, base, orgId, onDone }: { d: Delivery; base: string; orgId: string; onDone: Reload }) {
  const s = useSubmit(onDone);
  const [candidates, setCandidates] = useState<Array<{ document_id: string; title: string; version_id: string; version_number: number; availability: string }>>([]);
  const [f, setF] = useState({ version: '', kind: 'DELIVERY_NOTE' });
  useEffect(() => {
    if (!d.actions.link_support) return;
    api<typeof candidates>(`${base}/support-candidates`).then(setCandidates).catch(() => setCandidates([]));
  }, [base, d.actions.link_support, d.supports.length]);
  return (
    <section className="card" aria-labelledby="dl-sup">
      <h2 id="dl-sup">Soportes documentales</h2>
      <p className="muted">Base propuesta: nota de entrega o recibo firmado; también guía de remisión, liquidación u otros. Vincular un soporte no aprueba su contenido ni afirma validez jurídica.</p>
      {!d.supports_visible && <p>{d.support_status === 'REGISTERED' ? 'Hay soportes registrados (detalle restringido para tu rol).' : <StatusBadge tone="review">Evidencia documental pendiente</StatusBadge>}</p>}
      {d.supports_visible && d.supports.length === 0 && <p><StatusBadge tone="review">Evidencia documental pendiente</StatusBadge> <span className="muted">La recepción física puede registrarse; este pendiente se conserva.</span></p>}
      {d.supports.length > 0 && (
        <ul className="plain" aria-label="Soportes de la entrega">
          {d.supports.map((x) => (
            <li key={x.id}>
              <strong>{SUPPORT_KIND[x.kind] ?? x.kind}</strong>: {x.title} · versión {x.version_number}{x.newer_version_exists ? ' (hay una versión más reciente)' : ''}
              <div className="muted">{AVAILABILITY[x.availability] ?? x.availability} · revisión documental: {REVIEW[x.review] ?? x.review} · {x.validity === 'EXPIRED' ? `vencido (${x.expires_at})` : x.validity === 'VALID_UNTIL' ? `vigente hasta ${x.expires_at}` : 'sin vencimiento'}</div>
              {x.withdrawn ? <div className="muted">Retirado: {x.withdrawn.reason}</div> : d.actions.link_support && <WithdrawSupport base={base} id={x.id} onDone={onDone} />}
            </li>
          ))}
        </ul>
      )}
      {d.actions.link_support && (
        <form className="form" onSubmit={(e) => { e.preventDefault(); void s.run((op) => api<{ delivery: Delivery }>(`${base}/supports`, { method: 'POST', body: { operation_id: op, document_version_id: f.version, support_kind: f.kind } })); }}>
          <div className="grid-2">
            <div><label htmlFor="sp-doc">Documento (versión)</label>
              <select id="sp-doc" required value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })}>
                <option value="">Selecciona…</option>{candidates.map((c) => <option key={c.version_id} value={c.version_id}>{c.title} · v{c.version_number} · {AVAILABILITY[c.availability] ?? c.availability}</option>)}
              </select>
              {candidates.length === 0 && <p className="field-help">No hay documentos «soporte de entrega» del productor o sus parcelas. Aporta uno al productor desde <a href={`/organizaciones/${orgId}/productores/${d.producer.id}`}>su ficha (sección «Documentos y soportes»)</a> o en <a href={`/organizaciones/${orgId}/documentos`}>Documentos</a> y vuelve aquí a vincularlo.</p>}
            </div>
            <div><label htmlFor="sp-kind">Tipo de soporte</label>
              <select id="sp-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(SUPPORT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          </div>
          {s.feedback}
          <div className="actions"><button type="submit" disabled={s.busy}>Vincular soporte</button></div>
        </form>
      )}
    </section>
  );
}

function WithdrawSupport({ base, id, onDone }: { base: string; id: string; onDone: Reload }) {
  const s = useSubmit(onDone);
  const [reason, setReason] = useState('');
  return (
    <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void s.run(() => api<Delivery>(`${base}/supports/${id}/withdraw`, { method: 'POST', body: { reason } })); }}>
      <label htmlFor={`wd-${id}`} className="visually-hidden">Motivo para retirar</label>
      <input id={`wd-${id}`} placeholder="Motivo para retirar" minLength={3} required value={reason} onChange={(e) => setReason(e.target.value)} />
      <button type="submit" className="secondary inline" disabled={s.busy}>Retirar</button>
      {s.feedback}
    </form>
  );
}

function ReceptionCard({ n, r, d, base, onDone }: { n: number; r: Reception; d: Delivery; base: string; onDone: Reload }) {
  return (
    <article className="subcard" aria-label={`Recepción ${n}`}>
      <h3>Recepción {n}: {qty(r.quantity_received)} <StatusBadge tone={QUALITY_TONE[r.quality.status]}>{r.quality.status_label}</StatusBadge></h3>
      <dl className="props">
        <dt>Momento</dt><dd>{new Date(r.received_at).toLocaleString('es-EC')}</dd>
        <dt>Centro</dt><dd>{r.location.name} ({r.location.code})</dd>
        <dt>Receptor</dt><dd>{r.receiver}</dd>
        <dt>Pesajes</dt><dd><ol className="plain">{r.weighings.map((w) => <li key={w.id}>{qty(w.quantity)} · {w.method} · {w.weighed_on} · {w.responsible}{w.corrects_weighing_id ? ' · corrige el pesaje anterior' : ''}</li>)}</ol></dd>
        {r.adjustments.length > 0 && <><dt>Correcciones</dt><dd><ol className="plain">{r.adjustments.map((a) => <li key={a.number}>{a.previous_quantity} → {a.new_quantity} kg: {a.reason} ({a.by})</li>)}</ol><span className="muted">Original conservado: {qty(r.original_quantity)}</span></dd></>}
        {r.confirmation_gate && r.confirmation_gate.pending.length > 0 && <><dt>Pendientes al confirmar</dt><dd>{r.confirmation_gate.pending.map((p) => p.name).join(', ')}</dd></>}
      </dl>
      <div className="quality">
        <h4>Calidad <span className="muted">(separada de la recepción física)</span></h4>
        {r.quality.samples.length === 0 && <p className="muted">Sin muestras: pendiente de evaluación.</p>}
        {r.quality.samples.map((s) => (
          <div key={s.id}>
            <p>Muestra {s.sample_reference ?? '(sin referencia)'} · tomada {MOMENT[s.moment]} · {s.sampled_by}</p>
            {s.results.length === 0 && <p className="muted">Sin resultados: pendiente de evaluación.</p>}
            <ul className="plain">{s.results.map((q) => (
              <li key={q.id}>{q.decision === 'PENDING' ? 'Resultado sin decisión' : q.decision === 'RELEASED' ? `Liberada por decisión humana · referencia de límites declarada «${q.limits_reference?.value}» (no verificada)` : `Rechazada: ${q.decision_reason}`} · {q.method}
                {q.measurements.length > 0 && ` · ${q.measurements.map((m) => `${PARAM[m.parameter] ?? m.parameter} ${m.value} ${m.unit}`).join(', ')}`} · {q.recorded_by}</li>
            ))}</ul>
            {(d.actions.record_quality || d.actions.decide_quality) && <QualityResultForm base={`${base}/receptions/${r.id}/quality-samples/${s.id}/results`} canDecide={d.actions.decide_quality} onDone={onDone} id={s.id} />}
          </div>
        ))}
        <p className="field-help">{r.quality.note}</p>
        <p className="muted">Operaciones posteriores: no habilitadas ni evaluadas. {r.downstream_enablement.note}</p>
        {d.actions.record_quality && <AddSample base={`${base}/receptions/${r.id}/quality-samples`} onDone={onDone} id={r.id} />}
      </div>
      {d.actions.correct_reception && <CorrectReception base={`${base}/receptions/${r.id}/corrections`} version={r.version} onDone={onDone} id={r.id} />}
    </article>
  );
}

function AddSample({ base, id, onDone }: { base: string; id: string; onDone: Reload }) {
  const s = useSubmit(onDone);
  const [ref, setRef] = useState('');
  return (
    <form className="inline-form" onSubmit={(e) => { e.preventDefault(); void s.run((op) => api<{ delivery: Delivery }>(base, { method: 'POST', body: { operation_id: op, ...(ref.trim() ? { sample_reference: ref.trim() } : {}) } })); }}>
      <label htmlFor={`as-${id}`}>Referencia de muestra (después del pesaje)</label>
      <input id={`as-${id}`} maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} />
      <button type="submit" className="secondary inline" disabled={s.busy}>Registrar muestra</button>
      {s.feedback}
    </form>
  );
}

function QualityResultForm({ base, canDecide, id, onDone }: { base: string; canDecide: boolean; id: string; onDone: Reload }) {
  const s = useSubmit(onDone);
  const [f, setF] = useState({ method: '', moisture: '', unit: '%', decision: 'PENDING', limits: '', reason: '' });
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); void s.run((op) => api<{ delivery: Delivery }>(base, { method: 'POST', body: {
      operation_id: op, method: f.method, decision: f.decision, ...(f.moisture ? { measurements: [{ parameter: 'MOISTURE', value: f.moisture.replace(',', '.'), unit: f.unit }] } : {}),
      ...(f.decision === 'RELEASED' ? { limits_version: f.limits } : {}), ...(f.decision === 'REJECTED' ? { decision_reason: f.reason } : {}),
    } })); }}>
      <h5>Registrar resultado</h5>
      <div className="grid-3">
        <div><label htmlFor={`qm-${id}`}>Método</label><input id={`qm-${id}`} required maxLength={120} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} /></div>
        <div><label htmlFor={`qh-${id}`}>Humedad <span className="muted">(opcional)</span></label><input id={`qh-${id}`} inputMode="decimal" value={f.moisture} onChange={(e) => setF({ ...f, moisture: e.target.value })} /></div>
        <div><label htmlFor={`qu-${id}`}>Unidad de la humedad</label><input id={`qu-${id}`} maxLength={20} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
      </div>
      <label htmlFor={`qd-${id}`}>Decisión</label>
      <select id={`qd-${id}`} value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })}>
        <option value="PENDING">Sin decisión (pendiente de evaluación)</option>
        {canDecide && <option value="RELEASED">Liberar calidad</option>}
        {canDecide && <option value="REJECTED">Rechazar calidad</option>}
      </select>
      {f.decision === 'RELEASED' && <><label htmlFor={`ql-${id}`}>Referencia de límites declarada</label><input id={`ql-${id}`} required maxLength={80} value={f.limits} onChange={(e) => setF({ ...f, limits: e.target.value })} /><p className="field-help">No hay catálogo publicado de límites: se registra como referencia declarada, no verificada por el sistema; un valor medido no implica «aprobado» y la decisión no habilita operaciones posteriores.</p></>}
      {f.decision === 'REJECTED' && <><label htmlFor={`qr-${id}`}>Motivo del rechazo</label><input id={`qr-${id}`} required minLength={3} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></>}
      {s.feedback}
      <div className="actions"><button type="submit" className="secondary" disabled={s.busy}>Guardar resultado</button></div>
    </form>
  );
}

/**
 * Cierre de la entrega (D-33, regla provisional del MVP local desde el 2026-10-15).
 * Muestra las cifras vigentes, la diferencia con su signo y TODAS las justificaciones: ninguna sustituye a otra.
 * Cerrar con diferencia está permitido; lo que no se admite es dejarla sin explicar.
 */
function ClosureSection({ d, base, onDone }: { d: Delivery; base: string; onDone: Reload }) {
  const c = d.totals.closure;
  const diferencia = Number(c.current.difference.value);
  return (
    <section className="card" aria-labelledby="dl-close">
      <h2 id="dl-close">Cierre de la entrega</h2>
      <p><StatusBadge tone={CLOSURE_TONE[c.status]}>{c.label}</StatusBadge></p>
      <p className="muted">{c.note}</p>
      <dl className="props">
        <dt>Declarado</dt><dd>{qty(c.current.declared)}</dd>
        <dt>Recibido (vigente)</dt><dd>{qty(c.current.received)}</dd>
        <dt>Diferencia</dt><dd>{qty(c.current.difference)} {diferencia === 0 ? <span className="muted">· sin diferencia</span> : diferencia > 0 ? <span className="muted">· faltó respecto de lo declarado</span> : <span className="muted">· llegó más de lo declarado</span>}</dd>
      </dl>
      {c.justifications.length > 0 && (
        <ol className="plain" aria-label="Justificaciones del cierre">
          {c.justifications.map((j) => (
            <li key={j.number}><strong>{j.kind === 'CLOSE' ? 'Cierre' : `Justificación ${j.number}`}</strong>: diferencia {qty(j.difference)} de {qty(j.declared)} declarados y {qty(j.received)} recibidos
              {' · '}{j.reason ?? <span className="muted">sin diferencia que explicar</span>}
              <span className="muted"> · {j.by}, {new Date(j.at).toLocaleString('es-EC')}</span></li>
          ))}
        </ol>
      )}
      {d.actions.close && <CloseForm d={d} base={base} diferencia={diferencia} onDone={onDone} />}
      {c.stale && d.actions.justify_closure && <JustifyForm base={base} diferencia={diferencia} onDone={onDone} />}
      {c.stale && !d.actions.justify_closure && <p className="muted">Actualizar la justificación requiere `delivery:correct`; tu rol no lo tiene.</p>}
    </section>
  );
}

function CloseForm({ d, base, diferencia, onDone }: { d: Delivery; base: string; diferencia: number; onDone: Reload }) {
  const s = useSubmit(onDone);
  const [reason, setReason] = useState('');
  return (
    <details>
      <summary>Cerrar la entrega</summary>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void s.run((op) => api<{ delivery: Delivery }>(`${base}/close`, { method: 'POST', body: { operation_id: op, expected_version: d.row_version, ...(reason.trim() ? { reason: reason.trim() } : {}) } })); }}>
        <p className="field-help">Cerrar impide recepciones nuevas y no se deshace. {diferencia === 0 ? 'No hay diferencia que explicar.' : 'Hay diferencia: el motivo es obligatorio y cerrarla requiere el permiso de corrección.'}</p>
        {diferencia !== 0 && <div><label htmlFor="cl-reason">Motivo de la diferencia</label><input id="cl-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="field-help">Merma de transporte, humedad, pesaje en otro punto… Se conserva tal cual, con tu nombre y la cifra de este momento.</div></div>}
        {s.feedback}
        <div className="actions"><button type="submit" disabled={s.busy}>Cerrar entrega</button></div>
      </form>
    </details>
  );
}

function JustifyForm({ base, diferencia, onDone }: { base: string; diferencia: number; onDone: Reload }) {
  const s = useSubmit(onDone);
  const [reason, setReason] = useState('');
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); void s.run((op) => api<{ delivery: Delivery }>(`${base}/closure-justifications`, { method: 'POST', body: { operation_id: op, reason: reason.trim() } })); }}>
      <p className="field-help">Una corrección admitida cambió la diferencia a {diferencia}. La justificación anterior se conserva; esta se añade.</p>
      <div><label htmlFor="jc-reason">Motivo de la diferencia actual</label><input id="jc-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      {s.feedback}
      <div className="actions"><button type="submit" className="secondary" disabled={s.busy}>Añadir justificación</button></div>
    </form>
  );
}

function CorrectReception({ base, version, id, onDone }: { base: string; version: number; id: string; onDone: Reload }) {
  const s = useSubmit(onDone);
  const [f, setF] = useState({ quantity: '', method: '', reason: '' });
  return (
    <details>
      <summary>Corregir el peso de esta recepción</summary>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void s.run((op) => api<{ delivery: Delivery }>(base, { method: 'POST', body: { operation_id: op, expected_version: version, reason: f.reason, weighing: { method: f.method, quantity: f.quantity.replace(',', '.'), unit: 'KG', weighed_on: todayLocal() } } })); }}>
        <p className="field-help">Se registra un pesaje nuevo enlazado; el pesaje y la cantidad originales se conservan.</p>
        <div className="grid-3">
          <div><label htmlFor={`cq-${id}`}>Nuevo peso (kg)</label><input id={`cq-${id}`} required inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></div>
          <div><label htmlFor={`cm-${id}`}>Método del nuevo pesaje</label><input id={`cm-${id}`} required maxLength={120} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} /></div>
          <div><label htmlFor={`cr-${id}`}>Motivo de la corrección</label><input id={`cr-${id}`} required minLength={3} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        </div>
        {s.feedback}
        <div className="actions"><button type="submit" className="secondary" disabled={s.busy}>Registrar corrección</button></div>
      </form>
    </details>
  );
}

function NewReception({ d, base, orgId, onDone }: { d: Delivery; base: string; orgId: string; onDone: Reload }) {
  const s = useSubmit(onDone);
  const [opts, setOpts] = useState<DeliveryOptions | null>(null);
  const [f, setF] = useState({ location_id: d.location?.id ?? '', received_at: nowLocal(), method: '', quantity: '', weighed_on: todayLocal(), notes: '', sample: false, ref: '', qmethod: '', moisture: '', unit: '%' });
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => { api<DeliveryOptions>(`/api/v1/organizations/${orgId}/delivery-options`).then(setOpts).catch(() => setOpts(null)); }, [orgId]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!reviewing) { setReviewing(true); return; }
    const ok = await s.run((op) => api<{ delivery: Delivery }>(`${base}/receptions`, { method: 'POST', body: {
      operation_id: op, location_id: f.location_id, received_at: withZone(f.received_at), notes: f.notes || undefined,
      weighing: { method: f.method, quantity: f.quantity.replace(',', '.'), unit: 'KG', weighed_on: f.weighed_on },
      ...(f.sample ? { quality_sample: { ...(f.ref.trim() ? { sample_reference: f.ref.trim() } : {}), ...(f.qmethod.trim() ? { result: { method: f.qmethod.trim(), ...(f.moisture ? { measurements: [{ parameter: 'MOISTURE', value: f.moisture.replace(',', '.'), unit: f.unit }] } : {}) } } : {}) } } : {}),
    } }));
    if (ok) { setReviewing(false); setF((x) => ({ ...x, quantity: '', method: x.method, notes: '', sample: false, ref: '', moisture: '' })); }
  }
  const center = opts?.locations.find((l) => l.id === f.location_id);
  return (
    <form className="form subcard" onSubmit={confirm} aria-labelledby="nr-title">
      <h3 id="nr-title">Nueva recepción física</h3>
      <div className="grid-2">
        <div><label htmlFor="nr-center">Centro de recepción</label>
          <select id="nr-center" required value={f.location_id} onChange={set('location_id')}><option value="">Selecciona…</option>{opts?.locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}</select></div>
        <div><label htmlFor="nr-at">Momento de recepción</label><input id="nr-at" type="datetime-local" required value={f.received_at} onChange={set('received_at')} /></div>
        <div><label htmlFor="nr-qty">Peso recibido (kg)</label><input id="nr-qty" required inputMode="decimal" value={f.quantity} onChange={set('quantity')} /></div>
        <div><label htmlFor="nr-method">Método de pesaje</label><input id="nr-method" required maxLength={120} value={f.method} onChange={set('method')} placeholder="p. ej. báscula de plataforma" /></div>
        <div><label htmlFor="nr-day">Fecha de pesaje</label><input id="nr-day" type="date" required value={f.weighed_on} onChange={set('weighed_on')} /></div>
      </div>
      <label htmlFor="nr-notes">Observaciones <span className="muted">(opcional)</span></label><textarea id="nr-notes" maxLength={500} value={f.notes} onChange={set('notes')} />
      {d.actions.record_quality && (
        <fieldset><legend>Muestra de calidad durante la recepción <span className="muted">(opcional)</span></legend>
          <label className="checkbox-row"><input type="checkbox" checked={f.sample} onChange={(e) => setF({ ...f, sample: e.target.checked })} /> Tomar muestra ahora</label>
          {f.sample && <div className="grid-2">
            <div><label htmlFor="nr-ref">Referencia de la muestra</label><input id="nr-ref" maxLength={80} value={f.ref} onChange={set('ref')} /></div>
            <div><label htmlFor="nr-qm">Método de análisis <span className="muted">(si ya se midió)</span></label><input id="nr-qm" maxLength={120} value={f.qmethod} onChange={set('qmethod')} /></div>
            <div><label htmlFor="nr-moist">Humedad</label><input id="nr-moist" inputMode="decimal" value={f.moisture} onChange={set('moisture')} disabled={!f.qmethod} /></div>
            <div><label htmlFor="nr-unit">Unidad de la humedad</label><input id="nr-unit" maxLength={20} value={f.unit} onChange={set('unit')} disabled={!f.qmethod} /></div>
          </div>}
          <p className="field-help">La decisión de calidad (liberar o rechazar) se registra aparte; sin ella la recepción queda «Pendiente de evaluación».</p>
        </fieldset>
      )}
      {reviewing && (
        <div className="alert info" role="status" aria-live="polite"><p className="alert-title">Revisa antes de confirmar</p>
          <p>{d.delivery_code} · {d.producer.code} · origen: {d.origin_status === 'RESTRICTED' ? 'restringido para tu rol' : d.origin_status === 'MISSING' ? 'faltante' : d.origins.map((o) => o.plot_code).join(', ')} · {d.product?.name ?? 'producto pendiente'}</p>
          <p>Declarado {qty(d.totals.declared)} · recibido hasta ahora {qty(d.totals.received)} · esta recepción {f.quantity || '—'} kg en {center?.name ?? '—'}</p>
          {d.support_status === 'PENDING' && <p>Sin soporte documental: la recepción se registra y la evidencia queda pendiente.</p>}
        </div>
      )}
      {s.feedback}
      <div className="actions">
        <button type="submit" disabled={s.busy}>{reviewing ? 'Confirmar recepción' : 'Revisar recepción'}</button>
        {reviewing && <button type="button" className="secondary" onClick={() => setReviewing(false)}>Volver a editar</button>}
      </div>
    </form>
  );
}

function CorrectDelivery({ d, base, onDone }: { d: Delivery; base: string; onDone: Reload }) {
  const s = useSubmit(onDone);
  const [f, setF] = useState({ quantity: '', date: '', reason: '' });
  return (
    <section className="card form" aria-labelledby="cd-title">
      <h2 id="cd-title">Corregir la declaración</h2>
      <p className="muted">La corrección queda como registro nuevo enlazado; la declaración original se conserva. No ajustes lo declarado para que coincida con lo recibido.</p>
      <form onSubmit={(e) => { e.preventDefault(); void s.run((op) => api<{ delivery: Delivery }>(`${base}/corrections`, { method: 'POST', body: { operation_id: op, expected_version: d.row_version, reason: f.reason, fields: { ...(f.quantity ? { quantity_declared: f.quantity.replace(',', '.') } : {}), ...(f.date ? { delivery_date: f.date } : {}) } } })); }}>
        <div className="grid-3">
          <div><label htmlFor="cd-qty">Cantidad declarada corregida (kg)</label><input id="cd-qty" inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></div>
          <div><label htmlFor="cd-date">Fecha corregida</label><input id="cd-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
          <div><label htmlFor="cd-reason">Motivo</label><input id="cd-reason" required minLength={3} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        </div>
        {s.feedback}
        <div className="actions"><button type="submit" className="secondary" disabled={s.busy}>Registrar corrección</button></div>
      </form>
    </section>
  );
}
