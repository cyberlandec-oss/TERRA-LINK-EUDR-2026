// P0-030 — Catálogo de reportes por entidad (S1 §97) y sus permisos. Módulo PURO, sin Nest ni base de datos, para que
// la regla de autorización se pueda probar en memoria con conjuntos de permisos arbitrarios, sin tocar los roles reales.
// Contrato: docs/decisiones/P0-030-REPORTES.md §5 y §7.
//
// Regla, aplicada igual en los seis reportes: un reporte exige el permiso de CADA dominio del que muestra datos,
// conteos o totales — no solo el de la entidad que encabeza las filas. Leer productores no autoriza a conocer cuántas
// parcelas o entregas tienen. Faltando uno, se deniega el reporte completo: una versión recortada daría totales
// parciales que se leerían como totales de la organización.
import type { Permission } from '../authz/catalog';

export type EntityKind = 'producers' | 'plots' | 'lots' | 'risk' | 'traceability' | 'dd';

export interface Definition {
  kind: EntityKind;
  title: string;
  source: string;
  /** Todos los permisos exigidos, con el dominio del que procede cada dato agregado. */
  requires: Permission[];
  /** Por qué se exige cada permiso: se publica, para que la denegación sea comprensible y auditable. */
  why: Record<string, string>;
  period_applies: boolean;
  period_note: string;
  /** Columna de orden y de cursor. Es única dentro de la organización, así la paginación es estable. */
  key: string;
}

export const ENTITY_REPORTS: Definition[] = [
  {
    kind: 'producers', title: 'Reporte de productores', source: 'S1 §97 «Producer report»',
    requires: ['producer:read', 'plot:read', 'delivery:read'],
    why: {
      'producer:read': 'las filas son productores del tenant',
      'plot:read': 'cada fila cuenta sus parcelas y cuántas tienen geometría',
      'delivery:read': 'cada fila cuenta sus entregas registradas del período',
    },
    period_applies: true, key: 'producer_code',
    period_note: 'El período se aplica solo a la columna de entregas registradas, por `delivery_date`. El resto describe el estado actual.',
  },
  {
    kind: 'plots', title: 'Reporte de parcelas', source: 'S1 §97 «Plot report»',
    requires: ['plot:read', 'producer:read'],
    why: {
      'plot:read': 'las filas son parcelas del tenant',
      'producer:read': 'cada fila identifica al productor de la parcela por su código',
    },
    period_applies: false, key: 'plot_code',
    period_note: 'Reporte de estado actual: el período no se aplica. No se filtra por `created_at`.',
  },
  {
    kind: 'lots', title: 'Reporte de lotes', source: 'S1 §97 «Lot report»',
    requires: ['lot:read', 'product:read'],
    why: {
      'lot:read': 'las filas son lotes del tenant',
      'product:read': 'cada fila identifica el producto del lote por su código',
    },
    period_applies: false, key: 'lot_code',
    period_note: 'Reporte de estado actual: el período no se aplica. Las cantidades son las vigentes, no un saldo a una fecha.',
  },
  {
    kind: 'risk', title: 'Reporte de riesgo', source: 'S1 §97 «Risk report»',
    requires: ['risk:read', 'lot:read'],
    why: {
      'risk:read': 'las filas muestran la evaluación de riesgo de cada sujeto',
      'lot:read': 'el sujeto evaluado es un lote y se identifica por su código',
    },
    period_applies: false, key: 'lot_code',
    period_note: 'Reporte de estado actual: muestra la ÚLTIMA evaluación de cada lote. Los lotes sin evaluar aparecen como tales.',
  },
  {
    kind: 'traceability', title: 'Reporte de trazabilidad', source: 'S1 §97 «Traceability report»',
    requires: ['lot:read', 'delivery:read', 'plot:read'],
    why: {
      'lot:read': 'las filas son lotes y sus entradas vigentes',
      'delivery:read': 'cada fila cuenta las entregas enlazadas al lote',
      'plot:read': 'cada fila cuenta las parcelas declaradas como origen',
    },
    period_applies: false, key: 'lot_code',
    period_note: 'Reporte de estado actual: completitud del origen declarado de cada lote, no conformidad.',
  },
  {
    kind: 'dd', title: 'Reporte de debida diligencia', source: 'S1 §97 «DD report»',
    requires: ['dd:read', 'lot:read'],
    why: {
      'dd:read': 'las filas son expedientes de diligencia del tenant',
      'lot:read': 'cada expediente identifica su lote sujeto por el código',
    },
    period_applies: false, key: 'case_number',
    period_note: 'Reporte de estado actual: la ÚLTIMA instantánea de cada expediente.',
  },
];

/** La exportación GeoJSON entrega coordenadas exactas y el código del productor de cada parcela. */
export const GEOJSON_REQUIRES: Permission[] = ['report:export', 'plot:read', 'plot:read_geometry', 'producer:read'];
export const GEOJSON_WHY: Record<string, string> = {
  'report:export': 'es una exportación de reportes',
  'plot:read': 'las features son parcelas del tenant',
  'plot:read_geometry': 'entrega coordenadas exactas',
  'producer:read': 'cada feature identifica al productor por su código',
};

export const definitionOf = (kind: string): Definition | undefined => ENTITY_REPORTS.find((d) => d.kind === kind);

/** Permisos que le faltan a un conjunto dado. El orden es el de `requires`, para que el mensaje sea estable. */
export const missingPermissions = (held: readonly string[], required: readonly Permission[]): Permission[] =>
  required.filter((p) => !held.includes(p));

/** Mensaje de denegación: dice qué falta y por qué, sin revelar ningún conteo del dominio restringido. */
export function denialMessage(required: readonly Permission[], missing: readonly Permission[], why: Record<string, string>): string {
  const detalle = missing.map((p) => `${p} (${why[p] ?? 'dato de ese dominio'})`).join('; ');
  return `Este reporte exige ${required.join(', ')}; te falta ${detalle}. No se entrega una versión parcial: un total calculado sobre una parte se leería como total de la organización.`;
}
