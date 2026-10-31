import { PASSWORD, describeDb, setupHarness } from './helpers';
import { ROLE_PERMISSIONS, permissionsForRoles } from '../src/authz/catalog';

// Integración P0-003 (RF-03 / QA-02) contra PostgreSQL real: catálogo efectivo por organización,
// usuarios con varios roles y organizaciones, cambios de rol inmediatos y anti-escalamiento,
// bitácora aislada, SUPER_ADMIN sin bypass (D-04) y ausencia de metadatos de otra organización.
describeDb('P0-003 RBAC y aislamiento (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const http = () => h.http();
  const as = (email: string) => h.as(email);

  async function join(admin: string, org: string, email: string, role: string) {
    const inv = await http().post(`/api/v1/organizations/${org}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    const existing = await h.db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
    const body = existing ? { token: inv.body.token } : { token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD };
    await http().post('/api/v1/invitations/accept').set(existing ? as(email) : {}).send(body).expect(200);
    if (!existing) await h.login(email);
  }
  const membership = (email: string, org: string) =>
    h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id')
      .select('m.id').where('u.email', '=', email).where('m.organization_id', '=', org).executeTakeFirstOrThrow();
  const permsIn = async (email: string, org: string) => {
    const res = await http().get('/api/v1/me/permissions').set(as(email)).expect(200);
    return res.body.organizations.find((o: { organization_id: string }) => o.organization_id === org);
  };

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    await h.user('admin-b@test.local');
    const mk = async (name: string, type: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local'))
        .send({ name, organization_type: type, country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Asociación A', 'ASSOCIATION', 'admin-a@test.local');
    orgB = await mk('Exportadora B', 'EXPORTER', 'admin-b@test.local');
    await join('admin-a@test.local', orgA, 'multi@test.local', 'MANAGER');
    await join('admin-b@test.local', orgB, 'multi@test.local', 'ORG_ADMIN');
    await join('admin-a@test.local', orgA, 'tecnico@test.local', 'FIELD_TECHNICIAN');
    await join('admin-a@test.local', orgA, 'auditor@test.local', 'AUDITOR');
  });
  afterAll(async () => h?.close());

  it('catálogo efectivo por organización: cada org con sus roles y permisos, sin plataforma', async () => {
    const res = await http().get('/api/v1/me/permissions').set(as('multi@test.local')).expect(200);
    expect(res.body.platform_permissions).toEqual([]);
    expect(res.body.organizations).toHaveLength(2);
    expect((await permsIn('multi@test.local', orgA))).toMatchObject({ roles: ['MANAGER'], permissions: permissionsForRoles(['MANAGER']) });
    expect((await permsIn('multi@test.local', orgB))).toMatchObject({ roles: ['ORG_ADMIN'], permissions: permissionsForRoles(['ORG_ADMIN']) });
  });

  it('un rol en una organización no concede permisos en otra', async () => {
    // ORG_ADMIN en B, MANAGER en A.
    await http().patch(`/api/v1/organizations/${orgB}`).set(as('multi@test.local')).send({ expected_version: 1, province: 'Guayas' }).expect(200);
    const denied = await http().patch(`/api/v1/organizations/${orgA}`).set(as('multi@test.local')).send({ expected_version: 1, province: 'X' }).expect(403);
    expect(denied.body.error.code).toBe('PERMISSION_DENIED');
    await http().post(`/api/v1/organizations/${orgA}/invitations`).set(as('multi@test.local')).send({ email: 'z@test.local', role_code: 'AUDITOR' }).expect(403);
    await http().get(`/api/v1/organizations/${orgA}/members`).set(as('multi@test.local')).expect(200); // membership:read de MANAGER
    await http().get(`/api/v1/organizations/${orgA}/audit-logs`).set(as('multi@test.local')).expect(403);
    await http().get(`/api/v1/organizations/${orgB}/audit-logs`).set(as('multi@test.local')).expect(200);
  });

  it('la matriz pública de roles coincide con el catálogo y no contiene datos de organizaciones', async () => {
    const res = await http().get('/api/v1/rbac/roles').set(as('tecnico@test.local')).expect(200);
    const map = Object.fromEntries(res.body.organization_roles.map((r: { role: string; permissions: string[] }) => [r.role, r.permissions]));
    expect(map).toEqual(ROLE_PERMISSIONS);
    expect(JSON.stringify(res.body)).not.toMatch(/Asociación|Exportadora|@test\.local/);
    await http().get('/api/v1/rbac/roles').expect(401);
  });

  it('el tipo comercial de organización no concede permisos', async () => {
    const a = await permsIn('admin-a@test.local', orgA); // ASSOCIATION
    const b = await permsIn('admin-b@test.local', orgB); // EXPORTER
    expect(a.permissions).toEqual(b.permissions);
  });

  it('catálogo provisional de tipos (D-18): etiquetas en español y rechazo de códigos fuera del catálogo', async () => {
    const res = await http().get('/api/v1/catalog/organization-types').set(as('tecnico@test.local')).expect(200);
    expect(res.body.map((t: { code: string }) => t.code)).toEqual(
      ['ASSOCIATION', 'COOPERATIVE', 'COLLECTOR', 'PROCESSOR', 'EXPORTER', 'IMPORTER', 'MANUFACTURER', 'OTHER'],
    );
    expect(res.body.every((t: { status: string }) => t.status === 'PROVISIONAL')).toBe(true);
    expect(res.body[0].label_es).toBe('Asociación de productores');
    const bad = await http().post('/api/v1/organizations').set(as('super@test.local'))
      .send({ name: 'X', organization_type: 'INVENTED', country: 'EC' }).expect(422);
    expect(bad.body.error.code).toBe('ORGANIZATION_TYPE_UNKNOWN');
  });

  it('cambio de roles con efecto inmediato sobre la misma sesión, auditado', async () => {
    const tech = await membership('tecnico@test.local', orgA);
    await http().patch(`/api/v1/organizations/${orgA}`).set(as('tecnico@test.local')).send({ expected_version: 1, canton: 'Chone' }).expect(403);
    await http().put(`/api/v1/organizations/${orgA}/members/${tech.id}/roles`).set(as('admin-a@test.local'))
      .send({ roles: ['FIELD_TECHNICIAN', 'ORG_ADMIN'], reason: 'Cobertura temporal' }).expect(200);
    await http().patch(`/api/v1/organizations/${orgA}`).set(as('tecnico@test.local')).send({ expected_version: 1, canton: 'Chone' }).expect(200);
    await http().put(`/api/v1/organizations/${orgA}/members/${tech.id}/roles`).set(as('admin-a@test.local'))
      .send({ roles: ['FIELD_TECHNICIAN'], reason: 'Fin de cobertura' }).expect(200);
    // Mismo token: el permiso se pierde sin esperar a que caduque.
    await http().patch(`/api/v1/organizations/${orgA}`).set(as('tecnico@test.local')).send({ expected_version: 2, canton: 'Bolívar' }).expect(403);
    const audit = await h.db.selectFrom('audit_logs').select(['action', 'before', 'after', 'reason']).where('entity_id', '=', tech.id)
      .where('action', '=', 'membership.roles_change').orderBy('occurred_at').execute();
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({ reason: 'Fin de cobertura', before: { roles: ['FIELD_TECHNICIAN', 'ORG_ADMIN'] } });
  });

  it('anti-escalamiento y validación en cambios de rol', async () => {
    const tech = await membership('tecnico@test.local', orgA);
    const self = await membership('admin-a@test.local', orgA);
    const put = (actor: string, org: string, mid: string, body: object) =>
      http().put(`/api/v1/organizations/${org}/members/${mid}/roles`).set(as(actor)).send(body);
    await put('admin-a@test.local', orgA, self.id, { roles: ['AUDITOR'], reason: 'auto' }).expect(409);
    await put('multi@test.local', orgA, tech.id, { roles: ['ORG_ADMIN'], reason: 'escalar' }).expect(403); // MANAGER en A
    await put('admin-a@test.local', orgA, tech.id, { roles: ['SUPER_ADMIN'], reason: 'x'.repeat(3) }).expect(400);
    await put('admin-a@test.local', orgA, tech.id, { roles: [], reason: 'vaciar' }).expect(400);
    await put('admin-a@test.local', orgA, tech.id, { roles: ['FIELD_TECHNICIAN'], reason: 'igual' }).expect(409);
    // Membresía de B por la ruta de A, o admin de B sobre A: 404 sin revelar nada.
    const bMember = await membership('admin-b@test.local', orgB);
    await put('admin-a@test.local', orgA, bMember.id, { roles: ['AUDITOR'], reason: 'cruce' }).expect(404);
    await put('admin-b@test.local', orgA, tech.id, { roles: ['AUDITOR'], reason: 'cruce' }).expect(404);
    // Campos de tenant en el cuerpo no se aceptan como autoridad.
    await http().post(`/api/v1/organizations/${orgA}/invitations`).set(as('admin-a@test.local'))
      .send({ email: 'y@test.local', role_code: 'AUDITOR', organization_id: orgB }).expect(400);
  });

  it('D-07.6: la excepción al anti-escalamiento es EXACTA: ORG_ADMIN asigna y retira EUDR_MANAGER en SU organización y nada más', async () => {
    const tech = await membership('tecnico@test.local', orgA);
    const self = await membership('admin-a@test.local', orgA);
    const bMember = await membership('admin-b@test.local', orgB);
    const put = (actor: string, org: string, mid: string, body: object) =>
      http().put(`/api/v1/organizations/${org}/members/${mid}/roles`).set(as(actor)).send(body);
    const roles = (await http().get(`/api/v1/organizations/${orgA}/assignable-roles`).set(as('admin-a@test.local')).expect(200)).body.roles as string[];
    expect(roles).toContain('EUDR_MANAGER');
    expect(roles).not.toContain('SUPER_ADMIN');
    // Autorizado: asignar y retirar el rol responsable dentro de la propia organización (queda auditado).
    await put('admin-a@test.local', orgA, tech.id, { roles: ['FIELD_TECHNICIAN', 'EUDR_MANAGER'], reason: 'Designación del responsable EUDR' }).expect(200);
    await put('admin-a@test.local', orgA, tech.id, { roles: ['FIELD_TECHNICIAN'], reason: 'Fin de la designación' }).expect(200);
    // Límites: no a sí mismo, no con roles inexistentes o globales, no en otra organización, no sin membership:assign.
    await put('admin-a@test.local', orgA, self.id, { roles: ['ORG_ADMIN', 'EUDR_MANAGER'], reason: 'auto-designación' }).expect(409);
    await put('admin-a@test.local', orgA, tech.id, { roles: ['EUDR_MANAGER', 'SUPER_ADMIN'], reason: 'escalar' }).expect(400);
    await put('admin-a@test.local', orgA, bMember.id, { roles: ['EUDR_MANAGER'], reason: 'cruce' }).expect(404);
    await put('admin-b@test.local', orgA, tech.id, { roles: ['FIELD_TECHNICIAN', 'EUDR_MANAGER'], reason: 'cruce' }).expect(404);
    await put('multi@test.local', orgA, tech.id, { roles: ['FIELD_TECHNICIAN', 'EUDR_MANAGER'], reason: 'sin membership:assign' }).expect(403); // MANAGER
    // Quien recibe el rol responsable NO obtiene capacidad de administrar miembros ni de repartir roles.
    await put('admin-a@test.local', orgA, tech.id, { roles: ['EUDR_MANAGER'], reason: 'Designación del responsable EUDR' }).expect(200);
    await put('tecnico@test.local', orgA, self.id, { roles: ['ORG_ADMIN', 'AUDITOR'], reason: 'sin facultad' }).expect(403);
    await http().get(`/api/v1/organizations/${orgA}/assignable-roles`).set(as('tecnico@test.local')).expect(403);
    await put('admin-a@test.local', orgA, tech.id, { roles: ['FIELD_TECHNICIAN'], reason: 'Fin de la designación' }).expect(200);
    // La excepción NO le da a ORG_ADMIN la capacidad de concluir: los permisos del catálogo lo confirman.
    const { ROLE_PERMISSIONS } = await import('../src/authz/catalog');
    expect(ROLE_PERMISSIONS.ORG_ADMIN).not.toContain('risk:conclude');
    expect(ROLE_PERMISSIONS.EUDR_MANAGER).toContain('risk:conclude');
    expect(ROLE_PERMISSIONS.EUDR_MANAGER).not.toContain('membership:assign');
  });

  it('bitácora: solo filas de la organización, actor de plataforma anonimizado, permisos por rol', async () => {
    const res = await http().get(`/api/v1/organizations/${orgA}/audit-logs?limit=100`).set(as('auditor@test.local')).expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    const ids = new Set(res.body.items.map((r: { id: string }) => r.id));
    const rowsA = await h.db.selectFrom('audit_logs').select('id').where('organization_id', '=', orgA).execute();
    expect(rowsA.every((r) => ids.has(r.id))).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(orgB);
    expect(JSON.stringify(res.body)).not.toContain('admin-b@test.local');
    expect(JSON.stringify(res.body)).not.toContain('super@test.local');
    expect(res.body.items.find((r: { action: string }) => r.action === 'organization.create').actor.key).toBe('PLATFORM');
    await http().get(`/api/v1/organizations/${orgA}/audit-logs`).set(as('tecnico@test.local')).expect(403);
    await http().get(`/api/v1/organizations/${orgA}/audit-logs`).set(as('admin-b@test.local')).expect(404);
    await http().get(`/api/v1/organizations/${orgA}/audit-logs?limit=1000`).set(as('auditor@test.local')).expect(400);
  });

  it('SUPER_ADMIN sin membresía: solo incorpora al ORG_ADMIN; sin acceso a miembros ni bitácora (D-04)', async () => {
    const roles = await http().get(`/api/v1/organizations/${orgA}/assignable-roles`).set(as('super@test.local')).expect(200);
    expect(roles.body).toEqual({ roles: ['ORG_ADMIN'], onboarding_only: true });
    const notAdmin = await http().post(`/api/v1/organizations/${orgA}/invitations`).set(as('super@test.local'))
      .send({ email: 'otro@test.local', role_code: 'AUDITOR' }).expect(403);
    expect(notAdmin.body.error.code).toBe('ROLE_NOT_GRANTABLE');
    await http().post(`/api/v1/organizations/${orgA}/invitations`).set(as('super@test.local'))
      .send({ email: 'segundo-admin@test.local', role_code: 'ORG_ADMIN' }).expect(201);
    const inv = await http().get(`/api/v1/organizations/${orgA}/invitations`).set(as('super@test.local')).expect(200);
    expect(inv.body.every((i: { role_code: string }) => i.role_code === 'ORG_ADMIN')).toBe(true);
    const members = await http().get(`/api/v1/organizations/${orgA}/members`).set(as('super@test.local')).expect(403);
    expect(members.body.error.code).toBe('ELEVATION_REQUIRED');
    const tech = await membership('tecnico@test.local', orgA);
    await http().post(`/api/v1/organizations/${orgA}/members/${tech.id}/deactivate`).set(as('super@test.local')).send({ reason: 'prueba' }).expect(403);
    await http().put(`/api/v1/organizations/${orgA}/members/${tech.id}/roles`).set(as('super@test.local')).send({ roles: ['AUDITOR'], reason: 'prueba' }).expect(403);
    await http().get(`/api/v1/organizations/${orgA}/audit-logs`).set(as('super@test.local')).expect(404);
    const perms = await http().get('/api/v1/me/permissions').set(as('super@test.local')).expect(200);
    expect(perms.body.organizations).toEqual([]);
    expect(perms.body.platform_permissions).toContain('organization:onboard_admin');
  });

  it('revocar una membresía la quita del catálogo efectivo al instante y no afecta a la otra organización', async () => {
    const m = await membership('multi@test.local', orgA);
    await http().post(`/api/v1/organizations/${orgA}/members/${m.id}/deactivate`).set(as('admin-a@test.local')).send({ reason: 'Baja en A' }).expect(200);
    const res = await http().get('/api/v1/me/permissions').set(as('multi@test.local')).expect(200);
    expect(res.body.organizations.map((o: { organization_id: string }) => o.organization_id)).toEqual([orgB]);
    const gone = await http().get(`/api/v1/organizations/${orgA}`).set(as('multi@test.local')).expect(404);
    expect(JSON.stringify(gone.body)).not.toContain('Asociación A');
    await http().get(`/api/v1/organizations/${orgB}/members`).set(as('multi@test.local')).expect(200);
  });

  it('listados y errores no exponen datos ni metadatos de otra organización', async () => {
    const list = await http().get('/api/v1/organizations').set(as('tecnico@test.local')).expect(200);
    expect(list.body.map((o: { id: string }) => o.id)).toEqual([orgA]);
    const members = await http().get(`/api/v1/organizations/${orgA}/members`).set(as('admin-a@test.local')).expect(200);
    expect(JSON.stringify(members.body)).not.toContain('admin-b@test.local');
    const err = await http().get(`/api/v1/organizations/${orgB}`).set(as('tecnico@test.local')).expect(404);
    expect(JSON.stringify(err.body)).not.toContain('Exportadora B');
    const inv = await http().get(`/api/v1/organizations/${orgB}/invitations`).set(as('tecnico@test.local')).expect(404);
    expect(inv.body.error.code).toBe('NOT_FOUND');
  });
});
