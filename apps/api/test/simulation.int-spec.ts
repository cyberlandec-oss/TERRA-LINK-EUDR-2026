import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { ROLE_PERMISSIONS } from '../src/authz/catalog';

// P1-009 (RF-40; S3 §37) — Simulador de preparación de lote.
//
// Lo que estas pruebas protegen: que la simulación **no escriba nada**, que **el porcentaje no decida**, que
// **estado real, escenario y lo que seguiría bloqueado** nunca se mezclen, y que no sirva para **inferir** lo
// que el rol no puede leer.
describeDb('P1-009 simulador de preparación (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let lote: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const SUPER = 'super@test.local';
  const ADMIN = 'admin-sim@test.local';
  const ADMIN_B = 'admin-simb@test.local';
  const TEC = 'tecnico-sim@test.local';

  interface Req { code: string; label: string; status: string; detail: string; references: string[]; references_omitted: string | null }
  interface Blo { code: string; status: string; class: string; why: string }
  interface Sim {
    simulated_at: string; read_only: boolean;
    inputs: { lot_code: string; counts: Record<string, unknown>; rule_set_version: string | null; risk_evaluation_number: number | null; note: string };
    real: { readiness: string; summary: { total: number; met: number; percent_met: number; note: string }; requirements: Req[];
      dispatch_checks: Array<{ code: string; status: string; message: string }>; dispatch_not_simulated: Array<{ code: string }>;
      exportable: boolean; verdict: string; causes: string[]; note: string };
    scenario: { assumed: Array<{ code: string; was: string; note: string }>; rejected: Array<{ code: string; why: string }>; note: string };
    projected: { readiness: string; summary: { percent_met: number }; still_blocked: Blo[]; exportable: boolean; verdict: string; causes: string[]; note: string };
    disclaimer: string;
  }
  const sim = async (actor: string, assume = '', org = orgA, l = lote) =>
    (await http().get(`${api(org)}/simulations/lots/${l}${assume ? `?assume=${assume}` : ''}`).set(as(actor)).expect(200)).body as Sim;

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Simulación A', ADMIN);
    orgB = await mk('Coop Simulación B', ADMIN_B);
    const inv = await http().post(`${api(orgA)}/invitations`).set(as(ADMIN)).send({ email: TEC, role_code: 'FIELD_TECHNICIAN' }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'T', last_name: 'Campo', password: PASSWORD }).expect(200);
    await h.login(TEC);

    const prod = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'SIM-1', legal_name: 'Finca Simulación' }).expect(201)).body.id;
    const parcela = (await http().post(`${api(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: prod, plot_code: 'SIM-1-P', crop: 'Cacao' }).expect(201)).body.id;
    const rv = Number((await h.db.selectFrom('plots').select('row_version').where('id', '=', parcela).executeTakeFirstOrThrow()).row_version);
    await http().post(`${api(orgA)}/plots/${parcela}/geometry-versions`).set(as(ADMIN))
      .send({ expected_version: rv, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.16, -0.848] }, area_declared_ha: 2 }).expect(201);
    const baba = (await http().post(`${api(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    const centro = (await http().post(`${api(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CS', name: 'Centro', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    const d = (await http().post(`${api(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: prod, product_id: baba, delivery_date: today, quantity_declared: '100', unit: 'KG', origins: [{ plot_id: parcela }], register: true }).expect(201)).body.delivery;
    const rec = (await http().post(`${api(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: centro, received_at: new Date().toISOString(), weighing: { method: 'Báscula', quantity: '100', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    lote = (await http().post(`${api(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '100' }] }).expect(201)).body.lot.id;
  });
  afterAll(async () => h?.close());

  it('es SOLO LECTURA: no existe forma de escribir, y nada cambia al simular', async () => {
    const antes = await h.db.selectFrom('dd_snapshots').select('id').where('organization_id', '=', orgA).execute();
    const inventarioAntes = await h.db.selectFrom('stock_movements').select('id').where('organization_id', '=', orgA).execute();

    await http().post(`${api(orgA)}/simulations/lots/${lote}`).set(as(ADMIN)).send({}).expect(404);
    await http().patch(`${api(orgA)}/simulations/lots/${lote}`).set(as(ADMIN)).send({}).expect(404);
    const s = await sim(ADMIN, 'LEGAL_PROFILE,REGULATORY_CONCLUSION');
    expect(s.read_only).toBe(true);

    // Ni expediente, ni instantáneas, ni inventario, ni evidencias aprobadas.
    expect(await h.db.selectFrom('dd_snapshots').select('id').where('organization_id', '=', orgA).execute()).toEqual(antes);
    expect(await h.db.selectFrom('stock_movements').select('id').where('organization_id', '=', orgA).execute()).toEqual(inventarioAntes);
    expect(await h.db.selectFrom('evidence').select('id').where('organization_id', '=', orgA).where('status', '=', 'VERIFIED').execute()).toEqual([]);
    // Y no guarda escenarios: no hay tabla de simulaciones que pueda confundirse con un expediente.
    const tablas = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`.execute(h.db);
    expect(tablas.rows.filter((t) => /simulat|escenario|scenario/i.test(t.table_name))).toEqual([]);
  });

  it('muestra los INPUTS y la FECHA, con las versiones que usó (RF-40)', async () => {
    const s = await sim(ADMIN);
    expect(Date.parse(s.simulated_at)).toBeGreaterThan(Date.now() - 60_000);
    expect(s.inputs.lot_code).toMatch(/^LOT-/);
    // S3 §37 enumera productores, parcelas, cantidades… y aquí son RECUENTOS, no identidades.
    expect(s.inputs.counts).toMatchObject({ productores: 1, parcelas: 1, entregas: 1 });
    expect(s.inputs.counts.cantidad).toMatchObject({ unit: 'KG' });
    expect(JSON.stringify(s.inputs.counts)).not.toMatch(/Finca Simulación|coordinates|-80\./);
    expect(s.inputs.note).toMatch(/Mismo contenido y mismas reglas/);
  });

  it('EL PORCENTAJE NO DECIDE: con causas abiertas sigue siendo NO EXPORTABLE', async () => {
    const s = await sim(ADMIN);
    expect(s.real.summary.percent_met).toBeGreaterThanOrEqual(0);
    expect(s.real.summary.note).toMatch(/cualquier requisito no cumplido bloquea/i);
    expect(s.real.exportable).toBe(false);
    expect(s.real.verdict).toBe('NO EXPORTABLE');
    expect(s.real.causes.length).toBeGreaterThan(0);
    expect(s.real.note).toMatch(/El veredicto sale de las causas, no del porcentaje/);
    // Y la preparación real nunca es READY aquí: las compuertas siguen cerradas.
    expect(s.real.readiness).not.toBe('READY');
  });

  it('usa las MISMAS reglas que el preflight, y nombra lo que no simula', async () => {
    const s = await sim(ADMIN);
    expect(s.real.dispatch_checks.map((c) => c.code).sort()).toEqual(['DD_PACKAGE', 'ORIGIN', 'QUALITY']);
    // Lo que depende de un embarque concreto no se da por cumplido: se declara no simulado.
    expect(s.real.dispatch_not_simulated.map((c) => c.code).sort()).toEqual(['GATE', 'RESERVATION', 'STATUS']);
    // Los requisitos son los del expediente, no una copia: aparecen sus códigos conocidos.
    const codigos = s.real.requirements.map((r) => r.code);
    expect(codigos).toEqual(expect.arrayContaining(['LEGAL_PROFILE', 'QUANTITIES_CONSISTENT', 'REGULATORY_CONCLUSION']));
  });

  it('separa ESTADO REAL, ESCENARIO y LO QUE SEGUIRÍA BLOQUEADO', async () => {
    const s = await sim(ADMIN, 'LEGAL_PROFILE');
    // 1) El estado real no se toca: el requisito supuesto sigue sin cumplirse en `real`.
    const real = s.real.requirements.find((r) => r.code === 'LEGAL_PROFILE')!;
    expect(real.status).not.toBe('MET');
    // 2) El escenario dice qué supuso y que suponer no es resolver.
    expect(s.scenario.assumed).toEqual([expect.objectContaining({ code: 'LEGAL_PROFILE', was: real.status })]);
    expect(s.scenario.assumed[0].note).toMatch(/SUPONER NO ES RESOLVER/);
    // 3) Lo que seguiría bloqueado excluye lo supuesto e incluye el resto, con su clase.
    expect(s.projected.still_blocked.some((b) => b.code === 'LEGAL_PROFILE')).toBe(false);
    expect(s.projected.still_blocked.length).toBeGreaterThan(0);
    expect(s.projected.exportable).toBe(false);
    expect(s.projected.note).toMatch(/Aunque no quedara ningún requisito, seguiría sin ser exportable/);
  });

  it('clasifica lo que seguiría bloqueado: dato, decisión o capacidad', async () => {
    const s = await sim(ADMIN);
    const clases = new Set(s.projected.still_blocked.map((b) => b.class));
    expect([...clases].every((c) => ['DATO', 'DECISION', 'CAPACIDAD'].includes(c))).toBe(true);
    const legal = s.projected.still_blocked.find((b) => b.code === 'LEGAL_PROFILE');
    if (legal) {
      expect(legal.class).toBe('DECISION');
      expect(legal.why).toMatch(/P1-005/);
    }
    const defo = s.projected.still_blocked.find((b) => b.code === 'DEFORESTATION_ANALYSIS');
    if (defo) {
      expect(defo.class).toBe('CAPACIDAD');
      expect(defo.why).toMatch(/proveedor satelital/i);
    }
  });

  it('un supuesto que no procede se RECHAZA, en vez de aceptarse en silencio', async () => {
    const s = await sim(ADMIN, 'NO_EXISTE_ESTE_CODIGO');
    expect(s.scenario.assumed).toEqual([]);
    expect(s.scenario.rejected).toEqual([expect.objectContaining({ code: 'NO_EXISTE_ESTE_CODIGO' })]);
    expect(s.scenario.rejected[0].why).toMatch(/No existe un requisito con ese código/);
    // Sin supuestos válidos, la proyección coincide con el estado real.
    expect(s.projected.summary.percent_met).toBe(s.real.summary.percent_met);
  });

  it('suponerlo TODO tampoco habilita nada: READY y despacho siguen cerrados', async () => {
    const s0 = await sim(ADMIN);
    const todos = s0.real.requirements.filter((r) => r.status !== 'MET').map((r) => r.code).join(',');
    const s = await sim(ADMIN, todos);
    expect(s.projected.still_blocked).toEqual([]);
    expect(s.projected.exportable).toBe(false);
    expect(s.projected.verdict).toBe('NO EXPORTABLE');
    expect(s.projected.causes.length).toBeGreaterThan(0);
    // Y, sobre todo, el mundo real no cambió: ninguna instantánea READY.
    const ready = await h.db.selectFrom('dd_snapshots').select('readiness').where('organization_id', '=', orgA).execute();
    expect(ready.filter((r) => r.readiness === 'READY')).toEqual([]);
  });

  it('autorización: exige leer el expediente, respeta el alcance y aísla organizaciones', async () => {
    // El técnico no lee expedientes: no simula, ni siquiera agregados.
    await http().get(`${api(orgA)}/simulations/lots/${lote}`).set(as(TEC)).expect(403);
    // CONTROL: quien sí puede, obtiene 200.
    await http().get(`${api(orgA)}/simulations/lots/${lote}`).set(as(ADMIN)).expect(200);
    // Otra organización: 404, y un lote ajeno tampoco se simula desde la propia.
    await http().get(`${api(orgB)}/simulations/lots/${lote}`).set(as(ADMIN)).expect(404);
    await http().get(`${api(orgA)}/simulations/lots/${randomUUID()}`).set(as(ADMIN)).expect(404);
  });

  it('las referencias se deciden POR PERMISO, y hoy ningún rol con expediente queda sin ellas', async () => {
    // Quien lee parcelas y entregas recibe los códigos a los que apunta cada requisito.
    const AUDITOR = 'auditor-sim@test.local';
    const inv = await http().post(`${api(orgA)}/invitations`).set(as(ADMIN)).send({ email: AUDITOR, role_code: 'AUDITOR' }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'A', last_name: 'Auditor', password: PASSWORD }).expect(200);
    await h.login(AUDITOR);
    const s = await sim(AUDITOR);
    expect(s.real.requirements.some((r) => r.references.length > 0)).toBe(true);
    expect(s.real.requirements.every((r) => r.references_omitted === null)).toBe(true);
    expect(s.inputs.counts).toMatchObject({ productores: 1 });

    // CENTINELA: la rama que OMITE referencias solo se alcanza con un rol que lea expedientes pero no
    // parcelas o entregas. Hoy no existe ninguno, así que esa rama no es comprobable por HTTP y se dice en
    // vez de fingir que sí. Si mañana se crea ese rol, esta prueba falla y habrá que comprobarla de verdad.
    const sinLectura = Object.entries(ROLE_PERMISSIONS)
      .filter(([, ps]) => ps.includes('dd:read'))
      .filter(([, ps]) => !ps.includes('plot:read') || !ps.includes('delivery:read'))
      .map(([rol]) => rol);
    expect(sinLectura).toEqual([]);
  });
});
