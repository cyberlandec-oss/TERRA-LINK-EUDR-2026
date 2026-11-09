import { createServer, connect, type Server, type Socket } from 'net';
import { PASSWORD, REDIS_URL, describeDb, setupHarness } from './helpers';

// Indisponibilidad de Redis: un proxy TCP controlable entre la API y el Redis real permite cortarlo
// y restaurarlo sobre la MISMA instancia de la API (sin reiniciarla).
class TcpProxy {
  private server?: Server;
  private sockets = new Set<Socket>();
  port = 0;
  constructor(private readonly target: { host: string; port: number }) {}

  start(port = 0): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((client) => {
        const upstream = connect(this.target.port, this.target.host);
        for (const s of [client, upstream]) {
          this.sockets.add(s);
          s.on('close', () => this.sockets.delete(s));
          s.on('error', () => s.destroy());
        }
        client.pipe(upstream).pipe(client);
      });
      this.server.listen(port, '127.0.0.1', () => {
        this.port = (this.server!.address() as { port: number }).port;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

describeDb('login con Redis no disponible (fail-closed controlado)', () => {
  const target = new URL(REDIS_URL ?? 'redis://localhost:6379');
  const proxy = new TcpProxy({ host: target.hostname, port: Number(target.port || 6379) });
  let h: Awaited<ReturnType<typeof setupHarness>>;

  beforeAll(async () => {
    await proxy.start();
    h = await setupHarness({ redisUrl: `redis://127.0.0.1:${proxy.port}` });
    await h.user('persona@test.local');
  });
  afterAll(async () => {
    await h?.close();
    await proxy.stop();
  });

  const login = (password = PASSWORD) => h.http().post('/api/v1/auth/login').send({ email: 'persona@test.local', password });

  it('con Redis disponible: ready 200 y login normal', async () => {
    const ready = await h.http().get('/health/ready').expect(200);
    expect(ready.body.checks).toEqual({ database: 'ok', schema: 'ok', redis: 'ok', scanner: 'ok' });
    expect(ready.body.status).toBe('ok');
    await login().expect(200);
  });

  it('Redis caído: login 503 recuperable, sin sesión, distinto de 401/429; readiness señala redis', async () => {
    await proxy.stop();
    const res = await login();
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LOGIN_TEMPORARILY_UNAVAILABLE');
    expect(res.body.error.message).toMatch(/temporalmente/);
    expect(JSON.stringify(res.body)).not.toMatch(/redis|ECONNREFUSED|stack/i);
    expect(res.body.access_token).toBeUndefined();
    expect(res.headers['retry-after']).toBe('30');
    // Ni siquiera con credenciales incorrectas se evalúa la contraseña sin poder aplicar el límite.
    expect((await login('incorrecta')).status).toBe(503);
    const ready = await h.http().get('/health/ready').expect(503);
    expect(ready.body).toMatchObject({ status: 'unavailable', checks: { database: 'ok', schema: 'ok', redis: 'unavailable' } });
  });

  it('Redis recuperado: readiness y login vuelven a funcionar sin reiniciar la API', async () => {
    await proxy.start(proxy.port);
    let ready = 503;
    for (let i = 0; i < 40 && ready !== 200; i++) {
      await new Promise((r) => setTimeout(r, 250));
      ready = (await h.http().get('/health/ready')).status;
    }
    expect(ready).toBe(200);
    await login().expect(200);
    const bad = await login('incorrecta').expect(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});
