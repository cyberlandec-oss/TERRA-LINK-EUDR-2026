import { sql } from 'kysely';
import { describeDb, setupHarness } from './helpers';

// Integración P0-001 contra PostgreSQL/PostGIS real (TEST_DATABASE_URL, base aislada terra_link_test).
// Cubre RF-01 / QA-01 / QA-02 (parte organización).
describeDb('P0-001 organizaciones (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  const http = () => h.http();
  const as = (email: string) => h.as(email);

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    await h.user('admin-b@test.local');
    await h.user('tecnico-a@test.local');
  });

  afterAll(async () => {
    await h?.close();
  });

  let orgA: string;
  let orgB: string;

  it('401 sin sesión y credenciales inválidas sin revelar el email', async () => {
    await http().get('/api/v1/organizations').expect(401);
    const res = await http().post('/api/v1/auth/login').send({ email: 'nadie@test.local', password: 'x' }).expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('SUPER_ADMIN crea organizaciones con datos mínimos y ORG_ADMIN inicial; se audita en la misma transacción', async () => {
    const a = await http()
      .post('/api/v1/organizations')
      .set(as('super@test.local'))
      .send({ name: 'Asociación A', organization_type: 'ASSOCIATION', country: 'EC', initial_admin_email: 'admin-a@test.local' })
      .expect(201);
    orgA = a.body.id;
    expect(a.body).toMatchObject({ status: 'ACTIVE', row_version: 1, country: 'EC' });
    const b = await http()
      .post('/api/v1/organizations')
      .set(as('super@test.local'))
      .send({ name: 'Exportadora B', organization_type: 'EXPORTER', country: 'EC', initial_admin_email: 'admin-b@test.local' })
      .expect(201);
    orgB = b.body.id;

    const audit = await h.db.selectFrom('audit_logs').select(['action', 'result']).where('organization_id', '=', orgA).execute();
    expect(audit.map((r) => r.action).sort()).toEqual(['membership.create', 'organization.create']);
  });

  it('valida datos mínimos (400) y usuario administrador inexistente (422) sin crear nada', async () => {
    await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: '', country: 'Ecuador' }).expect(400);
    const before = await h.db.selectFrom('organizations').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow();
    const res = await http()
      .post('/api/v1/organizations')
      .set(as('super@test.local'))
      .send({ name: 'C', organization_type: 'EXPORTER', country: 'EC', initial_admin_email: 'no-existe@test.local' })
      .expect(422);
    expect(res.body.error.code).toBe('INITIAL_ADMIN_NOT_FOUND');
    const after = await h.db.selectFrom('organizations').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });

  it('un ORG_ADMIN no puede crear organizaciones ni suspender (403)', async () => {
    await http()
      .post('/api/v1/organizations')
      .set(as('admin-a@test.local'))
      .send({ name: 'X', organization_type: 'EXPORTER', country: 'EC' })
      .expect(403);
    await http().post(`/api/v1/organizations/${orgA}/suspend`).set(as('admin-a@test.local')).send({ reason: 'intento' }).expect(403);
  });

  it('cada usuario solo ve y selecciona sus membresías activas', async () => {
    const res = await http().get('/api/v1/organizations').set(as('admin-a@test.local')).expect(200);
    expect(res.body.map((o: { id: string }) => o.id)).toEqual([orgA]);
    expect(res.body[0].roles).toEqual(['ORG_ADMIN']);
    const none = await http().get('/api/v1/organizations').set(as('tecnico-a@test.local')).expect(200);
    expect(none.body).toEqual([]);
    await http().get('/api/v1/organizations?scope=all').set(as('admin-a@test.local')).expect(403);
    const all = await http().get('/api/v1/organizations?scope=all').set(as('super@test.local')).expect(200);
    expect(all.body.map((o: { id: string }) => o.id).sort()).toEqual([orgA, orgB].sort());
  });

  it('A→A permitido; A→B devuelve 404 en lectura y escritura sin modificar B', async () => {
    await http().get(`/api/v1/organizations/${orgA}`).set(as('admin-a@test.local')).expect(200);
    await http().get(`/api/v1/organizations/${orgB}`).set(as('admin-a@test.local')).expect(404);
    await http().patch(`/api/v1/organizations/${orgB}`).set(as('admin-a@test.local')).send({ expected_version: 1, name: 'Hackeada' }).expect(404);
    const b = await h.db.selectFrom('organizations').select('name').where('id', '=', orgB).executeTakeFirstOrThrow();
    expect(b.name).toBe('Exportadora B');
  });

  it('miembro sin permiso de actualización recibe 403, no 404', async () => {
    const m = await h.db
      .insertInto('memberships')
      .values({
        organization_id: orgA,
        user_id: (await h.db.selectFrom('users').select('id').where('email', '=', 'tecnico-a@test.local').executeTakeFirstOrThrow()).id,
        status: 'ACTIVE',
        created_by: (await h.db.selectFrom('users').select('id').where('email', '=', 'super@test.local').executeTakeFirstOrThrow()).id,
        updated_by: (await h.db.selectFrom('users').select('id').where('email', '=', 'super@test.local').executeTakeFirstOrThrow()).id,
      })
      .returning(['id', 'created_by'])
      .executeTakeFirstOrThrow();
    await h.db.insertInto('role_assignments').values({ organization_id: orgA, membership_id: m.id, role_code: 'FIELD_TECHNICIAN', created_by: m.created_by }).execute();
    await http().get(`/api/v1/organizations/${orgA}`).set(as('tecnico-a@test.local')).expect(200);
    const res = await http().patch(`/api/v1/organizations/${orgA}`).set(as('tecnico-a@test.local')).send({ expected_version: 1, name: 'X' }).expect(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('la base rechaza asignar un rol con membresía de otra organización (FK compuesta)', async () => {
    const memberB = await h.db.selectFrom('memberships').select(['id', 'created_by']).where('organization_id', '=', orgB).executeTakeFirstOrThrow();
    await expect(
      h.db.insertInto('role_assignments').values({ organization_id: orgA, membership_id: memberB.id, role_code: 'MANAGER', created_by: memberB.created_by }).execute(),
    ).rejects.toThrow(/role_assignments_membership_fk/);
  });

  it('ORG_ADMIN configura con control de versión: 200 y luego 409 por versión obsoleta', async () => {
    const ok = await http().patch(`/api/v1/organizations/${orgA}`).set(as('admin-a@test.local')).send({ expected_version: 1, province: 'Manabí' }).expect(200);
    expect(ok.body).toMatchObject({ province: 'Manabí', row_version: 2 });
    const stale = await http().patch(`/api/v1/organizations/${orgA}`).set(as('admin-a@test.local')).send({ expected_version: 1, province: 'Guayas' }).expect(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('suspensión exige motivo, bloquea nuevas operaciones y conserva lectura e historial; reactivación restaura', async () => {
    await http().post(`/api/v1/organizations/${orgA}/suspend`).set(as('super@test.local')).send({}).expect(400);
    const s = await http().post(`/api/v1/organizations/${orgA}/suspend`).set(as('super@test.local')).send({ reason: 'Falta de pago' }).expect(200);
    expect(s.body).toMatchObject({ status: 'SUSPENDED', status_reason: 'Falta de pago' });
    await http().post(`/api/v1/organizations/${orgA}/suspend`).set(as('super@test.local')).send({ reason: 'otra vez' }).expect(409);

    const blocked = await http().patch(`/api/v1/organizations/${orgA}`).set(as('admin-a@test.local')).send({ expected_version: 3, canton: 'Portoviejo' }).expect(403);
    expect(blocked.body.error.code).toBe('ORGANIZATION_SUSPENDED');
    const read = await http().get(`/api/v1/organizations/${orgA}`).set(as('admin-a@test.local')).expect(200);
    expect(read.body.province).toBe('Manabí');

    await http().post(`/api/v1/organizations/${orgA}/reactivate`).set(as('super@test.local')).send({ reason: 'Pago recibido' }).expect(200);
    await http().patch(`/api/v1/organizations/${orgA}`).set(as('admin-a@test.local')).send({ expected_version: 4, canton: 'Portoviejo' }).expect(200);

    const actions = await h.db.selectFrom('audit_logs').select('action').where('organization_id', '=', orgA).orderBy('occurred_at').execute();
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['organization.update', 'organization.suspend', 'organization.reactivate']),
    );
  });

  it('la bitácora es append-only en base de datos', async () => {
    await expect(sql`UPDATE audit_logs SET action = 'x'`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM audit_logs`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('un usuario desactivado pierde acceso aunque su token no haya caducado', async () => {
    await h.db.updateTable('users').set({ status: 'INACTIVE' }).where('email', '=', 'admin-b@test.local').execute();
    await http().get('/api/v1/organizations').set(as('admin-b@test.local')).expect(401);
  });
});
