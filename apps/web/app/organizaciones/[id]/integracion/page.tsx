'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// P1-008 — Integración ERP/API por webhooks (RF-39).
//
// Lo que esta pantalla no puede dejar de decir:
//   · el **secreto se muestra una sola vez**, y se dice antes de generarlo, no después;
//   · **recibir un evento no acredita nada**: es información interna, no conformidad ni presentación;
//   · cada intento se ve **con su resultado y su causa**, incluidos los fallos;
//   · los **reintentos son del bus**, no otra cola: se consultan donde ya se consultaban.

interface Destino {
  id: string; code: string; version: number; url: string; secret_fingerprint: string;
  event_types: string[]; active: boolean; reason: string | null; created_at: string; author: string;
  delivered: number; failed: number;
}
interface Vista {
  destinations: Destino[];
  limit: number;
  next_cursor: string | null;
  event_catalog: string[];
  local_destinations_allowed: boolean;
  mode_note: string; signature_note: string; idempotency_note: string; delivery_guarantee: string;
}
interface PaginaIntentos {
  attempts: Intento[];
  limit: number;
  next_cursor: string | null;
  note: string;
  pagination_note: string;
}
interface Intento {
  id: string; code: string; delivery_id: string; attempt: number; status: string;
  http_status: number | null; response_excerpt: string | null; error: string | null;
  duration_ms: number | null; sent_at: string; event_type: string; aggregate_type: string; aggregate_id: string;
}

const TONO: Record<string, 'valid' | 'blocked' | 'review' | 'neutral'> = {
  ENTREGADO: 'valid', RECHAZADO: 'blocked', ERROR_DE_RED: 'blocked', OMITIDO: 'neutral',
};

export default function IntegracionPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id;
  const puedeConfigurar = ws.can('integration:manage');

  const [v, setV] = useState<Vista | null>(null);
  const [intentos, setIntentos] = useState<Intento[] | null>(null);
  const [pagina, setPagina] = useState<PaginaIntentos | null>(null);
  const [masDestinos, setMasDestinos] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [filtro, setFiltro] = useState('');

  const [code, setCode] = useState('');
  const [url, setUrl] = useState('');
  const [tipos, setTipos] = useState<string[]>([]);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [secreto, setSecreto] = useState<{ code: string; secret: string; note: string } | null>(null);
  const [errorForm, setErrorForm] = useState<ApiError | null>(null);

  const cargar = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    try {
      const base = `/api/v1/organizations/${orgId}/integration/webhooks`;
      const lista = await api<Vista>(base);
      setV(lista);
      setMasDestinos(lista.next_cursor !== null);
      const q = filtro ? `?code=${encodeURIComponent(filtro)}` : '';
      const p = await api<PaginaIntentos>(`${base}/attempts${q}`);
      setPagina(p);
      setIntentos(p.attempts);
    } catch (err) { setError(err as ApiError); }
  }, [orgId, filtro]);
  useEffect(() => { void cargar(); }, [cargar]);

  const existente = v?.destinations.find((d) => d.code === code.trim());

  /** Trae la siguiente página SIN perder lo ya mostrado: la lista no se corta, se continúa. */
  async function masIntentos() {
    if (!orgId || !pagina?.next_cursor) return;
    const base = `/api/v1/organizations/${orgId}/integration/webhooks`;
    const q = `?${filtro ? `code=${encodeURIComponent(filtro)}&` : ''}cursor=${encodeURIComponent(pagina.next_cursor)}`;
    try {
      const p = await api<PaginaIntentos>(`${base}/attempts${q}`);
      setPagina(p);
      setIntentos((prev) => [...(prev ?? []), ...p.attempts]);
    } catch (err) { setError(err as ApiError); }
  }

  async function masDestinosCargar() {
    if (!orgId || !v?.next_cursor) return;
    const base = `/api/v1/organizations/${orgId}/integration/webhooks`;
    try {
      const siguiente = await api<Vista>(`${base}?cursor=${encodeURIComponent(v.next_cursor)}`);
      setV({ ...siguiente, destinations: [...v.destinations, ...siguiente.destinations] });
      setMasDestinos(siguiente.next_cursor !== null);
    } catch (err) { setError(err as ApiError); }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setEnviando(true);
    setErrorForm(null);
    setSecreto(null);
    try {
      const r = await api<{ secret: string | null; secret_note?: string }>(
        `/api/v1/organizations/${orgId}/integration/webhooks`,
        {
          method: 'POST',
          body: {
            operation_id: crypto.randomUUID(), code: code.trim(), url: url.trim(), event_types: tipos,
            ...(motivo.trim() ? { reason: motivo.trim() } : {}),
          },
        },
      );
      if (r.secret) setSecreto({ code: code.trim(), secret: r.secret, note: r.secret_note ?? '' });
      setCode(''); setUrl(''); setTipos([]); setMotivo('');
      await cargar();
    } catch (err) { setErrorForm(err as ApiError); }
    finally { setEnviando(false); }
  }

  if (!ws.activeOrg) {
    return <ErrorPanel error={new ApiError(404, { code: 'NOT_FOUND', message: 'El recurso no existe o no está disponible para ti.', request_id: null })} />;
  }
  const migas = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Integración' }];

  return (
    <>
      <Breadcrumb items={migas} />
      <PageHeader title="Integración por webhooks" meta={<span>Envío de eventos a un sistema propio · ERP</span>} />

      <Alert tone="info" title="Recibir un evento no acredita nada.">
        <p>
          Terra Link <strong>envía a tu sistema lo que ocurre aquí</strong>: un productor registrado, una
          parcela evaluada, un expediente preparado. Es <strong>información interna</strong>. No acredita
          conformidad EUDR, y un expediente preparado <strong>no es una declaración presentada</strong>:
          cuando el evento trae referencia de paquete, su estado de presentación es siempre
          <code> NOT_SUBMITTED</code>.
        </p>
      </Alert>

      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {!v && !error && <Loading label="Cargando destinos…" />}

      {secreto && (
        <Alert tone="review" title={`Secreto de «${secreto.code}» — se muestra UNA sola vez`}>
          <p><code>{secreto.secret}</code></p>
          <p>{secreto.note}</p>
          <p>
            Con él tu sistema <strong>verifica la firma</strong> de cada entrega. Guárdalo donde guardes tus
            credenciales: aquí no vuelve a aparecer, solo su huella.
          </p>
        </Alert>
      )}

      {v && (
        <>
          {puedeConfigurar && (
            <section className="card" aria-labelledby="int-nuevo">
              <h2 id="int-nuevo">Configurar un destino</h2>
              <p className="muted">{v.mode_note}</p>
              <form onSubmit={enviar}>
                <div>
                  <label htmlFor="int-code">Nombre del destino</label>
                  <input id="int-code" value={code} onChange={(e) => setCode(e.target.value)} required minLength={2} maxLength={60}
                    aria-describedby="int-code-ayuda" autoComplete="off" />
                  <p id="int-code-ayuda" className="field-help">
                    {existente
                      ? `Ya existe (versión ${existente.version}). Volver a configurarlo crea otra versión, con OTRO secreto, y exige un motivo.`
                      : 'Un nombre estable, por ejemplo «erp». Cambiarlo después crea otra versión; nada se edita ni se borra.'}
                  </p>
                </div>
                <div>
                  <label htmlFor="int-url">Dirección del receptor</label>
                  <input id="int-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required
                    placeholder="https://…" aria-describedby="int-url-ayuda" autoComplete="off" />
                  <p id="int-url-ayuda" className="muted">
                    Debe usar <code>https</code> y no puede resolver a una dirección interna: la configuración
                    no abre el acceso a la red privada.
                  </p>
                </div>
                <fieldset>
                  <legend>Eventos a los que se suscribe</legend>
                  <p className="muted">Si un tipo no está en esta lista, no se publica: no hay suscripción a ciegas.</p>
                  <div className="actions">
                    {v.event_catalog.map((t) => (
                      <label key={t} className="checkbox-row">
                        <input type="checkbox" checked={tipos.includes(t)}
                          onChange={(e) => setTipos((prev) => (e.target.checked ? [...prev, t] : prev.filter((x) => x !== t)))} />
                        <span>{t}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {existente && (
                  <div>
                    <label htmlFor="int-motivo">Motivo del cambio</label>
                    <input id="int-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} required
                      maxLength={500} aria-describedby="int-motivo-ayuda" autoComplete="off" />
                    <p id="int-motivo-ayuda" className="muted">Queda en el historial del destino, junto a la versión anterior.</p>
                  </div>
                )}
                {errorForm && <ErrorPanel error={errorForm} />}
                <button type="submit" disabled={enviando || tipos.length === 0 || !code.trim() || !url.trim()}>
                  {enviando ? 'Guardando…' : existente ? 'Crear otra versión' : 'Configurar destino'}
                </button>
                {tipos.length === 0 && <p className="muted">Elige al menos un evento: un destino sin eventos no recibiría nada.</p>}
              </form>
            </section>
          )}

          <section className="card" aria-labelledby="int-destinos">
            <h2 id="int-destinos">Destinos configurados</h2>
            {v.destinations.length === 0 ? (
              <EmptyState title="Todavía no hay ningún destino.">
                <p>
                  {puedeConfigurar
                    ? 'Configura uno arriba para que tu sistema reciba los eventos de esta organización.'
                    : 'Quien administre la organización puede configurar uno.'}
                </p>
              </EmptyState>
            ) : (
              <div className="table-wrap"><table aria-label="Destinos configurados">
                <thead><tr>
                  <th scope="col">Destino</th><th scope="col">Dirección</th><th scope="col">Eventos</th>
                  <th scope="col">Huella del secreto</th><th scope="col">Entregas</th>
                </tr></thead>
                <tbody>{v.destinations.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.code}</strong>
                      <div className="muted">versión {d.version} · {d.created_at.slice(0, 10)} · {d.author}</div>
                      {d.reason && <div className="muted">Motivo: {d.reason}</div>}
                    </td>
                    <td className="muted"><code>{d.url}</code></td>
                    <td className="muted">{d.event_types.join(', ')}</td>
                    <td className="muted"><code>{d.secret_fingerprint}</code><div className="muted">el secreto no se publica</div></td>
                    <td>
                      <StatusBadge tone={d.failed > 0 ? 'review' : 'valid'}>{d.delivered} entregadas</StatusBadge>
                      {d.failed > 0 && <div className="muted">{d.failed} sin entregar</div>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            {masDestinos && (
              <button className="secondary" onClick={() => void masDestinosCargar()}>Cargar más destinos</button>
            )}
            <p className="muted">{v.signature_note}</p>
            <p className="muted">{v.idempotency_note}</p>
            <Alert tone="review" title="Procesar una sola vez es cosa de tu sistema.">
              <p>
                La entrega es <strong>al menos una vez</strong>. Terra Link no reenvía un evento cuya entrega
                registró como lograda, pero eso <strong>no basta</strong>: si tu sistema procesa el mensaje y la
                respuesta no llega —se corta la conexión, vence el plazo—, aquí queda un fallo, el bus reintenta
                y <strong>volverás a recibir el mismo mensaje</strong>. Guarda el{' '}
                <code>X-Terra-Delivery-Id</code> de lo que ya procesaste y descarta lo repetido: es el mismo en
                todos los reintentos de una entrega.
              </p>
            </Alert>
          </section>

          <section className="card" aria-labelledby="int-intentos">
            <h2 id="int-intentos">Resultado de cada intento</h2>
            <div>
              <label htmlFor="int-filtro">Ver solo un destino</label>
              <select id="int-filtro" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                <option value="">Todos los destinos</option>
                {v.destinations.map((d) => <option key={d.id} value={d.code}>{d.code}</option>)}
              </select>
            </div>
            {!intentos ? <Loading label="Cargando intentos…" /> : intentos.length === 0 ? (
              <EmptyState title="Todavía no se ha intentado ninguna entrega.">
                <p>En cuanto ocurra un evento de los suscritos, el intento aparecerá aquí con su resultado.</p>
              </EmptyState>
            ) : (
              <div className="table-wrap"><table aria-label="Intentos de entrega">
                <thead><tr>
                  <th scope="col">Cuándo</th><th scope="col">Destino</th><th scope="col">Evento</th>
                  <th scope="col">Intento</th><th scope="col">Resultado</th><th scope="col">Qué contestó</th>
                </tr></thead>
                <tbody>{intentos.map((a) => (
                  <tr key={a.id}>
                    <td className="muted">{a.sent_at.slice(0, 19).replace('T', ' ')}</td>
                    <td>{a.code}<div className="muted"><code>{a.delivery_id.slice(0, 13)}…</code></div></td>
                    <td className="muted">{a.event_type}<div className="muted">{a.aggregate_type}</div></td>
                    <td>{a.attempt}</td>
                    <td>
                      <StatusBadge tone={TONO[a.status] ?? 'neutral'}>{a.status}</StatusBadge>
                      {a.duration_ms !== null && <div className="muted">{a.duration_ms} ms</div>}
                    </td>
                    <td className="muted">
                      {a.http_status !== null && <div>HTTP {a.http_status}</div>}
                      {a.response_excerpt && <div>{a.response_excerpt}</div>}
                      {a.error && <div>{a.error}</div>}
                      {a.http_status === null && !a.error && !a.response_excerpt && <span>—</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            {pagina?.next_cursor && (
              <button className="secondary" onClick={() => void masIntentos()}>Cargar más intentos</button>
            )}
            {pagina && <p className="muted">{pagina.pagination_note}</p>}
            <p className="muted">
              Un intento fallido queda <strong>registrado igual</strong>, con su causa: el bus reintenta con
              espera creciente y, si se agota, la entrega queda en la cola muerta, que se consulta en
              <strong> Entregas de eventos</strong>. No hay otra cola.
            </p>
          </section>
        </>
      )}
    </>
  );
}
