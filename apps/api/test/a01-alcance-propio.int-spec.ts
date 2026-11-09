import { createHash, randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { pdfConTexto } from './pdf-sintetico';
import { hasImageMetadata, stripImageMetadata } from '../src/sync/image-metadata';

// A-01 (ampliación autorizada 2026-10-20, RF-48) — Captura de campo desde la web con alcance PROPIO.
//
// Lo que estas pruebas protegen:
//   · el rol PRODUCER no concede nada por sí solo: hace falta el vínculo explícito, con motivo, versionado y auditado;
//   · un productor solo ve y modifica SUS parcelas, documentos y comparaciones; una parcela ajena es 404 (conocer el
//     identificador no basta) y lo mismo vale para búsquedas, recuentos y descargas;
//   · el técnico respeta sus asignaciones, también en los documentos y en la extracción (hueco cerrado en esta entrega);
//   · registrar coordenadas NO concede evaluar GIS, revisar documentos, encargar satélite ni concluir riesgo;
//   · la revisión previa valida en el servidor, declara el orden de las coordenadas y que lo escrito no es GPS;
//   · cambiar la geometría no reutiliza en silencio una evaluación anterior.
describeDb('A-01 captura de campo con alcance propio (PostgreSQL real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let org: string;
  let orgB: string;
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const api = (o = org) => `/api/v1/organizations/${o}`;
  const SUPER = 'super-a01@test.local';
  const ADMIN = 'admin-a01@test.local';
  const ADMIN_B = 'admin-a01b@test.local';
  const TEC1 = 'tec1-a01@test.local';
  const TEC2 = 'tec2-a01@test.local';
  const PROD1 = 'prod1-a01@test.local';
  const PROD2 = 'prod2-a01@test.local';
  const PROD3 = 'prod3-a01@test.local';
  const AUD = 'aud-a01@test.local';
  const BUY = 'buy-a01@test.local';
  const MGR = 'mgr-a01@test.local';
  const m: Record<string, string> = {};
  let p1 = ''; let p2 = ''; let plot1 = ''; let plot2 = ''; let docP2 = ''; let verP2 = '';

  const lista = (r: { body: unknown }): string[] => ((Array.isArray(r.body) ? r.body : (r.body as { items?: unknown[] })?.items ?? []) as Array<{ id: string }>).map((d) => d.id);
  const punto = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });
  const cuadro = (lon: number, lat: number, d = 0.001) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });
  const pdf = () => Buffer.from(`%PDF-1.4\n% evidencia sintetica ${randomUUID()}\n%%EOF\n`);
  const upload = (actor: string, owner_type: string, owner_id: string, type = 'FIELD_EVIDENCE', bytes: Buffer = pdf()) =>
    http().post(`${api()}/documents`).set(as(actor)).field('operation_id', randomUUID()).field('document_type', type)
      .field('owner_type', owner_type).field('owner_id', owner_id).field('title', 'Evidencia de recorrido (sintética)')
      .attach('file', bytes, { filename: 'evidencia.pdf', contentType: 'application/pdf' });

  async function invitar(email: string, role: string, o = org, admin = ADMIN) {
    const inv = await http().post(`${api(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'X', last_name: 'Y', password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const vincular = (actor: string, producer: string, membership: string | null, version: number, reason = 'Alta del productor en la plataforma') =>
    http().put(`${api()}/producers/${producer}/self-membership`).set(as(actor)).send({ expected_version: version, membership_id: membership, reason });
  const version = async (id: string) => Number((await http().get(`${api()}/producers/${id}`).set(as(ADMIN)).expect(200)).body.row_version);
  const pVersion = async (actor: string, id: string) => Number((await http().get(`${api()}/plots/${id}`).set(as(actor)).expect(200)).body.row_version);

  beforeAll(async () => {
   let step = 'harness';
   try {
    h = await setupHarness();
    step = 'users'; await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_B);
    step = 'orgs';
    const mk = async (n: string, a: string) => (await http().post('/api/v1/organizations').set(as(SUPER))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: a }).expect(201)).body.id;
    org = await mk('Coop A01', ADMIN);
    orgB = await mk('Coop A01 B', ADMIN_B);
    step = 'invites';
    // Las ocho altas son independientes: en paralelo, para no encadenar ocho esperas de disco dentro del mismo hook (con el disco lento, la
    // preparación en serie rozaba el límite de 60 s del hook; se reduce el trabajo, no se sube el límite).
    await Promise.all([[TEC1, 'FIELD_TECHNICIAN'], [TEC2, 'FIELD_TECHNICIAN'], [PROD1, 'PRODUCER'], [PROD2, 'PRODUCER'], [PROD3, 'PRODUCER'], [AUD, 'AUDITOR'], [BUY, 'BUYER'], [MGR, 'MANAGER']].map(([e, r]) => invitar(e, r)));
    step = 'members';
    const miembros = (await http().get(`${api()}/members`).set(as(ADMIN)).expect(200)).body;
    for (const x of (Array.isArray(miembros) ? miembros : miembros.members) as Array<{ email: string; membership_id: string }>) m[x.email] = x.membership_id;
    step = 'producers';
    p1 = (await http().post(`${api()}/producers`).set(as(ADMIN)).send({ producer_code: 'A01-P1', legal_name: 'Finca Uno (sintética)' }).expect(201)).body.id;
    p2 = (await http().post(`${api()}/producers`).set(as(ADMIN)).send({ producer_code: 'A01-P2', legal_name: 'Finca Dos (sintética)' }).expect(201)).body.id;
    const v1a = await version(p1);
    await http().put(`${api()}/producers/${p1}/assignment`).set(as(ADMIN)).send({ expected_version: v1a, membership_id: m[TEC1] }).expect(200);
    const v2a = await version(p2);
    await http().put(`${api()}/producers/${p2}/assignment`).set(as(ADMIN)).send({ expected_version: v2a, membership_id: m[TEC2] }).expect(200);
    step = 'plots';
    plot1 = (await http().post(`${api()}/plots`).set(as(ADMIN)).send({ producer_id: p1, plot_code: 'A01-L1', crop: 'Cacao' }).expect(201)).body.id;
    plot2 = (await http().post(`${api()}/plots`).set(as(ADMIN)).send({ producer_id: p2, plot_code: 'A01-L2', crop: 'Cacao' }).expect(201)).body.id;
    step = 'upload';
    const d = await upload(ADMIN, 'plot', plot2).expect(201);
    docP2 = d.body.document.id;
    verP2 = d.body.document.versions[0].id;
   } catch (e) { console.error('SETUP-A01', step, e instanceof Error ? e.message : e); throw e; }
  });
  afterAll(async () => h?.close());

  it('EL ROL NO BASTA: un PRODUCER sin vínculo no ve ninguna parcela ni ningún productor', async () => {
    const lista = await http().get(`${api()}/plots`).set(as(PROD3)).expect(200);
    expect(lista.body.items ?? lista.body.data ?? lista.body).toHaveLength(0);
    expect((await http().get(`${api()}/plots/${plot1}`).set(as(PROD3))).status).toBe(404);
    expect((await http().get(`${api()}/producers/${p1}`).set(as(PROD3))).status).toBe(404);
    const prods = await http().get(`${api()}/producers`).set(as(PROD3)).expect(200);
    expect(prods.body.items ?? prods.body.data ?? prods.body).toHaveLength(0);
  });

  it('VINCULAR es explícito, con motivo y permiso propio; valida la membresía y no admite dos productores', async () => {
    // Sin permiso: un técnico no vincula; tampoco el propio productor.
    expect((await vincular(TEC1, p1, m[PROD1], await version(p1))).status).toBe(403);
    expect((await vincular(PROD1, p1, m[PROD1], await version(p1))).status).toBe(403);
    // Sin motivo: validación.
    expect((await vincular(ADMIN, p1, m[PROD1], await version(p1), 'x')).status).toBe(400);
    // Membresía sin el rol Productor, de otra organización o inexistente.
    expect((await vincular(ADMIN, p1, m[TEC2], await version(p1))).body.error.code).toBe('MEMBERSHIP_WITHOUT_PRODUCER_ROLE');
    expect((await vincular(ADMIN, p1, randomUUID(), await version(p1))).body.error.code).toBe('MEMBERSHIP_NOT_FOUND');
    // Versión desactualizada.
    expect((await vincular(ADMIN, p1, m[PROD1], 999)).body.error.code).toBe('VERSION_CONFLICT');
    // Alta correcta, auditada y versionada.
    const ok = await vincular(ADMIN, p1, m[PROD1], await version(p1)).expect(200);
    expect(ok.body.self_membership_id).toBe(m[PROD1]);
    await vincular(ADMIN, p2, m[PROD2], await version(p2)).expect(200);
    // Una persona no puede ser dos productores.
    expect((await vincular(ADMIN, p2, m[PROD1], await version(p2))).body.error.code).toBe('MEMBERSHIP_ALREADY_LINKED');
    const aud = await h.db.selectFrom('audit_logs').select(['action', 'reason']).where('action', '=', 'producer.link_self').execute();
    expect(aud.length).toBeGreaterThanOrEqual(2);
    expect(aud[0].reason).toMatch(/Alta del productor/);
    const ver = await h.db.selectFrom('producer_versions').select('change_type').where('producer_id', '=', p1).where('change_type', '=', 'LINK_SELF').execute();
    expect(ver).toHaveLength(1);
    // Otra organización no puede vincular a este productor.
    expect((await http().put(`${api(orgB)}/producers/${p1}/self-membership`).set(as(ADMIN_B)).send({ expected_version: 1, membership_id: m[PROD1], reason: 'Intento ajeno' })).status).toBe(404);
  });

  it('SOLO LO PROPIO: el productor ve sus parcelas y ninguna ajena (listas, detalle, búsqueda y productor)', async () => {
    const lista = (await http().get(`${api()}/plots`).set(as(PROD1)).expect(200)).body;
    const items = (lista.items ?? lista.data ?? lista) as Array<{ id: string }>;
    expect(items.map((x) => x.id)).toEqual([plot1]);
    const busca = (await http().get(`${api()}/plots?q=A01-L2`).set(as(PROD1)).expect(200)).body;
    expect((busca.items ?? busca.data ?? busca)).toHaveLength(0);          // la búsqueda no revela lo ajeno
    const propia = (await http().get(`${api()}/plots/${plot1}`).set(as(PROD1)).expect(200)).body;
    expect(propia.can_update).toBe(true);
    expect(propia.can_capture_location).toBe(true);
    expect(propia.can_evaluate_gis).toBeFalsy();                            // capturar no es evaluar
    expect((await http().get(`${api()}/plots/${plot2}`).set(as(PROD1))).status).toBe(404);
    const prods = (await http().get(`${api()}/producers`).set(as(PROD1)).expect(200)).body;
    expect((prods.items ?? prods.data ?? prods).map((x: { id: string }) => x.id)).toEqual([p1]);
    expect((await http().get(`${api()}/producers/${p2}`).set(as(PROD1))).status).toBe(404);
    const yo = (await http().get(`${api()}/producers/${p1}`).set(as(PROD1)).expect(200)).body;
    expect(yo.is_own).toBe(true);
    expect(yo.identity_visible).toBe(false);                                // la identidad sigue siendo de quien tiene read_identity
    expect(yo.self_membership_id).toBeUndefined();                          // quién es el productor lo ve quien administra el vínculo
  });

  it('CAPTURA PROPIA con procedencia: una coordenada escrita queda como MANUAL_COORDINATES, nunca como GPS', async () => {
    // Revisión previa en el servidor: no guarda, declara el orden y la procedencia.
    const prev = await http().post(`${api()}/plots/${plot1}/geometry-preview`).set(as(PROD1)).send({ geometry: cuadro(-80.16, -0.85) }).expect(200);
    expect(prev.body).toMatchObject({ structurally_valid: true, technically_valid: true, geometry_type: 'POLYGON', will_create_version: true });
    expect(prev.body.order).toMatch(/longitud.*latitud/);
    expect(prev.body.provenance).toMatchObject({ survey_method: 'MANUAL_COORDINATES', is_gps_measurement: false });
    expect(Number(prev.body.area_calculated_ha)).toBeGreaterThan(0);
    const antes = await h.db.selectFrom('plot_versions').select('id').where('plot_id', '=', plot1).execute();
    expect(antes).toHaveLength(0);                                          // la revisión no guardó nada
    // Geometría inválida: la detecta el servidor, no el navegador.
    const lazo = { type: 'Polygon', coordinates: [[[-80.16, -0.85], [-80.159, -0.849], [-80.159, -0.85], [-80.16, -0.849], [-80.16, -0.85]]] };
    const mala = await http().post(`${api()}/plots/${plot1}/geometry-preview`).set(as(PROD1)).send({ geometry: lazo }).expect(200);
    expect(mala.body.technically_valid).toBe(false);
    const fuera = await http().post(`${api()}/plots/${plot1}/geometry-preview`).set(as(PROD1)).send({ geometry: punto(-80.16, 95) }).expect(200);
    expect(fuera.body.structurally_valid).toBe(false);
    expect(fuera.body.issues.length).toBeGreaterThan(0);
    // Confirmar crea la versión con la procedencia declarada.
    const ev1 = await pVersion(PROD1, plot1);
    const v = await http().post(`${api()}/plots/${plot1}/geometry-versions`).set(as(PROD1))
      .send({ expected_version: ev1, survey_method: 'MANUAL_COORDINATES', geometry: cuadro(-80.16, -0.85), notes: 'Escrita en la web' }).expect(201);
    expect(v.body.version.survey_method).toBe('MANUAL_COORDINATES');
    expect(v.body.version.accuracy_m).toBeNull();                           // no hay precisión que inventar
    expect(v.body.version.geometry_visible).toBe(true);
  });

  it('LA PARCELA AJENA NO SE TOCA: revisar, versionar, crear, subir y descargar sobre lo de otro productor', async () => {
    expect((await http().post(`${api()}/plots/${plot2}/geometry-preview`).set(as(PROD1)).send({ geometry: punto(-80.1, -0.8) })).status).toBe(404);
    expect((await http().post(`${api()}/plots/${plot2}/geometry-versions`).set(as(PROD1)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: punto(-80.1, -0.8) })).status).toBe(404);
    expect((await http().patch(`${api()}/plots/${plot2}`).set(as(PROD1)).send({ expected_version: 1, name: 'robada' })).status).toBe(404);
    // Crear una parcela para el productor propio sí; para uno ajeno no.
    await http().post(`${api()}/plots`).set(as(PROD1)).send({ producer_id: p1, plot_code: 'A01-L1B', crop: 'Cacao' }).expect(201);
    const ajeno = await http().post(`${api()}/plots`).set(as(PROD1)).send({ producer_id: p2, plot_code: 'A01-L9', crop: 'Cacao' });
    expect(ajeno.status).toBe(422);
    expect(ajeno.body.error.code).toBe('PRODUCER_NOT_AVAILABLE');
    // Documentos: sube a lo suyo, no a lo ajeno.
    await upload(PROD1, 'plot', plot1).expect(201);
    expect((await upload(PROD1, 'plot', plot2)).status).toBe(404);
    expect((await upload(PROD1, 'producer', p2)).status).toBe(404);
    // La lista de documentos solo muestra los propios y los ajenos no se descargan ni se abren.
    const docs = (await http().get(`${api()}/documents`).set(as(PROD1)).expect(200)).body;
    const filas = (docs.items ?? docs.data ?? docs) as Array<{ owner_id: string }>;
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((d) => d.owner_id === plot1 || d.owner_id === p1)).toBe(true);
    expect((await http().get(`${api()}/documents/${docP2}`).set(as(PROD1))).status).toBe(404);
    expect((await http().get(`${api()}/documents/${docP2}/versions/${verP2}/content`).set(as(PROD1))).status).toBe(404);
  });

  it('CAPTURAR NO ES DECIDIR: el productor no evalúa GIS, no revisa documentos, no encarga satélite ni ve riesgo', async () => {
    expect((await http().post(`${api()}/plots/${plot1}/gis-evaluations`).set(as(PROD1)).send({ operation_id: randomUUID() })).status).toBe(403);
    expect((await http().post(`${api()}/plots/${plot1}/satellite/analyses`).set(as(PROD1)).send({ operation_id: randomUUID(), operation: 'FOREST_COVER' })).status).toBe(403);
    expect((await http().get(`${api()}/risk/lots`).set(as(PROD1))).status).toBe(403);
    expect((await http().get(`${api()}/members`).set(as(PROD1))).status).toBe(403);
    expect((await http().put(`${api()}/producers/${p1}/assignment`).set(as(PROD1)).send({ expected_version: 1, membership_id: m[TEC1] })).status).toBe(403);
    // Puede LEER las evaluaciones GIS de su parcela (alcance propio), no las de otro.
    await http().get(`${api()}/plots/${plot1}/gis-evaluations`).set(as(PROD1)).expect(200);
    expect((await http().get(`${api()}/plots/${plot2}/gis-evaluations`).set(as(PROD1))).status).toBe(404);
  });

  it('EL TÉCNICO RESPETA SUS ASIGNACIONES, también en documentos y en la extracción (hueco cerrado)', async () => {
    const t1 = (await http().get(`${api()}/plots`).set(as(TEC1)).expect(200)).body;
    expect(((t1.items ?? t1.data ?? t1) as Array<{ id: string }>).map((x) => x.id)).not.toContain(plot2);
    expect((await http().get(`${api()}/plots/${plot2}`).set(as(TEC1))).status).toBe(404);
    expect((await http().post(`${api()}/plots/${plot2}/geometry-versions`).set(as(TEC1)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: punto(-80.1, -0.8) })).status).toBe(404);
    expect((await http().get(`${api()}/documents/${docP2}`).set(as(TEC1))).status).toBe(404);
    // Antes de esta entrega, `document:read` bastaba para leer la extracción de cualquier documento por su identificador.
    const ext = `${api()}/documents/${docP2}/versions/${verP2}/extraction`;
    expect((await http().get(ext).set(as(TEC1))).status).toBe(404);
    expect((await http().get(ext).set(as(PROD1))).status).toBe(404);
    expect((await http().get(ext).set(as(TEC2))).status).toBe(200);          // el asignado sí
    expect((await http().get(ext).set(as(ADMIN))).status).toBe(200);
  });

  it('REGRESIÓN EXTRACCIÓN: texto extraído, sugerencias y acciones sobre un documento fuera de alcance son inaccesibles (no basta ocultar el enlace)', async () => {
    // Un documento REAL con texto, ya extraído por quien tiene alcance, para que haya algo que proteger.
    const d = await upload(ADMIN, 'producer', p2, 'DELIVERY_SUPPORT',pdfConTexto(['CERTIFICADO DE PRUEBA', 'Emitido por: Registro Sintetico A01', 'Fecha de emision: 2026-03-04'])).expect(201);
    const doc = d.body.document.id; const ver = d.body.document.versions[0].id;
    const ruta = `${api()}/documents/${doc}/versions/${ver}/extraction`;
    const hecho = (await http().post(ruta).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201)).body;
    expect(hecho.extraction.extracted_text).toContain('Registro Sintetico A01');
    const campo = hecho.fields.find((f: { suggestion: { value: string | null } }) => f.suggestion.value)?.id as string;
    expect(campo).toBeTruthy();
    // CONTROL autorizado: el técnico asignado y la administración sí ven el texto y las sugerencias.
    for (const ok of [TEC2, ADMIN]) {
      const r = await http().get(ruta).set(as(ok)).expect(200);
      expect(r.body.extraction.extracted_text).toContain('Registro Sintetico A01');
      expect(r.body.fields.length).toBeGreaterThan(0);
    }
    // Sin alcance: ver, extraer de nuevo y decidir sobre una sugerencia. Ni 2xx ni un solo dato del documento en la respuesta.
    for (const quien of [TEC1, PROD1, PROD3]) {     // PROD2 sí es el productor de este documento: no entra en los casos negativos
      const intentos = [
        await http().get(ruta).set(as(quien)),
        await http().post(ruta).set(as(quien)).send({ operation_id: randomUUID() }),
        await http().post(`${ruta}/fields/${campo}/review`).set(as(quien)).send({ operation_id: randomUUID(), decision: 'DESCARTADO', reason: 'Intento sin alcance' }),
      ];
      for (const r of intentos) {
        expect(r.status).toBeGreaterThanOrEqual(400);
        expect(JSON.stringify(r.body)).not.toMatch(/Registro Sintetico A01|2026-03-04/);
      }
    }
    // Otra organización: el identificador no atraviesa el tenant.
    expect((await http().get(`${api(orgB)}/documents/${doc}/versions/${ver}/extraction`).set(as(ADMIN_B))).status).toBe(404);
    // Nada se decidió desde fuera de alcance.
    const decisiones = await h.db.selectFrom('document_extraction_decisions').select('id').execute();
    expect(decisiones).toHaveLength(0);
  });

  it('LA REVISIÓN PREVIA NO GUARDA Y LA CONFIRMACIÓN VUELVE A COMPROBAR PERMISOS Y GEOMETRÍA', async () => {
    const cuenta = async () => (await h.db.selectFrom('plot_versions').select('id').where('plot_id', '=', plot1).execute()).length;
    const n0 = await cuenta();
    await http().post(`${api()}/plots/${plot1}/geometry-preview`).set(as(PROD1)).send({ geometry: cuadro(-80.17, -0.86) }).expect(200);
    await http().post(`${api()}/plots/${plot1}/geometry-preview`).set(as(ADMIN)).send({ geometry: cuadro(-80.17, -0.86) }).expect(200);
    expect(await cuenta()).toBe(n0);
    // Entre la revisión y la confirmación se revoca el vínculo: confirmar con la misma geometría ya no es posible.
    await vincular(ADMIN, p1, null, await version(p1), 'Se retira el vínculo antes de confirmar').expect(200);
    const ev = await pVersion(ADMIN, plot1);
    const sinPermiso = await http().post(`${api()}/plots/${plot1}/geometry-versions`).set(as(PROD1))
      .send({ expected_version: ev, survey_method: 'MANUAL_COORDINATES', geometry: cuadro(-80.17, -0.86) });
    expect(sinPermiso.status).toBe(404);
    expect(await cuenta()).toBe(n0);
    await vincular(ADMIN, p1, m[PROD1], await version(p1), 'Se restablece el vínculo').expect(200);
    // El servidor valida de nuevo la geometría aunque la revisión previa se saltara.
    // Estructura (tipo, rango, anillos): se RECHAZA y no se guarda nada.
    const evMala = await pVersion(PROD1, plot1);
    const fuera = await http().post(`${api()}/plots/${plot1}/geometry-versions`).set(as(PROD1))
      .send({ expected_version: evMala, survey_method: 'MANUAL_COORDINATES', geometry: punto(-80.1, 95) });
    expect(fuera.status).toBeGreaterThanOrEqual(400);
    expect(fuera.status).toBeLessThan(500);
    expect(await cuenta()).toBe(n0);
    // Validez técnica (un lazo): el diseño original (P0-006) la guarda y la MARCA; la dictamina la evaluación GIS y se
    // corrige con una versión nueva. No se repara en silencio ni se oculta.
    const lazo = { type: 'Polygon', coordinates: [[[-80.16, -0.85], [-80.159, -0.849], [-80.159, -0.85], [-80.16, -0.849], [-80.16, -0.85]]] };
    const guardada = await http().post(`${api()}/plots/${plot1}/geometry-versions`).set(as(PROD1))
      .send({ expected_version: evMala, survey_method: 'MANUAL_COORDINATES', geometry: lazo }).expect(201);
    expect(guardada.body.version.technically_valid).toBe(false);
    expect(await cuenta()).toBe(n0 + 1);
  });

  it('FOTOGRAFÍAS (D-41): el recorrido web reutiliza el contrato de la foto de campo; el EXIF no elude la clasificación', async () => {
    // JPEG sintético con EXIF (orientación + puntero GPS), XMP y comentario, como lo entrega una cámara.
    const ascii = (t: string) => Array.from(t, (c) => c.charCodeAt(0));
    const seg = (m: number, d: number[]) => [0xff, m, (d.length + 2) >> 8, (d.length + 2) & 0xff, ...d];
    const tiff = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 2, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 0x30, 0, 0, 0, 0, 0, 0, 0];
    const original = Buffer.from([0xff, 0xd8, ...seg(0xe1, [...ascii('Exif  '), ...tiff]), ...seg(0xe1, ascii('http://ns.adobe.com/xap/1.0/ <xmpmeta>TelefonoSintetico</xmpmeta>')),
      ...seg(0xfe, ascii('comentario')), ...seg(0xdb, [0, 1, 2, 3]), 0xff, 0xda, 0, 4, 1, 0, ...ascii(`datos-${randomUUID()}`), 0xff, 0xd9]);
    expect(hasImageMetadata(new Uint8Array(original), 'image/jpeg')).toBe(true);
    const copia = Buffer.from(stripImageMetadata(new Uint8Array(original), 'image/jpeg'));
    expect(hasImageMetadata(new Uint8Array(copia), 'image/jpeg')).toBe(false);
    const foto = (actor: string, tipo: string, bytes: Buffer, plot = plot1) => http().post(`${api()}/documents`).set(as(actor)).field('operation_id', randomUUID()).field('document_type', tipo)
      .field('owner_type', 'plot').field('owner_id', plot).field('title', 'Foto de campo (sintética)').attach('file', bytes, { filename: 'fotografia.jpg', contentType: 'image/jpeg' });
    // El original con metadatos NO se acepta, ni como foto de campo ni como evidencia; la API directa no lo elude.
    const r1 = await foto(PROD1, 'FIELD_PHOTO', original);
    expect(r1.status).toBe(422); expect(r1.body.error.code).toBe('PHOTO_METADATA_PRESENT');
    const r2 = await foto(PROD1, 'FIELD_EVIDENCE', copia);
    expect(r2.status).toBe(422); expect(r2.body.error.code).toBe('EVIDENCE_IMAGE_USE_FIELD_PHOTO');
    // La copia procesada se acepta como Fotografía de campo (dato personal) sobre la parcela PROPIA, y no sobre la ajena.
    const ok = await foto(PROD1, 'FIELD_PHOTO', copia).expect(201);
    expect((await foto(PROD1, 'FIELD_PHOTO', copia, plot2)).status).toBe(404);
    const verId = ok.body.document.versions[0].id; const docId = ok.body.document.id;
    expect(ok.body.document.versions[0].sha256).toBe(createHash('sha256').update(copia).digest('hex'));    // el SHA-256 es el de la copia, no el del original
    expect(createHash('sha256').update(copia).digest('hex')).not.toBe(createHash('sha256').update(original).digest('hex'));
    // Archivo servido: el contenido sigue siendo DATO PERSONAL (clasificación intacta) y se entrega exactamente la copia almacenada.
    const bin = (r: import('supertest').Test) => r.buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const ruta = `${api()}/documents/${docId}/versions/${verId}/content`;
    const adm = await bin(http().get(ruta).set(as(ADMIN)));
    expect(adm.status).toBe(200);
    expect(hasImageMetadata(new Uint8Array(adm.body as Buffer), 'image/jpeg')).toBe(false);   // archivo servido: sin metadatos
    expect(Buffer.compare(adm.body as Buffer, copia)).toBe(0);                                  // exactamente los bytes almacenados
    const vistaAdm = (await http().get(`${api()}/documents/${docId}`).set(as(ADMIN)).expect(200)).body;
    expect(vistaAdm.classification).toBe('PERSONAL_DATA');
    // FOTO PROPIA: el productor vinculado la consulta y la descarga con su permiso específico, sin recibir identidad.
    const propia = await http().get(`${api()}/documents/${docId}`).set(as(PROD1)).expect(200);
    expect(propia.body.content_access).toBe('ALLOWED');
    expect(propia.body.versions[0].downloadable).toBe(true);
    const mia = await bin(http().get(ruta).set(as(PROD1)));
    expect(mia.status).toBe(200);
    expect(Buffer.compare(mia.body as Buffer, copia)).toBe(0);
    expect((await http().get(`${api()}/producers/${p1}`).set(as(PROD1)).expect(200)).body.identity_visible).toBe(false);   // sin lectura de identidad
    // FOTO DE OTRA PARCELA (misma organización, otro productor): ni la ve, ni la lista, ni la descarga el productor sin alcance.
    const ajena = await foto(ADMIN, 'FIELD_PHOTO', Buffer.from(stripImageMetadata(new Uint8Array(Buffer.concat([original.subarray(0, original.length - 2), Buffer.from(ascii(randomUUID())), Buffer.from([0xff, 0xd9])])), 'image/jpeg')), plot2).expect(201);
    const rutaAjena = `${api()}/documents/${ajena.body.document.id}/versions/${ajena.body.document.versions[0].id}/content`;
    expect((await http().get(`${api()}/documents/${ajena.body.document.id}`).set(as(PROD1))).status).toBe(404);
    expect((await bin(http().get(rutaAjena).set(as(PROD1)))).status).toBe(404);
    expect(lista(await http().get(`${api()}/documents`).set(as(PROD1)))).not.toContain(ajena.body.document.id);
    expect((await bin(http().get(rutaAjena).set(as(PROD2)))).status).toBe(200);                 // control: el productor de ESA parcela sí
    expect((await bin(http().get(ruta).set(as(PROD2)))).status).toBe(404);                      // y no la foto de la primera
    // Sin vínculo con ningún productor, haber subido una foto no basta; y el permiso no existe para otros roles sin identidad.
    expect((await bin(http().get(ruta).set(as(PROD3)))).status).toBe(404);
    expect((await bin(http().get(ruta).set(as(AUD)))).status).toBe(403);                         // el auditor no lee datos personales
    // Otra organización.
    expect((await bin(http().get(`${api(orgB)}/documents/${docId}/versions/${verId}/content`).set(as(ADMIN_B)))).status).toBe(404);
    expect((await bin(http().get(`${api(orgB)}/documents/${docId}/versions/${verId}/content`).set(as(PROD1)))).status).toBe(404);
    // PÉRDIDA DE ACCESO al retirar el vínculo: la foto que subió el propio productor deja de ser accesible al instante.
    await vincular(ADMIN, p1, null, await version(p1), 'Se retira el vínculo (ensayo de fotografías)').expect(200);
    expect((await http().get(`${api()}/documents/${docId}`).set(as(PROD1))).status).toBe(404);
    expect((await bin(http().get(ruta).set(as(PROD1)))).status).toBe(404);
    await vincular(ADMIN, p1, m[PROD1], await version(p1), 'Se restablece el vínculo').expect(200);
    expect((await bin(http().get(ruta).set(as(PROD1)))).status).toBe(200);
    // La descarga queda auditada.
    const dl = await h.db.selectFrom('audit_logs as a').innerJoin('users as u', 'u.id', 'a.actor_user_id').select('a.id').where('a.action', '=', 'document.download').where('u.email', '=', PROD1).execute();
    expect(dl.length).toBeGreaterThanOrEqual(2);                                                   // cada descarga del productor quedó auditada
    // El rechazo queda auditado (sin el contenido).
    const aud = await h.db.selectFrom('audit_logs').select(['action', 'result']).where('action', '=', 'document.upload_rejected').execute();
    expect(aud.length).toBeGreaterThanOrEqual(1);
  });

  it('POLÍGONO POR VÉRTICES E IMPORTACIÓN GEOJSON: el productor los usa sobre SU parcela y no sobre la ajena (mismo mecanismo, alcance propio)', async () => {
    // Borrador de polígono: propia 201, ajena 404, sin vínculo 404/403; el borrador no confirma nada por sí solo.
    const n0 = (await h.db.selectFrom('plot_versions').select('id').where('plot_id', '=', plot1).execute()).length;
    const d = await http().post(`${api()}/plots/${plot1}/polygon-drafts`).set(as(PROD1)).send({});
    expect([200, 201]).toContain(d.status);
    expect((await http().get(`${api()}/plots/${plot1}/polygon-drafts/current`).set(as(PROD1)).expect(200)).body.draft).toBeTruthy();
    expect((await http().post(`${api()}/plots/${plot2}/polygon-drafts`).set(as(PROD1)).send({})).status).toBe(404);
    expect((await http().get(`${api()}/plots/${plot2}/polygon-drafts/current`).set(as(PROD1))).status).toBe(404);
    expect([403, 404]).toContain((await http().post(`${api()}/plots/${plot1}/polygon-drafts`).set(as(PROD3)).send({})).status);
    expect((await h.db.selectFrom('plot_versions').select('id').where('plot_id', '=', plot1).execute()).length).toBe(n0);
    // Importación GeoJSON: se analiza (no se guarda) sobre la parcela propia y se rechaza sobre la ajena.
    const geo = Buffer.from(JSON.stringify(cuadro(-80.3, -0.9)));
    const imp = (actor: string, plot: string) => http().post(`${api()}/plots/${plot}/geometry-imports`).set(as(actor)).field('operation_id', randomUUID()).attach('file', geo, { filename: 'finca.geojson', contentType: 'application/geo+json' });
    const ok = await imp(PROD1, plot1);
    expect([200, 201]).toContain(ok.status);
    expect((await imp(PROD1, plot2)).status).toBe(404);
    expect((await h.db.selectFrom('plot_versions').select('id').where('plot_id', '=', plot1).execute()).length).toBe(n0);   // analizar no guarda
    expect([403, 404]).toContain((await imp(AUD, plot1)).status);
  });

  it('AUDITOR Y COMPRADOR: consulta autorizada, sin captura; el comprador no ve nada por su rol', async () => {
    await http().get(`${api()}/plots/${plot1}`).set(as(AUD)).expect(200);
    expect((await http().post(`${api()}/plots/${plot1}/geometry-versions`).set(as(AUD)).send({ expected_version: 99, survey_method: 'MANUAL_COORDINATES', geometry: punto(-80.1, -0.8) })).status).toBe(403);
    expect((await http().post(`${api()}/plots/${plot1}/geometry-preview`).set(as(AUD)).send({ geometry: punto(-80.1, -0.8) })).status).toBe(403);
    expect((await http().post(`${api()}/plots`).set(as(AUD)).send({ producer_id: p1, plot_code: 'A01-X', crop: 'Cacao' })).status).toBe(403);
    expect((await http().get(`${api()}/plots`).set(as(BUY))).status).toBe(403);
    expect((await http().get(`${api()}/plots/${plot1}`).set(as(BUY))).status).toBe(403);
  });

  it('EL GERENTE se rige por sus permisos de gestión y la otra organización no ve nada', async () => {
    const lista = (await http().get(`${api()}/plots`).set(as(MGR)).expect(200)).body;
    expect(((lista.items ?? lista.data ?? lista) as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect((await http().get(`${api()}/plots/${plot1}`).set(as(ADMIN_B))).status).toBe(404);
    expect((await http().get(`${api(orgB)}/plots/${plot1}`).set(as(PROD1))).status).toBe(404);
  });

  it('CAMBIAR LA GEOMETRÍA NO REUTILIZA EN SILENCIO UNA EVALUACIÓN: la anterior queda obsoleta y se dice por qué', async () => {
    const ev = await http().post(`${api()}/plots/${plot1}/gis-evaluations`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201);
    const id = ev.body.id ?? ev.body.evaluation?.id;
    const antes = (await http().get(`${api()}/gis-evaluations/${id}`).set(as(PROD1)).expect(200)).body;
    expect(antes.stale).toBe(false);
    // El productor corrige su geometría, con nueva versión.
    const ev2 = await pVersion(PROD1, plot1);
    await http().post(`${api()}/plots/${plot1}/geometry-versions`).set(as(PROD1))
      .send({ expected_version: ev2, survey_method: 'MANUAL_COORDINATES', geometry: cuadro(-80.1605, -0.8505), notes: 'Corrección' }).expect(201);
    const despues = (await http().get(`${api()}/gis-evaluations/${id}`).set(as(PROD1)).expect(200)).body;
    expect(despues.stale).toBe(true);
    expect(despues.stale_reasons.join(',')).toMatch(/GEOMETRY_CHANGED|PLOT_VERSION_CHANGED/);
    // Las versiones anteriores se conservan.
    const versiones = (await http().get(`${api()}/plots/${plot1}/geometry-versions`).set(as(PROD1)).expect(200)).body;
    expect((versiones.items ?? versiones.data ?? versiones).length).toBeGreaterThanOrEqual(2);
  });

  it('DESVINCULAR corta el acceso propio al instante, con motivo y sin borrar el historial', async () => {
    await vincular(ADMIN, p1, null, await version(p1), 'La persona dejó de ser el productor').expect(200);
    expect((await http().get(`${api()}/plots/${plot1}`).set(as(PROD1))).status).toBe(404);
    const lista = (await http().get(`${api()}/plots`).set(as(PROD1)).expect(200)).body;
    expect((lista.items ?? lista.data ?? lista)).toHaveLength(0);
    const ver = await h.db.selectFrom('producer_versions').select('change_type').where('producer_id', '=', p1).where('change_type', '=', 'LINK_SELF').execute();
    expect(ver.length).toBeGreaterThanOrEqual(2);                           // cada alta y cada baja deja su versión
    // Vuelve a vincular: el acceso regresa, y las versiones geométricas siguen ahí.
    await vincular(ADMIN, p1, m[PROD1], await version(p1), 'Se restablece el vínculo').expect(200);
    await http().get(`${api()}/plots/${plot1}`).set(as(PROD1)).expect(200);
  });
});
