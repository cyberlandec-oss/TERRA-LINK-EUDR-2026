'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ApiError, api, session } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n';

// Retorno del proveedor de identidad (OIDC Authorization Code + PKCE). La página solo reenvía `code` y `state` a la
// API —que verifica el protocolo— y guarda el testigo que esta devuelve. Una identidad sin vínculo se rechaza: no se
// vincula nunca por correo.
type Estado = { kind: 'working' } | { kind: 'error'; title: string; detail: string; code: string } | { kind: 'linked' };

export default function SsoRetorno() {
  const router = useRouter();
  const { t } = useI18n();
  const [estado, setEstado] = useState<Estado>({ kind: 'working' });
  const hecho = useRef(false);

  useEffect(() => {
    if (hecho.current) return; // el state es de un solo uso: no se envía dos veces
    hecho.current = true;
    const p = new URLSearchParams(window.location.search);
    const code = p.get('code');
    const state = p.get('state');
    const iss = p.get('iss'); // RFC 9207: el emisor que devuelve el proveedor; la API lo verifica
    const proveedorError = p.get('error');
    // Se limpia la barra de direcciones: el código no debe quedar en el historial.
    window.history.replaceState(null, '', window.location.pathname);
    if (proveedorError || !code || !state) {
      setEstado({ kind: 'error', code: 'SSO_PROVIDER_ERROR', title: t('El proveedor de acceso no completó el inicio de sesión.'), detail: t('Puedes intentarlo de nuevo o entrar con tu correo y contraseña.') });
      return;
    }
    api<{ mode: 'LOGIN' | 'LINK'; access_token?: string }>('/api/v1/auth/sso/callback', { method: 'POST', body: { code, state, ...(iss ? { iss } : {}) } })
      .then((r) => {
        if (r.mode === 'LINK') { setEstado({ kind: 'linked' }); return; }
        if (r.access_token) session.set(r.access_token);
        router.replace('/organizaciones');
      })
      .catch((err: unknown) => {
        const e = err instanceof ApiError ? err : null;
        const code2 = e?.body.code ?? 'ERROR';
        const mapa: Record<string, [string, string]> = {
          SSO_IDENTITY_NOT_LINKED: ['Tu identidad corporativa no está vinculada a ninguna cuenta.', 'Entra con tu correo y contraseña y vincúlala desde «Mi cuenta». El correo no vincula cuentas automáticamente.'],
          SSO_ACCOUNT_DISABLED: ['Esta cuenta está deshabilitada.', 'Contacta con el administrador de tu organización.'],
          SSO_FLOW_INVALID: ['El inicio de sesión venció o ya se usó.', 'Empieza de nuevo desde la pantalla de acceso.'],
          SSO_PROTOCOL_ERROR: ['No se pudo verificar la respuesta del proveedor de acceso.', 'Inténtalo de nuevo; si persiste, entra con contraseña.'],
          SSO_IDENTITY_ALREADY_LINKED: ['Esa identidad ya está vinculada a otra cuenta.', 'Una identidad corporativa solo puede estar en una cuenta.'],
          SSO_USER_ALREADY_LINKED: ['Tu cuenta ya tiene una identidad vinculada con este proveedor.', 'Desvincúlala primero en «Mi cuenta».'],
        };
        const m = mapa[code2];
        setEstado({ kind: 'error', code: code2, title: t(m ? m[0] : 'No pudimos completar el acceso corporativo.'), detail: m ? t(m[1]) : (e?.message ?? '') });
      });
  }, [router, t]);

  return (
    <main className="tl-access">
      <div className="tl-access-card">
        <p className="tl-access-brand" aria-label="Terra Link">TERRA LINK</p>
        <section className="card" aria-live="polite">
          {estado.kind === 'working' && (<><h1>{t('Verificando tu acceso…')}</h1><p className="muted">{t('Estamos comprobando la respuesta del proveedor de identidad.')}</p></>)}
          {estado.kind === 'linked' && (
            <>
              <h1>{t('Identidad vinculada')}</h1>
              <p>{t('Tu identidad corporativa quedó vinculada a tu cuenta. Tu acceso con contraseña sigue disponible.')}</p>
              <p><Link href="/cuenta">{t('Volver a Mi cuenta')}</Link></p>
            </>
          )}
          {estado.kind === 'error' && (
            <div className="error" role="alert" data-code={estado.code}>
              <p className="alert-title">{estado.title}</p>
              {estado.detail && <p>{estado.detail}</p>}
              <p><Link href="/">{t('Volver al acceso')}</Link></p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
