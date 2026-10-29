import { createHash, randomBytes, randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { operationHash } from '../src/sync/sync';

// D — Altas sin conexión: productor local → parcela local → ubicación/vértices, con referencias locales resueltas por el servidor.
// Se resuelven SOLO por la tabla de correspondencias (organización + usuario), nunca por nombre ni proximidad.
// PostgreSQL REAL, datos SINTÉTICOS, base desechable.
describeDb('D altas sin conexión: referencias locales y dependencias', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let org: string; let orgB: string;
  let ownProducer: string; let foreignProducer: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const ADMIN = 'admin-a@test.local'; const TECH = 'tecnico-a@test.local'; const TECH2 = 'tecnico2-a@test.local'; const PROD = 'productor-a@test.local';

  async function join(o: string, admin: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const device = async (who: string, o = org) => (await http().post(`${base(o)}/devices`).set(as(who)).send({ client_device_id: randomUUID(), platform: 'ANDROID', label: 'Teléfono' }).expect(201)).body.device.id as string;
  const push = (who: string, dev: string, ops: unknown[], o = org) => http().post(`${base(o)}/sync/push`).set(as(who)).send({ device_id: dev, operations: ops }).expect(200);
  const HACE_UN_MINUTO = new Date(Date.now() - 60_000).toISOString();
  const mk = (type: string, entity: string, payload: Record<string, unknown>, deps: string[] = [], baseVersion: number | null = null) => {
    const c = { operation_type: type, entity_id: entity, base_version: baseVersion, depends_on: deps, captured_at: HACE_UN_MINUTO, payload };
    return { operation_id: randomUUID(), ...c, content_hash: operationHash(c) };
  };
  const producerOp = (local: string, code: string) => mk('PRODUCER_CREATE', local, { producer_code: code, first_name: 'Ana', last_name: 'Campo', community: 'La Esperanza' });
  const plotOp = (local: string, producerLocal: string, code: string, deps: string[]) => mk('PLOT_CREATE', local, { producer_local_ref: producerLocal, plot_code: code, crop: 'Cacao', name: 'Lote nuevo' }, deps);
  const locOp = (plotLocal: string, deps: string[]) => mk('PLOT_LOCATION_SAMPLE_CREATE', randomUUID(), { plot_local_ref: plotLocal, latitude: -0.85, longitude: -80.16, accuracy_m: 7, acquired_at: HACE_UN_MINUTO, source: 'DEVICE_LOCATION_SERVICE', provider_detail: 'expo-location; prueba', mocked: false }, deps);
  const vtx = (plotLocal: string, capture: string, seq: number, deps: string[], baseVersion: number | null) =>
    mk('PLOT_POLYGON_VERTEX_ADD', randomUUID(), { plot_local_ref: plotLocal, latitude: -0.85 + seq * 0.0003, longitude: -80.16 + (seq % 2) * 0.0004, accuracy_m: 6, acquired_at: HACE_UN_MINUTO, source: 'DEVICE_LOCATION_SERVICE', provider_detail: 'expo-location; prueba', mocked: false, capture_id: capture, vertex_seq: seq }, deps, seq === 1 ? baseVersion : null);
  const statuses = (r: { body: { results: Array<{ status: string }> } }) => r.body.results.map((x) => x.status);
  const count = async (table: 'producers' | 'plots', col: string, val: string) => Number((await h.db.selectFrom(table).select(h.db.fn.countAll().as('n')).where('organization_id', '=', org).where(col as never, '=', val as never).executeTakeFirstOrThrow()).n);

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN); await h.user('admin-b@test.local');
    const mkOrg = async (n: string, a: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: a }).expect(201)).body.id as string;
    org = await mkOrg('Coop Altas A', ADMIN); orgB = await mkOrg('Coop Altas B', 'admin-b@test.local');
    await join(org, ADMIN, TECH, 'FIELD_TECHNICIAN'); await join(org, ADMIN, TECH2, 'FIELD_TECHNICIAN'); await join(org, ADMIN, PROD, 'PRODUCER');
    ownProducer = (await http().post(`${base(org)}/producers`).set(as(ADMIN)).send({ producer_code: 'AL-1', legal_name: 'Finca del Productor' }).expect(201)).body.id;
    foreignProducer = (await http().post(`${base(org)}/producers`).set(as(ADMIN)).send({ producer_code: 'AL-2', legal_name: 'Finca Ajena' }).expect(201)).body.id;
    const m = (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', PROD).where('m.organization_id', '=', org).executeTakeFirstOrThrow()).id;
    const row = (await http().get(`${base(org)}/producers/${ownProducer}`).set(as(ADMIN)).expect(200)).body;
    await http().put(`${base(org)}/producers/${ownProducer}/self-membership`).set(as(ADMIN)).send({ expected_version: row.row_version, membership_id: m, reason: 'Vínculo de prueba' }).expect(200);
  });
  afterAll(async () => h?.close());

  it('productor local → parcela local → ubicación y vértices en UN lote: cada dependiente resuelve su referencia; reenviar no duplica nada', async () => {
    const dev = await device(TECH); const lp = randomUUID(); const lq = randomUUID(); const cap = randomUUID();
    const p = producerOp(lp, 'MOV-1');
    const q = plotOp(lq, lp, 'MOV-1-P1', [p.operation_id]);
    const l = locOp(lq, [q.operation_id]);
    const v1 = vtx(lq, cap, 1, [l.operation_id], null); const v2 = vtx(lq, cap, 2, [v1.operation_id], null); const v3 = vtx(lq, cap, 3, [v2.operation_id], null);
    const r = await push(TECH, dev, [p, q, l, v1, v2, v3]);
    expect(statuses(r)).toEqual(Array(6).fill('ACCEPTED'));
    const prod = r.body.results[0].result; const plot = r.body.results[1].result;
    expect(prod).toMatchObject({ entity: 'PRODUCER', local_ref: lp, producer_code: 'MOV-1' });
    expect(plot).toMatchObject({ entity: 'PLOT', local_ref: lq, producer_id: prod.server_id });
    // los dependientes quedaron sobre la parcela definitiva
    const draft = (await http().get(`${base(org)}/plots/${plot.server_id}/polygon-drafts/current`).set(as(TECH)).expect(200)).body.draft;
    expect(draft.vertices).toHaveLength(3);
    expect(draft.origin_capture_id).toBe(cap);
    const pl = (await http().get(`${base(org)}/plots/${plot.server_id}`).set(as(TECH)).expect(200)).body;
    expect(Number(pl.row_version)).toBeGreaterThan(plot.plot_row_version); // el punto sí creó versión; el vértice no lo tomó por cambio ajeno
    // respuesta perdida: el teléfono reenvía todo con los mismos identificadores
    expect(statuses(await push(TECH, dev, [p, q, l, v1, v2, v3]))).toEqual(Array(6).fill('DUPLICATE'));
    expect(await count('producers', 'producer_code', 'MOV-1')).toBe(1);
    expect(await count('plots', 'plot_code', 'MOV-1-P1')).toBe(1);
    expect((await http().get(`${base(org)}/plots/${plot.server_id}/polygon-drafts/current`).set(as(TECH)).expect(200)).body.draft.vertices).toHaveLength(3);
    // el técnico la ve (quedó asignada a su responsable) y la bajada incremental la trae
    const pull = await http().get(`${base(org)}/sync/pull?device_id=${dev}`).set(as(TECH)).expect(200);
    expect((pull.body.changes as Array<{ id: string }>).map((c) => c.id)).toContain(plot.server_id);
  });

  it('un dependiente cuyo alta aún no llegó espera (no se guarda); cuando llega, se resuelve', async () => {
    const dev = await device(TECH); const lp = randomUUID(); const lq = randomUUID();
    const p = producerOp(lp, 'MOV-2'); const q = plotOp(lq, lp, 'MOV-2-P1', [p.operation_id]); const l = locOp(lq, [q.operation_id]);
    expect(statuses(await push(TECH, dev, [l]))).toEqual(['DEPENDENCY_PENDING']);
    expect(statuses(await push(TECH, dev, [p, q]))).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect(statuses(await push(TECH, dev, [l]))).toEqual(['ACCEPTED']);
  });

  it('código de parcela repetido: el alta se rechaza con su código, los dependientes quedan rechazados por dependencia y la corrección (nueva operación, misma referencia local) los recupera', async () => {
    const dev = await device(TECH); const lp = randomUUID(); const lq = randomUUID();
    const p = producerOp(lp, 'MOV-3');
    const q = plotOp(lq, lp, 'MOV-3-P1', [p.operation_id]);
    const q2 = plotOp(randomUUID(), lp, 'MOV-3-P1', [p.operation_id]); // otra parcela con el mismo código
    const l = locOp(lq, [q.operation_id]);
    expect(statuses(await push(TECH, dev, [p, q2]))).toEqual(['ACCEPTED', 'ACCEPTED']);
    const rej = await push(TECH, dev, [q, l]);
    expect(rej.body.results[0]).toMatchObject({ status: 'REJECTED' });
    expect(rej.body.results[0].error.code).toBeTruthy();
    expect(rej.body.results[1]).toMatchObject({ status: 'REJECTED', error: { code: 'DEPENDENCY_FAILED' } });
    // corrección: otro código, misma referencia local, operaciones nuevas (las rechazadas se conservan como historial)
    const qOk = plotOp(lq, lp, 'MOV-3-P1B', [p.operation_id]);
    const lOk = locOp(lq, [qOk.operation_id]);
    expect(statuses(await push(TECH, dev, [qOk, lOk]))).toEqual(['ACCEPTED', 'ACCEPTED']);
    expect(await count('plots', 'plot_code', 'MOV-3-P1B')).toBe(1);
  });

  it('las referencias locales no cruzan usuarios ni organizaciones, ni se resuelven por nombre o cercanía', async () => {
    const devA = await device(TECH); const lp = randomUUID(); const lq = randomUUID();
    const p = producerOp(lp, 'MOV-4'); const q = plotOp(lq, lp, 'MOV-4-P1', [p.operation_id]);
    expect(statuses(await push(TECH, devA, [p, q]))).toEqual(['ACCEPTED', 'ACCEPTED']);
    // otro técnico de la misma organización cita la misma referencia: no existe para él
    const dev2 = await device(TECH2);
    expect(statuses(await push(TECH2, dev2, [locOp(lq, [])]))).toEqual(['DEPENDENCY_PENDING']);
    // el mismo técnico en OTRA organización tampoco (no es miembro: no entra)
    await http().post(`${base(orgB)}/devices`).set(as(TECH)).send({ client_device_id: randomUUID(), platform: 'ANDROID', label: 'x' }).expect(404);
    // una referencia con el nombre del código no resuelve nada
    const porNombre = mk('PLOT_LOCATION_SAMPLE_CREATE', randomUUID(), { plot_local_ref: 'MOV-4-P1', latitude: -0.85, longitude: -80.16, accuracy_m: null, acquired_at: HACE_UN_MINUTO, source: 'DEVICE_LOCATION_SERVICE', provider_detail: 'expo-location; prueba', mocked: false });
    expect(statuses(await push(TECH, devA, [porNombre]))).toEqual(['REJECTED']);
  });

  it('permisos: el Productor no registra productores pero sí parcelas SUYAS; el de otro productor se rechaza; el rol sin permisos de alta sigue sin entrar', async () => {
    const dev = await device(PROD);
    expect(statuses(await push(PROD, dev, [producerOp(randomUUID(), 'MOV-5')]))).toEqual(['FORBIDDEN']);
    const propia = mk('PLOT_CREATE', randomUUID(), { producer_id: ownProducer, plot_code: 'MOV-5-P1', crop: 'Cacao' });
    const ajena = mk('PLOT_CREATE', randomUUID(), { producer_id: foreignProducer, plot_code: 'MOV-5-P2', crop: 'Cacao' });
    const r = await push(PROD, dev, [propia, ajena]);
    expect(r.body.results[0].status).toBe('ACCEPTED');
    expect(r.body.results[1]).toMatchObject({ status: 'REJECTED', error: { code: 'PRODUCER_NOT_AVAILABLE' } });
    expect(await count('plots', 'plot_code', 'MOV-5-P2')).toBe(0);
    expect(await count('producers', 'producer_code', 'MOV-5')).toBe(0);
  });

  /** JPEG SINTÉTICO mínimo válido (sin metadatos). No es una foto. */
  const jpeg = () => {
    const seg = (m: number, body: Buffer) => Buffer.concat([Buffer.from([0xff, m, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body]);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF      ', 'binary')), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), randomBytes(200).map((b) => (b === 0xff ? 0 : b)), Buffer.from([0xff, 0xd9])]);
  };

  it('evidencia sobre una parcela creada sin conexión: el registro llega en dependencia, el archivo se sube aparte con su integridad y queda vinculado a la parcela DEFINITIVA', async () => {
    const dev = await device(TECH); const lp = randomUUID(); const lq = randomUUID();
    const p = producerOp(lp, 'MOV-6'); const q = plotOp(lq, lp, 'MOV-6-P1', [p.operation_id]);
    const bytes = jpeg();
    const foto = mk('PLOT_PHOTO_ATTACH', randomUUID(), { plot_local_ref: lq, sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length, mime_type: 'image/jpeg', caption: 'Foto de campo' }, [q.operation_id]);
    const r = await push(TECH, dev, [p, q, foto]);
    expect(statuses(r)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    expect(r.body.results[2].result).toMatchObject({ plot_id: r.body.results[1].result.server_id, attachment: { status: 'AWAITING_CONTENT' } }); // registro aceptado, archivo todavía no
    const up = await http().post(`${base(org)}/sync/attachments/${foto.operation_id}/content`).set(as(TECH)).field('device_id', dev).attach('file', bytes, { filename: 'f.jpg', contentType: 'image/jpeg' });
    expect([200, 201]).toContain(up.status);
    expect(['PENDING_SCAN', 'AVAILABLE']).toContain(up.body.attachment.status); // el análisis no se da por limpio sin escáner
    const sinIntegridad = mk('PLOT_PHOTO_ATTACH', randomUUID(), { plot_local_ref: lq, sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length, mime_type: 'image/jpeg', caption: 'Otra' }, [q.operation_id]);
    await push(TECH, dev, [sinIntegridad]);
    const bad = await http().post(`${base(org)}/sync/attachments/${sinIntegridad.operation_id}/content`).set(as(TECH)).field('device_id', dev).attach('file', Buffer.concat([bytes, Buffer.from([1])]), { filename: 'f.jpg', contentType: 'image/jpeg' });
    expect(bad.status).toBeGreaterThanOrEqual(400); // bytes distintos de los declarados: nada se guarda
  });

  it('entrega declarada sin conexión: productor y parcela locales como origen, una sola vez, y NO es recepción, pesaje ni inventario; el rol sin permiso de entregas no entra', async () => {
    const product = (await http().post(`${base(org)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id as string;
    const center = (await http().post(`${base(org)}/locations`).set(as(ADMIN)).send({ code: 'CA-D1', name: 'Centro de acopio D', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id as string;
    const dev = await device(TECH); const lp = randomUUID(); const lq = randomUUID(); const ld = randomUUID();
    const p = producerOp(lp, 'MOV-7'); const q = plotOp(lq, lp, 'MOV-7-P1', [p.operation_id]);
    const hoy = new Date().toISOString().slice(0, 10);
    const entrega = mk('DELIVERY_CREATE', ld, { producer_local_ref: lp, product_id: product, location_id: center, delivery_date: hoy, quantity_declared: '125.500', unit: 'KG', origins: [{ plot_local_ref: lq, quantity: '125.500' }], notes: 'Declarada en campo' }, [p.operation_id, q.operation_id]);
    const r = await push(TECH, dev, [p, q, entrega]);
    expect(statuses(r)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    const res = r.body.results[2].result;
    expect(res).toMatchObject({ entity: 'DELIVERY', local_ref: ld });
    const det = (await http().get(`${base(org)}/deliveries/${res.server_id}`).set(as(ADMIN)).expect(200)).body;
    const dl = det.delivery ?? det;
    expect(dl.status).toBe('DRAFT'); // borrador: la declaración no se registró ni se convirtió en recepción
    expect(JSON.stringify(dl.quantity_declared)).toMatch(/125\.5/); // cantidad y unidad tal como se declararon
    expect(JSON.stringify(dl.quantity_declared)).toMatch(/KG/);
    expect(dl.reception ?? null).toBeNull();
    const origenes = (dl.origins ?? []) as Array<{ plot_id: string }>;
    expect(origenes.map((o) => o.plot_id)).toEqual([r.body.results[1].result.server_id]); // origen = la parcela DEFINITIVA
    // reintento tras respuesta perdida: nada se duplica
    expect(statuses(await push(TECH, dev, [p, q, entrega]))).toEqual(['DUPLICATE', 'DUPLICATE', 'DUPLICATE']);
    const n = Number((await h.db.selectFrom('deliveries').select(h.db.fn.countAll().as('n')).where('organization_id', '=', org).where('producer_id', '=', r.body.results[0].result.server_id).executeTakeFirstOrThrow()).n);
    expect(n).toBe(1);
    // el catálogo de referencia viaja con la bajada (solo para quien puede declarar entregas)
    const pull = await http().get(`${base(org)}/sync/pull?device_id=${dev}`).set(as(TECH)).expect(200);
    expect(pull.body.reference.products.map((x: { id: string }) => x.id)).toContain(product);
    expect(pull.body.reference.locations.map((x: { id: string }) => x.id)).toContain(center);
    // el Productor (sin delivery:create) no declara entregas, ni recibe el catálogo
    const devP = await device(PROD);
    const propia = mk('DELIVERY_CREATE', randomUUID(), { producer_id: ownProducer, product_id: product, location_id: center, delivery_date: hoy, quantity_declared: '10', unit: 'KG' });
    expect(statuses(await push(PROD, devP, [propia]))).toEqual(['FORBIDDEN']);
    const refP = (await http().get(`${base(org)}/sync/pull?device_id=${devP}`).set(as(PROD)).expect(200)).body.reference;
    expect(refP.products).toEqual([]); expect(refP.locations).toEqual([]);
    // Productores en la referencia: el Productor ve SOLO el suyo (aunque no tenga parcelas), con lo mínimo; nunca el ajeno
    expect(refP.producers).toEqual([{ id: ownProducer, producer_code: 'AL-1', display_name: 'Finca del Productor' }]);
    expect(pull.body.reference.producers.map((x: { id: string }) => x.id)).not.toContain(foreignProducer); // el técnico solo ve los asignados a él
    expect(Object.keys(pull.body.reference.producers[0] ?? { id: 1, producer_code: 1, display_name: 1 }).sort()).toEqual(['display_name', 'id', 'producer_code']);
    // un origen local que aún no llegó espera; uno mal formado se rechaza
    expect(statuses(await push(TECH, dev, [mk('DELIVERY_CREATE', randomUUID(), { producer_id: r.body.results[0].result.server_id, product_id: product, location_id: center, delivery_date: hoy, quantity_declared: '5', unit: 'KG', origins: [{ plot_local_ref: randomUUID() }] })]))).toEqual(['DEPENDENCY_PENDING']);
    expect(statuses(await push(TECH, dev, [mk('DELIVERY_CREATE', randomUUID(), { producer_id: r.body.results[0].result.server_id, origins: [{}] })]))).toEqual(['REJECTED']);
  });

  it('soportes documentales (PDF o imagen) sobre parcela y productor creados sin conexión: registro, archivo aparte con integridad, estados de Documentos y sin convertirse en evidencia aprobada', async () => {
    const dev = await device(TECH); const lp = randomUUID(); const lq = randomUUID();
    const p = producerOp(lp, 'MOV-8'); const q = plotOp(lq, lp, 'MOV-8-P1', [p.operation_id]);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    const soporte = (type: string, owner: Record<string, unknown>, bytes: Buffer, mime: string, deps: string[], over: Record<string, unknown> = {}) =>
      mk('DOCUMENT_ATTACH', randomUUID(), { document_type: type, title: 'Soporte de ensayo', sha256: sha(bytes), size_bytes: bytes.length, mime_type: mime, ...owner, ...over }, deps);
    const deParcela = soporte('LAND_TENURE', { owner_type: 'plot', plot_local_ref: lq }, pdf, 'application/pdf', [q.operation_id]);
    const deProductor = soporte('LABOR_SUPPORT', { owner_type: 'producer', producer_local_ref: lp }, pdf, 'application/pdf', [p.operation_id], { title: 'Soporte laboral' });
    const r = await push(TECH, dev, [p, q, deParcela, deProductor]);
    expect(statuses(r)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    const plotServer = r.body.results[1].result.server_id as string; const prodServer = r.body.results[0].result.server_id as string;
    expect(r.body.results[2].result).toMatchObject({ owner_type: 'plot', owner_id: plotServer, document_type: 'LAND_TENURE', attachment: { status: 'AWAITING_CONTENT' } }); // registro aceptado, archivo todavía no
    expect(r.body.results[3].result).toMatchObject({ owner_type: 'producer', owner_id: prodServer });
    // el archivo se sube aparte; antes de eso no hay documento
    expect((await http().get(base(org) + '/documents?owner_type=plot&owner_id=' + plotServer).set(as(ADMIN)).expect(200)).body).toHaveLength(0);
    const subir = (op: string, bytes: Buffer, mime: string, who = TECH) => http().post(base(org) + '/sync/attachments/' + op + '/content').set(as(who)).field('device_id', dev).attach('file', bytes, { filename: 'x', contentType: mime });
    const up = await subir(deParcela.operation_id, pdf, 'application/pdf');
    expect([200, 201]).toContain(up.status);
    expect(['PENDING_SCAN', 'AVAILABLE']).toContain(up.body.attachment.status); // el análisis no se da por limpio sin escáner
    expect((await subir(deProductor.operation_id, pdf, 'application/pdf')).status).toBeLessThan(300);
    // el reintento (respuesta perdida) no duplica el documento ni la versión
    expect((await subir(deParcela.operation_id, pdf, 'application/pdf')).body.replayed).toBe(true);
    const docs = (await http().get(base(org) + '/documents?owner_type=plot&owner_id=' + plotServer).set(as(ADMIN)).expect(200)).body as Array<{ document_type: string; owner_id: string; versions: Array<{ sha256: string; mime_type: string }>; title: string }>;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ document_type: 'LAND_TENURE', owner_id: plotServer, title: 'Soporte de ensayo' });
    expect(docs[0].versions).toHaveLength(1); expect(docs[0].versions[0]).toMatchObject({ sha256: sha(pdf), mime_type: 'application/pdf' });
    expect(JSON.stringify(docs[0])).not.toMatch(/ACCEPTED/); // aportar no revisa ni aprueba: ninguna revisión humana registrada
    expect((await http().get(base(org) + '/documents?owner_type=producer&owner_id=' + prodServer).set(as(ADMIN)).expect(200)).body).toHaveLength(1);
    // reenviar la operación: duplicado, con el estado actual del archivo
    expect(statuses(await push(TECH, dev, [deParcela]))).toEqual(['DUPLICATE']);
  });

  it('soportes: tipos y titulares fuera de alcance, integridad y permisos se rechazan sin guardar nada', async () => {
    const dev = await device(TECH); const lp = randomUUID(); const lq = randomUUID();
    const p = producerOp(lp, 'MOV-9'); const q = plotOp(lq, lp, 'MOV-9-P1', [p.operation_id]);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const pdf = Buffer.from('%PDF-1.4\nsoporte\n%%EOF\n', 'latin1');
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    const mkS = (over: Record<string, unknown>, deps: string[] = [q.operation_id]) => mk('DOCUMENT_ATTACH', randomUUID(), { owner_type: 'plot', plot_local_ref: lq, document_type: 'ENVIRONMENTAL_SUPPORT', title: 'S', sha256: sha(pdf), size_bytes: pdf.length, mime_type: 'application/pdf', ...over }, deps);
    const buenos = await push(TECH, dev, [p, q]); expect(statuses(buenos)).toEqual(['ACCEPTED', 'ACCEPTED']);
    // tipos que NO se crean ni se admiten desde esta operación: fotografía (tiene su propia operación), soporte de entrega (se vincula desde la entrega) y tipos inexistentes
    for (const tipo of ['FIELD_PHOTO', 'DELIVERY_SUPPORT', 'TIPO_INVENTADO']) expect(statuses(await push(TECH, dev, [mkS({ document_type: tipo })]))).toEqual(['REJECTED']);
    // titular que el tipo no admite / imagen como evidencia del recorrido (debe ser PDF) / MIME no admitido / titular ambiguo
    expect(statuses(await push(TECH, dev, [mkS({ document_type: 'FIELD_EVIDENCE', mime_type: 'image/png', sha256: sha(png), size_bytes: png.length })]))).toEqual(['REJECTED']);
    expect(statuses(await push(TECH, dev, [mkS({ mime_type: 'application/zip' })]))).toEqual(['REJECTED']);
    expect(statuses(await push(TECH, dev, [mkS({ producer_local_ref: lp })]))).toEqual(['REJECTED']);
    // imagen válida como soporte ambiental: se acepta el registro, y un archivo con otros bytes se rechaza por integridad sin guardar
    const img = mkS({ mime_type: 'image/png', sha256: sha(png), size_bytes: png.length });
    expect(statuses(await push(TECH, dev, [img]))).toEqual(['ACCEPTED']);
    const mal = await http().post(base(org) + '/sync/attachments/' + img.operation_id + '/content').set(as(TECH)).field('device_id', dev).attach('file', Buffer.concat([png, Buffer.from([1])]), { filename: 'x.png', contentType: 'image/png' });
    expect(mal.status).toBeGreaterThanOrEqual(400);
    // contenido que no es un PDF aunque se declare como PDF: el servidor decide por la firma de bytes
    const falso = mkS({ sha256: sha(Buffer.from('no soy un pdf')), size_bytes: Buffer.from('no soy un pdf').length });
    await push(TECH, dev, [falso]);
    expect((await http().post(base(org) + '/sync/attachments/' + falso.operation_id + '/content').set(as(TECH)).field('device_id', dev).attach('file', Buffer.from('no soy un pdf'), { filename: 'x.pdf', contentType: 'application/pdf' })).status).toBeGreaterThanOrEqual(400);
    const guardados = await h.db.selectFrom('document_versions').select(h.db.fn.countAll().as('n')).where('organization_id', '=', org).where('operation_id', 'in', [img.operation_id, falso.operation_id]).executeTakeFirstOrThrow();
    expect(Number(guardados.n)).toBe(0);
    // otra persona (TECH2) no puede subir el archivo de una operación ajena; el Productor sin permiso de subir ni registra
    const ok = mkS({}); expect(statuses(await push(TECH, dev, [ok]))).toEqual(['ACCEPTED']);
    expect((await http().post(base(org) + '/sync/attachments/' + ok.operation_id + '/content').set(as(TECH2)).field('device_id', await device(TECH2)).attach('file', pdf, { filename: 'x.pdf', contentType: 'application/pdf' })).status).toBeGreaterThanOrEqual(400);
    // la referencia de tipos documentales llega solo a quien puede subir documentos
    const pull = await http().get(base(org) + '/sync/pull?device_id=' + dev).set(as(TECH)).expect(200);
    expect(pull.body.reference.document_types.map((t: { code: string }) => t.code)).toEqual(['ENVIRONMENTAL_SUPPORT', 'FIELD_EVIDENCE', 'LABOR_SUPPORT', 'LAND_TENURE', 'THIRD_PARTY_RIGHTS_SUPPORT']);
  });
});
