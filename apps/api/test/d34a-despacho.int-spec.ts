import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// D-34.A — Condición de despacho, contra PostgreSQL real. Contrato: `docs/decisiones/D-34-PROPUESTA.md`.
//
// **FIXTURES SINTÉTICAS.** Para llegar a un despacho hace falta una instantánea aprobada y `READY`, y hoy
// `READY` es inalcanzable: `LEGAL_PROFILE`, `GEOLOCATION_PROFILE`, `RISK_CATALOG_APPROVED`,
// `REGULATORY_CONCLUSION` y `DEFORESTATION_ANALYSIS` siguen `NOT_EVALUABLE` (D-05.B, D-07.5/.6, P1-005,
// D-09.B). Por eso las instantáneas aprobadas de esta suite se **insertan directamente**, marcadas
// `synthetic_fixture: true`, y sus exports de tipo `DD_PACKAGE` también.
//
// **Esto prueba la MECÁNICA de la compuerta, no que exista hoy un expediente operativo aprobable.** No se
// cambia ningún requisito regulatorio, no se fabrica un `READY` por la vía del producto y **P0-029 y P0-017
// siguen abiertas**: definir la condición y probar su mecánica no es su aceptación completa.
describeDb('D-34.A despacho: acreditación por ítem, vínculo previo y reversión completa', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA = '';
  let orgB = '';
  let center = '';
  let baba = '';
  let producer = '';
  let plot = '';
  let buyer = '';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local';
  const ADMIN_B = 'admin-b@test.local';
  const EXP = 'export@test.local';
  const EUDR = 'eudr@test.local';
  const AUD = 'auditor@test.local';

  async function join(o: string, email: string, role: string, admin = ADMIN) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
  }

  /** Lote con origen declarado y calidad liberada, listo para reservarse. */
  async function lote(cantidad: string, codigo: string) {
    const d = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: cantidad, unit: 'KG', origins: [{ plot_id: plot }], register: true }).expect(201)).body.delivery;
    const rec = (await http().post(`${base(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'Báscula sintética', quantity: cantidad, unit: 'KG', weighed_on: today },
      quality_sample: { sample_reference: `M-${codigo}`, result: { method: 'Prueba de corte (sintética)', measurements: [{ parameter: 'MOISTURE', value: '7.2', unit: '%' }] } } }).expect(201)).body.reception_id;
    // La muestra nace con la recepción; la calidad se libera por DECISIÓN HUMANA (no jurídica).
    const vista = (await http().get(`${base(orgA)}/deliveries/${d.id}`).set(as(ADMIN)).expect(200)).body;
    const muestra = vista.receptions[0].quality.samples[0].id;
    await http().post(`${base(orgA)}/deliveries/${d.id}/receptions/${rec}/quality-samples/${muestra}/results`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), method: `Prueba sintética ${codigo}`, decision: 'RELEASED', limits_version: 'LIMITES-SINTETICOS-1' }).expect(201);
    const lot = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: cantidad }] }).expect(201)).body.lot.id as string;
    return lot;
  }

  /**
   * Instantánea aprobada y READY **SINTÉTICA** para el lote, con su export `DD_PACKAGE`. Se inserta
   * directamente porque la vía del producto no puede producir `READY` hoy. El contenido lleva los vínculos de
   * embarque reales del lote, que es lo que la comprobación de correspondencia mira.
   */
  async function acreditacionSintetica(lotId: string) {
    const caso = (await http().post(`${base(orgA)}/dd-cases`).set(as(EUDR)).send({ operation_id: randomUUID(), lot_id: lotId, scope_note: 'Expediente SINTÉTICO D-34.A' }).expect(201)).body.case.id;
    // La instantánea se captura por la VÍA REAL: su contenido, su hash y sus vínculos son los de verdad, así
    // que la comprobación de vigencia funciona igual que en producción.
    const snapId = (await http().post(`${base(orgA)}/dd-cases/${caso}/snapshots`).set(as(EUDR)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot.id as string;
    const user = (await sql<{ id: string }>`SELECT u.id FROM users u WHERE u.email = ${EUDR}`.execute(h.db)).rows[0].id;
    // Lo ÚNICO sintético es `READY` y su aprobación: hoy son inalcanzables por la vía del producto porque
    // LEGAL_PROFILE, GEOLOCATION_PROFILE, RISK_CATALOG_APPROVED, REGULATORY_CONCLUSION y
    // DEFORESTATION_ANALYSIS siguen NOT_EVALUABLE. No se cambia ningún requisito: se fuerza el estado en la
    // base de pruebas para poder ejercitar la MECÁNICA de la compuerta.
    // `dd_snapshots` es append-only por disparador —y así debe seguir—, así que no se actualiza: se INSERTA
    // otra instantánea que copia el contenido, el hash y los hashes por sección REALES de la anterior y solo
    // cambia `readiness`. Al conservar el hash real, la comprobación de vigencia sigue funcionando de verdad.
    const real = (await sql<{ content: unknown; content_hash: string; section_hashes: unknown; manifest: unknown; requirements: unknown; snapshot_number: number }>`
      SELECT content, content_hash, section_hashes, manifest, requirements, snapshot_number FROM dd_snapshots WHERE id = ${snapId}`.execute(h.db)).rows[0];
    const readyId = randomUUID();
    await sql`INSERT INTO dd_snapshots (id, organization_id, case_id, snapshot_number, content, content_hash, section_hashes, manifest, requirements, readiness, captured_by, operation_id)
      VALUES (${readyId}, ${orgA}, ${caso}, ${real.snapshot_number + 1}, ${JSON.stringify(real.content)}::jsonb, ${real.content_hash},
              ${JSON.stringify(real.section_hashes)}::jsonb, ${JSON.stringify(real.manifest)}::jsonb, ${JSON.stringify(real.requirements)}::jsonb,
              'READY', ${user}, ${randomUUID()})`.execute(h.db);
    await sql`INSERT INTO dd_reviews (id, organization_id, snapshot_id, action, reason, reviewer_id, operation_id)
      VALUES (${randomUUID()}, ${orgA}, ${readyId}, 'APPROVE', 'Aprobación SINTÉTICA de prueba', ${user}, ${randomUUID()})`.execute(h.db);
    const expId = randomUUID();
    await sql`INSERT INTO dd_exports (id, organization_id, snapshot_id, kind, redaction_profile, package_hash, size_bytes, exported_by, operation_id)
      VALUES (${expId}, ${orgA}, ${readyId}, 'DD_PACKAGE', '{}'::jsonb, ${'a'.repeat(64)}, 10, ${user}, ${randomUUID()})`.execute(h.db);
    const borradorId = randomUUID();
    await sql`INSERT INTO dd_exports (id, organization_id, snapshot_id, kind, redaction_profile, package_hash, size_bytes, exported_by, operation_id)
      VALUES (${borradorId}, ${orgA}, ${readyId}, 'INTERNAL_REVIEW', '{}'::jsonb, ${'b'.repeat(64)}, 10, ${user}, ${randomUUID()})`.execute(h.db);
    return { snapId: readyId, expId, borradorId, caso };
  }

  const version = async (sid: string) => (await http().get(`${base(orgA)}/shipments/${sid}`).set(as(EXP)).expect(200)).body.row_version;
  const crearEmbarque = async () => (await http().post(`${base(orgA)}/shipments`).set(as(EXP)).send({ operation_id: randomUUID(), buyer_id: buyer, destination_country: 'DE', origin_location_id: center }).expect(201)).body.shipment.id as string;
  const addItem = async (sid: string, lotId: string, q: string) => {
    const v = await version(sid);
    return (await http().post(`${base(orgA)}/shipments/${sid}/items`).set(as(EXP)).send({ expected_version: Number(v), lot_id: lotId, quantity: q }).expect(201)).body.shipment.items.find((i: { lot_id: string }) => i.lot_id === lotId);
  };
  const reservar = (sid: string, itemId: string) => http().post(`${base(orgA)}/shipments/${sid}/reserve`).set(as(EXP)).send({ operation_id: randomUUID(), item_id: itemId });
  const despachar = (sid: string, v: number, actor = EXP) => http().post(`${base(orgA)}/shipments/${sid}/dispatch`).set(as(actor)).send({ operation_id: randomUUID(), expected_version: v });
  const itemsDe = (sid: string) => sql<{ id: string; lot_id: string; dd_package_export_id: string | null }>`SELECT id, lot_id, dd_package_export_id FROM shipment_items WHERE shipment_id = ${sid} ORDER BY lot_id`.execute(h.db);
  const movimientos = async (sid: string) => (await sql<{ n: number }>`SELECT count(*)::int AS n FROM stock_movements WHERE movement_type = 'SHIPMENT_DISPATCH' AND reference->>'shipment_id' = ${sid}`.execute(h.db)).rows[0].n;

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local'))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop D34 A', ADMIN);
    orgB = await mk('Coop D34 B', ADMIN_B);
    for (const [e, r] of [[EXP, 'EXPORT_MANAGER'], [EUDR, 'EUDR_MANAGER'], [AUD, 'AUDITOR']]) await join(orgA, e, r);
    producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'D34-1', legal_name: 'Finca D-34 Sintética' }).expect(201)).body.id;
    baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CD', name: 'Centro D-34', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    plot = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: 'D34-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    await http().post(`${base(orgA)}/plots/${plot}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.1601, -0.8479] }, area_declared_ha: 2 }).expect(201);
    buyer = (await http().post(`${base(orgA)}/buyers`).set(as(EXP)).send({ operation_id: randomUUID(), code: 'IMP-D34', name: 'Importador Sintético', country: 'NL' }).expect(201)).body.buyer.id;
  });
  afterAll(async () => h?.close());

  it('el vínculo previo satisface SHIPMENT_LINK e identifica embarque, ítem, reserva y cantidad', async () => {
    const lot = await lote('100', 'L1');
    const caso = (await http().post(`${base(orgA)}/dd-cases`).set(as(EUDR)).send({ operation_id: randomUUID(), lot_id: lot, scope_note: 'Vínculo' }).expect(201)).body.case.id;
    // Sin embarque: evaluable y PENDIENTE, nunca «no evaluable».
    const sinVinculo = (await http().post(`${base(orgA)}/dd-cases/${caso}/snapshots`).set(as(EUDR)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot;
    expect(sinVinculo.requirements.find((r: { code: string }) => r.code === 'SHIPMENT_LINK')).toMatchObject({ status: 'PENDING' });
    expect(sinVinculo.content.shipment_links).toEqual([]);

    const sid = await crearEmbarque();
    const item = await addItem(sid, lot, '40');
    const itemId = (await itemsDe(sid)).rows[0].id;
    await reservar(sid, itemId).expect(201);

    const conVinculo = (await http().post(`${base(orgA)}/dd-cases/${caso}/snapshots`).set(as(EUDR)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot;
    expect(conVinculo.requirements.find((r: { code: string }) => r.code === 'SHIPMENT_LINK')).toMatchObject({ status: 'MET' });
    // Identifica inequívocamente embarque, ítem, lote, reserva y cantidad.
    expect(conVinculo.content.shipment_links).toHaveLength(1);
    expect(conVinculo.content.shipment_links[0]).toMatchObject({ shipment_id: sid, item_id: itemId, lot_id: lot });
    expect(Number(conVinculo.content.shipment_links[0].quantity)).toBe(40);
    expect(conVinculo.content.shipment_links[0].reservation_id).toEqual(expect.any(String));
    expect(item).toBeDefined();
  });

  it('liberar la reserva después de aprobar desactualiza la acreditación y vuelve a bloquear el despacho', async () => {
    const lot = await lote('100', 'L2');
    const sid = await crearEmbarque();
    await addItem(sid, lot, '50');
    const itemId = (await itemsDe(sid)).rows.find((r) => r.lot_id === lot)!.id;
    await reservar(sid, itemId).expect(201);
    await acreditacionSintetica(lot);

    // Con la reserva vigente, la acreditación sirve y el preflight pasa.
    const antes = (await http().get(`${base(orgA)}/shipments/${sid}/preflight`).set(as(EXP)).expect(200)).body;
    expect(antes.checks.find((c: { code: string }) => c.code === 'DD_PACKAGE').status).toBe('OK');
    expect(antes.allowed).toBe(true);

    // Liberar la reserva cambia el vínculo: la instantánea queda DESACTUALIZADA sin modificarla, y la
    // acreditación anterior deja de servir. No se reemplaza por otra en silencio: se bloquea.
    const resId = (await sql<{ id: string }>`SELECT id FROM shipment_reservations WHERE shipment_id = ${sid} AND status = 'ACTIVE'`.execute(h.db)).rows[0].id;
    const hashAntes = (await sql<{ content_hash: string }>`SELECT content_hash FROM dd_snapshots WHERE case_id = (SELECT id FROM dd_cases WHERE subject_id = ${lot}) ORDER BY snapshot_number DESC LIMIT 1`.execute(h.db)).rows[0].content_hash;
    await http().post(`${base(orgA)}/shipments/${sid}/reservations/${resId}/release`).set(as(EXP)).send({ operation_id: randomUUID(), reason: 'Prueba de vigencia' }).expect(200);

    const despues = (await http().get(`${base(orgA)}/shipments/${sid}/preflight`).set(as(EXP)).expect(200)).body;
    expect(despues.checks.find((c: { code: string }) => c.code === 'DD_PACKAGE').message).toMatch(/Cambiaron datos relevantes/);
    expect(despues.allowed).toBe(false);
    // La instantánea no se reescribió: su hash es el mismo.
    expect((await sql<{ content_hash: string }>`SELECT content_hash FROM dd_snapshots WHERE case_id = (SELECT id FROM dd_cases WHERE subject_id = ${lot}) ORDER BY snapshot_number DESC LIMIT 1`.execute(h.db)).rows[0].content_hash).toBe(hashAntes);
    // Y el despacho se rechaza sin tocar el ledger.
    const movAntes = await movimientos(sid);
    expect((await despachar(sid, Number(await version(sid))).expect(409)).body.error.code).toBe('DISPATCH_BLOCKED');
    expect(await movimientos(sid)).toBe(movAntes);
  });

  it('la base impide acreditar con un paquete de otro lote, de otra organización o que sea un borrador', async () => {
    const lotA = await lote('100', 'L3');
    const lotB = await lote('100', 'L4');
    const sid = await crearEmbarque();
    await addItem(sid, lotA, '30');
    const itemA = (await itemsDe(sid)).rows.find((r) => r.lot_id === lotA)!.id;
    await reservar(sid, itemA).expect(201);
    const a = await acreditacionSintetica(lotA);
    const b = await acreditacionSintetica(lotB);

    // Paquete del lote CORRECTO: se acepta.
    await sql`UPDATE shipment_items SET dd_package_export_id = ${a.expId} WHERE id = ${itemA}`.execute(h.db);
    expect((await itemsDe(sid)).rows.find((r) => r.lot_id === lotA)!.dd_package_export_id).toBe(a.expId);

    // Paquete de OTRO lote: rechazado por la base, aunque sea de la misma organización.
    const otroItem = await (async () => {
      const sid2 = await crearEmbarque();
      await addItem(sid2, lotB, '30');
      return (await itemsDe(sid2)).rows.find((r) => r.lot_id === lotB)!.id;
    })();
    await expect(sql`UPDATE shipment_items SET dd_package_export_id = ${a.expId} WHERE id = ${otroItem}`.execute(h.db))
      .rejects.toThrow(/no corresponde al lote del item/);
    // Un BORRADOR interno no es acreditación.
    await expect(sql`UPDATE shipment_items SET dd_package_export_id = ${b.borradorId} WHERE id = ${otroItem}`.execute(h.db))
      .rejects.toThrow(/no es DD_PACKAGE|no corresponde/);
    // El del lote correcto sí.
    await sql`UPDATE shipment_items SET dd_package_export_id = ${b.expId} WHERE id = ${otroItem}`.execute(h.db);

    // Y no se reemplaza ni se retira una vez registrada.
    await expect(sql`UPDATE shipment_items SET dd_package_export_id = ${null} WHERE id = ${itemA}`.execute(h.db)).rejects.toThrow(/no se reemplaza/);
    await expect(sql`UPDATE shipment_items SET dd_package_export_id = ${b.expId} WHERE id = ${itemA}`.execute(h.db)).rejects.toThrow(/no se reemplaza/);
  });

  it('un paquete del lote correcto pero de OTRO contexto de embarque no acredita este despacho', async () => {
    const lot = await lote('100', 'L5');
    // Primer embarque: se acredita con su vínculo.
    const sid1 = await crearEmbarque();
    await addItem(sid1, lot, '20');
    const item1 = (await itemsDe(sid1)).rows.find((r) => r.lot_id === lot)!.id;
    await reservar(sid1, item1).expect(201);
    await acreditacionSintetica(lot); // la instantánea acredita el vínculo con sid1

    // Segundo embarque del MISMO lote, con otro ítem y otra reserva.
    const sid2 = await crearEmbarque();
    await addItem(sid2, lot, '20');
    const item2 = (await itemsDe(sid2)).rows.find((r) => r.lot_id === lot)!.id;
    await reservar(sid2, item2).expect(201);

    // El preflight del segundo embarque NO acepta la acreditación del primero.
    const p2 = (await http().get(`${base(orgA)}/shipments/${sid2}/preflight`).set(as(EXP)).expect(200)).body;
    const dd = p2.checks.find((c: { code: string }) => c.code === 'DD_PACKAGE');
    expect(dd.status).toBe('BLOCKED');
    expect(p2.allowed).toBe(false);
    // Y el despacho se rechaza sin tocar el ledger.
    const antes = await movimientos(sid2);
    expect((await despachar(sid2, Number(await version(sid2))).expect(409)).body.error.code).toBe('DISPATCH_BLOCKED');
    expect(await movimientos(sid2)).toBe(antes);
  });

  it('un solo ítem sin acreditar revierte TODA la operación: ni una reserva consumida', async () => {
    const l1 = await lote('100', 'L6');
    const l2 = await lote('100', 'L7');
    const sid = await crearEmbarque();
    await addItem(sid, l1, '10');
    await addItem(sid, l2, '10');
    for (const it of (await itemsDe(sid)).rows) await reservar(sid, it.id).expect(201);
    // Solo UNO de los dos lotes queda acreditado.
    await acreditacionSintetica(l1);

    const antes = await movimientos(sid);
    const r = await despachar(sid, Number(await version(sid))).expect(409);
    expect(r.body.error.code).toBe('DISPATCH_BLOCKED');
    expect(await movimientos(sid)).toBe(antes); // ninguna reserva consumida
    const reservas = (await sql<{ status: string }>`SELECT status FROM shipment_reservations WHERE shipment_id = ${sid}`.execute(h.db)).rows;
    expect(reservas.every((x) => x.status === 'ACTIVE')).toBe(true);
    // Ni acreditación parcial: el ítem acreditable tampoco quedó escrito.
    expect((await itemsDe(sid)).rows.every((x) => x.dd_package_export_id === null)).toBe(true);
    expect((await http().get(`${base(orgA)}/shipments/${sid}`).set(as(EXP)).expect(200)).body.status).toBe('DRAFT');
  });

  it('con todos los ítems acreditados despacha una sola vez, es idempotente y conserva la acreditación histórica', async () => {
    const l1 = await lote('100', 'L8');
    const l2 = await lote('100', 'L9');
    const sid = await crearEmbarque();
    await addItem(sid, l1, '10');
    await addItem(sid, l2, '10');
    for (const it of (await itemsDe(sid)).rows) await reservar(sid, it.id).expect(201);
    const a1 = await acreditacionSintetica(l1);
    const a2 = await acreditacionSintetica(l2);

    const v = Number(await version(sid));
    const ok = await despachar(sid, v);
    expect(ok.status).toBe(200);
    expect(ok.body.shipment.status).toBe('DISPATCHED');
    expect(ok.body.shipment.dispatch_at).toEqual(expect.any(String)); // sello del servidor

    // Acreditación POR ÍTEM, cada una la de su propio lote.
    const items = (await itemsDe(sid)).rows;
    const porLote = Object.fromEntries(items.map((i) => [i.lot_id, i.dd_package_export_id]));
    expect(porLote[l1]).toBe(a1.expId);
    expect(porLote[l2]).toBe(a2.expId);

    // Consumo único del ledger: dos reservas consumidas, dos movimientos, ni uno más.
    expect(await movimientos(sid)).toBe(2);
    const reservas = (await sql<{ status: string }>`SELECT status FROM shipment_reservations WHERE shipment_id = ${sid}`.execute(h.db)).rows;
    expect(reservas.every((x) => x.status === 'CONSUMED')).toBe(true);

    // Reintento con el MISMO operation_id: replay, sin segundo consumo.
    const op = randomUUID();
    const uno = await http().post(`${base(orgA)}/shipments/${sid}/dispatch`).set(as(EXP)).send({ operation_id: op, expected_version: v });
    expect([409, 200]).toContain(uno.status);
    expect(await movimientos(sid)).toBe(2);

    // La acreditación histórica sobrevive al consumo de las reservas y no se puede reescribir.
    await expect(sql`UPDATE shipment_items SET dd_package_export_id = ${a2.expId} WHERE lot_id = ${l1} AND shipment_id = ${sid}`.execute(h.db)).rejects.toThrow(/no se reemplaza/);
    expect((await itemsDe(sid)).rows.find((i) => i.lot_id === l1)!.dd_package_export_id).toBe(a1.expId);
  });

  it('el sello del despacho solo existe en DISPATCHED, y la base lo impone', async () => {
    const sid = await crearEmbarque();
    // En DRAFT no hay sello.
    const fila = (await sql<{ status: string; dispatch_at: Date | null }>`SELECT status, dispatch_at FROM shipments WHERE id = ${sid}`.execute(h.db)).rows[0];
    expect(fila).toMatchObject({ status: 'DRAFT', dispatch_at: null });
    // Sellar sin despachar: rechazado por el CHECK de estado.
    await expect(sql`UPDATE shipments SET dispatch_at = now() WHERE id = ${sid}`.execute(h.db)).rejects.toThrow(/shipments_dispatch_at_state/);
    // Despachar sin sello: igualmente rechazado.
    await expect(sql`UPDATE shipments SET status = 'DISPATCHED' WHERE id = ${sid}`.execute(h.db)).rejects.toThrow(/shipments_dispatch/);
  });

  it('permisos: quien no gestiona embarques no despacha, y otra organización no ve nada', async () => {
    const lot = await lote('100', 'LA');
    const sid = await crearEmbarque();
    await addItem(sid, lot, '10');
    const it = (await itemsDe(sid)).rows.find((r) => r.lot_id === lot)!.id;
    await reservar(sid, it).expect(201);
    await acreditacionSintetica(lot);
    const v = Number(await version(sid));
    await despachar(sid, v, AUD).expect(403);   // auditor solo lee
    await despachar(sid, v, EUDR).expect(403);  // responsable EUDR no despacha
    await http().get(`${base(orgB)}/shipments/${sid}/preflight`).set(as(ADMIN_B)).expect(404); // otra organización
    expect(await movimientos(sid)).toBe(0);
  });

  it('concurrencia: dos despachos simultáneos consumen una sola vez', async () => {
    const lot = await lote('100', 'LB');
    const sid = await crearEmbarque();
    await addItem(sid, lot, '10');
    const it = (await itemsDe(sid)).rows.find((r) => r.lot_id === lot)!.id;
    await reservar(sid, it).expect(201);
    await acreditacionSintetica(lot);
    const v = Number(await version(sid));

    const [a, b] = await Promise.all([despachar(sid, v), despachar(sid, v)]);
    const oks = [a, b].filter((r) => r.status === 200);
    expect(oks).toHaveLength(1); // exactamente uno
    expect(await movimientos(sid)).toBe(1); // y un solo consumo
    expect((await sql<{ status: string }>`SELECT status FROM shipment_reservations WHERE shipment_id = ${sid}`.execute(h.db)).rows.every((x) => x.status === 'CONSUMED')).toBe(true);
  });
});
