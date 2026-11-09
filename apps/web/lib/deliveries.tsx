// P0-012: tipos, etiquetas y componentes de Entregas y recepción. Las etiquetas no cambian el dato.

export interface Qty { value: string; unit: string }
export interface HarvestPeriod { precision: 'DAY' | 'MONTH' | 'UNKNOWN'; start: string | null; end: string | null; derived: { start: string; end: string; note: string } | null }
export interface GateItem { code: string; name: string; result: string; error_code: string | null; message: string }
export interface Gate { transition: string; release: string; allowed: boolean; blocking: GateItem[]; pending: GateItem[]; not_evaluated: Array<{ code: string | null; name: string | null; note: string }> }
export interface StoredGate { transition: string; release_version?: string; release?: string; allowed: boolean; result?: { blocking: GateItem[]; pending: GateItem[]; not_evaluated: Gate['not_evaluated'] }; blocking?: GateItem[]; pending?: GateItem[]; not_evaluated?: Gate['not_evaluated'] }
export interface QualityResult { id: string; method: string; decision: 'PENDING' | 'RELEASED' | 'REJECTED'; limits_reference: { value: string; status: 'DECLARED_UNVERIFIED'; note: string } | null; decision_reason: string | null; recorded_at: string; recorded_by: string; measurements: Array<{ parameter: string; value: string; unit: string }> }
export interface Reception {
  id: string; received_at: string; location: { code: string; name: string }; receiver: string; quantity_received: Qty; original_quantity: Qty; version: number; notes: string | null;
  weighings: Array<{ id: string; method: string; quantity: Qty; weighed_on: string; corrects_weighing_id: string | null; responsible: string; recorded_at: string }>;
  adjustments: Array<{ number: number; previous_quantity: string; new_quantity: string; reason: string; at: string; by: string }>;
  confirmation_gate: (StoredGate & { pending: GateItem[]; not_evaluated: Gate['not_evaluated'] }) | null;
  downstream_enablement: { status: string; note: string };
  quality: { status: 'PENDING_EVALUATION' | 'RELEASED' | 'REJECTED'; status_label: string; note: string; limits_verification: string; samples: Array<{ id: string; moment: 'DURING_RECEPTION' | 'AFTER_WEIGHING'; sample_reference: string | null; sampled_at: string; sampled_by: string; results: QualityResult[] }> };
}
export interface Delivery {
  id: string; delivery_code: string; status: 'DRAFT' | 'REGISTERED' | 'CLOSED'; row_version: number;
  producer: { id: string; code: string; name: string | null; identity_visible: boolean };
  product: { id: string; code: string; name: string; status: string } | null; location: { id: string; code: string; name: string } | null;
  delivery_date: string | null; quantity_declared: Qty | null; harvest_period: HarvestPeriod | null;
  origins: Array<{ plot_id: string; plot_code: string; quantity: Qty | null }>; origins_restricted?: boolean; origin_status: 'DECLARED' | 'MISSING' | 'RESTRICTED'; notes: string | null;
  original_declaration: { delivery_date: string | null; quantity_declared: string | null; harvest_period: { precision: string; start?: string; end?: string } | null } | null;
  corrections: Array<{ number: number; reason: string; changed_fields: string[]; delivery_date: string; quantity_declared: string; harvest_period: { precision: string; start?: string; end?: string } | null; at: string; by: string }>;
  supports: Array<{ id: string; kind: string; document_id: string; document_version_id: string; title: string; version_number: number; availability: string; validity: string; expires_at: string | null; review: string; newer_version_exists: boolean; withdrawn: { reason: string; at: string } | null }>;
  supports_visible: boolean; support_status: 'REGISTERED' | 'PENDING';
  receptions: Reception[];
  totals: { declared: Qty | null; received: Qty | null; reception_status: string; reception_status_label: string; closure: Closure };
  gates: { register?: Gate; registration?: { transition: string; release_version: string; allowed: boolean; result: { blocking: GateItem[]; pending: GateItem[]; not_evaluated: Gate['not_evaluated'] } } | null; reception_preview?: Gate; completeness: Gate; downstream: Gate };
  history: Array<{ event_id: string; event_type: string; aggregate_type: string; aggregate_version: number; occurred_at: string; actor: string; data: Record<string, unknown>; correction_of: { event_id: string; reason: string } | null }>;
  inventory_effect: { status: string; note: string }; disclaimer: string;
  actions: { edit: boolean; register: boolean; link_support: boolean; receive: boolean; correct_delivery: boolean; correct_reception: boolean; record_quality: boolean; decide_quality: boolean; close: boolean; justify_closure: boolean };
}
/**
 * Cierre de la entrega (D-33). El estado se deriva en el servidor y nunca se almacena:
 * `OPEN` · `CLOSED` · `CLOSED_JUSTIFICATION_STALE` (el motivo explica una cifra que ya cambió).
 * Las justificaciones se acumulan: ninguna sustituye a la anterior.
 */
export interface Closure {
  status: 'OPEN' | 'CLOSED' | 'CLOSED_JUSTIFICATION_STALE'; label: string; note: string; stale: boolean;
  current: { declared: Qty; received: Qty; difference: Qty };
  justifications: Array<{ number: number; kind: 'CLOSE' | 'REJUSTIFY'; reason: string | null; declared: Qty; received: Qty; difference: Qty; at: string; by: string }>;
}
export interface DeliveryRow {
  id: string; delivery_code: string; status: 'DRAFT' | 'REGISTERED' | 'CLOSED'; delivery_date: string | null; producer: { id: string; code: string; name: string | null };
  product: string | null; quantity_declared: Qty | null; received: Qty | null; receptions: number; reception_status: string; reception_status_label: string; harvest_precision: string | null;
}
export interface DeliveryOptions {
  producers: Array<{ id: string; code: string; name: string | null }>; products: Array<{ id: string; code: string; name: string; unit: string }>;
  locations: Array<{ id: string; code: string; name: string; location_type: string }>; plots: Array<{ id: string; plot_code: string }>;
  units: string[]; support_kinds: string[]; quality_parameters: string[];
}

export const STATUS_LABEL: Record<string, { label: string; tone: 'neutral' | 'valid' | 'review' | 'blocked' | 'process' }> = {
  DRAFT: { label: 'Borrador', tone: 'neutral' }, REGISTERED: { label: 'Registrada', tone: 'process' }, CLOSED: { label: 'Cerrada', tone: 'valid' },
};
export const CLOSURE_TONE: Record<string, 'neutral' | 'valid' | 'review' | 'blocked' | 'process'> = {
  OPEN: 'neutral', CLOSED: 'valid', CLOSED_JUSTIFICATION_STALE: 'review',
};
export const RECEPTION_TONE: Record<string, 'neutral' | 'valid' | 'review' | 'blocked' | 'process'> = {
  NOT_RECEIVED: 'neutral', PARTIAL: 'review', RECEIVED_DECLARED: 'valid', ABOVE_DECLARED: 'review',
};
export const QUALITY_TONE: Record<string, 'neutral' | 'valid' | 'review' | 'blocked' | 'process'> = { PENDING_EVALUATION: 'review', RELEASED: 'valid', REJECTED: 'blocked' };
export const SUPPORT_KIND: Record<string, string> = {
  DELIVERY_NOTE: 'Nota de entrega o recibo firmado', REMISSION_GUIDE: 'Guía de remisión', PURCHASE_SETTLEMENT: 'Liquidación de compra', OTHER: 'Otro soporte',
};
export const AVAILABILITY: Record<string, string> = { AVAILABLE: 'Archivo disponible (análisis limpio)', PENDING: 'Análisis pendiente', SCAN_FAILED: 'Análisis incompleto o fallido', REJECTED: 'Rechazado por el escáner' };
export const REVIEW: Record<string, string> = { NOT_REVIEWED: 'sin revisar', ACCEPTED: 'aceptado en revisión', REJECTED: 'rechazado en revisión' };
export const PARAM: Record<string, string> = { MOISTURE: 'Humedad', FERMENTATION: 'Fermentación', IMPURITIES: 'Impurezas' };
export const MOMENT: Record<string, string> = { DURING_RECEPTION: 'durante la recepción', AFTER_WEIGHING: 'después del pesaje' };
export const RESULT_LABEL: Record<string, string> = {
  REQUIRED_MISSING: 'falta', REQUIRED: 'falta', DECLARED_UNKNOWN: 'declarado desconocido', PRESENT_INVALID: 'no válido', PRESENT_NOT_VERIFIABLE: 'no verificable', CONDITION_NOT_EVALUABLE: 'condición no definida', OPTIONAL_MISSING: 'opcional, sin registrar',
};
export const FIELD_LABEL: Record<string, string> = {
  DELIVERY_SUPPLIER: 'Productor', DELIVERY_PLOTS: 'Parcela(s) de origen', DELIVERY_PRODUCT: 'Producto', DELIVERY_DATE: 'Fecha de entrega', DELIVERY_DECLARED_WEIGHT: 'Peso declarado',
  DELIVERY_SUPPORT: 'Soporte documental', DELIVERY_PRODUCTION_PERIOD: 'Periodo de cosecha', RECEPTION_LOCATION: 'Centro de recepción', RECEPTION_TIME: 'Momento de recepción',
  RECEPTION_RECEIVED_WEIGHT: 'Peso recibido', WEIGHING_METHOD: 'Método de pesaje', WEIGHING_VALUE: 'Valor pesado', WEIGHING_DATE: 'Fecha de pesaje',
  CLASSIFICATION_METHOD: 'Método de análisis', CLASSIFICATION_DECISION: 'Decisión de calidad', CLASSIFICATION_LIMITS_VERSION: 'Versión de límites aplicada',
};
/** Detalle de un error de la API en español (campo y motivo), sin valores. */
/**
 * Datos a revisar de una compuerta bloqueada. Si el servidor explica el motivo, se muestra **su** mensaje: traducir
 * solo el código dejaba al usuario con «DECIMAL_PRECISION_EXCEEDED» y sin saber qué corregir.
 */
export function ErrorDetails({ details }: { details?: Array<{ field?: string; reason: string; message?: string }> }) {
  if (!details?.length) return null;
  return <ul className="error" aria-label="Datos a revisar">{details.map((d, i) => <li key={i}>{(d.field && FIELD_LABEL[d.field]) ?? d.field ?? 'Dato'}: {d.message ?? RESULT_LABEL[d.reason] ?? d.reason}</li>)}</ul>;
}
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthLabel = (ym: string) => { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} de ${y}`; };

/** Periodo con su precisión declarada; nunca muestra días si se declaró por mes. */
export function periodLabel(p: { precision: string; start?: string | null; end?: string | null } | null): string {
  if (!p) return 'Sin declarar (pendiente)';
  if (p.precision === 'UNKNOWN') return 'Desconocido (declarado; queda pendiente)';
  if (p.precision === 'MONTH') return p.start === p.end ? `Mes: ${monthLabel(p.start!)}` : `Meses: ${monthLabel(p.start!)} a ${monthLabel(p.end!)}`;
  return p.start === p.end ? `Día: ${p.start}` : `Días: ${p.start} a ${p.end}`;
}
export const qty = (q: Qty | null) => (q ? `${Number(q.value).toLocaleString('es-EC', { maximumFractionDigits: 6 })} ${q.unit === 'KG' ? 'kg' : q.unit}` : '—');

/** Resultado de una compuerta: bloqueos, pendientes y lo que no se evalúa (sin presentar pendientes como válidos). */
export function GatePanel({ title, gate, hint }: { title: string; gate: { allowed: boolean; blocking: GateItem[]; pending: GateItem[]; not_evaluated: Gate['not_evaluated'] }; hint?: string }) {
  return (
    <div className="gate">
      <h3>{title}</h3>
      {gate.blocking.length > 0 && (
        <div className="alert blocked" role="status"><p className="alert-title">Bloqueado: faltan datos obligatorios o no son válidos</p>
          <ul>{gate.blocking.map((b) => <li key={b.code}>{b.name}: {RESULT_LABEL[b.result] ?? b.result}</li>)}</ul></div>
      )}
      {gate.pending.length > 0 && (
        <div className="alert review" role="status"><p className="alert-title">Pendientes (no impiden esta operación; siguen sin resolver)</p>
          <ul>{gate.pending.map((b) => <li key={b.code}>{b.name}: {RESULT_LABEL[b.result] ?? b.result}</li>)}</ul></div>
      )}
      {gate.blocking.length === 0 && gate.pending.length === 0 && <p className="muted">Sin bloqueos ni pendientes en esta comprobación.</p>}
      {gate.not_evaluated.length > 0 && (
        <ul className="plain muted" aria-label={`${title}: no evaluado`}>{gate.not_evaluated.map((n, i) => <li key={i}>No evaluado{n.name ? ` (${n.name})` : ''}: {n.note}</li>)}</ul>
      )}
      {hint && <p className="field-help">{hint}</p>}
    </div>
  );
}

/** Zona horaria del navegador en formato ±hh:mm (no se asume UTC). */
export function withZone(local: string): string {
  const off = -new Date(local).getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${local.length === 16 ? `${local}:00` : local}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
export const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export const todayLocal = () => nowLocal().slice(0, 10);
