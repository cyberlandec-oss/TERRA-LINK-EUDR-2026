import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// D-07.5(b), opción b-1 — ACTO DE VINCULACIÓN del catálogo de riesgo con un perfil jurídico revisado.
//
// Contrato (adoptado por el propietario): referencia explícita a una versión del perfil revisado, fijada por un acto
// autorizado que forma parte de una VERSIÓN NUEVA del catálogo. Esta suite demuestra, sobre base real de prueba:
//   · el caso positivo con un perfil SINTÉTICO (completo y revisado) escrito directamente en la base de prueba: ningún
//     endpoint produce una revisión jurídica, y ningún perfil real se aprueba;
//   · el rechazo en el entorno real de datos (0.1.0 parcial/sin revisión, 0.2.0 borrador, etiqueta, inexistente);
//   · que 1.0.0 y sus adopciones no cambian, que publicar no adopta, y que la vigencia de la referencia sigue a la
//     revisión: una objeción posterior deja la instantánea histórica intacta pero desactualizada.
describeDb('D-07.5(b) b-1: acto de vinculación del catálogo con un perfil revisado', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let org = '';
  let lotId = '';
  const SUPER = 'link-super@test.local';
  const ADMIN = 'link-admin@test.local';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o: string) => `/api/v1/organizations/${o}`;
  const P = '/api/v1/platform/risk-catalog/profile-links';
  let revisor = '';

  const perfilSintetico = async (version: string, over: { scope?: 'PARTIAL' | 'COMPLETE'; status?: 'DRAFT' | 'PUBLISHED' } = {}) => {
    const scope = over.scope ?? 'COMPLETE';
    await sql`INSERT INTO legal_profile_versions (version, jurisdiction, scope, scope_note, covered_matters, pending_matters, technical_status, published_by, reason)
      VALUES (${version}, 'EC', ${scope}, 'Fixture sintética de prueba, sin valor jurídico', ARRAY['TENURE'],
        ${scope === 'COMPLETE' ? sql`ARRAY[]::text[]` : sql`ARRAY['LABOUR']`}, ${over.status ?? 'PUBLISHED'}, 'fixture', 'fixture sintética')`.execute(h.db);
  };
  const revision = async (version: string, decision: 'REVIEWED' | 'OBJECTED' | 'WITHDRAWN') => {
    // Por el camino REAL de la API (acto de plataforma), con datos sintéticos: no se escribe en la base a mano.
    const actual = (await sql<{ id: string }>`SELECT id::text FROM legal_profile_reviews WHERE version = ${version} ORDER BY decided_at DESC, id DESC LIMIT 1`.execute(h.db)).rows[0]?.id ?? null;
    const r = await http().post('/api/v1/platform/legal-profile/reviews').set(as(SUPER)).send({
      operation_id: randomUUID(), version, decision, reviewer_name: 'Persona sintética de prueba', reviewer_capacity: 'FIXTURE SINTÉTICA DE PRUEBA', reviewed_on: new Date().toISOString().slice(0, 10),
      basis: 'Fixture sintética: no acredita ninguna revisión jurídica real', supports: [{ kind: 'CITATION', citation: 'Cita sintética de prueba' }], expected_current_review_id: actual }).expect(201);
    return r.body.review.id as string;
  };
  const vincular = (over: Record<string, unknown> = {}, actor = SUPER) => http().post(P).set(as(actor)).send({
    operation_id: randomUUID(), base_rule_set_version: '1.0.0', new_rule_set_version: '1.1.0', profile_version: '9.9.9',
    review_id: randomUUID(), reason: 'Vinculación de ensayo con perfil sintético', ...over });

  async function lote(o: string, admin: string, code: string) {
    const prod = (await http().post(`${api(o)}/producers`).set(as(admin)).send({ producer_code: `${code}-P`, legal_name: `Finca ${code}` }).expect(201)).body.id;
    await http().post(`${api(o)}/products`).set(as(admin)).send({ code: `PR-${code}`, name: 'Cacao', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201);
    const prodId = (await http().get(`${api(o)}/products?limit=50`).set(as(admin))).body.items.find((x: { code: string }) => x.code === `PR-${code}`).id;
    await http().post(`${api(o)}/locations`).set(as(admin)).send({ code: `L-${code}`, name: 'Centro', location_type: 'COLLECTION_CENTER' }).expect(201);
    const locId = (await http().get(`${api(o)}/locations`).set(as(admin))).body.find((l: { code: string }) => l.code === `L-${code}`).id;
    const hoy = new Date().toISOString().slice(0, 10);
    const d = (await http().post(`${api(o)}/deliveries`).set(as(admin)).send({ operation_id: randomUUID(), producer_id: prod, product_id: prodId, delivery_date: hoy, quantity_declared: '100', unit: 'KG', register: true }).expect(201)).body.delivery;
    const rec = (await http().post(`${api(o)}/deliveries/${d.id}/receptions`).set(as(admin)).send({ operation_id: randomUUID(), location_id: locId, received_at: new Date().toISOString(), weighing: { method: 'Báscula', quantity: '100', unit: 'KG', weighed_on: hoy } }).expect(201)).body.reception_id;
    return (await http().post(`${api(o)}/lots`).set(as(admin)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '100' }] }).expect(201)).body.lot.id;
  }

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    org = (await http().post('/api/v1/organizations').set(as(SUPER)).send({ name: 'Coop Vinculo', organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: ADMIN }).expect(201)).body.id;
    revisor = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${ADMIN}`.execute(h.db)).rows[0].id;
    lotId = await lote(org, ADMIN, 'VL');
  }, 180_000);
  afterAll(async () => { await h?.close(); });

  it('solo la plataforma puede ver y confirmar el acto; la administración de la organización no (control autorizado incluido)', async () => {
    await http().get(`${P}/eligibility`).set(as(ADMIN)).expect(403);
    await http().get(P).set(as(ADMIN)).expect(403);
    await vincular({}, ADMIN).expect(403);
    const ok = await http().get(`${P}/eligibility`).set(as(SUPER)).expect(200);
    expect(ok.body.profiles.length).toBeGreaterThanOrEqual(2); // control: el mismo recurso sí responde a quien tiene el permiso
  });

  it('sin perfil elegible: ninguno de los reales lo es y se explica qué falta', async () => {
    const e = (await http().get(`${P}/eligibility`).set(as(SUPER)).expect(200)).body;
    const v1 = e.profiles.find((p: { version: string }) => p.version === '0.1.0');
    const v2 = e.profiles.find((p: { version: string }) => p.version === '0.2.0');
    expect(e.profiles.some((p: { eligible: boolean }) => p.eligible)).toBe(false);
    expect(v1.reasons.map((r: { code: string }) => r.code)).toEqual(expect.arrayContaining(['SCOPE_PARTIAL', 'NO_REVIEW']));
    expect(v2.reasons.map((r: { code: string }) => r.code)).toEqual(expect.arrayContaining(['DRAFT', 'SCOPE_PARTIAL', 'NO_REVIEW']));
    expect(v1.reasons.every((r: { text: string }) => r.text.length > 10)).toBe(true);
  });

  it('en el entorno real de datos se rechaza: perfil parcial, borrador, inexistente y etiqueta; no se escribe nada', async () => {
    const antes = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_rule_sets`.execute(h.db)).rows[0].n;
    const a = await vincular({ profile_version: '0.1.0' }).expect(422);
    expect(a.body.error.code).toBe('PROFILE_NOT_ELIGIBLE');
    expect((await vincular({ profile_version: '0.2.0' }).expect(422)).body.error.code).toBe('PROFILE_NOT_ELIGIBLE');
    expect((await vincular({ profile_version: '8.8.8' }).expect(422)).body.error.code).toBe('PROFILE_UNKNOWN');
    await vincular({ profile_version: 'aprobado' }).expect(400); // una etiqueta ni siquiera es una referencia
    await vincular({ new_rule_set_version: '1.0.0' }).expect(409); // no se edita una versión publicada
    await vincular({ base_rule_set_version: '5.5.5' }).expect(422);
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_rule_sets`.execute(h.db)).rows[0].n).toBe(antes);
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_rule_set_profile_links`.execute(h.db)).rows[0].n).toBe('0');
  });

  it('un perfil completo y publicado SIN revisión, o con revisión objetada, tampoco; un borrador revisado tampoco', async () => {
    await perfilSintetico('9.9.9');
    expect((await vincular().expect(422)).body.error.details.map((d: { reason: string }) => d.reason)).toContain('NO_REVIEW');
    const obj = await revision('9.9.9', 'OBJECTED');
    expect((await vincular({ review_id: obj }).expect(422)).body.error.details.map((d: { reason: string }) => d.reason)).toContain('REVIEW_OBJECTED');
    await perfilSintetico('9.9.8', { status: 'DRAFT' });
    const rb = await revision('9.9.8', 'REVIEWED');
    expect((await vincular({ profile_version: '9.9.8', review_id: rb }).expect(422)).body.error.details.map((d: { reason: string }) => d.reason)).toContain('DRAFT');
  });

  let linkRev = '';
  let adopcionesAntes = '';
  it('CASO POSITIVO SINTÉTICO: con revisión vigente se crea la versión 1.1.0, copia exacta, NOT_APPROVED y SIN adopción automática', async () => {
    linkRev = await revision('9.9.9', 'REVIEWED');
    adopcionesAntes = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_rule_set_adoptions`.execute(h.db)).rows[0].n;
    const reglas100 = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_rules WHERE rule_set_version = '1.0.0'`.execute(h.db)).rows[0].n;
    const r = await vincular({ review_id: linkRev }).expect(201);
    expect(r.body.replayed).toBe(false);
    const fila = (await sql<{ approval_status: string; approved_by: string | null; regulatory_profile: string; n: string }>`
      SELECT rs.approval_status, rs.approved_by, rs.regulatory_profile, (SELECT count(*)::text FROM risk_rules WHERE rule_set_version = '1.1.0') AS n FROM risk_rule_sets rs WHERE rs.version = '1.1.0'`.execute(h.db)).rows[0];
    expect(fila).toMatchObject({ approval_status: 'NOT_APPROVED', approved_by: null, regulatory_profile: '9.9.9', n: reglas100 });
    const acto = (await sql<{ review_id: string; decided_by: string; reason: string; profile_version: string }>`SELECT review_id::text, decided_by::text, reason, profile_version FROM risk_rule_set_profile_links WHERE rule_set_version = '1.1.0'`.execute(h.db)).rows[0];
    const superId = (await sql<{ id: string }>`SELECT id::text FROM users WHERE email = ${SUPER}`.execute(h.db)).rows[0].id;
    expect(acto).toMatchObject({ review_id: linkRev, decided_by: superId, reason: 'Vinculación de ensayo con perfil sintético', profile_version: '9.9.9' });
    // 1.0.0 intacto y nada adoptado
    expect((await sql<{ regulatory_profile: string | null }>`SELECT regulatory_profile FROM risk_rule_sets WHERE version = '1.0.0'`.execute(h.db)).rows[0].regulatory_profile).toBeNull();
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_rule_set_adoptions`.execute(h.db)).rows[0].n).toBe(adopcionesAntes);
    const aud = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM audit_logs WHERE action = 'risk_catalog.link_profile' AND actor_user_id = ${superId}`.execute(h.db)).rows[0].n;
    expect(Number(aud)).toBe(1);
  });

  it('idempotente por operation_id; reutilizarlo con otro contenido se rechaza; la revisión citada debe ser la vigente', async () => {
    const op = randomUUID();
    const nueva = await revision('9.9.9', 'REVIEWED');
    const a = await vincular({ operation_id: op, new_rule_set_version: '1.2.0', review_id: nueva }).expect(201);
    const b = await vincular({ operation_id: op, new_rule_set_version: '1.2.0', review_id: nueva }).expect(201);
    expect(b.body.replayed).toBe(true);
    expect(b.body.link.id).toBe(a.body.link.id);
    await vincular({ operation_id: op, new_rule_set_version: '1.3.0', review_id: nueva }).expect(409);
    // la revisión anterior (linkRev) ya no es la vigente: se rechaza la confirmación obsoleta
    const r = await vincular({ new_rule_set_version: '1.4.0', review_id: linkRev }).expect(409);
    expect(r.body.error.code).toBe('REVIEW_CHANGED');
  });

  it('la base repite las comprobaciones: sin pasar por la API no se escribe una referencia sin acto, ni un acto que cite otra revisión ni una versión que no sea copia', async () => {
    const ultima = (await sql<{ id: string }>`SELECT id::text FROM legal_profile_reviews WHERE version = '9.9.9' ORDER BY decided_at DESC, id DESC LIMIT 1`.execute(h.db)).rows[0].id;
    await expect(sql`INSERT INTO risk_rule_sets (version, approval_status, source, notes, regulatory_profile) VALUES ('2.0.0','NOT_APPROVED','x','x','9.9.9')`.execute(h.db)).rejects.toThrow(/exige un acto de vinculación/);
    await expect(h.db.transaction().execute(async (trx) => {
      await sql`INSERT INTO risk_rule_sets (version, approval_status, source, notes, regulatory_profile) VALUES ('2.0.1','NOT_APPROVED','x','x','9.9.9')`.execute(trx);
      await sql`INSERT INTO risk_rule_set_profile_links (id, rule_set_version, base_rule_set_version, profile_version, review_id, reason, decided_by, operation_id)
        VALUES (${randomUUID()}, '2.0.1', '1.0.0', '9.9.9', ${linkRev}, 'revisión anterior', ${revisor}, ${randomUUID()})`.execute(trx);
    })).rejects.toThrow(/no es la revisión vigente/);
    // con la revisión correcta pero SIN copiar las reglas, falla al cerrar la transacción
    await expect(h.db.transaction().execute(async (trx) => {
      await sql`INSERT INTO risk_rule_sets (version, approval_status, source, notes, regulatory_profile) VALUES ('2.0.2','NOT_APPROVED','x','x','9.9.9')`.execute(trx);
      await sql`INSERT INTO risk_rule_set_profile_links (id, rule_set_version, base_rule_set_version, profile_version, review_id, reason, decided_by, operation_id)
        VALUES (${randomUUID()}, '2.0.2', '1.0.0', '9.9.9', ${ultima}, 'sin copiar', ${revisor}, ${randomUUID()})`.execute(trx);
    })).rejects.toThrow(/no es copia exacta/);
    await expect(sql`UPDATE risk_rule_set_profile_links SET reason = 'otro'`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM risk_rule_set_profile_links`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('historial: lista el acto con autor, fecha, motivo, versión, perfil y revisión; vigente mientras la revisión lo sustente', async () => {
    const hs = (await http().get(P).set(as(SUPER)).expect(200)).body.links;
    const l = hs.find((x: { rule_set_version: string }) => x.rule_set_version === '1.1.0');
    expect(l).toMatchObject({ profile_version: '9.9.9', base_rule_set_version: '1.0.0', review_id: linkRev, reason: 'Vinculación de ensayo con perfil sintético', current_status: 'CURRENT' });
    expect(l.decided_by).toBeTruthy();
    expect(l.decided_at).toBeTruthy();
  });

  // ---------------------------------------------------------------- revisión posterior y frescura

  it('EXPEDIENTE: cumplía RISK_CATALOG_APPROVED; tras una revisión objetada la referencia histórica permanece, deja de ser vigente y la instantánea queda desactualizada', async () => {
    // La organización adopta el perfil sintético y el catálogo vinculado (actos propios de la organización).
    await http().post(`${api(org)}/legal-profile/adoptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), version: '9.9.9', decision: 'ADOPT', reason: 'Adopción sintética de ensayo' }).expect(201);
    await http().post(`${api(org)}/risk/rule-sets/adoptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), rule_set_version: '1.1.0', decision: 'ADOPT', reason: 'Adopción sintética de ensayo' }).expect(201);
    await http().post(`${api(org)}/risk/lots/${lotId}/evaluations`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201);
    const caso = (await http().post(`${api(org)}/dd-cases`).set(as(ADMIN)).send({ operation_id: randomUUID(), lot_id: lotId, scope_note: 'Expediente sintético de ensayo' }).expect(201)).body.case;
    const snap1 = (await http().post(`${api(org)}/dd-cases/${caso.id}/snapshots`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot;
    const req = (s: { requirements: Array<{ code: string; status: string; detail: string }> }, code: string) => s.requirements.find((r) => r.code === code)!;
    expect(req(snap1, 'RISK_CATALOG_APPROVED').status).toBe('MET');
    expect(snap1.readiness).toMatchObject({ captured: 'BLOCKED', effective: 'BLOCKED' }); // cumplir UN requisito no es estar listo
    expect(req(snap1, 'REGULATORY_CONCLUSION').status).toBe('NOT_EVALUABLE');

    // Una revisión posterior OBJETA el perfil: el INSERT no se bloquea por la referencia existente.
    await revision('9.9.9', 'OBJECTED');

    // La referencia histórica permanece…
    expect((await sql<{ regulatory_profile: string }>`SELECT regulatory_profile FROM risk_rule_sets WHERE version = '1.1.0'`.execute(h.db)).rows[0].regulatory_profile).toBe('9.9.9');
    // …pero el historial del acto ya no la presenta como vigente…
    const l = (await http().get(P).set(as(SUPER)).expect(200)).body.links.find((x: { rule_set_version: string }) => x.rule_set_version === '1.1.0');
    expect(l.current_status).toBe('NO_LONGER_VALID');
    expect(l.current_reasons.map((r: { code: string }) => r.code)).toContain('REVIEW_OBJECTED');
    // …la instantánea histórica conserva lo que decía, pero ya no vale como vigente…
    const hist = (await http().get(`${api(org)}/dd-snapshots/${snap1.id}`).set(as(ADMIN)).expect(200)).body;
    expect(req(hist, 'RISK_CATALOG_APPROVED').status).toBe('MET'); // lo capturado no se reescribe
    expect(hist.readiness.effective).toBe('STALE');
    // El expediente deja de presentar esa preparación como vigente (la que se usa para habilitar operaciones).
    const lista = (await http().get(`${api(org)}/dd-cases`).set(as(ADMIN)).expect(200)).body.cases.find((c: { id: string }) => c.id === caso.id);
    expect(lista.readiness_effective).toBe('STALE');
    // …y una instantánea nueva refleja la pérdida de la condición.
    const snap2 = (await http().post(`${api(org)}/dd-cases/${caso.id}/snapshots`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot;
    expect(req(snap2, 'RISK_CATALOG_APPROVED').status).toBe('PENDING');
    expect(req(snap2, 'RISK_CATALOG_APPROVED').detail).toMatch(/revisión jurídica vigente/);
    // El catálogo y los registros históricos siguen intactos: el acto sigue ahí, sin cambios.
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_rule_set_profile_links WHERE rule_set_version = '1.1.0'`.execute(h.db)).rows[0].n).toBe('1');
  });

  it('con la revisión objetada ya no se puede vincular ese perfil en una versión nueva (el mismo contrato)', async () => {
    const e = (await http().get(`${P}/eligibility`).set(as(SUPER)).expect(200)).body;
    const p = e.profiles.find((x: { version: string }) => x.version === '9.9.9');
    expect(p.eligible).toBe(false);
    expect(p.reasons.map((r: { code: string }) => r.code)).toContain('REVIEW_OBJECTED');
    const ultima = (await sql<{ id: string }>`SELECT id::text FROM legal_profile_reviews WHERE version = '9.9.9' ORDER BY decided_at DESC, id DESC LIMIT 1`.execute(h.db)).rows[0].id;
    expect((await vincular({ new_rule_set_version: '1.5.0', review_id: ultima }).expect(422)).body.error.code).toBe('PROFILE_NOT_ELIGIBLE');
  });

  it('el acto no concede nada más: ningún permiso de concluir, y la conclusión sigue UNDETERMINED', async () => {
    const n = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_evaluations WHERE conclusion <> 'UNDETERMINED'`.execute(h.db)).rows[0].n;
    expect(n).toBe('0');
    void PASSWORD;
  });
});
