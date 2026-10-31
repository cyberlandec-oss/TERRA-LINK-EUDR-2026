import { sql, type Kysely } from 'kysely';

// D — Vértices de polígono capturados en el dispositivo.
//
// 1) Procedencia: el vértice conserva SU adquisición real. `source` admite 'DEVICE_LOCATION_SERVICE' además de
//    'BROWSER_GEOLOCATION', y se guardan `provider_detail`, `mocked` y `device_id` (nulos en los vértices de la web).
// 2) Asociación: el borrador de polígono recuerda de qué captura móvil nació (`origin_capture_id`, `origin_device_id`).
//    Así, varios trabajos independientes no se mezclan en el mismo borrador y un cambio hecho desde la web mientras el
//    teléfono estaba sin red se detecta como conflicto explícito en lugar de absorberse en silencio.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE draft_vertices DROP CONSTRAINT draft_vertices_source_check`.execute(db);
  await sql`ALTER TABLE draft_vertices ADD CONSTRAINT draft_vertices_source_check CHECK (source IN ('BROWSER_GEOLOCATION', 'DEVICE_LOCATION_SERVICE'))`.execute(db);
  await sql`ALTER TABLE draft_vertices ADD COLUMN provider_detail text, ADD COLUMN mocked boolean, ADD COLUMN device_id uuid`.execute(db);
  await sql`ALTER TABLE polygon_drafts ADD COLUMN origin_capture_id uuid, ADD COLUMN origin_device_id uuid`.execute(db);
  // 3) Un polígono confirmado con vértices de orígenes distintos no se rotula con uno solo: MIXED_ACQUISITION.
  await sql`ALTER TABLE plot_versions DROP CONSTRAINT plot_versions_survey_method_check`.execute(db);
  await sql`ALTER TABLE plot_versions ADD CONSTRAINT plot_versions_survey_method_check
    CHECK (survey_method IN ('DECLARED','MANUAL_COORDINATES','BROWSER_GEOLOCATION','DEVICE_LOCATION_SERVICE','MIXED_ACQUISITION','GPS_POINT','GPS_POLYGON','FILE_IMPORT'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE plot_versions SET survey_method = 'DEVICE_LOCATION_SERVICE' WHERE survey_method = 'MIXED_ACQUISITION'`.execute(db);
  await sql`ALTER TABLE plot_versions DROP CONSTRAINT plot_versions_survey_method_check`.execute(db);
  await sql`ALTER TABLE plot_versions ADD CONSTRAINT plot_versions_survey_method_check
    CHECK (survey_method IN ('DECLARED','MANUAL_COORDINATES','BROWSER_GEOLOCATION','DEVICE_LOCATION_SERVICE','GPS_POINT','GPS_POLYGON','FILE_IMPORT'))`.execute(db);
  await sql`ALTER TABLE polygon_drafts DROP COLUMN origin_capture_id, DROP COLUMN origin_device_id`.execute(db);
  await sql`ALTER TABLE draft_vertices DROP COLUMN provider_detail, DROP COLUMN mocked, DROP COLUMN device_id`.execute(db);
  await sql`ALTER TABLE draft_vertices DROP CONSTRAINT draft_vertices_source_check`.execute(db);
  await sql`ALTER TABLE draft_vertices ADD CONSTRAINT draft_vertices_source_check CHECK (source IN ('BROWSER_GEOLOCATION'))`.execute(db);
}
