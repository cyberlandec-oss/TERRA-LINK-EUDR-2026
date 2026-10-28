import type { Platform } from '../core/ports';
import { accountKey, captureGate, jwtExpiry, type StoredSession } from '../core/session';
import { LocalStore } from '../core/store';
import { SERVER_URL_HELP, validateServerUrl } from '../core/server-url';
import { syncOnce, type SyncSummary } from '../core/sync';
import { httpTransport, type Uploader } from './transport';

// Sesión del dispositivo (P0-023). Inicio de sesión SOLO con conexión; el token vive en almacenamiento seguro y nunca
// se renueva sin red. Cerrar sesión elimina token y sesión, pero NO las bases ni adjuntos por cuenta: las capturas
// pendientes quedan para esa misma cuenta y organización (otra cuenta abre su propio almacén y no las ve).
// device_id: identificador local generado una vez; describe el dispositivo pero NO autoriza nada (el contrato de
// dispositivo y su registro/revocación en servidor son de P0-024).

const K = { token: 'tl.session.token', session: 'tl.session.data', device: 'tl.device.id', apiUrl: 'tl.api.url' };

export class ApiFailure extends Error {
  constructor(readonly kind: 'NETWORK' | 'HTTP', readonly status: number | null, message: string, readonly code?: string) { super(message); }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

async function http<T>(f: FetchLike, apiUrl: string, path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await f(`${apiUrl.replace(/\/$/, '')}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  } catch {
    throw new ApiFailure('NETWORK', null, 'Sin conexión con el servidor. El inicio de sesión requiere conexión; tus capturas guardadas se conservan.');
  }
  const data = await res.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) throw new ApiFailure('HTTP', res.status, data?.error?.message ?? `Error ${res.status}`, data?.error?.code);
  return data as T;
}

export class SessionManager {
  constructor(private readonly p: Platform, private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i)) {}

  async deviceId(): Promise<string> {
    let id = await this.p.secrets.get(K.device);
    if (!id) { id = this.p.uuid(); await this.p.secrets.set(K.device, id); }
    return id;
  }
  async apiUrl(fallback: string) { return (await this.p.secrets.get(K.apiUrl)) ?? fallback; }

  async load(): Promise<StoredSession | null> {
    const raw = await this.p.secrets.get(K.session);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    const now = this.p.now().toISOString();
    if (now > s.last_seen_at) { s.last_seen_at = now; await this.p.secrets.set(K.session, JSON.stringify(s)); }
    return s;
  }
  async token() { return this.p.secrets.get(K.token); }

  async login(apiUrl: string, email: string, password: string): Promise<StoredSession> {
    const checked = validateServerUrl(apiUrl);
    if (!checked.ok) throw new ApiFailure('HTTP', null, SERVER_URL_HELP, 'SERVER_URL_INVALID'); // nunca se usa ni se guarda
    apiUrl = checked.url;
    const t = await http<{ access_token: string }>(this.fetchImpl, apiUrl, '/api/v1/auth/login', { method: 'POST', body: { email, password } });
    const me = await http<{ id: string; email: string }>(this.fetchImpl, apiUrl, '/api/v1/me', { token: t.access_token });
    const perms = await http<{ organizations: Array<{ organization_id: string; organization_status: string; roles: string[]; permissions: string[] }> }>(this.fetchImpl, apiUrl, '/api/v1/me/permissions', { token: t.access_token });
    const orgs = await http<Array<{ id: string; name: string }>>(this.fetchImpl, apiUrl, '/api/v1/organizations', { token: t.access_token }).catch(() => [] as Array<{ id: string; name: string }>);
    const now = this.p.now().toISOString();
    const s: StoredSession = {
      user_id: me.id, email: me.email, token_expires_at: (jwtExpiry(t.access_token) ?? new Date(this.p.now().getTime() + 3_600_000)).toISOString(), last_online_auth_at: now, last_seen_at: now,
      organizations: perms.organizations.map((o) => ({ organization_id: o.organization_id, name: orgs.find((x) => x.id === o.organization_id)?.name ?? 'Organización', status: o.organization_status, roles: o.roles, permissions: o.permissions })),
    };
    await this.p.secrets.set(K.token, t.access_token);
    await this.p.secrets.set(K.session, JSON.stringify(s));
    await this.p.secrets.set(K.apiUrl, apiUrl);
    return s;
  }

  async logout(): Promise<void> {
    await this.p.secrets.delete(K.token);
    await this.p.secrets.delete(K.session);
  }

  /** Almacén de la cuenta+organización; toda escritura de captura pasa por la puerta de sesión (vencida → bloqueada). */
  async openStore(s: StoredSession, orgId: string): Promise<LocalStore> {
    return LocalStore.open(this.p, await accountKey(this.p.sha256, s.user_id, orgId), () => captureGate(s, orgId, this.p.now()));
  }

  private online(s: StoredSession) {
    if (this.p.now() >= new Date(s.token_expires_at)) throw new ApiFailure('HTTP', 401, 'La sesión venció: inicia sesión con conexión.');
  }

  /** Registro (o recuperación) del dispositivo en la organización: identificador emitido por el servidor; no autoriza. */
  async ensureDevice(s: StoredSession, orgId: string): Promise<string> {
    const key = `tl.device.server.${s.user_id}.${orgId}`;
    const known = await this.p.secrets.get(key);
    if (known) return known;
    this.online(s);
    const r = await http<{ device: { id: string } }>(this.fetchImpl, await this.apiUrl(''), `/api/v1/organizations/${orgId}/devices`, { method: 'POST', token: (await this.token()) ?? undefined,
      body: { client_device_id: await this.deviceId(), platform: 'ANDROID', label: 'Terra Link Campo' } });
    await this.p.secrets.set(key, r.device.id);
    return r.device.id;
  }

  /** Expo Go no cifra la base: solo se admiten organizaciones DEMO (datos sintéticos). */
  private assertDataAllowed(s: StoredSession, orgId: string) {
    const org = s.organizations.find((o) => o.organization_id === orgId);
    if (this.p.environment === 'WEB_PREVIEW_SYNTHETIC' && !org?.name.startsWith('VISTA PREVIA')) {
      throw new ApiFailure('HTTP', 403, 'La vista previa web solo trabaja con el servidor simulado y datos sintéticos.', 'SYNTHETIC_ONLY');
    }
    if (this.p.environment === 'EXPO_GO_SYNTHETIC' && !org?.name.startsWith('DEMO')) {
      throw new ApiFailure('HTTP', 403, 'Expo Go es un entorno de prueba SIN cifrado: solo admite organizaciones DEMO con datos sintéticos. Usa el build nativo de aceptación para datos reales.', 'SYNTHETIC_ONLY');
    }
  }

  transport(orgId: string, apiUrl: string, uploader: Uploader) {
    return httpTransport(apiUrl, orgId, () => this.token(), this.fetchImpl, uploader);
  }

  /** Descarga del dataset autorizado mediante pull completo (cursor de servidor). Las operaciones pendientes no se tocan. */
  async downloadDataset(s: StoredSession, orgId: string, store: LocalStore, uploader: Uploader): Promise<number> {
    this.online(s);
    this.assertDataAllowed(s, orgId);
    const deviceId = await this.ensureDevice(s, orgId);
    const r = await this.transport(orgId, await this.apiUrl(''), uploader).pull(deviceId, null);
    await store.applyPull(r.changes, r.tombstones, r.cursor, true);
    // Productores, productos y centros autorizados (referencias mínimas): sin esto, «Altas» no podría elegir un productor que aún no tiene parcelas.
    if (r.reference) await store.applyReference(r.reference);
    return r.changes.length;
  }

  /** Sincronización completa: push, adjuntos y pull. Requiere sesión vigente (el servidor revalida todo). */
  async sync(s: StoredSession, orgId: string, store: LocalStore, uploader: Uploader): Promise<SyncSummary> {
    this.online(s);
    this.assertDataAllowed(s, orgId);
    const deviceId = await this.ensureDevice(s, orgId);
    return syncOnce(store, this.transport(orgId, await this.apiUrl(''), uploader), deviceId);
  }

  gate(s: StoredSession | null, orgId: string | null) { return captureGate(s, orgId, this.p.now()); }
}
