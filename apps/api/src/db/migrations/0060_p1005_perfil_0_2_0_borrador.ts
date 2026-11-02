import { Kysely, sql } from 'kysely';

// P1-005: perfil jurídico **0.2.0 en BORRADOR** (`technical_status = 'DRAFT'`). Prepara, con el mecanismo existente,
// las reglas candidatas EC-7 a EC-9 del bloque ambiental (COA, RO-S 983, 2017), que `0.1.0` declaró pendientes.
//
// QUÉ NO ES
//  · No está publicado: `adoptar()` rechaza toda versión que no sea PUBLISHED (LEGAL_PROFILE_NOT_PUBLISHED), así que
//    ninguna organización puede adoptarlo ni se reevalúa ningún expediente.
//  · No sustituye a `0.1.0` ni toca sus filas, evaluaciones ni resultados históricos (las tablas son append-only).
//  · No valida contenido jurídico: cada regla queda `DRAFT` y `needs_legal_review`. Publicarlo o no, y su contenido,
//    es decisión del revisor competente (docs/decisiones/P1-005-MATRIZ-OBLIGACIONES.md §6).
//
// POR REGLA queda: la fuente y el artículo (procedencia), la versión del perfil, la interpretación propuesta y las
// preguntas pendientes para el revisor (en `gaps`, con esos dos encabezados).
const BASE = '0.1.0';
const PERFIL = '0.2.0';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO legal_profile_versions (version, jurisdiction, scope, scope_note, covered_matters, pending_matters, technical_status, published_by, reason)
    VALUES (${PERFIL}, 'EC', 'PARTIAL',
      'BORRADOR TECNICO, no publicado y no adoptable. Conserva las reglas de 0.1.0 y propone tres candidatas ambientales (COA Arts. 92, 94 y 99), sin revision juridica. Sigue siendo PARCIAL: no cubre laboral, derechos humanos, CLPI, tributario, aduanero ni anticorrupcion, y la materia ambiental solo en lo que recogen esas tres candidatas.',
      ARRAY['TENURE','LAND_USE','ENVIRONMENT'],
      ARRAY['LABOUR','HUMAN_RIGHTS','FPIC','TAX','CUSTOMS','ANTICORRUPTION'],
      'DRAFT', 'migracion 0060_p1005_perfil_0_2_0_borrador',
      'P1-005: borrador con EC-7 a EC-9. No aprueba contenido juridico ni sustituye a 0.1.0.')`.execute(db);

  await sql`
    INSERT INTO legal_profile_sources (version, code, title, authority, publication, publication_date, url, file_sha256, pdf_page_index, printed_page, document_obtained, text_contrasted, legal_validity_reviewed, modifications_found, gaps)
    SELECT ${PERFIL}, code, title, authority, publication, publication_date, url, file_sha256, pdf_page_index, printed_page, document_obtained, text_contrasted, legal_validity_reviewed, modifications_found, gaps
    FROM legal_profile_sources WHERE version = ${BASE}`.execute(db);

  await sql`
    INSERT INTO legal_profile_sources (version, code, title, authority, publication, publication_date, url, file_sha256, pdf_page_index, printed_page, document_obtained, text_contrasted, legal_validity_reviewed, modifications_found, gaps) VALUES
    (${PERFIL}, 'COA-983', 'Codigo Organico del Ambiente (texto original)', 'Asamblea Nacional del Ecuador', 'Registro Oficial Suplemento 983', '2017-04-12',
      'https://www.asambleanacional.gob.ec/sites/default/files/private/asambleanacional/filesasambleanacionalnameuid-29/Leyes%202013-2017/102-ambiente/ro-cod-ambiente-ro-s-983-12-04-2017.pdf',
      '033ffdd280975aabb0b89f6634b4e7f9462b3a835d49abcbbecefdaed96e61af', NULL, NULL,
      true, true, false,
      'Verificada la reforma del Art. 53 del RO-S 309 (2018) al segundo inciso del Art. 209 (acreditacion de laboratorios; no impone nada al productor). No se localizaron modificaciones a los Arts. 92, 94 y 99.',
      'Es la publicacion original, no un texto consolidado: no se ha hecho busqueda exhaustiva de reformas posteriores a 2018. Vigencia sin revisar.')`.execute(db);

  await sql`
    INSERT INTO legal_profile_rules (version, code, matter, source_code, article, subject, applicability_condition, evidence_required, product_can_check, needs_legal_review, review_status, gaps)
    SELECT ${PERFIL}, code, matter, source_code, article, subject, applicability_condition, evidence_required, product_can_check, needs_legal_review, review_status, gaps
    FROM legal_profile_rules WHERE version = ${BASE}`.execute(db);

  await sql`
    INSERT INTO legal_profile_rules (version, code, matter, source_code, article, subject, applicability_condition, evidence_required, product_can_check, needs_legal_review, review_status, gaps) VALUES
    (${PERFIL}, 'EC-PFN-CONVERSION-USO', 'ENVIRONMENT', 'COA-983', 'COA Art. 94 (alcance del PFN: Art. 89)',
      'Quien convierte el uso del suelo',
      'Solo si el predio esta en el Patrimonio Forestal Nacional o en un area asignada como tal en los planes de ordenamiento. No aplica por defecto.',
      'Si el predio esta en el supuesto; si hubo conversion a uso agropecuario y cuando.',
      'Nada concluyente: a lo sumo un indicio de localizacion. No puede demostrar la conversion ni su fecha.',
      true, 'DRAFT',
      'Procedencia: COA Art. 94 (prohibe convertir el uso del suelo a usos agropecuarios en el PFN y en areas asignadas, tales como bosques naturales y ecosistemas fragiles), con el alcance del PFN en el Art. 89. Interpretacion propuesta: prohibicion dirigida a quien convierte, condicionada a que el predio este en el supuesto. Preguntas para el revisor: que cartografia oficial delimita el PFN; si un uso agropecuario anterior queda amparado; si la regla es oponible al operador EUDR. Delimitacion oficial del PFN no verificada.'),
    (${PERFIL}, 'EC-PARAMOS-MORETALES-MANGLARES', 'ENVIRONMENT', 'COA-983', 'COA Art. 99',
      'Quien afecta, tala o cambia el uso del suelo',
      'Solo predios con paramos, moretales o manglares. No aplica por defecto.',
      'Localizacion, conducta y fecha.',
      'Indicio de localizacion, nada mas.',
      true, 'DRAFT',
      'Procedencia: COA Art. 99 (conservacion de paramos, moretales y manglares; prohibe afectar, talar y cambiar el uso del suelo de conformidad con la ley). Interpretacion propuesta: prohibicion condicionada a la presencia del ecosistema. Preguntas para el revisor: como se articula con el Art. 13 de la LOTRTA (que regula ampliar con condiciones) y que prima si concurren; que cartografia delimita cada ecosistema.'),
    (${PERFIL}, 'EC-PROPIEDAD-EN-PFN', 'ENVIRONMENT', 'COA-983', 'COA Art. 92',
      'Propietario de tierras dentro del PFN',
      'Solo propiedad dentro del Patrimonio Forestal Nacional. No aplica por defecto.',
      'Instrumento de ordenamiento que asigna el uso.',
      'Puede registrar lo que el productor aporte; no puede verificar su autenticidad.',
      true, 'DRAFT',
      'Procedencia: COA Art. 92 (el propietario destina las tierras a los usos asignados por los instrumentos de planificacion, respeta las normas de sostenibilidad y delimita o respeta las servidumbres ecologicas). Interpretacion propuesta: deber del propietario condicionado a estar dentro del PFN. Preguntas para el revisor: si el incumplimiento es oponible al operador EUDR; que instrumentos de ordenamiento aplican. Instrumentos de ordenamiento no obtenidos.')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Las tablas son append-only: solo se retira el borrador completo, saltando temporalmente los triggers.
  for (const t of ['legal_profile_rules', 'legal_profile_sources', 'legal_profile_versions']) {
    await sql.raw(`ALTER TABLE ${t} DISABLE TRIGGER ${t}_no_mutation`).execute(db);
    await sql.raw(`DELETE FROM ${t} WHERE version = '${PERFIL}'`).execute(db);
    await sql.raw(`ALTER TABLE ${t} ENABLE TRIGGER ${t}_no_mutation`).execute(db);
  }
}
