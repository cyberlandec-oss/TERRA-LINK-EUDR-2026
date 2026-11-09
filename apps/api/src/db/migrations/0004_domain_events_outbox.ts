import { Kysely, sql } from 'kysely';

// TECH-001 / ADR-0003: eventos de dominio inmutables + outbox transaccional por consumidor.
// Entrega AL MENOS UNA VEZ; el consumo es idempotente mediante consumer_receipts.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE domain_events (
      event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES organizations(id),
      event_type text NOT NULL CHECK (event_type ~ '^[A-Z][A-Za-z]+$'),
      schema_version integer NOT NULL CHECK (schema_version > 0),
      aggregate_type text NOT NULL CHECK (aggregate_type ~ '^[A-Z_]+$'),
      aggregate_id uuid NOT NULL,
      aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
      actor_id uuid REFERENCES users(id),
      occurred_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      correlation_id text,
      causation_id text,
      operation_id text,
      payload jsonb NOT NULL,
      CONSTRAINT domain_events_aggregate_version_uq UNIQUE (organization_id, aggregate_type, aggregate_id, aggregate_version)
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX domain_events_operation_uq ON domain_events (organization_id, operation_id) WHERE operation_id IS NOT NULL`.execute(db);
  await sql`CREATE INDEX domain_events_aggregate_idx ON domain_events (organization_id, aggregate_type, aggregate_id, aggregate_version)`.execute(db);
  await sql`
    CREATE FUNCTION domain_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'domain_events es append-only';
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER domain_events_no_mutation BEFORE UPDATE OR DELETE ON domain_events
    FOR EACH ROW EXECUTE FUNCTION domain_events_append_only()`.execute(db);

  await sql`
    CREATE TABLE event_deliveries (
      event_id uuid NOT NULL REFERENCES domain_events(event_id),
      consumer text NOT NULL,
      status text NOT NULL CHECK (status IN ('PENDING','PROCESSING','FAILED','DONE','DEAD')),
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      locked_by text,
      locked_until timestamptz,
      last_error text,
      delivered_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (event_id, consumer)
    )`.execute(db);
  await sql`CREATE INDEX event_deliveries_due_idx ON event_deliveries (next_attempt_at) WHERE status IN ('PENDING','FAILED','PROCESSING')`.execute(db);

  await sql`
    CREATE TABLE consumer_receipts (
      consumer text NOT NULL,
      event_id uuid NOT NULL REFERENCES domain_events(event_id),
      processed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (consumer, event_id)
    )`.execute(db);

  // Proyección de ejemplo y uso real: conteo de eventos por organización y tipo (métricas operativas).
  await sql`
    CREATE TABLE organization_event_stats (
      organization_id uuid NOT NULL REFERENCES organizations(id),
      event_type text NOT NULL,
      event_count bigint NOT NULL DEFAULT 0,
      last_event_at timestamptz NOT NULL,
      PRIMARY KEY (organization_id, event_type)
    )`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE organization_event_stats`.execute(db);
  await sql`DROP TABLE consumer_receipts`.execute(db);
  await sql`DROP TABLE event_deliveries`.execute(db);
  await sql`DROP TABLE domain_events`.execute(db);
  await sql`DROP FUNCTION domain_events_append_only`.execute(db);
}
