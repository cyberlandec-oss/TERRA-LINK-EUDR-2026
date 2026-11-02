import { sql } from 'kysely';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { ROLE_PERMISSIONS } from '../src/authz/catalog';
import { PII_CIPHER, type PiiCipher } from '../src/crypto/pii';
import { credentialAad } from '../src/eudr-is/eudr-is';

// P1-007 — Credenciales de EUDR-IS por organización y entorno, y comprobación de conexión (Echo), contra PostgreSQL real.
// **TODO SINTÉTICO:** las credenciales no son de ningún servicio real y la respuesta del servicio es un simulacro (`fetch` sustituido): NINGUNA llamada sale de la máquina.
// Echo acredita transporte y autenticación; no el operador representado ni una presentación de DDS.
describeDb('P1-007 EUDR-IS: credenciales y Echo (simulacro)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let orgA = ''; let orgB = '';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const base = (o: string) => `/api/v1/organizations/${o}/eudr-is`;
  const SUPER = 'ei-super@test.local'; const ADMIN = 'ei-admin-a@test.local'; const ADMIN_B = 'ei-admin-b@test.local'; const AUD = 'ei-auditor@test.local';
  const SECRETOS = { username: 'usuario-sintetico-ei', authentication_key: 'clave-sintetica-ei-12345', web_service_client_id: 'cliente-sintetico-ei' };
  const cipher = () => h.app.get<PiiCipher>(PII_CIPHER);
  const poner = (org: string, env: string, actor = ADMIN, body: Record<string, unknown> = SECRETOS) => http().put(`${base(org)}/credentials/${env}`).set(as(actor)).send(body);

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN'); await h.user(ADMIN); await h.user(ADMIN_B);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER)).send({ name: n, organization_type: 'EXPORTER', country: 'EC', initial_admin_email: admin }).expect(201)).body.id as string;
    orgA = await mk('Exportadora EUDR-IS A (sintética)', ADMIN); orgB = await mk('Exportadora EUDR-IS B (sintética)', ADMIN_B);
    const inv = await http().post(`/api/v1/organizations/${orgA}/invitations`).set(as(ADMIN)).send({ email: AUD, role_code: 'AUDITOR' }).expect(201);
    await http().post('/api/v1/invitations/accept').send({ token: inv.body.token, first_name: 'Persona', last_name: 'Auditor', password: PASSWORD }).expect(200);
    await h.login(AUD);
  }, 120_000);
  afterAll(async () => { delete process.env.EUDR_IS_LIVE_CALLS; jest.restoreAllMocks(); await h?.close(); });

  it('quién puede: administra quien tiene integration:manage; sin él 403 (control: el administrador sí); otra organización 404', async () => {
    expect(ROLE_PERMISSIONS.AUDITOR).not.toContain('integration:manage');
    await poner(orgA, 'ACCEPTANCE', AUD).expect(403);
    await poner(orgB, 'ACCEPTANCE', ADMIN).expect(404); // A no toca a B
    expect((await poner(orgA, 'ACCEPTANCE').expect(200)).body.environments.find((e: { environment: string }) => e.environment === 'ACCEPTANCE').configured).toBe(true);
    await http().get(`${base(orgA)}/credentials`).set(as(ADMIN_B)).expect(404);
    await poner(orgA, 'LAB').expect(422); // entorno inválido
  });

  it('el secreto no se devuelve ni se audita ni queda en claro; descifra solo con su contexto (organización, entorno y campo)', async () => {
    const vista = JSON.stringify((await http().get(`${base(orgA)}/credentials`).set(as(ADMIN)).expect(200)).body);
    for (const v of Object.values(SECRETOS)) expect(vista).not.toContain(v);
    const fila = (await sql<{ username_ciphertext: string; auth_key_ciphertext: string; client_id_ciphertext: string }>`SELECT username_ciphertext, auth_key_ciphertext, client_id_ciphertext FROM eudr_is_credentials WHERE organization_id = ${orgA} AND environment = 'ACCEPTANCE'`.execute(h.db)).rows[0];
    for (const v of Object.values(SECRETOS)) expect(JSON.stringify(fila)).not.toContain(v);
    expect(cipher().decrypt(fila.auth_key_ciphertext, credentialAad(orgA, 'ACCEPTANCE', 'auth_key'))).toBe(SECRETOS.authentication_key);
    expect(() => cipher().decrypt(fila.auth_key_ciphertext, credentialAad(orgB, 'ACCEPTANCE', 'auth_key'))).toThrow(); // otra organización
    expect(() => cipher().decrypt(fila.auth_key_ciphertext, credentialAad(orgA, 'PRODUCTION', 'auth_key'))).toThrow(); // otro entorno
    expect(() => cipher().decrypt(fila.auth_key_ciphertext, credentialAad(orgA, 'ACCEPTANCE', 'username'))).toThrow(); // otro campo
    const auditoria = JSON.stringify((await sql`SELECT action, before, after, reason FROM audit_logs WHERE organization_id = ${orgA} AND action LIKE 'eudr_is.%'`.execute(h.db)).rows);
    for (const v of Object.values(SECRETOS)) expect(auditoria).not.toContain(v);
    expect(auditoria).toContain('eudr_is.credential_registered');
  });

  it('ACCEPTANCE y PRODUCTION son independientes: registrar una no configura la otra; rotar conserva una sola fila', async () => {
    let s = (await http().get(`${base(orgA)}/credentials`).set(as(ADMIN)).expect(200)).body;
    expect(s.environments.find((e: { environment: string }) => e.environment === 'PRODUCTION').configured).toBe(false);
    expect(s.environments.find((e: { environment: string }) => e.environment === 'PRODUCTION').echo_documented).toBe(false);
    s = (await poner(orgA, 'ACCEPTANCE', ADMIN, { ...SECRETOS, authentication_key: 'clave-rotada-ei-98765' }).expect(200)).body;
    const e = s.environments.find((x: { environment: string }) => x.environment === 'ACCEPTANCE');
    expect(e.rotated_at).not.toBeNull();
    expect(Number((await sql<{ n: string }>`SELECT count(*)::text AS n FROM eudr_is_credentials WHERE organization_id = ${orgA}`.execute(h.db)).rows[0].n)).toBe(1);
    expect(JSON.stringify(s)).not.toContain('clave-rotada-ei-98765');
  });

  it('Echo: sin el interruptor de la plataforma 409 y NO sale ninguna llamada; PRODUCTION no tiene Echo documentado (422); sin credencial 409', async () => {
    const espia = jest.spyOn(globalThis, 'fetch');
    delete process.env.EUDR_IS_LIVE_CALLS;
    expect((await http().post(`${base(orgA)}/echo/ACCEPTANCE`).set(as(ADMIN)).expect(409)).body.error.code).toBe('EUDR_IS_LIVE_CALLS_DISABLED');
    process.env.EUDR_IS_LIVE_CALLS = 'enabled';
    expect((await http().post(`${base(orgA)}/echo/PRODUCTION`).set(as(ADMIN)).expect(422)).body.error.code).toBe('ECHO_NOT_DOCUMENTED_FOR_ENVIRONMENT');
    expect((await http().post(`${base(orgB)}/echo/ACCEPTANCE`).set(as(ADMIN_B)).expect(409)).body.error.code).toBe('EUDR_IS_CREDENTIAL_MISSING');
    await http().post(`${base(orgA)}/echo/ACCEPTANCE`).set(as(AUD)).expect(403);
    expect(espia.mock.calls.filter((c) => String(c[0]).includes('webcloud.ec.europa.eu'))).toHaveLength(0);
  });

  it('Echo con respuesta simulada: OK se registra como evidencia; fallo de autenticación también; el cuerpo enviado no lleva la clave en claro', async () => {
    process.env.EUDR_IS_LIVE_CALLS = 'enabled';
    const enviados: Array<{ url: string; body: string }> = [];
    const falso = (status: number, texto: string) => jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: unknown, init?: { body?: string }) => {
      enviados.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(texto, { status });
    }) as typeof fetch);
    falso(200, '<S:Envelope><S:Body><echo:EudrEchoResponse><echo:status>OK</echo:status></echo:EudrEchoResponse></S:Body></S:Envelope>');
    const ok = (await http().post(`${base(orgA)}/echo/ACCEPTANCE`).set(as(ADMIN)).expect(201)).body;
    expect(ok).toMatchObject({ environment: 'ACCEPTANCE', outcome: 'OK', http_status: 200 });
    expect(ok.meaning).toMatch(/No acredita el operador representado ni una presentación de DDS/);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].url).toBe('https://acceptance.eudr.webcloud.ec.europa.eu/tracesnt/ws/EudrEchoService');
    expect(enviados[0].body).toContain('usuario-sintetico-ei');
    expect(enviados[0].body).not.toContain('clave-rotada-ei-98765');
    jest.restoreAllMocks();
    falso(500, '<S:Fault><faultstring>Authentication failed</faultstring></S:Fault>');
    const mal = (await http().post(`${base(orgA)}/echo/ACCEPTANCE`).set(as(ADMIN)).expect(201)).body;
    expect(mal.outcome).toBe('AUTH_FAILED');
    expect(mal.meaning).toMatch(/No se ha enviado ninguna declaración/);
    const registros = (await sql<{ outcome: string }>`SELECT outcome FROM eudr_is_echo_checks WHERE organization_id = ${orgA} ORDER BY checked_at`.execute(h.db)).rows.map((r) => r.outcome);
    expect(registros).toEqual(['OK', 'AUTH_FAILED']);
    await expect(sql`DELETE FROM eudr_is_echo_checks WHERE organization_id = ${orgA}`.execute(h.db)).rejects.toThrow(/solo se agregan/);
    const estado = (await http().get(`${base(orgA)}/credentials`).set(as(ADMIN)).expect(200)).body;
    expect(estado.environments.find((e: { environment: string }) => e.environment === 'ACCEPTANCE').last_echo.outcome).toBe('AUTH_FAILED');
  });

  it('retirar la credencial la elimina y el Echo vuelve a exigirla', async () => {
    process.env.EUDR_IS_LIVE_CALLS = 'enabled';
    const s = (await http().delete(`${base(orgA)}/credentials/ACCEPTANCE`).set(as(ADMIN)).expect(200)).body;
    expect(s.environments.find((e: { environment: string }) => e.environment === 'ACCEPTANCE').configured).toBe(false);
    expect((await http().post(`${base(orgA)}/echo/ACCEPTANCE`).set(as(ADMIN)).expect(409)).body.error.code).toBe('EUDR_IS_CREDENTIAL_MISSING');
  });
});
