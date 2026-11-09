import { Kysely, sql } from 'kysely';

// P0-021 (revisión 2026-10-10): distinguir soporte aceptado, acción ejecutada (criterio de aceptación) y causa resuelta.
// - `mitigation_decisions.criterion_met`: la verificación declara explícitamente si se cumple el criterio de aceptación.
//   NULL = decisión histórica sin ese dato (no se reescribe: el registro es append-only).
// - `mitigation_corrections`: corrección revisada de una verificación (la decisión original se conserva). Registra si el
//   soporte sigue aceptado como soporte y que el criterio NO se cumple; deja la acción REABIERTA para una nueva entrega.
//   Separación de funciones: quien ejecutó esa entrega no corrige (igual que no decide).
// - Única transición desde VERIFIED: a REOPENED, y solo con una corrección registrada de la última decisión.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE mitigation_decisions ADD COLUMN criterion_met boolean`.execute(db);
  await sql`ALTER TABLE mitigation_decisions ADD CONSTRAINT mitigation_decisions_verified_criterion CHECK (decision <> 'VERIFIED' OR criterion_met IS DISTINCT FROM false)`.execute(db);
  await sql`ALTER TABLE mitigation_decisions ADD CONSTRAINT mitigation_decisions_org_id_uq UNIQUE (organization_id, id)`.execute(db);
  await sql`ALTER TABLE mitigation_actions DROP CONSTRAINT mitigation_actions_status_check`.execute(db);
  await sql`ALTER TABLE mitigation_actions ADD CONSTRAINT mitigation_actions_status_check CHECK (status IN ('OPEN','SUBMITTED','VERIFIED','REJECTED','REOPENED'))`.execute(db);
  await sql`
    CREATE TABLE mitigation_corrections (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      action_id uuid NOT NULL,
      decision_id uuid NOT NULL,
      submission_number integer NOT NULL,
      support_accepted boolean NOT NULL,
      criterion_met boolean NOT NULL CHECK (criterion_met = false),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 1000),
      corrected_by uuid NOT NULL REFERENCES users(id),
      corrected_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT mitigation_corrections_decision_uq UNIQUE (decision_id),
      CONSTRAINT mitigation_corrections_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT mitigation_corrections_action_fk FOREIGN KEY (organization_id, action_id) REFERENCES mitigation_actions(organization_id, id),
      CONSTRAINT mitigation_corrections_decision_fk FOREIGN KEY (organization_id, decision_id) REFERENCES mitigation_decisions(organization_id, id)
    )`.execute(db);
  await sql`
    CREATE FUNCTION mitigation_corrections_separation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM mitigation_submissions s WHERE s.action_id = NEW.action_id AND s.submission_number = NEW.submission_number AND s.submitted_by = NEW.corrected_by)
         OR EXISTS (SELECT 1 FROM mitigation_supports x WHERE x.action_id = NEW.action_id AND x.submission_number = NEW.submission_number AND x.added_by = NEW.corrected_by) THEN
        RAISE EXCEPTION 'mitigation_corrections: el ejecutor no corrige la verificación de su propia mitigación' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER mitigation_corrections_separation BEFORE INSERT ON mitigation_corrections FOR EACH ROW EXECUTE FUNCTION mitigation_corrections_separation()`.execute(db);
  await sql.raw(`CREATE FUNCTION mitigation_corrections_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'mitigation_corrections es append-only'; END $$`).execute(db);
  await sql.raw(`CREATE TRIGGER mitigation_corrections_no_mutation BEFORE UPDATE OR DELETE ON mitigation_corrections FOR EACH ROW EXECUTE FUNCTION mitigation_corrections_append_only()`).execute(db);
  await sql`
    CREATE OR REPLACE FUNCTION mitigation_actions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'mitigation_actions: no se borra una mitigación'; END IF;
      IF (to_jsonb(NEW) - 'status' - 'row_version') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'row_version') THEN RAISE EXCEPTION 'mitigation_actions: solo cambian estado y versión'; END IF;
      IF OLD.status = 'VERIFIED' AND NOT (NEW.status = 'REOPENED' AND EXISTS (
          SELECT 1 FROM mitigation_corrections c JOIN mitigation_decisions d ON d.id = c.decision_id
          WHERE c.action_id = OLD.id AND d.submission_number = (SELECT max(submission_number) FROM mitigation_decisions WHERE action_id = OLD.id))) THEN
        RAISE EXCEPTION 'mitigation_actions: una mitigación verificada solo se reabre con una corrección registrada';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error('0028 no es reversible: conserva correcciones append-only');
}
