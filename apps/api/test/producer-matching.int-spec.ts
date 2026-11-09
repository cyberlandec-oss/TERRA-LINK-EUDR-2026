import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Integración P0-005 (RF-05 / QA-03): código único por organización bajo concurrencia y revisión asistida
// de coincidencias de identidad, sin fusiones ni cambios automáticos.
describeDb('P0-005 código y deduplicación (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const http = () => h.http();
  const as = (email: string) => h.as(email);
  const base = (org: string) => `/api/v1/organizations/${org}/producers`;
  const reviews = (org: string) => `/api/v1/organizations/${org}/producer-match-reviews`;
  const create = (actor: string, org: string, body: Record<string, unknown>) => http().post(base(org)).set(as(actor)).send(body);

  async function join(admin: string, org: string, email: string, role: string) {
    const inv = await http().post(`/api/v1/organizations/${org}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const snapshotOf = (id: string) =>
    h.db.selectFrom('producers').select(['row_version', 'status', 'producer_code', 'document_number_enc', 'deleted_at']).where('id', '=', id).executeTakeFirstOrThrow();

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
    await join('admin-a@test.local', orgA, 'tecnico@test.local', 'FIELD_TECHNICIAN');
    await join('admin-a@test.local', orgA, 'supervisor@test.local', 'MANAGER');
    await join('admin-a@test.local', orgA, 'auditor@test.local', 'AUDITOR');
  });
  afterAll(async () => h?.close());

  it('unicidad del código bajo concurrencia: un alta gana, el resto recibe 409 controlado', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      create('admin-a@test.local', orgA, { producer_code: 'RACE-1', legal_name: `Intento ${i}` })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('PRODUCER_CODE_TAKEN');
    const n = await h.db.selectFrom('producers').select(sql<number>`count(*)::int`.as('n')).where('organization_id', '=', orgA).where('producer_code', '=', 'RACE-1').executeTakeFirstOrThrow();
    expect(n.n).toBe(1);
  });

  it('normalización del código según el contrato vigente: espacios exteriores se recortan; otra organización puede repetirlo', async () => {
    await create('admin-a@test.local', orgA, { producer_code: 'PRD-9', legal_name: 'Uno' }).expect(201);
    // El formato no admite espacios: el valor con espacios se recorta antes de validar unicidad.
    const padded = await create('admin-a@test.local', orgA, { producer_code: 'PRD-9', legal_name: 'Dos' }).expect(409);
    expect(padded.body.error.code).toBe('PRODUCER_CODE_TAKEN');
    await create('admin-b@test.local', orgB, { producer_code: 'PRD-9', legal_name: 'En B' }).expect(201);
    // Mayúsculas/minúsculas: el contrato no las unifica (D-21 pendiente); hoy son códigos distintos.
    await create('admin-a@test.local', orgA, { producer_code: 'prd-9', legal_name: 'Minúsculas' }).expect(201);
  });

  let anaId: string;
  let dupId: string;
  let reviewId: string;

  it('coincidencia de identidad: mismo tipo y número normalizados abre revisión sin modificar productores', async () => {
    anaId = (await create('admin-a@test.local', orgA, { producer_code: 'ID-1', first_name: 'Ana', last_name: 'Vélez', document_type: 'CEDULA', document_number: '1301112223' }).expect(201)).body.id;
    const before = await snapshotOf(anaId);
    const res = await create('tecnico@test.local', orgA, { producer_code: 'ID-2', first_name: 'Ana María', last_name: 'Vélez', document_type: ' cedula ', document_number: '130-111.2223' }).expect(201);
    dupId = res.body.id;
    expect(res.body.duplicate_reviews_pending).toBe(1);
    // El técnico no recibe datos del otro productor (no está en su alcance): solo el aviso.
    expect(JSON.stringify(res.body)).not.toContain('ID-1');
    expect(await snapshotOf(anaId)).toEqual(before);
    expect((await snapshotOf(dupId)).row_version).toBe('1');
    const list = await http().get(reviews(orgA)).set(as('admin-a@test.local')).expect(200);
    expect(list.body).toHaveLength(1);
    reviewId = list.body[0].id;
    expect(list.body[0]).toMatchObject({ rule_code: 'IDENTITY_DOCUMENT', status: 'PENDING', identity_visible: true });
    const codes = [list.body[0].producer_a.producer_code, list.body[0].producer_b.producer_code].sort();
    expect(codes).toEqual(['ID-1', 'ID-2']);
    expect(list.body[0].producer_a.document_number).toBeDefined();
  });

  it('falsos positivos: mismo número con otro tipo, mismo nombre con otro documento y otra organización no abren revisión', async () => {
    await create('admin-a@test.local', orgA, { producer_code: 'FP-1', legal_name: 'Empresa', document_type: 'RUC', document_number: '1301112223' }).expect(201);
    await create('admin-a@test.local', orgA, { producer_code: 'FP-2', first_name: 'Ana', last_name: 'Vélez', document_type: 'CEDULA', document_number: '0912345678' }).expect(201);
    const inB = await create('admin-b@test.local', orgB, { producer_code: 'FP-3', first_name: 'Ana', last_name: 'Vélez', document_type: 'CEDULA', document_number: '1301112223' }).expect(201);
    expect(inB.body.duplicate_reviews_pending).toBe(0);
    const listA = await http().get(reviews(orgA)).set(as('admin-a@test.local')).expect(200);
    expect(listA.body).toHaveLength(1);
    const listB = await http().get(reviews(orgB)).set(as('admin-b@test.local')).expect(200);
    expect(listB.body).toEqual([]);
  });

  it('la edición que introduce un documento coincidente también abre revisión; repetir no duplica casos', async () => {
    const c = (await create('admin-a@test.local', orgA, { producer_code: 'ID-3', legal_name: 'Sin documento' }).expect(201)).body;
    const upd = await http().patch(`${base(orgA)}/${c.id}`).set(as('admin-a@test.local'))
      .send({ expected_version: 1, document_type: 'CEDULA', document_number: '1301112223' }).expect(200);
    expect(upd.body.duplicate_reviews_pending).toBe(2); // con ID-1 y con ID-2
    await http().patch(`${base(orgA)}/${c.id}`).set(as('admin-a@test.local')).send({ expected_version: 2, document_number: '1309999999' }).expect(200);
    await http().patch(`${base(orgA)}/${c.id}`).set(as('admin-a@test.local')).send({ expected_version: 3, document_number: '1301112223' }).expect(200);
    const pending = await http().get(reviews(orgA)).set(as('admin-a@test.local')).expect(200);
    expect(pending.body).toHaveLength(3);
  });

  it('permisos y aislamiento de la revisión', async () => {
    await http().get(reviews(orgA)).set(as('supervisor@test.local')).expect(200); // MANAGER: steward
    await http().get(reviews(orgA)).set(as('tecnico@test.local')).expect(403);
    await http().get(reviews(orgA)).set(as('auditor@test.local')).expect(403);
    await http().get(reviews(orgA)).set(as('admin-b@test.local')).expect(404);
    await http().post(`${reviews(orgA)}/${reviewId}/resolve`).set(as('admin-b@test.local'))
      .send({ decision: 'NOT_DUPLICATE', note: 'intento cruzado', expected_version: 1 }).expect(404);
    await http().post(`${reviews(orgB)}/${reviewId}/resolve`).set(as('admin-b@test.local'))
      .send({ decision: 'NOT_DUPLICATE', note: 'id de otra org', expected_version: 1 }).expect(404);
    await http().post(`${reviews(orgA)}/${reviewId}/resolve`).set(as('tecnico@test.local'))
      .send({ decision: 'NOT_DUPLICATE', note: 'sin permiso', expected_version: 1 }).expect(403);
  });

  it('resolver no fusiona ni modifica productores; queda auditado y un caso cerrado no se reabre', async () => {
    const a0 = await snapshotOf(anaId);
    const d0 = await snapshotOf(dupId);
    await http().post(`${reviews(orgA)}/${reviewId}/resolve`).set(as('supervisor@test.local'))
      .send({ decision: 'DUPLICATE_CONFIRMED', note: 'Misma persona, registro en campo', expected_version: 9 }).expect(409);
    const r = await http().post(`${reviews(orgA)}/${reviewId}/resolve`).set(as('supervisor@test.local'))
      .send({ decision: 'DUPLICATE_CONFIRMED', note: 'Misma persona, registro en campo', expected_version: 1 }).expect(200);
    expect(r.body.status).toBe('DUPLICATE_CONFIRMED');
    expect(await snapshotOf(anaId)).toEqual(a0);
    expect(await snapshotOf(dupId)).toEqual(d0);
    await http().post(`${reviews(orgA)}/${reviewId}/resolve`).set(as('supervisor@test.local'))
      .send({ decision: 'NOT_DUPLICATE', note: 'cambio de opinión', expected_version: 2 }).expect(409);
    // Guardar el documento con otro formato vuelve a ejecutar la detección, pero no reabre el par resuelto.
    await http().patch(`${base(orgA)}/${dupId}`).set(as('admin-a@test.local')).send({ expected_version: 1, document_number: '1301112223' }).expect(200);
    const pair = await h.db.selectFrom('producer_match_reviews').select(['id', 'status'])
      .where((eb) => eb.and([eb('producer_a_id', 'in', [anaId, dupId]), eb('producer_b_id', 'in', [anaId, dupId])])).execute();
    expect(pair).toEqual([{ id: reviewId, status: 'DUPLICATE_CONFIRMED' }]);
    const audit = await h.db.selectFrom('audit_logs').select(['action', 'reason']).where('entity_id', '=', reviewId).orderBy('occurred_at').execute();
    expect(audit.map((a) => a.action)).toEqual(['producer_match.detect', 'producer_match.resolve']);
    const all = await http().get(`${reviews(orgA)}?status=ALL`).set(as('admin-a@test.local')).expect(200);
    expect(all.body.find((x: { id: string }) => x.id === reviewId).status).toBe('DUPLICATE_CONFIRMED');
  });
});
