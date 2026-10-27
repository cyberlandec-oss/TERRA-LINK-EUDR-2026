'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge, type Tone } from '../../../../lib/ui';

// UX_UI (P1-005): perfil jurídico **revisable**. La pantalla existe para que alguien revise, no para acreditar.
//
// Lo que la interfaz tiene que dejar claro de un vistazo, porque es lo que se puede leer de más:
//   · el perfil es **PARCIAL** y su revisión jurídica está **PENDIENTE**, así que **no satisface** el requisito
//     del expediente ni abre `READY`;
//   · las reglas son **CANDIDATAS en borrador**, no derecho aprobado;
//   · **desconocido no es cumplido**, y **aplicable sin evidencia** queda pendiente, no es una infracción;
//   · la cartografía es **indicio**, nunca veredicto.
// Los botones que una persona no puede usar **no se pintan**: el permiso lo aplica la API, y la UI no finge.

interface Fuente {
  code: string; title: string; authority: string; publication: string; publication_date: string; url: string;
  file_sha256: string; pdf_page_index: number | null; printed_page: string | null;
  document_obtained: boolean; text_contrasted: boolean; legal_validity_reviewed: boolean;
  modifications_found: string; gaps: string;
}
interface Regla { code: string; matter: string; article: string; subject: string; applicability_condition: string; evidence_required: string; product_can_check: string; review_status: string; gaps: string }
interface Version { version: string; technical_status: string; scope: string; scope_note: string; pending_matters: string[]; covered_matters: string[]; legal_review_status: string; sources: Fuente[]; rules: Regla[] }
interface Catalogo { adopted: { version: string; scope: string; legal_review_status: string } | null; note: string; versions: Version[] }
interface Item {
  id: string; rule_code: string; applicability: string; applicability_reason: string | null;
  evidence_version_id: string | null; evidence_origin: string | null; evidence_admissibility: string; evidence_justification: string | null;
  result: string; reviewer_id: string | null; reason: string | null;
  cartographic_indication: string; cartographic_source: string | null; cartographic_note: string | null;
  row_version: string; matter: string; article: string; subject: string; applicability_condition: string;
  evidence_required: string; product_can_check: string; review_status: string; gaps: string;
}
interface Evaluacion {
  id: string; subject_id: string; status: string;
  profile: { version: string; scope: string; scope_note: string; pending_matters: string[]; legal_review_status: string };
  items: Item[];
  summary: { pending: string[]; not_evaluable: string[]; satisfies_legal_profile: boolean; why: string };
}
interface Historia { item_id: string; history: Array<{ row_version: string; applicability: string; result: string; reason: string | null; change_note: string; changed_at: string }> }

const TONO: Record<string, Tone> = {
  SATISFIED: 'valid', NOT_SATISFIED: 'blocked', PENDING: 'review', NOT_EVALUABLE: 'neutral', NOT_APPLICABLE: 'neutral',
};
const ETIQUETA: Record<string, string> = {
  SATISFIED: 'Satisfecho', NOT_SATISFIED: 'No satisfecho', PENDING: 'Pendiente',
  NOT_EVALUABLE: 'No evaluable', NOT_APPLICABLE: 'No aplica',
  UNKNOWN: 'Desconocida', APPLICABLE: 'Aplicable',
};

export default function PerfilJuridicoPage() {
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [evaluacion, setEvaluacion] = useState<Evaluacion | null>(null);
  const [parcela, setParcela] = useState('');
  const [historia, setHistoria] = useState<Historia | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    if (!orgId || !ws.can('traceability:read_catalog')) return;
    try { setCat(await api<Catalogo>(`/api/v1/organizations/${orgId}/legal-profile/catalog`)); setError(null); }
    catch (err) { setError(err as ApiError); }
  }, [orgId, ws]);
  useEffect(() => { void cargar(); }, [cargar]);

  const hacer = async (fn: () => Promise<void>) => {
    setOcupado(true);
    try { await fn(); setError(null); } catch (err) { setError(err as ApiError); } finally { setOcupado(false); }
  };

  const adoptar = (decision: 'ADOPT' | 'WITHDRAW', version: string) => hacer(async () => {
    await api(`/api/v1/organizations/${orgId}/legal-profile/adoptions`, {
      method: 'POST',
      body: { operation_id: crypto.randomUUID(), version, decision, reason: decision === 'ADOPT' ? 'Adopción para revisión interna' : 'Retirada para revisión' },
    });
    await cargar();
  });

  const preparar = () => hacer(async () => {
    const r = await api<Evaluacion>(`/api/v1/organizations/${orgId}/legal-assessments`, {
      method: 'POST', body: { operation_id: crypto.randomUUID(), plot_id: parcela },
    });
    setEvaluacion(r); setHistoria(null);
  });

  const revisar = (it: Item, cambios: Partial<Item> & { change_note: string }) => hacer(async () => {
    await api(`/api/v1/organizations/${orgId}/legal-assessments/${evaluacion!.id}/items/${it.id}`, {
      method: 'PUT',
      body: {
        applicability: cambios.applicability ?? it.applicability,
        applicability_reason: cambios.applicability_reason ?? it.applicability_reason ?? undefined,
        evidence_version_id: cambios.evidence_version_id ?? it.evidence_version_id ?? undefined,
        evidence_origin: cambios.evidence_origin ?? it.evidence_origin ?? undefined,
        evidence_justification: cambios.evidence_justification ?? it.evidence_justification ?? undefined,
        result: cambios.result ?? it.result,
        reason: cambios.reason ?? it.reason ?? undefined,
        cartographic_indication: cambios.cartographic_indication ?? it.cartographic_indication,
        cartographic_source: cambios.cartographic_source ?? it.cartographic_source ?? undefined,
        cartographic_note: cambios.cartographic_note ?? it.cartographic_note ?? undefined,
        change_note: cambios.change_note,
        expected_version: it.row_version,
      },
    });
    setEvaluacion(await api<Evaluacion>(`/api/v1/organizations/${orgId}/legal-assessments/${evaluacion!.id}`));
  });

  const verHistoria = (it: Item) => hacer(async () => {
    setHistoria(await api<Historia>(`/api/v1/organizations/${orgId}/legal-assessments/${evaluacion!.id}/items/${it.id}/history`));
  });

  if (!ws.activeOrg) return null;
  if (!ws.can('traceability:read_catalog')) {
    return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar el catálogo de perfiles jurídicos.', request_id: null })} />;
  }

  // El perfil principal (adoptable) es el más reciente PUBLICADO. Un borrador nunca se presenta como adoptable.
  const v = cat?.versions.find((x) => x.technical_status === 'PUBLISHED');
  const borradores = cat?.versions.filter((x) => x.technical_status !== 'PUBLISHED') ?? [];
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Perfil jurídico' }]} />
      <PageHeader
        title="Perfil jurídico (P1-005)"
        meta="Mecanismo para preparar y revisar un perfil. NO es un perfil aprobado: no acredita legalidad, no satisface el requisito del expediente y no habilita READY."
      />
      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {!cat && !error && <Loading label="Cargando catálogo…" />}

      {v && (
        <>
          <Alert tone="review" title={`Perfil ${v.version}: alcance ${v.scope === 'PARTIAL' ? 'PARCIAL' : 'completo'}, revisión jurídica ${v.legal_review_status === 'REVIEWED' ? 'resuelta' : 'PENDIENTE'}`}>
            <p>{v.scope_note}</p>
            {v.pending_matters.length > 0 && (
              <p><strong>Materias que NO cubre:</strong> {v.pending_matters.join(', ')}. Mientras falten, este perfil <strong>no satisface</strong> el requisito de perfil jurídico del expediente.</p>
            )}
          </Alert>

          <section>
            <h2>Adopción en esta organización</h2>
            <p className="muted">
              {cat?.adopted
                ? `Adoptado: ${cat?.adopted.version} (alcance ${cat?.adopted.scope}, revisión jurídica ${cat?.adopted.legal_review_status}). Adoptar un perfil parcial no lo vuelve suficiente.`
                : 'Esta organización no ha adoptado ningún perfil jurídico.'}
            </p>
            {ws.can('risk:approve_rules') ? (
              <button type="button" disabled={ocupado} onClick={() => void adoptar(cat?.adopted ? 'WITHDRAW' : 'ADOPT', v.version)}>
                {cat?.adopted ? 'Retirar el perfil' : 'Adoptar el perfil'}
              </button>
            ) : <p className="muted">Tu rol no permite adoptar ni retirar perfiles.</p>}
          </section>

          <section>
            <h2>Fuentes</h2>
            <p className="muted">Tener el documento, haberlo contrastado y que su vigencia esté revisada jurídicamente son <strong>tres cosas distintas</strong>.</p>
            <div className="table-wrap"><table aria-label="Fuentes del perfil">
              <thead><tr>
                <th scope="col">Fuente</th><th scope="col">Publicación</th><th scope="col">Copia identificada</th>
                <th scope="col">Obtenido</th><th scope="col">Contrastado</th><th scope="col">Vigencia revisada</th><th scope="col">Modificaciones y lagunas</th>
              </tr></thead>
              <tbody>{v.sources.map((s) => (
                <tr key={s.code}>
                  <td><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a><div className="muted">{s.authority}</div></td>
                  <td>{s.publication}<div className="muted">{s.publication_date}</div></td>
                  <td className="muted">
                    sha256 {s.file_sha256.slice(0, 12)}…
                    {s.printed_page && <> · página impresa {s.printed_page}</>}
                    {s.pdf_page_index && <> · PDF {s.pdf_page_index} pág.</>}
                  </td>
                  <td>{s.document_obtained ? <StatusBadge tone="valid">Sí</StatusBadge> : <StatusBadge tone="neutral">No</StatusBadge>}</td>
                  <td>{s.text_contrasted ? <StatusBadge tone="valid">Sí</StatusBadge> : <StatusBadge tone="neutral">No</StatusBadge>}</td>
                  <td>{s.legal_validity_reviewed ? <StatusBadge tone="valid">Sí</StatusBadge> : <StatusBadge tone="review">Pendiente</StatusBadge>}</td>
                  <td className="muted">{s.modifications_found}<br /><em>{s.gaps}</em></td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>

          <section>
            <h2>Reglas candidatas</h2>
            <p className="muted">Todas en <strong>borrador</strong>: una candidata no es una regla aprobada.</p>
            <div className="table-wrap"><table aria-label="Reglas candidatas">
              <thead><tr><th scope="col">Regla</th><th scope="col">A quién se dirige</th><th scope="col">Cuándo aplica</th><th scope="col">Qué puede comprobar el sistema</th><th scope="col">Estado</th></tr></thead>
              <tbody>{v.rules.map((r) => (
                <tr key={r.code}>
                  <td>{r.code}<div className="muted">{r.article}</div></td>
                  <td>{r.subject}</td>
                  <td className="muted">{r.applicability_condition}</td>
                  <td className="muted">{r.product_can_check}</td>
                  <td><StatusBadge tone="review">{r.review_status === 'DRAFT' ? 'Candidata' : 'Revisada'}</StatusBadge></td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
        </>
      )}

      {borradores.length > 0 && (
        <section>
          <h2>Borradores en preparación</h2>
          <Alert tone="review" title="No son perfiles aprobados ni adoptables">
            <p>Un borrador reúne reglas candidatas con su procedencia, interpretación propuesta y preguntas pendientes para el revisor. No se puede adoptar, no sustituye al perfil vigente y no cambia ningún expediente ni resultado anterior.</p>
          </Alert>
          {borradores.map((b) => (
            <div key={b.version}>
              <h3>Borrador {b.version} <StatusBadge tone="review">Borrador · no adoptable</StatusBadge></h3>
              <p className="muted">{b.scope_note}</p>
              <div className="table-wrap"><table aria-label={'Reglas candidatas del borrador ' + b.version}>
                <thead><tr><th scope="col">Regla</th><th scope="col">Fuente y artículo</th><th scope="col">Interpretación propuesta y preguntas para el revisor</th></tr></thead>
                <tbody>{b.rules.map((r) => (
                  <tr key={r.code}><td>{r.code}</td><td className="muted">{r.article}</td><td className="muted">{r.gaps}</td></tr>
                ))}</tbody>
              </table></div>
            </div>
          ))}
        </section>
      )}

      {cat?.adopted && ws.can('dd:manage') && (
        <section>
          <h2>Preparar la revisión de una parcela</h2>
          <label htmlFor="parcela">Identificador de la parcela</label>
          <input id="parcela" value={parcela} onChange={(e) => setParcela(e.target.value)} placeholder="UUID de la parcela" />
          <button type="button" disabled={ocupado || !parcela} onClick={() => void preparar()}>Preparar</button>
          <p className="muted">Se crea un requisito por regla candidata, con la aplicabilidad <strong>desconocida</strong>: es el estado honesto de partida.</p>
        </section>
      )}

      {evaluacion && (
        <section>
          <h2>Revisión de la parcela</h2>
          <Alert tone="review" title="Esta revisión no acredita el requisito">
            <p>{evaluacion.summary.why}</p>
            <p>
              Pendientes: {evaluacion.summary.pending.length} · No evaluables: {evaluacion.summary.not_evaluable.length}.
              Perfil {evaluacion.profile.version} ({evaluacion.profile.scope}), revisión jurídica {evaluacion.profile.legal_review_status}.
            </p>
          </Alert>
          <div className="table-wrap"><table aria-label="Requisitos de la parcela">
            <thead><tr>
              <th scope="col">Requisito</th><th scope="col">Aplicabilidad</th><th scope="col">Evidencia</th>
              <th scope="col">Resultado</th><th scope="col">Indicio cartográfico</th><th scope="col">Acciones</th>
            </tr></thead>
            <tbody>{evaluacion.items.map((it) => (
              <tr key={it.id}>
                <td>{it.rule_code}<div className="muted">{it.article}</div></td>
                <td>
                  <StatusBadge tone={it.applicability === 'APPLICABLE' ? 'process' : 'neutral'}>{ETIQUETA[it.applicability]}</StatusBadge>
                  {it.applicability_reason && <div className="muted">{it.applicability_reason}</div>}
                </td>
                <td>
                  {it.evidence_version_id
                    ? <>{it.evidence_origin === 'OFFICIAL_DOCUMENT' ? 'Documento oficial' : 'Declaración del productor'}
                      <div className="muted">{it.evidence_admissibility === 'JUSTIFIED' ? 'Admisibilidad justificada' : 'Admisibilidad sin justificar'}</div></>
                    : <span className="muted">Sin evidencia</span>}
                </td>
                <td><StatusBadge tone={TONO[it.result] ?? 'neutral'}>{ETIQUETA[it.result]}</StatusBadge></td>
                <td className="muted">
                  {it.cartographic_indication === 'INDICATION' ? 'Indicio: abre revisión, no concluye' : it.cartographic_indication === 'NONE' ? 'Sin indicio' : 'No evaluado'}
                </td>
                <td>
                  {ws.can('risk:review') && evaluacion.status === 'OPEN' && (
                    <>
                      <button type="button" disabled={ocupado} onClick={() => void revisar(it, { applicability: 'APPLICABLE', result: 'PENDING', change_note: 'Marcada como aplicable; falta evidencia' })}>Aplicable</button>
                      <button type="button" disabled={ocupado} onClick={() => void revisar(it, { applicability: 'NOT_APPLICABLE', result: 'NOT_APPLICABLE', applicability_reason: 'El predio no está en el supuesto', change_note: 'No aplica a este predio' })}>No aplica</button>
                    </>
                  )}
                  <button type="button" disabled={ocupado} onClick={() => void verHistoria(it)}>Historial</button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
          {!ws.can('risk:review') && <p className="muted">Tu rol permite consultar, no registrar el resultado de la revisión.</p>}
        </section>
      )}

      {historia && (
        <section>
          <h2>Historial del requisito</h2>
          <p className="muted">Append-only: los estados anteriores se conservan aunque el requisito cambie después.</p>
          {historia.history.length === 0 && <EmptyState title="Sin cambios registrados todavía." />}
          {historia.history.length > 0 && (
            <div className="table-wrap"><table aria-label="Historial">
              <thead><tr><th scope="col">Versión</th><th scope="col">Aplicabilidad</th><th scope="col">Resultado</th><th scope="col">Motivo del cambio</th><th scope="col">Fecha</th></tr></thead>
              <tbody>{historia.history.map((x) => (
                <tr key={x.row_version}>
                  <td>{x.row_version}</td>
                  <td>{ETIQUETA[x.applicability] ?? x.applicability}</td>
                  <td>{ETIQUETA[x.result] ?? x.result}</td>
                  <td className="muted">{x.change_note}</td>
                  <td className="muted">{new Date(x.changed_at).toLocaleString('es-EC')}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}
    </>
  );
}
