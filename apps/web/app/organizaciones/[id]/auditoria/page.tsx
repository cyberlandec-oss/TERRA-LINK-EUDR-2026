'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { ApiError, api, apiDownload } from '../../../../lib/api';
import {
  AUDIT_FILTER_KEYS, ENTITY_LABELS, RESULT_LABELS, actionLabel, filterQuery, type AuditFacets, type AuditFilterState, type AuditPage, type AuditRecord,
} from '../../../../lib/audit';

// UI-18 Auditoría (docs/UX_UI.md §20.1): consulta de solo lectura con filtros, detalle permitido y exportación.
// El servidor aplica alcance y redacción; la interfaz no filtra por seguridad.
export default function AuditPage() {
  const ws = useWorkspace();
  const org = ws.activeOrg;
  const orgId = org?.id ?? '';
  const canRead = ws.can('audit:read');
  const canExport = ws.can('audit:export');
  const [facets, setFacets] = useState<AuditFacets | null>(null);
  const [draft, setDraft] = useState<AuditFilterState>({});
  const [applied, setApplied] = useState<AuditFilterState | null>(null);
  const [rows, setRows] = useState<AuditRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<{ filename: string; sha256: string | null; bytes: number } | null>(null);
  const [exportError, setExportError] = useState<ApiError | null>(null);

  const load = useCallback(async (more?: string) => {
    if (!orgId || !canRead || !applied) return;
    const qs = filterQuery(applied);
    try {
      const page = await api<AuditPage>(`/api/v1/organizations/${orgId}/audit-logs?limit=25${qs ? `&${qs}` : ''}${more ? `&cursor=${more}` : ''}`);
      setRows((prev) => (more && prev ? [...prev, ...page.items] : page.items));
      setTotal(page.total);
      setCursor(page.next_cursor);
      setError(null);
    } catch (err) { setError(err as ApiError); }
  }, [orgId, canRead, applied]);

  // Los filtros viven en la URL: se conservan al volver del detalle y al recargar.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const f: AuditFilterState = {};
    for (const k of AUDIT_FILTER_KEYS) { const v = p.get(k); if (v) f[k] = v; }
    setDraft(f); setApplied(f);
  }, []);
  useEffect(() => {
    if (!applied) return;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(applied)) if (v && v.trim()) p.set(k, v.trim());
    const qs = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, [applied]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  useEffect(() => {
    if (!orgId || !canRead) return;
    api<AuditFacets>(`/api/v1/organizations/${orgId}/audit-logs/facets`).then(setFacets).catch(() => setFacets(null));
  }, [orgId, canRead]);

  if (!org) return null;
  if (!canRead) {
    return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar la auditoría de esta organización.', request_id: null })} />;
  }
  const set = (k: keyof AuditFilterState) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const apply = (e: FormEvent) => { e.preventDefault(); setExported(null); setApplied({ ...draft }); };
  const clear = () => { setDraft({}); setApplied({}); setExported(null); };
  const filtered = Object.values(applied ?? {}).some((v) => v && v.trim());
  const more = async () => { if (!cursor) return; setLoadingMore(true); await load(cursor); setLoadingMore(false); };
  const doExport = async () => {
    setExporting(true); setExportError(null); setExported(null);
    try {
      const qs = filterQuery(applied ?? {});
      setExported(await apiDownload(`/api/v1/organizations/${orgId}/audit-logs/export${qs ? `?${qs}` : ''}`, 'auditoria.csv'));
    } catch (err) { setExportError(err as ApiError); }
    setExporting(false);
  };

  return (
    <>
      <Breadcrumb items={[{ label: org.name, href: `/organizaciones/${org.id}` }, { label: 'Auditoría' }]} />
      <PageHeader title="Auditoría" meta={<>{org.name} · Registro de solo lectura: quién hizo qué y cuándo. Los eventos de dominio y las entregas del outbox se consultan aparte.</>} />

      <form className="card form" onSubmit={apply} aria-label="Filtros de auditoría">
        <h2>Filtros</h2>
        <div className="grid-2">
          <div><label htmlFor="au-from">Desde</label><input id="au-from" type="date" value={draft.from ?? ''} onChange={set('from')} /></div>
          <div><label htmlFor="au-to">Hasta</label><input id="au-to" type="date" value={draft.to ?? ''} onChange={set('to')} /></div>
          <div>
            <label htmlFor="au-entity">Tipo de registro</label>
            <select id="au-entity" value={draft.entity_type ?? ''} onChange={set('entity_type')}>
              <option value="">Todos</option>
              {(facets?.entity_types ?? []).map((t) => <option key={t} value={t}>{ENTITY_LABELS[t] ?? t}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="au-action">Operación</label>
            <select id="au-action" value={draft.action ?? ''} onChange={set('action')}>
              <option value="">Todas</option>
              {(facets?.actions ?? []).map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="au-actor">Actor</label>
            <select id="au-actor" value={draft.actor ?? ''} onChange={set('actor')}>
              <option value="">Todos</option>
              {(facets?.actors ?? []).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="au-result">Resultado</label>
            <select id="au-result" value={draft.result ?? ''} onChange={set('result')}>
              <option value="">Todos</option>
              {Object.entries(RESULT_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div><label htmlFor="au-request">Identificador de correlación</label><input id="au-request" value={draft.request_id ?? ''} onChange={set('request_id')} maxLength={100} /></div>
        </div>
        <div className="actions">
          <button type="submit">Aplicar filtros</button>
          <button type="button" className="secondary" onClick={clear}>Limpiar</button>
        </div>
      </form>

      <section className="card" aria-labelledby="au-results">
        <h2 id="au-results">Registros</h2>
        {error && <ErrorPanel error={error} onRetry={() => void load()} />}
        {!rows && !error && <Loading label="Cargando registros…" />}
        {rows && rows.length === 0 && (
          <EmptyState title={filtered ? 'Ningún registro a tu alcance coincide con estos filtros.' : 'Aún no hay registros a tu alcance.'}>
            {filtered && <button type="button" className="secondary" onClick={clear}>Quitar filtros</button>}
          </EmptyState>
        )}
        {rows && rows.length > 0 && (
          <>
            <p className="muted" aria-live="polite">Mostrando {rows.length} de {total} registros a tu alcance.</p>
            <div className="table-wrap">
              <table aria-label="Registros de auditoría">
                <thead><tr><th scope="col">Fecha</th><th scope="col">Operación</th><th scope="col">Registro</th><th scope="col">Actor</th><th scope="col">Resultado</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.occurred_at).toLocaleString('es-EC')}</td>
                      <td><Link href={`/organizaciones/${orgId}/auditoria/${r.id}`}>{actionLabel(r.action)}</Link>{r.reason && <div className="muted">motivo: {r.reason}</div>}</td>
                      <td>{ENTITY_LABELS[r.entity_type] ?? r.entity_type}</td>
                      <td>{r.actor.label}</td>
                      <td><StatusBadge tone={RESULT_LABELS[r.result]?.tone ?? 'neutral'}>{RESULT_LABELS[r.result]?.label ?? r.result}</StatusBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {cursor && <button type="button" className="secondary" onClick={() => void more()} disabled={loadingMore}>{loadingMore ? 'Cargando…' : 'Cargar más registros'}</button>}
          </>
        )}
      </section>

      {canExport && (
        <section className="card" aria-labelledby="au-export">
          <h2 id="au-export">Exportar</h2>
          <p className="muted">CSV con los mismos filtros, alcance y redacción que ves en pantalla (formato provisional TL_AUDIT_CSV 0.1, máximo 5000 registros). La descarga queda auditada y no genera enlaces públicos.</p>
          <button type="button" onClick={() => void doExport()} disabled={exporting || !rows || rows.length === 0}>{exporting ? 'Generando…' : 'Exportar CSV'}</button>
          {exportError && <ErrorPanel error={exportError} onRetry={() => void doExport()} />}
          {exported && (
            <Alert tone="valid" title="Exportación descargada">
              {exported.filename} · {exported.bytes} bytes · SHA-256 <code className="hash">{exported.sha256 ?? 'no informado'}</code>
            </Alert>
          )}
        </section>
      )}
    </>
  );
}
