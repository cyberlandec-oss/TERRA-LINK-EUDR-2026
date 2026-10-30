'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { AVAILABILITY, VALIDITY, estadoRevision, type Doc } from '../../../../lib/documents';
import { EntityDocuments } from '../../../../lib/entity-documents';
import { useI18n } from '../../../../lib/i18n';
import { GEOMETRY_STATUS, type Plot } from '../../../../lib/plots';
import { Alert, Breadcrumb, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge } from '../../../../lib/ui';
import { useWorkspace } from '../../../../lib/workspace';
import type { Producer } from '../productores/page';

// A-05 · CTX-01 / UI-22 — «Mi finca»: la puerta de entrada de quien aporta información de SU finca (PRODUCER y cuentas con alcance propio).
// Reúne SU productor, SUS parcelas, SUS documentos y SUS pendientes, con el alcance que ya decide el servidor (`producer:read_own`, `plot:*_own`,
// `document:*`): esta pantalla no concede nada, solo ordena lo que la API ya permite ver.
// Cada estado se dice con su causa y NO son intercambiables:
//   · «sin permiso»        → el rol no tiene `producer:read_own` o no incluye entregas;
//   · «cuenta sin vínculo» → con alcance propio y sin productores visibles: falta que la organización vincule la cuenta (UX-D08), no es un error ni «no hay datos»;
//   · «vinculada, sin parcelas» → hay productor pero todavía no hay parcelas;
//   · «error»              → la consulta falló y se puede reintentar.
// Los pendientes se DERIVAN de lo ya registrado (ubicación, análisis y revisión de documentos): no son una evaluación de cumplimiento.

interface EntregaPropia {
  id: string; delivery_code: string; status: string; delivery_date: string | null; product: string | null;
  quantity_declared: { value: string; unit: string | null } | null; received: { value: string; unit: string } | null; receptions: number; reception_status_label: string;
}
interface Pendiente { id: string; texto: string; href: string; accion: string }

export default function MiFincaPage() {
  const { t, dt } = useI18n();
  const ws = useWorkspace();
  const orgId = ws.activeOrg?.id ?? '';
  const puede = ws.can('producer:read_own');
  const leeDocumentos = ws.can('document:read');
  const leeEntregas = ws.can('delivery:read_own');
  // La lista de parcelas no trae `can_update` (solo el detalle): se muestra el formulario según el permiso del rol y la API comprueba el alcance de cada parcela.
  const puedeAportarEnParcela = (ws.can('plot:update') || ws.can('plot:update_assigned') || ws.can('plot:update_own')) && ws.can('document:upload');
  const [productores, setProductores] = useState<Producer[] | null>(null);
  const [parcelas, setParcelas] = useState<Plot[] | null>(null);
  const [documentos, setDocumentos] = useState<Doc[] | null>(null);
  const [entregas, setEntregas] = useState<EntregaPropia[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [duenio, setDuenio] = useState('');

  const load = useCallback(async () => {
    if (!orgId || !puede) return;
    try {
      const [p, l, d, e] = await Promise.all([
        api<{ items: Producer[] }>(`/api/v1/organizations/${orgId}/producers?limit=100`),
        api<{ items: Plot[] }>(`/api/v1/organizations/${orgId}/plots?limit=100`),
        leeDocumentos ? api<Doc[]>(`/api/v1/organizations/${orgId}/documents`) : Promise.resolve<Doc[]>([]),
        leeEntregas ? api<EntregaPropia[]>(`/api/v1/organizations/${orgId}/deliveries`) : Promise.resolve<EntregaPropia[] | null>(null),
      ]);
      setProductores(p.items); setParcelas(l.items); setDocumentos(d); setEntregas(e); setError(null);
    } catch (e) { setError(e as ApiError); }
  }, [orgId, puede, leeDocumentos, leeEntregas]);
  useEffect(() => { void load(); }, [load]);

  const pendientes = useMemo<Pendiente[]>(() => {
    const out: Pendiente[] = [];
    for (const pl of parcelas ?? []) {
      const base = `/organizaciones/${orgId}/parcelas/${pl.id}`;
      if (pl.geometry_status === 'NONE') out.push({ id: `g-${pl.id}`, texto: t('La parcela {c} no tiene ubicación registrada.', { c: pl.plot_code }), href: base, accion: t('Ubicar la parcela') });
      else if (pl.geometry_status === 'DECLARED_AREA_ONLY') out.push({ id: `s-${pl.id}`, texto: t('La parcela {c} solo tiene superficie declarada: falta su ubicación.', { c: pl.plot_code }), href: base, accion: t('Ubicar la parcela') });
    }
    for (const d of documentos ?? []) {
      const v = d.versions.find((x) => x.is_current) ?? d.versions[0];
      if (!v) continue;
      const href = `/organizaciones/${orgId}/documentos/${d.id}`;
      if (v.availability === 'PENDING') out.push({ id: `p-${d.id}`, texto: t('El documento «{d}» está pendiente de análisis.', { d: d.title }), href, accion: t('Ver el documento') });
      if (v.availability === 'SCAN_FAILED' || v.availability === 'REJECTED') out.push({ id: `f-${d.id}`, texto: t('El documento «{d}» no quedó disponible: el análisis falló o lo rechazó.', { d: d.title }), href, accion: t('Aportar un archivo nuevo') });
      if (v.validity === 'EXPIRED') out.push({ id: `v-${d.id}`, texto: t('El documento «{d}» está vencido.', { d: d.title }), href, accion: t('Aportar una versión nueva') });
      if (v.review?.decision === 'REJECTED') out.push({ id: `o-${d.id}`, texto: t('El documento «{d}» tiene observaciones: {r}', { d: d.title, r: v.review.reason }), href, accion: t('Revisar y aportar una versión nueva') });
    }
    return out;
  }, [parcelas, documentos, orgId, t]);

  if (!ws.activeOrg) return null;
  if (!puede) {
    return <ErrorPanel error={new ApiError(403, { code: 'PERMISSION_DENIED', message: t('Tu rol no incluye «Mi finca». Usa el menú de tu rol para ver lo que sí tienes disponible.'), request_id: null })} />;
  }

  const base = `/organizaciones/${orgId}`;
  const sinVinculo = productores !== null && parcelas !== null && productores.length === 0 && parcelas.length === 0;
  const opciones = [
    ...(productores ?? []).map((p) => ({ key: `producer:${p.id}`, tipo: 'producer' as const, id: p.id, etiqueta: `${t('Productor')} ${p.producer_code}`, canUpload: false })),
    ...(parcelas ?? []).map((p) => ({ key: `plot:${p.id}`, tipo: 'plot' as const, id: p.id, etiqueta: `${t('Parcela')} ${p.plot_code}`, canUpload: puedeAportarEnParcela })),
  ];
  const elegida = opciones.find((o) => o.key === duenio) ?? opciones.find((o) => o.tipo === 'plot') ?? opciones[0];

  return (
    <>
      <Breadcrumb items={[{ label: ws.activeOrg.name, href: base }, { label: t('Mi finca') }]} />
      <PageHeader title={t('Mi finca')} meta={t('Tu productor, tus parcelas, tus documentos y lo que falta por aportar. Aquí solo ves lo tuyo.')} />
      {error && <ErrorPanel error={error} onRetry={load} />}
      {!error && (productores === null || parcelas === null) && <Loading label={t('Cargando tu finca…')} />}

      {sinVinculo && (
        <Alert tone="review" title={t('Tu cuenta todavía no está vinculada a un productor.')}>
          <p>{t('Esto es una configuración pendiente, no un error ni que no tengas datos: la organización debe vincular tu cuenta con tu productor. Pide a la persona que administra tu organización que lo haga desde Productores → ficha del productor → «Vincular cuenta».')}</p>
          <p>{t('Mientras tanto no verás parcelas ni documentos propios, y no se te da acceso a datos de otras personas.')}</p>
        </Alert>
      )}

      {productores && productores.length > 0 && (
        <section className="card" aria-labelledby="mf-prod">
          <h2 id="mf-prod">{t('Mi productor')}</h2>
          <ul className="plain">
            {productores.map((p) => (
              <li key={p.id}><Link href={`${base}/productores/${p.id}`}>{p.producer_code} · {p.display_name}</Link> <StatusBadge tone={p.status === 'ACTIVE' ? 'valid' : 'neutral'}>{p.status === 'ACTIVE' ? t('Activo') : p.status === 'DRAFT' ? t('Borrador') : t('De baja')}</StatusBadge></li>
            ))}
          </ul>
        </section>
      )}

      {parcelas && productores && productores.length > 0 && (
        <section className="card" aria-labelledby="mf-parc">
          <h2 id="mf-parc">{t('Mis parcelas')}</h2>
          {parcelas.length === 0 ? (
            <EmptyState title={t('Tu cuenta está vinculada, pero todavía no hay parcelas registradas.')}>
              <p>{t('Puedes registrar una desde la ficha de tu productor si tu rol lo permite.')}</p>
              {productores.length === 1 && <p><Link className="button" href={`${base}/productores/${productores[0].id}`}>{t('Registrar una parcela nueva')}</Link></p>}
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table aria-label={t('Mis parcelas')}>
                <thead><tr><th scope="col">{t('Parcela')}</th><th scope="col">{t('Ubicación')}</th><th scope="col">{t('Acción')}</th></tr></thead>
                <tbody>
                  {parcelas.map((p) => (
                    <tr key={p.id}>
                      <td><Link href={`${base}/parcelas/${p.id}`}>{p.plot_code}{p.name ? ` · ${p.name}` : ''}</Link></td>
                      <td><StatusBadge tone={GEOMETRY_STATUS[p.geometry_status].tone}>{t(GEOMETRY_STATUS[p.geometry_status].label)}</StatusBadge></td>
                      <td><Link href={`${base}/parcelas/${p.id}`}>{p.geometry_status === 'GEOMETRY_RECORDED' ? t('Ver o corregir la ubicación') : t('Ubicar la parcela')}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {productores && parcelas && !sinVinculo && (
        <section className="card" aria-labelledby="mf-pend">
          <h2 id="mf-pend">{t('Lo que falta por aportar')}</h2>
          <p className="muted">{t('Estos pendientes salen de lo que ya registraste; no son una evaluación de cumplimiento. Que no haya ninguno tampoco significa que tu información esté completa.')}</p>
          {pendientes.length === 0 ? <EmptyState title={t('No hay pendientes visibles ahora.')} /> : (
            <ul className="plain" aria-label={t('Pendientes')}>
              {pendientes.map((p) => <li key={p.id}>{p.texto} <Link href={p.href}>{p.accion}</Link></li>)}
            </ul>
          )}
        </section>
      )}

      {documentos && documentos.length > 0 && (
        <section className="card" aria-labelledby="mf-docs">
          <h2 id="mf-docs">{t('Todos mis documentos')}</h2>
          <div className="table-wrap">
            <table aria-label={t('Todos mis documentos')}>
              <thead><tr><th scope="col">{t('Título')}</th><th scope="col">{t('Tipo')}</th><th scope="col">{t('Estado')}</th><th scope="col">{t('Revisión')}</th><th scope="col">{t('Vigencia')}</th><th scope="col">{t('Aportado')}</th></tr></thead>
              <tbody>
                {documentos.map((d) => {
                  const v = d.versions.find((x) => x.is_current) ?? d.versions[0];
                  const r = v ? estadoRevision(v) : null;
                  return (
                    <tr key={d.id}>
                      <td><Link href={`${base}/documentos/${d.id}`}>{d.title}</Link></td>
                      <td>{t(d.type_label)}</td>
                      <td>{v ? <StatusBadge tone={AVAILABILITY[v.availability].tone}>{t(AVAILABILITY[v.availability].label)}</StatusBadge> : '—'}</td>
                      <td>{r ? <StatusBadge tone={r.tone}>{t(r.label)}</StatusBadge> : '—'}</td>
                      <td>{v ? t(VALIDITY[v.validity]) : '—'}</td>
                      <td>{v ? dt(v.uploaded_at) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {elegida && (
        <>
          <div className="card">
            <label htmlFor="mf-owner">{t('Aportar o consultar documentos de')}</label>
            <select id="mf-owner" value={elegida.key} onChange={(e) => setDuenio(e.target.value)}>
              {opciones.map((o) => <option key={o.key} value={o.key}>{o.etiqueta}</option>)}
            </select>
          </div>
          <EntityDocuments key={elegida.key} orgId={orgId} ownerType={elegida.tipo} ownerId={elegida.id} ownerLabel={elegida.etiqueta} canUpload={elegida.canUpload}
            excludeTypes={['FIELD_EVIDENCE', 'FIELD_PHOTO']} onChanged={load} />
        </>
      )}

      <section className="card" aria-labelledby="mf-ent">
        <h2 id="mf-ent">{t('Mis entregas')}</h2>
        {ws.can('delivery:read') || ws.can('delivery:read_assigned') ? (
          <p><Link href={`${base}/entregas`}>{t('Ver las entregas')}</Link></p>
        ) : leeEntregas ? (
          entregas === null ? <Loading label={t('Cargando tus entregas…')} /> : entregas.length === 0 ? (
            <EmptyState title={sinVinculo ? t('Sin vínculo de cuenta no hay entregas que mostrar.') : t('Todavía no hay entregas registradas a tu nombre.')} />
          ) : (
            <>
              <p className="muted">{t('Aquí ves el estado de cada entrega. El detalle de la recepción y la calidad lo gestiona tu organización: no se muestra a tu rol.')}</p>
              <div className="table-wrap">
                <table aria-label={t('Mis entregas')}>
                  <thead><tr><th scope="col">{t('Entrega')}</th><th scope="col">{t('Fecha')}</th><th scope="col">{t('Producto')}</th><th scope="col">{t('Declarado')}</th><th scope="col">{t('Recibido')}</th><th scope="col">{t('Recepción')}</th></tr></thead>
                  <tbody>
                    {entregas.map((e) => (
                      <tr key={e.id}>
                        <td>{e.delivery_code}</td>
                        <td>{e.delivery_date ?? '—'}</td>
                        <td>{e.product ?? '—'}</td>
                        <td>{e.quantity_declared ? `${e.quantity_declared.value} ${e.quantity_declared.unit ?? ''}` : '—'}</td>
                        <td>{e.received ? `${e.received.value} ${e.received.unit}` : '—'}</td>
                        <td>{t(e.reception_status_label)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        ) : (
          <Alert tone="info" title={t('Tu rol no incluye la consulta de entregas.')}>
            <p>{t('Esto es una limitación de permisos del rol (no un error ni que no haya entregas): con el alcance vigente no puedes ver tus entregas desde la plataforma. Pregunta a tu organización por su estado.')}</p>
          </Alert>
        )}
      </section>
    </>
  );
}
