import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// P0-003 / D-P0003.1 opción A — Concesiones externas, contra PostgreSQL real. Datos SINTÉTICOS.
// Contrato: `docs/decisiones/P0-003-CONCESIONES-Y-ELEVACION.md`.
//
// El acceso se demuestra con una CONCESIÓN REAL a una cuenta que **no es miembro** de la organización dueña.
// Una segunda membresía no es una concesión, y aquí se comprueba la diferencia: la misma cuenta externa, sin
// concesión, no ve nada; con concesión ve la proyección permitida; y la vía del concesionario no consulta
// membresías en ningún momento.
describeDb('P0-003 concesiones externas: alcance, vencimiento, revocación, clasificación y aislamiento', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA = '';
  let orgB = '';
  let lote = '';
  let loteB = '';
  let externoId = '';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const today = new Date().toISOString().slice(0, 10);
  const ADMIN = 'admin-a@test.local';
  const ADMIN_B = 'admin-b@test.local';
  const EXTERNO = 'comprador-externo@test.local';   // NO es miembro de orgA
  const TEC = 'tecnico@test.local';
  const futuro = (dias = 7) => new Date(Date.now() + dias * 86400000).toISOString();

  async function join(o: string, email: string, role: string, admin = ADMIN) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
  }

  /** Producto y centro, una sola vez por organización: sus códigos son únicos por organización. */
  const comun: Record<string, { baba: string; centro: string }> = {};
  async function prepararOrg(org: string, admin: string, codigo: string) {
    const baba = (await http().post(`${base(org)}/products`).set(as(admin)).send({ code: 'CACAO_BABA', name: 'Cacao en baba', product_state: 'CACAO_BABA', unit: 'KG' }).expect(201)).body.id;
    const centro = (await http().post(`${base(org)}/locations`).set(as(admin)).send({ code: `C-${codigo}`, name: `Centro ${codigo}`, location_type: 'COLLECTION_CENTER' }).expect(201)).body.id;
    comun[org] = { baba, centro };
  }

  /** Lote con origen declarado (productor y parcela con geometría), en la organización indicada. */
  async function crearLote(org: string, admin: string, codigo: string, harvest_period?: { precision: string; start?: string; end?: string }) {
    const { baba, centro } = comun[org];
    const prod = (await http().post(`${base(org)}/producers`).set(as(admin)).send({ producer_code: `${codigo}-P`, legal_name: `Finca ${codigo}` }).expect(201)).body.id;
    const parcela = (await http().post(`${base(org)}/plots`).set(as(admin)).send({ producer_id: prod, plot_code: `${codigo}-PAR`, crop: 'Cacao' }).expect(201)).body.id;
    await http().post(`${base(org)}/plots/${parcela}/geometry-versions`).set(as(admin)).send({ expected_version: 1, survey_method: 'MANUAL_COORDINATES', geometry: { type: 'Point', coordinates: [-80.16, -0.848] }, area_declared_ha: 2 }).expect(201);
    const d = (await http().post(`${base(org)}/deliveries`).set(as(admin)).send({ operation_id: randomUUID(), producer_id: prod, product_id: baba, delivery_date: today, quantity_declared: '100', unit: 'KG', origins: [{ plot_id: parcela }], ...(harvest_period ? { harvest_period } : {}), register: true }).expect(201)).body.delivery;
    const rec = (await http().post(`${base(org)}/deliveries/${d.id}/receptions`).set(as(admin)).send({ operation_id: randomUUID(), location_id: centro, received_at: new Date().toISOString(), weighing: { method: 'Báscula sintética', quantity: '100', unit: 'KG', weighed_on: today } }).expect(201)).body.reception_id;
    return (await http().post(`${base(org)}/lots`).set(as(admin)).send({ operation_id: randomUUID(), inputs: [{ reception_id: rec, quantity: '100' }] }).expect(201)).body.lot.id as string;
  }

  const conceder = (cuerpo: Record<string, unknown>, actor = ADMIN, org = orgA) =>
    http().post(`${base(org)}/access-grants`).set(as(actor)).send({ operation_id: randomUUID(), ...cuerpo });
  const leerConcedido = (grantId: string, actor = EXTERNO) => http().get(`/api/v1/granted/${grantId}`).set(as(actor));
  const mias = (actor = EXTERNO) => http().get('/api/v1/granted').set(as(actor));

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user('super@test.local', 'SUPER_ADMIN');
    await h.user(ADMIN);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as('super@test.local'))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Concesiones A', ADMIN);
    orgB = await mk('Coop Concesiones B', ADMIN_B);
    await join(orgA, TEC, 'FIELD_TECHNICIAN');
    // La cuenta externa es miembro de orgB, NO de orgA: su acceso a orgA solo puede venir de una concesión.
    await join(orgB, EXTERNO, 'BUYER', ADMIN_B);
    externoId = (await sql<{ id: string }>`SELECT id FROM users WHERE email = ${EXTERNO}`.execute(h.db)).rows[0].id;
    await prepararOrg(orgA, ADMIN, 'A');
    await prepararOrg(orgB, ADMIN_B, 'B');
    lote = await crearLote(orgA, ADMIN, 'CA');
    loteB = await crearLote(orgB, ADMIN_B, 'CB');
  });
  afterAll(async () => h?.close());

  it('sin concesión, una cuenta externa no ve nada de la otra organización', async () => {
    expect((await mias().expect(200)).body.grants).toEqual([]);
    await http().get(`${base(orgA)}/lots/${lote}`).set(as(EXTERNO)).expect(404); // ni por la vía normal
    await leerConcedido(randomUUID()).expect(404); // ni inventando un identificador
  });

  it('solo ORG_ADMIN concede, y nadie concede lo que no tiene', async () => {
    // El técnico no tiene grant:manage.
    await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: lote, expires_at: futuro(), reason: 'Prueba' }, TEC).expect(403);
    // Un ORG_ADMIN de OTRA organización tampoco puede conceder sobre recursos de la primera.
    await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: lote, expires_at: futuro(), reason: 'Prueba' }, ADMIN_B, orgB).expect(422);
    // Conceder un recurso de otra organización desde la propia: la base lo impide.
    await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: loteB, expires_at: futuro(), reason: 'Ajeno' }).expect(422);
  });

  it('el vencimiento es obligatorio y futuro', async () => {
    await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: lote, reason: 'Sin vencimiento' }).expect(400);
    const pasado = await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: lote, expires_at: new Date(Date.now() - 1000).toISOString(), reason: 'Vencida ya' }).expect(422);
    expect(pasado.body.error.code).toBe('GRANT_EXPIRY_INVALID');
    // Conceder descarga sobre OTRO lote, para no ocupar la única concesión activa del lote compartido.
    const otro = await crearLote(orgA, ADMIN, 'CL');
    await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: otro, can_download: true, expires_at: futuro(), reason: 'Descarga' }).expect(201);
  });

  it('con una concesión real, la cuenta externa ve la proyección permitida y nada más', async () => {
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: lote, expires_at: futuro(), reason: 'Revisión del comprador' }).expect(201)).body.grant;
    expect(g).toMatchObject({ resource_type: 'LOT', resource_id: lote, can_read: true, can_download: false });

    const v = (await leerConcedido(g.id).expect(200)).body;
    expect(v).toMatchObject({ resource_type: 'LOT', status: expect.any(String), origin_status: expect.any(String) });
    // Agregados, no identidades: la concesión NO levanta la clasificación.
    expect(v.productores).toBeGreaterThan(0);
    expect(v.parcelas).toBeGreaterThan(0);
    const texto = JSON.stringify(v);
    expect(texto).not.toMatch(/Finca CA|CA-P\b/);         // ni razón social ni código de productor
    expect(texto).not.toMatch(/coordinates|geometry/i);    // ni geometrías
    expect(texto).not.toMatch(/document|archivo/i);         // ni documentos
    // Y la referencia pública viaja con la lectura autorizada por concesión.
    expect(v.public_reference).toMatch(/^[0-9a-f]{24}$/);

    // La concesión NO crea membresía ni da acceso general: la vía normal sigue cerrada.
    await http().get(`${base(orgA)}/lots/${lote}`).set(as(EXTERNO)).expect(404);
    await http().get(`${base(orgA)}/producers`).set(as(EXTERNO)).expect(404);
    // Contiene ESTA concesión; no se fija un total, que depende de otras pruebas del mismo archivo.
    expect((await mias().expect(200)).body.grants.map((x: { id: string }) => x.id)).toContain(g.id);
  });

  it('no concede acciones distintas de las concedidas, ni otros recursos', async () => {
    const otroLote = await crearLote(orgA, ADMIN, 'CC');
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: otroLote, expires_at: futuro(), reason: 'Solo este lote' }).expect(201)).body.grant;
    // La concesión es por INSTANCIA: con la de un lote no se lee otro.
    const gOtro = (await sql<{ id: string }>`SELECT id FROM access_grants WHERE resource_id = ${lote} AND revoked_at IS NULL`.execute(h.db)).rows[0];
    expect(gOtro.id).not.toBe(g.id);
    await leerConcedido(g.id).expect(200);
    // Otra cuenta no usa la concesión ajena, aunque sepa su identificador.
    await leerConcedido(g.id, ADMIN_B).expect(404);
  });

  it('la descarga entrega la MISMA proyección, identificada como vista compartida interna', async () => {
    const lote8 = await crearLote(orgA, ADMIN, 'CJ');
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: lote8, can_read: true, can_download: true, expires_at: futuro(), reason: 'Compartir' }).expect(201)).body.grant;
    const leido = (await leerConcedido(g.id).expect(200)).body;
    const bajado = await http().get(`/api/v1/granted/${g.id}/download`).set(as(EXTERNO)).expect(200);

    expect(bajado.headers['content-disposition']).toMatch(/attachment; filename="vista-compartida-lot-/);
    const archivo = JSON.parse(Buffer.isBuffer(bajado.body) ? bajado.body.toString('utf8') : JSON.stringify(bajado.body));
    // Se identifica como lo que es, y dice lo que NO es.
    expect(archivo.tipo_de_archivo).toBe('VISTA_COMPARTIDA_INTERNA');
    expect(archivo.aviso).toMatch(/NO es un DD_PACKAGE/);
    expect(archivo.aviso).toMatch(/NO acredita conformidad EUDR/);
    expect(archivo.limitaciones.length).toBeGreaterThan(0);
    expect(archivo.generado_en).toEqual(expect.any(String));
    // Y es EXACTAMENTE la proyección que ya podía leer: ni un campo más.
    expect(archivo.recurso).toEqual(leido);
    const texto = JSON.stringify(archivo);
    expect(texto).not.toMatch(/coordinates|geometry/i);
    expect(texto).not.toMatch(/Finca C|CJ-P/);

    // Sin la acción concedida no hay descarga, aunque se pueda leer.
    const soloLectura = await crearLote(orgA, ADMIN, 'CK');
    const g2 = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: soloLectura, expires_at: futuro(), reason: 'Solo lectura' }).expect(201)).body.grant;
    await leerConcedido(g2.id).expect(200);
    await http().get(`/api/v1/granted/${g2.id}/download`).set(as(EXTERNO)).expect(404);

    // Revocada, tampoco se descarga.
    await http().post(`${base(orgA)}/access-grants/${g.id}/revoke`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Fin' }).expect(201);
    await http().get(`/api/v1/granted/${g.id}/download`).set(as(EXTERNO)).expect(404);
  });

  it('la revocación tiene efecto inmediato y no se reactiva', async () => {
    const lote2 = await crearLote(orgA, ADMIN, 'CD');
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: lote2, expires_at: futuro(), reason: 'Temporal' }).expect(201)).body.grant;
    await leerConcedido(g.id).expect(200);

    await http().post(`${base(orgA)}/access-grants/${g.id}/revoke`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Fin de la revisión' }).expect(201);
    await leerConcedido(g.id).expect(404);               // inmediato
    expect((await mias().expect(200)).body.grants.map((x: { id: string }) => x.id)).not.toContain(g.id);
    // Revocada no vuelve, ni por la base.
    await expect(sql`UPDATE access_grants SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE id = ${g.id}`.execute(h.db)).rejects.toThrow(/no se reactiva/);
    // Y los términos nunca se editan.
    await expect(sql`UPDATE access_grants SET can_download = TRUE WHERE id = ${g.id}`.execute(h.db)).rejects.toThrow(/no se editan/);
  });

  it('una concesión vencida deja de servir, sin tocar la fila', async () => {
    const lote3 = await crearLote(orgA, ADMIN, 'CE');
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: lote3, expires_at: futuro(1), reason: 'Corta' }).expect(201)).body.grant;
    await leerConcedido(g.id).expect(200);
    // Se adelanta el reloj moviendo la creación: el vencimiento es inmutable, así que se recrea vencida aparte.
    await sql`UPDATE access_grants SET revoked_at = now(), revoked_by = granted_by, revoke_reason = 'cierre de prueba' WHERE id = ${g.id}`.execute(h.db);
    const vencida = randomUUID();
    await sql`INSERT INTO access_grants (id, organization_id, grantee_user_id, resource_type, resource_id, can_read, can_download, expires_at, reason, granted_by, operation_id, created_at)
      VALUES (${vencida}, ${orgA}, ${externoId}, 'LOT', ${lote3}, TRUE, FALSE, now() - interval '1 hour', 'Vencida sintética',
              (SELECT id FROM users WHERE email = ${ADMIN}), ${randomUUID()}, now() - interval '2 hours')`.execute(h.db);
    await leerConcedido(vencida).expect(404);
    expect((await mias().expect(200)).body.grants.map((x: { id: string }) => x.id)).not.toContain(vencida);
  });

  it('una cuenta desactivada no usa sus concesiones', async () => {
    const lote4 = await crearLote(orgA, ADMIN, 'CF');
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: lote4, expires_at: futuro(), reason: 'Antes de desactivar' }).expect(201)).body.grant;
    await leerConcedido(g.id).expect(200);
    await sql`UPDATE users SET status = 'INACTIVE' WHERE id = ${externoId}`.execute(h.db);
    // La autenticación rechaza antes una cuenta desactivada (401); si llegara al resolver, sería 404 opaco.
    // Cualquiera de las dos cierra el acceso: lo que no puede es responder 200.
    expect([401, 404]).toContain((await leerConcedido(g.id)).status);
    await sql`UPDATE users SET status = 'ACTIVE' WHERE id = ${externoId}`.execute(h.db);
    await leerConcedido(g.id).expect(200);
  });

  it('concurrencia: dos concesiones simultáneas del mismo recurso dejan una sola activa', async () => {
    const lote5 = await crearLote(orgA, ADMIN, 'CG');
    const cuerpo = { grantee_user_id: externoId, resource_type: 'LOT' as const, resource_id: lote5, expires_at: futuro(), reason: 'Concurrente' };
    const [a, b] = await Promise.all([conceder(cuerpo), conceder(cuerpo)]);
    const oks = [a, b].filter((r) => r.status === 201);
    expect(oks).toHaveLength(1);
    expect([a, b].filter((r) => r.status === 409)).toHaveLength(1);
    const activas = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM access_grants WHERE resource_id = ${lote5} AND revoked_at IS NULL`.execute(h.db)).rows[0].n;
    expect(activas).toBe('1');
  });

  it('rollback: si la auditoría falla, no queda concesión', async () => {
    const lote6 = await crearLote(orgA, ADMIN, 'CH');
    const antes = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM access_grants`.execute(h.db)).rows[0].n;
    const { AuditService } = await import('../src/audit/audit.service');
    const spy = jest.spyOn(AuditService.prototype, 'record').mockRejectedValueOnce(new Error('fallo simulado'));
    await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: lote6, expires_at: futuro(), reason: 'Rollback' }).expect(500);
    spy.mockRestore();
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM access_grants`.execute(h.db)).rows[0].n).toBe(antes);
  });

  it('se audita conceder, usar y revocar, sin secretos', async () => {
    const lote7 = await crearLote(orgA, ADMIN, 'CI');
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: lote7, expires_at: futuro(), reason: 'Auditoría' }).expect(201)).body.grant;
    await leerConcedido(g.id).expect(200);
    await http().post(`${base(orgA)}/access-grants/${g.id}/revoke`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Cierre' }).expect(201);
    const filas = (await sql<{ action: string }>`SELECT action FROM audit_logs WHERE entity_id = ${g.id} ORDER BY occurred_at`.execute(h.db)).rows.map((r) => r.action);
    expect(filas).toEqual(expect.arrayContaining(['grant.create', 'grant.read', 'grant.revoke']));
    const texto = JSON.stringify((await sql<{ after: unknown }>`SELECT after FROM audit_logs WHERE entity_id = ${g.id}`.execute(h.db)).rows);
    for (const prohibido of [PASSWORD, 'password', 'access_token']) expect(texto).not.toContain(prohibido);
  });

  // ---------------------------------------------------------------- P1-001/P1-002: audiencia externa

  /** Referencia pública del recurso: el dato que viaja en el enlace y en el QR. */
  const refDe = async (tipo: string, id: string) =>
    (await sql<{ reference: string }>`SELECT reference FROM public_references WHERE entity_type = ${tipo} AND entity_id = ${id}`.execute(h.db)).rows[0]?.reference;
  const resolver = (ref: string, actor: string) => http().get(`/api/v1/public-references/${ref}`).set(as(actor));
  const qrDe = (ref: string, actor: string) => http().get(`/api/v1/public-references/${ref}/qr.svg`).set(as(actor));
  const revocar = (id: string) => http().post(`${base(orgA)}/access-grants/${id}/revoke`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Fin de la prueba' });
  /** Cada caso usa su PROPIO lote: una concesión activa es única por recurso y destinatario. */
  let n = 0;
  const loteNuevo = () => crearLote(orgA, ADMIN, `AX${++n}`);

  it('AUDIENCIA EXTERNA: con concesión vigente, el enlace resuelve SIN membresía', async () => {
    const l = await loteNuevo();
    const ref = (await refDe('LOT', l))!;
    // Sin concesión no resuelve: el rol BUYER por sí solo no concede nada.
    await resolver(ref, EXTERNO).expect(404);

    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: l, expires_at: futuro(), reason: 'Audiencia externa' }).expect(201)).body.grant;
    const r = await resolver(ref, EXTERNO).expect(200);
    expect(r.body).toMatchObject({ entity_type: 'LOT', id: l, audience: 'GRANTEE', grant_id: g.id });
    // CONTROL: el miembro resuelve como MEMBER, no como concesionario.
    expect((await resolver(ref, ADMIN).expect(200)).body).toMatchObject({ audience: 'MEMBER' });
    // Y el QR también se le entrega, porque puede abrir el recurso.
    await qrDe(ref, EXTERNO).expect(200);
    await revocar(g.id).expect(201);
  });

  it('AUDIENCIA EXTERNA: la concesión REVOCADA corta la resolución y el QR', async () => {
    const l = await loteNuevo();
    const ref = (await refDe('LOT', l))!;
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: l, expires_at: futuro(), reason: 'Se revocará' }).expect(201)).body.grant;
    await resolver(ref, EXTERNO).expect(200);   // CONTROL: antes de revocar sí
    await revocar(g.id).expect(201);
    await resolver(ref, EXTERNO).expect(404);
    await qrDe(ref, EXTERNO).expect(404);
  });

  it('AUDIENCIA EXTERNA: la concesión VENCIDA deja de resolver', async () => {
    const l = await loteNuevo();
    const ref = (await refDe('LOT', l))!;
    // Vence de VERDAD, con el reloj del servidor: los términos de una concesión no se editan, así que
    // adelantar la fecha en la base no es una opción —y el disparador lo impide, que es lo correcto—.
    await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: l, expires_at: new Date(Date.now() + 2500).toISOString(), reason: 'Vence en segundos' }).expect(201);
    await resolver(ref, EXTERNO).expect(200);   // CONTROL: mientras está viva, resuelve
    await new Promise((r) => setTimeout(r, 3000));
    await resolver(ref, EXTERNO).expect(404);   // vencida: deja de resolver sola
  });

  it('AUDIENCIA EXTERNA: la concesión es de UN recurso, no una llave de la organización', async () => {
    const concedido = await loteNuevo();
    const otro = await loteNuevo();
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: concedido, expires_at: futuro(), reason: 'Solo este lote' }).expect(201)).body.grant;
    await resolver((await refDe('LOT', concedido))!, EXTERNO).expect(200);   // CONTROL
    // Cualquier otro recurso de la MISMA organización, no.
    await resolver((await refDe('LOT', otro))!, EXTERNO).expect(404);
    const prod = (await sql<{ id: string }>`SELECT id FROM producers WHERE organization_id = ${orgA} LIMIT 1`.execute(h.db)).rows[0].id;
    await resolver((await refDe('PRODUCER', prod))!, EXTERNO).expect(404);
    await revocar(g.id).expect(201);
  });

  it('AUDIENCIA EXTERNA: sin lectura concedida no resuelve, aunque la concesión exista', async () => {
    const l = await loteNuevo();
    const ref = (await refDe('LOT', l))!;
    await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: l, can_read: false, can_download: true, expires_at: futuro(), reason: 'Solo descarga' }).expect(201);
    await resolver(ref, EXTERNO).expect(404);
  });

  // ---------------------------------------------------------------- RF-32: lote Y EMBARQUE (y la instantánea)

  it('RF-32 la concesión de un EMBARQUE entrega su proyección, sin identidad', async () => {
    const comprador = (await http().post(`${base(orgA)}/buyers`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), code: `IMP-${randomUUID().slice(0, 6).toUpperCase()}`, name: 'Importador Sintético', country: 'NL' }).expect(201)).body.buyer.id;
    const emb = (await http().post(`${base(orgA)}/shipments`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), buyer_id: comprador, destination_country: 'DE', origin_location_id: comun[orgA].centro }).expect(201)).body.shipment;

    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'SHIPMENT', resource_id: emb.id, expires_at: futuro(), reason: 'Embarque compartido' }).expect(201)).body.grant;
    const v = (await leerConcedido(g.id).expect(200)).body;
    expect(v).toMatchObject({ resource_type: 'SHIPMENT', shipment_code: emb.shipment_code, destination_country: 'DE' });
    expect(typeof v.items).toBe('number');
    // Ni el comprador declarado, ni identidades, ni el identificador interno del embarque.
    const texto = JSON.stringify(v);
    for (const prohibido of ['Importador Sintético', 'buyer_id', 'legal_name', emb.id]) expect(texto).not.toContain(prohibido);
    // Y el destino se declara como declarado, no como verificado.
    expect(v.nota).toMatch(/no lo verifica/i);

    // La referencia del embarque también resuelve para el destinatario, como audiencia externa.
    const ref = (await refDe('SHIPMENT', emb.id))!;
    expect((await resolver(ref, EXTERNO).expect(200)).body).toMatchObject({ entity_type: 'SHIPMENT', audience: 'GRANTEE' });
    await revocar(g.id).expect(201);
    // Revocada, deja de resolver y de leerse.
    await resolver(ref, EXTERNO).expect(404);
    await leerConcedido(g.id).expect(404);
  });

  it('RF-32 la concesión de una INSTANTÁNEA entrega requisitos y huella, sin contenido del expediente', async () => {
    const l = await crearLote(orgA, ADMIN, 'CS');
    const caso = (await http().post(`${base(orgA)}/dd-cases`).set(as(ADMIN))
      .send({ operation_id: randomUUID(), lot_id: l, scope_note: 'Expediente sintético para concesión' }).expect(201)).body.case;
    const snap = (await http().post(`${base(orgA)}/dd-cases/${caso.id}/snapshots`).set(as(ADMIN))
      .send({ operation_id: randomUUID() }).expect(201)).body.snapshot;

    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'DD_SNAPSHOT', resource_id: snap.id, expires_at: futuro(), reason: 'Instantánea compartida' }).expect(201)).body.grant;
    const v = (await leerConcedido(g.id).expect(200)).body;
    expect(v).toMatchObject({ resource_type: 'DD_SNAPSHOT', case_number: caso.case_number, snapshot_number: snap.snapshot_number });
    expect(v.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Array.isArray(v.requirements)).toBe(true);
    // Requisitos como CÓDIGO y ESTADO: ni el contenido de la instantánea, ni geometrías, ni documentos.
    for (const r of v.requirements) expect(Object.keys(r).sort()).toEqual(['code', 'status']);
    const texto = JSON.stringify(v);
    for (const prohibido of ['geometry', 'coordinates', 'legal_name', 'document_number', 'plots']) expect(texto).not.toContain(prohibido);
    // Y declara que la preparación interna no acredita presentación ni conformidad.
    expect(v.nota).toMatch(/NO acredita presentación de DDS/i);
    await revocar(g.id).expect(201);
  });

  // ---------------------------------------------------------------- RF-32 / D-48(A): los once indicadores

  const INDICADORES = ['ORIGEN_IDENTIFICADO', 'GEOLOCALIZACION_VALIDADA', 'DEFORESTACION_REVISADA', 'LEGALIDAD_REVISADA',
    'TRAZABILIDAD_COMPLETA', 'BALANCE_DE_MASA', 'EVIDENCIAS', 'RIESGO_FINAL', 'DDS'];
  const ESTADOS = ['FAVORABLE', 'DESFAVORABLE', 'PENDIENTE', 'DESACTUALIZADO', 'NO_EVALUABLE', 'SIN_EVALUAR'];

  it('D-48(A) la vista del lote trae los once indicadores de S3 §22.8', async () => {
    const l = await loteNuevo();
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: l, expires_at: futuro(), reason: 'Indicadores' }).expect(201)).body.grant;
    const v = (await leerConcedido(g.id).expect(200)).body;

    // Dos son recuentos; nueve son estados. Once en total, como la pantalla de la fuente.
    expect(typeof v.productores).toBe('number');
    expect(typeof v.parcelas).toBe('number');
    expect(v.indicators.map((i: { code: string }) => i.code)).toEqual(INDICADORES);
    for (const i of v.indicators) {
      expect(ESTADOS).toContain(i.state);
      expect(i.note.length).toBeGreaterThan(20);   // cada estado explica qué significa
    }
    await revocar(g.id).expect(201);
  });

  it('D-48(A) NO convierte lo desconocido en conforme', async () => {
    const l = await loteNuevo();
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: l, expires_at: futuro(), reason: 'Desconocido' }).expect(201)).body.grant;
    const v = (await leerConcedido(g.id).expect(200)).body;
    const por = (c: string) => v.indicators.find((i: { code: string }) => i.code === c);

    // Sin satélite contratado, sin perfil jurídico aprobado y con la conclusión clavada en UNDETERMINED,
    // estos NO pueden salir favorables. Si alguna vez salen, es que se rebajó el criterio.
    expect(por('DEFORESTACION_REVISADA').state).not.toBe('FAVORABLE');
    expect(por('LEGALIDAD_REVISADA').state).not.toBe('FAVORABLE');
    expect(por('RIESGO_FINAL').state).not.toBe('FAVORABLE');
    // Y la DDS no es un pendiente del lote: es un límite del producto.
    expect(por('DDS').state).toBe('NO_EVALUABLE');
    expect(por('DDS').note).toMatch(/NO presenta declaraciones/i);
    await revocar(g.id).expect(201);
  });

  it('D-48(A) conserva las tres distinciones que no se pueden perder', async () => {
    const l = await loteNuevo();
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: l, expires_at: futuro(), reason: 'Distinciones' }).expect(201)).body.grant;
    const v = (await leerConcedido(g.id).expect(200)).body;
    const por = (c: string) => v.indicators.find((i: { code: string }) => i.code === c);

    expect(por('GEOLOCALIZACION_VALIDADA').note).toMatch(/TÉCNICA|técnica/);
    expect(por('GEOLOCALIZACION_VALIDADA').label).toMatch(/técnica/i);
    expect(por('DEFORESTACION_REVISADA').note).toMatch(/no es una conclusión regulatoria/i);
    expect(por('RIESGO_FINAL').note).toMatch(/NO es la conclusión regulatoria|no se presume/i);
    expect(por('DDS').note).toMatch(/no es una DDS presentada|NO presenta/i);
    // Evidencias: disponibilidad y revisión, nunca suficiencia.
    expect(por('EVIDENCIAS').note).toMatch(/no la vuelve suficiente/i);
    expect(por('EVIDENCIAS').note).toMatch(/No da acceso a los originales/i);
    await revocar(g.id).expect(201);
  });

  it('D-48(A) los indicadores NO filtran identidad, coordenadas ni identificadores', async () => {
    const l = await loteNuevo();
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: l, can_download: true, expires_at: futuro(), reason: 'Sin fugas' }).expect(201)).body.grant;
    const v = (await leerConcedido(g.id).expect(200)).body;
    const texto = JSON.stringify(v);

    for (const prohibido of ['geometry', 'coordinates', 'legal_name', 'first_name', 'document_number', 'producer_code', 'object_key', 'sha256']) {
      expect(texto).not.toContain(prohibido);
    }
    // Ni identificadores internos del lote, ni de sus parcelas o entregas.
    expect(texto).not.toContain(l);
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

    // Y la DESCARGA usa la MISMA proyección: ocultar en pantalla no bastaría.
    const d = await http().get(`/api/v1/granted/${g.id}/download`).set(as(EXTERNO)).expect(200);
    const paquete = JSON.parse(d.text);
    expect(paquete.recurso.indicators.map((i: { code: string }) => i.code)).toEqual(INDICADORES);
    for (const prohibido of ['geometry', 'coordinates', 'legal_name', 'document_number']) {
      expect(d.text).not.toContain(prohibido);
    }
    await revocar(g.id).expect(201);
  });

  // El contrato adoptado PROHÍBE deducir el período de producción de la fecha de entrega. Los tres casos se
  // comprueban extremo a extremo, sobre la proyección real que lee el comprador.
  const periodoDe = async (l: string, motivo: string) => {
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: l, expires_at: futuro(), reason: motivo }).expect(201)).body.grant;
    const v = (await leerConcedido(g.id).expect(200)).body;
    await revocar(g.id).expect(201);
    return v.production_period as { precision: string; start: string | null; end: string | null; note: string; inherited_range: unknown };
  };

  it('PERÍODO 1/3 — cosecha declarada: conserva fechas y precisión originales', async () => {
    const l = await crearLote(orgA, ADMIN, `PM${++n}`, { precision: 'MONTH', start: '2026-03', end: '2026-03' });
    const p = await periodoDe(l, 'Período declarado');
    expect(p).toMatchObject({ precision: 'MONTH', start: '2026-03', end: '2026-03', inherited_range: null });
    // Los límites que la base guarda para consultar por rango NO se publican como si fuesen la declaración.
    expect(JSON.stringify(p)).not.toContain('2026-03-01');
    expect(JSON.stringify(p)).not.toContain('2026-03-31');
  });

  it('PERÍODO 2/3 — cosecha desconocida con fecha de entrega conocida: sigue DESCONOCIDO', async () => {
    const l = await crearLote(orgA, ADMIN, `PU${++n}`, { precision: 'UNKNOWN' });
    const p = await periodoDe(l, 'Período desconocido');
    expect(p).toMatchObject({ precision: 'UNKNOWN', start: null, end: null, inherited_range: null });
    // La entrega sí tiene fecha, y aun así no ocupa el período: entregar no es producir.
    expect(JSON.stringify(p)).not.toContain(today);
    expect(p.note).toMatch(/desconocido/i);
  });

  it('PERÍODO 3/3 — sin cosecha declarada: desconocido, nunca deducido de la entrega', async () => {
    const p = await periodoDe(await loteNuevo(), 'Sin declarar');
    expect(p).toMatchObject({ precision: 'NONE', start: null, end: null, inherited_range: null });
    expect(JSON.stringify(p)).not.toContain(today);
    expect(p.note).toMatch(/no se deduce de la fecha de entrega/i);
  });

  it('PERÍODO — ninguna proyección publica una precisión deducida', async () => {
    const l = await crearLote(orgA, ADMIN, `PD${++n}`, { precision: 'DAY', start: '2026-04-02', end: '2026-04-09' });
    const g = (await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: l, can_download: true, expires_at: futuro(), reason: 'Lectura y descarga' }).expect(201)).body.grant;
    const v = (await leerConcedido(g.id).expect(200)).body;
    expect(v.production_period).toMatchObject({ precision: 'DAY', start: '2026-04-02', end: '2026-04-09' });
    // La descarga usa la MISMA proyección: tampoco ahí aparece una precisión deducida.
    const d = await http().get(`/api/v1/granted/${g.id}/download`).set(as(EXTERNO)).expect(200);
    expect(JSON.parse(d.text).recurso.production_period).toMatchObject({ precision: 'DAY', start: '2026-04-02' });
    expect(d.text).not.toContain('DERIVED');
    await revocar(g.id).expect(201);
  });

  // ------------------------------------------------------------------------------------------------ A-02: administración web
  it('A-02 identificar al destinatario por correo exacto: sin enumeración, respuesta única, intentos auditados y limitados', async () => {
    const nuevoLote = await crearLote(orgA, ADMIN, 'CW');
    // Correo exacto (sin distinguir mayúsculas): concede igual que por identificador.
    const ok = await conceder({ grantee_email: EXTERNO.toUpperCase(), resource_type: 'LOT', resource_id: nuevoLote, expires_at: futuro(), reason: 'Concesión por correo exacto' }).expect(201);
    expect(ok.body.grant.grantee_user_id).toBe(externoId);
    // Exactamente uno de los dos.
    expect((await conceder({ resource_type: 'LOT', resource_id: nuevoLote, expires_at: futuro(), reason: 'Sin destinatario' }).expect(422)).body.error.code).toBe('GRANTEE_REQUIRED');
    expect((await conceder({ grantee_email: EXTERNO, grantee_user_id: externoId, resource_type: 'LOT', resource_id: nuevoLote, expires_at: futuro(), reason: 'Ambos' }).expect(422)).body.error.code).toBe('GRANTEE_REQUIRED');
    // Cuenta inexistente e inactiva: la MISMA respuesta (no es un oráculo de existencia).
    await sql`INSERT INTO users (id, email, password_hash, first_name, last_name, status) SELECT gen_random_uuid(), 'inactiva-a02@test.local', password_hash, 'In', 'Activa', 'INACTIVE' FROM users WHERE email = ${EXTERNO}`.execute(h.db);
    const noExiste = await conceder({ grantee_email: 'nadie-a02@test.local', resource_type: 'LOT', resource_id: nuevoLote, expires_at: futuro(), reason: 'No existe' }).expect(422);
    const inactiva = await conceder({ grantee_email: 'inactiva-a02@test.local', resource_type: 'LOT', resource_id: nuevoLote, expires_at: futuro(), reason: 'Inactiva' }).expect(422);
    expect(noExiste.body.error.code).toBe('GRANTEE_NOT_AVAILABLE');
    expect(inactiva.body.error.code).toBe(noExiste.body.error.code);
    expect(inactiva.body.error.message).toBe(noExiste.body.error.message);
    // Auditado sin el correo en claro.
    const aud = await sql<{ after: unknown }>`SELECT after FROM audit_logs WHERE action = 'grant.recipient_unavailable' AND organization_id = ${orgA}`.execute(h.db);
    expect(aud.rows.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(aud.rows)).not.toMatch(/nadie-a02|inactiva-a02/);
  });

  it('A-02 recursos compartibles y lista enriquecida: solo lo propio, con código, estado y responsables', async () => {
    const lote2 = await crearLote(orgA, ADMIN, 'CX');
    const compartibles = (await http().get(`${base(orgA)}/access-grants/shareable?type=LOT`).set(as(ADMIN)).expect(200)).body;
    expect(compartibles.available).toBe(true);
    const ids = compartibles.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(lote2);
    expect(ids).not.toContain(loteB);                                          // un lote de otra organización jamás se ofrece
    expect((await http().get(`${base(orgA)}/access-grants/shareable?type=PLOT`).set(as(ADMIN))).status).toBe(422);
    // Sin grant:manage no hay lista, ni recursos compartibles, ni concesiones.
    for (const u of [TEC]) {
      expect((await http().get(`${base(orgA)}/access-grants`).set(as(u))).status).toBe(403);
      expect((await http().get(`${base(orgA)}/access-grants/shareable?type=LOT`).set(as(u))).status).toBe(403);
    }
    expect((await http().get(`${base(orgA)}/access-grants/shareable?type=LOT`).set(as(ADMIN_B))).status).toBe(404);   // ADMIN_B no es miembro de orgA: ni siquiera sabe que existe
    const g = (await conceder({ grantee_email: EXTERNO, resource_type: 'LOT', resource_id: lote2, expires_at: futuro(2), reason: 'Revisión A-02' }).expect(201)).body.grant;
    const fila = (await http().get(`${base(orgA)}/access-grants`).set(as(ADMIN)).expect(200)).body.grants.find((x: { id: string }) => x.id === g.id);
    expect(fila).toMatchObject({ estado: 'ACTIVA', can_read: true, can_download: false, grantee_email: EXTERNO });
    expect(fila.resource_label).toMatch(/^LOT-/);
    expect(fila.granted_by_name).toBeTruthy();
    expect(fila.created_at).toBeTruthy();
    // Otra organización no ve ni revoca la concesión.
    expect((await http().get(`${base(orgB)}/access-grants`).set(as(ADMIN_B)).expect(200)).body.grants.map((x: { id: string }) => x.id)).not.toContain(g.id);
    expect((await http().post(`${base(orgB)}/access-grants/${g.id}/revoke`).set(as(ADMIN_B)).send({ operation_id: randomUUID(), reason: 'Intento ajeno' })).status).toBe(404);
    // Propietario → destinatario → revocación → pérdida de acceso.
    const v = (await leerConcedido(g.id).expect(200)).body;
    expect(JSON.stringify(v)).not.toMatch(/coordinates|legal_name|document_number|precio|price|amount|importe/i);   // sin identidad, geometrías ni economía
    await http().post(`${base(orgA)}/access-grants/${g.id}/revoke`).set(as(ADMIN)).send({ operation_id: randomUUID(), reason: 'Fin de la revisión' }).expect(201);
    await leerConcedido(g.id).expect(404);
    const tras = (await http().get(`${base(orgA)}/access-grants`).set(as(ADMIN)).expect(200)).body.grants.find((x: { id: string }) => x.id === g.id);
    expect(tras).toMatchObject({ estado: 'REVOCADA', revoke_reason: 'Fin de la revisión' });
    expect(tras.revoked_by_name).toBeTruthy();
  });

  it('A-02 límite de intentos con destinatarios no disponibles: 10 por hora y persona; después espera (sin revelar nada nuevo)', async () => {
    const nuevoLote = await crearLote(orgA, ADMIN, 'CZ');
    let ultimo = 0;
    for (let i = 0; i < 12; i++) ultimo = (await conceder({ grantee_email: `nadie-${i}-a02@test.local`, resource_type: 'LOT', resource_id: nuevoLote, expires_at: futuro(), reason: 'Intento' })).status;
    expect(ultimo).toBe(429);
    // Otra persona de la organización o el mismo flujo por identificador no quedan afectados por el límite.
    await conceder({ grantee_user_id: externoId, resource_type: 'LOT', resource_id: nuevoLote, expires_at: futuro(), reason: 'Por identificador' }).expect(201);
  });
});
