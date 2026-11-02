import { SOAP_ENV_NS, securityHeader, type SecurityHeaderOptions, type ServiceCredentials } from './ws-security';

// Servicio Echo de EUDR-IS: comprueba TRANSPORTE y AUTENTICACIÓN. Un `OK` NO acredita el operador representado ni una presentación de DDS.
// Documentado por la Comisión solo para ACCEPTANCE (WSDL: https://acceptance.eudr.webcloud.ec.europa.eu/tracesnt/ws/EudrEchoService?wsdl). No se inventa un Echo de producción.
export type Environment = 'ACCEPTANCE' | 'PRODUCTION';
export const ECHO_ENDPOINTS: Partial<Record<Environment, string>> = {
  ACCEPTANCE: 'https://acceptance.eudr.webcloud.ec.europa.eu/tracesnt/ws/EudrEchoService',
};
export const ECHO_SOAP_ACTION = 'http://ec.europa.eu/tracesnt/eudr/echo';
export const ECHO_QUERY = 'Hello EUDR';

export function echoEnvelope(c: ServiceCredentials, o: SecurityHeaderOptions = {}): string {
  return `<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:echo="http://ec.europa.eu/tracesnt/eudr/echo" xmlns:base="http://ec.europa.eu/sanco/tracesnt/base/v4">`
    + `<soapenv:Header>${securityHeader(c, o)}</soapenv:Header>`
    + `<soapenv:Body><echo:EudrEchoRequest><echo:query>${ECHO_QUERY}</echo:query></echo:EudrEchoRequest></soapenv:Body></soapenv:Envelope>`;
}

export type EchoOutcome = 'OK' | 'AUTH_FAILED' | 'FAULT' | 'UNEXPECTED_RESPONSE' | 'UNREACHABLE';
export interface EchoResult { outcome: EchoOutcome; httpStatus: number | null; detail: string | null }

/** Transporte inyectable: en producción es `fetch`; las pruebas lo sustituyen y nunca salen de la máquina. */
export type SoapTransport = (url: string, init: { headers: Record<string, string>; body: string; timeoutMs: number }) => Promise<{ status: number; text: string }>;
export const fetchTransport: SoapTransport = async (url, init) => {
  const r = await fetch(url, { method: 'POST', headers: init.headers, body: init.body, signal: AbortSignal.timeout(init.timeoutMs) });
  return { status: r.status, text: await r.text() };
};

const tag = (xml: string, name: string) => new RegExp(`<(?:[A-Za-z0-9_-]+:)?${name}(?:\\s[^>]*)?>([^<]*)<`).exec(xml)?.[1]?.trim() ?? null;
const limpiar = (s: string | null) => (s ? s.replace(/[^\p{L}\p{N} .,:;()_\-/]/gu, ' ').slice(0, 200) : null);

/** Interpreta la respuesta SIN reproducir ningún valor de la solicitud. */
export function interpretEcho(status: number, text: string): EchoResult {
  const fault = tag(text, 'faultstring');
  if (fault) {
    const auth = /authentication|unauthor|credential|security/i.test(fault) || status === 401;
    return { outcome: auth ? 'AUTH_FAILED' : 'FAULT', httpStatus: status, detail: limpiar(tag(text, 'errorMessage') ?? fault) };
  }
  if (status === 401 || status === 403) return { outcome: 'AUTH_FAILED', httpStatus: status, detail: null };
  const st = tag(text, 'status');
  if (status >= 200 && status < 300 && st === 'OK') return { outcome: 'OK', httpStatus: status, detail: null };
  return { outcome: 'UNEXPECTED_RESPONSE', httpStatus: status, detail: limpiar(st) };
}

export async function callEcho(env: Environment, c: ServiceCredentials, transport: SoapTransport = fetchTransport, o: SecurityHeaderOptions = {}): Promise<EchoResult> {
  const url = ECHO_ENDPOINTS[env];
  if (!url) throw new Error('ECHO_NOT_DOCUMENTED_FOR_ENVIRONMENT');
  try {
    const r = await transport(url, { headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${ECHO_SOAP_ACTION}"` }, body: echoEnvelope(c, o), timeoutMs: 20_000 });
    return interpretEcho(r.status, r.text);
  } catch {
    return { outcome: 'UNREACHABLE', httpStatus: null, detail: null };
  }
}
