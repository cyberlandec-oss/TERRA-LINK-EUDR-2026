// VISTA PREVIA WEB de la aplicación móvil (solo para inspeccionar diseño y navegación en el navegador).
// Metro elige este archivo en lugar de `expo.ts` al compilar para web; el build Android NO lo incluye y conserva SQLCipher.
// - Base local: SQLite en memoria del navegador (sql.js, sin cifrado), persistida en localStorage solo para sobrevivir a
//   una recarga de la vista previa. No es el almacén protegido del dispositivo.
// - Servidor: SIMULADO dentro del navegador (`apiFetch`). Ninguna petición llega a la API de Terra Link: no hay datos
//   reales, ni siquiera de organizaciones DEMO. Las cuentas son sintéticas (dominio reservado `.invalid`).
// - Fotos y ubicación: fixtures sintéticas (las mismas que Expo Go).
import initSqlJs, { type Database } from 'sql.js/dist/sql-asm.js';
import type { FetchLike } from '../app/session-manager';
import type { FileStore, Platform, RuntimeEnvironment, SecretStore, SqlDb, SqlValue } from '../core/ports';

export const runtimeEnvironment: RuntimeEnvironment = 'WEB_PREVIEW_SYNTHETIC';
export type EncryptionStatus = 'SQLCIPHER_ACTIVE' | 'NOT_AVAILABLE_IN_THIS_BUILD' | 'UNKNOWN';
export const encryptionStatus = (): EncryptionStatus => 'NOT_AVAILABLE_IN_THIS_BUILD';
export const appVariant = 'VISTA_PREVIA_WEB';
export const PREVIEW_DOMAIN = 'vista-previa.invalid';

const LS = 'tlprev.';
const lsGet = (k: string): string | null => { try { return globalThis.localStorage?.getItem(LS + k) ?? null; } catch { return null; } };
const lsSet = (k: string, v: string) => { try { globalThis.localStorage?.setItem(LS + k, v); } catch { /* sin almacenamiento: queda en memoria */ } };
const lsDel = (k: string) => { try { globalThis.localStorage?.removeItem(LS + k); } catch { /* idem */ } };
const toB64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const hexOf = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
const uuid = () => globalThis.crypto.randomUUID();

let sqlLib: Awaited<ReturnType<typeof initSqlJs>> | null = null;
async function sqlJs() { sqlLib ??= await initSqlJs(); return sqlLib; }

function wrap(db: Database, persist: () => void): SqlDb {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T> | T): Promise<T> => { const p = queue.then(fn, fn); queue = p.catch(() => undefined); return p as Promise<T>; };
  const rows = <T>(sql: string, p: SqlValue[]): T[] => {
    const st = db.prepare(sql); st.bind(p as never); const out: T[] = [];
    while (st.step()) out.push(st.getAsObject() as T);
    st.free(); return out;
  };
  const raw = (scoped: boolean): SqlDb => ({
    exec: (sql) => (scoped ? Promise.resolve(void db.exec(sql)) : serial(() => { db.exec(sql); persist(); })),
    run: (sql, p = []) => (scoped ? Promise.resolve(void db.run(sql, p as never)) : serial(() => { db.run(sql, p as never); persist(); })),
    all: <T>(sql: string, p: SqlValue[] = []) => (scoped ? Promise.resolve(rows<T>(sql, p)) : serial(() => rows<T>(sql, p))),
    get: <T>(sql: string, p: SqlValue[] = []) => (scoped ? Promise.resolve(rows<T>(sql, p)[0]) : serial(() => rows<T>(sql, p)[0])),
    transaction: <T>(fn: (tx: SqlDb) => Promise<T>) => {
      if (scoped) throw new Error('transacción anidada no admitida');
      return serial(async () => {
        db.exec('BEGIN IMMEDIATE');
        try { const r = await fn(raw(true)); db.exec('COMMIT'); persist(); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* ya revertida */ } throw e; }
      });
    },
    close: () => serial(() => { persist(); db.close(); }),
    cipher: async () => 'NONE' as const,
  });
  return raw(false);
}

async function openDb(name: string): Promise<SqlDb> {
  const SQL = await sqlJs();
  const saved = lsGet(`db.${name}`);
  const db = new SQL.Database(saved ? fromB64(saved) : undefined);
  db.exec('PRAGMA foreign_keys = ON;');
  return wrap(db, () => lsSet(`db.${name}`, toB64(db.export())));
}

const mem = new Map<string, Uint8Array>();
export const expoFiles: FileStore = {
  async writeBytes(p, b) { mem.set(p, b); },
  async importFrom(src, p) { const b = mem.get(src); if (!b) throw new Error('archivo de origen inexistente'); mem.set(p, b); },
  async readExternal(src) { const b = mem.get(src); if (!b) throw new Error('archivo de origen inexistente'); return b; },
  async deleteExternal(src) { mem.delete(src); },
  async readBytes(p) { const b = mem.get(p); if (!b) throw new Error('archivo inexistente'); return b; },
  async move(a, b) { const v = mem.get(a); if (v) { mem.set(b, v); mem.delete(a); } },
  async exists(p) { return mem.has(p); },
  async size(p) { return mem.get(p)?.length ?? 0; },
  async delete(p) { mem.delete(p); },
  async list(d) { const pre = d.endsWith('/') ? d : `${d}/`; return [...mem.keys()].filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length)); },
  async ensureDir() { /* sin directorios */ },
  async freeBytes() { return previewState().storageFull ? 1024 : null; },
};

export const expoSecrets: SecretStore = {
  get: async (k) => lsGet(`secret.${k}`),
  set: async (k, v) => lsSet(`secret.${k}`, v),
  delete: async (k) => lsDel(`secret.${k}`),
};

export const expoPlatform: Platform = {
  environment: runtimeEnvironment,
  openDb,
  files: expoFiles,
  secrets: expoSecrets,
  sha256: async (b) => hexOf(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(b))),
  uuid,
  now: () => new Date(),
};

export function writeCacheFile(bytes: Uint8Array, name: string): string { const uri = `mem://cache/${name}`; mem.set(uri, bytes); return uri; }
export function cleanupCacheTemps(): number { let n = 0; for (const k of [...mem.keys()]) if (/^mem:\/\/cache\/(tl-upload-|fixture-)/.test(k)) { mem.delete(k); n += 1; } return n; }
export async function probeEncryption() { return { active: false, version: null as string | null }; }
export async function protectedStorageInventory() { return { documentos: [...mem.keys()], bases: [], secretos_presentes: {} }; }

// ── Servidor SIMULADO (escenarios para revisar estados de la interfaz) ─────────────────────────────────────────────
export type PreviewScenario = 'NORMAL' | 'OFFLINE' | 'CONFLICT_NEXT' | 'DEVICE_REVOKED';
interface PreviewState { scenario: PreviewScenario; storageFull: boolean; versions: Record<string, number>; accepted: string[] }
const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const PLOTS = [
  ['VP-PAR-001', 'Lote El Guabo (sintético)', 'Productora sintética A'],
  ['VP-PAR-002', 'Lote La Esperanza (sintético)', 'Productor sintético B'],
  ['VP-PAR-003', null, 'Asociación sintética C con un nombre deliberadamente largo para revisar el ajuste de texto'],
] as const;
const plotId = (i: number) => `00000000-0000-4000-8000-00000000010${i}`;

export function previewState(): PreviewState {
  const raw = lsGet('server');
  const base: PreviewState = { scenario: 'NORMAL', storageFull: false, versions: Object.fromEntries(PLOTS.map((_, i) => [plotId(i), 3])), accepted: [] };
  try { return raw ? { ...base, ...JSON.parse(raw) as Partial<PreviewState> } : base; } catch { return base; }
}
const saveState = (s: PreviewState) => lsSet('server', JSON.stringify(s));
export function setPreviewScenario(scenario: PreviewScenario) { saveState({ ...previewState(), scenario }); }
export function setPreviewStorageFull(storageFull: boolean) { saveState({ ...previewState(), storageFull }); }
/** Fuerza el vencimiento de la sesión SIMULADA (para revisar el estado «sesión vencida»). */
export async function expirePreviewSession() {
  const raw = lsGet('secret.tl.session.data'); if (!raw) return;
  const s = JSON.parse(raw) as { token_expires_at: string };
  s.token_expires_at = new Date(Date.now() - 60_000).toISOString();
  lsSet('secret.tl.session.data', JSON.stringify(s));
}
/** Borra todo lo de la vista previa (base, secretos y servidor simulado) en este navegador. */
export function resetPreview() { try { for (const k of Object.keys(globalThis.localStorage ?? {})) if (k.startsWith(LS)) globalThis.localStorage.removeItem(k); } catch { /* nada */ } mem.clear(); }

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const err = (status: number, code: string, message: string) => json(status, { error: { code, message } });

export const apiFetch: FetchLike | undefined = async (url, init) => {
  await new Promise((r) => setTimeout(r, 350)); // estado de carga visible
  const st = previewState();
  if (st.scenario === 'OFFLINE') throw new Error('sin red (simulado)');
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : {};
  if (path === '/api/v1/auth/login') {
    if (typeof body.email !== 'string' || !body.email.endsWith(`@${PREVIEW_DOMAIN}`) || !body.password) return err(401, 'INVALID_CREDENTIALS', `Vista previa: usa una cuenta sintética @${PREVIEW_DOMAIN} y cualquier contraseña (no se guarda).`);
    lsSet('server.email', body.email);
    return json(200, { access_token: `${b64url({ alg: 'none' })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 3600, sub: 'vista-previa' })}.SIMULADO` });
  }
  if (path === '/api/v1/me') return json(200, { id: '00000000-0000-4000-8000-0000000000u1', email: lsGet('server.email') ?? `tecnico@${PREVIEW_DOMAIN}` });
  if (path === '/api/v1/me/permissions') return json(200, { organizations: [{ organization_id: ORG_ID, organization_status: 'ACTIVE', roles: ['TECNICO_CAMPO'], permissions: ['plot:read', 'plot:update_assigned'] }] });
  if (path === '/api/v1/organizations') return json(200, [{ id: ORG_ID, name: 'VISTA PREVIA · Cooperativa sintética' }]);
  if (st.scenario === 'DEVICE_REVOKED' && path.includes('/sync/')) return err(403, 'DEVICE_REVOKED', 'Este dispositivo fue revocado: no puede enviar ni recibir datos. Tus capturas locales se conservan; contacta al administrador.');
  if (path.endsWith('/devices')) return json(201, { device: { id: '00000000-0000-4000-8000-0000000000d1' } });
  if (path.endsWith('/sync/pull')) {
    return json(200, { cursor: `c-${Date.now()}`, full: true, tombstones: [], changes: PLOTS.map(([code, name, producer], i) => ({ id: plotId(i), plot_code: code, name, row_version: st.versions[plotId(i)], status: 'ACTIVE', producer_id: `00000000-0000-4000-8000-00000000020${i}`, producer_code: `VP-PR-00${i + 1}`, producer_display_name: producer, geometry_status: 'DRAFT' })) });
  }
  if (path.endsWith('/sync/push')) {
    const ops = (body.operations ?? []) as Array<{ operation_id: string; operation_type: string; base_version: number | null; payload: { plot_id?: string } }>;
    let conflictLeft = st.scenario === 'CONFLICT_NEXT';
    const results = ops.map((o) => {
      if (st.accepted.includes(o.operation_id)) return { operation_id: o.operation_id, status: 'DUPLICATE', result: null };
      const pid = o.payload.plot_id;
      if (o.operation_type === 'PLOT_LOCATION_SAMPLE_CREATE' && pid) {
        if (conflictLeft) { conflictLeft = false; st.versions[pid] = (st.versions[pid] ?? 3) + 1; }
        if (o.base_version !== null && o.base_version !== st.versions[pid]) {
          return { operation_id: o.operation_id, status: 'CONFLICT', error: { code: 'VERSION_CONFLICT', message: 'La parcela cambió mientras capturabas (simulado). Tu muestra se conserva: recarga y vuelve a guardarla.', details: { server_row_version: st.versions[pid] } } };
        }
      }
      st.accepted.push(o.operation_id);
      return { operation_id: o.operation_id, status: 'ACCEPTED', result: { simulated: true } };
    });
    saveState({ ...st, scenario: st.scenario === 'CONFLICT_NEXT' ? 'NORMAL' : st.scenario });
    return json(200, { results });
  }
  return err(404, 'NOT_FOUND', 'Ruta no simulada en la vista previa.');
};

/** Subida SIMULADA: el archivo no sale del navegador; queda «análisis pendiente» como en el servidor real. */
export async function expoUploader(url: string): Promise<{ status: number; body: string }> {
  await new Promise((r) => setTimeout(r, 350));
  if (previewState().scenario === 'OFFLINE') throw new Error('sin red (simulado)');
  if (previewState().scenario === 'DEVICE_REVOKED') return { status: 403, body: JSON.stringify({ error: { code: 'DEVICE_REVOKED', message: 'Dispositivo revocado (simulado).' } }) };
  void url;
  return { status: 201, body: JSON.stringify({ attachment: { status: 'PENDING_SCAN', note: 'Simulado: sin análisis real' } }) };
}
