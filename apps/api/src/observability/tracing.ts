import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { atributosSeguros, sqlSeguro, textoSeguro } from './sanitize';

// RNF-13 — TRAZAS: tramos encadenados que permiten recorrer UN caso real de extremo a extremo.
//
// POR QUÉ ASÍ Y NO CON UN SDK DE EXPORTACIÓN
// Un SDK de trazas con instrumentación automática captura, por omisión, **el SQL completo con sus valores** y
// cuerpos de petición, y su utilidad está en **exportar a un servicio externo**. Las dos cosas están
// prohibidas en esta entrega: no se envía telemetría fuera del entorno autorizado y no se registran valores de
// SQL, cuerpos, identidad protegida ni coordenadas. Instrumentar a mano con una **lista blanca de atributos**
// es aquí más seguro y más demostrable que auditar lo que un agente automático decide capturar.
//
// CORRELACIÓN REUTILIZADA, NO INVENTADA
// El identificador de traza **es el `request_id`** que el producto ya genera y propaga (cabecera
// `X-Request-Id`, errores normalizados y `audit_logs.request_id`). Por eso, desde una fila de bitácora o
// desde el error que vio una persona se llega a la traza sin añadir ninguna clave nueva. Los trabajos del
// outbox se correlacionan con su propia traza y declaran `job.*`.
//
// LÍMITES, DECLARADOS
// El almacén es un **anillo acotado en memoria del proceso**: se pierde al reiniciar y no se comparte entre
// procesos (API y worker tienen el suyo). Es suficiente para recorrer un caso reciente, que es lo que el
// requisito pide, y **no** es un backend de trazas. No hay muestreo: se guardan todas las trazas hasta el
// tope, y al llegar al tope se descarta la más antigua.

export interface Tramo {
  span_id: string;
  parent_id: string | null;
  name: string;
  started_at: string;
  duration_ms: number;
  status: 'OK' | 'ERROR';
  attributes: Record<string, string | number>;
}

export interface Traza {
  trace_id: string;
  name: string;
  started_at: string;
  duration_ms: number;
  status: 'OK' | 'ERROR';
  spans: Tramo[];
}

interface Contexto {
  traceId: string;
  spanId: string | null;
  tramos: Tramo[];
}

const almacen = new AsyncLocalStorage<Contexto>();

/** Anillo acotado: la observabilidad no puede crecer sin límite ni competir por memoria con la operación. */
const MAX_TRAZAS = 200;
const trazas: Traza[] = [];

export function registrarTraza(t: Traza): void {
  trazas.push(t);
  while (trazas.length > MAX_TRAZAS) trazas.shift();
}

export function trazasRecientes(limite = 50): Traza[] {
  return trazas.slice(-limite).reverse();
}

export function trazaPorId(traceId: string): Traza | undefined {
  return trazas.find((t) => t.trace_id === traceId);
}

/** Solo para pruebas: deja el anillo vacío. */
export function vaciarTrazas(): void {
  trazas.length = 0;
}

export function trazaActual(): Contexto | undefined {
  return almacen.getStore();
}

/**
 * Abre una traza y ejecuta `fn` DENTRO del contexto, de forma síncrona. Tiene que ser síncrona: lo que se
 * suscribe o se lanza dentro hereda el contexto; lo que se lance fuera, no. El `traceId` es el `request_id`
 * ya existente: no se crea otra clave. Nunca interfiere con el resultado ni con el error.
 */
export function ejecutarConTraza<T>(traceId: string, fn: () => T): T {
  const ctx: Contexto = { traceId, spanId: null, tramos: [] };
  return almacen.run(ctx, fn);
}

/** Variante asíncrona, para procesos sin HTTP (worker del outbox). */
export async function conTraza<T>(traceId: string, fn: () => Promise<T>): Promise<T> {
  return ejecutarConTraza(traceId, fn);
}

/** Cierra la traza en curso y la guarda. `attrs` pasa por la lista blanca. */
export function cerrarTraza(nombre: string, inicio: number, status: 'OK' | 'ERROR', attrs: Record<string, unknown>): void {
  const ctx = almacen.getStore();
  if (!ctx) return;
  const duracion = Date.now() - inicio;
  registrarTraza({
    trace_id: ctx.traceId,
    name: textoSeguro(nombre, 120),
    started_at: new Date(inicio).toISOString(),
    duration_ms: duracion,
    status,
    spans: [
      {
        span_id: 'root',
        parent_id: null,
        name: textoSeguro(nombre, 120),
        started_at: new Date(inicio).toISOString(),
        duration_ms: duracion,
        status,
        attributes: atributosSeguros(attrs),
      },
      ...ctx.tramos,
    ],
  });
}

/**
 * Tramo hijo. Si no hay traza en curso no hace nada: la instrumentación es opcional y nunca falla la
 * operación. `attrs` pasa por la lista blanca; el nombre, por el saneador de texto.
 */
export async function tramo<T>(nombre: string, attrs: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const ctx = almacen.getStore();
  if (!ctx) return fn();
  const inicio = Date.now();
  const spanId = randomUUID().slice(0, 8);
  const previo = ctx.spanId;
  ctx.spanId = spanId;
  try {
    const r = await fn();
    anotar(ctx, spanId, previo, nombre, inicio, 'OK', attrs);
    return r;
  } catch (e) {
    anotar(ctx, spanId, previo, nombre, inicio, 'ERROR', { ...attrs, 'error.kind': claseDeError(e) });
    throw e;
  } finally {
    ctx.spanId = previo;
  }
}

function anotar(ctx: Contexto, spanId: string, parent: string | null, nombre: string, inicio: number, status: 'OK' | 'ERROR', attrs: Record<string, unknown>) {
  // Cota por traza: una petición patológica no puede llenar el anillo ella sola.
  if (ctx.tramos.length >= 100) return;
  ctx.tramos.push({
    span_id: spanId,
    parent_id: parent ?? 'root',
    name: textoSeguro(nombre, 120),
    started_at: new Date(inicio).toISOString(),
    duration_ms: Date.now() - inicio,
    status,
    attributes: atributosSeguros(attrs),
  });
}

/**
 * Clase del error, **nunca su mensaje**: los errores de PostgreSQL/PostGIS llevan valores y coordenadas, y los
 * de dominio pueden llevar datos. Mismo criterio que `describeForLog` en `common/errors.ts`.
 */
export function claseDeError(e: unknown): string {
  const err = e as { code?: unknown; name?: unknown; status?: unknown };
  if (err && typeof err === 'object') {
    if (typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)) return `sqlstate_${err.code}`;
    if (typeof err.status === 'number') return `http_${err.status}`;
    if (typeof err.name === 'string') return textoSeguro(err.name, 40);
  }
  return 'desconocido';
}

/** Tramo de consulta: el nombre es **verbo y tabla**; el texto con valores nunca entra. */
export function tramoSql(sqlText: string, ms: number): void {
  const ctx = almacen.getStore();
  if (!ctx || ctx.tramos.length >= 100) return;
  const nombre = sqlSeguro(sqlText);
  ctx.tramos.push({
    span_id: randomUUID().slice(0, 8),
    parent_id: ctx.spanId ?? 'root',
    name: nombre,
    started_at: new Date(Date.now() - ms).toISOString(),
    duration_ms: ms,
    status: 'OK',
    attributes: atributosSeguros({ 'db.operation': nombre.split(' ')[0] }),
  });
}
