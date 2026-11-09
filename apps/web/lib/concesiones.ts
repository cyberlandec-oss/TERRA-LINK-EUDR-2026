// A-02 — tipos y etiquetas de las concesiones (fuera de la página: Next solo admite ciertos exports en `page.tsx`).
import type { Tone } from './ui';

export type Tipo = 'LOT' | 'SHIPMENT' | 'DD_SNAPSHOT';
export type Estado = 'ACTIVA' | 'VENCIDA' | 'REVOCADA';
export const TIPOS: Record<Tipo, string> = { LOT: 'Lote', SHIPMENT: 'Embarque', DD_SNAPSHOT: 'Instantánea de diligencia' };
export const ESTADOS: Record<Estado, { label: string; tone: Tone }> = {
  ACTIVA: { label: 'Activa', tone: 'valid' }, VENCIDA: { label: 'Vencida', tone: 'neutral' }, REVOCADA: { label: 'Revocada', tone: 'blocked' },
};


export const CONCESION_TABLAS = { TIPOS, ESTADOS };
