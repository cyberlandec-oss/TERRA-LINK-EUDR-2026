'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useUrlFilters } from '../../../../lib/url-filters';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { MIT_TONE } from '../../../../lib/risk';

interface Row { id: string; title: string; factor_code: string; status: string; status_label: string; due_date: string; lot: { id: string; code: string }; assignee: string; mine: boolean; overdue: boolean }

// UX_UI §18.2: caso → acción → responsable → plazo → evidencia → revisión → resultado.
export default function MitigationsPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filters, setFilters, ready] = useUrlFilters({ status: '' });
  const status = filters.status;
  const setStatus = (v: string) => setFilters({ status: v });
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    if (!orgId || !ws.can('mitigation:read') || !ready) return;
    try { setRows(await api<Row[]>(`/api/v1/organizations/${orgId}/mitigations${status ? `?status=${status}` : ''}`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, ws, status, ready]);
  useEffect(() => { void load(); }, [load]);
  if (!ws.activeOrg) return null;
  if (!ws.can('mitigation:read')) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar mitigaciones.', request_id: null })} />;
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Mitigaciones' }]} />
      <PageHeader title="Mitigaciones" meta="Acciones ligadas a una causa de una evaluación de riesgo. Verificar no vuelve favorable el riesgo: la reevaluación decide." />
      <div className="card">
        <label htmlFor="mt-status">Estado</label>
        <select id="mt-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option><option value="OPEN">Abiertas</option><option value="SUBMITTED">Entregadas</option><option value="REJECTED">Rechazadas</option><option value="VERIFIED">Verificadas</option>
        </select>
      </div>
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!rows && !error && <Loading label="Cargando mitigaciones…" />}
      {rows && rows.length === 0 && <EmptyState title={status ? 'Ninguna mitigación en este estado.' : 'Aún no hay mitigaciones. Se crean desde la evaluación de riesgo de un lote.'} />}
      {rows && rows.length > 0 && (
        <div className="table-wrap"><table aria-label="Mitigaciones">
          <thead><tr><th scope="col">Acción</th><th scope="col">Lote · causa</th><th scope="col">Responsable</th><th scope="col">Plazo</th><th scope="col">Estado</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/organizaciones/${orgId}/mitigaciones/${r.id}`}>{r.title}</Link></td>
              <td>{r.lot.code} · {r.factor_code}</td>
              <td>{r.assignee}{r.mine ? ' (tú)' : ''}</td>
              <td>{r.due_date}{r.overdue && <div><StatusBadge tone="review">Vencida</StatusBadge></div>}</td>
              <td><StatusBadge tone={MIT_TONE[r.status]}>{r.status_label}</StatusBadge></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
