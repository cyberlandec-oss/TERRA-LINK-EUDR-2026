'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api';
import { translate, useI18n } from './i18n';
import { type MyLocation } from './mi-ubicacion';
import { ErrorPanel } from './ui';
import { listOfflineCaptures, removeOfflineCapture, saveOfflineCapture, updateOfflineCapture, type OfflineLocationCapture } from './offline-capture';

const MapCapture = dynamic(() => import('./map-capture').then((m) => m.MapCapture), { ssr: false });

// P0-007 Captura de ubicación desde el navegador (UX_UI §13.3, UI-07).
// Flujo: solicitar → obtener muestra → revisar → confirmar guardado → resultado del servidor.
// - La Geolocation API puede usar GPS, Wi-Fi, red o IP: se registra como BROWSER_GEOLOCATION, no como GPS.
// - Nunca guarda automáticamente; si falla, no inventa coordenadas ni precisión.
// - La muestra (con su operation_id) se conserva ante conflicto o resultado incierto: reintentar es
//   idempotente en el servidor.
// A-01: textos en español (fuente) e inglés; el orden de las coordenadas (latitud / longitud) se rotula siempre.

interface Sample {
  operation_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  captured_at: string;
}

type State =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'failed'; code: 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED' }
  | { kind: 'review'; sample: Sample }
  | { kind: 'saving'; sample: Sample }
  | { kind: 'save-error'; sample: Sample; error: ApiError }
  | { kind: 'queued'; sample: Sample }
  | { kind: 'storage-error'; sample: Sample; message: string }
  | { kind: 'saved'; versionNumber: number; receivedAt: string };

type Tr = (es: string, vars?: Record<string, string | number>) => string;

const failure = (t: Tr): Record<'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED', { title: string; help: string }> => ({
  DENIED: { title: t('El navegador no tiene permiso para usar tu ubicación.'), help: t('Habilita la ubicación para este sitio en la configuración del navegador (icono junto a la dirección) y vuelve a intentarlo.') },
  UNAVAILABLE: { title: t('No se pudo determinar la ubicación.'), help: t('Activa los servicios de ubicación del dispositivo, sal a cielo abierto si es posible y vuelve a intentarlo.') },
  TIMEOUT: { title: t('La ubicación tardó demasiado en llegar.'), help: t('Vuelve a intentarlo; en interiores o con señal débil puede tardar más.') },
  UNSUPPORTED: { title: t('Este navegador o esta conexión no permiten obtener la ubicación.'), help: t('Usa un navegador actualizado y una dirección segura (https o localhost).') },
});

export function accuracyLabel(acc: number | null, t: Tr = (es, vars) => translate('es', es, vars), num: (v: number, max?: number) => string = (v, max = 1) => v.toLocaleString('es-EC', { maximumFractionDigits: max })): string {
  if (acc === null) return t('No informada por el navegador');
  if (acc === 0) return t('0 m (valor informado por el navegador; no implica precisión perfecta)');
  return t('± {m} m (informada)', { m: num(acc, 1) });
}

export function LocationCapture({ orgId, plotId, rowVersion, ownerKey, onSaved, existing = [] }: {
  orgId: string; plotId: string; rowVersion: number; ownerKey: string; onSaved: () => Promise<void>;
  /** Geometría vigente de la parcela (solo para mostrarla como referencia en el mapa). */
  existing?: Array<{ lon: number; lat: number }>;
}) {
  const { t, dt, num } = useI18n();
  const FAILURE = failure(t);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [showMap, setShowMap] = useState(false);
  const [pending, setPending] = useState<OfflineLocationCapture[]>([]);
  const [online, setOnline] = useState(true);
  const syncing = useRef(false);
  const cancelled = useRef(false);
  const supported = typeof window !== 'undefined' && 'geolocation' in navigator && window.isSecureContext;

  useEffect(() => () => { cancelled.current = true; }, []);

  const loadPending = async () => {
    try {
      const rows = await listOfflineCaptures(ownerKey, orgId, plotId);
      setPending(rows);
      const draft = rows.find((row) => !row.confirmed && row.status === 'DRAFT');
      if (draft && state.kind === 'idle') setState({ kind: 'review', sample: draft });
      return rows;
    } catch { setPending([]); return []; }
  };
  useEffect(() => {
    setOnline(navigator.onLine);
    void loadPending().then(() => { if (navigator.onLine) void syncPending(true); });
    const onOnline = () => { setOnline(true); void syncPending(true); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [ownerKey, orgId, plotId]);

  function request() {
    if (!supported) {
      setState({ kind: 'failed', code: 'UNSUPPORTED' });
      return;
    }
    cancelled.current = false;
    setState({ kind: 'requesting' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled.current) return;
        const acc = pos.coords.accuracy;
        void acquire({
            operation_id: crypto.randomUUID(),
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy_m: typeof acc === 'number' && Number.isFinite(acc) && acc >= 0 ? acc : null,
            captured_at: new Date(pos.timestamp).toISOString(), // hora de adquisición del dispositivo
        });
      },
      (err) => {
        if (cancelled.current) return;
        setState({ kind: 'failed', code: err.code === err.PERMISSION_DENIED ? 'DENIED' : err.code === err.TIMEOUT ? 'TIMEOUT' : 'UNAVAILABLE' });
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  /** «Mi ubicación» → «Usar como punto de referencia»: abre la MISMA revisión de muestra; no se guarda hasta «Guardar como nueva versión». */
  function usarComoReferencia(l: MyLocation) {
    if (state.kind !== 'idle') return;
    void acquire({ operation_id: crypto.randomUUID(), latitude: l.latitude, longitude: l.longitude, accuracy_m: l.accuracy_m, captured_at: l.captured_at });
  }

  function cancel() {
    cancelled.current = true;
    setState({ kind: 'idle' });
  }

  async function save(sample: Sample) {
    setState({ kind: 'saving', sample });
    try {
      await updateOfflineCapture(sample.operation_id, { confirmed: true, status: 'PENDING' });
      const res = await api<{ version: { version_number: number; sample: { received_at: string } } }>(
        `/api/v1/organizations/${orgId}/plots/${plotId}/location-samples`,
        { method: 'POST', body: { expected_version: rowVersion, source: 'BROWSER_GEOLOCATION', ...sample } },
      );
      await removeOfflineCapture(sample.operation_id);
      await loadPending();
      setState({ kind: 'saved', versionNumber: res.version.version_number, receivedAt: res.version.sample.received_at });
      await onSaved();
    } catch (err) {
      const error = err as ApiError;
      if (error.status === 0) {
        await loadPending();
        setState({ kind: 'queued', sample });
      } else {
        await updateOfflineCapture(sample.operation_id, { status: error.status === 409 ? 'CONFLICT' : 'ERROR', last_error: error.body?.code ?? 'SAVE_FAILED' });
        await loadPending();
        setState({ kind: 'save-error', sample, error });
      }
    }
  }

  async function syncPending(forceOnline = false) {
    if (syncing.current || (!online && !forceOnline)) return;
    syncing.current = true;
    try {
      const rows = await loadPending();
      for (const item of rows.filter((row) => row.confirmed && row.status === 'PENDING')) {
        await updateOfflineCapture(item.operation_id, { status: 'SYNCING', last_error: undefined });
        try {
          await api(`/api/v1/organizations/${orgId}/plots/${plotId}/location-samples`, { method: 'POST', body: {
            expected_version: item.expected_version, source: item.source, operation_id: item.operation_id,
            latitude: item.latitude, longitude: item.longitude, accuracy_m: item.accuracy_m, captured_at: item.captured_at,
          } });
          await removeOfflineCapture(item.operation_id);
        } catch (err) {
          const error = err as ApiError;
          await updateOfflineCapture(item.operation_id, { status: error.status === 409 ? 'CONFLICT' : 'ERROR', last_error: error.body?.code ?? 'NETWORK' });
        }
      }
    } finally {
      syncing.current = false;
    }
    await loadPending();
    await onSaved();
  }

  async function acquire(sample: Sample) {
    try {
      await saveOfflineCapture({ owner_key: ownerKey, organization_id: orgId, plot_id: plotId,
        expected_version: rowVersion, source: 'BROWSER_GEOLOCATION', ...sample, status: 'DRAFT', confirmed: false });
      setState({ kind: 'review', sample });
    } catch (err) {
      setState({ kind: 'storage-error', sample, message: err instanceof Error ? err.message : t('No se pudo guardar el borrador local.') });
    }
  }

  const sampleView = (s: Sample) => (
    <dl className="props" aria-label={t('Muestra de ubicación')}>
      <dt>{t('Latitud')} ({t('norte-sur')})</dt><dd>{s.latitude}</dd>
      <dt>{t('Longitud')} ({t('este-oeste')})</dt><dd>{s.longitude}</dd>
      <dt>{t('Precisión horizontal')}</dt><dd>{accuracyLabel(s.accuracy_m, t, num)}</dd>
      <dt>{t('Hora de adquisición')}</dt><dd>{dt(s.captured_at)}</dd>
      <dt>{t('Fuente')}</dt><dd>{t('Ubicación del navegador (puede provenir de GPS, Wi-Fi o red; no acredita un GPS)')}</dd>
    </dl>
  );

  return (
    <div className="capture" aria-live="polite">
      <h3>{t('Capturar ubicación')}</h3>
      <p className="field-help">{t('Registra un punto con la ubicación que informa este navegador. Se guarda como versión nueva; no calcula superficie ni valida la parcela.')}</p>
      {state.kind === 'idle' && (
        <button type="button" onClick={request} disabled={!supported}>{t('Capturar ubicación')}</button>
      )}
      {state.kind === 'idle' && !supported && <p className="muted">{FAILURE.UNSUPPORTED.title} {FAILURE.UNSUPPORTED.help}</p>}
      {state.kind === 'idle' && (
        <>
          <div className="actions">
            <button type="button" className="secondary" aria-expanded={showMap} onClick={() => setShowMap((v) => !v)}>{showMap ? t('Ocultar el mapa') : t('Ver el mapa con Mi ubicación')}</button>
          </div>
          {showMap && (
            <MapCapture
              readOnly mode={existing.length >= 3 ? 'POLYGON' : 'POINT'} vertices={existing}
              initialCenter={existing.length ? existing[0] : null}
              locate={{ label: t('Usar como punto de referencia'), onUse: usarComoReferencia, note: t('Abre la revisión de la muestra: no se guarda hasta que pulses «Guardar como nueva versión».') }}
            />
          )}
        </>
      )}
      {state.kind === 'requesting' && (
        <div className="actions">
          <p className="muted" role="status">{t('Obteniendo ubicación… Si el navegador lo pregunta, permite el acceso.')}</p>
          <button type="button" className="secondary" onClick={cancel}>{t('Cancelar')}</button>
        </div>
      )}
      {state.kind === 'failed' && (
        <div className="error" role="alert">
          <p className="alert-title">{FAILURE[state.code].title}</p>
          <p>{FAILURE[state.code].help}</p>
          <div className="actions">
            {state.code !== 'UNSUPPORTED' && <button type="button" onClick={request}>{t('Intentar de nuevo')}</button>}
            <button type="button" className="secondary" onClick={cancel}>{t('Cerrar')}</button>
          </div>
        </div>
      )}
      {state.kind === 'queued' && (
        <div className="alert" role="status">
          <p className="alert-title">{t('Guardado en este dispositivo; pendiente de sincronización.')}</p>
          <p>{t('Tu muestra conserva su precisión y hora. No es todavía una geometría aprobada.')}</p>
          <div className="actions"><button type="button" onClick={() => { void syncPending(); }} disabled={!online}>{t('Sincronizar ahora')}</button><button type="button" className="secondary" onClick={() => setState({ kind: 'idle' })}>{t('Seguir capturando')}</button></div>
        </div>
      )}
      {state.kind === 'storage-error' && (
        <div className="error" role="alert">
          <p className="alert-title">{t('No se pudo guardar el borrador en este dispositivo.')}</p>
          <p>{state.message}</p>
          <button type="button" onClick={() => setState({ kind: 'idle' })}>{t('Intentar de nuevo')}</button>
        </div>
      )}
      {pending.length > 0 && state.kind !== 'queued' && (
        <div className="alert" role="status">
          <p className="alert-title">{t('{n} captura(s) pendiente(s) en este dispositivo.', { n: pending.length })}</p>
          <p>{t('La cola está aislada por cuenta, organización y parcela.')}</p>
          <button type="button" onClick={() => { void syncPending(); }} disabled={!online}>{t('Sincronizar pendientes')}</button>
        </div>
      )}
      {(state.kind === 'review' || state.kind === 'saving' || state.kind === 'save-error') && (
        <div className="card capture-review">
          <p className="alert-title">{t('Revisa la muestra antes de guardarla')}</p>
          {sampleView(state.sample)}
          {state.kind === 'save-error' && (
            <>
              <ErrorPanel error={state.error} />
              {state.error.status === 409 && state.error.body.code === 'VERSION_CONFLICT' && (
                <p className="muted">{t('La muestra se conserva. Recarga la parcela y vuelve a guardarla.')}</p>
              )}
              {(state.error.status === 0 || state.error.status >= 500) && (
                <p className="muted">{t('No pudimos confirmar si se guardó. «Guardar» de nuevo no duplica la ubicación: el servidor reconoce este envío.')}</p>
              )}
            </>
          )}
          <div className="actions">
            {state.kind === 'save-error' && state.error.status === 409 && state.error.body.code === 'VERSION_CONFLICT' ? (
              <button type="button" onClick={async () => { await onSaved(); setState({ kind: 'review', sample: state.sample }); }}>{t('Recargar parcela')}</button>
            ) : (
              <button type="button" onClick={() => save(state.sample)} disabled={state.kind === 'saving'} aria-busy={state.kind === 'saving'}>
                {state.kind === 'saving' ? t('Guardando…') : t('Guardar como nueva versión')}
              </button>
            )}
            <button type="button" className="secondary" onClick={cancel} disabled={state.kind === 'saving'}>{t('Descartar')}</button>
          </div>
        </div>
      )}
      {state.kind === 'saved' && (
        <div className="alert valid" role="status">
          <p className="alert-title">{t('Ubicación guardada como versión {n}.', { n: state.versionNumber })}</p>
          <p>{t('Recibida por el servidor el {fecha}.', { fecha: dt(state.receivedAt) })}</p>
          <button type="button" className="secondary" onClick={() => setState({ kind: 'idle' })}>{t('Capturar otra ubicación')}</button>
        </div>
      )}
    </div>
  );
}
