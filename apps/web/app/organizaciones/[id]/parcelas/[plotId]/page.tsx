'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { useI18n } from '../../../../../lib/i18n';
import { FieldCapture } from '../../../../../lib/field-capture';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';
import { accuracyLabel } from '../../../../../lib/location-capture';
import { VersionDownloads } from '../../../../../lib/geometry-downloads';
import { GisEvaluation } from '../../../../../lib/gis-evaluation';
import { GeoProfileEvaluation } from '../../../../../lib/geo-profile';
import { SatelliteAnalysis } from '../../../../../lib/satellite';
import { FieldEvidence } from '../../../../../lib/field-evidence';
import { EventHistory } from '../../../../../lib/event-history';
import { GEOMETRY_STATUS, GEOMETRY_TYPE_LABEL, GeometrySketch, METHOD_LABEL, ha, positions, type Plot, type PlotVersion } from '../../../../../lib/plots';

interface HistoryRow { version: number; change_type: string; changed_fields: string[]; reason: string | null; changed_at: string; actor: string }
const CHANGE_LABEL: Record<string, string> = { CREATE: 'Registro', UPDATE: 'Edición', GEOMETRY_VERSION: 'Nueva versión geométrica', DECLARED_AREA: 'Superficie declarada actualizada (geometría conservada)', ARCHIVE: 'Baja', ACTIVATE: 'Reactivación' };
const FIELD_LABEL: Record<string, string> = { name: 'nombre', crop: 'cultivo', variety: 'variedad', land_use: 'uso del suelo', province: 'provincia', canton: 'cantón', parish: 'parroquia', status: 'estado', current_version_id: 'versión geométrica actual' };
const EDITABLE = ['name', 'crop', 'variety', 'land_use', 'province', 'canton', 'parish'] as const;

// UI-06 Ficha de parcela (docs/UX_UI.md §13.1). Separa «ubicación registrada» de «geometría validada»
// (P0-010) y «análisis revisado» (satélite). Sin botones de GPS, importación ni análisis: no existen aún.
export default function PlotDetailPage() {
  const { plotId } = useParams<{ plotId: string }>();
  const fromProducer = useSearchParams().get('productor');
  const ws = useWorkspace();
  const { t, dt, num, locale } = useI18n();
  const orgId = ws.activeOrg?.id ?? '';
  const region = locale === 'en' ? 'en-US' : 'es-EC';
  const [plot, setPlot] = useState<Plot | null>(null);
  const [versions, setVersions] = useState<PlotVersion[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    try {
      const [p, v, h] = await Promise.all([
        api<Plot>(`/api/v1/organizations/${orgId}/plots/${plotId}`),
        api<PlotVersion[]>(`/api/v1/organizations/${orgId}/plots/${plotId}/geometry-versions`),
        api<HistoryRow[]>(`/api/v1/organizations/${orgId}/plots/${plotId}/history`),
      ]);
      setPlot(p);
      setVersions(v);
      setHistory(h);
    } catch (err) {
      setError(err as ApiError);
    }
  }, [orgId, plotId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ws.activeOrg) return null;
  const producerHref = plot ? `/organizaciones/${orgId}/productores/${plot.producer.id}` : '';
  const crumbs = fromProducer && plot
    ? [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Productores'), href: `/organizaciones/${orgId}/productores` },
       { label: plot.producer.producer_code ?? t('Productor'), href: producerHref }, { label: plot.plot_code }]
    : [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Parcelas'), href: `/organizaciones/${orgId}/parcelas` }, { label: plot?.plot_code ?? t('Parcela') }];
  const current = plot?.current_version ?? null;

  return (
    <>
      <Breadcrumb items={crumbs} />
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!plot && !error && <Loading label={t('Cargando parcela…')} />}
      {plot && (
        <>
          <PageHeader
            title={`${plot.plot_code}${plot.name ? ` · ${plot.name}` : ''}`}
            meta={<>
              <StatusBadge tone={plot.status === 'ACTIVE' ? 'valid' : 'blocked'}>{plot.status === 'ACTIVE' ? t('Activa') : t('De baja')}</StatusBadge>
              <StatusBadge tone={GEOMETRY_STATUS[plot.geometry_status].tone}>{t(GEOMETRY_STATUS[plot.geometry_status].label)}</StatusBadge>
              <span>{t('Productor')}: <Link href={producerHref}>{plot.producer.producer_code} · {plot.producer.display_name}</Link></span>
              <span>{t('versión')} {plot.row_version}</span>
            </>}
          />
          {plot.status === 'INACTIVE' && <Alert tone="review" title={`${t('Parcela de baja')}: ${plot.deletion_reason ?? ''}.`}><p>{t('Sus versiones geométricas e historial se conservan.')}</p></Alert>}

          {plot.can_update ? <EditPlot orgId={orgId} plot={plot} onSaved={load} /> : (
            <section className="card">
              <h2>{t('Datos de la parcela')}</h2>
              <dl className="props">
                <dt>{t('Cultivo')}</dt><dd>{plot.crop}{plot.variety ? ` · ${plot.variety}` : ''}</dd>
                <dt>{t('Uso del suelo')}</dt><dd>{plot.land_use ?? t('Sin registrar')}</dd>
                <dt>{t('Provincia / cantón / parroquia')}</dt><dd>{[plot.province, plot.canton, plot.parish].map((v) => v ?? '—').join(' / ')}</dd>
              </dl>
            </section>
          )}

          <section className="card" aria-labelledby="geo-title">
            <h2 id="geo-title">{t('Ubicación y superficie')}</h2>
            {!current ? (
              <EmptyState title={t('Geometría pendiente.')}>
                <p className="muted">{t('Esta parcela aún no tiene ubicación ni superficie registradas. Puedes capturar un punto o un polígono con la ubicación del navegador.')}</p>
              </EmptyState>
            ) : (
              <>
                <dl className="props">
                  <dt>{t('Versión actual')}</dt><dd>v{current.version_number} · {t(METHOD_LABEL[current.survey_method] ?? current.survey_method)}{current.change_kind === 'DECLARED_AREA_UPDATE' && ` · ${t('superficie declarada actualizada; geometría capturada en v{n}', { n: current.geometry_origin_version_number ?? 0 })}`}</dd>
                  <dt>{t('Tipo de geometría')}</dt><dd>{current.geometry_type ? t(GEOMETRY_TYPE_LABEL[current.geometry_type]) : t('Sin geometría (solo superficie declarada)')}</dd>
                  <dt>{t('Superficie declarada')}</dt><dd>{ha(current.area_declared_ha, region) ?? t('Sin registrar')}</dd>
                  <dt>{t('Superficie calculada')}</dt><dd>{ha(current.area_calculated_ha, region) ?? (current.geometry_type === 'POINT' ? t('No aplica: un punto no tiene superficie') : current.geometry_type ? t('No calculada (geometría no válida para cálculo; se revisará en la validación GIS)') : t('Sin geometría'))}</dd>
                  {current.sample && (<>
                    <dt>{t('Captura')}</dt><dd>{t('Ubicación del navegador')} · {t('adquirida')} {dt(current.sample.captured_at)} · {t('recibida')} {dt(current.sample.received_at)}</dd>
                    <dt>{t('Precisión horizontal')}</dt><dd>{accuracyLabel(current.sample.horizontal_accuracy_m, t, num)}</dd>
                  </>)}
                  {current.source_import_sha256 && (<>
                    <dt>{t('Archivo original')}</dt><dd>{t('GeoJSON importado')} · SHA-256 <code className="hash">{current.source_import_sha256}</code></dd>
                  </>)}
                  {current.technically_valid === false && (<>
                    <dt>{t('Validez técnica')}</dt><dd><StatusBadge tone="review">{t('No válida')}</StatusBadge> <span className="muted">{t('Conservada para revisión; sin superficie calculada.')}</span></dd>
                  </>)}
                  <dt>{t('Validación GIS')}</dt><dd><StatusBadge tone="neutral">{t('No validada')}</StatusBadge> <span className="muted">{t('Solo comprobaciones estructurales ({v}). La validación GIS es P0-010.', { v: current.validation_rule_version })}</span></dd>
                </dl>
                {current.geometry_type && !current.geometry_visible && (
                  <p className="muted">{t('Tu rol no tiene acceso a las coordenadas exactas de esta parcela.')}</p>
                )}
                {current.geometry && (
                  <div className="grid-2">
                    <GeometrySketch geometry={current.geometry} label={t('Esquema de {c}, versión {v}', { c: plot.plot_code, v: current.version_number })} />
                    <CoordinatesTable version={current} />
                  </div>
                )}
              </>
            )}
            {plot.can_capture_location && <FieldCapture orgId={orgId} plot={plot} onChanged={load} />}
            {plot.can_update && <DeclaredAreaForm orgId={orgId} plot={plot} onSaved={load} />}
          </section>

          <GisEvaluation orgId={orgId} plotId={plot.id} canEvaluate={!!plot.can_evaluate_gis} hasVersion={!!plot.current_version} />
          {/* Dos dictámenes, a la vista y por separado: el técnico de arriba y el de perfil de destino. Pueden discrepar. */}
          <GeoProfileEvaluation orgId={orgId} plotId={plot.id} canEvaluate={!!plot.can_evaluate_gis} hasVersion={!!plot.current_version} />

          <SatelliteAnalysis orgId={orgId} plotId={plot.id} />

          <FieldEvidence orgId={orgId} plotId={plot.id} canUpload={!!plot.can_update && ws.can('document:upload')} />

          <section className="card" aria-labelledby="versions-title">
            <h2 id="versions-title">{t('Versiones geométricas')}</h2>
            <p className="muted">{t('Cada versión es inmutable: un cambio crea una versión nueva y la anterior se conserva para los registros que la usaron.')}</p>
            {versions.length === 0 ? <p className="muted">{t('Sin versiones.')}</p> : (
              <div className="table-wrap">
                <table aria-label={t('Versiones geométricas')}>
                  <thead><tr><th scope="col">{t('Versión')}</th><th scope="col">{t('Método')}</th><th scope="col">{t('Tipo')}</th><th scope="col">{t('Declarada')}</th><th scope="col">{t('Calculada')}</th><th scope="col">{t('Registrada')}</th>{plot.geometry_access && <th scope="col">{t('Descargas')}</th>}</tr></thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.id}>
                        <td>v{v.version_number} {v.is_current && <StatusBadge tone="process">{t('Actual')}</StatusBadge>}</td>
                        <td>{v.change_kind === 'DECLARED_AREA_UPDATE' ? t('Superficie declarada (geometría de v{n})', { n: v.geometry_origin_version_number ?? 0 }) : t(METHOD_LABEL[v.survey_method] ?? v.survey_method)}</td>
                        <td>{v.geometry_type ? t(GEOMETRY_TYPE_LABEL[v.geometry_type]) : '—'}</td>
                        <td>{ha(v.area_declared_ha, region) ?? '—'}</td>
                        <td>{ha(v.area_calculated_ha, region) ?? '—'}</td>
                        <td>{dt(v.created_at)}</td>
                        {plot.geometry_access && <td><VersionDownloads orgId={orgId} plotId={plot.id} version={v} /></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {plot.can_archive && <StatusPlot orgId={orgId} plot={plot} onSaved={load} />}

          <EventHistory orgId={orgId} kind="plots" id={plot.id} />

          <section className="card">
            <h2>{t('Historial')}</h2>
            <ul className="plain" aria-label={t('Historial de la parcela')}>
              {history.map((h) => (
                <li key={h.version}>
                  <strong>v{h.version} · {t(CHANGE_LABEL[h.change_type] ?? h.change_type)}</strong>{' '}
                  <span className="muted">· {h.actor === 'PLATFORM' ? t('Administración de plataforma') : h.actor} · {dt(h.changed_at)}
                    {h.changed_fields.length > 0 && ` · ${h.changed_fields.map((f) => t(FIELD_LABEL[f] ?? f)).join(', ')}`}{h.reason && ` · ${t('motivo')}: ${h.reason}`}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

function CoordinatesTable({ version }: { version: PlotVersion }) {
  const { t } = useI18n();
  const pts = positions(version.geometry);
  const shown = pts.slice(0, 50);
  return (
    <div className="table-wrap">
      <table aria-label={t('Coordenadas (WGS84)')}>
        <caption className="muted" style={{ textAlign: 'left', padding: '8px 16px' }}>{t('Coordenadas WGS84 (EPSG:4326). Los decimales no indican precisión del GPS.')}</caption>
        <thead><tr>{version.geometry_type !== 'POINT' && <th scope="col">{t('Anillo')}</th>}<th scope="col">{t('Latitud')} ({t('norte-sur')})</th><th scope="col">{t('Longitud')} ({t('este-oeste')})</th></tr></thead>
        <tbody>
          {shown.map((p, i) => <tr key={i}>{version.geometry_type !== 'POINT' && <td>{p.ring}</td>}<td>{p.lat}</td><td>{p.lon}</td></tr>)}
        </tbody>
      </table>
      {pts.length > shown.length && <p className="muted" style={{ padding: '8px 16px' }}>{t('Se muestran {a} de {b} posiciones.', { a: shown.length, b: pts.length })}</p>}
    </div>
  );
}

/** Edición con control de versión: ante conflicto se conserva el borrador y se puede recargar. */
function EditPlot({ orgId, plot, onSaved }: { orgId: string; plot: Plot; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const initial = Object.fromEntries(EDITABLE.map((k) => [k, (plot[k] as string | null) ?? '']));
  const [fields, setFields] = useState<Record<string, string>>(initial);
  const [base, setBase] = useState(initial);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v !== base[k]).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]));
    try {
      await api(`/api/v1/organizations/${orgId}/plots/${plot.id}`, { method: 'PATCH', body: { expected_version: plot.row_version, ...changed } });
      setSaved(true);
      setBase(fields);
      await onSaved();
    } catch (err) {
      setError(err as ApiError); // el borrador (fields) se conserva
    } finally {
      setBusy(false);
    }
  }

  async function reloadKeepingDraft() {
    await onSaved();
    setError(null);
  }

  const input = (key: (typeof EDITABLE)[number], label: string, required = false) => (
    <div>
      <label htmlFor={`pl-${key}`}>{label}{!required && <span className="muted"> ({t('opcional')})</span>}</label>
      <input id={`pl-${key}`} required={required} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} />
    </div>
  );

  return (
    <section className="card form">
      <h2>{t('Datos de la parcela')}</h2>
      <form onSubmit={submit}>
        <div className="grid-2">
          {input('name', t('Nombre'))}
          {input('crop', t('Cultivo'), true)}
          {input('variety', t('Variedad'))}
          {input('land_use', t('Uso del suelo'))}
          {input('province', t('Provincia'))}
          {input('canton', t('Cantón'))}
          {input('parish', t('Parroquia'))}
        </div>
        {saved && <p className="alert valid" role="status">{t('Cambios guardados.')}</p>}
        {error && (
          <>
            <ErrorPanel error={error} onReload={reloadKeepingDraft} />
            {error.status === 409 && <p className="muted">{t('Tus cambios siguen en el formulario: recarga la versión actual y vuelve a guardar.')}</p>}
          </>
        )}
        <button type="submit" disabled={busy} aria-busy={busy}>{busy ? t('Guardando…') : t('Guardar cambios')}</button>
      </form>
    </section>
  );
}

/** Superficie declarada: versión nueva que CONSERVA la geometría vigente (mismo caso de uso que la importación). */
function DeclaredAreaForm({ orgId, plot, onSaved }: { orgId: string; plot: Plot; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const [area, setArea] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/plots/${plot.id}/declared-area`, {
        method: 'POST', body: { expected_version: plot.row_version, area_declared_ha: Number(area.replace(',', '.')) },
      });
      setArea('');
      await onSaved();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form" aria-labelledby="declarada-title">
      <h3 id="declarada-title">{t('Actualizar superficie declarada')}</h3>
      <p className="field-help">{t('Crea una versión nueva con la superficie declarada. Si la parcela tiene ubicación o polígono, se conservan tal cual (no es una captura nueva). La superficie calculada no cambia y la versión queda sin validar: la evaluación GIS anterior no se hereda.')}</p>
      <label htmlFor="area">{t('Superficie declarada (ha)')}</label>
      <input id="area" inputMode="decimal" required pattern="[0-9]+([.,][0-9]{1,4})?" value={area} onChange={(e) => setArea(e.target.value)} />
      {error && <ErrorPanel error={error} onReload={onSaved} />}
      <button type="submit" className="secondary" disabled={busy} aria-busy={busy}>{busy ? t('Guardando…') : t('Registrar superficie')}</button>
    </form>
  );
}

function StatusPlot({ orgId, plot, onSaved }: { orgId: string; plot: Plot; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const archiving = plot.status === 'ACTIVE';
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/plots/${plot.id}/${archiving ? 'archive' : 'activate'}`, { method: 'POST', body: { expected_version: plot.row_version, reason } });
      setReason('');
      await onSaved();
    } catch (err) {
      setError(err as ApiError);
    }
  }
  return (
    <section className="card form">
      <h2>{archiving ? t('Dar de baja la parcela') : t('Reactivar parcela')}</h2>
      <p className="muted">{archiving ? t('La baja de «{c}» es lógica: la parcela, sus versiones e historial se conservan.', { c: plot.plot_code }) : t('Vuelve a quedar disponible para operar.')}</p>
      <form onSubmit={submit}>
        <label htmlFor="pl-reason">{t('Motivo (queda en el historial)')}</label>
        <input id="pl-reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <ErrorPanel error={error} onReload={onSaved} />}
        <button type="submit" className={archiving ? 'danger' : ''}>{archiving ? t('Dar de baja') : t('Reactivar')}</button>
      </form>
    </section>
  );
}
