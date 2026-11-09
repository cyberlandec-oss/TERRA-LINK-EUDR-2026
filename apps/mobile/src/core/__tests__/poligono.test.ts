import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore, type DatasetPlot, type ServerOutcome } from '../store';
import { syncOnce, type SyncTransport, type WireOperation } from '../sync';
import { captureGate, sessionLimitNotice, sessionMinutesLeft, type StoredSession } from '../session';
import { nodePlatform, syntheticJpeg } from './node-platform';

// D (móvil): vértices de polígono en el dispositivo, aviso del límite de sesión y alcance propio del Productor.
// Evidencia en Node (SQLite real). NO es evidencia de emulador ni de teléfono Android.
const PLOT: DatasetPlot = { id: '00000000-0000-4000-8000-000000000001', plot_code: 'P-SINT-1', name: null, row_version: 3, status: 'ACTIVE', producer_id: '00000000-0000-4000-8000-0000000000a1', producer_code: 'PR-1', producer_display_name: 'Finca sintética', geometry_status: null } as DatasetPlot;
const V = (lat: number, lon: number, acc: number | null) => ({ latitude: lat, longitude: lon, accuracy_m: acc, acquired_at: '2026-10-27T15:00:00.000Z', provider_detail: 'expo-location; proveedor del sistema (no garantiza GPS)', mocked: false });

describe('D polígono por vértices en el dispositivo', () => {
  const open = async () => { const s = await LocalStore.open(nodePlatform(mkdtempSync(join(tmpdir(), 'tl-poly-')), {}), 'acc1'); await s.replaceDataset([PLOT]); return s; };

  it('cada vértice conserva su precisión (incluida NULL) y deshacer quita solo el último', async () => {
    const s = await open(); const d = await s.createDraft(PLOT.id);
    expect(await s.addVertex(d, V(-0.847, -80.160, 5))).toBe(1);
    expect(await s.addVertex(d, V(-0.847, -80.159, null))).toBe(2);
    expect(await s.addVertex(d, V(-0.848, -80.1595, 12))).toBe(3);
    await s.undoVertex(d);
    const [v] = await s.drafts();
    expect(v.vertices.map((x) => [x.seq, x.accuracy_m])).toEqual([[1, 5], [2, null]]);
    await expect(s.addVertex(d, V(95, 0, 1))).rejects.toThrow(/Coordenadas no válidas/);
    await s.close();
  });

  it('encolar genera un vértice por operación, encadenados en orden, sin base de versión y sin confirmar nada; las fotos dependen del último', async () => {
    const s = await open(); const d = await s.createDraft(PLOT.id);
    await s.addVertex(d, V(-0.847, -80.160, 5)); await s.addVertex(d, V(-0.847, -80.159, 7)); await s.addVertex(d, V(-0.848, -80.1595, 9));
    const ops = await s.enqueue(d);
    const [v] = await s.drafts();
    expect(v.operations.map((o) => o.operation_type)).toEqual(Array(3).fill('PLOT_POLYGON_VERTEX_ADD'));
    expect(v.operations[0].depends_on).toEqual([]);
    expect(v.operations[1].depends_on).toEqual([ops[0]]);
    expect(v.operations[2].depends_on).toEqual([ops[1]]);
    expect(v.operations.map((o) => o.base_version)).toEqual([3, null, null]); // solo el primer vértice lleva la versión de la parcela conocida
    expect(v.operations.map((o) => [o.payload.capture_id, o.payload.vertex_seq])).toEqual([[d, 1], [d, 2], [d, 3]]);
    expect(v.operations.every((o) => /^[0-9a-f]{64}$/.test(o.content_hash))).toBe(true);
    await expect(s.addVertex(d, V(-0.9, -80.2, 3))).rejects.toThrow(/ya está en cola/);
    await s.close();
  });

  /** Servidor SIMULADO con las reglas reales relevantes: dependencias, hash por identificador, idempotencia, conflicto del primer vértice y borrador abierto en la web. */
  function servidor(opts: { webDraftOpen: boolean }) {
    const known = new Map<string, { hash: string; status: string }>();
    const vertices: string[] = [];
    const plotVersion = 3;
    let webDraftOpen = opts.webDraftOpen;
    const t: SyncTransport & { sent: WireOperation[][]; closeWebDraft: () => void; vertices: string[]; known: typeof known } = {
      sent: [], vertices, known, closeWebDraft: () => { webDraftOpen = false; },
      async push(_d, ops) {
        t.sent.push(ops);
        return ops.map((o): ServerOutcome => {
          const prior = known.get(o.operation_id);
          if (prior) {
            if (prior.hash !== o.content_hash) return { operation_id: o.operation_id, status: 'REJECTED', error: { code: 'OPERATION_ID_REUSED', message: 'mismo identificador con otro contenido' } };
            return prior.status === 'ACCEPTED' ? { operation_id: o.operation_id, status: 'DUPLICATE' } : { operation_id: o.operation_id, status: prior.status as ServerOutcome['status'], error: { code: 'PREVIOUS', message: 'ya conocida' } };
          }
          const deps = o.depends_on.map((d) => known.get(d));
          if (deps.some((d) => !d)) return { operation_id: o.operation_id, status: 'DEPENDENCY_PENDING' };
          let status: string; let error: ServerOutcome['error'];
          if (deps.some((d) => d!.status !== 'ACCEPTED')) { status = 'REJECTED'; error = { code: 'DEPENDENCY_FAILED', message: 'previa en conflicto' }; }
          else if (o.operation_type === 'PLOT_POLYGON_VERTEX_ADD' && (o.payload as { vertex_seq: number }).vertex_seq === 1 && webDraftOpen) {
            status = 'CONFLICT'; error = { code: 'DRAFT_OPEN_FROM_OTHER_SOURCE', message: 'borrador de la web', details: { server_row_version: plotVersion, resolution: 'cierra el borrador en la web' } };
          } else { status = 'ACCEPTED'; if (o.operation_type === 'PLOT_POLYGON_VERTEX_ADD') vertices.push(o.operation_id); }
          known.set(o.operation_id, { hash: o.content_hash, status });
          return { operation_id: o.operation_id, status: status as ServerOutcome['status'], error, result: status === 'ACCEPTED' ? { plot_row_version: plotVersion } : null };
        });
      },
      async upload() { return { status: 'PENDING_SCAN' }; },
      async pull() { return { cursor: 'c', full: true, changes: [PLOT], tombstones: [] }; },
    };
    return t;
  }

  it('recorrido completo: punto + 3 vértices + foto; conflicto del primer vértice → resolución → TODA la cadena llega una sola vez; originales y resoluciones conservan su historial', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tl-poly-'));
    const photo = join(root, 'cam.jpg'); writeFileSync(photo, syntheticJpeg({ exif: true, seed: root }));
    const s = await LocalStore.open(nodePlatform(root, {}), 'acc1'); await s.replaceDataset([PLOT]);
    const d = await s.createDraft(PLOT.id);
    await s.setLocation(d, V(-0.8479, -80.1601, 8));
    await s.addVertex(d, V(-0.847, -80.160, 5)); await s.addVertex(d, V(-0.847, -80.159, 7)); await s.addVertex(d, V(-0.848, -80.1595, 9));
    await s.addPhoto(d, photo, 'image/jpeg', null);
    const [loc, v1, v2, v3, ph] = await s.enqueue(d);
    const srv = servidor({ webDraftOpen: true });
    const r1 = await syncOnce(s, srv, 'dev');
    expect(r1).toMatchObject({ conflicts: 1 });
    const st = async () => Object.fromEntries((await s.drafts())[0].operations.map((o) => [o.operation_id, o.state]));
    expect(await st()).toMatchObject({ [loc]: 'SYNCED', [v1]: 'CONFLICT', [v2]: 'FAILED', [v3]: 'FAILED', [ph]: 'FAILED' });
    expect(srv.vertices).toHaveLength(0);
    // sin resolver, otra sincronización no reenvía lo rechazado
    await syncOnce(s, srv, 'dev');
    expect(srv.vertices).toHaveLength(0);
    // la web cierra su borrador; la persona reenvía sobre la versión actual
    srv.closeWebDraft();
    const nuevo = await s.resolveConflict(v1, 3);
    const mid = (await s.drafts())[0].operations;
    const sust = mid.filter((o) => o.resolves !== null);
    expect(sust.map((o) => o.operation_type)).toEqual(['PLOT_POLYGON_VERTEX_ADD', 'PLOT_POLYGON_VERTEX_ADD', 'PLOT_POLYGON_VERTEX_ADD', 'PLOT_PHOTO_ATTACH']);
    expect(sust.map((o) => o.resolves)).toEqual([v1, v2, v3, ph]);
    expect(new Set(sust.map((o) => o.operation_id)).size).toBe(4);
    for (const orig of [v1, v2, v3, ph]) expect(mid.find((o) => o.operation_id === orig)!.resolved_by).not.toBeNull();
    expect(sust[0].operation_id).toBe(nuevo);
    expect(sust[1].depends_on).toEqual([sust[0].operation_id]);
    expect(sust[3].depends_on).toEqual([sust[2].operation_id]);
    const r2 = await syncOnce(s, srv, 'dev');
    expect(r2).toMatchObject({ failed: 0, conflicts: 0, still_pending: 0 });
    expect(srv.vertices).toHaveLength(3);
    expect(srv.vertices).toEqual(sust.slice(0, 3).map((o) => o.operation_id));
    const enviadas = srv.sent.length;
    await syncOnce(s, srv, 'dev');
    expect(srv.vertices).toHaveLength(3);
    // lo único que puede reenviarse es la consulta de estado del análisis de la foto ya subida (DUPLICATE); ningún vértice
    const nuevas = srv.sent.slice(enviadas).flat();
    expect(nuevas.every((o) => o.operation_type === 'PLOT_PHOTO_ATTACH')).toBe(true);
    expect((await s.counts()).failed).toBe(0);
    await s.close();
  });

  it('conflictos consecutivos: la sustituta vuelve a chocar y las pendientes (de seq menor) se re-apuntan igualmente; al final toda la cadena llega una sola vez', async () => {
    const s = await open(); const d = await s.createDraft(PLOT.id);
    await s.addVertex(d, V(-0.847, -80.160, 5)); await s.addVertex(d, V(-0.847, -80.159, 7)); await s.addVertex(d, V(-0.848, -80.1595, 9));
    const [v1, v2, v3] = await s.enqueue(d);
    // solo el primero se envió y chocó; v2 y v3 siguen PENDING sin envíos (nunca los conoció el servidor)
    await s.markUploadingForTest(v1);
    await s.applyOutcomes([{ operation_id: v1, status: 'CONFLICT', error: { code: 'DRAFT_OPEN_FROM_OTHER_SOURCE', message: 'x', details: { server_row_version: 3 } } }]);
    const r1 = await s.resolveConflict(v1, 3);
    let ops = (await s.drafts())[0].operations;
    expect(ops.find((o) => o.operation_id === v2)!.depends_on).toEqual([r1]); // re-apuntada en su sitio (el servidor no la conocía)
    expect(ops.find((o) => o.operation_id === v2)!.seq).toBeGreaterThan(ops.find((o) => o.operation_id === r1)!.seq); // y va DESPUÉS de aquella de la que depende
    // la sustituta vuelve a chocar (la web sigue con su borrador)
    await s.markUploadingForTest(r1);
    await s.applyOutcomes([{ operation_id: r1, status: 'CONFLICT', error: { code: 'DRAFT_OPEN_FROM_OTHER_SOURCE', message: 'x', details: { server_row_version: 3 } } }]);
    const r2 = await s.resolveConflict(r1, 3);
    ops = (await s.drafts())[0].operations;
    expect(ops.find((o) => o.operation_id === v2)!.depends_on).toEqual([r2]);
    expect(ops.find((o) => o.operation_id === v3)!.depends_on).toEqual([v2]);
    expect(ops.find((o) => o.operation_id === r1)).toMatchObject({ state: 'CONFLICT', resolved_by: r2 }); // historial intacto
    const srv = servidor({ webDraftOpen: false });
    const sync = await syncOnce(s, srv, 'dev');
    expect(sync).toMatchObject({ failed: 0, conflicts: 0, still_pending: 0 });
    expect(srv.vertices).toEqual([r2, v2, v3]); // una sola vez y en orden: la 2.ª sustituta, y las dos que nunca se habían enviado
    await s.close();
  });

  it('si hay una operación enviada sin respuesta, no se sustituye nada: primero se reintenta con su identificador original', async () => {
    const s = await open(); const d = await s.createDraft(PLOT.id);
    await s.addVertex(d, V(-0.847, -80.160, 5)); await s.addVertex(d, V(-0.847, -80.159, 7));
    const [o1, o2] = await s.enqueue(d);
    await s.markUploadingForTest(o1);
    await s.applyOutcomes([{ operation_id: o1, status: 'CONFLICT', error: { code: 'DRAFT_OPEN_FROM_OTHER_SOURCE', message: 'x', details: { server_row_version: 3 } } }]);
    await s.markUploadingForTest(o2);
    await expect(s.resolveConflict(o1, 3)).rejects.toThrow(/Sincroniza primero/);
    const [v] = await s.drafts();
    expect(v.operations.every((o) => o.resolved_by === null && o.resolves === null)).toBe(true);
    await s.close();
  });

  it('una captura sin ubicación, vértices ni foto sigue sin encolarse', async () => {
    const s = await open(); const d = await s.createDraft(PLOT.id);
    await expect(s.enqueue(d)).rejects.toThrow(/agrega ubicación, vértices, foto o un soporte/);
    await s.close();
  });
});

describe('D límite de sesión y alcance propio', () => {
  const sess = (perms: string[]): StoredSession => ({ user_id: 'u', email: 'x@y', token_expires_at: '2026-10-27T13:00:00.000Z', last_online_auth_at: '2026-10-27T12:00:00.000Z', last_seen_at: '2026-10-27T12:00:00.000Z',
    organizations: [{ organization_id: 'o1', name: 'Org', status: 'ACTIVE', roles: ['PRODUCER'], permissions: perms }] });
  const t = (iso: string) => new Date(iso);

  it('el aviso aparece solo cuando quedan 10 minutos o menos y desaparece al vencer', () => {
    expect(sessionLimitNotice('2026-10-27T13:00:00.000Z', t('2026-10-27T12:00:00.000Z'))).toBeNull();
    expect(sessionLimitNotice('2026-10-27T13:00:00.000Z', t('2026-10-27T12:50:00.000Z'))).toMatch(/Quedan 10 min/);
    expect(sessionLimitNotice('2026-10-27T13:00:00.000Z', t('2026-10-27T12:59:30.000Z'))).toMatch(/menos de 1 minuto/);
    expect(sessionLimitNotice('2026-10-27T13:00:00.000Z', t('2026-10-27T13:00:00.000Z'))).toBeNull();
    expect(sessionMinutesLeft('2026-10-27T13:00:00.000Z', t('2026-10-27T14:00:00.000Z'))).toBe(0);
  });

  it('el Productor con plot:update_own puede capturar; sin ese permiso o sin ninguno de captura, no', () => {
    expect(captureGate(sess(['plot:update_own']), 'o1', t('2026-10-27T12:10:00.000Z'))).toMatchObject({ allowed: true });
    expect(captureGate(sess(['plot:read_own']), 'o1', t('2026-10-27T12:10:00.000Z'))).toMatchObject({ allowed: false, reason: 'NO_PERMISSION' });
  });
});
