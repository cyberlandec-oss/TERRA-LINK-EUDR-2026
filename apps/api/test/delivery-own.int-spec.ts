import { randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// AJ-02 (UI-22, docs/07 «PRODUCER: recursos propios — perfil, parcelas, entregas, documentos»): `delivery:read_own` da al Productor VINCULADO el LISTADO de SUS entregas.
// Es solo el listado (estado, cantidades, recepción): el detalle (personal, compuertas, historial) y toda escritura siguen siendo de quien opera.
// PostgreSQL REAL, datos SINTÉTICOS, base desechable.
describeDb('AJ-02 entregas propias del productor (lectura acotada)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let p1: string; let p2: string; let pB: string;
  let d1: string; let d2: string;
  let product: string; let center: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);

  async function join(admin: string, o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const mid = async (email: string, o = orgA) => (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', o).executeTakeFirstOrThrow()).id;
  const link = async (producer: string, membership: string | null) => {
    const row = (await http().get(`${base(orgA)}/producers/${producer}`).set(as('admin-a@test.local')).expect(200)).body;
    await http().put(`${base(orgA)}/producers/${producer}/self-membership`).set(as('admin-a@test.local')).send({ expected_version: row.row_version, membership_id: membership, reason: 'Vínculo de prueba' }).expect(200);
  };
  const delivery = async (producer: string) => (await http().post(`${base(orgA)}/deliveries`).set(as('admin-a@test.local')).send({ operation_id: randomUUID(), producer_id: producer, product_id: product, location_id: center, delivery_date: today, quantity_declared: '500', unit: 'KG', register: false }).expect(201)).body.delivery.id as string;

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Entregas Propias A', 'admin-a@test.local');
    orgB = await mk('Coop Entregas Propias B', 'admin-b@test.local');
    await join('admin-a@test.local', orgA, 'productor@test.local', 'PRODUCER');   // se vincula a p1
    await join('admin-a@test.local', orgA, 'productor-sin@test.local', 'PRODUCER'); // sin vínculo
    await join('admin-a@test.local', orgA, 'auditor@test.local', 'AUDITOR');
    p1 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'OW-1', legal_name: 'Finca Propia Uno' }).expect(201)).body.id;
    p2 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'OW-2', legal_name: 'Finca de Otra Persona' }).expect(201)).body.id;
    pB = (await http().post(`${base(orgB)}/producers`).set(as('admin-b@test.local')).send({ producer_code: 'OWB-1', legal_name: 'Finca Org B' }).expect(201)).body.id;
    product = (await http().post(`${base(orgA)}/products`).set(as('admin-a@test.local')).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${base(orgA)}/locations`).set(as('admin-a@test.local')).send({ code: 'CA-01', name: 'Centro de acopio uno', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    await link(p1, await mid('productor@test.local'));
    d1 = await delivery(p1); d2 = await delivery(p2);
    void pB;
  });
  afterAll(async () => h?.close());

  it('el Productor vinculado lista SOLO sus entregas, sin nombres de personas ni datos de otro productor; el administrador (control) ve ambas', async () => {
    const mias = (await http().get(`${base(orgA)}/deliveries`).set(as('productor@test.local')).expect(200)).body as Array<{ id: string; producer: { code: string; name: string | null } }>;
    expect(mias.map((d) => d.id)).toEqual([d1]);
    expect(mias[0].producer.code).toBe('OW-1');
    expect(mias[0].producer.name).toBeNull();                       // sin identidad: no tiene `producer:read_identity`
    expect(JSON.stringify(mias)).not.toMatch(/OW-2|Finca de Otra Persona|Persona/);
    const todas = (await http().get(`${base(orgA)}/deliveries`).set(as('admin-a@test.local')).expect(200)).body as Array<{ id: string }>;
    expect(todas.map((d) => d.id).sort()).toEqual([d1, d2].sort());
  });

  it('el alcance propio es SOLO el listado: el detalle (y los datos del personal), la creación y las demás acciones se rechazan', async () => {
    expect((await http().get(`${base(orgA)}/deliveries/${d1}`).set(as('productor@test.local')).expect(403)).body.error.code).toBe('PERMISSION_DENIED');
    await http().get(`${base(orgA)}/deliveries/${d2}`).set(as('productor@test.local')).expect((r) => expect([403, 404]).toContain(r.status));
    // Cuerpos VÁLIDOS: con la pipe de validación activa, un cuerpo incompleto daría 400 antes de llegar a la autorización y no probaría nada.
    await http().post(`${base(orgA)}/deliveries`).set(as('productor@test.local')).send({ operation_id: randomUUID(), producer_id: p1, product_id: product, location_id: center, delivery_date: today, quantity_declared: '500', unit: 'KG', register: false }).expect(403);
    await http().post(`${base(orgA)}/deliveries/${d1}/receptions`).set(as('productor@test.local')).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'Báscula (sintética)', quantity: '100', unit: 'KG', weighed_on: today } }).expect(403);
    await http().post(`${base(orgA)}/deliveries/${d1}/supports`).set(as('productor@test.local')).send({ operation_id: randomUUID(), document_version_id: randomUUID(), support_kind: 'DELIVERY_NOTE' }).expect(403);
    const antes = await h.db.selectFrom('deliveries').select(({ fn }) => fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    expect(Number(antes.n)).toBe(2);                               // ninguna escritura del productor llegó a la base
  });

  it('una cuenta SIN vínculo recibe una lista vacía (no un error de permiso); al vincular ve la entrega y al desvincular deja de verla', async () => {
    expect((await http().get(`${base(orgA)}/deliveries`).set(as('productor-sin@test.local')).expect(200)).body).toEqual([]);
    await link(p2, await mid('productor-sin@test.local'));
    expect(((await http().get(`${base(orgA)}/deliveries`).set(as('productor-sin@test.local')).expect(200)).body as Array<{ id: string }>).map((d) => d.id)).toEqual([d2]);
    await link(p2, null);
    expect((await http().get(`${base(orgA)}/deliveries`).set(as('productor-sin@test.local')).expect(200)).body).toEqual([]);
    expect(((await http().get(`${base(orgA)}/deliveries`).set(as('productor@test.local')).expect(200)).body as Array<{ id: string }>).map((d) => d.id)).toEqual([d1]); // el vínculo de p1 no cambió
  });

  it('otra organización: ni el productor ve las entregas de otra organización ni el administrador de B las de A', async () => {
    await http().get(`${base(orgB)}/deliveries`).set(as('productor@test.local')).expect(404);
    await http().get(`${base(orgA)}/deliveries`).set(as('admin-b@test.local')).expect(404);
  });

  it('el auditor conserva su alcance (sin cambios): lista según su permiso vigente, y el permiso nuevo no se le concede', async () => {
    const perms = (await http().get('/api/v1/me/permissions').set(as('auditor@test.local')).expect(200)).body.organizations.find((o: { organization_id: string }) => o.organization_id === orgA).permissions as string[];
    expect(perms).not.toContain('delivery:read_own');
    const prod = (await http().get('/api/v1/me/permissions').set(as('productor@test.local')).expect(200)).body.organizations.find((o: { organization_id: string }) => o.organization_id === orgA).permissions as string[];
    expect(prod).toContain('delivery:read_own');
    expect(prod).not.toContain('delivery:read');
  });

  it('documentos: una entrega no es titular; el mensaje explica el camino real (aportar al productor y vincular desde la entrega)', async () => {
    const res = await http().post(`${base(orgA)}/documents`).set(as('admin-a@test.local')).field('operation_id', randomUUID()).field('document_type', 'DELIVERY_SUPPORT')
      .field('owner_type', 'delivery').field('owner_id', d1).field('title', 'x').attach('file', Buffer.from('%PDF-1.4\n%%EOF\n'), { filename: 'x.pdf', contentType: 'application/pdf' }).expect(422);
    expect(res.body.error.code).toBe('ENTITY_TYPE_NOT_AVAILABLE');
    expect(res.body.error.message).toMatch(/se vinculan desde la entrega/);
    expect(res.body.error.message).not.toMatch(/P0-012|aún no existen/);
  });
});
