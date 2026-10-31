'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { REVIEW_REASON, STATUS, type Evidence } from '../../../../lib/evidence';

interface ClaimType { code: string; label: string; entity_types: string[]; limitation: string }
const ENTITY: Record<string, string> = { producer: 'Productor', plot: 'Parcela' };

// UX_UI §17: centro de evidencias orientado a afirmaciones.
export default function EvidencePage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const canRead = ws.can('evidence:read');
  const [items, setItems] = useState<Evidence[] | null>(null);
  const [types, setTypes] = useState<ClaimType[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !canRead) return;
    try {
      const [e, t] = await Promise.all([
        api<Evidence[]>(`/api/v1/organizations/${orgId}/evidence${status ? `?status=${status}` : ''}`),
        api<ClaimType[]>(`/api/v1/organizations/${orgId}/evidence-claim-types`),
      ]);
      setItems(e); setTypes(t); setError(null);
    } catch (err) { setError(err as ApiError); }
  }, [orgId, canRead, status]);
  useEffect(() => { void load(); }, [load]);

  if (!ws.activeOrg) return null;
  if (!canRead) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar evidencias.', request_id: null })} />;
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Evidencias' }]} />
      <PageHeader title="Evidencias" meta="Afirmaciones y los soportes que las respaldan o contradicen. Verificar una afirmación no es conformidad EUDR." />
      <div className="card">
        <label htmlFor="ev-status">Estado</label>
        <select id="ev-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!items && !error && <Loading label="Cargando evidencias…" />}
      {items && items.length === 0 && <EmptyState title={status ? 'No hay afirmaciones en este estado a tu alcance.' : 'Aún no hay afirmaciones a tu alcance.'} />}
      {items && items.length > 0 && (
        <div className="table-wrap">
          <table aria-label="Afirmaciones">
            <thead><tr><th scope="col">Afirmación</th><th scope="col">Entidad</th><th scope="col">Estado</th><th scope="col">Soportes visibles</th><th scope="col">Atención</th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td><Link href={`/organizaciones/${orgId}/evidencias/${e.id}`}>{e.claim.label}</Link></td>
                  <td>{ENTITY[e.entity.type] ?? e.entity.type}</td>
                  <td><StatusBadge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</StatusBadge>{e.validity.expired && ' · vigencia terminada'}</td>
                  <td>{e.sources.filter((s) => s.active).length}</td>
                  <td>{e.requires_review ? `Requiere revisión: ${e.review_reasons.map((r) => REVIEW_REASON[r] ?? r).join('; ')}` : <span className="muted">{e.next_step}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ws.can('evidence:link') && <CreateClaim orgId={orgId} types={types} onDone={load} />}
    </>
  );
}

function CreateClaim({ orgId, types, onDone }: { orgId: string; types: ClaimType[]; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ claim_type: '', entity_type: '', entity_id: '', valid_to: '' });
  const [entities, setEntities] = useState<Array<{ id: string; label: string }>>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const type = types.find((t) => t.code === f.claim_type);
  useEffect(() => {
    if (!f.entity_type) { setEntities([]); return; }
    const path = f.entity_type === 'producer' ? 'producers' : 'plots';
    api<{ items: Array<{ id: string; producer_code?: string; plot_code?: string; display_name?: string; name?: string | null }> }>(`/api/v1/organizations/${orgId}/${path}?limit=100`)
      .then((r) => setEntities(r.items.map((x) => ({ id: x.id, label: x.producer_code ? `${x.producer_code} · ${x.display_name ?? ''}` : `${x.plot_code}${x.name ? ` · ${x.name}` : ''}` }))))
      .catch(() => setEntities([]));
  }, [f.entity_type, orgId]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ evidence: Evidence }>(`/api/v1/organizations/${orgId}/evidence`, { method: 'POST', body: { operation_id: operationId, claim_type: f.claim_type, entity_type: f.entity_type, entity_id: f.entity_id, ...(f.valid_to ? { valid_to: f.valid_to } : {}) } });
      setCreated(r.evidence.id); setOperationId(crypto.randomUUID());
      await onDone();
    } catch (err) { setError(err as ApiError); }
  }
  return (
    <section className="card form" aria-labelledby="new-claim">
      <h2 id="new-claim">Registrar afirmación</h2>
      <p className="muted">Se crea en borrador. Después vincula versiones concretas de documentos y envíala a revisión.</p>
      <form onSubmit={submit}>
        <div className="grid-2">
          <div><label htmlFor="cl-type">Afirmación</label>
            <select id="cl-type" required value={f.claim_type} onChange={(e) => setF({ ...f, claim_type: e.target.value, entity_type: '', entity_id: '' })}>
              <option value="">Selecciona…</option>{types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </select>
            {type && <p className="field-help">{type.limitation}</p>}
          </div>
          <div><label htmlFor="cl-etype">Tipo de entidad</label>
            <select id="cl-etype" required disabled={!type} value={f.entity_type} onChange={(e) => setF({ ...f, entity_type: e.target.value, entity_id: '' })}>
              <option value="">Selecciona…</option>{type?.entity_types.map((x) => <option key={x} value={x}>{ENTITY[x] ?? x}</option>)}
            </select>
          </div>
          <div><label htmlFor="cl-entity">Entidad</label>
            <select id="cl-entity" required disabled={!entities.length} value={f.entity_id} onChange={(e) => setF({ ...f, entity_id: e.target.value })}>
              <option value="">Selecciona…</option>{entities.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </div>
          <div><label htmlFor="cl-to">Vigente hasta <span className="muted">(opcional)</span></label><input id="cl-to" type="date" value={f.valid_to} onChange={(e) => setF({ ...f, valid_to: e.target.value })} /></div>
        </div>
        {error && <ErrorPanel error={error} />}
        {created && <p className="alert valid" role="status">Afirmación registrada en borrador: <Link href={`/organizaciones/${orgId}/evidencias/${created}`}>abrir para vincular soportes</Link>.</p>}
        <div className="actions"><button type="submit">Registrar afirmación</button></div>
      </form>
    </section>
  );
}
