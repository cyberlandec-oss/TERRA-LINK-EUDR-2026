import { Kysely, sql } from 'kysely';

// P0-004 (RF-04): productores. Campos de S1 §12 y doc 06; ningún campo obligatorio adicional.
// - Identidad (documento, teléfono, dirección) se lee solo con producer:read_identity.
// - Responsable asignado: FK compuesta a memberships (misma organización).
// - Baja lógica (INACTIVE + deleted_*): conserva historia y referencias futuras (parcelas, entregas).
// - producer_versions: instantánea append-only por versión (historial de cambios).
// - Unicidad básica de código por organización; deduplicación asistida y fusiones son P0-005.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE producers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      producer_code text NOT NULL CHECK (producer_code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$'),
      first_name text,
      last_name text,
      legal_name text,
      document_type text CHECK (document_type IS NULL OR length(btrim(document_type)) BETWEEN 1 AND 40),
      document_number text CHECK (document_number IS NULL OR length(btrim(document_number)) BETWEEN 1 AND 40),
      phone text,
      address text,
      community text,
      province text,
      canton text,
      parish text,
      status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','INACTIVE')),
      assigned_membership_id uuid,
      row_version bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid NOT NULL REFERENCES users(id),
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid NOT NULL REFERENCES users(id),
      deleted_at timestamptz,
      deleted_by uuid REFERENCES users(id),
      deletion_reason text,
      CONSTRAINT producers_code_uq UNIQUE (organization_id, producer_code),
      CONSTRAINT producers_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT producers_name_required CHECK (
        (length(btrim(coalesce(first_name, ''))) > 0 AND length(btrim(coalesce(last_name, ''))) > 0)
        OR length(btrim(coalesce(legal_name, ''))) > 0),
      CONSTRAINT producers_document_pair CHECK ((document_type IS NULL) = (document_number IS NULL)),
      CONSTRAINT producers_logical_delete CHECK ((status = 'INACTIVE') = (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND deletion_reason IS NOT NULL)),
      CONSTRAINT producers_assignee_fk FOREIGN KEY (organization_id, assigned_membership_id)
        REFERENCES memberships (organization_id, id)
    )`.execute(db);
  await sql`CREATE INDEX producers_org_status_code_idx ON producers (organization_id, status, producer_code, id)`.execute(db);
  await sql`CREATE INDEX producers_assignee_idx ON producers (organization_id, assigned_membership_id)`.execute(db);

  await sql`
    CREATE TABLE producer_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      producer_id uuid NOT NULL,
      version bigint NOT NULL,
      change_type text NOT NULL,
      changed_fields text[] NOT NULL,
      snapshot jsonb NOT NULL,
      reason text,
      changed_by uuid NOT NULL REFERENCES users(id),
      changed_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT producer_versions_uq UNIQUE (producer_id, version),
      CONSTRAINT producer_versions_producer_fk FOREIGN KEY (organization_id, producer_id) REFERENCES producers (organization_id, id)
    )`.execute(db);
  await sql`
    CREATE FUNCTION producer_versions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'producer_versions es append-only';
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER producer_versions_no_mutation BEFORE UPDATE OR DELETE ON producer_versions
    FOR EACH ROW EXECUTE FUNCTION producer_versions_append_only()`.execute(db);

  // Proyección alimentada por eventos (consistencia eventual): productores por estado y organización.
  await sql`
    CREATE TABLE producer_status_counts (
      organization_id uuid NOT NULL REFERENCES organizations(id),
      status text NOT NULL CHECK (status IN ('DRAFT','ACTIVE','INACTIVE')),
      producer_count bigint NOT NULL DEFAULT 0 CHECK (producer_count >= 0),
      PRIMARY KEY (organization_id, status)
    )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE producer_status_counts`.execute(db);
  await sql`DROP TABLE producer_versions`.execute(db);
  await sql`DROP FUNCTION producer_versions_append_only`.execute(db);
  await sql`DROP TABLE producers`.execute(db);
}
