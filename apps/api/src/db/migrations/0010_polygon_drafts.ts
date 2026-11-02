import { Kysely, sql } from 'kysely';

// P0-008 (RF-08): borrador de polígono persistido en el SERVIDOR (no es almacenamiento offline).
// Contrato del borrador:
// - Un único borrador OPEN por parcela. Estados: OPEN → CONFIRMED (crea una versión) | CANCELLED.
// - draft_vertices: cada muestra adquirida, inmutable (coordenadas originales, fuente, adquisición,
//   recepción, precisión o NULL). acquisition_seq fija el orden explícito de captura.
// - Deshacer NO borra ni altera la muestra: añade una fila en draft_vertex_exclusions. La composición
//   vigente = vértices no excluidos en orden de acquisition_seq. Historial completo conservado.
// - row_version del borrador: control de concurrencia entre pestañas (añadir, deshacer, cancelar,
//   confirmar exigen la versión leída).
// - operation_id por muestra: un reintento no duplica el vértice.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE polygon_drafts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      plot_id uuid NOT NULL,
      status text NOT NULL CHECK (status IN ('OPEN','CONFIRMED','CANCELLED')),
      row_version bigint NOT NULL DEFAULT 1,
      confirmed_version_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid NOT NULL REFERENCES users(id),
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid NOT NULL REFERENCES users(id),
      closed_at timestamptz,
      closed_by uuid REFERENCES users(id),
      CONSTRAINT polygon_drafts_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT polygon_drafts_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES plots (organization_id, id),
      CONSTRAINT polygon_drafts_version_fk FOREIGN KEY (organization_id, confirmed_version_id) REFERENCES plot_versions (organization_id, id),
      CONSTRAINT polygon_drafts_confirmed_consistent CHECK ((status = 'CONFIRMED') = (confirmed_version_id IS NOT NULL)),
      CONSTRAINT polygon_drafts_closed_consistent CHECK ((status = 'OPEN') = (closed_at IS NULL))
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX polygon_drafts_one_open ON polygon_drafts (organization_id, plot_id) WHERE status = 'OPEN'`.execute(db);
  await sql`CREATE UNIQUE INDEX polygon_drafts_version_uq ON polygon_drafts (confirmed_version_id) WHERE confirmed_version_id IS NOT NULL`.execute(db);

  await sql`
    CREATE TABLE draft_vertices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      draft_id uuid NOT NULL,
      acquisition_seq integer NOT NULL CHECK (acquisition_seq > 0),
      source text NOT NULL CHECK (source IN ('BROWSER_GEOLOCATION')),
      longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
      latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
      horizontal_accuracy_m double precision CHECK (horizontal_accuracy_m IS NULL OR horizontal_accuracy_m >= 0),
      captured_at timestamptz NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      payload_hash char(64) NOT NULL,
      created_by uuid NOT NULL REFERENCES users(id),
      CONSTRAINT draft_vertices_seq_uq UNIQUE (draft_id, acquisition_seq),
      CONSTRAINT draft_vertices_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT draft_vertices_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT draft_vertices_draft_fk FOREIGN KEY (organization_id, draft_id) REFERENCES polygon_drafts (organization_id, id)
    )`.execute(db);

  await sql`
    CREATE TABLE draft_vertex_exclusions (
      vertex_id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      excluded_at timestamptz NOT NULL DEFAULT now(),
      excluded_by uuid NOT NULL REFERENCES users(id),
      CONSTRAINT draft_vertex_exclusions_vertex_fk FOREIGN KEY (organization_id, vertex_id) REFERENCES draft_vertices (organization_id, id)
    )`.execute(db);

  for (const table of ['draft_vertices', 'draft_vertex_exclusions']) {
    await sql.raw(`
      CREATE FUNCTION ${table}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '${table} es append-only';
      END $$`).execute(db);
    await sql.raw(`CREATE TRIGGER ${table}_no_mutation BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_append_only()`).execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE draft_vertex_exclusions`.execute(db);
  await sql`DROP FUNCTION draft_vertex_exclusions_append_only`.execute(db);
  await sql`DROP TABLE draft_vertices`.execute(db);
  await sql`DROP FUNCTION draft_vertices_append_only`.execute(db);
  await sql`DROP TABLE polygon_drafts`.execute(db);
}
