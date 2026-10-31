import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { ROLE_PERMISSIONS } from '../src/authz/catalog';

// Compartir las GEOMETRÍAS de una instantánea (concesión con `include_geometries`), contra PostgreSQL real. Datos SINTÉTICOS.
// Lo que se demuestra: explícito, apagado por defecto e independiente de los soportes; solo los polígonos que ESA instantánea fijó (versión y huella),
// aunque la parcela se corrija después; sin identidad del productor; vencimiento, revocación y destinatario comprobados; términos inmutables; auditado.
// Lo que NO se demuestra: que el comprador pueda presentar con esto una DDS (eso es un proceso fuera de Terra Link).
describeDb('concesión de una instantánea con geometrías: alcance exacto y límites', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA = ''; let orgB = '';
  let externoId = '';
  let parcela = ''; let lot = '';
  let snap: { id: string; snapshot_number: number };
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local'; const ADMIN_B = 'admin-b@test.local';
  const EXTERNO = 'comprador-geo@test.local'; const OTRO = 'otro-comprador-geo@test.local'; const TEC = 'tecnico-geo@test.local';
  const futuro = (dias = 7) => new Date(Date.now() + dias * 86400000).toISOString();
  const poligono = (d: number) => ({ type: 'Polygon', coordinates: [[[-80.16, -0.848], [-80.16 + d, -0.848], [-80.16 + d, -0.848 + d], [-80.16, -0.848 + d], [-80.16, -0.848]]] });

  async function join(o: string, email: string, role: string, admin: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
  }
  const conceder = (cuerpo: Record<string, unknown>, actor = ADMIN) =>
    http().post(`${base(orgA)}/access-grants`).set(as(actor)).send({ operation_id: randomUUID(), ...cuerpo });
  const revocar = (id: string) => http().post(`${base(orgA)}/access-grants/${id}/revoke`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Fin de la comprobación' });
  const geo = (g: string, actor = EXTERNO) => http().get(`/api/v1/granted/${g}/geometries`).set(as(actor));
  const conGeometrias = async (extra: Record<string, unknown> = {}) =>
    (await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap.id, include_geometries: true, expires_at: futuro(), reason: 'Polígonos de la instantánea', ...extra }).expect(201)).body.grant as { id: string };

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN'); await h.user(ADMIN); await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local')).send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Geometrías A', ADMIN); orgB = await mk('Coop Geometrías B', ADMIN_B);
    await join(orgA, TEC, 'FIELD_TECHNICIAN', ADMIN);
    await join(orgB, EXTERNO, 'BUYER', ADMIN_B); await join(orgB, OTRO, 'BUYER', ADMIN_B);
    externoId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${EXTERNO}`.execute(h.db)).rows[0].id;
    const baba = (await http().post(`${base(orgA)}/products`).set(as(ADMIN)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    const centro = (await http().post(`${base(orgA)}/locations`).set(as(ADMIN)).send({ code: 'C-G', name: 'Centro G', location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    const producer = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'GE-P', legal_name: 'Finca Identidad Reservada' }).expect(201)).body.id;
    parcela = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: producer, plot_code: 'GE-PAR', crop: 'Cacao' }).expect(201)).body.id;
    await http().post(`${base(orgA)}/plots/${parcela}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: poligono(0.001), area_declared_ha: 1 }).expect(201);
    const delivery = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: producer, product_id: baba, delivery_date: today, quantity_declared: '100', unit: 'KG', origins: [{ plot_id: parcela }], register: true }).expect(201)).body.delivery.id;
    const rec = (await http().post(`${base(orgA)}/deliveries/${delivery}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: centro, received_at: new Date().toISOString(), weighing: { method: 'Báscula sintética', quantity: '100', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    lot = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '100' }] }).expect(201)).body.lot.id;
    const caso = (await http().post(`${base(orgA)}/dd-cases`).set(as(ADMIN)).send({ operation_id: randomUUID(), lot_id: lot, scope_note: 'Expediente sintético con geometrías' }).expect(201)).body.case;
    snap = (await http().post(`${base(orgA)}/dd-cases/${caso.id}/snapshots`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot;
  });
  afterAll(async () => h?.close());

  it('catálogo: quien puede administrar concesiones también lee geometrías exactas (no se concede lo que no se tiene)', () => {
    for (const [rol, perms] of Object.entries(ROLE_PERMISSIONS)) if (perms.includes('grant:manage')) expect([rol, perms.includes('plot:read_geometry'), perms.includes('dd:read')]).toEqual([rol, true, true]);
  });

  it('por omisión NO se comparten geometrías: la ruta responde 403 claro y la vista descargable no trae coordenadas', async () => {
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap.id, can_download: true, expires_at: futuro(), reason: 'Solo la vista' }).expect(201)).body.grant;
    expect(g.include_geometries).toBe(false);
    expect((await http().get('/api/v1/granted').set(as(EXTERNO)).expect(200)).body.grants.find((x: { id: string }) => x.id === g.id).include_geometries).toBe(false);
    expect((await http().get(`/api/v1/granted/${g.id}`).set(as(EXTERNO)).expect(200)).body.geometries).toEqual({ shared: false });
    expect((await geo(g.id).expect(403)).body.error.code).toBe('GRANT_GEOMETRIES_NOT_INCLUDED');
    const d = await http().get(`/api/v1/granted/${g.id}/download`).set(as(EXTERNO)).expect(200);
    expect(JSON.stringify(d.body)).not.toContain('coordinates');
    await revocar(g.id).expect(201);
  });

  it('explícita y acotada: solo una instantánea, con lectura, y por quien puede administrar concesiones', async () => {
    const lote = { grantee_user_id: externoId, resource_type: 'LOT', resource_id: lot, include_geometries: true, expires_at: futuro(), reason: 'Prueba' };
    expect((await conceder(lote).expect(422)).body.error.code).toBe('GRANT_GEOMETRIES_ONLY_FOR_SNAPSHOT');
    const sinLeer = await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap.id, can_read: false, include_geometries: true, expires_at: futuro(), reason: 'Prueba' }).expect(422);
    expect(['GRANT_GEOMETRIES_REQUIRE_READ', 'VALIDATION_FAILED']).toContain(sinLeer.body.error.code);
    await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap.id, include_geometries: true, expires_at: futuro(), reason: 'Prueba' }, TEC).expect(403);
    await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap.id, include_geometries: 'si', expires_at: futuro(), reason: 'Prueba' }).expect(400);
  });

  it('recorrido: el polígono fijado con su versión y huella, sin identidad del productor, independiente de los soportes y auditado', async () => {
    const g = await conGeometrias();
    expect((await http().get('/api/v1/granted').set(as(EXTERNO)).expect(200)).body.grants.find((x: { id: string }) => x.id === g.id)).toMatchObject({ include_geometries: true, include_documents: false });
    expect((await http().get(`/api/v1/granted/${g.id}`).set(as(EXTERNO)).expect(200)).body.geometries).toEqual({ shared: true, count: 1 });
    const r = (await geo(g.id).expect(200)).body;
    expect(r.geojson.type).toBe('FeatureCollection');
    expect(r.geojson.features).toHaveLength(1);
    expect(r.geojson.features[0].geometry).toMatchObject({ type: 'Polygon' });
    expect(r.geojson.features[0].geometry.coordinates[0]).toHaveLength(5);
    expect(r.geojson.features[0].properties).toMatchObject({ plot_code: 'GE-PAR', version_number: 1 });
    expect(r.geojson.features[0].properties.geometry_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.without_geometry_count).toBe(0);
    expect(r.limits.join(' ')).toMatch(/no la geometría vigente de hoy/);
    // Sin identidad del productor ni identificadores internos de la parcela.
    const texto = JSON.stringify(r);
    for (const prohibido of ['Finca Identidad Reservada', 'GE-P"', parcela, orgA]) expect(texto).not.toContain(prohibido);
    // Independiente: esta concesión no incluye soportes.
    expect((await http().get(`/api/v1/granted/${g.id}/documents`).set(as(EXTERNO)).expect(403)).body.error.code).toBe('GRANT_DOCUMENTS_NOT_INCLUDED');
    const aud = await sql<{ action: string; after: { plots?: number } }>`SELECT action, after FROM audit_logs WHERE organization_id = ${orgA} AND entity_id = ${g.id} AND action = 'grant.geometries_read'`.execute(h.db);
    expect(aud.rows).toHaveLength(1);
    expect(aud.rows[0].after).toMatchObject({ plots: 1 });
    await revocar(g.id).expect(201);
  });

  it('una corrección posterior de la parcela NO cambia lo compartido (versión y huella de la instantánea)', async () => {
    const g = await conGeometrias();
    const antes = (await geo(g.id).expect(200)).body.geojson.features[0];
    const v = (await http().get(`${base(orgA)}/plots/${parcela}`).set(as(ADMIN)).expect(200)).body;
    await http().post(`${base(orgA)}/plots/${parcela}/geometry-versions`).set(as(ADMIN))
      .send({ expected_version: v.plot?.row_version ?? v.row_version ?? 2, survey_method: 'MANUAL_COORDINATES', geometry: poligono(0.002), area_declared_ha: 4, reason: 'Corrección posterior de la propietaria' }).expect(201);
    const despues = (await geo(g.id).expect(200)).body.geojson.features[0];
    expect(despues).toEqual(antes);
    expect(despues.properties.version_number).toBe(1);
    await revocar(g.id).expect(201);
  });

  it('el acceso se revalida: revocada, otra cuenta y vencida responden igual (404); los términos no se editan', async () => {
    const g = await conGeometrias();
    await geo(g.id).expect(200);
    // Otra cuenta (control autorizado arriba): indistinguible de una concesión inexistente.
    await geo(g.id, OTRO).expect(404);
    await geo(randomUUID()).expect(404);
    // Los términos son inmutables: ni siquiera con acceso directo a la base se apaga la bandera.
    await expect(sql`UPDATE access_grants SET include_geometries = false WHERE id = ${g.id}`.execute(h.db)).rejects.toThrow(/no se editan/);
    await revocar(g.id).expect(201);
    await geo(g.id).expect(404);
    // Vencida: el ancla de tiempo se adelanta en la fila (estado, no términos).
    const g2 = await conGeometrias();
    await sql`ALTER TABLE access_grants DISABLE TRIGGER USER`.execute(h.db);
    try { await sql`UPDATE access_grants SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE id = ${g2.id}`.execute(h.db); }
    finally { await sql`ALTER TABLE access_grants ENABLE TRIGGER USER`.execute(h.db); }
    await geo(g2.id).expect(404);
    // Una vencida sin revocar sigue ocupando la concesión activa de esa cuenta: se cierra para las pruebas siguientes.
    await sql`UPDATE access_grants SET revoked_at = now(), revoked_by = granted_by, revoke_reason = 'cierre de la prueba' WHERE id = ${g2.id}`.execute(h.db);
  });

  it('conserva el TIPO original de cada geometría (punto, polígono y multipolígono): no convierte puntos en polígonos', async () => {
    const productor = (await http().post(`${base(orgA)}/producers`).set(as(ADMIN)).send({ producer_code: 'GE-P2', legal_name: 'Finca Tipos' }).expect(201)).body.id;
    const productoId = (await sql<{ id: string }>`SELECT id FROM products WHERE organization_id = ${orgA} LIMIT 1`.execute(h.db)).rows[0].id;
    const centroId = (await sql<{ id: string }>`SELECT id FROM locations WHERE organization_id = ${orgA} LIMIT 1`.execute(h.db)).rows[0].id;
    const multi = { type: 'MultiPolygon', coordinates: [poligono(0.001).coordinates, [[[-80.3, -0.9], [-80.299, -0.9], [-80.299, -0.899], [-80.3, -0.899], [-80.3, -0.9]]]] };
    const casos: Array<[string, Record<string, unknown>]> = [['GE-PT', { type: 'Point', coordinates: [-80.2, -0.85] }], ['GE-MP', multi]];
    const plots: string[] = [];
    for (const [codigo, g] of casos) {
      const p = (await http().post(`${base(orgA)}/plots`).set(as(ADMIN)).send({ producer_id: productor, plot_code: codigo, crop: 'Cacao' }).expect(201)).body.id;
      await http().post(`${base(orgA)}/plots/${p}/geometry-versions`).set(as(ADMIN)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: g, area_declared_ha: 1 }).expect(201);
      plots.push(p);
    }
    const entrega = (await http().post(`${base(orgA)}/deliveries`).set(as(ADMIN)).send({ operation_id: randomUUID(), producer_id: productor, product_id: productoId, delivery_date: today, quantity_declared: '50', unit: 'KG', origins: plots.map((p) => ({ plot_id: p })), register: true }).expect(201)).body.delivery.id;
    const rec = (await http().post(`${base(orgA)}/deliveries/${entrega}/receptions`).set(as(ADMIN)).send({ operation_id: randomUUID(), location_id: centroId, received_at: new Date().toISOString(), weighing: { method: 'Báscula sintética', quantity: '50', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    const lote = (await http().post(`${base(orgA)}/lots`).set(as(ADMIN)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '50' }] }).expect(201)).body.lot.id;
    const caso2 = (await http().post(`${base(orgA)}/dd-cases`).set(as(ADMIN)).send({ operation_id: randomUUID(), lot_id: lote, scope_note: 'Tipos de geometría' }).expect(201)).body.case;
    const snap2 = (await http().post(`${base(orgA)}/dd-cases/${caso2.id}/snapshots`).set(as(ADMIN)).send({ operation_id: randomUUID() }).expect(201)).body.snapshot;
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap2.id, include_geometries: true, expires_at: futuro(), reason: 'Tipos de geometría' }).expect(201)).body.grant;
    const r = (await geo(g.id).expect(200)).body;
    const porCodigo = Object.fromEntries(r.geojson.features.map((f: { properties: { plot_code: string } }) => [f.properties.plot_code, f]));
    expect(porCodigo['GE-PT'].geometry).toEqual({ type: 'Point', coordinates: [-80.2, -0.85] });
    expect(porCodigo['GE-PT'].properties.geometry_type).toBe('POINT');
    expect(porCodigo['GE-MP'].geometry.type).toBe('MultiPolygon');
    expect(porCodigo['GE-MP'].geometry.coordinates).toHaveLength(2);
    expect((await http().get(`/api/v1/granted/${g.id}`).set(as(EXTERNO)).expect(200)).body.geometries).toEqual({ shared: true, count: 2 });
    await revocar(g.id).expect(201);
  });

  it('soportes y geometrías se conceden por separado y juntos sin confundirse', async () => {
    const solo = (await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap.id, include_documents: true, expires_at: futuro(), reason: 'Solo soportes' }).expect(201)).body.grant;
    expect((await geo(solo.id).expect(403)).body.error.code).toBe('GRANT_GEOMETRIES_NOT_INCLUDED');
    await revocar(solo.id).expect(201);
    const ambas = await conGeometrias({ include_documents: true });
    await geo(ambas.id).expect(200);
    await http().get(`/api/v1/granted/${ambas.id}/documents`).set(as(EXTERNO)).expect(200);
    await revocar(ambas.id).expect(201);
  });
});
