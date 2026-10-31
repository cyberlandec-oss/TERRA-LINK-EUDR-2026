import { Kysely, sql } from 'kysely';

// D-07.5(b), opción b-1 (adoptada por el propietario como CONTRATO TÉCNICO): el catálogo de riesgo declara su perfil
// jurídico mediante una **referencia explícita** a una versión de `legal_profile_versions`, fijada por un **acto
// autorizado** que forma parte de una **versión nueva** del catálogo. Las versiones publicadas no se editan.
//
// Esta migración NO publica ninguna versión vinculada (no existe un perfil completo y revisado que la sustente) y NO
// aprueba contenido jurídico. Añade el registro del acto y lo que la base exige para que una referencia sea válida:
//
//   · `risk_rule_set_profile_links`: un acto por versión vinculada (autor, fecha, motivo, versión derivada, versión
//     base, perfil referenciado y la revisión exacta que lo sustenta). Append-only.
//   · Una fila de `risk_rule_sets` con `regulatory_profile` NO nulo solo puede existir si, al cerrar la transacción,
//     hay un acto que la respalde (restricción diferida): una etiqueta o un valor escrito a mano no basta. Esto se
//     suma a la guarda de 0059 (perfil existente, publicado, completo y con revisión vigente).
//   · El acto solo puede citar la revisión que, en ese instante, es la última del perfil y es REVIEWED.
//   · La versión derivada solo puede ser COPIA exacta de las reglas de la versión base: el acto no crea reglas.
//
// Una revisión posterior (objetada o retirada) NO se bloquea aquí: el acto queda como historia y la guarda del
// requisito (RISK_CATALOG_APPROVED) deja de darlo por vigente al leer la revisión actual.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE risk_rule_set_profile_links (
      id uuid PRIMARY KEY,
      rule_set_version text NOT NULL UNIQUE REFERENCES risk_rule_sets(version),
      base_rule_set_version text NOT NULL REFERENCES risk_rule_sets(version),
      profile_version text NOT NULL REFERENCES legal_profile_versions(version),
      review_id uuid NOT NULL REFERENCES legal_profile_reviews(id),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      decided_by uuid NOT NULL REFERENCES users(id),
      decided_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL UNIQUE,
      CONSTRAINT risk_rule_set_profile_links_distinct CHECK (rule_set_version <> base_rule_set_version)
    )`.execute(db);
  await sql`CREATE INDEX risk_rule_set_profile_links_profile_idx ON risk_rule_set_profile_links (profile_version, decided_at DESC)`.execute(db);

  await sql`
    CREATE FUNCTION risk_rule_set_profile_links_append_only() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'risk_rule_set_profile_links es append-only: un acto de vinculación no se edita ni se borra.'; END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE TRIGGER risk_rule_set_profile_links_no_mutation BEFORE UPDATE OR DELETE ON risk_rule_set_profile_links
    FOR EACH ROW EXECUTE FUNCTION risk_rule_set_profile_links_append_only()`.execute(db);

  // La revisión citada debe ser, AHORA, la última del perfil y estar en REVIEWED; y el catálogo derivado debe declarar ese perfil.
  await sql`
    CREATE FUNCTION risk_rule_set_profile_links_guard() RETURNS trigger AS $$
    DECLARE ultima uuid; decision text; declarado text;
    BEGIN
      SELECT id, legal_profile_reviews.decision INTO ultima, decision FROM legal_profile_reviews
        WHERE version = NEW.profile_version ORDER BY decided_at DESC, id DESC LIMIT 1;
      IF ultima IS DISTINCT FROM NEW.review_id OR decision IS DISTINCT FROM 'REVIEWED' THEN
        RAISE EXCEPTION 'La revisión citada no es la revisión vigente (REVIEWED) del perfil %.', NEW.profile_version;
      END IF;
      SELECT regulatory_profile INTO declarado FROM risk_rule_sets WHERE version = NEW.rule_set_version;
      IF declarado IS DISTINCT FROM NEW.profile_version THEN
        RAISE EXCEPTION 'El catálogo % no declara el perfil % como regulatory_profile.', NEW.rule_set_version, NEW.profile_version;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE TRIGGER risk_rule_set_profile_links_guard BEFORE INSERT ON risk_rule_set_profile_links
    FOR EACH ROW EXECUTE FUNCTION risk_rule_set_profile_links_guard()`.execute(db);

  // Diferida: la versión derivada es copia exacta de las reglas de la base (el acto no crea ni cambia reglas).
  await sql`
    CREATE FUNCTION risk_rule_set_profile_links_copy_check() RETURNS trigger AS $$
    DECLARE difiere int;
    BEGIN
      SELECT count(*) INTO difiere FROM (
        (SELECT code, category, condition_kind, inputs, effect, severity, depends_on FROM risk_rules WHERE rule_set_version = NEW.base_rule_set_version
         EXCEPT SELECT code, category, condition_kind, inputs, effect, severity, depends_on FROM risk_rules WHERE rule_set_version = NEW.rule_set_version)
        UNION ALL
        (SELECT code, category, condition_kind, inputs, effect, severity, depends_on FROM risk_rules WHERE rule_set_version = NEW.rule_set_version
         EXCEPT SELECT code, category, condition_kind, inputs, effect, severity, depends_on FROM risk_rules WHERE rule_set_version = NEW.base_rule_set_version)
      ) d;
      IF difiere > 0 THEN
        RAISE EXCEPTION 'El catálogo % no es copia exacta de las reglas de %: el acto de vinculación no crea ni cambia reglas.', NEW.rule_set_version, NEW.base_rule_set_version;
      END IF;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE CONSTRAINT TRIGGER risk_rule_set_profile_links_copy_check AFTER INSERT ON risk_rule_set_profile_links
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION risk_rule_set_profile_links_copy_check()`.execute(db);

  // Diferida: una referencia no nula exige un acto que la respalde. Sin acto, ni una migración puede dejarla escrita.
  await sql`
    CREATE FUNCTION risk_rule_sets_profile_requires_link() RETURNS trigger AS $$
    BEGIN
      IF NEW.regulatory_profile IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM risk_rule_set_profile_links WHERE rule_set_version = NEW.version AND profile_version = NEW.regulatory_profile) THEN
        RAISE EXCEPTION 'regulatory_profile de % exige un acto de vinculación registrado (risk_rule_set_profile_links).', NEW.version;
      END IF;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE CONSTRAINT TRIGGER risk_rule_sets_profile_requires_link AFTER INSERT ON risk_rule_sets
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION risk_rule_sets_profile_requires_link()`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS risk_rule_sets_profile_requires_link ON risk_rule_sets`.execute(db);
  await sql`DROP FUNCTION IF EXISTS risk_rule_sets_profile_requires_link()`.execute(db);
  await sql`DROP TABLE IF EXISTS risk_rule_set_profile_links CASCADE`.execute(db);
  for (const f of ['risk_rule_set_profile_links_copy_check', 'risk_rule_set_profile_links_guard', 'risk_rule_set_profile_links_append_only']) {
    await sql.raw(`DROP FUNCTION IF EXISTS ${f}()`).execute(db);
  }
}
