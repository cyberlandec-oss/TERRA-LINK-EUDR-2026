import { sql, type Kysely } from 'kysely';

// País de producción: una DECLARACIÓN explícita, versionada y por parcela de origen (decisión del propietario, 2026-10-30).
//
// Ni la organización, ni el comprador, ni el destino del embarque demuestran dónde se produjo el cacao, y por eso no se deduce ni se rellena «Ecuador».
// - La declaración pertenece a la PARCELA (el origen): un expediente con varios orígenes conserva uno por uno.
// - Solo se añade: corregir es declarar de nuevo (`declaration_number` siguiente); la anterior se conserva intacta y trazable.
// - `country` NULL = «declarado como desconocido» (alguien responsable dejó constancia de que no se sabe). La ausencia de filas = «sin declarar». Son dos cosas distintas.
// - Responsable (`declared_by`), fecha y versión quedan en la fila; la idempotencia es por `operation_id`.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE plot_production_declarations (
      id                  uuid PRIMARY KEY,
      organization_id     uuid NOT NULL REFERENCES organizations(id),
      plot_id             uuid NOT NULL,
      declaration_number  integer NOT NULL CHECK (declaration_number > 0),
      country             char(2),
      note                text,
      declared_by         uuid NOT NULL REFERENCES users(id),
      declared_at         timestamptz NOT NULL DEFAULT now(),
      operation_id        uuid NOT NULL,
      CONSTRAINT plot_prod_decl_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES plots(organization_id, id),
      CONSTRAINT plot_prod_decl_pais CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
      CONSTRAINT plot_prod_decl_version_uq UNIQUE (plot_id, declaration_number),
      CONSTRAINT plot_prod_decl_operacion_uq UNIQUE (organization_id, operation_id)
    )`.execute(db);
  await sql`CREATE INDEX plot_prod_decl_plot_idx ON plot_production_declarations (organization_id, plot_id, declaration_number DESC)`.execute(db);
  await sql`
    CREATE FUNCTION plot_production_declarations_solo_agregar() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'las declaraciones de pais de produccion solo se agregan; corrige declarando de nuevo';
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER plot_prod_decl_append_only BEFORE UPDATE OR DELETE ON plot_production_declarations
    FOR EACH ROW EXECUTE FUNCTION plot_production_declarations_solo_agregar()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE plot_production_declarations`.execute(db);
  await sql`DROP FUNCTION plot_production_declarations_solo_agregar()`.execute(db);
}
