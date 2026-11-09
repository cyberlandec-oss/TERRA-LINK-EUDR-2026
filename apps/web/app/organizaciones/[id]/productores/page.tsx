'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent, useRef } from 'react';
import { useUrlFilters } from '../../../../lib/url-filters';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

export interface Producer {
  id: string;
  producer_code: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  legal_name: string | null;
  community: string | null;
  province: string | null;
  canton: string | null;
  parish: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  assigned_membership_id: string | null;
  row_version: number;
  identity_visible: boolean;
  document_type?: string | null;
  document_number?: string | null;
  phone?: string | null;
  address?: string | null;
  deletion_reason: string | null;
  duplicate_reviews_pending?: number;
}

export const STATUS_LABEL: Record<Producer['status'], string> = { DRAFT: 'Borrador', ACTIVE: 'Activo', INACTIVE: 'De baja' };

export default function ProducersPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const router = useRouter();
  const [items, setItems] = useState<Producer[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ q: '', status: '' });
  // Filtros aplicados en la URL: se conservan al volver desde la ficha (P0-027).
  const [urlFilters, setUrlFilters, ready] = useUrlFilters({ q: '', status: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const canList = ws.can('producer:read') || ws.can('producer:read_assigned') || ws.can('producer:read_own');

  const seq = useRef(0);
  const load = useCallback(async (append = false, from: string | null = null, override?: { q: string; status: string }) => {
    if (!orgId || !canList) return;
    const f = override ?? { q: q.trim(), status };
    setError(null);
    const mine = ++seq.current; // una respuesta vieja no puede pisar a una más reciente (el listado inicial y la búsqueda del formulario pueden cruzarse)
    try {
      const params = new URLSearchParams({ limit: '25' });
      if (f.q) params.set('q', f.q);
      if (f.status) params.set('status', f.status);
      if (from) params.set('cursor', from);
      const res = await api<{ items: Producer[]; next_cursor: string | null }>(`/api/v1/organizations/${orgId}/producers?${params}`);
      if (mine !== seq.current) return;
      setItems((prev) => (append && prev ? [...prev, ...res.items] : res.items));
      setCursor(res.next_cursor);
      setApplied(f);
      setUrlFilters(f);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err as ApiError);
    }
  }, [orgId, canList, q, status]);

  useEffect(() => {
    if (!ready) return;
    setQ(urlFilters.q);
    setStatus(urlFilters.status);
    void load(false, null, urlFilters);
    // Solo al entrar (con los filtros de la URL); la búsqueda se lanza con el formulario.
  }, [orgId, ready]);

  if (!ws.activeOrg) return null;
  if (!canList) {
    return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar productores.', request_id: null })} />;
  }
  const filtered = applied.q !== '' || applied.status !== '';
  const onlyAssigned = !ws.can('producer:read');
  const soloPropio = onlyAssigned && !ws.can('producer:read_assigned') && ws.can('producer:read_own');

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Productores' }]} />
      <PageHeader
        title="Productores"
        meta={soloPropio ? 'Ves solo tu productor.' : onlyAssigned ? 'Ves solo los productores asignados a ti.' : 'Productores de la organización.'}
        actions={ws.can('producer:review_duplicates') ? <Link className="button secondary" href={`/organizaciones/${orgId}/productores/coincidencias`}>Revisar posibles duplicados</Link> : undefined}
      />
      <form className="card" onSubmit={(e) => { e.preventDefault(); void load(); }} role="search" aria-label="Buscar productores">
        <div className="grid-2">
          <div>
            <label htmlFor="q">Buscar por código, nombre o comunidad</label>
            <input id="q" value={q} onChange={(e) => setQ(e.target.value)} />
            {ws.can('producer:read_identity') && <p className="field-help">También puedes buscar por número de documento exacto.</p>}
          </div>
          <div>
            <label htmlFor="status">Estado</label>
            <select id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Activos y borradores</option>
              <option value="ACTIVE">Activos</option>
              <option value="DRAFT">Borradores</option>
              <option value="INACTIVE">De baja</option>
              <option value="ALL">Todos</option>
            </select>
          </div>
        </div>
        <div className="actions">
          <button type="submit">Buscar</button>
          {filtered && <button type="button" className="secondary" onClick={() => { setQ(''); setStatus(''); void load(false, null, { q: '', status: '' }); }}>Limpiar filtros</button>}
        </div>
      </form>
      {error && <ErrorPanel error={error} onRetry={() => load()} />}
      {!items && !error && <Loading label="Cargando productores…" />}
      {items && items.length === 0 && (filtered
        ? <EmptyState title="No encontramos resultados con estos filtros."><p className="muted">Ajusta la búsqueda o limpia los filtros.</p></EmptyState>
        : <EmptyState title={onlyAssigned ? 'Aún no tienes productores asignados.' : 'Aún no hay productores registrados.'}>{ws.can('producer:create') && <p className="muted">Registra el primero con el formulario de abajo.</p>}</EmptyState>)}
      {items && items.length > 0 && (
        <div className="table-wrap">
          <table aria-label="Productores">
            <thead><tr><th scope="col">Productor (código · nombre)</th><th scope="col">Comunidad</th><th scope="col">Estado</th></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/organizaciones/${orgId}/productores/${p.id}`}>{p.producer_code} · {p.display_name}</Link></td>
                  <td>{p.community ?? <span className="muted">Sin registrar</span>}</td>
                  <td><StatusBadge tone={p.status === 'ACTIVE' ? 'valid' : p.status === 'DRAFT' ? 'review' : 'blocked'}>{STATUS_LABEL[p.status]}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && <button className="secondary" onClick={() => load(true, cursor)}>Cargar más</button>}
      {ws.can('producer:create') && ws.activeOrg.status === 'ACTIVE' && (
        <CreateProducer orgId={orgId} onCreated={(p) => router.push(`/organizaciones/${orgId}/productores/${p.id}${p.duplicate_reviews_pending ? '?coincidencia=1' : ''}`)} />
      )}
    </>
  );
}

export function ProducerFields({ value, onChange, showIdentity }: {
  value: Record<string, string>; onChange: (v: Record<string, string>) => void; showIdentity: boolean;
}) {
  const field = (key: string, label: string, extra: Record<string, unknown> = {}) => (
    <>
      <label htmlFor={`f-${key}`}>{label}</label>
      <input id={`f-${key}`} value={value[key] ?? ''} onChange={(e) => onChange({ ...value, [key]: e.target.value })} {...extra} />
    </>
  );
  return (
    <>
      <p className="field-help">Indica nombre y apellido, o la razón social. Los demás campos son opcionales.</p>
      {field('first_name', 'Nombre')}
      {field('last_name', 'Apellido')}
      {field('legal_name', 'Razón social')}
      {showIdentity && (
        <>
          {field('document_type', 'Tipo de documento')}
          {field('document_number', 'Número de documento')}
          {field('phone', 'Teléfono', { inputMode: 'tel' })}
          {field('address', 'Dirección')}
        </>
      )}
      {field('community', 'Comunidad')}
      {field('province', 'Provincia')}
      {field('canton', 'Cantón')}
      {field('parish', 'Parroquia')}
    </>
  );
}

/** Convierte el formulario a payload: vacío → null (borra) solo en edición; omitido en alta. */
export function toPayload(v: Record<string, string>, forUpdate: boolean) {
  const out: Record<string, string | null> = {};
  for (const [k, raw] of Object.entries(v)) {
    const t = raw.trim();
    if (t) out[k] = t;
    else if (forUpdate) out[k] = null;
  }
  return out;
}

function CreateProducer({ orgId, onCreated }: { orgId: string; onCreated: (p: Producer) => void }) {
  const [code, setCode] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Si falla, el formulario conserva lo escrito para corregir y reintentar.
      const p = await api<Producer>(`/api/v1/organizations/${orgId}/producers`, {
        method: 'POST', body: { producer_code: code.trim(), status: draft ? 'DRAFT' : 'ACTIVE', ...toPayload(fields, false) },
      });
      onCreated(p);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card form" aria-labelledby="registrar-productor">
      <h2 id="registrar-productor">Registrar productor</h2>
      <form onSubmit={submit}>
        <label htmlFor="f-code">Código de productor</label>
        <input id="f-code" required value={code} onChange={(e) => setCode(e.target.value)} pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{0,39}" />
        <ProducerFields value={fields} onChange={setFields} showIdentity />
        <label className="checkbox-row">
          <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Guardar como borrador
        </label>
        {error && <ErrorPanel error={error} />}
        <button type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Registrar productor'}</button>
      </form>
    </section>
  );
}
