import { sql, type Kysely } from 'kysely';

// AJ-03 (ajuste mínimo de producto, 2026-10-23) — Tipos documentales para los aspectos AMBIENTAL, LABORAL y de DERECHOS DE TERCEROS.
//
// POR QUÉ HACE FALTA (comprobado antes de añadir nada)
// El catálogo de sistema tenía cuatro tipos: LAND_TENURE (tenencia), DELIVERY_SUPPORT (soporte de entrega), FIELD_EVIDENCE (foto, croquis o acta del
// RECORRIDO DE CAMPO, solo PDF) y FIELD_PHOTO. Ninguno describe un permiso ambiental, un soporte laboral ni un acuerdo con terceros: usar «evidencia del recorrido»
// o «tenencia» para ellos los etiquetaría mal y falsearía la clasificación. Por eso se añaden SOLO estos tres, y ninguna relación nueva: el titular (productor o
// parcela) y los vínculos (`document_links`) ya existen.
//
// QUÉ NO HACEN
//   · No son obligatorios: ningún requisito, compuerta, READY, despacho, LEGAL_PROFILE ni evaluación de riesgo los consulta. Un tipo solo CLASIFICA un archivo.
//   · No son evidencia aprobada ni acreditan autenticidad: siguen el mismo ciclo (recibido → análisis → revisión humana por versión, aparte).
//   · No cambian el acceso: el alcance es el del titular, y la clasificación de privacidad decide quién ve el CONTENIDO.
//
// CLASIFICACIÓN DE PRIVACIDAD
//   · ENVIRONMENTAL_SUPPORT → OPERATIONAL (permisos y gestiones ambientales de la actividad).
//   · LABOR_SUPPORT → PERSONAL_DATA (contratos o registros de personas trabajadoras).
//   · THIRD_PARTY_RIGHTS_SUPPORT → PERSONAL_DATA (acuerdos y actas con personas o comunidades).
//   Con PERSONAL_DATA el contenido solo lo ve quien tiene `producer:read_identity`; el resto ve los metadatos (el mismo tratamiento que LAND_TENURE).
//
// El catálogo es de solo lectura frente a UPDATE/DELETE y admite altas por migración.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO document_types (code, label, allowed_owner_types, classification, source) VALUES
      ('ENVIRONMENTAL_SUPPORT', 'Soporte ambiental', ARRAY['plot','producer'], 'OPERATIONAL',
        'AJ-03 (2026-10-23): aspecto ambiental; guía orientativa B02/B07, no un requisito uniforme'),
      ('LABOR_SUPPORT', 'Soporte laboral', ARRAY['plot','producer'], 'PERSONAL_DATA',
        'AJ-03 (2026-10-23): aspecto laboral/social; depende de la situación de trabajo (B09), no un requisito uniforme'),
      ('THIRD_PARTY_RIGHTS_SUPPORT', 'Soporte de derechos de terceros o comunidades', ARRAY['plot','producer'], 'PERSONAL_DATA',
        'AJ-03 (2026-10-23): acuerdos, comunicaciones o actas con terceros; guía orientativa B02/B07, no un requisito uniforme')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // El tipo no se retira si ya hay documentos de ese tipo (los documentos son inmutables en tipo y titular y no se borran).
  const usados = await sql<{ n: string }>`SELECT count(*) AS n FROM documents WHERE document_type IN ('ENVIRONMENTAL_SUPPORT','LABOR_SUPPORT','THIRD_PARTY_RIGHTS_SUPPORT')`.execute(db);
  if (Number(usados.rows[0].n) > 0) throw new Error('0066 no es reversible: hay documentos de estos tipos.');
  await sql`ALTER TABLE document_types DISABLE TRIGGER document_types_no_mutation`.execute(db);
  await sql`DELETE FROM document_types WHERE code IN ('ENVIRONMENTAL_SUPPORT','LABOR_SUPPORT','THIRD_PARTY_RIGHTS_SUPPORT')`.execute(db);
  await sql`ALTER TABLE document_types ENABLE TRIGGER document_types_no_mutation`.execute(db);
}
