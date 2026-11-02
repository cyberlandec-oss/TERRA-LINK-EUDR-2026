'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// P1-007 — Conexión con EUDR-IS (TRACES NT). Esta pantalla registra las credenciales del servicio web por organización Y entorno, y comprueba la conexión (servicio Echo).
// Lo que no puede dejar de decir: las credenciales se guardan cifradas y NO se vuelven a mostrar; Echo acredita conexión y credenciales, NO el operador representado
// ni una presentación de DDS; ACCEPTANCE (pruebas) y PRODUCTION son distintos y no se reutilizan.

interface Entorno {
  environment: 'ACCEPTANCE' | 'PRODUCTION'; configured: boolean; registered_at: string | null; rotated_at: string | null; registered_via: string | null; echo_documented: boolean;
  last_echo: { outcome: string; http_status: number | null; detail: string | null; checked_at: string } | null;
}
interface Estado { live_calls_enabled: boolean; environments: Entorno[]; note: string }
interface ResultadoEcho { environment: string; outcome: string; http_status: number | null; detail: string | null; meaning: string }

const NOMBRE = { ACCEPTANCE: 'ACCEPTANCE (pruebas)', PRODUCTION: 'PRODUCTION (real)' } as const;
const RESULTADO: Record<string, { label: string; tone: 'valid' | 'review' | 'blocked' | 'neutral' }> = {
  OK: { label: 'Conexión y credenciales aceptadas', tone: 'valid' },
  AUTH_FAILED: { label: 'Autenticación rechazada', tone: 'blocked' },
  FAULT: { label: 'El servicio devolvió un error', tone: 'review' },
  UNEXPECTED_RESPONSE: { label: 'Respuesta inesperada', tone: 'review' },
  UNREACHABLE: { label: 'No se pudo conectar', tone: 'review' },
};
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

export default function EudrIsPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const puedeAdministrar = ws.can('integration:manage');
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [echo, setEcho] = useState<ResultadoEcho | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    if (!orgId) return;
    try { setEstado(await api<Estado>(`/api/v1/organizations/${orgId}/eudr-is/credentials`)); setError(null); } catch (e) { setError(e as ApiError); }
  }, [orgId]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!ws.activeOrg) return null;
  if (!ws.can('integration:read')) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar la conexión con EUDR-IS.', request_id: null })} />;

  const hacer = async (fn: () => Promise<unknown>, ok: string) => {
    setOcupado(true); setMsg(null); setError(null);
    try { await fn(); setMsg(ok); await cargar(); } catch (e) { setError(e as ApiError); } finally { setOcupado(false); }
  };

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Conexión EUDR-IS' }]} />
      <PageHeader title="Conexión con EUDR-IS" meta="Credenciales del servicio web de la Comisión Europea (TRACES NT) y comprobación de la conexión." />
      <Alert tone="info" title="Qué hace y qué no hace esta pantalla">
        <p>Guarda las credenciales de esta organización <strong>cifradas</strong>: después de registrarlas no se vuelven a mostrar. Comprobar la conexión (servicio Echo) acredita que el transporte y las credenciales funcionan; <strong>no acredita el operador representado ni presenta ninguna declaración (DDS)</strong>.</p>
        <p>Las credenciales de ACCEPTANCE (pruebas) y de PRODUCTION (real) son distintas y no se reutilizan entre sí. Echo está documentado solo para ACCEPTANCE.</p>
      </Alert>
      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {msg && <p className="alert valid" role="status">{msg}</p>}
      {!estado && !error && <Loading label="Cargando…" />}
      {estado && (
        <>
          {!estado.live_calls_enabled && <Alert tone="review" title="Las llamadas a EUDR-IS están deshabilitadas en esta plataforma">Registrar credenciales no las activa. Mientras estén deshabilitadas, la comprobación de conexión no sale a la red.</Alert>}
          {estado.environments.map((e) => (
            <section key={e.environment} className="card" aria-labelledby={`env-${e.environment}`}>
              <h2 id={`env-${e.environment}`}>{NOMBRE[e.environment]}</h2>
              <p>
                {e.configured ? <StatusBadge tone="valid">Credenciales registradas</StatusBadge> : <StatusBadge tone="neutral">Sin credenciales</StatusBadge>}{' '}
                <span className="muted">{e.configured ? `Registradas ${fecha(e.registered_at)}${e.rotated_at ? ` · rotadas ${fecha(e.rotated_at)}` : ''}${e.registered_via === 'CLI' ? ' · cargadas desde el archivo local' : ''}` : 'No se muestra ningún valor.'}</span>
              </p>
              {e.last_echo ? (
                <p>
                  Última comprobación: <StatusBadge tone={RESULTADO[e.last_echo.outcome]?.tone ?? 'neutral'}>{RESULTADO[e.last_echo.outcome]?.label ?? e.last_echo.outcome}</StatusBadge>{' '}
                  <span className="muted">{fecha(e.last_echo.checked_at)}{e.last_echo.http_status ? ` · HTTP ${e.last_echo.http_status}` : ''}{e.last_echo.detail ? ` · ${e.last_echo.detail}` : ''}</span>
                </p>
              ) : <p className="muted">Todavía no se ha comprobado la conexión.</p>}
              {puedeAdministrar ? (
                <>
                  <FormularioCredencial entorno={e.environment} disabled={ocupado} onSubmit={(c) => hacer(() => api(`/api/v1/organizations/${orgId}/eudr-is/credentials/${e.environment}`, { method: 'PUT', body: c }), `Credenciales de ${e.environment} guardadas (cifradas).`)} />
                  <div className="actions">
                    {e.echo_documented
                      ? <button type="button" disabled={ocupado || !e.configured || !estado.live_calls_enabled} onClick={() => void hacer(async () => { setEcho(await api<ResultadoEcho>(`/api/v1/organizations/${orgId}/eudr-is/echo/${e.environment}`, { method: 'POST', body: {} })); }, 'Comprobación realizada.')}>Comprobar conexión (Echo)</button>
                      : <p className="muted">La Comisión no documenta un servicio Echo para este entorno; la conexión se comprobará con una consulta real y filtros restrictivos cuando se autorice.</p>}
                    {e.configured && <button type="button" className="secondary" disabled={ocupado} onClick={() => void hacer(() => api(`/api/v1/organizations/${orgId}/eudr-is/credentials/${e.environment}`, { method: 'DELETE' }), `Credenciales de ${e.environment} retiradas.`)}>Retirar credenciales</button>}
                  </div>
                  {echo && echo.environment === e.environment && <Alert tone={echo.outcome === 'OK' ? 'valid' : 'review'} title={RESULTADO[echo.outcome]?.label ?? echo.outcome}><p>{echo.meaning}</p></Alert>}
                </>
              ) : <p className="muted">Tu rol puede consultar el estado, no registrar credenciales ni comprobar la conexión.</p>}
            </section>
          ))}
          <p className="muted">{estado.note}</p>
        </>
      )}
    </>
  );
}

function FormularioCredencial({ entorno, disabled, onSubmit }: { entorno: string; disabled: boolean; onSubmit: (c: { username: string; authentication_key: string; web_service_client_id: string }) => void }) {
  const [username, setUsername] = useState('');
  const [clave, setClave] = useState('');
  const [clientId, setClientId] = useState('');
  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    onSubmit({ username, authentication_key: clave, web_service_client_id: clientId });
    setUsername(''); setClave(''); setClientId(''); // el valor no permanece en pantalla
  };
  return (
    <details>
      <summary>Registrar o rotar credenciales de {entorno}</summary>
      <form onSubmit={enviar} autoComplete="off">
        <label htmlFor={`u-${entorno}`}>Usuario de servicios web</label>
        <input id={`u-${entorno}`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required minLength={2} />
        <label htmlFor={`k-${entorno}`}>Authentication Key</label>
        <input id={`k-${entorno}`} type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" required minLength={8} />
        <label htmlFor={`c-${entorno}`}>WebServiceClientId</label>
        <input id={`c-${entorno}`} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" required minLength={2} />
        <p className="field-help">Se guardan cifradas y no se vuelven a mostrar. También puedes cargarlas desde tu archivo local con <code>npm run eudr-is:cargar</code> (ver la guía).</p>
        <button type="submit" disabled={disabled}>Guardar credenciales</button>
      </form>
    </details>
  );
}
