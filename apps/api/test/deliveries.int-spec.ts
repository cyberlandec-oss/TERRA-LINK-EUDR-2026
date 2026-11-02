import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { AuditService } from '../src/audit/audit.service';

// Integración P0-012 Entregas y recepción: PostgreSQL, S3 local y ClamAV REALES. Datos SINTÉTICOS.
// Decisiones de diseño del MVP (D-33/D-34/D-35) probadas como comportamiento, no como conformidad.
describeDb('P0-012 entregas, recepción física, soportes y calidad', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let p1: string; // asignado a tecnico1
  let p2: string;
  let plot1: string;
  let plot2: string; // de p2
  let product: string;
  let center: string;
  let centerB: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const pdf = () => Buffer.from(`%PDF-1.4\n% soporte sintético ${randomUUID()}\n%%EOF\n`);
  const create = (actor: string, body: Record<string, unknown>, o = orgA) => http().post(`${base(o)}/deliveries`).set(as(actor)).send({ operation_id: randomUUID(), ...body });
  const get = (actor: string, id: string, o = orgA) => http().get(`${base(o)}/deliveries/${id}`).set(as(actor));
  const today = new Date().toISOString().slice(0, 10);
  const weighing = (q: string) => ({ method: 'Báscula de plataforma (sintética)', quantity: q, unit: 'KG', weighed_on: today });
  const receive = (actor: string, id: string, q: string, extra: Record<string, unknown> = {}) =>
    http().post(`${base(orgA)}/deliveries/${id}/receptions`).set(as(actor)).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: weighing(q), ...extra });
  const full = (extra: Record<string, unknown> = {}) => ({ producer_id: p1, product_id: product, location_id: center, delivery_date: today, quantity_declared: '500', unit: 'KG', origins: [{ plot_id: plot1 }], ...extra });
  const registered = async (extra: Record<string, unknown> = {}, actor = 'admin-a@test.local') => (await create(actor, { ...full(extra), register: true }).expect(201)).body.delivery;

  async function join(admin: string, o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const mid = async (email: string) => (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow()).id;
  const upload = async (actor: string, owner: string, type = 'DELIVERY_SUPPORT', o = orgA) => (await http().post(`${base(o)}/documents`).set(as(actor)).field('operation_id', randomUUID())
    .field('document_type', type).field('owner_type', 'producer').field('owner_id', owner).field('title', `Nota de entrega ${randomUUID().slice(0, 4)} (sintética)`)
    .attach('file', pdf(), { filename: 'nota.pdf', contentType: 'application/pdf' }).expect(201)).body.document;

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Entregas A', 'admin-a@test.local');
    orgB = await mk('Coop Entregas B', 'admin-b@test.local');
    for (const [e, r] of [['tecnico1@test.local', 'FIELD_TECHNICIAN'], ['tecnico2@test.local', 'FIELD_TECHNICIAN'], ['recepcion@test.local', 'RECEPTION_OPERATOR'], ['calidad@test.local', 'QUALITY_OPERATOR'], ['auditor@test.local', 'AUDITOR']]) await join('admin-a@test.local', orgA, e, r);
    p1 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'EN-1', legal_name: 'Finca Entregas Uno', assigned_membership_id: await mid('tecnico1@test.local') }).expect(201)).body.id;
    p2 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'EN-2', legal_name: 'Finca Entregas Dos' }).expect(201)).body.id;
    plot1 = (await http().post(`${base(orgA)}/plots`).set(as('admin-a@test.local')).send({ producer_id: p1, plot_code: 'EN-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    plot2 = (await http().post(`${base(orgA)}/plots`).set(as('admin-a@test.local')).send({ producer_id: p2, plot_code: 'EN-2-P1', crop: 'Cacao' }).expect(201)).body.id;
    product = (await http().post(`${base(orgA)}/products`).set(as('admin-a@test.local')).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${base(orgA)}/locations`).set(as('admin-a@test.local')).send({ code: 'CA-01', name: 'Centro de acopio uno', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    centerB = (await http().post(`${base(orgB)}/locations`).set(as('admin-b@test.local')).send({ code: 'CB-01', name: 'Centro B', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());
  afterEach(() => jest.restoreAllMocks());

  it('periodo de cosecha: día, mes, intervalo de meses y desconocido; precisión conservada sin días ficticios; validación de orden y formato', async () => {
    const day = (await create('admin-a@test.local', full({ harvest_period: { precision: 'DAY', start: '2026-09-03', end: '2026-09-20' } })).expect(201)).body.delivery;
    expect(day.harvest_period).toMatchObject({ precision: 'DAY', start: '2026-09-03', end: '2026-09-20', derived: { start: '2026-09-03', end: '2026-09-20' } });
    const month = (await create('admin-a@test.local', full({ harvest_period: { precision: 'MONTH', start: '2026-09', end: '2026-09' } })).expect(201)).body.delivery;
    expect(month.harvest_period).toMatchObject({ precision: 'MONTH', start: '2026-09', end: '2026-09' }); // sin días inventados en la declaración
    expect(month.harvest_period.derived).toMatchObject({ start: '2026-09-01', end: '2026-09-30', note: expect.stringMatching(/derivados/) });
    const range = (await create('admin-a@test.local', full({ harvest_period: { precision: 'MONTH', start: '2026-07', end: '2026-09' } })).expect(201)).body.delivery;
    expect(range.harvest_period).toMatchObject({ precision: 'MONTH', start: '2026-07', end: '2026-09', derived: { end: '2026-09-30' } });
    const unknown = (await create('admin-a@test.local', full({ harvest_period: { precision: 'UNKNOWN' } })).expect(201)).body.delivery;
    expect(unknown.harvest_period).toEqual({ precision: 'UNKNOWN', start: null, end: null, derived: null });
    const row = await h.db.selectFrom('deliveries').select(['harvest_precision', 'harvest_start', 'harvest_end', 'delivery_date']).where('id', '=', month.id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ harvest_precision: 'MONTH', harvest_start: '2026-09', harvest_end: '2026-09' });
    // no se deriva de la fecha de entrega: sin periodo declarado queda ausente
    const none = (await create('admin-a@test.local', full()).expect(201)).body.delivery;
    expect(none.harvest_period).toBeNull();
    for (const [p, code] of [
      [{ precision: 'DAY', start: '2026-02-30', end: '2026-03-01' }, 'HARVEST_PERIOD_DAY_INVALID'],
      [{ precision: 'DAY', start: '2026-09-20', end: '2026-09-03' }, 'HARVEST_PERIOD_INVERTED'],
      [{ precision: 'MONTH', start: '2026-09-01', end: '2026-09-30' }, 'HARVEST_PERIOD_MONTH_INVALID'],
      [{ precision: 'MONTH', start: '2026-10', end: '2026-08' }, 'HARVEST_PERIOD_INVERTED'],
      [{ precision: 'UNKNOWN', start: '2026-09' }, 'HARVEST_PERIOD_UNKNOWN_WITH_DATES'],
    ] as const) expect((await create('admin-a@test.local', full({ harvest_period: p })).expect(422)).body.error.code).toBe(code);
    await expect(sql`UPDATE deliveries SET harvest_precision = 'MONTH', harvest_start = '2026-09', harvest_end = '2026-09', harvest_derived_start = '2026-09-05', harvest_derived_end = '2026-09-30' WHERE id = ${none.id}`.execute(h.db)).rejects.toThrow(/deliveries_harvest_shape/);
    // desconocido: la entrega se registra y la recepción también; el periodo queda pendiente
    const reg = (await http().post(`${base(orgA)}/deliveries/${unknown.id}/register`).set(as('admin-a@test.local')).send({ expected_version: unknown.row_version }).expect(200)).body.delivery;
    expect(reg.status).toBe('REGISTERED');
    expect(reg.gates.registration.result.pending.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(['DELIVERY_PRODUCTION_PERIOD', 'DELIVERY_SUPPORT']));
    expect(reg.gates.registration.result.pending.find((p: { code: string }) => p.code === 'DELIVERY_PRODUCTION_PERIOD').result).toBe('DECLARED_UNKNOWN');
    await receive('recepcion@test.local', unknown.id, '100').expect(201);
  });

  it('compuertas KDE reales por transición: borrador con faltantes, registro bloqueado sin datos obligatorios, pendientes visibles, completitud y operaciones posteriores no evaluadas', async () => {
    const draft = (await create('tecnico1@test.local', { producer_id: p1 }).expect(201)).body.delivery;
    expect(draft).toMatchObject({ status: 'DRAFT', origin_status: 'MISSING', quantity_declared: null });
    expect(draft.gates.register.allowed).toBe(false);
    expect(draft.gates.register.blocking.map((b: { code: string }) => b.code).sort()).toEqual(['DELIVERY_DATE', 'DELIVERY_DECLARED_WEIGHT', 'DELIVERY_PRODUCT']);
    const blocked = await http().post(`${base(orgA)}/deliveries/${draft.id}/register`).set(as('tecnico1@test.local')).send({ expected_version: draft.row_version }).expect(422);
    expect(blocked.body.error.code).toBe('TRANSITION_BLOCKED');
    expect(blocked.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(['DELIVERY_DATE', 'DELIVERY_DECLARED_WEIGHT', 'DELIVERY_PRODUCT']);
    // completar el borrador (técnico asignado) sin origen ni soporte: se registra con esos pendientes
    const upd = (await http().patch(`${base(orgA)}/deliveries/${draft.id}`).set(as('tecnico1@test.local')).send({ expected_version: draft.row_version, product_id: product, delivery_date: today, quantity_declared: '250.5', unit: 'KG' }).expect(200)).body;
    const reg = (await http().post(`${base(orgA)}/deliveries/${draft.id}/register`).set(as('tecnico1@test.local')).send({ expected_version: upd.row_version }).expect(200)).body.delivery;
    expect(reg.gates.registration.result.pending.map((p: { code: string }) => p.code).sort()).toEqual(['DELIVERY_PLOTS', 'DELIVERY_PRODUCTION_PERIOD', 'DELIVERY_SUPPORT']);
    expect(reg.gates.completeness.allowed).toBe(false); // trazabilidad incompleta: no es expediente ni conformidad
    expect(reg.gates.downstream).toMatchObject({ allowed: true, blocking: [], not_evaluated: [expect.objectContaining({ code: null, note: expect.stringMatching(/P0-016/) })] });
    expect(reg.disclaimer).toMatch(/no es un expediente completo, producto liberado ni cumplimiento EUDR/);
    expect(reg.inventory_effect.status).toBe('RECORDED_IN_LEDGER'); // P0-017: la recepción es la única entrada física
    // registrada = inmutable (edición rechazada, trigger en base)
    expect((await http().patch(`${base(orgA)}/deliveries/${draft.id}`).set(as('tecnico1@test.local')).send({ expected_version: reg.row_version, notes: 'x' }).expect(409)).body.error.code).toBe('DELIVERY_REGISTERED');
    await expect(sql`UPDATE deliveries SET quantity_declared = 1 WHERE id = ${draft.id}`.execute(h.db)).rejects.toThrow(/registrada no se modifica/);
    // cantidad, unidad y referencias inválidas
    expect((await create('admin-a@test.local', full({ quantity_declared: '0' })).expect(422)).body.error.code).toBe('MUST_BE_POSITIVE');
    expect((await create('admin-a@test.local', full({ unit: undefined })).expect(422)).body.error.code).toBe('UNIT_REQUIRED');
    await create('admin-a@test.local', full({ unit: 'LB' })).expect(400);
    await create('admin-a@test.local', full({ origins: [{ plot_id: plot2 }] })).expect(404); // parcela de otro productor
    await create('admin-a@test.local', full({ location_id: centerB })).expect(404); // centro de otra organización
  });

  it('entrega y recepción sin documento: recepción física con receptor de la sesión y evidencia pendiente; cantidades declarada y recibida separadas', async () => {
    const d = await registered();
    expect(d).toMatchObject({ support_status: 'PENDING', supports: [] });
    const r = (await receive('recepcion@test.local', d.id, '480.25', { received_by: 'otra-persona', receiver_membership_id: randomUUID() }).expect(400));
    expect(r.body.error.code).toBeDefined(); // campos de autoridad en el cuerpo no se aceptan
    const ok = (await receive('recepcion@test.local', d.id, '480.25').expect(201)).body;
    const rec = ok.delivery.receptions[0];
    expect(rec).toMatchObject({ quantity_received: { value: '480.25', unit: 'KG' }, receiver: 'Persona reception_operator', quality: { status: 'PENDING_EVALUATION', status_label: 'Pendiente de evaluación' } });
    expect(rec.confirmation_gate).toMatchObject({ transition: 'RECEPTION_CONFIRM', allowed: true });
    expect(rec.confirmation_gate.pending.map((p: { code: string }) => p.code)).toContain('DELIVERY_SUPPORT');
    expect(rec.confirmation_gate.not_evaluated.map((p: { code: string }) => p.code)).toContain('RECEPTION_DIFFERENCE_REASON');
    expect(ok.delivery.totals).toMatchObject({ declared: { value: '500', unit: 'KG' }, received: { value: '480.25', unit: 'KG' }, reception_status: 'PARTIAL', closure: { status: 'OPEN' } });
    const row = await h.db.selectFrom('receptions').select(['receiver_membership_id']).where('id', '=', rec.id).executeTakeFirstOrThrow();
    expect(row.receiver_membership_id).toBe(await mid('recepcion@test.local'));
    // pesaje inválido: sin zona horaria, peso cero
    expect((await receive('recepcion@test.local', d.id, '10', { received_at: '2026-10-10T10:00:00' }).expect(422)).body.error.code).toBe('DATETIME_ZONE_REQUIRED');
    expect((await receive('recepcion@test.local', d.id, '0').expect(422)).body.error.code).toBe('MUST_BE_POSITIVE');
    // borrador no se recibe
    const draft = (await create('admin-a@test.local', full()).expect(201)).body.delivery;
    expect((await receive('recepcion@test.local', draft.id, '10').expect(409)).body.error.code).toBe('DELIVERY_NOT_REGISTERED');
  });

  it('recepciones parciales con historia propia, sin cierre automático ni ajuste de la declaración; exceso señalado', async () => {
    const d = await registered({ quantity_declared: '300' });
    await receive('recepcion@test.local', d.id, '100').expect(201);
    const two = (await receive('recepcion@test.local', d.id, '150.5').expect(201)).body.delivery;
    expect(two.receptions).toHaveLength(2);
    expect(two.totals).toMatchObject({ declared: { value: '300' }, received: { value: '250.5' }, reception_status: 'PARTIAL' });
    expect(two.quantity_declared.value).toBe('300'); // la declaración no se ajusta
    const eq = (await receive('recepcion@test.local', d.id, '49.5').expect(201)).body.delivery;
    expect(eq.totals.reception_status).toBe('RECEIVED_DECLARED');
    const over = (await receive('recepcion@test.local', d.id, '5').expect(201)).body.delivery;
    expect(over.totals).toMatchObject({ received: { value: '305' }, reception_status: 'ABOVE_DECLARED', reception_status_label: 'Recibido supera lo declarado' });
    expect(await h.db.selectFrom('deliveries').select('status').where('id', '=', d.id).executeTakeFirstOrThrow()).toEqual({ status: 'REGISTERED' });
  });

  it('varios soportes por versión exacta; disponibilidad y revisión visibles sin aprobación automática; referencias rechazadas', async () => {
    const d = await registered();
    const doc1 = await upload('admin-a@test.local', p1);
    const doc2 = await upload('admin-a@test.local', p1);
    const link = (docVersion: string, kind = 'DELIVERY_NOTE', actor = 'admin-a@test.local') => http().post(`${base(orgA)}/deliveries/${d.id}/supports`).set(as(actor)).send({ operation_id: randomUUID(), document_version_id: docVersion, support_kind: kind });
    await link(doc1.versions[0].id, 'DELIVERY_NOTE').expect(201);
    const after = (await link(doc2.versions[0].id, 'REMISSION_GUIDE').expect(201)).body.delivery;
    expect(after.supports).toHaveLength(2);
    expect(after.supports[0]).toMatchObject({ kind: 'DELIVERY_NOTE', availability: 'AVAILABLE', review: 'NOT_REVIEWED', validity: 'NO_EXPIRY', version_number: 1 });
    expect(after.support_status).toBe('REGISTERED');
    expect(after.gates.reception_preview.pending.map((p: { code: string }) => p.code)).not.toContain('DELIVERY_SUPPORT');
    expect((await link(doc1.versions[0].id).expect(409)).body.error.code).toBe('SUPPORT_ALREADY_LINKED');
    const other = await upload('admin-a@test.local', p2);
    expect((await link(other.versions[0].id).expect(422)).body.error.code).toBe('DOCUMENT_OWNER_MISMATCH');
    const tenure = await upload('admin-a@test.local', p1, 'LAND_TENURE');
    expect((await link(tenure.versions[0].id).expect(422)).body.error.code).toBe('DOCUMENT_TYPE_NOT_ALLOWED');
    const pB = (await http().post(`${base(orgB)}/producers`).set(as('admin-b@test.local')).send({ producer_code: 'B-1', legal_name: 'Finca B' }).expect(201)).body.id;
    const docB = await upload('admin-b@test.local', pB, 'DELIVERY_SUPPORT', orgB);
    await link(docB.versions[0].id).expect(404);
    await link(randomUUID()).expect(404);
    await link(doc1.versions[0].id, 'DELIVERY_NOTE', 'recepcion@test.local').expect(403); // sin document:read (no se amplía su rol)
    // el operador de recepción ve el estado del soporte, no el detalle del documento
    const rv = (await get('recepcion@test.local', d.id).expect(200)).body;
    expect(rv).toMatchObject({ supports: [], supports_visible: false, support_status: 'REGISTERED' });
    // retirar conserva la historia
    const w = (await http().post(`${base(orgA)}/deliveries/${d.id}/supports/${after.supports[0].id}/withdraw`).set(as('admin-a@test.local')).send({ reason: 'Documento equivocado' }).expect(200)).body;
    expect(w.supports.find((s: { id: string }) => s.id === after.supports[0].id).withdrawn).toMatchObject({ reason: 'Documento equivocado' });
    await expect(sql`DELETE FROM delivery_supports WHERE delivery_id = ${d.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    // F02: la ficha del documento muestra la entrega que lo usa, con la versión exacta y el estado del vínculo (vigente / retirado); la otra organización no lo ve.
    const usoDoc = async (doc: { id: string }) => (await http().get(`${base(orgA)}/documents/${doc.id}`).set(as('admin-a@test.local')).expect(200)).body.delivery_usage as Array<{ delivery_code: string; version_number: number; status: string; withdrawn_reason: string | null }>;
    expect(await usoDoc(doc2)).toEqual([expect.objectContaining({ delivery_code: d.delivery_code, version_number: 1, status: 'ACTIVE' })]);
    expect(await usoDoc(doc1)).toEqual([expect.objectContaining({ delivery_code: d.delivery_code, version_number: 1, status: 'WITHDRAWN', withdrawn_reason: 'Documento equivocado' })]);
    expect(await usoDoc(other)).toEqual([]); // control: un documento que ninguna entrega usa figura sin entregas
    await http().get(`${base(orgA)}/documents/${doc1.id}`).set(as('admin-b@test.local')).expect(404);
  });

  it('calidad durante la recepción o después del pesaje; pendiente sin decisión; liberar exige límites; decisión con permiso de calidad; estado separado', async () => {
    const d = await registered();
    const during = (await receive('recepcion@test.local', d.id, '200', { quality_sample: { sample_reference: 'M-001', result: { method: 'Prueba de corte (sintética)', measurements: [{ parameter: 'MOISTURE', value: '7.2', unit: '%' }] } } }).expect(201)).body.delivery;
    const r1 = during.receptions[0];
    expect(r1.quality.samples[0]).toMatchObject({ moment: 'DURING_RECEPTION', sample_reference: 'M-001', results: [{ decision: 'PENDING', measurements: [{ parameter: 'MOISTURE', value: '7.2', unit: '%' }] }] });
    expect(r1.quality.status).toBe('PENDING_EVALUATION'); // 7.2 % no implica «aprobado»
    // durante la recepción no se decide; el operador de recepción no libera
    expect((await receive('recepcion@test.local', d.id, '10', { quality_sample: { result: { method: 'x', decision: 'RELEASED', limits_version: 'L1' } } }).expect(422)).body.error.code).toBe('DECISION_NOT_ALLOWED_HERE');
    const sample = r1.quality.samples[0].id;
    const result = (actor: string, body: Record<string, unknown>, rec = r1.id, s = sample) => http().post(`${base(orgA)}/deliveries/${d.id}/receptions/${rec}/quality-samples/${s}/results`).set(as(actor)).send({ operation_id: randomUUID(), method: 'Prueba de corte', ...body });
    await result('recepcion@test.local', { decision: 'RELEASED', limits_version: 'LIM-2026-1' }).expect(403);
    expect((await result('calidad@test.local', { decision: 'RELEASED' }).expect(422)).body.error.details.map((x: { field: string }) => x.field)).toContain('CLASSIFICATION_LIMITS_VERSION');
    expect((await result('calidad@test.local', { decision: 'REJECTED' }).expect(422)).body.error.code).toBe('REASON_REQUIRED');
    const released = (await result('calidad@test.local', { decision: 'RELEASED', limits_version: 'LIM-2026-1 (declarada)', measurements: [{ parameter: 'MOISTURE', value: '7.0', unit: '%' }] }).expect(201)).body.delivery;
    expect(released.receptions[0].quality).toMatchObject({ status: 'RELEASED', status_label: 'Calidad liberada por decisión humana (límites declarados, no verificados)', limits_verification: 'NOT_AVAILABLE', note: expect.stringMatching(/No es liberación jurídica/) });
    // la referencia escrita es DECLARADA y no verificada; la decisión no habilita operaciones posteriores
    const res = released.receptions[0].quality.samples[0].results.find((x: { decision: string }) => x.decision === 'RELEASED');
    expect(res).toMatchObject({ limits_reference: { value: 'LIM-2026-1 (declarada)', status: 'DECLARED_UNVERIFIED' }, recorded_by: 'Persona quality_operator' });
    expect(res.limits_version).toBeUndefined();
    expect(released.receptions[0].downstream_enablement).toMatchObject({ status: 'NOT_EVALUATED' });
    expect(released.gates.downstream).toMatchObject({ blocking: [], pending: [] });
    expect(released.gates.downstream.not_evaluated).toHaveLength(1);
    const evp = await h.db.selectFrom('domain_events').select('payload').where('event_type', '=', 'QualityDecisionRecorded').where('organization_id', '=', orgA).executeTakeFirstOrThrow();
    expect(evp.payload).toMatchObject({ limits_reference_status: 'DECLARED_UNVERIFIED', limits_catalog: 'NOT_AVAILABLE' });
    expect(released.receptions[0].quantity_received.value).toBe('200'); // calidad no cambia el peso recibido
    // después del pesaje, en otra recepción: muestra posterior sin decisión
    const r2 = (await receive('recepcion@test.local', d.id, '50').expect(201)).body.reception_id;
    const later = (await http().post(`${base(orgA)}/deliveries/${d.id}/receptions/${r2}/quality-samples`).set(as('calidad@test.local')).send({ operation_id: randomUUID(), sample_reference: 'M-002' }).expect(201)).body.delivery;
    const rec2 = later.receptions.find((r: { id: string }) => r.id === r2);
    expect(rec2.quality.samples[0]).toMatchObject({ moment: 'AFTER_WEIGHING', results: [] });
    expect(rec2.quality.status).toBe('PENDING_EVALUATION');
    const rej = (await result('calidad@test.local', { decision: 'REJECTED', decision_reason: 'Moho visible en la muestra (sintético)' }, r2, rec2.quality.samples[0].id).expect(201)).body.delivery;
    expect(rej.receptions.find((r: { id: string }) => r.id === r2).quality.status).toBe('REJECTED');
    const ev = await h.db.selectFrom('domain_events').select(['event_type', 'payload']).where('aggregate_type', '=', 'QUALITY_SAMPLE').where('organization_id', '=', orgA).execute();
    expect(ev.map((e) => e.event_type)).toEqual(['QualityDecisionRecorded', 'QualityDecisionRecorded']);
    // el auditor y el técnico no registran calidad
    await http().post(`${base(orgA)}/deliveries/${d.id}/receptions/${r2}/quality-samples`).set(as('auditor@test.local')).send({ operation_id: randomUUID() }).expect(403);
  });

  it('reintentos, envíos concurrentes y rollback: un doble envío no crea otra recepción ni otra cantidad', async () => {
    const d = await registered();
    const op = randomUUID();
    const body = { operation_id: op, location_id: center, received_at: new Date().toISOString(), weighing: weighing('120') };
    const send = () => http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as('recepcion@test.local')).send(body);
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([201, 201]);
    expect(new Set([a.body.reception_id, b.body.reception_id]).size).toBe(1);
    expect([a.body.replayed, b.body.replayed].sort()).toEqual([false, true]);
    const again = (await send().expect(201)).body;
    expect(again).toMatchObject({ replayed: true, reception_id: a.body.reception_id });
    expect(again.delivery.totals.received.value).toBe('120');
    expect((await h.db.selectFrom('receptions').select(sql<number>`count(*)::int`.as('n')).where('delivery_id', '=', d.id).executeTakeFirstOrThrow()).n).toBe(1);
    expect((await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as('recepcion@test.local')).send({ ...body, weighing: weighing('121') }).expect(409)).body.error.code).toBe('OPERATION_ID_REUSED');
    // creación idempotente de la entrega
    const cop = randomUUID();
    const c1 = (await http().post(`${base(orgA)}/deliveries`).set(as('admin-a@test.local')).send({ operation_id: cop, ...full() }).expect(201)).body;
    const c2 = (await http().post(`${base(orgA)}/deliveries`).set(as('admin-a@test.local')).send({ operation_id: cop, ...full() }).expect(201)).body;
    expect(c2).toMatchObject({ replayed: true, delivery: { id: c1.delivery.id, delivery_code: c1.delivery.delivery_code } });
    // rollback: si la auditoría falla, no queda recepción, pesaje, compuerta ni evento
    const counts = async () => (await sql<{ r: number; w: number; g: number; e: number }>`SELECT (SELECT count(*)::int FROM receptions) r, (SELECT count(*)::int FROM weighings) w, (SELECT count(*)::int FROM gate_evaluations) g, (SELECT count(*)::int FROM domain_events) e`.execute(h.db)).rows[0];
    const before = await counts();
    jest.spyOn(AuditService.prototype, 'record').mockRejectedValueOnce(new Error('fallo forzado'));
    await receive('recepcion@test.local', d.id, '30').expect(500);
    expect(await counts()).toEqual(before);
  });

  it('correcciones con contrato específico: originales preservados, evento enlazado, dependencias incompatibles rechazadas', async () => {
    const d = await registered({ quantity_declared: '400', harvest_period: { precision: 'MONTH', start: '2026-08', end: '2026-08' } });
    const rec = (await receive('recepcion@test.local', d.id, '390').expect(201)).body.delivery;
    const r = rec.receptions[0];
    // corrección de la declaración
    const corr = (body: Record<string, unknown>, actor = 'admin-a@test.local') => http().post(`${base(orgA)}/deliveries/${d.id}/corrections`).set(as(actor)).send({ operation_id: randomUUID(), ...body });
    await corr({ expected_version: rec.row_version, reason: 'Peso declarado mal transcrito', fields: { quantity_declared: '395' } }, 'recepcion@test.local').expect(403);
    await corr({ expected_version: rec.row_version - 1, reason: 'x x x', fields: { quantity_declared: '395' } }).expect(409);
    const c = (await corr({ expected_version: rec.row_version, reason: 'Peso declarado mal transcrito', fields: { quantity_declared: '395', harvest_period: { precision: 'MONTH', start: '2026-07', end: '2026-08' } } }).expect(201)).body.delivery;
    expect(c.quantity_declared.value).toBe('395');
    expect(c.harvest_period).toMatchObject({ precision: 'MONTH', start: '2026-07', end: '2026-08' });
    expect(c.original_declaration).toMatchObject({ quantity_declared: '400', harvest_period: { precision: 'MONTH', start: '2026-08', end: '2026-08' } });
    expect(c.corrections[0]).toMatchObject({ number: 1, changed_fields: ['quantity_declared', 'harvest_period'], reason: 'Peso declarado mal transcrito' });
    const ev = await h.db.selectFrom('domain_events').select(['event_type', 'correction_of_event_id', 'correction_reason']).where('aggregate_id', '=', d.id).orderBy('aggregate_version').execute();
    expect(ev.map((e) => e.event_type)).toEqual(['DeliveryRegistered', 'DeliveryCorrected']);
    expect(ev[1].correction_of_event_id).toBeTruthy();
    expect((await h.db.selectFrom('deliveries').select('quantity_declared').where('id', '=', d.id).executeTakeFirstOrThrow()).quantity_declared).toBe('400.000000'); // original intacto
    // dependencia posterior: la fecha no puede quedar después de una recepción confirmada
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    expect((await corr({ expected_version: c.row_version, reason: 'Fecha posterior', fields: { delivery_date: future } }).expect(409)).body.error.code).toBe('CORRECTION_CONFLICTS_WITH_RECEPTIONS');
    expect((await corr({ expected_version: c.row_version, reason: 'Sin cambios', fields: { quantity_declared: '395.0' } }).expect(422)).body.error.code).toBe('NO_CHANGES');
    // corrección de la recepción: nuevo pesaje y ajuste; el pesaje y la cantidad originales se conservan
    const rc = (body: Record<string, unknown>, actor = 'recepcion@test.local') => http().post(`${base(orgA)}/deliveries/${d.id}/receptions/${r.id}/corrections`).set(as(actor)).send({ operation_id: randomUUID(), ...body });
    await rc({ expected_version: 1, reason: 'Recalibración', weighing: weighing('388') }, 'calidad@test.local').expect(403);
    const fixed = (await rc({ expected_version: 1, reason: 'Báscula recalibrada; pesaje repetido', weighing: weighing('388') }).expect(201)).body.delivery;
    const fr = fixed.receptions[0];
    expect(fr).toMatchObject({ quantity_received: { value: '388' }, original_quantity: { value: '390' }, version: 2 });
    expect(fr.weighings).toHaveLength(2);
    expect(fr.weighings[1].corrects_weighing_id).toBe(fr.weighings[0].id);
    expect(fr.adjustments[0]).toMatchObject({ previous_quantity: '390', new_quantity: '388', reason: 'Báscula recalibrada; pesaje repetido' });
    expect((await rc({ expected_version: 1, reason: 'otra', weighing: weighing('387') }).expect(409)).body.error.code).toBe('VERSION_CONFLICT');
    const rev = await h.db.selectFrom('domain_events').select(['event_type', 'correction_of_event_id']).where('aggregate_id', '=', r.id).orderBy('aggregate_version').execute();
    expect(rev.map((e) => e.event_type)).toEqual(['ReceptionConfirmed', 'ReceptionCorrected']);
    await expect(sql`UPDATE receptions SET quantity_received = 1 WHERE id = ${r.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`UPDATE weighings SET quantity = 1 WHERE reception_id = ${r.id}`.execute(h.db)).rejects.toThrow(/append-only/);
    expect(fixed.history.map((x: { event_type: string }) => x.event_type)).toEqual(expect.arrayContaining(['DeliveryRegistered', 'DeliveryCorrected', 'ReceptionConfirmed', 'ReceptionCorrected', 'WeightRecorded']));
  });

  it('aislamiento y alcance por rol: otra organización, técnico sin asignación, operador de recepción, calidad, auditor', async () => {
    const d = await registered();
    await get('admin-b@test.local', d.id).expect(404);
    await get('admin-b@test.local', d.id, orgB).expect(404);
    await get('tecnico2@test.local', d.id).expect(404); // productor no asignado
    expect((await http().get(`${base(orgA)}/deliveries`).set(as('tecnico2@test.local')).expect(200)).body.every((x: { producer: { id: string } }) => x.producer.id !== p1)).toBe(true);
    await create('tecnico2@test.local', full()).expect(404); // no puede registrar para un productor no asignado
    const own = (await create('tecnico1@test.local', full()).expect(201)).body.delivery;
    expect(own.actions).toMatchObject({ edit: true, register: true, receive: false, correct_delivery: false });
    await get('recepcion@test.local', d.id).expect(200);
    const rv = (await get('recepcion@test.local', d.id).expect(200)).body;
    expect(rv.producer.name).toBeNull(); // sin identidad del productor
    expect(rv.producer.code).toBe('EN-1');
    expect(rv.actions).toMatchObject({ receive: true, decide_quality: false, correct_delivery: false });
    await receive('calidad@test.local', d.id, '10').expect(403);
    await receive('auditor@test.local', d.id, '10').expect(403);
    await create('auditor@test.local', full()).expect(403);
    expect((await get('auditor@test.local', d.id).expect(200)).body.actions.receive).toBe(false);
    // recepción en un centro de otra organización
    await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as('recepcion@test.local')).send({ operation_id: randomUUID(), location_id: centerB, received_at: new Date().toISOString(), weighing: weighing('10') }).expect(404);
    // centros: solo administración los gestiona
    await http().post(`${base(orgA)}/locations`).set(as('recepcion@test.local')).send({ code: 'X-1', name: 'Centro x', location_type: 'OTHER' }).expect(403);
    expect((await http().post(`${base(orgA)}/locations`).set(as('admin-a@test.local')).send({ code: 'CA-01', name: 'Repetido', location_type: 'OTHER' }).expect(409)).body.error.code).toBe('LOCATION_CODE_TAKEN');
    // auditoría consultable por alcance y sin valores sensibles
    const audit = (await http().get(`${base(orgA)}/audit-logs?entity_type=delivery&entity_id=${d.id}`).set(as('auditor@test.local')).expect(200)).body;
    expect(audit.items.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['delivery.draft_create', 'delivery.register']));
    expect(JSON.stringify(audit)).not.toContain('Finca Entregas');
  });

  it('perfiles por transición: desconocido, sin soporte y calidad pendiente permiten la recepción; la completitud enumera exactamente lo que falta y solo es completa con todo', async () => {
    const pending = await registered({ harvest_period: { precision: 'UNKNOWN' }, origins: [] });
    const rec = (await receive('recepcion@test.local', pending.id, '100').expect(201)).body.delivery;
    expect(rec.receptions[0].quality.status).toBe('PENDING_EVALUATION');
    expect(rec.receptions[0].confirmation_gate.pending.map((p: { code: string }) => p.code).sort()).toEqual(['DELIVERY_PLOTS', 'DELIVERY_PRODUCTION_PERIOD', 'DELIVERY_SUPPORT']);
    const comp = rec.gates.completeness;
    expect(comp.allowed).toBe(false);
    expect(comp.blocking.map((b: { code: string; result: string }) => `${b.code}:${b.result}`).sort()).toEqual(['DELIVERY_PLOTS:REQUIRED_MISSING', 'DELIVERY_PRODUCTION_PERIOD:DECLARED_UNKNOWN', 'DELIVERY_SUPPORT:REQUIRED_MISSING']);
    expect(comp.pending).toEqual([]); // la completitud no deja nada «permitido»: o está o falta
    expect(comp.not_evaluated.map((n: { code: string }) => n.code)).toEqual(['RECEPTION_DIFFERENCE_REASON']);
    // con todos los datos presentes y válidos (y una recepción), la completitud es completa — y sigue sin ser conformidad
    const full2 = await registered({ harvest_period: { precision: 'MONTH', start: '2026-08', end: '2026-09' } });
    const doc = await upload('admin-a@test.local', p1);
    await http().post(`${base(orgA)}/deliveries/${full2.id}/supports`).set(as('admin-a@test.local')).send({ operation_id: randomUUID(), document_version_id: doc.versions[0].id, support_kind: 'DELIVERY_NOTE' }).expect(201);
    const before = (await get('admin-a@test.local', full2.id).expect(200)).body;
    expect(before.gates.completeness.blocking.map((b: { code: string }) => b.code).sort()).toEqual(['RECEPTION_DELIVERY', 'RECEPTION_LOCATION', 'RECEPTION_RECEIVED_WEIGHT', 'RECEPTION_RECEIVER', 'RECEPTION_TIME', 'WEIGHING_DATE', 'WEIGHING_METHOD', 'WEIGHING_RESPONSIBLE', 'WEIGHING_SUBJECT', 'WEIGHING_VALUE']);
    const after = (await receive('recepcion@test.local', full2.id, '500').expect(201)).body.delivery;
    expect(after.gates.completeness).toMatchObject({ allowed: true, blocking: [], pending: [] });
    expect(after.disclaimer).toMatch(/cumplimiento EUDR/);
    expect(after.gates.reception_preview.transition).toBe('RECEPTION_CONFIRM');
    expect(after.gates.registration.transition).toBe('DELIVERY_REGISTER');
  });

  it('total recibido con varias recepciones y correcciones: originales conservados; correcciones concurrentes sin duplicar; sin cierre ni inventario', async () => {
    const d = await registered({ quantity_declared: '200' });
    const r1 = (await receive('recepcion@test.local', d.id, '100').expect(201)).body.reception_id;
    const r2 = (await receive('recepcion@test.local', d.id, '50').expect(201)).body.reception_id;
    const corr = (rid: string, q: string, v: number) => http().post(`${base(orgA)}/deliveries/${d.id}/receptions/${rid}/corrections`).set(as('recepcion@test.local'))
      .send({ operation_id: randomUUID(), expected_version: v, reason: `Repesaje a ${q}`, weighing: weighing(q) });
    const [a, b] = await Promise.all([corr(r1, '90', 1), corr(r1, '91', 1)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await h.db.selectFrom('reception_adjustments').select(sql<number>`count(*)::int`.as('n')).where('reception_id', '=', r1).executeTakeFirstOrThrow()).n).toBe(1);
    const won = a.status === 201 ? '90' : '91';
    await corr(r1, '95', 2).expect(201);
    const v = (await get('admin-a@test.local', d.id).expect(200)).body;
    const rec1 = v.receptions.find((x: { id: string }) => x.id === r1);
    expect(rec1).toMatchObject({ quantity_received: { value: '95' }, original_quantity: { value: '100' }, version: 3 });
    expect(rec1.adjustments.map((x: { previous_quantity: string; new_quantity: string }) => `${x.previous_quantity}→${x.new_quantity}`)).toEqual([`100→${won}`, `${won}→95`]);
    expect(rec1.weighings).toHaveLength(3);
    // total = suma de la cantidad vigente de cada recepción (95 + 50), igual en lista y detalle
    expect(v.totals).toMatchObject({ declared: { value: '200' }, received: { value: '145' }, reception_status: 'PARTIAL', closure: { status: 'OPEN' } });
    const row = (await http().get(`${base(orgA)}/deliveries?q=${d.delivery_code}`).set(as('admin-a@test.local')).expect(200)).body[0];
    expect(row.received.value).toBe('145');
    expect(v.receptions.find((x: { id: string }) => x.id === r2).quantity_received.value).toBe('50');
    // rollback de una corrección: ni ajuste, ni pesaje, ni evento
    const counts = async () => (await sql<{ a: number; w: number; e: number }>`SELECT (SELECT count(*)::int FROM reception_adjustments) a, (SELECT count(*)::int FROM weighings) w, (SELECT count(*)::int FROM domain_events) e`.execute(h.db)).rows[0];
    const c0 = await counts();
    jest.spyOn(AuditService.prototype, 'record').mockRejectedValueOnce(new Error('fallo forzado'));
    await corr(r2, '49', 1).expect(500);
    expect(await counts()).toEqual(c0);
    // superar lo declarado: se registra y se señala; la declaración no se ajusta y no hay tolerancia
    const over = (await receive('recepcion@test.local', d.id, '80').expect(201)).body.delivery;
    expect(over.totals).toMatchObject({ received: { value: '225' }, reception_status: 'ABOVE_DECLARED' });
    expect(over.quantity_declared.value).toBe('200');
    // Cerrar existe desde el 2026-10-15 (D-33) y exige explicar la diferencia: aquí se recibió MÁS de lo declarado,
    // así que el cierre sin motivo se rechaza. Cerrar no produce efecto de inventario: el ledger ya registró cada recepción.
    const sinMotivo = await http().post(`${base(orgA)}/deliveries/${d.id}/close`).set(as('admin-a@test.local'))
      .send({ operation_id: randomUUID(), expected_version: over.row_version }).expect(422);
    expect(sinMotivo.body.error.code).toBe('DIFFERENCE_REASON_REQUIRED');
    expect(over.inventory_effect.status).toBe('RECORDED_IN_LEDGER');
    expect(JSON.stringify(over)).not.toMatch(/available_quantity|stock_balance/);
  });
});
