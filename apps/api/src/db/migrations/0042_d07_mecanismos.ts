import { Kysely, sql } from 'kysely';

// D-07 — MECANISMOS adoptados para el MVP local (2026-10-15, instrucción del responsable de producto).
// Contrato: docs/decisiones/D-07-PROPUESTA.md.
//
// QUÉ SE ADOPTA Y QUÉ NO
// - Se adoptan los **mecanismos** D-07.1 (aprobación), D-07.2 (severidad por regla, máximo) y D-07.4
//   (desactualización). **NO se aprueba ningún catálogo**, **NO se asigna ninguna severidad a las reglas
//   existentes** y **NO se migra ninguna evaluación anterior**.
// - `0.1.0` y `0.2.0` se conservan **tal cual, como históricos**: sus reglas siguen con `severity NULL`.
// - **D-07.3 no aplica**: no hay pesos, cortes ni puntuaciones, y el modelo no los admite.
// - **D-07.5 y D-07.6 siguen pendientes**: la conclusión regulatoria sigue clavada en `UNDETERMINED` por un
//   `CHECK` estructural. `READY` y despacho **no se habilitan** por nada de esto.
//
// D-07.1 — ÁMBITO DE LA APROBACIÓN
// Las definiciones de reglas (`risk_rule_sets`, `risk_rules`) son **globales**: no llevan organización y no se
// cambia eso. Por tanto se separan dos actos que hasta ahora estaban confundidos en una sola columna:
//
//   · **Publicación global**  → `risk_rule_sets.approval_status`. Significa «esta versión existe y está
//     respaldada por el proyecto». Es lo que ya había, y sigue en `NOT_APPROVED` para las dos versiones.
//   · **Adopción de uso por organización** → `risk_rule_set_adoptions`, tabla nueva. Significa «ESTA
//     organización decide usar esta versión». Una adopción en la organización A **no afecta a B**: la tabla
//     lleva `organization_id` y la consulta siempre lo filtra.
//
// Una organización **no puede adoptar una versión que no esté publicada globalmente**: eso dejaría que un
// tenant se autoconcediera reglas que el proyecto no respalda. El `CHECK` no puede expresarlo (depende de otra
// tabla), así que lo comprueba el caso de uso y lo prueba la suite.
//
// **No se amplía `SUPER_ADMIN` ni se resuelve D-04.** El permiso nuevo `risk:approve_rules` es de ámbito de
// organización y se asigna solo a `ORG_ADMIN`. La publicación global sigue siendo un acto de migración, no una
// operación de usuario: nadie puede publicar una versión global desde la API.
export async function up(db: Kysely<unknown>): Promise<void> {
  // ---------------------------------------------------------------- D-07.1
  await sql`
    CREATE TABLE risk_rule_set_adoptions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      rule_set_version text NOT NULL REFERENCES risk_rule_sets(version),
      -- Append-only con decisión explícita: adoptar y retirar son filas, no un UPDATE de estado.
      decision text NOT NULL CHECK (decision IN ('ADOPT','WITHDRAW')),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      -- El actor sale de la sesión, nunca del payload.
      decided_by uuid NOT NULL REFERENCES users(id),
      decided_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT risk_rule_set_adoptions_operation_uq UNIQUE (organization_id, operation_id)
    )`.execute(db);
  await sql`CREATE INDEX risk_rule_set_adoptions_org_idx ON risk_rule_set_adoptions (organization_id, decided_at DESC)`.execute(db);

  await sql`
    CREATE OR REPLACE FUNCTION risk_rule_set_adoptions_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'risk_rule_set_adoptions es append-only: adoptar y retirar son hechos fechados. Anade otra fila, no modifiques esta.';
    END;
    $$ LANGUAGE plpgsql`.execute(db);
  await sql`
    CREATE TRIGGER risk_rule_set_adoptions_no_update BEFORE UPDATE OR DELETE ON risk_rule_set_adoptions
    FOR EACH ROW EXECUTE FUNCTION risk_rule_set_adoptions_append_only()`.execute(db);

  // ---------------------------------------------------------------- D-07.2
  // La severidad pasa a poder DECLARARSE por regla y versión. No se asigna ninguna aquí: las reglas de `0.1.0`
  // y `0.2.0` se quedan en NULL, que es lo que significa «esta versión no clasifica».
  await sql`ALTER TABLE risk_rules DROP CONSTRAINT risk_rules_severity_check`.execute(db);
  await sql`
    ALTER TABLE risk_rules ADD CONSTRAINT risk_rules_severity_check
    CHECK (severity IS NULL OR severity IN ('LOW','MEDIUM','HIGH','CRITICAL'))`.execute(db);

  // Cobertura de la severidad: cuántas reglas se evaluaron, cuántas no, y qué categorías no tienen ninguna
  // regla. Va en la propia evaluación porque una severidad sin su cobertura se lee como si fuera completa.
  await sql`ALTER TABLE risk_evaluations ADD COLUMN severity_coverage jsonb`.execute(db);
  // Qué adopción respalda la severidad. Sin adopción no hay severidad: el candado es estructural.
  await sql`ALTER TABLE risk_evaluations ADD COLUMN severity_adoption_id uuid REFERENCES risk_rule_set_adoptions(id)`.execute(db);

  // El candado de 0025 bloqueaba conclusión Y severidad a la vez. Se sustituye por dos, más precisos:
  //   · la conclusión regulatoria sigue clavada (D-07.5 y D-07.6 pendientes);
  //   · la severidad solo existe si hay una adopción que la respalde.
  // NO es una relajación: lo que antes era «nunca», ahora es «nunca sin que alguien lo haya adoptado».
  await sql`ALTER TABLE risk_evaluations DROP CONSTRAINT risk_evaluations_no_conclusion`.execute(db);
  await sql`
    ALTER TABLE risk_evaluations ADD CONSTRAINT risk_evaluations_conclusion_undetermined
    CHECK (conclusion = 'UNDETERMINED')`.execute(db);
  await sql`
    ALTER TABLE risk_evaluations ADD CONSTRAINT risk_evaluations_severity_backed
    CHECK ((severity = 'NOT_ASSESSED') = (severity_adoption_id IS NULL))`.execute(db);

  // ---------------------------------------------------------------- comprobación de lo que NO cambia
  // Si alguna evaluación histórica llevara severidad, este `up` fallaría: no hay ninguna, y debe seguir así.
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM risk_evaluations WHERE severity <> 'NOT_ASSESSED') THEN
        RAISE EXCEPTION 'Hay evaluaciones con severidad antes de adoptar el mecanismo: no se migra ninguna.';
      END IF;
      IF EXISTS (SELECT 1 FROM risk_rules WHERE severity IS NOT NULL) THEN
        RAISE EXCEPTION 'Hay reglas con severidad declarada: esta migracion no asigna ninguna.';
      END IF;
    END $$`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE risk_evaluations DROP CONSTRAINT IF EXISTS risk_evaluations_severity_backed`.execute(db);
  await sql`ALTER TABLE risk_evaluations DROP CONSTRAINT IF EXISTS risk_evaluations_conclusion_undetermined`.execute(db);
  await sql`
    ALTER TABLE risk_evaluations ADD CONSTRAINT risk_evaluations_no_conclusion
    CHECK (conclusion = 'UNDETERMINED' AND severity = 'NOT_ASSESSED')`.execute(db);
  await sql`ALTER TABLE risk_evaluations DROP COLUMN IF EXISTS severity_adoption_id`.execute(db);
  await sql`ALTER TABLE risk_evaluations DROP COLUMN IF EXISTS severity_coverage`.execute(db);
  await sql`ALTER TABLE risk_rules DROP CONSTRAINT IF EXISTS risk_rules_severity_check`.execute(db);
  await sql`ALTER TABLE risk_rules ADD CONSTRAINT risk_rules_severity_check CHECK (severity IS NULL)`.execute(db);
  await sql`DROP TRIGGER IF EXISTS risk_rule_set_adoptions_no_update ON risk_rule_set_adoptions`.execute(db);
  await sql`DROP FUNCTION IF EXISTS risk_rule_set_adoptions_append_only()`.execute(db);
  await sql`DROP TABLE IF EXISTS risk_rule_set_adoptions`.execute(db);
}
