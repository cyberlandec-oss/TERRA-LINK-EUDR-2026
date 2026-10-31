'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import { ApiError, api } from './api';
import { UploadDocument } from './document-upload';
import { AVAILABILITY, VALIDITY, estadoRevision, type Doc, type DocType } from './documents';
import { FECHA_FUENTES, FUENTE_GUIA, GUIA, NOTAS_GENERALES, SITUACIONES_TRABAJO, type Aspecto, type OwnerKind } from './guia-documental';
import { useI18n } from './i18n';
import { EmptyState, ErrorPanel, StatusBadge } from './ui';

// A-05 (CTX-05/CTX-06) — Documentos EN CONTEXTO: se aportan y consultan desde el productor, la parcela o «Mi finca», con una guía
// orientativa del aspecto que se documenta. Reutiliza el servicio de documentos y su carga (`UploadDocument`): mismo alcance por titular,
// antivirus, versiones y auditoría. Subir NO aprueba nada; la revisión es de una persona autorizada y se ve aparte (derivada del contrato existente).

type Types = { types: DocType[]; limits: { max_bytes: number; formats: string[] } };

export function EntityDocuments({ orgId, ownerType, ownerId, ownerLabel, canUpload, excludeTypes = [], onChanged }: {
  orgId: string; ownerType: OwnerKind; ownerId: string; ownerLabel: string; canUpload: boolean; excludeTypes?: string[];
  /** Para que la pantalla que lo aloja refresque sus propios resúmenes después de aportar un documento. */
  onChanged?: () => Promise<void> | void;
}) {
  const { t, dt } = useI18n();
  const uid = useId();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [types, setTypes] = useState<Types | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [denied, setDenied] = useState(false);
  const exclKey = excludeTypes.join(','); // clave estable: un arreglo nuevo en cada render reiniciaría la carga
  const excl = exclKey ? exclKey.split(',') : [];

  const load = useCallback(async () => {
    try {
      const [d, ty] = await Promise.all([
        api<Doc[]>(`/api/v1/organizations/${orgId}/documents?owner_type=${ownerType}&owner_id=${ownerId}`),
        api<Types>(`/api/v1/organizations/${orgId}/document-types`),
      ]);
      setDocs(d.filter((x) => !(exclKey ? exclKey.split(',') : []).includes(x.document_type))); setTypes(ty); setError(null);
    } catch (err) {
      if ((err as ApiError).status === 403) { setDenied(true); return; }
      setError(err as ApiError);
    }
  }, [orgId, ownerType, ownerId, exclKey]);
  useEffect(() => { void load(); }, [load]);

  if (denied) return null;
  const subidos = types?.types.filter((x) => x.allowed_owner_types.includes(ownerType) && !excl.includes(x.code)) ?? [];

  return (
    <section className="card" id="documentos-y-soportes" aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`}>{t('Documentos y soportes')}</h2>
      <p className="muted">{t('Aquí aportas y consultas los documentos de {x}. Subir un documento no lo aprueba ni acredita su autenticidad: una persona autorizada lo revisa aparte.', { x: ownerLabel })}</p>
      <GuiaDocumental owner={ownerType} tipos={subidos} />
      {error && <ErrorPanel error={error} onRetry={load} />}
      {docs && docs.length === 0 && <EmptyState title={t('Todavía no hay documentos aportados aquí.')} />}
      {docs && docs.length > 0 && (
        <div className="table-wrap">
          <table aria-label={t('Documentos aportados')}>
            <thead><tr><th scope="col">{t('Título')}</th><th scope="col">{t('Tipo')}</th><th scope="col">{t('Estado')}</th><th scope="col">{t('Revisión')}</th><th scope="col">{t('Vigencia')}</th><th scope="col">{t('Aportado')}</th></tr></thead>
            <tbody>
              {docs.map((d) => {
                const v = d.versions.find((x) => x.is_current) ?? d.versions[0];
                const a = v ? AVAILABILITY[v.availability] : null;
                const r = v ? estadoRevision(v) : null;
                return (
                  <tr key={d.id}>
                    <td><Link href={`/organizaciones/${orgId}/documentos/${d.id}`}>{d.title}</Link></td>
                    <td>{t(d.type_label)}</td>
                    <td>{a ? <StatusBadge tone={a.tone}>{t(a.label)}</StatusBadge> : '—'}</td>
                    <td>{r ? <StatusBadge tone={r.tone}>{t(r.label)}</StatusBadge> : '—'}{v?.review?.decision === 'REJECTED' && <span className="muted"> · {v.review.reason}</span>}</td>
                    <td>{v ? `${t(VALIDITY[v.validity])}${v.expires_at ? ` (${v.expires_at})` : ''}` : '—'}</td>
                    <td>{v ? dt(v.uploaded_at) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {types && canUpload && subidos.length > 0 && (
        <UploadDocument orgId={orgId} types={subidos} limits={types.limits} onDone={async () => { await load(); await onChanged?.(); }} fixedOwner={{ type: ownerType, id: ownerId, label: ownerLabel }} />
      )}
      {types && !canUpload && <p className="muted">{t('Tu rol puede consultar estos documentos, pero no aportar nuevos aquí.')}</p>}
    </section>
  );
}

/** Un aspecto de la guía, con su orientación, tipo de documento disponible, procedencia y fecha. Orientación: no obligatoria, no se guarda lo que se elige. */
export function AspectoCard({ a, tipos }: { a: Aspecto; tipos: DocType[] }) {
  const { t } = useI18n();
  const uid = useId();
  const [situacion, setSituacion] = useState('');
  const etiqueta = (code: string) => { const x = tipos.find((y) => y.code === code); return x ? t(x.label) : code; };
  return (
    <article className="card" aria-labelledby={`${uid}-h`}>
      <h3 id={`${uid}-h`}>{t(a.titulo)}</h3>
      <p><StatusBadge tone="neutral">{t('Recomendación de las guías')}</StatusBadge> {a.clase === 'registro' && <StatusBadge tone="process">{t('Se resuelve registrando información')}</StatusBadge>}</p>
      <p>{t(a.para)}</p>
      {a.ejemplos.length > 0 && (
        <>
          <p className="muted">{t('Ejemplos orientativos (no una lista obligatoria):')}</p>
          <ul>{a.ejemplos.map((e) => <li key={e}>{t(e)}</li>)}</ul>
        </>
      )}
      <p><strong>{t('Conviene aclarar')}:</strong> {t(a.aclarar)}</p>
      {a.id === 'trabajo' && (
        <div>
          <label htmlFor={`${uid}-sit`}>{t('¿Cómo se trabaja la finca?')}</label>
          <select id={`${uid}-sit`} value={situacion} onChange={(e) => setSituacion(e.target.value)}>
            <option value="">{t('Selecciona…')}</option>
            {SITUACIONES_TRABAJO.map((x) => <option key={x.id} value={x.id}>{t(x.etiqueta)}</option>)}
          </select>
          <p className="field-help">{t('Es solo orientación: no se guarda y no es una calificación jurídica.')}</p>
          {situacion && <p role="status">{t(SITUACIONES_TRABAJO.find((x) => x.id === situacion)!.orientacion)}</p>}
        </div>
      )}
      {a.tipos.some((c) => tipos.some((y) => y.code === c)) && <p className="muted">{t('Tipo de documento disponible')}: {a.tipos.filter((c) => tipos.some((y) => y.code === c)).map(etiqueta).join(', ')}.</p>}
      {a.nota && <p className="alert review">{t(a.nota)}</p>}
      <p className="muted">{t('Referencia en las guías')}: {a.fuente}. {t('Incorporada el {f}.', { f: FECHA_FUENTES })}</p>
    </article>
  );
}

/** Guía ORIENTATIVA por aspecto. No bloquea nada, no es una lista obligatoria y no se guarda lo que se elige. */
export function GuiaDocumental({ owner, tipos }: { owner: OwnerKind; tipos: DocType[] }) {
  const { t } = useI18n();
  return (
    <details className="guia-documental">
      <summary>{t('Qué puedes documentar y por qué (guía orientativa)')}</summary>
      <ul className="plain">
        {NOTAS_GENERALES.map((n) => <li key={n} className="muted">{t(n)}</li>)}
      </ul>
      {GUIA[owner].map((a) => <AspectoCard key={a.id} a={a} tipos={tipos} />)}
      <p className="muted">{t(FUENTE_GUIA)}</p>
    </details>
  );
}
