import { Kysely, sql } from 'kysely';

// P0-018 Documentos (RF-18). Contrato: docs/12 (estados separados), docs/06 (documents, document_versions),
// S1 §30, UX_UI §17.
// - document_types: catálogo de SISTEMA con los tipos que nombran las fuentes: LAND_TENURE (documento de
//   tenencia, S1 §31/§34 y docs/12) y DELIVERY_SUPPORT (soporte de entrega, KDE DELIVERY de docs/08).
//   Clasificación PERSONAL_DATA: descargar el contenido exige además producer:read_identity.
// - documents: titular (owner) = entidad existente del mismo tenant (producer/plot); `delivery` reservado
//   para P0-012 y hoy rechazado. Sin borrado.
// - document_versions: bytes inmutables (objeto privado en S3) + SHA-256 del servidor + metadatos; una
//   versión nueva no reemplaza la anterior.
// - Estados separados (append-only): escaneos (CLEAN/INFECTED/FAILED) y revisiones humanas
//   (ACCEPTED/REJECTED) por VERSIÓN; una versión nueva no hereda revisiones. Disponibilidad =
//   último escaneo CLEAN. Pendiente, fallido o infectado nunca es «disponible».
// - document_links: vinculación «adjunto a» con entidades admitidas del mismo tenant. Las relaciones
//   probatorias (SUPPORTS/CONTRADICTS/BASED_ON) son de P0-019.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE document_types (
      code text PRIMARY KEY, label text NOT NULL, allowed_owner_types text[] NOT NULL,
      classification text NOT NULL CHECK (classification IN ('OPERATIONAL','PERSONAL_DATA')), source text NOT NULL
    )`.execute(db);
  await sql`
    INSERT INTO document_types (code, label, allowed_owner_types, classification, source) VALUES
      ('LAND_TENURE', 'Documento de tenencia de la tierra', ARRAY['producer','plot'], 'PERSONAL_DATA', 'S1 §31 (Land Document), §34; docs/12 «documentación de tenencia»'),
      ('DELIVERY_SUPPORT', 'Soporte de entrega', ARRAY['producer','delivery'], 'OPERATIONAL', 'docs/08 KDE DELIVERY «soporte»')`.execute(db);
  await sql`
    CREATE FUNCTION document_types_read_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'document_types es un catálogo de sistema: se cambia con migración'; END $$`.execute(db);
  await sql`CREATE TRIGGER document_types_no_mutation BEFORE UPDATE OR DELETE ON document_types FOR EACH ROW EXECUTE FUNCTION document_types_read_only()`.execute(db);

  await sql`
    CREATE TABLE documents (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      document_type text NOT NULL REFERENCES document_types(code),
      owner_type text NOT NULL CHECK (owner_type IN ('producer','plot','delivery')),
      owner_id uuid NOT NULL,
      title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
      current_version_id uuid,
      row_version bigint NOT NULL DEFAULT 1,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT documents_org_id_uq UNIQUE (organization_id, id)
    )`.execute(db);
  await sql`CREATE INDEX documents_owner_idx ON documents (organization_id, owner_type, owner_id)`.execute(db);
  // Titular del mismo tenant (referencia polimórfica protegida por trigger).
  await sql`
    CREATE FUNCTION documents_owner_same_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.owner_type = 'producer' AND NOT EXISTS (SELECT 1 FROM producers WHERE id = NEW.owner_id AND organization_id = NEW.organization_id) THEN
        RAISE EXCEPTION 'documents: el productor titular no pertenece a la organización';
      ELSIF NEW.owner_type = 'plot' AND NOT EXISTS (SELECT 1 FROM plots WHERE id = NEW.owner_id AND organization_id = NEW.organization_id) THEN
        RAISE EXCEPTION 'documents: la parcela titular no pertenece a la organización';
      ELSIF NEW.owner_type = 'delivery' THEN
        RAISE EXCEPTION 'documents: las entregas aún no existen (P0-012)';
      END IF;
      IF TG_OP = 'UPDATE' AND (NEW.owner_type IS DISTINCT FROM OLD.owner_type OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
         OR NEW.document_type IS DISTINCT FROM OLD.document_type OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
        RAISE EXCEPTION 'documents: tipo y titular son inmutables';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER documents_owner_check BEFORE INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION documents_owner_same_tenant()`.execute(db);
  await sql`
    CREATE FUNCTION documents_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'documents no admite borrado'; END $$`.execute(db);
  await sql`CREATE TRIGGER documents_no_delete BEFORE DELETE ON documents FOR EACH ROW EXECUTE FUNCTION documents_no_delete()`.execute(db);

  await sql`
    CREATE TABLE document_versions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      document_id uuid NOT NULL,
      version_number integer NOT NULL CHECK (version_number > 0),
      object_key text NOT NULL UNIQUE,
      file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
      mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
      size_bytes integer NOT NULL CHECK (size_bytes > 0),
      sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      issuer text CHECK (issuer IS NULL OR length(btrim(issuer)) BETWEEN 1 AND 160),
      issued_at date,
      expires_at date,
      previous_version_id uuid REFERENCES document_versions(id),
      operation_id uuid NOT NULL,
      uploaded_by uuid NOT NULL REFERENCES users(id),
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT document_versions_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT document_versions_number_uq UNIQUE (document_id, version_number),
      CONSTRAINT document_versions_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT document_versions_doc_fk FOREIGN KEY (organization_id, document_id) REFERENCES documents (organization_id, id),
      CONSTRAINT document_versions_dates CHECK (issued_at IS NULL OR expires_at IS NULL OR issued_at <= expires_at)
    )`.execute(db);
  await sql`ALTER TABLE documents ADD CONSTRAINT documents_current_version_fk FOREIGN KEY (organization_id, current_version_id) REFERENCES document_versions (organization_id, id)`.execute(db);

  await sql`
    CREATE TABLE document_version_scans (
      id bigserial PRIMARY KEY,
      organization_id uuid NOT NULL,
      version_id uuid NOT NULL,
      result text NOT NULL CHECK (result IN ('CLEAN','INFECTED','FAILED')),
      engine text NOT NULL, signature text, error_code text,
      scanned_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT document_version_scans_version_fk FOREIGN KEY (organization_id, version_id) REFERENCES document_versions (organization_id, id)
    )`.execute(db);
  await sql`CREATE INDEX document_version_scans_idx ON document_version_scans (version_id, id DESC)`.execute(db);
  await sql`
    CREATE TABLE document_version_reviews (
      id bigserial PRIMARY KEY,
      organization_id uuid NOT NULL,
      version_id uuid NOT NULL,
      decision text NOT NULL CHECK (decision IN ('ACCEPTED','REJECTED')),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      reviewer_id uuid NOT NULL REFERENCES users(id),
      reviewed_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT document_version_reviews_version_fk FOREIGN KEY (organization_id, version_id) REFERENCES document_versions (organization_id, id)
    )`.execute(db);
  await sql`
    CREATE TABLE document_links (
      document_id uuid NOT NULL,
      organization_id uuid NOT NULL,
      entity_type text NOT NULL CHECK (entity_type IN ('producer','plot','delivery')),
      entity_id uuid NOT NULL,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (document_id, entity_type, entity_id),
      CONSTRAINT document_links_doc_fk FOREIGN KEY (organization_id, document_id) REFERENCES documents (organization_id, id)
    )`.execute(db);
  await sql`
    CREATE FUNCTION document_links_same_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.entity_type = 'producer' AND NOT EXISTS (SELECT 1 FROM producers WHERE id = NEW.entity_id AND organization_id = NEW.organization_id) THEN
        RAISE EXCEPTION 'document_links: productor ajeno';
      ELSIF NEW.entity_type = 'plot' AND NOT EXISTS (SELECT 1 FROM plots WHERE id = NEW.entity_id AND organization_id = NEW.organization_id) THEN
        RAISE EXCEPTION 'document_links: parcela ajena';
      ELSIF NEW.entity_type = 'delivery' THEN
        RAISE EXCEPTION 'document_links: las entregas aún no existen (P0-012)';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER document_links_check BEFORE INSERT ON document_links FOR EACH ROW EXECUTE FUNCTION document_links_same_tenant()`.execute(db);
  for (const table of ['document_versions', 'document_version_scans', 'document_version_reviews', 'document_links']) {
    await sql.raw(`
      CREATE FUNCTION ${table}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION '${table} es append-only'; END $$`).execute(db);
    await sql.raw(`CREATE TRIGGER ${table}_no_mutation BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_append_only()`).execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['document_links', 'document_version_reviews', 'document_version_scans']) {
    await sql.raw(`DROP TABLE ${table}`).execute(db);
    await sql.raw(`DROP FUNCTION ${table}_append_only`).execute(db);
  }
  await sql`DROP FUNCTION document_links_same_tenant`.execute(db);
  await sql`ALTER TABLE documents DROP CONSTRAINT documents_current_version_fk`.execute(db);
  await sql`DROP TABLE document_versions`.execute(db);
  await sql`DROP FUNCTION document_versions_append_only`.execute(db);
  await sql`DROP TABLE documents`.execute(db);
  await sql`DROP FUNCTION documents_owner_same_tenant`.execute(db);
  await sql`DROP FUNCTION documents_no_delete`.execute(db);
  await sql`DROP TABLE document_types`.execute(db);
  await sql`DROP FUNCTION document_types_read_only`.execute(db);
}
