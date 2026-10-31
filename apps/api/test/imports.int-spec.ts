import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { buildZip, writeXlsx } from '../src/imports/xlsx';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Integración P0-026 (RF-26 / QA-03) contra PostgreSQL real.
describeDb('P0-026 importación Excel de productores (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const http = () => h.http();
  const as = (email: string) => h.as(email);
  const base = (org: string) => `/api/v1/organizations/${org}/imports`;
  const ADMIN = 'admin-a@test.local';
  const HEAD = ['codigo_productor', 'nombres', 'apellidos', 'razon_social', 'tipo_documento', 'numero_documento', 'comunidad', 'provincia'];
  const book = (rows: string[][], head = HEAD) => writeXlsx([{ name: 'productores', rows: [head, ...rows] }]);
  const fullMap = { A: 'producer_code', B: 'first_name', C: 'last_name', D: 'legal_name', E: 'document_type', F: 'document_number', G: 'community', H: 'province' };

  async function join(admin: string, org: string, email: string, role: string) {
    const inv = await http().post(`/api/v1/organizations/${org}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const upload = (actor: string, org: string, buf: Buffer, name = 'productores.xlsx', op = randomUUID()) =>
    http().post(base(org)).set(as(actor)).field('operation_id', op).attach('file', buf, name);
  async function staged(actor: string, org: string, buf: Buffer, columns: Record<string, string> = fullMap) {
    const up = await upload(actor, org, buf).expect(201);
    const id = up.body.batch.id as string;
    const m = await http().post(`${base(org)}/${id}/mapping`).set(as(actor)).send({ columns, expected_version: up.body.batch.row_version }).expect(200);
    const pv = await http().get(`${base(org)}/${id}/preview`).set(as(actor)).expect(200);
    return { id, up: up.body, mapping: m.body, preview: pv.body };
  }
  const commit = (actor: string, org: string, id: string, planHash: string, op = randomUUID()) =>
    http().post(`${base(org)}/${id}/commit`).set(as(actor)).send({ operation_id: op, plan_hash: planHash });
  const counts = async (org: string) => {
    const n = async (t: 'producers' | 'producer_versions' | 'domain_events') => Number((await h.db.selectFrom(t).select(sql<string>`count(*)`.as('n')).where('organization_id', '=', org).executeTakeFirstOrThrow()).n);
    return { producers: await n('producers'), versions: await n('producer_versions'), events: await n('domain_events') };
  };
  const producer = (org: string, code: string) => h.db.selectFrom('producers').selectAll().where('organization_id', '=', org).where('producer_code', '=', code).executeTakeFirst();

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local'))
        .send({ name, organization_type: 'ASSOCIATION', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Asociación A', ADMIN);
    orgB = await mk('Asociación B', 'admin-b@test.local');
    await join(ADMIN, orgA, 'supervisor@test.local', 'MANAGER');
    await join(ADMIN, orgA, 'tecnico@test.local', 'FIELD_TECHNICIAN');
    await join(ADMIN, orgA, 'auditor@test.local', 'AUDITOR');
  });
  afterAll(async () => h?.close());

  it('plantilla: rol autorizado la descarga; rol sin permiso 403; organización ajena 404', async () => {
    const info = await http().get(`${base(orgA)}/templates/producers`).set(as(ADMIN)).expect(200);
    expect(info.body.fields.map((f: { header: string }) => f.header)).toEqual(['codigo_productor', 'nombres', 'apellidos', 'razon_social', 'tipo_documento', 'numero_documento', 'telefono', 'direccion', 'comunidad', 'provincia', 'canton', 'parroquia']);
    expect(info.body.atomicity.mode).toBe('ATOMIC');
    const file = await http().get(`${base(orgA)}/templates/producers.xlsx`).set(as('supervisor@test.local')).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect((file.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    await http().get(`${base(orgA)}/templates/producers`).set(as('tecnico@test.local')).expect(403);
    await http().get(`${base(orgA)}/templates/producers`).set(as('auditor@test.local')).expect(403);
    await http().get(`${base(orgA)}/templates/producers`).set(as('admin-b@test.local')).expect(404);
  });

  it('carga, mapeo y vista previa no modifican entidades; altas en BORRADOR; datos heredados/faltantes explícitos', async () => {
    const before = await counts(orgA);
    const s = await staged(ADMIN, orgA, book([
      ['PRD-001', 'Ana', 'Cedeño', '', 'CEDULA', '0912345678', 'La Unión', ''],
      ['PRD-002', '', '', 'Finca Río SA', '', '', '', 'Manabí'],
    ]));
    expect(s.up.batch.columns[0]).toMatchObject({ column: 'A', header: 'codigo_productor', suggested_field: 'producer_code', mapped_field: null });
    expect(s.preview).toMatchObject({ persisted: false, can_commit: true, summary: { total: 2, create: 2, update: 0, unchanged: 0, error: 0 }, new_status: 'DRAFT' });
    const r1 = s.preview.rows[0];
    expect(r1.fields.province).toEqual({ state: 'MISSING', quality: 'MISSING' });
    expect(r1.fields.phone).toEqual({ state: 'NOT_MAPPED', quality: 'UNKNOWN' });
    expect(r1.fields.first_name).toEqual({ state: 'PROVIDED', quality: 'LEGACY', value: 'Ana' });
    expect(r1.validation_status).toBe('NOT_VALIDATED');
    expect(await counts(orgA)).toEqual(before);

    const c = await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    expect(c.body.summary).toMatchObject({ created: 2, updated: 0, unchanged: 0, failed: 0, new_status: 'DRAFT' });
    const p1 = await producer(orgA, 'PRD-001');
    expect(p1).toMatchObject({ status: 'DRAFT', first_name: 'Ana', community: 'La Unión', province: null });
    expect(p1!.document_number_enc).not.toContain('0912345678'); // identidad cifrada por el caso de uso
    const v = await h.db.selectFrom('producer_versions').select(['change_type', 'reason']).where('producer_id', '=', p1!.id).executeTakeFirstOrThrow();
    expect(v.change_type).toBe('IMPORT_CREATE');
    expect(v.reason).toContain(s.id);
    const ev = await h.db.selectFrom('domain_events').select(['event_type', 'payload']).where('aggregate_id', '=', p1!.id).executeTakeFirstOrThrow();
    expect(ev).toMatchObject({ event_type: 'ProducerRegistered', payload: { source: { kind: 'EXCEL_IMPORT', import_batch_id: s.id, row_number: 2 } } });
    expect(JSON.stringify(ev.payload)).not.toContain('0912345678');
    const audit = await h.db.selectFrom('audit_logs').select(['action']).where('organization_id', '=', orgA).where('entity_id', '=', s.id).execute();
    expect(audit.map((a) => a.action).sort()).toEqual(['import.commit', 'import.map', 'import.upload']);
  });

  it('reimportar el mismo archivo no duplica ni produce efectos; confirmación idempotente por operation_id', async () => {
    const before = await counts(orgA);
    const s = await staged(ADMIN, orgA, book([
      ['PRD-001', 'Ana', 'Cedeño', '', 'CEDULA', '0912345678', 'La Unión', ''],
      ['PRD-002', '', '', 'Finca Río SA', '', '', '', 'Manabí'],
    ]));
    expect(s.up.batch.same_file_previous_imports.length).toBeGreaterThanOrEqual(1);
    expect(s.preview.summary).toMatchObject({ create: 0, update: 0, unchanged: 2, error: 0 });
    expect(s.preview.can_commit).toBe(false);
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(409);
    expect(await counts(orgA)).toEqual(before);

    const s2 = await staged(ADMIN, orgA, book([['PRD-003', 'Luis', 'Mera', '', '', '', '', '']]));
    const op = randomUUID();
    const first = await commit(ADMIN, orgA, s2.id, s2.preview.plan_hash, op).expect(201);
    const again = await commit(ADMIN, orgA, s2.id, s2.preview.plan_hash, op).expect(200);
    expect(again.body).toMatchObject({ replayed: true, summary: first.body.summary });
    await commit(ADMIN, orgA, s2.id, s2.preview.plan_hash).expect(409);
    expect((await counts(orgA)).producers).toBe(before.producers + 1);
  });

  it('mapeo parcial: columna sin mapear y celda vacía no cambian; #BORRAR vacía expresamente', async () => {
    await h.db.updateTable('producers').set({ province: 'Esmeraldas' }).where('organization_id', '=', orgA).where('producer_code', '=', 'PRD-001').execute();
    // Columnas: código, nombre, comunidad (vacía), provincia (#BORRAR). Apellidos y documento: sin mapear.
    const s = await staged(ADMIN, orgA, book([['PRD-001', 'Ana María', '', '#BORRAR']], ['codigo_productor', 'nombres', 'comunidad', 'provincia']), { A: 'producer_code', B: 'first_name', C: 'community', D: 'province' });
    const row = s.preview.rows[0];
    expect(row).toMatchObject({ action: 'UPDATE', changed_fields: ['first_name', 'province'] });
    expect(row.fields.community).toEqual({ state: 'MISSING', quality: 'MISSING' });
    expect(row.fields.province).toEqual({ state: 'CLEAR', quality: 'MISSING', value: null });
    expect(row.fields.last_name.state).toBe('NOT_MAPPED');
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    const p = await producer(orgA, 'PRD-001');
    expect(p).toMatchObject({ first_name: 'Ana María', last_name: 'Cedeño', community: 'La Unión', province: null });
    expect(p!.document_number_enc).not.toBeNull(); // identidad fuera del mapeo conservada
    const v = await h.db.selectFrom('producer_versions').select(['change_type', 'changed_fields']).where('producer_id', '=', p!.id).orderBy('version', 'desc').executeTakeFirstOrThrow();
    expect(v).toEqual({ change_type: 'IMPORT_UPDATE', changed_fields: ['first_name', 'province'] });
  });

  it('errores por fila: fórmula, código repetido o inválido, nombre y documento incompletos; lote no confirmable', async () => {
    const sheet = '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="inlineStr"><is><t>codigo_productor</t></is></c><c r="B1" t="inlineStr"><is><t>razon_social</t></is></c><c r="C1" t="inlineStr"><is><t>numero_documento</t></is></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>PRD-010</t></is></c><c r="B2" t="str"><f>CONCAT("a","b")</f><v>ab</v></c></row>'
      + '<row r="3"><c r="A3" t="inlineStr"><is><t>PRD-011</t></is></c><c r="B3" t="inlineStr"><is><t>X</t></is></c></row>'
      + '<row r="4"><c r="A4" t="inlineStr"><is><t>PRD-011</t></is></c><c r="B4" t="inlineStr"><is><t>Y</t></is></c></row>'
      + '<row r="5"><c r="A5" t="inlineStr"><is><t>mal código!</t></is></c><c r="B5" t="inlineStr"><is><t>Z</t></is></c></row>'
      + '<row r="6"><c r="A6" t="inlineStr"><is><t>PRD-012</t></is></c><c r="B6" t="inlineStr"><is><t>W</t></is></c><c r="C6"><v>912345678</v></c></row>'
      + '</sheetData></worksheet>';
    const buf = buildZip([
      { name: '[Content_Types].xml', data: Buffer.from('<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>') },
      { name: 'xl/workbook.xml', data: Buffer.from('<workbook xmlns:r="r"><sheets><sheet name="productores" sheetId="1" r:id="rId1"/></sheets></workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>') },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
    ]);
    const before = await counts(orgA);
    const s = await staged(ADMIN, orgA, buf, { A: 'producer_code', B: 'legal_name', C: 'document_number' });
    const codes = (n: number) => s.preview.rows.find((r: { row_number: number }) => r.row_number === n).errors.map((e: { code: string }) => e.code);
    expect(codes(2)).toEqual(expect.arrayContaining(['FORMULA_NOT_ALLOWED']));
    expect(codes(3)).toContain('DUPLICATE_IN_FILE');
    expect(codes(4)).toContain('DUPLICATE_IN_FILE');
    expect(codes(5)).toContain('INVALID_FORMAT');
    expect(codes(6)).toContain('DOCUMENT_PAIR_REQUIRED');
    expect(s.preview.rows.find((r: { row_number: number }) => r.row_number === 6).warnings.map((w: { code: string }) => w.code)).toContain('NUMERIC_CELL');
    expect(s.preview).toMatchObject({ can_commit: false, summary: { error: 5 } });
    const c = await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(422);
    expect(c.body.error.code).toBe('BATCH_HAS_ERRORS');
    expect(await counts(orgA)).toEqual(before);
    const rep = await http().get(`${base(orgA)}/${s.id}/report`).set(as(ADMIN)).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); }).expect(200);
    expect((rep.body as Buffer).toString('latin1')).not.toContain('912345678'); // el informe no lleva valores de identidad
  });

  it('archivo: solo .xlsx; macros rechazadas; operation_id reutilizado con otro archivo → 409', async () => {
    await upload(ADMIN, orgA, Buffer.from('a,b'), 'productores.csv').expect(422);
    const macro = buildZip([{ name: '[Content_Types].xml', data: Buffer.from('<Types/>') }, { name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') }, { name: 'xl/vbaProject.bin', data: Buffer.from('x') }]);
    const r = await upload(ADMIN, orgA, macro).expect(422);
    expect(r.body.error.code).toBe('MACROS_NOT_ALLOWED');
    const op = randomUUID();
    await upload(ADMIN, orgA, book([['PRD-050', 'A', 'B', '', '', '', '', '']]), 'x.xlsx', op).expect(201);
    await upload(ADMIN, orgA, book([['PRD-050', 'A', 'B', '', '', '', '', '']]), 'x.xlsx', op).expect(200);
    await upload(ADMIN, orgA, book([['PRD-051', 'A', 'B', '', '', '', '', '']]), 'x.xlsx', op).expect(409);
  });

  it('confirmación revalida versiones: un cambio posterior a la vista previa → 409 PREVIEW_STALE y nada se guarda', async () => {
    const s = await staged(ADMIN, orgA, book([['PRD-003', 'Luis Alberto', 'Mera', '', '', '', '', ''], ['PRD-060', 'Nueva', 'Fila', '', '', '', '', '']]));
    const p = await producer(orgA, 'PRD-003');
    await http().patch(`/api/v1/organizations/${orgA}/producers/${p!.id}`).set(as(ADMIN)).send({ community: 'Otra', expected_version: Number(p!.row_version) }).expect(200);
    const before = await counts(orgA);
    const c = await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(409);
    expect(c.body.error.code).toBe('PREVIEW_STALE');
    expect(await counts(orgA)).toEqual(before);
    expect(await producer(orgA, 'PRD-060')).toBeUndefined();
  });

  it('concurrencia: dos lotes que crean el mismo código → uno confirma, el otro revierte completo (rollback)', async () => {
    const a = await staged(ADMIN, orgA, book([['PRD-070', 'Uno', 'A', '', '', '', '', ''], ['PRD-071', 'Solo', 'Lote A', '', '', '', '', '']]));
    const b = await staged('supervisor@test.local', orgA, book([['PRD-072', 'Solo', 'Lote B', '', '', '', '', ''], ['PRD-070', 'Uno', 'B', '', '', '', '', '']]));
    const [ra, rb] = await Promise.all([commit(ADMIN, orgA, a.id, a.preview.plan_hash), commit('supervisor@test.local', orgA, b.id, b.preview.plan_hash)]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = ra.status === 409 ? ra : rb;
    // Solapadas: el índice único detiene al segundo (IMPORT_CONCURRENT_CHANGE). Serializadas: su plan ya ve el código
    // creado y no coincide con la vista previa (PREVIEW_STALE). En ambos casos no se guarda nada del lote perdedor.
    expect(['IMPORT_CONCURRENT_CHANGE', 'PREVIEW_STALE']).toContain(loser.body.error.code);
    const winnerOnly = ra.status === 201 ? 'PRD-071' : 'PRD-072';
    const loserOnly = ra.status === 201 ? 'PRD-072' : 'PRD-071';
    expect(await producer(orgA, winnerOnly)).toBeDefined();
    expect(await producer(orgA, loserOnly)).toBeUndefined(); // la otra fila del lote perdedor tampoco quedó
    const n = await h.db.selectFrom('producers').select(sql<string>`count(*)`.as('n')).where('organization_id', '=', orgA).where('producer_code', '=', 'PRD-070').executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(1);
    const loserId = ra.status === 409 ? a.id : b.id;
    expect((await h.db.selectFrom('import_batches').select('status').where('id', '=', loserId).executeTakeFirstOrThrow()).status).toBe('MAPPED');
  });

  it('permisos retirados entre vista previa y confirmación: la autorización de la vista previa no basta', async () => {
    const s = await staged('supervisor@test.local', orgA, book([['PRD-080', 'Rosa', 'Loor', '', '', '', '', '']]));
    const m = await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', 'supervisor@test.local').where('m.organization_id', '=', orgA).executeTakeFirstOrThrow();
    await h.db.updateTable('role_assignments').set({ role_code: 'FIELD_TECHNICIAN' }).where('membership_id', '=', m.id).execute();
    await commit('supervisor@test.local', orgA, s.id, s.preview.plan_hash).expect(403);
    await http().get(`${base(orgA)}/${s.id}/preview`).set(as('supervisor@test.local')).expect(403);
    expect(await producer(orgA, 'PRD-080')).toBeUndefined();
    await h.db.updateTable('role_assignments').set({ role_code: 'MANAGER' }).where('membership_id', '=', m.id).execute();
  });

  it('aislamiento: lote ajeno 404 sin datos; mismo código en otra organización es otra entidad', async () => {
    const s = await staged(ADMIN, orgA, book([['PRD-090', 'Ana', 'B', '', '', '', '', '']]));
    for (const path of ['', '/preview', '/report']) await http().get(`${base(orgA)}/${s.id}${path}`).set(as('admin-b@test.local')).expect(404);
    await http().post(`${base(orgB)}/${s.id}/commit`).set(as('admin-b@test.local')).send({ operation_id: randomUUID(), plan_hash: s.preview.plan_hash }).expect(404);
    expect((await http().get(base(orgB)).set(as('admin-b@test.local')).expect(200)).body).toEqual([]);
    // PRD-001 existe en A; en B se crea uno nuevo, sin leer ni tocar el de A.
    const sb = await staged('admin-b@test.local', orgB, book([['PRD-001', 'Otra', 'Persona', '', '', '', '', '']]));
    expect(sb.preview.rows[0]).toMatchObject({ action: 'CREATE', producer_id: null });
    await commit('admin-b@test.local', orgB, sb.id, sb.preview.plan_hash).expect(201);
    expect((await producer(orgA, 'PRD-001'))!.first_name).toBe('Ana María');
  });

  it('productor dado de baja no se reactiva ni se edita por importación; descartar elimina las celdas leídas', async () => {
    const p = await producer(orgA, 'PRD-002');
    await http().post(`/api/v1/organizations/${orgA}/producers/${p!.id}/archive`).set(as(ADMIN)).send({ expected_version: Number(p!.row_version), reason: 'Baja de prueba' }).expect(200);
    const s = await staged(ADMIN, orgA, book([['PRD-002', '', '', 'Finca Río Nueva', '', '', '', '']]));
    expect(s.preview.rows[0].errors.map((e: { code: string }) => e.code)).toEqual(['PRODUCER_INACTIVE']);
    await http().post(`${base(orgA)}/${s.id}/discard`).set(as(ADMIN)).expect(200);
    const cells = await h.db.selectFrom('import_rows').select('cells_enc').where('batch_id', '=', s.id).execute();
    expect(cells.every((c) => c.cells_enc === null)).toBe(true);
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(409);
  });
});
