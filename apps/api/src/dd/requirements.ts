import { createHash } from 'crypto';

// P0-022: guards por requisito y generador del paquete, como funciones PURAS sobre el contenido de una instantánea
// (docs/13 §Ciclo del expediente y §Paquete). No leen la base: el paquete se genera solo desde la instantánea.
// - Cada requisito: MET (cumplido) · PENDING (pendiente) · INVALID (inválido) · NOT_EVALUABLE (no evaluable).
//   Una condición desconocida es NOT_EVALUABLE, nunca falsa ni favorable.
// - READY solo si TODOS están cumplidos; el porcentaje de cumplidos es informativo y no elimina bloqueos.
// - Calidad pendiente, origen incompleto o mitigaciones verificadas no equivalen a aprobación regulatoria.
// - Requisitos que dependen de decisiones o capacidades inexistentes (perfil jurídico, D-05, satélite P0-028,
//   catálogo de riesgo aprobado, vínculo con embarque P0-017/P0-029) quedan NOT_EVALUABLE: no se rebajan.

export type ReqStatus = 'MET' | 'PENDING' | 'INVALID' | 'NOT_EVALUABLE';
export type Readiness = 'BLOCKED' | 'IN_PROGRESS' | 'READY';

export interface DdContent {
  synthetic_fixture?: boolean;
  subject: { type: 'LOT'; id: string; code: string; product: string; unit: string; origin_status: string };
  quantities: { physical: string; reserved: string; available: string; unit: string; source: string };
  origin: { lots: Array<{ id: string; lot_code: string; origin_status: string }>; ledger_differences: Array<{ kind: string; id: string }> };
  deliveries: Array<{ id: string; code: string; row_version: string; origin_plots: string[];
    /** Cosecha EFECTIVA declarada en la entrega (precisión, límites y número de corrección; 0 = declaración original). La clave no existe si la entrega no declaró nada: eso es «sin declarar», no un intervalo. */
    harvest?: { precision: string; start: string | null; end: string | null; correction_number: number } }>;
  plots: Array<{ production_country?: { declaration_number: number; country: string | null; declared_at: string }; plot_id: string; plot_code: string; version_id: string | null; version_number: number | null; geometry_type: string | null; geometry_hash: string | null; validation_status: string | null; gis_status: string | null; geometry: unknown | null }>;
  quality: Array<{ reception_id: string; delivery_code: string; decision: string }>;
  documents: Array<{ document_id: string; version_id: string; title: string; document_type: string; classification: string; version_number: number; sha256: string; file_name: string; expires_at: string | null; expired: boolean; scan: string | null; used_by: string; reference: string }>;
  evidence: Array<{ id: string; claim_type: string; entity_type: string; entity_id: string; status: string; row_version: string }>;
  risk: null | { evaluation_id: string; evaluation_number: number; snapshot_hash: string; rule_set_version: string; rule_set_approval: string;
    /** D-07.1: ¿esta organización adoptó el catálogo con el que se evaluó? Sin adopción no hay ni severidad. */
    rule_set_adopted: boolean;
    /** D-07.5: perfil jurídico bajo el que la versión fue aprobada para CONCLUIR. Hoy `null` en todas. */
    rule_set_regulatory_profile: string | null;
    technical_result: string; severity: string; conclusion: string;
      /** D-07.6: la conclusión HUMANA registrada (si la hay), con su vigencia. `conclusion` ya es la EFECTIVA (UNDETERMINED si no hay una vigente). Solo está presente si hay registro. */
      conclusion_record?: { id: string; result: 'NEGLIGIBLE' | 'NON_NEGLIGIBLE'; valid: boolean; invalid_reasons: string[] };
      is_current: boolean; review_process: string; factors: Array<{ code: string; result: string; effect: string }> };
  mitigations: Array<{ id: string; factor_code: string; status: string; row_version: string; decision: string | null }>;
  /**
   * D-34.A.1: vínculo PREVIO al despacho. Un ítem de embarque con reserva activa de la misma organización.
   * Identifica embarque, ítem, lote, reserva y cantidad, que es lo que el paquete debe cubrir: una reserva de
   * OTRO embarque no lo sustituye. Al estar en el contenido, cualquier cambio —cantidad, reserva, ítem o
   * cancelación— altera el hash y **desactualiza** la instantánea, de modo que una acreditación que ya no
   * corresponde no puede usarse.
   */
  shipment_links: Array<{ shipment_id: string; shipment_code: string; shipment_status: string; item_id: string; reservation_id: string; lot_id: string; quantity: string; unit: string; location_id: string }>;
  profiles: {
    /**
     * P1-005: estado del perfil jurídico ADOPTADO por la organización, o `null` si no adoptó ninguno.
     * Es un objeto y no un texto porque el requisito necesita distinguir tres cosas: no hay perfil, hay uno
     * insuficiente (parcial o sin revisión jurídica) y hay uno completo y revisado.
     */
    legal_profile: null | {
      version: string; scope: 'PARTIAL' | 'COMPLETE'; legal_review_status: 'PENDING' | 'REVIEWED'; pending_matters: string[];
      /**
       * Cobertura del SUJETO, parcela a parcela. Sin esto el requisito mentiría: un catálogo completo y
       * revisado dice que **existe** una lista de obligaciones, **no** que este lote las tenga resueltas.
       */
      subjects: Array<{ plot_id: string; assessed_version: string | null; unresolved: string[]; not_satisfied: string[]; stale_evidence: string[]; foreign_evidence: string[] }>;
    };
    /**
     * GEOLOCATION_PROFILE: la CONFIGURACIÓN versionada que la organización adoptó, con la revisión que la sustenta, su aplicabilidad y los
     * datos (evaluación vigente del perfil técnico por versión de parcela) con que se evalúa. `null` = ninguna configuración adoptada.
     * Es un objeto —no un texto— para que ninguna etiqueta pueda dar MET. Entra en el contenido de la instantánea: cambiar la configuración,
     * su revisión o una evaluación la deja desactualizada sin reescribirla.
     */
    geolocation_profile: null | GeoConfigContent;
    satellite_provider: string | null;
    /**
     * AJ-08: lo RECIBIDO del proveedor por versión de parcela de origen (proveedor, sintético o real, cobertura declarada, fecha, método y huella), aparte de si basta
     * para el criterio. Solo existe si hay proveedor seleccionado o algún análisis. Recibir un análisis NO satisface el requisito.
     */
    satellite_analysis?: {
      selected_provider: string | null;
      analyses: Array<{ plot_code: string | null; plot_version_id: string; provider_code: string; is_synthetic: boolean; operation?: string; coverage_status: 'COVERED' | 'PARTIAL' | 'NOT_COVERED' | 'UNKNOWN'; coverage_note?: string | null; limitations?: string | null; analysis_date: string | null; method: string | null; raw_sha256: string | null; result_id: string }>;
    };
  };
}

export interface GeoConfigContent {
  config_version: string;
  /** Perfil técnico para el que se redactó la configuración y el vigente del sistema: deben coincidir. */
  technical_profile: { id: string; version: string; current_version: string };
  /** Revisión VIGENTE de ESTA configuración (la última): no es la revisión del perfil jurídico. */
  review: { id: string | null; decision: 'REVIEWED' | 'OBJECTED' | 'WITHDRAWN' | null };
  /** La persona revisora declaró aplicable la configuración a esta organización. Revisada ≠ aplicable a todas. */
  applicable_to_organization: boolean;
  rules: Array<{ code: string; kind: string; status: 'ACTIVE' | 'CANDIDATE' }>;
  plots: Array<{ plot_id: string; plot_version_id: string | null; evaluation_id: string | null; evaluated_profile_version: string | null; status: 'MEETS_PROFILE' | 'DOES_NOT_MEET' | 'REVIEW_REQUIRED' | 'NOT_EVALUABLE' | null }>;
}

export interface Requirement { code: string; label: string; status: ReqStatus; detail: string; source: string; references: string[] }

export const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v ?? null);
export const sha256 = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : canonical(v)).digest('hex');

const dec = (s: string) => Number(s); // solo para comparar signo; las cantidades se conservan como texto decimal

/**
 * `GEOLOCATION_PROFILE` (requisito original, D-05.B Q4): aplica las reglas de la CONFIGURACIÓN versionada que la organización adoptó. Sin configuración
 * válida, revisión vigente, aplicabilidad declarada o datos suficientes NO es evaluable (o queda pendiente) y dice qué falta. Que la configuración esté
 * revisada no demuestra que aplique a todas las organizaciones; que una geometría cumpla el formato técnico tampoco basta: la regla activa exige además la
 * configuración revisada y aplicable. Las reglas CANDIDATAS (interpretaciones pendientes) nunca se aplican, y mientras existan impiden MET: no se inventan
 * umbrales ni condiciones jurídicas. Es una condición técnica, no una conclusión regulatoria ni `READY`.
 */
export function geolocationRequirement(g: DdContent['profiles']['geolocation_profile']): [ReqStatus, string, string, string[]?] {
  const SRC = 'docs/22 D-05.B; ficha D-05.B Q4';
  if (!g) return ['NOT_EVALUABLE', 'La organización no ha adoptado ninguna configuración de geolocalización (reglas versionadas): no hay criterio de «satisfecho» que aplicar. Una configuración candidata sin revisión no se aplica sola.', SRC];
  const v = `Configuración ${g.config_version}`;
  if (g.technical_profile.version !== g.technical_profile.current_version) {
    return ['NOT_EVALUABLE', `${v}: se redactó para ${g.technical_profile.id} ${g.technical_profile.version} y el perfil técnico vigente es ${g.technical_profile.current_version}; se necesita una versión nueva de la configuración.`, SRC];
  }
  if (g.review.decision !== 'REVIEWED') {
    const why = g.review.decision === null ? 'no tiene ninguna revisión registrada' : `su última revisión es «${g.review.decision === 'OBJECTED' ? 'objetada' : 'retirada'}»`;
    return ['NOT_EVALUABLE', `${v}: ${why}; sin revisión vigente favorable no se aplica.`, SRC];
  }
  if (!g.applicable_to_organization) {
    return ['NOT_EVALUABLE', `${v}: está revisada, pero la revisión NO la declara aplicable a esta organización (aplicabilidad no resuelta para la entidad y la operación). Revisada no significa aplicable a todas.`, SRC];
  }
  const candidatas = g.rules.filter((x) => x.status === 'CANDIDATE').map((x) => x.code);
  const activas = g.rules.filter((x) => x.status === 'ACTIVE');
  if (!activas.length) return ['NOT_EVALUABLE', `${v}: no tiene ninguna regla activa que aplicar.`, SRC];
  if (!g.plots.length) return ['NOT_EVALUABLE', `${v}: el lote no tiene parcelas de origen sobre las que evaluar la geolocalización.`, SRC];
  const refs = g.plots.map((p) => p.plot_id);
  const incumple = g.plots.filter((p) => p.status === 'DOES_NOT_MEET');
  if (incumple.length) return ['INVALID', `${v}: ${incumple.length} parcela(s) de origen NO cumplen el perfil técnico vigente.`, SRC, incumple.map((p) => p.plot_id)];
  const noEvaluable = g.plots.filter((p) => p.status === 'NOT_EVALUABLE' && p.evaluated_profile_version !== null);
  if (noEvaluable.length) return ['NOT_EVALUABLE', `${v}: ${noEvaluable.length} parcela(s) con evaluación vigente no evaluable (faltan datos de la geometría).`, SRC, noEvaluable.map((p) => p.plot_id)];
  const sinVigente = g.plots.filter((p) => p.evaluation_id === null || p.status === null || p.evaluated_profile_version !== g.technical_profile.current_version);
  const revisar = g.plots.filter((p) => p.status === 'REVIEW_REQUIRED');
  if (sinVigente.length || revisar.length) {
    const motivos = [
      ...(sinVigente.length ? [`${sinVigente.length} parcela(s) sin evaluación vigente del perfil técnico (ausente o de una versión anterior)`] : []),
      ...(revisar.length ? [`${revisar.length} parcela(s) que requieren revisión humana`] : []),
    ];
    return ['PENDING', `${v}: ${motivos.join('; ')}.`, SRC, [...new Set([...sinVigente, ...revisar].map((p) => p.plot_id))]];
  }
  if (candidatas.length) {
    return ['PENDING', `${v}: las ${g.plots.length} parcela(s) cumplen la regla activa, pero la configuración conserva reglas CANDIDATAS sin resolver (${candidatas.join(', ')}); no se aplican ni se deducen sus datos, y mientras existan el criterio de «satisfecho» no está completo.`, SRC, refs];
  }
  return ['MET', `${v}, revisión vigente favorable y aplicable a esta organización: las ${g.plots.length} parcela(s) de origen tienen una evaluación vigente del perfil técnico ${g.technical_profile.id} ${g.technical_profile.current_version} que cumple las reglas activas. Es una condición técnica: no es una conclusión regulatoria ni habilita READY por sí sola.`, SRC, refs];
}

/**
 * `RISK_CATALOG_APPROVED`: `regulatory_profile` es una REFERENCIA, no una etiqueta. Solo cuenta si resuelve contra el
 * modelo vigente de P1-005: es la versión x.y.z del perfil que la organización adoptó, su alcance es COMPLETO y su
 * última decisión de revisión es REVIEWED (OBJECTED/WITHDRAWN la invalidan). No define qué es un perfil «suficiente»:
 * reutiliza el contrato de `LEGAL_PROFILE`. Cualquier otra cosa deja el requisito pendiente y dice qué falta.
 */
export function catalogUnderProfile(cat: string, ref: string, lp: DdContent['profiles']['legal_profile']): [ReqStatus, string, string] {
  const SRC = 'docs/13 §Registro de regla';
  if (!/^\d+\.\d+\.\d+$/.test(ref)) return ['PENDING', `${cat}: el valor «${ref.slice(0, 40)}» no es una referencia a una versión de perfil jurídico (x.y.z); una etiqueta no equivale a un perfil revisado.`, SRC];
  if (!lp) return ['PENDING', `${cat}: remite al perfil ${ref}, pero la organización no tiene perfil jurídico adoptado (P1-005).`, SRC];
  if (lp.version !== ref) return ['PENDING', `${cat}: remite al perfil ${ref}, pero la organización adoptó ${lp.version}; la referencia no corresponde a la versión adoptada.`, SRC];
  const falta = [
    ...(lp.scope !== 'COMPLETE' ? [`el alcance del perfil es PARCIAL (faltan: ${lp.pending_matters.join(', ') || 'sin declarar'})`] : []),
    ...(lp.legal_review_status !== 'REVIEWED' ? ['no tiene una revisión jurídica vigente (REVIEWED); sin revisión o con revisión objetada/retirada'] : []),
  ];
  if (falta.length) return ['PENDING', `${cat}: remite al perfil ${ref}, pero ${falta.join(' y ')}.`, SRC];
  return ['MET', `${cat}: adoptadas y aprobadas bajo el perfil ${ref}, completo y con revisión jurídica vigente.`, SRC];
}

export function evaluateRequirements(c: DdContent): Requirement[] {
  const r = (code: string, label: string, status: ReqStatus, detail: string, source: string, references: string[] = []): Requirement => ({ code, label, status, detail, source, references });
  const out: Requirement[] = [];
  // 1) Sujeto y cantidades (ledger).
  const phys = dec(c.quantities.physical);
  out.push(Number.isNaN(phys) ? r('SUBJECT_QUANTITY', 'Cantidad del sujeto con unidad', 'NOT_EVALUABLE', 'Cantidad no determinable desde el ledger.', 'docs/13 §Paquete')
    : phys > 0 ? r('SUBJECT_QUANTITY', 'Cantidad del sujeto con unidad', 'MET', `Existencia ${c.quantities.physical} ${c.quantities.unit} (ledger); reservado ${c.quantities.reserved}; disponible ${c.quantities.available}.`, 'docs/13 §Paquete')
      : r('SUBJECT_QUANTITY', 'Cantidad del sujeto con unidad', 'INVALID', `Existencia ${c.quantities.physical} ${c.quantities.unit}: sin cantidad que respaldar.`, 'docs/13 §Paquete'));
  out.push(c.origin.ledger_differences.length
    ? r('QUANTITIES_CONSISTENT', 'Cantidades consistentes (ledger y dominio)', 'INVALID', `${c.origin.ledger_differences.length} diferencia(s) entre el ledger y el dominio en el grafo.`, 'docs/13 §Ciclo (READY: cantidades consistentes)', c.origin.ledger_differences.map((d) => d.id))
    : r('QUANTITIES_CONSISTENT', 'Cantidades consistentes (ledger y dominio)', 'MET', 'El ledger concilia en los lotes y recepciones del grafo.', 'docs/13 §Ciclo'));
  // 2) Origen y geometría.
  if (!c.deliveries.length) out.push(r('ORIGIN_DECLARED', 'Origen declarado hasta parcela', 'NOT_EVALUABLE', 'El lote no tiene entregas de origen en su grafo.', 'docs/13 DATA_MISSING_ORIGIN'));
  else {
    const missing = c.deliveries.filter((d) => !d.origin_plots.length).map((d) => d.code);
    const incomplete = c.origin.lots.filter((l) => l.origin_status !== 'COMPLETE').map((l) => l.lot_code);
    out.push(missing.length || incomplete.length
      ? r('ORIGIN_DECLARED', 'Origen declarado hasta parcela', 'PENDING', `${missing.length} entrega(s) sin parcela; ${incomplete.length} lote(s) con origen incompleto. Origen desconocido sigue desconocido.`, 'docs/13 DATA_MISSING_ORIGIN', [...missing, ...incomplete])
      : r('ORIGIN_DECLARED', 'Origen declarado hasta parcela', 'MET', 'Todas las entregas declaran parcela y los lotes del grafo declaran origen.', 'docs/13 DATA_MISSING_ORIGIN'));
  }
  if (!c.plots.length) out.push(r('GEOMETRY_TECHNICAL', 'Geometría vigente técnicamente válida', 'NOT_EVALUABLE', 'Sin parcelas de origen declaradas: no hay geometría que evaluar.', 'docs/13 GEOMETRY_INVALID'));
  else {
    const invalid = c.plots.filter((p) => p.gis_status === 'INVALID').map((p) => p.plot_code);
    const unknown = c.plots.filter((p) => !p.geometry_type || !p.gis_status).map((p) => p.plot_code);
    out.push(invalid.length ? r('GEOMETRY_TECHNICAL', 'Geometría vigente técnicamente válida', 'INVALID', 'Geometría técnicamente inválida.', 'docs/13 GEOMETRY_INVALID', invalid)
      : unknown.length ? r('GEOMETRY_TECHNICAL', 'Geometría vigente técnicamente válida', 'PENDING', 'Parcela(s) sin geometría vigente o sin evaluación técnica: no se presume válida.', 'docs/13 GEOMETRY_INVALID', unknown)
        : r('GEOMETRY_TECHNICAL', 'Geometría vigente técnicamente válida', 'MET', 'Sin invalidez técnica (TL_GIS_TECH). No es análisis de deforestación.', 'docs/13 GEOMETRY_INVALID', c.plots.map((p) => p.plot_code)));
  }
  out.push(r('GEOLOCATION_PROFILE', 'Perfil de geolocalización aplicable', ...geolocationRequirement(c.profiles.geolocation_profile)));
  out.push(deforestationRequirement(c));
  // 3) Calidad (operativa; no es requisito regulatorio ni aprobación).
  if (!c.quality.length) out.push(r('QUALITY_DECIDED', 'Calidad decidida en las recepciones', 'NOT_EVALUABLE', 'Sin recepciones en el grafo.', 'D-33 MVP (calidad pendiente)'));
  else {
    const rejected = c.quality.filter((q) => q.decision === 'REJECTED').map((q) => q.delivery_code);
    const pending = c.quality.filter((q) => q.decision !== 'RELEASED' && q.decision !== 'REJECTED').map((q) => q.delivery_code);
    out.push(rejected.length ? r('QUALITY_DECIDED', 'Calidad decidida en las recepciones', 'INVALID', 'Recepción(es) con calidad rechazada en el grafo.', 'D-33 MVP', rejected)
      : pending.length ? r('QUALITY_DECIDED', 'Calidad decidida en las recepciones', 'PENDING', 'Calidad «Pendiente de evaluación» (adoptado en D-33 MVP). Calidad no equivale a aprobación regulatoria.', 'D-33 MVP', pending)
        : r('QUALITY_DECIDED', 'Calidad decidida en las recepciones', 'MET', 'Calidad liberada en las recepciones. No equivale a aprobación regulatoria.', 'D-33 MVP'));
  }
  // 4) Soportes documentales de las entregas (D-35 MVP: la ausencia no impide recibir; queda pendiente).
  if (c.deliveries.length) {
    const supports = c.documents.filter((d) => d.used_by === 'DELIVERY_SUPPORT');
    const without = c.deliveries.filter((d) => !supports.some((s) => s.reference === d.code)).map((d) => d.code);
    const bad = supports.filter((s) => s.expired || s.scan !== 'CLEAN').map((s) => s.reference);
    out.push(bad.length ? r('DELIVERY_SUPPORTS', 'Soportes de entrega vigentes y disponibles', 'INVALID', 'Soporte vencido o archivo no disponible (antimalware).', 'D-35 MVP', [...new Set(bad)])
      : without.length ? r('DELIVERY_SUPPORTS', 'Soportes de entrega vigentes y disponibles', 'PENDING', `${without.length} entrega(s) sin soporte (D-35 MVP: no impide recibir; queda pendiente).`, 'D-35 MVP', without)
        : r('DELIVERY_SUPPORTS', 'Soportes de entrega vigentes y disponibles', 'MET', 'Cada entrega tiene un soporte vigente y disponible (no prueba autenticidad ni validez jurídica).', 'D-35 MVP'));
  } else out.push(r('DELIVERY_SUPPORTS', 'Soportes de entrega vigentes y disponibles', 'NOT_EVALUABLE', 'Sin entregas en el grafo.', 'D-35 MVP'));
  // P1-005. El catálogo es condición NECESARIA, nunca suficiente.
  //
  // Un perfil completo y jurídicamente revisado acredita que **existe** una lista de obligaciones exigibles.
  // **No dice nada** sobre si ESTE sujeto las tiene resueltas. Por eso, además del catálogo, se mira la
  // evaluación de **cada parcela del lote**: que exista, que se haya hecho con la versión **adoptada**, que no
  // queden obligaciones sin resolver, que ninguna esté incumplida, que la evidencia **siga siendo la vigente**
  // y que pertenezca **al propio sujeto**.
  //
  //   · sin perfil adoptado                    → NOT_EVALUABLE (no se presume nada);
  //   · perfil PARCIAL o sin revisión jurídica → PENDING;
  //   · catálogo correcto pero sujeto sin resolver → PENDING (o INVALID si hay una obligación incumplida);
  //   · catálogo correcto y sujeto resuelto    → MET.
  const lp = c.profiles.legal_profile;
  if (!lp) {
    out.push(r('LEGAL_PROFILE', 'Perfil jurídico aplicable (legalidad y evidencias exigibles)', 'NOT_EVALUABLE',
      `Sin perfil jurídico adoptado (P1-005): no hay lista de requisitos legales ni evidencias exigibles. ${c.evidence.length} evidencia(s) registrada(s) se conservan como referencia; D-37 sigue pendiente.`, 'docs/13 §Legalidad Ecuador'));
  } else if (lp.scope === 'PARTIAL' || lp.legal_review_status !== 'REVIEWED') {
    const motivos = [
      ...(lp.scope === 'PARTIAL' ? [`alcance PARCIAL (faltan: ${lp.pending_matters.join(', ') || 'sin declarar'})`] : []),
      ...(lp.legal_review_status !== 'REVIEWED' ? ['sin revisión jurídica resuelta'] : []),
    ];
    out.push(r('LEGAL_PROFILE', 'Perfil jurídico aplicable (legalidad y evidencias exigibles)', 'PENDING',
      `Perfil ${lp.version} adoptado, pero no satisface el requisito: ${motivos.join(' y ')}. Una revisión necesaria pendiente sigue impidiendo acreditar READY.`,
      'docs/13 §Legalidad Ecuador'));
  } else if (!lp.subjects.length) {
    out.push(r('LEGAL_PROFILE', 'Perfil jurídico aplicable (legalidad y evidencias exigibles)', 'NOT_EVALUABLE',
      `Perfil ${lp.version} completo y revisado, pero el lote no tiene parcelas de origen sobre las que evaluar la legalidad.`, 'docs/13 §Legalidad Ecuador'));
  } else {
    const sinEvaluar = lp.subjects.filter((s) => s.assessed_version === null).map((s) => s.plot_id);
    const conOtraVersion = lp.subjects.filter((s) => s.assessed_version !== null && s.assessed_version !== lp.version).map((s) => s.plot_id);
    const incumplidas = lp.subjects.flatMap((s) => s.not_satisfied);
    const sinResolver = lp.subjects.flatMap((s) => s.unresolved);
    const sustituidas = lp.subjects.flatMap((s) => s.stale_evidence);
    const ajenas = lp.subjects.flatMap((s) => s.foreign_evidence);
    const refs = [...new Set([...sinEvaluar, ...conOtraVersion])];
    if (incumplidas.length) {
      out.push(r('LEGAL_PROFILE', 'Perfil jurídico aplicable (legalidad y evidencias exigibles)', 'INVALID',
        `Obligación(es) del perfil ${lp.version} declaradas NO satisfechas en el origen del lote: ${[...new Set(incumplidas)].join(', ')}.`,
        'docs/13 §Legalidad Ecuador', [...new Set(incumplidas)]));
    } else {
      const motivos = [
        ...(sinEvaluar.length ? [`${sinEvaluar.length} parcela(s) sin evaluación legal`] : []),
        ...(conOtraVersion.length ? [`${conOtraVersion.length} parcela(s) evaluadas con otra versión del perfil (se adoptó ${lp.version})`] : []),
        ...(sinResolver.length ? [`obligaciones sin resolver: ${[...new Set(sinResolver)].join(', ')}`] : []),
        ...(sustituidas.length ? [`evidencia SUSTITUIDA por una versión posterior: ${[...new Set(sustituidas)].join(', ')}`] : []),
        ...(ajenas.length ? [`evidencia de OTRO sujeto: ${[...new Set(ajenas)].join(', ')}`] : []),
      ];
      out.push(motivos.length
        ? r('LEGAL_PROFILE', 'Perfil jurídico aplicable (legalidad y evidencias exigibles)', 'PENDING',
          `Perfil ${lp.version} completo y revisado, pero el SUJETO no está resuelto: ${motivos.join('; ')}. Un catálogo revisado no acredita por sí solo las obligaciones de este lote.`,
          'docs/13 §Legalidad Ecuador', refs)
        : r('LEGAL_PROFILE', 'Perfil jurídico aplicable (legalidad y evidencias exigibles)', 'MET',
          `Perfil ${lp.version} completo y revisado, y las ${lp.subjects.length} parcela(s) de origen tienen sus obligaciones resueltas con evidencia vigente del propio sujeto.`,
          'docs/13 §Legalidad Ecuador'));
    }
  }
  // 5) Riesgo y mitigaciones.
  if (!c.risk) {
    // Sin evaluación: los requisitos de riesgo siguen listados; lo desconocido queda visible, nunca omitido.
    out.push(r('RISK_EVALUATION_CURRENT', 'Evaluación de riesgo vigente', 'PENDING', 'Sin evaluación de riesgo del lote.', 'docs/13 §Evaluación reproducible'));
    out.push(r('RISK_NO_BLOCKING_FINDINGS', 'Sin hallazgos de riesgo bloqueantes', 'NOT_EVALUABLE', 'Sin evaluación: no se presume ausencia de hallazgos.', 'docs/13'));
    out.push(r('RISK_REVIEW_RESOLVED', 'Revisión humana del riesgo resuelta', 'PENDING', 'Sin evaluación que revisar.', 'docs/13 §Dimensiones'));
    out.push(r('RISK_CATALOG_APPROVED', 'Catálogo de reglas de riesgo aprobado bajo perfil jurídico', 'NOT_EVALUABLE', 'Sin evaluación vinculada a un catálogo.', 'docs/13 §Registro de regla'));
    out.push(r('REGULATORY_CONCLUSION', 'Conclusión regulatoria bajo perfil aprobado', 'NOT_EVALUABLE', 'Sin evaluación ni perfil jurídico: conclusión indeterminada.', 'docs/13 §Dimensiones'));
  } else {
    out.push(c.risk.is_current ? r('RISK_EVALUATION_CURRENT', 'Evaluación de riesgo vigente', 'MET', `Evaluación ${c.risk.evaluation_number} vigente (reglas ${c.risk.rule_set_version}).`, 'docs/13 §Evaluación reproducible')
      : r('RISK_EVALUATION_CURRENT', 'Evaluación de riesgo vigente', 'INVALID', `Evaluación ${c.risk.evaluation_number} desactualizada: reevalúa.`, 'docs/13 §Evaluación reproducible'));
    const blocking = c.risk.factors.filter((f) => f.result === 'HIT' && f.effect === 'BLOCKING').map((f) => f.code);
    const hits = c.risk.factors.filter((f) => f.result === 'HIT').map((f) => f.code);
    const ne = c.risk.factors.filter((f) => f.result === 'NOT_EVALUABLE').map((f) => f.code);
    out.push(blocking.length ? r('RISK_NO_BLOCKING_FINDINGS', 'Sin hallazgos de riesgo bloqueantes', 'INVALID', 'Hallazgos bloqueantes en la evaluación vigente (no se diluyen por porcentaje).', 'docs/13 §Registro de regla', blocking)
      : hits.length ? r('RISK_NO_BLOCKING_FINDINGS', 'Sin hallazgos de riesgo bloqueantes', 'PENDING', 'Hallazgos que requieren revisión.', 'docs/13', hits)
        : ne.length ? r('RISK_NO_BLOCKING_FINDINGS', 'Sin hallazgos de riesgo bloqueantes', 'NOT_EVALUABLE', 'Reglas no evaluables: no se presume favorable.', 'docs/13', ne)
          : r('RISK_NO_BLOCKING_FINDINGS', 'Sin hallazgos de riesgo bloqueantes', 'MET', 'Sin hallazgos en las reglas evaluadas.', 'docs/13'));
    out.push(c.risk.review_process === 'RESOLVED' ? r('RISK_REVIEW_RESOLVED', 'Revisión humana del riesgo resuelta', 'MET', 'Revisión resuelta con motivo (no vuelve favorable el riesgo).', 'docs/13 §Dimensiones')
      : r('RISK_REVIEW_RESOLVED', 'Revisión humana del riesgo resuelta', 'PENDING', `Revisión ${c.risk.review_process === 'UNDER_REVIEW' ? 'en curso' : 'sin iniciar'}.`, 'docs/13 §Dimensiones'));
    // Publicar un catálogo globalmente (`approval_status = APPROVED`) es una decisión TÉCNICA de producto: dice que
    // las reglas existen y que el proyecto las respalda. Este requisito pide otra cosa, y pide las DOS:
    //   · que la organización haya ADOPTADO el catálogo con el que se evaluó (D-07.1), y
    //   · que esa versión esté aprobada bajo un PERFIL JURÍDICO (D-07.5), hoy `null` en todas.
    // Si se cumpliera con la sola publicación, aprobar un catálogo técnico pondría el expediente en READY sin que
    // nadie hubiera decidido bajo qué norma se concluye.
    const cat = `Reglas ${c.risk.rule_set_version} (publicación global ${c.risk.rule_set_approval})`;
    out.push(!c.risk.rule_set_adopted
      ? r('RISK_CATALOG_APPROVED', 'Catálogo de reglas de riesgo aprobado bajo perfil jurídico', 'NOT_EVALUABLE', `${cat}: esta organización NO las ha adoptado (D-07.1); publicar no es adoptar.`, 'docs/13 §Registro de regla')
      : !c.risk.rule_set_regulatory_profile
        ? r('RISK_CATALOG_APPROVED', 'Catálogo de reglas de riesgo aprobado bajo perfil jurídico', 'NOT_EVALUABLE', `${cat}: adoptadas por la organización, pero su publicación es una decisión TÉCNICA de producto y no hay perfil jurídico aprobado (D-07.5). No permiten afirmar preparación regulatoria.`, 'docs/13 §Registro de regla')
        : r('RISK_CATALOG_APPROVED', 'Catálogo de reglas de riesgo aprobado bajo perfil jurídico', ...catalogUnderProfile(cat, c.risk.rule_set_regulatory_profile, c.profiles.legal_profile)));
    // D-07.6: solo cuenta la conclusión HUMANA registrada por una persona autorizada (EUDR_MANAGER) y VIGENTE. El motor nunca concluye. Esta condición es una más: registrarla no anula
    // ningún otro requisito ni habilita READY por sí sola.
    const rec = c.risk.conclusion_record;
    out.push(c.risk.conclusion === 'NEGLIGIBLE' ? r('REGULATORY_CONCLUSION', 'Conclusión regulatoria bajo perfil aprobado', 'MET', 'Conclusión humana NEGLIGIBLE registrada por una persona autorizada y vigente sobre esta evaluación. No anula otros requisitos pendientes ni equivale a READY.', 'docs/13 §Dimensiones; D-07.6')
      : c.risk.conclusion === 'NON_NEGLIGIBLE' ? r('REGULATORY_CONCLUSION', 'Conclusión regulatoria bajo perfil aprobado', 'INVALID', 'Conclusión humana NON_NEGLIGIBLE vigente sobre esta evaluación.', 'docs/13 §Dimensiones; D-07.6')
        : rec ? r('REGULATORY_CONCLUSION', 'Conclusión regulatoria bajo perfil aprobado', 'NOT_EVALUABLE', `Hay una conclusión humana (${rec.result}) registrada, pero NO está vigente (${rec.invalid_reasons.join(', ')}): se conserva en el historial y no vale como conclusión.`, 'docs/13 §Dimensiones; D-07.6')
          : r('REGULATORY_CONCLUSION', 'Conclusión regulatoria bajo perfil aprobado', 'NOT_EVALUABLE', 'Conclusión UNDETERMINED: el motor no concluye y nadie ha registrado una conclusión humana vigente sobre esta evaluación.', 'docs/13 §Dimensiones; D-07.6'));
  }
  const pendingMit = c.mitigations.filter((m) => m.status !== 'VERIFIED');
  out.push(!c.mitigations.length ? r('MITIGATIONS_VERIFIED', 'Mitigaciones verificadas', 'MET', 'Sin mitigaciones registradas para el sujeto.', 'docs/13 MITIGATION_UNVERIFIED')
    : pendingMit.length ? r('MITIGATIONS_VERIFIED', 'Mitigaciones verificadas', 'PENDING', `${pendingMit.length} mitigación(es) sin verificar.`, 'docs/13 MITIGATION_UNVERIFIED', pendingMit.map((m) => m.factor_code))
      : r('MITIGATIONS_VERIFIED', 'Mitigaciones verificadas', 'MET', 'Mitigaciones verificadas. Verificar no resuelve causas ni equivale a aprobación regulatoria.', 'docs/13 MITIGATION_UNVERIFIED'));
  // D-34.A.1 (2026-10-16): el vínculo se satisface ANTES del despacho, con un ítem de embarque que tenga
  // reserva activa. **No exige que la mercancía haya salido**: exigirlo crearía una dependencia circular
  // —despachar exige el paquete, el paquete exige READY y READY exigiría el despacho— que ninguna fuente
  // impone (S1 §44 enumera el contenido del paquete y no incluye embarque ni despacho).
  out.push(c.shipment_links.length
    ? r('SHIPMENT_LINK', 'Vínculo con embarque mediante reserva activa', 'MET',
        c.shipment_links.map((l) => `${l.shipment_code} · ítem ${l.item_id} · reserva ${l.quantity} ${l.unit}`).join(' · '), 'D-34.A.1; docs/18 P0-017/P0-029')
    : r('SHIPMENT_LINK', 'Vínculo con embarque mediante reserva activa', 'PENDING',
        'El lote no tiene ningún ítem de embarque con reserva activa. Añádelo a un embarque y reserva la cantidad.', 'D-34.A.1; docs/18 P0-017/P0-029'));
  return out;
}

export function readinessOf(reqs: Requirement[]): Readiness {
  if (reqs.every((r) => r.status === 'MET')) return 'READY';
  if (reqs.some((r) => r.status === 'INVALID' || r.status === 'NOT_EVALUABLE')) return 'BLOCKED';
  return 'IN_PROGRESS';
}

export function summary(reqs: Requirement[]) {
  const n = (s: ReqStatus) => reqs.filter((r) => r.status === s).length;
  return { total: reqs.length, met: n('MET'), pending: n('PENDING'), invalid: n('INVALID'), not_evaluable: n('NOT_EVALUABLE'),
    percent_met: reqs.length ? Math.floor((n('MET') * 100) / reqs.length) : 0, note: 'El porcentaje es informativo: cualquier requisito no cumplido bloquea la preparación.' };
}

/** Hash por sección: permite indicar qué cambió cuando una instantánea queda desactualizada. */
export function sectionHashes(c: DdContent): Record<string, string> {
  return Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'synthetic_fixture').map(([k, v]) => [k, sha256(v)]));
}

export function manifestOf(c: DdContent) {
  return {
    items: [
      { kind: 'lot', id: c.subject.id, version: c.subject.code },
      ...c.deliveries.map((d) => ({ kind: 'delivery', id: d.id, version: d.row_version })),
      ...c.plots.map((p) => ({ kind: 'plot_version', id: p.version_id ?? p.plot_id, version: String(p.version_number ?? 'sin versión'), hash: p.geometry_hash })),
      ...c.documents.map((d) => ({ kind: 'document_version', id: d.version_id, version: String(d.version_number), hash: d.sha256 })),
      ...c.shipment_links.map((l) => ({ kind: 'shipment_reservation', id: l.reservation_id, version: `${l.shipment_code}:${l.item_id}`, hash: `${l.quantity} ${l.unit}` })),
      ...c.evidence.map((e) => ({ kind: 'evidence', id: e.id, version: e.row_version })),
      ...(c.risk ? [{ kind: 'risk_evaluation', id: c.risk.evaluation_id, version: String(c.risk.evaluation_number), hash: c.risk.snapshot_hash }, { kind: 'risk_rule_set', id: c.risk.rule_set_version, version: c.risk.rule_set_approval }] : []),
      ...c.mitigations.map((m) => ({ kind: 'mitigation', id: m.id, version: m.row_version })),
    ],
    section_hashes: sectionHashes(c),
  };
}

/** Pendientes declarados del paquete: no se presentan como cubiertos. */
export const PACKAGE_PENDING = [
  { code: 'ATTACHMENT_FILES_NOT_INCLUDED', detail: 'Los archivos no se incluyen: solo se referencian por versión exacta y SHA-256. Referenciar no equivale a incluir.' },
  { code: 'DESTINATION_PROFILE_FIELDS', detail: 'Los campos y el formato los determina el perfil destino (p. ej. EUDR-IS/TRACES), no definido: el paquete no garantiza esos campos.' },
];

export interface RedactionProfile { geometry: boolean; personal_documents: boolean }

export const DISCLAIMER = 'Paquete interno de Terra Link. Descargarlo no es presentar una DDS ni implica aceptación en TRACES/EUDR-IS; no acredita cumplimiento ni conclusión regulatoria.';

/**
 * Paquete determinista desde la instantánea (nunca desde tablas mutables). Alcance y clasificación se aplican a TODO el
 * contenido: geometrías sin `plot:read_geometry` y metadatos de documentos PERSONAL_DATA sin `producer:read_identity` se
 * redactan. La identidad de productores nunca se copia. Los archivos adjuntos se referencian por versión y SHA-256.
 */
export function buildPackage(p: {
  kind: 'INTERNAL_REVIEW' | 'DD_PACKAGE';
  dd_case: { id: string; case_number: string; scope_note: string; organization: string };
  snapshot: { id: string; number: number; captured_at: string; captured_by: string; content_hash: string; readiness: Readiness; approved_by: string | null };
  content: DdContent; requirements: Requirement[]; manifest: unknown;
}, profile: RedactionProfile) {
  const redactions: string[] = [];
  const plots = p.content.plots.map((pl) => {
    if (profile.geometry || pl.geometry == null) return pl;
    redactions.push(`plot:${pl.plot_code}:geometry`);
    return { ...pl, geometry: null, geometry_redacted: 'Sin permiso de coordenadas (plot:read_geometry): se conserva solo el hash.' };
  });
  const documents = p.content.documents.map((d) => {
    if (profile.personal_documents || d.classification !== 'PERSONAL_DATA') return d;
    redactions.push(`document_version:${d.version_id}:metadata`);
    return { ...d, title: '[restringido: datos personales]', file_name: '[restringido]' };
  });
  const pkg = {
    format: 'terra-link-dd-package', format_version: '0.2.0', kind: p.kind,
    // Artefactos distintos: instantánea (fuente) → borrador interno o paquete final → presentación oficial (no implementada).
    artifact: { kind: p.kind, source: 'snapshot', is_final_package: p.kind === 'DD_PACKAGE', is_official_submission: false },
    completeness: redactions.length ? 'INCOMPLETO por alcance de quien exporta: ver «redactions».' : 'Sin redacciones por alcance.',
    pending: PACKAGE_PENDING,
    label: p.kind === 'INTERNAL_REVIEW' ? 'BORRADOR INTERNO PARA REVISIÓN: no preparado; no es una DDS.' : 'Paquete de debida diligencia interno (preparación aprobada internamente); no es una DDS presentada.',
    disclaimer: DISCLAIMER,
    synthetic_fixture: p.content.synthetic_fixture === true ? 'FIXTURE SINTÉTICA DE PRUEBA: no es un expediente real ni aprobado.' : undefined,
    submission: { status: 'NOT_SUBMITTED', note: 'La presentación oficial es una dimensión independiente (no implementada).' },
    case: p.dd_case, snapshot: p.snapshot, readiness: p.snapshot.readiness, requirements: p.requirements, requirements_summary: summary(p.requirements), manifest: p.manifest,
    content: { ...p.content, plots, documents, producer_identity: 'No incluida: la identidad protegida no se copia al paquete.' },
    attachments: { included: false, note: 'Los archivos no se incrustan en esta versión: se referencian por versión exacta y SHA-256.', items: documents.map((d) => ({ version_id: d.version_id, sha256: d.sha256, file_name: d.file_name })) },
    redaction_profile: profile, redactions,
  };
  const body = JSON.stringify(JSON.parse(canonical(pkg)), null, 2);
  return { pkg, body, hash: sha256(body), redactions };
}

/**
 * DEFORESTATION_ANALYSIS (AJ-08). Tres cosas distintas: (1) análisis RECIBIDO, (2) entradas suficientes para el criterio (proveedor seleccionado, resultado real del MISMO
 * proveedor y cobertura declarada COVERED en cada versión de parcela de origen) y (3) resultado de deforestación, que este requisito NUNCA da. Solo (2) lo satisface.
 * Mientras falte algo queda PENDING con la carencia dicha; sin proveedor ni análisis, NOT_EVALUABLE como antes.
 */
export function deforestationRequirement(c: DdContent): Requirement {
  const code = 'DEFORESTATION_ANALYSIS';
  const r = (code: string, label: string, status: ReqStatus, detail: string, source: string, references: string[] = []): Requirement => ({ code, label, status, detail, source, references });
  const label = 'Análisis de deforestación con cobertura';
  const source = 'docs/13 SATELLITE_COVERAGE_UNKNOWN';
  if (c.profiles.satellite_provider) return r(code, label, 'MET', c.profiles.satellite_provider, source);
  const sa = c.profiles.satellite_analysis;
  if (!sa) return r(code, label, 'NOT_EVALUABLE', 'Sin proveedor satelital (P0-028): no evaluado. Sin alertas no prueba ausencia de deforestación.', source);
  const motivos: string[] = [];
  const pendientes = new Set<string>();
  if (!sa.selected_provider) motivos.push('no hay proveedor satelital seleccionado (D-09), así que ningún análisis se toma como requisito');
  const reales = sa.analyses.filter((a) => !a.is_synthetic);
  const sinteticos = sa.analyses.filter((a) => a.is_synthetic);
  if (sinteticos.length) motivos.push(`${sinteticos.length} análisis sintético(s) de ensayo no cuentan como análisis real`);
  const delProveedor = sa.selected_provider ? reales.filter((a) => a.provider_code === sa.selected_provider) : [];
  const ajenos = sa.selected_provider ? reales.filter((a) => a.provider_code !== sa.selected_provider) : reales;
  if (ajenos.length) motivos.push(`${ajenos.length} análisis de otro proveedor (${[...new Set(ajenos.map((a) => a.provider_code))].join(', ')}) no corresponden al proveedor seleccionado`);
  for (const a of delProveedor) {
    if (a.coverage_status !== 'COVERED') {
      motivos.push(`análisis recibido de ${a.provider_code} para ${a.plot_code ?? 'una parcela'} con cobertura ${a.coverage_status}: recibirlo no acredita cobertura suficiente (el proveedor no la declara completa)`);
      if (a.plot_code) pendientes.add(a.plot_code);
    }
  }
  if (sa.selected_provider) {
    for (const p of c.plots) {
      if (!p.version_id) { pendientes.add(p.plot_code); motivos.push(`${p.plot_code} no tiene versión geométrica vigente`); continue; }
      if (!delProveedor.some((a) => a.plot_version_id === p.version_id)) { pendientes.add(p.plot_code); motivos.push(`${p.plot_code} no tiene análisis real de ${sa.selected_provider} para su versión vigente`); }
    }
  }
  const unicos = [...new Set(motivos)];
  return r(code, label, 'PENDING', `Análisis recibido, criterio NO satisfecho: ${unicos.join('; ')}. Un análisis disponible no significa ausencia de deforestación ni conformidad.`, source, [...pendientes]);
}
