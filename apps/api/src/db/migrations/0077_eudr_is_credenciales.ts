import { sql, type Kysely } from 'kysely';

// P1-007 — Conector EUDR-IS (TRACES NT): credenciales por organización Y ENTORNO, y registro de las comprobaciones de conexión (servicio Echo).
// - Las credenciales del servicio web son tres: usuario, Authentication Key y WebServiceClientId. Se CIFRAN (AES-256-GCM, el mismo mecanismo de datos personales) con
//   un contexto `eudr_is_credentials:{organización}:{entorno}:{campo}`: no sirven para otra organización, otro entorno ni otro campo. Nunca se devuelven ni se registran.
// - ACCEPTANCE y PRODUCTION son filas distintas y no se reutilizan entre sí. Registrar una credencial no activa llamadas: eso depende del interruptor EUDR_IS_LIVE_CALLS.
// - `eudr_is_echo_checks` es evidencia de solo añadir: acredita transporte y autenticación, NO el operador representado ni una presentación de DDS.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE eudr_is_credentials (
      organization_id        uuid NOT NULL REFERENCES organizations(id),
      environment            text NOT NULL CHECK (environment IN ('ACCEPTANCE', 'PRODUCTION')),
      username_ciphertext    text NOT NULL,
      auth_key_ciphertext    text NOT NULL,
      client_id_ciphertext   text NOT NULL,
      registered_via         text NOT NULL CHECK (registered_via IN ('API', 'CLI')),
      created_by             uuid REFERENCES users(id),
      created_at             timestamptz NOT NULL DEFAULT now(),
      rotated_at             timestamptz,
      PRIMARY KEY (organization_id, environment)
    )`.execute(db);
  await sql`
    CREATE TABLE eudr_is_echo_checks (
      id               uuid PRIMARY KEY,
      organization_id  uuid NOT NULL REFERENCES organizations(id),
      environment      text NOT NULL CHECK (environment IN ('ACCEPTANCE', 'PRODUCTION')),
      outcome          text NOT NULL CHECK (outcome IN ('OK', 'AUTH_FAILED', 'FAULT', 'UNEXPECTED_RESPONSE', 'UNREACHABLE')),
      http_status      integer,
      detail           text,
      requested_by     uuid REFERENCES users(id),
      checked_at       timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX eudr_is_echo_checks_idx ON eudr_is_echo_checks (organization_id, environment, checked_at DESC)`.execute(db);
  await sql`
    CREATE FUNCTION eudr_is_echo_checks_solo_agregar() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'las comprobaciones de conexion EUDR-IS solo se agregan';
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER eudr_is_echo_checks_append_only BEFORE UPDATE OR DELETE ON eudr_is_echo_checks
    FOR EACH ROW EXECUTE FUNCTION eudr_is_echo_checks_solo_agregar()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE eudr_is_echo_checks`.execute(db);
  await sql`DROP FUNCTION eudr_is_echo_checks_solo_agregar()`.execute(db);
  await sql`DROP TABLE eudr_is_credentials`.execute(db);
}
