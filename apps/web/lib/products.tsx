'use client';

// Tipos del catálogo de productos (UI-09). Estados y unidades vienen de la API
// (`/product-catalog/options`); no se duplican enumeraciones en el frontend.

export interface CatalogOption { code: string; label: string }
export interface UnitOption extends CatalogOption { symbol: string; dimension: string }
export interface ProductOptions {
  states: CatalogOption[];
  units: UnitOption[];
  conversions: unknown[];
  conversions_note: string;
  immutable_fields: string[];
  transformation_note: string;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  scientific_name: string | null;
  variety: string | null;
  product_state: CatalogOption;
  unit: UnitOption;
  status: 'ACTIVE' | 'INACTIVE';
  status_reason: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  can_manage?: boolean;
}

export const DIMENSION_LABEL: Record<string, string> = { MASS: 'masa' };
export const unitText = (u: UnitOption) => `${u.label} (${u.symbol}, ${DIMENSION_LABEL[u.dimension] ?? u.dimension})`;
