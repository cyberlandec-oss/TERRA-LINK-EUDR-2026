'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n';
import { useWorkspace } from '../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge, type Tone } from '../../../lib/ui';
import { GEO_CONFIG_TABLAS as TB } from '../../../lib/geo-config';

// GEOLOCATION_PROFILE — configuración versionada de reglas de geolocalización, vista de PLATAFORMA: preparar una versión (reglas explícitas con fuentes;
// las interpretaciones pendientes quedan como candidatas) y registrar la REVISIÓN de ESA versión con el alcance de aplicabilidad que declara quien revisa.
// Nada se escribe hasta confirmar; lo que se teclea es un borrador local. No es la revisión del perfil jurídico, no adopta nada y no concluye riesgo.

interface Regla { code: string; kind: string; status: string; article: string; criterion: string; pending_questions: string | null; source_code: string }
interface Fuente { code: string; title: string; citation: string; url: string }
interface Soporte { kind: string; source_code: string | null; citation: string | null; url: string | null }
interface Revision {
  id: string; decision: string; reviewer_name: string; reviewer_capacity: string; reviewed_on: string; recorded_at: string; recorded_by: string | null; basis: string;
  applicability_note: string; applicable_organizations: string[]; supports: Soporte[]; is_current: boolean;
}
interface Config { version: string; technical_profile_version: string; scope_note: string; status: string; rules: Regla[]; sources: Fuente[]; current_review: Revision | null; history: Revision[]; gaps: string[] }
interface Cita { citation: string; url: string }
interface FuenteForm { code: string; title: string; citation: string; url: string }
interface ReglaForm { code: string; kind: string; status: string; source_code: string; article: string; criterion: string; pending_questions: string }
const TONO: Record<string, Tone> = { NONE: 'neutral', REVIEWED: 'valid', OBJECTED: 'blocked', WITHDRAWN: 'review' };
const BORRADOR = 'tl_borrador_revision_geo';

export default function GeolocalizacionPlataformaPage() {
  const ws = useWorkspace();
  const { t, dt } = useI18n();
  const [configs, setConfigs] = useState<Config[] | null>(null);
  const [perfilTecnico, setPerfilTecnico] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // revisión
  const [version, setVersion] = useState('');
  const [decision, setDecision] = useState('REVIEWED');
  const [nombre, setNombre] = useState(''); const [capacidad, setCapacidad] = useState(''); const [fecha, setFecha] = useState(''); const [fundamento, setFundamento] = useState('');
  const [alcance, setAlcance] = useState(''); const [fuentes, setFuentes] = useState<string[]>([]); const [citas, setCitas] = useState<Cita[]>([]); const [orgs, setOrgs] = useState<string[]>([]); const [confirmo, setConfirmo] = useState(false);
  // preparar
  const [nv, setNv] = useState(''); const [nNota, setNNota] = useState(''); const [nMotivo, setNMotivo] = useState('');
  const [nFuentes, setNFuentes] = useState<FuenteForm[]>([{ code: '', title: '', citation: '', url: '' }]);
  const [nReglas, setNReglas] = useState<ReglaForm[]>([{ code: '', kind: 'GEO_TECH_PROFILE', status: 'ACTIVE', source_code: '', article: '', criterion: '', pending_questions: '' }]);
  const [confirmoNv, setConfirmoNv] = useState(false);

  useEffect(() => {
    try { const b = JSON.parse(sessionStorage.getItem(BORRADOR) ?? 'null') as null | { nombre: string; capacidad: string; fecha: string; fundamento: string; alcance: string }; if (b) { setNombre(b.nombre); setCapacidad(b.capacidad); setFecha(b.fecha); setFundamento(b.fundamento); setAlcance(b.alcance); } } catch { /* sin almacenamiento */ }
  }, []);
  useEffect(() => { try { sessionStorage.setItem(BORRADOR, JSON.stringify({ nombre, capacidad, fecha, fundamento, alcance })); } catch { /* idem */ } }, [nombre, capacidad, fecha, fundamento, alcance]);

  const cargar = useCallback(async () => {
    if (!ws.isPlatformAdmin) return;
    try {
      const r = await api<{ technical_profile: { version: string }; configs: Config[] }>('/api/v1/platform/geolocation-config/versions');
      setConfigs(r.configs); setPerfilTecnico(r.technical_profile.version); setError(null);
      setVersion((v) => (r.configs.some((x) => x.version === v) ? v : r.configs[0]?.version ?? ''));
    } catch (err) { setError(err as ApiError); }
  }, [ws.isPlatformAdmin]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!ws.isPlatformAdmin) {
    return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: t('Tu cuenta no tiene permiso para preparar ni revisar configuraciones de geolocalización.'), request_id: null })} />;
  }

  const sel = configs?.find((c) => c.version === version) ?? null;
  const nombreOrg = (id: string) => ws.allOrgs?.find((o) => o.id === id)?.name ?? id;
  const hoy = new Date().toISOString().slice(0, 10);
  const soportes = fuentes.length + citas.filter((c) => c.citation.trim().length >= 3).length;
  const puedeRetirar = sel?.status === 'REVIEWED';
  const completo = !!sel && nombre.trim().length >= 3 && capacidad.trim().length >= 3 && !!fecha && fecha <= hoy && fundamento.trim().length >= 10 && alcance.trim().length >= 3
    && (decision !== 'REVIEWED' || soportes > 0) && (decision !== 'WITHDRAWN' || puedeRetirar);

  const registrar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!sel || !completo || !confirmo) return;
    setOcupado(true); setAviso(null);
    try {
      await api('/api/v1/platform/geolocation-config/reviews', { method: 'POST', body: {
        operation_id: crypto.randomUUID(), version: sel.version, decision, reviewer_name: nombre.trim(), reviewer_capacity: capacidad.trim(), reviewed_on: fecha, basis: fundamento.trim(),
        applicable_organizations: decision === 'REVIEWED' ? orgs : [], applicability_note: alcance.trim(),
        supports: [...fuentes.map((c) => ({ kind: 'CONFIG_SOURCE', source_code: c })), ...citas.filter((c) => c.citation.trim().length >= 3).map((c) => ({ kind: 'CITATION', citation: c.citation.trim(), ...(c.url.trim() ? { url: c.url.trim() } : {}) }))],
        expected_current_review_id: sel.current_review?.id ?? null } });
      try { sessionStorage.removeItem(BORRADOR); } catch { /* idem */ }
      setNombre(''); setCapacidad(''); setFecha(''); setFundamento(''); setAlcance(''); setFuentes([]); setCitas([]); setOrgs([]); setConfirmo(false); setError(null);
      setAviso(t('Revisión efectiva registrada para la configuración {version}. No es una revisión del perfil jurídico ni adopta la configuración.', { version: sel.version }));
      await cargar();
    } catch (err) {
      const e = err as ApiError;
      if (e.body?.code === 'REVIEW_SUPERSEDED') { setAviso(t('La revisión vigente cambió mientras la preparabas. Revisa el historial y vuelve a registrar.')); setConfirmo(false); await cargar(); } else setError(e);
    } finally { setOcupado(false); }
  };

  const preparar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!confirmoNv) return;
    setOcupado(true); setAviso(null);
    try {
      await api('/api/v1/platform/geolocation-config/versions', { method: 'POST', body: {
        operation_id: crypto.randomUUID(), version: nv.trim(), technical_profile_version: perfilTecnico, scope_note: nNota.trim(), reason: nMotivo.trim(),
        sources: nFuentes.map((f) => ({ code: f.code.trim(), title: f.title.trim(), citation: f.citation.trim(), url: f.url.trim() })),
        rules: nReglas.map((r) => ({ code: r.code.trim(), kind: r.kind, status: r.status, source_code: r.source_code, article: r.article.trim(), criterion: r.criterion.trim(), ...(r.status === 'CANDIDATE' ? { pending_questions: r.pending_questions.trim() } : {}) })) } });
      setAviso(t('Versión {version} preparada: inmutable y sin revisión; no se aplica a ningún expediente todavía.', { version: nv.trim() }));
      setNv(''); setNNota(''); setNMotivo(''); setConfirmoNv(false); setError(null);
      await cargar();
    } catch (err) { setError(err as ApiError); } finally { setOcupado(false); }
  };

  return (
    <>
      <Breadcrumb items={[{ label: t('Organizaciones (plataforma)'), href: '/organizaciones' }, { label: t('Reglas de geolocalización') }]} />
      <PageHeader title={t('Reglas de geolocalización: configuración y revisión')} meta={t('Acto de plataforma: prepara versiones de reglas y registra la revisión de cada una, con el alcance de aplicabilidad que declara quien revisa.')} />
      <Alert tone="review" title={t('Qué es y qué no es')}>
        <ul>
          <li>{t('La revisión es de ESTA configuración y versión: no es la revisión del perfil jurídico y no se convierte en ella.')}</li>
          <li>{t('Revisada no significa aplicable a todas: la revisión declara a qué organizaciones aplica. Registrar no adopta nada ni concluye riesgo.')}</li>
          <li>{t('Las reglas candidatas no se aplican. Nada se registra hasta confirmar; una revisión registrada es inmutable.')}</li>
        </ul>
      </Alert>
      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {aviso && <Alert tone="info" title={aviso}><span /></Alert>}
      {!configs && !error && <Loading label={t('Cargando configuraciones…')} />}

      {configs && sel && (
        <>
          <section aria-labelledby="g-version">
            <h2 id="g-version">{t('Versión exacta de la configuración')}</h2>
            <label htmlFor="g-sel">{t('Versión')}</label>
            <select id="g-sel" value={version} onChange={(e) => { setVersion(e.target.value); setFuentes([]); setCitas([]); setOrgs([]); setConfirmo(false); setAviso(null); }}>
              {configs.map((c) => <option key={c.version} value={c.version}>{c.version} · {t(TB.ESTADO[c.status] ?? c.status)}</option>)}
            </select>
            <p className="muted">{sel.scope_note}</p>
            <dl className="props" aria-label={t('Versión exacta de la configuración')}>
              <dt>{t('Revisión vigente')}</dt><dd><StatusBadge tone={TONO[sel.status] ?? 'neutral'}>{t(TB.ESTADO[sel.status] ?? sel.status)}</StatusBadge></dd>
              <dt>{t('Perfil técnico')}</dt><dd>EUDR_GEO_V1 {sel.technical_profile_version}</dd>
              <dt>{t('Qué falta')}</dt>
              <dd>{sel.gaps.length === 0 ? t('Nada') : <ul>{sel.gaps.filter((g) => g !== 'NOT_APPLICABLE_TO_ORGANIZATION').map((g) => <li key={g}>{t(TB.FALTA[g] ?? g)}</li>)}</ul>}</dd>
            </dl>
            <h3>{t('Reglas')}</h3>
            <ul className="plain">{sel.rules.map((r) => (
              <li key={r.code}><strong>{r.code}</strong> <StatusBadge tone={r.status === 'ACTIVE' ? 'valid' : 'review'}>{t(TB.REGLA[r.status] ?? r.status)}</StatusBadge>
                <div>{t(TB.KIND[r.kind] ?? r.kind)}</div><div className="muted">{r.article} · {r.criterion}</div>
                {r.status === 'CANDIDATE' && r.pending_questions && <div className="muted"><em>{t('Pendiente')}: {r.pending_questions}</em></div>}</li>
            ))}</ul>
          </section>

          <section aria-labelledby="g-hist">
            <h2 id="g-hist">{t('Historial de revisiones de esta versión')}</h2>
            {sel.history.length === 0 ? <p className="muted">{t('Esta versión no tiene ninguna revisión registrada.')}</p> : (
              <ul className="plain">{sel.history.map((r) => (
                <li key={r.id}>
                  <StatusBadge tone={TONO[r.decision] ?? 'neutral'}>{t(TB.DECISION[r.decision] ?? r.decision)}</StatusBadge>{' '}
                  <StatusBadge tone={r.is_current ? 'process' : 'neutral'}>{t(TB.VIGENCIA[String(r.is_current)])}</StatusBadge>
                  <div>{r.reviewer_name}</div><div className="muted">{r.reviewer_capacity} · {t('Fecha de la revisión')}: {r.reviewed_on}</div>
                  <div>{r.basis}</div>
                  <div className="muted">{t('Aplicabilidad declarada')}: {r.applicability_note}</div>
                  <div className="muted">{t('Organizaciones')}: {r.applicable_organizations.length ? r.applicable_organizations.map(nombreOrg).join(', ') : t('Ninguna')}</div>
                  {r.supports.length > 0 && <ul className="muted">{r.supports.map((s, i) => <li key={i}>{t(TB.SOPORTE[s.kind] ?? s.kind)}: {s.source_code ?? s.citation}</li>)}</ul>}
                  <div className="muted">{t('Registrado')}: {dt(r.recorded_at)} · {r.recorded_by ?? '—'}</div>
                </li>
              ))}</ul>
            )}
          </section>

          <section aria-labelledby="g-rev">
            <h2 id="g-rev">{t('Registrar una revisión efectiva')}</h2>
            <p className="muted">{t('Lo que escribes aquí se conserva solo en este navegador hasta que registres: es un borrador local, no una revisión.')}</p>
            <form onSubmit={registrar}>
              <fieldset>
                <legend>{t('Resultado')}</legend>
                {(['REVIEWED', 'OBJECTED', 'WITHDRAWN'] as const).map((d) => (
                  <label key={d} className="checkbox-row">
                    <input type="radio" name="g-decision" value={d} checked={decision === d} disabled={d === 'WITHDRAWN' && !puedeRetirar} onChange={() => { setDecision(d); setConfirmo(false); }} />{' '}
                    {t(TB.DECISION[d])}{d === 'WITHDRAWN' && !puedeRetirar ? ` — ${t('solo si la revisión vigente es favorable')}` : ''}
                  </label>
                ))}
              </fieldset>
              <label htmlFor="g-nombre">{t('Persona revisora')}</label>
              <input id="g-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} minLength={3} maxLength={200} required />
              <label htmlFor="g-cap">{t('Cargo o capacidad declarada')}</label>
              <input id="g-cap" value={capacidad} onChange={(e) => setCapacidad(e.target.value)} minLength={3} maxLength={300} required />
              <label htmlFor="g-fecha">{t('Fecha de la revisión')}</label>
              <input id="g-fecha" type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} required />
              <label htmlFor="g-fund">{t('Fundamento de la decisión')}</label>
              <textarea id="g-fund" value={fundamento} onChange={(e) => setFundamento(e.target.value)} minLength={10} maxLength={2000} required />
              <label htmlFor="g-alcance">{t('Operación y condiciones a las que se refiere la aplicabilidad')}</label>
              <textarea id="g-alcance" value={alcance} onChange={(e) => setAlcance(e.target.value)} minLength={3} maxLength={1000} required />
              {decision === 'REVIEWED' && (
                <fieldset>
                  <legend>{t('Organizaciones a las que se declara aplicable')}</legend>
                  <p className="muted">{t('Ninguna marcada = revisada pero no aplicable a ninguna. No hay «todas» por defecto.')}</p>
                  {(ws.allOrgs ?? []).map((o) => (
                    <label key={o.id} className="checkbox-row"><input type="checkbox" checked={orgs.includes(o.id)} onChange={(e) => setOrgs((l) => (e.target.checked ? [...l, o.id] : l.filter((x) => x !== o.id)))} />{' '}{o.name}</label>
                  ))}
                </fieldset>
              )}
              <fieldset>
                <legend>{t('Fuentes y soporte')}</legend>
                {decision === 'REVIEWED' && <p className="muted">{t('Una revisión favorable exige al menos una fuente de la configuración o una cita.')}</p>}
                {sel.sources.map((s) => (
                  <label key={s.code} className="checkbox-row"><input type="checkbox" checked={fuentes.includes(s.code)} onChange={(e) => setFuentes((f) => (e.target.checked ? [...f, s.code] : f.filter((x) => x !== s.code)))} />{' '}{s.title} <span className="muted">({s.code})</span></label>
                ))}
                {citas.map((c, i) => (
                  <div key={i}>
                    <label htmlFor={`g-cita-${i}`}>{t('Cita')} {i + 1}</label>
                    <input id={`g-cita-${i}`} value={c.citation} onChange={(e) => setCitas((l) => l.map((x, j) => (j === i ? { ...x, citation: e.target.value } : x)))} maxLength={500} />
                    <label htmlFor={`g-url-${i}`}>{t('Enlace (https, opcional)')}</label>
                    <input id={`g-url-${i}`} value={c.url} onChange={(e) => setCitas((l) => l.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} inputMode="url" />
                    <button type="button" onClick={() => setCitas((l) => l.filter((_, j) => j !== i))}>{t('Quitar cita')} {i + 1}</button>
                  </div>
                ))}
                <button type="button" onClick={() => setCitas((l) => [...l, { citation: '', url: '' }])}>{t('Añadir una cita')}</button>
              </fieldset>
              <h3>{t('Resumen antes de registrar')}</h3>
              <dl className="props" aria-label={t('Resumen antes de registrar')}>
                <dt>{t('Versión')}</dt><dd>{sel.version}</dd>
                <dt>{t('Resultado')}</dt><dd>{t(TB.DECISION[decision])}</dd>
                <dt>{t('Organizaciones')}</dt><dd>{decision === 'REVIEWED' ? (orgs.length ? orgs.map(nombreOrg).join(', ') : t('Ninguna')) : t('No aplica')}</dd>
                <dt>{t('Soportes')}</dt><dd>{soportes}</dd>
              </dl>
              <label className="checkbox-row"><input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} />{' '}{t('Entiendo que se registra una revisión efectiva e inmutable de esta configuración, no un borrador')}</label>
              <button type="submit" disabled={ocupado || !completo || !confirmo}>{ocupado ? t('Registrando…') : t('Registrar revisión efectiva')}</button>
            </form>
          </section>

          <section aria-labelledby="g-prep">
            <h2 id="g-prep">{t('Preparar una versión nueva')}</h2>
            <p className="muted">{t('Una versión es inmutable y nace sin revisión. Solo la regla de evaluación del perfil técnico puede estar activa; período y país de producción solo pueden ser candidatas, con lo que falta para aplicarlas.')}</p>
            <form onSubmit={preparar}>
              <label htmlFor="n-v">{t('Versión nueva')}</label>
              <input id="n-v" value={nv} onChange={(e) => setNv(e.target.value)} pattern="[0-9]+\.[0-9]+\.[0-9]+" required />
              <label htmlFor="n-nota">{t('Alcance de la configuración')}</label>
              <textarea id="n-nota" value={nNota} onChange={(e) => setNNota(e.target.value)} minLength={10} maxLength={2000} required />
              <label htmlFor="n-motivo">{t('Motivo del acto')}</label>
              <textarea id="n-motivo" value={nMotivo} onChange={(e) => setNMotivo(e.target.value)} minLength={3} maxLength={500} required />
              {nFuentes.map((f, i) => (
                <fieldset key={`f${i}`}>
                  <legend>{t('Fuente')} {i + 1}</legend>
                  <label htmlFor={`nf-c-${i}`}>{t('Código')}</label><input id={`nf-c-${i}`} value={f.code} onChange={(e) => setNFuentes((l) => l.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)))} required />
                  <label htmlFor={`nf-t-${i}`}>{t('Título')}</label><input id={`nf-t-${i}`} value={f.title} onChange={(e) => setNFuentes((l) => l.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} required />
                  <label htmlFor={`nf-ci-${i}`}>{t('Cita (artículo y apartado)')}</label><input id={`nf-ci-${i}`} value={f.citation} onChange={(e) => setNFuentes((l) => l.map((x, j) => (j === i ? { ...x, citation: e.target.value } : x)))} required />
                  <label htmlFor={`nf-u-${i}`}>{t('Enlace (https)')}</label><input id={`nf-u-${i}`} value={f.url} onChange={(e) => setNFuentes((l) => l.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} inputMode="url" required />
                  {nFuentes.length > 1 && <button type="button" onClick={() => setNFuentes((l) => l.filter((_, j) => j !== i))}>{t('Quitar fuente')} {i + 1}</button>}
                </fieldset>
              ))}
              <button type="button" onClick={() => setNFuentes((l) => [...l, { code: '', title: '', citation: '', url: '' }])}>{t('Añadir una fuente')}</button>
              {nReglas.map((r, i) => (
                <fieldset key={`r${i}`}>
                  <legend>{t('Regla')} {i + 1}</legend>
                  <label htmlFor={`nr-c-${i}`}>{t('Código')}</label><input id={`nr-c-${i}`} value={r.code} onChange={(e) => setNReglas((l) => l.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)))} required />
                  <label htmlFor={`nr-k-${i}`}>{t('Tipo de regla')}</label>
                  <select id={`nr-k-${i}`} value={r.kind} onChange={(e) => setNReglas((l) => l.map((x, j) => (j === i ? { ...x, kind: e.target.value, status: e.target.value === 'GEO_TECH_PROFILE' ? x.status : 'CANDIDATE' } : x)))}>
                    {Object.keys(TB.KIND).map((k) => <option key={k} value={k}>{t(TB.KIND[k])}</option>)}
                  </select>
                  <label htmlFor={`nr-s-${i}`}>{t('Estado de la regla')}</label>
                  <select id={`nr-s-${i}`} value={r.status} onChange={(e) => setNReglas((l) => l.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)))}>
                    <option value="ACTIVE" disabled={r.kind !== 'GEO_TECH_PROFILE'}>{t(TB.REGLA.ACTIVE)}</option><option value="CANDIDATE">{t(TB.REGLA.CANDIDATE)}</option>
                  </select>
                  <label htmlFor={`nr-f-${i}`}>{t('Fuente que la respalda')}</label>
                  <select id={`nr-f-${i}`} value={r.source_code} onChange={(e) => setNReglas((l) => l.map((x, j) => (j === i ? { ...x, source_code: e.target.value } : x)))} required>
                    <option value="">{t('Elige una fuente…')}</option>{nFuentes.filter((f) => f.code.trim()).map((f) => <option key={f.code} value={f.code.trim()}>{f.code}</option>)}
                  </select>
                  <label htmlFor={`nr-a-${i}`}>{t('Artículo')}</label><input id={`nr-a-${i}`} value={r.article} onChange={(e) => setNReglas((l) => l.map((x, j) => (j === i ? { ...x, article: e.target.value } : x)))} required />
                  <label htmlFor={`nr-cr-${i}`}>{t('Criterio')}</label><textarea id={`nr-cr-${i}`} value={r.criterion} onChange={(e) => setNReglas((l) => l.map((x, j) => (j === i ? { ...x, criterion: e.target.value } : x)))} minLength={10} required />
                  {r.status === 'CANDIDATE' && (<><label htmlFor={`nr-q-${i}`}>{t('Qué falta para poder aplicarla')}</label><textarea id={`nr-q-${i}`} value={r.pending_questions} onChange={(e) => setNReglas((l) => l.map((x, j) => (j === i ? { ...x, pending_questions: e.target.value } : x)))} minLength={10} required /></>)}
                  {nReglas.length > 1 && <button type="button" onClick={() => setNReglas((l) => l.filter((_, j) => j !== i))}>{t('Quitar regla')} {i + 1}</button>}
                </fieldset>
              ))}
              <button type="button" onClick={() => setNReglas((l) => [...l, { code: '', kind: 'PRODUCTION_PERIOD', status: 'CANDIDATE', source_code: '', article: '', criterion: '', pending_questions: '' }])}>{t('Añadir una regla')}</button>
              <label className="checkbox-row"><input type="checkbox" checked={confirmoNv} onChange={(e) => setConfirmoNv(e.target.checked)} />{' '}{t('Entiendo que la versión será inmutable y nacerá sin revisión')}</label>
              <button type="submit" disabled={ocupado || !confirmoNv}>{ocupado ? t('Registrando…') : t('Preparar la versión')}</button>
            </form>
          </section>
        </>
      )}
    </>
  );
}
