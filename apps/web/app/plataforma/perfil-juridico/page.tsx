'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n';
import { useWorkspace } from '../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge, type Tone } from '../../../lib/ui';
import { REVISION_TABLAS as TB } from '../../../lib/revision-perfil';

// P1-005 — acto de REVISIÓN del perfil jurídico (plataforma). Registra quién revisó, qué versión exacta, con qué fundamento y soporte, y el
// resultado. NO es una conclusión jurídica del sistema ni publica o adopta el perfil. Nada se escribe hasta confirmar: lo que se teclea es un
// borrador local del navegador, no una revisión. Una revisión registrada es efectiva e inmutable; una posterior no la reescribe.

interface Soporte { kind: string; source_code: string | null; citation: string | null; url: string | null; file_sha256: string | null }
interface Revision {
  id: string; decision: string; reviewer_name: string; reviewer_capacity: string; reviewed_on: string; recorded_at: string;
  recorded_by: string | null; basis: string; supports: Soporte[]; is_current: boolean;
}
interface Fuente { code: string; title: string; publication: string; url: string; file_sha256: string }
interface Version {
  version: string; technical_status: string; scope: string; scope_note: string; pending_matters: string[]; sources: Fuente[];
  status: string; current_review: Revision | null; history: Revision[]; link_eligibility: { eligible: boolean; reasons: string[] };
}
interface Cita { citation: string; url: string; file_sha256: string }

const BORRADOR = 'tl_borrador_revision_perfil';
const TONO: Record<string, Tone> = { NONE: 'neutral', REVIEWED: 'valid', OBJECTED: 'blocked', WITHDRAWN: 'review' };

export default function RevisionPerfilPage() {
  const ws = useWorkspace();
  const { t, dt } = useI18n();
  const [versiones, setVersiones] = useState<Version[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [version, setVersion] = useState('');
  const [decision, setDecision] = useState('REVIEWED');
  const [nombre, setNombre] = useState('');
  const [capacidad, setCapacidad] = useState('');
  const [fecha, setFecha] = useState('');
  const [fundamento, setFundamento] = useState('');
  const [fuentes, setFuentes] = useState<string[]>([]);
  const [citas, setCitas] = useState<Cita[]>([]);
  const [confirmo, setConfirmo] = useState(false);

  // Borrador LOCAL (solo este navegador): conveniencia, no una revisión. Se descarta al registrar.
  useEffect(() => {
    try {
      const b = JSON.parse(sessionStorage.getItem(BORRADOR) ?? 'null') as null | { nombre: string; capacidad: string; fecha: string; fundamento: string };
      if (b) { setNombre(b.nombre); setCapacidad(b.capacidad); setFecha(b.fecha); setFundamento(b.fundamento); }
    } catch { /* sin almacenamiento: el formulario funciona igual */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(BORRADOR, JSON.stringify({ nombre, capacidad, fecha, fundamento })); } catch { /* idem */ }
  }, [nombre, capacidad, fecha, fundamento]);

  const cargar = useCallback(async () => {
    if (!ws.isPlatformAdmin) return;
    try {
      const r = await api<{ versions: Version[] }>('/api/v1/platform/legal-profile/reviews');
      setVersiones(r.versions); setError(null);
      setVersion((v) => (r.versions.some((x) => x.version === v) ? v : r.versions[0]?.version ?? ''));
    } catch (err) { setError(err as ApiError); }
  }, [ws.isPlatformAdmin]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!ws.isPlatformAdmin) {
    return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: t('Tu cuenta no tiene permiso para registrar revisiones de perfiles jurídicos.'), request_id: null })} />;
  }

  const sel = versiones?.find((v) => v.version === version) ?? null;
  const hoy = new Date().toISOString().slice(0, 10);
  const puedeRetirar = sel?.status === 'REVIEWED';
  const soportes = fuentes.length + citas.filter((c) => c.citation.trim().length >= 3).length;
  const completo = !!sel && nombre.trim().length >= 3 && capacidad.trim().length >= 3 && !!fecha && fecha <= hoy && fundamento.trim().length >= 10 && (decision !== 'REVIEWED' || soportes > 0) && (decision !== 'WITHDRAWN' || puedeRetirar);

  const cambiarVersion = (v: string) => { setVersion(v); setFuentes([]); setCitas([]); setConfirmo(false); setAviso(null); };

  const registrar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!sel || !completo || !confirmo) return;
    setOcupado(true); setAviso(null);
    try {
      await api('/api/v1/platform/legal-profile/reviews', {
        method: 'POST',
        body: {
          operation_id: crypto.randomUUID(), version: sel.version, decision, reviewer_name: nombre.trim(), reviewer_capacity: capacidad.trim(), reviewed_on: fecha, basis: fundamento.trim(),
          supports: [
            ...fuentes.map((c) => ({ kind: 'PROFILE_SOURCE', source_code: c })),
            ...citas.filter((c) => c.citation.trim().length >= 3).map((c) => ({ kind: 'CITATION', citation: c.citation.trim(), ...(c.url.trim() ? { url: c.url.trim() } : {}), ...(c.file_sha256.trim() ? { file_sha256: c.file_sha256.trim() } : {}) })),
          ],
          expected_current_review_id: sel.current_review?.id ?? null,
        },
      });
      try { sessionStorage.removeItem(BORRADOR); } catch { /* idem */ }
      setNombre(''); setCapacidad(''); setFecha(''); setFundamento(''); setFuentes([]); setCitas([]); setConfirmo(false); setError(null);
      setAviso(t('Revisión efectiva registrada para la versión {version}. No es una conclusión jurídica del sistema ni publica o adopta el perfil.', { version: sel.version }));
      await cargar();
    } catch (err) {
      const e = err as ApiError;
      if (e.body?.code === 'REVIEW_SUPERSEDED') { setAviso(t('La revisión vigente cambió mientras la preparabas. Revisa el historial y vuelve a registrar.')); setConfirmo(false); await cargar(); }
      else setError(e);
    } finally { setOcupado(false); }
  };

  return (
    <>
      <Breadcrumb items={[{ label: t('Organizaciones (plataforma)'), href: '/organizaciones' }, { label: t('Revisión de perfiles jurídicos') }]} />
      <PageHeader
        title={t('Revisión de perfiles jurídicos')}
        meta={t('Acto de plataforma: registra quién revisó una versión exacta del perfil, con qué fundamento y soporte, y el resultado.')}
      />
      <Alert tone="review" title={t('Qué es y qué no es este registro')}>
        <ul>
          <li>{t('Registrar una revisión no es una conclusión jurídica del sistema: conserva lo que declara la persona revisora.')}</li>
          <li>{t('No publica ni adopta el perfil, ni vincula ningún catálogo. Aplica las consecuencias técnicas ya definidas: elegibilidad, vigencia de la vinculación y obsolescencia de instantáneas.')}</li>
          <li>{t('Nada se registra hasta confirmar. Una revisión registrada es efectiva e inmutable; una posterior no la reescribe.')}</li>
        </ul>
      </Alert>
      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {aviso && <Alert tone="info" title={aviso}><span /></Alert>}
      {!versiones && !error && <Loading label={t('Cargando perfiles…')} />}

      {versiones && sel && (
        <>
          <section aria-labelledby="version">
            <h2 id="version">{t('Versión exacta del perfil')}</h2>
            <label htmlFor="rv-version">{t('Versión')}</label>
            <select id="rv-version" value={version} onChange={(e) => cambiarVersion(e.target.value)}>
              {versiones.map((v) => <option key={v.version} value={v.version}>{v.version} · {t(TB.ESTADO_PERFIL[v.technical_status] ?? v.technical_status)} · {t(TB.ESTADO[v.status] ?? v.status)}</option>)}
            </select>
            <dl className="props" aria-label={t('Versión exacta del perfil')}>
              <dt>{t('Estado')}</dt><dd>{t(TB.ESTADO_PERFIL[sel.technical_status] ?? sel.technical_status)}</dd>
              <dt>{t('Alcance')}</dt><dd>{t(TB.ALCANCE[sel.scope] ?? sel.scope)}</dd>
              <dt>{t('Revisión vigente')}</dt>
              <dd><StatusBadge tone={TONO[sel.status] ?? 'neutral'}>{t(TB.ESTADO[sel.status] ?? sel.status)}</StatusBadge></dd>
              <dt>{t('Consecuencia técnica actual')}</dt>
              <dd>
                <StatusBadge tone={sel.link_eligibility.eligible ? 'valid' : 'blocked'}>{sel.link_eligibility.eligible ? t('Elegible para vincular un catálogo') : t('No elegible para vincular un catálogo')}</StatusBadge>
                {!sel.link_eligibility.eligible && <ul>{sel.link_eligibility.reasons.map((r) => <li key={r}>{t(TB.CONSECUENCIA[r] ?? r)}</li>)}</ul>}
              </dd>
            </dl>
          </section>

          <section aria-labelledby="historial">
            <h2 id="historial">{t('Historial de revisiones de esta versión')}</h2>
            {sel.history.length === 0 ? <EmptyState title={t('Esta versión no tiene ninguna revisión registrada.')} /> : (
              <div className="table-wrap"><table aria-label={t('Historial de revisiones de esta versión')}>
                <thead><tr>
                  <th scope="col">{t('Resultado y revisor')}</th><th scope="col">{t('Fundamento, soporte y registro')}</th>
                </tr></thead>
                <tbody>{sel.history.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <StatusBadge tone={TONO[r.decision] ?? 'neutral'}>{t(TB.DECISION[r.decision] ?? r.decision)}</StatusBadge>{' '}
                      <StatusBadge tone={r.is_current ? 'process' : 'neutral'}>{r.is_current ? t('Vigente') : t('Reemplazada')}</StatusBadge>
                      <div>{r.reviewer_name}</div>
                      <div className="muted">{r.reviewer_capacity}</div>
                      <div className="muted">{t('Fecha de la revisión')}: {r.reviewed_on}</div>
                    </td>
                    <td>
                      {r.basis}
                      {r.supports.length > 0 && (
                        <ul className="muted">{r.supports.map((x, i) => (
                          <li key={i}>{t(TB.SOPORTE[x.kind] ?? x.kind)}: {x.source_code ?? x.citation}{x.url ? <> · <a href={x.url} target="_blank" rel="noreferrer">{t('enlace')}</a></> : null}</li>
                        ))}</ul>
                      )}
                      <div className="muted">{t('Registrado')}: {dt(r.recorded_at)} · {r.recorded_by ?? '—'}</div>
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>

          <section aria-labelledby="registrar">
            <h2 id="registrar">{t('Registrar una revisión efectiva')}</h2>
            <p className="muted">{t('Lo que escribes aquí se conserva solo en este navegador hasta que registres: es un borrador local, no una revisión.')}</p>
            <form onSubmit={registrar}>
              <fieldset>
                <legend>{t('Resultado')}</legend>
                {(['REVIEWED', 'OBJECTED', 'WITHDRAWN'] as const).map((d) => (
                  <label key={d} className="checkbox-row">
                    <input type="radio" name="rv-decision" value={d} checked={decision === d} disabled={d === 'WITHDRAWN' && !puedeRetirar} onChange={() => { setDecision(d); setConfirmo(false); }} />{' '}
                    {t(TB.DECISION[d])}{d === 'WITHDRAWN' && !puedeRetirar ? ` — ${t('solo si la revisión vigente es favorable')}` : ''}
                  </label>
                ))}
              </fieldset>
              <label htmlFor="rv-nombre">{t('Persona revisora')}</label>
              <input id="rv-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} minLength={3} maxLength={200} required />
              <label htmlFor="rv-capacidad">{t('Cargo o capacidad declarada')}</label>
              <input id="rv-capacidad" value={capacidad} onChange={(e) => setCapacidad(e.target.value)} minLength={3} maxLength={300} required />
              <label htmlFor="rv-fecha">{t('Fecha de la revisión')}</label>
              <input id="rv-fecha" type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} required />
              <label htmlFor="rv-fundamento">{t('Fundamento de la decisión')}</label>
              <textarea id="rv-fundamento" value={fundamento} onChange={(e) => setFundamento(e.target.value)} minLength={10} maxLength={2000} required />

              <fieldset>
                <legend>{t('Fuentes y soporte')}</legend>
                {decision === 'REVIEWED' && <p className="muted">{t('Una revisión favorable exige al menos una fuente del perfil o una cita.')}</p>}
                {sel.sources.map((s) => (
                  <label key={s.code} className="checkbox-row">
                    <input type="checkbox" checked={fuentes.includes(s.code)} onChange={(e) => setFuentes((f) => (e.target.checked ? [...f, s.code] : f.filter((x) => x !== s.code)))} />{' '}
                    {s.title} <span className="muted">({s.code})</span>
                  </label>
                ))}
                {citas.map((c, i) => (
                  <div key={i}>
                    <label htmlFor={`rv-cita-${i}`}>{t('Cita')} {i + 1}</label>
                    <input id={`rv-cita-${i}`} value={c.citation} onChange={(e) => setCitas((l) => l.map((x, j) => (j === i ? { ...x, citation: e.target.value } : x)))} maxLength={500} />
                    <label htmlFor={`rv-url-${i}`}>{t('Enlace (https, opcional)')}</label>
                    <input id={`rv-url-${i}`} value={c.url} onChange={(e) => setCitas((l) => l.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} inputMode="url" />
                    <label htmlFor={`rv-sha-${i}`}>{t('Huella sha256 de la copia (opcional)')}</label>
                    <input id={`rv-sha-${i}`} value={c.file_sha256} onChange={(e) => setCitas((l) => l.map((x, j) => (j === i ? { ...x, file_sha256: e.target.value } : x)))} />
                    <button type="button" onClick={() => setCitas((l) => l.filter((_, j) => j !== i))}>{t('Quitar cita')} {i + 1}</button>
                  </div>
                ))}
                <button type="button" onClick={() => setCitas((l) => [...l, { citation: '', url: '', file_sha256: '' }])}>{t('Añadir una cita')}</button>
              </fieldset>

              <h3>{t('Resumen antes de registrar')}</h3>
              <dl className="props" aria-label={t('Resumen antes de registrar')}>
                <dt>{t('Versión')}</dt><dd>{sel.version}</dd>
                <dt>{t('Resultado')}</dt><dd>{t(TB.DECISION[decision])}</dd>
                <dt>{t('Soportes')}</dt><dd>{soportes}</dd>
                <dt>{t('Sustituye a la revisión vigente')}</dt><dd>{sel.current_review ? `${t(TB.DECISION[sel.current_review.decision] ?? sel.current_review.decision)} · ${sel.current_review.reviewed_on}` : t('Ninguna')}</dd>
              </dl>
              <label className="checkbox-row"><input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} />{' '}{t('Entiendo que se registra una revisión efectiva e inmutable, no un borrador')}</label>
              <button type="submit" disabled={ocupado || !completo || !confirmo}>{ocupado ? t('Registrando…') : t('Registrar revisión efectiva')}</button>
            </form>
          </section>
        </>
      )}
    </>
  );
}
