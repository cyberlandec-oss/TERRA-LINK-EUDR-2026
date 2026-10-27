import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, conflict, notFound } from '../common/errors';
import { AuthorizationService } from '../authz/authorization.service';
import type { TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { AuditService } from '../audit/audit.service';
import { scaled } from '../traceability/kde-validator';
import { multiplicar, normalizar } from '../cost/cost';

// P1-012 — Precio, prima y pagos informados (RF-43; S3 §32).
//
// LA PREGUNTA
// S3 §32: la mayoría de plataformas responde «¿dónde está el cacao?»; Terra Link debería añadir **«¿cuánto
// recibió el productor?»** —precio, prima, calidad, volumen, frecuencia y **pagos**—. Esto registra el dinero
// de esa operación comercial, pegado a la **entrega que ya existe**: no hay un segundo registro de la misma
// operación, solo el dinero que le faltaba y **su procedencia**.
//
// CINCO DISTINCIONES QUE EL CÓDIGO SOSTIENE, NO SOLO EL TEXTO
//   1. **El presupuesto de P1-010 no es esto.** Aquel es lo que le cuesta a la organización prepararse para
//      EUDR; este es lo que se acordó pagar al productor. Tablas distintas, permisos distintos, pantallas
//      distintas. Ni se suman ni se comparan.
//   2. **Un precio registrado no demuestra que se haya pagado.** El pago vive en otra tabla, es **informado**
//      por una persona y **Terra Link no ejecuta ninguna transferencia**. La respuesta dice, siempre, qué
//      parte está informada y qué parte no.
//   3. **Una prima ausente no es cero.** `NO_DECLARADA` y «declarada con importe 0» son estados distintos, y
//      el total queda **INCOMPLETO** cuando falta, en vez de sumar un cero que nadie declaró.
//   4. **Una prima no se deduce.** Ni de la calidad, ni de la trazabilidad, ni de la conformidad: solo existe
//      si alguien la declaró **con su fundamento**, que es obligatorio en la base de datos.
//   5. **No se convierten unidades ni monedas en silencio.** Si el precio es por KG y la base está en QQ, el
//      importe es **NO_CALCULABLE** y se explica. Lo mismo entre monedas distintas.
//
// APPEND-ONLY
// Corregir es **registrar otra versión** con motivo y puntero a la corregida. Nada se edita, nada se borra, y
// el historial se consulta entero. La concurrencia se resuelve con `expected_record_number`, como las
// correcciones de entrega resuelven la suya con `expected_version`.
//
// PRIVACIDAD (RF-43)
// `economics:*` está **separado de `delivery:*`**: leer o registrar una entrega **no** da acceso a su dinero.
// Y el dato económico **no entra** en el paquete de debida diligencia ni en la vista compartida con el
// comprador: `DdContent` no tiene campos económicos y hay una prueba que lo exige.

const MONEDA = /^[A-Z]{3}$/;

/** Unidades en las que tiene sentido expresar un precio de cacao. Cerrada: no se inventa una unidad. */
const UNIDADES = ['KG', 'QQ', 'TON', 'LB'] as const;

class RegistrarDto {
  @ApiProperty() @IsUUID() operation_id!: string;

  @ApiProperty({ required: false }) @IsOptional() @Matches(/^\d+(\.\d{1,6})?$/) price_amount?: string;
  @ApiProperty({ required: false }) @IsOptional() @Matches(MONEDA) price_currency?: string;
  @ApiProperty({ required: false, enum: UNIDADES }) @IsOptional() @IsIn(UNIDADES as unknown as string[]) price_unit?: string;

  @ApiProperty({ enum: ['CANTIDAD_DECLARADA_EN_ENTREGA', 'CANTIDAD_RECIBIDA', 'SIN_BASE_DECLARADA'] })
  @IsIn(['CANTIDAD_DECLARADA_EN_ENTREGA', 'CANTIDAD_RECIBIDA', 'SIN_BASE_DECLARADA']) basis_kind!: string;

  @ApiProperty({ required: false }) @IsOptional() @Matches(/^\d+(\.\d{1,6})?$/) premium_amount?: string;
  @ApiProperty({ required: false, enum: ['POR_UNIDAD', 'IMPORTE_FIJO'] }) @IsOptional() @IsIn(['POR_UNIDAD', 'IMPORTE_FIJO']) premium_kind?: string;
  @ApiProperty({ required: false }) @IsOptional() @Matches(MONEDA) premium_currency?: string;
  @ApiProperty({ required: false, enum: UNIDADES }) @IsOptional() @IsIn(UNIDADES as unknown as string[]) premium_unit?: string;
  /** Obligatorio si hay prima: una prima sin fundamento declarado no se registra. */
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(3, 500) premium_grounds?: string;

  @ApiProperty({ enum: ['DECLARADO_POR_LA_ORGANIZACION', 'DECLARADO_POR_EL_PRODUCTOR', 'ACTA_O_DOCUMENTO'] })
  @IsIn(['DECLARADO_POR_LA_ORGANIZACION', 'DECLARADO_POR_EL_PRODUCTOR', 'ACTA_O_DOCUMENTO']) source!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(1, 500) source_note?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() source_document_id?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() agreed_on?: string;
}

class CorregirDto extends RegistrarDto {
  @ApiProperty() @IsString() @Length(5, 500) reason!: string;
  /** Concurrencia: la versión que quien corrige tenía delante. */
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) expected_record_number!: number;
}

class PagoDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty() @Matches(/^\d+(\.\d{1,6})?$/) amount!: string;
  @ApiProperty() @Matches(MONEDA) currency!: string;
  @ApiProperty() @IsISO8601() paid_on!: string;
  @ApiProperty() @IsString() @Length(2, 120) method_declared!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(1, 200) reference_declared?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() corrects_payment_id?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(5, 500) reason?: string;
}

@Injectable()
export class EconomicsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  /** La entrega tiene que existir EN esta organización; si no, 404 opaco. */
  private async entrega(ctx: TenantContext, orgId: string, deliveryId: string) {
    const d = await this.db.selectFrom('deliveries as d')
      .innerJoin('producers as p', (j) => j.onRef('p.id', '=', 'd.producer_id').onRef('p.organization_id', '=', 'd.organization_id'))
      .leftJoin('products as pr', 'pr.id', 'd.product_id')
      .select(['d.id', 'd.delivery_code', 'd.status', 'd.producer_id', 'p.producer_code', 'd.quantity_declared', 'd.unit',
        'pr.name as product_name', 'pr.code as product_code'])
      .select(sql<string | null>`d.delivery_date::text`.as('delivery_date'))
      .where('d.id', '=', deliveryId).where('d.organization_id', '=', orgId).executeTakeFirst();
    if (!d) throw notFound('La entrega no existe o no está disponible para ti.');
    void ctx;
    return d;
  }

  /** Cantidad efectivamente recibida, si la hay. Se lee del registro de recepciones, no se deduce. */
  private async recibida(orgId: string, deliveryId: string) {
    const r = await sql<{ q: string | null; unit: string | null; n: number }>`
      SELECT sum(quantity_received)::text AS q, min(unit) AS unit, count(*)::int AS n,
             count(DISTINCT unit)::int AS units
      FROM receptions WHERE delivery_id = ${deliveryId} AND organization_id = ${orgId}`.execute(this.db);
    const row = r.rows[0] as { q: string | null; unit: string | null; n: number; units: number };
    if (!row || row.n === 0) return null;
    // Recepciones en unidades distintas no se suman: eso sería convertir en silencio.
    if (row.units > 1) return { quantity: null, unit: null, mixed: true };
    return { quantity: row.q, unit: row.unit, mixed: false };
  }

  private async versiones(orgId: string, deliveryId: string) {
    return this.db.selectFrom('delivery_economics as e')
      .leftJoin('users as u', 'u.id', 'e.created_by')
      .select(['e.id', 'e.record_number', 'e.corrects_record_id', 'e.reason', 'e.price_amount', 'e.price_currency', 'e.price_unit',
        'e.basis_kind', 'e.basis_quantity', 'e.basis_unit', 'e.premium_amount', 'e.premium_kind', 'e.premium_currency',
        'e.premium_unit', 'e.premium_grounds', 'e.source', 'e.source_note', 'e.source_document_id',
        sql<string | null>`e.agreed_on::text`.as('agreed_on'),
        'e.created_at', 'u.email as author'])
      .where('e.organization_id', '=', orgId).where('e.delivery_id', '=', deliveryId)
      .orderBy('e.record_number', 'desc').execute();
  }

  /**
   * Importe y total. Ninguna conversión: si las unidades o las monedas no coinciden, el resultado es
   * NO_CALCULABLE con su razón. Y la prima no declarada NO suma cero.
   */
  private calcular(v: Awaited<ReturnType<EconomicsService['versiones']>>[number]) {
    const razones: string[] = [];
    let importe: string | null = null;
    if (v.price_amount && v.basis_quantity) {
      if (v.price_unit !== v.basis_unit) {
        razones.push(`El precio está por ${v.price_unit} y la base está en ${v.basis_unit}: no se convierte ninguna unidad en silencio.`);
      } else {
        importe = this.mult(v.price_amount, v.basis_quantity);
      }
    } else if (v.price_amount) {
      razones.push('Hay precio pero no hay base declarada: un precio por unidad no da un importe sin cantidad.');
    }

    let prima: string | null = null;
    const primaEstado: 'NO_DECLARADA' | 'DECLARADA' = v.premium_amount === null ? 'NO_DECLARADA' : 'DECLARADA';
    if (v.premium_amount !== null) {
      if (v.premium_kind === 'IMPORTE_FIJO') prima = normalizar(v.premium_amount);
      else if (v.basis_quantity && v.premium_unit === v.basis_unit) prima = this.mult(v.premium_amount, v.basis_quantity);
      else razones.push(`La prima está por ${v.premium_unit} y la base ${v.basis_unit ? `está en ${v.basis_unit}` : 'no está declarada'}: no se convierte ninguna unidad en silencio.`);
    }

    // Monedas distintas no se suman. Se dice y el total queda sin calcular.
    const monedas = [...new Set([v.price_currency, v.premium_currency].filter(Boolean))] as string[];
    if (monedas.length > 1) razones.push(`El precio está en ${v.price_currency} y la prima en ${v.premium_currency}: no se convierte ninguna moneda.`);

    const sumable = importe !== null && (primaEstado === 'NO_DECLARADA' || prima !== null) && monedas.length <= 1;
    const total = sumable && importe !== null
      ? (prima !== null ? this.suma(importe, prima) : importe)
      : null;

    return {
      currency: monedas.length === 1 ? monedas[0] : null,
      amount: importe ?? 'NO_CALCULABLE',
      premium: prima ?? (primaEstado === 'NO_DECLARADA' ? null : 'NO_CALCULABLE'),
      premium_status: primaEstado,
      premium_note: primaEstado === 'NO_DECLARADA'
        ? 'No se declaró ninguna prima. Ausente no es cero: no se suma, y el total queda incompleto.'
        : 'Prima declarada con su fundamento. No se dedujo de la calidad, la trazabilidad ni la conformidad.',
      total: total ?? 'NO_CALCULABLE',
      complete: total !== null && primaEstado === 'DECLARADA',
      reasons: razones,
      note: total === null
        ? 'El total NO se calcula: arriba está por qué. No se devuelve cero ni se convierte nada.'
        : primaEstado === 'NO_DECLARADA'
          ? 'Total INCOMPLETO: cubre el precio, no una prima que nadie declaró.'
          : 'Total con precio y prima declarados. Es lo acordado, no una prueba de pago.',
    };
  }

  private mult(a: string, b: string) {
    return normalizar(this.dec(multiplicar(scaled(a), scaled(b))));
  }
  private suma(a: string, b: string) {
    return normalizar(this.dec(scaled(a) + scaled(b)));
  }
  /** bigint escalado a seis decimales → texto decimal, sin pasar por coma flotante. */
  private dec(n: bigint) {
    const s = (n < 0n ? -n : n).toString().padStart(7, '0');
    return `${n < 0n ? '-' : ''}${s.slice(0, -6)}.${s.slice(-6)}`;
  }

  // ------------------------------------------------------------------ lectura

  async ver(user: AuthUser, orgId: string, deliveryId: string) {
    const ctx = await this.authz.require(user, orgId, 'economics:read', { mutation: false });
    const d = await this.entrega(ctx, orgId, deliveryId);
    const v = await this.versiones(orgId, deliveryId);
    const pagos = await this.pagosDe(orgId, deliveryId);
    const vigente = v[0] ?? null;
    const calculo = vigente ? this.calcular(vigente) : null;

    return {
      delivery: {
        id: d.id, code: d.delivery_code, status: d.status, producer_code: d.producer_code,
        product: d.product_name ?? null, delivery_date: d.delivery_date,
        quantity_declared: d.quantity_declared ? normalizar(d.quantity_declared) : null, unit: d.unit,
      },
      current: vigente ? this.verFila(vigente, calculo!) : null,
      history: v.map((x) => this.verFila(x, this.calcular(x))),
      payments: pagos,
      state: vigente ? 'REGISTRADO' : 'SIN_REGISTRAR',
      note: vigente
        ? 'Dato económico DECLARADO, con su procedencia. No es un precio de mercado ni una cotización, y Terra Link no consultó ninguna fuente externa.'
        : 'Esta entrega no tiene dato económico registrado. No significa que no se pagara: significa que aquí no consta.',
      not_the_same: 'El presupuesto de preparación (P1-010) es lo que cuesta cumplir EUDR, no el precio del cacao. No se suman ni se comparan.',
    };
  }

  private verFila(v: Awaited<ReturnType<EconomicsService['versiones']>>[number], c: ReturnType<EconomicsService['calcular']>) {
    return {
      record_number: v.record_number,
      corrects_record_id: v.corrects_record_id, reason: v.reason,
      price: v.price_amount ? { amount: normalizar(v.price_amount), currency: v.price_currency, per_unit: v.price_unit } : null,
      basis: { kind: v.basis_kind, quantity: v.basis_quantity ? normalizar(v.basis_quantity) : null, unit: v.basis_unit },
      premium: v.premium_amount !== null
        ? { amount: normalizar(v.premium_amount), kind: v.premium_kind, currency: v.premium_currency, per_unit: v.premium_unit, grounds: v.premium_grounds }
        : null,
      computed: c,
      provenance: { source: v.source, note: v.source_note, document_id: v.source_document_id, agreed_on: v.agreed_on },
      recorded_at: v.created_at, author: v.author ?? 'PLATAFORMA',
    };
  }

  private async pagosDe(orgId: string, deliveryId: string) {
    const filas = await this.db.selectFrom('delivery_payments as p')
      .leftJoin('users as u', 'u.id', 'p.informed_by')
      .select(['p.id', 'p.payment_number', 'p.corrects_payment_id', 'p.reason', 'p.amount', 'p.currency',
        'p.method_declared', 'p.reference_declared', 'p.informed_at', 'u.email as author',
        ])
      .select(sql<string>`p.paid_on::text`.as('paid_on_text'))
      .where('p.organization_id', '=', orgId).where('p.delivery_id', '=', deliveryId)
      .orderBy('p.payment_number', 'asc').execute();
    const corregidos = new Set(filas.map((f) => f.corrects_payment_id).filter(Boolean) as string[]);
    const vigentes = filas.filter((f) => !corregidos.has(f.id));
    const monedas = [...new Set(vigentes.map((f) => f.currency))];
    const suma = monedas.length === 1
      ? normalizar(this.dec(vigentes.reduce((acc, f) => acc + scaled(f.amount), 0n)))
      : null;
    return {
      items: filas.map((f) => ({
        payment_number: f.payment_number, amount: normalizar(f.amount), currency: f.currency,
        paid_on: f.paid_on_text, method_declared: f.method_declared, reference_declared: f.reference_declared,
        corrects_payment_id: f.corrects_payment_id, reason: f.reason,
        superseded: corregidos.has(f.id), informed_at: f.informed_at, author: f.author ?? 'PLATAFORMA',
      })),
      informed_total: suma ?? 'NO_CALCULABLE',
      currency: monedas.length === 1 ? monedas[0] : null,
      currencies_note: monedas.length > 1 ? `Hay pagos en ${monedas.join(' y ')}: no se suman monedas distintas.` : null,
      note: filas.length === 0
        ? 'No hay ningún pago informado. No significa que no se pagara: significa que nadie lo informó aquí.'
        : 'Pagos INFORMADOS por una persona. Terra Link no ejecuta transferencias y no verifica con ningún banco: '
          + 'que conste un pago informado no demuestra que el dinero llegara.',
    };
  }

  // ------------------------------------------------------------------ escritura

  async registrar(user: AuthUser, orgId: string, deliveryId: string, dto: RegistrarDto, requestId?: string) {
    return this.escribir(user, orgId, deliveryId, dto, null, requestId);
  }

  async corregir(user: AuthUser, orgId: string, deliveryId: string, dto: CorregirDto, requestId?: string) {
    return this.escribir(user, orgId, deliveryId, dto, dto, requestId);
  }

  private async escribir(user: AuthUser, orgId: string, deliveryId: string, dto: RegistrarDto, correccion: CorregirDto | null, requestId?: string) {
    const permiso = correccion ? 'economics:correct' : 'economics:record';
    const ctx = await this.authz.require(user, orgId, permiso, { mutation: true });

    // Idempotencia por operación, como el resto de las escrituras del producto.
    const previa = await this.db.selectFrom('delivery_economics').select(['id', 'delivery_id'])
      .where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (previa) {
      if (previa.delivery_id !== deliveryId) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, ...(await this.ver(user, orgId, deliveryId)) };
    }

    const d = await this.entrega(ctx, orgId, deliveryId);
    this.validar(dto);

    // La base se resuelve AHORA y se guarda: cambiar la entrega después no reescribe lo registrado.
    const base = await this.resolverBase(orgId, deliveryId, dto.basis_kind, d);

    if (dto.source_document_id) {
      const doc = await this.db.selectFrom('documents').select('id')
        .where('id', '=', dto.source_document_id).where('organization_id', '=', orgId).executeTakeFirst();
      if (!doc) throw new AppError(422, 'REFERENCE_NOT_FOUND', 'El documento citado como procedencia no existe en esta organización.', [{ field: 'source_document_id', reason: 'no existe' }]);
    }

    await this.db.transaction().execute(async (trx) => {
      // Se bloquea la entrega para serializar dos registros simultáneos sobre el mismo dinero.
      await sql`SELECT id FROM deliveries WHERE id = ${deliveryId} FOR UPDATE`.execute(trx);
      const ultima = await trx.selectFrom('delivery_economics').select(['id', 'record_number'])
        .where('organization_id', '=', orgId).where('delivery_id', '=', deliveryId)
        .orderBy('record_number', 'desc').executeTakeFirst();

      if (correccion) {
        if (!ultima) throw conflict('NOTHING_TO_CORRECT', 'No hay ningún dato económico registrado que corregir.');
        if (ultima.record_number !== correccion.expected_record_number) {
          throw conflict('VERSION_CONFLICT', `Otra persona corrigió este dato (va por la versión ${ultima.record_number}). Recarga antes de corregir.`);
        }
      } else if (ultima) {
        throw conflict('ALREADY_RECORDED', 'Esta entrega ya tiene dato económico. Corrígelo con un motivo en vez de registrar otro.');
      }

      const id = randomUUID();
      await trx.insertInto('delivery_economics').values({
        id, organization_id: orgId, delivery_id: deliveryId,
        record_number: (ultima?.record_number ?? 0) + 1,
        corrects_record_id: correccion ? ultima!.id : null,
        reason: correccion ? correccion.reason.trim() : null,
        price_amount: dto.price_amount ?? null, price_currency: dto.price_currency ?? null, price_unit: dto.price_unit ?? null,
        basis_kind: dto.basis_kind as never, basis_quantity: base.quantity, basis_unit: base.unit,
        premium_amount: dto.premium_amount ?? null, premium_kind: (dto.premium_kind ?? null) as never,
        premium_currency: dto.premium_currency ?? null, premium_unit: dto.premium_unit ?? null,
        premium_grounds: dto.premium_grounds?.trim() ?? null,
        source: dto.source as never, source_note: dto.source_note?.trim() ?? null,
        source_document_id: dto.source_document_id ?? null, agreed_on: dto.agreed_on?.slice(0, 10) ?? null,
        created_by: user.id, operation_id: dto.operation_id,
      }).execute();

      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id,
        action: correccion ? 'economics.corrected' : 'economics.recorded',
        entityType: 'delivery_economics', entityId: id, requestId, result: 'SUCCESS',
        after: {
          delivery_id: deliveryId, record_number: (ultima?.record_number ?? 0) + 1,
          price: dto.price_amount ? `${dto.price_amount} ${dto.price_currency}/${dto.price_unit}` : null,
          premium_declared: dto.premium_amount !== undefined,
          source: dto.source, reason: correccion?.reason.trim() ?? null,
        },
      });
    });

    return { replayed: false, ...(await this.ver(user, orgId, deliveryId)) };
  }

  /** Reglas que el CHECK no puede expresar con un mensaje útil para quien las lee. */
  private validar(dto: RegistrarDto) {
    const campos = (f: string, reason: string) => new AppError(422, reason, mensajes[reason], [{ field: f, reason }]);
    const mensajes: Record<string, string> = {
      PRICE_SHAPE: 'Un precio necesita importe, moneda y unidad: los tres o ninguno.',
      PREMIUM_GROUNDS_REQUIRED: 'Una prima sin fundamento declarado no se registra. Di en qué se basa.',
      PREMIUM_SHAPE: 'Una prima necesita importe, tipo y moneda; si es por unidad, también su unidad.',
      PREMIUM_UNIT_ON_FIXED: 'Un importe fijo no lleva unidad: o es fijo, o es por unidad.',
      NOTHING_TO_RECORD: 'No hay nada que registrar: declara un precio, una prima o ambos.',
      BASIS_SHAPE: 'Sin base declarada no se puede registrar un precio por unidad.',
    };
    const precio = [dto.price_amount, dto.price_currency, dto.price_unit].filter((x) => x !== undefined).length;
    if (precio !== 0 && precio !== 3) throw campos('price_amount', 'PRICE_SHAPE');
    if (dto.premium_amount !== undefined) {
      if (!dto.premium_grounds?.trim()) throw campos('premium_grounds', 'PREMIUM_GROUNDS_REQUIRED');
      if (!dto.premium_kind || !dto.premium_currency) throw campos('premium_kind', 'PREMIUM_SHAPE');
      if (dto.premium_kind === 'POR_UNIDAD' && !dto.premium_unit) throw campos('premium_unit', 'PREMIUM_SHAPE');
      if (dto.premium_kind === 'IMPORTE_FIJO' && dto.premium_unit) throw campos('premium_unit', 'PREMIUM_UNIT_ON_FIXED');
    }
    if (precio === 0 && dto.premium_amount === undefined) throw campos('price_amount', 'NOTHING_TO_RECORD');
    if (dto.basis_kind === 'SIN_BASE_DECLARADA' && precio === 3) throw campos('basis_kind', 'BASIS_SHAPE');
  }

  private async resolverBase(orgId: string, deliveryId: string, kind: string, d: { quantity_declared: string | null; unit: string | null }) {
    if (kind === 'SIN_BASE_DECLARADA') return { quantity: null, unit: null };
    if (kind === 'CANTIDAD_DECLARADA_EN_ENTREGA') {
      if (!d.quantity_declared || !d.unit) {
        throw new AppError(422, 'BASIS_NOT_AVAILABLE', 'La entrega no tiene cantidad declarada con unidad: elige otra base o complétala primero.', [{ field: 'basis_kind', reason: 'BASIS_NOT_AVAILABLE' }]);
      }
      return { quantity: d.quantity_declared, unit: d.unit };
    }
    const r = await this.recibida(orgId, deliveryId);
    if (!r) throw new AppError(422, 'BASIS_NOT_AVAILABLE', 'Esta entrega no tiene ninguna recepción confirmada: todavía no hay cantidad recibida.', [{ field: 'basis_kind', reason: 'BASIS_NOT_AVAILABLE' }]);
    if (r.mixed || !r.quantity || !r.unit) {
      throw new AppError(422, 'BASIS_MIXED_UNITS', 'Las recepciones de esta entrega están en unidades distintas: no se suman ni se convierten.', [{ field: 'basis_kind', reason: 'BASIS_MIXED_UNITS' }]);
    }
    return { quantity: r.quantity, unit: r.unit };
  }

  async informarPago(user: AuthUser, orgId: string, deliveryId: string, dto: PagoDto, requestId?: string) {
    // Informar un pago es un dato económico más: lo registra quien registra, lo corrige quien corrige.
    const permiso = dto.corrects_payment_id ? 'economics:correct' : 'economics:record';
    const ctx = await this.authz.require(user, orgId, permiso, { mutation: true });

    const previa = await this.db.selectFrom('delivery_payments').select(['id', 'delivery_id'])
      .where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (previa) {
      if (previa.delivery_id !== deliveryId) throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      return { replayed: true, ...(await this.ver(user, orgId, deliveryId)) };
    }
    await this.entrega(ctx, orgId, deliveryId);
    if (dto.corrects_payment_id && !dto.reason?.trim()) {
      throw new AppError(422, 'REASON_REQUIRED', 'Corregir un pago informado exige un motivo.', [{ field: 'reason', reason: 'REASON_REQUIRED' }]);
    }

    await this.db.transaction().execute(async (trx) => {
      await sql`SELECT id FROM deliveries WHERE id = ${deliveryId} FOR UPDATE`.execute(trx);
      if (dto.corrects_payment_id) {
        const objetivo = await trx.selectFrom('delivery_payments').select(['id'])
          .where('id', '=', dto.corrects_payment_id).where('organization_id', '=', orgId).where('delivery_id', '=', deliveryId).executeTakeFirst();
        if (!objetivo) throw new AppError(422, 'REFERENCE_NOT_FOUND', 'El pago que intentas corregir no es de esta entrega.', [{ field: 'corrects_payment_id', reason: 'no existe' }]);
        const yaCorregido = await trx.selectFrom('delivery_payments').select('id')
          .where('corrects_payment_id', '=', dto.corrects_payment_id).executeTakeFirst();
        if (yaCorregido) throw conflict('ALREADY_CORRECTED', 'Ese pago ya fue corregido: corrige la versión vigente.');
      }
      const ultimo = await trx.selectFrom('delivery_payments').select('payment_number')
        .where('organization_id', '=', orgId).where('delivery_id', '=', deliveryId)
        .orderBy('payment_number', 'desc').executeTakeFirst();
      const id = randomUUID();
      await trx.insertInto('delivery_payments').values({
        id, organization_id: orgId, delivery_id: deliveryId,
        payment_number: (ultimo?.payment_number ?? 0) + 1,
        corrects_payment_id: dto.corrects_payment_id ?? null, reason: dto.reason?.trim() ?? null,
        amount: dto.amount, currency: dto.currency, paid_on: dto.paid_on.slice(0, 10),
        method_declared: dto.method_declared.trim(), reference_declared: dto.reference_declared?.trim() ?? null,
        informed_by: user.id, operation_id: dto.operation_id,
      }).execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id,
        action: dto.corrects_payment_id ? 'economics.payment_corrected' : 'economics.payment_informed',
        entityType: 'delivery_payment', entityId: id, requestId, result: 'SUCCESS',
        after: { delivery_id: deliveryId, amount: dto.amount, currency: dto.currency, paid_on: dto.paid_on.slice(0, 10), corrects: dto.corrects_payment_id ?? null },
      });
    });
    return { replayed: false, ...(await this.ver(user, orgId, deliveryId)) };
  }

  // ------------------------------------------------------------------ «¿cuánto recibió el productor?»

  async porProductor(user: AuthUser, orgId: string, producerId: string) {
    const ctx = await this.authz.require(user, orgId, 'economics:read', { mutation: false });
    void ctx;
    const p = await this.db.selectFrom('producers').select(['id', 'producer_code'])
      .where('id', '=', producerId).where('organization_id', '=', orgId).executeTakeFirst();
    if (!p) throw notFound('El productor no existe o no está disponible para ti.');

    const entregas = await this.db.selectFrom('deliveries')
      .select(['id', 'delivery_code', 'delivery_date', 'quantity_declared', 'unit'])
      .where('organization_id', '=', orgId).where('producer_id', '=', producerId)
      .orderBy('delivery_date', 'desc').limit(200).execute();

    const filas = [];
    for (const e of entregas) {
      const v = (await this.versiones(orgId, e.id))[0] ?? null;
      const pagos = await this.pagosDe(orgId, e.id);
      filas.push({
        delivery_id: e.id, delivery_code: e.delivery_code, delivery_date: e.delivery_date,
        quantity_declared: e.quantity_declared ? normalizar(e.quantity_declared) : null, unit: e.unit,
        economics: v ? this.verFila(v, this.calcular(v)) : null,
        payments_informed: pagos.informed_total, payments_currency: pagos.currency,
      });
    }

    // Solo se suma lo que es sumable: misma moneda y total calculable. Lo demás se cuenta aparte.
    const calculables = filas.filter((f) => f.economics && f.economics.computed.total !== 'NO_CALCULABLE' && f.economics.computed.currency);
    const monedas = [...new Set(calculables.map((f) => f.economics!.computed.currency))] as string[];
    const sumable = monedas.length === 1;
    const total = sumable ? normalizar(this.dec(calculables.reduce((a, f) => a + scaled(f.economics!.computed.total as string), 0n))) : null;

    return {
      producer: { id: p.id, code: p.producer_code },
      deliveries: filas,
      counts: {
        deliveries: filas.length,
        with_economics: filas.filter((f) => f.economics).length,
        without_economics: filas.filter((f) => !f.economics).length,
        not_computable: filas.filter((f) => f.economics && f.economics.computed.total === 'NO_CALCULABLE').length,
        incomplete_premium: filas.filter((f) => f.economics && f.economics.computed.premium_status === 'NO_DECLARADA').length,
      },
      agreed_total: total ?? 'NO_CALCULABLE',
      currency: sumable ? monedas[0] : null,
      currencies_note: monedas.length > 1 ? `Hay importes en ${monedas.join(' y ')}: no se suman monedas distintas.` : null,
      note: 'Suma SOLO de las entregas con total calculable y una misma moneda. Las entregas sin dato económico '
        + 'no cuentan como cero: se cuentan aparte. Y esto es lo ACORDADO, no lo pagado: los pagos informados van por su lado.',
      not_proof_of_payment: 'Un precio registrado no demuestra que se haya pagado, y un pago informado no lo verifica ningún banco.',
    };
  }
}

@ApiTags('economics')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class EconomicsController {
  constructor(private readonly service: EconomicsService) {}

  @Get('deliveries/:deliveryId/economics')
  @ApiOperation({ summary: 'Precio, prima y pagos informados de una entrega, con su procedencia e historial' })
  ver(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('deliveryId', ParseUUIDPipe) d: string) {
    return this.service.ver(u, o, d);
  }

  @Post('deliveries/:deliveryId/economics')
  @ApiOperation({ summary: 'Registrar el dato económico de una entrega (una sola vez; después se corrige)' })
  registrar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('deliveryId', ParseUUIDPipe) d: string,
    @Body() dto: RegistrarDto, @Req() req: AuthedRequest) {
    return this.service.registrar(u, o, d, dto, req.requestId);
  }

  @Post('deliveries/:deliveryId/economics/corrections')
  @ApiOperation({ summary: 'Corregir el dato económico con un motivo; la versión anterior se conserva' })
  corregir(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('deliveryId', ParseUUIDPipe) d: string,
    @Body() dto: CorregirDto, @Req() req: AuthedRequest) {
    return this.service.corregir(u, o, d, dto, req.requestId);
  }

  @Post('deliveries/:deliveryId/payments')
  @ApiOperation({ summary: 'Informar un pago (o corregir uno informado). Terra Link NO ejecuta transferencias' })
  pago(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('deliveryId', ParseUUIDPipe) d: string,
    @Body() dto: PagoDto, @Req() req: AuthedRequest) {
    return this.service.informarPago(u, o, d, dto, req.requestId);
  }

  @Get('producers/:producerId/economics')
  @ApiOperation({ summary: '¿Cuánto se acordó con este productor? Suma solo lo sumable y cuenta aparte lo demás' })
  porProductor(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('producerId', ParseUUIDPipe) p: string) {
    return this.service.porProductor(u, o, p);
  }
}
