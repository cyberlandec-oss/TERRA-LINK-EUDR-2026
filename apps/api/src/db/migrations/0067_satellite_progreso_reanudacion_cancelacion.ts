import { sql, type Kysely } from 'kysely';

// AJ-06 — Trabajos satelitales asíncronos: progreso visible, reanudación y cancelación en el proveedor.
//
// El proveedor (Whisp 2.3.1) trabaja de forma asíncrona: devuelve un identificador de trabajo, informa un porcentaje y admite cancelar. Hasta ahora el
// corredor lo consultaba pero no conservaba nada de eso: un reintento enviaba la geometría otra vez, el porcentaje no llegaba a la pantalla y cancelar
// solo era posible antes de empezar. Se añaden SOLO columnas del trabajo (no tocan el sujeto, el proveedor ni la petición, que siguen inmutables):
//   · provider_job_ref        identificador del trabajo en el proveedor (para retomar su consulta sin volver a enviar); no se devuelve por la API.
//   · provider_progress_*     último avance DECLARADO por el proveedor (porcentaje 0–100, mensaje y cuándo se recibió).
//   · cancel_requested_*      petición de cancelar un trabajo ya iniciado: quién, cuándo y por qué. El corredor la atiende y, si hay trabajo en el proveedor, lo cancela allí.
// Un trabajo terminado sigue sin cambiar (el disparador existente lo impide).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE satellite_jobs
      ADD COLUMN provider_job_ref text,
      ADD COLUMN provider_progress_percent smallint CHECK (provider_progress_percent BETWEEN 0 AND 100),
      ADD COLUMN provider_progress_note text,
      ADD COLUMN provider_progress_at timestamptz,
      ADD COLUMN cancel_requested_at timestamptz,
      ADD COLUMN cancel_requested_by uuid REFERENCES users(id),
      ADD COLUMN cancel_reason text`.execute(db);
  await sql`ALTER TABLE satellite_jobs ADD CONSTRAINT satellite_jobs_cancel_complete CHECK ((cancel_requested_at IS NULL) = (cancel_requested_by IS NULL))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE satellite_jobs DROP CONSTRAINT satellite_jobs_cancel_complete`.execute(db);
  await sql`
    ALTER TABLE satellite_jobs
      DROP COLUMN provider_job_ref, DROP COLUMN provider_progress_percent, DROP COLUMN provider_progress_note,
      DROP COLUMN provider_progress_at, DROP COLUMN cancel_requested_at, DROP COLUMN cancel_requested_by, DROP COLUMN cancel_reason`.execute(db);
}
