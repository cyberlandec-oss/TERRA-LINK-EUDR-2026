import { Kysely, sql } from 'kysely';

// GEOLOCATION_PROFILE (requisito original, P0-022/D-05.B Q4): CONFIGURACIÓN VERSIONADA de las reglas que definen «satisfecho».
//
// Hasta ahora `profiles.geolocation_profile` era una constante `null`: el requisito era siempre NOT_EVALUABLE. Esta migración añade el
// OBJETO que le faltaba —una configuración versionada, con fuentes, reglas explícitas, revisión y adopción— SIN decidir contenido jurídico:
//
//   · `geo_requirement_configs` (+ `_sources`, `_rules`): una versión inmutable. Cada regla es ACTIVE (el sistema sabe evaluarla con datos
//     propios) o CANDIDATE (interpretación pendiente: el sistema NO la aplica, no inventa umbrales). Solo el tipo `GEO_TECH_PROFILE` (usar
//     la evaluación vigente del perfil técnico EUDR_GEO_V1) puede estar ACTIVE: el período y el país de producción no están vinculados por
//     parcela y por eso solo pueden ser CANDIDATE (no se deducen).
//   · `geo_requirement_config_reviews` (+ `_supports`): la revisión es de ESTE objeto y versión; no se confunde con la revisión del perfil
//     jurídico. Lleva el ALCANCE DE APLICABILIDAD que declara la persona revisora (organizaciones y nota de operación): que una
//     configuración esté revisada NO demuestra que aplique a todas las organizaciones. REVIEWED exige soporte.
//   · `geo_requirement_config_adoptions`: la organización adopta/retira una versión (append-only), como con el perfil jurídico.
//
// Se siembra la versión `0.1.0` como CANDIDATA (sin revisión): contiene los criterios documentados en la ficha D-05.B (Q4) como reglas
// explícitas. No está revisada ni adoptada por nadie: el requisito sigue NOT_EVALUABLE en el entorno operativo.
const V = '0.1.0';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE geo_requirement_configs (
      version text PRIMARY KEY CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
      technical_profile_id text NOT NULL CHECK (technical_profile_id = 'EUDR_GEO_V1'),
      technical_profile_version text NOT NULL CHECK (technical_profile_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
      scope_note text NOT NULL CHECK (length(btrim(scope_note)) BETWEEN 10 AND 2000),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      created_by uuid REFERENCES users(id),
      origin text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid UNIQUE,
      CONSTRAINT geo_requirement_configs_author CHECK (created_by IS NOT NULL OR origin LIKE 'migracion %')
    )`.execute(db);
  await sql`
    CREATE TABLE geo_requirement_config_sources (
      version text NOT NULL REFERENCES geo_requirement_configs(version),
      code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_-]{2,59}$'),
      title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 300),
      citation text NOT NULL CHECK (length(btrim(citation)) BETWEEN 3 AND 500),
      url text NOT NULL CHECK (url LIKE 'https://%'),
      file_sha256 text CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
      PRIMARY KEY (version, code)
    )`.execute(db);
  await sql`
    CREATE TABLE geo_requirement_config_rules (
      version text NOT NULL REFERENCES geo_requirement_configs(version),
      code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_-]{2,59}$'),
      kind text NOT NULL CHECK (kind IN ('GEO_TECH_PROFILE','PRODUCTION_PERIOD','PRODUCTION_COUNTRY')),
      status text NOT NULL CHECK (status IN ('ACTIVE','CANDIDATE')),
      source_code text NOT NULL,
      article text NOT NULL CHECK (length(btrim(article)) BETWEEN 3 AND 300),
      criterion text NOT NULL CHECK (length(btrim(criterion)) BETWEEN 10 AND 1000),
      proposed_interpretation text,
      pending_questions text,
      PRIMARY KEY (version, code),
      CONSTRAINT geo_requirement_config_rules_source_fk FOREIGN KEY (version, source_code) REFERENCES geo_requirement_config_sources (version, code),
      -- Solo lo que el sistema sabe evaluar con datos propios puede estar ACTIVE; período y país no están vinculados por parcela.
      CONSTRAINT geo_requirement_config_rules_active_kind CHECK (status = 'CANDIDATE' OR kind = 'GEO_TECH_PROFILE'),
      -- Una candidata declara qué falta para poder aplicarla.
      CONSTRAINT geo_requirement_config_rules_candidate_questions CHECK (status = 'ACTIVE' OR length(btrim(coalesce(pending_questions, ''))) >= 10)
    )`.execute(db);

  await sql`
    CREATE TABLE geo_requirement_config_reviews (
      id uuid PRIMARY KEY,
      version text NOT NULL REFERENCES geo_requirement_configs(version),
      decision text NOT NULL CHECK (decision IN ('REVIEWED','OBJECTED','WITHDRAWN')),
      reviewer_name text NOT NULL CHECK (length(btrim(reviewer_name)) BETWEEN 3 AND 200),
      reviewer_capacity text NOT NULL CHECK (length(btrim(reviewer_capacity)) BETWEEN 3 AND 300),
      reviewed_on date NOT NULL,
      basis text NOT NULL CHECK (length(btrim(basis)) BETWEEN 10 AND 2000),
      -- ALCANCE DE APLICABILIDAD declarado por quien revisa: organizaciones a las que la configuración revisada SE DECLARA aplicable.
      -- Vacío = revisada, pero no aplicable a ninguna. Nunca «todas por defecto».
      applicable_organizations uuid[] NOT NULL DEFAULT '{}',
      applicability_note text NOT NULL CHECK (length(btrim(applicability_note)) BETWEEN 3 AND 1000),
      recorded_by uuid NOT NULL REFERENCES users(id),
      decided_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL UNIQUE,
      CONSTRAINT geo_requirement_config_reviews_date CHECK (reviewed_on <= (decided_at AT TIME ZONE 'UTC')::date + 1)
    )`.execute(db);
  await sql`CREATE INDEX geo_requirement_config_reviews_idx ON geo_requirement_config_reviews (version, decided_at DESC)`.execute(db);
  await sql`
    CREATE TABLE geo_requirement_config_review_supports (
      id uuid PRIMARY KEY,
      review_id uuid NOT NULL REFERENCES geo_requirement_config_reviews(id),
      version text NOT NULL REFERENCES geo_requirement_configs(version),
      kind text NOT NULL CHECK (kind IN ('CONFIG_SOURCE','CITATION')),
      source_code text,
      citation text,
      url text CHECK (url IS NULL OR url LIKE 'https://%'),
      file_sha256 text CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$'),
      CONSTRAINT geo_requirement_config_review_supports_source_fk FOREIGN KEY (version, source_code) REFERENCES geo_requirement_config_sources (version, code),
      CONSTRAINT geo_requirement_config_review_supports_shape CHECK (
        (kind = 'CONFIG_SOURCE' AND source_code IS NOT NULL AND citation IS NULL)
        OR (kind = 'CITATION' AND source_code IS NULL AND citation IS NOT NULL AND length(btrim(citation)) BETWEEN 3 AND 500))
    )`.execute(db);
  await sql`
    CREATE TABLE geo_requirement_config_adoptions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      version text NOT NULL REFERENCES geo_requirement_configs(version),
      decision text NOT NULL CHECK (decision IN ('ADOPT','WITHDRAW')),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      decided_by uuid NOT NULL REFERENCES users(id),
      decided_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT geo_requirement_config_adoptions_op_uq UNIQUE (organization_id, operation_id)
    )`.execute(db);
  await sql`CREATE INDEX geo_requirement_config_adoptions_idx ON geo_requirement_config_adoptions (organization_id, decided_at DESC)`.execute(db);

  // Inmutabilidad: nada de esto se edita ni se borra; corregir es una fila o una versión nueva.
  for (const t of ['geo_requirement_configs', 'geo_requirement_config_sources', 'geo_requirement_config_rules', 'geo_requirement_config_reviews', 'geo_requirement_config_review_supports', 'geo_requirement_config_adoptions']) {
    await sql.raw(`CREATE FUNCTION ${t}_append_only() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '${t} es append-only: corrige con una fila o una versión nueva.'; END $$ LANGUAGE plpgsql`).execute(db);
    await sql.raw(`CREATE TRIGGER ${t}_no_mutation BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION ${t}_append_only()`).execute(db);
  }

  // El soporte de una revisión debe ser de la MISMA versión de configuración.
  await sql`
    CREATE FUNCTION geo_requirement_config_review_supports_guard() RETURNS trigger AS $$
    DECLARE v text;
    BEGIN
      SELECT version INTO v FROM geo_requirement_config_reviews WHERE id = NEW.review_id;
      IF v IS DISTINCT FROM NEW.version THEN RAISE EXCEPTION 'El soporte debe corresponder a la misma versión de configuración que la revisión.'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE TRIGGER geo_requirement_config_review_supports_guard BEFORE INSERT ON geo_requirement_config_review_supports FOR EACH ROW EXECUTE FUNCTION geo_requirement_config_review_supports_guard()`.execute(db);

  // La aplicabilidad solo puede nombrar organizaciones que existen.
  await sql`
    CREATE FUNCTION geo_requirement_config_reviews_orgs_guard() RETURNS trigger AS $$
    DECLARE n int;
    BEGIN
      SELECT count(*) INTO n FROM organizations WHERE id = ANY(NEW.applicable_organizations);
      IF n <> coalesce(cardinality(NEW.applicable_organizations), 0) THEN RAISE EXCEPTION 'applicable_organizations nombra una organización que no existe (o repetida).'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE TRIGGER geo_requirement_config_reviews_orgs_guard BEFORE INSERT ON geo_requirement_config_reviews FOR EACH ROW EXECUTE FUNCTION geo_requirement_config_reviews_orgs_guard()`.execute(db);

  // Diferidas: REVIEWED exige soporte; una versión exige al menos una fuente y una regla.
  await sql`
    CREATE FUNCTION geo_requirement_config_reviews_requires_support() RETURNS trigger AS $$
    BEGIN
      IF NEW.decision = 'REVIEWED' AND NOT EXISTS (SELECT 1 FROM geo_requirement_config_review_supports WHERE review_id = NEW.id) THEN
        RAISE EXCEPTION 'Una revisión REVIEWED exige al menos un soporte (fuente de la configuración o cita).';
      END IF;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE CONSTRAINT TRIGGER geo_requirement_config_reviews_requires_support AFTER INSERT ON geo_requirement_config_reviews DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_requirement_config_reviews_requires_support()`.execute(db);
  await sql`
    CREATE FUNCTION geo_requirement_configs_requires_content() RETURNS trigger AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM geo_requirement_config_sources WHERE version = NEW.version)
         OR NOT EXISTS (SELECT 1 FROM geo_requirement_config_rules WHERE version = NEW.version) THEN
        RAISE EXCEPTION 'La configuración % exige al menos una fuente y una regla.', NEW.version;
      END IF;
      RETURN NULL;
    END $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE CONSTRAINT TRIGGER geo_requirement_configs_requires_content AFTER INSERT ON geo_requirement_configs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_requirement_configs_requires_content()`.execute(db);

  // ---------------------------------------------------------------- siembra de la versión CANDIDATA 0.1.0 (sin revisión, sin adopción)
  await sql`
    INSERT INTO geo_requirement_configs (version, technical_profile_id, technical_profile_version, scope_note, reason, origin)
    VALUES (${V}, 'EUDR_GEO_V1', '1.0.0',
      'CANDIDATA, sin revision y sin adopcion. Recoge como reglas explicitas los criterios documentados en la ficha D-05.B (Q4): la geolocalizacion tecnica conforme al perfil EUDR_GEO_V1 (aplicable) y, como candidatas sin aplicar, el periodo y el pais de produccion. No decide que categoria juridica tiene cada organizacion ni cuando aplica: eso lo declara quien revisa en el alcance de aplicabilidad.',
      'Configuracion candidata derivada de la ficha D-05.B (Q4); no aprueba contenido juridico.', 'migracion 0063_geo_configuracion_reglas_versionadas')`.execute(db);
  await sql`
    INSERT INTO geo_requirement_config_sources (version, code, title, citation, url, file_sha256) VALUES
    (${V}, 'REG-2023-1115', 'Reglamento (UE) 2023/1115, texto consolidado 18.09.2026 (copia fechada)', 'Art. 9(1)(c)-(d) y Anexo II, punto 3 (segun la ficha D-05.B, Q4; citas por contrastar por el revisor)',
      'https://publications.europa.eu/resource/celex/02023R1115-20260918', '1cd2711f41ceabc1fd716ba8447c47f5d4aa51d19fe86846c1c275f6622cb1c6'),
    (${V}, 'IMPL-2024-3084', 'Reglamento de Ejecucion (UE) 2024/3084, consolidado 15.10.2026 (copia fechada)', 'Funcionamiento del sistema de informacion; sin contenido adicional de geometria segun la ficha D-05.B (3.2)',
      'https://publications.europa.eu/resource/celex/02024R3084-20261015', '72ec8493bda07ccf3be08c659a8b119757a27b2064984013e70f19a2fbe96d50')`.execute(db);
  await sql`
    INSERT INTO geo_requirement_config_rules (version, code, kind, status, source_code, article, criterion, proposed_interpretation, pending_questions) VALUES
    (${V}, 'GEO-TECH-PROFILE', 'GEO_TECH_PROFILE', 'ACTIVE', 'REG-2023-1115', 'Art. 9(1)(d); Anexo II, punto 3',
      'Cada parcela de origen del lote tiene una evaluacion VIGENTE del perfil tecnico EUDR_GEO_V1 (para su version geometrica actual) con resultado MEETS_PROFILE.',
      'Opcion (a) de la ficha D-05.B Q4: solo coordenadas conformes al perfil tecnico. El resultado tecnico no es una conclusion regulatoria.', NULL),
    (${V}, 'GEO-PRODUCTION-PERIOD', 'PRODUCTION_PERIOD', 'CANDIDATE', 'REG-2023-1115', 'Art. 9(1)(d)',
      'Fecha o rango de produccion vinculado a cada parcela de origen.',
      'Opcion (b) de la ficha D-05.B Q4. El sistema registra el periodo por entrega, no por parcela.',
      'Q4(b): se exige periodo por parcela? Con que vinculo entre entrega y parcela se considera suficiente? Mientras no se decida NO se deduce ni se aplica.'),
    (${V}, 'GEO-PRODUCTION-COUNTRY', 'PRODUCTION_COUNTRY', 'CANDIDATE', 'REG-2023-1115', 'Art. 9(1)(c); Anexo II, punto 3',
      'Pais de produccion de cada parcela de origen.',
      'Opcion (c) de la ficha D-05.B Q4. El pais no es un campo de la parcela y organizations.country es ambiguo (docs/06).',
      'Q4(c): se exige pais por parcela? De donde sale un dato suficientemente vinculado? Mientras no se decida NO se deduce del pais de la organizacion ni se aplica.')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['geo_requirement_config_adoptions', 'geo_requirement_config_review_supports', 'geo_requirement_config_reviews', 'geo_requirement_config_rules', 'geo_requirement_config_sources', 'geo_requirement_configs']) {
    await sql.raw(`DROP TABLE IF EXISTS ${t} CASCADE`).execute(db);
    await sql.raw(`DROP FUNCTION IF EXISTS ${t}_append_only()`).execute(db);
  }
  for (const f of ['geo_requirement_config_review_supports_guard', 'geo_requirement_config_reviews_orgs_guard', 'geo_requirement_config_reviews_requires_support', 'geo_requirement_configs_requires_content']) {
    await sql.raw(`DROP FUNCTION IF EXISTS ${f}()`).execute(db);
  }
}
