import {
  Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import type { Response } from 'express';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database, ImportBatchesTable } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { PII_CIPHER, PiiCipher } from '../crypto/pii';
import { ProducersService, type EditableField } from '../producers/producers';
import { ProductsService } from '../products/products';
import { DEFAULT_XLSX_LIMITS, XlsxError, readXlsx, writeXlsx, type XlsxCell } from './xlsx';
import {
  CLEAR_TOKEN, PRODUCER_FIELDS, PRODUCER_TEMPLATE_SHEET, PRODUCER_TEMPLATE_VERSION, TEMPLATE_RULES, type TemplateField,
} from './producer-template';
import { PRODUCT_FIELDS, PRODUCT_TEMPLATE_RULES, PRODUCT_TEMPLATE_SHEET, PRODUCT_TEMPLATE_VERSION } from './product-template';
import { PLOT_FIELDS, PLOT_TEMPLATE_RULES, PLOT_TEMPLATE_SHEET, PLOT_TEMPLATE_VERSION } from './plot-template';
import { PlotsService, type PlotEditable } from '../plots/plots';
import { DeliveriesService, harvestColumns, ymd, type UpdateDeliveryDto } from '../deliveries/deliveries';
import { DELIVERY_FIELDS, DELIVERY_TEMPLATE_RULES, DELIVERY_TEMPLATE_SHEET, DELIVERY_TEMPLATE_VERSION } from './delivery-template';
import { LOT_FIELDS, LOT_TEMPLATE_RULES, LOT_TEMPLATE_SHEET, LOT_TEMPLATE_VERSION } from './lot-template';
import { LotsService } from '../lots/lots';
import { scaled } from '../traceability/kde-validator';

// P0-026 — Importación Excel (RF-26, QA-03; S1 §§61–63; docs/09 «Importación»; docs/UX_UI §20.3).
// Flujo común a todas las plantillas: plantilla → carga (análisis del archivo, sin tocar entidades) → mapeo explícito →
// vista previa (solo lectura, calculada en vivo con los permisos actuales) → confirmación atómica (revalida permisos,
// alcance y versiones con bloqueo y exige que el plan no haya cambiado: plan_hash) → resultado e informe.
// - Clave de reimportación: el código de la entidad dentro de la organización. Un código existente ACTUALIZA solo los
//   campos mapeados con valor (o #BORRAR en campos que lo admiten); sin diferencias → «sin cambios» (sin versión, evento
//   ni auditoría de entidad). Reimportar el mismo archivo no duplica nada.
// - Celda vacía = sin dato (no borra). Columna sin mapear = desconocido (no cambia). #BORRAR = petición explícita de vaciar.
// - Cada plantilla aplica los casos de uso de su entidad (createInTx/updateInTx): mismos permisos, versiones, eventos,
//   auditoría y restricciones que el alta y la edición manuales.
// - Atomicidad: todo el lote o nada. Una fila con error bloquea la confirmación (no hay importación parcial).
// - `import:manage` no concede nada sobre las entidades: cada plantilla exige además los permisos de su entidad.

type Batch = Selectable<ImportBatchesTable>;
type Db = Kysely<Database> | Transaction<Database>;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MEDIA_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const ATOMICITY = {
  mode: 'ATOMIC',
  description: 'Se guarda todo el lote o nada. Un lote con filas con error no se puede confirmar: corrige el archivo y vuelve a cargarlo. Si algo cambia entre la vista previa y la confirmación, no se guarda nada y se pide revisar de nuevo.',
} as const;

interface UploadedXlsx { buffer: Buffer; originalname?: string; size: number }
/** Celda almacenada (cifrada): v = valor, f = tenía fórmula, n = celda numérica. */
interface StoredCell { v: string; f?: 1; n?: 1 }
interface Mapping { columns: Record<string, string> }

type FieldState = 'PROVIDED' | 'MISSING' | 'CLEAR' | 'NOT_MAPPED';
/** Calidad del dato (S1 §63). Importar nunca produce VERIFIED. */
const QUALITY: Record<FieldState, 'LEGACY' | 'MISSING' | 'UNKNOWN'> = { PROVIDED: 'LEGACY', CLEAR: 'MISSING', MISSING: 'MISSING', NOT_MAPPED: 'UNKNOWN' };
interface RowIssue { column: string | null; field: string | null; code: string; message: string }
export interface PlannedRow {
  row_number: number;
  key: string | null;
  action: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR';
  entity_id: string | null;
  expected_version: number | null;
  changed_fields: string[];
  fields: Record<string, { state: FieldState; quality: string; value?: string | null }>;
  errors: RowIssue[];
  warnings: RowIssue[];
  /** Efectos que la confirmación produciría (p. ej. movimientos de cantidad), explicados antes de confirmar. */
  effects: string[];
  /** Valores a escribir (null = vaciar). Interno: no se devuelve. */
  patch: Record<string, string | null>;
}
interface ApplyFrom { reason: string; source: Record<string, unknown> }

/** Plantilla: campos, reglas y la parte específica de su entidad (resolver contra lo registrado y aplicar). */
interface ImportTemplate {
  version: 'PRODUCTORES_V1' | 'PRODUCTOS_V1' | 'PARCELAS_V1' | 'ENTREGAS_V1' | 'LOTES_V1';
  slug: 'producers' | 'products' | 'plots' | 'deliveries' | 'lots';
  /** La clave puede repetirse en varias filas (varias entradas de una misma entidad). */
  keyRepeats?: boolean;
  /** Hojas de ayuda para la plantilla descargable (solo lectura, con los permisos del usuario). */
  helpSheets?(ctx: TenantContext): Promise<Array<{ name: string; rows: string[][]; widths?: number[] }>>;
  /** La clave puede faltar (fila nueva sin código asignado). */
  keyOptional?: boolean;
  /** El mapeo debe incluir al menos uno de estos campos (por omisión, la clave). */
  mappingRequiredAnyOf?: string[];
  sheet: string;
  entity: string;
  keyField: string;
  fields: TemplateField[];
  rules: string[];
  /** Permisos de la entidad (basta uno) sin los cuales la plantilla no se puede usar (además de import:manage). */
  usePermissions?: Permission[];
  /**
   * Permisos necesarios (todos) para ver muestras de columnas NO mapeadas o mapeadas a campos de identidad: una columna
   * suelta puede traer datos personales o coordenadas. Sin ellos solo se muestran columnas mapeadas a campos no sensibles.
   */
  samplePermissions: Permission[];
  newStatus: string;
  entityColumn: 'producer_id' | 'product_id' | 'plot_id' | 'delivery_id' | 'lot_id';
  keyFormatMessage: string;
  resolve(db: Db, ctx: TenantContext, rows: PlannedRow[], colOf: Map<string, string>, lock: boolean): Promise<void>;
  apply(trx: Transaction<Database>, ctx: TenantContext, user: AuthUser, p: PlannedRow, from: ApplyFrom, requestId?: string): Promise<{ id: string; reviews: number }>;
  /** Códigos de error y restricciones que indican un cambio concurrente durante la confirmación. */
  concurrency: { codes: string[]; constraints: string[] };
  codeOf(db: Db, orgId: string, ids: string[]): Promise<Map<string, string>>;
}

const colName = (i: number) => { let s = ''; let n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const normHeader = (h: string) => h.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const rowAad = (org: string, batch: string, row: number) => `import_row|${org}|${batch}|${row}`;

class MappingDto {
  @ApiProperty({ description: 'Columna (letra) → campo de la plantilla. Las columnas no incluidas se ignoran.', example: { A: 'producer_code', B: 'first_name' } })
  @IsObject() columns!: Record<string, string>;
  @ApiProperty({ description: 'row_version del lote leído' }) @IsInt() @Min(1) expected_version!: number;
}

class CommitDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ description: 'plan_hash de la vista previa revisada' }) @Matches(/^[0-9a-f]{64}$/) plan_hash!: string;
}

class PreviewQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

@Injectable()
export class ImportsService {
  private readonly templates: Record<ImportTemplate['version'], ImportTemplate>;

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(PII_CIPHER) private readonly cipher: PiiCipher,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly producers: ProducersService,
    private readonly products: ProductsService,
    private readonly plots: PlotsService,
    private readonly deliveries: DeliveriesService,
    private readonly lots: LotsService,
  ) {
    this.templates = { PRODUCTORES_V1: this.producerTemplate(), PRODUCTOS_V1: this.productTemplate(), PARCELAS_V1: this.plotTemplate(), ENTREGAS_V1: this.deliveryTemplate(), LOTES_V1: this.lotTemplate() };
  }

  private tpl(version: string): ImportTemplate {
    const t = this.templates[version as ImportTemplate['version']];
    if (!t) throw new AppError(422, 'TEMPLATE_NOT_AVAILABLE', 'Esa plantilla no está disponible. Plantillas: productores, productos, parcelas, entregas y lotes.', [{ field: 'template', reason: 'NOT_IMPLEMENTED' }]);
    return t;
  }
  private bySlug(slug: string): ImportTemplate {
    const t = Object.values(this.templates).find((x) => x.slug === slug);
    if (!t) throw notFound();
    return t;
  }

  /** import:manage + permiso propio de la plantilla (si lo tiene). `mutation` bloquea organizaciones suspendidas. */
  private async ctx(user: AuthUser, orgId: string, mutation: boolean, t?: ImportTemplate): Promise<TenantContext> {
    const ctx = await this.authz.require(user, orgId, 'import:manage', { mutation });
    if (t && !this.usable(ctx, t)) {
      throw forbidden('PERMISSION_DENIED', `Tu rol no permite gestionar ${t.entity}: el permiso general de importación no basta.`);
    }
    return ctx;
  }
  private usable(ctx: TenantContext, t: ImportTemplate) { return !t.usePermissions || t.usePermissions.some((p) => ctx.permissions.includes(p)); }
  private identity(ctx: TenantContext) { return ctx.permissions.includes('producer:read_identity'); }

  // ------------------------------------------------------------------ plantillas

  private producerTemplate(): ImportTemplate {
    const svc = this.producers;
    return {
      version: PRODUCER_TEMPLATE_VERSION, slug: 'producers', sheet: PRODUCER_TEMPLATE_SHEET, entity: 'productores', keyField: 'producer_code',
      fields: PRODUCER_FIELDS, rules: TEMPLATE_RULES, newStatus: 'DRAFT', entityColumn: 'producer_id', samplePermissions: ['producer:read_identity'],
      keyFormatMessage: 'Código no válido: letras, números, punto, guion o guion bajo (1–40).',
      concurrency: { codes: ['PRODUCER_CODE_TAKEN', 'VERSION_CONFLICT'], constraints: ['producers_code_uq'] },
      codeOf: async (db, orgId, ids) => new Map((ids.length ? await db.selectFrom('producers').select(['id', 'producer_code']).where('organization_id', '=', orgId).where('id', 'in', ids).execute() : []).map((r) => [r.id, r.producer_code])),
      resolve: async (db, ctx, planned, colOf, lock) => {
        const keyCol = colOf.get('producer_code') ?? null;
        const identity = this.identity(ctx);
        const existing = await svc.byCodes(db, ctx.organizationId, planned.filter((p) => p.key).map((p) => p.key!), lock);
        // Mismo mensaje para un código inexistente que el rol no puede crear y para un código ocupado fuera del alcance de
        // lectura: ninguna de las dos respuestas revela si el productor existe, su id, sus datos ni su estado.
        const notAvailable = (p: PlannedRow) => p.errors.push({ column: keyCol, field: 'producer_code', code: 'CODE_NOT_AVAILABLE', message: 'Ese código no está disponible para tu importación.' });
        for (const p of planned) {
          if (!p.key || p.errors.length) continue;
          const row = existing.get(p.key);
          if (!row) {
            if (!ctx.permissions.includes('producer:create')) { notAvailable(p); continue; }
            const fields = Object.fromEntries(Object.entries(p.patch).filter(([, v]) => v !== null)) as Partial<Record<EditableField, string | null>>;
            for (const code of svc.validateNames(fields)) p.errors.push({ column: null, field: null, code, message: code === 'DOCUMENT_PAIR_REQUIRED' ? 'El tipo y el número de documento van juntos.' : 'Indica nombre y apellido, o la razón social.' });
            if (p.errors.length) continue;
            p.action = 'CREATE';
            p.patch = fields;
            p.changed_fields = Object.keys(fields);
            continue;
          }
          const scope = svc.scopeOf(ctx, row);
          if (!scope.read) { notAvailable(p); continue; }
          if (row.status === 'INACTIVE') { p.errors.push({ column: null, field: null, code: 'PRODUCER_INACTIVE', message: 'El productor está dado de baja; no se actualiza por importación.' }); continue; }
          if (!scope.update) { p.errors.push({ column: null, field: null, code: 'PERMISSION_DENIED_UPDATE', message: 'Tu rol no permite modificar este productor.' }); continue; }
          const current = svc.decrypted(row, identity);
          const patch = p.patch as Partial<Record<EditableField, string | null>>;
          const changed = (Object.keys(patch) as EditableField[]).filter((k) => patch[k] !== current[k]);
          for (const code of svc.validateNames({ ...current, ...patch })) p.errors.push({ column: null, field: null, code, message: code === 'DOCUMENT_PAIR_REQUIRED' ? 'El tipo y el número de documento van juntos (contando lo ya registrado).' : 'El productor quedaría sin nombre y apellido ni razón social.' });
          if (p.errors.length) continue;
          p.entity_id = row.id;
          p.expected_version = Number(row.row_version);
          p.changed_fields = changed;
          p.patch = Object.fromEntries(changed.map((k) => [k, patch[k] ?? null]));
          p.action = changed.length ? 'UPDATE' : 'UNCHANGED';
        }
      },
      apply: async (trx, ctx, user, p, from, requestId) => {
        if (p.action === 'CREATE') {
          const r = await svc.createInTx(trx, ctx, user, p.key!, p.patch as Partial<Record<EditableField, string | null>>, { status: 'DRAFT', assignee: svc.defaultAssignee(ctx), requestId, changeType: 'IMPORT_CREATE', ...from });
          return { id: r.producer.id, reviews: Number(r.pendingReviews ?? 0) };
        }
        const r = await svc.updateInTx(trx, ctx, user, p.entity_id!, p.expected_version!, p.patch as Partial<Record<EditableField, string | null>>, { requestId, changeType: 'IMPORT_UPDATE', ...from });
        return { id: p.entity_id!, reviews: Number(r.pendingReviews ?? 0) };
      },
    };
  }

  private productTemplate(): ImportTemplate {
    const svc = this.products;
    const IMMUTABLE = PRODUCT_FIELDS.filter((f) => f.immutable).map((f) => f.field as string);
    return {
      version: PRODUCT_TEMPLATE_VERSION, slug: 'products', sheet: PRODUCT_TEMPLATE_SHEET, entity: 'productos', keyField: 'code',
      fields: PRODUCT_FIELDS, rules: PRODUCT_TEMPLATE_RULES, usePermissions: ['product:manage'], samplePermissions: [], newStatus: 'ACTIVE', entityColumn: 'product_id',
      keyFormatMessage: 'Código no válido: MAYÚSCULAS, números, guion o guion bajo (2–40).',
      concurrency: { codes: ['PRODUCT_CODE_TAKEN', 'VERSION_CONFLICT'], constraints: ['products_code_uq'] },
      codeOf: async (db, orgId, ids) => new Map((ids.length ? await db.selectFrom('products').select(['id', 'code']).where('organization_id', '=', orgId).where('id', 'in', ids).execute() : []).map((r) => [r.id, r.code])),
      resolve: async (db, ctx, planned, colOf, lock) => {
        const manage = ctx.permissions.includes('product:manage');
        const cats = await svc.catalogs(db);
        const existing = await svc.byCodes(db, ctx.organizationId, planned.filter((p) => p.key).map((p) => p.key!), lock);
        for (const p of planned) {
          // Catálogos de sistema: código exacto, sin equivalencias ni conversiones.
          for (const [field, set, code, label] of [['product_state', cats.states, 'PRODUCT_STATE_UNKNOWN', 'estado o presentación'], ['unit', cats.units, 'UNIT_UNKNOWN', 'unidad']] as const) {
            const v = p.patch[field];
            if (typeof v === 'string' && !set.has(v)) p.errors.push({ column: colOf.get(field) ?? null, field, code, message: `«${v.slice(0, 40)}» no es un código de ${label} del catálogo. Valores admitidos: ${[...set].sort().join(', ')}.` });
          }
          if (!p.key || p.errors.length) continue;
          const row = existing.get(p.key);
          if (!manage) { p.errors.push({ column: null, field: null, code: row ? 'PERMISSION_DENIED_UPDATE' : 'PERMISSION_DENIED_CREATE', message: 'Tu rol no permite gestionar productos.' }); continue; }
          if (!row) {
            for (const f of PRODUCT_FIELDS.filter((x) => x.requiredOnCreate)) {
              if (typeof p.patch[f.field] !== 'string') p.errors.push({ column: colOf.get(f.field) ?? null, field: f.field, code: 'REQUIRED_FOR_CREATE', message: `${f.label}: obligatorio para un producto nuevo.` });
            }
            if (p.errors.length) continue;
            p.action = 'CREATE';
            p.patch = Object.fromEntries(Object.entries(p.patch).filter(([, v]) => v !== null));
            p.changed_fields = Object.keys(p.patch);
            continue;
          }
          if (row.status === 'INACTIVE') { p.errors.push({ column: null, field: null, code: 'PRODUCT_INACTIVE', message: 'El producto está inactivo; no se reactiva ni se edita por importación.' }); continue; }
          for (const f of IMMUTABLE) {
            const v = p.patch[f];
            if (v !== undefined && v !== row[f as 'product_state' | 'unit']) p.errors.push({ column: colOf.get(f) ?? null, field: f, code: 'PRODUCT_FIELD_IMMUTABLE', message: `No se puede cambiar después del alta (registrado: ${row[f as 'product_state' | 'unit']}). Crea otro producto.` });
          }
          if (p.errors.length) continue;
          const editable = Object.fromEntries(Object.entries(p.patch).filter(([k]) => !IMMUTABLE.includes(k)));
          const changed = Object.keys(editable).filter((k) => editable[k] !== row[k as 'name' | 'scientific_name' | 'variety']);
          p.entity_id = row.id;
          p.expected_version = Number(row.row_version);
          p.changed_fields = changed;
          p.patch = Object.fromEntries(changed.map((k) => [k, editable[k]]));
          p.action = changed.length ? 'UPDATE' : 'UNCHANGED';
        }
      },
      apply: async (trx, ctx, user, p, from, requestId) => {
        if (p.action === 'CREATE') {
          const r = await svc.createInTx(trx, ctx.organizationId, user, { code: p.key!, name: p.patch.name!, product_state: p.patch.product_state!, unit: p.patch.unit!, scientific_name: p.patch.scientific_name ?? null, variety: p.patch.variety ?? null }, requestId, from);
          return { id: r.id, reviews: 0 };
        }
        await svc.updateInTx(trx, ctx.organizationId, user, p.entity_id!, { expected_version: p.expected_version!, ...p.patch } as never, requestId, from);
        return { id: p.entity_id!, reviews: 0 };
      },
    };
  }

  private lotTemplate(): ImportTemplate {
    const lots = this.lots;
    const uuidFrom = (...parts: string[]) => {
      const h = createHash('sha256').update(JSON.stringify([LOT_TEMPLATE_VERSION, ...parts])).digest('hex');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${(8 | (parseInt(h[16], 16) & 3)).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
    };
    const kg = (n: bigint) => { const a = n < 0n ? -n : n; const f = (a % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, ''); return `${n < 0n ? '-' : ''}${a / 1_000_000n}${f ? `.${f}` : ''}`; };
    return {
      version: LOT_TEMPLATE_VERSION, slug: 'lots', sheet: LOT_TEMPLATE_SHEET, entity: 'lotes', keyField: 'lot_code', keyOptional: true, keyRepeats: true,
      mappingRequiredAnyOf: ['reception_id'],
      fields: LOT_FIELDS, rules: LOT_TEMPLATE_RULES, newStatus: 'OPEN', entityColumn: 'lot_id',
      usePermissions: ['lot:create'], samplePermissions: ['producer:read_identity'],
      keyFormatMessage: 'Código de lote no válido: usa el código asignado por Terra Link (p. ej. LOT-2026-00003).',
      concurrency: { codes: ['INSUFFICIENT_AVAILABLE', 'LOT_CLOSED_FOR_INPUT', 'ORIGIN_MIXING_BLOCKED', 'PRODUCT_MISMATCH', 'NOT_FOUND', 'LOT_HAS_RESERVATIONS'], constraints: ['lot_inputs_operation_uq', 'lots_operation_uq', 'import_references_ref_uq', 'import_references_lot_uq'] },
      codeOf: async (db, orgId, ids) => new Map((ids.length ? await db.selectFrom('lots').select(['id', 'lot_code']).where('organization_id', '=', orgId).where('id', 'in', ids).execute() : []).map((r) => [r.id, r.lot_code])),
      helpSheets: async (ctx) => {
        const recs = lots.seesReceptions(ctx) ? await lots.availableReceptions(this.db, ctx) : [];
        return [{ name: 'recepciones_disponibles', widths: [38, 18, 18, 22, 16, 22],
          rows: [['id_recepcion', 'codigo_entrega', 'codigo_producto', 'recibida', 'disponible_kg', 'origen'],
            ...recs.map((r) => [r.id, r.delivery_code, r.product_code ?? '', r.received_at.slice(0, 16), r.available, r.origin_known ? 'conocido' : 'incompleto'])] }];
      },
      resolve: async (db, ctx, planned, colOf, lock) => {
        const org = ctx.organizationId;
        const col = (f: string) => colOf.get(f) ?? null;
        const err = (p: PlannedRow, field: string | null, code: string, message: string) => p.errors.push({ column: field ? col(field) : null, field, code, message });
        const refs = [...new Set(planned.map((p) => p.patch.import_reference).filter((r): r is string => typeof r === 'string'))];
        const refRows = new Map((refs.length ? await db.selectFrom('import_references').select(['reference', 'lot_id']).where('organization_id', '=', org).where('template', '=', LOT_TEMPLATE_VERSION).where('reference', 'in', refs).execute() : []).map((r) => [r.reference, r.lot_id!]));
        const lotRows = await lots.lotsForImport(db, ctx, [...new Set(planned.filter((p) => p.key).map((p) => p.key!))], [...refRows.values()], lock);
        const byCode = new Map(lotRows.map((l) => [l.lot_code, l]));
        const byId = new Map(lotRows.map((l) => [l.id, l]));
        const recIds = [...new Set(planned.map((p) => p.patch.reception_id).filter((r): r is string => typeof r === 'string').map((r) => r.toLowerCase()))];
        const recs = lots.seesReceptions(ctx) ? await lots.receptionsForImport(db, ctx, recIds, lock) : new Map();
        const groupKey = new Map<PlannedRow, string>();
        for (const p of planned) {
          if (p.errors.length) continue;
          const v = p.patch;
          const recId = typeof v.reception_id === 'string' ? v.reception_id.toLowerCase() : null;
          if (!recId) { err(p, 'reception_id', 'RECEPTION_REQUIRED', 'Falta la recepción: un lote se forma con recepciones confirmadas. Si el lote histórico no tiene recepción registrada, primero registra la entrega y su recepción (no se inventan).'); continue; }
          if (typeof v.quantity !== 'string') { err(p, 'quantity', 'QUANTITY_REQUIRED', 'Falta la cantidad en KG.'); continue; }
          if (scaled(v.quantity) <= 0n) { err(p, 'quantity', 'MUST_BE_POSITIVE', 'La cantidad debe ser mayor que cero.'); continue; }
          const rec = recs.get(recId);
          // Inexistente, de otra organización o fuera del alcance de entregas: misma respuesta.
          if (!rec) { err(p, 'reception_id', 'RECEPTION_NOT_AVAILABLE', 'La recepción indicada no está disponible para ti en esta organización.'); continue; }
          if (typeof v.delivery_code === 'string' && v.delivery_code !== rec.delivery_code) { err(p, 'delivery_code', 'RECEPTION_REFERENCE_MISMATCH', 'La recepción no pertenece a esa entrega.'); continue; }
          if (typeof v.product_code === 'string' && v.product_code !== rec.product_code) { err(p, 'product_code', 'RECEPTION_REFERENCE_MISMATCH', 'La recepción es de otro producto.'); continue; }
          const reference = typeof v.import_reference === 'string' ? v.import_reference : null;
          let lot: (typeof lotRows)[number] | undefined;
          if (p.key) {
            lot = byCode.get(p.key);
            if (!lot) { err(p, 'lot_code', 'CODE_NOT_AVAILABLE', 'Ese código de lote no está disponible para tu importación.'); continue; }
            if (reference && refRows.has(reference) && refRows.get(reference) !== lot.id) { err(p, 'import_reference', 'REFERENCE_CODE_MISMATCH', 'La referencia corresponde a otro lote distinto del código indicado.'); continue; }
          } else if (!reference) {
            err(p, 'import_reference', 'REFERENCE_REQUIRED', 'Fila sin código de lote ni referencia de importación: indica el lote existente o una referencia para el lote nuevo.'); continue;
          } else if (refRows.has(reference)) {
            lot = byId.get(refRows.get(reference)!);
            if (!lot) { err(p, 'import_reference', 'REFERENCE_NOT_AVAILABLE', 'Esa referencia ya está en uso y no está disponible para tu importación.'); continue; }
          }
          p.patch = { reception_id: rec.id, quantity: v.quantity, ...(reference ? { _reference: reference } : {}) };
          if (lot) {
            if (lot.status !== 'OPEN' || lot.source !== 'RECEPTIONS') { err(p, 'lot_code', 'LOT_CLOSED_FOR_INPUT', `El lote ${lot.lot_code} no admite entradas (cerrado o resultado de un proceso); no se reabre por importación.`); continue; }
            if (lot.product_id !== rec.product_id) { err(p, 'reception_id', 'PRODUCT_MISMATCH', `La recepción es de otro producto que el lote ${lot.lot_code}: no se suman productos distintos.`); continue; }
            if (rec.origin_known !== (lot.origin_status === 'COMPLETE')) { err(p, 'reception_id', 'ORIGIN_MIXING_BLOCKED', `No se mezcla origen conocido con origen incompleto en el lote ${lot.lot_code}.`); continue; }
            const active = lot.active.filter((i) => i.reception_id === rec.id);
            if (active.length) {
              const total = active.reduce((a, i) => a + scaled(i.quantity), 0n);
              if (total === scaled(v.quantity)) { p.entity_id = lot.id; p.action = 'UNCHANGED'; p.warnings.push({ column: null, field: null, code: 'ALREADY_ASSIGNED', message: `La recepción ya está asignada al lote ${lot.lot_code} con ${kg(total)} kg: no se repite.` }); continue; }
              err(p, 'quantity', 'INPUT_ALREADY_ASSIGNED', `La recepción ya está asignada al lote ${lot.lot_code} con ${kg(total)} kg: una asignación no se modifica por importación (libérala desde el lote si corresponde).`); continue;
            }
            if (lot.released.includes(rec.id)) { err(p, 'reception_id', 'INPUT_PREVIOUSLY_RELEASED', `Esta recepción se asignó y se liberó del lote ${lot.lot_code}: volver a asignarla es una decisión explícita desde el lote.`); continue; }
            p.entity_id = lot.id;
            p.expected_version = Number(lot.row_version);
            p.patch._lot_id = lot.id;
            p.action = 'UPDATE';
            p.changed_fields = ['input'];
            p.effects.push(`Mueve ${kg(scaled(v.quantity))} kg de la recepción de ${rec.delivery_code} al lote ${lot.lot_code} (inventario: sale de la recepción y entra al lote, mismo centro).`);
            groupKey.set(p, `L:${lot.id}`);
            continue;
          }
          p.action = 'CREATE';
          p.changed_fields = ['input'];
          p.effects.push(`Crea un lote nuevo (referencia ${reference}) de ${rec.product_code ?? 'producto de la recepción'}, origen ${rec.origin_known ? 'conocido' : 'incompleto'}, y mueve ${kg(scaled(v.quantity))} kg de la recepción de ${rec.delivery_code}.`);
          groupKey.set(p, `R:${reference}`);
        }
        // Coherencia de cada lote nuevo: un producto y un tipo de origen; una recepción una vez por lote.
        const groups = new Map<string, PlannedRow[]>();
        for (const [p, g] of groupKey) groups.set(g, [...(groups.get(g) ?? []), p]);
        for (const [, rows] of groups) {
          const seen = new Map<string, number[]>();
          for (const p of rows) seen.set(p.patch.reception_id!, [...(seen.get(p.patch.reception_id!) ?? []), p.row_number]);
          for (const p of rows) if (seen.get(p.patch.reception_id!)!.length > 1) err(p, 'reception_id', 'DUPLICATE_IN_FILE', `La misma recepción aparece en las filas ${seen.get(p.patch.reception_id!)!.join(', ')} para el mismo lote.`);
          const first = recs.get(rows[0].patch.reception_id!);
          for (const p of rows.slice(1)) {
            const r = recs.get(p.patch.reception_id!);
            if (!first || !r) continue;
            if (r.product_id !== first.product_id) err(p, 'reception_id', 'PRODUCT_MISMATCH', 'Las filas del mismo lote nuevo son de productos distintos: no se suman productos distintos.');
            else if (r.origin_known !== first.origin_known) err(p, 'reception_id', 'ORIGIN_MIXING_BLOCKED', 'Las filas del mismo lote nuevo mezclan origen conocido con origen incompleto: usa lotes separados.');
          }
        }
        // Disponibilidad: lo pedido por recepción en TODO el archivo no puede superar su existencia sin lote (ledger).
        const demand = new Map<string, bigint>();
        for (const p of planned) if ((p.action === 'CREATE' || p.action === 'UPDATE') && !p.errors.length) demand.set(p.patch.reception_id!, (demand.get(p.patch.reception_id!) ?? 0n) + scaled(p.patch.quantity!));
        for (const p of planned) {
          if ((p.action !== 'CREATE' && p.action !== 'UPDATE') || p.errors.length) continue;
          const rec = recs.get(p.patch.reception_id!);
          const want = demand.get(p.patch.reception_id!)!;
          if (rec && want > scaled(rec.available)) err(p, 'quantity', 'INSUFFICIENT_AVAILABLE', `Lo pedido para esta recepción en el archivo (${kg(want)} kg) supera lo disponible sin lote (${kg(scaled(rec.available) < 0n ? 0n : scaled(rec.available))} kg).`);
        }
      },
      apply: async (trx, ctx, user, p, from, requestId) => {
        const input = { reception_id: p.patch.reception_id!, quantity: p.patch.quantity! };
        const org = ctx.organizationId;
        if (p.action === 'UPDATE') {
          await lots.assignInTx(trx, ctx, user.id, p.patch._lot_id!, input, uuidFrom(org, 'INPUT', p.patch._lot_id!, input.reception_id), requestId, from);
          return { id: p.patch._lot_id!, reviews: 0 };
        }
        const ref = p.patch._reference!;
        const prior = await trx.selectFrom('import_references').select('lot_id').where('organization_id', '=', org).where('template', '=', LOT_TEMPLATE_VERSION).where('reference', '=', ref).executeTakeFirst();
        if (prior?.lot_id) {
          // Otra fila de este mismo lote nuevo ya lo creó en esta confirmación: se le añade la entrada.
          await lots.assignInTx(trx, ctx, user.id, prior.lot_id, input, uuidFrom(org, 'REF-INPUT', ref, input.reception_id), requestId, from);
          return { id: prior.lot_id, reviews: 0 };
        }
        const lot = await lots.createLotInTx(trx, ctx, user.id, [{ ...input, operation_id: uuidFrom(org, 'REF-INPUT', ref, input.reception_id) }], uuidFrom(org, 'REF-LOT', ref), requestId, from);
        await trx.insertInto('import_references').values({
          organization_id: org, template: LOT_TEMPLATE_VERSION, reference: ref, origin: 'FILE_REFERENCE', delivery_id: null, lot_id: lot.id,
          batch_id: String(from.source.import_batch_id), row_number: p.row_number, created_by: user.id,
        } as never).execute();
        return { id: lot.id, reviews: 0 };
      },
    };
  }

  private deliveryTemplate(): ImportTemplate {
    const deliveries = this.deliveries;
    const producers = this.producers;
    const products = this.products;
    /** operation_id estable del alta a partir de la REFERENCIA de importación (no del contenido). */
    const opIdFor = (orgId: string, reference: string) => {
      const h = createHash('sha256').update(JSON.stringify([orgId, DELIVERY_TEMPLATE_VERSION, 'REF', reference])).digest('hex');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${(8 | (parseInt(h[16], 16) & 3)).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
    };
    const normDec = (v: string | null | undefined) => {
      if (v === null || v === undefined) return null;
      const [i, f = ''] = String(v).split('.');
      const ii = i.replace(/^0+(?=\d)/, '');
      const ff = f.replace(/0+$/, '');
      return ff ? `${ii}.${ff}` : ii;
    };
    type Dto = { product_id?: string | null; location_id?: string | null; delivery_date?: string | null; quantity_declared?: string | null; unit?: 'KG' | null;
      harvest_period?: { precision: 'DAY' | 'MONTH' | 'UNKNOWN'; start?: string; end?: string } | null; origins?: Array<{ plot_id: string; quantity?: string }>; notes?: string | null };
    return {
      version: DELIVERY_TEMPLATE_VERSION, slug: 'deliveries', sheet: DELIVERY_TEMPLATE_SHEET, entity: 'entregas', keyField: 'delivery_code', keyOptional: true,
      mappingRequiredAnyOf: ['delivery_code', 'producer_code'],
      fields: DELIVERY_FIELDS, rules: DELIVERY_TEMPLATE_RULES, newStatus: 'DRAFT', entityColumn: 'delivery_id',
      usePermissions: ['delivery:create', 'delivery:create_assigned'], samplePermissions: ['producer:read_identity'],
      keyFormatMessage: 'Código de entrega no válido: usa el código asignado por Terra Link (p. ej. ENT-2026-00012).',
      concurrency: { codes: ['VERSION_CONFLICT', 'DELIVERY_REGISTERED', 'PRODUCER_INACTIVE', 'PRODUCT_INACTIVE', 'LOCATION_INACTIVE', 'PLOT_INACTIVE', 'NOT_FOUND'], constraints: ['deliveries_operation_uq', 'deliveries_org_code_uq', 'import_references_ref_uq'] },
      codeOf: async (db, orgId, ids) => new Map((ids.length ? await db.selectFrom('deliveries').select(['id', 'delivery_code']).where('organization_id', '=', orgId).where('id', 'in', ids).execute() : []).map((r) => [r.id, r.delivery_code])),
      resolve: async (db, ctx, planned, colOf, lock) => {
        const org = ctx.organizationId;
        const col = (f: string) => colOf.get(f) ?? null;
        const err = (p: PlannedRow, field: string | null, code: string, message: string) => p.errors.push({ column: field ? col(field) : null, field, code, message });
        // Referencias de importación del archivo → entregas ya importadas con esa referencia.
        const refs = [...new Set(planned.map((p) => p.patch.import_reference).filter((r): r is string => typeof r === 'string'))];
        const refRows = new Map((refs.length ? await db.selectFrom('import_references').select(['reference', 'delivery_id']).where('organization_id', '=', org).where('template', '=', DELIVERY_TEMPLATE_VERSION).where('reference', 'in', refs).execute() : []).map((r) => [r.reference, r.delivery_id]));
        const keyed = planned.filter((p) => p.key).map((p) => p.key!);
        let byCodeQ = db.selectFrom('deliveries as d').innerJoin('producers as pr', (j) => j.onRef('pr.id', '=', 'd.producer_id').onRef('pr.organization_id', '=', 'd.organization_id'))
          .selectAll('d').select(['pr.assigned_membership_id as producer_assignee', 'pr.producer_code']).where('d.organization_id', '=', org);
        if (lock) byCodeQ = byCodeQ.orderBy('d.id').forUpdate('d');
        const refIds = [...refRows.values()];
        const loaded = (keyed.length || refIds.length) ? await byCodeQ.where((eb) => eb.or([...(keyed.length ? [eb('d.delivery_code', 'in', keyed)] : []), ...(refIds.length ? [eb('d.id', 'in', refIds)] : [])])).execute() : [];
        const existingByCode = new Map(loaded.map((r) => [r.delivery_code, r]));
        const existingById = new Map(loaded.map((r) => [r.id, r]));
        const producerRows = await producers.byCodes(db, org, [...new Set(planned.map((p) => p.patch.producer_code).filter((c): c is string => typeof c === 'string'))]);
        const productRows = await products.byCodes(db, org, [...new Set(planned.map((p) => p.patch.product_code).filter((c): c is string => typeof c === 'string'))]);
        const locCodes = [...new Set(planned.map((p) => p.patch.location_code).filter((c): c is string => typeof c === 'string'))];
        const locationRows = new Map((locCodes.length ? await db.selectFrom('locations').select(['id', 'code', 'status']).where('organization_id', '=', org).where('code', 'in', locCodes).execute() : []).map((r) => [r.code, r]));
        const parsedOrigins = new Map<PlannedRow, Array<{ code: string; quantity?: string }>>();
        for (const p of planned) {
          const o = p.patch.origins;
          if (typeof o === 'string') parsedOrigins.set(p, o.split(';').map((x) => { const [code, quantity] = x.split(':'); return { code, ...(quantity ? { quantity } : {}) }; }));
        }
        const plotCodes = [...new Set([...parsedOrigins.values()].flat().map((o) => o.code))];
        const plotRows = plotCodes.length ? await db.selectFrom('plots').select(['id', 'plot_code', 'producer_id', 'status']).where('organization_id', '=', org).where('plot_code', 'in', plotCodes).execute() : [];
        const existingIds = [...existingByCode.values()].map((d) => d.id);
        const originRows = existingIds.length ? await db.selectFrom('delivery_origins').select(['delivery_id', 'plot_id', sql<string | null>`origin_quantity::text`.as('q')]).where('organization_id', '=', org).where('delivery_id', 'in', existingIds).execute() : [];
        const originsOf = (id: string) => originRows.filter((o) => o.delivery_id === id).map((o) => `${o.plot_id}:${normDec(o.q) ?? ''}`).sort().join(';');

        // Identidad de cada fila: código asignado o referencia de importación. Sin ninguna, la fila no se puede identificar
        // entre importaciones: se pide resolverlo (no se deduplica por contenido). Referencias repetidas en el archivo: error.
        const refSeen = new Map<string, number[]>();
        for (const p of planned) { const r = p.patch.import_reference; if (typeof r === 'string') refSeen.set(r, [...(refSeen.get(r) ?? []), p.row_number]); }
        for (const p of planned) {
          const r = p.patch.import_reference;
          if (typeof r === 'string' && refSeen.get(r)!.length > 1) err(p, 'import_reference', 'DUPLICATE_IN_FILE', `Referencia repetida en las filas ${refSeen.get(r)!.join(', ')}: cada entrega necesita su propia referencia.`);
          else if (!p.key && typeof r !== 'string' && !p.errors.length) err(p, 'import_reference', 'REFERENCE_REQUIRED', 'Fila sin código de entrega ni referencia de importación: no se puede identificar entre importaciones. Añade una referencia única (p. ej. el número de tu planilla) o el código de entrega.');
        }

        for (const p of planned) {
          if (p.errors.length) continue;
          const v = p.patch;
          const dto: Dto = {};
          if (v.product_code !== undefined) dto.product_id = null;
          if (v.location_code !== undefined) dto.location_id = null;
          if (v.delivery_date !== undefined) {
            if (v.delivery_date !== null && (Number.isNaN(Date.parse(`${v.delivery_date}T00:00:00Z`)) || new Date(`${v.delivery_date}T00:00:00Z`).toISOString().slice(0, 10) !== v.delivery_date)) { err(p, 'delivery_date', 'DATE_INVALID', 'Fecha de entrega no válida.'); continue; }
            dto.delivery_date = v.delivery_date;
          }
          if (v.quantity_declared !== undefined) {
            if (v.quantity_declared !== null && !(Number(v.quantity_declared) > 0)) { err(p, 'quantity_declared', 'MUST_BE_POSITIVE', 'La cantidad declarada debe ser mayor que cero.'); continue; }
            if (v.quantity_declared !== null && typeof v.unit !== 'string') { err(p, 'unit', 'UNIT_REQUIRED', 'Indica la unidad (KG) de la cantidad declarada; no se asume ninguna.'); continue; }
            dto.quantity_declared = v.quantity_declared;
          }
          if (v.unit !== undefined) dto.unit = v.unit as 'KG' | null;
          if (v.notes !== undefined) dto.notes = v.notes;
          // Periodo de cosecha: se trata como una unidad, tal como se declara; nunca se deduce de la fecha de entrega.
          if (v.harvest_precision === null) {
            if (typeof v.harvest_start === 'string' || typeof v.harvest_end === 'string') { err(p, 'harvest_precision', 'PERIOD_DATES_WITHOUT_PRECISION', 'Para quitar el periodo deja vacías sus fechas.'); continue; }
            dto.harvest_period = null;
          } else if (typeof v.harvest_precision === 'string') {
            const hp = { precision: v.harvest_precision as 'DAY' | 'MONTH' | 'UNKNOWN', ...(typeof v.harvest_start === 'string' ? { start: v.harvest_start } : {}), ...(typeof v.harvest_end === 'string' ? { end: v.harvest_end } : {}) };
            try { harvestColumns(hp); } catch (e) { const ae = e as AppError; err(p, 'harvest_precision', ae.code ?? 'HARVEST_PERIOD_INVALID', ae.message); continue; }
            dto.harvest_period = hp;
          } else if (typeof v.harvest_start === 'string' || typeof v.harvest_end === 'string') {
            err(p, 'harvest_precision', 'PERIOD_PRECISION_REQUIRED', 'Indica la precisión del periodo (DAY, MONTH o UNKNOWN); no se deduce de las fechas.'); continue;
          }

          // Entrega existente: por código asignado o por la referencia de una importación anterior.
          let existing: (typeof existingByCode extends Map<string, infer R> ? R : never) | undefined;
          const reference = typeof v.import_reference === 'string' ? v.import_reference : null;
          const refDelivery = reference ? refRows.get(reference) : undefined;
          if (p.key) {
            existing = existingByCode.get(p.key);
            if (!existing || !deliveries.canReadFor(ctx, existing.producer_assignee)) { err(p, 'delivery_code', 'CODE_NOT_AVAILABLE', 'Ese código de entrega no está disponible para tu importación.'); continue; }
            if (refDelivery && refDelivery !== existing.id) { err(p, 'import_reference', 'REFERENCE_CODE_MISMATCH', 'La referencia de importación corresponde a otra entrega distinta del código indicado.'); continue; }
          } else if (refDelivery) {
            existing = existingById.get(refDelivery);
            if (!existing || !deliveries.canReadFor(ctx, existing.producer_assignee)) { err(p, 'import_reference', 'REFERENCE_NOT_AVAILABLE', 'Esa referencia de importación ya está en uso y no está disponible para tu importación.'); continue; }
            p.warnings.push({ column: col('import_reference'), field: 'import_reference', code: 'REFERENCE_KNOWN', message: `La referencia ya se importó como ${existing.delivery_code}: se compara con ella (no se crea otra).` });
          }
          const producerCode = v.producer_code;
          let producerId: string;
          if (existing) {
            if (typeof producerCode === 'string' && producerCode !== existing.producer_code) { err(p, 'producer_code', 'DELIVERY_PRODUCER_CHANGE_NOT_ALLOWED', 'El productor no coincide con el de la entrega: no se cambia por importación.'); continue; }
            producerId = existing.producer_id;
          } else {
            if (typeof producerCode !== 'string') { err(p, 'producer_code', 'REQUIRED_FOR_CREATE', 'Código de productor: obligatorio para una entrega nueva.'); continue; }
            const pr = producerRows.get(producerCode);
            // Inexistente o fuera del alcance de alta: misma respuesta (no revela existencia, id, datos ni estado).
            if (!pr || !deliveries.canWriteFor(ctx, pr.assigned_membership_id)) { err(p, 'producer_code', 'PRODUCER_NOT_AVAILABLE', 'El productor indicado no está disponible para ti en esta organización.'); continue; }
            if (pr.status !== 'ACTIVE') { err(p, 'producer_code', 'PRODUCER_INACTIVE', 'El productor no está activo; no se le registran entregas.'); continue; }
            producerId = pr.id;
          }
          if (typeof v.product_code === 'string') {
            const pd = productRows.get(v.product_code);
            if (!pd) { err(p, 'product_code', 'PRODUCT_NOT_AVAILABLE', 'El producto indicado no está disponible en esta organización.'); continue; }
            if (pd.status !== 'ACTIVE') { err(p, 'product_code', 'PRODUCT_INACTIVE', 'El producto no está activo.'); continue; }
            dto.product_id = pd.id;
          }
          if (typeof v.location_code === 'string') {
            const l = locationRows.get(v.location_code);
            if (!l) { err(p, 'location_code', 'LOCATION_NOT_AVAILABLE', 'El centro indicado no está disponible en esta organización.'); continue; }
            if (l.status !== 'ACTIVE') { err(p, 'location_code', 'LOCATION_INACTIVE', 'El centro no está activo.'); continue; }
            dto.location_id = l.id;
          }
          if (v.origins === null) dto.origins = [];
          else if (parsedOrigins.has(p)) {
            const list = parsedOrigins.get(p)!;
            if (new Set(list.map((o) => o.code)).size !== list.length) { err(p, 'origins', 'ORIGIN_DUPLICATED', 'Una parcela aparece dos veces en los orígenes.'); continue; }
            const out: Array<{ plot_id: string; quantity?: string }> = [];
            let bad = false;
            for (const o of list) {
              const pl = plotRows.find((x) => x.plot_code === o.code && x.producer_id === producerId);
              // Inexistente o de otro productor: misma respuesta.
              if (!pl) { err(p, 'origins', 'ORIGIN_NOT_AVAILABLE', `La parcela ${o.code} no está disponible como origen de esta entrega.`); bad = true; break; }
              if (pl.status !== 'ACTIVE') { err(p, 'origins', 'PLOT_INACTIVE', `La parcela ${o.code} no está activa.`); bad = true; break; }
              if (o.quantity !== undefined && !(Number(o.quantity) > 0)) { err(p, 'origins', 'MUST_BE_POSITIVE', 'La cantidad por origen debe ser mayor que cero.'); bad = true; break; }
              out.push({ plot_id: pl.id, ...(o.quantity !== undefined ? { quantity: o.quantity } : {}) });
            }
            if (bad) continue;
            dto.origins = out;
          }

          if (!existing) {
            p.action = 'CREATE';
            p.changed_fields = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== null);
            p.patch = { _producer_id: producerId, _operation_id: opIdFor(org, reference!), _reference: reference!, _dto: JSON.stringify(dto) };
            continue;
          }
          // Comparación con lo registrado para no generar efectos si nada cambia.
          const cur = existing;
          const changed: string[] = [];
          if ('product_id' in dto && dto.product_id !== cur.product_id) changed.push('product_id');
          if ('location_id' in dto && dto.location_id !== cur.location_id) changed.push('location_id');
          if ('delivery_date' in dto && dto.delivery_date !== ymd(cur.delivery_date)) changed.push('delivery_date');
          if ('quantity_declared' in dto && normDec(dto.quantity_declared) !== normDec(cur.quantity_declared as string | null)) changed.push('quantity_declared');
          if ('unit' in dto && dto.unit !== cur.unit) changed.push('unit');
          if ('notes' in dto && (dto.notes ?? null) !== (cur.notes ?? null)) changed.push('notes');
          if ('harvest_period' in dto) {
            const h = harvestColumns(dto.harvest_period ?? null)!;
            if (h.harvest_precision !== cur.harvest_precision || h.harvest_start !== cur.harvest_start || h.harvest_end !== cur.harvest_end) changed.push('harvest_period');
          }
          if (dto.origins && dto.origins.map((o) => `${o.plot_id}:${normDec(o.quantity) ?? ''}`).sort().join(';') !== originsOf(cur.id)) changed.push('origins');
          if (changed.length && cur.status === 'REGISTERED') { err(p, null, 'DELIVERY_REGISTERED', `La entrega ${cur.delivery_code} está registrada: no se modifica por importación; usa la corrección de la entrega.`); continue; }
          if (changed.length && !deliveries.canWriteFor(ctx, cur.producer_assignee)) { err(p, null, 'PERMISSION_DENIED_UPDATE', 'Tu rol no permite modificar esta entrega.'); continue; }
          if (changed.length && 'quantity_declared' in dto && dto.quantity_declared && !('unit' in dto)) { err(p, 'unit', 'UNIT_REQUIRED', 'Indica la unidad (KG) de la cantidad declarada.'); continue; }
          p.entity_id = cur.id;
          p.expected_version = Number(cur.row_version);
          p.changed_fields = changed;
          const field = (k: string) => (k === 'harvest_period' ? 'harvest_period' : k);
          p.patch = { _dto: JSON.stringify(Object.fromEntries(changed.map((k) => [field(k), (dto as Record<string, unknown>)[k]]).concat(changed.includes('quantity_declared') && !changed.includes('unit') ? [['unit', dto.unit ?? cur.unit]] : []))) };
          p.action = changed.length ? 'UPDATE' : 'UNCHANGED';
        }
      },
      apply: async (trx, ctx, user, p, from, requestId) => {
        const dto = JSON.parse(p.patch._dto ?? '{}') as Dto;
        if (p.action === 'CREATE') {
          const row = await deliveries.createDraftInTx(trx, ctx, user.id, { ...dto, producer_id: p.patch._producer_id! }, p.patch._operation_id!, requestId, from);
          await trx.insertInto('import_references').values({
            organization_id: ctx.organizationId, template: DELIVERY_TEMPLATE_VERSION, reference: p.patch._reference!, origin: 'FILE_REFERENCE', delivery_id: row.id,
            batch_id: String(from.source.import_batch_id), row_number: p.row_number, created_by: user.id,
          }).execute();
          return { id: row.id, reviews: 0 };
        }
        await deliveries.updateDraftInTx(trx, ctx, user.id, p.entity_id!, { ...dto, expected_version: p.expected_version! } as UpdateDeliveryDto, requestId, from);
        return { id: p.entity_id!, reviews: 0 };
      },
    };
  }

  private plotTemplate(): ImportTemplate {
    const plots = this.plots;
    const producers = this.producers;
    const EDITABLE = ['name', 'crop', 'variety', 'land_use', 'province', 'canton', 'parish'];
    const has = (ctx: TenantContext, p: string) => ctx.permissions.includes(p as Permission);
    return {
      version: PLOT_TEMPLATE_VERSION, slug: 'plots', sheet: PLOT_TEMPLATE_SHEET, entity: 'parcelas', keyField: 'plot_code',
      fields: PLOT_FIELDS, rules: PLOT_TEMPLATE_RULES, newStatus: 'ACTIVE', entityColumn: 'plot_id',
      usePermissions: ['plot:create', 'plot:create_assigned', 'plot:update', 'plot:update_assigned'],
      samplePermissions: ['plot:read_geometry', 'producer:read_identity'],
      keyFormatMessage: 'Código no válido: letras, números, punto, guion o guion bajo (1–40).',
      concurrency: { codes: ['PLOT_CODE_TAKEN', 'VERSION_CONFLICT', 'NO_CHANGE', 'PRODUCER_NOT_AVAILABLE', 'PRODUCER_INACTIVE', 'PLOT_INACTIVE'], constraints: ['plots_code_uq', 'plot_versions_number_uq'] },
      codeOf: async (db, orgId, ids) => new Map((ids.length ? await db.selectFrom('plots').select(['id', 'plot_code']).where('organization_id', '=', orgId).where('id', 'in', ids).execute() : []).map((r) => [r.id, r.plot_code])),
      resolve: async (db, ctx, planned, colOf, lock) => {
        const keyCol = colOf.get('plot_code') ?? null;
        const prodCol = colOf.get('producer_code') ?? null;
        const canCreate = has(ctx, 'plot:create') || has(ctx, 'plot:create_assigned');
        const existing = await plots.byCodes(db, ctx.organizationId, planned.filter((p) => p.key).map((p) => p.key!), lock);
        const producerCodes = [...new Set(planned.map((p) => p.patch.producer_code).filter((c): c is string => typeof c === 'string'))];
        const producerRows = await producers.byCodes(db, ctx.organizationId, producerCodes);
        // Mismo mensaje para referencias inexistentes y fuera de alcance: no revelan existencia, id, datos ni estado.
        const codeNotAvailable = (p: PlannedRow) => p.errors.push({ column: keyCol, field: 'plot_code', code: 'CODE_NOT_AVAILABLE', message: 'Ese código de parcela no está disponible para tu importación.' });
        const producerNotAvailable = (p: PlannedRow) => p.errors.push({ column: prodCol, field: 'producer_code', code: 'PRODUCER_NOT_AVAILABLE', message: 'El productor indicado no está disponible para ti en esta organización.' });
        for (const p of planned) {
          const area = p.patch.area_declared_ha;
          if (typeof area === 'string' && !p.errors.some((e) => e.field === 'area_declared_ha') && !(Number(area) > 0)) p.errors.push({ column: colOf.get('area_declared_ha') ?? null, field: 'area_declared_ha', code: 'INVALID_AREA', message: 'La superficie declarada debe ser mayor que 0 hectáreas.' });
          if (!p.key || p.errors.length) continue;
          const row = existing.get(p.key);
          const { producer_code: producerCode, area_declared_ha: _a, ...rest } = p.patch;
          void _a;
          if (!row) {
            if (!canCreate) { codeNotAvailable(p); continue; }
            for (const f of PLOT_FIELDS.filter((x) => x.requiredOnCreate)) {
              if (typeof p.patch[f.field] !== 'string') p.errors.push({ column: colOf.get(f.field) ?? null, field: f.field, code: 'REQUIRED_FOR_CREATE', message: `${f.label}: obligatorio para una parcela nueva.` });
            }
            if (p.errors.length) continue;
            const producer = producerRows.get(producerCode!);
            if (!producer || !plots.scope(ctx, producer.assigned_membership_id).create) { producerNotAvailable(p); continue; }
            if (producer.status === 'INACTIVE') { p.errors.push({ column: prodCol, field: 'producer_code', code: 'PRODUCER_INACTIVE', message: 'El productor está dado de baja; no se le registran parcelas.' }); continue; }
            const fields = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null));
            p.action = 'CREATE';
            p.patch = { ...fields, ...(typeof area === 'string' ? { area_declared_ha: area } : {}), _producer_id: producer.id };
            p.changed_fields = [...Object.keys(fields), ...(typeof area === 'string' ? ['area_declared_ha'] : [])];
            continue;
          }
          const scope = plots.scope(ctx, row.producer_assignee);
          if (!scope.read) { codeNotAvailable(p); continue; }
          if (row.status === 'INACTIVE') { p.errors.push({ column: null, field: null, code: 'PLOT_INACTIVE', message: 'La parcela está dada de baja; no se reactiva ni se edita por importación.' }); continue; }
          if (!scope.update) { p.errors.push({ column: null, field: null, code: 'PERMISSION_DENIED_UPDATE', message: 'Tu rol no permite modificar esta parcela.' }); continue; }
          if (typeof producerCode === 'string' && producerCode !== row.producer_code) {
            p.errors.push({ column: prodCol, field: 'producer_code', code: 'PLOT_PRODUCER_CHANGE_NOT_ALLOWED', message: 'El productor no coincide con el de la parcela: la importación no reasigna parcelas.' });
            continue;
          }
          const changed = EDITABLE.filter((k) => k in rest && rest[k] !== row[k as PlotEditable]);
          // La superficie declarada se actualiza conservando la geometría vigente (mismo caso de uso que el formulario).
          const areaChanged = typeof area === 'string' && (row.current_area_declared_ha === null || Number(row.current_area_declared_ha) !== Number(area));
          p.entity_id = row.id;
          p.expected_version = Number(row.row_version);
          p.changed_fields = [...changed, ...(areaChanged ? ['area_declared_ha'] : [])];
          p.patch = { ...Object.fromEntries(changed.map((k) => [k, rest[k]])), ...(areaChanged ? { area_declared_ha: area as string } : {}) };
          p.action = p.changed_fields.length ? 'UPDATE' : 'UNCHANGED';
        }
      },
      apply: async (trx, ctx, user, p, from, requestId) => {
        const { area_declared_ha: area, _producer_id: producerId, ...fields } = p.patch;
        let id = p.entity_id;
        let version = p.expected_version;
        if (p.action === 'CREATE') {
          const r = await plots.createInTx(trx, ctx, user, producerId!, p.key!, fields as Partial<Record<PlotEditable, string | null>> & { crop: string }, requestId, from);
          id = r.plot.id;
          version = Number(r.plot.row_version);
        } else if (Object.keys(fields).length) {
          const r = await plots.updateInTx(trx, ctx, user, id!, version!, fields as Partial<Record<PlotEditable, string | null>>, requestId, from);
          version = Number(r.after.row_version);
        }
        if (typeof area === 'string') await plots.updateDeclaredAreaInTx(trx, ctx, user, id!, version!, area, requestId, from);
        return { id: id!, reviews: 0 };
      },
    };
  }

  private templateInfoOf(t: ImportTemplate) {
    return {
      template: t.version, sheet: t.sheet, entity: t.entity, key_field: t.keyField, clear_token: CLEAR_TOKEN, new_status: t.newStatus,
      fields: t.fields.map((f) => ({ field: f.field, header: f.header, label: f.label, required: !!f.required, required_on_create: !!f.requiredOnCreate, immutable: !!f.immutable, clearable: !!f.clearable, catalog: f.catalog ?? null, identity: f.identity, max_length: f.maxLength, rule: f.rule })),
      rules: t.rules, atomicity: ATOMICITY,
      limits: { max_file_bytes: MAX_FILE_BYTES, max_rows: DEFAULT_XLSX_LIMITS.maxRows, max_columns: DEFAULT_XLSX_LIMITS.maxColumns, formats: ['.xlsx'] },
      not_implemented: [] as string[],
    };
  }

  async templateInfo(user: AuthUser, orgId: string, slug: string) {
    const t = this.bySlug(slug);
    await this.ctx(user, orgId, false, t);
    return this.templateInfoOf(t);
  }

  /** Plantillas que este rol puede usar (la UI no ofrece las demás; el servidor las rechaza igual). */
  async availableTemplates(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, false);
    return Object.values(this.templates).map((t) => ({ template: t.version, slug: t.slug, entity: t.entity, usable: this.usable(ctx, t), required_permission: t.usePermissions?.join(' | ') ?? null }));
  }

  async template(user: AuthUser, orgId: string, slug: string) {
    const t = this.bySlug(slug);
    const ctx = await this.ctx(user, orgId, false, t);
    const help = t.helpSheets ? await t.helpSheets(ctx) : [];
    const catalogs = t.slug === 'products' ? await this.products.catalogs(this.db) : null;
    return {
      version: t.version,
      bytes: writeXlsx([
        { name: t.sheet, rows: [t.fields.map((f) => f.header)], widths: t.fields.map((f) => Math.max(14, f.header.length + 4)) },
        {
          name: 'instrucciones',
          rows: [
            ['columna', 'campo', 'obligatorio', 'dato de identidad', 'regla'],
            ...t.fields.map((f) => [f.header, f.label, f.required ? 'sí' : f.requiredOnCreate ? 'para altas' : 'no', f.identity ? 'sí' : 'no', f.rule]),
            ...(catalogs ? [[], ['catálogo', 'códigos admitidos'], ['estado_presentacion', [...catalogs.states].sort().join(', ')], ['unidad', [...catalogs.units].sort().join(', ')]] : []),
            [], ['reglas generales'], ...t.rules.map((r) => [r]),
            [], [`plantilla ${t.version}`],
          ],
          widths: [20, 22, 12, 16, 100],
        },
        ...help,
      ]),
    };
  }

  // ------------------------------------------------------------------ carga

  async upload(user: AuthUser, orgId: string, operationId: string | undefined, template: string | undefined, file: UploadedXlsx | undefined, requestId?: string) {
    if (!operationId || !/^[0-9a-f-]{36}$/i.test(operationId)) throw new AppError(400, 'VALIDATION_FAILED', 'operation_id es obligatorio (UUID).', [{ field: 'operation_id', reason: 'REQUIRED_UUID' }]);
    const t = this.tpl(template ?? PRODUCER_TEMPLATE_VERSION);
    if (!file) throw new AppError(400, 'VALIDATION_FAILED', 'Adjunta un archivo .xlsx.', [{ field: 'file', reason: 'REQUIRED' }]);
    const ctx = await this.ctx(user, orgId, true, t);
    if (!/\.xlsx$/i.test(file.originalname ?? '')) {
      throw new AppError(422, 'FILE_TYPE_NOT_ALLOWED', 'Solo se aceptan libros de Excel .xlsx (sin macros). Los formatos .xls, .xlsm y .csv no se admiten.', [{ field: 'file', reason: 'EXTENSION' }]);
    }
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const prior = await this.db.selectFrom('import_batches').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', operationId).executeTakeFirst();
    if (prior) {
      if (prior.sha256 !== hash || prior.template !== t.version) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro archivo. Vuelve a seleccionar el archivo.');
      return { replayed: true, batch: await this.batchView(ctx, prior) };
    }

    let sheet;
    try {
      sheet = readXlsx(file.buffer, t.sheet);
    } catch (e) {
      if (e instanceof XlsxError) throw new AppError(422, e.code, e.message, [{ field: 'file', reason: e.code }]);
      throw e;
    }
    const [head, ...data] = sheet.rows;
    if (!head || data.length === 0) throw new AppError(422, 'FILE_EMPTY', 'La hoja no tiene filas de datos debajo de los encabezados.', [{ field: 'file', reason: 'FILE_EMPTY' }]);
    if (data.length > DEFAULT_XLSX_LIMITS.maxRows) throw new AppError(422, 'FILE_TOO_MANY_ROWS', `La hoja tiene más de ${DEFAULT_XLSX_LIMITS.maxRows} filas de datos.`);
    const width = Math.max(head.cells.length, ...data.map((r) => r.cells.length));
    const headers = Array.from({ length: width }, (_, i) => ({ column: colName(i), header: (head.cells[i]?.value ?? '').trim().slice(0, 120) || null }));

    const id = randomUUID();
    try {
      const batch = await this.db.transaction().execute(async (trx) => {
        const row = await trx.insertInto('import_batches').values({
          id, organization_id: orgId, template: t.version, status: 'UPLOADED', sha256: hash, byte_size: file.buffer.length,
          original_filename: (file.originalname ?? '').slice(0, 255) || null, sheet_name: sheet.name.slice(0, 120), headers: JSON.stringify(headers),
          row_count: data.length, operation_id: operationId, created_by: user.id,
        }).returningAll().executeTakeFirstOrThrow();
        for (let i = 0; i < data.length; i += 500) {
          await trx.insertInto('import_rows').values(data.slice(i, i + 500).map((r) => {
            const cells: Record<string, StoredCell> = {};
            r.cells.forEach((c: XlsxCell | undefined, ci) => { if (c && (c.value !== '' || c.formula)) cells[colName(ci)] = { v: c.value, ...(c.formula ? { f: 1 as const } : {}), ...(c.numeric ? { n: 1 as const } : {}) }; });
            return { organization_id: orgId, batch_id: id, row_number: r.rowNumber, cells_enc: this.cipher.encrypt(JSON.stringify(cells), rowAad(orgId, id, r.rowNumber)) };
          })).execute();
        }
        await this.audit.record(trx, {
          organizationId: orgId, actorUserId: user.id, action: 'import.upload', entityType: 'import_batch', entityId: id, requestId, result: 'SUCCESS',
          after: { template: t.version, sha256: hash, byte_size: file.buffer.length, rows: data.length, columns: width },
        });
        return row;
      });
      return { replayed: false, batch: await this.batchView(ctx, batch) };
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'import_batches_operation_uq') {
        const again = await this.db.selectFrom('import_batches').selectAll().where('organization_id', '=', orgId).where('operation_id', '=', operationId).executeTakeFirst();
        if (again && again.sha256 === hash) return { replayed: true, batch: await this.batchView(ctx, again) };
        throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro archivo.');
      }
      throw e;
    }
  }

  /** Lote de la organización. Un lote de una plantilla que el rol no puede usar → 403 (no se muestra su contenido). */
  private async load(db: Db, ctx: TenantContext, id: string, lock = false) {
    let q = db.selectFrom('import_batches').selectAll().where('organization_id', '=', ctx.organizationId).where('id', '=', id);
    if (lock) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    if (!row) throw notFound();
    const t = this.tpl(row.template);
    if (!this.usable(ctx, t)) throw forbidden('PERMISSION_DENIED', `Tu rol no permite gestionar ${t.entity}: el permiso general de importación no basta.`);
    return { b: row, t };
  }

  private async rows(db: Db, b: Batch) {
    const rows = await db.selectFrom('import_rows').selectAll().where('organization_id', '=', b.organization_id).where('batch_id', '=', b.id).orderBy('row_number').execute();
    return rows.map((r) => ({ ...r, cells: r.cells_enc ? JSON.parse(this.cipher.decrypt(r.cells_enc, rowAad(b.organization_id, b.id, r.row_number))) as Record<string, StoredCell> : null }));
  }

  /** Vista del lote. Muestras de columnas: con identidad visible, todas; si no, solo de columnas mapeadas a campos no personales. */
  private async batchView(ctx: TenantContext, b: Batch) {
    const t = this.tpl(b.template);
    const byKey = new Map(t.fields.map((f) => [f.field, f]));
    const headers = b.headers as Array<{ column: string; header: string | null }>;
    const mapping = (b.mapping as Mapping | null)?.columns ?? {};
    const identity = this.identity(ctx);
    const allSamples = t.samplePermissions.every((p) => ctx.permissions.includes(p));
    const sampleRows = b.status === 'DISCARDED' ? [] : (await this.rows(this.db, b)).slice(0, 3);
    const byHeader = new Map(t.fields.map((f) => [normHeader(f.header), f.field]));
    const previous = await this.db.selectFrom('import_batches').select(['id', 'status', 'created_at', 'closed_at'])
      .where('organization_id', '=', b.organization_id).where('sha256', '=', b.sha256).where('template', '=', b.template).where('id', '!=', b.id).orderBy('created_at', 'desc').limit(5).execute();
    return {
      id: b.id, template: b.template, entity: t.entity, status: b.status, row_version: Number(b.row_version), created_at: b.created_at, closed_at: b.closed_at,
      file: { filename: b.original_filename, byte_size: b.byte_size, sha256: b.sha256, sheet: b.sheet_name }, row_count: b.row_count,
      columns: headers.map((h) => {
        const mapped = mapping[h.column] ?? null;
        const showSamples = allSamples || (mapped !== null && !byKey.get(mapped)?.identity);
        return {
          column: h.column, header: h.header, mapped_field: mapped,
          suggested_field: h.header ? byHeader.get(normHeader(h.header)) ?? null : null,
          samples: showSamples ? sampleRows.map((r) => r.cells?.[h.column]?.v ?? '').filter((v) => v !== '').map((v) => v.slice(0, 60)) : null,
        };
      }),
      samples_hidden_reason: allSamples ? null : t.slug === 'plots'
        ? 'Una columna sin asociar puede traer coordenadas o datos personales: solo se muestran ejemplos de columnas asociadas a campos de esta plantilla, porque tu rol no ve coordenadas exactas o datos de identidad.'
        : 'Tu rol no ve datos de identidad: las muestras solo se muestran para columnas asociadas a campos no personales.',
      mapping: b.mapping ? mapping : null, summary: b.summary,
      same_file_previous_imports: previous,
      atomicity: ATOMICITY,
      can_map_identity: identity || !t.fields.some((f) => f.identity),
    };
  }

  async list(user: AuthUser, orgId: string) {
    const ctx = await this.ctx(user, orgId, false);
    const usable = Object.values(this.templates).filter((t) => this.usable(ctx, t)).map((t) => t.version);
    return this.db.selectFrom('import_batches')
      .select(['id', 'template', 'status', 'original_filename', 'row_count', 'summary', 'created_at', 'closed_at'])
      .where('organization_id', '=', orgId).where('template', 'in', usable).orderBy('created_at', 'desc').limit(20).execute();
  }

  async get(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, false);
    return this.batchView(ctx, (await this.load(this.db, ctx, id)).b);
  }

  // ------------------------------------------------------------------ mapeo

  async setMapping(user: AuthUser, orgId: string, id: string, dto: MappingDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, true);
    return this.db.transaction().execute(async (trx) => {
      const { b, t } = await this.load(trx, ctx, id, true);
      if (b.status === 'COMMITTED' || b.status === 'DISCARDED') throw conflict(b.status === 'COMMITTED' ? 'IMPORT_ALREADY_COMMITTED' : 'IMPORT_DISCARDED', 'Este lote ya está cerrado.');
      if (Number(b.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona cambió este lote. Recarga para ver el mapeo actual.');
      const byKey = new Map(t.fields.map((f) => [f.field, f]));
      const columns = new Set((b.headers as Array<{ column: string }>).map((h) => h.column));
      const out: Record<string, string> = {};
      const issues: Array<{ field: string; reason: string }> = [];
      const used = new Set<string>();
      for (const [col, field] of Object.entries(dto.columns ?? {})) {
        if (field === null || field === '') continue;
        if (!columns.has(col)) { issues.push({ field: col, reason: 'UNKNOWN_COLUMN' }); continue; }
        const def = byKey.get(field);
        if (!def) { issues.push({ field: col, reason: 'UNKNOWN_FIELD' }); continue; }
        if (used.has(field)) { issues.push({ field: col, reason: 'FIELD_MAPPED_TWICE' }); continue; }
        used.add(field);
        out[col] = def.field;
      }
      const anyOf = t.mappingRequiredAnyOf ?? [t.keyField];
      if (!anyOf.some((f) => used.has(f))) issues.push({ field: anyOf.join('|'), reason: 'REQUIRED_FIELD_NOT_MAPPED' });
      if (issues.length) throw new AppError(422, 'MAPPING_INVALID', 'Revisa el mapeo: cada campo una sola vez, columnas existentes y el código asociado.', issues);
      const identityMapped = Object.values(out).filter((f) => byKey.get(f)!.identity);
      if (identityMapped.length && !this.identity(ctx)) {
        throw new AppError(403, 'MAPPING_IDENTITY_NOT_ALLOWED', 'Tu rol no permite importar datos de identidad (documento, teléfono, dirección). Quita esas columnas del mapeo.', identityMapped.map((f) => ({ field: f, reason: 'IDENTITY_PERMISSION_REQUIRED' })));
      }
      const after = await trx.updateTable('import_batches')
        .set({ status: 'MAPPED', mapping: JSON.stringify({ columns: out }), plan_hash: null, mapped_by: user.id, mapped_at: new Date(), row_version: sql`row_version + 1` })
        .where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'import.map', entityType: 'import_batch', entityId: id, requestId, result: 'SUCCESS',
        after: { mapped_fields: Object.values(out), ignored_columns: [...columns].filter((c) => !out[c]).length },
      });
      return this.batchView(ctx, after);
    });
  }

  // ------------------------------------------------------------------ plan (vista previa y confirmación)

  /** Calcula el plan con los permisos y datos ACTUALES. `lock` bloquea las entidades existentes (confirmación). */
  private async plan(db: Db, ctx: TenantContext, b: Batch, t: ImportTemplate, lock: boolean) {
    const mapping = (b.mapping as Mapping).columns;
    const colOf = new Map(Object.entries(mapping).map(([c, f]) => [f, c]));
    const rows = await this.rows(db, b);
    const planned: PlannedRow[] = rows.map((r) => {
      const p: PlannedRow = { row_number: r.row_number, key: null, action: 'ERROR', entity_id: null, expected_version: null, changed_fields: [], fields: {}, errors: [], warnings: [], effects: [], patch: {} };
      for (const def of t.fields) {
        const col = colOf.get(def.field);
        if (!col) { p.fields[def.field] = { state: 'NOT_MAPPED', quality: QUALITY.NOT_MAPPED }; continue; }
        const cell = r.cells?.[col];
        const issue = (code: string, message: string) => p.errors.push({ column: col, field: def.field, code, message });
        if (cell?.f) { issue('FORMULA_NOT_ALLOWED', 'La celda tiene una fórmula; escribe el valor.'); p.fields[def.field] = { state: 'MISSING', quality: QUALITY.MISSING }; continue; }
        const raw = (cell?.v ?? '').trim();
        if (raw === '') { p.fields[def.field] = { state: 'MISSING', quality: QUALITY.MISSING }; continue; }
        if (raw === CLEAR_TOKEN) {
          if (!def.clearable) issue('CANNOT_CLEAR', `${def.label} no se puede vaciar con ${CLEAR_TOKEN}.`);
          p.fields[def.field] = { state: 'CLEAR', quality: QUALITY.CLEAR, value: null };
          if (def.field !== t.keyField) p.patch[def.field] = null;
          continue;
        }
        if (raw.length > def.maxLength) issue('TOO_LONG', `Máximo ${def.maxLength} caracteres.`);
        else if (def.pattern && !def.pattern.test(raw)) issue('INVALID_FORMAT', def.field === t.keyField ? t.keyFormatMessage : def.formatMessage ?? 'Formato no válido.');
        if (cell?.n && (def.field === 'document_number' || def.field === 'phone')) {
          p.warnings.push({ column: col, field: def.field, code: 'NUMERIC_CELL', message: 'Celda numérica de Excel: comprueba que no se perdieron ceros iniciales.' });
        }
        p.fields[def.field] = { state: 'PROVIDED', quality: QUALITY.PROVIDED, value: raw };
        if (def.field === t.keyField) p.key = raw;
        else p.patch[def.field] = raw;
      }
      if (!p.key && !t.keyOptional && !p.errors.some((e) => e.field === t.keyField)) p.errors.push({ column: colOf.get(t.keyField)!, field: t.keyField, code: 'REQUIRED', message: 'Falta el código.' });
      return p;
    });

    // Códigos repetidos dentro del archivo: ninguna de esas filas se aplica (no se elige una «ganadora»).
    const seen = new Map<string, number[]>();
    for (const p of planned) if (p.key) seen.set(p.key, [...(seen.get(p.key) ?? []), p.row_number]);
    for (const p of planned) {
      const dup = p.key ? seen.get(p.key)! : [];
      if (dup.length > 1 && !t.keyRepeats) p.errors.push({ column: colOf.get(t.keyField)!, field: t.keyField, code: 'DUPLICATE_IN_FILE', message: `Código repetido en las filas ${dup.join(', ')}.` });
    }

    await t.resolve(db, ctx, planned, colOf, lock);
    for (const p of planned) if (p.errors.length) { p.action = 'ERROR'; p.entity_id = null; p.expected_version = null; p.changed_fields = []; p.effects = []; }

    const hash = createHash('sha256').update(JSON.stringify([b.id, b.row_version, b.mapping, planned.map((p) => [p.row_number, p.action, p.entity_id, p.expected_version, p.changed_fields, p.errors.map((e) => e.code)])])).digest('hex');
    const count = (a: PlannedRow['action']) => planned.filter((p) => p.action === a).length;
    return {
      rows: planned, plan_hash: hash,
      summary: { total: planned.length, create: count('CREATE'), update: count('UPDATE'), unchanged: count('UNCHANGED'), error: count('ERROR'), warnings: planned.filter((p) => p.warnings.length).length },
    };
  }

  /** Fila para la respuesta: identidad visible solo con producer:read_identity; sin `patch` interno. */
  private rowView(ctx: TenantContext, t: ImportTemplate, p: PlannedRow) {
    const identity = this.identity(ctx);
    const byKey = new Map(t.fields.map((f) => [f.field, f]));
    const fields = Object.fromEntries(Object.entries(p.fields).map(([f, v]) => [f, byKey.get(f)?.identity && !identity && v.value !== undefined ? { ...v, value: v.value === null ? null : '••••' } : v]));
    const { patch: _patch, key, entity_id, ...rest } = p;
    void _patch;
    return { ...rest, code: key, entity_id, [t.entityColumn]: entity_id, ...(t.slug === 'producers' ? { producer_code: key } : {}), fields, validation_status: 'NOT_VALIDATED' as const };
  }

  async preview(user: AuthUser, orgId: string, id: string, q: PreviewQuery) {
    const ctx = await this.ctx(user, orgId, false);
    const { b, t } = await this.load(this.db, ctx, id);
    if (b.status === 'UPLOADED') throw conflict('MAPPING_REQUIRED', 'Asocia primero las columnas a los campos.');
    if (b.status === 'DISCARDED') throw conflict('IMPORT_DISCARDED', 'Este lote fue descartado.');
    if (b.status === 'COMMITTED') throw conflict('IMPORT_ALREADY_COMMITTED', 'Este lote ya se confirmó; consulta su resultado.');
    const plan = await this.plan(this.db, ctx, b, t, false);
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 100;
    return {
      batch_id: b.id, template: b.template, batch_row_version: Number(b.row_version), plan_hash: plan.plan_hash, summary: plan.summary, atomicity: ATOMICITY,
      can_commit: plan.summary.error === 0 && plan.summary.create + plan.summary.update > 0 && ctx.organizationStatus === 'ACTIVE',
      new_status: t.newStatus, persisted: false,
      rows: plan.rows.slice(offset, offset + limit).map((p) => this.rowView(ctx, t, p)), offset, limit,
    };
  }

  // ------------------------------------------------------------------ confirmación

  async commit(user: AuthUser, orgId: string, id: string, dto: CommitDto, requestId?: string) {
    const ctx = await this.ctx(user, orgId, true); // permisos ACTUALES: la autorización de la vista previa no basta
    let tpl: ImportTemplate | null = null;
    try {
      return await this.db.transaction().execute(async (trx) => {
        const { b, t } = await this.load(trx, ctx, id, true);
        tpl = t;
        if (b.status === 'COMMITTED') {
          if (b.commit_operation_id === dto.operation_id) return { replayed: true, batch_id: b.id, status: b.status, summary: b.summary };
          throw conflict('IMPORT_ALREADY_COMMITTED', 'Este lote ya se confirmó.');
        }
        if (b.status === 'DISCARDED') throw conflict('IMPORT_DISCARDED', 'Este lote fue descartado.');
        if (b.status === 'UPLOADED') throw conflict('MAPPING_REQUIRED', 'Asocia primero las columnas a los campos.');
        const plan = await this.plan(trx, ctx, b, t, true);
        if (plan.plan_hash !== dto.plan_hash) {
          throw conflict('PREVIEW_STALE', 'Algo cambió desde la vista previa (datos, permisos o mapeo). No se guardó nada: revisa la vista previa de nuevo.');
        }
        if (plan.summary.error > 0) throw new AppError(422, 'BATCH_HAS_ERRORS', `Hay ${plan.summary.error} fila(s) con error. La importación es atómica: corrige el archivo y vuelve a cargarlo.`);
        if (plan.summary.create + plan.summary.update === 0) throw conflict('NOTHING_TO_IMPORT', 'Todas las filas coinciden con lo registrado: no hay nada que importar.');

        let duplicateReviews = 0;
        for (const p of plan.rows) {
          const from = { reason: `Importación Excel ${b.id} · fila ${p.row_number}`, source: { kind: 'EXCEL_IMPORT', import_batch_id: b.id, row_number: p.row_number, template: b.template } };
          let entityId = p.entity_id;
          let action: 'CREATED' | 'UPDATED' | 'UNCHANGED' = 'UNCHANGED';
          if (p.action === 'CREATE' || p.action === 'UPDATE') {
            let r: { id: string; reviews: number };
            try { r = await t.apply(trx, ctx, user, p, from, requestId); } catch (e) { throw t.slug === 'lots' ? this.lots.mapConstraintError(e) : e; }
            entityId = r.id;
            duplicateReviews += r.reviews;
            action = p.action === 'CREATE' ? 'CREATED' : 'UPDATED';
          }
          await trx.updateTable('import_rows').set({ result_action: action, [t.entityColumn]: entityId, changed_fields: p.changed_fields } as never)
            .where('organization_id', '=', orgId).where('batch_id', '=', b.id).where('row_number', '=', p.row_number).execute();
        }
        const summary = { created: plan.summary.create, updated: plan.summary.update, unchanged: plan.summary.unchanged, failed: 0, duplicate_reviews_pending: duplicateReviews, new_status: t.newStatus };
        await trx.updateTable('import_batches')
          .set({ status: 'COMMITTED', plan_hash: plan.plan_hash, summary: JSON.stringify(summary), commit_operation_id: dto.operation_id, closed_by: user.id, closed_at: new Date(), row_version: sql`row_version + 1` })
          .where('id', '=', b.id).where('organization_id', '=', orgId).execute();
        await this.audit.record(trx, {
          organizationId: orgId, actorUserId: user.id, action: 'import.commit', entityType: 'import_batch', entityId: b.id, requestId, result: 'SUCCESS',
          after: { template: b.template, ...summary, plan_hash: plan.plan_hash, sha256: b.sha256 },
        });
        return { replayed: false, batch_id: b.id, status: 'COMMITTED' as const, summary };
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      const c = (e as { constraint?: string }).constraint;
      if (c === 'import_batches_commit_operation_uq') throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó en otra confirmación.');
      // Cambio concurrente en mitad de la confirmación (p. ej. otra importación creó el mismo código): nada se guardó.
      const t = tpl as ImportTemplate | null;
      if (t && ((code && t.concurrency.codes.includes(code)) || (c && t.concurrency.constraints.includes(c)))) {
        throw conflict('IMPORT_CONCURRENT_CHANGE', `Otro cambio afectó a estos ${t.entity} mientras confirmabas. No se guardó nada: revisa la vista previa de nuevo.`);
      }
      throw e;
    }
  }

  async discard(user: AuthUser, orgId: string, id: string, requestId?: string) {
    const ctx = await this.ctx(user, orgId, true);
    return this.db.transaction().execute(async (trx) => {
      const { b } = await this.load(trx, ctx, id, true);
      if (b.status === 'COMMITTED' || b.status === 'DISCARDED') throw conflict(b.status === 'COMMITTED' ? 'IMPORT_ALREADY_COMMITTED' : 'IMPORT_DISCARDED', 'Este lote ya está cerrado.');
      await trx.updateTable('import_batches').set({ status: 'DISCARDED', closed_by: user.id, closed_at: new Date(), row_version: sql`row_version + 1` })
        .where('id', '=', id).where('organization_id', '=', orgId).execute();
      // Las celdas leídas (pueden traer identidad) no se conservan en un lote descartado.
      await trx.updateTable('import_rows').set({ cells_enc: null }).where('organization_id', '=', orgId).where('batch_id', '=', id).execute();
      await this.audit.record(trx, { organizationId: orgId, actorUserId: user.id, action: 'import.discard', entityType: 'import_batch', entityId: id, requestId, result: 'SUCCESS', after: { rows: b.row_count } });
      return { id, status: 'DISCARDED' as const };
    });
  }

  /** Informe por fila (XLSX de solo texto). Sin valores de identidad: campos, estados, códigos y mensajes. */
  async report(user: AuthUser, orgId: string, id: string, requestId?: string) {
    const ctx = await this.ctx(user, orgId, false);
    const { b, t } = await this.load(this.db, ctx, id);
    const head = ['fila', 'codigo', 'resultado', 'campos_cambiados', 'errores', 'advertencias', ...t.fields.map((f) => `estado_${f.header}`)];
    let body: string[][];
    if (b.status === 'COMMITTED') {
      const rows = await this.db.selectFrom('import_rows').select(['row_number', 'result_action', 'changed_fields', 'producer_id', 'product_id', 'plot_id', 'delivery_id', 'lot_id'])
        .where('organization_id', '=', orgId).where('batch_id', '=', id).orderBy('row_number').execute();
      const idOf = (r: { producer_id: string | null; product_id: string | null; plot_id: string | null; delivery_id: string | null; lot_id: string | null }) => (r.producer_id ?? r.product_id ?? r.plot_id ?? r.delivery_id ?? r.lot_id) as string;
      const codes = await t.codeOf(this.db, orgId, rows.map(idOf).filter(Boolean));
      body = rows.map((r) => [String(r.row_number), codes.get(idOf(r)) ?? '', r.result_action ?? '', (r.changed_fields ?? []).join(' '), '', '']);
    } else if (b.status === 'MAPPED') {
      const plan = await this.plan(this.db, ctx, b, t, false);
      body = plan.rows.map((p) => [String(p.row_number), p.key ?? '', p.action, p.changed_fields.join(' '),
        p.errors.map((e) => `${e.column ?? ''} ${e.code}: ${e.message}`.trim()).join(' | '), p.warnings.map((w) => `${w.column ?? ''} ${w.code}`.trim()).join(' | '),
        ...t.fields.map((f) => `${p.fields[f.field]?.state ?? ''} (${p.fields[f.field]?.quality ?? ''})`)]);
    } else {
      throw conflict(b.status === 'UPLOADED' ? 'MAPPING_REQUIRED' : 'IMPORT_DISCARDED', b.status === 'UPLOADED' ? 'Asocia primero las columnas a los campos.' : 'Este lote fue descartado.');
    }
    await this.audit.record(this.db, { organizationId: orgId, actorUserId: user.id, action: 'import.report_download', entityType: 'import_batch', entityId: id, requestId, result: 'SUCCESS', after: { status: b.status } });
    return {
      filename: `informe-importacion-${b.id.slice(0, 8)}.xlsx`,
      bytes: writeXlsx([{ name: 'informe', rows: [head, ...body] }, { name: 'lote', rows: [['campo', 'valor'], ['lote', b.id], ['plantilla', b.template], ['estado', b.status], ['archivo_sha256', b.sha256], ['atomicidad', ATOMICITY.description], ['validación', 'Datos importados: LEGACY / NOT_VALIDATED. Importar no verifica ni aprueba nada.']] }]),
    };
  }
}

@ApiTags('imports')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/imports')
export class ImportsController {
  constructor(private readonly service: ImportsService) {}

  @Get('templates')
  @ApiOperation({ summary: 'Plantillas de importación y si tu rol puede usarlas' })
  templates(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.availableTemplates(user, orgId);
  }

  @Get('templates/producers')
  @ApiOperation({ summary: 'Reglas de la plantilla de productores (PRODUCTORES_V1)' })
  producersInfo(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.templateInfo(user, orgId, 'producers');
  }

  @Get('templates/producers.xlsx')
  @ApiOperation({ summary: 'Descargar la plantilla de productores' })
  producersFile(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Res() res: Response) {
    return this.sendTemplate(user, orgId, 'producers', res);
  }

  @Get('templates/products')
  @ApiOperation({ summary: 'Reglas de la plantilla de productos (PRODUCTOS_V1); exige product:manage' })
  productsInfo(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.templateInfo(user, orgId, 'products');
  }

  @Get('templates/products.xlsx')
  @ApiOperation({ summary: 'Descargar la plantilla de productos; exige product:manage' })
  productsFile(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Res() res: Response) {
    return this.sendTemplate(user, orgId, 'products', res);
  }

  @Get('templates/lots')
  @ApiOperation({ summary: 'Reglas de la plantilla de lotes (LOTES_V1: asignar recepciones confirmadas); exige lot:create' })
  lotsInfo(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.templateInfo(user, orgId, 'lots');
  }

  @Get('templates/lots.xlsx')
  @ApiOperation({ summary: 'Descargar la plantilla de lotes (incluye la hoja de recepciones disponibles en tu alcance)' })
  lotsFile(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Res() res: Response) {
    return this.sendTemplate(user, orgId, 'lots', res);
  }

  @Get('templates/deliveries')
  @ApiOperation({ summary: 'Reglas de la plantilla de entregas (ENTREGAS_V1, solo borradores); exige permiso de alta de entregas' })
  deliveriesInfo(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.templateInfo(user, orgId, 'deliveries');
  }

  @Get('templates/deliveries.xlsx')
  @ApiOperation({ summary: 'Descargar la plantilla de entregas' })
  deliveriesFile(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Res() res: Response) {
    return this.sendTemplate(user, orgId, 'deliveries', res);
  }

  @Get('templates/plots')
  @ApiOperation({ summary: 'Reglas de la plantilla de parcelas (PARCELAS_V1); exige permiso de alta o edición de parcelas' })
  plotsInfo(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.templateInfo(user, orgId, 'plots');
  }

  @Get('templates/plots.xlsx')
  @ApiOperation({ summary: 'Descargar la plantilla de parcelas' })
  plotsFile(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Res() res: Response) {
    return this.sendTemplate(user, orgId, 'plots', res);
  }

  private async sendTemplate(user: AuthUser, orgId: string, slug: string, res: Response) {
    const { bytes, version } = await this.service.template(user, orgId, slug);
    res.setHeader('Content-Type', MEDIA_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="plantilla-${version.toLowerCase()}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(bytes);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file', 'operation_id'], properties: { file: { type: 'string', format: 'binary' }, operation_id: { type: 'string', format: 'uuid' }, template: { type: 'string', enum: [PRODUCER_TEMPLATE_VERSION, PRODUCT_TEMPLATE_VERSION, PLOT_TEMPLATE_VERSION, DELIVERY_TEMPLATE_VERSION, LOT_TEMPLATE_VERSION], default: PRODUCER_TEMPLATE_VERSION } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  async upload(
    @CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @UploadedFile() file: UploadedXlsx | undefined,
    @Body() body: Record<string, string>, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.service.upload(user, orgId, body?.operation_id, body?.template, file, req.requestId);
    res.status(r.replayed ? 200 : 201);
    return r;
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.list(user, orgId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, orgId, id);
  }

  @Post(':id/mapping')
  @HttpCode(200)
  mapping(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MappingDto, @Req() req: AuthedRequest) {
    return this.service.setMapping(user, orgId, id, dto, req.requestId);
  }

  @Get(':id/preview')
  @ApiOperation({ summary: 'Vista previa (no guarda nada)' })
  preview(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: PreviewQuery) {
    return this.service.preview(user, orgId, id, q);
  }

  @Post(':id/commit')
  async commit(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommitDto, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.commit(user, orgId, id, dto, req.requestId);
    res.status(r.replayed ? 200 : 201);
    return r;
  }

  @Post(':id/discard')
  @HttpCode(200)
  discard(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.service.discard(user, orgId, id, req.requestId);
  }

  @Get(':id/report')
  async report(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const { bytes, filename } = await this.service.report(user, orgId, id, req.requestId);
    res.setHeader('Content-Type', MEDIA_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(bytes);
  }
}
