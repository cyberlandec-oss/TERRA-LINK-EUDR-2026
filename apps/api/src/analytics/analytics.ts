import { Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { AppError, notFound } from '../common/errors';
import { AuthorizationService } from '../authz/authorization.service';
import type { TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser } from '../auth/auth';
import { scaled } from '../traceability/kde-validator';
import { normalizar } from '../cost/cost';
import { writeXlsx } from '../imports/xlsx';

// P1-014 — Indicadores comerciales (RF-45; S3 §41 «GAP 15 — pasar de compliance a inteligencia comercial»).
//
// QUÉ PIDE LA FUENTE, Y QUÉ NO SE PUEDE RESPONDER TODAVÍA
// S3 §41 condiciona la inteligencia comercial a tener «productor + parcela + calidad + volumen + trazabilidad
// + riesgo + precio», y lista seis preguntas. Con P1-012 el precio existe, así que aquí se responden las que
// **no exigen inventar nada**, y las que sí **se dejan sin implementar con su condición escrita** (D-53).
//
// NO HAY SCORE COMPUESTO, Y ES DELIBERADO
// Un «supplier score» exige **ponderar** dimensiones —cuánto pesa el precio frente a la calidad, frente al
// volumen—. Esa ponderación **no está en ninguna fuente**, y elegirla en silencio sería inventar el resultado.
// Por eso esta entrega publica **indicadores separados**, cada uno **autodescrito**, y la composición del score
// queda **abierta en D-53**. Lo mismo con el **umbral de «datos suficientes»**: no se fija uno; se publica la
// **cobertura** y quien lee decide.
//
// SEPARACIÓN DEL RIESGO REGULATORIO (RF-45)
// Ningún indicador comercial usa la conclusión de riesgo, ni la severidad, ni el resultado técnico. El riesgo
// aparece en un bloque **aparte**, rotulado como contexto regulatorio, diciendo que **`UNDETERMINED` no
// significa riesgo bajo** y que una clasificación técnica parcial **conserva sus límites y su cobertura**.
//
// COMPARABILIDAD
// Solo se agrega lo compatible: **misma moneda, misma unidad, mismo producto y mismo período**. Lo incompatible
// **no se convierte**: se **excluye y se cuenta**, con su razón. Un indicador sin entradas válidas es
// `SIN_DATOS` —no cero—, y uno cuyo cálculo no se puede cerrar es `NO_CALCULABLE` con su explicación.
//
// PERMISOS SOBRE AGREGADOS
// `analytics:read` abre la pantalla, pero **cada indicador exige además el permiso de su dominio**: economía
// (`economics:read`), coste (`cost:read`), entregas (`delivery:read`), parcelas (`plot:read`). Sin él, el
// indicador se publica como **RESTRINGIDO y sin cifras** —ni valor, ni denominador, ni cobertura—: leer un
// lote no concede su economía. Y no hay consulta entre organizaciones: comparar asociaciones no autoriza eso.

type Estado = 'CALCULADO' | 'SIN_DATOS' | 'NO_CALCULABLE' | 'RESTRINGIDO';
type Procedencia = 'DECLARADO' | 'INFORMADO' | 'OBSERVADO' | 'ESTIMADO' | 'REGISTRADO';

interface Indicador {
  id: string;
  label: string;
  /** Qué mide, en una frase que no se pueda confundir con otra cosa. */
  what_it_measures: string;
  formula: string;
  unit: string;
  period: { from: string | null; to: string | null; kind: 'DECLARADO' | 'TODO_LO_REGISTRADO' };
  /** Sobre qué se divide, dicho explícitamente. `null` cuando el indicador no es un cociente. */
  denominator: { label: string; value: string | null } | null;
  coverage: { considered: number; used: number; excluded: number; note: string } | null;
  provenance: Procedencia;
  /** Grupo compatible al que pertenece el valor: moneda, unidad y producto. */
  group: { currency: string | null; unit: string | null; product: string | null } | null;
  value: string | null;
  status: Estado;
  excluded: Array<{ reason: string; count: number }>;
  limits: string[];
  why: string | null;
}

const PERIODO_ABIERTO = 'Sin período declarado: se usa TODO lo registrado. No se inventa una ventana por defecto.';

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>, private readonly authz: AuthorizationService) {}

  private tiene(ctx: TenantContext, p: string) { return ctx.permissions.includes(p as never); }

  private dec(n: bigint) {
    const s = (n < 0n ? -n : n).toString().padStart(7, '0');
    return `${n < 0n ? '-' : ''}${s.slice(0, -6)}.${s.slice(-6)}`;
  }
  /**
    * Cociente decimal exacto a seis decimales. **Trunca, no redondea** —igual que `dividir()` de P1-010—, y eso
    * se declara en los límites de cada indicador: un 2,666666 publicado no es un 2,666667 escondido.
    */
  private div(a: bigint, b: bigint): string | null {
    return b === 0n ? null : normalizar(this.dec((a * 1_000_000n) / b));
  }

  /** Lo que todo cociente de esta pantalla debe advertir. */
  private readonly TRUNCA = 'El cociente se calcula en decimal exacto y se TRUNCA a seis decimales; no se redondea.';

  private restringido(id: string, label: string, que: string, permiso: string): Indicador {
    return {
      id, label, what_it_measures: que, formula: '—', unit: '—',
      period: { from: null, to: null, kind: 'TODO_LO_REGISTRADO' },
      denominator: null, coverage: null, provenance: 'REGISTRADO', group: null,
      value: null, status: 'RESTRINGIDO', excluded: [],
      limits: [`Tu rol no tiene «${permiso}»: este indicador no se calcula para ti.`],
      why: 'Ausente por PERMISO, no por falta de datos. No se publica ninguna cifra, ni siquiera un recuento.',
    };
  }

  // ------------------------------------------------------------------ indicadores

  async comercial(user: AuthUser, orgId: string, q: { from?: string; to?: string; product_id?: string }) {
    const ctx = await this.authz.require(user, orgId, 'analytics:read', { mutation: false });
    const desde = q.from ? q.from.slice(0, 10) : null;
    const hasta = q.to ? q.to.slice(0, 10) : null;
    if (desde && hasta && desde > hasta) {
      throw new AppError(422, 'PERIOD_INVERTED', 'El período empieza después de terminar.', [{ field: 'from', reason: 'PERIOD_INVERTED' }]);
    }
    const periodo = { from: desde, to: hasta, kind: (desde || hasta ? 'DECLARADO' : 'TODO_LO_REGISTRADO') as 'DECLARADO' | 'TODO_LO_REGISTRADO' };

    let producto: { id: string; name: string } | null = null;
    if (q.product_id) {
      const p = await this.db.selectFrom('products').select(['id', 'name'])
        .where('id', '=', q.product_id).where('organization_id', '=', orgId).executeTakeFirst();
      if (!p) throw notFound('El producto no existe o no está disponible para ti.');
      producto = p;
    }

    const indicadores: Indicador[] = [];
    indicadores.push(...await this.deEconomia(ctx, orgId, periodo, producto));
    indicadores.push(...await this.deVolumen(ctx, orgId, periodo, producto));
    indicadores.push(...await this.deCalidad(ctx, orgId, periodo));
    indicadores.push(...await this.deCoste(ctx, orgId, periodo));
    indicadores.push(...await this.deTrazabilidad(ctx, orgId));

    return {
      period: periodo,
      period_note: periodo.kind === 'TODO_LO_REGISTRADO' ? PERIODO_ABIERTO : 'Período declarado por quien consulta.',
      product_filter: producto ? { id: producto.id, name: producto.name } : null,
      indicators: indicadores,
      regulatory_context: await this.contextoRegulatorio(ctx, orgId),
      not_implemented: NO_IMPLEMENTADO,
      disclaimer: 'Indicadores COMERCIALES. No miden conformidad EUDR, no sustituyen la evaluación de riesgo y no '
        + 'levantan ninguna compuerta. No hay score compuesto: ponderar las dimensiones es una decisión abierta (D-53), '
        + 'y tampoco se fija ningún umbral de «datos suficientes»: se publica la cobertura y la lectura es de quien consulta.',
      synthetic_note: 'En un entorno de DEMO o de revisión, parte de los datos de origen son de ENSAYO. Los datos '
        + 'sintéticos NO sustentan conclusiones sobre compradores, regiones ni productores reales.',
    };
  }

  /** Precio declarado, cobertura económica y pagos informados. Exige `economics:read`. */
  private async deEconomia(ctx: TenantContext, orgId: string, periodo: Indicador['period'], producto: { id: string; name: string } | null): Promise<Indicador[]> {
    const que = 'Dinero ACORDADO con el productor y pagos INFORMADOS sobre las entregas de la organización.';
    if (!this.tiene(ctx, 'economics:read')) {
      return [
        this.restringido('PRECIO_MEDIO_PONDERADO', 'Precio medio ponderado por cantidad', que, 'economics:read'),
        this.restringido('COBERTURA_ECONOMICA', 'Cobertura del dato económico', que, 'economics:read'),
        this.restringido('PAGOS_INFORMADOS_SOBRE_ACORDADO', 'Pagos informados sobre lo acordado', que, 'economics:read'),
      ];
    }

    // Versión VIGENTE de cada entrega: la de mayor record_number. El histórico no se promedia.
    const filas = (await sql<{
      delivery_id: string; price_amount: string | null; price_currency: string | null; price_unit: string | null;
      basis_quantity: string | null; basis_unit: string | null; premium_amount: string | null; premium_kind: string | null;
      premium_currency: string | null; premium_unit: string | null; product_name: string | null; product_id: string | null;
      delivery_date: string | null;
    }>`
      SELECT DISTINCT ON (e.delivery_id)
             e.delivery_id, e.price_amount::text, e.price_currency, e.price_unit,
             e.basis_quantity::text, e.basis_unit, e.premium_amount::text, e.premium_kind,
             e.premium_currency, e.premium_unit, p.name AS product_name, p.id AS product_id,
             d.delivery_date::text
      FROM delivery_economics e
      JOIN deliveries d ON d.id = e.delivery_id AND d.organization_id = e.organization_id
      LEFT JOIN products p ON p.id = d.product_id
      WHERE e.organization_id = ${orgId}
        AND (${periodo.from}::date IS NULL OR d.delivery_date >= ${periodo.from}::date)
        AND (${periodo.to}::date IS NULL OR d.delivery_date <= ${periodo.to}::date)
        AND (${producto?.id ?? null}::uuid IS NULL OR d.product_id = ${producto?.id ?? null}::uuid)
      ORDER BY e.delivery_id, e.record_number DESC`.execute(this.db)).rows;

    const entregas = (await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM deliveries d
      WHERE d.organization_id = ${orgId} AND d.status <> 'DRAFT'
        AND (${periodo.from}::date IS NULL OR d.delivery_date >= ${periodo.from}::date)
        AND (${periodo.to}::date IS NULL OR d.delivery_date <= ${periodo.to}::date)
        AND (${producto?.id ?? null}::uuid IS NULL OR d.product_id = ${producto?.id ?? null}::uuid)`.execute(this.db)).rows[0].n;

    // --- precio medio ponderado, UNA entrada por grupo compatible
    const grupos = new Map<string, { currency: string; unit: string; product: string; importe: bigint; cantidad: bigint; n: number }>();
    const excluidas: Record<string, number> = {};
    const excluir = (r: string) => { excluidas[r] = (excluidas[r] ?? 0) + 1; };
    for (const f of filas) {
      if (!f.price_amount || !f.price_currency || !f.price_unit) { excluir('La entrega no declara precio (puede declarar solo prima).'); continue; }
      if (!f.basis_quantity || !f.basis_unit) { excluir('El precio no tiene base declarada: sin cantidad no hay importe.'); continue; }
      if (f.price_unit !== f.basis_unit) { excluir(`Precio por ${f.price_unit} sobre base en ${f.basis_unit}: no se convierte ninguna unidad.`); continue; }
      const prod = f.product_name ?? 'SIN_PRODUCTO';
      const clave = `${f.price_currency}|${f.price_unit}|${prod}`;
      const g = grupos.get(clave) ?? { currency: f.price_currency, unit: f.price_unit, product: prod, importe: 0n, cantidad: 0n, n: 0 };
      g.importe += scaled(f.price_amount) * scaled(f.basis_quantity) / 1_000_000n;
      g.cantidad += scaled(f.basis_quantity);
      g.n += 1;
      grupos.set(clave, g);
    }
    const exclusiones = Object.entries(excluidas).map(([reason, count]) => ({ reason, count }));
    const limitesPrecio = [
      'Es el precio DECLARADO por la organización, no un precio de mercado ni una cotización.',
      'Un precio registrado NO demuestra que se haya pagado.',
      'Solo se promedia dentro de una misma moneda, unidad y producto: lo incompatible se excluye, no se convierte.',
      this.TRUNCA,
    ];
    const precio: Indicador[] = grupos.size === 0
      ? [{
          id: 'PRECIO_MEDIO_PONDERADO', label: 'Precio medio ponderado por cantidad',
          what_it_measures: 'Cuánto se acordó pagar por unidad, pesando cada entrega por su cantidad base.',
          formula: 'Σ (precio × cantidad base) ÷ Σ cantidad base, dentro de un mismo grupo (moneda, unidad, producto)',
          unit: 'importe por unidad', period: periodo,
          denominator: { label: 'Suma de las cantidades base del grupo', value: null },
          coverage: { considered: filas.length, used: 0, excluded: exclusiones.reduce((a, e) => a + e.count, 0), note: 'Ninguna entrega aportó un precio comparable.' },
          provenance: 'DECLARADO', group: null, value: null, status: 'SIN_DATOS', excluded: exclusiones,
          limits: limitesPrecio,
          why: filas.length === 0 ? 'No hay ninguna entrega con dato económico en este período.' : 'Hay datos económicos, pero ninguno comparable: mira las exclusiones.',
        }]
      : [...grupos.values()].map((g) => ({
          id: 'PRECIO_MEDIO_PONDERADO', label: 'Precio medio ponderado por cantidad',
          what_it_measures: 'Cuánto se acordó pagar por unidad, pesando cada entrega por su cantidad base.',
          formula: 'Σ (precio × cantidad base) ÷ Σ cantidad base, dentro de un mismo grupo (moneda, unidad, producto)',
          unit: `${g.currency} por ${g.unit}`, period: periodo,
          denominator: { label: `Suma de las cantidades base del grupo (${g.unit})`, value: normalizar(this.dec(g.cantidad)) },
          coverage: { considered: filas.length, used: g.n, excluded: filas.length - g.n, note: `${g.n} de ${filas.length} entrega(s) con dato económico entraron en ESTE grupo.` },
          provenance: 'DECLARADO' as Procedencia,
          group: { currency: g.currency, unit: g.unit, product: g.product },
          value: this.div(g.importe, g.cantidad),
          status: (this.div(g.importe, g.cantidad) === null ? 'NO_CALCULABLE' : 'CALCULADO') as Estado,
          excluded: exclusiones, limits: limitesPrecio, why: null,
        }));

    // --- cobertura del dato económico
    const cobertura: Indicador = {
      id: 'COBERTURA_ECONOMICA', label: 'Cobertura del dato económico',
      what_it_measures: 'Qué parte de las entregas del período tiene dato económico registrado.',
      formula: 'entregas con dato económico ÷ entregas registradas del período',
      unit: 'entregas sobre entregas', period: periodo,
      denominator: { label: 'Entregas registradas del período', value: String(entregas) },
      coverage: { considered: entregas, used: filas.length, excluded: entregas - filas.length, note: 'Las entregas sin dato económico NO cuentan como precio cero: se cuentan aparte.' },
      provenance: 'REGISTRADO', group: null,
      value: entregas === 0 ? null : `${filas.length} de ${entregas}`,
      status: entregas === 0 ? 'SIN_DATOS' : 'CALCULADO',
      excluded: [], limits: ['Una entrega sin dato económico no significa que no se pagara: significa que aquí no consta.'],
      why: entregas === 0 ? 'No hay ninguna entrega registrada en este período.' : null,
    };

    // --- pagos informados sobre lo acordado, solo dentro de una misma moneda
    const pagos = (await sql<{ currency: string; total: string; n: number }>`
      SELECT p.currency, sum(p.amount)::text AS total, count(*)::int AS n
      FROM delivery_payments p
      JOIN deliveries d ON d.id = p.delivery_id AND d.organization_id = p.organization_id
      WHERE p.organization_id = ${orgId}
        AND NOT EXISTS (SELECT 1 FROM delivery_payments c WHERE c.corrects_payment_id = p.id)
        AND (${periodo.from}::date IS NULL OR d.delivery_date >= ${periodo.from}::date)
        AND (${periodo.to}::date IS NULL OR d.delivery_date <= ${periodo.to}::date)
        AND (${producto?.id ?? null}::uuid IS NULL OR d.product_id = ${producto?.id ?? null}::uuid)
      GROUP BY p.currency`.execute(this.db)).rows;

    const acordadoPorMoneda = new Map<string, bigint>();
    for (const g of grupos.values()) acordadoPorMoneda.set(g.currency, (acordadoPorMoneda.get(g.currency) ?? 0n) + g.importe);

    const limitesPago = [
      'Un pago INFORMADO lo declara una persona: no lo verifica ningún banco y NO acredita una transferencia.',
      'No se comparan monedas distintas: cada una va por separado.',
      'El denominador es lo ACORDADO calculable; las entregas sin importe calculable no están en él.',
      this.TRUNCA,
    ];
    const pagosInd: Indicador[] = pagos.length === 0
      ? [{
          id: 'PAGOS_INFORMADOS_SOBRE_ACORDADO', label: 'Pagos informados sobre lo acordado',
          what_it_measures: 'Qué parte de lo acordado tiene algún pago informado, por moneda.',
          formula: 'Σ pagos informados vigentes ÷ Σ importe acordado calculable, dentro de una misma moneda',
          unit: 'proporción', period: periodo,
          denominator: { label: 'Importe acordado calculable', value: null },
          coverage: { considered: filas.length, used: 0, excluded: filas.length, note: 'No hay ningún pago informado en este período.' },
          provenance: 'INFORMADO', group: null, value: null, status: 'SIN_DATOS', excluded: [],
          limits: limitesPago, why: 'Nadie informó pagos. Eso NO significa que no se pagara.',
        }]
      : pagos.map((p) => {
          const acordado = acordadoPorMoneda.get(p.currency) ?? 0n;
          const v = this.div(scaled(p.total), acordado);
          return {
            id: 'PAGOS_INFORMADOS_SOBRE_ACORDADO', label: 'Pagos informados sobre lo acordado',
            what_it_measures: 'Qué parte de lo acordado tiene algún pago informado, por moneda.',
            formula: 'Σ pagos informados vigentes ÷ Σ importe acordado calculable, dentro de una misma moneda',
            unit: `proporción (${p.currency})`, period: periodo,
            denominator: { label: `Importe acordado calculable en ${p.currency}`, value: acordado === 0n ? null : normalizar(this.dec(acordado)) },
            coverage: { considered: filas.length, used: p.n, excluded: 0, note: `${p.n} pago(s) informado(s) en ${p.currency}.` },
            provenance: 'INFORMADO' as Procedencia,
            group: { currency: p.currency, unit: null, product: null },
            value: v, status: (v === null ? 'NO_CALCULABLE' : 'CALCULADO') as Estado,
            excluded: [], limits: limitesPago,
            why: v === null ? `Hay pagos informados en ${p.currency} pero ningún importe acordado calculable con el que compararlos: no se divide por cero.` : null,
          };
        });

    return [...precio, cobertura, ...pagosInd];
  }

  /** Volumen recibido, por unidad. Exige `delivery:read`. */
  private async deVolumen(ctx: TenantContext, orgId: string, periodo: Indicador['period'], producto: { id: string; name: string } | null): Promise<Indicador[]> {
    const que = 'Cuánto material se recibió físicamente, por unidad y producto.';
    if (!this.tiene(ctx, 'delivery:read')) return [this.restringido('VOLUMEN_RECIBIDO', 'Volumen recibido', que, 'delivery:read')];

    const filas = (await sql<{ unit: string; product_name: string | null; total: string; n: number }>`
      SELECT r.unit, p.name AS product_name, sum(r.quantity_received)::text AS total, count(*)::int AS n
      FROM receptions r
      JOIN deliveries d ON d.id = r.delivery_id AND d.organization_id = r.organization_id
      LEFT JOIN products p ON p.id = d.product_id
      WHERE r.organization_id = ${orgId}
        AND (${periodo.from}::date IS NULL OR r.received_at::date >= ${periodo.from}::date)
        AND (${periodo.to}::date IS NULL OR r.received_at::date <= ${periodo.to}::date)
        AND (${producto?.id ?? null}::uuid IS NULL OR d.product_id = ${producto?.id ?? null}::uuid)
      GROUP BY r.unit, p.name`.execute(this.db)).rows;

    const limites = [
      'Es cantidad RECIBIDA y pesada, no la declarada por el productor.',
      'No se suman unidades distintas: cada unidad va en su propio grupo.',
    ];
    if (filas.length === 0) {
      return [{
        id: 'VOLUMEN_RECIBIDO', label: 'Volumen recibido', what_it_measures: que,
        formula: 'Σ cantidad recibida, agrupando por unidad y producto', unit: '—', period: periodo,
        denominator: null, coverage: { considered: 0, used: 0, excluded: 0, note: 'No hay recepciones en este período.' },
        provenance: 'OBSERVADO', group: null, value: null, status: 'SIN_DATOS', excluded: [], limits: limites,
        why: 'No hay ninguna recepción registrada en este período.',
      }];
    }
    return filas.map((f) => ({
      id: 'VOLUMEN_RECIBIDO', label: 'Volumen recibido', what_it_measures: que,
      formula: 'Σ cantidad recibida, agrupando por unidad y producto', unit: f.unit, period: periodo,
      denominator: null,
      coverage: { considered: f.n, used: f.n, excluded: 0, note: `${f.n} recepción(es) en ${f.unit}.` },
      provenance: 'OBSERVADO' as Procedencia,
      group: { currency: null, unit: f.unit, product: f.product_name ?? 'SIN_PRODUCTO' },
      value: normalizar(f.total), status: 'CALCULADO' as Estado, excluded: [], limits: limites, why: null,
    }));
  }

  /** Decisiones de calidad. NO es un ranking de «mejor cacao». Exige `delivery:read`. */
  private async deCalidad(ctx: TenantContext, orgId: string, periodo: Indicador['period']): Promise<Indicador[]> {
    const que = 'Cómo se repartieron las decisiones humanas de calidad sobre las muestras tomadas.';
    if (!this.tiene(ctx, 'delivery:read')) return [this.restringido('DECISIONES_DE_CALIDAD', 'Decisiones de calidad', que, 'delivery:read')];

    const r = (await sql<{ decision: string; n: number; con_limites: number }>`
      SELECT q.decision, count(*)::int AS n, count(q.limits_version)::int AS con_limites
      FROM quality_results q
      JOIN quality_samples s ON s.id = q.sample_id AND s.organization_id = q.organization_id
      WHERE q.organization_id = ${orgId}
        AND (${periodo.from}::date IS NULL OR q.recorded_at::date >= ${periodo.from}::date)
        AND (${periodo.to}::date IS NULL OR q.recorded_at::date <= ${periodo.to}::date)
      GROUP BY q.decision`.execute(this.db)).rows;

    const muestras = (await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM quality_samples WHERE organization_id = ${orgId}`.execute(this.db)).rows[0].n;
    const total = r.reduce((a, x) => a + x.n, 0);
    const limites = [
      'Los límites de clasificación son DECLARADOS por quien decide y Terra Link NO los verifica: no hay catálogo publicado.',
      'Liberar calidad NO es una liberación jurídica ni acredita conformidad.',
      'Esto NO es un ranking de «mejor cacao»: es el reparto de decisiones registradas.',
    ];
    if (total === 0) {
      return [{
        id: 'DECISIONES_DE_CALIDAD', label: 'Decisiones de calidad', what_it_measures: que,
        formula: 'recuento de resultados de calidad por decisión', unit: 'resultados', period: periodo,
        denominator: { label: 'Muestras de calidad tomadas', value: String(muestras) },
        coverage: { considered: muestras, used: 0, excluded: muestras, note: 'Hay muestras, pero ningún resultado registrado en el período.' },
        provenance: 'REGISTRADO', group: null, value: null, status: 'SIN_DATOS', excluded: [], limits: limites,
        why: muestras === 0 ? 'No se ha tomado ninguna muestra de calidad.' : 'Hay muestras sin resultado en este período.',
      }];
    }
    return r.map((x) => ({
      id: 'DECISIONES_DE_CALIDAD', label: `Decisiones de calidad — ${x.decision}`, what_it_measures: que,
      formula: 'recuento de resultados de calidad por decisión ÷ resultados del período',
      unit: 'resultados sobre resultados', period: periodo,
      denominator: { label: 'Resultados de calidad del período', value: String(total) },
      coverage: { considered: muestras, used: total, excluded: Math.max(0, muestras - total), note: `${x.con_limites} de ${x.n} con versión de límites declarada (sin verificar).` },
      provenance: 'REGISTRADO' as Procedencia,
      group: null, value: `${x.n} de ${total}`, status: 'CALCULADO' as Estado, excluded: [], limits: limites, why: null,
    }));
  }

  /** Presupuesto de preparación ya guardado (P1-010). Exige `cost:read`. */
  private async deCoste(ctx: TenantContext, orgId: string, periodo: Indicador['period']): Promise<Indicador[]> {
    const que = 'Cuánto se PRESUPUESTÓ para preparar la documentación EUDR, según estimaciones ya guardadas.';
    if (!this.tiene(ctx, 'cost:read')) return [this.restringido('PRESUPUESTO_GUARDADO', 'Presupuesto de preparación estimado', que, 'cost:read')];

    const r = (await sql<{ currency: string; total: string; n: number; completas: number }>`
      SELECT currency, sum(total_known)::text AS total, count(*)::int AS n, count(*) FILTER (WHERE complete)::int AS completas
      FROM cost_estimates
      WHERE organization_id = ${orgId}
        AND (${periodo.from}::date IS NULL OR created_at::date >= ${periodo.from}::date)
        AND (${periodo.to}::date IS NULL OR created_at::date <= ${periodo.to}::date)
      GROUP BY currency`.execute(this.db)).rows;

    const limites = [
      'Es un PRESUPUESTO estimado con importes declarados, no un coste medido ni una factura.',
      'Un presupuesto NO demuestra eficiencia operativa.',
      'No se mezcla con el precio del cacao: son dineros distintos (D-51 frente a D-52).',
      'Las estimaciones incompletas se cuentan aparte: lo que falta no suma cero.',
    ];
    if (r.length === 0) {
      return [{
        id: 'PRESUPUESTO_GUARDADO', label: 'Presupuesto de preparación estimado', what_it_measures: que,
        formula: 'Σ total conocido de las estimaciones guardadas, por moneda', unit: '—', period: periodo,
        denominator: null, coverage: { considered: 0, used: 0, excluded: 0, note: 'No hay estimaciones guardadas en el período.' },
        provenance: 'ESTIMADO', group: null, value: null, status: 'SIN_DATOS', excluded: [], limits: limites,
        why: 'Nadie ha guardado una estimación de preparación en este período.',
      }];
    }
    return r.map((x) => ({
      id: 'PRESUPUESTO_GUARDADO', label: 'Presupuesto de preparación estimado', what_it_measures: que,
      formula: 'Σ total conocido de las estimaciones guardadas, por moneda', unit: x.currency, period: periodo,
      denominator: null,
      coverage: { considered: x.n, used: x.n, excluded: 0, note: `${x.completas} de ${x.n} estimación(es) con todos los conceptos presupuestados.` },
      provenance: 'ESTIMADO' as Procedencia,
      group: { currency: x.currency, unit: null, product: null },
      value: normalizar(x.total), status: 'CALCULADO' as Estado, excluded: [], limits: limites, why: null,
    }));
  }

  /**
   * Trazabilidad: parcelas activas con geometría vigente. Exige `plot:read`.
   * NO recibe período a propósito: es el estado ACTUAL de las parcelas, y el indicador lo dice.
   */
  private async deTrazabilidad(ctx: TenantContext, orgId: string): Promise<Indicador[]> {
    const que = 'Qué parte de las parcelas activas tiene una versión de geometría vigente registrada.';
    if (!this.tiene(ctx, 'plot:read')) return [this.restringido('PARCELAS_CON_GEOMETRIA', 'Parcelas con geometría vigente', que, 'plot:read')];

    const r = (await sql<{ activas: number; con: number }>`
      SELECT count(*)::int AS activas, count(current_version_id)::int AS con
      FROM plots WHERE organization_id = ${orgId} AND status = 'ACTIVE'`.execute(this.db)).rows[0];
    const limites = [
      'Tener geometría registrada NO acredita exactitud, legalidad ni ausencia de deforestación.',
      'El período no se aplica aquí: es el estado ACTUAL de las parcelas activas, y se dice.',
    ];
    return [{
      id: 'PARCELAS_CON_GEOMETRIA', label: 'Parcelas con geometría vigente', what_it_measures: que,
      formula: 'parcelas activas con versión vigente ÷ parcelas activas',
      unit: 'parcelas sobre parcelas',
      period: { from: null, to: null, kind: 'TODO_LO_REGISTRADO' },
      denominator: { label: 'Parcelas activas', value: String(r.activas) },
      coverage: { considered: r.activas, used: r.con, excluded: r.activas - r.con, note: 'Una parcela sin geometría se cuenta como tal, no como cero.' },
      provenance: 'REGISTRADO', group: null,
      value: r.activas === 0 ? null : `${r.con} de ${r.activas}`,
      status: r.activas === 0 ? 'SIN_DATOS' : 'CALCULADO',
      excluded: [], limits: limites, why: r.activas === 0 ? 'No hay parcelas activas.' : null,
    }];
  }

  /** Bloque APARTE: contexto regulatorio. NO alimenta ningún indicador comercial. */
  private async contextoRegulatorio(ctx: TenantContext, orgId: string) {
    if (!this.tiene(ctx, 'risk:read')) {
      return {
        available: false,
        why: 'Tu rol no lee evaluaciones de riesgo: aquí no se afirma nada sobre ellas.',
        conclusions: null, note: 'Ausente por PERMISO, no por falta de datos.',
      };
    }
    // «Vigente» no es una columna: es la evaluación de mayor número por sujeto. Se deriva, no se inventa.
    const r = (await sql<{ conclusion: string; n: number; vigentes: number }>`
      WITH ultima AS (
        SELECT DISTINCT ON (subject_type, subject_id) id FROM risk_evaluations
        WHERE organization_id = ${orgId} ORDER BY subject_type, subject_id, evaluation_number DESC
      )
      SELECT e.conclusion, count(*)::int AS n,
             count(*) FILTER (WHERE u.id IS NOT NULL)::int AS vigentes
      FROM risk_evaluations e LEFT JOIN ultima u ON u.id = e.id
      WHERE e.organization_id = ${orgId} GROUP BY e.conclusion`.execute(this.db)).rows;
    return {
      available: true,
      conclusions: r.map((x) => ({ conclusion: x.conclusion, count: x.n, current: x.vigentes })),
      why: null,
      note: 'Contexto REGULATORIO, no un indicador comercial. Ninguna métrica de esta pantalla usa la conclusión, '
        + 'la severidad ni el resultado técnico del riesgo. `UNDETERMINED` NO significa riesgo bajo: significa que '
        + 'no se concluyó. Una clasificación técnica parcial conserva sus límites y su cobertura, y no se convierte '
        + 'en una puntuación.',
    };
  }

  // ------------------------------------------------------------------ por productor

  async porProductor(user: AuthUser, orgId: string, q: { from?: string; to?: string }) {
    const ctx = await this.authz.require(user, orgId, 'analytics:read', { mutation: false });
    const desde = q.from ? q.from.slice(0, 10) : null;
    const hasta = q.to ? q.to.slice(0, 10) : null;
    const verEconomia = this.tiene(ctx, 'economics:read');
    const verEntregas = this.tiene(ctx, 'delivery:read');

    // Alcance: el técnico solo ve sus productores asignados; sin lectura de productores, nada.
    const todos = this.tiene(ctx, 'producer:read');
    const asignados = this.tiene(ctx, 'producer:read_assigned');
    if (!todos && !asignados) {
      return {
        producers: [], scope: 'RESTRINGIDO',
        note: 'Tu rol no lee productores: aquí no se afirma nada sobre ellos, ni siquiera que no haya.',
        not_implemented: NO_IMPLEMENTADO,
      };
    }

    const filas = (await sql<{
      id: string; producer_code: string; entregas: number; con_economia: number;
      currency: string | null; unit: string | null; importe: string | null; cantidad: string | null; recibido: string | null; unidad_recepcion: string | null;
    }>`
      WITH vigente AS (
        SELECT DISTINCT ON (e.delivery_id) e.* FROM delivery_economics e
        WHERE e.organization_id = ${orgId} ORDER BY e.delivery_id, e.record_number DESC
      )
      SELECT p.id, p.producer_code,
             count(DISTINCT d.id)::int AS entregas,
             count(DISTINCT v.delivery_id)::int AS con_economia,
             min(v.price_currency) AS currency,
             min(v.price_unit) AS unit,
             sum(v.price_amount * v.basis_quantity) FILTER (WHERE v.price_unit = v.basis_unit)::text AS importe,
             sum(v.basis_quantity) FILTER (WHERE v.price_unit = v.basis_unit)::text AS cantidad,
             sum(r.quantity_received)::text AS recibido,
             min(r.unit) AS unidad_recepcion
      FROM producers p
      JOIN deliveries d ON d.producer_id = p.id AND d.organization_id = p.organization_id AND d.status <> 'DRAFT'
      LEFT JOIN vigente v ON v.delivery_id = d.id
      LEFT JOIN receptions r ON r.delivery_id = d.id
      WHERE p.organization_id = ${orgId}
        AND (${todos} OR p.assigned_membership_id = ${ctx.membershipId})
        AND (${desde}::date IS NULL OR d.delivery_date >= ${desde}::date)
        AND (${hasta}::date IS NULL OR d.delivery_date <= ${hasta}::date)
      GROUP BY p.id, p.producer_code
      ORDER BY p.producer_code
      LIMIT 200`.execute(this.db)).rows;

    // Monedas o unidades mezcladas dentro de un productor: no se promedia, se declara.
    const mezclas = (await sql<{ id: string; monedas: number; unidades: number }>`
      WITH vigente AS (
        SELECT DISTINCT ON (e.delivery_id) e.* FROM delivery_economics e
        WHERE e.organization_id = ${orgId} ORDER BY e.delivery_id, e.record_number DESC
      )
      SELECT p.id, count(DISTINCT v.price_currency)::int AS monedas, count(DISTINCT v.price_unit)::int AS unidades
      FROM producers p JOIN deliveries d ON d.producer_id = p.id AND d.organization_id = p.organization_id
      JOIN vigente v ON v.delivery_id = d.id
      WHERE p.organization_id = ${orgId} GROUP BY p.id`.execute(this.db)).rows;
    const mezcla = new Map(mezclas.map((m) => [m.id, m]));

    return {
      scope: todos ? 'ORGANIZACION' : 'ASIGNADOS',
      producers: filas.map((f) => {
        const m = mezcla.get(f.id);
        const comparable = !m || (m.monedas <= 1 && m.unidades <= 1);
        const precio = verEconomia && comparable && f.importe && f.cantidad && scaled(f.cantidad) !== 0n
          ? this.div(scaled(f.importe), scaled(f.cantidad)) : null;
        return {
          producer_id: f.id, producer_code: f.producer_code,
          deliveries: verEntregas ? f.entregas : null,
          with_economics: verEconomia ? f.con_economia : null,
          without_economics: verEconomia ? f.entregas - f.con_economia : null,
          weighted_price: verEconomia ? (precio ?? 'NO_CALCULABLE') : 'RESTRINGIDO',
          price_group: verEconomia && comparable ? { currency: f.currency, unit: f.unit } : null,
          received: verEntregas && f.recibido ? { quantity: normalizar(f.recibido), unit: f.unidad_recepcion } : null,
          why: !verEconomia ? 'Tu rol no lee datos económicos: no se publica ninguna cifra de dinero.'
            : !comparable ? 'Este productor tiene entregas en monedas o unidades distintas: no se promedian ni se convierten.'
              : precio === null ? 'Sin ninguna entrega con importe calculable: no hay precio medio que publicar.' : null,
        };
      }),
      note: 'Resumen por productor. NO es un score: no se pondera ninguna dimensión, porque esa ponderación no está '
        + 'decidida (D-53). Las entregas sin dato económico NO cuentan como cero.',
      separation_note: 'Ninguna cifra de aquí usa la evaluación de riesgo. UNDETERMINED no significa riesgo bajo.',
      not_implemented: NO_IMPLEMENTADO,
    };
  }

  // ------------------------------------------------------------------ descarga

  async descargar(user: AuthUser, orgId: string, q: { from?: string; to?: string; product_id?: string }) {
    // La descarga exige, ADEMÁS, el permiso de exportar: ver no es llevarse.
    await this.authz.require(user, orgId, 'analytics:read', { mutation: false });
    await this.authz.require(user, orgId, 'report:export', { mutation: false });
    const d = await this.comercial(user, orgId, q);
    const filas = d.indicators.map((i) => [
      i.id, i.label, i.status, i.value ?? '', i.unit,
      i.group ? [i.group.currency, i.group.unit, i.group.product].filter(Boolean).join(' · ') : '',
      i.period.from ?? '(abierto)', i.period.to ?? '(abierto)',
      i.denominator ? `${i.denominator.label}: ${i.denominator.value ?? 'no calculable'}` : '',
      i.coverage ? `${i.coverage.used} de ${i.coverage.considered}` : '',
      i.provenance, i.formula, i.why ?? '', i.limits.join(' | '),
    ]);
    return writeXlsx([
      {
        name: 'indicadores',
        rows: [['id', 'indicador', 'estado', 'valor', 'unidad', 'grupo comparable', 'desde', 'hasta',
          'denominador', 'cobertura', 'procedencia', 'fórmula', 'por qué no se calcula', 'límites'], ...filas],
        widths: [26, 34, 14, 16, 18, 26, 12, 12, 40, 14, 14, 54, 44, 80],
      },
      {
        name: 'advertencias',
        rows: [['advertencia'], [d.disclaimer], [d.synthetic_note],
          ...(d.regulatory_context.note ? [[d.regulatory_context.note]] : []),
          ...NO_IMPLEMENTADO.map((n) => [`NO IMPLEMENTADO — ${n.question}: ${n.condition}`])],
        widths: [120],
      },
    ]);
  }
}

/** Las preguntas de S3 §41 que NO se implementan, con su condición exacta. No se fingen. */
const NO_IMPLEMENTADO = [
  {
    question: '¿Qué comprador paga mejor?',
    condition: 'Terra Link no registra ningún precio de VENTA: el dato económico es lo que la organización acuerda '
      + 'con el PRODUCTOR. Atribuirlo a un comprador exigiría una relación explícita que lo sustente, y no existe. '
      + 'Condición: registrar el precio de venta por embarque o comprador (decisión y desarrollo nuevos).',
  },
  {
    question: '¿Qué fincas tienen potencial de aumentar producción?',
    condition: 'No hay ninguna serie de rendimiento por parcela ni superficie productiva verificada. Responderlo hoy '
      + 'sería inventar el dato. Condición: registrar producción por parcela y período, con su superficie.',
  },
  {
    question: '¿Qué productores tienen menor riesgo? (como métrica comercial)',
    condition: 'RF-45 exige que la métrica comercial sea INDEPENDIENTE del riesgo legal, así que la conclusión '
      + 'regulatoria no puede alimentar un indicador comercial. Un «riesgo comercial» propio sería un modelo nuevo '
      + 'con factores y pesos que nadie ha decidido (D-53).',
  },
  {
    question: 'Score compuesto de proveedor',
    condition: 'Exige PONDERAR precio, calidad, volumen y trazabilidad. Ninguna fuente fija esos pesos y elegirlos en '
      + 'silencio inventaría el resultado. Condición: adoptar D-53 (composición y pesos del score, y si se publica un '
      + 'umbral de «datos suficientes»).',
  },
];

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('commercial')
  @ApiOperation({ summary: 'Indicadores comerciales autodescritos, separados del riesgo regulatorio' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'product_id', required: false })
  comercial(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string,
    @Query('from') from?: string, @Query('to') to?: string, @Query('product_id') product_id?: string) {
    return this.service.comercial(u, o, { from, to, product_id });
  }

  @Get('producers')
  @ApiOperation({ summary: 'Resumen comercial por productor. No es un score: no se pondera nada' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  porProductor(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string,
    @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.porProductor(u, o, { from, to });
  }

  @Get('commercial/download')
  @ApiOperation({ summary: 'Descargar los indicadores con sus fórmulas, denominadores, cobertura y límites' })
  async descargar(@CurrentUser() u: AuthUser, @Param('orgId', ParseUUIDPipe) o: string, @Res() res: Response,
    @Query('from') from?: string, @Query('to') to?: string, @Query('product_id') product_id?: string) {
    const bytes = await this.service.descargar(u, o, { from, to, product_id });
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('content-disposition', 'attachment; filename="indicadores-comerciales.xlsx"');
    res.send(bytes);
  }
}
