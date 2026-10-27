import type { TemplateField } from './producer-template';

// P0-026 — Plantilla de importación de lotes (S1 §62 «lots.xlsx»). Solo las operaciones del contrato de lotes (P0-016/P0-017):
// crear un lote con recepciones CONFIRMADAS y asignar recepciones a un lote ABIERTO, con los casos de uso del ledger
// (disponibilidad recalculada, bloqueos, mezcla de origen bloqueada, movimientos y eventos). No crea recepciones, stock ni
// origen; no procesa, convierte, libera calidad, cierra ni reabre lotes. Una cantidad escrita en Excel no es existencia física.

export const LOT_TEMPLATE_VERSION = 'LOTES_V1';
export const LOT_TEMPLATE_SHEET = 'lotes';

export type LotImportField = 'lot_code' | 'import_reference' | 'reception_id' | 'delivery_code' | 'product_code' | 'quantity';

export const LOT_FIELDS: Array<TemplateField<LotImportField>> = [
  { field: 'lot_code', header: 'codigo_lote', label: 'Código de lote', identity: false, maxLength: 40, pattern: /^[A-Z0-9][A-Z0-9_-]{1,39}$/,
    rule: 'Opcional. Código ASIGNADO por Terra Link (p. ej. LOT-2026-00003) de un lote ABIERTO al que asignar la recepción. Vacío = lote nuevo identificado por la referencia.' },
  { field: 'import_reference', header: 'referencia_importacion', label: 'Referencia de importación', identity: false, maxLength: 80, pattern: /^[A-Za-z0-9][A-Za-z0-9_./-]{0,79}$/,
    formatMessage: 'Referencia no válida: 1–80 caracteres (letras, números, punto, guion, barra o guion bajo).',
    rule: 'Obligatoria sin código de lote. Las filas con la misma referencia forman UN lote nuevo (una fila por recepción). Reimportar la misma referencia vuelve al mismo lote; no es un dato del lote.' },
  { field: 'reception_id', header: 'id_recepcion', label: 'Recepción (id)', identity: false, maxLength: 36, pattern: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    formatMessage: 'Identificador de recepción no válido: cópialo de la hoja «recepciones_disponibles» de la plantilla.',
    rule: 'Obligatorio. Id EXACTO de una recepción confirmada con existencia sin lote (hoja «recepciones_disponibles»). Un lote histórico sin recepción registrada no se puede importar: primero se registran la entrega y su recepción.' },
  { field: 'delivery_code', header: 'codigo_entrega', label: 'Código de entrega (verificación)', identity: false, maxLength: 40, pattern: /^[A-Z0-9][A-Z0-9_-]{1,39}$/,
    rule: 'Opcional. Si se indica, debe ser la entrega de esa recepción (comprobación cruzada; no cambia nada).' },
  { field: 'product_code', header: 'codigo_producto', label: 'Código de producto (verificación)', identity: false, maxLength: 40, pattern: /^[A-Z0-9][A-Z0-9_-]{1,39}$/,
    rule: 'Opcional. Si se indica, debe ser el producto de la recepción. El producto del lote lo fija su primera recepción; no se convierte.' },
  { field: 'quantity', header: 'cantidad_kg', label: 'Cantidad (KG)', identity: false, maxLength: 21, pattern: /^\d{1,14}(\.\d{1,6})?$/,
    formatMessage: 'Número en KG con punto decimal (p. ej. 120.5), sin separador de miles ni unidad.',
    rule: 'Obligatoria. KG que se mueven de la recepción al lote; mayor que 0 y no mayor que lo disponible de la recepción en ese momento. Sin conversiones ni tolerancias.' },
];

export const LOT_TEMPLATE_RULES = [
  'Una fila = una asignación de una recepción confirmada a un lote. Importar no crea recepciones, stock ni origen, y una cantidad escrita en Excel no demuestra existencia física: lo disponible sale del inventario.',
  'Identidad: código del lote existente, o referencia de importación para un lote nuevo (las filas con la misma referencia forman un lote). Reimportar lo mismo no duplica asignaciones, cantidades, versiones ni eventos.',
  'La vista previa explica cada movimiento (kg de qué recepción a qué lote). La disponibilidad, los bloqueos y los permisos se vuelven a comprobar al confirmar.',
  'No se mezclan productos ni origen conocido con origen incompleto en un lote. El origen y el producto los fija la recepción.',
  'Un lote cerrado para entradas o resultado de un proceso no admite entradas: no se reabre. Una asignación existente no se modifica ni se libera por importación (hazlo desde el lote).',
  'No procesa, convierte, libera calidad, cierra ni reabre lotes.',
  'Confirmación atómica: se guarda todo el lote de filas o nada.',
];
