import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { writeXlsx } from '../src/imports/xlsx';
import { ProductsService } from '../src/products/products';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Integración P0-026 plantilla PRODUCTOS_V1 (RF-26 / QA-03) contra PostgreSQL real. Archivos sintéticos.
describeDb('P0-026 importación Excel de productos (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const http = () => h.http();
  const as = (email: string) => h.as(email);
  const base = (org: string) => `/api/v1/organizations/${org}/imports`;
  const ADMIN = 'admin-a@test.local';
  const ADMIN2 = 'admin2-a@test.local';
  const MANAGER = 'supervisor@test.local';
  const HEAD = ['codigo_producto', 'nombre', 'estado_presentacion', 'unidad', 'nombre_cientifico', 'variedad'];
  const MAP = { A: 'code', B: 'name', C: 'product_state', D: 'unit', E: 'scientific_name', F: 'variety' };
  const book = (rows: string[][], head = HEAD) => writeXlsx([{ name: 'productos', rows: [head, ...rows] }]);

  async function join(admin: string, org: string, email: string, role: string) {
    const inv = await http().post(`/api/v1/organizations/${org}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const upload = (actor: string, org: string, buf: Buffer, op = randomUUID()) =>
    http().post(base(org)).set(as(actor)).field('operation_id', op).field('template', 'PRODUCTOS_V1').attach('file', buf, 'productos.xlsx');
  async function staged(actor: string, org: string, buf: Buffer, columns: Record<string, string> = MAP) {
    const up = await upload(actor, org, buf).expect(201);
    const id = up.body.batch.id as string;
    await http().post(`${base(org)}/${id}/mapping`).set(as(actor)).send({ columns, expected_version: up.body.batch.row_version }).expect(200);
    const preview = (await http().get(`${base(org)}/${id}/preview`).set(as(actor)).expect(200)).body;
    return { id, up: up.body, preview };
  }
  const commit = (actor: string, org: string, id: string, planHash: string, op = randomUUID()) =>
    http().post(`${base(org)}/${id}/commit`).set(as(actor)).send({ operation_id: op, plan_hash: planHash });
  const product = (org: string, code: string) => h.db.selectFrom('products').selectAll().where('organization_id', '=', org).where('code', '=', code).executeTakeFirst();
  const counts = async (org: string) => {
    const n = async (q: Promise<{ n: string }>) => Number((await q).n);
    return {
      products: await n(h.db.selectFrom('products').select(sql<string>`count(*)`.as('n')).where('organization_id', '=', org).executeTakeFirstOrThrow()),
      versions: await n(h.db.selectFrom('product_versions').select(sql<string>`count(*)`.as('n')).where('organization_id', '=', org).executeTakeFirstOrThrow()),
      events: await n(h.db.selectFrom('domain_events').select(sql<string>`count(*)`.as('n')).where('organization_id', '=', org).where('aggregate_type', '=', 'PRODUCT').executeTakeFirstOrThrow()),
    };
  };
  const errs = (pv: { rows: Array<{ row_number: number; errors: Array<{ code: string }> }> }, n: number) => pv.rows.find((r) => r.row_number === n)!.errors.map((e) => e.code);

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
    await join(ADMIN, orgA, MANAGER, 'MANAGER');
    await join(ADMIN, orgA, ADMIN2, 'ORG_ADMIN');
  });
  afterAll(async () => h?.close());

  it('MANAGER: import:manage no concede gestión de productos (plantilla, carga, lista y lote ajeno a su facultad)', async () => {
    const info = await http().get(`${base(orgA)}/templates/products`).set(as(ADMIN)).expect(200);
    expect(info.body).toMatchObject({ template: 'PRODUCTOS_V1', key_field: 'code', new_status: 'ACTIVE' });
    expect(info.body.fields.filter((f: { immutable: boolean }) => f.immutable).map((f: { field: string }) => f.field)).toEqual(['product_state', 'unit']);
    const tpls = await http().get(`${base(orgA)}/templates`).set(as(MANAGER)).expect(200);
    expect(tpls.body).toEqual(expect.arrayContaining([expect.objectContaining({ template: 'PRODUCTOS_V1', usable: false, required_permission: 'product:manage' }), expect.objectContaining({ template: 'PRODUCTORES_V1', usable: true })]));
    await http().get(`${base(orgA)}/templates/products`).set(as(MANAGER)).expect(403);
    await http().get(`${base(orgA)}/templates/products.xlsx`).set(as(MANAGER)).expect(403);
    await upload(MANAGER, orgA, book([['PRD_M', 'X', 'CACAO_SECO', 'KG', '', '']])).expect(403);
    const s = await staged(ADMIN, orgA, book([['CACAO_MGR', 'Cacao para prueba', 'CACAO_SECO', 'KG', '', '']]));
    for (const path of ['', '/preview', '/report']) await http().get(`${base(orgA)}/${s.id}${path}`).set(as(MANAGER)).expect(403);
    await commit(MANAGER, orgA, s.id, s.preview.plan_hash).expect(403);
    expect((await http().get(base(orgA)).set(as(MANAGER)).expect(200)).body.some((b: { id: string }) => b.id === s.id)).toBe(false);
    expect(await product(orgA, 'CACAO_MGR')).toBeUndefined();
    await http().post(`${base(orgA)}/${s.id}/discard`).set(as(ADMIN)).expect(200);
  });

  it('errores por fila: código repetido o inválido, catálogos desconocidos, obligatorios de alta y #BORRAR no permitido; nada se escribe', async () => {
    const before = await counts(orgA);
    const s = await staged(ADMIN, orgA, book([
      ['CACAO_DUP', 'A', 'CACAO_SECO', 'KG', '', ''],
      ['CACAO_DUP', 'B', 'CACAO_SECO', 'KG', '', ''],
      ['cacao_minus', 'C', 'CACAO_SECO', 'KG', '', ''],
      ['CACAO_LB', 'D', 'CACAO_SECO', 'LB', '', ''],
      ['CACAO_X', 'E', 'CACAO_TOSTADO', 'kg', '', ''],
      ['CACAO_SIN_NOMBRE', '', 'CACAO_SECO', 'KG', '', ''],
      ['CACAO_BORRAR', '#BORRAR', 'CACAO_SECO', '#BORRAR', '', ''],
    ]));
    expect(errs(s.preview, 2)).toContain('DUPLICATE_IN_FILE');
    expect(errs(s.preview, 3)).toContain('DUPLICATE_IN_FILE');
    expect(errs(s.preview, 4)).toContain('INVALID_FORMAT');
    expect(errs(s.preview, 5)).toEqual(['UNIT_UNKNOWN']); // sin conversión de libras a kilogramos
    expect(errs(s.preview, 6)).toEqual(expect.arrayContaining(['PRODUCT_STATE_UNKNOWN', 'UNIT_UNKNOWN'])); // «kg» ≠ KG: código exacto
    expect(errs(s.preview, 7)).toEqual(['REQUIRED_FOR_CREATE']);
    expect(errs(s.preview, 8)).toEqual(['CANNOT_CLEAR', 'CANNOT_CLEAR']);
    expect(s.preview).toMatchObject({ can_commit: false, summary: { error: 7 } });
    expect((await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(422)).body.error.code).toBe('BATCH_HAS_ERRORS');
    expect(await counts(orgA)).toEqual(before);
  });

  let secoId: string;
  it('alta: producto ACTIVO con versión CREATED, procedencia en motivo, evento y auditoría; vista previa sin cambios', async () => {
    const before = await counts(orgA);
    const s = await staged(ADMIN, orgA, book([['CACAO_SECO_A', 'Cacao seco grado A', 'CACAO_SECO', 'KG', 'Theobroma cacao', 'Nacional'], ['CACAO_BABA_A', 'Cacao en baba', 'CACAO_BABA', 'KG', '', '']]));
    expect(s.preview).toMatchObject({ persisted: false, can_commit: true, new_status: 'ACTIVE', summary: { create: 2, error: 0 } });
    expect(await counts(orgA)).toEqual(before);
    const c = await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    expect(c.body.summary).toMatchObject({ created: 2, updated: 0, new_status: 'ACTIVE' });
    const p = await product(orgA, 'CACAO_SECO_A');
    secoId = p!.id;
    expect(p).toMatchObject({ status: 'ACTIVE', unit: 'KG', product_state: 'CACAO_SECO', variety: 'Nacional' });
    const v = await h.db.selectFrom('product_versions').select(['change_type', 'reason']).where('product_id', '=', p!.id).executeTakeFirstOrThrow();
    expect(v.change_type).toBe('CREATED');
    expect(v.reason).toContain(s.id);
    const ev = await h.db.selectFrom('domain_events').select(['event_type', 'payload']).where('aggregate_id', '=', p!.id).executeTakeFirstOrThrow();
    expect(ev).toMatchObject({ event_type: 'ProductCreated', payload: { source: { kind: 'EXCEL_IMPORT', import_batch_id: s.id, template: 'PRODUCTOS_V1' } } });
    const audit = await h.db.selectFrom('audit_logs').select('action').where('entity_id', '=', p!.id).execute();
    expect(audit.map((a) => a.action)).toEqual(['product.created']);
    const rows = await h.db.selectFrom('import_rows').select(['result_action', 'product_id', 'producer_id']).where('batch_id', '=', s.id).execute();
    expect(rows.every((r) => r.result_action === 'CREATED' && r.product_id && r.producer_id === null)).toBe(true);
  });

  it('reimportar sin cambios: ni versiones ni eventos de modificación; confirmación rechazada', async () => {
    const before = await counts(orgA);
    const s = await staged(ADMIN, orgA, book([['CACAO_SECO_A', 'Cacao seco grado A', 'CACAO_SECO', 'KG', 'Theobroma cacao', 'Nacional'], ['CACAO_BABA_A', 'Cacao en baba', 'CACAO_BABA', 'KG', '', '']]));
    expect(s.preview.summary).toMatchObject({ unchanged: 2, create: 0, update: 0, error: 0 });
    expect(s.up.batch.same_file_previous_imports.length).toBeGreaterThanOrEqual(1);
    expect((await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(409)).body.error.code).toBe('NOTHING_TO_IMPORT');
    expect(await counts(orgA)).toEqual(before);
  });

  it('inmutables: cambiar estado o unidad es error explícito y el lote entero no escribe (sin escritura parcial)', async () => {
    const before = await counts(orgA);
    const s = await staged(ADMIN, orgA, book([['CACAO_SECO_A', 'Cacao seco grado A', 'CACAO_FERMENTADO', 'KG', '', ''], ['CACAO_BABA_A', 'Cacao en baba (editado)', 'CACAO_BABA', 'KG', '', '']]));
    expect(errs(s.preview, 2)).toEqual(['PRODUCT_FIELD_IMMUTABLE']);
    expect(s.preview.rows[1]).toMatchObject({ action: 'UPDATE', changed_fields: ['name'] });
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(422);
    expect(await counts(orgA)).toEqual(before);
    expect((await product(orgA, 'CACAO_BABA_A'))!.name).toBe('Cacao en baba');
  });

  it('mapeo parcial, celda vacía y #BORRAR solo en opcionales editables', async () => {
    // Nombre vacío (no se borra), variedad #BORRAR (se vacía), nombre científico sin mapear (se conserva).
    const s = await staged(ADMIN, orgA, book([['CACAO_SECO_A', '', '#BORRAR']], ['codigo_producto', 'nombre', 'variedad']), { A: 'code', B: 'name', C: 'variety' });
    expect(s.preview.rows[0]).toMatchObject({ action: 'UPDATE', changed_fields: ['variety'] });
    expect(s.preview.rows[0].fields.scientific_name.state).toBe('NOT_MAPPED');
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    expect(await product(orgA, 'CACAO_SECO_A')).toMatchObject({ name: 'Cacao seco grado A', scientific_name: 'Theobroma cacao', variety: null, product_state: 'CACAO_SECO', unit: 'KG' });
    const v = await h.db.selectFrom('product_versions').select(['change_type', 'changed_fields']).where('product_id', '=', secoId).orderBy('version', 'desc').executeTakeFirstOrThrow();
    expect(v).toEqual({ change_type: 'UPDATED', changed_fields: ['variety'] });
  });

  it('producto desactivado: no se reactiva ni se edita por reimportación', async () => {
    const p = await product(orgA, 'CACAO_BABA_A');
    await http().post(`/api/v1/organizations/${orgA}/products/${p!.id}/deactivate`).set(as(ADMIN)).send({ expected_version: Number(p!.row_version), reason: 'Fuera de uso (prueba)' }).expect(200);
    const s = await staged(ADMIN, orgA, book([['CACAO_BABA_A', 'Cacao en baba nuevo nombre', 'CACAO_BABA', 'KG', '', '']]));
    expect(errs(s.preview, 2)).toEqual(['PRODUCT_INACTIVE']);
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(422);
    expect(await product(orgA, 'CACAO_BABA_A')).toMatchObject({ status: 'INACTIVE', name: 'Cacao en baba' });
  });

  it('rollback completo: un fallo en la segunda fila deshace también la primera', async () => {
    const before = await counts(orgA);
    const s = await staged(ADMIN, orgA, book([['CACAO_RB_1', 'Nuevo uno', 'CACAO_SECO', 'KG', '', ''], ['CACAO_SECO_A', 'Cacao seco renombrado', 'CACAO_SECO', 'KG', '', '']]));
    expect(s.preview.summary).toMatchObject({ create: 1, update: 1 });
    const spy = jest.spyOn(ProductsService.prototype, 'updateInTx').mockRejectedValueOnce(new Error('fallo inyectado en la fila 3'));
    try {
      await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await product(orgA, 'CACAO_RB_1')).toBeUndefined();
    expect(await counts(orgA)).toEqual(before);
    const b = await h.db.selectFrom('import_batches').select('status').where('id', '=', s.id).executeTakeFirstOrThrow();
    expect(b.status).toBe('MAPPED');
    expect((await h.db.selectFrom('import_rows').select('result_action').where('batch_id', '=', s.id).execute()).every((r) => r.result_action === null)).toBe(true);
    // Tras el fallo, la misma vista previa se confirma completa.
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    expect(await product(orgA, 'CACAO_RB_1')).toBeDefined();
  });

  it('confirmación revalida versiones (PREVIEW_STALE) y permisos (rol retirado → 403); nada se escribe', async () => {
    const s = await staged(ADMIN, orgA, book([['CACAO_SECO_A', 'Otro nombre', 'CACAO_SECO', 'KG', '', ''], ['CACAO_NUEVO_V', 'Nuevo V', 'CACAO_SECO', 'KG', '', '']]));
    const p = await product(orgA, 'CACAO_SECO_A');
    await http().patch(`/api/v1/organizations/${orgA}/products/${p!.id}`).set(as(ADMIN2)).send({ variety: 'CCN-51', expected_version: Number(p!.row_version) }).expect(200);
    expect((await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(409)).body.error.code).toBe('PREVIEW_STALE');
    expect(await product(orgA, 'CACAO_NUEVO_V')).toBeUndefined();

    const s2 = await staged(ADMIN2, orgA, book([['CACAO_PERM', 'Permiso retirado', 'CACAO_SECO', 'KG', '', '']]));
    const m = await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', ADMIN2).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow();
    await h.db.updateTable('role_assignments').set({ role_code: 'MANAGER' }).where('membership_id', '=', m.id).execute();
    await commit(ADMIN2, orgA, s2.id, s2.preview.plan_hash).expect(403);
    expect(await product(orgA, 'CACAO_PERM')).toBeUndefined();
    await h.db.updateTable('role_assignments').set({ role_code: 'ORG_ADMIN' }).where('membership_id', '=', m.id).execute();
  });

  it('concurrencia: dos lotes con el mismo código nuevo → uno confirma, el otro se revierte entero', async () => {
    const a = await staged(ADMIN, orgA, book([['CACAO_CC', 'Uno', 'CACAO_SECO', 'KG', '', ''], ['CACAO_CC_A', 'Solo A', 'CACAO_SECO', 'KG', '', '']]));
    const b = await staged(ADMIN2, orgA, book([['CACAO_CC_B', 'Solo B', 'CACAO_SECO', 'KG', '', ''], ['CACAO_CC', 'Dos', 'CACAO_SECO', 'KG', '', '']]));
    const [ra, rb] = await Promise.all([commit(ADMIN, orgA, a.id, a.preview.plan_hash), commit(ADMIN2, orgA, b.id, b.preview.plan_hash)]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(['IMPORT_CONCURRENT_CHANGE', 'PREVIEW_STALE']).toContain(loser.body.error.code);
    expect(await product(orgA, ra.status === 201 ? 'CACAO_CC_B' : 'CACAO_CC_A')).toBeUndefined();
    const n = await h.db.selectFrom('products').select(sql<string>`count(*)`.as('n')).where('organization_id', '=', orgA).where('code', '=', 'CACAO_CC').executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(1);
  });

  it('aislamiento: lote ajeno 404; mismo código en otra organización es otro producto', async () => {
    const s = await staged(ADMIN, orgA, book([['CACAO_ISO', 'Iso', 'CACAO_SECO', 'KG', '', '']]));
    for (const path of ['', '/preview', '/report']) await http().get(`${base(orgA)}/${s.id}${path}`).set(as('admin-b@test.local')).expect(404);
    await http().post(`${base(orgB)}/${s.id}/commit`).set(as('admin-b@test.local')).send({ operation_id: randomUUID(), plan_hash: s.preview.plan_hash }).expect(404);
    const sb = await staged('admin-b@test.local', orgB, book([['CACAO_SECO_A', 'Producto de B', 'CACAO_FERMENTADO', 'KG', '', '']]));
    expect(sb.preview.rows[0]).toMatchObject({ action: 'CREATE', product_id: null });
    await commit('admin-b@test.local', orgB, sb.id, sb.preview.plan_hash).expect(201);
    expect((await product(orgA, 'CACAO_SECO_A'))!.product_state).toBe('CACAO_SECO');
  });
});
