import { Controller, Get, Inject, Injectable, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/database';
import type { Database } from '../db/schema';
import { notFound } from '../common/errors';
import { AuthorizationService, type TenantContext } from '../authz/authorization.service';
import type { Permission } from '../authz/catalog';
import { CurrentUser, type AuthUser } from '../auth/auth';

// P1-004 — Onboarding y diagnóstico de madurez (RF-35; S3 §16; UX_UI §10.4).
//
// QUÉ DICE LA FUENTE, Y QUÉ NO
// **S3 §16** nombra siete niveles —0 No digitalizado, 1 Registros manuales, 2 Excel/formularios,
// 3 Trazabilidad digital, 4 Trazabilidad + riesgo, 5 EUDR operacional, 6 Inteligencia comercial— y los
// introduce con un «Por ejemplo», apoyándose en la progresión de la guía ecuatoriana (papel → Excel →
// formularios digitales → sistema interno → software especializado). **No fija ningún umbral, porcentaje ni
// condición de paso de nivel.** Tampoco los fija ninguna otra fuente.
//
// CÓMO SE RESUELVE ESO AQUÍ, SIN INVENTAR
//   · Cada nivel se sostiene en **señales observables** del dato que ya existe, cada una con su **evidencia y
//     procedencia**. Nada se deduce de encuestas ni de autodeclaraciones.
//   · El único umbral es **la presencia**: «existe al menos un/a …». **También eso es una decisión de
//     producto** (D-49, opción A), y conserva esa etiqueta en la respuesta. Unos umbrales cuantitativos no
//     serían ilegítimos: serían igual de válidos si se acordaran y justificaran. La diferencia real es que
//     **las fuentes no los definen**, así que su fundamento tendría que ser propio.
//   · Los **niveles 0 a 2 ocurren fuera de Terra Link** —papel, registros manuales, Excel— y aquí son
//     **NO_DETERMINABLES**: el sistema no puede distinguir una organización no digitalizada de una que
//     todavía no ha cargado nada. Decir «nivel 0» sería afirmar algo que no se ha observado.
//   · El resultado **se calcula al leerlo**, sobre el dato vigente. No hay casilla guardada que pueda quedar
//     en desacuerdo con la realidad: si un dato cambia o caduca, el diagnóstico cambia con él.
//
// DE QUÉ ES EL DIAGNÓSTICO: DE LA ORGANIZACIÓN, O DE TU ALCANCE
// **Un nivel y un estado agregado también informan, aunque se oculte el recuento.** Si el estado se calculara
// sobre toda la organización y el número sobre el alcance de quien lee, bastaría con que otra persona cargara
// una parcela ajena para que alguien sin acceso a ella lo notara. Por eso **cada señal se evalúa dentro del
// alcance de quien lee**:
//   · con lectura de organización, el diagnóstico es **de la organización**;
//   · con lectura solo de lo asignado, el diagnóstico es **de tu alcance**, y así se declara;
//   · sin lectura de un dominio, su señal es **RESTRINGIDA** —sin estado y sin número— y el nivel que depende
//     de ella queda **NO DETERMINABLE para quien lee**, no «no alcanzado».
// Cambiar datos fuera del alcance de una persona **no puede** cambiar lo que esa persona ve.
//
// LO QUE EL DIAGNÓSTICO **NO** ES
// Madurez operativa **no** es conformidad jurídica, y **no levanta ninguna compuerta**: ni `READY`, ni el
// despacho, ni la conclusión regulatoria. Un nivel alto con una conclusión `UNDETERMINED` sigue siendo
// `UNDETERMINED`. Tampoco concede acceso: el asistente enseña **a dónde ir**, y cada módulo sigue exigiendo
// su permiso.
//
// D-49, opción A — **ADOPTADA el 2026-10-18 para desarrollo local**: la correspondencia «señal observable →
// nivel» es una **decisión provisional de producto**, porque la fuente solo da los nombres. Queda escrita,
// versionada y visible en la respuesta; **no** se presenta como exigencia de la fuente, **no** es una
// certificación de madurez y **no** levanta ninguna compuerta. Las alternativas —umbrales cuantitativos
// acordados, o un nivel 0–2 declarado por la organización— siguen abiertas en `docs/22`.

export const CRITERIO = { id: 'D-49', version: '1.0.0', status: 'ADOPTADA', option: 'A' } as const;

type EstadoSenal = 'OBSERVADA' | 'NO_OBSERVADA' | 'RESTRINGIDA' | 'NO_IMPLEMENTADA' | 'SIN_DECIDIR' | 'FUERA_DEL_SISTEMA';
type EstadoNivel = 'ALCANZADO' | 'NO_ALCANZADO' | 'NO_DETERMINABLE' | 'NO_IMPLEMENTADO';
type Alcance = 'ORGANIZACION' | 'ASIGNADOS' | 'RESTRINGIDO';

interface Senal {
  code: string;
  question: string;
  state: EstadoSenal;
  /** Qué se contó y dentro de qué alcance. `count` es `null` cuando el lector no puede ver ese detalle. */
  evidence: { count: number | null; scope: Alcance; as_of: string | null; note: string };
  source: string;
}
interface Nivel { level: number; name: string; source: string; state: EstadoNivel; why: string; signals: Senal[] }
type EstadoPaso = 'HECHO' | 'PENDIENTE' | 'OPCIONAL' | 'RESTRINGIDO';
interface Paso { code: string; title: string; state: EstadoPaso; why: string; evidence: string; action_href: string | null; who: string }

/** Nombres **literales** de S3 §16. No se reescriben ni se reinterpretan. */
const NOMBRES: Record<number, string> = {
  0: 'No digitalizado', 1: 'Registros manuales', 2: 'Excel / formularios',
  3: 'Trazabilidad digital', 4: 'Trazabilidad + riesgo', 5: 'EUDR operacional', 6: 'Inteligencia comercial',
};
const S3 = 'S3 §16 («Digital Maturity Engine»)';

const UMBRAL = 'El umbral es la PRESENCIA: existe al menos un registro. Las fuentes no definen ninguno, '
  + 'así que este es una decisión de producto (D-49, opción A), no un umbral derivado de la fuente. '
  + 'Unos umbrales cuantitativos serían igual de legítimos si se acordaran y justificaran; sencillamente no vienen dados.';

interface Conteos {
  miembros: number; productos: number; centros: number;
  productores: number; productores_mios: number;
  parcelas_geo: number; parcelas_geo_mias: number;
  entregas: number; entregas_mias: number;
  recepciones: number; recepciones_mias: number;
  lotes: number;
  adopciones_riesgo: number; evaluaciones: number;
  expedientes: number; instantaneas_ready: number; perfil_adoptado: number;
  importaciones: number;
  ult_productor: string | null; ult_productor_mio: string | null;
  ult_parcela: string | null; ult_parcela_mia: string | null;
  ult_lote: string | null; ult_evaluacion: string | null;
}

@Injectable()
export class OnboardingService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>, private readonly authz: AuthorizationService) {}

  private has(ctx: TenantContext, p: Permission) { return ctx.permissions.includes(p); }

  /**
   * Alcance de lectura del detalle. El **estado** de la señal es de la organización —la madurez es una
   * propiedad suya, como su estado—, pero **el número y la muestra** se entregan solo dentro de lo que esta
   * persona puede leer. Sin permiso de lectura, no se entrega número: `RESTRINGIDO` sin valor.
   */
  private alcance(ctx: TenantContext, amplio: Permission, asignado?: Permission): Alcance {
    if (this.has(ctx, amplio)) return 'ORGANIZACION';
    if (asignado && this.has(ctx, asignado)) return 'ASIGNADOS';
    return 'RESTRINGIDO';
  }

  private async conteos(orgId: string, membershipId: string): Promise<Conteos> {
    const r = await sql<Record<string, string | null>>`
      SELECT
        (SELECT count(*) FROM memberships WHERE organization_id = ${orgId} AND status = 'ACTIVE')::text AS miembros,
        (SELECT count(*) FROM products WHERE organization_id = ${orgId} AND status = 'ACTIVE')::text AS productos,
        (SELECT count(*) FROM locations WHERE organization_id = ${orgId} AND status = 'ACTIVE')::text AS centros,
        (SELECT count(*) FROM producers WHERE organization_id = ${orgId} AND status = 'ACTIVE')::text AS productores,
        (SELECT count(*) FROM producers WHERE organization_id = ${orgId} AND status = 'ACTIVE' AND assigned_membership_id = ${membershipId})::text AS productores_mios,
        (SELECT count(*) FROM plots p JOIN plot_versions v ON v.id = p.current_version_id
          WHERE p.organization_id = ${orgId} AND p.status = 'ACTIVE' AND v.geometry_type IS NOT NULL)::text AS parcelas_geo,
        (SELECT count(*) FROM plots p JOIN plot_versions v ON v.id = p.current_version_id
          JOIN producers pr ON pr.id = p.producer_id AND pr.organization_id = p.organization_id
          WHERE p.organization_id = ${orgId} AND p.status = 'ACTIVE' AND v.geometry_type IS NOT NULL
            AND pr.assigned_membership_id = ${membershipId})::text AS parcelas_geo_mias,
        (SELECT count(*) FROM deliveries WHERE organization_id = ${orgId} AND status = 'REGISTERED')::text AS entregas,
        (SELECT count(*) FROM deliveries d JOIN producers pr ON pr.id = d.producer_id AND pr.organization_id = d.organization_id
          WHERE d.organization_id = ${orgId} AND d.status = 'REGISTERED' AND pr.assigned_membership_id = ${membershipId})::text AS entregas_mias,
        (SELECT count(*) FROM receptions WHERE organization_id = ${orgId})::text AS recepciones,
        (SELECT count(*) FROM receptions r JOIN deliveries d ON d.id = r.delivery_id
          JOIN producers pr ON pr.id = d.producer_id AND pr.organization_id = d.organization_id
          WHERE r.organization_id = ${orgId} AND pr.assigned_membership_id = ${membershipId})::text AS recepciones_mias,
        (SELECT count(*) FROM lots WHERE organization_id = ${orgId})::text AS lotes,
        -- Append-only: ADOPT y WITHDRAW son FILAS, no un estado. Vigente = cuya ÚLTIMA decisión es ADOPT.
        -- Contar los ADOPT daría por vigente una adopción ya retirada.
        (SELECT count(*) FROM (SELECT DISTINCT ON (rule_set_version) decision FROM risk_rule_set_adoptions
            WHERE organization_id = ${orgId} ORDER BY rule_set_version, decided_at DESC) a
          WHERE a.decision = 'ADOPT')::text AS adopciones_riesgo,
        (SELECT count(*) FROM risk_evaluations WHERE organization_id = ${orgId})::text AS evaluaciones,
        (SELECT count(*) FROM dd_cases WHERE organization_id = ${orgId})::text AS expedientes,
        (SELECT count(*) FROM dd_snapshots WHERE organization_id = ${orgId} AND readiness = 'READY')::text AS instantaneas_ready,
        (SELECT count(*) FROM (SELECT DISTINCT ON (version) decision FROM legal_profile_adoptions
            WHERE organization_id = ${orgId} ORDER BY version, decided_at DESC) l
          WHERE l.decision = 'ADOPT')::text AS perfil_adoptado,
        (SELECT count(*) FROM import_batches WHERE organization_id = ${orgId} AND status = 'COMMITTED')::text AS importaciones,
        (SELECT max(created_at)::text FROM producers WHERE organization_id = ${orgId}) AS ult_productor,
        (SELECT max(created_at)::text FROM producers WHERE organization_id = ${orgId} AND assigned_membership_id = ${membershipId}) AS ult_productor_mio,
        (SELECT max(v.created_at)::text FROM plots p JOIN plot_versions v ON v.plot_id = p.id WHERE p.organization_id = ${orgId}) AS ult_parcela,
        (SELECT max(v.created_at)::text FROM plots p JOIN plot_versions v ON v.plot_id = p.id
          JOIN producers pr ON pr.id = p.producer_id AND pr.organization_id = p.organization_id
          WHERE p.organization_id = ${orgId} AND pr.assigned_membership_id = ${membershipId}) AS ult_parcela_mia,
        (SELECT max(created_at)::text FROM lots WHERE organization_id = ${orgId}) AS ult_lote,
        (SELECT max(evaluated_at)::text FROM risk_evaluations WHERE organization_id = ${orgId}) AS ult_evaluacion
      `.execute(this.db);
    const f = r.rows[0];
    const n = (k: string) => Number(f[k] ?? 0);
    return {
      miembros: n('miembros'), productos: n('productos'), centros: n('centros'),
      productores: n('productores'), productores_mios: n('productores_mios'),
      parcelas_geo: n('parcelas_geo'), parcelas_geo_mias: n('parcelas_geo_mias'),
      entregas: n('entregas'), entregas_mias: n('entregas_mias'),
      recepciones: n('recepciones'), recepciones_mias: n('recepciones_mias'), lotes: n('lotes'),
      adopciones_riesgo: n('adopciones_riesgo'), evaluaciones: n('evaluaciones'),
      expedientes: n('expedientes'), instantaneas_ready: n('instantaneas_ready'), perfil_adoptado: n('perfil_adoptado'),
      importaciones: n('importaciones'),
      ult_productor: f.ult_productor, ult_productor_mio: f.ult_productor_mio,
      ult_parcela: f.ult_parcela, ult_parcela_mia: f.ult_parcela_mia,
      ult_lote: f.ult_lote, ult_evaluacion: f.ult_evaluacion,
    };
  }

  async diagnostico(user: AuthUser, orgId: string) {
    const ctx = await this.authz.tenantContext(user, orgId);
    if (!ctx) throw notFound();
    const c = await this.conteos(orgId, ctx.membershipId);
    const base = `/organizaciones/${orgId}`;

    /**
     * Señal observable **dentro del alcance de quien lee**. Sin alcance no hay estado: `RESTRINGIDA` no es
     * «no observada», porque afirmar que algo no existe exigiría poder mirarlo.
     */
    const senal = (code: string, question: string, source: string,
      vista: { scope: Alcance; count: number; as_of: string | null }, note: string): Senal => ({
      code, question,
      state: vista.scope === 'RESTRINGIDO' ? 'RESTRINGIDA' : vista.count > 0 ? 'OBSERVADA' : 'NO_OBSERVADA',
      evidence: {
        count: vista.scope === 'RESTRINGIDO' ? null : vista.count,
        scope: vista.scope, as_of: vista.scope === 'RESTRINGIDO' ? null : vista.as_of,
        note: vista.scope === 'RESTRINGIDO'
          ? 'Tu rol no puede leer este dominio, así que aquí no se afirma nada sobre él: ni cuántos hay, ni si los hay.'
          : vista.scope === 'ASIGNADOS'
            ? `${note} Se cuenta SOLO lo que tienes asignado: este diagnóstico es el de tu alcance, no el de toda la organización.`
            : note,
      },
      source,
    });
    /** Elige el número y la fecha que corresponden al alcance de lectura de esta persona. */
    const porPermiso = (p: Permission, n: number, fecha: string | null = null,
      asignado?: Permission, nMio = 0, fechaMia: string | null = null) => {
      const a = this.alcance(ctx, p, asignado);
      return a === 'ASIGNADOS'
        ? { scope: a, count: nMio, as_of: fechaMia }
        : { scope: a, count: n, as_of: fecha };
    };
    /** El diagnóstico es «de la organización» solo si nada se ha tenido que acotar. */
    let acotado = false;

    // ---------------------------------------------------------------- niveles
    const fueraDelSistema = (code: string, question: string): Senal => ({
      code, question, state: 'FUERA_DEL_SISTEMA',
      evidence: { count: null, scope: 'ORGANIZACION', as_of: null,
        note: 'Ocurre fuera de Terra Link: el sistema no observa papel, registros manuales ni hojas de cálculo propias.' },
      source: S3,
    });

    const niveles: Nivel[] = [];
    for (const l of [0, 1, 2]) {
      niveles.push({
        level: l, name: NOMBRES[l], source: S3, state: 'NO_DETERMINABLE',
        why: 'Terra Link no puede distinguir una organización no digitalizada de una que todavía no ha cargado nada aquí. Afirmar este nivel sería afirmar algo no observado.',
        signals: [fueraDelSistema(`FUERA_${l}`, `¿Cómo se registra el dato fuera de Terra Link?`)],
      });
    }

    const vistaProductores = porPermiso('producer:read', c.productores, c.ult_productor, 'producer:read_assigned', c.productores_mios, c.ult_productor_mio);
    const vistaParcelas = porPermiso('plot:read', c.parcelas_geo, c.ult_parcela, 'plot:read_assigned', c.parcelas_geo_mias, c.ult_parcela_mia);
    const vistaEntregas = porPermiso('delivery:read', c.entregas, null, 'delivery:read_assigned', c.entregas_mias);
    const vistaRecepciones = porPermiso('delivery:read', c.recepciones, null, 'delivery:read_assigned', c.recepciones_mias);
    const vistaLotes = porPermiso('lot:read', c.lotes, c.ult_lote);
    const vistaCatalogo = porPermiso('risk:read', c.adopciones_riesgo);
    const vistaEvaluaciones = porPermiso('risk:read', c.evaluaciones, c.ult_evaluacion);
    const vistaExpedientes = porPermiso('dd:read', c.expedientes);
    const vistaPerfil = porPermiso('traceability:read_catalog', c.perfil_adoptado);
    acotado = [vistaProductores, vistaParcelas, vistaEntregas, vistaRecepciones, vistaLotes,
      vistaCatalogo, vistaEvaluaciones, vistaExpedientes, vistaPerfil].some((v) => v.scope !== 'ORGANIZACION');

    const n3: Senal[] = [
      senal('PRODUCTORES', '¿Hay productores registrados?', S3, vistaProductores,
        'Productores activos registrados en Terra Link.'),
      senal('PARCELAS_CON_GEOMETRIA', '¿Hay parcelas con geometría vigente?', S3, vistaParcelas,
        'Parcelas activas cuya versión vigente tiene punto o polígono. La superficie declarada no cuenta como ubicación.'),
      senal('ENTREGAS_REGISTRADAS', '¿Hay entregas registradas, no solo borradores?', S3, vistaEntregas,
        'Entregas en estado REGISTERED. Un borrador no acredita operación digital.'),
      senal('RECEPCIONES', '¿Se confirma la recepción física en el sistema?', S3, vistaRecepciones,
        'Recepciones confirmadas con su pesaje.'),
      senal('LOTES', '¿Se conforman lotes a partir de recepciones?', S3, vistaLotes,
        'Lotes conformados desde el inventario.'),
    ];
    const n4: Senal[] = [
      senal('CATALOGO_DE_RIESGO', '¿La organización adoptó una versión del catálogo de reglas?', S3, vistaCatalogo,
        'Adopción explícita de una versión del catálogo. Sin adopción no hay reglas vigentes para esta organización.'),
      senal('EVALUACIONES_DE_RIESGO', '¿Se han evaluado lotes con esas reglas?', S3, vistaEvaluaciones,
        'Evaluaciones de riesgo registradas. El resultado de cada una NO forma parte de la madurez: una evaluación con hallazgos cuenta igual que una sin ellos.'),
    ];
    const n5: Senal[] = [
      senal('EXPEDIENTES', '¿Se preparan expedientes de debida diligencia?', S3, vistaExpedientes, 'Expedientes abiertos.'),
      {
        code: 'INSTANTANEA_READY', question: '¿Existe una instantánea del expediente en estado READY?',
        state: vistaExpedientes.scope === 'RESTRINGIDO' ? 'RESTRINGIDA' : c.instantaneas_ready > 0 ? 'OBSERVADA' : 'SIN_DECIDIR',
        evidence: {
          count: vistaExpedientes.scope === 'RESTRINGIDO' ? null : c.instantaneas_ready,
          scope: vistaExpedientes.scope, as_of: null,
          note: vistaExpedientes.scope === 'RESTRINGIDO'
            ? 'Tu rol no puede leer los expedientes, así que aquí no se afirma nada sobre ellos.'
            : 'Hoy ninguna puede estarlo: READY depende de decisiones abiertas (D-05.B, D-07.5, D-07.6) y del perfil jurídico (P1-005). Es una decisión pendiente, no un dato que falte por cargar.',
        },
        source: S3,
      },
      {
        code: 'PERFIL_JURIDICO', question: '¿Hay un perfil jurídico adoptado y revisado?',
        state: vistaPerfil.scope === 'RESTRINGIDO' ? 'RESTRINGIDA' : c.perfil_adoptado > 0 ? 'SIN_DECIDIR' : 'NO_OBSERVADA',
        evidence: {
          count: vistaPerfil.scope === 'RESTRINGIDO' ? null : c.perfil_adoptado, scope: vistaPerfil.scope, as_of: null,
          note: vistaPerfil.scope === 'RESTRINGIDO'
            ? 'Tu rol no puede leer el catálogo jurídico, así que aquí no se afirma nada sobre él.'
            : 'Adoptar el catálogo no es tenerlo revisado por una persona competente. P1-005 sigue abierta y **la madurez no sustituye esa revisión**.',
        },
        source: S3,
      },
    ];
    const n6: Senal[] = [{
      code: 'ANALITICA_COMERCIAL', question: '¿Hay analítica comercial sobre los datos propios?',
      state: 'NO_IMPLEMENTADA',
      evidence: { count: null, scope: 'ORGANIZACION', as_of: null,
        note: 'Terra Link todavía no implementa analítica ni puntuación de proveedores (P1-014). No es un dato que falte: es una capacidad que no existe.' },
      source: S3,
    }];

    const evalua = (signals: Senal[], anteriorAlcanzado: boolean): { state: EstadoNivel; why: string } => {
      if (signals.some((s) => s.state === 'NO_IMPLEMENTADA')) {
        return { state: 'NO_IMPLEMENTADO', why: 'Depende de una capacidad que Terra Link aún no implementa.' };
      }
      // Sin poder leer sus señales no se puede afirmar nada de este nivel: ni que se alcanza, ni que no.
      const ciegas = signals.filter((s) => s.state === 'RESTRINGIDA').map((s) => s.code);
      if (ciegas.length) {
        return { state: 'NO_DETERMINABLE', why: `Tu rol no puede leer las señales de este nivel (${ciegas.join(', ')}), así que con tu alcance no se puede afirmar nada sobre él.` };
      }
      const faltan = signals.filter((s) => s.state !== 'OBSERVADA');
      if (faltan.length) {
        const sinDecidir = faltan.filter((s) => s.state === 'SIN_DECIDIR').map((s) => s.code);
        const sinDato = faltan.filter((s) => s.state === 'NO_OBSERVADA').map((s) => s.code);
        return {
          state: 'NO_ALCANZADO',
          why: [sinDato.length ? `Falta dato observable: ${sinDato.join(', ')}.` : '',
            sinDecidir.length ? `Espera una decisión pendiente: ${sinDecidir.join(', ')}.` : ''].filter(Boolean).join(' '),
        };
      }
      if (!anteriorAlcanzado) return { state: 'NO_ALCANZADO', why: 'Sus señales se observan, pero el nivel anterior no está alcanzado.' };
      return { state: 'ALCANZADO', why: 'Todas sus señales se observan en el dato vigente.' };
    };

    // El nivel 3 es el primero observable: los de debajo ocurren fuera del sistema y no se dan por alcanzados.
    const e3 = evalua(n3, true);
    const e4 = evalua(n4, e3.state === 'ALCANZADO');
    const e5 = evalua(n5, e4.state === 'ALCANZADO');
    const e6 = evalua(n6, e5.state === 'ALCANZADO');
    niveles.push(
      { level: 3, name: NOMBRES[3], source: S3, ...e3, signals: n3 },
      { level: 4, name: NOMBRES[4], source: S3, ...e4, signals: n4 },
      { level: 5, name: NOMBRES[5], source: S3, ...e5, signals: n5 },
      { level: 6, name: NOMBRES[6], source: S3, ...e6, signals: n6 },
    );

    const alcanzados = niveles.filter((n) => n.state === 'ALCANZADO').map((n) => n.level);
    const reached = alcanzados.length ? Math.max(...alcanzados) : null;

    // ---------------------------------------------------------------- asistente (UX_UI §10.4)
    // Pasos DERIVADOS del dato real. No hay tabla de pasos completados: una marca guardada podría quedar en
    // desacuerdo con la realidad, y la propia fuente pide «mostrar pasos pendientes reales».
    const paso = (code: string, title: string, hecho: boolean, why: string, evidencia: string,
      permiso: Permission | null, href: string, who: string, opcional = false): Paso => ({
      code, title,
      state: permiso && !this.has(ctx, permiso) ? 'RESTRINGIDO' : hecho ? 'HECHO' : opcional ? 'OPCIONAL' : 'PENDIENTE',
      why, evidence: evidencia,
      action_href: permiso && !this.has(ctx, permiso) ? null : href,
      who,
    });
    const pasos: Paso[] = [
      paso('ORGANIZACION', 'Datos de la organización', true,
        'La organización existe y está activa. Los datos fiscales y de ubicación son opcionales en el contrato y no se exigen aquí.',
        `Estado: ${ctx.organizationStatus}.`, 'organization:read', base, 'Administración de la organización'),
      paso('EQUIPO', 'Equipo', c.miembros > 1,
        'Con una sola membresía no hay reparto de trabajo ni separación de funciones.',
        `${c.miembros} membresía(s) activa(s).`, 'membership:read', `${base}/miembros`, 'Administración de la organización'),
      paso('CATALOGOS', 'Productos', c.productos > 0,
        'Sin producto no se puede registrar una entrega.',
        `${c.productos} producto(s) activo(s).`, 'product:read', `${base}/productos`, 'Administración de la organización'),
      paso('CENTROS', 'Centros y ubicaciones', c.centros > 0,
        'Sin centro no se puede confirmar una recepción.',
        `${c.centros} ubicación(es) activa(s).`, 'location:read', `${base}/centros`, 'Administración de la organización'),
      paso('PRODUCTORES', 'Productores', c.productores > 0,
        'El origen empieza aquí: sin productores no hay cadena.',
        `${c.productores} productor(es) activo(s).`, null, `${base}/productores`, 'Técnico de campo o administración'),
      paso('PARCELAS', 'Parcelas con ubicación', c.parcelas_geo > 0,
        'Sin punto ni polígono no hay evaluación geográfica posible.',
        `${c.parcelas_geo} parcela(s) con geometría vigente.`, null, `${base}/parcelas`, 'Técnico de campo'),
      paso('IMPORTACION', 'Importación en volumen', c.importaciones > 0,
        'Es un atajo para cargar registros existentes, no una obligación: registrar a mano es igual de válido.',
        `${c.importaciones} importación(es) confirmada(s).`, 'import:manage', `${base}/importaciones`, 'Administración o gerencia', true),
      paso('REVISION', 'Revisión del trabajo pendiente', false,
        'El asistente termina donde empieza la operación: «Mi trabajo» muestra lo que queda por resolver.',
        'Se revisa en «Mi trabajo»; no se marca como completado.', null, base, 'Cada persona, en su cola'),
    ];

    return {
      organization_id: orgId, organization_status: ctx.organizationStatus, generated_at: new Date().toISOString(),
      criterion: {
        ...CRITERIO,
        note: 'S3 §16 nombra los siete niveles con un «Por ejemplo» y no define umbrales, porcentajes ni condiciones. La correspondencia señal→nivel es una decisión PROVISIONAL de producto (D-49, opción A, adoptada el 2026-10-18 para desarrollo local): no es una exigencia de la fuente ni una certificación de madurez.',
        threshold: UMBRAL,
      },
      scope_of_diagnosis: acotado ? 'MI_ALCANCE' : 'ORGANIZACION',
      level: {
        reached, name: reached === null ? null : NOMBRES[reached],
        basis: (reached === null
          ? 'Ningún nivel observable alcanzado. Los niveles 0 a 2 ocurren fuera de Terra Link y no se afirman.'
          : `Nivel ${reached} («${NOMBRES[reached]}»): todas sus señales se observan en el dato vigente, y las de los niveles observables anteriores también.`)
          + (acotado
            ? ' Este diagnóstico es el de TU ALCANCE, no el de toda la organización: solo cuenta lo que puedes leer, y los niveles cuyas señales no alcanzas quedan no determinables.'
            : ' Este diagnóstico es el de toda la organización.'),
      },
      levels: niveles,
      steps: pasos,
      blockers: {
        missing_data: niveles.flatMap((n) => n.signals.filter((s) => s.state === 'NO_OBSERVADA').map((s) => ({ level: n.level, code: s.code, question: s.question }))),
        not_implemented: niveles.flatMap((n) => n.signals.filter((s) => s.state === 'NO_IMPLEMENTADA').map((s) => ({ level: n.level, code: s.code, note: s.evidence.note }))),
        undecided: niveles.flatMap((n) => n.signals.filter((s) => s.state === 'SIN_DECIDIR').map((s) => ({ level: n.level, code: s.code, note: s.evidence.note }))),
      },
      freshness: 'El diagnóstico se calcula al leerlo, sobre el dato vigente: no hay marcas guardadas. Si un dato cambia, se retira o caduca, el nivel cambia con él en la siguiente lectura.',
      disclaimer: 'La madurez operativa NO acredita conformidad jurídica ni EUDR, NO sustituye la revisión del perfil jurídico y NO levanta ninguna compuerta: ni READY, ni el despacho, ni la conclusión regulatoria. Tampoco concede acceso: cada módulo sigue exigiendo su permiso.',
    };
  }
}

@ApiTags('onboarding')
@ApiBearerAuth()
@Controller('api/v1/organizations/:orgId')
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  @Get('onboarding')
  @ApiOperation({ summary: 'Onboarding y diagnóstico de madurez 0–6 con la evidencia de cada nivel (no acredita conformidad)' })
  diagnostico(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.service.diagnostico(user, orgId);
  }
}
