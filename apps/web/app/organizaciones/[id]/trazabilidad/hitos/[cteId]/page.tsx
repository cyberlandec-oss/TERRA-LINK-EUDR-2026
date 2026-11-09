'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../../../../lib/api';
import { useWorkspace } from '../../../../../../lib/workspace';
import { Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../../lib/ui';

// P0-014: datos mínimos (KDE) de una versión exacta de un hito. Solo lectura: no hay formularios de
// cosecha, entrega u otras operaciones; la compuerta se integrará en la historia de cada operación.

interface Kde {
  id: string; code: string; reference: string; name: string; cte: { reference: string; retired: boolean };
  contract: { entity: string; field: string }; value_type_label: string; unit: { allowed: string[]; dimension: string } | null;
  requirement: 'REQUIRED' | 'CONDITIONAL' | 'OPTIONAL'; requirement_label: string; condition_text: string | null; rule_text: string;
  responsible_roles: string[]; responsible_note: string | null; source: string; difference: string | null; published_in: string;
  status: 'ACTIVE' | 'RETIRED'; integration: { status: string; story: string | null; proof: string; event_type: string } | null;
}
interface Catalog { current_release: { version: string } | null; definitions: Kde[]; flow_requirement: { note: string }; legal_configuration: { note: string } }
interface Cte { code: string; reference: string; name: string; status: string }

const ROLE: Record<string, string> = {
  PRODUCER: 'Productor', FIELD_TECHNICIAN: 'Técnico de campo', RECEPTION_OPERATOR: 'Operador de recepción', QUALITY_OPERATOR: 'Operador de calidad',
  TRACEABILITY_MANAGER: 'Responsable de trazabilidad', EXPORT_MANAGER: 'Responsable de exportación',
};
const REQ_TONE = { REQUIRED: 'blocked', CONDITIONAL: 'review', OPTIONAL: 'neutral' } as const;

export default function KdePage() {
  const ws = useWorkspace();
  const { cteId } = useParams<{ cteId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const canRead = ws.can('traceability:read_catalog');
  const [cte, setCte] = useState<Cte | null>(null);
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !canRead) return;
    try {
      const [c, k] = await Promise.all([
        api<Cte>(`/api/v1/organizations/${orgId}/cte-definitions/${cteId}`),
        api<Catalog>(`/api/v1/organizations/${orgId}/kde-catalog?cte_definition_id=${cteId}&include_retired=true`),
      ]);
      setCte(c); setData(k); setError(null);
    } catch (e) { setError(e as ApiError); }
  }, [orgId, canRead, cteId]);
  useEffect(() => { void load(); }, [load]);

  if (!ws.activeOrg) return null;
  if (!canRead) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar los datos mínimos de trazabilidad.', request_id: null })} />;
  if (error) return <ErrorPanel error={error} onRetry={load} />;
  if (!cte || !data) return <Loading label="Cargando datos mínimos…" />;
  const active = data.definitions.filter((d) => d.status === 'ACTIVE');
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Hitos de trazabilidad', href: `/organizaciones/${orgId}/trazabilidad/hitos` }, { label: cte.reference }]} />
      <PageHeader title={`Datos mínimos · ${cte.name}`} meta={`Hito ${cte.reference} · catálogo KDE ${data.current_release?.version ?? '—'}`} />
      <section className="card">
        <p>{data.flow_requirement.note}</p>
        <p className="muted">{data.legal_configuration.note} Un dato condicional cuya condición no puede evaluarse se trata como desconocido, nunca como «no aplica».</p>
        {active[0]?.integration && (
          <p className="muted">Integración: <StatusBadge tone={active[0].integration.status === 'INTEGRATED' ? 'process' : 'review'}>{active[0].integration.status === 'INTEGRATED' ? 'Integrada' : 'Pendiente'}</StatusBadge>{' '}
            {active[0].integration.status === 'INTEGRATED'
              ? `en ${active[0].integration.story}: la operación comprueba estos datos con su compuerta por transición (faltantes permitidos quedan como pendientes visibles).`
              : `${active[0].integration.story ? `prevista en ${active[0].integration.story}` : 'sin historia asignada (D-33)'}. Ninguna operación usa todavía estos datos.`}</p>
        )}
      </section>
      {active.length === 0 ? <p className="muted">Este hito no tiene datos mínimos vigentes.</p> : (
        <div className="table-wrap">
          <table aria-label="Datos mínimos del hito">
            <thead><tr><th scope="col">Dato</th><th scope="col">Tipo y unidad</th><th scope="col">Obligatoriedad</th><th scope="col">Regla</th><th scope="col">Responsable</th><th scope="col">Fuente y diferencias</th></tr></thead>
            <tbody>
              {active.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong><div className="muted"><code>{d.reference}</code></div><div className="muted">{d.contract.entity} · {d.contract.field}</div></td>
                  <td>{d.value_type_label}{d.unit && <div className="muted">{d.unit.allowed.join(', ')} ({d.unit.dimension === 'MASS' ? 'masa' : d.unit.dimension})</div>}</td>
                  <td><StatusBadge tone={REQ_TONE[d.requirement]}>{d.requirement_label}</StatusBadge>{d.condition_text && <div className="muted">{d.condition_text}</div>}</td>
                  <td>{d.rule_text || '—'}</td>
                  <td>{d.responsible_roles.length ? d.responsible_roles.map((r) => ROLE[r] ?? r).join(', ') : 'Sin rol definido'}{d.responsible_note && <div className="muted">{d.responsible_note}</div>}</td>
                  <td><span className="muted">{d.source}</span>{d.difference && <div className="muted">Diferencia: {d.difference}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {active[0]?.integration && (
        <section className="card">
          <h2>Prueba de integración requerida</h2>
          <p className="muted">{active[0].integration.proof.replace(active[0].code, 'cada dato')}</p>
        </section>
      )}
    </>
  );
}
