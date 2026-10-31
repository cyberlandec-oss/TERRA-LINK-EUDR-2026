import { Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AuthorizationService } from '../authz/authorization.service';
import type { TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser } from '../auth/auth';
import { APP_CONFIG, type AppConfig } from '../config';
import { MAX_CHARS, MAX_MS_OPERACION, MAX_MS_TOTAL, MAX_PAGES, MAX_STREAM_BYTES, MOTOR, MOTOR_VERSION } from '../extraction/pdf-text';

// P1-015 — Límites y consumo (RF-46; parte «**límites … comprobados**» de `docs/18:216`).
//
// QUÉ ES, Y POR QUÉ NO INVENTA NADA
// Los límites **ya existen** en el producto: tamaño de archivo, cuota de la organización, tope de geometría,
// intentos de acceso, límites de procesamiento de la extracción… Lo que faltaba era **poder comprobarlos**.
// Este módulo los **lee de la configuración y del código vigentes** y los publica con:
//   · **qué limita** y **dónde se aplica**;
//   · **su valor y su unidad**;
//   · **de dónde sale** —variable de entorno o constante del código—, para poder contrastarlo;
//   · **cómo se comprueba**, es decir qué respuesta da el producto cuando se supera.
//
// **No fija ningún límite nuevo** y **no decide** ninguna tarifa: eso sería inventar. Los valores son los que
// el producto aplica hoy; si alguien los cambia por entorno, esta pantalla muestra el valor cambiado.
//
// CONSUMO
// Junto a los límites se publica el **consumo observado de la organización** —lo que ocupa y cuánto lleva
// registrado—, medido con consultas reales y con su denominador explícito. El consumo **no es un coste**: no
// hay ninguna tarifa acordada, y decirlo es parte del contrato (RF-46: «decisiones de **coste**» está abierto).

export type Idioma = 'es' | 'en';
export const IDIOMAS: Idioma[] = ['es', 'en'];

/**
 * Traducción de interfaz al inglés de los textos de cada límite. El español es la FUENTE (ADR-0007, opción B):
 * un límite sin traducción se muestra en español, nunca como clave. NO es una traducción jurídica certificada.
 */
const EN: Record<string, { label: string; what: string; enforced_at: string; on_exceed: string }> = {
  DOCUMENT_MAX_BYTES: { label: 'Maximum size of a document', what: 'Bytes a file may occupy when uploaded.', enforced_at: 'POST /documents and POST /documents/:id/versions', on_exceed: '422 FILE_TOO_LARGE, and the file is not stored.' },
  DOCUMENT_ORG_QUOTA_BYTES: { label: 'Storage quota per organization', what: 'Total bytes an organization may keep stored as documents.', enforced_at: 'POST /documents and POST /documents/:id/versions', on_exceed: '422 when the quota is exceeded: the upload is rejected.' },
  GEOJSON_MAX_BYTES: { label: 'Maximum size of a geometry', what: 'Bytes of an accepted GeoJSON.', enforced_at: 'Plot geometry creation and versions', on_exceed: '422: the geometry is rejected as a whole, never trimmed.' },
  GEOJSON_MAX_POSITIONS: { label: 'Maximum vertices of a geometry', what: 'Number of positions in a GeoJSON.', enforced_at: 'Geometry validation', on_exceed: '422: it is rejected, not simplified.' },
  LOGIN_RL_MAX_PER_ACCOUNT_IP: { label: 'Sign-in attempts per account and origin', what: 'Failed attempts allowed within the window before throttling.', enforced_at: 'POST /auth/login', on_exceed: '429 TOO_MANY_ATTEMPTS. Throttling is temporary, never permanent.' },
  JWT_TTL_SECONDS: { label: 'Session duration', what: 'Seconds of validity of the access token.', enforced_at: 'Every authenticated request', on_exceed: '401: you must sign in again.' },
  EXTRACTION_MAX_CHARS: { label: 'Maximum text extracted from a document', what: 'Characters the assisted extraction accumulates from a PDF.', enforced_at: 'POST /documents/:id/versions/:v/extraction', on_exceed: 'It is cut and the text is marked INCOMPLETE; it is never presented as complete.' },
  EXTRACTION_MAX_PAGES: { label: 'Maximum pages read from a PDF', what: 'Pages the assisted extraction goes through.', enforced_at: 'Assisted extraction', on_exceed: 'It is cut and declared incomplete.' },
  EXTRACTION_MAX_MS: { label: 'Maximum time to read a PDF', what: 'Per-operation and total time allowed for reading.', enforced_at: 'Assisted extraction', on_exceed: 'The operation is interrupted, the document is released and the result is declared incomplete.' },
  EXTRACTION_MAX_STREAM_BYTES: { label: 'Maximum bytes per decompressed stream', what: 'Size of a single stream after decompression.', enforced_at: 'Assisted extraction', on_exceed: 'That stream is skipped and the text is declared incomplete.' },
  EXTRACTION_ENGINE: { label: 'PDF reading engine', what: 'Local component that decodes the text layer, with its version.', enforced_at: 'Assisted extraction', on_exceed: 'If a composite font does not declare its character map: UNINTERPRETABLE_TEXT, with no text or suggestions.' },
};
const FUENTE_EN = (s: string) => s
  .replace('variables de entorno', 'environment variables').replace('variable de entorno', 'environment variable')
  .replace(' y ', ' and ').replace('constante del código', 'code constant').replace('dependencia fijada en package.json', 'dependency pinned in package.json');

interface Limite {
  code: string;
  label: string;
  /** Qué limita exactamente, en una frase. */
  what: string;
  value: number | string;
  unit: string;
  /** De dónde sale el valor: una variable de entorno o una constante del código. */
  source: string;
  /** Dónde se aplica, y qué pasa al superarlo: así se puede comprobar. */
  enforced_at: string;
  on_exceed: string;
}

@Injectable()
export class LimitsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly authz: AuthorizationService,
  ) {}

  private tiene(ctx: TenantContext, p: string) { return ctx.permissions.includes(p as never); }

  /** Los límites vigentes, leídos de la configuración y del código. Ninguno es inventado aquí. */
  private limites(): Limite[] {
    const c = this.config;
    return [
      {
        code: 'DOCUMENT_MAX_BYTES', label: 'Tamaño máximo de un documento',
        what: 'Bytes que puede ocupar un archivo al subirlo.',
        value: c.documents.maxBytes, unit: 'bytes', source: 'variable de entorno DOCUMENT_MAX_BYTES',
        enforced_at: 'POST /documents y POST /documents/:id/versions',
        on_exceed: '422 FILE_TOO_LARGE, y el archivo no se almacena.',
      },
      {
        code: 'DOCUMENT_ORG_QUOTA_BYTES', label: 'Cuota de almacenamiento por organización',
        what: 'Bytes totales que una organización puede tener almacenados en documentos.',
        value: c.documents.orgQuotaBytes, unit: 'bytes', source: 'variable de entorno DOCUMENT_ORG_QUOTA_BYTES',
        enforced_at: 'POST /documents y POST /documents/:id/versions',
        on_exceed: '422 al superar la cuota: la subida se rechaza.',
      },
      {
        code: 'GEOJSON_MAX_BYTES', label: 'Tamaño máximo de una geometría',
        what: 'Bytes de un GeoJSON aceptado.',
        value: c.geojson.maxBytes, unit: 'bytes', source: 'variable de entorno GEOJSON_MAX_BYTES',
        enforced_at: 'Alta y versiones de geometría de parcela',
        on_exceed: '422: la geometría se rechaza entera, no se recorta.',
      },
      {
        code: 'GEOJSON_MAX_POSITIONS', label: 'Vértices máximos de una geometría',
        what: 'Número de posiciones de un GeoJSON.',
        value: c.geojson.maxPositions, unit: 'posiciones', source: 'variable de entorno GEOJSON_MAX_POSITIONS',
        enforced_at: 'Validación de geometría', on_exceed: '422: se rechaza, no se simplifica.',
      },
      {
        code: 'LOGIN_RL_MAX_PER_ACCOUNT_IP', label: 'Intentos de acceso por cuenta y origen',
        what: 'Intentos fallidos admitidos en la ventana antes de frenar.',
        value: c.loginRateLimit.maxPerAccountAndIp, unit: `intentos / ${c.loginRateLimit.windowSeconds} s`,
        source: 'variables de entorno LOGIN_RL_MAX_PER_ACCOUNT_IP y LOGIN_RL_WINDOW_SECONDS',
        enforced_at: 'POST /auth/login',
        on_exceed: '429 TOO_MANY_ATTEMPTS. El freno es temporal, nunca permanente.',
      },
      {
        code: 'JWT_TTL_SECONDS', label: 'Duración de la sesión',
        what: 'Segundos de validez del testigo de acceso.',
        value: c.jwtTtlSeconds, unit: 'segundos', source: 'variable de entorno JWT_TTL_SECONDS',
        enforced_at: 'Toda petición autenticada', on_exceed: '401: hay que iniciar sesión otra vez.',
      },
      {
        code: 'EXTRACTION_MAX_CHARS', label: 'Texto máximo extraído de un documento',
        what: 'Caracteres que la extracción asistida acumula de un PDF.',
        value: MAX_CHARS, unit: 'caracteres', source: 'constante del código (extraction/pdf-text.ts)',
        enforced_at: 'POST /documents/:id/versions/:v/extraction',
        on_exceed: 'Se corta y se marca el texto como INCOMPLETO; nunca se presenta como completo.',
      },
      {
        code: 'EXTRACTION_MAX_PAGES', label: 'Páginas máximas leídas de un PDF',
        what: 'Páginas que la extracción asistida recorre.',
        value: MAX_PAGES, unit: 'páginas', source: 'constante del código (extraction/pdf-text.ts)',
        enforced_at: 'Extracción asistida', on_exceed: 'Se corta y se declara incompleto.',
      },
      {
        code: 'EXTRACTION_MAX_MS', label: 'Tiempo máximo de lectura de un PDF',
        what: 'Plazo por operación y plazo total de la lectura.',
        value: `${MAX_MS_OPERACION} por operación · ${MAX_MS_TOTAL} en total`, unit: 'milisegundos',
        source: 'constante del código (extraction/pdf-text.ts)',
        enforced_at: 'Extracción asistida',
        on_exceed: 'La operación se interrumpe, el documento se libera y el resultado se declara incompleto.',
      },
      {
        code: 'EXTRACTION_MAX_STREAM_BYTES', label: 'Bytes máximos por flujo descomprimido',
        what: 'Tamaño de un único flujo tras descomprimir.',
        value: MAX_STREAM_BYTES, unit: 'bytes', source: 'constante del código (extraction/pdf-text.ts)',
        enforced_at: 'Extracción asistida', on_exceed: 'Ese flujo se omite y el texto se declara incompleto.',
      },
      {
        code: 'EXTRACTION_ENGINE', label: 'Motor de lectura de PDF',
        what: 'Componente local que decodifica la capa de texto, con su versión.',
        value: `${MOTOR} ${MOTOR_VERSION}`, unit: 'componente local',
        source: 'dependencia fijada en package.json',
        enforced_at: 'Extracción asistida',
        on_exceed: 'Si una fuente compuesta no declara su mapa de caracteres: TEXTO_NO_INTERPRETABLE, sin texto ni sugerencias.',
      },
    ];
  }

  /** Consumo observado de la organización (compartido con la estimación de coste: un solo origen). */
  async consumoActual(orgId: string) {
    const docs = (await sql<{ n: number; bytes: string }>`
      SELECT count(*)::int AS n, coalesce(sum(v.size_bytes), 0)::text AS bytes
      FROM document_versions v WHERE v.organization_id = ${orgId}`.execute(this.db)).rows[0];
    const otros = (await sql<{ documentos: number; parcelas: number; entregas: number; eventos: number }>`
      SELECT (SELECT count(*)::int FROM documents WHERE organization_id = ${orgId}) AS documentos,
             (SELECT count(*)::int FROM plots WHERE organization_id = ${orgId}) AS parcelas,
             (SELECT count(*)::int FROM deliveries WHERE organization_id = ${orgId}) AS entregas,
             (SELECT count(*)::int FROM domain_events WHERE organization_id = ${orgId}) AS eventos`
      .execute(this.db)).rows[0];
    return {
      documents: otros.documentos, document_versions: docs.n, stored_bytes: Number(docs.bytes),
      quota_bytes: this.config.documents.orgQuotaBytes, plots: otros.parcelas, deliveries: otros.entregas, events: otros.eventos,
    };
  }

  async ver(user: AuthUser, orgId: string, lang: Idioma = 'es') {
    const ctx = await this.authz.require(user, orgId, 'organization:read', { mutation: false });

    const uso = await this.consumoActual(orgId);
    const en = lang === 'en';
    const limits = this.limites().map((l) => {
      const t = en ? EN[l.code] : undefined;
      return t ? { ...l, ...t, source: FUENTE_EN(l.source) } : l;
    });
    return {
      lang,
      limits,
      usage: {
        ...uso,
        quota_note: en
          ? `${uso.stored_bytes} of ${uso.quota_bytes} bytes. The denominator is the configured quota, not an estimate.`
          : `${uso.stored_bytes} de ${uso.quota_bytes} bytes. El denominador es la cuota configurada, no una estimación.`,
      },
      /** El idioma del producto, comprobable: RF-46 exige «español primero». */
      language: {
        primary: 'es',
        available: [...IDIOMAS],
        note: en
          ? 'Spanish is the source language and the fallback: any text without an English translation is shown in Spanish, never as a key. Interface translations are not certified legal translations; original documents and evidence are kept as they were submitted. See ADR-0007.'
          : 'El español es la lengua fuente y de reserva: un texto sin traducción al inglés se muestra en español, nunca como clave. Las traducciones de la interfaz no son traducciones jurídicas certificadas; los documentos y evidencias originales se conservan como se aportaron. Ver ADR-0007.',
      },
      /** Coste de la plataforma: tarifas declaradas, no precargadas. El consumo, por sí solo, no es dinero. */
      cost: {
        currency: 'USD', unit: 'ORGANIZACION_MES', endpoint: `/api/v1/organizations/${orgId}/platform-cost`,
        note: en
          ? 'Consumption is not money. A cost estimate needs a declared, versioned tariff with a validity period; without one the result is "no tariff", never zero. It is the cost of using the platform, distinct from the preparation budget (P1-010) and from the commercial price of cocoa.'
          : 'El consumo, por sí solo, no es dinero. Una estimación de coste necesita una tarifa declarada, versionada y con vigencia; sin ella el resultado es «sin tarifa», nunca cero. Es el coste de usar la plataforma, distinto del presupuesto de preparación (P1-010) y del precio comercial del cacao.',
      },
      cost_note: en
        ? 'Consumption is NOT a cost by itself. Platform cost estimates are computed from declared tariffs (D-54, ADR-0009) and never invoiced.'
        : 'El consumo NO es un coste por sí mismo. El coste estimado de la plataforma se calcula con tarifas declaradas (D-54, ADR-0009) y no se factura.',
      sso: {
        enabled: this.config.sso.enabled,
        method: 'OIDC Authorization Code + PKCE',
        local_login_kept: true,
      },
      sso_note: this.config.sso.enabled
        ? (en
          ? 'Federated sign-in (OIDC, Authorization Code with PKCE) is enabled for this deployment as a local rehearsal provider. Local password sign-in remains available. An external identity grants no organization, role or permission by itself.'
          : 'El acceso federado (OIDC, código de autorización con PKCE) está habilitado en este despliegue con un proveedor local de ensayo. El acceso con contraseña sigue disponible. Una identidad externa no concede por sí sola organización, rol ni permisos.')
        : (en
          ? 'Authentication is local (password and own token). Federated sign-in is implemented (OIDC with PKCE) but disabled in this deployment (SSO_ENABLED). No customer identity provider is connected.'
          : 'La autenticación es local (contraseña y testigo propio). El acceso federado está implementado (OIDC con PKCE) pero deshabilitado en este despliegue (SSO_ENABLED). No hay conectado ningún proveedor de identidad de un cliente.'),
      note: en
        ? 'Limits are read from the current configuration and code: if someone changes them by environment, the changed value is shown here. None is set on this screen. Exceeding a limit is rejected with an explanation; nothing is charged automatically.'
        : 'Los límites se leen de la configuración y del código vigentes: si alguien los cambia por entorno, aquí se ve el valor cambiado. Ninguno se fija en esta pantalla. Superar un límite se rechaza con una explicación; no se cobra nada automáticamente.',
      restricted: this.tiene(ctx, 'organization:read') ? [] : ['usage'],
    };
  }
}

@ApiTags('limits')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/limits')
export class LimitsController {
  constructor(private readonly service: LimitsService) {}

  @Get()
  @ApiOperation({ summary: 'Límites vigentes del producto y consumo observado de la organización' })
  @ApiQuery({ name: 'lang', required: false, enum: ['es', 'en'] })
  ver(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Query('lang') lang?: string) {
    return this.service.ver(u, o, lang === 'en' ? 'en' : 'es');
  }
}
