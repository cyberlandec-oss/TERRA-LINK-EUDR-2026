import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuthorizationService } from '../authz/authorization.service';
import type { TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { AuditService } from '../audit/audit.service';
import { OBJECT_STORE, type ObjectStore } from '../storage/object-store';
import { PlotsService } from '../plots/plots';
import { ProducersService } from '../producers/producers';
import { MOTOR, MOTOR_VERSION, textoDePdf } from './pdf-text';
import { EXPLICACION_BASE, sugerir, type Base } from './reglas';

// P1-013 — Extracción asistida de documentos (RF-44; S1 §55).
//
// QUÉ EXIGEN LOS CRITERIOS, LITERALMENTE
//   · **RF-44** (`docs/03:60`, columna **Restricción**): «**revisión humana y evidencia de extracción**».
//   · **P1-013** (`docs/18:214`, aceptación mínima): «campos sugeridos con **fuente/confianza** y revisión;
//     **no decisión regulatoria automática**».
//   · **S1 §55**: OCR/IA es «**posteriormente**… **no en la primera versión como dependencia crítica**».
//     Por eso **nada** depende de esto: si la extracción no existe o falla, el producto sigue igual.
//
// TRES COSAS DISTINTAS, Y NO SE MEZCLAN
//   1. **texto extraído**: lo que el archivo dice, literal;
//   2. **valor sugerido**: con su **fragmento de origen**, su **posición** y la **regla** que lo propuso;
//   3. **dato confirmado por una persona**: sin esta decisión, **no hay dato**.
//
// LO QUE NO HACE
//   · **No sale fuera.** Un PDF con capa de texto se lee **en local**; lo que este motor no sabe leer se
//     **declara** con su motivo, en vez de enviarse a nadie. **El OCR no obliga a usar un servicio externo**
//     —hay motores que corren en local, como Tesseract—: que aquí no haya OCR es **limitación de este motor**.
//   · **No confunde «no hay» con «no sé leerlo».** Un PDF cuya capa de texto este motor no interpreta se
//     publica como `TEXTO_NO_INTERPRETABLE`, **sin texto y sin sugerencias**: devolver una interpretación
//     incorrecta sería peor que no leer nada.
//   · **No sobrescribe nada**: `document_versions` no se toca. Confirmar **registra**, no pisa.
//   · **No acredita** autenticidad, legalidad, calidad ni suficiencia documental, y **no levanta** compuertas.
//   · **No confirma importaciones** ni decide nada por sí sola.
//
// PERMISOS: EL DEL DOCUMENTO **Y** EL DEL DESTINO
//   · ver/extraer exige `document:read` **y** el acceso al **contenido** —un documento de datos personales
//     necesita `producer:read_identity`—: **poder subirlo no autoriza a leerlo**;
//   · **confirmar o descartar** exige `document:review`: quien sube **no** decide.
//
// ATADO A LA VERSIÓN EXACTA
// La extracción cuelga de `version_id`. Si se sube una versión nueva, la extracción anterior **no se
// arrastra**: se publica que es de una versión que ya no es la vigente.

const SOPORTADOS = ['application/pdf'];

class ExtraerDto {
  @ApiProperty() @IsUUID() operation_id!: string;
}
class DecidirDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ enum: ['CONFIRMADO', 'DESCARTADO'] }) @IsIn(['CONFIRMADO', 'DESCARTADO']) decision!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(1, 200) confirmed_value?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(5, 500) reason?: string;
}

@Injectable()
export class ExtractionService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly plots: PlotsService,
    private readonly producers: ProducersService,
  ) {}

  private tiene(ctx: TenantContext, p: string) { return ctx.permissions.includes(p as never); }

  /**
   * La versión exacta, con su documento, su tipo y su último análisis antivirus.
   * Comprueba los dos permisos: el del documento y el del CONTENIDO.
   */
  private async version(ctx: TenantContext, orgId: string, documentId: string, versionId: string) {
    const v = await sql<{
      id: string; version_number: number; file_name: string; mime_type: string; size_bytes: number; sha256: string;
      object_key: string; document_id: string; title: string; document_type: string; classification: string;
      current_version_id: string | null; scan: string | null; owner_type: string; owner_id: string;
    }>`
      SELECT v.id, v.version_number, v.file_name, v.mime_type, v.size_bytes, v.sha256, v.object_key,
             d.id AS document_id, d.title, d.document_type, t.classification, d.current_version_id, d.owner_type, d.owner_id,
             (SELECT s.result FROM document_version_scans s WHERE s.version_id = v.id ORDER BY s.scanned_at DESC LIMIT 1) AS scan
      FROM document_versions v
      JOIN documents d ON d.id = v.document_id AND d.organization_id = v.organization_id
      JOIN document_types t ON t.code = d.document_type
      WHERE v.id = ${versionId} AND v.document_id = ${documentId} AND v.organization_id = ${orgId}`
      .execute(this.db);
    const row = v.rows[0];
    if (!row) throw notFound('La versión del documento no existe o no está disponible para ti.');
    // El alcance lo pone el TITULAR del documento (parcela o productor), igual que en DocumentsService: `document:read` no
    // significa «todos los documentos de la organización». Fuera de alcance = 404; conocer el identificador no basta.
    if (row.owner_type === 'producer') await this.producers.load(this.db, ctx, row.owner_id, 'read');
    else if (row.owner_type === 'plot') await this.plots.load(this.db, ctx, row.owner_id, 'read');
    else throw notFound('La versión del documento no existe o no está disponible para ti.');
    if (row.classification === 'PERSONAL_DATA' && !this.tiene(ctx, 'producer:read_identity')) {
      throw forbidden('CONTENT_RESTRICTED', 'Este documento contiene datos personales; tu rol no permite ver su contenido ni extraerlo.');
    }
    return row;
  }

  // ------------------------------------------------------------------ extraer

  async extraer(user: AuthUser, orgId: string, documentId: string, versionId: string, dto: ExtraerDto, requestId?: string) {
    const ctx = await this.authz.require(user, orgId, 'document:extract', { mutation: true });
    // El alcance se comprueba ANTES de la repetición idempotente: ni siquiera un reintento revela un documento ajeno.
    const v = await this.version(ctx, orgId, documentId, versionId);
    const previa = await this.db.selectFrom('document_extractions').select(['id', 'version_id'])
      .where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (previa) {
      if (previa.version_id !== versionId) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return this.ver(user, orgId, documentId, versionId);
    }

    // Se respetan los controles que ya existen: sin análisis antivirus limpio, no se abre el archivo.
    if (v.scan !== 'CLEAN') {
      throw conflict('SCAN_NOT_CLEAN', v.scan === 'INFECTED'
        ? 'El análisis antivirus marcó este archivo como infectado: no se abre para extraer.'
        : 'Este archivo aún no tiene un análisis antivirus limpio: no se abre para extraer.');
    }

    let estado: 'EXTRAIDA' | 'SIN_TEXTO' | 'TEXTO_NO_INTERPRETABLE' | 'FORMATO_NO_SOPORTADO' | 'FALLIDA' = 'FALLIDA';
    let texto: string | null = null;
    let paginas: number | null = null;
    let nota = '';

    if (!SOPORTADOS.includes(v.mime_type)) {
      estado = 'FORMATO_NO_SOPORTADO';
      nota = `El formato ${v.mime_type} es una imagen: leerla exigiría OCR, y este motor NO implementa OCR. `
        + 'No es que haga falta un servicio externo —hay motores de OCR que se ejecutan en local—: es una '
        + 'limitación del motor instalado. No se envía el archivo a ningún tercero. Registra los datos a mano.';
    } else {
      let bytes: Buffer;
      try { bytes = await this.store.get(v.object_key); }
      catch { throw new AppError(503, 'STORAGE_UNAVAILABLE', 'No pudimos leer el archivo para extraerlo.'); }
      // La huella se recalcula: así queda probado que se analizó ESTE archivo.
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (sha !== v.sha256) {
        throw conflict('CONTENT_MISMATCH', 'El contenido almacenado no coincide con la huella registrada de la versión: no se extrae.');
      }
      try {
        const r = await textoDePdf(bytes);
        paginas = r.pages > 0 ? r.pages : null;
        if (r.reason === 'NO_SE_PUDO_ABRIR') {
          estado = 'FALLIDA';
          nota = 'El archivo no se pudo abrir como PDF. No se infiere ningún dato de un archivo que no se pudo leer.';
        } else if (r.reason === 'TIEMPO_AGOTADO') {
          estado = 'FALLIDA';
          nota = 'La lectura superó el plazo y se interrumpió, liberando el documento. No se publica un texto '
            + 'parcial como si fuera completo, y no se sugiere nada a partir de él.';
        } else if (r.reason === 'SOPORTE_INDETERMINADO') {
          estado = 'TEXTO_NO_INTERPRETABLE';
          nota = `No se pudo inspeccionar todo el documento (${r.fonts.undetermined} parte(s) ilegibles), así que `
            + 'NO se puede afirmar que todas sus fuentes se puedan traducir a caracteres. Ante la duda no se '
            + 'publica texto ni se sugiere ningún campo.';
        } else if (r.reason === 'FUENTE_SIN_MAPA') {
          // El motor SÍ decodifica, pero esta fuente no se puede mapear a caracteres: se rechaza ENTERO.
          estado = 'TEXTO_NO_INTERPRETABLE';
          nota = `El PDF SÍ tiene capa de texto, pero ${r.fonts.without_map} de sus ${r.fonts.composite} fuente(s) `
            + 'compuesta(s) NO declaran su mapa «ToUnicode» en su propio diccionario. Sin ese mapa los códigos son '
            + 'identificadores de glifo, y lo que se obtendría NO sería el texto del documento —puede parecer texto '
            + 'y no serlo—. Se rechaza entero y NO se sugiere ningún campo.';
        } else if (r.text.length === 0) {
          estado = 'SIN_TEXTO';
          nota = 'El PDF no tiene capa de texto: probablemente es un escaneo. Leerlo exigiría OCR, y este motor NO '
            + 'implementa OCR —existen motores locales, como Tesseract; no hace falta un servicio externo—. '
            + 'No se envía el archivo a ningún tercero.';
        } else {
          estado = 'EXTRAIDA';
          texto = r.text;
          nota = r.truncated
            ? `Texto de ${r.pages} página(s), CORTADO por los límites de procesamiento: está incompleto, y por eso se dice.`
            : `Texto decodificado de ${r.pages} página(s) con ${MOTOR} ${MOTOR_VERSION}, en local. Las `
              + `${r.fonts.composite} fuente(s) compuesta(s) del documento declaran su mapa de caracteres, y ningún `
              + 'fragmento quedó sin mapear.';
        }
      } catch {
        estado = 'FALLIDA';
        nota = 'No se pudo leer el archivo. No se infiere ningún dato de un archivo que no se pudo leer.';
      }
    }

    const sugerencias = estado === 'EXTRAIDA' && texto ? sugerir(texto) : [];
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      const ultima = await trx.selectFrom('document_extractions').select('run_number')
        .where('version_id', '=', versionId).orderBy('run_number', 'desc').executeTakeFirst();
      await trx.insertInto('document_extractions').values({
        id, organization_id: orgId, version_id: versionId, run_number: (ultima?.run_number ?? 0) + 1,
        status: estado as never, engine: MOTOR, engine_version: MOTOR_VERSION, source_sha256: v.sha256,
        text_chars: texto?.length ?? 0, pages: paginas, extracted_text: texto, note: nota,
        extracted_by: user.id, operation_id: dto.operation_id,
      }).execute();
      for (const s of sugerencias) {
        await trx.insertInto('document_extraction_fields').values({
          id: randomUUID(), organization_id: orgId, extraction_id: id, field_code: s.field_code as never,
          suggested_value: s.suggested_value, basis: s.basis as never, confidence: s.confidence as never,
          source_excerpt: s.source_excerpt, source_offset: s.source_offset,
          candidates: JSON.stringify(s.candidates) as never,
        }).execute();
      }
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'document.extracted',
        entityType: 'document_version', entityId: versionId, requestId, result: 'SUCCESS',
        after: { extraction_id: id, status: estado, engine: `${MOTOR}@${MOTOR_VERSION}`, fields: sugerencias.length },
      });
    });

    return this.ver(user, orgId, documentId, versionId);
  }

  // ------------------------------------------------------------------ consultar

  async ver(user: AuthUser, orgId: string, documentId: string, versionId: string) {
    const ctx = await this.authz.require(user, orgId, 'document:read', { mutation: false });
    const v = await this.version(ctx, orgId, documentId, versionId);

    const corridas = await this.db.selectFrom('document_extractions as e')
      .leftJoin('users as u', 'u.id', 'e.extracted_by')
      .select(['e.id', 'e.run_number', 'e.status', 'e.engine', 'e.engine_version', 'e.source_sha256',
        'e.text_chars', 'e.pages', 'e.extracted_text', 'e.note', 'e.extracted_at', 'u.email as author'])
      .where('e.organization_id', '=', orgId).where('e.version_id', '=', versionId)
      .orderBy('e.run_number', 'desc').execute();

    const actual = corridas[0] ?? null;
    const campos = actual
      ? await this.db.selectFrom('document_extraction_fields as f')
        .leftJoin('document_extraction_decisions as d', 'd.field_id', 'f.id')
        .leftJoin('users as du', 'du.id', 'd.decided_by')
        .select(['f.id', 'f.field_code', 'f.suggested_value', 'f.basis', 'f.confidence', 'f.source_excerpt',
          'f.source_offset', 'f.candidates', 'd.decision', 'd.confirmed_value', 'd.reason', 'd.decided_at',
          'du.email as decided_by'])
        .where('f.extraction_id', '=', actual.id).orderBy('f.field_code').execute()
      : [];

    const esVigente = v.current_version_id === versionId;
    return {
      document: { id: v.document_id, title: v.title, type: v.document_type, classification: v.classification },
      version: {
        id: v.id, version_number: v.version_number, file_name: v.file_name, mime_type: v.mime_type,
        size_bytes: v.size_bytes, sha256: v.sha256, scan: v.scan, is_current: esVigente,
      },
      version_note: esVigente
        ? 'Esta extracción corresponde a la versión VIGENTE del documento.'
        : 'ATENCIÓN: esta extracción es de una versión que YA NO es la vigente. No se arrastra a la nueva: '
          + 'si quieres datos de la versión actual, extrae sobre ella.',
      supported: SOPORTADOS.includes(v.mime_type),
      extraction: actual ? {
        id: actual.id, run_number: actual.run_number, status: actual.status,
        engine: actual.engine, engine_version: actual.engine_version, source_sha256: actual.source_sha256,
        text_chars: actual.text_chars, pages: actual.pages, note: actual.note,
        extracted_at: actual.extracted_at, author: actual.author ?? 'PLATAFORMA',
        /** TEXTO EXTRAÍDO: lo que el documento dice. No es un dato confirmado. */
        extracted_text: actual.extracted_text,
      } : null,
      /** VALORES SUGERIDOS y, por separado, lo que una persona confirmó o descartó. */
      fields: campos.map((f) => ({
        id: f.id, field_code: f.field_code,
        suggestion: {
          value: f.suggested_value, basis: f.basis, confidence: f.confidence,
          basis_note: EXPLICACION_BASE[f.basis as Base],
          source_excerpt: f.source_excerpt, source_offset: f.source_offset,
          candidates: f.candidates ?? [],
        },
        review: f.decision ? {
          decision: f.decision, confirmed_value: f.confirmed_value, reason: f.reason,
          decided_at: f.decided_at, decided_by: f.decided_by ?? 'PLATAFORMA',
        } : null,
        state: f.decision ? (f.decision === 'CONFIRMADO' ? 'CONFIRMADO' : 'DESCARTADO') : 'PENDIENTE_DE_REVISION',
      })),
      history: corridas.map((c) => ({
        run_number: c.run_number, status: c.status, engine: `${c.engine}@${c.engine_version}`,
        text_chars: c.text_chars, extracted_at: c.extracted_at, author: c.author ?? 'PLATAFORMA',
      })),
      can_review: this.tiene(ctx, 'document:review'),
      disclaimer: 'La extracción NO acredita autenticidad, legalidad, calidad ni suficiencia documental, y no '
        + 'levanta ninguna compuerta. Un valor sugerido NO es un dato: lo es solo cuando una persona lo confirma, '
        + 'y aun así queda como registro propio: NO sobrescribe la versión del documento ni ningún dato operativo.',
      no_external: 'Ningún archivo ni dato personal sale de esta instalación: el PDF se decodifica en local con '
        + `${MOTOR}, una biblioteca, no un servicio. Lo que no se puede leer se declara, en vez de enviarse a nadie.`,
      engine_limits: 'Este motor lee la CAPA DE TEXTO de un PDF e interpreta las codificaciones y los mapas de '
        + 'fuente. Si una fuente NO se puede mapear a caracteres, el resultado se rechaza entero y no se sugiere '
        + 'nada: un texto mal decodificado puede parecer texto, y eso sería peor que no leer nada. NO hay OCR, así '
        + 'que una imagen o un PDF escaneado no se leen —el OCR tampoco obligaría a usar un servicio externo: hay '
        + 'motores locales, como Tesseract; simplemente no está incorporado—. Superar estas pruebas NO acredita '
        + 'compatibilidad con cualquier PDF: acredita lo que se ha comprobado.',
    };
  }

  // ------------------------------------------------------------------ revisar

  async decidir(user: AuthUser, orgId: string, documentId: string, versionId: string, fieldId: string, dto: DecidirDto, requestId?: string) {
    // Confirmar o descartar es REVISIÓN: quien sube un archivo no decide sobre sus datos.
    const ctx = await this.authz.require(user, orgId, 'document:review', { mutation: true });
    await this.version(ctx, orgId, documentId, versionId);

    const previa = await this.db.selectFrom('document_extraction_decisions').select(['id', 'field_id'])
      .where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (previa) {
      if (previa.field_id !== fieldId) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return this.ver(user, orgId, documentId, versionId);
    }

    const campo = await this.db.selectFrom('document_extraction_fields as f')
      .innerJoin('document_extractions as e', 'e.id', 'f.extraction_id')
      .select(['f.id', 'f.field_code', 'f.suggested_value', 'e.version_id'])
      .where('f.id', '=', fieldId).where('f.organization_id', '=', orgId).executeTakeFirst();
    if (!campo || campo.version_id !== versionId) throw notFound('La sugerencia no existe o no es de esta versión.');

    if (dto.decision === 'CONFIRMADO') {
      const valor = (dto.confirmed_value ?? campo.suggested_value ?? '').trim();
      if (!valor) {
        throw new AppError(422, 'VALUE_REQUIRED', 'No hay valor que confirmar: la sugerencia está vacía, así que escribe el valor correcto.', [{ field: 'confirmed_value', reason: 'VALUE_REQUIRED' }]);
      }
      if ((campo.field_code === 'ISSUED_AT' || campo.field_code === 'EXPIRES_AT') && !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        throw new AppError(422, 'DATE_FORMAT', 'Una fecha se confirma como AAAA-MM-DD: no se interpreta un formato ambiguo.', [{ field: 'confirmed_value', reason: 'DATE_FORMAT' }]);
      }
      await this.guardar(orgId, user.id, fieldId, 'CONFIRMADO', valor, null, dto.operation_id, versionId, campo.field_code, requestId);
    } else {
      if (!dto.reason?.trim()) {
        throw new AppError(422, 'REASON_REQUIRED', 'Descartar una sugerencia exige decir por qué.', [{ field: 'reason', reason: 'REASON_REQUIRED' }]);
      }
      await this.guardar(orgId, user.id, fieldId, 'DESCARTADO', null, dto.reason.trim(), dto.operation_id, versionId, campo.field_code, requestId);
    }
    return this.ver(user, orgId, documentId, versionId);
  }

  private async guardar(orgId: string, userId: string, fieldId: string, decision: string, valor: string | null,
    motivo: string | null, operationId: string, versionId: string, campo: string, requestId?: string) {
    try {
      await this.db.transaction().execute(async (trx) => {
        await trx.insertInto('document_extraction_decisions').values({
          id: randomUUID(), organization_id: orgId, field_id: fieldId, decision: decision as never,
          confirmed_value: valor, reason: motivo, decided_by: userId, operation_id: operationId,
        }).execute();
        await this.audit.record(trx, {
          organizationId: orgId, actorUserId: userId, action: 'document.extraction_reviewed',
          entityType: 'document_version', entityId: versionId, requestId, result: 'SUCCESS',
          after: { field_id: fieldId, field_code: campo, decision, confirmed_value: valor, reason: motivo },
        });
      });
    } catch (e) {
      if (String((e as { message?: string }).message ?? '').includes('decision_once_per_field')) {
        throw conflict('ALREADY_REVIEWED', 'Esta sugerencia ya fue revisada. Para rectificar, extrae de nuevo: lo decidido no se pisa.');
      }
      throw e;
    }
  }
}

@ApiTags('extraction')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/documents/:documentId/versions/:versionId/extraction')
export class ExtractionController {
  constructor(private readonly service: ExtractionService) {}

  @Get()
  @ApiOperation({ summary: 'Texto extraído, valores sugeridos con su procedencia, y lo que una persona revisó' })
  ver(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string,
    @Param('documentId', ParseUUIDPipe) d: string, @Param('versionId', ParseUUIDPipe) v: string) {
    return this.service.ver(u, o, d, v);
  }

  @Post()
  @ApiOperation({ summary: 'Extraer el texto de ESTA versión y proponer valores. No confirma nada' })
  extraer(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string,
    @Param('documentId', ParseUUIDPipe) d: string, @Param('versionId', ParseUUIDPipe) v: string,
    @Body() dto: ExtraerDto, @Req() req: AuthedRequest) {
    return this.service.extraer(u, o, d, v, dto, req.requestId);
  }

  @Post('fields/:fieldId/review')
  @ApiOperation({ summary: 'Confirmar o descartar una sugerencia. Exige revisión humana con permiso propio' })
  decidir(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string,
    @Param('documentId', ParseUUIDPipe) d: string, @Param('versionId', ParseUUIDPipe) v: string,
    @Param('fieldId', ParseUUIDPipe) f: string, @Body() dto: DecidirDto, @Req() req: AuthedRequest) {
    return this.service.decidir(u, o, d, v, f, dto, req.requestId);
  }
}
