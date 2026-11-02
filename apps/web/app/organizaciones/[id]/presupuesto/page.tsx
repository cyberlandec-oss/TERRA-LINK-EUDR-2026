'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, apiDownload } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// P1-010 — Presupuesto de preparación (RF-41; S3 §33; D-51).
//
// Lo que la pantalla no puede dejar que se confunda:
//   · **lo declarado** (importes y cantidades) frente a **lo observado** (datos del sistema, con su fecha);
//   · un concepto **pendiente de presupuestar** frente a uno que vale **cero** — no es lo mismo, y el total
//     se marca **incompleto** en vez de sumar como si valiera cero;
//   · los denominadores son un **reparto del presupuesto del escenario**, no un coste contable del lote.

interface Parametro { id: string; concept: string; unit: string; validation_kind: string | null; amount: string; currency: string; valid_from: string; valid_to: string | null; version: number }
interface ConceptoVista { concept: string; unit: string; unit_label: string; current: Parametro | null; pending_budget: boolean; note: string }
interface Historial extends Parametro { note: string | null; created_at: string; autor: string }
interface Linea {
  concept: string; unit: string; unit_label: string;
  parameter: { amount: string; version: number; valid_from: string; valid_to: string | null; validation_kind: string | null } | null;
  quantity: string | null; quantity_kind: string | null; basis: string | null;
  subtotal: string | null; status: string; note: string;
}
interface Est {
  id?: string; currency: string; scope: { lot_code: string }; lines: Linea[];
  total: { known: string; complete: boolean; pending_concepts: Array<{ concept: string; status: string }>; note: string };
  denominators: {
    distinct_producers: { value: number; cost_each: string | null; status: string; why: string | null };
    tonne: { physical_quantity: string; unit: string; source: string; as_of: string; tonnes: string | null; cost_each: string | null; status: string; why: string | null };
    note: string;
  };
  observed: { as_of: string; lot_code: string; plots_total: number; plots_without_geometry: number; documents: number; requirements_pending: number; note: string };
  disclaimer: string; saved: boolean;
}
interface Lote { id: string; lot_code: string }
interface Guardada { id: string; lot_code: string; total_known: string; complete: boolean; created_at: string; autor: string }

const ETIQUETA: Record<string, string> = {
  GEOREFERENCIACION: 'Georreferenciación', VALIDACION: 'Validación', DOCUMENTACION: 'Documentación',
  ANALISIS_SATELITAL: 'Análisis satelital', ADMINISTRACION: 'Administración',
};
const ESTADO: Record<string, { tono: 'valid' | 'review' | 'neutral'; texto: string }> = {
  CALCULADO: { tono: 'valid', texto: 'Calculado' },
  SIN_PARAMETRO: { tono: 'review', texto: 'Sin importe presupuestado' },
  SIN_CANTIDAD: { tono: 'review', texto: 'Sin cantidad declarada' },
};

export default function PresupuestoPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id;
  const puedeFijar = ws.can('cost:manage');

  const [conceptos, setConceptos] = useState<ConceptoVista[] | null>(null);
  const [historial, setHistorial] = useState<Historial[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [guardadas, setGuardadas] = useState<Guardada[]>([]);
  const [lote, setLote] = useState('');
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [est, setEst] = useState<Est | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    try {
      const [p, l, g] = await Promise.all([
        api<{ concepts: ConceptoVista[]; history: Historial[]; note: string }>(`/api/v1/organizations/${orgId}/cost/parameters`),
        api<Lote[]>(`/api/v1/organizations/${orgId}/lots`),
        api<{ estimates: Guardada[] }>(`/api/v1/organizations/${orgId}/cost/estimates`),
      ]);
      setConceptos(p.concepts); setHistorial(p.history); setLotes(l); setGuardadas(g.estimates);
    } catch (err) { setError(err as ApiError); }
  }, [orgId]);
  useEffect(() => { setConceptos(null); void load(); }, [load]);

  const cuerpo = () => ({
    lot_id: lote,
    quantities: Object.entries(cantidades)
      .filter(([, v]) => v.trim() !== '')
      .map(([concept, quantity]) => ({ concept, quantity: quantity.trim() })),
  });

  async function calcular() {
    if (!lote) return;
    setOcupado(true); setError(null); setAviso(null);
    try { setEst(await api<Est>(`/api/v1/organizations/${orgId}/cost/estimates/preview`, { method: 'POST', body: cuerpo() })); }
    catch (err) { setError(err as ApiError); setEst(null); } finally { setOcupado(false); }
  }
  async function guardar() {
    setOcupado(true); setError(null); setAviso(null);
    try {
      const g = await api<Est & { id: string }>(`/api/v1/organizations/${orgId}/cost/estimates`, {
        method: 'POST', body: { operation_id: crypto.randomUUID(), ...cuerpo() },
      });
      setEst(g); setAviso('Estimación guardada con los parámetros y cantidades que usó.');
      await load();
    } catch (err) { setError(err as ApiError); } finally { setOcupado(false); }
  }
  async function registrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setOcupado(true); setError(null); setAviso(null);
    try {
      await api(`/api/v1/organizations/${orgId}/cost/parameters`, {
        method: 'POST',
        body: {
          operation_id: crypto.randomUUID(), concept: String(f.get('concept') ?? ''),
          amount: String(f.get('amount') ?? ''), currency: 'USD',
          valid_from: String(f.get('valid_from') ?? ''),
          ...(f.get('valid_to') ? { valid_to: String(f.get('valid_to')) } : {}),
          ...(f.get('validation_kind') ? { validation_kind: String(f.get('validation_kind')) } : {}),
          ...(f.get('note') ? { note: String(f.get('note')) } : {}),
        },
      });
      setAviso('Parámetro registrado como versión nueva. El anterior se conserva: aquí no se edita nada.');
      (e.target as HTMLFormElement).reset();
      await load();
    } catch (err) { setError(err as ApiError); } finally { setOcupado(false); }
  }

  if (!ws.activeOrg) {
    return <ErrorPanel error={new ApiError(404, { code: 'NOT_FOUND', message: 'El recurso no existe o no está disponible para ti.', request_id: null })} />;
  }
  if (!ws.can('cost:read')) {
    return (
      <>
        <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Presupuesto' }]} />
        <PageHeader title="Presupuesto de preparación" />
        <Alert tone="blocked" title="Tu rol no participa en el presupuesto de preparación.">
          <p>Lo llevan la administración y la gerencia de la organización. No es que no haya datos.</p>
        </Alert>
      </>
    );
  }

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Presupuesto' }]} />
      <PageHeader title="Presupuesto de preparación" meta={<span>Importes declarados · USD</span>} />

      <Alert tone="info" title="Estos importes los declara tu organización.">
        <p>
          <strong>No son precios oficiales, ni costes medidos, ni ofertas de proveedores.</strong> Las cantidades
          también se declaran y quedan marcadas como estimadas: Terra Link no observa estas actividades.
        </p>
      </Alert>

      {error && <ErrorPanel error={error} onRetry={load} />}
      {aviso && <Alert tone="valid" title={aviso} />}

      <section className="card" aria-labelledby="parametros">
        <h2 id="parametros">Parámetros presupuestarios</h2>
        {!conceptos ? <Loading label="Cargando los parámetros…" /> : (
          <div className="table-wrap"><table aria-label="Parámetros presupuestarios">
            <thead><tr>
              <th scope="col">Concepto</th><th scope="col">Unidad presupuestaria</th><th scope="col">Importe vigente</th>
              <th scope="col">Versión</th><th scope="col">Vigencia</th><th scope="col">Qué no demuestra</th>
            </tr></thead>
            <tbody>{conceptos.map((c) => (
              <tr key={c.concept}>
                <td>{ETIQUETA[c.concept]}</td>
                <td>{c.unit_label}{c.current?.validation_kind ? ` · ${c.current.validation_kind}` : ''}</td>
                <td>{c.current ? `${c.current.amount} USD` : <StatusBadge tone="review">Pendiente de presupuestar</StatusBadge>}</td>
                <td>{c.current?.version ?? '—'}</td>
                <td>{c.current ? `${c.current.valid_from} – ${c.current.valid_to ?? 'sin fin'}` : '—'}</td>
                <td className="muted">{c.note}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {puedeFijar && (
          <form onSubmit={registrar} className="form">
            <h3>Registrar una versión</h3>
            <p className="field-help">Corregir un importe es registrar la siguiente versión; la anterior se conserva.</p>
            <label htmlFor="concept">Concepto</label>
            <select id="concept" name="concept" required>
              {Object.entries(ETIQUETA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label htmlFor="amount">Importe en USD</label>
            <input id="amount" name="amount" required pattern="\d{1,14}(\.\d{1,6})?" placeholder="2.50" />
            <label htmlFor="validation_kind">Tipo de revisión (solo en Validación)</label>
            <input id="validation_kind" name="validation_kind" minLength={3} maxLength={120} />
            <label htmlFor="valid_from">Vigente desde</label>
            <input id="valid_from" name="valid_from" type="date" required />
            <label htmlFor="valid_to">Vigente hasta (opcional)</label>
            <input id="valid_to" name="valid_to" type="date" />
            <label htmlFor="note">Nota (opcional)</label>
            <input id="note" name="note" maxLength={500} />
            <button type="submit" disabled={ocupado}>Registrar versión</button>
          </form>
        )}
        {historial.length > 0 && (
          <details>
            <summary>Historial de versiones ({historial.length})</summary>
            <ul className="plain">{historial.map((p) => (
              <li key={p.id} className="muted">
                {ETIQUETA[p.concept]} v{p.version}: {p.amount} USD · {p.valid_from} – {p.valid_to ?? 'sin fin'} · {p.autor}
                {p.note ? ` · ${p.note}` : ''}
              </li>
            ))}</ul>
          </details>
        )}
      </section>

      <section className="card" aria-labelledby="escenario">
        <h2 id="escenario">Escenario</h2>
        {lotes.length === 0 ? <EmptyState title="No hay lotes sobre los que presupuestar." /> : (
          <>
            <label htmlFor="lote">Lote</label>
            <select id="lote" value={lote} onChange={(e) => { setLote(e.target.value); setEst(null); }}>
              <option value="">Selecciona…</option>
              {lotes.map((l) => <option key={l.id} value={l.id}>{l.lot_code}</option>)}
            </select>
            <fieldset aria-label="Cantidades declaradas">
              <legend className="field-help">
                Cantidades <strong>declaradas</strong>: el sistema no las observa. Déjalas en blanco si no las has estimado;
                en blanco <strong>no es cero</strong>.
              </legend>
              {(conceptos ?? []).map((c) => (
                <span key={c.concept}>
                  <label htmlFor={`q-${c.concept}`}>{ETIQUETA[c.concept]} ({c.unit_label})</label>
                  <input
                    id={`q-${c.concept}`} inputMode="decimal" pattern="\d{1,14}(\.\d{1,6})?"
                    value={cantidades[c.concept] ?? ''}
                    onChange={(e) => setCantidades({ ...cantidades, [c.concept]: e.target.value })}
                  />
                </span>
              ))}
            </fieldset>
            <div className="actions">
              <button type="button" onClick={calcular} disabled={!lote || ocupado}>Calcular</button>
              <button type="button" className="secondary" onClick={guardar} disabled={!lote || ocupado}>Calcular y guardar</button>
            </div>
          </>
        )}
      </section>

      {est && (
        <>
          <section className="card" aria-labelledby="resultado">
            <h2 id="resultado">Resultado para {est.scope.lot_code}</h2>
            <div className="table-wrap"><table aria-label="Líneas del presupuesto">
              <thead><tr>
                <th scope="col">Concepto</th><th scope="col">Importe</th><th scope="col">Cantidad declarada</th>
                <th scope="col">Subtotal</th><th scope="col">Estado</th>
              </tr></thead>
              <tbody>{est.lines.map((l) => (
                <tr key={l.concept}>
                  <td>{ETIQUETA[l.concept]}<div className="muted">{l.unit_label}</div></td>
                  <td>{l.parameter ? `${l.parameter.amount} USD (v${l.parameter.version})` : '—'}</td>
                  <td>{l.quantity ?? '—'}{l.quantity_kind ? <div className="muted">declarada y estimada</div> : null}</td>
                  <td>{l.subtotal ? `${l.subtotal} USD` : '—'}</td>
                  <td><StatusBadge tone={ESTADO[l.status].tono}>{ESTADO[l.status].texto}</StatusBadge></td>
                </tr>
              ))}</tbody>
            </table></div>
            <p>
              <strong>Total conocido: {est.total.known} USD</strong>{' '}
              <StatusBadge tone={est.total.complete ? 'valid' : 'review'}>{est.total.complete ? 'Presupuesto completo' : 'INCOMPLETO'}</StatusBadge>
            </p>
            <p className="muted">{est.total.note}</p>
            {est.total.pending_concepts.length > 0 && (
              <p className="muted">
                Pendientes de presupuestar: {est.total.pending_concepts.map((p) => `${ETIQUETA[p.concept]} (${ESTADO[p.status].texto.toLowerCase()})`).join(', ')}.
              </p>
            )}
          </section>

          <section className="card" aria-labelledby="denominadores">
            <h2 id="denominadores">Reparto</h2>
            <dl className="props">
              <dt>Por productor distinto</dt>
              <dd>
                {est.denominators.distinct_producers.cost_each
                  ? `${est.denominators.distinct_producers.cost_each} USD · ${est.denominators.distinct_producers.value} productor(es)`
                  : <StatusBadge tone="neutral">No calculable</StatusBadge>}
                {est.denominators.distinct_producers.why && <div className="muted">{est.denominators.distinct_producers.why}</div>}
              </dd>
              <dt>Por tonelada</dt>
              <dd>
                {est.denominators.tonne.cost_each
                  ? `${est.denominators.tonne.cost_each} USD/t`
                  : <StatusBadge tone="neutral">No calculable</StatusBadge>}
                <div className="muted">
                  Peso físico del ledger: {est.denominators.tonne.physical_quantity} {est.denominators.tonne.unit} ·
                  consultado el {est.denominators.tonne.as_of.slice(0, 19).replace('T', ' ')}
                </div>
                {est.denominators.tonne.why && <div className="muted">{est.denominators.tonne.why}</div>}
              </dd>
            </dl>
            <p className="muted">{est.denominators.note}</p>
          </section>

          <section className="card" aria-labelledby="observado">
            <h2 id="observado">Lo observado (no es una cantidad de coste)</h2>
            <dl className="props">
              <dt>Consultado</dt><dd>{est.observed.as_of.slice(0, 19).replace('T', ' ')}</dd>
              <dt>Parcelas</dt><dd>{est.observed.plots_total} · sin ubicación: {est.observed.plots_without_geometry}</dd>
              <dt>Documentos</dt><dd>{est.observed.documents}</dd>
              <dt>Requisitos pendientes</dt><dd>{est.observed.requirements_pending}</dd>
            </dl>
            <p className="muted">{est.observed.note}</p>
          </section>

          <Alert tone="info" title={est.disclaimer} />
        </>
      )}

      <section className="card" aria-labelledby="guardadas">
        <h2 id="guardadas">Estimaciones guardadas</h2>
        {guardadas.length === 0 ? <EmptyState title="Todavía no has guardado ninguna estimación." /> : (
          <div className="table-wrap"><table aria-label="Estimaciones guardadas">
            <thead><tr>
              <th scope="col">Lote</th><th scope="col">Total conocido</th><th scope="col">Estado</th>
              <th scope="col">Cuándo</th><th scope="col">Quién</th><th scope="col"></th>
            </tr></thead>
            <tbody>{guardadas.map((g) => (
              <tr key={g.id}>
                <td>{g.lot_code}</td>
                <td>{g.total_known} USD</td>
                <td><StatusBadge tone={g.complete ? 'valid' : 'review'}>{g.complete ? 'Completo' : 'Incompleto'}</StatusBadge></td>
                <td>{g.created_at.slice(0, 19).replace('T', ' ')}</td>
                <td>{g.autor}</td>
                <td>
                  <button
                    type="button" className="secondary" disabled={ocupado}
                    onClick={() => apiDownload(`/api/v1/organizations/${orgId}/cost/estimates/${g.id}/download`, 'presupuesto.xlsx').catch((e) => setError(e as ApiError))}
                  >Descargar
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
