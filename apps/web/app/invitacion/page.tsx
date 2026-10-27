'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, ROLE_LABELS, api, session, tokenFromHash } from '../../lib/api';
import { Alert, ErrorPanel, Loading } from '../../lib/ui';

interface Preview {
  organization_name: string;
  email: string;
  role_code: string;
  expires_at: string;
  requires_login: boolean;
  signed_in_as_recipient: boolean;
}

// Aceptación de invitación. El token llega en el fragmento (#token=…) y solo se envía en el cuerpo
// de POST a la API; se borra de la barra de direcciones al leerlo.
export default function InvitationPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const t = tokenFromHash(window.location.hash);
    history.replaceState(null, '', window.location.pathname);
    if (!t) {
      setError(new ApiError(400, { code: 'INVITATION_LINK_INVALID', message: 'El enlace de invitación está incompleto o dañado.', request_id: null }));
      return;
    }
    setToken(t);
    api<Preview>('/api/v1/invitations/preview', { method: 'POST', body: { token: t } })
      .then(setPreview)
      .catch((err) => setError(err as ApiError));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token || !preview) return;
    setFormError(null);
    if (!preview.requires_login && form.password !== form.confirm) {
      setFormError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    try {
      const body = preview.requires_login
        ? { token }
        : { token, first_name: form.first_name, last_name: form.last_name, password: form.password };
      const res = await api<{ organization_id: string; session: { access_token: string } }>('/api/v1/invitations/accept', { method: 'POST', body });
      session.set(res.session.access_token);
      router.push(`/organizaciones/${res.organization_id}`);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }) });

  return (
    <main className="tl-access"><div className="tl-access-card">
    <p className="tl-access-brand" aria-label="Terra Link">TERRA LINK</p>
    <section className="card">
      <h1>Invitación</h1>
      {error && (
        <>
          <ErrorPanel error={error} />
          <Link href="/">Ir a iniciar sesión</Link>
        </>
      )}
      {!preview && !error && <Loading label="Comprobando invitación…" />}
      {preview && (
        <>
          <p>
            Te invitaron a <strong>{preview.organization_name}</strong> como <strong>{ROLE_LABELS[preview.role_code] ?? preview.role_code}</strong>.
          </p>
          <p className="muted">Correo invitado: {preview.email} · vence {new Date(preview.expires_at).toLocaleString('es-EC')}</p>
          {preview.requires_login && !preview.signed_in_as_recipient ? (
            <Alert tone="info" title="Ya existe una cuenta con este correo.">
              <p><Link href="/">Inicia sesión</Link> con ella y vuelve a abrir el enlace para aceptar.</p>
            </Alert>
          ) : (
            <form onSubmit={submit}>
              {!preview.requires_login && (
                <>
                  <label htmlFor="first">Nombre</label><input id="first" required {...field('first_name')} />
                  <label htmlFor="last">Apellido</label><input id="last" required {...field('last_name')} />
                  <label htmlFor="pass">Contraseña (mínimo 12 caracteres)</label>
                  <input id="pass" type="password" autoComplete="new-password" required minLength={12} {...field('password')} />
                  <label htmlFor="confirm">Repite la contraseña</label>
                  <input id="confirm" type="password" autoComplete="new-password" required minLength={12} {...field('confirm')} />
                </>
              )}
              {formError && <p className="error" role="alert">{formError}</p>}
              <button type="submit" disabled={busy}>{busy ? 'Aceptando…' : 'Aceptar invitación'}</button>
            </form>
          )}
        </>
      )}
    </section>
    </div></main>
  );
}
