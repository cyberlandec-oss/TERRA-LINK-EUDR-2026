import { Kysely, sql } from 'kysely';

// P0-026 Importación Excel (RF-26, QA-03; docs/06 «import_batches/rows»).
// - import_batches: una carga por organización. UPLOADED → MAPPED (mapeo explícito, se puede rehacer) → COMMITTED | DISCARDED.
//   El original NO se guarda (solo SHA-256, tamaño y nombre); los encabezados no son datos personales.
//   operation_id (carga) y commit_operation_id (confirmación) idempotentes por organización.
//   COMMITTED/DISCARDED son terminales (trigger). No se borra un lote.
// - import_rows: filas leídas del archivo, celdas CIFRADAS (pueden traer identidad) con AAD ligado a organización, lote
//   y fila. Al descartar se eliminan las celdas (quedan número de fila y resultado). Resultado de la confirmación por fila:
//   acción, productor afectado (FK compuesta, mismo tenant) y campos cambiados (nombres, nunca valores).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE import_batches (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      template text NOT NULL CHECK (template IN ('PRODUCTORES_V1')),
      status text NOT NULL CHECK (status IN ('UPLOADED','MAPPED','COMMITTED','DISCARDED')),
      sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      byte_size integer NOT NULL CHECK (byte_size > 0),
      original_filename text CHECK (original_filename IS NULL OR length(original_filename) <= 255),
      sheet_name text NOT NULL,
      headers jsonb NOT NULL,
      row_count integer NOT NULL CHECK (row_count >= 0),
      mapping jsonb,
      plan_hash text CHECK (plan_hash IS NULL OR plan_hash ~ '^[0-9a-f]{64}$'),
      summary jsonb,
      operation_id uuid NOT NULL,
      commit_operation_id uuid,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      mapped_by uuid REFERENCES users(id),
      mapped_at timestamptz,
      closed_by uuid REFERENCES users(id),
      closed_at timestamptz,
      row_version bigint NOT NULL DEFAULT 1,
      CONSTRAINT import_batches_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT import_batches_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT import_batches_commit_operation_uq UNIQUE (organization_id, commit_operation_id),
      CONSTRAINT import_batches_mapping_state CHECK ((status = 'UPLOADED') = (mapping IS NULL)),
      CONSTRAINT import_batches_commit_state CHECK ((status = 'COMMITTED') = (commit_operation_id IS NOT NULL AND summary IS NOT NULL AND closed_at IS NOT NULL)),
      CONSTRAINT import_batches_closed CHECK ((status IN ('COMMITTED','DISCARDED')) = (closed_at IS NOT NULL AND closed_by IS NOT NULL))
    )`.execute(db);
  await sql`CREATE INDEX import_batches_org_created_idx ON import_batches (organization_id, created_at DESC)`.execute(db);
  await sql`CREATE INDEX import_batches_org_sha_idx ON import_batches (organization_id, sha256)`.execute(db);
  await sql`
    CREATE FUNCTION import_batches_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'import_batches: no se borra un lote'; END IF;
      IF OLD.status IN ('COMMITTED','DISCARDED') THEN RAISE EXCEPTION 'import_batches: un lote cerrado no cambia'; END IF;
      IF (to_jsonb(NEW) - 'status' - 'mapping' - 'plan_hash' - 'summary' - 'commit_operation_id' - 'mapped_by' - 'mapped_at' - 'closed_by' - 'closed_at' - 'row_version')
         IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'mapping' - 'plan_hash' - 'summary' - 'commit_operation_id' - 'mapped_by' - 'mapped_at' - 'closed_by' - 'closed_at' - 'row_version') THEN
        RAISE EXCEPTION 'import_batches: archivo, encabezados y filas leídas son inmutables';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER import_batches_guard BEFORE UPDATE OR DELETE ON import_batches FOR EACH ROW EXECUTE FUNCTION import_batches_guard()`.execute(db);

  await sql`
    CREATE TABLE import_rows (
      organization_id uuid NOT NULL,
      batch_id uuid NOT NULL,
      row_number integer NOT NULL CHECK (row_number >= 2),
      cells_enc text,
      result_action text CHECK (result_action IS NULL OR result_action IN ('CREATED','UPDATED','UNCHANGED')),
      producer_id uuid,
      changed_fields text[],
      PRIMARY KEY (batch_id, row_number),
      CONSTRAINT import_rows_batch_fk FOREIGN KEY (organization_id, batch_id) REFERENCES import_batches(organization_id, id),
      CONSTRAINT import_rows_producer_fk FOREIGN KEY (organization_id, producer_id) REFERENCES producers(organization_id, id),
      CONSTRAINT import_rows_result CHECK ((result_action IS NULL) = (producer_id IS NULL))
    )`.execute(db);
  // Una fila solo cambia una vez (su resultado) o pierde sus celdas al descartar el lote; nunca se borra.
  await sql`
    CREATE FUNCTION import_rows_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'import_rows: no se borra una fila'; END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.row_number IS DISTINCT FROM OLD.row_number THEN
        RAISE EXCEPTION 'import_rows: identidad inmutable';
      END IF;
      IF OLD.result_action IS NOT NULL AND (NEW.result_action IS DISTINCT FROM OLD.result_action OR NEW.producer_id IS DISTINCT FROM OLD.producer_id OR NEW.changed_fields IS DISTINCT FROM OLD.changed_fields) THEN
        RAISE EXCEPTION 'import_rows: el resultado registrado no cambia';
      END IF;
      IF NEW.cells_enc IS NOT NULL AND NEW.cells_enc IS DISTINCT FROM OLD.cells_enc THEN
        RAISE EXCEPTION 'import_rows: las celdas leídas no cambian';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER import_rows_guard BEFORE UPDATE OR DELETE ON import_rows FOR EACH ROW EXECUTE FUNCTION import_rows_guard()`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error('0030 no es reversible: conserva lotes de importación y su resultado');
}
