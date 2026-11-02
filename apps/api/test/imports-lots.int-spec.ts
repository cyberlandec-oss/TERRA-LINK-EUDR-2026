import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { AuthorizationService } from '../src/authz/authorization.service';
import type { Permission } from '../src/authz/catalog';
import { readXlsx, writeXlsx } from '../src/imports/xlsx';
import { LotsService } from '../src/lots/lots';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Integración P0-026 plantilla LOTES_V1 (RF-26 / QA-03, P0-016/P0-017) contra PostgreSQL real. Archivos sintéticos.
// Recepciones REALES (entregas registradas y recibidas con sus casos de uso); el ledger es la única fuente de existencia.
const FIX_SIN_ENTREGAS: Permission[] = ['organization:read', 'import:manage', 'lot:create', 'lot:read', 'product:read'];

describeDb('P0-026 importación Excel de lotes (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const fixtures = new Map<string, Permission[]>();
  const http = () => h.http();
  const as = (email: string) => h.as(email);
  const api = (o: string) => `/api/v1/organizations/${o}`;
  const base = (o: string) => `${api(o)}/imports`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local';
  const MANAGER = 'supervisor@test.local';
  const CIEGO = 'fixture-ciego@test.local';
  const HEAD = ['codigo_lote', 'referencia_importacion', 'id_recepcion', 'codigo_entrega', 'codigo_producto', 'cantidad_kg'];
  const MAP = { A: 'lot_code', B: 'import_reference', C: 'reception_id', D: 'delivery_code', E: 'product_code', F: 'quantity' };
  const book = (rows: string[][]) => writeXlsx([{ name: 'lotes', rows: [HEAD, ...rows] }]);
  const r = (o: { lot?: string; ref?: string; rec?: string; del?: string; prod?: string; qty?: string }) => [o.lot ?? '', o.ref ?? '', o.rec ?? '', o.del ?? '', o.prod ?? '', o.qty ?? ''];
  let producer: string; let plot: string; let baba: string; let seco: string; let center: string;
  const R: Record<string, { id: string; code: string }> = {};

  async function join(o: string, email: string, role: string) {
    const inv = await http().post(`${api(o)}/invitations`).set(as(ADMIN)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  /** Entrega registrada + recepción confirmada (casos de uso reales). */
  async function reception(q: string, product: string, origin: boolean) {
    const d = (await http().post(`${api(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: product, delivery_date: today, quantity_declared: q, unit: 'KG', origins: origin ? [{ plot_id: plot }] : [], register: true }).expect(201)).body.delivery;
    const id = (await http().post(`${api(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'B', quantity: q, unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    return { id: id as string, code: d.delivery_code as string };
  }
  const upload = (actor: string, o: string, buf: Buffer) => http().post(base(o)).set(as(actor)).field('operation_id', randomUUID()).field('template', 'LOTES_V1').attach('file', buf, 'lotes.xlsx');
  async function staged(actor: string, o: string, buf: Buffer) {
    const up = await upload(actor, o, buf).expect(201);
    const id = up.body.batch.id as string;
    await http().post(`${base(o)}/${id}/mapping`).set(as(actor)).send({ columns: MAP, expected_version: up.body.batch.row_version }).expect(200);
    return { id, preview: (await http().get(`${base(o)}/${id}/preview`).set(as(actor)).expect(200)).body };
  }
  const commit = (actor: string, o: string, id: string, hash: string) => http().post(`${base(o)}/${id}/commit`).set(as(actor)).send({ operation_id: randomUUID(), plan_hash: hash });
  const errs = (pv: { rows: Array<{ row_number: number; errors: Array<{ code: string }> }> }, n: number) => pv.rows.find((x) => x.row_number === n)!.errors.map((e) => e.code);
  const physical = async (key: { reception?: string; lot?: string }) => Number((await sql<{ q: string }>`SELECT coalesce(sum(signed_quantity), 0)::text AS q FROM stock_entries WHERE bucket = 'PHYSICAL' AND ${key.reception ? sql`reception_id = ${key.reception}` : sql`lot_id = ${key.lot}`}`.execute(h.db)).rows[0].q);
  const counts = async () => ({
    lots: Number((await sql<{ n: string }>`SELECT count(*) AS n FROM lots WHERE organization_id = ${orgA}`.execute(h.db)).rows[0].n),
    inputs: Number((await sql<{ n: string }>`SELECT count(*) AS n FROM lot_inputs WHERE organization_id = ${orgA}`.execute(h.db)).rows[0].n),
    movements: Number((await sql<{ n: string }>`SELECT count(*) AS n FROM stock_movements WHERE organization_id = ${orgA}`.execute(h.db)).rows[0].n),
    events: Number((await sql<{ n: string }>`SELECT count(*) AS n FROM domain_events WHERE organization_id = ${orgA} AND aggregate_type = 'LOT'`.execute(h.db)).rows[0].n),
  });
  const lotByRef = async (ref: string) => (await h.db.selectFrom('import_references as x').innerJoin('lots as l', 'l.id', 'x.lot_id').select(['l.id', 'l.lot_code', 'l.origin_status', 'l.status']).where('x.reference', '=', ref).executeTakeFirst());

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Lotes A', ADMIN);
    orgB = await mk('Coop Lotes B', 'admin-b@test.local');
    for (const [e, role] of [[MANAGER, 'MANAGER'], ['recepcion@test.local', 'RECEPTION_OPERATOR'], ['traz@test.local', 'TRACEABILITY_MANAGER'], [CIEGO, 'FIELD_TECHNICIAN']]) await join(orgA, e, role);
    fixtures.set((await h.db.selectFrom('users').select('id').where('email', '=', CIEGO).executeTakeFirstOrThrow()).id, FIX_SIN_ENTREGAS);
    const original = AuthorizationService.prototype.tenantContext;
    jest.spyOn(AuthorizationService.prototype, 'tenantContext').mockImplementation(async function (this: AuthorizationService, user, organizationId) {
      const ctx = await original.call(this, user, organizationId);
      const perms = fixtures.get(user.id);
      return ctx && perms ? { ...ctx, permissions: [...perms].sort() } : ctx;
    });
    producer = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'LT-1', legal_name: 'Finca Lotes' }).expect(201)).body.id;
    plot = (await http().post(`${api(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: 'LT-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    baba = (await http().post(`${api(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    seco = (await http().post(`${api(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_SECO', name: 'Cacao seco', product_state: 'CACAO_SECO', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${api(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CL', name: 'Centro lotes', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    R.r1 = await reception('100', baba, true);
    R.r2 = await reception('80', baba, true);
    R.r3 = await reception('50', baba, false);
    R.r4 = await reception('60', seco, true);
  });
  afterAll(async () => { jest.restoreAllMocks(); await h?.close(); });

  it('plantilla: admin y MANAGER; recepción y trazabilidad (sin import:manage) 403; la plantilla trae las recepciones disponibles', async () => {
    const info = await http().get(`${base(orgA)}/templates/lots`).set(as(ADMIN)).expect(200);
    expect(info.body).toMatchObject({ template: 'LOTES_V1', key_field: 'lot_code' });
    const file = await http().get(`${base(orgA)}/templates/lots.xlsx`).set(as(MANAGER)).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    const help = readXlsx(file.body as Buffer, 'recepciones_disponibles');
    expect(help.name).toBe('recepciones_disponibles');
    expect(help.rows.slice(1).map((x) => x.cells[0]?.value)).toEqual(expect.arrayContaining([R.r1.id, R.r2.id, R.r3.id, R.r4.id]));
    await http().get(`${base(orgA)}/templates/lots`).set(as('recepcion@test.local')).expect(403);
    await http().get(`${base(orgA)}/templates/lots`).set(as('traz@test.local')).expect(403);
    await http().get(`${base(orgA)}/templates/lots`).set(as('admin-b@test.local')).expect(404);
  });

  it('lote nuevo por referencia: la vista previa explica movimientos y no escribe; la confirmación usa el ledger y deja procedencia', async () => {
    const before = await counts();
    const s = await staged(ADMIN, orgA, book([r({ ref: 'LOTE-A', rec: R.r1.id, del: R.r1.code, prod: 'CACAO_BABA', qty: '60' }), r({ ref: 'LOTE-A', rec: R.r2.id, qty: '30' })]));
    expect(s.preview).toMatchObject({ can_commit: true, summary: { create: 2, error: 0 } });
    expect(s.preview.rows[0].effects[0]).toMatch(/Crea un lote nuevo \(referencia LOTE-A\).*mueve 60 kg/);
    expect(await counts()).toEqual(before);
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    const lot = (await lotByRef('LOTE-A'))!;
    expect(lot).toMatchObject({ origin_status: 'COMPLETE', status: 'OPEN' });
    expect(await physical({ lot: lot.id })).toBe(90);
    expect(await physical({ reception: R.r1.id })).toBe(40);
    expect(await physical({ reception: R.r2.id })).toBe(50);
    const after = await counts();
    expect(after).toMatchObject({ lots: before.lots + 1, inputs: before.inputs + 2, movements: before.movements + 2 });
    const ev = await h.db.selectFrom('domain_events').select(['event_type', 'payload']).where('aggregate_id', '=', lot.id).orderBy('aggregate_version').execute();
    expect(ev.map((e) => e.event_type)).toEqual(['LotCreated', 'LotInputAssigned', 'LotInputAssigned']);
    expect(ev.every((e) => (e.payload as { source?: { kind: string } }).source?.kind === 'EXCEL_IMPORT')).toBe(true);
  });

  it('reimportar lo mismo: sin asignaciones, cantidades, versiones ni eventos nuevos', async () => {
    const before = await counts();
    const s = await staged(ADMIN, orgA, book([r({ ref: 'LOTE-A', rec: R.r1.id, qty: '60' }), r({ ref: 'LOTE-A', rec: R.r2.id, qty: '30' })]));
    expect(s.preview.summary).toMatchObject({ unchanged: 2, create: 0, update: 0 });
    expect((await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(409)).body.error.code).toBe('NOTHING_TO_IMPORT');
    expect(await counts()).toEqual(before);
  });

  it('errores por fila: recepción faltante o no disponible, verificación cruzada, exceso (también acumulado), mezcla de origen y producto, duplicados, identidad y asignación existente', async () => {
    const lot = (await lotByRef('LOTE-A'))!;
    const before = await counts();
    const s = await staged(ADMIN, orgA, book([
      r({ ref: 'X1', qty: '5' }),
      r({ ref: 'X2', rec: randomUUID(), qty: '5' }),
      r({ ref: 'X3', rec: R.r1.id, del: R.r2.code, qty: '5' }),
      r({ ref: 'X4', rec: R.r1.id, qty: '45' }),
      r({ ref: 'X5', rec: R.r2.id, qty: '30' }),
      r({ ref: 'X6', rec: R.r2.id, qty: '30' }),
      r({ lot: lot.lot_code, rec: R.r3.id, qty: '10' }),
      r({ lot: lot.lot_code, rec: R.r4.id, qty: '10' }),
      r({ ref: 'X9', rec: R.r3.id, qty: '5' }),
      r({ ref: 'X9', rec: R.r3.id, qty: '5' }),
      r({ rec: R.r3.id, qty: '5' }),
      r({ lot: lot.lot_code, rec: R.r1.id, qty: '61' }),
      r({ ref: 'X13', rec: R.r3.id, qty: '1,5' }),
      r({ ref: 'X14', rec: R.r1.id, qty: '0' }),
    ]));
    expect(errs(s.preview, 2)).toEqual(['RECEPTION_REQUIRED']);
    expect(errs(s.preview, 3)).toEqual(['RECEPTION_NOT_AVAILABLE']);
    expect(errs(s.preview, 4)).toEqual(['RECEPTION_REFERENCE_MISMATCH']);
    expect(errs(s.preview, 5)).toEqual(['INSUFFICIENT_AVAILABLE']);
    expect(errs(s.preview, 6)).toEqual(['INSUFFICIENT_AVAILABLE']); // 30 + 30 > 50 disponibles
    expect(errs(s.preview, 7)).toEqual(['INSUFFICIENT_AVAILABLE']);
    expect(errs(s.preview, 8)).toEqual(['ORIGIN_MIXING_BLOCKED']);
    expect(errs(s.preview, 9)).toEqual(['PRODUCT_MISMATCH']);
    expect(errs(s.preview, 10)).toEqual(['DUPLICATE_IN_FILE']);
    expect(errs(s.preview, 11)).toEqual(['DUPLICATE_IN_FILE']);
    expect(errs(s.preview, 12)).toEqual(['REFERENCE_REQUIRED']);
    expect(errs(s.preview, 13)).toEqual(['INPUT_ALREADY_ASSIGNED']);
    expect(errs(s.preview, 14)).toEqual(['INVALID_FORMAT']);
    expect(errs(s.preview, 15)).toEqual(['MUST_BE_POSITIVE']);
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(422);
    expect(await counts()).toEqual(before);
  });

  it('origen incompleto se mantiene separado; lote existente por código; lote cerrado no se reabre', async () => {
    const s = await staged(ADMIN, orgA, book([r({ ref: 'LOTE-INC', rec: R.r3.id, qty: '20' })]));
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    expect(await lotByRef('LOTE-INC')).toMatchObject({ origin_status: 'INCOMPLETE' });
    const lot = (await lotByRef('LOTE-A'))!;
    const r8 = await reception('40', baba, true); // recepción aún no asignada al lote
    const s2 = await staged(ADMIN, orgA, book([r({ lot: lot.lot_code, rec: r8.id, qty: '20' })]));
    expect(s2.preview.rows[0]).toMatchObject({ action: 'UPDATE', effects: [expect.stringMatching(/Mueve 20 kg .* al lote LOT-/)] });
    await commit(ADMIN, orgA, s2.id, s2.preview.plan_hash).expect(201);
    expect(await physical({ lot: lot.id })).toBe(110);
    const row = await h.db.selectFrom('lots').select('row_version').where('id', '=', lot.id).executeTakeFirstOrThrow();
    await http().post(`${api(orgA)}/lots/${lot.id}/close-for-input`).set(as(ADMIN)).send({ expected_version: Number(row.row_version) }).expect(200);
    const s3 = await staged(ADMIN, orgA, book([r({ lot: lot.lot_code, rec: R.r2.id, qty: '5' })]));
    expect(errs(s3.preview, 2)).toEqual(['LOT_CLOSED_FOR_INPUT']);
    expect((await h.db.selectFrom('lots').select('status').where('id', '=', lot.id).executeTakeFirstOrThrow()).status).toBe('CLOSED_FOR_INPUT');
  });

  it('revalidación al confirmar: disponibilidad consumida por otra operación y lote cerrado en paralelo → PREVIEW_STALE sin escribir', async () => {
    const s = await staged(ADMIN, orgA, book([r({ ref: 'LOTE-RV', rec: R.r2.id, qty: '50' })])); // R2 tiene 50 disponibles
    await http().post(`${api(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: R.r2.id, quantity: '10' }] }).expect(201);
    const before = await counts();
    expect((await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(409)).body.error.code).toBe('PREVIEW_STALE');
    expect(await counts()).toEqual(before);
    const open = (await lotByRef('LOTE-INC'))!;
    const s2 = await staged(ADMIN, orgA, book([r({ lot: open.lot_code, rec: R.r3.id, qty: '5' })]));
    const row = await h.db.selectFrom('lots').select('row_version').where('id', '=', open.id).executeTakeFirstOrThrow();
    await http().post(`${api(orgA)}/lots/${open.id}/close-for-input`).set(as(ADMIN)).send({ expected_version: Number(row.row_version) }).expect(200);
    expect((await commit(ADMIN, orgA, s2.id, s2.preview.plan_hash).expect(409)).body.error.code).toBe('PREVIEW_STALE');
  });

  it('concurrencia: importación y asignación directa sobre la misma recepción → nunca se supera lo disponible', async () => {
    const r5 = await reception('40', baba, true);
    const s = await staged(ADMIN, orgA, book([r({ ref: 'LOTE-CC', rec: r5.id, qty: '30' })]));
    const [imp, direct] = await Promise.all([
      commit(ADMIN, orgA, s.id, s.preview.plan_hash),
      http().post(`${api(orgA)}/lots`).set(as(MANAGER)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r5.id, quantity: '30' }] }),
    ]);
    expect([imp.status, direct.status].filter((x) => x === 201)).toHaveLength(1);
    expect(await physical({ reception: r5.id })).toBe(10);
    // Reintento de la misma confirmación: no duplica.
    if (imp.status === 201) await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(409);
  });

  it('permisos: sin acceso a entregas las recepciones no están disponibles (misma respuesta que inexistente); permiso retirado → 403', async () => {
    const s = await staged(CIEGO, orgA, book([r({ ref: 'C1', rec: R.r4.id, qty: '1' }), r({ ref: 'C2', rec: randomUUID(), qty: '1' })]));
    const strip = (x: Record<string, unknown>) => { const { row_number: _n, code: _c, fields: _f, ...rest } = x; void _n; void _c; void _f; return rest; };
    expect(errs(s.preview, 2)).toEqual(['RECEPTION_NOT_AVAILABLE']);
    expect(strip(s.preview.rows[0])).toEqual(strip(s.preview.rows[1]));
    const m = await staged(MANAGER, orgA, book([r({ ref: 'M1', rec: R.r4.id, qty: '5' })]));
    const mid = await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', MANAGER).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow();
    await h.db.updateTable('role_assignments').set({ role_code: 'TRACEABILITY_MANAGER' }).where('membership_id', '=', mid.id).execute();
    await commit(MANAGER, orgA, m.id, m.preview.plan_hash).expect(403);
    await h.db.updateTable('role_assignments').set({ role_code: 'MANAGER' }).where('membership_id', '=', mid.id).execute();
    expect(await lotByRef('M1')).toBeUndefined();
  });

  it('rollback completo: un fallo en la segunda fila deshace el lote nuevo y sus movimientos', async () => {
    const r6 = await reception('30', seco, true);
    const r7 = await reception('30', seco, true);
    const before = await counts();
    const s = await staged(ADMIN, orgA, book([r({ ref: 'LOTE-RB', rec: r6.id, qty: '10' }), r({ ref: 'LOTE-RB', rec: r7.id, qty: '10' })]));
    const spy = jest.spyOn(LotsService.prototype, 'assignInTx').mockRejectedValueOnce(new Error('fallo inyectado'));
    try {
      await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await counts()).toEqual(before);
    expect(await lotByRef('LOTE-RB')).toBeUndefined();
    expect(await physical({ reception: r6.id })).toBe(30);
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    expect(await physical({ lot: (await lotByRef('LOTE-RB'))!.id })).toBe(20);
  });

  it('aislamiento: recepción de otra organización no disponible; lote de importación ajeno 404', async () => {
    const s = await staged(ADMIN, orgA, book([r({ ref: 'ISO', rec: R.r4.id, qty: '1' })]));
    for (const path of ['', '/preview', '/report']) await http().get(`${base(orgA)}/${s.id}${path}`).set(as('admin-b@test.local')).expect(404);
    const sb = await staged('admin-b@test.local', orgB, book([r({ ref: 'B1', rec: R.r4.id, qty: '1' })]));
    expect(errs(sb.preview, 2)).toEqual(['RECEPTION_NOT_AVAILABLE']);
  });
});
