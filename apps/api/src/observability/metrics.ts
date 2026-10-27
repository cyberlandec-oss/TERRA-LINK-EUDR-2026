import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

// RNF-13 — MÉTRICAS, en formato de exposición Prometheus, **sin salir del entorno**.
//
// `prom-client` es una biblioteca en proceso: acumula contadores en memoria y los imprime cuando alguien
// consulta `/metrics`. **No contrata ningún servicio, no abre ninguna conexión y no envía nada a terceros.**
// Lo que no se consulte, no se mueve de aquí.
//
// ETIQUETAS: el riesgo real de una métrica
// Una etiqueta con un identificador de persona o de recurso hace dos daños a la vez: filtra el dato y crea una
// serie temporal por cada valor (cardinalidad que tumba al recolector). Por eso aquí **solo** se etiqueta con
// valores de conjunto cerrado y acotado —método, **ruta saneada al patrón**, clase de estado, resultado— y
// cada ruta pasa por `rutaSegura()` antes de usarse.
//
// SIN OBJETIVOS INVENTADOS
// El histograma publica la **distribución observada**. Sus cortes son los de la biblioteca, no un presupuesto
// acordado: **no hay p95 comprometido, ni SLO, ni disponibilidad prometida**, porque TECH-001 sigue pendiente.
// Medir **no cierra RNF-05 ni RNF-06**: una medición no es un objetivo aprobado.

export const registro = new Registry();

registro.setDefaultLabels({ service: 'terra-link-api' });

/** Métricas del proceso: CPU, memoria, descriptores, retraso del bucle de eventos y GC. Sin datos de negocio. */
collectDefaultMetrics({ register: registro });

export const peticiones = new Counter({
  name: 'http_server_requests_total',
  help: 'Peticiones HTTP atendidas, por método, ruta (patrón saneado) y clase de estado.',
  labelNames: ['method', 'route', 'status_class'] as const,
  registers: [registro],
});

export const duracion = new Histogram({
  name: 'http_server_request_duration_seconds',
  help: 'Distribución OBSERVADA de la duración de las peticiones. No es un objetivo ni un presupuesto: TECH-001 sigue pendiente.',
  labelNames: ['method', 'route'] as const,
  registers: [registro],
});

export const consultas = new Counter({
  name: 'db_queries_total',
  help: 'Consultas a la base por operación (SELECT/INSERT/UPDATE/DELETE). Sin texto SQL ni valores.',
  labelNames: ['operation'] as const,
  registers: [registro],
});

export const duracionConsulta = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Distribución OBSERVADA de la duración de las consultas, por operación.',
  labelNames: ['operation'] as const,
  registers: [registro],
});

/**
 * Estado de la cola del outbox, **medido al recolectar**, no acumulado.
 *
 * Tiene que ser así: el worker corre en OTRO proceso y sus contadores en memoria no se podrían leer desde
 * `/metrics` de la API. Se consulta la tabla en el momento de la recolección, que además es el dato que
 * importa («cuántas hay ahora»), no cuántas hubo desde que arrancó este proceso.
 *
 * Sin atribución por organización: es salud de la cola, no actividad de un cliente.
 */
export const colaOutbox = new Gauge({
  name: 'outbox_deliveries',
  help: 'Entregas del outbox por estado en el momento de la recolección. Salud de la cola, sin atribución por organización.',
  labelNames: ['status'] as const,
  registers: [registro],
});

export const dependencias = new Gauge({
  name: 'dependency_up',
  help: 'Estado de cada dependencia evaluada: 1 responde, 0 no responde. Mismo origen que /health/ready y los avisos.',
  labelNames: ['dependency'] as const,
  registers: [registro],
});

/** Versión desplegada como métrica de valor 1: permite ver en el panel qué código produjo cada serie. */
export const version = new Gauge({
  name: 'build_info',
  help: 'Versión desplegada. Siempre 1; la información está en las etiquetas.',
  labelNames: ['version', 'migration'] as const,
  registers: [registro],
});

/** Solo para pruebas: deja los contadores a cero sin rehacer el registro. */
export function reiniciarMetricas(): void {
  registro.resetMetrics();
}
