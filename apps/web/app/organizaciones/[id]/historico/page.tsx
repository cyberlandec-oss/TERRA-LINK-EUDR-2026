'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// P1-011 — Histórico temporal y alertas (RF-42).
//
// La pantalla no deriva nada: pide la línea temporal y la dibuja. Lo que no puede perderse al dibujarla:
//   · un año **sin registros** se rotula como tal; jamás se dibuja como un cero ni se omite en silencio;
//   · **fecha del hecho**, **de registro** y **de evaluación** se muestran por separado, y la que falta se dice;
//   · comparar dos versiones muestra **sus limitaciones primero**: menos hallazgos con menos datos NO es mejora;
//   · las alertas son **derivadas y de solo lectura**: se abren hacia la acción, pero leerlas no resuelve nada.

interface Entrada {
  kind: string; id: string; label: string;
  occurred_at: string | null; recorded_at: string | null; evaluated_at: string | null;
  dates_note: string; versions: Record<string, string | number | null>; detail: string;
}
interface Periodo { year: number; status: string; entries: Entrada[]; note: string }
interface Alerta {
  code: string; label: string; plot_id: string; plot_code: string;
  impact: string;
  cause: { kind: string; id: string; what: string };
  what_it_does_not_mean: string; action_href: string | null; action: string | null;
}
interface Hist {
  plot: { id: string; code: string; current_version_id: string | null };
  scope: string; periods: Periodo[]; alerts: Alerta[];
  restricted_sections: Array<{ section: string; why: string }>;
  comparable: Array<{ id: string; version_number: number; surveyed_at: string | null; recorded_at: string }>;
  note: string; change_log_href: string; reuse_note: string; dates_note: string;
}
interface Lado {
  version_id: string; version_number: number; surveyed_at: string | null; recorded_at: string;
  geometry_type: string | null; area_declared_ha: string | null; area_calculated_ha: string | null;
  survey_method: string | null; validation_status: string | null; validation_rule_version: string | null;
  analysis: { dataset: string | null; dataset_version: string | null; coverage_status: string | null; analysis_date: string | null; outcome: string | null; synthetic: boolean; limitations: string | null } | null;
}
interface Comp {
  plot: { id: string; code: string }; from: Lado; to: Lado;
  changed: Record<string, boolean>; comparable: boolean; limitations: string[]; note: string;
}
interface Alertas {
  alerts: Alerta[]; scope: string; plots_considered?: number;
  not_included?: Array<{ section: string; why: string }>; note: string;
}
interface Parcela { id: string; plot_code: string }

const TIPO: Record<string, string> = {
  CAMBIO_DE_FICHA: 'Cambio de la ficha',
  GEOMETRIA: 'Geometría',
  ANALISIS_SATELITAL: 'Análisis satelital',
  EVIDENCIA: 'Evidencia',
  RIESGO: 'Riesgo',
};

function fecha(v: string | null) {
  if (!v) return <span className="muted">no registrada</span>;
  return <>{v.slice(0, 19).replace('T', ' ')}</>;
}

export default function HistoricoPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id;
  const [parcelas, setParcelas] = useState<Parcela[] | null>(null);
  const [masParcelas, setMasParcelas] = useState(false);
  const [parcela, setParcela] = useState('');
  const [hist, setHist] = useState<Hist | null>(null);
  const [alertas, setAlertas] = useState<Alertas | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [comp, setComp] = useState<Comp | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    void (async () => {
      try {
        // `/plots` viene paginado: si queda cursor, el selector NO las trae todas y hay que decirlo.
        const pag = await api<{ items: Parcela[]; next_cursor: string | null }>(`/api/v1/organizations/${orgId}/plots?limit=100`);
        setParcelas(pag.items);
        setMasParcelas(pag.next_cursor !== null);
        setAlertas(await api<Alertas>(`/api/v1/organizations/${orgId}/temporal-alerts`));
      } catch (err) { setError(err as ApiError); }
    })();
  }, [orgId]);

  const cargar = useCallback(async (plotId: string) => {
    if (!orgId || !plotId) return;
    setCargando(true); setError(null); setComp(null); setDesde(''); setHasta('');
    try { setHist(await api<Hist>(`/api/v1/organizations/${orgId}/plots/${plotId}/timeline`)); }
    catch (err) { setError(err as ApiError); setHist(null); } finally { setCargando(false); }
  }, [orgId]);

  const comparar = useCallback(async (from: string, to: string) => {
    if (!orgId || !parcela || !from || !to) return;
    setError(null);
    try { setComp(await api<Comp>(`/api/v1/organizations/${orgId}/plots/${parcela}/timeline/compare?from=${from}&to=${to}`)); }
    catch (err) { setError(err as ApiError); setComp(null); }
  }, [orgId, parcela]);

  function elegir(id: string) { setParcela(id); setHist(null); void cargar(id); }

  if (!ws.activeOrg) {
    return <ErrorPanel error={new ApiError(404, { code: 'NOT_FOUND', message: 'El recurso no existe o no está disponible para ti.', request_id: null })} />;
  }
  const migas = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Histórico' }];
  if (!ws.can('plot:read') && !ws.can('plot:read_assigned')) {
    return (
      <>
        <Breadcrumb items={migas} />
        <PageHeader title="Histórico y alertas" />
        <Alert tone="blocked" title="Tu rol no lee parcelas.">
          <p>Aquí no se afirma nada sobre ellas, <strong>ni siquiera que no haya alertas</strong>.</p>
        </Alert>
      </>
    );
  }

  return (
    <>
      <Breadcrumb items={migas} />
      <PageHeader title="Histórico y alertas" meta={<span>Solo lectura · {hist?.scope === 'ASIGNADOS' ? 'tus parcelas asignadas' : 'toda la organización'}</span>} />

      <Alert tone="info" title="Leer aquí no cambia nada.">
        <p>
          Las alertas son <strong>derivadas de lo registrado</strong>: no se marcan, no se resuelven y{' '}
          <strong>no aprueban ni habilitan nada</strong>. Ningún umbral de riesgo, caducidad o plazo legal se inventa en esta pantalla.
        </p>
      </Alert>

      <section className="card" aria-labelledby="alertas">
        <h2 id="alertas">Alertas</h2>
        {!alertas ? <Loading label="Cargando las alertas…" />
          : alertas.alerts.length === 0 ? <EmptyState title="Ninguna alerta derivable de lo registrado hoy." />
            : (
              <div className="table-wrap"><table aria-label="Alertas del histórico">
                <thead><tr><th scope="col">Problema</th><th scope="col">Parcela</th><th scope="col">Impacto</th><th scope="col">Causa</th><th scope="col">Qué NO significa</th><th scope="col">Acción</th></tr></thead>
                <tbody>{alertas.alerts.map((a, i) => (
                  <tr key={`${a.code}-${a.cause.id}-${i}`}>
                    <td><StatusBadge tone="review">{a.label}</StatusBadge><div className="muted"><code>{a.code}</code></div></td>
                    <td>{a.plot_code}</td>
                    <td className="muted">{a.impact}</td>
                    <td className="muted">{a.cause.what}<div className="muted"><code>{a.cause.kind}</code></div></td>
                    <td className="muted">{a.what_it_does_not_mean}</td>
                    <td>{a.action_href ? <a href={a.action_href}>{a.action}</a> : <span className="muted">sin acción directa</span>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
        {alertas?.not_included?.length ? (
          <p className="muted">No incluido por permisos: {alertas.not_included.map((s) => s.section).join(', ')}.</p>
        ) : null}
        <p className="muted">{alertas?.note}</p>
      </section>

      <section className="card" aria-labelledby="elegir">
        <h2 id="elegir">Elige una parcela</h2>
        {!parcelas ? <Loading label="Cargando las parcelas…" />
          : parcelas.length === 0 ? <EmptyState title="No hay parcelas que consultar todavía." />
            : (
              <>
                <label htmlFor="parcela">Parcela</label>
                <select id="parcela" value={parcela} onChange={(e) => elegir(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {parcelas.map((p) => <option key={p.id} value={p.id}>{p.plot_code}</option>)}
                </select>
                {masParcelas && (
                  <p className="muted">
                    Hay más parcelas de las que caben en esta lista. Si no encuentras la tuya, ábrela desde{' '}
                    <a href={`/organizaciones/${orgId}/parcelas`}>Parcelas</a>: aquí no se afirma que estas sean todas.
                  </p>
                )}
              </>
            )}
      </section>

      {error && <ErrorPanel error={error} onRetry={() => cargar(parcela)} />}
      {cargando && <Loading label="Cargando el histórico…" />}

      {hist && !cargando && (
        <>
          <section className="card" aria-labelledby="linea">
            <h2 id="linea">Evolución de {hist.plot.code}</h2>
            <p className="muted">{hist.reuse_note}</p>
            <p className="muted">{hist.dates_note}</p>
            {hist.periods.length === 0 ? <EmptyState title="Sin hechos registrados: no se dibuja una línea de tiempo vacía." /> : null}
            {hist.periods.map((per) => (
              <div key={per.year} className="timeline-period">
                <h3>
                  {per.year}{' '}
                  <StatusBadge tone={per.status === 'CON_REGISTROS' ? 'valid' : 'neutral'}>
                    {per.status === 'CON_REGISTROS' ? `${per.entries.length} registro(s)` : 'Sin registros'}
                  </StatusBadge>
                </h3>
                {per.status === 'SIN_REGISTROS' ? <p className="muted">{per.note}</p> : (
                  <div className="table-wrap"><table aria-label={`Registros de ${per.year}`}>
                    <thead><tr>
                      <th scope="col">Hecho</th><th scope="col">Tipo</th>
                      <th scope="col">Ocurrió</th><th scope="col">Se registró</th><th scope="col">Se evaluó</th>
                      <th scope="col">Qué dice</th>
                    </tr></thead>
                    <tbody>{per.entries.map((e) => (
                      <tr key={e.id}>
                        <td>{e.label}</td>
                        <td>{TIPO[e.kind] ?? e.kind}</td>
                        <td>{fecha(e.occurred_at)}</td>
                        <td>{fecha(e.recorded_at)}</td>
                        <td>{fecha(e.evaluated_at)}</td>
                        <td className="muted">{e.detail}<div className="muted">{e.dates_note}</div></td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
              </div>
            ))}
            <p className="muted">{hist.note}</p>
          </section>

          <section className="card" aria-labelledby="comparar">
            <h2 id="comparar">Comparar dos versiones</h2>
            {hist.comparable.length < 2 ? <EmptyState title="Hace falta más de una versión de geometría para comparar." /> : (
              <>
                <label htmlFor="desde">Desde</label>
                <select id="desde" value={desde} onChange={(e) => { setDesde(e.target.value); void comparar(e.target.value, hasta); }}>
                  <option value="">Selecciona…</option>
                  {hist.comparable.map((v) => <option key={v.id} value={v.id}>Versión {v.version_number}</option>)}
                </select>
                <label htmlFor="hasta">Hasta</label>
                <select id="hasta" value={hasta} onChange={(e) => { setHasta(e.target.value); void comparar(desde, e.target.value); }}>
                  <option value="">Selecciona…</option>
                  {hist.comparable.map((v) => <option key={v.id} value={v.id}>Versión {v.version_number}</option>)}
                </select>
              </>
            )}
            {comp && (
              <>
                <h3>Limitaciones {comp.comparable ? '' : '— léelas antes del resultado'}</h3>
                {comp.limitations.length === 0
                  ? <p className="muted">Sin limitaciones declaradas: mismo dataset, misma cobertura, mismas reglas.</p>
                  : <ul className="plain">{comp.limitations.map((l, i) => <li key={i}><StatusBadge tone="review">Limitación</StatusBadge> {l}</li>)}</ul>}
                <p className="muted">{comp.note}</p>
                <div className="table-wrap"><table aria-label="Comparación de versiones">
                  <thead><tr><th scope="col">Dato</th><th scope="col">Versión {comp.from.version_number}</th><th scope="col">Versión {comp.to.version_number}</th></tr></thead>
                  <tbody>
                    <tr><th scope="row">Levantamiento</th><td>{fecha(comp.from.surveyed_at)}</td><td>{fecha(comp.to.surveyed_at)}</td></tr>
                    <tr><th scope="row">Registro</th><td>{fecha(comp.from.recorded_at)}</td><td>{fecha(comp.to.recorded_at)}</td></tr>
                    <tr><th scope="row">Método</th><td>{comp.from.survey_method ?? '—'}</td><td>{comp.to.survey_method ?? '—'}</td></tr>
                    <tr><th scope="row">Tipo de geometría</th><td>{comp.from.geometry_type ?? '—'}</td><td>{comp.to.geometry_type ?? '—'}</td></tr>
                    <tr><th scope="row">Superficie declarada (ha)</th><td>{comp.from.area_declared_ha ?? '—'}</td><td>{comp.to.area_declared_ha ?? '—'}</td></tr>
                    <tr><th scope="row">Validación</th><td>{comp.from.validation_status ?? '—'} ({comp.from.validation_rule_version ?? 'sin versión'})</td><td>{comp.to.validation_status ?? '—'} ({comp.to.validation_rule_version ?? 'sin versión'})</td></tr>
                    <tr><th scope="row">Dataset del análisis</th>
                      <td>{comp.from.analysis ? `${comp.from.analysis.dataset ?? '—'} ${comp.from.analysis.dataset_version ?? ''}` : 'sin análisis'}</td>
                      <td>{comp.to.analysis ? `${comp.to.analysis.dataset ?? '—'} ${comp.to.analysis.dataset_version ?? ''}` : 'sin análisis'}</td></tr>
                    <tr><th scope="row">Cobertura</th>
                      <td>{comp.from.analysis?.coverage_status ?? '—'}</td><td>{comp.to.analysis?.coverage_status ?? '—'}</td></tr>
                  </tbody>
                </table></div>
              </>
            )}
          </section>

          {hist.restricted_sections.length > 0 && (
            <section className="card" aria-labelledby="restringido">
              <h2 id="restringido">Lo que no se incluyó</h2>
              <ul className="plain">{hist.restricted_sections.map((s) => (
                <li key={s.section}><code>{s.section}</code> — <span className="muted">{s.why}</span></li>
              ))}</ul>
              <p className="muted">Ausente por permisos no es lo mismo que ausente por falta de datos.</p>
            </section>
          )}
        </>
      )}
    </>
  );
}
