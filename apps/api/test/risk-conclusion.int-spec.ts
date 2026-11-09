import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { ROLE_PERMISSIONS } from '../src/authz/catalog';

// D-07.6 — CONCLUSIÓN HUMANA del responsable EUDR (`EUDR_MANAGER`, permiso `risk:conclude`). PostgreSQL real, datos SINTÉTICOS aislados.
// Todo perfil «completo y revisado» y toda conclusión de esta suite son sintéticos: no se aprueba ni se concluye nada real. Se demuestra: el caso válido (favorable con su condición y no favorable),
// la falta de permiso, el acceso entre organizaciones, datos desactualizados, reintentos y los cambios posteriores que invalidan su vigencia, con las conclusiones históricas conservadas.
// El motor NO concluye y registrar una conclusión NO habilita READY ni anula requisitos pendientes.
describeDb('D-07.6: conclusión humana del responsable EUDR', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA = ''; let orgB = ''; let producer = ''; let baba = ''; let center = '';
  const SUPER = 'cc-super@test.local'; const ADMIN = 'cc-admin-a@test.local'; const ADMIN_B = 'cc-admin-b@test.local'; const E1 = 'cc-eudr@test.local'; const E_B = 'cc-eudr-b@test.local'; const AUD = 'cc-auditor@test.local';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const point = (x: number, y: number) => ({ type: 'Point', coordinates: [x, y] });

  async function join(o: string, admin: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: role, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  async function mkPlot(code: string, x: number, y: number) {
    const id = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: code, crop: 'Cacao' }).expect(201)).body.id as string;
    await http().post(`${base(orgA)}/plots/${id}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: point(x, y), area_declared_ha: 2 }).expect(201);
    return id;
  }
  /** Lote con origen declarado en todo su grafo: sin hallazgos (las reglas sin datos quedan NO EVALUABLES, no HIT). */
  async function lote(plots: string[]) {
    const d = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: '30', unit: 'KG', origins: plots.map((p) => ({ plot_id: p })), register: true }).expect(201)).body.delivery;
    const r = (await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'B', quantity: '30', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    return (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r, quantity: '30' }] }).expect(201)).body.lot.id as string;
  }
  const evaluar = async (lot: string, actor = ADMIN) => (await http().post(`${base(orgA)}/risk/lots/${lot}/evaluations`).set(as(actor)).send({ operation_id: randomUUID() }).expect(201)).body.evaluation as { id: string; technical_result: { status: string }; snapshot: { hash: string } };
  const ctxConc = async (ev: string, actor = E1, org = orgA, estado = 200) => (await http().get(`${base(org)}/risk/evaluations/${ev}/conclusions`).set(as(actor)).expect(estado)).body;
  const concluir = (ev: string, over: Record<string, unknown> = {}, actor = E1, org = orgA) => http().post(`${base(org)}/risk/evaluations/${ev}/conclusions`).set(as(actor)).send({
    operation_id: randomUUID(), result: 'NON_NEGLIGIBLE', reason: 'Motivo sintético de la conclusión humana de ensayo', supports: [{ kind: 'CITATION', citation: 'Evidencia sintética de ensayo' }], ...over });
  /** Versión de documento SINTÉTICA de la organización A (fixture escrita en la base de prueba). */
  const docVer = async () => {
    const doc = randomUUID(); const ver = randomUUID();
    const creador = (await sql<{ id: string }>`SELECT id::text FROM users WHERE email = ${ADMIN}`.execute(h.db)).rows[0].id;
    await sql`INSERT INTO documents (id, organization_id, document_type, owner_type, owner_id, title, created_by) VALUES (${doc}, ${orgA}, 'LAND_TENURE', 'producer', ${producer}, 'Evaluación documentada sintética', ${creador})`.execute(h.db);
    await sql`INSERT INTO document_versions (id, organization_id, document_id, version_number, object_key, file_name, mime_type, size_bytes, sha256, operation_id, uploaded_by)
      VALUES (${ver}, ${orgA}, ${doc}, 1, ${`conclusion/${ver}`}, 'evaluacion.pdf', 'application/pdf', 10, ${'7'.repeat(64)}, ${randomUUID()}, ${creador})`.execute(h.db);
    return ver;
  };
  type Carencia = { scope: string; code: string };
  /** Una resolución EXPLÍCITA por carencia (NOT_APPLICABLE), con justificación propia y la evidencia 0 referenciada. */
  const resolver = (carencias: Carencia[], over: Partial<{ kind: string; support_index: number }> = {}) => carencias.map((c) => ({
    scope: c.scope, code: c.code, kind: over.kind ?? 'NOT_APPLICABLE', support_index: over.support_index ?? 0,
    justification: `Justificación sintética propia de la carencia ${c.scope}:${c.code}: no aplica a esta operación de ensayo.` }));
  const mkCase = async (lot: string) => (await http().post(`${base(orgA)}/dd-cases`).set(as(E1)).send({ operation_id: randomUUID(), lot_id: lot, scope_note: 'Expediente sintético de la conclusión humana' }).expect(201)).body.case.id as string;
  const capturar = async (c: string) => (await http().post(`${base(orgA)}/dd-cases/${c}/snapshots`).set(as(E1)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot as { id: string; readiness: { captured: string; effective: string }; requirements: Array<{ code: string; status: string; detail: string }> };
  const req = (s: { requirements: Array<{ code: string; status: string; detail: string }> }, c = 'REGULATORY_CONCLUSION') => s.requirements.find((r) => r.code === c)!;
  const contar = async (t: string) => Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM ${sql.table(t)}`.execute(h.db)).rows[0].n);

  let lotA = ''; let plotA = ''; let caseA = '';

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN'); await h.user(ADMIN); await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER)).send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id as string;
    orgA = await mk('Coop Conclusion A', ADMIN); orgB = await mk('Coop Conclusion B', ADMIN_B);
    await join(orgA, ADMIN, E1, 'EUDR_MANAGER'); await join(orgA, ADMIN, AUD, 'AUDITOR'); await join(orgB, ADMIN_B, E_B, 'EUDR_MANAGER');
    producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'CC-1', legal_name: 'Finca Conclusión Sintética' }).expect(201)).body.id;
    baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CCC', name: 'Centro CC', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    plotA = await mkPlot('CC-P1', -80.1601, -0.8479);
    lotA = await lote([plotA]); caseA = await mkCase(lotA);
  }, 240_000);
  afterAll(async () => { await h?.close(); });

  it('QUIÉN: solo el rol EUDR_MANAGER tiene risk:conclude; ningún otro rol lo recibe y no se creó otro rol', () => {
    const roles = Object.entries(ROLE_PERMISSIONS).filter(([, p]) => (p as string[]).includes('risk:conclude')).map(([r]) => r);
    expect(roles).toEqual(['EUDR_MANAGER']);
    expect(Object.keys(ROLE_PERMISSIONS)).toEqual(expect.arrayContaining(['EUDR_MANAGER', 'ORG_ADMIN', 'AUDITOR', 'MANAGER']));
  });

  let ev1 = '';
  it('PERMISOS: quien evalúa/administra (ORG_ADMIN) y el auditor NO registran (403); el responsable EUDR sí consulta; otra organización no ve la evaluación (404)', async () => {
    ev1 = (await evaluar(lotA, ADMIN)).id;
    await concluir(ev1, {}, ADMIN).expect(403);
    await concluir(ev1, {}, AUD).expect(403);
    await http().get(`${base(orgA)}/risk/evaluations/${ev1}/conclusions`).set(as(AUD)).expect(200); // el auditor lee (risk:read)
    const c = await ctxConc(ev1);
    expect(c.can_record).toBe(true);
    expect((await ctxConc(ev1, ADMIN)).can_record).toBe(false);
    // acceso entre organizaciones: el responsable de B no ve ni registra sobre una evaluación de A
    await http().get(`${base(orgB)}/risk/evaluations/${ev1}/conclusions`).set(as(E_B)).expect(404);
    await concluir(ev1, {}, E_B, orgB).expect(404);
    await http().get(`${base(orgB)}/risk/evaluations/${ev1}/conclusions`).set(as(E1)).expect(404); // y el de A no entra a B
  });

  it('CONSULTA: la evaluación con sus LIMITACIONES, qué permite cada resultado y qué falta; el motor no concluye', async () => {
    const c = await ctxConc(ev1);
    expect(c.limitations).toEqual(expect.arrayContaining(['ENGINE_NEVER_CONCLUDES', 'SEVERITY_IS_NOT_CONCLUSION', 'CATEGORIES_WITHOUT_RULES', 'RULES_NOT_EVALUABLE']));
    expect(c.evaluation).toMatchObject({ number: 1, is_latest: true, freshness: { status: 'CURRENT' } });
    expect(c.options.NON_NEGLIGIBLE).toMatchObject({ allowed: true, missing: [] });
    // el catálogo 1.0.0 real no declara perfil jurídico y la organización no lo adoptó: la favorable explica qué falta y se conserva el estado
    expect(c.options.NEGLIGIBLE.allowed).toBe(false);
    expect(c.options.NEGLIGIBLE.missing).toEqual(expect.arrayContaining(['RULE_SET_NOT_ADOPTED', 'PROFILE_REFERENCE_MISSING']));
    expect(c.current).toBeNull();
    expect((await sql<{ c: string }>`SELECT DISTINCT conclusion AS c FROM risk_evaluations`.execute(h.db)).rows.map((r) => r.c)).toEqual(['UNDETERMINED']); // el motor jamás concluye
  });

  it('SIN CONDICIONES: la favorable se rechaza (422) con lo que falta y nada se escribe; faltan motivo/evidencia (400); la evidencia ajena no existe (422)', async () => {
    const antes = await contar('risk_conclusions');
    const r = await concluir(ev1, { result: 'NEGLIGIBLE' }).expect(422);
    expect(r.body.error.code).toBe('CONCLUSION_PRECONDITIONS_NOT_MET');
    expect(r.body.error.details.map((d: { reason: string }) => d.reason)).toEqual(expect.arrayContaining(['PROFILE_REFERENCE_MISSING']));
    await concluir(ev1, { reason: 'corto' }).expect(400);
    await concluir(ev1, { supports: [] }).expect(400);
    await concluir(ev1, { result: 'APPROVED' }).expect(400); // el contrato original solo admite NEGLIGIBLE / NON_NEGLIGIBLE
    expect((await concluir(ev1, { supports: [{ kind: 'DOCUMENT_VERSION', document_version_id: randomUUID() }] }).expect(422)).body.error.code).toBe('REFERENCE_NOT_FOUND');
    expect((await concluir(ev1, { supports: [{ kind: 'CITATION', citation: 'cita', document_version_id: randomUUID() }] }).expect(422)).body.error.code).toBe('CONCLUSION_SUPPORT_INVALID');
    expect(await contar('risk_conclusions')).toBe(antes);
  });

  it('SEPARACIÓN DE FUNCIONES: quien evaluó no concluye (el responsable EUDR evalúa y no puede concluir su propia evaluación); la base lo repite', async () => {
    const propia = (await evaluar(lotA, E1)).id; // E1 evalúa → ya es la evaluación vigente
    const c = await ctxConc(propia);
    expect(c.recorder_is_evaluator).toBe(true);
    expect(c.options.NON_NEGLIGIBLE.missing).toContain('RECORDER_IS_EVALUATOR');
    expect((await concluir(propia).expect(422)).body.error.details.map((d: { reason: string }) => d.reason)).toContain('RECORDER_IS_EVALUATOR');
    const e1id = (await sql<{ id: string }>`SELECT id::text FROM users WHERE email = ${E1}`.execute(h.db)).rows[0].id;
    await expect(h.db.transaction().execute(async (trx) => {
      const e = (await sql<{ subject_id: string; evaluation_number: number; snapshot_hash: string; rule_set_version: string }>`SELECT subject_id::text, evaluation_number, snapshot_hash, rule_set_version FROM risk_evaluations WHERE id = ${propia}`.execute(trx)).rows[0];
      await sql`INSERT INTO risk_conclusions (id, organization_id, evaluation_id, subject_id, evaluation_number, evaluation_snapshot_hash, rule_set_version, result, reason, recorded_by, operation_id)
        VALUES (${randomUUID()}, ${orgA}, ${propia}, ${e.subject_id}, ${e.evaluation_number}, ${e.snapshot_hash}, ${e.rule_set_version}, 'NON_NEGLIGIBLE', 'Intento directo del propio evaluador', ${e1id}, ${randomUUID()})`.execute(trx);
      await sql`INSERT INTO risk_conclusion_supports (id, organization_id, conclusion_id, kind, citation) SELECT ${randomUUID()}, ${orgA}, id, 'CITATION', 'cita sintética' FROM risk_conclusions WHERE operation_id IS NOT NULL ORDER BY recorded_at DESC LIMIT 1`.execute(trx);
    })).rejects.toThrow(/separación de funciones/);
    ev1 = (await evaluar(lotA, ADMIN)).id; // la evaluación vigente vuelve a ser de la administración (número 3)
    expect((await ctxConc(ev1)).evaluation.is_latest).toBe(true);
  });

  let conclA = '';
  it('CASO VÁLIDO (no favorable): se registra con motivo, responsable y evidencias, vinculada a las versiones exactas; el expediente la refleja; retrocede el estado, no lo habilita', async () => {
    const snapAntes = await capturar(caseA);
    expect(req(snapAntes).status).toBe('NOT_EVALUABLE');
    const op = randomUUID();
    const r = await concluir(ev1, { operation_id: op, expected_current_conclusion_id: null }).expect(201);
    conclA = r.body.conclusion.id;
    expect(r.body.replayed).toBe(false);
    const fila = (await sql<{ evaluation_number: number; evaluation_snapshot_hash: string; rule_set_version: string; recorded_by: string; dd_snapshot_number: number | null; dd_content_hash: string | null; legal_review_id: string | null; regulatory_profile: string | null }>`
      SELECT evaluation_number, evaluation_snapshot_hash, rule_set_version, recorded_by::text, dd_snapshot_number, dd_content_hash, legal_review_id::text, regulatory_profile FROM risk_conclusions WHERE id = ${conclA}`.execute(h.db)).rows[0];
    const ev = (await http().get(`${base(orgA)}/risk/evaluations/${ev1}`).set(as(E1)).expect(200)).body;
    expect(fila).toMatchObject({ evaluation_number: 3, evaluation_snapshot_hash: ev.snapshot.hash, rule_set_version: ev.rules.version, legal_review_id: null, regulatory_profile: null });
    expect(fila.dd_snapshot_number).toBe(snapAntes ? 1 : null); // el expediente vigente cuando se decidió
    expect(fila.dd_content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fila.recorded_by).toBe((await sql<{ id: string }>`SELECT id::text FROM users WHERE email = ${E1}`.execute(h.db)).rows[0].id);
    expect(ev.risk_result.conclusion).toBe('UNDETERMINED'); // lo del MOTOR no cambia
    const c = await ctxConc(ev1);
    expect(c.current).toMatchObject({ id: conclA, result: 'NON_NEGLIGIBLE', effective: 'NON_NEGLIGIBLE', valid: true });
    expect(c.history).toHaveLength(1);
    expect(c.history[0].links).toMatchObject({ evaluation_number: 3, rule_set_version: ev.rules.version });
    expect(c.history[0].supports).toHaveLength(1);
    const snap = await capturar(caseA);
    expect(req(snap).status).toBe('INVALID'); // una conclusión no favorable NO es un camino a READY
    expect(snap.readiness.captured).toBe('BLOCKED');
    // idempotencia: el mismo operation_id repite sin duplicar; con otro contenido se rechaza
    const otra = await concluir(ev1, { operation_id: op }).expect(201);
    expect(otra.body.replayed).toBe(true);
    expect(await contar('risk_conclusions')).toBe(1);
    await concluir(ev1, { operation_id: op, result: 'NEGLIGIBLE' }).expect(409);
    // auditoría
    expect(Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM audit_logs WHERE action = 'risk.conclude' AND organization_id = ${orgA}`.execute(h.db)).rows[0].n)).toBe(1);
  });

  it('CONCLUSIÓN POSTERIOR: no borra la anterior; exige ver la vigente (409 si cambió); el historial conserva ambas con su vínculo', async () => {
    await concluir(ev1, { expected_current_conclusion_id: null }).expect(409); // quien aún veía «ninguna»
    const r = await concluir(ev1, { reason: 'Segunda conclusión sintética tras revisar de nuevo la evidencia', expected_current_conclusion_id: conclA }).expect(201);
    const c = await ctxConc(ev1);
    expect(c.history.map((x: { id: string }) => x.id)).toEqual([r.body.conclusion.id, conclA]);
    expect(c.history[0].supersedes_id).toBe(conclA);
    expect(c.history[0].is_latest_record).toBe(true);
    expect(c.history[1].reason).toMatch(/Motivo sintético/); // la anterior sigue ahí, sin cambios
    await expect(sql`UPDATE risk_conclusions SET reason = 'reescrita intencionalmente' WHERE id = ${conclA}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM risk_conclusion_supports WHERE conclusion_id = ${conclA}`.execute(h.db)).rejects.toThrow(/append-only/);
    expect(await contar('risk_conclusions')).toBe(2);
  });

  // ---------------------------------------------------------------- caso favorable con perfil y catálogo SINTÉTICOS
  let evF = ''; let lotF = ''; let plotF = ''; let caseF = ''; let reviewF = ''; let concF = '';
  const P = '/api/v1/platform';
  it('PRECONDICIONES FAVORABLES (sintéticas): perfil jurídico completo y revisado, catálogo vinculado, ambos adoptados → la favorable pasa a ser posible', async () => {
    await sql`INSERT INTO legal_profile_versions (version, jurisdiction, scope, scope_note, covered_matters, pending_matters, technical_status, published_by, reason)
      VALUES ('9.9.9', 'EC', 'COMPLETE', 'Fixture sintética de prueba, sin valor jurídico', ARRAY['TENURE'], ARRAY[]::text[], 'PUBLISHED', 'fixture', 'fixture sintética')`.execute(h.db);
    const rev = (decision: string, supports: unknown[], expected: string | null) => http().post(`${P}/legal-profile/reviews`).set(as(SUPER)).send({
      operation_id: randomUUID(), version: '9.9.9', decision, reviewer_name: 'Persona sintética', reviewer_capacity: 'Fixture', reviewed_on: today, basis: 'Fundamento sintético que no acredita ninguna revisión real', supports, expected_current_review_id: expected });
    reviewF = (await rev('REVIEWED', [{ kind: 'CITATION', citation: 'Cita sintética' }], null).expect(201)).body.review.id;
    await http().post(`${P}/risk-catalog/profile-links`).set(as(SUPER)).send({ operation_id: randomUUID(), base_rule_set_version: '1.0.0', new_rule_set_version: '1.1.0', profile_version: '9.9.9', review_id: reviewF, reason: 'Vinculación sintética de ensayo' }).expect(201);
    await http().post(`${base(orgA)}/legal-profile/adoptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), version: '9.9.9', decision: 'ADOPT', reason: 'Adopción sintética' }).expect(201);
    await http().post(`${base(orgA)}/risk/rule-sets/adoptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), rule_set_version: '1.1.0', decision: 'ADOPT', reason: 'Adopción sintética' }).expect(201);
    plotF = await mkPlot('CC-P2', -80.2, -0.9); lotF = await lote([plotF]); caseF = await mkCase(lotF);
    evF = (await evaluar(lotF, ADMIN)).id;
    const c = await ctxConc(evF);
    expect(c.evaluation.rules).toMatchObject({ version: '1.1.0', adopted: true, regulatory_profile: '9.9.9' });
    expect(c.options.NEGLIGIBLE).toMatchObject({ allowed: true, missing: [] }); // sin impedimentos duros…
    expect(c.options.NEGLIGIBLE.gaps_to_resolve.length).toBeGreaterThan(0); // …pero CADA carencia debe resolverse explícitamente
    expect(c.options.NEGLIGIBLE.gaps_to_resolve).toEqual(expect.arrayContaining([{ scope: 'CATEGORY', code: 'LEGALITY' }, { scope: 'CATEGORY', code: 'HUMAN_RIGHTS' }]));
    expect(c.options.NON_NEGLIGIBLE.gaps_to_resolve).toEqual([]);
    expect(c.limitations).toEqual(expect.arrayContaining(['CATEGORIES_WITHOUT_RULES', 'RULES_NOT_EVALUABLE'])); // las limitaciones se muestran; no impiden registrar
  });

  it('CARENCIAS: mostrar una limitación NO la resuelve; una sola evidencia no resuelve todas; cada carencia exige su propia resolución con justificación y evidencia', async () => {
    const gaps = (await ctxConc(evF)).options.NEGLIGIBLE.gaps_to_resolve as Carencia[];
    const antes = await contar('risk_conclusions');
    const favorable = (over: Record<string, unknown>) => concluir(evF, { result: 'NEGLIGIBLE', reason: 'Conclusión favorable sintética de ensayo con carencias', ...over });
    // 1) una evidencia adjunta y NINGUNA resolución: no se resuelve nada
    const sin = await favorable({}).expect(422);
    expect(sin.body.error.code).toBe('CONCLUSION_GAPS_UNRESOLVED');
    expect(sin.body.error.details.map((d: { reason: string }) => d.reason)).toEqual(expect.arrayContaining(gaps.map((g) => `UNRESOLVED:${g.scope}:${g.code}`)));
    // 2) la misma evidencia referenciada para todas menos una: sigue faltando una
    const casiTodas = resolver(gaps).slice(1);
    const falta = await favorable({ gap_resolutions: casiTodas }).expect(422);
    expect(falta.body.error.code).toBe('CONCLUSION_GAPS_UNRESOLVED');
    expect(falta.body.error.details).toHaveLength(1);
    // 3) justificaciones copiadas: no se acepta la misma para todas
    const copiadas = resolver(gaps).map((r) => ({ ...r, justification: 'La misma justificación copiada para todas las carencias de la evaluación.' }));
    expect((await favorable({ gap_resolutions: copiadas }).expect(422)).body.error.details[0].reason).toMatch(/^DUPLICATE_JUSTIFICATION/);
    // 4) evaluada por una persona con solo una CITA: exige una versión de documento del sistema
    expect((await favorable({ gap_resolutions: resolver(gaps, { kind: 'ASSESSED_BY_HUMAN' }) }).expect(422)).body.error.details[0].reason).toMatch(/^DOCUMENT_REQUIRED/);
    // 5) evidencia inexistente, carencia ajena a la evaluación, justificación corta y resoluciones en una no favorable
    expect((await favorable({ gap_resolutions: resolver(gaps, { support_index: 5 }) }).expect(422)).body.error.details[0].reason).toMatch(/^SUPPORT_INDEX/);
    expect((await favorable({ gap_resolutions: [...resolver(gaps), { scope: 'FACTOR', code: 'NO_EXISTE', kind: 'NOT_APPLICABLE', support_index: 0, justification: 'Justificación sintética de una carencia que no existe en esta evaluación.' }] }).expect(422)).body.error.details[0].reason).toBe('UNKNOWN_GAP');
    await favorable({ gap_resolutions: resolver(gaps).map((r, i) => (i === 0 ? { ...r, justification: 'corta' } : r)) }).expect(400);
    expect((await concluir(evF, { result: 'NON_NEGLIGIBLE', gap_resolutions: resolver(gaps) }).expect(422)).body.error.details[0].reason).toBe('NOT_APPLICABLE_TO_RESULT');
    expect(await contar('risk_conclusions')).toBe(antes); // nada se escribió
    // 6) la base repite el control: una favorable sin resoluciones no puede quedar escrita aunque se salte la API
    const e = (await sql<{ subject_id: string; evaluation_number: number; snapshot_hash: string; rule_set_version: string }>`SELECT subject_id::text, evaluation_number, snapshot_hash, rule_set_version FROM risk_evaluations WHERE id = ${evF}`.execute(h.db)).rows[0];
    const e1id = (await sql<{ id: string }>`SELECT id::text FROM users WHERE email = ${E1}`.execute(h.db)).rows[0].id;
    const rev = (await sql<{ id: string }>`SELECT id::text FROM legal_profile_reviews WHERE version = '9.9.9' ORDER BY decided_at DESC, id DESC LIMIT 1`.execute(h.db)).rows[0].id;
    await expect(h.db.transaction().execute(async (trx) => {
      const cid = randomUUID();
      await sql`INSERT INTO risk_conclusions (id, organization_id, evaluation_id, subject_id, evaluation_number, evaluation_snapshot_hash, rule_set_version, regulatory_profile, legal_profile_version, legal_review_id, result, reason, recorded_by, operation_id)
        VALUES (${cid}, ${orgA}, ${evF}, ${e.subject_id}, ${e.evaluation_number}, ${e.snapshot_hash}, ${e.rule_set_version}, '9.9.9', '9.9.9', ${rev}, 'NEGLIGIBLE', 'Intento directo sin resolver las carencias', ${e1id}, ${randomUUID()})`.execute(trx);
      await sql`INSERT INTO risk_conclusion_supports (id, organization_id, conclusion_id, kind, citation) VALUES (${randomUUID()}, ${orgA}, ${cid}, 'CITATION', 'cita sintética')`.execute(trx);
    })).rejects.toThrow(/resolver cada carencia/);
  });

  it('CASO VÁLIDO (favorable): se registra y el requisito REGULATORY_CONCLUSION pasa a MET; nada más cambia y READY/despacho siguen bloqueados', async () => {
    const antes = await capturar(caseF);
    expect(req(antes).status).toBe('NOT_EVALUABLE');
    const gaps = (await ctxConc(evF)).options.NEGLIGIBLE.gaps_to_resolve as Carencia[];
    const doc = await docVer();
    // La primera carencia la evalúa una persona con un documento del sistema (índice 1); el resto se declara no aplicable, cada una con su justificación y su evidencia.
    const resoluciones = resolver(gaps).map((x, i) => (i === 0 ? { ...x, kind: 'ASSESSED_BY_HUMAN', support_index: 1 } : x));
    const r = await concluir(evF, { result: 'NEGLIGIBLE', reason: 'Conclusión favorable sintética tras revisar la evidencia', supports: [{ kind: 'CITATION', citation: 'Evidencia sintética de ensayo' }, { kind: 'DOCUMENT_VERSION', document_version_id: doc }], gap_resolutions: resoluciones, expected_current_conclusion_id: null }).expect(201);
    concF = r.body.conclusion.id;
    const hist = (await ctxConc(evF)).history[0];
    expect(hist.gap_resolutions).toHaveLength(gaps.length);
    expect(hist.gap_resolutions.find((x: { kind: string }) => x.kind === 'ASSESSED_BY_HUMAN').evidence).toMatchObject({ kind: 'DOCUMENT_VERSION', document_version_id: doc });
    expect(hist.gap_resolutions.filter((x: { kind: string }) => x.kind === 'NOT_APPLICABLE').every((x: { evidence: { kind: string } }) => x.evidence.kind === 'CITATION')).toBe(true);
    await expect(sql`DELETE FROM risk_conclusion_gap_resolutions WHERE conclusion_id = ${concF}`.execute(h.db)).rejects.toThrow(/append-only/);
    const fila = (await sql<{ legal_review_id: string; regulatory_profile: string; legal_profile_version: string; rule_set_version: string }>`SELECT legal_review_id::text, regulatory_profile, legal_profile_version, rule_set_version FROM risk_conclusions WHERE id = ${concF}`.execute(h.db)).rows[0];
    expect(fila).toMatchObject({ legal_review_id: reviewF, regulatory_profile: '9.9.9', legal_profile_version: '9.9.9', rule_set_version: '1.1.0' });
    const despues = await capturar(caseF);
    expect(req(despues)).toMatchObject({ status: 'MET' });
    expect(req(despues).detail).toMatch(/No anula otros requisitos pendientes ni equivale a READY/);
    // todos los demás requisitos conservan su estado: la conclusión no anula pendientes
    const resto = (s: typeof antes) => Object.fromEntries(s.requirements.filter((x) => x.code !== 'REGULATORY_CONCLUSION').map((x) => [x.code, x.status]));
    expect(resto(despues)).toEqual(resto(antes));
    expect(despues.readiness.captured).not.toBe('READY');
    expect(req(despues, 'GEOLOCATION_PROFILE').status).toBe('NOT_EVALUABLE');
    expect(req(despues, 'DEFORESTATION_ANALYSIS').status).toBe('NOT_EVALUABLE');
    // la instantánea previa (UNDETERMINED) queda desactualizada, sin reescribirse
    const previa = (await http().get(`${base(orgA)}/dd-snapshots/${antes.id}`).set(as(E1)).expect(200)).body;
    expect(previa.readiness.effective).toBe('STALE');
    expect(req(previa).status).toBe('NOT_EVALUABLE');
  });

  it('DATOS DESACTUALIZADOS: si cambian los datos de la evaluación, la conclusión deja de valer, no se puede registrar sobre ella y la instantánea previa queda desactualizada', async () => {
    const con = await capturar(caseF);
    expect(req(con).status).toBe('MET');
    const rv = Number((await sql<{ row_version: string }>`SELECT row_version FROM plots WHERE id = ${plotF}`.execute(h.db)).rows[0].row_version);
    await http().post(`${base(orgA)}/plots/${plotF}/geometry-versions`).set(as(ADMIN)).send({ expected_version: rv, survey_method: 'MANUAL_COORDINATES', geometry: point(-80.25, -0.95), area_declared_ha: 2 }).expect(201);
    const c = await ctxConc(evF);
    expect(c.evaluation.freshness.status).toBe('STALE');
    expect(c.current).toMatchObject({ id: concF, result: 'NEGLIGIBLE', effective: 'UNDETERMINED', valid: false });
    expect(c.current.invalid_reasons).toContain('EVALUATION_STALE');
    expect((await concluir(evF, { result: 'NON_NEGLIGIBLE' }).expect(422)).body.error.details.map((d: { reason: string }) => d.reason)).toContain('EVALUATION_STALE');
    const nueva = await capturar(caseF);
    expect(req(nueva).status).toBe('NOT_EVALUABLE');
    expect(req(nueva).detail).toMatch(/NO está vigente/);
    const hist = (await http().get(`${base(orgA)}/dd-snapshots/${con.id}`).set(as(E1)).expect(200)).body;
    expect(req(hist).status).toBe('MET'); // lo capturado se conserva
    expect(hist.readiness.effective).toBe('STALE');
    expect((await ctxConc(evF)).history).toHaveLength(1); // la conclusión histórica se conserva
  });

  it('CAMBIO POSTERIOR: tras reevaluar se registra otra conclusión favorable; una objeción posterior del perfil la invalida (la histórica se conserva)', async () => {
    const ev2 = (await evaluar(lotF, ADMIN)).id;
    expect((await ctxConc(ev2)).options.NEGLIGIBLE.allowed).toBe(true);
    const gaps2 = (await ctxConc(ev2)).options.NEGLIGIBLE.gaps_to_resolve as Carencia[];
    const r = await concluir(ev2, { result: 'NEGLIGIBLE', reason: 'Conclusión favorable sintética sobre la evaluación vigente', gap_resolutions: resolver(gaps2), expected_current_conclusion_id: null }).expect(201);
    const antes = await capturar(caseF);
    expect(req(antes).status).toBe('MET');
    // una revisión posterior OBJETA el perfil jurídico en que se apoyaba
    await http().post(`${P}/legal-profile/reviews`).set(as(SUPER)).send({ operation_id: randomUUID(), version: '9.9.9', decision: 'OBJECTED', reviewer_name: 'Segunda persona', reviewer_capacity: 'Fixture', reviewed_on: today,
      basis: 'Objeción sintética posterior que invalida la condición', supports: [], expected_current_review_id: reviewF }).expect(201);
    const c = await ctxConc(ev2);
    expect(c.current).toMatchObject({ id: r.body.conclusion.id, effective: 'UNDETERMINED', valid: false });
    expect(c.current.invalid_reasons).toEqual(expect.arrayContaining(['LOST_PROFILE_REVIEW_NOT_CURRENT']));
    expect(c.options.NEGLIGIBLE.allowed).toBe(false); // ya no se puede registrar una favorable nueva
    expect(c.options.NON_NEGLIGIBLE.allowed).toBe(true);
    const previa = (await http().get(`${base(orgA)}/dd-snapshots/${antes.id}`).set(as(E1)).expect(200)).body;
    expect(previa.readiness.effective).toBe('STALE');
    expect(req(previa).status).toBe('MET');
    const despues = await capturar(caseF);
    expect(req(despues).status).toBe('NOT_EVALUABLE');
    expect(req(despues).detail).toMatch(/LOST_/);
    expect(Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM risk_conclusions WHERE evaluation_id IN (${evF}, ${ev2})`.execute(h.db)).rows[0].n)).toBe(2); // ambas se conservan
  });

  it('LÍMITES: el motor sigue sin concluir, el catálogo real conserva regulatory_profile NULL y no se concedió nada más', async () => {
    expect((await sql<{ c: string }>`SELECT DISTINCT conclusion AS c FROM risk_evaluations`.execute(h.db)).rows.map((r) => r.c)).toEqual(['UNDETERMINED']);
    expect((await sql<{ p: string | null }>`SELECT regulatory_profile AS p FROM risk_rule_sets WHERE version = '1.0.0'`.execute(h.db)).rows[0].p).toBeNull();
    await expect(sql`INSERT INTO risk_conclusions (id, organization_id, evaluation_id, subject_id, evaluation_number, evaluation_snapshot_hash, rule_set_version, result, reason, recorded_by, operation_id)
      VALUES (${randomUUID()}, ${orgA}, ${evF}, ${lotF}, 1, ${'a'.repeat(64)}, '1.0.0', 'NEGLIGIBLE', 'Intento directo de una favorable sin perfil', ${(await sql<{ id: string }>`SELECT id::text FROM users WHERE email = ${ADMIN}`.execute(h.db)).rows[0].id}, ${randomUUID()})`.execute(h.db)).rejects.toThrow();
  });
});
