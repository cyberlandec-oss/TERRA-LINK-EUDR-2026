'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { unitText, type Product, type ProductOptions } from '../../../../lib/products';

// UI-09 Productos: catálogo de la organización con datos reales. Estados y unidades desde la API.
export default function ProductsPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const canRead = ws.can('product:read');
  const [options, setOptions] = useState<ProductOptions | null>(null);
  const [items, setItems] = useState<Product[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState({ q: '', status: 'ACTIVE', product_state: '' });
  const [applied, setApplied] = useState(filters);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async (append = false, from: string | null = null, f = filters) => {
    if (!orgId || !canRead) return;
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50', status: f.status });
      if (f.q.trim()) params.set('q', f.q.trim());
      if (f.product_state) params.set('product_state', f.product_state);
      if (from) params.set('cursor', from);
      const res = await api<{ items: Product[]; next_cursor: string | null; can_manage: boolean }>(`/api/v1/organizations/${orgId}/products?${params}`);
      setItems((prev) => (append && prev ? [...prev, ...res.items] : res.items));
      setCursor(res.next_cursor);
      setCanManage(res.can_manage);
      setApplied(f);
    } catch (err) {
      setError(err as ApiError);
    }
  }, [orgId, canRead, filters]);

  useEffect(() => {
    if (!orgId || !canRead) return;
    api<ProductOptions>(`/api/v1/organizations/${orgId}/product-catalog/options`).then(setOptions, (e) => setError(e as ApiError));
    void load();
    // Solo al entrar; los filtros se aplican con el formulario.
  }, [orgId]);

  if (!ws.activeOrg) return null;
  if (!canRead) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar el catálogo de productos.', request_id: null })} />;
  const filtered = applied.q !== '' || applied.status !== 'ACTIVE' || applied.product_state !== '';
  const reset = { q: '', status: 'ACTIVE', product_state: '' };

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Productos' }]} />
      <PageHeader title="Productos" meta="Catálogo de productos de la organización: estado o presentación del cacao y unidad de medida." />
      {options && <p className="muted">{options.transformation_note} {options.conversions_note}</p>}
      <form className="card" role="search" aria-label="Buscar productos" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <div className="grid-3">
          <div>
            <label htmlFor="q">Buscar por código, nombre o variedad</label>
            <input id="q" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          </div>
          <div>
            <label htmlFor="pstate">Estado o presentación</label>
            <select id="pstate" value={filters.product_state} onChange={(e) => setFilters({ ...filters, product_state: e.target.value })}>
              <option value="">Todos</option>
              {options?.states.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="status">Situación</label>
            <select id="status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="ACTIVE">Activos</option>
              <option value="INACTIVE">Inactivos</option>
              <option value="ALL">Todos</option>
            </select>
          </div>
        </div>
        <div className="actions">
          <button type="submit">Buscar</button>
          {filtered && <button type="button" className="secondary" onClick={() => { setFilters(reset); void load(false, null, reset); }}>Limpiar filtros</button>}
        </div>
      </form>
      {error && <ErrorPanel error={error} onRetry={() => load()} />}
      {!items && !error && <Loading label="Cargando productos…" />}
      {items && items.length === 0 && (filtered
        ? <EmptyState title="No encontramos productos con estos filtros."><p className="muted">Ajusta la búsqueda o limpia los filtros.</p></EmptyState>
        : <EmptyState title="Aún no hay productos en el catálogo.">{canManage ? <p className="muted">Registra el primero con el formulario de abajo.</p> : <p className="muted">Un administrador de la organización puede registrarlos.</p>}</EmptyState>)}
      {items && items.length > 0 && (
        <div className="table-wrap">
          <table aria-label="Productos">
            <thead><tr><th scope="col">Código</th><th scope="col">Nombre</th><th scope="col">Estado o presentación</th><th scope="col">Unidad</th><th scope="col">Situación</th></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/organizaciones/${orgId}/productos/${p.id}`}>{p.code}</Link></td>
                  <td>{p.name}{p.variety ? ` · ${p.variety}` : ''}</td>
                  <td>{p.product_state.label}</td>
                  <td>{unitText(p.unit)}</td>
                  <td><StatusBadge tone={p.status === 'ACTIVE' ? 'valid' : 'blocked'}>{p.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && <button className="secondary" onClick={() => load(true, cursor)}>Cargar más</button>}
      {canManage && options && <CreateProduct orgId={orgId} options={options} onCreated={() => load()} />}
    </>
  );
}

function CreateProduct({ orgId, options, onCreated }: { orgId: string; options: ProductOptions; onCreated: () => Promise<void> }) {
  const empty = { code: '', name: '', product_state: '', unit: options.units.length === 1 ? options.units[0].code : '', scientific_name: '', variety: '' };
  const [f, setF] = useState(empty);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setDone(null);
    try {
      const p = await api<Product>(`/api/v1/organizations/${orgId}/products`, {
        method: 'POST',
        body: { code: f.code.trim().toUpperCase(), name: f.name.trim(), product_state: f.product_state, unit: f.unit, scientific_name: f.scientific_name.trim() || undefined, variety: f.variety.trim() || undefined },
      });
      setDone(`Producto ${p.code} registrado.`);
      setF(empty);
      await onCreated();
    } catch (err) {
      setError(err as ApiError); // el formulario conserva lo escrito
    } finally { setBusy(false); }
  }

  return (
    <section className="card form" aria-labelledby="new-product">
      <h2 id="new-product">Registrar producto</h2>
      <p className="muted">El código, el estado o presentación y la unidad no se pueden cambiar después: definen el significado de las operaciones que usen el producto.</p>
      <form onSubmit={submit}>
        <div className="grid-2">
          <div>
            <label htmlFor="np-code">Código</label>
            <input id="np-code" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} aria-describedby="np-code-help" />
            <p id="np-code-help" className="field-help">Mayúsculas, números, guion o guion bajo. Único en la organización.</p>
          </div>
          <div>
            <label htmlFor="np-name">Nombre</label>
            <input id="np-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="np-state">Estado o presentación</label>
            <select id="np-state" required value={f.product_state} onChange={(e) => setF({ ...f, product_state: e.target.value })}>
              <option value="">Selecciona…</option>
              {options.states.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="np-unit">Unidad de medida</label>
            <select id="np-unit" required value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
              <option value="">Selecciona…</option>
              {options.units.map((u) => <option key={u.code} value={u.code}>{unitText(u)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="np-sci">Nombre científico <span className="muted">(opcional)</span></label>
            <input id="np-sci" value={f.scientific_name} onChange={(e) => setF({ ...f, scientific_name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="np-var">Variedad <span className="muted">(opcional)</span></label>
            <input id="np-var" value={f.variety} onChange={(e) => setF({ ...f, variety: e.target.value })} />
          </div>
        </div>
        {done && <p className="alert valid" role="status">{done}</p>}
        {error && <ErrorPanel error={error} />}
        <div className="actions"><button type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Registrando…' : 'Registrar producto'}</button></div>
      </form>
    </section>
  );
}
