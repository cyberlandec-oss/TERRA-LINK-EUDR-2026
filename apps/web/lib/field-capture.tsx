'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { GeometryImport } from './geometry-import';
import { useI18n } from './i18n';
import { LocationCapture } from './location-capture';
import { ManualCapture } from './manual-capture';
import { PolygonCapture } from './polygon-capture';
import { positions, type Plot } from './plots';
import { Alert } from './ui';

// A-01 — Captura de la ubicación de una PARCELA agrícola desde la web. Reúne, sin duplicar lógica, los mecanismos que ya
// existían (ubicación del navegador, polígono por vértices, GeoJSON) y añade coordenadas escritas / croquis. Todas las
// vías terminan en el mismo servicio de parcelas: versión inmutable, procedencia propia, validación en el servidor y
// auditoría. La lotes comerciales NO se localizan aquí: conservan su vínculo con las parcelas de origen.
type Method = 'BROWSER' | 'MANUAL' | 'POLYGON' | 'FILE';

export function FieldCapture({ orgId, plot, onChanged }: { orgId: string; plot: Plot; onChanged: () => Promise<void> }) {
  const { t } = useI18n();
  const [method, setMethod] = useState<Method>('BROWSER');
  const hasGeometry = !!plot.current_version?.geometry_type;
  const chosen = useRef(false);

  // Trabajo a medias: si la parcela tiene un borrador de polígono abierto o una importación analizada sin confirmar, se
  // retoma ese método al recargar (el servidor guarda ese trabajo; elegir el método de nuevo no debe ser un obstáculo).
  useEffect(() => {
    let vivo = true;
    const base = `/api/v1/organizations/${orgId}/plots/${plot.id}`;
    (async () => {
      try {
        const d = await api<{ draft: unknown | null }>(`${base}/polygon-drafts/current`);
        if (vivo && d.draft && !chosen.current) { setMethod('POLYGON'); return; }
      } catch { /* sin acceso a borradores: no se sugiere nada */ }
      try {
        const rows = await api<Array<{ status: string }>>(`${base}/geometry-imports`);
        if (vivo && !chosen.current && rows.some((r) => r.status === 'ANALYZED')) setMethod('FILE');
      } catch { /* idem */ }
    })();
    return () => { vivo = false; };
  }, [orgId, plot.id]);

  // Centro del croquis: la geometría vigente si la hay (para corregirla), si no el croquis arranca en Ecuador.
  const center = useMemo(() => {
    const pts = positions(plot.current_version?.geometry ?? null);
    if (pts.length === 0) return null;
    return { lon: pts.reduce((a, p) => a + p.lon, 0) / pts.length, lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length };
  }, [plot.current_version]);

  const options: Array<{ id: Method; label: string; help: string }> = [
    { id: 'BROWSER', label: t('Ubicación del navegador'), help: t('Un punto con la ubicación que informa este navegador') },
    { id: 'MANUAL', label: t('Escribir o dibujar'), help: t('Coordenadas escritas o un croquis, para un punto o un polígono') },
    { id: 'POLYGON', label: t('Polígono por vértices'), help: t('Recorrer el borde y guardar cada esquina') },
    { id: 'FILE', label: t('Importar GeoJSON'), help: t('Un archivo con el polígono de la parcela') },
  ];

  return (
    <div className="field-capture">
      <h3>{t('Registrar la ubicación de la parcela')}</h3>
      <Alert tone="info" title={t('Las coordenadas se registran en la parcela agrícola')}>
        <p>{t('Los lotes comerciales no tienen ubicación propia: conservan su vínculo con las parcelas de origen. Cada método guarda una versión nueva con su procedencia; la anterior se conserva.')}</p>
      </Alert>
      <div role="group" aria-label={t('Método de captura')} className="actions">
        {options.map((o) => (
          <button key={o.id} type="button" className={method === o.id ? '' : 'secondary'} aria-pressed={method === o.id} title={o.help} onClick={() => { chosen.current = true; setMethod(o.id); }}>{o.label}</button>
        ))}
      </div>
      <p className="muted">{options.find((o) => o.id === method)!.help}.</p>
      {method === 'BROWSER' && <LocationCapture orgId={orgId} plotId={plot.id} rowVersion={plot.row_version} onSaved={onChanged} existing={positions(plot.current_version?.geometry ?? null)} />}
      {method === 'MANUAL' && <ManualCapture orgId={orgId} plotId={plot.id} rowVersion={plot.row_version} hasGeometry={hasGeometry} initialCenter={center} onSaved={onChanged} />}
      {method === 'POLYGON' && <PolygonCapture orgId={orgId} plotId={plot.id} plotVersion={plot.row_version} onConfirmed={onChanged} />}
      {method === 'FILE' && <GeometryImport orgId={orgId} plotId={plot.id} plotVersion={plot.row_version} onConfirmed={onChanged} />}
    </div>
  );
}
