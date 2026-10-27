import { CallHandler, Controller, ExecutionContext, Get, Inject, Injectable, NestInterceptor, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Observable, type Subscription } from 'rxjs';
import { sql, type Kysely } from 'kysely';
import type Redis from 'ioredis';
import { CurrentUser, Public, type AuthUser, type AuthedRequest } from '../auth/auth';
import { AuthorizationService } from '../authz/authorization.service';
import { DB, LATEST_MIGRATION } from '../db/database';
import type { Database } from '../db/schema';
import { MALWARE_SCANNER, type MalwareScanner } from '../storage/scanner';
import { REDIS } from '../auth/login-rate-limit';
import { evaluarDependencias } from '../operations/alerts';
import { claseEstado, rutaSegura } from './sanitize';
import { colaOutbox, dependencias, duracion, peticiones, registro, version as buildInfo } from './metrics';
import { cerrarTraza, claseDeError, ejecutarConTraza, trazaPorId, trazasRecientes } from './tracing';

// RNF-13 (S1 §77) — `/version`, `/metrics` y el recorrido de trazas.
//
// QUIÉN VE QUÉ, Y POR QUÉ
//   · **`/version` es público**, como `/health` y `/ready`: la fuente lo pone junto a ellos. Publica el
//     servicio, su versión y la migración que el código conoce —lo mismo que `/health/ready` ya devolvía—.
//     **El commit desplegado NO se publica aquí**: identifica el código exacto y no hace falta para saber si
//     el servicio responde. Se sirve en la ruta restringida, que es donde lo necesita quien opera.
//   · **`/metrics` y las trazas son restringidos** (`observability:read`, permiso de PLATAFORMA). El motivo es
//     el mismo que separó los avisos: aunque las etiquetas estén saneadas, el **volumen por ruta** es
//     actividad agregada de todas las organizaciones, y eso no se publica a una petición anónima.
//
// **No amplía la elevación D-04 ni la necesita**: lo que se sirve aquí es infraestructura saneada, nunca datos
// de una organización. Un SUPER_ADMIN sigue sin poder leer miembros, productores ni documentos por esta vía.

export const INICIO_PROCESO = new Date();
export const VERSION_SERVICIO = process.env.npm_package_version ?? '0.1.0';

/**
 * Revisión del código DESPLEGADO, inyectada en el artefacto al construirlo (`ARG APP_COMMIT`).
 * No es una etiqueta escrita a mano: la calcula `scripts/desplegar.mjs` con `git rev-parse`. Si se construyó
 * sin ella, se declara como no inyectada en vez de inventar un valor o callar.
 */
export const COMMIT_DESPLEGADO: string | null = (process.env.APP_COMMIT ?? '').trim() || null;

buildInfo.labels(VERSION_SERVICIO, LATEST_MIGRATION).set(1);

/**
 * Instrumenta TODAS las peticiones: una métrica y una traza por cada una, con la ruta saneada al patrón.
 *
 * El identificador de traza es el `request_id` que el middleware ya puso: desde una fila de `audit_logs` o
 * desde el `request_id` que recibió una persona en un error se llega a la traza sin inventar otra clave.
 */
@Injectable()
export class ObservabilityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<AuthedRequest & { route?: { path?: string }; method: string; originalUrl?: string; url: string }>();
    const res = http.getResponse<Response>();
    const inicio = Date.now();
    const metodo = req.method;
    const traceId = req.requestId ?? 'sin-correlacion';

    // La ruta se toma del PATRÓN de Express cuando existe; y aun así pasa por el saneador, para que un
    // camino nuevo no pueda colar un identificador como etiqueta.
    const patron = () => rutaSegura(req.route?.path ? String(req.route.path) : (req.originalUrl ?? req.url));

    const terminar = (status: 'OK' | 'ERROR', codigo: number, kind?: string) => {
      const ruta = patron();
      const segundos = (Date.now() - inicio) / 1000;
      peticiones.labels(metodo, ruta, claseEstado(codigo)).inc();
      duracion.labels(metodo, ruta).observe(segundos);
      cerrarTraza(`${metodo} ${ruta}`, inicio, status, {
        'http.method': metodo,
        'http.route': ruta,
        'http.status': codigo,
        'http.status_class': claseEstado(codigo),
        ...(kind ? { 'error.kind': kind } : {}),
      });
    };

    // La suscripción ocurre DENTRO del contexto: así el manejador y todo su trabajo asíncrono lo heredan.
    return new Observable((sub) => {
      let interna: Subscription | undefined;
      ejecutarConTraza(traceId, () => {
        interna = next.handle().subscribe({
          next: (v) => sub.next(v),
          error: (e) => {
            // El filtro global decide el estado; aquí solo se mide la CLASE del error, nunca su mensaje.
            terminar('ERROR', (e as { status?: number })?.status ?? 500, claseDeError(e));
            sub.error(e);
          },
          complete: () => {
            terminar('OK', res.statusCode, undefined);
            sub.complete();
          },
        });
      });
      return () => interna?.unsubscribe();
    });
  }
}

@ApiTags('health')
@Controller('version')
export class VersionController {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Versión desplegada (S1 §77)',
    description:
      'Público, como `/health` y `/ready`. Identifica el código DESPLEGADO: servicio, versión, revisión ' +
      'inyectada al construir el artefacto y migración que ese código conoce. Una revisión no es un secreto, ' +
      'y sin ella `/version` no identificaría lo que está corriendo. Si no se inyectó, se declara así.',
  })
  async version() {
    let aplicada: string | null = null;
    try {
      aplicada = (await sql<{ name: string }>`SELECT name FROM kysely_migration ORDER BY name DESC LIMIT 1`.execute(this.db)).rows[0]?.name ?? null;
    } catch { /* la base no responde: /health/ready es quien lo informa */ }
    return {
      service: 'terra-link-api',
      version: VERSION_SERVICIO,
      commit: COMMIT_DESPLEGADO,
      commit_source: COMMIT_DESPLEGADO ? 'BUILD_ARG' : 'NOT_INJECTED',
      schema: { known_by_code: LATEST_MIGRATION, applied: aplicada },
      started_at: INICIO_PROCESO.toISOString(),
    };
  }
}

@ApiTags('Observabilidad')
@ApiBearerAuth()
@Controller()
export class ObservabilityController {
  constructor(
    private readonly authz: AuthorizationService,
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  @Get('metrics')
  @ApiOperation({
    summary: 'Métricas en formato Prometheus (RNF-13)',
    description:
      'Restringido a `observability:read` (plataforma). Etiquetas de conjunto cerrado: método, **ruta en ' +
      'patrón saneado**, clase de estado y operación. Sin identificadores de persona ni de recurso, sin texto ' +
      'SQL y sin datos de ninguna organización. El histograma publica la distribución OBSERVADA: no hay p95 ' +
      'comprometido ni SLO, porque TECH-001 sigue pendiente.',
  })
  async metrics(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    this.authz.requirePlatform(user, 'observability:read');
    // El estado de dependencias se refresca al recolectar, desde la MISMA fuente que /health/ready y los avisos.
    const dep = await evaluarDependencias(this.db, this.redis, this.scanner);
    for (const d of ['database', 'schema', 'redis', 'scanner'] as const) dependencias.labels(d).set(dep[d] === 'ok' ? 1 : 0);
    // Cola del outbox: se mide AHORA, porque el worker corre en otro proceso. Sin atribución por organización.
    if (dep.database === 'ok') {
      colaOutbox.reset();
      const filas = await sql<{ status: string; n: string }>`SELECT status, count(*)::text AS n FROM event_deliveries GROUP BY status`.execute(this.db);
      for (const f of filas.rows) colaOutbox.labels(f.status).set(Number(f.n));
    }
    res.setHeader('Content-Type', registro.contentType);
    return registro.metrics();
  }

  @Get('api/v1/observability/traces')
  @ApiOperation({
    summary: 'Trazas recientes (RNF-13)',
    description:
      'Restringido a `observability:read`. Anillo acotado EN MEMORIA del proceso: se pierde al reiniciar y no ' +
      'se comparte con el worker. El identificador de traza es el `request_id` ya existente, de modo que desde ' +
      'una fila de bitácora o desde el error que vio una persona se llega al recorrido completo.',
  })
  traces(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    this.authz.requirePlatform(user, 'observability:read');
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const trazas = trazasRecientes(n);
    return {
      storage: 'IN_MEMORY_RING',
      capacity: 200,
      note: 'Trazas del proceso de la API. No persistidas, no exportadas a ningún servicio externo.',
      traces: trazas.map((t) => ({ trace_id: t.trace_id, name: t.name, started_at: t.started_at, duration_ms: t.duration_ms, status: t.status, spans: t.spans.length })),
    };
  }

  @Get('api/v1/observability/traces/:traceId')
  @ApiOperation({ summary: 'Recorrido completo de una traza (RNF-13)', description: 'Restringido a `observability:read`. Tramos encadenados con su duración y atributos de lista blanca.' })
  trace(@CurrentUser() user: AuthUser, @Param('traceId') traceId: string) {
    this.authz.requirePlatform(user, 'observability:read');
    // Se VALIDA el formato de correlación, no se sanea: sanear la clave de búsqueda la convertiría en otra y
    // nunca encontraría la traza. El patrón es el MISMO que acepta el middleware de `X-Request-Id`.
    if (!/^[\w-]{8,64}$/.test(traceId)) return { trace_id: null, found: false, note: 'Identificador de correlación con formato no válido.' };
    const t = trazaPorId(traceId);
    if (!t) return { trace_id: null, found: false, note: 'No está en el anillo: pudo caducar o pertenecer a otro proceso.' };
    return { found: true, ...t };
  }

  @Get('api/v1/observability/build')
  @ApiOperation({ summary: 'Código desplegado (RNF-13)', description: 'Restringido a `observability:read`: el commit exacto no se publica en `/version`.' })
  build(@CurrentUser() user: AuthUser) {
    this.authz.requirePlatform(user, 'observability:read');
    return {
      service: 'terra-link-api',
      version: VERSION_SERVICIO,
      commit: COMMIT_DESPLEGADO,
      commit_source: COMMIT_DESPLEGADO ? 'BUILD_ARG' : 'NOT_INJECTED',
      migration_known_by_code: LATEST_MIGRATION,
      started_at: INICIO_PROCESO.toISOString(),
      node: process.version,
    };
  }
}
