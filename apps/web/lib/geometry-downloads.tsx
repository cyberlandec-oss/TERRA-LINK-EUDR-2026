'use client';

import { useState } from 'react';
import { ApiError, apiDownload } from './api';
import type { PlotVersion } from './plots';

// P0-009: descargas autorizadas por el servidor (sin URL pública). Dos cosas distintas:
// - «GeoJSON»: exportación RFC 7946 de la versión almacenada (puede serializarse distinto del original).
// - «Original»: los bytes exactos del archivo importado, verificados contra su SHA-256.
// Ninguna es un paquete EUDR ni una declaración presentada.
export function VersionDownloads({ orgId, plotId, version }: { orgId: string; plotId: string; version: PlotVersion }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!version.geometry_type) return <span className="muted">—</span>;
  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg(null);
    try { setMsg(await fn()); } catch (e) { setMsg((e as ApiError).message); } finally { setBusy(false); }
  };
  const base = `/api/v1/organizations/${orgId}`;
  return (
    <div className="downloads">
      <button type="button" className="secondary small" disabled={busy}
        aria-label={`Exportar GeoJSON de la versión ${version.version_number}`}
        onClick={() => run(async () => { const r = await apiDownload(`${base}/plots/${plotId}/geometry-versions/${version.id}/geojson`, `v${version.version_number}.geojson`); return `Exportado ${r.filename}`; })}>
        GeoJSON
      </button>
      {version.source_import_id && (
        <button type="button" className="secondary small" disabled={busy}
          aria-label={`Descargar archivo original importado de la versión ${version.version_number}`}
          onClick={() => run(async () => { const r = await apiDownload(`${base}/geometry-imports/${version.source_import_id}/original`, 'original.geojson'); return `Original ${r.filename} · SHA-256 ${r.sha256?.slice(0, 12)}…`; })}>
          Original
        </button>
      )}
      {msg && <span className="muted" role="status">{msg}</span>}
    </div>
  );
}
