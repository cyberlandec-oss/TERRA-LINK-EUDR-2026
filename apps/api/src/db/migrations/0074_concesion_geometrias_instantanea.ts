import { sql, type Kysely } from 'kysely';

// Compartir las GEOMETRÍAS de las parcelas de origen de una instantánea con el destinatario de una concesión (decisión del propietario, 2026-10-30).
//
// - `include_geometries` es explícito, desactivado por defecto e INDEPENDIENTE de `include_documents`: compartir soportes no comparte polígonos ni al revés.
//   Las concesiones existentes conservan exactamente su alcance (sin geometrías).
// - Solo aplica a una instantánea (`DD_SNAPSHOT`) y exige poder leer.
// - Es un TÉRMINO de la concesión: no se edita (se revoca y se concede otra).
// Lo que se entrega lo decide el servicio: solo las geometrías que la propia instantánea fijó (por versión de parcela y huella), sin identidad del productor.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE access_grants ADD COLUMN include_geometries boolean NOT NULL DEFAULT false`.execute(db);
  await sql`
    ALTER TABLE access_grants ADD CONSTRAINT access_grants_geometrias_solo_instantanea
    CHECK (NOT include_geometries OR (resource_type = 'DD_SNAPSHOT' AND can_read))`.execute(db);
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
         OR NEW.include_geometries IS DISTINCT FROM OLD.include_geometries
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
  await sql`ALTER TABLE access_grants DROP CONSTRAINT access_grants_geometrias_solo_instantanea`.execute(db);
  await sql`ALTER TABLE access_grants DROP COLUMN include_geometries`.execute(db);
}
