import { Kysely, sql } from 'kysely';

// P0-026 — Identidad estable de filas importadas sin código asignado (corrige la deduplicación por contenido de 0034).
// - import_references: referencia de importación que el archivo trae para una entrega NUEVA (no es un dato de negocio de la
//   entrega). Única por organización y plantilla; una entrega tiene como mucho una referencia. Append-only.
// - origin: FILE_REFERENCE (columna referencia_importacion del archivo) o LEGACY_CONTENT_FINGERPRINT (borradores importados
//   antes de esta migración con la huella de contenido; se conservan con su procedencia: lote y fila de origen).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE import_references (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      template text NOT NULL CHECK (template IN ('ENTREGAS_V1')),
      reference text NOT NULL CHECK (length(reference) BETWEEN 1 AND 80),
      origin text NOT NULL CHECK (origin IN ('FILE_REFERENCE','LEGACY_CONTENT_FINGERPRINT')),
      delivery_id uuid NOT NULL,
      batch_id uuid NOT NULL,
      row_number integer NOT NULL,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT import_references_ref_uq UNIQUE (organization_id, template, reference),
      CONSTRAINT import_references_delivery_uq UNIQUE (organization_id, template, delivery_id),
      CONSTRAINT import_references_delivery_fk FOREIGN KEY (organization_id, delivery_id) REFERENCES deliveries(organization_id, id),
      CONSTRAINT import_references_batch_fk FOREIGN KEY (organization_id, batch_id) REFERENCES import_batches(organization_id, id)
    )`.execute(db);
  await sql`
    CREATE FUNCTION import_references_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'import_references: append-only'; END $$`.execute(db);
  await sql`CREATE TRIGGER import_references_append_only BEFORE UPDATE OR DELETE ON import_references FOR EACH ROW EXECUTE FUNCTION import_references_append_only()`.execute(db);
  // Borradores ya importados (0034): conservar su identidad y procedencia.
  await sql`
    INSERT INTO import_references (organization_id, template, reference, origin, delivery_id, batch_id, row_number, created_by, created_at)
    SELECT r.organization_id, 'ENTREGAS_V1', 'HUELLA-' || d.operation_id::text, 'LEGACY_CONTENT_FINGERPRINT', d.id, r.batch_id, r.row_number, b.closed_by, b.closed_at
    FROM import_rows r JOIN import_batches b ON b.id = r.batch_id AND b.organization_id = r.organization_id
    JOIN deliveries d ON d.id = r.delivery_id AND d.organization_id = r.organization_id
    WHERE b.template = 'ENTREGAS_V1' AND r.result_action = 'CREATED'`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error('0035 no es reversible: conserva referencias de importación');
}
