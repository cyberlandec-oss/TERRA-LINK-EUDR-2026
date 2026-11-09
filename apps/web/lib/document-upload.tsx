'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, apiUpload } from './api';
import { AVAILABILITY, OWNER_LABEL, kb, type Doc, type DocType } from './documents';
import { useI18n } from './i18n';
import { ErrorPanel } from './ui';

// UX_UI §17: carga de documentos. Etapas observables: transferencia → análisis antimalware → registro.
// Es el ÚNICO mecanismo de carga de documentos (A-05 lo reutiliza desde el productor, la parcela y «Mi finca» con `fixedOwner`):
// mismo servicio (`POST /documents`), mismos controles (formato real, antivirus, límites, versiones, alcance por titular y auditoría).
// Subir NO aprueba el documento: la revisión es una facultad aparte de otra persona autorizada.

type Stage = 'idle' | 'transfer' | 'done' | 'error';

export interface FixedOwner { type: 'producer' | 'plot'; id: string; label: string }

export function UploadDocument({ orgId, types, limits, onDone, fixedOwner }: {
  orgId: string; types: DocType[]; limits: { max_bytes: number; formats: string[] }; onDone: () => Promise<void> | void; fixedOwner?: FixedOwner;
}) {
  const { t } = useI18n();
  const uid = useId();
  const [f, setF] = useState({ document_type: '', owner_type: fixedOwner?.type ?? '', owner_id: fixedOwner?.id ?? '', title: '', issuer: '', issued_at: '', expires_at: '' });
  const [file, setFile] = useState<File | null>(null);
  const [owners, setOwners] = useState<Array<{ id: string; label: string }>>([]);
  const [stage, setStage] = useState<Stage>('idle');
  const [result, setResult] = useState<Doc | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const op = useRef<string | null>(null);
  const type = types.find((x) => x.code === f.document_type);

  useEffect(() => {
    if (fixedOwner) { setOwners([{ id: fixedOwner.id, label: fixedOwner.label }]); return; }
    if (f.owner_type !== 'producer' && f.owner_type !== 'plot') { setOwners([]); return; }
    const path = f.owner_type === 'producer' ? 'producers' : 'plots';
    api<{ items: Array<{ id: string; producer_code?: string; plot_code?: string; legal_name?: string | null; display_name?: string; name?: string | null }> }>(`/api/v1/organizations/${orgId}/${path}?limit=100`)
      .then((r) => setOwners(r.items.map((x) => ({ id: x.id, label: x.producer_code ? `${x.producer_code} · ${x.display_name ?? x.legal_name ?? ''}` : `${x.plot_code}${x.name ? ` · ${x.name}` : ''}` }))))
      .catch(() => setOwners([]));
  }, [f.owner_type, orgId, fixedOwner]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    op.current ??= crypto.randomUUID(); // un reintento tras un fallo de red no duplica el documento
    setStage('transfer'); setError(null); setResult(null);
    const form = new FormData();
    form.append('operation_id', op.current);
    for (const [k, v] of Object.entries(f)) if (v) form.append(k, v);
    form.append('file', file, file.name);
    try {
      const r = await apiUpload<{ document: Doc }>(`/api/v1/organizations/${orgId}/documents`, form);
      setResult(r.data.document); setStage('done'); op.current = null;
      await onDone();
    } catch (err) {
      const ae = err as ApiError;
      if (!(ae.status === 0 || ae.status >= 500)) op.current = null;
      setError(ae); setStage('error'); // los metadatos se conservan
    }
  }

  const v = result?.versions[0];
  return (
    <section className="card form" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>{t('Subir documento')}</h2>
      <p className="muted">{t('Formatos: PDF, JPEG o PNG, hasta {max}. Se verifica el tipo real del archivo y se analiza con antivirus antes de quedar disponible. El hash y el análisis no prueban autenticidad ni validez jurídica.', { max: kb(limits.max_bytes) })}</p>
      <form onSubmit={submit}>
        <div className="grid-2">
          <div>
            <label htmlFor={`${uid}-type`}>{t('Tipo de documento')}</label>
            <select id={`${uid}-type`} required value={f.document_type} onChange={(e) => setF({ ...f, document_type: e.target.value, owner_type: fixedOwner?.type ?? '', owner_id: fixedOwner?.id ?? '' })}>
              <option value="">{t('Selecciona…')}</option>
              {types.map((x) => <option key={x.code} value={x.code}>{t(x.label)}{x.classification === 'PERSONAL_DATA' ? ` (${t('datos personales')})` : ''}</option>)}
            </select>
          </div>
          {!fixedOwner && (
            <>
              <div>
                <label htmlFor={`${uid}-owner-type`}>{t('Titular')}</label>
                <select id={`${uid}-owner-type`} required value={f.owner_type} onChange={(e) => setF({ ...f, owner_type: e.target.value, owner_id: '' })} disabled={!type}>
                  <option value="">{t('Selecciona…')}</option>
                  {type?.allowed_owner_types.filter((o) => o !== 'delivery').map((o) => <option key={o} value={o}>{t(OWNER_LABEL[o] ?? o)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${uid}-owner`}>{f.owner_type === 'plot' ? t('Parcela') : t('Productor')}</label>
                <select id={`${uid}-owner`} required value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} disabled={!owners.length}>
                  <option value="">{t('Selecciona…')}</option>
                  {owners.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
            </>
          )}
          {!fixedOwner && type?.allowed_owner_types.includes('delivery') && (
            <p className="field-help">{t('Un soporte de entrega se aporta al productor o a su parcela de origen y se vincula después desde la entrega.')}</p>
          )}
          {fixedOwner && (
            <div>
              <span className="label" id={`${uid}-for`}>{fixedOwner.type === 'plot' ? t('Parcela') : t('Productor')}</span>
              <p aria-labelledby={`${uid}-for`}><strong>{fixedOwner.label}</strong></p>
            </div>
          )}
          <div><label htmlFor={`${uid}-title`}>{t('Título')}</label><input id={`${uid}-title`} required maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div><label htmlFor={`${uid}-issuer`}>{t('Emisor')} <span className="muted">({t('opcional')})</span></label><input id={`${uid}-issuer`} maxLength={160} value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></div>
          <div><label htmlFor={`${uid}-issued`}>{t('Fecha de emisión')} <span className="muted">({t('opcional')})</span></label><input id={`${uid}-issued`} type="date" value={f.issued_at} onChange={(e) => setF({ ...f, issued_at: e.target.value })} /></div>
          <div><label htmlFor={`${uid}-expires`}>{t('Fecha de vencimiento')} <span className="muted">({t('opcional')})</span></label><input id={`${uid}-expires`} type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></div>
          <div><label htmlFor={`${uid}-file`}>{t('Archivo')}</label><input id={`${uid}-file`} type="file" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => { setFile(e.target.files?.[0] ?? null); op.current = null; }} /></div>
        </div>
        <ol className="plain stages" aria-label={t('Etapas de la carga')}>
          <li>{t('Transferencia')}: {stage === 'transfer' ? t('en curso…') : stage === 'done' ? t('completa') : stage === 'error' ? t('no completada') : t('pendiente')}</li>
          <li>{t('Análisis antimalware')}: {stage === 'transfer' ? t('en curso…') : v ? (v.scan.status === 'CLEAN' ? t('limpio') : v.scan.status === 'FAILED' ? t('fallido ({code}); queda pendiente', { code: v.scan.error_code ?? '' }) : v.scan.status) : error?.body.code === 'FILE_REJECTED_MALWARE' ? t('rechazado: archivo no almacenado') : t('pendiente')}</li>
          <li>{t('Registro')}: {v ? t('versión {n} registrada', { n: v.version_number }) : t('pendiente')}</li>
        </ol>
        {error && <ErrorPanel error={error} />}
        {result && v && <p className="alert valid" role="status">{t('Documento registrado:')} <Link href={`/organizaciones/${orgId}/documentos/${result.id}`}>{result.title}</Link> · {t(AVAILABILITY[v.availability].label)}. {t('Queda aportado, pendiente de revisión: subirlo no lo aprueba.')}</p>}
        <div className="actions"><button type="submit" disabled={stage === 'transfer' || !file} aria-busy={stage === 'transfer'}>{stage === 'transfer' ? t('Subiendo y analizando…') : t('Subir documento')}</button></div>
      </form>
    </section>
  );
}
