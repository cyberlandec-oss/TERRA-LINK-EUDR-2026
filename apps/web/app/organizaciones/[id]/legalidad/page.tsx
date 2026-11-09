'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { AVAILABILITY, VALIDITY, estadoRevision, type Doc, type DocType } from '../../../../lib/documents';
import { AspectoCard } from '../../../../lib/entity-documents';
import { ASPECTO_POR_TIPO, FECHA_FUENTES, FUENTE_GUIA, GUIA, GUIA_REGISTROS, NOTAS_GENERALES, NOTA_VIGENCIA, type Aspecto } from '../../../../lib/guia-documental';
import { useI18n } from '../../../../lib/i18n';
import type { Plot } from '../../../../lib/plots';
import { Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { useWorkspace } from '../../../../lib/workspace';
import type { Producer } from '../productores/page';

// AJ (ajuste mínimo) — «Legalidad y soportes»: la puerta de entrada documental. Responde, en este orden:
//   1. ¿Qué aspecto necesito documentar, y qué ejemplos de soportes corresponden a mi situación?   → guía por aspecto, con fuente y fecha
//   2. ¿Dónde lo aporto?                                                                            → cada parcela y productor de tu alcance, con su acceso directo
//   3. ¿Qué falta y qué observaciones dejó una persona responsable?                                 → resumen derivado de lo ya registrado
// Distingue TRES cosas que no son lo mismo (y no se mezclan):
//   · Recomendaciones de las guías: orientan; no son requisitos adoptados ni una lista obligatoria uniforme.
//   · Información declarada: lo que el actor aporta (archivos con su versión, titular y estado).
//   · Requisitos formalmente adoptados: los fija un perfil jurídico REVISADO y adoptado; hoy no hay uno. Esa limitación se dice UNA vez, en corto, y el detalle técnico
//     vive en «Perfil jurídico (configuración técnica)», que no condiciona aportar soportes.
// «Sin soporte aportado aún» es orientativo: NO es un incumplimiento ni un requisito pendiente. Subir un archivo no lo aprueba ni acredita su autenticidad.

type Tipos = { types: DocType[] };
const ASPECTOS_SOPORTE: Aspecto[] = (() => {
  const vistos = new Set<string>(); const out: Aspecto[] = [];
  for (const lista of Object.values(GUIA)) for (const a of lista) if (!vistos.has(a.id)) { vistos.add(a.id); out.push(a); }
  return out;
})();

export default function LegalidadPage() {
  const { t, dt } = useI18n();
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const puede = ws.can('document:read');
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [plots, setPlots] = useState<Plot[] | null>(null);
  const [productores, setProductores] = useState<Producer[] | null>(null);
  const [tipos, setTipos] = useState<DocType[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !puede) return;
    try {
      const puedeParcelas = ws.can('plot:read') || ws.can('plot:read_assigned') || ws.can('plot:read_own');
      const puedeProductores = ws.can('producer:read') || ws.can('producer:read_assigned') || ws.can('producer:read_own');
      const [d, p, pr, ty] = await Promise.all([
        api<Doc[]>(`/api/v1/organizations/${orgId}/documents`),
        puedeParcelas ? api<{ items: Plot[] }>(`/api/v1/organizations/${orgId}/plots?limit=100&status=ACTIVE`) : Promise.resolve({ items: [] as Plot[] }),
        puedeProductores ? api<{ items: Producer[] }>(`/api/v1/organizations/${orgId}/producers?limit=100`) : Promise.resolve({ items: [] as Producer[] }),
        api<Tipos>(`/api/v1/organizations/${orgId}/document-types`),
      ]);
      setDocs(d); setPlots(p.items); setProductores(pr.items); setTipos(ty.types); setError(null);
    } catch (e) { setError(e as ApiError); }
  }, [orgId, puede, ws]);
  useEffect(() => { void load(); }, [load]);

  const base = `/organizaciones/${orgId}`;
  const porEntidad = useMemo(() => {
    const m = new Map<string, Doc[]>();
    for (const d of docs ?? []) { const k = `${d.owner_type}:${d.owner_id}`; m.set(k, [...(m.get(k) ?? []), d]); }
    return m;
  }, [docs]);
  const nombreEntidad = useMemo(() => {
    const m = new Map<string, { etiqueta: string; href: string }>();
    for (const p of plots ?? []) m.set(`plot:${p.id}`, { etiqueta: `${t('Parcela')} ${p.plot_code}`, href: `${base}/parcelas/${p.id}` });
    for (const p of productores ?? []) m.set(`producer:${p.id}`, { etiqueta: `${t('Productor')} ${p.producer_code}`, href: `${base}/productores/${p.id}` });
    return m;
  }, [plots, productores, base, t]);

  const atencion = useMemo(() => {
    const out: Array<{ id: string; doc: Doc; texto: string; tono: 'review' | 'blocked' | 'neutral'; accion: string }> = [];
    for (const d of docs ?? []) {
      const v = d.versions.find((x) => x.is_current) ?? d.versions[0];
      if (!v) continue;
      if (v.review?.decision === 'REJECTED') out.push({ id: `o-${d.id}`, doc: d, tono: 'review', texto: t('Con observaciones de {quien} el {cuando}: {motivo}', { quien: v.review.reviewer ?? t('una persona responsable'), cuando: dt(v.review.reviewed_at), motivo: v.review.reason }), accion: t('Aportar una versión nueva') });
      if (v.availability === 'SCAN_FAILED' || v.availability === 'REJECTED') out.push({ id: `f-${d.id}`, doc: d, tono: 'blocked', texto: t('No quedó disponible: el análisis técnico falló o lo rechazó.'), accion: t('Aportar un archivo nuevo') });
      if (v.validity === 'EXPIRED') out.push({ id: `v-${d.id}`, doc: d, tono: 'review', texto: t('Vencido el {f}.', { f: v.expires_at ?? '' }), accion: t('Aportar una versión nueva') });
      if (v.availability === 'PENDING') out.push({ id: `p-${d.id}`, doc: d, tono: 'neutral', texto: t('Pendiente de análisis técnico.'), accion: t('Ver el documento') });
    }
    return out;
  }, [docs, t, dt]);
  const pendientesDeRevision = (docs ?? []).filter((d) => { const v = d.versions.find((x) => x.is_current) ?? d.versions[0]; return v && !v.review && v.availability === 'AVAILABLE'; }).length;

  if (!ws.activeOrg) return null;
  if (!puede) return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: t('Tu rol no permite consultar documentos.'), request_id: null })} />;

  const celda = (key: string, aspecto: Aspecto) => {
    const n = (porEntidad.get(key) ?? []).filter((d) => aspecto.tipos.includes(d.document_type)).length;
    return n > 0 ? <StatusBadge tone="process">{t('{n} aportado(s)', { n })}</StatusBadge> : <span className="muted">{t('Sin soporte aportado aún')}</span>;
  };
  const columnasParcela = ASPECTOS_SOPORTE.filter((a) => a.tipos.some((c) => ASPECTO_POR_TIPO[c] === a.id) && GUIA.plot.some((x) => x.id === a.id) && a.id !== 'cobertura');

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: base }, { label: t('Legalidad y soportes') }]} />
      <PageHeader title={t('Legalidad y soportes')} meta={t('Qué documentar, dónde aportarlo y qué falta. Terra Link orienta y registra tus soportes y las decisiones de las personas responsables; no certifica.')} />
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!error && (docs === null || plots === null) && <Loading label={t('Cargando…')} />}

      <section className="card" aria-labelledby="lg-clases">
        <h2 id="lg-clases">{t('Tres cosas distintas')}</h2>
        <dl className="props">
          <dt>{t('Recomendaciones de las guías')}</dt><dd>{t('Orientan sobre qué aspectos se podrían documentar. No son requisitos adoptados ni una lista obligatoria uniforme.')}</dd>
          <dt>{t('Información declarada')}</dt><dd>{t('Lo que tú aportas: archivos con su versión, titular y estado. Subir un archivo no lo aprueba ni acredita su autenticidad.')}</dd>
          <dt>{t('Requisitos formalmente adoptados')}</dt><dd>{t('Los fija un perfil jurídico revisado y adoptado. Hoy no hay uno: por eso esta pantalla orienta y registra soportes, pero no declara requisitos cumplidos.')}</dd>
        </dl>
        <ul className="plain">{NOTAS_GENERALES.map((n) => <li key={n} className="muted">{t(n)}</li>)}</ul>
      </section>

      <section aria-labelledby="lg-aspectos">
        <h2 id="lg-aspectos">{t('1 · ¿Qué aspecto necesito documentar?')}</h2>
        <p className="muted">{t('Cada aspecto indica qué se suele documentar, ejemplos orientativos y de dónde sale la orientación.')}</p>
        {ASPECTOS_SOPORTE.map((a) => <AspectoCard key={a.id} a={a} tipos={tipos} />)}
        <h3>{t('Materias que se resuelven registrando información')}</h3>
        {GUIA_REGISTROS.map((a) => (
          <div key={a.id}>
            <AspectoCard a={a} tipos={tipos} />
            {a.donde && <p><Link href={`${base}/${a.donde.modulo === 'captura' ? 'captura' : a.donde.modulo}`}>{t('Ir a')} {t(a.donde.etiqueta)}</Link></p>}
          </div>
        ))}
        <p className="muted">{t(FUENTE_GUIA)} {t('Incorporada el {f}.', { f: FECHA_FUENTES })} {t(NOTA_VIGENCIA)}</p>
      </section>

      <section className="card" aria-labelledby="lg-donde">
        <h2 id="lg-donde">{t('2 · ¿Dónde lo aporto?')}</h2>
        <p className="muted">{t('Cada soporte se aporta a su productor o parcela, en la sección «Documentos y soportes». Aquí ves cuántos hay por aspecto; «Sin soporte aportado aún» es orientativo, no un incumplimiento.')}</p>
        {plots && plots.length === 0 && productores && productores.length === 0 && <EmptyState title={t('No hay parcelas ni productores en tu alcance.')} />}
        {plots && plots.length > 0 && (
          <div className="table-wrap">
            <table aria-label={t('Soportes por parcela')}>
              <thead><tr><th scope="col">{t('Parcela')}</th>{columnasParcela.map((a) => <th key={a.id} scope="col">{t(a.titulo)}</th>)}<th scope="col">{t('Acción')}</th></tr></thead>
              <tbody>
                {plots.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`${base}/parcelas/${p.id}`}>{p.plot_code}{p.name ? ` · ${p.name}` : ''}</Link></td>
                    {columnasParcela.map((a) => <td key={a.id}>{celda(`plot:${p.id}`, a)}</td>)}
                    <td><Link href={`${base}/parcelas/${p.id}#documentos-y-soportes`}>{t('Aportar soportes')}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {productores && productores.length > 0 && (
          <div className="table-wrap">
            <table aria-label={t('Soportes por productor')}>
              <thead><tr><th scope="col">{t('Productor')}</th><th scope="col">{t('Actividad y operaciones')}</th><th scope="col">{t('Trabajo y aspectos sociales')}</th><th scope="col">{t('Acción')}</th></tr></thead>
              <tbody>
                {productores.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`${base}/productores/${p.id}`}>{p.producer_code} · {p.display_name}</Link></td>
                    <td>{celda(`producer:${p.id}`, GUIA.producer.find((a) => a.id === 'operaciones')!)}</td>
                    <td>{celda(`producer:${p.id}`, GUIA.producer.find((a) => a.id === 'trabajo')!)}</td>
                    <td><Link href={`${base}/productores/${p.id}#documentos-y-soportes`}>{t('Aportar soportes')}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p><Link href={`${base}/documentos`}>{t('Ver todos los documentos')}</Link></p>
      </section>

      <section className="card" aria-labelledby="lg-falta">
        <h2 id="lg-falta">{t('3 · ¿Qué falta y qué observaciones hay?')}</h2>
        {docs && atencion.length === 0 && <EmptyState title={t('No hay observaciones ni documentos que atender ahora.')}><p>{t('Que no haya ninguno no significa que tu información esté completa ni revisada.')}</p></EmptyState>}
        {atencion.length > 0 && (
          <ul className="plain" aria-label={t('Documentos que requieren atención')}>
            {atencion.map((x) => (
              <li key={x.id}>
                <StatusBadge tone={x.tono}>{x.tono === 'review' ? t('Atender') : x.tono === 'blocked' ? t('No disponible') : t('En proceso')}</StatusBadge>{' '}
                <Link href={`${base}/documentos/${x.doc.id}`}>{x.doc.title}</Link> · {nombreEntidad.get(`${x.doc.owner_type}:${x.doc.owner_id}`)?.etiqueta ?? t(x.doc.owner_type === 'plot' ? 'Parcela' : 'Productor')} — {x.texto} <Link href={`${base}/documentos/${x.doc.id}`}>{x.accion}</Link>
              </li>
            ))}
          </ul>
        )}
        {docs && <p className="muted">{t('{n} documento(s) disponible(s) esperan una revisión humana. Subirlos no los aprueba: la revisión es de una persona autorizada y queda con su nombre, fecha y motivo.', { n: pendientesDeRevision })}</p>}
        {docs && docs.length > 0 && (
          <div className="table-wrap">
            <table aria-label={t('Documentos aportados')}>
              <thead><tr><th scope="col">{t('Título')}</th><th scope="col">{t('Entidad')}</th><th scope="col">{t('Estado')}</th><th scope="col">{t('Revisión')}</th><th scope="col">{t('Vigencia')}</th></tr></thead>
              <tbody>
                {docs.slice(0, 50).map((d) => {
                  const v = d.versions.find((x) => x.is_current) ?? d.versions[0];
                  const r = v ? estadoRevision(v) : null;
                  return (
                    <tr key={d.id}>
                      <td><Link href={`${base}/documentos/${d.id}`}>{d.title}</Link></td>
                      <td>{nombreEntidad.get(`${d.owner_type}:${d.owner_id}`)?.etiqueta ?? t(d.owner_type === 'plot' ? 'Parcela' : 'Productor')}</td>
                      <td>{v ? <StatusBadge tone={AVAILABILITY[v.availability].tone}>{t(AVAILABILITY[v.availability].label)}</StatusBadge> : '—'}</td>
                      <td>{r ? <StatusBadge tone={r.tone}>{t(r.label)}</StatusBadge> : '—'}</td>
                      <td>{v ? t(VALIDITY[v.validity]) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {docs && docs.length > 50 && <p className="muted">{t('Se muestran 50 documentos; el resto está en «Documentos».')}</p>}
      </section>

      {ws.can('traceability:read_catalog') && (
        <details className="card">
          <summary>{t('Para quien revisa: perfil jurídico y evaluación de legalidad')}</summary>
          <p>{t('El perfil jurídico técnico y la evaluación de legalidad por parcela son una configuración de revisión. No condicionan que aportes ni consultes soportes aquí.')}</p>
          <p><Link href={`${base}/perfil-juridico`}>{t('Abrir el perfil jurídico (configuración técnica)')}</Link></p>
        </details>
      )}
    </>
  );
}
