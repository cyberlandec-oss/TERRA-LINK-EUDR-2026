import { Kysely, sql } from 'kysely';
import { publishCteRelease } from '../../traceability/cte-release';
import { publishKdeGates, publishKdeRelease } from '../../traceability/kde-release';

// D-32 y D-33 adoptadas como reglas provisionales del MVP local (2026-10-15, instrucción del responsable de
// producto; no es validación en campo ni aprobación para producción).
// Contratos: docs/decisiones/D-32-PROPUESTA-HUMEDAD.md y docs/decisiones/D-33-PROPUESTA-CIERRE-ENTREGAS.md.
//
// D-32 — Humedad:
//   · `DRYING_MOISTURE` pasa de DECIMAL sin unidad a **QUANTITY con unidad obligatoria `%BH`** (porcentaje en base
//     húmeda). El tope de 100 es estructural —un porcentaje de masa de agua sobre masa total no puede superarlo—,
//     NO un límite de aceptación de calidad: esos siguen pendientes y no se introduce ninguno.
//   · El proceso guarda además **método y responsable** de la medición: es una medición, no un número suelto.
//   · Se retira la compuerta `BLOCKED_PENDING_DECISION` del cierre de secado. El dato sigue siendo BLOCKING: ya no
//     está bloqueado por una decisión, está exigido por el contrato.
//   · La precisión se conserva hasta seis decimales (capacidad de `numeric(20,6)`); más precisión se RECHAZA, no se
//     redondea (el validador de KDE ya trata un séptimo decimal como `DECIMAL_INVALID`).
//
// D-33 — Cierre de entregas: `delivery_closures` **append-only**, una fila por justificación (`CLOSE` y luego
//   `REJUSTIFY`). El estado se DERIVA al leer, nunca se almacena, para que no pueda quedar desincronizado:
//   OPEN · CLOSED · CLOSED_JUSTIFICATION_STALE (la diferencia actual ya no es la justificada). Un motivo nunca se
//   reemplaza: se añade otro. Cerrar no reabre, no admite recepciones nuevas y no afloja ninguna guarda.
export async function up(db: Kysely<unknown>): Promise<void> {
  // ---------------------------------------------------------------- D-32
  await sql`ALTER TABLE process_runs ADD COLUMN moisture_method text, ADD COLUMN moisture_measured_by uuid REFERENCES users(id)`.execute(db);
  // La medición es solidaria: o están los tres datos o no hay ninguno.
  await sql`ALTER TABLE process_runs ADD CONSTRAINT process_runs_moisture_complete CHECK (
    (moisture_value IS NULL AND moisture_unit IS NULL AND moisture_method IS NULL AND moisture_measured_by IS NULL)
    OR (moisture_value IS NOT NULL AND moisture_unit IS NOT NULL AND moisture_method IS NOT NULL AND moisture_measured_by IS NOT NULL))`.execute(db);
  await sql`ALTER TABLE process_runs ADD CONSTRAINT process_runs_moisture_unit CHECK (moisture_unit IS NULL OR moisture_unit = '%BH')`.execute(db);
  await sql`ALTER TABLE process_runs ADD CONSTRAINT process_runs_moisture_range CHECK (moisture_value IS NULL OR (moisture_value >= 0 AND moisture_value <= 100))`.execute(db);

  const S08 = 'docs/08 (KDE por hito); S1 §18';
  await publishKdeRelease(db, {
    version: '1.6.0', source: `${S08}; D-32 adoptada 2026-10-15`,
    notes: 'D-32: DRYING_MOISTURE pasa a QUANTITY con unidad obligatoria %BH (porcentaje en base húmeda), con método y responsable declarados. El tope de 100 es estructural, no un límite de calidad.',
    publish: [{
      code: 'DRYING_MOISTURE', cte: 'DRYING', name: 'Humedad al cierre del secado', entity: 'process_runs', field: 'moisture_value/moisture_unit',
      value_type: 'QUANTITY', requirement: 'REQUIRED', condition: null,
      validation: { non_negative: true, max: 100, allowed_units: ['%BH'], dimension: 'MOISTURE' },
      responsible_roles: ['QUALITY_OPERATOR'],
      responsible_note: 'La mide quien evalúa calidad; el cierre del proceso lo registra con su método y su responsable.',
      source: `${S08}; S4 (ejemplo «Humedad 7,2 %»)`,
      difference: 'Las fuentes nombran la humedad pero no su base ni su método. D-32 (2026-10-15) adopta porcentaje en BASE HÚMEDA con método declarado por medición. Sin límites de aceptación: no se decide si un valor es «bueno».',
    }],
  });

  // Compuertas republicadas al completo para las dos transiciones de secado (la vigente es la última por transición).
  await publishKdeGates(db, '1.6.0', [
    ...['DRYING_RUN', 'DRYING_INPUT'].map((kde) => ({ transition: 'PROCESS_START_DRYING', kde, mode: 'BLOCKING' as const, note: 'Iniciar = reservar entradas existentes y disponibles.' })),
    { transition: 'PROCESS_START_DRYING', kde: 'DRYING_MOISTURE', mode: 'PENDING_ALLOWED' as const, note: 'La humedad se exige al cerrar; iniciar no la vuelve opcional.' },
    ...['DRYING_RUN', 'DRYING_INPUT', 'DRYING_OUTPUT', 'DRYING_LOSS', 'DRYING_MOISTURE'].map((kde) => ({
      transition: 'PROCESS_CLOSE_DRYING', kde, mode: 'BLOCKING' as const,
      note: 'docs/08: cierre de secado con entrada, salida, humedad y pérdida medida. Humedad en %BH con método y responsable (D-32).',
    })),
  ]);

  // CTE 1.6.0: DRYING pasa a INTEGRATED. Se publica aquí porque el cierre ya es ejecutable; la prueba de que la
  // operación y su evento existen está en la suite de P0-016 (cierre real de secado con balance exacto).
  await publishCteRelease(db, {
    version: '1.6.0', source: 'S1 §19 (cte_definitions); eventos en docs/08',
    notes: 'D-32: DRYING pasa a INTEGRATED; su cierre deja de estar bloqueado por una decisión pendiente y se demuestra con su operación y su evento.',
    publish: [{
      code: 'DRYING', name: 'Secado', description: 'Proceso de secado con entradas (lotes), tiempos, salida, merma explícita en KG y humedad final medida en %BH.',
      stage: 'INTERNAL', source: 'S1 §19',
      links: [{ operation: 'PROCESSING_RUN_CLOSE', event_type: 'ProcessingRunClosed', status: 'INTEGRATED', story: 'P0-016', note: 'Cierre atómico e idempotente con balance exacto en KG y humedad obligatoria (D-32); compuerta PROCESS_CLOSE_DRYING.' }],
    }],
  });

  // ---------------------------------------------------------------- D-33
  // La compuerta de confirmación de recepción decía, desde 0021, que el cierre «no está definido (D-33)». Ya lo está.
  // El modo NO cambia —la causa de la diferencia se sigue evaluando al cerrar, no al recibir—; lo que cambia es que la
  // nota deje de afirmar algo falso. Se republica la transición COMPLETA porque la vigente es la última por transición.
  await publishKdeGates(db, '1.6.0', [
    ...['RECEPTION_DELIVERY', 'RECEPTION_LOCATION', 'RECEPTION_RECEIVER', 'RECEPTION_TIME', 'RECEPTION_RECEIVED_WEIGHT', 'WEIGHING_SUBJECT', 'WEIGHING_METHOD', 'WEIGHING_VALUE', 'WEIGHING_DATE', 'WEIGHING_RESPONSIBLE']
      .map((kde) => ({ transition: 'RECEPTION_CONFIRM', kde, mode: 'BLOCKING' as const, note: 'Confirmación física: medición válida con unidad y responsable, centro, receptor (sesión) y momento.' })),
    { transition: 'RECEPTION_CONFIRM', kde: 'RECEPTION_DIFFERENCE_REASON', mode: 'NOT_EVALUATED' as const, note: 'Se evalúa al cerrar la entrega, no al recibir: una recepción parcial no es todavía una diferencia. El cierre exige motivo para cualquier diferencia (D-33, 2026-10-15).' },
    { transition: 'RECEPTION_CONFIRM', kde: 'DELIVERY_SUPPORT', mode: 'PENDING_ALLOWED' as const, note: 'D-35: la recepción física se registra; la evidencia queda pendiente.' },
    { transition: 'RECEPTION_CONFIRM', kde: 'DELIVERY_PRODUCTION_PERIOD', mode: 'PENDING_ALLOWED' as const, note: 'D-34: desconocido permite registrar la recepción; queda pendiente.' },
    { transition: 'RECEPTION_CONFIRM', kde: 'DELIVERY_PLOTS', mode: 'PENDING_ALLOWED' as const, note: 'Origen faltante permanece faltante; no impide la recepción física.' },
  ]);

  await sql`ALTER TABLE deliveries DROP CONSTRAINT deliveries_status_check`.execute(db);
  await sql`ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check CHECK (status IN ('DRAFT','REGISTERED','CLOSED'))`.execute(db);

  // El guardián de entregas se reescribe para admitir EXACTAMENTE una transición nueva, REGISTERED → CLOSED, y
  // para que **la base** impida reabrir: una entrega cerrada solo puede cambiar su `row_version` (las
  // justificaciones posteriores la incrementan). No se confía la irreversibilidad a la capa de aplicación.
  await sql`
    CREATE OR REPLACE FUNCTION deliveries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE solo_version boolean;
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'deliveries: no se borra una entrega'; END IF;
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.delivery_code IS DISTINCT FROM OLD.delivery_code
         OR NEW.producer_id IS DISTINCT FROM OLD.producer_id OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'deliveries: organización, código, productor y operación son inmutables';
      END IF;
      solo_version := (to_jsonb(NEW) - 'row_version' - 'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'row_version' - 'updated_at');
      IF OLD.status = 'REGISTERED' AND NOT solo_version THEN
        -- Única excepción: cerrar. Cualquier otro cambio sigue exigiendo una corrección registrada.
        IF NOT (NEW.status = 'CLOSED' AND (to_jsonb(NEW) - 'row_version' - 'updated_at' - 'status') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'row_version' - 'updated_at' - 'status')) THEN
          RAISE EXCEPTION 'deliveries: una entrega registrada no se modifica; registra una corrección';
        END IF;
      END IF;
      IF OLD.status = 'CLOSED' AND NOT solo_version THEN
        RAISE EXCEPTION 'deliveries: una entrega cerrada no se modifica ni se reabre (D-33); si llegó más material, registra otra entrega';
      END IF;
      IF OLD.status = 'REGISTERED' AND NEW.status = 'DRAFT' THEN RAISE EXCEPTION 'deliveries: una entrega registrada no vuelve a borrador'; END IF;
      RETURN NEW;
    END $$`.execute(db);

  await sql`
    CREATE TABLE delivery_closures (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      delivery_id uuid NOT NULL,
      justification_number integer NOT NULL CHECK (justification_number > 0),
      kind text NOT NULL CHECK (kind IN ('CLOSE','REJUSTIFY')),
      -- Las tres cifras TAL COMO ERAN al justificar; no se recalculan después.
      declared_quantity numeric(20,6) NOT NULL,
      received_quantity numeric(20,6) NOT NULL,
      difference numeric(20,6) NOT NULL,
      -- Motivo obligatorio cuando hay diferencia; nulo solo si la diferencia es exactamente cero.
      reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 500),
      justified_by uuid NOT NULL REFERENCES users(id),
      justified_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT delivery_closures_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT delivery_closures_number_uq UNIQUE (delivery_id, justification_number),
      CONSTRAINT delivery_closures_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT delivery_closures_delivery_fk FOREIGN KEY (organization_id, delivery_id) REFERENCES deliveries(organization_id, id),
      CONSTRAINT delivery_closures_reason_required CHECK ((difference = 0) OR (reason IS NOT NULL)),
      CONSTRAINT delivery_closures_difference CHECK (difference = declared_quantity - received_quantity),
      -- La primera justificación es la que cierra; las siguientes solo actualizan el motivo.
      CONSTRAINT delivery_closures_first_closes CHECK ((justification_number = 1) = (kind = 'CLOSE'))
    )`.execute(db);
  await sql`CREATE INDEX delivery_closures_delivery_idx ON delivery_closures (organization_id, delivery_id, justification_number DESC)`.execute(db);

  // Append-only: un motivo no se reemplaza nunca; se añade otra justificación.
  await sql`CREATE FUNCTION delivery_closures_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    RAISE EXCEPTION 'delivery_closures es append-only: una justificación nueva se añade, la anterior se conserva'; END $$`.execute(db);
  await sql`CREATE TRIGGER delivery_closures_no_mutation BEFORE UPDATE OR DELETE ON delivery_closures FOR EACH ROW EXECUTE FUNCTION delivery_closures_append_only()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION deliveries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  await sql`DROP TABLE delivery_closures`.execute(db);
  await sql`DROP FUNCTION delivery_closures_append_only`.execute(db);
  await sql`ALTER TABLE deliveries DROP CONSTRAINT deliveries_status_check`.execute(db);
  await sql`ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check CHECK (status IN ('DRAFT','REGISTERED'))`.execute(db);
  for (const c of ['process_runs_moisture_range', 'process_runs_moisture_unit', 'process_runs_moisture_complete']) {
    await sql.raw(`ALTER TABLE process_runs DROP CONSTRAINT ${c}`).execute(db);
  }
  await sql`ALTER TABLE process_runs DROP COLUMN moisture_measured_by, DROP COLUMN moisture_method`.execute(db);
}
