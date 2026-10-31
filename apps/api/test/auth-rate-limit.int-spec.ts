import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { PASSWORD, describeDb, setupHarness } from './helpers';

// Límite de intentos de login con Redis real: bloqueo temporal, recuperación, no enumeración,
// aislamiento por origen y estado compartido entre instancias.
//
// Control del tiempo (documentado a propósito): NO se usan temporizadores falsos. El limitador se
// apoya en TTL reales de Redis y las pruebas corren contra Redis real.
//  - Las comprobaciones de BLOQUEO usan una ventana amplia (60 s) para que el umbral se alcance por
//    número de intentos y nunca por carrera contra el reloj: antes la ventana era de 2 s y bastaba
//    con que el equipo tardara en calcular los hashes de contraseña para que la ventana venciera y
//    el intento siguiente recibiera un 200 legítimo (fallo observado el 2026-10-13).
//  - La CADUCIDAD se prueba aparte, y espera exactamente el `Retry-After` que anuncia el servidor
//    en lugar de suponer cuánto queda de ventana.
//  - Cada prueba usa su propia cuenta y su propio origen: así los contadores por cuenta y por IP no
//    se acumulan entre pruebas al ampliar la ventana.
// La política de producción (`config.ts`: 900 s, 5 intentos por cuenta+origen) no se toca aquí: estos
// valores son configuración del harness de pruebas.
describeDb('login: límite de intentos (Redis real)', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  const policy = { windowSeconds: 60, maxPerAccountAndIp: 3, maxPerAccount: 10, maxPerIp: 10 };
  const NORMAL = 'rl-normal@test.local';
  const BLOQUEO = 'rl-bloqueo@test.local';
  const ENUM = 'rl-enum@test.local';
  const COMPARTIDO = 'rl-compartido@test.local';
  const CADUCIDAD = 'rl-caducidad@test.local';

  beforeAll(async () => {
    h = await setupHarness({ loginRateLimit: policy, trustProxy: true });
    for (const email of [NORMAL, BLOQUEO, ENUM, COMPARTIDO, CADUCIDAD]) await h.user(email);
  });
  afterAll(async () => h?.close());

  const attempt = (email: string, password: string, ip = '203.0.113.1') =>
    h.http().post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email, password });

  it('funcionamiento normal: credenciales correctas entran y los fallos aislados no bloquean', async () => {
    // Con la ventana amplia, que el tercer fallo no bloquee demuestra de verdad que el éxito reinició
    // el contador cuenta+origen: sin ese reinicio serían 3 fallos dentro de la misma ventana → 429.
    await attempt(NORMAL, 'incorrecta-1').expect(401);
    await attempt(NORMAL, PASSWORD).expect(200);
    await attempt(NORMAL, 'incorrecta-2').expect(401);
    await attempt(NORMAL, 'incorrecta-3').expect(401);
    await attempt(NORMAL, PASSWORD).expect(200);
  });

  it('bloquea tras el umbral incluso con la contraseña correcta; otro origen legítimo no queda bloqueado', async () => {
    for (let i = 0; i < 3; i++) await attempt(BLOQUEO, 'mala', '203.0.113.7').expect(401);
    const blocked = await attempt(BLOQUEO, PASSWORD, '203.0.113.7').expect(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // El bloqueo es por cuenta+origen: el ataque desde 203.0.113.7 no deja fuera a la persona legítima.
    await attempt(BLOQUEO, PASSWORD, '198.51.100.20').expect(200);
  });

  it('la ventana caduca y el acceso se recupera (único control de tiempo: el Retry-After del servidor)', async () => {
    // Segunda instancia con ventana corta sobre la MISMA Redis y la misma base. Umbral 1: solo dos
    // peticiones tienen que caber en la ventana para provocar el bloqueo, de modo que la lentitud del
    // equipo no puede invalidar la prueba. Después se espera el Retry-After anunciado más un margen,
    // en vez de suponer la duración de la ventana.
    const corta = await createApp({ ...h.config, loginRateLimit: { ...policy, windowSeconds: 5, maxPerAccountAndIp: 1 } }, h.db);
    await corta.init();
    try {
      const ip = '203.0.113.120';
      const post = (password: string) =>
        request(corta.getHttpServer()).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email: CADUCIDAD, password });
      await post('mala').expect(401);
      const blocked = await post(PASSWORD).expect(429);
      const retryAfter = Number(blocked.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
      await post(PASSWORD).expect(200);
    } finally {
      await corta.close();
    }
  });

  it('no revela si la cuenta existe: misma respuesta 401 y 429 para cuentas inexistentes', async () => {
    const ip = '203.0.113.50';
    const ghost = await attempt('nadie@test.local', 'x', ip).expect(401);
    const real = await attempt(ENUM, 'x', '203.0.113.51').expect(401);
    expect(ghost.body.error.code).toBe(real.body.error.code);
    expect(ghost.body.error.message).toBe(real.body.error.message);
    await attempt('nadie@test.local', 'x', ip).expect(401);
    await attempt('nadie@test.local', 'x', ip).expect(401);
    const ghostBlocked = await attempt('nadie@test.local', 'x', ip).expect(429);
    expect(ghostBlocked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('el estado es compartido entre instancias de la API', async () => {
    const second = await createApp(h.config, h.db);
    await second.init();
    try {
      const ip = '203.0.113.90';
      for (let i = 0; i < 3; i++) await attempt(COMPARTIDO, 'mala', ip).expect(401);
      await request(second.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: COMPARTIDO, password: PASSWORD })
        .expect(429);
    } finally {
      await second.close();
    }
  });
});
