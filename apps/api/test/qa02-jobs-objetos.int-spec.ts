import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { describeDb, setupHarness } from './helpers';

// QA-02 — Matriz de **jobs y objetos**, criterio de P0-003 («checks de FK/jobs/objects»).
//
// Este criterio se difirió «hasta que existan esos recursos». Ya existen: descargas de documentos,
// exportaciones del expediente, trabajos satelitales, exportaciones de reportes y de la bitácora. Esta suite
// los reúne en una sola matriz, que es lo que faltaba para acreditarlo: había aislamiento probado en suites
// sueltas, pero no una comprobación consolidada.
//
// **Cada denegación va acompañada de su CONTROL AUTORIZADO.** Sin él no se distinguiría «deniega
// correctamente» de «la ruta no existe» o «el servicio no responde» — el defecto que se corrigió el
// 2026-10-16 en el procedimiento de revisión (`e2e/review/comprobacion.mjs`).
describeDb('QA-02 jobs y objetos: ningún acceso cruzado, con control autorizado en cada caso', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA = '';
  let orgB = '';
  let docVersionA = '';
  let docIdA = '';
  let exportA = '';
  let jobA = '';
  let plotA = '';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  /** PDF mínimo válido: el formato se comprueba por contenido, no por el tipo declarado. */
  const PDF = Buffer.from(['%PDF-1.4', '1 0 obj<</Type/Catalog>>endobj', 'trailer<</Root 1 0 R>>', '%%EOF', ''].join(String.fromCharCode(10)), 'latin1');
  const ADMIN_A = 'admin-a@test.local';
  const ADMIN_B = 'admin-b@test.local';

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN_A);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local'))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop QA02 A', ADMIN_A);
    orgB = await mk('Coop QA02 B', ADMIN_B);

    // --- productor y parcela en A (dueños del documento y del trabajo satelital)
    const prod = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN_A)).send({ producer_code: 'QA02-P', legal_name: 'Finca QA-02' }).expect(201)).body.id;

    // --- objeto REAL en el depósito: documento con su versión y su contenido
    const subida = await http().post(`${base(orgA)}/documents`).set(as(ADMIN_A))
      .field('operation_id', randomUUID()).field('document_type', 'LAND_TENURE').field('owner_type', 'producer')
      .field('owner_id', prod).field('title', 'Escritura sintética QA-02').field('issuer', 'Registro sintético')
      .attach('file', PDF, { filename: 'qa02.pdf', contentType: 'application/pdf' });
    docIdA = subida.body?.document?.id ?? '';
    docVersionA = subida.body?.version?.id ?? subida.body?.document?.versions?.[0]?.id ?? '';

    // --- parcela en A, para los trabajos satelitales
    plotA = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN_A)).send({ producer_id: prod, plot_code: 'QA02-PAR', crop: 'Cacao' }).expect(201)).body.id;
    await http().post(`${base(orgA)}/plots/${plotA}/geometry-versions`).set(as(ADMIN_A))
      .send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.16, -0.848] }, area_declared_ha: 2 }).expect(201);
    // El encargo satelital se rechaza con las llamadas reales deshabilitadas; se crea la fila directamente para
    // tener un JOB de A que B no debe poder consultar. Fixture SINTÉTICA, declarada.
    jobA = randomUUID();
    const prov = (await sql<{ code: string; kind: string }>`SELECT code, kind FROM satellite_providers ORDER BY code LIMIT 1`.execute(h.db)).rows[0];
    const ver = (await sql<{ id: string; geometry_type: string }>`SELECT id, geometry_type FROM plot_versions WHERE plot_id = ${plotA} ORDER BY version_number DESC LIMIT 1`.execute(h.db)).rows[0];
    if (prov && ver) {
      await sql`INSERT INTO satellite_jobs (id, organization_id, plot_id, plot_version_id, geometry_hash, geometry_type,
                provider_code, provider_kind, adapter_contract_version, operation, request_fingerprint, status, requested_by, operation_id)
        VALUES (${jobA}, ${orgA}, ${plotA}, ${ver.id}, ${'e'.repeat(64)}, ${ver.geometry_type},
                ${prov.code}, ${prov.kind}, '1', 'FOREST_COVER', ${'f'.repeat(64)}, 'REQUESTED',
                (SELECT id FROM users WHERE email = ${ADMIN_A}), ${randomUUID()})`.execute(h.db);
    } else {
      jobA = '';
    }

    // --- lote real en A, sujeto del expediente
    const hoy = new Date().toISOString().slice(0, 10);
    const baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN_A)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    const centro = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN_A)).send({ code: 'C-QA02', name: 'Centro QA-02', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    const entrega = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN_A)).send({ operation_id: randomUUID(), producer_id: prod, product_id: baba, delivery_date: hoy, quantity_declared: '100', unit: 'KG', origins: [{ plot_id: plotA }], register: true }).expect(201)).body.delivery;
    const recepcion = (await http().post(`${base(orgA)}/deliveries/${entrega.id}/receptions`).set(as(ADMIN_A)).send({ operation_id: randomUUID(), location_id: centro, received_at: new Date().toISOString(), weighing: { method: 'Báscula sintética', quantity: '100', unit: 'KG', weighed_on: hoy } }).expect(201)).body.reception_id;

    // --- exportación REAL del expediente en A: el borrador interno no exige READY, así que se obtiene por la
    //     vía del producto y su hash es el de verdad (una exportación fabricada fallaría la integridad).
    const lote = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN_A)).send({ operation_id: randomUUID(), inputs: [{ reception_id: recepcion, quantity: '100' }] }).expect(201)).body.lot.id as string;
    const caso = (await http().post(`${base(orgA)}/dd-cases`).set(as(ADMIN_A)).send({ operation_id: randomUUID(), lot_id: lote, scope_note: 'Expediente QA-02' }).expect(201)).body.case.id;
    const snap = (await http().post(`${base(orgA)}/dd-cases/${caso}/snapshots`).set(as(ADMIN_A)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot.id;
    exportA = (await http().post(`${base(orgA)}/dd-snapshots/${snap}/exports`).set(as(ADMIN_A)).send({ operation_id: randomUUID(), kind: 'INTERNAL_REVIEW' }).expect(201)).body.export?.id
      ?? (await sql<{ id: string }>`SELECT id FROM dd_exports WHERE snapshot_id = ${snap} ORDER BY exported_at DESC LIMIT 1`.execute(h.db)).rows[0].id;
  });
  afterAll(async () => h?.close());

  /** Cada fila: el dueño accede (control) y el ajeno no, sin revelar existencia. */
  const matriz = () => [
    { recurso: 'exportación del expediente', ruta: (o: string) => `${base(o)}/dd-exports/${exportA}/download`, disponible: () => !!exportA },
    { recurso: 'trabajo satelital', ruta: (o: string) => `${base(o)}/satellite/analyses/${jobA}`, disponible: () => !!jobA },
    { recurso: 'contenido de documento', ruta: (o: string) => `${base(o)}/documents/${docIdA}/versions/${docVersionA}/content`, disponible: () => !!docVersionA },
    { recurso: 'exportación de indicadores', ruta: (o: string) => `${base(o)}/reports/indicators/export`, disponible: () => true },
    { recurso: 'exportación de reporte por entidad', ruta: (o: string) => `${base(o)}/reports/entities/plots/export`, disponible: () => true },
    { recurso: 'exportación de bitácora', ruta: (o: string) => `${base(o)}/audit-logs/export`, disponible: () => true },
  ];

  it('el dueño accede a cada job y objeto: control autorizado de toda la matriz', async () => {
    const resultados: Array<[string, number]> = [];
    for (const f of matriz()) {
      if (!f.disponible()) { resultados.push([f.recurso, -1]); continue; }
      const r = await http().get(f.ruta(orgA)).set(as(ADMIN_A));
      resultados.push([f.recurso, r.status]);
    }
    // Ningún recurso puede quedar sin control: si no se pudo preparar, la matriz no acredita nada sobre él.
    const sinPreparar = resultados.filter(([, s]) => s === -1).map(([n]) => n);
    expect(sinPreparar).toEqual([]);
    // El dueño obtiene respuesta útil (200) en todos: así las denegaciones de abajo significan algo.
    for (const [nombre, status] of resultados) expect([nombre, status]).toEqual([nombre, 200]);
  });

  it('ninguna cuenta de otra organización accede, y no se revela existencia', async () => {
    for (const f of matriz()) {
      if (!f.disponible()) continue;
      // Pidiendo el recurso de A desde el ámbito de A: B no es miembro → 404, nunca 403 con detalle.
      const ajeno = await http().get(f.ruta(orgA)).set(as(ADMIN_B));
      expect([f.recurso, ajeno.status]).toEqual([f.recurso, 404]);
      // Y pidiéndolo desde SU propio ámbito, el identificador de A no existe para B.
      const propio = await http().get(f.ruta(orgB)).set(as(ADMIN_B));
      expect([f.recurso, propio.status === 404 || propio.status === 200]).toEqual([f.recurso, true]);
      if (propio.status === 200) {
        // Un listado/exportación propia de B no puede contener nada de A.
        expect(JSON.stringify(propio.body ?? '')).not.toContain(orgA);
      }
    }
  });

  it('sin autenticación no se obtiene ningún job ni objeto', async () => {
    for (const f of matriz()) {
      if (!f.disponible()) continue;
      const r = await http().get(f.ruta(orgA));
      expect([f.recurso, r.status]).toEqual([f.recurso, 401]);
    }
  });

  it('el objeto del depósito no es alcanzable por clave adivinada desde otra organización', async () => {
    const claves = (await sql<{ object_key: string }>`SELECT object_key FROM document_versions WHERE organization_id = ${orgA}`.execute(h.db)).rows;
    expect(claves.length).toBeGreaterThan(0); // control: hay algo que intentar alcanzar
    for (const k of claves) {
      // La clave lleva la organización dueña: aun conociéndola, la ruta de B no la sirve.
      expect(k.object_key).toContain(orgA);
      const r = await http().get(`${base(orgB)}/documents/${docIdA}/versions/${docVersionA}/content`).set(as(ADMIN_B));
      expect(r.status).toBe(404);
    }
  });
});
