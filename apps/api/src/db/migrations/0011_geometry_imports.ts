import { Kysely, sql } from 'kysely';

// P0-009 (RF-09): importación GeoJSON con revisión previa.
// - geometry_imports: archivo original (en almacenamiento privado S3, clave `object_key`) con su
//   SHA-256 calculado en el servidor, tamaño y resultado del análisis (sin coordenadas en `analysis`).
//   La geometría analizada se guarda en PostGIS para la vista previa y la confirmación; está sujeta a la
//   misma clasificación que plot_versions (`plot:read_geometry`).
// - Estados: ANALYZED → CONFIRMED (crea una versión FILE_IMPORT) | DISCARDED.
// - Staging y compensación (no hay transacción entre S3 y PostgreSQL):
//   1. el objeto se sube ANTES de insertar la fila; si la inserción falla, se borra el objeto;
//   2. un objeto sin fila nunca se sirve (la descarga parte de la fila autorizada) y el barrido lo elimina;
//   3. la confirmación comprueba que el objeto existe dentro de la transacción; los objetos de imports
//      ANALYZED/CONFIRMED nunca se borran, así ninguna versión apunta a un archivo inexistente;
//   4. descartar marca DISCARDED y después borra el objeto; si el borrado falla, lo retoma el barrido.
// - plot_versions.source_import_id: referencia (FK compuesta, mismo tenant) al original importado.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE geometry_imports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      plot_id uuid NOT NULL,
      status text NOT NULL CHECK (status IN ('ANALYZED','CONFIRMED','DISCARDED')),
      object_key text NOT NULL,
      sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      byte_size integer NOT NULL CHECK (byte_size > 0),
      original_filename text CHECK (original_filename IS NULL OR length(original_filename) <= 255),
      media_type text NOT NULL,
      profile_version text NOT NULL,
      geometry geometry(Geometry, 4326) NOT NULL,
      geometry_type text NOT NULL CHECK (geometry_type IN ('POLYGON','MULTIPOLYGON')),
      technically_valid boolean NOT NULL,
      validity_reason text,
      analysis jsonb NOT NULL,
      operation_id uuid NOT NULL,
      confirm_operation_id uuid,
      confirmed_version_id uuid,
      row_version bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid NOT NULL REFERENCES users(id),
      closed_at timestamptz,
      closed_by uuid REFERENCES users(id),
      CONSTRAINT geometry_imports_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT geometry_imports_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT geometry_imports_confirm_operation_uq UNIQUE (organization_id, confirm_operation_id),
      CONSTRAINT geometry_imports_object_uq UNIQUE (object_key),
      CONSTRAINT geometry_imports_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES plots (organization_id, id),
      CONSTRAINT geometry_imports_version_fk FOREIGN KEY (organization_id, confirmed_version_id) REFERENCES plot_versions (organization_id, id),
      CONSTRAINT geometry_imports_confirmed_consistent CHECK ((status = 'CONFIRMED') = (confirmed_version_id IS NOT NULL AND confirm_operation_id IS NOT NULL)),
      CONSTRAINT geometry_imports_closed_consistent CHECK ((status = 'ANALYZED') = (closed_at IS NULL))
    )`.execute(db);
  await sql`CREATE INDEX geometry_imports_plot_idx ON geometry_imports (organization_id, plot_id, created_at DESC)`.execute(db);

  // El original y su análisis no cambian: solo se permiten transiciones de estado.
  await sql`
    CREATE FUNCTION geometry_imports_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'geometry_imports no admite borrado'; END IF;
      IF NEW.object_key IS DISTINCT FROM OLD.object_key OR NEW.sha256 IS DISTINCT FROM OLD.sha256
         OR NEW.byte_size IS DISTINCT FROM OLD.byte_size OR NOT ST_Equals(NEW.geometry, OLD.geometry)
         OR NEW.analysis IS DISTINCT FROM OLD.analysis OR NEW.plot_id IS DISTINCT FROM OLD.plot_id
         OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR OLD.status <> 'ANALYZED' THEN
        RAISE EXCEPTION 'geometry_imports: original y análisis inmutables';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER geometry_imports_no_mutation BEFORE UPDATE OR DELETE ON geometry_imports FOR EACH ROW EXECUTE FUNCTION geometry_imports_immutable()`.execute(db);

  await sql`ALTER TABLE plot_versions ADD COLUMN source_import_id uuid`.execute(db);
  await sql`ALTER TABLE plot_versions ADD CONSTRAINT plot_versions_source_import_fk FOREIGN KEY (organization_id, source_import_id) REFERENCES geometry_imports (organization_id, id)`.execute(db);
  await sql`ALTER TABLE plot_versions ADD CONSTRAINT plot_versions_import_method CHECK (source_import_id IS NULL OR survey_method = 'FILE_IMPORT')`.execute(db);
  await sql`CREATE UNIQUE INDEX plot_versions_source_import_uq ON plot_versions (source_import_id) WHERE source_import_id IS NOT NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE plot_versions DROP CONSTRAINT plot_versions_import_method`.execute(db);
  await sql`ALTER TABLE plot_versions DROP CONSTRAINT plot_versions_source_import_fk`.execute(db);
  await sql`ALTER TABLE plot_versions DROP COLUMN source_import_id`.execute(db);
  await sql`DROP TABLE geometry_imports`.execute(db);
  await sql`DROP FUNCTION geometry_imports_immutable`.execute(db);
}
