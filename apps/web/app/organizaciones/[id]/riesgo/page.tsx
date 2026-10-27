'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { RESULT_TONE } from '../../../../lib/risk';

interface Row { lot_id: string; lot_code: string; product: string; evaluation_id: string | null; technical_result: string | null; technical_label: string; evaluated_at: string | null; freshness: string | null }

// UX_UI (riesgo): evaluaciones técnicas por lote. Resultado técnico ≠ conclusión regulatoria ≠ cumplimiento EUDR.
export default function RiskPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    if (!orgId || !ws.can('risk:read')) return;
    try { setRows(await api<Row[]>(`/api/v1/organizations/${orgId}/risk/lots`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, ws]);
  useEffect(() => { void load(); }, [load]);
  if (!ws.activeOrg) return null;
  if (!ws.can('risk:read')) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar evaluaciones de riesgo.', request_id: null })} />;
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Riesgo' }]} />
      <PageHeader title="Riesgo" meta="Evaluación técnica por lote con reglas de docs/13 sin aprobar: sin puntuación, pesos ni umbrales. No es conclusión regulatoria ni cumplimiento EUDR." />
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!rows && !error && <Loading label="Cargando evaluaciones…" />}
      {rows && rows.length === 0 && <EmptyState title="Aún no hay lotes que evaluar." />}
      {rows && rows.length > 0 && (
        <div className="table-wrap"><table aria-label="Riesgo por lote">
          <thead><tr><th scope="col">Lote</th><th scope="col">Resultado técnico</th><th scope="col">Vigencia</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.lot_id}>
              <td><Link href={`/organizaciones/${orgId}/riesgo/${r.lot_id}`}>{r.lot_code}</Link><div className="muted">{r.product}</div></td>
              <td>{r.technical_result ? <StatusBadge tone={RESULT_TONE[r.technical_result]}>{r.technical_label}</StatusBadge> : <span className="muted">Sin evaluar</span>}</td>
              <td>{r.freshness === 'STALE' ? <StatusBadge tone="review">Desactualizada</StatusBadge> : r.freshness === 'CURRENT' ? 'Vigente' : '—'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
