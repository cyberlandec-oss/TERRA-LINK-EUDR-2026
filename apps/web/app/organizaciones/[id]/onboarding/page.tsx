'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// P1-004 — Puesta en marcha y madurez (RF-35; S3 §16; UX_UI §10.4).
//
// La pantalla no decide nada: muestra lo que el backend diagnostica sobre el dato vigente, con la evidencia de
// cada señal y su fuente. Tres cosas que no se pueden perder al dibujarlo:
//   · un nivel **no alcanzado** nunca se pinta como avance ni como porcentaje;
//   · **dato faltante**, **capacidad no implementada** y **decisión pendiente** van separados y rotulados;
//   · la madurez **no acredita conformidad** y se dice en la propia pantalla, no en una nota al pie.

interface Senal {
  code: string; question: string; state: string;
  evidence: { count: number | null; scope: string; as_of: string | null; note: string };
  source: string;
}
interface NivelD { level: number; name: string; source: string; state: string; why: string; signals: Senal[] }
interface PasoD { code: string; title: string; state: string; why: string; evidence: string; action_href: string | null; who: string }
interface Diag {
  organization_status: string;
  scope_of_diagnosis: 'ORGANIZACION' | 'MI_ALCANCE';
  criterion: { id: string; version: string; status: string; option?: string; note: string; threshold: string };
  level: { reached: number | null; name: string | null; basis: string };
  levels: NivelD[]; steps: PasoD[];
  blockers: {
    missing_data: Array<{ level: number; code: string; question: string }>;
    not_implemented: Array<{ level: number; code: string; note: string }>;
    undecided: Array<{ level: number; code: string; note: string }>;
  };
  freshness: string; disclaimer: string;
}

const NIVEL: Record<string, { tono: 'valid' | 'review' | 'blocked' | 'neutral'; texto: string }> = {
  ALCANZADO: { tono: 'valid', texto: 'Alcanzado' },
  NO_ALCANZADO: { tono: 'review', texto: 'No alcanzado' },
  NO_DETERMINABLE: { tono: 'neutral', texto: 'No determinable aquí' },
  NO_IMPLEMENTADO: { tono: 'neutral', texto: 'Capacidad no implementada' },
};
const SENAL: Record<string, { tono: 'valid' | 'review' | 'blocked' | 'neutral'; texto: string }> = {
  OBSERVADA: { tono: 'valid', texto: 'Observada' },
  NO_OBSERVADA: { tono: 'review', texto: 'Sin observar' },
  RESTRINGIDA: { tono: 'neutral', texto: 'Fuera de tu alcance' },
  NO_IMPLEMENTADA: { tono: 'neutral', texto: 'No implementada' },
  SIN_DECIDIR: { tono: 'review', texto: 'Decisión pendiente' },
  FUERA_DEL_SISTEMA: { tono: 'neutral', texto: 'Fuera de Terra Link' },
};
const PASO: Record<string, { tono: 'valid' | 'review' | 'blocked' | 'neutral'; texto: string }> = {
  HECHO: { tono: 'valid', texto: 'Hecho' },
  PENDIENTE: { tono: 'review', texto: 'Pendiente' },
  OPCIONAL: { tono: 'neutral', texto: 'Opcional' },
  RESTRINGIDO: { tono: 'neutral', texto: 'Tu rol no lo hace' },
};
const ALCANCE: Record<string, string> = {
  ORGANIZACION: 'toda la organización', ASIGNADOS: 'solo lo asignado a ti', RESTRINGIDO: 'fuera de tu alcance',
};

export default function OnboardingPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id;
  const [data, setData] = useState<Diag | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    try { setData(await api<Diag>(`/api/v1/organizations/${orgId}/onboarding`)); }
    catch (err) { setError(err as ApiError); }
  }, [orgId]);
  useEffect(() => { setData(null); void load(); }, [load]);

  if (!ws.activeOrg) {
    return <ErrorPanel error={new ApiError(404, { code: 'NOT_FOUND', message: 'El recurso no existe o no está disponible para ti.', request_id: null })} />;
  }

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Puesta en marcha' }]} />
      <PageHeader title="Puesta en marcha y madurez" meta={<span>Diagnóstico con evidencia · S3 §16</span>} />

      {error ? <ErrorPanel error={error} onRetry={load} />
        : !data ? <Loading label="Calculando el diagnóstico…" />
          : (
            <>
              <Alert tone="info" title="Esto mide la operación, no el cumplimiento.">
                <p>{data.disclaimer}</p>
              </Alert>

              {data.scope_of_diagnosis === 'MI_ALCANCE' && (
                <Alert tone="review" title="Este diagnóstico es el de tu alcance, no el de toda la organización.">
                  <p>
                    Solo se cuenta lo que tu rol puede leer. Los niveles cuyas señales no alcanzas aparecen como
                    <strong> no determinables</strong>, no como «no alcanzados»: afirmar que algo no existe exigiría poder mirarlo.
                  </p>
                </Alert>
              )}

              <section className="card" aria-labelledby="nivel">
                <h2 id="nivel">Nivel{data.scope_of_diagnosis === 'MI_ALCANCE' ? ' (de tu alcance)' : ''}</h2>
                <p>
                  {data.level.reached === null
                    ? <strong>Sin nivel observable</strong>
                    : <><strong>Nivel {data.level.reached}</strong> — {data.level.name}</>}
                </p>
                <p className="muted">{data.level.basis}</p>
                <p className="muted">{data.freshness}</p>
                <p className="muted">
                  <strong>Criterio {data.criterion.id}{data.criterion.option ? ` opción ${data.criterion.option}` : ''} ({data.criterion.version}, {data.criterion.status}):</strong>{' '}
                  {data.criterion.note} {data.criterion.threshold}
                </p>
              </section>

              <section className="card" aria-labelledby="niveles">
                <h2 id="niveles">Los siete niveles y su evidencia</h2>
                <ul className="plain">
                  {data.levels.map((n) => (
                    <li key={n.level} className="work-item">
                      <h3>
                        Nivel {n.level}: {n.name}{' '}
                        <StatusBadge tone={NIVEL[n.state].tono}>{NIVEL[n.state].texto}</StatusBadge>
                      </h3>
                      <p className="muted">{n.why} <em>Fuente: {n.source}.</em></p>
                      <div className="table-wrap"><table aria-label={`Señales del nivel ${n.level}`}>
                        <thead><tr>
                          <th scope="col">Señal</th><th scope="col">Estado</th><th scope="col">Evidencia</th>
                        </tr></thead>
                        <tbody>{n.signals.map((s) => (
                          <tr key={s.code}>
                            <td>{s.question}<div className="muted"><code>{s.code}</code></div></td>
                            <td><StatusBadge tone={SENAL[s.state].tono}>{SENAL[s.state].texto}</StatusBadge></td>
                            <td>
                              {s.evidence.count === null ? <em>sin número</em> : <strong>{s.evidence.count}</strong>}
                              <div className="muted">Alcance: {ALCANCE[s.evidence.scope]}.{s.evidence.as_of ? ` Último registro: ${s.evidence.as_of.slice(0, 10)}.` : ''}</div>
                              <div className="muted">{s.evidence.note}</div>
                            </td>
                          </tr>
                        ))}</tbody>
                      </table></div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="card" aria-labelledby="pasos">
                <h2 id="pasos">Asistente de puesta en marcha</h2>
                <p className="muted">
                  Los pasos salen del dato real y se recalculan al abrir esta pantalla: no hay marcas guardadas que
                  puedan contradecir la realidad. Un paso pendiente no impide operar.
                </p>
                <div className="table-wrap"><table aria-label="Pasos de puesta en marcha">
                  <thead><tr>
                    <th scope="col">Paso</th><th scope="col">Estado</th><th scope="col">Por qué</th>
                    <th scope="col">Quién</th><th scope="col">Ir</th>
                  </tr></thead>
                  <tbody>{data.steps.map((p) => (
                    <tr key={p.code}>
                      <td>{p.title}<div className="muted">{p.evidence}</div></td>
                      <td><StatusBadge tone={PASO[p.state].tono}>{PASO[p.state].texto}</StatusBadge></td>
                      <td className="muted">{p.why}</td>
                      <td className="muted">{p.who}</td>
                      <td>{p.action_href ? <Link href={p.action_href}>Abrir</Link> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              </section>

              <section className="card" aria-labelledby="bloqueos">
                <h2 id="bloqueos">Qué falta, y de qué clase es</h2>
                <p className="muted">
                  Tres cosas distintas, que no deben confundirse: un dato que nadie ha cargado, una capacidad que
                  Terra Link todavía no tiene, y una decisión que nadie ha tomado.
                </p>
                <h3>Datos por cargar <StatusBadge tone="review">{data.blockers.missing_data.length}</StatusBadge></h3>
                {data.blockers.missing_data.length === 0 ? <p className="muted">Ninguno de los niveles observables espera un dato.</p> : (
                  <ul className="plain">{data.blockers.missing_data.map((b) => (
                    <li key={b.code}><strong>Nivel {b.level}</strong> · {b.question}</li>
                  ))}</ul>
                )}
                <h3>Capacidades no implementadas <StatusBadge tone="neutral">{data.blockers.not_implemented.length}</StatusBadge></h3>
                {data.blockers.not_implemented.length === 0 ? <p className="muted">Ninguna.</p> : (
                  <ul className="plain">{data.blockers.not_implemented.map((b) => (
                    <li key={b.code}><strong>Nivel {b.level}</strong> · {b.note}</li>
                  ))}</ul>
                )}
                <h3>Decisiones pendientes <StatusBadge tone="review">{data.blockers.undecided.length}</StatusBadge></h3>
                {data.blockers.undecided.length === 0 ? <p className="muted">Ninguna.</p> : (
                  <ul className="plain">{data.blockers.undecided.map((b) => (
                    <li key={b.code}><strong>Nivel {b.level}</strong> · {b.note}</li>
                  ))}</ul>
                )}
              </section>
            </>
          )}
    </>
  );
}
