import { EgressBlocked, classifyAddress, checkUrl, guardedLookup, redact, type LookupFn } from './egress';

// QA-15: «redirects y URL maliciosa … credencial no sale a destino ajeno». Estas pruebas son de DECISIÓN: no
// abren ninguna conexión, así que comprueban exactamente lo que se permite y lo que no, sin depender de la red.

const HOSTS = ['whisp.openforis.org'];

describe('P0-028 · clasificación de direcciones', () => {
  it('reconoce lo que NUNCA puede ser destino de una llamada del servidor', () => {
    expect(classifyAddress('127.0.0.1')).toBe('LOOPBACK');
    expect(classifyAddress('10.1.2.3')).toBe('PRIVATE');
    expect(classifyAddress('172.16.0.1')).toBe('PRIVATE');
    expect(classifyAddress('172.32.0.1')).toBe('PUBLIC'); // el rango privado termina en 172.31
    expect(classifyAddress('192.168.1.1')).toBe('PRIVATE');
    expect(classifyAddress('169.254.169.254')).toBe('LINK_LOCAL'); // metadatos de nube
    expect(classifyAddress('100.64.0.1')).toBe('CGNAT');
    expect(classifyAddress('224.0.0.1')).toBe('MULTICAST');
    expect(classifyAddress('0.0.0.0')).toBe('UNSPECIFIED');
    expect(classifyAddress('::1')).toBe('LOOPBACK');
    expect(classifyAddress('fd00::1')).toBe('UNIQUE_LOCAL');
    expect(classifyAddress('fe80::1')).toBe('LINK_LOCAL');
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('LOOPBACK'); // IPv4 embebida: se clasifica por la IPv4 real
    expect(classifyAddress('no-es-una-ip')).toBe('RESERVED');
  });

  it('acepta direcciones públicas', () => {
    expect(classifyAddress('8.8.8.8')).toBe('PUBLIC');
    expect(classifyAddress('2606:4700::1')).toBe('PUBLIC');
  });
});

describe('P0-028 · comprobación del destino', () => {
  it('solo https', () => {
    expect(checkUrl('http://whisp.openforis.org/api', HOSTS)).toMatchObject({ ok: false, reason: 'SCHEME_NOT_ALLOWED' });
    expect(checkUrl('file:///etc/passwd', HOSTS)).toMatchObject({ ok: false, reason: 'SCHEME_NOT_ALLOWED' });
  });

  it('rechaza credenciales en la URL, literales IP y puertos ajenos', () => {
    expect(checkUrl('https://usuario:clave@whisp.openforis.org/api', HOSTS)).toMatchObject({ ok: false, reason: 'CREDENTIALS_IN_URL' });
    expect(checkUrl('https://169.254.169.254/latest/meta-data', ['169.254.169.254'])).toMatchObject({ ok: false, reason: 'IP_LITERAL' });
    expect(checkUrl('https://whisp.openforis.org:8443/api', HOSTS)).toMatchObject({ ok: false, reason: 'PORT_NOT_ALLOWED' });
  });

  it('la lista blanca es exacta: un sufijo no autoriza', () => {
    expect(checkUrl('https://whisp.openforis.org.atacante.net/api', HOSTS)).toMatchObject({ ok: false, reason: 'HOST_NOT_ALLOWED' });
    expect(checkUrl('https://otro.openforis.org/api', HOSTS)).toMatchObject({ ok: false, reason: 'HOST_NOT_ALLOWED' });
    expect(checkUrl('https://whisp.openforis.org/api/submit/geojson', HOSTS)).toMatchObject({ ok: true });
    // Punto final y mayúsculas son el mismo host; no son una vía para saltarse la lista.
    expect(checkUrl('https://WHISP.OpenForis.ORG./api', HOSTS)).toMatchObject({ ok: true });
  });

  it('el puerto forma parte de la entrada de la lista: sin puerto solo autoriza el 443', () => {
    // Un proveedor puede publicar otro puerto; entonces se declara en la entrada, no se admite «cualquiera».
    expect(checkUrl('https://api.ejemplo.com:8443/x', ['api.ejemplo.com'])).toMatchObject({ ok: false, reason: 'PORT_NOT_ALLOWED' });
    expect(checkUrl('https://api.ejemplo.com:8443/x', ['api.ejemplo.com:8443'])).toMatchObject({ ok: true });
    expect(checkUrl('https://api.ejemplo.com/x', ['api.ejemplo.com:8443'])).toMatchObject({ ok: false, reason: 'PORT_NOT_ALLOWED' });
    // Declarar un puerto para un host no autoriza otro host.
    expect(checkUrl('https://otra.ejemplo.com:8443/x', ['api.ejemplo.com:8443'])).toMatchObject({ ok: false, reason: 'HOST_NOT_ALLOWED' });
  });

  it('una URL malformada no se interpreta', () => {
    expect(checkUrl('no es una url', HOSTS)).toMatchObject({ ok: false, reason: 'MALFORMED_URL' });
  });
});

describe('P0-028 · resolución DNS comprobada al conectar', () => {
  const fakeLookup = (addresses: Array<{ address: string; family: number }> | null, err?: Error): LookupFn =>
    ((_h: string, _o: unknown, cb: (...a: unknown[]) => void) => (err ? cb(err) : cb(null, addresses ?? []))) as unknown as LookupFn;

  const resolve = (lookup: LookupFn) =>
    new Promise<{ err: unknown; result?: unknown }>((done) => {
      (guardedLookup(lookup) as unknown as (h: string, o: unknown, c: (...a: unknown[]) => void) => void)(
        'whisp.openforis.org', { all: true }, (err: unknown, result: unknown) => done({ err, result }),
      );
    });

  it('un nombre de la lista blanca que resuelve a una dirección interna se bloquea (DNS rebinding)', async () => {
    const { err } = await resolve(fakeLookup([{ address: '10.0.0.5', family: 4 }]));
    expect(err).toBeInstanceOf(EgressBlocked);
    expect((err as EgressBlocked).reason).toBe('PRIVATE_ADDRESS');
  });

  it('basta UNA dirección interna entre varias para bloquear', async () => {
    const { err } = await resolve(fakeLookup([{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }]));
    expect((err as EgressBlocked).reason).toBe('PRIVATE_ADDRESS');
  });

  it('sin direcciones o con fallo de DNS no se conecta', async () => {
    expect(((await resolve(fakeLookup([]))).err as EgressBlocked).reason).toBe('DNS_FAILED');
    expect(((await resolve(fakeLookup(null, new Error('nxdomain')))).err as EgressBlocked).reason).toBe('DNS_FAILED');
  });

  it('direcciones públicas pasan', async () => {
    const { err, result } = await resolve(fakeLookup([{ address: '8.8.8.8', family: 4 }]));
    expect(err).toBeNull();
    expect(result).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });
});

describe('P0-028 · redacción de credenciales', () => {
  it('sustituye el secreto en cualquier texto que se conserve', () => {
    const secret = 'clave-de-prueba-123';
    expect(redact(`fallo con x-api-key=${secret} en el destino`, [secret])).toBe('fallo con x-api-key=[REDACTADO] en el destino');
  });

  it('no intenta redactar cadenas triviales (evita destruir el texto)', () => {
    expect(redact('error 500 en el proveedor', ['a'])).toBe('error 500 en el proveedor');
  });
});
