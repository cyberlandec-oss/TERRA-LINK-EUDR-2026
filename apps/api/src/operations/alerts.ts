import { Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { sql, type Kysely } from 'kysely';
import type Redis from 'ioredis';
import { CurrentUser, Public, type AuthUser } from '../auth/auth';
import { DB, LATEST_MIGRATION } from '../db/database';
import type { Database } from '../db/schema';
import { MALWARE_SCANNER, type MalwareScanner } from '../storage/scanner';
import { REDIS } from '../auth/login-rate-limit';
import { AuthorizationService } from '../authz/authorization.service';
import { notFound } from '../common/errors';

// RNF-10 — Avisos operativos verificables, **separados en dos respuestas distintas**.
//
// POR QUÉ DOS Y NO UNA (revisión del 2026-10-17)
// La primera versión publicaba en una ruta anónima el **recuento de versiones de documento sin análisis limpio**
// y el de **entregas DEAD**. Que no aparezcan nombres **no basta**: esos recuentos son actividad de documentos y
// de trabajos **de todas las organizaciones a la vez**, y un tercero sin autenticar podía observar su evolución.
// Un agregado sigue siendo información del recurso protegido.
//
//   · **PÚBLICO** (`GET /operations/alerts`): **salud de la infraestructura y nada más**. Conserva su contrato —
//     es el mismo material que `/health/ready` ya publica: si las dependencias del núcleo responden, si el
//     esquema aplicado coincide con el del código y si el escáner está disponible. **Ni un solo recuento de
//     recurso protegido, ningún identificador y ningún detalle por organización.**
//
//   · **RESTRINGIDO** (`GET /api/v1/organizations/:orgId/operations/alerts`): lo anterior **más** la actividad
//     operativa, **acotada a esa organización** y cada aviso gobernado por el permiso que **ya** regula ese dato:
//     `document:read` para los documentos pendientes y `events:reprocess` para las entregas DEAD —el mismo
//     permiso que faculta a reprocesarlas (P0-015)—. Sin el permiso, el aviso sale `RESTRICTED` **sin valor ni
//     recuento**, como ya hacen los indicadores de P0-030.
//
// **No se amplió la elevación D-04** ni se creó ningún permiso: se reutilizan `tenantContext()` y el catálogo
// RBAC existentes. La elevación de plataforma **no** abre esta ruta.
//
// QUÉ ES UN AVISO AQUÍ
// Cada uno tiene **condición comprobable**, **estado**, **lo observado**, **qué hacer** y una **recuperación
// reconocible**: cuando la condición deja de cumplirse, el aviso vuelve a `OK` solo.
//
// QUÉ NO SE INVENTA
// **No hay objetivos p95, de disponibilidad ni umbrales sin contrato**: TECH-001 sigue pendiente y sin él no hay
// nada que aprobar. Todos los avisos se apoyan en condiciones **ya definidas** en el producto.
//
// DEGRADACIÓN NO ES CAÍDA
// El escáner no disponible **no es un fallo de toda la API** ni se presenta como análisis limpio: los documentos
// quedan **pendientes**, la API sigue atendiendo y el aviso lo dice con `degradacion: true`. Solo las
// dependencias del **núcleo** (base, esquema, Redis) marcan indisponibilidad.

/** `RESTRICTED` = no se evalúa porque quien pregunta no tiene el permiso del dato. Nunca lleva valor. */
export type EstadoAviso = 'FIRING' | 'OK' | 'RESTRICTED';

export interface Aviso {
  code: string;
  state: EstadoAviso;
  /** Condición comprobable, redactada para que se pueda verificar a mano. */
  condition: string;
  /** Lo que se observó al evaluarla. En `RESTRICTED` declara el permiso que falta, nunca el dato. */
  observed: string;
  /** Qué hacer si está activo. Vacío cuando está en OK o reservado. */
  action: string | null;
  /** `true` cuando el servicio sigue atendiendo con capacidad reducida; `false` cuando es indisponibilidad. */
  degradacion: boolean;
}

export interface Dependencias {
  database: 'ok' | 'unavailable';
  schema: 'ok' | 'unavailable';
  redis: 'ok' | 'unavailable';
  scanner: 'ok' | 'unavailable';
  migration: string | null;
}

/**
 * Fuente ÚNICA del estado de dependencias: la usan `/health/ready` y los avisos, para que no puedan
 * contradecirse. Nunca lanza: una dependencia caída es un estado, no una excepción.
 */
export async function evaluarDependencias(
  db: Kysely<Database>,
  redis: Redis,
  scanner: MalwareScanner,
): Promise<Dependencias> {
  const d: Dependencias = { database: 'unavailable', schema: 'unavailable', redis: 'unavailable', scanner: 'unavailable', migration: null };
  try {
    const row = await sql<{ name: string }>`SELECT name FROM kysely_migration ORDER BY name DESC LIMIT 1`.execute(db);
    d.database = 'ok';
    d.migration = row.rows[0]?.name ?? null;
    if (d.migration === LATEST_MIGRATION) d.schema = 'ok';
  } catch { /* base no disponible */ }
  try {
    if ((await redis.ping()) === 'PONG') d.redis = 'ok';
  } catch { /* redis no disponible */ }
  try {
    if (scanner.ping ? await scanner.ping() : false) d.scanner = 'ok';
  } catch { /* escáner no disponible */ }
  return d;
}

/**
 * Avisos de INFRAESTRUCTURA. Es lo único que puede ver una petición anónima: el mismo material que
 * `/health/ready` ya publica. No consulta ninguna tabla de negocio, así que no puede revelar actividad.
 */
function avisosDeInfraestructura(dep: Dependencias): Aviso[] {
  const caidas = (['database', 'schema', 'redis'] as const).filter((k) => dep[k] !== 'ok');
  const desfase = dep.database === 'ok' && dep.migration !== LATEST_MIGRATION;
  const sinEscaner = dep.scanner !== 'ok';
  return [
    {
      code: 'CORE_DEPENDENCY_DOWN',
      state: caidas.length ? 'FIRING' : 'OK',
      condition: 'Alguna dependencia del núcleo (base de datos, esquema al día o Redis) no responde.',
      observed: caidas.length ? `sin responder: ${caidas.join(', ')}` : 'base de datos, esquema y Redis responden',
      action: caidas.length ? 'La API no puede atender con garantías: revisa esa dependencia antes de seguir operando.' : null,
      degradacion: false,
    },
    {
      code: 'SCHEMA_CODE_MISMATCH',
      state: desfase ? 'FIRING' : 'OK',
      condition: 'La última migración aplicada no coincide con la última que conoce el código desplegado, en cualquiera de los dos sentidos.',
      observed: dep.database === 'ok' ? `aplicada=${dep.migration ?? 'ninguna'} · esperada=${LATEST_MIGRATION}` : 'no evaluable: la base no responde',
      action: desfase ? 'Si el esquema va por detrás, aplica las migraciones pendientes. Si va por DELANTE —lo habitual tras un retorno de la aplicación—, el código desplegado no conoce ese esquema: vuelve a la versión que sí lo conoce o restaura datos coherentes con el código. Ver docs/20 §Retorno y recuperación.' : null,
      degradacion: false,
    },
    {
      code: 'DOCUMENT_ANALYSIS_UNAVAILABLE',
      state: sinEscaner ? 'FIRING' : 'OK',
      condition: 'El escáner antimalware no responde.',
      observed: sinEscaner ? 'escáner sin responder; el resto de la API sigue atendiendo' : 'escáner responde',
      action: sinEscaner ? 'Los documentos nuevos quedan con análisis PENDIENTE y no se habilitan. No se aprueban como limpios. Restablece el escáner y vuelve a analizarlos.' : null,
      degradacion: true,
    },
  ];
}

/** `ok`/`degraded`/`unavailable` a partir de los avisos. `RESTRICTED` no cuenta: no se concluye sobre lo que no se miró. */
function resumen(avisos: Aviso[]): 'ok' | 'degraded' | 'unavailable' {
  if (avisos.some((a) => a.state === 'FIRING' && !a.degradacion)) return 'unavailable';
  if (avisos.some((a) => a.state === 'FIRING' && a.degradacion)) return 'degraded';
  return 'ok';
}

/** Aviso reservado: declara el permiso que falta y **nunca** el dato. */
const reservado = (permiso: string): Pick<Aviso, 'state' | 'observed' | 'action'> => ({
  state: 'RESTRICTED',
  observed: `reservado: requiere el permiso ${permiso} en esta organización`,
  action: null,
});

const sinBase: Pick<Aviso, 'state' | 'observed' | 'action'> = {
  state: 'OK',
  observed: 'no evaluable: la base no responde',
  action: null,
};

@Injectable()
export class OperationsAlertsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    private readonly authz: AuthorizationService,
  ) {}

  /** PÚBLICO: salud de la infraestructura. No consulta ninguna tabla de negocio. */
  async publicos(): Promise<{ generated_at: string; scope: 'INFRASTRUCTURE'; status: 'ok' | 'degraded' | 'unavailable'; alerts: Aviso[] }> {
    const alerts = avisosDeInfraestructura(await evaluarDependencias(this.db, this.redis, this.scanner));
    return { generated_at: new Date().toISOString(), scope: 'INFRASTRUCTURE', status: resumen(alerts), alerts };
  }

  /** RESTRINGIDO: lo anterior más la actividad operativa **de esa organización**, permiso a permiso. */
  async deOrganizacion(user: AuthUser, orgId: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    const puede = (p: string) => (ctx.permissions as string[]).includes(p);
    const org = ctx.organizationId;

    const dep = await evaluarDependencias(this.db, this.redis, this.scanner);
    const alerts = avisosDeInfraestructura(dep);

    // Documentos sin análisis limpio, SOLO de esta organización y SOLO dentro del alcance de quien pregunta.
    //
    // `document:read` NO significa «todos los documentos de la organización»: el alcance real lo pone el
    // TITULAR del documento, y `DocumentsService.list()` lo aplica fila a fila con `producers.load()` /
    // `plots.load()`. Un técnico de campo tiene `document:read` pero solo `producer:read_assigned` y
    // `plot:read_assigned`: ve los documentos de SUS productores asignados, no los de la organización.
    // Publicar aquí el total organizacional por tener `document:read` sería una vía lateral para contar lo
    // que la lista le niega. El filtro de abajo es el MISMO predicado `inScope` de esos servicios.
    let documentos: Pick<Aviso, 'state' | 'observed' | 'action'>;
    const verProductores = puede('producer:read');
    const verProductoresAsignados = puede('producer:read_assigned');
    const verParcelas = puede('plot:read');
    const verParcelasAsignadas = puede('plot:read_assigned');
    const alcanceCompleto = verProductores && verParcelas;
    if (!puede('document:read')) documentos = reservado('document:read');
    else if (dep.database !== 'ok') documentos = sinBase;
    else {
      // Los documentos con titular `delivery` nunca son visibles todavía (`ENTITY_TYPE_NOT_AVAILABLE`), así
      // que tampoco se cuentan: contar lo que no se puede abrir sería informar de su existencia.
      const n = Number((await sql<{ n: string }>`
        SELECT count(*)::text AS n
        FROM document_versions dv
        JOIN documents d ON d.id = dv.document_id AND d.organization_id = dv.organization_id
        LEFT JOIN producers pp ON d.owner_type = 'producer' AND pp.id = d.owner_id AND pp.organization_id = d.organization_id
        LEFT JOIN plots pl ON d.owner_type = 'plot' AND pl.id = d.owner_id AND pl.organization_id = d.organization_id
        LEFT JOIN producers pr ON pr.id = pl.producer_id AND pr.organization_id = pl.organization_id
        WHERE dv.organization_id = ${org}
          AND NOT EXISTS (SELECT 1 FROM document_version_scans s WHERE s.version_id = dv.id AND s.result = 'CLEAN')
          AND (
            (d.owner_type = 'producer' AND pp.id IS NOT NULL
              AND (${verProductores} OR (${verProductoresAsignados} AND pp.assigned_membership_id = ${ctx.membershipId})))
            OR
            (d.owner_type = 'plot' AND pl.id IS NOT NULL
              AND (${verParcelas} OR (${verParcelasAsignadas} AND pr.assigned_membership_id = ${ctx.membershipId})))
          )`.execute(this.db)).rows[0].n);
      documentos = {
        state: n > 0 ? 'FIRING' : 'OK',
        observed: alcanceCompleto
          ? `${n} versión(es) sin análisis limpio`
          : `${n} versión(es) sin análisis limpio dentro de tu alcance`,
        action: n > 0 ? 'No se habilitan hasta tener análisis limpio. Si el escáner estuvo caído, vuelve a analizarlas; si alguna es INFECTED, no se habilita nunca.' : null,
      };
    }

    // Entregas DEAD del outbox, SOLO de esta organización: el permiso es el mismo que faculta a reprocesarlas.
    let entregas: Pick<Aviso, 'state' | 'observed' | 'action'>;
    if (!puede('events:reprocess')) entregas = reservado('events:reprocess');
    else if (dep.database !== 'ok') entregas = sinBase;
    else {
      const n = Number((await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM event_deliveries d
        JOIN domain_events e ON e.event_id = d.event_id
        WHERE d.status = 'DEAD' AND e.organization_id = ${org}`.execute(this.db)).rows[0].n);
      entregas = {
        state: n > 0 ? 'FIRING' : 'OK',
        observed: `${n} entrega(s) DEAD`,
        action: n > 0 ? 'Revisa la causa y reprocésalas desde el historial de eventos de esta organización. Reprocesar no duplica efectos: el consumo es idempotente.' : null,
      };
    }

    alerts.push(
      {
        code: 'DOCUMENTS_PENDING_ANALYSIS',
        condition: 'Hay versiones de documento sin un análisis antimalware limpio, dentro del alcance de lectura de quien pregunta (titular asignado incluido).',
        degradacion: true,
        ...documentos,
      },
      {
        code: 'EVENT_DELIVERIES_DEAD',
        condition: 'Hay entregas del outbox de esta organización en estado DEAD: agotaron sus reintentos y no se recuperan solas.',
        degradacion: true,
        ...entregas,
      },
    );
    return { generated_at: new Date().toISOString(), scope: 'ORGANIZATION' as const, organization_id: org, status: resumen(alerts), alerts };
  }
}

@ApiTags('Operación')
@Controller('operations')
export class OperationsAlertsController {
  constructor(private readonly service: OperationsAlertsService) {}

  @Public()
  @Get('alerts')
  @ApiOperation({
    summary: 'Salud de la infraestructura (RNF-10, respuesta pública mínima)',
    description:
      'Respuesta ANÓNIMA mínima: solo salud de la infraestructura —dependencias del núcleo, esquema aplicado ' +
      'frente al del código y disponibilidad del escáner—, el mismo material que `/health/ready` ya publica. ' +
      'No consulta tablas de negocio: **sin recuentos de recursos protegidos, sin identificadores y sin detalle ' +
      'por organización**. La actividad operativa está en la ruta por organización, con sus permisos. ' +
      'Distingue DEGRADACIÓN (200) de INDISPONIBILIDAD (503). Sin objetivos p95 ni umbrales sin contrato.',
  })
  async alerts(@Res({ passthrough: true }) res: Response) {
    const r = await this.service.publicos();
    // 503 solo cuando el núcleo está caído: una degradación responde 200, como `/health/ready`.
    if (r.status === 'unavailable') res.status(503);
    return r;
  }
}

@ApiTags('Operación')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/operations')
export class OperationsOrgAlertsController {
  constructor(private readonly service: OperationsAlertsService) {}

  @Get('alerts')
  @ApiOperation({
    summary: 'Avisos operativos de la organización (RNF-10, respuesta restringida)',
    description:
      'Salud de la infraestructura **más** la actividad operativa acotada a esta organización. Cada aviso de ' +
      'actividad exige el permiso que ya gobierna ese dato (`document:read`, `events:reprocess`); sin él sale ' +
      '`RESTRICTED`, **sin valor ni recuento**. No requiere ni admite elevación de plataforma.',
  })
  async alerts(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.deOrganizacion(user, orgId);
    if (r.status === 'unavailable') res.status(503);
    return r;
  }
}
