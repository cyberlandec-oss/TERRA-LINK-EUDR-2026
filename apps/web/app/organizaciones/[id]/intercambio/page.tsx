'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, apiDownload, apiUpload } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';

// P1-006 — Intercambio con GUIA/Agrocalidad (RF-37; docs/15).
//
// La pantalla tiene que dejar claras tres cosas que son el corazón de la historia:
//   · **no hay ninguna conexión con GUIA**: se intercambian archivos, porque no se asume ninguna API;
//   · **registrar el acuerdo no abre el canal**: lo verifica la administración de plataforma;
//   · **conciliar no cambia datos**: produce diferencias que alguien decide, y la corrección se hace
//     después en el módulo que corresponda.

interface Acuerdo {
  id: string; counterpart: string; reference: string; scope: string;
  valid_from: string; valid_to: string | null; status: string; can_exchange: boolean;
  decisions: Array<{ decision: string; reason: string; at: string; by: string }>; note: string;
}
interface Dif {
  id: string; external_key: string; entity_id: string | null; kind: string; field: string | null;
  external_value: string | null; our_value: string | null;
  resolution: { decision: string; reason: string; at: string } | null;
}
interface Acto {
  id: string; kind: string; format_version: string; row_count: number; content_hash: string;
  summary: Record<string, unknown>; performed_at: string; performed_by: string;
  differences?: Dif[]; pending: number; note?: string;
}
interface Formato {
  version: string; official: boolean; note: string; warning: string; elements_source: string;
  fields: Array<{ header: string; element: string; note: string }>; excluded: string[];
}

const ESTADO: Record<string, { tono: 'valid' | 'review' | 'blocked' | 'neutral'; texto: string }> = {
  REGISTRADO: { tono: 'review', texto: 'Registrado, sin verificar' },
  VERIFICADO_VIGENTE: { tono: 'valid', texto: 'Verificado y vigente' },
  VERIFICADO_NO_VIGENTE: { tono: 'review', texto: 'Verificado, fuera de vigencia' },
  RETIRADO: { tono: 'blocked', texto: 'Retirado' },
};
const DIF: Record<string, string> = {
  FIELD_DIFFERS: 'El valor difiere', ONLY_EXTERNAL: 'Solo en la contraparte', ONLY_OURS: 'Solo en Terra Link',
};
const RESOLUCION: Record<string, string> = {
  ACCEPT_EXTERNAL: 'Aceptar el valor externo', KEEP_OURS: 'Mantener el nuestro', NEEDS_REVIEW: 'Necesita revisión',
};

export default function IntercambioPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id;
  const puedeGestionar = ws.can('exchange:manage');
  const puedeUsar = ws.can('exchange:use');

  const [formato, setFormato] = useState<Formato | null>(null);
  const [acuerdos, setAcuerdos] = useState<Acuerdo[] | null>(null);
  const [actos, setActos] = useState<Acto[] | null>(null);
  const [abierto, setAbierto] = useState<Acto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    try {
      const [f, a, l] = await Promise.all([
        api<Formato>(`/api/v1/organizations/${orgId}/exchange/format`),
        api<{ agreements: Acuerdo[] }>(`/api/v1/organizations/${orgId}/exchange/agreements`),
        api<{ acts: Acto[] }>(`/api/v1/organizations/${orgId}/exchange/acts`),
      ]);
      setFormato(f); setAcuerdos(a.agreements); setActos(l.acts);
    } catch (err) { setError(err as ApiError); }
  }, [orgId]);
  useEffect(() => { setAcuerdos(null); void load(); }, [load]);

  const vigente = (acuerdos ?? []).find((a) => a.can_exchange) ?? null;

  async function registrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setOcupado(true); setError(null); setAviso(null);
    try {
      await api(`/api/v1/organizations/${orgId}/exchange/agreements`, {
        method: 'POST',
        body: {
          operation_id: crypto.randomUUID(), counterpart: 'GUIA_AGROCALIDAD',
          reference: String(f.get('reference') ?? ''), scope: String(f.get('scope') ?? ''),
          valid_from: String(f.get('valid_from') ?? ''),
          ...(f.get('valid_to') ? { valid_to: String(f.get('valid_to')) } : {}),
        },
      });
      setAviso('Acuerdo registrado. Todavía NO habilita el intercambio: debe verificarlo la administración de plataforma.');
      (e.target as HTMLFormElement).reset();
      await load();
    } catch (err) { setError(err as ApiError); } finally { setOcupado(false); }
  }

  async function exportar() {
    setOcupado(true); setError(null); setAviso(null);
    try {
      const r = await apiDownload(`/api/v1/organizations/${orgId}/exchange/export`, 'intercambio-operadores.xlsx', 'POST');
      setAviso(`Exportado «${r.filename}» (${r.bytes} bytes). El acto queda en el registro.`);
      await load();
    } catch (err) { setError(err as ApiError); } finally { setOcupado(false); }
  }

  async function conciliar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = (e.currentTarget.elements.namedItem('file') as HTMLInputElement | null);
    const file = input?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setOcupado(true); setError(null); setAviso(null);
    try {
      const { data } = await apiUpload<Acto>(`/api/v1/organizations/${orgId}/exchange/reconcile`, form);
      setAbierto(data);
      setAviso('Conciliación hecha. No se cambió ningún dato: lo que ves son diferencias por decidir.');
      await load();
    } catch (err) { setError(err as ApiError); } finally { setOcupado(false); }
  }

  async function abrir(id: string) {
    setError(null);
    try { setAbierto(await api<Acto>(`/api/v1/organizations/${orgId}/exchange/acts/${id}`)); }
    catch (err) { setError(err as ApiError); }
  }

  async function resolver(dif: Dif, decision: string) {
    const reason = window.prompt(`Motivo de «${RESOLUCION[decision]}» para ${dif.external_key}:`);
    if (!reason || reason.trim().length < 3) return;
    setOcupado(true); setError(null);
    try {
      setAbierto(await api<Acto>(`/api/v1/organizations/${orgId}/exchange/differences/${dif.id}/decisions`, {
        method: 'POST', body: { operation_id: crypto.randomUUID(), decision, reason: reason.trim() },
      }));
      await load();
    } catch (err) { setError(err as ApiError); } finally { setOcupado(false); }
  }

  if (!ws.activeOrg) {
    return <ErrorPanel error={new ApiError(404, { code: 'NOT_FOUND', message: 'El recurso no existe o no está disponible para ti.', request_id: null })} />;
  }
  if (!puedeUsar) {
    return (
      <>
        <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Intercambio' }]} />
        <PageHeader title="Intercambio con GUIA/Agrocalidad" />
        <Alert tone="blocked" title="Tu rol no participa en el intercambio con registros externos.">
          <p>Lo gestiona la administración de la organización. No es que no haya datos: es que esta acción no te corresponde.</p>
        </Alert>
      </>
    );
  }

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Intercambio' }]} />
      <PageHeader title="Intercambio con GUIA/Agrocalidad" meta={<span>Por archivo · sin conexión con el registro externo</span>} />

      <Alert tone="info" title="Terra Link no se conecta con GUIA: se intercambian archivos.">
        <p>
          No se asume ninguna API disponible y <strong>no se envía nada a ningún servicio externo</strong>. El
          intercambio solo se abre con un <strong>acuerdo verificado y vigente</strong>, y la verificación la hace
          la administración de plataforma: una organización no comprueba su propio canal.
        </p>
      </Alert>

      {error && <ErrorPanel error={error} onRetry={load} />}
      {aviso && <Alert tone="valid" title={aviso} />}

      <section className="card" aria-labelledby="acuerdos">
        <h2 id="acuerdos">Acuerdo de intercambio</h2>
        {!acuerdos ? <Loading label="Cargando los acuerdos…" />
          : acuerdos.length === 0 ? <EmptyState title="Todavía no hay ningún acuerdo registrado.">
            <p className="muted">Sin acuerdo no hay intercambio posible.</p>
          </EmptyState> : (
            <div className="table-wrap"><table aria-label="Acuerdos de intercambio">
              <thead><tr>
                <th scope="col">Referencia</th><th scope="col">Estado</th><th scope="col">Vigencia</th>
                <th scope="col">Alcance declarado</th><th scope="col">Decisiones</th>
              </tr></thead>
              <tbody>{acuerdos.map((a) => (
                <tr key={a.id}>
                  <td>{a.reference}<div className="muted">{a.counterpart}</div></td>
                  <td><StatusBadge tone={ESTADO[a.status].tono}>{ESTADO[a.status].texto}</StatusBadge></td>
                  <td>{a.valid_from} – {a.valid_to ?? 'sin fin'}</td>
                  <td className="muted">{a.scope}</td>
                  <td className="muted">
                    {a.decisions.length === 0 ? 'Ninguna' : a.decisions.map((d, i) => (
                      <div key={i}>{d.decision === 'VERIFY' ? 'Verificado' : 'Retirado'} · {d.by} · {d.reason}</div>
                    ))}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        {puedeGestionar && (
          <form onSubmit={registrar} className="form">
            <h3>Registrar un acuerdo</h3>
            <p className="field-help">Registrar deja constancia; <strong>no habilita el intercambio</strong>.</p>
            <label htmlFor="reference">Referencia del acuerdo</label>
            <input id="reference" name="reference" required minLength={3} maxLength={200} />
            <label htmlFor="scope">Alcance: qué se intercambia</label>
            <textarea id="scope" name="scope" required minLength={3} maxLength={1000} rows={2} />
            <label htmlFor="valid_from">Vigente desde</label>
            <input id="valid_from" name="valid_from" type="date" required />
            <label htmlFor="valid_to">Vigente hasta (opcional)</label>
            <input id="valid_to" name="valid_to" type="date" />
            <button type="submit" disabled={ocupado}>{ocupado ? 'Registrando…' : 'Registrar acuerdo'}</button>
          </form>
        )}
      </section>

      <section className="card" aria-labelledby="intercambiar">
        <h2 id="intercambiar">Exportar y conciliar</h2>
        {!vigente ? (
          <Alert tone="review" title="El canal está cerrado.">
            <p>
              Hace falta un acuerdo <strong>verificado y vigente</strong>. Registrarlo no basta: lo verifica la
              administración de plataforma.
            </p>
          </Alert>
        ) : (
          <>
            <p className="muted">Canal abierto por «{vigente.reference}», vigente hasta {vigente.valid_to ?? 'nuevo aviso'}.</p>
            <div className="actions">
              <button type="button" onClick={exportar} disabled={ocupado}>Exportar el padrón de operadores</button>
            </div>
            <form onSubmit={conciliar} className="form">
              <h3>Conciliar un archivo de la contraparte</h3>
              <p className="field-help">
                Conciliar <strong>no cambia ningún dato</strong>: compara y muestra diferencias para que alguien decida.
              </p>
              <label htmlFor="file">Archivo (.xlsx, hoja «operadores»)</label>
              <input id="file" name="file" type="file" accept=".xlsx" required />
              <button type="submit" disabled={ocupado}>{ocupado ? 'Conciliando…' : 'Conciliar'}</button>
            </form>
          </>
        )}
        {formato && (
          <details>
            <summary>Formato de intercambio {formato.version}</summary>
            <p className="muted"><strong>{formato.warning}</strong></p>
            <div className="table-wrap"><table aria-label="Campos del formato">
              <thead><tr><th scope="col">Campo</th><th scope="col">Elemento de la guía</th><th scope="col">Nota</th></tr></thead>
              <tbody>{formato.fields.map((f) => (
                <tr key={f.header}><td><code>{f.header}</code></td><td>{f.element}</td><td className="muted">{f.note}</td></tr>
              ))}</tbody>
            </table></div>
            <p className="muted">Qué NO viaja:</p>
            <ul className="plain">{formato.excluded.map((e, i) => <li key={i} className="muted">{e}</li>)}</ul>
          </details>
        )}
      </section>

      <section className="card" aria-labelledby="registro">
        <h2 id="registro">Registro de actos</h2>
        {!actos ? <Loading label="Cargando el registro…" />
          : actos.length === 0 ? <EmptyState title="Todavía no se ha exportado ni conciliado nada." />
            : (
              <div className="table-wrap"><table aria-label="Actos de intercambio">
                <thead><tr>
                  <th scope="col">Acto</th><th scope="col">Cuándo</th><th scope="col">Quién</th>
                  <th scope="col">Filas</th><th scope="col">Formato</th><th scope="col">Pendientes</th><th scope="col"></th>
                </tr></thead>
                <tbody>{actos.map((a) => (
                  <tr key={a.id}>
                    <td>{a.kind === 'EXPORT' ? 'Exportación' : 'Conciliación'}</td>
                    <td>{a.performed_at.slice(0, 19).replace('T', ' ')}</td>
                    <td>{a.performed_by}</td>
                    <td>{a.row_count}</td>
                    <td className="muted">{a.format_version}</td>
                    <td>{a.kind === 'RECONCILE' ? a.pending : '—'}</td>
                    <td>{a.kind === 'RECONCILE' && <button type="button" className="secondary" onClick={() => abrir(a.id)}>Ver diferencias</button>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
      </section>

      {abierto && abierto.differences && (
        <section className="card" aria-labelledby="diferencias">
          <h2 id="diferencias">Diferencias de la conciliación</h2>
          <p className="muted">{abierto.note}</p>
          {abierto.differences.length === 0 ? <p>No hubo diferencias: los dos padrones coinciden.</p> : (
            <div className="table-wrap"><table aria-label="Diferencias">
              <thead><tr>
                <th scope="col">Operador</th><th scope="col">Clase</th><th scope="col">Campo</th>
                <th scope="col">La contraparte dice</th><th scope="col">Nosotros decimos</th><th scope="col">Decisión</th>
              </tr></thead>
              <tbody>{abierto.differences.map((d) => (
                <tr key={d.id}>
                  <td><code>{d.external_key}</code></td>
                  <td>{DIF[d.kind]}</td>
                  <td>{d.field ?? '—'}</td>
                  <td>{d.external_value ?? '—'}</td>
                  <td>{d.our_value ?? '—'}</td>
                  <td>
                    {d.resolution
                      ? <><StatusBadge tone="neutral">{RESOLUCION[d.resolution.decision]}</StatusBadge><div className="muted">{d.resolution.reason}</div></>
                      : (
                        <div className="actions">
                          {Object.keys(RESOLUCION).map((k) => (
                            <button key={k} type="button" className="secondary" disabled={ocupado} onClick={() => resolver(d, k)}>{RESOLUCION[k]}</button>
                          ))}
                        </div>
                      )}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}
    </>
  );
}
