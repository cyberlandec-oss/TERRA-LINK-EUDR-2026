import { sql, type Kysely } from 'kysely';

// P1-010 — Presupuesto de preparación (RF-41; S3 §33; **D-51 adoptada el 2026-10-18**).
//
// QUÉ ES, Y QUÉ NO ES
// S3 §33 pide responder «¿cuánto me cuesta cumplir EUDR por productor?» con conceptos y dinero. Las cifras que
// la fuente muestra son un **«Ejemplo»**, no tarifas, y en Terra Link **no existe ninguna cifra monetaria
// medida**. Por eso D-51 fija que los importes los **declara una persona autorizada de la organización** como
// **parámetros presupuestarios**:
//
//   · **no** son precios oficiales, **no** son costes medidos y **no** son ofertas de proveedores;
//   · **no** se precargan los importes ilustrativos de S3 ni se consulta ningún servicio externo;
//   · las **cantidades** también se declaran y quedan marcadas como **estimadas** cuando Terra Link no observa
//     la actividad: una versión de geometría **no demuestra una visita**, una evaluación automática **no
//     demuestra una revisión humana** y un trabajo satelital **no demuestra un servicio facturado**.
//
// APPEND-ONLY Y REPRODUCIBLE
// Un parámetro nunca se edita: cambiarlo es **una versión nueva**. Y una estimación guardada **lleva dentro**
// los parámetros que usó, con su versión, de modo que **cambiar una tarifa después no reescribe una estimación
// histórica**. Las dos tablas son append-only por disparador.

const APPEND_ONLY = ['budget_parameters', 'cost_estimates'];

export async function up(db: Kysely<unknown>): Promise<void> {
  // ---------------------------------------------------------------- parámetros presupuestarios
  await sql`
    CREATE TABLE budget_parameters (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      -- Los cinco conceptos de S3 §33. Cerrados: no se presupuesta un concepto inventando su nombre.
      concept text NOT NULL CHECK (concept IN ('GEOREFERENCIACION','VALIDACION','DOCUMENTACION','ANALISIS_SATELITAL','ADMINISTRACION')),
      -- Unidad PRESUPUESTARIA de D-51, no una medición: «visita prevista», «hora prevista»…
      unit text NOT NULL CHECK (unit IN ('VISITA_PREVISTA','REVISION_PREVISTA','EXPEDIENTE_DOCUMENTAL','ANALISIS_PRESUPUESTADO','HORA_PREVISTA')),
      -- Para VALIDACION, D-51 pide identificar el TIPO de revisión. En los demás conceptos no aplica.
      validation_kind text,
      amount numeric(20,6) NOT NULL CHECK (amount >= 0),
      -- D-51: una sola moneda en esta primera versión, sin conversiones.
      currency text NOT NULL CHECK (currency = 'USD'),
      valid_from date NOT NULL,
      valid_to date,
      -- Versión por concepto: corregir es registrar la siguiente, nunca sobrescribir.
      version integer NOT NULL CHECK (version > 0),
      note text CHECK (note IS NULL OR length(btrim(note)) <= 500),
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT budget_parameters_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT budget_parameters_version_uq UNIQUE (organization_id, concept, version),
      CONSTRAINT budget_parameters_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT budget_parameters_vigencia CHECK (valid_to IS NULL OR valid_to >= valid_from),
      -- La unidad no es libre: cada concepto tiene la suya, la que D-51 fijó.
      CONSTRAINT budget_parameters_unidad CHECK (
        (concept = 'GEOREFERENCIACION' AND unit = 'VISITA_PREVISTA' AND validation_kind IS NULL)
        OR (concept = 'VALIDACION' AND unit = 'REVISION_PREVISTA' AND validation_kind IS NOT NULL AND length(btrim(validation_kind)) BETWEEN 3 AND 120)
        OR (concept = 'DOCUMENTACION' AND unit = 'EXPEDIENTE_DOCUMENTAL' AND validation_kind IS NULL)
        OR (concept = 'ANALISIS_SATELITAL' AND unit = 'ANALISIS_PRESUPUESTADO' AND validation_kind IS NULL)
        OR (concept = 'ADMINISTRACION' AND unit = 'HORA_PREVISTA' AND validation_kind IS NULL))
    )`.execute(db);
  await sql`CREATE INDEX budget_parameters_org_idx ON budget_parameters (organization_id, concept, version DESC)`.execute(db);

  // ---------------------------------------------------------------- estimaciones guardadas
  await sql`
    CREATE TABLE cost_estimates (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      scope_kind text NOT NULL CHECK (scope_kind = 'LOT'),
      scope_id uuid NOT NULL,
      currency text NOT NULL CHECK (currency = 'USD'),
      -- Suma de lo que SÍ está presupuestado. No es el presupuesto completo si falta algún concepto.
      total_known numeric(20,6) NOT NULL CHECK (total_known >= 0),
      -- Un total incompleto se declara incompleto: ausencia NO es cero.
      complete boolean NOT NULL,
      -- Todo lo necesario para REPRODUCIR el resultado: parámetros con su versión, cantidades declaradas,
      -- denominadores con su fecha de consulta y los subtotales calculados.
      parameters jsonb NOT NULL,
      quantities jsonb NOT NULL,
      denominators jsonb NOT NULL,
      lines jsonb NOT NULL,
      observed jsonb NOT NULL,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT cost_estimates_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT cost_estimates_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT cost_estimates_lot_fk FOREIGN KEY (organization_id, scope_id) REFERENCES lots(organization_id, id)
    )`.execute(db);
  await sql`CREATE INDEX cost_estimates_org_idx ON cost_estimates (organization_id, created_at DESC)`.execute(db);

  for (const t of APPEND_ONLY) {
    await sql.raw(`
      CREATE FUNCTION ${t}_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '${t}: append-only; corrige con un registro nuevo';
      END $$`).execute(db);
    await sql.raw(`
      CREATE TRIGGER ${t}_append_only BEFORE UPDATE OR DELETE ON ${t}
      FOR EACH ROW EXECUTE FUNCTION ${t}_append_only()`).execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of [...APPEND_ONLY].reverse()) {
    await sql.raw(`DROP TABLE IF EXISTS ${t} CASCADE`).execute(db);
    await sql.raw(`DROP FUNCTION IF EXISTS ${t}_append_only()`).execute(db);
  }
}
