import { Kysely, sql } from 'kysely';

// P0-028 · D-09 **parte A** (2026-10-15): Whisp queda seleccionado como **adaptador de desarrollo**.
// Contrato usado: docs/decisiones/P0-028-WHISP-CONTRATO.md (OpenAPI 2.3.0, consultado 2026-10-15).
//
// Las dos aprobaciones de D-09 pasan a estar representadas en los datos, no solo en un documento:
// - `SELECTED_FOR_DEVELOPMENT` (parte A): el adaptador existe y se prueba contra servidores controlados. NO autoriza
//   llamar al servicio real, enviar geometrías ni registrar claves reales.
// - `SELECTED` (parte B): proveedor autorizado para uso real. Exige responsable (`selected_by`) y referencia de la
//   decisión, y ADEMÁS el interruptor explícito de llamadas reales. Seleccionar un proveedor o encontrar una
//   credencial no habilita nada por sí solo.
// Se añade el desenlace `LIVE_CALLS_DISABLED`: un trabajo que no se ejecuta porque las llamadas reales están
// deshabilitadas termina diciendo eso, no «error del proveedor». Como todos los demás, no es favorable.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE satellite_providers DROP CONSTRAINT satellite_providers_selection_status_check`.execute(db);
  await sql`ALTER TABLE satellite_providers ADD CONSTRAINT satellite_providers_selection_status_check
    CHECK (selection_status IN ('PROPOSED','SELECTED_FOR_DEVELOPMENT','SELECTED','TEST_ONLY','RETIRED'))`.execute(db);

  // La referencia de la decisión es obligatoria en ambas selecciones; el responsable solo en la parte B, que es la
  // que autoriza uso real. Una fixture sigue sin poder seleccionarse de ninguna de las dos formas.
  await sql`ALTER TABLE satellite_providers DROP CONSTRAINT satellite_providers_selection`.execute(db);
  await sql`ALTER TABLE satellite_providers ADD CONSTRAINT satellite_providers_selection CHECK (
    (selection_status = 'SELECTED') = (selected_by IS NOT NULL AND decision_reference IS NOT NULL)
    AND (selection_status <> 'SELECTED_FOR_DEVELOPMENT' OR decision_reference IS NOT NULL))`.execute(db);
  await sql`ALTER TABLE satellite_providers DROP CONSTRAINT satellite_providers_fixture_never_selected`.execute(db);
  await sql`ALTER TABLE satellite_providers ADD CONSTRAINT satellite_providers_fixture_never_selected
    CHECK (NOT (kind = 'SYNTHETIC_FIXTURE' AND selection_status IN ('SELECTED','SELECTED_FOR_DEVELOPMENT')))`.execute(db);

  await sql`ALTER TABLE satellite_jobs DROP CONSTRAINT satellite_jobs_outcome_check`.execute(db);
  await sql`ALTER TABLE satellite_jobs ADD CONSTRAINT satellite_jobs_outcome_check CHECK (outcome IN (
    'RESULT_AVAILABLE','NO_PROVIDER_SELECTED','LIVE_CALLS_DISABLED','NO_COVERAGE','TIMEOUT','RATE_LIMITED',
    'PROVIDER_ERROR','EGRESS_BLOCKED','GEOMETRY_UNSUPPORTED','SUPERSEDED_GEOMETRY','CANCELLED'))`.execute(db);

  // `supported_operations`: SOLO `FOREST_COVER`. Whisp expone una única operación de análisis cuyo resultado agrupa
  // varias familias de indicadores; mapearla además a «alertas» o «histórico» exigiría decidir qué significa cada
  // indicador, que es D-07. Declarar las tres sería inventarlo.
  await sql`
    UPDATE satellite_providers SET
      selection_status = 'SELECTED_FOR_DEVELOPMENT',
      decision_reference = 'D-09 parte A (2026-10-15): adaptador de desarrollo. NO autoriza llamadas reales, envío de geometrías, claves reales, contratación ni aceptación de términos (parte B pendiente).',
      supported_operations = ARRAY['FOREST_COVER']::text[],
      coverage_note = 'Convergencia de evidencia sobre varias capas globales, con corte 31-12-2020. El contrato de la API NO declara cobertura por resultado: la ausencia de incidencias no equivale a cobertura completa. Si el proveedor informa datasets no disponibles (whisp_processing_metadata.unavailable_datasets o risk_inputs_unavailable), el resultado se conserva como cobertura PARCIAL con la lista de lo que faltó.',
      limits_note = 'Contrato OpenAPI 2.3.0 consultado el 2026-10-15 (docs/decisiones/P0-028-WHISP-CONTRATO.md). Límites y plazos los declara el propio proveedor en GET /api/config y se consultan ANTES de enviar nada. Un trabajo terminado y un 200 no significan análisis completo.',
      source = 'S1 §40; docs/15; contrato oficial OpenAPI 2.3.0 consultado 2026-10-15; D-09 parte A adoptada 2026-10-15'
    WHERE code = 'WHISP'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE satellite_providers SET selection_status = 'PROPOSED', decision_reference = NULL, supported_operations = ARRAY[]::text[] WHERE code = 'WHISP'`.execute(db);
  await sql`ALTER TABLE satellite_jobs DROP CONSTRAINT satellite_jobs_outcome_check`.execute(db);
  await sql`ALTER TABLE satellite_jobs ADD CONSTRAINT satellite_jobs_outcome_check CHECK (outcome IN (
    'RESULT_AVAILABLE','NO_PROVIDER_SELECTED','NO_COVERAGE','TIMEOUT','RATE_LIMITED','PROVIDER_ERROR','EGRESS_BLOCKED',
    'GEOMETRY_UNSUPPORTED','SUPERSEDED_GEOMETRY','CANCELLED'))`.execute(db);
  await sql`ALTER TABLE satellite_providers DROP CONSTRAINT satellite_providers_fixture_never_selected`.execute(db);
  await sql`ALTER TABLE satellite_providers ADD CONSTRAINT satellite_providers_fixture_never_selected
    CHECK (NOT (kind = 'SYNTHETIC_FIXTURE' AND selection_status = 'SELECTED'))`.execute(db);
  await sql`ALTER TABLE satellite_providers DROP CONSTRAINT satellite_providers_selection`.execute(db);
  await sql`ALTER TABLE satellite_providers ADD CONSTRAINT satellite_providers_selection
    CHECK ((selection_status = 'SELECTED') = (selected_by IS NOT NULL AND decision_reference IS NOT NULL))`.execute(db);
  await sql`ALTER TABLE satellite_providers DROP CONSTRAINT satellite_providers_selection_status_check`.execute(db);
  await sql`ALTER TABLE satellite_providers ADD CONSTRAINT satellite_providers_selection_status_check
    CHECK (selection_status IN ('PROPOSED','SELECTED','TEST_ONLY','RETIRED'))`.execute(db);
}
