// P0-026 — Plantilla de importación de productores (S1 §62 «producers.xlsx»). Campos = los de la entidad productor
// existente (P0-004); ninguno inventado. Las demás plantillas de S1 §62 (parcelas, entregas, productos, lotes) no están
// implementadas: ver docs/decisiones/P0-026-IMPORTACION-EXCEL.md.

export const PRODUCER_TEMPLATE_VERSION = 'PRODUCTORES_V1';
export const PRODUCER_TEMPLATE_SHEET = 'productores';

/** Valor de celda que pide expresamente vaciar un campo. Una celda vacía NO borra nada. */
export const CLEAR_TOKEN = '#BORRAR';

export type ImportField =
  | 'producer_code' | 'first_name' | 'last_name' | 'legal_name' | 'document_type' | 'document_number' | 'phone' | 'address'
  | 'community' | 'province' | 'canton' | 'parish';

export interface TemplateField<F extends string = string> {
  field: F;
  header: string;
  label: string;
  rule: string;
  identity: boolean;
  /** Obligatorio en toda fila (la clave). */
  required?: boolean;
  /** Obligatorio solo para dar de alta. */
  requiredOnCreate?: boolean;
  /** No cambia después del alta: un valor distinto en una reimportación es error de fila. */
  immutable?: boolean;
  /** #BORRAR permitido (campo opcional editable). */
  clearable?: boolean;
  /** Valor de un catálogo de sistema (código exacto). */
  catalog?: 'product_states' | 'measurement_units';
  maxLength: number;
  pattern?: RegExp;
  /** Mensaje de formato propio (si no, «Formato no válido.»). */
  formatMessage?: string;
}

export const PRODUCER_FIELDS: Array<TemplateField<ImportField>> = [
  { field: 'producer_code', header: 'codigo_productor', label: 'Código de productor', required: true, identity: false, maxLength: 40, pattern: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/,
    rule: 'Obligatorio. Clave de la importación: único en tu organización. 1–40 caracteres: letras, números, punto, guion o guion bajo. Si ya existe, la fila actualiza ese productor; no se cambia por importación.' },
  { field: 'first_name', clearable: true, header: 'nombres', label: 'Nombres', identity: false, maxLength: 100, rule: 'Hasta 100 caracteres. Nombre y apellido, o razón social.' },
  { field: 'last_name', clearable: true, header: 'apellidos', label: 'Apellidos', identity: false, maxLength: 100, rule: 'Hasta 100 caracteres.' },
  { field: 'legal_name', clearable: true, header: 'razon_social', label: 'Razón social', identity: false, maxLength: 200, rule: 'Hasta 200 caracteres. Alternativa a nombre y apellido.' },
  { field: 'document_type', clearable: true, header: 'tipo_documento', label: 'Tipo de documento', identity: true, maxLength: 40, rule: 'Dato de identidad. Va junto con el número de documento.' },
  { field: 'document_number', clearable: true, header: 'numero_documento', label: 'Número de documento', identity: true, maxLength: 40, rule: 'Dato de identidad. Escríbelo como texto para conservar ceros iniciales.' },
  { field: 'phone', clearable: true, header: 'telefono', label: 'Teléfono', identity: true, maxLength: 20, pattern: /^[+0-9 ()-]{6,20}$/, rule: 'Dato de identidad. 6–20 caracteres: números, espacios, +, paréntesis y guion.' },
  { field: 'address', clearable: true, header: 'direccion', label: 'Dirección', identity: true, maxLength: 300, rule: 'Dato de identidad. Hasta 300 caracteres.' },
  { field: 'community', clearable: true, header: 'comunidad', label: 'Comunidad', identity: false, maxLength: 120, rule: 'Hasta 120 caracteres.' },
  { field: 'province', clearable: true, header: 'provincia', label: 'Provincia', identity: false, maxLength: 100, rule: 'Hasta 100 caracteres.' },
  { field: 'canton', clearable: true, header: 'canton', label: 'Cantón', identity: false, maxLength: 100, rule: 'Hasta 100 caracteres.' },
  { field: 'parish', clearable: true, header: 'parroquia', label: 'Parroquia', identity: false, maxLength: 100, rule: 'Hasta 100 caracteres.' },
];

export const FIELD_BY_KEY = new Map(PRODUCER_FIELDS.map((f) => [f.field, f]));

export const TEMPLATE_RULES = [
  'Una fila por productor. La primera fila son los encabezados; puedes usar otros nombres de columna y asociarlos en el paso de mapeo.',
  'Solo se importan las columnas que asocies a un campo. Las columnas sin asociar se ignoran y los campos que no asocies no cambian.',
  `Celda vacía = sin dato: no borra el valor existente. Para vaciar un campo escribe exactamente ${CLEAR_TOKEN}.`,
  'No se evalúan fórmulas ni macros: una celda con fórmula es un error de esa fila. Guarda el libro como .xlsx con valores.',
  'Los productores nuevos se crean en estado BORRADOR (datos heredados, no validados). Activarlos es una decisión aparte.',
  'Importar no confirma recepción, calidad, inventario ni debida diligencia; no fusiona productores: una posible coincidencia de identidad abre una revisión (P0-005).',
  'Confirmación atómica: se guarda todo el lote o nada. Un lote con filas con error no se puede confirmar; corrige el archivo y vuelve a cargarlo.',
];
