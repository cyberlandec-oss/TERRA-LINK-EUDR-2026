import { randomUUID } from 'crypto';
import { sql, type Kysely } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { publishKdeRelease } from '../src/traceability/kde-release';
import { publishCteRelease } from '../src/traceability/cte-release';

// Integración P0-014 KDE (PostgreSQL real). Los valores enviados son FIXTURES SINTÉTICOS: acreditan el
// catálogo y el servicio de validación, no operaciones de entrega o cosecha (no existen todavía).
describeDb('P0-014 datos mínimos (KDE) y validación', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let p1: string;
  let p2: string;
  let plotOwn: string;
  let plotOther: string;
  let product: string;
  let plotB: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const cteId = async (code: string) => (await http().get(`${base(orgA)}/cte-catalog`).set(as('admin-a@test.local')).expect(200)).body.definitions.find((d: { code: string }) => d.code === code).id;
  const validate = (actor: string, cte: string, values: Record<string, unknown>, o = orgA) => http().post(`${base(o)}/kde/validate`).set(as(actor)).send({ cte_definition_id: cte, values });
  const item = (r: { items: Array<{ code: string; result: string; error_code: string | null }> }, code: string) => r.items.find((i) => i.code === code)!;

  async function join(admin: string, o: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: email, password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const mid = async (email: string) => (await h.db.selectFrom('memberships as m').innerJoin('users as u', 'u.id', 'm.user_id').select('m.id').where('u.email', '=', email).where('m.organization_id', '=', orgA).executeTakeFirstOrThrow()).id;

  beforeAll(async () => {
    h = await setupHarness();
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user('admin-a@test.local');
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) =>
      (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop A', 'admin-a@test.local');
    orgB = await mk('Coop B', 'admin-b@test.local');
    await join('admin-a@test.local', orgA, 'tecnico1@test.local', 'FIELD_TECHNICIAN');
    await join('admin-a@test.local', orgA, 'trazabilidad@test.local', 'TRACEABILITY_MANAGER');
    await join('admin-a@test.local', orgA, 'productor@test.local', 'PRODUCER');
    p1 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'P-1', legal_name: 'Finca uno', document_type: 'CEDULA', document_number: '0912345678', assigned_membership_id: await mid('tecnico1@test.local') }).expect(201)).body.id;
    p2 = (await http().post(`${base(orgA)}/producers`).set(as('admin-a@test.local')).send({ producer_code: 'P-2', legal_name: 'Finca dos' }).expect(201)).body.id;
    plotOwn = (await http().post(`${base(orgA)}/plots`).set(as('admin-a@test.local')).send({ producer_id: p1, plot_code: 'PAR-1', crop: 'Cacao' }).expect(201)).body.id;
    plotOther = (await http().post(`${base(orgA)}/plots`).set(as('admin-a@test.local')).send({ producer_id: p2, plot_code: 'PAR-2', crop: 'Cacao' }).expect(201)).body.id;
    product = (await http().post(`${base(orgA)}/products`).set(as('admin-a@test.local')).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    const pb = (await http().post(`${base(orgB)}/producers`).set(as('admin-b@test.local')).send({ producer_code: 'B-1', legal_name: 'Finca B' }).expect(201)).body.id;
    plotB = (await http().post(`${base(orgB)}/plots`).set(as('admin-b@test.local')).send({ producer_id: pb, plot_code: 'PB-1', crop: 'Cacao' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());

  it('catálogo vigente 1.2.0 (P0-012 + referencia de límites declarada): cada KDE con hito exacto, contrato, tipo, unidad, obligatoriedad, regla, responsable y fuente', async () => {
    const r = (await http().get(`${base(orgA)}/kde-catalog`).set(as('trazabilidad@test.local')).expect(200)).body;
    expect(r).toMatchObject({ scope: 'SYSTEM', current_release: { version: '1.7.0' }, flow_requirement: { status: 'PENDING', decision: 'D-33' }, legal_configuration: { status: 'NOT_ACTIVE' } });
    const codes = r.definitions.map((d: { code: string }) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
    const w = r.definitions.find((d: { code: string }) => d.code === 'DELIVERY_DECLARED_WEIGHT');
    expect(w).toMatchObject({ reference: 'DELIVERY_DECLARED_WEIGHT@2', cte: { reference: 'DELIVERY@2' }, contract: { entity: 'deliveries', field: 'quantity_declared/unit' }, value_type: 'QUANTITY', unit: { allowed: ['KG'], dimension: 'MASS' }, requirement: 'REQUIRED', responsible_roles: ['PRODUCER', 'FIELD_TECHNICIAN'], integration: { status: 'INTEGRATED', story: 'P0-012' } });
    expect(w.rule_text).toMatch(/mayor que cero/);
    expect(w.integration.proof).toMatch(/P0-012: DELIVERY_REGISTER debe rechazar la transición/);
    const reason = r.definitions.find((d: { code: string }) => d.code === 'RECEPTION_DIFFERENCE_REASON');
    expect(reason).toMatchObject({ requirement: 'CONDITIONAL', condition: { kind: 'undefined_in_contract' } }); // 1.1.0: con parciales se evalúa al cierre (no definido)
    expect(r.definitions.find((d: { code: string }) => d.code === 'CLASSIFICATION_LIMITS_VERSION')).toMatchObject({ name: 'Referencia de límites declarada (no verificada)', published_in: '1.2.0', requirement: 'CONDITIONAL' });
    expect(r.definitions.find((d: { code: string }) => d.code === 'DELIVERY_PRODUCTION_PERIOD')).toMatchObject({ value_type: 'HARVEST_PERIOD', requirement: 'REQUIRED', condition: null });
    expect(r.definitions.find((d: { code: string }) => d.code === 'DELIVERY_SUPPORT')).toMatchObject({ value_type: 'ENTITY_REF_LIST', validation: { entity: 'document', min_items: 1 } });
    expect(r.transition_gates.RECEPTION_CONFIRM.checks.find((c: { kde: string }) => c.kde === 'DELIVERY_SUPPORT').mode).toBe('PENDING_ALLOWED');
    expect(r.transition_gates.DOWNSTREAM_READINESS.checks).toEqual([expect.objectContaining({ kde: null, mode: 'NOT_EVALUATED' })]);
    // la versión 1.0.0 sigue resoluble y con su significado original
    const all = (await http().get(`${base(orgA)}/kde-catalog?include_retired=true`).set(as('trazabilidad@test.local')).expect(200)).body.definitions;
    expect(all.find((d: { code: string; version: number }) => d.code === 'RECEPTION_DIFFERENCE_REASON' && d.version === 1)).toMatchObject({ status: 'RETIRED', condition: { kind: 'quantities_differ' } });
    const harvest = r.definitions.find((d: { code: string }) => d.code === 'HARVEST_QUANTITY');
    expect(harvest.integration.story).toBeNull(); // D-33: sin historia, sin numeración inventada
    expect(r.definitions.find((d: { code: string }) => d.code === 'DELIVERY_PLOTS').difference).toMatch(/docs\/06 deliveries no tiene parcela/);
    // Los PESOS solo admiten KG: no hay conversiones (D-32 sigue pendiente en ese punto). La única cantidad que
    // no es un peso es la humedad del secado, en %BH (porcentaje en base húmeda, D-32 adoptada el 2026-10-15).
    const cantidades: Array<{ code: string; unit: { allowed: string[] } }> = r.definitions.filter((d: { value_type: string }) => d.value_type === 'QUANTITY');
    expect(cantidades.filter((d) => d.code !== 'DRYING_MOISTURE').every((d) => d.unit.allowed.join() === 'KG')).toBe(true);
    expect(cantidades.find((d) => d.code === 'DRYING_MOISTURE')!.unit.allowed).toEqual(['%BH']);
    // productor sin permiso; no miembro
    await http().get(`${base(orgA)}/kde-catalog`).set(as('productor@test.local')).expect(403);
    await http().get(`${base(orgA)}/kde-catalog`).set(as('admin-b@test.local')).expect(404);
  });

  it('validación con referencias reales del tenant y del alcance: válidas, ajenas sin revelar existencia, faltantes', async () => {
    const delivery = await cteId('DELIVERY');
    const values = {
      DELIVERY_SUPPLIER: p1, DELIVERY_PLOTS: [plotOwn], DELIVERY_PRODUCT: product, DELIVERY_DATE: '2026-10-01',
      DELIVERY_DECLARED_WEIGHT: { value: '500.000000', unit: 'KG' },
    };
    const r = (await validate('tecnico1@test.local', delivery, values).expect(200)).body;
    expect(item(r, 'DELIVERY_SUPPLIER').result).toBe('PRESENT_VALID');
    expect(item(r, 'DELIVERY_PLOTS').result).toBe('PRESENT_VALID');
    expect(item(r, 'DELIVERY_SUPPORT').result).toBe('REQUIRED_MISSING');
    expect(item(r, 'DELIVERY_PRODUCTION_PERIOD').result).toBe('REQUIRED_MISSING'); // 1.1.0 (D-34): requerido para completitud
    expect(r.gate).toMatchObject({ transition_allowed: false, outcome: 'INCOMPLETE' });
    expect(r).toMatchObject({ persisted: false, cte: { reference: 'DELIVERY@2' }, kde_release: '1.7.0' });
    // parcela de otro productor (fuera del alcance del técnico), de otra organización e inexistente: mismo resultado
    for (const id of [plotOther, plotB, randomUUID()]) {
      const x = (await validate('tecnico1@test.local', delivery, { ...values, DELIVERY_PLOTS: [id] }).expect(200)).body;
      expect(item(x, 'DELIVERY_PLOTS')).toMatchObject({ result: 'PRESENT_INVALID', error_code: 'REFERENCE_NOT_FOUND' });
    }
    // el administrador sí ve la parcela de P-2
    expect(item((await validate('admin-a@test.local', delivery, { ...values, DELIVERY_PLOTS: [plotOther] }).expect(200)).body, 'DELIVERY_PLOTS').result).toBe('PRESENT_VALID');
    // documento (P0-018): verificable; un id inexistente se rechaza sin revelar nada (1.1.0: lista de soportes)
    expect(item((await validate('admin-a@test.local', delivery, { ...values, DELIVERY_SUPPORT: [randomUUID()] }).expect(200)).body, 'DELIVERY_SUPPORT')).toMatchObject({ result: 'PRESENT_INVALID', error_code: 'REFERENCE_NOT_FOUND' });
  });

  it('respuestas sin valores ni datos sensibles; claves desconocidas solo por nombre', async () => {
    const delivery = await cteId('DELIVERY');
    const r = await validate('admin-a@test.local', delivery, {
      DELIVERY_SUPPLIER: p1, DELIVERY_DECLARED_WEIGHT: { value: '987.654321', unit: 'QQ' }, DELIVERY_DATE: '2026-13-45',
      CEDULA_EXTRA: '0912345678', 'campo libre -80.1601': 'x',
    }).expect(200);
    const blob = JSON.stringify(r.body);
    for (const s of ['987.654321', '0912345678', '-80.1601', '2026-13-45', 'Finca uno']) expect(blob).not.toContain(s);
    expect(item(r.body, 'DELIVERY_DECLARED_WEIGHT').error_code).toBe('UNIT_NOT_ALLOWED');
    expect(item(r.body, 'DELIVERY_DATE').error_code).toBe('DATE_INVALID');
    expect(r.body.unknown_fields).toEqual(['CEDULA_EXTRA']);
    expect(r.body.unknown_fields_other).toBe(1);
    // validación entre organizaciones: el hito existe (sistema) pero la membresía no
    await validate('admin-b@test.local', delivery, {}, orgA).expect(404);
    await validate('productor@test.local', delivery, {}).expect(403);
  });

  it('diferencia de recepción (1.1.0): con recepciones parciales no se decide por recepción; condición no evaluable, nunca «no aplica»', async () => {
    const reception = await cteId('RECEPTION');
    const self = await mid('trazabilidad@test.local');
    const common = { RECEPTION_DELIVERY: randomUUID(), RECEPTION_LOCATION: randomUUID(), RECEPTION_RECEIVER: self, RECEPTION_TIME: '2026-10-02T10:00:00-05:00', RECEPTION_RECEIVED_WEIGHT: { value: '480', unit: 'KG' } };
    const unknown = (await validate('trazabilidad@test.local', reception, common).expect(200)).body;
    expect(item(unknown, 'RECEPTION_DIFFERENCE_REASON').result).toBe('CONDITION_NOT_EVALUABLE');
    expect(item(unknown, 'RECEPTION_RECEIVER').result).toBe('PRESENT_VALID'); // sin membership:read solo puede referirse a sí mismo
    const differs = (await validate('trazabilidad@test.local', reception, { ...common, DELIVERY_DECLARED_WEIGHT: { value: '500', unit: 'KG' } }).expect(200)).body;
    expect(item(differs, 'RECEPTION_DIFFERENCE_REASON').result).toBe('CONDITION_NOT_EVALUABLE');
    const equal = (await validate('trazabilidad@test.local', reception, { ...common, DELIVERY_DECLARED_WEIGHT: { value: '480.0', unit: 'KG' } }).expect(200)).body;
    expect(item(equal, 'RECEPTION_DIFFERENCE_REASON').result).toBe('CONDITION_NOT_EVALUABLE');
    const other = (await validate('trazabilidad@test.local', reception, { ...common, RECEPTION_RECEIVER: await mid('tecnico1@test.local') }).expect(200)).body;
    expect(item(other, 'RECEPTION_RECEIVER').error_code).toBe('REFERENCE_NOT_FOUND');
  });

  it('versionado: nueva versión preserva la historia, referencia el hito exacto; esquema retirado no admite operaciones nuevas', async () => {
    const w1 = (await http().get(`${base(orgA)}/kde-catalog`).set(as('admin-a@test.local')).expect(200)).body.definitions.find((d: { code: string }) => d.code === 'WEIGHING_METHOD');
    const oldCte = await cteId('WEIGHING');
    await h.db.transaction().execute(async (trx) => {
      await publishCteRelease(trx as unknown as Kysely<unknown>, { version: '2.1.0', source: 'prueba', notes: 'nueva versión de pesaje (prueba)',
        publish: [{ code: 'WEIGHING', name: 'Pesaje', description: 'prueba', stage: 'INTERNAL', source: 'prueba', links: [{ operation: 'WEIGHT_RECORD', event_type: 'WeightRecorded', status: 'PENDING', story: 'P0-012', note: 'prueba' }] }] });
      await publishKdeRelease(trx as unknown as Kysely<unknown>, { version: '2.1.0', source: 'prueba', notes: 'KDE de pesaje sobre WEIGHING@3 (prueba)',
        publish: [{ code: 'WEIGHING_METHOD', cte: 'WEIGHING', name: 'Método de pesaje', entity: '—', field: '—', value_type: 'TEXT', requirement: 'REQUIRED', condition: null, validation: { max_length: 60 }, responsible_roles: ['RECEPTION_OPERATOR'], responsible_note: '', source: 'prueba', difference: null }] });
    });
    const now = (await http().get(`${base(orgA)}/kde-catalog`).set(as('admin-a@test.local')).expect(200)).body;
    const w2 = now.definitions.find((d: { code: string }) => d.code === 'WEIGHING_METHOD');
    expect(w2).toMatchObject({ version: 3, cte: { reference: 'WEIGHING@3' }, supersedes_id: w1.id, validation: { max_length: 60 } });
    const old = (await http().get(`${base(orgA)}/kde-definitions/${w1.id}`).set(as('admin-a@test.local')).expect(200)).body;
    expect(old).toMatchObject({ version: 2, cte: { reference: 'WEIGHING@2', retired: true }, status: 'RETIRED', validation: { max_length: 120 } });
    const retired = await validate('admin-a@test.local', oldCte, {}).expect(409);
    expect(retired.body.error.code).toBe('CTE_DEFINITION_RETIRED');
    await expect(sql`UPDATE kde_definitions SET name = 'x' WHERE id = ${w1.id}`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('publicación fallida: sin versión ni definiciones parciales; esquema cerrado', async () => {
    const count = async () => (await sql<{ r: number; d: number }>`SELECT (SELECT count(*)::int FROM kde_catalog_releases) AS r, (SELECT count(*)::int FROM kde_definitions) AS d`.execute(h.db)).rows[0];
    const before = await count();
    await expect(h.db.transaction().execute((trx) => publishKdeRelease(trx as unknown as Kysely<unknown>, { version: '2.2.0', source: 'prueba', notes: 'falla',
      publish: [
        { code: 'SALE_NOTE', cte: 'SALE', name: 'n', entity: '—', field: '—', value_type: 'TEXT', requirement: 'OPTIONAL', condition: null, validation: {}, responsible_roles: [], responsible_note: '', source: 'prueba', difference: null },
        { code: 'SALE_BAD', cte: 'SALE', name: 'n', entity: '—', field: '—', value_type: 'TEXT', requirement: 'CONDITIONAL', condition: { kind: 'present', kde: 'NO_EXISTE' }, validation: {}, responsible_roles: [], responsible_note: '', source: 'prueba', difference: null },
      ] }))).rejects.toThrow(/NO_EXISTE/);
    expect(await count()).toEqual(before);
    await expect(h.db.transaction().execute((trx) => publishKdeRelease(trx as unknown as Kysely<unknown>, { version: '2.2.1', source: 'prueba', notes: 'falla',
      publish: [{ code: 'SALE_SCRIPT', cte: 'SALE', name: 'n', entity: '—', field: '—', value_type: 'TEXT', requirement: 'OPTIONAL', condition: null, validation: { eval: 'process.exit()' } as never, responsible_roles: [], responsible_note: '', source: 'prueba', difference: null }] }))).rejects.toThrow(/fuera del esquema/);
    expect(await count()).toEqual(before);
  });
});
