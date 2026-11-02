import { Kysely, sql } from 'kysely';

// P0-026 — Plantilla de productos (PRODUCTOS_V1). Amplía 0030 sin reescribirla:
// - import_batches.template admite PRODUCTOS_V1.
// - import_rows.product_id: producto afectado (FK compuesta, mismo tenant). Una fila con resultado apunta a exactamente
//   una entidad (productor o producto); el resultado sigue siendo inmutable (trigger ampliado).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE import_batches DROP CONSTRAINT import_batches_template_check`.execute(db);
  await sql`ALTER TABLE import_batches ADD CONSTRAINT import_batches_template_check CHECK (template IN ('PRODUCTORES_V1','PRODUCTOS_V1'))`.execute(db);
  await sql`ALTER TABLE import_rows ADD COLUMN product_id uuid`.execute(db);
  await sql`ALTER TABLE import_rows ADD CONSTRAINT import_rows_product_fk FOREIGN KEY (organization_id, product_id) REFERENCES products(organization_id, id)`.execute(db);
  await sql`ALTER TABLE import_rows DROP CONSTRAINT import_rows_result`.execute(db);
  await sql`ALTER TABLE import_rows ADD CONSTRAINT import_rows_result CHECK (
    (result_action IS NULL) = (producer_id IS NULL AND product_id IS NULL) AND NOT (producer_id IS NOT NULL AND product_id IS NOT NULL))`.execute(db);
  await sql`
    CREATE OR REPLACE FUNCTION import_rows_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'import_rows: no se borra una fila'; END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.row_number IS DISTINCT FROM OLD.row_number THEN
        RAISE EXCEPTION 'import_rows: identidad inmutable';
      END IF;
      IF OLD.result_action IS NOT NULL AND (NEW.result_action IS DISTINCT FROM OLD.result_action OR NEW.producer_id IS DISTINCT FROM OLD.producer_id
          OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.changed_fields IS DISTINCT FROM OLD.changed_fields) THEN
        RAISE EXCEPTION 'import_rows: el resultado registrado no cambia';
      END IF;
      IF NEW.cells_enc IS NOT NULL AND NEW.cells_enc IS DISTINCT FROM OLD.cells_enc THEN
        RAISE EXCEPTION 'import_rows: las celdas leídas no cambian';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error('0031 no es reversible: conserva lotes de importación de productos');
}
