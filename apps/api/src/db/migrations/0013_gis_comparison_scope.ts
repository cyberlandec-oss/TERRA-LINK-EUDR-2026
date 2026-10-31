import { Kysely, sql } from 'kysely';

// Corrección de privacidad de P0-010 (doc 09: «no revelar counts o identidades ocultas»).
// Cada evaluación registra el alcance EFECTIVO de comparación:
// - ORGANIZATION: el evaluador lee todas las parcelas (plot:read).
// - EVALUATOR_ASSIGNED: el evaluador solo lee parcelas asignadas; se comparan únicamente esas
//   (scope_membership_id = membresía del evaluador en ese momento).
// Los registros anteriores se hicieron con alcance de organización (valor por defecto). La tabla sigue
// siendo append-only: añadir columnas no modifica filas existentes.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE gis_evaluations ADD COLUMN comparison_scope text NOT NULL DEFAULT 'ORGANIZATION' CHECK (comparison_scope IN ('ORGANIZATION','EVALUATOR_ASSIGNED'))`.execute(db);
  await sql`ALTER TABLE gis_evaluations ADD COLUMN scope_membership_id uuid`.execute(db);
  await sql`ALTER TABLE gis_evaluations ADD CONSTRAINT gis_evaluations_scope_consistent CHECK ((comparison_scope = 'EVALUATOR_ASSIGNED') = (scope_membership_id IS NOT NULL))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE gis_evaluations DROP CONSTRAINT gis_evaluations_scope_consistent`.execute(db);
  await sql`ALTER TABLE gis_evaluations DROP COLUMN scope_membership_id`.execute(db);
  await sql`ALTER TABLE gis_evaluations DROP COLUMN comparison_scope`.execute(db);
}
