import { operationCanonical } from './canonical';
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
  operation_id: string; seq: number; draft_id: string; operation_type: string; entity_id: string; base_version: number | null; depends_on: string[];
  captured_at: string; payload: Record<string, unknown>; attachment_refs: string[]; state: string; attempts: number; recovered_count: number;
  last_error: string | null; server_result: Record<string, unknown> | null; content_hash: string; resolved_by: string | null; resolves: string | null;
}
export interface DraftView {
  id: string; plot_id: string; plot_code: string | null; note: string; status: 'DRAFT' | 'QUEUED'; created_at: string; updated_at: string; queued_at: string | null;
  location: (LocationSampleInput & { id: string; recorded_at: string; source: string }) | null;
  photos: Array<{ id: string; storage: string; sha256: string; size_bytes: number; captured_at: string | null; stored_at: string; upload_state: string; server_status: string | null; server_detail: string | null; file_present: boolean }>;
  /** Vértices de polígono en orden de captura (solo borrador: confirmar el polígono es una decisión humana en la web). */
  vertices: Array<LocationSampleInput & { id: string; seq: number; recorded_at: string }>;
  operations: OutboxOp[];
}
export interface RecoveryReport { recovered_operations: string[]; incomplete_temp_files: string[]; orphan_files: string[]; missing_files: string[] }
export type ServerOutcome = { operation_id: string; status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED' | 'CONFLICT' | 'DEPENDENCY_PENDING' | 'FORBIDDEN' | 'TRANSIENT_ERROR'; result?: Record<string, unknown> | null; error?: { code: string; message: string; details?: unknown } | null };

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
    const plot = await this.db.get<{ id: string }>('SELECT id FROM dataset_plots WHERE id = ?', [plotId]);
    if (!plot) throw new Error('La parcela no está en los datos descargados para esta cuenta y organización.');
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
   * Encolar: en UNA transacción el borrador pasa a QUEUED y se crean sus operaciones reales (operation_id estable y hash):
   * PLOT_LOCATION_SAMPLE_CREATE y PLOT_PHOTO_ATTACH (que depende de la muestra si la hay). La nota viaja como leyenda de
   * las fotos; una nota sin foto no tiene entidad en el servidor y no se encola.
   */
  async enqueue(draftId: string): Promise<string[]> {
    this.writable();
    return this.db.transaction(async (tx) => {
      await this.editable(tx, draftId);
      const d = (await tx.get<{ plot_id: string; note: string; created_at: string }>('SELECT plot_id, note, created_at FROM drafts WHERE id = ?', [draftId]))!;
      const plot = await tx.get<{ row_version: number; plot_code: string }>('SELECT row_version, plot_code FROM dataset_plots WHERE id = ?', [d.plot_id]);
      const loc = await tx.get<{ id: string; latitude: number; longitude: number; accuracy_m: number | null; acquired_at: string; provider_detail: string; mocked: number | null }>('SELECT * FROM location_samples WHERE draft_id = ?', [draftId]);
      const photos = await tx.all<{ id: string; sha256: string; size_bytes: number; mime_type: string; captured_at: string | null }>('SELECT id, sha256, size_bytes, mime_type, captured_at FROM attachments WHERE draft_id = ? ORDER BY stored_at, id', [draftId]);
      const verts = await tx.all<{ id: string; seq: number; latitude: number; longitude: number; accuracy_m: number | null; acquired_at: string; provider_detail: string; mocked: number | null }>('SELECT * FROM polygon_vertices WHERE draft_id = ? ORDER BY seq', [draftId]);
      if (!loc && !photos.length && !verts.length) throw new Error(d.note.trim() ? 'Una nota sin ubicación, vértices ni foto no tiene entidad en el servidor: agrega ubicación, vértices o foto.' : 'La captura está vacía: agrega ubicación, vértices o foto.');
      const at = this.now();
      let seq = ((await tx.get<{ n: number | null }>('SELECT max(seq) AS n FROM outbox'))?.n ?? 0);
      const ops: string[] = [];
      const add = async (type: string, entity: string, baseVersion: number | null, payload: Record<string, unknown>, deps: string[], refs: string[], capturedAt: string) => {
        const op = this.p.uuid();
        seq += 1;
        const hash = await this.p.sha256(new TextEncoder().encode(operationCanonical({ operation_type: type, entity_id: entity, base_version: baseVersion, depends_on: deps, captured_at: capturedAt, payload })));
        await tx.run("INSERT INTO outbox (operation_id, seq, draft_id, operation_type, entity_id, base_version, depends_on, captured_at, payload, attachment_refs, state, created_at, content_hash) VALUES (?,?,?,?,?,?,?,?,?,?, 'PENDING', ?, ?)",
          [op, seq, draftId, type, entity, baseVersion, JSON.stringify(deps), capturedAt, JSON.stringify(payload), JSON.stringify(refs), at, hash]);
        ops.push(op);
        return op;
      };
      const locOp = loc ? await add('PLOT_LOCATION_SAMPLE_CREATE', loc.id, plot?.row_version ?? null, { plot_id: d.plot_id, latitude: loc.latitude, longitude: loc.longitude, accuracy_m: loc.accuracy_m, acquired_at: loc.acquired_at,
        source: 'DEVICE_LOCATION_SERVICE', provider_detail: loc.provider_detail, mocked: loc.mocked === null ? null : loc.mocked === 1 }, [], [], loc.acquired_at) : null;
      // Vértices: una operación por vértice, encadenadas en el orden de captura (el servidor los recibe en ese orden). Nunca confirma el polígono.
      // `capture_id` (este borrador local) identifica el borrador de destino en el servidor; el primer vértice lleva la versión de la parcela que el teléfono conocía.
      let prev: string | null = locOp;
      for (const v of verts) {
        prev = await add('PLOT_POLYGON_VERTEX_ADD', v.id, v.seq === 1 ? (plot?.row_version ?? null) : null, { plot_id: d.plot_id, capture_id: draftId, vertex_seq: v.seq, latitude: v.latitude, longitude: v.longitude, accuracy_m: v.accuracy_m, acquired_at: v.acquired_at,
          source: 'DEVICE_LOCATION_SERVICE', provider_detail: v.provider_detail, mocked: v.mocked === null ? null : v.mocked === 1 }, prev ? [prev] : [], [], v.acquired_at);
      }
      for (const ph of photos) {
        await add('PLOT_PHOTO_ATTACH', ph.id, null, { plot_id: d.plot_id, sha256: ph.sha256, size_bytes: ph.size_bytes, mime_type: ph.mime_type,
          caption: (d.note.trim() || `Foto de campo ${plot?.plot_code ?? ''}`).slice(0, 160) }, prev ? [prev] : [], [ph.id], ph.captured_at ?? at);
      }
      await tx.run("UPDATE drafts SET status = 'QUEUED', queued_at = ?, updated_at = ? WHERE id = ?", [at, at, draftId]);
      return ops;
    });
  }

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
    this.writable();
    return this.db.transaction(async (tx) => {
      const o = await tx.get<Row>("SELECT * FROM outbox WHERE operation_id = ? AND state = 'CONFLICT' AND resolved_by IS NULL", [operationId]);
      if (!o) throw new Error('La operación no está en conflicto o ya se resolvió.');
      const op = toOp(o);
      const later = (await tx.all<Row>('SELECT * FROM outbox WHERE draft_id = ? AND seq > ? ORDER BY seq', [op.draft_id, op.seq])).map(toOp);
      // 1) plan: qué cambia y si algo es ambiguo (respuesta perdida)
      const map = new Map<string, string>([[op.operation_id, this.p.uuid()]]);
      const plan: Array<{ op: OutboxOp; mode: 'REPLACE' | 'REWIRE' }> = [];
      for (const x of later) {
        if (x.state === 'SYNCED' || x.resolved_by) continue;
        if (!x.depends_on.some((d) => map.has(d))) continue;
        const sent = x.state === 'UPLOADING' || (x.state === 'PENDING' && x.attempts > 0 && !x.server_result);
        if (sent) throw new Error('Hay operaciones enviadas cuya respuesta no llegó. Sincroniza primero: se reintentan con su identificador original para conocer su resultado antes de reenviar nada.');
        if (x.state === 'PENDING') plan.push({ op: x, mode: 'REWIRE' });
        else { map.set(x.operation_id, this.p.uuid()); plan.push({ op: x, mode: 'REPLACE' }); }
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
      await insert(op, newId, serverVersion, remap(op.depends_on), { ...op.payload, resolves_operation_id: op.operation_id });
      for (const { op: x, mode } of plan) {
        const deps = remap(x.depends_on);
        if (mode === 'REWIRE') {
          await tx.run('UPDATE outbox SET depends_on = ?, content_hash = ? WHERE operation_id = ?', [JSON.stringify(deps), await hashOf(x, x.operation_id, x.base_version, deps, x.payload), x.operation_id]);
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
    return this.db.all(`SELECT a.id, o.operation_id, a.sha256, a.size_bytes, a.mime_type FROM attachments a JOIN outbox o ON o.operation_type = 'PLOT_PHOTO_ATTACH' AND o.attachment_refs LIKE '%' || a.id || '%'
      WHERE a.upload_state = 'LOCAL' AND o.state = 'SYNCED' ORDER BY o.seq`);
  }
  /** Fotos ya subidas cuyo análisis no ha concluido: se consulta su estado reenviando su operación confirmada (idempotente). */
  async attachmentsAwaitingAnalysis(): Promise<Array<{ id: string; op: OutboxOp }>> {
    const rows = await this.db.all<Row & { attachment_id: string }>(`SELECT o.*, a.id AS attachment_id FROM attachments a JOIN outbox o ON o.operation_type = 'PLOT_PHOTO_ATTACH' AND o.attachment_refs LIKE '%' || a.id || '%'
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
      'SELECT d.id, d.plot_id, p.plot_code, d.note, d.status, d.created_at, d.updated_at, d.queued_at FROM drafts d LEFT JOIN dataset_plots p ON p.id = d.plot_id ORDER BY d.created_at DESC');
    const out: DraftView[] = [];
    for (const d of ds) {
      const loc = await this.db.get<{ id: string; latitude: number; longitude: number; accuracy_m: number | null; acquired_at: string; recorded_at: string; source: string; provider_detail: string; mocked: number | null }>('SELECT * FROM location_samples WHERE draft_id = ?', [d.id]);
      const photos = await this.db.all<{ id: string; storage: string; path: string | null; has_content: number; sha256: string; size_bytes: number; captured_at: string | null; stored_at: string; upload_state: string; server_status: string | null; server_detail: string | null }>(
        'SELECT id, storage, path, content IS NOT NULL AS has_content, sha256, size_bytes, captured_at, stored_at, upload_state, server_status, server_detail FROM attachments WHERE draft_id = ? ORDER BY stored_at', [d.id]);
      const ops = (await this.db.all<Row>('SELECT * FROM outbox WHERE draft_id = ? ORDER BY seq', [d.id])).map(toOp);
      const ph = [];
      for (const x of photos) ph.push({ id: x.id, storage: x.storage, sha256: x.sha256, size_bytes: x.size_bytes, captured_at: x.captured_at, stored_at: x.stored_at, upload_state: x.upload_state, server_status: x.server_status, server_detail: x.server_detail,
        file_present: x.storage === 'DB' ? x.has_content === 1 : await this.p.files.exists(x.path!) });
      const vertices = (await this.db.all<{ id: string; seq: number; latitude: number; longitude: number; accuracy_m: number | null; acquired_at: string; recorded_at: string; provider_detail: string; mocked: number | null }>('SELECT * FROM polygon_vertices WHERE draft_id = ? ORDER BY seq', [d.id]))
        .map((v) => ({ ...v, mocked: v.mocked === null ? null : v.mocked === 1 }));
      out.push({ ...d, vertices, location: loc ? { ...loc, mocked: loc.mocked === null ? null : loc.mocked === 1 } : null, photos: ph, operations: ops });
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
