import { Kysely, sql } from 'kysely';

// P0-007 (RF-07): muestra de ubicación de un punto (doc 06 `gps_samples`).
// - La captura web usa la Geolocation API del navegador: fuente BROWSER_GEOLOCATION. El navegador no
//   garantiza que el sensor sea GPS (puede ser Wi-Fi, red o IP), así que no se registra como GPS_POINT.
// - Coordenadas ORIGINALES tal como se reportaron (double precision, sin redondeo).
// - captured_at = momento de adquisición informado por el dispositivo; received_at = reloj del servidor.
// - horizontal_accuracy_m: metros informados (>= 0) o NULL explícito si no se informó. Un 0 reportado
//   se conserva como 0 (no se interpreta como precisión perfecta).
// - Sin device_reference: no existe contrato de dispositivo todavía (P0-023).
// - operation_id: idempotencia del envío (doble clic o reintento tras resultado incierto).
// - Datos reportados por el cliente: no son prueba independiente de presencia física.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE plot_versions DROP CONSTRAINT plot_versions_survey_method_check`.execute(db);
  await sql`ALTER TABLE plot_versions ADD CONSTRAINT plot_versions_survey_method_check
    CHECK (survey_method IN ('DECLARED','MANUAL_COORDINATES','BROWSER_GEOLOCATION','GPS_POINT','GPS_POLYGON','FILE_IMPORT'))`.execute(db);

  await sql`
    CREATE TABLE location_samples (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      plot_id uuid NOT NULL,
      plot_version_id uuid NOT NULL,
      source text NOT NULL CHECK (source IN ('BROWSER_GEOLOCATION')),
      longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
      latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
      horizontal_accuracy_m double precision CHECK (horizontal_accuracy_m IS NULL OR horizontal_accuracy_m >= 0),
      captured_at timestamptz NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      payload_hash char(64) NOT NULL,
      created_by uuid NOT NULL REFERENCES users(id),
      CONSTRAINT location_samples_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT location_samples_version_uq UNIQUE (plot_version_id),
      CONSTRAINT location_samples_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES plots (organization_id, id),
      CONSTRAINT location_samples_version_fk FOREIGN KEY (organization_id, plot_version_id) REFERENCES plot_versions (organization_id, id)
    )`.execute(db);
  await sql`
    CREATE FUNCTION location_samples_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'location_samples es append-only';
    END $$`.execute(db);
  await sql`CREATE TRIGGER location_samples_no_mutation BEFORE UPDATE OR DELETE ON location_samples FOR EACH ROW EXECUTE FUNCTION location_samples_append_only()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE location_samples`.execute(db);
  await sql`DROP FUNCTION location_samples_append_only`.execute(db);
  await sql`ALTER TABLE plot_versions DROP CONSTRAINT plot_versions_survey_method_check`.execute(db);
  await sql`ALTER TABLE plot_versions ADD CONSTRAINT plot_versions_survey_method_check
    CHECK (survey_method IN ('DECLARED','MANUAL_COORDINATES','GPS_POINT','GPS_POLYGON','FILE_IMPORT'))`.execute(db);
}
