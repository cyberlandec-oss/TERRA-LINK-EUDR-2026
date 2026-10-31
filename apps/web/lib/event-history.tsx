'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from './api';
import { ErrorPanel, StatusBadge } from './ui';

// P0-015: historial de eventos por recurso (autorizado en el servidor; solo campos permitidos por tipo).
// Las correcciones se muestran junto al original, que nunca se oculta. La acción de corregir solo aparece
// para tipos con contrato de corrección implementado (actualización de productor) y con permiso.

interface EventItem {
  event_id: string; event_type: string; aggregate_version: number; occurred_at: string; recorded_at: string;
  actor: { kind: string; display: string }; data: Record<string, unknown>; known_type: boolean;
  correction_of: { event_id: string; event_type: string; aggregate_version: number; reason: string } | null;
  corrected_by_event_id: string | null; correctable: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  ProducerRegistered: 'Productor registrado', ProducerUpdated: 'Datos actualizados', ProducerUpdateCorrected: 'Corrección de datos',
  ProducerAssigned: 'Responsable asignado', ProducerStatusChanged: 'Cambio de estado', PlotRegistered: 'Parcela registrada',
  PlotUpdated: 'Datos actualizados', PlotStatusChanged: 'Cambio de estado', PlotGeometryVersionCreated: 'Nueva versión geométrica',
  ProductCreated: 'Producto creado', ProductUpdated: 'Producto editado', ProductDeactivated: 'Producto desactivado', ProductActivated: 'Producto activado',
};
export const FIELD_LABEL: Record<string, string> = {
  first_name: 'nombre', last_name: 'apellido', legal_name: 'razón social', community: 'comunidad', province: 'provincia', canton: 'cantón', parish: 'parroquia',
  document_type: 'tipo de documento', document_number: 'número de documento', phone: 'teléfono', address: 'dirección', status: 'estado',
};
const CORRECTABLE = ['first_name', 'last_name', 'legal_name', 'community', 'province', 'canton', 'parish'];

export function EventHistory({ orgId, kind, id, correction }: {
  orgId: string; kind: 'producers' | 'plots' | 'products'; id: string;
  /** Solo productores: valores vigentes y versión para corregir; null si el usuario no puede corregir. */
  correction?: { current: Record<string, string | null>; rowVersion: number; onCorrected: () => Promise<void> } | null;
}) {
  const [items, setItems] = useState<EventItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async (from: string | null = null) => {
    try {
      const r = await api<{ items: EventItem[]; next_cursor: string | null }>(`/api/v1/organizations/${orgId}/aggregates/${kind}/${id}/events?limit=20${from ? `&cursor=${from}` : ''}`);
      setItems((prev) => (from && prev ? [...prev, ...r.items] : r.items));
      setCursor(r.next_cursor);
      setError(null);
    } catch (e) { setError(e as ApiError); }
  }, [orgId, kind, id]);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="card" aria-labelledby={`events-${id}`}>
      <h2 id={`events-${id}`}>Historial de eventos</h2>
      <p className="muted">Registro inmutable. Una corrección se añade como un evento nuevo que referencia al original; el original se conserva.</p>
      {error && <ErrorPanel error={error} onRetry={() => load()} />}
      {!items && !error && <p className="muted">Cargando historial…</p>}
      {items && items.length === 0 && <p className="muted">Sin eventos.</p>}
      {items && items.length > 0 && (
        <ol className="plain event-list" aria-label="Eventos">
          {items.map((e) => {
            const fields = Array.isArray(e.data.changed_fields) ? (e.data.changed_fields as string[]) : [];
            const correctable = !!correction && e.correctable && !e.corrected_by_event_id && fields.some((f) => CORRECTABLE.includes(f));
            return (
              <li key={e.event_id} className={e.correction_of ? 'event correction' : 'event'}>
                <strong>v{e.aggregate_version} · {TYPE_LABEL[e.event_type] ?? e.event_type}</strong>{' '}
                {e.corrected_by_event_id && <StatusBadge tone="review">Corregido</StatusBadge>}
                <span className="muted"> · {e.actor.display} · {new Date(e.occurred_at).toLocaleString('es-EC')}</span>
                {fields.length > 0 && <div className="muted">Campos: {fields.map((f) => FIELD_LABEL[f] ?? f).join(', ')}</div>}
                {e.correction_of && <div>Corrige v{e.correction_of.aggregate_version} ({TYPE_LABEL[e.correction_of.event_type] ?? e.correction_of.event_type}) · motivo: {e.correction_of.reason}</div>}
                {!e.known_type && <div className="muted">Tipo de evento sin campos publicados.</div>}
                {correctable && editing !== e.event_id && (
                  <button type="button" className="secondary small" onClick={() => setEditing(e.event_id)} aria-label={`Corregir la versión ${e.aggregate_version}`}>Corregir</button>
                )}
                {correctable && editing === e.event_id && correction && (
                  <CorrectionForm orgId={orgId} producerId={id} eventId={e.event_id} fields={fields.filter((f) => CORRECTABLE.includes(f))} correction={correction}
                    onDone={async () => { setEditing(null); await correction.onCorrected(); await load(); }} onCancel={() => setEditing(null)} />
                )}
              </li>
            );
          })}
        </ol>
      )}
      {cursor && <button type="button" className="secondary" onClick={() => load(cursor)}>Cargar más</button>}
    </section>
  );
}

function CorrectionForm({ orgId, producerId, eventId, fields, correction, onDone, onCancel }: {
  orgId: string; producerId: string; eventId: string; fields: string[];
  correction: { current: Record<string, string | null>; rowVersion: number };
  onDone: () => Promise<void>; onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f, correction.current[f] ?? ''])));
  const [reason, setReason] = useState('');
  const [operationId] = useState(() => crypto.randomUUID()); // reintento seguro: mismo identificador
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/producers/${producerId}/events/${eventId}/corrections`, {
        method: 'POST', body: { operation_id: operationId, expected_version: correction.rowVersion, reason: reason.trim(), fields: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()])) },
      });
      await onDone();
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card form" aria-label="Corregir actualización">
      <p className="muted">Solo se pueden corregir los campos que cambió este evento. Los datos de identidad no se corrigen por esta vía.</p>
      <div className="grid-2">
        {fields.map((f) => (
          <div key={f}>
            <label htmlFor={`cor-${eventId}-${f}`}>Valor correcto de {FIELD_LABEL[f] ?? f}</label>
            <input id={`cor-${eventId}-${f}`} value={values[f]} onChange={(e) => setValues({ ...values, [f]: e.target.value })} />
          </div>
        ))}
      </div>
      <label htmlFor={`cor-${eventId}-reason`}>Motivo de la corrección</label>
      <input id={`cor-${eventId}-reason`} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <ErrorPanel error={error} />}
      <div className="actions">
        <button type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Registrando…' : 'Registrar corrección'}</button>
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
      </div>
    </form>
  );
}
