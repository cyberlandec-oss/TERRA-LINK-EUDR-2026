'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

interface Location { id: string; code: string; name: string; location_type: string; status: 'ACTIVE' | 'INACTIVE'; row_version: number }
const TYPE: Record<string, string> = { COLLECTION_CENTER: 'Centro de acopio', WAREHOUSE: 'Bodega', OTHER: 'Otro' };

// Centros de la organización (docs/06 locations: código, nombre y tipo). Sin coordenadas en esta etapa.
export default function LocationsPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const can = ws.can('location:manage');
  const [rows, setRows] = useState<Location[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [f, setF] = useState({ code: '', name: '', location_type: 'COLLECTION_CENTER' });
  const [formError, setFormError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    if (!orgId || !can) return;
    try { setRows(await api<Location[]>(`/api/v1/organizations/${orgId}/locations`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, can]);
  useEffect(() => { void load(); }, [load]);
  if (!ws.activeOrg) return null;
  if (!can) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite administrar centros.', request_id: null })} />;
  async function create(e: FormEvent) {
    e.preventDefault(); setFormError(null);
    try { await api(`/api/v1/organizations/${orgId}/locations`, { method: 'POST', body: { ...f, code: f.code.trim().toUpperCase(), name: f.name.trim() } }); setF({ code: '', name: '', location_type: 'COLLECTION_CENTER' }); await load(); } catch (err) { setFormError(err as ApiError); }
  }
  async function toggle(l: Location) {
    const reason = window.prompt(`Motivo para ${l.status === 'ACTIVE' ? 'desactivar' : 'reactivar'} ${l.name}`);
    if (!reason || reason.trim().length < 3) return;
    try { await api(`/api/v1/organizations/${orgId}/locations/${l.id}/status`, { method: 'POST', body: { expected_version: l.row_version, status: l.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', reason: reason.trim() } }); await load(); } catch (err) { setError(err as ApiError); }
  }
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Centros de acopio' }]} />
      <PageHeader title="Centros de acopio" meta="Lugares donde se reciben entregas. Desactivar un centro conserva su historia." />
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!rows && !error && <Loading label="Cargando centros…" />}
      {rows && rows.length === 0 && <EmptyState title="Aún no hay centros registrados." />}
      {rows && rows.length > 0 && (
        <div className="table-wrap"><table aria-label="Centros">
          <thead><tr><th scope="col">Código</th><th scope="col">Nombre</th><th scope="col">Tipo</th><th scope="col">Estado</th><th scope="col">Acción</th></tr></thead>
          <tbody>{rows.map((l) => (
            <tr key={l.id}><td>{l.code}</td><td>{l.name}</td><td>{TYPE[l.location_type] ?? l.location_type}</td>
              <td><StatusBadge tone={l.status === 'ACTIVE' ? 'valid' : 'neutral'}>{l.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}</StatusBadge></td>
              <td><button type="button" className="secondary inline" onClick={() => void toggle(l)}>{l.status === 'ACTIVE' ? 'Desactivar' : 'Reactivar'}</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
      <section className="card form" aria-labelledby="lc-new">
        <h2 id="lc-new">Registrar centro</h2>
        <form onSubmit={create}>
          <div className="grid-3">
            <div><label htmlFor="lc-code">Código</label><input id="lc-code" required pattern="[A-Za-z0-9][A-Za-z0-9_\-]{1,39}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
            <div><label htmlFor="lc-name">Nombre</label><input id="lc-name" required minLength={2} maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div><label htmlFor="lc-type">Tipo</label><select id="lc-type" value={f.location_type} onChange={(e) => setF({ ...f, location_type: e.target.value })}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          </div>
          {formError && <ErrorPanel error={formError} />}
          <div className="actions"><button type="submit">Registrar centro</button></div>
        </form>
      </section>
    </>
  );
}
