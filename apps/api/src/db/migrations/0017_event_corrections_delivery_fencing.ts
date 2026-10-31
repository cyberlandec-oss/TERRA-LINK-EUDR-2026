import { Kysely, sql } from 'kysely';

// P0-015 (alcance interno de la organización).
// 1) correction_of: un evento puede declarar que corrige a otro evento EXISTENTE de la MISMA organización
//    y del MISMO agregado (FK compuesta + trigger). Sin autorreferencias; los ciclos son imposibles porque
//    solo se referencia un evento ya insertado y la tabla es append-only. Un evento se corrige UNA vez
//    (índice único): para volver a corregir se corrige la última corrección → cadena lineal y trazable.
//    Motivo obligatorio en toda corrección.
// 2) Entregas del outbox: token de arrendamiento (fencing). Solo quien conserva el token vigente puede
//    confirmar o registrar el fallo; un worker con un arrendamiento anterior no puede confirmar una entrega
//    reclamada después. Historial append-only de intentos. `last_error` deja de guardar mensajes: solo
//    códigos controlados (los mensajes pueden contener valores).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE domain_events ADD CONSTRAINT domain_events_org_event_uq UNIQUE (organization_id, event_id)`.execute(db);
  await sql`ALTER TABLE domain_events ADD COLUMN correction_of_event_id uuid`.execute(db);
  await sql`ALTER TABLE domain_events ADD COLUMN correction_reason text`.execute(db);
  await sql`ALTER TABLE domain_events ADD CONSTRAINT domain_events_correction_fk FOREIGN KEY (organization_id, correction_of_event_id) REFERENCES domain_events (organization_id, event_id)`.execute(db);
  await sql`ALTER TABLE domain_events ADD CONSTRAINT domain_events_correction_not_self CHECK (correction_of_event_id IS DISTINCT FROM event_id)`.execute(db);
  await sql`ALTER TABLE domain_events ADD CONSTRAINT domain_events_correction_reason CHECK ((correction_of_event_id IS NULL) = (correction_reason IS NULL) AND (correction_reason IS NULL OR length(btrim(correction_reason)) BETWEEN 3 AND 500))`.execute(db);
  await sql`CREATE UNIQUE INDEX domain_events_corrected_once ON domain_events (correction_of_event_id) WHERE correction_of_event_id IS NOT NULL`.execute(db);
  await sql`
    CREATE FUNCTION domain_events_correction_same_aggregate() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE o domain_events%ROWTYPE;
    BEGIN
      IF NEW.correction_of_event_id IS NULL THEN RETURN NEW; END IF;
      SELECT * INTO o FROM domain_events WHERE event_id = NEW.correction_of_event_id;
      IF o.organization_id IS DISTINCT FROM NEW.organization_id OR o.aggregate_type IS DISTINCT FROM NEW.aggregate_type
         OR o.aggregate_id IS DISTINCT FROM NEW.aggregate_id THEN
        RAISE EXCEPTION 'correction_of debe referenciar un evento del mismo agregado y organización';
      END IF;
      IF o.aggregate_version >= NEW.aggregate_version THEN
        RAISE EXCEPTION 'una corrección debe ser posterior al evento corregido';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER domain_events_correction_check BEFORE INSERT ON domain_events FOR EACH ROW EXECUTE FUNCTION domain_events_correction_same_aggregate()`.execute(db);

  await sql`ALTER TABLE event_deliveries ADD COLUMN lease_token uuid`.execute(db);
  await sql`ALTER TABLE event_deliveries ADD COLUMN manual_requeues integer NOT NULL DEFAULT 0`.execute(db);
  await sql`UPDATE event_deliveries SET last_error = 'LEGACY_ERROR_REDACTED' WHERE last_error IS NOT NULL`.execute(db);
  await sql`
    CREATE TABLE event_delivery_attempts (
      id bigserial PRIMARY KEY,
      event_id uuid NOT NULL,
      consumer text NOT NULL,
      attempt integer NOT NULL,
      worker_id text,
      lease_token uuid,
      outcome text NOT NULL CHECK (outcome IN ('DONE','DUPLICATE','FAILED','DEAD','LEASE_LOST','MANUAL_REQUEUE')),
      error_code text,
      actor_id uuid REFERENCES users(id),
      reason text,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT event_delivery_attempts_delivery_fk FOREIGN KEY (event_id, consumer) REFERENCES event_deliveries (event_id, consumer)
    )`.execute(db);
  await sql`CREATE INDEX event_delivery_attempts_delivery_idx ON event_delivery_attempts (event_id, consumer, id)`.execute(db);
  await sql`
    CREATE FUNCTION event_delivery_attempts_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'event_delivery_attempts es append-only';
    END $$`.execute(db);
  await sql`CREATE TRIGGER event_delivery_attempts_no_mutation BEFORE UPDATE OR DELETE ON event_delivery_attempts FOR EACH ROW EXECUTE FUNCTION event_delivery_attempts_append_only()`.execute(db);
  // Los recibos de consumidores no se borran nunca (reprocesar no los elimina).
  await sql`
    CREATE FUNCTION consumer_receipts_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'consumer_receipts no admite cambios: garantizan el consumo idempotente';
    END $$`.execute(db);
  await sql`CREATE TRIGGER consumer_receipts_no_mutation BEFORE UPDATE OR DELETE ON consumer_receipts FOR EACH ROW EXECUTE FUNCTION consumer_receipts_no_delete()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER consumer_receipts_no_mutation ON consumer_receipts`.execute(db);
  await sql`DROP FUNCTION consumer_receipts_no_delete`.execute(db);
  await sql`DROP TABLE event_delivery_attempts`.execute(db);
  await sql`DROP FUNCTION event_delivery_attempts_append_only`.execute(db);
  await sql`ALTER TABLE event_deliveries DROP COLUMN manual_requeues`.execute(db);
  await sql`ALTER TABLE event_deliveries DROP COLUMN lease_token`.execute(db);
  await sql`DROP TRIGGER domain_events_correction_check ON domain_events`.execute(db);
  await sql`DROP FUNCTION domain_events_correction_same_aggregate`.execute(db);
  await sql`DROP INDEX domain_events_corrected_once`.execute(db);
  await sql`ALTER TABLE domain_events DROP CONSTRAINT domain_events_correction_reason`.execute(db);
  await sql`ALTER TABLE domain_events DROP CONSTRAINT domain_events_correction_not_self`.execute(db);
  await sql`ALTER TABLE domain_events DROP CONSTRAINT domain_events_correction_fk`.execute(db);
  await sql`ALTER TABLE domain_events DROP COLUMN correction_reason`.execute(db);
  await sql`ALTER TABLE domain_events DROP COLUMN correction_of_event_id`.execute(db);
  await sql`ALTER TABLE domain_events DROP CONSTRAINT domain_events_org_event_uq`.execute(db);
}
