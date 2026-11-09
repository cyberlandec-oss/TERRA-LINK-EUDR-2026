import { CLEAR_TOKEN, type TemplateField } from './producer-template';

// P0-026 — Plantilla de importación de parcelas (S1 §62 «plots.xlsx»). Campos = los de la entidad parcela existente
// (P0-006, migración 0008) más la superficie DECLARADA en hectáreas. NO admite coordenadas ni geometría: la geometría se
// registra con sus flujos (coordenadas manuales, GPS, polígono, GeoJSON de P0-009), que validan formato y ejes sin
// reproyectar ni reparar. El productor se referencia por su código exacto dentro de la organización (único por tenant,
// P0-005); nunca se crea ni se elige por parecido.

export const PLOT_TEMPLATE_VERSION = 'PARCELAS_V1';
export const PLOT_TEMPLATE_SHEET = 'parcelas';

export type PlotImportField = 'plot_code' | 'producer_code' | 'name' | 'crop' | 'variety' | 'land_use' | 'province' | 'canton' | 'parish' | 'area_declared_ha';

export const PLOT_FIELDS: Array<TemplateField<PlotImportField>> = [
  { field: 'plot_code', header: 'codigo_parcela', label: 'Código de parcela', required: true, identity: false, maxLength: 40, pattern: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/,
    rule: 'Obligatorio. Clave de la importación: único en tu organización. 1–40 caracteres: letras, números, punto, guion o guion bajo.' },
  { field: 'producer_code', header: 'codigo_productor', label: 'Código de productor', requiredOnCreate: true, identity: false, maxLength: 40, pattern: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/,
    rule: 'Obligatorio para una parcela nueva: código EXACTO de un productor ya registrado y activo en tu alcance. No se crean productores ni se buscan parecidos. En una parcela existente debe coincidir: la importación no reasigna parcelas.' },
  { field: 'name', header: 'nombre', label: 'Nombre', clearable: true, identity: false, maxLength: 120, rule: `Opcional. Hasta 120 caracteres. ${CLEAR_TOKEN} lo vacía.` },
  { field: 'crop', header: 'cultivo', label: 'Cultivo', requiredOnCreate: true, identity: false, maxLength: 60, rule: 'Obligatorio para una parcela nueva. Hasta 60 caracteres. No se puede vaciar.' },
  { field: 'variety', header: 'variedad', label: 'Variedad', clearable: true, identity: false, maxLength: 60, rule: `Opcional. Hasta 60 caracteres. ${CLEAR_TOKEN} la vacía.` },
  { field: 'land_use', header: 'uso_suelo', label: 'Uso del suelo', clearable: true, identity: false, maxLength: 80, rule: `Opcional. Hasta 80 caracteres. ${CLEAR_TOKEN} lo vacía.` },
  { field: 'province', header: 'provincia', label: 'Provincia', clearable: true, identity: false, maxLength: 100, rule: `Opcional. Hasta 100 caracteres. ${CLEAR_TOKEN} la vacía.` },
  { field: 'canton', header: 'canton', label: 'Cantón', clearable: true, identity: false, maxLength: 100, rule: `Opcional. Hasta 100 caracteres. ${CLEAR_TOKEN} lo vacía.` },
  { field: 'parish', header: 'parroquia', label: 'Parroquia', clearable: true, identity: false, maxLength: 100, rule: `Opcional. Hasta 100 caracteres. ${CLEAR_TOKEN} la vacía.` },
  { field: 'area_declared_ha', header: 'superficie_declarada_ha', label: 'Superficie declarada (ha)', identity: false, maxLength: 13, pattern: /^\d{1,8}(\.\d{1,4})?$/,
    rule: 'Opcional. Hectáreas DECLARADAS, mayor que 0, punto decimal y hasta 4 decimales (p. ej. 2.5). Sin conversiones de unidad. Crea una versión nueva sin validar; si la parcela tiene geometría, la conserva tal cual (no es una captura nueva). No se puede vaciar.' },
];

export const PLOT_TEMPLATE_RULES = [
  'Una fila por parcela. La primera fila son los encabezados; asocia las columnas a los campos en el paso de mapeo.',
  'Esta plantilla NO importa coordenadas ni geometría. Para la geometría usa la captura en la parcela o la importación GeoJSON. La geometría existente nunca se modifica ni se sustituye.',
  'Superficie declarada y superficie calculada son datos distintos: aquí solo se importa la declarada; la calculada sale de la geometría.',
  'Solo se importan las columnas asociadas. Las no asociadas se ignoran y esos campos no cambian.',
  `Celda vacía = sin dato: no borra. ${CLEAR_TOKEN} vacía solo campos opcionales editables (nombre, variedad, uso del suelo, provincia, cantón, parroquia).`,
  'El productor se indica por su código exacto; no se crean productores ni se reasignan parcelas existentes.',
  'Una parcela dada de baja no se reactiva ni se edita por importación. Importar no valida la parcela ni cumple requisitos de geolocalización (D-05).',
  'Importar exige permisos de parcela (alta o edición, con su alcance por asignación); el permiso general de importación no basta.',
  'Confirmación atómica: se guarda todo el lote o nada. Un lote con filas con error no se puede confirmar.',
];
