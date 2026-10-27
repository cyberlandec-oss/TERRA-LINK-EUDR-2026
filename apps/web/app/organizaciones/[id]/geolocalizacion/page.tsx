'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useI18n } from '../../../../lib/i18n';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge, type Tone } from '../../../../lib/ui';
import { GEO_CONFIG_TABLAS as TB } from '../../../../lib/geo-config';

// GEOLOCATION_PROFILE — configuración versionada de reglas de geolocalización, vista de la ORGANIZACIÓN. Permite conocer cada versión (reglas, fuentes,
// revisión y si la revisión la declara aplicable a esta organización), qué falta y adoptarla o retirarla. Adoptar NO la revisa ni la declara aplicable, y la
// condición técnica del requisito no es una conclusión regulatoria. La autorización la decide la API.

interface Regla { code: string; kind: string; status: string; article: string; criterion: string; proposed_interpretation: string | null; pending_questions: string | null; source_code: string }
interface Fuente { code: string; title: string; citation: string; url: string }
interface Soporte { kind: string; source_code: string | null; citation: string | null; url: string | null }
interface Revision {
  id: string; decision: string; reviewer_name: string; reviewer_capacity: string; reviewed_on: string; recorded_at: string; basis: string; applicability_note: string;
  applies_to_this_organization: boolean; supports: Soporte[]; is_current: boolean;
}
interface Config {
  version: string; technical_profile_id: string; technical_profile_version: string; scope_note: string; status: string; rules: Regla[]; sources: Fuente[];
  current_review: Revision | null; history: Revision[]; gaps: string[]; adopted_by_this_organization?: boolean;
}
interface Catalogo { technical_profile: { id: string; version: string }; adopted: string | null; configs: Config[] }
const TONO: Record<string, Tone> = { NONE: 'neutral', REVIEWED: 'valid', OBJECTED: 'blocked', WITHDRAWN: 'review' };

export default function GeolocalizacionOrgPage() {
  const ws = useWorkspace();
  const { t, dt } = useI18n();
  const orgId = ws.activeOrg?.id;
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    if (!orgId || !ws.can('traceability:read_catalog')) return;
    try { setCat(await api<Catalogo>(`/api/v1/organizations/${orgId}/geolocation-config/catalog`)); setError(null); }
    catch (err) { setError(err as ApiError); }
  }, [orgId, ws]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!ws.activeOrg) return null;
  if (!ws.can('traceability:read_catalog')) {
    return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: t('Tu rol no permite consultar las configuraciones de geolocalización.'), request_id: null })} />;
  }

  const decidir = async (version: string, decision: 'ADOPT' | 'WITHDRAW') => {
    setOcupado(true);
    try {
      await api(`/api/v1/organizations/${orgId}/geolocation-config/adoptions`, { method: 'POST', body: { operation_id: crypto.randomUUID(), version, decision, reason: decision === 'ADOPT' ? 'Adopción para evaluar el requisito de geolocalización' : 'Retirada de la configuración' } });
      await cargar();
    } catch (err) { setError(err as ApiError); } finally { setOcupado(false); }
  };

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Geolocalización: reglas') }]} />
      <PageHeader
        title={t('Reglas de geolocalización (versionadas)')}
        meta={t('Configuración que define cuándo se considera satisfecho el requisito de geolocalización del expediente. No es una conclusión regulatoria.')}
      />
      <Alert tone="review" title={t('Qué significa adoptar una configuración')}>
        <ul>
          <li>{t('Adoptar no la revisa ni la declara aplicable a esta organización: sin una revisión favorable vigente que la incluya, el requisito no se evalúa.')}</li>
          <li>{t('Una revisión favorable no demuestra que aplique a todas las organizaciones: cada revisión declara su alcance.')}</li>
          <li>{t('Las reglas candidatas no se aplican y, mientras existan, el criterio de «satisfecho» no está completo. Que la geometría cumpla el formato técnico no basta.')}</li>
        </ul>
      </Alert>
      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {!cat && !error && <Loading label={t('Cargando configuraciones…')} />}
      {cat && cat.configs.map((c) => (
        <section key={c.version} aria-labelledby={`cfg-${c.version}`}>
          <h2 id={`cfg-${c.version}`}>
            {t('Configuración')} {c.version}{' '}
            <StatusBadge tone={TONO[c.status] ?? 'neutral'}>{t(TB.ESTADO[c.status] ?? c.status)}</StatusBadge>{' '}
            {c.adopted_by_this_organization && <StatusBadge tone="process">{t('Adoptada por esta organización')}</StatusBadge>}
          </h2>
          <p className="muted">{c.scope_note}</p>
          <dl className="props" aria-label={`${t('Configuración')} ${c.version}`}>
            <dt>{t('Perfil técnico')}</dt><dd>{c.technical_profile_id} {c.technical_profile_version}</dd>
            <dt>{t('Revisión vigente')}</dt>
            <dd>
              {c.current_review ? (
                <>
                  {c.current_review.reviewer_name}<div className="muted">{c.current_review.reviewer_capacity} · {c.current_review.reviewed_on}</div>
                  <div className="muted">{t('Aplicabilidad declarada')}: {c.current_review.applicability_note}</div>
                  <div>{c.current_review.applies_to_this_organization ? t('Declarada aplicable a esta organización') : t('No declarada aplicable a esta organización')}</div>
                </>
              ) : <span className="muted">{t('Sin revisión')}</span>}
            </dd>
          </dl>
          <h3>{t('Qué falta para poder evaluar el requisito')}</h3>
          {c.gaps.length === 0 ? <p>{t('Nada: la configuración permite evaluar el requisito (sigue sin ser una conclusión regulatoria).')}</p> : (
            <ul>{c.gaps.map((g) => <li key={g}>{t(TB.FALTA[g] ?? g)}</li>)}</ul>
          )}
          <h3>{t('Reglas')}</h3>
          <ul className="plain">
            {c.rules.map((r) => (
              <li key={r.code}>
                <strong>{r.code}</strong> <StatusBadge tone={r.status === 'ACTIVE' ? 'valid' : 'review'}>{t(TB.REGLA[r.status] ?? r.status)}</StatusBadge>
                <div>{t(TB.KIND[r.kind] ?? r.kind)}</div>
                <div className="muted">{r.article} · {r.criterion}</div>
                {r.status === 'CANDIDATE' && r.pending_questions && <div className="muted"><em>{t('Pendiente')}: {r.pending_questions}</em></div>}
              </li>
            ))}
          </ul>
          <h3>{t('Fuentes')}</h3>
          <ul className="plain">{c.sources.map((s) => <li key={s.code}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a><div className="muted">{s.citation}</div></li>)}</ul>
          {c.history.length > 0 && (
            <>
              <h3>{t('Historial de revisiones')}</h3>
              <ul className="plain">{c.history.map((h) => (
                <li key={h.id}>
                  <StatusBadge tone={TONO[h.decision] ?? 'neutral'}>{t(TB.DECISION[h.decision] ?? h.decision)}</StatusBadge>{' '}
                  <StatusBadge tone={h.is_current ? 'process' : 'neutral'}>{t(TB.VIGENCIA[String(h.is_current)])}</StatusBadge>
                  <div>{h.reviewer_name} <span className="muted">· {h.reviewed_on} · {dt(h.recorded_at)}</span></div>
                  <div className="muted">{h.basis}</div>
                </li>
              ))}</ul>
            </>
          )}
          {ws.can('risk:approve_rules') ? (
            <button type="button" disabled={ocupado} onClick={() => void decidir(c.version, c.adopted_by_this_organization ? 'WITHDRAW' : 'ADOPT')}>
              {c.adopted_by_this_organization ? t('Retirar esta configuración') : t('Adoptar esta configuración')}
            </button>
          ) : <p className="muted">{t('Tu rol permite consultar, no adoptar ni retirar configuraciones.')}</p>}
        </section>
      ))}
    </>
  );
}
