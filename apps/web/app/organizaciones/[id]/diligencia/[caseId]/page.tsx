'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, ROLE_LABELS, api, apiDownload } from '../../../../../lib/api';
import { useWorkspace } from '../../../../../lib/workspace';
import { Alert, Breadcrumb, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../../lib/ui';
import { ErrorDetails } from '../../../../../lib/deliveries';
import { DD_PROCESS, READINESS_TONE, REQ_STATUS } from '../../../../../lib/dd';
import { GeoEvaluationPanel } from '../../../../../lib/geo-eval-panel';

interface Resolucion { action: string; roles: string[]; permission: string | null; screen: string; kind: 'DATA' | 'ACTION' | 'DECISION' | 'EXTERNAL'; limit: string | null }
interface Req { code: string; label: string; status: string; detail: string; source: string; references: string[] }
interface Exp { id: string; kind: string; label: string; package_hash: string; size_bytes: number; exported_at: string; exported_by: string; disclaimer: string }
interface Snapshot {
  id: string; snapshot_number: number; is_latest: boolean; captured_at: string; captured_by: string; content_hash: string;
  content: {
    subject: { code: string; product: string; unit: string; origin_status: string }; quantities: { physical: string; reserved: string; available: string; unit: string };
    deliveries: Array<{ id: string; code: string; origin_plots: string[]; harvest?: { precision: string; start: string | null; end: string | null; correction_number: number } }>;
    plots: Array<{ production_country?: { declaration_number: number; country: string | null; declared_at: string }; plot_id: string; plot_code: string; version_number: number | null; geometry_type: string | null; geometry_hash: string | null; gis_status: string | null; geometry: unknown }>;
    quality: Array<{ reception_id: string; delivery_code: string; decision: string }>;
    documents: Array<{ version_id: string; title: string; version_number: number; sha256: string; used_by: string; reference: string }>;
    evidence: Array<{ id: string; claim_type: string; status: string }>;
    risk: null | { evaluation_number: number; rule_set_version: string; rule_set_approval: string; technical_result: string; conclusion: string; review_process: string; is_current: boolean };
    mitigations: Array<{ id: string; factor_code: string; status: string }>;
  };
  redacted: { geometry: boolean; personal_documents: boolean };
  resolution?: Record<string, Resolucion>;
  requirements: Req[]; summary: { total: number; met: number; pending: number; invalid: number; not_evaluable: number; percent_met: number; note: string };
  readiness: { captured: string; effective: string; label: string; changed_sections: string[]; note: string };
  review: { process_status: string; history: Array<{ action: string; reason: string; at: string; reviewer: string }> };
  submission: { status: string; note: string }; exports: Exp[];
  actions: { start_review: boolean; return: boolean; approve: boolean; approve_blocked_reason: string | null; export_internal: boolean; export_package: boolean; export_package_blocked_reason: string | null };
}
interface DdCase { id: string; case_number: string; subject: { code: string; id: string }; scope_note: string; created_by: string; latest: Snapshot | null; history: Array<{ id: string; snapshot_number: number; readiness_label: string; captured_at: string; content_hash: string }>; actions: { snapshot: boolean } }

// Declarado / desconocido / sin declarar: tres cosas distintas. La fecha de entrega o de recepción nunca sustituye a la cosecha, ni la organización al país de producción.
const cosechaDe = (h?: { precision: string; start: string | null; end: string | null; correction_number: number }) => {
  if (!h) return { estado: 'NOT_DECLARED', texto: 'cosecha sin declarar (desconocida)' };
  if (h.precision === 'UNKNOWN') return { estado: 'DECLARED_UNKNOWN', texto: 'cosecha declarada como desconocida' };
  const rango = h.start === h.end || !h.end ? h.start : `${h.start} a ${h.end}`;
  return { estado: 'DECLARED', texto: `cosecha declarada (${h.precision === 'MONTH' ? 'mes' : 'día'}): ${rango}${h.correction_number > 0 ? ` · corregida ${h.correction_number} vez/veces` : ''}` };
};
const paisDe = (p?: { declaration_number: number; country: string | null }) => {
  if (!p) return { estado: 'NOT_DECLARED', texto: 'país de producción sin declarar' };
  if (!p.country) return { estado: 'DECLARED_UNKNOWN', texto: `país de producción declarado como desconocido (declaración ${p.declaration_number})` };
  return { estado: 'DECLARED', texto: `país de producción declarado: ${p.country} (declaración ${p.declaration_number})` };
};

const NATURALEZA: Record<string, string> = { DATA: 'Falta información o un soporte', ACTION: 'Falta ejecutar una acción', DECISION: 'Requiere una decisión humana', EXTERNAL: 'Depende de un tercero o de una decisión pendiente' };
const RUTA: Record<string, string> = { LOT_RISK: 'riesgo', DELIVERIES: 'entregas', MITIGATIONS: 'mitigaciones', SHIPMENTS: 'embarques', GEO_CONFIG: 'geolocalizacion', LEGAL_PROFILE: 'perfil-juridico', PLOTS: 'parcelas', INVENTORY: 'inventario', LOT: 'lotes' };
const PANTALLA: Record<string, string> = { LOT_RISK: 'Riesgo del lote', DELIVERIES: 'Entregas', MITIGATIONS: 'Mitigaciones', SHIPMENTS: 'Embarques', GEO_CONFIG: 'Geolocalización', LEGAL_PROFILE: 'Perfil jurídico', PLOTS: 'Parcelas', INVENTORY: 'Inventario', LOT: 'Lotes' };

// Guía de resolución (del servidor): qué falta, quién puede aportarlo y desde qué pantalla. No concede nada; el servidor decide cada acción.
function Resolver({ g, orgId, d, can }: { g?: Resolucion; orgId: string; d: DdCase; can: (p: string) => boolean }) {
  if (!g) return <span className="muted">—</span>;
  const ruta = g.screen === 'LOT_RISK' ? `/organizaciones/${orgId}/riesgo/${d.subject.id}` : `/organizaciones/${orgId}/${RUTA[g.screen]}`;
  const tuyo = g.permission ? can(g.permission) : false;
  return (
    <>
      <div><strong>{NATURALEZA[g.kind]}.</strong> {g.action}</div>
      <div className="field-help">
        {g.roles.length ? <>Pueden: {g.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')}. {tuyo ? 'Tu cuenta puede hacerlo.' : 'Tu cuenta no tiene este permiso.'} </> : null}
        {g.kind === 'EXTERNAL' ? 'Depende de un tercero o de una decisión del propietario; Terra Link no puede resolverlo por sí solo.' : null}
        {g.limit ? <> {g.limit}</> : null}
      </div>
      <Link href={ruta}>Ir a {PANTALLA[g.screen]}</Link>
    </>
  );
}

const ACTION_LABEL: Record<string, string> = { START_REVIEW: 'Revisión iniciada', RETURN: 'Devuelta', APPROVE: 'Aprobada' };
const SECTION_LABEL: Record<string, string> = { subject: 'sujeto', quantities: 'cantidades', origin: 'origen', deliveries: 'entregas', plots: 'parcelas/geometrías', quality: 'calidad', documents: 'documentos', evidence: 'evidencias', risk: 'riesgo', mitigations: 'mitigaciones', profiles: 'perfiles' };

// Expediente de debida diligencia (UX_UI §18.3): datos, origen, riesgo, mitigación, verificación, preparación y paquete.
export default function DdCasePage() {
  const ws = useWorkspace();
  const { caseId } = useParams<{ caseId: string }>();
  const orgId = ws.activeOrg?.id ?? '';
  const [d, setD] = useState<DdCase | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [op, setOp] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState('');
  const base = `/api/v1/organizations/${orgId}`;
  const load = useCallback(async () => {
    if (!orgId || !ws.can('dd:read')) return;
    try { setD(await api<DdCase>(`${base}/dd-cases/${caseId}`)); setError(null); } catch (err) { setError(err as ApiError); }
  }, [orgId, ws, base, caseId]);
  useEffect(() => { void load(); }, [load]);
  if (!ws.activeOrg) return null;
  if (!ws.can('dd:read')) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite consultar expedientes de debida diligencia.', request_id: null })} />;
  const crumbs = [{ label: ws.activeOrg.name, href: `/organizaciones/${orgId}` }, { label: 'Debida diligencia', href: `/organizaciones/${orgId}/diligencia` }];
  if (error) return <><Breadcrumb items={[...crumbs, { label: 'Expediente' }]} /><ErrorPanel error={error} onRetry={load} /></>;
  if (!d) return <Loading label="Cargando expediente…" />;
  const s = d.latest;
  async function run(fn: () => Promise<unknown>, ok: string) {
    setActionError(null); setNotice(null); setBusy(true);
    try { await fn(); setOp(crypto.randomUUID()); setReason(''); setNotice(ok); await load(); } catch (err) { setActionError(err as ApiError); } finally { setBusy(false); }
  }
  const capture = () => run(() => api(`${base}/dd-cases/${caseId}/snapshots`, { method: 'POST', body: { operation_id: op } }), 'Instantánea capturada.');
  const review = (action: string) => (e?: FormEvent) => { e?.preventDefault(); if (s) void run(() => api(`${base}/dd-snapshots/${s.id}/reviews`, { method: 'POST', body: { operation_id: op, action, reason } }), 'Revisión registrada.'); };
  const exportKind = (kind: string) => s && run(() => api(`${base}/dd-snapshots/${s.id}/exports`, { method: 'POST', body: { operation_id: op, kind } }), kind === 'INTERNAL_REVIEW' ? 'Borrador interno generado. No es una DDS.' : 'Paquete generado. No es una DDS presentada.');
  return (
    <>
      <Breadcrumb items={[...crumbs, { label: d.case_number }]} />
      <PageHeader title={`Expediente ${d.case_number}`} meta={<>Lote {d.subject.code} · {s ? <StatusBadge tone={READINESS_TONE[s.readiness.effective]}>{s.readiness.label}</StatusBadge> : 'Sin instantánea'}</>} />
      <Alert tone="info">Preparación interna, paquete generado y presentación ante un sistema externo son hechos distintos. Presentación oficial: <strong>no presentada</strong> (sin integración).</Alert>
      {notice && <Alert tone="valid">{notice}</Alert>}
      {actionError && <><ErrorPanel error={actionError} /><ErrorDetails details={actionError.body.details} /></>}
      <section className="card" aria-labelledby="dd-data">
        <h2 id="dd-data">Datos</h2>
        <dl className="props">
          <dt>Alcance</dt><dd>{d.scope_note}</dd>
          <dt>Creado por</dt><dd>{d.created_by}</dd>
          {s && <><dt>Producto</dt><dd>{s.content.subject.product}</dd>
            <dt>Cantidad (ledger)</dt><dd>Existencia {s.content.quantities.physical} {s.content.quantities.unit} · reservado {s.content.quantities.reserved} · disponible {s.content.quantities.available}</dd></>}
        </dl>
        {d.actions.snapshot && <p><button type="button" disabled={busy} onClick={() => void capture()}>{s ? 'Capturar nueva instantánea' : 'Capturar instantánea'}</button></p>}
      </section>
      {!s && <p className="muted">Sin instantáneas: captura una para calcular los requisitos.</p>}
      <GeoEvaluationPanel orgId={orgId} caseId={caseId} />
      {s && <>
        <section className="card" aria-labelledby="dd-ready">
          <h2 id="dd-ready">Preparación (instantánea {s.snapshot_number})</h2>
          {s.readiness.effective === 'STALE' && <Alert tone="review" title="Preparación desactualizada">{s.readiness.note} Cambió: {s.readiness.changed_sections.map((c) => SECTION_LABEL[c] ?? c).join(', ')}.</Alert>}
          <p>{s.summary.met} de {s.summary.total} requisitos cumplidos · {s.summary.pending} pendientes · {s.summary.invalid} inválidos · {s.summary.not_evaluable} no evaluables. <span className="field-help">{s.summary.note}</span></p>
          <div className="table-wrap"><table aria-label="Requisitos">
            <thead><tr><th scope="col">Requisito</th><th scope="col">Estado</th><th scope="col">Detalle</th><th scope="col">Cómo se resuelve</th></tr></thead>
            <tbody>{s.requirements.map((r) => (
              <tr key={r.code}>
                <td>{r.label}<div className="field-help">{r.code}</div></td>
                <td><StatusBadge tone={REQ_STATUS[r.status].tone}>{REQ_STATUS[r.status].label}</StatusBadge></td>
                <td>{r.detail}{r.references.length ? ` · ${r.references.join(', ')}` : ''}<div className="field-help">Fuente: {r.source}</div></td>
                <td>{r.status === 'MET' ? <span className="muted">—</span> : <Resolver g={s.resolution?.[r.code]} orgId={orgId} d={d} can={ws.can} />}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
        <section className="card" aria-labelledby="dd-origin">
          <h2 id="dd-origin">Origen</h2>
          {s.redacted.geometry && <p className="field-help">Tu rol no permite ver coordenadas: se muestran solo el código y el hash de cada geometría.</p>}
          <ul className="plain" aria-label="Entregas de origen">{s.content.deliveries.map((x) => <li key={x.id}>{x.code}: {x.origin_plots.length ? x.origin_plots.join(', ') : 'sin parcela declarada'} · <span data-estado={cosechaDe(x.harvest).estado}>{cosechaDe(x.harvest).texto}</span></li>)}</ul>
          <ul className="plain" aria-label="Parcelas">{s.content.plots.map((p) => <li key={p.plot_id}>{p.plot_code} · versión {p.version_number ?? '—'} · {p.geometry_type ?? 'sin geometría'} · validación técnica {p.gis_status ?? 'sin evaluar'} · <span data-estado={paisDe(p.production_country).estado}>{paisDe(p.production_country).texto}</span>{p.geometry_hash ? <> · <code className="hash">{p.geometry_hash.slice(0, 16)}</code></> : null}</li>)}</ul>
          <p className="field-help">Calidad: {s.content.quality.map((q) => `${q.delivery_code} ${q.decision === 'NO_RESULT' ? 'pendiente de evaluación' : q.decision}`).join(' · ') || '—'}</p>
        </section>
        <section className="card" aria-labelledby="dd-risk">
          <h2 id="dd-risk">Riesgo y mitigación</h2>
          {s.content.risk ? <p>Evaluación {s.content.risk.evaluation_number} · reglas {s.content.risk.rule_set_version} ({s.content.risk.rule_set_approval === 'APPROVED' ? 'aprobadas' : 'sin aprobar'}) · resultado técnico {s.content.risk.technical_result} · conclusión {s.content.risk.conclusion === 'UNDETERMINED' ? 'Indeterminada' : s.content.risk.conclusion} · revisión {s.content.risk.review_process}</p> : <p className="muted">Sin evaluación de riesgo.</p>}
          <ul className="plain" aria-label="Mitigaciones del expediente">{s.content.mitigations.map((m) => <li key={m.id}>{m.factor_code} · {m.status === 'VERIFIED' ? 'verificada (no equivale a aprobación regulatoria)' : m.status}</li>)}</ul>
        </section>
        <section className="card" aria-labelledby="dd-docs">
          <h2 id="dd-docs">Documentos y evidencias (versiones exactas)</h2>
          {s.content.documents.length === 0 ? <p className="muted">Sin documentos en el expediente.</p> : (
            <ul className="plain" aria-label="Documentos del expediente">{s.content.documents.map((x) => <li key={`${x.used_by}${x.version_id}${x.reference}`}>{x.title} · versión {x.version_number} · {x.used_by === 'DELIVERY_SUPPORT' ? `soporte de ${x.reference}` : `soporte de mitigación ${x.reference}`} · <code className="hash">{x.sha256.slice(0, 16)}</code></li>)}</ul>
          )}
          <p className="field-help">{s.content.evidence.length} evidencia(s) registrada(s) en el grafo; sin perfil jurídico no hay lista de evidencias exigibles.</p>
        </section>
        <section className="card" aria-labelledby="dd-rev">
          <h2 id="dd-rev">Revisión</h2>
          <p>Estado: {DD_PROCESS[s.review.process_status]}</p>
          <ol className="plain" aria-label="Historia de revisión del expediente">{s.review.history.map((r, i) => <li key={i}>{ACTION_LABEL[r.action]}: {r.reason} · {r.reviewer} · {new Date(r.at).toLocaleString('es-EC')}</li>)}</ol>
          {(s.actions.start_review || s.actions.return || s.actions.approve) && (
            <form className="form" onSubmit={review(s.actions.start_review ? 'START_REVIEW' : 'RETURN')}>
              <label htmlFor="dd-reason">Motivo</label>
              <input id="dd-reason" required minLength={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="actions">
                {s.actions.start_review && <button type="submit" disabled={busy}>Iniciar revisión</button>}
                {s.actions.return && <button type="submit" className="secondary" disabled={busy}>Devolver con motivo</button>}
                {s.actions.approve && <button type="button" disabled={busy || !!s.actions.approve_blocked_reason} aria-describedby="dd-approve-why" onClick={() => review('APPROVE')()}>Aprobar preparación</button>}
              </div>
              {s.actions.approve && s.actions.approve_blocked_reason && <p id="dd-approve-why" className="field-help">{s.actions.approve_blocked_reason} Revisa los requisitos no cumplidos arriba.</p>}
            </form>
          )}
        </section>
        <section className="card" aria-labelledby="dd-pkg">
          <h2 id="dd-pkg">Paquete</h2>
          <ul className="plain" aria-label="Artefactos del expediente">
            <li><strong>Instantánea</strong>: fuente inmutable con manifiesto de versiones y hashes.</li>
            <li><strong>Borrador interno</strong>: para revisión; puede omitir contenido por alcance de quien exporta (lo declara).</li>
            <li><strong>Paquete final</strong>: exige preparación aprobada y alcance completo; nunca se exporta incompleto.</li>
            <li><strong>Presentación oficial</strong>: no implementada.</li>
          </ul>
          <p className="field-help">Pendiente en todo paquete: los archivos no se incluyen (solo versión y SHA-256) y los campos del perfil destino no están definidos.</p>
          <p className="field-help">El paquete se genera desde la instantánea {s.snapshot_number} (<code className="hash">{s.content_hash.slice(0, 16)}</code>), no desde datos en curso. {s.submission.note}</p>
          {s.actions.export_internal && (
            <div className="actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => void exportKind('INTERNAL_REVIEW')}>Generar borrador interno</button>
              <button type="button" disabled={busy || !s.actions.export_package} aria-describedby="dd-pkg-why" onClick={() => void exportKind('DD_PACKAGE')}>Generar paquete de diligencia</button>
            </div>
          )}
          {s.actions.export_internal && s.actions.export_package_blocked_reason && <p id="dd-pkg-why" className="field-help">{s.actions.export_package_blocked_reason}</p>}
          {s.exports.length === 0 ? <p className="muted">Sin paquetes generados.</p> : (
            <ul className="plain" aria-label="Paquetes generados">{s.exports.map((x) => (
              <li key={x.id}>{x.label} · {x.exported_by} · {new Date(x.exported_at).toLocaleString('es-EC')} · <code className="hash">{x.package_hash.slice(0, 16)}</code> · no presentado
                {s.actions.export_internal && <> <button type="button" className="secondary inline" onClick={() => void run(() => apiDownload(`${base}/dd-exports/${x.id}/download`, `${d.case_number}.json`), 'Paquete descargado. Descargar no es presentar una DDS.')}>Descargar</button></>}</li>
            ))}</ul>
          )}
        </section>
      </>}
      {d.history.length > 0 && (
        <section className="card" aria-labelledby="dd-hist">
          <h2 id="dd-hist">Instantáneas</h2>
          <ol className="plain" aria-label="Instantáneas del expediente">{d.history.map((h) => <li key={h.id}>Instantánea {h.snapshot_number}: {h.readiness_label} al capturar · {new Date(h.captured_at).toLocaleString('es-EC')} · <code className="hash">{h.content_hash.slice(0, 16)}</code></li>)}</ol>
        </section>
      )}
    </>
  );
}
