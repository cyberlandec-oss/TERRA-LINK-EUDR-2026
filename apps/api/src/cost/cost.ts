import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, ValidateNested } from 'class-validator';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, notFound } from '../common/errors';
import { AuthorizationService } from '../authz/authorization.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { AuditService } from '../audit/audit.service';
import { DdService } from '../dd/dd';
import { evaluateRequirements } from '../dd/requirements';
import { scaled } from '../traceability/kde-validator';
import { writeXlsx } from '../imports/xlsx';

// P1-010 — Presupuesto de preparación (RF-41; S3 §33; **D-51**, adoptada el 2026-10-18).
//
// DE DÓNDE SALE EL DINERO
// **Lo declara la organización.** S3 §33 muestra una tabla de conceptos e importes precedida de «Ejemplo»: no
// son tarifas, y en Terra Link **no existe ninguna cifra monetaria medida**. Así que aquí no hay precios
// oficiales, ni costes medidos, ni ofertas de proveedores, ni consultas a servicios externos. Hay **parámetros
// presupuestarios** con concepto, unidad, importe, moneda, vigencia, autor y versión.
//
// DE DÓNDE SALEN LAS CANTIDADES
// **También se declaran**, y quedan marcadas como **ESTIMADAS**. Terra Link **no observa** las actividades que
// se presupuestan, y la diferencia importa:
//   · una **versión de geometría** no demuestra una **visita**;
//   · una **evaluación automática** no demuestra una **revisión humana**;
//   · un **trabajo satelital** no demuestra un **servicio facturado**.
// Lo que sí se observa —parcelas sin ubicación, documentos cargados, requisitos pendientes— se entrega **aparte
// y con su fecha**, para **explicar** el trabajo por delante. **Nunca se convierte en una cantidad de coste.**
//
// AUSENCIA NO ES CERO
// Un concepto sin parámetro vigente, o sin cantidad declarada, **no suma cero**: queda **pendiente de
// presupuestar**, el total se marca **incompleto** y se separa **lo conocido** del presupuesto completo.
//
// LOS DENOMINADORES SON UN REPARTO, NO UN COSTE CONTABLE
// Por **productor distinto** del alcance, y por **tonelada** del **peso físico del ledger** —no el declarado ni
// el disponible tras reservas—, con su cantidad, unidad y fecha de consulta. Sin denominador válido o con cero:
// **«no calculable»**, nunca cero ni infinito. Y **no se reparte entre productores concretos**: es una división
// del presupuesto del escenario, y se dice.
//
// REPRODUCIBLE
// Una estimación guardada **lleva dentro** los parámetros con su versión, las cantidades y los denominadores
// con su fecha. Cambiar una tarifa después **no reescribe** una estimación histórica: las dos tablas son
// append-only.

const CONCEPTOS = ['GEOREFERENCIACION', 'VALIDACION', 'DOCUMENTACION', 'ANALISIS_SATELITAL', 'ADMINISTRACION'] as const;
type Concepto = typeof CONCEPTOS[number];

/** Unidad presupuestaria de cada concepto, fijada por D-51. No es una medición. */
const UNIDAD: Record<Concepto, { unit: string; label: string; que_no_demuestra: string }> = {
  GEOREFERENCIACION: { unit: 'VISITA_PREVISTA', label: 'visita prevista', que_no_demuestra: 'Una versión de geometría registrada NO demuestra una visita.' },
  VALIDACION: { unit: 'REVISION_PREVISTA', label: 'revisión prevista', que_no_demuestra: 'Una evaluación automática NO demuestra una revisión humana.' },
  DOCUMENTACION: { unit: 'EXPEDIENTE_DOCUMENTAL', label: 'expediente documental por preparar o revisar', que_no_demuestra: 'Un documento cargado NO demuestra un expediente preparado o revisado.' },
  ANALISIS_SATELITAL: { unit: 'ANALISIS_PRESUPUESTADO', label: 'análisis presupuestado', que_no_demuestra: 'Un trabajo satelital NO demuestra un servicio facturado.' },
  ADMINISTRACION: { unit: 'HORA_PREVISTA', label: 'hora prevista', que_no_demuestra: 'El sistema no mide horas de trabajo administrativo.' },
};

const DECIMAL = /^\d{1,14}(\.\d{1,6})?$/;
const unscaled = (n: bigint) => {
  const neg = n < 0n; const a = neg ? -n : n;
  const f = (a % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${a / 1_000_000n}${f ? `.${f}` : ''}`;
};
/** Producto de dos decimales escalados a 6, devuelto escalado a 6. Sin coma flotante en ningún punto. */
export const multiplicar = (a: bigint, b: bigint) => (a * b) / 1_000_000n;
/** División exacta a 6 decimales. `null` cuando el divisor es cero: no se devuelve cero ni infinito. */
export const dividir = (a: bigint, b: bigint): string | null => (b === 0n ? null : unscaled((a * 1_000_000n) / b));
/**
 * Un decimal, un formato. `numeric` de Postgres devuelve «250.000000» y el cálculo propio «250»: publicar los
 * dos formatos haría dudar de si son el mismo número. Se normalizan todos al salir.
 */
export const normalizar = (v: string) => unscaled(scaled(v));

class ParametroDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ enum: CONCEPTOS }) @IsIn(CONCEPTOS as unknown as string[]) concept!: Concepto;
  @ApiProperty({ description: 'Importe decimal como texto, p. ej. "2.50"' }) @IsString() @Matches(DECIMAL) amount!: string;
  @ApiProperty({ enum: ['USD'] }) @IsIn(['USD']) currency!: 'USD';
  @ApiProperty() @IsISO8601() valid_from!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() valid_to?: string;
  @ApiProperty({ required: false, description: 'Obligatorio en VALIDACION: qué revisión se presupuesta' })
  @IsOptional() @IsString() @Length(3, 120) validation_kind?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(1, 500) note?: string;
}
class CantidadDto {
  @ApiProperty({ enum: CONCEPTOS }) @IsIn(CONCEPTOS as unknown as string[]) concept!: Concepto;
  @ApiProperty({ description: 'Cantidad decimal como texto. Se declara: el sistema no la observa.' })
  @IsString() @Matches(DECIMAL) quantity!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(1, 300) basis?: string;
}
class EstimacionDto {
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() operation_id?: string;
  @ApiProperty() @IsUUID() lot_id!: string;
  @ApiProperty({ type: [CantidadDto] })
  @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => CantidadDto) quantities!: CantidadDto[];
}

interface Denominadores {
  distinct_producers: { value: number; cost_each: string | null; status: string; why: string | null };
  tonne: { physical_quantity: string; unit: string; source: string; as_of: string; tonnes: string | null; cost_each: string | null; status: string; why: string | null };
  note: string;
}
interface Linea {
  concept: Concepto; unit: string; unit_label: string;
  parameter: { id: string; version: number; amount: string; currency: string; valid_from: string; valid_to: string | null; validation_kind: string | null } | null;
  quantity: string | null; quantity_kind: 'DECLARADA_ESTIMADA' | null; basis: string | null;
  subtotal: string | null; status: 'CALCULADO' | 'SIN_PARAMETRO' | 'SIN_CANTIDAD';
  note: string;
}

@Injectable()
export class CostService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly dd: DdService,
  ) {}

  // ---------------------------------------------------------------- parámetros
  async registrarParametro(user: AuthUser, orgId: string, dto: ParametroDto, requestId?: string) {
    await this.authz.require(user, orgId, 'cost:manage', { mutation: true });
    if (dto.concept === 'VALIDACION' && !dto.validation_kind?.trim()) {
      throw new AppError(422, 'VALIDATION_KIND_REQUIRED', 'En VALIDACION hay que identificar qué revisión se presupuesta.', [{ field: 'validation_kind', reason: 'VALIDATION_KIND_REQUIRED' }]);
    }
    if (dto.concept !== 'VALIDACION' && dto.validation_kind) {
      throw new AppError(422, 'VALIDATION_KIND_NOT_APPLICABLE', 'Solo VALIDACION identifica el tipo de revisión.', [{ field: 'validation_kind', reason: 'VALIDATION_KIND_NOT_APPLICABLE' }]);
    }
    if (dto.valid_to && dto.valid_to.slice(0, 10) < dto.valid_from.slice(0, 10)) {
      throw new AppError(422, 'BUDGET_PERIOD_INVALID', 'La vigencia termina antes de empezar.', [{ field: 'valid_to', reason: 'BUDGET_PERIOD_INVALID' }]);
    }
    const ultima = await this.db.selectFrom('budget_parameters').select('version')
      .where('organization_id', '=', orgId).where('concept', '=', dto.concept)
      .orderBy('version', 'desc').limit(1).executeTakeFirst();
    const version = (ultima?.version ?? 0) + 1;
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('budget_parameters').values({
        id, organization_id: orgId, concept: dto.concept, unit: UNIDAD[dto.concept].unit,
        validation_kind: dto.concept === 'VALIDACION' ? dto.validation_kind!.trim() : null,
        amount: dto.amount, currency: 'USD', valid_from: dto.valid_from.slice(0, 10),
        valid_to: dto.valid_to ? dto.valid_to.slice(0, 10) : null, version,
        note: dto.note?.trim() ?? null, created_by: user.id, operation_id: dto.operation_id,
      } as never).execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'budget.parameter_registered',
        entityType: 'budget_parameter', entityId: id, requestId, result: 'SUCCESS',
        after: { concept: dto.concept, version, amount: dto.amount, currency: 'USD', valid_from: dto.valid_from.slice(0, 10) },
      });
    });
    return this.parametros(user, orgId);
  }

  /** Parámetro VIGENTE por concepto: la versión más alta cuya vigencia cubre hoy. */
  private async vigentes(orgId: string) {
    const r = await sql<{ id: string; concept: Concepto; unit: string; validation_kind: string | null; amount: string; currency: string; valid_from: string; valid_to: string | null; version: number }>`
      SELECT DISTINCT ON (concept) id, concept, unit, validation_kind, amount, currency,
             valid_from::text, valid_to::text, version
      FROM budget_parameters
      WHERE organization_id = ${orgId} AND valid_from <= current_date AND (valid_to IS NULL OR valid_to >= current_date)
      ORDER BY concept, version DESC`.execute(this.db);
    return new Map(r.rows.map((p) => [p.concept, { ...p, amount: normalizar(p.amount) }]));
  }

  async parametros(user: AuthUser, orgId: string) {
    await this.authz.require(user, orgId, 'cost:read', { mutation: false });
    const historial = await sql<{ id: string; concept: Concepto; unit: string; validation_kind: string | null; amount: string; currency: string; valid_from: string; valid_to: string | null; version: number; note: string | null; created_at: string; autor: string | null }>`
      SELECT b.id, b.concept, b.unit, b.validation_kind, b.amount, b.currency, b.valid_from::text, b.valid_to::text,
             b.version, b.note, b.created_at::text,
             btrim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS autor
      FROM budget_parameters b LEFT JOIN users u ON u.id = b.created_by
      WHERE b.organization_id = ${orgId}
      ORDER BY b.concept, b.version DESC`.execute(this.db);
    const vigentes = await this.vigentes(orgId);
    return {
      currency: 'USD',
      concepts: CONCEPTOS.map((c) => ({
        concept: c, unit: UNIDAD[c].unit, unit_label: UNIDAD[c].label,
        current: vigentes.get(c) ?? null,
        pending_budget: !vigentes.has(c),
        note: UNIDAD[c].que_no_demuestra,
      })),
      history: historial.rows.map((p) => ({ ...p, amount: normalizar(p.amount), autor: p.autor || 'Miembro' })),
      note: 'Importes DECLARADOS por la organización como presupuesto. No son precios oficiales, ni costes medidos, '
        + 'ni ofertas de proveedores. Corregir uno es registrar una versión nueva: no se edita ni se borra.',
    };
  }

  // ---------------------------------------------------------------- cálculo
  private async calcular(user: AuthUser, orgId: string, dto: EstimacionDto) {
    const ctx = await this.authz.require(user, orgId, 'cost:read', { mutation: false });
    const lote = await this.db.selectFrom('lots').select(['id', 'lot_code'])
      .where('id', '=', dto.lot_id).where('organization_id', '=', orgId).executeTakeFirst();
    if (!lote) throw notFound();

    const vistos = new Set<string>();
    for (const q of dto.quantities) {
      if (vistos.has(q.concept)) throw new AppError(422, 'QUANTITY_DUPLICATED', `El concepto ${q.concept} aparece dos veces.`, [{ field: 'quantities', reason: 'QUANTITY_DUPLICATED' }]);
      vistos.add(q.concept);
    }
    const porConcepto = new Map(dto.quantities.map((q) => [q.concept, q]));
    const vigentes = await this.vigentes(orgId);
    const consultadoEl = new Date().toISOString();

    const lineas: Linea[] = CONCEPTOS.map((c) => {
      const p = vigentes.get(c) ?? null;
      const q = porConcepto.get(c) ?? null;
      const base: Omit<Linea, 'subtotal' | 'status' | 'note'> = {
        concept: c, unit: UNIDAD[c].unit, unit_label: UNIDAD[c].label,
        parameter: p ? { id: p.id, version: p.version, amount: p.amount, currency: p.currency, valid_from: p.valid_from, valid_to: p.valid_to, validation_kind: p.validation_kind } : null,
        quantity: q?.quantity ?? null,
        quantity_kind: q ? 'DECLARADA_ESTIMADA' : null,
        basis: q?.basis?.trim() ?? null,
      };
      if (!p) return { ...base, subtotal: null, status: 'SIN_PARAMETRO', note: `Sin importe presupuestado para ${c}. No suma cero: queda pendiente de presupuestar.` };
      if (!q) return { ...base, subtotal: null, status: 'SIN_CANTIDAD', note: `Sin cantidad declarada para ${c}. No suma cero: queda pendiente de presupuestar.` };
      return {
        ...base,
        subtotal: unscaled(multiplicar(scaled(p.amount), scaled(q.quantity))),
        status: 'CALCULADO',
        note: `${UNIDAD[c].que_no_demuestra} La cantidad es DECLARADA y estimada por quien presupuesta.`,
      };
    });

    const totalConocido = lineas.reduce((a, l) => a + (l.subtotal ? scaled(l.subtotal) : 0n), 0n);
    const pendientes = lineas.filter((l) => l.status !== 'CALCULADO').map((l) => ({ concept: l.concept, status: l.status }));
    const completo = pendientes.length === 0;

    // ------------------------------------------------ denominadores
    // D-51: peso FÍSICO del ledger. Ni declarado, ni disponible tras reservas.
    const contenido = await this.dd.capture(this.db, ctx, dto.lot_id);

    // Productores DISTINTOS del alcance. Se recorre **todo el grafo de origen** que el expediente ya calculó,
    // no solo las recepciones directas: un lote de proceso no tiene entregas propias, y contar cero ahí haría
    // «no calculable» un reparto que sí se puede hacer.
    const lotesOrigen = [...new Set([dto.lot_id, ...contenido.origin.lots.map((l) => l.id)])];
    const prod = (await sql<{ n: string }>`
      SELECT count(DISTINCT d.producer_id)::text AS n
      FROM lot_inputs i JOIN receptions r ON r.id = i.reception_id JOIN deliveries d ON d.id = r.delivery_id
      WHERE i.lot_id = ANY(${lotesOrigen}::uuid[]) AND d.organization_id = ${orgId}`.execute(this.db)).rows[0];
    const productores = Number(prod?.n ?? 0);
    const fisico = normalizar(contenido.quantities.physical);
    const unidadPeso = contenido.quantities.unit;
    const kg = scaled(fisico);
    const toneladas = unidadPeso === 'KG' ? kg / 1000n : null;

    const porProductor = productores > 0 ? dividir(totalConocido, BigInt(productores) * 1_000_000n) : null;
    const porTonelada = toneladas && toneladas > 0n ? dividir(totalConocido, toneladas) : null;

    const denominadores = {
      distinct_producers: {
        value: productores,
        cost_each: porProductor,
        status: porProductor === null ? 'NO_CALCULABLE' : 'CALCULADO',
        why: productores === 0 ? 'El lote no tiene productores distinguibles en su origen.' : null,
      },
      tonne: {
        physical_quantity: fisico, unit: unidadPeso, source: contenido.quantities.source, as_of: consultadoEl,
        tonnes: toneladas ? unscaled(toneladas) : null,
        cost_each: porTonelada,
        status: porTonelada === null ? 'NO_CALCULABLE' : 'CALCULADO',
        why: unidadPeso !== 'KG' ? `La unidad del lote es ${unidadPeso}: no se convierte ni se suman magnitudes distintas.`
          : !toneladas || toneladas === 0n ? 'El peso físico del ledger es cero: no se divide, y no se devuelve cero ni infinito.' : null,
      },
      note: 'Es una DISTRIBUCIÓN del presupuesto del escenario, no un coste contable demostrado del lote. '
        + 'No se reparte entre productores concretos: no hay regla de asignación individual.',
    };

    // ------------------------------------------------ lo observado, aparte
    const requisitos = evaluateRequirements(contenido);
    const observado = {
      as_of: consultadoEl,
      lot_code: lote.lot_code,
      plots_total: new Set(contenido.plots.map((p) => p.plot_id)).size,
      plots_without_geometry: contenido.plots.filter((p) => !p.geometry_type).length,
      documents: contenido.documents.length,
      requirements_pending: requisitos.filter((r) => r.status !== 'MET').length,
      satellite_provider: contenido.profiles.satellite_provider,
      note: 'Datos OBSERVADOS, con su fecha de consulta. Explican el trabajo por delante; '
        + 'NO son cantidades de coste y no se convierten en ellas.',
    };

    return {
      scope: { kind: 'LOT' as const, id: dto.lot_id, lot_code: lote.lot_code },
      currency: 'USD' as const,
      lines: lineas,
      total: {
        known: unscaled(totalConocido),
        complete: completo,
        pending_concepts: pendientes,
        note: completo
          ? 'Todos los conceptos tienen importe y cantidad declarados.'
          : 'Total INCOMPLETO: es la suma de lo conocido, no el presupuesto completo. Un concepto sin importe o sin cantidad NO suma cero.',
      },
      denominators: denominadores,
      observed: observado,
      disclaimer: 'Presupuesto DECLARADO por la organización para un escenario. No son precios oficiales, costes '
        + 'medidos ni ofertas de proveedores, y no acredita ningún compromiso económico.',
    };
  }

  async estimar(user: AuthUser, orgId: string, dto: EstimacionDto) {
    return { ...(await this.calcular(user, orgId, dto)), saved: false, note: 'Cálculo no guardado.' };
  }

  async guardar(user: AuthUser, orgId: string, dto: EstimacionDto, requestId?: string) {
    await this.authz.require(user, orgId, 'cost:read', { mutation: true });
    if (!dto.operation_id) throw new AppError(400, 'OPERATION_ID_REQUIRED', 'Falta el identificador de operación.', [{ field: 'operation_id', reason: 'OPERATION_ID_REQUIRED' }]);
    const calculo = await this.calcular(user, orgId, dto);
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('cost_estimates').values({
        id, organization_id: orgId, scope_kind: 'LOT', scope_id: dto.lot_id, currency: 'USD',
        total_known: calculo.total.known, complete: calculo.total.complete,
        parameters: JSON.stringify(calculo.lines.map((l) => ({ concept: l.concept, parameter: l.parameter }))),
        quantities: JSON.stringify(calculo.lines.map((l) => ({ concept: l.concept, quantity: l.quantity, kind: l.quantity_kind, basis: l.basis }))),
        denominators: JSON.stringify(calculo.denominators),
        lines: JSON.stringify(calculo.lines),
        observed: JSON.stringify(calculo.observed),
        created_by: user.id, operation_id: dto.operation_id,
      } as never).execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'budget.estimate_saved',
        entityType: 'cost_estimate', entityId: id, requestId, result: 'SUCCESS',
        after: { lot_id: dto.lot_id, total_known: calculo.total.known, complete: calculo.total.complete },
      });
    });
    return this.estimacion(user, orgId, id);
  }

  async estimacion(user: AuthUser, orgId: string, id: string) {
    await this.authz.require(user, orgId, 'cost:read', { mutation: false });
    const e = await sql<{ id: string; scope_id: string; lot_code: string; currency: string; total_known: string; complete: boolean; parameters: unknown; quantities: unknown; denominators: unknown; lines: unknown; observed: unknown; created_at: string; autor: string | null }>`
      SELECT e.id, e.scope_id, l.lot_code, e.currency, e.total_known::text, e.complete,
             e.parameters, e.quantities, e.denominators, e.lines, e.observed, e.created_at::text,
             btrim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS autor
      FROM cost_estimates e JOIN lots l ON l.id = e.scope_id AND l.organization_id = e.organization_id
      LEFT JOIN users u ON u.id = e.created_by
      WHERE e.id = ${id} AND e.organization_id = ${orgId}`.execute(this.db);
    const r = e.rows[0];
    if (!r) throw notFound();
    return {
      id: r.id, scope: { kind: 'LOT', id: r.scope_id, lot_code: r.lot_code }, currency: r.currency,
      lines: r.lines, total: { known: normalizar(r.total_known), complete: r.complete },
      denominators: r.denominators, observed: r.observed,
      created_at: r.created_at, created_by: r.autor || 'Miembro', saved: true,
      note: 'Estimación GUARDADA con los parámetros y cantidades que usó. Cambiar una tarifa después no la '
        + 'reescribe: se registra una versión nueva del parámetro y se calcula otra estimación.',
    };
  }

  async estimaciones(user: AuthUser, orgId: string) {
    await this.authz.require(user, orgId, 'cost:read', { mutation: false });
    const r = await sql<{ id: string; lot_code: string; total_known: string; complete: boolean; created_at: string; autor: string | null }>`
      SELECT e.id, l.lot_code, e.total_known::text, e.complete, e.created_at::text,
             btrim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS autor
      FROM cost_estimates e JOIN lots l ON l.id = e.scope_id AND l.organization_id = e.organization_id
      LEFT JOIN users u ON u.id = e.created_by
      WHERE e.organization_id = ${orgId} ORDER BY e.created_at DESC LIMIT 100`.execute(this.db);
    return { estimates: r.rows.map((x) => ({ ...x, total_known: normalizar(x.total_known), autor: x.autor || 'Miembro' })), currency: 'USD' };
  }

  async descargar(user: AuthUser, orgId: string, id: string) {
    const e = await this.estimacion(user, orgId, id);
    const lineas = e.lines as Linea[];
    const d = e.denominators as Denominadores;
    const bytes = writeXlsx([
      {
        name: 'presupuesto',
        rows: [
          ['concepto', 'unidad presupuestaria', 'importe', 'versión', 'cantidad declarada', 'subtotal', 'estado'],
          ...lineas.map((l) => [l.concept, l.unit_label, l.parameter?.amount ?? '', String(l.parameter?.version ?? ''), l.quantity ?? '', l.subtotal ?? '', l.status]),
          [''],
          ['total conocido', e.total.known, 'USD', e.total.complete ? 'completo' : 'INCOMPLETO'],
          ['por productor distinto', d.distinct_producers.cost_each ?? 'no calculable', `${d.distinct_producers.value} productor(es)`, d.distinct_producers.status],
          ['por tonelada', d.tonne.cost_each ?? 'no calculable', `${d.tonne.physical_quantity} ${d.tonne.unit} (ledger, ${d.tonne.as_of.slice(0, 10)})`, d.tonne.status],
        ],
        widths: [26, 34, 14, 10, 20, 14, 16],
      },
      {
        name: 'supuestos',
        rows: [
          ['aviso', 'Presupuesto DECLARADO por la organización. No son precios oficiales, costes medidos ni ofertas de proveedores.'],
          ['cantidades', 'DECLARADAS y estimadas: Terra Link no observa estas actividades.'],
          ['denominadores', d.note],
          ...lineas.map((l) => [l.concept, l.note]),
        ],
        widths: [26, 110],
      },
    ]);
    return { bytes, filename: `presupuesto-${e.scope.lot_code}-${e.created_at.slice(0, 10)}.xlsx` };
  }
}

@ApiTags('cost')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/cost')
export class CostController {
  constructor(private readonly service: CostService) {}

  @Get('parameters')
  @ApiOperation({ summary: 'Parámetros presupuestarios: vigentes, historial y conceptos pendientes de presupuestar' })
  parametros(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.parametros(u, o); }

  @Post('parameters')
  @ApiOperation({ summary: 'Registrar una versión de parámetro presupuestario (importe declarado, no una tarifa)' })
  registrar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: ParametroDto, @Req() req: AuthedRequest) {
    return this.service.registrarParametro(u, o, dto, req.requestId);
  }

  @Post('estimates/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Calcular el presupuesto de un escenario SIN guardarlo' })
  estimar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: EstimacionDto) {
    return this.service.estimar(u, o, dto);
  }

  @Post('estimates')
  @ApiOperation({ summary: 'Guardar una estimación con los parámetros y cantidades que usó' })
  guardar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: EstimacionDto, @Req() req: AuthedRequest) {
    return this.service.guardar(u, o, dto, req.requestId);
  }

  @Get('estimates')
  @ApiOperation({ summary: 'Estimaciones guardadas' })
  estimaciones(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.estimaciones(u, o); }

  @Get('estimates/:id')
  @ApiOperation({ summary: 'Una estimación guardada, tal como se calculó' })
  estimacion(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.estimacion(u, o, id);
  }

  @Get('estimates/:id/download')
  @ApiOperation({ summary: 'Descargar una estimación guardada con sus supuestos' })
  async descargar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.service.descargar(u, o, id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(r.bytes);
  }
}
