'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api';
import { useI18n } from './i18n';
import { accuracyLabel } from './location-capture';
import { GeometrySketch } from './plots';
import { ErrorPanel, StatusBadge } from './ui';

// P0-008 Polígono (UX_UI §13.3). Borrador persistido EN EL SERVIDOR (no es modo offline):
// recargar la página reabre el borrador. Cada vértice es una muestra de la ubicación del navegador
// con su operation_id; reintentar un guardado incierto no duplica el vértice.
// El anillo se cierra con el primer vértice: el cierre no es una muestra nueva.
// A-01: español (fuente) e inglés. El resumen de precisión se compone aquí a partir de los datos estructurados.

interface DraftVertex {
  id: string; acquisition_seq: number; source: string; longitude: number; latitude: number;
  horizontal_accuracy_m: number | null; captured_at: string; received_at: string; excluded: boolean;
}
interface Draft {
  id: string; status: string; row_version: number;
  vertices: DraftVertex[];
  accuracy_summary: { with_accuracy: number; without_accuracy: number; worst_known_m: number | null; complete: boolean; label: string };
  preview: {
    vertex_count: number; distinct_count: number; repeated_vertices: number; storable: boolean; structural_issues: string[];
    technically_valid: boolean | null; validity_reason: string | null; area_calculated_ha: string | null;
  };
}
interface Sample { operation_id: string; latitude: number; longitude: number; accuracy_m: number | null; captured_at: string }

type Capture =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'failed'; message: string }
  | { kind: 'review'; sample: Sample }
  | { kind: 'saving'; sample: Sample }
  | { kind: 'uncertain'; sample: Sample; error: ApiError }
  | { kind: 'conflict'; sample: Sample }
  | { kind: 'rejected'; sample: Sample; error: ApiError };

type Tr = (es: string, vars?: Record<string, string | number>) => string;

/** Resumen de precisión a partir de los conteos: no se inventa una precisión agregada (doc 10). */
export function accuracySummaryLabel(a: Pick<Draft['accuracy_summary'], 'with_accuracy' | 'without_accuracy' | 'worst_known_m'>, total: number, t: Tr, num: (v: number, max?: number) => string): string {
  if (total === 0) return t('Sin vértices');
  if (a.with_accuracy === 0) return t('Precisión no informada');
  const vars = { n: a.with_accuracy, m: a.without_accuracy, w: num(a.worst_known_m ?? 0, 1) };
  const base = a.with_accuracy === 1
    ? t('{n} vértice con precisión informada; {m} sin informar; peor precisión conocida {w} m', vars)
    : t('{n} vértices con precisión informada; {m} sin informar; peor precisión conocida {w} m', vars);
  return a.without_accuracy > 0 ? `${base} ${t('(resumen incompleto)')}` : base;
}

export function PolygonCapture({ orgId, plotId, plotVersion, onConfirmed }: {
  orgId: string; plotId: string; plotVersion: number; onConfirmed: () => Promise<void>;
}) {
  const { t, dt, num, locale } = useI18n();
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  const [capture, setCapture] = useState<Capture>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [keepInvalid, setKeepInvalid] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const cancelled = useRef(false);
  const base = `/api/v1/organizations/${orgId}`;
  const ISSUE: Record<string, string> = { LESS_THAN_3_DISTINCT_VERTICES: t('Se necesitan al menos 3 vértices distintos.') };

  const reload = useCallback(async () => {
    try {
      const r = await api<{ draft: Draft | null }>(`${base}/plots/${plotId}/polygon-drafts/current`);
      setDraft(r.draft);
      setError(null);
    } catch (e) { setError(e as ApiError); }
  }, [base, plotId]);
  useEffect(() => { void reload(); return () => { cancelled.current = true; }; }, [reload]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); } catch (e) {
      const err = e as ApiError;
      setError(err);
      if (err.status === 409) await reload();
    } finally { setBusy(false); }
  }

  const start = () => run(async () => { setDraft(await api<Draft>(`${base}/plots/${plotId}/polygon-drafts`, { method: 'POST' })); });

  function locate() {
    if (!(typeof window !== 'undefined' && 'geolocation' in navigator && window.isSecureContext)) {
      setCapture({ kind: 'failed', message: t('Este navegador o esta conexión no permiten obtener la ubicación (usa https o localhost).') });
      return;
    }
    cancelled.current = false;
    setCapture({ kind: 'requesting' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled.current) return;
        const acc = pos.coords.accuracy;
        setCapture({ kind: 'review', sample: {
          operation_id: crypto.randomUUID(), latitude: pos.coords.latitude, longitude: pos.coords.longitude,
          accuracy_m: typeof acc === 'number' && Number.isFinite(acc) && acc >= 0 ? acc : null,
          captured_at: new Date(pos.timestamp).toISOString(),
        } });
      },
      (err) => {
        if (cancelled.current) return;
        setCapture({ kind: 'failed', message: err.code === err.PERMISSION_DENIED
          ? t('El navegador no tiene permiso para usar tu ubicación. Habilítalo en la configuración del sitio y vuelve a intentarlo.')
          : err.code === err.TIMEOUT ? t('La ubicación tardó demasiado en llegar. Vuelve a intentarlo.') : t('No se pudo determinar la ubicación. Activa los servicios de ubicación y vuelve a intentarlo.') });
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  async function saveVertex(sample: Sample) {
    if (!draft) return;
    setCapture({ kind: 'saving', sample });
    try {
      const r = await api<{ draft: Draft; replayed: boolean }>(`${base}/polygon-drafts/${draft.id}/vertices`, {
        method: 'POST', body: { expected_version: draft.row_version, source: 'BROWSER_GEOLOCATION', ...sample },
      });
      setDraft(r.draft);
      setCapture({ kind: 'idle' });
      setNotice(r.replayed ? t('El servidor ya tenía este vértice; no se duplicó.') : t('Vértice {n} guardado.', { n: r.draft.preview.vertex_count }));
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.body.code === 'VERSION_CONFLICT') setCapture({ kind: 'conflict', sample });
      else if (err.status === 0 || err.status >= 500) setCapture({ kind: 'uncertain', sample, error: err });
      else setCapture({ kind: 'rejected', sample, error: err });
    }
  }

  const undo = () => run(async () => { if (draft) setDraft(await api<Draft>(`${base}/polygon-drafts/${draft.id}/undo`, { method: 'POST', body: { expected_version: draft.row_version } })); });
  const cancelDraft = () => run(async () => {
    if (!draft || !window.confirm(t('¿Cancelar el borrador? Los vértices capturados se conservan en el historial, pero no se creará ninguna versión.'))) return;
    await api(`${base}/polygon-drafts/${draft.id}/cancel`, { method: 'POST', body: { expected_version: draft.row_version } });
    setDraft(null); setReviewing(false); setCapture({ kind: 'idle' });
  });
  const confirm = () => run(async () => {
    if (!draft) return;
    const r = await api<{ version: { version_number: number } }>(`${base}/polygon-drafts/${draft.id}/confirm`, {
      method: 'POST', body: { expected_version: draft.row_version, plot_expected_version: plotVersion, keep_invalid_for_review: keepInvalid },
    });
    setDraft(null); setReviewing(false); setKeepInvalid(false);
    setNotice(t('Polígono guardado como versión {n}. Sigue sin validación GIS (P0-010).', { n: r.version.version_number }));
    await onConfirmed();
  });

  if (draft === undefined) return error ? <ErrorPanel error={error} /> : <p className="muted">{t('Cargando borrador de polígono…')}</p>;

  const included = draft?.vertices.filter((v) => !v.excluded) ?? [];
  const sketch = included.length >= 2
    ? { type: 'Polygon', coordinates: [[...included.map((v) => [v.longitude, v.latitude]), [included[0].longitude, included[0].latitude]]] }
    : included.length === 1 ? { type: 'Point', coordinates: [included[0].longitude, included[0].latitude] } : null;
  const pv = draft?.preview;
  const precision = draft ? accuracySummaryLabel(draft.accuracy_summary, draft.vertices.filter((v) => !v.excluded).length, t, num) : '';

  return (
    <div className="capture polygon-capture" aria-live="polite">
      <h3>{t('Capturar polígono')}</h3>
      <p className="field-help">{t('Recorre el borde de la parcela y guarda un vértice en cada esquina. El borrador se guarda en el servidor: si recargas la página, lo recuperas. No funciona sin conexión.')}</p>
      {notice && <p className="alert valid" role="status">{notice}</p>}
      {error && <ErrorPanel error={error} />}
      {error?.status === 409 && <p className="muted">{t('El borrador cambió en otra pestaña o dispositivo; se recargó la versión actual.')}</p>}

      {!draft ? (
        <button type="button" onClick={start} disabled={busy}>{t('Iniciar captura de polígono')}</button>
      ) : (
        <>
          <div className="actions">
            <StatusBadge tone="process">{t('Borrador abierto')}</StatusBadge>
            <span className="muted">{t(included.length === 1 ? '{n} vértice · versión {v}' : '{n} vértices · versión {v}', { n: included.length, v: draft.row_version })}</span>
          </div>

          {capture.kind === 'idle' && !reviewing && (
            <div className="actions">
              <button type="button" onClick={locate} disabled={busy}>{t('Añadir vértice')}</button>
              <button type="button" className="secondary" onClick={undo} disabled={busy || included.length === 0}>{t('Deshacer último')}</button>
              <button type="button" className="secondary" onClick={() => setReviewing(true)} disabled={busy || included.length === 0}>{t('Revisar y confirmar')}</button>
              <button type="button" className="secondary" onClick={cancelDraft} disabled={busy}>{t('Cancelar borrador')}</button>
            </div>
          )}
          {capture.kind === 'requesting' && (
            <div className="actions">
              <p className="muted" role="status">{t('Obteniendo ubicación… Si el navegador lo pregunta, permite el acceso.')}</p>
              <button type="button" className="secondary" onClick={() => { cancelled.current = true; setCapture({ kind: 'idle' }); }}>{t('Cancelar')}</button>
            </div>
          )}
          {capture.kind === 'failed' && (
            <div className="error" role="alert">
              <p>{capture.message}</p>
              <div className="actions">
                <button type="button" onClick={locate}>{t('Intentar de nuevo')}</button>
                <button type="button" className="secondary" onClick={() => setCapture({ kind: 'idle' })}>{t('Cerrar')}</button>
              </div>
            </div>
          )}
          {(capture.kind === 'review' || capture.kind === 'saving' || capture.kind === 'uncertain' || capture.kind === 'conflict' || capture.kind === 'rejected') && (
            <div className="card capture-review">
              <p className="alert-title">{t('Vértice {n}: revisa la muestra', { n: included.length + 1 })}</p>
              <dl className="props" aria-label={t('Muestra del vértice')}>
                <dt>{t('Latitud')} ({t('norte-sur')})</dt><dd>{capture.sample.latitude}</dd>
                <dt>{t('Longitud')} ({t('este-oeste')})</dt><dd>{capture.sample.longitude}</dd>
                <dt>{t('Precisión horizontal')}</dt><dd>{accuracyLabel(capture.sample.accuracy_m, t, num)}</dd>
                <dt>{t('Hora de adquisición')}</dt><dd>{dt(capture.sample.captured_at)}</dd>
                <dt>{t('Fuente')}</dt><dd>{t('Ubicación del navegador (no acredita un GPS)')}</dd>
              </dl>
              {capture.kind === 'uncertain' && (
                <div className="error" role="alert">
                  <p className="alert-title">{t('No pudimos confirmar el guardado')}</p>
                  <p>{t('La muestra se conserva. «Reintentar» no duplica el vértice: el servidor reconoce este envío.')}</p>
                </div>
              )}
              {capture.kind === 'conflict' && (
                <div className="error" role="alert">
                  <p className="alert-title">{t('El borrador cambió en otra pestaña o dispositivo.')}</p>
                  <p>{t('La muestra se conserva. Recarga el borrador, revisa los vértices y vuelve a guardarla.')}</p>
                </div>
              )}
              {capture.kind === 'rejected' && <ErrorPanel error={capture.error} />}
              <div className="actions">
                {capture.kind === 'conflict' ? (
                  <button type="button" onClick={async () => { await reload(); setCapture({ kind: 'review', sample: capture.sample }); }}>{t('Recargar borrador')}</button>
                ) : capture.kind !== 'rejected' && (
                  <button type="button" onClick={() => saveVertex(capture.sample)} disabled={capture.kind === 'saving'} aria-busy={capture.kind === 'saving'}>
                    {capture.kind === 'saving' ? t('Guardando…') : capture.kind === 'uncertain' ? t('Reintentar guardado') : t('Guardar vértice')}
                  </button>
                )}
                <button type="button" className="secondary" onClick={() => setCapture({ kind: 'idle' })} disabled={capture.kind === 'saving'}>{t('Descartar muestra')}</button>
              </div>
            </div>
          )}

          <p><strong>{t('Precisión')}:</strong> {precision}</p>
          <div className="grid-2">
            {sketch ? <GeometrySketch geometry={sketch} label={t('Vista previa del borrador con {n} vértices', { n: included.length })} /> : <p className="muted">{t('Aún no hay vértices.')}</p>}
            <div className="table-wrap">
              <table aria-label={t('Vértices del borrador')}>
                <thead><tr><th scope="col">#</th><th scope="col">{t('Latitud')}</th><th scope="col">{t('Longitud')}</th><th scope="col">{t('Precisión')}</th><th scope="col">{t('Adquirido')}</th></tr></thead>
                <tbody>
                  {draft.vertices.map((v) => (
                    <tr key={v.id} className={v.excluded ? 'muted' : undefined}>
                      <td>{v.excluded ? <s>{v.acquisition_seq}</s> : v.acquisition_seq}{v.excluded && <span className="sr-only"> ({t('deshecho')})</span>}</td>
                      <td>{v.latitude}</td><td>{v.longitude}</td>
                      <td>{accuracyLabel(v.horizontal_accuracy_m, t, num)}</td>
                      <td>{new Date(v.captured_at).toLocaleTimeString(locale === 'en' ? 'en-US' : 'es-EC')}{v.excluded && ` · ${t('deshecho')}`}</td>
                    </tr>
                  ))}
                  {included.length >= 3 && <tr><td colSpan={5} className="muted">{t('Cierre: vuelve al vértice {n} (no es una muestra nueva).', { n: included[0].acquisition_seq })}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {reviewing && pv && (
            <section className="card" aria-labelledby="poly-review">
              <h4 id="poly-review">{t('Revisión antes de confirmar')}</h4>
              <dl className="props">
                <dt>{t('Vértices')}</dt><dd>{pv.vertex_count} ({t('{n} distintos', { n: pv.distinct_count })}{pv.repeated_vertices ? `; ${t('{n} repetido(s) consecutivo(s)', { n: pv.repeated_vertices })}` : ''})</dd>
                <dt>{t('Estructura almacenable')}</dt><dd>{pv.storable ? t('Sí') : `${t('No')}: ${pv.structural_issues.map((i) => ISSUE[i] ?? i).join(' ')}`}</dd>
                <dt>{t('Validez técnica')}</dt><dd>{pv.technically_valid === null ? t('No evaluada') : pv.technically_valid ? t('Válida') : `${t('No válida')}: ${pv.validity_reason}`}</dd>
                <dt>{t('Superficie calculada')}</dt><dd>{pv.area_calculated_ha ? `${num(Number(pv.area_calculated_ha), 4)} ha` : t('No calculada')}</dd>
                <dt>{t('Precisión')}</dt><dd>{precision}</dd>
                <dt>{t('Validación GIS')}</dt><dd>{t('Pendiente (P0-010). Confirmar no valida la parcela.')}</dd>
              </dl>
              {pv.technically_valid === false && (
                <div className="alert" role="alert">
                  <p className="alert-title">{t('La forma se cruza consigo misma o no es válida.')}</p>
                  <p>{t('Corrige con «Deshacer último» y vuelve a capturar. Si necesitas conservarla tal cual para que alguien la revise, márcalo: se guardará sin superficie y nunca como válida.')}</p>
                  <label><input type="checkbox" checked={keepInvalid} onChange={(e) => setKeepInvalid(e.target.checked)} /> {t('Conservar para revisión, sin superficie')}</label>
                </div>
              )}
              <div className="actions">
                <button type="button" onClick={confirm} disabled={busy || !pv.storable || (pv.technically_valid === false && !keepInvalid)} aria-busy={busy}>
                  {busy ? t('Confirmando…') : t('Confirmar polígono')}
                </button>
                <button type="button" className="secondary" onClick={() => setReviewing(false)} disabled={busy}>{t('Seguir capturando')}</button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
