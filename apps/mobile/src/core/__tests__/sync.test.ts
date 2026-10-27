import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore, type DatasetPlot, type ServerOutcome } from '../store';
import { syncOnce, TransportError, type SyncTransport, type WireOperation } from '../sync';
import { nodePlatform, syntheticJpeg } from './node-platform';

// Motor de sincronización con transporte SIMULADO (Node + SQLite real). El recorrido contra la API real está en
// src/app/__tests__/session.api.test.ts (TL_API_SMOKE=1). Ninguno es emulador ni dispositivo.
const PLOT: DatasetPlot = { id: '00000000-0000-4000-8000-000000000001', plot_code: 'P-SINT-1', name: null, row_version: 3, status: 'ACTIVE', producer_id: 'pr', producer_code: 'PR', producer_display_name: null, geometry_status: 'NONE' };
const SAMPLE = { latitude: -0.8, longitude: -80.1, accuracy_m: 12, acquired_at: '2026-10-10T15:00:00.000Z', provider_detail: 'expo-location (no garantiza GPS)', mocked: false };

async function queuedCapture(withPhoto = true) {
  const root = mkdtempSync(join(tmpdir(), 'tl-sync-'));
  const photo = join(root, 'cam.jpg');
  writeFileSync(photo, syntheticJpeg({ exif: true, seed: root }));
  const s = await LocalStore.open(nodePlatform(root), 'acc');
  await s.replaceDataset([PLOT]);
  const d = await s.createDraft(PLOT.id);
  await s.setLocation(d, SAMPLE);
  if (withPhoto) await s.addPhoto(d, photo, 'image/jpeg', null);
  const ops = await s.enqueue(d);
  return { s, ops };
}

function fake(handler: (ops: WireOperation[]) => ServerOutcome[] | Promise<ServerOutcome[]>, extra: Partial<SyncTransport> = {}): SyncTransport & { sent: WireOperation[][]; uploads: string[] } {
  const sent: WireOperation[][] = []; const uploads: string[] = [];
  return {
    sent, uploads,
    async push(_d, ops) { sent.push(ops); return handler(ops); },
    async upload(_d, op) { uploads.push(op); return { status: 'PENDING_SCAN' }; },
    async pull() { return { cursor: 'c1', full: true, changes: [PLOT], tombstones: [] }; },
    ...extra,
  };
}
const ok = (ops: WireOperation[]): ServerOutcome[] => ops.map((o) => ({ operation_id: o.operation_id, status: 'ACCEPTED', result: { plot_row_version: 4 } }));

describe('P0-024 motor de sincronización del dispositivo', () => {
  it('sin respuesta (timeout): las operaciones vuelven a PENDING con la misma identidad; el reintento envía los mismos ids y hash', async () => {
    const { s, ops } = await queuedCapture();
    let fail = true;
    const t = fake((o) => { if (fail) throw new TransportError('NETWORK', null, 'NETWORK', 'timeout'); return ok(o); });
    const r1 = await syncOnce(s, t, 'dev');
    expect(r1.stopped?.reason).toBe('OFFLINE');
    expect((await s.pendingBatch(10)).map((o) => o.operation_id)).toEqual(ops);
    fail = false;
    const r2 = await syncOnce(s, t, 'dev');
    expect(t.sent[1].map((o) => [o.operation_id, o.content_hash])).toEqual(t.sent[0].map((o) => [o.operation_id, o.content_hash]));
    expect(r2).toMatchObject({ synced: 2, still_pending: 0, uploads: 1, pulled: { full: true } });
  });

  it('solo un resultado confirmado retira la operación; sin resultado o pendiente de dependencia sigue en cola', async () => {
    const { s, ops } = await queuedCapture();
    const t = fake((o) => [{ operation_id: o[0].operation_id, status: 'ACCEPTED' }]); // el servidor no devolvió la 2.ª
    await syncOnce(s, t, 'dev');
    expect((await s.op(ops[0]))!.state).toBe('SYNCED');
    expect((await s.op(ops[1]))!).toMatchObject({ state: 'PENDING', last_error: expect.stringMatching(/SIN_RESULTADO/) });
    const t2 = fake((o) => o.map((x) => ({ operation_id: x.operation_id, status: 'DEPENDENCY_PENDING' as const })));
    await syncOnce(s, t2, 'dev');
    expect((await s.op(ops[1]))!.state).toBe('PENDING');
  });

  it('conflicto: se conserva la operación local y la resolución crea otra sobre la versión del servidor; la dependiente se reasigna', async () => {
    const { s, ops } = await queuedCapture();
    const t = fake((o) => o.map((x, i) => (i === 0 ? { operation_id: x.operation_id, status: 'CONFLICT' as const, error: { code: 'VERSION_CONFLICT', message: 'cambió', details: { server_row_version: 7 } } }
      : { operation_id: x.operation_id, status: 'REJECTED' as const, error: { code: 'DEPENDENCY_FAILED', message: 'previa en conflicto' } })));
    const r = await syncOnce(s, t, 'dev');
    expect(r).toMatchObject({ conflicts: 1, failed: 1 });
    const newId = await s.resolveConflict(ops[0], 7);
    const original = (await s.op(ops[0]))!;
    expect(original).toMatchObject({ state: 'CONFLICT', resolved_by: newId });
    const resolution = (await s.op(newId))!;
    expect(resolution).toMatchObject({ state: 'PENDING', base_version: 7, resolves: ops[0], payload: expect.objectContaining({ resolves_operation_id: ops[0] }) });
    expect(resolution.content_hash).not.toBe(original.content_hash);
    expect((await s.op(ops[1]))!.depends_on).toEqual([newId]);
    expect((await s.counts()).conflicts).toBe(0);
  });

  it('dispositivo revocado o sesión vencida: se detiene y conserva todo; prohibido por acceso queda pendiente y explicado', async () => {
    const { s, ops } = await queuedCapture();
    const r = await syncOnce(s, fake(() => { throw new TransportError('HTTP', 403, 'DEVICE_REVOKED', 'revocado'); }), 'dev');
    expect(r.stopped?.reason).toBe('DEVICE_REVOKED');
    expect((await s.pendingBatch(10)).map((o) => o.operation_id)).toEqual(ops);
    const r2 = await syncOnce(s, fake((o) => o.map((x) => ({ operation_id: x.operation_id, status: 'FORBIDDEN' as const, error: { code: 'RESOURCE_NOT_AVAILABLE', message: 'fuera de alcance' } }))), 'dev');
    expect(r2.still_pending).toBe(2);
    expect((await s.op(ops[0]))!.last_error).toMatch(/BLOQUEADO_POR_ACCESO/);
  });

  it('adjuntos: se suben solo tras aceptarse el registro; estado del archivo separado; fallo de subida conserva la foto', async () => {
    const { s, ops } = await queuedCapture();
    const t = fake((o) => o.map((x) => (x.operation_type === 'PLOT_PHOTO_ATTACH' ? { operation_id: x.operation_id, status: 'DEPENDENCY_PENDING' as const } : { operation_id: x.operation_id, status: 'ACCEPTED' as const })));
    await syncOnce(s, t, 'dev');
    expect(t.uploads).toEqual([]); // registro de la foto aún no aceptado
    let failUpload = true;
    const t2 = fake(ok, { async upload() { if (failUpload) throw new TransportError('HTTP', 422, 'ATTACHMENT_INTEGRITY_MISMATCH', 'incompleto'); return { status: 'AVAILABLE' }; } });
    const r = await syncOnce(s, t2, 'dev');
    expect(r.upload_errors).toBe(1);
    let [v] = await s.drafts();
    expect(v.operations.find((o) => o.operation_id === ops[1])!.state).toBe('SYNCED');
    expect(v.photos[0]).toMatchObject({ upload_state: 'LOCAL', server_detail: expect.stringMatching(/INTEGRITY/), file_present: true }); // «registro sincronizado; foto pendiente»
    failUpload = false;
    await syncOnce(s, t2, 'dev');
    [v] = await s.drafts();
    expect(v.photos[0]).toMatchObject({ upload_state: 'UPLOADED', server_status: 'AVAILABLE' });
  });

  it('estado del análisis: una foto subida con análisis pendiente se actualiza a disponible en una sincronización posterior', async () => {
    const { s } = await queuedCapture();
    let scan = 'PENDING_SCAN';
    const t = fake((o) => o.map((x) => ({ operation_id: x.operation_id, status: 'ACCEPTED' as const, result: x.operation_type === 'PLOT_PHOTO_ATTACH' ? { attachment: { status: scan } } : {} })),
      { async upload() { return { status: 'PENDING_SCAN', note: 'análisis pendiente' }; } });
    await syncOnce(s, t, 'dev');
    expect((await s.drafts())[0].photos[0]).toMatchObject({ upload_state: 'UPLOADED', server_status: 'PENDING_SCAN' });
    scan = 'AVAILABLE';
    await syncOnce(s, t, 'dev');
    expect((await s.drafts())[0].photos[0]).toMatchObject({ upload_state: 'UPLOADED', server_status: 'AVAILABLE' });
    const sentBefore = t.sent.length;
    await syncOnce(s, t, 'dev');
    expect(t.sent.length).toBe(sentBefore); // disponible: ya no se vuelve a consultar
  });

  it('pull: cursor caducado → descarga completa sin tocar operaciones pendientes; tombstones eliminan del dataset', async () => {
    const { s, ops } = await queuedCapture(false);
    let calls = 0;
    const t = fake(() => { throw new TransportError('NETWORK', null, 'NETWORK', 'sin red'); }, {
      async pull(_d, cursor) {
        calls += 1;
        if (cursor === 'viejo') throw new TransportError('HTTP', 410, 'CURSOR_EXPIRED', 'caducó');
        return { cursor: 'nuevo', full: cursor === null, changes: [], tombstones: [PLOT.id] };
      },
    });
    await s.setMeta('sync_cursor', 'viejo');
    // con la red caída el push se detiene antes del pull; simulamos solo el pull con un transporte sin operaciones
    const onlyPull = { ...t, push: async () => [] as ServerOutcome[] };
    await s.applyOutcomes([]);
    const r = await syncOnce(s, { ...onlyPull, push: async (_d: string, o: WireOperation[]) => o.map((x) => ({ operation_id: x.operation_id, status: 'TRANSIENT_ERROR' as const })) }, 'dev');
    expect(r.pulled).toMatchObject({ full: true, tombstones: 1 });
    expect(calls).toBe(2);
    expect(await s.meta('sync_cursor')).toBe('nuevo');
    expect(await s.plots()).toEqual([]);
    expect((await s.pendingBatch(10)).map((o) => o.operation_id)).toEqual(ops); // pendientes intactas
  });
});
