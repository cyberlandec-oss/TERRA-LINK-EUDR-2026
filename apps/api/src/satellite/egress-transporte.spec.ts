import { TlsFixture, loopbackLookup, tlsAvailable, type Controlled } from '../../test/tls-fixture';
import { EgressBlocked, guardedLookup, requestExternal } from './egress';

// P0-028 · QA-15, NIVEL 2: el TRANSPORTE con servidores controlados.
//
// `egress.spec.ts` comprueba las decisiones puras (URL, direcciones, redacción). Eso no demuestra que la
// política se aplique de verdad al conectar. Aquí se levantan dos servidores HTTPS reales en el equipo —uno
// en la lista blanca y otro NO— y se comprueba contra sockets de verdad:
//   · un host fuera de la lista no abre ninguna conexión (el servidor prohibido no registra ninguna petición);
//   · la comprobación de direcciones la aplica el propio transporte, no una función suelta;
//   · una redirección NO se sigue y el destino de la redirección NO recibe la credencial;
//   · el tope de tamaño y el plazo cortan la llamada.
//
// Lo que sigue SIN estar cubierto: una llamada contra un proveedor externo real. No hay proveedor autorizado
// (D-09 parte B) y no se envían geometrías ni se usan claves reales. Queda declarado como pendiente.

const describeTls = tlsAvailable ? describe : describe.skip;

describeTls('P0-028 · QA-15 nivel 2: el transporte aplica la política (servidores controlados)', () => {
  let tls: TlsFixture;
  let destino: Controlled;
  let prohibido: Controlled;
  const TIMEOUT = 4000;
  const MAX = 64 * 1024;

  beforeAll(async () => {
    tls = new TlsFixture();
    prohibido = await tls.listen((_r, res) => { res.writeHead(200); res.end('no deberia recibir nada'); });
    destino = await tls.listen((r, res) => {
      if (r.url.startsWith('/redirige')) { res.writeHead(302, { location: `https://prohibido.prueba.local:${prohibido.port}/robado` }); return res.end(); }
      if (r.url.startsWith('/grande')) { res.writeHead(200); return res.end(Buffer.alloc(MAX * 2, 0x61)); }
      if (r.url.startsWith('/lento')) { res.writeHead(200); return; } // nunca cierra: vence el plazo
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  afterAll(async () => tls?.close());
  beforeEach(() => { destino.recibidas.length = 0; prohibido.recibidas.length = 0; });

  const lista = () => [`destino.prueba.local:${destino.port}`];
  const llamar = (path: string, extra: Partial<Parameters<typeof requestExternal>[0]> = {}) =>
    requestExternal({ url: `https://destino.prueba.local:${destino.port}${path}`, allowedHosts: lista(), timeoutMs: TIMEOUT, maxBytes: MAX, lookup: loopbackLookup, ca: tls.ca, ...extra });

  it('una respuesta conforme llega completa y la credencial solo viaja al destino autorizado', async () => {
    const res = await llamar('/ok', { headers: { 'x-api-key': 'credencial-de-prueba-xyz' } });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.toString('utf8'))).toEqual({ ok: true });
    expect(destino.recibidas).toHaveLength(1);
    expect(destino.recibidas[0].headers['x-api-key']).toBe('credencial-de-prueba-xyz');
    expect(prohibido.recibidas).toHaveLength(0);
  });

  it('un host fuera de la lista NO abre ninguna conexión: el servidor prohibido no registra nada', async () => {
    await expect(requestExternal({
      url: `https://prohibido.prueba.local:${prohibido.port}/robado`, allowedHosts: lista(),
      headers: { 'x-api-key': 'credencial-de-prueba-xyz' }, timeoutMs: TIMEOUT, maxBytes: MAX, lookup: loopbackLookup, ca: tls.ca,
    })).rejects.toMatchObject({ reason: 'HOST_NOT_ALLOWED' });
    expect(prohibido.recibidas).toHaveLength(0);
    expect(destino.recibidas).toHaveLength(0);
  });

  it('el mismo host en otro puerto tampoco conecta: el puerto forma parte de la entrada de la lista', async () => {
    await expect(requestExternal({
      url: `https://destino.prueba.local:${destino.port + 1}/ok`, allowedHosts: lista(),
      timeoutMs: TIMEOUT, maxBytes: MAX, lookup: loopbackLookup, ca: tls.ca,
    })).rejects.toMatchObject({ reason: 'PORT_NOT_ALLOWED' });
    expect(destino.recibidas).toHaveLength(0);
  });

  it('la comprobación de direcciones la aplica el TRANSPORTE: un host de la lista que resuelve a loopback no conecta', async () => {
    // Sin `lookup` inyectado: resolución real de «localhost» → 127.0.0.1, que la defensa rechaza al conectar.
    // El servidor existe y responde, así que si la defensa no estuviera aplicada, la llamada tendría éxito.
    await expect(requestExternal({
      url: `https://localhost:${destino.port}/ok`, allowedHosts: [`localhost:${destino.port}`],
      headers: { 'x-api-key': 'credencial-de-prueba-xyz' }, timeoutMs: TIMEOUT, maxBytes: MAX, ca: tls.ca,
      lookup: guardedLookup(),
    })).rejects.toMatchObject({ reason: 'PRIVATE_ADDRESS' });
    expect(destino.recibidas).toHaveLength(0);
  });

  it('una redirección no se sigue y su destino NO recibe la credencial', async () => {
    await expect(llamar('/redirige', { headers: { 'x-api-key': 'credencial-de-prueba-xyz' } }))
      .rejects.toMatchObject({ reason: 'REDIRECT_NOT_FOLLOWED' });
    // Exactamente una petición, al destino autorizado; el destino de la redirección no recibe nada.
    expect(destino.recibidas).toHaveLength(1);
    expect(destino.recibidas[0].url).toBe('/redirige');
    expect(prohibido.recibidas).toHaveLength(0);
    expect(prohibido.recibidas.some((r) => JSON.stringify(r.headers).includes('credencial-de-prueba'))).toBe(false);
  });

  it('una respuesta mayor que el tope se corta en vez de cargarse entera', async () => {
    await expect(llamar('/grande')).rejects.toMatchObject({ reason: 'RESPONSE_TOO_LARGE' });
  });

  it('un destino que no responde vence por plazo y no deja la llamada abierta', async () => {
    const err = await llamar('/lento', { timeoutMs: 800 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(EgressBlocked);
    expect((err as { code?: string }).code).toBe('ETIMEDOUT');
  });
});
