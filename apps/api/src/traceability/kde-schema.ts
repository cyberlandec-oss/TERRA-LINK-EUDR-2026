// P0-014 KDE — esquema CERRADO de tipos, validaciones y condiciones. El catálogo solo guarda datos
// declarativos de esta lista; nunca código, SQL ni expresiones evaluables. Publicar algo fuera del
// esquema falla.

export const VALUE_TYPES = ['QUANTITY', 'DECIMAL', 'INTEGER', 'TEXT', 'BOOLEAN', 'DATE', 'DATETIME', 'DATE_RANGE', 'ENUM', 'ENTITY_REF', 'ENTITY_REF_LIST', 'HARVEST_PERIOD'] as const;
export type ValueType = (typeof VALUE_TYPES)[number];
export const REQUIREMENTS = ['REQUIRED', 'CONDITIONAL', 'OPTIONAL'] as const;
export type Requirement = (typeof REQUIREMENTS)[number];

/** Entidades con verificación real en esta etapa (tenant + alcance del usuario). */
export const VERIFIABLE_ENTITIES = ['producer', 'plot', 'plot_version', 'product', 'membership', 'document', 'delivery', 'location', 'sample', 'weighable', 'lot', 'process_run', 'buyer', 'shipment', 'dd_package'] as const;
/** Entidades del contrato aún inexistentes: la referencia se acepta como «no verificable», nunca como válida. */
export const PENDING_ENTITIES: Record<string, string> = {
  counterparty: 'D-33',
};
// D-34.A (2026-10-16): `dd_package` deja de ser una entidad pendiente. La acreditación existe y es
// `dd_exports` con `kind = 'DD_PACKAGE'`. El validador comprueba **existencia, tenant y tipo**; la
// **correspondencia** con el lote, el embarque, el ítem, la reserva y la cantidad la comprueba la operación,
// porque el validador de KDE no conoce ese contexto. Una FK por organización no demuestra correspondencia.

export interface Validation {
  positive?: boolean;          // > 0 (QUANTITY/DECIMAL/INTEGER)
  non_negative?: boolean;      // >= 0
  max?: number;                // tope ESTRUCTURAL del dato (p. ej. un porcentaje no supera 100). No es un límite de aceptación de calidad.
  allowed_units?: string[];    // QUANTITY
  dimension?: string;          // QUANTITY
  max_length?: number;         // TEXT
  pattern?: 'ISO_4217';        // TEXT con formato cerrado (no expresiones libres)
  values?: string[];           // ENUM
  entity?: string;             // ENTITY_REF(_LIST)
  min_items?: number;          // ENTITY_REF_LIST
}

export type Condition =
  | { kind: 'equals'; kde: string; value: string | boolean }
  | { kind: 'present'; kde: string }
  | { kind: 'quantities_differ'; a: string; b: string }
  | { kind: 'undefined_in_contract'; note: string };

const VALIDATION_KEYS = new Set(['positive', 'non_negative', 'max', 'allowed_units', 'dimension', 'max_length', 'pattern', 'values', 'entity', 'min_items']);

/** Comprueba que una definición use solo el esquema cerrado. Devuelve la lista de problemas. */
export function schemaProblems(d: { code: string; value_type: string; requirement: string; condition: Condition | null; validation: Validation }): string[] {
  const p: string[] = [];
  if (!(VALUE_TYPES as readonly string[]).includes(d.value_type)) p.push(`${d.code}: tipo no admitido`);
  if (!(REQUIREMENTS as readonly string[]).includes(d.requirement)) p.push(`${d.code}: obligatoriedad no admitida`);
  for (const k of Object.keys(d.validation ?? {})) if (!VALIDATION_KEYS.has(k)) p.push(`${d.code}: regla «${k}» fuera del esquema`);
  if ((d.requirement === 'CONDITIONAL') !== (d.condition !== null)) p.push(`${d.code}: CONDITIONAL exige condición y solo CONDITIONAL la admite`);
  if (d.condition && !['equals', 'present', 'quantities_differ', 'undefined_in_contract'].includes(d.condition.kind)) p.push(`${d.code}: condición no admitida`);
  const v = d.validation ?? {};
  if (d.value_type === 'QUANTITY' && (!v.allowed_units?.length || !v.dimension)) p.push(`${d.code}: QUANTITY exige unidades y dimensión explícitas`);
  if ((d.value_type === 'ENTITY_REF' || d.value_type === 'ENTITY_REF_LIST') && !v.entity) p.push(`${d.code}: referencia sin entidad`);
  if (v.entity && !(VERIFIABLE_ENTITIES as readonly string[]).includes(v.entity) && !(v.entity in PENDING_ENTITIES)) p.push(`${d.code}: entidad desconocida`);
  if (d.value_type === 'ENUM' && !v.values?.length) p.push(`${d.code}: ENUM sin valores`);
  return p;
}
