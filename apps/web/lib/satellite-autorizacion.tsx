'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, apiDownload } from './api';
import { useI18n } from './i18n';
import { useWorkspace } from './workspace';
import { ResultadoDelAnalisis, SAT_OPERATION, SAT_STATUS, type Job, type Result } from './satellite';
import { Alert, EmptyState, ErrorPanel, StatusBadge, type Tone } from './ui';

// Recorrido Productor → exportadora. Dos superficies, una por lado de la autorización:
// - `AutorizarAnalisisPanel` (organización PROPIETARIA, dentro de la tarjeta de la parcela): autoriza y revoca que otra organización analice ESA parcela.
// - `AnalisisAutorizadosPanel` (organización DESTINATARIA, p. ej. la exportadora): ve solo las parcelas autorizadas —sin coordenadas ni productor— y
//   solicita, sigue, cancela y descarga sus análisis.
// La pantalla no concede nada: el servidor decide cada acción. Un resultado es un insumo del proveedor con límites declarados; no certifica ni da READY.

interface Autorizacion {
  id: string;
  grantee: { id: string; name: string };
  can_download: boolean;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  expires_at: string;
  reason: string;
  created_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
}
interface Vinculo { id: string; status: string; counterpart_organization_id: string | null; counterpart_name: string | null }

const AUT_ESTADO: Record<Autorizacion['status'], { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Vigente', tone: 'valid' },
  EXPIRED: { label: 'Vencida', tone: 'neutral' },
  REVOKED: { label: 'Revocada', tone: 'blocked' },
};
const PLAZOS = [30, 90, 180];

export function AutorizarAnalisisPanel({ orgId, plotId }: { orgId: string; plotId: string }) {
  const { t, dt } = useI18n();
  const ws = useWorkspace();
  const puede = ws.can('satellite:authorize');
  const base = `/api/v1/organizations/${orgId}`;
  const [autorizaciones, setAutorizaciones] = useState<Autorizacion[] | null>(null);
  const [vinculos, setVinculos] = useState<Vinculo[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [destino, setDestino] = useState('');
  const [dias, setDias] = useState(90);
  const [descarga, setDescarga] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [revocando, setRevocando] = useState<string | null>(null);
  const [motivoRevoca, setMotivoRevoca] = useState('');

  const cargar = useCallback(async () => {
    if (!puede || !orgId) return;
    try {
      setAutorizaciones((await api<{ authorizations: Autorizacion[] }>(`${base}/plots/${plotId}/satellite/authorizations`)).authorizations);
      // Los destinatarios posibles son las organizaciones ya vinculadas (Traspasos): no se expone un directorio de organizaciones.
      try { setVinculos((await api<{ items: Vinculo[] }>(`${base}/partnerships`)).items.filter((v) => v.status === 'ACTIVE' && v.counterpart_organization_id)); } catch { setVinculos([]); }
      setError(null);
    } catch (e) { setError(e as ApiError); }
  }, [base, orgId, plotId, puede]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!puede) return null;

  const autorizar = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true); setError(null);
    try {
      await api(`${base}/plots/${plotId}/satellite/authorizations`, {
        method: 'POST',
        body: { operation_id: crypto.randomUUID(), grantee_organization_id: destino, can_download: descarga, expires_at: new Date(Date.now() + dias * 86400000).toISOString(), reason: motivo.trim() },
      });
      setMotivo(''); setDescarga(false);
      await cargar();
    } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  };
  const revocar = async (id: string) => {
    setBusy(true); setError(null);
    try {
      await api(`${base}/satellite/authorizations/${id}/revoke`, { method: 'POST', body: { reason: motivoRevoca.trim() } });
      setRevocando(null); setMotivoRevoca('');
      await cargar();
    } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  };

  return (
    <section className="card" aria-labelledby="sat-aut-title">
      <h2 id="sat-aut-title">{t('Autorizar el análisis a otra organización')}</h2>
      <p className="muted">{t('Otra organización (por ejemplo, la exportadora) solo puede analizar esta parcela si la autorizas aquí. La autorización es explícita, vence y se puede revocar; no le da acceso a la parcela, a sus coordenadas ni al productor. La parcela sigue siendo tuya.')}</p>
      {error && <ErrorPanel error={error} onRetry={cargar} />}
      <form onSubmit={(e) => void autorizar(e)} className="form-grid">
        <div>
          <label htmlFor="aut-destino">{t('Organización destinataria')}</label>
          <select id="aut-destino" value={destino} onChange={(e) => setDestino(e.target.value)} required>
            <option value="">{t('Elige una organización vinculada')}</option>
            {vinculos.map((v) => <option key={v.id} value={v.counterpart_organization_id ?? ''}>{v.counterpart_name}</option>)}
          </select>
          {vinculos.length === 0 && <p className="muted">{t('No hay organizaciones vinculadas. Vincúlala primero desde Traspasos.')}</p>}
        </div>
        <div>
          <label htmlFor="aut-dias">{t('Vigencia')}</label>
          <select id="aut-dias" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            {PLAZOS.map((d) => <option key={d} value={d}>{t('{n} días', { n: d })}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="aut-motivo">{t('Motivo')}</label>
          <input id="aut-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={3} maxLength={500} required />
        </div>
        <div>
          <label><input type="checkbox" checked={descarga} onChange={(e) => setDescarga(e.target.checked)} /> {t('Permitir descargar la respuesta original (contiene la geometría enviada)')}</label>
        </div>
        <div className="actions">
          <button type="submit" disabled={busy || !destino || motivo.trim().length < 3}>{t('Autorizar')}</button>
        </div>
      </form>
      {autorizaciones && autorizaciones.length > 0 && (
        <table aria-label={t('Autorizaciones de esta parcela')}>
          <thead><tr><th scope="col">{t('Organización')}</th><th scope="col">{t('Estado')}</th><th scope="col">{t('Vence')}</th><th scope="col">{t('Descarga original')}</th><th scope="col">{t('Acción')}</th></tr></thead>
          <tbody>
            {autorizaciones.map((a) => (
              <tr key={a.id}>
                <td>{a.grantee.name}<br /><span className="muted">{a.reason}</span></td>
                <td><StatusBadge tone={AUT_ESTADO[a.status].tone}>{t(AUT_ESTADO[a.status].label)}</StatusBadge>{a.revoke_reason && <><br /><span className="muted">{a.revoke_reason}</span></>}</td>
                <td>{dt(a.expires_at)}</td>
                <td>{a.can_download ? t('Sí') : t('No')}</td>
                <td>
                  {a.status === 'ACTIVE' && (revocando === a.id ? (
                    <span>
                      <label htmlFor={`rev-${a.id}`} className="visually-hidden">{t('Motivo de la revocación')}</label>
                      <input id={`rev-${a.id}`} value={motivoRevoca} onChange={(e) => setMotivoRevoca(e.target.value)} placeholder={t('Motivo de la revocación')} />{' '}
                      <button type="button" disabled={busy || motivoRevoca.trim().length < 3} onClick={() => void revocar(a.id)}>{t('Confirmar revocación')}</button>{' '}
                      <button type="button" className="secondary" onClick={() => { setRevocando(null); setMotivoRevoca(''); }}>{t('Cancelar')}</button>
                    </span>
                  ) : <button type="button" className="secondary" onClick={() => setRevocando(a.id)}>{t('Revocar')}</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {autorizaciones && autorizaciones.length === 0 && <p className="muted">{t('Esta parcela no está autorizada a ninguna otra organización.')}</p>}
      <p className="muted">{t('Al revocar se cancelan los análisis pendientes y la otra organización deja de ver los resultados; tú conservas el historial completo.')}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------- destinataria

interface ParcelaAutorizada {
  authorization_id: string;
  plot_code: string;
  owner_organization: { id: string; name: string };
  can_download: boolean;
  expires_at: string;
  reason: string;
  authorized_at: string;
  current_version: { plot_version_id: string; geometry_type: string | null; geometry_hash: string | null } | null;
  has_active_job: boolean;
}
interface EstadoParcela {
  authorization_id: string;
  can_request: boolean;
  request_blocked_reason: string | null;
  can_download: boolean;
  supported_operations: string[];
  jobs: Job[];
}

export function AnalisisAutorizadosPanel({ orgId }: { orgId: string }) {
  const { t, dt } = useI18n();
  const ws = useWorkspace();
  const base = `/api/v1/organizations/${orgId}/satellite`;
  const [parcelas, setParcelas] = useState<ParcelaAutorizada[] | null>(null);
  const [limites, setLimites] = useState<string[]>([]);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoParcela | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    if (!orgId) return;
    try {
      const r = await api<{ authorized_plots: ParcelaAutorizada[]; limits: string[] }>(`${base}/authorized-plots`);
      setParcelas(r.authorized_plots); setLimites(r.limits); setError(null);
    } catch (e) { setError(e as ApiError); }
  }, [base, orgId]);
  useEffect(() => { void cargar(); }, [cargar]);

  const abrir = useCallback(async (id: string) => {
    try {
      setEstado(await api<EstadoParcela>(`${base}/authorized-plots/${id}`)); setError(null);
    } catch (e) { setError(e as ApiError); await cargar(); }
  }, [base, cargar]);
  useEffect(() => { if (abierta) void abrir(abierta); }, [abierta, abrir]);

  // Mientras haya un encargo en curso la lista se actualiza sola (el análisis corre fuera de la petición).
  const enCurso = !!estado?.jobs.some((j) => j.status === 'REQUESTED' || j.status === 'RUNNING');
  useEffect(() => {
    if (!enCurso || !abierta) return;
    const id = setInterval(() => { void abrir(abierta); }, 3000);
    return () => clearInterval(id);
  }, [enCurso, abierta, abrir]);

  const accion = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); if (abierta) await abrir(abierta); } catch (e) { setError(e as ApiError); } finally { setBusy(false); }
  };
  const solicitar = (auth: string, operation: string) => accion(() => api(`${base}/authorized-plots/${auth}/analyses`, { method: 'POST', body: { operation_id: crypto.randomUUID(), operation } }));
  const cancelar = (id: string) => accion(() => api(`${base}/authorized-analyses/${id}/cancel`, { method: 'POST', body: { operation_id: crypto.randomUUID(), reason: 'Cancelado desde análisis autorizados' } }));
  const original = (id: string) => accion(() => apiDownload(`${base}/authorized-analyses/${id}/original`, `analisis-${id}.json`));
  const csv = (id: string) => accion(() => apiDownload(`${base}/authorized-analyses/${id}/indicators.csv`, `indicadores-${id}.csv`));

  if (!ws.can('satellite:read')) {
    return <Alert tone="review" title={t('No tienes permiso para consultar análisis satelitales.')}><p>{t('Pide a la administración de tu organización que lo haga o que te conceda el permiso.')}</p></Alert>;
  }

  return (
    <>
      <Alert tone="info" title={t('Solo parcelas que otra organización te autorizó')}>
        <p>{t('Aquí ves únicamente las parcelas que su organización propietaria autorizó a la tuya, por tiempo limitado y revocable. No ves sus coordenadas ni a su productor, y la autorización no te permite modificarlas ni concluir sobre ellas. El análisis usa la credencial de tu organización.')}</p>
      </Alert>
      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {parcelas === null && !error && <p role="status">{t('Cargando…')}</p>}
      {parcelas && parcelas.length === 0 && (
        <EmptyState title={t('Ninguna parcela autorizada.')}>
          <p className="muted">{t('Ninguna organización te ha autorizado parcelas, o las autorizaciones vencieron o se revocaron. Pídela a la organización propietaria.')}</p>
        </EmptyState>
      )}
      {parcelas && parcelas.length > 0 && (
        <table aria-label={t('Parcelas autorizadas')}>
          <thead><tr><th scope="col">{t('Parcela')}</th><th scope="col">{t('Organización propietaria')}</th><th scope="col">{t('Vence')}</th><th scope="col">{t('Descarga original')}</th><th scope="col">{t('Acción')}</th></tr></thead>
          <tbody>
            {parcelas.map((p) => (
              <tr key={p.authorization_id}>
                <td><strong>{p.plot_code}</strong><br /><span className="muted">{p.reason}</span></td>
                <td>{p.owner_organization.name}</td>
                <td>{dt(p.expires_at)}</td>
                <td>{p.can_download ? t('Sí') : t('No')}</td>
                <td><button type="button" className="secondary" aria-expanded={abierta === p.authorization_id} onClick={() => { setEstado(null); setAbierta(abierta === p.authorization_id ? null : p.authorization_id); }}>{abierta === p.authorization_id ? t('Cerrar') : t('Ver análisis')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {abierta && estado && (
        <section className="card" aria-label={t('Análisis de la parcela autorizada')}>
          <h2>{t('Análisis de {c}', { c: parcelas?.find((p) => p.authorization_id === abierta)?.plot_code ?? '' })}</h2>
          {estado.can_request ? (
            <div className="actions">
              {Object.entries(SAT_OPERATION).filter(([code]) => estado.supported_operations.includes(code)).map(([code, label]) => (
                <button key={code} type="button" className="secondary" disabled={busy} onClick={() => void solicitar(abierta, code)}>{t('Solicitar')}: {t(label)}</button>
              ))}
            </div>
          ) : estado.request_blocked_reason && <p className="muted">{t('No se puede solicitar un análisis')}: {t(estado.request_blocked_reason)}</p>}
          {enCurso && <p className="muted" role="status">{t('Hay un análisis en curso: esta tarjeta se actualiza sola.')}</p>}
          {estado.jobs.length === 0 ? <p className="muted">{t('Tu organización no ha solicitado análisis de esta parcela.')}</p> : (
            <ul className="plain">
              {estado.jobs.map((j) => (
                <li key={j.id} className="subcard">
                  <p>
                    {j.is_ensayo && <><StatusBadge tone="review">ENSAYO</StatusBadge>{' '}</>}
                    <StatusBadge tone={SAT_STATUS[j.status].tone}>{t(SAT_STATUS[j.status].label)}</StatusBadge>{' '}
                    {t(SAT_OPERATION[j.operation] ?? j.operation)} · {t('solicitado')} {dt(j.requested_at)}
                    {!j.applies_to_current_version && <> · <StatusBadge tone="review">{t('No corresponde a la versión vigente')}</StatusBadge></>}
                  </p>
                  <p className="muted">{t(j.outcome_note)}</p>
                  {(j.status === 'REQUESTED' || j.status === 'RUNNING') && (
                    <div role="status">
                      {j.progress && <p>{t('Avance informado por el proveedor')}: {j.progress.percent !== null ? <strong>{j.progress.percent} %</strong> : t('sin porcentaje')}{j.progress.note ? ` · ${j.progress.note}` : ''}</p>}
                      {j.cancel_requested
                        ? <p className="muted">{t('Cancelación solicitada el {f}: se confirmará cuando el proveedor la atienda.', { f: dt(j.cancel_requested.at) })}</p>
                        : estado.can_request && <button type="button" className="secondary" disabled={busy} onClick={() => void cancelar(j.id)}>{t('Cancelar este análisis')}</button>}
                    </div>
                  )}
                  {j.result && <ResultadoDelAnalisis j={j as Job & { result: Result }} busy={busy} onDownload={(id) => void original(id)} onDownloadCsv={(id) => void csv(id)} />}
                  {j.status === 'FAILED' && (
                    <div className="error" role="alert">
                      <p className="alert-title">{t('El análisis no produjo resultado.')}</p>
                      <p>{t('Un error no es un resultado favorable ni desfavorable: la parcela sigue sin evaluar.')} {j.error_code && <>{t('Código del fallo')}: <code>{j.error_code}</code></>}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <ul className="muted">{limites.map((l) => <li key={l}>{t(l)}</li>)}</ul>
    </>
  );
}
