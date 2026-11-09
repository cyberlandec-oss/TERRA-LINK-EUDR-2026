import { sql, type Kysely } from 'kysely';

// AJ-07 — Envío incierto al proveedor.
//
// Un POST al proveedor puede perder su respuesta (corte, plazo, reinicio del corredor) DESPUÉS de que el proveedor aceptó el trabajo. Mientras no se conozca su
// identificador (`provider_job_ref`), el desenlace es INCIERTO: reenviar automáticamente podría duplicar el trabajo y el consumo de cupo del proveedor, y darlo por no
// enviado sería afirmar lo que no se sabe. Se anota el instante en que se empezó a enviar; si un reintento encuentra ese instante SIN identificador, el trabajo termina
// con un error explícito (`PROVIDER_SUBMIT_UNCERTAIN`) y la organización decide si encarga uno nuevo. No se promete «exactamente una vez» frente al proveedor.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE satellite_jobs ADD COLUMN provider_submit_started_at timestamptz`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE satellite_jobs DROP COLUMN provider_submit_started_at`.execute(db);
}
