'use client';

import { useEffect, useState } from 'react';
import { useI18n } from './i18n';
import { accuracyLabel } from './location-capture';
import {
  APPROXIMATE_ABOVE_M, FRESH_MAX_AGE_S, ageSeconds, isFresh, qualityOf,
  type LocateFailure, type LocateState, type MyLocation,
} from './mi-ubicacion';

// Panel de «Mi ubicación»: botón, estado, lectura (con su precisión y su hora) y, si la pantalla lo ofrece, una acción EXPLÍCITA para usarla.
// Localizarse no guarda ni modifica nada; esa decisión es de la acción «use».

export function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ verticalAlign: '-3px', marginRight: 6 }}>
      <circle cx="12" cy="12" r="3.5" fill="currentColor" />
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function MyLocationPanel({ state, onLocate, use }: {
  state: LocateState;
  onLocate: () => void;
  /** Acción explícita para incorporar la lectura (p. ej. «Añadir vértice aquí»); si no hay, el panel solo muestra la lectura. */
  use?: { label: string; onUse: (loc: MyLocation) => void; note?: string };
}) {
  const { t, dt, num } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.kind !== 'ready') return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, [state.kind]);

  const FAIL: Record<LocateFailure, { title: string; help: string }> = {
    DENIED: { title: t('El navegador no tiene permiso para usar tu ubicación.'), help: t('Habilita la ubicación para este sitio en la configuración del navegador (icono junto a la dirección) y vuelve a intentarlo.') },
    UNAVAILABLE: { title: t('No se pudo determinar la ubicación.'), help: t('Activa los servicios de ubicación del dispositivo, sal a cielo abierto si es posible y vuelve a intentarlo.') },
    TIMEOUT: { title: t('La ubicación tardó demasiado en llegar.'), help: t('Vuelve a intentarlo; en interiores o con señal débil puede tardar más.') },
    UNSUPPORTED: { title: t('Este navegador o esta conexión no permiten obtener la ubicación.'), help: t('Usa un navegador actualizado y una dirección segura (https o localhost).') },
  };
  const requesting = state.kind === 'requesting';
  const loc = state.kind === 'ready' ? state.location : null;
  const fresh = loc ? isFresh(loc, now) : false;
  const quality = loc ? qualityOf(loc.accuracy_m) : null;

  return (
    <div className="my-location" aria-live="polite">
      <div className="actions">
        <button type="button" className="secondary" onClick={onLocate} disabled={requesting} aria-busy={requesting}
          aria-label={t('Mi ubicación: centrar el mapa en tu posición actual')}>
          <PinIcon />{t('Mi ubicación')}
        </button>
        {requesting && <span className="muted" role="status">{t('Obteniendo ubicación…')}</span>}
      </div>
      {state.kind === 'failed' && (
        <div className="error" role="alert">
          <p className="alert-title">{FAIL[state.code].title}</p>
          <p>{FAIL[state.code].help}</p>
          <p className="muted">{t('Puedes seguir con la captura manual: escribe las coordenadas o dibuja en el mapa. Pulsa «Mi ubicación» para reintentar.')}</p>
        </div>
      )}
      {loc && (
        <div className="card my-location-reading">
          <dl className="props" aria-label={t('Lectura de Mi ubicación')}>
            <dt>{t('Latitud')} ({t('norte-sur')})</dt><dd>{loc.latitude.toFixed(6)}</dd>
            <dt>{t('Longitud')} ({t('este-oeste')})</dt><dd>{loc.longitude.toFixed(6)}</dd>
            <dt>{t('Precisión horizontal')}</dt><dd>{accuracyLabel(loc.accuracy_m, t, num)}</dd>
            <dt>{t('Hora de adquisición')}</dt><dd>{dt(loc.captured_at)} · {t('hace {s} s', { s: ageSeconds(loc, now) })}</dd>
            <dt>{t('Fuente')}</dt><dd>{t('Ubicación del navegador (puede provenir de GPS, Wi-Fi o red; no acredita un GPS)')}</dd>
          </dl>
          {quality === 'APPROXIMATE' && (
            <p className="alert review" role="status">{t('Ubicación aproximada: la precisión informada supera {m} m. En un computador suele provenir de la red o de la dirección IP. Acércate al punto o usa otro método antes de usarla.', { m: APPROXIMATE_ABOVE_M })}</p>
          )}
          {quality === 'NOT_REPORTED' && <p className="alert review" role="status">{t('El navegador no informó la precisión: trátala como aproximada.')}</p>}
          {!fresh && <p className="alert review" role="status">{t('La lectura tiene más de {s} s. Pulsa «Mi ubicación» otra vez antes de usarla.', { s: FRESH_MAX_AGE_S })}</p>}
          <p className="muted">{t('Localizarte no guarda ni cambia la parcela. La precisión es la de esta lectura y no se aplica al polígono.')}</p>
          {use && (
            <div className="actions">
              <button type="button" onClick={() => use.onUse(loc)} disabled={!fresh}>{use.label}</button>
              {use.note && <span className="muted">{use.note}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
