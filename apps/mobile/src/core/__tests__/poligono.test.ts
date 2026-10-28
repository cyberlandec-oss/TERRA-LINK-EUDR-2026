import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore, type DatasetPlot } from '../store';
import { captureGate, sessionLimitNotice, sessionMinutesLeft, type StoredSession } from '../session';
import { nodePlatform } from './node-platform';

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
    expect(v.operations.every((o) => o.base_version === null && /^[0-9a-f]{64}$/.test(o.content_hash))).toBe(true);
    await expect(s.addVertex(d, V(-0.9, -80.2, 3))).rejects.toThrow(/ya está en cola/);
    await s.close();
  });

  it('una captura sin ubicación, vértices ni foto sigue sin encolarse', async () => {
    const s = await open(); const d = await s.createDraft(PLOT.id);
    await expect(s.enqueue(d)).rejects.toThrow(/agrega ubicación, vértices o foto/);
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
