import { Kysely, sql } from 'kysely';

// P1-005 — ACTO DE REVISIÓN del perfil jurídico (mecanismo; no contenido jurídico).
//
// `legal_profile_reviews` ya existía (0049): decisión REVIEWED/OBJECTED/WITHDRAWN, responsable, capacidad, fundamento. Hasta ahora no
// había ningún camino para registrarla. Esta migración completa lo que el acto debe dejar escrito y lo que la base impone:
//
//   · `reviewer_name`: la PERSONA revisora declarada (puede no tener cuenta en la plataforma). `reviewer_id` pasa a significar,
//     de forma explícita, QUIÉN REGISTRÓ el acto (SUPER_ADMIN): registrar no es emitir un juicio jurídico.
//   · `reviewed_on`: fecha declarada de la revisión (distinta de `decided_at`, que es cuándo se registró). No puede ser futura.
//   · `legal_profile_review_supports`: fuentes y soporte de cada revisión. Un soporte es (a) una FUENTE DEL PROPIO PERFIL (misma
//     versión, FK compuesta) o (b) una CITA con url https y huella opcionales. No se enlazan documentos de organizaciones: el acto es
//     global y un documento de una organización no puede cruzar el tenant.
//   · Una revisión REVIEWED sin al menos un soporte NO puede quedar escrita (restricción diferida). OBJECTED y WITHDRAWN exigen
//     fundamento, pero no soporte.
//   · Las filas siguen siendo append-only: una revisión posterior no reescribe la anterior; la vigente es la última.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE legal_profile_reviews ADD COLUMN reviewer_name text, ADD COLUMN reviewed_on date`.execute(db);
  // Filas anteriores (si las hubiera): el trigger append-only se salta solo para este relleno y se restablece.
  await sql`ALTER TABLE legal_profile_reviews DISABLE TRIGGER legal_profile_reviews_no_mutation`.execute(db);
  await sql`UPDATE legal_profile_reviews SET reviewer_name = 'No declarado (anterior a 0062)', reviewed_on = decided_at::date WHERE reviewer_name IS NULL`.execute(db);
  await sql`ALTER TABLE legal_profile_reviews ENABLE TRIGGER legal_profile_reviews_no_mutation`.execute(db);
  await sql`ALTER TABLE legal_profile_reviews
    ALTER COLUMN reviewer_name SET NOT NULL, ALTER COLUMN reviewed_on SET NOT NULL,
    ADD CONSTRAINT legal_profile_reviews_name_len CHECK (length(btrim(reviewer_name)) BETWEEN 3 AND 200),
    ADD CONSTRAINT legal_profile_reviews_date_not_future CHECK (reviewed_on <= (decided_at AT TIME ZONE 'UTC')::date + 1)`.execute(db);

  await sql`
    CREATE TABLE legal_profile_review_supports (
      id uuid PRIMARY KEY,
      review_id uuid NOT NULL REFERENCES legal_profile_reviews(id),
      version text NOT NULL REFERENCES legal_profile_versions(version),
      kind text NOT NULL CHECK (kind IN ('PROFILE_SOURCE','CITATION')),
      source_code text,
      citation text,
      url text CHECK (url IS NULL OR url LIKE 'https://%'),
      file_sha256 text CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
      CONSTRAINT legal_profile_review_supports_source_fk FOREIGN KEY (version, source_code) REFERENCES legal_profile_sources (version, code),
      CONSTRAINT legal_profile_review_supports_shape CHECK (
        (kind = 'PROFILE_SOURCE' AND source_code IS NOT NULL AND citation IS NULL)
        OR (kind = 'CITATION' AND source_code IS NULL AND citation IS NOT NULL AND length(btrim(citation)) BETWEEN 3 AND 500))
    )`.execute(db);
  await sql`CREATE INDEX legal_profile_review_supports_review_idx ON legal_profile_review_supports (review_id)`.execute(db);

  await sql`
    CREATE FUNCTION legal_profile_review_supports_guard() RETURNS trigger AS $$
    DECLARE v text;
    BEGIN
      SELECT version INTO v FROM legal_profile_reviews WHERE id = NEW.review_id;
      IF v IS DISTINCT FROM NEW.version THEN
        RAISE EXCEPTION 'El soporte debe corresponder a la misma versión de perfil que la revisión.';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE TRIGGER legal_profile_review_supports_guard BEFORE INSERT ON legal_profile_review_supports
    FOR EACH ROW EXECUTE FUNCTION legal_profile_review_supports_guard()`.execute(db);

  await sql`
    CREATE FUNCTION legal_profile_review_supports_append_only() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'legal_profile_review_supports es append-only: el soporte de una revisión no se edita ni se borra.'; END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE TRIGGER legal_profile_review_supports_no_mutation BEFORE UPDATE OR DELETE ON legal_profile_review_supports
    FOR EACH ROW EXECUTE FUNCTION legal_profile_review_supports_append_only()`.execute(db);

  // Diferida: una revisión efectiva (REVIEWED) debe tener al menos un soporte al cerrar la transacción.
  await sql`
    CREATE FUNCTION legal_profile_reviews_requires_support() RETURNS trigger AS $$
    BEGIN
      IF NEW.decision = 'REVIEWED' AND NOT EXISTS (SELECT 1 FROM legal_profile_review_supports WHERE review_id = NEW.id) THEN
        RAISE EXCEPTION 'Una revisión REVIEWED exige al menos un soporte (fuente del perfil o cita).';
      END IF;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE CONSTRAINT TRIGGER legal_profile_reviews_requires_support AFTER INSERT ON legal_profile_reviews
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION legal_profile_reviews_requires_support()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS legal_profile_reviews_requires_support ON legal_profile_reviews`.execute(db);
  await sql`DROP FUNCTION IF EXISTS legal_profile_reviews_requires_support()`.execute(db);
  await sql`DROP TABLE IF EXISTS legal_profile_review_supports CASCADE`.execute(db);
  await sql`DROP FUNCTION IF EXISTS legal_profile_review_supports_guard()`.execute(db);
  await sql`DROP FUNCTION IF EXISTS legal_profile_review_supports_append_only()`.execute(db);
  await sql`ALTER TABLE legal_profile_reviews DROP CONSTRAINT IF EXISTS legal_profile_reviews_name_len, DROP CONSTRAINT IF EXISTS legal_profile_reviews_date_not_future`.execute(db);
  await sql`ALTER TABLE legal_profile_reviews DROP COLUMN IF EXISTS reviewer_name, DROP COLUMN IF EXISTS reviewed_on`.execute(db);
}
