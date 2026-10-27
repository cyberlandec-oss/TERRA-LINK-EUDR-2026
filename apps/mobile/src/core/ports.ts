// P0-023 Captura offline: puertos de plataforma. El núcleo (src/core) no importa Expo: así las transacciones, la
// recuperación y los fallos de almacenamiento se prueban con un motor SQLite real (node:sqlite) y un sistema de
// archivos real en Node, y en el dispositivo con expo-sqlite / expo-file-system / expo-secure-store (src/adapters/expo.ts).
// Esa diferencia se declara en la evidencia: una prueba en Node no es una prueba en Android.

export type SqlValue = string | number | null | Uint8Array;

export interface SqlDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  /** Transacción exclusiva: solo las sentencias del callback entran en ella; un error revierte todo. */
  transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** Cifrado real de la base, medido tras abrirla (PRAGMA cipher_version con SQLCipher). */
  cipher(): Promise<'ACTIVE' | 'NONE'>;
}

/** Rutas relativas a un directorio persistente de la app (nunca la caché que el sistema puede vaciar). */
export interface FileStore {
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  /** Copia desde una URI/ruta externa (p. ej. la caché temporal de la cámara) hacia una ruta persistente. */
  importFrom(sourceUri: string, path: string): Promise<void>;
  /** Lee bytes de una URI externa (caché temporal de la cámara) sin copiarla a otro archivo. */
  readExternal(sourceUri: string): Promise<Uint8Array>;
  /** Borra (mejor esfuerzo) un archivo externo temporal, p. ej. la copia de la cámara en caché. */
  deleteExternal(sourceUri: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  move(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
  delete(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  ensureDir(dir: string): Promise<void>;
  /** Bytes libres si la plataforma lo informa; null si no se conoce. */
  freeBytes(): Promise<number | null>;
}

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Entorno de ejecución:
 * - EXPO_GO_SYNTHETIC: Expo Go, sin SQLCipher. Solo para pruebas limitadas con datos SINTÉTICOS (organizaciones DEMO).
 * - WEB_PREVIEW_SYNTHETIC: vista previa web en el navegador (diseño y navegación), base en memoria sin cifrado, servidor
 *   SIMULADO y fixtures sintéticas. No admite datos reales ni contacta la API.
 * - NATIVE_BUILD: build nativo destinado al ensayo de aceptación. Exige cifrado: si no se inicializa, no se descarga ni
 *   se escribe el dataset protegido (no se continúa en silencio con SQLite sin cifrar).
 */
export type RuntimeEnvironment = 'EXPO_GO_SYNTHETIC' | 'WEB_PREVIEW_SYNTHETIC' | 'NATIVE_BUILD';

export interface Platform {
  environment: RuntimeEnvironment;
  openDb(name: string): Promise<SqlDb>;
  files: FileStore;
  secrets: SecretStore;
  sha256(bytes: Uint8Array): Promise<string>;
  uuid(): string;
  now(): Date;
}

/** Error de almacenamiento lleno (ENOSPC u homólogo de la plataforma). */
export class StorageFullError extends Error {
  constructor(message = 'Almacenamiento insuficiente en el dispositivo.') { super(message); this.name = 'StorageFullError'; }
}

export function isStorageFull(err: unknown): boolean {
  if (err instanceof StorageFullError) return true;
  const e = err as { code?: string; message?: string };
  return e?.code === 'ENOSPC' || /ENOSPC|No space left|SQLITE_FULL|database or disk is full|insufficient storage/i.test(e?.message ?? '');
}

/** Texto para el usuario ante almacenamiento lleno: nunca el mensaje técnico de la plataforma (p. ej. de SQLite, en inglés). */
export function storageFullMessage(err: unknown): string {
  return err instanceof StorageFullError ? err.message : 'No hay espacio libre en el dispositivo para guardar este cambio. Lo ya guardado se conserva: libera espacio y vuelve a intentarlo.';
}

/** El build de aceptación no pudo inicializar el cifrado de la base: no se abre el almacén protegido. */
export class EncryptionRequiredError extends Error {
  constructor() { super('No se pudo inicializar el cifrado de la base local (SQLCipher). Por seguridad no se descargan ni guardan datos en este dispositivo. Reinstala el build de aceptación o contacta a soporte.'); this.name = 'EncryptionRequiredError'; }
}
