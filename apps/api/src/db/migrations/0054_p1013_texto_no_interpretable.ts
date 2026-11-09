import { sql, type Kysely } from 'kysely';

// P1-013 (corrección) — Un estado más: `TEXTO_NO_INTERPRETABLE`.
//
// POR QUÉ
// Una comprobación dirigida con un PDF generado por una **herramienta independiente** (el motor de impresión
// de Chromium) destapó que el motor:
//   · devolvía **basura binaria** y la publicaba como texto del documento, con estado `EXTRAIDA`;
//   · y, cuando no lograba nada, lo clasificaba como `SIN_TEXTO`, **confundiendo «no hay capa de texto» con
//     «no supe interpretarla»**.
//
// Son cosas distintas y el producto tiene que distinguirlas:
//   · `SIN_TEXTO` → el archivo **no tiene** capa de texto (un escaneo);
//   · `TEXTO_NO_INTERPRETABLE` → **sí la tiene**, pero este motor no la entiende —típicamente fuentes
//     subconjuntadas que escriben índices de glifo y exigirían el mapa «ToUnicode»—.
//
// En el segundo caso **no se guarda texto ni se sugiere nada**: una interpretación incorrecta es peor que no
// leer nada. El CHECK `extraction_text_shape` ya impide guardar texto si el estado no es `EXTRAIDA`.
//
// La tabla es append-only, así que las filas anteriores **no se tocan**: solo se amplía el conjunto de estados
// admitidos de aquí en adelante.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE document_extractions DROP CONSTRAINT document_extractions_status_check`.execute(db);
  await sql`
    ALTER TABLE document_extractions ADD CONSTRAINT document_extractions_status_check
      CHECK (status IN ('EXTRAIDA', 'SIN_TEXTO', 'TEXTO_NO_INTERPRETABLE', 'FORMATO_NO_SOPORTADO', 'FALLIDA'))`
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE document_extractions DROP CONSTRAINT document_extractions_status_check`.execute(db);
  await sql`
    ALTER TABLE document_extractions ADD CONSTRAINT document_extractions_status_check
      CHECK (status IN ('EXTRAIDA', 'SIN_TEXTO', 'FORMATO_NO_SOPORTADO', 'FALLIDA'))`.execute(db);
}
