import { Kysely, sql } from 'kysely';

// D-04 — **Corrección dirigida**: la elevación se liga a la SESIÓN que la solicitó, no a la cuenta.
//
// QUÉ SE CORRIGE
// `0047` ligaba la elevación a `users.token_version`. Esa columna es **por cuenta**: permite invalidar todas
// las sesiones a la vez, pero **no distingue dos sesiones simultáneas** del mismo usuario. Comprobado en la
// suite: dos inicios de sesión de la misma cuenta compartían `token_version` —e incluso producían el **mismo
// token**, al no haber nada único en el payload— y la segunda sesión **heredaba** la elevación aprobada para
// la primera. Eso incumple el contrato adoptado («ligada al solicitante y a su sesión»).
//
// CÓMO
// El token lleva ahora un `jti` propio por emisión (`auth.ts`), que el servidor firma y nunca acepta del
// cliente. La elevación guarda ese identificador —**solo el identificador, jamás el token**— y el uso exige
// que coincida con la sesión que presenta la petición.
//
// `session_token_version` **se conserva** como protección adicional: la invalidación global sigue cortando el
// acceso aunque la sesión sea la misma.
//
// Las filas anteriores quedan con `session_id` nulo, y una elevación sin sesión ligada **no sirve**: el caso
// de uso lo exige no nulo. Es el comportamiento seguro ante una fila creada bajo el esquema anterior.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE platform_elevations ADD COLUMN session_id uuid`.execute(db);
  // Aprobada implica sesión ligada: no se activa una elevación sin saber a qué sesión pertenece.
  await sql`ALTER TABLE platform_elevations ADD CONSTRAINT elevations_sesion_al_aprobar
    CHECK (status <> 'APPROVED' OR session_id IS NOT NULL)`.execute(db);
  // Y la sesión, como el resto de los términos, no se edita.
  await sql`
    CREATE OR REPLACE FUNCTION platform_elevation_terminos_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
         OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
         OR NEW.purpose IS DISTINCT FROM OLD.purpose
         OR NEW.reason IS DISTINCT FROM OLD.reason
         OR NEW.scope_note IS DISTINCT FROM OLD.scope_note
         OR NEW.actions IS DISTINCT FROM OLD.actions
         OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
         OR (OLD.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id) THEN
        RAISE EXCEPTION 'D-04: los terminos de una elevacion no se editan; solicita otra';
      END IF;
      IF OLD.status IN ('REJECTED','REVOKED','ENDED','EXPIRED') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'D-04: una elevacion terminada no se reactiva';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION platform_elevation_terminos_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
         OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
         OR NEW.purpose IS DISTINCT FROM OLD.purpose
         OR NEW.reason IS DISTINCT FROM OLD.reason
         OR NEW.scope_note IS DISTINCT FROM OLD.scope_note
         OR NEW.actions IS DISTINCT FROM OLD.actions
         OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds THEN
        RAISE EXCEPTION 'D-04: los terminos de una elevacion no se editan; solicita otra';
      END IF;
      IF OLD.status IN ('REJECTED','REVOKED','ENDED','EXPIRED') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'D-04: una elevacion terminada no se reactiva';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`ALTER TABLE platform_elevations DROP CONSTRAINT elevations_sesion_al_aprobar`.execute(db);
  await sql`ALTER TABLE platform_elevations DROP COLUMN session_id`.execute(db);
}
