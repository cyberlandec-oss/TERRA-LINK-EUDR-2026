'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ApiError, api } from '../../../../../../../lib/api';
import { useWorkspace } from '../../../../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../../../lib/ui';

// P1-013 — Extracción asistida de documentos (RF-44; S1 §55).
//
// Lo que esta pantalla no puede dejar de separar:
//   · **texto extraído** (lo que el archivo dice), **valor sugerido** (con su procedencia) y **dato
//     confirmado por una persona**: tres bloques distintos, nunca mezclados;
//   · la **confianza** se muestra **con la regla que la produjo**, no como un número suelto;
//   · un valor **ambiguo** no trae sugerencia: trae **candidatos** para que alguien elija;
//   · **sugerir no es confirmar**, y **confirmar no sobrescribe** la versión del documento;
//   · si la extracción es de una **versión que ya no es la vigente**, se avisa arriba.

interface Campo {
  id: string; field_code: string;
  suggestion: {
    value: string | null; basis: string; confidence: string; basis_note: string;
    source_excerpt: string | null; source_offset: number | null;
    candidates: Array<{ value: string; excerpt: string; offset: number }>;
  };
  review: { decision: string; confirmed_value: string | null; reason: string | null; decided_at: string; decided_by: string } | null;
  state: string;
}
interface Vista {
  document: { id: string; title: string; type: string; classification: string };
  version: { id: string; version_number: number; file_name: string; mime_type: string; size_bytes: number; sha256: string; scan: string | null; is_current: boolean };
  version_note: string; supported: boolean;
  extraction: {
    id: string; run_number: number; status: string; engine: string; engine_version: string;
    source_sha256: string; text_chars: number; pages: number | null; note: string;
    extracted_at: string; author: string; extracted_text: string | null;
  } | null;
  fields: Campo[];
  history: Array<{ run_number: number; status: string; engine: string; text_chars: number; extracted_at: string; author: string }>;
  can_review: boolean; disclaimer: string; no_external: string;
}

const CAMPO: Record<string, string> = {
  ISSUER: 'Emisor', ISSUED_AT: 'Fecha de emisión', EXPIRES_AT: 'Fecha de vencimiento',
};
const ESTADO: Record<string, { tono: 'valid' | 'review' | 'blocked' | 'neutral'; texto: string }> = {
  EXTRAIDA: { tono: 'valid', texto: 'Texto extraído' },
  SIN_TEXTO: { tono: 'review', texto: 'Sin capa de texto' },
  FORMATO_NO_SOPORTADO: { tono: 'neutral', texto: 'Formato no soportado' },
  FALLIDA: { tono: 'blocked', texto: 'No se pudo leer' },
};
const CONFIANZA: Record<string, 'valid' | 'review' | 'blocked' | 'neutral'> = {
  ALTA: 'valid', MEDIA: 'review', BAJA: 'neutral',
};

export default function ExtraccionPage() {
  const ws = useWorkspace();
  const params = useParams<{ id: string; docId: string; versionId: string }>();
  const orgId = ws.activeOrg?.id;
  const docId = params?.docId;
  const versionId = params?.versionId;
  const [v, setV] = useState<Vista | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [revisando, setRevisando] = useState<string | null>(null);

  const base = `/api/v1/organizations/${orgId}/documents/${docId}/versions/${versionId}/extraction`;

  const cargar = useCallback(async () => {
    if (!orgId || !docId || !versionId) return;
    setError(null);
    try { setV(await api<Vista>(base)); }
    catch (err) { setError(err as ApiError); }
  }, [base, orgId, docId, versionId]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function extraer() {
    setTrabajando(true); setError(null); setAviso(null);
    try {
      setV(await api<Vista>(base, { method: 'POST', body: { operation_id: crypto.randomUUID() } }));
      setAviso('Extracción realizada en local. Son sugerencias: nada queda confirmado hasta que lo revises.');
    } catch (err) { setError(err as ApiError); } finally { setTrabajando(false); }
  }

  async function decidir(e: React.FormEvent<HTMLFormElement>, campo: Campo, decision: 'CONFIRMADO' | 'DESCARTADO') {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const t = (k: string) => { const x = String(f.get(k) ?? '').trim(); return x === '' ? undefined : x; };
    setTrabajando(true); setError(null); setAviso(null);
    try {
      setV(await api<Vista>(`${base}/fields/${campo.id}/review`, {
        method: 'POST',
        body: {
          operation_id: crypto.randomUUID(), decision,
          confirmed_value: decision === 'CONFIRMADO' ? (t('confirmed_value') ?? campo.suggestion.value ?? undefined) : undefined,
          reason: decision === 'DESCARTADO' ? t('reason') : undefined,
        },
      }));
      setAviso(decision === 'CONFIRMADO'
        ? 'Dato confirmado por ti. Queda registrado como tuyo y NO sobrescribe la versión del documento.'
        : 'Sugerencia descartada con su motivo.');
      setRevisando(null);
    } catch (err) { setError(err as ApiError); } finally { setTrabajando(false); }
  }

  if (!ws.activeOrg) {
    return <ErrorPanel error={new ApiError(404, { code: 'NOT_FOUND', message: 'El recurso no existe o no está disponible para ti.', request_id: null })} />;
  }
  const migas = [
    { label: ws.activeOrg.name, href: `/organizaciones/${orgId}` },
    { label: 'Documentos', href: `/organizaciones/${orgId}/documentos` },
    ...(v ? [{ label: v.document.title, href: `/organizaciones/${orgId}/documentos/${docId}` }] : []),
    { label: 'Extracción' },
  ];

  return (
    <>
      <Breadcrumb items={migas} />
      <PageHeader
        title="Extracción asistida"
        meta={v ? <span>{v.document.title} · versión {v.version.version_number} · {v.version.mime_type}</span> : undefined}
      />

      <Alert tone="info" title="Sugerir no es confirmar, y confirmar no sobrescribe.">
        <p>
          La extracción <strong>no acredita autenticidad, legalidad, calidad ni suficiencia documental</strong> y
          no levanta ninguna compuerta. Un valor sugerido <strong>no es un dato</strong>: lo es cuando una persona
          lo confirma, y aun entonces queda como <strong>registro propio</strong>, sin tocar la versión del documento.
        </p>
      </Alert>

      {aviso && <Alert tone="valid" title={aviso} />}
      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {!v && !error && <Loading label="Cargando la extracción…" />}

      {v && (
        <>
          {!v.version.is_current && (
            <Alert tone="review" title="Esta versión ya no es la vigente.">
              <p>{v.version_note}</p>
            </Alert>
          )}

          <section className="card" aria-labelledby="ex-origen">
            <h2 id="ex-origen">El archivo analizado</h2>
            <dl className="props">
              <dt>Archivo</dt><dd>{v.version.file_name} · {v.version.mime_type}</dd>
              <dt>Huella del contenido</dt><dd><code>{v.version.sha256.slice(0, 32)}…</code></dd>
              <dt>Análisis antivirus</dt>
              <dd>{v.version.scan === 'CLEAN' ? <StatusBadge tone="valid">Limpio</StatusBadge> : <StatusBadge tone="blocked">{v.version.scan ?? 'sin analizar'}</StatusBadge>}</dd>
              <dt>Formato admitido para extraer</dt>
              <dd>{v.supported ? <StatusBadge tone="valid">Sí</StatusBadge> : <StatusBadge tone="neutral">No</StatusBadge>}</dd>
            </dl>
            <p className="muted">{v.no_external}</p>
            {ws.can('document:extract') && (
              <div className="actions">
                <button type="button" onClick={extraer} disabled={trabajando}>
                  {trabajando ? 'Procesando…' : v.extraction ? 'Extraer de nuevo' : 'Extraer texto y sugerir'}
                </button>
              </div>
            )}
          </section>

          {!v.extraction ? (
            <section className="card" aria-labelledby="ex-vacio">
              <h2 id="ex-vacio">Todavía no se ha extraído nada</h2>
              <EmptyState title="Esta versión no tiene ninguna extracción." >
                <p className="muted">
                  {ws.can('document:extract')
                    ? 'Puedes lanzarla con el botón de arriba. No cambiará el documento.'
                    : 'Tu rol no puede lanzar la extracción: subir un archivo no autoriza a procesar sus datos.'}
                </p>
              </EmptyState>
            </section>
          ) : (
            <>
              <section className="card" aria-labelledby="ex-texto">
                <h2 id="ex-texto">1. Texto extraído</h2>
                <p>
                  <StatusBadge tone={ESTADO[v.extraction.status]?.tono ?? 'neutral'}>
                    {ESTADO[v.extraction.status]?.texto ?? v.extraction.status}
                  </StatusBadge>{' '}
                  <span className="muted">
                    {v.extraction.engine} {v.extraction.engine_version} · {v.extraction.text_chars} caracteres
                    {v.extraction.pages !== null ? ` · ${v.extraction.pages} página(s)` : ''}
                  </span>
                </p>
                <p className="muted">{v.extraction.note}</p>
                {v.extraction.extracted_text
                  ? <pre className="code-block" aria-label="Texto extraído del documento">{v.extraction.extracted_text}</pre>
                  : <EmptyState title="No hay texto que mostrar." />}
                <p className="muted">
                  Esto es lo que el documento dice, literalmente. <strong>No es un dato confirmado.</strong>
                </p>
              </section>

              <section className="card" aria-labelledby="ex-campos">
                <h2 id="ex-campos">2. Valores sugeridos y 3. revisión</h2>
                {v.fields.length === 0 ? <EmptyState title="Sin texto no hay nada que sugerir." /> : (
                  <div className="table-wrap"><table aria-label="Sugerencias de extracción">
                    <thead><tr>
                      <th scope="col">Campo</th><th scope="col">Sugerencia</th>
                      <th scope="col">Confianza y por qué</th><th scope="col">De dónde sale</th>
                      <th scope="col">Estado</th><th scope="col">Revisión</th>
                    </tr></thead>
                    <tbody>{v.fields.map((f) => (
                      <tr key={f.id}>
                        <td>{CAMPO[f.field_code] ?? f.field_code}</td>
                        <td>
                          {f.suggestion.value
                            ? <strong>{f.suggestion.value}</strong>
                            : <span className="muted">sin sugerencia</span>}
                          {f.suggestion.candidates.length > 0 && (
                            <ul className="plain">
                              {f.suggestion.candidates.map((c, i) => (
                                <li key={i} className="muted">candidato: <code>{c.value}</code></li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td>
                          <StatusBadge tone={CONFIANZA[f.suggestion.confidence] ?? 'neutral'}>{f.suggestion.confidence}</StatusBadge>
                          <div className="muted">{f.suggestion.basis_note}</div>
                        </td>
                        <td className="muted">
                          {f.suggestion.source_excerpt
                            ? <>«{f.suggestion.source_excerpt}»<div className="muted">posición {f.suggestion.source_offset}</div></>
                            : <span className="muted">—</span>}
                        </td>
                        <td>
                          {f.state === 'CONFIRMADO' ? <StatusBadge tone="valid">Confirmado</StatusBadge>
                            : f.state === 'DESCARTADO' ? <StatusBadge tone="neutral">Descartado</StatusBadge>
                              : <StatusBadge tone="review">Pendiente de revisión</StatusBadge>}
                        </td>
                        <td>
                          {f.review ? (
                            <span className="muted">
                              {f.review.confirmed_value ? <strong>{f.review.confirmed_value}</strong> : f.review.reason}
                              <div className="muted">{f.review.decided_by}</div>
                            </span>
                          ) : !v.can_review ? (
                            <span className="muted">Tu rol no revisa documentos: proponer no es confirmar.</span>
                          ) : revisando === f.id ? (
                            <form onSubmit={(e) => decidir(e, f, (e.nativeEvent as SubmitEvent).submitter?.id === 'descartar' ? 'DESCARTADO' : 'CONFIRMADO')}>
                              <label htmlFor={`val-${f.id}`}>Valor que confirmas</label>
                              <input id={`val-${f.id}`} name="confirmed_value" defaultValue={f.suggestion.value ?? ''} />
                              <label htmlFor={`mot-${f.id}`}>Motivo (si descartas)</label>
                              <input id={`mot-${f.id}`} name="reason" />
                              <div className="actions">
                                <button type="submit" id="confirmar" disabled={trabajando}>Confirmar</button>
                                <button type="submit" id="descartar" disabled={trabajando}>Descartar</button>
                                <button type="button" onClick={() => setRevisando(null)}>Cancelar</button>
                              </div>
                            </form>
                          ) : (
                            <button type="button" onClick={() => setRevisando(f.id)}>Revisar</button>
                          )}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
                <p className="muted">{v.disclaimer}</p>
              </section>

              <section className="card" aria-labelledby="ex-hist">
                <h2 id="ex-hist">Extracciones de esta versión</h2>
                <div className="table-wrap"><table aria-label="Historial de extracciones">
                  <thead><tr><th scope="col">#</th><th scope="col">Resultado</th><th scope="col">Motor</th><th scope="col">Caracteres</th><th scope="col">Cuándo y quién</th></tr></thead>
                  <tbody>{v.history.map((hh) => (
                    <tr key={hh.run_number}>
                      <td>{hh.run_number}{hh.run_number === v.extraction?.run_number ? ' (vigente)' : ''}</td>
                      <td>{ESTADO[hh.status]?.texto ?? hh.status}</td>
                      <td className="muted">{hh.engine}</td>
                      <td>{hh.text_chars}</td>
                      <td className="muted">{hh.extracted_at.slice(0, 19).replace('T', ' ')} · {hh.author}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
                <p className="muted">Extraer de nuevo añade una corrida: lo anterior se conserva.</p>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
