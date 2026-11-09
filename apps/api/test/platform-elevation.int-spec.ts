import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// D-04 — Elevación de plataforma supervisada, contra PostgreSQL real. Datos SINTÉTICOS.
// Contrato: `docs/decisiones/P0-003-CONCESIONES-Y-ELEVACION.md`.
//
// Lo que se fija aquí es que la elevación **no sea una puerta trasera**: sin aprobación no habilita nada, no se
// autoaprueba, no excede su alcance, no cruza de organización, no sobrevive a la revocación ni al vencimiento,
// y **no es lo mismo que una concesión**. La última prueba demuestra que son mecanismos separados.
describeDb('D-04 elevación supervisada: aprobación de un tercero, alcance cerrado y caducidad', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA = '';
  let orgB = '';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}`;
  const SUPER = 'super@test.local';
  const ADMIN_A = 'admin-a@test.local';
  const ADMIN_A2 = 'admin-a2@test.local';
  const ADMIN_B = 'admin-b@test.local';
  const TEC = 'tecnico@test.local';

  async function join(o: string, email: string, role: string, admin: string) {
    const inv = await http().post(`${base(o)}/invitations`).set(as(admin)).send({ email, role_code: role }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: email.split('@')[0], password: PASSWORD }).expect(200);
    await h.login(email);
  }

  const solicitar = (org: string, cuerpo: Record<string, unknown> = {}, actor = SUPER) =>
    http().post(`${base(org)}/platform-elevations`).set(as(actor)).send({
      operation_id: randomUUID(), password: PASSWORD, purpose: 'Soporte de plataforma',
      reason: 'Diagnóstico solicitado por la organización', scope_note: 'Listado de miembros',
      actions: ['members:read'], duration_seconds: 900, ...cuerpo,
    });
  const aprobar = (org: string, id: string, actor: string) =>
    http().post(`${base(org)}/platform-elevations/${id}/approve`).set(as(actor)).send({ operation_id: randomUUID(), reason: 'Aprobado para soporte' });
  const miembros = (org: string, actor: string) => http().get(`${base(org)}/members`).set(as(actor));
  /** Cierra cualquier elevación viva: solo puede haber una por solicitante y organización. */
  async function limpiar(org: string) {
    const vivas = (await sql<{ id: string; status: string }>`SELECT id, status FROM platform_elevations WHERE organization_id = ${org} AND status IN ('PENDING','APPROVED')`.execute(h.db)).rows;
    for (const v of vivas) {
      const ruta = v.status === 'APPROVED' ? 'revoke' : 'reject';
      await http().post(`${base(org)}/platform-elevations/${v.id}/${ruta}`).set(as(ADMIN_A2)).send({ operation_id: randomUUID(), reason: 'Limpieza entre pruebas' });
    }
  }

  beforeAll(async () => {
    h = await setupHarness();
    await h.app.listen(0);
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN_A);
    await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop Elevación A', ADMIN_A);
    orgB = await mk('Coop Elevación B', ADMIN_B);
    await join(orgA, ADMIN_A2, 'ORG_ADMIN', ADMIN_A);   // segundo ORG_ADMIN, para aprobar
    await join(orgA, TEC, 'FIELD_TECHNICIAN', ADMIN_A);
  });
  afterAll(async () => h?.close());

  it('sin elevación aprobada, la plataforma sigue bloqueada', async () => {
    const r = await miembros(orgA, SUPER).expect(403);
    expect(r.body.error.code).toBe('ELEVATION_REQUIRED');
    // Control: un ORG_ADMIN de la organización sí ve a sus miembros, con sus datos.
    const ok = await miembros(orgA, ADMIN_A).expect(200);
    expect(ok.body[0]).toHaveProperty('email');
  });

  it('solicitar exige SUPER_ADMIN y comprobación reciente de contraseña', async () => {
    await solicitar(orgA, {}, ADMIN_A).expect(403);                       // no es de plataforma
    const mala = await solicitar(orgA, { password: 'contrasena-incorrecta' }).expect(403);
    expect(mala.body.error.code).toBe('REAUTHENTICATION_REQUIRED');
    // Conocer el identificador de la organización no basta: sin contraseña correcta no hay solicitud.
    expect((await sql<{ n: string }>`SELECT count(*)::text AS n FROM platform_elevations WHERE organization_id = ${orgA}`.execute(h.db)).rows[0].n).toBe('0');
  });

  it('la solicitud queda PENDIENTE y por sí sola no habilita nada', async () => {
    const e = (await solicitar(orgA).expect(201)).body.elevation;
    expect(e.status).toBe('PENDING');
    const r = await miembros(orgA, SUPER).expect(403);
    expect(r.body.error.code).toBe('ELEVATION_REQUIRED');
    // Y la organización la ve: visibilidad, no solo una fila de auditoría escondida.
    const vista = (await http().get(`${base(orgA)}/platform-elevations`).set(as(ADMIN_A)).expect(200)).body.elevations;
    expect(vista.map((x: { id: string }) => x.id)).toContain(e.id);
    expect(vista[0]).toMatchObject({ status: 'PENDING', scope_note: 'Listado de miembros' });
  });

  it('no hay autoaprobación, ni aprobación por quien no es ORG_ADMIN activo de esa organización', async () => {
    const id = (await sql<{ id: string }>`SELECT id FROM platform_elevations WHERE organization_id = ${orgA} AND status = 'PENDING'`.execute(h.db)).rows[0].id;
    // El solicitante no es miembro: la respuesta es 404 y no revela la solicitud. Tampoco podría aprobarla.
    expect([403, 404]).toContain((await aprobar(orgA, id, SUPER)).status);
    await aprobar(orgA, id, TEC).expect(403);          // un técnico tampoco
    await aprobar(orgA, id, ADMIN_B).expect(404);      // un ORG_ADMIN de OTRA organización no la ve
    // Sigue pendiente y sigue sin habilitar nada.
    expect((await sql<{ status: string }>`SELECT status FROM platform_elevations WHERE id = ${id}`.execute(h.db)).rows[0].status).toBe('PENDING');
    await miembros(orgA, SUPER).expect(403);
  });

  it('aprobada por un ORG_ADMIN distinto, habilita SOLO la lectura y SIN datos personales', async () => {
    const id = (await sql<{ id: string }>`SELECT id FROM platform_elevations WHERE organization_id = ${orgA} AND status = 'PENDING'`.execute(h.db)).rows[0].id;
    const ap = (await aprobar(orgA, id, ADMIN_A2).expect(201)).body;
    expect(ap.elevation.status).toBe('APPROVED');

    const r = await miembros(orgA, SUPER).expect(200);
    expect(r.body.length).toBeGreaterThan(0);
    // Lectura redactada: ni correos, ni nombres. El perfil excluye la identidad protegida.
    for (const m of r.body) {
      expect(m).toMatchObject({ redacted: true });
      expect(m).not.toHaveProperty('email');
      expect(m).not.toHaveProperty('first_name');
    }
    expect(JSON.stringify(r.body)).not.toContain(ADMIN_A);

    // Y SOLO lectura: las escrituras de ese mismo archivo siguen bloqueadas.
    const m = (await sql<{ id: string }>`SELECT m.id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = ${TEC} AND m.organization_id = ${orgA}`.execute(h.db)).rows[0].id;
    const escritura = await http().post(`${base(orgA)}/members/${m}/status`).set(as(SUPER)).send({ status: 'INACTIVE', reason: 'intento de escritura elevada' });
    expect([403, 404]).toContain(escritura.status);
    expect((await sql<{ status: string }>`SELECT status FROM memberships WHERE id = ${m}`.execute(h.db)).rows[0].status).toBe('ACTIVE');
  });

  it('no excede su alcance: una acción fuera del catálogo se rechaza', async () => {
    await solicitar(orgB, { actions: ['members:write'] }).expect(400);
    await solicitar(orgB, { actions: [] }).expect(400);
    await solicitar(orgB, { duration_seconds: 901 }).expect(400);   // más de 15 minutos
    await solicitar(orgB, { duration_seconds: 10 }).expect(400);
  });

  it('no cruza de organización: la elevación sobre A no sirve para B', async () => {
    const vivas = (await sql<{ n: string }>`SELECT count(*)::text AS n FROM platform_elevations WHERE organization_id = ${orgA} AND status = 'APPROVED'`.execute(h.db)).rows[0].n;
    expect(vivas).toBe('1');                       // control: hay una viva en A
    await miembros(orgA, SUPER).expect(200);       // y funciona en A
    const r = await miembros(orgB, SUPER).expect(403);
    expect(r.body.error.code).toBe('ELEVATION_REQUIRED');
  });

  it('la sesión queda ligada: invalidar las sesiones del solicitante corta el acceso', async () => {
    await miembros(orgA, SUPER).expect(200);
    await sql`UPDATE users SET token_version = token_version + 1 WHERE email = ${SUPER}`.execute(h.db);
    // El token anterior deja de valer (401) y, aunque volviera a entrar, la elevación quedó ligada a la sesión previa.
    const r = await miembros(orgA, SUPER);
    expect([401, 403]).toContain(r.status);
    await sql`UPDATE users SET token_version = token_version - 1 WHERE email = ${SUPER}`.execute(h.db);
    await miembros(orgA, SUPER).expect(200);       // restaurada la sesión, vuelve a aplicar
  });

  it('revocar corta el acceso de inmediato y no se reactiva', async () => {
    const id = (await sql<{ id: string }>`SELECT id FROM platform_elevations WHERE organization_id = ${orgA} AND status = 'APPROVED'`.execute(h.db)).rows[0].id;
    await http().post(`${base(orgA)}/platform-elevations/${id}/revoke`).set(as(ADMIN_A2)).send({ operation_id: randomUUID(), reason: 'Soporte terminado' }).expect(201);
    const r = await miembros(orgA, SUPER).expect(403);
    expect(r.body.error.code).toBe('ELEVATION_REQUIRED');
    await expect(sql`UPDATE platform_elevations SET status = 'APPROVED' WHERE id = ${id}`.execute(h.db)).rejects.toThrow(/no se reactiva/);
    // Un cambio REAL de los términos: poner los mismos valores no sería una edición y no debe disparar nada.
    await expect(sql`UPDATE platform_elevations SET duration_seconds = 600 WHERE id = ${id}`.execute(h.db)).rejects.toThrow(/no se editan/);
    await expect(sql`UPDATE platform_elevations SET scope_note = 'otro alcance' WHERE id = ${id}`.execute(h.db)).rejects.toThrow(/no se editan/);
  });

  it('una elevación vencida deja de servir, con la hora del servidor', async () => {
    await limpiar(orgA);
    const e = (await solicitar(orgA).expect(201)).body.elevation;
    await aprobar(orgA, e.id, ADMIN_A2).expect(201);
    await miembros(orgA, SUPER).expect(200);                       // control: viva
    // Se adelanta el vencimiento en la base: el estado guardado no cambia, pero la hora del servidor manda.
    await sql`UPDATE platform_elevations SET expires_at = now() - interval '1 second' WHERE id = ${e.id}`.execute(h.db);
    const r = await miembros(orgA, SUPER).expect(403);
    expect(r.body.error.code).toBe('ELEVATION_REQUIRED');
    const vista = (await http().get(`${base(orgA)}/platform-elevations`).set(as(ADMIN_A)).expect(200)).body.elevations;
    expect(vista.find((x: { id: string }) => x.id === e.id).status).toBe('EXPIRED');
  });

  it('el solicitante puede terminarla antes, sin necesitar a nadie', async () => {
    await limpiar(orgA);
    const e = (await solicitar(orgA).expect(201)).body.elevation;
    await aprobar(orgA, e.id, ADMIN_A2).expect(201);
    await miembros(orgA, SUPER).expect(200);
    await http().post(`${base(orgA)}/platform-elevations/${e.id}/end`).set(as(SUPER)).expect(201);
    await miembros(orgA, SUPER).expect(403);
  });

  it('se audita solicitud, aprobación, uso y revocación, y la organización lo ve', async () => {
    await limpiar(orgA);
    const e = (await solicitar(orgA).expect(201)).body.elevation;
    await aprobar(orgA, e.id, ADMIN_A2).expect(201);
    await miembros(orgA, SUPER).expect(200);
    await http().post(`${base(orgA)}/platform-elevations/${e.id}/revoke`).set(as(ADMIN_A2)).send({ operation_id: randomUUID(), reason: 'Fin' }).expect(201);
    const acciones = (await sql<{ action: string }>`SELECT action FROM audit_logs WHERE entity_id = ${e.id} ORDER BY occurred_at`.execute(h.db)).rows.map((r) => r.action);
    expect(acciones).toEqual(expect.arrayContaining(['elevation.request', 'elevation.approve', 'elevation.use', 'elevation.revoke']));
    const texto = JSON.stringify((await sql<{ after: unknown }>`SELECT after FROM audit_logs WHERE entity_id = ${e.id}`.execute(h.db)).rows);
    for (const prohibido of [PASSWORD, 'password']) expect(texto).not.toContain(prohibido);
    // Visibilidad: la organización ve la solicitud y cuántas veces se usó.
    const vista = (await http().get(`${base(orgA)}/platform-elevations`).set(as(ADMIN_A)).expect(200)).body.elevations;
    expect(vista.find((x: { id: string }) => x.id === e.id).usos).toBeGreaterThan(0);
  });

  it('la elevación queda ligada a LA SESIÓN que la solicitó, no a la cuenta', async () => {
    await limpiar(orgA);
    // Dos sesiones independientes de la MISMA cuenta, con el MISMO token_version: lo que las distingue no
    // puede ser la versión de sesión, que es por cuenta.
    const tokenA = await h.login(SUPER);
    const tokenB = await h.login(SUPER);
    expect(tokenA).not.toBe(tokenB);
    const authA = { Authorization: `Bearer ${tokenA}` };
    const authB = { Authorization: `Bearer ${tokenB}` };
    const tv = (await sql<{ token_version: number }>`SELECT token_version FROM users WHERE email = ${SUPER}`.execute(h.db)).rows[0].token_version;

    // Se solicita desde A, probando la contraseña en A, y la aprueba un ORG_ADMIN distinto.
    const e = (await http().post(`${base(orgA)}/platform-elevations`).set(authA).send({
      operation_id: randomUUID(), password: PASSWORD, purpose: 'Soporte', reason: 'Diagnóstico',
      scope_note: 'Listado de miembros', actions: ['members:read'], duration_seconds: 900,
    }).expect(201)).body.elevation;
    await aprobar(orgA, e.id, ADMIN_A2).expect(201);

    // A obtiene únicamente la lectura aprobada.
    const leidoA = await http().get(`${base(orgA)}/members`).set(authA).expect(200);
    expect(leidoA.body[0]).toMatchObject({ redacted: true });

    // B, la otra sesión de la misma cuenta, sigue DENEGADA: no hereda la elevación.
    const leidoB = await http().get(`${base(orgA)}/members`).set(authB).expect(403);
    expect(leidoB.body.error.code).toBe('ELEVATION_REQUIRED');

    // Y B tampoco puede finalizarla ni revocarla: no es su sesión.
    expect([403, 404]).toContain((await http().post(`${base(orgA)}/platform-elevations/${e.id}/end`).set(authB)).status);
    await http().get(`${base(orgA)}/members`).set(authA).expect(200);   // la de A sigue viva

    // El token_version no cambió: la distinción no viene de él.
    expect((await sql<{ token_version: number }>`SELECT token_version FROM users WHERE email = ${SUPER}`.execute(h.db)).rows[0].token_version).toBe(tv);

    // Volver a iniciar sesión NO hereda la autorización anterior.
    const tokenC = await h.login(SUPER);
    expect((await http().get(`${base(orgA)}/members`).set({ Authorization: `Bearer ${tokenC}` })).status).toBe(403);

    // Se cierra y se restaura la sesión que usan las demás pruebas.
    await http().post(`${base(orgA)}/platform-elevations/${e.id}/end`).set(authA).expect(201);
    await h.login(SUPER);
  });

  it('si el aprobador deja de ser ORG_ADMIN activo, la elevación deja de servir', async () => {
    await limpiar(orgA);
    const e = (await solicitar(orgA).expect(201)).body.elevation;
    await aprobar(orgA, e.id, ADMIN_A2).expect(201);
    await miembros(orgA, SUPER).expect(200);                       // control: viva
    // El aprobador pierde su condición habilitante.
    await sql`UPDATE memberships SET status = 'INACTIVE' WHERE organization_id = ${orgA}
      AND user_id = (SELECT id FROM users WHERE email = ${ADMIN_A2})`.execute(h.db);
    const r = await miembros(orgA, SUPER).expect(403);
    expect(r.body.error.code).toBe('ELEVATION_REQUIRED');
    await sql`UPDATE memberships SET status = 'ACTIVE' WHERE organization_id = ${orgA}
      AND user_id = (SELECT id FROM users WHERE email = ${ADMIN_A2})`.execute(h.db);
  });

  it('una elevación NO es una concesión: son mecanismos separados', async () => {
    await limpiar(orgA);
    // La elevación no aparece como concesión, ni al revés, y ninguna habilita la vía de la otra.
    const e = (await solicitar(orgA).expect(201)).body.elevation;
    await aprobar(orgA, e.id, ADMIN_A2).expect(201);
    // Con elevación viva, SUPER_ADMIN no tiene nada concedido ni accede por la vía de concesiones.
    expect((await http().get('/api/v1/granted').set(as(SUPER)).expect(200)).body.grants).toEqual([]);
    await http().get(`/api/v1/granted/${e.id}`).set(as(SUPER)).expect(404);
    // Y la elevación no abre el resto de la organización: solo la acción concedida.
    await http().get(`${base(orgA)}/producers`).set(as(SUPER)).expect(404);
    await http().get(`${base(orgA)}/lots`).set(as(SUPER)).expect(404);
    await http().post(`${base(orgA)}/platform-elevations/${e.id}/end`).set(as(SUPER)).expect(201);
  });
});
