import { Kysely, sql } from 'kysely';

// D-05.A adoptada como **perfil técnico provisional para desarrollo local** (2026-10-15, instrucción del
// responsable de producto). Contrato: docs/decisiones/D-05-PROPUESTA.md.
//
// QUÉ ES Y QUÉ NO ES
// - Es el perfil de **intercambio técnico**: cómo se prepara un GeoJSON contra una versión documentada del
//   sistema de destino, y qué parcelas no se pueden preparar.
// - **NO** acredita conformidad jurídica, **NO** autoriza presentar declaraciones ni llamar a TRACES, y **NO**
//   cambia D-07 ni ninguna conclusión regulatoria. D-05.B (aplicabilidad jurídica) sigue pendiente.
// - El resultado se llama `MEETS_PROFILE`, nunca «conforme EUDR».
//
// SEPARACIÓN DE TL_GIS_TECH
// Tabla propia y regla propia (`EUDR_GEO_V1`), versionada aparte. Las evaluaciones técnicas existentes
// (`gis_evaluations`, `TL_GIS_TECH`) **no se tocan**: ni se migran, ni se recalculan, ni se invalidan. Un cambio
// de versión del perfil no invalida un dictamen técnico, y al revés tampoco. Los dos dictámenes conviven y se
// muestran juntos porque **pueden discrepar**: un polígono con hueco es técnicamente válido y no cumple el perfil.
//
// APPEND-ONLY
// Igual que `gis_evaluations`: una evaluación es un hecho fechado. No se actualiza ni se borra; si hay que
// reevaluar, se añade otra fila. El trigger lo garantiza.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE geo_profile_evaluations (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      plot_id uuid NOT NULL,
      plot_version_id uuid NOT NULL,
      geometry_hash char(64),
      profile_id text NOT NULL,
      profile_version text NOT NULL,
      -- Identificación de la fuente contra la que se evaluó. Son cosas distintas y se guardan por separado:
      -- versión del SERVICIO de destino, versión del DOCUMENTO que la describe, y fecha de la página citada.
      source_service_version text NOT NULL,
      source_document_version text NOT NULL,
      source_page_date date NOT NULL,
      parameters jsonb NOT NULL,
      status text NOT NULL,
      checks jsonb NOT NULL,
      -- Base de superficie usada para el umbral: de dónde salió y cuánto vale. Nunca se mezcla declarada con
      -- calculada sin decir cuál se usó.
      area_basis text NOT NULL,
      area_value_ha numeric(14,6),
      exportable boolean NOT NULL,
      operation_id uuid NOT NULL,
      evaluated_by uuid NOT NULL REFERENCES users(id),
      evaluated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT geo_profile_evaluations_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES plots (organization_id, id),
      CONSTRAINT geo_profile_evaluations_version_fk FOREIGN KEY (organization_id, plot_version_id) REFERENCES plot_versions (organization_id, id),
      CONSTRAINT geo_profile_evaluations_status_check
        CHECK (status = ANY (ARRAY['MEETS_PROFILE','DOES_NOT_MEET','REVIEW_REQUIRED','NOT_EVALUABLE'])),
      CONSTRAINT geo_profile_evaluations_area_basis_check
        CHECK (area_basis = ANY (ARRAY['CALCULATED','DECLARED','NONE'])),
      -- Solo un resultado favorable puede exportarse. El candado es estructural: que nadie marque exportable
      -- una parcela que no cumple el perfil sin cambiar la regla.
      CONSTRAINT geo_profile_evaluations_exportable_check
        CHECK (exportable = (status = 'MEETS_PROFILE')),
      CONSTRAINT geo_profile_evaluations_operation_uq UNIQUE (organization_id, operation_id)
    )`.execute(db);
  await sql`CREATE INDEX geo_profile_evaluations_plot_idx ON geo_profile_evaluations (organization_id, plot_id, evaluated_at DESC)`.execute(db);
  await sql`CREATE INDEX geo_profile_evaluations_version_idx ON geo_profile_evaluations (organization_id, plot_version_id, evaluated_at DESC)`.execute(db);

  await sql`
    CREATE OR REPLACE FUNCTION geo_profile_evaluations_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'geo_profile_evaluations es append-only: una evaluacion es un hecho fechado. Anade otra, no modifiques esta.';
    END;
    $$ LANGUAGE plpgsql`.execute(db);
  await sql`
    CREATE TRIGGER geo_profile_evaluations_no_update BEFORE UPDATE OR DELETE ON geo_profile_evaluations
    FOR EACH ROW EXECUTE FUNCTION geo_profile_evaluations_append_only()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS geo_profile_evaluations_no_update ON geo_profile_evaluations`.execute(db);
  await sql`DROP FUNCTION IF EXISTS geo_profile_evaluations_append_only()`.execute(db);
  await sql`DROP TABLE IF EXISTS geo_profile_evaluations`.execute(db);
}
