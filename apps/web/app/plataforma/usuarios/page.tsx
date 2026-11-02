'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n';
import { useWorkspace } from '../../../lib/workspace';
import { Alert, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../lib/ui';

// Gestión global de cuentas (solo SUPER_ADMIN, `user:deactivate`).
//
// Lo que esta pantalla no puede dejar de decir:
//   · el listado es MÍNIMO a propósito: nombre, estado y organizaciones; sin correo, sin roles y sin datos operativos;
//   · desactivar una cuenta cierra todas sus sesiones al instante y exige un motivo, que queda en la auditoría;
//   · no puedes desactivar tu propia cuenta.

interface Usuario { user_id: string; name: string; status: string; is_platform_admin: boolean; organizations: string[] }

export default function UsuariosPlataformaPage() {
  const ws = useWorkspace();
  const { t } = useI18n();
  const [filas, setFilas] = useState<Usuario[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [errAccion, setErrAccion] = useState<ApiError | null>(null);
  const [abierta, setAbierta] = useState<{ id: string; accion: 'deactivate' | 'reactivate' } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!ws.isPlatformAdmin) return;
    setError(null);
    try { setFilas((await api<{ users: Usuario[] }>('/api/v1/users')).users); }
    catch (e) { setError(e as ApiError); }
  }, [ws.isPlatformAdmin]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (!abierta || motivo.trim().length < 5) return;
    setEnviando(true); setErrAccion(null); setOk(null);
    try {
      await api(`/api/v1/users/${abierta.id}/${abierta.accion}`, { method: 'POST', body: { reason: motivo.trim() } });
      setOk(abierta.accion === 'deactivate' ? 'Cuenta desactivada: sus sesiones se cerraron.' : 'Cuenta reactivada: deberá iniciar sesión de nuevo.');
      setAbierta(null); setMotivo('');
      await cargar();
    } catch (er) { setErrAccion(er as ApiError); }
    finally { setEnviando(false); }
  }

  if (!ws.isPlatformAdmin) {
    return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Esta pantalla es de la administración de la plataforma.', request_id: null })} />;
  }

  return (
    <>
      <PageHeader title={t('Usuarios de la plataforma')} meta={t('Estado de las cuentas y organizaciones a las que pertenecen')} />
      <Alert tone="info" title={t('Qué es y qué no es esto')}>
        <p>{t('El listado es mínimo a propósito: nombre, estado y organizaciones. No muestra correos, roles ni datos operativos. Desactivar una cuenta cierra sus sesiones al instante, exige un motivo y queda en la auditoría.')}</p>
      </Alert>
      {ok && <Alert tone="valid" title={t(ok)}><p>{t('El cambio quedó registrado en la auditoría.')}</p></Alert>}
      {error ? <ErrorPanel error={error} onRetry={cargar} /> : !filas ? <Loading label={t('Cargando usuarios…')} /> : filas.length === 0 ? (
        <EmptyState title={t('No hay usuarios.')}><p>{t('Aparecerán aquí cuando existan cuentas.')}</p></EmptyState>
      ) : (
        <section className="card" aria-labelledby="us-lista">
          <h2 id="us-lista">{t('Cuentas')}</h2>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">{t('Cuentas')}</caption>
              <thead><tr><th>{t('Nombre')}</th><th>{t('Estado')}</th><th>{t('Organizaciones')}</th><th>{t('Acción')}</th></tr></thead>
              <tbody>
                {filas.map((u) => {
                  const activa = u.status === 'ACTIVE';
                  return (
                    <tr key={u.user_id}>
                      <td>{u.name}{u.is_platform_admin && <> <StatusBadge tone="neutral">{t('Plataforma')}</StatusBadge></>}</td>
                      <td><StatusBadge tone={activa ? 'valid' : 'blocked'}>{activa ? t('Activa') : t('Inactiva')}</StatusBadge></td>
                      <td>{u.organizations.length ? u.organizations.join(', ') : '—'}</td>
                      <td>
                        {u.user_id === ws.me.id ? <small>{t('Tu cuenta')}</small> : (
                          <button type="button" className="secondary inline" onClick={() => { setAbierta({ id: u.user_id, accion: activa ? 'deactivate' : 'reactivate' }); setMotivo(''); setErrAccion(null); }}>
                            {activa ? t('Desactivar') : t('Reactivar')}
                          </button>
                        )}
                        {abierta?.id === u.user_id && (
                          <form onSubmit={confirmar} className="stack">
                            <label>{abierta.accion === 'deactivate' ? t('Motivo de la desactivación') : t('Motivo de la reactivación')}
                              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={5} required />
                            </label>
                            {errAccion && <ErrorPanel error={errAccion} />}
                            <button type="submit" disabled={enviando || motivo.trim().length < 5}>{enviando ? t('Enviando…') : t('Confirmar')}</button>
                            <button type="button" className="secondary" onClick={() => setAbierta(null)}>{t('Cancelar')}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
