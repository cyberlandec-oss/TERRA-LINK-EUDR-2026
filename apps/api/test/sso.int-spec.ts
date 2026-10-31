import { randomUUID } from 'crypto';
import { PASSWORD, describeDb, setupHarness } from './helpers';
import { startMockIdp } from './support/mock-idp';
import { loadSsoConfig } from '../src/config';

// P1-015 / D-54 — Acceso federado OIDC (Authorization Code + PKCE) contra un proveedor CONTROLADO.
//
// Lo que estas pruebas protegen (decisiones del 2026-10-20):
//   · Authorization Code con PKCE S256, state y nonce; destinos de retorno en lista cerrada;
//   · la identidad se vincula por EMISOR + SUJETO: un correo que coincide NO vincula ni da acceso;
//   · la autenticación externa NO concede organización, rol ni permisos;
//   · identidad sin vínculo, usuario deshabilitado, cierre de sesión y aislamiento entre organizaciones.
//
// Lo que NO demuestran: Keycloak real (se ejerce en el despliegue) ni un proveedor de un cliente real.
describeDb('P1-015 SSO OIDC con PKCE (PostgreSQL real, proveedor controlado)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let idp: Awaited<ReturnType<typeof startMockIdp>>;
  const CLIENT = 'terra-link-web';
  const REDIRECT = 'http://localhost:3000/acceso/sso';
  const SUPER = 'super-sso@test.local';
  const ALICE = 'alice-sso@test.local';
  const BOB = 'bob-sso@test.local';
  const OTRA = 'otra-org-sso@test.local';
  const http = () => h.http();
  const as = (e: string) => h.as(e);
  let orgA: string;
  let orgB: string;

  const start = (body: object, actor?: string) => {
    const r = http().post('/api/v1/auth/sso/start');
    return (actor ? r.set(as(actor)) : r).send(body);
  };
  const callback = (body: object, actor?: string) => {
    const r = http().post('/api/v1/auth/sso/callback');
    return (actor ? r.set(as(actor)) : r).send(body);
  };
  /** Recorrido completo del navegador: start → proveedor → callback. */
  async function flujo(who: Parameters<typeof idp.authorize>[1], opts: { mode?: 'LOGIN' | 'LINK'; actor?: string } = {}) {
    const s = await start({ redirect_uri: REDIRECT, mode: opts.mode ?? 'LOGIN' }, opts.actor).expect(200);
    const a = idp.authorize(s.body.authorization_url, who);
    return callback({ code: a.code, state: a.state, iss: a.iss }, opts.actor);
  }

  beforeAll(async () => {
    idp = await startMockIdp({ clientId: CLIENT });
    h = await setupHarness({
      sso: { enabled: true, issuer: idp.issuer, discoveryUrl: idp.issuer, clientId: CLIENT, clientSecret: '', redirectUris: [REDIRECT],
        scope: 'openid email profile', flowTtlSeconds: 600, label: 'Acceso de ensayo', clockToleranceSeconds: 5 },
    });
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ALICE);
    await h.user(BOB);
    await h.user(OTRA);
    const mk = async (n: string, admin: string) => (await http().post('/api/v1/organizations').set(as(SUPER))
      .send({ name: n, organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: admin }).expect(201)).body.id;
    orgA = await mk('Coop SSO A', ALICE);
    orgB = await mk('Coop SSO B', OTRA);
  });
  afterAll(async () => { await h?.close(); await idp?.close(); });

  it('la configuración pública solo dice si hay acceso federado: sin secretos ni datos del proveedor', async () => {
    const r = await http().get('/api/v1/auth/sso/config').expect(200);
    expect(r.body).toEqual({ enabled: true, label: 'Acceso de ensayo', method: 'OIDC Authorization Code + PKCE', local_login_available: true });
    expect(JSON.stringify(r.body)).not.toContain(idp.issuer);
  });

  it('DESTINOS DE RETORNO: lista cerrada y coincidencia exacta', async () => {
    for (const malo of ['http://evil.example/acceso/sso', `${REDIRECT}/x`, `${REDIRECT}?a=1`, 'http://localhost:3000/acceso/sso#frag', 'http://localhost:3000/']) {
      const r = await start({ redirect_uri: malo }).expect(422);
      expect(r.body.error.code).toBe('SSO_REDIRECT_NOT_ALLOWED');
    }
    await start({ redirect_uri: REDIRECT }).expect(200);
  });

  it('la configuración rechaza comodines, fragmentos y datos incompletos; deshabilitado por omisión', () => {
    const base = { SSO_ENABLED: 'true', SSO_OIDC_ISSUER: 'http://i.example/realms/r', SSO_OIDC_CLIENT_ID: 'c' };
    expect(loadSsoConfig({}).enabled).toBe(false);
    expect(() => loadSsoConfig({ ...base, SSO_REDIRECT_URIS: 'http://localhost:3000/*' })).toThrow(/comodines/);
    expect(() => loadSsoConfig({ ...base, SSO_REDIRECT_URIS: 'http://localhost:3000/a#x' })).toThrow(/fragmentos/);
    expect(() => loadSsoConfig({ ...base, SSO_REDIRECT_URIS: 'no-es-url' })).toThrow(/inválida/);
    expect(() => loadSsoConfig({ ...base })).toThrow(/SSO_REDIRECT_URIS/);
    expect(() => loadSsoConfig({ SSO_ENABLED: 'true', SSO_REDIRECT_URIS: 'http://localhost:3000/a' })).toThrow(/SSO_OIDC_ISSUER/);
    expect(loadSsoConfig({ ...base, SSO_REDIRECT_URIS: 'http://localhost:3000/a, http://localhost:3000/b' }).redirectUris).toHaveLength(2);
  });

  it('RUTA PÚBLICA ACOTADA: con demasiados inicios en curso se frena con 429 y el acceso local no se ve afectado', async () => {
    const { sql } = await import('kysely');
    await sql`INSERT INTO sso_flows (state_hash, mode, nonce, code_verifier, redirect_uri, expires_at)
      SELECT md5(g::text) || md5(g::text || 'x'), 'LOGIN', 'n', 'v', ${REDIRECT}, now() + interval '5 minutes' FROM generate_series(1, 5000) g`.execute(h.db);
    const r = await start({ redirect_uri: REDIRECT });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('SSO_TOO_MANY_FLOWS');
    await http().post('/api/v1/auth/login').send({ email: OTRA, password: PASSWORD }).expect(200);
    await sql`DELETE FROM sso_flows`.execute(h.db);
    await start({ redirect_uri: REDIRECT }).expect(200);
  });

  it('LA AUTORIZACIÓN LLEVA PKCE S256, state y nonce (el proveedor lo comprueba)', async () => {
    const s = await start({ redirect_uri: REDIRECT }).expect(200);
    const u = new URL(s.body.authorization_url);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get('state')!.length).toBeGreaterThanOrEqual(16);
    expect(u.searchParams.get('nonce')!.length).toBeGreaterThanOrEqual(16);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT);
    // El verificador PKCE nunca sale de la API.
    expect(s.body.authorization_url).not.toMatch(/code_verifier/);
  });

  it('IDENTIDAD SIN VÍNCULO: se rechaza, aunque el correo coincida con una cuenta local', async () => {
    const r = await flujo({ sub: 'sub-desconocido', email: ALICE });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('SSO_IDENTITY_NOT_LINKED');
    // No se creó ningún vínculo ni se dio acceso.
    const n = await h.db.selectFrom('identity_links').select('id').execute();
    expect(n).toHaveLength(0);
  });

  it('VINCULAR exige sesión propia y se hace por emisor+sujeto, no por correo', async () => {
    // Sin sesión: no se puede iniciar un vínculo.
    await start({ redirect_uri: REDIRECT, mode: 'LINK' }).expect(401);
    // Con sesión de Alice, aunque el proveedor declare el correo de BOB, el vínculo es de Alice.
    const r = await flujo({ sub: 'sub-alice', email: BOB }, { mode: 'LINK', actor: ALICE });
    expect(r.status).toBe(200);
    expect(r.body.linked).toBe(true);
    const fila = await h.db.selectFrom('identity_links').selectAll().where('subject', '=', 'sub-alice').executeTakeFirstOrThrow();
    expect(fila.issuer).toBe(idp.issuer);
    const alice = await h.db.selectFrom('users').select('id').where('email', '=', ALICE).executeTakeFirstOrThrow();
    expect(fila.user_id).toBe(alice.id);
    expect(fila.email_claim).toBe(BOB); // informativo
    // La lista propia no expone el sujeto completo.
    const lista = await http().get('/api/v1/auth/sso/links').set(as(ALICE)).expect(200);
    expect(lista.body.links).toHaveLength(1);
    expect(JSON.stringify(lista.body)).not.toContain('sub-alice');
    expect(lista.body.links[0].subject_hint).toBe('…-alice');
  });

  it('el vínculo se completa solo desde la misma sesión que lo inició', async () => {
    const s = await start({ redirect_uri: REDIRECT, mode: 'LINK' }, ALICE).expect(200);
    const a = idp.authorize(s.body.authorization_url, { sub: 'sub-robado' });
    // Otra sesión intenta completar el vínculo de Alice.
    expect((await callback({ code: a.code, state: a.state, iss: a.iss }, BOB)).status).toBe(403);
    // Sin sesión tampoco.
    const s2 = await start({ redirect_uri: REDIRECT, mode: 'LINK' }, ALICE).expect(200);
    const a2 = idp.authorize(s2.body.authorization_url, { sub: 'sub-robado-2' });
    expect((await callback({ code: a2.code, state: a2.state, iss: a2.iss })).status).toBe(403);
  });

  it('conflictos: una identidad ya vinculada no se vincula a otra cuenta, ni una cuenta a dos identidades del mismo emisor', async () => {
    const otra = await flujo({ sub: 'sub-alice' }, { mode: 'LINK', actor: BOB });
    expect(otra.status).toBe(409);
    expect(otra.body.error.code).toBe('SSO_IDENTITY_ALREADY_LINKED');
    const doble = await flujo({ sub: 'sub-alice-2' }, { mode: 'LINK', actor: ALICE });
    expect(doble.status).toBe(409);
    expect(doble.body.error.code).toBe('SSO_USER_ALREADY_LINKED');
  });

  it('ACCESO AUTORIZADO: la identidad vinculada entra, con el mismo testigo, y los permisos siguen siendo los de la cuenta', async () => {
    const r = await flujo({ sub: 'sub-alice' });
    expect(r.status).toBe(200);
    expect(r.body.token_type).toBe('Bearer');
    const token = r.body.access_token as string;
    h.tokens['alice-sso'] = token;
    // Alcanza SU organización con sus permisos de siempre…
    await http().get(`/api/v1/organizations/${orgA}/limits`).set(as('alice-sso')).expect(200);
    // …y no la ajena: la autenticación externa no concede organización.
    expect((await http().get(`/api/v1/organizations/${orgB}/limits`).set(as('alice-sso'))).status).toBe(404);
    // Queda en la auditoría.
    const a = await h.db.selectFrom('audit_logs').select(['action', 'result']).where('action', '=', 'auth.sso_login').execute();
    expect(a.some((x) => x.result === 'SUCCESS')).toBe(true);
  });

  it('un usuario sin membresía en ninguna organización entra pero no ve nada: el SSO no concede permisos', async () => {
    await flujo({ sub: 'sub-bob' }, { mode: 'LINK', actor: BOB }).then((r) => expect(r.status).toBe(200));
    const r = await flujo({ sub: 'sub-bob' });
    expect(r.status).toBe(200);
    h.tokens['bob-sso'] = r.body.access_token;
    expect((await http().get(`/api/v1/organizations/${orgA}/limits`).set(as('bob-sso'))).status).toBe(404);
    expect((await http().get(`/api/v1/organizations/${orgB}/limits`).set(as('bob-sso'))).status).toBe(404);
  });

  it('STATE: de un solo uso, y un state desconocido o alterado se rechaza', async () => {
    const s = await start({ redirect_uri: REDIRECT }).expect(200);
    const a = idp.authorize(s.body.authorization_url, { sub: 'sub-alice' });
    expect((await callback({ code: a.code, state: a.state, iss: a.iss })).status).toBe(200);
    const reuso = await callback({ code: a.code, state: a.state, iss: a.iss });
    expect(reuso.status).toBe(400);
    expect(reuso.body.error.code).toBe('SSO_FLOW_INVALID');
    const s2 = await start({ redirect_uri: REDIRECT }).expect(200);
    const a2 = idp.authorize(s2.body.authorization_url, { sub: 'sub-alice' });
    expect((await callback({ code: a2.code, state: `${a2.state}x`, iss: a2.iss })).body.error.code).toBe('SSO_FLOW_INVALID');
    // Y un flujo vencido tampoco vale.
    const s3 = await start({ redirect_uri: REDIRECT }).expect(200);
    const a3 = idp.authorize(s3.body.authorization_url, { sub: 'sub-alice' });
    await h.db.updateTable('sso_flows').set({ expires_at: new Date(Date.now() - 1000) }).execute();
    expect((await callback({ code: a3.code, state: a3.state, iss: a3.iss })).body.error.code).toBe('SSO_FLOW_INVALID');
  });

  it('PROTOCOLO: nonce, emisor, audiencia o caducidad incorrectos se rechazan sin dar acceso', async () => {
    for (const falla of [{ nonce: 'otro-nonce-cualquiera-0000' }, { iss: 'http://otro-emisor.example' }, { aud: 'otro-cliente' }, { expiredSecondsAgo: 3600 }]) {
      const r = await flujo({ sub: 'sub-alice', ...falla });
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('SSO_PROTOCOL_ERROR');
      expect(r.body.access_token).toBeUndefined();
      // No se filtra el detalle del protocolo.
      expect(JSON.stringify(r.body)).not.toMatch(/nonce|issuer|audience|expired/i);
    }
  });

  it('RFC 9207: el retorno debe traer el emisor correcto; sin él o con otro se rechaza', async () => {
    const s = await start({ redirect_uri: REDIRECT }).expect(200);
    const a = idp.authorize(s.body.authorization_url, { sub: 'sub-alice' });
    const sinIss = await callback({ code: a.code, state: a.state });
    expect(sinIss.status).toBe(401);
    expect(sinIss.body.error.code).toBe('SSO_PROTOCOL_ERROR');
    const s2 = await start({ redirect_uri: REDIRECT }).expect(200);
    const a2 = idp.authorize(s2.body.authorization_url, { sub: 'sub-alice' });
    expect((await callback({ code: a2.code, state: a2.state, iss: 'http://otro-emisor.example' })).status).toBe(401);
  });

  it('PKCE: un código robado sin el verificador no se puede canjear', async () => {
    const s = await start({ redirect_uri: REDIRECT }).expect(200);
    const a = idp.authorizeWithOtherChallenge(s.body.authorization_url, { sub: 'sub-alice' });
    const r = await callback({ code: a.code, state: a.state, iss: a.iss });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('SSO_PROTOCOL_ERROR');
    // El canje llegó al proveedor con un verificador y sin secreto de cliente (cliente público).
    const ultimo = idp.tokenRequests.at(-1)!;
    expect(ultimo.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(ultimo.client_secret).toBeUndefined();
  });

  it('CIERRE DE SESIÓN: cierra ESTA sesión y no las demás de la cuenta; ofrece cerrar la sesión del proveedor', async () => {
    const sso = await flujo({ sub: 'sub-alice' });
    h.tokens['alice-sso-2'] = sso.body.access_token;
    await http().get('/api/v1/organizations').set(as('alice-sso-2')).expect(200);
    const out = await http().post('/api/v1/auth/logout').set(as('alice-sso-2')).expect(200);
    expect(out.body.logged_out).toBe(true);
    expect(out.body.sso_end_session_url).toContain(`${idp.issuer}/logout`);
    expect(out.body.sso_end_session_url).toContain('client_id=terra-link-web');
    // Esa sesión ya no vale…
    expect((await http().get('/api/v1/organizations').set(as('alice-sso-2'))).status).toBe(401);
    // …y la sesión local de la misma cuenta sigue viva.
    await http().get('/api/v1/organizations').set(as(ALICE)).expect(200);
    // Un cierre de sesión local no ofrece cerrar nada en el proveedor.
    const local = await http().post('/api/v1/auth/logout').set(as(BOB)).expect(200);
    expect(local.body.sso_end_session_url).toBeNull();
    await h.login(BOB);
  });

  it('USUARIO DESHABILITADO: la identidad vinculada no entra y la sesión previa deja de valer', async () => {
    const r = await flujo({ sub: 'sub-alice' });
    h.tokens['alice-previa'] = r.body.access_token;
    await http().get('/api/v1/organizations').set(as('alice-previa')).expect(200);
    await h.db.updateTable('users').set({ status: 'INACTIVE' }).where('email', '=', ALICE).execute();
    const denegado = await flujo({ sub: 'sub-alice' });
    expect(denegado.status).toBe(403);
    expect(denegado.body.error.code).toBe('SSO_ACCOUNT_DISABLED');
    expect((await http().get('/api/v1/organizations').set(as('alice-previa'))).status).toBe(401);
    await h.db.updateTable('users').set({ status: 'ACTIVE' }).where('email', '=', ALICE).execute();
  });

  it('DESVINCULAR: la identidad deja de entrar, y solo se desvincula lo propio', async () => {
    const lista = await http().get('/api/v1/auth/sso/links').set(as(ALICE)).expect(200);
    const id = lista.body.links[0].id;
    expect((await http().delete(`/api/v1/auth/sso/links/${id}`).set(as(BOB))).status).toBe(404);
    await http().delete(`/api/v1/auth/sso/links/${id}`).set(as(ALICE)).expect(200);
    const r = await flujo({ sub: 'sub-alice' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('SSO_IDENTITY_NOT_LINKED');
    // El acceso local sigue disponible como alternativa.
    await http().post('/api/v1/auth/login').send({ email: ALICE, password: PASSWORD }).expect(200);
  });

  it('el acceso local sigue funcionando con SSO habilitado y las auditorías existen', async () => {
    await http().post('/api/v1/auth/login').send({ email: OTRA, password: PASSWORD }).expect(200);
    const acciones = (await h.db.selectFrom('audit_logs').select('action').execute()).map((a) => a.action);
    for (const a of ['auth.sso_login', 'auth.sso_linked', 'auth.sso_unlinked', 'auth.logout']) expect(acciones).toContain(a);
    // Sin operation_id/uuid ajenos: el id de un vínculo inexistente es 404 opaco.
    expect((await http().delete(`/api/v1/auth/sso/links/${randomUUID()}`).set(as(ALICE))).status).toBe(404);
  });
});
