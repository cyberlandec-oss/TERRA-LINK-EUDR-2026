'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n';
import { useWorkspace } from '../../../lib/workspace';
import { Alert, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge, type Tone } from '../../../lib/ui';

// RNF-13 · Observabilidad de la plataforma (solo `observability:read`).
//
// Lo que esta pantalla no puede dejar de decir:
//   · muestra el SERVICIO, no los datos de ninguna organización: sin personas, sin recursos, sin SQL;
//   · las trazas viven EN MEMORIA del proceso de la API: se pierden al reiniciar y no incluyen al worker;
//   · que una dependencia esté «ok» no es un SLO ni una garantía de disponibilidad: es el estado de este momento.

interface Salud { status: string; checks: Record<string, string>; capabilities?: Record<string, string> }
interface Build { service: string; version: string; commit: string | null; commit_source: string; migration_known_by_code: string; started_at: string; node: string }
interface TrazaFila { trace_id: string; name: string; started_at: string; duration_ms: number; status: 'OK' | 'ERROR'; spans: number }
interface Tramo { span_id: string; parent_id: string | null; name: string; started_at: string; duration_ms: number; status: 'OK' | 'ERROR'; attributes: Record<string, string | number> }
interface TrazaDetalle { found: boolean; note?: string; trace_id?: string; name?: string; duration_ms?: number; status?: 'OK' | 'ERROR'; spans?: Tramo[] }

const tonoSalud = (s: string): Tone => (s === 'ok' ? 'valid' : s === 'degraded' ? 'review' : 'blocked');

export default function ObservabilidadPage() {
  const ws = useWorkspace();
  const { t } = useI18n();
  const [salud, setSalud] = useState<Salud | null>(null);
  const [build, setBuild] = useState<Build | null>(null);
  const [trazas, setTrazas] = useState<TrazaFila[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [detalle, setDetalle] = useState<TrazaDetalle | null>(null);
  const [errDetalle, setErrDetalle] = useState<ApiError | null>(null);

  const cargar = useCallback(async () => {
    if (!ws.isPlatformAdmin) return;
    setError(null);
    try {
      const [s, b, tr] = await Promise.all([
        api<Salud>('/health/ready'),
        api<Build>('/api/v1/observability/build'),
        api<{ note: string; traces: TrazaFila[] }>('/api/v1/observability/traces?limit=50'),
      ]);
      setSalud(s); setBuild(b); setTrazas(tr.traces); setAviso(tr.note);
    } catch (e) { setError(e as ApiError); }
  }, [ws.isPlatformAdmin]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function abrir(id: string) {
    setErrDetalle(null); setDetalle(null);
    try { setDetalle(await api<TrazaDetalle>(`/api/v1/observability/traces/${encodeURIComponent(id)}`)); }
    catch (e) { setErrDetalle(e as ApiError); }
  }

  if (!ws.isPlatformAdmin) {
    return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Esta pantalla es de la administración de la plataforma.', request_id: null })} />;
  }

  return (
    <>
      <PageHeader title={t('Observabilidad')} meta={t('Servicio, versión desplegada y trazas recientes')} />
      <Alert tone="info" title={t('Qué es y qué no es esto')}>
        <p>{t('Muestra el estado del servicio, no los datos de ninguna organización. Las trazas están en la memoria del proceso de la API: se pierden al reiniciar y no incluyen al worker. «ok» describe este momento; no es un compromiso de disponibilidad.')}</p>
      </Alert>
      {error ? <ErrorPanel error={error} onRetry={cargar} /> : !salud || !build || !trazas ? <Loading label={t('Cargando observabilidad…')} /> : (
        <>
          <section className="card" aria-labelledby="ob-salud">
            <h2 id="ob-salud">{t('Dependencias')}</h2>
            <p><StatusBadge tone={tonoSalud(salud.status)}>{salud.status}</StatusBadge></p>
            <ul>
              {Object.entries(salud.checks).map(([k, v]) => <li key={k}><strong>{k}</strong>: <StatusBadge tone={tonoSalud(v)}>{v}</StatusBadge></li>)}
            </ul>
            {salud.capabilities?.document_analysis === 'UNAVAILABLE' && <Alert tone="review" title={t('Análisis de documentos no disponible')}><p>{t('Sin el escáner, los documentos quedan «análisis pendiente»: no se marcan como limpios.')}</p></Alert>}
          </section>

          <section className="card" aria-labelledby="ob-build">
            <h2 id="ob-build">{t('Código desplegado')}</h2>
            <dl>
              <dt>{t('Servicio')}</dt><dd>{build.service} {build.version}</dd>
              <dt>{t('Versión del código (commit)')}</dt><dd>{build.commit ?? t('No inyectado en la construcción')}</dd>
              <dt>{t('Última migración conocida por el código')}</dt><dd>{build.migration_known_by_code}</dd>
              <dt>{t('Proceso iniciado')}</dt><dd>{new Date(build.started_at).toLocaleString()}</dd>
              <dt>Node</dt><dd>{build.node}</dd>
            </dl>
          </section>

          <section className="card" aria-labelledby="ob-trazas">
            <h2 id="ob-trazas">{t('Trazas recientes')}</h2>
            {aviso && <p><small>{aviso}</small></p>}
            {trazas.length === 0 ? <EmptyState title={t('Todavía no hay trazas en memoria.')}><p>{t('Aparecen cuando la API atiende solicitudes.')}</p></EmptyState> : (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">{t('Trazas recientes')}</caption>
                  <thead><tr><th>{t('Traza')}</th><th>{t('Inicio')}</th><th>{t('Duración (ms)')}</th><th>{t('Estado')}</th><th>{t('Tramos')}</th><th>{t('Acción')}</th></tr></thead>
                  <tbody>
                    {trazas.map((x) => (
                      <tr key={x.trace_id}>
                        <td>{x.name}<br /><small>{x.trace_id}</small></td>
                        <td>{new Date(x.started_at).toLocaleString()}</td>
                        <td>{x.duration_ms}</td>
                        <td><StatusBadge tone={x.status === 'OK' ? 'valid' : 'blocked'}>{x.status}</StatusBadge></td>
                        <td>{x.spans}</td>
                        <td><button type="button" className="secondary inline" onClick={() => void abrir(x.trace_id)}>{t('Ver recorrido')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {errDetalle && <ErrorPanel error={errDetalle} />}
            {detalle && (detalle.found ? (
              <div className="stack" role="region" aria-label={t('Recorrido de la traza')}>
                <h3>{detalle.name} · {detalle.duration_ms} ms</h3>
                <ol>
                  {detalle.spans?.map((s) => (
                    <li key={s.span_id}>{s.name} · {s.duration_ms} ms · <StatusBadge tone={s.status === 'OK' ? 'valid' : 'blocked'}>{s.status}</StatusBadge>
                      {Object.keys(s.attributes).length > 0 && <small> · {Object.entries(s.attributes).map(([k, v]) => `${k}=${v}`).join(', ')}</small>}
                    </li>
                  ))}
                </ol>
              </div>
            ) : <Alert tone="review" title={t('No se encontró la traza')}><p>{detalle.note}</p></Alert>)}
          </section>
        </>
      )}
    </>
  );
}
