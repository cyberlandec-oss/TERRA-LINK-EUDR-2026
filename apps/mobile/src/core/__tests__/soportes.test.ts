import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore, MAX_SUPPORT_BYTES, sniffSupportMime, type DatasetPlot, type ServerOutcome } from '../store';
import { syncOnce, type SyncTransport } from '../sync';
import { TransportError } from '../sync';
import { hasImageMetadata } from '../metadata';
import { nodePlatform, syntheticJpeg } from './node-platform';

// Soportes documentales (PDF o imagen) sobre la parcela de la captura, también cuando la parcela se creó sin conexión. Reutilizan Documentos: tipo del catálogo,
// firma de bytes, SHA-256, subida aparte, estados independientes. Aportar no revisa ni aprueba.
const SERVER_PLOT: DatasetPlot = { id: '00000000-0000-4000-8000-0000000000aa', plot_code: 'P-EXISTE', name: null, row_version: 3, status: 'ACTIVE', producer_id: '00000000-0000-4000-8000-0000000000b1', producer_code: 'PR-EX', producer_display_name: 'Productor', geometry_status: null } as DatasetPlot;
const TIPOS = [
  { code: 'ENVIRONMENTAL_SUPPORT', label: 'Soporte ambiental', allowed_owner_types: ['plot', 'producer'] },
  { code: 'FIELD_EVIDENCE', label: 'Evidencia del recorrido de campo', allowed_owner_types: ['plot', 'producer'] },
  { code: 'LAND_TENURE', label: 'Documento de tenencia de la tierra', allowed_owner_types: ['producer', 'plot'] },
];
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n');

describe('D soportes documentales (móvil)', () => {
  const setup = async () => {
    const root = mkdtempSync(join(tmpdir(), 'tl-sop-')); const p = nodePlatform(root, {});
    const s = await LocalStore.open(p, 'acc1'); await s.replaceDataset([SERVER_PLOT]); await s.applyReference({ document_types: TIPOS, products: [], locations: [] });
    const file = (name: string, bytes: Uint8Array | Buffer) => { const f = join(root, name); writeFileSync(f, bytes); return f; };
    return { root, p, s, file };
  };

  it('validación: tipo del catálogo, título, contenido real (firma de bytes), tipo declarado coherente, evidencia solo PDF y tamaño; un rol sin tipos no ve nada que descargar', async () => {
    const { s, file } = await setup();
    const d = await s.createDraft(SERVER_PLOT.id);
    expect(sniffSupportMime(PDF)).toBe('application/pdf'); expect(sniffSupportMime(new Uint8Array([0x50, 0x4b, 3, 4]))).toBeNull(); // un ZIP no es un soporte admitido
    await expect(s.addSupport(d, file('a.pdf', PDF), 'application/pdf', { document_type: 'FIELD_PHOTO', title: 'x' })).rejects.toThrow(/no está entre los que tu rol puede aportar/); // la foto tiene su propio flujo
    await expect(s.addSupport(d, file('a.pdf', PDF), 'application/pdf', { document_type: 'TIPO_NUEVO', title: 'x' })).rejects.toThrow(/no está entre los que tu rol/); // no se crean tipos
    await expect(s.addSupport(d, file('a.pdf', PDF), 'application/pdf', { document_type: 'LAND_TENURE', title: '   ' })).rejects.toThrow(/título/);
    await expect(s.addSupport(d, file('z.pdf', new Uint8Array([0x50, 0x4b, 3, 4, 1, 2])), 'application/pdf', { document_type: 'LAND_TENURE', title: 'x' })).rejects.toThrow(/PDF, JPEG o PNG/); // se decide por el contenido, no por el nombre
    await expect(s.addSupport(d, file('m.pdf', PDF), 'image/png', { document_type: 'LAND_TENURE', title: 'x' })).rejects.toThrow(/no coincide/);
    await expect(s.addSupport(d, file('e.jpg', syntheticJpeg({ seed: 'e' })), 'image/jpeg', { document_type: 'FIELD_EVIDENCE', title: 'x' })).rejects.toThrow(/son PDF/);
    await expect(s.addSupport(d, file('big.pdf', Buffer.concat([Buffer.from(PDF), Buffer.alloc(MAX_SUPPORT_BYTES)])), 'application/pdf', { document_type: 'LAND_TENURE', title: 'x' })).rejects.toThrow(/10 MB/);
    expect((await s.drafts())[0].supports).toHaveLength(0); // ningún rechazo dejó nada a medias
    await s.applyReference({ document_types: [], products: [], locations: [] }); // rol sin documentos: la lista queda vacía y la pantalla lo dice (no es un error)
    expect(await s.supportTypes()).toEqual([]);
    await expect(s.addSupport(d, file('b.pdf', PDF), 'application/pdf', { document_type: 'LAND_TENURE', title: 'x' })).rejects.toThrow(/no está entre los que tu rol/);
    await s.close();
  });

  it('PDF e imagen sobre una parcela creada sin conexión: operaciones en dependencia con referencia local, imagen sin metadatos, todo sobrevive a cerrar y reabrir', async () => {
    const { p, s, file } = await setup();
    const prod = await s.createLocalProducer({ producer_code: 'SOP-1', first_name: 'Ana', last_name: 'Campo' });
    const plot = await s.createLocalPlot({ producer: { kind: 'LOCAL', id: prod }, plot_code: 'SOP-1-P1', crop: 'Cacao' });
    const opP = await s.enqueueLocalProducer(prod); const opQ = await s.enqueueLocalPlot(plot);
    const d = await s.createDraft(plot);
    const conExif = syntheticJpeg({ exif: true, seed: 'sop' });
    const idPdf = await s.addSupport(d, file('tenencia.pdf', PDF), 'application/pdf', { document_type: 'LAND_TENURE', title: 'Escritura (copia)' });
    const idImg = await s.addSupport(d, file('amb.jpg', conExif), 'image/jpeg', { document_type: 'ENVIRONMENTAL_SUPPORT', title: 'Croquis ambiental' });
    const ops = await s.enqueue(d);
    await s.close();
    const s2 = await LocalStore.open(p, 'acc1'); // cierre y reapertura
    const lote = await s2.pendingBatch(20);
    const docs = lote.filter((o) => o.operation_type === 'DOCUMENT_ATTACH');
    expect(docs).toHaveLength(2); expect(ops).toHaveLength(2);
    const porId = Object.fromEntries(docs.map((o) => [o.entity_id, o]));
    expect(porId[idPdf]).toMatchObject({ depends_on: [opQ], attachment_refs: [idPdf], payload: expect.objectContaining({ owner_type: 'plot', plot_local_ref: plot, document_type: 'LAND_TENURE', title: 'Escritura (copia)', mime_type: 'application/pdf', size_bytes: PDF.length }) });
    expect(porId[idPdf].payload.plot_id).toBeUndefined(); // se cita la referencia local, nunca un identificador inventado
    expect(porId[idImg].payload.mime_type).toBe('image/jpeg');
    const bytesImg = await s2.attachmentBytes(idImg); expect(bytesImg.length).toBeLessThan(conExif.length); // sin EXIF
    expect(hasImageMetadata(conExif, 'image/jpeg')).toBe(true); expect(hasImageMetadata(bytesImg, 'image/jpeg')).toBe(false); // la regla del servidor acepta la copia y rechazaría el original
    expect(porId[idPdf].payload.sha256).toBe(await p.sha256(PDF));
    expect(lote.map((o) => o.operation_id)).toContain(opP);
    const v = (await s2.drafts())[0]; expect(v.supports.map((x) => x.title).sort()).toEqual(['Croquis ambiental', 'Escritura (copia)']); expect(v.supports.every((x) => x.upload_state === 'LOCAL')).toBe(true);
    await expect(s2.addSupport(d, file('t2.pdf', PDF), 'application/pdf', { document_type: 'LAND_TENURE', title: 'otro' })).rejects.toThrow(/en cola|editable/i); // ya encolado: inmutable
    await s2.close();
  });

  it('subida interrumpida y recuperación: el archivo se conserva, se reintenta con la MISMA operación y no se duplica; los estados (archivo, análisis) son independientes del registro', async () => {
    const { s, file } = await setup();
    const d = await s.createDraft(SERVER_PLOT.id);
    const id = await s.addSupport(d, file('t.pdf', PDF), 'application/pdf', { document_type: 'LAND_TENURE', title: 'Tenencia' });
    const [op] = await s.enqueue(d);
    const subidas: string[] = []; let cortar = true; let analisis = 'PENDING_SCAN';
    const t: SyncTransport = {
      async push(_d, ops) { return ops.map((o): ServerOutcome => ({ operation_id: o.operation_id, status: 'ACCEPTED', result: { attachment: subidas.length ? { status: analisis, note: 'recibido' } : { status: 'AWAITING_CONTENT' } } })); },
      async upload(_d, operationId, bytes) {
        if (cortar) { cortar = false; throw new TransportError('NETWORK', null, 'NETWORK', 'Sin conexión: se conserva y se reintentará.'); }
        subidas.push(`${operationId}:${bytes.length}`); return { status: analisis, note: 'recibido' };
      },
      async pull() { return { cursor: 'c', full: true, changes: [SERVER_PLOT], tombstones: [] }; },
    };
    const r1 = await syncOnce(s, t, 'dev');
    expect(r1.synced).toBe(1); expect(r1.upload_errors).toBe(1); // el registro sí quedó aceptado; el archivo no llegó
    let v = (await s.drafts())[0].supports[0];
    expect(v).toMatchObject({ id, upload_state: 'LOCAL' }); expect(v.server_detail).toMatch(/NETWORK/);
    expect(subidas).toEqual([]);
    const r2 = await syncOnce(s, t, 'dev'); // reintento: sube UNA vez con la misma operación
    expect(r2.uploads).toBe(1); expect(subidas).toEqual([`${op}:${PDF.length}`]);
    v = (await s.drafts())[0].supports[0]; expect(v).toMatchObject({ upload_state: 'UPLOADED', server_status: 'PENDING_SCAN' }); // recibido ≠ disponible
    await syncOnce(s, t, 'dev'); expect(subidas).toHaveLength(1); // no se vuelve a subir
    expect(await s.attachmentBytes(id)).toEqual(PDF); // el archivo sigue íntegro
    await s.close();
  });
});
