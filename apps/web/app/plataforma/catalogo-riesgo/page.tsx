'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n';
import { useWorkspace } from '../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../lib/ui';
import { VINCULO_TABLAS as TB } from '../../../lib/vinculo-catalogo';

// D-07.5(b), opción b-1 — acto de vinculación del catálogo de riesgo con un perfil jurídico revisado.
// La pantalla deja revisar la referencia propuesta, confirmar el acto y consultar su historial. NO fabrica perfiles
// elegibles: sin uno, explica qué falta. La autorización y toda comprobación las hace la API (y la base).

interface Razon { code: string; text: string }
interface Revision { id: string; decision: string; decided_at: string; reviewer_capacity: string }
interface Perfil { version: string; technical_status: string; scope: string; eligible: boolean; reasons: Razon[]; review: Revision | null }
interface Catalogo { version: string; approval_status: string; regulatory_profile: string | null; published_at: string }
interface Elegibilidad { profiles: Perfil[]; rule_sets: Catalogo[] }
interface Acto {
  id: string; rule_set_version: string; base_rule_set_version: string; profile_version: string; review_id: string; reason: string;
  decided_at: string; decided_by: string | null; current_status: string; current_reasons: Razon[];
}

export default function VinculoCatalogoPage() {
  const ws = useWorkspace();
  const { t, dt } = useI18n();
  const [el, setEl] = useState<Elegibilidad | null>(null);
  const [actos, setActos] = useState<Acto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [aviso, setAviso] = useState<{ tone: 'info' | 'warning'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [perfil, setPerfil] = useState('');
  const [base, setBase] = useState('');
  const [nueva, setNueva] = useState('');
  const [motivo, setMotivo] = useState('');
  const [confirmo, setConfirmo] = useState(false);

  const cargar = useCallback(async () => {
    if (!ws.isPlatformAdmin) return;
    try {
      const [e, h] = await Promise.all([
        api<Elegibilidad>('/api/v1/platform/risk-catalog/profile-links/eligibility'),
        api<{ links: Acto[] }>('/api/v1/platform/risk-catalog/profile-links'),
      ]);
      setEl(e); setActos(h.links); setError(null);
      const elegibles = e.profiles.filter((p) => p.eligible);
      setPerfil((p) => (elegibles.some((x) => x.version === p) ? p : elegibles[0]?.version ?? ''));
      setBase((b) => (e.rule_sets.some((x) => x.version === b) ? b : e.rule_sets[0]?.version ?? ''));
    } catch (err) { setError(err as ApiError); }
  }, [ws.isPlatformAdmin]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!ws.isPlatformAdmin) {
    return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: t('Tu cuenta no tiene permiso para vincular el catálogo con un perfil jurídico.'), request_id: null })} />;
  }

  const elegibles = el?.profiles.filter((p) => p.eligible) ?? [];
  const propuesto = elegibles.find((p) => p.version === perfil) ?? null;

  const confirmar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!propuesto?.review || !confirmo) return;
    setOcupado(true); setAviso(null);
    try {
      await api('/api/v1/platform/risk-catalog/profile-links', {
        method: 'POST',
        body: { operation_id: crypto.randomUUID(), base_rule_set_version: base, new_rule_set_version: nueva.trim(), profile_version: propuesto.version, review_id: propuesto.review.id, reason: motivo.trim() },
      });
      setAviso({ tone: 'info', texto: t('Vinculación registrada: la versión {version} existe y no está adoptada en ninguna organización.', { version: nueva.trim() }) });
      setNueva(''); setMotivo(''); setConfirmo(false); setError(null);
      await cargar();
    } catch (err) {
      const e = err as ApiError;
      if (e.body?.code === 'REVIEW_CHANGED') { setAviso({ tone: 'warning', texto: t('La revisión del perfil cambió mientras confirmabas. Vuelve a revisar la referencia propuesta.') }); setConfirmo(false); await cargar(); }
      else setError(e);
    } finally { setOcupado(false); }
  };

  const razones = (rs: Razon[]) => (
    <ul>{rs.map((r) => <li key={r.code}>{t(TB.RAZON[r.code] ?? r.code)}</li>)}</ul>
  );

  return (
    <>
      <Breadcrumb items={[{ label: t('Organizaciones (plataforma)'), href: '/organizaciones' }, { label: t('Catálogo de riesgo y perfil jurídico') }]} />
      <PageHeader
        title={t('Vinculación del catálogo de riesgo con un perfil jurídico')}
        meta={t('Acto de plataforma (D-07.5(b), opción b-1): crea una versión nueva del catálogo que declara una referencia exacta a un perfil jurídico con revisión vigente.')}
      />
      <Alert tone="review" title={t('Qué hace y qué no hace este acto')}>
        <ul>
          <li>{t('Copia las reglas de una versión base sin cambiarlas y las publica como versión nueva. No edita ninguna versión publicada.')}</li>
          <li>{t('No adopta la versión nueva en ninguna organización: cada organización decide adoptarla.')}</li>
          <li>{t('No aprueba el contenido jurídico del perfil ni registra una conclusión regulatoria.')}</li>
        </ul>
      </Alert>
      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {aviso && <Alert tone={aviso.tone === 'warning' ? 'review' : 'info'} title={aviso.texto}><span /></Alert>}
      {!el && !error && <Loading label={t('Cargando perfiles y catálogos…')} />}

      {el && (
        <>
          <section aria-labelledby="perfiles">
            <h2 id="perfiles">{t('Perfiles jurídicos y su elegibilidad')}</h2>
            <p className="muted">{t('Un perfil es elegible solo si está publicado, tiene alcance completo y su última revisión es «revisado». Elegible no significa aprobado.')}</p>
            <div className="table-wrap"><table aria-label={t('Perfiles jurídicos y su elegibilidad')}>
              <thead><tr>
                <th scope="col">{t('Versión y elegibilidad')}</th><th scope="col">{t('Estado')}</th><th scope="col">{t('Alcance')}</th>
                <th scope="col">{t('Revisión vigente')}</th>
              </tr></thead>
              <tbody>{el.profiles.map((p) => (
                <tr key={p.version}>
                  <td>
                    {p.version}{' '}
                    <StatusBadge tone={p.eligible ? 'valid' : 'blocked'}>{p.eligible ? t('Elegible') : t('No elegible')}</StatusBadge>
                    {!p.eligible && razones(p.reasons)}
                  </td>
                  <td>{t(TB.ESTADO_PERFIL[p.technical_status] ?? p.technical_status)}</td>
                  <td>{t(TB.ALCANCE[p.scope] ?? p.scope)}</td>
                  <td>{p.review ? <>{t(TB.DECISION[p.review.decision] ?? p.review.decision)}<div className="muted">{dt(p.review.decided_at)}</div></> : <span className="muted">{t('Sin revisión')}</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>

          {elegibles.length === 0 ? (
            <Alert tone="review" title={t('Ningún perfil es elegible todavía')}>
              <p>{t('No se puede confirmar ningún acto: falta un perfil publicado, completo y con revisión vigente. Lo que falta de cada perfil figura en la tabla.')}</p>
            </Alert>
          ) : (
            <section aria-labelledby="confirmar">
              <h2 id="confirmar">{t('Confirmar la vinculación')}</h2>
              <form onSubmit={confirmar}>
                <label htmlFor="v-perfil">{t('Perfil jurídico que se referencia')}</label>
                <select id="v-perfil" value={perfil} onChange={(e) => { setPerfil(e.target.value); setConfirmo(false); }}>
                  {elegibles.map((p) => <option key={p.version} value={p.version}>{p.version}</option>)}
                </select>
                <label htmlFor="v-base">{t('Versión base del catálogo (sus reglas se copian)')}</label>
                <select id="v-base" value={base} onChange={(e) => setBase(e.target.value)}>
                  {el.rule_sets.map((r) => <option key={r.version} value={r.version}>{r.version}</option>)}
                </select>
                <label htmlFor="v-nueva">{t('Versión nueva del catálogo')}</label>
                <input id="v-nueva" value={nueva} onChange={(e) => setNueva(e.target.value)} pattern="[0-9]+\.[0-9]+\.[0-9]+" required aria-describedby="v-nueva-ayuda" />
                <p id="v-nueva-ayuda" className="muted">{t('Formato x.y.z, por ejemplo 1.1.0. No puede existir.')}</p>
                <label htmlFor="v-motivo">{t('Motivo del acto')}</label>
                <textarea id="v-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={3} maxLength={500} required />
                {propuesto?.review && (
                  <>
                    <h3>{t('Referencia propuesta')}</h3>
                    <dl className="props" aria-label={t('Referencia propuesta')}>
                      <dt>{t('Perfil')}</dt><dd>{propuesto.version}</dd>
                      <dt>{t('Revisión que lo sustenta')}</dt><dd className="hash">{propuesto.review.id}</dd>
                      <dt>{t('Decisión')}</dt><dd>{t(TB.DECISION[propuesto.review.decision] ?? propuesto.review.decision)}</dd>
                      <dt>{t('Capacidad declarada del revisor')}</dt><dd>{propuesto.review.reviewer_capacity}</dd>
                      <dt>{t('Fecha de la revisión')}</dt><dd>{dt(propuesto.review.decided_at)}</dd>
                    </dl>
                  </>
                )}
                <label className="checkbox-row"><input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} />{' '}{t('Confirmo que la referencia y la revisión indicadas son las que quiero registrar')}</label>
                <button type="submit" disabled={ocupado || !confirmo || !nueva.trim() || motivo.trim().length < 3}>{ocupado ? t('Registrando…') : t('Registrar la vinculación')}</button>
              </form>
            </section>
          )}

          <section aria-labelledby="catalogos">
            <h2 id="catalogos">{t('Catálogos publicados')}</h2>
            <div className="table-wrap"><table aria-label={t('Catálogos publicados')}>
              <thead><tr><th scope="col">{t('Versión')}</th><th scope="col">{t('Estado')}</th><th scope="col">{t('Perfil declarado')}</th><th scope="col">{t('Publicación')}</th></tr></thead>
              <tbody>{el.rule_sets.map((r) => (
                <tr key={r.version}>
                  <td>{r.version}</td><td>{t(TB.APROBACION[r.approval_status] ?? r.approval_status)}</td>
                  <td>{r.regulatory_profile ?? '—'}</td><td className="muted">{dt(r.published_at)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>

          <section aria-labelledby="historial">
            <h2 id="historial">{t('Historial de vinculaciones')}</h2>
            {actos && actos.length === 0 && <EmptyState title={t('Todavía no se ha registrado ningún acto de vinculación.')} />}
            {actos && actos.length > 0 && (
              <div className="table-wrap"><table aria-label={t('Historial de vinculaciones')}>
                <thead><tr>
                  <th scope="col">{t('Versión nueva')}</th><th scope="col">{t('Versión base')}</th><th scope="col">{t('Perfil')}</th><th scope="col">{t('Revisión')}</th>
                  <th scope="col">{t('Registrado por')}</th><th scope="col">{t('Fecha')}</th><th scope="col">{t('Motivo')}</th><th scope="col">{t('Vigencia actual')}</th>
                </tr></thead>
                <tbody>{actos.map((a) => (
                  <tr key={a.id}>
                    <td>{a.rule_set_version}</td><td>{a.base_rule_set_version}</td><td>{a.profile_version}</td>
                    <td className="muted hash">{a.review_id}</td><td>{a.decided_by ?? '—'}</td><td className="muted">{dt(a.decided_at)}</td><td>{a.reason}</td>
                    <td>
                      <StatusBadge tone={a.current_status === 'CURRENT' ? 'valid' : 'blocked'}>{t(TB.VIGENCIA[a.current_status] ?? a.current_status)}</StatusBadge>
                      {a.current_status !== 'CURRENT' && (
                        <>{razones(a.current_reasons)}<p className="muted">{t('La referencia histórica se conserva, pero ya no se usa como aprobación vigente: el requisito del catálogo queda pendiente.')}</p></>
                      )}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}
    </>
  );
}
