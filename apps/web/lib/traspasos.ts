// A-03 — tipos y etiquetas del traspaso de custodia (fuera de las páginas: Next solo admite ciertos exports en `page.tsx`).
import type { Tone } from './ui';

export type EstadoTraspaso = 'OFFERED' | 'ACCEPTED' | 'IN_TRANSIT' | 'WITH_DISCREPANCY' | 'CLOSED' | 'REJECTED' | 'CANCELLED';
export const ESTADO_TRASPASO: Record<EstadoTraspaso, { label: string; tone: Tone }> = {
  OFFERED: { label: 'Ofrecido', tone: 'review' }, ACCEPTED: { label: 'Aceptado', tone: 'process' }, IN_TRANSIT: { label: 'En tránsito', tone: 'process' },
  WITH_DISCREPANCY: { label: 'Con diferencia pendiente', tone: 'review' }, CLOSED: { label: 'Cerrado', tone: 'valid' }, REJECTED: { label: 'Rechazado', tone: 'blocked' }, CANCELLED: { label: 'Cancelado', tone: 'neutral' },
};
export const ESTADO_VINCULO: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pendiente de confirmar', tone: 'review' }, ACTIVE: { label: 'Activo', tone: 'valid' }, REVOKED: { label: 'Revocado', tone: 'neutral' },
};
export const PASOS: Record<string, string> = {
  OFFER: 'Oferta y reserva', ACCEPT: 'Aceptación', REJECT_OFFER: 'Oferta rechazada', CANCEL: 'Cancelación', DISPATCH: 'Salida', RECEIPT: 'Recepción',
  OVERAGE_RECORDED: 'Sobrante declarado', REJECT_TRANSIT: 'Rechazo en tránsito (vuelve al origen)', DECLARE_SHORTAGE: 'Faltante declarado', LOSS_CONFIRMED: 'Pérdida confirmada',
  OVERAGE_CONFIRMED: 'Sobrante confirmado', OVERAGE_WITHDRAWN: 'Sobrante retirado', SHORTAGE_REOPENED: 'Faltante reabierto (vuelve a tránsito)',
};
export const DIFERENCIAS: Record<string, string> = { SHORTAGE: 'Faltante', OVERAGE: 'Sobrante' };
export const RESOLUCIONES: Record<string, string> = {
  LOSS_CONFIRMED: 'Confirmar la pérdida', SHORTAGE_REOPENED: 'Reabrir: la mercancía sigue en tránsito', OVERAGE_CONFIRMED: 'Confirmar el sobrante (entra al inventario de la receptora)', OVERAGE_WITHDRAWN: 'Retirar el sobrante (no existe)',
};
export const CIERRES: Record<string, string> = { COMPLETE: 'Cerrado: lo recibido iguala lo que salió', WITH_DIFFERENCES: 'Cerrado con diferencias registradas' };
export const LADOS: Record<string, string> = { SENDER: 'Emisora', RECEIVER: 'Receptora' };
export const COMPROBACIONES: Record<string, string> = {
  STATUS: 'Traspaso aceptado por la receptora', RESERVATION: 'Reserva completa en el centro de salida', GATE: 'Compuerta de salida del traspaso (diligencia debida, D-34/D4)',
};

export const TRASPASO_TABLAS = {
  ESTADO_TRASPASO, ESTADO_VINCULO, PASOS, DIFERENCIAS, RESOLUCIONES, CIERRES, LADOS, COMPROBACIONES,
};

export interface Vinculo {
  id: string; status: 'PENDING' | 'ACTIVE' | 'REVOKED'; you_proposed: boolean; counterpart_organization_id: string | null; counterpart_name: string | null;
  expires_at: string; confirmed_at: string | null; revoked_at: string | null; revoke_reason: string | null; revoked_by_you: boolean | null; created_at: string;
}
export interface FilaTraspaso {
  id: string; code: string; status: EstadoTraspaso; status_label: string; side: 'SENDER' | 'RECEIVER'; counterpart_name: string; quantity: string; unit: 'KG'; lot_code: string | null;
  closure: string | null; is_return: boolean; created_at: string; updated_at: string;
}
export interface OpcionesTraspaso {
  partners: Array<{ partnership_id: string; organization_id: string; name: string }>;
  stock: Array<{ lot_id: string; lot_code: string; product_name: string; location_id: string; location_code: string; available: string }>;
  products: Array<{ id: string; code: string; name: string }>;
  locations: Array<{ id: string; code: string; name: string }>;
  returnable: Array<{ id: string; transfer_code: string; partner: string; received_lot_id: string; returnable: string }>;
}
export interface Traspaso {
  id: string; code: string; status: EstadoTraspaso; status_label: string; closure: 'COMPLETE' | 'WITH_DIFFERENCES' | null; version: number; side: 'SENDER' | 'RECEIVER';
  sender: { organization_id: string; name: string }; receiver: { organization_id: string; name: string };
  quantity: string; unit: 'KG'; note: string | null; reject_reason: string | null; cancel_reason: string | null;
  your_lot_code: string | null; your_location_code: string | null; your_product_name?: string | null;
  origin_projection?: { sender_organization: string; sender_lot_code: string; product: { code: string; name: string }; origin_status: string; captured_at: string; disclaimer: string };
  origin_projection_hash?: string;
  quantities: { offered: string; in_transit: string; dispatched: string; received: string; overage_confirmed: string; returned_to_sender_in_transit: string; loss_confirmed: string; open_shortage: string; open_overage: string };
  steps: Array<{ id: string; step: string; by: 'YOU' | 'COUNTERPART'; organization_name: string; quantity: string | null; reason: string | null; at: string }>;
  discrepancies: Array<{ id: string; kind: 'SHORTAGE' | 'OVERAGE'; quantity: string; status: 'OPEN' | 'RESOLVED'; resolution: string | null; reason: string; recorded_by: 'YOU' | 'COUNTERPART'; created_at: string; resolution_reason: string | null; resolved_at: string | null }>;
  returns: Array<{ id: string; transfer_code: string; status: EstadoTraspaso; quantity: string }>;
  is_return_of: { id: string; transfer_code: string } | null;
  next_actions: string[]; boundaries: string[];
}
export interface ControlSalida { allowed: boolean; checks: Array<{ code: string; label: string; status: 'OK' | 'BLOCKED'; message: string }> }
