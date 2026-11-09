import { Kysely, sql } from 'kysely';

// P0-005 (RF-05): revisión asistida de posibles duplicados de productor. Detectar NUNCA fusiona ni
// modifica productores: solo abre un caso para el responsable de datos (Data Steward, doc 07).
// Regla documentada: coincidencia de identidad (mismo tipo y número de documento normalizados).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE producer_match_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      producer_a_id uuid NOT NULL,
      producer_b_id uuid NOT NULL,
      rule_code text NOT NULL CHECK (rule_code IN ('IDENTITY_DOCUMENT')),
      status text NOT NULL CHECK (status IN ('PENDING','NOT_DUPLICATE','DUPLICATE_CONFIRMED')),
      detected_at timestamptz NOT NULL DEFAULT now(),
      detected_by uuid NOT NULL REFERENCES users(id),
      resolved_at timestamptz,
      resolved_by uuid REFERENCES users(id),
      resolution_note text,
      row_version bigint NOT NULL DEFAULT 1,
      CONSTRAINT producer_match_pair_ordered CHECK (producer_a_id < producer_b_id),
      CONSTRAINT producer_match_uq UNIQUE (organization_id, producer_a_id, producer_b_id, rule_code),
      CONSTRAINT producer_match_a_fk FOREIGN KEY (organization_id, producer_a_id) REFERENCES producers (organization_id, id),
      CONSTRAINT producer_match_b_fk FOREIGN KEY (organization_id, producer_b_id) REFERENCES producers (organization_id, id),
      CONSTRAINT producer_match_resolution CHECK ((status = 'PENDING') = (resolved_at IS NULL AND resolved_by IS NULL))
    )`.execute(db);
  await sql`CREATE INDEX producer_match_status_idx ON producer_match_reviews (organization_id, status, detected_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE producer_match_reviews`.execute(db);
}
