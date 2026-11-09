const dbState = {
  cipherVersion: '3.46.1 community' as string | undefined,
  cipherError: false,
  exec: [] as string[],
  close: 0,
};

jest.mock('expo-constants', () => ({
  ExecutionEnvironment: { StoreClient: 'store', Bare: 'bare', Standalone: 'standalone' },
  default: { executionEnvironment: 'bare', expoConfig: { extra: {} } },
}));

jest.mock('expo-crypto', () => ({
  getRandomBytes: () => new Uint8Array(32).fill(7),
  randomUUID: () => 'test-uuid',
  digest: jest.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-file-system', () => ({
  Directory: class Directory {},
  File: class File {},
  Paths: { document: {}, cache: {}, availableDiskSpace: 1 },
  UploadType: { MULTIPART: 'multipart' },
}));

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: async (sql: string) => { dbState.exec.push(sql); },
    getFirstAsync: async () => {
      if (dbState.cipherError) throw new Error('cipher probe failed');
      return dbState.cipherVersion ? { cipher_version: dbState.cipherVersion } : null;
    },
    closeAsync: async () => { dbState.close += 1; },
  })),
}));

import { expoPlatform } from '../expo';

beforeEach(() => {
  dbState.cipherVersion = '3.46.1 community';
  dbState.cipherError = false;
  dbState.exec = [];
  dbState.close = 0;
});

describe('adaptador Expo: compuerta SQLCipher', () => {
  it('permite continuar solo con cipher_version válido', async () => {
    const db = await expoPlatform.openDb('sqlcipher-ok.db');
    expect(await db.cipher()).toBe('ACTIVE');
    expect(dbState.close).toBe(0);
    expect(dbState.exec[0]).toMatch(/PRAGMA key/);
    expect(dbState.exec.some((sql) => sql.includes('foreign_keys'))).toBe(true);
  });

  it.each([
    ['resultado vacío', () => { dbState.cipherVersion = undefined; }],
    ['error de consulta', () => { dbState.cipherError = true; }],
  ])('%s impide devolver una base utilizable y cierra la conexión', async (_label, arrange) => {
    arrange();
    await expect(expoPlatform.openDb('sqlcipher-rejected.db')).rejects.toThrow('SQLCipher requerido');
    expect(dbState.close).toBe(1);
    expect(dbState.exec.some((sql) => sql.includes('foreign_keys'))).toBe(false);
  });
});
