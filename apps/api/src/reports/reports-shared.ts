// P0-030 — Piezas comunes a los indicadores (S1 §60) y a los reportes por entidad (S1 §97).
// Contrato: docs/decisiones/P0-030-REPORTES.md.
import type { TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../db/schema';

// El catálogo de REPORTES cambia cuando cambia la LISTA de indicadores publicados; `2026-10-15.1` añade
// `risk_critical`, que no está en S1 §60 y va marcado `catalog: 'TERRA_LINK'`. No tiene relación con el catálogo de
// REGLAS DE RIESGO (`risk_rule_sets`, D-07): son dos versionados distintos y no deben confundirse.
export const REPORT_CATALOG_VERSION = '2026-10-15.1';
export const REPORT_EXPORT_FORMAT = 'TL_REPORT_CSV 0.1 (provisional)';
export const GEOJSON_EXPORT_FORMAT = 'TL_PLOTS_GEOJSON 0.1 (provisional, RFC 7946)';

export interface Period { from: string | null; to: string | null }

/** Estado de un indicador. Solo OK lleva valor; el resto declara POR QUÉ no lo hay. */
export type IndicatorStatus = 'OK' | 'NO_DENOMINATOR' | 'UNKNOWN' | 'CRITERION_UNDEFINED' | 'RESTRICTED';

/**
 * Cobertura histórica DECLARADA de los datos de una organización (migración 0076). Es un hecho del conjunto de datos, no una propiedad del producto ni un corte de
 * fechas: los registros disponibles se incluyen SIEMPRE por su fecha operativa declarada (una entrega registrada después con fecha de septiembre cuenta en septiembre).
 * Sin declaración la cobertura es DESCONOCIDA —ni completa ni incompleta—, y una base nueva tampoco acredita completitud histórica.
 */
export interface Coverage { status: 'UNKNOWN' | 'INCOMPLETE' | 'COMPLETE'; event_date: string | null; note: string; not_reconstructed: string; reference: string | null; declared_at: string | null }
export const COVERAGE_UNKNOWN: Coverage = {
  status: 'UNKNOWN', event_date: null, declared_at: null, reference: null,
  note: 'No se ha declarado la cobertura histórica de los datos de esta organización: no se afirma que los registros estén completos ni que falten.',
  not_reconstructed: 'No se reconstruye ninguna cifra a partir de informes anteriores: son evidencia histórica, no registros operativos.',
};
export async function coverageFor(db: Kysely<Database> | Transaction<Database>, organizationId: string): Promise<Coverage> {
  const r = await db.selectFrom('report_coverage_declarations').select(['status', sql<string | null>`event_date::text`.as('event_date'), 'note', 'reference', 'declared_at'])
    .where('organization_id', '=', organizationId).orderBy('declared_at', 'desc').limit(1).executeTakeFirst();
  if (!r) return COVERAGE_UNKNOWN;
  return { status: r.status, event_date: r.event_date, note: r.note, reference: r.reference, declared_at: r.declared_at.toISOString(), not_reconstructed: COVERAGE_UNKNOWN.not_reconstructed };
}
export const coverageLine = (c: Coverage) => `${c.note} ${c.not_reconstructed}${c.reference ? ` Detalle: ${c.reference}` : ''}`;

/**
 * Fechas y zona horaria. El sistema no asume ninguna zona: las marcas con hora la exigen explícita (DATETIME_ZONE_REQUIRED)
 * y las fechas civiles declaradas no la llevan. Aquí se declara, no se inventa.
 */
export function timeBasis(asOf: string) {
  return {
    as_of: asOf,
    as_of_note:
      'Los indicadores y reportes de estado describen el instante «as_of», en UTC (sufijo Z). No se convierte a ninguna zona local: ' +
      'Terra Link no asume zona horaria en ningún punto del sistema.',
    period_bounds:
      'Los límites «desde» y «hasta» son INCLUSIVOS y se comparan contra fechas civiles (tipo date), sin hora ni zona: una entrega ' +
      'declarada el 30-09 entra en un período que termina el 30-09.',
    civil_dates:
      'delivery_date es la fecha civil declarada por quien registra. No se le asigna zona horaria ni se convierte, y nunca se sustituye ' +
      'por created_at, que es la fecha de carga en el sistema y no una fecha operativa.',
  };
}

/**
 * Instantánea de lectura, con su alcance EXACTO. No basta con reutilizar la misma función: si sus consultas sucesivas
 * corriesen fuera de una transacción, filas y totales podrían venir de estados distintos de la base.
 * Lo que SÍ se garantiza: una petición (filas + totales) y una exportación completa (todas sus páginas).
 * Lo que NO: dos peticiones distintas. Navegar entre páginas abre una instantánea nueva en cada una.
 */
export const SNAPSHOT_NOTE =
  'Dentro de UNA petición, las filas y los totales proceden de la misma instantánea de lectura (transacción REPEATABLE READ ' +
  'de solo lectura), y una exportación recorre todas sus páginas dentro de esa misma instantánea. En cambio, navegar entre ' +
  'páginas son peticiones distintas y cada una abre la suya: entre una página y la siguiente los datos pueden haber cambiado.';

/** Tope de una exportación, declarado donde se ofrece la descarga y no solo dentro del archivo. */
export const exportLimitNote = (max: number) =>
  `La exportación trae todas las filas del reporte, no solo la página mostrada, hasta un tope de ${max.toLocaleString('es-EC')}. ` +
  'Si el reporte lo superara, el archivo se rotula TRUNCADO en su cabecera `# filas` (con el número exportado y el total), ' +
  'y los totales siguen cubriendo el conjunto completo.';

export const EXPORT_RECALC_NOTE =
  'Cada descarga RECALCULA desde la base con los mismos filtros; no es la instantánea que ya estaba en pantalla. Su marca «generado» es la ' +
  'del momento de la descarga. Si los datos cambiaron entre una y otra, el archivo refleja los datos nuevos, no los mostrados antes.';

export const SCOPE_NOTE =
  'Cada indicador y cada reporte exige el permiso de su dominio. Lo que tu rol no permite sale RESTRICTED, sin valor ni conteo: ningún total ' +
  'agrega sobre dominios que no puedes leer, de modo que nada oculto se deduce por diferencia.';

export const INTERPRETATION_NOTE =
  'Readiness no es conformidad. Reserva no es despacho. INTEGRATED significa que la operación y su evento existen, no que estén acreditados. ' +
  'Calidad, origen, hallazgos GIS, riesgo y preparación DD son dimensiones distintas y no se combinan en una puntuación única.';

/** Los alcances por asignación no habilitan reportes de organización: un total parcial se leería como total del tenant. */
export const ASSIGNED_SCOPE_NOTE =
  'Los permisos de alcance por asignación (*_assigned) no habilitan reportes de organización: un total calculado sobre una parte se leería ' +
  'como total del tenant. Quien solo tiene alcance asignado consulta su trabajo, no los reportes agregados.';

export const has = (ctx: TenantContext, p: Permission) => ctx.permissions.includes(p);
