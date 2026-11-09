import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { AuditService } from '../src/audit/audit.service';
import { OutboxWorker } from '../src/events/outbox-worker';
import { PRODUCTION_CONSUMERS } from '../src/events/consumers';

// Integración P0-021 Mitigaciones con PostgreSQL, S3, ClamAV y outbox reales. Datos SINTÉTICOS.
describeDb('P0-021 mitigaciones: causa, soportes por versión, separación de funciones y reevaluación', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let producer: string;
  let baba: string;
  let center: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local';
  const E1 = 'eudr1@test.local';
  const E2 = 'eudr2@test.local';
  const TRAZ = 'traz@test.local';
  const mids: Record<string, string> = {};

  async function join(o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(ADMIN)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
    mids[email] = (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', o).executeTakeFirstOrThrow()).id;
  }
  /** Lote de una entrega SIN origen declarado → evaluación BLOCKED (DATA_MISSING_ORIGIN + MATERIAL_OF_UNKNOWN_ORIGIN). */
  async function blockedLot() {
    const d = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: '50', unit: 'KG', register: true }).expect(201)).body.delivery;
    const r = (await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'B', quantity: '50', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    const lot = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r, quantity: '50' }] }).expect(201)).body.lot.id as string;
    const evaluation = (await http().post(`${base(orgA)}/risk/lots/${lot}/evaluations`).set(as(E1)).send({ operation_id: randomUUID() }).expect(201)).body.evaluation;
    return { lot, evaluation };
  }
  const doc = async (opts: { expires?: string } = {}) => {
    const r = http().post(`${base(orgA)}/documents`).set(as(ADMIN)).field('operation_id', randomUUID()).field('document_type', 'DELIVERY_SUPPORT').field('owner_type', 'producer').field('owner_id', producer).field('title', `Soporte mitigación ${randomUUID().slice(0, 4)}`);
    if (opts.expires) r.field('issued_at', '2020-01-01').field('expires_at', opts.expires);
    return (await r.attach('file', Buffer.from(`%PDF-1.4\n% mitigación ${randomUUID()}\n%%EOF\n`), { filename: 's.pdf', contentType: 'application/pdf' }).expect(201)).body.document;
  };
  const create = (evaluation: string, extra: Record<string, unknown> = {}, actor = E2) => http().post(`${base(orgA)}/mitigations`).set(as(actor)).send({
    operation_id: randomUUID(), evaluation_id: evaluation, factor_code: 'DATA_MISSING_ORIGIN', title: 'Completar el origen de la entrega', acceptance_criteria: 'Parcela de origen declarada con soporte documental vigente', assignee_membership_id: mids[E1], due_date: '2026-12-31', ...extra });
  const support = (id: string, body: Record<string, unknown>, actor = E1) => http().post(`${base(orgA)}/mitigations/${id}/supports`).set(as(actor)).send({ operation_id: randomUUID(), ...body });
  const get = async (id: string, actor = E2) => (await http().get(`${base(orgA)}/mitigations/${id}`).set(as(actor)).expect(200)).body;
  const submit = async (id: string, actor = E1) => http().post(`${base(orgA)}/mitigations/${id}/submit`).set(as(actor)).send({ operation_id: randomUUID(), expected_version: (await get(id)).row_version, note: 'Soporte aportado' });
  const decide = async (id: string, decision: string, actor = E2, reason = 'Revisado contra el criterio de aceptación') => http().post(`${base(orgA)}/mitigations/${id}/decisions`).set(as(actor)).send({ operation_id: randomUUID(), expected_version: (await get(id)).row_version, decision, reason, ...(decision === 'VERIFIED' ? { criterion_met: true } : {}) });
  const drain = async () => { const w = new OutboxWorker(h.db, PRODUCTION_CONSUMERS, { workerId: 'mitig', backoffBaseMs: 1 }); for (let i = 0; i < 30; i++) if ((await w.runOnce()).claimed === 0) break; };

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Mitigación A', ADMIN);
    orgB = await mk('Coop Mitigación B', 'admin-b@test.local');
    for (const [e, r] of [[E1, 'EUDR_MANAGER'], [E2, 'EUDR_MANAGER'], [TRAZ, 'TRACEABILITY_MANAGER'], ['auditor@test.local', 'AUDITOR'], ['tecnico@test.local', 'FIELD_TECHNICIAN']]) await join(orgA, e, r);
    producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'MT-1', legal_name: 'Finca Mitigación' }).expect(201)).body.id;
    baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CM', name: 'Centro mitigación', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());
  afterEach(() => jest.restoreAllMocks());

  it('acción ligada a evaluación, factor y recurso; responsable elegible de la organización; causas no mitigables y referencias cruzadas rechazadas; permisos', async () => {
    const { lot, evaluation } = await blockedLot();
    expect((await create(evaluation.id, { factor_code: 'GEOLOCATION_PROFILE' }).expect(422)).body.error.code).toBe('CAUSE_NOT_ACTIONABLE'); // D-05: no se simula
    expect((await create(evaluation.id, { factor_code: 'NO_EXISTE' }).expect(422)).body.error.code).toBe('FACTOR_NOT_IN_EVALUATION');
    expect((await create(evaluation.id, { assignee_membership_id: mids['tecnico@test.local'] }).expect(422)).body.error.code).toBe('ASSIGNEE_NOT_ELIGIBLE');
    const bAdmin = (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', 'admin-b@test.local').executeTakeFirstOrThrow()).id;
    expect((await create(evaluation.id, { assignee_membership_id: bAdmin }).expect(422)).body.error.code).toBe('ASSIGNEE_NOT_ELIGIBLE');
    await create(randomUUID()).expect(404);
    await create(evaluation.id, {}, 'auditor@test.local').expect(403);
    await create(evaluation.id, {}, TRAZ).expect(403);
    const m = (await create(evaluation.id).expect(201)).body.mitigation;
    expect(m).toMatchObject({ status: 'OPEN', cause: { evaluation_id: evaluation.id, factor_code: 'DATA_MISSING_ORIGIN', subject: { id: lot }, factor: { result: 'HIT' } }, assignee: { membership_id: mids[E1] }, due_date: '2026-12-31',
      evidence_required: 'Origen declarado de cada entrega' }); // texto del catálogo 1.0.0 (D-07, migración 0043)
    expect(JSON.stringify(m)).not.toMatch(/Finca Mitigación|latitude|coordinates/);
    await http().get(`${base(orgA)}/mitigations/${m.id}`).set(as('auditor@test.local')).expect(200);
    await http().get(`${base(orgA)}/mitigations`).set(as('tecnico@test.local')).expect(403);
    await http().get(`${base(orgA)}/mitigations/${m.id}`).set(as('admin-b@test.local')).expect(404);
    await http().get(`${base(orgB)}/mitigations/${m.id}`).set(as('admin-b@test.local')).expect(404);
    expect((await http().get(`${base(orgA)}/mitigations?lot_id=${lot}`).set(as('auditor@test.local')).expect(200)).body).toHaveLength(1);
  });

  it('soportes por versión exacta; inválidos rechazados; adjuntar no verifica; auto-verificación bloqueada (también en base); rechazo con motivo y nueva entrega', async () => {
    const { evaluation } = await blockedLot();
    const m = (await create(evaluation.id).expect(201)).body.mitigation;
    expect((await support(m.id, { document_version_id: (await doc()).versions[0].id }, E2).expect(403)).body.error.code).toBe('NOT_ASSIGNEE');
    expect((await support(m.id, { document_version_id: (await doc({ expires: '2020-12-31' })).versions[0].id }).expect(422)).body.error.code).toBe('SUPPORT_EXPIRED');
    await support(m.id, { document_version_id: randomUUID() }).expect(404);
    await support(m.id, {}).expect(400);
    expect((await submit(m.id)).status).toBe(422); // sin soportes no se entrega
    const d1 = await doc();
    const withSupport = (await support(m.id, { document_version_id: d1.versions[0].id }).expect(201)).body.mitigation;
    expect(withSupport).toMatchObject({ status: 'OPEN', supports: [expect.objectContaining({ document_version_id: d1.versions[0].id, version_number: 1, availability: 'AVAILABLE', submission_number: 1 })] }); // adjuntar no verifica
    expect((await submit(m.id)).status).toBe(201);
    expect((await support(m.id, { document_version_id: d1.versions[0].id }).expect(409)).body.error.code).toBe('MITIGATION_NOT_EDITABLE');
    // el ejecutor (con permiso de verificar) no verifica ni rechaza su propia entrega
    expect((await (await decide(m.id, 'VERIFIED', E1)).body).error.code).toBe('SELF_VERIFICATION_NOT_ALLOWED');
    const sub = await h.db.selectFrom('mitigation_submissions').select(['submitted_by', 'organization_id']).where('action_id', '=', m.id).executeTakeFirstOrThrow();
    await expect(sql`INSERT INTO mitigation_decisions (id, organization_id, action_id, submission_number, decision, reason, decided_by, operation_id) VALUES (${randomUUID()}, ${orgA}, ${m.id}, 1, 'VERIFIED', 'x x x', ${sub.submitted_by}, ${randomUUID()})`.execute(h.db)).rejects.toThrow(/no verifica su propia mitigación/);
    await (await decide(m.id, 'VERIFIED', 'auditor@test.local')).body; // sin permiso
    expect((await decide(m.id, 'VERIFIED', 'auditor@test.local')).status).toBe(403);
    const rejected = (await (await decide(m.id, 'REJECTED', E2, 'El documento no muestra la parcela de origen')).body).mitigation;
    expect(rejected).toMatchObject({ status: 'REJECTED', decisions: [expect.objectContaining({ decision: 'REJECTED', reason: 'El documento no muestra la parcela de origen' })] });
    expect(rejected.supports).toHaveLength(1); // el rechazo conserva soporte y motivo
    await support(m.id, { document_version_id: (await doc()).versions[0].id }).expect(201);
    expect((await submit(m.id)).status).toBe(201);
    const second = await get(m.id);
    expect(second.submissions.map((s: { number: number }) => s.number)).toEqual([1, 2]);
    expect(second.supports.map((s: { submission_number: number }) => s.submission_number)).toEqual([1, 2]);
    await expect(sql`DELETE FROM mitigation_supports WHERE action_id = ${m.id}`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('verificar dispara reevaluación por outbox; el otro bloqueo se conserva; la causa no se da por resuelta; cambio de versión pide revisión sin modificar el registro', async () => {
    const { lot, evaluation } = await blockedLot();
    const m = (await create(evaluation.id).expect(201)).body.mitigation;
    // revisión de riesgo: no puede resolverse con la mitigación abierta
    await http().post(`${base(orgA)}/risk/evaluations/${evaluation.id}/reviews`).set(as(E2)).send({ operation_id: randomUUID(), action: 'START_REVIEW', reason: 'Revisión' }).expect(201);
    expect((await http().post(`${base(orgA)}/risk/evaluations/${evaluation.id}/reviews`).set(as(E2)).send({ operation_id: randomUUID(), action: 'RESOLVE', reason: 'Fin' }).expect(409)).body.error.code).toBe('MITIGATION_UNVERIFIED');
    const d = await doc();
    await support(m.id, { document_version_id: d.versions[0].id }).expect(201);
    expect((await submit(m.id)).status).toBe(201);
    const v = (await (await decide(m.id, 'VERIFIED')).body).mitigation;
    expect(v).toMatchObject({ status: 'VERIFIED', reevaluation: { status: 'PENDING' }, decisions: [expect.objectContaining({ decision: 'VERIFIED', verifier: expect.stringMatching(/eudr2/) })], submissions: [expect.objectContaining({ executor: expect.stringMatching(/eudr1/) })] });
    expect(await h.db.selectFrom('domain_events').select('event_type').where('aggregate_id', '=', m.id).where('event_type', '=', 'MitigationVerified').execute()).toHaveLength(1);
    await drain();
    const after = await get(m.id);
    expect(after.reevaluation).toMatchObject({ status: 'DONE', evaluation_number: 2 });
    const reev = (await http().get(`${base(orgA)}/risk/evaluations/${after.reevaluation.evaluation_id}`).set(as(E2)).expect(200)).body;
    expect(reev.trigger).toMatchObject({ kind: 'MITIGATION_VERIFIED', action_id: m.id });
    expect(reev.technical_result.status).toBe('BLOCKED'); // la causa (origen faltante) sigue en los datos: verificar no la resuelve
    expect(reev.factors.find((f: { code: string }) => f.code === 'DATA_MISSING_ORIGIN').result).toBe('HIT');
    expect(reev.factors.find((f: { code: string }) => f.code === 'MITIGATION_UNVERIFIED').result).toBe('NOT_HIT');
    expect(reev.risk_result).toMatchObject({ severity: 'NOT_ASSESSED', conclusion: 'UNDETERMINED' });
    // Verificar una mitigación no cambia el catálogo ni lo adopta: la reevaluación sigue sin clasificar.
    expect(reev.rules).toMatchObject({ adopted_by_organization: false, regulatory_profile: null });
    // reproceso del outbox: no duplica la reevaluación
    await drain();
    expect((await sql<{ n: number }>`SELECT count(*)::int AS n FROM risk_evaluations WHERE subject_id = ${lot}`.execute(h.db)).rows[0].n).toBe(2);
    // nueva versión del soporte verificado: pide revisión; el soporte sigue siendo la versión 1
    await http().post(`${base(orgA)}/documents/${d.id}/versions`).set(as(ADMIN)).field('operation_id', randomUUID()).attach('file', Buffer.from(`%PDF-1.4\n% v2 ${randomUUID()}\n%%EOF\n`), { filename: 's2.pdf', contentType: 'application/pdf' }).expect(201);
    const changed = await get(m.id);
    expect(changed.requires_review).toEqual([expect.stringMatching(/versión más reciente.*no sustituye/)]);
    expect(changed.supports[0]).toMatchObject({ version_number: 1, newer_version_exists: true });
    expect(changed.status).toBe('VERIFIED');
  });

  it('verificar exige declarar el criterio; corrección revisada si el criterio no se cumple: decisión conservada, acción reabierta, reevaluación con procedencia separada', async () => {
    const { evaluation } = await blockedLot();
    const m = (await create(evaluation.id).expect(201)).body.mitigation;
    await support(m.id, { document_version_id: (await doc()).versions[0].id }).expect(201);
    expect((await submit(m.id)).status).toBe(201);
    const noCriterion = await http().post(`${base(orgA)}/mitigations/${m.id}/decisions`).set(as(E2)).send({ operation_id: randomUUID(), expected_version: (await get(m.id)).row_version, decision: 'VERIFIED', reason: 'Soporte correcto' }).expect(422);
    expect(noCriterion.body.error.code).toBe('CRITERION_CONFIRMATION_REQUIRED');
    const v = (await (await decide(m.id, 'VERIFIED')).body).mitigation;
    expect(v.outcome).toMatchObject({ support: { status: 'ACCEPTED' }, action: { status: 'CRITERION_MET' } });
    await drain();
    const verified = await get(m.id);
    expect(verified.outcome.cause.status).toBe('PERSISTS'); // el origen sigue faltando: la causa no se resuelve
    expect(verified.outcome.warning).toMatch(/causa persiste/);
    // Corrección: no el ejecutor; con motivo; la decisión original se conserva.
    const corr = (actor: string, body: Record<string, unknown> = {}) => http().post(`${base(orgA)}/mitigations/${m.id}/corrections`).set(as(actor))
      .send({ operation_id: randomUUID(), expected_version: verified.row_version, support_accepted: true, reason: 'El documento no identifica la parcela de origen: el criterio no se cumple.', ...body });
    expect((await corr(E1).expect(403)).body.error.code).toBe('SELF_VERIFICATION_NOT_ALLOWED');
    await corr('auditor@test.local').expect(403);
    await expect(sql`UPDATE mitigation_actions SET status = 'OPEN' WHERE id = ${m.id}`.execute(h.db)).rejects.toThrow(/solo se reabre con una corrección/);
    const c = (await corr(E2).expect(201)).body.mitigation;
    expect(c).toMatchObject({ status: 'REOPENED', outcome: { support: { status: 'ACCEPTED' }, action: { status: 'CRITERION_NOT_MET' }, cause: { status: 'PERSISTS' } } });
    expect(c.decisions).toEqual([expect.objectContaining({ decision: 'VERIFIED', criterion_met: true })]);
    expect(c.corrections).toEqual([expect.objectContaining({ support_accepted: true, criterion_met: false, corrected_by: expect.stringMatching(/eudr2/) })]);
    expect((await corr(E2).expect(409)).body.error.code).toBe('INVALID_TRANSITION');
    await expect(sql`DELETE FROM mitigation_corrections WHERE action_id = ${m.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    // Reabierta: el responsable puede aportar una nueva entrega (número 2).
    await support(m.id, { document_version_id: (await doc()).versions[0].id }).expect(201);
    expect((await get(m.id)).supports.map((x: { submission_number: number }) => x.submission_number)).toEqual([1, 2]);
    // Reevaluación tras la corrección: desencadenada por la verificadora, ejecutada por el worker, revisión humana aparte.
    await drain();
    const ev = (await sql<{ id: string }>`SELECT id FROM risk_evaluations WHERE trigger->>'kind' = 'MITIGATION_VERIFICATION_CORRECTED' AND trigger->>'action_id' = ${m.id}`.execute(h.db)).rows[0];
    const reev = (await http().get(`${base(orgA)}/risk/evaluations/${ev.id}`).set(as(E2)).expect(200)).body;
    expect(reev.provenance).toMatchObject({ mode: 'AUTOMATIC', trigger_kind: 'MITIGATION_VERIFICATION_CORRECTED', triggered_by: expect.stringMatching(/eudr2/), executed_by: expect.stringMatching(/worker de reevaluación/), reviewed_by: null, review_status: 'OPEN' });
    expect(reev.factors.find((f: { code: string }) => f.code === 'MITIGATION_UNVERIFIED').result).toBe('HIT');
  });

  it('reevaluación atrasada no sustituye una evaluación posterior; decisiones concurrentes; doble envío; rollback', async () => {
    const { lot, evaluation } = await blockedLot();
    const m = (await create(evaluation.id).expect(201)).body.mitigation;
    await support(m.id, { document_version_id: (await doc()).versions[0].id }).expect(201);
    // doble envío con el mismo identificador
    const op = randomUUID();
    const version = (await get(m.id)).row_version;
    const s1 = (await http().post(`${base(orgA)}/mitigations/${m.id}/submit`).set(as(E1)).send({ operation_id: op, expected_version: version, note: 'Entrega' }).expect(201)).body;
    const s2 = (await http().post(`${base(orgA)}/mitigations/${m.id}/submit`).set(as(E1)).send({ operation_id: op, expected_version: version, note: 'Entrega' }).expect(201)).body;
    expect(s2.replayed).toBe(true);
    expect(s1.mitigation.submissions).toHaveLength(1);
    // rollback: si falla la auditoría, ni decisión, ni cambio de estado, ni evento
    const before = await sql<{ d: number; e: number }>`SELECT (SELECT count(*)::int FROM mitigation_decisions) d, (SELECT count(*)::int FROM domain_events) e`.execute(h.db);
    jest.spyOn(AuditService.prototype, 'record').mockRejectedValueOnce(new Error('fallo forzado'));
    expect((await decide(m.id, 'VERIFIED')).status).toBe(500);
    expect((await sql<{ d: number; e: number }>`SELECT (SELECT count(*)::int FROM mitigation_decisions) d, (SELECT count(*)::int FROM domain_events) e`.execute(h.db)).rows[0]).toEqual(before.rows[0]);
    expect((await get(m.id)).status).toBe('SUBMITTED');
    // decisiones concurrentes de dos verificadores: una gana
    const v = (await get(m.id)).row_version;
    const [a, b] = await Promise.all([
      http().post(`${base(orgA)}/mitigations/${m.id}/decisions`).set(as(E2)).send({ operation_id: randomUUID(), expected_version: v, decision: 'VERIFIED', reason: 'Correcto', criterion_met: true }),
      http().post(`${base(orgA)}/mitigations/${m.id}/decisions`).set(as(ADMIN)).send({ operation_id: randomUUID(), expected_version: v, decision: 'REJECTED', reason: 'Incompleto' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await get(m.id)).decisions).toHaveLength(1);
    // reevaluación atrasada (determinista): segunda mitigación verificada; una evaluación manual posterior llega antes que el outbox
    await drain();
    const m2 = (await create(evaluation.id, { factor_code: 'MATERIAL_OF_UNKNOWN_ORIGIN', title: 'Separar material de origen incompleto' }).expect(201)).body.mitigation;
    await support(m2.id, { document_version_id: (await doc()).versions[0].id }).expect(201);
    expect((await submit(m2.id)).status).toBe(201);
    expect((await decide(m2.id, 'VERIFIED')).status).toBe(201);
    const triggered = async () => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM risk_evaluations WHERE subject_id = ${lot} AND trigger->>'action_id' = ${m2.id}`.execute(h.db)).rows[0].n;
    await http().post(`${base(orgA)}/risk/lots/${lot}/evaluations`).set(as(E2)).send({ operation_id: randomUUID() }).expect(201);
    await drain();
    expect(await triggered()).toBe(0);
    expect((await get(m2.id)).reevaluation.status).toBe('SUPERSEDED');
  });

  // QA-11 + P1-003 — «cola actualizada por acción real». La cola de Mi trabajo tiene que moverse por el ciclo de
  // vida del dominio, no por marcar nada en la portada, y la separación de funciones tiene que notarse en ella.
  it('P1-003/QA-11 la cola de Mi trabajo se mueve con el ciclo real de la mitigación, y respeta la separación de funciones', async () => {
    interface FilaW { code: string; queue: string; entity: { id: string }; due_date: string | null; due_state: string; priority: string; priority_rule: string; status: string; evidence_required: string | null }
    const cola = async (actor: string, query = '') => (await http().get(`${base(orgA)}/my-work${query}`).set(as(actor)).expect(200)).body as { queues: { mine: number; supervision: number }; rows: FilaW[] };
    const fila = async (actor: string, id: string, query = '') => (await cola(actor, query)).rows.find((r) => r.entity.id === id);

    const { evaluation } = await blockedLot();
    const m = (await create(evaluation.id).expect(201)).body.mitigation;

    // 1) Creada y asignada: aparece en la cola PERSONAL del responsable, con el plazo REAL del dominio.
    const asignada = await fila(E1, m.id);
    expect(asignada).toMatchObject({ code: 'MITIGATIONS_ASSIGNED', queue: 'MINE', status: 'OPEN', due_date: '2026-12-31', due_state: 'SCHEDULED' });
    expect(asignada!.evidence_required).toBeTruthy();
    expect(asignada!.priority_rule).toMatch(/Vence el 2026-12-31/);
    // Quien la creó no la tiene como trabajo propio: todavía no hay nada que verificar.
    expect(await fila(E2, m.id)).toBeUndefined();

    // 2) Acción real del dominio: aportar soporte NO la saca de la cola (adjuntar no es haber terminado).
    await support(m.id, { document_version_id: (await doc()).versions[0].id }).expect(201);
    expect(await fila(E1, m.id)).toMatchObject({ queue: 'MINE', status: 'OPEN' });

    // 3) Entregar sí: sale de la cola personal del ejecutor y entra en la de SUPERVISIÓN de otra persona.
    expect((await submit(m.id)).status).toBe(201);
    expect(await fila(E1, m.id)).toBeUndefined();
    const porVerificar = await fila(E2, m.id);
    expect(porVerificar).toMatchObject({ code: 'MITIGATIONS_TO_VERIFY', queue: 'SUPERVISION', status: 'SUBMITTED' });
    expect((await cola(E2)).queues.supervision).toBeGreaterThan(0);
    // Separación de funciones: quien entregó NO se la encuentra para verificar, ni filtrando.
    expect(await fila(E1, m.id, '?queue=SUPERVISION')).toBeUndefined();
    expect(await fila(E1, m.id, '?status=SUBMITTED')).toBeUndefined();

    // 4) Verificar es otra acción real del dominio: la fila desaparece de las dos colas.
    expect((await decide(m.id, 'VERIFIED', E2)).status).toBe(201);
    expect(await fila(E2, m.id)).toBeUndefined();
    expect(await fila(E1, m.id)).toBeUndefined();
  });
});
