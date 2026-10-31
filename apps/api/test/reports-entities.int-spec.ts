import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// P0-030 — Reportes por entidad y exportación GeoJSON (S1 §97; RF-30; QA-13/14).
// Contrato: docs/decisiones/P0-030-REPORTES.md. Fixture SINTÉTICA con cifras conocidas; cada aserción compara contra
// lo construido en la prueba. Lo que se vigila aquí: alcance antes de agregar, sujetos sin evaluar visibles como tales,
// cantidades por unidad, identidad y coordenadas bajo su propio permiso, y CSV coherente con la pantalla.
describeDb('P0-030 reportes por entidad: alcance, desconocidos y exportación', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA: string;
  let orgB: string;
  let orgC: string;
  let product: string;
  let center: string;
  let prod1: string;
  let lote: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o: string) => `/api/v1/organizations/${o}`;
  const ADMIN = 'admin-a@test.local';
  const AUD = 'auditor@test.local';
  const EUDR = 'eudr@test.local';

  type Report = {
    kind: string; title: string; source: string; requires: string[]; period_applies: boolean; period_note: string;
    columns: Array<{ key: string; label: string; note?: string }>;
    rows: Array<Record<string, string | number | null>>;
    totals: Array<{ key: string; label: string; value: string }>;
    notes: string[]; total_rows: number; returned_rows: number; has_more: boolean; can_export: boolean;
    page: { limit: number; cursor: string | null; next_cursor: string | null; key: string };
    why: Record<string, string>; snapshot_note: string; export_note: string; export_limit: number;
    coverage: { status: string; note: string }; limit_note: string; time_basis: { as_of: string };
  };
  const get = async (actor: string, kind: string, qs = '', o = orgA) =>
    (await http().get(`${api(o)}/reports/entities/${kind}${qs}`).set(as(actor)).expect(200)).body as Report;
  const total = (r: Report, key: string) => r.totals.find((t) => t.key === key)!.value;
  const row = (r: Report, key: string, value: string) => r.rows.find((x) => String(x[key]) === value)!;

  const ring = (pts: number[][]) => [[...pts, pts[0]]];
  const sq = (x: number, y: number, d = 0.01) => ring([[x, y], [x + d, y], [x + d, y + d], [x, y + d]]);

  async function join(email: string, role: string) {
    const inv = await http().post(`${api(orgA)}/invitations`).set(as(ADMIN)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'P', last_name: role.toLowerCase(), password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const delivery = async (producer: string, date: string, q: string, origins?: Array<{ plot_id: string }>) =>
    (await http().post(`${api(orgA)}/deliveries`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), producer_id: producer, product_id: product, delivery_date: date, quantity_declared: q, unit: 'KG', register: true, ...(origins ? { origins } : {}) }).expect(201)).body.delivery;

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user('admin-b@test.local');
    const mk = async (name: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Entidades A', ADMIN);
    orgB = await mk('Coop Entidades B', 'admin-b@test.local');
    orgC = await mk('Coop Entidades C (volumen)', ADMIN);
    // Cobertura histórica DECLARADA (migración 0076) para esta organización de ensayo; otra sin declaración sale «desconocida».
    await sql`INSERT INTO report_coverage_declarations (id, organization_id, status, event_date, note, reference, declared_by)
      VALUES (${randomUUID()}, ${orgA}, 'INCOMPLETE', '2026-10-13', 'Cobertura histórica incompleta (declaración SINTÉTICA de ensayo): se perdieron registros creados antes del 2026-10-13. Los registros disponibles se incluyen SIEMPRE por su fecha operativa declarada, aunque sea anterior a esa fecha; por eso un período antiguo puede devolver menos de lo que ocurrió.', 'docs/qa/HALLAZGO_PERDIDA_DATOS_DEMO_2026-10-13.md', 'prueba')`.execute(h.db);
    for (const [e, r] of [[AUD, 'AUDITOR'], [EUDR, 'EUDR_MANAGER'], ['exportacion@test.local', 'EXPORT_MANAGER'], ['tecnico@test.local', 'FIELD_TECHNICIAN'], ['trazabilidad@test.local', 'TRACEABILITY_MANAGER']]) await join(e, r);
    product = (await http().post(`${api(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${api(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CR', name: 'Centro', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;

    // Fixture: 2 productores vigentes (+1 dado de baja), 3 parcelas en tres situaciones distintas de ubicación.
    prod1 = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'E-1', legal_name: 'Finca Uno' }).expect(201)).body.id;
    const prod2 = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'E-2', legal_name: 'Finca Dos' }).expect(201)).body.id;
    const baja = (await http().post(`${api(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'E-9', legal_name: 'Finca Baja' }).expect(201)).body;
    await http().post(`${api(orgA)}/producers/${baja.id}/archive`).set(as(ADMIN)).send({ expected_version: 1, reason: 'Fuera de la fixture' }).expect(200);
    const mkPlot = async (producer: string, code: string) => (await http().post(`${api(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: code, crop: 'Cacao' }).expect(201)).body.id;
    const conGeometria = await mkPlot(prod1, 'E-1-P1');
    const soloSuperficie = await mkPlot(prod1, 'E-1-P2');
    await mkPlot(prod2, 'E-2-P1'); // sin versión: ni geometría ni superficie
    await http().post(`${api(orgA)}/plots/${conGeometria}/geometry-versions`).set(as(ADMIN))
      .send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Polygon', coordinates: sq(-79.5, -1.0) } }).expect(201);
    await http().post(`${api(orgA)}/plots/${soloSuperficie}/geometry-versions`).set(as(ADMIN))
      .send({ expected_version: 1, survey_method: 'DECLARED', area_declared_ha: 2.5 }).expect(201);

    // Entregas: 2 en septiembre (fecha operativa anterior a la pérdida, registradas hoy) y 1 en octubre.
    const d1 = await delivery(prod1, '2026-09-10', '100', [{ plot_id: conGeometria }]);
    await delivery(prod1, '2026-09-20', '200');
    const d3 = await delivery(prod2, '2026-10-05', '300');
    // Dos lotes: uno con origen declarado completo y otro sin orígenes.
    const mkLot = async (d: { id: string }, q: string) => {
      const r = (await http().post(`${api(orgA)}/deliveries/${d.id}/receptions`).set(as(ADMIN))
        .send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(), weighing: { method: 'Báscula', quantity: q, unit: 'KG', weighed_on: '2026-10-08' } }).expect(201)).body.reception_id;
      return (await http().post(`${api(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: r, quantity: q }] }).expect(201)).body.lot;
    };
    lote = (await mkLot(d1, '100')).id;
    await mkLot(d3, '300');
    // Un expediente DD sobre el primer lote: su instantánea sale BLOCKED por dependencias abiertas.
    const caso = (await http().post(`${api(orgA)}/dd-cases`).set(as(ADMIN)).send({ operation_id: randomUUID(), lot_id: lote, scope_note: 'Expediente de la fixture' }).expect(201)).body;
    await http().post(`${api(orgA)}/dd-cases/${caso.case.id}/snapshots`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201);
    // Una evaluación de riesgo sobre ese mismo lote: el motor devuelve NOT_ASSESSED por diseño (P0-020).
    await http().post(`${api(orgA)}/risk/lots/${lote}/evaluations`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201);
    // Organización B: material que nunca debe cruzarse.
    await http().post(`${api(orgB)}/producers`).set(as('admin-b@test.local')).send({ producer_code: 'B-1', legal_name: 'Ajena' }).expect(201);
  });
  afterAll(async () => h?.close());

  it('catálogo: los seis reportes de S1 §97 y el GeoJSON, con el permiso que exige cada uno y lo que le falta al rol', async () => {
    const c = (await http().get(`${api(orgA)}/reports/entities`).set(as(ADMIN)).expect(200)).body;
    expect(c.reports.map((r: { kind: string }) => r.kind)).toEqual(['producers', 'plots', 'lots', 'risk', 'traceability', 'dd']);
    expect(c.reports.every((r: { available: boolean }) => r.available)).toBe(true);
    // Cada reporte publica el permiso de CADA dominio del que muestra datos, con su motivo.
    const porTipoAdmin = Object.fromEntries(c.reports.map((r: { kind: string; requires: string[]; why: Record<string, string> }) => [r.kind, r]));
    expect(porTipoAdmin.producers.requires).toEqual(['producer:read', 'plot:read', 'delivery:read']);
    expect(porTipoAdmin.traceability.requires).toEqual(['lot:read', 'delivery:read', 'plot:read']);
    expect(porTipoAdmin.producers.why['plot:read']).toMatch(/parcelas/);
    expect(c.cross_domain_note).toMatch(/no autoriza a conocer/i);
    expect(c.geojson.requires).toEqual(['report:export', 'plot:read', 'plot:read_geometry', 'producer:read']);
    // EXPORT_MANAGER entra a la pantalla pero casi ningún reporte le está disponible, y se le dice cuál le falta.
    const limitado = (await http().get(`${api(orgA)}/reports/entities`).set(as('exportacion@test.local')).expect(200)).body;
    const porTipo = Object.fromEntries(limitado.reports.map((r: { kind: string; available: boolean; missing: string[] }) => [r.kind, r]));
    expect(porTipo.producers).toMatchObject({ available: false, missing: ['producer:read', 'plot:read', 'delivery:read'] });
    expect(porTipo.lots.available).toBe(true);
    expect(limitado.geojson).toMatchObject({ available: false });
    expect(limitado.geojson.missing).toContain('plot:read_geometry');
  });

  it('productores: conteos conocidos, período solo sobre entregas y totales sobre el conjunto completo', async () => {
    const r = await get(ADMIN, 'producers');
    expect(r.source).toMatch(/§97/);
    expect(r.rows).toHaveLength(2); // el dado de baja no aparece
    expect(row(r, 'producer_code', 'E-1')).toMatchObject({ plots: 2, plots_with_geometry: 1, deliveries: 2 });
    expect(row(r, 'producer_code', 'E-2')).toMatchObject({ plots: 1, plots_with_geometry: 0, deliveries: 1 });
    expect(total(r, 'productores')).toBe('2');
    expect(total(r, 'parcelas')).toBe('3');
    expect(total(r, 'con_geometria')).toBe('1');
    expect(total(r, 'entregas')).toBe('3');
    // El período se aplica SOLO a entregas, por delivery_date: septiembre deja 2 (ambas de E-1) y 0 para E-2.
    const sept = await get(ADMIN, 'producers', '?from=2026-09-01&to=2026-09-30');
    expect(row(sept, 'producer_code', 'E-1').deliveries).toBe(2);
    expect(row(sept, 'producer_code', 'E-2').deliveries).toBe(0);
    expect(row(sept, 'producer_code', 'E-2').plots).toBe(1); // el resto de columnas no se filtra por el período
    expect(total(sept, 'entregas')).toBe('2');
    // Las entregas de septiembre se registraron HOY, tras la pérdida del 13-oct: la fecha operativa manda.
    expect(sept.coverage.status).toBe('INCOMPLETE');
    expect(r.notes.join(' ')).toMatch(/no se suman cantidades/i); // unidades distintas no se suman
  });

  it('identidad: los nombres exigen producer:read_identity y nunca aparecen documentos ni teléfonos', async () => {
    const conIdentidad = await get(EUDR, 'producers'); // EUDR_MANAGER tiene producer:read_identity
    expect(row(conIdentidad, 'producer_code', 'E-1').nombre).toBe('Finca Uno');
    const sinIdentidad = await get(AUD, 'producers'); // AUDITOR lee productores, pero no su identidad
    expect(row(sinIdentidad, 'producer_code', 'E-1').nombre).toBeNull();
    expect(sinIdentidad.notes.join(' ')).toMatch(/sin producer:read_identity/i);
    for (const texto of [JSON.stringify(conIdentidad), JSON.stringify(sinIdentidad)]) {
      for (const prohibido of ['document_number', 'phone_enc', 'address_enc']) expect(texto).not.toContain(prohibido);
    }
  });

  it('parcelas: distingue sin versión, solo superficie y geometría; «sin evaluar» no es «inválida» ni cero', async () => {
    const r = await get(ADMIN, 'plots');
    expect(r.rows).toHaveLength(3);
    expect(row(r, 'plot_code', 'E-1-P1')).toMatchObject({ geometry_status: 'GEOMETRÍA REGISTRADA', validation_status: 'SIN EVALUAR' });
    expect(row(r, 'plot_code', 'E-1-P2')).toMatchObject({ geometry_status: 'SOLO SUPERFICIE DECLARADA', area_declared_ha: '2.5000' });
    expect(row(r, 'plot_code', 'E-2-P1')).toMatchObject({ geometry_status: 'SIN VERSIÓN', validation_status: null });
    expect(total(r, 'parcelas')).toBe('3');
    expect(total(r, 'con_geometria')).toBe('1');
    expect(total(r, 'solo_superficie')).toBe('1');
    expect(total(r, 'sin_version')).toBe('1');
    expect(total(r, 'evaluadas')).toBe('0');
    // Ninguna evaluada: el total de válidas NO puede ser 0, que se leería como «ninguna cumple».
    expect(total(r, 'validas')).toMatch(/DESCONOCIDO/);
    expect(total(r, 'validas')).toMatch(/D-05/);
    // El reporte tabular nunca lleva coordenadas.
    expect(JSON.stringify(r)).not.toMatch(/-79\.5/);
  });

  it('lotes: cantidades por unidad, sin un total único entre unidades distintas', async () => {
    const r = await get(ADMIN, 'lots');
    expect(r.rows).toHaveLength(2);
    expect(total(r, 'lotes')).toBe('2');
    expect(total(r, 'origen_completo')).toBe('1');
    expect(total(r, 'origen_incompleto')).toBe('1');
    const porUnidad = r.totals.filter((t) => t.key.startsWith('cantidad_'));
    expect(porUnidad).toHaveLength(1);
    expect(porUnidad[0].key).toBe('cantidad_KG');
    expect(r.totals.find((t) => t.key === 'cantidad_total')).toBeUndefined(); // no existe un total sin unidad
    expect(r.notes.join(' ')).toMatch(/POR UNIDAD/);
    expect(r.notes.join(' ')).toMatch(/reserva de embarque no es un despacho/i);
    for (const fila of r.rows) expect(fila.unit).toBe('KG'); // cada fila lleva su unidad explícita
  });

  it('riesgo: el lote sin evaluar aparece como tal y los totales por severidad salen DESCONOCIDO, no cero', async () => {
    const r = await get(EUDR, 'risk');
    expect(r.rows).toHaveLength(2); // los dos lotes, evaluado y no evaluado
    const evaluado = r.rows.find((x) => x.severity === 'NOT_ASSESSED')!;
    expect(evaluado).toMatchObject({ evaluaciones: 1 });
    expect(r.rows.some((x) => x.severity === 'SIN EVALUAR')).toBe(true);
    expect(total(r, 'lotes')).toBe('2');
    expect(total(r, 'evaluados')).toBe('1');
    expect(total(r, 'sin_evaluar')).toBe('1');
    expect(total(r, 'sin_severidad')).toBe('1');
    for (const k of ['alto', 'medio', 'bajo']) expect(total(r, k)).toMatch(/DESCONOCIDO/);
    expect(r.notes.join(' ')).toMatch(/no se omite/i);
  });

  it('trazabilidad: completitud de origen declarado desde las entradas reales, con el denominador a la vista', async () => {
    const r = await get(ADMIN, 'traceability');
    expect(r.rows).toHaveLength(2);
    const completo = r.rows.find((x) => x.origin_status === 'COMPLETE')!;
    expect(completo).toMatchObject({ entradas: 1, origen_conocido: 1, origen_desconocido: 0, entregas: 1, parcelas: 1 });
    const incompleto = r.rows.find((x) => x.origin_status === 'INCOMPLETE')!;
    expect(incompleto).toMatchObject({ entradas: 1, origen_conocido: 0, origen_desconocido: 1, parcelas: 0 });
    expect(total(r, 'completitud')).toBe('50.0');
    expect(r.notes.join(' ')).toMatch(/ORIGEN DECLARADO/);
  });

  it('debida diligencia: el expediente BLOCKED se cuenta y READY no se confunde con conformidad', async () => {
    const r = await get(EUDR, 'dd');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ readiness: 'BLOCKED', instantaneas: 1 });
    expect(total(r, 'expedientes')).toBe('1');
    expect(total(r, 'blocked')).toBe('1');
    expect(total(r, 'ready')).toBe('0'); // cero observado: hay expediente y su preparación se conoce
    expect(r.notes.join(' ')).toMatch(/no significa presentación oficial/i);
  });

  it('permisos y aislamiento: sin el permiso del dominio no hay versión parcial, y otra organización es 404', async () => {
    // EXPORT_MANAGER no lee productores: el reporte entero se deniega, no se entrega recortado.
    const res = await http().get(`${api(orgA)}/reports/entities/producers`).set(as('exportacion@test.local')).expect(403);
    expect(res.body.error.message).toMatch(/no se entrega una versión parcial/i);
    // Y el mensaje nombra CADA dominio que falta, no solo el de las filas: contar parcelas y entregas también se autoriza.
    for (const permiso of ['producer:read', 'plot:read', 'delivery:read']) expect(res.body.error.message).toContain(permiso);
    expect(res.body.error.message).toMatch(/cuenta sus parcelas/);
    expect(res.body.error.message).not.toMatch(/\d+/); // ninguna cifra del dominio restringido
    // TRACEABILITY_MANAGER no tiene dd:read; sí tiene lot:read.
    await http().get(`${api(orgA)}/reports/entities/dd`).set(as('trazabilidad@test.local')).expect(403);
    await http().get(`${api(orgA)}/reports/entities/lots`).set(as('trazabilidad@test.local')).expect(200);
    // El alcance por asignación no abre reportes de organización: el técnico no tiene report:read.
    await http().get(`${api(orgA)}/reports/entities/plots`).set(as('tecnico@test.local')).expect(403);
    // Otra organización: 404 sin filtrar la existencia, y los datos ajenos nunca aparecen.
    await http().get(`${api(orgB)}/reports/entities/producers`).set(as(ADMIN)).expect(404);
    expect(JSON.stringify(await get(ADMIN, 'producers'))).not.toContain('B-1');
    // Un reporte inexistente no filtra nada tampoco.
    await http().get(`${api(orgA)}/reports/entities/inventado`).set(as(ADMIN)).expect(404);
  });

  it('paginación sobre más de 500 filas: estable, sin duplicados ni omisiones, y totales del conjunto completo', async () => {
    // 520 productores en una organización aparte, insertados en la base para no depender de 520 peticiones HTTP.
    // Son datos SINTÉTICOS con la misma forma que crearía la API; el reporte no sabe de dónde salieron.
    const plantilla = (await sql<{ created_by: string; status: string }>`SELECT created_by, status FROM producers WHERE organization_id = ${orgA} LIMIT 1`.execute(h.db)).rows[0];
    await sql`
      INSERT INTO producers (organization_id, producer_code, legal_name, status, created_at, created_by, updated_at, updated_by)
      SELECT ${orgC}, 'V-' || lpad(g::text, 4, '0'), 'Finca volumen ' || g, ${plantilla.status}, now(), ${plantilla.created_by}, now(), ${plantilla.created_by}
      FROM generate_series(1, 520) g`.execute(h.db);

    const codigos: string[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    let total = 0;
    do {
      const qs: string = `?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page: Report = await get(ADMIN, 'producers', qs, orgC);
      expect(page.page.limit).toBe(200);
      expect(page.page.key).toBe('producer_code');
      codigos.push(...page.rows.map((r) => String(r.producer_code)));
      total = page.total_rows;
      // El total es SIEMPRE el del conjunto completo, no el de la página.
      expect(Number(total)).toBe(520);
      expect(page.totals.find((t) => t.key === 'productores')!.value).toBe('520');
      cursor = page.page.next_cursor;
      paginas++;
      expect(paginas).toBeLessThan(10); // si el cursor no avanzara, esto cortaría el bucle
    } while (cursor);

    expect(paginas).toBe(3); // 200 + 200 + 120
    expect(codigos).toHaveLength(520);                       // sin omisiones
    expect(new Set(codigos).size).toBe(520);                 // sin duplicados
    expect([...codigos].sort()).toEqual(codigos);            // orden estable por la clave natural
    expect(codigos[0]).toBe('V-0001');
    expect(codigos[519]).toBe('V-0520');

    // Un límite por encima del máximo se recorta al máximo declarado, no lo desborda.
    const grande: Report = await get(ADMIN, 'producers', '?limit=500', orgC);
    expect(grande.rows).toHaveLength(500);
    expect(grande.has_more).toBe(true);
    await http().get(`${api(orgC)}/reports/entities/producers?limit=501`).set(as(ADMIN)).expect(400);

    // La exportación cubre el CONJUNTO COMPLETO en una sola instantánea, recorriendo páginas por dentro.
    const res = await http().get(`${api(orgC)}/reports/entities/producers/export`).set(as(ADMIN)).expect(200);
    const csv = (res.text ?? String(res.body)).replace(/^﻿/, '');
    const filas = csv.split(/\r\n/).filter((l) => l && !l.startsWith('#')).slice(1);
    expect(filas).toHaveLength(520);
    expect(new Set(filas.map((l) => l.split(',')[0])).size).toBe(520);
    expect(csv).toMatch(/# filas,.*520 de 520 \(conjunto completo\)/);
    expect(csv).toMatch(/# instantanea,.*REPEATABLE READ/);
    expect(csv).toMatch(/# limite_exportacion,.*20\.000/);
    // El contrato de consistencia no promete más de lo implementado: entre peticiones no hay instantánea compartida.
    const pagina: Report = await get(ADMIN, 'producers', '?limit=200', orgC);
    expect(pagina.snapshot_note).toMatch(/Dentro de UNA petición/);
    expect(pagina.snapshot_note).toMatch(/navegar entre páginas son peticiones distintas/i);
    expect(pagina.snapshot_note).not.toMatch(/filas, totales y páginas proceden de una sola/i);
    expect(pagina.export_limit).toBe(20000);
    expect(pagina.export_note).toMatch(/TRUNCADO/);
  });

  it('exportación por entidad: CSV coherente con la pantalla, con totales, hash, auditoría y fórmulas neutralizadas', async () => {
    const pantalla = await get(AUD, 'producers', '?from=2026-09-01&to=2026-09-30');
    const res = await http().get(`${api(orgA)}/reports/entities/producers/export?from=2026-09-01&to=2026-09-30`).set(as(AUD)).expect(200);
    const csv = (res.text ?? String(res.body)).replace(/^﻿/, ''); // el CSV lleva BOM: se retira para leerlo
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="reporte-producers-/);
    expect(res.headers['x-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(csv).toMatch(/# periodo_desde,2026-09-01/);
    expect(csv).toMatch(/# total_entregas,.*: 2/);
    expect(csv).toMatch(/# recalculo,.*RECALCULA/); // la descarga no es la instantánea de la pantalla
    expect(csv).toMatch(/# cobertura_historica,.*2026-10-13/);
    // Las filas del CSV coinciden con las de la pantalla, columna a columna.
    const lineas = csv.split('\r\n').filter((l) => l && !l.startsWith('#'));
    const cabecera = lineas[0].split(',');
    expect(cabecera).toEqual(pantalla.columns.map((c) => c.key));
    const filas = lineas.slice(1).map((l) => l.split(',').map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"')));
    expect(filas).toHaveLength(pantalla.rows.length);
    for (const fila of pantalla.rows) {
      const enCsv = filas.find((f) => f[0] === fila.producer_code)!;
      cabecera.forEach((k, i) => expect(enCsv[i]).toBe(fila[k] === null || fila[k] === undefined ? '' : String(fila[k])));
    }
    for (const linea of lineas) for (const celda of linea.split(',')) expect(celda).not.toMatch(/^[=+@]/);
    // Auditada con el hash, el reporte y el período; sin report:export no se descarga.
    const log = (await sql<{ after: Record<string, unknown> }>`SELECT after FROM audit_logs WHERE organization_id = ${orgA} AND action = 'report.export' ORDER BY occurred_at DESC LIMIT 1`.execute(h.db)).rows[0];
    expect(log.after).toMatchObject({ report: 'producers', sha256: res.headers['x-content-sha256'] });
    await http().get(`${api(orgA)}/reports/entities/lots/export`).set(as('trazabilidad@test.local')).expect(403); // sin report:export
  });

  it('GeoJSON: exige plot:read_geometry, exporta lo registrado y declara lo que deja fuera y lo que depende de D-05', async () => {
    // AUDITOR tiene report:export y plot:read, pero no plot:read_geometry: no recibe coordenadas.
    const negado = await http().get(`${api(orgA)}/reports/entities/plots/geojson`).set(as(AUD)).expect(403);
    expect(negado.body.error.message).toMatch(/plot:read_geometry/);
    const res = await http().get(`${api(orgA)}/reports/entities/plots/geojson`).set(as(EUDR)).expect(200);
    expect(res.headers['content-type']).toMatch(/application\/geo\+json/);
    expect(res.headers['x-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    const fc = JSON.parse(res.text ?? String(res.body));
    expect(fc.type).toBe('FeatureCollection');
    // Solo la parcela con geometría: la de superficie declarada y la que no tiene versión NO se inventan.
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toMatchObject({ plot_code: 'E-1-P1', producer_code: 'E-1', geometry_type: 'POLYGON', validation_status: 'NOT_VALIDATED' });
    expect(fc.features[0].geometry.type).toBe('Polygon');
    expect(fc.terra_link.counts).toMatchObject({ parcelas_vigentes: 3, exportadas: 1, solo_superficie_declarada: 1, sin_version_vigente: 1 });
    expect(fc.terra_link.omitted_note).toMatch(/no es una ubicación/i);
    expect(fc.terra_link.validation_note).toMatch(/SIN EVALUAR, no inválida/i);
    // Exportación técnica, no perfil regulatorio: lo que depende de D-05 se declara, no se da por resuelto.
    // El perfil TÉCNICO ya existe (D-05.A); lo pendiente es la APLICABILIDAD JURÍDICA (D-05.B). No se mezclan.
    expect(fc.terra_link.regulatory_profile).toMatchObject({ status: 'PENDING', depends_on: 'D-05.B', technical_profile: expect.stringContaining('EUDR_GEO_V1') });
    expect(fc.terra_link.notice).toMatch(/no es un paquete de debida diligencia/i);
    expect(fc.terra_link.coverage.status).toBe('INCOMPLETE');
    // Auditada con el hash y el número de parcelas omitidas por no tener geometría.
    const log = (await sql<{ after: Record<string, unknown> }>`SELECT after FROM audit_logs WHERE organization_id = ${orgA} AND action = 'report.geojson_export' ORDER BY occurred_at DESC LIMIT 1`.execute(h.db)).rows[0];
    expect(log.after).toMatchObject({ sha256: res.headers['x-content-sha256'], features: 1, omitted_without_geometry: 2 });
    // Otra organización: 404, y ninguna geometría ajena.
    await http().get(`${api(orgB)}/reports/entities/plots/geojson`).set(as(EUDR)).expect(404);
  });
});
