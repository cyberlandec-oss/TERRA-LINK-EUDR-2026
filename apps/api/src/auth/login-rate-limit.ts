import { createHash } from 'crypto';
import type Redis from 'ioredis';
import type { LoginRateLimitConfig } from '../config';

// Límite de intentos de login (docs/17 seguridad mínima). Política:
// - Se cuentan solo fallos, en tres contadores con ventana fija: cuenta+origen, cuenta y origen.
// - Al alcanzar un umbral se rechaza con 429 hasta que la ventana expire: el bloqueo es siempre
//   temporal (como máximo `windowSeconds`), nunca permanente, aunque lo provoque un tercero.
// - La cuenta se identifica por el hash del email normalizado exista o no: la respuesta no revela
//   si la cuenta existe.
// - Un login correcto reinicia el contador cuenta+origen.
// - Estado en Redis, compartido entre instancias.

export interface AttemptStore {
  /** Devuelve el conteo actual y el TTL restante (segundos) de cada clave. */
  read(keys: string[]): Promise<Array<{ count: number; ttl: number }>>;
  /** Incrementa cada clave; la primera vez fija la expiración de la ventana. */
  increment(keys: string[], windowSeconds: number): Promise<void>;
  reset(key: string): Promise<void>;
}

export class RedisAttemptStore implements AttemptStore {
  constructor(private readonly redis: Redis, private readonly prefix: string) {}

  async read(keys: string[]) {
    const pipeline = this.redis.multi();
    for (const k of keys) pipeline.get(this.prefix + k).ttl(this.prefix + k);
    const res = (await pipeline.exec()) ?? [];
    return keys.map((_, i) => ({
      count: Number(res[i * 2]?.[1] ?? 0),
      ttl: Math.max(0, Number(res[i * 2 + 1]?.[1] ?? 0)),
    }));
  }

  async increment(keys: string[], windowSeconds: number) {
    const pipeline = this.redis.multi();
    for (const k of keys) pipeline.incr(this.prefix + k).expire(this.prefix + k, windowSeconds, 'NX');
    await pipeline.exec();
  }

  async reset(key: string) {
    await this.redis.del(this.prefix + key);
  }
}

export class MemoryAttemptStore implements AttemptStore {
  private readonly data = new Map<string, { count: number; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  private live(k: string) {
    const v = this.data.get(k);
    if (v && v.expiresAt <= this.now()) {
      this.data.delete(k);
      return undefined;
    }
    return v;
  }

  async read(keys: string[]) {
    return keys.map((k) => {
      const v = this.live(k);
      return { count: v?.count ?? 0, ttl: v ? Math.ceil((v.expiresAt - this.now()) / 1000) : 0 };
    });
  }

  async increment(keys: string[], windowSeconds: number) {
    for (const k of keys) {
      const v = this.live(k);
      if (v) v.count += 1;
      else this.data.set(k, { count: 1, expiresAt: this.now() + windowSeconds * 1000 });
    }
  }

  async reset(key: string) {
    this.data.delete(key);
  }
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class LoginRateLimiter {
  constructor(private readonly store: AttemptStore, private readonly policy: LoginRateLimitConfig) {}

  private keys(email: string, ip: string) {
    const account = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    return {
      pair: `login:pair:${account}:${ip}`,
      account: `login:acct:${account}`,
      ip: `login:ip:${ip}`,
    };
  }

  async check(email: string, ip: string): Promise<RateLimitDecision> {
    const k = this.keys(email, ip);
    const [pair, account, byIp] = await this.store.read([k.pair, k.account, k.ip]);
    const blocked = [
      [pair, this.policy.maxPerAccountAndIp],
      [account, this.policy.maxPerAccount],
      [byIp, this.policy.maxPerIp],
    ].filter(([s, max]) => (s as { count: number }).count >= (max as number));
    if (blocked.length === 0) return { allowed: true, retryAfterSeconds: 0 };
    const retry = Math.max(...blocked.map(([s]) => (s as { ttl: number }).ttl), 1);
    return { allowed: false, retryAfterSeconds: retry };
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    const k = this.keys(email, ip);
    await this.store.increment([k.pair, k.account, k.ip], this.policy.windowSeconds);
  }

  async recordSuccess(email: string, ip: string): Promise<void> {
    await this.store.reset(this.keys(email, ip).pair);
  }
}

export const LOGIN_RATE_LIMITER = Symbol('LOGIN_RATE_LIMITER');
export const REDIS = Symbol('REDIS');
