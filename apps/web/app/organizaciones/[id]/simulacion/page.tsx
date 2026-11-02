'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// P1-009 — Simulador de preparación de lote (RF-40; S3 §37).
//
// La pantalla no calcula nada: pide la simulación y la dibuja. Lo que no puede perderse al dibujarla:
//   · el **veredicto manda sobre el porcentaje**: un 90 % con una causa abierta sigue siendo NO EXPORTABLE,
//     y el porcentaje nunca se pinta como una barra de avance que invite a leerlo como «casi listo»;
//   · **estado real**, **escenario** y **lo que seguiría bloqueado** van en secciones separadas y rotuladas;
//   · se dice, arriba, que **es solo lectura** y que suponer no es resolver.

interface Req { code: string; label: string; status: string; detail: string; source: string; references: string[]; references_omitted: string | null }
interface Blo { code: string; label: string; status: string; class: string; why: string; detail: string }
interface Sim {
  simulated_at: string; read_only: boolean;
  inputs: {
    lot_id: string; lot_code: string;
    counts: { productores: number | null; parcelas: number; entregas: number; documentos: number; evidencias: number; cantidad: { value: string; unit: string } };
    rule_set_version: string | null; risk_evaluation_number: number | null; risk_evaluation_is_current: boolean | null;
    legal_profile_version: string | null; synthetic_fixture: boolean; note: string;
  };
  real: {
    readiness: string;
    summary: { total: number; met: number; pending: number; invalid: number; not_evaluable: number; percent_met: number; note: string };
    requirements: Req[]; dispatch_checks: Array<{ code: string; label: string; status: string; message: string }>;
    dispatch_not_simulated: Array<{ code: string; why: string }>;
    exportable: boolean; verdict: string; causes: string[]; note: string;
  };
  scenario: { assumed: Array<{ code: string; label: string; was: string; note: string }>; rejected: Array<{ code: string; why: string }>; note: string };
  projected: { readiness: string; summary: { percent_met: number; met: number; total: number }; still_blocked: Blo[]; exportable: boolean; verdict: string; causes: string[]; note: string };
  disclaimer: string;
}
interface Lote { id: string; lot_code: string; status: string }

const REQ: Record<string, { tono: 'valid' | 'review' | 'blocked' | 'neutral'; texto: string }> = {
  MET: { tono: 'valid', texto: 'Cumplido' },
  PENDING: { tono: 'review', texto: 'Pendiente' },
  INVALID: { tono: 'blocked', texto: 'No cumplido' },
  NOT_EVALUABLE: { tono: 'neutral', texto: 'No evaluable' },
};
const CLASE: Record<string, string> = {
  DATO: 'Falta un dato', DECISION: 'Espera una decisión', CAPACIDAD: 'Capacidad no implementada',
};

export default function SimulacionPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id;
  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const [lote, setLote] = useState<string>('');
  const [supuestos, setSupuestos] = useState<string[]>([]);
  const [sim, setSim] = useState<Sim | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    void (async () => {
      try { setLotes(await api<Lote[]>(`/api/v1/organizations/${orgId}/lots`)); }
      catch (err) { setError(err as ApiError); }
    })();
  }, [orgId]);

  const simular = useCallback(async (lotId: string, asumidos: string[]) => {
    if (!orgId || !lotId) return;
    setCargando(true); setError(null);
    try {
      const q = asumidos.length ? `?assume=${asumidos.join(',')}` : '';
      setSim(await api<Sim>(`/api/v1/organizations/${orgId}/simulations/lots/${lotId}${q}`));
    } catch (err) { setError(err as ApiError); setSim(null); } finally { setCargando(false); }
  }, [orgId]);

  function elegir(id: string) {
    setLote(id); setSupuestos([]); setSim(null);
    void simular(id, []);
  }
  function alternar(code: string) {
    const nuevos = supuestos.includes(code) ? supuestos.filter((c) => c !== code) : [...supuestos, code];
    setSupuestos(nuevos);
    void simular(lote, nuevos);
  }

  if (!ws.activeOrg) {
    return <ErrorPanel error={new ApiError(404, { code: 'NOT_FOUND', message: 'El recurso no existe o no está disponible para ti.', request_id: null })} />;
  }
  if (!ws.can('dd:read')) {
    return (
      <>
        <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Simulación' }]} />
        <PageHeader title="Simulación de preparación" />
        <Alert tone="blocked" title="Tu rol no lee expedientes de diligencia.">
          <p>La simulación trabaja sobre el expediente, así que no te corresponde. No es que no haya datos.</p>
        </Alert>
      </>
    );
  }

  const bloqueados = (sim?.real.requirements ?? []).filter((r) => r.status !== 'MET');

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Simulación' }]} />
      <PageHeader title="Simulación de preparación" meta={<span>Solo lectura · mismas reglas que el preflight</span>} />

      <Alert tone="info" title="Esto no cambia nada: es una consulta.">
        <p>
          La simulación <strong>no aprueba evidencias, no toca inventario y no habilita READY ni el despacho</strong>.
          Suponer un requisito resuelto <strong>no lo resuelve</strong>.
        </p>
      </Alert>

      <section className="card" aria-labelledby="elegir">
        <h2 id="elegir">Elige un lote</h2>
        {!lotes ? <Loading label="Cargando los lotes…" />
          : lotes.length === 0 ? <EmptyState title="No hay lotes que simular todavía." />
            : (
              <>
                <label htmlFor="lote">Lote</label>
                <select id="lote" value={lote} onChange={(e) => elegir(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {lotes.map((l) => <option key={l.id} value={l.id}>{l.lot_code}</option>)}
                </select>
              </>
            )}
      </section>

      {error && <ErrorPanel error={error} onRetry={() => simular(lote, supuestos)} />}
      {cargando && <Loading label="Simulando…" />}

      {sim && !cargando && (
        <>
          <section className="card" aria-labelledby="veredicto">
            <h2 id="veredicto">Veredicto</h2>
            <p>
              <StatusBadge tone={sim.real.exportable ? 'valid' : 'blocked'}>{sim.real.verdict}</StatusBadge>{' '}
              <span className="muted">
                Requisitos cumplidos: <strong>{sim.real.summary.met} de {sim.real.summary.total}</strong> ({sim.real.summary.percent_met} %).
              </span>
            </p>
            <p className="muted">{sim.real.summary.note}</p>
            <p className="muted">{sim.real.note}</p>
            <h3>Causas</h3>
            <ul className="plain">{sim.real.causes.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </section>

          <section className="card" aria-labelledby="entradas">
            <h2 id="entradas">Qué se miró, y cuándo</h2>
            <dl className="props">
              <dt>Simulado</dt><dd>{sim.simulated_at.slice(0, 19).replace('T', ' ')}</dd>
              <dt>Lote</dt><dd>{sim.inputs.lot_code}</dd>
              <dt>Productores / parcelas / entregas</dt>
              <dd>{sim.inputs.counts.productores ?? '—'} / {sim.inputs.counts.parcelas} / {sim.inputs.counts.entregas}</dd>
              <dt>Cantidad</dt><dd>{sim.inputs.counts.cantidad.value} {sim.inputs.counts.cantidad.unit}</dd>
              <dt>Documentos / evidencias</dt><dd>{sim.inputs.counts.documentos} / {sim.inputs.counts.evidencias}</dd>
              <dt>Reglas de riesgo</dt><dd>{sim.inputs.rule_set_version ?? 'sin evaluación'}</dd>
              <dt>Evaluación de riesgo</dt>
              <dd>{sim.inputs.risk_evaluation_number ?? '—'}{sim.inputs.risk_evaluation_is_current === false ? ' (desactualizada)' : ''}</dd>
              <dt>Perfil jurídico</dt><dd>{sim.inputs.legal_profile_version ?? 'sin perfil adoptado'}</dd>
            </dl>
            <p className="muted">{sim.inputs.note}</p>
            {sim.inputs.synthetic_fixture && <Alert tone="review" title="Contenido de FIXTURE SINTÉTICA: no acredita nada." />}
          </section>

          <section className="card" aria-labelledby="real">
            <h2 id="real">Estado real del expediente</h2>
            <div className="table-wrap"><table aria-label="Requisitos del expediente">
              <thead><tr><th scope="col">Requisito</th><th scope="col">Estado</th><th scope="col">Detalle</th></tr></thead>
              <tbody>{sim.real.requirements.map((r) => (
                <tr key={r.code}>
                  <td>{r.label}<div className="muted"><code>{r.code}</code></div></td>
                  <td><StatusBadge tone={REQ[r.status].tono}>{REQ[r.status].texto}</StatusBadge></td>
                  <td className="muted">{r.detail}{r.references_omitted ? ` ${r.references_omitted}` : ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <h3>Comprobaciones de despacho (mismas reglas que el preflight)</h3>
            <ul className="plain">{sim.real.dispatch_checks.map((c) => (
              <li key={c.code}>
                <StatusBadge tone={c.status === 'OK' ? 'valid' : 'blocked'}>{c.status === 'OK' ? 'Cumple' : 'Bloquea'}</StatusBadge>{' '}
                {c.label} — <span className="muted">{c.message}</span>
              </li>
            ))}</ul>
            <p className="muted">
              No se simulan, porque dependen de un embarque concreto:{' '}
              {sim.real.dispatch_not_simulated.map((c) => c.code).join(', ')}.
            </p>
          </section>

          <section className="card" aria-labelledby="escenario">
            <h2 id="escenario">Escenario hipotético</h2>
            <p className="muted">{sim.scenario.note}</p>
            {bloqueados.length === 0 ? <p>No hay nada que suponer: no quedan requisitos sin cumplir.</p> : (
              <fieldset aria-label="Supuestos del escenario">
                <legend className="muted">Marca los requisitos que quieres <strong>suponer</strong> resueltos:</legend>
                {bloqueados.map((r) => (
                  <label key={r.code} className="checkbox-row">
                    <input type="checkbox" checked={supuestos.includes(r.code)} onChange={() => alternar(r.code)} /> {r.label}
                  </label>
                ))}
              </fieldset>
            )}
            {sim.scenario.rejected.length > 0 && (
              <ul className="plain">{sim.scenario.rejected.map((r) => (
                <li key={r.code} className="muted"><code>{r.code}</code>: {r.why}</li>
              ))}</ul>
            )}
          </section>

          <section className="card" aria-labelledby="proyeccion">
            <h2 id="proyeccion">Qué seguiría bloqueado</h2>
            <p>
              <StatusBadge tone={sim.projected.exportable ? 'valid' : 'blocked'}>{sim.projected.verdict}</StatusBadge>{' '}
              <span className="muted">
                Con el escenario: <strong>{sim.projected.summary.met} de {sim.projected.summary.total}</strong> ({sim.projected.summary.percent_met} %).
              </span>
            </p>
            {sim.projected.still_blocked.length === 0 ? <p className="muted">Ningún requisito quedaría sin cumplir con lo supuesto.</p> : (
              <div className="table-wrap"><table aria-label="Seguiría bloqueado">
                <thead><tr><th scope="col">Requisito</th><th scope="col">Clase</th><th scope="col">Por qué</th></tr></thead>
                <tbody>{sim.projected.still_blocked.map((b) => (
                  <tr key={b.code}>
                    <td>{b.label}<div className="muted"><code>{b.code}</code></div></td>
                    <td><StatusBadge tone={b.class === 'DATO' ? 'review' : 'neutral'}>{CLASE[b.class]}</StatusBadge></td>
                    <td className="muted">{b.why}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <h3>Causas que seguirían abiertas</h3>
            <ul className="plain">{sim.projected.causes.map((c, i) => <li key={i} className="muted">{c}</li>)}</ul>
            <p className="muted">{sim.projected.note}</p>
          </section>

          <Alert tone="info" title={sim.disclaimer} />
        </>
      )}
    </>
  );
}
