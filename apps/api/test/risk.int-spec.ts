import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { AuthorizationService } from '../src/authz/authorization.service';

// Integración P0-020 Riesgo con PostgreSQL, S3 y ClamAV reales. Datos SINTÉTICOS. Reglas de docs/13 NO APROBADAS:
// sin pesos, umbrales ni severidades; conclusión regulatoria siempre UNDETERMINED.
describeDb('P0-020 evaluación técnica de riesgo: reglas, instantánea, versiones y revisión', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let producer: string;
  let plot: string;
  let baba: string;
  let center: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local';
  const EUDR = 'eudr@test.local';

  async function join(o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(ADMIN)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  /** Lote de una recepción; `origin` = con parcela de origen declarada. Devuelve ids del lote y la entrega. */
  async function lot(origin: boolean, q = '100') {
    const d = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: q, unit: 'KG', origins: origin ? [{ plot_id: plot }] : [], register: true }).expect(201)).body.delivery;
    const r = (await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'B', quantity: q, unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    const l = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r, quantity: q }] }).expect(201)).body.lot;
    return { lot: l.id as string, delivery: d.id as string, code: d.delivery_code as string };
  }
  const evaluate = (lotId: string, actor = EUDR, extra: Record<string, unknown> = {}) => http().post(`${base(orgA)}/risk/lots/${lotId}/evaluations`).set(as(actor)).send({ operation_id: randomUUID(), ...extra });
  const factor = (e: { factors: Array<{ code: string }> }, code: string) => e.factors.find((f) => f.code === code) as unknown as { result: string; effect: string; reason: string; references: string[] };

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Riesgo A', ADMIN);
    orgB = await mk('Coop Riesgo B', 'admin-b@test.local');
    for (const [e, r] of [[EUDR, 'EUDR_MANAGER'], ['auditor@test.local', 'AUDITOR'], ['traz@test.local', 'TRACEABILITY_MANAGER'], ['tecnico@test.local', 'FIELD_TECHNICIAN'], ['export@test.local', 'EXPORT_MANAGER']]) await join(orgA, e, r);
    producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'RK-1', legal_name: 'Finca Riesgo' }).expect(201)).body.id;
    plot = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: 'RK-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CR', name: 'Centro riesgo', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());
  afterEach(() => jest.restoreAllMocks());

  it('faltantes y reglas no evaluables nunca dan un resultado favorable; dimensiones separadas; sin puntuación ni severidad inventada', async () => {
    const { lot: l } = await lot(true);
    const e = (await evaluate(l).expect(201)).body.evaluation;
    expect(e.technical_result.status).toBe('INCOMPLETE');
    expect(e.risk_result).toMatchObject({ severity: 'NOT_ASSESSED', conclusion: 'UNDETERMINED' });
    // Catálogo 1.0.0 (migración 0043): publicado globalmente y APROBADO, pero esta organización no lo ha adoptado,
    // y ninguna versión está aprobada bajo perfil jurídico. Por eso no hay severidad ni conclusión.
    expect(e.rules).toMatchObject({ version: '1.0.0', approval_status: 'APPROVED', global_publication: 'APPROVED', adopted_by_organization: false, regulatory_profile: null });
    expect(e.review.process_status).toBe('OPEN');
    expect(factor(e, 'DATA_MISSING_ORIGIN').result).toBe('NOT_HIT');
    expect(factor(e, 'MASS_BALANCE_INCONSISTENT').result).toBe('NOT_HIT');
    for (const code of ['GEOMETRY_INVALID', 'GEOLOCATION_PROFILE', 'SATELLITE_COVERAGE_UNKNOWN', 'DOCUMENT_EXPIRED']) expect(factor(e, code).result).toBe('NOT_EVALUABLE');
    expect(factor(e, 'MITIGATION_UNVERIFIED').result).toBe('NOT_HIT'); // P0-021: sin mitigaciones abiertas
    expect(factor(e, 'GEOLOCATION_PROFILE').reason).toMatch(/D-05/);
    expect(factor(e, 'SATELLITE_COVERAGE_UNKNOWN').reason).toMatch(/no prueba ausencia de deforestación/i);
    expect(factor(e, 'GEOMETRY_INVALID').reason).toMatch(/no se presume válida/);
    expect(e.data_quality.map((f: { code: string }) => f.code).sort()).toEqual(['DOCUMENT_EXPIRED', 'GEOLOCATION_PROFILE', 'GEOMETRY_INVALID', 'SATELLITE_COVERAGE_UNKNOWN']);
    expect(e.technical_findings).toEqual([]);
    expect(e.categories.find((c: { category: string }) => c.category === 'LEGALITY')).toMatchObject({ status: 'NO_RULES' });
    expect(e.parameters).toMatchObject({ weights: null, thresholds: null });
    expect(e.snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(e)).not.toMatch(/"score"|Finca Riesgo|latitude|coordinates/);
  });

  it('un factor bloqueante no se diluye: origen faltante bloquea aunque el resto no tenga hallazgos; documento vencido requiere revisión', async () => {
    const { lot: l, code } = await lot(false);
    const e = (await evaluate(l).expect(201)).body.evaluation;
    expect(e.technical_result.status).toBe('BLOCKED');
    expect(factor(e, 'DATA_MISSING_ORIGIN')).toMatchObject({ result: 'HIT', effect: 'BLOCKING', references: [code] });
    expect(factor(e, 'MATERIAL_OF_UNKNOWN_ORIGIN')).toMatchObject({ result: 'HIT', effect: 'BLOCKING' });
    expect(e.technical_findings.map((f: { code: string }) => f.code).sort()).toEqual(['DATA_MISSING_ORIGIN', 'MATERIAL_OF_UNKNOWN_ORIGIN']);
    expect(e.risk_result.severity).toBe('NOT_ASSESSED');
    // documento vencido (sintético) vinculado como soporte → hallazgo de revisión; no reduce el bloqueo
    const known = await lot(true);
    const doc = (await http().post(`${base(orgA)}/documents`).set(as(ADMIN)).field('operation_id', randomUUID()).field('document_type', 'DELIVERY_SUPPORT').field('owner_type', 'producer').field('owner_id', producer)
      .field('title', 'Nota vencida (sintética)').field('issued_at', '2020-01-01').field('expires_at', '2020-12-31').attach('file', Buffer.from(`%PDF-1.4\n% riesgo ${randomUUID()}\n%%EOF\n`), { filename: 'n.pdf', contentType: 'application/pdf' }).expect(201)).body.document;
    await http().post(`${base(orgA)}/deliveries/${known.delivery}/supports`).set(as(ADMIN)).send({ operation_id: randomUUID(), document_version_id: doc.versions[0].id, support_kind: 'DELIVERY_NOTE' }).expect(201);
    const e2 = (await evaluate(known.lot).expect(201)).body.evaluation;
    expect(factor(e2, 'DOCUMENT_EXPIRED')).toMatchObject({ result: 'HIT', effect: 'REVIEW_REQUIRED', references: [known.code] });
    expect(e2.technical_result.status).toBe('REVIEW_REQUIRED');
    // descuadre del ledger en el grafo → bloqueo (inyectado por fuera: el sistema no lo cuadra con ajustes)
    await h.db.transaction().execute(async (trx) => {
      const mid = randomUUID();
      await sql`INSERT INTO stock_movements (id, organization_id, movement_type, operation_id) VALUES (${mid}, ${orgA}, 'TRANSFER', ${randomUUID()})`.execute(trx);
      await sql`INSERT INTO stock_entries (id, organization_id, movement_id, lot_id, location_id, bucket, signed_quantity, unit) VALUES (${randomUUID()}, ${orgA}, ${mid}, ${known.lot}, ${center}, 'PHYSICAL', 1, 'KG')`.execute(trx);
    });
    const e3 = (await evaluate(known.lot).expect(201)).body.evaluation;
    expect(factor(e3, 'MASS_BALANCE_INCONSISTENT').result).toBe('HIT');
    expect(e3.technical_result.status).toBe('BLOCKED'); // por precedencia, no por promedio
  });

  it('reevaluación crea una versión nueva; la anterior queda desactualizada sin modificarse; un trabajo antiguo no pisa uno nuevo; idempotencia', async () => {
    const { lot: l, delivery } = await lot(true);
    const e1 = (await evaluate(l).expect(201)).body.evaluation;
    expect(e1).toMatchObject({ evaluation_number: 1, is_latest: true, freshness: { status: 'CURRENT' } });
    // cambia la evidencia del grafo (nuevo soporte) → e1 STALE
    const doc = (await http().post(`${base(orgA)}/documents`).set(as(ADMIN)).field('operation_id', randomUUID()).field('document_type', 'DELIVERY_SUPPORT').field('owner_type', 'producer').field('owner_id', producer)
      .field('title', 'Nota vigente (sintética)').attach('file', Buffer.from(`%PDF-1.4\n% riesgo ${randomUUID()}\n%%EOF\n`), { filename: 'n.pdf', contentType: 'application/pdf' }).expect(201)).body.document;
    await http().post(`${base(orgA)}/deliveries/${delivery}/supports`).set(as(ADMIN)).send({ operation_id: randomUUID(), document_version_id: doc.versions[0].id, support_kind: 'DELIVERY_NOTE' }).expect(201);
    const old = (await http().get(`${base(orgA)}/risk/evaluations/${e1.id}`).set(as(EUDR)).expect(200)).body;
    expect(old.freshness).toMatchObject({ status: 'STALE', reason: expect.stringMatching(/reevalúa/) });
    expect(old.snapshot.hash).toBe(e1.snapshot.hash); // no se modificó
    const e2 = (await evaluate(l, EUDR, { based_on_evaluation_id: e1.id }).expect(201)).body.evaluation;
    expect(e2).toMatchObject({ evaluation_number: 2, freshness: { status: 'CURRENT' } });
    expect(factor(e2, 'DOCUMENT_EXPIRED').result).toBe('NOT_HIT');
    expect(e2.snapshot.hash).not.toBe(e1.snapshot.hash);
    expect((await evaluate(l, EUDR, { based_on_evaluation_id: e1.id }).expect(409)).body.error.code).toBe('STALE_BASE');
    const hist = (await http().get(`${base(orgA)}/risk/lots/${l}`).set(as(EUDR)).expect(200)).body;
    expect(hist.history.map((x: { evaluation_number: number; freshness: { status: string } }) => `${x.evaluation_number}:${x.freshness.status}`)).toEqual(['2:CURRENT', '1:STALE']);
    await expect(sql`UPDATE risk_evaluations SET technical_result = 'NO_FINDINGS_IN_EVALUATED_RULES' WHERE id = ${e1.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`UPDATE risk_evaluations SET conclusion = 'NEGLIGIBLE' WHERE id = ${e1.id}`.execute(h.db)).rejects.toThrow();
    const op = randomUUID();
    const a = (await http().post(`${base(orgA)}/risk/lots/${l}/evaluations`).set(as(EUDR)).send({ operation_id: op }).expect(201)).body;
    const b = (await http().post(`${base(orgA)}/risk/lots/${l}/evaluations`).set(as(EUDR)).send({ operation_id: op }).expect(201)).body;
    expect(b).toMatchObject({ replayed: true, evaluation: { id: a.evaluation.id } });
  });

  it('revisión humana separada: iniciar y resolver con motivo; no cambia el resultado técnico ni la conclusión', async () => {
    const { lot: l } = await lot(false);
    const e = (await evaluate(l).expect(201)).body.evaluation;
    const review = (action: string, actor = EUDR) => http().post(`${base(orgA)}/risk/evaluations/${e.id}/reviews`).set(as(actor)).send({ operation_id: randomUUID(), action, reason: 'Revisión del origen faltante' });
    expect((await review('RESOLVE').expect(409)).body.error.code).toBe('INVALID_TRANSITION');
    await review('START_REVIEW', 'auditor@test.local').expect(403);
    expect((await review('START_REVIEW').expect(201)).body.evaluation.review.process_status).toBe('UNDER_REVIEW');
    const resolved = (await review('RESOLVE').expect(201)).body.evaluation;
    expect(resolved.review).toMatchObject({ process_status: 'RESOLVED', history: [expect.objectContaining({ action: 'START_REVIEW' }), expect.objectContaining({ action: 'RESOLVE' })] });
    expect(resolved.technical_result.status).toBe('BLOCKED');
    expect(resolved.risk_result).toMatchObject({ severity: 'NOT_ASSESSED', conclusion: 'UNDETERMINED' });
    expect(resolved.actions.review).toBe(false);
  });

  it('autorización: alcance de organización completo, otra organización, roles sin permiso; sin fugas', async () => {
    const { lot: l } = await lot(true);
    await evaluate(l, 'auditor@test.local').expect(403); // el auditor lee, no evalúa
    const e = (await evaluate(l, ADMIN).expect(201)).body.evaluation;
    await http().get(`${base(orgA)}/risk/evaluations/${e.id}`).set(as('auditor@test.local')).expect(200);
    await http().get(`${base(orgA)}/risk/evaluations/${e.id}`).set(as('traz@test.local')).expect(200);
    await http().get(`${base(orgA)}/risk/lots`).set(as('tecnico@test.local')).expect(403);
    await http().get(`${base(orgA)}/risk/lots`).set(as('export@test.local')).expect(403);
    await http().get(`${base(orgA)}/risk/evaluations/${e.id}`).set(as('admin-b@test.local')).expect(404);
    await http().get(`${base(orgB)}/risk/evaluations/${e.id}`).set(as('admin-b@test.local')).expect(404);
    await http().post(`${base(orgB)}/risk/lots/${l}/evaluations`).set(as('admin-b@test.local')).send({ operation_id: randomUUID() }).expect(404);
    // con risk:read pero sin lectura completa de la organización: 403 (no se muestran referencias de recursos ocultos)
    const orig = AuthorizationService.prototype.tenantContext;
    jest.spyOn(AuthorizationService.prototype, 'tenantContext').mockImplementation(async function (this: AuthorizationService, user, orgId) {
      const ctx = await orig.call(this, user, orgId);
      return ctx && user.email === 'export@test.local' ? { ...ctx, permissions: [...ctx.permissions, 'risk:read'] } : ctx;
    });
    const denied = (await http().get(`${base(orgA)}/risk/evaluations/${e.id}`).set(as('export@test.local')).expect(403)).body;
    expect(JSON.stringify(denied)).not.toMatch(/RK-1|ENT-|LOT-/);
    // auditoría consultable por alcance
    jest.restoreAllMocks();
    const audit = (await http().get(`${base(orgA)}/audit-logs?entity_type=lot&entity_id=${l}`).set(as('auditor@test.local')).expect(200)).body;
    expect(audit.items.map((x: { action: string }) => x.action)).toContain('risk.evaluate');
  });
});
