'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { LanguageSwitcher, useI18n } from '../../lib/i18n';
import { useWorkspace } from '../../lib/workspace';
import { Alert, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../lib/ui';

// Mi cuenta (P1-015 / D-54): idioma de la interfaz y vínculo de la identidad corporativa (OIDC).
//   · El vínculo es por EMISOR + SUJETO, nunca por correo, y se establece desde la propia sesión de la persona.
//   · Una identidad externa no concede organización, rol ni permisos: eso lo siguen decidiendo las membresías.
interface Vinculo { id: string; issuer: string; subject_hint: string; email_claim: string | null; created_at: string; last_login_at: string | null }

export default function CuentaPage() {
  const ws = useWorkspace();
  const { t } = useI18n();
  const [cfg, setCfg] = useState<{ enabled: boolean; label: string | null } | null>(null);
  const [links, setLinks] = useState<Vinculo[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [c, l] = await Promise.all([
        api<{ enabled: boolean; label: string | null }>('/api/v1/auth/sso/config'),
        api<{ links: Vinculo[] }>('/api/v1/auth/sso/links'),
      ]);
      setCfg(c);
      setLinks(l.links);
    } catch (err) { setError(err as ApiError); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  async function vincular() {
    setBusy(true);
    try {
      const r = await api<{ authorization_url: string }>('/api/v1/auth/sso/start', {
        method: 'POST', body: { redirect_uri: `${window.location.origin}/acceso/sso`, mode: 'LINK' },
      });
      window.location.assign(r.authorization_url);
    } catch (err) { setBusy(false); setError(err as ApiError); }
  }
  async function desvincular(id: string) {
    setBusy(true);
    try { await api(`/api/v1/auth/sso/links/${id}`, { method: 'DELETE' }); await cargar(); }
    catch (err) { setError(err as ApiError); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title={t('Mi cuenta')} meta={<span>{ws.me.email}</span>} />

      <section className="card" aria-labelledby="cta-idioma">
        <h2 id="cta-idioma">{t('Idioma de la interfaz')}</h2>
        <p className="muted">{t('El español es la lengua fuente. Las traducciones de la interfaz no son traducciones jurídicas certificadas, y los documentos y evidencias originales se conservan tal como se aportaron.')}</p>
        <LanguageSwitcher />
      </section>

      <section className="card" aria-labelledby="cta-sso">
        <h2 id="cta-sso">{t('Identidad corporativa (acceso federado)')}</h2>
        {error && <ErrorPanel error={error} onRetry={cargar} />}
        {!cfg && !error && <Loading label={t('Cargando…')} />}
        {cfg && !cfg.enabled && (
          <Alert tone="info" title={t('El acceso federado no está habilitado en este despliegue.')}>
            <p>{t('Entras con tu correo y contraseña. No hay conectado ningún proveedor de identidad de un cliente.')}</p>
          </Alert>
        )}
        {cfg?.enabled && links && (
          <>
            <Alert tone="info" title={t('Qué hace y qué no hace el vínculo')}>
              <p>{t('Vincula tu identidad del proveedor a esta cuenta por emisor y sujeto, no por correo. No concede organización, rol ni permisos: eso lo siguen decidiendo tus membresías. Tu acceso con contraseña sigue disponible.')}</p>
            </Alert>
            {links.length === 0 ? (
              <p>{t('No tienes ninguna identidad vinculada.')}</p>
            ) : (
              <div className="table-wrap"><table aria-label={t('Identidades vinculadas')}>
                <thead><tr><th scope="col">{t('Proveedor')}</th><th scope="col">{t('Sujeto')}</th><th scope="col">{t('Vinculada')}</th><th scope="col">{t('Último acceso')}</th><th scope="col"><span className="visually-hidden">{t('Acciones')}</span></th></tr></thead>
                <tbody>{links.map((l) => (
                  <tr key={l.id}>
                    <td><code>{l.issuer}</code></td>
                    <td><code>{l.subject_hint}</code></td>
                    <td>{new Date(l.created_at).toLocaleString()}</td>
                    <td>{l.last_login_at ? new Date(l.last_login_at).toLocaleString() : t('Nunca')}</td>
                    <td><button type="button" className="secondary inline" disabled={busy} onClick={() => void desvincular(l.id)}>{t('Desvincular')}</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            {links.length === 0 && (
              <div className="actions">
                <button type="button" disabled={busy} onClick={() => void vincular()}>{t('Vincular {proveedor}', { proveedor: cfg.label ?? t('acceso corporativo') })}</button>
                <StatusBadge tone="neutral">{t('Authorization Code + PKCE')}</StatusBadge>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
