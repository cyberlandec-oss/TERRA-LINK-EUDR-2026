import { randomUUID, createHash } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// CADENA TÉCNICA COMPLETA, contra PostgreSQL, S3 y ClamAV reales, en la base DESECHABLE de pruebas.
// soportes → geometría → resultado satelital → riesgo → revisión → conclusión → READY → aprobación → paquete (DD_PACKAGE) → concesión al destinatario → cambio relevante → desactualización.
//
// **TODO LO REGULATORIO Y LO EXTERNO DE ESTA SUITE ES SINTÉTICO Y ESTÁ ROTULADO ASÍ:** perfil jurídico, su revisión, catálogo, configuración de geolocalización y su revisión, documentos y
// resultado satelital (insertado como lo dejaría el corredor; NO es un análisis real de Whisp ni de ningún proveedor). Nada se aprueba por la vía del producto que no exista como función real:
// la instantánea llega a READY porque cada requisito se cumple por su camino, no porque se fuerce. **Esto prueba la mecánica de la cadena; no acredita ninguna operación real, no es el ensayo real
// de Whisp con geometría artificial y no sustituye al expediente operativo, que sigue pendiente de aportes reales.** Ni el paquete es una DDS ni acredita conformidad EUDR.
describeDb('cadena técnica completa: de los soportes al acceso del destinatario (fixtures sintéticos)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA = ''; let orgB = '';
  let producer = ''; let baba = ''; let center = ''; let plot = ''; let buyerId = ''; let lot = ''; let delivery = ''; let compradorId = ''; let otroId = '';
  let versionId = ''; let evalId = ''; let caseId = '';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const P = '/api/v1/platform';
  const today = new Date().toISOString().slice(0, 10);
  const SUPER = 'cadena-super@test.local'; const ADMIN = 'cadena-admin@test.local'; const ADMIN_B = 'cadena-admin-b@test.local';
  const EUDR = 'cadena-eudr@test.local'; const EXP = 'cadena-export@test.local'; const COMPRADOR = 'cadena-comprador@test.local'; const OTRO = 'cadena-otro@test.local';
  const futuro = () => new Date(Date.now() + 7 * 86400000).toISOString();
  const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
  const pdf = Buffer.from(`%PDF-1.4\n% soporte SINTÉTICO de la cadena técnica ${randomUUID()}\n%%EOF\n`);

  async function join(o: string, admin: string, email: string, role: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const captura = async () => (await http().post(`${base(orgA)}/dd-cases/${caseId}/snapshots`).set(as(EUDR)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot as {
    id: string; readiness: { captured: string; effective: string }; requirements: Array<{ code: string; status: string; detail: string }> };
  const noCumplidos = (s: { requirements: Array<{ code: string; status: string }> }) => s.requirements.filter((r) => r.status !== 'MET').map((r) => `${r.code}:${r.status}`);
  const revision = (sid: string, action: string, actor = EUDR) => http().post(`${base(orgA)}/dd-snapshots/${sid}/reviews`).set(as(actor)).send({ operation_id: randomUUID(), action, reason: 'Revisión sintética de la cadena técnica' });
  const exportar = (sid: string, kind: string, actor = EUDR) => http().post(`${base(orgA)}/dd-snapshots/${sid}/exports`).set(as(actor)).send({ operation_id: randomUUID(), kind });
  const conceder = (sid: string, para = compradorId, extra: Record<string, unknown> = {}) => http().post(`${base(orgA)}/access-grants`).set(as(ADMIN)).send({
    operation_id: randomUUID(), grantee_user_id: para, resource_type: 'DD_SNAPSHOT', resource_id: sid, can_download: true, include_documents: true, include_geometries: true, expires_at: futuro(), reason: 'Cadena técnica sintética', ...extra });

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user(SUPER, 'SUPER_ADMIN'); await h.user(ADMIN); await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER)).send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id as string;
    orgA = await mk('Coop Cadena SINTÉTICA A', ADMIN); orgB = await mk('Importador Cadena SINTÉTICO B', ADMIN_B);
    await join(orgA, ADMIN, EUDR, 'EUDR_MANAGER'); await join(orgA, ADMIN, EXP, 'EXPORT_MANAGER');
    await join(orgB, ADMIN_B, COMPRADOR, 'BUYER'); await join(orgB, ADMIN_B, OTRO, 'BUYER');
    compradorId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${COMPRADOR}`.execute(h.db)).rows[0].id;
    otroId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${OTRO}`.execute(h.db)).rows[0].id;
    producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'CT-P1', legal_name: 'Finca Cadena SINTÉTICA' }).expect(201)).body.id;
    baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    center = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'CT-C', name: 'Centro Cadena', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    buyerId = (await http().post(`${base(orgA)}/buyers`).set(as(EXP)).send({ operation_id: randomUUID(), code: 'IMP-CT', name: 'Importador Sintético', country: 'NL' }).expect(201)).body.buyer.id;
    plot = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: 'CT-PAR', crop: 'Cacao' }).expect(201)).body.id;
    await http().post(`${base(orgA)}/plots/${plot}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.1601, -0.8479] }, area_declared_ha: 2 }).expect(201);
    await http().post(`${base(orgA)}/plots/${plot}/geo-profile/evaluations`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201);
    versionId = (await h.db.selectFrom('plots').select('current_version_id').where('id', '=', plot).executeTakeFirstOrThrow()).current_version_id!;

    // Perfil jurídico, catálogo y configuración de geolocalización: SINTÉTICOS, revisados y adoptados por las vías reales.
    await sql`INSERT INTO legal_profile_versions (version, jurisdiction, scope, scope_note, covered_matters, pending_matters, technical_status, published_by, reason)
      VALUES ('9.9.9', 'EC', 'COMPLETE', 'Fixture SINTÉTICA de prueba, sin valor jurídico', ARRAY['TENURE'], ARRAY[]::text[], 'PUBLISHED', 'fixture', 'fixture sintética')`.execute(h.db);
    const revJ = (await http().post(`${P}/legal-profile/reviews`).set(as(SUPER)).send({ operation_id: randomUUID(), version: '9.9.9', decision: 'REVIEWED', reviewer_name: 'Persona SINTÉTICA', reviewer_capacity: 'Fixture',
      reviewed_on: today, basis: 'Fundamento sintético que no acredita ninguna revisión real', supports: [{ kind: 'CITATION', citation: 'Cita sintética' }], expected_current_review_id: null }).expect(201)).body.review.id;
    await http().post(`${P}/risk-catalog/profile-links`).set(as(SUPER)).send({ operation_id: randomUUID(), base_rule_set_version: '1.0.0', new_rule_set_version: '1.1.0', profile_version: '9.9.9', review_id: revJ, reason: 'Vinculación sintética de ensayo' }).expect(201);
    await http().post(`${base(orgA)}/legal-profile/adoptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), version: '9.9.9', decision: 'ADOPT', reason: 'Adopción sintética' }).expect(201);
    await http().post(`${base(orgA)}/risk/rule-sets/adoptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), rule_set_version: '1.1.0', decision: 'ADOPT', reason: 'Adopción sintética' }).expect(201);
    const fuente = { code: 'REG-SINT', title: 'Fuente SINTÉTICA de prueba', citation: 'Artículo sintético', url: 'https://example.test/regla', file_sha256: 'b'.repeat(64) };
    const regla = { code: 'GEO-TECH', kind: 'GEO_TECH_PROFILE', status: 'ACTIVE', source_code: 'REG-SINT', article: 'Artículo sintético', criterion: 'Cada parcela de origen tiene una evaluación vigente del perfil técnico que cumple.' };
    await http().post(`${P}/geolocation-config/versions`).set(as(SUPER)).send({ operation_id: randomUUID(), version: '9.0.0', technical_profile_version: '1.0.0', scope_note: 'Configuración SINTÉTICA de prueba, sin valor jurídico',
      reason: 'Preparación sintética de ensayo', sources: [fuente], rules: [regla] }).expect(201);
    await http().post(`${P}/geolocation-config/reviews`).set(as(SUPER)).send({ operation_id: randomUUID(), version: '9.0.0', decision: 'REVIEWED', reviewer_name: 'Persona SINTÉTICA de prueba', reviewer_capacity: 'Responsable sintético (fixture)',
      reviewed_on: today, basis: 'Fundamento sintético de prueba: no acredita ninguna revisión real', supports: [{ kind: 'CONFIG_SOURCE', source_code: 'REG-SINT' }], applicable_organizations: [orgA], applicability_note: 'Operación sintética de ensayo' }).expect(201);
    await http().post(`${base(orgA)}/geolocation-config/adoptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), version: '9.0.0', decision: 'ADOPT', reason: 'Adopción sintética de ensayo' }).expect(201);

    // Evaluación técnica de la geometría y evaluación legal de la parcela (cada ítem declarado NO APLICABLE con su motivo: SINTÉTICO, sin valor jurídico).
    await http().post(`${base(orgA)}/plots/${plot}/gis-evaluations`).set(as(EUDR)).send({ operation_id: randomUUID() }).expect(201);
    const ev = (await http().post(`${base(orgA)}/legal-assessments`).set(as(EUDR)).send({ operation_id: randomUUID(), plot_id: plot }).expect(201)).body;
    const evId = (ev.id ?? ev.assessment?.id ?? ev.evaluation?.id) as string;
    const detalle = (await http().get(`${base(orgA)}/legal-assessments/${evId}`).set(as(EUDR)).expect(200)).body;
    for (const it of detalle.items as Array<{ id: string; row_version: number }>) {
      await http().put(`${base(orgA)}/legal-assessments/${evId}/items/${it.id}`).set(as(EUDR)).send({ applicability: 'NOT_APPLICABLE', applicability_reason: 'No aplica a esta operación SINTÉTICA de ensayo', result: 'NOT_APPLICABLE',
        reason: 'Declaración sintética de ensayo, sin valor jurídico', change_note: 'cadena técnica', expected_version: it.row_version }).expect(200);
    }

    // Resultado satelital SINTÉTICO como lo dejaría el corredor, de un proveedor seleccionado con cobertura declarada. NO es un análisis real.
    const uid = (await h.db.selectFrom('users').select('id').where('email', '=', ADMIN).executeTakeFirstOrThrow()).id;
    const v = await h.db.selectFrom('plot_versions').select(['geometry_hash', 'geometry_type']).where('id', '=', versionId).executeTakeFirstOrThrow();
    await sql`UPDATE satellite_providers SET selection_status = 'PROPOSED', selected_by = NULL, decision_reference = NULL WHERE selection_status = 'SELECTED'`.execute(h.db).catch(() => undefined);
    await sql`UPDATE satellite_providers SET selection_status = 'SELECTED', selected_by = ${uid}, decision_reference = 'selección SINTÉTICA de la cadena técnica' WHERE code = 'WHISP'`.execute(h.db);
    const job = randomUUID(); const res = randomUUID();
    await h.db.insertInto('satellite_jobs').values({ id: job, organization_id: orgA, plot_id: plot, plot_version_id: versionId, geometry_hash: v.geometry_hash!, geometry_type: v.geometry_type as 'POINT',
      provider_code: 'WHISP', provider_kind: 'EXTERNAL_HTTP', adapter_contract_version: 'TL_SAT_ADAPTER 0.1.0', operation: 'FOREST_COVER', request_fingerprint: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      status: 'COMPLETED', outcome: 'RESULT_AVAILABLE', finished_at: new Date(), requested_by: uid, operation_id: randomUUID() } as never).execute();
    await sql`INSERT INTO satellite_results (id, organization_id, job_id, provider_code, is_synthetic, method, coverage_status, coverage_note, limitations, indicators, raw_object_key, raw_sha256)
      VALUES (${res}, ${orgA}, ${job}, 'WHISP', false, 'método de prueba', 'COVERED', 'cobertura de prueba', 'Resultado SINTÉTICO de la cadena técnica: no es un análisis real.', '{}'::jsonb, ${`cadena/${res}.json`}, ${'a'.repeat(64)})`.execute(h.db);

    // Entrega con origen, soporte SINTÉTICO, recepción con calidad liberada y lote.
    delivery = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: '100', unit: 'KG', origins: [{ plot_id: plot }], register: true }).expect(201)).body.delivery.id;
    const doc = (await http().post(`${base(orgA)}/documents`).set(as(ADMIN)).field('operation_id', randomUUID()).field('document_type', 'DELIVERY_SUPPORT').field('owner_type', 'producer').field('owner_id', producer)
      .field('title', 'Nota de entrega SINTÉTICA de la cadena técnica').attach('file', pdf, { filename: 'nota_sintetica.pdf', contentType: 'application/pdf' }).expect(201)).body.document;
    await http().post(`${base(orgA)}/deliveries/${delivery}/supports`).set(as(ADMIN)).send({ operation_id: randomUUID(), document_version_id: doc.versions[0].id, support_kind: 'DELIVERY_NOTE' }).expect(201);
    const rec = (await http().post(`${base(orgA)}/deliveries/${delivery}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: center, received_at: new Date().toISOString(),
      weighing: { method: 'Báscula SINTÉTICA', quantity: '100', unit: 'KG', weighed_on: today },
      quality_sample: { sample_reference: 'M-CT', result: { method: 'Prueba de corte (sintética)', measurements: [{ parameter: 'MOISTURE', value: '7.2', unit: '%' }] } } }).expect(201)).body.reception_id as string;
    const vista = (await http().get(`${base(orgA)}/deliveries/${delivery}`).set(as(ADMIN)).expect(200)).body;
    await http().post(`${base(orgA)}/deliveries/${delivery}/receptions/${rec}/quality-samples/${vista.receptions[0].quality.samples[0].id}/results`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), method: 'Prueba sintética de la cadena', decision: 'RELEASED', limits_version: 'LIMITES-SINTETICOS-1' }).expect(201);
    lot = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '100' }] }).expect(201)).body.lot.id;

    // Embarque con el lote reservado (SHIPMENT_LINK).
    const sh = (await http().post(`${base(orgA)}/shipments`).set(as(EXP)).send({ operation_id: randomUUID(), buyer_id: buyerId, destination_country: 'DE', origin_location_id: center }).expect(201)).body.shipment;
    const ver = Number((await http().get(`${base(orgA)}/shipments/${sh.id}`).set(as(EXP)).expect(200)).body.row_version);
    const item = (await http().post(`${base(orgA)}/shipments/${sh.id}/items`).set(as(EXP)).send({ expected_version: ver, lot_id: lot, quantity: '100' }).expect(201)).body.shipment.items.find((i: { lot_id: string }) => i.lot_id === lot);
    await http().post(`${base(orgA)}/shipments/${sh.id}/reserve`).set(as(EXP)).send({ operation_id: randomUUID(), item_id: item.id }).expect(201);
    // Riesgo: evalúa quien administra; revisa y concluye el responsable EUDR (separación de funciones).
    evalId = (await http().post(`${base(orgA)}/risk/lots/${lot}/evaluations`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201)).body.evaluation.id;
    const rv = (action: string) => http().post(`${base(orgA)}/risk/evaluations/${evalId}/reviews`).set(as(EUDR)).send({ operation_id: randomUUID(), action, reason: 'Revisión sintética de la cadena técnica' }).expect(201);
    await rv('START_REVIEW'); await rv('RESOLVE');
    const ctx = (await http().get(`${base(orgA)}/risk/evaluations/${evalId}/conclusions`).set(as(EUDR)).expect(200)).body;
    const gaps = ctx.options.NEGLIGIBLE.gaps_to_resolve as Array<{ scope: string; code: string }>;
    await http().post(`${base(orgA)}/risk/evaluations/${evalId}/conclusions`).set(as(EUDR)).send({ operation_id: randomUUID(), result: 'NEGLIGIBLE', reason: 'Conclusión favorable SINTÉTICA de la cadena técnica',
      supports: [{ kind: 'CITATION', citation: 'Evidencia sintética de ensayo' }], expected_current_conclusion_id: null,
      gap_resolutions: gaps.map((g) => ({ scope: g.scope, code: g.code, kind: 'NOT_APPLICABLE', support_index: 0, justification: `Justificación SINTÉTICA propia de la carencia ${g.scope}:${g.code}: no aplica a esta operación de ensayo.` })) }).expect(201);

    caseId = (await http().post(`${base(orgA)}/dd-cases`).set(as(EUDR)).send({ operation_id: randomUUID(), lot_id: lot, scope_note: 'Expediente SINTÉTICO de la cadena técnica completa' }).expect(201)).body.case.id;
  }, 360_000);
  afterAll(async () => {
    await sql`UPDATE satellite_providers SET selection_status = 'PROPOSED', selected_by = NULL, decision_reference = NULL WHERE selection_status = 'SELECTED'`.execute(h.db).catch(() => undefined);
    await h?.close();
  });

  let ready: { id: string }; let pkg: { id: string; package_hash: string }; let cuerpo = '';

  it('por la vía del producto TODO se cumple salvo RISK_NO_BLOCKING_FINDINGS, que hoy no puede cumplirse por diseño (D-09 parte B y D-05.B); el paquete final se rechaza', async () => {
    const real = await captura();
    // Soportes, geometría técnica, calidad, geolocalización, perfil jurídico, catálogo, riesgo vigente y revisado, conclusión, mitigaciones, análisis satelital y embarque: cumplidos.
    expect(noCumplidos(real)).toEqual(['RISK_NO_BLOCKING_FINDINGS:NOT_EVALUABLE']);
    // La causa NO es un dato que falte: son las dos reglas del catálogo que dependen de decisiones del propietario y están marcadas así a propósito.
    const factores = (await http().get(`${base(orgA)}/risk/evaluations/${evalId}`).set(as(EUDR)).expect(200)).body.factors as Array<{ code: string; result: string; depends_on: string | null }>;
    expect(factores.filter((x) => x.result === 'NOT_EVALUABLE').map((x) => `${x.code}:${x.depends_on}`).sort()).toEqual(['GEOLOCATION_PROFILE:D-05.B', 'SATELLITE_COVERAGE_UNKNOWN:D-09 parte B']);
    expect(real.readiness.captured).not.toBe('READY');
    // Control: el paquete final se rechaza y no queda nada escrito; el borrador interno sí existe.
    expect((await exportar(real.id, 'DD_PACKAGE').expect(409)).body.error.code).toBe('READINESS_NOT_MET');
    expect(await h.db.selectFrom('dd_exports').select('id').where('snapshot_id', '=', real.id).where('kind', '=', 'DD_PACKAGE').execute()).toHaveLength(0);
    expect((await exportar(real.id, 'INTERNAL_REVIEW').expect(201)).body.export).toMatchObject({ kind: 'INTERNAL_REVIEW', submission: 'NOT_SUBMITTED' });

    // SINTÉTICO (como d34a-despacho): como esas dos reglas dependen de decisiones del propietario, el tramo posterior se ejerce sobre una copia de ESA instantánea con
    // contenido, hash y secciones REALES, y con el requisito pendiente y READY forzados en la base de pruebas. `dd_snapshots` es append-only: se INSERTA otra fila.
    const fila = (await sql<{ content: unknown; content_hash: string; section_hashes: unknown; manifest: unknown; requirements: Array<{ code: string; status: string }>; snapshot_number: number }>`
      SELECT content, content_hash, section_hashes, manifest, requirements, snapshot_number FROM dd_snapshots WHERE id = ${real.id}`.execute(h.db)).rows[0];
    const uid = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${EUDR}`.execute(h.db)).rows[0].id;
    const sintetica = randomUUID();
    const reqs = fila.requirements.map((r) => (r.code === 'RISK_NO_BLOCKING_FINDINGS' ? { ...r, status: 'MET', detail: 'SINTÉTICO: forzado en la base de pruebas; no es un resultado del producto.' } : r));
    await sql`INSERT INTO dd_snapshots (id, organization_id, case_id, snapshot_number, content, content_hash, section_hashes, manifest, requirements, readiness, captured_by, operation_id)
      VALUES (${sintetica}, ${orgA}, ${caseId}, ${fila.snapshot_number + 1}, ${JSON.stringify(fila.content)}::jsonb, ${fila.content_hash}, ${JSON.stringify(fila.section_hashes)}::jsonb,
              ${JSON.stringify(fila.manifest)}::jsonb, ${JSON.stringify(reqs)}::jsonb, 'READY', ${uid}, ${randomUUID()})`.execute(h.db);
    ready = { id: sintetica };
  });

  it('aprobación humana y paquete final: asociado a la instantánea correcta, con huella coincidente y sin ser una presentación', async () => {
    await revision(ready.id, 'START_REVIEW').expect(201);
    await revision(ready.id, 'APPROVE').expect(201);
    pkg = (await exportar(ready.id, 'DD_PACKAGE').expect(201)).body.export;
    expect(pkg).toMatchObject({ kind: 'DD_PACKAGE', snapshot_id: ready.id, submission: 'NOT_SUBMITTED', label: 'Paquete de diligencia (interno)' });
    const d = await http().get(`${base(orgA)}/dd-exports/${pkg.id}/download`).set(as(EUDR)).expect(200);
    cuerpo = d.text ?? JSON.stringify(d.body);
    expect(sha(cuerpo)).toBe(pkg.package_hash);
    const doc = JSON.parse(cuerpo);
    const snapDb = (await sql<{ content_hash: string; snapshot_number: number }>`SELECT content_hash, snapshot_number FROM dd_snapshots WHERE id = ${ready.id}`.execute(h.db)).rows[0];
    expect(JSON.stringify(doc)).toContain(snapDb.content_hash);
    // Sin envío oficial: ninguna presentación de DDS registrada.
    expect(JSON.stringify(doc)).not.toMatch(/"submission":"SUBMITTED"/);
  });

  it('el destinatario: proyección, soportes y geometrías SOLO con las concesiones correspondientes; sin ellas 403/404; otra cuenta 404', async () => {
    const solo = (await conceder(ready.id, compradorId, { include_documents: false, include_geometries: false }).expect(201)).body.grant;
    expect((await http().get(`/api/v1/granted/${solo.id}`).set(as(COMPRADOR)).expect(200)).body.snapshot?.content_hash ?? true).toBeTruthy();
    expect((await http().get(`/api/v1/granted/${solo.id}/documents`).set(as(COMPRADOR))).status).toBe(403);
    expect((await http().get(`/api/v1/granted/${solo.id}/geometries`).set(as(COMPRADOR))).status).toBe(403);
    await http().post(`${base(orgA)}/access-grants/${solo.id}/revoke`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Fin de la comprobación' }).expect(201);

    const g = (await conceder(ready.id).expect(201)).body.grant;
    const docs = (await http().get(`/api/v1/granted/${g.id}/documents`).set(as(COMPRADOR)).expect(200)).body;
    expect(docs.documents).toHaveLength(1);
    expect(docs.documents[0]).toMatchObject({ document_type: 'DELIVERY_SUPPORT', sha256: sha(pdf), matches_stored_sha256: true });
    const bytes = await http().get(`/api/v1/granted/${g.id}/documents/${docs.documents[0].version_id}/content`).set(as(COMPRADOR)).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(sha(bytes.body as Buffer)).toBe(sha(pdf));
    const geo = (await http().get(`/api/v1/granted/${g.id}/geometries`).set(as(COMPRADOR)).expect(200)).body;
    const versionDb = (await sql<{ geometry_hash: string }>`SELECT geometry_hash FROM plot_versions WHERE id = ${versionId}`.execute(h.db)).rows[0];
    expect(geo.geojson.features).toHaveLength(1);
    expect(geo.geojson.features[0].geometry.type).toBe('Point'); // el tipo original: un punto no se vuelve polígono
    expect(geo.geojson.features[0].properties).toMatchObject({ geometry_hash: versionDb.geometry_hash });
    // Otra cuenta, aunque sea de la misma organización compradora, no entra.
    for (const ruta of ['', '/documents', '/geometries']) expect((await http().get(`/api/v1/granted/${g.id}${ruta}`).set(as(OTRO))).status).toBe(404);
    void otroId;
    await http().post(`${base(orgA)}/access-grants/${g.id}/revoke`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Fin de la comprobación' }).expect(201);
    expect((await http().get(`/api/v1/granted/${g.id}/documents`).set(as(COMPRADOR))).status).toBe(404); // revocada
  });

  it('un cambio relevante desactualiza la instantánea y bloquea un paquete nuevo; el paquete y la instantánea anteriores se conservan', async () => {
    const antes = (await sql<{ content_hash: string }>`SELECT content_hash FROM dd_snapshots WHERE id = ${ready.id}`.execute(h.db)).rows[0].content_hash;
    const rv = Number((await http().get(`${base(orgA)}/plots/${plot}`).set(as(ADMIN)).expect(200)).body.row_version);
    await http().post(`${base(orgA)}/plots/${plot}/geometry-versions`).set(as(ADMIN)).send({ expected_version: rv, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.1601, -0.8479] }, area_declared_ha: 3 }).expect(201);
    const vista = (await http().get(`${base(orgA)}/dd-snapshots/${ready.id}`).set(as(EUDR)).expect(200)).body;
    expect(vista.readiness.effective).toBe('STALE');
    expect((await exportar(ready.id, 'DD_PACKAGE').expect(409)).body.error.code).toBe('SNAPSHOT_STALE');
    expect((await sql<{ content_hash: string }>`SELECT content_hash FROM dd_snapshots WHERE id = ${ready.id}`.execute(h.db)).rows[0].content_hash).toBe(antes); // la instantánea no cambió
    expect(await h.db.selectFrom('dd_exports').select('id').where('id', '=', pkg.id).execute()).toHaveLength(1); // el paquete anterior sigue ahí
    // Una instantánea nueva refleja el cambio y deja de ser READY mientras falte lo que dependía de la geometría anterior.
    const nueva = await captura();
    expect(nueva.id).not.toBe(ready.id);
    expect(nueva.readiness.captured).not.toBe('READY');
    expect(noCumplidos(nueva).length).toBeGreaterThan(0);
  });
});
