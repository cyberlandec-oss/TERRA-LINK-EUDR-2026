import { randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { aEscalado, calcularLineas, deEscalado, huellaEntradas, mesesDelPeriodo, totalizar } from '../src/cost/platform-cost';

// P1-015 / D-54 — Coste estimado de uso de la PLATAFORMA (USD, por organización y período explícito).
//
// Lo que estas pruebas protegen:
//   · un precio ausente NO es cero (SIN_TARIFA / PARCIAL);
//   · las tarifas son datos declarados, versionados y con vigencia; no hay tarifas precargadas;
//   · el cálculo es exacto (enteros escalados) y REPRODUCIBLE desde sus entradas;
//   · el consumo observado, la tarifa, el resultado y los conceptos pendientes viajan separados;
//   · permisos (declarar/estimar ≠ leer), aislamiento entre organizaciones, idempotencia y append-only.
// Las tarifas de las pruebas son SINTÉTICAS y se identifican como tales.

describe('aritmética y selección de tarifa (pura)', () => {
  it('importes exactos: nada de coma flotante', () => {
    expect(deEscalado(aEscalado('0.1000') + aEscalado('0.2000'))).toBe('0.3000');
    expect(deEscalado(aEscalado('12.5') * 3n)).toBe('37.5000');
    expect(deEscalado(aEscalado('9999999999.9999'))).toBe('9999999999.9999');
  });
  it('meses del período', () => {
    expect(mesesDelPeriodo('2026-11-01', '2027-02-01')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });
  const t = (id: string, version: number, fee: string, from: string, to: string | null) => ({ id, version, monthly_fee: fee, valid_from: from, valid_to: to, synthetic: true, label: 'sintética' });
  it('gana la versión más reciente que cubre el mes COMPLETO; la que cubre un mes a medias no vale', () => {
    const lineas = calcularLineas(['2026-01-01', '2026-02-01', '2026-03-01'], [
      t('a', 1, '10.0000', '2026-01-01', null),
      t('b', 2, '12.0000', '2026-02-01', '2026-03-01'),
      t('c', 3, '99.0000', '2026-03-15', null), // cubre marzo solo desde el 15: NO cubre el mes completo
    ]);
    expect(lineas.map((l) => [l.month, l.tariff_version, l.amount])).toEqual([
      ['2026-01-01', 1, '10.0000'], ['2026-02-01', 2, '12.0000'], ['2026-03-01', 1, '10.0000']]);
  });
  it('un mes sin tarifa queda SIN PRECIO, no en cero; sin ningún precio no hay total', () => {
    const l = calcularLineas(['2026-01-01', '2026-02-01'], [t('a', 1, '5.0000', '2026-02-01', null)]);
    expect(l[0].amount).toBeNull();
    expect(l[0].reason).toBe('NO_HAY_TARIFA_QUE_CUBRA_EL_MES_COMPLETO');
    expect(totalizar(l)).toEqual({ status: 'PARCIAL', total: '5.0000' });
    expect(totalizar(calcularLineas(['2026-01-01'], []))).toEqual({ status: 'SIN_TARIFA', total: null });
    // Una tarifa DECLARADA en cero es un precio (cero), distinto de no tener tarifa.
    expect(totalizar(calcularLineas(['2026-01-01'], [t('z', 1, '0.0000', '2026-01-01', null)]))).toEqual({ status: 'ESTIMADO', total: '0.0000' });
  });
  it('la huella cambia si cambia cualquier entrada', () => {
    const l1 = calcularLineas(['2026-01-01'], [t('a', 1, '10.0000', '2026-01-01', null)]);
    const l2 = calcularLineas(['2026-01-01'], [t('a', 1, '10.0001', '2026-01-01', null)]);
    expect(huellaEntradas('o', '2026-01-01', '2026-02-01', l1)).not.toBe(huellaEntradas('o', '2026-01-01', '2026-02-01', l2));
    expect(huellaEntradas('o', '2026-01-01', '2026-02-01', l1)).toBe(huellaEntradas('o', '2026-01-01', '2026-02-01', l1));
  });
});

describeDb('P1-015 coste estimado de la plataforma (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  const SUPER = 'super-pc@test.local';
  const ADMIN = 'admin-pc@test.local';
  const ADMIN_B = 'admin-pcb@test.local';
  const TEC = 'tecnico-pc@test.local';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}/platform-cost`;
  const tarifa = (over: object = {}) => ({
    operation_id: randomUUID(), monthly_fee: '10.0000', valid_from: '2026-01-01', valid_to: '2026-04-01', synthetic: true,
    label: 'Tarifa SINTÉTICA de demostración', source: 'Prueba automática: no es un acuerdo', ...over,
  });
  const estimar = (o: string, inicio: string, fin: string, actor = ADMIN, op = randomUUID()) =>
    http().post(`${base(o)}/estimates`).set(as(actor)).send({ operation_id: op, period_start: inicio, period_end: fin });

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Coste A', ADMIN);
    orgB = await mk('Coop Coste B', ADMIN_B);
    const inv = await http().post(`/api/v1/organizations/${orgA}/invitations`).set(as(ADMIN)).send({ email: TEC, role_code: 'FIELD_TECHNICIAN' }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'X', last_name: 'Y', password: PASSWORD }).expect(200);
    await h.login(TEC);
  });
  afterAll(async () => h?.close());

  it('NO HAY TARIFAS PRECARGADAS: una organización nueva no tiene ninguna', async () => {
    const r = await http().get(`${base(orgA)}/tariffs`).set(as(ADMIN)).expect(200);
    expect(r.body.tariffs).toEqual([]);
    expect(r.body.currency).toBe('USD');
    expect(r.body.unit).toBe('ORGANIZACION_MES');
  });

  it('SIN TARIFA no hay precio: el resultado es SIN_TARIFA, el total es nulo y NO cero', async () => {
    const r = await estimar(orgA, '2026-01-01', '2026-03-01').expect(201);
    const e = r.body.estimate;
    expect(e.status).toBe('SIN_TARIFA');
    expect(e.total).toBeNull();
    expect(e.lines).toHaveLength(2);
    expect(e.lines.every((l: { amount: unknown; reason: string }) => l.amount === null && l.reason === 'NO_HAY_TARIFA_QUE_CUBRA_EL_MES_COMPLETO')).toBe(true);
    expect(e.meaning).toMatch(/Un precio ausente no es cero/);
  });

  it('declarar una tarifa: queda versionada, identificada como sintética y auditada', async () => {
    const r = await http().post(`${base(orgA)}/tariffs`).set(as(ADMIN)).send(tarifa()).expect(201);
    expect(r.body.tariffs).toHaveLength(1);
    const t = r.body.tariffs[0];
    expect(t).toMatchObject({ version: 1, monthly_fee: '10.0000', synthetic: true, valid_from: '2026-01-01', valid_to: '2026-04-01' });
    const aud = await h.db.selectFrom('audit_logs').select('action').where('action', '=', 'platform_cost.tariff_declared').execute();
    expect(aud).toHaveLength(1);
  });

  it('ESTIMACIÓN con consumo separado de la tarifa, del resultado y de los conceptos pendientes', async () => {
    const r = await estimar(orgA, '2026-01-01', '2026-03-01').expect(201);
    const e = r.body.estimate;
    expect(e.status).toBe('ESTIMADO');
    expect(e.total).toBe('20.0000');
    expect(e.currency).toBe('USD');
    expect(e.lines.map((l: { tariff_version: number; amount: string; synthetic: boolean }) => [l.tariff_version, l.amount, l.synthetic])).toEqual([[1, '10.0000', true], [1, '10.0000', true]]);
    // Consumo observado, con su procedencia, aparte.
    expect(e.consumption.period.source).toMatch(/domain_events\.recorded_at/);
    expect(e.consumption.now.source).toMatch(/mismo origen que \/limits/);
    // Conceptos que se muestran pero NO se valoran, y la facturación no existe.
    const conceptos = Object.fromEntries(e.pending_concepts.map((c: { concept: string; state: string }) => [c.concept, c.state]));
    expect(conceptos).toMatchObject({ ALMACENAMIENTO: 'SIN_REGLA_DE_VALORACION', EVENTOS: 'SIN_REGLA_DE_VALORACION', USUARIOS_ACTIVOS: 'SIN_REGLA_DE_VALORACION', FACTURACION_Y_COBRO: 'NO_IMPLEMENTADO' });
    expect(e.scope_note).toMatch(/Distinto del presupuesto de preparación \(P1-010\) y del precio comercial del cacao/);
  });

  it('PARCIAL: los meses fuera de vigencia quedan sin precio, no en cero', async () => {
    const r = await estimar(orgA, '2026-03-01', '2026-06-01').expect(201);
    const e = r.body.estimate;
    expect(e.status).toBe('PARCIAL');
    expect(e.total).toBe('10.0000'); // solo marzo está cubierto entero (vigencia hasta 2026-04-01 excluido)
    expect(e.lines.map((l: { amount: string | null }) => l.amount)).toEqual(['10.0000', null, null]);
    expect(e.meaning).toMatch(/PARCIAL/);
  });

  it('VERSIONES: cambiar la tarifa exige motivo; la versión nueva sustituye solo donde cubre el mes completo', async () => {
    const sinMotivo = await http().post(`${base(orgA)}/tariffs`).set(as(ADMIN)).send(tarifa({ monthly_fee: '12.5', valid_from: '2026-02-01', valid_to: null }));
    expect(sinMotivo.status).toBe(422);
    expect(sinMotivo.body.error.code).toBe('REASON_REQUIRED');
    const ok = await http().post(`${base(orgA)}/tariffs`).set(as(ADMIN))
      .send(tarifa({ monthly_fee: '12.5', valid_from: '2026-02-01', valid_to: null, reason: 'Nueva tarifa de demostración desde febrero' })).expect(201);
    expect(ok.body.tariffs.map((t: { version: number }) => t.version)).toEqual([2, 1]);
    const e = (await estimar(orgA, '2026-01-01', '2026-05-01').expect(201)).body.estimate;
    expect(e.lines.map((l: { tariff_version: number; amount: string }) => [l.tariff_version, l.amount])).toEqual([[1, '10.0000'], [2, '12.5000'], [2, '12.5000'], [2, '12.5000']]);
    expect(e.total).toBe('47.5000');
    expect(e.status).toBe('ESTIMADO');
  });

  it('REPRODUCIBLE: se recalcula con las entradas guardadas aunque se declare después una tarifa nueva', async () => {
    const e = (await estimar(orgA, '2026-01-01', '2026-03-01').expect(201)).body.estimate;
    const v1 = await http().get(`${base(orgA)}/estimates/${e.id}/verify`).set(as(ADMIN)).expect(200);
    expect(v1.body.reproducible).toBe(true);
    await http().post(`${base(orgA)}/tariffs`).set(as(ADMIN))
      .send(tarifa({ monthly_fee: '99.0000', valid_from: '2026-01-01', valid_to: null, reason: 'Tarifa posterior que no debe alterar el pasado' })).expect(201);
    const v2 = await http().get(`${base(orgA)}/estimates/${e.id}/verify`).set(as(ADMIN)).expect(200);
    expect(v2.body.reproducible).toBe(true);
    expect(v2.body.recomputed.inputs_hash).toBe(e.inputs_hash);
    // Una estimación NUEVA sí usa la versión nueva: el pasado no se reescribe, el presente cambia.
    const nueva = (await estimar(orgA, '2026-01-01', '2026-03-01').expect(201)).body.estimate;
    expect(nueva.total).toBe('198.0000');
    expect(nueva.inputs_hash).not.toBe(e.inputs_hash);
  });

  it('PERIODO EXPLÍCITO: alineado a meses, ordenado y acotado', async () => {
    for (const [i, f, c] of [['2026-01-15', '2026-03-01', 'PERIODO_NO_ALINEADO'], ['2026-01-01', '2026-03-10', 'PERIODO_NO_ALINEADO'],
      ['2026-03-01', '2026-03-01', 'PERIODO_INVALIDO'], ['2026-03-01', '2026-02-01', 'PERIODO_INVALIDO'], ['2026-02-30', '2026-03-01', 'PERIODO_NO_ALINEADO'],
      ['2026-01-01', '2028-02-01', 'PERIODO_DEMASIADO_LARGO']]) {
      const r = await estimar(orgA, i, f);
      expect([r.status, r.body.error.code]).toEqual([422, c]);
    }
  });

  it('VALIDACIÓN de la tarifa: decimales, fechas y vigencia', async () => {
    for (const mala of [{ monthly_fee: '-1' }, { monthly_fee: '1.23456' }, { monthly_fee: 'abc' }, { valid_from: '2026-13-01' }, { valid_to: '2025-01-01' }, { synthetic: undefined }, { label: 'x' }]) {
      const r = await http().post(`${base(orgA)}/tariffs`).set(as(ADMIN)).send(tarifa(mala));
      expect([400, 422]).toContain(r.status);
    }
    const lista = await http().get(`${base(orgA)}/tariffs`).set(as(ADMIN)).expect(200);
    expect(lista.body.tariffs).toHaveLength(3);
  });

  it('IDEMPOTENCIA: repetir la operación no duplica; reutilizarla con otro contenido es un conflicto', async () => {
    const op = randomUUID();
    const primera = await estimar(orgA, '2026-01-01', '2026-02-01', ADMIN, op).expect(201);
    const repetida = await estimar(orgA, '2026-01-01', '2026-02-01', ADMIN, op).expect(201);
    expect(repetida.body.replayed).toBe(true);
    expect(repetida.body.estimate.id).toBe(primera.body.estimate.id);
    const otra = await estimar(orgA, '2026-02-01', '2026-03-01', ADMIN, op);
    expect(otra.status).toBe(409);
    const t = tarifa({ valid_from: '2025-01-01', valid_to: '2025-06-01', reason: 'Para probar idempotencia de tarifas' });
    await http().post(`${base(orgA)}/tariffs`).set(as(ADMIN)).send(t).expect(201);
    const rep = await http().post(`${base(orgA)}/tariffs`).set(as(ADMIN)).send(t).expect(201);
    expect(rep.body.replayed).toBe(true);
    expect((await http().post(`${base(orgA)}/tariffs`).set(as(ADMIN)).send({ ...t, monthly_fee: '3.0000' })).status).toBe(409);
  });

  it('PERMISOS: quien no tiene el permiso no declara, estima ni lee', async () => {
    expect((await http().get(`${base(orgA)}/tariffs`).set(as(TEC))).status).toBe(403);
    expect((await http().get(`${base(orgA)}/estimates`).set(as(TEC))).status).toBe(403);
    expect((await http().post(`${base(orgA)}/tariffs`).set(as(TEC)).send(tarifa())).status).toBe(403);
    expect((await estimar(orgA, '2026-01-01', '2026-02-01', TEC)).status).toBe(403);
    expect((await http().get(`${base(orgA)}/tariffs`)).status).toBe(401);
  });

  it('AISLAMIENTO: la otra organización no ve ni toca tarifas ni estimaciones ajenas', async () => {
    const e = (await estimar(orgA, '2026-01-01', '2026-02-01').expect(201)).body.estimate;
    expect((await http().get(`${base(orgA)}/tariffs`).set(as(ADMIN_B))).status).toBe(404);
    expect((await http().get(`${base(orgA)}/estimates/${e.id}`).set(as(ADMIN_B))).status).toBe(404);
    // Con su propia organización, la estimación ajena tampoco aparece por id.
    expect((await http().get(`${base(orgB)}/estimates/${e.id}`).set(as(ADMIN_B))).status).toBe(404);
    expect((await http().get(`${base(orgB)}/tariffs`).set(as(ADMIN_B)).expect(200)).body.tariffs).toEqual([]);
    expect((await http().post(`${base(orgA)}/tariffs`).set(as(ADMIN_B)).send(tarifa())).status).toBe(404);
  });

  it('APPEND-ONLY: ni tarifas ni estimaciones se editan o se borran', async () => {
    await expect(h.db.updateTable('platform_tariffs').set({ monthly_fee: '1.0000' }).execute()).rejects.toThrow(/append-only/);
    await expect(h.db.deleteFrom('platform_cost_estimates').execute()).rejects.toThrow(/append-only/);
  });

  it('NO ES FACTURACIÓN NI PRESUPUESTO: no existen rutas de cobro y P1-010 no se toca', async () => {
    for (const ruta of ['invoices', 'charges', 'payments', 'billing']) {
      expect((await http().post(`${base(orgA)}/${ruta}`).set(as(ADMIN)).send({})).status).toBe(404);
    }
    // El presupuesto de preparación sigue en su propio permiso y su propia ruta.
    expect((await http().get(`/api/v1/organizations/${orgA}/cost/parameters`).set(as(ADMIN))).status).not.toBe(500);
  });
});
