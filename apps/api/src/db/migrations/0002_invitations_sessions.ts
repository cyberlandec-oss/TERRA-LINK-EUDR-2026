import { Kysely, sql } from 'kysely';

// P0-002: invitaciones de un solo uso (mecanismo provisional sin correo) y versión de sesión.
export async function up(db: Kysely<unknown>): Promise<void> {
  // token_version: va en el JWT; incrementarlo invalida todas las sesiones emitidas.
  await sql`ALTER TABLE users ADD COLUMN token_version integer NOT NULL DEFAULT 0`.execute(db);
  // Aceptar una invitación NO verifica el correo: este campo queda nulo hasta una verificación real.
  await sql`ALTER TABLE users ADD COLUMN email_verified_at timestamptz`.execute(db);
  await sql`ALTER TABLE memberships ADD COLUMN status_reason text`.execute(db);

  await sql`
    CREATE TABLE invitations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      email text NOT NULL CHECK (email = lower(btrim(email))),
      role_code text NOT NULL REFERENCES roles(code) CHECK (role_code <> 'SUPER_ADMIN'),
      token_hash char(64) NOT NULL,
      status text NOT NULL CHECK (status IN ('PENDING','ACCEPTED','REVOKED')),
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid NOT NULL REFERENCES users(id),
      accepted_at timestamptz,
      accepted_by uuid REFERENCES users(id),
      revoked_at timestamptz,
      revoked_by uuid REFERENCES users(id),
      CONSTRAINT invitations_token_hash_uq UNIQUE (token_hash),
      CONSTRAINT invitations_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT invitations_accepted_consistent CHECK ((status = 'ACCEPTED') = (accepted_at IS NOT NULL AND accepted_by IS NOT NULL)),
      CONSTRAINT invitations_revoked_consistent CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
    )`.execute(db);
  // Una sola invitación pendiente por destinatario y organización.
  await sql`CREATE UNIQUE INDEX invitations_pending_uq ON invitations (organization_id, email) WHERE status = 'PENDING'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE invitations`.execute(db);
  await sql`ALTER TABLE memberships DROP COLUMN status_reason`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN email_verified_at`.execute(db);
  await sql`ALTER TABLE users DROP COLUMN token_version`.execute(db);
}
