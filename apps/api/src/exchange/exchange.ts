import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import type { Response } from 'express';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, notFound } from '../common/errors';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_XLSX_LIMITS, XlsxError, readXlsx, writeXlsx } from '../imports/xlsx';

// P1-006 — Intercambio con GUIA/Agrocalidad (RF-37; S2 §29; S3 §§14, 19; docs/15).
//
// POR QUÉ ESTO ES UN INTERCAMBIO POR ARCHIVO Y NO UNA INTEGRACIÓN
// S3 §14 trata a GUIA como **infraestructura**, no como competidor, y §19 pide «importar / sincronizar los
// datos que ya existen» en vez de volver a pedirlos. Pero **RF-37 condiciona**: «**solo canal/acuerdo
// comprobados**», y `docs/15` registra la integración como **PROPUESTA**, con la condición «acuerdo/canal
// oficial o formato autorizado; **no asumir API disponible**».
//
// Hoy **no hay canal, acuerdo ni formato oficial en mano**. Así que aquí **no hay ninguna llamada de red**:
// el intercambio es **por archivo** —el *fallback* que la propia historia pide— y está **cerrado tras una
// compuerta** que la organización **no puede abrirse a sí misma**.
//
// D-50 (ADOPTADA para desarrollo local, 2026-10-18): el **formato de intercambio** es propio, versionado y
// **declarado NO OFICIAL**, con su **mapeo explícito a los cinco elementos** que la guía ecuatoriana enumera
// (ubicación geográfica, identificación del operador, producto, volumen, movimientos). Cuando exista un
// formato autorizado, se añade otra versión: por eso cada acto guarda **con qué versión se hizo**.
//
// LO QUE NO HACE, A PROPÓSITO
//   · **No envía nada a ningún servicio externo.** Exportar produce un archivo que descarga una persona.
//   · **No exporta geometrías ni documentos de identidad.** El formato v1 no los incluye y lo dice; incluirlos
//     sería otra decisión, con otra base legal.
//   · **Conciliar no escribe** en los datos operativos. Produce diferencias; aceptar una deja constancia de que
//     hay que corregirla **por el caso de uso del dominio**, auditada como cualquier corrección.
//   · **No acredita nada jurídico.** Que GUIA registre a un operador no prueba legalidad (eso es P1-005).

/** Formato de intercambio. NO es una especificación de GUIA: es la propuesta de Terra Link. */
export const FORMATO = {
  version: '1.0.0-no-oficial',
  sheet: 'operadores',
  official: false,
  note: 'Formato propuesto por Terra Link, NO una especificación de GUIA/Agrocalidad. Cuando exista un formato '
    + 'autorizado se publicará otra versión; cada acto guarda con cuál se hizo.',
  /** Cada columna, con el elemento de la guía ecuatoriana al que corresponde. */
  fields: [
    { header: 'codigo_operador', element: 'Identificación del operador', note: 'Código del productor en Terra Link. No es el identificador de GUIA.' },
    { header: 'nombre_operador', element: 'Identificación del operador', note: 'Nombre autorizado o razón social.' },
    { header: 'provincia', element: 'Ubicación geográfica', note: 'Ubicación administrativa declarada. NO son coordenadas.' },
    { header: 'canton', element: 'Ubicación geográfica', note: 'Ubicación administrativa declarada.' },
    { header: 'parroquia', element: 'Ubicación geográfica', note: 'Ubicación administrativa declarada.' },
    { header: 'parcelas', element: 'Objeto de producción', note: 'Cuántas parcelas activas tiene. Sin geometrías.' },
  ],
  excluded: [
    'Geometrías y coordenadas de parcelas: no se exportan. Enviarlas exigiría otra decisión y otra base legal.',
    'Documento de identidad del productor: no se exporta en esta versión.',
    'Volumen y movimientos: la guía los enumera, pero su intercambio no está acordado y no se incluye.',
  ],
} as const;

const CLAVES = FORMATO.fields.map((f) => f.header);
/** Campos que se comparan al conciliar. El código es la clave, no un campo comparable. */
const COMPARABLES = ['nombre_operador', 'provincia', 'canton', 'parroquia'] as const;

const MAX_BYTES = 5 * 1024 * 1024;

class AcuerdoDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ enum: ['GUIA_AGROCALIDAD'] }) @IsIn(['GUIA_AGROCALIDAD']) counterpart!: 'GUIA_AGROCALIDAD';
  @ApiProperty() @IsString() @Length(3, 200) reference!: string;
  @ApiProperty({ description: 'Qué se intercambia, declarado por quien firma' }) @IsString() @Length(3, 1000) scope!: string;
  @ApiProperty() @IsISO8601() valid_from!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() valid_to?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() document_version_id?: string;
}
class DecisionAcuerdoDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ enum: ['VERIFY', 'WITHDRAW'] }) @IsIn(['VERIFY', 'WITHDRAW']) decision!: 'VERIFY' | 'WITHDRAW';
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
class DecisionDiferenciaDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ enum: ['ACCEPT_EXTERNAL', 'KEEP_OURS', 'NEEDS_REVIEW'] })
  @IsIn(['ACCEPT_EXTERNAL', 'KEEP_OURS', 'NEEDS_REVIEW']) decision!: 'ACCEPT_EXTERNAL' | 'KEEP_OURS' | 'NEEDS_REVIEW';
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
interface SubidaXlsx { buffer: Buffer; originalname?: string; size?: number }

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
/** Columna DATE de pg (Date local o texto) → AAAA-MM-DD, sin desplazamiento de zona. */
const ymd = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};
/** Igualdad tolerante a mayúsculas y espacios: una diferencia de formato no es una discrepancia. */
const igual = (a: string, b: string) => a.toLocaleLowerCase('es') === b.toLocaleLowerCase('es');

@Injectable()
export class ExchangeService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  /** Lectura: exige el permiso sin bloquear por suspensión (el historial se sigue pudiendo consultar). */
  private leer(user: AuthUser, orgId: string, permiso: Permission): Promise<TenantContext> {
    return this.authz.require(user, orgId, permiso, { mutation: false });
  }
  /** Escritura: además, una organización suspendida no admite nuevas operaciones. */
  private escribir(user: AuthUser, orgId: string, permiso: Permission): Promise<TenantContext> {
    return this.authz.require(user, orgId, permiso, { mutation: true });
  }

  /**
   * El acuerdo **vigente y verificado**, o `null`. Append-only: el estado sale de la última decisión, no de
   * una columna que alguien pueda sobrescribir.
   */
  private async acuerdoVigente(orgId: string) {
    const r = await sql<{ id: string; reference: string; scope: string; valid_from: string; valid_to: string | null; estado: string | null; verificado_el: string | null }>`
      SELECT a.id, a.reference, a.scope, a.valid_from::text, a.valid_to::text,
             d.decision AS estado, d.decided_at::text AS verificado_el
      FROM exchange_agreements a
      LEFT JOIN LATERAL (
        SELECT decision, decided_at FROM exchange_agreement_decisions
        WHERE agreement_id = a.id ORDER BY decided_at DESC, id DESC LIMIT 1) d ON TRUE
      WHERE a.organization_id = ${orgId}
        AND a.valid_from <= current_date AND (a.valid_to IS NULL OR a.valid_to >= current_date)
        AND d.decision = 'VERIFY'
      ORDER BY a.created_at DESC LIMIT 1`.execute(this.db);
    return r.rows[0] ?? null;
  }

  /** Compuerta: sin acuerdo verificado y vigente no se exporta ni se concilia. */
  private async exigirCanal(orgId: string) {
    const a = await this.acuerdoVigente(orgId);
    if (!a) {
      throw conflict('EXCHANGE_CHANNEL_NOT_VERIFIED',
        'No hay un acuerdo de intercambio verificado y vigente. RF-37 solo admite canal o acuerdo comprobados: '
        + 'registrar el acuerdo no basta, y una organización no verifica su propio canal.');
    }
    return a;
  }

  async formato() {
    return {
      ...FORMATO,
      elements_source: 'Guía de trazabilidad ecuatoriana, citada en S3: ubicación geográfica, identificación del operador, producto, volumen y movimientos/transacciones.',
      warning: 'Este formato NO está autorizado por GUIA/Agrocalidad. Terra Link no asume ninguna API disponible '
        + 'y no envía datos a ningún servicio externo: el intercambio es por archivo.',
    };
  }

  // ---------------------------------------------------------------- acuerdo
  async registrar(user: AuthUser, orgId: string, dto: AcuerdoDto, requestId?: string) {
    await this.escribir(user, orgId, 'exchange:manage');
    if (dto.valid_to && dto.valid_to < dto.valid_from) {
      throw new AppError(422, 'AGREEMENT_PERIOD_INVALID', 'La vigencia termina antes de empezar.', [{ field: 'valid_to', reason: 'AGREEMENT_PERIOD_INVALID' }]);
    }
    if (dto.document_version_id) {
      const d = await this.db.selectFrom('document_versions as v').innerJoin('documents as d', 'd.id', 'v.document_id')
        .select('v.id').where('v.id', '=', dto.document_version_id).where('d.organization_id', '=', orgId).executeTakeFirst();
      if (!d) throw notFound();
    }
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('exchange_agreements').values({
        id, organization_id: orgId, counterpart: dto.counterpart, reference: dto.reference.trim(),
        scope: dto.scope.trim(), valid_from: dto.valid_from.slice(0, 10),
        valid_to: dto.valid_to ? dto.valid_to.slice(0, 10) : null,
        document_version_id: dto.document_version_id ?? null, created_by: user.id, operation_id: dto.operation_id,
      } as never).execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'exchange.agreement_registered',
        entityType: 'exchange_agreement', entityId: id, requestId, result: 'SUCCESS',
        after: { counterpart: dto.counterpart, reference: dto.reference.trim(), valid_from: dto.valid_from.slice(0, 10) },
      });
    });
    return this.vista(orgId, id);
  }

  async decidirAcuerdo(user: AuthUser, orgId: string, id: string, dto: DecisionAcuerdoDto, requestId?: string) {
    // Verificar el canal es de PLATAFORMA; retirarlo lo puede hacer la organización.
    if (dto.decision === 'VERIFY') {
      this.authz.requirePlatform(user, 'exchange:verify');
    } else {
      await this.escribir(user, orgId, 'exchange:manage');
    }

    const a = await this.db.selectFrom('exchange_agreements').selectAll()
      .where('id', '=', id).where('organization_id', '=', orgId).executeTakeFirst();
    if (!a) throw notFound();

    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('exchange_agreement_decisions').values({
        id: randomUUID(), organization_id: orgId, agreement_id: id, decision: dto.decision,
        reason: dto.reason.trim(), decided_by: user.id, operation_id: dto.operation_id,
      } as never).execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id,
        action: dto.decision === 'VERIFY' ? 'exchange.channel_verified' : 'exchange.agreement_withdrawn',
        entityType: 'exchange_agreement', entityId: id, requestId, result: 'SUCCESS',
        after: { decision: dto.decision, reason: dto.reason.trim() },
      });
    });
    return this.vista(orgId, id);
  }

  async acuerdo(user: AuthUser, orgId: string, id: string) {
    await this.leer(user, orgId, 'exchange:use');
    return this.vista(orgId, id);
  }

  /**
   * Vista del acuerdo **sin autorización propia**: la decide quien llama.
   *
   * Hace falta separarla porque **quien verifica el canal es la plataforma**, que no es miembro de la
   * organización y por tanto no tiene `exchange:use`. Lo que ve aquí es el acuerdo —su referencia, su alcance
   * declarado y sus decisiones—, que es el artefacto de gobierno que tiene que comprobar; **no** datos
   * operativos de la organización, a los que la administración de plataforma sigue sin tener acceso (D-04).
   */
  private async vista(orgId: string, id: string) {
    const a = await this.db.selectFrom('exchange_agreements').selectAll()
      .where('id', '=', id).where('organization_id', '=', orgId).executeTakeFirst();
    if (!a) throw notFound();
    const decisiones = await this.db.selectFrom('exchange_agreement_decisions as d')
      .leftJoin('users as u', 'u.id', 'd.decided_by')
      .select(['d.decision', 'd.reason', 'd.decided_at', 'u.first_name', 'u.last_name'])
      .where('d.agreement_id', '=', id).orderBy('d.decided_at', 'desc').execute();
    const ultima = decisiones[0]?.decision ?? null;
    const ahora = new Date();
    const hoy = ymd(ahora)!;
    const desde = ymd(a.valid_from)!;
    const hasta = ymd(a.valid_to);
    const vigente = desde <= hoy && (!hasta || hasta >= hoy);
    return {
      id: a.id, counterpart: a.counterpart, reference: a.reference, scope: a.scope,
      valid_from: desde, valid_to: hasta,
      document_version_id: a.document_version_id,
      status: ultima === 'VERIFY' ? (vigente ? 'VERIFICADO_VIGENTE' : 'VERIFICADO_NO_VIGENTE') : ultima === 'WITHDRAW' ? 'RETIRADO' : 'REGISTRADO',
      can_exchange: ultima === 'VERIFY' && vigente,
      decisions: decisiones.map((d) => ({
        decision: d.decision, reason: d.reason, at: d.decided_at,
        by: `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim() || 'Miembro',
      })),
      note: 'Registrar el acuerdo no habilita el intercambio: hace falta que la administración de plataforma lo '
        + 'verifique y que esté vigente (RF-37: «solo canal/acuerdo comprobados»).',
    };
  }

  async acuerdos(user: AuthUser, orgId: string) {
    await this.leer(user, orgId, 'exchange:use');
    const filas = await this.db.selectFrom('exchange_agreements').select(['id'])
      .where('organization_id', '=', orgId).orderBy('created_at', 'desc').execute();
    return { agreements: await Promise.all(filas.map((f) => this.vista(orgId, f.id))) };
  }

  // ---------------------------------------------------------------- padrón propio
  private async padron(orgId: string) {
    const r = await sql<{ codigo_operador: string; nombre_operador: string; provincia: string; canton: string; parroquia: string; parcelas: string; id: string }>`
      SELECT p.id, p.producer_code AS codigo_operador,
             coalesce(nullif(btrim(p.legal_name), ''), btrim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,''))) AS nombre_operador,
             coalesce(p.province,'') AS provincia, coalesce(p.canton,'') AS canton, coalesce(p.parish,'') AS parroquia,
             (SELECT count(*) FROM plots pl WHERE pl.producer_id = p.id AND pl.organization_id = p.organization_id AND pl.status = 'ACTIVE')::text AS parcelas
      FROM producers p
      WHERE p.organization_id = ${orgId} AND p.status = 'ACTIVE'
      ORDER BY p.producer_code`.execute(this.db);
    return r.rows;
  }

  async exportar(user: AuthUser, orgId: string, requestId?: string) {
    await this.escribir(user, orgId, 'exchange:use');
    const acuerdo = await this.exigirCanal(orgId);
    const filas = await this.padron(orgId);
    const cuerpo = filas.map((f) => CLAVES.map((k) => texto((f as Record<string, unknown>)[k])));
    const bytes = writeXlsx([
      { name: FORMATO.sheet, rows: [[...CLAVES], ...cuerpo], widths: CLAVES.map((k) => Math.max(16, k.length + 4)) },
      {
        name: 'formato',
        rows: [
          ['campo', 'elemento de la guía', 'nota'],
          ...FORMATO.fields.map((f) => [f.header, f.element, f.note]),
          [''], ['versión del formato', FORMATO.version, 'NO OFICIAL'],
          ['advertencia', FORMATO.note, ''],
          ...FORMATO.excluded.map((e) => ['excluido', e, '']),
        ],
      },
    ]);
    const hash = sha256(bytes);
    const actId = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('exchange_acts').values({
        id: actId, organization_id: orgId, agreement_id: acuerdo.id, kind: 'EXPORT',
        format_version: FORMATO.version, row_count: filas.length, content_hash: hash,
        summary: JSON.stringify({ fields: CLAVES, excluded: FORMATO.excluded }),
        performed_by: user.id, operation_id: randomUUID(),
      } as never).execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'exchange.exported',
        entityType: 'exchange_act', entityId: actId, requestId, result: 'SUCCESS',
        after: { agreement_id: acuerdo.id, rows: filas.length, format_version: FORMATO.version, content_hash: hash },
      });
    });
    return { bytes, filename: `intercambio-operadores-${new Date().toISOString().slice(0, 10)}.xlsx`, actId, hash, rows: filas.length };
  }

  // ---------------------------------------------------------------- conciliación
  async conciliar(user: AuthUser, orgId: string, file: SubidaXlsx | undefined, requestId?: string) {
    await this.escribir(user, orgId, 'exchange:use');
    const acuerdo = await this.exigirCanal(orgId);
    if (!file?.buffer?.length) throw new AppError(400, 'FILE_REQUIRED', 'Adjunta el archivo de la contraparte.', [{ field: 'file', reason: 'FILE_REQUIRED' }]);
    if (file.buffer.length > MAX_BYTES) throw new AppError(422, 'FILE_TOO_LARGE', 'El archivo supera el tamaño admitido.', [{ field: 'file', reason: 'FILE_TOO_LARGE' }]);

    let hoja;
    try {
      hoja = readXlsx(file.buffer, FORMATO.sheet, DEFAULT_XLSX_LIMITS);
    } catch (e) {
      if (e instanceof XlsxError) throw new AppError(422, e.code, e.message, [{ field: 'file', reason: e.code }]);
      throw e;
    }
    const cabecera = (hoja.rows[0]?.cells ?? []).map((c) => texto(c?.value).toLowerCase());
    const faltan = CLAVES.filter((k) => !cabecera.includes(k));
    if (faltan.length) {
      throw new AppError(422, 'EXCHANGE_HEADERS_MISSING',
        `El archivo no trae las columnas del formato ${FORMATO.version}: faltan ${faltan.join(', ')}.`,
        faltan.map((f) => ({ field: f, reason: 'EXCHANGE_HEADERS_MISSING' })));
    }
    const indice = Object.fromEntries(CLAVES.map((k) => [k, cabecera.indexOf(k)]));
    const externos = new Map<string, Record<string, string>>();
    for (const fila of hoja.rows.slice(1)) {
      const valor = (k: string) => texto(fila.cells[indice[k]]?.value);
      const clave = valor('codigo_operador');
      if (!clave) continue;      // una fila sin clave no identifica a nadie: no se inventa una
      externos.set(clave, Object.fromEntries(CLAVES.map((k) => [k, valor(k)])));
    }

    const propios = await this.padron(orgId);
    const porCodigo = new Map(propios.map((p) => [p.codigo_operador, p]));
    const diferencias: Array<{ external_key: string; entity_id: string | null; kind: string; field: string | null; external_value: string | null; our_value: string | null }> = [];
    let coincidencias = 0;

    for (const [clave, ext] of externos) {
      const propio = porCodigo.get(clave);
      if (!propio) {
        diferencias.push({ external_key: clave, entity_id: null, kind: 'ONLY_EXTERNAL', field: null, external_value: ext.nombre_operador || null, our_value: null });
        continue;
      }
      let iguales = true;
      for (const campo of COMPARABLES) {
        const a = texto(ext[campo]);
        const b = texto((propio as unknown as Record<string, unknown>)[campo]);
        if (!igual(a, b)) {
          iguales = false;
          diferencias.push({ external_key: clave, entity_id: propio.id, kind: 'FIELD_DIFFERS', field: campo, external_value: a || null, our_value: b || null });
        }
      }
      if (iguales) coincidencias += 1;
    }
    for (const propio of propios) {
      if (!externos.has(propio.codigo_operador)) {
        diferencias.push({ external_key: propio.codigo_operador, entity_id: propio.id, kind: 'ONLY_OURS', field: null, external_value: null, our_value: propio.nombre_operador || null });
      }
    }

    const hash = sha256(file.buffer);
    const actId = randomUUID();
    const resumen = {
      external_rows: externos.size, our_rows: propios.length, matches: coincidencias,
      only_external: diferencias.filter((d) => d.kind === 'ONLY_EXTERNAL').length,
      only_ours: diferencias.filter((d) => d.kind === 'ONLY_OURS').length,
      field_differs: diferencias.filter((d) => d.kind === 'FIELD_DIFFERS').length,
      source_filename: file.originalname ?? null,
    };
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('exchange_acts').values({
        id: actId, organization_id: orgId, agreement_id: acuerdo.id, kind: 'RECONCILE',
        format_version: FORMATO.version, row_count: externos.size, content_hash: hash,
        summary: JSON.stringify(resumen), performed_by: user.id, operation_id: randomUUID(),
      } as never).execute();
      if (diferencias.length) {
        await trx.insertInto('exchange_differences').values(diferencias.map((d) => ({
          id: randomUUID(), organization_id: orgId, act_id: actId, external_key: d.external_key,
          entity_type: 'PRODUCER', entity_id: d.entity_id, kind: d.kind, field: d.field,
          external_value: d.external_value, our_value: d.our_value,
        })) as never).execute();
      }
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'exchange.reconciled',
        entityType: 'exchange_act', entityId: actId, requestId, result: 'SUCCESS',
        after: { agreement_id: acuerdo.id, ...resumen, content_hash: hash },
      });
    });
    return this.acto(user, orgId, actId);
  }

  async acto(user: AuthUser, orgId: string, id: string) {
    await this.leer(user, orgId, 'exchange:use');
    const a = await this.db.selectFrom('exchange_acts as a').leftJoin('users as u', 'u.id', 'a.performed_by')
      .select(['a.id', 'a.agreement_id', 'a.kind', 'a.format_version', 'a.row_count', 'a.content_hash', 'a.summary', 'a.performed_at', 'u.first_name', 'u.last_name'])
      .where('a.id', '=', id).where('a.organization_id', '=', orgId).executeTakeFirst();
    if (!a) throw notFound();
    const difs = await sql<{ id: string; external_key: string; entity_id: string | null; kind: string; field: string | null; external_value: string | null; our_value: string | null; decision: string | null; reason: string | null; decided_at: string | null }>`
      SELECT d.id, d.external_key, d.entity_id, d.kind, d.field, d.external_value, d.our_value,
             r.decision, r.reason, r.decided_at::text
      FROM exchange_differences d
      LEFT JOIN LATERAL (
        SELECT decision, reason, decided_at FROM exchange_difference_decisions
        WHERE difference_id = d.id ORDER BY decided_at DESC, id DESC LIMIT 1) r ON TRUE
      WHERE d.act_id = ${id} AND d.organization_id = ${orgId}
      ORDER BY d.kind, d.external_key, d.field NULLS FIRST`.execute(this.db);
    return {
      id: a.id, agreement_id: a.agreement_id, kind: a.kind, format_version: a.format_version,
      row_count: a.row_count, content_hash: a.content_hash, summary: a.summary, performed_at: a.performed_at,
      performed_by: `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || 'Miembro',
      differences: difs.rows.map((d) => ({
        id: d.id, external_key: d.external_key, entity_id: d.entity_id, kind: d.kind, field: d.field,
        external_value: d.external_value, our_value: d.our_value,
        resolution: d.decision ? { decision: d.decision, reason: d.reason, at: d.decided_at } : null,
      })),
      pending: difs.rows.filter((d) => !d.decision).length,
      note: 'Conciliar NO escribe en los datos operativos. Aceptar un valor externo deja constancia de que hay '
        + 'que corregirlo por el caso de uso del dominio, con su procedencia; no sobrescribe nada aquí.',
    };
  }

  async actos(user: AuthUser, orgId: string) {
    await this.leer(user, orgId, 'exchange:use');
    const filas = await sql<{ id: string; kind: string; format_version: string; row_count: number; content_hash: string; summary: unknown; performed_at: string; nombre: string | null; pendientes: string }>`
      SELECT a.id, a.kind, a.format_version, a.row_count, a.content_hash, a.summary, a.performed_at::text,
             btrim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS nombre,
             (SELECT count(*) FROM exchange_differences d
               WHERE d.act_id = a.id AND NOT EXISTS (SELECT 1 FROM exchange_difference_decisions r WHERE r.difference_id = d.id))::text AS pendientes
      FROM exchange_acts a LEFT JOIN users u ON u.id = a.performed_by
      WHERE a.organization_id = ${orgId}
      ORDER BY a.performed_at DESC LIMIT 100`.execute(this.db);
    return {
      acts: filas.rows.map((f) => ({
        id: f.id, kind: f.kind, format_version: f.format_version, row_count: f.row_count,
        content_hash: f.content_hash, summary: f.summary, performed_at: f.performed_at,
        performed_by: f.nombre || 'Miembro', pending: Number(f.pendientes),
      })),
      note: 'Registro de todo acto de intercambio: qué se exportó o concilió, con qué versión del formato, cuántas filas y con qué huella.',
    };
  }

  async resolver(user: AuthUser, orgId: string, differenceId: string, dto: DecisionDiferenciaDto, requestId?: string) {
    await this.escribir(user, orgId, 'exchange:use');
    const d = await this.db.selectFrom('exchange_differences').select(['id', 'act_id', 'kind', 'field', 'external_key'])
      .where('id', '=', differenceId).where('organization_id', '=', orgId).executeTakeFirst();
    if (!d) throw notFound();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('exchange_difference_decisions').values({
        id: randomUUID(), organization_id: orgId, difference_id: differenceId, decision: dto.decision,
        reason: dto.reason.trim(), decided_by: user.id, operation_id: dto.operation_id,
      } as never).execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'exchange.difference_resolved',
        entityType: 'exchange_difference', entityId: differenceId, requestId, result: 'SUCCESS',
        after: { decision: dto.decision, reason: dto.reason.trim(), kind: d.kind, field: d.field },
      });
    });
    return this.acto(user, orgId, d.act_id);
  }
}

@ApiTags('exchange')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/exchange')
export class ExchangeController {
  constructor(private readonly service: ExchangeService) {}

  @Get('format')
  @ApiOperation({ summary: 'Formato de intercambio declarado y su mapeo a los elementos de la guía (NO oficial)' })
  formato() { return this.service.formato(); }

  @Get('agreements')
  @ApiOperation({ summary: 'Acuerdos de intercambio y su estado' })
  acuerdos(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.acuerdos(u, o); }

  @Post('agreements')
  @ApiOperation({ summary: 'Registrar un acuerdo de intercambio (registrar NO habilita el intercambio)' })
  registrar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: AcuerdoDto, @Req() req: AuthedRequest) {
    return this.service.registrar(u, o, dto, req.requestId);
  }

  @Post('agreements/:id/decisions')
  @HttpCode(201)
  @ApiOperation({ summary: 'Verificar el canal (solo plataforma) o retirar el acuerdo' })
  decidir(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionAcuerdoDto, @Req() req: AuthedRequest) {
    return this.service.decidirAcuerdo(u, o, id, dto, req.requestId);
  }

  @Get('acts')
  @ApiOperation({ summary: 'Registro de actos de intercambio' })
  actos(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.actos(u, o); }

  @Get('acts/:id')
  @ApiOperation({ summary: 'Un acto de intercambio y sus diferencias' })
  acto(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.acto(u, o, id);
  }

  @Post('export')
  @ApiOperation({ summary: 'Exportar el padrón propio en el formato de intercambio (exige canal verificado)' })
  async exportar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string,
    @Req() req: AuthedRequest, @Res() res: Response) {
    // Se escribe la respuesta a mano, como las plantillas de importación: devolver el Buffer desde el
    // manejador lo serializaría como JSON y el archivo dejaría de ser un libro válido.
    const r = await this.service.exportar(u, o, req.requestId);
    res.status(201);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Exchange-Act', r.actId);
    res.send(r.bytes);
  }

  @Post('reconcile')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Conciliar un archivo de la contraparte: produce diferencias, NO escribe datos' })
  conciliar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string,
    @UploadedFile() file: SubidaXlsx | undefined, @Req() req: AuthedRequest) {
    return this.service.conciliar(u, o, file, req.requestId);
  }

  @Post('differences/:id/decisions')
  @HttpCode(201)
  @ApiOperation({ summary: 'Resolver una diferencia con su motivo (no sobrescribe el dato operativo)' })
  resolver(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDiferenciaDto, @Req() req: AuthedRequest) {
    return this.service.resolver(u, o, id, dto, req.requestId);
  }
}
