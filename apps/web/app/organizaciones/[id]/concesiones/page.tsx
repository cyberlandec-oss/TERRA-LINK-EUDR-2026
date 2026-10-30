'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useI18n } from '../../../../lib/i18n';
import { useWorkspace } from '../../../../lib/workspace';
import { ESTADOS, TIPOS, type Estado, type Tipo } from '../../../../lib/concesiones';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// A-02 — Administración web de CONCESIONES externas de lectura (RF-49). Reutiliza la API de P0-003/P1-001 y el permiso `grant:manage`;
// la pantalla NO amplía permisos: lo que no se puede compartir en la API no se ofrece aquí, y el servidor decide siempre.
//   · Recursos: solo los de esta organización que quien concede puede leer (`GET …/access-grants/shareable`).
//   · Destinatario: correo EXACTO. No hay buscador, lista ni autocompletado de cuentas u organizaciones; «no existe» y «no disponible» se
//     muestran igual, y los intentos fallidos se limitan en el servidor.
//   · Alcance: lectura de la proyección autorizada (sin identidad de productores, geometrías, documentos personales ni economía);
//     descarga opcional de esa MISMA vista. Compartir no da propiedad ni capacidad de modificar.
//   · Vigencia obligatoria y futura; revocar exige motivo y corta el acceso al instante.

interface Concesion {
  id: string; grantee_email: string; resource_type: Tipo; resource_id: string; resource_label: string | null; can_read: boolean; can_download: boolean; include_documents: boolean;
  expires_at: string; revoked_at: string | null; reason: string; created_at: string; granted_by_name: string | null; revoked_by_name: string | null; revoke_reason: string | null; estado: Estado;
}
interface Compartible { type: Tipo; available: boolean; items: Array<{ id: string; label: string; detail: string }>; note: string | null }

const diasDesdeHoy = (n: number) => { const d = new Date(Date.now() + n * 86400000); d.setHours(23, 59, 0, 0); return d; };
const aFecha = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function ConcesionesPage() {
  const ws = useWorkspace();
  const { t, dt } = useI18n();
  const orgId = ws.activeOrg?.id ?? '';
  const base = `/api/v1/organizations/${orgId}`;
  const [rows, setRows] = useState<Concesion[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [filtro, setFiltro] = useState<'TODAS' | Estado>('TODAS');
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!orgId) return;
    try { setRows((await api<{ grants: Concesion[] }>(`${base}/access-grants`)).grants); setError(null); } catch (e) { setError(e as ApiError); }
  }, [base, orgId]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!ws.activeOrg) return null;
  if (!ws.can('grant:manage')) {
    return (
      <>
        <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Concesiones') }]} />
        <PageHeader title={t('Concesiones')} />
        <Alert tone="review" title={t('No tienes permiso para administrar concesiones.')}><p>{t('Pide a la administración de tu organización que lo haga o que te conceda el permiso.')}</p></Alert>
      </>
    );
  }
  const visibles = (rows ?? []).filter((r) => filtro === 'TODAS' || r.estado === filtro);
  const cuenta = (e: Estado) => (rows ?? []).filter((r) => r.estado === e).length;

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: t('Concesiones') }]} />
      <PageHeader title={t('Concesiones')} meta={<span>{t('Comparte lectura de un recurso concreto con una cuenta externa, con vencimiento y revocable')}</span>} />
      <Alert tone="info" title={t('Qué es una concesión y qué no')}>
        <p>{t('Una concesión permite LEER (y, si lo eliges, descargar) una vista autorizada de UN recurso, durante un tiempo limitado. No crea una membresía, no da propiedad ni capacidad de modificar, y no muestra identidad de productores, geometrías, documentos personales ni datos económicos. No sustituye una declaración ni acredita conformidad.')}</p>
      </Alert>
      {aviso && <Alert tone="valid" title={aviso} />}

      <NuevaConcesion base={base} onDone={async (m) => { setAviso(m); await cargar(); }} />

      <section className="card" aria-labelledby="cn-lista">
        <h2 id="cn-lista">{t('Concesiones de tu organización')}</h2>
        {error && <ErrorPanel error={error} onRetry={cargar} />}
        {!rows && !error && <Loading label={t('Cargando concesiones…')} />}
        {rows && (
          <>
            <div role="group" aria-label={t('Filtrar por estado')} className="actions">
              {(['TODAS', 'ACTIVA', 'VENCIDA', 'REVOCADA'] as const).map((f) => (
                <button key={f} type="button" className={filtro === f ? '' : 'secondary'} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
                  {f === 'TODAS' ? `${t('Todas')} (${rows.length})` : `${t(ESTADOS[f].label)} (${cuenta(f)})`}
                </button>
              ))}
            </div>
            {visibles.length === 0 ? (
              <EmptyState title={rows.length === 0 ? t('Todavía no has concedido ningún acceso.') : t('No hay concesiones con este estado.')} />
            ) : (
              <div className="table-wrap">
                <table aria-label={t('Concesiones')}>
                  <thead><tr><th scope="col">{t('Recurso')}</th><th scope="col">{t('Destinatario')}</th><th scope="col">{t('Alcance')}</th><th scope="col">{t('Vigencia')}</th><th scope="col">{t('Estado')}</th><th scope="col">{t('Historia')}</th><th scope="col"><span className="visually-hidden">{t('Acciones')}</span></th></tr></thead>
                  <tbody>
                    {visibles.map((r) => (
                      <tr key={r.id}>
                        <td>{t(TIPOS[r.resource_type])}<br /><strong>{r.resource_label ?? t('(recurso no disponible)')}</strong></td>
                        <td>{r.grantee_email}</td>
                        <td>{r.can_download ? t('Lectura y descarga de la vista compartida') : t('Solo lectura')}{r.include_documents && <><br />{t('Incluye los soportes de la instantánea (sin datos personales ni geometrías)')}</>}</td>
                        <td>{t('Hasta')} {dt(r.expires_at)}</td>
                        <td><StatusBadge tone={ESTADOS[r.estado].tone}>{t(ESTADOS[r.estado].label)}</StatusBadge></td>
                        <td className="muted">
                          {t('Concedida el {fecha} por {quien}', { fecha: dt(r.created_at), quien: r.granted_by_name ?? t('(persona no disponible)') })}. {t('Motivo')}: {r.reason}
                          {r.revoked_at && <><br />{t('Revocada el {fecha} por {quien}', { fecha: dt(r.revoked_at), quien: r.revoked_by_name ?? t('(persona no disponible)') })}. {t('Motivo')}: {r.revoke_reason}</>}
                        </td>
                        <td>{r.estado === 'ACTIVA' && <Revocar base={base} grant={r} onDone={async () => { setAviso(t('Concesión revocada: el destinatario ya no tiene acceso.')); await cargar(); }} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

function Revocar({ base, grant, onDone }: { base: string; grant: Concesion; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const op = useRef<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    op.current ??= crypto.randomUUID();
    setBusy(true); setError(null);
    try { await api(`${base}/access-grants/${grant.id}/revoke`, { method: 'POST', body: { operation_id: op.current, reason: motivo.trim() } }); op.current = null; await onDone(); }
    catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }
  if (!open) return <button type="button" className="secondary inline" onClick={() => setOpen(true)}>{t('Revocar')}</button>;
  return (
    <form onSubmit={submit} className="stack" aria-label={t('Revocar la concesión de {recurso}', { recurso: grant.resource_label ?? '' })}>
      <p className="muted">{t('El acceso de {correo} se corta al instante y no se reactiva (habría que conceder otra).', { correo: grant.grantee_email })}</p>
      <label htmlFor={`rv-${grant.id}`}>{t('Motivo de la revocación')}</label>
      <input id={`rv-${grant.id}`} required minLength={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      {error && <ErrorPanel error={error} />}
      <div className="actions">
        <button type="submit" disabled={busy || motivo.trim().length < 3} aria-busy={busy}>{busy ? t('Revocando…') : t('Confirmar revocación')}</button>
        <button type="button" className="secondary" onClick={() => setOpen(false)} disabled={busy}>{t('Cancelar')}</button>
      </div>
    </form>
  );
}

function NuevaConcesion({ base, onDone }: { base: string; onDone: (mensaje: string) => Promise<void> }) {
  const { t, dt } = useI18n();
  const [tipo, setTipo] = useState<Tipo>('LOT');
  const [lista, setLista] = useState<Compartible | null>(null);
  const [recurso, setRecurso] = useState('');
  const [correo, setCorreo] = useState('');
  const [descarga, setDescarga] = useState(false);
  const [soportes, setSoportes] = useState(false);
  const [vence, setVence] = useState(aFecha(diasDesdeHoy(7)));
  const [motivo, setMotivo] = useState('');
  const [revision, setRevision] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [errorLista, setErrorLista] = useState<ApiError | null>(null);
  const op = useRef<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setLista(null); setRecurso(''); setRevision(false); setErrorLista(null); setSoportes(false);
    api<Compartible>(`${base}/access-grants/shareable?type=${tipo}`).then((r) => { if (vivo) setLista(r); }).catch((e) => { if (vivo) setErrorLista(e as ApiError); });
    return () => { vivo = false; };
  }, [base, tipo]);

  const elegido = lista?.items.find((i) => i.id === recurso);
  const fechaOk = new Date(`${vence}T23:59:00`).getTime() > Date.now();
  const completo = !!elegido && /^\S+@\S+\.\S+$/.test(correo.trim()) && fechaOk && motivo.trim().length >= 3;
  const cambia = () => { setRevision(false); setError(null); op.current = null; };

  async function otorgar() {
    op.current ??= crypto.randomUUID();
    setBusy(true); setError(null);
    try {
      await api(`${base}/access-grants`, { method: 'POST', body: {
        operation_id: op.current, grantee_email: correo.trim(), resource_type: tipo, resource_id: recurso, can_read: true, can_download: descarga, ...(tipo === 'DD_SNAPSHOT' && soportes ? { include_documents: true } : {}),
        expires_at: new Date(`${vence}T23:59:00`).toISOString(), reason: motivo.trim(),
      } });
      op.current = null; setRevision(false); setRecurso(''); setCorreo(''); setMotivo(''); setDescarga(false); setSoportes(false);
      await onDone(t('Concesión otorgada. El destinatario la ve en «Recursos compartidos contigo».'));
    } catch (e) {
      const err = e as ApiError;
      if (!(err.status === 0 || err.status >= 500)) op.current = null; // un rechazo exige revisar; un corte se reintenta con la misma operación
      setError(err); setRevision(false);
    } finally { setBusy(false); }
  }

  return (
    <section className="card" aria-labelledby="cn-nueva">
      <h2 id="cn-nueva">{t('Nueva concesión')}</h2>
      <ol className="steps" aria-label={t('Pasos')}>
        <li><strong>1.</strong> {t('Recurso')}</li><li><strong>2.</strong> {t('Destinatario')}</li><li><strong>3.</strong> {t('Alcance y vigencia')}</li><li><strong>4.</strong> {t('Revisar y confirmar')}</li>
      </ol>
      <form onSubmit={(e) => { e.preventDefault(); if (completo) setRevision(true); }} className="stack" aria-label={t('Nueva concesión')}>
        <label htmlFor="cn-tipo">{t('Tipo de recurso')}</label>
        <select id="cn-tipo" value={tipo} onChange={(e) => { setTipo(e.target.value as Tipo); cambia(); }}>
          {(Object.keys(TIPOS) as Tipo[]).map((k) => <option key={k} value={k}>{t(TIPOS[k])}</option>)}
        </select>
        {errorLista && <ErrorPanel error={errorLista} />}
        {!lista && !errorLista && <Loading label={t('Cargando recursos que puedes compartir…')} />}
        {lista && !lista.available && <p className="muted" role="status">{t('No puedes compartir este tipo de recurso: no tienes permiso para leerlo.')}</p>}
        {lista?.available && lista.items.length === 0 && <p className="muted" role="status">{t('Esta organización todavía no tiene recursos de este tipo.')}</p>}
        {lista?.available && lista.items.length > 0 && (
          <>
            <label htmlFor="cn-recurso">{t('Recurso a compartir')}</label>
            <select id="cn-recurso" value={recurso} onChange={(e) => { setRecurso(e.target.value); cambia(); }}>
              <option value="">{t('Elige un recurso…')}</option>
              {lista.items.map((i) => <option key={i.id} value={i.id}>{i.label} — {i.detail}</option>)}
            </select>
            {lista.note && <p className="field-help">{t(lista.note)}</p>}
          </>
        )}

        <label htmlFor="cn-correo">{t('Correo exacto de la cuenta destinataria')}</label>
        <input id="cn-correo" type="email" autoComplete="off" value={correo} onChange={(e) => { setCorreo(e.target.value); cambia(); }} placeholder="persona@empresa.com" />
        <p className="field-help">{t('No hay búsqueda ni lista de cuentas: escribe el correo exacto de una cuenta activa que ya existe. Si no se puede identificar, el mensaje es el mismo; los intentos fallidos se limitan y quedan auditados.')}</p>

        <fieldset>
          <legend>{t('Alcance')}</legend>
          <label><input type="checkbox" checked disabled /> {t('Lectura de la vista autorizada (siempre)')}</label>
          <label><input type="checkbox" checked={descarga} onChange={(e) => { setDescarga(e.target.checked); cambia(); }} /> {t('Permitir también descargar esa misma vista (archivo interno, no es un paquete de diligencia)')}</label>
          {tipo === 'DD_SNAPSHOT' && (
            <>
              <label><input type="checkbox" checked={soportes} onChange={(e) => { setSoportes(e.target.checked); cambia(); }} /> {t('Compartir soportes: los documentos que esa instantánea referencia')}</label>
              <p className="field-help">{t('Solo las versiones exactas de ESA instantánea, con su huella; lo que se suba después no se comparte. Se excluyen los documentos de datos personales y las geometrías (de los excluidos solo se informa cuántos son). Para que además pueda descargar los archivos, activa la descarga. Es una vista limitada, no el expediente completo.')}</p>
            </>
          )}
        </fieldset>
        <label htmlFor="cn-vence">{t('Vence el (fin de ese día)')}</label>
        <input id="cn-vence" type="date" min={aFecha(diasDesdeHoy(0))} value={vence} onChange={(e) => { setVence(e.target.value); cambia(); }} />
        <div className="actions" role="group" aria-label={t('Vigencias rápidas')}>
          {[1, 7, 30, 90].map((n) => <button key={n} type="button" className="secondary inline" onClick={() => { setVence(aFecha(diasDesdeHoy(n))); cambia(); }}>{t('{n} días', { n })}</button>)}
        </div>
        {!fechaOk && <p className="muted" role="status">{t('El vencimiento debe ser futuro: no existe la concesión indefinida.')}</p>}
        <label htmlFor="cn-motivo">{t('Motivo (queda en la auditoría)')}</label>
        <input id="cn-motivo" minLength={3} maxLength={500} value={motivo} onChange={(e) => { setMotivo(e.target.value); cambia(); }} />
        {error && <ErrorPanel error={error} />}
        <div className="actions"><button type="submit" disabled={!completo}>{t('Revisar antes de otorgar')}</button></div>
      </form>

      {revision && elegido && (
        <section className="card capture-review" aria-labelledby="cn-rev">
          <h3 id="cn-rev">{t('Revisa antes de otorgar (todavía no se concedió nada)')}</h3>
          <dl className="props">
            <dt>{t('Recurso')}</dt><dd>{t(TIPOS[tipo])} · <strong>{elegido.label}</strong> — {elegido.detail}</dd>
            <dt>{t('Destinatario')}</dt><dd>{correo.trim()}</dd>
            <dt>{t('Alcance')}</dt><dd>{descarga ? t('Lectura y descarga de la vista compartida') : t('Solo lectura')}{tipo === 'DD_SNAPSHOT' && soportes && <><br />{t('Incluye los soportes de la instantánea (sin datos personales ni geometrías)')}</>}</dd>
            <dt>{t('Vigencia')}</dt><dd>{t('Hasta')} {dt(new Date(`${vence}T23:59:00`).toISOString())}</dd>
            <dt>{t('Motivo')}</dt><dd>{motivo.trim()}</dd>
          </dl>
          <Alert tone="review" title={t('Qué verá y qué no')}>
            <p>{t('Verá códigos, estados y agregados de ESTE recurso. No verá identidad de productores, geometrías, documentos personales ni datos económicos, no podrá modificar nada y no es miembro de tu organización. Puedes revocar cuando quieras.')}</p>
            {tipo === 'DD_SNAPSHOT' && soportes && <p>{t('Además verá la lista de los soportes que esta instantánea referencia y, si permites la descarga, podrá bajar la versión exacta de cada uno. Los documentos de datos personales y las geometrías no se comparten por esta vía; esto es una vista limitada, no el expediente completo.')}</p>}
          </Alert>
          <div className="actions">
            <button type="button" onClick={otorgar} disabled={busy} aria-busy={busy}>{busy ? t('Otorgando…') : t('Confirmar y otorgar')}</button>
            <button type="button" className="secondary" onClick={() => setRevision(false)} disabled={busy}>{t('Seguir editando')}</button>
          </div>
        </section>
      )}
    </section>
  );
}
