'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';
import { unitText, type Product } from '../../../../../lib/products';

interface HistoryRow { version: string; change_type: string; changed_fields: string[]; reason: string | null; changed_at: string; actor: string }
const CHANGE: Record<string, string> = { CREATED: 'Alta', UPDATED: 'Edición', DEACTIVATED: 'Desactivación', ACTIVATED: 'Activación' };
const FIELD: Record<string, string> = { name: 'nombre', scientific_name: 'nombre científico', variety: 'variedad', status: 'situación', code: 'código', product_state: 'estado o presentación', unit: 'unidad' };

// UI-09 detalle de producto: edición con control de versión (borrador conservado ante conflicto),
// activación/desactivación con motivo y efectos explicados, historial.
export default function ProductDetailPage() {
  const ws = useWorkspace();
  const { productId } = useParams<{ productId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const [p, setP] = useState<Product | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const [prod, hist] = await Promise.all([
        api<Product>(`/api/v1/organizations/${orgId}/products/${productId}`),
        api<HistoryRow[]>(`/api/v1/organizations/${orgId}/products/${productId}/history`),
      ]);
      setP(prod); setHistory(hist); setError(null);
    } catch (e) { setError(e as ApiError); }
  }, [orgId, productId]);
  useEffect(() => { void load(); }, [load]);

  if (!ws.activeOrg) return null;
  if (error && !p) return <ErrorPanel error={error} />;
  if (!p) return <Loading label="Cargando producto…" />;
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Productos', href: `/organizaciones/${orgId}/productos` }, { label: p.code }]} />
      <PageHeader title={`${p.code} · ${p.name}`} meta={<StatusBadge tone={p.status === 'ACTIVE' ? 'valid' : 'blocked'}>{p.status === 'ACTIVE' ? 'Activo' : `Inactivo: ${p.status_reason}`}</StatusBadge>} />
      <section className="card">
        <h2>Definición</h2>
        <dl className="props">
          <dt>Código</dt><dd>{p.code}</dd>
          <dt>Estado o presentación</dt><dd>{p.product_state.label}</dd>
          <dt>Unidad de medida</dt><dd>{unitText(p.unit)}</dd>
          <dt>Nombre científico</dt><dd>{p.scientific_name ?? 'Sin registrar'}</dd>
          <dt>Variedad</dt><dd>{p.variety ?? 'Sin registrar'}</dd>
          <dt>Versión</dt><dd>{p.row_version}</dd>
        </dl>
        <p className="muted">Código, estado o presentación y unidad no se modifican: para otro estado o unidad se registra otro producto. Pasar de un estado a otro (p. ej. fermentar) se registrará como un proceso con evento y rendimiento.</p>
      </section>
      {p.can_manage && p.status === 'ACTIVE' && <EditProduct orgId={orgId} product={p} onSaved={load} />}
      {p.can_manage && <StatusProduct orgId={orgId} product={p} onSaved={load} />}
      <section className="card">
        <h2>Historial</h2>
        <ul className="plain" aria-label="Historial del producto">
          {history.map((h) => (
            <li key={h.version}>
              <strong>v{h.version} · {CHANGE[h.change_type] ?? h.change_type}</strong>{' '}
              <span className="muted">· {h.actor} · {new Date(h.changed_at).toLocaleString('es-EC')}
                {h.change_type === 'UPDATED' && ` · ${h.changed_fields.map((f) => FIELD[f] ?? f).join(', ')}`}{h.reason && ` · motivo: ${h.reason}`}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function EditProduct({ orgId, product, onSaved }: { orgId: string; product: Product; onSaved: () => Promise<void> }) {
  const init = { name: product.name, scientific_name: product.scientific_name ?? '', variety: product.variety ?? '' };
  const [f, setF] = useState(init);
  const [base, setBase] = useState(init);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(false);
    const changed = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== base[k as keyof typeof base]).map(([k, v]) => [k, k === 'name' ? v.trim() : (v.trim() || null)]));
    try {
      await api(`/api/v1/organizations/${orgId}/products/${product.id}`, { method: 'PATCH', body: { expected_version: product.row_version, ...changed } });
      setSaved(true); setBase(f);
      await onSaved();
    } catch (err) {
      setError(err as ApiError); // el borrador se conserva
    } finally { setBusy(false); }
  }

  return (
    <section className="card form" aria-labelledby="edit-product">
      <h2 id="edit-product">Editar datos descriptivos</h2>
      <form onSubmit={submit}>
        <div className="grid-2">
          <div><label htmlFor="ep-name">Nombre</label><input id="ep-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><label htmlFor="ep-sci">Nombre científico <span className="muted">(opcional)</span></label><input id="ep-sci" value={f.scientific_name} onChange={(e) => setF({ ...f, scientific_name: e.target.value })} /></div>
          <div><label htmlFor="ep-var">Variedad <span className="muted">(opcional)</span></label><input id="ep-var" value={f.variety} onChange={(e) => setF({ ...f, variety: e.target.value })} /></div>
        </div>
        {saved && <p className="alert valid" role="status">Cambios guardados.</p>}
        {error && (
          <>
            <ErrorPanel error={error} />
            {error.body.code === 'VERSION_CONFLICT' && (
              <div className="actions">
                <p className="muted">Tus cambios siguen en el formulario. Recarga para ver la versión actual y vuelve a guardar.</p>
                <button type="button" className="secondary" onClick={async () => { await onSaved(); setError(null); }}>Recargar versión actual</button>
              </div>
            )}
          </>
        )}
        <div className="actions"><button type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button></div>
      </form>
    </section>
  );
}

function StatusProduct({ orgId, product, onSaved }: { orgId: string; product: Product; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const deactivate = product.status === 'ACTIVE';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!confirming) { setConfirming(true); return; }
    setBusy(true); setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/products/${product.id}/${deactivate ? 'deactivate' : 'activate'}`, { method: 'POST', body: { expected_version: product.row_version, reason: reason.trim() } });
      setReason(''); setConfirming(false);
      await onSaved();
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }

  return (
    <section className="card form" aria-labelledby="status-product">
      <h2 id="status-product">{deactivate ? 'Desactivar producto' : 'Activar producto'}</h2>
      <form onSubmit={submit}>
        <label htmlFor="sp-reason">Motivo</label>
        <input id="sp-reason" required minLength={3} value={reason} onChange={(e) => { setReason(e.target.value); setConfirming(false); }} />
        {confirming && (
          <div className="alert review" role="alert">
            <p className="alert-title">{deactivate ? '¿Desactivar este producto?' : '¿Activar este producto?'}</p>
            <p>{deactivate
              ? 'Dejará de ofrecerse para operaciones nuevas. Los registros históricos que lo usen se conservan sin cambios y puedes volver a activarlo.'
              : 'Volverá a estar disponible para operaciones nuevas. Su código, estado y unidad no cambian.'}</p>
          </div>
        )}
        {error && <ErrorPanel error={error} />}
        <div className="actions">
          <button type="submit" className={deactivate ? 'danger' : undefined} disabled={busy} aria-busy={busy}>{confirming ? (deactivate ? 'Confirmar desactivación' : 'Confirmar activación') : (deactivate ? 'Desactivar' : 'Activar')}</button>
          {confirming && <button type="button" className="secondary" onClick={() => setConfirming(false)}>Cancelar</button>}
        </div>
      </form>
    </section>
  );
}
