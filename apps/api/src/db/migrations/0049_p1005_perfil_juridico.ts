import { Kysely, sql } from 'kysely';

// P1-005 — Perfil jurídico **revisable**, versionado y adoptable. NO aprueba contenido jurídico.
//
// QUÉ RESUELVE Y QUÉ NO
// Monta el mecanismo —preparar un perfil, vincular fuentes y evidencias, revisar aplicabilidad, registrar
// resultado y pendientes, y conservar historial— **sin aprobar ninguna regla**. El perfil que se siembra es
// **PARCIAL** (tenencia y uso del suelo) y su revisión jurídica queda **PENDIENTE**: por eso **no puede
// satisfacer `LEGAL_PROFILE`** ni abrir `READY`. Tener el mecanismo no es tener el perfil.
//
// POR QUÉ ESTAS TABLAS Y NO OTRAS
// Se reutilizan los patrones que el repositorio ya tiene probados, en vez de inventar otros:
//   · **catálogo de plataforma con versiones inmutables** y adopción por organización, como `risk_rule_sets`
//     + `risk_rule_set_adoptions` (D-07.1);
//   · **append-only con decisión fechada**: adoptar, retirar y revisar son FILAS, no `UPDATE` de estado;
//   · **evidencia = versión exacta de documento** (`document_versions`), con la integridad de tenant por
//     clave compuesta. No se crea otro almacén de documentos.
//
// LAS TRES COSAS QUE SE SEPARAN, PORQUE CONFUNDIRLAS ES EL ERROR CARO
//   1. **Documento obtenido** — se tiene el archivo, con su huella.
//   2. **Texto contrastado** — se leyó y se comprobó contra el propio documento.
//   3. **Vigencia jurídicamente revisada** — alguien con competencia lo afirmó y fundamentó.
// Las dos primeras son trabajo de recopilación; **solo la tercera es jurídica**, y hoy es `false` en todas.
//
// APLICABILIDAD, EVIDENCIA Y RESULTADO SON EJES DISTINTOS
// Una obligación puede ser aplicable y no tener evidencia (queda **pendiente**, nunca satisfecha); su
// aplicabilidad puede ser **desconocida** (queda **no evaluable**, nunca cumplida por defecto); y la ausencia
// de evidencia **no demuestra una infracción**. Los `CHECK` de `legal_assessment_items` lo imponen en la base,
// no en la capa de servicio: una combinación incoherente **no se puede escribir**.
//
// LA CARTOGRAFÍA NO DECIDE
// `cartographic_indication` se guarda con su fuente y su nota, y **ningún `CHECK` la liga al resultado**: es
// un indicio que abre revisión, jamás una conclusión de cumplimiento ni de infracción.

const PERFIL = '0.1.0';

export async function up(db: Kysely<unknown>): Promise<void> {
  // ---------------------------------------------------------------- catálogo de plataforma (inmutable)
  await sql`
    CREATE TABLE legal_profile_versions (
      version text PRIMARY KEY CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
      jurisdiction text NOT NULL CHECK (jurisdiction = 'EC'),
      -- PARTIAL se declara en el propio dato: no es una nota al pie que se pueda perder.
      scope text NOT NULL CHECK (scope IN ('PARTIAL','COMPLETE')),
      scope_note text NOT NULL CHECK (length(btrim(scope_note)) BETWEEN 10 AND 2000),
      covered_matters text[] NOT NULL CHECK (cardinality(covered_matters) > 0),
      -- Lo que falta queda VISIBLE en el catálogo, no escondido fuera de él.
      pending_matters text[] NOT NULL,
      technical_status text NOT NULL CHECK (technical_status IN ('DRAFT','PUBLISHED')),
      -- Catalogo de SISTEMA: el autor es texto, no un usuario, igual que en risk_rule_sets. Si dependiera
      -- de que exista un usuario, una base recién migrada se quedaría sin catálogo.
      published_by text NOT NULL,
      published_at timestamptz NOT NULL DEFAULT now(),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      -- Un perfil COMPLETE no puede dejar materias pendientes: sería una contradicción publicada.
      CONSTRAINT legal_profile_versions_scope_coherent CHECK (scope = 'PARTIAL' OR cardinality(pending_matters) = 0)
    )`.execute(db);

  // La revisión JURÍDICA es un hecho fechado y firmado, no una columna que alguien ponga en true.
  await sql`
    CREATE TABLE legal_profile_reviews (
      id uuid PRIMARY KEY,
      version text NOT NULL REFERENCES legal_profile_versions(version),
      decision text NOT NULL CHECK (decision IN ('REVIEWED','OBJECTED','WITHDRAWN')),
      -- Responsable IDENTIFICADO y FUNDAMENTO de su revisión: sin los dos no hay revisión jurídica.
      reviewer_id uuid NOT NULL REFERENCES users(id),
      reviewer_capacity text NOT NULL CHECK (length(btrim(reviewer_capacity)) BETWEEN 3 AND 300),
      basis text NOT NULL CHECK (length(btrim(basis)) BETWEEN 10 AND 2000),
      decided_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL UNIQUE
    )`.execute(db);
  await sql`CREATE INDEX legal_profile_reviews_version_idx ON legal_profile_reviews (version, decided_at DESC)`.execute(db);

  // ---------------------------------------------------------------- fuentes del perfil
  await sql`
    CREATE TABLE legal_profile_sources (
      version text NOT NULL REFERENCES legal_profile_versions(version),
      code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_-]{2,59}$'),
      title text NOT NULL,
      authority text NOT NULL,
      publication text NOT NULL,
      publication_date date NOT NULL,
      url text NOT NULL CHECK (url LIKE 'https://%'),
      -- Identificación de la COPIA: huella del archivo, índice de página del PDF y numeración IMPRESA.
      -- Sin las tres, dos copias del mismo suplemento se confunden y «página 35» no quiere decir nada.
      file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
      pdf_page_index int CHECK (pdf_page_index IS NULL OR pdf_page_index > 0),
      printed_page text,
      -- Los tres estados que NO son lo mismo.
      document_obtained boolean NOT NULL DEFAULT false,
      text_contrasted boolean NOT NULL DEFAULT false,
      legal_validity_reviewed boolean NOT NULL DEFAULT false,
      modifications_found text NOT NULL,
      gaps text NOT NULL,
      PRIMARY KEY (version, code),
      -- No se puede contrastar un texto que no se tiene, ni revisar la vigencia de lo que no se ha leído.
      CONSTRAINT legal_profile_sources_order CHECK (
        (NOT text_contrasted OR document_obtained) AND (NOT legal_validity_reviewed OR text_contrasted))
    )`.execute(db);

  // ---------------------------------------------------------------- reglas candidatas
  await sql`
    CREATE TABLE legal_profile_rules (
      version text NOT NULL REFERENCES legal_profile_versions(version),
      code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_-]{2,59}$'),
      matter text NOT NULL CHECK (matter IN ('TENURE','LAND_USE','ENVIRONMENT','LABOUR','HUMAN_RIGHTS','FPIC','TAX','CUSTOMS','ANTICORRUPTION')),
      source_code text NOT NULL,
      article text NOT NULL,
      -- A QUIÉN se dirige: una obligación de una autoridad no es un documento exigible al productor.
      subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 3 AND 300),
      applicability_condition text NOT NULL CHECK (length(btrim(applicability_condition)) BETWEEN 3 AND 1000),
      evidence_required text NOT NULL,
      -- Qué puede comprobar el producto por sí solo, y qué no.
      product_can_check text NOT NULL,
      needs_legal_review boolean NOT NULL DEFAULT true,
      -- Una candidata en borrador NO es una regla aprobada; se publica como tal.
      review_status text NOT NULL CHECK (review_status IN ('DRAFT','REVIEWED')),
      gaps text NOT NULL,
      PRIMARY KEY (version, code),
      CONSTRAINT legal_profile_rules_source_fk FOREIGN KEY (version, source_code) REFERENCES legal_profile_sources (version, code)
    )`.execute(db);

  // ---------------------------------------------------------------- adopción por organización
  await sql`
    CREATE TABLE legal_profile_adoptions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      version text NOT NULL REFERENCES legal_profile_versions(version),
      decision text NOT NULL CHECK (decision IN ('ADOPT','WITHDRAW')),
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
      decided_by uuid NOT NULL REFERENCES users(id),
      decided_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT legal_profile_adoptions_operation_uq UNIQUE (organization_id, operation_id)
    )`.execute(db);
  await sql`CREATE INDEX legal_profile_adoptions_org_idx ON legal_profile_adoptions (organization_id, decided_at DESC)`.execute(db);

  // ---------------------------------------------------------------- evaluación por parcela
  await sql`
    CREATE TABLE legal_assessments (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      subject_type text NOT NULL CHECK (subject_type = 'PLOT'),
      subject_id uuid NOT NULL,
      version text NOT NULL REFERENCES legal_profile_versions(version),
      status text NOT NULL CHECK (status IN ('OPEN','CLOSED')),
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      closed_at timestamptz,
      operation_id uuid NOT NULL,
      CONSTRAINT legal_assessments_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT legal_assessments_operation_uq UNIQUE (organization_id, operation_id),
      CONSTRAINT legal_assessments_plot_fk FOREIGN KEY (organization_id, subject_id) REFERENCES plots (organization_id, id),
      CONSTRAINT legal_assessments_closed CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
    )`.execute(db);
  await sql`CREATE INDEX legal_assessments_subject_idx ON legal_assessments (organization_id, subject_id, created_at DESC)`.execute(db);

  await sql`
    CREATE TABLE legal_assessment_items (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      assessment_id uuid NOT NULL,
      version text NOT NULL,
      rule_code text NOT NULL,
      -- EJE 1: aplicabilidad. UNKNOWN es el valor de partida, y es una respuesta, no un hueco.
      applicability text NOT NULL CHECK (applicability IN ('UNKNOWN','APPLICABLE','NOT_APPLICABLE')),
      applicability_reason text,
      -- EJE 2: evidencia. Procedencia DIFERENCIADA; admitir un archivo no lo vuelve auténtico ni suficiente.
      evidence_version_id uuid,
      evidence_origin text CHECK (evidence_origin IN ('OFFICIAL_DOCUMENT','PRODUCER_DECLARATION')),
      evidence_admissibility text NOT NULL DEFAULT 'NOT_JUSTIFIED' CHECK (evidence_admissibility IN ('NOT_JUSTIFIED','JUSTIFIED')),
      evidence_justification text,
      -- EJE 3: resultado de la revisión.
      result text NOT NULL CHECK (result IN ('PENDING','SATISFIED','NOT_SATISFIED','NOT_EVALUABLE','NOT_APPLICABLE')),
      reviewer_id uuid REFERENCES users(id),
      reviewed_at timestamptz,
      reason text,
      -- La cartografía se guarda APARTE y no entra en ningún CHECK de resultado: es indicio, no veredicto.
      cartographic_indication text NOT NULL DEFAULT 'NONE' CHECK (cartographic_indication IN ('NONE','INDICATION','NOT_ASSESSED')),
      cartographic_source text,
      cartographic_note text,
      row_version bigint NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT legal_assessment_items_uq UNIQUE (assessment_id, rule_code),
      CONSTRAINT legal_assessment_items_org_id_uq UNIQUE (organization_id, id),
      CONSTRAINT legal_assessment_items_assessment_fk FOREIGN KEY (organization_id, assessment_id) REFERENCES legal_assessments (organization_id, id),
      CONSTRAINT legal_assessment_items_rule_fk FOREIGN KEY (version, rule_code) REFERENCES legal_profile_rules (version, code),
      -- La evidencia es una VERSIÓN EXACTA de documento, y de la MISMA organización.
      CONSTRAINT legal_assessment_items_evidence_fk FOREIGN KEY (organization_id, evidence_version_id) REFERENCES document_versions (organization_id, id),
      CONSTRAINT legal_assessment_items_evidence_pair CHECK ((evidence_version_id IS NULL) = (evidence_origin IS NULL)),
      -- Aplicabilidad DESCONOCIDA: no evaluable. Nunca cumplida por defecto, nunca incumplida.
      CONSTRAINT legal_assessment_items_unknown CHECK (applicability <> 'UNKNOWN' OR result = 'NOT_EVALUABLE'),
      -- NO aplicable: se dice que no aplica, no que se cumple.
      CONSTRAINT legal_assessment_items_not_applicable CHECK (applicability <> 'NOT_APPLICABLE' OR result = 'NOT_APPLICABLE'),
      -- APLICABLE sin evidencia: PENDIENTE. Ni satisfecha ni, por sí sola, infracción.
      CONSTRAINT legal_assessment_items_no_evidence CHECK (
        applicability <> 'APPLICABLE' OR evidence_version_id IS NOT NULL OR result = 'PENDING'),
      -- SATISFECHA exige las cuatro cosas a la vez: aplicable, evidencia, admisibilidad justificada y revisor.
      CONSTRAINT legal_assessment_items_satisfied CHECK (
        result <> 'SATISFIED' OR (applicability = 'APPLICABLE' AND evidence_version_id IS NOT NULL
          AND evidence_admissibility = 'JUSTIFIED' AND evidence_justification IS NOT NULL
          AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND reason IS NOT NULL)),
      -- Declarar admisible exige justificarlo POR REQUISITO: no es una casilla.
      CONSTRAINT legal_assessment_items_admissibility CHECK (
        evidence_admissibility <> 'JUSTIFIED' OR (evidence_version_id IS NOT NULL AND evidence_justification IS NOT NULL)),
      -- Un resultado de revisión (satisfecha o no) exige revisor y motivo: nada se concluye en anónimo.
      CONSTRAINT legal_assessment_items_reviewed CHECK (
        result NOT IN ('SATISFIED','NOT_SATISFIED') OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND reason IS NOT NULL))
    )`.execute(db);
  await sql`CREATE INDEX legal_assessment_items_assessment_idx ON legal_assessment_items (organization_id, assessment_id)`.execute(db);

  // ---------------------------------------------------------------- historial (append-only)
  // Los ítems cambian; su historia NO. Cada cambio deja una fila, y las filas no se tocan.
  await sql`
    CREATE TABLE legal_assessment_item_history (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      item_id uuid NOT NULL,
      row_version bigint NOT NULL,
      applicability text NOT NULL,
      evidence_version_id uuid,
      evidence_origin text,
      evidence_admissibility text NOT NULL,
      result text NOT NULL,
      reviewer_id uuid REFERENCES users(id),
      reason text,
      cartographic_indication text NOT NULL,
      changed_by uuid NOT NULL REFERENCES users(id),
      changed_at timestamptz NOT NULL DEFAULT now(),
      change_note text NOT NULL,
      CONSTRAINT legal_assessment_item_history_item_fk FOREIGN KEY (organization_id, item_id) REFERENCES legal_assessment_items (organization_id, id),
      CONSTRAINT legal_assessment_item_history_uq UNIQUE (item_id, row_version)
    )`.execute(db);
  await sql`CREATE INDEX legal_assessment_item_history_idx ON legal_assessment_item_history (organization_id, item_id, row_version DESC)`.execute(db);

  // ---------------------------------------------------------------- inmutabilidad
  for (const t of ['legal_profile_versions', 'legal_profile_sources', 'legal_profile_rules', 'legal_profile_reviews', 'legal_profile_adoptions', 'legal_assessment_item_history']) {
    await sql.raw(`
      CREATE OR REPLACE FUNCTION ${t}_append_only() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '${t} es append-only: corrige con una fila nueva, no modificando la existente.';
      END $$ LANGUAGE plpgsql`).execute(db);
    await sql.raw(`CREATE TRIGGER ${t}_no_mutation BEFORE UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION ${t}_append_only()`).execute(db);
  }

  // ---------------------------------------------------------------- siembra del perfil 0.1.0 PARCIAL
  await sql`
    INSERT INTO legal_profile_versions (version, jurisdiction, scope, scope_note, covered_matters, pending_matters, technical_status, published_by, reason)
    VALUES (${PERFIL}, 'EC', 'PARTIAL',
      'Alcance PARCIAL y declarado: tenencia y uso del suelo, que es donde hay fuente oficial verificada. NO cubre laboral, penal ambiental, tributario, aduanero, anticorrupción ni CLPI, y por eso NO puede satisfacer por si solo LEGAL_PROFILE ni habilitar una conclusion regulatoria favorable. Publicacion TECNICA: la revision juridica sigue PENDIENTE.',
      ARRAY['TENURE','LAND_USE'],
      ARRAY['ENVIRONMENT','LABOUR','HUMAN_RIGHTS','FPIC','TAX','CUSTOMS','ANTICORRUPTION'],
      'PUBLISHED', 'migracion 0049_p1005_perfil_juridico',
      'P1-005: perfil revisable con fuentes verificadas de tenencia y uso del suelo. No aprueba contenido juridico.')`.execute(db);

  await sql`
    INSERT INTO legal_profile_sources (version, code, title, authority, publication, publication_date, url, file_sha256, pdf_page_index, printed_page, document_obtained, text_contrasted, legal_validity_reviewed, modifications_found, gaps) VALUES
    (${PERFIL}, 'LOTRTA-711', 'Ley Organica de Tierras Rurales y Territorios Ancestrales', 'Asamblea Nacional del Ecuador', 'Registro Oficial Suplemento 711', '2016-03-14',
      'https://www.asambleanacional.gob.ec/sites/default/files/private/asambleanacional/filesasambleanacionalnameuid-29/Leyes%202013-2017/36-ley-tierras/RO-LEY%20DE%20TIERRAS-RO-SUP-711-14-03-2016.pdf',
      '8ee8598db5735098e278194995993a43e3b343dd78fba47acebb538f82cfc76b', 1, '1',
      true, true, false,
      'Modificada por el Art. 56 del RO-S 309 (2018) y por las Disposiciones Reformatorias PRIMERA a SEPTIMA del 2do Suplemento 29 (2022).',
      'No hay texto consolidado oficial: no se puede afirmar que esta sea la redaccion vigente ni que no existan reformas posteriores a marzo de 2022.'),
    (${PERFIL}, 'FOMENTO-309', 'Ley Organica para el Fomento Productivo (Art. 56: reforma a la LOTRTA)', 'Asamblea Nacional del Ecuador', 'Registro Oficial Suplemento 309', '2018-08-21',
      'https://www.asambleanacional.gob.ec/sites/default/files/private/asambleanacional/filesasambleanacionalnameuid-29/Leyes%202013-2017/563-fomento/ro-fomento-productivo-ro-supl-309-21-08-2018.pdf',
      '1b6584acbf3faf62a6beaf330cba31378524f69cbc6cb6a81f91d7fe8717e818', NULL, NULL,
      true, true, false,
      'Fe de erratas en RO-S 321 (2018-09-06): corrige los articulos 35 y 47, la Disposicion General Decima y dos transitorias. NO toca el Art. 56.',
      'Vigencia posterior no verificada.'),
    (${PERFIL}, 'VIVIENDA-29', 'Ley Organica de Vivienda de Interes Social (Disposiciones Reformatorias a la LOTRTA)', 'Asamblea Nacional del Ecuador', 'Registro Oficial Segundo Suplemento 29', '2022-03-25',
      'https://www.asambleanacional.gob.ec/sites/default/files/private/asambleanacional/filesasambleanacionalnameuid-29/Leyes%202013-2017/715-dgarcia/ro.29-2do-sup-25-03-2022.pdf',
      '24ba55e6a206ea1113166243da4640eaca42a9f3ed5ef0e47868020926b03f44', 36, '33-34',
      true, true, false,
      'Disposiciones Reformatorias PRIMERA a SEPTIMA: modifican los articulos 54, 59, 66, 67, 68, 69 y el Titulo II de la LOTRTA. Verificadas VISUALMENTE: el documento es un escaneo sin capa de texto entre las paginas 4 y 39.',
      'No se ha buscado exhaustivamente si existen reformas posteriores a marzo de 2022.')`.execute(db);

  await sql`
    INSERT INTO legal_profile_rules (version, code, matter, source_code, article, subject, applicability_condition, evidence_required, product_can_check, needs_legal_review, review_status, gaps) VALUES
    (${PERFIL}, 'EC-TENENCIA-ADJUDICACION', 'TENURE', 'VIVIENDA-29', 'LOTRTA Arts. 54, 59, 66-69 (reformados en 2022)',
      'Posesionario o peticionario de adjudicacion de tierra rural ESTATAL',
      'Solo si la tenencia proviene de regularizacion o adjudicacion estatal. NO aplica a propiedad privada preexistente.',
      'Acto de adjudicacion. El Art. 59 reformado dice que la adjudicacion de tierras rurales estatales en posesion agraria constituye justo titulo.',
      'Puede registrar y versionar el acto si el productor lo aporta. NO puede verificar su autenticidad.',
      true, 'DRAFT',
      'Reglamento General de la LOTRTA no obtenido; procedimiento vigente tras 2022 sin verificar.'),
    (${PERFIL}, 'EC-USO-ECOSISTEMAS-FRAGILES', 'LAND_USE', 'LOTRTA-711', 'LOTRTA Art. 13',
      'Quien realiza el aprovechamiento agrario en el predio',
      'Solo si el predio contiene o colinda con ecosistemas fragiles (paramos, manglares, bosques primarios, humedales u otros del dominio hidrico publico). La conducta regulada es AMPLIAR la frontera agricola o el aprovechamiento existente, no el aprovechamiento ya existente.',
      'Localizacion; si hubo ampliacion y cuando; instrumento de manejo elaborado por el Estado de forma participativa cuando aplique.',
      'Solo indicio de LOCALIZACION, y de forma indiciaria. NO puede demostrar ampliacion, ni su fecha, ni incumplimiento.',
      true, 'DRAFT',
      'Falta identificar que cartografia oficial delimita cada ecosistema nombrado y que norma concreta es "lo establecido en la Ley".'),
    (${PERFIL}, 'EC-FUNCION-SOCIAL', 'LAND_USE', 'LOTRTA-711', 'LOTRTA Art. 11',
      'Propietario o posesionario de predio rural con aptitud productiva',
      'Predio rural con aptitud productiva. No se ha determinado si alcanza a todo productor de cacao.',
      'Sin definir: el articulo fija condiciones, no una lista de documentos.',
      'Casi nada por si solo. Puede registrar actividad productiva declarada; no puede evaluar latifundio ni respeto a derechos colectivos.',
      true, 'DRAFT',
      'Los parametros de productividad los fija la Autoridad Agraria Nacional y no se han localizado.'),
    (${PERFIL}, 'EC-POSESION-ANCESTRAL', 'TENURE', 'LOTRTA-711', 'LOTRTA Arts. 77-78',
      'El Estado, que reconoce y garantiza; y quien pretenda derechos sobre esos territorios',
      'Solo predios en territorios de posesion ancestral o propiedad comunitaria. NO aplica por defecto.',
      'Determinacion de si el predio esta en el supuesto y, en su caso, actos de reconocimiento.',
      'Nada de forma autonoma: no hay capa publica que delimite posesion ancestral con fiabilidad juridica.',
      true, 'DRAFT',
      'Fuente oficial de delimitacion; articulacion con el consentimiento libre, previo e informado que exige EUDR.')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['legal_assessment_item_history', 'legal_assessment_items', 'legal_assessments', 'legal_profile_adoptions', 'legal_profile_rules', 'legal_profile_sources', 'legal_profile_reviews', 'legal_profile_versions']) {
    await sql.raw(`DROP TABLE IF EXISTS ${t} CASCADE`).execute(db);
    await sql.raw(`DROP FUNCTION IF EXISTS ${t}_append_only()`).execute(db);
  }
}
