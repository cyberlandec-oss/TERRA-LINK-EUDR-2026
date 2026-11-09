import { Kysely, sql } from 'kysely';

// P0-024 Sync (RF-24, QA-08/02; docs/11 §Contrato de servidor).
// - devices: dispositivo registrado por el usuario autenticado en una organización; identificador emitido por el
//   servidor; revocable. El client_device_id es informativo: NO autoriza nada.
// - sync_operations: resultado definitivo por (organización, operation_id) con hash del contenido validado. Mismo id y
//   hash → mismo resultado; mismo id con otro hash → conflicto. Solo resultados definitivos (aceptada, rechazada,
//   conflicto); «dependencia pendiente» y errores transitorios no se guardan. Append-only.
// - sync_cursors: estado de pull en servidor ligado a organización, usuario y dispositivo, con el conjunto de recursos
//   visibles al emitirlo (los tombstones solo cubren recursos que ese cursor ya había entregado) y caducidad.
// - sync_attachment_uploads: contenido de una foto recibido y entregado al módulo Documentos (integridad y escaneo).
// - Procedencia nativa de ubicación DEVICE_LOCATION_SERVICE (hora y precisión informadas; no afirma GPS ni autenticidad).
// - Tipo de documento FIELD_PHOTO (provisional, extensión de D-36): titular parcela, clasificación PERSONAL_DATA
//   (una foto de campo puede mostrar personas; se trata como dato personal hasta decidir otra cosa).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE devices (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      user_id uuid NOT NULL REFERENCES users(id),
      client_device_id text NOT NULL CHECK (length(client_device_id) BETWEEN 8 AND 100),
      platform text NOT NULL CHECK (platform IN ('ANDROID','IOS','OTHER')),
      label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
      status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
      registered_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      revoked_by uuid REFERENCES users(id),
      revoke_reason text,
      CONSTRAINT devices_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT devices_client_uq UNIQUE (organization_id, user_id, client_device_id),
      CONSTRAINT devices_revocation CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
    )`.execute(db);
  // Un dispositivo revocado no vuelve a ACTIVE (un registro nuevo exige otro client_device_id).
  await sql`
    CREATE FUNCTION devices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'devices: no se borra un dispositivo'; END IF;
      IF OLD.status = 'REVOKED' THEN RAISE EXCEPTION 'devices: un dispositivo revocado no cambia'; END IF;
      IF (to_jsonb(NEW) - 'status' - 'revoked_at' - 'revoked_by' - 'revoke_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'revoked_at' - 'revoked_by' - 'revoke_reason') THEN
        RAISE EXCEPTION 'devices: solo cambia la revocación';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER devices_guard BEFORE UPDATE OR DELETE ON devices FOR EACH ROW EXECUTE FUNCTION devices_guard()`.execute(db);
  await sql`
    CREATE TABLE sync_operations (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      operation_id uuid NOT NULL,
      operation_type text NOT NULL,
      entity_id uuid NOT NULL,
      content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
      depends_on jsonb NOT NULL,
      base_version bigint,
      captured_at timestamptz NOT NULL,
      resolves_operation_id uuid,
      status text NOT NULL CHECK (status IN ('ACCEPTED','REJECTED','CONFLICT')),
      result jsonb NOT NULL,
      user_id uuid NOT NULL REFERENCES users(id),
      device_id uuid NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT sync_operations_op_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT sync_operations_device_fk FOREIGN KEY (organization_id, device_id) REFERENCES devices(organization_id, id)
    )`.execute(db);
  await sql`
    CREATE TABLE sync_cursors (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      user_id uuid NOT NULL REFERENCES users(id),
      device_id uuid NOT NULL,
      scope text NOT NULL CHECK (scope IN ('PLOTS')),
      visible jsonb NOT NULL,
      issued_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      CONSTRAINT sync_cursors_device_fk FOREIGN KEY (organization_id, device_id) REFERENCES devices(organization_id, id)
    )`.execute(db);
  await sql`
    CREATE TABLE sync_attachment_uploads (
      operation_id uuid NOT NULL,
      organization_id uuid NOT NULL,
      document_id uuid NOT NULL,
      version_id uuid NOT NULL,
      sha256 text NOT NULL,
      uploaded_by uuid NOT NULL REFERENCES users(id),
      device_id uuid NOT NULL,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, operation_id),
      CONSTRAINT sync_attachment_uploads_op_fk FOREIGN KEY (organization_id, operation_id) REFERENCES sync_operations(organization_id, operation_id)
    )`.execute(db);
  for (const t of ['sync_operations', 'sync_attachment_uploads']) {
    await sql.raw(`CREATE FUNCTION ${t}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${t} es append-only'; END $$`).execute(db);
    await sql.raw(`CREATE TRIGGER ${t}_no_mutation BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION ${t}_append_only()`).execute(db);
  }

  // Procedencia nativa de ubicación (contrato explícito; no es GPS).
  await sql`ALTER TABLE location_samples DROP CONSTRAINT location_samples_source_check`.execute(db);
  await sql`ALTER TABLE location_samples ADD CONSTRAINT location_samples_source_check CHECK (source IN ('BROWSER_GEOLOCATION','DEVICE_LOCATION_SERVICE'))`.execute(db);
  await sql`ALTER TABLE location_samples ADD COLUMN provider_detail text, ADD COLUMN mocked boolean, ADD COLUMN device_id uuid`.execute(db);
  await sql`ALTER TABLE location_samples ADD CONSTRAINT location_samples_native_detail CHECK (source <> 'DEVICE_LOCATION_SERVICE' OR (provider_detail IS NOT NULL AND device_id IS NOT NULL))`.execute(db);
  await sql`ALTER TABLE plot_versions DROP CONSTRAINT plot_versions_survey_method_check`.execute(db);
  await sql`ALTER TABLE plot_versions ADD CONSTRAINT plot_versions_survey_method_check
    CHECK (survey_method IN ('DECLARED','MANUAL_COORDINATES','BROWSER_GEOLOCATION','DEVICE_LOCATION_SERVICE','GPS_POINT','GPS_POLYGON','FILE_IMPORT'))`.execute(db);

  await sql`INSERT INTO document_types (code, label, allowed_owner_types, classification, source) VALUES
    ('FIELD_PHOTO', 'Fotografía de campo', ARRAY['plot'], 'PERSONAL_DATA', 'docs/11 §Fotografías y documentos (captura móvil P0-023/P0-024); provisional D-36')`.execute(db);
}

export async function down(): Promise<void> {
  throw new Error('0029 no es reversible: conserva dispositivos y resultados de sincronización');
}
