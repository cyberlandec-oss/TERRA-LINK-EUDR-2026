import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SessionManager, type FetchLike } from '../session-manager';
import type { Uploader } from '../transport';
import { nodePlatform, syntheticJpeg } from '../../core/__tests__/node-platform';

// Recorrido OPCIONAL (TL_API_SMOKE=1) del cliente móvil en Node contra la API local levantada (terra_link, DEMO).
// Credenciales del archivo local más reciente (CREDENCIALES*.csv, ignorado por git), nunca impresas.
// Para no alterar geometrías DEMO: la foto se sincroniza (documento FIELD_PHOTO sintético) y la muestra de ubicación se
// envía con una versión obsoleta a propósito → CONFLICTO sin efecto. Evidencia: cliente en Node + API real.
const API = process.env.TL_API_URL ?? 'http://localhost:4000';
const run = process.env.TL_API_SMOKE === '1' ? describe : describe.skip;

// jest-expo sustituye fetch por un simulacro: fetch y subida multipart mínimos sobre node:http.
const nodeFetch: FetchLike = (url, init) => new Promise((res, rej) => {
  const r = request(url, { method: init.method, headers: init.headers }, (m) => { let b = ''; m.setEncoding('utf8'); m.on('data', (c) => (b += c)); m.on('end', () => res({ ok: (m.statusCode ?? 0) < 400, status: m.statusCode ?? 0, json: async () => JSON.parse(b) })); });
  r.on('error', rej); if (init.body) r.write(init.body); r.end();
});
const nodeUploader: Uploader = (url, bytes, mime, fields, headers) => new Promise((res, rej) => {
  const boundary = `----tl${randomUUID()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="foto.jpg"\r\nContent-Type: ${mime}\r\n\r\n`), Buffer.from(bytes), Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  const r = request(url, { method: 'POST', headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': body.length } }, (m) => { let b = ''; m.setEncoding('utf8'); m.on('data', (c) => (b += c)); m.on('end', () => res({ status: m.statusCode ?? 0, body: b })); });
  r.on('error', rej); r.write(body); r.end();
});

function creds(local: string): { email: string; password: string } {
  const root = resolve(__dirname, '../../../../..');
  const file = ['CREDENCIALES.csv', 'CREDENCIALES.pendiente.csv'].map((f) => join(root, f)).filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  const rows = readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split(','));
  const head = rows[0];
  const r = rows.find((x) => x[head.indexOf('email')]?.startsWith(`${local}@`))!;
  return { email: r[head.indexOf('email')], password: r[head.indexOf('contrasena')] };
}

run('P0-023/P0-024 cliente móvil contra la API local (DEMO)', () => {
  it('login online, dispositivo, dataset por pull, foto sincronizada con archivo verificado, conflicto sin efecto, idempotencia y separación de cuentas', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tl-mobile-api-'));
    const p = nodePlatform(root);
    const sm = new SessionManager(p, nodeFetch);
    const t1 = creds('tecnico1.cooperativa');
    const s1 = await sm.login(API, t1.email, t1.password);
    expect(JSON.stringify([...p.secretsMap.values()])).not.toContain(t1.password);
    const org = s1.organizations.find((o) => o.roles.includes('FIELD_TECHNICIAN'))!;
    expect(org.name.startsWith('DEMO')).toBe(true); // entorno de prueba: solo datos sintéticos
    const st = await sm.openStore(s1, org.organization_id);
    const n1 = await sm.downloadDataset(s1, org.organization_id, st, nodeUploader);
    const plots1 = (await st.plots()).map((x) => x.plot_code);
    expect(plots1.length).toBe(n1);
    const plot = (await st.plots())[0];
    const photo = join(root, 'cam.jpg');
    writeFileSync(photo, syntheticJpeg({ exif: true, seed: randomUUID() }));
    const d = await st.createDraft(plot.id);
    await st.setNote(d, 'Prueba sintética de sincronización (P0-024)');
    await st.addPhoto(d, photo, 'image/jpeg', new Date().toISOString());
    await st.enqueue(d);
    const d2 = await st.createDraft(plot.id);
    await st.setLocation(d2, { latitude: -0.5, longitude: -80.0, accuracy_m: null, acquired_at: new Date(Date.now() - 60_000).toISOString(), provider_detail: 'prueba en Node (no es GPS)', mocked: null });
    await (st as unknown as { db: { run(s: string, p: unknown[]): Promise<void> } }).db.run('UPDATE dataset_plots SET row_version = 1 WHERE id = ?', [plot.id]); // versión obsoleta a propósito
    const [locOp] = await st.enqueue(d2);
    const r = await sm.sync(s1, org.organization_id, st, nodeUploader);
    expect(r.stopped).toBeNull();
    expect(r).toMatchObject({ synced: 1, conflicts: 1, uploads: 1 });
    const views = await st.drafts();
    const photoView = views.find((v) => v.id === d)!;
    expect(photoView.operations[0].state).toBe('SYNCED');
    expect(photoView.photos[0]).toMatchObject({ upload_state: 'UPLOADED', server_status: expect.stringMatching(/AVAILABLE|PENDING_SCAN/) });
    expect(views.find((v) => v.id === d2)!.operations[0]).toMatchObject({ operation_id: locOp, state: 'CONFLICT' });
    const again = await sm.sync(s1, org.organization_id, st, nodeUploader);
    expect(again).toMatchObject({ pushed: 0, uploads: 0, stopped: null });
    await st.close();
    await sm.logout();
    const t2 = creds('tecnico2.cooperativa');
    const s2 = await sm.login(API, t2.email, t2.password);
    const st2 = await sm.openStore(s2, org.organization_id);
    expect(await st2.drafts()).toEqual([]);
    await sm.downloadDataset(s2, org.organization_id, st2, nodeUploader);
    const plots2 = (await st2.plots()).map((x) => x.plot_code);
    await st2.close();
    console.log(`dataset tecnico1=${plots1.length}; tecnico2=${plots2.length}; comunes=${plots1.filter((c) => plots2.includes(c)).length}; foto=${photoView.photos[0].server_status}`);
  }, 120_000);
});
