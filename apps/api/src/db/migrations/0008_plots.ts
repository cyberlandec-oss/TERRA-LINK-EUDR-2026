import { Kysely, sql } from 'kysely';

// P0-006 (RF-06): parcelas y versiones geométricas (doc 06, doc 10, S1 §13).
// - plots: atributos de la parcela; producer_id obligatorio con FK compuesta (misma organización).
// - plot_versions: geometría histórica INMUTABLE (PostGIS, SRID 4326). La parcela apunta a su versión
//   actual (current_version_id, FK compuesta). Cambiar la geometría crea una versión nueva; registros
//   futuros (riesgo, entregas) referenciarán plot_version_id y geometry_hash, nunca «la parcela actual».
// - plot_history: instantánea append-only de los atributos por cada cambio (row_version).
// - Sin captura GPS (P0-007), polígonos de campo (P0-008), GeoJSON (P0-009) ni validación GIS (P0-010):
//   validation_status = NOT_VALIDATED con regla STRUCTURAL_ONLY_V1 (solo comprobaciones estructurales).
// - survey_method: catálogo provisional D-23. Superficie declarada y calculada separadas; un punto no
//   tiene superficie calculada.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE plots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      producer_id uuid NOT NULL,
      plot_code text NOT NULL CHECK (plot_code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$'),
      name text,
      crop text NOT NULL CHECK (length(btrim(crop)) BETWEEN 1 AND 60),
      variety text,
      land_use text,
      province text,
      canton text,
      parish text,
      status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
      current_version_id uuid,
      row_version bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid NOT NULL REFERENCES users(id),
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid NOT NULL REFERENCES users(id),
      deleted_at timestamptz,
      deleted_by uuid REFERENCES users(id),
      deletion_reason text,
      CONSTRAINT plots_code_uq UNIQUE (organization_id, plot_code),
      CONSTRAINT plots_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT plots_producer_fk FOREIGN KEY (organization_id, producer_id) REFERENCES producers (organization_id, id),
      CONSTRAINT plots_logical_delete CHECK ((status = 'INACTIVE') = (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND deletion_reason IS NOT NULL))
    )`.execute(db);
  await sql`CREATE INDEX plots_org_producer_idx ON plots (organization_id, producer_id)`.execute(db);
  await sql`CREATE INDEX plots_org_status_code_idx ON plots (organization_id, status, plot_code, id)`.execute(db);

  await sql`
    CREATE TABLE plot_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      plot_id uuid NOT NULL,
      version_number integer NOT NULL CHECK (version_number > 0),
      geometry geometry(Geometry, 4326),
      geometry_type text CHECK (geometry_type IN ('POINT','POLYGON','MULTIPOLYGON')),
      geometry_hash char(64),
      area_declared_ha numeric(12,4) CHECK (area_declared_ha IS NULL OR area_declared_ha > 0),
      area_calculated_ha numeric(14,6) CHECK (area_calculated_ha IS NULL OR area_calculated_ha >= 0),
      survey_method text NOT NULL CHECK (survey_method IN ('DECLARED','MANUAL_COORDINATES','GPS_POINT','GPS_POLYGON','FILE_IMPORT')),
      surveyed_at timestamptz,
      accuracy_m numeric(10,2) CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
      validation_status text NOT NULL CHECK (validation_status IN ('NOT_VALIDATED','VALID','WARNING','INVALID','REVIEW_REQUIRED')),
      validation_rule_version text NOT NULL,
      previous_version_id uuid,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid NOT NULL REFERENCES users(id),
      CONSTRAINT plot_versions_number_uq UNIQUE (plot_id, version_number),
      CONSTRAINT plot_versions_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT plot_versions_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES plots (organization_id, id),
      CONSTRAINT plot_versions_previous_fk FOREIGN KEY (organization_id, previous_version_id) REFERENCES plot_versions (organization_id, id),
      CONSTRAINT plot_versions_geometry_consistent CHECK ((geometry IS NULL) = (geometry_type IS NULL) AND (geometry IS NULL) = (geometry_hash IS NULL)),
      CONSTRAINT plot_versions_point_no_area CHECK (geometry_type IS DISTINCT FROM 'POINT' OR area_calculated_ha IS NULL),
      CONSTRAINT plot_versions_srid CHECK (geometry IS NULL OR ST_SRID(geometry) = 4326),
      CONSTRAINT plot_versions_has_content CHECK (geometry IS NOT NULL OR area_declared_ha IS NOT NULL)
    )`.execute(db);
  await sql`CREATE INDEX plot_versions_geom_gist ON plot_versions USING GIST (geometry)`.execute(db);
  await sql`
    CREATE FUNCTION plot_versions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'plot_versions es append-only';
    END $$`.execute(db);
  await sql`CREATE TRIGGER plot_versions_no_mutation BEFORE UPDATE OR DELETE ON plot_versions FOR EACH ROW EXECUTE FUNCTION plot_versions_append_only()`.execute(db);

  await sql`
    ALTER TABLE plots ADD CONSTRAINT plots_current_version_fk
    FOREIGN KEY (organization_id, current_version_id) REFERENCES plot_versions (organization_id, id)`.execute(db);

  await sql`
    CREATE TABLE plot_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      plot_id uuid NOT NULL,
      row_version bigint NOT NULL,
      change_type text NOT NULL,
      changed_fields text[] NOT NULL,
      snapshot jsonb NOT NULL,
      reason text,
      changed_by uuid NOT NULL REFERENCES users(id),
      changed_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT plot_history_uq UNIQUE (plot_id, row_version),
      CONSTRAINT plot_history_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES plots (organization_id, id)
    )`.execute(db);
  await sql`
    CREATE FUNCTION plot_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'plot_history es append-only';
    END $$`.execute(db);
  await sql`CREATE TRIGGER plot_history_no_mutation BEFORE UPDATE OR DELETE ON plot_history FOR EACH ROW EXECUTE FUNCTION plot_history_append_only()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE plot_history`.execute(db);
  await sql`DROP FUNCTION plot_history_append_only`.execute(db);
  await sql`ALTER TABLE plots DROP CONSTRAINT plots_current_version_fk`.execute(db);
  await sql`DROP TABLE plot_versions`.execute(db);
  await sql`DROP FUNCTION plot_versions_append_only`.execute(db);
  await sql`DROP TABLE plots`.execute(db);
}
