'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useI18n } from '../../../../lib/i18n';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// P1-015 / D-54 — Coste estimado de uso de la PLATAFORMA (USD, por organización y período explícito).
//
// Lo que esta pantalla no puede dejar de decir:
//   · es una ESTIMACIÓN con una tarifa DECLARADA: no hay tarifas precargadas, no se factura ni se cobra;
//   · un mes sin tarifa queda SIN PRECIO —no vale cero—;
//   · el consumo observado, la tarifa, el resultado y los conceptos que no se valoran van separados;
//   · es el coste de la plataforma: distinto del presupuesto de preparación (P1-010) y del precio del cacao.

interface Tarifa { id: string; version: number; monthly_fee: string; valid_from: string; valid_to: string | null; synthetic: boolean; label: string; source: string; reason: string | null }
interface Linea { month: string; tariff_version: number | null; monthly_fee: string | null; synthetic: boolean | null; amount: string | null; reason: string | null }
interface Pendiente { concept: string; observed: number | null; unit: string | null; state: string; note: string }
interface Estimacion {
  id: string; period_start: string; period_end: string; status: 'ESTIMADO' | 'PARCIAL' | 'SIN_TARIFA'; currency: string; total: string | null;
  lines: Linea[]; pending_concepts: Pendiente[]; inputs_hash: string; meaning: string; scope_note: string;
  consumption: { period: { domain_events: number; document_versions_uploaded: number; deliveries_created: number; plots_created: number; source: string }; now: { stored_bytes: number; quota_bytes: number; active_members: number; source: string } };
}

const mes = (iso: string) => iso.slice(0, 7);
function sumarMeses(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

export default function CostePage() {
  const ws = useWorkspace();
  const { t } = useI18n();
  const orgId = ws.activeOrg?.id;
  const puedeGestionar = ws.can('platform_cost:manage');
  const [tarifas, setTarifas] = useState<Tarifa[] | null>(null);
  const [estimaciones, setEstimaciones] = useState<Estimacion[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verif, setVerif] = useState<Record<string, boolean>>({});
  // Período
  const [desde, setDesde] = useState('2026-01');
  const [meses, setMeses] = useState(3);
  // Tarifa
  const [fee, setFee] = useState('');
  const [vFrom, setVFrom] = useState('2026-01-01');
  const [vTo, setVTo] = useState('');
  const [tipo, setTipo] = useState<'sintetica' | 'acordada'>('sintetica');
  const [label, setLabel] = useState('');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');

  const cargar = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    try {
      const [a, b] = await Promise.all([
        api<{ tariffs: Tarifa[] }>(`/api/v1/organizations/${orgId}/platform-cost/tariffs`),
        api<{ estimates: Estimacion[] }>(`/api/v1/organizations/${orgId}/platform-cost/estimates`),
      ]);
      setTarifas(a.tariffs); setEstimaciones(b.estimates);
    } catch (err) { setError(err as ApiError); }
  }, [orgId]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function declarar(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setAviso(null); setError(null);
    try {
      await api(`/api/v1/organizations/${orgId}/platform-cost/tariffs`, { method: 'POST', body: {
        operation_id: crypto.randomUUID(), monthly_fee: fee.trim(), valid_from: vFrom, ...(vTo ? { valid_to: vTo } : {}),
        synthetic: tipo === 'sintetica', label: label.trim(), source: source.trim(), ...(reason.trim() ? { reason: reason.trim() } : {}),
      } });
      setAviso(t('Tarifa declarada. Queda versionada y no se puede editar.')); setFee(''); setReason('');
      await cargar();
    } catch (err) { setError(err as ApiError); }
    finally { setBusy(false); }
  }
  async function estimar(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setAviso(null); setError(null);
    try {
      const inicio = `${desde}-01`;
      await api(`/api/v1/organizations/${orgId}/platform-cost/estimates`, { method: 'POST', body: { operation_id: crypto.randomUUID(), period_start: inicio, period_end: sumarMeses(desde, meses) } });
      setAviso(t('Estimación registrada.'));
      await cargar();
    } catch (err) { setError(err as ApiError); }
    finally { setBusy(false); }
  }
  async function verificar(id: string) {
    try {
      const r = await api<{ reproducible: boolean }>(`/api/v1/organizations/${orgId}/platform-cost/estimates/${id}/verify`);
      setVerif((v) => ({ ...v, [id]: r.reproducible }));
    } catch (err) { setError(err as ApiError); }
  }

  if (!ws.activeOrg) return null;
  const migas = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Coste de la plataforma') }];
  const tono = (s: Estimacion['status']) => (s === 'ESTIMADO' ? 'valid' : s === 'PARCIAL' ? 'review' : 'neutral') as 'valid' | 'review' | 'neutral';
  const nombre = (s: Estimacion['status']) => (s === 'ESTIMADO' ? t('Estimado') : s === 'PARCIAL' ? t('Parcial') : t('Sin tarifa'));
  const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const concepto: Record<string, string> = {
    ALMACENAMIENTO: t('Almacenamiento'), EVENTOS: t('Eventos'), USUARIOS_ACTIVOS: t('Usuarios activos'), FACTURACION_Y_COBRO: t('Facturación y cobro'),
  };

  return (
    <>
      <Breadcrumb items={migas} />
      <PageHeader title={t('Coste de la plataforma')} meta={<span>{t('Estimación en USD · por organización y período explícito')}</span>} />

      <Alert tone="info" title={t('Es una estimación, no una factura.')}>
        <p>{t('El coste se calcula con una tarifa que se declara aquí, con versión y vigencia. No hay tarifas precargadas, no se factura ni se cobra, y un mes sin tarifa queda sin precio: no vale cero. Es el coste de usar la plataforma; es distinto del presupuesto de preparación y del precio comercial del cacao.')}</p>
      </Alert>

      {aviso && <Alert tone="valid"><p>{aviso}</p></Alert>}
      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {!tarifas && !error && <Loading label={t('Cargando tarifas y estimaciones…')} />}

      {tarifas && (
        <>
          <section className="card" aria-labelledby="cs-tarifas">
            <h2 id="cs-tarifas">{t('Tarifas declaradas')}</h2>
            {tarifas.length === 0 ? (
              <EmptyState title={t('No hay ninguna tarifa declarada.')}><p className="muted">{t('Sin tarifa, toda estimación sale «sin tarifa»: ningún importe se inventa.')}</p></EmptyState>
            ) : (
              <div className="table-wrap"><table aria-label={t('Tarifas declaradas')}>
                <thead><tr>
                  <th scope="col">{t('Versión')}</th><th scope="col">{t('USD por mes')}</th><th scope="col">{t('Vigencia')}</th>
                  <th scope="col">{t('Tipo')}</th><th scope="col">{t('Origen')}</th>
                </tr></thead>
                <tbody>{tarifas.map((x) => (
                  <tr key={x.id}>
                    <td>v{x.version}</td><td><strong>{x.monthly_fee}</strong></td>
                    <td>{x.valid_from} → {x.valid_to ?? t('sin fin')}</td>
                    <td><StatusBadge tone={x.synthetic ? 'review' : 'neutral'}>{x.synthetic ? t('Sintética (demostración)') : t('Acordada')}</StatusBadge></td>
                    <td className="muted">{x.label}<div>{x.source}</div>{x.reason && <div>{t('Motivo')}: {x.reason}</div>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            {puedeGestionar && (
              <form onSubmit={declarar} className="stack" aria-label={t('Declarar tarifa')}>
                <h3>{t('Declarar una versión de tarifa')}</h3>
                <label htmlFor="cs-fee">{t('USD por organización y mes')}</label>
                <input id="cs-fee" inputMode="decimal" required pattern="\d{1,10}(\.\d{1,4})?" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="10.0000" />
                <label htmlFor="cs-from">{t('Vigente desde (incluido)')}</label>
                <input id="cs-from" type="date" required value={vFrom} onChange={(e) => setVFrom(e.target.value)} />
                <label htmlFor="cs-to">{t('Vigente hasta (excluido, opcional)')}</label>
                <input id="cs-to" type="date" value={vTo} onChange={(e) => setVTo(e.target.value)} />
                <fieldset>
                  <legend>{t('Naturaleza de la tarifa')}</legend>
                  <label><input type="radio" name="cs-tipo" checked={tipo === 'sintetica'} onChange={() => setTipo('sintetica')} /> {t('Sintética (demostración, no es un acuerdo)')}</label>
                  <label><input type="radio" name="cs-tipo" checked={tipo === 'acordada'} onChange={() => setTipo('acordada')} /> {t('Acordada')}</label>
                </fieldset>
                <label htmlFor="cs-label">{t('Nombre de la tarifa')}</label>
                <input id="cs-label" required minLength={3} maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
                <label htmlFor="cs-source">{t('De dónde sale')}</label>
                <input id="cs-source" required minLength={3} maxLength={500} value={source} onChange={(e) => setSource(e.target.value)} />
                {tarifas.length > 0 && (<>
                  <label htmlFor="cs-reason">{t('Motivo del cambio (obligatorio al declarar otra versión)')}</label>
                  <input id="cs-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                </>)}
                <button type="submit" disabled={busy}>{t('Declarar tarifa')}</button>
              </form>
            )}
          </section>

          <section className="card" aria-labelledby="cs-est">
            <h2 id="cs-est">{t('Estimar un período')}</h2>
            {puedeGestionar ? (
              <form onSubmit={estimar} className="stack" aria-label={t('Estimar un período')}>
                <label htmlFor="cs-desde">{t('Primer mes')}</label>
                <input id="cs-desde" type="month" required value={desde} onChange={(e) => setDesde(e.target.value)} />
                <label htmlFor="cs-meses">{t('Número de meses')}</label>
                <select id="cs-meses" value={meses} onChange={(e) => setMeses(Number(e.target.value))}>
                  {[1, 2, 3, 6, 12, 24].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <p className="muted">{t('Período: del {a} (incluido) al {b} (excluido).', { a: `${desde}-01`, b: sumarMeses(desde, meses) })}</p>
                <button type="submit" disabled={busy}>{t('Registrar estimación')}</button>
              </form>
            ) : <p className="muted">{t('Tu rol puede consultar, pero no declarar tarifas ni registrar estimaciones.')}</p>}
          </section>

          <section aria-labelledby="cs-hist">
            <h2 id="cs-hist">{t('Estimaciones registradas')}</h2>
            {estimaciones && estimaciones.length === 0 && <EmptyState title={t('Todavía no hay estimaciones.')} />}
            {estimaciones?.map((e) => (
              <article key={e.id} className="card" aria-label={`${e.period_start} → ${e.period_end}`}>
                <h3>{mes(e.period_start)} → {mes(sumarMeses(mes(e.period_end), -1))} <StatusBadge tone={tono(e.status)}>{nombre(e.status)}</StatusBadge></h3>
                <dl className="props">
                  <dt>{t('Resultado estimado')}</dt>
                  <dd>{e.total === null ? <strong>{t('Sin estimación: no hay tarifa que cubra un mes completo (no es cero).')}</strong> : <strong>{e.currency} {e.total}</strong>}</dd>
                  <dt>{t('Consumo observado en el período')}</dt>
                  <dd>{t('{n} eventos · {d} versiones de documento · {e} entregas · {p} parcelas', { n: e.consumption.period.domain_events, d: e.consumption.period.document_versions_uploaded, e: e.consumption.period.deliveries_created, p: e.consumption.period.plots_created })}
                    <div className="muted">{t('Ahora: {b} almacenados de {q} · {m} miembros activos', { b: kb(e.consumption.now.stored_bytes), q: kb(e.consumption.now.quota_bytes), m: e.consumption.now.active_members })}</div></dd>
                </dl>
                <div className="table-wrap"><table aria-label={t('Líneas por mes')}>
                  <thead><tr><th scope="col">{t('Mes')}</th><th scope="col">{t('Tarifa aplicada')}</th><th scope="col">{t('Importe (USD)')}</th></tr></thead>
                  <tbody>{e.lines.map((l) => (
                    <tr key={l.month}>
                      <td>{mes(l.month)}</td>
                      <td>{l.tariff_version ? `v${l.tariff_version}${l.synthetic ? ` · ${t('sintética')}` : ''}` : <span className="muted">{t('Sin tarifa que cubra el mes completo')}</span>}</td>
                      <td>{l.amount ?? <strong>{t('Sin precio')}</strong>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
                <h4>{t('Conceptos que no se valoran')}</h4>
                <ul>{e.pending_concepts.map((c) => (
                  <li key={c.concept}><strong>{concepto[c.concept] ?? c.concept}</strong>{c.observed !== null ? `: ${c.observed}${c.unit ? ` ${c.unit}` : ''}` : ''} — <span className="muted">{c.state === 'NO_IMPLEMENTADO' ? t('No implementado: esta estimación no factura ni cobra.') : t('Se muestra, pero la unidad adoptada (organización por mes) no lo valora.')}</span></li>
                ))}</ul>
                <p className="muted">{t(e.scope_note)}</p>
                <div className="actions">
                  <button type="button" className="secondary inline" onClick={() => void verificar(e.id)}>{t('Comprobar que se puede reproducir')}</button>
                  {e.id in verif && <StatusBadge tone={verif[e.id] ? 'valid' : 'blocked'}>{verif[e.id] ? t('Reproducible con sus entradas guardadas') : t('No reproducible')}</StatusBadge>}
                  <span className="muted">{t('Huella de entradas')}: <code>{e.inputs_hash.slice(0, 12)}…</code></span>
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </>
  );
}
