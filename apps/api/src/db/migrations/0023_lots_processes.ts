import { Kysely, sql } from 'kysely';
import { publishCteRelease } from '../../traceability/cte-release';
import { publishKdeGates, publishKdeRelease } from '../../traceability/kde-release';
import { KDE_1_0_0 } from './0016_kde_catalog';

// P0-016 Lotes y procesos (RF-16, QA-07). Contrato: docs/decisiones/P0-016-017-PROPUESTA-LOTES-INVENTARIO.md con las
// reglas D-39 ADOPTADAS para desarrollo local (instrucción del responsable de producto, 2026-10-10; no es validación en
// campo ni ratificación para producción):
//  1) lotes con origen desconocido permitidos, separados y marcados INCOMPLETE; sin mezclarlos con origen conocido;
//     la condición se conserva en las salidas;
//  2) corrección de peso bloqueada mientras haya asignación activa, reserva o consumo (trigger en reception_adjustments);
//  3) secado: preparar e iniciar sí; cierre bloqueado hasta definir la unidad de humedad (D-32) y cumplir el KDE;
//  4) MANAGER crea lotes; cerrar procesos exige `process:close` (no se concede por el rol de calidad).
// Cantidades mínimas de P0-016 (asignado/reservado/consumido como proyección, no inventario). Ledger, ubicaciones,
// traslados y despacho: P0-017. Todas las tablas: organization_id NOT NULL y FK compuestas.

const appendOnly = async (db: Kysely<unknown>, table: string) => {
  await sql.raw(`
    CREATE FUNCTION ${table}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION '${table} es append-only: corrige con un registro nuevo relacionado'; END $$`).execute(db);
  await sql.raw(`CREATE TRIGGER ${table}_no_mutation BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_append_only()`).execute(db);
};
const D39 = 'D-39 (regla adoptada para desarrollo local, 2026-10-10; no validada en campo)';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Peso vigente de una recepción (última corrección o el original).
  await sql`
    CREATE FUNCTION reception_current_quantity(rid uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
      SELECT coalesce((SELECT a.new_quantity FROM reception_adjustments a WHERE a.reception_id = rid ORDER BY a.adjustment_number DESC LIMIT 1),
                      (SELECT r.quantity_received FROM receptions r WHERE r.id = rid))
    $$`.execute(db);

  await sql`
    CREATE TABLE process_runs (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      run_code text NOT NULL,
      process_type text NOT NULL CHECK (process_type IN ('FERMENTATION','DRYING')),
      status text NOT NULL CHECK (status IN ('DRAFT','RUNNING','CLOSED','CANCELLED')),
      output_product_id uuid NOT NULL,
      started_at timestamptz, closed_at timestamptz,
      loss_quantity numeric(20,6) CHECK (loss_quantity IS NULL OR loss_quantity >= 0),
      moisture_value numeric(20,6), moisture_unit text,
      notes text CHECK (notes IS NULL OR length(notes) <= 500),
      cancel_reason text,
      created_by uuid NOT NULL REFERENCES users(id),
      operation_id uuid NOT NULL,
      start_operation_id uuid, close_operation_id uuid, cancel_operation_id uuid,
      row_version bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT process_runs_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT process_runs_org_code_uq UNIQUE (organization_id, run_code),
      CONSTRAINT process_runs_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT process_runs_start_op_uq UNIQUE (organization_id, start_operation_id),
      CONSTRAINT process_runs_close_op_uq UNIQUE (organization_id, close_operation_id),
      CONSTRAINT process_runs_product_fk FOREIGN KEY (organization_id, output_product_id) REFERENCES products(organization_id, id),
      CONSTRAINT process_runs_closed_complete CHECK (status <> 'CLOSED' OR (started_at IS NOT NULL AND closed_at IS NOT NULL AND loss_quantity IS NOT NULL AND closed_at >= started_at)),
      CONSTRAINT process_runs_running_started CHECK (status NOT IN ('RUNNING','CLOSED') OR started_at IS NOT NULL)
    )`.execute(db);
  // Transiciones válidas; un proceso cerrado o cancelado no cambia.
  await sql`
    CREATE FUNCTION process_runs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'process_runs: no se borra un proceso'; END IF;
      IF OLD.status IN ('CLOSED','CANCELLED') THEN RAISE EXCEPTION 'process_runs: un proceso % no cambia', OLD.status; END IF;
      IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT','RUNNING','CANCELLED')) OR (OLD.status = 'RUNNING' AND NEW.status IN ('RUNNING','CLOSED','CANCELLED'))) THEN
        RAISE EXCEPTION 'process_runs: transición % → % no válida', OLD.status, NEW.status;
      END IF;
      IF NEW.process_type IS DISTINCT FROM OLD.process_type OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.run_code IS DISTINCT FROM OLD.run_code THEN
        RAISE EXCEPTION 'process_runs: tipo, organización y código inmutables';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER process_runs_guard BEFORE UPDATE OR DELETE ON process_runs FOR EACH ROW EXECUTE FUNCTION process_runs_guard()`.execute(db);

  await sql`
    CREATE TABLE lots (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      lot_code text NOT NULL,
      product_id uuid NOT NULL,
      unit text NOT NULL CHECK (unit = 'KG'),
      source text NOT NULL CHECK (source IN ('RECEPTIONS','PROCESS_OUTPUT')),
      status text NOT NULL CHECK (status IN ('OPEN','CLOSED_FOR_INPUT')),
      origin_status text NOT NULL CHECK (origin_status IN ('COMPLETE','INCOMPLETE')),
      process_run_id uuid,
      output_quantity numeric(20,6) CHECK (output_quantity IS NULL OR output_quantity > 0),
      created_by uuid NOT NULL REFERENCES users(id),
      operation_id uuid NOT NULL,
      row_version bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT lots_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT lots_org_code_uq UNIQUE (organization_id, lot_code),
      CONSTRAINT lots_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT lots_product_fk FOREIGN KEY (organization_id, product_id) REFERENCES products(organization_id, id),
      CONSTRAINT lots_run_fk FOREIGN KEY (organization_id, process_run_id) REFERENCES process_runs(organization_id, id),
      CONSTRAINT lots_source_shape CHECK ((source = 'RECEPTIONS' AND process_run_id IS NULL AND output_quantity IS NULL)
        OR (source = 'PROCESS_OUTPUT' AND process_run_id IS NOT NULL AND output_quantity IS NOT NULL AND status = 'CLOSED_FOR_INPUT'))
    )`.execute(db);
  await sql`
    CREATE FUNCTION lots_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'lots: no se borra un lote'; END IF;
      IF (to_jsonb(NEW) - 'row_version' - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'row_version' - 'status') THEN RAISE EXCEPTION 'lots: solo cambian estado y versión'; END IF;
      IF OLD.status = 'CLOSED_FOR_INPUT' AND NEW.status = 'OPEN' THEN RAISE EXCEPTION 'lots: un lote cerrado a entradas no se reabre'; END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER lots_guard BEFORE UPDATE OR DELETE ON lots FOR EACH ROW EXECUTE FUNCTION lots_guard()`.execute(db);

  // Asignación recepción → lote con referencias exactas (pesaje vigente y versión de la recepción usados).
  await sql`
    CREATE TABLE lot_inputs (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      lot_id uuid NOT NULL,
      reception_id uuid NOT NULL,
      weighing_id uuid NOT NULL,
      reception_version integer NOT NULL CHECK (reception_version > 0),
      quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
      unit text NOT NULL CHECK (unit = 'KG'),
      origin_known boolean NOT NULL,
      assigned_by uuid NOT NULL REFERENCES users(id),
      assigned_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT lot_inputs_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT lot_inputs_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT lot_inputs_lot_fk FOREIGN KEY (organization_id, lot_id) REFERENCES lots(organization_id, id),
      CONSTRAINT lot_inputs_reception_fk FOREIGN KEY (organization_id, reception_id) REFERENCES receptions(organization_id, id),
      CONSTRAINT lot_inputs_weighing_fk FOREIGN KEY (organization_id, weighing_id) REFERENCES weighings(organization_id, id)
    )`.execute(db);
  await sql`
    CREATE TABLE lot_input_releases (
      input_id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      released_by uuid NOT NULL REFERENCES users(id),
      released_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT lot_input_releases_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT lot_input_releases_fk FOREIGN KEY (organization_id, input_id) REFERENCES lot_inputs(organization_id, id)
    )`.execute(db);
  // Red de seguridad contra doble uso: la suma de asignaciones activas de una recepción no supera su peso vigente,
  // y no se mezcla origen conocido con desconocido en un mismo lote (D-39.1).
  await sql`
    CREATE FUNCTION lot_inputs_check() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE used numeric; cur numeric; l record;
    BEGIN
      SELECT * INTO l FROM lots WHERE id = NEW.lot_id;
      IF l.status <> 'OPEN' OR l.source <> 'RECEPTIONS' THEN RAISE EXCEPTION 'lot_inputs: el lote no admite entradas'; END IF;
      IF (l.origin_status = 'COMPLETE') IS DISTINCT FROM NEW.origin_known THEN RAISE EXCEPTION 'lot_inputs: no se mezcla origen conocido con origen incompleto'; END IF;
      SELECT coalesce(sum(i.quantity), 0) INTO used FROM lot_inputs i WHERE i.reception_id = NEW.reception_id AND NOT EXISTS (SELECT 1 FROM lot_input_releases x WHERE x.input_id = i.id);
      cur := reception_current_quantity(NEW.reception_id);
      IF used + NEW.quantity > cur THEN RAISE EXCEPTION 'lot_inputs: la asignación supera el peso vigente de la recepción (%, usado %)', cur, used USING ERRCODE = '23514'; END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER lot_inputs_check BEFORE INSERT ON lot_inputs FOR EACH ROW EXECUTE FUNCTION lot_inputs_check()`.execute(db);
  // D-39.2: no corregir el peso de una recepción con asignación activa (las liberadas no se consumen: §release).
  await sql`
    CREATE FUNCTION reception_adjustments_assigned_check() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM lot_inputs i WHERE i.reception_id = NEW.reception_id AND NOT EXISTS (SELECT 1 FROM lot_input_releases x WHERE x.input_id = i.id)) THEN
        RAISE EXCEPTION 'reception_adjustments: la recepción tiene asignaciones activas a lotes' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER reception_adjustments_assigned_check BEFORE INSERT ON reception_adjustments FOR EACH ROW EXECUTE FUNCTION reception_adjustments_assigned_check()`.execute(db);

  // Cantidad base de un lote: asignaciones activas (recepciones) o salida materializada (proceso).
  await sql`
    CREATE FUNCTION lot_base_quantity(lid uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
      SELECT CASE WHEN l.source = 'PROCESS_OUTPUT' THEN l.output_quantity
             ELSE coalesce((SELECT sum(i.quantity) FROM lot_inputs i WHERE i.lot_id = l.id AND NOT EXISTS (SELECT 1 FROM lot_input_releases x WHERE x.input_id = i.id)), 0) END
      FROM lots l WHERE l.id = lid
    $$`.execute(db);

  // Entradas de proceso: reservadas mientras el proceso está RUNNING, consumidas al CLOSED, liberadas al CANCELLED.
  await sql`
    CREATE TABLE process_inputs (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      run_id uuid NOT NULL,
      lot_id uuid NOT NULL,
      lot_version bigint NOT NULL,
      quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
      unit text NOT NULL CHECK (unit = 'KG'),
      CONSTRAINT process_inputs_uq UNIQUE (run_id, lot_id),
      CONSTRAINT process_inputs_run_fk FOREIGN KEY (organization_id, run_id) REFERENCES process_runs(organization_id, id),
      CONSTRAINT process_inputs_lot_fk FOREIGN KEY (organization_id, lot_id) REFERENCES lots(organization_id, id)
    )`.execute(db);
  await sql`
    CREATE FUNCTION process_inputs_check() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE used numeric; base numeric;
    BEGIN
      SELECT coalesce(sum(p.quantity), 0) INTO used FROM process_inputs p JOIN process_runs r ON r.id = p.run_id
        WHERE p.lot_id = NEW.lot_id AND r.status IN ('RUNNING','CLOSED');
      base := lot_base_quantity(NEW.lot_id);
      IF used + NEW.quantity > base THEN RAISE EXCEPTION 'process_inputs: la reserva supera la cantidad disponible del lote (%, usado %)', base, used USING ERRCODE = '23514'; END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER process_inputs_check BEFORE INSERT ON process_inputs FOR EACH ROW EXECUTE FUNCTION process_inputs_check()`.execute(db);
  // Liberar una asignación exige que el lote no tenga reservas ni consumo (así una corrección posterior no afecta efectos).
  await sql`
    CREATE FUNCTION lot_input_releases_check() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM process_inputs p JOIN process_runs r ON r.id = p.run_id JOIN lot_inputs i ON i.lot_id = p.lot_id
                 WHERE i.id = NEW.input_id AND r.status IN ('RUNNING','CLOSED')) THEN
        RAISE EXCEPTION 'lot_input_releases: el lote tiene reservas o consumo' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER lot_input_releases_check BEFORE INSERT ON lot_input_releases FOR EACH ROW EXECUTE FUNCTION lot_input_releases_check()`.execute(db);

  // Grafo de origen entre lotes (append-only) con control de ciclos en toda inserción.
  await sql`
    CREATE TABLE lot_edges (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      parent_lot_id uuid NOT NULL,
      child_lot_id uuid NOT NULL,
      run_id uuid NOT NULL,
      quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
      unit text NOT NULL CHECK (unit = 'KG'),
      CONSTRAINT lot_edges_uq UNIQUE (parent_lot_id, child_lot_id, run_id),
      CONSTRAINT lot_edges_not_self CHECK (parent_lot_id <> child_lot_id),
      CONSTRAINT lot_edges_parent_fk FOREIGN KEY (organization_id, parent_lot_id) REFERENCES lots(organization_id, id),
      CONSTRAINT lot_edges_child_fk FOREIGN KEY (organization_id, child_lot_id) REFERENCES lots(organization_id, id),
      CONSTRAINT lot_edges_run_fk FOREIGN KEY (organization_id, run_id) REFERENCES process_runs(organization_id, id)
    )`.execute(db);
  await sql`
    CREATE FUNCTION lot_edges_no_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (WITH RECURSIVE anc(id) AS (SELECT NEW.parent_lot_id UNION SELECT e.parent_lot_id FROM lot_edges e JOIN anc ON e.child_lot_id = anc.id)
                 SELECT 1 FROM anc WHERE id = NEW.child_lot_id) THEN
        RAISE EXCEPTION 'lot_edges: el enlace crearía un ciclo en el grafo de origen' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER lot_edges_no_cycle BEFORE INSERT ON lot_edges FOR EACH ROW EXECUTE FUNCTION lot_edges_no_cycle()`.execute(db);

  await sql`
    CREATE TABLE process_outputs (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      run_id uuid NOT NULL,
      lot_id uuid NOT NULL,
      quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
      unit text NOT NULL CHECK (unit = 'KG'),
      CONSTRAINT process_outputs_run_fk FOREIGN KEY (organization_id, run_id) REFERENCES process_runs(organization_id, id),
      CONSTRAINT process_outputs_lot_fk FOREIGN KEY (organization_id, lot_id) REFERENCES lots(organization_id, id)
    )`.execute(db);
  for (const t of ['lot_inputs', 'lot_input_releases', 'process_inputs', 'lot_edges', 'process_outputs']) await appendOnly(db, t);

  // gate_evaluations: nuevos tipos de entidad.
  await sql`ALTER TABLE gate_evaluations DROP CONSTRAINT gate_evaluations_entity_type_check`.execute(db);
  await sql`ALTER TABLE gate_evaluations ADD CONSTRAINT gate_evaluations_entity_type_check CHECK (entity_type IN ('delivery','reception','quality_result','process_run'))`.execute(db);
  // Compuertas: modo nuevo para transiciones bloqueadas por una decisión pendiente (no convierte el dato en opcional).
  await sql`ALTER TABLE kde_transition_gates DROP CONSTRAINT kde_transition_gates_mode_check`.execute(db);
  await sql`ALTER TABLE kde_transition_gates ADD CONSTRAINT kde_transition_gates_mode_check CHECK (mode IN ('BLOCKING','PENDING_ALLOWED','NOT_EVALUATED','BLOCKED_PENDING_DECISION'))`.execute(db);

  // CTE 1.2.0: solo FERMENTATION pasa a INTEGRATED (cierre demostrado). DRYING sigue PENDING: su cierre está
  // bloqueado por la unidad de humedad (D-32), así que la operación no puede demostrarse todavía.
  const S1 = 'S1 §19 (cte_definitions); eventos propuestos en docs/08';
  await publishCteRelease(db, {
    version: '1.2.0', source: S1, notes: 'P0-016: FERMENTATION integrada (cierre de proceso demostrado). DRYING sigue PENDIENTE (cierre bloqueado por D-32).',
    publish: [{ code: 'FERMENTATION', name: 'Fermentación', description: 'Proceso de fermentación con entradas (lotes), tiempos, salida y merma explícita en KG.', stage: 'INTERNAL', source: S1,
      links: [{ operation: 'PROCESSING_RUN_CLOSE', event_type: 'ProcessingRunClosed', status: 'INTEGRATED', story: 'P0-016', note: 'Cierre atómico e idempotente con balance exacto en KG; compuerta PROCESS_CLOSE_FERMENTATION.' }] }],
  });
  await publishKdeRelease(db, {
    version: '1.3.0', source: `docs/08; ${D39}`,
    notes: 'P0-016: datos de FERMENTATION republicados sobre CTE FERMENTATION@2; lote y proceso pasan a ser referencias verificables. Compuertas de inicio y cierre de procesos.',
    publish: KDE_1_0_0.filter((d) => d.cte === 'FERMENTATION'),
  });
  const B = 'BLOCKING' as const;
  const P = 'PENDING_ALLOWED' as const;
  await publishKdeGates(db, '1.3.0', [
    ...['FERMENTATION_RUN', 'FERMENTATION_INPUT_LOTS', 'FERMENTATION_STARTED_AT'].map((kde) => ({ transition: 'PROCESS_START_FERMENTATION', kde, mode: B, note: 'Iniciar = reservar entradas existentes y disponibles.' })),
    ...['FERMENTATION_RUN', 'FERMENTATION_INPUT_LOTS', 'FERMENTATION_STARTED_AT', 'FERMENTATION_CLOSED_AT', 'FERMENTATION_OUTPUT', 'FERMENTATION_LOSS'].map((kde) => ({ transition: 'PROCESS_CLOSE_FERMENTATION', kde, mode: B, note: 'docs/08: cierre sin entradas, salida o merma (0 admitido) se rechaza; balance exacto en KG.' })),
    ...['DRYING_RUN', 'DRYING_INPUT'].map((kde) => ({ transition: 'PROCESS_START_DRYING', kde, mode: B, note: `Iniciar secado permitido (${D39}.3).` })),
    { transition: 'PROCESS_START_DRYING', kde: 'DRYING_MOISTURE', mode: P, note: 'La humedad se exige al cerrar; iniciar no la vuelve opcional.' },
    ...['DRYING_RUN', 'DRYING_INPUT', 'DRYING_OUTPUT', 'DRYING_LOSS', 'DRYING_MOISTURE'].map((kde) => ({ transition: 'PROCESS_CLOSE_DRYING', kde, mode: B, note: 'docs/08: cierre de secado con entrada, salida, humedad y pérdida medida.' })),
    { transition: 'PROCESS_CLOSE_DRYING', kde: null, mode: 'BLOCKED_PENDING_DECISION' as const, note: `Unidad de humedad no definida (D-32): el cierre de secado queda bloqueado hasta definirla (${D39}.3).` },
  ]);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['process_outputs', 'lot_edges', 'process_inputs', 'lot_input_releases', 'lot_inputs', 'lots', 'process_runs']) await sql.raw(`DROP TABLE ${t}`).execute(db);
}
