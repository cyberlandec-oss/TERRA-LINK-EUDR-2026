import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { describeDb, setupHarness } from './helpers';

// P1-005 — ACTO DE REVISIÓN del perfil jurídico (mecanismo). Todo perfil «completo y revisado» de esta suite es SINTÉTICO y vive en la base
// aislada de prueba. Se demuestra el recorrido completo por la API real: revisión favorable → objeción posterior → pérdida de elegibilidad y de
// vigencia del acto de vinculación → restablecimiento; sin reescribir el pasado. Registrar el acto no es una conclusión jurídica del sistema.
describeDb('P1-005: acto de revisión del perfil jurídico', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let org = '';
  const SUPER = 'rev-super@test.local';
  const ADMIN = 'rev-admin@test.local';
  const R = '/api/v1/platform/legal-profile/reviews';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const hoy = () => new Date().toISOString().slice(0, 10);

  const perfilSintetico = async (version: string) => {
    await sql`INSERT INTO legal_profile_versions (version, jurisdiction, scope, scope_note, covered_matters, pending_matters, technical_status, published_by, reason)
      VALUES (${version}, 'EC', 'COMPLETE', 'Fixture sintética de prueba, sin valor jurídico', ARRAY['TENURE'], ARRAY[]::text[], 'PUBLISHED', 'fixture', 'fixture sintética')`.execute(h.db);
    await sql`INSERT INTO legal_profile_sources (version, code, title, authority, publication, publication_date, url, file_sha256, document_obtained, text_contrasted, legal_validity_reviewed, modifications_found, gaps)
      VALUES (${version}, 'SINT-1', 'Fuente sintética', 'Autoridad sintética', 'Publicación sintética', '2020-01-01', 'https://example.test/sintetica', ${'a'.repeat(64)}, true, true, false, 'ninguna', 'ninguna')`.execute(h.db);
  };
  const lista = async () => (await http().get(R).set(as(SUPER)).expect(200)).body.versions as Array<{
    version: string; status: string; current_review: { id: string; decision: string } | null;
    history: Array<{ id: string; decision: string; is_current: boolean; supports: unknown[] }>; link_eligibility: { eligible: boolean; reasons: string[] };
  }>;
  const de = async (v: string) => (await lista()).find((x) => x.version === v)!;
  const registrar = (over: Record<string, unknown> = {}, actor = SUPER) => http().post(R).set(as(actor)).send({
    operation_id: randomUUID(), version: '7.5.0', decision: 'REVIEWED', reviewer_name: 'Persona sintética de prueba', reviewer_capacity: 'Responsable sintético (fixture)',
    reviewed_on: hoy(), basis: 'Fundamento sintético de prueba: no acredita ninguna revisión jurídica real', supports: [{ kind: 'PROFILE_SOURCE', source_code: 'SINT-1' }, { kind: 'CITATION', citation: 'Cita sintética de prueba' }], ...over });

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    org = (await http().post('/api/v1/organizations').set(as(SUPER)).send({ name: 'Coop Revision', organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: ADMIN }).expect(201)).body.id as string;
    await perfilSintetico('7.5.0');
  }, 120_000);
  afterAll(async () => { await h?.close(); });

  it('solo la plataforma ve y registra el acto; la administración de la organización no (control autorizado incluido)', async () => {
    await http().get(R).set(as(ADMIN)).expect(403);
    await registrar({}, ADMIN).expect(403);
    expect((await http().get(R).set(as(SUPER)).expect(200)).body.versions.length).toBeGreaterThanOrEqual(3);
  });

  it('estado operativo conservado: los perfiles reales no tienen ninguna revisión y no son elegibles', async () => {
    for (const v of ['0.1.0', '0.2.0']) {
      const p = await de(v);
      expect(p.status).toBe('NONE');
      expect(p.current_review).toBeNull();
      expect(p.link_eligibility.eligible).toBe(false);
    }
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM legal_profile_reviews WHERE version IN ('0.1.0','0.2.0')`.execute(h.db)).rows[0].n).toBe('0');
  });

  it('una petición incompleta o inválida NO escribe nada (no hay borradores en el servidor)', async () => {
    const antes = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM legal_profile_reviews`.execute(h.db)).rows[0].n;
    await http().post(R).set(as(SUPER)).send({ operation_id: randomUUID(), version: '7.5.0', decision: 'REVIEWED' }).expect(400);
    await registrar({ decision: 'APPROVED' }).expect(400); // un estado que no existe
    await registrar({ reviewer_name: 'x' }).expect(400);
    await registrar({ basis: 'corto' }).expect(400);
    await registrar({ supports: [] }).expect(422); // REVIEWED sin soporte
    expect((await registrar({ version: '9.9.9' }).expect(422)).body.error.code).toBe('LEGAL_PROFILE_UNKNOWN');
    const futura = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    expect((await registrar({ reviewed_on: futura }).expect(422)).body.error.code).toBe('REVIEW_DATE_INVALID');
    expect((await registrar({ supports: [{ kind: 'PROFILE_SOURCE', source_code: 'LOTRTA-711' }] }).expect(422)).body.error.code).toBe('REVIEW_SUPPORT_INVALID'); // fuente de OTRA versión
    expect((await registrar({ supports: [{ kind: 'CITATION', citation: 'cita', source_code: 'SINT-1' }] }).expect(422)).body.error.code).toBe('REVIEW_SUPPORT_INVALID');
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM legal_profile_reviews`.execute(h.db)).rows[0].n).toBe(antes);
  });

  it('la base repite las reglas: una revisión REVIEWED sin soporte no queda escrita', async () => {
    const reviewer = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${SUPER}`.execute(h.db)).rows[0].id;
    await expect(sql`INSERT INTO legal_profile_reviews (id, version, decision, reviewer_id, reviewer_name, reviewer_capacity, reviewed_on, basis, operation_id)
      VALUES (${randomUUID()}, '7.5.0', 'REVIEWED', ${reviewer}, 'Persona', 'Capacidad', CURRENT_DATE, 'Fundamento suficiente de prueba', ${randomUUID()})`.execute(h.db)).rejects.toThrow(/exige al menos un soporte/);
  });

  let rev1 = '';
  it('REVISIÓN FAVORABLE: se registra con persona, capacidad, fecha, fundamento y soportes; queda vigente y el perfil pasa a ser elegible', async () => {
    const r = await registrar({ expected_current_review_id: null }).expect(201);
    rev1 = r.body.review.id;
    const p = await de('7.5.0');
    expect(p.status).toBe('REVIEWED');
    expect(p.current_review).toMatchObject({ id: rev1, decision: 'REVIEWED' });
    expect(p.history).toHaveLength(1);
    expect(p.history[0]).toMatchObject({ is_current: true });
    expect(p.history[0].supports).toHaveLength(2);
    expect(p.link_eligibility).toEqual({ eligible: true, reasons: [] });
    const fila = (await sql<{ reviewer_name: string; reviewer_capacity: string; reviewed_on: Date; reviewer_id: string }>`SELECT reviewer_name, reviewer_capacity, reviewed_on, reviewer_id::text FROM legal_profile_reviews WHERE id = ${rev1}`.execute(h.db)).rows[0];
    expect(fila).toMatchObject({ reviewer_name: 'Persona sintética de prueba', reviewer_capacity: 'Responsable sintético (fixture)' });
    // `reviewer_id` es quien REGISTRÓ (plataforma), no la persona revisora declarada.
    expect(fila.reviewer_id).toBe((await sql<{ id: string }>`SELECT id::text FROM users WHERE email = ${SUPER}`.execute(h.db)).rows[0].id);
    expect(Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM audit_logs WHERE action = 'legal_profile.review_reviewed' AND entity_id = ${rev1}`.execute(h.db)).rows[0].n)).toBe(1);
    await expect(sql`UPDATE legal_profile_reviews SET basis = 'reescrito intencionalmente' WHERE id = ${rev1}`.execute(h.db)).rejects.toThrow(/append-only/); // la revisión no se reescribe
    await expect(sql`DELETE FROM legal_profile_review_supports WHERE review_id = ${rev1}`.execute(h.db)).rejects.toThrow(/append-only/); // el soporte tampoco se borra
    // registrar NO publica ni adopta: ningún perfil real cambió y no hay adopciones nuevas del sintético
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM legal_profile_adoptions WHERE version = '7.5.0'`.execute(h.db)).rows[0].n).toBe('0');
  });

  it('idempotente por operation_id; reutilizarlo con otro contenido se rechaza; no se pisa a ciegas la revisión vigente', async () => {
    const op = randomUUID();
    const a = await registrar({ operation_id: op, expected_current_review_id: rev1 }).expect(201);
    const b = await registrar({ operation_id: op, expected_current_review_id: rev1 }).expect(201);
    expect(b.body.replayed).toBe(true);
    expect(b.body.review.id).toBe(a.body.review.id);
    await registrar({ operation_id: op, decision: 'OBJECTED' }).expect(409);
    // se registró otra revisión favorable (a): quien aún veía rev1 como vigente es rechazado
    const r = await registrar({ expected_current_review_id: rev1 }).expect(409);
    expect(r.body.error.code).toBe('REVIEW_SUPERSEDED');
  });

  it('EFECTO ORGANIZACIÓN Y CATÁLOGO: la organización que adoptó el perfil ve la revisión; una objeción posterior la invalida sin reescribir nada', async () => {
    await http().post(`/api/v1/organizations/${org}/legal-profile/adoptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), version: '7.5.0', decision: 'ADOPT', reason: 'Adopción sintética de ensayo' }).expect(201);
    const catalogo = async () => (await http().get(`/api/v1/organizations/${org}/legal-profile/catalog`).set(as(ADMIN)).expect(200)).body.adopted;
    expect(await catalogo()).toMatchObject({ version: '7.5.0', legal_review_status: 'REVIEWED' });

    // acto de vinculación (ya existente) sobre la revisión vigente
    const vigente = (await de('7.5.0')).current_review!.id;
    await http().post('/api/v1/platform/risk-catalog/profile-links').set(as(SUPER)).send({
      operation_id: randomUUID(), base_rule_set_version: '1.0.0', new_rule_set_version: '1.1.0', profile_version: '7.5.0', review_id: vigente, reason: 'Vinculación sintética de ensayo' }).expect(201);
    const enlace = async () => (await http().get('/api/v1/platform/risk-catalog/profile-links').set(as(SUPER)).expect(200)).body.links.find((l: { rule_set_version: string }) => l.rule_set_version === '1.1.0');
    expect((await enlace()).current_status).toBe('CURRENT');

    const antes = await sql<{ id: string; basis: string; decided_at: Date }>`SELECT id::text, basis, decided_at FROM legal_profile_reviews WHERE id = ${vigente}`.execute(h.db);
    const obj = await registrar({ decision: 'OBJECTED', basis: 'Objeción sintética: el soporte no respalda la regla', supports: [], expected_current_review_id: vigente }).expect(201);

    const p = await de('7.5.0');
    expect(p.status).toBe('OBJECTED');
    expect(p.current_review!.id).toBe(obj.body.review.id);
    expect(p.history.map((x) => x.decision)).toEqual(['OBJECTED', 'REVIEWED', 'REVIEWED']);
    expect(p.history.filter((x) => x.is_current)).toHaveLength(1);
    expect(p.link_eligibility).toEqual({ eligible: false, reasons: ['REVIEW_OBJECTED'] });
    expect(await catalogo()).toMatchObject({ legal_review_status: 'PENDING' }); // la organización deja de ver una revisión vigente
    const e = await enlace();
    expect(e.current_status).toBe('NO_LONGER_VALID'); // la referencia histórica permanece, ya no es vigente
    expect(e.review_id).toBe(vigente);
    // el pasado no se reescribió
    const despues = await sql<{ id: string; basis: string; decided_at: Date }>`SELECT id::text, basis, decided_at FROM legal_profile_reviews WHERE id = ${vigente}`.execute(h.db);
    expect(despues.rows).toEqual(antes.rows);
    // y ya no se puede vincular un catálogo nuevo con ese perfil
    expect((await http().post('/api/v1/platform/risk-catalog/profile-links').set(as(SUPER)).send({
      operation_id: randomUUID(), base_rule_set_version: '1.0.0', new_rule_set_version: '1.2.0', profile_version: '7.5.0', review_id: obj.body.review.id, reason: 'Intento tras la objeción' }).expect(422)).body.error.code).toBe('PROFILE_NOT_ELIGIBLE');
  });

  it('RETIRADA: solo se retira una revisión vigente REVIEWED; tras retirarla se pierde la elegibilidad; una revisión posterior la restablece', async () => {
    // la vigente es OBJECTED: no hay nada que retirar
    expect((await registrar({ decision: 'WITHDRAWN', basis: 'Intento de retirar sin revisión vigente', supports: [] }).expect(422)).body.error.code).toBe('NOTHING_TO_WITHDRAW');
    // se restablece con una revisión favorable posterior y se retira después
    await registrar({ basis: 'Nueva revisión favorable sintética tras subsanar la objeción' }).expect(201);
    expect((await de('7.5.0')).link_eligibility.eligible).toBe(true);
    await registrar({ decision: 'WITHDRAWN', basis: 'Retirada sintética de la revisión favorable', supports: [] }).expect(201);
    const p = await de('7.5.0');
    expect(p.status).toBe('WITHDRAWN');
    expect(p.link_eligibility).toEqual({ eligible: false, reasons: ['REVIEW_WITHDRAWN'] });
    expect(p.history.map((x) => x.decision)).toEqual(['WITHDRAWN', 'REVIEWED', 'OBJECTED', 'REVIEWED', 'REVIEWED']);
  });

  it('el acto no concede ni ejerce nada más: ningún perfil real cambió y la conclusión sigue UNDETERMINED', async () => {
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM legal_profile_reviews WHERE version IN ('0.1.0','0.2.0')`.execute(h.db)).rows[0].n).toBe('0');
    expect((await sql<{ s: string }>`SELECT technical_status AS s FROM legal_profile_versions WHERE version = '0.2.0'`.execute(h.db)).rows[0].s).toBe('DRAFT');
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_evaluations WHERE conclusion <> 'UNDETERMINED'`.execute(h.db)).rows[0].n).toBe('0');
  });
});
