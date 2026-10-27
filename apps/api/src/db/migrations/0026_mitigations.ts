import { Kysely, sql } from 'kysely';

// P0-021 Mitigación (RF-21, QA-11). Contrato: docs/13 §Mitigación («crear acción con causa, responsable, fecha, evidencia
// requerida y criterio de aceptación. Aportar soporte → revisión → VERIFIED o REJECTED con motivo. Cierre de tarea no cambia
// la regla sin evaluación; reevaluar después de verificar. Conservar actor ejecutor/verificador; excepción de autoaprobación
// requiere política expresa y auditoría»). No existe política de excepción: el ejecutor no verifica su propia mitigación.
// Esto NO cambia la política de Evidencias (D-37, pendiente).
// - Acción ligada a evaluación + factor + recurso (lote). Entregas (submissions) numeradas; soportes = versión EXACTA de
//   documento o evidencia (con su row_version); decisiones únicas por entrega (concurrencia: una gana).
// - Reevaluación asíncrona por outbox (consumidor risk-reevaluation) con idempotencia por evento.
// - Reglas de riesgo 0.2.0 (siguen NO APROBADAS): MITIGATION_UNVERIFIED pasa a ser evaluable (dependía de P0-021).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE risk_evaluations ADD COLUMN trigger jsonb`.execute(db);
  await sql`
    CREATE TABLE mitigation_actions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      evaluation_id uuid NOT NULL,
      factor_code text NOT NULL,
      subject_type text NOT NULL CHECK (subject_type IN ('LOT')),
      subject_id uuid NOT NULL,
      title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 160),
      acceptance_criteria text NOT NULL CHECK (length(btrim(acceptance_criteria)) BETWEEN 3 AND 1000),
      evidence_required text NOT NULL CHECK (length(btrim(evidence_required)) BETWEEN 3 AND 500),
      assignee_membership_id uuid NOT NULL,
      due_date date NOT NULL,
      status text NOT NULL CHECK (status IN ('OPEN','SUBMITTED','VERIFIED','REJECTED')),
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      row_version bigint NOT NULL DEFAULT 1,
      CONSTRAINT mitigation_actions_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT mitigation_actions_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT mitigation_actions_eval_fk FOREIGN KEY (organization_id, evaluation_id) REFERENCES risk_evaluations(organization_id, id),
      CONSTRAINT mitigation_actions_lot_fk FOREIGN KEY (organization_id, subject_id) REFERENCES lots(organization_id, id),
      CONSTRAINT mitigation_actions_assignee_fk FOREIGN KEY (organization_id, assignee_membership_id) REFERENCES memberships(organization_id, id)
    )`.execute(db);
  // Solo cambian estado y versión; la causa, el responsable y los criterios quedan fijos (cambiarlos = nueva acción).
  await sql`
    CREATE FUNCTION mitigation_actions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'mitigation_actions: no se borra una mitigación'; END IF;
      IF (to_jsonb(NEW) - 'status' - 'row_version') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'row_version') THEN RAISE EXCEPTION 'mitigation_actions: solo cambian estado y versión'; END IF;
      IF OLD.status = 'VERIFIED' THEN RAISE EXCEPTION 'mitigation_actions: una mitigación verificada no cambia'; END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER mitigation_actions_guard BEFORE UPDATE OR DELETE ON mitigation_actions FOR EACH ROW EXECUTE FUNCTION mitigation_actions_guard()`.execute(db);
  await sql`
    CREATE TABLE mitigation_supports (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      action_id uuid NOT NULL,
      submission_number integer NOT NULL CHECK (submission_number > 0),
      document_version_id uuid,
      evidence_id uuid,
      evidence_version bigint,
      added_by uuid NOT NULL REFERENCES users(id),
      added_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT mitigation_supports_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT mitigation_supports_one_ref CHECK ((document_version_id IS NULL) <> (evidence_id IS NULL) AND ((evidence_id IS NULL) = (evidence_version IS NULL))),
      CONSTRAINT mitigation_supports_action_fk FOREIGN KEY (organization_id, action_id) REFERENCES mitigation_actions(organization_id, id),
      CONSTRAINT mitigation_supports_docver_fk FOREIGN KEY (organization_id, document_version_id) REFERENCES document_versions(organization_id, id),
      CONSTRAINT mitigation_supports_evidence_fk FOREIGN KEY (organization_id, evidence_id) REFERENCES evidence(organization_id, id)
    )`.execute(db);
  await sql`
    CREATE TABLE mitigation_submissions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      action_id uuid NOT NULL,
      submission_number integer NOT NULL CHECK (submission_number > 0),
      note text NOT NULL CHECK (length(btrim(note)) BETWEEN 3 AND 1000),
      submitted_by uuid NOT NULL REFERENCES users(id),
      submitted_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT mitigation_submissions_uq UNIQUE (action_id, submission_number),
      CONSTRAINT mitigation_submissions_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT mitigation_submissions_action_fk FOREIGN KEY (organization_id, action_id) REFERENCES mitigation_actions(organization_id, id)
    )`.execute(db);
  await sql`
    CREATE TABLE mitigation_decisions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      action_id uuid NOT NULL,
      submission_number integer NOT NULL,
      decision text NOT NULL CHECK (decision IN ('VERIFIED','REJECTED')),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
      decided_by uuid NOT NULL REFERENCES users(id),
      decided_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT mitigation_decisions_uq UNIQUE (action_id, submission_number),
      CONSTRAINT mitigation_decisions_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT mitigation_decisions_action_fk FOREIGN KEY (organization_id, action_id) REFERENCES mitigation_actions(organization_id, id)
    )`.execute(db);
  // Separación de funciones (docs/13) también en base: quien entregó o aportó soportes en esa entrega no decide.
  await sql`
    CREATE FUNCTION mitigation_decisions_separation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM mitigation_submissions s WHERE s.action_id = NEW.action_id AND s.submission_number = NEW.submission_number AND s.submitted_by = NEW.decided_by)
         OR EXISTS (SELECT 1 FROM mitigation_supports x WHERE x.action_id = NEW.action_id AND x.submission_number = NEW.submission_number AND x.added_by = NEW.decided_by) THEN
        RAISE EXCEPTION 'mitigation_decisions: el ejecutor no verifica su propia mitigación (sin política de excepción)' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER mitigation_decisions_separation BEFORE INSERT ON mitigation_decisions FOR EACH ROW EXECUTE FUNCTION mitigation_decisions_separation()`.execute(db);
  for (const t of ['mitigation_supports', 'mitigation_submissions', 'mitigation_decisions']) {
    await sql.raw(`CREATE FUNCTION ${t}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${t} es append-only'; END $$`).execute(db);
    await sql.raw(`CREATE TRIGGER ${t}_no_mutation BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION ${t}_append_only()`).execute(db);
  }

  // Reglas 0.2.0 (siguen NO APROBADAS): mismas reglas; MITIGATION_UNVERIFIED evaluable.
  await sql`INSERT INTO risk_rule_sets (version, approval_status, approved_by, source, notes) VALUES ('0.2.0', 'NOT_APPROVED', NULL, 'docs/13 (reglas ejemplo y categorías)',
    'Igual que 0.1.0; MITIGATION_UNVERIFIED pasa a evaluarse (mitigaciones P0-021). NO APROBADAS: sin pesos, umbrales, severidades ni lista jurídica.')`.execute(db);
  await sql`
    INSERT INTO risk_rules (rule_set_version, code, category, condition_kind, inputs, effect, explanation, limit_note, evidence_required, source, depends_on)
    SELECT '0.2.0', code, category, condition_kind, inputs,
           CASE WHEN code = 'MITIGATION_UNVERIFIED' THEN 'BLOCKING' ELSE effect END, explanation,
           CASE WHEN code = 'MITIGATION_UNVERIFIED' THEN 'Bloqueo de cierre de revisión (docs/13). Verificar una mitigación no resuelve por sí sola su causa ni vuelve favorable el riesgo.' ELSE limit_note END,
           evidence_required, source, CASE WHEN code = 'MITIGATION_UNVERIFIED' THEN NULL ELSE depends_on END
    FROM risk_rules WHERE rule_set_version = '0.1.0'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['mitigation_decisions', 'mitigation_submissions', 'mitigation_supports', 'mitigation_actions']) await sql.raw(`DROP TABLE ${t}`).execute(db);
}
