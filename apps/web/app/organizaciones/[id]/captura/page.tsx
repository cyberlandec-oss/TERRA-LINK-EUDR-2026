'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { FieldCapture } from '../../../../lib/field-capture';
import { FieldEvidence } from '../../../../lib/field-evidence';
import { useI18n } from '../../../../lib/i18n';
import { accuracyLabel } from '../../../../lib/location-capture';
import { GEOMETRY_STATUS, METHOD_LABEL, ha, type Plot } from '../../../../lib/plots';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// A-01 — Captura de campo guiada desde la web: productor → parcela → ubicación → revisión → evidencias.
//   · Solo se ofrecen los productores y las parcelas que la API devuelve para TU alcance (propio, asignado o de gestión);
//     el servidor decide siempre, esta pantalla solo refleja.
//   · La ubicación se registra en la PARCELA agrícola; los lotes comerciales conservan su vínculo con esas parcelas.
//   · La revisión antes de confirmar la hace el servidor (en cada método); la evidencia se adjunta a la parcela.
interface ProducerRow { id: string; producer_code: string; display_name: string; status: string }

export default function CapturaPage() {
  const ws = useWorkspace();
  const { t, dt, num, locale } = useI18n();
  const orgId = ws.activeOrg?.id ?? '';
  const region = locale === 'en' ? 'en-US' : 'es-EC';
  const [producers, setProducers] = useState<ProducerRow[] | null>(null);
  const [producerId, setProducerId] = useState('');
  const [plots, setPlots] = useState<Plot[] | null>(null);
  const [plotId, setPlotId] = useState('');
  const [plot, setPlot] = useState<Plot | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [q, setQ] = useState('');

  const loadProducers = useCallback(async (term = '') => {
    if (!orgId) return;
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (term.trim()) params.set('q', term.trim());
      const r = await api<{ items: ProducerRow[] }>(`/api/v1/organizations/${orgId}/producers?${params}`);
      setProducers(r.items);
      setError(null);
    } catch (err) { setError(err as ApiError); }
  }, [orgId]);
  useEffect(() => { void loadProducers(); }, [loadProducers]);

  // Quien tiene un único productor propio no necesita elegir: se selecciona solo.
  useEffect(() => { if (producers && producers.length === 1 && !producerId) setProducerId(producers[0].id); }, [producers, producerId]);

  const loadPlots = useCallback(async () => {
    if (!orgId || !producerId) { setPlots(null); return; }
    try {
      const r = await api<{ items: Plot[] }>(`/api/v1/organizations/${orgId}/plots?producer_id=${producerId}&limit=100`);
      setPlots(r.items);
    } catch (err) { setError(err as ApiError); }
  }, [orgId, producerId]);
  useEffect(() => { setPlotId(''); setPlot(null); void loadPlots(); }, [loadPlots]);

  const loadPlot = useCallback(async () => {
    if (!orgId || !plotId) { setPlot(null); return; }
    try { setPlot(await api<Plot>(`/api/v1/organizations/${orgId}/plots/${plotId}`)); setError(null); }
    catch (err) { setError(err as ApiError); }
  }, [orgId, plotId]);
  useEffect(() => { void loadPlot(); }, [loadPlot]);

  if (!ws.activeOrg) return null;
  const canCreate = ws.can('plot:create') || ws.can('plot:create_assigned') || ws.can('plot:create_own');
  const current = plot?.current_version ?? null;
  const step = !producerId ? 1 : !plotId ? 2 : 3;
  const steps = [t('Productor'), t('Parcela'), t('Ubicación y revisión'), t('Evidencias')];

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Captura de campo') }]} />
      <PageHeader title={t('Captura de campo')} meta={<span>{t('Ubica tu parcela, registra su polígono y adjunta fotos o documentos. Revisa los datos antes de guardarlos.')}</span>} />
      <details className="card">
        <summary>{t('Qué hace esta pantalla y qué no')}</summary>
        <p>{t('Registra coordenadas en la parcela agrícola, siempre con su procedencia, y las revisa en el servidor antes de guardarlas. No valida la parcela, no aprueba evidencias ni concluye riesgo: eso son pasos aparte de otras personas autorizadas.')}</p>
      </details>
      <ol className="steps" aria-label={t('Pasos')}>
        {steps.map((s, i) => <li key={s} aria-current={Math.min(step, 3) === i + 1 || (i === 3 && step === 3 && !!plot) ? 'step' : undefined}><strong>{i + 1}.</strong> {s}</li>)}
      </ol>

      {error && <ErrorPanel error={error} onRetry={() => { void loadProducers(q); void loadPlots(); void loadPlot(); }} />}
      {!producers && !error && <Loading label={t('Cargando tus productores…')} />}

      {producers && (
        <section className="card" aria-labelledby="cap-prod">
          <h2 id="cap-prod">1. {t('Productor')}</h2>
          {producers.length === 0 && !q ? (
            <EmptyState title={t('No tienes productores a los que puedas registrar ubicaciones.')}>
              <p className="muted">{t('Si eres productor, pide a la administración de tu organización que vincule tu cuenta a tu productor.')}</p>
            </EmptyState>
          ) : (
            <>
              {(producers.length > 1 || q) && (
                <form role="search" aria-label={t('Buscar productores')} onSubmit={(e: FormEvent) => { e.preventDefault(); void loadProducers(q); }} className="actions">
                  <div><label htmlFor="cap-q">{t('Buscar por código o nombre')}</label><input id="cap-q" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                  <button type="submit" className="secondary">{t('Buscar')}</button>
                </form>
              )}
              <label htmlFor="cap-producer">{t('Productor')}</label>
              <select id="cap-producer" value={producerId} onChange={(e) => setProducerId(e.target.value)}>
                <option value="">{t('Elige un productor…')}</option>
                {producers.map((p) => <option key={p.id} value={p.id}>{p.producer_code} · {p.display_name}</option>)}
              </select>
              {producers.length === 0 && <p className="muted">{t('No encontramos resultados con estos filtros.')}</p>}
            </>
          )}
        </section>
      )}

      {producerId && plots && (
        <section className="card" aria-labelledby="cap-plot">
          <h2 id="cap-plot">2. {t('Parcela')}</h2>
          {plots.length === 0 ? (
            <EmptyState title={t('Este productor todavía no tiene parcelas.')} />
          ) : (
            <>
              <label htmlFor="cap-plotsel">{t('Parcela')}</label>
              <select id="cap-plotsel" value={plotId} onChange={(e) => setPlotId(e.target.value)}>
                <option value="">{t('Elige una parcela…')}</option>
                {plots.map((p) => <option key={p.id} value={p.id}>{p.plot_code}{p.name ? ` · ${p.name}` : ''} — {t(GEOMETRY_STATUS[p.geometry_status].label)}</option>)}
              </select>
            </>
          )}
          {canCreate && <NewPlot orgId={orgId} producerId={producerId} onCreated={async (id) => { await loadPlots(); setPlotId(id); }} />}
        </section>
      )}

      {plotId && !plot && !error && <Loading label={t('Cargando parcela…')} />}
      {plot && (
        <>
          <section className="card" aria-labelledby="cap-state">
            <h2 id="cap-state">3. {t('Ubicación y revisión')}: {plot.plot_code}</h2>
            <p>
              <StatusBadge tone={GEOMETRY_STATUS[plot.geometry_status].tone}>{t(GEOMETRY_STATUS[plot.geometry_status].label)}</StatusBadge>{' '}
              <Link href={`/organizaciones/${orgId}/parcelas/${plot.id}`}>{t('Abrir la ficha completa de la parcela')}</Link>
            </p>
            {current?.geometry_type ? (
              <dl className="props">
                <dt>{t('Versión vigente')}</dt><dd>v{current.version_number} · {t(METHOD_LABEL[current.survey_method] ?? current.survey_method)} · {dt(current.created_at)}</dd>
                <dt>{t('Superficie calculada')}</dt><dd>{ha(current.area_calculated_ha, region) ?? t('No calculada')}</dd>
                {current.sample && <><dt>{t('Precisión horizontal')}</dt><dd>{accuracyLabel(current.sample.horizontal_accuracy_m, t, num)}</dd></>}
                {current.survey_method === 'MANUAL_COORDINATES' && <><dt>{t('Procedencia')}</dt><dd>{t('Coordenadas ingresadas')} — {t('NO acreditan una medición GPS ni su precisión.')}</dd></>}
              </dl>
            ) : <p className="muted">{t('Esta parcela todavía no tiene ubicación registrada.')}</p>}
            {plot.can_capture_location
              ? <FieldCapture orgId={orgId} plot={plot} onChanged={loadPlot} />
              : <Alert tone="review" title={t('No puedes registrar ubicaciones en esta parcela.')}><p>{plot.status === 'INACTIVE' ? t('La parcela está dada de baja.') : t('Tu rol o tu alcance no lo permiten.')}</p></Alert>}
          </section>
          <FieldEvidence orgId={orgId} plotId={plot.id} canUpload={!!plot.can_update && ws.can('document:upload')} />
        </>
      )}
    </>
  );
}

/** Alta mínima de una parcela del productor elegido; los demás datos se completan en su ficha. */
function NewPlot({ orgId, producerId, onCreated }: { orgId: string; producerId: string; onCreated: (id: string) => Promise<void> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [crop, setCrop] = useState('Cacao');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const p = await api<{ id: string }>(`/api/v1/organizations/${orgId}/plots`, { method: 'POST', body: { producer_id: producerId, plot_code: code.trim(), crop: crop.trim() } });
      setCode(''); setOpen(false);
      await onCreated(p.id);
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }
  if (!open) return <p><button type="button" className="secondary" onClick={() => setOpen(true)}>{t('Registrar una parcela nueva')}</button></p>;
  return (
    <form onSubmit={submit} className="stack" aria-label={t('Registrar una parcela nueva')}>
      <h3>{t('Registrar una parcela nueva')}</h3>
      <label htmlFor="np-code">{t('Código de la parcela')}</label>
      <input id="np-code" required minLength={1} maxLength={40} value={code} onChange={(e) => setCode(e.target.value)} />
      <label htmlFor="np-crop">{t('Cultivo')}</label>
      <input id="np-crop" required value={crop} onChange={(e) => setCrop(e.target.value)} />
      {error && <ErrorPanel error={error} />}
      <div className="actions">
        <button type="submit" disabled={busy} aria-busy={busy}>{busy ? t('Guardando…') : t('Crear parcela')}</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)} disabled={busy}>{t('Cancelar')}</button>
      </div>
    </form>
  );
}
