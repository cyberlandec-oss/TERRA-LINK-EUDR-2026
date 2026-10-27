import { sql, type Kysely } from 'kysely';

// P1-006 — Intercambio con GUIA/Agrocalidad (RF-37; S2 §29; S3 §§14, 19; docs/15).
//
// LO QUE LA FUENTE PIDE, Y LO QUE NO EXISTE
// S3 §14 dice que GUIA **no es un competidor sino infraestructura**, y §19 que la plataforma debería
// «importar / sincronizar los datos que ya existen» en vez de pedirlos otra vez. Pero **RF-37 condiciona**:
// «**solo canal/acuerdo comprobados**», y `docs/15` registra la integración como **PROPUESTA**, con la
// condición «acuerdo/canal oficial o formato autorizado; **no asumir API disponible**».
//
// Hoy **no hay canal, ni acuerdo, ni formato oficial en mano**. Por eso aquí NO se implementa ninguna llamada
// de red: el intercambio es **por archivo**, que es el *fallback* que pide la historia, y está **cerrado tras
// una compuerta**:
//   · la organización **registra** el acuerdo, con su referencia, alcance, vigencia y evidencia;
//   · **solo la administración de plataforma lo verifica**, porque una organización no puede certificar su
//     propio canal;
//   · sin acuerdo **verificado y vigente**, no se exporta ni se concilia nada.
//
// APPEND-ONLY
// Las decisiones sobre el acuerdo y sobre cada diferencia son **filas**, no estados que se sobrescriban.
// Conciliar **no escribe** en los datos operativos: produce diferencias y decisiones con su procedencia; lo
// que haya que cambiar se cambia por el caso de uso del dominio, auditado como cualquier otra corrección.

const APPEND_ONLY = ['exchange_agreements', 'exchange_agreement_decisions', 'exchange_acts',
  'exchange_differences', 'exchange_difference_decisions'];

export async function up(db: Kysely<unknown>): Promise<void> {
  // ---------------------------------------------------------------- acuerdo de intercambio
  await sql`
    CREATE TABLE exchange_agreements (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      -- La contraparte es un valor cerrado: no se abre un canal escribiendo un nombre nuevo.
      counterpart text NOT NULL CHECK (counterpart IN ('GUIA_AGROCALIDAD')),
      reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 3 AND 200),
      -- Qué se intercambia, declarado por quien firma. No lo decide el software.
      scope text NOT NULL CHECK (length(btrim(scope)) BETWEEN 3 AND 1000),
      valid_from date NOT NULL,
      valid_to date,
      -- Evidencia documental del acuerdo, si se aportó: versión concreta, no «un documento».
      document_version_id uuid REFERENCES document_versions(id),
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT exchange_agreements_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT exchange_agreements_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT exchange_agreements_vigencia CHECK (valid_to IS NULL OR valid_to >= valid_from)
    )`.execute(db);

  // Decisiones sobre el acuerdo. VERIFY la toma la PLATAFORMA; WITHDRAW puede tomarla la organización.
  await sql`
    CREATE TABLE exchange_agreement_decisions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      agreement_id uuid NOT NULL,
      decision text NOT NULL CHECK (decision IN ('VERIFY','WITHDRAW')),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      decided_by uuid NOT NULL REFERENCES users(id),
      decided_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT exchange_agreement_decisions_fk FOREIGN KEY (organization_id, agreement_id) REFERENCES exchange_agreements(organization_id, id),
      CONSTRAINT exchange_agreement_decisions_operation_uq UNIQUE (organization_id, operation_id)
    )`.execute(db);
  await sql`CREATE INDEX exchange_agreement_decisions_idx ON exchange_agreement_decisions (agreement_id, decided_at DESC)`.execute(db);

  // ---------------------------------------------------------------- registro de actos (el LOG)
  await sql`
    CREATE TABLE exchange_acts (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      agreement_id uuid NOT NULL,
      kind text NOT NULL CHECK (kind IN ('EXPORT','RECONCILE')),
      -- Versión del formato con que se hizo el acto: un formato futuro no reescribe el pasado.
      format_version text NOT NULL,
      row_count integer NOT NULL CHECK (row_count >= 0),
      -- Huella del contenido intercambiado, para poder reconocer el mismo archivo más tarde.
      content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
      summary jsonb NOT NULL,
      performed_by uuid NOT NULL REFERENCES users(id),
      performed_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT exchange_acts_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT exchange_acts_agreement_fk FOREIGN KEY (organization_id, agreement_id) REFERENCES exchange_agreements(organization_id, id),
      CONSTRAINT exchange_acts_operation_uq UNIQUE (organization_id, operation_id)
    )`.execute(db);
  await sql`CREATE INDEX exchange_acts_org_idx ON exchange_acts (organization_id, performed_at DESC)`.execute(db);

  // ---------------------------------------------------------------- diferencias de una conciliación
  await sql`
    CREATE TABLE exchange_differences (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      act_id uuid NOT NULL,
      -- Clave con que la contraparte identifica al operador. Puede no corresponder a nada nuestro.
      external_key text NOT NULL CHECK (length(btrim(external_key)) BETWEEN 1 AND 200),
      entity_type text NOT NULL CHECK (entity_type IN ('PRODUCER')),
      entity_id uuid,
      kind text NOT NULL CHECK (kind IN ('ONLY_EXTERNAL','ONLY_OURS','FIELD_DIFFERS')),
      field text,
      external_value text,
      our_value text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT exchange_differences_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT exchange_differences_act_fk FOREIGN KEY (organization_id, act_id) REFERENCES exchange_acts(organization_id, id),
      -- Una diferencia de campo nombra el campo y los dos valores; las otras dos clases, no.
      CONSTRAINT exchange_differences_forma CHECK (
        (kind = 'FIELD_DIFFERS' AND field IS NOT NULL AND entity_id IS NOT NULL)
        OR (kind = 'ONLY_EXTERNAL' AND entity_id IS NULL)
        OR (kind = 'ONLY_OURS' AND entity_id IS NOT NULL))
    )`.execute(db);
  await sql`CREATE INDEX exchange_differences_act_idx ON exchange_differences (act_id)`.execute(db);

  // Resolución de cada diferencia. ACEPTAR lo externo **no escribe** el dato: deja constancia de que hay que
  // corregirlo por el caso de uso del dominio, con su procedencia.
  await sql`
    CREATE TABLE exchange_difference_decisions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      difference_id uuid NOT NULL,
      decision text NOT NULL CHECK (decision IN ('ACCEPT_EXTERNAL','KEEP_OURS','NEEDS_REVIEW')),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      decided_by uuid NOT NULL REFERENCES users(id),
      decided_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT exchange_difference_decisions_fk FOREIGN KEY (organization_id, difference_id) REFERENCES exchange_differences(organization_id, id),
      CONSTRAINT exchange_difference_decisions_operation_uq UNIQUE (organization_id, operation_id)
    )`.execute(db);
  await sql`CREATE INDEX exchange_difference_decisions_idx ON exchange_difference_decisions (difference_id, decided_at DESC)`.execute(db);

  // ---------------------------------------------------------------- append-only, impuesto por la base
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
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of [...APPEND_ONLY].reverse()) {
    await sql.raw(`DROP TABLE IF EXISTS ${t} CASCADE`).execute(db);
    await sql.raw(`DROP FUNCTION IF EXISTS ${t}_append_only()`).execute(db);
  }
}
