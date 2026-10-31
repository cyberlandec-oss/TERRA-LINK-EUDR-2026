// P0-016: tipos y etiquetas de lotes y procesos. Las cantidades son saldo de procesamiento, no inventario.
import type { GateItem } from './deliveries';

export interface Qty { value: string; unit: string }
export interface LotQuantities { base: string; reserved: string; consumed: string; dispatched?: string; available: string; physical: string; unit?: string; note?: string; by_location: Array<{ location_id: string | null; location: string | null; pending_location: boolean; physical: string; reserved: string; available: string }> }
export interface LotQuality { status: string; label: string; note: string }
export interface LotRow { id: string; lot_code: string; source: string; status: string; origin_status: string; product_name: string; product_code: string; quantities: LotQuantities; quality: LotQuality }
export interface Lot {
  id: string; lot_code: string; source: 'RECEPTIONS' | 'PROCESS_OUTPUT'; status: 'OPEN' | 'CLOSED_FOR_INPUT'; row_version: number; product: { id: string; code: string; name: string };
  /** RF-47: referencia pública opaca del lote. RF-33 la muestra, la copia y emite su QR. */
  public_reference?: string | null;
  origin: { status: 'COMPLETE' | 'INCOMPLETE'; label: string; note: string | null }; quality: LotQuality; quantities: LotQuantities & { unit: string; note: string };
  inputs: Array<{ id: string; reception_id: string; delivery_id?: string; delivery_code: string; producer_code: string; received_at: string; weighing_id: string; reception_version: number; quantity: Qty; origin_known: boolean; released: { reason: string; at: string } | null }>;
  produced_by: { run_id: string; run_code: string; process_type: string; quantity: Qty } | null;
  used_by: Array<{ run_id: string; run_code: string; process_type: string; status: string; effect: 'RESERVED' | 'CONSUMED' | 'RELEASED'; quantity: Qty }>;
  upstream: { lots: Array<{ lot_id: string; lot_code: string; depth: number; contributed: Qty | null }>; receptions: Array<{ lot_id: string; delivery_id?: string; delivery_code: string; producer_code: string; producer_id?: string | null; producer_name: string | null; plots: string[]; plot_links?: Array<{ id: string; code: string }>; plots_restricted?: boolean; origin_known: boolean | null; quantity: Qty }>; note: string };
  downstream: Array<{ lot_id: string; lot_code: string; depth: number; via_run: string; contributed: Qty }>;
  shipments?: Array<{ shipment_id: string; shipment_code: string; status: string; destination_country: string; buyer_code: string; quantity: Qty; effect: 'RESERVED' | 'DISPATCHED' | 'NONE' }> | null;
  history: Array<{ event_type: string; version: number; occurred_at: string; actor: string }>;
  actions: { assign: boolean; release_input: boolean; close_for_input: boolean };
}
export interface RunGate { transition: string; release?: string; allowed: boolean; blocking: GateItem[]; pending: GateItem[]; not_evaluated: Array<{ code: string | null; name: string | null; note: string }> }
export interface Run {
  id: string; run_code: string; process_type: 'FERMENTATION' | 'DRYING'; status: 'DRAFT' | 'RUNNING' | 'CLOSED' | 'CANCELLED'; row_version: number; output_product: { id: string; code: string; name: string };
  started_at: string | null; closed_at: string | null; notes: string | null; cancel_reason: string | null;
  inputs: Array<{ lot_id: string; lot_code: string; product: string; origin_status: string; quantity: Qty; effect: string }>;
  outputs: Array<{ lot_id: string; lot_code: string; quantity: Qty }>;
  balance: { input: string; output: string; loss: string; unit: string; mass_yield_percent: string | null; note: string } | null;
  gates: RunGate[]; close_preview: RunGate | null; drying_note: string | null;
  // Humedad del secado (D-32): medición con unidad, método y responsable. `display` es presentación (un decimal);
  // `value` conserva lo que se midió.
  moisture: { value: string; unit: string; display: string; method: string | null; measured_by: string | null; note: string } | null;
  actions: { start: boolean; close: boolean; cancel: boolean };
}
export interface LotOptions {
  receptions: Array<{ id: string; delivery_code: string; producer_code: string; product_id: string; product_name: string; received_at: string; current: string; assigned: string; available: string; origin_known: boolean; quality: string }>;
  lots: Array<{ id: string; lot_code: string; origin_status: string; product_id: string; product_name: string; available: string }>;
  products: Array<{ id: string; code: string; name: string }>;
}
export const RUN_TYPE: Record<string, string> = { FERMENTATION: 'Fermentación', DRYING: 'Secado' };
export const RUN_STATUS: Record<string, { label: string; tone: 'neutral' | 'valid' | 'review' | 'blocked' | 'process' }> = {
  DRAFT: { label: 'En preparación', tone: 'neutral' }, RUNNING: { label: 'En curso (entradas reservadas)', tone: 'process' }, CLOSED: { label: 'Cerrado', tone: 'valid' }, CANCELLED: { label: 'Cancelado', tone: 'blocked' },
};
export const EFFECT: Record<string, string> = { RESERVED: 'reservado', CONSUMED: 'consumido', RELEASED: 'liberado', NONE: '—' };
export const kg = (v: string | null | undefined) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('es-EC', { maximumFractionDigits: 6 })} kg`);
