// P0-030 — Reparto por severidad de riesgo. Módulo PURO, para poder probar con conjuntos sintéticos los tres casos,
// incluido el MIXTO (lotes clasificados y sin clasificar a la vez).
//
// Desde D-07 la severidad de una evaluación depende de DOS cosas, en este orden:
//  1. que exista un catálogo **publicado** globalmente (acto de migración, no de usuario), y
//  2. que ESTA organización lo haya **adoptado** (D-07.1). Publicar no es adoptar: sin adopción que la respalde, el
//     `CHECK risk_evaluations_severity_backed` (migración 0042) impide escribir cualquier severidad.
// Adoptado el catálogo, una evaluación puede seguir saliendo sin severidad: por A.2 (ningún hallazgo en las reglas
// evaluadas) o porque los hallazgos pertenecen a reglas sin severidad declarada.
//
// Nada de esto depende de cerrar P0-021 —implementada— ni P0-028: verificar una mitigación entra en el resultado
// TÉCNICO de su factor y no asigna severidad ni concluye a favor. La conclusión regulatoria sigue UNDETERMINED
// (`CHECK risk_evaluations_conclusion_undetermined`) mientras D-07.5 y D-07.6 sigan pendientes.
import type { IndicatorStatus } from './reports-shared';

export interface SeverityInput {
  /** Severidad de este indicador. `CRITICAL` es extensión de Terra Link, no de la lista de S1 §60. */
  sev: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  /** Etiqueta en español para los mensajes («alto», «medio», «bajo»). */
  label: string;
  /** Lotes del tenant: el universo, que se conoce aunque no esté evaluado. */
  lotesTotal: number;
  /** Conteo por severidad de la ÚLTIMA evaluación de cada sujeto. */
  porSeveridad: Record<string, number>;
  /** Catálogo de reglas: lo publicado globalmente y lo adoptado por ESTA organización, para citar hechos reales. */
  catalogo: CatalogState | null;
}

/** Estado real del catálogo para una organización: publicación global y adopción propia son cosas distintas (D-07.1). */
export interface CatalogState {
  /** Última versión publicada globalmente, con su estado de aprobación. `null` si no hay ninguna publicada. */
  publicada: { version: string; approval_status: string } | null;
  /** Versión que ESTA organización tiene adoptada hoy, o `null` si no ha adoptado ninguna. */
  adoptada: string | null;
}

export interface SeverityResult {
  status: IndicatorStatus;
  value: string | null;
  numerator: number | null;
  denominator: number | null;
  observed: Record<string, number>;
  reason: string;
}

const NO_DEPENDE =
  'Es la decisión D-07, no un efecto de cerrar otras historias: verificar una mitigación (P0-021, implementada) entra en el ' +
  'resultado técnico de su factor y no asigna severidad.';

/** Por qué no hay severidad, citando el catálogo real leído de la base y no una lista de historias pendientes. */
export function catalogNote(catalogo: CatalogState | null): string {
  if (!catalogo?.publicada) return `No hay catálogo de reglas de riesgo publicado. ${NO_DEPENDE}`;
  const pub = catalogo.publicada;
  if (!catalogo.adoptada) {
    return (
      `El último catálogo publicado es ${pub.version} (${pub.approval_status}), pero esta organización NO lo ha adoptado: publicar ` +
      'globalmente y adoptar en una organización son actos distintos (D-07.1), y sin una adopción que la respalde el motor escribe ' +
      `NOT_ASSESSED en TODA evaluación. ${NO_DEPENDE}`
    );
  }
  const mas = pub.version === catalogo.adoptada ? ''
    : ` Hay una versión más reciente publicada (${pub.version}) que esta organización no ha adoptado: no se aplica sola.`;
  return (
    `Esta organización tiene adoptado el catálogo ${catalogo.adoptada}.${mas} Que una evaluación salga sin severidad significa que no ` +
    'hubo hallazgos en las reglas evaluadas (NOT_ASSESSED, A.2) o que los hallazgos pertenecen a reglas sin severidad declarada; cada ' +
    `evaluación lo detalla en su cobertura. ${NO_DEPENDE}`
  );
}

/**
 * Tres casos, cada uno con su estado:
 *  - sin sujetos evaluados          → NO_DENOMINATOR (la ausencia de evaluaciones es un hecho observado, no un cero)
 *  - evaluados, ninguno clasificado → UNKNOWN
 *  - al menos uno clasificado       → OK **sobre la base de los clasificados**, nunca como distribución de todo el tenant
 */
export function severityBucket(i: SeverityInput): SeverityResult {
  const evaluados = Object.values(i.porSeveridad).reduce((a, b) => a + b, 0);
  const sinSeveridad = (i.porSeveridad.NOT_ASSESSED ?? 0) + (i.porSeveridad.UNDETERMINED ?? 0);
  const conSeveridad = evaluados - sinSeveridad;
  const observed = { lotes_del_tenant: i.lotesTotal, lotes_evaluados: evaluados, sin_severidad_asignada: sinSeveridad, con_severidad_asignada: conSeveridad };

  if (evaluados === 0) {
    return {
      status: 'NO_DENOMINATOR', value: null, numerator: null, denominator: 0, observed,
      reason: `Ningún lote tiene evaluación de riesgo: el denominador es cero. Que no haya evaluaciones es un hecho observado (${i.lotesTotal} lote(s) en el tenant), pero no permite afirmar cuántos son de riesgo ${i.label}.`,
    };
  }
  if (conSeveridad === 0) {
    return {
      status: 'UNKNOWN', value: null, numerator: null, denominator: evaluados, observed,
      reason: `Desconocido: los ${evaluados} lote(s) evaluado(s) salieron SIN severidad asignada (NOT_ASSESSED/UNDETERMINED). ${catalogNote(i.catalogo)} «0 lotes de riesgo ${i.label}» sería una cifra favorable inventada sobre sujetos sin clasificar.`,
    };
  }
  const n = i.porSeveridad[i.sev] ?? 0;
  const sinEvaluar = i.lotesTotal - evaluados;
  return {
    status: 'OK', value: String(n), numerator: n, denominator: conSeveridad, observed,
    reason:
      `${n === 0 ? 'Cero observado: ninguno de los lotes clasificados quedó en esta severidad. ' : ''}` +
      `Sobre los ${conSeveridad} lote(s) CON severidad asignada, que es el denominador. Quedan ${sinSeveridad} evaluado(s) sin severidad y ` +
      `${sinEvaluar} sin evaluar: siguen siendo desconocidos, no se cuentan como riesgo ${i.label} y esta cifra NO es la distribución de ` +
      `los ${i.lotesTotal} lote(s) del tenant. Clasifica los HALLAZGOS EVALUADOS del catálogo adoptado` +
      `${i.catalogo?.adoptada ? ` (${i.catalogo.adoptada})` : ''}, que puede no cubrir todas las categorías de riesgo, y NO es una ` +
      'conclusión regulatoria: esa sigue UNDETERMINED.',
  };
}
