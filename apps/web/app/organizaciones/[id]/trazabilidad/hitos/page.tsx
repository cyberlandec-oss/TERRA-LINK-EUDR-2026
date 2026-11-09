'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';

// P0-013: consulta del catálogo de sistema de hitos críticos de trazabilidad (CTE). Solo lectura: no hay
// acciones de cosecha, entrega o procesamiento porque esas operaciones aún no existen.

interface Operation { operation: string; event_type: string; integration_status: 'INTEGRATED' | 'PENDING'; story: string | null; note: string }
interface Definition {
  id: string; code: string; version: number; reference: string; name: string; description: string; stage: string; stage_label: string;
  source: string; published_in: string; status: 'ACTIVE' | 'RETIRED';
  retirement: { release: string; reason: string; at: string; superseded_by: string | null } | null;
  operations: Operation[]; kde?: unknown;
}
interface Catalog {
  scope_note: string; not_milestones: string;
  current_release: { version: string; notes: string; published_at: string } | null;
  definitions: Definition[];
  summary: { definitions: number; integrated_operations: number; pending_operations: number };
}

export default function CtePage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const canRead = ws.can('traceability:read_catalog');
  const [data, setData] = useState<Catalog | null>(null);
  const [retired, setRetired] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !canRead) return;
    setError(null);
    try { setData(await api<Catalog>(`/api/v1/organizations/${orgId}/cte-catalog?include_retired=${retired}`)); } catch (e) { setError(e as ApiError); }
  }, [orgId, canRead, retired]);
  useEffect(() => { void load(); }, [load]);

  if (!ws.activeOrg) return null;
  if (!canRead) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar el catálogo de hitos de trazabilidad.', request_id: null })} />;
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Hitos de trazabilidad' }]} />
      <PageHeader title="Hitos de trazabilidad (CTE)" meta={data?.current_release ? `Catálogo versión ${data.current_release.version} · publicado ${new Date(data.current_release.published_at).toLocaleDateString('es-EC')}` : undefined} />
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!data && !error && <Loading label="Cargando catálogo…" />}
      {data && (
        <>
          <section className="card">
            <p>{data.scope_note}</p>
            <p className="muted">Situación de integración: {data.summary.integrated_operations} operación(es) integrada(s) y {data.summary.pending_operations} pendiente(s). Un hito pendiente está definido, pero la operación que lo registra todavía no existe en la plataforma.</p>
            {/* El contrato del catálogo (cte-release.ts) define INTEGRATED como «la operación y su evento existen». No
                significa que la operación se haya ejercitado de extremo a extremo ni que sus compuertas permitan hoy
                ejecutarla: eso se lee en la nota de cada vínculo. Hacerlo explícito evita leer «Integrada» como acreditada. */}
            <p className="muted"><strong>Integrada</strong> significa que la operación y su evento existen en la plataforma. No significa que se haya ejercitado de extremo a extremo ni que sus compuertas la permitan hoy: cada vínculo indica en su nota qué la bloquea.</p>
            <p className="muted">{data.not_milestones}</p>
            <label><input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} /> Mostrar definiciones retiradas o sustituidas</label>
          </section>
          <div className="table-wrap">
            <table aria-label="Hitos de trazabilidad">
              <thead><tr><th scope="col">Hito</th><th scope="col">Descripción</th><th scope="col">Etapa</th><th scope="col">Versión</th><th scope="col">Vigencia</th><th scope="col">Operación y evento</th><th scope="col">Datos mínimos (KDE)</th></tr></thead>
              <tbody>
                {data.definitions.map((d) => (
                  <tr key={d.id}>
                    <td><strong>{d.name}</strong><div className="muted"><code>{d.code}</code></div></td>
                    <td>{d.description}<div className="muted">Fuente: {d.source}</div></td>
                    <td>{d.stage_label}</td>
                    <td>{d.reference}<div className="muted">catálogo {d.published_in}</div></td>
                    <td>{d.status === 'ACTIVE'
                      ? <StatusBadge tone="valid">Vigente</StatusBadge>
                      : <><StatusBadge tone="neutral">Retirada</StatusBadge><div className="muted">en {d.retirement?.release}: {d.retirement?.reason}</div></>}</td>
                    <td>{d.operations.map((o) => (
                      <div key={o.operation}>
                        {o.integration_status === 'INTEGRATED' ? <StatusBadge tone="process">Integrada</StatusBadge> : <StatusBadge tone="review">Pendiente</StatusBadge>}{' '}
                        <code>{o.event_type}</code>
                        <div className="muted">{o.note}</div>
                      </div>
                    ))}</td>
                    <td>{d.status === 'ACTIVE' ? <a href={`/organizaciones/${orgId}/trazabilidad/hitos/${d.id}`} aria-label={`Ver datos mínimos de ${d.name}`}>Ver datos mínimos</a> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
