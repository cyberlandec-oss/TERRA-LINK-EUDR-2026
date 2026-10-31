import { sql, type Kysely } from 'kysely';

// Compartir los SOPORTES de una instantánea de diligencia con el destinatario de una concesión.
//
// - `include_documents` es explícito y desactivado por defecto: las concesiones existentes conservan exactamente su alcance anterior (proyección sin archivos).
// - Solo aplica a una instantánea (`DD_SNAPSHOT`) y exige poder leer: no existe una concesión «solo de archivos» sobre un lote o un embarque.
// - Es un TÉRMINO de la concesión: no se edita (se revoca y se concede otra), igual que el recurso, la lectura, la descarga y el vencimiento.
// Lo que se entrega lo decide el servicio: solo las versiones que la propia instantánea referencia, sin documentos de datos personales.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE access_grants ADD COLUMN include_documents boolean NOT NULL DEFAULT false`.execute(db);
  await sql`
    ALTER TABLE access_grants ADD CONSTRAINT access_grants_soportes_solo_instantanea
    CHECK (NOT include_documents OR (resource_type = 'DD_SNAPSHOT' AND can_read))`.execute(db);
  await sql`
    CREATE OR REPLACE FUNCTION access_grant_terminos_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
         OR NEW.grantee_user_id IS DISTINCT FROM OLD.grantee_user_id
         OR NEW.resource_type IS DISTINCT FROM OLD.resource_type
         OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
         OR NEW.can_read IS DISTINCT FROM OLD.can_read
         OR NEW.can_download IS DISTINCT FROM OLD.can_download
         OR NEW.include_documents IS DISTINCT FROM OLD.include_documents
         OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
         OR NEW.granted_by IS DISTINCT FROM OLD.granted_by THEN
        RAISE EXCEPTION 'P0-003: los terminos de una concesion no se editan; revoca y concede otra';
      END IF;
      IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
        RAISE EXCEPTION 'P0-003: una concesion revocada no se reactiva';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION access_grant_terminos_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
         OR NEW.grantee_user_id IS DISTINCT FROM OLD.grantee_user_id
         OR NEW.resource_type IS DISTINCT FROM OLD.resource_type
         OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
         OR NEW.can_read IS DISTINCT FROM OLD.can_read
         OR NEW.can_download IS DISTINCT FROM OLD.can_download
         OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
         OR NEW.granted_by IS DISTINCT FROM OLD.granted_by THEN
        RAISE EXCEPTION 'P0-003: los terminos de una concesion no se editan; revoca y concede otra';
      END IF;
      IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
        RAISE EXCEPTION 'P0-003: una concesion revocada no se reactiva';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`ALTER TABLE access_grants DROP CONSTRAINT access_grants_soportes_solo_instantanea`.execute(db);
  await sql`ALTER TABLE access_grants DROP COLUMN include_documents`.execute(db);
}
