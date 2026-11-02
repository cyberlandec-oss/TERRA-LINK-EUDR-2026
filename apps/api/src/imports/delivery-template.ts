import { CLEAR_TOKEN, type TemplateField } from './producer-template';

// P0-026 — Plantilla de importación de entregas (S1 §62 «deliveries.xlsx»). Campos = los del BORRADOR de entrega existente
// (P0-012, migración 0021; DeliveryFieldsDto). Solo crea y actualiza BORRADORES con los casos de uso existentes: no
// registra la entrega ni la recibe, pesa, analiza, ingresa a inventario ni la cierra. Los soportes documentales no se
// importan: se vinculan desde la entrega, por versión exacta del documento. Decisiones de diseño D-33/D-34/D-35 intactas.

export const DELIVERY_TEMPLATE_VERSION = 'ENTREGAS_V1';
export const DELIVERY_TEMPLATE_SHEET = 'entregas';

export type DeliveryImportField = 'delivery_code' | 'import_reference' | 'producer_code' | 'product_code' | 'location_code' | 'delivery_date' | 'quantity_declared' | 'unit'
  | 'harvest_precision' | 'harvest_start' | 'harvest_end' | 'origins' | 'notes';

const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
export const DELIVERY_FIELDS: Array<TemplateField<DeliveryImportField>> = [
  { field: 'delivery_code', header: 'codigo_entrega', label: 'Código de entrega', identity: false, maxLength: 40, pattern: /^[A-Z0-9][A-Z0-9_-]{1,39}$/,
    rule: 'Opcional. Código ASIGNADO por Terra Link (p. ej. ENT-2026-00012) de un borrador existente para actualizarlo. Vacío = entrega nueva (el sistema asigna el código). No se inventan códigos.' },
  { field: 'import_reference', header: 'referencia_importacion', label: 'Referencia de importación', identity: false, maxLength: 80, pattern: /^[A-Za-z0-9][A-Za-z0-9_.\/-]{0,79}$/,
    formatMessage: 'Referencia no válida: 1–80 caracteres (letras, números, punto, guion, barra o guion bajo).',
    rule: 'Obligatoria en filas sin código de entrega. Identifica la fila entre importaciones (p. ej. el número de tu planilla); no es un dato de la entrega. La misma referencia vuelve a la misma entrega; referencias distintas son entregas distintas aunque tengan datos idénticos.' },
  { field: 'producer_code', header: 'codigo_productor', label: 'Código de productor', requiredOnCreate: true, identity: false, maxLength: 40, pattern: CODE,
    rule: 'Obligatorio para una entrega nueva: código EXACTO de un productor ACTIVO en tu alcance. En una entrega existente debe coincidir: no se cambia el productor.' },
  { field: 'product_code', header: 'codigo_producto', label: 'Producto', clearable: true, identity: false, maxLength: 40, pattern: /^[A-Z0-9][A-Z0-9_-]{1,39}$/, rule: `Opcional. Código exacto de un producto activo de tu organización. ${CLEAR_TOKEN} lo quita del borrador.` },
  { field: 'location_code', header: 'codigo_centro', label: 'Centro de acopio', clearable: true, identity: false, maxLength: 40, pattern: /^[A-Z0-9][A-Z0-9_-]{1,39}$/, rule: `Opcional. Código exacto de un centro activo. ${CLEAR_TOKEN} lo quita.` },
  { field: 'delivery_date', header: 'fecha_entrega', label: 'Fecha de entrega', clearable: true, identity: false, maxLength: 10, pattern: /^\d{4}-\d{2}-\d{2}$/, formatMessage: 'Escribe la fecha como texto AAAA-MM-DD (una celda de fecha de Excel no se interpreta).', rule: `Opcional. Texto AAAA-MM-DD (una celda de fecha de Excel no se interpreta). No se usa para deducir el periodo de cosecha. ${CLEAR_TOKEN} la quita.` },
  { field: 'quantity_declared', header: 'cantidad_declarada', label: 'Cantidad declarada', clearable: true, identity: false, maxLength: 21, pattern: /^\d{1,14}(\.\d{1,6})?$/, formatMessage: 'Número con punto decimal (p. ej. 120.5), sin separador de miles.', rule: `Opcional. Peso DECLARADO (no recibido), mayor que 0, punto decimal. Exige la columna unidad. ${CLEAR_TOKEN} la quita.` },
  { field: 'unit', header: 'unidad', label: 'Unidad', clearable: true, identity: false, maxLength: 2, pattern: /^KG$/, formatMessage: 'Unidad no admitida: solo KG (no se convierten unidades).', rule: 'KG (única unidad admitida; sin conversiones). Obligatoria si hay cantidad declarada.' },
  { field: 'harvest_precision', header: 'periodo_precision', label: 'Periodo de cosecha: precisión', clearable: true, identity: false, maxLength: 7, pattern: /^(DAY|MONTH|UNKNOWN)$/,
    rule: `DAY (día exacto o intervalo de días), MONTH (mes o intervalo de meses) o UNKNOWN (desconocido, sin fechas). Se guarda tal como se declara. ${CLEAR_TOKEN} quita el periodo.` },
  { field: 'harvest_start', header: 'periodo_inicio', label: 'Periodo de cosecha: inicio', identity: false, maxLength: 10, pattern: /^\d{4}-\d{2}(-\d{2})?$/, rule: 'DAY: AAAA-MM-DD · MONTH: AAAA-MM. Vacío con UNKNOWN.' },
  { field: 'harvest_end', header: 'periodo_fin', label: 'Periodo de cosecha: fin', identity: false, maxLength: 10, pattern: /^\d{4}-\d{2}(-\d{2})?$/, rule: 'Opcional (vacío = igual al inicio). Mismo formato que el inicio.' },
  { field: 'origins', header: 'parcelas_origen', label: 'Parcelas de origen', clearable: true, identity: false, maxLength: 1000, pattern: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}(:\d{1,14}(\.\d{1,6})?)?(;[A-Za-z0-9][A-Za-z0-9_.-]{0,39}(:\d{1,14}(\.\d{1,6})?)?)*$/,
    rule: `Opcional. Códigos de parcelas DEL PRODUCTOR separados por «;», con cantidad en KG opcional tras «:» (p. ej. PAR-1:120.5;PAR-2). Reemplaza la lista del borrador. ${CLEAR_TOKEN} la vacía.` },
  { field: 'notes', header: 'notas', label: 'Notas', clearable: true, identity: false, maxLength: 500, rule: `Opcional. Hasta 500 caracteres. ${CLEAR_TOKEN} las quita.` },
];

export const DELIVERY_TEMPLATE_RULES = [
  'Una fila por entrega. Importar solo crea o actualiza BORRADORES: no registra la entrega, no confirma recepción, pesaje, calidad, inventario, cierre ni debida diligencia. Registrar es una acción explícita desde la entrega, con sus compuertas.',
  'Identidad: el código de entrega asignado por Terra Link o, en filas sin código, la referencia de importación (obligatoria). Reimportar la misma referencia no duplica; dos referencias distintas son dos entregas aunque sus datos coincidan. Nunca se fusionan filas por parecido o igualdad de contenido.',
  'Una entrega REGISTRADA no se modifica por importación: los cambios se rechazan y se hacen con la corrección de la entrega.',
  'El periodo de cosecha se guarda como se declara (día, mes, intervalo o desconocido). Nunca se deduce de la fecha de entrega.',
  'Peso declarado (no el recibido), en KG, sin conversiones. Las referencias (productor, producto, centro, parcelas) deben ser códigos exactos dentro de tu alcance; no se crean ni se buscan parecidos.',
  'Los soportes documentales no se importan: se vinculan desde la entrega, a una versión exacta del documento (vincular no implica revisión ni aprobación).',
  'Solo se importan las columnas asociadas. Celda vacía o columna sin asociar = sin cambio. #BORRAR solo en campos opcionales del borrador.',
  'Confirmación atómica: se guarda todo el lote o nada. Un lote con filas con error no se puede confirmar.',
];
