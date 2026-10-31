import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { AuthorizationService } from '../src/authz/authorization.service';
import type { Permission } from '../src/authz/catalog';
import { DeliveriesService } from '../src/deliveries/deliveries';
import { writeXlsx } from '../src/imports/xlsx';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Integración P0-026 plantilla ENTREGAS_V1 (RF-26 / QA-03, P0-012) contra PostgreSQL real. Archivos sintéticos.
// Incluye FIXTURES DE AUTORIZACIÓN (permisos sintéticos en memoria; ningún rol de producción cambia).
const FIX_ASIG: Permission[] = ['organization:read', 'import:manage', 'delivery:read_assigned', 'delivery:create_assigned', 'producer:read_assigned', 'product:read', 'location:read'];
// Lee todas las entregas pero solo puede crear/editar las de productores asignados.
const FIX_LEE_TODO: Permission[] = ['organization:read', 'import:manage', 'delivery:read', 'delivery:create_assigned', 'producer:read', 'product:read', 'location:read'];
const LEE = 'fixture-lee-todo@test.local';

describeDb('P0-026 importación Excel de entregas (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const fixtures = new Map<string, Permission[]>();
  const http = () => h.http();
  const as = (email: string) => h.as(email);
  const api = (org: string) => `/api/v1/organizations/${org}`;
  const base = (org: string) => `${api(org)}/imports`;
  const ADMIN = 'admin-a@test.local';
  const MANAGER = 'supervisor@test.local';
  const ASIG = 'fixture-asig@test.local';
  const HEAD = ['codigo_entrega', 'codigo_productor', 'codigo_producto', 'codigo_centro', 'fecha_entrega', 'cantidad_declarada', 'unidad', 'periodo_precision', 'periodo_inicio', 'periodo_fin', 'parcelas_origen', 'notas', 'referencia_importacion'];
  const MAP = { A: 'delivery_code', B: 'producer_code', C: 'product_code', D: 'location_code', E: 'delivery_date', F: 'quantity_declared', G: 'unit', H: 'harvest_precision', I: 'harvest_start', J: 'harvest_end', K: 'origins', L: 'notes', M: 'import_reference' };
  const book = (rows: string[][], head = HEAD) => writeXlsx([{ name: 'entregas', rows: [head, ...rows] }]);
  // fila: código, productor, producto, centro, fecha, cantidad, unidad, precisión, inicio, fin, orígenes, notas, referencia.
  // Sin código, la fila lleva por omisión una referencia única (ref: '' la omite a propósito).
  let refN = 0;
  const row = (o: Partial<Record<'code' | 'prod' | 'product' | 'center' | 'date' | 'qty' | 'unit' | 'prec' | 'start' | 'end' | 'origins' | 'notes' | 'ref', string>>) =>
    [o.code ?? '', o.prod ?? '', o.product ?? '', o.center ?? '', o.date ?? '', o.qty ?? '', o.unit ?? '', o.prec ?? '', o.start ?? '', o.end ?? '', o.origins ?? '', o.notes ?? '', o.ref ?? (o.code ? '' : `REF-${++refN}`)];

  async function join(admin: string, org: string, email: string, role: string) {
    const inv = await http().post(`${api(org)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const membershipId = async (email: string) => (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow()).id;
  const upload = (actor: string, org: string, buf: Buffer) =>
    http().post(base(org)).set(as(actor)).field('operation_id', randomUUID()).field('template', 'ENTREGAS_V1').attach('file', buf, 'entregas.xlsx');
  async function staged(actor: string, org: string, buf: Buffer, columns: Record<string, string> = MAP) {
    const up = await upload(actor, org, buf).expect(201);
    const id = up.body.batch.id as string;
    await http().post(`${base(org)}/${id}/mapping`).set(as(actor)).send({ columns, expected_version: up.body.batch.row_version }).expect(200);
    const preview = (await http().get(`${base(org)}/${id}/preview`).set(as(actor)).expect(200)).body;
    return { id, up: up.body, preview };
  }
  const commit = (actor: string, org: string, id: string, planHash: string) =>
    http().post(`${base(org)}/${id}/commit`).set(as(actor)).send({ operation_id: randomUUID(), plan_hash: planHash });
  const errs = (pv: { rows: Array<{ row_number: number; errors: Array<{ code: string }> }> }, n: number) => pv.rows.find((r) => r.row_number === n)!.errors.map((e) => e.code);
  const count = async (t: 'deliveries' | 'receptions' | 'weighings' | 'gate_evaluations' | 'delivery_supports' | 'quality_samples' | 'stock_movements', org = orgA) =>
    Number((await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(t)} WHERE organization_id = ${org}`.execute(h.db)).rows[0].n);
  const physical = async () => ({ receptions: await count('receptions'), weighings: await count('weighings'), gates: await count('gate_evaluations'), supports: await count('delivery_supports'), samples: await count('quality_samples'), stock: await count('stock_movements'),
    registered: Number((await sql<{ n: string }>`SELECT count(*) AS n FROM domain_events WHERE organization_id = ${orgA} AND event_type LIKE 'Delivery%'`.execute(h.db)).rows[0].n) });
  const delivery = (org: string, where: { code?: string; notes?: string }) => {
    let q = h.db.selectFrom('deliveries').selectAll().where('organization_id', '=', org);
    if (where.code) q = q.where('delivery_code', '=', where.code);
    if (where.notes) q = q.where('notes', '=', where.notes);
    return q.executeTakeFirst();
  };

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'ASSOCIATION', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Asociación A', ADMIN);
    orgB = await mk('Asociación B', 'admin-b@test.local');
    await join(ADMIN, orgA, MANAGER, 'MANAGER');
    await join(ADMIN, orgA, 'recepcion@test.local', 'RECEPTION_OPERATOR');
    await join(ADMIN, orgA, 'tecnico@test.local', 'FIELD_TECHNICIAN');
    await join(ADMIN, orgA, ASIG, 'FIELD_TECHNICIAN');
    await join(ADMIN, orgA, LEE, 'FIELD_TECHNICIAN');
    const uid = (await h.db.selectFrom('users').select('id').where('email', '=', ASIG).executeTakeFirstOrThrow()).id;
    fixtures.set(uid, FIX_ASIG);
    fixtures.set((await h.db.selectFrom('users').select('id').where('email', '=', LEE).executeTakeFirstOrThrow()).id, FIX_LEE_TODO);
    const original = AuthorizationService.prototype.tenantContext;
    jest.spyOn(AuthorizationService.prototype, 'tenantContext').mockImplementation(async function (this: AuthorizationService, user, organizationId) {
      const ctx = await original.call(this, user, organizationId);
      const perms = fixtures.get(user.id);
      return ctx && perms ? { ...ctx, permissions: [...perms].sort() } : ctx;
    });
    const producer = (body: Record<string, unknown>, org = orgA, admin = ADMIN) => http().post(`${api(org)}/producers`).set(as(admin)).send(body).expect(201).then((r) => r.body.id as string);
    const p1 = await producer({ producer_code: 'PRD-1', first_name: 'Ana', last_name: 'Uno' });
    await producer({ producer_code: 'PRD-BORRADOR', first_name: 'Borra', last_name: 'Dor', status: 'DRAFT' });
    const pa = await producer({ producer_code: 'PRD-ASIG', first_name: 'Rosa', last_name: 'Asig', assigned_membership_id: await membershipId(ASIG) });
    const pj = await producer({ producer_code: 'PRD-AJENO', first_name: 'Secreta', last_name: 'Ajena' });
    await producer({ producer_code: 'PRD-B', first_name: 'Otra', last_name: 'Org' }, orgB, 'admin-b@test.local');
    const plot = (producer_id: string, plot_code: string) => http().post(`${api(orgA)}/plots`).set(as(ADMIN)).send({ producer_id, plot_code, crop: 'Cacao' }).expect(201);
    await plot(p1, 'PAR-1'); await plot(p1, 'PAR-2'); await plot(pj, 'PAR-AJENA'); await plot(pa, 'PAR-ASIG');
    await http().post(`${api(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_SECO', name: 'Cacao seco', product_state: 'CACAO_SECO', unit: 'KG' }).expect(201);
    const off = (await http().post(`${api(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_OFF', name: 'Cacao fuera', product_state: 'CACAO_SECO', unit: 'KG' }).expect(201)).body;
    await http().post(`${api(orgA)}/products/${off.id}/deactivate`).set(as(ADMIN)).send({ expected_version: off.row_version, reason: 'Fuera de uso' }).expect(200);
    await http().post(`${api(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CA-01', name: 'Centro uno', location_type: 'COLLECTION_CENTER' }).expect(201);
  });
  afterAll(async () => { jest.restoreAllMocks(); await h?.close(); });

  it('plantilla: admin y MANAGER autorizados; recepción y técnico (sin import:manage) 403; otra organización 404', async () => {
    const info = await http().get(`${base(orgA)}/templates/deliveries`).set(as(ADMIN)).expect(200);
    expect(info.body).toMatchObject({ template: 'ENTREGAS_V1', new_status: 'DRAFT', key_field: 'delivery_code' });
    expect(info.body.rules.join(' ')).toMatch(/no registra la entrega/);
    await http().get(`${base(orgA)}/templates/deliveries`).set(as(MANAGER)).expect(200);
    await http().get(`${base(orgA)}/templates/deliveries`).set(as('recepcion@test.local')).expect(403);
    await http().get(`${base(orgA)}/templates/deliveries`).set(as('tecnico@test.local')).expect(403);
    await http().get(`${base(orgA)}/templates/deliveries`).set(as('admin-b@test.local')).expect(404);
  });

  it('periodos: día, intervalo de días, mes, intervalo de meses y desconocido se guardan como se declaran; inválidos son error', async () => {
    const before = await count('deliveries');
    const s = await staged(ADMIN, orgA, book([
      row({ prod: 'PRD-1', prec: 'DAY', start: '2026-08-15', notes: 'P-DIA' }),
      row({ prod: 'PRD-1', prec: 'DAY', start: '2026-08-01', end: '2026-08-20', notes: 'P-DIAS' }),
      row({ prod: 'PRD-1', prec: 'MONTH', start: '2026-07', notes: 'P-MES' }),
      row({ prod: 'PRD-1', prec: 'MONTH', start: '2026-06', end: '2026-08', notes: 'P-MESES' }),
      row({ prod: 'PRD-1', prec: 'UNKNOWN', notes: 'P-DESC' }),
      row({ prod: 'PRD-1', date: '2026-09-30', notes: 'P-SIN' }),
    ]));
    expect(s.preview).toMatchObject({ can_commit: true, summary: { create: 6, error: 0 }, new_status: 'DRAFT' });
    expect(await count('deliveries')).toBe(before);
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    const got = async (notes: string) => { const d = (await delivery(orgA, { notes }))!; return [d.harvest_precision, d.harvest_start, d.harvest_end]; };
    expect(await got('P-DIA')).toEqual(['DAY', '2026-08-15', '2026-08-15']);
    expect(await got('P-DIAS')).toEqual(['DAY', '2026-08-01', '2026-08-20']);
    expect(await got('P-MES')).toEqual(['MONTH', '2026-07', '2026-07']);
    expect(await got('P-MESES')).toEqual(['MONTH', '2026-06', '2026-08']);
    expect(await got('P-DESC')).toEqual(['UNKNOWN', null, null]);
    expect(await got('P-SIN')).toEqual([null, null, null]); // nunca se deduce de la fecha de entrega
    const bad = await staged(ADMIN, orgA, book([
      row({ prod: 'PRD-1', prec: 'DAY', start: '2026-02-30' }),
      row({ prod: 'PRD-1', prec: 'MONTH', start: '2026-07-15' }),
      row({ prod: 'PRD-1', prec: 'UNKNOWN', start: '2026-07' }),
      row({ prod: 'PRD-1', start: '2026-07' }),
      row({ prod: 'PRD-1', prec: 'MONTH', start: '2026-08', end: '2026-06' }),
    ]));
    expect(errs(bad.preview, 2)).toEqual(['HARVEST_PERIOD_DAY_INVALID']);
    expect(errs(bad.preview, 3)).toEqual(['HARVEST_PERIOD_MONTH_INVALID']);
    expect(errs(bad.preview, 4)).toEqual(['HARVEST_PERIOD_UNKNOWN_WITH_DATES']);
    expect(errs(bad.preview, 5)).toEqual(['PERIOD_PRECISION_REQUIRED']);
    expect(errs(bad.preview, 6)).toEqual(['HARVEST_PERIOD_INVERTED']);
  });

  it('referencias y formatos: productor inexistente o en borrador, producto/centro/parcela no disponibles, unidad, cantidad, fecha y filas idénticas', async () => {
    const s = await staged(ADMIN, orgA, book([
      row({ prod: 'PRD-NADA' }),
      row({ prod: 'PRD-BORRADOR' }),
      row({ prod: 'PRD-1', product: 'CACAO_NADA', notes: 'r4' }),
      row({ prod: 'PRD-1', product: 'CACAO_OFF', notes: 'r5' }),
      row({ prod: 'PRD-1', center: 'CA-99', notes: 'r6' }),
      row({ prod: 'PRD-1', origins: 'PAR-1;PAR-AJENA', notes: 'r7' }),
      row({ prod: 'PRD-1', qty: '100', notes: 'r8' }),
      row({ prod: 'PRD-1', qty: '100', unit: 'LB', notes: 'r9' }),
      row({ prod: 'PRD-1', qty: '1,5', unit: 'KG', notes: 'r10' }),
      row({ prod: 'PRD-1', date: '45930', notes: 'r11' }),
      row({ prod: 'PRD-1', notes: 'gemela', ref: 'REF-GEMELA' }),
      row({ prod: 'PRD-1', notes: 'otra', ref: 'REF-GEMELA' }),
      row({ prod: 'PRD-1', qty: '0', unit: 'KG', notes: 'r14' }),
      row({ prod: 'PRD-1', notes: 'sin referencia', ref: '' }),
    ]));
    expect(errs(s.preview, 2)).toEqual(['PRODUCER_NOT_AVAILABLE']);
    expect(errs(s.preview, 3)).toEqual(['PRODUCER_INACTIVE']);
    expect(errs(s.preview, 4)).toEqual(['PRODUCT_NOT_AVAILABLE']);
    expect(errs(s.preview, 5)).toEqual(['PRODUCT_INACTIVE']);
    expect(errs(s.preview, 6)).toEqual(['LOCATION_NOT_AVAILABLE']);
    expect(errs(s.preview, 7)).toEqual(['ORIGIN_NOT_AVAILABLE']);
    expect(errs(s.preview, 8)).toEqual(['UNIT_REQUIRED']);
    expect(errs(s.preview, 9)).toEqual(['INVALID_FORMAT']);
    expect(errs(s.preview, 10)).toEqual(['INVALID_FORMAT']);
    expect(errs(s.preview, 11)).toEqual(['INVALID_FORMAT']);
    expect(errs(s.preview, 12)).toEqual(['DUPLICATE_IN_FILE']);
    expect(errs(s.preview, 13)).toEqual(['DUPLICATE_IN_FILE']);
    expect(errs(s.preview, 14)).toEqual(['MUST_BE_POSITIVE']);
    expect(errs(s.preview, 15)).toEqual(['REFERENCE_REQUIRED']); // sin identidad: se pide resolver, no se deduplica por contenido
    expect(s.preview.can_commit).toBe(false);
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(422);
  });

  let draftCode: string;
  it('alta de borradores: sin registro ni efectos físicos; peso declarado en KG; orígenes; reimportación sin duplicar', async () => {
    const before = await physical();
    const file = book([row({ prod: 'PRD-1', product: 'CACAO_SECO', center: 'CA-01', date: '2026-09-15', qty: '500.5', unit: 'KG', prec: 'MONTH', start: '2026-08', origins: 'PAR-1:300;PAR-2', notes: 'Lote importado A' })]);
    const s = await staged(ADMIN, orgA, file);
    expect(s.preview.rows[0]).toMatchObject({ action: 'CREATE' });
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    const d = (await delivery(orgA, { notes: 'Lote importado A' }))!;
    draftCode = d.delivery_code;
    expect(d).toMatchObject({ status: 'DRAFT', unit: 'KG', registered_at: null, harvest_precision: 'MONTH' });
    expect(Number(d.quantity_declared)).toBe(500.5);
    const origins = await h.db.selectFrom('delivery_origins as o').innerJoin('plots as p', 'p.id', 'o.plot_id').select(['p.plot_code', sql<string | null>`o.origin_quantity::text`.as('q')]).where('o.delivery_id', '=', d.id).orderBy('p.plot_code').execute();
    expect(origins.map((o) => [o.plot_code, o.q === null ? null : Number(o.q)])).toEqual([['PAR-1', 300], ['PAR-2', null]]);
    expect(await physical()).toEqual(before); // ni recepción, pesaje, compuerta de registro, soporte, calidad, inventario ni eventos de entrega
    const audit = await h.db.selectFrom('audit_logs').select(['action', 'after', 'reason']).where('entity_id', '=', d.id).execute();
    expect(audit.map((a) => a.action)).toEqual(['delivery.draft_create']);
    expect(audit[0].reason).toContain(s.id);
    // Reimportar el mismo archivo: la fila ya importada no se vuelve a crear.
    const again = await staged(ADMIN, orgA, file);
    expect(again.preview.rows[0]).toMatchObject({ action: 'UNCHANGED', warnings: [expect.objectContaining({ code: 'REFERENCE_KNOWN' })] });
    expect((await commit(ADMIN, orgA, again.id, again.preview.plan_hash).expect(409)).body.error.code).toBe('NOTHING_TO_IMPORT');
    expect(await h.db.selectFrom('deliveries').select('id').where('notes', '=', 'Lote importado A').execute()).toHaveLength(1);
  });

  it('identidad: referencias distintas con contenido idéntico son dos entregas; la misma referencia no duplica y procedencia guardada', async () => {
    const twins = book([row({ prod: 'PRD-1', qty: '50', unit: 'KG', notes: 'gemelas', ref: 'PLANILLA-7' }), row({ prod: 'PRD-1', qty: '50', unit: 'KG', notes: 'gemelas', ref: 'PLANILLA-8' })]);
    const s = await staged(ADMIN, orgA, twins);
    expect(s.preview.summary).toMatchObject({ create: 2, error: 0 });
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    expect(await h.db.selectFrom('deliveries').select('id').where('organization_id', '=', orgA).where('notes', '=', 'gemelas').execute()).toHaveLength(2);
    const refs = await h.db.selectFrom('import_references').select(['reference', 'origin', 'batch_id', 'row_number']).where('reference', 'in', ['PLANILLA-7', 'PLANILLA-8']).orderBy('reference').execute();
    expect(refs).toEqual([{ reference: 'PLANILLA-7', origin: 'FILE_REFERENCE', batch_id: s.id, row_number: 2 }, { reference: 'PLANILLA-8', origin: 'FILE_REFERENCE', batch_id: s.id, row_number: 3 }]);
    const again = await staged(ADMIN, orgA, twins);
    expect(again.preview.summary).toMatchObject({ unchanged: 2, create: 0 });
    // La misma referencia con un dato distinto actualiza ESE borrador (no crea otro).
    const upd = await staged(ADMIN, orgA, book([row({ prod: 'PRD-1', qty: '55', unit: 'KG', notes: 'gemelas', ref: 'PLANILLA-8' })]));
    expect(upd.preview.rows[0]).toMatchObject({ action: 'UPDATE', changed_fields: ['quantity_declared'] });
    await commit(ADMIN, orgA, upd.id, upd.preview.plan_hash).expect(201);
    expect(await h.db.selectFrom('deliveries').select('id').where('organization_id', '=', orgA).where('notes', '=', 'gemelas').execute()).toHaveLength(2);
    await expect(sql`UPDATE import_references SET reference = 'X' WHERE reference = 'PLANILLA-7'`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('identidad concurrente: la misma referencia en dos lotes → una entrega; referencias distintas → dos', async () => {
    const same = book([row({ prod: 'PRD-1', notes: 'conc-ref', ref: 'CONC-1' })]);
    const a = await staged(ADMIN, orgA, same);
    const b = await staged(MANAGER, orgA, same);
    const [ra, rb] = await Promise.all([commit(ADMIN, orgA, a.id, a.preview.plan_hash), commit(MANAGER, orgA, b.id, b.preview.plan_hash)]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    expect(await h.db.selectFrom('deliveries').select('id').where('notes', '=', 'conc-ref').execute()).toHaveLength(1);
    const c = await staged(ADMIN, orgA, book([row({ prod: 'PRD-1', notes: 'conc-dist', ref: 'CONC-2' })]));
    const d = await staged(MANAGER, orgA, book([row({ prod: 'PRD-1', notes: 'conc-dist', ref: 'CONC-3' })]));
    const [rc, rd] = await Promise.all([commit(ADMIN, orgA, c.id, c.preview.plan_hash), commit(MANAGER, orgA, d.id, d.preview.plan_hash)]);
    expect([rc.status, rd.status]).toEqual([201, 201]);
    expect(await h.db.selectFrom('deliveries').select('id').where('notes', '=', 'conc-dist').execute()).toHaveLength(2);
  });

  it('fixture de autorización: leer todas las entregas no concede editarlas; actualizar exige el alcance de escritura', async () => {
    const base1 = (await http().post(`${api(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: (await h.db.selectFrom('producers').select('id').where('producer_code', '=', 'PRD-1').executeTakeFirstOrThrow()).id, notes: 'de otro' }).expect(201)).body.delivery;
    const s = await staged(LEE, orgA, book([[base1.delivery_code, 'cambio']], ['codigo_entrega', 'notas']), { A: 'delivery_code', B: 'notes' });
    expect(errs(s.preview, 2)).toEqual(['PERMISSION_DENIED_UPDATE']);
    const s2 = await staged(LEE, orgA, book([row({ prod: 'PRD-1', notes: 'alta de otro' })]));
    expect(errs(s2.preview, 2)).toEqual(['PRODUCER_NOT_AVAILABLE']); // alta: productor no asignado
  });

  it('actualización de borrador por código: mapeo parcial, vacío no borra, #BORRAR quita, orígenes reemplazados; sin cambios no hay efectos', async () => {
    const before = (await delivery(orgA, { code: draftCode }))!;
    const s = await staged(ADMIN, orgA, book([[draftCode, '', '#BORRAR', 'PAR-2']], ['codigo_entrega', 'cantidad_declarada', 'notas', 'parcelas_origen']), { A: 'delivery_code', B: 'quantity_declared', C: 'notes', D: 'origins' });
    expect(s.preview.rows[0]).toMatchObject({ action: 'UPDATE', changed_fields: ['notes', 'origins'] });
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    const after = (await delivery(orgA, { code: draftCode }))!;
    expect(after).toMatchObject({ notes: null, product_id: before.product_id, location_id: before.location_id, quantity_declared: before.quantity_declared, harvest_precision: 'MONTH', status: 'DRAFT' });
    expect(Number(after.row_version)).toBe(Number(before.row_version) + 1);
    const same = await staged(ADMIN, orgA, book([[draftCode, 'PAR-2']], ['codigo_entrega', 'parcelas_origen']), { A: 'delivery_code', B: 'origins' });
    expect(same.preview.rows[0].action).toBe('UNCHANGED');
    // El productor de una entrega no se cambia por importación.
    const other = await staged(ADMIN, orgA, book([[draftCode, 'PRD-ASIG']], ['codigo_entrega', 'codigo_productor']), { A: 'delivery_code', B: 'producer_code' });
    expect(errs(other.preview, 2)).toEqual(['DELIVERY_PRODUCER_CHANGE_NOT_ALLOWED']);
  });

  it('entrega registrada: igual → sin cambios; distinta → error que remite a la corrección; nada se modifica', async () => {
    const d = (await delivery(orgA, { code: draftCode }))!;
    await http().post(`${api(orgA)}/deliveries/${d.id}/register`).set(as(ADMIN)).send({ expected_version: Number(d.row_version) }).expect(200);
    const reg = (await delivery(orgA, { code: draftCode }))!;
    const same = await staged(ADMIN, orgA, book([[draftCode, '500.5', 'KG']], ['codigo_entrega', 'cantidad_declarada', 'unidad']), { A: 'delivery_code', B: 'quantity_declared', C: 'unit' });
    expect(same.preview.rows[0].action).toBe('UNCHANGED');
    const changed = await staged(ADMIN, orgA, book([[draftCode, '600', 'KG']], ['codigo_entrega', 'cantidad_declarada', 'unidad']), { A: 'delivery_code', B: 'quantity_declared', C: 'unit' });
    expect(errs(changed.preview, 2)).toEqual(['DELIVERY_REGISTERED']);
    await commit(ADMIN, orgA, changed.id, changed.preview.plan_hash).expect(422);
    expect(await delivery(orgA, { code: draftCode })).toEqual(reg);
  });

  it('fixture de autorización: entrega o productor fuera de la asignación e inexistentes → respuestas idénticas', async () => {
    const ajena = (await http().post(`${api(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: (await h.db.selectFrom('producers').select('id').where('producer_code', '=', 'PRD-AJENO').executeTakeFirstOrThrow()).id, notes: 'Secreta' }).expect(201)).body.delivery;
    const s = await staged(ASIG, orgA, book([
      row({ code: ajena.delivery_code, notes: 'x' }),
      row({ code: 'ENT-2099-99999', notes: 'x' }),
      row({ prod: 'PRD-AJENO', notes: 'y' }),
      row({ prod: 'PRD-NO-EXISTE', notes: 'z' }),
      row({ prod: 'PRD-ASIG', origins: 'PAR-ASIG', notes: 'mia' }),
    ]));
    const strip = (r: Record<string, unknown>) => { const { row_number: _n, code: _c, fields: _f, ...rest } = r; void _n; void _c; void _f; return rest; };
    const [fuera, nada, prodFuera, prodNada, mia] = s.preview.rows;
    expect(fuera.errors[0]).toMatchObject({ code: 'CODE_NOT_AVAILABLE' });
    expect(strip(fuera)).toEqual(strip(nada));
    expect(prodFuera.errors[0]).toMatchObject({ code: 'PRODUCER_NOT_AVAILABLE' });
    expect(strip(prodFuera)).toEqual(strip(prodNada));
    expect(mia.action).toBe('CREATE');
    expect(JSON.stringify(s.preview)).not.toContain(ajena.id);
    expect(JSON.stringify(s.preview)).not.toContain('Secreta');
  });

  it('revalidación al confirmar: versión cambiada → PREVIEW_STALE; asignación retirada → PREVIEW_STALE; permiso retirado → 403', async () => {
    const draft = (await http().post(`${api(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: (await h.db.selectFrom('producers').select('id').where('producer_code', '=', 'PRD-ASIG').executeTakeFirstOrThrow()).id, notes: 'rev' }).expect(201)).body.delivery;
    const s = await staged(ASIG, orgA, book([[draft.delivery_code, 'revisada']], ['codigo_entrega', 'notas']), { A: 'delivery_code', B: 'notes' });
    expect(s.preview.rows[0].action).toBe('UPDATE');
    await http().patch(`${api(orgA)}/deliveries/${draft.id}`).set(as(ADMIN)).send({ expected_version: draft.row_version, delivery_date: '2026-09-01' }).expect(200);
    expect((await commit(ASIG, orgA, s.id, s.preview.plan_hash).expect(409)).body.error.code).toBe('PREVIEW_STALE');
    const s2 = await staged(ASIG, orgA, book([[draft.delivery_code, 'revisada 2']], ['codigo_entrega', 'notas']), { A: 'delivery_code', B: 'notes' });
    const pa = (await h.db.selectFrom('producers').select('id').where('producer_code', '=', 'PRD-ASIG').executeTakeFirstOrThrow()).id;
    await h.db.updateTable('producers').set({ assigned_membership_id: null }).where('id', '=', pa).execute();
    expect((await commit(ASIG, orgA, s2.id, s2.preview.plan_hash).expect(409)).body.error.code).toBe('PREVIEW_STALE');
    await h.db.updateTable('producers').set({ assigned_membership_id: await membershipId(ASIG) }).where('id', '=', pa).execute();
    const uid = (await h.db.selectFrom('users').select('id').where('email', '=', ASIG).executeTakeFirstOrThrow()).id;
    fixtures.set(uid, FIX_ASIG.filter((p) => p !== 'delivery:create_assigned'));
    await commit(ASIG, orgA, s2.id, s2.preview.plan_hash).expect(403);
    fixtures.set(uid, FIX_ASIG);
    expect((await delivery(orgA, { code: draft.delivery_code }))!.notes).toBe('rev');
  });

  it('rollback completo: un fallo en la segunda fila deshace el alta de la primera', async () => {
    const draft = (await http().post(`${api(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: (await h.db.selectFrom('producers').select('id').where('producer_code', '=', 'PRD-1').executeTakeFirstOrThrow()).id, notes: 'rb-base' }).expect(201)).body.delivery;
    const before = await count('deliveries');
    const s = await staged(ADMIN, orgA, book([row({ prod: 'PRD-1', notes: 'rb-nueva' }), row({ code: draft.delivery_code, notes: 'rb-cambio' })]));
    expect(s.preview.summary).toMatchObject({ create: 1, update: 1 });
    const spy = jest.spyOn(DeliveriesService.prototype, 'updateDraftInTx').mockRejectedValueOnce(new Error('fallo inyectado'));
    try {
      await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await count('deliveries')).toBe(before);
    expect(await delivery(orgA, { notes: 'rb-nueva' })).toBeUndefined();
    await commit(ADMIN, orgA, s.id, s.preview.plan_hash).expect(201);
    expect(await delivery(orgA, { notes: 'rb-nueva' })).toBeDefined();
  });

  it('concurrencia: dos lotes con la misma fila nueva → una sola entrega', async () => {
    const file = book([row({ prod: 'PRD-1', notes: 'concurrente' })]);
    const a = await staged(ADMIN, orgA, file);
    const b = await staged(MANAGER, orgA, file);
    const [ra, rb] = await Promise.all([commit(ADMIN, orgA, a.id, a.preview.plan_hash), commit(MANAGER, orgA, b.id, b.preview.plan_hash)]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    expect(['IMPORT_CONCURRENT_CHANGE', 'PREVIEW_STALE']).toContain((ra.status === 409 ? ra : rb).body.error.code);
    expect(await h.db.selectFrom('deliveries').select('id').where('notes', '=', 'concurrente').execute()).toHaveLength(1);
  });

  it('aislamiento: lote ajeno 404; productor de otra organización no disponible', async () => {
    const s = await staged(ADMIN, orgA, book([row({ prod: 'PRD-1', notes: 'iso' })]));
    for (const path of ['', '/preview', '/report']) await http().get(`${base(orgA)}/${s.id}${path}`).set(as('admin-b@test.local')).expect(404);
    const sb = await staged('admin-b@test.local', orgB, book([row({ prod: 'PRD-1', notes: 'cruzada' }), row({ prod: 'PRD-B', notes: 'propia' })]));
    expect(errs(sb.preview, 2)).toEqual(['PRODUCER_NOT_AVAILABLE']);
    expect(sb.preview.rows[1].action).toBe('CREATE');
  });
});
