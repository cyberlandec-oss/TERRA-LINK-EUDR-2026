import type { Tone } from './ui';

// P0-029 Embarques (UX_UI §14 EXPORT_MANAGER: seleccionar lote → reservar → revisar → despachar).
// Comprador y destino son DECLARADOS por la organización; despachar no presenta ninguna DDS.

type Qty = { value: string | null; unit: string };
export interface Buyer { id: string; code: string; name: string; country: string; status?: string; verification?: string }
export interface ShipmentRow {
  id: string; shipment_code: string; status: 'DRAFT' | 'DISPATCHED' | 'CANCELLED'; status_label: string; destination_country: string; destination_place: string | null;
  buyer_code: string; buyer_name: string; location_code: string; items: number; quantity: Qty; dispatch_at: string | null; created_at: string;
}
export interface Shipment {
  id: string; shipment_code: string; status: 'DRAFT' | 'DISPATCHED' | 'CANCELLED'; status_label: string; row_version: number;
  buyer: Buyer & { verification: 'DECLARED' }; destination: { country: string; place: string | null; verification: 'DECLARED' };
  origin_location: { id: string; code: string; name: string }; notes: string | null; created_at: string; created_by: string;
  dispatch_at: string | null; dispatched_by: string | null; cancel_reason: string | null;
  items: Array<{ id: string; lot_id: string; lot_code: string; product: string; origin_status: string; quantity: Qty;
    reservation: { id: string; status: 'ACTIVE' | 'CONSUMED'; quantity: Qty } | null;
    history: Array<{ id: string; status: string; quantity: Qty; reason: string | null; at: string; ended_at: string | null }> }>;
  totals: { quantity: Qty };
  actions: { manage: boolean; reserve: boolean; dispatch: boolean };
  submission: { status: 'NOT_SUBMITTED'; note: string };
}
export interface Preflight {
  allowed: boolean;
  checks: Array<{ code: string; label: string; status: 'OK' | 'BLOCKED'; subject: string | null; message: string }>;
  gate: { transition: string; release: string; allowed: boolean; blocking: Array<{ code: string; name: string; result: string; message: string }> };
  note: string;
}
export interface ShipmentOptions {
  buyers: Buyer[]; locations: Array<{ id: string; code: string; name: string }>;
  lots: Array<{ lot_id: string; lot_code: string; origin_status: string; product: string; location_id: string; available: string; unit: string }>;
}

export const SHIPMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'En preparación', tone: 'process' }, DISPATCHED: { label: 'Despachado', tone: 'valid' }, CANCELLED: { label: 'Cancelado', tone: 'neutral' },
};
export const SHIPMENT_EFFECT: Record<string, string> = { RESERVED: 'reservado', DISPATCHED: 'despachado', NONE: 'sin reserva' };
