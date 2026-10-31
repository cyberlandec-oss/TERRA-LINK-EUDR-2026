import { createHash, randomBytes } from 'crypto';

// WS-Security UsernameToken (PasswordDigest) para los servicios web de EUDR-IS / TRACES NT.
//   Password = Base64( SHA-1( Nonce(bytes) + Created(UTF-8) + AuthenticationKey(UTF-8) ) )
// El Timestamp debe estar a menos de 5 minutos de la hora del servidor. Ningún valor secreto se registra ni se devuelve desde aquí.
export interface ServiceCredentials { username: string; authenticationKey: string; clientId: string }

const NS = {
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  digest: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest',
  base64: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary',
};

export const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function passwordDigest(nonce: Buffer, created: string, authenticationKey: string): string {
  return createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created, 'utf8'), Buffer.from(authenticationKey, 'utf8')])).digest('base64');
}

export interface SecurityHeaderOptions { now?: Date; nonce?: Buffer }

/** Cabecera `wsse:Security` + `base:WebServiceClientId` (fragmento de `soapenv:Header`). */
export function securityHeader(c: ServiceCredentials, o: SecurityHeaderOptions = {}): string {
  const now = o.now ?? new Date();
  const created = now.toISOString();
  const expires = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  const nonce = o.nonce ?? randomBytes(16);
  return `<wsse:Security xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}" soapenv:mustUnderstand="1">`
    + `<wsu:Timestamp wsu:Id="TS-1"><wsu:Created>${created}</wsu:Created><wsu:Expires>${expires}</wsu:Expires></wsu:Timestamp>`
    + `<wsse:UsernameToken wsu:Id="UsernameToken-1">`
    + `<wsse:Username>${xmlEscape(c.username)}</wsse:Username>`
    + `<wsse:Password Type="${NS.digest}">${passwordDigest(nonce, created, c.authenticationKey)}</wsse:Password>`
    + `<wsse:Nonce EncodingType="${NS.base64}">${nonce.toString('base64')}</wsse:Nonce>`
    + `<wsu:Created>${created}</wsu:Created>`
    + `</wsse:UsernameToken></wsse:Security>`
    + `<base:WebServiceClientId>${xmlEscape(c.clientId)}</base:WebServiceClientId>`;
}

export const SOAP_ENV_NS = NS.soap;
