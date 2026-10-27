import { Kysely, sql } from 'kysely';
import { publishCteRelease } from '../../traceability/cte-release';
import { publishKdeGates, publishKdeRelease, type KdeDefinitionInput } from '../../traceability/kde-release';
import { KDE_1_0_0 } from './0016_kde_catalog';

// P0-012 Entregas y recepción (RF-12). Contrato: docs/05 (entrega/recepción separadas), docs/06 (deliveries,
// delivery_origins, receptions, quality_samples/results, locations), docs/08 (CTE/KDE DELIVERY, RECEPTION,
// WEIGHING, CLASSIFICATION), docs/09 (POST /deliveries), UX_UI §14. Decisiones de diseño del MVP local
// (docs/22 D-33/D-34/D-35, 2026-10-10; pendientes de validación en campo):
// - Periodo de cosecha con precisión declarada: DAY (fechas), MONTH (mes o intervalo de meses) o UNKNOWN.
//   Se guarda lo declarado; los límites derivados (para consultas) se marcan como derivados.
// - Soportes: varios por entrega, cada uno una versión EXACTA de un documento; su ausencia no impide la
//   recepción física (queda pendiente). Sin aprobación automática del contenido.
// - Calidad: muestra durante la recepción o después del pesaje; sin decisión = «Pendiente de evaluación».
//   Recepción física y decisión de calidad son estados separados. Sin tolerancias ni cierre por debajo de lo
//   declarado (regla no definida).
// Ledger de inventario (P0-017) y lotes (P0-016) NO se implementan aquí: una recepción no crea stock.
// Todas las tablas operativas: organization_id NOT NULL y FK compuestas (organization_id, id).

const appendOnly = async (db: Kysely<unknown>, table: string) => {
  await sql.raw(`
    CREATE FUNCTION ${table}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION '${table} es append-only: corrige con un registro nuevo relacionado'; END $$`).execute(db);
  await sql.raw(`CREATE TRIGGER ${table}_no_mutation BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_append_only()`).execute(db);
};

const D34 = 'D-34 (decisión de diseño MVP 2026-10-10, pendiente de validación en campo)';
const D35 = 'D-35 (decisión de diseño MVP 2026-10-10, pendiente de validación en campo)';
const D33 = 'D-33 calidad/recepción (decisión de diseño MVP 2026-10-10, pendiente de validación en campo)';

/** KDE 1.1.0: se republican los datos de los cuatro hitos (sus CTE pasan a una versión nueva con operación INTEGRATED). */
function kde110(): KdeDefinitionInput[] {
  const ctes = new Set(['DELIVERY', 'RECEPTION', 'WEIGHING', 'CLASSIFICATION']);
  return KDE_1_0_0.filter((d) => ctes.has(d.cte)).map((d): KdeDefinitionInput => {
    if (d.code === 'DELIVERY_SUPPORT') return { ...d, value_type: 'ENTITY_REF_LIST', field: 'delivery_supports (versión exacta)', validation: { entity: 'document', min_items: 1 },
      difference: `docs/06 deliveries no tiene campo de soporte. ${D35}: varios soportes (nota de entrega o recibo firmado como base propuesta; también guía de remisión y liquidación). Su ausencia no impide registrar la recepción física: queda pendiente. No afirma uso real ni validez jurídica.` };
    if (d.code === 'DELIVERY_PRODUCTION_PERIOD') return { ...d, name: 'Periodo de cosecha', value_type: 'HARVEST_PERIOD', requirement: 'REQUIRED', condition: null, validation: {},
      field: 'harvest_precision/harvest_start/harvest_end',
      difference: `docs/06 lo marcaba condicional sin condición escrita. ${D34}: requerido para la completitud de trazabilidad; admite día, mes o intervalo de meses y «desconocido» declarado (cuenta como pendiente, no como dato válido). Periodo de la cosecha, distinto de la fecha de entrega; no se deriva de ella.` };
    if (d.code === 'RECEPTION_DIFFERENCE_REASON') return { ...d, condition: { kind: 'undefined_in_contract', note: `Con recepciones parciales la diferencia frente a lo declarado solo puede evaluarse al cerrar la entrega; el cierre por debajo de lo declarado y las tolerancias no están definidos (${D33}).` },
      difference: 'La condición 1.0.0 comparaba una sola recepción con lo declarado; con recepciones parciales esa comparación no es válida por recepción.' };
    if (d.code === 'WEIGHING_SUBJECT') return { ...d, entity: 'weighings', field: 'reception_id', difference: 'P0-012: la entidad pesada es la recepción (peso real recibido). Pesaje de lotes: P0-016/P0-017.' };
    if (d.code === 'WEIGHING_METHOD' || d.code === 'WEIGHING_VALUE' || d.code === 'WEIGHING_DATE' || d.code === 'WEIGHING_RESPONSIBLE') return { ...d, entity: 'weighings' };
    return d;
  });
}

export async function up(db: Kysely<unknown>): Promise<void> {
  // ---------- Centros (docs/06 locations: code/name/type R; coordenadas O, no se capturan aquí) ----------
  await sql`
    CREATE TABLE locations (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
      name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
      location_type text NOT NULL CHECK (location_type IN ('COLLECTION_CENTER','WAREHOUSE','OTHER')),
      status text NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
      row_version bigint NOT NULL DEFAULT 1,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT locations_org_code_uq UNIQUE (organization_id, code),
      CONSTRAINT locations_org_id_uq UNIQUE (organization_id, id)
    )`.execute(db);
  await sql`
    CREATE FUNCTION locations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'locations: no se borra un centro; desactívalo'; END IF;
      IF NEW.code IS DISTINCT FROM OLD.code OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN RAISE EXCEPTION 'locations: código y organización inmutables'; END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER locations_guard BEFORE UPDATE OR DELETE ON locations FOR EACH ROW EXECUTE FUNCTION locations_guard()`.execute(db);

  // ---------- Entregas ----------
  await sql`
    CREATE TABLE deliveries (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      delivery_code text NOT NULL,
      status text NOT NULL CHECK (status IN ('DRAFT','REGISTERED')),
      producer_id uuid NOT NULL,
      product_id uuid,
      location_id uuid,
      delivery_date date,
      quantity_declared numeric(20,6) CHECK (quantity_declared > 0),
      unit text CHECK (unit = 'KG'),
      harvest_precision text CHECK (harvest_precision IN ('DAY','MONTH','UNKNOWN')),
      harvest_start text,
      harvest_end text,
      harvest_derived_start date,
      harvest_derived_end date,
      notes text CHECK (notes IS NULL OR length(notes) <= 500),
      created_by uuid NOT NULL REFERENCES users(id),
      registered_by uuid REFERENCES users(id),
      registered_at timestamptz,
      operation_id uuid NOT NULL,
      row_version bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT deliveries_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT deliveries_org_code_uq UNIQUE (organization_id, delivery_code),
      CONSTRAINT deliveries_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT deliveries_producer_fk FOREIGN KEY (organization_id, producer_id) REFERENCES producers(organization_id, id),
      CONSTRAINT deliveries_product_fk FOREIGN KEY (organization_id, product_id) REFERENCES products(organization_id, id),
      CONSTRAINT deliveries_location_fk FOREIGN KEY (organization_id, location_id) REFERENCES locations(organization_id, id),
      CONSTRAINT deliveries_registered_complete CHECK (status = 'DRAFT' OR (product_id IS NOT NULL AND delivery_date IS NOT NULL AND quantity_declared IS NOT NULL AND unit IS NOT NULL AND registered_by IS NOT NULL AND registered_at IS NOT NULL)),
      CONSTRAINT deliveries_harvest_shape CHECK (
        (harvest_precision IS NULL AND harvest_start IS NULL AND harvest_end IS NULL AND harvest_derived_start IS NULL AND harvest_derived_end IS NULL)
        OR (harvest_precision = 'UNKNOWN' AND harvest_start IS NULL AND harvest_end IS NULL AND harvest_derived_start IS NULL AND harvest_derived_end IS NULL)
        OR (harvest_precision = 'DAY' AND harvest_start ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND harvest_end ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND harvest_start <= harvest_end
            AND harvest_derived_start = harvest_start::date AND harvest_derived_end = harvest_end::date)
        OR (harvest_precision = 'MONTH' AND harvest_start ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND harvest_end ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND harvest_start <= harvest_end
            AND harvest_derived_start = (harvest_start || '-01')::date AND harvest_derived_end = ((harvest_end || '-01')::date + interval '1 month' - interval '1 day')::date))
    )`.execute(db);
  await sql`CREATE INDEX deliveries_org_date_idx ON deliveries (organization_id, delivery_date DESC, created_at DESC)`.execute(db);
  await sql`CREATE INDEX deliveries_org_producer_idx ON deliveries (organization_id, producer_id)`.execute(db);
  // Una entrega registrada es inmutable: se corrige con delivery_corrections (solo cambia row_version).
  await sql`
    CREATE FUNCTION deliveries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'deliveries: no se borra una entrega'; END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.delivery_code IS DISTINCT FROM OLD.delivery_code
         OR NEW.producer_id IS DISTINCT FROM OLD.producer_id OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'deliveries: organización, código, productor y operación son inmutables';
      END IF;
      IF OLD.status = 'REGISTERED' AND (to_jsonb(NEW) - 'row_version' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'row_version' - 'updated_at') THEN
        RAISE EXCEPTION 'deliveries: una entrega registrada no se modifica; registra una corrección';
      END IF;
      IF OLD.status = 'REGISTERED' AND NEW.status = 'DRAFT' THEN RAISE EXCEPTION 'deliveries: una entrega registrada no vuelve a borrador'; END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER deliveries_guard BEFORE UPDATE OR DELETE ON deliveries FOR EACH ROW EXECUTE FUNCTION deliveries_guard()`.execute(db);

  // Orígenes (docs/05: una entrega puede declarar varias parcelas; cantidad por origen opcional y nunca inventada).
  await sql`
    CREATE TABLE delivery_origins (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      delivery_id uuid NOT NULL,
      plot_id uuid NOT NULL,
      origin_quantity numeric(20,6) CHECK (origin_quantity IS NULL OR origin_quantity > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT delivery_origins_uq UNIQUE (delivery_id, plot_id),
      CONSTRAINT delivery_origins_delivery_fk FOREIGN KEY (organization_id, delivery_id) REFERENCES deliveries(organization_id, id),
      CONSTRAINT delivery_origins_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES plots(organization_id, id)
    )`.execute(db);
  await sql`
    CREATE FUNCTION delivery_origins_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE d record;
    BEGIN
      SELECT status, producer_id INTO d FROM deliveries WHERE id = COALESCE(NEW.delivery_id, OLD.delivery_id);
      IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'delivery_origins: no se modifica un origen'; END IF;
      IF d.status <> 'DRAFT' THEN RAISE EXCEPTION 'delivery_origins: los orígenes de una entrega registrada se corrigen con una corrección'; END IF;
      IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM plots p WHERE p.id = NEW.plot_id AND p.organization_id = NEW.organization_id AND p.producer_id = d.producer_id) THEN
        RAISE EXCEPTION 'delivery_origins: la parcela no pertenece al productor de la entrega';
      END IF;
      RETURN COALESCE(NEW, OLD);
    END $$`.execute(db);
  await sql`CREATE TRIGGER delivery_origins_guard BEFORE INSERT OR UPDATE OR DELETE ON delivery_origins FOR EACH ROW EXECUTE FUNCTION delivery_origins_guard()`.execute(db);

  // Soportes: versión EXACTA de un documento del mismo tenant; varios por entrega; retirar = fila aparte.
  await sql`
    CREATE TABLE delivery_supports (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      delivery_id uuid NOT NULL,
      document_id uuid NOT NULL,
      document_version_id uuid NOT NULL,
      support_kind text NOT NULL CHECK (support_kind IN ('DELIVERY_NOTE','REMISSION_GUIDE','PURCHASE_SETTLEMENT','OTHER')),
      added_by uuid NOT NULL REFERENCES users(id),
      added_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT delivery_supports_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT delivery_supports_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT delivery_supports_delivery_fk FOREIGN KEY (organization_id, delivery_id) REFERENCES deliveries(organization_id, id),
      CONSTRAINT delivery_supports_document_fk FOREIGN KEY (organization_id, document_id) REFERENCES documents(organization_id, id),
      CONSTRAINT delivery_supports_version_fk FOREIGN KEY (organization_id, document_version_id) REFERENCES document_versions(organization_id, id)
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX delivery_supports_active_uq ON delivery_supports (delivery_id, document_version_id)`.execute(db);
  await sql`
    CREATE FUNCTION delivery_supports_check() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.id = NEW.document_version_id AND v.document_id = NEW.document_id AND v.organization_id = NEW.organization_id) THEN
        RAISE EXCEPTION 'delivery_supports: la versión no pertenece al documento';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER delivery_supports_check BEFORE INSERT ON delivery_supports FOR EACH ROW EXECUTE FUNCTION delivery_supports_check()`.execute(db);
  await sql`
    CREATE TABLE delivery_support_withdrawals (
      support_id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      withdrawn_by uuid NOT NULL REFERENCES users(id),
      withdrawn_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT delivery_support_withdrawals_fk FOREIGN KEY (organization_id, support_id) REFERENCES delivery_supports(organization_id, id)
    )`.execute(db);

  // Correcciones de la declaración (instantánea completa de los campos corregibles tras la corrección).
  await sql`
    CREATE TABLE delivery_corrections (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      delivery_id uuid NOT NULL,
      correction_number integer NOT NULL CHECK (correction_number > 0),
      corrected_event_id uuid NOT NULL,
      correction_event_id uuid NOT NULL,
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      changed_fields text[] NOT NULL CHECK (cardinality(changed_fields) > 0),
      delivery_date date NOT NULL,
      quantity_declared numeric(20,6) NOT NULL CHECK (quantity_declared > 0),
      harvest_precision text CHECK (harvest_precision IN ('DAY','MONTH','UNKNOWN')),
      harvest_start text, harvest_end text, harvest_derived_start date, harvest_derived_end date,
      notes text,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT delivery_corrections_number_uq UNIQUE (delivery_id, correction_number),
      CONSTRAINT delivery_corrections_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT delivery_corrections_delivery_fk FOREIGN KEY (organization_id, delivery_id) REFERENCES deliveries(organization_id, id)
    )`.execute(db);

  // ---------- Recepciones y pesajes ----------
  await sql`
    CREATE TABLE receptions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      delivery_id uuid NOT NULL,
      location_id uuid NOT NULL,
      receiver_membership_id uuid NOT NULL,
      receiver_user_id uuid NOT NULL REFERENCES users(id),
      received_at timestamptz NOT NULL,
      quantity_received numeric(20,6) NOT NULL CHECK (quantity_received > 0),
      unit text NOT NULL CHECK (unit = 'KG'),
      notes text CHECK (notes IS NULL OR length(notes) <= 500),
      operation_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT receptions_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT receptions_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT receptions_delivery_fk FOREIGN KEY (organization_id, delivery_id) REFERENCES deliveries(organization_id, id),
      CONSTRAINT receptions_location_fk FOREIGN KEY (organization_id, location_id) REFERENCES locations(organization_id, id),
      CONSTRAINT receptions_receiver_fk FOREIGN KEY (organization_id, receiver_membership_id) REFERENCES memberships(organization_id, id)
    )`.execute(db);
  await sql`CREATE INDEX receptions_delivery_idx ON receptions (organization_id, delivery_id, received_at)`.execute(db);
  await sql`
    CREATE FUNCTION receptions_check() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.id = NEW.delivery_id AND d.organization_id = NEW.organization_id AND d.status = 'REGISTERED') THEN
        RAISE EXCEPTION 'receptions: solo se recibe una entrega registrada';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER receptions_check BEFORE INSERT ON receptions FOR EACH ROW EXECUTE FUNCTION receptions_check()`.execute(db);

  await sql`
    CREATE TABLE weighings (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      reception_id uuid NOT NULL,
      method text NOT NULL CHECK (length(btrim(method)) BETWEEN 1 AND 120),
      quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
      unit text NOT NULL CHECK (unit = 'KG'),
      weighed_on date NOT NULL,
      responsible_membership_id uuid NOT NULL,
      responsible_user_id uuid NOT NULL REFERENCES users(id),
      corrects_weighing_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT weighings_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT weighings_reception_fk FOREIGN KEY (organization_id, reception_id) REFERENCES receptions(organization_id, id),
      CONSTRAINT weighings_responsible_fk FOREIGN KEY (organization_id, responsible_membership_id) REFERENCES memberships(organization_id, id),
      CONSTRAINT weighings_corrects_fk FOREIGN KEY (organization_id, corrects_weighing_id) REFERENCES weighings(organization_id, id)
    )`.execute(db);

  await sql`
    CREATE TABLE reception_adjustments (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      reception_id uuid NOT NULL,
      adjustment_number integer NOT NULL CHECK (adjustment_number > 0),
      weighing_id uuid NOT NULL,
      previous_quantity numeric(20,6) NOT NULL,
      new_quantity numeric(20,6) NOT NULL CHECK (new_quantity > 0),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      corrected_event_id uuid NOT NULL,
      correction_event_id uuid NOT NULL,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT reception_adjustments_number_uq UNIQUE (reception_id, adjustment_number),
      CONSTRAINT reception_adjustments_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT reception_adjustments_reception_fk FOREIGN KEY (organization_id, reception_id) REFERENCES receptions(organization_id, id),
      CONSTRAINT reception_adjustments_weighing_fk FOREIGN KEY (organization_id, weighing_id) REFERENCES weighings(organization_id, id)
    )`.execute(db);

  // ---------- Calidad (docs/06 quality_samples/results; parámetros O; unidad explícita, sin catálogo de límites) ----------
  await sql`
    CREATE TABLE quality_samples (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      reception_id uuid NOT NULL,
      moment text NOT NULL CHECK (moment IN ('DURING_RECEPTION','AFTER_WEIGHING')),
      sample_reference text CHECK (sample_reference IS NULL OR length(btrim(sample_reference)) BETWEEN 1 AND 80),
      sampled_at timestamptz NOT NULL,
      sampled_by_membership_id uuid NOT NULL,
      sampled_by uuid NOT NULL REFERENCES users(id),
      operation_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT quality_samples_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT quality_samples_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT quality_samples_reception_fk FOREIGN KEY (organization_id, reception_id) REFERENCES receptions(organization_id, id),
      CONSTRAINT quality_samples_member_fk FOREIGN KEY (organization_id, sampled_by_membership_id) REFERENCES memberships(organization_id, id)
    )`.execute(db);
  await sql`
    CREATE TABLE quality_results (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      sample_id uuid NOT NULL,
      method text NOT NULL CHECK (length(btrim(method)) BETWEEN 1 AND 120),
      decision text NOT NULL CHECK (decision IN ('PENDING','RELEASED','REJECTED')),
      limits_version text CHECK (limits_version IS NULL OR length(btrim(limits_version)) BETWEEN 1 AND 80),
      decision_reason text CHECK (decision_reason IS NULL OR length(btrim(decision_reason)) BETWEEN 3 AND 500),
      recorded_by_membership_id uuid NOT NULL,
      recorded_by uuid NOT NULL REFERENCES users(id),
      recorded_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT quality_results_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT quality_results_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT quality_results_sample_fk FOREIGN KEY (organization_id, sample_id) REFERENCES quality_samples(organization_id, id),
      CONSTRAINT quality_results_member_fk FOREIGN KEY (organization_id, recorded_by_membership_id) REFERENCES memberships(organization_id, id),
      CONSTRAINT quality_results_released_limits CHECK (decision <> 'RELEASED' OR limits_version IS NOT NULL),
      CONSTRAINT quality_results_rejected_reason CHECK (decision <> 'REJECTED' OR decision_reason IS NOT NULL)
    )`.execute(db);
  await sql`
    CREATE TABLE quality_measurements (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      result_id uuid NOT NULL,
      parameter text NOT NULL CHECK (parameter IN ('MOISTURE','FERMENTATION','IMPURITIES')),
      value numeric(20,6) NOT NULL CHECK (value >= 0),
      unit text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 20),
      CONSTRAINT quality_measurements_uq UNIQUE (result_id, parameter),
      CONSTRAINT quality_measurements_result_fk FOREIGN KEY (organization_id, result_id) REFERENCES quality_results(organization_id, id)
    )`.execute(db);

  // Resultado de cada compuerta evaluada en una transición (instantánea append-only; sin valores, solo códigos).
  await sql`
    CREATE TABLE gate_evaluations (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      entity_type text NOT NULL CHECK (entity_type IN ('delivery','reception','quality_result')),
      entity_id uuid NOT NULL,
      transition text NOT NULL,
      release_version text NOT NULL,
      allowed boolean NOT NULL,
      result jsonb NOT NULL,
      evaluated_by uuid NOT NULL REFERENCES users(id),
      evaluated_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`CREATE INDEX gate_evaluations_entity_idx ON gate_evaluations (organization_id, entity_type, entity_id)`.execute(db);

  for (const t of ['gate_evaluations', 'delivery_supports', 'delivery_support_withdrawals', 'delivery_corrections', 'receptions', 'weighings', 'reception_adjustments', 'quality_samples', 'quality_results', 'quality_measurements']) {
    await appendOnly(db, t);
  }

  // ---------- Compuertas por transición (catálogo de sistema versionado, append-only) ----------
  await sql`ALTER TABLE kde_definitions DROP CONSTRAINT kde_definitions_value_type_check`.execute(db);
  await sql`ALTER TABLE kde_definitions ADD CONSTRAINT kde_definitions_value_type_check CHECK (value_type IN ('QUANTITY','DECIMAL','INTEGER','TEXT','BOOLEAN','DATE','DATETIME','DATE_RANGE','ENUM','ENTITY_REF','ENTITY_REF_LIST','HARVEST_PERIOD'))`.execute(db);
  await sql`
    CREATE TABLE kde_transition_gates (
      id bigserial PRIMARY KEY,
      release_version text NOT NULL REFERENCES kde_catalog_releases(version),
      transition text NOT NULL CHECK (transition ~ '^[A-Z][A-Z_]{2,59}$'),
      kde_code text CHECK (kde_code IS NULL OR kde_code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
      mode text NOT NULL CHECK (mode IN ('BLOCKING','PENDING_ALLOWED','NOT_EVALUATED')),
      note text NOT NULL,
      CONSTRAINT kde_transition_gates_uq UNIQUE (release_version, transition, kde_code)
    )`.execute(db);
  await appendOnly(db, 'kde_transition_gates');

  // CTE 1.1.0: las cuatro operaciones existen ahora con su evento.
  const S1 = 'S1 §19 (cte_definitions); eventos propuestos en docs/08';
  const integrated = (operation: string, event_type: string) => [{ operation, event_type, status: 'INTEGRATED' as const, story: 'P0-012', note: 'Operación implementada en P0-012 con evento, auditoría y compuerta por transición.' }];
  await publishCteRelease(db, {
    version: '1.1.0', source: S1, notes: 'P0-012: DELIVERY, RECEPTION, WEIGHING y CLASSIFICATION pasan a INTEGRATED. Resto sin cambios.',
    publish: [
      { code: 'DELIVERY', name: 'Entrega', description: 'Entrega del productor con parcela(s) de origen, producto, fecha, peso declarado y periodo de cosecha con su precisión.', stage: 'ORIGIN', source: S1, links: integrated('DELIVERY_REGISTER', 'DeliveryRegistered') },
      { code: 'RECEPTION', name: 'Recepción', description: 'Recepción física de una entrega en un centro: receptor, momento y peso real; recepciones parciales con historia propia.', stage: 'INTERNAL', source: S1, links: integrated('RECEPTION_CONFIRM', 'ReceptionConfirmed') },
      { code: 'WEIGHING', name: 'Pesaje', description: 'Pesaje de la recepción con método, valor, unidad, fecha y responsable.', stage: 'INTERNAL', source: S1, links: integrated('WEIGHT_RECORD', 'WeightRecorded') },
      { code: 'CLASSIFICATION', name: 'Clasificación', description: 'Decisión de calidad sobre una muestra con método, mediciones y versión de límites declarada; separada de la recepción física.', stage: 'INTERNAL', source: 'docs/08 (extensión explícita de los procesos de S1)', links: integrated('QUALITY_DECISION', 'QualityDecisionRecorded') },
    ],
  });
  await publishKdeRelease(db, {
    version: '1.1.0', source: `docs/08, docs/06; ${D34}; ${D35}; ${D33}`,
    notes: 'P0-012: datos de los hitos de entrega/recepción republicados sobre CTE 1.1.0; periodo de cosecha con precisión; varios soportes; diferencia evaluable solo al cierre (no definido). Compuertas por transición publicadas aparte.',
    publish: kde110(),
  });
  const B = 'BLOCKING' as const;
  const P = 'PENDING_ALLOWED' as const;
  const N = 'NOT_EVALUATED' as const;
  await publishKdeGates(db, '1.1.0', [
    { transition: 'DELIVERY_DRAFT_SAVE', kde: 'DELIVERY_SUPPLIER', mode: B, note: 'El borrador necesita el productor para su alcance.' },
    ...['DELIVERY_PLOTS', 'DELIVERY_PRODUCT', 'DELIVERY_DATE', 'DELIVERY_DECLARED_WEIGHT', 'DELIVERY_SUPPORT', 'DELIVERY_PRODUCTION_PERIOD'].map((kde) => ({ transition: 'DELIVERY_DRAFT_SAVE', kde, mode: P, note: 'El borrador admite datos pendientes; un valor presente se valida.' })),
    ...['DELIVERY_SUPPLIER', 'DELIVERY_PRODUCT', 'DELIVERY_DATE', 'DELIVERY_DECLARED_WEIGHT'].map((kde) => ({ transition: 'DELIVERY_REGISTER', kde, mode: B, note: 'docs/08: entrega sin peso declarado, producto o fecha se rechaza.' })),
    { transition: 'DELIVERY_REGISTER', kde: 'DELIVERY_PLOTS', mode: P, note: 'UX_UI §14.1: origen faltante se marca como faltante real; no se autocompleta. Una parcela ajena se rechaza al guardarla.' },
    { transition: 'DELIVERY_REGISTER', kde: 'DELIVERY_SUPPORT', mode: P, note: D35 },
    { transition: 'DELIVERY_REGISTER', kde: 'DELIVERY_PRODUCTION_PERIOD', mode: P, note: D34 },
    ...['RECEPTION_DELIVERY', 'RECEPTION_LOCATION', 'RECEPTION_RECEIVER', 'RECEPTION_TIME', 'RECEPTION_RECEIVED_WEIGHT', 'WEIGHING_SUBJECT', 'WEIGHING_METHOD', 'WEIGHING_VALUE', 'WEIGHING_DATE', 'WEIGHING_RESPONSIBLE']
      .map((kde) => ({ transition: 'RECEPTION_CONFIRM', kde, mode: B, note: 'Confirmación física: medición válida con unidad y responsable, centro, receptor (sesión) y momento.' })),
    { transition: 'RECEPTION_CONFIRM', kde: 'RECEPTION_DIFFERENCE_REASON', mode: N, note: `Se evalúa al cerrar la entrega; cierre y tolerancias no definidos (${D33}).` },
    { transition: 'RECEPTION_CONFIRM', kde: 'DELIVERY_SUPPORT', mode: P, note: `${D35}: la recepción física se registra; la evidencia queda pendiente.` },
    { transition: 'RECEPTION_CONFIRM', kde: 'DELIVERY_PRODUCTION_PERIOD', mode: P, note: `${D34}: desconocido permite registrar la recepción; queda pendiente.` },
    { transition: 'RECEPTION_CONFIRM', kde: 'DELIVERY_PLOTS', mode: P, note: 'Origen faltante permanece faltante; no impide la recepción física.' },
    ...['CLASSIFICATION_SAMPLE', 'CLASSIFICATION_METHOD', 'CLASSIFICATION_DECISION', 'CLASSIFICATION_LIMITS_VERSION'].map((kde) => ({ transition: 'QUALITY_DECISION_RECORD', kde, mode: B, note: 'Decisión de calidad: muestra, método y decisión; liberar exige versión de límites (docs/08).' })),
    { transition: 'QUALITY_DECISION_RECORD', kde: 'CLASSIFICATION_MOISTURE', mode: P, note: 'docs/06: humedad opcional; unidad explícita sin catálogo (D-32).' },
    ...['DELIVERY_SUPPLIER', 'DELIVERY_PLOTS', 'DELIVERY_PRODUCT', 'DELIVERY_DATE', 'DELIVERY_DECLARED_WEIGHT', 'DELIVERY_SUPPORT', 'DELIVERY_PRODUCTION_PERIOD',
      'RECEPTION_DELIVERY', 'RECEPTION_LOCATION', 'RECEPTION_RECEIVER', 'RECEPTION_TIME', 'RECEPTION_RECEIVED_WEIGHT', 'WEIGHING_SUBJECT', 'WEIGHING_METHOD', 'WEIGHING_VALUE', 'WEIGHING_DATE', 'WEIGHING_RESPONSIBLE']
      .map((kde) => ({ transition: 'TRACEABILITY_COMPLETENESS', kde, mode: B, note: 'Completitud de trazabilidad/documentación de la entrega (no es expediente ni conformidad).' })),
    { transition: 'TRACEABILITY_COMPLETENESS', kde: 'RECEPTION_DIFFERENCE_REASON', mode: N, note: `Cierre de la entrega no definido (${D33}).` },
    { transition: 'DOWNSTREAM_READINESS', kde: null, mode: N, note: 'Lotes, procesamiento e inventario (P0-016/P0-017) no existen: no se evalúa ni se afirma preparación.' },
  ]);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['gate_evaluations', 'quality_measurements', 'quality_results', 'quality_samples', 'reception_adjustments', 'weighings', 'receptions', 'delivery_corrections', 'delivery_support_withdrawals', 'delivery_supports', 'delivery_origins', 'deliveries', 'locations']) {
    await sql.raw(`DROP TABLE ${t}`).execute(db);
  }
}
