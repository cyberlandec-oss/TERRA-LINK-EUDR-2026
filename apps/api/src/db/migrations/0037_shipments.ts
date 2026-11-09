import { Kysely, sql } from 'kysely';
import { publishCteRelease } from '../../traceability/cte-release';
import { publishKdeGates, publishKdeRelease } from '../../traceability/kde-release';
import { KDE_1_0_0 } from './0016_kde_catalog';

// P0-029 Movimientos y embarque (RF-29, QA-06/12). Contrato: docs/decisiones/P0-029-EMBARQUES.md.
// - buyers: contraparte compradora DECLARADA por la organización (sin verificación externa; D-33 sigue abierta).
// - shipments / shipment_items: embarque con comprador, destino declarado, centro de salida y lotes/cantidades (KG).
// - shipment_reservations: reserva por ítem en el centro de salida, enlazada a su movimiento del ledger
//   (SHIPMENT_RESERVE / SHIPMENT_RESERVE_RELEASE / SHIPMENT_DISPATCH). El ledger sigue siendo la única fuente de saldo:
//   la tabla solo registra el vínculo y el estado de cada reserva.
// - Despacho: compuerta SHIPMENT_DISPATCH con BLOCKED_PENDING_DECISION para dd_package_id y dispatch_at (D-34): mientras
//   no exista su condición escrita, ningún embarque se despacha.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check`.execute(db);
  await sql`ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN ('RECEPTION_IN','RECEPTION_CORRECTION','LOT_ASSIGN','LOT_RELEASE','PROCESS_RESERVE','PROCESS_RESERVE_RELEASE','PROCESS_CLOSE','STOCK_LOSS','TRANSFER','LOCATION_ASSIGN','ADJUSTMENT','SHIPMENT_RESERVE','SHIPMENT_RESERVE_RELEASE','SHIPMENT_DISPATCH'))`.execute(db);

  await sql`
    CREATE TABLE buyers (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
      name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
      country char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
      status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_by uuid NOT NULL REFERENCES users(id),
      operation_id uuid NOT NULL,
      row_version bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT buyers_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT buyers_org_code_uq UNIQUE (organization_id, code),
      CONSTRAINT buyers_operation_uq UNIQUE (organization_id, operation_id)
    )`.execute(db);

  await sql`
    CREATE TABLE shipments (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      shipment_code text NOT NULL,
      status text NOT NULL CHECK (status IN ('DRAFT','DISPATCHED','CANCELLED')),
      buyer_id uuid NOT NULL,
      destination_country char(2) NOT NULL CHECK (destination_country ~ '^[A-Z]{2}$'),
      destination_place text CHECK (destination_place IS NULL OR length(destination_place) <= 200),
      origin_location_id uuid NOT NULL,
      notes text CHECK (notes IS NULL OR length(notes) <= 1000),
      dd_package_export_id uuid,
      dispatch_at timestamptz,
      dispatched_by uuid REFERENCES users(id),
      dispatch_operation_id uuid,
      cancel_reason text,
      created_by uuid NOT NULL REFERENCES users(id),
      operation_id uuid NOT NULL,
      row_version bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT shipments_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT shipments_org_code_uq UNIQUE (organization_id, shipment_code),
      CONSTRAINT shipments_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT shipments_dispatch_operation_uq UNIQUE (organization_id, dispatch_operation_id),
      CONSTRAINT shipments_buyer_fk FOREIGN KEY (organization_id, buyer_id) REFERENCES buyers(organization_id, id),
      CONSTRAINT shipments_location_fk FOREIGN KEY (organization_id, origin_location_id) REFERENCES locations(organization_id, id),
      CONSTRAINT shipments_package_fk FOREIGN KEY (organization_id, dd_package_export_id) REFERENCES dd_exports(organization_id, id),
      CONSTRAINT shipments_status_shape CHECK (
        (status = 'DISPATCHED') = (dispatch_at IS NOT NULL AND dispatched_by IS NOT NULL AND dispatch_operation_id IS NOT NULL)
        AND (status = 'CANCELLED') = (cancel_reason IS NOT NULL))
    )`.execute(db);

  await sql`
    CREATE TABLE shipment_items (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      shipment_id uuid NOT NULL,
      lot_id uuid NOT NULL,
      quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
      unit text NOT NULL CHECK (unit = 'KG'),
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT shipment_items_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT shipment_items_lot_uq UNIQUE (shipment_id, lot_id),
      CONSTRAINT shipment_items_shipment_fk FOREIGN KEY (organization_id, shipment_id) REFERENCES shipments(organization_id, id),
      CONSTRAINT shipment_items_lot_fk FOREIGN KEY (organization_id, lot_id) REFERENCES lots(organization_id, id)
    )`.execute(db);

  await sql`
    CREATE TABLE shipment_reservations (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      shipment_id uuid NOT NULL,
      item_id uuid NOT NULL,
      lot_id uuid NOT NULL,
      location_id uuid NOT NULL,
      quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
      unit text NOT NULL CHECK (unit = 'KG'),
      status text NOT NULL CHECK (status IN ('ACTIVE','RELEASED','CONSUMED')),
      reserve_movement_id uuid NOT NULL REFERENCES stock_movements(id),
      end_movement_id uuid REFERENCES stock_movements(id),
      release_reason text,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      ended_at timestamptz,
      operation_id uuid NOT NULL,
      CONSTRAINT shipment_reservations_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT shipment_reservations_shipment_fk FOREIGN KEY (organization_id, shipment_id) REFERENCES shipments(organization_id, id),
      CONSTRAINT shipment_reservations_item_fk FOREIGN KEY (organization_id, item_id) REFERENCES shipment_items(organization_id, id),
      CONSTRAINT shipment_reservations_lot_fk FOREIGN KEY (organization_id, lot_id) REFERENCES lots(organization_id, id),
      CONSTRAINT shipment_reservations_location_fk FOREIGN KEY (organization_id, location_id) REFERENCES locations(organization_id, id),
      CONSTRAINT shipment_reservations_shape CHECK ((status = 'ACTIVE') = (end_movement_id IS NULL AND ended_at IS NULL)
        AND (status <> 'RELEASED' OR release_reason IS NOT NULL))
    )`.execute(db);
  // Una sola reserva activa por ítem; una reserva terminada no vuelve a activarse (se crea otra).
  await sql`CREATE UNIQUE INDEX shipment_reservations_active_uq ON shipment_reservations (item_id) WHERE status = 'ACTIVE'`.execute(db);
  await sql`
    CREATE FUNCTION shipment_reservations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'shipment_reservations: no se borra una reserva'; END IF;
      IF OLD.status <> 'ACTIVE' THEN RAISE EXCEPTION 'shipment_reservations: una reserva terminada no cambia'; END IF;
      IF NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.lot_id IS DISTINCT FROM OLD.lot_id OR NEW.location_id IS DISTINCT FROM OLD.location_id
         OR NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.reserve_movement_id IS DISTINCT FROM OLD.reserve_movement_id THEN
        RAISE EXCEPTION 'shipment_reservations: cantidad, lote, centro y movimiento de una reserva son inmutables';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER shipment_reservations_guard BEFORE UPDATE OR DELETE ON shipment_reservations FOR EACH ROW EXECUTE FUNCTION shipment_reservations_guard()`.execute(db);
  // Un embarque despachado o cancelado es definitivo.
  await sql`
    CREATE FUNCTION shipments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'shipments: no se borra un embarque'; END IF;
      IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'shipments: un embarque despachado o cancelado no cambia'; END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER shipments_guard BEFORE UPDATE OR DELETE ON shipments FOR EACH ROW EXECUTE FUNCTION shipments_guard()`.execute(db);

  await sql`ALTER TABLE gate_evaluations DROP CONSTRAINT gate_evaluations_entity_type_check`.execute(db);
  await sql`ALTER TABLE gate_evaluations ADD CONSTRAINT gate_evaluations_entity_type_check CHECK (entity_type IN ('delivery','reception','quality_result','process_run','stock_movement','shipment'))`.execute(db);

  // Liberar una asignación de recepción exige además que el lote no tenga reservas de embarque activas ni despachos.
  await sql`
    CREATE OR REPLACE FUNCTION lot_input_releases_check() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM process_inputs p JOIN process_runs r ON r.id = p.run_id JOIN lot_inputs i ON i.lot_id = p.lot_id
                 WHERE i.id = NEW.input_id AND r.status IN ('RUNNING','CLOSED'))
         OR EXISTS (SELECT 1 FROM shipment_reservations s JOIN lot_inputs i ON i.lot_id = s.lot_id
                 WHERE i.id = NEW.input_id AND s.status IN ('ACTIVE','CONSUMED')) THEN
        RAISE EXCEPTION 'lot_input_releases: el lote tiene reservas o consumo' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$`.execute(db);

  // CTE 1.4.0: SHIPMENT integrada (la operación existe y emite ShipmentDispatched), con despacho bloqueado por D-34.
  const S1 = 'S1 §19 (cte_definitions); eventos propuestos en docs/08';
  await publishCteRelease(db, {
    version: '1.4.0', source: S1, notes: 'P0-029: SHIPMENT integrada (reserva en el ledger y despacho con compuerta; despacho bloqueado hasta D-34).',
    publish: [{ code: 'SHIPMENT', name: 'Embarque', description: 'Despacho de un embarque con comprador, destino, lotes, cantidades y paquete.', stage: 'OUTBOUND', source: S1,
      links: [{ operation: 'SHIPMENT_DISPATCH', event_type: 'ShipmentDispatched', status: 'INTEGRATED', story: 'P0-029', note: 'Despacho idempotente que consume las reservas en el ledger; la compuerta bloquea mientras D-34 no defina dd_package_id y dispatch_at.' }] }],
  });
  await publishKdeRelease(db, { version: '1.5.0', source: 'docs/08; P0-029', notes: 'P0-029: datos de SHIPMENT republicados sobre SHIPMENT@2. Compuerta SHIPMENT_DISPATCH.', publish: KDE_1_0_0.filter((d) => d.cte === 'SHIPMENT') });
  await publishKdeGates(db, '1.5.0', [
    ...['SHIPMENT_REF', 'SHIPMENT_BUYER', 'SHIPMENT_DESTINATION', 'SHIPMENT_LOTS', 'SHIPMENT_QUANTITY']
      .map((kde) => ({ transition: 'SHIPMENT_DISPATCH', kde, mode: 'BLOCKING' as const, note: 'docs/08: embarque sin comprador, destino, lotes o cantidad no se despacha.' })),
    { transition: 'SHIPMENT_DISPATCH', kde: 'SHIPMENT_PACKAGE', mode: 'BLOCKED_PENDING_DECISION' as const, note: 'Condición de dd_package_id no escrita (D-34): el despacho queda bloqueado hasta definirla.' },
    { transition: 'SHIPMENT_DISPATCH', kde: 'SHIPMENT_DISPATCH_AT', mode: 'BLOCKED_PENDING_DECISION' as const, note: 'Condición de dispatch_at no escrita (D-34): el despacho queda bloqueado hasta definirla.' },
  ]);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE shipment_reservations`.execute(db);
  await sql`DROP TABLE shipment_items`.execute(db);
  await sql`DROP TABLE shipments`.execute(db);
  await sql`DROP TABLE buyers`.execute(db);
}
