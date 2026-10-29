import { operationCanonical } from './canonical';
import type { MapArea } from './mapa';
import { stripImageMetadata } from './metadata';
import { migrate } from './schema';
import { CaptureBlockedError, type CaptureGate } from './session';
import { EncryptionRequiredError, StorageFullError, isStorageFull, type Platform, type SqlDb } from './ports';

// Almacén local de UNA cuenta + organización (P0-023/P0-024). Garantías probadas en src/core/__tests__:
// - borrador y operaciones de cola se escriben en UNA transacción (o todo o nada); operation_id estable y hash del
//   contenido calculado al encolar; dependencias explícitas;
// - fotos leídas de la caché temporal de la cámara y guardadas como BLOB dentro de la base (cifrada con SQLCipher en el
//   build nativo); la copia temporal de la cámara se borra después (mejor esfuerzo);
// - muestras de ubicación con hora de adquisición del proveedor, precisión informada o NULL y procedencia real
//   («servicio de ubicación del dispositivo»: no se atribuye GPS);
// - toda escritura de captura pasa por la puerta de sesión: vencida la sesión, se bloquea sin borrar nada;
// - en el build nativo de aceptación, si la base no quedó cifrada, el almacén no se abre (no hay escritura en claro);
// - recuperación al abrir: UPLOADING → PENDING conservando la identidad; la cola solo se retira con resultado confirmado.

export interface LocationSampleInput {
  latitude: number; longitude: number; accuracy_m: number | null; acquired_at: string;
  provider_detail: string; mocked: boolean | null;
}
export interface DatasetPlot { id: string; plot_code: string; name: string | null; row_version: number; status: string; producer_id: string; producer_code: string | null; producer_display_name: string | null; geometry_status: string | null }
export interface OutboxOp {
  operation_id: string; seq: number; draft_id: string | null; operation_type: string; entity_id: string; base_version: number | null; depends_on: string[];
  captured_at: string; payload: Record<string, unknown>; attachment_refs: string[]; state: string; attempts: number; recovered_count: number;
  last_error: string | null; server_result: Record<string, unknown> | null; content_hash: string; resolved_by: string | null; resolves: string | null;
}
export interface DraftView {
  id: string; plot_id: string; plot_code: string | null; note: string; status: 'DRAFT' | 'QUEUED'; created_at: string; updated_at: string; queued_at: string | null;
  location: (LocationSampleInput & { id: string; recorded_at: string; source: string }) | null;
  /** Soportes documentales (PDF o imagen) aportados sobre la parcela de la captura; su estado (registro, archivo, análisis) es independiente y NO equivale a revisión ni aprobación. */
  supports: SupportView[];
  photos: Array<{ id: string; storage: string; sha256: string; size_bytes: number; captured_at: string | null; stored_at: string; upload_state: string; server_status: string | null; server_detail: string | null; file_present: boolean }>;
  /** Vértices de polígono en orden de captura (solo borrador: confirmar el polígono es una decisión humana en la web). */
  vertices: Array<LocationSampleInput & { id: string; seq: number; recorded_at: string }>;
  operations: OutboxOp[];
}
export const LOCAL_CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
export interface LocalProducerInput { producer_code: string; first_name?: string | null; last_name?: string | null; legal_name?: string | null; community?: string | null; province?: string | null; canton?: string | null; parish?: string | null }
export interface LocalPlotInput { producer: { kind: 'SERVER' | 'LOCAL'; id: string }; plot_code: string; crop: string; name?: string | null; variety?: string | null; land_use?: string | null; province?: string | null; canton?: string | null; parish?: string | null }
/** Estado de un alta local según su última operación: el registro aceptado, rechazado, o aún sin enviar. */
export type LocalState = 'DRAFT' | 'PENDING' | 'SYNCED' | 'REJECTED' | 'CONFLICT';
export interface LocalProducerView extends LocalProducerInput { id: string; status: 'DRAFT' | 'QUEUED'; server_id: string | null; state: LocalState; last_error: string | null; operation_id: string | null }
export interface LocalPlotView extends LocalPlotInput { id: string; status: 'DRAFT' | 'QUEUED'; server_id: string | null; state: LocalState; last_error: string | null; operation_id: string | null }
export interface ReferenceProducer { id: string; producer_code: string; display_name: string | null }
export interface ReferenceDocumentType { code: string; label: string; allowed_owner_types: string[] }
export const MAX_SUPPORT_BYTES = 10 * 1024 * 1024;
export interface SupportView { id: string; document_type: string; title: string; mime_type: string; size_bytes: number; sha256: string; upload_state: string; server_status: string | null; server_detail: string | null }
export interface ReferenceData { document_types?: ReferenceDocumentType[]; producers?: ReferenceProducer[]; products: Array<{ id: string; code: string; name: string; product_state: string; unit: string; status: string }>; locations: Array<{ id: string; code: string; name: string; location_type: string }> }
export const DECIMAL_KG = /^\d{1,12}(\.\d{1,3})?$/;
export interface LocalDeliveryInput {
  producer: { kind: 'SERVER' | 'LOCAL'; id: string }; product_id: string; location_id: string; delivery_date: string; quantity_declared: string; unit: 'KG';
  origins: Array<{ kind: 'SERVER' | 'LOCAL'; id: string; quantity?: string | null }>; notes?: string | null; register?: boolean;
}
export interface LocalDeliveryView extends LocalDeliveryInput { id: string; status: 'DRAFT' | 'QUEUED'; server_id: string | null; state: LocalState; last_error: string | null; operation_id: string | null }
export interface RecoveryReport { recovered_operations: string[]; incomplete_temp_files: string[]; orphan_files: string[]; missing_files: string[] }
export type ServerOutcome = { operation_id: string; status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED' | 'CONFLICT' | 'DEPENDENCY_PENDING' | 'FORBIDDEN' | 'TRANSIENT_ERROR'; result?: Record<string, unknown> | null; error?: { code: string; message: string; details?: unknown } | null };

/** Tipo real por firma de bytes (como el servidor): PDF, JPEG o PNG; cualquier otra cosa es null. */
export function sniffSupportMime(b: Uint8Array): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  if (b.length >= 5 && String.fromCharCode(b[0], b[1], b[2], b[3], b[4]) === '%PDF-') return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return 'image/png';
  return null;
}
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MIN_FREE_BYTES = 5 * 1024 * 1024;

type Row = Record<string, unknown>;
const toOp = (o: Row): OutboxOp => ({
  ...(o as unknown as OutboxOp), depends_on: JSON.parse(o.depends_on as string) as string[], attachment_refs: JSON.parse(o.attachment_refs as string) as string[],
  payload: JSON.parse(o.payload as string) as Record<string, unknown>, server_result: o.server_result ? JSON.parse(o.server_result as string) as Record<string, unknown> : null,
});

export class LocalStore {
  private constructor(private readonly db: SqlDb, private readonly p: Platform, readonly key: string, private readonly guard: () => CaptureGate, readonly encrypted: boolean) {}

  static async open(p: Platform, key: string, guard: () => CaptureGate = () => ({ allowed: true, until: '', note: '' })): Promise<LocalStore> {
    const db = await p.openDb(`tl-${key}.db`);
    const cipher = await db.cipher();
    if (p.environment === 'NATIVE_BUILD' && cipher !== 'ACTIVE') { await db.close(); throw new EncryptionRequiredError(); }
    await migrate(db);
    const s = new LocalStore(db, p, key, guard, cipher === 'ACTIVE');
    await p.files.ensureDir(s.attachmentsDir());
    await p.files.ensureDir(s.tmpDir());
    return s;
  }

  attachmentsDir() { return `accounts/${this.key}/attachments`; }
  tmpDir() { return `accounts/${this.key}/incoming`; }
  async close() { await this.db.close(); }
  private now() { return this.p.now().toISOString(); }
  private writable() { const g = this.guard(); if (!g.allowed) throw new CaptureBlockedError(g); }

  // ---- Dataset autorizado (solo lo que devuelve el servidor para esta cuenta y organización) ----
  async replaceDataset(plots: DatasetPlot[]): Promise<void> {
    const at = this.now();
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM dataset_plots');
      for (const x of plots) await this.upsertPlot(tx, x, at);
      await tx.run("INSERT INTO meta (key, value) VALUES ('dataset_fetched_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [at]);
    });
  }
  private async upsertPlot(tx: SqlDb, x: DatasetPlot, at: string) {
    await tx.run(`INSERT INTO dataset_plots (id, plot_code, name, row_version, status, producer_id, producer_code, producer_display_name, geometry_status, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET plot_code = excluded.plot_code, name = excluded.name, row_version = excluded.row_version, status = excluded.status, producer_id = excluded.producer_id,
        producer_code = excluded.producer_code, producer_display_name = excluded.producer_display_name, geometry_status = excluded.geometry_status, fetched_at = excluded.fetched_at`,
      [x.id, x.plot_code, x.name, x.row_version, x.status, x.producer_id, x.producer_code, x.producer_display_name, x.geometry_status, at]);
  }
  /** Pull incremental: cambios y tombstones del servidor. Las operaciones pendientes NO se tocan. */
  async applyPull(changes: DatasetPlot[], tombstones: string[], cursor: string, full: boolean): Promise<void> {
    const at = this.now();
    await this.db.transaction(async (tx) => {
      if (full) await tx.run('DELETE FROM dataset_plots');
      for (const x of changes) await this.upsertPlot(tx, x, at);
      for (const id of tombstones) await tx.run('DELETE FROM dataset_plots WHERE id = ?', [id]);
      await tx.run("INSERT INTO meta (key, value) VALUES ('sync_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [cursor]);
      await tx.run("INSERT INTO meta (key, value) VALUES ('dataset_fetched_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [at]);
    });
  }
  async meta(key: string): Promise<string | null> { return (await this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]))?.value ?? null; }
  async setMeta(key: string, value: string | null) {
    if (value === null) await this.db.run('DELETE FROM meta WHERE key = ?', [key]);
    else await this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }
  async plots(): Promise<DatasetPlot[]> { return this.db.all<DatasetPlot>('SELECT id, plot_code, name, row_version, status, producer_id, producer_code, producer_display_name, geometry_status FROM dataset_plots ORDER BY plot_code'); }
  async datasetFetchedAt(): Promise<string | null> { return this.meta('dataset_fetched_at'); }

  // ---- Borradores (todas las escrituras pasan por la puerta de sesión) ----
  async createDraft(plotId: string): Promise<string> {
    this.writable();
    const plot = (await this.db.get<{ id: string }>('SELECT id FROM dataset_plots WHERE id = ?', [plotId])) ?? (await this.db.get<{ id: string }>('SELECT id FROM local_plots WHERE id = ?', [plotId]));
    if (!plot) throw new Error('La parcela no está en los datos descargados ni entre las altas locales de esta cuenta y organización.');
    const id = this.p.uuid(); const at = this.now();
    await this.db.run("INSERT INTO drafts (id, kind, plot_id, note, status, created_at, updated_at) VALUES (?, 'PLOT_FIELD_CAPTURE', ?, '', 'DRAFT', ?, ?)", [id, plotId, at, at]);
    return id;
  }

  private async editable(tx: SqlDb, draftId: string) {
    const d = await tx.get<{ status: string }>('SELECT status FROM drafts WHERE id = ?', [draftId]);
    if (!d) throw new Error('El borrador no existe en este dispositivo para esta cuenta.');
    if (d.status !== 'DRAFT') throw new Error('La captura ya está en cola: no se modifica (las operaciones encoladas son inmutables).');
  }

  async setNote(draftId: string, note: string): Promise<void> {
    this.writable();
    await this.db.transaction(async (tx) => {
      await this.editable(tx, draftId);
      await tx.run('UPDATE drafts SET note = ?, updated_at = ? WHERE id = ?', [note.slice(0, 160), this.now(), draftId]);
    });
  }

  async setLocation(draftId: string, s: LocationSampleInput): Promise<void> {
    this.writable();
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude) || Math.abs(s.latitude) > 90 || Math.abs(s.longitude) > 180) throw new Error('Coordenadas no válidas.');
    if (s.accuracy_m !== null && (!Number.isFinite(s.accuracy_m) || s.accuracy_m < 0)) throw new Error('Precisión no válida.');
    if (Number.isNaN(Date.parse(s.acquired_at))) throw new Error('Hora de adquisición no válida.');
    await this.db.transaction(async (tx) => {
      await this.editable(tx, draftId);
      await tx.run('DELETE FROM location_samples WHERE draft_id = ?', [draftId]);
      await tx.run("INSERT INTO location_samples (id, draft_id, latitude, longitude, accuracy_m, acquired_at, recorded_at, source, provider_detail, mocked) VALUES (?,?,?,?,?,?,?, 'DEVICE_LOCATION_SERVICE', ?, ?)",
        [this.p.uuid(), draftId, s.latitude, s.longitude, s.accuracy_m, s.acquired_at, this.now(), s.provider_detail, s.mocked === null ? null : s.mocked ? 1 : 0]);
      await tx.run('UPDATE drafts SET updated_at = ? WHERE id = ?', [this.now(), draftId]);
    });
  }

  /** Añade un vértice al final. Cada vértice es una lectura del dispositivo con SU precisión y SU hora; nada se completa ni se corrige. */
  async addVertex(draftId: string, s: LocationSampleInput): Promise<number> {
    this.writable();
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude) || Math.abs(s.latitude) > 90 || Math.abs(s.longitude) > 180) throw new Error('Coordenadas no válidas.');
    if (s.accuracy_m !== null && (!Number.isFinite(s.accuracy_m) || s.accuracy_m < 0)) throw new Error('Precisión no válida.');
    if (Number.isNaN(Date.parse(s.acquired_at))) throw new Error('Hora de adquisición no válida.');
    return this.db.transaction(async (tx) => {
      await this.editable(tx, draftId);
      const seq = ((await tx.get<{ n: number | null }>('SELECT max(seq) AS n FROM polygon_vertices WHERE draft_id = ?', [draftId]))?.n ?? 0) + 1;
      await tx.run('INSERT INTO polygon_vertices (id, draft_id, seq, latitude, longitude, accuracy_m, acquired_at, recorded_at, provider_detail, mocked) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [this.p.uuid(), draftId, seq, s.latitude, s.longitude, s.accuracy_m, s.acquired_at, this.now(), s.provider_detail, s.mocked === null ? null : s.mocked ? 1 : 0]);
      await tx.run('UPDATE drafts SET updated_at = ? WHERE id = ?', [this.now(), draftId]);
      return seq;
    });
  }

  /** Quita el último vértice (solo mientras sea borrador local; lo ya encolado es inmutable). */
  async undoVertex(draftId: string): Promise<void> {
    this.writable();
    await this.db.transaction(async (tx) => {
      await this.editable(tx, draftId);
      await tx.run('DELETE FROM polygon_vertices WHERE draft_id = ? AND seq = (SELECT max(seq) FROM polygon_vertices WHERE draft_id = ?)', [draftId, draftId]);
      await tx.run('UPDATE drafts SET updated_at = ? WHERE id = ?', [this.now(), draftId]);
    });
  }

  /**
   * Foto: se leen los bytes de la caché temporal de la cámara, se eliminan sus metadatos embebidos (D-41), se calculan
   * tamaño y SHA-256 y se guardan como BLOB en la base en una transacción (o todo o nada). Después se borra la copia de la cámara (mejor esfuerzo).
   */
  async addPhoto(draftId: string, sourceUri: string, mimeType: string, capturedAt: string | null): Promise<string> {
    this.writable();
    await this.db.transaction((tx) => this.editable(tx, draftId));
    const free = await this.p.files.freeBytes();
    if (free !== null && free < MIN_FREE_BYTES) throw new StorageFullError('Queda menos de 5 MB libres: libera espacio antes de adjuntar la foto. El borrador se conserva.');
    const id = this.p.uuid();
    try {
      const raw = await this.p.files.readExternal(sourceUri);
      if (raw.length <= 0) throw new Error('La foto está vacía: escritura incompleta de la cámara.');
      // D-41: sin EXIF/XMP/IPTC/comentarios (coordenadas, dispositivo, hora). La ubicación va aparte con su procedencia.
      const bytes = stripImageMetadata(raw, mimeType);
      if (bytes.length > MAX_PHOTO_BYTES) throw new Error('La foto supera 15 MB.');
      const hash = await this.p.sha256(bytes);
      await this.db.transaction(async (tx) => {
        await this.editable(tx, draftId);
        await tx.run("INSERT INTO attachments (id, draft_id, kind, storage, path, content, sha256, size_bytes, mime_type, captured_at, stored_at) VALUES (?,?, 'PHOTO', 'DB', NULL, ?,?,?,?,?,?)",
          [id, draftId, bytes, hash, bytes.length, mimeType, capturedAt, this.now()]);
        await tx.run('UPDATE drafts SET updated_at = ? WHERE id = ?', [this.now(), draftId]);
      });
      await this.p.files.deleteExternal(sourceUri).catch(() => undefined);
      return id;
    } catch (err) {
      if (isStorageFull(err)) throw new StorageFullError('No hay espacio para guardar la foto. El borrador y las capturas anteriores se conservan.');
      throw err;
    }
  }

  /**
   * Soporte documental (PDF, JPEG o PNG) sobre la parcela de la captura. Reutiliza Documentos: el tipo sale del catálogo descargado, el archivo se valida por su
   * FIRMA de bytes (no por la extensión), las imágenes pierden sus metadatos, se calcula su SHA-256 y viaja aparte (estado de subida y de análisis separados).
   * Aportar un soporte NO lo revisa ni lo aprueba, y no crea tipos nuevos.
   */
  async addSupport(draftId: string, sourceUri: string, declaredMime: string, input: { document_type: string; title: string }): Promise<string> {
    this.writable();
    await this.db.transaction((tx) => this.editable(tx, draftId));
    const tipo = (await this.supportTypes()).find((t) => t.code === input.document_type);
    if (!tipo) throw new Error('Ese tipo de soporte no está entre los que tu rol puede aportar para una parcela. Sincroniza para actualizar la lista.');
    const title = (input.title ?? '').trim();
    if (!title || title.length > 160) throw new Error('Indica un título para el soporte (hasta 160 caracteres).');
    const free = await this.p.files.freeBytes();
    if (free !== null && free < MIN_FREE_BYTES) throw new StorageFullError('Queda menos de 5 MB libres: libera espacio antes de adjuntar el soporte. El borrador se conserva.');
    const id = this.p.uuid();
    try {
      const raw = await this.p.files.readExternal(sourceUri);
      if (raw.length <= 0) throw new Error('El archivo está vacío.');
      const real = sniffSupportMime(raw);
      if (!real) throw new Error('Solo se admiten PDF, JPEG o PNG (se comprueba por el contenido del archivo, no por su nombre).');
      if (declaredMime && declaredMime !== real && !(declaredMime === 'image/jpg' && real === 'image/jpeg')) throw new Error('El contenido del archivo no coincide con su tipo declarado (' + declaredMime + '): se rechaza.');
      if (real !== 'application/pdf' && input.document_type === 'FIELD_EVIDENCE') throw new Error('Las evidencias del recorrido son PDF. Una fotografía se aporta como foto de campo.');
      const bytes = real === 'application/pdf' ? raw : stripImageMetadata(raw, real);
      if (bytes.length > MAX_SUPPORT_BYTES) throw new Error('El archivo supera 10 MB.');
      const hash = await this.p.sha256(bytes);
      await this.db.transaction(async (tx) => {
        await this.editable(tx, draftId);
        await tx.run("INSERT INTO attachments (id, draft_id, kind, storage, path, content, sha256, size_bytes, mime_type, captured_at, stored_at, doc_type, title) VALUES (?,?, 'SUPPORT', 'DB', NULL, ?,?,?,?,?,?,?,?)",
          [id, draftId, bytes, hash, bytes.length, real, this.now(), this.now(), input.document_type, title]);
        await tx.run('UPDATE drafts SET updated_at = ? WHERE id = ?', [this.now(), draftId]);
      });
      await this.p.files.deleteExternal(sourceUri).catch(() => undefined);
      return id;
    } catch (err) {
      if (isStorageFull(err)) throw new StorageFullError('No hay espacio para guardar el soporte. El borrador y lo anterior se conservan.');
      throw err;
    }
  }
  /** Quita un soporte que aún no se puso en cola (el borrador sigue editable); lo ya encolado no se borra. */
  async removeSupport(draftId: string, attachmentId: string): Promise<void> {
    this.writable();
    await this.db.transaction(async (tx) => {
      await this.editable(tx, draftId);
      await tx.run("DELETE FROM attachments WHERE id = ? AND draft_id = ? AND kind = 'SUPPORT' AND upload_state = 'LOCAL'", [attachmentId, draftId]);
      await tx.run('UPDATE drafts SET updated_at = ? WHERE id = ?', [this.now(), draftId]);
    });
  }

  /**
   * Encolar: en UNA transacción el borrador pasa a QUEUED y se crean sus operaciones reales (operation_id estable y hash):
   * PLOT_LOCATION_SAMPLE_CREATE y PLOT_PHOTO_ATTACH (que depende de la muestra si la hay). La nota viaja como leyenda de
   * las fotos; una nota sin foto no tiene entidad en el servidor y no se encola.
   */
  async enqueue(draftId: string): Promise<string[]> {
    this.writable();
    return this.db.transaction(async (tx) => {
      await this.editable(tx, draftId);
      const d = (await tx.get<{ plot_id: string; note: string; created_at: string }>('SELECT plot_id, note, created_at FROM drafts WHERE id = ?', [draftId]))!;
      let plot = await tx.get<{ row_version: number; plot_code: string }>('SELECT row_version, plot_code FROM dataset_plots WHERE id = ?', [d.plot_id]);
      // Parcela creada en el teléfono: las operaciones citan su referencia LOCAL (plot_local_ref) y dependen de su alta; el servidor la resuelve.
      const localPlot = plot ? undefined : await tx.get<{ id: string; plot_code: string; status: string; server_id: string | null }>('SELECT id, plot_code, status, server_id FROM local_plots WHERE id = ?', [d.plot_id]);
      let createOp: string | null = null;
      if (localPlot) {
        if (localPlot.status !== 'QUEUED') throw new Error('Primero pon en cola el alta de la parcela nueva: las capturas sobre ella dependen de esa alta.');
        createOp = (await tx.get<{ operation_id: string }>("SELECT operation_id FROM outbox WHERE entity_id = ? AND operation_type = 'PLOT_CREATE' AND resolved_by IS NULL ORDER BY seq DESC LIMIT 1", [localPlot.id]))?.operation_id ?? null;
        plot = { row_version: null as unknown as number, plot_code: localPlot.plot_code };
      }
      const plotRef = (): Record<string, unknown> => (localPlot ? { plot_local_ref: localPlot.id } : { plot_id: d.plot_id });
      const loc = await tx.get<{ id: string; latitude: number; longitude: number; accuracy_m: number | null; acquired_at: string; provider_detail: string; mocked: number | null }>('SELECT * FROM location_samples WHERE draft_id = ?', [draftId]);
      const photos = await tx.all<{ id: string; sha256: string; size_bytes: number; mime_type: string; captured_at: string | null }>("SELECT id, sha256, size_bytes, mime_type, captured_at FROM attachments WHERE draft_id = ? AND kind = 'PHOTO' ORDER BY stored_at, id", [draftId]);
      const supports = await tx.all<{ id: string; sha256: string; size_bytes: number; mime_type: string; doc_type: string; title: string; stored_at: string }>("SELECT id, sha256, size_bytes, mime_type, doc_type, title, stored_at FROM attachments WHERE draft_id = ? AND kind = 'SUPPORT' ORDER BY stored_at, id", [draftId]);
      const verts = await tx.all<{ id: string; seq: number; latitude: number; longitude: number; accuracy_m: number | null; acquired_at: string; provider_detail: string; mocked: number | null }>('SELECT * FROM polygon_vertices WHERE draft_id = ? ORDER BY seq', [draftId]);
      if (!loc && !photos.length && !verts.length && !supports.length) throw new Error(d.note.trim() ? 'Una nota sin ubicación, vértices, foto ni soporte no tiene entidad en el servidor: agrega ubicación, vértices, foto o un soporte.' : 'La captura está vacía: agrega ubicación, vértices, foto o un soporte.');
      const at = this.now();
      let seq = ((await tx.get<{ n: number | null }>('SELECT max(seq) AS n FROM outbox'))?.n ?? 0);
      const ops: string[] = [];
      const add = async (type: string, entity: string, baseVersion: number | null, payload: Record<string, unknown>, deps: string[], refs: string[], capturedAt: string) => {
        const op = this.p.uuid();
        seq += 1; // (la foto, el punto y los vértices de una parcela local dependen del alta de esa parcela, directa o encadenadamente)
        const hash = await this.p.sha256(new TextEncoder().encode(operationCanonical({ operation_type: type, entity_id: entity, base_version: baseVersion, depends_on: deps, captured_at: capturedAt, payload })));
        await tx.run("INSERT INTO outbox (operation_id, seq, draft_id, operation_type, entity_id, base_version, depends_on, captured_at, payload, attachment_refs, state, created_at, content_hash) VALUES (?,?,?,?,?,?,?,?,?,?, 'PENDING', ?, ?)",
          [op, seq, draftId, type, entity, baseVersion, JSON.stringify(deps), capturedAt, JSON.stringify(payload), JSON.stringify(refs), at, hash]);
        ops.push(op);
        return op;
      };
      const locOp = loc ? await add('PLOT_LOCATION_SAMPLE_CREATE', loc.id, plot?.row_version ?? null, { ...plotRef(), latitude: loc.latitude, longitude: loc.longitude, accuracy_m: loc.accuracy_m, acquired_at: loc.acquired_at,
        source: 'DEVICE_LOCATION_SERVICE', provider_detail: loc.provider_detail, mocked: loc.mocked === null ? null : loc.mocked === 1 }, createOp ? [createOp] : [], [], loc.acquired_at) : null;
      // Vértices: una operación por vértice, encadenadas en el orden de captura (el servidor los recibe en ese orden). Nunca confirma el polígono.
      // `capture_id` (este borrador local) identifica el borrador de destino en el servidor; el primer vértice lleva la versión de la parcela que el teléfono conocía.
      let prev: string | null = locOp ?? createOp;
      for (const v of verts) {
        prev = await add('PLOT_POLYGON_VERTEX_ADD', v.id, v.seq === 1 ? (plot?.row_version ?? null) : null, { ...plotRef(), capture_id: draftId, vertex_seq: v.seq, latitude: v.latitude, longitude: v.longitude, accuracy_m: v.accuracy_m, acquired_at: v.acquired_at,
          source: 'DEVICE_LOCATION_SERVICE', provider_detail: v.provider_detail, mocked: v.mocked === null ? null : v.mocked === 1 }, prev ? [prev] : [], [], v.acquired_at);
      }
      for (const ph of photos) {
        await add('PLOT_PHOTO_ATTACH', ph.id, null, { ...plotRef(), sha256: ph.sha256, size_bytes: ph.size_bytes, mime_type: ph.mime_type,
          caption: (d.note.trim() || `Foto de campo ${plot?.plot_code ?? ''}`).slice(0, 160) }, prev ? [prev] : [], [ph.id], ph.captured_at ?? at);
      }
      for (const sp of supports) {
        await add('DOCUMENT_ATTACH', sp.id, null, { owner_type: 'plot', ...plotRef(), document_type: sp.doc_type, title: sp.title, sha256: sp.sha256, size_bytes: sp.size_bytes, mime_type: sp.mime_type }, prev ? [prev] : [], [sp.id], sp.stored_at);
      }
      await tx.run("UPDATE drafts SET status = 'QUEUED', queued_at = ?, updated_at = ? WHERE id = ?", [at, at, draftId]);
      return ops;
    });
  }

  // ---- Altas sin conexión: productores y parcelas nuevas (D) ----
  // La referencia LOCAL es el id del registro (UUID del dispositivo). Se guarda junto con su operación, así que sobrevive a cierres,
  // respuestas perdidas y reintentos. Nunca se resuelve por nombre ni por proximidad: solo por esta referencia y, en el servidor,
  // por la correspondencia de la misma cuenta y organización.
  private cleanFields<T extends Record<string, unknown>>(x: T, keys: string[]): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const k of keys) { const v = x[k]; out[k] = typeof v === 'string' && v.trim() ? v.trim() : null; }
    return out;
  }

  async createLocalProducer(input: LocalProducerInput): Promise<string> {
    this.writable();
    const f = this.cleanFields(input as unknown as Record<string, unknown>, ['first_name', 'last_name', 'legal_name', 'community', 'province', 'canton', 'parish']);
    const code = (input.producer_code ?? '').trim();
    if (!LOCAL_CODE.test(code)) throw new Error('Código de productor: 1–40 caracteres (letras, números, . _ -).');
    if (!f.legal_name && !(f.first_name && f.last_name)) throw new Error('Indica nombre y apellido, o la razón social.');
    const id = this.p.uuid(); const at = this.now();
    await this.db.run('INSERT INTO local_producers (id, producer_code, first_name, last_name, legal_name, community, province, canton, parish, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, code, f.first_name, f.last_name, f.legal_name, f.community, f.province, f.canton, f.parish, 'DRAFT', at, at]);
    return id;
  }

  async createLocalPlot(input: LocalPlotInput): Promise<string> {
    this.writable();
    const f = this.cleanFields(input as unknown as Record<string, unknown>, ['name', 'variety', 'land_use', 'province', 'canton', 'parish']);
    const code = (input.plot_code ?? '').trim(); const crop = (input.crop ?? '').trim();
    if (!LOCAL_CODE.test(code)) throw new Error('Código de parcela: 1–40 caracteres (letras, números, . _ -).');
    if (!crop || crop.length > 60) throw new Error('Indica el cultivo (hasta 60 caracteres).');
    if (input.producer.kind === 'SERVER') {
      if (!(await this.knownServerProducer(input.producer.id))) throw new Error('Ese productor no está entre los datos descargados de esta cuenta: no se puede referenciar.');
    } else if (!(await this.db.get('SELECT 1 AS x FROM local_producers WHERE id = ?', [input.producer.id]))) throw new Error('Ese productor no existe entre las altas locales de esta cuenta.');
    const id = this.p.uuid(); const at = this.now();
    await this.db.run('INSERT INTO local_plots (id, producer_kind, producer_ref, plot_code, crop, name, variety, land_use, province, canton, parish, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, input.producer.kind, input.producer.id, code, crop, f.name, f.variety, f.land_use, f.province, f.canton, f.parish, 'DRAFT', at, at]);
    return id;
  }

  private async addEntityOp(tx: SqlDb, type: 'PRODUCER_CREATE' | 'PLOT_CREATE' | 'DELIVERY_CREATE', entity: string, payload: Record<string, unknown>, deps: string[]): Promise<string> {
    const at = this.now(); const op = this.p.uuid();
    const seq = ((await tx.get<{ n: number | null }>('SELECT max(seq) AS n FROM outbox'))?.n ?? 0) + 1;
    const hash = await this.p.sha256(new TextEncoder().encode(operationCanonical({ operation_type: type, entity_id: entity, base_version: null, depends_on: deps, captured_at: at, payload })));
    await tx.run("INSERT INTO outbox (operation_id, seq, draft_id, operation_type, entity_id, base_version, depends_on, captured_at, payload, attachment_refs, state, created_at, content_hash) VALUES (?,?,NULL,?,?,NULL,?,?,?,'[]','PENDING',?,?)",
      [op, seq, type, entity, JSON.stringify(deps), at, JSON.stringify(payload), at, hash]);
    return op;
  }

  /** Pone en cola el alta del productor. Antes de esto es un borrador local editable; después, la operación es inmutable. */
  async enqueueLocalProducer(id: string): Promise<string> {
    this.writable();
    return this.db.transaction(async (tx) => {
      const r = await tx.get<Record<string, string | null>>('SELECT * FROM local_producers WHERE id = ?', [id]);
      if (!r) throw new Error('El productor local no existe en este dispositivo para esta cuenta.');
      if (r.status !== 'DRAFT') throw new Error('El alta ya está en cola: no se modifica.');
      const payload: Record<string, unknown> = { producer_code: r.producer_code };
      for (const k of ['first_name', 'last_name', 'legal_name', 'community', 'province', 'canton', 'parish']) if (r[k]) payload[k] = r[k];
      const op = await this.addEntityOp(tx, 'PRODUCER_CREATE', id, payload, []);
      await tx.run("UPDATE local_producers SET status = 'QUEUED', queued_at = ?, updated_at = ? WHERE id = ?", [this.now(), this.now(), id]);
      return op;
    });
  }

  /** Pone en cola el alta de la parcela. Si su productor también es local, depende de la alta de ese productor. */
  async enqueueLocalPlot(id: string): Promise<string> {
    this.writable();
    return this.db.transaction(async (tx) => {
      const r = await tx.get<Record<string, string | null>>('SELECT * FROM local_plots WHERE id = ?', [id]);
      if (!r) throw new Error('La parcela local no existe en este dispositivo para esta cuenta.');
      if (r.status !== 'DRAFT') throw new Error('El alta ya está en cola: no se modifica.');
      const payload: Record<string, unknown> = { plot_code: r.plot_code, crop: r.crop };
      for (const k of ['name', 'variety', 'land_use', 'province', 'canton', 'parish']) if (r[k]) payload[k] = r[k];
      const deps: string[] = [];
      if (r.producer_kind === 'LOCAL') {
        const pr = await tx.get<{ status: string }>('SELECT status FROM local_producers WHERE id = ?', [r.producer_ref]);
        if (!pr || pr.status !== 'QUEUED') throw new Error('Primero pon en cola el alta del productor nuevo: la parcela depende de ella.');
        const pop = await tx.get<{ operation_id: string }>("SELECT operation_id FROM outbox WHERE entity_id = ? AND operation_type = 'PRODUCER_CREATE' AND resolved_by IS NULL ORDER BY seq DESC LIMIT 1", [r.producer_ref]);
        if (pop) deps.push(pop.operation_id);
        payload.producer_local_ref = r.producer_ref;
      } else payload.producer_id = r.producer_ref;
      const op = await this.addEntityOp(tx, 'PLOT_CREATE', id, payload, deps);
      await tx.run("UPDATE local_plots SET status = 'QUEUED', queued_at = ?, updated_at = ? WHERE id = ?", [this.now(), this.now(), id]);
      return op;
    });
  }

  private async localState(entity: string, type: string, status: string): Promise<{ state: LocalState; last_error: string | null; operation_id: string | null }> {
    if (status === 'DRAFT') return { state: 'DRAFT', last_error: null, operation_id: null };
    const o = await this.db.get<{ operation_id: string; state: string; last_error: string | null; resolved_by: string | null }>('SELECT operation_id, state, last_error, resolved_by FROM outbox WHERE entity_id = ? AND operation_type = ? ORDER BY seq DESC LIMIT 1', [entity, type]);
    if (!o) return { state: 'PENDING', last_error: null, operation_id: null };
    const state: LocalState = o.state === 'SYNCED' ? 'SYNCED' : o.state === 'FAILED' ? 'REJECTED' : o.state === 'CONFLICT' ? 'CONFLICT' : 'PENDING';
    return { state, last_error: o.last_error, operation_id: o.operation_id };
  }

  async localProducers(): Promise<LocalProducerView[]> {
    const rows = await this.db.all<Record<string, string | null>>('SELECT * FROM local_producers ORDER BY created_at DESC');
    const out: LocalProducerView[] = [];
    for (const r of rows) out.push({ id: r.id!, producer_code: r.producer_code!, first_name: r.first_name, last_name: r.last_name, legal_name: r.legal_name, community: r.community, province: r.province, canton: r.canton, parish: r.parish,
      status: r.status as 'DRAFT' | 'QUEUED', server_id: r.server_id, ...(await this.localState(r.id!, 'PRODUCER_CREATE', r.status!)) });
    return out;
  }

  async localPlots(): Promise<LocalPlotView[]> {
    const rows = await this.db.all<Record<string, string | null>>('SELECT * FROM local_plots ORDER BY created_at DESC');
    const out: LocalPlotView[] = [];
    for (const r of rows) out.push({ id: r.id!, producer: { kind: r.producer_kind as 'SERVER' | 'LOCAL', id: r.producer_ref! }, plot_code: r.plot_code!, crop: r.crop!, name: r.name, variety: r.variety, land_use: r.land_use, province: r.province, canton: r.canton, parish: r.parish,
      status: r.status as 'DRAFT' | 'QUEUED', server_id: r.server_id, ...(await this.localState(r.id!, 'PLOT_CREATE', r.status!)) });
    return out;
  }

  // ---- Datos de referencia (productos y centros) y entregas declaradas sin conexión ----
  async applyReference(ref: ReferenceData): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM dataset_products'); await tx.run('DELETE FROM dataset_locations'); await tx.run('DELETE FROM dataset_producers'); await tx.run('DELETE FROM dataset_document_types');
      for (const t of ref.document_types ?? []) await tx.run('INSERT INTO dataset_document_types (code, label, allowed_owner_types) VALUES (?,?,?)', [t.code, t.label, JSON.stringify(t.allowed_owner_types)]);
      for (const p of ref.producers ?? []) await tx.run('INSERT INTO dataset_producers (id, producer_code, display_name) VALUES (?,?,?)', [p.id, p.producer_code, p.display_name]);
      for (const p of ref.products) await tx.run('INSERT INTO dataset_products (id, code, name, product_state, unit, status) VALUES (?,?,?,?,?,?)', [p.id, p.code, p.name, p.product_state, p.unit, p.status]);
      for (const l of ref.locations) await tx.run('INSERT INTO dataset_locations (id, code, name, location_type) VALUES (?,?,?,?)', [l.id, l.code, l.name, l.location_type]);
    });
  }
  /** Productores autorizados descargados (con o sin parcelas), más los conocidos por las parcelas descargadas. Solo por identificador. */
  async serverProducers(): Promise<ReferenceProducer[]> {
    return this.db.all("SELECT id, producer_code, display_name FROM dataset_producers UNION SELECT producer_id, coalesce(producer_code, 'Productor'), producer_display_name FROM dataset_plots WHERE producer_id NOT IN (SELECT id FROM dataset_producers) GROUP BY producer_id ORDER BY 2");
  }
  private async knownServerProducer(id: string): Promise<boolean> {
    return !!(await this.db.get('SELECT 1 AS x FROM dataset_producers WHERE id = ? UNION SELECT 1 FROM dataset_plots WHERE producer_id = ?', [id, id]));
  }
  /** Tipos documentales que el rol puede aportar desde el móvil para una parcela (de la referencia descargada; vacío si el rol no sube documentos). */
  async supportTypes(): Promise<ReferenceDocumentType[]> {
    const rows = await this.db.all<{ code: string; label: string; allowed_owner_types: string }>('SELECT code, label, allowed_owner_types FROM dataset_document_types ORDER BY code');
    return rows.map((r) => ({ code: r.code, label: r.label, allowed_owner_types: JSON.parse(r.allowed_owner_types) as string[] })).filter((t) => t.allowed_owner_types.includes('plot'));
  }
  async products(): Promise<ReferenceData['products']> { return this.db.all('SELECT id, code, name, product_state, unit, status FROM dataset_products ORDER BY code'); }
  async locations(): Promise<ReferenceData['locations']> { return this.db.all('SELECT id, code, name, location_type FROM dataset_locations ORDER BY name'); }

  /**
   * Declaración de entrega: borrador local con SU origen (parcelas por referencia: del servidor o locales). NO es recepción, pesaje ni
   * movimiento de inventario: esas transiciones son del servidor, con su autorización. Cantidad en texto decimal con unidad explícita.
   */
  async createLocalDelivery(input: LocalDeliveryInput): Promise<string> {
    this.writable();
    if (!DECIMAL_KG.test(input.quantity_declared) || Number(input.quantity_declared) <= 0) throw new Error('Cantidad declarada: un número positivo en KG (hasta 3 decimales).');
    if (input.unit !== 'KG') throw new Error('La unidad es KG.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.delivery_date) || Number.isNaN(Date.parse(input.delivery_date))) throw new Error('Fecha de entrega: AAAA-MM-DD.');
    if (input.delivery_date > this.now().slice(0, 10)) throw new Error('La fecha de entrega no puede estar en el futuro. Revisa el reloj del dispositivo.');
    if (!(await this.db.get('SELECT 1 AS x FROM dataset_products WHERE id = ?', [input.product_id]))) throw new Error('Elige un producto del catálogo descargado.');
    if (!(await this.db.get('SELECT 1 AS x FROM dataset_locations WHERE id = ?', [input.location_id]))) throw new Error('Elige un centro del catálogo descargado.');
    if (input.producer.kind === 'SERVER') {
      if (!(await this.knownServerProducer(input.producer.id))) throw new Error('Ese productor no está entre los datos descargados de esta cuenta.');
    } else if (!(await this.db.get('SELECT 1 AS x FROM local_producers WHERE id = ?', [input.producer.id]))) throw new Error('Ese productor no existe entre las altas locales de esta cuenta.');
    if (!input.origins.length) throw new Error('Indica al menos una parcela de origen.');
    for (const o of input.origins) {
      if (o.quantity && !DECIMAL_KG.test(o.quantity)) throw new Error('Cantidad por parcela: texto decimal en KG.');
      const ok = o.kind === 'SERVER' ? await this.db.get('SELECT 1 AS x FROM dataset_plots WHERE id = ?', [o.id]) : await this.db.get('SELECT 1 AS x FROM local_plots WHERE id = ?', [o.id]);
      if (!ok) throw new Error('Una parcela de origen no existe entre los datos de esta cuenta.');
    }
    const id = this.p.uuid(); const at = this.now();
    await this.db.run('INSERT INTO local_deliveries (id, producer_kind, producer_ref, product_id, location_id, delivery_date, quantity_declared, unit, origins, notes, register_requested, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, input.producer.kind, input.producer.id, input.product_id, input.location_id, input.delivery_date, input.quantity_declared, input.unit, JSON.stringify(input.origins), input.notes?.trim() || null, input.register ? 1 : 0, 'DRAFT', at, at]);
    return id;
  }

  /** Pone en cola la declaración. Depende del alta de su productor y de las de sus parcelas cuando son locales. */
  async enqueueLocalDelivery(id: string): Promise<string> {
    this.writable();
    return this.db.transaction(async (tx) => {
      const r = await tx.get<Record<string, string | number | null>>('SELECT * FROM local_deliveries WHERE id = ?', [id]);
      if (!r) throw new Error('La entrega local no existe en este dispositivo para esta cuenta.');
      if (r.status !== 'DRAFT') throw new Error('La declaración ya está en cola: no se modifica.');
      const deps: string[] = [];
      const need = async (entity: string, type: string, what: string, table: string) => {
        const e = await tx.get<{ status: string }>(`SELECT status FROM ${table} WHERE id = ?`, [entity]);
        if (!e || e.status !== 'QUEUED') throw new Error(`Primero pon en cola el alta ${what}: la entrega depende de ella.`);
        const op = await tx.get<{ operation_id: string }>('SELECT operation_id FROM outbox WHERE entity_id = ? AND operation_type = ? AND resolved_by IS NULL ORDER BY seq DESC LIMIT 1', [entity, type]);
        if (op) deps.push(op.operation_id);
      };
      const payload: Record<string, unknown> = { product_id: r.product_id, location_id: r.location_id, delivery_date: r.delivery_date, quantity_declared: r.quantity_declared, unit: r.unit };
      if (r.producer_kind === 'LOCAL') { await need(r.producer_ref as string, 'PRODUCER_CREATE', 'del productor nuevo', 'local_producers'); payload.producer_local_ref = r.producer_ref; } else payload.producer_id = r.producer_ref;
      const origins = JSON.parse(r.origins as string) as LocalDeliveryInput['origins'];
      payload.origins = [];
      for (const o of origins) {
        if (o.kind === 'LOCAL') await need(o.id, 'PLOT_CREATE', 'de la parcela nueva de origen', 'local_plots');
        (payload.origins as unknown[]).push({ ...(o.kind === 'LOCAL' ? { plot_local_ref: o.id } : { plot_id: o.id }), ...(o.quantity ? { quantity: o.quantity } : {}) });
      }
      if (r.notes) payload.notes = r.notes;
      if (r.register_requested) payload.register = true;
      const op = await this.addEntityOp(tx, 'DELIVERY_CREATE', id, payload, deps);
      await tx.run("UPDATE local_deliveries SET status = 'QUEUED', queued_at = ?, updated_at = ? WHERE id = ?", [this.now(), this.now(), id]);
      return op;
    });
  }

  async localDeliveries(): Promise<LocalDeliveryView[]> {
    const rows = await this.db.all<Record<string, string | number | null>>('SELECT * FROM local_deliveries ORDER BY created_at DESC');
    const out: LocalDeliveryView[] = [];
    for (const r of rows) out.push({ id: r.id as string, producer: { kind: r.producer_kind as 'SERVER' | 'LOCAL', id: r.producer_ref as string }, product_id: r.product_id as string, location_id: r.location_id as string, delivery_date: r.delivery_date as string,
      quantity_declared: r.quantity_declared as string, unit: 'KG', origins: JSON.parse(r.origins as string), notes: r.notes as string | null, register: r.register_requested === 1, status: r.status as 'DRAFT' | 'QUEUED', server_id: r.server_id as string | null,
      ...(await this.localState(r.id as string, 'DELIVERY_CREATE', r.status as string)) });
    return out;
  }

  // ---- Cartografía preparada (D): teselas públicas guardadas en la base de la cuenta ----
  async mapAreas(): Promise<MapArea[]> { return this.db.all('SELECT * FROM map_areas ORDER BY prepared_at DESC'); }
  /** Tesela guardada (MVT sin comprimir) o null: el mapa distingue «no preparada» de «sin datos». */
  async mapTile(z: number, x: number, y: number): Promise<Uint8Array | null> {
    const r = await this.db.get<{ data: Uint8Array }>('SELECT data FROM map_tiles WHERE z = ? AND x = ? AND y = ?', [z, x, y]);
    return r ? new Uint8Array(r.data) : null;
  }
  async mapTileCount(): Promise<number> { return (await this.db.get<{ n: number }>('SELECT count(*) AS n FROM map_tiles'))?.n ?? 0; }
  /** Guarda un lote de teselas (se conserva lo ya guardado; reemplaza la misma z/x/y). Falla con mensaje claro si no hay espacio. */
  async saveMapTiles(tiles: Array<{ z: number; x: number; y: number; data: Uint8Array }>): Promise<void> {
    this.writable();
    await this.db.transaction(async (tx) => { for (const t of tiles) await tx.run('INSERT OR REPLACE INTO map_tiles (z, x, y, data) VALUES (?,?,?,?)', [t.z, t.x, t.y, t.data]); });
  }
  async saveMapArea(a: Omit<MapArea, 'id' | 'prepared_at'>): Promise<string> {
    this.writable();
    const id = this.p.uuid();
    await this.db.run('INSERT INTO map_areas (id, label, center_lat, center_lon, radius_km, min_zoom, max_zoom, tiles, bytes, prepared_at, source_label) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [id, a.label, a.center_lat, a.center_lon, a.radius_km, a.min_zoom, a.max_zoom, a.tiles, a.bytes, this.now(), a.source_label]);
    return id;
  }
  /** Borra TODA la cartografía de esta cuenta (es derivada y se vuelve a descargar). No toca capturas, colas ni evidencias. */
  async clearMap(): Promise<void> { await this.db.transaction(async (tx) => { await tx.run('DELETE FROM map_tiles'); await tx.run('DELETE FROM map_areas'); }); }

  // ---- Cola para sincronización (P0-024) ----
  async pendingBatch(limit: number): Promise<OutboxOp[]> {
    return (await this.db.all<Row>("SELECT * FROM outbox WHERE state = 'PENDING' ORDER BY seq LIMIT ?", [limit])).map(toOp);
  }
  async op(operationId: string): Promise<OutboxOp | undefined> { const r = await this.db.get<Row>('SELECT * FROM outbox WHERE operation_id = ?', [operationId]); return r ? toOp(r) : undefined; }
  async markUploading(ids: string[]) {
    await this.db.transaction(async (tx) => { for (const id of ids) await tx.run("UPDATE outbox SET state = 'UPLOADING', attempts = attempts + 1 WHERE operation_id = ? AND state = 'PENDING'", [id]); });
  }
  /** Sin respuesta (timeout, red): vuelven a PENDING con su identidad; nada se retira de la cola. */
  async returnToPending(ids: string[], error: string) {
    await this.db.transaction(async (tx) => { for (const id of ids) await tx.run("UPDATE outbox SET state = 'PENDING', last_error = ? WHERE operation_id = ? AND state = 'UPLOADING'", [error, id]); });
  }
  /** Aplica resultados confirmados por el servidor. Solo ACCEPTED/DUPLICATE retiran la operación (SYNCED). */
  async applyOutcomes(outcomes: ServerOutcome[]) {
    await this.db.transaction(async (tx) => {
      for (const o of outcomes) {
        const state = o.status === 'ACCEPTED' || o.status === 'DUPLICATE' ? 'SYNCED' : o.status === 'REJECTED' ? 'FAILED' : o.status === 'CONFLICT' ? 'CONFLICT' : 'PENDING';
        const err = o.error ? `${o.error.code}: ${o.error.message}` : o.status === 'DEPENDENCY_PENDING' ? 'DEPENDENCY_PENDING: falta confirmar una operación previa' : null;
        await tx.run('UPDATE outbox SET state = ?, last_error = ?, server_result = ? WHERE operation_id = ?', [state, err, JSON.stringify({ status: o.status, result: o.result ?? null, error: o.error ?? null }), o.operation_id]);
        // Alta aceptada: la referencia local queda enlazada con el identificador DEFINITIVO del servidor (sobrevive a cierres y reintentos).
        const sid = (o.result as { server_id?: string } | null | undefined)?.server_id;
        if (state === 'SYNCED' && sid) {
          const row = await tx.get<{ operation_type: string; entity_id: string }>('SELECT operation_type, entity_id FROM outbox WHERE operation_id = ?', [o.operation_id]);
          if (row?.operation_type === 'PRODUCER_CREATE') await tx.run('UPDATE local_producers SET server_id = ? WHERE id = ?', [sid, row.entity_id]);
          if (row?.operation_type === 'PLOT_CREATE') await tx.run('UPDATE local_plots SET server_id = ? WHERE id = ?', [sid, row.entity_id]);
          if (row?.operation_type === 'DELIVERY_CREATE') await tx.run('UPDATE local_deliveries SET server_id = ? WHERE id = ?', [sid, row.entity_id]);
        }
      }
    });
  }
  /**
   * Resolución autorizada de un conflicto: la operación original se conserva (CONFLICT, enlazada) y se crea otra con un
   * operation_id nuevo basada en la versión actual del servidor. Requiere sesión vigente; el servidor revalida todo.
   *
   * La cadena completa se recupera: toda operación POSTERIOR de la misma captura que dependía de la resuelta y que el servidor
   * ya conoce como rechazada o en conflicto (FAILED/CONFLICT) se conserva con su historial y se sustituye por otra con
   * identificador, dependencia y hash nuevos. Una operación que el servidor aún no conoce (PENDING sin envíos) solo cambia
   * su dependencia y su hash, que todavía no existen para el servidor. Lo ya confirmado (SYNCED) no se toca. Si alguna
   * operación quedó con respuesta perdida (enviada, sin resultado), no se sustituye nada: se sincroniza primero para que
   * se reintente con su identificador original y se conozca su resultado; crear otra podría duplicar el efecto.
   */
  async resolveConflict(operationId: string, serverVersion: number): Promise<string> {
    return this.substituteFrom(operationId, 'CONFLICT', serverVersion, null);
  }

  /**
   * Corrección de un alta RECHAZADA por el servidor (p. ej. código repetido): se conservan la operación original y su rechazo, se
   * corrigen los datos locales y se crea una sustituta con la MISMA referencia local (el servidor no guardó ninguna correspondencia
   * porque el alta falló). Las capturas que dependían del alta se recuperan igual que tras un conflicto.
   */
  async correctRejectedCreate(operationId: string, patch: Record<string, string | null>): Promise<string> {
    return this.substituteFrom(operationId, 'FAILED', null, patch);
  }

  private async substituteFrom(operationId: string, expect: 'CONFLICT' | 'FAILED', serverVersion: number | null, patch: Record<string, string | null> | null): Promise<string> {
    this.writable();
    return this.db.transaction(async (tx) => {
      const o = await tx.get<Row>('SELECT * FROM outbox WHERE operation_id = ? AND state = ? AND resolved_by IS NULL', [operationId, expect]);
      if (!o) throw new Error(expect === 'CONFLICT' ? 'La operación no está en conflicto o ya se resolvió.' : 'La operación no está rechazada o ya se corrigió.');
      const op = toOp(o);
      if (expect === 'FAILED' && !['PRODUCER_CREATE', 'PLOT_CREATE', 'DELIVERY_CREATE'].includes(op.operation_type)) throw new Error('Solo se corrigen altas rechazadas.');
      // Se recorre el GRAFO DE DEPENDENCIAS de la captura, no el orden de inserción: una sustituta tiene un seq mayor que las operaciones
      // aún pendientes que re-apuntan a ella, así que un segundo conflicto consecutivo se perdería con un filtro por seq.
      const all = (await tx.all<Row>('SELECT * FROM outbox ORDER BY seq')).map(toOp); // toda la cola: las capturas que dependen de un alta viven en otros borradores
      const map = new Map<string, string>([[op.operation_id, this.p.uuid()]]);
      const plan: Array<{ op: OutboxOp; mode: 'REPLACE' | 'REWIRE' }> = [];
      const planned = new Set<string>([op.operation_id]);
      for (let changed = true; changed;) {
        changed = false;
        for (const x of all) {
          if (planned.has(x.operation_id) || x.state === 'SYNCED' || x.resolved_by) continue;
          if (!x.depends_on.some((d) => map.has(d))) continue;
          const sent = x.state === 'UPLOADING' || (x.state === 'PENDING' && x.attempts > 0 && !x.server_result);
          if (sent) throw new Error('Hay operaciones enviadas cuya respuesta no llegó. Sincroniza primero: se reintentan con su identificador original para conocer su resultado antes de reenviar nada.');
          planned.add(x.operation_id); changed = true;
          // REWIRE conserva su identificador, pero se mueve al final de la cola: las que dependen de ella también deben ir después.
          if (x.state === 'PENDING') { map.set(x.operation_id, x.operation_id); plan.push({ op: x, mode: 'REWIRE' }); }
          else { map.set(x.operation_id, this.p.uuid()); plan.push({ op: x, mode: 'REPLACE' }); }
        }
      }
      // 2) aplicar
      let seq = ((await tx.get<{ n: number }>('SELECT max(seq) AS n FROM outbox'))!.n);
      const at = this.now();
      const remap = (deps: string[]) => deps.map((d) => map.get(d) ?? d);
      const hashOf = (x: OutboxOp, id: string, base: number | null, deps: string[], payload: Record<string, unknown>) =>
        this.p.sha256(new TextEncoder().encode(operationCanonical({ operation_type: x.operation_type, entity_id: x.entity_id, base_version: base, depends_on: deps, captured_at: x.captured_at, payload }))).then((h) => { void id; return h; });
      const insert = async (x: OutboxOp, id: string, base: number | null, deps: string[], payload: Record<string, unknown>) => {
        seq += 1;
        await tx.run("INSERT INTO outbox (operation_id, seq, draft_id, operation_type, entity_id, base_version, depends_on, captured_at, payload, attachment_refs, state, created_at, content_hash, resolves) VALUES (?,?,?,?,?,?,?,?,?,?, 'PENDING', ?, ?, ?)",
          [id, seq, x.draft_id, x.operation_type, x.entity_id, base, JSON.stringify(deps), x.captured_at, JSON.stringify(payload), JSON.stringify(x.attachment_refs), at, await hashOf(x, id, base, deps, payload), x.operation_id]);
        await tx.run('UPDATE outbox SET resolved_by = ? WHERE operation_id = ?', [id, x.operation_id]);
      };
      const newId = map.get(op.operation_id)!;
      if (expect === 'CONFLICT') await insert(op, newId, serverVersion, remap(op.depends_on), { ...op.payload, resolves_operation_id: op.operation_id });
      else {
        const next = { ...op.payload, ...patch } as Record<string, unknown>;
        await insert(op, newId, op.base_version, remap(op.depends_on), next);
        const table = op.operation_type === 'PRODUCER_CREATE' ? 'local_producers' : op.operation_type === 'PLOT_CREATE' ? 'local_plots' : 'local_deliveries';
        const cols = Object.keys(patch ?? {}).filter((k) => /^[a-z_]+$/.test(k));
        for (const k of cols) await tx.run(`UPDATE ${table} SET ${k} = ?, updated_at = ? WHERE id = ?`, [patch![k], this.now(), op.entity_id]);
      }
      for (const { op: x, mode } of plan) {
        const deps = remap(x.depends_on);
        if (mode === 'REWIRE') {
          // También pasa al final de la cola: el servidor procesa el lote en orden y una operación no puede ir antes de aquella de la que depende.
          seq += 1;
          await tx.run('UPDATE outbox SET depends_on = ?, content_hash = ?, seq = ? WHERE operation_id = ?', [JSON.stringify(deps), await hashOf(x, x.operation_id, x.base_version, deps, x.payload), seq, x.operation_id]);
        } else {
          const { resolves_operation_id: _drop, ...payload } = x.payload as Record<string, unknown>;
          void _drop;
          await insert(x, map.get(x.operation_id)!, x.base_version, deps, payload);
        }
      }
      return newId;
    });
  }

  // ---- Adjuntos (estado separado del registro) ----
  async attachmentsToUpload(): Promise<Array<{ id: string; operation_id: string; sha256: string; size_bytes: number; mime_type: string }>> {
    return this.db.all(`SELECT a.id, o.operation_id, a.sha256, a.size_bytes, a.mime_type FROM attachments a JOIN outbox o ON o.operation_type IN ('PLOT_PHOTO_ATTACH', 'DOCUMENT_ATTACH') AND o.attachment_refs LIKE '%' || a.id || '%'
      WHERE a.upload_state = 'LOCAL' AND o.state = 'SYNCED' ORDER BY o.seq`);
  }
  /** Fotos ya subidas cuyo análisis no ha concluido: se consulta su estado reenviando su operación confirmada (idempotente). */
  async attachmentsAwaitingAnalysis(): Promise<Array<{ id: string; op: OutboxOp }>> {
    const rows = await this.db.all<Row & { attachment_id: string }>(`SELECT o.*, a.id AS attachment_id FROM attachments a JOIN outbox o ON o.operation_type IN ('PLOT_PHOTO_ATTACH', 'DOCUMENT_ATTACH') AND o.attachment_refs LIKE '%' || a.id || '%'
      WHERE a.upload_state = 'UPLOADED' AND coalesce(a.server_status, '') NOT IN ('AVAILABLE', 'REJECTED') AND o.state = 'SYNCED' ORDER BY o.seq`);
    return rows.map((r) => ({ id: r.attachment_id, op: toOp(r) }));
  }
  async attachmentBytes(id: string): Promise<Uint8Array> {
    const a = await this.db.get<{ storage: string; content: Uint8Array | null; path: string | null }>('SELECT storage, content, path FROM attachments WHERE id = ?', [id]);
    if (!a) throw new Error('Adjunto inexistente.');
    return a.storage === 'DB' ? new Uint8Array(a.content as Uint8Array) : this.p.files.readBytes(a.path!);
  }
  async setAttachmentState(id: string, state: 'LOCAL' | 'UPLOADED' | 'REJECTED', serverStatus: string | null, detail: string | null) {
    await this.db.run('UPDATE attachments SET upload_state = ?, server_status = ?, server_detail = ? WHERE id = ?', [state, serverStatus, detail, id]);
  }

  /** Al abrir la app: recupera operaciones interrumpidas y reconcilia archivos con registros, sin borrar capturas. */
  async recover(): Promise<RecoveryReport> {
    const report: RecoveryReport = { recovered_operations: [], incomplete_temp_files: [], orphan_files: [], missing_files: [] };
    await this.db.transaction(async (tx) => {
      const up = await tx.all<{ operation_id: string }>("SELECT operation_id FROM outbox WHERE state = 'UPLOADING'");
      for (const o of up) {
        await tx.run("UPDATE outbox SET state = 'PENDING', recovered_count = recovered_count + 1, last_error = 'Interrumpida al cerrar la app: recuperada con la misma identidad' WHERE operation_id = ?", [o.operation_id]);
        report.recovered_operations.push(o.operation_id);
      }
    });
    for (const f of await this.p.files.list(this.tmpDir())) {
      report.incomplete_temp_files.push(f);
      await this.p.files.delete(`${this.tmpDir()}/${f}`).catch(() => undefined);
    }
    const known = new Set((await this.db.all<{ path: string }>("SELECT path FROM attachments WHERE storage = 'FILE'")).map((r) => r.path));
    for (const f of await this.p.files.list(this.attachmentsDir())) if (!known.has(`${this.attachmentsDir()}/${f}`)) report.orphan_files.push(f);
    for (const pth of known) if (!(await this.p.files.exists(pth))) report.missing_files.push(pth);
    const at = this.now();
    for (const [kind, list] of Object.entries(report)) for (const item of list) await this.db.run('INSERT INTO incidents (id, kind, detail, at) VALUES (?,?,?,?)', [this.p.uuid(), kind, item, at]);
    return report;
  }

  async drafts(): Promise<DraftView[]> {
    const ds = await this.db.all<{ id: string; plot_id: string; plot_code: string | null; note: string; status: 'DRAFT' | 'QUEUED'; created_at: string; updated_at: string; queued_at: string | null }>(
      'SELECT d.id, d.plot_id, COALESCE(p.plot_code, lp.plot_code) AS plot_code, d.note, d.status, d.created_at, d.updated_at, d.queued_at FROM drafts d LEFT JOIN dataset_plots p ON p.id = d.plot_id LEFT JOIN local_plots lp ON lp.id = d.plot_id ORDER BY d.created_at DESC');
    const out: DraftView[] = [];
    for (const d of ds) {
      const loc = await this.db.get<{ id: string; latitude: number; longitude: number; accuracy_m: number | null; acquired_at: string; recorded_at: string; source: string; provider_detail: string; mocked: number | null }>('SELECT * FROM location_samples WHERE draft_id = ?', [d.id]);
      const photos = await this.db.all<{ id: string; storage: string; path: string | null; has_content: number; sha256: string; size_bytes: number; captured_at: string | null; stored_at: string; upload_state: string; server_status: string | null; server_detail: string | null }>(
        "SELECT id, storage, path, content IS NOT NULL AS has_content, sha256, size_bytes, captured_at, stored_at, upload_state, server_status, server_detail FROM attachments WHERE draft_id = ? AND kind = 'PHOTO' ORDER BY stored_at", [d.id]);
      const supports = await this.db.all<SupportView>("SELECT id, doc_type AS document_type, title, mime_type, size_bytes, sha256, upload_state, server_status, server_detail FROM attachments WHERE draft_id = ? AND kind = 'SUPPORT' ORDER BY stored_at", [d.id]);
      const ops = (await this.db.all<Row>('SELECT * FROM outbox WHERE draft_id = ? ORDER BY seq', [d.id])).map(toOp);
      const ph = [];
      for (const x of photos) ph.push({ id: x.id, storage: x.storage, sha256: x.sha256, size_bytes: x.size_bytes, captured_at: x.captured_at, stored_at: x.stored_at, upload_state: x.upload_state, server_status: x.server_status, server_detail: x.server_detail,
        file_present: x.storage === 'DB' ? x.has_content === 1 : await this.p.files.exists(x.path!) });
      const vertices = (await this.db.all<{ id: string; seq: number; latitude: number; longitude: number; accuracy_m: number | null; acquired_at: string; recorded_at: string; provider_detail: string; mocked: number | null }>('SELECT * FROM polygon_vertices WHERE draft_id = ? ORDER BY seq', [d.id]))
        .map((v) => ({ ...v, mocked: v.mocked === null ? null : v.mocked === 1 }));
      out.push({ ...d, vertices, location: loc ? { ...loc, mocked: loc.mocked === null ? null : loc.mocked === 1 } : null, photos: ph, supports, operations: ops });
    }
    return out;
  }

  async counts() {
    const r = await this.db.get<{ drafts: number; queued: number; pending_ops: number; photos: number; conflicts: number; failed: number }>(
      "SELECT (SELECT count(*) FROM drafts WHERE status = 'DRAFT') AS drafts, (SELECT count(*) FROM drafts WHERE status = 'QUEUED') AS queued, (SELECT count(*) FROM outbox WHERE state IN ('PENDING','UPLOADING')) AS pending_ops, (SELECT count(*) FROM attachments) AS photos, (SELECT count(*) FROM outbox WHERE state = 'CONFLICT' AND resolved_by IS NULL) AS conflicts, (SELECT count(*) FROM outbox WHERE state = 'FAILED' AND resolved_by IS NULL) AS failed");
    return r!;
  }

  /** Solo para pruebas de recuperación: simula una transferencia interrumpida. */
  async markUploadingForTest(operationId: string) { await this.db.run("UPDATE outbox SET state = 'UPLOADING', attempts = attempts + 1 WHERE operation_id = ?", [operationId]); }
}
