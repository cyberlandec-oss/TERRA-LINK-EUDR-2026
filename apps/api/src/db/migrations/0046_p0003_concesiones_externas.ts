import { Kysely, sql } from 'kysely';

// P0-003 / D-P0003.1 opción A — **Concesiones externas explícitas**, adoptadas como contrato provisional
// local el 2026-10-17. Contrato: `docs/decisiones/P0-003-CONCESIONES-Y-ELEVACION.md`.
//
// QUÉ ES Y QUÉ NO ES
// Una concesión es un acto **del dueño de los datos** que da a una cuenta externa acceso **acotado, vencido y
// revocable** a **instancias concretas**. **No crea membresía, no asigna roles y no habilita acceso general.**
// La vía de acceso del concesionario **no consulta membresías**: consulta la concesión. Por eso una segunda
// membresía nunca es una concesión, ni al revés.
//
// **No se construye el portal comprador** (RF-32 / P1-001). Esto es el control de autorización, no la pantalla.
// **D-04 sigue pendiente**: aquí no hay elevación de plataforma, ni implícita ni explícita. SUPER_ADMIN no gana
// nada con esta migración, y el rol BUYER sigue sin permisos.
//
// GARANTÍAS EN LA BASE
// - La concesión apunta a un recurso **de la organización concedente**: lo comprueba un disparador, porque
//   depende de otra tabla según el tipo y una FK no puede expresarlo.
// - **Vencimiento obligatorio** (`expires_at NOT NULL`, posterior a la creación): no existe «indefinida».
// - **Los términos no se editan**: destinatario, recurso, acciones y vencimiento son inmutables. Lo único que
//   cambia es la revocación. Así una concesión no se convierte en otra por la puerta de atrás.
// - **Una sola concesión activa** por (organización, destinatario, tipo, recurso): índice único parcial.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE access_grants (
      id               uuid PRIMARY KEY,
      organization_id  uuid NOT NULL REFERENCES organizations(id),
      grantee_user_id  uuid NOT NULL REFERENCES users(id),
      resource_type    text NOT NULL CHECK (resource_type IN ('LOT','SHIPMENT','DD_SNAPSHOT')),
      resource_id      uuid NOT NULL,
      can_read         boolean NOT NULL DEFAULT true,
      can_download     boolean NOT NULL DEFAULT false,
      expires_at       timestamptz NOT NULL,
      reason           text NOT NULL,
      granted_by       uuid NOT NULL REFERENCES users(id),
      operation_id     uuid NOT NULL,
      created_at       timestamptz NOT NULL DEFAULT now(),
      revoked_at       timestamptz,
      revoked_by       uuid REFERENCES users(id),
      revoke_reason    text,
      -- Una concesión sin ninguna acción no concede nada: no se admite.
      CONSTRAINT access_grants_alguna_accion CHECK (can_read OR can_download),
      -- Vencimiento obligatorio y posterior a la creación: nunca «indefinida».
      CONSTRAINT access_grants_vencimiento CHECK (expires_at > created_at),
      -- La revocación es completa o no es: momento, quién y motivo van juntos.
      CONSTRAINT access_grants_revocacion CHECK (
        (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR
        (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL)),
      CONSTRAINT access_grants_operacion_uq UNIQUE (organization_id, operation_id)
    )`.execute(db);

  // Una sola concesión ACTIVA por destinatario y recurso. Las revocadas se conservan como historial.
  await sql`
    CREATE UNIQUE INDEX access_grants_activa_uq ON access_grants (organization_id, grantee_user_id, resource_type, resource_id)
    WHERE revoked_at IS NULL`.execute(db);
  await sql`CREATE INDEX access_grants_destinatario_idx ON access_grants (grantee_user_id) WHERE revoked_at IS NULL`.execute(db);

  // El recurso tiene que ser de la organización concedente. Nadie concede lo que no es suyo.
  await sql`
    CREATE FUNCTION access_grant_recurso_de_la_organizacion() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE ok boolean;
    BEGIN
      IF NEW.resource_type = 'LOT' THEN
        SELECT EXISTS (SELECT 1 FROM lots WHERE id = NEW.resource_id AND organization_id = NEW.organization_id) INTO ok;
      ELSIF NEW.resource_type = 'SHIPMENT' THEN
        SELECT EXISTS (SELECT 1 FROM shipments WHERE id = NEW.resource_id AND organization_id = NEW.organization_id) INTO ok;
      ELSE
        SELECT EXISTS (SELECT 1 FROM dd_snapshots WHERE id = NEW.resource_id AND organization_id = NEW.organization_id) INTO ok;
      END IF;
      IF NOT ok THEN
        RAISE EXCEPTION 'P0-003: el recurso concedido no pertenece a la organizacion concedente';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`
    CREATE CONSTRAINT TRIGGER access_grants_recurso_propio AFTER INSERT ON access_grants
    DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION access_grant_recurso_de_la_organizacion()`.execute(db);

  // Los términos son inmutables: lo único que puede cambiar es la revocación, y una vez revocada no vuelve.
  await sql`
    CREATE FUNCTION access_grant_terminos_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
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
  await sql`
    CREATE TRIGGER access_grants_inmutable BEFORE UPDATE ON access_grants
    FOR EACH ROW EXECUTE FUNCTION access_grant_terminos_inmutables()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER access_grants_inmutable ON access_grants`.execute(db);
  await sql`DROP FUNCTION access_grant_terminos_inmutables`.execute(db);
  await sql`DROP TRIGGER access_grants_recurso_propio ON access_grants`.execute(db);
  await sql`DROP FUNCTION access_grant_recurso_de_la_organizacion`.execute(db);
  await sql`DROP TABLE access_grants`.execute(db);
}
