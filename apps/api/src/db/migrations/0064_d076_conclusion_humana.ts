import { Kysely, sql } from 'kysely';

// D-07.6 — CONCLUSIÓN HUMANA del responsable EUDR sobre una evaluación de riesgo concreta (decisión de producto adoptada: el rol `EUDR_MANAGER`, con el
// permiso específico `risk:conclude`; ningún otro rol lo recibe).
//
// El MOTOR nunca concluye: `risk_evaluations.conclusion` sigue clavada en `UNDETERMINED` por su CHECK. Esta migración añade el registro APARTE de la decisión de
// una persona, append-only, con lo que la sustenta:
//   · `risk_conclusions`: resultado (NEGLIGIBLE / NON_NEGLIGIBLE), motivo, quién registra, y las VERSIONES EXACTAS con que se decidió: la evaluación (número y hash de su
//     instantánea), el catálogo y su perfil jurídico referenciado (con la revisión que lo sustentaba) y la instantánea del expediente vigente en ese momento.
//   · `risk_conclusion_supports`: las evidencias (versiones de documentos de la MISMA organización, o citas). Toda conclusión exige al menos una (restricción diferida).
//   · La base repite el control de separación de funciones (quien registra no es quien evaluó) y exige, para NEGLIGIBLE, una referencia de perfil que resuelva contra
//     la REVISIÓN VIGENTE del perfil jurídico: no se puede escribir una conclusión favorable sin esa condición.
//
// Una conclusión posterior NO borra la anterior: la vigente es la última, y cada una conserva su vínculo. Registrar una conclusión NO anula requisitos pendientes,
// NO habilita READY ni despacho por sí sola y no cambia ningún permiso de otros roles.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE risk_conclusions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      evaluation_id uuid NOT NULL,
      subject_id uuid NOT NULL,
      evaluation_number int NOT NULL,
      evaluation_snapshot_hash text NOT NULL CHECK (evaluation_snapshot_hash ~ '^[0-9a-f]{64}$'),
      rule_set_version text NOT NULL REFERENCES risk_rule_sets(version),
      regulatory_profile text,
      legal_profile_version text REFERENCES legal_profile_versions(version),
      legal_review_id uuid REFERENCES legal_profile_reviews(id),
      dd_snapshot_id uuid,
      dd_snapshot_number int,
      dd_content_hash text,
      result text NOT NULL CHECK (result IN ('NEGLIGIBLE','NON_NEGLIGIBLE')),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 2000),
      recorded_by uuid NOT NULL REFERENCES users(id),
      recorded_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      supersedes_id uuid REFERENCES risk_conclusions(id),
      CONSTRAINT risk_conclusions_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT risk_conclusions_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT risk_conclusions_eval_fk FOREIGN KEY (organization_id, evaluation_id) REFERENCES risk_evaluations (organization_id, id),
      CONSTRAINT risk_conclusions_dd_fk FOREIGN KEY (organization_id, dd_snapshot_id) REFERENCES dd_snapshots (organization_id, id),
      -- Una conclusión favorable exige un perfil jurídico referenciado y la revisión en que se apoyó.
      CONSTRAINT risk_conclusions_favorable_profile CHECK (result <> 'NEGLIGIBLE' OR (regulatory_profile IS NOT NULL AND legal_profile_version = regulatory_profile AND legal_review_id IS NOT NULL))
    )`.execute(db);
  await sql`CREATE INDEX risk_conclusions_eval_idx ON risk_conclusions (organization_id, evaluation_id, recorded_at DESC)`.execute(db);
  await sql`
    CREATE TABLE risk_conclusion_supports (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      conclusion_id uuid NOT NULL,
      kind text NOT NULL CHECK (kind IN ('DOCUMENT_VERSION','CITATION')),
      document_version_id uuid,
      citation text,
      url text CHECK (url IS NULL OR url LIKE 'https://%'),
      CONSTRAINT risk_conclusion_supports_conclusion_fk FOREIGN KEY (organization_id, conclusion_id) REFERENCES risk_conclusions (organization_id, id),
      CONSTRAINT risk_conclusion_supports_document_fk FOREIGN KEY (organization_id, document_version_id) REFERENCES document_versions (organization_id, id),
      CONSTRAINT risk_conclusion_supports_shape CHECK (
        (kind = 'DOCUMENT_VERSION' AND document_version_id IS NOT NULL AND citation IS NULL)
        OR (kind = 'CITATION' AND document_version_id IS NULL AND citation IS NOT NULL AND length(btrim(citation)) BETWEEN 3 AND 500))
    )`.execute(db);
  await sql`CREATE INDEX risk_conclusion_supports_idx ON risk_conclusion_supports (organization_id, conclusion_id)`.execute(db);

  for (const t of ['risk_conclusions', 'risk_conclusion_supports']) {
    await sql.raw(`CREATE FUNCTION ${t}_append_only() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '${t} es append-only: una conclusión posterior no borra ni reescribe la anterior.'; END $$ LANGUAGE plpgsql`).execute(db);
    await sql.raw(`CREATE TRIGGER ${t}_no_mutation BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION ${t}_append_only()`).execute(db);
  }

  // La base repite lo esencial: separación de funciones, coherencia con la evaluación y la revisión vigente del perfil en una conclusión favorable.
  await sql`
    CREATE FUNCTION risk_conclusions_guard() RETURNS trigger AS $$
    DECLARE e risk_evaluations%ROWTYPE; rs_profile text; ultima uuid; decision text; prev risk_conclusions%ROWTYPE;
    BEGIN
      SELECT * INTO e FROM risk_evaluations WHERE organization_id = NEW.organization_id AND id = NEW.evaluation_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'La evaluación no existe en esta organización.'; END IF;
      IF e.evaluated_by = NEW.recorded_by THEN RAISE EXCEPTION 'Quien registra la conclusión no puede ser quien realizó la evaluación (separación de funciones).'; END IF;
      IF e.subject_id <> NEW.subject_id OR e.evaluation_number <> NEW.evaluation_number OR e.snapshot_hash <> NEW.evaluation_snapshot_hash OR e.rule_set_version <> NEW.rule_set_version THEN
        RAISE EXCEPTION 'Los vínculos de la conclusión no coinciden con la evaluación (número, hash de instantánea o catálogo).';
      END IF;
      IF NEW.supersedes_id IS NOT NULL THEN
        SELECT * INTO prev FROM risk_conclusions WHERE id = NEW.supersedes_id;
        IF NOT FOUND OR prev.organization_id <> NEW.organization_id OR prev.evaluation_id <> NEW.evaluation_id THEN
          RAISE EXCEPTION 'supersedes_id debe ser una conclusión de la misma evaluación y organización.';
        END IF;
      END IF;
      IF NEW.result = 'NEGLIGIBLE' THEN
        SELECT regulatory_profile INTO rs_profile FROM risk_rule_sets WHERE version = NEW.rule_set_version;
        IF rs_profile IS DISTINCT FROM NEW.regulatory_profile THEN RAISE EXCEPTION 'El catálogo % no declara ese perfil jurídico como regulatory_profile.', NEW.rule_set_version; END IF;
        SELECT id, legal_profile_reviews.decision INTO ultima, decision FROM legal_profile_reviews WHERE version = NEW.legal_profile_version ORDER BY decided_at DESC, id DESC LIMIT 1;
        IF ultima IS DISTINCT FROM NEW.legal_review_id OR decision IS DISTINCT FROM 'REVIEWED' THEN
          RAISE EXCEPTION 'Una conclusión favorable exige la revisión jurídica VIGENTE (REVIEWED) del perfil %.', NEW.legal_profile_version;
        END IF;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE TRIGGER risk_conclusions_guard BEFORE INSERT ON risk_conclusions FOR EACH ROW EXECUTE FUNCTION risk_conclusions_guard()`.execute(db);

  await sql`
    CREATE FUNCTION risk_conclusions_requires_support() RETURNS trigger AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM risk_conclusion_supports WHERE organization_id = NEW.organization_id AND conclusion_id = NEW.id) THEN
        RAISE EXCEPTION 'Una conclusión exige al menos una evidencia (versión de documento o cita).';
      END IF;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE CONSTRAINT TRIGGER risk_conclusions_requires_support AFTER INSERT ON risk_conclusions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION risk_conclusions_requires_support()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS risk_conclusion_supports CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS risk_conclusions CASCADE`.execute(db);
  for (const f of ['risk_conclusion_supports_append_only', 'risk_conclusions_append_only', 'risk_conclusions_guard', 'risk_conclusions_requires_support']) {
    await sql.raw(`DROP FUNCTION IF EXISTS ${f}()`).execute(db);
  }
}
