import { Kysely, sql } from 'kysely';

// Catálogo de reglas de riesgo **1.0.0**, publicado globalmente el 2026-10-15 por decisión del responsable de
// producto. Matriz revisada: docs/decisiones/D-07-MATRIZ-CATALOGO.md.
//
// QUÉ ES ESTA DECISIÓN Y QUÉ NO
// - Es una **aprobación técnica interna para el MVP local**: fija qué severidad declara cada regla.
// - **NO es aprobación regulatoria.** No autoriza concluir conformidad, no habilita `READY` ni despacho, y la
//   conclusión sigue clavada en `UNDETERMINED` por `risk_evaluations_conclusion_undetermined`.
// - **Publicar no es adoptar.** Esta migración publica la versión **globalmente**; ninguna organización la usa
//   hasta que alguien con `risk:approve_rules` la **adopte** (D-07.1). No se adopta a nadie desde aquí.
//
// LAS CINCO SEVERIDADES SON DECISIONES DE PRODUCTO
// Las fuentes respaldan **los hechos, los límites y los bloqueos**; **ninguna gradúa**. Que docs/13 exija bloquear
// una operación no convierte ese hallazgo en `CRITICAL`: esa etiqueta la elige el producto y así queda escrito en
// cada `source`. No se atribuye a la norma una graduación que la norma no hace.
//
// TRES REGLAS SIGUEN SIN SEVERIDAD, conservando su efecto técnico y su motivo:
//   · MITIGATION_UNVERIFIED      trabajo pendiente, no un hallazgo sobre el cacao
//   · SATELLITE_COVERAGE_UNKNOWN no se ha podido mirar (D-09 parte B)
//   · GEOLOCATION_PROFILE        el perfil TÉCNICO no acredita el requisito regulatorio (D-05.B)
// «No evaluable» **afecta a la completitud** aunque no aporte severidad, y una mitigación verificada **no elimina
// por sí sola la causa original**: hay que reevaluar.
//
// COBERTURA: cuatro categorías de las diez siguen SIN NINGUNA REGLA —LEGALITY, EVASION, HUMAN_RIGHTS,
// INDIGENOUS_RIGHTS—, así que **toda clasificación con este catálogo es PARCIAL** y el motor lo declara en cada
// evaluación. Una categoría ausente **no se considera superada**.
//
// INMUTABILIDAD: `0.1.0` y `0.2.0` **no se tocan**, ni ellos ni sus evaluaciones. Esta migración falla si alguna
// evaluación anterior llevara severidad: nada se migra ni se recalcula.
const VERSION = '1.0.0';

/**
 * `severity`: decisión de producto en las cinco primeras; `null` en las tres últimas, a propósito.
 * `source`: de dónde sale el HECHO, y la constancia de que la graduación es interna.
 */
const REGLAS = [
  {
    code: 'MATERIAL_OF_UNKNOWN_ORIGIN', category: 'MIXING', condition_kind: 'lot_origin_incomplete',
    inputs: ['grafo de lotes de origen', 'origin_status de cada lote'], effect: 'BLOCKING', severity: 'CRITICAL',
    // Descripción por su CONDICIÓN REAL. No afirma mezcla ilegal, ni fraude, ni que el dato sea irrecuperable.
    explanation: 'Algún lote del grafo de origen tiene el origen INCOMPLETO: no todas sus entradas declaran de qué parcela vienen.',
    limit_note: 'Describe un dato incompleto, NO una mezcla ilegal, un fraude ni una irregularidad probada. El origen puede completarse aportando la declaración que falta, y entonces se reevalúa. Severidad CRITICAL: decisión interna de producto, no graduación de ninguna fuente.',
    evidence_required: 'Declaración de origen de las entradas que no la tienen',
    source: 'Hecho: docs/13 (MATERIAL_OF_UNKNOWN_ORIGIN) y Art. 9(1)(d), que exige la geolocalización de todas las parcelas. Graduación CRITICAL: DECISIÓN DE PRODUCTO (2026-10-15), no derivada de la fuente.',
    depends_on: null,
  },
  {
    code: 'DATA_MISSING_ORIGIN', category: 'TRACEABILITY', condition_kind: 'delivery_without_origin',
    inputs: ['entregas del grafo', 'orígenes declarados'], effect: 'BLOCKING', severity: 'HIGH',
    explanation: 'Hay entregas en el grafo de origen sin ninguna parcela declarada.',
    limit_note: 'Dato que falta, corregible aportándolo; no prueba irregularidad. Severidad HIGH: decisión interna de producto.',
    evidence_required: 'Origen declarado de cada entrega',
    source: 'Hecho: docs/13 (DATA_MISSING_ORIGIN) y Art. 9(1)(d). Graduación HIGH: DECISIÓN DE PRODUCTO (2026-10-15).',
    depends_on: null,
  },
  {
    code: 'GEOMETRY_INVALID', category: 'DATA_QUALITY', condition_kind: 'plot_geometry_technically_invalid',
    inputs: ['versión vigente de cada parcela de origen', 'evaluación TL_GIS_TECH de esa versión'], effect: 'BLOCKING', severity: 'HIGH',
    explanation: 'La geometría vigente de alguna parcela de origen es técnicamente inválida (TL_GIS_TECH).',
    limit_note: 'Validez técnica de la geometría: prerrequisito de un análisis fiable. No es análisis de deforestación ni cumplimiento EUDR, y no afirma nada sobre el terreno. Severidad HIGH: decisión interna de producto.',
    evidence_required: 'Geometría vigente con evaluación técnica',
    source: 'Hecho: docs/13 (GEOMETRY_INVALID); P0-010. Graduación HIGH: DECISIÓN DE PRODUCTO (2026-10-15).',
    depends_on: null,
  },
  {
    code: 'MASS_BALANCE_INCONSISTENT', category: 'TRACEABILITY', condition_kind: 'ledger_reconciliation',
    inputs: ['movimientos del ledger del lote y su grafo'], effect: 'BLOCKING', severity: 'CRITICAL',
    explanation: 'La conciliación del ledger arroja diferencias en el grafo de origen.',
    limit_note: 'Las cantidades registradas no cuadran: cualquier afirmación de trazabilidad sobre ese lote queda sin respaldo mientras no se corrija con un ajuste auditado. No imputa intención. Severidad CRITICAL: decisión interna de producto.',
    evidence_required: 'Ajuste auditado que explique la diferencia',
    source: 'Hecho: docs/13 (MASS_BALANCE_INCONSISTENT); QA-06. Graduación CRITICAL: DECISIÓN DE PRODUCTO (2026-10-15).',
    depends_on: null,
  },
  {
    code: 'DOCUMENT_EXPIRED', category: 'DOCUMENT_CREDIBILITY', condition_kind: 'support_expired',
    inputs: ['soportes vinculados a las entregas de origen', 'vigencia declarada'], effect: 'REVIEW_REQUIRED', severity: 'MEDIUM',
    explanation: 'Hay soportes documentales vencidos entre las entregas de origen.',
    limit_note: 'Un documento vencido NO prueba ilegalidad: exige comprobar su alcance temporal con una persona. Sin soportes no se presume vigencia: queda NO EVALUABLE. Severidad MEDIUM: decisión interna de producto.',
    evidence_required: 'Soporte vigente para el período declarado',
    source: 'Hecho y límite: docs/13 (DOCUMENT_EXPIRED, «comprobar alcance temporal»). Graduación MEDIUM: DECISIÓN DE PRODUCTO (2026-10-15).',
    depends_on: null,
  },
  // ---- Sin severidad, a propósito. Conservan efecto y motivo.
  {
    code: 'MITIGATION_UNVERIFIED', category: 'SUPPLY_CHAIN', condition_kind: 'mitigation_status',
    inputs: ['mitigaciones del sujeto', 'estado de verificación'], effect: 'BLOCKING', severity: null,
    explanation: 'Hay mitigaciones abiertas sin verificar.',
    limit_note: 'SIN SEVERIDAD a propósito: es trabajo pendiente, no un hallazgo sobre el cacao. Bloquea el cierre de la revisión. Verificar una mitigación NO elimina por sí sola la causa original: hay que reevaluar con los datos actuales.',
    evidence_required: 'Verificación por un revisor distinto del ejecutor',
    source: 'docs/13 (MITIGATION_UNVERIFIED); P0-021. Ausencia de severidad: DECISIÓN DE PRODUCTO (2026-10-15).',
    // SIN `depends_on`: P0-021 está implementada, así que esta regla SÍ se evalúa. Marcarla como dependiente la
    // dejaría siempre NO EVALUABLE y restaría cobertura sin motivo.
    depends_on: null,
  },
  {
    code: 'SATELLITE_COVERAGE_UNKNOWN', category: 'DEFORESTATION', condition_kind: 'satellite_coverage',
    inputs: ['resultados satelitales por versión de parcela'], effect: 'NOT_ASSESSED', severity: null,
    explanation: 'No hay cobertura satelital conocida para las parcelas de origen.',
    limit_note: 'SIN SEVERIDAD: no se ha podido mirar. La ausencia de alertas NO prueba ausencia de deforestación. Afecta a la COMPLETITUD de la clasificación aunque no aporte severidad. Requiere D-09 parte B.',
    evidence_required: 'Análisis de un proveedor en uso real, con procedencia',
    source: 'docs/13 (SATELLITE_COVERAGE_UNKNOWN); P0-028. Ausencia de severidad: DECISIÓN DE PRODUCTO (2026-10-15), mientras D-09.B siga pendiente.',
    depends_on: 'D-09 parte B',
  },
  {
    code: 'GEOLOCATION_PROFILE', category: 'DEFORESTATION', condition_kind: 'destination_profile',
    inputs: ['dictamen EUDR_GEO_V1 de la versión vigente'], effect: 'NOT_ASSESSED', severity: null,
    explanation: 'El requisito regulatorio de geolocalización no se puede dar por satisfecho.',
    limit_note: 'SIN SEVERIDAD: cumplir el perfil TÉCNICO de destino (EUDR_GEO_V1, D-05.A) significa que el archivo está bien formado para una versión documentada del receptor, NO que la geolocalización satisfaga el requisito regulatorio. Eso es D-05.B. Afecta a la COMPLETITUD.',
    evidence_required: 'Aplicabilidad jurídica resuelta (D-05.B)',
    source: 'docs/13; D-05. Ausencia de severidad: DECISIÓN DE PRODUCTO (2026-10-15), mientras D-05.B siga pendiente.',
    depends_on: 'D-05.B',
  },
] as const;

const NOTAS = [
  'Catálogo técnico aprobado para el MVP LOCAL el 2026-10-15 (responsable de producto). NO es aprobación regulatoria:',
  'no autoriza concluir conformidad, no habilita READY ni despacho, y la conclusión sigue UNDETERMINED por CHECK.',
  'LAS CINCO SEVERIDADES SON DECISIONES INTERNAS DE PRODUCTO: las fuentes respaldan los hechos, los límites y los',
  'bloqueos, pero ninguna gradúa. Tres reglas quedan SIN severidad a propósito (MITIGATION_UNVERIFIED,',
  'SATELLITE_COVERAGE_UNKNOWN, GEOLOCATION_PROFILE), conservando su efecto y su motivo.',
  'COBERTURA PARCIAL: cuatro categorías siguen sin ninguna regla (LEGALITY, EVASION, HUMAN_RIGHTS,',
  'INDIGENOUS_RIGHTS). Toda clasificación con este catálogo es PARCIAL, y una categoría ausente NO se considera',
  'superada. PUBLICAR NO ES ADOPTAR: cada organización decide si lo usa (D-07.1).',
  'Matriz revisada: docs/decisiones/D-07-MATRIZ-CATALOGO.md. Pendientes: D-07.5, D-07.6, D-05.B, D-09.B, D-34, D-42.',
].join(' ');

export async function up(db: Kysely<unknown>): Promise<void> {
  // Nada se migra ni se recalcula: si alguna evaluación anterior llevara severidad, esto falla a propósito.
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM risk_evaluations WHERE severity <> 'NOT_ASSESSED') THEN
        RAISE EXCEPTION 'Hay evaluaciones con severidad antes de publicar 1.0.0: no se migra ninguna.';
      END IF;
    END $$`.execute(db);

  // `approval_status = APPROVED` significaba, hasta aquí, dos cosas a la vez que ahora se separan:
  //   · **publicación global**: el proyecto respalda esta versión y existe (esta columna), y
  //   · **aprobación bajo perfil jurídico**: que las reglas sirven para afirmar preparación regulatoria.
  // Lo segundo es D-07.5 y SIGUE PENDIENTE. Sin separarlas, publicar un catálogo técnico daría por cumplido el
  // requisito `RISK_CATALOG_APPROVED` del expediente y habilitaría READY por la puerta de atrás. La columna nueva
  // guarda el perfil jurídico bajo el que se aprobó una versión; para 1.0.0 es NULL, a propósito.
  await sql`ALTER TABLE risk_rule_sets ADD COLUMN regulatory_profile text`.execute(db);
  await sql`COMMENT ON COLUMN risk_rule_sets.regulatory_profile IS
    'Perfil juridico bajo el que esta version fue aprobada para concluir (D-07.5). NULL = publicada tecnicamente, sin aprobacion regulatoria.'`.execute(db);

  await sql`
    INSERT INTO risk_rule_sets (version, approval_status, approved_by, source, notes, published_at, regulatory_profile)
    VALUES (${VERSION}, 'APPROVED', 'Responsable de producto (aprobación técnica para el MVP local, 2026-10-15)',
            'docs/decisiones/D-07-MATRIZ-CATALOGO.md (matriz revisada)', ${NOTAS}, now(), NULL)`.execute(db);

  for (const r of REGLAS) {
    await sql`
      INSERT INTO risk_rules (rule_set_version, code, category, condition_kind, inputs, effect, explanation,
        limit_note, evidence_required, source, depends_on, severity)
      VALUES (${VERSION}, ${r.code}, ${r.category}, ${r.condition_kind}, ${sql.raw(`ARRAY[${r.inputs.map((i) => `'${i.replace(/'/g, "''")}'`).join(',')}]::text[]`)},
              ${r.effect}, ${r.explanation}, ${r.limit_note}, ${r.evidence_required}, ${r.source}, ${r.depends_on}, ${r.severity})`.execute(db);
  }

  // Comprobación de lo publicado: cinco con severidad, tres sin ella, y los históricos intactos.
  await sql`
    DO $$
    DECLARE con_sev int; sin_sev int; historicos int;
    BEGIN
      SELECT count(*) INTO con_sev FROM risk_rules WHERE rule_set_version = '1.0.0' AND severity IS NOT NULL;
      SELECT count(*) INTO sin_sev FROM risk_rules WHERE rule_set_version = '1.0.0' AND severity IS NULL;
      SELECT count(*) INTO historicos FROM risk_rules WHERE rule_set_version IN ('0.1.0','0.2.0') AND severity IS NOT NULL;
      IF con_sev <> 5 OR sin_sev <> 3 THEN
        RAISE EXCEPTION 'El catalogo 1.0.0 debe tener 5 reglas con severidad y 3 sin ella; hay % y %.', con_sev, sin_sev;
      END IF;
      IF historicos <> 0 THEN
        RAISE EXCEPTION 'Los catalogos historicos no deben tener severidades.';
      END IF;
      -- Publicar tecnicamente no aprueba nada bajo un perfil juridico: D-07.5 sigue pendiente.
      IF EXISTS (SELECT 1 FROM risk_rule_sets WHERE regulatory_profile IS NOT NULL) THEN
        RAISE EXCEPTION 'Ninguna version puede declarar perfil juridico mientras D-07.5 siga pendiente.';
      END IF;
    END $$`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM risk_rule_set_adoptions WHERE rule_set_version = ${VERSION}`.execute(db);
  await sql`DELETE FROM risk_rules WHERE rule_set_version = ${VERSION}`.execute(db);
  await sql`DELETE FROM risk_rule_sets WHERE version = ${VERSION}`.execute(db);
  await sql`ALTER TABLE risk_rule_sets DROP COLUMN regulatory_profile`.execute(db);
}
