import { TransportError, type SyncTransport, type WireOperation } from '../core/sync';
import type { DatasetPlot, ReferenceData, ServerOutcome } from '../core/store';
import type { FetchLike } from './session-manager';

// Transporte HTTP de la sincronización (P0-024). El token y el dispositivo se revalidan en el servidor en cada petición.
export type Uploader = (url: string, bytes: Uint8Array, mimeType: string, fields: Record<string, string>, headers: Record<string, string>) => Promise<{ status: number; body: string }>;

export function httpTransport(apiUrl: string, orgId: string, token: () => Promise<string | null>, f: FetchLike, uploader: Uploader, timeoutMs = 30_000): SyncTransport {
  const base = `${apiUrl.replace(/\/$/, '')}/api/v1/organizations/${orgId}`;
  const call = async <T>(path: string, init: { method: string; body?: unknown }): Promise<T> => {
    const tk = await token();
    if (!tk) throw new TransportError('HTTP', 401, 'UNAUTHENTICATED', 'Sin sesión: inicia sesión con conexión.');
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await Promise.race([
        f(`${base}${path}`, { method: init.method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tk}` }, body: init.body ? JSON.stringify(init.body) : undefined }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
      ]);
    } catch { throw new TransportError('NETWORK', null, 'NETWORK', 'Sin conexión o sin respuesta del servidor: las operaciones se conservan y se reintentarán con el mismo identificador.'); }
    const data = await res.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
    if (!res.ok) throw new TransportError('HTTP', res.status, data?.error?.code ?? `HTTP_${res.status}`, data?.error?.message ?? `Error ${res.status}`);
    return data as T;
  };
  return {
    async push(deviceId: string, ops: WireOperation[]) { return (await call<{ results: ServerOutcome[] }>('/sync/push', { method: 'POST', body: { device_id: deviceId, operations: ops } })).results; },
    async pull(deviceId: string, cursor: string | null) { return call<{ cursor: string; full: boolean; changes: DatasetPlot[]; tombstones: string[]; reference?: ReferenceData }>(`/sync/pull?device_id=${deviceId}${cursor ? `&cursor=${cursor}` : ''}`, { method: 'GET' }); },
    async upload(deviceId: string, operationId: string, bytes: Uint8Array, mimeType: string) {
      const tk = await token();
      if (!tk) throw new TransportError('HTTP', 401, 'UNAUTHENTICATED', 'Sin sesión.');
      let r: { status: number; body: string };
      try { r = await uploader(`${base}/sync/attachments/${operationId}/content`, bytes, mimeType, { device_id: deviceId }, { authorization: `Bearer ${tk}` }); } catch { throw new TransportError('NETWORK', null, 'NETWORK', 'Sin conexión: la foto se conserva y se reintentará.'); }
      const data = (() => { try { return JSON.parse(r.body) as { attachment?: { status: string; note?: string }; error?: { code?: string; message?: string } }; } catch { return null; } })();
      if (r.status >= 400) throw new TransportError('HTTP', r.status, data?.error?.code ?? `HTTP_${r.status}`, data?.error?.message ?? `Error ${r.status}`);
      return { status: data?.attachment?.status ?? 'UNKNOWN', note: data?.attachment?.note };
    },
  };
}
