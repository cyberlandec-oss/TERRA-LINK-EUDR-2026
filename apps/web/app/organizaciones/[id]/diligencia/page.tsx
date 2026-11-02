'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { READINESS_TONE } from '../../../../lib/dd';

interface Row { id: string; case_number: string; lot_id: string; lot_code: string; snapshot_number: number | null; readiness_effective: string | null; readiness_label: string }
interface List { cases: Row[]; lots_without_case: Array<{ id: string; lot_code: string }>; can_create: boolean }

// UX_UI §18.3: expedientes de debida diligencia por lote. Preparación interna ≠ DDS presentada.
export default function DdCasesPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const [d, setD] = useState<List | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [f, setF] = useState({ lot: '', scope: '' });
  const [op, setOp] = useState(() => crypto.randomUUID());
  const load = useCallback(async () => {
    if (!orgId || !ws.can('dd:read')) return;
    try { setD(await api<List>(`/api/v1/organizations/${orgId}/dd-cases`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, ws]);
  useEffect(() => { void load(); }, [load]);
  if (!ws.activeOrg) return null;
  if (!ws.can('dd:read')) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar expedientes de debida diligencia.', request_id: null })} />;
  async function create(e: FormEvent) {
    e.preventDefault(); setActionError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/dd-cases`, { method: 'POST', body: { operation_id: op, lot_id: f.lot, scope_note: f.scope } });
      setOp(crypto.randomUUID()); setF({ lot: '', scope: '' }); await load();
    } catch (err) { setActionError(err as ApiError); }
  }
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Debida diligencia' }]} />
      <PageHeader title="Debida diligencia" meta="Expediente por lote: requisitos, instantáneas versionadas, revisión y paquete interno." />
      <Alert tone="info">«Preparado» es una preparación interna y «paquete generado» es una descarga: ninguno es una DDS presentada ni aceptada en TRACES.</Alert>
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!d && !error && <Loading label="Cargando expedientes…" />}
      {d && d.cases.length === 0 && <EmptyState title="Aún no hay expedientes." />}
      {d && d.cases.length > 0 && (
        <div className="table-wrap"><table aria-label="Expedientes">
          <thead><tr><th scope="col">Expediente</th><th scope="col">Lote</th><th scope="col">Instantánea</th><th scope="col">Preparación</th></tr></thead>
          <tbody>{d.cases.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/organizaciones/${orgId}/diligencia/${r.id}`}>{r.case_number}</Link></td>
              <td>{r.lot_code}</td>
              <td>{r.snapshot_number ?? '—'}</td>
              <td>{r.readiness_effective ? <StatusBadge tone={READINESS_TONE[r.readiness_effective]}>{r.readiness_label}</StatusBadge> : r.readiness_label}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {d?.can_create && (
        <form className="card form" onSubmit={create} aria-label="Crear expediente">
          <h2>Crear expediente</h2>
          <label htmlFor="dd-lot">Lote</label>
          <select id="dd-lot" required value={f.lot} onChange={(e) => setF({ ...f, lot: e.target.value })}>
            <option value="">Selecciona…</option>{d.lots_without_case.map((l) => <option key={l.id} value={l.id}>{l.lot_code}</option>)}
          </select>
          <label htmlFor="dd-scope">Alcance</label>
          <textarea id="dd-scope" required minLength={3} maxLength={1000} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} />
          <p className="field-help">Describe la operación o el propósito. No define el rol regulatorio ni el perfil jurídico.</p>
          {actionError && <ErrorPanel error={actionError} />}
          <div className="actions"><button type="submit">Crear expediente</button></div>
        </form>
      )}
    </>
  );
}
