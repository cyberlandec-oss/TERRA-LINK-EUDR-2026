'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, apiUpload } from './api';
import { AVAILABILITY, type Doc } from './documents';
import { useI18n } from './i18n';
import { hasImageMetadata, stripImageMetadata } from './image-metadata';
import { Alert, EmptyState, ErrorPanel, StatusBadge } from './ui';

// A-01 — Evidencias del recorrido de campo adjuntas a la PARCELA (foto, croquis, acta).
//   · Se suben con el mismo servicio de documentos: escáner antimalware, límites, versiones y alcance por titular.
//   · Subir una evidencia NO la aprueba ni la revisa: es una facultad distinta (`document:review`, `evidence:verify`).
//   · Fotografías: contrato D-41 de la fotografía de campo (el mismo de la app móvil). Se sube una COPIA procesada sin EXIF/XMP/IPTC/
//     comentarios (solo se conserva la orientación) como «Fotografía de campo» (dato personal); el original NO se toca y el servidor
//     rechaza una imagen que aún traiga metadatos. Actas y croquis en PDF van como «Evidencia del recorrido».

export function FieldEvidence({ orgId, plotId, canUpload }: { orgId: string; plotId: string; canUpload: boolean }) {
  const { t, dt, num } = useI18n();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [denied, setDenied] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [stripped, setStripped] = useState<boolean | null>(null);
  const op = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Solo las evidencias del recorrido (foto, croquis, acta); los demás documentos de la parcela están en «Documentos y soportes».
      setDocs((await api<Doc[]>(`/api/v1/organizations/${orgId}/documents?owner_type=plot&owner_id=${plotId}`)).filter((d) => d.document_type === 'FIELD_EVIDENCE' || d.document_type === 'FIELD_PHOTO'));
    } catch (err) {
      if ((err as ApiError).status === 403) { setDenied(true); return; }
      setError(err as ApiError);
    }
  }, [orgId, plotId]);
  useEffect(() => { void load(); }, [load]);

  if (denied) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    op.current ??= crypto.randomUUID(); // reintentar tras un corte no duplica el documento
    setBusy(true); setError(null); setDone(null);
    const form = new FormData();
    form.append('operation_id', op.current);
    let blob: Blob = file; let fileName = file.name; let docType = 'FIELD_EVIDENCE'; let removed: boolean | null = null;
    const mime = file.type || (/\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : '');
    if (mime === 'image/jpeg' || mime === 'image/png') {
      try {
        const original = new Uint8Array(await file.arrayBuffer());
        removed = hasImageMetadata(original, mime);
        blob = new Blob([stripImageMetadata(original, mime) as unknown as BlobPart], { type: mime });
        fileName = `fotografia.${mime === 'image/png' ? 'png' : 'jpg'}`; // nombre neutro: el del archivo puede contener datos personales
        docType = 'FIELD_PHOTO';
      } catch {
        setBusy(false);
        setError(new ApiError(422, { code: 'IMAGE_NOT_PREPARABLE', message: t('La imagen no se pudo preparar (estructura no válida). No se subió nada.'), request_id: null }));
        return;
      }
    }
    form.append('document_type', docType);
    form.append('owner_type', 'plot');
    form.append('owner_id', plotId);
    form.append('title', title.trim());
    form.append('file', blob, fileName);
    try {
      await apiUpload(`/api/v1/organizations/${orgId}/documents`, form);
      setDone(file.name); setStripped(removed); setFile(null); setTitle(''); op.current = null;
      await load();
    } catch (err) {
      const ae = err as ApiError;
      if (!(ae.status === 0 || ae.status >= 500)) op.current = null; // un rechazo exige otro archivo; un corte se reintenta igual
      setError(ae);
    } finally { setBusy(false); }
  }

  return (
    <section className="card" aria-labelledby="fe-title">
      <h2 id="fe-title">{t('Evidencias del recorrido de campo')}</h2>
      <p className="muted">{t('Fotos, croquis o actas de esta parcela. Subir una evidencia no la aprueba: la revisión es un paso aparte de otra persona autorizada.')}</p>
      {error && <ErrorPanel error={error} onRetry={load} />}
      {docs && docs.length === 0 && <EmptyState title={t('Todavía no hay evidencias de esta parcela.')} />}
      {docs && docs.length > 0 && (
        <div className="table-wrap">
          <table aria-label={t('Evidencias de la parcela')}>
            <thead><tr><th scope="col">{t('Título')}</th><th scope="col">{t('Tipo')}</th><th scope="col">{t('Versión')}</th><th scope="col">{t('Estado')}</th><th scope="col">{t('Subida')}</th></tr></thead>
            <tbody>
              {docs.map((d) => {
                const v = d.versions.find((x) => x.is_current) ?? d.versions[0];
                const a = v ? AVAILABILITY[v.availability] : null;
                return (
                  <tr key={d.id}>
                    <td><Link href={`/organizaciones/${orgId}/documentos/${d.id}`}>{d.title}</Link></td>
                    <td>{t(d.type_label)}</td>
                    <td>{v ? `v${v.version_number} · ${num(v.size_bytes / 1024, 1)} KB` : '—'}</td>
                    <td>{a ? <StatusBadge tone={a.tone}>{t(a.label)}</StatusBadge> : '—'}</td>
                    <td>{v ? dt(v.uploaded_at) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canUpload && (
        <form onSubmit={submit} className="stack" aria-label={t('Adjuntar una evidencia')}>
          <h3>{t('Adjuntar una evidencia')}</h3>
          {done && <Alert tone="valid" title={t('Evidencia recibida: {f}', { f: done })}><p>{t('Queda pendiente del análisis antimalware; no estará disponible hasta que salga limpio.')}</p>{stripped !== null && <p>{stripped ? t('Se quitaron los metadatos de la copia subida; tu archivo original no se modificó.') : t('La foto no traía metadatos que quitar.')}</p>}</Alert>}
          <label htmlFor="fe-file">{t('Archivo (PDF, JPEG o PNG)')}</label>
          <input id="fe-file" type="file" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); op.current = null; setError(null); setDone(null); setStripped(null); }} />
          <label htmlFor="fe-title-in">{t('Título')}</label>
          <input id="fe-title-in" required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="field-help">{t('Las fotos se suben como «Fotografía de campo»: se prepara una copia sin metadatos (EXIF/XMP: ubicación, dispositivo, hora). Tu archivo original no se modifica y sigue en tu equipo; la copia tiene otro SHA-256. La ubicación de la parcela se registra aparte, con su procedencia.')}</p>
          <p className="field-help">{t('El contenido de las fotografías de campo es dato personal: lo ven los roles con acceso a la identidad del productor y, en sus propias parcelas, el productor vinculado.')}</p>
          <button type="submit" disabled={!file || busy} aria-busy={busy}>{busy ? t('Subiendo…') : t('Subir evidencia')}</button>
        </form>
      )}
    </section>
  );
}
