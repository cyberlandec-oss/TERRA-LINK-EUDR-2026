// RNF-13 — Saneamiento: lo ÚNICO que decide si las métricas y las trazas se pueden mirar sin riesgo.
//
// La instrumentación ve todo lo que pasa por la API. Si no se sanea aquí, un panel de métricas o una traza se
// convierten en una vía lateral para leer lo que el RBAC protege. Por eso este módulo es independiente, está
// probado aparte y **todo lo que se etiqueta o se registra pasa por él**.
//
// LO QUE NUNCA SALE
//   · contraseñas, tokens, claves y cabeceras de autorización;
//   · cuerpos de petición o respuesta, completos o parciales;
//   · identidad protegida: correos, cédulas, nombres de persona;
//   · coordenadas y geometrías;
//   · valores de SQL;
//   · identificadores de persona o de recurso **como etiqueta de métrica** (serían cardinalidad infinita
//     además de una filtración).
//
// Los identificadores de recurso tampoco se usan como etiqueta en las trazas: la correlación se hace con el
// `request_id` que el producto **ya** emite, no inventando una clave nueva.

/** UUID en cualquier posición. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Secuencias largas de dígitos o hex: códigos, huellas, referencias públicas (24 hex). */
const OPACO = /\b[0-9a-f]{12,}\b/gi;
const NUMERO = /\b\d{3,}\b/g;
/** Correo electrónico. */
const CORREO = /[\w.+-]+@[\w-]+\.[\w.-]+/gi;
/** Coordenadas: pares decimales con signo. */
const COORDENADA = /-?\d{1,3}\.\d{3,}/g;

/**
 * Ruta apta para ser ETIQUETA DE MÉTRICA. Devuelve el patrón, nunca los valores:
 * `/api/v1/organizations/9c1d…/lots/7f2a…` → `/api/v1/organizations/:id/lots/:id`.
 *
 * Se descarta la cadena de consulta ENTERA: puede llevar filtros con nombres, fechas o identificadores, y
 * ningún filtro es necesario para contar peticiones.
 */
export function rutaSegura(ruta: string): string {
  const sinConsulta = ruta.split('?')[0].split('#')[0];
  const saneada = sinConsulta
    .replace(UUID, ':id')
    .replace(OPACO, ':id')
    .replace(NUMERO, ':n')
    .replace(CORREO, ':correo');
  // Cota dura de cardinalidad: una ruta larguísima o rara no crea una serie nueva por cada variante.
  return saneada.length > 120 ? `${saneada.slice(0, 120)}…` : saneada || '/';
}

/** Clase de estado (`2xx`, `4xx`…): basta para medir y no multiplica series por cada código. */
export function claseEstado(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

/**
 * SQL apto para el NOMBRE de un tramo: **verbo y tabla, nada más**. Kysely ya parametriza (los valores viajan
 * aparte, no en el texto), pero aquí no se confía en eso: se extrae lo mínimo y se descarta el resto.
 *
 * `select "id" from "producers" where "document_number_enc" = $1` → `SELECT producers`
 */
export function sqlSeguro(sqlText: string): string {
  const texto = sqlText.replace(/\s+/g, ' ').trim();
  const verbo = /^(select|insert|update|delete|with|create|alter|drop|truncate)\b/i.exec(texto)?.[1]?.toUpperCase() ?? 'SQL';
  const tabla = /\b(?:from|into|update|join|table)\s+"?([a-z_][a-z0-9_]*)"?/i.exec(texto)?.[1];
  return tabla ? `${verbo} ${tabla}` : verbo;
}

/**
 * Último filtro antes de registrar o devolver un texto de instrumentación. No sustituye a los anteriores: es
 * la red que atrapa lo que se cuele por un camino nuevo.
 */
export function textoSeguro(valor: unknown, max = 200): string {
  const texto = typeof valor === 'string' ? valor : String(valor ?? '');
  return texto
    .replace(CORREO, '[correo]')
    .replace(UUID, '[id]')
    .replace(COORDENADA, '[coord]')
    .replace(OPACO, '[opaco]')
    .replace(/\b(password|contrase|token|secret|authorization|bearer|api[_-]?key)\S*/gi, '[reservado]')
    .slice(0, max);
}

/**
 * Atributos admitidos en un tramo. **Lista blanca**: lo que no está nombrado aquí no se guarda, de modo que
 * añadir instrumentación nueva no puede filtrar un campo por descuido.
 */
export const ATRIBUTOS_PERMITIDOS = [
  'http.method', 'http.route', 'http.status_class', 'http.status',
  'db.operation', 'db.rows',
  'job.type', 'job.consumer', 'job.attempt', 'job.outcome',
  'error.kind',
] as const;

export type AtributoPermitido = (typeof ATRIBUTOS_PERMITIDOS)[number];

export function atributosSeguros(attrs: Record<string, unknown>): Record<string, string | number> {
  const salida: Record<string, string | number> = {};
  for (const clave of ATRIBUTOS_PERMITIDOS) {
    const v = attrs[clave];
    if (v === undefined || v === null) continue;
    salida[clave] = typeof v === 'number' ? v : textoSeguro(v, 120);
  }
  return salida;
}
