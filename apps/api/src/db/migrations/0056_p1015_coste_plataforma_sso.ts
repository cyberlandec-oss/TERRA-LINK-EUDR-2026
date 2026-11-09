import { sql, type Kysely } from 'kysely';

// P1-015 / D-54 — Coste estimado de la plataforma y acceso federado (OIDC).
//
// QUÉ EXIGEN LOS CRITERIOS (literal)
//   · RF-46 (`docs/03:62`): «Español primero y decisiones de coste».
//   · P1-015 (`docs/18:216`): «ADR por componente, español conservado y límites/coste/SSO comprobados».
//
// DECISIONES ADOPTADAS PARA DESARROLLO Y DEMOSTRACIÓN LOCAL (2026-10-20, `docs/22` D-54)
//   · Coste estimado por organización y período explícito, en USD. Es el coste de USO DE LA PLATAFORMA: no es el
//     presupuesto de preparación (P1-010, `budget_parameters`) ni el precio comercial del cacao.
//   · Keycloak autoalojado como proveedor local de ensayo, con Authorization Code + PKCE.
//
// COSTE
//   · `platform_tariffs`: la tarifa es un DATO DECLARADO, versionado y con vigencia. NO hay tarifas precargadas.
//     La versión posterior que cubre una fecha sustituye a la anterior para esa fecha; nada se edita.
//   · `platform_cost_estimates`: cada estimación guarda el consumo observado, las versiones de tarifa usadas y
//     un hash de sus entradas, para poder REPRODUCIR el cálculo. Un mes sin tarifa queda sin precio: no es 0.
//
// SSO
//   · `identity_links`: la identidad externa se vincula por EMISOR + SUJETO. Nunca por correo.
//   · `sso_flows`: estado de un inicio de sesión en curso (state, nonce, verificador PKCE). De un solo uso y con
//     vencimiento corto.
//   · `revoked_sessions`: cierre de sesión por sesión (`jti`), sin invalidar las demás sesiones de la cuenta.

const APPEND_ONLY = ['platform_tariffs', 'platform_cost_estimates'];

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE platform_tariffs (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      code text NOT NULL DEFAULT 'PLATAFORMA' CHECK (length(btrim(code)) BETWEEN 2 AND 60),
      version integer NOT NULL CHECK (version >= 1),
      currency char(3) NOT NULL CHECK (currency = 'USD'),
      -- Unidad adoptada (D-54, decisión 1): la organización, por mes calendario.
      unit text NOT NULL CHECK (unit = 'ORGANIZACION_MES'),
      monthly_fee numeric(14,4) NOT NULL CHECK (monthly_fee >= 0),
      valid_from date NOT NULL,
      -- Fin EXCLUSIVO. NULL = sin fin declarado.
      valid_to date,
      -- Una tarifa sintética (de demostración) se identifica como tal y nunca se confunde con una acordada.
      synthetic boolean NOT NULL,
      label text NOT NULL CHECK (length(btrim(label)) BETWEEN 3 AND 120),
      source text NOT NULL CHECK (length(btrim(source)) BETWEEN 3 AND 500),
      reason text,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT platform_tariff_operation_unique UNIQUE (organization_id, operation_id),
      CONSTRAINT platform_tariff_version_unique UNIQUE (organization_id, code, version),
      CONSTRAINT platform_tariff_range CHECK (valid_to IS NULL OR valid_to > valid_from),
      CONSTRAINT platform_tariff_reason_shape CHECK (
        (version = 1 AND reason IS NULL) OR (version > 1 AND reason IS NOT NULL AND length(btrim(reason)) > 0))
    )`.execute(db);
  await sql`CREATE INDEX platform_tariffs_org_idx ON platform_tariffs (organization_id, code, version DESC)`.execute(db);

  await sql`
    CREATE TABLE platform_cost_estimates (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      period_start date NOT NULL,
      -- Fin EXCLUSIVO: el período es explícito y alineado a meses calendario.
      period_end date NOT NULL,
      status text NOT NULL CHECK (status IN ('ESTIMADO', 'PARCIAL', 'SIN_TARIFA')),
      currency char(3) NOT NULL CHECK (currency = 'USD'),
      -- NULL cuando no hay ningún mes con tarifa: un precio ausente NO es cero.
      total numeric(14,4),
      lines jsonb NOT NULL,
      consumption jsonb NOT NULL,
      pending_concepts jsonb NOT NULL,
      inputs_hash char(64) NOT NULL,
      computed_by uuid NOT NULL REFERENCES users(id),
      computed_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT platform_cost_estimate_operation_unique UNIQUE (organization_id, operation_id),
      CONSTRAINT platform_cost_estimate_period CHECK (period_end > period_start),
      CONSTRAINT platform_cost_estimate_total_shape CHECK (
        (status = 'SIN_TARIFA' AND total IS NULL) OR (status <> 'SIN_TARIFA' AND total IS NOT NULL))
    )`.execute(db);
  await sql`CREATE INDEX platform_cost_estimates_org_idx ON platform_cost_estimates (organization_id, computed_at DESC)`.execute(db);

  for (const t of APPEND_ONLY) {
    await sql.raw(`
      CREATE FUNCTION ${t}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '${t}: append-only; corrige con un registro nuevo';
      END $$`).execute(db);
    await sql.raw(`
      CREATE TRIGGER ${t}_append_only BEFORE UPDATE OR DELETE ON ${t}
      FOR EACH ROW EXECUTE FUNCTION ${t}_append_only()`).execute(db);
  }

  await sql`
    CREATE TABLE identity_links (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
      issuer text NOT NULL,
      subject text NOT NULL,
      -- Informativo: lo que el proveedor declaró al vincular. NUNCA se usa para encontrar ni vincular cuentas.
      email_claim text,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz,
      unlinked_at timestamptz
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX identity_links_active_subject ON identity_links (issuer, subject) WHERE unlinked_at IS NULL`.execute(db);
  await sql`CREATE INDEX identity_links_user_idx ON identity_links (user_id)`.execute(db);

  await sql`
    CREATE TABLE sso_flows (
      -- sha256 del parámetro state: el valor en claro solo vive en el navegador de quien inicia.
      state_hash char(64) PRIMARY KEY,
      mode text NOT NULL CHECK (mode IN ('LOGIN', 'LINK')),
      user_id uuid REFERENCES users(id),
      nonce text NOT NULL,
      code_verifier text NOT NULL,
      redirect_uri text NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT sso_flow_link_needs_user CHECK (mode = 'LOGIN' OR user_id IS NOT NULL)
    )`.execute(db);
  await sql`CREATE INDEX sso_flows_expiry_idx ON sso_flows (expires_at)`.execute(db);

  await sql`
    CREATE TABLE revoked_sessions (
      jti text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
      revoked_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS revoked_sessions`.execute(db);
  await sql`DROP TABLE IF EXISTS sso_flows`.execute(db);
  await sql`DROP TABLE IF EXISTS identity_links`.execute(db);
  for (const t of [...APPEND_ONLY].reverse()) {
    await sql.raw(`DROP TABLE IF EXISTS ${t} CASCADE`).execute(db);
    await sql.raw(`DROP FUNCTION IF EXISTS ${t}_append_only()`).execute(db);
  }
}
