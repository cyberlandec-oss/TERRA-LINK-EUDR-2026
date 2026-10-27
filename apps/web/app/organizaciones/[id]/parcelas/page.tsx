'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useUrlFilters } from '../../../../lib/url-filters';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { useI18n } from '../../../../lib/i18n';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { GEOMETRY_STATUS, ha, type Plot } from '../../../../lib/plots';

// UI-06 Parcelas: listado y filtros con datos reales. El alta es contextual desde la ficha del productor.
export default function PlotsPage() {
  const ws = useWorkspace();
  const { t, locale } = useI18n();
  const region = locale === 'en' ? 'en-US' : 'es-EC';
  const orgId = ws.activeOrg?.id ?? '';
  const canList = ws.can('plot:read') || ws.can('plot:read_assigned') || ws.can('plot:read_own');
  const [items, setItems] = useState<Plot[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  // Filtros aplicados en la URL: se conservan al volver desde la ficha (P0-027).
  const [urlFilters, setUrlFilters, ready] = useUrlFilters({ q: '', status: 'ACTIVE', geometry: '' });
  const [filters, setFilters] = useState({ q: '', status: 'ACTIVE', geometry: '' });
  const [applied, setApplied] = useState(filters);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async (append = false, from: string | null = null, f = filters) => {
    if (!orgId || !canList) return;
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '25', status: f.status });
      if (f.q.trim()) params.set('q', f.q.trim());
      if (f.geometry) params.set('geometry', f.geometry);
      if (from) params.set('cursor', from);
      const res = await api<{ items: Plot[]; next_cursor: string | null }>(`/api/v1/organizations/${orgId}/plots?${params}`);
      setItems((prev) => (append && prev ? [...prev, ...res.items] : res.items));
      setCursor(res.next_cursor);
      setApplied(f);
      setUrlFilters(f);
    } catch (err) {
      setError(err as ApiError);
    }
  }, [orgId, canList, filters]);

  useEffect(() => {
    if (!ready) return;
    setFilters(urlFilters);
    void load(false, null, urlFilters);
    // Solo al entrar (con los filtros de la URL); después se aplican con el formulario.
  }, [orgId, ready]);

  if (!ws.activeOrg) return null;
  if (!canList) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: t('Tu rol no permite consultar parcelas.'), request_id: null })} />;
  const filtered = applied.q !== '' || applied.status !== 'ACTIVE' || applied.geometry !== '';
  const onlyAssigned = !ws.can('plot:read');
  const onlyOwn = onlyAssigned && !ws.can('plot:read_assigned');
  const reset = { q: '', status: 'ACTIVE', geometry: '' };

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Parcelas') }]} />
      <PageHeader title={t('Parcelas')} meta={onlyOwn ? t('Ves solo tus parcelas.') : onlyAssigned ? t('Ves las parcelas de los productores asignados a ti.') : t('Parcelas de la organización.')} />
      <form className="card" role="search" aria-label={t('Buscar parcelas')} onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <div className="grid-3">
          <div>
            <label htmlFor="q">{t('Buscar por código, nombre o código de productor')}</label>
            <input id="q" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          </div>
          <div>
            <label htmlFor="status">{t('Estado')}</label>
            <select id="status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="ACTIVE">{t('Activas')}</option>
              <option value="INACTIVE">{t('De baja')}</option>
              <option value="ALL">{t('Todas')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="geometry">{t('Situación geométrica')}</label>
            <select id="geometry" value={filters.geometry} onChange={(e) => setFilters({ ...filters, geometry: e.target.value })}>
              <option value="">{t('Todas')}</option>
              <option value="WITH">{t('Con ubicación registrada')}</option>
              <option value="WITHOUT">{t('Geometría pendiente')}</option>
            </select>
          </div>
        </div>
        <div className="actions">
          <button type="submit">{t('Buscar')}</button>
          {filtered && <button type="button" className="secondary" onClick={() => { setFilters(reset); void load(false, null, reset); }}>{t('Limpiar filtros')}</button>}
        </div>
      </form>
      {error && <ErrorPanel error={error} onRetry={() => load()} />}
      {!items && !error && <Loading label={t('Cargando parcelas…')} />}
      {items && items.length === 0 && (filtered
        ? <EmptyState title={t('No encontramos resultados con estos filtros.')}><p className="muted">{t('Ajusta la búsqueda o limpia los filtros.')}</p></EmptyState>
        : <EmptyState title={onlyOwn ? t('Todavía no tienes parcelas registradas.') : onlyAssigned ? t('Tus productores asignados aún no tienen parcelas.') : t('Aún no hay parcelas registradas.')}>
            {(ws.can('plot:create') || ws.can('plot:create_assigned') || ws.can('plot:create_own')) && <p className="muted">{t('Registra una parcela desde la ficha de su')} <Link href={`/organizaciones/${orgId}/productores`}>{t('productor')}</Link>.</p>}
          </EmptyState>)}
      {items && items.length > 0 && (
        <div className="table-wrap">
          <table aria-label={t('Parcelas')}>
            <thead><tr><th scope="col">{t('Parcela')}</th><th scope="col">{t('Productor')}</th><th scope="col">{t('Cultivo')}</th><th scope="col">{t('Situación geométrica')}</th><th scope="col">{t('Superficie')}</th><th scope="col">{t('Estado')}</th></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/organizaciones/${orgId}/parcelas/${p.id}`}>{p.plot_code}{p.name ? ` · ${p.name}` : ''}</Link></td>
                  <td>{p.producer.producer_code} · {p.producer.display_name}</td>
                  <td>{p.crop}</td>
                  <td><StatusBadge tone={GEOMETRY_STATUS[p.geometry_status].tone}>{t(GEOMETRY_STATUS[p.geometry_status].label)}</StatusBadge></td>
                  <td>
                    {ha(p.area_declared_ha, region) ? <div>{t('Declarada')}: {ha(p.area_declared_ha, region)}</div> : null}
                    {ha(p.area_calculated_ha, region) ? <div>{t('Calculada')}: {ha(p.area_calculated_ha, region)}</div> : null}
                    {!p.area_declared_ha && !p.area_calculated_ha && <span className="muted">{t('Sin registrar')}</span>}
                  </td>
                  <td><StatusBadge tone={p.status === 'ACTIVE' ? 'valid' : 'blocked'}>{p.status === 'ACTIVE' ? t('Activa') : t('De baja')}</StatusBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && <button className="secondary" onClick={() => load(true, cursor)}>{t('Cargar más')}</button>}
    </>
  );
}
