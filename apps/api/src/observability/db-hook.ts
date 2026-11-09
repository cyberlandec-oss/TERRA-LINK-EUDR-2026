import { consultas, duracionConsulta } from './metrics';
import { sqlSeguro } from './sanitize';
import { tramoSql } from './tracing';

/**
 * RNF-13 — Enganche de instrumentación de la base, **compartido por la API, el worker y las pruebas**.
 *
 * Es el único punto donde el texto de una consulta toca la observabilidad, y lo primero que hace es reducirlo
 * a **verbo y tabla** (`SELECT producers`). El SQL que llega ya está parametrizado —los valores viajan
 * aparte—, pero ni aun así se guarda entero.
 *
 * Nunca lanza: si la instrumentación fallara, la consulta ya se ejecutó y la operación no puede verse
 * afectada.
 */
export function instrumentarConsulta(sqlText: string, ms: number): void {
  try {
    const operacion = sqlSeguro(sqlText).split(' ')[0];
    consultas.labels(operacion).inc();
    duracionConsulta.labels(operacion).observe(ms / 1000);
    tramoSql(sqlText, ms);
  } catch { /* la observabilidad nunca degrada la operación */ }
}
