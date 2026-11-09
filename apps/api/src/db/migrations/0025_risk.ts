import { Kysely, sql } from 'kysely';

// P0-020 Riesgo (RF-20, QA-10). Contrato: docs/13 (dimensiones separadas; categorías; registro de regla; evaluación
// reproducible; reglas ejemplo DATA_MISSING_ORIGIN, GEOMETRY_INVALID, SATELLITE_COVERAGE_UNKNOWN, DOCUMENT_EXPIRED,
// MASS_BALANCE_INCONSISTENT, MATERIAL_OF_UNKNOWN_ORIGIN, MITIGATION_UNVERIFIED; «no se aprueban pesos, umbrales ni lista
// jurídica»). Catálogo de reglas de SISTEMA versionado con estado NO APROBADO: sin pesos, umbrales, puntuaciones ni
// severidades inventadas. Evaluaciones append-only con instantánea (versiones de datos/evidencias), hash, reglas,
// parámetros, actor y razones; reevaluar crea una versión nueva. Revisión humana aparte. Sin mitigaciones (P0-021) ni
// expediente (P0-022). También: P0-017 guarda la compuerta de cada movimiento de inventario.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE gate_evaluations DROP CONSTRAINT gate_evaluations_entity_type_check`.execute(db);
  await sql`ALTER TABLE gate_evaluations ADD CONSTRAINT gate_evaluations_entity_type_check CHECK (entity_type IN ('delivery','reception','quality_result','process_run','stock_movement'))`.execute(db);

  await sql`
    CREATE TABLE risk_rule_sets (
      version text PRIMARY KEY CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
      approval_status text NOT NULL CHECK (approval_status IN ('NOT_APPROVED','APPROVED')),
      approved_by text, source text NOT NULL, notes text NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT risk_rule_sets_approval CHECK ((approval_status = 'APPROVED') = (approved_by IS NOT NULL))
    )`.execute(db);
  await sql`
    CREATE TABLE risk_rules (
      rule_set_version text NOT NULL REFERENCES risk_rule_sets(version),
      code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{2,59}$'),
      category text NOT NULL CHECK (category IN ('DEFORESTATION','LEGALITY','MIXING','SUPPLY_CHAIN','DOCUMENT_CREDIBILITY','TRACEABILITY','EVASION','HUMAN_RIGHTS','INDIGENOUS_RIGHTS','DATA_QUALITY')),
      condition_kind text NOT NULL,
      inputs text[] NOT NULL,
      effect text NOT NULL CHECK (effect IN ('BLOCKING','REVIEW_REQUIRED','NOT_ASSESSED')),
      explanation text NOT NULL, limit_note text NOT NULL, evidence_required text NOT NULL, source text NOT NULL,
      depends_on text,
      severity text CHECK (severity IS NULL),  -- sin severidades aprobadas: siempre NULL hasta un perfil aprobado
      PRIMARY KEY (rule_set_version, code)
    )`.execute(db);
  await sql`
    CREATE TABLE risk_evaluations (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      subject_type text NOT NULL CHECK (subject_type IN ('LOT')),
      subject_id uuid NOT NULL,
      evaluation_number integer NOT NULL CHECK (evaluation_number > 0),
      rule_set_version text NOT NULL REFERENCES risk_rule_sets(version),
      parameters jsonb NOT NULL,
      snapshot jsonb NOT NULL,
      snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
      factors jsonb NOT NULL,
      categories jsonb NOT NULL,
      technical_result text NOT NULL CHECK (technical_result IN ('BLOCKED','REVIEW_REQUIRED','INCOMPLETE','NO_FINDINGS_IN_EVALUATED_RULES')),
      severity text NOT NULL CHECK (severity IN ('NOT_ASSESSED','LOW','MEDIUM','HIGH','CRITICAL')),
      conclusion text NOT NULL CHECK (conclusion IN ('UNDETERMINED','NEGLIGIBLE','NON_NEGLIGIBLE')),
      evaluated_by uuid NOT NULL REFERENCES users(id),
      evaluated_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT risk_evaluations_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT risk_evaluations_number_uq UNIQUE (organization_id, subject_type, subject_id, evaluation_number),
      CONSTRAINT risk_evaluations_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT risk_evaluations_lot_fk FOREIGN KEY (organization_id, subject_id) REFERENCES lots(organization_id, id),
      -- Sin perfil jurídico aprobado no hay conclusión regulatoria ni severidad.
      CONSTRAINT risk_evaluations_no_conclusion CHECK (conclusion = 'UNDETERMINED' AND severity = 'NOT_ASSESSED')
    )`.execute(db);
  await sql`
    CREATE TABLE risk_reviews (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      evaluation_id uuid NOT NULL,
      action text NOT NULL CHECK (action IN ('START_REVIEW','RESOLVE')),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      reviewer_id uuid NOT NULL REFERENCES users(id),
      reviewed_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT risk_reviews_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT risk_reviews_action_uq UNIQUE (evaluation_id, action),
      CONSTRAINT risk_reviews_eval_fk FOREIGN KEY (organization_id, evaluation_id) REFERENCES risk_evaluations(organization_id, id)
    )`.execute(db);
  for (const t of ['risk_rule_sets', 'risk_rules', 'risk_evaluations', 'risk_reviews']) {
    await sql.raw(`CREATE FUNCTION ${t}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${t} es append-only: una reevaluación o una nueva versión de reglas crea registros nuevos'; END $$`).execute(db);
    await sql.raw(`CREATE TRIGGER ${t}_no_mutation BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION ${t}_append_only()`).execute(db);
  }

  const V = '0.1.0';
  await sql`INSERT INTO risk_rule_sets (version, approval_status, approved_by, source, notes) VALUES (${V}, 'NOT_APPROVED', NULL, 'docs/13 (reglas ejemplo y categorías)',
    'Reglas técnicas derivadas de los ejemplos de docs/13. NO APROBADAS: sin pesos, umbrales, severidades ni lista jurídica. Resultado técnico; la conclusión regulatoria queda UNDETERMINED.')`.execute(db);
  const rules: Array<[string, string, string, string[], string, string, string, string, string, string | null]> = [
    ['DATA_MISSING_ORIGIN', 'TRACEABILITY', 'delivery_without_origin', ['entregas de origen del lote'], 'BLOCKING', 'Alguna entrega que alimenta el lote no declara parcela de origen.', 'No inventar parcela.', 'Declaración de origen (parcela) de la entrega', 'docs/13 regla ejemplo DATA_MISSING_ORIGIN', null],
    ['MATERIAL_OF_UNKNOWN_ORIGIN', 'MIXING', 'lot_origin_incomplete', ['estado de origen del lote'], 'BLOCKING', 'El lote contiene material de origen incompleto.', 'Bloqueo según perfil aplicable (no definido): no se concluye favorable; un saldo positivo no autoriza mezcla.', 'Origen de todas las entradas', 'docs/13 regla ejemplo MATERIAL_OF_UNKNOWN_ORIGIN; docs/05', null],
    ['GEOMETRY_INVALID', 'DATA_QUALITY', 'plot_geometry_technically_invalid', ['versión vigente de cada parcela de origen', 'evaluación TL_GIS_TECH de esa versión'], 'BLOCKING', 'La geometría vigente de una parcela de origen es técnicamente inválida (TL_GIS_TECH).', 'Validez técnica de la geometría: prerrequisito de análisis fiable. No es análisis de deforestación ni cumplimiento EUDR.', 'Geometría vigente con evaluación técnica', 'docs/13 regla ejemplo GEOMETRY_INVALID; P0-010', null],
    ['GEOLOCATION_PROFILE', 'DEFORESTATION', 'destination_profile', ['perfil de destino geoespacial'], 'NOT_ASSESSED', 'Cumplimiento del perfil de geolocalización de destino (punto/polígono, umbral de superficie).', 'Depende de D-05 (no aprobada): no puede evaluarse.', 'Perfil de destino aprobado', 'docs/22 D-05', 'D-05'],
    ['SATELLITE_COVERAGE_UNKNOWN', 'DEFORESTATION', 'satellite_coverage', ['cobertura satelital de cada parcela'], 'NOT_ASSESSED', 'Cobertura satelital y alertas de cambio de cobertura de las parcelas de origen.', 'Sin proveedor satelital (P0-028): NOT_ASSESSED y revisión requerida. Sin alertas no prueba ausencia de deforestación.', 'Resultado de proveedor satelital con procedencia', 'docs/13 regla ejemplo SATELLITE_COVERAGE_UNKNOWN', 'P0-028'],
    ['DOCUMENT_EXPIRED', 'DOCUMENT_CREDIBILITY', 'support_expired', ['soportes vigentes de las entregas de origen'], 'REVIEW_REQUIRED', 'Algún soporte documental de las entregas de origen está vencido.', 'Comprobar el alcance temporal; un documento vigente no prueba por sí solo cumplimiento.', 'Soportes vigentes por versión', 'docs/13 regla ejemplo DOCUMENT_EXPIRED', null],
    ['MASS_BALANCE_INCONSISTENT', 'TRACEABILITY', 'ledger_reconciliation', ['ledger de inventario de los lotes del grafo'], 'BLOCKING', 'El ledger no concilia con recepciones, asignaciones o procesos de los lotes del grafo.', 'Corrección auditada; no se cuadra con ajustes automáticos.', 'Conciliación del ledger', 'docs/13 regla ejemplo MASS_BALANCE_INCONSISTENT; P0-017', null],
    ['MITIGATION_UNVERIFIED', 'SUPPLY_CHAIN', 'mitigation_status', ['mitigaciones del sujeto'], 'NOT_ASSESSED', 'Mitigaciones pendientes de verificación.', 'Las mitigaciones no existen todavía (P0-021): no puede evaluarse.', 'Mitigación verificada', 'docs/13 regla ejemplo MITIGATION_UNVERIFIED', 'P0-021'],
  ];
  for (const [code, category, kind, inputs, effect, explanation, limit, evidence, source, depends] of rules) {
    await sql`INSERT INTO risk_rules (rule_set_version, code, category, condition_kind, inputs, effect, explanation, limit_note, evidence_required, source, depends_on)
      VALUES (${V}, ${code}, ${category}, ${kind}, ${inputs}::text[], ${effect}, ${explanation}, ${limit}, ${evidence}, ${source}, ${depends})`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['risk_reviews', 'risk_evaluations', 'risk_rules', 'risk_rule_sets']) await sql.raw(`DROP TABLE ${t}`).execute(db);
}
