import { sql } from 'kysely';
import { PRODUCTION_CONSUMERS } from '../src/events/consumers';
import { OutboxWorker } from '../src/events/outbox-worker';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Integración P0-004 (RF-04 / QA-03 / QA-13) contra PostgreSQL real.
describeDb('P0-004 productores (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const http = () => h.http();
  const as = (email: string) => h.as(email);
  const base = (org: string) => `/api/v1/organizations/${org}/producers`;

  async function join(admin: string, org: string, email: string, role: string) {
    const inv = await http().post(`/api/v1/organizations/${org}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const membershipId = async (email: string, org: string) =>
    (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id')
      .where('u.email', '=', email).where('m.organization_id', '=', org).executeTakeFirstOrThrow()).id;
  const create = (actor: string, org: string, body: Record<string, unknown>) => http().post(base(org)).set(as(actor)).send(body);
  const ana = { producer_code: 'PRD-001', first_name: 'Ana', last_name: 'Cedeño', document_type: 'CEDULA', document_number: '1301234567', phone: '+593 99 123 4567', community: 'La Unión', province: 'Manabí' };

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local'))
        .send({ name, organization_type: 'ASSOCIATION', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Asociación A', 'admin-a@test.local');
    orgB = await mk('Asociación B', 'admin-b@test.local');
    await join('admin-a@test.local', orgA, 'tecnico1@test.local', 'FIELD_TECHNICIAN');
    await join('admin-a@test.local', orgA, 'tecnico2@test.local', 'FIELD_TECHNICIAN');
    await join('admin-a@test.local', orgA, 'auditor@test.local', 'AUDITOR');
    await join('admin-a@test.local', orgA, 'calidad@test.local', 'QUALITY_OPERATOR');
    await join('admin-b@test.local', orgB, 'tecnico-b@test.local', 'FIELD_TECHNICIAN');
  });
  afterAll(async () => h?.close());

  let anaId: string;

  it('alta con validación: campos de la fuente, nombre o razón social, documento en par', async () => {
    await create('admin-a@test.local', orgA, { producer_code: 'X1' }).expect(400);
    await create('admin-a@test.local', orgA, { producer_code: 'X1', first_name: 'Solo' }).expect(400);
    await create('admin-a@test.local', orgA, { producer_code: 'X1', legal_name: 'Finca SA', document_number: '123' }).expect(400);
    await create('admin-a@test.local', orgA, { producer_code: 'mal código!', legal_name: 'X' }).expect(400);
    await create('admin-a@test.local', orgA, { ...ana, inventado: 'x' }).expect(400);
    const res = await create('admin-a@test.local', orgA, { ...ana, assigned_membership_id: await membershipId('tecnico1@test.local', orgA) }).expect(201);
    anaId = res.body.id;
    expect(res.body).toMatchObject({ producer_code: 'PRD-001', status: 'ACTIVE', display_name: 'Ana Cedeño', row_version: 1, document_number: '1301234567' });
    await create('admin-a@test.local', orgA, { producer_code: 'PRD-001', legal_name: 'Otro' }).expect(409);
    // Mismo código en otra organización: permitido (unicidad por tenant).
    await create('admin-b@test.local', orgB, { producer_code: 'PRD-001', legal_name: 'Productora B' }).expect(201);
  });

  it('registro atómico: productor, versión, evento y auditoría en la misma transacción; sin datos personales', async () => {
    const ev = await h.db.selectFrom('domain_events').selectAll().where('aggregate_id', '=', anaId).execute();
    expect(ev.map((e) => e.event_type)).toEqual(['ProducerRegistered']);
    const blob = JSON.stringify(ev) + JSON.stringify(await h.db.selectFrom('audit_logs').select(['before', 'after']).where('entity_id', '=', anaId).execute());
    for (const pii of ['Ana', 'Cedeño', '1301234567', '4567']) expect(blob).not.toContain(pii);
    const v = await h.db.selectFrom('producer_versions').select(['version', 'change_type']).where('producer_id', '=', anaId).execute();
    expect(v).toEqual([{ version: '1', change_type: 'CREATE' }]);
    // Si falla una pieza (código duplicado), no queda nada: ni versión ni evento.
    const before = await h.db.selectFrom('domain_events').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow();
    await create('admin-a@test.local', orgA, { producer_code: 'PRD-001', legal_name: 'Duplicado' }).expect(409);
    const after = await h.db.selectFrom('domain_events').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });

  it('referencias por tenant: responsable de otra organización o sin acceso a productores → 422', async () => {
    const res = await create('admin-a@test.local', orgA, { producer_code: 'PRD-X', legal_name: 'X', assigned_membership_id: await membershipId('tecnico-b@test.local', orgB) }).expect(422);
    expect(res.body.error.code).toBe('ASSIGNEE_NOT_FOUND');
    const noAccess = await create('admin-a@test.local', orgA, { producer_code: 'PRD-X', legal_name: 'X', assigned_membership_id: await membershipId('calidad@test.local', orgA) }).expect(422);
    expect(noAccess.body.error.code).toBe('ASSIGNEE_WITHOUT_ACCESS');
    // La base también lo impide (FK compuesta).
    await expect(sql`UPDATE producers SET assigned_membership_id = ${await membershipId('tecnico-b@test.local', orgB)} WHERE id = ${anaId}`.execute(h.db))
      .rejects.toThrow(/producers_assignee_fk/);
  });

  it('el técnico solo ve y edita sus asignados; lo que registra queda asignado a él', async () => {
    const own = await create('tecnico2@test.local', orgA, { producer_code: 'PRD-002', first_name: 'Luis', last_name: 'Mera' }).expect(201);
    expect(own.body.assigned_membership_id).toBe(await membershipId('tecnico2@test.local', orgA));
    await create('tecnico2@test.local', orgA, { producer_code: 'PRD-003', legal_name: 'Y', assigned_membership_id: await membershipId('tecnico1@test.local', orgA) }).expect(403);
    const list2 = await http().get(base(orgA)).set(as('tecnico2@test.local')).expect(200);
    expect(list2.body.items.map((p: { producer_code: string }) => p.producer_code)).toEqual(['PRD-002']);
    await http().get(`${base(orgA)}/${anaId}`).set(as('tecnico2@test.local')).expect(404);
    await http().patch(`${base(orgA)}/${anaId}`).set(as('tecnico2@test.local')).send({ expected_version: 1, community: 'X' }).expect(404);
    const list1 = await http().get(base(orgA)).set(as('tecnico1@test.local')).expect(200);
    expect(list1.body.items.map((p: { producer_code: string }) => p.producer_code)).toEqual(['PRD-001']);
  });

  it('identidad protegida: AUDITOR lee sin documento, teléfono ni dirección, ni puede buscar por documento', async () => {
    const p = await http().get(`${base(orgA)}/${anaId}`).set(as('auditor@test.local')).expect(200);
    expect(p.body.identity_visible).toBe(false);
    expect(p.body.document_number).toBeUndefined();
    expect(p.body.phone).toBeUndefined();
    const byDoc = await http().get(`${base(orgA)}?q=1301234567`).set(as('auditor@test.local')).expect(200);
    expect(byDoc.body.items).toEqual([]);
    const byDocAdmin = await http().get(`${base(orgA)}?q=1301234567`).set(as('admin-a@test.local')).expect(200);
    expect(byDocAdmin.body.items.map((x: { id: string }) => x.id)).toEqual([anaId]);
    await http().patch(`${base(orgA)}/${anaId}`).set(as('auditor@test.local')).send({ expected_version: 1, community: 'X' }).expect(403);
    await create('auditor@test.local', orgA, { producer_code: 'PRD-A', legal_name: 'A' }).expect(403);
    await http().get(base(orgA)).set(as('calidad@test.local')).expect(403);
  });

  it('búsqueda y paginación estable por código, sin filas de otra organización', async () => {
    for (let i = 10; i < 17; i++) await create('admin-a@test.local', orgA, { producer_code: `PRD-0${i}`, legal_name: `Finca ${i}`, community: i % 2 ? 'El Carmen' : 'Chone' }).expect(201);
    const p1 = await http().get(`${base(orgA)}?limit=4`).set(as('admin-a@test.local')).expect(200);
    expect(p1.body.items).toHaveLength(4);
    const p2 = await http().get(`${base(orgA)}?limit=4&cursor=${p1.body.next_cursor}`).set(as('admin-a@test.local')).expect(200);
    const p3 = await http().get(`${base(orgA)}?limit=4&cursor=${p2.body.next_cursor}`).set(as('admin-a@test.local')).expect(200);
    const all = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((p: { producer_code: string }) => p.producer_code);
    expect(all).toEqual([...all].sort());
    expect(new Set(all).size).toBe(all.length);
    expect(p3.body.next_cursor).toBeNull();
    const carmen = await http().get(`${base(orgA)}?q=carmen`).set(as('admin-a@test.local')).expect(200);
    expect(carmen.body.items.every((p: { community: string }) => p.community === 'El Carmen')).toBe(true);
    const listB = await http().get(base(orgB)).set(as('admin-b@test.local')).expect(200);
    expect(listB.body.items.map((p: { display_name: string }) => p.display_name)).toEqual(['Productora B']);
    await http().get(base(orgB)).set(as('admin-a@test.local')).expect(404);
    await http().get(`${base(orgB)}/${anaId}`).set(as('admin-b@test.local')).expect(404);
    await http().get(`${base(orgA)}?cursor=basura`).set(as('admin-a@test.local')).expect(400);
  });

  it('edición con control de concurrencia: dos ediciones sobre la misma versión → una 409', async () => {
    const [r1, r2] = await Promise.all([
      http().patch(`${base(orgA)}/${anaId}`).set(as('admin-a@test.local')).send({ expected_version: 1, community: 'San Isidro' }),
      http().patch(`${base(orgA)}/${anaId}`).set(as('tecnico1@test.local')).send({ expected_version: 1, phone: '+593 98 000 0000' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error.code).toBe('VERSION_CONFLICT');
    const v = await h.db.selectFrom('producer_versions').select('version').where('producer_id', '=', anaId).orderBy('version').execute();
    expect(v.map((x) => x.version)).toEqual(['1', '2']);
    await http().patch(`${base(orgA)}/${anaId}`).set(as('admin-a@test.local')).send({ expected_version: 2, community: null, first_name: null }).expect(400);
  });

  it('asignación por quien tiene producer:assign, con efecto inmediato en el alcance del técnico', async () => {
    const t2 = await membershipId('tecnico2@test.local', orgA);
    await http().put(`${base(orgA)}/${anaId}/assignment`).set(as('tecnico1@test.local')).send({ expected_version: 2, membership_id: t2 }).expect(403);
    await http().put(`${base(orgA)}/${anaId}/assignment`).set(as('admin-a@test.local')).send({ expected_version: 2, membership_id: t2 }).expect(200);
    await http().get(`${base(orgA)}/${anaId}`).set(as('tecnico1@test.local')).expect(404);
    await http().get(`${base(orgA)}/${anaId}`).set(as('tecnico2@test.local')).expect(200);
  });

  it('baja lógica: conserva el registro y su historial, sale del listado por defecto, bloquea edición y se puede reactivar', async () => {
    await http().post(`${base(orgA)}/${anaId}/archive`).set(as('tecnico2@test.local')).send({ expected_version: 3, reason: 'Dejó la asociación' }).expect(403);
    await http().post(`${base(orgA)}/${anaId}/archive`).set(as('admin-a@test.local')).send({ expected_version: 3 }).expect(400);
    const a = await http().post(`${base(orgA)}/${anaId}/archive`).set(as('admin-a@test.local')).send({ expected_version: 3, reason: 'Dejó la asociación' }).expect(200);
    expect(a.body).toMatchObject({ status: 'INACTIVE', deletion_reason: 'Dejó la asociación' });
    const def = await http().get(base(orgA)).set(as('admin-a@test.local')).expect(200);
    expect(def.body.items.map((p: { id: string }) => p.id)).not.toContain(anaId);
    const inactive = await http().get(`${base(orgA)}?status=INACTIVE`).set(as('admin-a@test.local')).expect(200);
    expect(inactive.body.items.map((p: { id: string }) => p.id)).toEqual([anaId]);
    await http().patch(`${base(orgA)}/${anaId}`).set(as('admin-a@test.local')).send({ expected_version: 4, community: 'X' }).expect(409);
    const hist = await http().get(`${base(orgA)}/${anaId}/history`).set(as('admin-a@test.local')).expect(200);
    expect(hist.body.map((v: { change_type: string }) => v.change_type)).toEqual(['ARCHIVE', 'ASSIGN', 'UPDATE', 'CREATE']);
    expect(hist.body[3].snapshot.document_number).toBe('1301234567');
    const histAud = await http().get(`${base(orgA)}/${anaId}/history`).set(as('auditor@test.local')).expect(200);
    expect(JSON.stringify(histAud.body)).not.toContain('1301234567');
    await expect(sql`DELETE FROM producer_versions WHERE producer_id = ${anaId}`.execute(h.db)).rejects.toThrow(/append-only/);
    await http().post(`${base(orgA)}/${anaId}/activate`).set(as('admin-a@test.local')).send({ expected_version: 4, reason: 'Regresó' }).expect(200);
  });

  it('eventos del productor publicados y consumidos: la proyección cuenta por estado, sin duplicar en reentrega', async () => {
    const worker = new OutboxWorker(h.db, PRODUCTION_CONSUMERS, { backoffBaseMs: 10 });
    while ((await worker.runOnce()).claimed > 0) { /* drena */ }
    const summary = await http().get(`${base(orgA)}/summary`).set(as('admin-a@test.local')).expect(200);
    const real = await h.db.selectFrom('producers').select(['status', sql<number>`count(*)::int`.as('n')]).where('organization_id', '=', orgA).groupBy('status').execute();
    for (const r of real) expect(summary.body.counts[r.status]).toBe(r.n);
    await h.db.updateTable('event_deliveries').set({ status: 'PENDING', next_attempt_at: new Date(0) }).where('consumer', '=', 'producer-status-counts').execute();
    await worker.runOnce();
    const again = await http().get(`${base(orgA)}/summary`).set(as('admin-a@test.local')).expect(200);
    expect(again.body.counts).toEqual(summary.body.counts);
    await http().get(`${base(orgA)}/summary`).set(as('tecnico1@test.local')).expect(403);
  });

  it('organización suspendida: lectura sí, altas y ediciones no', async () => {
    await http().post(`/api/v1/organizations/${orgA}/suspend`).set(as('super@test.local')).send({ reason: 'Revisión' }).expect(200);
    await http().get(base(orgA)).set(as('admin-a@test.local')).expect(200);
    const res = await create('admin-a@test.local', orgA, { producer_code: 'PRD-S', legal_name: 'S' }).expect(403);
    expect(res.body.error.code).toBe('ORGANIZATION_SUSPENDED');
    await http().post(`/api/v1/organizations/${orgA}/reactivate`).set(as('super@test.local')).send({ reason: 'Fin' }).expect(200);
  });
});
