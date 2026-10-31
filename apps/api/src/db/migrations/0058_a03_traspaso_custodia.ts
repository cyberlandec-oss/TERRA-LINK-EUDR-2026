import { Kysely, sql } from 'kysely';

// A-03 (ampliación autorizada 2026-10-21, RF-50) — Traspaso de CUSTODIA FÍSICA entre organizaciones. Contrato: docs/decisiones/A03-TRASPASO-ENTRE-ORGANIZACIONES.md.
//
// Decisiones adoptadas que este esquema respeta:
//   D1(b) custodia física; D6(a) vínculo bilateral confirmado; D7(a) sin compraventa ni propiedad; D8(a) misma unidad (KG);
//   D9(b) cada parte ve el estado del traspaso y sus diferencias, no el inventario ajeno; D3(b) solo una PROYECCIÓN técnica inmutable del
//   origen (el lote de la receptora nace con origen INCOMPLETO y la base impide marcarlo COMPLETO); D5(a) toda diferencia exige motivo.
// D2 sigue pendiente de revisión competente y D4 NO está adoptada: este esquema no hereda expediente, severidad ni conclusión, y la salida
// real se decide en el servicio con una compuerta que hoy bloquea.
//
// Ningún `organization_id` cambia ni se copia inventario: cada cantidad se mueve por movimientos del ledger de su organización.
// El TRÁNSITO no es un saldo de ninguna organización: se deriva de los pasos (append-only) del propio traspaso.
export async function up(db: Kysely<unknown>): Promise<void> {
  // ---- ledger: nuevos tipos de movimiento (reserva, salida, entrada y retorno de custodia)
  await sql`ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check`.execute(db);
  await sql`ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN ('RECEPTION_IN','RECEPTION_CORRECTION','LOT_ASSIGN','LOT_RELEASE','PROCESS_RESERVE','PROCESS_RESERVE_RELEASE','PROCESS_CLOSE','STOCK_LOSS','TRANSFER','LOCATION_ASSIGN','ADJUSTMENT','SHIPMENT_RESERVE','SHIPMENT_RESERVE_RELEASE','SHIPMENT_DISPATCH','CUSTODY_RESERVE','CUSTODY_RESERVE_RELEASE','CUSTODY_OUT','CUSTODY_IN','CUSTODY_RETURN'))`.execute(db);

  // ---- lotes: el lote que nace de un traspaso. Sin entradas de recepción, sin proceso, cerrado a entradas y SIEMPRE con origen incompleto.
  await sql`ALTER TABLE lots DROP CONSTRAINT lots_source_check`.execute(db);
  await sql`ALTER TABLE lots ADD CONSTRAINT lots_source_check CHECK (source IN ('RECEPTIONS','PROCESS_OUTPUT','CUSTODY_TRANSFER'))`.execute(db);
  await sql`ALTER TABLE lots DROP CONSTRAINT lots_source_shape`.execute(db);
  await sql`ALTER TABLE lots ADD CONSTRAINT lots_source_shape CHECK ((source = 'RECEPTIONS' AND process_run_id IS NULL AND output_quantity IS NULL)
    OR (source = 'PROCESS_OUTPUT' AND process_run_id IS NOT NULL AND output_quantity IS NOT NULL AND status = 'CLOSED_FOR_INPUT')
    OR (source = 'CUSTODY_TRANSFER' AND process_run_id IS NULL AND output_quantity IS NULL AND status = 'CLOSED_FOR_INPUT' AND origin_status = 'INCOMPLETE'))`.execute(db);
  // La cantidad de un lote de custodia no viene de recepciones ni de proceso: llega solo por movimientos CUSTODY_IN del ledger.
  await sql`
    CREATE OR REPLACE FUNCTION lot_base_quantity(lid uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
      SELECT CASE WHEN l.source = 'PROCESS_OUTPUT' THEN l.output_quantity
                  WHEN l.source = 'CUSTODY_TRANSFER' THEN 0
             ELSE coalesce((SELECT sum(i.quantity) FROM lot_inputs i WHERE i.lot_id = l.id AND NOT EXISTS (SELECT 1 FROM lot_input_releases x WHERE x.input_id = i.id)), 0) END
      FROM lots l WHERE l.id = lid
    $$`.execute(db);

  // ---- vínculo bilateral entre organizaciones (D6a)
  await sql`
    CREATE TABLE org_partnerships (
      id uuid PRIMARY KEY,
      requester_org_id uuid NOT NULL REFERENCES organizations(id),
      counterpart_org_id uuid REFERENCES organizations(id),
      code_hash text NOT NULL,
      status text NOT NULL CHECK (status IN ('PENDING','ACTIVE','REVOKED')),
      expires_at timestamptz NOT NULL,
      created_by uuid NOT NULL REFERENCES users(id),
      confirmed_by uuid REFERENCES users(id),
      confirmed_at timestamptz,
      revoked_by uuid REFERENCES users(id),
      revoked_by_org uuid REFERENCES organizations(id),
      revoked_at timestamptz,
      revoke_reason text CHECK (revoke_reason IS NULL OR length(btrim(revoke_reason)) BETWEEN 3 AND 500),
      operation_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT org_partnerships_distinct CHECK (counterpart_org_id IS NULL OR counterpart_org_id <> requester_org_id),
      CONSTRAINT org_partnerships_shape CHECK (
        (status = 'PENDING' AND counterpart_org_id IS NULL AND revoked_at IS NULL)
        OR (status = 'ACTIVE' AND counterpart_org_id IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND revoked_at IS NULL)
        OR (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)),
      CONSTRAINT org_partnerships_operation_uq UNIQUE (requester_org_id, operation_id),
      CONSTRAINT org_partnerships_code_uq UNIQUE (code_hash)
    )`.execute(db);
  // Un solo vínculo ACTIVO por pareja de organizaciones, sin importar quién lo propuso.
  await sql`CREATE UNIQUE INDEX org_partnerships_active_pair_uq ON org_partnerships (LEAST(requester_org_id, counterpart_org_id), GREATEST(requester_org_id, counterpart_org_id)) WHERE status = 'ACTIVE'`.execute(db);

  // ---- traspasos
  await sql`
    CREATE TABLE custody_transfers (
      id uuid PRIMARY KEY,
      transfer_code text NOT NULL,
      partnership_id uuid NOT NULL REFERENCES org_partnerships(id),
      sender_org_id uuid NOT NULL REFERENCES organizations(id),
      receiver_org_id uuid NOT NULL REFERENCES organizations(id),
      status text NOT NULL CHECK (status IN ('OFFERED','ACCEPTED','IN_TRANSIT','WITH_DISCREPANCY','CLOSED','REJECTED','CANCELLED')),
      sender_lot_id uuid NOT NULL,
      sender_location_id uuid NOT NULL,
      receiver_location_id uuid,
      receiver_product_id uuid,
      receiver_lot_id uuid,
      quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
      unit text NOT NULL CHECK (unit = 'KG'),
      returns_transfer_id uuid REFERENCES custody_transfers(id),
      origin_projection jsonb NOT NULL,
      origin_projection_hash text NOT NULL,
      note text CHECK (note IS NULL OR length(note) <= 1000),
      closure text CHECK (closure IS NULL OR closure IN ('COMPLETE','WITH_DIFFERENCES')),
      reject_reason text,
      cancel_reason text,
      offered_by uuid NOT NULL REFERENCES users(id),
      offer_operation_id uuid NOT NULL,
      row_version bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT custody_transfers_distinct CHECK (sender_org_id <> receiver_org_id),
      CONSTRAINT custody_transfers_closure_shape CHECK ((status = 'CLOSED') = (closure IS NOT NULL)),
      CONSTRAINT custody_transfers_sender_code_uq UNIQUE (sender_org_id, transfer_code),
      CONSTRAINT custody_transfers_offer_operation_uq UNIQUE (sender_org_id, offer_operation_id),
      CONSTRAINT custody_transfers_sender_lot_fk FOREIGN KEY (sender_org_id, sender_lot_id) REFERENCES lots(organization_id, id),
      CONSTRAINT custody_transfers_sender_location_fk FOREIGN KEY (sender_org_id, sender_location_id) REFERENCES locations(organization_id, id),
      CONSTRAINT custody_transfers_receiver_location_fk FOREIGN KEY (receiver_org_id, receiver_location_id) REFERENCES locations(organization_id, id),
      CONSTRAINT custody_transfers_receiver_product_fk FOREIGN KEY (receiver_org_id, receiver_product_id) REFERENCES products(organization_id, id),
      CONSTRAINT custody_transfers_receiver_lot_fk FOREIGN KEY (receiver_org_id, receiver_lot_id) REFERENCES lots(organization_id, id)
    )`.execute(db);
  await sql`CREATE INDEX custody_transfers_sender_idx ON custody_transfers (sender_org_id, created_at DESC)`.execute(db);
  await sql`CREATE INDEX custody_transfers_receiver_idx ON custody_transfers (receiver_org_id, created_at DESC)`.execute(db);
  // Defensa en profundidad: el traspaso solo existe entre las dos organizaciones de un vínculo ACTIVO (el servicio lo valida antes).
  await sql`
    CREATE FUNCTION custody_transfers_pair_check() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE p record;
    BEGIN
      SELECT * INTO p FROM org_partnerships WHERE id = NEW.partnership_id;
      IF p.id IS NULL OR p.counterpart_org_id IS NULL
         OR NOT ((p.requester_org_id = NEW.sender_org_id AND p.counterpart_org_id = NEW.receiver_org_id) OR (p.requester_org_id = NEW.receiver_org_id AND p.counterpart_org_id = NEW.sender_org_id)) THEN
        RAISE EXCEPTION 'custody_transfers: el vínculo no corresponde a las organizaciones del traspaso';
      END IF;
      IF TG_OP = 'INSERT' AND p.status <> 'ACTIVE' THEN RAISE EXCEPTION 'custody_transfers: el vínculo no está activo'; END IF;
      IF TG_OP = 'UPDATE' AND (NEW.sender_org_id <> OLD.sender_org_id OR NEW.receiver_org_id <> OLD.receiver_org_id OR NEW.sender_lot_id <> OLD.sender_lot_id
          OR NEW.quantity <> OLD.quantity OR NEW.unit <> OLD.unit OR NEW.origin_projection_hash <> OLD.origin_projection_hash OR NEW.transfer_code <> OLD.transfer_code) THEN
        RAISE EXCEPTION 'custody_transfers: organizaciones, lote, cantidad, unidad y proyección de origen no cambian';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER custody_transfers_pair BEFORE INSERT OR UPDATE ON custody_transfers FOR EACH ROW EXECUTE FUNCTION custody_transfers_pair_check()`.execute(db);

  // ---- pasos del traspaso (append-only): de aquí se deriva el tránsito y la conciliación
  await sql`
    CREATE TABLE custody_transfer_steps (
      id uuid PRIMARY KEY,
      transfer_id uuid NOT NULL REFERENCES custody_transfers(id),
      actor_org_id uuid NOT NULL REFERENCES organizations(id),
      actor_user_id uuid NOT NULL REFERENCES users(id),
      step text NOT NULL CHECK (step IN ('OFFER','ACCEPT','REJECT_OFFER','CANCEL','DISPATCH','RECEIPT','OVERAGE_RECORDED','REJECT_TRANSIT','DECLARE_SHORTAGE','LOSS_CONFIRMED','OVERAGE_CONFIRMED','OVERAGE_WITHDRAWN','SHORTAGE_REOPENED')),
      quantity numeric(20,6) CHECK (quantity IS NULL OR quantity > 0),
      reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 500),
      detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      movement_id uuid,
      operation_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT custody_transfer_steps_operation_uq UNIQUE (actor_org_id, operation_id),
      CONSTRAINT custody_transfer_steps_movement_fk FOREIGN KEY (actor_org_id, movement_id) REFERENCES stock_movements(organization_id, id),
      CONSTRAINT custody_transfer_steps_quantity_required CHECK (step NOT IN ('DISPATCH','RECEIPT','OVERAGE_RECORDED','REJECT_TRANSIT','DECLARE_SHORTAGE','LOSS_CONFIRMED','OVERAGE_CONFIRMED','OVERAGE_WITHDRAWN','SHORTAGE_REOPENED') OR quantity IS NOT NULL),
      CONSTRAINT custody_transfer_steps_reason_required CHECK (step NOT IN ('REJECT_OFFER','CANCEL','REJECT_TRANSIT','DECLARE_SHORTAGE','OVERAGE_RECORDED','LOSS_CONFIRMED','OVERAGE_CONFIRMED','OVERAGE_WITHDRAWN','SHORTAGE_REOPENED') OR reason IS NOT NULL)
    )`.execute(db);
  await sql`CREATE INDEX custody_transfer_steps_transfer_idx ON custody_transfer_steps (transfer_id, created_at)`.execute(db);
  await sql`
    CREATE FUNCTION custody_transfer_steps_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'custody_transfer_steps es append-only: la historia del traspaso no se borra ni se reescribe'; END $$`.execute(db);
  await sql`CREATE TRIGGER custody_transfer_steps_no_mutation BEFORE UPDATE OR DELETE ON custody_transfer_steps FOR EACH ROW EXECUTE FUNCTION custody_transfer_steps_append_only()`.execute(db);
  // Conservación de masa del traspaso, verificada al confirmar: tránsito = despachado − recibido − rechazado − pérdida confirmada ≥ 0.
  await sql`
    CREATE FUNCTION custody_transfer_steps_balance_check() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE d numeric; r numeric; j numeric; l numeric;
    BEGIN
      SELECT coalesce(sum(quantity) FILTER (WHERE step IN ('DISPATCH','OVERAGE_CONFIRMED')), 0),
             coalesce(sum(quantity) FILTER (WHERE step IN ('RECEIPT','OVERAGE_CONFIRMED')), 0),
             coalesce(sum(quantity) FILTER (WHERE step = 'REJECT_TRANSIT'), 0),
             coalesce(sum(quantity) FILTER (WHERE step = 'LOSS_CONFIRMED'), 0)
        INTO d, r, j, l FROM custody_transfer_steps WHERE transfer_id = NEW.transfer_id;
      IF d - r - j - l < 0 THEN
        RAISE EXCEPTION 'custody_transfer_steps: el tránsito quedaría negativo (despachado %, recibido %, rechazado %, pérdida %)', d, r, j, l USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END $$`.execute(db);
  await sql`CREATE CONSTRAINT TRIGGER custody_transfer_steps_balance AFTER INSERT ON custody_transfer_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION custody_transfer_steps_balance_check()`.execute(db);

  // ---- discrepancias: conservan estado y cantidad pendiente de conciliación (D5a); nunca se convierten solas en pérdida
  await sql`
    CREATE TABLE custody_discrepancies (
      id uuid PRIMARY KEY,
      transfer_id uuid NOT NULL REFERENCES custody_transfers(id),
      kind text NOT NULL CHECK (kind IN ('SHORTAGE','OVERAGE')),
      quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
      status text NOT NULL CHECK (status IN ('OPEN','RESOLVED')),
      resolution text CHECK (resolution IS NULL OR resolution IN ('LOSS_CONFIRMED','OVERAGE_CONFIRMED','OVERAGE_WITHDRAWN','SHORTAGE_REOPENED')),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      recorded_by_org uuid NOT NULL REFERENCES organizations(id),
      recorded_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      resolved_by_org uuid REFERENCES organizations(id),
      resolved_by uuid REFERENCES users(id),
      resolved_at timestamptz,
      resolution_reason text CHECK (resolution_reason IS NULL OR length(btrim(resolution_reason)) BETWEEN 3 AND 500),
      CONSTRAINT custody_discrepancies_shape CHECK ((status = 'OPEN' AND resolution IS NULL AND resolved_at IS NULL)
        OR (status = 'RESOLVED' AND resolution IS NOT NULL AND resolved_at IS NOT NULL AND resolution_reason IS NOT NULL)),
      CONSTRAINT custody_discrepancies_kind_resolution CHECK (resolution IS NULL OR (kind = 'SHORTAGE' AND resolution IN ('LOSS_CONFIRMED','SHORTAGE_REOPENED')) OR (kind = 'OVERAGE' AND resolution IN ('OVERAGE_CONFIRMED','OVERAGE_WITHDRAWN')))
    )`.execute(db);
  await sql`CREATE INDEX custody_discrepancies_transfer_idx ON custody_discrepancies (transfer_id, status)`.execute(db);
  await sql`
    CREATE FUNCTION custody_discrepancies_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'custody_discrepancies: no se borran'; END IF;
      IF OLD.status = 'RESOLVED' THEN RAISE EXCEPTION 'custody_discrepancies: una discrepancia resuelta no cambia'; END IF;
      IF NEW.transfer_id <> OLD.transfer_id OR NEW.kind <> OLD.kind OR NEW.quantity <> OLD.quantity OR NEW.reason <> OLD.reason THEN RAISE EXCEPTION 'custody_discrepancies: solo cambia su resolución'; END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER custody_discrepancies_guard BEFORE UPDATE OR DELETE ON custody_discrepancies FOR EACH ROW EXECUTE FUNCTION custody_discrepancies_guard()`.execute(db);

  // ---- linaje entre lotes de organizaciones distintas: cada fila lleva y valida los DOS organization_id
  await sql`
    CREATE TABLE custody_lot_links (
      id uuid PRIMARY KEY,
      transfer_id uuid NOT NULL REFERENCES custody_transfers(id),
      step_id uuid NOT NULL REFERENCES custody_transfer_steps(id),
      parent_org_id uuid NOT NULL REFERENCES organizations(id),
      parent_lot_id uuid NOT NULL,
      child_org_id uuid NOT NULL REFERENCES organizations(id),
      child_lot_id uuid NOT NULL,
      quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
      unit text NOT NULL CHECK (unit = 'KG'),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT custody_lot_links_step_uq UNIQUE (step_id),
      CONSTRAINT custody_lot_links_distinct CHECK (parent_org_id <> child_org_id),
      CONSTRAINT custody_lot_links_parent_fk FOREIGN KEY (parent_org_id, parent_lot_id) REFERENCES lots(organization_id, id),
      CONSTRAINT custody_lot_links_child_fk FOREIGN KEY (child_org_id, child_lot_id) REFERENCES lots(organization_id, id)
    )`.execute(db);
  await sql`CREATE INDEX custody_lot_links_child_idx ON custody_lot_links (child_org_id, child_lot_id)`.execute(db);
  await sql`CREATE INDEX custody_lot_links_parent_idx ON custody_lot_links (parent_org_id, parent_lot_id)`.execute(db);
  await sql`
    CREATE FUNCTION custody_lot_links_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'custody_lot_links es append-only: el linaje no se borra ni se reescribe'; END $$`.execute(db);
  await sql`CREATE TRIGGER custody_lot_links_no_mutation BEFORE UPDATE OR DELETE ON custody_lot_links FOR EACH ROW EXECUTE FUNCTION custody_lot_links_append_only()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS custody_lot_links`.execute(db);
  await sql`DROP TABLE IF EXISTS custody_discrepancies`.execute(db);
  await sql`DROP TABLE IF EXISTS custody_transfer_steps`.execute(db);
  await sql`DROP TABLE IF EXISTS custody_transfers`.execute(db);
  await sql`DROP TABLE IF EXISTS org_partnerships`.execute(db);
}
