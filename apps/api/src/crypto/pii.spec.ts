import { randomBytes } from 'crypto';
import { PiiCipher, normalizeDocumentNumber, parsePiiConfig } from './pii';

const key = () => randomBytes(32).toString('base64');

describe('cifrado de identidad (PII)', () => {
  const env = { PII_KEYS: `k1:${key()},k2:${key()}`, PII_ACTIVE_KEY_ID: 'k2', PII_INDEX_KEY: key() };
  const cipher = new PiiCipher(parsePiiConfig(env)!);

  it('cifra con nonce aleatorio y descifra con el mismo contexto', () => {
    const a = cipher.encrypt('1301234567', 'org|p1|document_number');
    const b = cipher.encrypt('1301234567', 'org|p1|document_number');
    expect(a).not.toBe(b);
    expect(a).not.toContain('1301234567');
    expect(a.startsWith('v1.k2.')).toBe(true);
    expect(cipher.decrypt(a, 'org|p1|document_number')).toBe('1301234567');
  });

  it('rechaza el token si se traslada a otro registro o campo, o si se altera', () => {
    const t = cipher.encrypt('099 555 1234', 'org|p1|phone');
    expect(() => cipher.decrypt(t, 'org|p2|phone')).toThrow();
    expect(() => cipher.decrypt(t, 'org|p1|address')).toThrow();
    const parts = t.split('.');
    parts[4] = Buffer.from('manipulado').toString('base64url');
    expect(() => cipher.decrypt(parts.join('.'), 'org|p1|phone')).toThrow();
  });

  it('descifra tokens de una clave anterior tras rotar la activa', () => {
    const k1 = key();
    const old = new PiiCipher(parsePiiConfig({ PII_KEYS: `k1:${k1}`, PII_ACTIVE_KEY_ID: 'k1', PII_INDEX_KEY: env.PII_INDEX_KEY })!);
    const rotated = new PiiCipher(parsePiiConfig({ PII_KEYS: `k1:${k1},k2:${key()}`, PII_ACTIVE_KEY_ID: 'k2', PII_INDEX_KEY: env.PII_INDEX_KEY })!);
    expect(rotated.decrypt(old.encrypt('dato', 'ctx'), 'ctx')).toBe('dato');
  });

  it('índice ciego: determinista por organización, distinto entre organizaciones, normaliza el documento', () => {
    const n = normalizeDocumentNumber(' 130-123.4567 ');
    expect(n).toBe('1301234567');
    expect(cipher.blindIndex('orgA', 'DOC', n)).toBe(cipher.blindIndex('orgA', 'DOC', '1301234567'));
    expect(cipher.blindIndex('orgA', 'DOC', n)).not.toBe(cipher.blindIndex('orgB', 'DOC', n));
  });

  it('valida la configuración de claves', () => {
    expect(parsePiiConfig({})).toBeNull();
    expect(() => parsePiiConfig({ PII_KEYS: 'k1:corta', PII_ACTIVE_KEY_ID: 'k1', PII_INDEX_KEY: key() })).toThrow(/32 bytes/);
    expect(() => parsePiiConfig({ PII_KEYS: `k1:${key()}`, PII_ACTIVE_KEY_ID: 'k9', PII_INDEX_KEY: key() })).toThrow(/PII_ACTIVE_KEY_ID/);
    expect(() => parsePiiConfig({ PII_KEYS: `k1:${key()}` })).toThrow(/juntos/);
  });
});
