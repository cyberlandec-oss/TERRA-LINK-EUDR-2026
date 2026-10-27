import { Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { OBJECT_STORE, type ObjectStore } from '../src/storage/object-store';
import { ClamdScanner, MALWARE_SCANNER, interpretReply, type MalwareScanner } from '../src/storage/scanner';

// Integración P0-018 Documentos: PostgreSQL, S3 local y ClamAV local REALES. Archivos SINTÉTICOS; la muestra
// maliciosa es la cadena de prueba EICAR (inofensiva), construida en memoria para no dejarla en disco.
describeDb('P0-018 documentos privados, escaneo y versiones', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let store: ObjectStore;
  let scanner: MalwareScanner;
  let orgA: string;
  let orgB: string;
  let p1: string; // asignado a tecnico1
  let p2: string;
  let plotB: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const pdf = (tag: string = randomUUID()) => Buffer.from(`%PDF-1.4\n% documento sintético Terra Link ${tag}\n1 0 obj<<>>endobj\n%%EOF\n`);
  const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(randomUUID())]);
  const EICAR = Buffer.from(String.fromCharCode(88, 53, 79, 33, 80, 37, 64, 65, 80, 91, 52, 92, 80, 90, 88, 53, 52, 40, 80, 94, 41, 55, 67, 67, 41, 55, 125, 36) + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!' + String.fromCharCode(36) + 'H+H*');
  const upload = (actor: string, fields: Record<string, string>, file: Buffer, opts: { o?: string; name?: string; mime?: string } = {}) => {
    const r = http().post(`${base(opts.o ?? orgA)}/documents`).set(as(actor)).field('operation_id', fields.operation_id ?? randomUUID());
    for (const [k, v] of Object.entries(fields)) if (k !== 'operation_id') r.field(k, v);
    return r.attach('file', file, { filename: opts.name ?? 'soporte.pdf', contentType: opts.mime ?? 'application/pdf' });
  };
  const download = (actor: string, docId: string, versionId: string, o = orgA) => http().get(`${base(o)}/documents/${docId}/versions/${versionId}/content`).set(as(actor))
    .buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  const versionCount = async () => (await h.db.selectFrom('document_versions').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow()).n;
  const land = (owner = p1) => ({ document_type: 'LAND_TENURE', owner_type: 'producer', owner_id: owner, title: 'Escritura (sintética)', issuer: 'Registro de la Propiedad (ficticio)', issued_at: '2020-01-15' });

  async function join(admin: string, o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const mid = async (email: string) => (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow()).id;

  beforeAll(async () => {
    h = await setupHarness();
    store = h.app.get(OBJECT_STORE);
    scanner = h.app.get(MALWARE_SCANNER);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop A', 'admin-a@test.local');
    orgB = await mk('Coop B', 'admin-b@test.local');
    await join('admin-a@test.local', orgA, 'tecnico1@test.local', 'FIELD_TECHNICIAN');
    await join('admin-a@test.local', orgA, 'tecnico2@test.local', 'FIELD_TECHNICIAN');
    await join('admin-a@test.local', orgA, 'auditor@test.local', 'AUDITOR');
    p1 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'P-1', legal_name: 'Finca uno', assigned_membership_id: await mid('tecnico1@test.local') }).expect(201)).body.id;
    p2 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'P-2', legal_name: 'Finca dos' }).expect(201)).body.id;
    const pb = (await http().post(`${base(orgB)}/producers`).set(as('admin-b@test.local')).send({ producer_code: 'B-1', legal_name: 'Finca B' }).expect(201)).body.id;
    plotB = (await http().post(`${base(orgB)}/plots`).set(as('admin-b@test.local')).send({ producer_id: pb, plot_code: 'PB-1', crop: 'Cacao' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());
  afterEach(() => jest.restoreAllMocks());

  let docId: string;
  let v1: string;
  let v1Bytes: Buffer;

  it('carga autorizada con escaneo real limpio: versión inmutable, hash del servidor, disponible; descarga con bytes idénticos', async () => {
    v1Bytes = pdf();
    const r = await upload('tecnico1@test.local', land(), v1Bytes).expect(201);
    const d = r.body.document;
    docId = d.id;
    v1 = d.versions[0].id;
    expect(d).toMatchObject({ document_type: 'LAND_TENURE', classification: 'PERSONAL_DATA', owner_type: 'producer', owner_id: p1 });
    expect(d.versions[0]).toMatchObject({ version_number: 1, upload: 'COMPLETE', scan: { status: 'CLEAN' }, availability: 'AVAILABLE', sha256: sha(v1Bytes), size_bytes: v1Bytes.length, mime_type: 'application/pdf', review: null, validity: 'NO_EXPIRY', downloadable: true });
    expect(d.note).toMatch(/no prueban autenticidad ni validez jurídica/);
    const dl = await download('admin-a@test.local', docId, v1).expect(200);
    expect(Buffer.compare(dl.body as Buffer, v1Bytes)).toBe(0);
    expect(dl.headers['x-content-sha256']).toBe(sha(v1Bytes));
    expect(await store.exists(`organizations/${orgA}/documents/${v1}.bin`)).toBe(true);
    const ev = await h.db.selectFrom('domain_events').select(['event_type', 'payload']).where('aggregate_id', 'in', [docId, v1]).execute();
    expect(ev.map((e) => e.event_type).sort()).toEqual(['DocumentScanCompleted', 'DocumentUploaded']);
    expect(JSON.stringify(ev)).not.toContain('soporte.pdf'); // sin nombres de archivo en eventos
    expect((await h.db.selectFrom('audit_logs').select('action').where('entity_id', '=', docId).execute()).map((a) => a.action)).toEqual(expect.arrayContaining(['document.upload', 'document.download']));
    await expect(sql`UPDATE document_versions SET sha256 = repeat('0', 64) WHERE id = ${v1}`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('clasificación y alcance: auditor ve metadatos pero no el contenido personal; técnico sin asignación y otra organización sin acceso', async () => {
    const aud = (await http().get(`${base(orgA)}/documents/${docId}`).set(as('auditor@test.local')).expect(200)).body;
    expect(aud).toMatchObject({ content_access: 'RESTRICTED', versions: [{ file_name: null, downloadable: false }] });
    expect((await download('auditor@test.local', docId, v1).expect(403)).body.toString()).toContain('CONTENT_RESTRICTED');
    await http().get(`${base(orgA)}/documents/${docId}`).set(as('tecnico2@test.local')).expect(404);
    expect((await http().get(`${base(orgA)}/documents`).set(as('tecnico2@test.local')).expect(200)).body).toEqual([]);
    await http().get(`${base(orgA)}/documents/${docId}`).set(as('admin-b@test.local')).expect(404);
    await download('admin-b@test.local', docId, v1, orgB).expect(404);
    // documento operativo: el auditor puede descargarlo
    const op = (await upload('admin-a@test.local', { document_type: 'DELIVERY_SUPPORT', owner_type: 'producer', owner_id: p2, title: 'Guía de entrega (sintética)' }, pdf()).expect(201)).body.document;
    await download('auditor@test.local', op.id, op.versions[0].id).expect(200);
  });

  it('referencias ajenas o inexistentes rechazadas; entregas aún no admitidas; vinculación del mismo tenant', async () => {
    await upload('admin-a@test.local', land(randomUUID()), pdf()).expect(404);
    await upload('admin-a@test.local', { ...land(), owner_id: plotB, owner_type: 'plot' }, pdf()).expect(404);
    expect((await upload('admin-a@test.local', { document_type: 'DELIVERY_SUPPORT', owner_type: 'delivery', owner_id: randomUUID(), title: 'x' }, pdf()).expect(422)).body.error.code).toBe('ENTITY_TYPE_NOT_AVAILABLE');
    expect((await upload('admin-a@test.local', { ...land(), owner_type: 'plot', owner_id: randomUUID(), document_type: 'DELIVERY_SUPPORT' }, pdf()).expect(422)).body.error.code).toBe('OWNER_TYPE_NOT_ALLOWED');
    expect((await http().post(`${base(orgA)}/documents/${docId}/links`).set(as('admin-a@test.local')).send({ entity_type: 'delivery', entity_id: randomUUID() }).expect(422)).body.error.code).toBe('ENTITY_TYPE_NOT_AVAILABLE');
    await http().post(`${base(orgA)}/documents/${docId}/links`).set(as('admin-a@test.local')).send({ entity_type: 'plot', entity_id: plotB }).expect(404);
    const linked = (await http().post(`${base(orgA)}/documents/${docId}/links`).set(as('admin-a@test.local')).send({ entity_type: 'producer', entity_id: p2 }).expect(201)).body;
    expect(linked.links).toEqual([expect.objectContaining({ entity_type: 'producer', entity_id: p2 })]);
    await expect(sql`INSERT INTO document_links (document_id, organization_id, entity_type, entity_id, created_by) SELECT ${docId}, ${orgA}, 'plot', ${plotB}, created_by FROM documents WHERE id = ${docId}`.execute(h.db)).rejects.toThrow(/parcela ajena/);
  });

  it('formatos, tipo engañoso y tamaño', async () => {
    expect((await upload('admin-a@test.local', land(), Buffer.from('texto plano sintético'), { name: 'a.pdf' }).expect(422)).body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await upload('admin-a@test.local', land(), png(), { name: 'foto.pdf', mime: 'application/pdf' }).expect(422)).body.error.code).toBe('FILE_TYPE_MISMATCH');
    expect((await upload('admin-a@test.local', land(), Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(70 * 1024, 0x20)])).expect(422)).body.error.code).toBe('FILE_TOO_LARGE');
    // políglota PDF+ZIP: clamd omitiría sin aviso el objeto interno si supera MaxFileSize → rechazo detectable, sin almacenar
    const before = await versionCount();
    const zipTail = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40), Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]);
    expect((await upload('admin-a@test.local', land(), Buffer.concat([pdf(), zipTail])).expect(422)).body.error.code).toBe('EMBEDDED_ARCHIVE_NOT_ALLOWED');
    expect(await versionCount()).toBe(before);
    const ok = await upload('admin-a@test.local', land(), png(), { name: 'plano.png', mime: 'image/png' }).expect(201);
    expect(ok.body.document.versions[0].mime_type).toBe('image/png');
  });

  it('muestra EICAR: rechazada por el escáner real, sin almacenar nada; auditada', async () => {
    const before = await versionCount();
    const r = await upload('admin-a@test.local', land(), EICAR, { name: 'muestra.pdf' }).expect(422);
    expect(r.body.error).toMatchObject({ code: 'FILE_REJECTED_MALWARE' });
    expect(r.body.error.message).toContain('Eicar');
    expect(await versionCount()).toBe(before);
    const a = await h.db.selectFrom('audit_logs').select(['action', 'result']).where('action', '=', 'document.upload_rejected').execute();
    expect(a).toEqual([{ action: 'document.upload_rejected', result: 'DENIED' }]);
  });

  it('escáner indisponible: pendiente (nunca disponible), sin descarga, revisión ni compuerta KDE; reintento real lo habilita', async () => {
    const down = new ClamdScanner('localhost', 3999, 2000); // puerto sin escáner: fallo real de conexión
    jest.spyOn(scanner, 'scan').mockImplementationOnce((b) => down.scan(b));
    const d = (await upload('admin-a@test.local', { document_type: 'DELIVERY_SUPPORT', owner_type: 'producer', owner_id: p1, title: 'Soporte pendiente' }, pdf()).expect(201)).body.document;
    const v = d.versions[0];
    expect(v).toMatchObject({ scan: { status: 'FAILED', error_code: 'SCANNER_UNAVAILABLE' }, availability: 'SCAN_FAILED', downloadable: false });
    expect((await download('admin-a@test.local', d.id, v.id).expect(409)).body.toString()).toContain('VERSION_NOT_AVAILABLE');
    expect((await http().post(`${base(orgA)}/documents/${d.id}/versions/${v.id}/reviews`).set(as('admin-a@test.local')).send({ decision: 'ACCEPTED', reason: 'no debería' }).expect(409)).body.error.code).toBe('VERSION_NOT_AVAILABLE');
    const cte = (await http().get(`${base(orgA)}/cte-catalog`).set(as('admin-a@test.local')).expect(200)).body.definitions.find((x: { code: string }) => x.code === 'DELIVERY').id;
    const kde = async () => (await http().post(`${base(orgA)}/kde/validate`).set(as('admin-a@test.local')).send({ cte_definition_id: cte, values: { DELIVERY_SUPPORT: [d.id] } }).expect(200)).body.items.find((i: { code: string }) => i.code === 'DELIVERY_SUPPORT');
    expect(await kde()).toMatchObject({ result: 'PRESENT_INVALID', error_code: 'DOCUMENT_NOT_AVAILABLE' });
    const retried = (await http().post(`${base(orgA)}/documents/${d.id}/versions/${v.id}/scan`).set(as('admin-a@test.local')).expect(200)).body;
    expect(retried.versions[0]).toMatchObject({ scan: { status: 'CLEAN' }, availability: 'AVAILABLE' });
    expect((await kde()).result).toBe('PRESENT_VALID'); // referencia verificada y disponible (no aprobación del contenido)
    await http().post(`${base(orgA)}/documents/${d.id}/versions/${v.id}/scan`).set(as('admin-a@test.local')).expect(409); // solo se reintenta un fallo
    // un reintento que detecta malware (firmas actualizadas) deja la versión rechazada
    const d2 = (await upload('admin-a@test.local', { document_type: 'DELIVERY_SUPPORT', owner_type: 'producer', owner_id: p1, title: 'Otro' }, pdf(), {}).expect(201)).body.document;
    jest.spyOn(scanner, 'scan').mockResolvedValueOnce({ result: 'FAILED', engine: 'clamd', signature: null, error_code: 'SCANNER_TIMEOUT' });
    const d3 = (await upload('admin-a@test.local', { document_type: 'DELIVERY_SUPPORT', owner_type: 'producer', owner_id: p1, title: 'Tercero' }, pdf()).expect(201)).body.document;
    jest.spyOn(scanner, 'scan').mockResolvedValueOnce({ result: 'INFECTED', engine: 'clamd', signature: 'Firma-De-Prueba', error_code: null });
    const rej = (await http().post(`${base(orgA)}/documents/${d3.id}/versions/${d3.versions[0].id}/scan`).set(as('admin-a@test.local')).expect(200)).body;
    expect(rej.versions[0]).toMatchObject({ availability: 'REJECTED', downloadable: false });
    await download('admin-a@test.local', d3.id, d3.versions[0].id).expect(409);
    expect(d2.versions[0].availability).toBe('AVAILABLE');
  });

  it('versiones y revisiones independientes: la nueva versión no hereda la aceptación; facultad separada', async () => {
    await http().post(`${base(orgA)}/documents/${docId}/versions/${v1}/reviews`).set(as('tecnico1@test.local')).send({ decision: 'ACCEPTED', reason: 'sin facultad' }).expect(403);
    const rv = (await http().post(`${base(orgA)}/documents/${docId}/versions/${v1}/reviews`).set(as('admin-a@test.local')).send({ decision: 'ACCEPTED', reason: 'Coincide con el original físico' }).expect(201)).body;
    expect(rv.versions[0].review).toMatchObject({ decision: 'ACCEPTED', reviewer_is_uploader: false });
    const cur = (await http().get(`${base(orgA)}/documents/${docId}`).set(as('admin-a@test.local')).expect(200)).body;
    const r2 = await http().post(`${base(orgA)}/documents/${docId}/versions`).set(as('tecnico1@test.local')).field('operation_id', randomUUID()).field('expected_version', String(cur.row_version)).field('expires_at', '2020-12-31').attach('file', pdf('v2'), { filename: 'v2.pdf', contentType: 'application/pdf' }).expect(201);
    const vs = r2.body.document.versions;
    expect(vs.map((v: { version_number: number }) => v.version_number)).toEqual([2, 1]);
    expect(vs[0]).toMatchObject({ is_current: true, review: null, validity: 'EXPIRED', availability: 'AVAILABLE' }); // vencido ≠ inaccesible
    expect(vs[1]).toMatchObject({ review: { decision: 'ACCEPTED' } });
    const stale = await http().post(`${base(orgA)}/documents/${docId}/versions`).set(as('tecnico1@test.local')).field('operation_id', randomUUID()).field('expected_version', String(cur.row_version)).attach('file', pdf('v3'), { filename: 'v3.pdf', contentType: 'application/pdf' }).expect(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    // el original de v1 sigue intacto y descargable
    expect(Buffer.compare((await download('admin-a@test.local', docId, v1).expect(200)).body as Buffer, v1Bytes)).toBe(0);
  });

  it('reintento idempotente y mismo identificador con otro archivo', async () => {
    const op = randomUUID();
    const bytes = pdf();
    const a = await upload('admin-a@test.local', { ...land(p2), operation_id: op }, bytes).expect(201);
    const b = await upload('admin-a@test.local', { ...land(p2), operation_id: op }, bytes).expect(200);
    expect(b.body).toMatchObject({ replayed: true, document: { id: a.body.document.id } });
    expect((await upload('admin-a@test.local', { ...land(p2), operation_id: op }, pdf()).expect(409)).body.error.code).toBe('OPERATION_ID_REUSED');
  });

  it('fallos de almacenamiento, rollback y limpieza segura; integridad del original', async () => {
    const before = await versionCount();
    jest.spyOn(store, 'put').mockRejectedValueOnce(new Error('S3 caído'));
    expect((await upload('admin-a@test.local', land(), pdf()).expect(503)).body.error.code).toBe('STORAGE_UNAVAILABLE');
    expect(await versionCount()).toBe(before);
    const deleteSpy = jest.spyOn(store, 'delete');
    await sql`CREATE OR REPLACE FUNCTION p018_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla forzada'; END $$`.execute(h.db);
    await sql`CREATE TRIGGER p018_fail BEFORE INSERT ON document_versions FOR EACH ROW EXECUTE FUNCTION p018_fail()`.execute(h.db);
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      await upload('admin-a@test.local', land(), pdf()).expect(500);
    } finally {
      spy.mockRestore();
      await sql`DROP TRIGGER p018_fail ON document_versions`.execute(h.db);
      await sql`DROP FUNCTION p018_fail`.execute(h.db);
    }
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(await store.exists(deleteSpy.mock.calls[0][0])).toBe(false);
    expect(await versionCount()).toBe(before);
    // integridad: bytes alterados en el almacenamiento → no se entregan
    const t = (await upload('admin-a@test.local', land(), pdf()).expect(201)).body.document;
    await store.put(`organizations/${orgA}/documents/${t.versions[0].id}.bin`, pdf('alterado'), 'application/pdf');
    expect((await download('admin-a@test.local', t.id, t.versions[0].id).expect(500)).body.toString()).toContain('INTEGRITY_FAILED');
  });

  it('revocación durante la carga y antes de descargar', async () => {
    const before = await versionCount();
    const original = store.put.bind(store);
    jest.spyOn(store, 'put').mockImplementationOnce(async (k, b, c) => {
      await original(k, b, c);
      await http().post(`${base(orgA)}/members/${await mid('tecnico1@test.local')}/deactivate`).set(as('admin-a@test.local')).send({ reason: 'Revocación durante la carga' }).expect(200);
    });
    const deleteSpy = jest.spyOn(store, 'delete');
    const r = await upload('tecnico1@test.local', land(), pdf());
    expect([401, 403, 404]).toContain(r.status);
    expect(await versionCount()).toBe(before);
    expect(deleteSpy).toHaveBeenCalledTimes(1); // compensación del objeto subido
    await http().post(`${base(orgA)}/members/${await mid('tecnico1@test.local')}/reactivate`).set(as('admin-a@test.local')).send({ reason: 'Fin de la prueba' }).expect(200);
    await h.login('tecnico1@test.local');
    await download('tecnico1@test.local', docId, v1).expect(200);
    const pr = await http().get(`${base(orgA)}/producers/${p1}`).set(as('admin-a@test.local')).expect(200);
    await http().put(`${base(orgA)}/producers/${p1}/assignment`).set(as('admin-a@test.local')).send({ expected_version: pr.body.row_version, membership_id: await mid('tecnico2@test.local') }).expect(200);
    await download('tecnico1@test.local', docId, v1).expect(404); // sin acceso residual
  });

  it('cuota por organización bajo cargas concurrentes: nunca se supera', async () => {
    const big = () => Buffer.concat([Buffer.from('%PDF-1.4' + String.fromCharCode(10)), Buffer.alloc(60 * 1024, 0x20), Buffer.from(randomUUID())]);
    const ownerB = (await http().post(`${base(orgB)}/producers`).set(as('admin-b@test.local')).send({ producer_code: 'B-2', legal_name: 'Finca B2' }).expect(201)).body.id;
    const f = { document_type: 'DELIVERY_SUPPORT', owner_type: 'producer', owner_id: ownerB, title: 'Cuota' };
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(() => upload('admin-b@test.local', f, big(), { o: orgB })));
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(4);
    expect(results.filter((r) => r.status === 422).every((r) => r.body.error.code === 'QUOTA_EXCEEDED')).toBe(true);
    const used = await sql<{ n: number }>`SELECT coalesce(sum(size_bytes), 0)::int AS n FROM document_versions WHERE organization_id = ${orgB}`.execute(h.db);
    expect(used.rows[0].n).toBeLessThanOrEqual(256 * 1024);
  });

  it('análisis incompleto por límite del escáner → no disponible (nunca limpio)', async () => {
    jest.spyOn(scanner, 'scan').mockResolvedValueOnce(interpretReply('stream: Heuristics.Limits.Exceeded.MaxRecursion FOUND'));
    const d = (await upload('admin-a@test.local', { document_type: 'DELIVERY_SUPPORT', owner_type: 'producer', owner_id: p2, title: 'Incompleto' }, pdf()).expect(201)).body.document;
    expect(d.versions[0]).toMatchObject({ availability: 'SCAN_FAILED', scan: { status: 'FAILED', error_code: 'SCAN_INCOMPLETE_LIMITS' }, downloadable: false });
  });

  it('sin filtraciones: errores y eventos sin contenido, nombres de archivo, tokens ni identidad', async () => {
    const r = await upload('admin-a@test.local', land(), Buffer.from('CONTENIDO_SECRETO_SINTETICO'), { name: 'cedula-0912345678.pdf' }).expect(422);
    expect(JSON.stringify(r.body)).not.toMatch(/CONTENIDO_SECRETO|0912345678/);
    const ev = await h.db.selectFrom('domain_events').select('payload').where('event_type', 'in', ['DocumentUploaded', 'DocumentScanCompleted']).execute();
    expect(JSON.stringify(ev)).not.toMatch(/\.pdf|\.png|Bearer|object_key/);
  });
});
