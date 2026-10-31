import { Controller, Get, Inject, Injectable, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { notFound } from '../common/errors';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import { CurrentUser, type AuthUser } from '../auth/auth';
import { DdService } from '../dd/dd';
import { LotsService } from '../lots/lots';
import { evaluateRequirements, readinessOf, summary, type DdContent, type ReqStatus, type Requirement } from '../dd/requirements';

// P1-009 — Simulador de preparación de lote (RF-40; S3 §37).
//
// QUÉ PIDE LA FUENTE
// **S3 §37**: antes de exportar, el exportador selecciona un lote y el sistema «simula» productores, parcelas,
// cantidades, riesgos, documentación, balance de masa y DDS, y responde «🟢 98 % listo» o «🔴 No exportable»
// **con las causas**. **RF-40** (`docs/03:56`) añade: «**solo lectura**, inputs/fecha visibles». **P1-009**
// (`docs/18:210`): «solo lectura, **mismas reglas/snapshot que preflight**; **bloqueos aunque porcentaje alto**».
//
// LAS TRES COSAS QUE NUNCA SE MEZCLAN
//   1. **Estado real** del expediente: lo que hoy se cumple y lo que no, con su causa.
//   2. **Escenario hipotético**: qué se ha supuesto resuelto. **Suponer no es resolver**, y se dice.
//   3. **Lo que seguiría bloqueado** aun con el escenario, **clasificado**: un dato que falta, una decisión que
//      nadie ha tomado o una capacidad que el producto no tiene. Mezclarlas haría creer que todo se arregla
//      trabajando más.
//
// SOLO LECTURA, Y DE VERDAD
// No hay escritura: no existe `POST` ni `PATCH`. La simulación **no aprueba evidencias, no toca inventario y no
// habilita `READY` ni el despacho**. Tampoco guarda escenarios: el resultado se calcula al pedirlo, sobre el
// contenido que el expediente ya calcula, así que no puede quedar un escenario almacenado pareciendo un
// expediente. Las **mismas reglas** que el preflight: `evaluateRequirements()` y las comprobaciones de lote que
// `preflightChecks()` aplica —calidad, origen y paquete de diligencia—, no una copia que pueda divergir.
//
// EL PORCENTAJE NO DECIDE
// Se publica el de `summary()`, con su advertencia: **cualquier requisito no cumplido bloquea**. Un 98 % sigue
// siendo **NO EXPORTABLE** si queda una causa. El veredicto sale de las causas, nunca del porcentaje.

type Clase = 'DATO' | 'DECISION' | 'CAPACIDAD';

/**
 * Qué clase de obstáculo es cada requisito cuando no se cumple, y por qué.
 *
 * No es una opinión: cita la decisión o la historia que lo mantiene abierto. Lo que no está aquí es **dato**,
 * es decir, algo que la organización resuelve trabajando.
 */
const GATES: Record<string, { clase: Clase; porque: string }> = {
  LEGAL_PROFILE: { clase: 'DECISION', porque: 'El perfil jurídico sigue sin revisión de una persona competente (P1-005). No se arregla cargando datos.' },
  DEFORESTATION_ANALYSIS: { clase: 'CAPACIDAD', porque: 'No hay proveedor satelital seleccionado ni contratado (P0-028, D-09 parte B). El producto todavía no puede concluir esto.' },
  REGULATORY_CONCLUSION: { clase: 'DECISION', porque: 'La conclusión regulatoria depende de reglas aprobadas para concluir y del perfil jurídico (D-05.B, D-07.5, D-07.6).' },
  GEOLOCATION_PROFILE: { clase: 'DECISION', porque: 'El perfil de geolocalización exigible no está aprobado (D-05.A/B).' },
};

const SIN_CLASE: { clase: Clase; porque: string } = {
  clase: 'DATO',
  porque: 'Falta un dato o una acción dentro del alcance de la organización: se resuelve en el módulo que corresponda.',
};

interface Supuesto { code: string; label: string; was: ReqStatus; note: string }
interface Bloqueo { code: string; label: string; status: ReqStatus; class: Clase; why: string; detail: string }

@Injectable()
export class SimulationService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly authz: AuthorizationService,
    private readonly dd: DdService,
    private readonly lots: LotsService,
  ) {}

  /**
   * Comprobaciones de despacho **a nivel de lote**, con las mismas reglas que el preflight del embarque:
   * calidad liberada por decisión humana, origen completo y paquete de diligencia acreditado.
   *
   * Las demás comprobaciones del preflight —estado del embarque, reserva y compuerta KDE— **dependen de un
   * embarque concreto** y no se simulan aquí: se nombran, para no dar por cumplido lo que no se ha mirado.
   */
  private async comprobacionesDeLote(ctx: TenantContext, lotId: string) {
    const q = this.lots.qualitySummary(await this.lots.quality(this.db, lotId));
    const lote = await this.db.selectFrom('lots').select(['lot_code', 'origin_status'])
      .where('id', '=', lotId).where('organization_id', '=', ctx.organizationId).executeTakeFirstOrThrow();
    const p = await this.dd.packageForDispatch(this.db, ctx, lotId);
    return {
      checks: [
        { code: 'QUALITY', label: 'Calidad liberada', status: q.status === 'RELEASED_BY_HUMAN_DECISION' ? 'OK' : 'BLOCKED', message: q.label },
        { code: 'ORIGIN', label: 'Origen completo', status: lote.origin_status === 'COMPLETE' ? 'OK' : 'BLOCKED', message: lote.origin_status === 'COMPLETE' ? 'Origen declarado.' : 'Origen incompleto: no se despacha como origen conocido.' },
        { code: 'DD_PACKAGE', label: 'Paquete de diligencia acreditado', status: p.status === 'OK' ? 'OK' : 'BLOCKED', message: `Paquete de diligencia: ${p.status}.` },
      ],
      lot_code: lote.lot_code,
      not_simulated: [
        { code: 'STATUS', why: 'Depende del estado de un embarque concreto.' },
        { code: 'RESERVATION', why: 'Depende de la reserva del ítem en el embarque.' },
        { code: 'GATE', why: 'La compuerta de datos mínimos se evalúa sobre el embarque.' },
      ],
    };
  }

  /** Recuentos de lo que S3 §37 enumera. Son cifras agregadas: ni identidades, ni geometrías. */
  private recuentos(c: DdContent) {
    const parcelas = new Set(c.plots.map((p) => p.plot_id));
    return {
      productores: null as number | null,   // se completa abajo, porque exige consulta propia
      parcelas: parcelas.size,
      entregas: c.deliveries.length,
      documentos: c.documents.length,
      evidencias: (c.evidence ?? []).length,
      cantidad: { value: c.quantities.physical, unit: c.quantities.unit },
    };
  }

  async simular(user: AuthUser, orgId: string, lotId: string, supuestos: string[]) {
    // El expediente es de quien puede leerlo: `dd:read`. Sin él no hay simulación, ni siquiera agregada.
    const ctx = await this.authz.require(user, orgId, 'dd:read', { mutation: false });

    const lote = await this.db.selectFrom('lots').select('id')
      .where('id', '=', lotId).where('organization_id', '=', orgId).executeTakeFirst();
    if (!lote) throw notFound();

    const contenido = await this.dd.capture(this.db, ctx, lotId);
    const requisitos = evaluateRequirements(contenido);
    const resumen = summary(requisitos);
    const preparacion = readinessOf(requisitos);
    const despacho = await this.comprobacionesDeLote(ctx, lotId);

    const productores = (await sql<{ n: string }>`
      SELECT count(DISTINCT d.producer_id)::text AS n
      FROM lot_inputs i JOIN receptions r ON r.id = i.reception_id JOIN deliveries d ON d.id = r.delivery_id
      WHERE i.lot_id = ${lotId} AND d.organization_id = ${orgId}`.execute(this.db)).rows[0];
    const recuentos = { ...this.recuentos(contenido), productores: Number(productores?.n ?? 0) };

    // Las referencias de un requisito llevan códigos de parcelas y entregas. Solo se entregan a quien puede
    // leer esos recursos; si no, se dice que se omiten, en vez de dejarlas pasar por ser «solo un código».
    const verParcelas = ctx.permissions.includes('plot:read');
    const verEntregas = ctx.permissions.includes('delivery:read');
    const conReferencias = verParcelas && verEntregas;
    const publicar = (r: Requirement) => ({
      code: r.code, label: r.label, status: r.status, detail: r.detail, source: r.source,
      references: conReferencias ? r.references : [],
      references_omitted: conReferencias ? null : 'Tu rol no lee parcelas o entregas: se omiten los códigos a los que apunta este requisito.',
    });

    // ---------------------------------------------------------------- escenario
    const bloqueados = requisitos.filter((r) => r.status !== 'MET');
    const pedidos = [...new Set(supuestos.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    const aplicados: Supuesto[] = [];
    const rechazados: Array<{ code: string; why: string }> = [];
    for (const code of pedidos) {
      const r = bloqueados.find((x) => x.code === code);
      if (!r) {
        const existe = requisitos.some((x) => x.code === code);
        rechazados.push({ code, why: existe ? 'Ese requisito ya se cumple: no hay nada que suponer.' : 'No existe un requisito con ese código.' });
        continue;
      }
      aplicados.push({
        code: r.code, label: r.label, was: r.status,
        note: `Se supone resuelto para proyectar el resultado. SUPONER NO ES RESOLVER: hoy está ${r.status}.`,
      });
    }

    const restantes = bloqueados.filter((r) => !aplicados.some((a) => a.code === r.code));
    const seguiriaBloqueado: Bloqueo[] = restantes.map((r) => {
      const g = GATES[r.code] ?? SIN_CLASE;
      return { code: r.code, label: r.label, status: r.status, class: g.clase, why: g.porque, detail: r.detail };
    });

    // Proyección: los requisitos supuestos cuentan como cumplidos SOLO para este cálculo hipotético.
    const proyectados: Requirement[] = requisitos.map((r) => (aplicados.some((a) => a.code === r.code)
      ? { ...r, status: 'MET' as ReqStatus, detail: 'SUPUESTO en el escenario; no es su estado real.' }
      : r));
    const resumenProyectado = summary(proyectados);
    const preparacionProyectada = readinessOf(proyectados);

    const causasReales = [
      ...bloqueados.map((r) => `${r.code}: ${r.detail}`),
      ...despacho.checks.filter((c) => c.status !== 'OK').map((c) => `${c.code}: ${c.message}`),
    ];
    const causasProyectadas = [
      ...seguiriaBloqueado.map((b) => `${b.code}: ${b.why}`),
      ...despacho.checks.filter((c) => c.status !== 'OK').map((c) => `${c.code}: ${c.message}`),
    ];

    return {
      simulated_at: new Date().toISOString(),
      read_only: true,
      // RF-40: «inputs/fecha visibles». Qué se miró, y con qué versiones.
      inputs: {
        lot_id: lotId, lot_code: despacho.lot_code,
        counts: recuentos,
        rule_set_version: contenido.risk?.rule_set_version ?? null,
        risk_evaluation_number: contenido.risk?.evaluation_number ?? null,
        risk_evaluation_is_current: contenido.risk?.is_current ?? null,
        legal_profile_version: contenido.profiles.legal_profile?.version ?? null,
        synthetic_fixture: contenido.synthetic_fixture === true,
        note: 'Mismo contenido y mismas reglas que usa el expediente real; la simulación no captura una instantánea propia.',
      },
      real: {
        readiness: preparacion,
        summary: resumen,
        requirements: requisitos.map(publicar),
        dispatch_checks: despacho.checks,
        dispatch_not_simulated: despacho.not_simulated,
        exportable: false,
        verdict: 'NO EXPORTABLE',
        causes: causasReales,
        note: 'El veredicto sale de las causas, no del porcentaje: un porcentaje alto con una causa abierta sigue siendo NO EXPORTABLE.',
      },
      scenario: {
        assumed: aplicados,
        rejected: rechazados,
        note: aplicados.length
          ? 'Escenario HIPOTÉTICO. Suponer un requisito resuelto no lo resuelve, no aprueba ninguna evidencia y no cambia el expediente.'
          : 'Sin supuestos: la proyección coincide con el estado real.',
      },
      projected: {
        readiness: preparacionProyectada,
        summary: resumenProyectado,
        still_blocked: seguiriaBloqueado,
        exportable: false,
        verdict: 'NO EXPORTABLE',
        causes: causasAunBloqueantes(causasProyectadas),
        note: 'Proyección del escenario. Aunque no quedara ningún requisito, seguiría sin ser exportable: '
          + 'habilitar READY y el despacho exige decisiones abiertas y un embarque con su preflight real.',
      },
      disclaimer: 'Simulación de SOLO LECTURA. No aprueba evidencias, no toca inventario y no habilita READY ni el '
        + 'despacho. Un paquete de diligencia preparado no es una DDS presentada.',
    };
  }
}

/** Sin causas que mostrar, se dice por qué sigue sin ser exportable, en vez de devolver una lista vacía. */
function causasAunBloqueantes(causas: string[]): string[] {
  return causas.length ? causas : ['READY y el despacho siguen cerrados por decisiones abiertas (D-05.B, D-07.5, D-07.6) y por el preflight del embarque, que no se simula.'];
}

@ApiTags('simulation')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId/simulations')
export class SimulationController {
  constructor(private readonly service: SimulationService) {}

  @Get('lots/:lotId')
  @ApiOperation({ summary: 'Simular la preparación de un lote: estado real, escenario hipotético y lo que seguiría bloqueado (solo lectura)' })
  @ApiQuery({ name: 'assume', required: false, description: 'Códigos de requisito que se suponen resueltos, separados por coma' })
  simular(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('lotId', ParseUUIDPipe) lotId: string, @Query('assume') assume?: string) {
    return this.service.simular(user, orgId, lotId, (assume ?? '').split(',').filter(Boolean));
  }
}
