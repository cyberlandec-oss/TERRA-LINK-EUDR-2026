import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

// Cifrado de datos personales en reposo (doc 06: «identidad cifrada/restringida»).
// - AES-256-GCM por campo con AAD = contexto (organización, registro, campo): un texto cifrado no puede
//   trasladarse a otra fila o campo sin que falle la autenticación.
// - Llavero versionado: PII_KEYS="k1:<base64 32 bytes>,k2:…" y PII_ACTIVE_KEY_ID; se cifra con la activa y
//   se descifra con la indicada en el token (permite rotar sin reescribir todo de inmediato).
// - Índice ciego: HMAC-SHA256 con PII_INDEX_KEY (clave distinta) sobre el valor normalizado, para búsqueda
//   exacta y detección de coincidencias sin descifrar.
// Las claves nunca se versionan ni se registran. Formato del token: v1.<kid>.<iv>.<tag>.<ciphertext>.

export interface PiiKeyConfig {
  keys: Record<string, Buffer>;
  activeKeyId: string;
  indexKey: Buffer;
}

function decodeKey(name: string, b64: string): Buffer {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error(`${name}: la clave debe tener 32 bytes en base64`);
  return key;
}

export function parsePiiConfig(env: NodeJS.ProcessEnv): PiiKeyConfig | null {
  if (!env.PII_KEYS && !env.PII_ACTIVE_KEY_ID && !env.PII_INDEX_KEY) return null;
  if (!env.PII_KEYS || !env.PII_ACTIVE_KEY_ID || !env.PII_INDEX_KEY) {
    throw new Error('Definir juntos PII_KEYS, PII_ACTIVE_KEY_ID y PII_INDEX_KEY');
  }
  const keys: Record<string, Buffer> = {};
  for (const part of env.PII_KEYS.split(',')) {
    const [kid, b64] = part.split(':');
    if (!kid || !b64 || !/^[A-Za-z0-9_-]{1,20}$/.test(kid)) throw new Error('PII_KEYS: formato kid:base64[,kid:base64]');
    keys[kid] = decodeKey(`PII_KEYS[${kid}]`, b64);
  }
  if (!keys[env.PII_ACTIVE_KEY_ID]) throw new Error('PII_ACTIVE_KEY_ID no está en PII_KEYS');
  return { keys, activeKeyId: env.PII_ACTIVE_KEY_ID, indexKey: decodeKey('PII_INDEX_KEY', env.PII_INDEX_KEY) };
}

export class PiiCipher {
  constructor(private readonly cfg: PiiKeyConfig) {}

  encrypt(plain: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.cfg.keys[this.cfg.activeKeyId], iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', this.cfg.activeKeyId, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
  }

  decrypt(token: string, aad: string): string {
    const [v, kid, iv, tag, ct] = token.split('.');
    const key = this.cfg.keys[kid];
    if (v !== 'v1' || !key || !iv || !tag || ct === undefined) throw new Error('PII: token no válido o clave desconocida');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }

  encryptNullable(plain: string | null | undefined, aad: string): string | null {
    return plain == null ? null : this.encrypt(plain, aad);
  }

  decryptNullable(token: string | null | undefined, aad: string): string | null {
    return token == null ? null : this.decrypt(token, aad);
  }

  /** Índice ciego determinista por organización y tipo de dato. */
  blindIndex(organizationId: string, kind: string, normalized: string): string {
    return createHmac('sha256', this.cfg.indexKey).update(`${organizationId}|${kind}|${normalized}`).digest('hex');
  }
}

/** Normalización del número de documento para comparar: mayúsculas, sin espacios, puntos ni guiones. */
export const normalizeDocumentNumber = (v: string) => v.toUpperCase().replace(/[\s.\-]/g, '');
export const normalizeDocumentType = (v: string) => v.trim().toUpperCase();

/** Contextos (AAD) del productor y de cada versión de su historial. */
export const producerAad = (org: string, id: string, field: string) => `producer|${org}|${id}|${field}`;
export const versionAad = (org: string, id: string, version: string | number, field: string) => `producer_version|${org}|${id}|${version}|${field}`;

export const PII_CIPHER = Symbol('PII_CIPHER');
