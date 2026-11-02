import { Kysely, sql } from 'kysely';
import { publishCteRelease } from '../../traceability/cte-release';
import { publishKdeGates, publishKdeRelease } from '../../traceability/kde-release';
import { incorporateOrganization } from '../../inventory/ledger';
import { KDE_1_0_0 } from './0016_kde_catalog';

// P0-017 Inventario y balance de masa (RF-17, QA-06). Contrato: docs/decisiones/P0-017-EFECTOS-LEDGER.md.
// El ledger es la ÚNICA fuente de existencia física, reserva y disponible; reemplaza los triggers de cantidad de P0-016
// (que contaban asignaciones y entradas de proceso por separado). Tenedor = recepción o lote; ubicación de la misma
// organización o pendiente (NULL). Append-only. Invariantes por tenedor/ubicación en un trigger DIFERIDO (al confirmar
// la transacción, cuando ya están todas las líneas de un movimiento). Reserva/despacho para embarques: P0-029 (docs/06
// exige shipment_id); no se implementa aquí.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE stock_movements (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      movement_type text NOT NULL CHECK (movement_type IN ('RECEPTION_IN','RECEPTION_CORRECTION','LOT_ASSIGN','LOT_RELEASE','PROCESS_RESERVE','PROCESS_RESERVE_RELEASE','PROCESS_CLOSE','STOCK_LOSS','TRANSFER','LOCATION_ASSIGN','ADJUSTMENT')),
      source_type text, source_id uuid,
      operation_id uuid,
      actor_id uuid REFERENCES users(id),
      reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 500),
      process_loss numeric(20,6) CHECK (process_loss IS NULL OR process_loss >= 0),
      reference jsonb NOT NULL DEFAULT '{}'::jsonb,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT stock_movements_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT stock_movements_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT stock_movements_reason_required CHECK (movement_type NOT IN ('STOCK_LOSS','ADJUSTMENT') OR reason IS NOT NULL)
    )`.execute(db);
  // Un movimiento por registro de dominio y tipo: la incorporación repetida y los reintentos no duplican.
  await sql`CREATE UNIQUE INDEX stock_movements_source_uq ON stock_movements (organization_id, movement_type, source_id) WHERE source_id IS NOT NULL`.execute(db);
  await sql`
    CREATE TABLE stock_entries (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      movement_id uuid NOT NULL,
      reception_id uuid,
      lot_id uuid,
      location_id uuid,
      bucket text NOT NULL CHECK (bucket IN ('PHYSICAL','RESERVED')),
      signed_quantity numeric(20,6) NOT NULL CHECK (signed_quantity <> 0),
      unit text NOT NULL CHECK (unit = 'KG'),
      CONSTRAINT stock_entries_holder CHECK ((reception_id IS NULL) <> (lot_id IS NULL)),
      CONSTRAINT stock_entries_reception_reserved CHECK (reception_id IS NULL OR bucket = 'PHYSICAL'),
      CONSTRAINT stock_entries_movement_fk FOREIGN KEY (organization_id, movement_id) REFERENCES stock_movements(organization_id, id),
      CONSTRAINT stock_entries_reception_fk FOREIGN KEY (organization_id, reception_id) REFERENCES receptions(organization_id, id),
      CONSTRAINT stock_entries_lot_fk FOREIGN KEY (organization_id, lot_id) REFERENCES lots(organization_id, id),
      CONSTRAINT stock_entries_location_fk FOREIGN KEY (organization_id, location_id) REFERENCES locations(organization_id, id)
    )`.execute(db);
  await sql`CREATE INDEX stock_entries_lot_idx ON stock_entries (organization_id, lot_id, location_id, bucket)`.execute(db);
  await sql`CREATE INDEX stock_entries_reception_idx ON stock_entries (organization_id, reception_id)`.execute(db);
  for (const t of ['stock_movements', 'stock_entries']) {
    await sql.raw(`CREATE FUNCTION ${t}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${t} es append-only: los movimientos históricos no se borran ni se reescriben'; END $$`).execute(db);
    await sql.raw(`CREATE TRIGGER ${t}_no_mutation BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION ${t}_append_only()`).execute(db);
  }
  // Invariantes al confirmar: físico ≥ 0, reservado ≥ 0, reservado ≤ físico por tenedor y ubicación.
  await sql`
    CREATE FUNCTION stock_entries_balance_check() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE phys numeric; res numeric;
    BEGIN
      SELECT coalesce(sum(signed_quantity) FILTER (WHERE bucket = 'PHYSICAL'), 0), coalesce(sum(signed_quantity) FILTER (WHERE bucket = 'RESERVED'), 0)
        INTO phys, res FROM stock_entries
        WHERE organization_id = NEW.organization_id AND reception_id IS NOT DISTINCT FROM NEW.reception_id AND lot_id IS NOT DISTINCT FROM NEW.lot_id AND location_id IS NOT DISTINCT FROM NEW.location_id;
      IF phys < 0 OR res < 0 OR res > phys THEN
        RAISE EXCEPTION 'stock_entries: saldo inválido (físico %, reservado %): doble consumo o saldo negativo', phys, res USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END $$`.execute(db);
  await sql`CREATE CONSTRAINT TRIGGER stock_entries_balance AFTER INSERT ON stock_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stock_entries_balance_check()`.execute(db);

  // Una sola fuente de disponibilidad: los controles de cantidad de P0-016 pasan al ledger.
  await sql`DROP TRIGGER process_inputs_check ON process_inputs`.execute(db);
  await sql`
    CREATE OR REPLACE FUNCTION lot_inputs_check() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE l record;
    BEGIN
      SELECT * INTO l FROM lots WHERE id = NEW.lot_id;
      IF l.status <> 'OPEN' OR l.source <> 'RECEPTIONS' THEN RAISE EXCEPTION 'lot_inputs: el lote no admite entradas'; END IF;
      IF (l.origin_status = 'COMPLETE') IS DISTINCT FROM NEW.origin_known THEN RAISE EXCEPTION 'lot_inputs: no se mezcla origen conocido con origen incompleto'; END IF;
      RETURN NEW; -- la cantidad la controla el ledger (stock_entries_balance)
    END $$`.execute(db);
  // Ubicación de la reserva de cada entrada de proceso (nuevas entradas; las históricas la llevan en el movimiento).
  await sql`ALTER TABLE process_inputs ADD COLUMN location_id uuid`.execute(db);
  await sql`ALTER TABLE process_inputs ADD CONSTRAINT process_inputs_location_fk FOREIGN KEY (organization_id, location_id) REFERENCES locations(organization_id, id)`.execute(db);

  // CTE 1.3.0: STORAGE integrada (merma, traslado, asignación de ubicación y ajuste emiten StockMovementRecorded).
  const S1 = 'S1 §19 (cte_definitions); eventos propuestos en docs/08';
  await publishCteRelease(db, {
    version: '1.3.0', source: S1, notes: 'P0-017: STORAGE integrada (movimientos de inventario con ubicación, dirección, cantidad y responsable).',
    publish: [{ code: 'STORAGE', name: 'Almacenamiento', description: 'Entrada o salida de un lote en un centro o ubicación, con cantidad y responsable (ledger de inventario).', stage: 'INTERNAL', source: S1,
      links: [{ operation: 'STOCK_MOVEMENT', event_type: 'StockMovementRecorded', status: 'INTEGRATED', story: 'P0-017', note: 'Merma, traslado, asignación de ubicación y ajuste con motivo en el ledger, con compuerta STOCK_MOVEMENT.' }] }],
  });
  await publishKdeRelease(db, { version: '1.4.0', source: 'docs/08; P0-017', notes: 'P0-017: datos de STORAGE republicados sobre STORAGE@2. Compuerta STOCK_MOVEMENT.', publish: KDE_1_0_0.filter((d) => d.cte === 'STORAGE') });
  await publishKdeGates(db, '1.4.0', ['STORAGE_LOT', 'STORAGE_LOCATION', 'STORAGE_QUANTITY', 'STORAGE_DIRECTION', 'STORAGE_RESPONSIBLE']
    .map((kde) => ({ transition: 'STOCK_MOVEMENT', kde, mode: 'BLOCKING' as const, note: 'docs/08: movimiento sin lote, ubicación, cantidad o dirección se rechaza; responsable = sesión. En un traslado se valida cada línea (salida y entrada).' })));

  // Incorporación idempotente de los datos existentes (recepciones, asignaciones, procesos).
  const orgs = (await sql<{ id: string }>`SELECT id FROM organizations ORDER BY created_at`.execute(db)).rows;
  for (const o of orgs) await incorporateOrganization(db, o.id, null);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE stock_entries`.execute(db);
  await sql`DROP TABLE stock_movements`.execute(db);
}
