import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore, type DatasetPlot } from '../store';
import { accountKey, captureGate, CaptureBlockedError, type StoredSession } from '../session';
import { EncryptionRequiredError, isStorageFull, storageFullMessage, StorageFullError } from '../ports';
import { nodePlatform, syntheticJpeg } from './node-platform';

// Evidencia en Node (motor SQLite real + archivos reales). NO es evidencia de emulador ni de dispositivo Android.
const PLOT: DatasetPlot = { id: '00000000-0000-4000-8000-000000000001', plot_code: 'P-SINT-1', name: null, row_version: 3, status: 'ACTIVE', producer_id: '00000000-0000-4000-8000-0000000000a1', producer_code: 'PR-SINT', producer_display_name: 'Productor sintético', geometry_status: 'NONE' };
const SAMPLE = { latitude: -0.8479, longitude: -80.1601, accuracy_m: null, acquired_at: '2026-10-10T15:00:00.000Z', provider_detail: 'expo-location; proveedor del sistema (no garantiza GPS)', mocked: null };

function setup(opts: Parameters<typeof nodePlatform>[1] = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tl-mobile-'));
  const photo = join(root, 'camera-cache.jpg');
  writeFileSync(photo, syntheticJpeg({ exif: true, seed: root }));
  return { root, photo, p: nodePlatform(root, opts) };
}

describe('P0-023 almacén local (Node + SQLite real)', () => {
  it('encolar escribe borrador y operaciones reales en una transacción, con operation_id estable, hash y dependencias', async () => {
    const { p, photo } = setup();
    const s = await LocalStore.open(p, 'acc1');
    await s.replaceDataset([PLOT]);
    const d = await s.createDraft(PLOT.id);
    await s.setNote(d, 'Visita sintética');
    await s.setLocation(d, SAMPLE);
    await s.addPhoto(d, photo, 'image/jpeg', '2026-10-10T15:01:00.000Z');
    const ops = await s.enqueue(d);
    expect(ops).toHaveLength(2);
    const [view] = await s.drafts();
    expect(view.status).toBe('QUEUED');
    expect(view.operations.map((o) => o.operation_type)).toEqual(['PLOT_LOCATION_SAMPLE_CREATE', 'PLOT_PHOTO_ATTACH']);
    expect(view.operations[0]).toMatchObject({ base_version: 3, depends_on: [] });
    expect(view.operations[1]).toMatchObject({ depends_on: [ops[0]], attachment_refs: [view.photos[0].id], payload: { caption: 'Visita sintética' } });
    expect(view.operations.every((o) => /^[0-9a-f]{64}$/.test(o.content_hash) && o.state === 'PENDING')).toBe(true);
    await expect(s.setNote(d, 'cambio')).rejects.toThrow(/ya está en cola/);
    await expect(s.enqueue(d)).rejects.toThrow(/ya está en cola/);
    // una nota sola no tiene entidad en el servidor: no se encola (se dice por qué)
    const solo = await s.createDraft(PLOT.id);
    await s.setNote(solo, 'solo nota');
    await expect(s.enqueue(solo)).rejects.toThrow(/no tiene entidad en el servidor/);
    await s.close();
  });

  it('si falla cualquier escritura dentro de la transacción, no queda borrador encolado ni operaciones parciales', async () => {
    const { p, photo } = setup();
    const s = await LocalStore.open(p, 'acc1');
    await s.replaceDataset([PLOT]);
    const d = await s.createDraft(PLOT.id);
    await s.setLocation(d, SAMPLE);
    await s.addPhoto(d, photo, 'image/jpeg', null);
    const real = p.uuid;
    p.uuid = () => 'duplicado'; // la 2.ª operación choca con la clave primaria de la 1.ª
    await expect(s.enqueue(d)).rejects.toThrow();
    p.uuid = real;
    const [view] = await s.drafts();
    expect(view.status).toBe('DRAFT');
    expect(view.operations).toHaveLength(0);
    await s.close();
  });

  it('muestra de ubicación: hora de adquisición, precisión NULL conservada y procedencia sin atribuir GPS', async () => {
    const { p } = setup();
    const s = await LocalStore.open(p, 'acc1');
    await s.replaceDataset([PLOT]);
    const d = await s.createDraft(PLOT.id);
    await s.setLocation(d, SAMPLE);
    const [view] = await s.drafts();
    expect(view.location).toMatchObject({ accuracy_m: null, acquired_at: SAMPLE.acquired_at, source: 'DEVICE_LOCATION_SERVICE', mocked: null });
    expect(view.location!.provider_detail).toMatch(/no garantiza GPS/);
    await expect(s.setLocation(d, { ...SAMPLE, accuracy_m: -1 })).rejects.toThrow(/Precisión/);
    await s.close();
  });

  it('las fotos se guardan dentro de la base (no en archivos externos); la copia de la cámara se borra; con SHA-256', async () => {
    const { p, photo, root } = setup();
    const s = await LocalStore.open(p, 'acc1');
    await s.replaceDataset([PLOT]);
    const d = await s.createDraft(PLOT.id);
    const id = await s.addPhoto(d, photo, 'image/jpeg', null);
    expect(require('node:fs').existsSync(photo)).toBe(false); // copia temporal de la cámara eliminada
    expect(require('node:fs').readdirSync(join(root, 'files', 'accounts', 'acc1', 'attachments'))).toEqual([]); // sin archivo externo
    const [view] = await s.drafts();
    expect(view.photos[0]).toMatchObject({ storage: 'DB', file_present: true });
    expect(view.photos[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await s.attachmentBytes(id)).length).toBe(view.photos[0].size_bytes);
    await s.close();
  });

  it('D-41: la foto se guarda sin EXIF/XMP (coordenadas, dispositivo); el hash corresponde a los bytes sin metadatos', async () => {
    const { p, photo } = setup();
    const s = await LocalStore.open(p, 'acc1');
    await s.replaceDataset([PLOT]);
    const d = await s.createDraft(PLOT.id);
    const original = require('node:fs').readFileSync(photo) as Buffer;
    expect(original.includes(Buffer.from('TelefonoSintetico'))).toBe(true);
    const id = await s.addPhoto(d, photo, 'image/jpeg', null);
    const stored = Buffer.from(await s.attachmentBytes(id));
    expect(stored.includes(Buffer.from('xmpmeta'))).toBe(false);
    expect(stored.includes(Buffer.from('TelefonoSintetico'))).toBe(false);
    expect(stored.includes(Buffer.from('datos-sinteticos'))).toBe(true); // la imagen se conserva
    expect((await s.drafts())[0].photos[0].sha256).toBe(require('node:crypto').createHash('sha256').update(stored).digest('hex'));
    await s.close();
  });

  it('reabrir conserva borradores, cola y fotos; una operación interrumpida conserva su identidad y vuelve a PENDING', async () => {
    const { p, photo, root } = setup();
    let s = await LocalStore.open(p, 'acc1');
    await s.replaceDataset([PLOT]);
    const d1 = await s.createDraft(PLOT.id);
    await s.addPhoto(d1, photo, 'image/jpeg', null);
    await s.setNote(d1, 'Borrador sin encolar');
    const d2 = await s.createDraft(PLOT.id);
    await s.setLocation(d2, SAMPLE);
    const ops = await s.enqueue(d2);
    await s.markUploadingForTest(ops[0]);
    await s.close(); // «cierre» de la app
    s = await LocalStore.open(nodePlatform(root), 'acc1');
    expect((await s.recover()).recovered_operations).toEqual([ops[0]]);
    const views = await s.drafts();
    expect(views.find((v) => v.id === d1)).toMatchObject({ status: 'DRAFT', note: 'Borrador sin encolar', photos: [expect.objectContaining({ file_present: true })] });
    expect(views.find((v) => v.id === d2)!.operations[0]).toMatchObject({ operation_id: ops[0], state: 'PENDING', recovered_count: 1 });
    await s.close();
  });

  it('almacenamiento lleno y escritura interrumpida: error explicado, borrador conservado, sin registro roto', async () => {
    let fail = true;
    const { p, photo, root } = setup({ failWriteWith: () => (fail ? Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }) : null) });
    const s = await LocalStore.open(p, 'acc1');
    await s.replaceDataset([PLOT]);
    const d = await s.createDraft(PLOT.id);
    await s.setNote(d, 'Conservar');
    const err = await s.addPhoto(d, photo, 'image/jpeg', null).catch((e) => e);
    expect(isStorageFull(err)).toBe(true);
    expect(err.message).toMatch(/borrador y las capturas anteriores se conservan/);
    fail = false;
    expect((await s.drafts())[0]).toMatchObject({ note: 'Conservar', photos: [] });
    const low = await LocalStore.open(nodePlatform(root, { free: () => 1024 }), 'acc1');
    expect(isStorageFull(await low.addPhoto(d, photo, 'image/jpeg', null).catch((e) => e))).toBe(true);
    await low.close();
    require('node:fs').writeFileSync(join(root, 'files', 'accounts', 'acc1', 'incoming', 'x.jpg.part'), 'parcial');
    require('node:fs').writeFileSync(join(root, 'files', 'accounts', 'acc1', 'attachments', 'huerfana.jpg'), 'sin registro');
    const report = await s.recover();
    expect(report.incomplete_temp_files).toEqual(['x.jpg.part']);
    expect(report.orphan_files).toEqual(['huerfana.jpg']);
    expect((await s.drafts())[0].photos).toEqual([]);
    await s.close();
  });

  it('separación por cuenta y organización: otra cuenta no ve los datos; cerrar sesión no destruye lo pendiente', async () => {
    const { p, photo } = setup();
    const kA = await accountKey(p.sha256, 'user-A', 'org-1');
    const kB = await accountKey(p.sha256, 'user-B', 'org-1');
    const kA2 = await accountKey(p.sha256, 'user-A', 'org-2');
    expect(new Set([kA, kB, kA2]).size).toBe(3);
    const a = await LocalStore.open(p, kA);
    await a.replaceDataset([PLOT]);
    const d = await a.createDraft(PLOT.id);
    await a.addPhoto(d, photo, 'image/jpeg', null);
    await a.close();
    const b = await LocalStore.open(p, kB);
    expect(await b.drafts()).toEqual([]);
    expect(await b.plots()).toEqual([]);
    await b.close();
    const again = await LocalStore.open(p, kA);
    expect(await again.drafts()).toHaveLength(1);
    await again.close();
  });

  it('cifrado: el build nativo no abre (ni escribe) un almacén sin cifrar; Expo Go queda marcado como no cifrado', async () => {
    const { root } = setup();
    await expect(LocalStore.open(nodePlatform(root, { environment: 'NATIVE_BUILD' }), 'acc-native')).rejects.toBeInstanceOf(EncryptionRequiredError);
    expect(require('node:fs').readdirSync(join(root, 'db')).filter((f: string) => f.startsWith('tl-acc-native') && !f.endsWith('-shm') && !f.endsWith('-wal'))).toEqual(['tl-acc-native.db']); // archivo abierto y cerrado, sin esquema ni datos
    const s = await LocalStore.open(nodePlatform(root, { environment: 'EXPO_GO_SYNTHETIC' }), 'acc-go');
    expect(s.encrypted).toBe(false);
    await s.close();
  });
});

describe('P0-023 sesión: vence con el token del servidor; bloquear no borra', () => {
  const t0 = new Date('2026-10-10T12:00:00Z');
  const sess = (over: Partial<StoredSession> = {}): StoredSession => ({ user_id: 'u', email: 'tecnico@x', token_expires_at: '2026-10-10T13:00:00Z', last_online_auth_at: '2026-10-10T11:59:00Z', last_seen_at: '2026-10-10T12:00:00Z',
    organizations: [{ organization_id: 'o1', name: 'DEMO Org', status: 'ACTIVE', roles: ['FIELD_TECHNICIAN'], permissions: ['plot:update_assigned'] }], ...over });

  it('vigente → permitido; vencido el token → bloqueado (sin ventana extra); reloj atrasado, sin permiso u otra organización → bloqueado', () => {
    expect(captureGate(sess(), 'o1', t0)).toMatchObject({ allowed: true, until: '2026-10-10T13:00:00Z' });
    expect(captureGate(sess(), 'o1', new Date('2026-10-10T13:00:01Z'))).toMatchObject({ allowed: false, reason: 'SESSION_EXPIRED' });
    expect(captureGate(sess(), 'o1', new Date('2026-10-10T11:00:00Z'))).toMatchObject({ allowed: false, reason: 'CLOCK_BACKWARDS' });
    expect(captureGate(sess({ organizations: [{ ...sess().organizations[0], permissions: ['plot:read'] }] }), 'o1', t0)).toMatchObject({ allowed: false, reason: 'NO_PERMISSION' });
    expect(captureGate(sess(), 'otra', t0)).toMatchObject({ allowed: false, reason: 'NO_PERMISSION' });
    expect(captureGate(null, 'o1', t0)).toMatchObject({ allowed: false, reason: 'NO_SESSION' });
  });

  it('al vencer (también tras reiniciar) se bloquean nuevas escrituras y lo pendiente sigue intacto y legible', async () => {
    let now = t0;
    const { root, photo } = setup();
    const s0 = sess();
    let store = await LocalStore.open(nodePlatform(root, { clock: () => now }), 'acc1', () => captureGate(s0, 'o1', now));
    await store.replaceDataset([PLOT]);
    const d = await store.createDraft(PLOT.id);
    await store.setLocation(d, SAMPLE);
    await store.addPhoto(d, photo, 'image/jpeg', null);
    const queued = await store.createDraft(PLOT.id);
    await store.setLocation(queued, SAMPLE);
    const ops = await store.enqueue(queued);
    await store.close();
    now = new Date('2026-10-10T14:00:00Z'); // vencido + «reinicio» (nueva instancia)
    store = await LocalStore.open(nodePlatform(root, { clock: () => now }), 'acc1', () => captureGate(s0, 'o1', now));
    await store.recover();
    await expect(store.createDraft(PLOT.id)).rejects.toBeInstanceOf(CaptureBlockedError);
    await expect(store.setNote(d, 'x')).rejects.toBeInstanceOf(CaptureBlockedError);
    await expect(store.enqueue(d)).rejects.toThrow(/venció/);
    const views = await store.drafts();
    expect(views).toHaveLength(2);
    expect(views.find((v) => v.id === d)).toMatchObject({ status: 'DRAFT', photos: [expect.objectContaining({ file_present: true })] });
    expect(views.find((v) => v.id === queued)!.operations.map((o) => o.operation_id)).toEqual(ops);
    // reloj atrasado tras reiniciar: también bloquea y no borra
    now = new Date('2026-10-09T12:00:00Z');
    await expect(store.createDraft(PLOT.id)).rejects.toThrow(/retrocedió/);
    expect(await store.drafts()).toHaveLength(2);
    await store.close();
    rmSync(root, { recursive: true, force: true });
  });
});

describe('almacenamiento lleno: mensaje al usuario', () => {
  it('traduce el error técnico de SQLite y conserva el mensaje propio de la app', () => {
    const raw = new Error("Call to function 'NativeStatement.finalizeAsync' has been rejected. Caused by: Error code 13: database or disk is full");
    expect(isStorageFull(raw)).toBe(true);
    expect(storageFullMessage(raw)).toMatch(/^No hay espacio libre en el dispositivo/);
    expect(storageFullMessage(raw)).not.toMatch(/database|finalizeAsync/);
    expect(storageFullMessage(new StorageFullError('propio'))).toBe('propio');
  });
});
