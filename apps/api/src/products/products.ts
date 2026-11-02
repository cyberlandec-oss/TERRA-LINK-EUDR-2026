import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { DB } from '../db/database';
import type { Database, ProductsTable } from '../db/schema';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { EVENT_STORE, type EventStore } from '../events/events';

// P0-011 Productos (UI-09). Catálogo por ORGANIZACIÓN; estados/presentaciones y unidades son catálogos de
// SISTEMA definidos por las fuentes (migración 0014). Código, estado y unidad son inmutables desde la
// creación; el resto se edita con `expected_version` e historial. Sin conversiones de unidad (ninguna está
// definida en el contrato). Cambiar de estado (p. ej. fermentar) es un proceso con evento y rendimiento,
// nunca una edición del catálogo.

export type ProductRow = Selectable<ProductsTable>;
type Db = Kysely<Database> | Transaction<Database>;
export const IMMUTABLE = ['code', 'product_state', 'unit'] as const;
/** Procedencia de un cambio hecho por otro caso de uso (P0-026 Importación): va en motivo, evento y auditoría. */
export interface ChangeSource { reason: string; source: Record<string, unknown> }

class ProductFieldsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) name?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(1, 120) scientific_name?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(1, 120) variety?: string | null;
}

class CreateProductDto extends ProductFieldsDto {
  @ApiProperty({ example: 'CACAO_SECO' }) @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/, { message: 'code: mayúsculas, números, guion o guion bajo (2–40)' }) code!: string;
  @ApiProperty() @IsString() @Length(1, 120) declare name: string;
  @ApiProperty({ description: 'Código de product_states' }) @IsString() @MaxLength(40) product_state!: string;
  @ApiProperty({ description: 'Código de measurement_units' }) @IsString() @MaxLength(16) unit!: string;
}

export class UpdateProductDto extends ProductFieldsDto {
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  // Se aceptan para explicar el rechazo: son inmutables.
  @ApiPropertyOptional() @IsOptional() @IsString() code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() product_state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() unit?: string;
}

class StatusDto {
  @ApiProperty() @IsInt() @Min(1) expected_version!: number;
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

class ListQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'ALL']) status?: 'ACTIVE' | 'INACTIVE' | 'ALL';
  @IsOptional() @IsString() @MaxLength(40) product_state?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

const encodeCursor = (code: string, id: string) => Buffer.from(JSON.stringify([code, id])).toString('base64url');
function decodeCursor(c: string): [string, string] {
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string') return [v[0], v[1]];
  } catch { /* cursor inválido */ }
  throw new AppError(400, 'VALIDATION_FAILED', 'Cursor no válido.');
}

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(EVENT_STORE) private readonly events: EventStore,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private async ctx(user: AuthUser, orgId: string, manage: boolean): Promise<TenantContext> {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    if (!ctx.permissions.includes('product:read')) throw forbidden();
    if (manage) {
      if (!ctx.permissions.includes('product:manage')) throw forbidden();
      if (ctx.organizationStatus !== 'ACTIVE') throw forbidden('ORGANIZATION_SUSPENDED', 'La organización está suspendida; no admite nuevas operaciones.');
    }
    return ctx;
  }

  private async load(db: Db, orgId: string, id: string, lock = false) {
    let q = db.selectFrom('products').selectAll().where('organization_id', '=', orgId).where('id', '=', id);
    if (lock) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    if (!row) throw notFound();
    return row;
  }

  /** Respuesta con unidad y estado explícitos (código + etiqueta + dimensión). */
  private async view(db: Db, p: ProductRow, ctx?: TenantContext) {
    const [state, unit] = await Promise.all([
      db.selectFrom('product_states').select(['code', 'label']).where('code', '=', p.product_state).executeTakeFirstOrThrow(),
      db.selectFrom('measurement_units').select(['code', 'label', 'symbol', 'dimension']).where('code', '=', p.unit).executeTakeFirstOrThrow(),
    ]);
    return {
      id: p.id, code: p.code, name: p.name, scientific_name: p.scientific_name, variety: p.variety,
      product_state: state, unit, status: p.status, status_reason: p.status_reason, row_version: Number(p.row_version),
      immutable_fields: IMMUTABLE, created_at: p.created_at, updated_at: p.updated_at,
      ...(ctx ? { can_manage: ctx.permissions.includes('product:manage') && ctx.organizationStatus === 'ACTIVE' } : {}),
    };
  }

  private snapshot(p: ProductRow) {
    return { code: p.code, name: p.name, product_state: p.product_state, unit: p.unit, scientific_name: p.scientific_name, variety: p.variety, status: p.status };
  }

  private async record(trx: Transaction<Database>, p: ProductRow, change: 'CREATED' | 'UPDATED' | 'DEACTIVATED' | 'ACTIVATED', fields: string[], userId: string, reason: string | null, requestId?: string, source?: Record<string, unknown>) {
    const src = source ? { source } : {};
    await trx.insertInto('product_versions').values({
      product_id: p.id, organization_id: p.organization_id, version: String(p.row_version), change_type: change,
      changed_fields: fields, snapshot: JSON.stringify(this.snapshot(p)), reason, changed_by: userId,
    } as never).execute();
    const eventType = { CREATED: 'ProductCreated', UPDATED: 'ProductUpdated', DEACTIVATED: 'ProductDeactivated', ACTIVATED: 'ProductActivated' }[change];
    await this.events.append(trx, {
      organizationId: p.organization_id, eventType, schemaVersion: 1, aggregateType: 'PRODUCT', aggregateId: p.id,
      aggregateVersion: Number(p.row_version), actorId: userId, correlationId: requestId,
      payload: { product_id: p.id, code: p.code, product_state: p.product_state, unit: p.unit, status: p.status, changed_fields: fields, ...src },
    });
    await this.audit.record(trx, {
      organizationId: p.organization_id, actorUserId: userId, action: `product.${change.toLowerCase()}`, entityType: 'product', entityId: p.id,
      requestId, result: 'SUCCESS', after: { ...this.snapshot(p), changed_fields: fields, ...(reason ? { reason } : {}), ...src },
    });
  }

  async options(user: AuthUser, orgId: string) {
    await this.ctx(user, orgId, false);
    const states = await this.db.selectFrom('product_states').select(['code', 'label', 'source']).orderBy('sort_order').execute();
    const units = await this.db.selectFrom('measurement_units').select(['code', 'label', 'symbol', 'dimension', 'source']).orderBy('code').execute();
    return {
      states, units, conversions: [],
      conversions_note: 'No se aplican conversiones entre unidades mientras no haya factores y redondeo adoptados (D-32). La humedad del secado ya se declara en %BH.',
      immutable_fields: IMMUTABLE,
      transformation_note: 'Cambiar de estado (p. ej. de cacao en baba a fermentado) es un proceso con evento y rendimiento, no una edición del catálogo.',
    };
  }

  async list(user: AuthUser, orgId: string, q: ListQuery) {
    const ctx = await this.ctx(user, orgId, false);
    const limit = q.limit ?? 50;
    let query = this.db.selectFrom('products').selectAll().where('organization_id', '=', orgId);
    const status = q.status ?? 'ACTIVE';
    if (status !== 'ALL') query = query.where('status', '=', status);
    if (q.product_state) query = query.where('product_state', '=', q.product_state);
    if (q.q?.trim()) {
      const like = `%${q.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      query = query.where((eb) => eb.or([eb('code', 'ilike', like), eb('name', 'ilike', like), eb('variety', 'ilike', like)]));
    }
    if (q.cursor) {
      const [code, id] = decodeCursor(q.cursor);
      query = query.where((eb) => eb.or([eb('code', '>', code), eb.and([eb('code', '=', code), eb('id', '>', id)])]));
    }
    const rows = await query.orderBy('code').orderBy('id').limit(limit + 1).execute();
    const page = rows.slice(0, limit);
    const items = [];
    for (const p of page) items.push(await this.view(this.db, p));
    return {
      items,
      next_cursor: rows.length > limit ? encodeCursor(page[page.length - 1].code, page[page.length - 1].id) : null,
      can_manage: ctx.permissions.includes('product:manage') && ctx.organizationStatus === 'ACTIVE',
    };
  }

  async get(user: AuthUser, orgId: string, id: string) {
    const ctx = await this.ctx(user, orgId, false);
    return this.view(this.db, await this.load(this.db, orgId, id), ctx);
  }

  async history(user: AuthUser, orgId: string, id: string) {
    await this.ctx(user, orgId, false);
    await this.load(this.db, orgId, id);
    return this.db.selectFrom('product_versions as v').leftJoin('users as u', 'u.id', 'v.changed_by')
      .select(['v.version', 'v.change_type', 'v.changed_fields', 'v.snapshot', 'v.reason', 'v.changed_at', sql<string>`coalesce(u.first_name || ' ' || u.last_name, 'desconocido')`.as('actor')])
      .where('v.organization_id', '=', orgId).where('v.product_id', '=', id).orderBy('v.version', 'desc').execute();
  }

  private async checkCatalog(db: Db, state: string, unit: string) {
    const s = await db.selectFrom('product_states').select('code').where('code', '=', state).executeTakeFirst();
    if (!s) throw new AppError(422, 'PRODUCT_STATE_UNKNOWN', 'El estado o presentación no existe en el catálogo.', [{ field: 'product_state', reason: 'UNKNOWN' }]);
    const u = await db.selectFrom('measurement_units').select('code').where('code', '=', unit).executeTakeFirst();
    if (!u) throw new AppError(422, 'UNIT_UNKNOWN', 'La unidad no existe en el catálogo.', [{ field: 'unit', reason: 'UNKNOWN' }]);
  }

  async create(user: AuthUser, orgId: string, dto: CreateProductDto, requestId?: string) {
    await this.ctx(user, orgId, true);
    try {
      return await this.db.transaction().execute(async (trx) => {
        return this.view(trx, await this.createInTx(trx, orgId, user, dto, requestId));
      });
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'products_code_uq') throw conflict('PRODUCT_CODE_TAKEN', 'Ya existe un producto con ese código en tu organización.');
      throw e;
    }
  }

  /**
   * Alta dentro de una transacción del llamador (también P0-026 Importación). El llamador ya autorizó product:manage.
   * Mismos efectos que create(): catálogo de estado y unidad, versión CREATED, evento y auditoría.
   */
  async createInTx(trx: Transaction<Database>, orgId: string, user: AuthUser, dto: { code: string; name: string; product_state: string; unit: string; scientific_name?: string | null; variety?: string | null }, requestId?: string, from?: ChangeSource) {
    await this.checkCatalog(trx, dto.product_state, dto.unit);
    const p = await trx.insertInto('products').values({
      id: randomUUID(), organization_id: orgId, code: dto.code, name: dto.name.trim(), product_state: dto.product_state, unit: dto.unit,
      scientific_name: dto.scientific_name?.trim() || null, variety: dto.variety?.trim() || null, status: 'ACTIVE', status_reason: null,
      created_by: user.id, updated_by: user.id,
    } as never).returningAll().executeTakeFirstOrThrow();
    await this.record(trx, p, 'CREATED', ['code', 'name', 'product_state', 'unit', 'scientific_name', 'variety'], user.id, from?.reason ?? null, requestId, from?.source);
    return p;
  }

  async update(user: AuthUser, orgId: string, id: string, dto: UpdateProductDto, requestId?: string) {
    await this.ctx(user, orgId, true);
    return this.db.transaction().execute(async (trx) => this.view(trx, await this.updateInTx(trx, orgId, user, id, dto, requestId)));
  }

  /**
   * Edición dentro de una transacción del llamador (también P0-026 Importación). El llamador ya autorizó product:manage.
   * Mismos controles que update(): inmutables, inactivo, versión esperada; sin cambios no crea versión ni evento.
   */
  async updateInTx(trx: Transaction<Database>, orgId: string, user: AuthUser, id: string, dto: UpdateProductDto, requestId?: string, from?: ChangeSource) {
      const cur = await this.load(trx, orgId, id, true);
      const changedImmutable = IMMUTABLE.filter((f) => dto[f] !== undefined && dto[f] !== cur[f]);
      if (changedImmutable.length) {
        throw new AppError(422, 'PRODUCT_FIELD_IMMUTABLE', 'El código, el estado/presentación y la unidad no se pueden cambiar: cambiarían el significado de operaciones registradas. Crea otro producto.',
          changedImmutable.map((f) => ({ field: f, reason: 'IMMUTABLE' })));
      }
      if (cur.status === 'INACTIVE') throw conflict('PRODUCT_INACTIVE', 'El producto está inactivo; actívalo antes de editarlo.');
      if (Number(cur.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó este producto. Recarga para ver la versión actual; tus cambios se conservan en el formulario.');
      const next = {
        name: dto.name !== undefined ? dto.name.trim() : cur.name,
        scientific_name: dto.scientific_name !== undefined ? (dto.scientific_name?.trim() || null) : cur.scientific_name,
        variety: dto.variety !== undefined ? (dto.variety?.trim() || null) : cur.variety,
      };
      const fields = (Object.keys(next) as Array<keyof typeof next>).filter((k) => next[k] !== cur[k]);
      if (fields.length === 0) return cur;
      const p = await trx.updateTable('products').set({ ...next, row_version: sql`row_version + 1`, updated_at: new Date(), updated_by: user.id } as never)
        .where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
      await this.record(trx, p, 'UPDATED', fields, user.id, from?.reason ?? null, requestId, from?.source);
      return p;
  }

  /** P0-026: productos de la organización por código (vista previa y confirmación de una importación). */
  async byCodes(db: Db, orgId: string, codes: string[], lock = false) {
    if (codes.length === 0) return new Map<string, ProductRow>();
    let q = db.selectFrom('products').selectAll().where('organization_id', '=', orgId).where('code', 'in', codes);
    if (lock) q = q.orderBy('id').forUpdate();
    return new Map((await q.execute()).map((r) => [r.code, r]));
  }

  /** P0-026: catálogos de sistema vigentes (estados/presentaciones y unidades). */
  async catalogs(db: Db) {
    const [states, units] = await Promise.all([
      db.selectFrom('product_states').select('code').execute(),
      db.selectFrom('measurement_units').select('code').execute(),
    ]);
    return { states: new Set(states.map((s) => s.code)), units: new Set(units.map((u) => u.code)) };
  }

  async changeStatus(user: AuthUser, orgId: string, id: string, target: 'ACTIVE' | 'INACTIVE', dto: StatusDto, requestId?: string) {
    await this.ctx(user, orgId, true);
    return this.db.transaction().execute(async (trx) => {
      const cur = await this.load(trx, orgId, id, true);
      if (Number(cur.row_version) !== dto.expected_version) throw conflict('VERSION_CONFLICT', 'Otra persona modificó este producto. Recarga para ver la versión actual.');
      if (cur.status === target) throw conflict('PRODUCT_STATUS_UNCHANGED', target === 'ACTIVE' ? 'El producto ya está activo.' : 'El producto ya está inactivo.');
      const p = await trx.updateTable('products')
        .set({ status: target, status_reason: target === 'INACTIVE' ? dto.reason.trim() : null, row_version: sql`row_version + 1`, updated_at: new Date(), updated_by: user.id } as never)
        .where('id', '=', id).where('organization_id', '=', orgId).returningAll().executeTakeFirstOrThrow();
      await this.record(trx, p, target === 'INACTIVE' ? 'DEACTIVATED' : 'ACTIVATED', ['status'], user.id, dto.reason.trim(), requestId);
      return this.view(trx, p);
    });
  }
}

@ApiTags('products')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get('product-catalog/options')
  options(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.options(user, orgId);
  }

  @Get('products')
  list(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: ListQuery) {
    return this.service.list(user, orgId, q);
  }

  @Post('products')
  create(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: CreateProductDto, @Req() req: AuthedRequest) {
    return this.service.create(user, orgId, dto, req.requestId);
  }

  @Get('products/:id')
  get(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user, orgId, id);
  }

  @Get('products/:id/history')
  history(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.history(user, orgId, id);
  }

  @Patch('products/:id')
  update(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @Req() req: AuthedRequest) {
    return this.service.update(user, orgId, id, dto, req.requestId);
  }

  @Post('products/:id/deactivate')
  @HttpCode(200)
  deactivate(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto, @Req() req: AuthedRequest) {
    return this.service.changeStatus(user, orgId, id, 'INACTIVE', dto, req.requestId);
  }

  @Post('products/:id/activate')
  @HttpCode(200)
  activate(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto, @Req() req: AuthedRequest) {
    return this.service.changeStatus(user, orgId, id, 'ACTIVE', dto, req.requestId);
  }
}
