import { Kysely, sql } from 'kysely';
import { publishCteRelease, type CteDefinitionInput } from '../../traceability/cte-release';

// P0-013 CTE (RF-13). Catálogo de SISTEMA versionado de hitos críticos de trazabilidad.
// Fuentes: S1 §19 (HARVEST, DELIVERY, RECEPTION, WEIGHING, FERMENTATION, DRYING, STORAGE, PACKAGING, SALE,
// SHIPMENT) y doc 08 (CLASSIFICATION como extensión explícita; eventos propuestos). Etapas según S1 §1:
// paso atrás (ORIGIN), trazabilidad interna (INTERNAL) y paso adelante (OUTBOUND).
// Ninguna operación de estos hitos existe todavía: todos los vínculos son PENDING. Crear productor, parcela
// o producto NO son cosechas, entregas ni recepciones; no se vinculan como hitos.
// La obligatoriedad (`required` en S1) y los datos mínimos se definen en P0-014 (KDE).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE cte_catalog_releases (
      version text PRIMARY KEY CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
      source text NOT NULL,
      notes text NOT NULL,
      published_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`
    CREATE TABLE cte_definitions (
      id uuid PRIMARY KEY,
      code text NOT NULL CHECK (code ~ '^[A-Z][A-Z_]{1,39}$'),
      version integer NOT NULL CHECK (version > 0),
      name text NOT NULL,
      description text NOT NULL,
      stage text NOT NULL CHECK (stage IN ('ORIGIN','INTERNAL','OUTBOUND')),
      source text NOT NULL,
      release_version text NOT NULL REFERENCES cte_catalog_releases(version),
      supersedes_id uuid REFERENCES cte_definitions(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT cte_definitions_code_version_uq UNIQUE (code, version)
    )`.execute(db);
  await sql`
    CREATE TABLE cte_definition_retirements (
      definition_id uuid PRIMARY KEY REFERENCES cte_definitions(id),
      release_version text NOT NULL REFERENCES cte_catalog_releases(version),
      reason text NOT NULL,
      retired_at timestamptz NOT NULL DEFAULT now()
    )`.execute(db);
  // Una sola definición vigente por código: se comprueba al publicar (función) y con este índice diferido
  // no es expresable; la publicación inserta la retirada de la versión anterior en la misma transacción.
  await sql`
    CREATE TABLE cte_operation_links (
      definition_id uuid NOT NULL REFERENCES cte_definitions(id),
      operation_code text NOT NULL CHECK (operation_code ~ '^[A-Z][A-Z_]{1,59}$'),
      event_type text NOT NULL CHECK (event_type ~ '^[A-Z][A-Za-z]+$'),
      integration_status text NOT NULL CHECK (integration_status IN ('INTEGRATED','PENDING')),
      story text,
      note text NOT NULL,
      PRIMARY KEY (definition_id, operation_code)
    )`.execute(db);
  for (const table of ['cte_catalog_releases', 'cte_definitions', 'cte_definition_retirements', 'cte_operation_links']) {
    await sql.raw(`
      CREATE FUNCTION ${table}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '${table} es append-only: publicar una nueva versión del catálogo';
      END $$`).execute(db);
    await sql.raw(`CREATE TRIGGER ${table}_no_mutation BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_append_only()`).execute(db);
  }

  const S1 = 'S1 §19 (cte_definitions); eventos propuestos en docs/08';
  const pending = (operation: string, event_type: string, story: string | null) =>
    [{ operation, event_type, status: 'PENDING' as const, story, note: story ? `Operación no implementada; prevista en ${story}.` : 'Operación no implementada y sin historia asignada en el backlog P0.' }];
  const defs: CteDefinitionInput[] = [
    { code: 'HARVEST', name: 'Cosecha', description: 'Registro de la cosecha de una parcela (versión geométrica), productor, periodo y producto; cantidad y unidad si se midió.', stage: 'ORIGIN', source: S1, links: pending('HARVEST_RECORD', 'HarvestRecorded', null) },
    { code: 'DELIVERY', name: 'Entrega', description: 'Entrega del productor o proveedor con parcela(s) de origen, producto, fecha y peso declarado.', stage: 'ORIGIN', source: S1, links: pending('DELIVERY_REGISTER', 'DeliveryRegistered', 'P0-012') },
    { code: 'RECEPTION', name: 'Recepción', description: 'Recepción de una entrega en un centro: receptor, momento, peso real y diferencias con su causa.', stage: 'INTERNAL', source: S1, links: pending('RECEPTION_CONFIRM', 'ReceptionConfirmed', 'P0-012') },
    { code: 'WEIGHING', name: 'Pesaje', description: 'Pesaje de una entidad con método, valor, unidad, fecha y responsable.', stage: 'INTERNAL', source: S1, links: pending('WEIGHT_RECORD', 'WeightRecorded', 'P0-012') },
    { code: 'CLASSIFICATION', name: 'Clasificación', description: 'Decisión de calidad sobre una muestra con método, mediciones y límites vigentes.', stage: 'INTERNAL', source: 'docs/08 (extensión explícita de los procesos de S1)', links: pending('QUALITY_DECISION', 'QualityDecisionRecorded', 'P0-012') },
    { code: 'FERMENTATION', name: 'Fermentación', description: 'Proceso de fermentación con entradas, lotes, tiempos, salida y merma.', stage: 'INTERNAL', source: S1, links: pending('PROCESSING_RUN_CLOSE', 'ProcessingRunClosed', 'P0-016') },
    { code: 'DRYING', name: 'Secado', description: 'Proceso de secado con entrada, salida, humedad y pérdida medida.', stage: 'INTERNAL', source: S1, links: pending('PROCESSING_RUN_CLOSE', 'ProcessingRunClosed', 'P0-016') },
    { code: 'STORAGE', name: 'Almacenamiento', description: 'Entrada o salida de un lote en un centro o ubicación, con cantidad y responsable.', stage: 'INTERNAL', source: S1, links: pending('STOCK_MOVEMENT', 'StockMovementRecorded', 'P0-017') },
    { code: 'PACKAGING', name: 'Envasado', description: 'Envasado de un lote en unidades físicas con peso, fecha y código.', stage: 'INTERNAL', source: S1, links: pending('PACKAGING_RECORD', 'PackagingRecorded', null) },
    { code: 'SALE', name: 'Venta', description: 'Venta de un lote o cantidad a una contraparte; moneda y precio si están disponibles.', stage: 'OUTBOUND', source: S1, links: pending('SALE_RECORD', 'SaleRecorded', null) },
    { code: 'SHIPMENT', name: 'Embarque', description: 'Despacho de un embarque con comprador, destino, lotes, cantidades y paquete.', stage: 'OUTBOUND', source: S1, links: pending('SHIPMENT_DISPATCH', 'ShipmentDispatched', 'P0-029') },
  ];
  await publishCteRelease(db, { version: '1.0.0', source: S1, notes: 'Catálogo inicial de hitos (S1 §19 + CLASSIFICATION de docs/08). Todas las operaciones pendientes.', publish: defs });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['cte_operation_links', 'cte_definition_retirements', 'cte_definitions', 'cte_catalog_releases']) {
    await sql.raw(`DROP TABLE ${table}`).execute(db);
    await sql.raw(`DROP FUNCTION ${table}_append_only`).execute(db);
  }
}
