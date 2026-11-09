import { Kysely, sql } from 'kysely';
import { PiiCipher, normalizeDocumentNumber, parsePiiConfig, producerAad, versionAad } from '../../crypto/pii';

// P0-004 (brecha): doc 06 exige «identidad cifrada/restringida». Documento, teléfono y dirección pasan a
// columnas cifradas (AES-256-GCM, ver crypto/pii.ts) y se elimina el texto plano, también de las
// instantáneas del historial. El número de documento tiene además un índice ciego para búsqueda exacta.
// Si existen datos de identidad en texto plano y no hay claves PII configuradas, la migración se detiene
// sin cambios (no se cifra con una clave inventada ni se descartan datos).
const FIELDS = ['document_type', 'document_number', 'phone', 'address'] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const f of FIELDS) await sql`ALTER TABLE producers ADD COLUMN ${sql.ref(`${f}_enc`)} text`.execute(db);
  await sql`ALTER TABLE producers ADD COLUMN document_number_bidx char(64)`.execute(db);

  const rows = await sql<Record<string, string | null> & { id: string; organization_id: string }>`
    SELECT id, organization_id, document_type, document_number, phone, address FROM producers
    WHERE document_type IS NOT NULL OR document_number IS NOT NULL OR phone IS NOT NULL OR address IS NOT NULL`.execute(db);
  const versions = await sql<{ id: string; organization_id: string; producer_id: string; version: string; snapshot: Record<string, unknown> }>`
    SELECT id, organization_id, producer_id, version, snapshot FROM producer_versions`.execute(db);
  const versionsWithPii = versions.rows.filter((v) => FIELDS.some((f) => v.snapshot[f] != null));

  const cfg = parsePiiConfig(process.env);
  if ((rows.rows.length || versionsWithPii.length) && !cfg) {
    throw new Error('Hay datos de identidad de productores en texto plano: definir PII_KEYS, PII_ACTIVE_KEY_ID y PII_INDEX_KEY antes de migrar.');
  }
  const cipher = cfg ? new PiiCipher(cfg) : null;

  for (const r of rows.rows) {
    const enc = Object.fromEntries(FIELDS.map((f) => [`${f}_enc`, cipher!.encryptNullable(r[f], producerAad(r.organization_id, r.id, f))]));
    const bidx = r.document_number ? cipher!.blindIndex(r.organization_id, 'DOC', normalizeDocumentNumber(r.document_number)) : null;
    await sql`UPDATE producers SET document_type_enc = ${enc.document_type_enc}, document_number_enc = ${enc.document_number_enc},
      phone_enc = ${enc.phone_enc}, address_enc = ${enc.address_enc}, document_number_bidx = ${bidx} WHERE id = ${r.id}`.execute(db);
  }

  // El historial es append-only; esta migración controlada es la única excepción para retirar texto plano.
  await sql`ALTER TABLE producer_versions DISABLE TRIGGER producer_versions_no_mutation`.execute(db);
  for (const v of versions.rows) {
    const snap: Record<string, unknown> = { ...v.snapshot };
    for (const f of FIELDS) {
      const plain = snap[f] as string | null | undefined;
      delete snap[f];
      snap[`${f}_enc`] = plain == null ? null : cipher!.encrypt(plain, versionAad(v.organization_id, v.producer_id, v.version, f));
    }
    await sql`UPDATE producer_versions SET snapshot = ${JSON.stringify(snap)}::jsonb WHERE id = ${v.id}`.execute(db);
  }
  await sql`ALTER TABLE producer_versions ENABLE TRIGGER producer_versions_no_mutation`.execute(db);

  await sql`ALTER TABLE producers DROP CONSTRAINT producers_document_pair`.execute(db);
  for (const f of FIELDS) await sql`ALTER TABLE producers DROP COLUMN ${sql.ref(f)}`.execute(db);
  await sql`ALTER TABLE producers ADD CONSTRAINT producers_document_pair CHECK ((document_type_enc IS NULL) = (document_number_enc IS NULL))`.execute(db);
  await sql`ALTER TABLE producers ADD CONSTRAINT producers_document_bidx_consistent CHECK ((document_number_enc IS NULL) = (document_number_bidx IS NULL))`.execute(db);
  await sql`CREATE INDEX producers_document_bidx_idx ON producers (organization_id, document_number_bidx) WHERE document_number_bidx IS NOT NULL`.execute(db);
}

export async function down(): Promise<void> {
  // No se reintroduce texto plano automáticamente: revertir exige un procedimiento manual autorizado.
  throw new Error('0006 no es reversible automáticamente (evita descifrar identidad en masa).');
}
