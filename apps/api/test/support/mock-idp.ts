import { createHash, generateKeyPairSync, randomUUID, type KeyObject } from 'crypto';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import * as jwt from 'jsonwebtoken';

// Proveedor OIDC CONTROLADO para pruebas (P1-015 / D-54). No es Keycloak: es un servidor mínimo que habla el
// protocolo y permite provocar cada fallo (nonce, emisor, audiencia, caducidad, verificador PKCE incorrecto).
// Keycloak real se ejercita en la demostración de despliegue (`e2e/review/sso-keycloak.mjs`).

export interface IdpOpts { clientId: string }
export interface Emision {
  sub: string; email?: string;
  /** Fallos provocados */
  nonce?: string; iss?: string; aud?: string; expiredSecondsAgo?: number;
}

export async function startMockIdp(opts: IdpOpts) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { challenge: string; nonce: string; sub: string; email?: string; redirect: string; fault: Emision }>();
  const tokenRequests: Array<Record<string, string>> = [];
  let issuer = '';

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const json = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
        end_session_endpoint: `${issuer}/logout`, response_types_supported: ['code'], subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'], authorization_response_iss_parameter_supported: true, code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'], grant_types_supported: ['authorization_code'],
      });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const f = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;
        tokenRequests.push(f);
        const c = codes.get(f.code);
        if (!c) return json(400, { error: 'invalid_grant', error_description: 'código desconocido' });
        codes.delete(f.code); // de un solo uso
        const esperado = createHash('sha256').update(f.code_verifier ?? '').digest('base64url');
        if (!f.code_verifier || esperado !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE: verificador incorrecto' });
        if (f.client_id !== opts.clientId || f.redirect_uri !== c.redirect) return json(400, { error: 'invalid_grant' });
        const now = Math.floor(Date.now() / 1000);
        const iat = c.fault.expiredSecondsAgo ? now - c.fault.expiredSecondsAgo - 60 : now;
        const exp = c.fault.expiredSecondsAgo ? now - c.fault.expiredSecondsAgo : now + 300;
        const body = jwt.sign(
          { iss: c.fault.iss ?? issuer, aud: c.fault.aud ?? opts.clientId, sub: c.sub, iat, exp, auth_time: iat,
            nonce: c.fault.nonce ?? c.nonce, ...(c.email ? { email: c.email } : {}) },
          privateKey as KeyObject, { algorithm: 'RS256', keyid: 'k1' },
        );
        return json(200, { access_token: randomUUID(), token_type: 'Bearer', expires_in: 300, id_token: body });
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    tokenRequests,
    /**
     * Hace de navegador+proveedor: recibe la URL de autorización que dio la API, comprueba que lleva PKCE S256 y
     * devuelve el `code` y el `state` que el proveedor redirigiría al destino de retorno.
     */
    authorize(authorizationUrl: string, who: Emision) {
      const u = new URL(authorizationUrl);
      const p = u.searchParams;
      if (p.get('response_type') !== 'code') throw new Error('response_type no es code');
      if (p.get('code_challenge_method') !== 'S256') throw new Error('falta PKCE S256');
      if (!p.get('code_challenge') || !p.get('state') || !p.get('nonce')) throw new Error('faltan code_challenge/state/nonce');
      if (p.get('client_id') !== opts.clientId) throw new Error('client_id inesperado');
      const code = randomUUID();
      codes.set(code, { challenge: p.get('code_challenge')!, nonce: p.get('nonce')!, sub: who.sub, email: who.email, redirect: p.get('redirect_uri')!, fault: who });
      return { code, state: p.get('state')!, iss: issuer, redirect_uri: p.get('redirect_uri')!, params: Object.fromEntries(p) };
    },
    /** Un atacante con el código robado pero sin el verificador: el proveedor lo rechaza en el canje. */
    authorizeWithOtherChallenge(authorizationUrl: string, who: Emision) {
      const r = this.authorize(authorizationUrl, who);
      const c = codes.get(r.code)!;
      c.challenge = createHash('sha256').update('otro-verificador').digest('base64url');
      return r;
    },
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
