import { Kysely, sql } from 'kysely';

// D-07.6 — CARENCIAS de una conclusión FAVORABLE (NEGLIGIBLE).
//
// CRITERIO ORIGINAL. El Reglamento (UE) 2023/1115 (consolidado 18.09.2026) define el riesgo insignificante como el nivel que se da cuando, «sobre la base de una evaluación COMPLETA de la
// información específica del producto y general» y, si hace falta, de medidas de mitigación adecuadas, no hay motivo de preocupación (art. 2(26)); el operador debe verificar y analizar la
// información reunida y considerar los criterios del art. 10(2), letras a) a n); y docs/13 conserva como NOT_ASSESSED con REVISIÓN requerida lo que no se pudo mirar
// (`SATELLITE_COVERAGE_UNKNOWN`: «sin alertas no prueba ausencia de deforestación») y trata un dato insuficiente como acción de recopilación, no como cero. Nada de esto autoriza a
// concluir favorablemente CON información material sin evaluar sin más: una limitación mostrada no equivale a una limitación resuelta.
//
// QUÉ IMPLEMENTA (sin inventar ninguna regla jurídica): una conclusión NEGLIGIBLE solo puede registrarse si CADA carencia de la evaluación —cada regla NO EVALUABLE y cada categoría sin
// ninguna regla en el catálogo— tiene su propia resolución explícita, de una persona, con justificación y con una evidencia concreta referenciada:
//   · NOT_APPLICABLE      — la persona declara que esa información no aplica a esta operación, con su justificación y una evidencia (documento o cita);
//   · ASSESSED_BY_HUMAN   — la persona la evaluó por su cuenta y documenta esa evaluación: exige una VERSIÓN DE DOCUMENTO del sistema como evidencia (una cita no basta).
// Una sola evidencia adjunta no resuelve las demás carencias: cada resolución la referencia explícitamente y su justificación no puede repetirse. Si falta alguna, la conclusión favorable
// no se registra (y la base lo repite). La no favorable no exige resoluciones.
export async function up(db: Kysely<unknown>): Promise<void> {
  // Carencias de una evaluación: reglas no evaluables y categorías sin ninguna regla (la misma fuente para la API y para la base).
  await sql`
    CREATE FUNCTION risk_evaluation_gaps(p_evaluation_id uuid) RETURNS TABLE (scope text, code text) AS $$
      SELECT 'FACTOR'::text, f->>'code' FROM risk_evaluations e, jsonb_array_elements(e.factors::jsonb) f WHERE e.id = p_evaluation_id AND f->>'result' = 'NOT_EVALUABLE'
      UNION ALL
      SELECT 'CATEGORY'::text, c->>'category' FROM risk_evaluations e, jsonb_array_elements(e.categories::jsonb) c WHERE e.id = p_evaluation_id AND (c->>'rules')::int = 0
    $$ LANGUAGE sql STABLE`.execute(db);

  await sql`ALTER TABLE risk_conclusion_supports ADD CONSTRAINT risk_conclusion_supports_org_id_uq UNIQUE (organization_id, id)`.execute(db);
  await sql`
    CREATE TABLE risk_conclusion_gap_resolutions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      conclusion_id uuid NOT NULL,
      scope text NOT NULL CHECK (scope IN ('FACTOR','CATEGORY')),
      code text NOT NULL CHECK (length(btrim(code)) > 0),
      kind text NOT NULL CHECK (kind IN ('NOT_APPLICABLE','ASSESSED_BY_HUMAN')),
      justification text NOT NULL CHECK (length(btrim(justification)) BETWEEN 30 AND 1000),
      support_id uuid NOT NULL,
      CONSTRAINT risk_conclusion_gap_resolutions_conclusion_fk FOREIGN KEY (organization_id, conclusion_id) REFERENCES risk_conclusions (organization_id, id),
      CONSTRAINT risk_conclusion_gap_resolutions_support_fk FOREIGN KEY (organization_id, support_id) REFERENCES risk_conclusion_supports (organization_id, id),
      CONSTRAINT risk_conclusion_gap_resolutions_uq UNIQUE (conclusion_id, scope, code)
    )`.execute(db);
  // La justificación de cada carencia es propia: no se copia la misma para todas.
  await sql`CREATE UNIQUE INDEX risk_conclusion_gap_resolutions_justification_uq ON risk_conclusion_gap_resolutions (conclusion_id, md5(lower(btrim(justification))))`.execute(db);

  await sql`
    CREATE FUNCTION risk_conclusion_gap_resolutions_append_only() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'risk_conclusion_gap_resolutions es append-only: las resoluciones de una conclusión no se editan ni se borran.'; END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE TRIGGER risk_conclusion_gap_resolutions_no_mutation BEFORE UPDATE OR DELETE ON risk_conclusion_gap_resolutions FOR EACH ROW EXECUTE FUNCTION risk_conclusion_gap_resolutions_append_only()`.execute(db);

  await sql`
    CREATE FUNCTION risk_conclusion_gap_resolutions_guard() RETURNS trigger AS $$
    DECLARE c risk_conclusions%ROWTYPE; s risk_conclusion_supports%ROWTYPE;
    BEGIN
      SELECT * INTO c FROM risk_conclusions WHERE organization_id = NEW.organization_id AND id = NEW.conclusion_id;
      IF c.result <> 'NEGLIGIBLE' THEN RAISE EXCEPTION 'Solo una conclusión NEGLIGIBLE lleva resoluciones de carencias.'; END IF;
      SELECT * INTO s FROM risk_conclusion_supports WHERE organization_id = NEW.organization_id AND id = NEW.support_id;
      IF s.conclusion_id <> NEW.conclusion_id THEN RAISE EXCEPTION 'La evidencia de una resolución debe ser de la misma conclusión.'; END IF;
      IF NEW.kind = 'ASSESSED_BY_HUMAN' AND s.kind <> 'DOCUMENT_VERSION' THEN
        RAISE EXCEPTION 'Una carencia evaluada por una persona exige una versión de documento del sistema como evidencia (una cita no basta).';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM risk_evaluation_gaps(c.evaluation_id) g WHERE g.scope = NEW.scope AND g.code = NEW.code) THEN
        RAISE EXCEPTION 'La carencia %/% no existe en la evaluación.', NEW.scope, NEW.code;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE TRIGGER risk_conclusion_gap_resolutions_guard BEFORE INSERT ON risk_conclusion_gap_resolutions FOR EACH ROW EXECUTE FUNCTION risk_conclusion_gap_resolutions_guard()`.execute(db);

  // Diferida: una conclusión NEGLIGIBLE exige que CADA carencia de la evaluación tenga su resolución.
  await sql`
    CREATE FUNCTION risk_conclusions_requires_gap_resolutions() RETURNS trigger AS $$
    DECLARE faltan text;
    BEGIN
      IF NEW.result <> 'NEGLIGIBLE' THEN RETURN NULL; END IF;
      SELECT string_agg(g.scope || ':' || g.code, ', ' ORDER BY g.scope, g.code) INTO faltan
        FROM risk_evaluation_gaps(NEW.evaluation_id) g
        WHERE NOT EXISTS (SELECT 1 FROM risk_conclusion_gap_resolutions r WHERE r.conclusion_id = NEW.id AND r.scope = g.scope AND r.code = g.code);
      IF faltan IS NOT NULL THEN
        RAISE EXCEPTION 'Una conclusión favorable exige resolver cada carencia de la evaluación; sin resolver: %', faltan;
      END IF;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE CONSTRAINT TRIGGER risk_conclusions_requires_gap_resolutions AFTER INSERT ON risk_conclusions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION risk_conclusions_requires_gap_resolutions()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS risk_conclusions_requires_gap_resolutions ON risk_conclusions`.execute(db);
  await sql`DROP TABLE IF EXISTS risk_conclusion_gap_resolutions CASCADE`.execute(db);
  await sql`ALTER TABLE risk_conclusion_supports DROP CONSTRAINT IF EXISTS risk_conclusion_supports_org_id_uq`.execute(db);
  for (const f of ['risk_conclusions_requires_gap_resolutions()', 'risk_conclusion_gap_resolutions_guard()', 'risk_conclusion_gap_resolutions_append_only()', 'risk_evaluation_gaps(uuid)']) {
    await sql.raw(`DROP FUNCTION IF EXISTS ${f}`).execute(db);
  }
}
