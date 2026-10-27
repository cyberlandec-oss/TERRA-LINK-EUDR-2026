import { sql, type Kysely } from 'kysely';

// P1-013 — Extracción asistida de documentos (RF-44; S1 §55).
//
// QUÉ ES, Y QUÉ NO ES
// **S1 §55** describe la tubería documental —subida, antivirus, metadatos, checksum, almacenamiento,
// clasificación, vínculo de evidencia, validación— y añade: *«Posteriormente: OCR/IA, pero **no en la primera
// versión como dependencia crítica**»*. Esto es ese «posteriormente», y conserva la condición: **nada depende
// de la extracción**.
//
// **RF-44** (`docs/03:60`, columna **Restricción**) exige «**revisión humana y evidencia de extracción**».
// **P1-013** (`docs/18:214`, aceptación mínima) exige «campos sugeridos con **fuente/confianza** y revisión;
// **no decisión regulatoria automática**».
//
// TRES COSAS DISTINTAS, TRES SITIOS DISTINTOS
//   1. **Texto extraído** del archivo: `document_extractions`. Es lo que el documento dice, literalmente.
//   2. **Valor sugerido**: `document_extraction_fields`. Lleva **de dónde sale** —el fragmento literal y su
//      posición— y **en qué se basa la confianza**, que no es un número inventado sino la **regla que
//      disparó la sugerencia**.
//   3. **Dato confirmado por una persona**: `document_extraction_decisions`. Sin esto, **no hay dato**.
//
// LO QUE NO HACE
//   · **No sobrescribe nada**: `document_versions` no se toca. Una confirmación es un **registro propio**.
//   · **No decide**: no acredita autenticidad, legalidad, calidad ni suficiencia documental, y no levanta
//     ninguna compuerta.
//   · **No sale fuera**: no hay ningún servicio externo ni modelo remoto. Lo que no se puede leer en local
//     se declara **no soportado**, en vez de enviarse a un tercero.
//
// LA EXTRACCIÓN SE ATA A LA VERSIÓN EXACTA
// La clave foránea es `version_id`, no `document_id`: si se sube una versión nueva, la extracción anterior
// **sigue siendo de la versión anterior** y así se publica. Nada se arrastra en silencio.
//
// APPEND-ONLY
// Ni las extracciones, ni las sugerencias, ni las decisiones se editan o borran.

const APPEND_ONLY = ['document_extractions', 'document_extraction_fields', 'document_extraction_decisions'];

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE document_extractions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      -- La VERSIÓN exacta, no el documento: una versión nueva no hereda esta extracción.
      version_id uuid NOT NULL REFERENCES document_versions(id),
      run_number integer NOT NULL CHECK (run_number >= 1),
      status text NOT NULL CHECK (status IN ('EXTRAIDA', 'SIN_TEXTO', 'FORMATO_NO_SOPORTADO', 'FALLIDA')),
      -- Qué lo hizo, con su versión: la evidencia de extracción que pide RF-44.
      engine text NOT NULL,
      engine_version text NOT NULL,
      -- Huella del archivo analizado: prueba de que se analizó ESE archivo y no otro.
      source_sha256 char(64) NOT NULL,
      text_chars integer NOT NULL DEFAULT 0 CHECK (text_chars >= 0),
      pages integer CHECK (pages IS NULL OR pages >= 0),
      -- Texto literal extraído. Puede ser NULL cuando no se pudo leer; nunca se inventa.
      extracted_text text,
      note text NOT NULL,
      extracted_by uuid NOT NULL REFERENCES users(id),
      extracted_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT extraction_operation_unique UNIQUE (organization_id, operation_id),
      CONSTRAINT extraction_run_unique UNIQUE (version_id, run_number),
      -- Si se extrajo texto, hay texto; si no, no se finge que lo haya.
      CONSTRAINT extraction_text_shape CHECK (
        (status = 'EXTRAIDA' AND extracted_text IS NOT NULL AND text_chars > 0)
        OR (status <> 'EXTRAIDA' AND text_chars = 0))
    )`.execute(db);
  await sql`CREATE INDEX document_extractions_version_idx ON document_extractions (version_id, run_number DESC)`.execute(db);

  await sql`
    CREATE TABLE document_extraction_fields (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      extraction_id uuid NOT NULL REFERENCES document_extractions(id),
      -- Campo de destino. Cerrado: no se sugiere hacia un campo que no existe.
      field_code text NOT NULL CHECK (field_code IN ('ISSUER', 'ISSUED_AT', 'EXPIRES_AT')),
      -- Valor SUGERIDO. NULL cuando la regla encontró varios candidatos: ahí no se elige por la persona.
      suggested_value text,
      /*
       * «Confianza» NO es un número inventado: es la REGLA que disparó la sugerencia, que cualquiera puede
       * comprobar sobre el texto.
       *   ETIQUETA_EXPLICITA → el documento rotula el valor («Fecha de emisión: …»)  → ALTA
       *   PATRON_UNICO       → hay exactamente un candidato de esa forma             → MEDIA
       *   PATRON_AMBIGUO     → hay varios candidatos; NO se sugiere ninguno          → BAJA
       */
      basis text NOT NULL CHECK (basis IN ('ETIQUETA_EXPLICITA', 'PATRON_UNICO', 'PATRON_AMBIGUO')),
      confidence text NOT NULL CHECK (confidence IN ('ALTA', 'MEDIA', 'BAJA')),
      -- PROCEDENCIA: el fragmento literal del que sale, y dónde está en el texto.
      source_excerpt text,
      source_offset integer CHECK (source_offset IS NULL OR source_offset >= 0),
      -- Todos los candidatos cuando es ambiguo, para que la persona elija con la vista puesta en el texto.
      candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
      CONSTRAINT field_once_per_run UNIQUE (extraction_id, field_code),
      -- Ambiguo ⇒ sin valor sugerido. Con valor ⇒ hay fragmento de procedencia.
      CONSTRAINT field_ambiguity_shape CHECK (
        (basis = 'PATRON_AMBIGUO' AND suggested_value IS NULL)
        OR (basis <> 'PATRON_AMBIGUO' AND suggested_value IS NOT NULL AND source_excerpt IS NOT NULL)),
      CONSTRAINT field_confidence_pairing CHECK (
        (basis = 'ETIQUETA_EXPLICITA' AND confidence = 'ALTA')
        OR (basis = 'PATRON_UNICO' AND confidence = 'MEDIA')
        OR (basis = 'PATRON_AMBIGUO' AND confidence = 'BAJA'))
    )`.execute(db);
  await sql`CREATE INDEX document_extraction_fields_run_idx ON document_extraction_fields (extraction_id)`.execute(db);

  await sql`
    CREATE TABLE document_extraction_decisions (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL REFERENCES organizations(id),
      field_id uuid NOT NULL REFERENCES document_extraction_fields(id),
      decision text NOT NULL CHECK (decision IN ('CONFIRMADO', 'DESCARTADO')),
      -- Lo que la persona da por bueno. Puede diferir de lo sugerido: corregir a mano es legítimo.
      confirmed_value text,
      reason text,
      decided_by uuid NOT NULL REFERENCES users(id),
      decided_at timestamptz NOT NULL DEFAULT now(),
      operation_id uuid NOT NULL,
      CONSTRAINT decision_operation_unique UNIQUE (organization_id, operation_id),
      -- Una decisión por campo: rectificar exige una extracción nueva, no pisar la anterior.
      CONSTRAINT decision_once_per_field UNIQUE (field_id),
      CONSTRAINT decision_shape CHECK (
        (decision = 'CONFIRMADO' AND confirmed_value IS NOT NULL AND length(btrim(confirmed_value)) > 0)
        OR (decision = 'DESCARTADO' AND confirmed_value IS NULL
            AND reason IS NOT NULL AND length(btrim(reason)) > 0))
    )`.execute(db);

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
