import { Body, Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { createHash, randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { AppError, conflict, notFound } from '../common/errors';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, type AuthUser, type AuthedRequest } from '../auth/auth';
import { AuthorizationService } from '../authz/authorization.service';
import { LimitsService } from '../limits/limits';

// P1-015 / D-54 — Coste estimado de uso de la PLATAFORMA (RF-46: «decisiones de coste»; `docs/18:216`:
// «límites/coste/SSO comprobados»).
//
// QUÉ ES Y QUÉ NO
//   · Es la estimación, por organización y por un período EXPLÍCITO, de lo que costaría usar Terra Link, en USD,
//     a partir de una tarifa DECLARADA. No es facturación ni cobro ni compromiso comercial.
//   · NO es el presupuesto de preparación de P1-010 (`budget_parameters`, dinero de la organización para preparar
//     su cumplimiento) ni el precio comercial del cacao (`delivery_economics`).
//
// REGLAS
//   · No hay tarifas precargadas. Sin tarifa declarada para un mes, ese mes queda SIN PRECIO: un precio ausente
//     no es cero, y el resultado lo dice (`SIN_TARIFA` / `PARCIAL`).
//   · Una tarifa es un dato versionado con vigencia. Para un mes completo gana la VERSIÓN MÁS RECIENTE que lo cubre
//     por entero; nunca se edita una versión.
//   · El consumo observado se separa de la tarifa, del resultado y de los conceptos que NO se valoran (almacenamiento,
//     eventos, usuarios: la unidad adoptada es la organización, así que se muestran pero no se cobran).
//   · Cada estimación guarda sus entradas y un hash para poder REPRODUCIR el cálculo (`verify`).

const MAX_MESES = 24;
const DECIMAL = /^\d{1,10}(\.\d{1,4})?$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

class TarifaDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ description: 'USD por organización y mes calendario, como cadena decimal (hasta 4 decimales)' })
  @IsString() @Matches(DECIMAL) monthly_fee!: string;
  @ApiProperty({ description: 'Inicio de vigencia (YYYY-MM-DD), incluido' }) @IsString() @Matches(FECHA) valid_from!: string;
  @ApiProperty({ required: false, description: 'Fin de vigencia (YYYY-MM-DD), excluido; vacío = sin fin' })
  @IsOptional() @IsString() @Matches(FECHA) valid_to?: string;
  @ApiProperty({ description: 'true = tarifa sintética de demostración; false = tarifa acordada' }) @IsBoolean() synthetic!: boolean;
  @ApiProperty() @IsString() @Length(3, 120) label!: string;
  @ApiProperty({ description: 'De dónde sale la tarifa (acuerdo, documento, demostración…)' }) @IsString() @Length(3, 500) source!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @Length(3, 500) reason?: string;
}

class EstimacionDto {
  @ApiProperty() @IsUUID() operation_id!: string;
  @ApiProperty({ description: 'Primer día del primer mes (YYYY-MM-01)' }) @IsString() @Matches(FECHA) period_start!: string;
  @ApiProperty({ description: 'Primer día del mes siguiente al último (excluido)' }) @IsString() @Matches(FECHA) period_end!: string;
}

// ---------------------------------------------------------------------------------------------------- aritmética
// Importes en enteros escalados a 4 decimales: sin coma flotante en dinero.
const ESCALA = 10_000n;
export function aEscalado(v: string): bigint {
  const [e, d = ''] = v.split('.');
  return BigInt(e) * ESCALA + BigInt((d + '0000').slice(0, 4));
}
export function deEscalado(n: bigint): string {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const e = a / ESCALA;
  const d = (a % ESCALA).toString().padStart(4, '0');
  return `${neg ? '-' : ''}${e}.${d}`;
}

/** `date` de PostgreSQL llega como Date local o como texto según el cliente: siempre se compara como YYYY-MM-DD. */
function dia(v: unknown): string {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
}

function esFechaValida(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const primeroDeMes = (s: string) => s.endsWith('-01');
function sumarMes(s: string): string {
  const [y, m] = s.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
export function mesesDelPeriodo(inicio: string, fin: string): string[] {
  const out: string[] = [];
  for (let m = inicio; m < fin; m = sumarMes(m)) out.push(m);
  return out;
}

export interface TarifaFila {
  id: string; version: number; monthly_fee: string; valid_from: string; valid_to: string | null;
  synthetic: boolean; label: string;
}
export interface LineaMes {
  month: string; month_end: string;
  tariff_id: string | null; tariff_version: number | null; monthly_fee: string | null; synthetic: boolean | null;
  amount: string | null; reason: string | null;
}

/** Función pura: la tarifa que aplica a un mes completo es la versión más reciente que lo cubre por entero. */
export function calcularLineas(meses: string[], tarifas: TarifaFila[]): LineaMes[] {
  return meses.map((mes) => {
    const fin = sumarMes(mes);
    const cubren = tarifas
      .filter((t) => t.valid_from <= mes && (t.valid_to === null || t.valid_to >= fin))
      .sort((a, b) => b.version - a.version);
    const t = cubren[0];
    if (!t) {
      return { month: mes, month_end: fin, tariff_id: null, tariff_version: null, monthly_fee: null, synthetic: null,
        amount: null, reason: 'NO_HAY_TARIFA_QUE_CUBRA_EL_MES_COMPLETO' };
    }
    return { month: mes, month_end: fin, tariff_id: t.id, tariff_version: t.version, monthly_fee: t.monthly_fee,
      synthetic: t.synthetic, amount: t.monthly_fee, reason: null };
  });
}
export function totalizar(lineas: LineaMes[]): { status: 'ESTIMADO' | 'PARCIAL' | 'SIN_TARIFA'; total: string | null } {
  const con = lineas.filter((l) => l.amount !== null);
  if (con.length === 0) return { status: 'SIN_TARIFA', total: null };
  const suma = con.reduce((acc, l) => acc + aEscalado(l.amount!), 0n);
  return { status: con.length === lineas.length ? 'ESTIMADO' : 'PARCIAL', total: deEscalado(suma) };
}
export function huellaEntradas(orgId: string, inicio: string, fin: string, lineas: LineaMes[]): string {
  const canon = JSON.stringify({
    organization_id: orgId, period_start: inicio, period_end: fin, currency: 'USD', unit: 'ORGANIZACION_MES',
    months: lineas.map((l) => [l.month, l.tariff_id, l.tariff_version, l.monthly_fee]),
  });
  return createHash('sha256').update(canon).digest('hex');
}

@Injectable()
export class PlatformCostService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly limits: LimitsService,
  ) {}

  private async tarifas(orgId: string, hasta?: Date): Promise<Array<TarifaFila & { created_at: string; reason: string | null; source: string; created_by: string }>> {
    const q = sql<{ id: string; version: number; monthly_fee: string; valid_from: string; valid_to: string | null; synthetic: boolean;
      label: string; source: string; reason: string | null; created_at: string; created_by: string }>`
      SELECT id, version, monthly_fee::text, valid_from::text, valid_to::text, synthetic, label, source, reason,
             created_at::text, created_by::text
      FROM platform_tariffs
      WHERE organization_id = ${orgId} AND code = 'PLATAFORMA'
        ${hasta ? sql`AND created_at <= ${hasta}` : sql``}
      ORDER BY version DESC`;
    return (await q.execute(this.db)).rows;
  }

  // ------------------------------------------------------------------ tarifas declaradas
  async listarTarifas(user: AuthUser, orgId: string) {
    await this.authz.require(user, orgId, 'platform_cost:read', { mutation: false });
    return {
      currency: 'USD', unit: 'ORGANIZACION_MES',
      tariffs: await this.tarifas(orgId),
      note: 'Las tarifas son datos declarados por la organización o su operador, con vigencia y versión. No hay '
        + 'tarifas precargadas: una tarifa marcada como sintética es de demostración y no representa ningún acuerdo.',
    };
  }

  async declararTarifa(user: AuthUser, orgId: string, dto: TarifaDto, requestId?: string) {
    await this.authz.require(user, orgId, 'platform_cost:manage', { mutation: true });
    const previa = await this.db.selectFrom('platform_tariffs').select(['id', 'version', 'monthly_fee', 'valid_from'])
      .where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (previa) {
      if (dia(previa.valid_from) !== dto.valid_from || aEscalado(String(previa.monthly_fee)) !== aEscalado(dto.monthly_fee)) {
        throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro contenido.');
      }
      return { replayed: true, ...(await this.listarTarifas(user, orgId)) };
    }
    if (!esFechaValida(dto.valid_from) || (dto.valid_to && !esFechaValida(dto.valid_to))) {
      throw new AppError(422, 'FECHA_INVALIDA', 'Una de las fechas no existe en el calendario.', [{ field: 'valid_from', reason: 'FECHA_INVALIDA' }]);
    }
    if (dto.valid_to && dto.valid_to <= dto.valid_from) {
      throw new AppError(422, 'VIGENCIA_INVALIDA', 'El fin de vigencia debe ser posterior al inicio.', [{ field: 'valid_to', reason: 'VIGENCIA_INVALIDA' }]);
    }
    const ultima = await this.db.selectFrom('platform_tariffs').select('version')
      .where('organization_id', '=', orgId).where('code', '=', 'PLATAFORMA').orderBy('version', 'desc').executeTakeFirst();
    const version = (ultima?.version ?? 0) + 1;
    if (version > 1 && !dto.reason?.trim()) {
      throw new AppError(422, 'REASON_REQUIRED', 'Declarar otra versión de la tarifa exige un motivo.', [{ field: 'reason', reason: 'REASON_REQUIRED' }]);
    }
    const id = randomUUID();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('platform_tariffs').values({
        id, organization_id: orgId, version, currency: 'USD', unit: 'ORGANIZACION_MES',
        monthly_fee: dto.monthly_fee, valid_from: dto.valid_from, valid_to: dto.valid_to ?? null,
        synthetic: dto.synthetic, label: dto.label.trim(), source: dto.source.trim(),
        reason: version > 1 ? dto.reason!.trim() : null, created_by: user.id, operation_id: dto.operation_id,
      }).execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'platform_cost.tariff_declared',
        entityType: 'platform_tariff', entityId: id, requestId, result: 'SUCCESS',
        after: { version, monthly_fee: dto.monthly_fee, currency: 'USD', valid_from: dto.valid_from, valid_to: dto.valid_to ?? null, synthetic: dto.synthetic },
      });
    });
    return { replayed: false, ...(await this.listarTarifas(user, orgId)) };
  }

  // ------------------------------------------------------------------ estimaciones
  private async consumo(orgId: string, inicio: string, fin: string) {
    const actual = await this.limits.consumoActual(orgId);
    const periodo = (await sql<{ eventos: number; versiones: number; bytes: string; entregas: number; parcelas: number }>`
      SELECT (SELECT count(*)::int FROM domain_events WHERE organization_id = ${orgId} AND recorded_at >= ${inicio}::date AND recorded_at < ${fin}::date) AS eventos,
             (SELECT count(*)::int FROM document_versions WHERE organization_id = ${orgId} AND uploaded_at >= ${inicio}::date AND uploaded_at < ${fin}::date) AS versiones,
             (SELECT coalesce(sum(size_bytes), 0)::text FROM document_versions WHERE organization_id = ${orgId} AND uploaded_at >= ${inicio}::date AND uploaded_at < ${fin}::date) AS bytes,
             (SELECT count(*)::int FROM deliveries WHERE organization_id = ${orgId} AND created_at >= ${inicio}::date AND created_at < ${fin}::date) AS entregas,
             (SELECT count(*)::int FROM plots WHERE organization_id = ${orgId} AND created_at >= ${inicio}::date AND created_at < ${fin}::date) AS parcelas`
      .execute(this.db)).rows[0];
    const miembros = (await sql<{ n: number }>`
      SELECT count(DISTINCT m.user_id)::int AS n FROM memberships m WHERE m.organization_id = ${orgId} AND m.status = 'ACTIVE'`.execute(this.db)).rows[0];
    return {
      observed_at: new Date().toISOString(),
      period: {
        domain_events: periodo.eventos, document_versions_uploaded: periodo.versiones,
        document_bytes_uploaded: Number(periodo.bytes), deliveries_created: periodo.entregas, plots_created: periodo.parcelas,
        source: 'Consultas sobre domain_events.recorded_at, document_versions.uploaded_at, deliveries.created_at y plots.created_at dentro del período [inicio, fin).',
      },
      now: {
        stored_bytes: actual.stored_bytes, quota_bytes: actual.quota_bytes, plots: actual.plots, deliveries: actual.deliveries,
        active_members: miembros.n,
        source: 'Consumo observado de la organización en el momento del cálculo (mismo origen que /limits).',
      },
    };
  }

  async estimar(user: AuthUser, orgId: string, dto: EstimacionDto, requestId?: string) {
    await this.authz.require(user, orgId, 'platform_cost:manage', { mutation: true });
    const previa = await this.db.selectFrom('platform_cost_estimates').select(['id', 'period_start', 'period_end'])
      .where('organization_id', '=', orgId).where('operation_id', '=', dto.operation_id).executeTakeFirst();
    if (previa) {
      if (dia(previa.period_start) !== dto.period_start || dia(previa.period_end) !== dto.period_end) {
        throw conflict('OPERATION_ID_REUSED', 'Ese identificador de operación ya se usó con otro período.');
      }
      return { replayed: true, estimate: await this.leer(user, orgId, previa.id) };
    }
    const { period_start: inicio, period_end: fin } = dto;
    if (!esFechaValida(inicio) || !esFechaValida(fin) || !primeroDeMes(inicio) || !primeroDeMes(fin)) {
      throw new AppError(422, 'PERIODO_NO_ALINEADO', 'El período debe empezar y terminar el día 1 de un mes (el fin se excluye).', [{ field: 'period_start', reason: 'PERIODO_NO_ALINEADO' }]);
    }
    if (fin <= inicio) throw new AppError(422, 'PERIODO_INVALIDO', 'El fin del período debe ser posterior al inicio.', [{ field: 'period_end', reason: 'PERIODO_INVALIDO' }]);
    const meses = mesesDelPeriodo(inicio, fin);
    if (meses.length > MAX_MESES) {
      throw new AppError(422, 'PERIODO_DEMASIADO_LARGO', `Un período puede abarcar como máximo ${MAX_MESES} meses.`, [{ field: 'period_end', reason: 'PERIODO_DEMASIADO_LARGO' }]);
    }
    const tarifas = await this.tarifas(orgId);
    const lineas = calcularLineas(meses, tarifas);
    const { status, total } = totalizar(lineas);
    const consumption = await this.consumo(orgId, inicio, fin);
    const pending = [
      { concept: 'ALMACENAMIENTO', observed: consumption.now.stored_bytes, unit: 'bytes', state: 'SIN_REGLA_DE_VALORACION', note: 'La unidad adoptada es la organización por mes: el almacenamiento se muestra pero no se valora.' },
      { concept: 'EVENTOS', observed: consumption.period.domain_events, unit: 'eventos en el período', state: 'SIN_REGLA_DE_VALORACION', note: 'Se muestra pero no se valora.' },
      { concept: 'USUARIOS_ACTIVOS', observed: consumption.now.active_members, unit: 'miembros activos', state: 'SIN_REGLA_DE_VALORACION', note: 'Se muestra pero no se valora.' },
      { concept: 'FACTURACION_Y_COBRO', observed: null, unit: null, state: 'NO_IMPLEMENTADO', note: 'Esta estimación no factura, no cobra ni compromete ningún precio.' },
    ];
    const id = randomUUID();
    const hash = huellaEntradas(orgId, inicio, fin, lineas);
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('platform_cost_estimates').values({
        id, organization_id: orgId, period_start: inicio, period_end: fin, status, currency: 'USD', total,
        lines: JSON.stringify(lineas), consumption: JSON.stringify(consumption), pending_concepts: JSON.stringify(pending),
        inputs_hash: hash, computed_by: user.id, operation_id: dto.operation_id,
      }).execute();
      await this.audit.record(trx, {
        organizationId: orgId, actorUserId: user.id, action: 'platform_cost.estimated',
        entityType: 'platform_cost_estimate', entityId: id, requestId, result: 'SUCCESS',
        after: { period_start: inicio, period_end: fin, status, total, inputs_hash: hash },
      });
    });
    return { replayed: false, estimate: await this.leer(user, orgId, id) };
  }

  private async leer(user: AuthUser, orgId: string, id: string) {
    await this.authz.require(user, orgId, 'platform_cost:read', { mutation: false });
    const r = await this.db.selectFrom('platform_cost_estimates').selectAll()
      .where('organization_id', '=', orgId).where('id', '=', id).executeTakeFirst();
    if (!r) throw notFound();
    return this.vista(r);
  }

  private vista(r: {
    id: string; period_start: unknown; period_end: unknown; status: string; currency: string; total: string | null;
    lines: unknown; consumption: unknown; pending_concepts: unknown; inputs_hash: string; computed_by: string; computed_at: unknown;
  }) {
    return {
      id: r.id, period_start: dia(r.period_start), period_end: dia(r.period_end),
      status: r.status, currency: r.currency, total: r.total, lines: r.lines, consumption: r.consumption,
      pending_concepts: r.pending_concepts, inputs_hash: r.inputs_hash,
      computed_by: r.computed_by, computed_at: r.computed_at,
      meaning: r.status === 'ESTIMADO'
        ? 'Estimación del coste de USO DE LA PLATAFORMA con la tarifa declarada. No es una factura ni un compromiso.'
        : r.status === 'PARCIAL'
          ? 'Estimación PARCIAL: hay meses sin tarifa declarada que los cubra, y esos meses NO valen cero: quedan sin precio.'
          : 'SIN ESTIMACIÓN: no hay ninguna tarifa declarada que cubra un mes completo del período. Un precio ausente no es cero.',
      scope_note: 'Coste de la plataforma. Distinto del presupuesto de preparación (P1-010) y del precio comercial del cacao.',
    };
  }

  async listarEstimaciones(user: AuthUser, orgId: string) {
    await this.authz.require(user, orgId, 'platform_cost:read', { mutation: false });
    const filas = await this.db.selectFrom('platform_cost_estimates').selectAll()
      .where('organization_id', '=', orgId).orderBy('computed_at', 'desc').limit(50).execute();
    return { estimates: filas.map((f) => this.vista(f)) };
  }

  async ver(user: AuthUser, orgId: string, id: string) { return this.leer(user, orgId, id); }

  /** Recalcula con las tarifas que existían al calcular y compara: la estimación debe poder reproducirse. */
  async verificar(user: AuthUser, orgId: string, id: string) {
    await this.authz.require(user, orgId, 'platform_cost:read', { mutation: false });
    const r = await this.db.selectFrom('platform_cost_estimates').selectAll()
      .where('organization_id', '=', orgId).where('id', '=', id).executeTakeFirst();
    if (!r) throw notFound();
    const inicio = dia(r.period_start);
    const fin = dia(r.period_end);
    const tarifas = await this.tarifas(orgId, new Date(r.computed_at as unknown as string));
    const lineas = calcularLineas(mesesDelPeriodo(inicio, fin), tarifas);
    const { status, total } = totalizar(lineas);
    const hash = huellaEntradas(orgId, inicio, fin, lineas);
    const reproducible = hash === r.inputs_hash && status === r.status && total === (r.total === null ? null : deEscalado(aEscalado(String(r.total))));
    return { id, reproducible, stored: { status: r.status, total: r.total, inputs_hash: r.inputs_hash }, recomputed: { status, total, inputs_hash: hash } };
  }
}

@ApiTags('platform-cost')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/platform-cost')
export class PlatformCostController {
  constructor(private readonly service: PlatformCostService) {}

  @Get('tariffs')
  @ApiOperation({ summary: 'Tarifas declaradas de la plataforma, con versión y vigencia (no hay tarifas precargadas)' })
  tarifas(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.listarTarifas(u, o); }

  @Post('tariffs')
  @ApiOperation({ summary: 'Declarar una versión de tarifa (USD por organización y mes). Idempotente por operation_id' })
  declarar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: TarifaDto, @Req() req: AuthedRequest) {
    return this.service.declararTarifa(u, o, dto, req.requestId);
  }

  @Get('estimates')
  @ApiOperation({ summary: 'Estimaciones registradas' })
  estimaciones(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string) { return this.service.listarEstimaciones(u, o); }

  @Post('estimates')
  @ApiOperation({ summary: 'Registrar una estimación para un período explícito (meses calendario)' })
  estimar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Body() dto: EstimacionDto, @Req() req: AuthedRequest) {
    return this.service.estimar(u, o, dto, req.requestId);
  }

  @Get('estimates/:id')
  @ApiOperation({ summary: 'Una estimación con su consumo, líneas y conceptos pendientes' })
  una(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.ver(u, o, id); }

  @Get('estimates/:id/verify')
  @ApiOperation({ summary: 'Recalcular con las entradas guardadas y comprobar que el resultado es reproducible' })
  verificar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.verificar(u, o, id); }
}
