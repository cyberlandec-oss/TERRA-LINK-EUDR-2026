import { createHash } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Integración P0-002 (RF-02 / QA-01) contra PostgreSQL real: invitaciones de un solo uso,
// anti-escalamiento, aislamiento entre organizaciones, desactivación y reactivación.
describeDb('P0-002 usuarios e invitaciones (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const http = () => h.http();
  const as = (email: string) => h.as(email);

  const invite = (actor: string, org: string, email: string, role_code: string) =>
    http().post(`/api/v1/organizations/${org}/invitations`).set(as(actor)).send({ email, role_code });
  const accept = (body: Record<string, unknown>, auth?: Record<string, string>) =>
    http().post('/api/v1/invitations/accept').set(auth ?? {}).send(body);
  const newUser = { first_name: 'Ana', last_name: 'Campo', password: PASSWORD };

  async function membershipOf(email: string, org: string) {
    return h.db
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['m.id', 'm.status'])
      .where('u.email', '=', email)
      .where('m.organization_id', '=', org)
      .executeTakeFirstOrThrow();
  }

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local'))
        .send({ name, organization_type: 'ASSOCIATION', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Asociación A', 'admin-a@test.local');
    orgB = await mk('Exportadora B', 'admin-b@test.local');
  });
  afterAll(async () => h?.close());

  let techToken: string;

  it('crea una invitación ligada a organización, destinatario y rol; guarda solo el hash y no registra el token', async () => {
    const res = await invite('admin-a@test.local', orgA, 'Tecnico@Test.Local', 'FIELD_TECHNICIAN').expect(201);
    techToken = res.body.token;
    expect(techToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body).toMatchObject({ email: 'tecnico@test.local', role_code: 'FIELD_TECHNICIAN', status: 'PENDING' });
    const row = await h.db.selectFrom('invitations').select('token_hash').where('id', '=', res.body.id).executeTakeFirstOrThrow();
    expect(row.token_hash).toBe(createHash('sha256').update(techToken).digest('hex'));
    const audit = await sql<{ dump: string }>`SELECT string_agg(coalesce(before::text,'') || coalesce(after::text,'') || coalesce(reason,''), '') AS dump FROM audit_logs`.execute(h.db);
    expect(audit.rows[0].dump).not.toContain(techToken);
    // El listado nunca devuelve el token ni el hash.
    const list = await http().get(`/api/v1/organizations/${orgA}/invitations`).set(as('admin-a@test.local')).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(techToken);
    expect(JSON.stringify(list.body)).not.toContain(row.token_hash);
  });

  it('la vista previa informa la invitación a quien tiene el token; un token desconocido da 404', async () => {
    const p = await http().post('/api/v1/invitations/preview').send({ token: techToken }).expect(200);
    expect(p.body).toMatchObject({ organization_name: 'Asociación A', role_code: 'FIELD_TECHNICIAN', requires_login: false });
    await http().post('/api/v1/invitations/preview').send({ token: 'A'.repeat(43) }).expect(404);
  });

  it('el cliente no puede cambiar organización, destinatario ni rol al aceptar (y no se consume)', async () => {
    await accept({ token: techToken, ...newUser, organization_id: orgB }).expect(400);
    await accept({ token: techToken, ...newUser, role_code: 'ORG_ADMIN' }).expect(400);
    await accept({ token: techToken, ...newUser, email: 'otro@test.local' }).expect(400);
    const inv = await h.db.selectFrom('invitations').select('status').where('email', '=', 'tecnico@test.local').executeTakeFirstOrThrow();
    expect(inv.status).toBe('PENDING');
  });

  it('aceptación válida crea usuario y membresía con el rol invitado, sin marcar el correo como verificado', async () => {
    const res = await accept({ token: techToken, ...newUser }).expect(200);
    expect(res.body.organization_id).toBe(orgA);
    h.tokens['tecnico@test.local'] = res.body.session.access_token;
    const u = await h.db.selectFrom('users').select(['email_verified_at', 'platform_role']).where('email', '=', 'tecnico@test.local').executeTakeFirstOrThrow();
    expect(u.email_verified_at).toBeNull();
    expect(u.platform_role).toBeNull();
    const members = await http().get(`/api/v1/organizations/${orgA}/members`).set(as('admin-a@test.local')).expect(200);
    const tech = members.body.find((m: { email: string }) => m.email === 'tecnico@test.local');
    expect(tech).toMatchObject({ status: 'ACTIVE', roles: ['FIELD_TECHNICIAN'] });
    await h.login('tecnico@test.local');
    await http().get(`/api/v1/organizations/${orgA}`).set(as('tecnico@test.local')).expect(200);
  });

  it('acceso entre organizaciones: el invitado no ve B y el admin de A no invita ni lista en B', async () => {
    await http().get(`/api/v1/organizations/${orgB}`).set(as('tecnico@test.local')).expect(404);
    await invite('admin-a@test.local', orgB, 'intruso@test.local', 'AUDITOR').expect(404);
    await http().get(`/api/v1/organizations/${orgB}/members`).set(as('admin-a@test.local')).expect(404);
    await http().get(`/api/v1/organizations/${orgB}/invitations`).set(as('admin-a@test.local')).expect(404);
  });

  it('token reutilizado → 410 INVITATION_USED', async () => {
    const res = await accept({ token: techToken, ...newUser }).expect(410);
    expect(res.body.error.code).toBe('INVITATION_USED');
  });

  it('token revocado → 410 INVITATION_REVOKED; revocar dos veces → 409', async () => {
    const inv = await invite('admin-a@test.local', orgA, 'revocada@test.local', 'AUDITOR').expect(201);
    await http().post(`/api/v1/organizations/${orgA}/invitations/${inv.body.id}/revoke`).set(as('admin-a@test.local')).expect(200);
    const res = await accept({ token: inv.body.token, ...newUser }).expect(410);
    expect(res.body.error.code).toBe('INVITATION_REVOKED');
    await http().post(`/api/v1/organizations/${orgA}/invitations/${inv.body.id}/revoke`).set(as('admin-a@test.local')).expect(409);
    // Admin de B no puede revocar invitaciones de A.
    await http().post(`/api/v1/organizations/${orgA}/invitations/${inv.body.id}/revoke`).set(as('admin-b@test.local')).expect(404);
  });

  it('token vencido → 410 INVITATION_EXPIRED y se puede reemitir al mismo correo', async () => {
    const inv = await invite('admin-a@test.local', orgA, 'vencida@test.local', 'AUDITOR').expect(201);
    await invite('admin-a@test.local', orgA, 'vencida@test.local', 'AUDITOR').expect(409); // pendiente vigente
    await h.db.updateTable('invitations').set({ expires_at: new Date(Date.now() - 1000) }).where('id', '=', inv.body.id).execute();
    const res = await accept({ token: inv.body.token, ...newUser }).expect(410);
    expect(res.body.error.code).toBe('INVITATION_EXPIRED');
    const list = await http().get(`/api/v1/organizations/${orgA}/invitations`).set(as('admin-a@test.local')).expect(200);
    expect(list.body.find((i: { id: string }) => i.id === inv.body.id).status).toBe('EXPIRED');
    await invite('admin-a@test.local', orgA, 'vencida@test.local', 'AUDITOR').expect(201);
  });

  it('aceptaciones concurrentes: un único éxito, sin duplicar usuario ni membresía', async () => {
    const inv = await invite('admin-a@test.local', orgA, 'concurrente@test.local', 'QUALITY_OPERATOR').expect(201);
    const results = await Promise.all(Array.from({ length: 6 }, () => accept({ token: inv.body.token, ...newUser })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.every((s) => s === 200 || s === 410)).toBe(true);
    const users = await h.db.selectFrom('users').select(sql<number>`count(*)::int`.as('n')).where('email', '=', 'concurrente@test.local').executeTakeFirstOrThrow();
    expect(users.n).toBe(1);
    const ms = await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id')
      .select(sql<number>`count(*)::int`.as('n')).where('u.email', '=', 'concurrente@test.local').executeTakeFirstOrThrow();
    expect(ms.n).toBe(1);
  });

  it('escalamiento de privilegios: sin membership:assign no se invita; SUPER_ADMIN no es asignable', async () => {
    const res = await invite('tecnico@test.local', orgA, 'x@test.local', 'FIELD_TECHNICIAN').expect(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
    await invite('admin-a@test.local', orgA, 'x@test.local', 'SUPER_ADMIN').expect(400);
    await invite('admin-a@test.local', orgA, 'x@test.local', 'INVENTADO').expect(400);
    const roles = await http().get(`/api/v1/organizations/${orgA}/assignable-roles`).set(as('admin-a@test.local')).expect(200);
    expect(roles.body.roles).not.toContain('SUPER_ADMIN');
    await http().get(`/api/v1/organizations/${orgA}/assignable-roles`).set(as('tecnico@test.local')).expect(403);
  });

  it('cuenta existente: exige sesión del destinatario; otra cuenta no puede aceptar por él', async () => {
    const inv = await invite('admin-a@test.local', orgA, 'admin-b@test.local', 'AUDITOR').expect(201);
    const p = await http().post('/api/v1/invitations/preview').send({ token: inv.body.token }).expect(200);
    expect(p.body.requires_login).toBe(true);
    await accept({ token: inv.body.token }).expect(401);
    const wrong = await accept({ token: inv.body.token }, as('tecnico@test.local')).expect(403);
    expect(wrong.body.error.code).toBe('INVITATION_RECIPIENT_MISMATCH');
    await accept({ token: inv.body.token }, as('admin-b@test.local')).expect(200);
    const orgs = await http().get('/api/v1/organizations').set(as('admin-b@test.local')).expect(200);
    expect(orgs.body.map((o: { id: string }) => o.id).sort()).toEqual([orgA, orgB].sort());
    await invite('admin-a@test.local', orgA, 'tecnico@test.local', 'AUDITOR').expect(409); // ya es miembro
  });

  it('desactivar membresía corta el acceso al instante; reactivación auditada lo restaura', async () => {
    const tech = await membershipOf('tecnico@test.local', orgA);
    const self = await membershipOf('admin-a@test.local', orgA);
    await http().post(`/api/v1/organizations/${orgA}/members/${self.id}/deactivate`).set(as('admin-a@test.local')).send({ reason: 'prueba' }).expect(409);
    await http().post(`/api/v1/organizations/${orgA}/members/${tech.id}/deactivate`).set(as('admin-b@test.local')).send({ reason: 'auditor intenta' }).expect(403);
    await http().post(`/api/v1/organizations/${orgA}/members/${tech.id}/deactivate`).set(as('admin-a@test.local')).send({}).expect(400);
    await http().post(`/api/v1/organizations/${orgA}/members/${tech.id}/deactivate`).set(as('admin-a@test.local')).send({ reason: 'Fin de contrato' }).expect(200);
    // Mismo token, sin esperar caducidad: la organización deja de ser visible.
    await http().get(`/api/v1/organizations/${orgA}`).set(as('tecnico@test.local')).expect(404);
    const mine = await http().get('/api/v1/organizations').set(as('tecnico@test.local')).expect(200);
    expect(mine.body).toEqual([]);
    await http().post(`/api/v1/organizations/${orgA}/members/${tech.id}/reactivate`).set(as('admin-a@test.local')).send({ reason: 'Recontratado' }).expect(200);
    await http().get(`/api/v1/organizations/${orgA}`).set(as('tecnico@test.local')).expect(200);
    const actions = await h.db.selectFrom('audit_logs').select(['action', 'reason']).where('entity_id', '=', tech.id).orderBy('occurred_at').execute();
    expect(actions).toEqual([
      expect.objectContaining({ action: 'membership.deactivate', reason: 'Fin de contrato' }),
      expect.objectContaining({ action: 'membership.reactivate', reason: 'Recontratado' }),
    ]);
  });

  it('desactivar la cuenta invalida todas sus sesiones; tras reactivar, los tokens viejos siguen inválidos', async () => {
    const old = h.tokens['tecnico@test.local'];
    const u = await h.db.selectFrom('users').select('id').where('email', '=', 'tecnico@test.local').executeTakeFirstOrThrow();
    await http().post(`/api/v1/users/${u.id}/deactivate`).set(as('admin-a@test.local')).send({ reason: 'x'.repeat(5) }).expect(403);
    await http().post(`/api/v1/users/${u.id}/deactivate`).set(as('super@test.local')).send({ reason: 'Cuenta comprometida' }).expect(200);
    await http().get('/api/v1/me').set({ Authorization: `Bearer ${old}` }).expect(401);
    await http().post('/api/v1/auth/login').send({ email: 'tecnico@test.local', password: PASSWORD }).expect(401);
    await http().post(`/api/v1/users/${u.id}/reactivate`).set(as('super@test.local')).send({ reason: 'Restablecida' }).expect(200);
    await http().get('/api/v1/me').set({ Authorization: `Bearer ${old}` }).expect(401);
    await h.login('tecnico@test.local');
    await http().get('/api/v1/me').set(as('tecnico@test.local')).expect(200);
  });

  it('el listado global de usuarios es solo de plataforma y no expone correo ni roles', async () => {
    await http().get('/api/v1/users').set(as('admin-a@test.local')).expect(403);
    const r = await http().get('/api/v1/users').set(as('super@test.local')).expect(200);
    const lista = r.body.users as Array<Record<string, unknown>>;
    expect(lista.length).toBeGreaterThan(0);
    const tec = lista.find((x) => x.name !== undefined && Array.isArray(x.organizations) && (x.organizations as string[]).length > 0);
    expect(tec).toBeDefined();
    for (const x of lista) {
      expect(Object.keys(x).sort()).toEqual(['is_platform_admin', 'name', 'organizations', 'status', 'user_id']);
    }
  });

  it('una organización suspendida no admite invitaciones nuevas ni aceptaciones', async () => {
    const inv = await invite('admin-a@test.local', orgA, 'tarde@test.local', 'AUDITOR').expect(201);
    await http().post(`/api/v1/organizations/${orgA}/suspend`).set(as('super@test.local')).send({ reason: 'Revisión' }).expect(200);
    const blocked = await invite('admin-a@test.local', orgA, 'otra@test.local', 'AUDITOR').expect(403);
    expect(blocked.body.error.code).toBe('ORGANIZATION_SUSPENDED');
    await accept({ token: inv.body.token, ...newUser }).expect(403);
    await http().post(`/api/v1/organizations/${orgA}/reactivate`).set(as('super@test.local')).send({ reason: 'Fin revisión' }).expect(200);
  });
});
