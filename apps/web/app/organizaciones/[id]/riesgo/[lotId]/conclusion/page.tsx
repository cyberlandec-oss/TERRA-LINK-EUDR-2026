'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../../../lib/api';
import { useI18n } from '../../../../../../lib/i18n';
import { useWorkspace } from '../../../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge, type Tone } from '../../../../../../lib/ui';
import { CONCLUSION_TABLAS as TB } from '../../../../../../lib/conclusion-humana';

// D-07.6 — CONCLUSIÓN HUMANA del responsable EUDR sobre la evaluación de riesgo vigente de un lote. Consulta la evaluación y sus limitaciones, deja elegir el resultado
// del contrato original (NEGLIGIBLE / NON_NEGLIGIBLE), pide motivo y evidencias, resume y confirma, y conserva el historial. El motor no concluye; registrar no anula
// requisitos pendientes ni habilita READY ni despacho. La autorización y las condiciones las decide la API (y la base): la pantalla solo las explica.

interface Soporte { kind: string; document_version_id: string | null; citation: string | null; url: string | null }
interface ResolucionReg { scope: string; code: string; kind: string; justification: string; evidence: { kind: string; document_version_id: string | null; citation: string | null } }
interface Registro {
  id: string; result: string; reason: string; recorded_at: string; recorded_by: string | null; is_latest_record: boolean; on_this_evaluation: boolean; valid_now: boolean; invalid_reasons: string[]; supports: Soporte[]; gap_resolutions: ResolucionReg[];
  links: { evaluation_number: number; evaluation_snapshot_hash: string; rule_set_version: string; regulatory_profile: string | null; legal_profile_version: string | null; legal_review_id: string | null; dd_snapshot_number: number | null };
}
interface Contexto {
  evaluation: { id: string; number: number; lot: { id: string; code: string }; is_latest: boolean; evaluated_at: string; evaluated_by: string; freshness: { status: string }; technical_result: { status: string };
    severity: string; review_process: string; rules: { version: string; adopted: boolean; regulatory_profile: string | null } };
  limitations: string[];
  options: Record<'NEGLIGIBLE' | 'NON_NEGLIGIBLE', { allowed: boolean; missing: string[]; gaps_to_resolve: Carencia[] }>;
  can_record: boolean; recorder_is_evaluator: boolean;
  current: { id: string; result: string; effective: string; valid: boolean; invalid_reasons: string[] } | null;
  history: Registro[];
}
interface Carencia { scope: string; code: string }
interface Resolucion { kind: string; justification: string; ev: string }
interface LotRisk { lot: { id: string; lot_code: string }; latest: { id: string } | null }
interface Cita { citation: string; url: string }
const TONO: Record<string, Tone> = { NEGLIGIBLE: 'valid', NON_NEGLIGIBLE: 'blocked', UNDETERMINED: 'neutral' };
const RESULTADOS = ['NEGLIGIBLE', 'NON_NEGLIGIBLE'] as const;

export default function ConclusionPage() {
  const ws = useWorkspace();
  const { t, dt } = useI18n();
  const { lotId } = useParams<{ lotId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [lot, setLot] = useState<LotRisk | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<string>('NON_NEGLIGIBLE');
  const [motivo, setMotivo] = useState('');
  const [citas, setCitas] = useState<Cita[]>([]);
  const [docs, setDocs] = useState<string[]>([]);
  const [confirmo, setConfirmo] = useState(false);
  const [res, setRes] = useState<Record<string, Resolucion>>({});

  const cargar = useCallback(async () => {
    if (!orgId || !ws.can('risk:read')) return;
    try {
      const l = await api<LotRisk>(`/api/v1/organizations/${orgId}/risk/lots/${lotId}`);
      setLot(l);
      if (l.latest) setCtx(await api<Contexto>(`/api/v1/organizations/${orgId}/risk/evaluations/${l.latest.id}/conclusions`));
      setError(null);
    } catch (err) { setError(err as ApiError); }
  }, [orgId, lotId, ws]);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { try { const b = sessionStorage.getItem(`tl_borrador_conclusion_${lotId}`); if (b) setMotivo(b); } catch { /* sin almacenamiento */ } }, [lotId]);
  useEffect(() => { try { sessionStorage.setItem(`tl_borrador_conclusion_${lotId}`, motivo); } catch { /* idem */ } }, [motivo, lotId]);

  if (!ws.activeOrg) return null;
  if (!ws.can('risk:read')) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: t('Tu rol no permite consultar evaluaciones de riesgo ni sus conclusiones.'), request_id: null })} />;
  const migas = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Riesgo'), href: `/organizaciones/${orgId}/riesgo` }, { label: lot?.lot.lot_code ?? '…', href: `/organizaciones/${orgId}/riesgo/${lotId}` }, { label: t('Conclusión humana') }];
  if (error) return <><Breadcrumb items={migas} /><ErrorPanel error={error} onRetry={cargar} /></>;
  if (!lot) return <Loading label={t('Cargando la evaluación…')} />;
  if (!lot.latest || !ctx) return <><Breadcrumb items={migas} /><EmptyState title={t('Este lote no tiene ninguna evaluación de riesgo: evalúalo antes de concluir.')} /></>;

  const ev = ctx.evaluation;
  const opcion = ctx.options[resultado as 'NEGLIGIBLE' | 'NON_NEGLIGIBLE'];
  // Las evidencias, en el orden en que se envían (el índice es lo que cada carencia referencia).
  const lista = [
    ...citas.filter((c) => c.citation.trim().length >= 3).map((c, i) => ({ kind: 'CITATION' as const, label: `${t('Cita')} ${i + 1}`, value: c })),
    ...docs.filter((d) => d.trim().length > 0).map((d, i) => ({ kind: 'DOCUMENT_VERSION' as const, label: `${t('Versión de documento')} ${i + 1}`, value: d.trim() })),
  ];
  const evidencias = lista.length;
  const carencias = resultado === 'NEGLIGIBLE' ? ctx.options.NEGLIGIBLE.gaps_to_resolve : [];
  const claveC = (c: Carencia) => `${c.scope}:${c.code}`;
  const estadoRes = carencias.map((c) => {
    const r = res[claveC(c)]; const i = r && r.ev !== '' ? Number(r.ev) : -1; const evid = lista[i];
    const ok = !!r && !!r.kind && r.justification.trim().length >= 30 && !!evid && (r.kind !== 'ASSESSED_BY_HUMAN' || evid.kind === 'DOCUMENT_VERSION');
    return { c, ok, texto: r?.justification.trim().toLowerCase() ?? '' };
  });
  const distintas = new Set(estadoRes.map((e) => e.texto)).size === estadoRes.length;
  const resueltas = estadoRes.filter((e) => e.ok).length;
  const completo = motivo.trim().length >= 10 && evidencias > 0 && !!opcion?.allowed && resueltas === carencias.length && (carencias.length === 0 || distintas);

  const registrar = async (e: FormEvent) => {
    e.preventDefault();
    if (!completo || !confirmo) return;
    setOcupado(true); setAviso(null);
    try {
      await api(`/api/v1/organizations/${orgId}/risk/evaluations/${ev.id}/conclusions`, { method: 'POST', body: {
        operation_id: crypto.randomUUID(), result: resultado, reason: motivo.trim(), expected_current_conclusion_id: ctx.current?.id ?? null,
        supports: lista.map((e) => (e.kind === 'CITATION' ? { kind: 'CITATION', citation: e.value.citation.trim(), ...(e.value.url.trim() ? { url: e.value.url.trim() } : {}) } : { kind: 'DOCUMENT_VERSION', document_version_id: e.value })),
        ...(carencias.length ? { gap_resolutions: carencias.map((c) => ({ scope: c.scope, code: c.code, kind: res[claveC(c)].kind, justification: res[claveC(c)].justification.trim(), support_index: Number(res[claveC(c)].ev) })) } : {}) } });
      try { sessionStorage.removeItem(`tl_borrador_conclusion_${lotId}`); } catch { /* idem */ }
      setMotivo(''); setCitas([]); setDocs([]); setRes({}); setConfirmo(false); setError(null);
      setAviso(t('Conclusión humana registrada. No anula requisitos pendientes ni habilita READY ni despacho por sí sola.'));
      await cargar();
    } catch (err) {
      const x = err as ApiError;
      if (x.body?.code === 'CONCLUSION_SUPERSEDED') { setAviso(t('La conclusión vigente cambió mientras la preparabas. Revisa el historial y vuelve a registrar.')); setConfirmo(false); await cargar(); } else setError(x);
    } finally { setOcupado(false); }
  };

  return (
    <>
      <Breadcrumb items={migas} />
      <PageHeader title={`${t('Conclusión humana del lote')} ${lot.lot.lot_code}`} meta={t('La conclusión sobre una evaluación concreta la registra una persona autorizada: el motor no concluye.')} />
      <Alert tone="review" title={t('Qué es y qué no es esta conclusión')}>
        <ul>
          <li>{t('Es una decisión humana sobre ESTA evaluación, con motivo, responsable y evidencias, vinculada a las versiones exactas con que se decidió.')}</li>
          <li>{t('No anula requisitos pendientes ni habilita READY ni despacho por sí sola. Una conclusión posterior no borra la anterior.')}</li>
          <li>{t('Deja de valer si la evaluación queda desactualizada o, en la favorable, si se pierde alguna de las condiciones que la hicieron posible.')}</li>
        </ul>
      </Alert>
      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {aviso && <Alert tone="info" title={aviso}><span /></Alert>}

      <section aria-labelledby="c-eval">
        <h2 id="c-eval">{t('Evaluación')}</h2>
        <dl className="props" aria-label={t('Evaluación')}>
          <dt>{t('Número')}</dt><dd>{ev.number}{ev.is_latest ? '' : ` · ${t('hay una más reciente')}`}</dd>
          <dt>{t('Evaluada')}</dt><dd>{ev.evaluated_by} · {dt(ev.evaluated_at)}</dd>
          <dt>{t('Vigencia')}</dt><dd><StatusBadge tone={ev.freshness.status === 'CURRENT' ? 'valid' : 'blocked'}>{ev.freshness.status === 'CURRENT' ? t('Vigente') : t('Desactualizada')}</StatusBadge></dd>
          <dt>{t('Resultado técnico')}</dt><dd>{t(TB.TECNICO[ev.technical_result.status] ?? ev.technical_result.status)}</dd>
          <dt>{t('Severidad de los hallazgos evaluados')}</dt><dd>{t(TB.SEVERIDAD[ev.severity] ?? ev.severity)}</dd>
          <dt>{t('Revisión humana de la evaluación')}</dt><dd>{t(TB.PROCESO[ev.review_process] ?? ev.review_process)}</dd>
          <dt>{t('Catálogo de reglas')}</dt><dd>{ev.rules.version} · {ev.rules.adopted ? t('adoptado por la organización') : t('no adoptado por la organización')}{ev.rules.regulatory_profile ? ` · ${t('perfil')} ${ev.rules.regulatory_profile}` : ` · ${t('sin perfil jurídico declarado')}`}</dd>
        </dl>
        <h3>{t('Limitaciones')}</h3>
        <ul>{ctx.limitations.map((l) => <li key={l}>{t(TB.LIMITACION[l] ?? l)}</li>)}</ul>
      </section>

      <section aria-labelledby="c-vig">
        <h2 id="c-vig">{t('Conclusión vigente')}</h2>
        {ctx.current ? (
          <>
            <p><StatusBadge tone={TONO[ctx.current.effective] ?? 'neutral'}>{t(TB.RESULTADO[ctx.current.effective] ?? ctx.current.effective)}</StatusBadge></p>
            {!ctx.current.valid && (
              <Alert tone="blocked" title={t('La última conclusión registrada ya no está vigente')}>
                <ul>{ctx.current.invalid_reasons.map((r) => <li key={r}>{t(TB.VIGENCIA[r] ?? r)}</li>)}</ul>
                <p>{t('Se conserva en el historial y no vale como conclusión.')}</p>
              </Alert>
            )}
          </>
        ) : <p className="muted">{t('Nadie ha registrado todavía una conclusión humana sobre esta evaluación.')}</p>}
      </section>

      {ctx.can_record ? (
        <section aria-labelledby="c-reg">
          <h2 id="c-reg">{t('Registrar una conclusión')}</h2>
          {ctx.recorder_is_evaluator && <Alert tone="review" title={t('Tu rol puede concluir, pero esta evaluación la realizaste tú: debe concluirla otra persona.')}><span /></Alert>}
          <p className="muted">{t('Lo que escribes aquí se conserva solo en este navegador hasta que registres: es un borrador local, no una conclusión.')}</p>
          <form onSubmit={registrar}>
            <fieldset>
              <legend>{t('Resultado')}</legend>
              {RESULTADOS.map((r) => (
                <div key={r}>
                  <label className="checkbox-row">
                    <input type="radio" name="c-resultado" value={r} checked={resultado === r} disabled={!ctx.options[r].allowed} onChange={() => { setResultado(r); setConfirmo(false); }} />{' '}{t(TB.RESULTADO[r])}
                  </label>
                  {!ctx.options[r].allowed && <ul className="muted">{ctx.options[r].missing.map((m) => <li key={m}>{t(TB.FALTA[m] ?? m)}</li>)}</ul>}
                </div>
              ))}
            </fieldset>
            <label htmlFor="c-motivo">{t('Motivo de la conclusión')}</label>
            <textarea id="c-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={10} maxLength={2000} required />
            <fieldset>
              <legend>{t('Evidencias')}</legend>
              <p className="muted">{t('Al menos una: una cita o una versión de documento de esta organización.')}</p>
              {citas.map((c, i) => (
                <div key={`c${i}`}>
                  <label htmlFor={`c-cita-${i}`}>{t('Cita')} {i + 1}</label>
                  <input id={`c-cita-${i}`} value={c.citation} onChange={(e) => setCitas((l) => l.map((x, j) => (j === i ? { ...x, citation: e.target.value } : x)))} maxLength={500} />
                  <label htmlFor={`c-url-${i}`}>{t('Enlace (https, opcional)')}</label>
                  <input id={`c-url-${i}`} value={c.url} onChange={(e) => setCitas((l) => l.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} inputMode="url" />
                  <button type="button" onClick={() => setCitas((l) => l.filter((_, j) => j !== i))}>{t('Quitar cita')} {i + 1}</button>
                </div>
              ))}
              <button type="button" onClick={() => setCitas((l) => [...l, { citation: '', url: '' }])}>{t('Añadir una cita')}</button>
              {docs.map((d, i) => (
                <div key={`d${i}`}>
                  <label htmlFor={`c-doc-${i}`}>{t('Versión de documento')} {i + 1}</label>
                  <input id={`c-doc-${i}`} value={d} onChange={(e) => setDocs((l) => l.map((x, j) => (j === i ? e.target.value : x)))} />
                  <button type="button" onClick={() => setDocs((l) => l.filter((_, j) => j !== i))}>{t('Quitar documento')} {i + 1}</button>
                </div>
              ))}
              <button type="button" onClick={() => setDocs((l) => [...l, ''])}>{t('Añadir una versión de documento')}</button>
            </fieldset>
            {carencias.length > 0 && (
              <fieldset>
                <legend>{t('Carencias de la evaluación')}</legend>
                <p className="muted">{t('Mostrar una limitación no la resuelve. Una conclusión favorable exige resolver CADA carencia por separado: declararla no aplicable o evaluada por una persona, con su propia justificación y una evidencia concreta. Una sola evidencia no resuelve las demás.')}</p>
                {carencias.map((c) => {
                  const k = claveC(c); const r = res[k] ?? { kind: '', justification: '', ev: '' };
                  const set = (p: Partial<Resolucion>) => { setRes((m) => ({ ...m, [k]: { ...r, ...p } })); setConfirmo(false); };
                  return (
                    <fieldset key={k} data-gap={k}>
                      <legend>{t(TB.SCOPE[c.scope] ?? c.scope)}: {t(TB.CARENCIA[c.code] ?? c.code)}</legend>
                      <label htmlFor={`g-k-${k}`}>{t('Cómo se resuelve')}</label>
                      <select id={`g-k-${k}`} value={r.kind} onChange={(e) => set({ kind: e.target.value })}>
                        <option value="">{t('Elige una opción…')}</option>
                        {Object.keys(TB.KIND_CARENCIA).map((o) => <option key={o} value={o}>{t(TB.KIND_CARENCIA[o])}</option>)}
                      </select>
                      <label htmlFor={`g-j-${k}`}>{t('Justificación propia de esta carencia')}</label>
                      <textarea id={`g-j-${k}`} value={r.justification} onChange={(e) => set({ justification: e.target.value })} minLength={30} maxLength={1000} />
                      <label htmlFor={`g-e-${k}`}>{t('Evidencia que la sustenta')}</label>
                      <select id={`g-e-${k}`} value={r.ev} onChange={(e) => set({ ev: e.target.value })}>
                        <option value="">{t('Elige una evidencia…')}</option>
                        {lista.map((e, i) => <option key={i} value={String(i)} disabled={r.kind === 'ASSESSED_BY_HUMAN' && e.kind !== 'DOCUMENT_VERSION'}>{e.label}</option>)}
                      </select>
                    </fieldset>
                  );
                })}
                {!distintas && resueltas === carencias.length && <p className="muted">{t('Las justificaciones no pueden repetirse: cada carencia tiene la suya.')}</p>}
              </fieldset>
            )}
            <h3>{t('Resumen antes de registrar')}</h3>
            <dl className="props" aria-label={t('Resumen antes de registrar')}>
              <dt>{t('Evaluación')}</dt><dd>{ev.number} · {t('catálogo')} {ev.rules.version}</dd>
              <dt>{t('Resultado')}</dt><dd>{t(TB.RESULTADO[resultado])}</dd>
              <dt>{t('Evidencias')}</dt><dd>{evidencias}</dd>
              {carencias.length > 0 && <><dt>{t('Carencias resueltas')}</dt><dd>{resueltas} / {carencias.length}</dd></>}
              <dt>{t('Sustituye a la conclusión vigente')}</dt><dd>{ctx.current ? t(TB.RESULTADO[ctx.current.result]) : t('Ninguna')}</dd>
            </dl>
            <label className="checkbox-row"><input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} />{' '}{t('Confirmo que registro una conclusión humana sobre esta evaluación, no un borrador')}</label>
            <button type="submit" disabled={ocupado || !completo || !confirmo}>{ocupado ? t('Registrando…') : t('Registrar la conclusión')}</button>
          </form>
        </section>
      ) : <p className="muted">{t('Tu rol permite consultar, no registrar conclusiones. Solo el rol responsable EUDR puede registrarlas.')}</p>}

      <section aria-labelledby="c-hist">
        <h2 id="c-hist">{t('Historial de conclusiones')}</h2>
        {ctx.history.length === 0 ? <EmptyState title={t('Todavía no hay conclusiones registradas.')} /> : (
          <ul className="plain">{ctx.history.map((h) => (
            <li key={h.id}>
              <StatusBadge tone={TONO[h.result] ?? 'neutral'}>{t(TB.RESULTADO[h.result] ?? h.result)}</StatusBadge>{' '}
              <StatusBadge tone={h.is_latest_record ? (h.valid_now ? 'valid' : 'blocked') : 'neutral'}>{h.is_latest_record ? (h.valid_now ? t('Vigente') : t('Ya no vigente')) : t('Reemplazada')}</StatusBadge>
              <div>{h.reason}</div>
              <div className="muted">{h.recorded_by ?? '—'} · {dt(h.recorded_at)}</div>
              {h.is_latest_record && !h.valid_now && <ul className="muted">{h.invalid_reasons.map((r) => <li key={r}>{t(TB.VIGENCIA[r] ?? r)}</li>)}</ul>}
              <div className="muted">{t('Versiones con que se decidió')}: {t('evaluación')} {h.links.evaluation_number} · {t('catálogo')} {h.links.rule_set_version}
                {h.links.legal_profile_version ? ` · ${t('perfil')} ${h.links.legal_profile_version}` : ''}{h.links.dd_snapshot_number ? ` · ${t('expediente: instantánea')} ${h.links.dd_snapshot_number}` : ''}{h.on_this_evaluation ? '' : ` · ${t('sobre una evaluación anterior')}`}</div>
              <div className="muted hash">{h.links.evaluation_snapshot_hash}</div>
              {h.gap_resolutions.length > 0 && (
                <ul className="muted" aria-label={t('Carencias resueltas')}>{h.gap_resolutions.map((g) => (
                  <li key={`${g.scope}:${g.code}`}>{t(TB.CARENCIA[g.code] ?? g.code)}: {t(TB.KIND_CARENCIA[g.kind] ?? g.kind)} · {g.justification} · {g.evidence.kind === 'CITATION' ? `${t('Cita')}: ${g.evidence.citation}` : `${t('Documento')}: ${g.evidence.document_version_id}`}</li>
                ))}</ul>
              )}
              {h.supports.length > 0 && <ul className="muted">{h.supports.map((s, i) => <li key={i}>{s.kind === 'CITATION' ? `${t('Cita')}: ${s.citation}` : `${t('Documento')}: ${s.document_version_id}`}</li>)}</ul>}
            </li>
          ))}</ul>
        )}
      </section>
      <p><Link href={`/organizaciones/${orgId}/riesgo/${lotId}`}>{t('Volver al riesgo del lote')}</Link></p>
    </>
  );
}
