'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, apiDownload, apiUpload, session } from '../../../../lib/api';
import { useWorkspace } from '../../../../lib/workspace';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge, type Tone } from '../../../../lib/ui';

// P0-026 — Importación Excel (UX_UI §20.3): plantilla → selección → mapeo → vista previa → validación → confirmación →
// resultado. La vista previa no guarda nada; la confirmación es atómica y el servidor revalida todo.

interface TemplateInfo {
  template: string;
  entity: string;
  key_field: string;
  new_status: string;
  clear_token: string;
  fields: Array<{ field: string; header: string; label: string; required: boolean; required_on_create: boolean; immutable: boolean; identity: boolean; rule: string }>;
  rules: string[];
  atomicity: { mode: string; description: string };
  limits: { max_file_bytes: number; max_rows: number; formats: string[] };
  not_implemented: string[];
}
type Slug = 'producers' | 'products' | 'plots' | 'deliveries' | 'lots';
interface TemplateOption { template: string; slug: Slug; entity: string; usable: boolean; required_permission: string | null }
interface Column { column: string; header: string | null; mapped_field: string | null; suggested_field: string | null; samples: string[] | null }
interface Batch {
  id: string; template: string; status: 'UPLOADED' | 'MAPPED' | 'COMMITTED' | 'DISCARDED'; row_version: number; row_count: number; created_at: string;
  file: { filename: string | null; byte_size: number; sha256: string; sheet: string };
  columns: Column[]; samples_hidden_reason: string | null; summary: Summary | null; can_map_identity: boolean;
  same_file_previous_imports: Array<{ id: string; status: string; created_at: string }>;
}
interface Summary { created: number; updated: number; unchanged: number; failed: number; duplicate_reviews_pending: number; new_status: string }
interface Issue { column: string | null; field: string | null; code: string; message: string }
interface PreviewRow {
  row_number: number; code: string | null; action: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'ERROR'; changed_fields: string[];
  fields: Record<string, { state: string; quality: string; value?: string | null }>; errors: Issue[]; warnings: Issue[]; effects?: string[];
}
interface Preview {
  plan_hash: string; can_commit: boolean; offset: number; limit: number;
  summary: { total: number; create: number; update: number; unchanged: number; error: number; warnings: number };
  rows: PreviewRow[];
}
interface BatchListItem { id: string; template: string; status: Batch['status']; original_filename: string | null; row_count: number; created_at: string }

const NEW_STATUS: Record<string, string> = { DRAFT: 'borrador', ACTIVE: 'activo', OPEN: 'abierto' };
const ENTITY_LABEL: Record<string, string> = { PRODUCTORES_V1: 'Productores', PRODUCTOS_V1: 'Productos', PARCELAS_V1: 'Parcelas', ENTREGAS_V1: 'Entregas (borradores)', LOTES_V1: 'Lotes (asignar recepciones confirmadas)' };
const ACTION: Record<PreviewRow['action'], { label: string; tone: Tone }> = {
  CREATE: { label: 'Se creará', tone: 'process' },
  UPDATE: { label: 'Se actualizará', tone: 'review' },
  UNCHANGED: { label: 'Sin cambios', tone: 'neutral' },
  ERROR: { label: 'Error', tone: 'blocked' },
};
const STATUS: Record<Batch['status'], string> = { UPLOADED: 'Cargado, sin mapear', MAPPED: 'Mapeado, pendiente de confirmar', COMMITTED: 'Confirmado', DISCARDED: 'Descartado' };
const STATE: Record<string, string> = { PROVIDED: 'con dato (heredado, no validado)', MISSING: 'vacío: no cambia', CLEAR: 'se vaciará (#BORRAR)', NOT_MAPPED: 'sin mapear: desconocido' };
const PAGE = 50;

export default function ImportsPage() {
  const { id: orgId } = useParams<{ id: string }>();
  const router = useRouter();
  const ws = useWorkspace();
  const allowed = ws.can('import:manage');
  const base = `/api/v1/organizations/${orgId}/imports`;
  const [options, setOptions] = useState<TemplateOption[] | null>(null);
  const [slug, setSlug] = useState<Slug>('producers');
  const [info, setInfo] = useState<TemplateInfo | null>(null);
  const [list, setList] = useState<BatchListItem[] | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Summary | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) { session.clear(); router.replace('/'); return; }
    setError(err as ApiError);
  }, [router]);

  const load = useCallback(async () => {
    if (!allowed) return;
    setError(null);
    try {
      const [o, i, l] = await Promise.all([api<TemplateOption[]>(`${base}/templates`), api<TemplateInfo>(`${base}/templates/${slug}`), api<BatchListItem[]>(base)]);
      setOptions(o);
      setInfo(i);
      setList(l);
    } catch (err) { fail(err); }
  }, [allowed, base, fail, slug]);
  useEffect(() => { void load(); }, [load]);

  const loadPreview = useCallback(async (id: string, offset = 0) => {
    setPreview(await api<Preview>(`${base}/${id}/preview?offset=${offset}&limit=${PAGE}`));
  }, [base]);

  async function open(id: string) {
    setError(null); setPreview(null); setResult(null);
    try {
      const b = await api<Batch>(`${base}/${id}`);
      const s = options?.find((o) => o.template === b.template)?.slug;
      if (s && s !== slug) setSlug(s);
      setBatch(b);
      if (b.status === 'MAPPED') await loadPreview(id);
      if (b.status === 'COMMITTED') setResult(b.summary);
    } catch (err) { fail(err); }
  }

  if (!allowed) {
    return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: 'Tu rol no permite importar datos. Pide a la administración de tu organización que lo haga o que te asigne un rol autorizado.', request_id: null })} />;
  }
  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg?.name ?? 'Organización', href: `/organizaciones/${orgId}` }, { label: 'Importar datos (Excel)' }]} />
      <PageHeader title="Importar datos desde Excel" meta="Migra registros existentes. Nada se guarda hasta que confirmes, y los datos importados quedan como heredados y no validados." />
      {options && (
        <section className="card" aria-labelledby="que-importar">
          <h2 id="que-importar">¿Qué quieres importar?</h2>
          <fieldset>
            <legend className="visually-hidden">Plantilla</legend>
            {options.map((o) => (
              <label key={o.slug} className="checkbox-row">
                <input type="radio" name="plantilla" value={o.slug} checked={slug === o.slug} disabled={!o.usable || (!!batch && batch.status !== 'COMMITTED' && batch.status !== 'DISCARDED')}
                  onChange={() => { setSlug(o.slug); setBatch(null); setPreview(null); setResult(null); setInfo(null); }} />
                {ENTITY_LABEL[o.template] ?? o.entity}{!o.usable && <span className="muted"> — tu rol no gestiona {o.entity}; el permiso general de importación no basta</span>}
              </label>
            ))}
          </fieldset>
        </section>
      )}
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!info && !error && <Loading label="Cargando plantilla…" />}
      {info && (
        <>
          <TemplateStep orgId={orgId} slug={slug} info={info} onError={fail} />
          <UploadStep base={base} info={info} onUploaded={(b) => { setBatch(b); setPreview(null); setResult(null); void load(); }} onError={setError} />
          {batch && batch.status !== 'COMMITTED' && batch.status !== 'DISCARDED' && (
            <MappingStep base={base} batch={batch} info={info} onMapped={async (b) => { setBatch(b); try { await loadPreview(b.id); } catch (err) { fail(err); } }} />
          )}
          {batch && preview && batch.status === 'MAPPED' && (
            <PreviewStep base={base} batch={batch} preview={preview} info={info} onPage={(o) => loadPreview(batch.id, o).catch(fail)}
              onCommitted={(s) => { setResult(s); setBatch({ ...batch, status: 'COMMITTED' }); void load(); }}
              onStale={() => loadPreview(batch.id).catch(fail)}
              onDiscarded={() => { setBatch(null); setPreview(null); void load(); }} />
          )}
          {batch && result && <ResultStep base={base} batch={batch} summary={result} orgId={orgId} info={info} />}
          <section className="card" aria-labelledby="recientes">
            <h2 id="recientes">Cargas recientes</h2>
            {!list && <Loading label="Cargando…" />}
            {list && list.length === 0 && <EmptyState title="Todavía no hay cargas en esta organización." />}
            {list && list.length > 0 && (
              <div className="table-wrap">
                <table aria-label="Cargas recientes">
                  <thead><tr><th>Archivo</th><th>Datos</th><th>Filas</th><th>Estado</th><th>Fecha</th><th><span className="visually-hidden">Acción</span></th></tr></thead>
                  <tbody>
                    {list.map((b) => (
                      <tr key={b.id}>
                        <td>{b.original_filename ?? '—'}</td><td>{ENTITY_LABEL[b.template] ?? b.template}</td><td>{b.row_count}</td><td>{STATUS[b.status]}</td>
                        <td>{new Date(b.created_at).toLocaleString('es-EC')}</td>
                        <td>{b.status !== 'DISCARDED' && <button type="button" className="secondary inline" onClick={() => open(b.id)}>Abrir</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function TemplateStep({ orgId, slug, info, onError }: { orgId: string; slug: string; info: TemplateInfo; onError: (e: unknown) => void }) {
  return (
    <section className="card" aria-labelledby="paso-plantilla">
      <h2 id="paso-plantilla">1. Plantilla</h2>
      <p>Plantilla <strong>{info.template}</strong> ({info.entity}). Los nuevos quedan en estado <strong>{NEW_STATUS[info.new_status] ?? info.new_status}</strong>. Todavía no se pueden importar: {info.not_implemented.join(', ')}.</p>
      {info.template === 'LOTES_V1' && (
        <Alert tone="info" title="Esta plantilla solo asigna recepciones confirmadas a lotes">
          No crea recepciones, stock ni origen: lo disponible sale del inventario y una cantidad escrita en Excel no demuestra existencia física. La vista previa explica cada movimiento. No procesa, convierte, libera calidad, cierra ni reabre lotes. La plantilla trae una hoja con las recepciones disponibles para copiar su id.
        </Alert>
      )}
      {info.template === 'ENTREGAS_V1' && (
        <Alert tone="info" title="Esta plantilla solo crea o actualiza BORRADORES de entrega">
          No registra entregas ni confirma recepción, pesaje, calidad, inventario, cierre ni debida diligencia. Registrar es una acción explícita desde cada entrega. Una entrega registrada no se modifica por importación: usa su corrección.
        </Alert>
      )}
      {info.template === 'PARCELAS_V1' && (
        <Alert tone="info" title="Esta plantilla NO importa coordenadas ni geometría">
          Solo datos descriptivos y superficie declarada (ha). La geometría existente se conserva tal cual, también al actualizar la superficie declarada (versión nueva, no una captura). Las coordenadas se registran desde la parcela o con GeoJSON. Importar no valida la parcela ni hereda evaluaciones GIS.
        </Alert>
      )}
      <button type="button" onClick={() => apiDownload(`/api/v1/organizations/${orgId}/imports/templates/${slug}.xlsx`, `plantilla-${slug}.xlsx`).catch(onError)}>Descargar plantilla (.xlsx)</button>
      <details>
        <summary>Campos y reglas</summary>
        <div className="table-wrap">
          <table aria-label="Campos de la plantilla">
            <thead><tr><th>Columna</th><th>Campo</th><th>Regla</th></tr></thead>
            <tbody>{info.fields.map((f) => <tr key={f.field}><td><code>{f.header}</code></td><td>{f.label}{f.required ? ' (obligatorio)' : f.required_on_create ? ' (obligatorio en altas)' : ''}{f.immutable ? ' · no cambia tras el alta' : ''}{f.identity ? ' · identidad' : ''}</td><td>{f.rule}</td></tr>)}</tbody>
          </table>
        </div>
        <ul>{info.rules.map((r) => <li key={r}>{r}</li>)}</ul>
      </details>
    </section>
  );
}

function UploadStep({ base, info, onUploaded, onError }: { base: string; info: TemplateInfo; onUploaded: (b: Batch) => void; onError: (e: ApiError) => void }) {
  const ws = useWorkspace();
  const [file, setFile] = useState<File | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !operationId) return;
    if (file.size > info.limits.max_file_bytes) { setLocal(`El archivo supera ${Math.round(info.limits.max_file_bytes / 1024 / 1024)} MB.`); return; }
    setBusy(true); setLocal(null);
    try {
      const form = new FormData();
      form.append('operation_id', operationId); // estable por archivo elegido: un reintento no crea otra carga
      form.append('template', info.template);
      form.append('file', file);
      const r = await apiUpload<{ batch: Batch }>(base, form);
      onUploaded(r.data.batch);
    } catch (err) { onError(err as ApiError); } finally { setBusy(false); }
  }

  return (
    <section className="card" aria-labelledby="paso-archivo">
      <h2 id="paso-archivo">2. Selección del archivo</h2>
      <p className="muted">Organización activa: <strong>{ws.activeOrg?.name}</strong>. Formato {info.limits.formats.join(', ')}, hasta {Math.round(info.limits.max_file_bytes / 1024 / 1024)} MB y {info.limits.max_rows} filas. Sin macros; las fórmulas no se evalúan.</p>
      <form onSubmit={submit}>
        <label htmlFor="archivo">Libro de Excel</label>
        <input id="archivo" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required
          onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setOperationId(f ? crypto.randomUUID() : null); setLocal(null); }} />
        <button type="submit" disabled={!file || busy}>{busy ? 'Analizando…' : 'Analizar archivo'}</button>
        {local && <Alert tone="blocked">{local}</Alert>}
      </form>
    </section>
  );
}

function MappingStep({ base, batch, info, onMapped }: { base: string; batch: Batch; info: TemplateInfo; onMapped: (b: Batch) => void }) {
  const initial = Object.fromEntries(batch.columns.map((c) => [c.column, c.mapped_field ?? '']));
  const [cols, setCols] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const suggestions = batch.columns.filter((c) => c.suggested_field && !cols[c.column]);
  const chosen = Object.values(cols).filter(Boolean);
  const dup = chosen.filter((f, i) => chosen.indexOf(f) !== i);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      onMapped(await api<Batch>(`${base}/${batch.id}/mapping`, { method: 'POST', body: { columns: Object.fromEntries(Object.entries(cols).filter(([, f]) => f)), expected_version: batch.row_version } }));
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }

  return (
    <section className="card" aria-labelledby="paso-mapeo">
      <h2 id="paso-mapeo">3. Mapeo de columnas</h2>
      <p className="muted">{batch.file.filename} · hoja «{batch.file.sheet}» · {batch.row_count} filas. Asocia cada columna a un campo; las columnas sin asociar se ignoran y esos campos no cambian.</p>
      {batch.same_file_previous_imports.length > 0 && (
        <Alert tone="review" title="Este mismo archivo ya se cargó antes">Al reimportar, los productores existentes se buscan por código: no se duplican, y las filas sin diferencias quedan «sin cambios».</Alert>
      )}
      {batch.samples_hidden_reason && <Alert tone="info">{batch.samples_hidden_reason}</Alert>}
      {suggestions.length > 0 && (
        <button type="button" className="secondary" onClick={() => setCols({ ...cols, ...Object.fromEntries(suggestions.map((c) => [c.column, c.suggested_field!])) })}>
          Usar sugerencias por nombre de encabezado ({suggestions.length})
        </button>
      )}
      <form onSubmit={submit}>
        <div className="table-wrap">
          <table aria-label="Mapeo de columnas">
            <thead><tr><th>Columna</th><th>Encabezado</th><th>Ejemplos de esta carga</th><th>Campo de Terra Link</th></tr></thead>
            <tbody>
              {batch.columns.map((c) => (
                <tr key={c.column}>
                  <td>{c.column}</td>
                  <td>{c.header ?? <span className="muted">(sin encabezado)</span>}</td>
                  <td>{c.samples === null ? <span className="muted">oculto</span> : c.samples.join(' · ') || <span className="muted">vacío</span>}</td>
                  <td>
                    <label htmlFor={`map-${c.column}`} className="visually-hidden">Campo para la columna {c.column}</label>
                    <select id={`map-${c.column}`} value={cols[c.column] ?? ''} onChange={(e) => setCols({ ...cols, [c.column]: e.target.value })}>
                      <option value="">No importar</option>
                      {info.fields.map((f) => <option key={f.field} value={f.field} disabled={f.identity && !batch.can_map_identity}>{f.label}{f.required ? ' *' : ''}{f.immutable ? ' (no cambia tras el alta)' : ''}{f.identity ? ' (identidad)' : ''}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {dup.length > 0 && <Alert tone="blocked">Un campo está asociado a dos columnas. Elige solo una.</Alert>}
        <button type="submit" disabled={busy || dup.length > 0 || !chosen.includes(info.key_field)}>{busy ? 'Guardando…' : 'Guardar mapeo y ver vista previa'}</button>
        {!chosen.includes(info.key_field) && <p className="muted">Asocia el {info.fields.find((x) => x.field === info.key_field)?.label.toLowerCase() ?? 'código'}: es la clave para no duplicar.</p>}
        {error && <ErrorPanel error={error} />}
      </form>
    </section>
  );
}

function PreviewStep({ base, batch, preview, info, onPage, onCommitted, onStale, onDiscarded }: {
  base: string; batch: Batch; preview: Preview; info: TemplateInfo; onPage: (offset: number) => void;
  onCommitted: (s: Summary) => void; onStale: () => void; onDiscarded: () => void;
}) {
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [operationId] = useState(() => crypto.randomUUID()); // estable: reintentar no confirma dos veces
  const s = preview.summary;

  async function commit() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ summary: Summary }>(`${base}/${batch.id}/commit`, { method: 'POST', body: { operation_id: operationId, plan_hash: preview.plan_hash } });
      onCommitted(r.summary);
    } catch (err) {
      setError(err as ApiError);
      if (err instanceof ApiError && err.body.code === 'PREVIEW_STALE') onStale();
    } finally { setBusy(false); }
  }
  async function discard() {
    setBusy(true);
    try { await api(`${base}/${batch.id}/discard`, { method: 'POST' }); onDiscarded(); } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }

  return (
    <>
      <section className="card" aria-labelledby="paso-previa">
        <h2 id="paso-previa">4. Vista previa y validación</h2>
        <Alert tone="info" title="Todavía no se guardó nada">Esta vista se calcula con los datos y permisos actuales.</Alert>
        <p className="actions" aria-label="Resumen de la vista previa">
          <StatusBadge tone="process">{s.create} nuevas</StatusBadge>
          <StatusBadge tone="review">{s.update} actualizaciones</StatusBadge>
          <StatusBadge tone="neutral">{s.unchanged} sin cambios</StatusBadge>
          <StatusBadge tone={s.error ? 'blocked' : 'valid'}>{s.error} con error</StatusBadge>
          {s.warnings > 0 && <StatusBadge tone="review">{s.warnings} con advertencias</StatusBadge>}
        </p>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => apiDownload(`${base}/${batch.id}/report`, 'informe-importacion.xlsx').catch((e) => setError(e as ApiError))}>Descargar informe de filas (.xlsx)</button>
        </div>
        <div className="table-wrap">
          <table aria-label="Filas de la vista previa">
            <thead><tr><th>Fila</th><th>Código</th><th>Resultado</th><th>Detalle</th></tr></thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.row_number}>
                  <td>{r.row_number}</td>
                  <td>{r.code ?? (r.action === 'CREATE' ? 'nuevo (código al confirmar)' : '—')}</td>
                  <td><StatusBadge tone={ACTION[r.action].tone}>{ACTION[r.action].label}</StatusBadge></td>
                  <td>
                    {r.errors.map((e, i) => <div key={i} className="error">{e.column ? `Columna ${e.column}: ` : ''}{e.message}</div>)}
                    {r.warnings.map((w, i) => <div key={i} className="muted">Advertencia{w.column ? ` (columna ${w.column})` : ''}: {w.message}</div>)}
                    {r.effects?.map((e, i) => <div key={`ef${i}`}><strong>Movimiento:</strong> {e}</div>)}
                    {r.action === 'UPDATE' && !r.effects?.length && <div>Cambia: {r.changed_fields.map((f) => info.fields.find((x) => x.field === f)?.label ?? f).join(', ')}</div>}
                    <details>
                      <summary>Campos</summary>
                      <ul>{info.fields.map((f) => r.fields[f.field] && <li key={f.field}>{f.label}: {STATE[r.fields[f.field].state]}{r.fields[f.field].value ? ` — ${r.fields[f.field].value}` : ''}</li>)}</ul>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.total > PAGE && (
          <div className="actions">
            <button type="button" className="secondary inline" disabled={preview.offset === 0} onClick={() => onPage(Math.max(0, preview.offset - PAGE))}>Anteriores</button>
            <span className="muted">Filas {preview.offset + 1}–{Math.min(preview.offset + PAGE, s.total)} de {s.total}</span>
            <button type="button" className="secondary inline" disabled={preview.offset + PAGE >= s.total} onClick={() => onPage(preview.offset + PAGE)}>Siguientes</button>
          </div>
        )}
      </section>
      <section className="card" aria-labelledby="paso-confirmar">
        <h2 id="paso-confirmar">5. Confirmación</h2>
        <Alert tone={s.error ? 'blocked' : 'review'} title="Importación atómica: todo o nada">{info.atomicity.description}</Alert>
        <ul>
          <li>Repetidos: se identifican por código dentro de tu organización; las filas sin diferencias no generan cambios.</li>
          <li>Los {info.entity} nuevos quedan en estado <strong>{NEW_STATUS[info.new_status] ?? info.new_status}</strong>. Importar no valida datos ni confirma entregas, calidad, inventario o debida diligencia.</li>
          {info.template === 'PRODUCTORES_V1' && <li>Una coincidencia de documento abre una revisión de posible duplicado; nunca se fusiona.</li>}
          {info.template === 'PRODUCTOS_V1' && <li>Código, estado/presentación y unidad no cambian después del alta; un producto inactivo no se reactiva.</li>}
          {info.template === 'LOTES_V1' && <li>Se moverán en el inventario las cantidades indicadas en «Movimiento» (de la recepción al lote, mismo centro). La disponibilidad se vuelve a comprobar al confirmar; si cambió, no se guarda nada.</li>}
          {info.template === 'ENTREGAS_V1' && <li>Se crean o actualizan borradores. Sin código, la fila crea una entrega nueva; si esa misma fila ya se importó, no se repite. El periodo de cosecha se guarda como se declara; el peso es el declarado, en KG.</li>}
          {info.template === 'PARCELAS_V1' && <li>No se importan coordenadas ni geometría. La superficie declarada crea una versión nueva sin validar que conserva la geometría vigente; no se reasigna productor ni se reactivan parcelas.</li>}
        </ul>
        {preview.can_commit ? (
          <>
            <label className="checkbox-row"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Revisé la vista previa y entiendo que se crearán {s.create} y se actualizarán {s.update} {info.entity}.</label>
            <div className="actions">
              <button type="button" disabled={!ack || busy} onClick={commit}>{busy ? 'Confirmando…' : 'Confirmar importación'}</button>
              <button type="button" className="secondary" disabled={busy} onClick={discard}>Descartar carga</button>
            </div>
          </>
        ) : (
          <>
            <p>{s.error ? 'Corrige las filas con error en tu archivo y vuelve a cargarlo.' : 'No hay nada que importar: todas las filas coinciden con lo registrado.'}</p>
            <button type="button" className="secondary" disabled={busy} onClick={discard}>Descartar carga</button>
          </>
        )}
        {error && <ErrorPanel error={error} />}
      </section>
    </>
  );
}

function ResultStep({ base, batch, summary, orgId, info }: { base: string; batch: Batch; summary: Summary; orgId: string; info: TemplateInfo }) {
  const listPath = batch.template === 'PRODUCTOS_V1' ? 'productos' : batch.template === 'PARCELAS_V1' ? 'parcelas' : batch.template === 'ENTREGAS_V1' ? 'entregas?status=DRAFT' : batch.template === 'LOTES_V1' ? 'lotes' : 'productores?status=DRAFT';
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <section className="card" aria-labelledby="paso-resultado">
      <h2 id="paso-resultado">6. Resultado</h2>
      <Alert tone="valid" title="Importación confirmada">Creados {summary.created} (estado {NEW_STATUS[summary.new_status ?? info.new_status] ?? info.new_status}), actualizados {summary.updated}, sin cambios {summary.unchanged}, fallidos {summary.failed}.</Alert>
      {summary.duplicate_reviews_pending > 0 && <Alert tone="review">Se abrieron {summary.duplicate_reviews_pending} revisión(es) de posible duplicado. <a href={`/organizaciones/${orgId}/productores/coincidencias`}>Revisarlas</a></Alert>}
      <div className="actions">
        <button type="button" className="secondary" onClick={() => apiDownload(`${base}/${batch.id}/report`, 'informe-importacion.xlsx').catch((e) => setError(e as ApiError))}>Descargar informe (.xlsx)</button>
        <a href={`/organizaciones/${orgId}/${listPath}`}>Ver {info.entity}</a>
      </div>
      {error && <ErrorPanel error={error} />}
    </section>
  );
}
