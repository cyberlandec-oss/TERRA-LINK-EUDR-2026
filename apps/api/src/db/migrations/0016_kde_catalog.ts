import { Kysely, sql } from 'kysely';
import { publishKdeRelease, type KdeDefinitionInput } from '../../traceability/kde-release';

// P0-014 KDE (RF-14). Catálogo de SISTEMA versionado de datos mínimos por hito (versión exacta del CTE).
// Fuente principal: tabla «CTE / KDE mínimos / actor» de docs/08; campos de docs/06 y docs/09; ejemplos de
// S1 §18 (DELIVERY_WEIGHT, DELIVERY_DATE, SUPPLIER, LOT_CODE, MOISTURE, PLOT_ID).
// Reglas de lectura de las fuentes (sin inventar):
// - Un dato listado como «KDE mínimo» en docs/08 es REQUIRED dentro de su hito, salvo calificador explícito
//   («si medida», «si disponible») → CONDITIONAL / OPTIONAL.
// - Un campo «C» de docs/06 sin condición escrita → CONDITIONAL con condición `undefined_in_contract`:
//   el validador la reporta como no evaluable y bloquea (D-34). No se elige un valor por defecto.
// - Roles responsables: los de la columna «actor habitual» de docs/08 que existen en el catálogo RBAC;
//   «operación» y «gestión» no son roles definidos y se registran como diferencia.
// - La obligatoriedad del HITO dentro de un flujo sigue pendiente (D-33); esto es la del DATO dentro del hito.
// - Unidades: solo KG (masa), única unidad aceptada (D-32). Sin conversiones.
const KG = { allowed_units: ['KG'], dimension: 'MASS' };
const S08 = 'docs/08 (KDE mínimos por CTE)';
type D = KdeDefinitionInput;
const def = (o: Omit<D, 'condition' | 'difference' | 'responsible_note'> & Partial<Pick<D, 'condition' | 'difference' | 'responsible_note'>>): D =>
  ({ condition: null, difference: null, responsible_note: '', ...o });

const FIELD_ROLES = ['PRODUCER', 'FIELD_TECHNICIAN'];
const RECEPTION = ['RECEPTION_OPERATOR'];
const QUALITY = ['QUALITY_OPERATOR'];

export const KDE_1_0_0: D[] = [
  // HARVEST — docs/06 production_records
  def({ code: 'HARVEST_PLOT_VERSION', cte: 'HARVEST', name: 'Parcela y versión geométrica', entity: 'production_records', field: 'plot_id', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'plot_version' }, responsible_roles: FIELD_ROLES, source: S08, difference: 'docs/08 pide parcela/versión; docs/06 production_records solo tiene plot_id.' }),
  def({ code: 'HARVEST_PRODUCER', cte: 'HARVEST', name: 'Productor', entity: 'production_records', field: '— (derivado de la parcela)', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'producer' }, responsible_roles: FIELD_ROLES, source: S08, difference: 'docs/06 production_records no tiene producer_id.' }),
  def({ code: 'HARVEST_PERIOD', cte: 'HARVEST', name: 'Periodo de cosecha', entity: 'production_records', field: 'period_start/period_end', value_type: 'DATE_RANGE', requirement: 'REQUIRED', validation: {}, responsible_roles: FIELD_ROLES, source: S08 }),
  def({ code: 'HARVEST_PRODUCT', cte: 'HARVEST', name: 'Producto', entity: 'production_records', field: 'product_id', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'product' }, responsible_roles: FIELD_ROLES, source: S08 }),
  def({ code: 'HARVEST_QUANTITY_MEASURED', cte: 'HARVEST', name: '¿Se midió la cantidad?', entity: '—', field: '—', value_type: 'BOOLEAN', requirement: 'OPTIONAL', validation: {}, responsible_roles: FIELD_ROLES, source: S08, difference: 'Condición «si medida» de docs/08 sin campo en docs/06; sin este dato la cantidad queda como condición no evaluable.' }),
  def({ code: 'HARVEST_QUANTITY', cte: 'HARVEST', name: 'Cantidad cosechada', entity: 'production_records', field: 'quantity_actual/unit', value_type: 'QUANTITY', requirement: 'CONDITIONAL', condition: { kind: 'equals', kde: 'HARVEST_QUANTITY_MEASURED', value: true }, validation: { ...KG, positive: true }, responsible_roles: FIELD_ROLES, source: S08 }),
  // DELIVERY — docs/06 deliveries, docs/09
  def({ code: 'DELIVERY_SUPPLIER', cte: 'DELIVERY', name: 'Proveedor (productor)', entity: 'deliveries', field: 'producer_id', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'producer' }, responsible_roles: FIELD_ROLES, source: `${S08}; S1 §18 SUPPLIER`, difference: 'docs/06 admite producer_id o supplier_id según flujo; no existe entidad de proveedor no productor.' }),
  def({ code: 'DELIVERY_PLOTS', cte: 'DELIVERY', name: 'Parcela(s) de origen', entity: 'deliveries', field: 'plot_id (docs/09)', value_type: 'ENTITY_REF_LIST', requirement: 'REQUIRED', validation: { entity: 'plot', min_items: 1 }, responsible_roles: FIELD_ROLES, source: `${S08}; S1 §18 PLOT_ID`, difference: 'docs/06 deliveries no tiene parcela; docs/09 usa plot_id y propone un arreglo tipado. Origen desconocido queda como faltante (docs/08 PLOT_ID).' }),
  def({ code: 'DELIVERY_PRODUCT', cte: 'DELIVERY', name: 'Producto', entity: 'deliveries', field: 'product_id', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'product' }, responsible_roles: FIELD_ROLES, source: S08 }),
  def({ code: 'DELIVERY_DATE', cte: 'DELIVERY', name: 'Fecha de entrega', entity: 'deliveries', field: 'delivery_date', value_type: 'DATE', requirement: 'REQUIRED', validation: {}, responsible_roles: FIELD_ROLES, source: `${S08}; S1 §18 DELIVERY_DATE` }),
  def({ code: 'DELIVERY_DECLARED_WEIGHT', cte: 'DELIVERY', name: 'Peso declarado', entity: 'deliveries', field: 'quantity_declared/unit', value_type: 'QUANTITY', requirement: 'REQUIRED', validation: { ...KG, positive: true }, responsible_roles: FIELD_ROLES, source: `${S08}; S1 §18 DELIVERY_WEIGHT; docs/08 «cantidad positiva y unidad»` }),
  def({ code: 'DELIVERY_SUPPORT', cte: 'DELIVERY', name: 'Soporte documental', entity: 'deliveries', field: '—', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'document' }, responsible_roles: FIELD_ROLES, source: S08, difference: 'docs/06 deliveries no tiene campo de soporte; los documentos llegan con P0-018 (referencia no verificable hasta entonces).' }),
  def({ code: 'DELIVERY_PRODUCTION_PERIOD', cte: 'DELIVERY', name: 'Periodo de producción', entity: 'deliveries', field: 'production_period', value_type: 'DATE_RANGE', requirement: 'CONDITIONAL', condition: { kind: 'undefined_in_contract', note: 'docs/06 marca production_period como condicional sin escribir la condición (D-34).' }, validation: {}, responsible_roles: FIELD_ROLES, source: 'docs/06 deliveries', difference: 'No figura en la tabla de docs/08.' }),
  // RECEPTION — docs/06 receptions
  def({ code: 'RECEPTION_DELIVERY', cte: 'RECEPTION', name: 'Entrega recibida', entity: 'receptions', field: 'delivery_id', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'delivery' }, responsible_roles: RECEPTION, source: S08 }),
  def({ code: 'RECEPTION_LOCATION', cte: 'RECEPTION', name: 'Centro de recepción', entity: 'receptions', field: 'location_id', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'location' }, responsible_roles: RECEPTION, source: S08 }),
  def({ code: 'RECEPTION_RECEIVER', cte: 'RECEPTION', name: 'Receptor', entity: 'receptions', field: 'receiver_id', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'membership' }, responsible_roles: RECEPTION, source: S08 }),
  def({ code: 'RECEPTION_TIME', cte: 'RECEPTION', name: 'Momento de recepción', entity: 'receptions', field: 'received_at', value_type: 'DATETIME', requirement: 'REQUIRED', validation: {}, responsible_roles: RECEPTION, source: S08 }),
  def({ code: 'RECEPTION_RECEIVED_WEIGHT', cte: 'RECEPTION', name: 'Peso real recibido', entity: 'receptions', field: 'quantity_received', value_type: 'QUANTITY', requirement: 'REQUIRED', validation: { ...KG, positive: true }, responsible_roles: RECEPTION, source: S08 }),
  def({ code: 'RECEPTION_DIFFERENCE_REASON', cte: 'RECEPTION', name: 'Causa de la diferencia', entity: 'receptions', field: 'difference_reason', value_type: 'TEXT', requirement: 'CONDITIONAL', condition: { kind: 'quantities_differ', a: 'RECEPTION_RECEIVED_WEIGHT', b: 'DELIVERY_DECLARED_WEIGHT' }, validation: { max_length: 500 }, responsible_roles: RECEPTION, source: `${S08}; docs/06 receptions.difference_reason C; P0-012 «diferencias con causa»` }),
  // WEIGHING — sin entidad propia en docs/06
  def({ code: 'WEIGHING_SUBJECT', cte: 'WEIGHING', name: 'Entidad pesada', entity: '—', field: '—', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'weighable' }, responsible_roles: RECEPTION, source: S08, difference: 'docs/06 no define una entidad de pesaje; P0-012 decidirá su modelo.' }),
  def({ code: 'WEIGHING_METHOD', cte: 'WEIGHING', name: 'Método de pesaje', entity: '—', field: '—', value_type: 'TEXT', requirement: 'REQUIRED', validation: { max_length: 120 }, responsible_roles: RECEPTION, source: S08, difference: 'Sin catálogo de métodos en las fuentes: texto libre acotado.' }),
  def({ code: 'WEIGHING_VALUE', cte: 'WEIGHING', name: 'Valor pesado', entity: '—', field: '—', value_type: 'QUANTITY', requirement: 'REQUIRED', validation: { ...KG, positive: true }, responsible_roles: RECEPTION, source: S08 }),
  def({ code: 'WEIGHING_DATE', cte: 'WEIGHING', name: 'Fecha de pesaje', entity: '—', field: '—', value_type: 'DATE', requirement: 'REQUIRED', validation: {}, responsible_roles: RECEPTION, source: S08 }),
  def({ code: 'WEIGHING_RESPONSIBLE', cte: 'WEIGHING', name: 'Responsable del pesaje', entity: '—', field: '—', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'membership' }, responsible_roles: RECEPTION, source: S08 }),
  // CLASSIFICATION — docs/06 quality_samples/results
  def({ code: 'CLASSIFICATION_SAMPLE', cte: 'CLASSIFICATION', name: 'Muestra', entity: 'quality_samples', field: 'id', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'sample' }, responsible_roles: QUALITY, source: S08 }),
  def({ code: 'CLASSIFICATION_METHOD', cte: 'CLASSIFICATION', name: 'Método de análisis', entity: 'quality_results', field: 'method', value_type: 'TEXT', requirement: 'REQUIRED', validation: { max_length: 120 }, responsible_roles: QUALITY, source: S08, difference: 'docs/08 lo lista como mínimo; docs/06 lo marca condicional.' }),
  def({ code: 'CLASSIFICATION_MOISTURE', cte: 'CLASSIFICATION', name: 'Humedad', entity: 'quality_results', field: 'moisture', value_type: 'DECIMAL', requirement: 'OPTIONAL', validation: { non_negative: true }, responsible_roles: QUALITY, source: `${S08}; S1 §18 MOISTURE; docs/06 moisture O`, difference: 'docs/06 deja la unidad como condicional sin definir; el valor se registra sin unidad hasta decidirla (D-32).' }),
  def({ code: 'CLASSIFICATION_DECISION', cte: 'CLASSIFICATION', name: 'Decisión de calidad', entity: 'quality_results', field: 'decision', value_type: 'ENUM', requirement: 'REQUIRED', validation: { values: ['RELEASED', 'REJECTED'] }, responsible_roles: QUALITY, source: `${S08}; docs/06 decision R; docs/07 «liberar/rechazar calidad»` }),
  def({ code: 'CLASSIFICATION_LIMITS_VERSION', cte: 'CLASSIFICATION', name: 'Versión de límites aplicada', entity: 'quality_results', field: 'limits_version', value_type: 'TEXT', requirement: 'CONDITIONAL', condition: { kind: 'equals', kde: 'CLASSIFICATION_DECISION', value: 'RELEASED' }, validation: { max_length: 80 }, responsible_roles: QUALITY, source: 'docs/06 quality «si libera, justificar con parámetros vigentes»' }),
  // FERMENTATION — docs/06 process_runs/process_inputs/outputs
  def({ code: 'FERMENTATION_RUN', cte: 'FERMENTATION', name: 'Proceso', entity: 'process_runs', field: 'id', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'process_run' }, responsible_roles: ['TRACEABILITY_MANAGER'], responsible_note: 'docs/08 también nombra «operación», que no es un rol definido.', source: S08 }),
  def({ code: 'FERMENTATION_INPUT_LOTS', cte: 'FERMENTATION', name: 'Lotes de entrada', entity: 'process_inputs', field: 'lot_id', value_type: 'ENTITY_REF_LIST', requirement: 'REQUIRED', validation: { entity: 'lot', min_items: 1 }, responsible_roles: ['TRACEABILITY_MANAGER'], source: `${S08}; S1 §18 LOT_CODE` }),
  def({ code: 'FERMENTATION_STARTED_AT', cte: 'FERMENTATION', name: 'Inicio', entity: 'process_runs', field: 'started_at', value_type: 'DATETIME', requirement: 'REQUIRED', validation: {}, responsible_roles: ['TRACEABILITY_MANAGER'], source: S08, difference: 'docs/08 «tiempos» como mínimo; docs/06 started_at condicional.' }),
  def({ code: 'FERMENTATION_CLOSED_AT', cte: 'FERMENTATION', name: 'Cierre', entity: 'process_runs', field: 'closed_at', value_type: 'DATETIME', requirement: 'REQUIRED', validation: {}, responsible_roles: ['TRACEABILITY_MANAGER'], source: S08, difference: 'docs/08 «tiempos» como mínimo; docs/06 closed_at condicional.' }),
  def({ code: 'FERMENTATION_OUTPUT', cte: 'FERMENTATION', name: 'Salida', entity: 'process_outputs', field: 'quantity/unit', value_type: 'QUANTITY', requirement: 'REQUIRED', validation: { ...KG, positive: true }, responsible_roles: ['TRACEABILITY_MANAGER'], source: S08 }),
  def({ code: 'FERMENTATION_LOSS', cte: 'FERMENTATION', name: 'Merma', entity: 'process_runs', field: 'loss_quantity', value_type: 'QUANTITY', requirement: 'REQUIRED', validation: { ...KG, non_negative: true }, responsible_roles: ['TRACEABILITY_MANAGER'], source: S08, difference: 'docs/06 loss_quantity condicional; docs/08 la lista como mínimo. Se admite 0 (sin merma), distinto de ausente.' }),
  // DRYING
  def({ code: 'DRYING_RUN', cte: 'DRYING', name: 'Proceso', entity: 'process_runs', field: 'id', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'process_run' }, responsible_roles: ['QUALITY_OPERATOR'], responsible_note: 'docs/08: «operación/calidad»; «operación» no es un rol definido.', source: S08 }),
  def({ code: 'DRYING_INPUT', cte: 'DRYING', name: 'Entrada', entity: 'process_inputs', field: 'quantity/unit', value_type: 'QUANTITY', requirement: 'REQUIRED', validation: { ...KG, positive: true }, responsible_roles: ['QUALITY_OPERATOR'], source: S08 }),
  def({ code: 'DRYING_OUTPUT', cte: 'DRYING', name: 'Salida', entity: 'process_outputs', field: 'quantity/unit', value_type: 'QUANTITY', requirement: 'REQUIRED', validation: { ...KG, positive: true }, responsible_roles: ['QUALITY_OPERATOR'], source: S08 }),
  def({ code: 'DRYING_MOISTURE', cte: 'DRYING', name: 'Humedad', entity: '—', field: '—', value_type: 'DECIMAL', requirement: 'REQUIRED', validation: { non_negative: true }, responsible_roles: ['QUALITY_OPERATOR'], source: S08, difference: 'Sin unidad definida en las fuentes (D-32).' }),
  def({ code: 'DRYING_LOSS', cte: 'DRYING', name: 'Pérdida medida', entity: 'process_runs', field: 'loss_quantity', value_type: 'QUANTITY', requirement: 'REQUIRED', validation: { ...KG, non_negative: true }, responsible_roles: ['QUALITY_OPERATOR'], source: S08 }),
  // STORAGE — docs/06 stock_entries
  def({ code: 'STORAGE_LOT', cte: 'STORAGE', name: 'Lote', entity: 'stock_entries', field: 'lot_id', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'lot' }, responsible_roles: [], responsible_note: 'docs/08: «operación», que no es un rol definido.', source: S08 }),
  def({ code: 'STORAGE_LOCATION', cte: 'STORAGE', name: 'Centro o ubicación', entity: 'stock_entries', field: 'location_id', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'location' }, responsible_roles: [], responsible_note: 'docs/08: «operación».', source: S08 }),
  def({ code: 'STORAGE_QUANTITY', cte: 'STORAGE', name: 'Cantidad', entity: 'stock_entries', field: 'signed_quantity/unit', value_type: 'QUANTITY', requirement: 'REQUIRED', validation: { ...KG, positive: true }, responsible_roles: [], responsible_note: 'docs/08: «operación».', source: S08, difference: 'docs/06 usa cantidad con signo; aquí se registra la magnitud y la dirección por separado.' }),
  def({ code: 'STORAGE_DIRECTION', cte: 'STORAGE', name: 'Entrada o salida', entity: 'stock_entries', field: 'movement_type', value_type: 'ENUM', requirement: 'REQUIRED', validation: { values: ['IN', 'OUT'] }, responsible_roles: [], responsible_note: 'docs/08: «operación».', source: S08 }),
  def({ code: 'STORAGE_RESPONSIBLE', cte: 'STORAGE', name: 'Responsable', entity: '—', field: '—', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'membership' }, responsible_roles: [], responsible_note: 'docs/08: «operación».', source: S08 }),
  // PACKAGING
  def({ code: 'PACKAGING_LOT', cte: 'PACKAGING', name: 'Lote', entity: '—', field: '—', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'lot' }, responsible_roles: [], responsible_note: 'docs/08: «operación».', source: S08 }),
  def({ code: 'PACKAGING_UNITS', cte: 'PACKAGING', name: 'Unidades físicas', entity: '—', field: '—', value_type: 'INTEGER', requirement: 'REQUIRED', validation: { positive: true }, responsible_roles: [], responsible_note: 'docs/08: «operación».', source: S08 }),
  def({ code: 'PACKAGING_WEIGHT', cte: 'PACKAGING', name: 'Peso', entity: '—', field: '—', value_type: 'QUANTITY', requirement: 'REQUIRED', validation: { ...KG, positive: true }, responsible_roles: [], responsible_note: 'docs/08: «operación».', source: S08 }),
  def({ code: 'PACKAGING_DATE', cte: 'PACKAGING', name: 'Fecha', entity: '—', field: '—', value_type: 'DATE', requirement: 'REQUIRED', validation: {}, responsible_roles: [], responsible_note: 'docs/08: «operación».', source: S08 }),
  def({ code: 'PACKAGING_CODE', cte: 'PACKAGING', name: 'Código de envase', entity: '—', field: '—', value_type: 'TEXT', requirement: 'REQUIRED', validation: { max_length: 80 }, responsible_roles: [], responsible_note: 'docs/08: «operación».', source: S08 }),
  // SALE
  def({ code: 'SALE_COUNTERPARTY', cte: 'SALE', name: 'Contraparte', entity: '—', field: '—', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'counterparty' }, responsible_roles: ['EXPORT_MANAGER'], responsible_note: 'docs/08: «gestión/exportación»; «gestión» no es un rol definido.', source: S08 }),
  def({ code: 'SALE_LOT', cte: 'SALE', name: 'Lote', entity: '—', field: '—', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'lot' }, responsible_roles: ['EXPORT_MANAGER'], source: S08 }),
  def({ code: 'SALE_QUANTITY', cte: 'SALE', name: 'Cantidad', entity: '—', field: '—', value_type: 'QUANTITY', requirement: 'REQUIRED', validation: { ...KG, positive: true }, responsible_roles: ['EXPORT_MANAGER'], source: S08 }),
  def({ code: 'SALE_PRICE', cte: 'SALE', name: 'Precio', entity: '—', field: '—', value_type: 'DECIMAL', requirement: 'OPTIONAL', validation: { non_negative: true }, responsible_roles: ['EXPORT_MANAGER'], source: `${S08} «si disponible»` }),
  def({ code: 'SALE_CURRENCY', cte: 'SALE', name: 'Moneda', entity: '—', field: '—', value_type: 'TEXT', requirement: 'CONDITIONAL', condition: { kind: 'present', kde: 'SALE_PRICE' }, validation: { pattern: 'ISO_4217' }, responsible_roles: ['EXPORT_MANAGER'], source: `${S08}; docs/06 «dinero con moneda explícita»` }),
  // SHIPMENT — docs/06 shipments/items
  def({ code: 'SHIPMENT_REF', cte: 'SHIPMENT', name: 'Embarque', entity: 'shipments', field: 'id', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'shipment' }, responsible_roles: ['EXPORT_MANAGER'], source: S08 }),
  def({ code: 'SHIPMENT_BUYER', cte: 'SHIPMENT', name: 'Comprador', entity: 'shipments', field: 'buyer', value_type: 'ENTITY_REF', requirement: 'REQUIRED', validation: { entity: 'buyer' }, responsible_roles: ['EXPORT_MANAGER'], source: S08 }),
  def({ code: 'SHIPMENT_DESTINATION', cte: 'SHIPMENT', name: 'Destino', entity: 'shipments', field: 'destination', value_type: 'TEXT', requirement: 'REQUIRED', validation: { max_length: 200 }, responsible_roles: ['EXPORT_MANAGER'], source: S08 }),
  def({ code: 'SHIPMENT_LOTS', cte: 'SHIPMENT', name: 'Lotes', entity: 'shipment_items', field: 'lot_id', value_type: 'ENTITY_REF_LIST', requirement: 'REQUIRED', validation: { entity: 'lot', min_items: 1 }, responsible_roles: ['EXPORT_MANAGER'], source: S08 }),
  def({ code: 'SHIPMENT_QUANTITY', cte: 'SHIPMENT', name: 'Cantidad', entity: 'shipment_items', field: 'quantity/unit', value_type: 'QUANTITY', requirement: 'REQUIRED', validation: { ...KG, positive: true }, responsible_roles: ['EXPORT_MANAGER'], source: S08, difference: 'docs/06 registra cantidad por ítem; aquí el total del embarque.' }),
  def({ code: 'SHIPMENT_PACKAGE', cte: 'SHIPMENT', name: 'Paquete de diligencia', entity: 'shipments', field: 'dd_package_id', value_type: 'ENTITY_REF', requirement: 'CONDITIONAL', condition: { kind: 'undefined_in_contract', note: 'docs/06 marca dd_package_id como condicional sin escribir la condición; docs/08 lo lista como mínimo (D-34).' }, validation: { entity: 'dd_package' }, responsible_roles: ['EXPORT_MANAGER'], source: `${S08}; docs/06 shipments` }),
  def({ code: 'SHIPMENT_DISPATCH_AT', cte: 'SHIPMENT', name: 'Despacho', entity: 'shipments', field: 'dispatch_at', value_type: 'DATETIME', requirement: 'CONDITIONAL', condition: { kind: 'undefined_in_contract', note: 'docs/06 marca dispatch_at como condicional sin escribir la condición (D-34).' }, validation: {}, responsible_roles: ['EXPORT_MANAGER'], source: `${S08}; docs/06 shipments` }),
];

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE kde_catalog_releases (
      version text PRIMARY KEY CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
      source text NOT NULL, notes text NOT NULL, published_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`
    CREATE TABLE kde_definitions (
      id uuid PRIMARY KEY,
      code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
      version integer NOT NULL CHECK (version > 0),
      cte_definition_id uuid NOT NULL REFERENCES cte_definitions(id),
      name text NOT NULL, entity text NOT NULL, field text NOT NULL,
      value_type text NOT NULL CHECK (value_type IN ('QUANTITY','DECIMAL','INTEGER','TEXT','BOOLEAN','DATE','DATETIME','DATE_RANGE','ENUM','ENTITY_REF','ENTITY_REF_LIST')),
      requirement text NOT NULL CHECK (requirement IN ('REQUIRED','CONDITIONAL','OPTIONAL')),
      condition jsonb, validation jsonb NOT NULL,
      responsible_roles text[] NOT NULL, responsible_note text NOT NULL,
      source text NOT NULL, difference text,
      release_version text NOT NULL REFERENCES kde_catalog_releases(version),
      supersedes_id uuid REFERENCES kde_definitions(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT kde_definitions_code_version_uq UNIQUE (code, version),
      CONSTRAINT kde_definitions_condition_consistent CHECK ((requirement = 'CONDITIONAL') = (condition IS NOT NULL))
    )`.execute(db);
  await sql`
    CREATE TABLE kde_definition_retirements (
      definition_id uuid PRIMARY KEY REFERENCES kde_definitions(id),
      release_version text NOT NULL REFERENCES kde_catalog_releases(version),
      reason text NOT NULL, retired_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  for (const table of ['kde_catalog_releases', 'kde_definitions', 'kde_definition_retirements']) {
    await sql.raw(`
      CREATE FUNCTION ${table}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '${table} es append-only: publicar una nueva versión del catálogo';
      END $$`).execute(db);
    await sql.raw(`CREATE TRIGGER ${table}_no_mutation BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_append_only()`).execute(db);
  }
  await publishKdeRelease(db, { version: '1.0.0', source: 'docs/08, docs/06, docs/09, S1 §18', notes: 'Datos mínimos iniciales por hito (catálogo CTE 1.0.0). Obligatoriedad de hitos por flujo pendiente (D-33).', publish: KDE_1_0_0 });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['kde_definition_retirements', 'kde_definitions', 'kde_catalog_releases']) {
    await sql.raw(`DROP TABLE ${table}`).execute(db);
    await sql.raw(`DROP FUNCTION ${table}_append_only`).execute(db);
  }
}
