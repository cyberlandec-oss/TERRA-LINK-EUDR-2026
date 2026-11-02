import { LoginRateLimiter, MemoryAttemptStore } from './login-rate-limit';

const policy = { windowSeconds: 60, maxPerAccountAndIp: 3, maxPerAccount: 5, maxPerIp: 8 };

describe('LoginRateLimiter (política)', () => {
  let now = 0;
  const make = () => new LoginRateLimiter(new MemoryAttemptStore(() => now), policy);
  beforeEach(() => {
    now = 1_000_000;
  });

  it('permite el uso normal y bloquea al alcanzar el umbral cuenta+origen', async () => {
    const rl = make();
    for (let i = 0; i < 3; i++) {
      expect((await rl.check('a@x.ec', '1.1.1.1')).allowed).toBe(true);
      await rl.recordFailure('a@x.ec', '1.1.1.1');
    }
    const d = await rl.check('a@x.ec', '1.1.1.1');
    expect(d.allowed).toBe(false);
    expect(d.retryAfterSeconds).toBeGreaterThan(0);
    // Otro origen legítimo sigue pudiendo intentar.
    expect((await rl.check('a@x.ec', '2.2.2.2')).allowed).toBe(true);
  });

  it('el bloqueo es temporal: se recupera al expirar la ventana', async () => {
    const rl = make();
    for (let i = 0; i < 3; i++) await rl.recordFailure('a@x.ec', '1.1.1.1');
    expect((await rl.check('a@x.ec', '1.1.1.1')).allowed).toBe(false);
    now += 61_000;
    expect((await rl.check('a@x.ec', '1.1.1.1')).allowed).toBe(true);
  });

  it('frena ataques distribuidos por cuenta y barridos por origen', async () => {
    const rl = make();
    for (let i = 0; i < 5; i++) await rl.recordFailure('a@x.ec', `10.0.0.${i}`);
    expect((await rl.check('a@x.ec', '10.0.0.99')).allowed).toBe(false);
    for (let i = 0; i < 8; i++) await rl.recordFailure(`u${i}@x.ec`, '9.9.9.9');
    expect((await rl.check('nueva@x.ec', '9.9.9.9')).allowed).toBe(false);
  });

  it('trata igual cuentas existentes e inexistentes y normaliza el email', async () => {
    const rl = make();
    for (let i = 0; i < 3; i++) await rl.recordFailure(' A@X.EC ', '1.1.1.1');
    expect((await rl.check('a@x.ec', '1.1.1.1')).allowed).toBe(false);
  });

  it('un login correcto reinicia el contador cuenta+origen', async () => {
    const rl = make();
    for (let i = 0; i < 2; i++) await rl.recordFailure('a@x.ec', '1.1.1.1');
    await rl.recordSuccess('a@x.ec', '1.1.1.1');
    for (let i = 0; i < 2; i++) await rl.recordFailure('a@x.ec', '1.1.1.1');
    expect((await rl.check('a@x.ec', '1.1.1.1')).allowed).toBe(true);
  });
});
