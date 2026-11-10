import http from 'node:http';
import request from 'supertest';
import { PASSWORD, describeDb, setupHarness } from './helpers';

/**
 * Contrato de frontera: el proxy autorizado reemplaza X-Forwarded-For con la
 * dirección que conoce por la conexión, nunca reenvía el valor del cliente.
 * La publicación de red se verifica aparte en Compose: el API queda en
 * loopback y no se presenta como un puerto de LAN.
 */
describeDb('frontera proxy → bootstrap real', () => {
  it('ignora XFF del cliente y conserva una única IP efectiva detrás del proxy', async () => {
    const h = await setupHarness({
      trustProxy: 1,
      loginRateLimit: { windowSeconds: 60, maxPerAccountAndIp: 1, maxPerAccount: 20, maxPerIp: 20 },
    });
    const email = 'proxy-boundary@test.local';
    await h.user(email);

    const api = await h.app.listen(0, '127.0.0.1');
    const apiAddress = api.address();
    if (!apiAddress || typeof apiAddress === 'string') throw new Error('No se obtuvo el puerto efímero del API');

    // Proxy de ensayo: la IP proviene de la conexión autorizada del proxy; el
    // encabezado enviado por el cliente se descarta deliberadamente.
    const proxy = http.createServer((client, response) => {
      const headers = { ...client.headers, host: `127.0.0.1:${apiAddress.port}`, 'x-forwarded-for': '198.51.100.10' };
      delete headers.connection;
      const upstream = http.request({ hostname: '127.0.0.1', port: apiAddress.port, method: client.method, path: client.url, headers }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on('error', () => response.writeHead(502).end());
      client.pipe(upstream);
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const proxyAddress = proxy.address();
    if (!proxyAddress || typeof proxyAddress === 'string') throw new Error('No se obtuvo el puerto efímero del proxy');

    try {
      const forged = (ip: string) => request(proxy).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email, password: 'incorrecta' });
      await forged('203.0.113.7').expect(401);
      // Cambiar XFF en el cliente no cambia la IP efectiva: el proxy lo reemplaza.
      await forged('203.0.113.8').expect(429);
      await request(h.app.getHttpServer()).post('/api/v1/auth/login').set('X-Forwarded-For', '203.0.113.99').send({ email, password: PASSWORD }).expect(200);
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await new Promise<void>((resolve) => api.close(() => resolve()));
      await h.close();
    }
  });
});
