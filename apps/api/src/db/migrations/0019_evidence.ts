import { Kysely, sql } from 'kysely';

// P0-019 Evidencias (RF-19). Contrato: docs/12 (afirmaciones, estados, reutilización), docs/06 (evidence,
// evidence_sources/links con SUPPORTS/CONTRADICTS/BASED_ON), docs/05, docs/07 (read/link/verify/reject).
// - evidence_claim_types: catálogo de SISTEMA solo con afirmaciones de docs/12 cuya entidad existe hoy:
//   PLOT_FIELD_CAPTURED (parcela) y LAND_TENURE_DOCUMENTED (productor/parcela). Lote, análisis ambiental y
//   mitigación llegarán con sus historias. No son requisitos legales ni reglas de riesgo.
// - evidence: afirmación concreta sobre una entidad existente del mismo tenant (trigger), con estado
//   DRAFT/SUBMITTED/VERIFIED/REJECTED/REVOKED (EXPIRED se deriva de valid_to) y row_version.
// - evidence_sources: soporte = versión EXACTA de un documento (FK compuesta) con relación tipada.
//   Append-only; retirar un soporte añade una fila en evidence_source_withdrawals.
// - evidence_decisions: historia append-only de envíos, verificaciones, rechazos, revocaciones y
//   reaperturas, con motivo, responsable e instantánea de los soportes vigentes en ese momento.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE evidence_claim_types (
      code text PRIMARY KEY, label text NOT NULL, entity_types text[] NOT NULL, limitation text NOT NULL, source text NOT NULL
    )`.execute(db);
  await sql`
    INSERT INTO evidence_claim_types (code, label, entity_types, limitation, source) VALUES
      ('PLOT_FIELD_CAPTURED', 'La parcela fue capturada en campo', ARRAY['plot'], 'Precisión y procedencia verificables; no prueba legalidad ni ausencia de deforestación.', 'docs/12 (tabla de afirmaciones)'),
      ('LAND_TENURE_DOCUMENTED', 'Existe documentación de tenencia', ARRAY['producer','plot'], 'Su aplicabilidad la define un perfil validado; no es un dictamen legal.', 'docs/12 (tabla de afirmaciones); S1 §31')`.execute(db);
  await sql`
    CREATE FUNCTION evidence_claim_types_read_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'evidence_claim_types es un catálogo de sistema: se cambia con migración'; END $$`.execute(db);
  await sql`CREATE TRIGGER evidence_claim_types_no_mutation BEFORE UPDATE OR DELETE ON evidence_claim_types FOR EACH ROW EXECUTE FUNCTION evidence_claim_types_read_only()`.execute(db);

  await sql`
    CREATE TABLE evidence (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      claim_type text NOT NULL REFERENCES evidence_claim_types(code),
      entity_type text NOT NULL CHECK (entity_type IN ('producer','plot')),
      entity_id uuid NOT NULL,
      status text NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','VERIFIED','REJECTED','REVOKED')),
      valid_from date, valid_to date,
      row_version bigint NOT NULL DEFAULT 1,
      operation_id uuid NOT NULL,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT evidence_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT evidence_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT evidence_validity CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
    )`.execute(db);
  await sql`CREATE INDEX evidence_entity_idx ON evidence (organization_id, entity_type, entity_id)`.execute(db);
  await sql`
    CREATE FUNCTION evidence_entity_same_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.entity_type = 'producer' AND NOT EXISTS (SELECT 1 FROM producers WHERE id = NEW.entity_id AND organization_id = NEW.organization_id) THEN
        RAISE EXCEPTION 'evidence: productor ajeno';
      ELSIF NEW.entity_type = 'plot' AND NOT EXISTS (SELECT 1 FROM plots WHERE id = NEW.entity_id AND organization_id = NEW.organization_id) THEN
        RAISE EXCEPTION 'evidence: parcela ajena';
      END IF;
      IF TG_OP = 'UPDATE' AND (NEW.claim_type IS DISTINCT FROM OLD.claim_type OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
         OR NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
        RAISE EXCEPTION 'evidence: afirmación y entidad son inmutables';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER evidence_entity_check BEFORE INSERT OR UPDATE ON evidence FOR EACH ROW EXECUTE FUNCTION evidence_entity_same_tenant()`.execute(db);
  await sql`
    CREATE FUNCTION evidence_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'evidence no admite borrado'; END $$`.execute(db);
  await sql`CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence FOR EACH ROW EXECUTE FUNCTION evidence_no_delete()`.execute(db);

  await sql`
    CREATE TABLE evidence_sources (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      evidence_id uuid NOT NULL,
      document_version_id uuid NOT NULL,
      relationship text NOT NULL CHECK (relationship IN ('SUPPORTS','CONTRADICTS','BASED_ON')),
      note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
      operation_id uuid NOT NULL,
      added_by uuid NOT NULL REFERENCES users(id),
      added_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT evidence_sources_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT evidence_sources_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT evidence_sources_evidence_fk FOREIGN KEY (organization_id, evidence_id) REFERENCES evidence (organization_id, id),
      CONSTRAINT evidence_sources_version_fk FOREIGN KEY (organization_id, document_version_id) REFERENCES document_versions (organization_id, id)
    )`.execute(db);
  await sql`CREATE INDEX evidence_sources_version_idx ON evidence_sources (organization_id, document_version_id)`.execute(db);
  await sql`
    CREATE TABLE evidence_source_withdrawals (
      source_id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      withdrawn_by uuid NOT NULL REFERENCES users(id),
      withdrawn_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT evidence_source_withdrawals_fk FOREIGN KEY (organization_id, source_id) REFERENCES evidence_sources (organization_id, id)
    )`.execute(db);
  await sql`
    CREATE TABLE evidence_decisions (
      id bigserial PRIMARY KEY,
      organization_id uuid NOT NULL,
      evidence_id uuid NOT NULL,
      action text NOT NULL CHECK (action IN ('SUBMIT','VERIFY','REJECT','REVOKE','REOPEN')),
      from_status text NOT NULL, to_status text NOT NULL,
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      sources_snapshot jsonb NOT NULL,
      contradictions_acknowledged boolean NOT NULL DEFAULT false,
      actor_id uuid NOT NULL REFERENCES users(id),
      decided_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT evidence_decisions_fk FOREIGN KEY (organization_id, evidence_id) REFERENCES evidence (organization_id, id)
    )`.execute(db);
  for (const table of ['evidence_sources', 'evidence_source_withdrawals', 'evidence_decisions']) {
    await sql.raw(`
      CREATE FUNCTION ${table}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION '${table} es append-only'; END $$`).execute(db);
    await sql.raw(`CREATE TRIGGER ${table}_no_mutation BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_append_only()`).execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['evidence_decisions', 'evidence_source_withdrawals', 'evidence_sources']) {
    await sql.raw(`DROP TABLE ${table}`).execute(db);
    await sql.raw(`DROP FUNCTION ${table}_append_only`).execute(db);
  }
  await sql`DROP TABLE evidence`.execute(db);
  await sql`DROP FUNCTION evidence_entity_same_tenant`.execute(db);
  await sql`DROP FUNCTION evidence_no_delete`.execute(db);
  await sql`DROP TABLE evidence_claim_types`.execute(db);
  await sql`DROP FUNCTION evidence_claim_types_read_only`.execute(db);
}
