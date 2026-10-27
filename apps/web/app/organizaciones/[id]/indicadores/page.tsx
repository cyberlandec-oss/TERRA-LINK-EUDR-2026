'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, apiDownload } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// P1-014 — Indicadores comerciales (RF-45; S3 §41).
//
// Lo que esta pantalla no puede dejar de decir:
//   · **cada indicador se explica solo**: qué mide, fórmula, unidad, período, denominador, cobertura y procedencia;
//   · **no hay score**: ponderar las dimensiones no está decidido (D-53), y no se finge un número único;
//   · **lo incompatible se excluye y se cuenta**, nunca se convierte;
//   · **SIN_DATOS, NO_CALCULABLE y RESTRINGIDO son tres cosas distintas**, y se distinguen a la vista;
//   · el **riesgo regulatorio va aparte** y `UNDETERMINED` **no** significa riesgo bajo;
//   · lo que **no se implementa** se enumera **con su condición exacta**, en vez de fingirse.

interface Ind {
  id: string; label: string; what_it_measures: string; formula: string; unit: string;
  period: { from: string | null; to: string | null; kind: string };
  denominator: { label: string; value: string | null } | null;
  coverage: { considered: number; used: number; excluded: number; note: string } | null;
  provenance: string;
  group: { currency: string | null; unit: string | null; product: string | null } | null;
  value: string | null; status: string;
  excluded: Array<{ reason: string; count: number }>;
  limits: string[]; why: string | null;
}
interface Vista {
  period: { from: string | null; to: string | null; kind: string }; period_note: string;
  product_filter: { id: string; name: string } | null;
  indicators: Ind[];
  regulatory_context: { available: boolean; conclusions: Array<{ conclusion: string; count: number; current: number }> | null; why: string | null; note: string };
  not_implemented: Array<{ question: string; condition: string }>;
  disclaimer: string; synthetic_note: string;
}
interface Prod { producer_id: string; producer_code: string; deliveries: number | null; with_economics: number | null; without_economics: number | null; weighted_price: string | null; price_group: { currency: string | null; unit: string | null } | null; received: { quantity: string; unit: string | null } | null; why: string | null }
interface PorProductor { scope: string; producers: Prod[]; note: string; separation_note: string }
interface Producto { id: string; name: string }

const TONO: Record<string, 'valid' | 'review' | 'blocked' | 'neutral'> = {
  CALCULADO: 'valid', SIN_DATOS: 'neutral', NO_CALCULABLE: 'review', RESTRINGIDO: 'blocked',
};
const ETIQUETA: Record<string, string> = {
  CALCULADO: 'Calculado', SIN_DATOS: 'Sin datos', NO_CALCULABLE: 'No calculable', RESTRINGIDO: 'Restringido',
};
const PROCEDENCIA: Record<string, string> = {
  DECLARADO: 'Declarado', INFORMADO: 'Informado', OBSERVADO: 'Observado', ESTIMADO: 'Estimado', REGISTRADO: 'Registrado',
};

export default function IndicadoresPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id;
  const [v, setV] = useState<Vista | null>(null);
  const [porProd, setPorProd] = useState<PorProductor | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [producto, setProducto] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [cargando, setCargando] = useState(false);

  const consulta = useCallback(() => {
    const p = new URLSearchParams();
    if (desde) p.set('from', desde);
    if (hasta) p.set('to', hasta);
    if (producto) p.set('product_id', producto);
    return p.toString() ? `?${p.toString()}` : '';
  }, [desde, hasta, producto]);

  const cargar = useCallback(async () => {
    if (!orgId) return;
    setCargando(true); setError(null);
    try {
      setV(await api<Vista>(`/api/v1/organizations/${orgId}/analytics/commercial${consulta()}`));
      const q = new URLSearchParams();
      if (desde) q.set('from', desde);
      if (hasta) q.set('to', hasta);
      setPorProd(await api<PorProductor>(`/api/v1/organizations/${orgId}/analytics/producers${q.toString() ? `?${q}` : ''}`));
    } catch (err) { setError(err as ApiError); } finally { setCargando(false); }
  }, [orgId, consulta, desde, hasta]);

  useEffect(() => {
    if (!orgId) return;
    void (async () => {
      try {
        // `/products` viene paginado: tratarlo como array rompía la pantalla entera.
        const pag = await api<{ items: Producto[]; next_cursor: string | null }>(`/api/v1/organizations/${orgId}/products?limit=100`);
        setProductos(pag.items ?? []);
      } catch { /* el filtro de producto es opcional: su ausencia no rompe la pantalla */ }
    })();
  }, [orgId]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function descargar() {
    if (!orgId) return;
    setError(null);
    try { await apiDownload(`/api/v1/organizations/${orgId}/analytics/commercial/download${consulta()}`, 'indicadores-comerciales.xlsx'); }
    catch (err) { setError(err as ApiError); }
  }

  if (!ws.activeOrg) {
    return <ErrorPanel error={new ApiError(404, { code: 'NOT_FOUND', message: 'El recurso no existe o no está disponible para ti.', request_id: null })} />;
  }
  const migas = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Indicadores' }];
  if (!ws.can('analytics:read')) {
    return (
      <>
        <Breadcrumb items={migas} />
        <PageHeader title="Indicadores comerciales" />
        <Alert tone="blocked" title="Tu rol no lee indicadores comerciales.">
          <p>Es un permiso aparte. No es que no haya datos.</p>
        </Alert>
      </>
    );
  }

  return (
    <>
      <Breadcrumb items={migas} />
      <PageHeader title="Indicadores comerciales" meta={<span>Solo lectura · separado del riesgo regulatorio</span>} />

      <Alert tone="info" title="No hay un número único, y es deliberado.">
        <p>
          Un score de proveedor exige <strong>ponderar</strong> precio, calidad, volumen y trazabilidad, y esa
          ponderación <strong>no está decidida</strong>. Aquí cada indicador va <strong>por separado y explicado</strong>:
          qué mide, con qué fórmula, sobre qué denominador y con cuánta cobertura. Tampoco se fija ningún umbral de
          «datos suficientes»: se publica la cobertura y la lectura es tuya.
        </p>
      </Alert>

      <section className="card" aria-labelledby="ind-filtros">
        <h2 id="ind-filtros">Período y producto</h2>
        <label htmlFor="desde">Desde</label>
        <input id="desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <label htmlFor="hasta">Hasta</label>
        <input id="hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <label htmlFor="producto">Producto</label>
        <select id="producto" value={producto} onChange={(e) => setProducto(e.target.value)}>
          <option value="">Todos</option>
          {productos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {v && <p className="muted">{v.period_note}</p>}
        <div className="actions">
          {ws.can('report:export') && <button type="button" onClick={descargar}>Descargar con sus supuestos</button>}
        </div>
      </section>

      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {cargando && <Loading label="Calculando indicadores…" />}

      {v && !cargando && (
        <>
          <section className="card" aria-labelledby="ind-lista">
            <h2 id="ind-lista">Indicadores</h2>
            {v.indicators.length === 0 ? <EmptyState title="No hay ningún indicador que mostrar." /> : (
              <div className="table-wrap"><table aria-label="Indicadores comerciales">
                <thead><tr>
                  <th scope="col">Indicador</th><th scope="col">Estado</th><th scope="col">Valor</th>
                  <th scope="col">Grupo comparable</th><th scope="col">Denominador</th>
                  <th scope="col">Cobertura</th><th scope="col">Procedencia</th><th scope="col">Qué mide y cómo</th>
                </tr></thead>
                <tbody>{v.indicators.map((i, n) => (
                  <tr key={`${i.id}-${n}`}>
                    <td>{i.label}<div className="muted"><code>{i.id}</code></div></td>
                    <td><StatusBadge tone={TONO[i.status] ?? 'neutral'}>{ETIQUETA[i.status] ?? i.status}</StatusBadge></td>
                    <td>
                      {i.value === null ? <span className="muted">—</span> : <strong>{i.value}</strong>}
                      {i.value !== null && i.unit !== '—' ? <div className="muted">{i.unit}</div> : null}
                    </td>
                    <td className="muted">
                      {i.group
                        ? [i.group.currency, i.group.unit, i.group.product].filter(Boolean).join(' · ')
                        : <span className="muted">no aplica</span>}
                    </td>
                    <td className="muted">
                      {i.denominator
                        ? <>{i.denominator.label}: <strong>{i.denominator.value ?? 'no calculable'}</strong></>
                        : <span className="muted">no es un cociente</span>}
                    </td>
                    <td className="muted">
                      {i.coverage ? <>{i.coverage.used} de {i.coverage.considered}<div className="muted">{i.coverage.note}</div></> : <span className="muted">—</span>}
                    </td>
                    <td>{PROCEDENCIA[i.provenance] ?? i.provenance}</td>
                    <td className="muted">
                      {i.what_it_measures}
                      <div className="muted">Fórmula: <code>{i.formula}</code></div>
                      <div className="muted">
                        Período: {i.period.from ?? 'abierto'} → {i.period.to ?? 'abierto'}
                      </div>
                      {i.why ? <div className="muted"><strong>Por qué no hay valor:</strong> {i.why}</div> : null}
                      {i.excluded.length > 0 && (
                        <ul className="plain">
                          {i.excluded.map((e, k) => <li key={k}><StatusBadge tone="review">Excluido ×{e.count}</StatusBadge> {e.reason}</li>)}
                        </ul>
                      )}
                      <ul className="plain">{i.limits.map((l, k) => <li key={k} className="muted">{l}</li>)}</ul>
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>

          <section className="card" aria-labelledby="ind-prod">
            <h2 id="ind-prod">Por productor</h2>
            {!porProd ? <Loading label="Cargando…" />
              : porProd.producers.length === 0 ? <EmptyState title="Ningún productor con entregas en este período." />
                : (
                  <div className="table-wrap"><table aria-label="Resumen por productor">
                    <thead><tr>
                      <th scope="col">Productor</th><th scope="col">Entregas</th>
                      <th scope="col">Con dato económico</th><th scope="col">Sin dato económico</th>
                      <th scope="col">Precio medio</th><th scope="col">Recibido</th><th scope="col">Nota</th>
                    </tr></thead>
                    <tbody>{porProd.producers.map((p) => (
                      <tr key={p.producer_id}>
                        <td>{p.producer_code}</td>
                        <td>{p.deliveries ?? <span className="muted">restringido</span>}</td>
                        <td>{p.with_economics ?? <span className="muted">restringido</span>}</td>
                        <td>{p.without_economics ?? <span className="muted">restringido</span>}</td>
                        <td>
                          {p.weighted_price === 'RESTRINGIDO' ? <StatusBadge tone="blocked">Restringido</StatusBadge>
                            : p.weighted_price === 'NO_CALCULABLE' ? <StatusBadge tone="review">No calculable</StatusBadge>
                              : <><strong>{p.weighted_price}</strong>{p.price_group ? <div className="muted">{p.price_group.currency} por {p.price_group.unit}</div> : null}</>}
                        </td>
                        <td>{p.received ? `${p.received.quantity} ${p.received.unit ?? ''}` : <span className="muted">—</span>}</td>
                        <td className="muted">{p.why ?? ''}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
            <p className="muted">{porProd?.note}</p>
            <p className="muted">{porProd?.separation_note}</p>
          </section>

          <section className="card" aria-labelledby="ind-riesgo">
            <h2 id="ind-riesgo">Contexto regulatorio (no es un indicador comercial)</h2>
            {!v.regulatory_context.available ? (
              <Alert tone="blocked" title="No se muestra por permiso.">
                <p>{v.regulatory_context.why}</p>
              </Alert>
            ) : (
              <ul className="plain">
                {(v.regulatory_context.conclusions ?? []).map((c) => (
                  <li key={c.conclusion}>
                    <StatusBadge tone="neutral">{c.conclusion}</StatusBadge> {c.count} evaluación(es), {c.current} vigente(s)
                  </li>
                ))}
              </ul>
            )}
            <p className="muted">{v.regulatory_context.note}</p>
          </section>

          <section className="card" aria-labelledby="ind-no">
            <h2 id="ind-no">Lo que NO se responde todavía, y con qué condición</h2>
            <dl className="props">
              {v.not_implemented.map((n) => (
                <div key={n.question}>
                  <dt>{n.question}</dt>
                  <dd className="muted">{n.condition}</dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              No se finge ninguna de estas respuestas: aparecen aquí para que se vea qué falta y qué haría falta decidir.
            </p>
          </section>

          <Alert tone="review" title="Antes de sacar conclusiones">
            <p>{v.disclaimer}</p>
            <p>{v.synthetic_note}</p>
          </Alert>
        </>
      )}
    </>
  );
}
