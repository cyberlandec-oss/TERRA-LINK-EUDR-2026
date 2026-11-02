import { sql, type Kysely } from 'kysely';

// Cobertura histórica DECLARADA por organización (F03). Antes era una constante global («INCOMPLETE», 2026-10-13) que se mostraba a toda organización y a toda instalación.
// Una pérdida de registros es un hecho de un conjunto de datos concreto, no un corte de fechas ni una propiedad del producto:
// - Sin declaración, la cobertura es DESCONOCIDA (una base nueva tampoco acredita completitud histórica).
// - Solo se añade: declarar de nuevo es la corrección; la anterior se conserva con su responsable, fecha y procedencia.
// - No se declara nada por migración: ninguna organización existente la tiene y no se copia el incidente DEMO a otras.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE report_coverage_declarations (
      id               uuid PRIMARY KEY,
      organization_id  uuid NOT NULL REFERENCES organizations(id),
      status           text NOT NULL CHECK (status IN ('INCOMPLETE', 'COMPLETE')),
      event_date       date,
      note             text NOT NULL CHECK (length(btrim(note)) >= 10),
      reference        text,
      declared_by      text NOT NULL,
      declared_at      timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX report_coverage_decl_idx ON report_coverage_declarations (organization_id, declared_at DESC)`.execute(db);
  await sql`
    CREATE FUNCTION report_coverage_declarations_solo_agregar() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'las declaraciones de cobertura historica solo se agregan; corrige declarando de nuevo';
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER report_coverage_decl_append_only BEFORE UPDATE OR DELETE ON report_coverage_declarations
    FOR EACH ROW EXECUTE FUNCTION report_coverage_declarations_solo_agregar()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE report_coverage_declarations`.execute(db);
  await sql`DROP FUNCTION report_coverage_declarations_solo_agregar()`.execute(db);
}
