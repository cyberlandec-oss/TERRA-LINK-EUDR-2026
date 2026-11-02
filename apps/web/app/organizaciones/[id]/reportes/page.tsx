'use client';

import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, apiDownload } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { useUrlFilters } from '../../../../lib/url-filters';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// P0-030 Reportes e indicadores (S1 §60 y §97; UX_UI §20.2). Contrato: docs/decisiones/P0-030-REPORTES.md.
// La pantalla no calcula nada: muestra lo que devuelve la API con su definición, denominador, motivo y estado.
// Cinco estados distintos, no uno solo: calculado, sin denominador, desconocido, criterio sin definición y sin permiso.
type Status = 'OK' | 'NO_DENOMINATOR' | 'UNKNOWN' | 'CRITERION_UNDEFINED' | 'RESTRICTED';

interface Indicator {
  code: string; name: string; definition: string; unit: 'count' | 'percent'; kind: 'STATE' | 'ACTIVITY' | 'BALANCE_AT';
  date_basis: string | null; requires: string; status: Status;
  /** De dónde sale el indicador: la lista de la fuente (S1 §60) o una extensión declarada de Terra Link. */
  catalog: 'S1_60' | 'TERRA_LINK';
  value: string | null; numerator: number | null; denominator: number | null; observed: Record<string, number> | null; reason: string | null;
  /** Identidad del criterio versionado con el que se contó, cuando el indicador depende de uno. */
  criterion?: { id: string; version_current: string; versions_counted: string[]; mixed_versions: boolean; note: string };
}
/** Hora legible en la zona del navegador (identificada expresamente); el instante canónico sigue siendo el UTC del servidor. */
const zonaDelNavegador = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'zona del navegador'; } };
const fechaLegible = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
function CoberturaAviso({ c }: { c: Coverage }) {
  if (c.status === 'COMPLETE') return <p className="muted">Cobertura histórica declarada completa{c.declared_at ? ` el ${fechaLegible(c.declared_at)}` : ''}.</p>;
  if (c.status === 'INCOMPLETE') return <Alert tone="review" title="Cobertura histórica incompleta">Este informe utiliza los registros disponibles. Hay antecedentes incompletos y los resultados pueden no representar toda la actividad histórica. {c.note}</Alert>;
  return <Alert tone="review" title="Cobertura histórica no determinada">{c.note} Los resultados reflejan los registros disponibles.</Alert>;
}
interface Coverage { status: 'UNKNOWN' | 'INCOMPLETE' | 'COMPLETE'; event_date: string | null; note: string; not_reconstructed: string; reference: string | null; declared_at: string | null }
interface TimeBasis { as_of: string; as_of_note: string; period_bounds: string; civil_dates: string }
interface Comparison {
  period: { from: string | null; to: string | null };
  days: { current: number | null; compared: number | null };
  equivalent_periods: boolean; equivalence_note: string; scope_note: string; balance_note: string; coverage_note: string;
  indicators: Array<{
    code: string; name: string; unit: string; date_basis: string | null;
    current: { status: Status; value: string | null }; compared: { status: Status; value: string | null };
    delta: string | null; delta_note: string;
  }>;
}
interface Indicators {
  catalog_version: string; source: string;
  period: { from: string | null; to: string | null; applies_to: string };
  time_basis: TimeBasis; scope_note: string; assigned_scope_note: string; privacy_note: string; interpretation_note: string;
  status_legend: Record<string, string>; coverage: Coverage; can_export: boolean; indicators: Indicator[];
  comparison: Comparison | null; snapshot_note: string;
}
interface CatalogEntry { kind: string; title: string; source: string; requires: string[]; why: Record<string, string>; period_applies: boolean; period_note: string; available: boolean; missing: string[] }
interface Catalog {
  catalog_version: string; source: string; can_export: boolean; cross_domain_note: string; reports: CatalogEntry[];
  geojson: { kind: string; title: string; source: string; requires: string[]; available: boolean; missing: string[]; notice: string; regulatory_profile: string };
}
interface EntityReport {
  kind: string; title: string; source: string; requires: string[]; period_applies: boolean; period_note: string;
  columns: Array<{ key: string; label: string; note?: string }>;
  rows: Array<Record<string, string | number | null>>;
  totals: Array<{ key: string; label: string; value: string }>;
  notes: string[]; total_rows: number; returned_rows: number; has_more: boolean; limit_note: string;
  page: { limit: number; cursor: string | null; next_cursor: string | null; key: string };
  why: Record<string, string>; can_export: boolean; coverage: Coverage; time_basis: TimeBasis;
  snapshot_note: string; export_note: string; export_limit: number;
}

const KIND: Record<Indicator['kind'], string> = { STATE: 'Estado actual', ACTIVITY: 'Actividad del período', BALANCE_AT: 'Saldo a una fecha' };
const BADGE: Record<Exclude<Status, 'OK'>, { tone: 'neutral' | 'review'; label: string }> = {
  NO_DENOMINATOR: { tone: 'review', label: 'Sin denominador' },
  UNKNOWN: { tone: 'review', label: 'Desconocido' },
  CRITERION_UNDEFINED: { tone: 'review', label: 'Criterio sin definir' },
  RESTRICTED: { tone: 'neutral', label: 'Sin permiso' },
};

/**
 * Con qué criterio se contó. Va aparte de los conteos a propósito: sin esto, dos lecturas del mismo indicador
 * podrían haberse calculado con reglas distintas y nadie lo sabría.
 */
function Criterion({ criterion }: { criterion: NonNullable<Indicator['criterion']> }) {
  return (
    <div className="muted">
      Criterio: {criterion.id} · versión {criterion.version_current}
      {criterion.versions_counted.length > 0 && <> · contado con {criterion.versions_counted.join(' y ')}</>}
      {criterion.mixed_versions && <strong> · AVISO: hay dictámenes de más de una versión; el total no es comparable consigo mismo hasta reevaluar.</strong>}
      <div>{criterion.note}</div>
    </div>
  );
}

function Observed({ observed }: { observed: Record<string, number> | null }) {
  if (!observed || !Object.keys(observed).length) return null;
  // Lo que sí se puede contar se publica, aunque el indicador principal sea desconocido.
  return <div className="muted">Observado: {Object.entries(observed).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}</div>;
}

export default function ReportsPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const can = ws.can('report:read');
  // Período y reporte activo viven en la URL (mismo patrón que parcelas y lotes): se conservan al volver de otra pantalla.
  const [urlFilters, setUrlFilters, ready] = useUrlFilters({ desde: '', hasta: '', reporte: 'indicadores', comp_desde: '', comp_hasta: '', cursor: '' });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [compFrom, setCompFrom] = useState('');
  const [compTo, setCompTo] = useState('');
  const [applied, setApplied] = useState({ desde: '', hasta: '', reporte: 'indicadores', comp_desde: '', comp_hasta: '', cursor: '' });
  const [data, setData] = useState<Indicators | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [entity, setEntity] = useState<EntityReport | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<{ filename: string; sha256: string | null; bytes: number } | null>(null);

  type Filtros = { desde: string; hasta: string; reporte: string; comp_desde: string; comp_hasta: string; cursor: string };
  const qs = (f: Partial<Filtros>, extra: 'comparacion' | 'cursor' | null = null) => {
    const p = new URLSearchParams();
    if (f.desde) p.set('from', f.desde);
    if (f.hasta) p.set('to', f.hasta);
    if (extra === 'comparacion') {
      if (f.comp_desde) p.set('compare_from', f.comp_desde);
      if (f.comp_hasta) p.set('compare_to', f.comp_hasta);
    }
    if (extra === 'cursor' && f.cursor) p.set('cursor', f.cursor);
    return p.toString() ? `?${p}` : '';
  };

  const load = useCallback(async (f: Filtros) => {
    if (!orgId || !can) return;
    setError(null);
    setExported(null);
    try {
      if (!catalog) setCatalog(await api<Catalog>(`/api/v1/organizations/${orgId}/reports/entities`));
      if (f.reporte === 'indicadores') {
        setEntity(null);
        setData(await api<Indicators>(`/api/v1/organizations/${orgId}/reports/indicators${qs(f, 'comparacion')}`));
      } else {
        setData(null);
        setEntity(await api<EntityReport>(`/api/v1/organizations/${orgId}/reports/entities/${f.reporte}${qs(f, 'cursor')}`));
      }
      setApplied(f);
      setUrlFilters(f);
    } catch (e) {
      setData(null);
      setEntity(null);
      setError(e as ApiError);
    }
  }, [orgId, can, catalog, setUrlFilters]);

  useEffect(() => {
    if (!ready) return;
    setFrom(urlFilters.desde);
    setTo(urlFilters.hasta);
    setCompFrom(urlFilters.comp_desde);
    setCompTo(urlFilters.comp_hasta);
    void load(urlFilters);
    // Solo al entrar, con lo que venga en la URL; después se aplica con el formulario o el selector.
  }, [orgId, ready]);

  const applyFilters = (e: FormEvent) => {
    e.preventDefault();
    // Al cambiar el período se vuelve a la primera página: un cursor de otro filtro no significa nada.
    void load({ ...applied, desde: from, hasta: to, comp_desde: compFrom, comp_hasta: compTo, cursor: '' });
  };
  const elegir = (reporte: string) => void load({ ...applied, desde: from, hasta: to, comp_desde: compFrom, comp_hasta: compTo, reporte, cursor: '' });

  async function download(path: string, fallback: string) {
    setExporting(true);
    setError(null);
    try {
      setExported(await apiDownload(path, fallback));
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setExporting(false);
    }
  }

  const activo = applied.reporte;
  const cargando = !data && !entity && !error;

  if (!ws.activeOrg) return null;
  if (!can) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar los reportes de la organización.', request_id: null })} />;
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Reportes' }]} />
      <PageHeader title="Reportes e indicadores" meta={catalog ? `Indicadores de la organización y reportes por entidad · catálogo ${catalog.catalog_version}` : undefined} />

      {catalog && (
        <nav className="card" aria-label="Reportes disponibles">
          <h2>Reporte</h2>
          <div className="actions">
            {/* El reporte activo va relleno y el resto en secundario: el estado no depende solo del color, y
                `aria-current` lo anuncia a los lectores de pantalla. */}
            <button type="button" className={activo === 'indicadores' ? undefined : 'secondary'}
              aria-current={activo === 'indicadores' ? 'page' : undefined}
              onClick={() => elegir('indicadores')}>
              Indicadores (§60)
            </button>
            {catalog.reports.map((r) => (
              <button key={r.kind} type="button" disabled={!r.available} className={activo === r.kind ? undefined : 'secondary'}
                aria-current={activo === r.kind ? 'page' : undefined}
                title={r.available ? r.source : `Te falta ${r.missing.join(' y ')}`}
                onClick={() => elegir(r.kind)}>
                {r.title.replace('Reporte de ', '')}
              </button>
            ))}
          </div>
          <p className="field-help">Cada reporte exige el permiso de su dominio. Los que tu rol no permite quedan deshabilitados.</p>
          <p className="field-help">{catalog.cross_domain_note}</p>
          {catalog.reports.filter((r) => !r.available).map((r) => (
            <p key={r.kind} className="muted">{r.title}: te falta {r.missing.map((m) => `${m} (${r.why[m] ?? 'dato de ese dominio'})`).join('; ')}.</p>
          ))}
        </nav>
      )}

      <form className="card form" onSubmit={applyFilters} aria-label="Período de los indicadores de actividad">
        <h2>Período</h2>
        <div className="grid-2">
          <div><label htmlFor="rp-desde">Desde</label><input id="rp-desde" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label htmlFor="rp-hasta">Hasta</label><input id="rp-hasta" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <p className="field-help">{entity ? entity.period_note : data?.period.applies_to ?? 'El período solo se aplica a lo que mide actividad.'}</p>
        {(entity ?? data) && <p className="field-help">{(entity ?? data)!.time_basis.period_bounds}</p>}
        {activo === 'indicadores' && (
          <>
            <h3>Comparar con otro período</h3>
            <div className="grid-2">
              <div><label htmlFor="rp-cdesde">Comparar desde</label><input id="rp-cdesde" type="date" value={compFrom} onChange={(e) => setCompFrom(e.target.value)} /></div>
              <div><label htmlFor="rp-chasta">Comparar hasta</label><input id="rp-chasta" type="date" value={compTo} onChange={(e) => setCompTo(e.target.value)} /></div>
            </div>
            <p className="field-help">Compara solo los indicadores de ACTIVIDAD, por su fecha operativa declarada. Comparar actividad no reconstruye existencias: el saldo a una fecha es otra capacidad y no se aproxima aquí.</p>
          </>
        )}
        <button type="submit">Aplicar período</button>
      </form>

      {error && <ErrorPanel error={error} onRetry={() => void load(applied)} />}
      {cargando && <Loading label="Calculando…" />}

      {(data ?? entity) && (
        <section className="card">
          <p className="muted">El reporte incluye únicamente los productores y registros que puedes consultar.</p>
          <p className="muted">Calculado: <strong>{fechaLegible((data ?? entity)!.time_basis.as_of)}</strong> <span className="field-help">(hora de tu navegador, {zonaDelNavegador()}; instante UTC: <code>{(data ?? entity)!.time_basis.as_of}</code>). Las fechas de entrega y cosecha son fechas civiles declaradas y no se convierten.</span></p>
          {data && <p className="muted">{data.privacy_note}</p>}
          <p className="muted">{data ? data.interpretation_note : entity!.source}</p>
          <CoberturaAviso c={(data ?? entity)!.coverage} />
          <details>
            <summary>Cómo se calcula este reporte</summary>
            <p className="muted">{data ? data.scope_note : 'Este reporte aplica organización y alcance antes de agregar: los totales no incluyen nada que tu rol no pueda leer.'}</p>
            <p className="muted">{(data ?? entity)!.time_basis.as_of_note}</p>
          </details>
        </section>
      )}

      {data && (
        <>
          <div className="table-wrap">
            <table aria-label="Indicadores">
              <thead><tr>
                <th scope="col">Indicador</th><th scope="col">Valor</th><th scope="col">Definición</th>
              </tr></thead>
              <tbody>
                {data.indicators.map((i) => (
                  <tr key={i.code}>
                    <td><strong>{i.name}</strong><div className="muted"><code>{i.code}</code></div><div className="muted">{KIND[i.kind]}</div>
                      {i.catalog === 'TERRA_LINK' && (
                        <div className="muted">Indicador propio de Terra Link: se publica para que los casos críticos no queden fuera del desglose.</div>
                      )}</td>
                    <td>
                      {i.status === 'OK'
                        ? <strong>{i.unit === 'percent' ? `${i.value} %` : i.value}</strong>
                        : <StatusBadge tone={BADGE[i.status].tone}>{BADGE[i.status].label}</StatusBadge>}
                      {(i.numerator !== null || i.denominator !== null) && (
                        <div className="muted">{i.numerator ?? '—'} / {i.denominator ?? '—'}</div>
                      )}
                      <Observed observed={i.observed} />
                      {i.criterion && <Criterion criterion={i.criterion} />}
                    </td>
                    <td>{i.definition}
                      {i.date_basis && <div className="muted">Fecha usada: {i.date_basis}</div>}
                      {i.reason && <div className="muted">{i.reason}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.comparison && (
            <section className="card" aria-labelledby="rp-comparacion">
              <h2 id="rp-comparacion">Comparación de actividad</h2>
              <p className="muted">
                {data.period.from ?? 'sin límite'} → {data.period.to ?? 'sin límite'} ({data.comparison.days.current ?? '—'} día(s))
                {' frente a '}
                {data.comparison.period.from ?? 'sin límite'} → {data.comparison.period.to ?? 'sin límite'} ({data.comparison.days.compared ?? '—'} día(s))
              </p>
              <Alert tone={data.comparison.equivalent_periods ? 'valid' : 'review'} title={data.comparison.equivalent_periods ? 'Períodos equivalentes' : 'Períodos no equivalentes'}>
                {data.comparison.equivalence_note}
              </Alert>
              <div className="table-wrap">
                <table aria-label="Comparación de actividad">
                  <thead><tr>
                    <th scope="col">Indicador</th><th scope="col">Período actual</th><th scope="col">Período comparado</th><th scope="col">Diferencia</th>
                  </tr></thead>
                  <tbody>
                    {data.comparison.indicators.map((c) => (
                      <tr key={c.code}>
                        <td><strong>{c.name}</strong><div className="muted"><code>{c.code}</code></div>{c.date_basis && <div className="muted">Fecha usada: {c.date_basis}</div>}</td>
                        <td>{c.current.status === 'OK' ? <strong>{c.current.value}</strong> : <StatusBadge tone={BADGE[c.current.status].tone}>{BADGE[c.current.status].label}</StatusBadge>}</td>
                        <td>{c.compared.status === 'OK' ? <strong>{c.compared.value}</strong> : <StatusBadge tone={BADGE[c.compared.status].tone}>{BADGE[c.compared.status].label}</StatusBadge>}</td>
                        <td>{c.delta !== null ? <strong>{Number(c.delta) > 0 ? `+${c.delta}` : c.delta}</strong> : <span className="muted">—</span>}<div className="muted">{c.delta_note}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">{data.comparison.scope_note}</p>
              <p className="muted">{data.comparison.balance_note}</p>
              <p className="muted">{data.comparison.coverage_note}</p>
            </section>
          )}
          <section className="card" aria-labelledby="rp-estados">
            <h2 id="rp-estados">Qué significa cada estado</h2>
            <dl className="props">
              {Object.entries(data.status_legend).map(([k, v]) => (
                <Fragment key={k}><dt><code>{k}</code></dt><dd>{v}</dd></Fragment>
              ))}
            </dl>
          </section>
          <section className="card" aria-labelledby="rp-export">
            <h2 id="rp-export">Exportar indicadores</h2>
            {data.can_export ? (
              <>
                <p className="field-help">CSV con los mismos indicadores, filtros y notas de esta pantalla. La descarga vuelve a comprobar tu permiso, se recalcula en ese momento y queda registrada en la auditoría con el hash del archivo. No genera enlaces públicos.</p>
                <button type="button" onClick={() => void download(`/api/v1/organizations/${orgId}/reports/indicators/export${qs(applied)}`, 'indicadores.csv')} disabled={exporting}>{exporting ? 'Generando…' : 'Exportar CSV'}</button>
              </>
            ) : <p className="muted">Tu rol no permite exportar estos indicadores.</p>}
          </section>
        </>
      )}

      {entity && (
        <>
          <section className="card" aria-labelledby="rp-entidad">
            <h2 id="rp-entidad">{entity.title}</h2>
            <p className="muted">{entity.source} · {entity.returned_rows} de {entity.total_rows} fila(s)</p>
          </section>
          {entity.has_more && <Alert tone="info" title="Hay más filas">Esta es una página del reporte; los totales de abajo cubren el conjunto completo. Avanza con «Siguiente página» o exporta el CSV, que trae el resto hasta su tope declarado.</Alert>}
          {entity.rows.length === 0
            ? <EmptyState title="No hay filas para este reporte">No es un error: la organización no tiene registros de este tipo, o ninguno entra en el período.</EmptyState>
            : (
              <div className="table-wrap">
                <table aria-label={entity.title}>
                  <thead><tr>{entity.columns.map((c) => (<th scope="col" key={c.key}>{c.label}</th>))}</tr></thead>
                  <tbody>
                    {entity.rows.map((r, n) => (
                      <tr key={String(r[entity.columns[0].key] ?? n)}>
                        {entity.columns.map((c) => (<td key={c.key}>{r[c.key] === null || r[c.key] === undefined || r[c.key] === '' ? <span className="muted">—</span> : String(r[c.key])}</td>))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          <nav className="card" aria-label="Páginas del reporte">
            <p className="muted">Mostrando {entity.returned_rows} de {entity.total_rows} fila(s), de {entity.page.limit} por página, ordenadas por <code>{entity.page.key}</code>.</p>
            <div className="actions">
              <button type="button" className="secondary" disabled={!applied.cursor}
                onClick={() => void load({ ...applied, cursor: '' })}>Primera página</button>
              <button type="button" disabled={!entity.has_more}
                onClick={() => void load({ ...applied, cursor: entity.page.next_cursor ?? '' })}>Siguiente página</button>
            </div>
            <p className="field-help">{entity.limit_note}</p>
            <p className="field-help">{entity.snapshot_note}</p>
          </nav>
          <section className="card" aria-labelledby="rp-totales">
            <h2 id="rp-totales">Totales</h2>
            <p className="field-help">{entity.snapshot_note}</p>
            <dl className="props">
              {entity.totals.map((t) => (
                <Fragment key={t.key}><dt>{t.label}</dt><dd><strong>{t.value}</strong></dd></Fragment>
              ))}
            </dl>
          </section>
          <section className="card" aria-labelledby="rp-notas">
            <h2 id="rp-notas">Cómo leer este reporte</h2>
            <ul>
              {entity.columns.filter((c) => c.note).map((c) => (<li key={c.key}><strong>{c.label}:</strong> {c.note}</li>))}
              {entity.notes.map((n) => (<li key={n}>{n}</li>))}
            </ul>
          </section>
          <section className="card" aria-labelledby="rp-export-entidad">
            <h2 id="rp-export-entidad">Exportar este reporte</h2>
            {entity.can_export ? (
              <>
                <p className="field-help">CSV con las mismas columnas y totales de esta pantalla. {entity.export_note}</p>
                <p className="field-help">Se RECALCULA al descargar: su marca de generación es la del momento de la descarga, no la de esta pantalla. Queda registrada en la auditoría con el hash del archivo.</p>
                <button type="button" onClick={() => void download(`/api/v1/organizations/${orgId}/reports/entities/${entity.kind}/export${qs(applied)}`, `reporte-${entity.kind}.csv`)} disabled={exporting}>{exporting ? 'Generando…' : 'Exportar CSV'}</button>
              </>
            ) : <p className="muted">Tu rol no permite exportar reportes.</p>}
          </section>
        </>
      )}

      {catalog && activo === 'plots' && (
        <section className="card" aria-labelledby="rp-geojson">
          <h2 id="rp-geojson">Descargar geometrías de parcelas</h2>
          <p>Exporta las ubicaciones y límites registrados de las parcelas que puedes consultar, en su versión vigente. No presenta ninguna declaración externa.</p>
          <p className="field-help">El archivo indica cuántas parcelas incluye y cuántas omite (las que solo tienen superficie declarada o no tienen versión vigente no se inventan) y, por parcela, la versión y la huella de su geometría. Es distinto de descargar el archivo original importado de una versión y de la evaluación EUDR_GEO_V1. {catalog.geojson.notice}</p>
          <Alert tone="review" title="Aplicabilidad jurídica del perfil pendiente (D-05.B)">{catalog.geojson.regulatory_profile}</Alert>
          {catalog.geojson.available
            ? <button type="button" onClick={() => void download(`/api/v1/organizations/${orgId}/reports/entities/plots/geojson`, 'parcelas.geojson')} disabled={exporting}>{exporting ? 'Generando…' : 'Descargar geometrías de parcelas'}</button>
            : <p className="muted">Tu rol no permite esta exportación: falta {catalog.geojson.missing.join(' y ')}. Entrega coordenadas exactas, por eso exige <code>plot:read_geometry</code>.</p>}
        </section>
      )}

      {exported && <Alert tone="valid" title="Exportado">{exported.filename} · {exported.bytes} bytes{exported.sha256 ? ` · sha256 ${exported.sha256.slice(0, 16)}…` : ''}</Alert>}
    </>
  );
}
