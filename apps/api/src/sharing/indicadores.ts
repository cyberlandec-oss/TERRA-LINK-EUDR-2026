import type { DdContent, Requirement } from '../dd/requirements';

// RF-32 / D-48(A) — Los once indicadores del Buyer Portal (S3 §22.8), como **estados del recurso concedido**.
//
// DE DÓNDE SALEN
// **No hay motor nuevo.** Cada indicador se deriva de lo que el expediente ya calcula: `evaluateRequirements()`
// sobre el contenido del lote, más los agregados que la proyección ya entregaba. Si mañana cambia una regla de
// riesgo, el indicador cambia con ella, porque es la misma evaluación.
//
// QUÉ NO SALEN
// Ni identidad de productores, ni coordenadas, ni contenido documental, ni identificadores de recursos
// relacionados. Un indicador es **un estado y su fundamento**, nunca el dato que lo produjo. Por eso tampoco
// se copia el `detail` ni las `references` del requisito: ahí viajan códigos de parcelas y entregas.
//
// SEIS ESTADOS, PORQUE SEIS COSAS DISTINTAS
// Colapsarlos convertiría «no se sabe» en «conforme», que es justo lo que no puede pasar:
//   · `FAVORABLE`      — hay resultado y es favorable;
//   · `DESFAVORABLE`   — hay resultado y NO es favorable;
//   · `PENDIENTE`      — falta algo que está en curso o por hacer;
//   · `DESACTUALIZADO` — hubo evaluación, pero ya no corresponde al estado actual;
//   · `NO_EVALUABLE`   — no se puede concluir: falta una capacidad o una decisión que nadie ha tomado;
//   · `SIN_EVALUAR`    — sencillamente no se ha evaluado.
//
// LAS TRES DISTINCIONES QUE NO SE PUEDEN PERDER
//   1. **geolocalización técnica ≠ perfil jurídico** — que una geometría sea válida no dice que cumpla el
//      perfil que exige la norma;
//   2. **análisis de deforestación ≠ conclusión regulatoria** — un análisis sin alertas no concluye nada;
//   3. **preparación del expediente ≠ presentación de una DDS** — `READY` es interno; una DDS se presenta
//      fuera de aquí, y hoy **ninguna lo está**.

export type EstadoIndicador = 'FAVORABLE' | 'DESFAVORABLE' | 'PENDIENTE' | 'DESACTUALIZADO' | 'NO_EVALUABLE' | 'SIN_EVALUAR';

export interface Indicador {
  code: string;
  label: string;
  state: EstadoIndicador;
  /** Qué significa ese estado aquí. Sin identificadores ni datos del recurso. */
  note: string;
  /** Versión y fecha que SUSTENTAN el resultado, para que una evaluación histórica no parezca actual. */
  basis?: { version?: string | null; evaluated_at?: string | null };
}

/** Un requisito por código, o `undefined` si esa evaluación no existe. */
const req = (rs: Requirement[], code: string) => rs.find((r) => r.code === code);

/** Traducción directa del estado del requisito, cuando no hay matiz que añadir. */
function deRequisito(r: Requirement | undefined, cuandoFalta: EstadoIndicador = 'SIN_EVALUAR'): EstadoIndicador {
  if (!r) return cuandoFalta;
  if (r.status === 'MET') return 'FAVORABLE';
  if (r.status === 'INVALID') return 'DESFAVORABLE';
  if (r.status === 'PENDING') return 'PENDIENTE';
  return 'NO_EVALUABLE';
}

/**
 * Período de producción (S1 §44 `production_period`), **solo con lo DECLARADO**.
 *
 * DE DÓNDE SALEN `harvest_derived_*`
 * No de la fecha de entrega. El CHECK `deliveries_harvest_shape` (migración 0021) solo los admite cuando
 * **expanden la cosecha declarada**: un `DAY` se copia tal cual y un `MONTH` se abre a los límites de ese mes,
 * para poder consultar por rango. Con la cosecha `UNKNOWN` o sin declarar, el propio CHECK los obliga a ser
 * NULL. Son un índice de la declaración, no una deducción sobre ella.
 *
 * POR QUÉ AQUÍ NO HAY PRECISIÓN «DERIVADA»
 * Deducir no es declarar. El período que se publica se sostiene **únicamente** en lo que la organización
 * declaró como cosecha; si no declaró, el período queda **desconocido**, y saber cuándo se entregó el cacao no
 * dice cuándo se produjo. Por eso esta función **nunca** convierte límites derivados en período.
 *
 * LÍMITES HEREDADOS
 * Si un dato histórico trajera límites derivados sin una declaración que los sustente —hoy imposible por el
 * CHECK—, se **conservan** en `inherited_range`, **separados** del período, con su procedencia escrita: ni
 * acreditan producción ni se presentan como cosecha declarada. No se reconstruyen ni se corrigen.
 */
export interface PeriodoProduccion {
  /** Precisión **declarada**. `UNKNOWN`: la organización declaró no saberlo. `NONE`: no declaró nada. */
  precision: 'DAY' | 'MONTH' | 'UNKNOWN' | 'NONE';
  start: string | null;
  end: string | null;
  note: string;
  /** Procedencia histórica conservada aparte; nunca es el período. */
  inherited_range: { start: string; end: string; note: string } | null;
}

type FilaCosecha = {
  harvest_precision: string | null; harvest_start: string | null; harvest_end: string | null;
  harvest_derived_start: string | null; harvest_derived_end: string | null;
};

const declarada = (c: FilaCosecha) => Boolean(c.harvest_start && c.harvest_precision && c.harvest_precision !== 'UNKNOWN');

export function periodoDeProduccion(cosechas: FilaCosecha[]): PeriodoProduccion {
  const declaradas = cosechas.filter(declarada);

  // Límites derivados SIN declaración que los sustente: se conservan como procedencia, jamás como período.
  const huerfanos = cosechas.filter((c) => c.harvest_derived_start && !declarada(c));
  const inherited_range = huerfanos.length
    ? {
      start: huerfanos.map((c) => c.harvest_derived_start!).sort()[0],
      end: huerfanos.map((c) => c.harvest_derived_end ?? c.harvest_derived_start!).sort().at(-1)!,
      note: 'Límites heredados sin cosecha declarada que los sustente. Se conservan por su procedencia histórica; '
        + 'NO son una cosecha declarada y NO acreditan cuándo se produjo el cacao.',
    }
    : null;

  if (declaradas.length) {
    const inicio = declaradas.map((c) => c.harvest_start!).sort()[0];
    const fin = declaradas.map((c) => c.harvest_end ?? c.harvest_start!).sort().at(-1)!;
    // Precisiones mezcladas: manda la MÁS GRUESA. No se finge exactitud.
    const precision = declaradas.some((c) => c.harvest_precision === 'MONTH') ? 'MONTH' : 'DAY';
    // Cobertura: un período declarado por parte de las entregas no cubre el lote entero, y se dice.
    const parcial = declaradas.length < cosechas.length;
    return {
      precision, start: inicio, end: fin, inherited_range,
      note: `Período declarado por la organización con precisión de ${precision === 'MONTH' ? 'mes' : 'día'}. `
        + (parcial ? `Solo ${declaradas.length} de ${cosechas.length} entregas del lote declararon cosecha; el resto sigue desconocido. ` : '')
        + 'Terra Link no lo verifica.',
    };
  }

  if (cosechas.some((c) => c.harvest_precision === 'UNKNOWN')) {
    return {
      precision: 'UNKNOWN', start: null, end: null, inherited_range,
      note: 'La organización declaró la cosecha como DESCONOCIDA. El período de producción sigue desconocido: '
        + 'la fecha de entrega no lo sustituye, porque entregar no es producir.',
    };
  }

  return {
    precision: 'NONE', start: null, end: null, inherited_range,
    note: 'Sin cosecha declarada. El período de producción es desconocido y no se deduce de la fecha de entrega.',
  };
}

/**
 * Período y país de producción de una INSTANTÁNEA, tal como la instantánea los fijó. Tres estados que no se mezclan:
 *   · `DECLARED`         — la organización declaró un valor (cosecha con día o mes; país con código);
 *   · `DECLARED_UNKNOWN` — la organización dejó constancia de que NO lo sabe;
 *   · `NOT_DECLARED`     — nadie declaró nada (la clave no existe en el contenido).
 * Los recuentos por estado se entregan siempre, de modo que un origen desconocido nunca queda dentro de un intervalo general que parezca completo.
 * No hay fecha de entrega, de recepción ni de análisis como sustituto, ni país deducido de la organización, del comprador o del destino.
 * Sin identificadores: ni códigos de entrega ni de parcela (las parcelas, con su geometría, solo si la concesión las incluye).
 */
export type EstadoDeclaracion = 'DECLARED' | 'DECLARED_UNKNOWN' | 'NOT_DECLARED';
export interface ProduccionDeInstantanea {
  period: PeriodoProduccion & {
    deliveries: { total: number; declared: number; declared_unknown: number; not_declared: number; corrected: number };
    by_origin_delivery: Array<{ state: EstadoDeclaracion; precision: string | null; start: string | null; end: string | null; corrections: number }>;
  };
  country: {
    parcels: { total: number; declared: number; declared_unknown: number; not_declared: number };
    declared_countries: Array<{ country: string; parcels: number }>;
    note: string;
  };
}

export function produccionDeContenido(c: Pick<DdContent, 'deliveries' | 'plots'>): ProduccionDeInstantanea {
  const entregas = c.deliveries ?? [];
  const filas: FilaCosecha[] = entregas.map((d) => ({
    harvest_precision: d.harvest?.precision ?? null, harvest_start: d.harvest?.start ?? null, harvest_end: d.harvest?.end ?? null,
    harvest_derived_start: null, harvest_derived_end: null,
  }));
  const estadoDe = (d: (typeof entregas)[number]): EstadoDeclaracion => (!d.harvest ? 'NOT_DECLARED' : d.harvest.precision === 'UNKNOWN' ? 'DECLARED_UNKNOWN' : 'DECLARED');
  const por = entregas.map(estadoDe);
  const periodo = periodoDeProduccion(filas);

  const parcelas = c.plots ?? [];
  const paises = new Map<string, number>();
  let desconocidos = 0; let sinDeclarar = 0;
  for (const p of parcelas) {
    if (!p.production_country) sinDeclarar++;
    else if (!p.production_country.country) desconocidos++;
    else paises.set(p.production_country.country, (paises.get(p.production_country.country) ?? 0) + 1);
  }
  const declaradas = [...paises.values()].reduce((a, b) => a + b, 0);
  return {
    period: {
      ...periodo,
      deliveries: {
        total: entregas.length, declared: por.filter((e) => e === 'DECLARED').length, declared_unknown: por.filter((e) => e === 'DECLARED_UNKNOWN').length,
        not_declared: por.filter((e) => e === 'NOT_DECLARED').length, corrected: entregas.filter((d) => (d.harvest?.correction_number ?? 0) > 0).length,
      },
      by_origin_delivery: entregas.map((d, i) => ({ state: por[i], precision: d.harvest?.precision ?? null, start: d.harvest?.start ?? null, end: d.harvest?.end ?? null, corrections: d.harvest?.correction_number ?? 0 }))
        .sort((a, b) => `${a.state}${a.start ?? ''}${a.end ?? ''}`.localeCompare(`${b.state}${b.start ?? ''}${b.end ?? ''}`)),
    },
    country: {
      parcels: { total: parcelas.length, declared: declaradas, declared_unknown: desconocidos, not_declared: sinDeclarar },
      declared_countries: [...paises.entries()].map(([country, parcels]) => ({ country, parcels })).sort((a, b) => a.country.localeCompare(b.country)),
      note: 'País de producción declarado por la organización parcela por parcela; Terra Link no lo deduce ni lo verifica. Las parcelas sin declarar o declaradas como desconocidas NO se asignan a ningún país.',
    },
  };
}

/**
 * Los once indicadores de S3 §22.8. Los dos de recuento (productores y parcelas) siguen viajando como
 * agregados en la proyección; aquí van los nueve que son **estado**.
 */
export function indicadoresDe(c: DdContent, rs: Requirement[]): Indicador[] {
  const riesgo = c.risk;
  const sustentoRiesgo = riesgo
    ? { version: `evaluación ${riesgo.evaluation_number} · reglas ${riesgo.rule_set_version}`, evaluated_at: null }
    : undefined;

  // Geometría: versión de cada parcela, para que no parezca actual una validación de una versión anterior.
  const versionesGeo = c.plots.map((p) => p.version_number).filter((v): v is number => v != null);
  const sustentoGeo = versionesGeo.length ? { version: `versiones de geometría ${[...new Set(versionesGeo)].sort((a, b) => a - b).join(', ')}` } : undefined;

  const evidencias = c.evidence ?? [];
  const verificadas = evidencias.filter((e) => e.status === 'VERIFIED').length;
  const revocadas = evidencias.filter((e) => e.status === 'REVOKED').length;
  const pendientes = evidencias.length - verificadas - revocadas;

  const origenDeclarado = req(rs, 'ORIGIN_DECLARED');
  const geometria = req(rs, 'GEOMETRY_TECHNICAL');
  const perfilGeo = req(rs, 'GEOLOCATION_PROFILE');
  const deforestacion = req(rs, 'DEFORESTATION_ANALYSIS');
  const legal = req(rs, 'LEGAL_PROFILE');
  const balance = req(rs, 'QUANTITIES_CONSISTENT');
  const conclusion = req(rs, 'REGULATORY_CONCLUSION');
  const vigencia = req(rs, 'RISK_EVALUATION_CURRENT');

  return [
    {
      code: 'ORIGEN_IDENTIFICADO',
      label: 'Origen identificado',
      state: deRequisito(origenDeclarado),
      note: 'Si las entregas del lote declaran la parcela de origen. Declarado por la organización; Terra Link no lo verifica en campo.',
    },
    {
      code: 'GEOLOCALIZACION_VALIDADA',
      label: 'Geolocalización validada (técnica)',
      // Si la geometría es técnicamente válida pero el perfil jurídico no está aprobado, NO se presenta como
      // conformidad: se dice que lo validado es lo técnico.
      state: deRequisito(geometria),
      note: perfilGeo && perfilGeo.status !== 'MET'
        ? 'Validación TÉCNICA de la geometría. NO acredita el perfil jurídico de geolocalización, que sigue sin aprobarse: una geometría válida no es una geometría conforme.'
        : 'Validación técnica de la geometría.',
      basis: sustentoGeo,
    },
    {
      code: 'DEFORESTACION_REVISADA',
      label: 'Deforestación revisada',
      state: deRequisito(deforestacion, 'SIN_EVALUAR'),
      note: 'Análisis TÉCNICO de deforestación. No es una conclusión regulatoria, y la ausencia de alertas no prueba ausencia de deforestación.',
    },
    {
      code: 'LEGALIDAD_REVISADA',
      label: 'Legalidad revisada',
      state: deRequisito(legal),
      note: 'Depende del perfil jurídico aplicable. Un perfil parcial o sin revisión jurídica no acredita legalidad.',
    },
    {
      code: 'TRAZABILIDAD_COMPLETA',
      label: 'Trazabilidad completa',
      state: c.subject.origin_status === 'COMPLETE' ? 'FAVORABLE'
        : c.subject.origin_status === 'INCOMPLETE' ? 'DESFAVORABLE' : 'NO_EVALUABLE',
      note: 'Si la cadena de origen del lote está completa hacia atrás. Origen desconocido sigue siendo desconocido.',
    },
    {
      code: 'BALANCE_DE_MASA',
      label: 'Balance de masa',
      state: deRequisito(balance),
      note: 'Coherencia entre el inventario y el dominio. Una diferencia se corrige con un ajuste auditado, no borrando el histórico.',
    },
    {
      code: 'EVIDENCIAS',
      label: 'Evidencias',
      // Presencia NO es suficiencia: se informa disponibilidad y revisión, nunca «evidencia suficiente».
      state: evidencias.length === 0 ? 'SIN_EVALUAR'
        : revocadas > 0 ? 'DESFAVORABLE'
          : pendientes > 0 ? 'PENDIENTE'
            : 'FAVORABLE',
      note: `${evidencias.length} evidencia(s) registradas: ${verificadas} verificada(s), ${pendientes} sin verificar, ${revocadas} revocada(s). `
        + 'Indica DISPONIBILIDAD y REVISIÓN, no suficiencia: que una evidencia esté cargada y supere el análisis antimalware no la vuelve suficiente. No da acceso a los originales.',
    },
    {
      code: 'RIESGO_FINAL',
      label: 'Riesgo final',
      // La conclusión regulatoria es lo que decide; el resultado técnico NO la sustituye.
      state: vigencia && vigencia.status === 'INVALID' ? 'DESACTUALIZADO' : deRequisito(conclusion),
      note: riesgo
        ? `Resultado técnico «${riesgo.technical_result}»; conclusión regulatoria «${riesgo.conclusion}». El resultado técnico NO es la conclusión regulatoria.`
        : 'Sin evaluación de riesgo del lote: no se presume ausencia de hallazgos.',
      basis: sustentoRiesgo,
    },
    {
      code: 'DDS',
      label: 'DDS presentada',
      // Terra Link no presenta DDS. Esto no es un pendiente del lote: es un límite del producto.
      state: 'NO_EVALUABLE',
      note: 'Terra Link NO presenta declaraciones de diligencia debida. La preparación interna del expediente —incluido READY— no es una DDS presentada ni acredita conformidad EUDR.',
    },
  ];
}
