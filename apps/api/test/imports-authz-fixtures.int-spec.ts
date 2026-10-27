import { randomUUID } from 'crypto';
import { AuthorizationService } from '../src/authz/authorization.service';
import type { Permission } from '../src/authz/catalog';
import { writeXlsx } from '../src/imports/xlsx';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// FIXTURES DE AUTORIZACIÓN (P0-026). Ningún rol real del catálogo combina `import:manage` con un alcance de productores
// «solo asignados» o sin `producer:read_identity`, así que estas defensas no se alcanzan con roles de producción. Aquí se
// sustituyen, SOLO EN MEMORIA y SOLO para dos usuarios de prueba, los permisos efectivos que calcula
// AuthorizationService.tenantContext. La membresía, la organización y el estado siguen siendo los reales; el catálogo
// ROLE_PERMISSIONS y la base de datos no se modifican.
const FIXTURE_ASIGNADOS: Permission[] = ['organization:read', 'import:manage', 'producer:read_assigned', 'producer:update_assigned', 'producer:read_identity'];
const FIXTURE_SIN_IDENTIDAD: Permission[] = ['organization:read', 'import:manage', 'producer:read', 'producer:create', 'producer:update'];

describeDb('P0-026 fixtures de autorización: alcance y datos de identidad en la importación de productores', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let org: string;
  const fixtures = new Map<string, Permission[]>();
  const http = () => h.http();
  const as = (email: string) => h.as(email);
  const base = `/api/v1/organizations/ORG/imports`;
  const url = (p = '') => base.replace('ORG', org) + p;
  const ADMIN = 'admin@test.local';
  const ASIG = 'fixture-asignados@test.local';
  const SINID = 'fixture-sin-identidad@test.local';
  const book = (head: string[], rows: string[][]) => writeXlsx([{ name: 'productores', rows: [head, ...rows] }]);
  const upload = (actor: string, buf: Buffer) => http().post(url()).set(as(actor)).field('operation_id', randomUUID()).attach('file', buf, 'p.xlsx');
  const membershipId = async (email: string) => (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', org).executeTakeFirstOrThrow()).id;

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    org = (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: 'Asociación F', organization_type: 'ASSOCIATION', country: 'EC', initial_admin_email: ADMIN }).expect(201)).body.id;
    for (const email of [ASIG, SINID]) {
      // Rol real de partida (técnico de campo); sus permisos efectivos se sustituyen por el fixture.
      const inv = await http().post(`/api/v1/organizations/${org}/invitations`).set(as(ADMIN)).send({ email, role_code: 'FIELD_TECHNICIAN' }).expect(201);
      await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'F', last_name: email, password: PASSWORD }).expect(200);
      await h.login(email);
    }
    const ids = await h.db.selectFrom('users').select(['id', 'email']).where('email', 'in', [ASIG, SINID]).execute();
    for (const u of ids) fixtures.set(u.id, u.email === ASIG ? FIXTURE_ASIGNADOS : FIXTURE_SIN_IDENTIDAD);
    const original = AuthorizationService.prototype.tenantContext;
    jest.spyOn(AuthorizationService.prototype, 'tenantContext').mockImplementation(async function (this: AuthorizationService, user, organizationId) {
      const ctx = await original.call(this, user, organizationId);
      const perms = fixtures.get(user.id);
      return ctx && perms ? { ...ctx, permissions: [...perms].sort() } : ctx;
    });
    // Productores del administrador: uno asignado a la membresía del fixture y otro fuera de su alcance.
    const create = (body: Record<string, unknown>) => http().post(`/api/v1/organizations/${org}/producers`).set(as(ADMIN)).send(body).expect(201);
    await create({ producer_code: 'PRD-ASIG', first_name: 'Rosa', last_name: 'Asignada', assigned_membership_id: await membershipId(ASIG) });
    await create({ producer_code: 'PRD-AJENO', first_name: 'Secreta', last_name: 'Fueradealcance', document_type: 'CEDULA', document_number: '0911111111' });
  });
  afterAll(async () => { jest.restoreAllMocks(); await h?.close(); });

  it('fixture: código fuera de alcance e inexistente producen la misma respuesta y no revelan el productor', async () => {
    const ajeno = await h.db.selectFrom('producers').select(['id', 'row_version']).where('producer_code', '=', 'PRD-AJENO').executeTakeFirstOrThrow();
    const up = await upload(ASIG, book(['codigo_productor', 'comunidad'], [['PRD-ASIG', 'San Pablo'], ['PRD-AJENO', 'San Pablo'], ['PRD-NO-EXISTE', 'San Pablo']])).expect(201);
    await http().post(url(`/${up.body.batch.id}/mapping`)).set(as(ASIG)).send({ columns: { A: 'producer_code', B: 'community' }, expected_version: up.body.batch.row_version }).expect(200);
    const pv = await http().get(url(`/${up.body.batch.id}/preview`)).set(as(ASIG)).expect(200);
    const [asig, fuera, inexistente] = pv.body.rows;
    expect(asig).toMatchObject({ action: 'UPDATE', changed_fields: ['community'] });
    expect(fuera.action).toBe('ERROR');
    expect(fuera.errors).toEqual([{ column: 'A', field: 'producer_code', code: 'CODE_NOT_AVAILABLE', message: 'Ese código no está disponible para tu importación.' }]);
    // Indistinguibles: mismas claves y mismos valores salvo el número de fila y el código que trae el propio archivo.
    const strip = (r: Record<string, unknown>) => { const { row_number: _n, code: _c, producer_code: _pc, fields, ...rest } = r as Record<string, unknown> & { fields: Record<string, { value?: string }> }; void _n; void _c; void _pc; return { ...rest, fields: { ...fields, producer_code: { ...fields.producer_code, value: '*' } } }; };
    expect(strip(fuera)).toEqual(strip(inexistente));
    const body = JSON.stringify(pv.body);
    expect(body).not.toContain(ajeno.id);
    expect(body).not.toContain('Secreta');
    expect(body).not.toContain('Fueradealcance');
    const rep = await http().get(url(`/${up.body.batch.id}/report`)).set(as(ASIG)).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); }).expect(200);
    const text = (rep.body as Buffer).toString('utf8');
    expect(text).not.toContain(ajeno.id);
    expect(text).not.toContain('Secreta');
    // El productor ajeno no cambió.
    expect((await h.db.selectFrom('producers').select('row_version').where('id', '=', ajeno.id).executeTakeFirstOrThrow()).row_version).toBe(ajeno.row_version);
  });

  it('fixture: sin producer:read_identity no se ven muestras de columnas no mapeadas ni se pueden mapear columnas de identidad', async () => {
    const head = ['codigo_productor', 'nombres', 'apellidos', 'numero_documento', 'telefono'];
    const up = await upload(SINID, book(head, [['PRD-N1', 'Ana', 'Ruiz', '0922222222', '0999999999']])).expect(201);
    expect(up.body.batch.can_map_identity).toBe(false);
    expect(up.body.batch.columns.every((c: { samples: unknown }) => c.samples === null)).toBe(true);
    expect(JSON.stringify(up.body)).not.toContain('0922222222');
    const denied = await http().post(url(`/${up.body.batch.id}/mapping`)).set(as(SINID)).send({ columns: { A: 'producer_code', B: 'first_name', C: 'last_name', D: 'document_number' }, expected_version: up.body.batch.row_version }).expect(403);
    expect(denied.body.error.code).toBe('MAPPING_IDENTITY_NOT_ALLOWED');
    const ok = await http().post(url(`/${up.body.batch.id}/mapping`)).set(as(SINID)).send({ columns: { A: 'producer_code', B: 'first_name', C: 'last_name' }, expected_version: up.body.batch.row_version }).expect(200);
    const samples = Object.fromEntries(ok.body.columns.map((c: { column: string; samples: string[] | null }) => [c.column, c.samples]));
    expect(samples).toEqual({ A: ['PRD-N1'], B: ['Ana'], C: ['Ruiz'], D: null, E: null });
  });

  it('fixture: la vista previa de un lote con identidad mapeada por otra persona enmascara esos valores', async () => {
    const up = await upload(ADMIN, book(['codigo_productor', 'razon_social', 'tipo_documento', 'numero_documento'], [['PRD-ID1', 'Finca Doc SA', 'RUC', '0933333333001']])).expect(201);
    await http().post(url(`/${up.body.batch.id}/mapping`)).set(as(ADMIN)).send({ columns: { A: 'producer_code', B: 'legal_name', C: 'document_type', D: 'document_number' }, expected_version: up.body.batch.row_version }).expect(200);
    const mine = await http().get(url(`/${up.body.batch.id}/preview`)).set(as(ADMIN)).expect(200);
    expect(mine.body.rows[0].fields.document_number.value).toBe('0933333333001');
    const other = await http().get(url(`/${up.body.batch.id}/preview`)).set(as(SINID)).expect(200);
    expect(other.body.rows[0].fields.document_number).toMatchObject({ state: 'PROVIDED', value: '••••' });
    expect(other.body.rows[0].fields.legal_name.value).toBe('Finca Doc SA');
    expect(JSON.stringify(other.body)).not.toContain('0933333333001');
    const view = await http().get(url(`/${up.body.batch.id}`)).set(as(SINID)).expect(200);
    expect(JSON.stringify(view.body)).not.toContain('0933333333001');
  });
});
