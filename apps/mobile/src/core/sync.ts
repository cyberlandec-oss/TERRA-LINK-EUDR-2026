import type { DatasetPlot, LocalStore, ReferenceData, ServerOutcome } from './store';

// Motor de sincronización del dispositivo (P0-024; docs/11). Reglas:
// - push por lotes (≤ 50) en orden de cola; antes de enviar, UPLOADING persistido; sin respuesta → PENDING con la misma
//   identidad (nada se retira de la cola sin resultado confirmado por el servidor);
// - DEPENDENCY_PENDING y TRANSIENT_ERROR quedan PENDING; REJECTED → FAILED; CONFLICT → CONFLICT (resolución explícita);
//   FORBIDDEN → PENDING marcado «bloqueado por acceso» (no se borra);
// - dispositivo revocado o sesión inválida: se detiene y conserva todo;
// - adjuntos: solo tras aceptarse su registro; estado del archivo separado del registro;
// - pull: cursor del servidor; si caduca o es inválido, descarga completa sin tocar operaciones pendientes.

export const BATCH = 50;

export class TransportError extends Error {
  constructor(readonly kind: 'NETWORK' | 'HTTP', readonly status: number | null, readonly code: string, message: string) { super(message); this.name = 'TransportError'; }
}
export interface WireOperation { operation_id: string; operation_type: string; entity_id: string; base_version: number | null; depends_on: string[]; captured_at: string; payload: Record<string, unknown>; content_hash: string }
export interface SyncTransport {
  push(deviceId: string, ops: WireOperation[]): Promise<ServerOutcome[]>;
  upload(deviceId: string, operationId: string, bytes: Uint8Array, mimeType: string): Promise<{ status: string; note?: string }>;
  pull(deviceId: string, cursor: string | null): Promise<{ cursor: string; full: boolean; changes: DatasetPlot[]; tombstones: string[]; reference?: ReferenceData }>;
}
export interface SyncSummary {
  pushed: number; synced: number; failed: number; conflicts: number; still_pending: number; uploads: number; upload_errors: number;
  pulled: { full: boolean; changes: number; tombstones: number } | null; stopped: null | { reason: 'OFFLINE' | 'DEVICE_REVOKED' | 'SESSION' | 'ACCESS' | 'SERVER'; message: string };
}

const blocking = (e: TransportError): SyncSummary['stopped'] =>
  e.kind === 'NETWORK' ? { reason: 'OFFLINE', message: e.message }
    : e.code === 'DEVICE_REVOKED' ? { reason: 'DEVICE_REVOKED', message: e.message }
      : e.status === 401 ? { reason: 'SESSION', message: 'La sesión venció: inicia sesión con conexión. Las operaciones se conservan.' }
        : e.status === 403 || e.status === 404 ? { reason: 'ACCESS', message: e.message }
          : { reason: 'SERVER', message: e.message };

export async function syncOnce(store: LocalStore, t: SyncTransport, deviceId: string): Promise<SyncSummary> {
  const s: SyncSummary = { pushed: 0, synced: 0, failed: 0, conflicts: 0, still_pending: 0, uploads: 0, upload_errors: 0, pulled: null, stopped: null };
  // 1) push
  const tried = new Set<string>();
  for (let round = 0; round < 20; round++) {
    const batch = (await store.pendingBatch(BATCH * 4)).filter((o) => !tried.has(o.operation_id)).slice(0, BATCH);
    if (!batch.length) break;
    const ids = batch.map((o) => o.operation_id);
    await store.markUploading(ids);
    let outcomes: ServerOutcome[];
    try {
      outcomes = await t.push(deviceId, batch.map((o) => ({ operation_id: o.operation_id, operation_type: o.operation_type, entity_id: o.entity_id, base_version: o.base_version, depends_on: o.depends_on, captured_at: o.captured_at, payload: o.payload, content_hash: o.content_hash })));
    } catch (e) {
      const te = e instanceof TransportError ? e : new TransportError('NETWORK', null, 'NETWORK', 'Sin respuesta del servidor.');
      await store.returnToPending(ids, `${te.code}: ${te.message}`);
      s.stopped = blocking(te);
      break;
    }
    // Una operación sin resultado en la respuesta no se da por enviada.
    const missing = ids.filter((id) => !outcomes.some((o) => o.operation_id === id));
    await store.applyOutcomes(outcomes.map((o) => (o.status === 'FORBIDDEN' ? { ...o, error: { code: `BLOQUEADO_POR_ACCESO ${o.error?.code ?? ''}`.trim(), message: o.error?.message ?? 'Sin permiso.' } } : o)));
    await store.returnToPending(missing, 'SIN_RESULTADO: el servidor no devolvió resultado; se reintentará');
    s.pushed += ids.length;
    for (const o of outcomes) {
      if (o.status === 'ACCEPTED' || o.status === 'DUPLICATE') s.synced += 1;
      else if (o.status === 'REJECTED') s.failed += 1;
      else if (o.status === 'CONFLICT') s.conflicts += 1;
      // DEPENDENCY_PENDING / FORBIDDEN / TRANSIENT_ERROR: siguen pendientes; no se reintentan en esta pasada
      if (!['ACCEPTED', 'DUPLICATE', 'REJECTED', 'CONFLICT'].includes(o.status)) tried.add(o.operation_id);
    }
    for (const id of missing) tried.add(id);
    if (outcomes.every((o) => !['ACCEPTED', 'DUPLICATE', 'REJECTED', 'CONFLICT'].includes(o.status))) break; // sin progreso
  }
  s.still_pending = (await store.counts()).pending_ops;
  if (s.stopped) return s;
  // 2) adjuntos (registro ya aceptado)
  for (const a of await store.attachmentsToUpload()) {
    try {
      const r = await t.upload(deviceId, a.operation_id, await store.attachmentBytes(a.id), a.mime_type);
      await store.setAttachmentState(a.id, 'UPLOADED', r.status, r.note ?? null);
      s.uploads += 1;
    } catch (e) {
      const te = e instanceof TransportError ? e : new TransportError('NETWORK', null, 'NETWORK', 'Sin respuesta del servidor.');
      s.upload_errors += 1;
      await store.setAttachmentState(a.id, 'LOCAL', null, `${te.code}: ${te.message}`);
      if (te.kind === 'NETWORK' || te.status === 401 || te.code === 'DEVICE_REVOKED') { s.stopped = blocking(te); return s; }
    }
  }
  // 2b) estado del análisis de fotos ya subidas (sin reenviar archivos)
  const waiting = await store.attachmentsAwaitingAnalysis();
  if (waiting.length) {
    try {
      const res = await t.push(deviceId, waiting.map(({ op: o }) => ({ operation_id: o.operation_id, operation_type: o.operation_type, entity_id: o.entity_id, base_version: o.base_version, depends_on: o.depends_on, captured_at: o.captured_at, payload: o.payload, content_hash: o.content_hash })));
      for (const w of waiting) {
        const r = res.find((x) => x.operation_id === w.op.operation_id);
        const att = (r?.result as { attachment?: { status?: string; note?: string } } | null | undefined)?.attachment;
        if (att?.status) await store.setAttachmentState(w.id, att.status === 'AWAITING_CONTENT' ? 'LOCAL' : 'UPLOADED', att.status === 'AWAITING_CONTENT' ? null : att.status, att.note ?? null);
      }
    } catch (e) {
      const te = e instanceof TransportError ? e : new TransportError('NETWORK', null, 'NETWORK', 'Sin respuesta del servidor.');
      s.stopped = blocking(te); return s;
    }
  }
  // 3) pull
  try {
    let cursor = await store.meta('sync_cursor');
    let r;
    try { r = await t.pull(deviceId, cursor); } catch (e) {
      if (e instanceof TransportError && (e.code === 'CURSOR_EXPIRED' || e.code === 'CURSOR_INVALID')) { cursor = null; r = await t.pull(deviceId, null); } else throw e;
    }
    await store.applyPull(r.changes, r.tombstones, r.cursor, r.full);
    if (r.reference) await store.applyReference(r.reference);
    s.pulled = { full: r.full, changes: r.changes.length, tombstones: r.tombstones.length };
  } catch (e) {
    const te = e instanceof TransportError ? e : new TransportError('NETWORK', null, 'NETWORK', 'Sin respuesta del servidor.');
    s.stopped = blocking(te);
  }
  return s;
}
