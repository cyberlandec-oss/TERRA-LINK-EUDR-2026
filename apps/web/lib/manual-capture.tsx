'use client';

import dynamic from 'next/dynamic';
import { useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ApiError, api } from './api';
import { useI18n } from './i18n';
import { accuracyLabel } from './location-capture';
import { type MyLocation } from './mi-ubicacion';
import { Alert, ErrorPanel, StatusBadge } from './ui';

// El mapa (MapLibre + cartografía local) solo existe en el navegador y se carga bajo demanda.
const MapCapture = dynamic(() => import('./map-capture').then((m) => m.MapCapture), { ssr: false });

// A-01 — Registrar la ubicación de una PARCELA escribiendo coordenadas o dibujándolas en un croquis.
//
// Reglas que esta pantalla no puede perder:
//   · Una coordenada escrita o dibujada NO es una medición GPS: se guarda como MANUAL_COORDINATES, sin precisión, y la
//     revisión lo dice. La precisión no se inventa.
//   · Cada posición se escribe como [longitud, latitud] y el ORDEN se rotula en cada campo y en la tabla de revisión.
//   · La validez la decide el SERVIDOR (estructura, topología, superficie): primero se revisa sin guardar, después se confirma.
//   · Corregir una geometría existente exige un motivo; la versión anterior se conserva.
//   · «Dibujar en el mapa» usa cartografía real (OpenStreetMap) servida LOCALMENTE por Terra Link (lib/map-capture.tsx); sin datos
//     cartográficos lo declara y quedan la tabla y el croquis. El croquis no tiene mapa base: orienta, no mide. Todo con alternativa por teclado y tabla.

/** `loc`: este vértice se tomó de «Mi ubicación» (con SU precisión y hora). Se pierde en cuanto la persona edita o arrastra el vértice: ya no es esa lectura. */
interface Vertex { lon: string; lat: string; loc?: { accuracy_m: number | null; captured_at: string } }
interface Preview {
  structurally_valid: boolean; issues: Array<{ path: string; reason: string }>;
  geometry_type: 'POINT' | 'POLYGON' | 'MULTIPOLYGON' | null; technically_valid: boolean | null; validity_reason: string | null;
  area_calculated_ha: string | null; vertex_count: number; order: string;
  provenance: { survey_method: string; is_gps_measurement: boolean; note: string };
  bbox: { min_longitude: number; min_latitude: number; max_longitude: number; max_latitude: number } | null;
}
type Origin = 'TABLE' | 'MAP' | 'SKETCH';

// Ecuador continental e insular, con holgura: se usa solo para advertir de un posible orden invertido, nunca para rechazar.
const ECUADOR = { minLon: -92.5, maxLon: -74.5, minLat: -5.5, maxLat: 2 };
const parse = (v: string): number | null => {
  const s = v.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const ISSUE_ES: Record<string, string> = {
  LATITUDE_OUT_OF_RANGE: 'La latitud está fuera de rango (±90).', LONGITUDE_OUT_OF_RANGE: 'La longitud está fuera de rango (±180).',
  COORDINATE_NOT_NUMERIC: 'Una coordenada no es un número.', GEOMETRY_MUST_BE_OBJECT: 'La geometría debe ser un objeto GeoJSON.',
  TYPE_MUST_BE_POINT_POLYGON_OR_MULTIPOLYGON: 'Solo se admiten Point, Polygon y MultiPolygon.', RING_NEEDS_AT_LEAST_4_POSITIONS: 'Un anillo necesita al menos 4 posiciones.',
  RING_NOT_CLOSED: 'El anillo no está cerrado.', POLYGON_WITHOUT_RINGS: 'El polígono no tiene anillos.', MULTIPOLYGON_EMPTY: 'El multipolígono está vacío.',
  CRS_MEMBER_NOT_ALLOWED_WGS84_ONLY: 'No se admite un sistema de coordenadas distinto de WGS84.',
};
const toRing = (vs: Array<[number, number]>): number[][] => {
  const ring = vs.map(([lon, lat]) => [lon, lat]);
  const [a, b] = [ring[0], ring[ring.length - 1]];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return ring;
};

export function ManualCapture({ orgId, plotId, rowVersion, hasGeometry, initialCenter, onSaved }: {
  orgId: string; plotId: string; rowVersion: number; hasGeometry: boolean;
  initialCenter?: { lon: number; lat: number } | null; onSaved: () => Promise<void>;
}) {
  const { t, num, dt } = useI18n();
  const uid = useId();
  const [mode, setMode] = useState<'POINT' | 'POLYGON'>('POINT');
  const [origin, setOrigin] = useState<Origin>('TABLE');
  const [vertices, setVertices] = useState<Vertex[]>([{ lon: '', lat: '' }]);
  const [preview, setPreview] = useState<{ data: Preview; geometry: Record<string, unknown> } | null>(null);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const opLock = useRef(false);

  const parsed = useMemo(() => vertices.map((v) => ({ lon: parse(v.lon), lat: parse(v.lat) })), [vertices]);
  const rangeOk = parsed.every((p) => p.lon !== null && p.lat !== null && Math.abs(p.lon!) <= 180 && Math.abs(p.lat!) <= 90);
  const needed = mode === 'POINT' ? 1 : 3;
  const complete = vertices.length >= needed && rangeOk && (mode === 'POINT' ? vertices.length === 1 : true);
  const outside = complete && parsed.some((p) => p.lon! < ECUADOR.minLon || p.lon! > ECUADOR.maxLon || p.lat! < ECUADOR.minLat || p.lat! > ECUADOR.maxLat);

  function edit(next: Vertex[]) { setVertices(next); setPreview(null); setSaved(null); setError(null); setAck(false); }
  function geometry(): Record<string, unknown> {
    const pts = parsed.map((p) => [p.lon!, p.lat!] as [number, number]);
    return mode === 'POINT' ? { type: 'Point', coordinates: pts[0] } : { type: 'Polygon', coordinates: [toRing(pts)] };
  }
  function changeMode(m: 'POINT' | 'POLYGON') { setMode(m); edit(m === 'POINT' ? [{ lon: '', lat: '' }] : [{ lon: '', lat: '' }, { lon: '', lat: '' }, { lon: '', lat: '' }]); }

  /** Vértices que devuelve el mapa: conservan la procedencia solo si siguen siendo EXACTAMENTE la misma coordenada tomada de «Mi ubicación». */
  function fromMap(vs: Array<{ lon: number; lat: number }>): Vertex[] {
    const conLoc = new Map(vertices.filter((v) => v.loc).map((v) => [`${v.lon}|${v.lat}`, v.loc!]));
    const out = vs.map((p) => { const lon = String(p.lon); const lat = String(p.lat); const loc = conLoc.get(`${lon}|${lat}`); return loc ? { lon, lat, loc } : { lon, lat }; });
    return out.length ? out : (mode === 'POINT' ? [{ lon: '', lat: '' }] : []);
  }
  const hasValue = (v: Vertex) => v.lon.trim() !== '' || v.lat.trim() !== '';
  /** Acción EXPLÍCITA tras «Mi ubicación»: un punto reemplaza el existente (la etiqueta lo dice); un vértice ocupa la primera fila vacía o se añade al final. Nunca sobrescribe en silencio. */
  function incorporarUbicacion(l: MyLocation) {
    const v: Vertex = { lon: String(Math.round(l.longitude * 1e6) / 1e6), lat: String(Math.round(l.latitude * 1e6) / 1e6), loc: { accuracy_m: l.accuracy_m, captured_at: l.captured_at } };
    if (mode === 'POINT') { edit([v]); return; }
    const vacia = vertices.findIndex((x) => !hasValue(x));
    edit(vacia >= 0 ? vertices.map((x, j) => (j === vacia ? v : x)) : [...vertices, v]);
  }
  const deMiUbicacion = vertices.map((v, i) => ({ v, i })).filter((x) => x.v.loc);
  const locateLabel = mode === 'POINT' ? (hasValue(vertices[0] ?? { lon: '', lat: '' }) ? t('Reemplazar el punto con esta posición') : t('Usar como punto')) : t('Añadir vértice aquí');

  async function review() {
    setBusy(true); setError(null);
    try {
      const g = geometry();
      const data = await api<Preview>(`/api/v1/organizations/${orgId}/plots/${plotId}/geometry-preview`, { method: 'POST', body: { geometry: g } });
      setPreview({ data, geometry: g });
    } catch (err) { setError(err as ApiError); } finally { setBusy(false); }
  }

  async function confirm() {
    if (!preview || opLock.current) return;
    opLock.current = true; setBusy(true); setError(null);
    try {
      const lecturas = deMiUbicacion.length
        ? ` Vértices tomados de «Mi ubicación» del navegador (no GPS): ${deMiUbicacion.map(({ v, i }) => `#${i + 1} ${v.loc!.accuracy_m === null ? 'sin precisión' : `±${Math.round(v.loc!.accuracy_m)} m`} ${v.loc!.captured_at.slice(11, 19)}Z`).join('; ')}.` : '';
      const origen = origin === 'MAP' ? 'Dibujada en el mapa de referencia de la web (no es una medición GPS)'
        : origin === 'SKETCH' ? 'Dibujada en el croquis de la web (no es una medición GPS)' : 'Coordenadas escritas en la web (no es una medición GPS)';
      const r = await api<{ version: { version_number: number } }>(`/api/v1/organizations/${orgId}/plots/${plotId}/geometry-versions`, {
        method: 'POST',
        body: { expected_version: rowVersion, survey_method: 'MANUAL_COORDINATES', geometry: preview.geometry, notes: (origen + lecturas).slice(0, 500), ...(reason.trim() ? { reason: reason.trim() } : {}) },
      });
      setSaved(r.version.version_number); setPreview(null); setReason(''); setAck(false);
      setVertices(mode === 'POINT' ? [{ lon: '', lat: '' }] : [{ lon: '', lat: '' }, { lon: '', lat: '' }, { lon: '', lat: '' }]);
      await onSaved();
    } catch (err) { setError(err as ApiError); } finally { opLock.current = false; setBusy(false); }
  }

  const reasonNeeded = hasGeometry;
  const canConfirm = !!preview && preview.data.structurally_valid && preview.data.technically_valid !== false
    && (!outside || ack) && (!reasonNeeded || reason.trim().length >= 3) && !busy;

  return (
    <div className="capture manual-capture" aria-live="polite">
      <h3>{t('Escribir o dibujar coordenadas')}</h3>
      <p className="field-help">{t('Para cuando no hay GPS a mano: escribe las coordenadas o márcalas en el mapa. Se guardan como «coordenadas ingresadas», sin precisión, y NO acreditan una medición GPS.')}</p>
      {saved !== null && <Alert tone="valid" title={t('Ubicación guardada como versión {n}.', { n: saved })}><p>{t('La versión anterior se conserva. La validación GIS sigue siendo un paso aparte.')}</p></Alert>}

      <fieldset>
        <legend>{t('Qué vas a registrar')}</legend>
        <label><input type="radio" name={`${uid}-mode`} checked={mode === 'POINT'} onChange={() => changeMode('POINT')} /> {t('Un punto')}</label>
        <label><input type="radio" name={`${uid}-mode`} checked={mode === 'POLYGON'} onChange={() => changeMode('POLYGON')} /> {t('Un polígono (al menos 3 vértices)')}</label>
      </fieldset>

      <div role="group" aria-label={t('Forma de entrada')} className="actions">
        <button type="button" className={origin === 'TABLE' ? '' : 'secondary'} aria-pressed={origin === 'TABLE'} onClick={() => setOrigin('TABLE')}>{t('Escribir coordenadas')}</button>
        <button type="button" className={origin === 'MAP' ? '' : 'secondary'} aria-pressed={origin === 'MAP'} onClick={() => setOrigin('MAP')}>{t('Dibujar en el mapa')}</button>
        <button type="button" className={origin === 'SKETCH' ? '' : 'secondary'} aria-pressed={origin === 'SKETCH'} onClick={() => setOrigin('SKETCH')}>{t('Dibujar en el croquis')}</button>
      </div>

      {origin === 'MAP' && (
        <MapCapture
          mode={mode} vertices={parsed.filter((p) => p.lon !== null && p.lat !== null) as Array<{ lon: number; lat: number }>}
          initialCenter={initialCenter ?? null}
          onChange={(vs) => edit(fromMap(vs))}
          locate={{ label: locateLabel, onUse: incorporarUbicacion, note: t('Es una acción explícita: localizarte no cambia las coordenadas.') }}
        />
      )}

      {origin === 'SKETCH' && (
        <Croquis
          mode={mode} vertices={parsed.filter((p) => p.lon !== null && p.lat !== null) as Array<{ lon: number; lat: number }>}
          initialCenter={initialCenter ?? null}
          onChange={(vs) => edit(vs.length ? vs.map((p) => ({ lon: String(p.lon), lat: String(p.lat) })) : (mode === 'POINT' ? [{ lon: '', lat: '' }] : []))}
        />
      )}

      <div className="table-wrap">
        <table aria-label={t('Coordenadas a registrar')}>
          <caption className="muted" style={{ textAlign: 'left', padding: '8px 16px' }}>
            {t('Cada posición es [longitud, latitud] en WGS84 (EPSG:4326): primero la longitud (este-oeste), luego la latitud (norte-sur). Para Ecuador la longitud es negativa (≈ -92 a -75) y la latitud ronda -5 a 2.')}
          </caption>
          <thead><tr><th scope="col">#</th><th scope="col">{t('Longitud')} ({t('este-oeste')})</th><th scope="col">{t('Latitud')} ({t('norte-sur')})</th><th scope="col">{t('Origen')}</th><th scope="col"><span className="visually-hidden">{t('Acciones')}</span></th></tr></thead>
          <tbody>
            {vertices.map((v, i) => {
              const bad = (s: string, max: number) => s.trim() !== '' && (parse(s) === null || Math.abs(parse(s)!) > max);
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <label className="visually-hidden" htmlFor={`${uid}-lon-${i}`}>{t('Longitud')} ({t('este-oeste')}) · {t('vértice {n}', { n: i + 1 })}</label>
                    <input id={`${uid}-lon-${i}`} inputMode="decimal" autoComplete="off" value={v.lon} placeholder="-80.1600" aria-invalid={bad(v.lon, 180)}
                      onChange={(e) => edit(vertices.map((x, j) => (j === i ? { lon: e.target.value, lat: x.lat } : x)))} />
                  </td>
                  <td>
                    <label className="visually-hidden" htmlFor={`${uid}-lat-${i}`}>{t('Latitud')} ({t('norte-sur')}) · {t('vértice {n}', { n: i + 1 })}</label>
                    <input id={`${uid}-lat-${i}`} inputMode="decimal" autoComplete="off" value={v.lat} placeholder="-0.8500" aria-invalid={bad(v.lat, 90)}
                      onChange={(e) => edit(vertices.map((x, j) => (j === i ? { lon: x.lon, lat: e.target.value } : x)))} />
                  </td>
                  <td className="muted">{v.loc ? `${t('Mi ubicación')} · ${accuracyLabel(v.loc.accuracy_m, t, num)} · ${dt(v.loc.captured_at)}` : t('Escrito o dibujado')}</td>
                  <td>
                    {mode === 'POLYGON' && vertices.length > 3 && (
                      <button type="button" className="secondary inline" onClick={() => edit(vertices.filter((_, j) => j !== i))}>{t('Quitar')}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mode === 'POLYGON' && (
        <p className="actions">
          <button type="button" className="secondary" onClick={() => edit([...vertices, { lon: '', lat: '' }])}>{t('Añadir vértice')}</button>
          <span className="muted">{t('El anillo se cierra solo con el primer vértice: no lo repitas.')}</span>
        </p>
      )}
      {!rangeOk && vertices.some((v) => v.lon || v.lat) && <p className="muted" role="status">{t('Hay valores vacíos o fuera de rango (longitud ±180, latitud ±90).')}</p>}

      <p className="actions">
        <button type="button" onClick={review} disabled={!complete || busy} aria-busy={busy}>{busy && !preview ? t('Revisando…') : t('Revisar antes de guardar')}</button>
      </p>
      {error && <ErrorPanel error={error} onRetry={review} />}
      {error?.status === 409 && <p className="muted">{t('La parcela cambió mientras trabajabas. Recarga la ficha; lo que escribiste se conserva aquí.')}</p>}

      {preview && (
        <section className="card capture-review" aria-labelledby={`${uid}-rev`}>
          <h4 id={`${uid}-rev`}>{t('Revisión hecha por el servidor (todavía no se guardó nada)')}</h4>
          {!preview.data.structurally_valid ? (
            <Alert tone="blocked" title={t('La geometría no se puede almacenar.')}>
              <ul>{preview.data.issues.map((i, k) => <li key={k}><code>{i.path}</code>: {t(ISSUE_ES[i.reason] ?? i.reason)}</li>)}</ul>
              <p>{t('Corrige los valores y vuelve a revisar.')}</p>
            </Alert>
          ) : (
            <>
              <dl className="props">
                <dt>{t('Tipo')}</dt><dd>{preview.data.geometry_type === 'POINT' ? t('Punto') : preview.data.geometry_type === 'POLYGON' ? t('Polígono') : t('Multipolígono')} · {t('{n} posiciones', { n: preview.data.vertex_count })}</dd>
                <dt>{t('Orden de las coordenadas')}</dt><dd>{t(preview.data.order)}</dd>
                <dt>{t('Procedencia')}</dt><dd><StatusBadge tone="neutral">{t('Coordenadas ingresadas')}</StatusBadge> {t(preview.data.provenance.note)}</dd>
                <dt>{t('Precisión')}</dt><dd>{t('No informada: no hay medición.')}</dd>
                {deMiUbicacion.length > 0 && (
                  <>
                    <dt>{t('Vértices de Mi ubicación')}</dt>
                    <dd>
                      {deMiUbicacion.map(({ v, i }) => <span key={i} style={{ display: 'block' }}>{t('vértice {n}', { n: i + 1 })}: {accuracyLabel(v.loc!.accuracy_m, t, num)}</span>)}
                      <span className="muted" style={{ display: 'block' }}>{t('Cada precisión es la de su propia lectura: no se aplica al polígono ni a los demás vértices, y no acredita una medición GPS.')}</span>
                    </dd>
                  </>
                )}
                <dt>{t('Validez técnica')}</dt><dd>{preview.data.technically_valid === null ? t('No aplica a un punto') : preview.data.technically_valid ? <StatusBadge tone="process">{t('Válida')}</StatusBadge> : <><StatusBadge tone="review">{t('No válida')}</StatusBadge> {preview.data.validity_reason}</>}</dd>
                <dt>{t('Superficie calculada')}</dt><dd>{preview.data.area_calculated_ha ? `${num(Number(preview.data.area_calculated_ha), 4)} ha` : t('No calculada')}</dd>
                <dt>{t('Validación GIS')}</dt><dd>{t('Pendiente (P0-010). Confirmar no valida la parcela.')}</dd>
              </dl>
              {preview.data.technically_valid === false && (
                <Alert tone="blocked" title={t('La forma no es válida (por ejemplo, se cruza consigo misma).')}><p>{t('No se puede guardar así. Corrige los vértices y vuelve a revisar.')}</p></Alert>
              )}
              {outside && (
                <Alert tone="review" title={t('Estas coordenadas caen fuera de Ecuador.')}>
                  <p>{t('¿Invertiste longitud y latitud? La longitud va primero y para Ecuador es negativa.')}</p>
                  <label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> {t('Confirmo que las coordenadas son correctas aunque estén fuera de Ecuador')}</label>
                </Alert>
              )}
              {reasonNeeded && (
                <div>
                  <label htmlFor={`${uid}-reason`}>{t('Motivo de la corrección (queda en el historial y la auditoría)')}</label>
                  <input id={`${uid}-reason`} minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <p className="field-help">{t('Esta parcela ya tiene una ubicación: se crea una versión nueva y la anterior se conserva.')}</p>
                </div>
              )}
            </>
          )}
          <div className="actions">
            <button type="button" onClick={confirm} disabled={!canConfirm} aria-busy={busy}>{busy ? t('Guardando…') : t('Guardar como nueva versión')}</button>
            <button type="button" className="secondary" onClick={() => setPreview(null)} disabled={busy}>{t('Seguir editando')}</button>
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- croquis
const SIZE = 360;
const SPANS = [8, 2, 0.5, 0.1, 0.02, 0.004]; // grados de longitud visibles
const METERS_PER_DEG = 111_320;

function Croquis({ mode, vertices, initialCenter, onChange }: {
  mode: 'POINT' | 'POLYGON'; vertices: Array<{ lon: number; lat: number }>;
  initialCenter: { lon: number; lat: number } | null; onChange: (vs: Array<{ lon: number; lat: number }>) => void;
}) {
  const { t, num } = useI18n();
  const uid = useId();
  const [center, setCenter] = useState(initialCenter ?? { lon: -78.5, lat: -1.5 });
  const [zoom, setZoom] = useState(initialCenter ? 3 : 0);
  const [cursor, setCursor] = useState({ x: SIZE / 2, y: SIZE / 2 });
  const [goto, setGoto] = useState({ lon: '', lat: '' });
  const span = SPANS[zoom];
  const toLon = (x: number) => center.lon + (x / SIZE - 0.5) * span;
  const toLat = (y: number) => center.lat - (y / SIZE - 0.5) * span;
  const px = (lon: number) => ((lon - center.lon) / span + 0.5) * SIZE;
  const py = (lat: number) => (0.5 - (lat - center.lat) / span) * SIZE;
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const mPerPx = (span * METERS_PER_DEG) / SIZE;

  function add(x: number, y: number) {
    const p = { lon: r6(toLon(x)), lat: r6(toLat(y)) };
    onChange(mode === 'POINT' ? [p] : [...vertices, p]);
  }
  function onClick(e: MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * SIZE;
    const y = ((e.clientY - r.top) / r.height) * SIZE;
    setCursor({ x, y });
    add(x, y);
  }
  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); setCursor((c) => ({ x: Math.min(SIZE, Math.max(0, c.x + moves[e.key][0])), y: Math.min(SIZE, Math.max(0, c.y + moves[e.key][1])) })); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(cursor.x, cursor.y); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom((z) => Math.min(SPANS.length - 1, z + 1)); return; }
    if (e.key === '-') { e.preventDefault(); setZoom((z) => Math.max(0, z - 1)); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); onChange(vertices.slice(0, -1)); }
  }
  function pan(dx: number, dy: number) { setCenter((c) => ({ lon: r6(c.lon + dx * span * 0.25), lat: r6(c.lat + dy * span * 0.25) })); }
  function go() {
    const lon = parse(goto.lon); const lat = parse(goto.lat);
    if (lon === null || lat === null || Math.abs(lon) > 180 || Math.abs(lat) > 90) return;
    setCenter({ lon, lat }); setZoom(3);
  }

  const pts = vertices.map((v) => `${px(v.lon).toFixed(1)},${py(v.lat).toFixed(1)}`);
  const grid = [0.25, 0.5, 0.75];
  return (
    <div className="croquis">
      <p className="field-help">
        {t('Croquis sin mapa base: orienta, no mide. Haz clic para fijar un vértice, o enfoca el croquis y usa las flechas para mover la cruz y Enter para fijarlo (+/- para acercar, Retroceso para deshacer).')}
      </p>
      <svg width="100%" viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ maxWidth: SIZE, touchAction: 'manipulation', cursor: 'crosshair' }} tabIndex={0} role="application"
        aria-label={t('Croquis para dibujar la parcela. Centro: longitud {lon}, latitud {lat}. Ancho visible: {span} grados.', { lon: num(center.lon, 4), lat: num(center.lat, 4), span: num(span, 3) })}
        onClick={onClick} onKeyDown={onKey}>
        <rect x="0" y="0" width={SIZE} height={SIZE} fill="var(--tl-surface-subtle)" stroke="var(--tl-border, #c9d8cf)" />
        {grid.map((g) => (
          <g key={g} stroke="var(--tl-border, #c9d8cf)" strokeDasharray="3 4" strokeWidth="1">
            <line x1={g * SIZE} y1="0" x2={g * SIZE} y2={SIZE} /><line x1="0" y1={g * SIZE} x2={SIZE} y2={g * SIZE} />
          </g>
        ))}
        {grid.map((g) => (
          <g key={`l${g}`} fontSize="9" fill="currentColor">
            <text x={g * SIZE + 2} y={SIZE - 3}>{r6(toLon(g * SIZE))}</text><text x="2" y={g * SIZE - 2}>{r6(toLat(g * SIZE))}</text>
          </g>
        ))}
        {pts.length >= 3 && <polygon points={pts.join(' ')} fill="rgba(43,102,80,0.18)" stroke="var(--tl-forest)" strokeWidth="2" />}
        {pts.length === 2 && <polyline points={pts.join(' ')} fill="none" stroke="var(--tl-forest)" strokeWidth="2" />}
        {vertices.map((v, i) => (
          <g key={i}><circle cx={px(v.lon)} cy={py(v.lat)} r="5" fill="var(--tl-forest)" stroke="#fff" strokeWidth="2" /><text x={px(v.lon) + 7} y={py(v.lat) - 6} fontSize="11" fontWeight="700">{i + 1}</text></g>
        ))}
        <g stroke="currentColor" strokeWidth="1"><line x1={cursor.x - 8} y1={cursor.y} x2={cursor.x + 8} y2={cursor.y} /><line x1={cursor.x} y1={cursor.y - 8} x2={cursor.x} y2={cursor.y + 8} /></g>
      </svg>
      <p className="muted" role="status">
        {t('Zoom {z} de {n}: cada píxel del croquis equivale a unos {m} m. Un clic fija la coordenada con esa resolución.', { z: zoom + 1, n: SPANS.length, m: num(mPerPx, mPerPx < 10 ? 1 : 0) })}
      </p>
      <div className="actions" role="group" aria-label={t('Mover y acercar el croquis')}>
        <button type="button" className="secondary inline" onClick={() => pan(-1, 0)} aria-label={t('Mover al oeste')}>←</button>
        <button type="button" className="secondary inline" onClick={() => pan(0, 1)} aria-label={t('Mover al norte')}>↑</button>
        <button type="button" className="secondary inline" onClick={() => pan(0, -1)} aria-label={t('Mover al sur')}>↓</button>
        <button type="button" className="secondary inline" onClick={() => pan(1, 0)} aria-label={t('Mover al este')}>→</button>
        <button type="button" className="secondary inline" onClick={() => setZoom((z) => Math.min(SPANS.length - 1, z + 1))} disabled={zoom === SPANS.length - 1}>{t('Acercar')}</button>
        <button type="button" className="secondary inline" onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0}>{t('Alejar')}</button>
        <button type="button" className="secondary inline" onClick={() => onChange(vertices.slice(0, -1))} disabled={vertices.length === 0}>{t('Deshacer último')}</button>
        <button type="button" className="secondary inline" onClick={() => onChange([])} disabled={vertices.length === 0}>{t('Borrar todo')}</button>
      </div>
      <div className="grid-3">
        <div><label htmlFor={`${uid}-glon`}>{t('Ir a longitud')}</label><input id={`${uid}-glon`} inputMode="decimal" value={goto.lon} onChange={(e) => setGoto({ ...goto, lon: e.target.value })} placeholder="-80.16" /></div>
        <div><label htmlFor={`${uid}-glat`}>{t('Ir a latitud')}</label><input id={`${uid}-glat`} inputMode="decimal" value={goto.lat} onChange={(e) => setGoto({ ...goto, lat: e.target.value })} placeholder="-0.85" /></div>
        <div><button type="button" className="secondary" onClick={go}>{t('Centrar el croquis aquí')}</button></div>
      </div>
    </div>
  );
}
