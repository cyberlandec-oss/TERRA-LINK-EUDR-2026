import { CLEAR_TOKEN, type TemplateField } from './producer-template';

// P0-026 — Plantilla de importación de productos (S1 §62 «products.xlsx»). Campos = los de la entidad producto existente
// (P0-011, migración 0014); estado/presentación y unidad = códigos EXACTOS de los catálogos de sistema (product_states,
// measurement_units). Sin conversiones de unidad (D-32). El estado ACTIVO/INACTIVO no se importa: activar o desactivar
// es un caso de uso con motivo.

export const PRODUCT_TEMPLATE_VERSION = 'PRODUCTOS_V1';
export const PRODUCT_TEMPLATE_SHEET = 'productos';

export type ProductImportField = 'code' | 'name' | 'product_state' | 'unit' | 'scientific_name' | 'variety';

export const PRODUCT_FIELDS: Array<TemplateField<ProductImportField>> = [
  { field: 'code', header: 'codigo_producto', label: 'Código de producto', required: true, identity: false, maxLength: 40, pattern: /^[A-Z0-9][A-Z0-9_-]{1,39}$/,
    rule: 'Obligatorio. Clave de la importación: único en tu organización. 2–40 caracteres: MAYÚSCULAS, números, guion o guion bajo. No cambia después del alta.' },
  { field: 'name', header: 'nombre', label: 'Nombre', requiredOnCreate: true, identity: false, maxLength: 120, rule: 'Obligatorio para un producto nuevo. Hasta 120 caracteres. Editable; no se puede vaciar.' },
  { field: 'product_state', header: 'estado_presentacion', label: 'Estado o presentación', requiredOnCreate: true, immutable: true, catalog: 'product_states', identity: false, maxLength: 40,
    rule: 'Obligatorio para un producto nuevo. Código exacto del catálogo (p. ej. CACAO_SECO). No cambia después del alta.' },
  { field: 'unit', header: 'unidad', label: 'Unidad', requiredOnCreate: true, immutable: true, catalog: 'measurement_units', identity: false, maxLength: 16,
    rule: 'Obligatoria para un producto nuevo. Código exacto del catálogo (KG). Sin conversiones. No cambia después del alta.' },
  { field: 'scientific_name', header: 'nombre_cientifico', label: 'Nombre científico', clearable: true, identity: false, maxLength: 120, rule: `Opcional. Hasta 120 caracteres. ${CLEAR_TOKEN} lo vacía.` },
  { field: 'variety', header: 'variedad', label: 'Variedad', clearable: true, identity: false, maxLength: 120, rule: `Opcional. Hasta 120 caracteres. ${CLEAR_TOKEN} lo vacía.` },
];

export const PRODUCT_TEMPLATE_RULES = [
  'Una fila por producto. La primera fila son los encabezados; asocia las columnas a los campos en el paso de mapeo.',
  'Solo se importan las columnas asociadas. Las no asociadas se ignoran y esos campos no cambian.',
  `Celda vacía = sin dato: no borra. ${CLEAR_TOKEN} vacía solo los campos opcionales editables (nombre científico y variedad).`,
  'Código, estado/presentación y unidad no cambian después del alta: una reimportación con otro valor es un error de esa fila.',
  'Estado/presentación y unidad deben ser códigos exactos de los catálogos de Terra Link. No se convierten unidades.',
  'Los productos nuevos quedan activos, como en el alta manual. Un producto desactivado no se reactiva ni se edita por importación.',
  'Importar y gestionar productos exige el permiso de administración de productos; el permiso general de importación no basta.',
  'Confirmación atómica: se guarda todo el lote o nada. Un lote con filas con error no se puede confirmar.',
];
