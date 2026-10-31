import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import jsQR from 'jsqr';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// RF-47 — Referencia pública por entidad, contra PostgreSQL real. Datos SINTÉTICOS.
// Contrato adoptado: `docs/decisiones/RF-47-REFERENCIA-PUBLICA.md`.
//
// Lo que se fija aquí es lo que hace que una referencia pública sea utilizable sin ser peligrosa: que se emita
// sola para todo registro —incluidos los que ya existían—, que sea única **entre tipos** y no solo dentro de su
// tabla, que no se edite ni se reutilice, que sobreviva a las correcciones, que una instantánea anterior
// conserve la suya, que conocerla **no** conceda acceso y que lo ajeno y lo inexistente respondan igual.
describeDb('RF-47 referencia pública: emisión, unicidad entre tipos, estabilidad y resolución', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA = '';
  let orgB = '';
  let producer = '';
  let plot = '';
  let delivery = '';
  let lot = '';
  let shipment = '';
  let snap1 = '';
  let snap2 = '';
  let producerB = '';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local';
  const ADMIN_B = 'admin-b@test.local';
  const EUDR = 'eudr@test.local';
  const TEC = 'tecnico@test.local';
  const AUD = 'auditor@test.local';
  const EXPORT = 'export@test.local';

  /** La referencia que el registro guarda para una entidad. */
  const refOf = async (tipo: string, id: string) =>
    (await sql<{ reference: string }>`SELECT reference FROM public_references WHERE entity_type = ${tipo} AND entity_id = ${id}`.execute(h.db)).rows[0]?.reference;
  const resolve = (ref: string, actor: string) => http().get(`/api/v1/public-references/${ref}`).set(as(actor));
  const qr = (ref: string, actor: string) => http().get(`/api/v1/public-references/${ref}/qr.svg`).set(as(actor));
  /** El SVG llega como Buffer porque supertest no parsea `image/svg+xml`. */
  const svgDe = (r: { text?: string; body: unknown }) => r.text ?? Buffer.from(r.body as Buffer).toString('utf8');
  const link = (ref: string, actor: string) => http().get(`/api/v1/public-references/${ref}/link`).set(as(actor));

  async function join(o: string, email: string, role: string, admin = ADMIN) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
  }

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local'))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop RF47 A', ADMIN);
    orgB = await mk('Coop RF47 B', ADMIN_B);
    for (const [e, r] of [[EUDR, 'EUDR_MANAGER'], [TEC, 'FIELD_TECHNICIAN'], [AUD, 'AUDITOR'], [EXPORT, 'EXPORT_MANAGER']]) await join(orgA, e, r);

    producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'RF47-1', legal_name: 'Finca Referencia Sintética' }).expect(201)).body.id;
    const baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    const center = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CD', name: 'Centro RF47', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    plot = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: 'RF47-1-P1', crop: 'Cacao' }).expect(201)).body.id;
    await http().post(`${base(orgA)}/plots/${plot}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.1601, -0.8479] }, area_declared_ha: 2 }).expect(201);

    delivery = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: '90', unit: 'KG', origins: [{ plot_id: plot }], register: true }).expect(201)).body.delivery.id;
    const rec = (await http().post(`${base(orgA)}/deliveries/${delivery}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'B', quantity: '90', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    lot = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '90' }] }).expect(201)).body.lot.id;
    await http().post(`${base(orgA)}/risk/lots/${lot}/evaluations`).set(as(EUDR)).send({ operation_id: randomUUID() }).expect(201);

    const buyer = (await http().post(`${base(orgA)}/buyers`).set(as(EXPORT)).send({ operation_id: randomUUID(), code: 'IMP-RF47', name: 'Importador Sintético', country: 'NL' }).expect(201)).body.buyer.id;
    shipment = (await http().post(`${base(orgA)}/shipments`).set(as(EXPORT)).send({ operation_id: randomUUID(), buyer_id: buyer, destination_country: 'DE', origin_location_id: center }).expect(201)).body.shipment.id;

    // Dos instantáneas del mismo expediente: la primera debe conservar su referencia cuando llega la segunda.
    const caso = (await http().post(`${base(orgA)}/dd-cases`).set(as(EUDR)).send({ operation_id: randomUUID(), lot_id: lot, scope_note: 'Expediente sintético RF-47' }).expect(201)).body.case.id;
    snap1 = (await http().post(`${base(orgA)}/dd-cases/${caso}/snapshots`).set(as(EUDR)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot.id;
    snap2 = (await http().post(`${base(orgA)}/dd-cases/${caso}/snapshots`).set(as(EUDR)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot.id;

    producerB = (await http().post(`${base(orgB)}/producers`).set(as(ADMIN_B)).send({ producer_code: 'RF47-B', legal_name: 'Finca Ajena Sintética' }).expect(201)).body.id;
  });
  afterAll(async () => h?.close());

  it('se emite sola para cada entidad, opaca y sin parecerse al código operativo', async () => {
    for (const [tipo, id] of [['PRODUCER', producer], ['PLOT', plot], ['DELIVERY', delivery], ['LOT', lot], ['SHIPMENT', shipment], ['DD_SNAPSHOT', snap1], ['DD_SNAPSHOT', snap2]] as const) {
      const ref = await refOf(tipo, id);
      expect(ref).toMatch(/^[0-9a-f]{24}$/); // opaca, de longitud fija
      expect(ref).not.toBe(id); // no es el identificador interno
    }
    // No se parece a ningún código operativo ni los contiene.
    const ref = (await refOf('PRODUCER', producer))!;
    for (const code of ['RF47-1', 'RF47-1-P1']) expect(ref).not.toContain(code.toLowerCase());
  });

  it('la unicidad es efectiva ENTRE TIPOS y entre organizaciones, no solo dentro de cada tabla', async () => {
    const todas = (await sql<{ reference: string; n: string }>`
      SELECT reference, count(*)::text AS n FROM public_references GROUP BY reference HAVING count(*) > 1`.execute(h.db)).rows;
    expect(todas).toEqual([]); // ninguna repetida en todo el espacio de nombres

    const filas = (await sql<{ entity_type: string; reference: string }>`SELECT entity_type, reference FROM public_references`.execute(h.db)).rows;
    expect(new Set(filas.map((f) => f.reference)).size).toBe(filas.length);
    expect(new Set(filas.map((f) => f.entity_type)).size).toBeGreaterThan(1); // hay varios tipos conviviendo
    // Y las de la otra organización están en el MISMO espacio de nombres, así que tampoco pueden coincidir.
    expect(await refOf('PRODUCER', producerB)).not.toBe(await refOf('PRODUCER', producer));

    // La restricción es de verdad: la misma referencia para otro tipo se rechaza.
    const ref = await refOf('LOT', lot);
    await expect(sql`INSERT INTO public_references (reference, entity_type, entity_id, organization_id)
      VALUES (${ref}, 'PLOT', ${randomUUID()}, ${orgA})`.execute(h.db)).rejects.toThrow();
    // Y una entidad no puede recibir una segunda referencia.
    await expect(sql`INSERT INTO public_references (reference, entity_type, entity_id, organization_id)
      VALUES (${'f'.repeat(24)}, 'LOT', ${lot}, ${orgA})`.execute(h.db)).rejects.toThrow();
  });

  it('no se edita ni se reutiliza para otra entidad', async () => {
    const ref = (await refOf('PRODUCER', producer))!;
    await expect(sql`UPDATE public_references SET entity_id = ${randomUUID()} WHERE reference = ${ref}`.execute(h.db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM public_references WHERE reference = ${ref}`.execute(h.db)).rejects.toThrow(/append-only/);
    expect(await refOf('PRODUCER', producer)).toBe(ref);
  });

  it('incorpora registros existentes de forma idempotente, sin emitir dos veces', async () => {
    // Un registro creado con el disparador apagado: representa a los que ya existían antes de la migración.
    await sql`ALTER TABLE producers DISABLE TRIGGER producers_public_reference`.execute(h.db);
    const huerfano = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'RF47-SINREF', legal_name: 'Finca Sin Referencia' }).expect(201)).body.id;
    await sql`ALTER TABLE producers ENABLE TRIGGER producers_public_reference`.execute(h.db);
    expect(await refOf('PRODUCER', huerfano)).toBeUndefined();

    // La misma sentencia de incorporación que hace la migración.
    const backfill = () => sql`
      INSERT INTO public_references (reference, entity_type, entity_id, organization_id)
      SELECT public_reference_new(), 'PRODUCER', p.id, p.organization_id FROM producers p
      ON CONFLICT (entity_type, entity_id) DO NOTHING`.execute(h.db);

    await backfill();
    const ref = await refOf('PRODUCER', huerfano);
    expect(ref).toMatch(/^[0-9a-f]{24}$/);

    // Repetirla no cambia nada: ni una segunda referencia para él, ni referencias nuevas para los demás.
    const antes = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM public_references`.execute(h.db)).rows[0].n;
    await backfill();
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM public_references`.execute(h.db)).rows[0].n).toBe(antes);
    expect(await refOf('PRODUCER', huerfano)).toBe(ref);
  });

  it('bajo concurrencia, cada entidad recibe UNA sola referencia y ninguna se repite', async () => {
    const antes = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM public_references WHERE entity_type = 'PRODUCER'`.execute(h.db)).rows[0].n;
    const creados = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: `RF47-C${i}`, legal_name: `Finca Concurrente ${i}` }).expect(201)));
    const ids = creados.map((r) => r.body.id as string);

    const refs = await Promise.all(ids.map((id) => refOf('PRODUCER', id)));
    expect(refs.filter(Boolean)).toHaveLength(ids.length); // todos tienen
    expect(new Set(refs).size).toBe(ids.length); // y todas distintas
    expect(Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM public_references WHERE entity_type = 'PRODUCER'`.execute(h.db)).rows[0].n))
      .toBe(Number(antes) + ids.length); // ni una de más
  });

  it('la referencia sobrevive a una corrección y a una versión nueva de geometría', async () => {
    const antesP = await refOf('PRODUCER', producer);
    const antesPl = await refOf('PLOT', plot);
    const v = (await http().get(`${base(orgA)}/producers/${producer}`).set(as(ADMIN)).expect(200)).body.row_version;
    await http().patch(`${base(orgA)}/producers/${producer}`).set(as(ADMIN)).send({ expected_version: Number(v), legal_name: 'Finca Referencia Sintética (corregida)' }).expect(200);
    const pv = (await http().get(`${base(orgA)}/plots/${plot}`).set(as(ADMIN)).expect(200)).body.row_version;
    await http().post(`${base(orgA)}/plots/${plot}/geometry-versions`).set(as(ADMIN)).send({ expected_version: Number(pv), survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.16, -0.848] }, area_declared_ha: 3 }).expect(201);

    expect(await refOf('PRODUCER', producer)).toBe(antesP); // la corrección no la sustituye
    expect(await refOf('PLOT', plot)).toBe(antesPl); // la versión nueva tampoco
    // Y sigue resolviendo a la misma entidad, mostrando lo vigente.
    const r = await resolve(antesP!, ADMIN).expect(200);
    expect(r.body).toMatchObject({ entity_type: 'PRODUCER', id: producer });
  });

  it('una instantánea anterior conserva su referencia y nunca pasa a representar la nueva', async () => {
    const r1 = await refOf('DD_SNAPSHOT', snap1);
    const r2 = await refOf('DD_SNAPSHOT', snap2);
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(r1).not.toBe(r2);
    expect((await resolve(r1!, EUDR).expect(200)).body.id).toBe(snap1);
    expect((await resolve(r2!, EUDR).expect(200)).body.id).toBe(snap2);
  });

  it('tener referencia no altera el contenido histórico, el manifiesto ni el hash de la instantánea', async () => {
    const s = (await sql<{ content_hash: string; manifest: unknown; content: unknown; section_hashes: unknown }>`
      SELECT content_hash, manifest, content, section_hashes FROM dd_snapshots WHERE id = ${snap1}`.execute(h.db)).rows[0];
    const texto = JSON.stringify({ content: s.content, manifest: s.manifest, section_hashes: s.section_hashes });
    const ref = (await refOf('DD_SNAPSHOT', snap1))!;
    expect(texto).not.toContain(ref); // la referencia vive FUERA de lo que la instantánea acredita
    expect(texto).not.toContain('public_reference');
    // El hash sigue siendo el de su contenido: nada que ver con la referencia.
    expect(s.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.content_hash).not.toContain(ref);
  });

  it('conocer la referencia NO concede acceso: lo ajeno y lo inexistente responden igual', async () => {
    const ajena = (await refOf('PRODUCER', producerB))!; // existe, pero es de la organización B
    const inexistente = '0'.repeat(24);

    const a = await resolve(ajena, ADMIN).expect(404);
    const b = await resolve(inexistente, ADMIN).expect(404);
    // Indistinguibles salvo por el identificador de petición, que no dice nada del recurso: mismo estado,
    // mismo código y mismo mensaje. Si difirieran, la referencia sería un oráculo de existencia.
    expect(a.status).toBe(b.status);
    expect(a.body.error.code).toBe(b.body.error.code);
    expect(a.body.error.message).toBe(b.body.error.message);
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
    for (const cuerpo of [a.body, b.body]) expect(JSON.stringify(cuerpo)).not.toContain(producerB);

    // Y el dueño legítimo sí la resuelve.
    expect((await resolve(ajena, ADMIN_B).expect(200)).body).toMatchObject({ entity_type: 'PRODUCER', id: producerB, organization_id: orgB });
  });

  it('respeta los permisos efectivos actuales, incluido el alcance asignado, y no amplía ninguno', async () => {
    const refProd = (await refOf('PRODUCER', producer))!;
    const refLot = (await refOf('LOT', lot))!;
    const refSnap = (await refOf('DD_SNAPSHOT', snap1))!;

    // AUDITOR tiene producer:read y lot:read y dd:read → resuelve los tres.
    await resolve(refProd, AUD).expect(200);
    await resolve(refLot, AUD).expect(200);
    await resolve(refSnap, AUD).expect(200);

    // EXPORT_MANAGER no tiene producer:read ni dd:read; sí lot:read y shipment:read.
    await resolve(refProd, EXPORT).expect(404);
    await resolve(refSnap, EXPORT).expect(404);
    await resolve(refLot, EXPORT).expect(200);
    const refEmb = (await refOf('SHIPMENT', shipment))!;
    expect((await resolve(refEmb, EXPORT).expect(200)).body).toMatchObject({ entity_type: 'SHIPMENT', id: shipment });
    await resolve(refEmb, TEC).expect(404); // el técnico no tiene shipment:read

    // FIELD_TECHNICIAN solo tiene producer:read_assigned: sin asignación, no resuelve.
    await resolve(refProd, TEC).expect(404);
    const mem = (await sql<{ id: string }>`
      SELECT m.id FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE u.email = ${TEC} AND m.organization_id = ${orgA}`.execute(h.db)).rows[0].id;
    const v = (await http().get(`${base(orgA)}/producers/${producer}`).set(as(ADMIN)).expect(200)).body.row_version;
    await http().put(`${base(orgA)}/producers/${producer}/assignment`).set(as(ADMIN)).send({ expected_version: Number(v), membership_id: mem }).expect(200);
    await resolve(refProd, TEC).expect(200); // asignado: ahora sí, con el alcance de siempre
    await resolve(refSnap, TEC).expect(404); // pero dd:read sigue sin tenerlo
  });

  it('un rol retirado deja de resolver', async () => {
    const refLot = (await refOf('LOT', lot))!;
    await resolve(refLot, AUD).expect(200);
    await sql`DELETE FROM role_assignments ra USING memberships m, users u
      WHERE ra.membership_id = m.id AND m.user_id = u.id AND u.email = ${AUD} AND m.organization_id = ${orgA}`.execute(h.db);
    await resolve(refLot, AUD).expect(404); // sin rol, misma respuesta opaca
  });

  it('sin autenticación no resuelve nada', async () => {
    const refLot = (await refOf('LOT', lot))!;
    await http().get(`/api/v1/public-references/${refLot}`).expect(401);
  });

  // ---------------------------------------------------------------- RF-33: representación visual

  it('RF-33 el QR codifica SOLO el enlace de resolución: sin identificadores internos ni datos', async () => {
    const ref = (await refOf('LOT', lot))!;
    const r = await qr(ref, ADMIN).expect(200);
    expect(r.headers['content-type']).toMatch(/image\/svg\+xml/);
    const svg = svgDe(r);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('viewBox');

    const l = await link(ref, ADMIN).expect(200);
    expect(l.body.link).toMatch(new RegExp(`/r/${ref}$`));
    // Lo que NO va dentro: identificador interno, código operativo, organización ni nada personal.
    for (const prohibido of [lot, orgA, producer]) expect(l.body.link).not.toContain(prohibido);
    expect(l.body.note).toMatch(/no concede acceso/i);
    expect(l.body.note).toMatch(/No sustituye un DDS/i);
  });

  it('RF-33 el QR exige la MISMA autorización que resolver: lo ajeno y lo inexistente responden igual', async () => {
    const ajena = (await refOf('PRODUCER', producerB))!;
    const inexistente = '0'.repeat(24);
    const a = await qr(ajena, ADMIN).expect(404);
    const b = await qr(inexistente, ADMIN).expect(404);
    expect(a.body.error.code).toBe(b.body.error.code);
    expect(a.body.error.message).toBe(b.body.error.message);
    // Y no se filtra un QR por la puerta de al lado: tampoco el enlace.
    await link(ajena, ADMIN).expect(404);
    // CONTROL: su dueño sí obtiene el QR.
    await qr(ajena, ADMIN_B).expect(200);
  });

  it('RF-33 el QR respeta el alcance asignado, igual que la resolución', async () => {
    const refProd = (await refOf('PRODUCER', producer))!;
    // El técnico resuelve lo asignado…
    const puedeResolver = (await resolve(refProd, TEC)).status;
    const puedeQr = (await qr(refProd, TEC)).status;
    // …y el QR acompaña exactamente a esa decisión, sin ampliarla ni restringirla.
    expect(puedeQr).toBe(puedeResolver);
  });

  it('RF-33 sin autenticación no hay QR ni enlace', async () => {
    const ref = (await refOf('LOT', lot))!;
    await http().get(`/api/v1/public-references/${ref}/qr.svg`).expect(401);
    await http().get(`/api/v1/public-references/${ref}/link`).expect(401);
  });

  it('RF-33 el QR es ESTABLE: el mismo recurso da el mismo código', async () => {
    const ref = (await refOf('LOT', lot))!;
    const uno = svgDe(await qr(ref, ADMIN).expect(200));
    const dos = svgDe(await qr(ref, ADMIN).expect(200));
    expect(uno).toBe(dos);
    expect(uno.length).toBeGreaterThan(200);   // hay módulos de verdad, no un SVG vacío
  });

  it('RF-33 el QR DECODIFICA al enlace esperado, con un decodificador independiente', async () => {
    const ref = (await refOf('LOT', lot))!;
    const svg = svgDe(await qr(ref, ADMIN).expect(200));
    const esperado = (await link(ref, ADMIN).expect(200)).body.link as string;

    // Se rasteriza el SVG a partir de su propia geometría —cada módulo es 1 unidad del viewBox— y se decodifica
    // con `jsqr`, que NO es el codificador usado para generarlo: si coincidiera por construcción, la prueba no
    // demostraría nada.
    const lado = Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);
    const modulos = new Set((svg.match(/M(\d+) (\d+)h1v1h-1z/g) ?? []).map((m) => {
      const [, x, y] = /M(\d+) (\d+)/.exec(m)!;
      return `${x},${y}`;
    }));
    const esc = 4;
    const px = lado * esc;
    const datos = new Uint8ClampedArray(px * px * 4).fill(255);
    for (const celda of modulos) {
      const [x, y] = celda.split(',').map(Number);
      for (let dy = 0; dy < esc; dy++) {
        for (let dx = 0; dx < esc; dx++) {
          const i = ((y * esc + dy) * px + (x * esc + dx)) * 4;
          datos[i] = datos[i + 1] = datos[i + 2] = 0;
        }
      }
    }
    const leido = jsQR(datos, px, px);
    expect(leido).not.toBeNull();
    expect(leido!.data).toBe(esperado);
    // Y lo decodificado NO contiene identificadores internos.
    for (const prohibido of [lot, orgA]) expect(leido!.data).not.toContain(prohibido);
  });
});
