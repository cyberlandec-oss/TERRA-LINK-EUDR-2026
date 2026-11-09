import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// D-07 — MECANISMOS adoptados para el MVP local (2026-10-15). Contrato: docs/decisiones/D-07-PROPUESTA.md.
//
// Qué acreditan estas pruebas: que el mecanismo de aprobación distingue publicación global de adopción por
// organización, que la severidad sale de las reglas y se agrega por máximo, que la ausencia NO produce un
// resultado favorable, que una clasificación parcial se declara como parcial, y que nada de esto habilita una
// conclusión regulatoria.
//
// Qué NO acreditan: ningún catálogo aprobado. Las severidades que aparecen aquí se publican **en una versión de
// prueba**, dentro de la base aislada, para poder ejercitar el mecanismo. **No se asignan severidades a 0.1.0 ni
// 0.2.0**, que siguen siendo los catálogos históricos.
describeDb('D-07 mecanismos: adopción por organización y severidad por regla', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const ADMIN = 'admin-a@test.local';
  const ADMIN_B = 'admin-b@test.local';
  const EUDR = 'eudr@test.local';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o: string) => `/api/v1/organizations/${o}`;

  /** Publica una versión de reglas SOLO en la base de prueba, para ejercitar el mecanismo. */
  async function publicar(version: string, reglas: Array<{ code: string; category: string; condition_kind: string; effect: string; severity: string | null }>) {
    await sql`INSERT INTO risk_rule_sets (version, approval_status, source, notes, published_at)
      VALUES (${version}, 'NOT_APPROVED', 'prueba de mecanismo D-07', 'Versión sintética para probar el mecanismo; no es un catálogo aprobado.', now())`.execute(h.db);
    for (const r of reglas) {
      await sql`INSERT INTO risk_rules (rule_set_version, code, category, condition_kind, inputs, effect, explanation, limit_note, evidence_required, source, severity)
        VALUES (${version}, ${r.code}, ${r.category}, ${r.condition_kind}, ARRAY['x']::text[], ${r.effect}, 'sintética', 'sintética', 'ninguna', 'prueba', ${r.severity})`.execute(h.db);
    }
  }
  const adoptar = (o: string, actor: string, version: string, decision = 'ADOPT', reason = 'Adopción para el MVP local') =>
    http().post(`${api(o)}/risk/rule-sets/adoptions`).set(as(actor)).send({ operation_id: randomUUID(), rule_set_version: version, decision, reason });
  const evaluar = (o: string, actor: string, lot: string) =>
    http().post(`${api(o)}/risk/lots/${lot}/evaluations`).set(as(actor)).send({ operation_id: randomUUID() });

  let loteA: string;
  let loteB: string;

  /** Lote con origen incompleto: dispara MATERIAL_OF_UNKNOWN_ORIGIN y DATA_MISSING_ORIGIN. */
  async function lote(o: string, admin: string, code: string) {
    const prod = (await http().post(`${api(o)}/producers`).set(as(admin)).send({ producer_code: `${code}-P`, legal_name: `Finca ${code}` }).expect(201)).body.id;
    await http().post(`${api(o)}/products`).set(as(admin)).send({ code: `PR-${code}`, name: 'Cacao', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201);
    const prodId = (await (await http().get(`${api(o)}/products?limit=50`).set(as(admin))).body).items.find((x: { code: string }) => x.code === `PR-${code}`).id;
    const loc = (await http().post(`${api(o)}/locations`).set(as(admin)).send({ code: `L-${code}`, name: 'Centro', location_type: 'COLLECTION_CENTER' }).expect(201)).body;
    const locId = (await (await http().get(`${api(o)}/locations`).set(as(admin))).body).find((l: { code: string }) => l.code === `L-${code}`).id;
    void loc;
    const hoy = new Date().toISOString().slice(0, 10);
    // Entrega SIN origen declarado: así el lote queda con origen incompleto.
    const d = (await http().post(`${api(o)}/deliveries`).set(as(admin)).send({ operation_id: randomUUID(), producer_id: prod, product_id: prodId, delivery_date: hoy, quantity_declared: '100', unit: 'KG', register: true }).expect(201)).body.delivery;
    const rec = (await http().post(`${api(o)}/deliveries/${d.id}/receptions`).set(as(admin)).send({ operation_id: randomUUID(), location_id: locId, received_at: new Date().toISOString(), weighing: { method: 'Báscula', quantity: '100', unit: 'KG', weighed_on: hoy } }).expect(201)).body.reception_id;
    return (await http().post(`${api(o)}/lots`).set(as(admin)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '100' }] }).expect(201)).body.lot.id;
  }

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_B);
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop D07 A', ADMIN);
    orgB = await mk('Coop D07 B', ADMIN_B);
    const inv = await http().post(`${api(orgA)}/invitations`).set(as(ADMIN)).send({ email: EUDR, role_code: 'EUDR_MANAGER' }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'E', last_name: 'Eudr', password: PASSWORD }).expect(200);
    await h.login(EUDR);
    loteA = await lote(orgA, ADMIN, 'DA');
    loteB = await lote(orgB, ADMIN_B, 'DB');
  }, 180_000);
  afterAll(async () => { await h?.close(); });

  // ---------------------------------------------------------------- D-07.1 aprobación y ámbito

  it('los catálogos históricos quedan intactos: ninguna regla lleva severidad y ninguno está aprobado', async () => {
    const sets = (await sql<{ version: string; approval_status: string }>`SELECT version, approval_status FROM risk_rule_sets WHERE version IN ('0.1.0','0.2.0') ORDER BY version`.execute(h.db)).rows;
    expect(sets).toEqual([{ version: '0.1.0', approval_status: 'NOT_APPROVED' }, { version: '0.2.0', approval_status: 'NOT_APPROVED' }]);
    const conSeveridad = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_rules WHERE rule_set_version IN ('0.1.0','0.2.0') AND severity IS NOT NULL`.execute(h.db)).rows[0].n;
    expect(conSeveridad).toBe('0');
  });

  it('adoptar exige el permiso: quien evalúa riesgo no puede adoptar reglas', async () => {
    // EUDR_MANAGER tiene risk:evaluate y risk:review, pero NO risk:approve_rules.
    await adoptar(orgA, EUDR, '0.2.0').expect(403);
    const r = await adoptar(orgA, ADMIN, '0.2.0').expect(201);
    expect(r.body.adoption).toMatchObject({ rule_set_version: '0.2.0', decision: 'ADOPT' });
    expect(r.body.adoption.note).toMatch(/no afecta a otras organizaciones/i);
  });

  it('el actor y el motivo salen de la sesión y quedan en auditoría; el cuerpo no puede suplantar al actor', async () => {
    // El cuerpo NI SIQUIERA admite un campo de actor: la API lo rechaza en vez de ignorarlo en silencio.
    await http().post(`${api(orgA)}/risk/rule-sets/adoptions`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), rule_set_version: '0.1.0', decision: 'ADOPT', reason: 'Intento de suplantar al actor', decided_by: 'otro-usuario' }).expect(400);
    const op = randomUUID();
    await http().post(`${api(orgA)}/risk/rule-sets/adoptions`).set(as(ADMIN))
      .send({ operation_id: op, rule_set_version: '0.1.0', decision: 'ADOPT', reason: 'Motivo registrado en auditoría' }).expect(201);
    const fila = (await sql<{ decided_by: string; reason: string }>`SELECT decided_by::text, reason FROM risk_rule_set_adoptions WHERE operation_id = ${op}`.execute(h.db)).rows[0];
    const admin = (await sql<{ id: string }>`SELECT id::text FROM users WHERE email = ${ADMIN}`.execute(h.db)).rows[0];
    expect(fila.decided_by).toBe(admin.id); // el actor sale de la sesión
    expect(fila.reason).toBe('Motivo registrado en auditoría');
    const aud = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM audit_logs WHERE organization_id = ${orgA} AND action = 'risk.rule_set_adopt'`.execute(h.db)).rows[0].n;
    expect(Number(aud)).toBeGreaterThanOrEqual(1);
  });

  it('una adopción en una organización NO aprueba reglas en otra', async () => {
    const a = (await http().get(`${api(orgA)}/risk/rule-sets/adoptions`).set(as(ADMIN)).expect(200)).body;
    const b = (await http().get(`${api(orgB)}/risk/rule-sets/adoptions`).set(as(ADMIN_B)).expect(200)).body;
    expect(a.history.length).toBeGreaterThanOrEqual(1); // A adoptó algo
    expect(b.history).toHaveLength(0); // B no ha adoptado nada: la adopción de A no cruza
    expect(b.adopted).toBe(false);
    // Cada organización ve el catálogo que ELLA adoptó: A el suyo, B el último publicado por no haber adoptado
    // ninguno. Publicar y adoptar son actos distintos, y una adopción no se propaga.
    // A ve lo que ELLA adoptó; B, que no ha adoptado nada, ve el último publicado. Son distintos: la adopción
    // de A no cruza a B.
    expect(a.adoption?.rule_set_version).toBe(a.current_rule_set.version);
    expect(a.current_rule_set.version).not.toBe(b.current_rule_set.version);
    expect(b.adopted).toBe(false); // aunque haya catálogos publicados globalmente, B no usa ninguno
    expect(b.note).toMatch(/Publicación global y adopción por organización son actos distintos/i);
  });

  it('no se adopta una versión que no está publicada globalmente', async () => {
    const r = await adoptar(orgA, ADMIN, '9.9.9').expect(422);
    expect(r.body.error.code).toBe('RULE_SET_NOT_PUBLISHED');
  });

  it('adoptar es append-only, idempotente por operation_id y no admite doble adopción', async () => {
    const op = randomUUID();
    const a = await http().post(`${api(orgB)}/risk/rule-sets/adoptions`).set(as(ADMIN_B)).send({ operation_id: op, rule_set_version: '0.2.0', decision: 'ADOPT', reason: 'Primera adopción' }).expect(201);
    const b = await http().post(`${api(orgB)}/risk/rule-sets/adoptions`).set(as(ADMIN_B)).send({ operation_id: op, rule_set_version: '0.2.0', decision: 'ADOPT', reason: 'Primera adopción' }).expect(201);
    expect(b.body.replayed).toBe(true);
    expect(b.body.adoption.id).toBe(a.body.adoption.id);
    await adoptar(orgB, ADMIN_B, '0.2.0').expect(409); // ya adoptada
    await expect(sql`UPDATE risk_rule_set_adoptions SET reason = 'otro' WHERE id = ${a.body.adoption.id}`.execute(h.db)).rejects.toThrow(/append-only/i);
    await expect(sql`DELETE FROM risk_rule_set_adoptions WHERE id = ${a.body.adoption.id}`.execute(h.db)).rejects.toThrow(/append-only/i);
    // Retirar es otra fila, no un borrado; después se puede volver a adoptar.
    await adoptar(orgB, ADMIN_B, '0.2.0', 'WITHDRAW', 'Se retira para revisar').expect(201);
    expect((await http().get(`${api(orgB)}/risk/rule-sets/adoptions`).set(as(ADMIN_B)).expect(200)).body.adopted).toBe(false);
    await adoptar(orgB, ADMIN_B, '0.2.0', 'WITHDRAW', 'Nada que retirar').expect(409);
  });

  it('adoptar NO recalcula nada: las evaluaciones anteriores quedan intactas', async () => {
    const antes = (await evaluar(orgA, EUDR, loteA).expect(201)).body.evaluation;
    expect(antes.risk_result.severity).toBe('NOT_ASSESSED'); // 0.2.0 no declara severidades
    const filaAntes = (await sql<{ severity: string; rule_set_version: string }>`SELECT severity, rule_set_version FROM risk_evaluations WHERE id = ${antes.id}`.execute(h.db)).rows[0];
    // Publicar y adoptar una versión con severidades no toca la evaluación anterior.
    await publicar('9.0.0', [
      { code: 'MATERIAL_OF_UNKNOWN_ORIGIN', category: 'MIXING', condition_kind: 'lot_origin_incomplete', effect: 'BLOCKING', severity: 'HIGH' },
      { code: 'DATA_MISSING_ORIGIN', category: 'TRACEABILITY', condition_kind: 'delivery_without_origin', effect: 'BLOCKING', severity: 'MEDIUM' },
    ]);
    await adoptar(orgA, ADMIN, '9.0.0').expect(201);
    // La evaluación anterior NO se recalcula ni se migra a la severidad nueva: queda tal cual, con su versión.
    const filaDespues = (await sql<{ severity: string; rule_set_version: string }>`SELECT severity, rule_set_version FROM risk_evaluations WHERE id = ${antes.id}`.execute(h.db)).rows[0];
    expect(filaDespues).toEqual(filaAntes);
    expect(filaDespues.severity).toBe('NOT_ASSESSED');
    // Para que la adopción surta efecto hay que REEVALUAR, que crea un registro nuevo.
    const nueva = (await evaluar(orgA, EUDR, loteA).expect(201)).body.evaluation;
    expect(nueva.id).not.toBe(antes.id);
    expect(nueva.risk_result.severity).toBe('HIGH');
    // Y se retira para no arrastrar esta adopción a las pruebas siguientes.
    await adoptar(orgA, ADMIN, '9.0.0', 'WITHDRAW', 'Fin del caso de prueba').expect(201);
  });

  // ---------------------------------------------------------------- D-07.2 severidad

  it('sin adopción no se clasifica, y el motivo lo dice: no es que no haya riesgo', async () => {
    const ev = (await evaluar(orgB, ADMIN_B, loteB).expect(201)).body.evaluation;
    expect(ev.risk_result.severity).toBe('NOT_ASSESSED');
    expect(ev.risk_result.severity_coverage.reason).toMatch(/no ha adoptado el catálogo/i);
    expect(ev.risk_result.severity_coverage.reason).toMatch(/no una afirmación sobre el lote/i);
    expect(ev.rules.adopted_by_organization).toBe(false);
  });

  it('severidad por regla, agregada por MÁXIMO, y presentada como severidad de los hallazgos evaluados', async () => {
    await publicar('9.1.0', [
      { code: 'MATERIAL_OF_UNKNOWN_ORIGIN', category: 'MIXING', condition_kind: 'lot_origin_incomplete', effect: 'BLOCKING', severity: 'HIGH' },
      { code: 'DATA_MISSING_ORIGIN', category: 'TRACEABILITY', condition_kind: 'delivery_without_origin', effect: 'BLOCKING', severity: 'MEDIUM' },
    ]);
    await adoptar(orgA, ADMIN, '9.1.0').expect(201);
    const ev = (await evaluar(orgA, EUDR, loteA).expect(201)).body.evaluation;
    // Dos hallazgos, HIGH y MEDIUM: gana el mayor. Ni promedio ni suma.
    expect(ev.risk_result.severity).toBe('HIGH');
    expect(ev.risk_result.severity_scope).toBe('EVALUATED_FINDINGS');
    expect(ev.risk_result.severity_label).toMatch(/de los hallazgos evaluados/i);
    expect(ev.risk_result.severity_coverage.hits).toBe(2);
    // El resultado técnico NO lo sustituye: el bloqueante sigue mandando.
    expect(ev.technical_result.status).toBe('BLOCKED');
    // Y la conclusión regulatoria no se mueve.
    expect(ev.risk_result.conclusion).toBe('UNDETERMINED');
    expect(ev.risk_result.note).toMatch(/NO se deriva de la severidad/i);
    // Sin pesos ni umbrales en ninguna parte.
    expect(ev.parameters).toMatchObject({ weights: null, thresholds: null });
  });

  it('clasificación PARCIAL: un hallazgo conocido no desaparece porque otra regla no se pueda evaluar', async () => {
    await publicar('9.2.0', [
      { code: 'MATERIAL_OF_UNKNOWN_ORIGIN', category: 'MIXING', condition_kind: 'lot_origin_incomplete', effect: 'BLOCKING', severity: 'HIGH' },
      { code: 'SATELLITE_COVERAGE_UNKNOWN', category: 'DEFORESTATION', condition_kind: 'satellite_coverage', effect: 'NOT_ASSESSED', severity: 'CRITICAL' },
    ]);
    await adoptar(orgA, ADMIN, '9.1.0', 'WITHDRAW', 'Se cambia de versión').expect(201);
    await adoptar(orgA, ADMIN, '9.2.0').expect(201);
    const ev = (await evaluar(orgA, EUDR, loteA).expect(201)).body.evaluation;
    const cov = ev.risk_result.severity_coverage;
    // El hallazgo conocido se clasifica: HIGH. La regla no evaluable NO aporta su CRITICAL (no se sabe qué daría).
    expect(ev.risk_result.severity).toBe('HIGH');
    expect(cov.not_evaluable).toBeGreaterThanOrEqual(1);
    expect(cov.not_evaluable_codes).toContain('SATELLITE_COVERAGE_UNKNOWN');
    // Y se declara PARCIAL: no se presenta como evaluación completa.
    expect(cov.complete).toBe(false);
    expect(cov.reason).toMatch(/Clasificación PARCIAL/i);
    expect(cov.reason).toMatch(/No es una evaluación completa del riesgo del lote/i);
    // Las categorías sin ninguna regla siguen visibles.
    expect(cov.categories_without_rules).toEqual(expect.arrayContaining(['LEGALITY', 'EVASION', 'HUMAN_RIGHTS', 'INDIGENOUS_RIGHTS']));
  });

  it('A.2: sin hallazgos NO se asigna «bajo» por ausencia', async () => {
    // Catálogo cuya única regla no se dispara en este lote.
    // `mitigation_status` da NOT_HIT cuando no hay mitigaciones abiertas: todas las reglas del catálogo evaluadas
    // y ningún hallazgo. Aun así NO se clasifica como «bajo».
    await publicar('9.3.0', [{ code: 'MITIGATION_UNVERIFIED', category: 'SUPPLY_CHAIN', condition_kind: 'mitigation_status', effect: 'BLOCKING', severity: 'LOW' }]);
    await adoptar(orgA, ADMIN, '9.2.0', 'WITHDRAW', 'Se cambia de versión').expect(201);
    await adoptar(orgA, ADMIN, '9.3.0').expect(201);
    const ev = (await evaluar(orgA, EUDR, loteA).expect(201)).body.evaluation;
    expect(ev.risk_result.severity).toBe('NOT_ASSESSED');
    expect(ev.risk_result.severity_coverage.reason).toMatch(/NO se asigna «bajo» por ausencia/i);
    expect(ev.risk_result.severity_coverage.reason).toMatch(/no demuestra cobertura completa/i);
  });

  it('un hallazgo cuya regla no declara severidad no clasifica, y se dice cuál', async () => {
    await publicar('9.4.0', [{ code: 'MATERIAL_OF_UNKNOWN_ORIGIN', category: 'MIXING', condition_kind: 'lot_origin_incomplete', effect: 'BLOCKING', severity: null }]);
    await adoptar(orgA, ADMIN, '9.3.0', 'WITHDRAW', 'Se cambia de versión').expect(201);
    await adoptar(orgA, ADMIN, '9.4.0').expect(201);
    const ev = (await evaluar(orgA, EUDR, loteA).expect(201)).body.evaluation;
    expect(ev.risk_result.severity).toBe('NOT_ASSESSED');
    expect(ev.risk_result.severity_coverage.hits_without_declared_severity).toContain('MATERIAL_OF_UNKNOWN_ORIGIN');
    expect(ev.risk_result.severity_coverage.reason).toMatch(/ninguna de sus reglas declara severidad/i);
    // El hallazgo sigue existiendo y bloqueando: no clasificar no es no encontrar.
    expect(ev.technical_result.status).toBe('BLOCKED');
  });

  it('la base impide una severidad sin adopción que la respalde, y la conclusión sigue clavada', async () => {
    const ev = (await evaluar(orgA, EUDR, loteA).expect(201)).body.evaluation;
    // Primera barrera: la tabla es append-only, así que ni siquiera se puede intentar editar un resultado.
    await expect(sql`UPDATE risk_evaluations SET severity = 'LOW' WHERE id = ${ev.id}`.execute(h.db))
      .rejects.toThrow(/append-only/i);
    // Segunda barrera, para una fila NUEVA: sin adopción que la respalde, la severidad no se puede escribir…
    const insertar = (severity: string, conclusion: string) => sql`
      INSERT INTO risk_evaluations (id, organization_id, subject_type, subject_id, evaluation_number, rule_set_version,
        parameters, snapshot, snapshot_hash, factors, categories, technical_result, severity, conclusion, evaluated_by, operation_id)
      SELECT gen_random_uuid(), organization_id, subject_type, subject_id, evaluation_number + 100, rule_set_version,
        parameters, snapshot, snapshot_hash, factors, categories, technical_result, ${severity}, ${conclusion}, evaluated_by, gen_random_uuid()
      FROM risk_evaluations WHERE id = ${ev.id}`.execute(h.db);
    await expect(insertar('LOW', 'UNDETERMINED')).rejects.toThrow(/severity_backed/i);
    // …y la conclusión regulatoria no se puede escribir de ninguna manera.
    await expect(insertar('NOT_ASSESSED', 'NEGLIGIBLE')).rejects.toThrow(/conclusion_undetermined/i);
  });

  it('reevaluar crea un registro nuevo y conserva el anterior con su severidad y su versión', async () => {
    const primera = (await evaluar(orgA, EUDR, loteA).expect(201)).body.evaluation;
    const segunda = (await evaluar(orgA, EUDR, loteA).expect(201)).body.evaluation;
    expect(segunda.id).not.toBe(primera.id);
    expect(segunda.evaluation_number).toBe(primera.evaluation_number + 1);
    const anterior = (await sql<{ severity: string; rule_set_version: string }>`SELECT severity, rule_set_version FROM risk_evaluations WHERE id = ${primera.id}`.execute(h.db)).rows[0];
    expect(anterior).toBeDefined(); // sigue ahí, sin reescribir
  });

  // ---------------------------------------------------------------- D-07.4 desactualización

  it('publicar una versión que la organización no adopta NO desactualiza sus evaluaciones, pero se le avisa', async () => {
    const ev = (await evaluar(orgA, EUDR, loteA).expect(201)).body.evaluation;
    expect(ev.freshness.status).toBe('CURRENT');
    // Publicar algo que A no ha adoptado no le cambia las reglas a su espalda…
    await publicar('9.5.0', [{ code: 'MATERIAL_OF_UNKNOWN_ORIGIN', category: 'MIXING', condition_kind: 'lot_origin_incomplete', effect: 'BLOCKING', severity: 'HIGH' }]);
    const avisado = (await http().get(`${api(orgA)}/risk/evaluations/${ev.id}`).set(as(EUDR)).expect(200)).body;
    expect(avisado.freshness.status).toBe('CURRENT');
    // …pero sí se le dice que existe, para que decida si la adopta.
    expect(avisado.freshness.newer_published).toBe('9.5.0');
    expect(avisado.freshness.newer_published_note).toMatch(/NO se aplica sola/i);

    // Lo que SÍ desactualiza es cambiar las reglas que le APLICAN: adoptar otra versión.
    await adoptar(orgA, ADMIN, '9.5.0', 'ADOPT', 'Se adopta la versión nueva').expect(201);
    const releido = (await http().get(`${api(orgA)}/risk/evaluations/${ev.id}`).set(as(EUDR)).expect(200)).body;
    expect(releido.freshness.status).toBe('STALE');
    expect(releido.freshness.reason).toMatch(/le aplican ahora las 9\.5\.0/i);
    // La evaluación NO se modificó: mismo hash de instantánea y misma versión.
    expect(releido.snapshot.hash).toBe(ev.snapshot.hash);
    expect(releido.rules.version).toBe(ev.rules.version);
  });

  // ---------------------------------------------------------------- catálogo 1.0.0 real (migración 0043)

  describe('catálogo 1.0.0, publicado globalmente', () => {
    // No hace falta tocar nada para que estas pruebas vean 1.0.0: el catálogo que aplica a una organización es el
    // que ELLA ha adoptado, y si no ha adoptado ninguno, el último publicado. `risk_rule_sets` es append-only.

    it('publica cinco severidades y tres reglas sin severidad, y deja los históricos intactos', async () => {
      const reglas = (await sql<{ code: string; severity: string | null; effect: string }>`
        SELECT code, severity, effect FROM risk_rules WHERE rule_set_version = '1.0.0' ORDER BY code`.execute(h.db)).rows;
      expect(reglas).toHaveLength(8);
      const sev = Object.fromEntries(reglas.map((r) => [r.code, r.severity]));
      expect(sev).toEqual({
        MATERIAL_OF_UNKNOWN_ORIGIN: 'CRITICAL',
        MASS_BALANCE_INCONSISTENT: 'CRITICAL',
        DATA_MISSING_ORIGIN: 'HIGH',
        GEOMETRY_INVALID: 'HIGH',
        DOCUMENT_EXPIRED: 'MEDIUM',
        MITIGATION_UNVERIFIED: null,
        SATELLITE_COVERAGE_UNKNOWN: null,
        GEOLOCATION_PROFILE: null,
      });
      const efecto = Object.fromEntries(reglas.map((r) => [r.code, r.effect]));
      expect(efecto.MITIGATION_UNVERIFIED).toBe('BLOCKING');
      expect(efecto.SATELLITE_COVERAGE_UNKNOWN).toBe('NOT_ASSESSED');
      expect(efecto.GEOLOCATION_PROFILE).toBe('NOT_ASSESSED');
      expect(efecto.DOCUMENT_EXPIRED).toBe('REVIEW_REQUIRED');
      const hist = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_rules WHERE rule_set_version IN ('0.1.0','0.2.0') AND severity IS NOT NULL`.execute(h.db)).rows[0].n;
      expect(hist).toBe('0');
    });

    it('la graduación se declara como decisión de producto, no como exigencia de la norma', async () => {
      const filas = (await sql<{ code: string; source: string; limit_note: string }>`
        SELECT code, source, limit_note FROM risk_rules WHERE rule_set_version = '1.0.0' AND severity IS NOT NULL`.execute(h.db)).rows;
      expect(filas).toHaveLength(5);
      for (const f of filas) {
        expect(f.source).toMatch(/DECISIÓN DE PRODUCTO/);
        expect(f.limit_note).toMatch(/decisión interna de producto/i);
      }
      const notas = (await sql<{ notes: string; approval_status: string }>`SELECT notes, approval_status FROM risk_rule_sets WHERE version = '1.0.0'`.execute(h.db)).rows[0];
      expect(notas.approval_status).toBe('APPROVED');
      expect(notas.notes).toMatch(/NO es aprobación regulatoria/i);
      expect(notas.notes).toMatch(/DECISIONES INTERNAS DE PRODUCTO/);
      expect(notas.notes).toMatch(/LEGALITY, EVASION, HUMAN_RIGHTS/);
      expect(notas.notes).toMatch(/PUBLICAR NO ES ADOPTAR/);
    });

    it('MATERIAL_OF_UNKNOWN_ORIGIN se describe por su condición real, sin imputar mezcla ilegal ni fraude', async () => {
      const r = (await sql<{ explanation: string; limit_note: string }>`
        SELECT explanation, limit_note FROM risk_rules WHERE rule_set_version = '1.0.0' AND code = 'MATERIAL_OF_UNKNOWN_ORIGIN'`.execute(h.db)).rows[0];
      expect(r.explanation).toMatch(/origen INCOMPLETO/i);
      expect(r.limit_note).toMatch(/NO una mezcla ilegal, un fraude ni una irregularidad probada/i);
      expect(r.limit_note).toMatch(/puede completarse/i);
    });

    it('publicar no adopta: sin adopción, el catálogo aprobado no clasifica nada', async () => {
      // 1.0.0 está publicado globalmente y APROBADO…
      const cat = (await sql<{ approval_status: string }>`SELECT approval_status FROM risk_rule_sets WHERE version = '1.0.0'`.execute(h.db)).rows[0];
      expect(cat.approval_status).toBe('APPROVED');
      // …y aun así B no clasifica nada, porque no ha adoptado ninguna versión.
      const ev = (await evaluar(orgB, ADMIN_B, loteB).expect(201)).body.evaluation;
      expect(ev.rules.adopted_by_organization).toBe(false);
      expect(ev.risk_result.severity).toBe('NOT_ASSESSED');
      expect(ev.risk_result.severity_coverage.reason).toMatch(/no ha adoptado el catálogo/i);
    });

    it('adoptado: el hallazgo CRÍTICO conocido permanece visible y la cobertura sigue incompleta', async () => {
      await adoptar(orgB, ADMIN_B, '1.0.0', 'ADOPT', 'Ensayo técnico del MVP local').expect(201);
      const ev = (await evaluar(orgB, ADMIN_B, loteB).expect(201)).body.evaluation;
      const cov = ev.risk_result.severity_coverage;
      expect(ev.risk_result.severity).toBe('CRITICAL');
      expect(ev.risk_result.severity_label).toMatch(/de los hallazgos evaluados/i);
      expect(cov.not_evaluable_codes).toEqual(expect.arrayContaining(['SATELLITE_COVERAGE_UNKNOWN', 'GEOLOCATION_PROFILE']));
      expect(cov.complete).toBe(false);
      expect(cov.reason).toMatch(/Clasificación PARCIAL/i);
      expect(cov.reason).toMatch(/No es una evaluación completa del riesgo del lote/i);
      expect(cov.categories_without_rules).toEqual(expect.arrayContaining(['LEGALITY', 'EVASION', 'HUMAN_RIGHTS', 'INDIGENOUS_RIGHTS']));
      expect(ev.technical_result.status).toBe('BLOCKED');
      expect(ev.risk_result.conclusion).toBe('UNDETERMINED');
    });

    it('una mitigación sin abrir no aporta severidad: la clasificación sale de los hallazgos clasificables', async () => {
      const ev = (await evaluar(orgB, ADMIN_B, loteB).expect(201)).body.evaluation;
      const factores = ev.factors as Array<{ code: string; result: string }>;
      expect(factores.find((f) => f.code === 'MITIGATION_UNVERIFIED')!.result).toBe('NOT_HIT');
      expect(ev.risk_result.severity).toBe('CRITICAL');
      expect(ev.risk_result.severity_coverage.hits_without_declared_severity).not.toContain('MATERIAL_OF_UNKNOWN_ORIGIN');
    });

    it('retirar la adopción devuelve a sin clasificar, sin tocar las evaluaciones anteriores', async () => {
      const antes = (await evaluar(orgB, ADMIN_B, loteB).expect(201)).body.evaluation;
      expect(antes.risk_result.severity).toBe('CRITICAL');
      await adoptar(orgB, ADMIN_B, '1.0.0', 'WITHDRAW', 'Fin del ensayo').expect(201);
      const despues = (await evaluar(orgB, ADMIN_B, loteB).expect(201)).body.evaluation;
      expect(despues.risk_result.severity).toBe('NOT_ASSESSED');
      const fila = (await sql<{ severity: string }>`SELECT severity FROM risk_evaluations WHERE id = ${antes.id}`.execute(h.db)).rows[0];
      expect(fila.severity).toBe('CRITICAL');
    });
  });

  // ---------------------------------------------------------------- lo que sigue bloqueado

  it('ninguna versión publicada declara perfil jurídico: publicar técnicamente no aprueba nada bajo la norma', async () => {
    const conPerfil = (await sql<{ version: string }>`SELECT version FROM risk_rule_sets WHERE regulatory_profile IS NOT NULL`.execute(h.db)).rows;
    expect(conPerfil).toEqual([]); // D-07.5 sigue pendiente, y la base lo refleja
    const ev = (await evaluar(orgB, ADMIN_B, loteB).expect(201)).body.evaluation;
    expect(ev.rules.regulatory_profile).toBeNull();
    expect(ev.rules.note).toMatch(/APROBACIÓN BAJO PERFIL JURÍDICO \(D-07\.5, pendiente/);
  });

  it('nada de esto habilita READY ni conclusión regulatoria, ni siquiera con el catálogo ADOPTADO', async () => {
    // Peor caso a propósito: la organización adopta 1.0.0, clasifica un CRÍTICO y aun así el expediente no avanza.
    await adoptar(orgB, ADMIN_B, '1.0.0', 'ADOPT', 'Ensayo técnico del MVP local').expect(201);
    const ev = (await evaluar(orgB, ADMIN_B, loteB).expect(201)).body.evaluation;
    expect(ev.risk_result.severity).toBe('CRITICAL');
    expect(ev.risk_result.conclusion).toBe('UNDETERMINED');

    const caso = (await http().post(`${api(orgB)}/dd-cases`).set(as(ADMIN_B))
      .send({ operation_id: randomUUID(), lot_id: loteB, scope_note: 'Expediente de prueba del MVP local' }).expect(201)).body.case;
    const dd = (await http().post(`${api(orgB)}/dd-cases/${caso.id}/snapshots`).set(as(ADMIN_B)).send({ operation_id: randomUUID() }).expect(201)).body;
    expect(dd.snapshot.readiness).toMatchObject({ captured: 'BLOCKED', effective: 'BLOCKED' });
    const req = Object.fromEntries((dd.snapshot.requirements as Array<{ code: string; status: string; detail: string }>).map((r) => [r.code, r]));
    // El requisito del catálogo NO se cumple por haberlo publicado ni por haberlo adoptado: falta el perfil jurídico.
    expect(req.RISK_CATALOG_APPROVED.status).toBe('NOT_EVALUABLE');
    expect(req.RISK_CATALOG_APPROVED.detail).toMatch(/decisión TÉCNICA de producto/);
    expect(req.RISK_CATALOG_APPROVED.detail).toMatch(/D-07\.5/);
    expect(req.REGULATORY_CONCLUSION.status).not.toBe('MET');
    // Y la severidad CRÍTICA no se convierte en una conclusión en contra: son dimensiones distintas.
    expect(req.REGULATORY_CONCLUSION.status).toBe('NOT_EVALUABLE');

    await adoptar(orgB, ADMIN_B, '1.0.0', 'WITHDRAW', 'Fin del ensayo').expect(201);
  });
});
