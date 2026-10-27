import { Kysely, sql } from 'kysely';
import { publishKdeGates, publishKdeRelease } from '../../traceability/kde-release';

// D-34.A — Condición de despacho, adoptada como **regla provisional del MVP local** el 2026-10-16.
// Contrato: `docs/decisiones/D-34-PROPUESTA.md`. Decisiones adoptadas: **D-34.A.1 = A** y **D-34.A.2 = A**.
//
// QUÉ SE ADOPTA
// - Para despachar se exige la referencia al **paquete final de diligencia**, con aprobación, readiness y
//   vigencia comprobadas. **Un borrador interno (`INTERNAL_REVIEW`) no la satisface.**
// - **No** se incorpora excepción `NOT_SUBJECT` ni clasificación jurídica inferida del país. Es una **política
//   operativa de producto**, no la afirmación de que todo movimiento esté jurídicamente sujeto a lo mismo.
// - **D-34.A.1**: `SHIPMENT_LINK` se satisface ANTES del despacho, con un ítem que tenga reserva activa. No
//   exige que la mercancía haya salido: exigirlo crearía una dependencia circular que ninguna fuente impone
//   (S1 §44 enumera el contenido del paquete y **no** incluye embarque ni despacho).
// - **D-34.A.2**: la acreditación se registra **por ítem**, que es donde está la cardinalidad real: un embarque
//   lleva N lotes, cada uno con su expediente y su export.
//
// QUÉ NO HACE
// - **No habilita `READY`** ni cambia ningún requisito regulatorio. La conclusión sigue `UNDETERMINED` por
//   `CHECK`; D-05.B, D-07.5, D-07.6, P1-005 y D-09.B siguen pendientes. No se fabrica un expediente aprobable.
// - **No cierra P0-029 ni P0-017.** Definir la condición y probar su mecánica no es su aceptación completa.

export async function up(db: Kysely<unknown>): Promise<void> {
  // ----------------------------------------------------------------- 1) acreditación POR ÍTEM
  await sql`ALTER TABLE shipment_items ADD COLUMN dd_package_export_id uuid`.execute(db);
  // Tenant por FK de dos columnas: una referencia no puede cruzar de organización.
  await sql`ALTER TABLE shipment_items ADD CONSTRAINT shipment_items_package_fk
    FOREIGN KEY (organization_id, dd_package_export_id) REFERENCES dd_exports(organization_id, id)`.execute(db);

  // La FK garantiza tenant, **no correspondencia**: hay que comprobar que el export acredita el expediente del
  // LOTE de ese ítem y que es un DD_PACKAGE, no un borrador. Eso depende de tres tablas, así que no cabe en un
  // CHECK y se expresa como disparador de restricción.
  await sql`
    CREATE FUNCTION shipment_item_package_matches() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE ok boolean;
    BEGIN
      IF NEW.dd_package_export_id IS NULL THEN RETURN NEW; END IF;
      SELECT EXISTS (
        SELECT 1 FROM dd_exports e
        JOIN dd_snapshots sn ON sn.id = e.snapshot_id AND sn.organization_id = e.organization_id
        JOIN dd_cases c ON c.id = sn.case_id AND c.organization_id = sn.organization_id
        WHERE e.id = NEW.dd_package_export_id
          AND e.organization_id = NEW.organization_id
          AND e.kind = 'DD_PACKAGE'
          AND c.subject_type = 'LOT'
          AND c.subject_id = NEW.lot_id
      ) INTO ok;
      IF NOT ok THEN
        RAISE EXCEPTION 'D-34.A.2: la acreditacion no corresponde al lote del item, no es DD_PACKAGE o no es de la organizacion';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`
    CREATE CONSTRAINT TRIGGER shipment_items_package_match AFTER INSERT OR UPDATE OF dd_package_export_id, lot_id ON shipment_items
    DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION shipment_item_package_matches()`.execute(db);

  // Sin reemplazo silencioso: una vez acreditado, el ítem no cambia de paquete ni lo pierde. Así la
  // acreditación usada en el despacho queda como **evidencia histórica** y no puede reescribirse después.
  await sql`
    CREATE FUNCTION shipment_item_package_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.dd_package_export_id IS NOT NULL AND NEW.dd_package_export_id IS DISTINCT FROM OLD.dd_package_export_id THEN
        RAISE EXCEPTION 'D-34.A.2: la acreditacion de un item no se reemplaza ni se retira una vez registrada';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`
    CREATE TRIGGER shipment_items_package_no_replace BEFORE UPDATE ON shipment_items
    FOR EACH ROW EXECUTE FUNCTION shipment_item_package_immutable()`.execute(db);

  // ----------------------------------------------------------------- 2) la columna única queda retirada
  // `shipments.dd_package_export_id` no se rellenará con el primer paquete ni con uno arbitrario: con varios
  // lotes no hay un único paquete que la justifique. Se retira para **no mantener dos fuentes de
  // acreditación**. Comprobado antes de borrar: si alguna fila la tuviera, la migración se detiene.
  await sql`
    DO $$
    DECLARE con_dato bigint;
    BEGIN
      SELECT count(*) INTO con_dato FROM shipments WHERE dd_package_export_id IS NOT NULL;
      IF con_dato > 0 THEN
        RAISE EXCEPTION 'D-34.A.2: % embarque(s) tienen dd_package_export_id; migrar esos datos a shipment_items antes de retirar la columna', con_dato;
      END IF;
    END $$`.execute(db);
  await sql`ALTER TABLE shipments DROP CONSTRAINT shipments_package_fk`.execute(db);
  await sql`ALTER TABLE shipments DROP COLUMN dd_package_export_id`.execute(db);

  // ----------------------------------------------------------------- 3) `dispatch_at`: condición de estado
  // Obligatorio al quedar DISPATCHED y **ausente antes**. Que lo selle el servidor no impide que sea
  // condicional: son ejes distintos —quién aporta el valor y cuándo debe existir—. La procedencia la garantiza
  // que ningún DTO lo acepta; la condición de estado la garantiza este `CHECK`.
  await sql`ALTER TABLE shipments ADD CONSTRAINT shipments_dispatch_at_state
    CHECK ((status = 'DISPATCHED') = (dispatch_at IS NOT NULL))`.execute(db);
  // Coherencia del sello completo: quien y con qué operación, solo y siempre al despachar.
  await sql`ALTER TABLE shipments ADD CONSTRAINT shipments_dispatch_stamp
    CHECK ((status = 'DISPATCHED') = (dispatched_by IS NOT NULL) AND (status = 'DISPATCHED') = (dispatch_operation_id IS NOT NULL))`.execute(db);

  // ----------------------------------------------------------------- 4) catálogo KDE 1.7.0
  // `SHIPMENT_PACKAGE` apuntaba a `shipments.dd_package_id`, que ya no existe: se retira y se publica la
  // acreditación por ítem. `SHIPMENT_DISPATCH_AT` deja de ser `undefined_in_contract` y pasa a REQUIRED en la
  // transición, que es el momento en que el sello debe existir.
  // La fila de `kde_catalog_releases` la inserta `publishKdeRelease`; aquí solo se comprueba el hito vigente.
  const cte = (await sql<{ id: string }>`
    SELECT d.id FROM cte_definitions d
    WHERE d.code = 'SHIPMENT' AND NOT EXISTS (SELECT 1 FROM cte_definition_retirements t WHERE t.definition_id = d.id)
    ORDER BY d.version DESC LIMIT 1`.execute(db)).rows[0];
  if (!cte) throw new Error('D-34.A: el hito SHIPMENT no tiene versión vigente');

  await publishKdeRelease(db, {
    version: '1.7.0',
    source: 'docs/decisiones/D-34-PROPUESTA.md; docs/06 shipment_items; docs/08',
    notes: 'D-34.A adoptada como regla provisional del MVP local.',
    // SHIPMENT_PACKAGE se RETIRA sin modificarla: apuntaba a `shipments.dd_package_id`, que ya no existe.
    retire: [{ code: 'SHIPMENT_PACKAGE', reason: 'D-34.A.2: la acreditación pasa a registrarse por ítem; la columna única de shipments se retiró.' }],
    publish: [
      { code: 'SHIPMENT_ITEM_PACKAGES', cte: 'SHIPMENT', name: 'Paquetes de diligencia por ítem', entity: 'shipment_items', field: 'dd_package_export_id',
        value_type: 'ENTITY_REF_LIST', requirement: 'REQUIRED', condition: null,
        validation: { entity: 'dd_package', min_items: 1 }, responsible_roles: ['EXPORT_MANAGER'],
        responsible_note: 'Exige un DD_PACKAGE por CADA ítem. El validador comprueba existencia, tenant y tipo; la correspondencia con el lote, el embarque, el ítem, la reserva y la cantidad la comprueba la operación.',
        source: 'docs/08; docs/06 shipment_items; D-34.A.2',
        difference: 'docs/06 marcaba dd_package_id como condicional en shipments, sin condición escrita y con una sola columna para N lotes.' },
      { code: 'SHIPMENT_DISPATCH_AT', cte: 'SHIPMENT', name: 'Despacho', entity: 'shipments', field: 'dispatch_at',
        value_type: 'DATETIME', requirement: 'REQUIRED', condition: null, validation: {}, responsible_roles: ['EXPORT_MANAGER'],
        responsible_note: 'Obligatorio al quedar DISPATCHED y ausente antes. Lo sella el SERVIDOR dentro de la transacción de despacho; ningún DTO lo acepta.',
        source: 'docs/08; docs/06 shipments; D-34.A',
        difference: 'docs/06 lo marcaba condicional sin escribir la condición (D-34). La condición es de estado, no de otro dato.' },
    ],
  });

  await publishKdeGates(db, '1.7.0', [
    { transition: 'SHIPMENT_DISPATCH', kde: 'SHIPMENT_ITEM_PACKAGES', mode: 'BLOCKING' as const,
      note: 'D-34.A: sin paquete final aprobado, vigente y correspondiente para CADA ítem, no se despacha.' },
    { transition: 'SHIPMENT_DISPATCH', kde: 'SHIPMENT_DISPATCH_AT', mode: 'BLOCKING' as const,
      note: 'D-34.A: el sello del servidor debe existir al quedar DISPATCHED; antes debe estar ausente (CHECK shipments_dispatch_at_state).' },
  ]);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM kde_transition_gates WHERE release_version = '1.7.0'`.execute(db);
  await sql`DELETE FROM kde_definition_retirements WHERE release_version = '1.7.0'`.execute(db);
  await sql`DELETE FROM kde_definitions WHERE release_version = '1.7.0'`.execute(db);
  await sql`DELETE FROM kde_catalog_releases WHERE version = '1.7.0'`.execute(db);
  await sql`ALTER TABLE shipments DROP CONSTRAINT shipments_dispatch_stamp`.execute(db);
  await sql`ALTER TABLE shipments DROP CONSTRAINT shipments_dispatch_at_state`.execute(db);
  await sql`ALTER TABLE shipments ADD COLUMN dd_package_export_id uuid`.execute(db);
  await sql`ALTER TABLE shipments ADD CONSTRAINT shipments_package_fk
    FOREIGN KEY (organization_id, dd_package_export_id) REFERENCES dd_exports(organization_id, id)`.execute(db);
  await sql`DROP TRIGGER shipment_items_package_no_replace ON shipment_items`.execute(db);
  await sql`DROP FUNCTION shipment_item_package_immutable`.execute(db);
  await sql`DROP TRIGGER shipment_items_package_match ON shipment_items`.execute(db);
  await sql`DROP FUNCTION shipment_item_package_matches`.execute(db);
  await sql`ALTER TABLE shipment_items DROP CONSTRAINT shipment_items_package_fk`.execute(db);
  await sql`ALTER TABLE shipment_items DROP COLUMN dd_package_export_id`.execute(db);
}
