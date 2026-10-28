import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore, type DatasetPlot, type ServerOutcome } from '../store';
import { syncOnce, type SyncTransport, type WireOperation } from '../sync';
import { nodePlatform } from './node-platform';

// D — Altas sin conexión: productor local → parcela local → ubicación y vértices, con referencias locales.
// Node + SQLite real + servidor SIMULADO con las reglas relevantes. NO es evidencia de emulador ni de teléfono Android.
const SERVER_PLOT: DatasetPlot = { id: '00000000-0000-4000-8000-0000000000aa', plot_code: 'P-EXISTE', name: null, row_version: 3, status: 'ACTIVE', producer_id: '00000000-0000-4000-8000-0000000000b1', producer_code: 'PR-EX', producer_display_name: 'Productor del servidor', geometry_status: null } as DatasetPlot;
const V = (lat: number, lon: number) => ({ latitude: lat, longitude: lon, accuracy_m: 6, acquired_at: '2026-10-28T12:00:00.000Z', provider_detail: 'expo-location; proveedor del sistema (no garantiza GPS)', mocked: false });

/** Servidor simulado: dependencias, hash por identificador, referencias locales (solo por correspondencia), códigos de parcela únicos. */
function servidor(opts: { existingCodes?: string[] } = {}) {
  const known = new Map<string, { hash: string; status: string }>();
  const refs = new Map<string, string>(); // referencia local -> id definitivo
  const codes = new Set(opts.existingCodes ?? []);
  const created: string[] = [];
  const located: string[] = [];
  const sent: WireOperation[][] = [];
  let n = 0;
  const t: SyncTransport & { refs: typeof refs; created: string[]; located: string[]; sent: typeof sent } = {
    refs, created, located, sent,
    async push(_d, ops) {
      sent.push(ops);
      return ops.map((o): ServerOutcome => {
        const prior = known.get(o.operation_id);
        if (prior) {
          if (prior.hash !== o.content_hash) return { operation_id: o.operation_id, status: 'REJECTED', error: { code: 'OPERATION_ID_REUSED', message: 'otro contenido' } };
          return prior.status === 'ACCEPTED' ? { operation_id: o.operation_id, status: 'DUPLICATE' } : { operation_id: o.operation_id, status: prior.status as ServerOutcome['status'], error: { code: 'PREVIOUS', message: 'ya conocida' } };
        }
        const deps = o.depends_on.map((d) => known.get(d));
        if (deps.some((d) => !d)) return { operation_id: o.operation_id, status: 'DEPENDENCY_PENDING' };
        const fail = (code: string): ServerOutcome => { known.set(o.operation_id, { hash: o.content_hash, status: 'REJECTED' }); return { operation_id: o.operation_id, status: 'REJECTED', error: { code, message: code } }; };
        if (deps.some((d) => d!.status !== 'ACCEPTED')) return fail('DEPENDENCY_FAILED');
        const p = o.payload as Record<string, unknown>;
        const accept = (result: Record<string, unknown>): ServerOutcome => { known.set(o.operation_id, { hash: o.content_hash, status: 'ACCEPTED' }); return { operation_id: o.operation_id, status: 'ACCEPTED', result }; };
        if (o.operation_type === 'PRODUCER_CREATE') { const id = `srv-prod-${++n}`; refs.set(o.entity_id, id); created.push(`P:${p.producer_code}`); return accept({ entity: 'PRODUCER', server_id: id, local_ref: o.entity_id }); }
        if (o.operation_type === 'PLOT_CREATE') {
          if (codes.has(p.plot_code as string)) return fail('PLOT_CODE_TAKEN');
          if (p.producer_local_ref && !refs.has(p.producer_local_ref as string)) return { operation_id: o.operation_id, status: 'DEPENDENCY_PENDING' };
          codes.add(p.plot_code as string); const id = `srv-plot-${++n}`; refs.set(o.entity_id, id); created.push(`Q:${p.plot_code}`);
          return accept({ entity: 'PLOT', server_id: id, local_ref: o.entity_id, plot_row_version: 1 });
        }
        if (p.plot_local_ref !== undefined && !refs.has(p.plot_local_ref as string)) return { operation_id: o.operation_id, status: 'DEPENDENCY_PENDING' };
        if (o.operation_type === 'PLOT_LOCATION_SAMPLE_CREATE' || o.operation_type === 'PLOT_POLYGON_VERTEX_ADD') located.push(o.operation_id);
        return accept({ plot_row_version: 2 });
      });
    },
    async upload() { return { status: 'PENDING_SCAN' }; },
    async pull() { return { cursor: 'c', full: true, changes: [SERVER_PLOT], tombstones: [] }; },
  };
  return t;
}

describe('D altas sin conexión (móvil)', () => {
  const setup = async () => { const root = mkdtempSync(join(tmpdir(), 'tl-altas-')); const p = nodePlatform(root, {}); const s = await LocalStore.open(p, 'acc1'); await s.replaceDataset([SERVER_PLOT]); return { root, p, s }; };

  it('validación: código, nombre o razón social, cultivo y productor existente; nada se completa por su cuenta', async () => {
    const { s } = await setup();
    await expect(s.createLocalProducer({ producer_code: 'a b', first_name: 'Ana', last_name: 'Campo' })).rejects.toThrow(/Código de productor/);
    await expect(s.createLocalProducer({ producer_code: 'OK-1', first_name: 'Ana' })).rejects.toThrow(/nombre y apellido, o la razón social/);
    const pid = await s.createLocalProducer({ producer_code: 'OK-1', legal_name: 'Finca Sin Apellido' });
    await expect(s.createLocalPlot({ producer: { kind: 'LOCAL', id: 'no-existe' }, plot_code: 'P1', crop: 'Cacao' })).rejects.toThrow(/no existe entre las altas locales/);
    await expect(s.createLocalPlot({ producer: { kind: 'SERVER', id: 'no-esta' }, plot_code: 'P1', crop: 'Cacao' })).rejects.toThrow(/no está entre los datos descargados/);
    await expect(s.createLocalPlot({ producer: { kind: 'LOCAL', id: pid }, plot_code: 'P1', crop: '' })).rejects.toThrow(/cultivo/);
    await s.close();
  });

  it('productor local → parcela local → punto y vértices: la cola guarda las dependencias y las referencias locales, y todo sobrevive a cerrar y reabrir', async () => {
    const { p, s } = await setup();
    const prod = await s.createLocalProducer({ producer_code: 'MOV-1', first_name: 'Ana', last_name: 'Campo', community: 'La Esperanza' });
    const plot = await s.createLocalPlot({ producer: { kind: 'LOCAL', id: prod }, plot_code: 'MOV-1-P1', crop: 'Cacao', name: 'Lote nuevo' });
    await expect(s.enqueueLocalPlot(plot)).rejects.toThrow(/Primero pon en cola el alta del productor/); // dependencia explícita
    const opP = await s.enqueueLocalProducer(prod);
    const opQ = await s.enqueueLocalPlot(plot);
    const d = await s.createDraft(plot); // captura sobre una parcela que todavía no existe en el servidor
    await s.setLocation(d, V(-0.85, -80.16)); await s.addVertex(d, V(-0.85, -80.16)); await s.addVertex(d, V(-0.8503, -80.1597)); await s.addVertex(d, V(-0.8506, -80.1601));
    const [loc, v1, v2, v3] = await s.enqueue(d);
    await s.close();
    // cerrar la app y volver a abrirla: nada se pierde
    const s2 = await LocalStore.open(p, 'acc1');
    const ops = (await s2.pendingBatch(50));
    const byId = Object.fromEntries(ops.map((o) => [o.operation_id, o]));
    expect(ops.map((o) => o.operation_type)).toEqual(['PRODUCER_CREATE', 'PLOT_CREATE', 'PLOT_LOCATION_SAMPLE_CREATE', 'PLOT_POLYGON_VERTEX_ADD', 'PLOT_POLYGON_VERTEX_ADD', 'PLOT_POLYGON_VERTEX_ADD']);
    expect(byId[opQ]).toMatchObject({ depends_on: [opP], entity_id: plot, payload: expect.objectContaining({ producer_local_ref: prod }) });
    expect(byId[loc]).toMatchObject({ depends_on: [opQ], payload: expect.objectContaining({ plot_local_ref: plot }) });
    expect(byId[loc].payload.plot_id).toBeUndefined(); // nunca se cita por un id inventado
    expect(byId[v1].depends_on).toEqual([loc]); expect(byId[v3].depends_on).toEqual([v2]);
    expect((await s2.localPlots())[0]).toMatchObject({ status: 'QUEUED', state: 'PENDING', server_id: null });
    await expect(s2.enqueueLocalProducer(prod)).rejects.toThrow(/ya está en cola/);
    await s2.close();
  });

  it('sincronizar en dependencia: se recuperan los identificadores definitivos, cada alta y cada captura llegan una sola vez, y reenviar no duplica', async () => {
    const { s } = await setup();
    const prod = await s.createLocalProducer({ producer_code: 'MOV-2', first_name: 'Luis', last_name: 'Mera' });
    const plot = await s.createLocalPlot({ producer: { kind: 'LOCAL', id: prod }, plot_code: 'MOV-2-P1', crop: 'Cacao' });
    await s.enqueueLocalProducer(prod); await s.enqueueLocalPlot(plot);
    const d = await s.createDraft(plot); await s.setLocation(d, V(-0.9, -80.2)); await s.addVertex(d, V(-0.9, -80.2));
    await s.enqueue(d);
    const srv = servidor();
    const r = await syncOnce(s, srv, 'dev');
    expect(r).toMatchObject({ failed: 0, conflicts: 0, still_pending: 0, synced: 4 });
    expect(srv.created).toEqual(['P:MOV-2', 'Q:MOV-2-P1']);
    expect(srv.located).toHaveLength(2);
    expect((await s.localProducers())[0]).toMatchObject({ state: 'SYNCED', server_id: srv.refs.get(prod) });
    expect((await s.localPlots())[0]).toMatchObject({ state: 'SYNCED', server_id: srv.refs.get(plot) });
    await syncOnce(s, srv, 'dev'); // reintento (p. ej. tras una respuesta perdida): nada se vuelve a crear
    expect(srv.created).toHaveLength(2); expect(srv.located).toHaveLength(2);
    await s.close();
  });

  it('alta rechazada (código repetido): se conserva el historial, se corrige con la MISMA referencia local y la captura dependiente se recupera sin duplicar', async () => {
    const { s } = await setup();
    const prod = await s.createLocalProducer({ producer_code: 'MOV-3', first_name: 'Rosa', last_name: 'Cedeño' });
    const plot = await s.createLocalPlot({ producer: { kind: 'LOCAL', id: prod }, plot_code: 'REPETIDO', crop: 'Cacao' });
    await s.enqueueLocalProducer(prod); const opQ = await s.enqueueLocalPlot(plot);
    const d = await s.createDraft(plot); await s.setLocation(d, V(-0.91, -80.21)); const [loc] = await s.enqueue(d);
    const srv = servidor({ existingCodes: ['REPETIDO'] });
    await syncOnce(s, srv, 'dev');
    expect((await s.localPlots())[0]).toMatchObject({ state: 'REJECTED', last_error: expect.stringMatching(/PLOT_CODE_TAKEN/), server_id: null });
    expect(srv.located).toHaveLength(0);
    // la persona corrige el código; la original queda como historial (FAILED, enlazada) y una sustituta la reemplaza
    const nuevo = await s.correctRejectedCreate(opQ, { plot_code: 'MOV-3-P1' });
    const ops = (await s.drafts())[0].operations; // operaciones de la captura
    const all = await s.pendingBatch(50);
    expect(all.find((o) => o.operation_id === nuevo)).toMatchObject({ entity_id: plot, resolves: opQ, payload: expect.objectContaining({ plot_code: 'MOV-3-P1', producer_local_ref: prod }) });
    expect(ops.find((o) => o.operation_id === loc)!.resolved_by).not.toBeNull(); // la captura también se sustituyó (su original ya la conocía el servidor como rechazada)
    expect((await s.localPlots())[0].plot_code).toBe('MOV-3-P1');
    const r = await syncOnce(s, srv, 'dev');
    expect(r).toMatchObject({ failed: 0, conflicts: 0, still_pending: 0 });
    expect(srv.created).toEqual(['P:MOV-3', 'Q:MOV-3-P1']);
    expect(srv.located).toHaveLength(1);
    expect((await s.localPlots())[0]).toMatchObject({ state: 'SYNCED', server_id: srv.refs.get(plot) });
    await expect(s.correctRejectedCreate(opQ, { plot_code: 'OTRO' })).rejects.toThrow(/ya se corrigió|no está rechazada/);
    await s.close();
  });

  it('una parcela local sobre un productor del servidor cita su identificador real, y una captura sobre parcela local exige que su alta esté en cola', async () => {
    const { s } = await setup();
    const plot = await s.createLocalPlot({ producer: { kind: 'SERVER', id: SERVER_PLOT.producer_id }, plot_code: 'MOV-4-P1', crop: 'Cacao' });
    const d = await s.createDraft(plot); await s.setLocation(d, V(-0.92, -80.22));
    await expect(s.enqueue(d)).rejects.toThrow(/Primero pon en cola el alta de la parcela nueva/);
    const opQ = await s.enqueueLocalPlot(plot);
    expect((await s.pendingBatch(5)).find((o) => o.operation_id === opQ)!.payload).toMatchObject({ producer_id: SERVER_PLOT.producer_id });
    expect((await s.pendingBatch(5)).find((o) => o.operation_id === opQ)!.payload.producer_local_ref).toBeUndefined();
    await s.enqueue(d);
    await s.close();
  });
});
