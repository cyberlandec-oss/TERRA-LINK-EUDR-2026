import { Kysely, sql } from 'kysely';

// P0-028 Primer proveedor satelital (RF-28, QA-15). Contrato: docs/decisiones/P0-028-SATELITE.md.
// - satellite_providers: registro de proveedores SUSTITUIBLES (S1 §40/§103). Nace sin ninguno seleccionado: la
//   selección es D-09. A lo sumo uno SELECTED (índice único parcial). Una fixture sintética NUNCA puede quedar
//   SELECTED (restricción de esquema): «simuladores solo en tests/desarrollo claramente marcados» (docs/15).
// - satellite_jobs: encargo por VERSIÓN de parcela (plot_version_id + geometry_hash; docs/06 y docs/10: «resultado
//   ligado a geometría exacta», nunca «la parcela actual»). Termina SIEMPRE con un desenlace explícito; ninguno es
//   favorable. Idempotente por operation_id. Transiciones controladas por trigger; sin borrado.
// - satellite_results: append-only con la procedencia completa de S1 §41 (source/dataset/version/analysis_date/
//   resolution/method/result/confidence) + cobertura y límites (docs/10) + bytes originales (raw_object_key/sha256).
//   `conclusion` solo admite NOT_EVALUATED: el resultado de un proveedor externo no se convierte en verdad legal.
//   `is_synthetic` marca de forma indeleble lo que vino de una fixture: no satisface ningún requisito.
// - satellite_credentials: credencial por organización y proveedor, CIFRADA (AES-256-GCM con AAD de contexto, el
//   mismo mecanismo de datos personales). Nunca se devuelve por la API ni se registra (docs/15).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE satellite_providers (
      code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{2,39}$'),
      name text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('EXTERNAL_HTTP','SYNTHETIC_FIXTURE')),
      selection_status text NOT NULL CHECK (selection_status IN ('PROPOSED','SELECTED','TEST_ONLY','RETIRED')),
      allowed_hosts text[] NOT NULL,
      supported_operations text[] NOT NULL,
      docs_url text NOT NULL,
      license text NOT NULL,
      cost_note text NOT NULL,
      coverage_note text NOT NULL,
      limits_note text NOT NULL,
      data_sent_note text NOT NULL,
      source text NOT NULL,
      selected_by uuid REFERENCES users(id),
      decision_reference text,
      registered_at timestamptz NOT NULL DEFAULT now(),
      -- La selección exige decisión registrada (D-09): no se «activa» un proveedor por configuración.
      CONSTRAINT satellite_providers_selection CHECK ((selection_status = 'SELECTED') = (selected_by IS NOT NULL AND decision_reference IS NOT NULL)),
      -- Una fixture sintética jamás es el proveedor seleccionado.
      CONSTRAINT satellite_providers_fixture_never_selected CHECK (NOT (kind = 'SYNTHETIC_FIXTURE' AND selection_status = 'SELECTED')),
      CONSTRAINT satellite_providers_fixture_kind CHECK ((kind = 'SYNTHETIC_FIXTURE') = (selection_status = 'TEST_ONLY')),
      -- Un proveedor externo declara al menos un host permitido; la fixture no sale a la red.
      CONSTRAINT satellite_providers_hosts CHECK (
        CASE WHEN kind = 'EXTERNAL_HTTP' THEN coalesce(array_length(allowed_hosts, 1), 0) >= 1
             ELSE coalesce(array_length(allowed_hosts, 1), 0) = 0 END)
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX satellite_providers_one_selected ON satellite_providers ((selection_status)) WHERE selection_status = 'SELECTED'`.execute(db);

  await sql`
    CREATE TABLE satellite_jobs (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      plot_id uuid NOT NULL,
      plot_version_id uuid NOT NULL,
      geometry_hash char(64) NOT NULL CHECK (geometry_hash ~ '^[0-9a-f]{64}$'),
      geometry_type text NOT NULL CHECK (geometry_type IN ('POINT','POLYGON','MULTIPOLYGON')),
      provider_code text NOT NULL REFERENCES satellite_providers(code),
      provider_kind text NOT NULL CHECK (provider_kind IN ('EXTERNAL_HTTP','SYNTHETIC_FIXTURE')),
      adapter_contract_version text NOT NULL,
      operation text NOT NULL CHECK (operation IN ('FOREST_COVER','DEFORESTATION_ALERTS','HISTORICAL_ANALYSIS')),
      period_start date,
      period_end date,
      request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
      status text NOT NULL CHECK (status IN ('REQUESTED','RUNNING','COMPLETED','FAILED','CANCELLED')),
      outcome text CHECK (outcome IN ('RESULT_AVAILABLE','NO_PROVIDER_SELECTED','NO_COVERAGE','TIMEOUT','RATE_LIMITED','PROVIDER_ERROR','EGRESS_BLOCKED','GEOMETRY_UNSUPPORTED','SUPERSEDED_GEOMETRY','CANCELLED')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      locked_by text,
      locked_until timestamptz,
      lease_token uuid,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{2,59}$'),
      requested_by uuid NOT NULL REFERENCES users(id),
      requested_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      operation_id uuid NOT NULL,
      CONSTRAINT satellite_jobs_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT satellite_jobs_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT satellite_jobs_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES plots(organization_id, id),
      CONSTRAINT satellite_jobs_version_fk FOREIGN KEY (organization_id, plot_version_id) REFERENCES plot_versions(organization_id, id),
      -- Terminal ⟺ desenlace. Un trabajo abierto no tiene desenlace y uno cerrado no se queda sin él.
      CONSTRAINT satellite_jobs_outcome CHECK ((status IN ('COMPLETED','FAILED','CANCELLED')) = (outcome IS NOT NULL)),
      CONSTRAINT satellite_jobs_outcome_terminal CHECK ((outcome = 'RESULT_AVAILABLE') = (status = 'COMPLETED')),
      CONSTRAINT satellite_jobs_finished CHECK ((finished_at IS NULL) = (outcome IS NULL)),
      CONSTRAINT satellite_jobs_period CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end)
    )`.execute(db);
  await sql`CREATE INDEX satellite_jobs_plot_idx ON satellite_jobs (organization_id, plot_id, requested_at DESC)`.execute(db);
  await sql`CREATE INDEX satellite_jobs_claim_idx ON satellite_jobs (status, next_attempt_at) WHERE status IN ('REQUESTED','RUNNING')`.execute(db);

  await sql`
    CREATE TABLE satellite_results (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      job_id uuid NOT NULL,
      provider_code text NOT NULL REFERENCES satellite_providers(code),
      is_synthetic boolean NOT NULL,
      dataset text,
      dataset_version text,
      analysis_date timestamptz,
      resolution_m numeric(10,2) CHECK (resolution_m IS NULL OR resolution_m > 0),
      method text,
      coverage_status text NOT NULL CHECK (coverage_status IN ('COVERED','PARTIAL','NOT_COVERED','UNKNOWN')),
      coverage_note text NOT NULL,
      confidence text,
      limitations text NOT NULL CHECK (length(btrim(limitations)) >= 10),
      indicators jsonb NOT NULL,
      raw_object_key text,
      raw_sha256 char(64) CHECK (raw_sha256 IS NULL OR raw_sha256 ~ '^[0-9a-f]{64}$'),
      -- S1 §41: «el resultado de un proveedor externo no debe convertirse automáticamente en verdad legal».
      conclusion text NOT NULL DEFAULT 'NOT_EVALUATED' CHECK (conclusion = 'NOT_EVALUATED'),
      recorded_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT satellite_results_job_uq UNIQUE (job_id),
      CONSTRAINT satellite_results_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT satellite_results_job_fk FOREIGN KEY (organization_id, job_id) REFERENCES satellite_jobs(organization_id, id),
      CONSTRAINT satellite_results_raw CHECK ((raw_object_key IS NULL) = (raw_sha256 IS NULL)),
      -- Procedencia incompleta no se disimula: se permite guardarla, pero el campo nulo queda visible.
      CONSTRAINT satellite_results_confidence CHECK (confidence IS NULL OR length(btrim(confidence)) BETWEEN 1 AND 200)
    )`.execute(db);

  await sql`
    CREATE TABLE satellite_credentials (
      organization_id uuid NOT NULL REFERENCES organizations(id),
      provider_code text NOT NULL REFERENCES satellite_providers(code),
      secret_ciphertext text NOT NULL,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      rotated_at timestamptz,
      PRIMARY KEY (organization_id, provider_code)
    )`.execute(db);

  // Resultados append-only (como risk_evaluations): volver a analizar crea un trabajo y un resultado nuevos.
  await sql`CREATE FUNCTION satellite_results_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'satellite_results es append-only: un nuevo análisis crea un trabajo y un resultado nuevos'; END $$`.execute(db);
  await sql`CREATE TRIGGER satellite_results_no_mutation BEFORE UPDATE OR DELETE ON satellite_results FOR EACH ROW EXECUTE FUNCTION satellite_results_append_only()`.execute(db);

  // Trabajos: sin borrado, sin cambiar el sujeto ni el proveedor, y sin reabrir un trabajo terminado.
  await sql`
    CREATE FUNCTION satellite_jobs_transition() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'satellite_jobs no se borra: el historial de encargos se conserva'; END IF;
      IF OLD.status IN ('COMPLETED','FAILED','CANCELLED') THEN
        RAISE EXCEPTION 'satellite_jobs: un trabajo terminado (%) no vuelve a cambiar de estado', OLD.status;
      END IF;
      IF NEW.organization_id <> OLD.organization_id OR NEW.plot_id <> OLD.plot_id OR NEW.plot_version_id <> OLD.plot_version_id
         OR NEW.geometry_hash <> OLD.geometry_hash OR NEW.provider_code <> OLD.provider_code
         OR NEW.request_fingerprint <> OLD.request_fingerprint OR NEW.requested_by <> OLD.requested_by THEN
        RAISE EXCEPTION 'satellite_jobs: sujeto, proveedor y petición son inmutables';
      END IF;
      RETURN NEW;
    END $$`.execute(db);
  await sql`CREATE TRIGGER satellite_jobs_no_rewrite BEFORE UPDATE OR DELETE ON satellite_jobs FOR EACH ROW EXECUTE FUNCTION satellite_jobs_transition()`.execute(db);

  // Registro inicial: los tres candidatos que nombra S1 §40, documentados y SIN seleccionar (D-09), más la fixture.
  // `supported_operations`: las tres operaciones de S1 §40. Para los candidatos queda VACÍO a propósito: cuál
  // soporta cada uno se determina al seleccionar y probar el canal (D-09); declararlo ahora sería inventarlo.
  const providers: Array<[string, string, string, string, string[], string[], string, string, string, string, string, string, string]> = [
    ['WHISP', 'Whisp (Open Foris / FAO · Forest Data Partnership)', 'EXTERNAL_HTTP', 'PROPOSED', ['whisp.openforis.org'], [],
      'https://whisp.openforis.org/api/docs', 'MIT (código abierto)', 'Gratuito; sin acuerdo comercial declarado',
      'Convergencia de evidencia (JRC TMF, Hansen GFC, alertas RADD, mapas por commodity); muestreo a 10 m; corte 31-12-2020',
      'Asíncrono 5000 geometrías/trabajo y 600 s; síncrono 250 y 90 s; 30 peticiones/60 s por clave; 2 trabajos simultáneos',
      'Geometría de la parcela y parámetros técnicos; sin identificadores de usuario. Retención temporal declarada por el proveedor',
      'S1 §40; docs/15 (POR_VERIFICAR); documentación oficial consultada 2026-10-14'],
    ['GFW', 'Global Forest Watch (World Resources Institute)', 'EXTERNAL_HTTP', 'PROPOSED', ['data-api.globalforestwatch.org', 'production-api.globalforestwatch.org'], [],
      'https://www.globalforestwatch.org/terms/', 'Datos abiertos con atribución obligatoria; GFW Pro con acuerdo aparte',
      'Gratuito con clave; GFW Pro puede tener modalidades de pago', 'Datos y alertas de pérdida de cobertura (GLAD, RADD) por área de interés',
      'Cupo por clave; la clave caduca al año', 'Área de interés (geometría)',
      'S1 §40; docs/15 (POR_VERIFICAR); términos oficiales consultados 2026-10-14'],
    ['EU_FOREST_OBSERVATORY', 'EU Forest Observatory (JRC) — GFC2020 / GFT2020', 'EXTERNAL_HTTP', 'PROPOSED', ['forest-observatory.ec.europa.eu', 'ies-ows.jrc.ec.europa.eu'], [],
      'https://forest-observatory.ec.europa.eu/forest', 'Uso libre; «fuente no obligatoria, no exclusiva y no jurídicamente vinculante»',
      'Gratuito', 'Mapas de cobertura y tipo de bosque del año 2020 a 10 m (corte EUDR)',
      'Descarga, WMS y Earth Engine; sin API de análisis por parcela', 'Ninguno si se consume el mapa localmente',
      'S1 §40; documentación oficial del JRC consultada 2026-10-14'],
    ['FIXTURE_SYNTHETIC', 'Fixture sintética de pruebas (NO es análisis satelital real)', 'SYNTHETIC_FIXTURE', 'TEST_ONLY', [], ['FOREST_COVER', 'DEFORESTATION_ALERTS', 'HISTORICAL_ANALYSIS'],
      'docs/decisiones/P0-028-SATELITE.md', 'No aplica', 'No aplica',
      'No analiza nada: devuelve desenlaces predefinidos para probar el contrato y los controles',
      'Solo disponible con el interruptor de desarrollo/prueba', 'Ninguno: no sale a la red',
      'docs/15: «simuladores solo en tests/desarrollo claramente marcados»'],
  ];
  for (const [code, name, kind, status, hosts, ops, docs, license, cost, coverage, limits, dataSent, source] of providers) {
    await sql`INSERT INTO satellite_providers (code, name, kind, selection_status, allowed_hosts, supported_operations, docs_url, license, cost_note, coverage_note, limits_note, data_sent_note, source)
      VALUES (${code}, ${name}, ${kind}, ${status}, ${hosts}::text[], ${ops}::text[], ${docs}, ${license}, ${cost}, ${coverage}, ${limits}, ${dataSent}, ${source})`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE satellite_credentials`.execute(db);
  await sql`DROP TABLE satellite_results`.execute(db);
  await sql`DROP TABLE satellite_jobs`.execute(db);
  await sql`DROP TABLE satellite_providers`.execute(db);
  await sql`DROP FUNCTION satellite_results_append_only`.execute(db);
  await sql`DROP FUNCTION satellite_jobs_transition`.execute(db);
}
