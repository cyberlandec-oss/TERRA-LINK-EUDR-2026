'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, recoveryHint } from '../../../../lib/api';
import { useI18n } from '../../../../lib/i18n';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge, type Tone } from '../../../../lib/ui';

// D-04 · Acceso de plataforma a una organización (elevación supervisada).
//
// Lo que esta pantalla no puede dejar de decir:
//   · la administración de plataforma NO tiene acceso implícito: pide un acceso acotado, con motivo, alcance y duración máxima de 15 minutos;
//   · solo lo puede aprobar quien administra la organización afectada (nunca quien lo solicita);
//   · hoy el acceso es de SOLO LECTURA de miembros; no abre datos operativos ni sensibles;
//   · la organización ve quién pidió qué, si se aprobó y cuántas veces se usó.

interface Elevacion {
  id: string; status: string; purpose: string; scope_note: string; actions: string[];
  requested_by_name?: string; approved_by_name?: string | null; created_at?: string; expires_at?: string | null; usos?: number;
}

const ESTADO: Record<string, { tono: Tone; texto: string }> = {
  PENDING: { tono: 'review', texto: 'Pendiente de aprobación' },
  APPROVED: { tono: 'valid', texto: 'Aprobado y vigente' },
  REJECTED: { tono: 'blocked', texto: 'Rechazado' },
  REVOKED: { tono: 'blocked', texto: 'Revocado' },
  EXPIRED: { tono: 'neutral', texto: 'Vencido' },
  ENDED: { tono: 'neutral', texto: 'Finalizado' },
};
const ACCION: Record<string, string> = { 'members:read': 'Ver los miembros de la organización (solo lectura)' };
const fecha = (s?: string | null) => (s ? new Date(s).toLocaleString() : '—');

export default function AccesoPlataformaPage() {
  const ws = useWorkspace();
  const { t } = useI18n();
  const orgId = ws.activeOrg?.id;
  const base = `/api/v1/organizations/${orgId}/platform-elevations`;
  const puedeDecidir = ws.can('membership:assign');
  const [filas, setFilas] = useState<Elevacion[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const cargar = useCallback(async () => {
    if (!orgId || !ws.can('membership:read')) return;
    setError(null);
    try { setFilas((await api<{ elevations: Elevacion[] }>(`/api/v1/organizations/${orgId}/platform-elevations`)).elevations); }
    catch (e) { setError(e as ApiError); }
  }, [orgId, ws]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!ws.activeOrg) {
    return <ErrorPanel error={new ApiError(404, { code: 'NOT_FOUND', message: 'El recurso no existe o no está disponible para ti.', request_id: null })} />;
  }
  const migas = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Acceso de plataforma') }];

  return (
    <>
      <Breadcrumb items={migas} />
      <PageHeader title={t('Acceso de plataforma')} meta={ws.activeOrg.name} />
      <Alert tone="info" title={t('Qué es y qué no es esto')}>
        <p>{t('La administración de la plataforma no entra a los datos de una organización por defecto. Puede pedir un acceso acotado, con motivo y alcance, de hasta 15 minutos. Lo aprueba quien administra la organización, nunca quien lo solicita, y queda registrado. Hoy el acceso es solo de lectura de miembros.')}</p>
      </Alert>

      {ws.isPlatformAdmin && <Solicitar base={base} orgId={orgId!} />}

      {ws.can('membership:read') && (
        <section className="card" aria-labelledby="ap-lista">
          <h2 id="ap-lista">{t('Solicitudes y accesos sobre esta organización')}</h2>
          {error ? <ErrorPanel error={error} onRetry={cargar} />
            : !filas ? <Loading label={t('Cargando solicitudes…')} />
            : filas.length === 0 ? <EmptyState title={t('No hay solicitudes de acceso de plataforma.')}><p>{t('Cuando la plataforma pida un acceso, aparecerá aquí para que lo decidas.')}</p></EmptyState>
            : (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">{t('Solicitudes de acceso de plataforma')}</caption>
                  <thead><tr><th>{t('Estado')}</th><th>{t('Solicitó')}</th><th>{t('Motivo y alcance')}</th><th>{t('Vigencia')}</th><th>{t('Usos')}</th><th>{t('Acción')}</th></tr></thead>
                  <tbody>
                    {filas.map((f) => {
                      const e = ESTADO[f.status] ?? { tono: 'neutral' as Tone, texto: f.status };
                      return (
                        <tr key={f.id}>
                          <td><StatusBadge tone={e.tono}>{t(e.texto)}</StatusBadge></td>
                          <td>{f.requested_by_name}<br /><small>{fecha(f.created_at)}</small></td>
                          <td>{f.purpose}<br /><small>{f.scope_note} · {f.actions.map((a) => t(ACCION[a] ?? a)).join(', ')}</small></td>
                          <td>{f.status === 'APPROVED' ? <>{t('Hasta')} {fecha(f.expires_at)}<br /><small>{t('Aprobó')}: {f.approved_by_name}</small></> : '—'}</td>
                          <td>{f.usos ?? 0}</td>
                          <td>{puedeDecidir && (f.status === 'PENDING' || f.status === 'APPROVED')
                            ? <Decision base={base} id={f.id} estado={f.status} onDone={cargar} />
                            : <small>{puedeDecidir ? '—' : t('Solo quien administra la organización decide.')}</small>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      )}

      {!ws.isPlatformAdmin && !ws.can('membership:read') && (
        <Alert tone="review" title={t('Sin acceso a esta pantalla')}><p>{t('Ver las solicitudes de acceso de plataforma requiere administrar los miembros de la organización.')}</p></Alert>
      )}
    </>
  );
}

function Decision({ base, id, estado, onDone }: { base: string; id: string; estado: string; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const [abierta, setAbierta] = useState<null | 'approve' | 'reject' | 'revoke'>(null);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const op = useRef<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!abierta || motivo.trim().length < 3) return;
    op.current ??= crypto.randomUUID(); // un reintento tras un fallo de red no repite la decisión
    setBusy(true); setError(null);
    try {
      await api(`${base}/${id}/${abierta}`, { method: 'POST', body: { operation_id: op.current, reason: motivo.trim() } });
      op.current = null; setAbierta(null); setMotivo(''); await onDone();
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }

  if (!abierta) {
    return (
      <div className="row">
        {estado === 'PENDING' && <button type="button" className="secondary inline" onClick={() => setAbierta('approve')}>{t('Aprobar')}</button>}
        {estado === 'PENDING' && <button type="button" className="secondary inline" onClick={() => setAbierta('reject')}>{t('Rechazar')}</button>}
        {estado === 'APPROVED' && <button type="button" className="secondary inline" onClick={() => setAbierta('revoke')}>{t('Revocar')}</button>}
      </div>
    );
  }
  const titulo = abierta === 'approve' ? t('Motivo de la aprobación') : abierta === 'reject' ? t('Motivo del rechazo') : t('Motivo de la revocación');
  return (
    <form onSubmit={enviar} className="stack" aria-label={titulo}>
      <label htmlFor={`dc-${id}`}>{titulo}</label>
      <input id={`dc-${id}`} required minLength={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      {error && <Alert tone="blocked" title={error.message}><p>{recoveryHint(error)}</p></Alert>}
      <div className="row">
        <button type="submit" disabled={busy || motivo.trim().length < 3} aria-busy={busy}>{busy ? t('Enviando…') : t('Confirmar')}</button>
        <button type="button" className="secondary" onClick={() => { setAbierta(null); setError(null); }} disabled={busy}>{t('Cancelar')}</button>
      </div>
    </form>
  );
}

function Solicitar({ base, orgId }: { base: string; orgId: string }) {
  const { t } = useI18n();
  const [purpose, setPurpose] = useState('');
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState('');
  const [minutos, setMinutos] = useState(15);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [creada, setCreada] = useState<Elevacion | null>(null);
  const op = useRef<string | null>(null);
  const completo = purpose.trim().length >= 3 && reason.trim().length >= 3 && scope.trim().length >= 3 && password.length >= 8;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!completo) return;
    op.current ??= crypto.randomUUID();
    setBusy(true); setError(null);
    try {
      const r = await api<{ elevation: Elevacion }>(base, { method: 'POST', body: {
        operation_id: op.current, password, purpose: purpose.trim(), reason: reason.trim(), scope_note: scope.trim(), actions: ['members:read'], duration_seconds: minutos * 60,
      } });
      op.current = null; setPassword(''); setCreada(r.elevation);
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }
  async function terminar() {
    if (!creada) return;
    setBusy(true); setError(null);
    try { await api(`${base}/${creada.id}/end`, { method: 'POST', body: {} }); setCreada({ ...creada, status: 'ENDED' }); }
    catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }

  return (
    <section className="card" aria-labelledby="ap-solicitar">
      <h2 id="ap-solicitar">{t('Solicitar acceso a esta organización')}</h2>
      {creada ? (
        <>
          <Alert tone={creada.status === 'ENDED' ? 'info' : 'review'} title={creada.status === 'ENDED' ? t('Acceso finalizado') : t('Solicitud enviada: pendiente de aprobación')}>
            <p>{creada.status === 'ENDED'
              ? t('Finalizaste el acceso antes de su vencimiento.')
              : t('Quien administra la organización debe aprobarla. Mientras tanto no tienes acceso. Una vez aprobada, podrás ver los miembros hasta que venza.')}</p>
          </Alert>
          <p><StatusBadge tone={(ESTADO[creada.status] ?? ESTADO.PENDING).tono}>{t((ESTADO[creada.status] ?? ESTADO.PENDING).texto)}</StatusBadge></p>
          <div className="row">
            <Link href={`/organizaciones/${orgId}/miembros`}>{t('Ir a Miembros e invitaciones')}</Link>
            {creada.status !== 'ENDED' && <button type="button" className="secondary" onClick={terminar} disabled={busy}>{t('Finalizar el acceso ahora')}</button>}
          </div>
          {error && <Alert tone="blocked" title={error.message}><p>{recoveryHint(error)}</p></Alert>}
        </>
      ) : (
        <form onSubmit={enviar} className="stack" aria-label={t('Solicitar acceso a esta organización')}>
          <label htmlFor="ap-prop">{t('Para qué lo necesitas')}</label>
          <input id="ap-prop" required minLength={3} maxLength={200} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          <label htmlFor="ap-mot">{t('Motivo')}</label>
          <input id="ap-mot" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <label htmlFor="ap-alc">{t('Recursos o ámbito concreto')}</label>
          <input id="ap-alc" required minLength={3} maxLength={500} value={scope} onChange={(e) => setScope(e.target.value)} />
          <fieldset>
            <legend>{t('Qué podrás hacer')}</legend>
            <label><input type="checkbox" checked disabled readOnly /> {t(ACCION['members:read'])}</label>
          </fieldset>
          <label htmlFor="ap-min">{t('Duración')}</label>
          <select id="ap-min" value={minutos} onChange={(e) => setMinutos(Number(e.target.value))}>
            {[5, 10, 15].map((m) => <option key={m} value={m}>{m} {t('minutos')}</option>)}
          </select>
          <label htmlFor="ap-pw">{t('Tu contraseña (se comprueba de nuevo)')}</label>
          <input id="ap-pw" type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <Alert tone="blocked" title={error.message}><p>{recoveryHint(error)}</p></Alert>}
          <div className="row"><button type="submit" disabled={busy || !completo} aria-busy={busy}>{busy ? t('Enviando…') : t('Enviar solicitud')}</button></div>
        </form>
      )}
    </section>
  );
}
