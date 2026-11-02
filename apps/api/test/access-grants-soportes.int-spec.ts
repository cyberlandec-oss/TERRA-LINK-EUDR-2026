import { randomUUID, createHash } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { ROLE_PERMISSIONS } from '../src/authz/catalog';
import { S3ObjectStore } from '../src/storage/object-store';

// Compartir los SOPORTES de una instantánea de diligencia (concesión con `include_documents`), contra PostgreSQL, S3 y ClamAV reales. Datos SINTÉTICOS.
// Lo que se demuestra: explícito y apagado por defecto; solo las versiones que ESA instantánea referencia (no las posteriores ni otras de la organización);
// sin documentos de datos personales (ni su nombre, título o tipo); vencimiento, revocación, destinatario, escaneo y huella comprobados al listar y al descargar.
// Lo que NO se demuestra: que el comprador obtenga con esto todo lo que necesita como operador europeo (geometrías y documentos personales siguen fuera).
describeDb('concesión de una instantánea con soportes: alcance exacto, exclusiones y límites', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA = ''; let orgB = '';
  let externoId = ''; let otroId = '';
  let producer = ''; let delivery = ''; let lot = '';
  let docOp: { id: string; versionId: string; sha: string; bytes: Buffer; title: string };
  let snap: { id: string; snapshot_number: number }; let caso: { id: string; case_number: string };
  let docAjeno = '';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local'; const ADMIN_B = 'admin-b@test.local';
  const EXTERNO = 'comprador-soportes@test.local'; const OTRO = 'otro-comprador@test.local'; const TEC = 'tecnico@test.local';
  const futuro = (dias = 7) => new Date(Date.now() + dias * 86400000).toISOString();
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const pdf = (marca: string) => Buffer.from(`%PDF-1.4\n% soporte sintético ${marca} ${randomUUID()}\n%%EOF\n`);

  async function join(o: string, email: string, role: string, admin: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const subir = async (org: string, admin: string, tipo: string, titulo: string, owner: string, bytes: Buffer) => {
    const d = (await http().post(`${base(org)}/documents`).set(as(admin)).field('operation_id', randomUUID()).field('document_type', tipo).field('owner_type', 'producer').field('owner_id', owner)
      .field('title', titulo).attach('file', bytes, { filename: `${titulo.replace(/\W+/g, '_')}.pdf`, contentType: 'application/pdf' }).expect(201)).body.document;
    return { id: d.id as string, versionId: d.versions[0].id as string, title: titulo };
  };
  const conceder = (cuerpo: Record<string, unknown>, actor = ADMIN, org = orgA) =>
    http().post(`${base(org)}/access-grants`).set(as(actor)).send({ operation_id: randomUUID(), ...cuerpo });
  const revocar = (id: string) => http().post(`${base(orgA)}/access-grants/${id}/revoke`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Fin de la comprobación' });
  const listar = (g: string, actor = EXTERNO) => http().get(`/api/v1/granted/${g}/documents`).set(as(actor));
  const bajar = (g: string, version: string, actor = EXTERNO) => http().get(`/api/v1/granted/${g}/documents/${version}/content`).set(as(actor)).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
  const concesionDeSoportes = async (extra: Record<string, unknown> = {}) =>
    (await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap.id, can_download: true, include_documents: true, expires_at: futuro(), reason: 'Soportes de la instantánea', ...extra }).expect(201)).body.grant as { id: string };
  const reclasificar = async (clasificacion: 'OPERATIONAL' | 'PERSONAL_DATA') => {
    await sql`ALTER TABLE document_types DISABLE TRIGGER document_types_no_mutation`.execute(h.db);
    try { await sql`UPDATE document_types SET classification = ${clasificacion} WHERE code = 'DELIVERY_SUPPORT'`.execute(h.db); }
    finally { await sql`ALTER TABLE document_types ENABLE TRIGGER document_types_no_mutation`.execute(h.db); }
  };
  const objeto = async (versionId: string) => (await sql<{ object_key: string }>`SELECT object_key FROM document_versions WHERE id = ${versionId}`.execute(h.db)).rows[0].object_key;

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN'); await h.user(ADMIN); await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Soportes A', ADMIN); orgB = await mk('Coop Soportes B', ADMIN_B);
    await join(orgA, TEC, 'FIELD_TECHNICIAN', ADMIN);
    await join(orgB, EXTERNO, 'BUYER', ADMIN_B); await join(orgB, OTRO, 'BUYER', ADMIN_B);
    externoId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${EXTERNO}`.execute(h.db)).rows[0].id;
    otroId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${OTRO}`.execute(h.db)).rows[0].id;
    void otroId;
    const baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    const centro = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'C-S', name: 'Centro S', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'SP-P', legal_name: 'Finca Soportes' }).expect(201)).body.id;
    const parcela = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: 'SP-PAR', crop: 'Cacao' }).expect(201)).body.id;
    await http().post(`${base(orgA)}/plots/${parcela}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.16, -0.848] }, area_declared_ha: 2 }).expect(201);
    delivery = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: '100', unit: 'KG', origins: [{ plot_id: parcela }], register: true }).expect(201)).body.delivery.id;
    const rec = (await http().post(`${base(orgA)}/deliveries/${delivery}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: centro, received_at: new Date().toISOString(), weighing: { method: 'Báscula sintética', quantity: '100', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    lot = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '100' }] }).expect(201)).body.lot.id;

    // Soporte de la entrega (el único tipo que se vincula a una entrega es «soporte de entrega»).
    const bytes = pdf('operativo');
    const op = await subir(orgA, ADMIN, 'DELIVERY_SUPPORT', 'Nota de entrega SOPORTE-OP', producer, bytes);
    docOp = { ...op, sha: sha(bytes), bytes };
    for (const v of [docOp.versionId]) {
      await http().post(`${base(orgA)}/deliveries/${delivery}/supports`).set(as(ADMIN)).send({ operation_id: randomUUID(), document_version_id: v, support_kind: 'DELIVERY_NOTE' }).expect(201);
    }
    caso = (await http().post(`${base(orgA)}/dd-cases`).set(as(ADMIN)).send({ operation_id: randomUUID(), lot_id: lot, scope_note: 'Expediente sintético con soportes' }).expect(201)).body.case;
    snap = (await http().post(`${base(orgA)}/dd-cases/${caso.id}/snapshots`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot;
    // Un documento de OTRA organización, con su versión: jamás debe alcanzarse por una concesión de A.
    const prodB = (await http().post(`${base(orgB)}/producers`).set(as(ADMIN_B)).send({ producer_code: 'SB-P', legal_name: 'Finca B' }).expect(201)).body.id;
    docAjeno = (await subir(orgB, ADMIN_B, 'DELIVERY_SUPPORT', 'Documento de la organización B', prodB, pdf('ajeno'))).versionId;
  });
  afterAll(async () => h?.close());

  it('catálogo: solo quienes administran concesiones pueden compartir soportes, y todos ellos leen documentos (no se concede lo que no se tiene)', () => {
    for (const [rol, perms] of Object.entries(ROLE_PERMISSIONS)) if (perms.includes('grant:manage')) expect([rol, perms.includes('document:read'), perms.includes('dd:read')]).toEqual([rol, true, true]);
  });

  it('la instantánea trae el soporte en su contenido (control de partida), con huella', async () => {
    const r = await sql<{ content: { documents: Array<{ version_id: string; sha256: string; classification: string }> } }>`SELECT content FROM dd_snapshots WHERE id = ${snap.id}`.execute(h.db);
    const docs = r.rows[0].content.documents;
    expect(docs.map((d) => d.version_id)).toEqual([docOp.versionId]);
    expect(docs.find((d) => d.version_id === docOp.versionId)).toMatchObject({ sha256: docOp.sha, classification: 'OPERATIONAL' });
  });

  it('la pantalla puede ofrecer las instantáneas para compartir (defecto hallado en el recorrido web: la consulta fallaba con 500)', async () => {
    const r = await http().get(`${base(orgA)}/access-grants/shareable?type=DD_SNAPSHOT`).set(as(ADMIN)).expect(200);
    expect(r.body).toMatchObject({ type: 'DD_SNAPSHOT', available: true });
    expect(r.body.items.map((i: { id: string }) => i.id)).toContain(snap.id);
    expect(r.body.items.find((i: { id: string }) => i.id === snap.id).label).toContain(caso.case_number);
    // Solo las de la propia organización: la otra no ve instantáneas ajenas.
    expect((await http().get(`${base(orgB)}/access-grants/shareable?type=DD_SNAPSHOT`).set(as(ADMIN_B)).expect(200)).body.items.map((i: { id: string }) => i.id)).not.toContain(snap.id);
  });

  it('por omisión NO se comparten archivos: la concesión existente conserva su alcance anterior y los soportes responden 403 claro', async () => {
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap.id, can_download: true, expires_at: futuro(), reason: 'Solo la vista' }).expect(201)).body.grant;
    expect(g.include_documents).toBe(false);
    expect((await http().get('/api/v1/granted').set(as(EXTERNO)).expect(200)).body.grants.find((x: { id: string }) => x.id === g.id).include_documents).toBe(false);
    const v = (await http().get(`/api/v1/granted/${g.id}`).set(as(EXTERNO)).expect(200)).body;
    expect(v.documents).toEqual({ shared: false });
    const l = await listar(g.id).expect(403);
    expect(l.body.error.code).toBe('GRANT_DOCUMENTS_NOT_INCLUDED');
    const c = await bajar(g.id, docOp.versionId).expect(403);
    expect(JSON.parse(c.body.toString()).error.code).toBe('GRANT_DOCUMENTS_NOT_INCLUDED');
    // La vista compartida descargable tampoco trae archivos ni nombres de documentos.
    const d = await http().get(`/api/v1/granted/${g.id}/download`).set(as(EXTERNO)).expect(200);
    expect(JSON.stringify(d.body)).not.toContain('SOPORTE-OP');
    await revocar(g.id).expect(201);
  });

  it('explícita y acotada: solo una instantánea, con lectura, y por quien puede administrar concesiones', async () => {
    const lote = { grantee_user_id: externoId, resource_type: 'LOT', resource_id: lot, include_documents: true, expires_at: futuro(), reason: 'Prueba' };
    expect((await conceder(lote).expect(422)).body.error.code).toBe('GRANT_DOCUMENTS_ONLY_FOR_SNAPSHOT');
    const sinLeer = await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap.id, can_read: false, can_download: true, include_documents: true, expires_at: futuro(), reason: 'Prueba' }).expect(422);
    expect(['GRANT_DOCUMENTS_REQUIRE_READ', 'VALIDATION_FAILED']).toContain(sinLeer.body.error.code);
    await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap.id, include_documents: true, expires_at: futuro(), reason: 'Prueba' }, TEC).expect(403);
    await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap.id, include_documents: 'si', expires_at: futuro(), reason: 'Prueba' }).expect(400);
  });

  it('recorrido completo: lista exacta con huellas, sin lo personal (ni título, nombre, tipo ni huella), y descarga de los bytes exactos, auditada', async () => {
    const g = await concesionDeSoportes();
    // El destinatario ve en SU lista que esta concesión incluye soportes (la pantalla decide qué mostrar con eso; la API revalida igual).
    expect((await http().get('/api/v1/granted').set(as(EXTERNO)).expect(200)).body.grants.find((x: { id: string }) => x.id === g.id)).toMatchObject({ include_documents: true, can_download: true });
    const v = (await http().get(`/api/v1/granted/${g.id}`).set(as(EXTERNO)).expect(200)).body;
    expect(v.documents).toEqual({ shared: true, shareable_count: 1, restricted_count: 0 });
    const l = (await listar(g.id).expect(200)).body;
    expect(l.documents).toHaveLength(1);
    expect(l.documents[0]).toMatchObject({ version_id: docOp.versionId, title: 'Nota de entrega SOPORTE-OP', document_type: 'DELIVERY_SUPPORT', version_number: 1, sha256: docOp.sha, matches_stored_sha256: true, availability: 'AVAILABLE', downloadable: true, size_bytes: docOp.bytes.length });
    expect(l.restricted_count).toBe(0);
    expect(l.snapshot_content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(l.limits.join(' ')).toMatch(/No es el expediente completo/);
    // Descarga: los bytes exactos, con su huella, sin caché.
    const r = await bajar(g.id, docOp.versionId).expect(200);
    expect(sha(r.body as Buffer)).toBe(docOp.sha);
    expect(Buffer.compare(r.body as Buffer, docOp.bytes)).toBe(0);
    expect(r.headers['x-content-sha256']).toBe(docOp.sha);
    expect(r.headers['cache-control']).toBe('no-store');
    // Persistencia de la auditoría: quién, qué versión y qué huella.
    const aud = await sql<{ action: string; after: { version_id?: string; sha256?: string } }>`SELECT action, after FROM audit_logs WHERE organization_id = ${orgA} AND entity_id = ${g.id} AND action IN ('grant.documents_list', 'grant.document_download') ORDER BY occurred_at`.execute(h.db);
    expect(aud.rows.map((a) => a.action)).toEqual(['grant.documents_list', 'grant.document_download']);
    expect(aud.rows[1].after).toMatchObject({ version_id: docOp.versionId, sha256: docOp.sha });
    // Lo personal, lo de otra organización y lo que no existe: indistinguibles (404), también por identificador conocido.
    for (const ver of [docAjeno, randomUUID()]) await bajar(g.id, ver).expect(404);
    await revocar(g.id).expect(201);
  });

  it('datos personales: la clasificación se lee de nuevo al listar y al descargar, y lo excluido no filtra título, archivo, tipo ni identificadores', async () => {
    const g = await concesionDeSoportes();
    await listar(g.id).expect(200);
    await reclasificar('PERSONAL_DATA');
    try {
      // La instantánea registró OPERATIONAL, pero HOY el tipo es de datos personales: se excluye (solo cifra).
      const l = (await listar(g.id).expect(200)).body;
      expect(l.documents).toEqual([]);
      expect(l.restricted_count).toBe(1);
      const texto = JSON.stringify(l);
      for (const prohibido of ['SOPORTE-OP', 'DELIVERY_SUPPORT', docOp.versionId, docOp.id, docOp.sha]) expect(texto).not.toContain(prohibido);
      await bajar(g.id, docOp.versionId).expect(404);
      // Una instantánea tomada con el tipo ya clasificado como personal lo registra así: tampoco se comparte.
      const snap2 = (await http().post(`${base(orgA)}/dd-cases/${caso.id}/snapshots`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot;
      const g2 = (await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap2.id, can_download: true, include_documents: true, expires_at: futuro(), reason: 'Instantánea con soporte personal' }).expect(201)).body.grant;
      expect((await http().get(`/api/v1/granted/${g2.id}`).set(as(EXTERNO)).expect(200)).body.documents).toEqual({ shared: true, shareable_count: 0, restricted_count: 1 });
      expect((await listar(g2.id).expect(200)).body).toMatchObject({ documents: [], restricted_count: 1 });
      await bajar(g2.id, docOp.versionId).expect(404);
      await revocar(g2.id).expect(201);
    } finally {
      await reclasificar('OPERATIONAL');
    }
    await bajar(g.id, docOp.versionId).expect(200); // control: restablecida la clasificación, el destinatario vuelve a recibirlo
    await revocar(g.id).expect(201);
  });

  it('una versión posterior o un documento nuevo NO amplían lo compartido: solo las versiones de ESA instantánea', async () => {
    const g = await concesionDeSoportes();
    const antes = (await listar(g.id).expect(200)).body.documents.map((d: { version_id: string }) => d.version_id);
    // Nueva versión del MISMO documento y un documento nuevo del mismo productor.
    const nueva = await http().post(`${base(orgA)}/documents/${docOp.id}/versions`).set(as(ADMIN)).field('operation_id', randomUUID()).attach('file', pdf('v2'), { filename: 'v2.pdf', contentType: 'application/pdf' }).expect(201);
    const versionNueva = (nueva.body.document?.versions ?? nueva.body.versions).find((x: { id: string }) => x.id !== docOp.versionId).id as string;
    const otro = await subir(orgA, ADMIN, 'DELIVERY_SUPPORT', 'Documento posterior', producer, pdf('posterior'));
    const despues = (await listar(g.id).expect(200)).body.documents.map((d: { version_id: string }) => d.version_id);
    expect(despues).toEqual(antes);
    for (const ver of [versionNueva, otro.versionId]) await bajar(g.id, ver).expect(404);
    await bajar(g.id, docOp.versionId).expect(200); // la versión de la instantánea sigue siendo la entregada
    await revocar(g.id).expect(201);
  });

  it('destinatario incorrecto: otra cuenta (incluso de la misma organización compradora) no lista ni descarga; sin concesión tampoco', async () => {
    const g = await concesionDeSoportes();
    await listar(g.id, OTRO).expect(404);
    await bajar(g.id, docOp.versionId, OTRO).expect(404);
    await listar(g.id, ADMIN_B).expect(404);
    await listar(g.id, ADMIN).expect(404); // ni siquiera quien concede entra por la vía del destinatario
    await listar(randomUUID()).expect(404);
    await listar(g.id).expect(200); // control: el destinatario real
    await revocar(g.id).expect(201);
  });

  it('descarga sin permiso de descarga: lista sí, archivo no (la concesión solo lee)', async () => {
    const g = await concesionDeSoportes({ can_download: false });
    const l = (await listar(g.id).expect(200)).body;
    expect(l.documents[0]).toMatchObject({ downloadable: false, availability: 'AVAILABLE' });
    await bajar(g.id, docOp.versionId).expect(404);
    await revocar(g.id).expect(201);
  });

  it('vencida y revocada: ni la lista ni la descarga; lo ya auditado persiste y no aparecen usos nuevos', async () => {
    const g = await concesionDeSoportes();
    await listar(g.id).expect(200);
    await revocar(g.id).expect(201);
    await listar(g.id).expect(404);
    await bajar(g.id, docOp.versionId).expect(404);

    const v = await concesionDeSoportes();
    await sql`ALTER TABLE access_grants DISABLE TRIGGER access_grants_inmutable`.execute(h.db);
    try { await sql`UPDATE access_grants SET created_at = now() - interval '3 days', expires_at = now() - interval '1 day' WHERE id = ${v.id}`.execute(h.db); }
    finally { await sql`ALTER TABLE access_grants ENABLE TRIGGER access_grants_inmutable`.execute(h.db); }
    await listar(v.id).expect(404);
    await bajar(v.id, docOp.versionId).expect(404);
    const usos = await sql<{ n: string }>`SELECT count(*)::text AS n FROM audit_logs WHERE entity_id = ${v.id} AND action IN ('grant.documents_list', 'grant.document_download')`.execute(h.db);
    expect(usos.rows[0].n).toBe('0');
    await revocar(v.id).expect(201); // cierra la vencida: la restricción de «una activa» sigue contando las no revocadas
  });

  it('los términos no se editan: activar los soportes después exige revocar y conceder otra', async () => {
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap.id, can_download: true, expires_at: futuro(), reason: 'Sin soportes' }).expect(201)).body.grant;
    await expect(sql`UPDATE access_grants SET include_documents = true WHERE id = ${g.id}`.execute(h.db)).rejects.toThrow(/no se editan/);
    await expect(sql`UPDATE access_grants SET resource_type = 'LOT', include_documents = true WHERE id = ${g.id}`.execute(h.db)).rejects.toThrow();
    await revocar(g.id).expect(201);
  });

  it('archivo no disponible: rechazado por el antimalware, escaneo fallido, huella alterada y almacenamiento ausente NO se entregan (y la lista lo dice)', async () => {
    const g = await concesionDeSoportes();
    const store = new S3ObjectStore(h.config.objectStore);
    const clave = await objeto(docOp.versionId);
    // 1) Huella alterada en el almacén: no se entrega.
    await store.put(clave, Buffer.from('%PDF-1.4\n% alterado\n%%EOF\n'), 'application/pdf');
    try {
      const r = await bajar(g.id, docOp.versionId).expect(500);
      expect(JSON.parse(r.body.toString()).error.code).toBe('INTEGRITY_FAILED');
      expect(r.body.toString()).not.toContain('alterado');
    } finally { await store.put(clave, docOp.bytes, 'application/pdf'); }
    // 2) Archivo ausente del almacén: 503, no un fallo opaco.
    await store.delete(clave);
    try { expect(JSON.parse((await bajar(g.id, docOp.versionId).expect(503)).body.toString()).error.code).toBe('STORAGE_UNAVAILABLE'); }
    finally { await store.put(clave, docOp.bytes, 'application/pdf'); }
    await bajar(g.id, docOp.versionId).expect(200); // control: restaurado, se entrega
    // 3) Escaneo: el último resultado manda (INFECTED / FAILED): no disponible y la lista no ofrece descargarlo.
    for (const [resultado, disponibilidad] of [['INFECTED', 'REJECTED'], ['FAILED', 'SCAN_FAILED']] as const) {
      await sql`INSERT INTO document_version_scans (organization_id, version_id, result, engine, error_code) VALUES (${orgA}, ${docOp.versionId}, ${resultado}, 'prueba', ${resultado === 'FAILED' ? 'PRUEBA' : null})`.execute(h.db);
      const l = (await listar(g.id).expect(200)).body.documents[0];
      expect(l).toMatchObject({ availability: disponibilidad, downloadable: false });
      const r = await bajar(g.id, docOp.versionId).expect(409);
      expect(JSON.parse(r.body.toString()).error.code).toBe('VERSION_NOT_AVAILABLE');
    }
    await revocar(g.id).expect(201);
  });
});
