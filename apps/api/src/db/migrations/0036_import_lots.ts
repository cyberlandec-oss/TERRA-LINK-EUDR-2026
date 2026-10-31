import { Kysely, sql } from 'kysely';

// P0-026 — Plantilla de lotes (LOTES_V1). Amplía 0030–0035 sin reescribirlas:
// - import_batches.template admite LOTES_V1; import_rows.lot_id (FK compuesta, mismo tenant; varias filas = varias entradas
//   del mismo lote).
// - import_references admite referencias de LOTES nuevos: exactamente una entidad (entrega o lote) por referencia.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE import_batches DROP CONSTRAINT import_batches_template_check`.execute(db);
  await sql`ALTER TABLE import_batches ADD CONSTRAINT import_batches_template_check CHECK (template IN ('PRODUCTORES_V1','PRODUCTOS_V1','PARCELAS_V1','ENTREGAS_V1','LOTES_V1'))`.execute(db);
  await sql`ALTER TABLE import_rows ADD COLUMN lot_id uuid`.execute(db);
  await sql`ALTER TABLE import_rows ADD CONSTRAINT import_rows_lot_fk FOREIGN KEY (organization_id, lot_id) REFERENCES lots(organization_id, id)`.execute(db);
  await sql`ALTER TABLE import_rows DROP CONSTRAINT import_rows_result`.execute(db);
  await sql`ALTER TABLE import_rows ADD CONSTRAINT import_rows_result CHECK (
    (result_action IS NULL) = (num_nonnulls(producer_id, product_id, plot_id, delivery_id, lot_id) = 0) AND num_nonnulls(producer_id, product_id, plot_id, delivery_id, lot_id) <= 1)`.execute(db);
  await sql`
    CREATE OR REPLACE FUNCTION import_rows_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'import_rows: no se borra una fila'; END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.row_number IS DISTINCT FROM OLD.row_number THEN
        RAISE EXCEPTION 'import_rows: identidad inmutable';
      END IF;
      IF OLD.result_action IS NOT NULL AND (NEW.result_action IS DISTINCT FROM OLD.result_action OR NEW.producer_id IS DISTINCT FROM OLD.producer_id
          OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.plot_id IS DISTINCT FROM OLD.plot_id OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
          OR NEW.lot_id IS DISTINCT FROM OLD.lot_id OR NEW.changed_fields IS DISTINCT FROM OLD.changed_fields) THEN
        RAISE EXCEPTION 'import_rows: el resultado registrado no cambia';
      END IF;
      IF NEW.cells_enc IS NOT NULL AND NEW.cells_enc IS DISTINCT FROM OLD.cells_enc THEN
        RAISE EXCEPTION 'import_rows: las celdas leídas no cambian';
      END IF;
      RETURN NEW;
    END $$`.execute(db);

  await sql`ALTER TABLE import_references DROP CONSTRAINT import_references_template_check`.execute(db);
  await sql`ALTER TABLE import_references ADD CONSTRAINT import_references_template_check CHECK (template IN ('ENTREGAS_V1','LOTES_V1'))`.execute(db);
  await sql`ALTER TABLE import_references ALTER COLUMN delivery_id DROP NOT NULL`.execute(db);
  await sql`ALTER TABLE import_references ADD COLUMN lot_id uuid`.execute(db);
  await sql`ALTER TABLE import_references ADD CONSTRAINT import_references_lot_fk FOREIGN KEY (organization_id, lot_id) REFERENCES lots(organization_id, id)`.execute(db);
  await sql`ALTER TABLE import_references ADD CONSTRAINT import_references_one_entity CHECK (num_nonnulls(delivery_id, lot_id) = 1
    AND (template <> 'ENTREGAS_V1' OR delivery_id IS NOT NULL) AND (template <> 'LOTES_V1' OR lot_id IS NOT NULL))`.execute(db);
  await sql`ALTER TABLE import_references ADD CONSTRAINT import_references_lot_uq UNIQUE (organization_id, template, lot_id)`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error('0036 no es reversible: conserva lotes de importación de lotes');
}
