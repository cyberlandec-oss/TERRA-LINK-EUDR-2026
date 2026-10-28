import type { SqlDb } from './ports';

// Esquema local por cuenta + organización (un archivo de base por par). Migraciones numeradas y transaccionales.
// Estados de operación (docs/11): PENDING → UPLOADING → SYNCED; FAILED; CONFLICT. P0-023 solo crea PENDING y recupera
// UPLOADING interrumpidas; la transferencia y la reconciliación son de P0-024.
const MIGRATIONS: string[] = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE dataset_plots (
     id TEXT PRIMARY KEY, plot_code TEXT NOT NULL, name TEXT, row_version INTEGER NOT NULL, status TEXT NOT NULL,
     producer_id TEXT NOT NULL, producer_code TEXT, producer_display_name TEXT, geometry_status TEXT, fetched_at TEXT NOT NULL);
   CREATE TABLE drafts (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('PLOT_FIELD_CAPTURE')), plot_id TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('DRAFT','QUEUED')),
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, queued_at TEXT);
   CREATE TABLE location_samples (
     id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id), latitude REAL NOT NULL, longitude REAL NOT NULL,
     accuracy_m REAL, acquired_at TEXT NOT NULL, recorded_at TEXT NOT NULL,
     source TEXT NOT NULL CHECK (source IN ('DEVICE_LOCATION_SERVICE')), provider_detail TEXT NOT NULL, mocked INTEGER);
   CREATE TABLE attachments (
     id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id), kind TEXT NOT NULL CHECK (kind IN ('PHOTO')),
     path TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK (size_bytes > 0), mime_type TEXT NOT NULL,
     captured_at TEXT, stored_at TEXT NOT NULL, upload_state TEXT NOT NULL DEFAULT 'LOCAL' CHECK (upload_state IN ('LOCAL')));
   CREATE TABLE outbox (
     operation_id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, draft_id TEXT NOT NULL REFERENCES drafts(id),
     operation_type TEXT NOT NULL, entity_id TEXT NOT NULL, base_version INTEGER, depends_on TEXT NOT NULL,
     captured_at TEXT NOT NULL, payload TEXT NOT NULL, attachment_refs TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('PENDING','UPLOADING','SYNCED','FAILED','CONFLICT')),
     attempts INTEGER NOT NULL DEFAULT 0, recovered_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL);
   CREATE TABLE incidents (id TEXT PRIMARY KEY, kind TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL);`,
  // 2 (revisión P0-023 + P0-024): las fotos se guardan como BLOB DENTRO de la base (protegidas por SQLCipher en el build
  // nativo); archivos externos solo para registros anteriores. Estados de subida separados del registro.
  `CREATE TABLE attachments_v2 (
     id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id), kind TEXT NOT NULL CHECK (kind IN ('PHOTO')),
     storage TEXT NOT NULL CHECK (storage IN ('DB','FILE')), path TEXT UNIQUE, content BLOB,
     sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK (size_bytes > 0), mime_type TEXT NOT NULL, captured_at TEXT, stored_at TEXT NOT NULL,
     upload_state TEXT NOT NULL DEFAULT 'LOCAL' CHECK (upload_state IN ('LOCAL','UPLOADED','REJECTED')), server_status TEXT, server_detail TEXT,
     CHECK ((storage = 'DB') = (content IS NOT NULL)), CHECK ((storage = 'FILE') = (path IS NOT NULL)));
   INSERT INTO attachments_v2 (id, draft_id, kind, storage, path, content, sha256, size_bytes, mime_type, captured_at, stored_at, upload_state)
     SELECT id, draft_id, kind, 'FILE', path, NULL, sha256, size_bytes, mime_type, captured_at, stored_at, upload_state FROM attachments;
   DROP TABLE attachments;
   ALTER TABLE attachments_v2 RENAME TO attachments;
   ALTER TABLE outbox ADD COLUMN server_result TEXT;
   ALTER TABLE outbox ADD COLUMN resolved_by TEXT;
   ALTER TABLE outbox ADD COLUMN resolves TEXT;
   ALTER TABLE outbox ADD COLUMN content_hash TEXT;`,
  // 3 (D): vértices de polígono capturados en el dispositivo. Tabla nueva (no toca lo guardado). Cada vértice conserva SU precisión y SU hora.
  `CREATE TABLE polygon_vertices (
     id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id), seq INTEGER NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
     accuracy_m REAL, acquired_at TEXT NOT NULL, recorded_at TEXT NOT NULL, provider_detail TEXT NOT NULL, mocked INTEGER,
     UNIQUE (draft_id, seq));`,
  // 4 (D): altas sin conexión. Cada productor o parcela creados en el teléfono tiene una referencia LOCAL estable (su id) que sus
  // dependientes citan hasta que el servidor la resuelve (`server_id`). La cola admite operaciones sin borrador de captura
  // (altas): `outbox.draft_id` pasa a ser opcional (se reconstruye la tabla; los datos se copian tal cual).
  `CREATE TABLE local_producers (
     id TEXT PRIMARY KEY, producer_code TEXT NOT NULL, first_name TEXT, last_name TEXT, legal_name TEXT, community TEXT, province TEXT, canton TEXT, parish TEXT,
     status TEXT NOT NULL CHECK (status IN ('DRAFT','QUEUED')), server_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, queued_at TEXT);
   CREATE TABLE local_plots (
     id TEXT PRIMARY KEY, producer_kind TEXT NOT NULL CHECK (producer_kind IN ('SERVER','LOCAL')), producer_ref TEXT NOT NULL,
     plot_code TEXT NOT NULL, crop TEXT NOT NULL, name TEXT, variety TEXT, land_use TEXT, province TEXT, canton TEXT, parish TEXT,
     status TEXT NOT NULL CHECK (status IN ('DRAFT','QUEUED')), server_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, queued_at TEXT);
   CREATE TABLE outbox_v4 (
     operation_id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, draft_id TEXT REFERENCES drafts(id),
     operation_type TEXT NOT NULL, entity_id TEXT NOT NULL, base_version INTEGER, depends_on TEXT NOT NULL,
     captured_at TEXT NOT NULL, payload TEXT NOT NULL, attachment_refs TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('PENDING','UPLOADING','SYNCED','FAILED','CONFLICT')),
     attempts INTEGER NOT NULL DEFAULT 0, recovered_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL,
     server_result TEXT, resolved_by TEXT, resolves TEXT, content_hash TEXT);
   INSERT INTO outbox_v4 (operation_id, seq, draft_id, operation_type, entity_id, base_version, depends_on, captured_at, payload, attachment_refs, state, attempts, recovered_count, last_error, created_at, server_result, resolved_by, resolves, content_hash)
     SELECT operation_id, seq, draft_id, operation_type, entity_id, base_version, depends_on, captured_at, payload, attachment_refs, state, attempts, recovered_count, last_error, created_at, server_result, resolved_by, resolves, content_hash FROM outbox;
   DROP TABLE outbox;
   ALTER TABLE outbox_v4 RENAME TO outbox;`,
  // 5 (D): entregas declaradas sin conexión y datos de referencia (catálogo de productos y centros que baja con la sincronización).
  `CREATE TABLE dataset_products (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, product_state TEXT, unit TEXT, status TEXT);
   CREATE TABLE dataset_locations (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, location_type TEXT);
   CREATE TABLE local_deliveries (
     id TEXT PRIMARY KEY, producer_kind TEXT NOT NULL CHECK (producer_kind IN ('SERVER','LOCAL')), producer_ref TEXT NOT NULL,
     product_id TEXT NOT NULL, location_id TEXT NOT NULL, delivery_date TEXT NOT NULL, quantity_declared TEXT NOT NULL, unit TEXT NOT NULL CHECK (unit IN ('KG')),
     origins TEXT NOT NULL, notes TEXT, register_requested INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL CHECK (status IN ('DRAFT','QUEUED')), server_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, queued_at TEXT);`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrate(db: SqlDb): Promise<void> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = await db.get<{ version: number }>('SELECT version FROM schema_version');
  const current = row?.version ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    await db.transaction(async (tx) => {
      await tx.exec(MIGRATIONS[i]);
      await tx.run('DELETE FROM schema_version');
      await tx.run('INSERT INTO schema_version (version) VALUES (?)', [i + 1]);
    });
  }
}
