import { createHash, randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Protocolo de validación local (2026-11-01), punto 2 — documentos del PRODUCTOR vinculado, con campos y contenido (no solo cantidades).
// Documentos SINTÉTICOS rotulados «ENSAYO». Casos: propio operativo (lectura y descarga), propio de tipo personal (metadatos sí, contenido restringido,
// en vista, descarga y enlaces), ajeno (inaccesible por ficha, descarga y listas) y control con un rol que sí ve el contenido personal.
describeDb('Protocolo local: documentos del Productor (PostgreSQL, S3 y escáner reales)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let org: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = () => `/api/v1/organizations/${org}`;
  const SUPER = 'super-dp@test.local';
  const ADMIN = 'admin-dp@test.local';
  const PROD1 = 'prod1-dp@test.local';
  const PROD2 = 'prod2-dp@test.local';
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const pdf = (tag: string) => Buffer.from(`%PDF-1.4\n% ENSAYO documento sintetico ${tag} ${randomUUID()}\n%%EOF\n`);
  const descargar = (actor: string, doc: string, ver: string) => http().get(`${api()}/documents/${doc}/versions/${ver}/content`).set(as(actor))
    .buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  const subir = (actor: string, owner_type: string, owner_id: string, type: string, bytes: Buffer, title: string) =>
    http().post(`${api()}/documents`).set(as(actor)).field('operation_id', randomUUID()).field('document_type', type)
      .field('owner_type', owner_type).field('owner_id', owner_id).field('title', title)
      .attach('file', bytes, { filename: 'ensayo.pdf', contentType: 'application/pdf' });

  let p1 = ''; let p2 = ''; let l1 = ''; let l2 = '';
  const propio = { op: { id: '', ver: '', bytes: Buffer.alloc(0) }, per: { id: '', ver: '', bytes: Buffer.alloc(0) } };
  const ajeno = { id: '', ver: '' };

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    org = (await http().post('/api/v1/organizations').set(as(SUPER)).send({ name: 'Coop ENSAYO docs', organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: ADMIN }).expect(201)).body.id;
    for (const e of [PROD1, PROD2]) {
      const inv = await http().post(`${api()}/invitations`).set(as(ADMIN)).send({ email: e, role_code: 'PRODUCER' }).expect(201);
      await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'X', last_name: 'Y', password: PASSWORD }).expect(200);
      await h.login(e);
    }
    const miembros = (await http().get(`${api()}/members`).set(as(ADMIN)).expect(200)).body;
    const m: Record<string, string> = {};
    for (const x of (Array.isArray(miembros) ? miembros : miembros.members) as Array<{ email: string; membership_id: string }>) m[x.email] = x.membership_id;
    const crear = async (code: string) => (await http().post(`${api()}/producers`).set(as(ADMIN)).send({ producer_code: code, legal_name: `${code} (ENSAYO)` }).expect(201)).body.id as string;
    p1 = await crear('DP-P1'); p2 = await crear('DP-P2');
    for (const [p, e] of [[p1, PROD1], [p2, PROD2]] as const) {
      const v = Number((await http().get(`${api()}/producers/${p}`).set(as(ADMIN)).expect(200)).body.row_version);
      await http().put(`${api()}/producers/${p}/self-membership`).set(as(ADMIN)).send({ expected_version: v, membership_id: m[e], reason: 'Alta del productor (ensayo)' }).expect(200);
    }
    const lote = async (p: string, code: string) => (await http().post(`${api()}/plots`).set(as(ADMIN)).send({ producer_id: p, plot_code: code, crop: 'Cacao' }).expect(201)).body.id as string;
    l1 = await lote(p1, 'DP-L1'); l2 = await lote(p2, 'DP-L2');
    propio.op.bytes = pdf('operativo'); propio.per.bytes = pdf('personal');
    const a = (await subir(PROD1, 'plot', l1, 'FIELD_EVIDENCE', propio.op.bytes, 'ENSAYO evidencia propia').expect(201)).body.document;
    propio.op.id = a.id; propio.op.ver = a.versions[0].id;
    const b = (await subir(PROD1, 'plot', l1, 'LAND_TENURE', propio.per.bytes, 'ENSAYO escritura propia').expect(201)).body.document;
    propio.per.id = b.id; propio.per.ver = b.versions[0].id;
    const c = (await subir(PROD2, 'plot', l2, 'FIELD_EVIDENCE', pdf('ajeno'), 'ENSAYO evidencia ajena').expect(201)).body.document;
    ajeno.id = c.id; ajeno.ver = c.versions[0].id;
  });
  afterAll(async () => h?.close());

  it('propio operativo: ficha con campos, versión disponible y descarga con bytes idénticos', async () => {
    const d = (await http().get(`${api()}/documents/${propio.op.id}`).set(as(PROD1)).expect(200)).body;
    expect(d).toMatchObject({ document_type: 'FIELD_EVIDENCE', owner_type: 'plot', owner_id: l1, title: 'ENSAYO evidencia propia' });
    expect(d.versions[0]).toMatchObject({ version_number: 1, availability: 'AVAILABLE', scan: { status: 'CLEAN' }, sha256: sha(propio.op.bytes), downloadable: true });
    const dl = await descargar(PROD1, propio.op.id, propio.op.ver).expect(200);
    expect(Buffer.compare(dl.body as Buffer, propio.op.bytes)).toBe(0);
    expect(dl.headers['x-content-sha256']).toBe(sha(propio.op.bytes));
  });

  it('propio de tipo personal: metadatos permitidos y contenido restringido en ficha, descarga y vínculos', async () => {
    const d = (await http().get(`${api()}/documents/${propio.per.id}`).set(as(PROD1)).expect(200)).body;
    expect(d).toMatchObject({ document_type: 'LAND_TENURE', classification: 'PERSONAL_DATA', owner_id: l1, title: 'ENSAYO escritura propia', content_access: 'RESTRICTED' });
    expect(d.versions[0]).toMatchObject({ file_name: null, downloadable: false, sha256: sha(propio.per.bytes) }); // el hash y el estado sí; el nombre y el contenido no
    const dl = await descargar(PROD1, propio.per.id, propio.per.ver);
    expect(dl.status).toBe(403);
    expect(dl.body.toString()).toContain('CONTENT_RESTRICTED');
    expect(dl.body.toString()).not.toContain('ENSAYO documento sintetico personal');
    // Control autorizado: quien lee identidad sí obtiene exactamente los bytes.
    const ok = await descargar(ADMIN, propio.per.id, propio.per.ver).expect(200);
    expect(Buffer.compare(ok.body as Buffer, propio.per.bytes)).toBe(0);
    // La lista del productor incluye el metadato propio y ningún nombre de archivo del restringido.
    const lista = (await http().get(`${api()}/documents`).set(as(PROD1)).expect(200)).body;
    const filas = (Array.isArray(lista) ? lista : lista.items) as Array<{ id: string; owner_id: string; versions?: Array<{ file_name: string | null }> }>;
    expect(filas.map((f) => f.id).sort()).toEqual([propio.op.id, propio.per.id].sort());
    expect(filas.find((f) => f.id === propio.per.id)?.versions?.every((v) => v.file_name === null) ?? true).toBe(true);
  });

  it('ajeno: ficha, versiones, descarga y vínculos inaccesibles (404) y ausente de las listas; el titular sí lo ve (control)', async () => {
    expect((await http().get(`${api()}/documents/${ajeno.id}`).set(as(PROD1))).status).toBe(404);
    expect((await descargar(PROD1, ajeno.id, ajeno.ver)).status).toBe(404);
    expect((await http().post(`${api()}/documents/${ajeno.id}/links`).set(as(PROD1)).send({ entity_type: 'producer', entity_id: p1 })).status).toBeGreaterThanOrEqual(403);
    const lista = (await http().get(`${api()}/documents`).set(as(PROD1)).expect(200)).body;
    expect(JSON.stringify(lista)).not.toContain(ajeno.id);
    expect((await http().get(`${api()}/documents/${ajeno.id}`).set(as(PROD2)).expect(200)).body.id).toBe(ajeno.id);
    // El mismo documento del otro no abre el propio tampoco.
    expect((await http().get(`${api()}/documents/${propio.op.id}`).set(as(PROD2))).status).toBe(404);
  });

  it('titular PRODUCTOR: el vínculo propio aporta documentos a su registro (antes 403); el ajeno 404; sin vínculo ni permiso amplio no hay acceso', async () => {
    const bytes = pdf('tenencia-productor');
    const r = await subir(PROD1, 'producer', p1, 'LAND_TENURE', bytes, 'ENSAYO tenencia del productor').expect(201);
    expect(r.body.document).toMatchObject({ owner_type: 'producer', owner_id: p1, classification: 'PERSONAL_DATA', content_access: 'RESTRICTED' });
    expect((await descargar(PROD1, r.body.document.id, r.body.document.versions[0].id)).status).toBe(403);
    expect((await subir(PROD1, 'producer', p2, 'LAND_TENURE', pdf('ajeno'), 'ENSAYO ajeno')).status).toBe(404);
    expect((await subir(PROD2, 'producer', p1, 'LAND_TENURE', pdf('ajeno2'), 'ENSAYO ajeno')).status).toBe(404);
    // Subir no concede editar el registro del productor.
    const v = Number((await http().get(`${api()}/producers/${p1}`).set(as(PROD1)).expect(200)).body.row_version);
    expect([403, 404]).toContain((await http().patch(`${api()}/producers/${p1}`).set(as(PROD1)).send({ expected_version: v, legal_name: 'cambiada' })).status);
  });

  it('el productor no revisa documentos (subir no es aprobar) y la subida no cambia su propio estado de revisión', async () => {
    const d = (await http().get(`${api()}/documents/${propio.op.id}`).set(as(PROD1)).expect(200)).body;
    expect(d.versions[0].review).toBeNull();
    const ruta = `${api()}/documents/${propio.op.id}/versions/${propio.op.ver}/reviews`;
    expect((await http().post(ruta).set(as(PROD1)).send({ decision: 'ACCEPTED', reason: 'Lo reviso yo mismo' })).status).toBe(403);
    const igual = (await http().get(`${api()}/documents/${propio.op.id}`).set(as(PROD1)).expect(200)).body;
    expect(igual.versions[0].review).toBeNull(); // el rechazo no dejó rastro de revisión
    // Control autorizado: la ruta existe y quien sí revisa la acepta.
    await http().post(ruta).set(as(ADMIN)).send({ decision: 'ACCEPTED', reason: 'Coincide con el original (ensayo)' }).expect(201);
  });
});
