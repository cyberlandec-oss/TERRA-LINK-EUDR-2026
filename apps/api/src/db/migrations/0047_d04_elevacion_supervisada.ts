import { Kysely, sql } from 'kysely';

// D-04 — **Elevación de plataforma supervisada**, adoptada como política provisional local el 2026-10-17.
// Contrato: `docs/decisiones/P0-003-CONCESIONES-Y-ELEVACION.md`.
//
// QUÉ ES
// Un acceso **excepcional, temporal y aprobado por la organización afectada** para que SUPER_ADMIN pueda dar
// soporte sin ser miembro. **No es una concesión**: una concesión la otorga el dueño sobre datos propios y da
// acceso a un recurso concreto; una elevación la pide la plataforma, la aprueba un tercero de la organización
// y caduca sola. Son mecanismos separados y se prueban por separado.
//
// LAS CUATRO RESPUESTAS QUE D-04 EXIGÍA
//   1. Quién eleva y con qué aprobación → la pide SUPER_ADMIN (con contraseña reciente) y la aprueba un
//      **ORG_ADMIN activo y distinto** de la organización afectada. **Sin autoaprobación ni excepción de
//      emergencia.**
//   2. Motivo y duración máxima → finalidad, motivo y ámbito obligatorios; **15 minutos** como máximo desde la
//      activación, con la hora del servidor.
//   3. Alcance → **solo lectura**, y solo las acciones de un catálogo cerrado. No existe «acceso total».
//   4. Notificación y auditoría → la organización ve sus solicitudes y accesos; se auditan solicitud,
//      aprobación o rechazo, activación, uso, revocación y fin.
//
// Los 15 minutos y este perfil son **decisiones de diseño para el MVP local**, no obligaciones deducidas de las
// fuentes.
//
// CATÁLOGO CERRADO DE ACCIONES
// `members:read` es la **única** acción, y es la diferencia concreta que hubo que presentar: el perfil
// propuesto no nombraba ninguna, y el único punto de LECTURA que hoy responde `ELEVATION_REQUIRED` es el
// listado de miembros (`members.ts`). Sin ella la elevación no habilitaría nada y el criterio
// «superadmin/elevación» no podría demostrarse. Las dos escrituras de ese archivo —cambiar membresía y cambiar
// roles— **siguen bloqueadas**, como pide el perfil.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE platform_elevations (
      id                  uuid PRIMARY KEY,
      organization_id     uuid NOT NULL REFERENCES organizations(id),
      requested_by        uuid NOT NULL REFERENCES users(id),
      purpose             text NOT NULL,
      reason              text NOT NULL,
      scope_note          text NOT NULL,
      actions             text[] NOT NULL,
      duration_seconds    integer NOT NULL,
      -- Sesión del solicitante: la versión de su token al activar. Cerrar sesión, desactivar la cuenta o
      -- invalidar sesiones cambia esa versión y la elevación deja de aplicar.
      session_token_version integer,
      status              text NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','REVOKED','ENDED','EXPIRED')),
      approved_by         uuid REFERENCES users(id),
      approved_at         timestamptz,
      expires_at          timestamptz,
      rejected_at         timestamptz,
      reject_reason       text,
      revoked_at          timestamptz,
      revoked_by          uuid REFERENCES users(id),
      revoke_reason       text,
      ended_at            timestamptz,
      operation_id        uuid NOT NULL,
      created_at          timestamptz NOT NULL DEFAULT now(),
      -- Duración acotada: entre un minuto y QUINCE MINUTOS. No hay elevación larga ni indefinida.
      CONSTRAINT elevations_duracion CHECK (duration_seconds BETWEEN 60 AND 900),
      -- **Sin autoaprobación**: quien aprueba nunca es quien solicita.
      CONSTRAINT elevations_sin_autoaprobacion CHECK (approved_by IS NULL OR approved_by <> requested_by),
      -- Solo acciones del catálogo cerrado, y al menos una.
      CONSTRAINT elevations_acciones CHECK (cardinality(actions) > 0 AND actions <@ ARRAY['members:read']::text[]),
      -- Aprobada implica aprobador, momento, vencimiento y sesión ligada.
      CONSTRAINT elevations_aprobacion CHECK (
        (status <> 'APPROVED') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND expires_at IS NOT NULL AND session_token_version IS NOT NULL)),
      CONSTRAINT elevations_rechazo CHECK ((status <> 'REJECTED') OR (rejected_at IS NOT NULL AND reject_reason IS NOT NULL)),
      CONSTRAINT elevations_revocacion CHECK ((status <> 'REVOKED') OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL)),
      CONSTRAINT elevations_operacion_uq UNIQUE (organization_id, operation_id)
    )`.execute(db);

  // Una sola elevación viva (pendiente o aprobada) por solicitante y organización: no se acumulan.
  await sql`
    CREATE UNIQUE INDEX platform_elevations_viva_uq ON platform_elevations (organization_id, requested_by)
    WHERE status IN ('PENDING','APPROVED')`.execute(db);
  await sql`CREATE INDEX platform_elevations_org_idx ON platform_elevations (organization_id, created_at DESC)`.execute(db);

  // Los términos de la solicitud no se editan: ni organización, ni solicitante, ni alcance, ni acciones, ni
  // duración. Lo que cambia es el estado. Y un estado final no vuelve atrás.
  await sql`
    CREATE FUNCTION platform_elevation_terminos_inmutables() RETURNS trigger LANGUAGE plpgsql AS $$
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
  await sql`
    CREATE TRIGGER platform_elevations_inmutable BEFORE UPDATE ON platform_elevations
    FOR EACH ROW EXECUTE FUNCTION platform_elevation_terminos_inmutables()`.execute(db);

  // El aprobador tiene que ser ORG_ADMIN ACTIVO de la organización afectada. Depende de tres tablas, así que
  // no cabe en un CHECK: va en un disparador de restricción.
  await sql`
    CREATE FUNCTION platform_elevation_aprobador_valido() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE ok boolean;
    BEGIN
      IF NEW.approved_by IS NULL THEN RETURN NEW; END IF;
      SELECT EXISTS (
        SELECT 1 FROM memberships m
        JOIN role_assignments ra ON ra.membership_id = m.id AND ra.organization_id = m.organization_id
        JOIN users u ON u.id = m.user_id
        WHERE m.user_id = NEW.approved_by AND m.organization_id = NEW.organization_id
          AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND ra.role_code = 'ORG_ADMIN'
      ) INTO ok;
      IF NOT ok THEN
        RAISE EXCEPTION 'D-04: solo un ORG_ADMIN activo de la organizacion afectada puede aprobar';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`
    CREATE CONSTRAINT TRIGGER platform_elevations_aprobador AFTER INSERT OR UPDATE OF approved_by ON platform_elevations
    DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION platform_elevation_aprobador_valido()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER platform_elevations_aprobador ON platform_elevations`.execute(db);
  await sql`DROP FUNCTION platform_elevation_aprobador_valido`.execute(db);
  await sql`DROP TRIGGER platform_elevations_inmutable ON platform_elevations`.execute(db);
  await sql`DROP FUNCTION platform_elevation_terminos_inmutables`.execute(db);
  await sql`DROP TABLE platform_elevations`.execute(db);
}
