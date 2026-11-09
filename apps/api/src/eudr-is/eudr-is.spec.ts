import { createHash } from 'crypto';
import { ECHO_ENDPOINTS, ECHO_SOAP_ACTION, callEcho, echoEnvelope, interpretEcho, type SoapTransport } from './echo';
import { passwordDigest, securityHeader, xmlEscape } from './ws-security';

// Credenciales SINTÉTICAS de prueba: no son de ningún servicio real.
const C = { username: 'usuario-sintetico', authenticationKey: 'clave-sintetica-no-real-123', clientId: 'cliente-sintetico' };
const NONCE = Buffer.from('0123456789abcdef');
const AHORA = new Date('2026-10-30T12:00:00.000Z');

describe('EUDR-IS — WS-Security y servicio Echo', () => {
  it('el digest es Base64(SHA-1(nonce + created + clave)), calculado de forma independiente', () => {
    const esperado = createHash('sha1').update(Buffer.concat([NONCE, Buffer.from('2026-10-30T12:00:00.000Z'), Buffer.from(C.authenticationKey)])).digest('base64');
    expect(passwordDigest(NONCE, '2026-10-30T12:00:00.000Z', C.authenticationKey)).toBe(esperado);
    expect(passwordDigest(NONCE, '2026-10-30T12:00:01.000Z', C.authenticationKey)).not.toBe(esperado); // cambiar la marca de tiempo cambia el digest
  });

  it('la cabecera lleva usuario, tipo PasswordDigest, nonce, marcas dentro de 5 minutos y WebServiceClientId, y NUNCA la clave', () => {
    const h = securityHeader(C, { now: AHORA, nonce: NONCE });
    expect(h).toContain('<wsse:Username>usuario-sintetico</wsse:Username>');
    expect(h).toContain('#PasswordDigest');
    expect(h).toContain(`<wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${NONCE.toString('base64')}</wsse:Nonce>`);
    expect(h).toContain('<wsu:Created>2026-10-30T12:00:00.000Z</wsu:Created><wsu:Expires>2026-10-30T12:05:00.000Z</wsu:Expires>');
    expect(h).toContain('<base:WebServiceClientId>cliente-sintetico</base:WebServiceClientId>');
    expect(h).not.toContain(C.authenticationKey);
  });

  it('el sobre del Echo usa los espacios de nombres del contrato y escapa valores con caracteres especiales', () => {
    const x = echoEnvelope({ ...C, username: 'a<b>&"c' }, { now: AHORA, nonce: NONCE });
    expect(x).toContain('xmlns:echo="http://ec.europa.eu/tracesnt/eudr/echo"');
    expect(x).toContain('xmlns:base="http://ec.europa.eu/sanco/tracesnt/base/v4"');
    expect(x).toContain('<echo:EudrEchoRequest><echo:query>Hello EUDR</echo:query></echo:EudrEchoRequest>');
    expect(x).toContain(xmlEscape('a<b>&"c'));
    expect(x).not.toContain('a<b>');
  });

  it('interpreta OK, fallo de autenticación, otro fallo y respuesta inesperada, sin reproducir valores de la solicitud', () => {
    expect(interpretEcho(200, '<S:Envelope><S:Body><echo:EudrEchoResponse><echo:status>OK</echo:status></echo:EudrEchoResponse></S:Body></S:Envelope>')).toEqual({ outcome: 'OK', httpStatus: 200, detail: null });
    const auth = interpretEcho(500, '<S:Fault><faultstring>Authentication failed</faultstring></S:Fault>');
    expect(auth.outcome).toBe('AUTH_FAILED');
    expect(interpretEcho(401, '').outcome).toBe('AUTH_FAILED');
    expect(interpretEcho(500, '<S:Fault><faultstring>EudrEchoServiceFault</faultstring></S:Fault>').outcome).toBe('FAULT');
    expect(interpretEcho(200, '<html>otra cosa</html>').outcome).toBe('UNEXPECTED_RESPONSE');
    expect(interpretEcho(200, '<echo:status>KO</echo:status>').outcome).toBe('UNEXPECTED_RESPONSE'); // 200 sin «OK» no es conexión acreditada
    const raro = interpretEcho(500, `<faultstring>${C.authenticationKey}<script></faultstring>`);
    expect(JSON.stringify(raro)).not.toContain('<script>');
  });

  it('callEcho envía al endpoint documentado de ACCEPTANCE con su SOAPAction; PRODUCTION no tiene Echo documentado; un fallo de red es UNREACHABLE', async () => {
    const llamadas: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const ok: SoapTransport = async (url, init) => { llamadas.push({ url, headers: init.headers, body: init.body }); return { status: 200, text: '<echo:status>OK</echo:status>' }; };
    expect((await callEcho('ACCEPTANCE', C, ok, { now: AHORA, nonce: NONCE })).outcome).toBe('OK');
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe('https://acceptance.eudr.webcloud.ec.europa.eu/tracesnt/ws/EudrEchoService');
    expect(llamadas[0].headers.SOAPAction).toBe(`"${ECHO_SOAP_ACTION}"`);
    expect(llamadas[0].body).not.toContain(C.authenticationKey);
    expect(ECHO_ENDPOINTS.PRODUCTION).toBeUndefined();
    await expect(callEcho('PRODUCTION', C, ok)).rejects.toThrow('ECHO_NOT_DOCUMENTED_FOR_ENVIRONMENT');
    expect(llamadas).toHaveLength(1); // control: no se envió nada a producción
    const caido: SoapTransport = async () => { throw new Error('ECONNRESET'); };
    expect(await callEcho('ACCEPTANCE', C, caido)).toEqual({ outcome: 'UNREACHABLE', httpStatus: null, detail: null });
  });
});
