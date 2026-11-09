'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, apiSvg } from './api';
import { Alert, StatusBadge } from './ui';

// RF-33 — Referencia pública de un recurso: verla, copiarla y obtener su QR.
//
// LO QUE SE PUEDE PROMETER, Y LO QUE NO
// La referencia **no concede acceso**. Quien la reciba tendrá que iniciar sesión y tener permiso sobre el
// recurso, igual que por cualquier otra vía: el enlace abre la resolución, no el contenido. Y **no sustituye
// un DDS** ni acredita conformidad. Las dos cosas se dicen en la pantalla, no solo en la documentación.
//
// EL QR SE PIDE CON LA SESIÓN
// La ruta del QR está autorizada igual que la resolución, así que no sirve `<img src>`: se trae con el token
// y se inserta el SVG que el servidor emite. Si la persona no puede leer el recurso, recibe la misma
// respuesta opaca que al resolver —no un QR—, y aquí se muestra como error, no como hueco silencioso.

interface Enlace { reference: string; entity_type: string; code: string; link: string; note: string }

export function ReferenciaPublica({ reference }: { reference: string | null }) {
  const [enlace, setEnlace] = useState<Enlace | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [verQr, setVerQr] = useState(false);

  const cargar = useCallback(async () => {
    if (!reference) return;
    try {
      setEnlace(await api<Enlace>(`/api/v1/public-references/${reference}/link`));
      setError(null);
    } catch (e) { setError(e as ApiError); }
  }, [reference]);
  useEffect(() => { void cargar(); }, [cargar]);

  const cargarQr = useCallback(async () => {
    setVerQr(true);
    if (svg || !reference) return;
    try { setSvg(await apiSvg(`/api/v1/public-references/${reference}/qr.svg`)); setError(null); }
    catch (e) { setError(e as ApiError); }
  }, [reference, svg]);

  const copiar = async () => {
    if (!enlace) return;
    try {
      await navigator.clipboard.writeText(enlace.link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Sin permiso de portapapeles: el campo sigue ahí para copiar a mano, que es lo que importa.
      setCopiado(false);
    }
  };

  if (!reference) {
    return (
      <section aria-labelledby="ref-titulo">
        <h2 id="ref-titulo">Referencia pública</h2>
        <p className="muted">Este recurso todavía no tiene referencia pública.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="ref-titulo">
      <h2 id="ref-titulo">Referencia pública</h2>
      <p className="muted">
        Identificador opaco del recurso: no contiene su identificador interno ni datos de nadie.
        <strong> Compartirlo no concede acceso</strong>: quien lo abra necesita sesión y permiso.
        <strong> No sustituye un DDS</strong> ni acredita conformidad.
      </p>

      {error && <Alert tone="blocked" title="No se pudo obtener la referencia">{error.message}</Alert>}

      {enlace && (
        <>
          <p>
            <StatusBadge tone="neutral">{enlace.entity_type}</StatusBadge>{' '}
            <code>{enlace.reference}</code>
          </p>
          <label htmlFor="ref-enlace">Enlace de resolución</label>
          <input id="ref-enlace" readOnly value={enlace.link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" onClick={() => void copiar()}>Copiar enlace</button>
          <button type="button" onClick={() => void cargarQr()} aria-expanded={verQr} aria-controls="ref-qr">
            {verQr ? 'Actualizar QR' : 'Ver código QR'}
          </button>
          {/* `aria-live`: quien usa lector de pantalla tiene que enterarse de que se copió. */}
          <span role="status" aria-live="polite" className="muted">{copiado ? ' Enlace copiado.' : ''}</span>

          {verQr && (
            <div id="ref-qr">
              {svg
                ? (
                  <figure style={{ maxWidth: '220px', margin: '0.75rem 0' }}>
                    {/* El SVG lo emite el servidor ya autorizado; aquí solo se inserta. */}
                    <div aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
                    <figcaption className="muted">
                      Código QR del enlace <code>{enlace.reference}</code>. Al escanearlo se pide sesión y permiso.
                    </figcaption>
                  </figure>
                )
                : <p className="muted">Cargando el código…</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
