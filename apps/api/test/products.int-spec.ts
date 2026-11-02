import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Integración P0-011 Productos: catálogo por organización, estados y unidades de sistema, PostgreSQL real.
describeDb('P0-011 productos y unidades', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const create = (actor: string, body: Record<string, unknown>, o = orgA) => http().post(`${base(o)}/products`).set(as(actor)).send(body);
  const SECO = { code: 'CACAO_SECO', name: 'Cacao seco', product_state: 'CACAO_SECO', unit: 'KG', scientific_name: 'Theobroma cacao' };

  async function join(admin: string, o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop A', 'admin-a@test.local');
    orgB = await mk('Coop B', 'admin-b@test.local');
    await join('admin-a@test.local', orgA, 'recepcion@test.local', 'RECEPTION_OPERATOR');
    await join('admin-a@test.local', orgA, 'manager@test.local', 'MANAGER');
    await join('admin-a@test.local', orgA, 'comprador@test.local', 'BUYER');
  });
  afterAll(async () => h?.close());

  let secoId: string;

  it('opciones desde la API: estados y unidades de las fuentes, sin conversiones', async () => {
    const r = (await http().get(`${base(orgA)}/product-catalog/options`).set(as('recepcion@test.local')).expect(200)).body;
    expect(r.states.map((s: { code: string }) => s.code)).toEqual(['CACAO_BABA', 'CACAO_FERMENTADO', 'CACAO_SECO', 'CACAO_CLASIFICADO']);
    expect(r.units).toEqual([expect.objectContaining({ code: 'KG', dimension: 'MASS', symbol: 'kg' })]);
    expect(r.conversions).toEqual([]);
    expect(r.immutable_fields).toEqual(['code', 'product_state', 'unit']);
  });

  it('alta por administrador con unidad y estado explícitos; historia, evento y auditoría', async () => {
    const r = await create('admin-a@test.local', SECO).expect(201);
    secoId = r.body.id;
    expect(r.body).toMatchObject({ code: 'CACAO_SECO', status: 'ACTIVE', row_version: 1, product_state: { code: 'CACAO_SECO', label: 'Cacao seco' }, unit: { code: 'KG', dimension: 'MASS' } });
    const hist = (await http().get(`${base(orgA)}/products/${secoId}/history`).set(as('admin-a@test.local')).expect(200)).body;
    expect(hist[0]).toMatchObject({ change_type: 'CREATED' });
    const ev = await h.db.selectFrom('domain_events').select(['event_type', 'aggregate_version']).where('aggregate_id', '=', secoId).execute();
    expect(ev.map((e) => [e.event_type, Number(e.aggregate_version)])).toEqual([['ProductCreated', 1]]);
    expect(await h.db.selectFrom('audit_logs').select('action').where('entity_id', '=', secoId).execute()).toEqual([{ action: 'product.created' }]);
  });

  it('consulta y administración según rol; usuario sin permiso 403; otra organización 404', async () => {
    const list = (await http().get(`${base(orgA)}/products`).set(as('recepcion@test.local')).expect(200)).body;
    expect(list).toMatchObject({ can_manage: false, items: [expect.objectContaining({ code: 'CACAO_SECO' })] });
    await create('recepcion@test.local', { ...SECO, code: 'X1' }).expect(403);
    await create('manager@test.local', { ...SECO, code: 'X2' }).expect(403);
    await http().get(`${base(orgA)}/products`).set(as('comprador@test.local')).expect(403);
    await http().get(`${base(orgA)}/products/${secoId}`).set(as('admin-b@test.local')).expect(404);
    await http().get(`${base(orgB)}/products/${secoId}`).set(as('admin-b@test.local')).expect(404);
    // el mismo código es válido en otra organización (ámbito por organización)
    await create('admin-b@test.local', SECO, orgB).expect(201);
    expect((await http().get(`${base(orgB)}/products`).set(as('admin-b@test.local')).expect(200)).body.items).toHaveLength(1);
  });

  it('búsqueda, filtro por estado y paginación estable', async () => {
    await create('admin-a@test.local', { code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201);
    await create('admin-a@test.local', { code: 'CACAO_FERMENTADO', name: 'Cacao fermentado', product_state: 'CACAO_FERMENTADO', unit: 'KG' }).expect(201);
    const q = (await http().get(`${base(orgA)}/products?q=baba`).set(as('admin-a@test.local')).expect(200)).body.items;
    expect(q.map((p: { code: string }) => p.code)).toEqual(['CACAO_BABA']);
    const byState = (await http().get(`${base(orgA)}/products?product_state=CACAO_FERMENTADO`).set(as('admin-a@test.local')).expect(200)).body.items;
    expect(byState).toHaveLength(1);
    const p1 = (await http().get(`${base(orgA)}/products?limit=2`).set(as('admin-a@test.local')).expect(200)).body;
    const p2 = (await http().get(`${base(orgA)}/products?limit=2&cursor=${p1.next_cursor}`).set(as('admin-a@test.local')).expect(200)).body;
    expect([...p1.items, ...p2.items].map((p: { code: string }) => p.code)).toEqual(['CACAO_BABA', 'CACAO_FERMENTADO', 'CACAO_SECO']);
    expect((await http().get(`${base(orgA)}/products?q=zzz`).set(as('admin-a@test.local')).expect(200)).body.items).toEqual([]);
  });

  it('validaciones: estado o unidad desconocidos, código inválido; unicidad bajo concurrencia', async () => {
    expect((await create('admin-a@test.local', { ...SECO, code: 'Q1', product_state: 'CACAO_TOSTADO' }).expect(422)).body.error.code).toBe('PRODUCT_STATE_UNKNOWN');
    expect((await create('admin-a@test.local', { ...SECO, code: 'Q2', unit: 'QQ' }).expect(422)).body.error.code).toBe('UNIT_UNKNOWN');
    await create('admin-a@test.local', { ...SECO, code: 'minúsculas' }).expect(400);
    const body = { code: 'CACAO_CLASIFICADO', name: 'Cacao clasificado', product_state: 'CACAO_CLASIFICADO', unit: 'KG' };
    const results = await Promise.all([1, 2, 3].map(() => create('admin-a@test.local', body)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('PRODUCT_CODE_TAKEN');
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM products WHERE organization_id = ${orgA} AND code = 'CACAO_CLASIFICADO'`.execute(h.db)).rows[0].n).toBe(1);
  });

  it('edición concurrente: una gana, la otra 409 sin efectos; atributos inmutables rechazados', async () => {
    const [a, b] = await Promise.all([
      http().patch(`${base(orgA)}/products/${secoId}`).set(as('admin-a@test.local')).send({ expected_version: 1, name: 'Cacao seco A' }),
      http().patch(`${base(orgA)}/products/${secoId}`).set(as('admin-a@test.local')).send({ expected_version: 1, name: 'Cacao seco B' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const cur = (await http().get(`${base(orgA)}/products/${secoId}`).set(as('admin-a@test.local')).expect(200)).body;
    expect(cur.row_version).toBe(2);
    for (const f of [{ unit: 'G' }, { product_state: 'CACAO_BABA' }, { code: 'OTRO' }]) {
      const r = await http().patch(`${base(orgA)}/products/${secoId}`).set(as('admin-a@test.local')).send({ expected_version: 2, ...f }).expect(422);
      expect(r.body.error.code).toBe('PRODUCT_FIELD_IMMUTABLE');
    }
    await expect(sql`UPDATE products SET unit = 'KG', product_state = 'CACAO_BABA' WHERE id = ${secoId}`.execute(h.db)).rejects.toThrow(/inmutables/);
    await expect(sql`DELETE FROM products WHERE id = ${secoId}`.execute(h.db)).rejects.toThrow(/borrado/);
    await expect(sql`DELETE FROM product_versions WHERE product_id = ${secoId}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`UPDATE measurement_units SET dimension = 'MASS' WHERE code = 'KG'`.execute(h.db)).rejects.toThrow(/catálogo de sistema/);
  });

  it('desactivar y activar con motivo; inactivo no se edita; historia conservada', async () => {
    const cur = (await http().get(`${base(orgA)}/products/${secoId}`).set(as('admin-a@test.local')).expect(200)).body;
    await http().post(`${base(orgA)}/products/${secoId}/deactivate`).set(as('admin-a@test.local')).send({ expected_version: cur.row_version, reason: 'x' }).expect(400);
    const off = (await http().post(`${base(orgA)}/products/${secoId}/deactivate`).set(as('admin-a@test.local')).send({ expected_version: cur.row_version, reason: 'Ya no se compra' }).expect(200)).body;
    expect(off).toMatchObject({ status: 'INACTIVE', status_reason: 'Ya no se compra' });
    expect((await http().get(`${base(orgA)}/products`).set(as('admin-a@test.local')).expect(200)).body.items.map((p: { code: string }) => p.code)).not.toContain('CACAO_SECO');
    expect((await http().get(`${base(orgA)}/products?status=INACTIVE`).set(as('admin-a@test.local')).expect(200)).body.items.map((p: { code: string }) => p.code)).toEqual(['CACAO_SECO']);
    expect((await http().patch(`${base(orgA)}/products/${secoId}`).set(as('admin-a@test.local')).send({ expected_version: off.row_version, name: 'n' }).expect(409)).body.error.code).toBe('PRODUCT_INACTIVE');
    await http().post(`${base(orgA)}/products/${secoId}/deactivate`).set(as('admin-a@test.local')).send({ expected_version: off.row_version, reason: 'otra vez' }).expect(409);
    const on = (await http().post(`${base(orgA)}/products/${secoId}/activate`).set(as('admin-a@test.local')).send({ expected_version: off.row_version, reason: 'Se retoma la compra' }).expect(200)).body;
    expect(on).toMatchObject({ status: 'ACTIVE', status_reason: null });
    const hist = (await http().get(`${base(orgA)}/products/${secoId}/history`).set(as('admin-a@test.local')).expect(200)).body;
    expect(hist.map((x: { change_type: string }) => x.change_type)).toEqual(['ACTIVATED', 'DEACTIVATED', 'UPDATED', 'CREATED']);
    expect(hist[3].snapshot).toMatchObject({ name: 'Cacao seco', unit: 'KG' }); // la versión original se conserva
  });

  it('organización suspendida: consulta sí, administración no', async () => {
    await http().post(`${base(orgA)}/suspend`).set(as('super@test.local')).send({ reason: 'Revisión' }).expect(200);
    await http().get(`${base(orgA)}/products`).set(as('admin-a@test.local')).expect(200);
    expect((await create('admin-a@test.local', { ...SECO, code: 'S1' }).expect(403)).body.error.code).toBe('ORGANIZATION_SUSPENDED');
    await http().post(`${base(orgA)}/reactivate`).set(as('super@test.local')).send({ reason: 'Fin' }).expect(200);
  });

  it('rollback sin efectos parciales', async () => {
    const count = async () => ({
      p: (await sql<{ n: number }>`SELECT count(*)::int AS n FROM products`.execute(h.db)).rows[0].n,
      e: (await sql<{ n: number }>`SELECT count(*)::int AS n FROM domain_events WHERE aggregate_type = 'PRODUCT'`.execute(h.db)).rows[0].n,
      a: (await sql<{ n: number }>`SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'product'`.execute(h.db)).rows[0].n,
    });
    const before = await count();
    await sql`CREATE OR REPLACE FUNCTION p011_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falla forzada'; END $$`.execute(h.db);
    await sql`CREATE TRIGGER p011_fail BEFORE INSERT ON product_versions FOR EACH ROW EXECUTE FUNCTION p011_fail()`.execute(h.db);
    try {
      await create('admin-a@test.local', { ...SECO, code: 'ROLLBACK' }).expect(500);
    } finally {
      await sql`DROP TRIGGER p011_fail ON product_versions`.execute(h.db);
      await sql`DROP FUNCTION p011_fail`.execute(h.db);
    }
    expect(await count()).toEqual(before);
  });
});
