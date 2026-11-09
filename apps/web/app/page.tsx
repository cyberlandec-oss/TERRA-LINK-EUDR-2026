'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, session } from '../lib/api';
import { LanguageSwitcher, useI18n } from '../lib/i18n';

// UI-01 Acceso (docs/UX_UI.md §10.1). Sin registro público ni recuperación: no están implementados.
// Acceso federado (OIDC con PKCE) solo si el despliegue lo habilita; el acceso con contraseña sigue siempre disponible.
type Mensaje = { title: string; detail: string };

function loginMessage(err: ApiError, t: (es: string, vars?: Record<string, string | number>) => string): Mensaje {
  if (err.body.code === 'TOO_MANY_ATTEMPTS') {
    const retry = Number(err.body.details?.find((d) => d.reason.startsWith('RETRY_AFTER_'))?.reason.slice(12) ?? 0);
    const minutes = Math.max(1, Math.ceil(retry / 60));
    return { title: t('Demasiados intentos.'), detail: t('Por seguridad, espera unos {minutes} min antes de volver a intentarlo.', { minutes }) };
  }
  if (err.status === 503) return { title: t('El inicio de sesión no está disponible temporalmente.'), detail: t('Tus credenciales no se evaluaron. Intenta de nuevo en unos minutos.') };
  if (err.status === 0) return { title: t('Sin conexión con el servidor.'), detail: t('Revisa tu conexión y reintenta.') };
  if (err.status === 401) return { title: t('Correo o contraseña incorrectos.'), detail: t('Revisa los datos e inténtalo de nuevo.') };
  return { title: t('No pudimos iniciar sesión.'), detail: err.message };
}

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<Mensaje | null>(null);
  const [busy, setBusy] = useState(false);
  const [sso, setSso] = useState<{ enabled: boolean; label: string | null } | null>(null);

  useEffect(() => {
    // Si no responde, simplemente no se ofrece el acceso federado: el local no depende de esto.
    api<{ enabled: boolean; label: string | null }>('/api/v1/auth/sso/config').then(setSso).catch(() => setSso(null));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ access_token: string }>('/api/v1/auth/login', { method: 'POST', body: { email, password } });
      session.set(res.access_token);
      router.push('/organizaciones');
    } catch (err) {
      // Se conserva el correo; la contraseña se limpia tras un rechazo.
      setPassword('');
      setError(err instanceof ApiError ? loginMessage(err, t) : { title: t('No pudimos iniciar sesión.'), detail: '' });
    } finally {
      setBusy(false);
    }
  }

  async function entrarConProveedor() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ authorization_url: string }>('/api/v1/auth/sso/start', {
        method: 'POST', body: { redirect_uri: `${window.location.origin}/acceso/sso`, mode: 'LOGIN' },
      });
      window.location.assign(r.authorization_url);
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError
        ? { title: t('No pudimos iniciar el acceso corporativo.'), detail: `${err.message} ${t('Puedes entrar con tu correo y contraseña.')}` }
        : { title: t('No pudimos iniciar el acceso corporativo.'), detail: '' });
    }
  }

  return (
    <main className="tl-access">
      <div className="tl-access-card">
        {/* Identificación textual hasta disponer del lockup oficial (UX-D01). */}
        <p className="tl-access-brand" aria-label="Terra Link">TERRA LINK</p>
        <div className="lang-row"><LanguageSwitcher /></div>
        <section className="card">
          <h1>{t('Iniciar sesión')}</h1>
          <form onSubmit={submit} noValidate={false}>
            <label htmlFor="email">{t('Correo')}</label>
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <label htmlFor="password">{t('Contraseña')}</label>
            <div className="password-row">
              <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="secondary inline" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? t('Ocultar') : t('Mostrar')}
              </button>
            </div>
            {error && (
              <div className="error" role="alert">
                <p className="alert-title">{error.title}</p>
                {error.detail && <p>{error.detail}</p>}
              </div>
            )}
            <button type="submit" disabled={busy} aria-busy={busy}>{busy ? t('Ingresando…') : t('Iniciar sesión')}</button>
          </form>
          {sso?.enabled && (
            <div className="sso-block">
              <p className="muted">{t('o')}</p>
              <button type="button" className="secondary" disabled={busy} onClick={() => void entrarConProveedor()}>
                {t('Entrar con {proveedor}', { proveedor: sso.label ?? t('acceso corporativo') })}
              </button>
              <p className="muted">{t('Tu identidad corporativa debe estar vinculada a tu cuenta. Si no lo está, entra con contraseña y vincúlala en «Mi cuenta».')}</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
