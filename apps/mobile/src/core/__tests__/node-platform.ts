// Plataforma de prueba en Node: motor SQLite real (node:sqlite) y sistema de archivos real en un directorio temporal.
// Evidencia UNITARIA/de integración en Node: no sustituye el ensayo en Android (expo-sqlite / expo-file-system).
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FileStore, Platform, SqlDb, SqlValue } from '../ports';
import { fixtureJpeg } from '../fixtures';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => { exec(s: string): void; prepare(s: string): { run(...p: SqlValue[]): unknown; all(...p: SqlValue[]): unknown[]; get(...p: SqlValue[]): unknown }; close(): void } };

export function nodeDb(path: string): SqlDb {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  let queue: Promise<unknown> = Promise.resolve();
  let inTx = false;
  // Misma semántica que el adaptador Expo: fuera de una transacción, cada operación espera en la cola; así una llamada a la
  // conexión principal desde dentro de una transacción se bloquearía también aquí (y la prueba lo detectaría).
  const serial = <T>(fn: () => T): Promise<T> => { const p = queue.then(fn, fn); queue = p.catch(() => undefined); return p as Promise<T>; };
  const api = (scoped: boolean): SqlDb => ({
    async exec(s) { return scoped ? db.exec(s) : serial(() => db.exec(s)); },
    async run(s, p = []) { if (scoped) { db.prepare(s).run(...p); return; } await serial(() => { db.prepare(s).run(...p); }); },
    async all<T>(s: string, p: SqlValue[] = []) { return (scoped ? db.prepare(s).all(...p) : await serial(() => db.prepare(s).all(...p))) as T[]; },
    async get<T>(s: string, p: SqlValue[] = []) { return (scoped ? db.prepare(s).get(...p) : await serial(() => db.prepare(s).get(...p))) as T | undefined; },
    async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
      if (scoped || inTx) throw new Error('transacción anidada no admitida');
      const run = async () => {
        inTx = true;
        db.exec('BEGIN IMMEDIATE');
        try { const r = await fn(api(true)); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { inTx = false; }
      };
      const p = queue.then(run, run);
      queue = p.catch(() => undefined);
      return p;
    },
    async close() { db.close(); },
    async cipher() { return 'NONE' as const; },
  });
  return api(false);
}

export function nodeFiles(root: string, opts: { failWriteWith?: () => Error | null; free?: () => number | null } = {}): FileStore {
  const abs = (p: string) => join(root, p);
  return {
    async writeBytes(p, b) { const e = opts.failWriteWith?.(); if (e) throw e; mkdirSync(dirname(abs(p)), { recursive: true }); writeFileSync(abs(p), b); },
    async importFrom(src, p) { const e = opts.failWriteWith?.(); if (e) throw e; mkdirSync(dirname(abs(p)), { recursive: true }); copyFileSync(src, abs(p)); },
    async readExternal(src) { const e = opts.failWriteWith?.(); if (e) throw e; return new Uint8Array(readFileSync(src)); },
    async deleteExternal(src) { rmSync(src, { force: true }); },
    async readBytes(p) { return new Uint8Array(readFileSync(abs(p))); },
    async move(a, b) { mkdirSync(dirname(abs(b)), { recursive: true }); renameSync(abs(a), abs(b)); },
    async exists(p) { return existsSync(abs(p)); },
    async size(p) { return statSync(abs(p)).size; },
    async delete(p) { rmSync(abs(p), { force: true }); },
    async list(d) { return existsSync(abs(d)) ? readdirSync(abs(d)) : []; },
    async ensureDir(d) { mkdirSync(abs(d), { recursive: true }); },
    async freeBytes() { return opts.free ? opts.free() : null; },
  };
}

export function nodePlatform(root: string, opts: Parameters<typeof nodeFiles>[1] & { clock?: () => Date; environment?: Platform['environment'] } = {}): Platform & { secretsMap: Map<string, string> } {
  const secretsMap = new Map<string, string>();
  mkdirSync(join(root, 'db'), { recursive: true });
  return {
    environment: opts.environment ?? 'EXPO_GO_SYNTHETIC',
    openDb: async (name) => nodeDb(join(root, 'db', name)),
    files: nodeFiles(join(root, 'files'), opts),
    secrets: { get: async (k) => secretsMap.get(k) ?? null, set: async (k, v) => { secretsMap.set(k, v); }, delete: async (k) => { secretsMap.delete(k); } },
    secretsMap,
    sha256: async (b) => createHash('sha256').update(b).digest('hex'),
    uuid: () => randomUUID(),
    now: opts.clock ?? (() => new Date()),
  };
}

/** JPEG SINTÉTICO mínimo y válido (el mismo fixture que usa la app en Expo Go). No es una foto. */
export function syntheticJpeg(opts: { exif?: boolean; seed?: string } = {}): Buffer {
  return Buffer.from(fixtureJpeg(opts.seed ?? 'x', !!opts.exif));
}
