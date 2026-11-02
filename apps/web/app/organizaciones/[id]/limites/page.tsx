'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useI18n } from '../../../../lib/i18n';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// P1-015 — Límites, consumo, coste, idioma y acceso (RF-46; D-54).
//
// Lo que esta pantalla no puede dejar de decir:
//   · cada límite trae **de dónde sale** y **qué pasa al superarlo**: así se puede comprobar, no creer;
//   · el **consumo no es un coste**: el coste estimado se calcula con tarifas declaradas, en su propia pantalla;
//   · el acceso federado está implementado y, si no está habilitado, se dice;
//   · el español es la fuente y el inglés la segunda lengua; la interfaz no es una traducción jurídica certificada.
// Los textos de los límites los traduce la API (`?lang=`): una única fuente por límite.

interface Limite {
  code: string; label: string; what: string; value: number | string; unit: string;
  source: string; enforced_at: string; on_exceed: string;
}
interface Vista {
  lang: string;
  limits: Limite[];
  usage: {
    documents: number; document_versions: number; stored_bytes: number; quota_bytes: number;
    quota_note: string; plots: number; deliveries: number; events: number;
  };
  language: { primary: string; available: string[]; note: string };
  cost: { currency: string; unit: string; note: string };
  sso: { enabled: boolean; method: string; local_login_kept: boolean };
  cost_note: string; sso_note: string; note: string;
}

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default function LimitesPage() {
  const ws = useWorkspace();
  const { t, locale } = useI18n();
  const orgId = ws.activeOrg?.id;
  const [v, setV] = useState<Vista | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const cargar = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    try { setV(await api<Vista>(`/api/v1/organizations/${orgId}/limits?lang=${locale}`)); }
    catch (err) { setError(err as ApiError); }
  }, [orgId, locale]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!ws.activeOrg) {
    return <ErrorPanel error={new ApiError(404, { code: 'NOT_FOUND', message: 'El recurso no existe o no está disponible para ti.', request_id: null })} />;
  }
  const migas = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Límites y consumo') }];

  return (
    <>
      <Breadcrumb items={migas} />
      <PageHeader title={t('Límites y consumo')} meta={<span>{t('Solo lectura · valores vigentes del producto')}</span>} />

      <Alert tone="info" title={t('El consumo no es un coste.')}>
        <p>
          {t('Aquí se ve lo que el producto limita hoy y lo que esta organización lleva consumido. Ninguna de estas cifras es dinero. Tampoco se fija aquí ningún límite nuevo: se leen de la configuración vigente, y si alguien los cambia, cambia lo que ves.')}
          {' '}
          {ws.can('platform_cost:read') && <Link href={`/organizaciones/${orgId}/coste`}>{t('Ver el coste estimado de la plataforma')}</Link>}
        </p>
      </Alert>

      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {!v && !error && <Loading label={t('Cargando límites y consumo…')} />}

      {v && (
        <>
          <section className="card" aria-labelledby="lim-consumo">
            <h2 id="lim-consumo">{t('Consumo de esta organización')}</h2>
            <dl className="props">
              <dt>{t('Almacenamiento usado')}</dt>
              <dd>
                <strong>{kb(v.usage.stored_bytes)}</strong> {t('de')} {kb(v.usage.quota_bytes)}
                <div className="muted">{v.usage.quota_note}</div>
              </dd>
              <dt>{t('Documentos y versiones')}</dt><dd>{t('{d} documentos · {v} versiones', { d: v.usage.documents, v: v.usage.document_versions })}</dd>
              <dt>{t('Parcelas')}</dt><dd>{v.usage.plots}</dd>
              <dt>{t('Entregas')}</dt><dd>{v.usage.deliveries}</dd>
              <dt>{t('Eventos de dominio')}</dt><dd>{v.usage.events}</dd>
            </dl>
            <p className="muted">{v.cost_note}</p>
          </section>

          <section className="card" aria-labelledby="lim-tabla">
            <h2 id="lim-tabla">{t('Límites vigentes')}</h2>
            <p className="muted">{t('Superar un límite se rechaza con una explicación y no genera ningún sobrecoste automático.')}</p>
            <div className="table-wrap"><table aria-label={t('Límites vigentes del producto')}>
              <thead><tr>
                <th scope="col">{t('Límite')}</th><th scope="col">{t('Valor')}</th><th scope="col">{t('Qué limita')}</th>
                <th scope="col">{t('De dónde sale')}</th><th scope="col">{t('Dónde se aplica')}</th><th scope="col">{t('Al superarlo')}</th>
              </tr></thead>
              <tbody>{v.limits.map((l) => (
                <tr key={l.code}>
                  <td>{l.label}<div className="muted"><code>{l.code}</code></div></td>
                  <td><strong>{typeof l.value === 'number' && l.unit === 'bytes' ? kb(l.value) : l.value}</strong>
                    {l.unit !== 'bytes' ? <div className="muted">{l.unit}</div> : null}</td>
                  <td className="muted">{l.what}</td>
                  <td className="muted">{l.source}</td>
                  <td className="muted">{l.enforced_at}</td>
                  <td className="muted">{l.on_exceed}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <p className="muted">{v.note}</p>
          </section>

          <section className="card" aria-labelledby="lim-idioma">
            <h2 id="lim-idioma">{t('Idioma, coste y acceso')}</h2>
            <dl className="props">
              <dt>{t('Idiomas de la interfaz')}</dt>
              <dd><StatusBadge tone="valid">{v.language.primary}</StatusBadge> <span className="muted">{t('disponibles')}: {v.language.available.join(', ')}</span></dd>
              <dt>{t('Coste de la plataforma')}</dt>
              <dd><StatusBadge tone="neutral">{v.cost.currency}</StatusBadge> <span className="muted">{v.cost.unit === 'ORGANIZACION_MES' ? t('por organización y mes, con tarifa declarada') : v.cost.unit}</span></dd>
              <dt>{t('Inicio de sesión')}</dt>
              <dd>
                <StatusBadge tone="neutral">{t('contraseña')}</StatusBadge>{' '}
                <StatusBadge tone={v.sso.enabled ? 'valid' : 'neutral'}>{v.sso.enabled ? t('acceso federado habilitado') : t('acceso federado deshabilitado')}</StatusBadge>
              </dd>
            </dl>
            <p className="muted">{v.language.note}</p>
            <p className="muted">{v.cost.note}</p>
            <p className="muted">{v.sso_note}</p>
            <p className="muted">
              {t('Decisiones registradas como D-54 con los ADR 0007, 0008 y 0009. El piloto sigue pendiente: estas capacidades no cierran por sí solas la historia.')}
            </p>
          </section>
        </>
      )}
    </>
  );
}
