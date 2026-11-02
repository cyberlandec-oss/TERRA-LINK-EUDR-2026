'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, apiDownload, session } from '../../lib/api';
import { Alert, EmptyState, ErrorPanel, Loading, PageHeader, StatusBadge, type Tone } from '../../lib/ui';

// P1-001 / P1-002 — Acceso del destinatario de una concesión: **su** lista, **su** vista y **su** descarga.
//
// QUIÉN ES LA AUDIENCIA EXTERNA
// El **destinatario autenticado de una concesión vigente**, no un rol. `BUYER` por sí solo no concede nada:
// lo que habilita es la concesión, sobre **recursos concretos**, con **vencimiento** y **revocación**.
//
// POR QUÉ VIVE FUERA DEL ESPACIO DE TRABAJO
// Quien entra aquí **no es miembro** de la organización dueña. No tiene organización activa, ni menú de
// operación, ni permisos de tenant: solo lo que se le concedió. Montarlo dentro de `/organizaciones` daría a
// entender una pertenencia que no existe.
//
// QUÉ SE VE, Y QUÉ NO
// La **proyección autorizada** que ya define P0-003: códigos, estados y agregados. **Sin identidad de
// productores, sin geometrías y sin documentos personales** — la concesión no levanta la clasificación. Y la
// descarga es una **vista compartida interna**: **no** es un paquete DD ni una declaración oficial.

interface Concesion { id: string; organization: string; resource_type: string; can_read: boolean; can_download: boolean; include_documents?: boolean; include_geometries?: boolean; expires_at: string }
interface Soporte { version_id: string; title: string; document_type: string; version_number: number; file_name: string; mime_type: string; size_bytes: number; sha256: string; matches_stored_sha256: boolean; used_by: string[]; expires_at: string | null; expired: boolean; availability: 'AVAILABLE' | 'PENDING' | 'REJECTED' | 'SCAN_FAILED'; downloadable: boolean }
interface Produccion {
  period: { precision: string; start: string | null; end: string | null; note: string; deliveries: { total: number; declared: number; declared_unknown: number; not_declared: number; corrected: number };
    by_origin_delivery: Array<{ state: string; precision: string | null; start: string | null; end: string | null; corrections: number }> };
  country: { parcels: { total: number; declared: number; declared_unknown: number; not_declared: number }; declared_countries: Array<{ country: string; parcels: number }>; note: string };
}
interface Geometrias { case_number: string; snapshot_number: number; snapshot_content_hash: string; without_geometry_count: number; geojson: { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; geometry: unknown; properties: { production_country?: { state: string; country: string | null; declaration_number: number }; plot_code: string; version_number: number | null; geometry_type: string | null; geometry_hash: string | null; validation_status: string | null } }> }; limits: string[] }
interface Soportes { case_number: string; snapshot_number: number; snapshot_content_hash: string; documents: Soporte[]; restricted_count: number; can_download: boolean; limits: string[] }
const DISPONIBILIDAD: Record<Soporte['availability'], { tono: Tone; texto: string }> = {
  AVAILABLE: { tono: 'valid', texto: 'Disponible' }, PENDING: { tono: 'review', texto: 'Análisis pendiente' },
  REJECTED: { tono: 'blocked', texto: 'Rechazado por el análisis antimalware' }, SCAN_FAILED: { tono: 'review', texto: 'El análisis falló' },
};
interface Indicador { code: string; label: string; state: string; note: string; basis?: { version?: string | null; evaluated_at?: string | null } }
interface Periodo { precision: string; start: string | null; end: string | null; note: string; inherited_range?: { start: string; end: string; note: string } | null }

interface Proyeccion {
  resource_type: string; nota: string; public_reference?: string | null;
  indicators?: Indicador[]; production_period?: Periodo;
  lot_code?: string; status?: string; product?: string; origin_status?: string; productores?: number; parcelas?: number;
  shipment_code?: string; destination_country?: string; dispatch_at?: string | null; items?: number;
  case_number?: string; snapshot_number?: number; readiness?: string; content_hash?: string;
  requirements?: Array<{ code: string; status: string }>;
  documents?: { shared: boolean; shareable_count?: number; restricted_count?: number };
  geometries?: { shared: boolean; count?: number };
  production?: Produccion;
}

const TIPO: Record<string, string> = { LOT: 'Lote', SHIPMENT: 'Embarque', DD_SNAPSHOT: 'Instantánea de diligencia' };

// Seis estados, seis tonos. Nada se pinta de «conforme» salvo lo que de verdad es favorable, y el texto
// acompaña al color: UX-D exige no depender solo del color.
const ESTADO: Record<string, { tono: Tone; texto: string }> = {
  FAVORABLE: { tono: 'valid', texto: 'Favorable' },
  DESFAVORABLE: { tono: 'blocked', texto: 'Desfavorable' },
  PENDIENTE: { tono: 'review', texto: 'Pendiente' },
  DESACTUALIZADO: { tono: 'review', texto: 'Desactualizado' },
  NO_EVALUABLE: { tono: 'neutral', texto: 'No evaluable' },
  SIN_EVALUAR: { tono: 'neutral', texto: 'Sin evaluar' },
};

const PRECISION: Record<string, string> = {
  DAY: 'precisión de día', MONTH: 'precisión de mes',
  UNKNOWN: 'declarado desconocido', NONE: 'sin declarar',
};

export default function CompartidoPage() {
  const [grants, setGrants] = useState<Concesion[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [abierta, setAbierta] = useState<{ id: string; datos: Proyeccion } | null>(null);
  const [soportes, setSoportes] = useState<Soportes | null>(null);
  const [geometrias, setGeometrias] = useState<Geometrias | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [haySesion, setHaySesion] = useState<boolean | null>(null);

  const cargar = useCallback(async () => {
    if (!session.get()) { setHaySesion(false); return; }
    setHaySesion(true);
    try { setGrants((await api<{ grants: Concesion[] }>('/api/v1/granted')).grants); setError(null); }
    catch (e) { setError(e as ApiError); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const abrir = async (g: Concesion) => {
    try {
      setSoportes(null); setGeometrias(null);
      setAbierta({ id: g.id, datos: await api<Proyeccion>(`/api/v1/granted/${g.id}`) });
      // Los soportes tienen su propia ruta y solo existen si la concesión los incluye; la API revalida cada acceso.
      if (g.include_documents) setSoportes(await api<Soportes>(`/api/v1/granted/${g.id}/documents`));
      if (g.include_geometries) setGeometrias(await api<Geometrias>(`/api/v1/granted/${g.id}/geometries`));
      setError(null);
    } catch (e) { setError(e as ApiError); setAbierta(null); setSoportes(null); setGeometrias(null); }
  };

  const descargar = async (g: Concesion) => {
    try {
      const r = await apiDownload(`/api/v1/granted/${g.id}/download`, `vista-compartida-${g.id}.json`);
      setAviso(`Descargado ${r.filename} (${r.bytes} bytes). Es una vista compartida interna, no un paquete DD.`);
      setError(null);
    } catch (e) { setError(e as ApiError); }
  };

  const guardarGeojson = (g: Geometrias) => {
    const blob = new Blob([JSON.stringify(g.geojson)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `parcelas-${g.case_number}-instantanea-${g.snapshot_number}.geojson`; a.click();
    URL.revokeObjectURL(url);
    setAviso(`Guardado ${a.download}: ${g.geojson.features.length} geometría(s) de la instantánea ${g.snapshot_number}. No es una presentación oficial.`);
  };

  const descargarSoporte = async (grantId: string, s: Soporte) => {
    try {
      const r = await apiDownload(`/api/v1/granted/${grantId}/documents/${s.version_id}/content`, s.file_name);
      setAviso(`Descargado ${r.filename} (${r.bytes} bytes), versión ${s.version_number}. Huella SHA-256 ${s.sha256}. Un documento aportado no queda certificado por Terra Link.`);
      setError(null);
    } catch (e) { setError(e as ApiError); }
  };

  if (haySesion === false) {
    return (
      <main className="tl-portal"><div className="tl-portal-card">
        <PageHeader title="Recursos compartidos contigo" />
        <Alert tone="info" title="Inicia sesión">
          <p>Lo compartido contigo se abre con tu cuenta. <Link href="/">Inicia sesión</Link> para verlo.</p>
        </Alert>
      </div></main>
    );
  }

  return (
    <main className="tl-portal"><div className="tl-portal-card">
      <PageHeader
        title="Recursos compartidos contigo"
        meta="Lo que otras organizaciones te han concedido: recursos concretos, con vencimiento y revocables en cualquier momento."
      />

      <Alert tone="info" title="Qué es y qué no es esto">
        <p>
          Ves una <strong>proyección autorizada</strong>: códigos, estados y agregados.
          <strong> No incluye identidad de productores, ni geometrías, ni documentos personales</strong>, porque
          una concesión no levanta la clasificación de los datos. Solo una concesión de instantánea que lo indique expresamente añade los <strong>soportes</strong> que esa instantánea referencia. Lo que descargues es una
          <strong> vista compartida interna</strong>: <strong>no es un paquete DD ni una declaración oficial</strong>.
        </p>
      </Alert>

      {error && <ErrorPanel error={error} onRetry={cargar} />}
      {aviso && <Alert tone="valid" title="Descarga completada"><span style={{ overflowWrap: 'anywhere' }}>{aviso}</span></Alert>}
      {!grants && !error && <Loading label="Cargando lo compartido contigo…" />}
      {grants && grants.length === 0 && (
        <EmptyState title="Todavía no hay nada compartido contigo.">
          <p className="muted">Cuando una organización te conceda acceso a un recurso, aparecerá aquí.</p>
        </EmptyState>
      )}

      {grants && grants.length > 0 && (
        <div className="table-wrap"><table aria-label="Recursos compartidos contigo">
          <thead><tr>
            <th scope="col">Organización</th><th scope="col">Recurso</th><th scope="col">Puedes</th>
            <th scope="col">Vence</th><th scope="col">Acciones</th>
          </tr></thead>
          <tbody>{grants.map((g) => (
            <tr key={g.id}>
              <td>{g.organization}</td>
              <td>{TIPO[g.resource_type] ?? g.resource_type}</td>
              <td>
                {g.can_read && <StatusBadge tone="neutral">Consultar</StatusBadge>}{' '}
                {g.can_download && <StatusBadge tone="neutral">Descargar</StatusBadge>}
              </td>
              <td>{new Date(g.expires_at).toLocaleString('es-EC')}</td>
              <td>
                {g.can_read && <button type="button" onClick={() => void abrir(g)}>Ver</button>}
                {/* El botón de descarga solo existe si esa acción está concedida: la API lo revalida igual. */}
                {g.can_download && <button type="button" onClick={() => void descargar(g)}>Descargar</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {abierta && (
        <section aria-labelledby="vista-titulo">
          <h2 id="vista-titulo">{TIPO[abierta.datos.resource_type] ?? abierta.datos.resource_type}</h2>
          <dl className="kv">
            {abierta.datos.lot_code && (<><dt className="muted">Lote</dt><dd>{abierta.datos.lot_code}</dd>
              <dt className="muted">Producto</dt><dd>{abierta.datos.product}</dd>
              <dt className="muted">Estado</dt><dd>{abierta.datos.status}</dd>
              <dt className="muted">Origen</dt><dd>{abierta.datos.origin_status}</dd>
              <dt className="muted">Productores</dt><dd>{abierta.datos.productores}</dd>
              <dt className="muted">Parcelas</dt><dd>{abierta.datos.parcelas}</dd></>)}
            {abierta.datos.shipment_code && (<><dt className="muted">Embarque</dt><dd>{abierta.datos.shipment_code}</dd>
              <dt className="muted">Estado</dt><dd>{abierta.datos.status}</dd>
              <dt className="muted">Destino declarado</dt><dd>{abierta.datos.destination_country}</dd>
              <dt className="muted">Ítems</dt><dd>{abierta.datos.items}</dd></>)}
            {abierta.datos.case_number && (<><dt className="muted">Expediente</dt><dd>{abierta.datos.case_number}</dd>
              <dt className="muted">Instantánea</dt><dd>{abierta.datos.snapshot_number}</dd>
              <dt className="muted">Preparación</dt><dd>{abierta.datos.readiness}</dd>
              <dt className="muted">Huella</dt><dd><code>{abierta.datos.content_hash?.slice(0, 16)}…</code></dd></>)}
            {abierta.datos.public_reference && (<><dt className="muted">Referencia pública</dt><dd><code>{abierta.datos.public_reference}</code></dd></>)}
          </dl>
          {abierta.datos.production_period && (
            <p className="muted">
              <strong>Período de producción:</strong>{' '}
              {abierta.datos.production_period.start
                ? <>{abierta.datos.production_period.start} – {abierta.datos.production_period.end} ({PRECISION[abierta.datos.production_period.precision]})</>
                : <strong>desconocido</strong>}
              <br />{abierta.datos.production_period.note}
            </p>
          )}
          {/* Procedencia histórica: SEPARADA del período, nunca presentada como cosecha declarada. */}
          {abierta.datos.production_period?.inherited_range && (
            <p className="muted">
              <strong>Límites heredados (no es el período de producción):</strong>{' '}
              {abierta.datos.production_period.inherited_range.start} – {abierta.datos.production_period.inherited_range.end}
              <br />{abierta.datos.production_period.inherited_range.note}
            </p>
          )}

          {abierta.datos.indicators && abierta.datos.indicators.length > 0 && (
            <>
              <h3>Estado del lote</h3>
              <p className="muted">
                Cada indicador es un <strong>estado</strong>, no un dato del recurso.
                <strong> «No evaluable» y «sin evaluar» no significan conforme.</strong>
              </p>
              <div className="table-wrap"><table aria-label="Indicadores del lote">
                <thead><tr><th scope="col">Indicador</th><th scope="col">Estado</th><th scope="col">Qué significa</th></tr></thead>
                <tbody>{abierta.datos.indicators.map((i) => (
                  <tr key={i.code}>
                    <td>{i.label}{i.basis?.version && <div className="muted">{i.basis.version}</div>}</td>
                    <td><StatusBadge tone={ESTADO[i.state]?.tono ?? 'neutral'}>{ESTADO[i.state]?.texto ?? i.state}</StatusBadge></td>
                    <td className="muted">{i.note}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>
          )}

          {abierta.datos.requirements && abierta.datos.requirements.length > 0 && (
            <div className="table-wrap"><table aria-label="Requisitos de la instantánea">
              <thead><tr><th scope="col">Requisito</th><th scope="col">Estado</th></tr></thead>
              <tbody>{abierta.datos.requirements.map((r) => (
                <tr key={r.code}><td>{r.code}</td><td>{r.status}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {abierta.datos.production && (
            <section aria-labelledby="produccion-titulo">
              <h3 id="produccion-titulo">Período y país de producción</h3>
              <Alert tone="review" title="Lo que la organización declaró, tal como lo fijó la instantánea">
                <p>
                  Se distingue lo <strong>declarado</strong>, lo <strong>declarado como desconocido</strong> y lo <strong>sin declarar</strong>. Lo desconocido no se asigna a ningún país
                  ni se cubre con la fecha de entrega. Terra Link no verifica estos datos.
                </p>
              </Alert>
              <div className="table-wrap"><table aria-label="Período de producción por origen">
                <thead><tr><th scope="col">Origen (entrega)</th><th scope="col">Estado</th><th scope="col">Cosecha</th></tr></thead>
                <tbody>{abierta.datos.production.period.by_origin_delivery.map((d, i) => (
                  <tr key={i}><td>Origen {i + 1}</td>
                    <td>{d.state === 'DECLARED' ? 'Declarada' : d.state === 'DECLARED_UNKNOWN' ? 'Declarada como desconocida' : 'Sin declarar'}</td>
                    <td>{d.state === 'DECLARED' ? `${d.start}${d.end && d.end !== d.start ? ` a ${d.end}` : ''} (${d.precision === 'MONTH' ? 'mes' : 'día'})${d.corrections > 0 ? ` · corregida ${d.corrections} vez/veces` : ''}` : '—'}</td></tr>
                ))}</tbody>
              </table></div>
              <p className="field-help">{abierta.datos.production.period.note}</p>
              <p>
                País de producción: {abierta.datos.production.country.parcels.declared} de {abierta.datos.production.country.parcels.total} parcela(s) con país declarado
                {abierta.datos.production.country.declared_countries.length > 0 ? ` (${abierta.datos.production.country.declared_countries.map((c) => `${c.country}: ${c.parcels}`).join(', ')})` : ''};
                {' '}{abierta.datos.production.country.parcels.declared_unknown} declarada(s) como desconocida(s); {abierta.datos.production.country.parcels.not_declared} sin declarar.
              </p>
              <p className="field-help">{abierta.datos.production.country.note}</p>
            </section>
          )}
          {soportes && (
            <section aria-labelledby="soportes-titulo">
              <h3 id="soportes-titulo">Soportes de la instantánea</h3>
              <Alert tone="review" title="Vista limitada, no el expediente completo">
                <p>
                  Recibes <strong>solo los soportes que esta instantánea referencia</strong>, en su versión exacta y con su huella; lo que la organización suba
                  después no se añade. <strong>No incluye documentos con datos personales{abierta.datos.geometries?.shared ? '' : ' ni geometrías'}</strong>
                  {soportes.restricted_count > 0 ? <> ({soportes.restricted_count} excluido{soportes.restricted_count === 1 ? '' : 's'}; su contenido y sus datos no se muestran)</> : null}.
                  Si te faltan documentos o geometrías para tu debida diligencia, pídelos a la organización por un canal que ella autorice. Terra Link conserva y
                  permite consultar estos archivos; <strong>no certifica su autenticidad</strong>, y compartirlos no es presentar una DDS.
                </p>
              </Alert>
              {soportes.documents.length === 0 ? (
                <EmptyState title="Esta instantánea no tiene soportes compartibles."><p className="muted">No hay documentos referenciados que esta concesión pueda mostrarte.</p></EmptyState>
              ) : (
                <div className="table-wrap"><table aria-label="Soportes de la instantánea">
                  <thead><tr><th scope="col">Documento</th><th scope="col">Versión y archivo</th><th scope="col">Huella SHA-256</th><th scope="col">Estado</th><th scope="col">Acción</th></tr></thead>
                  <tbody>{soportes.documents.map((s) => (
                    <tr key={s.version_id}>
                      <td>{s.title}<div className="muted">{s.document_type}{s.expired ? ' · vencido' : ''}</div></td>
                      <td>v{s.version_number} · {s.file_name}<div className="muted">{s.mime_type} · {s.size_bytes} bytes</div></td>
                      <td><code title={s.sha256}>{s.sha256.slice(0, 16)}…</code>{!s.matches_stored_sha256 && <div className="muted">La huella guardada no coincide: no se puede entregar.</div>}</td>
                      <td><StatusBadge tone={DISPONIBILIDAD[s.availability].tono}>{DISPONIBILIDAD[s.availability].texto}</StatusBadge></td>
                      <td>{s.downloadable
                        ? <button type="button" onClick={() => void descargarSoporte(abierta.id, s)}>Descargar esta versión</button>
                        : <span className="muted">{soportes.can_download ? 'No disponible para descargar' : 'Tu concesión no incluye descargar'}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </section>
          )}
          {geometrias && (
            <section aria-labelledby="geometrias-titulo">
              <h3 id="geometrias-titulo">Polígonos de las parcelas de origen</h3>
              <Alert tone="review" title="Geometrías fijadas en esta instantánea">
                <p>
                  Son las geometrías que la instantánea {geometrias.snapshot_number} fijó, cada una con su versión y su huella; una corrección posterior de la parcela no las cambia.
                  No incluyen al productor. Que una geometría sea técnicamente válida <strong>no es una conclusión de cumplimiento ni de legalidad</strong>, y compartirla no es presentar una DDS.
                </p>
              </Alert>
              {geometrias.geojson.features.length === 0 ? (
                <EmptyState title="La instantánea no fijó geometrías."><p className="muted">Las parcelas de origen no tenían una geometría registrada al capturarla{geometrias.without_geometry_count > 0 ? ` (${geometrias.without_geometry_count} sin geometría)` : ''}.</p></EmptyState>
              ) : (
                <>
                  <div className="table-wrap"><table aria-label="Polígonos de las parcelas de origen">
                    <thead><tr><th scope="col">Parcela</th><th scope="col">Versión</th><th scope="col">Tipo</th><th scope="col">Huella SHA-256</th><th scope="col">Validación técnica</th><th scope="col">País de producción</th></tr></thead>
                    <tbody>{geometrias.geojson.features.map((f) => (
                      <tr key={`${f.properties.plot_code}-${f.properties.version_number}`}>
                        <td>{f.properties.plot_code}</td><td>{f.properties.version_number ?? '—'}</td><td>{f.properties.geometry_type ?? '—'}</td>
                        <td><code title={f.properties.geometry_hash ?? ''}>{(f.properties.geometry_hash ?? '—').slice(0, 16)}…</code></td><td>{f.properties.validation_status ?? '—'}</td>
                        <td>{f.properties.production_country?.state === 'DECLARED' ? `${f.properties.production_country.country} (declarado)` : f.properties.production_country?.state === 'DECLARED_UNKNOWN' ? 'Declarado como desconocido' : 'Sin declarar'}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                  <button type="button" onClick={() => guardarGeojson(geometrias)}>Guardar como GeoJSON</button>
                </>
              )}
            </section>
          )}
          <Alert tone="review" title="Límite de esta vista">{abierta.datos.nota}</Alert>
        </section>
      )}
    </div></main>
  );
}
