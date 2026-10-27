import { Kysely, sql } from 'kysely';

// P0-010 (parte técnica) y barrido programado de P0-009.
//
// object_deletions: tareas de borrado de objetos del almacenamiento privado, registradas y reintentables.
// - Solo dos motivos: DISCARDED (importación descartada) y ORPHAN (objeto sin fila, con antigüedad
//   mayor que la gracia configurada). Nunca originales confirmados (su retención depende de D-29).
// - Reclamo con FOR UPDATE SKIP LOCKED + lease: varios workers no procesan la misma tarea a la vez.
// - Antes de borrar se vuelve a comprobar que ninguna importación ANALYZED/CONFIRMED usa la clave
//   (SKIPPED_REFERENCED si aparece). Fallos: FAILED con código controlado y reintento con espera.
//
// gis_evaluations: evaluación técnica INMUTABLE de una versión geométrica (no modifica plot_versions).
// - Regla y parámetros efectivos, actor, fecha, hash de la geometría evaluada y huella del conjunto de
//   versiones comparadas (para marcar resultados desactualizados sin tocar su historia).
// - error_location: ubicación del problema técnico; solo se entrega con plot:read_geometry.
// gis_evaluation_comparisons: versiones de OTRAS parcelas con relación encontrada (igualdad o
//   solapamiento con superficie; el contacto por borde se registra como TOUCH).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE object_deletions (
      object_key text PRIMARY KEY,
      reason text NOT NULL CHECK (reason IN ('DISCARDED','ORPHAN')),
      status text NOT NULL CHECK (status IN ('PENDING','FAILED','DONE','SKIPPED_REFERENCED')),
      attempts integer NOT NULL DEFAULT 0,
      last_error_code text,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      leased_by text,
      lease_until timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    )`.execute(db);
  await sql`CREATE INDEX object_deletions_due_idx ON object_deletions (next_attempt_at) WHERE status IN ('PENDING','FAILED')`.execute(db);

  await sql`
    CREATE TABLE gis_evaluations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      plot_id uuid NOT NULL,
      plot_version_id uuid NOT NULL,
      geometry_hash char(64),
      rule_id text NOT NULL,
      rule_version text NOT NULL,
      parameters jsonb NOT NULL,
      status text NOT NULL CHECK (status IN ('VALID','WARNING','INVALID','REVIEW_REQUIRED')),
      checks jsonb NOT NULL,
      capture_quality jsonb NOT NULL,
      destination_profile jsonb NOT NULL,
      error_location geometry(Geometry, 4326),
      compared_set_hash char(64) NOT NULL,
      compared_count integer NOT NULL CHECK (compared_count >= 0),
      operation_id uuid NOT NULL,
      evaluated_by uuid NOT NULL REFERENCES users(id),
      evaluated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT gis_evaluations_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT gis_evaluations_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT gis_evaluations_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES plots (organization_id, id),
      CONSTRAINT gis_evaluations_version_fk FOREIGN KEY (organization_id, plot_version_id) REFERENCES plot_versions (organization_id, id)
    )`.execute(db);
  await sql`CREATE INDEX gis_evaluations_plot_idx ON gis_evaluations (organization_id, plot_id, evaluated_at DESC)`.execute(db);

  await sql`
    CREATE TABLE gis_evaluation_comparisons (
      evaluation_id uuid NOT NULL,
      organization_id uuid NOT NULL,
      compared_plot_id uuid NOT NULL,
      compared_version_id uuid NOT NULL,
      compared_geometry_hash char(64) NOT NULL,
      relation text NOT NULL CHECK (relation IN ('EQUAL','OVERLAP','TOUCH')),
      same_hash boolean NOT NULL,
      shared_area_m2 numeric(16,2),
      PRIMARY KEY (evaluation_id, compared_version_id),
      CONSTRAINT gis_eval_cmp_eval_fk FOREIGN KEY (organization_id, evaluation_id) REFERENCES gis_evaluations (organization_id, id),
      CONSTRAINT gis_eval_cmp_version_fk FOREIGN KEY (organization_id, compared_version_id) REFERENCES plot_versions (organization_id, id),
      CONSTRAINT gis_eval_cmp_plot_fk FOREIGN KEY (organization_id, compared_plot_id) REFERENCES plots (organization_id, id)
    )`.execute(db);

  for (const table of ['gis_evaluations', 'gis_evaluation_comparisons']) {
    await sql.raw(`
      CREATE FUNCTION ${table}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '${table} es append-only';
      END $$`).execute(db);
    await sql.raw(`CREATE TRIGGER ${table}_no_mutation BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_append_only()`).execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE gis_evaluation_comparisons`.execute(db);
  await sql`DROP FUNCTION gis_evaluation_comparisons_append_only`.execute(db);
  await sql`DROP TABLE gis_evaluations`.execute(db);
  await sql`DROP FUNCTION gis_evaluations_append_only`.execute(db);
  await sql`DROP TABLE object_deletions`.execute(db);
}
